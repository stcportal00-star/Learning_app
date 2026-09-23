#!/usr/bin/env python3
"""
Giro completo della conduttura contro un finto Supabase, in locale.

Perché esiste: `verifica_nuvola.py` prova le funzioni pure, ma il modo in cui
questa conduttura può rompersi davvero non è una funzione sbagliata — è un
accordo sbagliato fra due parti. Un `on_conflict` con il nome di colonna
storto, un'intestazione `Content-Profile` dimenticata, un payload mandato come
stringa invece che come oggetto: tutte cose che passano ogni verifica di unità
e poi falliscono alla prima corsa vera, di notte, senza nessuno che guardi.

Qui si alza un server HTTP vero sulla porta di sistema, gli si fa credere di
essere PostgREST e Storage, e ci si fa passare l'intera `pubblica.py`. Nessuna
rete esce dalla macchina: il server è locale e il modulo punta lì.
"""
import json
import os
import sys
import threading
import tempfile
import shutil
from http.server import BaseHTTPRequestHandler, HTTPServer
from urllib.parse import urlparse, parse_qs, unquote

QUI = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, QUI)

import cliente  # noqa: E402
import pubblica  # noqa: E402

RICEVUTO = {"tabelle": {}, "deposito": {}, "richieste": []}

# I CHECK veri dello schema `percorso`, ricopiati qui perché il finto server li
# faccia rispettare. È la lezione della prima corsa vera: un doppio che accetta
# ciò che il servizio rifiuta non è una prova, è un permesso. `punteggio` fuori
# range è passato da qui senza un fiato ed è morto in produzione.
VINCOLI = {
    "articoli": {
        "punteggio": lambda v: v is None or (isinstance(v, int) and 0 <= v <= 100),
    },
    "biblioteca": {
        "origine": lambda v: v in ("aperta", "manuale"),
    },
    "eventi": {
        "tipo": lambda v: v in ("crea", "aggiorna", "elimina"),
    },
}


class VincoloViolato(Exception):
    pass


# Un feed vero quanto basta, e sgraziato di proposito: un collegamento
# relativo da risolvere, un CDATA con dentro dell'HTML e un'entità, una data in
# RFC 822. Sono le tre cose su cui un lettore di RSS scritto in fretta si
# rompe, e qui si rompe davanti a noi invece che alle otto del mattino.
#
# Gli altri due devono sparire, per due motivi diversi che non vanno confusi:
# il comunicato stampa prende un tema pieno («GDPR») e lo ferma solo l'elenco
# delle esclusioni redazionali; la classifica dei dieci strumenti non prende
# nessun tema e si ferma da sé. Un feed di redazione porta molto più rumore di
# un archivio accademico, quindi qui i due filtri contano di più, non di meno.
FINTO_FEED = b"""<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>Finta rivista</title>
    <link>http://esempio.invalid/</link>
    <item>
      <title>Window functions in PostgreSQL: a practical guide</title>
      <link>/articoli/window-functions</link>
      <pubDate>Mon, 21 Sep 2026 09:00:00 +0000</pubDate>
      <description><![CDATA[<p>An OVER (PARTITION BY) walk-through, with &amp; an entity.</p>]]></description>
    </item>
    <item>
      <title>Execution plan regressions after a major upgrade</title>
      <pubDate>Mon, 21 Sep 2026 08:00:00 +0000</pubDate>
      <description>Cardinality estimation went wrong.</description>
    </item>
    <item>
      <title>Data quality checks for a clinical registry</title>
      <pubDate>Mon, 21 Sep 2026 08:30:00 +0000</pubDate>
      <description>Record linkage and missing data.</description>
    </item>
    <item>
      <title>Acme announces the launch of a GDPR compliance platform</title>
      <link>http://esempio.invalid/articoli/annuncio</link>
      <pubDate>Mon, 21 Sep 2026 09:30:00 +0000</pubDate>
      <description>Un comunicato stampa.</description>
    </item>
    <item>
      <title>Top 10 best productivity tools for 2026</title>
      <link>http://esempio.invalid/articoli/top-10</link>
      <pubDate>Mon, 21 Sep 2026 10:00:00 +0000</pubDate>
      <description>Niente da studiare.</description>
    </item>
  </channel>
</rss>
"""


