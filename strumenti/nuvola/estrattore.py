#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Estrazione: da un URL ai byte, e dai byte al testo che si puo' davvero leggere.

Strato piu' basso della conduttura verso la nuvola. Non sa nulla di Supabase ne'
del catalogo: prende un indirizzo, riporta byte, e sa dire se quei byte sono un
PDF o una pagina da cui ricavare testo. Solo libreria standard, perche' gira
anche su GitHub Actions dove non c'e' nulla di installato.

    python3 estrattore.py        # autoverifica senza rete

Quattro garanzie, nell'ordine in cui contano:

  1. Il contenuto decide, non l'intestazione. Il Content-Type mente in tutte e
     due le direzioni: archivi che servono un PDF dichiarandolo text/html, e —
     molto piu' spesso — pagine di login o "403 Forbidden" in HTML servite come
     application/pdf. La biblioteca del progetto e' rimasta vuota per giorni
     proprio per questo: diciannove file .pdf che erano pagine di presentazione,
     scoperti solo aprendoli, in viaggio, senza rete per rimediare.

  2. Nessuno scaricamento puo' riempire il disco del runner. Si legge a blocchi
     con un tetto, e il Content-Length non e' una promessa: manca, o e' finto,
     e un archivio che streamma all'infinito fermerebbe la corsa quotidiana per
     esaurimento di spazio invece che con un errore.

  3. Superare il tetto e' un errore, non un troncamento. Un PDF tagliato a meta'
     ha comunque una sua impronta, entra nel deposito, e il guasto si scopre un
     mese dopo quando si prova a leggerlo. Meglio nessun file che un file finto.

  4. La struttura si legge con un parser, mai con espressioni regolari. Un ">"
     dentro un attributo — title="a > b" — spezza qualunque regex scritta in
     fretta, e su una pagina di rivista il testo utile e' per nove decimi
     circondato da menu, banner e moduli di iscrizione.
"""
import hashlib
import html.parser
import http.client
import json
import os
import re
import sys
import urllib.error
import urllib.parse
import urllib.request
import zlib

MASSIMO_BYTE = 60 * 1024 * 1024
TIMEOUT = 30

# Blocco di lettura. Grande abbastanza da non moltiplicare le chiamate su un PDF
# da decine di megabyte, piccolo abbastanza da far scattare il tetto subito.
BLOCCO = 64 * 1024

NOME_AGENTE = "PercorsoEstrattore/1.0"

# Quanto testo deve contenere un <div> per valere piu' dell'intero <body>.
# Senza questa soglia una pagina con un solo <div> di tre parole — un banner
# cookie, una data — finisce per essere l'unica cosa estratta dall'articolo.
MINIMO_DIV = 200

# Quanti byte iniziali si guardano per scoprire la codifica dichiarata. Lo
# standard HTML impone al meta charset di stare nei primi 1024; il doppio
# abbondante copre anche le pagine che ci arrivano dopo mezzo chilo di commenti.
TESTA_CODIFICA = 4096

# Oltre questa profondita' l'albero smette di annidare e appiattisce. Il testo
# resta tutto — cambia solo il nodo a cui e' appeso — ma le passeggiate
# ricorsive non sfondano il limite di ricorsione di Python. Pagine con duemila
# <div> annidati esistono: le produce qualunque esportatore che non chiude i
# tag, e farebbero morire la corsa quotidiana con un RecursionError nudo invece
# che con un articolo estratto.
MASSIMA_PROFONDITA = 400

VUOTI = frozenset("""
    area base basefont br col embed frame hr img input link meta param source track wbr
""".split())

# Sottoalberi che non contengono mai il testo da studiare. Si buttano interi,
# figli compresi: un <nav> dentro un <article> resta comunque un menu.
SCARTA = frozenset("script style noscript svg head nav header footer aside form".split())

TITOLI = frozenset(("h1", "h2", "h3", "h4", "h5", "h6"))

# Elementi che chiudono un paragrafo. Tutto cio' che non e' qui, non e' un
# titolo e non si butta vale come in linea: <span>, <a>, <strong> non devono
# spezzare una frase a meta'.
BLOCCHI = frozenset("""
    address article blockquote body button canvas caption dd details div dl dt fieldset
    figcaption figure hr iframe li main ol option p pre section select summary table
    tbody td textarea tfoot th thead tr ul video audio
