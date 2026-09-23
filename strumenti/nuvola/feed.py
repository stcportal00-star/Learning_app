#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
I feed RSS/Atom dichiarati dall'utente in `percorso.fonti`, nella stessa forma
di voce che usano gli archivi aperti.

    python3 strumenti/nuvola/feed.py      # autoverifica, nessuna rete

Perché questo modulo esiste separato da `rassegna/fonti_aperte.py`: gli archivi
aperti sono un elenco chiuso, scritto nel sorgente e uguale per chiunque; i
feed sono una tabella che l'utente riempie dal telefono. Le due cose cambiano
per motivi diversi e si rompono in modi diversi — un archivio che cade è un
guasto da segnalare, un feed che cade è quasi sempre un indirizzo incollato
male — e tenerle nello stesso file significherebbe che una modifica all'una
può rompere l'altra.

Ciò che invece NON è separato, e non deve esserlo mai, è la forma della voce e
la classificazione: la voce si costruisce con `fonti_aperte.voce()` e i temi si
assegnano con `specializzazioni.classifica()`, esattamente come fa
`catalogo.setaccia()`. Se un articolo arrivasse dal feed di un blog con un
`tema_slug` calcolato in modo diverso da quello dello stesso articolo trovato
su OpenAlex, la libreria dell'app conterrebbe due verità sullo stesso testo.

Le tre regole di questo file, nell'ordine in cui contano:

  1. Un feed rotto non ferma gli altri. Venti fonti sono venti modi di non
     rispondere: si annota il motivo in `rapporto["falliti"]` e si prosegue.
     Una rassegna parziale vale infinitamente più di una giornata persa.

  2. Il tetto di TEMPO conta più del tetto sul numero. Venti feed lenti sono
     venti timeout in fila: senza un orologio la corsa quotidiana muore per
     sfinimento invece che per errore, e nessuno capisce perché.

  3. La categoria che l'utente dichiara nella fonte è un suggerimento, non un
     verdetto. Classifica il testo, non l'etichetta: se le due coincidono la
     voce sale del 20%, ma un feed dichiarato "gdpr" che pubblica ricette non
     entra in libreria sotto "gdpr".
