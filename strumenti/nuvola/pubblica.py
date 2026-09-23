#!/usr/bin/env python3
"""
Porta la rassegna del giorno dentro Supabase, nella forma che l'app sa leggere.

Questo è il punto in cui un catalogo di collegamenti diventa qualcosa da
studiare. La differenza sta tutta in due colonne: `articoli.testo`, che tiene
il TESTO e non l'indirizzo, e `biblioteca.pdf_path`, che dice dove stanno i
byte nel deposito. Senza la prima, in metropolitana non si legge niente; senza
la seconda, un PDF trovato stanotte resta su un server che domani risponde 404.

Tre uscite, tutte nella stessa corsa:
  1. le righe di `percorso.articoli` e `percorso.biblioteca` (la proiezione,
     che serve a questa conduttura per sapere cosa ha già pubblicato);
  2. i byte dei PDF nel bucket `biblioteca`;
  3. le righe di `percorso.eventi` — ed è questa la parte che conta. L'app non
     legge le tabelle: legge il registro e proietta. Scrivere gli eventi
     significa che la rassegna arriva sul telefono dalla stessa porta da cui
     arriva una nota scritta sul tablet, senza una seconda strada da mantenere.

Lo stato «cosa ho già pubblicato» NON è un file: è Supabase stesso. Si chiede
l'elenco delle chiavi già presenti e si pubblica la differenza. Un file di
stato in più sarebbe una cosa in più che può disallinearsi.
"""
import argparse
import json
import os
import re
import sys
import time
import hashlib
from datetime import datetime, timezone

QUI = os.path.dirname(os.path.abspath(__file__))
RADICE = os.path.dirname(os.path.dirname(QUI))
sys.path.insert(0, os.path.join(os.path.dirname(QUI), "rassegna"))
sys.path.insert(0, QUI)

from cliente import Nuvola, ErroreNuvola, UTENTE  # noqa: E402
from estrattore import (  # noqa: E402
    scarica,
    e_pdf,
    impronta,
    testo_da_html,
    riassunto,
    ErroreEstrazione,
)
import feed  # noqa: E402
from specializzazioni import e_rumore  # noqa: E402

# L'identificativo di dispositivo della conduttura. Deve stare nel formato
# dell'HLC dell'app, che divide la stringa sui trattini: niente trattini qui.
DISPOSITIVO = "rassegna"

# Tetti. Esistono perché una corsa senza limiti si mangia il job: il passo di
# ricerca delle copie accessibili l'ha già fatto una volta, e con
# continue-on-error non se n'era accorto nessuno.
MASSIMO_ARTICOLI = 80
MASSIMO_PDF = 8
MINUTI = 20
# I feed hanno tetti propri perché si comportano in modo diverso dagli
# archivi: rispondono in fretta o non rispondono affatto, e una fonte che
# pubblica un bollettino quotidiano riempirebbe da sola il tetto degli
# articoli. Dodici per fonte è la cifra che tiene: con sei fonti fanno
# settantadue candidate contro un tetto di ottanta, quindi gli archivi restano
# in gara invece di essere scavalcati da un digest del mattino.
MASSIMO_PER_FONTE = 12
MINUTI_FEED = 6
# Il rumore redazionale: la stessa lista che setaccia gli archivi aperti.
ESCLUSIONI = os.path.join(RADICE, "assets", "contenuti", "esclusioni_rassegna.json")
BYTE_PER_FILE = 60 * 1024 * 1024


class Orologio:
    """
    L'HLC della conduttura, nello stesso formato di lib/hlc.ts:
    <12 esadecimali di millisecondi>-<4 esadecimali di contatore>-<dispositivo>

    Serve un orologio vero e non un contatore qualunque: l'app risolve i
    conflitti confrontando gli HLC, e un timbro inventato più basso di quelli
    del telefono perderebbe ogni confronto pur essendo successivo.
    """

    def __init__(self, dispositivo=DISPOSITIVO, ms=None):
        self.dispositivo = dispositivo
        self.ms = ms if ms is not None else int(time.time() * 1000)
        self.contatore = 0

    def adesso(self):
        ora = int(time.time() * 1000)
        if ora > self.ms:
            self.ms, self.contatore = ora, 0
        else:
            self.contatore += 1
        return "%012x-%04x-%s" % (self.ms, self.contatore, self.dispositivo)