# I vincoli UNIQUE veri dello schema `percorso`. Stanno qui per lo stesso
# motivo dei CHECK: un finto server che accetta cio' che Supabase rifiuta non
# prova niente. `articoli` ne ha DUE, e l'upsert puo' risolverne uno solo —
# quello che passa in `on_conflict`. L'altro non viene risolto: viola, e
# PostgREST rifiuta l'INTERO lotto con 23505. E' il difetto che questa tabella
# esiste per inchiodare.
UNICI = {
    "articoli": [("utente_id", "chiave"), ("utente_id", "url")],
    "biblioteca": [("utente_id", "codice")],
    "fonti": [("utente_id", "url_feed")],
    "eventi": [("id",)],
}


class UnicoViolato(Exception):
    pass


def controlla_unici(tabella, righe, deposito, chiavi_upsert):
    """I vincoli UNIQUE che l'upsert NON sta risolvendo.

    Quello nominato in `on_conflict` e' gestito dalla fusione; ogni altro e'
    un vincolo come un altro, e va violato sia contro le righe gia' scritte
    sia contro le altre righe dello stesso lotto — perche' PostgREST scrive
    il lotto in una transazione sola.
    """
    risolto = tuple(chiavi_upsert)
    for colonne in UNICI.get(tabella, []):
        if colonne == risolto:
            continue
        visti = {}
        for r in deposito:
            visti[tuple(r.get(c) for c in colonne)] = "gia in tabella"
        for r in righe:
            firma = tuple(r.get(c) for c in colonne)
            if None in firma:
                continue
            if firma in visti:
                raise UnicoViolato(
                    "duplicate key value violates unique constraint "
                    "\"%s_%s_key\" (%s): %s"
                    % (tabella, "_".join(colonne), visti[firma], firma))
            visti[firma] = "nello stesso lotto"


class FiltroSconosciuto(Exception):
    pass


# I parametri di PostgREST che NON sono filtri. Tutto il resto lo è, e va
# applicato: un finto server che li ignora non prova niente. Se `leggi_fonti`
# dimenticasse `metodo=eq.rss`, senza questa funzione riceverebbe qui le
# stesse righe e la verifica resterebbe verde, mentre in produzione la
# conduttura proverebbe a leggere un feed da una casella di posta.
NON_FILTRI = ("select", "order", "limit", "offset", "on_conflict")

VERO_FALSO_NULLO = {"true": True, "false": False, "null": None}


def filtra(righe, query):
    """I due operatori che la conduttura usa: `col=eq.valore` e `col=is.true`.

    Un operatore che non è qui solleva invece di essere ignorato: il giorno in
    cui qualcuno aggiunge `col=gt.3` deve accorgersene subito, non scoprire fra
    sei mesi che quel filtro non è mai stato provato.
    """
    for chiave, valori in parse_qs(query).items():
        if chiave in NON_FILTRI:
            continue
        for v in valori:
            if v.startswith("eq."):
                atteso = v[3:]
                righe = [r for r in righe if str(r.get(chiave)) == atteso]
            elif v.startswith("is."):
                if v[3:] not in VERO_FALSO_NULLO:
                    raise FiltroSconosciuto("%s=%s" % (chiave, v))
                atteso = VERO_FALSO_NULLO[v[3:]]
                righe = [r for r in righe if r.get(chiave) is atteso]
            else:
                raise FiltroSconosciuto("%s=%s" % (chiave, v))
    return righe


def controlla(tabella, riga):
    for colonna, regola in VINCOLI.get(tabella, {}).items():
        if colonna in riga and not regola(riga[colonna]):
            raise VincoloViolato(
                "%s.%s = %r viola il CHECK dello schema" % (tabella, colonna, riga[colonna]))


