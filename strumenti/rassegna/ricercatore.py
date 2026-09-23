#!/usr/bin/env python3
"""Ricercatore: cerca una copia legalmente accessibile di un libro o di un articolo.

Interroga in sequenza le biblioteche e gli archivi pubblici e si ferma alla
prima via di accesso utile, dalla più durevole alla più precaria.

    python3 ricercatore.py --titolo "Causal Inference: What If"
    python3 ricercatore.py --doi 10.1038/s41586-024-07487-w
    python3 ricercatore.py --catalogo rassegna/catalogo.json --solo-senza-testo
    python3 ricercatore.py --elenco titoli.txt --uscita trovati.json

Ordine di ricerca, e perché è questo:

  1. DOI → Unpaywall e OpenAlex. Circa metà della letteratura recente ha una
     copia depositata dall'autore o dall'editore in un archivio istituzionale.
     È la stessa copia che si cercherebbe altrove, ma depositata da chi ne ha
     il diritto.
  2. Titolo → Project Gutenberg, DOAB, HathiTrust. Pubblico dominio accertato o
     licenza aperta: si scarica e si tiene, che è ciò che serve per un viaggio
     senza rete.
  3. Titolo → Open Library e Internet Archive. Include il prestito digitale
     controllato: una copia per volta, con restituzione. È un servizio
     bibliotecario, non una distribuzione.
  4. Nulla di tutto ciò → l'indirizzo per la richiesta in biblioteca.

Cosa questo strumento non fa, per scelta: non interroga biblioteche ombra
(Z-Library / bookos, Library Genesis, Anna's Archive e simili). Distribuiscono
opere protette senza titolo, e l'intera biblioteca del progetto è costruita
sulla licenza dichiarata: vedi l'intestazione di `strumenti/biblioteca_aperta.py`.
Una sola voce senza titolo di distribuzione renderebbe inservibile il manifesto
che l'app importa. Le fonti qui elencate coprono la parte legittima della stessa
esigenza; quando non bastano, il punto 4 dice come ottenere il testo davvero.
"""
import argparse
import json
import os
import re
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import fonti_aperte as fonti
from specializzazioni import normalizza

# Vie di accesso, dalla più utile offline alla meno. L'ordine è il valore:
# una copia scaricabile serve in aereo, un prestito no.
QUALITA = {
    "pubblico dominio, scaricabile": 5,
    "libro ad accesso aperto": 5,
    "pubblico dominio, lettura integrale": 4,
    "copia aperta depositata": 4,
    "copia aperta": 4,
    "vista integrale": 3,
    "testo su Internet Archive": 3,
    "prestito bibliotecario (una copia per volta)": 2,
    "accesso riservato a utenti con disabilità di lettura": 1,
    "solo scheda": 1,
    "da richiedere in biblioteca (prestito interbibliotecario)": 0,
}


def cerca(titolo=None, doi=None, isbn=None, fermati_al_primo=True, traccia=None):
    """Restituisce le vie di accesso trovate, la migliore per prima.

    Ogni fonte è isolata: quella che non risponde viene annotata e si prosegue.
    """
    traccia = traccia if traccia is not None else []
    trovate = []

    def prova(nome, funzione, *argomenti, **parole):
        try:
            esito = funzione(*argomenti, **parole)
        except fonti.FonteNonDisponibile as e:
            traccia.append((nome, "non disponibile", str(e)))
            return None
        except Exception as e:
            traccia.append((nome, "errore", f"{type(e).__name__}: {e}"))
            return None
        traccia.append((nome, "ok" if esito else "niente", ""))
        if esito:
            trovate.append(esito)
        return esito

    # 1 — per DOI, la via più diretta e la più affidabile.
    if doi:
        esito = prova("unpaywall", fonti.unpaywall, doi)
        if esito and fermati_al_primo:
            return trovate
    if not doi and titolo:
        scheda = prova("openalex", fonti.openalex_per_titolo, titolo)
        if scheda and scheda.get("doi"):
            doi = scheda["doi"]
            esito = prova("unpaywall", fonti.unpaywall, doi)
            if esito and fermati_al_primo:
                return trovate

    # 2 e 3 — per titolo, nell'ordine dichiarato in fonti_aperte.CATENA_LIBRI.
    if titolo:
        for funzione in fonti.CATENA_LIBRI:
            nome = funzione.__name__
            if funzione is fonti.hathitrust:
                if not isbn:
                    continue
                esito = prova(nome, funzione, titolo, None, isbn)
            else:
                esito = prova(nome, funzione, titolo)
            if esito and fermati_al_primo and QUALITA.get(esito.get("accesso"), 0) >= 4:
                return trovate

    # 4 — nulla di scaricabile: resta la biblioteca.
    if not trovate and titolo:
        trovate.append(fonti.worldcat_scheda(titolo))

    trovate.sort(key=lambda v: -QUALITA.get(v.get("accesso"), 0))
    return trovate


