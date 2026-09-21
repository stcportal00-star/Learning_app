#!/usr/bin/env python3
"""Verifica della biblioteca aperta. Nessuna rete: solo ciò che è sempre vero.

    python3 verifica_biblioteca.py

Esiste per un guasto preciso, trovato nella corsa del 21/09/2026. Lo scaricatore
leggeva il Content-Type della risposta e poi non lo guardava: l'unico controllo
era `dimensione > 1024`. Una pagina di presentazione di centocinquanta kilobyte,
salvata con estensione .pdf, passava per un libro scaricato, entrava nel
manifesto con il suo sha256 e l'app la importava come gli altri. Il guasto si
scopriva aprendola — in viaggio, senza rete per rimediare.

La corsa successiva, col controllo sulla firma acceso, ha detto: "Scaricati 0 ·
falliti 19". Tutti. I sei segnalati come rotti erano gli onesti; gli altri
tredici erano pagine di presentazione che passavano per libri — compreso un
"Causal Inference: What If" da 2,6 MB che era HTML.

La biblioteca non ha mai contenuto un solo PDF vero. Per questo i test qui non
si fidano di nessun conteggio: si fidano solo dei primi cinque byte.
"""
import json
import os
import re
import sys
import tempfile

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from biblioteca_aperta import BIBLIOTECA
import scarica_biblioteca as scaricatore

RADICE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

ok, ko = 0, []


def verifica(nome, condizione):
    global ok
    if condizione:
        ok += 1
    else:
        ko.append(nome)


# ------------------------------------------------- la firma di un PDF non mente
with tempfile.TemporaryDirectory() as tmp:
    vero = os.path.join(tmp, "vero.pdf")
    with open(vero, "wb") as f:
        f.write(b"%PDF-1.7\n1 0 obj\n<< /Type /Catalog >>\n")
    verifica("un PDF vero è riconosciuto", scaricatore.e_pdf(vero))

    # Esattamente il caso che passava prima: HTML grande con estensione .pdf.
    finto = os.path.join(tmp, "finto.pdf")
    with open(finto, "wb") as f:
        f.write(b"<!DOCTYPE html>\n<html><head><title>Download the book</title>"
                + b"<p>lorem ipsum</p>" * 8000 + b"</html>")
    verifica("una pagina HTML salvata come .pdf non è un PDF",
             not scaricatore.e_pdf(finto))
    verifica("la pagina finta supera il vecchio controllo sulla dimensione",
             os.path.getsize(finto) > 1024)
    verifica("i primi byte della pagina finta dicono cos'è davvero",
             "<!DOCTYPE html>" in scaricatore.primi_byte(finto))

    verifica("un file inesistente non è un PDF",
             not scaricatore.e_pdf(os.path.join(tmp, "non-esiste.pdf")))
    verifica("un file vuoto non è un PDF",
             not scaricatore.e_pdf(
                 open(os.path.join(tmp, "vuoto.pdf"), "wb").close()
                 or os.path.join(tmp, "vuoto.pdf")))

# --------------------------------------------- il manifesto rifiuta ciò che non è
_src = open(os.path.join(os.path.dirname(os.path.abspath(__file__)),
                         "scarica_biblioteca.py"), encoding="utf-8").read()
verifica("il manifesto si scrive solo dopo il controllo sulla firma",
         'formato == "pdf" and not e_pdf(dest)' in _src)
verifica("una voce respinta viene tolta dal manifesto, non lasciata invecchiare",
         "manifesto.pop(codice, None)" in _src)
# Un manifesto scritto prima di questo controllo può contenere pagine HTML:
# fidarsi della loro sola presenza le renderebbe permanenti.
verifica("ciò che era già in cartella viene ricontrollato, non creduto",
         'formato != "pdf" or e_pdf(dest)' in _src)
verifica("il rapporto dice dove è arrivata la richiesta dopo i redirect",
         "arrivato:" in _src and "r.geturl()" in _src)