""".split())


class ErroreEstrazione(Exception):
    """Guasto in una fase dell'estrazione, con dentro cosa fare per rimediare.

    Chi la cattura deve poter scrivere il messaggio in un rapporto e capirci
    qualcosa il giorno dopo, senza risalire allo stack.
    """


# --------------------------------------------------------------------- scarico

def _agente():
    """User-Agent onesto: dice chi e', e come raggiungere chi lo manda.

    Il recapito si prende da PERCORSO_CONTATTO e resta vuoto se non c'e'. Vari
    archivi aperti rispondono 403 a chi non si presenta, e altri declassano le
    richieste anonime in una coda lenta; ma un indirizzo di posta scritto nel
    sorgente finirebbe in ogni richiesta a ogni archivio, per sempre, senza che
    nessuno l'abbia deciso. Stessa regola di strumenti/rassegna/fonti_aperte.py.
    """
    contatto = os.environ.get("PERCORSO_CONTATTO", "").strip()
    if contatto:
        return f"{NOME_AGENTE} (strumento personale di studio; {contatto})"
    return f"{NOME_AGENTE} (strumento personale di studio)"


def _motivo(errore):
    """La frase utile dentro il corpo di una risposta d'errore, in una riga.

    Gli archivi spiegano nel corpo perche' hanno rifiutato — chiave scaduta,
    quota esaurita, documento ritirato — e quella frase e' l'unica via per
    correggere invece di indovinare. Non deve mai far fallire la gestione
    dell'errore che si sta gia' gestendo.
    """
    try:
        corpo = errore.read(1200)
    except Exception:
        return ""
    if not corpo:
        return ""
    try:
        testo = testo_da_html(corpo) if b"<" in corpo[:200] else corpo.decode("utf-8", "replace")
    except Exception:
        testo = corpo.decode("utf-8", "replace")
    testo = " ".join(testo.split())
    return f" Risposta: {testo[:200]}" if testo else ""


def _srotola(indirizzo, dati, codifica, massimo_byte):
    """Corpo arrivato compresso benche' si fosse chiesto identity: lo srotola.

    Accept-Encoding e' una richiesta, non una promessa — la stessa lezione del
    Content-Length qui sopra. Qualche CDN comprime comunque, e senza questo
    passo i byte gzippati tornerebbero al chiamante come se fossero il
    documento: e_pdf() direbbe di no su un PDF che c'era, e il rapporto
    incolperebbe la fonte invece del trasporto.

    Si srotola a blocchi con lo stesso tetto dello scarico: pochi megabyte
    compressi ne diventano migliaia una volta aperti, e il tetto della garanzia
    2 deve valere sui byte veri, non su quelli che viaggiano.
    """
    if codifica not in ("gzip", "x-gzip", "deflate"):
        raise ErroreEstrazione(
            f"{indirizzo} ha risposto con Content-Encoding: {codifica}, che la sola "
            f"libreria standard non sa srotolare (si era chiesto identity). Scarica "
            f"quel documento a mano oppure togli la fonte dall'elenco.")

    # MAX_WBITS|32 riconosce da se' l'intestazione gzip e quella zlib;
    # -MAX_WBITS serve ai server che dichiarano "deflate" e mandano il flusso
    # nudo, senza intestazione. Sono entrambi in giro: si prova e si ripiega.
    guasto = "flusso incompleto"
    for finestra in (zlib.MAX_WBITS | 32, -zlib.MAX_WBITS):
        motore = zlib.decompressobj(finestra)
        pezzi, totale, resto = [], 0, dati
        try:
            while True:
                pezzo = motore.decompress(resto, BLOCCO)
                totale += len(pezzo)
                if totale > massimo_byte:
                    raise ErroreEstrazione(
                        f"{indirizzo} srotolato supera il tetto di {massimo_byte} byte "
                        f"(ne dichiarava {len(dati)} compressi) e viene scartato: un "
                        f"archivio che si gonfia riempirebbe il disco del runner.")
                pezzi.append(pezzo)
                resto = motore.unconsumed_tail
                # Si esce solo dove uscire non puo' accorciare il corpo: a
                # flusso concluso, oppure con l'input finito e l'ultimo blocco
                # non pieno — cioe' quando il motore non trattiene piu' nulla.
                # Il ciclo finisce comunque: ogni giro consuma input o produce
                # un blocco intero, e i blocchi li conta il tetto qui sopra.
                if motore.eof or (not resto and len(pezzo) < BLOCCO):
                    break
        except zlib.error as e:
            guasto = f"{type(e).__name__}: {e}"
            continue
        if motore.eof:
            return b"".join(pezzi)
        guasto = "flusso incompleto"
    raise ErroreEstrazione(
        f"{indirizzo} dichiara Content-Encoding: {codifica} ma il corpo non si srotola "
        f"({guasto}). E' arrivato rotto: riprova, e se si ripete aprilo nel browser.")


def scarica(url, massimo_byte=MASSIMO_BYTE, timeout=TIMEOUT):
    """Scarica l'URL e restituisce (dati, content_type).

    Segue i reindirizzamenti (l'apritore predefinito di urllib lo fa da se'); il
    content_type e' il solo tipo MIME, in minuscolo, senza i parametri e senza
    alcuna pretesa di verita': chi deve fidarsi guardi i byte con e_pdf().

    Oltre massimo_byte solleva invece di troncare, per la garanzia 3 in testa al
    file, e per la stessa ragione solleva anche quando ne arrivano meno di
    quanti il Content-Length ne dichiarava: un trasferimento interrotto non
    torna mai come documento. Se il corpo arriva compresso lo srotola, cosi' i
    byte restituiti sono sempre quelli del documento e non quelli del
    trasporto. Solleva ErroreEstrazione su qualunque guasto, sempre con dentro
    l'indirizzo: nel rapporto quotidiano ci sono decine di scarichi e un errore
    senza indirizzo non si puo' nemmeno riprovare a mano.
    """
    indirizzo = (url or "").strip()
    schema = urllib.parse.urlparse(indirizzo).scheme.lower()
    if schema not in ("http", "https"):
        raise ErroreEstrazione(
            f"indirizzo non scaricabile: {indirizzo!r}. Serve un URL http o https "
            f"(schema letto: {schema or 'nessuno'}); correggi la voce nella fonte.")

    richiesta = urllib.request.Request(indirizzo, headers={
        "User-Agent": _agente(),
        "Accept": "application/pdf,text/html,application/xhtml+xml,text/plain;q=0.8,*/*;q=0.5",
        # identity esplicito: urllib non decomprime nulla da se', e un PDF
        # arrivato gzippato fallirebbe e_pdf() senza che si capisca perche'.
        # Resta una richiesta, non una garanzia: chi la ignora lo si scopre dal
        # Content-Type della risposta e lo srotola _srotola().
        "Accept-Encoding": "identity",
    })

    try:
        risposta = urllib.request.urlopen(richiesta, timeout=timeout)
    except urllib.error.HTTPError as e:
        raise ErroreEstrazione(
            f"{indirizzo} ha risposto {e.code} {e.reason}.{_motivo(e)}"
        ) from e
    except urllib.error.URLError as e:
        raise ErroreEstrazione(
            f"{indirizzo} non raggiungibile: {e.reason}. Se si ripete, la fonte e' "
            f"giu' o l'indirizzo e' cambiato: verificalo nel browser."
        ) from e
    except TimeoutError as e:
        raise ErroreEstrazione(
            f"{indirizzo} non ha risposto entro {timeout}s. Riprova, o alza il timeout "
            f"se quella fonte e' notoriamente lenta."
        ) from e
    except (http.client.HTTPException, OSError, ValueError) as e:
        raise ErroreEstrazione(
            f"{indirizzo} non scaricabile: {type(e).__name__}: {e}"
        ) from e

    with risposta:
        tipo = (risposta.headers.get("Content-Type") or "").split(";")[0].strip().lower()
        codifica = (risposta.headers.get("Content-Encoding") or "").strip().lower()

        # Con il corpo a pezzi il Content-Length, se c'e', non descrive il
        # documento — e' il residuo di un intermediario — e confrontarlo con i
        # byte letti farebbe scartare scarichi sani.
        a_pezzi = "chunked" in (risposta.headers.get("Transfer-Encoding") or "").lower()

        # Il Content-Length dichiarato si controlla prima di leggere: quando e'
        # onesto risparmia l'intero trasferimento di un file che si butterebbe.
        dichiarata = (risposta.headers.get("Content-Length") or "").strip()
        if dichiarata.isdigit() and int(dichiarata) > massimo_byte:
            raise ErroreEstrazione(
                f"{indirizzo} dichiara {int(dichiarata)} byte, oltre il tetto di "
                f"{massimo_byte}. Alza massimo_byte solo se quel documento serve davvero.")

        pezzi, totale = [], 0
        while True:
            try:
                pezzo = risposta.read(BLOCCO)
            except (http.client.HTTPException, OSError) as e:
                raise ErroreEstrazione(
                    f"{indirizzo} interrotto dopo {totale} byte: {type(e).__name__}: {e}. "
                    f"Riprova: quasi sempre e' la rete del runner."
                ) from e
            if not pezzo:
                break
            totale += len(pezzo)
            # Il tetto vale sui byte letti, non su quelli promessi: e' l'unica
            # difesa contro un Content-Length assente o mentito.
            if totale > massimo_byte:
                raise ErroreEstrazione(
                    f"{indirizzo} supera il tetto di {massimo_byte} byte e viene scartato "
                    f"invece che troncato: un file a meta' entrerebbe nel deposito con "
                    f"un'impronta valida.")
            pezzi.append(pezzo)

        # Il trasferimento interrotto a meta' non solleva niente da se': read()
        # restituisce b"" e http.client lascia passare di proposito il corpo
        # corto (sta scritto nel suo sorgente, per non rompere chi si affida al
        # vecchio comportamento). E' la garanzia 3 presa dal lato opposto: non
        # un file troppo grande, ma uno finito troppo presto, che entrerebbe
        # nel deposito con un'impronta perfettamente valida.
        if not a_pezzi and dichiarata.isdigit() and totale < int(dichiarata):
            raise ErroreEstrazione(
                f"{indirizzo} si e' interrotto: {totale} byte ricevuti dei "
                f"{int(dichiarata)} dichiarati. Il file a meta' viene scartato invece "
                f"che salvato; riprova, quasi sempre e' la rete del runner.")

    dati = b"".join(pezzi)
    if not dati:
        raise ErroreEstrazione(
            f"{indirizzo} ha risposto senza corpo (tipo dichiarato: {tipo or 'nessuno'}). "
            f"Spesso e' un reindirizzamento verso una pagina di consenso: aprilo a mano.")
    if codifica and codifica != "identity":
        dati = _srotola(indirizzo, dati, codifica, massimo_byte)
    return dati, tipo


# ----------------------------------------------------------------- riconoscere

def e_pdf(dati):
    """Vero se dentro i primi 1024 byte c'e' la firma %PDF.

    Non si guarda il Content-Type, mai, in nessuna direzione: e' il guasto della
    garanzia 1 in testa al file. Si cerca nei primi 1024 byte e non solo a
    offset zero perche' diversi archivi antepongono una BOM o qualche riga di
    intestazione, e quei PDF si aprono lo stesso.
    """
    if not isinstance(dati, (bytes, bytearray, memoryview)):
        return False
    return b"%PDF" in bytes(dati[:1024])


def impronta(dati):
    """sha256 esadecimale. Una str viene codificata in utf-8 prima di pesarla."""
    if isinstance(dati, str):
        dati = dati.encode("utf-8")
    if not isinstance(dati, (bytes, bytearray, memoryview)):
        raise ErroreEstrazione(
            f"impronta() vuole byte o str, ha ricevuto {type(dati).__name__}. "
            f"Passa il contenuto del file, non il suo percorso.")
    return hashlib.sha256(bytes(dati)).hexdigest()


# ------------------------------------------------------------ albero dell'HTML

class _Nodo:
    __slots__ = ("tag", "figli")

    def __init__(self, tag):
        self.tag = tag
        self.figli = []                      # str (testo) oppure _Nodo


class _Albero(html.parser.HTMLParser):
    """Costruisce un albero tollerante ai tag chiusi male.

    Una chiusura che non trova il suo tag aperto si ignora, e una chiusura che
    lo trova sepolto chiude anche quelli aperti dopo. Nessuna delle due butta
    testo: su `<p>Uno<div>Due</p>Tre</div>` restano quattro pezzi, tutti e
    quattro nel risultato. Le pagine reali sono cosi' molto piu' spesso di
    quanto ammettano.
    """

    def __init__(self):
        super().__init__(convert_charrefs=True)   # &amp; &egrave; &#233; risolte qui
        self.radice = _Nodo("")
        self.pila = [self.radice]

    def handle_starttag(self, tag, attrs):
        nodo = _Nodo(tag)
        self.pila[-1].figli.append(nodo)
        if tag not in VUOTI and len(self.pila) < MASSIMA_PROFONDITA:
            self.pila.append(nodo)

    def handle_startendtag(self, tag, attrs):
        self.pila[-1].figli.append(_Nodo(tag))

    def handle_endtag(self, tag):
        for indice in range(len(self.pila) - 1, 0, -1):
            if self.pila[indice].tag == tag:
                del self.pila[indice:]
                return

    def handle_data(self, dati):
        self.pila[-1].figli.append(dati)


class _Codifica(html.parser.HTMLParser):
    """Cerca la codifica dichiarata nei <meta>. Si ferma al primo che la dice."""

    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.nome = ""

    def handle_starttag(self, tag, attrs):
        if tag != "meta" or self.nome:
            return
        valori = {chiave.lower(): (valore or "") for chiave, valore in attrs}
        if valori.get("charset", "").strip():
            self.nome = valori["charset"].strip()
            return
        if valori.get("http-equiv", "").strip().lower() == "content-type":
            contenuto = valori.get("content", "")
            if "charset=" in contenuto.lower():
                # Taglio su una stringa nota, non sulla struttura del documento:
                # qui il parser ha gia' fatto il lavoro che le regex sbagliano.
                coda = contenuto.lower().split("charset=", 1)[1]
                self.nome = coda.split(";")[0].strip().strip("\"'")


def _decodifica(dati):
    """bytes -> str, dando retta al meta charset quando c'e'.

    Senza dichiarazione si assume utf-8 con errors="replace": un byte isolato
    fuori tabella non deve far saltare l'estrazione di un articolo intero.
    """
    if dati[:3] == b"\xef\xbb\xbf":
        # La BOM diventerebbe ﻿ appiccicato alla prima parola del testo.
        return dati[3:].decode("utf-8", "replace")

    sonda = _Codifica()
    try:
        sonda.feed(dati[:TESTA_CODIFICA].decode("latin-1"))   # mai solleva: 1 byte = 1 carattere
        sonda.close()
    except Exception:
        sonda.nome = ""
    if sonda.nome:
        try:
            return dati.decode(sonda.nome, "replace")
        except LookupError:
            pass                              # charset inventato o scritto male: si ripiega
    return dati.decode("utf-8", "replace")


def _comprimi(testo):
    """Spazi, tabulazioni, a capo e &nbsp; ridotti a un singolo spazio."""
    return " ".join(testo.split())


def _piano(nodo):
    """Tutto il testo del sottoalbero su una riga sola, saltando cio' che si butta."""
    pezzi = []

    def giu(n):
        for figlio in n.figli:
            if isinstance(figlio, str):
                pezzi.append(figlio)
            elif figlio.tag in SCARTA:
                continue
            elif figlio.tag == "br":
                pezzi.append(" ")
            else:
                pezzi.append(" ")             # due blocchi adiacenti non si saldano
                giu(figlio)
                pezzi.append(" ")

    giu(nodo)
    return _comprimi("".join(pezzi))