class FintoSupabase(BaseHTTPRequestHandler):
    def log_message(self, *_):
        pass  # il rumore del server coprirebbe l'esito della prova

    def _annota(self, corpo):
        RICEVUTO["richieste"].append(
            {
                "metodo": self.command,
                "percorso": self.path,
                "testate": {k.lower(): v for k, v in self.headers.items()},
                "corpo": corpo,
            }
        )

    def _rispondi(self, stato, dati=b"", tipo="application/json"):
        self.send_response(stato)
        self.send_header("Content-Type", tipo)
        self.send_header("Content-Length", str(len(dati)))
        self.end_headers()
        self.wfile.write(dati)

    def do_GET(self):
        self._annota(None)
        u = urlparse(self.path)
        if u.path.startswith("/rest/v1/"):
            tabella = u.path[len("/rest/v1/"):]
            righe = RICEVUTO["tabelle"].get(tabella, [])
            try:
                righe = filtra(righe, u.query)
            except FiltroSconosciuto as e:
                self._rispondi(400, json.dumps({
                    "code": "PGRST100",
                    "message": "filtro che questo finto server non conosce: %s. "
                               "Insegnaglielo in filtra()." % e,
                }).encode())
                return
            campi = parse_qs(u.query).get("select", ["*"])[0]
            if campi != "*":
                voluti = campi.split(",")
                righe = [{k: r.get(k) for k in voluti} for r in righe]
            self._rispondi(200, json.dumps(righe).encode())
            return
        if u.path.startswith("/storage/v1/object/"):
            chiave = unquote(u.path[len("/storage/v1/object/"):])
            dati = RICEVUTO["deposito"].get(chiave)
            if dati is None:
                self._rispondi(404, b'{"error":"non trovato"}')
            else:
                self._rispondi(200, dati, "application/octet-stream")
            return
        if u.path == "/finto-feed.xml":
            self._rispondi(200, FINTO_FEED, "application/rss+xml")
            return
        self._rispondi(404, b'{"error":"rotta sconosciuta"}')

    def do_POST(self):
        lunghezza = int(self.headers.get("Content-Length") or 0)
        grezzo = self.rfile.read(lunghezza)
        u = urlparse(self.path)

        if u.path.startswith("/rest/v1/"):
            self._annota(grezzo.decode("utf-8", "replace"))
            tabella = u.path[len("/rest/v1/"):]
            chiavi = parse_qs(u.query).get("on_conflict", [""])[0].split(",")
            chiavi = [c for c in chiavi if c]
            righe = json.loads(grezzo)
            try:
                for r in righe:
                    controlla(tabella, r)
            except VincoloViolato as e:
                # Stessa forma di PostgREST: stato 400 e il motivo nel corpo.
                self._rispondi(400, json.dumps(
                    {"code": "23514", "message": str(e)}).encode())
                return
            deposito = RICEVUTO["tabelle"].setdefault(tabella, [])
            try:
                controlla_unici(tabella, righe, deposito, chiavi)
            except UnicoViolato as e:
                # Stessa forma di PostgREST: il lotto intero non passa.
                self._rispondi(409, json.dumps(
                    {"code": "23505", "message": str(e)}).encode())
                return
            for r in righe:
                if chiavi:
                    firma = tuple(r.get(k) for k in chiavi)
                    for i, vecchia in enumerate(deposito):
                        if tuple(vecchia.get(k) for k in chiavi) == firma:
                            deposito[i] = {**vecchia, **r}
                            break
                    else:
                        deposito.append(r)
                else:
                    deposito.append(r)
            self._rispondi(201, b"[]")
            return

        if u.path.startswith("/storage/v1/object/"):
            self._annota("<%d byte>" % len(grezzo))
            RICEVUTO["deposito"][unquote(u.path[len("/storage/v1/object/"):])] = grezzo
            self._rispondi(200, b'{"Key":"ok"}')
            return

        self._rispondi(404, b'{"error":"rotta sconosciuta"}')


