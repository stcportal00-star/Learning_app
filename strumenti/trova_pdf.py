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

# Un altro documento dello stesso editore, che non è quello cercato. La prima
# versione di questo strumento ha proposto l'"OWASP Impact Report 2025" per la
# voce "OWASP Top 10 for LLM Applications": è un PDF, sta su owasp.org, e non
# c'entra niente. Verificare il formato non basta, va verificata l'identità.
ALTRO_DOCUMENTO = ("impact-report", "impact_report", "annual-report",
                   "annual_report", "newsletter", "brochure", "flyer",
                   "poster", "press-release", "factsheet", "one-pager")

# Codici di lingua nel nome del file: NIST pubblica le traduzioni accanto
# all'originale. Non è una penalità, è una esclusione: una penalità numerica non
# basta, e l'ho verificato. Sulla pagina del framework NIST il collegamento
# arabo porta l'etichetta descrittiva "AI Risk Management Framework (Arabic)"
# mentre l'originale è un collegamento nudo: quattro parole del titolo a +4
# l'una superano gli otto punti di penalità, e la traduzione vince lo stesso.
# Aritmetica contro aritmetica non decide. Una regola sì.
#
# Italiano e inglese restano: sono le lingue in cui questo materiale si legge.
# Le lingue in cui questo materiale si legge. Tutto il resto è una traduzione
# che non serve a nessuno qui.
LINGUE_TENUTE = ("eng", "english", "ita", "italian", "italiano")

# I nomi, non solo i codici. La prima versione elencava a mano otto codici
# scelti da me, e la corsa successiva ha proposto per OpenIntro
# "?id=os4_uzbek": l'uzbeco non era nel mio elenco, perché nessun elenco
# scritto a memoria è completo. Questo almeno è una lista di dati, dichiarata
# e allungabile, non un'ipotesi travestita da regola.
LINGUE = (
    "arabic", "spanish", "french", "chinese", "japanese", "korean", "german",
    "portuguese", "russian", "hindi", "turkish", "vietnamese", "indonesian",
    "thai", "persian", "farsi", "urdu", "bengali", "swahili", "ukrainian",
    "polish", "dutch", "greek", "hebrew", "czech", "slovak", "romanian",
    "hungarian", "serbian", "croatian", "bulgarian", "albanian", "armenian",
    "georgian", "azerbaijani", "kazakh", "uzbek", "mongolian", "nepali",
    "sinhala", "tamil", "telugu", "malay", "filipino", "tagalog", "burmese",
    "khmer", "lao", "amharic", "somali", "hausa", "yoruba", "zulu", "afrikaans",
    "danish", "norwegian", "swedish", "finnish", "estonian", "latvian",
    "lithuanian", "slovenian", "macedonian", "bosnian", "catalan", "galician",
    "basque", "welsh", "irish", "icelandic", "maltese", "punjabi", "gujarati",
    "marathi", "kannada", "malayalam", "odia", "assamese", "pashto", "kurdish",
    "tigrinya", "wolof", "shona", "xhosa", "kinyarwanda",
)
# I codici ISO a tre lettere che NIST usa nei nomi dei file: NIST.AI.100-1.ara.pdf
CODICI = ("ara", "spa", "fra", "fre", "zho", "chi", "jpn", "kor", "deu", "ger",
          "por", "rus", "hin", "tur", "vie", "ind", "tha", "fas", "per", "urd",
          "ben", "swa", "ukr", "pol", "nld", "dut", "ell", "gre", "heb", "ces",
          "cze", "ron", "rum", "hun", "srp", "hrv", "bul", "uzb", "kaz", "nep",
          "tam", "tel", "msa", "may", "fil", "mya", "khm", "lao", "amh", "som")

