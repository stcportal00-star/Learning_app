#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Unico punto di contatto con Supabase: PostgREST e Storage. Solo stdlib.

    python3 strumenti/nuvola/cliente.py      # autoverifica, nessuna rete

Tutto cio' che la conduttura legge o scrive nella nuvola passa da qui. Il
motivo non e' l'ordine: e' che il timeout, i ritentativi e la lettura del corpo
d'errore devono essere identici ovunque. La rassegna delle 8 gira in GitHub
Actions senza nessuno a guardarla; un modulo che chiama urlopen per conto suo
e' un modulo che un giorno resta appeso senza timeout, oppure fallisce
buttando via la frase con cui PostgREST spiegava il rifiuto.

Le tre regole che questo file impone a chiunque lo usi:

  1. Un 4xx che non sia 429 non si ritenta. Non e' la rete: e' la richiesta a
     essere sbagliata — colonna inesistente, vincolo che non combacia, schema
     errato. Ritentarla quattro volte costa trenta secondi e produce lo stesso
     rifiuto. Il corpo della risposta finisce sempre nel messaggio: PostgREST
     ci scrive dentro il nome della colonna che ha respinto, e nasconderlo
     costa un'ora di cecita'.

  2. Ogni urlopen ha un timeout esplicito. Senza, una connessione appesa tiene
     il job fino al tetto del workflow e il giorno di rassegna e' perso.

  3. Ogni scrittura e' idempotente — upsert su chiave di conflitto per le
     tabelle, x-upsert per i file. Solo per questo ritentare una POST e'
     sicuro: la stessa riga mandata due volte resta una riga sola.