# --------------------------------------- il cercatore di indirizzi veri
# Diciannove indirizzi sbagliati non si correggono a memoria: è indovinare
# diciannove volte. Il cercatore li chiede alla pagina che li presenta e prova
# ogni candidato leggendone i primi byte.
import trova_pdf

_doc = """<a href="/book/os4.pdf">Download the full book (PDF)</a>
<a href="errata.pdf">Errata (PDF)</a>
<a href="https://x.org/ch1.pdf">Chapter 1 (PDF)</a>
<a href="/style.css">foglio di stile</a>
<a href="#alto">torna su</a>
<a href="mailto:a@b.c">scrivici</a>"""
_base = "https://www.openintro.org/book/os/"
_trovati = trova_pdf.collegamenti(_doc, _base)
_indirizzi = [u for u, _ in _trovati]

verifica("gli href relativi diventano assoluti",
         "https://www.openintro.org/book/os4.pdf" in _indirizzi)
verifica("gli href gia assoluti restano", "https://x.org/ch1.pdf" in _indirizzi)
verifica("cio che non somiglia a un PDF e scartato",
         not any("style.css" in u for u in _indirizzi))
verifica("le ancore interne sono scartate", not any(u.endswith("#alto") for u in _indirizzi))
verifica("mailto e scartato", not any(u.startswith("mailto:") for u in _indirizzi))

_ordinati = sorted(_trovati, key=lambda c: -trova_pdf.punteggio(*c))
verifica("il libro intero viene prima dell'errata e dei capitoli",
         _ordinati[0][0].endswith("os4.pdf"))
verifica("l'errata e penalizzata",
         trova_pdf.punteggio("https://x.org/errata.pdf", "Errata")
         < trova_pdf.punteggio("https://x.org/full.pdf", "Full book"))
verifica("un capitolo e penalizzato",
         trova_pdf.punteggio("https://x.org/chapter3.pdf", "Chapter 3")
         < trova_pdf.punteggio("https://x.org/book.pdf", "Complete book"))

_doppio = trova_pdf.collegamenti(
    '<a href="/a.pdf">uno</a><a href="/a.pdf">due</a>', "https://x.org/")
verifica("un indirizzo ripetuto conta una volta sola", len(_doppio) == 1)

# Verificare che sia un PDF non dice che sia IL PDF. La prima versione ha
# proposto la traduzione araba del framework NIST e il rapporto annuale OWASP
# al posto della Top 10: erano PDF veri, e nessuno dei due era il testo chiesto.
_owasp = "OWASP Top 10 for LLM Applications"
verifica("il documento giusto batte un altro PDF dello stesso editore",
         trova_pdf.punteggio("https://owasp.org/OWASP-Top-10-for-LLM-Applications.pdf",
                             "Top 10 for LLM", _owasp)
         > trova_pdf.punteggio("https://owasp.org/OWASP-Impact-Report-2025.pdf",
                               "Impact Report", _owasp))
_nist = "NIST AI Risk Management Framework 1.0"
verifica("l'originale batte la traduzione",
         trova_pdf.punteggio("https://nvlpubs.nist.gov/NIST.AI.100-1.pdf", "AI RMF", _nist)
         > trova_pdf.punteggio("https://nvlpubs.nist.gov/NIST.AI.100-1.ara.pdf",
                               "AI RMF", _nist))
verifica("una traduzione è penalizzata anche senza titolo di riferimento",
         trova_pdf.punteggio("https://x.org/doc.spa.pdf", "doc") < 0)
verifica("le parole del titolo pesano più delle parole generiche",
         trova_pdf.punteggio("https://x.org/cybersecurity-framework.pdf", "",
                             "Cybersecurity Framework")
         > trova_pdf.punteggio("https://x.org/complete-book.pdf", "Complete book",
                               "Cybersecurity Framework"))
verifica("le parole vuote del titolo non contano",
         "the" not in trova_pdf.parole_del_titolo("The Effect and the Practice"))
verifica("i numeri di versione del titolo contano",
         "800-61" in trova_pdf.parole_del_titolo("NIST SP 800-61 Incident Handling"))