"""
import email.utils
import html
import os
import re
import sys
import time
import urllib.parse
import xml.etree.ElementTree as ET
from datetime import datetime, timezone

QUI = os.path.dirname(os.path.abspath(__file__))
STRUMENTI = os.path.dirname(QUI)
sys.path.insert(0, os.path.join(STRUMENTI, "rassegna"))
sys.path.insert(0, QUI)

import fonti_aperte as fonti  # noqa: E402
from specializzazioni import (classifica, e_pubblicazione,  # noqa: E402
                              normalizza, occorre, trimestre_di)
from cliente import ErroreNuvola  # noqa: E402
from estrattore import ErroreEstrazione, scarica  # noqa: E402

# Un feed è testo: otto megabyte sono già un archivio intero servito per
# sbaglio come feed. Il tetto dell'estrattore (sessanta) è tarato sui PDF e qui
# lascerebbe passare uno scarico da minuti contro il tetto di tempo della corsa.
MASSIMO_BYTE = 8 * 1024 * 1024

# Più corto dei trenta secondi dell'estrattore, per la regola 2: il tetto di
# tempo dev'essere rispettato anche nel caso peggiore, e nel caso peggiore ogni
# fonte costa esattamente un timeout.
TIMEOUT = 20

# Tetto alle righe lette da `percorso.fonti`. Non è una difesa contro l'utente:
# è una difesa contro una query che un giorno perde il filtro e riporta tutto.
MASSIMO_FONTI = 200

# I due metodi che questo modulo sa leggere. `sitemap` non è una fonte di
# secondo ordine: è ciò che `consegna_code/verifica_fonti.py` scrive in
# `url_feed` quando un sito che vale la pena leggere non ha, e non ha mai
# avuto, un feed. Senza questa riga quella riparazione produrrebbe una fonte
# che nessuno legge — una fonte spenta che però risulta attiva.
METODI = ("rss", "sitemap")
PREFISSO_SITEMAP = "sitemap:"

# La cartella del sottosistema di verifica delle fonti. `fonti_core` ci vive
# perché è lo stesso codice che gira ogni settimana in `verifica_fonti.py`:
# una seconda sintesi del sitemap scritta qui dentro sarebbe una seconda
# definizione di «che cosa è un articolo», e divergerebbe dalla prima al primo
# sito che si comporta in modo strano.
CONSEGNA = os.path.join(os.path.dirname(STRUMENTI), "consegna_code")

# I parametri dell'esplorazione vivono in `consegna_code/temi_config.py`, dove
# si cambiano senza toccare il codice. Se quella cartella non c'è, l'esplorazione
# è spenta e basta: cinque voci al giorno scelte con numeri inventati qui
# sarebbero una seconda verità, e una seconda verità è peggio di zero voci.
if CONSEGNA not in sys.path:
    sys.path.insert(0, CONSEGNA)
try:
    import temi_config as _CONF  # noqa: E402
except ImportError:  # pragma: no cover — dipende da come è montato il repository
    _CONF = None

# Lo slug delle voci senza tema che vale comunque la pena leggere. Non è il
# diciottesimo tema: non sta in `modello_temi`, non ha trimestre, e la rilevanza
# è zero apposta — se il tetto degli ottanta articoli taglia, taglia queste per
# prime. È un margine, e un margine che ruba il posto al programma di studio
# smette di essere un margine.
SLUG_ESPLORAZIONE = "esplorazione"

# Quanto sale la rilevanza quando il tema calcolato conferma la categoria che
# l'utente ha dichiarato per quella fonte. Non è una scorciatoia per arrivare
# sopra la soglia — la soglia è già stata superata dal testo — è il peso di una
# informazione che il testo non contiene: l'utente ha scelto quella fonte
# apposta per quell'argomento.
MAGGIORAZIONE_CATEGORIA = 1.2

# Radici che dichiarano di essere un feed. Se la radice è una di queste e non
# ci sono elementi, il feed è semplicemente vuoto — succede ogni notte a
# qualunque blog che non pubblica. Se invece la radice è altro, url_feed punta
# alla pagina sbagliata, ed è un errore da dire.
_RADICI_FEED = ("rss", "feed", "rdf", "channel")

# I `rel` che in Atom non portano all'articolo. "self" è il feed stesso:
# sceglierlo significa depositare in libreria venti voci che puntano tutte
# all'XML invece che ai venti articoli.
_REL_NON_ARTICOLO = frozenset((
    "self", "enclosure", "edit", "edit-media", "replies", "hub", "license",
    "first", "last", "next", "prev", "previous", "payment", "search",
))

# I nomi con cui i tre formati chiamano la data, in ordine di preferenza. Prima
# la data di pubblicazione (pubDate, published, dc:date), poi quelle di
# modifica: `updated` in Atom cambia anche per una correzione di refuso, e
# prenderla per prima farebbe risalire in cima un articolo di tre anni fa.
_CAMPI_DATA = ("pubdate", "published", "date", "issued", "created",
               "updated", "modified")

# I nomi con cui i tre formati chiamano il testo. Si tengono tutti e si sceglie
# il più lungo: `summary` e `content` convivono in Atom, e il secondo è quello
# che vale la pena leggere.
_CAMPI_TESTO = ("description", "summary", "content", "encoded", "abstract")

# `</?[a-zA-Z]` e non `<[^>]+>`: un titolo come "l'analisi in < 5 minuti" ha un
# minore che non apre nessun tag, e la versione ingenua se lo mangia insieme a
# ciò che segue fino al primo maggiore.
_TAG_HTML = re.compile(r"<!--.*?-->|</?[a-zA-Z][^>]*>", re.S)

_ENTITA = re.compile(r"&([A-Za-z][A-Za-z0-9]{1,31});")
_ENTITA_XML = frozenset(("amp", "lt", "gt", "apos", "quot"))
_DICHIARAZIONE = re.compile(r"^<\?xml\b[^>]*\?>")
_CODIFICA_DICHIARATA = re.compile(rb"""^<\?xml[^>]*encoding\s*=\s*["']([\w.\-]+)["']""")


class ErroreFeed(Exception):
    """Il feed non si legge. Non ferma la raccolta: si annota e si prosegue."""


# ------------------------------------------------------------------ lettura XML


def _locale(tag):
    """Il nome del tag senza namespace e in minuscolo.

    In Atom ogni tag è `{http://www.w3.org/2005/Atom}entry`, in RSS 1.0 è
    `{http://purl.org/rss/1.0/}item`, in RSS 2.0 è `item` e basta. Confrontare
    il tag intero significherebbe scrivere tre volte lo stesso lettore.
    """
    if not isinstance(tag, str):
        # I commenti e le istruzioni di elaborazione hanno per tag una
        # funzione, non una stringa: iterando i figli di un elemento capitano.
        return ""
    return tag.rsplit("}", 1)[-1].lower()


def _senza_dichiarazione(testo):
    """Toglie `encoding="..."` dalla dichiarazione XML.

    ElementTree rifiuta una stringa già decodificata che dichiari una codifica
    («Unicode strings with encoding declaration are not supported»), e la
    dichiarazione a quel punto non descrive più niente: la decodifica è fatta.
    """
    return _DICHIARAZIONE.sub(
        lambda m: re.sub(r"\s+encoding\s*=\s*[\"'][^\"']*[\"']", "", m.group(0)),
        testo, count=1)


def _decodifica(dati):
    """Byte -> testo, rispettando la codifica dichiarata nel prologo."""
    if isinstance(dati, str):
        return dati
    dichiarata = _CODIFICA_DICHIARATA.match(dati)
    nome = dichiarata.group(1).decode("ascii", "replace") if dichiarata else "utf-8"
    try:
        return dati.decode(nome, "replace")
    except LookupError:
        # Codifica inventata o scritta male: meglio leggere il feed con qualche
        # accento storto che non leggerlo affatto.
        return dati.decode("utf-8", "replace")


def _ripara_entita(testo):
    """Le entità HTML che l'XML non conosce, rese innocue.

    `&nbsp;` e `&eacute;` sono validi in HTML e illegali in XML: un feed che li
    contiene fa fallire il parser con «undefined entity» e si perderebbe tutto
    per un carattere. Quelle note si sciolgono nel loro carattere, quelle
    ignote si trasformano in testo — non si inventa nulla e non si nasconde
    nulla: `&pippo;` resta visibile così com'è.
    """
    def sostituisci(m):
        if m.group(1) in _ENTITA_XML:
            return m.group(0)
        sciolta = html.unescape(m.group(0))
        return sciolta if sciolta != m.group(0) else "&amp;" + m.group(1) + ";"
    return _ENTITA.sub(sostituisci, testo)


def _radice(dati):
    """Il documento XML, o ErroreFeed con dentro il motivo."""
    grezzo = dati.lstrip() if isinstance(dati, bytes) else None
    if grezzo is None:
        grezzo = _senza_dichiarazione(str(dati).lstrip("﻿ \t\r\n"))
    if not grezzo:
        raise ErroreFeed("feed vuoto: nessun byte da leggere. La fonte ha "
                         "risposto, ma senza corpo.")
    try:
        return ET.fromstring(grezzo)
    except ET.ParseError as primo:
        if "undefined entity" not in str(primo):
            raise ErroreFeed("XML del feed non valido: %s" % primo) from primo
    # Secondo e ultimo tentativo, solo per le entità HTML.
    riparato = _ripara_entita(_senza_dichiarazione(_decodifica(dati).lstrip("﻿ \t\r\n")))
    try:
        return ET.fromstring(riparato)
    except ET.ParseError as secondo:
        raise ErroreFeed(
            "XML del feed non valido anche dopo aver sciolto le entità HTML: "
            "%s" % secondo) from secondo


# --------------------------------------------------------------- testo e campi


def _pulisci(testo):
    """Via i tag HTML, sciolte le entità, spazi collassati.

    L'ordine conta. I tag si tolgono per primi, sul testo che il parser ha già
    sciolto: `<p>` diventa uno spazio e non una parola attaccata alla
    successiva. Le entità si sciolgono dopo, e una seconda volta, perché dentro
    una sezione CDATA il parser XML non le tocca — `&#8217;` arriva qui
    letterale — e perché mezzo mondo pubblica titoli doppiamente sfuggiti
    (`&amp;amp;`).
    """
    if not testo:
        return ""
    senza_tag = _TAG_HTML.sub(" ", str(testo))
    return " ".join(html.unescape(senza_tag).split())


def _testo_di(nodo):
    """Tutto il testo dentro un elemento, figli compresi.

    Serve per `<content type="xhtml">`, che in Atom contiene un albero XHTML
    vero e proprio: leggere solo `.text` restituirebbe la stringa vuota.
    """
    return "".join(nodo.itertext())


def _figli(elemento, nomi):
    """I figli DIRETTI con uno di questi nomi locali.

    Diretti e non discendenti: un `<item>` può contenere `<source><title>` (il
    titolo di un altro feed) e un `<entry>` può contenere `<media:group>`, e
    pescarli con una ricerca profonda significa attribuire alla voce il titolo
    di qualcun altro.
    """
    return [f for f in elemento if _locale(f.tag) in nomi]


def _momento_iso(testo):
    """ISO 8601 -> datetime, con la Z che Python non ha sempre accettato."""
    pulito = testo.strip()
    if pulito[-1:] in ("Z", "z"):
        pulito = pulito[:-1] + "+00:00"
    try:
        momento = datetime.fromisoformat(pulito)
    except ValueError:
        return None
    return momento.astimezone(timezone.utc) if momento.tzinfo is not None else momento


def _data_da(testo):
    """Una data di feed, in qualunque dei formati veri, -> 'AAAA-MM-GG'.

    RSS parla RFC 822 («Mon, 21 Sep 2026 10:00:00 GMT»), Atom parla ISO 8601
    («2026-09-21T10:00:00Z»), dc:date parla ISO 8601 a volte senza orario.

    Quando c'è un fuso si converte a UTC prima di tenere il giorno: la finestra
    della rassegna è calcolata su `time.gmtime`, e una data lasciata nel fuso
    locale della fonte farebbe entrare o uscire dalla finestra gli articoli
    pubblicati a cavallo della mezzanotte.
    """
    t = " ".join((testo or "").split())
    if not t:
        return None
    if re.match(r"^\d{4}-\d{2}-\d{2}", t):
        if len(t) > 10:
            momento = _momento_iso(t)
            if momento is not None:
                return fonti._data_iso(momento.year, momento.month, momento.day)
            # L'orario è illeggibile ma il giorno no: si tiene il giorno.
        return fonti._data_iso(t[0:4], t[5:7], t[8:10])
    try:
        momento = email.utils.parsedate_to_datetime(t)
    except (TypeError, ValueError):
        return None                      # data illeggibile: la voce resta, senza data
    if momento is None:
        return None
    if momento.tzinfo is not None:
        momento = momento.astimezone(timezone.utc)
    return fonti._data_iso(momento.year, momento.month, momento.day)


def _url_da(elemento, url_base):
    """L'indirizzo dell'articolo, risolto contro `url_base`.

    Tre grammatiche diverse per la stessa cosa: in Atom `<link>` è un elemento
    vuoto con l'indirizzo nell'attributo `href` e il ruolo in `rel`; in RSS
    l'indirizzo è il testo del tag; in RSS 1.0 l'elemento `<item>` porta anche
    `rdf:about`. Gli indirizzi relativi sono normali nei feed generati da un
    sito statico, e senza `urljoin` finirebbero in libreria come "/voci/3".
    """
    alternativo, qualunque = None, None
    for collegamento in _figli(elemento, ("link",)):
        indirizzo = (collegamento.get("href") or collegamento.text or "").strip()
        if not indirizzo:
            continue
        ruolo = (collegamento.get("rel") or "").strip().lower()
        if ruolo in _REL_NON_ARTICOLO:
            continue
        if ruolo in ("", "alternate"):
            alternativo = alternativo or indirizzo
        else:
            qualunque = qualunque or indirizzo

    scelto = alternativo or qualunque
    if not scelto:
        # Ripieghi, nell'ordine in cui è probabile che siano un indirizzo vero.
        for figlio in _figli(elemento, ("guid", "id")):
            testo = (figlio.text or "").strip()
            if testo.lower().startswith(("http://", "https://")):
                scelto = testo
                break
    if not scelto:
        about = elemento.get("{http://www.w3.org/1999/02/22-rdf-syntax-ns#}about", "")
        if about.strip().lower().startswith(("http://", "https://")):
            scelto = about.strip()
    if not scelto:
        return None
    return urllib.parse.urljoin(url_base or "", scelto)


def _autori_da(elemento):
    """`<author>`, `<dc:creator>` e, in Atom, `<author><name>`."""
    nomi = []
    for figlio in _figli(elemento, ("author", "creator")):
        nome = ""
        for nipote in figlio:
            if _locale(nipote.tag) == "name":
                nome = _pulisci(_testo_di(nipote))
                break
        nome = _nome_leggibile(nome or _pulisci(_testo_di(figlio)))
        if nome and nome not in nomi:
            nomi.append(nome)
    return nomi


def _nome_leggibile(testo):
    """«redazione@esempio.org (Maria Bianchi)» -> «Maria Bianchi».

    È la forma prescritta da RSS 2.0 per `<author>`, e in libreria un indirizzo
    di posta al posto dell'autore è insieme inutile e sgradevole. Quando c'è
    solo l'indirizzo lo si tiene: è comunque più di niente.
    """
    dentro = re.match(r"^\s*\S+@\S+\s*\((.+)\)\s*$", testo)
    if dentro:
        return dentro.group(1).strip()
    fuori = re.match(r"^(.*?)\s*\(\s*\S+@\S+\s*\)\s*$", testo)
    if fuori and fuori.group(1).strip():
        return fuori.group(1).strip()
    return testo


def _gruppo_media(nodo):
    """Il `<media:group>` della voce, se c'è.

    `_figli` prende solo i figli diretti, e ha ragione: un `<item>` può
    contenere `<source><title>`, che è il titolo di un ALTRO feed. Ma
    `<media:group>` è il blocco della voce stessa — è lì che YouTube mette la
    descrizione del video — e saltarlo significa depositare in libreria
    diecimila voci con il solo titolo. Si scende di un livello, e solo lì.
    """
    gruppi = _figli(nodo, ("group",))
    return gruppi[0] if gruppi else None


def _media_da(nodo, url_base):
    """L'allegato riproducibile della voce: (url, tipo, byte) oppure (None, '', 0).

    Tre grammatiche, di nuovo la stessa cosa: RSS ha `<enclosure>`, Atom ha
    `<link rel="enclosure">`, MRSS ha `<media:content>`.

    Si tiene solo ciò che dichiara `audio/` o `video/`. Il `<media:content>` di
    YouTube punta a un player Flash (`application/x-shockwave-flash`): prenderlo
    per un file da scaricare vuol dire mettere in coda diecimila scarichi che
    falliscono tutti.
    """
    candidati = []
    for figlio in _figli(nodo, ("enclosure",)):
        candidati.append((figlio.get("url"), figlio.get("type"), figlio.get("length")))
    for figlio in _figli(nodo, ("link",)):
        if (figlio.get("rel") or "").strip().lower() == "enclosure":
            candidati.append((figlio.get("href"), figlio.get("type"), figlio.get("length")))
    gruppo = _gruppo_media(nodo)
    for contenitore in (nodo, gruppo) if gruppo is not None else (nodo,):
        for figlio in _figli(contenitore, ("content",)):
            if figlio.get("url"):
                candidati.append((figlio.get("url"), figlio.get("type"),
                                  figlio.get("fileSize") or figlio.get("filesize")))

    for indirizzo, tipo, lunghezza in candidati:
        indirizzo = (indirizzo or "").strip()
        tipo = (tipo or "").strip().lower()
        if not indirizzo or not tipo.startswith(("audio/", "video/")):
            continue
        try:
            byte = max(0, int(str(lunghezza).strip()))
        except (TypeError, ValueError):
            byte = 0
        return urllib.parse.urljoin(url_base or "", indirizzo), tipo, byte
    return None, "", 0


def _trascrizione_da(nodo, url_base):
    """`<podcast:transcript url type>`: la trascrizione che l'AUTORE pubblica.

    È l'unica trascrizione che questo progetto usa. Non se ne generano: una
    trascrizione automatica costa una chiave, una quota e un servizio che un
    giorno risponde 429 — e quel giorno si è in aereo. Qui invece è un file che
    l'editore ha messo online apposta, con la sua licenza.
    """
    for figlio in _figli(nodo, ("transcript",)):
        indirizzo = (figlio.get("url") or "").strip()
        if indirizzo:
            return urllib.parse.urljoin(url_base or "", indirizzo)
    return None


def _elemento_da(nodo, url_base):
    """Un `<item>` o un `<entry>` -> il dizionario documentato in `analizza`."""
    titoli = _figli(nodo, ("title",))
    titolo = _pulisci(_testo_di(titoli[0])) if titoli else ""
    if not titolo:
        # Senza titolo non c'è niente da mostrare né da deduplicare: la chiave
        # della voce si costruisce sul titolo. Si salta, e non è una perdita.
        return None

    data = None
    for campo in _CAMPI_DATA:
        for figlio in _figli(nodo, (campo,)):
            data = _data_da(_testo_di(figlio))
            if data:
                break
        if data:
            break

    fonti_testo = list(_figli(nodo, _CAMPI_TESTO))
    gruppo = _gruppo_media(nodo)
    if gruppo is not None:
        fonti_testo += _figli(gruppo, _CAMPI_TESTO)
    testi = [_pulisci(_testo_di(f)) for f in fonti_testo]
    abstract = max(testi, key=len) if testi else ""

    media, tipo_media, byte_media = _media_da(nodo, url_base)
    return {
        "titolo": titolo,
        "url": _url_da(nodo, url_base),
        "data": data,
        "abstract": abstract,
        "autori": _autori_da(nodo),
        "media": media,
        "tipo_media": tipo_media,
        "byte_media": byte_media,
        "trascrizione": _trascrizione_da(nodo, url_base),
    }


def analizza(dati, url_base=""):
    """Da XML grezzo (byte o testo) alla lista degli elementi del feed.

    Ogni elemento è
        {"titolo": str, "url": str|None, "data": "AAAA-MM-GG"|None,
         "abstract": str, "autori": list[str],
         "media": str|None, "tipo_media": str, "byte_media": int,
         "trascrizione": str|None}

    Legge indifferentemente RSS 2.0 (`<rss><channel><item>`), Atom 1.0
    (`<feed><entry>`, con namespace) e RSS 1.0/RDF (`<rdf:RDF><item>`): i tre
    formati si distinguono solo per i nomi, e i nomi si confrontano senza
    namespace. Un elemento senza titolo si salta; uno senza data si tiene con
    `data` a None, perché una informazione mancante non è un motivo per
    buttare via le altre quattro.
    """
    radice = _radice(dati)

    elementi = []
    for nodo in radice.iter():
        if _locale(nodo.tag) in ("item", "entry"):
            elemento = _elemento_da(nodo, url_base)
            if elemento is not None:
                elementi.append(elemento)

    if not elementi and _locale(radice.tag) not in _RADICI_FEED:
        # Un XML valido che non è un feed è quasi sempre la pagina del sito
        # incollata al posto del feed: dirlo qui risparmia mezz'ora a chi legge
        # il rapporto e vede solo «0 voci».
        raise ErroreFeed(
            "non sembra un feed: la radice è <%s> e non contiene né <item> né "
            "<entry>. Controlla url_feed nella tabella fonti: spesso punta alla "
            "pagina del sito invece che al feed." % (_locale(radice.tag) or "?"))
    return elementi


# --------------------------------------------------------------- scarico


def _sintetizza(url, scadenza=None):
    """Il feed che un sito senza feed non ha: il suo sitemap più le pagine vere.

    `url` è `sitemap:https://sito/`. L'import sta qui dentro e non in testa al
    file per due motivi, entrambi operativi: una fonte `rss` non deve pagare il
    costo di un modulo che non usa, e un giorno in cui `consegna_code/` non ci
    fosse la rassegna deve continuare a leggere i feed normali invece di non
    partire affatto.

    Il timeout globale dei socket si impone e si restituisce: `fonti_core` lo
    imposta a venti secondi all'import — è la sua casa, non la nostra — e il
    resto della conduttura passa un timeout esplicito a ogni urlopen proprio
    per non dipendere da quel valore.
    """
    import socket

    if CONSEGNA not in sys.path:
        sys.path.insert(0, CONSEGNA)
    predefinito = socket.getdefaulttimeout()
    socket.setdefaulttimeout(TIMEOUT)
    try:
        import fonti_core
    except ImportError as e:
        raise ErroreFeed(
            "metodo 'sitemap' non disponibile (%s). Il feed sintetizzato vive in "
            "consegna_code/fonti_core.py: se la cartella non c'è, questa fonte va "
            "messa a attiva=false finché non torna." % e)
    finally:
        socket.setdefaulttimeout(predefinito)

    socket.setdefaulttimeout(TIMEOUT)
    try:
        dati = fonti_core.sintetizar_feed(url[len(PREFISSO_SITEMAP):],
                                          hasta=scadenza)
    finally:
        socket.setdefaulttimeout(predefinito)

    if not dati:
        raise ErroreFeed(
            "il sitemap di %s non ha dato nessun articolo con una data di "
            "pubblicazione affidabile e recente. Non è un guasto di rete: è un "
            "sito che pubblica poco, o che non data le sue pagine."
            % url[len(PREFISSO_SITEMAP):])
    return dati


def scarica_fonte(url, scadenza=None):
    """L'XML di una fonte, qualunque sia il suo metodo. Solleva, non restituisce None.

    Un solo punto per entrambi i metodi: chi legge le fonti — la raccolta
    quotidiana e la diagnosi — non deve sapere che ne esistono due, altrimenti
    il secondo si dimentica in uno dei due posti e la fonte risulta rotta solo
    da una parte.

    `scadenza` è un istante di `time.monotonic()`: la sintesi di un sitemap può
    costare fino a sedici scarichi, e senza tetto si mangerebbe da sola i minuti
    di tutte le altre fonti.
    """
    if url.startswith(PREFISSO_SITEMAP):
        return _sintetizza(url, scadenza)
    dati, _tipo = scarica(url, massimo_byte=MASSIMO_BYTE, timeout=TIMEOUT)
    return dati


# ----------------------------------------------------------------- voci e temi


def voci_da(fonte, dati):
    """Dalla riga di `percorso.fonti` più il suo XML alle voci di catalogo.

    `fonte` è una riga della tabella: nome, url_feed, url_sito, categoria,
    lingua, peso. La voce si costruisce con `fonti_aperte.voce()` e non a mano:
    è quel costruttore a decidere la chiave di deduplicazione, ed è per quella
    chiave che lo stesso articolo trovato domani su OpenAlex non si deposita
    una seconda volta.

    Il campo `fonte` della voce è `rss[<nome>]`: nel rapporto quotidiano, fra
    trenta righe, deve restare scritto da quale feed è arrivata ciascuna.
    """
    nome = " ".join(str(fonte.get("nome") or fonte.get("url_feed") or "feed").split())
    # Gli indirizzi relativi si risolvono contro il sito, non contro il feed,
    # quando il sito è dichiarato: un feed servito da /feed/index.xml con link
    # "../articolo" risolverebbe altrimenti una cartella più in là.
    url_base = (fonte.get("url_sito") or fonte.get("url_feed") or "").strip()

    uscite = []
    for elemento in analizza(dati, url_base):
        v = fonti.voce(
            elemento["titolo"],
            fonte="rss[%s]" % nome,
            url=elemento["url"] or url_base,
            data=elemento["data"],
            autori=elemento["autori"],
            abstract=elemento["abstract"],
            tipo="articolo",
            editore=nome,
        )
        # Due campi in più rispetto alla forma di `voce()`, entrambi
        # informazione della fonte e non della pubblicazione: la categoria
        # dichiarata serve a `classifica_voce`, `fonte_id` serve a chi scriverà
        # `articoli.fonte_id`. Nessuno dei due entra nella classificazione.
        v["categoria_dichiarata"] = fonte.get("categoria") or ""
        if fonte.get("id"):
            v["fonte_id"] = fonte["id"]
        # L'allegato e la trascrizione viaggiano con la voce ma NON entrano
        # nella classificazione: sono modi di consegnare lo stesso contenuto,
        # non informazione su di che cosa parla.
        if elemento["media"]:
            v["url_media"] = elemento["media"]
            v["tipo_media"] = elemento["tipo_media"]
            v["byte_media"] = elemento["byte_media"]
        if elemento["trascrizione"]:
            v["url_trascrizione"] = elemento["trascrizione"]
        uscite.append(v)
    return uscite


def _coincide(tema, categoria):
    """Il tema calcolato e la categoria scritta a mano sono la stessa cosa?

    L'utente scrive «SQL base» dove la tassonomia dice `sql_base`: il confronto
    va fatto sulla forma normalizzata, altrimenti la conferma non scatterebbe
    mai e la maggiorazione sarebbe codice morto.
    """
    def piatto(x):
        return re.sub(r"[^a-z0-9]+", " ", normalizza(x)).strip()
    dichiarata = piatto(categoria)
    return bool(dichiarata) and piatto(tema) == dichiarata


def classifica_voce(v):
    """Assegna temi, punteggi, tema_slug, trimestre e rilevanza. None se scarto.

    È lo stesso blocco di `catalogo.setaccia()`, e deve restare identico: due
    strade che assegnano i temi in due modi diversi sono due librerie diverse
    dentro la stessa app. La voce viene modificata sul posto e restituita.

    Si restituisce None quando nessun tema supera la soglia o quando il titolo
    non è di una pubblicazione (errata, ritrattazioni, indici di fascicolo).

    La categoria dichiarata dall'utente NON entra nel testo classificato: è
    un'etichetta, e un'etichetta che si classificasse da sé renderebbe la
    soglia inutile. Entra solo dopo, come conferma: se il tema calcolato è
    quello dichiarato, la rilevanza sale del 20%.
    """
    titolo = v.get("titolo") or ""
    if not e_pubblicazione(titolo):
        return None

    # `concetti` in un feed è sempre vuoto — nessun blog pubblica i concetti
    # OpenAlex — quindi il punteggio si regge su titolo e abstract soltanto.
    temi = classifica(titolo, v.get("abstract", ""), v.get("concetti", ()))
    if not temi:
        return None

    v["temi"] = [t for t, _ in temi]
    v["punteggi"] = {t: p for t, p in temi}
    v["tema_slug"] = temi[0][0]
    v["trimestre"] = trimestre_di(temi[0][0])
    v["rilevanza"] = round(sum(p for _, p in temi), 3)

    # Basta che la conferma cada su uno qualunque dei temi assegnati: un
    # articolo di inferenza causale su un feed dichiarato "epidemiologia" è
    # confermato anche quando la statistica prende il primo posto.
    categoria = v.get("categoria_dichiarata")
    if categoria and any(_coincide(t, categoria) for t in v["temi"]):
        v["rilevanza"] = round(v["rilevanza"] * MAGGIORAZIONE_CATEGORIA, 3)
    return v


def quota_esplorazione():
    """Quante voci fuori tema al giorno. Zero se i parametri non ci sono."""
    return int(getattr(_CONF, "ESPLORAZIONE_MAX_DIA", 0) or 0)


def segna_esplorazione(v):
    """La voce non ha preso nessun tema: vale comunque una lettura?

    Due vie, e sono diverse apposta. La lunghezza dice che qualcuno ci ha
    lavorato: sotto i millecinquecento caratteri di testo non c'è un articolo,
    c'è un annuncio. I segnali dicono di che GENERE è il pezzo — «lessons
    learned», «post-mortem», «how we built» — e valgono anche corti, perché un
    resoconto di campo scritto stretto resta un resoconto di campo.

    Un errata corrige non entra mai: non ha tema perché non è una
    pubblicazione, ed è il motivo opposto a quello che cerchiamo qui.

    Modifica la voce sul posto e restituisce True quando l'ha presa.
    """
    if not _CONF:
        return False
    titolo = v.get("titolo") or ""
    if not e_pubblicazione(titolo):
        return False
    testo = v.get("abstract") or ""
    minimo = int(getattr(_CONF, "ESPLORAZIONE_MIN_CHARS", 0) or 0)
    segnali = list(getattr(_CONF, "ESPLORAZIONE_SEGNALI", ()) or ())
    dove = normalizza(titolo + " " + testo[:500])
    if len(testo) < minimo and not any(occorre(normalizza(x), dove) for x in segnali):
        return False

    v["temi"] = [SLUG_ESPLORAZIONE]
    v["punteggi"] = {}
    v["tema_slug"] = SLUG_ESPLORAZIONE
    v["trimestre"] = None
    v["rilevanza"] = 0.0
    return True


# ---------------------------------------------------------------- raccolta


def leggi_fonti(nuvola):
    """Le righe di `percorso.fonti` con un metodo leggibile e attiva a vero.

    Ordinate per peso decrescente, e a parità per nome: quando il tetto di
    tempo taglia, deve tagliare le fonti che l'utente ha dichiarato meno
    importanti, e deve tagliare sempre le stesse a parità di peso — una corsa
    che ogni giorno sacrifica una fonte diversa è una corsa senza diagnosi.
    L'ordine si chiede al server e si rifà qui: `order=` in una query è facile
    da perdere in una modifica, e il taglio non deve dipendere da quella riga.
    """
    righe = nuvola.seleziona(
        "fonti",
        "metodo=in.(%s)&attiva=is.true&select=*&order=peso.desc,nome.asc"
        % ",".join(METODI),
        massimo=MASSIMO_FONTI,
    )
    def peso_di(r):
        try:
            return float(r.get("peso") or 0)
        except (TypeError, ValueError):
            return 0.0
    return sorted((r for r in righe if isinstance(r, dict)),
                  key=lambda r: (-peso_di(r), str(r.get("nome") or "")))


def raccogli(nuvola, rapporto, massimo_per_fonte=25, minuti=6, esplorazione=None):
    """Legge le fonti, scarica i feed, costruisce e classifica le voci.

    Restituisce le voci già classificate, pronte a stare accanto a quelle del
    catalogo degli archivi aperti — stessa forma, stessi campi, stessi temi.

    Nel rapporto scrive `feed_letti` (quanti feed hanno risposto e si sono
    letti), `voci_da_feed` (quante voci classificate ne sono uscite: è il
    numero che si confronta con quello del catalogo), `falliti` (una riga per
    ogni fonte che non ha risposto) e `tempo_scaduto`.

    Il tetto di tempo si misura con `time.monotonic()` e non con l'ora del
    giorno: l'orologio di sistema può saltare all'indietro durante la corsa, e
    un tetto che salta all'indietro non è un tetto. Si controlla PRIMA di ogni
    scarico, quindi lo sforamento massimo è un timeout: `minuti` è una promessa
    a meno di venti secondi, non al secondo.
    """
    rapporto.setdefault("falliti", [])
    rapporto.setdefault("feed_letti", 0)
    rapporto.setdefault("voci_da_feed", 0)
    rapporto.setdefault("esplorazione", 0)
    rapporto.setdefault("tempo_scaduto", False)

    # Il tetto è della CORSA, e la corsa è una al giorno: contarlo qui è
    # contarlo al giorno, senza uno stato in più da tenere allineato.
    resta_esplorazione = (quota_esplorazione() if esplorazione is None
                          else int(esplorazione))

    try:
        righe = leggi_fonti(nuvola)
    except ErroreNuvola as e:
        # Senza la tabella non c'è nulla da raccogliere, ma la rassegna degli
        # archivi aperti prosegue: qui si torna a mani vuote, non si solleva.
        rapporto["falliti"].append("lettura di percorso.fonti: %s" % e)
        return []

    scadenza = time.monotonic() + max(0, minuti) * 60
    voci, gia_prese = [], set()

    for indice, fonte in enumerate(righe):
        nome = str(fonte.get("nome") or "(senza nome)")[:60]
        if time.monotonic() >= scadenza:
            rapporto["tempo_scaduto"] = True
            rapporto["falliti"].append(
                "tetto di %d minuti raggiunto: %d fonti non lette (dalla meno "
                "pesante: %s)" % (minuti, len(righe) - indice, nome))
            break

        url = (fonte.get("url_feed") or "").strip()
        if not url:
            rapporto["falliti"].append(
                "%s: metodo '%s' senza url_feed. Aggiungilo nella tabella "
                "fonti, oppure metti attiva=false."
                % (nome, fonte.get("metodo") or "rss"))
            continue

        try:
            dati = scarica_fonte(url, scadenza)
        except (ErroreEstrazione, ErroreFeed) as e:
            rapporto["falliti"].append("%s: %s" % (nome, str(e)[:180]))
            continue

        try:
            grezze = voci_da(fonte, dati)
        except ErroreFeed as e:
            rapporto["falliti"].append("%s: %s" % (nome, str(e)[:180]))
            continue
        except Exception as e:  # noqa: BLE001 — regola 1: un difetto nel lettore
            # di UN feed non deve poter far perdere la giornata agli altri
            # venti. Il tipo dell'eccezione finisce nel rapporto, quindi non
            # viene nascosto: viene isolato.
            rapporto["falliti"].append(
                "%s: lettura interrotta (%s: %s)" % (nome, type(e).__name__, str(e)[:120]))
            continue

        rapporto["feed_letti"] += 1
        for v in grezze[:massimo_per_fonte]:
            # Lo stesso articolo ripubblicato da due feed ha la stessa chiave:
            # si tiene quello della fonte più pesante, che è la prima a passare.
            if v["chiave"] in gia_prese:
                continue
            if classifica_voce(v) is None:
                if resta_esplorazione <= 0 or not segna_esplorazione(v):
                    continue
                resta_esplorazione -= 1
                rapporto["esplorazione"] += 1
            gia_prese.add(v["chiave"])
            voci.append(v)
            rapporto["voci_da_feed"] += 1

    # Ordine deterministico, come il catalogo: rilevanza decrescente, poi
    # chiave. Due corse sugli stessi feed devono produrre lo stesso rapporto.
    voci.sort(key=lambda v: (-v["rilevanza"], v["chiave"]))
    return voci


# ================================================================ autoverifica
#
# Nessuna rete: i feed stanno qui sotto come stringhe, e sono i casi veri che
# rompono i lettori ingenui. Scritti a mano e non scaricati di proposito —
# una verifica che dipende da un feed vivo è una verifica che un giorno
# diventa rossa senza che nessuno abbia toccato niente.

_FEED_RSS2 = """<?xml version="1.0" encoding="utf-8"?>
<rss version="2.0">
  <channel>
    <title>Il giornale dei motori</title>
    <link>https://esempio.org/</link>
    <description>Notizie sui motori di interrogazione</description>
    <lastBuildDate>Mon, 21 Sep 2026 11:00:00 GMT</lastBuildDate>
    <item>
      <title><![CDATA[Query optimization for columnar storage engines]]></title>
      <link>https://esempio.org/articoli/query</link>
      <description><![CDATA[<p>Execution plan and <b>cardinality estimation</b>
      in a vectorized execution engine.</p>]]></description>
      <pubDate>Mon, 21 Sep 2026 10:00:00 GMT</pubDate>
      <author>redazione@esempio.org (Maria Bianchi)</author>
      <guid isPermaLink="false">esempio-org-1</guid>
    </item>
  </channel>
</rss>
"""

_FEED_ATOM = """<?xml version="1.0" encoding="utf-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title>Registro delle uscite</title>
  <link rel="self" href="https://esempio.org/atom.xml"/>
  <updated>2026-09-22T09:00:00Z</updated>
  <entry>
    <title>Causal inference for disease surveillance in cholera outbreaks</title>
    <link rel="self" href="https://esempio.org/atom.xml#1"/>
    <link rel="alternate" type="text/html" href="https://esempio.org/voci/inferenza"/>
    <link rel="enclosure" href="https://esempio.org/voci/inferenza.mp3"/>
    <id>tag:esempio.org,2026:1</id>
    <published>2026-09-21T10:00:00Z</published>
    <updated>2026-09-22T08:30:00Z</updated>
    <author><name>Giulia Verdi</name><email>g@esempio.org</email></author>
    <summary type="html">&lt;p&gt;Estimating the effect with routine
    surveillance data.&lt;/p&gt;</summary>
  </entry>
  <entry>
    <title>Data quality checks that actually run</title>
    <link href="/voci/qualita"/>
    <id>tag:esempio.org,2026:2</id>
    <updated>2026-09-19T12:00:00Z</updated>
    <author><name>Anna Gialli</name></author>
    <content type="xhtml"><div xmlns="http://www.w3.org/1999/xhtml"><p>Record
    <b>linkage</b> and data validation.</p></div></content>
  </entry>
</feed>
"""

_FEED_RDF = """<?xml version="1.0" encoding="utf-8"?>
<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"
         xmlns="http://purl.org/rss/1.0/"
         xmlns:dc="http://purl.org/dc/elements/1.1/">
  <channel rdf:about="https://esempio.org/rdf">
    <title>Archivio RDF</title>
    <link>https://esempio.org/</link>
    <description>Un feed RSS 1.0 come se ne trovano ancora</description>
  </channel>
  <item rdf:about="https://esempio.org/rdf/gdpr">
    <title>Data protection impact assessment in practice</title>
    <link>https://esempio.org/rdf/gdpr</link>
    <description>A guide to the data protection impact assessment.</description>
    <dc:date>2026-09-20</dc:date>
    <dc:creator>Luca Neri</dc:creator>
  </item>
</rdf:RDF>
"""

_FEED_RELATIVI = """<?xml version="1.0" encoding="utf-8"?>
<rss version="2.0">
  <channel>
    <title>Note relative</title>
    <link>/</link>
    <item>
      <title>Star schema, dieci anni dopo</title>
      <link>/note/star-schema.html</link>
      <description>Data modeling con star schema.</description>
      <pubDate>Tue, 22 Sep 2026 06:00:00 +0200</pubDate>
    </item>
    <item>
      <title>Qualita dei dati alla fonte</title>
      <link>../qualita</link>
      <description>Data quality e record linkage.</description>
    </item>
  </channel>
</rss>
"""

_FEED_MANCANTI = """<?xml version="1.0" encoding="utf-8"?>
<rss version="2.0">
  <channel>
    <title>Parziale</title>
    <item>
      <link>https://esempio.org/senza-titolo</link>
      <description>Questo elemento non ha titolo e va saltato.</description>
      <pubDate>Mon, 21 Sep 2026 10:00:00 GMT</pubDate>
    </item>
    <item>
      <title>Un articolo senza data</title>
      <link>https://esempio.org/senza-data</link>
      <description>Nessuna data qui dentro.</description>
    </item>
  </channel>
</rss>
"""

_FEED_ENTITA = """<?xml version="1.0" encoding="utf-8"?>
<rss version="2.0">
  <channel>
    <title>Entita</title>
    <item>
      <title>Dati &amp; metodi: l&#8217;analisi in &lt; 5 minuti</title>
      <link>https://esempio.org/entita</link>
      <description><![CDATA[Virgolette &amp; simboli: l&#8217;abstract.]]></description>
    </item>
  </channel>
</rss>
"""

_FEED_ENTITA_HTML = """<?xml version="1.0" encoding="utf-8"?>
<rss version="2.0">
  <channel>
    <title>Entita HTML</title>
    <item>
      <title>Data quality&nbsp;&amp; caf&eacute;</title>
      <link>https://esempio.org/html</link>
      <description>Segno ignoto: &pippo; e nient'altro.</description>
    </item>
  </channel>
</rss>
"""

_FEED_ROTTO = """<?xml version="1.0" encoding="utf-8"?>
<rss version="2.0"><channel><item><title>Mai chiuso</title></channel></rss>
"""

_FEED_NON_FEED = """<?xml version="1.0" encoding="utf-8"?>
<html xmlns="http://www.w3.org/1999/xhtml">
  <head><title>Il giornale dei motori</title></head>
  <body><h1>Benvenuto</h1><p>Questa e' la pagina, non il feed.</p></body>
</html>
"""

# Il feed di un canale YouTube, nella forma vera. Due trappole in una: la
# descrizione — cioè tutto il testo che esiste — sta dentro <media:group>, e il
# <media:content> di quel gruppo NON è un file ma un player Flash.
_FEED_YOUTUBE = """<?xml version="1.0" encoding="utf-8"?>
<feed xmlns:yt="http://www.youtube.com/xml/schemas/2015"
      xmlns:media="http://search.yahoo.com/mrss/"
      xmlns="http://www.w3.org/2005/Atom">
  <title>Un canale qualunque</title>
  <link rel="alternate" href="https://www.youtube.com/channel/UCx"/>
  <entry>
    <id>yt:video:AbCdEf</id>
    <yt:videoId>AbCdEf</yt:videoId>
    <title>Cardinality estimation explained, with real query plans</title>
    <link rel="alternate" href="https://www.youtube.com/watch?v=AbCdEf"/>
    <author><name>Chi parla</name></author>
    <published>2026-09-20T15:00:00+00:00</published>
    <updated>2026-09-21T09:00:00+00:00</updated>
    <media:group>
      <media:title>Cardinality estimation explained, with real query plans</media:title>
      <media:content url="https://www.youtube.com/v/AbCdEf?version=3"
                     type="application/x-shockwave-flash" width="640" height="390"/>
      <media:thumbnail url="https://i4.ytimg.com/vi/AbCdEf/hqdefault.jpg"/>
      <media:description>Why the optimizer gets row counts wrong, how the
      execution plan changes, and what a columnar storage engine does
      differently.</media:description>
    </media:group>
  </entry>
</feed>
"""

# Un podcast con il namespace di Podcast Index: allegato riproducibile e
# trascrizione pubblicata dall'autore, che è l'unica che questo progetto usa.
_FEED_PODCAST = """<?xml version="1.0" encoding="utf-8"?>
<rss version="2.0" xmlns:podcast="https://podcastindex.org/namespace/1.0">
  <channel>
    <title>Un podcast</title>
    <link>https://pod.example/</link>
    <item>
      <title>Data protection impact assessment, in practice</title>
      <link>https://pod.example/ep/12</link>
      <pubDate>Sun, 20 Sep 2026 10:00:00 GMT</pubDate>
      <description>Lawful basis, data minimisation and the humanitarian case.</description>
      <enclosure url="https://pod.example/ep/12.mp3" type="audio/mpeg" length="41231234"/>
      <podcast:transcript url="/ep/12.vtt" type="text/vtt"/>
    </item>
    <item>
      <title>Un episodio con un allegato che non è un file</title>
      <link>https://pod.example/ep/13</link>
      <pubDate>Sat, 19 Sep 2026 10:00:00 GMT</pubDate>
      <description>Record linkage and data validation in practice.</description>
      <enclosure url="https://pod.example/ep/13.html" type="text/html" length="900"/>
    </item>
  </channel>
</rss>
"""

_FEED_VUOTO = """<?xml version="1.0" encoding="utf-8"?>
<rss version="2.0">
  <channel>
    <title>Niente, oggi</title>
    <link>https://esempio.org/</link>
    <description>Un feed vivo che stanotte non ha pubblicato nulla</description>
  </channel>
</rss>
"""

_FEED_DATE = """<?xml version="1.0" encoding="utf-8"?>
<rss version="2.0" xmlns:dc="http://purl.org/dc/elements/1.1/">
  <channel>
    <title>Tutte le date del mondo</title>
    <item><title>RFC 822 con GMT</title><link>https://esempio.org/1</link>
      <pubDate>Mon, 21 Sep 2026 10:00:00 GMT</pubDate></item>
    <item><title>ISO 8601 con la Z</title><link>https://esempio.org/2</link>
      <dc:date>2026-09-22T10:00:00Z</dc:date></item>
    <item><title>Solo il giorno</title><link>https://esempio.org/3</link>
      <dc:date>2026-09-23</dc:date></item>
    <item><title>RFC 822 con fuso, prima di mezzanotte a Greenwich</title>
      <link>https://esempio.org/4</link>
      <pubDate>Wed, 23 Sep 2026 01:30:00 +0200</pubDate></item>
    <item><title>Data illeggibile</title><link>https://esempio.org/5</link>
      <pubDate>giovedi prossimo</pubDate></item>
  </channel>
</rss>
"""

_passate = 0
_guasti = []


def _prova(nome, ottenuto, atteso):
    global _passate
    if ottenuto == atteso:
        _passate += 1
    else:
        _guasti.append("%s\n    atteso  : %r\n    ottenuto: %r" % (nome, atteso, ottenuto))


def _prova_inizio(nome, ottenuto, atteso):
    """Come `_prova`, ma sull'inizio di un messaggio.

    Dei messaggi d'errore si promette il principio — quello scritto qui dentro
    — e non la coda, che contiene righe e colonne del parser: confrontarla per
    intero farebbe diventare rossa la verifica al prossimo Python.
    """
    _prova(nome, (ottenuto or "")[:len(atteso)], atteso)


def _esito(funzione, *argomenti, **parole):
    """Il risultato, oppure «Eccezione: messaggio». Mai una traccia di stack."""
    try:
        return funzione(*argomenti, **parole)
    except Exception as e:
        return "%s: %s" % (type(e).__name__, e)


class _FintaNuvola:
    """Un `Nuvola` che non tocca la rete: restituisce le righe che gli si danno."""

    def __init__(self, righe, guasto=None):
        self.righe = righe
        self.guasto = guasto
        self.richieste = []

    def seleziona(self, tabella, query="", massimo=1000):
        self.richieste.append((tabella, query, massimo))
        if self.guasto is not None:
            raise self.guasto
        return [dict(r) for r in self.righe]


def _autoverifica():
    global _passate

    # I quattro campi dell'allegato si confrontano per intero anche qui, dove
    # non c'è nessun allegato: è il modo di accorgersi il giorno in cui un feed
    # normale cominciasse a produrne uno per sbaglio.
    SENZA_ALLEGATO = {"media": None, "tipo_media": "", "byte_media": 0,
                      "trascrizione": None}

    # ---------------------------------------------------- 1. RSS 2.0 completo
    _prova(
        "RSS 2.0: CDATA nel titolo, HTML nella description, pubDate RFC 822",
        analizza(_FEED_RSS2),
        [{"titolo": "Query optimization for columnar storage engines",
          "url": "https://esempio.org/articoli/query",
          "data": "2026-09-21",
          "abstract": "Execution plan and cardinality estimation in a vectorized "
                      "execution engine.",
          "autori": ["Maria Bianchi"], **SENZA_ALLEGATO}])

    # ------------------------------------------------- 2. Atom 1.0 con namespace
    _prova(
        "Atom 1.0: rel=alternate vinto su rel=self, published vinto su updated",
        analizza(_FEED_ATOM, "https://esempio.org/"),
        [{"titolo": "Causal inference for disease surveillance in cholera outbreaks",
          "url": "https://esempio.org/voci/inferenza",
          "data": "2026-09-21",
          "abstract": "Estimating the effect with routine surveillance data.",
          "autori": ["Giulia Verdi"], **SENZA_ALLEGATO},
         {"titolo": "Data quality checks that actually run",
          "url": "https://esempio.org/voci/qualita",
          "data": "2026-09-19",
          "abstract": "Record linkage and data validation.",
          "autori": ["Anna Gialli"], **SENZA_ALLEGATO}])

    # ------------------------------------------------------- 3. RSS 1.0 / RDF
    _prova(
        "RSS 1.0/RDF: dc:date e dc:creator dietro il namespace Dublin Core",
        analizza(_FEED_RDF),
        [{"titolo": "Data protection impact assessment in practice",
          "url": "https://esempio.org/rdf/gdpr",
          "data": "2026-09-20",
          "abstract": "A guide to the data protection impact assessment.",
          "autori": ["Luca Neri"], **SENZA_ALLEGATO}])

    # ----------------------------------------------------- 4. url relativi
    _prova(
        "gli url relativi si risolvono contro url_base",
        [e["url"] for e in analizza(_FEED_RELATIVI, "https://esempio.org/blog/")],
        ["https://esempio.org/note/star-schema.html", "https://esempio.org/qualita"])
    _prova(
        "senza url_base l'indirizzo relativo resta com'è, e non si inventa un sito",
        [e["url"] for e in analizza(_FEED_RELATIVI)],
        ["/note/star-schema.html", "../qualita"])

    # ------------------------------------------- 5. senza titolo / senza data
    _prova(
        "l'elemento senza titolo si salta, quello senza data si tiene",
        [(e["titolo"], e["data"]) for e in analizza(_FEED_MANCANTI)],
        [("Un articolo senza data", None)])

    # ------------------------------------------------------- 6. entità HTML
    _prova(
        "le entità nel titolo si sciolgono, il minore isolato non è un tag",
        [(e["titolo"], e["abstract"]) for e in analizza(_FEED_ENTITA)],
        [("Dati & metodi: l’analisi in < 5 minuti",
          "Virgolette & simboli: l’abstract.")])
    _prova(
        "le entità HTML illegali in XML non buttano via il feed",
        [(e["titolo"], e["abstract"]) for e in analizza(_FEED_ENTITA_HTML)],
        [("Data quality & café", "Segno ignoto: &pippo; e nient'altro.")])

    # ------------------------------------------------------ 7. XML malformato
    rotto = _esito(analizza, _FEED_ROTTO)
    _prova_inizio("XML malformato: ErroreFeed", rotto,
                  "ErroreFeed: XML del feed non valido:")
    _prova("e il messaggio dice cosa non torna", "mismatched tag" in rotto, True)

    # ------------------------------------------------- 8. XML valido, non feed
    non_feed = _esito(analizza, _FEED_NON_FEED)
    _prova_inizio("una pagina XHTML al posto del feed: ErroreFeed, non una traccia",
                  non_feed, "ErroreFeed: non sembra un feed: la radice è <html>")
    _prova("e il messaggio dice dove guardare", "url_feed" in non_feed, True)

    # ------------------------------------------------------- 9. feed vuoto
    _prova("un channel senza item è una lista vuota, non un errore",
           analizza(_FEED_VUOTO), [])

    # ------------------------------------------------------ 10. le date vere
    _prova(
        "RFC 822, ISO 8601 con Z, solo il giorno, fuso orario e spazzatura",
        [(e["titolo"], e["data"]) for e in analizza(_FEED_DATE)],
        [("RFC 822 con GMT", "2026-09-21"),
         ("ISO 8601 con la Z", "2026-09-22"),
         ("Solo il giorno", "2026-09-23"),
         ("RFC 822 con fuso, prima di mezzanotte a Greenwich", "2026-09-22"),
         ("Data illeggibile", None)])

    # ------------------------------------------------------------ voci_da
    motori = {"id": "f-1", "nome": "Blog dei motori", "url_feed": "https://a/rss",
              "url_sito": "https://esempio.org/", "categoria": "ottimizzazione",
              "lingua": "en", "peso": 0.9, "metodo": "rss", "attiva": True}
    voci = voci_da(motori, _FEED_RSS2)
    _prova("voci_da costruisce una voce sola", len(voci), 1)
    _prova("il campo fonte dice da quale feed arriva",
           voci[0]["fonte"], "rss[Blog dei motori]")
    _prova("la chiave è quella di fonti_aperte.chiave_di",
           voci[0]["chiave"],
           fonti.chiave_di(None, "Query optimization for columnar storage engines"))
    _prova("tipo, concetti e doi sono quelli di una voce di feed",
           (voci[0]["tipo"], voci[0]["concetti"], voci[0]["doi"]),
           ("articolo", [], None))
    _prova("la categoria dichiarata viaggia con la voce, fuori dalla forma di voce()",
           voci[0]["categoria_dichiarata"], "ottimizzazione")
    _prova("voci_da regge anche i byte, non solo il testo",
           voci_da(motori, _FEED_RSS2.encode("utf-8"))[0]["titolo"],
           "Query optimization for columnar storage engines")

    # --------------------------------------------- YouTube e podcast
    #
    # Un canale YouTube è un feed Atom ufficiale: nessuna chiave, nessuno
    # strumento esterno. Ma tutto il testo che esiste sta in
    # <media:group><media:description>, e prendendo solo i figli diretti la
    # voce arriva in libreria con il titolo e basta. Misurato: 1,8 di rilevanza
    # senza la descrizione, 4,2 con — la stessa voce, due destini diversi
    # quando il tetto degli ottanta taglia.
    canale = {"id": "f-y", "nome": "Chi parla",
              "url_feed": "https://www.youtube.com/feeds/videos.xml?channel_id=UCx",
              "url_sito": "https://www.youtube.com/channel/UCx",
              "categoria": "ottimizzazione", "lingua": "en", "peso": 0.5,
              "metodo": "rss", "attiva": True}
    video = classifica_voce(voci_da(canale, _FEED_YOUTUBE)[0])
    _prova("la descrizione di un video YouTube non si perde",
           (video["abstract"][:40], video["rilevanza"]),
           ("Why the optimizer gets row counts wrong,", 4.2))
    _prova("e il player Flash di <media:content> non è un file da scaricare",
           ("url_media" in video, video["url"]),
           (False, "https://www.youtube.com/watch?v=AbCdEf"))

    podcast = {"id": "f-p", "nome": "Un podcast", "url_feed": "https://pod.example/rss",
               "url_sito": "https://pod.example/", "categoria": "gdpr",
               "lingua": "en", "peso": 0.5, "metodo": "rss", "attiva": True}
    episodi = voci_da(podcast, _FEED_PODCAST)
    _prova("l'allegato di un podcast viaggia con la voce, con tipo e peso",
           (episodi[0]["url_media"], episodi[0]["tipo_media"], episodi[0]["byte_media"]),
           ("https://pod.example/ep/12.mp3", "audio/mpeg", 41231234))
    _prova("la trascrizione pubblicata dall'autore si risolve contro il sito",
           episodi[0]["url_trascrizione"], "https://pod.example/ep/12.vtt")
    _prova("un allegato che non è audio né video non diventa uno scarico",
           ("url_media" in episodi[1], "url_trascrizione" in episodi[1]),
           (False, False))

    # ------------------------------------------------------- classifica_voce
    classificata = classifica_voce(voci_da(motori, _FEED_RSS2)[0])
    _prova("una voce su SQL riceve un tema, con trimestre e punteggi",
           (classificata["tema_slug"], classificata["trimestre"],
            classificata["temi"], classificata["punteggi"]),
           ("ottimizzazione", "T1", ["ottimizzazione"], {"ottimizzazione": 4.5}))
    # 4,5 è la somma dei punteggi: «columnar storage» nel titolo vale 1,5,
    # «execution plan», «cardinality estimation» e «vectorized execution»
    # nell'abstract valgono 1,0 ciascuno. La categoria dichiarata coincide con
    # il tema: 4,5 x 1,2 = 5,4.
    _prova("la categoria dichiarata che conferma il tema alza la rilevanza del 20%",
           classificata["rilevanza"], 5.4)

    altra_categoria = dict(motori, categoria="gdpr")
    non_confermata = classifica_voce(voci_da(altra_categoria, _FEED_RSS2)[0])
    _prova("una categoria che non c'entra non sposta il tema e non alza nulla",
           (non_confermata["tema_slug"], non_confermata["rilevanza"]),
           ("ottimizzazione", 4.5))

    cucina = fonti.voce("Le ricette della nonna: la carbonara perfetta",
                        fonte="rss[Cucina]", url="https://esempio.org/carbonara",
                        abstract="Uova, guanciale e pecorino, nient'altro.")
    cucina["categoria_dichiarata"] = "sql_base"
    _prova("una voce di cucina non entra in libreria, nemmeno se dichiarata sql_base",
           classifica_voce(cucina), None)

    errata = fonti.voce("Erratum: query optimization for columnar storage engines",
                        fonte="rss[Motori]", url="https://esempio.org/err",
                        abstract="Execution plan and cardinality estimation.")
    _prova("un errata corrige non è una pubblicazione, per quanto sia in tema",
           classifica_voce(errata), None)

    # ---------------------------------------------------------- leggi_fonti
    epidemie = {"id": "f-2", "nome": "Epidemie", "url_feed": "https://c/atom",
                "url_sito": "https://esempio.org/", "categoria": "epidemiologia",
                "lingua": "en", "peso": 0.7, "metodo": "rss", "attiva": True}
    rotta = {"id": "f-3", "nome": "Fonte rotta", "url_feed": "https://b/rss",
             "url_sito": "", "categoria": "sicurezza", "lingua": "en",
             "peso": 0.5, "metodo": "rss", "attiva": True}
    muta = {"id": "f-4", "nome": "Senza indirizzo", "url_feed": "",
            "url_sito": "", "categoria": "kpi", "lingua": "it",
            "peso": 0.1, "metodo": "rss", "attiva": True}

    finta = _FintaNuvola([rotta, motori, muta, epidemie])
    _prova("leggi_fonti ordina per peso decrescente",
           [f["nome"] for f in leggi_fonti(finta)],
           ["Blog dei motori", "Epidemie", "Fonte rotta", "Senza indirizzo"])
    _prova("e chiede al server le fonti attive di entrambi i metodi",
           finta.richieste,
           [("fonti", "metodo=in.(rss,sitemap)&attiva=is.true&select=*&order=peso.desc,nome.asc",
             MASSIMO_FONTI)])

    # ------------------------------------------------------------- raccogli
    risposte = {"https://a/rss": _FEED_RSS2, "https://c/atom": _FEED_ATOM}

    def finto_scarica(url, massimo_byte=None, timeout=None):
        if url not in risposte:
            raise ErroreEstrazione("%s non raggiungibile: fonte spenta." % url)
        return risposte[url].encode("utf-8"), "application/xml"

    vero_scarica = globals()["scarica"]
    globals()["scarica"] = finto_scarica
    try:
        rapporto = {"falliti": [], "tempo_scaduto": False}
        raccolte = raccogli(_FintaNuvola([rotta, motori, muta, epidemie]), rapporto)
        # Epidemie dichiara "epidemiologia" e il primo tema è quello: nel titolo
        # «disease surveillance», «cholera» e «outbreaks» sono tre termini forti
        # (1,5 l'uno) più «surveillance» debole (0,6), cioè 5,1; «causal
        # inference» porta statistica a 1,5. Somma 6,6, per 1,2 fa 7,92. La
        # seconda voce dello stesso feed parla di qualità dei dati, che la
        # categoria non conferma: «data quality» nel titolo 1,5, «record
        # linkage» e «data validation» nel sommario 1,0 l'uno, «validation»
        # debole 0,4 — resta 3,9.
        _prova("le voci arrivano classificate e in ordine di rilevanza",
               [(v["titolo"], v["rilevanza"], v["fonte"]) for v in raccolte],
               [("Causal inference for disease surveillance in cholera outbreaks",
                 7.92, "rss[Epidemie]"),
                ("Query optimization for columnar storage engines", 5.4,
                 "rss[Blog dei motori]"),
                ("Data quality checks that actually run", 3.9, "rss[Epidemie]")])
        _prova("due feed letti su quattro fonti", rapporto["feed_letti"], 2)
        _prova("e tre voci contate", rapporto["voci_da_feed"], 3)
        _prova("la fonte rotta e quella senza indirizzo sono annotate, non sollevate",
               len(rapporto["falliti"]), 2)
        _prova_inizio("la fonte rotta è nominata nel rapporto",
                      rapporto["falliti"][0], "Fonte rotta:")
        _prova("chi non ha url_feed sa cosa gli manca",
               "senza url_feed" in rapporto["falliti"][1], True)
        _prova("il tempo non è scaduto", rapporto["tempo_scaduto"], False)

        # Un feed che non è un feed: annotato come gli altri, e la raccolta
        # prosegue. È la regola 1 vista dall'altro lato, quello del lettore.
        risposte["https://b/rss"] = _FEED_NON_FEED
        rapporto2 = {"falliti": [], "tempo_scaduto": False}
        raccolte2 = raccogli(_FintaNuvola([rotta, motori]), rapporto2)
        _prova("una pagina al posto del feed non ferma le altre fonti",
               (len(raccolte2), rapporto2["feed_letti"]), (1, 1))
        _prova("e finisce nei falliti con il motivo",
               "non sembra un feed" in rapporto2["falliti"][0], True)
        del risposte["https://b/rss"]

        # Tetto di tempo a zero: si esce prima del primo scarico. È il caso che
        # conta, perché è quello in cui il tetto deve valere più del numero.
        rapporto3 = {"falliti": [], "tempo_scaduto": False}
        raccolte3 = raccogli(_FintaNuvola([motori, epidemie]), rapporto3, minuti=0)
        _prova("con il tetto di tempo esaurito non si scarica nulla",
               (raccolte3, rapporto3["feed_letti"], rapporto3["tempo_scaduto"]),
               ([], 0, True))
        _prova_inizio("e il rapporto dice quante fonti sono rimaste fuori",
                      rapporto3["falliti"][0],
                      "tetto di 0 minuti raggiunto: 2 fonti non lette")

        # Supabase muta: niente voci, nessuna eccezione fuori da qui.
        rapporto4 = {"falliti": [], "tempo_scaduto": False}
        muta_nuvola = _FintaNuvola([], guasto=ErroreNuvola("tabella sconosciuta", 404))
        _prova("se percorso.fonti non si legge, la rassegna prosegue senza feed",
               raccogli(muta_nuvola, rapporto4), [])
        _prova_inizio("e il motivo resta scritto",
                      rapporto4["falliti"][0], "lettura di percorso.fonti: ")

        # ------------------------------------------------- esplorazione
        #
        # Dodici voci fuori tema: dieci lunghe abbastanza da essere articoli,
        # una corta con un segnale di genere, una che è un errata corrige. Il
        # tetto è cinque, e deve essere cinque esatte: una quota che si sfora
        # di una voce al giorno sono trentun voci al mese fuori programma.
        _CUCINA = "Uova, guanciale e pecorino romano, mantecati fuori dal fuoco. " * 30
        _VOCI_FUORI_TEMA = "".join(
            "<item><title>La carbonara della nonna, puntata %d</title>"
            "<link>https://cucina.example/p%d</link>"
            "<pubDate>Mon, 21 Sep 2026 10:00:00 GMT</pubDate>"
            "<description>%s</description></item>" % (i, i, _CUCINA)
            for i in range(10))
        _FEED_FUORI_TEMA = (
            '<?xml version="1.0"?><rss version="2.0"><channel>'
            "<title>Cucina</title><link>https://cucina.example/</link>"
            + _VOCI_FUORI_TEMA
            + "<item><title>Due righe sul pane</title>"
              "<link>https://cucina.example/pane</link>"
              "<pubDate>Mon, 21 Sep 2026 10:00:00 GMT</pubDate>"
              "<description>Poche righe, niente da studiare.</description></item>"
              "<item><title>Erratum: la carbonara della nonna</title>"
              "<link>https://cucina.example/err</link>"
              "<pubDate>Mon, 21 Sep 2026 10:00:00 GMT</pubDate>"
              "<description>%s</description></item>" % _CUCINA
            + "</channel></rss>")

        cucina = {"id": "f-9", "nome": "Cucina", "url_feed": "https://d/rss",
                  "url_sito": "https://cucina.example/", "categoria": "",
                  "lingua": "it", "peso": 0.2, "metodo": "rss", "attiva": True}
        risposte["https://d/rss"] = _FEED_FUORI_TEMA
        rapporto7 = {"falliti": [], "tempo_scaduto": False}
        raccolte7 = raccogli(_FintaNuvola([cucina]), rapporto7)
        _prova("di dodici voci senza tema ne entrano esattamente cinque",
               (len(raccolte7), rapporto7["esplorazione"]), (5, 5))
        _prova("stanno sotto lo slug dell'esplorazione, senza trimestre",
               sorted({(v["tema_slug"], v["trimestre"], v["rilevanza"])
                       for v in raccolte7}),
               [("esplorazione", None, 0.0)])
        _prova("la voce di due righe non è un articolo e resta fuori",
               [v for v in raccolte7 if "pane" in v["titolo"]], [])
        _prova("e un errata corrige non diventa esplorazione",
               [v for v in raccolte7 if v["titolo"].startswith("Erratum")], [])

        # Un segnale di genere vale anche su un testo corto: un resoconto di
        # campo scritto stretto resta un resoconto di campo.
        corta = fonti.voce("Lessons learned da una cucina di paese",
                           fonte="rss[Cucina]", url="https://cucina.example/l",
                           abstract="Poche righe.")
        _prova("un segnale di genere basta anche senza lunghezza",
               (segna_esplorazione(corta), corta["tema_slug"]),
               (True, "esplorazione"))

        # Tetto a zero: nessuna voce fuori tema, e nessuna eccezione.
        rapporto8 = {"falliti": [], "tempo_scaduto": False}
        _prova("con il tetto a zero l'esplorazione è spenta",
               (raccogli(_FintaNuvola([cucina]), rapporto8, esplorazione=0),
                rapporto8["esplorazione"]), ([], 0))
        del risposte["https://d/rss"]

        # ------------------------------------------------ metodo 'sitemap'
        #
        # Il sito che non ha mai avuto un feed. `verifica_fonti.py` gli ha
        # scritto `sitemap:` in url_feed, e da questa riga in giù deve
        # comportarsi come qualunque altra fonte: stessa voce, stesso tema,
        # stessa rilevanza. Si simula la RETE di `fonti_core`, non la sintesi:
        # è la sintesi vera che deve produrre le voci, altrimenti la prova
        # direbbe soltanto che so scrivere un finto.
        sys.path.insert(0, CONSEGNA)
        import fonti_core

        def _quando(giorni):
            return time.strftime("%Y-%m-%dT%H:%M:%SZ",
                                 time.gmtime(time.time() - giorni * 86400))

        _CORPO = ("Execution plan and cardinality estimation in a vectorized "
                  "execution engine over columnar storage. ") * 30
        _PAGINE = {
            "https://senzafeed.org/robots.txt": b"Sitemap: https://senzafeed.org/sm.xml",
            "https://senzafeed.org/sm.xml": ("<urlset>" + "".join(
                "<url><loc>https://senzafeed.org/post/piano-%d</loc>"
                "<lastmod>2026-01-01</lastmod></url>" % i for i in range(3)
            ) + "</urlset>").encode("utf-8"),
        }
        for i in range(3):
            _PAGINE["https://senzafeed.org/post/piano-%d" % i] = (
                '<meta property="og:title" content="Query plan regressions, part %d">'
                '<meta property="article:published_time" content="%s">'
                "<article>%s</article>" % (i, _quando(i + 1), _CORPO)
            ).encode("utf-8")

        vera_rete = fonti_core.fetch
        fonti_core.fetch = lambda u, limit=0: (
            fonti_core.Resp(200, u, body=_PAGINE[u]) if u in _PAGINE
            else fonti_core.Resp(404, u, error="HTTP 404"))
        try:
            senza = {"id": "f-5", "nome": "Sito senza feed",
                     "url_feed": "sitemap:https://senzafeed.org/",
                     "url_sito": "https://senzafeed.org/",
                     "categoria": "ottimizzazione", "lingua": "en",
                     "peso": 0.9, "metodo": "sitemap", "attiva": True}
            rapporto5 = {"falliti": [], "tempo_scaduto": False}
            raccolte5 = raccogli(_FintaNuvola([senza]), rapporto5)
            _prova("una fonte 'sitemap:' entra nella conduttura come le altre",
                   ([v["titolo"] for v in raccolte5], rapporto5["feed_letti"],
                    rapporto5["voci_da_feed"], rapporto5["falliti"]),
                   (["Query plan regressions, part 0",
                     "Query plan regressions, part 1",
                     "Query plan regressions, part 2"], 1, 3, []))
            _prova("e le sue voci portano la fonte e il tema, come una rss",
                   (raccolte5[0]["fonte"], raccolte5[0]["tema_slug"],
                    raccolte5[0]["fonte_id"]),
                   ("rss[Sito senza feed]", "ottimizzazione", "f-5"))

            # Il sito c'è ma non pubblica: nessuna data affidabile e recente.
            # È un rifiuto motivato, non un guasto di rete, e la differenza
            # deve restare leggibile nel rapporto di domattina.
            _PAGINE["https://senzafeed.org/sm.xml"] = b"<urlset></urlset>"
            rapporto6 = {"falliti": [], "tempo_scaduto": False}
            raccolte6 = raccogli(_FintaNuvola([senza]), rapporto6)
            _prova("un sitemap senza articoli databili è annotato, non sollevato",
                   (raccolte6, rapporto6["feed_letti"], len(rapporto6["falliti"])),
                   ([], 0, 1))
            _prova("e il motivo dice che non è la rete",
                   "data di pubblicazione affidabile" in rapporto6["falliti"][0],
                   True)
        finally:
            fonti_core.fetch = vera_rete
    finally:
        globals()["scarica"] = vero_scarica

    # ---------------------------------------------------------------- esito
    if _guasti:
        print("VERIFICA DEI FEED: ROSSA\n")
        for g in _guasti:
            print("  ✗ " + g)
        print("\n%d verifiche passate, %d fallite" % (_passate, len(_guasti)))
        return 1
    print("%d verifiche passate" % _passate)
    return 0


if __name__ == "__main__":
    sys.exit(_autoverifica())
