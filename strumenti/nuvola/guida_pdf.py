#!/usr/bin/env python3
"""
Genera la guida rapida in PDF che finisce nella biblioteca dell'app.

Esiste per due motivi, e il secondo conta più del primo.

Il primo: serve avere in mano, offline, le poche cose che non si ricordano —
dove tocca la rassegna, cosa fa il pulsante «Ora», cosa succede in aereo.

Il secondo: è il banco di prova della VIA MANUALE. `biblioteca-manuale/` è la
strada con cui un PDF entra nella biblioteca senza passare dall'app, e finché
quella cartella è vuota quella strada è codice che nessuno ha mai percorso.
Questo file la percorre a ogni push: byte magici, caricamento nel deposito,
riga in `biblioteca`, evento nel registro.

Scritto a mano perché un PDF valido e leggibile sta in duecento righe di
libreria standard, e aggiungere `reportlab` per una pagina sarebbe una
dipendenza in più da aggiornare per sempre.

    python3 strumenti/nuvola/guida_pdf.py biblioteca-manuale/guida-percorso.pdf
"""
import sys
import zlib

LARGHEZZA, ALTEZZA = 595, 842  # A4 in punti
MARGINE = 56
CORPO, INTERLINEA = 11, 16
TITOLO_CORPO = 17


def testo_pdf(s):
    """Nel testo PDF parentesi e barre rovesce vanno protette, o il flusso si
    rompe a metà pagina e il lettore mostra una pagina bianca senza dire perché."""
    return s.replace("\\", r"\\").replace("(", r"\(").replace(")", r"\)")


def avvolgi(riga, caratteri):
    """A capo sulle parole. Senza, una riga lunga esce dal foglio e sparisce."""
    if not riga:
        return [""]
    fuori, corrente = [], ""
    for parola in riga.split():
        prova = (corrente + " " + parola).strip()
        if len(prova) <= caratteri:
            corrente = prova
        else:
            if corrente:
                fuori.append(corrente)
            corrente = parola
    if corrente:
        fuori.append(corrente)
    return fuori


def pagine_da(righe, per_pagina=42):
    """Spezza in pagine rispettando i titoli: un titolo in fondo alla pagina,
    con il suo testo su quella dopo, si legge male."""
    pagine, corrente = [], []
    for riga in righe:
        if len(corrente) >= per_pagina:
            pagine.append(corrente)
            corrente = []
        if riga[0] == "titolo" and len(corrente) >= per_pagina - 3:
            pagine.append(corrente)
            corrente = []
        corrente.append(riga)
    if corrente:
        pagine.append(corrente)
    return pagine


def flusso_pagina(righe):
    pezzi = ["BT"]
    y = ALTEZZA - MARGINE
    for genere, testo in righe:
        if genere == "titolo":
            y -= 6
            pezzi.append(f"/F2 {TITOLO_CORPO} Tf")
            pezzi.append(f"1 0 0 1 {MARGINE} {y} Tm ({testo_pdf(testo)}) Tj")
            y -= TITOLO_CORPO + 8
        elif genere == "vuoto":
            y -= INTERLINEA // 2
        else:
            tipo = "/F3" if genere == "codice" else "/F1"
            pezzi.append(f"{tipo} {CORPO} Tf")
            pezzi.append(f"1 0 0 1 {MARGINE} {y} Tm ({testo_pdf(testo)}) Tj")
            y -= INTERLINEA
    pezzi.append("ET")
    # cp1252, non latin-1: è la codifica che WinAnsiEncoding dichiara nei font
    # qui sotto, ed è l'unica che rende insieme le accentate e i trattini
    # lunghi. Con latin-1 e l'encoding predefinito delle Helvetica — che è
    # StandardEncoding, non Latin-1 — «è» usciva come «Ł» e «—» come «?».
    return zlib.compress("\n".join(pezzi).encode("cp1252", "replace"))


