#!/usr/bin/env python3
"""Rassegna profonda delle nuove pubblicazioni, catalogate per specializzazione.

Gira ogni giorno in GitHub Actions. Interroga gli archivi aperti sulla finestra
di giorni indicata, scarta il rumore, assegna a ogni voce i temi del piano di
studio e scrive un catalogo incrementale.

    python3 catalogo.py --cartella rassegna --giorni 1
    python3 catalogo.py --cartella rassegna --giorni 7 --temi statistica epidemiologia
    python3 catalogo.py --cartella rassegna --prova        # nessuna rete, dati finti

Tre garanzie, nell'ordine in cui contano:

  1. Una fonte che non risponde non ferma la rassegna. Finisce nel rapporto con
     il suo errore e le altre proseguono: una rassegna parziale ogni giorno vale
     più di una rassegna completa che salta il giorno in cui un archivio è giù.

  2. Lo stato sta in `visti.json`, non nella memoria del processo. Il giorno
     dopo si ripubblica solo ciò che è nuovo, anche se la corsa precedente è
     stata interrotta a metà.

  3. L'uscita è ordinata in modo deterministico. Due corse sugli stessi dati
     producono due file identici, altrimenti il diff quotidiano è illeggibile.
"""
import argparse
import json
import os
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import fonti_aperte as fonti
from specializzazioni import (SPECIALIZZAZIONI, classifica, e_pubblicazione, e_rumore,
                              nome_di, termini_di_ricerca, trimestre_di)

RADICE = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
ESCLUSIONI = os.path.join(RADICE, "assets", "contenuti", "esclusioni_rassegna.json")

# Categorie arXiv che coprono i temi del piano. Non tutte le specializzazioni
# hanno un corrispettivo su arXiv: quelle normative e umanitarie no, e va bene.
CATEGORIE_ARXIV = ["cs.DB", "cs.LG", "cs.CR", "cs.CY", "cs.SE", "stat.ME", "stat.AP", "stat.ML"]

# Quanti temi interrogare per fonte a ogni corsa. Le fonti a interrogazione
# libera (OpenAlex, DOAJ, Europe PMC, Crossref, Zenodo) vengono chiamate una
# volta per tema: senza un tetto la rassegna quotidiana diventa un crawl.
TEMI_PER_CORSA = len(SPECIALIZZAZIONI)


def carica_json(percorso, predefinito):
    try:
        with open(percorso, encoding="utf-8") as f:
            return json.load(f)
    except (OSError, ValueError):
        return predefinito


def scrivi_json(percorso, dati):
    os.makedirs(os.path.dirname(percorso) or ".", exist_ok=True)
    temporaneo = percorso + ".tmp"
    with open(temporaneo, "w", encoding="utf-8") as f:
        json.dump(dati, f, ensure_ascii=False, indent=1, sort_keys=True)
    os.replace(temporaneo, percorso)          # sostituzione atomica: mai un file a metà


def finestra(giorni):
    adesso = time.time()
    return (time.strftime("%Y-%m-%d", time.gmtime(adesso - giorni * 86400)),
            time.strftime("%Y-%m-%d", time.gmtime(adesso)))