def _misura(radice):
    """Lunghezza del testo utile per ogni nodo, calcolata una volta sola.

    Conta i caratteri gia' compressi, cosi' un involucro che contiene solo
    indentazione e il suo unico figlio misura esattamente quanto il figlio: e'
    cio' che permette di preferire il <div> piu' interno a parita' di testo.
    """
    lunghezze = {}

    def giu(nodo):
        totale = 0
        for figlio in nodo.figli:
            if isinstance(figlio, str):
                totale += len(_comprimi(figlio))
            elif figlio.tag in SCARTA:
                continue
            else:
                totale += giu(figlio)
        lunghezze[id(nodo)] = totale
        return totale

    giu(radice)
    return lunghezze


def _tutti(radice, tag):
    """I nodi con quel tag, in ordine di documento, fuori dai sottoalberi scartati."""
    trovati = []

    def giu(nodo, profondita):
        for figlio in nodo.figli:
            if isinstance(figlio, str) or figlio.tag in SCARTA:
                continue
            if figlio.tag == tag:
                trovati.append((figlio, profondita + 1))
            giu(figlio, profondita + 1)

    giu(radice, 0)
    return trovati


def _div_migliore(radice, lunghezze):
    """Il <div> con piu' testo, purche' ne abbia abbastanza da valere la pena.

    A parita' di testo vince il piu' profondo: fra un involucro e il div che
    contiene, quello vero e' l'interno.
    """
    migliore, punteggio = None, (-1, -1)
    for nodo, profondita in _tutti(radice, "div"):
        lunghezza = lunghezze.get(id(nodo), 0)
        # La soglia si scarta prima del confronto e non si nasconde nel
        # punteggio di partenza: dentro una coppia il secondo elemento decide i
        # pari merito, e un <div> di esattamente MINIMO_DIV-1 caratteri
        # batterebbe comunque il punteggio iniziale grazie alla profondita'.
        if lunghezza < MINIMO_DIV:
            continue
        candidato = (lunghezza, profondita)
        if candidato > punteggio:
            migliore, punteggio = nodo, candidato
    return migliore