# Un nome di lingua conta solo se è una parola intera: os4_uzbek sì,
# thailand-report no, laos-survey no. Senza il confine anche dopo il nome,
# "thai" sta dentro "thailand" e "lao" dentro "laos", e un falso positivo qui
# scarta un documento buono in silenzio — che è il guasto contro cui esiste
# tutto questo file.
CONFINE = r"(?:^|[_\-./=\s(?&])"
CONFINE_FINE = r"(?=$|[_\-./=\s)?&])"
_LINGUE_RE = re.compile(CONFINE + "(" + "|".join(LINGUE) + ")" + CONFINE_FINE)
_CODICI_RE = re.compile(r"[_\-.](" + "|".join(CODICI) + r")\.")


def tradotto(indirizzo, etichetta):
    """Vero se l'indirizzo o l'etichetta indicano una lingua che non leggiamo."""
    testo = (indirizzo + " " + etichetta).lower()
    if any(tenuta in testo for tenuta in LINGUE_TENUTE):
        return False
    return bool(_LINGUE_RE.search(testo) or _CODICI_RE.search(testo))


def parole_combacianti(indirizzo, etichetta, titolo):
    """Quante parole distintive del titolo compaiono nel candidato.

    Si guarda il percorso e l'etichetta, mai il nome dell'host: nist.gov
    contiene "nist" e openintro.org contiene "openintro", quindi l'host fa
    combaciare ogni documento di quell'editore e non distingue nulla.
    """
    pezzi = urllib.parse.urlsplit(indirizzo)
    testo = (pezzi.path + " " + pezzi.query + " " + etichetta).lower()
    return sum(1 for parola in parole_del_titolo(titolo) if parola in testo)


def convincente(indirizzo, etichetta, titolo):
    """Il candidato è plausibilmente IL documento, non solo un PDF del sito.

    Senza questa soglia il cercatore proponeva il "Piano strategico della
    fondazione OWASP" per la voce "OWASP Top 10 for LLM Applications": è un PDF,
    sta su owasp.org, e la Top 10 su quella pagina non c'è affatto. Meglio dire
    "nessun candidato convincente" che proporre il documento sbagliato: il primo
    lo si corregge, il secondo finisce in biblioteca e ci resta.
    """
    distintive = len(parole_del_titolo(titolo))
    richieste = 2 if distintive >= 2 else max(1, distintive)
    return parole_combacianti(indirizzo, etichetta, titolo) >= richieste

PAROLE_VUOTE = {"the", "and", "for", "with", "una", "del", "della", "delle",
                "dei", "degli", "testo", "integrale", "ediz", "edition",
                "introduction", "principles", "practice"}


def parole_del_titolo(titolo):
    """I termini distintivi del titolo, per riconoscere il documento giusto."""
    grezze = re.findall(r"[a-z0-9][a-z0-9.+-]{2,}", titolo.lower())
    return [p for p in grezze if p not in PAROLE_VUOTE]


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