"""
import http.client
import json
import os
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

BASE = "https://hgvzjeituvvwtskbxzzl.supabase.co"
SCHEMA = "percorso"          # schema PostgREST: viaggia in Accept-Profile / Content-Profile
DEPOSITO = "biblioteca"      # bucket Storage, privato
UTENTE = "00000000-0000-4000-8000-000000000001"

# Chiave pubblicabile, non segreta. E' la stessa che finisce dentro l'APK e che
# qualunque client Supabase espone: sta nel sorgente di proposito, cosi' la
# conduttura gira anche da una macchina senza variabili d'ambiente preparate.
# Cio' che protegge i dati non e' questa stringa ma le regole RLS dello schema
# `percorso` (strumenti/db/001_schema_percorso.sql); se quelle cadessero,
# nascondere la chiave non salverebbe nulla. SUPABASE_CHIAVE la sovrascrive
# quando serve ruotarla senza ripubblicare il codice.
CHIAVE = os.environ.get("SUPABASE_CHIAVE") or "sb_publishable_VO5g-rRFJUPHwjBQsuLyoQ_PNMi1D-P"

# Quattro ritentativi dopo il primo tentativo: cinque richieste in tutto, al
# massimo trenta secondi di attesa. Oltre non ha senso — se Supabase e' giu' da
# mezzo minuto lo e' anche fra cinque, e la corsa di domani rifa' tutto perche'
# ogni scrittura e' un upsert.
RIPROVE = 4
ATTESE = (2, 4, 8, 16)

# Tetto all'attesa chiesta con Retry-After. Un server che risponde
# "Retry-After: 3600" sta dicendo di tornare fra un'ora: aspettarla davvero
# manderebbe il job oltre il tetto del workflow senza scrivere niente. Meglio
# un ultimo tentativo breve e un fallimento leggibile nel registro.
TETTO_ATTESA = 60

# Righe per blocco negli upsert. Un corpo troppo grande prende 413 e si perde
# l'intero invio, non la riga di troppo: meglio piu' richieste piccole.
BLOCCO = 200

# Tabella usata solo come sonda da raggiungibile(): esiste dallo schema 001 ed
# e' la piu' piccola, quindi la GET a vuoto costa quanto il giro di rete.
TABELLA_SONDA = "temi"

# Storage restituisce al massimo 1000 voci per chiamata; oltre si pagina con
# offset. Il tetto di pagine e' una cintura: se il server ignorasse l'offset,
# senza di esso il ciclo non finirebbe mai.
PAGINA_DEPOSITO = 1000
PAGINE_MASSIME = 20


class ErroreNuvola(Exception):
    """Porta sempre stato HTTP e corpo della risposta nel messaggio.

    `stato` e `corpo` restano leggibili come attributi: chi chiama distingue
    cosi' il file assente (404 su scarica_file) dal guasto vero, senza dover
    leggere la frase dell'errore.
    """

    def __init__(self, messaggio, stato=None, corpo=""):
        self.stato = stato
        self.corpo = corpo or ""
        pezzi = [messaggio]
        if stato is not None:
            pezzi.append(f"HTTP {stato}")
        if self.corpo:
            pezzi.append(self.corpo)
        super().__init__(" — ".join(pezzi))


def _leggi_corpo(errore, quanti=1500):
    """Il testo della risposta d'errore, in una riga. Non fallisce mai.

    Si legge una volta sola, e la lettura non deve poter far saltare la
    gestione dell'errore che si sta gia' gestendo.
    """
    try:
        grezzo = errore.read(quanti).decode("utf-8", "replace")
    except Exception:
        return ""
    if not grezzo:
        return ""
    try:
        dati = json.loads(grezzo)
    except ValueError:
        return " ".join(grezzo.split())[:quanti]
    if isinstance(dati, dict):
        # PostgREST mette il motivo utile in `message`, il dettaglio in `details`
        # e il nome della colonna o del vincolo in `hint`. Storage risponde con
        # `error` e `message`. Si tengono tutti: sono quattro parole in croce e
        # sono l'unica via per correggere invece di indovinare.
        pezzi = [f"{c}={dati[c]}" for c in ("message", "details", "hint", "code", "error")
                 if dati.get(c)]
        if pezzi:
            return " ".join(" ".join(p.split()) for p in pezzi)[:quanti]
    return " ".join(grezzo.split())[:quanti]


def _attesa_di(tentativo):
    return ATTESE[min(tentativo, len(ATTESE) - 1)]


def _attesa_429(intestazioni, tentativo):
    """Rispetta Retry-After quando c'e': indovinare un'attesa piu' breve di
    quella chiesta fa solo scattare il limite una seconda volta."""
    valore = ""
    try:
        valore = (intestazioni.get("Retry-After") or "").strip()
    except Exception:
        valore = ""
    if valore.isdigit():
        return min(float(valore), TETTO_ATTESA)
    # Retry-After ammette anche una data HTTP. Supabase manda i secondi; sulla
    # forma a data si ricade sull'esponenziale invece di sbagliare il fuso.
    return _attesa_di(tentativo)


def _blocchi(righe, quante=BLOCCO):
    for inizio in range(0, len(righe), quante):
        yield righe[inizio:inizio + quante]


def _gruppi_per_chiavi(righe):
    """Raggruppa le righe per insieme di colonne, nell'ordine di arrivo.

    PostgREST rifiuta un inserimento in blocco in cui gli oggetti non hanno
    tutte le stesse chiavi: risponde 400 PGRST102 "All object keys must match".
    Succede appena una voce della rassegna ha l'abstract e la successiva no.
    Uniformare le chiavi riempiendo di null sarebbe peggio: con
    resolution=merge-duplicates quel null cancellerebbe un valore gia' scritto.
    """
    gruppi = {}
    for riga in righe:
        gruppi.setdefault(tuple(sorted(riga)), []).append(riga)
    return list(gruppi.values())


def _da_json(dati, contesto):
    if not dati:
        return []
    try:
        return json.loads(dati.decode("utf-8", "replace"))
    except ValueError as e:
        raise ErroreNuvola(
            f"{contesto}: la risposta non e' JSON ({e}). "
            f"Primi byte: {dati[:160]!r}. Di solito e' una pagina di errore del "
            f"proxy o un indirizzo sbagliato in BASE")


def _mascherata(chiave):
    """La chiave e' pubblicabile, ma un registro di CI si condivide piu'
    facilmente del repository: in stampa se ne mostra solo il prefisso."""
    return (chiave[:12] + "…") if len(chiave) > 12 else "(vuota)"


# I caratteri che una colonna `text` di PostgreSQL non puo' contenere. Il NUL
# fa rifiutare l'intera richiesta con 22P05; i surrogati spaiati non sono
# UTF-8 valido e rompono la serializzazione.
_VIETATI = re.compile("[\x00\ud800-\udfff]")


def ripulisci(valore):
    """Toglie i caratteri che PostgreSQL non puo' tenere in una colonna `text`.

    Sono due, e nessuno dei due porta significato:

    - **il byte NUL.** `text` non lo accetta, e PostgREST rifiuta l'intera
      richiesta con 22P05, «\\u0000 cannot be converted to text». Non si perde
      la riga che lo conteneva: si perde il LOTTO, perche' le righe vanno in
      una transazione sola. E' successo il 23 settembre: ottanta articoli
      preparati, zero eventi scritti, la mattina buttata per un carattere
      finito nel testo estratto da un PDF.
    - **i surrogati spaiati** (U+D800–U+DFFF). Non sono UTF-8 valido; arrivano
      da HTML mal codificato e fanno fallire la serializzazione o la scrittura.

    Si ripulisce qui, nell'unico punto da cui passano tutte le scritture,
    invece che in chi prepara le righe: un chiamante nuovo non puo'
    dimenticarsene, e l'estrattore non deve sapere cosa PostgreSQL accetta.
    """
    if isinstance(valore, str):
        return _VIETATI.sub("", valore)
    if isinstance(valore, dict):
        return {k: ripulisci(v) for k, v in valore.items()}
    if isinstance(valore, list):
        return [ripulisci(v) for v in valore]
    return valore


class Nuvola:
    """Client Supabase per la conduttura. Costruirlo non tocca la rete."""

    def __init__(self, chiave=None, base=BASE, timeout=30):
        self.chiave = (chiave or CHIAVE or "").strip()
        self.base = (base or BASE).rstrip("/")
        self.timeout = timeout
        if not self.chiave:
            raise ErroreNuvola(
                "chiave Supabase mancante: esporta SUPABASE_CHIAVE oppure passa "
                "chiave= a Nuvola()")

    # ------------------------------------------------------------ composizione

    def _testate(self, extra=None):
        testate = {"apikey": self.chiave, "Authorization": f"Bearer {self.chiave}"}
        testate.update(extra or {})
        return testate

    def _testate_lettura(self):
        return self._testate({"Accept-Profile": SCHEMA, "Accept": "application/json"})

    def _testate_scrittura(self, su_conflitto=None):
        testate = self._testate({
            "Content-Profile": SCHEMA,
            "Content-Type": "application/json",
            "Accept": "application/json",
        })
        if su_conflitto is not None:
            # return=representation serve a chi chiama per rileggere gli id
            # assegnati dal server; merge-duplicates e' cio' che rende l'upsert
            # un upsert invece di un inserimento che fallisce sul duplicato.
            testate["Prefer"] = "return=representation,resolution=merge-duplicates"
        return testate

    def _testate_deposito(self, tipo=None, upsert=False):
        # urllib cambia le maiuscole due volte: Request.add_header applica
        # capitalize() e tiene «X-upsert», ma do_open applica title() appena
        # prima di spedire, quindi sul filo passa «X-Upsert». HTTP tratta i nomi
        # senza distinzione di maiuscole e Storage lo legge lo stesso; la nota
        # serve a chi cerca «x-upsert» in un registro di rete, non lo trova e
        # conclude che non viene mandato. Si cerca «X-Upsert».
        extra = {}
        if tipo:
            extra["Content-Type"] = tipo
        if upsert:
            extra["x-upsert"] = "true"
        return self._testate(extra)

    def _url_tabella(self, tabella, query="", massimo=None):
        parti = []
        pulita = (query or "").strip().lstrip("?").strip("&")
        if pulita:
            parti.append(pulita)
        # Il limite si aggiunge solo se chi chiama non l'ha gia' scritto nella
        # query: due `limit=` nella stessa URL e PostgREST usa il primo, che non
        # e' quello che si credeva di aver chiesto.
        if massimo is not None and "limit=" not in pulita:
            parti.append(f"limit={int(massimo)}")
        coda = "&".join(parti)
        url = f"{self.base}/rest/v1/{urllib.parse.quote(tabella, safe='')}"
        return url + ("?" + coda if coda else "")

    def _url_oggetto(self, percorso):
        pulito = (percorso or "").lstrip("/")
        if not pulito:
            raise ErroreNuvola("percorso del file vuoto: serve un nome dentro il "
                               f"deposito «{DEPOSITO}», es. «pdf/articolo.pdf»")
        # safe="/" tiene le barre come separatori di cartella e codifica il
        # resto: un titolo con spazi o accenti nel nome del file produce
        # altrimenti una URL che Storage rifiuta con 400.
        return (f"{self.base}/storage/v1/object/{DEPOSITO}/"
                f"{urllib.parse.quote(pulito, safe='/')}")

    def _url_elenco(self):
        return f"{self.base}/storage/v1/object/list/{DEPOSITO}"

    # ------------------------------------------------------------- trasporto

    def _esegui(self, metodo, url, corpo=None, testate=None):
        """Una richiesta con i ritentativi. Restituisce (stato, byte del corpo)."""
        ultimo, ultimo_stato, ultimo_corpo = "nessun tentativo eseguito", None, ""

        for tentativo in range(RIPROVE + 1):
            richiesta = urllib.request.Request(url, data=corpo,
                                               headers=testate or {}, method=metodo)
            try:
                with urllib.request.urlopen(richiesta, timeout=self.timeout) as r:
                    return r.status, r.read()
            except urllib.error.HTTPError as e:
                dettaglio = _leggi_corpo(e)
                if e.code != 429 and 400 <= e.code < 500:
                    raise ErroreNuvola(f"{metodo} {url} respinta", e.code, dettaglio)
                attesa = _attesa_429(e.headers, tentativo) if e.code == 429 \
                    else _attesa_di(tentativo)
                ultimo, ultimo_stato, ultimo_corpo = f"{metodo} {url}", e.code, dettaglio
            except (urllib.error.URLError, http.client.HTTPException, OSError) as e:
                # URLError, socket.timeout, ConnectionReset e i guasti di
                # http.client cadono tutti qui: sono la rete, non noi, e si
                # riprovano. OSError li copre tutti da Python 3.10.
                motivo = getattr(e, "reason", e)
                attesa = _attesa_di(tentativo)
                ultimo = f"{metodo} {url}"
                ultimo_stato, ultimo_corpo = None, f"{type(e).__name__}: {motivo}"
            if tentativo < RIPROVE:
                time.sleep(attesa)

        raise ErroreNuvola(
            f"{ultimo} fallita dopo {RIPROVE + 1} tentativi. Se si ripete, "
            f"controlla la rete del runner e lo stato del progetto Supabase",
            ultimo_stato, ultimo_corpo)

    # --------------------------------------------------------------- PostgREST

    def seleziona(self, tabella, query="", massimo=1000):
        """Legge righe da una tabella dello schema `percorso`.

        `query` e' una stringa PostgREST gia' formata e gia' codificata, per
        esempio "chiave=in.(a,b)&select=chiave". Qui non si compone nulla: la
        sintassi degli operatori e' di chi conosce la tabella.
        """
        url = self._url_tabella(tabella, query, massimo)
        _, corpo = self._esegui("GET", url, testate=self._testate_lettura())
        dati = _da_json(corpo, f"lettura di {tabella}")
        if not isinstance(dati, list):
            raise ErroreNuvola(
                f"lettura di {tabella}: attesa una lista di righe, arrivato "
                f"{type(dati).__name__}. Con select=... su una vista singola "
                f"aggiungi l'intestazione giusta o togli il filtro")
        return dati

    def innesta(self, tabella, righe, su_conflitto):
        """Upsert. `su_conflitto` sono le colonne del vincolo, es. "utente_id,url".

        Restituisce le righe come le ha scritte il server. Non modifica i
        dizionari ricevuti: chi chiama spesso li riusa per il proprio registro
        locale e ritrovarseli alterati e' un guasto che si scopre giorni dopo.
        """
        if not righe:
            return []
        if not su_conflitto:
            raise ErroreNuvola(
                f"innesta su {tabella} senza su_conflitto: senza le colonne del "
                f"vincolo il server inserisce duplicati invece di aggiornare")

        preparate = []
        for indice, riga in enumerate(righe):
            if not isinstance(riga, dict):
                raise ErroreNuvola(
                    f"innesta su {tabella}: la riga {indice} e' "
                    f"{type(riga).__name__}, serve un dizionario colonna→valore")
            copia = ripulisci(dict(riga))
            copia.setdefault("utente_id", UTENTE)
            preparate.append(copia)

        url = (f"{self._url_tabella(tabella)}?on_conflict="
               f"{urllib.parse.quote(su_conflitto, safe=',')}")
        testate = self._testate_scrittura(su_conflitto)
        scritte = []
        for gruppo in _gruppi_per_chiavi(preparate):
            for blocco in _blocchi(gruppo):
                try:
                    corpo = json.dumps(blocco, ensure_ascii=False).encode("utf-8")
                except (TypeError, ValueError) as e:
                    raise ErroreNuvola(
                        f"innesta su {tabella}: una riga contiene un valore non "
                        f"serializzabile in JSON ({e}). Converti date e oggetti "
                        f"in stringhe prima di passarli")
                _, risposta = self._esegui("POST", url, corpo, testate)
                lette = _da_json(risposta, f"scrittura su {tabella}")
                if isinstance(lette, list):
                    scritte.extend(lette)
        return scritte

    # ----------------------------------------------------------------- Storage

    def carica_file(self, percorso, dati, tipo="application/pdf"):
        """Carica (o sostituisce) un file nel deposito. x-upsert rende la
        seconda corsa innocua quanto la prima."""
        if isinstance(dati, str):
            dati = dati.encode("utf-8")
        if not isinstance(dati, (bytes, bytearray)):
            raise ErroreNuvola(
                f"carica_file({percorso}): servono byte, arrivato "
                f"{type(dati).__name__}. Apri il file in modalita' 'rb'")
        self._esegui("POST", self._url_oggetto(percorso), bytes(dati),
                     self._testate_deposito(tipo, upsert=True))

    def scarica_file(self, percorso):
        """I byte del file. Un file assente arriva come ErroreNuvola con
        stato 404: chi chiama lo distingue dal guasto guardando `.stato`."""
        _, corpo = self._esegui("GET", self._url_oggetto(percorso),
                                testate=self._testate())
        return corpo

    def elenca_file(self, prefisso=""):
        """Elenca i file sotto un prefisso, paginando fino alla fine.

        Restituisce solo oggetti veri: Storage mette nell'elenco anche le
        pseudo-cartelle, riconoscibili dall'`id` nullo, e chi le prendesse per
        file chiederebbe poi di scaricarle. A ogni voce si aggiunge `percorso`,
        il cammino completo da passare a scarica_file: `name` da solo e'
        relativo al prefisso e da solo non basta.
        """
        pulito = (prefisso or "").lstrip("/")
        cartella = pulito.rstrip("/")
        trovati, scarto = [], 0

        for _ in range(PAGINE_MASSIME):
            corpo = json.dumps({
                "prefix": cartella,
                "limit": PAGINA_DEPOSITO,
                "offset": scarto,
                # Senza un ordinamento dichiarato la paginazione per offset puo'
                # saltare o ripetere voci fra una pagina e l'altra: il server non
                # promette un ordine stabile.
                "sortBy": {"column": "name", "order": "asc"},
            }).encode("utf-8")
            _, risposta = self._esegui(
                "POST", self._url_elenco(), corpo,
                self._testate({"Content-Type": "application/json",
                               "Accept": "application/json"}))
            pagina = _da_json(risposta, f"elenco di {DEPOSITO}/{cartella}")
            if not isinstance(pagina, list):
                raise ErroreNuvola(
                    f"elenco di {DEPOSITO}/{cartella}: attesa una lista, arrivato "
                    f"{type(pagina).__name__}")
            for voce in pagina:
                if not isinstance(voce, dict) or not voce.get("id"):
                    continue
                voce = dict(voce)
                nome = voce.get("name", "")
                voce["percorso"] = f"{cartella}/{nome}" if cartella else nome
                trovati.append(voce)
            if len(pagina) < PAGINA_DEPOSITO:
                return trovati
            scarto += len(pagina)

        raise ErroreNuvola(
            f"elenco di {DEPOSITO}/{cartella}: superate {PAGINE_MASSIME} pagine "
            f"da {PAGINA_DEPOSITO}. Restringi il prefisso")

    # -------------------------------------------------------------- diagnostica

    def raggiungibile(self):
        """Rete e credenziali funzionano? Non solleva mai: e' la domanda che si
        fa prima di decidere se lavorare in locale o sincronizzare."""
        try:
            self.seleziona(TABELLA_SONDA, "select=id", massimo=1)
            return True
        except ErroreNuvola:
            return False


if __name__ == "__main__":
    # Autoverifica senza rete. Controlla l'unica cosa che si puo' sbagliare in
    # silenzio e che in CI si paga cara: la composizione di URL e intestazioni.
    # Un `Accept-Profile` dimenticato non fallisce — legge lo schema `public`,
    # trova le tabelle vuote e scrive un rapporto senza nulla dentro.
    n = Nuvola()
    passate, fallite = 0, []

    def verifica(nome, condizione):
        global passate
        if condizione:
            passate += 1
        else:
            fallite.append(nome)

    def mostra(testate):
        return " ".join(f"{c}={_mascherata(v) if c in ('apikey', 'Authorization') else v}"
                        for c, v in sorted(testate.items()))

    print("== intestazioni ==")
    print("lettura   :", mostra(n._testate_lettura()))
    print("scrittura :", mostra(n._testate_scrittura("utente_id,url")))
    print("deposito  :", mostra(n._testate_deposito("application/pdf", upsert=True)))

    print("== indirizzi ==")
    url_sel = n._url_tabella("articoli", "select=url&salvato=is.true", 1000)
    url_sel_con_limite = n._url_tabella("articoli", "select=url&limit=5", 1000)
    url_sonda = n._url_tabella(TABELLA_SONDA, "select=id", 1)
    url_ups = (f"{n._url_tabella('articoli')}?on_conflict="
               f"{urllib.parse.quote('utente_id,url', safe=',')}")
    url_file = n._url_oggetto("pdf/Rapporto finale 2026.pdf")
    url_elenco = n._url_elenco()
    for etichetta, valore in (("seleziona", url_sel), ("seleziona+limit", url_sel_con_limite),
                              ("raggiungibile", url_sonda), ("innesta", url_ups),
                              ("carica/scarica", url_file), ("elenca", url_elenco)):
        print(f"{etichetta:16}: {valore}")

    print("== verifiche ==")
    verifica("la lettura dichiara lo schema percorso",
             n._testate_lettura().get("Accept-Profile") == SCHEMA)
    verifica("la lettura non manda Content-Profile",
             "Content-Profile" not in n._testate_lettura())
    verifica("la scrittura dichiara lo schema percorso",
             n._testate_scrittura().get("Content-Profile") == SCHEMA)
    verifica("la scrittura manda JSON",
             n._testate_scrittura().get("Content-Type") == "application/json")
    verifica("l'upsert chiede merge-duplicates e la rappresentazione",
             n._testate_scrittura("utente_id,url").get("Prefer") ==
             "return=representation,resolution=merge-duplicates")
    verifica("senza su_conflitto non si manda Prefer",
             "Prefer" not in n._testate_scrittura())
    verifica("apikey e Authorization portano la stessa chiave",
             n._testate()["apikey"] == CHIAVE and
             n._testate()["Authorization"] == f"Bearer {CHIAVE}")
    verifica("il deposito chiede x-upsert",
             n._testate_deposito("application/pdf", upsert=True).get("x-upsert") == "true")
    verifica("il deposito non dichiara profili di schema",
             not any(c.endswith("-Profile") for c in n._testate_deposito("application/pdf")))

    verifica("la selezione mantiene la query e aggiunge il limite",
             url_sel.endswith("/rest/v1/articoli?select=url&salvato=is.true&limit=1000"))
    verifica("un limite gia' presente non viene duplicato",
             url_sel_con_limite.count("limit=") == 1)
    verifica("senza query resta solo il limite",
             n._url_tabella("temi", "", 10).endswith("/rest/v1/temi?limit=10"))
    verifica("senza limite non si aggiunge nulla",
             n._url_tabella("temi").endswith("/rest/v1/temi"))
    verifica("il punto interrogativo di troppo non entra nell'URL",
             "??" not in n._url_tabella("temi", "?select=id", 5))
    verifica("l'upsert punta a on_conflict con le colonne del vincolo",
             url_ups.endswith("/rest/v1/articoli?on_conflict=utente_id,url"))
    verifica("l'oggetto sta nel deposito biblioteca",
             url_file.startswith(f"{BASE}/storage/v1/object/{DEPOSITO}/pdf/"))
    verifica("gli spazi nel nome del file sono codificati",
             " " not in url_file and "%20" in url_file)
    verifica("le barre restano separatori di cartella",
             url_file.endswith("/pdf/Rapporto%20finale%202026.pdf"))
    verifica("l'elenco usa l'endpoint list del deposito",
             url_elenco.endswith(f"/storage/v1/object/list/{DEPOSITO}"))
    vuoto = True
    try:
        n._url_oggetto("")
        vuoto = False
    except ErroreNuvola:
        pass
    verifica("un percorso di file vuoto e' un errore, non una URL sul bucket", vuoto)

    originale = {"url": "https://esempio.test/a", "titolo": "A"}
    preparate = [dict(originale)]
    preparate[0].setdefault("utente_id", UTENTE)
    verifica("l'utente viene aggiunto quando manca", preparate[0]["utente_id"] == UTENTE)
    verifica("la riga di chi chiama non viene toccata", "utente_id" not in originale)
    tenuto = dict(originale, utente_id="altro")
    tenuto.setdefault("utente_id", UTENTE)
    verifica("un utente gia' scritto non viene sovrascritto", tenuto["utente_id"] == "altro")

    verifica("innesta su lista vuota non tocca la rete", n.innesta("articoli", [], "url") == [])
    finte = [{"url": str(i)} for i in range(450)]
    verifica("450 righe diventano blocchi da 200, 200, 50",
             [len(b) for b in _blocchi(finte)] == [200, 200, 50])
    verifica("righe con colonne diverse finiscono in gruppi diversi",
             [len(g) for g in _gruppi_per_chiavi(
                 [{"a": 1}, {"a": 2, "b": 3}, {"a": 4}])] == [2, 1])

    verifica("le attese sono 2, 4, 8, 16", ATTESE == (2, 4, 8, 16))
    verifica("l'ultima attesa non si azzera dopo l'ultimo indice",
             _attesa_di(RIPROVE + 5) == 16)
    verifica("Retry-After numerico viene rispettato",
             _attesa_429({"Retry-After": "7"}, 0) == 7)
    verifica("Retry-After assurdo viene tagliato al tetto",
             _attesa_429({"Retry-After": "3600"}, 0) == TETTO_ATTESA)
    verifica("senza Retry-After si torna all'esponenziale",
             _attesa_429({}, 2) == 8)

    e = ErroreNuvola("prova", 400, "message=column x does not exist")
    verifica("l'errore porta stato e corpo nel messaggio",
             "400" in str(e) and "column x does not exist" in str(e))
    verifica("lo stato resta leggibile come attributo", e.stato == 400)

    senza_chiave = False
    try:
        Nuvola(chiave="  ")
    except ErroreNuvola:
        senza_chiave = True
    verifica("una chiave vuota fallisce subito, con l'istruzione", senza_chiave)

    for nome in fallite:
        print(f"  FALLITA: {nome}")
    print(f"{passate} verifiche passate")
    sys.exit(1 if fallite else 0)