def scrivi(percorso, righe):
    pagine = pagine_da(righe)
    oggetti, contenuti = {}, []

    primo_contenuto = 5
    for i, pagina in enumerate(pagine):
        dati = flusso_pagina(pagina)
        oggetti[primo_contenuto + i] = (
            b"<< /Length %d /Filter /FlateDecode >>\nstream\n" % len(dati)
            + dati + b"\nendstream")
        contenuti.append(primo_contenuto + i)

    primo_foglio = primo_contenuto + len(pagine)
    fogli = [primo_foglio + i for i in range(len(pagine))]
    for i, numero in enumerate(fogli):
        oggetti[numero] = (
            b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 %d %d] "
            b"/Resources << /Font << /F1 3 0 R /F2 4 0 R /F3 %d 0 R >> >> "
            b"/Contents %d 0 R >>" % (LARGHEZZA, ALTEZZA, fogli[-1] + 1, contenuti[i]))

    oggetti[1] = b"<< /Type /Catalog /Pages 2 0 R >>"
    oggetti[2] = (b"<< /Type /Pages /Count %d /Kids [%s] >>"
                  % (len(fogli), b" ".join(b"%d 0 R" % n for n in fogli)))
    oggetti[3] = b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>"
    oggetti[4] = b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>"
    oggetti[fogli[-1] + 1] = b"<< /Type /Font /Subtype /Type1 /BaseFont /Courier /Encoding /WinAnsiEncoding >>"

    fuori = bytearray(b"%PDF-1.4\n%\xe2\xe3\xcf\xd3\n")
    posizioni = {}
    for numero in sorted(oggetti):
        posizioni[numero] = len(fuori)
        fuori += b"%d 0 obj\n" % numero + oggetti[numero] + b"\nendobj\n"

    massimo = max(oggetti) + 1
    inizio_tabella = len(fuori)
    fuori += b"xref\n0 %d\n0000000000 65535 f \n" % massimo
    for numero in range(1, massimo):
        fuori += b"%010d 00000 n \n" % posizioni.get(numero, 0)
    fuori += (b"trailer\n<< /Size %d /Root 1 0 R >>\nstartxref\n%d\n%%%%EOF\n"
              % (massimo, inizio_tabella))

    with open(percorso, "wb") as f:
        f.write(bytes(fuori))
    return len(fuori), len(pagine)


GUIDA = """titolo|Percorso — guida rapida
|Quello che non si ricorda, e che serve proprio quando non c'è rete.
vuoto|
titolo|In aereo funziona tutto
|L'app non aspetta mai la rete. Esercizi, lettore PDF, note, ripasso e
|cronometro funzionano identici con la radio spenta. La sincronizzazione è
|un extra: se non c'è, le modifiche restano in coda e salgono da sole al
|primo rientro in rete. Nessuna schermata resta in attesa di un server.
vuoto|
titolo|Oggi
|Il riquadro in cima dice quanti articoli sono da leggere e quanti hanno il
|testo intero. Toccalo per aprire la Rassegna.
|Il riquadro sotto dice quando è stato l'ultimo scambio con la copia remota
|e quante modifiche aspettano di salire. Il pulsante «Ora» forza lo scambio
|invece di aspettare il giro automatico.
vuoto|
titolo|Rassegna
|Ogni mattina alle otto — ora di Città del Messico fino al 2 ottobre, ora di
|Roma da lì in poi — un lavoro su GitHub interroga gli archivi aperti,
|estrae il TESTO degli articoli e lo deposita. L'app lo ritira da sola.
|Il testo è sul dispositivo: si legge in metropolitana.
|Un articolo si segna letto da solo quando lo apri.
vuoto|
titolo|Libreria
|Un volume con «tocca per scaricare» è nel deposito remoto ma non ancora
|qui: toccalo e scende. Una volta sceso resta, e si apre senza rete.
|Tocco lungo: aprire col visore di sistema, o liberare il file scaricato.
vuoto|
titolo|Note e segni sui testi
|Nel lettore PDF, il pulsante con la matita apre le note della pagina.
|I segni stanno ACCANTO al file, mai dentro: il PDF non viene toccato.
|Questo vuol dire che puoi riscaricare un volume senza perdere niente, e che
|due dispositivi che annotano lo stesso testo non si danneggiano a vicenda.
vuoto|
titolo|Aggiungere un PDF a mano
|Dall'app: Libreria, «Aggiungi PDF». Il file è subito leggibile offline, e
|la copia remota parte da sé appena c'è rete.
|Da GitHub, senza telefono: lascia il file nella cartella biblioteca-manuale
|del repository e fai push. Accanto puoi mettere un file con lo stesso nome
|ed estensione .json per dare titolo, autore e tema veri:
codice|  {"titolo": "...", "autore": "...", "tema_slug": "...", "trimestre": "T3"}
|Le due strade finiscono nello stesso posto, per la stessa via.
vuoto|
titolo|Se qualcosa non torna
|La schermata Profilo mostra la versione del motore SQL e lo stato della
|sincronizzazione. Un volume che non si apre col lettore interno si apre
|quasi sempre col visore di sistema (tocco lungo sulla scheda).
|I progressi non si perdono: ogni modifica è un evento nel registro, e il
|registro è la fonte di verità, non le tabelle.
"""


def righe_della_guida():
    fuori = []
    for riga in GUIDA.strip().split("\n"):
        genere, _, testo = riga.partition("|")
        if genere == "vuoto":
            fuori.append(("vuoto", ""))
        elif genere == "titolo":
            fuori.append(("titolo", testo))
        elif genere == "codice":
            fuori.append(("codice", testo))
        else:
            for pezzo in avvolgi(testo, 86):
                fuori.append(("testo", pezzo))
    return fuori


if __name__ == "__main__":
    destinazione = sys.argv[1] if len(sys.argv) > 1 else "biblioteca-manuale/guida-percorso.pdf"
    byte, pagine = scrivi(destinazione, righe_della_guida())
    print("%s — %d byte, %d pagine" % (destinazione, byte, pagine))
