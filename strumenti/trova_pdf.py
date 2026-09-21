#!/usr/bin/env python3
"""Trova il vero indirizzo del PDF partendo dalla pagina che lo presenta.

    python3 trova_pdf.py                 # tutte le voci 'pdf' del catalogo
    python3 trova_pdf.py BIB-09 BIB-13   # solo queste

Perché esiste. La corsa del 21/09/2026 ha detto "Scaricati 0 · falliti 19":
tutti e diciannove gli indirizzi marcati 'pdf' puntano a una pagina di
presentazione, non a un file. Prima del controllo sulla firma %PDF- quelle
pagine venivano salvate con estensione .pdf e contate come libri scaricati —
tredici su diciannove, e nessuno era vero.

Correggere diciannove indirizzi a memoria sarebbe indovinare diciannove volte.
Questo strumento invece li chiede alla pagina stessa: scarica il documento che
l'indirizzo attuale serve, ne estrae i collegamenti che somigliano a un PDF, e
prova ciascuno leggendone i primi byte. Quello che risponde `%PDF-` è
l'indirizzo giusto, e lo è perché è stato verificato, non perché sembrava.

Va eseguito dove i siti sono raggiungibili: dal contenitore di sviluppo il
proxy nega la CONNECT verso tutti e diciannove. Gira quindi in Actions, nel
workflow biblioteca, subito dopo un download con dei falliti.

Esce sempre con 0: è una diagnosi, non un cancello.
"""
import html
import os
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from biblioteca_aperta import BIBLIOTECA

UA = "Mozilla/5.0 (compatible; PercorsoLibraryFetcher/1.0)"
TIMEOUT = 30
PAUSA = 1.0
CANDIDATI_MASSIMI = 12          # oltre, si sta rastrellando il sito, non cercando
ASSAGGIO = 2048                 # byte letti per decidere se è un PDF

# Parole che, nel testo del collegamento o nell'indirizzo, indicano il libro
# intero e non un capitolo sciolto o un errata corrige.
BUONE = ("full", "complete", "book", "whole", "entire", "integral", "print",
         "manual", "handbook", "guide", "framework", "final", "testo")
# Parole che indicano quasi sempre la cosa sbagliata.
CATTIVE = ("errata", "solution", "slide", "chapter", "cap-", "exercise",
           "sample", "preview", "toc", "cover", "appendix", "supplement")


def scarica_pagina(url):
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=TIMEOUT) as r:
        return r.read(600_000).decode("utf-8", "replace"), r.geturl()


def collegamenti(documento, base):
    """Gli href che potrebbero essere un PDF, senza duplicati, in ordine di pagina."""
    trovati, visti = [], set()
    for grezzo, testo in re.findall(
            r'<a\b[^>]*href=["\']([^"\']+)["\'][^>]*>(.*?)</a>',
            documento, re.I | re.S):
        indirizzo = html.unescape(grezzo.strip())
        if indirizzo.startswith(("mailto:", "javascript:", "#")):
            continue
        assoluto = urllib.parse.urljoin(base, indirizzo)
        senza_query = assoluto.split("?")[0].lower()
        etichetta = " ".join(re.sub(r"<[^>]+>", " ", testo).split())[:80]
        if not (senza_query.endswith(".pdf") or "pdf" in assoluto.lower()
                or "pdf" in etichetta.lower()):
            continue
        if assoluto in visti:
            continue
        visti.add(assoluto)
        trovati.append((assoluto, etichetta))
    return trovati


def punteggio(indirizzo, etichetta):
    """Più alto = più probabile che sia il libro intero."""
    testo = (indirizzo + " " + etichetta).lower()
    p = 0
    if indirizzo.split("?")[0].lower().endswith(".pdf"):
        p += 3
    p += sum(2 for parola in BUONE if parola in testo)
    p -= sum(3 for parola in CATTIVE if parola in testo)
    return p


def assaggia(url):
    """(vero_pdf, nota). Legge solo i primi byte: non scarica il libro."""
    req = urllib.request.Request(url, headers={"User-Agent": UA,
                                               "Range": f"bytes=0-{ASSAGGIO}"})
    try:
        with urllib.request.urlopen(req, timeout=TIMEOUT) as r:
            testa = r.read(ASSAGGIO)
            tipo = r.headers.get("Content-Type", "")
            lunghezza = r.headers.get("Content-Range") or r.headers.get("Content-Length") or "?"
        if testa.startswith(b"%PDF-"):
            return True, f"{tipo} · {lunghezza}"
        inizio = " ".join(testa[:60].decode("utf-8", "replace").split())
        return False, f"{tipo} · comincia con: {inizio}"
    except urllib.error.HTTPError as e:
        return False, f"HTTP {e.code}"
    except Exception as e:
        return False, type(e).__name__


def esamina(codice, titolo, url):
    print(f"\n{'=' * 74}\n{codice}  {titolo}\n  attuale: {url}")

    # Prima l'ovvio: forse l'indirizzo attuale è già un PDF e falliva per altro.
    diretto, nota = assaggia(url)
    if diretto:
        print(f"  L'indirizzo attuale È un PDF ({nota}). Il guasto è altrove.")
        return url

    print(f"  non è un PDF: {nota}")
    try:
        documento, arrivo = scarica_pagina(url)
    except Exception as e:
        print(f"  la pagina non si apre: {type(e).__name__}: {e}")
        return None
    if arrivo != url:
        print(f"  arrivato a: {arrivo}")

    trovati = collegamenti(documento, arrivo)
    if not trovati:
        print("  nessun collegamento che somigli a un PDF in questa pagina.")
        return None

    trovati.sort(key=lambda c: -punteggio(*c))
    print(f"  {len(trovati)} candidati, provo i primi {min(len(trovati), CANDIDATI_MASSIMI)}:")
    vincitore = None
    for indirizzo, etichetta in trovati[:CANDIDATI_MASSIMI]:
        time.sleep(PAUSA)
        vero, nota = assaggia(indirizzo)
        segno = "PDF " if vero else "  - "
        print(f"    {segno} [{punteggio(indirizzo, etichetta):+d}] {indirizzo[:96]}")
        print(f"          {etichetta or '(senza testo)'} · {nota[:80]}")
        if vero and vincitore is None:
            vincitore = indirizzo
    return vincitore


def main():
    chiesti = [c.upper() for c in sys.argv[1:]]
    voci = [(t[0], t[1], t[6]) for t in BIBLIOTECA
            if t[7] == "pdf" and (not chiesti or t[0] in chiesti)]
    print(f"Ricerca degli indirizzi veri — {time.strftime('%Y-%m-%d %H:%M:%S')} UTC")
    print(f"{len(voci)} voci marcate 'pdf'.")

    vinti = {}
    for codice, titolo, url in voci:
        try:
            esito = esamina(codice, titolo, url)
        except Exception as e:                  # una voce rotta non ferma le altre
            print(f"  errore inatteso: {type(e).__name__}: {e}")
            esito = None
        if esito:
            vinti[codice] = esito
        time.sleep(PAUSA)

    print(f"\n{'=' * 74}\nTrovati {len(vinti)} indirizzi verificati su {len(voci)}.\n")
    for codice, indirizzo in vinti.items():
        print(f'  {codice}  {indirizzo}')
    mancanti = [c for c, _, _ in voci if c not in vinti]
    if mancanti:
        print(f"\nSenza un PDF raggiungibile: {', '.join(mancanti)}")
        print("Per questi il testo non è scaricabile da un indirizzo pubblico diretto:")
        print("vanno spostati a formato 'html' oppure tolti, non lasciati a mentire.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