def codice_stabile(prefisso, seme):
    """
    Una chiave corta, deterministica e sicura da usare come nome di file.
    Deterministica perché la stessa voce, ritrovata domani da un altro
    archivio, deve aggiornare la riga di ieri invece di crearne una seconda.
    """
    return "%s-%s" % (prefisso, hashlib.sha1(seme.encode("utf-8")).hexdigest()[:16])


def adesso_iso():
    return datetime.now(timezone.utc).isoformat()


def data_iso(valore):
    """Le fonti danno 2026-09-21, a volte con l'ora, a volte niente."""
    if not valore:
        return None
    testo = str(valore).strip()
    if re.fullmatch(r"\d{4}-\d{2}-\d{2}", testo):
        return testo + "T00:00:00+00:00"
    try:
        return datetime.fromisoformat(testo.replace("Z", "+00:00")).isoformat()
    except ValueError:
        return None


def carica_json(percorso, difetto):
    try:
        with open(percorso, encoding="utf-8") as f:
            return json.load(f)
    except (OSError, json.JSONDecodeError):
        return difetto


# --------------------------------------------------------------- articoli


# Il mezzo punto: la rilevanza alla quale il voto vale 50. Scelto sulla
# distribuzione vera della prima corsa (mediana intorno a 5), non a occhio.
MEZZO_PUNTO = 5.0


def punteggio_da(rilevanza):
    """
    Da una rilevanza senza tetto a un voto 0..100 che non satura mai.

    Monotona: se una voce è più rilevante di un'altra, il suo voto è più alto.
    Limitata per costruzione: il CHECK della colonna non si può sforare nemmeno
    con un valore assurdo, che è esattamente ciò che ha ucciso la prima corsa.
    """
    r = float(rilevanza or 0)
    if r <= 0:
        return 0
    return int(round(100.0 * r / (r + MEZZO_PUNTO)))


def titolo_normale(titolo):
    """
    Il titolo ridotto all'osso per confrontarlo: minuscole, senza punteggiatura
    e senza spazi doppi. Serve perché lo stesso articolo arriva da archivi
    diversi con la stessa forma ma non con gli stessi byte — un'entità HTML,
    un trattino lungo al posto di uno corto, due spazi.
    """
    return re.sub(r"[^a-z0-9]+", " ", (titolo or "").lower()).strip()


def url_di(v):
    """L'url che finirà in tabella. Una funzione sola perché `riga_articolo` e
    la deduplica devono guardare lo STESSO valore: se la deduplica confronta
    `v["url"]` e la riga scrive il ripiego su `url_pdf`, il vincolo colpisce
    un indirizzo che nessuno aveva confrontato."""
    return v.get("url") or v.get("url_pdf") or ("chiave:" + v["chiave"])


def pregio(v):
    """Fra due copie vince chi ha più da leggere. Stesso criterio per i titoli
    ripetuti e per gli url ripetuti: due criteri diversi si contraddirebbero
    sulla stessa coppia di voci."""
    return (bool(v.get("url_pdf")), len(v.get("abstract") or ""),
            float(v.get("rilevanza") or 0))


def senza_url_ripetuti(voci, rapporto, url_gia=()):
    """
    `percorso.articoli` ha DUE vincoli di unicità — `(utente_id, chiave)` e
    `(utente_id, url)` — e l'upsert può risolverne uno solo: quello che passa
    in `on_conflict`. L'altro non viene fuso. Viola, e PostgREST rifiuta
    l'INTERO lotto con 23505: non si perde una riga, si perde la mattina.

    I feed lo rendono probabile. `feed.voci_da` ripiega sull'indirizzo del sito
    quando una voce non ha `<link>`, quindi due voci senza collegamento nello
    stesso feed arrivano qui con lo stesso url e due chiavi diverse. Lo stesso
    vale per due voci che rimandano alla stessa pagina.

    Gli url già in archivio contano quanto quelli dentro al lotto: una voce
    con una chiave nuova e un url vecchio passa il filtro delle chiavi e va a
    sbattere lo stesso.
    """
    noti = {u for u in url_gia if u}
    migliori, gia_visti = {}, 0
    for v in voci:
        u = url_di(v)
        if u in noti:
            gia_visti += 1
            continue
        if u not in migliori or pregio(v) > pregio(migliori[u]):
            migliori[u] = v
    entro_il_lotto = len(voci) - gia_visti - len(migliori)
    scartati = gia_visti + entro_il_lotto
    if scartati:
        rapporto["url_ripetuti"] = rapporto.get("url_ripetuti", 0) + scartati
    tenute = set(id(v) for v in migliori.values())
    return [v for v in voci if id(v) in tenute]