def _candidati(radice, lunghezze):
    """Dove puo' stare il corpo, dal piu' specifico al piu' generico."""
    lista = []
    for tag in ("article", "main"):
        trovati = _tutti(radice, tag)
        if trovati:
            lista.append(trovati[0][0])
    div = _div_migliore(radice, lunghezze)
    if div is not None:
        lista.append(div)
    corpi = _tutti(radice, "body")
    if corpi:
        lista.append(corpi[0][0])
    lista.append(radice)                      # frammento senza <body>
    return lista


def _blocchi(nodo):
    """Il sottoalbero reso in paragrafi. I titoli escono preceduti da "# "."""
    blocchi, tampone = [], []

    def svuota():
        testo = _comprimi("".join(tampone))
        tampone.clear()
        if testo:
            blocchi.append(testo)

    def giu(n):
        for figlio in n.figli:
            if isinstance(figlio, str):
                tampone.append(figlio)
            elif figlio.tag in SCARTA:
                continue
            elif figlio.tag in TITOLI:
                svuota()
                testo = _piano(figlio)        # un titolo sta su una riga, sempre
                if testo:
                    blocchi.append("# " + testo)
            elif figlio.tag == "br":
                tampone.append(" ")           # interruzione di riga, non di paragrafo
            elif figlio.tag in BLOCCHI:
                svuota()
                giu(figlio)
                svuota()
            else:
                giu(figlio)                   # in linea: non spezza la frase

    giu(nodo)
    svuota()
    return blocchi


