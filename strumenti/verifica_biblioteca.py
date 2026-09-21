#!/usr/bin/env python3
"""Verifica della biblioteca aperta. Nessuna rete: solo ciò che è sempre vero.

    python3 verifica_biblioteca.py

Esiste per un guasto preciso, trovato nella corsa del 21/09/2026. Lo scaricatore
leggeva il Content-Type della risposta e poi non lo guardava: l'unico controllo
era `dimensione > 1024`. Una pagina di presentazione di centocinquanta kilobyte,
salvata con estensione .pdf, passava per un libro scaricato, entrava nel
manifesto con il suo sha256 e l'app la importava come gli altri. Il guasto si
scopriva aprendola — in viaggio, senza rete per rimediare.

Sei link su diciannove sono stati segnalati come rotti. Quelli erano onesti.
I pericolosi erano gli altri, che tacevano.
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
