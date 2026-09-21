#!/usr/bin/env python3
"""Scarica la biblioteca aperta sul tuo computer.

Da eseguire sul PC, non nel contenitore. Nessuna sottoscrizione, nessun account,
nessun pagamento: solo materiale ad accesso libero con licenza dichiarata.

    python scarica_biblioteca.py --cartella ./biblioteca
    python scarica_biblioteca.py --cartella ./biblioteca --solo T1 T2
    python scarica_biblioteca.py --cartella ./biblioteca --riprova-falliti

Comportamento:
  - riprende i download interrotti (HTTP Range) — pensato per reti instabili
  - backoff esponenziale su errore, 3 tentativi
  - salta i file già completi e verificati
  - calcola lo sha256 di ogni file
  - scrive manifesto.json per l'app e rapporto.txt per te
  - i link che non rispondono NON bloccano il resto: finiscono nel rapporto
"""
import argparse, hashlib, json, os, re, sys, time
import urllib.request, urllib.error

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from biblioteca_aperta import BIBLIOTECA, REPOSITORY

UA = "Mozilla/5.0 (compatible; PercorsoLibraryFetcher/1.0)"
TENTATIVI = 3


def nome_file(codice, titolo, formato):
    base = re.sub(r"[^\w\s-]", "", titolo).strip()
    base = re.sub(r"[\s]+", "_", base)[:70]
    return f"{codice}_{base}.{'pdf' if formato == 'pdf' else 'html'}"


def sha256(percorso, blocco=1 << 20):
    h = hashlib.sha256()
    with open(percorso, "rb") as f:
        for c in iter(lambda: f.read(blocco), b""):
            h.update(c)
    return h.hexdigest()


def e_pdf(percorso):
    """Vero se il file comincia davvero con la firma di un PDF.

    Il Content-Type non basta, in nessuna delle due direzioni: una pagina di
    presentazione può dichiararsi application/octet-stream, e un PDF servito
    male arriva come text/plain. Gli otto byte iniziali invece non mentono.
    """
    try:
        with open(percorso, "rb") as f:
            return f.read(5) == b"%PDF-"
    except OSError:
        return False


def primi_byte(percorso, quanti=90):
    try:
        with open(percorso, "rb") as f:
            testo = f.read(quanti).decode("utf-8", "replace")
    except OSError:
        return ""
    return " ".join(testo.split())