def punteggio(indirizzo, etichetta, titolo=""):
    """Più alto = più probabile che sia IL documento cercato, intero.

    Due domande distinte, e la seconda è quella che la prima versione di questo
    strumento non faceva: è un PDF? ed è il PDF giusto?
    """
    testo = (indirizzo + " " + etichetta).lower()
    p = 0
    if indirizzo.split("?")[0].lower().endswith(".pdf"):
        p += 3
    p += sum(2 for parola in BUONE if parola in testo)
    p -= sum(3 for parola in CATTIVE if parola in testo)
    p -= sum(6 for parola in ALTRO_DOCUMENTO if parola in testo)
    if tradotto(indirizzo, etichetta):
        p -= 8
    # Le parole del titolo pesano più di tutto il resto: sono l'unico segnale
    # che distingue questo documento dagli altri dello stesso editore.
    for parola in parole_del_titolo(titolo):
        if parola in testo:
            p += 4
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
        return [url]

    print(f"  non è un PDF: {nota}")
    try:
        documento, arrivo = scarica_pagina(url)
    except Exception as e:
        print(f"  la pagina non si apre: {type(e).__name__}: {e}")
        return []
    if arrivo != url:
        print(f"  arrivato a: {arrivo}")

    trovati = collegamenti(documento, arrivo)
    if not trovati:
        print("  nessun collegamento che somigli a un PDF in questa pagina.")
        return []

    # Due setacci prima di spendere una richiesta, e si dice cosa tolgono:
    # scartare in silenzio è il modo migliore per non accorgersi di aver
    # scartato proprio il documento giusto.
    tradotti = [c for c in trovati if tradotto(*c)]
    deboli = [c for c in trovati
              if c not in tradotti and not convincente(c[0], c[1], titolo)]
    buoni = [c for c in trovati if c not in tradotti and c not in deboli]

    if tradotti:
        print(f"  {len(tradotti)} scartati perché traduzioni: "
              f"{', '.join(u.rsplit('/', 1)[-1][:34] for u, _ in tradotti[:4])}")
    if deboli:
        print(f"  {len(deboli)} scartati perché non somigliano al titolo: "
              f"{', '.join(u.rsplit('/', 1)[-1][:34] for u, _ in deboli[:4])}")
    # I deboli non si buttano: si mettono da parte. Un documento identificato da
    # un codice invece che da un nome — NIST.AI.100-1.pdf — non contiene nessuna
    # parola del suo titolo, e scartarlo in silenzio perderebbe proprio
    # l'originale che si stava cercando di preferire alla traduzione. Vengono
    # provati dopo e dichiarati deboli, così chi legge sa cosa sta guardando.
    if not buoni and not deboli:
        print("  nessun candidato: su questa pagina il documento non c'è.")
        return []

    buoni.sort(key=lambda c: -punteggio(c[0], c[1], titolo))
    deboli.sort(key=lambda c: -punteggio(c[0], c[1], titolo))
    print(f"  {len(buoni)} credibili, {len(deboli)} deboli; provo i credibili "
          f"e, solo se nessuno regge, i deboli:")
    verificati, incerti = [], []
    for gruppo, deposito in ((buoni, verificati), (deboli, incerti)):
        for indirizzo, etichetta in gruppo[:CANDIDATI_MASSIMI]:
            time.sleep(PAUSA)
            vero, nota = assaggia(indirizzo)
            segno = "PDF " if vero else "  - "
            print(f"    {segno} [{punteggio(indirizzo, etichetta, titolo):+d}] "
                  f"[{parole_combacianti(indirizzo, etichetta, titolo)} parole] "
                  f"{indirizzo[:76]}")
            print(f"          {etichetta or '(senza testo)'} · {nota[:80]}")
            if vero:
                deposito.append(indirizzo)
        if verificati:          # un candidato credibile basta: i deboli restano fuori
            break
    return [(u, True) for u in verificati] + [(u, False) for u in incerti]


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
            vinti[codice] = (titolo, esito)
        time.sleep(PAUSA)

    print(f"\n{'=' * 74}\nTrovati {len(vinti)} indirizzi verificati su {len(voci)}.")
    print("Sono PROPOSTE, non decisioni: ogni riga va confrontata con il titolo")
    print("prima di finire nel catalogo. Verificare che sia un PDF non dice che")
    print("sia IL PDF giusto — la prima versione di questo strumento ha proposto")
    print("una traduzione araba e il rapporto annuale di un'altra collana.\n")
    for codice, (titolo, indirizzi) in vinti.items():
        print(f"  {codice}  {titolo}")
        for posizione, (indirizzo, credibile) in enumerate(indirizzi[:3]):
            if posizione == 0:
                etichetta = "proposto    " if credibile else "DEBOLE      "
            else:
                etichetta = "alternativa " if credibile else "alt. DEBOLE "
            print(f"       {etichetta} {indirizzo}")
    if any(not c for _, vie in vinti.values() for _, c in vie[:1]):
        print("\n  DEBOLE = il documento è identificato da un codice e non dal titolo,")
        print("  quindi non si può confermare dall'indirizzo. Va aperto e guardato.")
    mancanti = [c for c, _, _ in voci if c not in vinti]
    if mancanti:
        print(f"\nSenza un PDF raggiungibile: {', '.join(mancanti)}")
        print("Per questi il testo non è scaricabile da un indirizzo pubblico diretto:")
        print("vanno spostati a formato 'html' oppure tolti, non lasciati a mentire.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