def raccogli(da, a, temi, rapporto, massimo_per_fonte):
    """Interroga ogni fonte. Restituisce la lista grezza, con i duplicati.

    Ogni chiamata è isolata: l'eccezione di una fonte non esce da qui.
    """
    grezzo = []

    def prova(nome, funzione, *argomenti, **parole):
        inizio = time.monotonic()
        try:
            uscite = funzione(*argomenti, **parole) or []
        except fonti.FonteNonDisponibile as e:
            rapporto.append((nome, "non disponibile", str(e), 0, time.monotonic() - inizio))
            return
        except Exception as e:                 # un adattatore rotto non deve fermare la rassegna
            rapporto.append((nome, "errore", f"{type(e).__name__}: {e}", 0, time.monotonic() - inizio))
            return
        grezzo.extend(uscite)
        rapporto.append((nome, "ok", "", len(uscite), time.monotonic() - inizio))

    # Fonti che si interrogano una volta sola, indipendenti dai temi.
    prova("arxiv", fonti.arxiv, CATEGORIE_ARXIV, massimo_per_fonte)
    prova("standard_ebooks", fonti.standard_ebooks)

    # Fonti a interrogazione libera: una chiamata per tema, con i suoi termini forti.
    for tema in temi:
        termini = termini_di_ricerca(tema, quanti=5)
        if not termini:
            continue
        prova(f"openalex[{tema}]", fonti.openalex, da, a, termini, massimo_per_fonte)
        prova(f"doaj[{tema}]", fonti.doaj, termini, da, massimo_per_fonte)
        prova(f"crossref[{tema}]", fonti.crossref, termini, da, massimo_per_fonte)
        prova(f"zenodo[{tema}]", fonti.zenodo, termini, da, max(20, massimo_per_fonte // 2))
        # Europe PMC solo dove la biomedicina è pertinente: altrove restituisce rumore.
        if tema in ("epidemiologia", "salute_digitale", "statistica"):
            prova(f"europepmc[{tema}]", fonti.europepmc, termini, da, massimo_per_fonte)
        # I libri aperti non escono ogni giorno: si interrogano su finestre lunghe.
        if tema in ("statistica", "modellazione", "meal", "gdpr"):
            prova(f"doab[{tema}]", fonti.doab, termini[:2], 20)

    return grezzo


def setaccia(grezzo, esclusioni, visti, da):
    """Deduplica, scarta il rumore, classifica. Restituisce (nuove, scartate)."""
    per_chiave = {}
    scartate = {"rumore": 0, "non_pubblicazione": 0, "senza_tema": 0,
                "gia_viste": 0, "fuori_finestra": 0, "duplicate": 0}

    for v in grezzo:
        chiave = v["chiave"]

        if not e_pubblicazione(v["titolo"]):
            scartate["non_pubblicazione"] += 1
            continue
        if e_rumore(v["titolo"], esclusioni):
            scartate["rumore"] += 1
            continue
        # Alcune fonti ignorano il filtro di data: lo riapplichiamo qui, dove
        # la forma della voce è già normalizzata. I libri di pubblico dominio
        # non hanno data d'uscita utile e restano.
        if v.get("data") and v["data"] < da and v["tipo"] != "libro":
            scartate["fuori_finestra"] += 1
            continue
        if chiave in visti:
            scartate["gia_viste"] += 1
            continue

        if chiave in per_chiave:
            scartate["duplicate"] += 1
            # Fra due copie tiene quella con il testo pieno, poi quella con l'abstract:
            # la stessa voce arriva da più archivi con completezza diversa.
            vecchia = per_chiave[chiave]
            punteggio = lambda x: (bool(x.get("url_pdf")), len(x.get("abstract") or ""))
            if punteggio(v) > punteggio(vecchia):
                v["fonte"] = f"{v['fonte']}+{vecchia['fonte']}"
                per_chiave[chiave] = v
            else:
                vecchia["fonte"] = f"{vecchia['fonte']}+{v['fonte']}"
            continue

        per_chiave[chiave] = v

    nuove = []
    for v in per_chiave.values():
        temi = classifica(v["titolo"], v.get("abstract", ""), v.get("concetti", ()))
        if not temi:
            scartate["senza_tema"] += 1
            continue
        v["temi"] = [t for t, _ in temi]
        v["punteggi"] = {t: p for t, p in temi}
        v["tema_slug"] = temi[0][0]
        v["trimestre"] = trimestre_di(temi[0][0])
        v["rilevanza"] = round(sum(p for _, p in temi), 3)
        nuove.append(v)

    # Ordine deterministico: rilevanza, poi data recente, poi chiave.
    nuove.sort(key=lambda x: (-x["rilevanza"], x.get("data") or "", x["chiave"]), reverse=False)
    nuove.sort(key=lambda x: -x["rilevanza"])
    return nuove, scartate


def scrivi_catalogo(cartella, nuove, scartate, rapporto_fonti, da, a):
    """Quattro uscite: catalogo completo, indice leggibile, manifesto, rapporto."""
    os.makedirs(cartella, exist_ok=True)

    storico = carica_json(os.path.join(cartella, "catalogo.json"), [])
    esistenti = {v["chiave"] for v in storico}
    storico.extend(v for v in nuove if v["chiave"] not in esistenti)
    storico.sort(key=lambda x: (x.get("data") or "0000-00-00", x["chiave"]), reverse=True)
    scrivi_json(os.path.join(cartella, "catalogo.json"), storico)

    # Manifesto nella forma di scarica_biblioteca.py, così le voci con testo
    # pieno aperto si importano da Libreria > Importa biblioteca senza conversioni.
    manifesto = [{
        "codice": "NUO-" + v["chiave"].split(":", 1)[1][:40],
        "titolo": v["titolo"],
        "autore": ", ".join(v["autori"][:3]) or (v.get("editore") or "—"),
        "tema_slug": v["tema_slug"],
        "trimestre": v["trimestre"],
        "licenza": v.get("licenza") or "da verificare sulla scheda",
        "url": v.get("url_pdf") or v["url"],
        "formato": "pdf" if v.get("url_pdf") else "html",
        "nota": (v.get("abstract") or "")[:280],
    } for v in storico if v.get("url_pdf") or v.get("url")]
    scrivi_json(os.path.join(cartella, "manifesto.json"), manifesto)

    per_tema = {}
    for v in nuove:
        per_tema.setdefault(v["tema_slug"], []).append(v)

    righe = [f"# Nuove uscite — {a}", "",
             f"Finestra: dal {da} al {a}. Voci nuove: {len(nuove)}. Catalogo complessivo: {len(storico)}.", ""]
    for tema in sorted(per_tema, key=lambda t: (trimestre_di(t) or "Z", t)):
        voci = per_tema[tema]
        righe += [f"## {nome_di(tema)} — {trimestre_di(tema)} ({len(voci)})", ""]
        for v in voci:
            autori = ", ".join(v["autori"][:3]) + (" et al." if len(v["autori"]) > 3 else "")
            collegamento = v.get("url_pdf") or v["url"]
            pieno = " · **testo pieno**" if v.get("url_pdf") else ""
            righe.append(f"- [{v['titolo']}]({collegamento}) — {autori or v.get('editore') or '—'}"
                         f" · {v.get('data') or 's.d.'} · {v['fonte']}{pieno}")
        righe.append("")

    with open(os.path.join(cartella, "catalogo.md"), "w", encoding="utf-8") as f:
        f.write("\n".join(righe) + "\n")

    ok = [r for r in rapporto_fonti if r[1] == "ok"]
    ko = [r for r in rapporto_fonti if r[1] != "ok"]
    rapporto = [f"Rassegna — {time.strftime('%Y-%m-%d %H:%M')} UTC", "",
                f"Finestra        : {da} → {a}",
                f"Fonti riuscite  : {len(ok)}/{len(rapporto_fonti)}",
                f"Voci grezze     : {sum(r[3] for r in ok)}",
                f"Voci nuove      : {len(nuove)}",
                f"Catalogo totale : {len(storico)}", "",
                "SCARTATE:"] + [f"  {k:<18} {n}" for k, n in sorted(scartate.items())] + [""]
    if ko:
        rapporto += ["FONTI NON DISPONIBILI (la rassegna è proseguita senza):"]
        rapporto += [f"  {n:<26} {stato}: {msg}" for n, stato, msg, _, _ in ko] + [""]
    rapporto += ["TEMPI PER FONTE (secondi):"]
    rapporto += [f"  {n:<26} {d:6.1f}  {c} voci" for n, _, _, c, d in
                 sorted(rapporto_fonti, key=lambda r: -r[4])[:15]]

    with open(os.path.join(cartella, "rapporto.txt"), "w", encoding="utf-8") as f:
        f.write("\n".join(rapporto) + "\n")

    return storico


def dati_di_prova():
    """Voci finte per la prova senza rete: verificano setaccio e classificazione."""
    return [
        fonti.voce("Causal inference with time-varying confounding in cholera surveillance",
                   "prova", "https://example.org/a", doi="10.1000/a", data=time.strftime("%Y-%m-%d"),
                   autori=["Rossi, M."], abstract="A study of causal inference and outbreak detection.",
                   concetti=["Causal inference", "Epidemiology"], url_pdf="https://example.org/a.pdf"),
        fonti.voce("Causal inference with time-varying confounding in cholera surveillance",
                   "prova2", "https://example.org/dup", doi="10.1000/a", data=time.strftime("%Y-%m-%d")),
        fonti.voce("Retracted: an earlier study", "prova", "https://example.org/r"),
        fonti.voce("Top 10 best tools for data teams", "prova", "https://example.org/n"),
        fonti.voce("Query optimization for columnar storage engines", "prova",
                   "https://example.org/q", doi="10.1000/q", data=time.strftime("%Y-%m-%d"),
                   abstract="Execution plan and cardinality estimation in a vectorized execution engine."),
        fonti.voce("Un titolo senza alcun tema riconoscibile", "prova", "https://example.org/x",
                   doi="10.1000/x", data=time.strftime("%Y-%m-%d")),
    ]


def main():
    p = argparse.ArgumentParser(description=__doc__,
                                formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--cartella", default="rassegna")
    p.add_argument("--giorni", type=int, default=1, help="ampiezza della finestra")
    p.add_argument("--temi", nargs="*", default=None, help="limita a questi tema_slug")
    p.add_argument("--massimo-per-fonte", type=int, default=60)
    p.add_argument("--prova", action="store_true", help="nessuna rete: dati finti")
    a = p.parse_args()

    temi = a.temi or list(SPECIALIZZAZIONI)
    ignoti = [t for t in temi if t not in SPECIALIZZAZIONI]
    if ignoti:
        p.error(f"temi sconosciuti: {', '.join(ignoti)}")
    temi = temi[:TEMI_PER_CORSA]

    da, fino = finestra(a.giorni)
    esclusioni = carica_json(ESCLUSIONI, [])
    visti = set(carica_json(os.path.join(a.cartella, "visti.json"), []))

    print(f"Rassegna {da} → {fino} · {len(temi)} temi · {len(visti)} voci già viste")

    rapporto_fonti = []
    if a.prova:
        grezzo = dati_di_prova()
        rapporto_fonti.append(("prova", "ok", "", len(grezzo), 0.0))
    else:
        grezzo = raccogli(da, fino, temi, rapporto_fonti, a.massimo_per_fonte)

    nuove, scartate = setaccia(grezzo, esclusioni, visti, da)
    storico = scrivi_catalogo(a.cartella, nuove, scartate, rapporto_fonti, da, fino)

    visti.update(v["chiave"] for v in grezzo)
    scrivi_json(os.path.join(a.cartella, "visti.json"), sorted(visti))

    riusciti = sum(1 for r in rapporto_fonti if r[1] == "ok")
    print(f"Fonti {riusciti}/{len(rapporto_fonti)} · grezze {len(grezzo)} · "
          f"nuove {len(nuove)} · catalogo {len(storico)}")
    for chiave, numero in sorted(scartate.items()):
        if numero:
            print(f"  scartate {chiave}: {numero}")

    # Nessuna fonte raggiungibile non è "nessuna novità": è un guasto da vedere.
    if not a.prova and riusciti == 0:
        print("ERRORE: nessuna fonte ha risposto.", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