def senza_doppioni(voci, rapporto, gia_noti=()):
    """
    Lo stesso articolo pubblicato da due archivi ha due `chiave` diverse, e la
    setacciatura della rassegna deduplica per chiave: i doppioni le passano
    sotto. Nella prima corsa vera erano diciassette su ottanta, e sullo schermo
    si vedrebbero due volte.

    Fra due copie vince quella con più da leggere: prima chi ha un PDF, poi chi
    ha il sommario più lungo, poi la più rilevante. È lo stesso criterio che
    `catalogo.py` usa quando le chiavi coincidono, applicato al titolo.
    """
    # I titoli gia in archivio contano quanto quelli dentro al lotto: la stessa
    # voce ritrovata domani da un altro archivio ha una chiave diversa, passa
    # il filtro delle chiavi, e si deposita accanto a quella di ieri. Guardare
    # solo dentro il lotto lasciava tornare i doppioni una mattina dopo
    # l'altra: trentuno su duecentoventitre alla seconda corsa.
    noti = {t for t in (titolo_normale(x) for x in gia_noti) if t}
    migliori, gia_visti = {}, 0
    for v in voci:
        chiave = titolo_normale(v.get("titolo"))
        if chiave and chiave in noti:
            gia_visti += 1
            continue
        if not chiave:
            # Senza titolo non si può confrontare: passa, e ci penserà la
            # chiave della rassegna. Buttarla sarebbe peggio del doppione.
            migliori[("senza-titolo", v["chiave"])] = v
            continue
        if chiave not in migliori or pregio(v) > pregio(migliori[chiave]):
            migliori[chiave] = v
    # Gli scarti sono due categorie distinte e non vanno sommate due volte:
    # quelli gia in archivio non entrano mai in `migliori`, quindi sottrarli
    # anche dalla differenza li conterebbe di nuovo.
    entro_il_lotto = len(voci) - gia_visti - len(migliori)
    scartati = gia_visti + entro_il_lotto
    if scartati:
        rapporto["doppioni"] = rapporto.get("doppioni", 0) + scartati
    # L'ordine di partenza non si perde: si rimettono in fila come erano.
    tenute = set(id(v) for v in migliori.values())
    return [v for v in voci if id(v) in tenute]


def riga_articolo(v, testo, rapporto):
    """Da una voce del catalogo alla riga di `percorso.articoli`."""
    autori = [a for a in (v.get("autori") or []) if a][:12]
    return {
        "chiave": v["chiave"],
        "titolo": (v.get("titolo") or "(senza titolo)")[:2000],
        "url": url_di(v),
        "url_pdf": v.get("url_pdf"),
        "autori": autori,
        "fonte": v.get("fonte"),
        "abstract": (v.get("abstract") or None),
        "testo": testo,
        "tema_slug": v.get("tema_slug"),
        "trimestre": v.get("trimestre"),
        "licenza": v.get("licenza"),
        "pubblicato_a": data_iso(v.get("data")),
        # Due colonne, due contratti. `rilevanza` è il numero grezzo, senza
        # tetto: nella prima corsa vera è arrivato a 11,2. `punteggio` ha un
        # CHECK 0..100 ed è il voto leggibile.
        #
        # La conversione NON è lineare, e la prima stesura lineare era sbagliata
        # due volte: `* 100` sforava il CHECK e ha fatto morire una corsa;
        # `* 20` stava dentro ma dava 100 a tutte e ottanta le voci, perché
        # satura da 5 in su. Una colonna costante non è un voto, è un rumore
        # che occupa spazio.
        #
        # Una curva che si avvicina a 100 senza mai toccarlo tiene l'ordine su
        # tutta la scala e non può sforare per costruzione, qualunque cosa
        # arrivi dagli archivi: 1 → 17, 2,5 → 33, 5 → 50, 11,2 → 69.
        "punteggio": punteggio_da(v.get("rilevanza")),
        "rilevanza": float(v.get("rilevanza") or 0),
        "raccolto_a": rapporto["adesso"],
    }