def testo_da_html(html_grezzo):
    """Da HTML (bytes o str) a testo semplice, leggibile e studiabile.

    Paragrafi separati da una riga vuota, titoli h1-h6 preceduti da "# ".
    Si prova il primo <article>, poi il primo <main>, poi il <div> con piu'
    testo, poi <body>: si prende il primo che produce qualcosa, cosi' un
    <article> vuoto — ce ne sono, usati come contenitore d'impaginazione — non
    fa restituire il vuoto quando il testo sta poco piu' in la'.
    """
    if isinstance(html_grezzo, (bytes, bytearray, memoryview)):
        sorgente = _decodifica(bytes(html_grezzo))
    elif isinstance(html_grezzo, str):
        sorgente = html_grezzo
    else:
        raise ErroreEstrazione(
            f"testo_da_html() vuole bytes o str, ha ricevuto {type(html_grezzo).__name__}.")

    albero = _Albero()
    try:
        albero.feed(sorgente)
        albero.close()
    except Exception as e:
        raise ErroreEstrazione(
            f"HTML illeggibile ({type(e).__name__}: {e}). Conserva la pagina e aprila a "
            f"mano: quasi sempre non e' HTML ma un binario servito come tale.") from e

    lunghezze = _misura(albero.radice)
    for candidato in _candidati(albero.radice, lunghezze):
        blocchi = _blocchi(candidato)
        if blocchi:
            return "\n\n".join(blocchi)
    return ""


# ------------------------------------------------------------- trascrizioni

# Una riga di tempo di VTT o di SRT. La freccia è l'unico segno che i due
# formati hanno sempre in comune, e basta a riconoscerli senza indovinare dal
# tipo dichiarato: un feed che dichiara text/html e serve VTT esiste.
_TEMPO = re.compile(r"-->")
_CONTATORE_SRT = re.compile(r"^\d+$")
_INTESTAZIONE_VTT = re.compile(r"^(WEBVTT|NOTE|STYLE|REGION)\b")
# `<v Alessio>`, `<00:00:04.120>`, `{\an8}`: marcature dentro la battuta.
_MARCATURE = re.compile(r"<[^>]{0,60}>|\{\\[^}]{0,20}\}")


def _da_sottotitoli(testo):
    """Da VTT o SRT a prosa: via i tempi, i contatori e le battute ripetute."""
    righe = []
    for riga in testo.splitlines():
        riga = riga.strip()
        if not riga or _TEMPO.search(riga) or _CONTATORE_SRT.match(riga):
            continue
        if _INTESTAZIONE_VTT.match(riga):
            continue
        riga = _MARCATURE.sub("", riga).strip()
        # I sottotitoli a scorrimento ripetono la riga precedente a ogni
        # battuta nuova: senza questo, metà della trascrizione è doppia.
        if riga and (not righe or righe[-1] != riga):
            righe.append(riga)
    return " ".join(righe)


def _da_json_podcast(testo):
    """Il formato JSON del Podcast Namespace: `{"segments": [{"body": ...}]}`."""
    try:
        dati = json.loads(testo)
    except Exception:  # noqa: BLE001 — non è JSON, e non è un guasto
        return None
    segmenti = dati.get("segments") if isinstance(dati, dict) else None
    if not isinstance(segmenti, list):
        # È JSON, ma non è una trascrizione: una risposta d'errore, o un
        # formato che non conosciamo. Restituire i byte grezzi vorrebbe dire
        # depositare `{"error": ...}` come se fosse il testo di un articolo.
        return ""
    pezzi = []
    for s in segmenti:
        corpo = (s or {}).get("body") if isinstance(s, dict) else None
        if isinstance(corpo, str) and corpo.strip():
            if not pezzi or pezzi[-1] != corpo.strip():
                pezzi.append(corpo.strip())
    return " ".join(pezzi)


def testo_da_trascrizione(dati):
    """La trascrizione che l'autore pubblica -> testo leggibile senza rete.

    È la sola strada per cui un podcast o una conferenza diventano
    *studiabili* in aereo: l'audio si ascolta, ma non si cerca dentro, non si
    annota una frase e non si rilegge un passaggio. Il file che l'editore mette
    online apposta risolve tutte e tre le cose, e non costa né una chiave né
    una quota — il giorno in cui un servizio di trascrizione risponde 429 è il
    giorno in cui si è in volo.

    Il formato si riconosce dal contenuto e non dal tipo dichiarato: VTT, SRT,
    il JSON del Podcast Namespace, HTML, o testo semplice.
    """
    if isinstance(dati, bytes):
        testo = dati.decode("utf-8", "replace")
    else:
        testo = dati or ""
    testo = testo.lstrip("\ufeff").strip()
    if not testo:
        return ""
    if _TEMPO.search(testo):
        return _comprimi(_da_sottotitoli(testo))
    da_json = _da_json_podcast(testo)
    if da_json is not None:
        return _comprimi(da_json)
    if "<" in testo and ">" in testo:
        piano = testo_da_html(testo)
        if piano:
            return piano
    return _comprimi(testo)


def riassunto(testo, caratteri=280):
    """Le prime `caratteri` battute, tagliate al confine di parola.

    Il risultato sta su una riga sola e non supera mai `caratteri`, ellissi
    compresa: finisce in colonne e in anteprime di larghezza decisa altrove.
    Il taglio a parola si applica solo se lascia almeno meta' dello spazio
    disponibile, altrimenti una prima parola corta seguita da una lunghissima
    ridurrebbe il riassunto a quella sola parola.
    """
    if caratteri <= 0:
        return ""
    piano = _comprimi(testo or "")
    if len(piano) <= caratteri:
        return piano
    taglio = piano[:caratteri - 1]
    spazio = taglio.rfind(" ")
    if spazio >= caratteri // 2:
        taglio = taglio[:spazio]
    return taglio.rstrip() + "…"


# ----------------------------------------------------------- autoverifica (0 rete)

# Scritto a mano, non ricalcolato con hashlib: un atteso prodotto dalla stessa
# libreria che si sta verificando conferma solo se stesso.
SHA_PERCORSO = "31ff23e9e6b30a4044706cfcdf0e0871c66fa2d9fcb7b27491bbd07898bc0de7"

_ok = 0
_ko = []


def _prova(nome, ottenuto, atteso):
    global _ok
    if ottenuto == atteso:
        _ok += 1
    else:
        _ko.append((nome, atteso, ottenuto))