passate = 0
guasti = []


def prova(nome, ottenuto, atteso):
    global passate
    if ottenuto == atteso:
        passate += 1
    else:
        guasti.append("%s\n    atteso  : %r\n    ottenuto: %r" % (nome, atteso, ottenuto))


def prova_vero(nome, condizione, spiegazione=""):
    global passate
    if condizione:
        passate += 1
    else:
        guasti.append("%s%s" % (nome, ("\n    " + str(spiegazione)) if spiegazione else ""))


def principale():
    server = HTTPServer(("127.0.0.1", 0), FintoSupabase)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    base = "http://127.0.0.1:%d" % server.server_address[1]

    cartella = tempfile.mkdtemp(prefix="prova-nuvola-")
    manuale = os.path.join(cartella, "manuale")
    os.makedirs(os.path.join(cartella, "rassegna"))
    os.makedirs(manuale)

    catalogo = [
        {
            "chiave": "openalex:W1", "titolo": "Primo studio", "autori": ["Rossi", "Bianchi"],
            "url": "https://esempio.invalid/uno", "data": "2026-09-21",
            "abstract": "Un sommario.", "fonte": "openalex", "tema_slug": "statistica",
            "trimestre": "T1", "rilevanza": 2.5, "tipo": "articolo",
        },
        {
            "chiave": "zenodo:Z2", "titolo": "Secondo studio", "autori": [],
            "url": "https://esempio.invalid/due", "data": "2026-09-20",
            "fonte": "zenodo", "tema_slug": "gdpr", "trimestre": "T2", "rilevanza": 1.0,
        },
    ]
    with open(os.path.join(cartella, "rassegna", "catalogo.json"), "w", encoding="utf-8") as f:
        json.dump(catalogo, f)
    with open(os.path.join(cartella, "rassegna", "visti.json"), "w", encoding="utf-8") as f:
        json.dump([], f)

    # La fonte RSS vive in una riga di `percorso.fonti`, non nel codice: si
    # aggiunge una rivista senza ripubblicare nulla. Qui punta al finto server,
    # così l'intera strada — lettura, classificazione, innesto nel catalogo —
    # viene percorsa senza uscire da questa macchina.
    RICEVUTO["tabelle"]["fonti"] = [{
        "nome": "finta", "url_feed": base + "/finto-feed.xml", "url_sito": None,
        "metodo": "rss", "categoria": "sql_base", "lingua": "en",
        "peso": 0.8, "attiva": True,
    }, {
        # Spenta, e con un indirizzo che non esiste: se il filtro `attiva` si
        # perdesse, questa riga comparirebbe fra i non riusciti. È il modo di
        # accorgersene senza aspettare che un feed morto sporchi il rapporto
        # ogni mattina.
        "nome": "spenta", "url_feed": base + "/feed-che-non-esiste.xml",
        "url_sito": None, "metodo": "rss", "categoria": "gdpr", "lingua": "en",
        "peso": 0.9, "attiva": False,
    }]

    # Un PDF vero quanto basta: i byte magici sono l'unica cosa che il
    # cancello di `e_pdf` guarda, ed è giusto così.
    with open(os.path.join(manuale, "Manuale di campo.pdf"), "wb") as f:
        f.write(b"%PDF-1.7\n" + b"x" * 512)
    with open(os.path.join(manuale, "Manuale di campo.json"), "w", encoding="utf-8") as f:
        json.dump({"titolo": "Manuale di campo", "autore": "MSF", "trimestre": "T3"}, f)
    # Un impostore: si chiama .pdf e non lo è. Deve essere scartato con un
    # motivo, non caricato e non fatto passare per un libro.
    with open(os.path.join(manuale, "falso.pdf"), "wb") as f:
        f.write(b"<html>403 Forbidden</html>")

    # La rete verso gli archivi non esiste qui dentro: `scarica` fallisce, e va
    # bene — si sta provando la conduttura, non gli archivi. Ciò che conta è
    # che una voce senza testo venga pubblicata lo stesso.
    def niente_rete(url, massimo_byte=None, timeout=None):
        raise pubblica.ErroreEstrazione("nessuna rete in questa prova: " + url)

    vero_scarica = pubblica.scarica
    pubblica.scarica = niente_rete
    rapporto = {
        "adesso": "2026-09-22T00:00:00+00:00", "gia_in_archivio": 0, "candidate": 0,
        "articoli": 0, "con_testo": 0, "pdf": 0, "manuali": 0, "volumi": 0,
        "eventi": 0, "falliti": [], "tempo_scaduto": False,
        "feed_letti": 0, "voci_da_feed": 0, "url_ripetuti": 0,
    }
    try:
        n = cliente.Nuvola(base=base)
        pubblica.pubblica(
            os.path.join(cartella, "rassegna"), manuale, n,
            {"articoli": 80, "pdf": 8, "minuti": 20}, rapporto,
        )
    except cliente.ErroreNuvola as e:
        # Un rifiuto del finto server è un guasto della conduttura, e va
        # riportato come tale invece che come traccia di stack: chi legge deve
        # vedere QUALE vincolo è stato violato, non dove si è rotto Python.
        guasti.append("la conduttura è stata respinta dal servitore:\n    %s" % e)
        server.shutdown()
        shutil.rmtree(cartella, ignore_errors=True)
        print("PROVA DELLA CONDUTTURA: ROSSA\n")
        for g in guasti:
            print("  ✗ " + g)
        print("\n%d verifiche passate, %d fallite" % (passate, len(guasti)))
        return 1
    finally:
        pubblica.scarica = vero_scarica

    articoli = RICEVUTO["tabelle"].get("articoli", [])
    volumi = RICEVUTO["tabelle"].get("biblioteca", [])
    eventi = RICEVUTO["tabelle"].get("eventi", [])

    # Tre: i due del catalogo più quello arrivato dal feed. Il conto è la prova
    # che l'innesto è avvenuto NEL catalogo e non accanto: se il feed avesse
    # una strada propria questo numero resterebbe due e le righe comparirebbero
    # da un'altra parte.
    prova("quattro articoli: due dal catalogo, due dal feed", len(articoli), 4)
    prova("un volume: il file a mano buono", len(volumi), 1)
    prova("l'impostore è stato scartato", rapporto["manuali"], 1)
    prova_vero(
        "e con un motivo leggibile",
        any("non lo è" in f for f in rapporto["falliti"]),
        repr(rapporto["falliti"]),
    )
    prova("un evento per ogni riga", len(eventi), len(articoli) + len(volumi))

    # ------------------------------------------------------------- il feed
    prova("una fonte letta", rapporto["feed_letti"], 1)
    prova_vero(
        "la fonte spenta non è stata nemmeno chiesta",
        not any("spenta" in f for f in rapporto["falliti"]),
        repr(rapporto["falliti"]),
    )
    prova("tre voci hanno superato la classificazione", rapporto["voci_da_feed"], 3)
    prova("e il comunicato stampa è stato tolto come rumore",
          rapporto["rumore_feed"], 1)
    prova_vero(
        "l'annuncio non è arrivato in biblioteca",
        not any("announces the launch" in (r.get("titolo") or "") for r in articoli),
        "un comunicato stampa con un tema pieno è passato: l'elenco delle "
        "esclusioni redazionali non viene applicato alle voci RSS",
    )
    da_feed = [r for r in articoli if (r.get("fonte") or "").startswith("rss[")]
    prova("due articoli del feed sono arrivati in tabella", len(da_feed), 2)

    # Le due voci senza <link> ripiegano entrambe sull'indirizzo del feed e
    # arrivano qui con lo stesso url e due chiavi diverse. `articoli` ha un
    # UNIQUE su (utente_id, url) che l'upsert NON risolve — risolve quello
    # sulla chiave — quindi senza la deduplica per url PostgREST rifiuta il
    # LOTTO INTERO con 23505, e la mattina si perde tutta: zero articoli, zero
    # eventi, non una riga in meno.
    prova("le due voci senza collegamento sono collassate in una",
          rapporto["url_ripetuti"], 1)
    prova_vero(
        "e delle due è rimasta quella con più da leggere",
        any("Execution plan" in (r.get("titolo") or "") for r in da_feed)
        and not any("Data quality checks" in (r.get("titolo") or "") for r in da_feed),
        repr([r.get("titolo") for r in da_feed]),
    )
    prova_vero(
        "nessun url ripetuto è arrivato al servitore",
        len({r["url"] for r in articoli}) == len(articoli),
        repr([r["url"] for r in articoli]),
    )
    prova_vero(
        "il rumore di redazione non passa",
        not any("Top 10" in (r.get("titolo") or "") for r in articoli),
        "un titolo senza tema è entrato lo stesso: il filtro della rassegna "
        "non è stato applicato alle voci RSS",
    )
    # La voce con un <link> vero: è su quella che si provano la risoluzione
    # dell'indirizzo relativo, l'HTML tolto e la data RFC 822.
    con_link = [r for r in da_feed if "Window functions" in (r.get("titolo") or "")]
    if con_link:
        voce = con_link[0]
        prova("la fonte porta il nome della rivista", voce["fonte"], "rss[finta]")
        prova_vero(
            "il collegamento relativo è stato risolto",
            (voce.get("url") or "").startswith(base + "/articoli/"),
            repr(voce.get("url")),
        )
        prova_vero(
            "l'HTML del sommario è stato tolto",
            "<p>" not in (voce.get("abstract") or ""),
            repr(voce.get("abstract")),
        )
        prova_vero(
            "e l'entità è stata sciolta",
            "&amp;" not in (voce.get("abstract") or ""),
            repr(voce.get("abstract")),
        )
        prova("la data RFC 822 è diventata un timestamp",
              (voce.get("pubblicato_a") or "")[:10], "2026-09-21")
        prova_vero(
            "il tema è quello che la rassegna assegnerebbe",
            voce.get("tema_slug") == "sql_base",
            repr(voce.get("tema_slug")),
        )
        prova_vero(
            "e l'evento c'è, che è l'unica cosa che l'app legge davvero",
            any(e["entita_id"] == voce["chiave"] for e in eventi
                if e["entita"] == "articoli"),
        )

    prova_vero("ogni riga porta utente_id", all(r.get("utente_id") == cliente.UTENTE
                                                for r in articoli + volumi + eventi))
    prova_vero(
        "il payload dell'evento è un oggetto, non una stringa",
        all(isinstance(e["payload"], dict) for e in eventi),
        "mandato come stringa, PostgREST lo scrive come un jsonb di tipo stringa e "
        "ogni lettura vede un campo solo al posto dei suoi campi",
    )
    prova_vero(
        "l'id dell'evento è hlc:entita_id",
        all(e["id"] == e["hlc"] + ":" + e["entita_id"] for e in eventi),
    )
    prova_vero(
        "gli HLC sono distinti e crescenti",
        len({e["hlc"] for e in eventi}) == len(eventi)
        and [e["hlc"] for e in eventi] == sorted(e["hlc"] for e in eventi),
    )

    volume = volumi[0]
    prova("il volume a mano ha la scheda che gli è stata messa accanto",
          volume["titolo"], "Manuale di campo")
    prova("e l'origine giusta", volume["origine"], "manuale")
    # La chiave nel deposito porta davanti il nome del bucket: è l'URL vero
    # che il cliente compone, e va confrontato con quello, non con il percorso
    # relativo che finisce in tabella.
    chiave_deposito = "%s/%s" % (cliente.DEPOSITO, volume["pdf_path"])
    prova_vero("il PDF è nel deposito",
               chiave_deposito in RICEVUTO["deposito"], list(RICEVUTO["deposito"]))
    prova("i byte depositati sono quelli del file",
          len(RICEVUTO["deposito"].get(chiave_deposito, b"")), 521)

    evento_volume = [e for e in eventi if e["entita"] == "biblioteca"][0]
    prova_vero(
        "l'evento del volume non porta file_locale",
        "file_locale" not in evento_volume["payload"],
    )
    prova_vero(
        "l'evento del volume porta pdf_path",
        evento_volume["payload"].get("pdf_path") == volume["pdf_path"],
    )

    # Le intestazioni: è dove si nascondono i guasti che nessuna prova di unità vede.
    scritture = [r for r in RICEVUTO["richieste"]
                 if r["metodo"] == "POST" and "/rest/v1/" in r["percorso"]]
    prova_vero("ogni scrittura dichiara lo schema percorso",
               all(r["testate"].get("content-profile") == "percorso" for r in scritture),
               repr([r["testate"].get("content-profile") for r in scritture]))
    prova_vero("ogni scrittura chiede la fusione dei duplicati",
               all("merge-duplicates" in (r["testate"].get("prefer") or "") for r in scritture))
    prova_vero("ogni scrittura porta la chiave",
               all(r["testate"].get("apikey") for r in scritture))
    letture = [r for r in RICEVUTO["richieste"]
               if r["metodo"] == "GET" and "/rest/v1/" in r["percorso"]]
    prova_vero("ogni lettura dichiara lo schema percorso",
               all(r["testate"].get("accept-profile") == "percorso" for r in letture),
               repr([r["testate"].get("accept-profile") for r in letture]))

    # Seconda corsa: niente deve raddoppiare. È la prova che lo stato «cosa ho
    # già pubblicato» letto da Supabase funziona davvero.
    prima = len(RICEVUTO["tabelle"]["articoli"])
    rapporto2 = dict(rapporto, articoli=0, volumi=0, eventi=0, falliti=[],
                     gia_in_archivio=0, candidate=0, manuali=0, pdf=0, con_testo=0,
                     feed_letti=0, voci_da_feed=0, rumore_feed=0, url_ripetuti=0)
    pubblica.scarica = niente_rete
    try:
        pubblica.pubblica(
            os.path.join(cartella, "rassegna"), manuale, cliente.Nuvola(base=base),
            {"articoli": 80, "pdf": 8, "minuti": 20}, rapporto2,
        )
    finally:
        pubblica.scarica = vero_scarica
    prova("la seconda corsa non raddoppia gli articoli",
          len(RICEVUTO["tabelle"]["articoli"]), prima)
    prova("e sa di averli già visti", rapporto2["gia_in_archivio"], prima)
    prova("il volume a mano resta uno solo",
          len(RICEVUTO["tabelle"]["biblioteca"]), 1)
    # Il feed NON viene saltato alla seconda corsa: viene riletto e la voce
    # torna identica. A fermarla è la deduplica per chiave, cioè lo stesso
    # meccanismo che ferma gli archivi. Senza questa riga la prova sopra
    # passerebbe anche se il feed non fosse stato letto affatto.
    prova("il feed è stato riletto", rapporto2["feed_letti"], 1)
    prova("e le stesse voci non si depositano due volte", rapporto2["voci_da_feed"], 3)

    server.shutdown()
    shutil.rmtree(cartella, ignore_errors=True)

    if guasti:
        print("PROVA DELLA CONDUTTURA: ROSSA\n")
        for g in guasti:
            print("  ✗ " + g)
        print("\n%d verifiche passate, %d fallite" % (passate, len(guasti)))
        return 1
    print("%d verifiche passate" % passate)
    return 0


if __name__ == "__main__":
    sys.exit(principale())