def payload_articolo(riga):
    """
    Il payload dell'evento porta le colonne della tabella LOCALE dell'app, che
    non è identica a quella remota: `autori` lì è testo, non un elenco.

    Porta TUTTI i campi, non solo quelli nuovi: con un payload parziale la
    proiezione sul telefono non può creare la riga (mancano le colonne
    obbligatorie) e la salta in silenzio.
    """
    return {
        "titolo": riga["titolo"],
        "autori": ", ".join(riga["autori"]) or None,
        "fonte": riga["fonte"],
        "url": riga["url"],
        "url_pdf": riga["url_pdf"],
        "abstract": riga["abstract"],
        "testo": riga["testo"],
        "tema_slug": riga["tema_slug"],
        "trimestre": riga["trimestre"],
        "licenza": riga["licenza"],
        "pubblicato_a": riga["pubblicato_a"],
        "raccolto_a": riga["raccolto_a"],
        "letto": 0,
        "salvato": 0,
    }


def payload_volume(riga):
    """Le colonne della tabella `biblioteca` locale. `file_locale` MAI: è un
    percorso del telefono e su un altro dispositivo non significa niente."""
    return {
        "titolo": riga["titolo"],
        "autore": riga.get("autore"),
        "tema_slug": riga.get("tema_slug"),
        "trimestre": riga.get("trimestre"),
        "origine": riga.get("origine", "aperta"),
        "licenza": riga.get("licenza"),
        "url": riga.get("url"),
        "formato": riga.get("formato", "pdf"),
        "byte": riga.get("byte"),
        "sha256": riga.get("sha256"),
        "aggiunto_a": riga["aggiunto_a"],
        "codice": riga["codice"],
        "pdf_path": riga["pdf_path"],
        "nota": riga.get("nota"),
    }


def evento(orologio, entita, entita_id, tipo, payload):
    hlc = orologio.adesso()
    return {
        # Stessa forma dell'id costruito da lib/db.ts: è ciò che permette la
        # deduplicazione fra conduttura e telefono senza un accordo in più.
        "id": hlc + ":" + entita_id,
        "hlc": hlc,
        "dispositivo_id": DISPOSITIVO,
        "entita": entita,
        "entita_id": entita_id,
        "tipo": tipo,
        "payload": payload,
        "sorgente": "conduttura",
    }


# ------------------------------------------------------------------- testo


def testo_della_voce(v, vie, rapporto, scadenza):
    """
    Prova a portare a casa il testo. In ordine: la via d'accesso trovata dal
    ricercatore, poi l'url_pdf, poi la pagina della voce.

    Restituisce (testo, pdf) dove `pdf` è (dati, url) se ciò che è arrivato è
    davvero un PDF. Il Content-Type non decide niente: diversi archivi
    rispondono application/pdf con dentro una pagina di login.
    """
    candidati = []
    via = vie.get(v["chiave"])
    if via and via.get("url"):
        candidati.append(via["url"])
    if v.get("url_pdf"):
        candidati.append(v["url_pdf"])
    if v.get("url"):
        candidati.append(v["url"])

    visti = set()
    for url in candidati:
        if not url or url in visti:
            continue
        visti.add(url)
        if time.time() > scadenza:
            rapporto["tempo_scaduto"] = True
            return None, None
        try:
            dati, _tipo = scarica(url, massimo_byte=BYTE_PER_FILE, timeout=25)
        except ErroreEstrazione as e:
            rapporto["falliti"].append("%s: %s" % (url[:90], str(e)[:120]))
            continue
        if e_pdf(dati):
            return None, (dati, url)
        try:
            testo = testo_da_html(dati)
        except Exception as e:  # noqa: BLE001 — un parser che esplode su una
            # pagina malformata non deve poter fermare l'intera rassegna.
            rapporto["falliti"].append("%s: estrazione fallita (%s)" % (url[:90], str(e)[:80]))
            continue
        # Sotto i quattrocento caratteri non è un articolo: è un muro di
        # cookie, o una pagina che dice «abilita JavaScript».
        if len(testo) >= 400:
            return testo, None
    return None, None


# ------------------------------------------------------------------ corsa