def scarica(url, destinazione):
    """Scarica con ripresa e backoff. Restituisce (ok, messaggio, url_finale)."""
    parziale = destinazione + ".part"
    finale = url
    for tentativo in range(1, TENTATIVI + 1):
        gia = os.path.getsize(parziale) if os.path.exists(parziale) else 0
        req = urllib.request.Request(url, headers={"User-Agent": UA})
        if gia:
            req.add_header("Range", f"bytes={gia}-")
        try:
            with urllib.request.urlopen(req, timeout=60) as r, open(parziale, "ab" if gia else "wb") as f:
                tipo = r.headers.get("Content-Type", "")
                # Dove si è finiti davvero: quasi ogni link rotto di questa
                # biblioteca è un indirizzo che redirige a una pagina di
                # presentazione, e senza l'arrivo non si sa dove correggerlo.
                finale = r.geturl()
                while True:
                    blocco = r.read(1 << 16)
                    if not blocco:
                        break
                    f.write(blocco)
            os.replace(parziale, destinazione)
            return True, tipo, finale
        except urllib.error.HTTPError as e:
            if e.code == 416 and gia:          # già completo
                os.replace(parziale, destinazione)
                return True, "completo", finale
            if e.code in (404, 403, 410):      # inutile insistere
                return False, f"HTTP {e.code}", finale
            errore = f"HTTP {e.code}"
        except Exception as e:
            errore = type(e).__name__
        if tentativo < TENTATIVI:
            time.sleep(2 ** tentativo)
    return False, errore, finale


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--cartella", default="./biblioteca")
    p.add_argument("--solo", nargs="*", default=None, help="filtra per trimestre, es. T1 T2")
    p.add_argument("--riprova-falliti", action="store_true")
    p.add_argument("--includi-html", action="store_true",
                   help="salva anche la pagina indice dei libri solo-web")
    a = p.parse_args()

    os.makedirs(a.cartella, exist_ok=True)
    manifesto_path = os.path.join(a.cartella, "manifesto.json")
    manifesto = {}
    if os.path.exists(manifesto_path):
        with open(manifesto_path, encoding="utf-8") as f:
            manifesto = {v["codice"]: v for v in json.load(f)}

    voci = [v for v in BIBLIOTECA if not a.solo or v[4] in a.solo]
    scaricati, saltati, falliti, solo_web = [], [], [], []

    for codice, titolo, autore, tema, trim, licenza, url, formato, nota in voci:
        if formato == "hub":
            continue
        if formato == "html" and not a.includi_html:
            solo_web.append((codice, titolo, url))
            continue

        dest = os.path.join(a.cartella, nome_file(codice, titolo, formato))
        vecchio = manifesto.get(codice)
        # Si salta solo ciò che è già buono davvero. Un manifesto scritto prima
        # del controllo sulla firma può contenere pagine HTML salvate come .pdf:
        # fidarsi della sua sola presenza le renderebbe permanenti.
        gia_buono = (os.path.exists(dest) and vecchio and vecchio.get("sha256")
                     and (formato != "pdf" or e_pdf(dest)))
        if gia_buono and not a.riprova_falliti:
            saltati.append(codice)
            continue

        print(f"  {codice}  {titolo[:58]:<58}", end=" ", flush=True)
        ok, msg, finale = scarica(url, dest)
        byte = os.path.getsize(dest) if os.path.exists(dest) else 0

        # Tre condizioni, non una. Prima c'era solo la dimensione, e una pagina
        # di presentazione di 150 KB salvata con estensione .pdf passava per un
        # libro scaricato: finiva nel manifesto, l'app la importava, e il guasto
        # si scopriva aprendola — in viaggio, senza rete per rimediare. Un link
        # rotto che lo dice qui vale mille volte un libro finto che tace.
        if not ok:
            motivo = msg
        elif byte <= 1024:
            motivo = f"troppo corto ({byte} byte, {msg})"
        elif formato == "pdf" and not e_pdf(dest):
            motivo = f"non è un PDF ({msg}) — comincia con: {primi_byte(dest)}"
        else:
            motivo = None

        if motivo is None:
            h = sha256(dest)
            manifesto[codice] = dict(codice=codice, titolo=titolo, autore=autore,
                                     tema_slug=tema, trimestre=trim, licenza=licenza,
                                     url=url, formato=formato, nota=nota,
                                     file=os.path.basename(dest),
                                     byte=byte, sha256=h)
            print(f"OK  {byte/1024:.0f} KB")
            scaricati.append(codice)
        else:
            # Via il file e via la voce vecchia: un manifesto che indica un file
            # che non c'è più, o che non è quello che dice, è peggio del vuoto.
            if os.path.exists(dest):
                os.remove(dest)
            manifesto.pop(codice, None)
            print(f"FALLITO ({motivo[:72]})")
            falliti.append((codice, titolo, url, motivo, finale))

    with open(manifesto_path, "w", encoding="utf-8") as f:
        json.dump(list(manifesto.values()), f, ensure_ascii=False, indent=1)

    rapporto = [f"Biblioteca aperta — {time.strftime('%Y-%m-%d %H:%M')}", "",
                f"Scaricati : {len(scaricati)}", f"Già presenti : {len(saltati)}",
                f"Falliti : {len(falliti)}", f"Solo web (da stampare in PDF) : {len(solo_web)}", ""]
    if falliti:
        rapporto += ["LINK DA CONTROLLARE A MANO:"]
        for c, t, u, m, fin in falliti:
            rapporto += [f"  {c}  {t}", f"      chiesto : {u}", f"      motivo  : {m}"]
            if fin and fin != u:
                rapporto += [f"      arrivato: {fin}"]
        rapporto += [""]
    if solo_web:
        rapporto += ["LIBRI WEB — aprire nel browser e usare Stampa → Salva come PDF,",
                     "oppure:  wget --mirror --convert-links --page-requisites <url>", ""]
        rapporto += [f"  {c}  {t}\n      {u}" for c, t, u in solo_web] + [""]
    rapporto += ["REPOSITORY DA CONSULTARE (non scaricabili in blocco):"]
    rapporto += [f"  {c}  {n}\n      {u}\n      {d}" for c, n, u, d in REPOSITORY]

    with open(os.path.join(a.cartella, "rapporto.txt"), "w", encoding="utf-8") as f:
        f.write("\n".join(rapporto) + "\n")

    # Un codice per riga, per chi viene dopo: il rapporto è fatto per essere
    # letto da una persona, questo per essere passato a trova_pdf.py senza
    # doverlo ritagliare con una espressione regolare fragile.
    with open(os.path.join(a.cartella, "falliti.txt"), "w", encoding="utf-8") as f:
        f.write("".join(f"{c}\n" for c, _, _, _, _ in falliti))

    print(f"\nScaricati {len(scaricati)} · già presenti {len(saltati)} · falliti {len(falliti)} · solo web {len(solo_web)}")
    print(f"Manifesto : {manifesto_path}")
    print(f"Rapporto  : {os.path.join(a.cartella, 'rapporto.txt')}")
    if falliti:
        print("\nAlcuni link non hanno risposto: sono nel rapporto, da controllare a mano.")


if __name__ == "__main__":
    main()