def voci_da_catalogo(percorso, solo_senza_testo):
    with open(percorso, encoding="utf-8") as f:
        catalogo = json.load(f)
    for v in catalogo:
        if solo_senza_testo and v.get("url_pdf"):
            continue
        yield {"titolo": v.get("titolo"), "doi": v.get("doi"), "isbn": None,
               "tema_slug": v.get("tema_slug"), "trimestre": v.get("trimestre")}


def voci_da_elenco(percorso):
    """Un titolo per riga. Riga che inizia con 'doi:' o '10.' trattata come DOI."""
    with open(percorso, encoding="utf-8") as f:
        for riga in f:
            riga = riga.strip()
            if not riga or riga.startswith("#"):
                continue
            if riga.lower().startswith("doi:") or re.match(r"^10\.\d{4,9}/", riga):
                yield {"titolo": None, "doi": re.sub(r"^doi:", "", riga, flags=re.I),
                       "isbn": None, "tema_slug": None, "trimestre": None}
            else:
                yield {"titolo": riga, "doi": None, "isbn": None,
                       "tema_slug": None, "trimestre": None}


def main():
    p = argparse.ArgumentParser(description=__doc__,
                                formatter_class=argparse.RawDescriptionHelpFormatter)
    sorgente = p.add_mutually_exclusive_group(required=True)
    sorgente.add_argument("--titolo")
    sorgente.add_argument("--doi")
    sorgente.add_argument("--catalogo", help="catalogo.json prodotto da catalogo.py")
    sorgente.add_argument("--elenco", help="file di testo, un titolo o DOI per riga")
    p.add_argument("--isbn", default=None)
    p.add_argument("--solo-senza-testo", action="store_true",
                   help="dal catalogo, solo le voci senza testo pieno già noto")
    p.add_argument("--massimo", type=int, default=200, help="quante voci trattare al più")
    # Tetto di tempo, non solo di voci. Ogni voce interroga fino a sei archivi
    # con trenta secondi di attesa ciascuno: il numero di voci non dice quanto
    # durerà. Senza questo tetto la ricerca si è mangiata l'intero job in
    # Actions e la rassegna non è mai arrivata a pubblicare.
    p.add_argument("--minuti", type=float, default=10.0,
                   help="tetto di tempo; 0 per nessun limite")
    p.add_argument("--uscita", default=None, help="scrive l'esito in JSON")
    p.add_argument("--tutte-le-vie", action="store_true",
                   help="non fermarsi alla prima via utile: elencarle tutte")
    a = p.parse_args()

    if a.catalogo:
        voci = list(voci_da_catalogo(a.catalogo, a.solo_senza_testo))
    elif a.elenco:
        voci = list(voci_da_elenco(a.elenco))
    else:
        voci = [{"titolo": a.titolo, "doi": a.doi, "isbn": a.isbn,
                 "tema_slug": None, "trimestre": None}]
    totali = len(voci)
    voci = voci[:a.massimo]
    oltre_massimo = totali - len(voci)

    # Senza recapito, Unpaywall non parte affatto: ogni voce con DOI perde la
    # fonte che da sola risponde alla domanda "esiste una copia aperta di questo
    # articolo?". Il risultato è un elenco di "nulla trovato" che sembra un
    # esito e invece è uno strumento spento. Nella corsa del 21/09/2026 sono
    # state diciannove voci su diciannove, e dal rapporto non si vedeva.
    spente = []
    if not fonti.CONTATTO:
        spente.append("unpaywall (manca PERCORSO_CONTATTO)")
        print("AVVISO: Unpaywall è spento perché manca il recapito PERCORSO_CONTATTO.")
        print("        È la fonte principale per gli articoli con DOI: senza di essa")
        print("        un 'nulla trovato' non significa che non esista una copia aperta.")
        print("        OpenAlex e Crossref rispondono lo stesso, dalla coda comune.\n")

    scadenza = time.monotonic() + a.minuti * 60 if a.minuti > 0 else None
    esiti, senza, interrotto = [], 0, 0
    for indice, v in enumerate(voci, 1):
        if scadenza is not None and time.monotonic() >= scadenza:
            # Ciò che resta non si tace: un elenco troncato in silenzio si legge
            # come un elenco completo, ed è il modo migliore per non accorgersi
            # che metà del catalogo non è mai stata cercata.
            interrotto = len(voci) - indice + 1
            print(f"\nTetto di {a.minuti:g} minuti raggiunto: {interrotto} voci non trattate.")
            break
        etichetta = v["titolo"] or v["doi"] or "(senza riferimento)"
        print(f"[{indice}/{len(voci)}] {etichetta[:70]}", end=" ", flush=True)
        traccia = []
        trovate = cerca(v["titolo"], v["doi"], v["isbn"],
                        fermati_al_primo=not a.tutte_le_vie, traccia=traccia)
        migliore = trovate[0] if trovate else None
        utile = migliore and QUALITA.get(migliore.get("accesso"), 0) > 0
        if not utile:
            senza += 1
        print(f"→ {migliore['accesso'] if migliore else 'nulla'}")

        esiti.append({
            "titolo": v["titolo"], "doi": v["doi"],
            "tema_slug": v.get("tema_slug"), "trimestre": v.get("trimestre"),
            "accesso": migliore.get("accesso") if migliore else None,
            "url": migliore.get("url") if migliore else None,
            "licenza": migliore.get("licenza") if migliore else None,
            "via": migliore.get("via") if migliore else None,
            "alternative": trovate[1:] if a.tutte_le_vie else [],
            "fonti_interrogate": [{"fonte": n, "esito": s, "nota": m} for n, s, m in traccia],
        })

    if a.uscita:
        os.makedirs(os.path.dirname(a.uscita) or ".", exist_ok=True)
        with open(a.uscita, "w", encoding="utf-8") as f:
            json.dump({"generato": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
                       "fonti_spente": spente,
                       "trattate": len(esiti),
                       "non_trattate_per_tempo": interrotto,
                       "non_trattate_per_massimo": oltre_massimo,
                       "voci": esiti}, f, ensure_ascii=False, indent=1)
        print(f"\nEsito in {a.uscita}")

    scaricabili = sum(1 for e in esiti if QUALITA.get(e["accesso"], 0) >= 4)
    print(f"\nTrattate {len(esiti)} di {totali} · scaricabili e conservabili {scaricabili} · "
          f"senza via di accesso {senza}")
    if interrotto or oltre_massimo:
        print(f"Non trattate: {interrotto} per tempo, {oltre_massimo} oltre il massimo.")
    if spente:
        # Ripetuto qui perché è qui che si legge il bilancio: un conteggio di
        # zeri accanto a una fonte spenta non è un risultato, è una misura
        # mancata, e va detto nello stesso punto in cui si vede il numero.
        print(f"Fonti spente in questa corsa: {', '.join(spente)}.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