def pubblica(cartella, cartella_manuale, nuvola, tetti, rapporto):
    catalogo = carica_json(os.path.join(cartella, "catalogo.json"), [])
    trovati = carica_json(os.path.join(cartella, "trovati.json"), [])
    vie = {}
    for t in trovati if isinstance(trovati, list) else []:
        if isinstance(t, dict) and t.get("chiave"):
            vie[t["chiave"]] = t

    orologio = Orologio()
    scadenza = time.time() + tetti["minuti"] * 60

    # I feed entrano NEL catalogo, non accanto. Da questa riga in giù una voce
    # RSS è una voce come le altre: stessa deduplica per titolo, stessa
    # estrazione del testo, stesso evento. Una seconda strada avrebbe voluto
    # dire una seconda deduplica da tenere allineata a questa, e prima o poi
    # non lo sarebbe stata.
    #
    # Il tetto di tempo sta DENTRO quello complessivo, e vale un terzo di
    # quanto resta: un feed che non risponde non deve rubare i minuti
    # all'estrazione, che è la parte che produce qualcosa da leggere. Un
    # catalogo di titoli senza testo, in aereo, non si legge.
    minuti_feed = min(float(tetti.get("minuti_feed", MINUTI_FEED)),
                      max(0.0, scadenza - time.time()) / 180.0)
    if minuti_feed > 0:
        voci = feed.raccogli(
            nuvola, rapporto,
            massimo_per_fonte=int(tetti.get("per_fonte", MASSIMO_PER_FONTE)),
            minuti=minuti_feed,
        )
        # Il rumore redazionale si toglie qui e non dentro `feed.py`: l'elenco
        # sta in `assets/contenuti/`, e un lettore di RSS che se lo caricasse
        # da solo sarebbe un modulo che senza il repository non funziona.
        #
        # Gli archivi aperti ci sono già passati dentro, in
        # `catalogo.setaccia()`. I feed no, e ne portano molto di più: «Acme
        # announces the launch of a GDPR compliance platform» prende un tema
        # pieno e non è una pubblicazione — è un comunicato stampa. Senza
        # questo passaggio la biblioteca si riempirebbe di annunci.
        esclusioni = carica_json(ESCLUSIONI, [])
        pulite = [v for v in voci if not e_rumore(v.get("titolo") or "", esclusioni)]
        rumore = len(voci) - len(pulite)
        rapporto["rumore_feed"] = rapporto.get("rumore_feed", 0) + rumore
        rapporto["voci_da_feed"] = max(0, rapporto.get("voci_da_feed", 0) - rumore)
        catalogo = list(catalogo) + pulite

    # Lo stato: le chiavi già pubblicate. Una colonna sola, qualche migliaio di
    # righe: costa meno di qualunque file di stato da tenere allineato.
    gia, titoli_gia, url_gia = set(), set(), set()
    for r in nuvola.seleziona("articoli", "select=chiave,titolo,url", massimo=20000):
        if r.get("chiave"):
            gia.add(r["chiave"])
        if r.get("titolo"):
            titoli_gia.add(r["titolo"])
        if r.get("url"):
            url_gia.add(r["url"])
    rapporto["gia_in_archivio"] = len(gia)

    nuove = [v for v in catalogo if isinstance(v, dict) and v.get("chiave") not in gia]
    # Le più rilevanti per prime: se il tetto taglia, taglia le ultime.
    nuove.sort(key=lambda v: -float(v.get("rilevanza") or 0))
    # I doppioni si tolgono PRIMA del tetto: altrimenti il tetto conta due
    # volte la stessa voce e lascia fuori qualcosa che non c'è ancora.
    nuove = senza_doppioni(nuove, rapporto, titoli_gia)
    # E poi per url, che è l'ALTRO vincolo di unicità della tabella. Due voci
    # con titoli diversi possono benissimo avere lo stesso indirizzo, e in quel
    # caso non si perde una riga: il lotto intero viene rifiutato.
    nuove = senza_url_ripetuti(nuove, rapporto, url_gia)
    nuove = nuove[: tetti["articoli"]]
    rapporto["candidate"] = len(nuove)

    righe_articoli, righe_volumi, eventi = [], [], []
    pdf_presi = 0

    for v in nuove:
        if time.time() > scadenza:
            rapporto["tempo_scaduto"] = True
            break

        testo, pdf = (None, None)
        if pdf_presi < tetti["pdf"] or not v.get("url_pdf"):
            testo, pdf = testo_della_voce(v, vie, rapporto, scadenza)

        if pdf and pdf_presi < tetti["pdf"]:
            dati, url = pdf
            codice = codice_stabile("RAS", v["chiave"])
            percorso = "rassegna/%s.pdf" % codice
            try:
                nuvola.carica_file(percorso, dati, "application/pdf")
            except ErroreNuvola as e:
                rapporto["falliti"].append("deposito %s: %s" % (codice, str(e)[:140]))
                percorso = None
            if percorso:
                pdf_presi += 1
                riga = {
                    "codice": codice,
                    "titolo": (v.get("titolo") or "(senza titolo)")[:2000],
                    "autore": ", ".join((v.get("autori") or [])[:3]) or v.get("editore"),
                    "tema_slug": v.get("tema_slug"),
                    "trimestre": v.get("trimestre"),
                    "origine": "aperta",
                    "licenza": v.get("licenza") or "da verificare sulla scheda",
                    "url": url,
                    "formato": "pdf",
                    "byte": len(dati),
                    "sha256": impronta(dati),
                    "pdf_path": percorso,
                    "nota": riassunto(v.get("abstract") or "", 280) or None,
                    "aggiunto_a": rapporto["adesso"],
                }
                righe_volumi.append(riga)
                eventi.append(evento(orologio, "biblioteca", codice, "crea", payload_volume(riga)))
                rapporto["pdf"] += 1

        riga = riga_articolo(v, testo, rapporto)
        righe_articoli.append(riga)
        eventi.append(evento(orologio, "articoli", v["chiave"], "crea", payload_articolo(riga)))
        if testo:
            rapporto["con_testo"] += 1

    # I file lasciati a mano nel repository seguono la STESSA strada: stesso
    # deposito, stessa tabella, stesso evento. È il requisito, e anche l'unico
    # modo perché non esistano due percorsi da tenere allineati.
    if cartella_manuale and os.path.isdir(cartella_manuale):
        for riga in manuali(cartella_manuale, nuvola, rapporto):
            righe_volumi.append(riga)
            eventi.append(
                evento(orologio, "biblioteca", riga["codice"], "crea", payload_volume(riga))
            )

    rapporto["articoli"] = len(righe_articoli)
    rapporto["volumi"] = len(righe_volumi)

    # L'ordine conta: prima le proiezioni, poi gli eventi. Se la corsa muore in
    # mezzo, restano righe senza evento — inerti — invece di eventi che
    # promettono righe che non ci sono.
    nuvola.innesta("articoli", righe_articoli, "utente_id,chiave")
    nuvola.innesta("biblioteca", righe_volumi, "utente_id,codice")
    nuvola.innesta("eventi", eventi, "id")
    rapporto["eventi"] = len(eventi)