# Il cercatore propone, non decide: restituisce ogni PDF verificato perché la
# scelta finale vada rivista da chi conosce il titolo.
_trova_src = open(os.path.join(os.path.dirname(os.path.abspath(__file__)),
                               "trova_pdf.py"), encoding="utf-8").read()
verifica("il cercatore restituisce tutte le vie verificate, non solo la prima",
         "deposito.append(indirizzo)" in _trova_src)

# Aritmetica contro aritmetica non decide: sulla pagina NIST il collegamento
# arabo porta l'etichetta descrittiva e l'originale è nudo, quindi quattro
# parole del titolo a +4 superano gli otto punti di penalità. Serve una regola.
_nist_tit = "NIST AI Risk Management Framework 1.0"
verifica("una traduzione è esclusa, non solo penalizzata",
         trova_pdf.tradotto("https://nvlpubs.nist.gov/ai/NIST.AI.100-1.ara.pdf",
                            "AI Risk Management Framework (Arabic)"))
verifica("l'originale non è scambiato per una traduzione",
         not trova_pdf.tradotto("https://nvlpubs.nist.gov/ai/NIST.AI.100-1.pdf", ""))
verifica("l'italiano non è una traduzione da escludere",
         not trova_pdf.tradotto("https://x.org/doc.ita.pdf", "versione italiana"))
verifica("la traduzione vincerebbe ancora sui soli punti",
         trova_pdf.punteggio("https://nvlpubs.nist.gov/ai/NIST.AI.100-1.ara.pdf",
                             "AI Risk Management Framework (Arabic)", _nist_tit)
         > trova_pdf.punteggio("https://nvlpubs.nist.gov/ai/NIST.AI.100-1.pdf",
                               "", _nist_tit))

# Il nome dell'host fa combaciare ogni documento dello stesso editore.
verifica("l'host non conta fra le parole combacianti",
         trova_pdf.parole_combacianti("https://nvlpubs.nist.gov/x/qualunque.pdf",
                                      "", "NIST Cybersecurity Framework 2.0") == 0)
verifica("il percorso conta fra le parole combacianti",
         trova_pdf.parole_combacianti("https://x.org/cybersecurity-framework-2.0.pdf",
                                      "", "NIST Cybersecurity Framework 2.0") >= 2)

# Meglio "nessun candidato convincente" che il documento sbagliato: il primo si
# corregge, il secondo finisce in biblioteca e ci resta.
_owasp = "OWASP Top 10 for LLM Applications"
verifica("un altro documento dello stesso editore non è convincente",
         not trova_pdf.convincente("https://owasp.org/docs/OWASP-Foundation-Strategic-Plan.pdf",
                                   "Strategic Plan", _owasp))
verifica("il documento giusto è convincente",
         trova_pdf.convincente("https://owasp.org/x/OWASP-Top-10-for-LLM.pdf",
                               "Top 10 for LLM Applications", _owasp))
# Ma i deboli non si buttano: NIST.AI.100-1.pdf non contiene una sola parola del
# suo titolo, ed è comunque l'originale che si cercava.
verifica("un documento identificato da un codice risulta debole, non assente",
         not trova_pdf.convincente("https://nvlpubs.nist.gov/ai/NIST.AI.100-1.pdf",
                                   "", _nist_tit))
verifica("i deboli vengono provati se nessun credibile regge",
         "gruppo, deposito in ((buoni, verificati), (deboli, incerti))" in _trova_src)
verifica("il riepilogo marca i deboli invece di spacciarli per proposte",
         "DEBOLE" in _trova_src)
verifica("ciò che viene scartato viene dichiarato",
         "scartati perché traduzioni" in _trova_src
         and "scartati perché non somigliano al titolo" in _trova_src)
verifica("il riepilogo dichiara che sono proposte da rivedere",
         "PROPOSTE, non decisioni" in open(
             os.path.join(os.path.dirname(os.path.abspath(__file__)),
                          "trova_pdf.py"), encoding="utf-8").read())

verifica("il cercatore legge solo un assaggio, non scarica il libro",
         trova_pdf.ASSAGGIO <= 8192 and "Range" in _trova_src)