def _solleva(nome, funzione, *argomenti):
    global _ok
    try:
        risultato = funzione(*argomenti)
    except ErroreEstrazione:
        _ok += 1
        return
    except Exception as e:
        _ko.append((nome, "ErroreEstrazione", f"{type(e).__name__}: {e}"))
        return
    _ko.append((nome, "ErroreEstrazione", repr(risultato)))


class _FintaRisposta:
    """Quel poco di una risposta HTTP che scarica() usa davvero.

    Serve a provare il troncamento e lo srotolamento senza aprire una porta:
    l'autoverifica gira dentro il workflow prima di toccare la rete, e un test
    che si lega a un socket fallirebbe li' per motivi suoi.
    """

    def __init__(self, corpo, **intestazioni):
        self.corpo, self.posizione = corpo, 0
        self.headers = http.client.HTTPMessage()   # come la vera: chiavi senza maiuscole
        for chiave, valore in intestazioni.items():
            self.headers[chiave.replace("_", "-")] = valore

    def read(self, quanti):
        pezzo = self.corpo[self.posizione:self.posizione + quanti]
        self.posizione += len(pezzo)
        return pezzo

    def __enter__(self):
        return self

    def __exit__(self, *_):
        return False


def _con_risposta(risposta, funzione, *argomenti):
    """Esegue `funzione` con urlopen sostituito da una risposta finta."""
    vero = urllib.request.urlopen
    urllib.request.urlopen = lambda *a, **k: risposta
    try:
        return funzione(*argomenti)
    finally:
        urllib.request.urlopen = vero


def _gzippa(dati, finestra=zlib.MAX_WBITS | 16):
    motore = zlib.compressobj(9, zlib.DEFLATED, finestra)
    return motore.compress(dati) + motore.flush()