def manuali(cartella, nuvola, rapporto):
    """
    Ogni PDF o EPUB lasciato in `biblioteca-manuale/`. Un file `<nome>.json`
    accanto, se c'è, dà i dati veri invece di quelli indovinati dal nome.
    """
    fuori = []
    for nome in sorted(os.listdir(cartella)):
        base, punto, estensione = nome.rpartition(".")
        estensione = estensione.lower()
        if estensione not in ("pdf", "epub"):
            continue
        percorso_locale = os.path.join(cartella, nome)
        try:
            with open(percorso_locale, "rb") as f:
                dati = f.read(BYTE_PER_FILE + 1)
        except OSError as e:
            rapporto["falliti"].append("%s: %s" % (nome, e))
            continue
        if len(dati) > BYTE_PER_FILE:
            rapporto["falliti"].append("%s: oltre il tetto di %d byte" % (nome, BYTE_PER_FILE))
            continue
        if estensione == "pdf" and not e_pdf(dati):
            rapporto["falliti"].append("%s: si chiama .pdf ma non lo è" % nome)
            continue

        scheda = carica_json(os.path.join(cartella, base + ".json"), {})
        codice = codice_stabile("MAN", nome)
        percorso = "manuale/%s.%s" % (codice, estensione)
        try:
            nuvola.carica_file(
                percorso,
                dati,
                "application/epub+zip" if estensione == "epub" else "application/pdf",
            )
        except ErroreNuvola as e:
            rapporto["falliti"].append("deposito %s: %s" % (nome, str(e)[:140]))
            continue

        fuori.append(
            {
                "codice": codice,
                "titolo": scheda.get("titolo") or base.replace("_", " ").strip(),
                "autore": scheda.get("autore"),
                "tema_slug": scheda.get("tema_slug"),
                "trimestre": scheda.get("trimestre"),
                "origine": "manuale",
                "licenza": scheda.get("licenza"),
                "url": scheda.get("url"),
                "formato": estensione,
                "byte": len(dati),
                "sha256": impronta(dati),
                "pdf_path": percorso,
                "nota": scheda.get("nota"),
                "aggiunto_a": rapporto["adesso"],
            }
        )
        rapporto["manuali"] += 1
    return fuori