verifica("il cercatore esce sempre con 0", "return 0" in _trova_src)
verifica("lo scaricatore lascia l'elenco dei falliti leggibile da un programma",
         "falliti.txt" in _src)

# --------------------------------------------------- catalogo e copia per l'app
FORMATI = {"pdf", "html", "hub"}
codici = [t[0] for t in BIBLIOTECA]
verifica("nessun codice ripetuto", len(codici) == len(set(codici)))
verifica("ogni voce ha nove campi", all(len(t) == 9 for t in BIBLIOTECA))
verifica("ogni formato è noto", all(t[7] in FORMATI for t in BIBLIOTECA))
verifica("ogni voce dichiara una licenza", all(t[5].strip() for t in BIBLIOTECA))
verifica("ogni indirizzo è http(s)",
         all(t[6].startswith("http://") or t[6].startswith("https://") for t in BIBLIOTECA))

# La copia che l'app legge e quella che lo scaricatore usa devono dire la stessa
# cosa: se divergono, il manifesto indica un testo e la scheda un altro.
with open(os.path.join(RADICE, "assets", "contenuti", "biblioteca.json"),
          encoding="utf-8") as f:
    json_app = {v["codice"]: v for v in json.load(f)}
verifica("la copia dell'app ha le stesse voci del catalogo",
         set(json_app) == set(codici))
for t in BIBLIOTECA:
    v = json_app.get(t[0])
    if not v:
        continue
    verifica(f"{t[0]}: stesso indirizzo nelle due copie", v["url"] == t[6])
    verifica(f"{t[0]}: stesso formato nelle due copie", v["formato"] == t[7])
    verifica(f"{t[0]}: stesso tema nelle due copie", v["tema_slug"] == t[3])

# ------------------------------------------------- EUR-Lex: una regola, non tre
# L'indirizzo ELI serve la pagina del Gazzettino in HTML — è per questo che i
# tre testi normativi tornavano text/html. La resa in PDF sta su un altro
# percorso, indicizzato per CELEX, e il CELEX si ricava dall'ELI: settore 3,
# anno, R per il regolamento o L per la direttiva, numero a quattro cifre.
# Questo test riapplica la regola: se un giorno si aggiunge una quarta norma
# scrivendo l'indirizzo a mano, si accorge dell'errore qui e non in viaggio.
#
# Va detto chiaro: il percorso CELEX NON ha ancora risolto il download. La
# corsa delle 18:33 restituisce "0 byte, text/html" per tutti e tre — un
# fallimento diverso dal precedente, ma pur sempre un fallimento. Il test
# garantisce che l'indirizzo sia derivato e non inventato, non che funzioni.
# Se il cercatore troverà l'indirizzo vero, questa regola andrà rivista.
ATTESO = {"BIB-23": ("reg", 2016, 679), "BIB-24": ("reg", 2024, 1689),
          "BIB-25": ("dir", 2022, 2555)}
for codice, (tipo, anno, numero) in ATTESO.items():
    celex = f"3{anno}{'R' if tipo == 'reg' else 'L'}{numero:04d}"
    atteso = f"https://eur-lex.europa.eu/legal-content/IT/TXT/PDF/?uri=CELEX:{celex}"
    reale = next(t[6] for t in BIBLIOTECA if t[0] == codice)
    verifica(f"{codice}: indirizzo PDF derivato dal CELEX {celex}", reale == atteso)

verifica("nessun testo normativo punta più alla pagina ELI",
         not any("/eli/" in t[6] for t in BIBLIOTECA))

# ------------------------------------------------------ nessuna fonte non aperta
indirizzi = " ".join(t[6] for t in BIBLIOTECA).lower()
verifica("nessuna biblioteca ombra fra gli indirizzi",
         not any(o in indirizzi for o in
                 ("bookos", "b-ok", "zlibrary", "z-lib", "libgen", "library.lol",
                  "annas-archive", "sci-hub")))

print(f"Test superati : {ok}")
print(f"Falliti       : {len(ko)}")
for k in ko:
    print(f"  FALLITO: {k}")
sys.exit(1 if ko else 0)