def _autoverifica():
    # ---------------------------------------------------------- testo_da_html
    _prova(
        "script, style, noscript e head spariscono",
        testo_da_html("""<!DOCTYPE html>
            <html><head><title>Rivista</title><style>p{color:red}</style></head>
            <body>
              <script>var traccia = 1 > 0;</script>
              <h1>Titolo vero</h1>
              <p>Primo   paragrafo.</p>
              <noscript>Attiva JavaScript</noscript>
            </body></html>"""),
        "# Titolo vero\n\nPrimo paragrafo.")

    _prova(
        "<article> batte menu, banner e pie' di pagina",
        testo_da_html("""<body>
              <nav><a href="/">Home</a> <a href="/rivista">Rivista</a></nav>
              <div class="promo">Abbonati adesso</div>
              <article><h2>Metodo</h2><p>Il corpo vero dell'articolo.</p></article>
              <footer>Copyright 2026</footer>
            </body>"""),
        "# Metodo\n\nIl corpo vero dell'articolo.")

    _prova(
        "<main> quando non c'e' <article>",
        testo_da_html("<body><header>Testata</header><main><p>Corpo in main.</p>"
                      "</main><aside>Colonna</aside></body>"),
        "Corpo in main.")

    _prova(
        "le entita' HTML tornano caratteri",
        testo_da_html("<body><p>Acqua &amp; sale &lt;100&gt; caff&egrave; "
                      "&#233; &nbsp;fine</p></body>"),
        "Acqua & sale <100> caffè é fine")

    # Il caso che fa perdere testo a ogni parser scritto in fretta.
    _prova(
        "tag annidati male: non si perde un pezzo",
        testo_da_html("<body><p>Uno<div>Due</p>Tre</div><p>Quattro</body>"),
        "Uno\n\nDue\n\nTre\n\nQuattro")

    _prova(
        "un '>' dentro un attributo non chiude il tag",
        testo_da_html("""<body><p title="a > b">Disuguaglianza</p>"""
                      """<p data-nota='chiudi > qui'>Seconda</p></body>"""),
        "Disuguaglianza\n\nSeconda")

    _prova("pagina vuota", testo_da_html(""), "")
    _prova(
        "solo testa e corpo bianco",
        testo_da_html("<html><head><title>Solo testa</title></head>"
                      "<body>   </body></html>"),
        "")

    _prova(
        "una pagina di soli menu non produce testo",
        testo_da_html("<html><body><nav><ul><li><a href=\"/\">Home</a></li>"
                      "<li><a href=\"/chi-siamo\">Chi siamo</a></li></ul></nav>"
                      "</body></html>"),
        "")

    lungo_uno = ("La sorveglianza epidemiologica dipende da una definizione di caso stabile "
                 "nel tempo, perche' ogni modifica del denominatore sposta la curva senza "
                 "che nulla sia cambiato nella realta' osservata.")
    lungo_due = "Il secondo paragrafo del corpo, lungo abbastanza da superare la soglia."
    _prova(
        "fra piu' <div> vince quello con il testo",
        testo_da_html(f"""<body>
              <div id="menu">Home Contatti Abbonati</div>
              <div id="corpo"><p>{lungo_uno}</p><p>{lungo_due}</p></div>
              <div id="pie">Nota legale</div>
            </body>"""),
        f"{lungo_uno}\n\n{lungo_due}")

    _prova(
        "un <div> troppo corto non batte il <body>",
        testo_da_html("<body><p>Prima frase.</p><div>Cookie</div><p>Seconda frase.</p></body>"),
        "Prima frase.\n\nCookie\n\nSeconda frase.")

    # La soglia e' un confronto fra coppie: se si nasconde nel punteggio di
    # partenza, la profondita' fa vincere anche un <div> di MINIMO_DIV-1.
    _prova(
        f"un <div> di {MINIMO_DIV - 1} caratteri non batte ancora il <body>",
        testo_da_html(f"<body><p>PRIMA</p><div>{'x' * (MINIMO_DIV - 1)}</div></body>"),
        "PRIMA\n\n" + "x" * (MINIMO_DIV - 1))
    _prova(
        f"un <div> di {MINIMO_DIV} caratteri vince",
        testo_da_html(f"<body><p>PRIMA</p><div>{'x' * MINIMO_DIV}</div></body>"),
        "x" * MINIMO_DIV)

    _prova(
        "i tag in linea non spezzano la frase",
        testo_da_html("<body><h3>Terzo <em>livello</em></h3><p>Testo con "
                      "<strong>grassetto</strong> e <a href=\"#\">link</a>.</p></body>"),
        "# Terzo livello\n\nTesto con grassetto e link.")

    _prova(
        "moduli via, <br> resta uno spazio",
        testo_da_html("<body><form><label>Email</label><input></form>"
                      "<p>Riga uno<br>Riga due</p></body>"),
        "Riga uno Riga due")

    _prova(
        "bytes con meta charset dichiarato",
        testo_da_html("<html><head><meta charset=\"iso-8859-1\"></head>"
                      "<body><p>perché così</p></body></html>".encode("latin-1")),
        "perché così")

    _prova(
        "bytes senza dichiarazione: utf-8",
        testo_da_html("<body><p>città</p></body>".encode("utf-8")),
        "città")

    # Duemila <div> annidati: prima appiattiva nulla e moriva di RecursionError.
    _prova(
        "annidamento smisurato: il testo esce lo stesso",
        testo_da_html("<body>" + "<div>" * 2000 + "<p>testo profondo</p>"
                      + "</div>" * 2000 + "</body>"),
        "testo profondo")

    _solleva("testo_da_html rifiuta cio' che non e' testo", testo_da_html, 42)

    # ------------------------------------------------------------------ e_pdf
    _prova("un PDF vero", e_pdf(b"%PDF-1.7\n1 0 obj\n<< /Type /Catalog >>\n"), True)
    _prova("una pagina HTML non e' un PDF",
           e_pdf(b"<!DOCTYPE html><html><body>403 Forbidden</body></html>"), False)
    _prova("il vuoto non e' un PDF", e_pdf(b""), False)
    _prova("firma dopo qualche byte di spazzatura", e_pdf(b"\r\n   %PDF-1.4"), True)
    _prova("firma all'ultimo byte utile", e_pdf(b"x" * 1020 + b"%PDF-1.4"), True)
    _prova("firma oltre i primi 1024 byte", e_pdf(b"x" * 1024 + b"%PDF-1.4"), False)
    _prova("una str non e' un PDF", e_pdf("%PDF-1.7"), False)
    _prova("None non e' un PDF", e_pdf(None), False)

    # ---------------------------------------------------------------- impronta
    _prova("sha256 del vuoto", impronta(b""),
           "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855")
    _prova("sha256 di un valore noto", impronta(b"percorso"), SHA_PERCORSO)
    _prova("una str pesa come i suoi byte utf-8", impronta("percorso"), SHA_PERCORSO)
    _solleva("impronta rifiuta un intero", impronta, 7)

    # ---------------------------------------------------------------- riassunto
    _prova("riassunto del vuoto", riassunto("", 280), "")
    _prova("riassunto di None", riassunto(None, 280), "")
    _prova("testo piu' corto del limite", riassunto("corto", 280), "corto")
    _prova("testo esattamente al limite", riassunto("a" * 280, 280), "a" * 280)
    _prova("un carattere oltre il limite", riassunto("a" * 281, 280), "a" * 279 + "…")
    _prova("lunghezza mai oltre il limite", len(riassunto("a" * 281, 280)), 280)
    _prova("taglio al confine di parola",
           riassunto("parola parola parola parola", 20), "parola parola…")
    _prova("le righe diventano una riga sola", riassunto("uno\n\ndue", 280), "uno due")
    _prova("una parola lunghissima si taglia di netto",
           riassunto("a " + "b" * 24, 10), "a bbbbbbb…")
    _prova("limite zero", riassunto("qualunque cosa", 0), "")

    # ------------------------------------------------- trascrizioni dell'autore
    _vtt = (
        "WEBVTT\n\nNOTE un commento\n\n1\n"
        "00:00:01.000 --> 00:00:04.000\n"
        "<v Relatore>Il triage non e\u0300 una fila.\n\n2\n"
        "00:00:04.000 --> 00:00:07.000\n"
        "Il triage non e\u0300 una fila.\nSi decide chi passa prima.\n"
    )
    # Le tre cose che un VTT porta e che non sono parole: l'intestazione, i
    # tempi e i contatori. E la quarta, che e\u0300 quella che si dimentica: i
    # sottotitoli a scorrimento ripetono la battuta precedente, e senza la
    # deduplica meta\u0300 della trascrizione arriva doppia.
    _prova("da VTT resta solo la prosa, senza righe doppie",
           testo_da_trascrizione(_vtt),
           "Il triage non e\u0300 una fila. Si decide chi passa prima.")
    _prova("da SRT, che ha la virgola nei tempi e nessuna intestazione",
           testo_da_trascrizione(
               "1\n00:00:01,000 --> 00:00:04,000\nPrima.\n\n"
               "2\n00:00:04,000 --> 00:00:07,000\nSeconda.\n"),
           "Prima. Seconda.")
    _prova("dal JSON del Podcast Namespace",
           testo_da_trascrizione(
               '{"version":"1.0.0","segments":['
               '{"speaker":"A","body":"Ciao."},{"body":"Ciao."},{"body":"Come va?"}]}'),
           "Ciao. Come va?")
    # Il tipo dichiarato non decide niente: si guarda che cosa e\u0300 arrivato.
    _prova("una trascrizione in HTML passa dall'estrattore vero",
           testo_da_trascrizione(
               "<html><body><article><p>Un paragrafo.</p><p>E un secondo.</p>"
               "</article></body></html>"),
           "Un paragrafo.\n\nE un secondo.")
    _prova("testo semplice resta testo, con gli spazi compressi",
           testo_da_trascrizione("Solo testo,   con   spazi."),
           "Solo testo, con spazi.")
    _prova("byte utf-8 si decodificano", testo_da_trascrizione("pero\u0300 s\u00ec".encode("utf-8")),
           "pero\u0300 s\u00ec")
    _prova("niente non diventa niente", testo_da_trascrizione(None), "")
    # Un JSON che non e\u0300 una trascrizione non e\u0300 il testo di un articolo: una
    # risposta d'errore depositata come testo si leggerebbe in aereo al posto
    # della conferenza, e sarebbe indistinguibile da un guasto dell'app.
    _prova("un JSON che non e\u0300 una trascrizione non diventa testo",
           testo_da_trascrizione('{"errore": "non trovato"}'), "")
    _prova("una trascrizione JSON senza battute utili nemmeno",
           testo_da_trascrizione('{"segments": [{"body": "   "}]}'), "")

    # ------------------------------------------------------- scarica, senza rete
    _solleva("scarica rifiuta uno schema non http", scarica, "ftp://esempio.it/x.pdf")
    _solleva("scarica rifiuta l'indirizzo vuoto", scarica, "")
    _solleva("scarica rifiuta None", scarica, None)

    INDIRIZZO = "http://esempio.it/documento.pdf"
    INTERO = b"%PDF-1.7 corpo intero"

    _prova(
        "corpo completo quanto dichiarato",
        _con_risposta(
            _FintaRisposta(INTERO, Content_Type="application/pdf; charset=binary",
                           Content_Length=str(len(INTERO))),
            scarica, INDIRIZZO),
        (INTERO, "application/pdf"))

    # Il guasto vero: read() torna b"" e http.client non protesta. Senza il
    # confronto finale questo scarico entrava nel deposito lungo 21 byte.
    _solleva(
        "corpo tagliato dalla rete: scartato, non salvato a meta'",
        _con_risposta,
        _FintaRisposta(INTERO, Content_Type="application/pdf", Content_Length="500000"),
        scarica, INDIRIZZO)

    _prova(
        "corpo a pezzi: il Content-Length non fa falso allarme",
        _con_risposta(
            _FintaRisposta(INTERO, Content_Type="application/pdf",
                           Content_Length="500000", Transfer_Encoding="chunked"),
            scarica, INDIRIZZO),
        (INTERO, "application/pdf"))

    _prova(
        "gzip nonostante identity: srotolato, non restituito compresso",
        _con_risposta(
            _FintaRisposta(_gzippa(INTERO), Content_Type="application/pdf",
                           Content_Encoding="gzip"),
            scarica, INDIRIZZO),
        (INTERO, "application/pdf"))

    _prova(
        "deflate con intestazione zlib",
        _con_risposta(
            _FintaRisposta(zlib.compress(INTERO), Content_Type="application/pdf",
                           Content_Encoding="deflate"),
            scarica, INDIRIZZO),
        (INTERO, "application/pdf"))

    _prova(
        "deflate nudo, senza intestazione",
        _con_risposta(
            _FintaRisposta(_gzippa(INTERO, -zlib.MAX_WBITS), Content_Type="application/pdf",
                           Content_Encoding="deflate"),
            scarica, INDIRIZZO),
        (INTERO, "application/pdf"))

    _prova(
        "Content-Encoding: identity si lascia stare",
        _con_risposta(
            _FintaRisposta(INTERO, Content_Type="application/pdf", Content_Encoding="identity"),
            scarica, INDIRIZZO),
        (INTERO, "application/pdf"))

    _solleva(
        "una codifica che non si sa srotolare e' un errore, non byte a caso",
        _con_risposta,
        _FintaRisposta(INTERO, Content_Type="application/pdf", Content_Encoding="br"),
        scarica, INDIRIZZO)

    _solleva(
        "gzip troncato: srotolarlo a meta' sarebbe un file finto",
        _con_risposta,
        _FintaRisposta(_gzippa(INTERO)[:-6], Content_Type="application/pdf",
                       Content_Encoding="gzip"),
        scarica, INDIRIZZO)

    _solleva(
        "gzip dichiarato su byte che non lo sono",
        _con_risposta,
        _FintaRisposta(INTERO, Content_Type="application/pdf", Content_Encoding="gzip"),
        scarica, INDIRIZZO)

    # Un corpo piu' lungo di un blocco fa girare il ciclo di _srotola piu' di
    # una volta: e' li' che un'uscita sbagliata accorcerebbe il documento
    # senza dire niente, ed e' il guasto che il tetto non vedrebbe.
    GROSSO = b"%PDF-1.7 " + b"riga ripetuta del documento\n" * 40000
    _prova(
        "un corpo compresso piu' lungo di un blocco torna intero",
        _con_risposta(
            _FintaRisposta(_gzippa(GROSSO), Content_Type="application/pdf",
                           Content_Encoding="gzip"),
            scarica, INDIRIZZO),
        (GROSSO, "application/pdf"))

    # Un megabyte di zeri sta in pochi kB compressi: il tetto deve valere sui
    # byte srotolati, altrimenti bastano pochi kB per riempire il disco.
    _solleva(
        "bomba: il tetto vale sui byte srotolati",
        _con_risposta,
        _FintaRisposta(_gzippa(b"\0" * (1 << 20)), Content_Type="application/pdf",
                       Content_Encoding="gzip"),
        scarica, INDIRIZZO, 4096)

    # Il recapito dell'ambiente si mette da parte: l'esito non puo' dipendere da
    # come e' configurato il terminale di chi lancia l'autoverifica.
    recapito = os.environ.pop("PERCORSO_CONTATTO", None)
    try:
        _prova("senza recapito l'agente non ne inventa uno",
               _agente(), f"{NOME_AGENTE} (strumento personale di studio)")
        os.environ["PERCORSO_CONTATTO"] = "prova@esempio.it"
        _prova("con recapito l'agente lo dichiara",
               _agente(), f"{NOME_AGENTE} (strumento personale di studio; prova@esempio.it)")
    finally:
        os.environ.pop("PERCORSO_CONTATTO", None)
        if recapito is not None:
            os.environ["PERCORSO_CONTATTO"] = recapito



if __name__ == "__main__":
    _autoverifica()
    for nome, atteso, ottenuto in _ko:
        print(f"FALLITA: {nome}\n  atteso:   {atteso!r}\n  ottenuto: {ottenuto!r}")
    print(f"{_ok} verifiche passate" + (f", {len(_ko)} fallite" if _ko else ""))
    sys.exit(1 if _ko else 0)