def scrivi_rapporto(cartella, rapporto):
    righe = [
        "Nuvola — %s" % rapporto["adesso"],
        "",
        "Già in archivio  : %d" % rapporto["gia_in_archivio"],
        "Feed letti       : %d" % rapporto.get("feed_letti", 0),
        "Voci dai feed    : %d" % rapporto.get("voci_da_feed", 0),
        "  rumore tolto   : %d" % rapporto.get("rumore_feed", 0),
        "Candidate        : %d" % rapporto["candidate"],
        "Doppioni tolti   : %d" % rapporto.get("doppioni", 0),
        "Url ripetuti     : %d" % rapporto.get("url_ripetuti", 0),
        "Articoli scritti : %d" % rapporto["articoli"],
        "  con testo      : %d" % rapporto["con_testo"],
        "PDF depositati   : %d" % rapporto["pdf"],
        "File a mano      : %d" % rapporto["manuali"],
        "Volumi scritti   : %d" % rapporto["volumi"],
        "Eventi scritti   : %d" % rapporto["eventi"],
    ]
    if rapporto["tempo_scaduto"]:
        righe += ["", "TEMPO SCADUTO: il resto va al prossimo giro."]
    if rapporto["falliti"]:
        righe += ["", "NON RIUSCITI (%d):" % len(rapporto["falliti"])]
        righe += ["  " + f for f in rapporto["falliti"][:40]]
    testo = "\n".join(righe) + "\n"
    os.makedirs(cartella, exist_ok=True)
    with open(os.path.join(cartella, "nuvola.txt"), "w", encoding="utf-8") as f:
        f.write(testo)
    return testo


def principale(argv=None):
    p = argparse.ArgumentParser(description="Porta la rassegna su Supabase.")
    p.add_argument("--cartella", default="rassegna")
    p.add_argument("--manuale", default="biblioteca-manuale")
    p.add_argument("--massimo-articoli", type=int, default=MASSIMO_ARTICOLI)
    p.add_argument("--massimo-pdf", type=int, default=MASSIMO_PDF)
    p.add_argument("--minuti", type=int, default=MINUTI)
    p.add_argument("--minuti-feed", type=float, default=MINUTI_FEED)
    p.add_argument("--per-fonte", type=int, default=MASSIMO_PER_FONTE)
    a = p.parse_args(argv)

    rapporto = {
        "adesso": adesso_iso(),
        "gia_in_archivio": 0,
        "candidate": 0,
        "feed_letti": 0,
        "voci_da_feed": 0,
        "rumore_feed": 0,
        "articoli": 0,
        "con_testo": 0,
        "pdf": 0,
        "manuali": 0,
        "volumi": 0,
        "eventi": 0,
        "doppioni": 0,
        "url_ripetuti": 0,
        "falliti": [],
        "tempo_scaduto": False,
    }
    nuvola = Nuvola()
    # `raggiungibile()` torna un booleano, e un booleano non dice mai perché.
    # Alla prima corsa vera questa riga ha stampato «Supabase non risponde o la
    # chiave non è più buona» su un 404 di PostgREST — cioè «questa tabella non
    # è nella mia cache dello schema», che ha un rimedio preciso e nessuna
    # attinenza con la chiave. Il corpo della risposta va mostrato: di notte,
    # senza nessuno che guardi, è l'unica cosa che resta.
    try:
        nuvola.seleziona("articoli", "select=chiave", massimo=1)
    except ErroreNuvola as e:
        print("Supabase non accetta la conduttura: %s" % e, file=sys.stderr)
        print("Esegui «python3 strumenti/nuvola/diagnosi.py» per sapere quale "
              "dei quattro permessi manca.", file=sys.stderr)
        return 1
    try:
        pubblica(a.cartella, a.manuale, nuvola, {
            "articoli": a.massimo_articoli, "pdf": a.massimo_pdf, "minuti": a.minuti,
            "minuti_feed": a.minuti_feed, "per_fonte": a.per_fonte,
        }, rapporto)
    except ErroreNuvola as e:
        print(scrivi_rapporto(a.cartella, rapporto))
        print("Scrittura interrotta: %s" % e, file=sys.stderr)
        return 1
    print(scrivi_rapporto(a.cartella, rapporto))
    return 0


if __name__ == "__main__":
    sys.exit(principale())
