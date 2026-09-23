# -*- coding: utf-8 -*-
"""Esercizi di lettura del codice.

Ogni esercizio contiene un modulo con UN difetto deliberato, la versione corretta
e un test. Il verificatore controlla che il test FALLISCA sul codice difettoso e
PASSI su quello corretto: se non accade, l'esercizio non entra nel pacchetto.
Non è il mio giudizio a stabilire che c'è un bug — è l'esecuzione.
"""

ESERCIZI_CODICE = [

dict(id="COD-01", categoria="paginazione", livello=3,
 titolo="Estrazione paginata da API",
 consegna="Questa funzione scarica tutte le pagine di un'API. Con un server che impone un proprio limite di pagina, restituisce silenziosamente dati incompleti. Perche?",
 codice_difettoso='''
def scarica_tutto(client, pagina_size=100):
    risultati = []
    pagina = 0
    while True:
        blocco = client.get(offset=pagina * pagina_size, limit=pagina_size)
        risultati.extend(blocco)
        if len(blocco) < pagina_size:
            break
        pagina += 1
    return risultati
''',
 codice_corretto='''
def scarica_tutto(client, pagina_size=100):
    risultati = []
    offset = 0
    while True:
        blocco = client.get(offset=offset, limit=pagina_size)
        if not blocco:
            break
        risultati.extend(blocco)
        offset += len(blocco)
    return risultati
''',
 difetto="Usa 'meno record del richiesto' come segnale di fine dati e calcola l'offset moltiplicando per la dimensione richiesta anziche per quella ricevuta. Se il server impone un proprio tetto di pagina (molto comune), la prima risposta e gia piu corta del richiesto e l'estrazione si ferma al primo blocco, perdendo dati senza alcun errore. Il segnale di fine deve essere il blocco vuoto, e l'offset deve avanzare dei record effettivamente ricevuti.",
 test='''
class FakeClient:
    """Server che limita a 50 record per chiamata, qualunque cosa si chieda."""
    def __init__(self, totale, tetto=50):
        self.dati = list(range(totale))
        self.tetto = tetto
        self.chiamate = 0
    def get(self, offset, limit):
        self.chiamate += 1
        if self.chiamate > 30:
            raise RuntimeError("ciclo infinito")
        return self.dati[offset:offset + min(limit, self.tetto)]

def verifica(ns):
    c = FakeClient(200)
    r = ns["scarica_tutto"](c, pagina_size=100)
    assert len(r) == 200, f"attesi 200 record, ottenuti {len(r)}"
    assert sorted(r) == list(range(200)), "record duplicati o mancanti"
'''),

dict(id="COD-02", categoria="argomento_mutabile", livello=2,
 titolo="Accumulo di errori di validazione",
 consegna="Questa funzione valida un record e accumula gli errori. Chiamandola due volte il risultato è sbagliato. Perché?",
 codice_difettoso='''
def valida(record, errori=[]):
    if not record.get("codice"):
        errori.append("codice mancante")
    if record.get("eta") is not None and record["eta"] < 0:
        errori.append("eta negativa")
    return errori
''',
 codice_corretto='''
def valida(record, errori=None):
    if errori is None:
        errori = []
    if not record.get("codice"):
        errori.append("codice mancante")
    if record.get("eta") is not None and record["eta"] < 0:
        errori.append("eta negativa")
    return errori
''',
 difetto="Argomento di default mutabile: la lista viene creata una sola volta alla definizione della funzione e condivisa fra tutte le chiamate, accumulando gli errori dei record precedenti.",
 test='''
def verifica(ns):
    v = ns["valida"]
    assert v({"codice": None}) == ["codice mancante"]
    r = v({"codice": "X", "eta": -1})
    assert r == ["eta negativa"], f"stato residuo fra chiamate: {r}"
'''),

dict(id="COD-03", categoria="divisione", livello=1,
 titolo="Tasso di copertura",
 consegna="Calcolo di un tasso percentuale. Un input plausibile lo fa esplodere.",
 codice_difettoso='''
def tasso_copertura(coperti, popolazione):
    return round(100.0 * coperti / popolazione, 2)
''',
 codice_corretto='''
def tasso_copertura(coperti, popolazione):
    if not popolazione:
        return None
    return round(100.0 * coperti / popolazione, 2)
''',
 difetto="Nessuna guardia sul denominatore zero: un sito con popolazione stimata 0 o sconosciuta interrompe l'intera pipeline invece di produrre un valore mancante.",
 test='''
def verifica(ns):
    f = ns["tasso_copertura"]
    assert f(50, 200) == 25.0
    assert f(0, 0) is None, "denominatore zero deve restituire None, non sollevare"
'''),

dict(id="COD-04", categoria="eccezioni", livello=3,
 titolo="Retry con backoff",
 consegna="Questo retry sembra corretto ma in un caso restituisce silenziosamente None invece di segnalare il fallimento.",
 codice_difettoso='''
def con_retry(funzione, tentativi=3):
    for i in range(tentativi):
        try:
            return funzione()
        except Exception:
            continue
''',
 codice_corretto='''
def con_retry(funzione, tentativi=3):
    ultimo = None
    for i in range(tentativi):
        try:
            return funzione()
        except Exception as e:
            ultimo = e
    raise ultimo
''',
 difetto="Esaurititi i tentativi la funzione termina senza return, restituendo None. Il chiamante non distingue un fallimento da un risultato nullo legittimo, e l'errore si propaga come dato corrotto invece che come eccezione.",
 test='''
def verifica(ns):
    f = ns["con_retry"]
    def sempre_errore():
        raise ValueError("boom")
    try:
        f(sempre_errore, tentativi=2)
    except ValueError:
        return
    raise AssertionError("dopo l'ultimo tentativo deve sollevare, non restituire None")
'''),

dict(id="COD-05", categoria="aggregazione", livello=2,
 titolo="Media ignorando i valori mancanti",
 consegna="Media di una lista di misurazioni che può contenere valori mancanti.",
 codice_difettoso='''
def media(valori):
    return sum(v for v in valori if v is not None) / len(valori)
''',
 codice_corretto='''
def media(valori):
    validi = [v for v in valori if v is not None]
    if not validi:
        return None
    return sum(validi) / len(validi)
''',
 difetto="Il numeratore esclude i None ma il denominatore li conta: la media risulta sistematicamente sottostimata in proporzione ai dati mancanti. Errore silenzioso, non produce mai un'eccezione.",
 test='''
def verifica(ns):
    f = ns["media"]
    assert f([10, 20, None, None]) == 15.0, "i None non vanno contati al denominatore"
    assert f([None, None]) is None
'''),

dict(id="COD-06", categoria="sicurezza", livello=3,
 titolo="Costruzione di una query",
 consegna="Questa funzione costruisce una query SQL. C'è un problema che non si manifesta con dati normali.",
 codice_difettoso='''
def conta_per_regione(con, regione):
    q = "SELECT count(*) FROM pazienti WHERE regione = '" + regione + "'"
    return con.execute(q).fetchone()[0]
''',
 codice_corretto='''
def conta_per_regione(con, regione):
    q = "SELECT count(*) FROM pazienti WHERE regione = ?"
    return con.execute(q, (regione,)).fetchone()[0]
''',
 difetto="Query costruita per concatenazione: un apostrofo nel valore rompe la sintassi e un input ostile può alterare la semantica della query. Va usato il binding dei parametri.",
 test='''
import sqlite3
def verifica(ns):
    con = sqlite3.connect(":memory:")
    con.execute("CREATE TABLE pazienti (regione TEXT)")
    con.executemany("INSERT INTO pazienti VALUES (?)", [("Cox's Bazar",), ("Jonglei",)])
    n = ns["conta_per_regione"](con, "Cox's Bazar")
    assert n == 1, f"atteso 1, ottenuto {n}"
'''),

dict(id="COD-07", categoria="date", livello=3,
 titolo="Calcolo dell'età",
 consegna="Calcolo dell'età in anni compiuti a partire dalla data di nascita.",
 codice_difettoso='''
from datetime import date
def eta(data_nascita, riferimento):
    return riferimento.year - data_nascita.year
''',
 codice_corretto='''
from datetime import date
def eta(data_nascita, riferimento):
    anni = riferimento.year - data_nascita.year
    if (riferimento.month, riferimento.day) < (data_nascita.month, data_nascita.day):
        anni -= 1
    return anni
''',
 difetto="Sottrae solo gli anni senza verificare se il compleanno è già trascorso: sovrastima di un anno tutti i soggetti nati dopo la data di riferimento nell'anno. In una stratificazione pediatrica sposta bambini nella fascia superiore.",
 test='''
from datetime import date
def verifica(ns):
    f = ns["eta"]
    assert f(date(2020, 12, 31), date(2026, 1, 1)) == 5, "compleanno non ancora trascorso"
    assert f(date(2020, 1, 1), date(2026, 1, 1)) == 6
'''),

dict(id="COD-08", categoria="deduplicazione", livello=3,
 titolo="Deduplicazione di record",
 consegna="Deduplica una lista di record sulla base di una chiave.",
 codice_difettoso='''
def dedup(record, chiave):
    visti = []
    risultato = []
    for r in record:
        if r[chiave] not in visti:
            visti.append(r[chiave])
            risultato.append(r)
    return risultato
''',
 codice_corretto='''
def dedup(record, chiave):
    visti = set()
    risultato = []
    for r in record:
        k = r[chiave]
        if k not in visti:
            visti.add(k)
            risultato.append(r)
    return risultato
''',
 difetto="La ricerca in una lista è lineare: su n record il costo diventa quadratico. Con 200.000 righe la funzione passa da secondi a ore. Il risultato è corretto, il difetto è di scala.",
 test='''
import time
def verifica(ns):
    f = ns["dedup"]
    dati = [{"id": i % 20000} for i in range(40000)]
    t0 = time.time()
    r = f(dati, "id")
    durata = time.time() - t0
    assert len(r) == 20000
    assert durata < 0.5, f"troppo lento: {durata:.2f}s — ricerca lineare su lista"
'''),

dict(id="COD-09", categoria="mutazione", livello=3,
 titolo="Arricchimento di un record",
 consegna="Questa funzione aggiunge campi calcolati a un record. Il chiamante si ritrova con i dati originali modificati.",
 codice_difettoso='''
def arricchisci(record, regione_default="ignota"):
    record["regione"] = record.get("regione") or regione_default
    record["completo"] = bool(record.get("codice"))
    return record
''',
 codice_corretto='''
def arricchisci(record, regione_default="ignota"):
    nuovo = dict(record)
    nuovo["regione"] = nuovo.get("regione") or regione_default
    nuovo["completo"] = bool(nuovo.get("codice"))
    return nuovo
''',
 difetto="Modifica l'oggetto in ingresso invece di restituirne una copia. Chi conserva il record grezzo per audit o per un secondo passaggio si ritrova dati già trasformati, e la pipeline non è più rieseguibile.",
 test='''
def verifica(ns):
    originale = {"codice": "PZ-1"}
    copia_attesa = dict(originale)
    ns["arricchisci"](originale)
    assert originale == copia_attesa, f"input mutato: {originale}"
'''),

dict(id="COD-10", categoria="float", livello=2,
 titolo="Confronto di importi",
 consegna="Verifica che la somma delle voci corrisponda al totale dichiarato.",
 codice_difettoso='''
def quadra(voci, totale):
    return sum(voci) == totale
''',
 codice_corretto='''
def quadra(voci, totale, tolleranza=0.01):
    return abs(sum(voci) - totale) < tolleranza
''',
 difetto="Confronto di uguaglianza esatta fra numeri in virgola mobile: la somma di 0.1 + 0.2 non è esattamente 0.3. Una riconciliazione contabile costruita così fallisce su dati perfettamente validi.",
 test='''
def verifica(ns):
    f = ns["quadra"]
    assert f([0.1, 0.2], 0.3) is True, "0.1+0.2 non è esattamente 0.3 in virgola mobile"
    assert f([1.0, 2.0], 5.0) is False
'''),

dict(id="COD-11", categoria="encoding", livello=3,
 titolo="Lettura di un CSV esportato da Excel",
 consegna="Legge un CSV esportato da Excel su Windows. La prima colonna non corrisponde mai nei confronti, pur sembrando identica a schermo.",
 codice_difettoso='''
def leggi_intestazioni(percorso):
    with open(percorso, encoding="utf-8") as f:
        prima = f.readline().strip()
    return prima.split(",")
''',
 codice_corretto='''
def leggi_intestazioni(percorso):
    with open(percorso, encoding="utf-8-sig") as f:
        prima = f.readline().strip()
    return prima.split(",")
''',
 difetto="Excel su Windows scrive UTF-8 con BOM. Letto come utf-8 semplice, il BOM resta come carattere invisibile in testa alla prima intestazione: 'codice' diventa '\\ufeffcodice' e ogni confronto o mappatura di colonna fallisce senza che si veda nulla. La codifica corretta in lettura e utf-8-sig.",
 test='''
import tempfile, os
def verifica(ns):
    p = tempfile.mktemp(suffix=".csv")
    with open(p, "w", encoding="utf-8-sig") as f:
        f.write("codice,regione,eta\\nPZ-1,Jonglei,34\\n")
    try:
        cols = ns["leggi_intestazioni"](p)
        assert cols[0] == "codice", f"prima colonna contaminata: {cols[0]!r}"
        assert cols == ["codice", "regione", "eta"]
    finally:
        os.remove(p)
'''),

dict(id="COD-12", categoria="logica", livello=3,
 titolo="Tasso di abbandono",
 consegna="Calcolo del tasso di abbandono di un programma. Il denominatore è sbagliato.",
 codice_difettoso='''
def tasso_abbandono(esiti):
    abbandoni = [e for e in esiti if e == "abbandono"]
    guarigioni = [e for e in esiti if e == "guarigione"]
    return len(abbandoni) / (len(abbandoni) + len(guarigioni))
''',
 codice_corretto='''
def tasso_abbandono(esiti):
    chiusi = [e for e in esiti if e in ("abbandono", "guarigione", "decesso", "trasferimento")]
    if not chiusi:
        return None
    return len([e for e in esiti if e == "abbandono"]) / len(chiusi)
''',
 difetto="Il denominatore considera solo abbandoni e guarigioni, escludendo decessi e trasferimenti. Il tasso risulta gonfiato e non è confrontabile con gli standard di settore, che lo calcolano su tutti gli esiti chiusi.",
 test='''
def verifica(ns):
    f = ns["tasso_abbandono"]
    esiti = ["abbandono", "guarigione", "guarigione", "decesso", "trasferimento"]
    r = f(esiti)
    assert abs(r - 0.2) < 1e-9, f"atteso 1/5 = 0.2, ottenuto {r}"
'''),

dict(id="COD-13", categoria="iterazione", livello=3,
 titolo="Filtro in-place di un dizionario",
 consegna="Rimuove dalle statistiche gli indicatori senza misurazioni.",
 codice_difettoso='''
def pulisci(statistiche):
    for k in statistiche:
        if statistiche[k] == 0:
            del statistiche[k]
    return statistiche
''',
 codice_corretto='''
def pulisci(statistiche):
    for k in list(statistiche):
        if statistiche[k] == 0:
            del statistiche[k]
    return statistiche
''',
 difetto="Modifica il dizionario mentre lo si sta iterando: Python solleva RuntimeError. Va iterata una copia delle chiavi.",
 test='''
def verifica(ns):
    d = {"a": 1, "b": 0, "c": 2, "d": 0}
    r = ns["pulisci"](d)
    assert r == {"a": 1, "c": 2}, f"risultato inatteso: {r}"
'''),

dict(id="COD-14", categoria="quota_api", livello=4,
 titolo="Limitatore di frequenza",
 consegna="Limita le chiamate a una soglia al minuto. Sotto carico lascia passare più richieste del dovuto.",
 codice_difettoso='''
import time
class Limitatore:
    def __init__(self, massimo, finestra=60):
        self.massimo = massimo
        self.finestra = finestra
        self.conteggio = 0
        self.inizio = time.time()
    def consenti(self):
        if time.time() - self.inizio > self.finestra:
            self.conteggio = 0
            self.inizio = time.time()
        self.conteggio += 1
        return self.conteggio <= self.massimo
''',
 codice_corretto='''
import time
from collections import deque
class Limitatore:
    def __init__(self, massimo, finestra=60):
        self.massimo = massimo
        self.finestra = finestra
        self.eventi = deque()
    def consenti(self):
        ora = time.time()
        while self.eventi and ora - self.eventi[0] > self.finestra:
            self.eventi.popleft()
        if len(self.eventi) >= self.massimo:
            return False
        self.eventi.append(ora)
        return True
''',
 difetto="Finestra fissa invece che scorrevole: a cavallo del reset si possono effettuare fino al doppio delle chiamate consentite nello stesso intervallo di 60 secondi. È il classico errore che fa scattare il ban dell'API.",
 test='''
def verifica(ns):
    L = ns["Limitatore"]
    import time as _t
    lim = L(massimo=3, finestra=0.3)
    # burst a meta finestra: entrambe le implementazioni lo consentono
    _t.sleep(0.25)
    for i in range(3):
        assert lim.consenti() is True, f"la chiamata {i+1} doveva essere consentita"
    # appena oltre la finestra fissa, ma le tre chiamate precedenti sono vecchie
    # di soli 0.07 s: una finestra scorrevole deve ancora negare.
    _t.sleep(0.07)
    assert lim.consenti() is False, "finestra fissa: consente il doppio delle chiamate a cavallo del reset"
'''),

dict(id="COD-15", categoria="ordinamento", livello=2,
 titolo="Primo record per paziente",
 consegna="Restituisce la prima visita di ogni paziente.",
 codice_difettoso='''
def prima_visita(visite):
    primo = {}
    for v in visite:
        if v["paziente"] not in primo:
            primo[v["paziente"]] = v
    return primo
''',
 codice_corretto='''
def prima_visita(visite):
    primo = {}
    for v in visite:
        p = v["paziente"]
        if p not in primo or v["data"] < primo[p]["data"]:
            primo[p] = v
    return primo
''',
 difetto="Assume che l'input sia già ordinato per data: prende il primo incontrato, non il più antico. Se la sorgente cambia ordine — e una query senza ORDER BY non lo garantisce — il risultato cambia silenziosamente.",
 test='''
def verifica(ns):
    visite = [
        {"paziente": "A", "data": "2026-05-01"},
        {"paziente": "A", "data": "2026-01-15"},
        {"paziente": "B", "data": "2026-03-01"},
    ]
    r = ns["prima_visita"](visite)
    assert r["A"]["data"] == "2026-01-15", f"presa la visita sbagliata: {r['A']['data']}"
'''),

dict(id="COD-16", categoria="validazione", livello=3,
 titolo="Normalizzazione di un codice",
 consegna="Normalizza il codice identificativo prima dell'inserimento.",
 codice_difettoso='''
def normalizza(codice):
    return codice.strip().upper()
''',
 codice_corretto='''
def normalizza(codice):
    if codice is None:
        return None
    return str(codice).strip().upper()
''',
 difetto="Nessuna gestione del valore nullo né del tipo: un campo vuoto arrivato come None o un codice numerico interrompono l'ingestione. In un flusso di terreno entrambi i casi sono la norma, non l'eccezione.",
 test='''
def verifica(ns):
    f = ns["normalizza"]
    assert f("  pz-001 ") == "PZ-001"
    assert f(None) is None, "un valore nullo deve restare nullo, non sollevare"
    assert f(123) == "123", "un valore numerico va convertito, non far esplodere"
'''),

dict(id="COD-17", categoria="aggregazione", livello=3,
 titolo="Somma cumulativa per gruppo",
 consegna="Calcola il cumulato per ciascun gruppo. Il totale del secondo gruppo è sbagliato.",
 codice_difettoso='''
def cumulato(righe):
    totale = 0
    out = []
    for r in righe:
        totale += r["valore"]
        out.append({"gruppo": r["gruppo"], "cumulato": totale})
    return out
''',
 codice_corretto='''
def cumulato(righe):
    totali = {}
    out = []
    for r in righe:
        g = r["gruppo"]
        totali[g] = totali.get(g, 0) + r["valore"]
        out.append({"gruppo": g, "cumulato": totali[g]})
    return out
''',
 difetto="L'accumulatore non viene azzerato al cambio di gruppo: il cumulato del secondo gruppo parte dal totale del primo. È l'equivalente procedurale di dimenticare il PARTITION BY.",
 test='''
def verifica(ns):
    righe = [
        {"gruppo": "A", "valore": 10}, {"gruppo": "A", "valore": 5},
        {"gruppo": "B", "valore": 7},
    ]
    r = ns["cumulato"](righe)
    assert r[2]["cumulato"] == 7, f"il gruppo B deve ripartire da zero, ottenuto {r[2]['cumulato']}"
'''),

dict(id="COD-18", categoria="eccezioni", livello=3,
 titolo="Conversione di tipo tollerante",
 consegna="Converte una colonna in numero tollerando i valori sporchi. Nasconde un problema reale.",
 codice_difettoso='''
def a_numero(valori):
    out = []
    for v in valori:
        try:
            out.append(float(v))
        except Exception:
            out.append(0.0)
    return out
''',
 codice_corretto='''
def a_numero(valori):
    out = []
    for v in valori:
        try:
            out.append(float(v))
        except (TypeError, ValueError):
            out.append(None)
    return out
''',
 difetto="I valori non convertibili diventano zero, cioè un dato numerico plausibile: le medie si abbassano e i totali restano corretti in apparenza. Un valore non valido deve diventare mancante, non zero. Inoltre except Exception cattura anche interruzioni che andrebbero propagate.",
 test='''
def verifica(ns):
    r = ns["a_numero"](["10", "abc", None, "3.5"])
    assert r[1] is None and r[2] is None, f"i non convertibili devono essere None, ottenuto {r}"
    assert r[0] == 10.0 and r[3] == 3.5
'''),

dict(id="COD-19", categoria="logica", livello=4,
 titolo="Unione di due sorgenti",
 consegna="Unisce i record di due sorgenti dando precedenza alla più recente. In un caso perde dati.",
 codice_difettoso='''
def unisci(primaria, secondaria):
    risultato = dict(secondaria)
    risultato.update(primaria)
    return risultato
''',
 codice_corretto='''
def unisci(primaria, secondaria):
    risultato = dict(secondaria)
    for k, v in primaria.items():
        if v is not None:
            risultato[k] = v
    return risultato
''',
 difetto="update sovrascrive anche con i valori None della sorgente primaria, cancellando dati validi presenti nella secondaria. Un campo assente e un campo esplicitamente nullo vengono trattati allo stesso modo.",
 test='''
def verifica(ns):
    p = {"regione": None, "codice": "PZ-1"}
    s = {"regione": "Jonglei", "codice": "PZ-0"}
    r = ns["unisci"](p, s)
    assert r["regione"] == "Jonglei", f"None ha cancellato un valore valido: {r}"
    assert r["codice"] == "PZ-1"
'''),

dict(id="COD-20", categoria="idempotenza", livello=4,
 titolo="Carico incrementale",
 consegna="Carica solo i record nuovi dall'ultima esecuzione. Rieseguendola si perdono record.",
 codice_difettoso='''
def da_caricare(record, ultimo_timestamp):
    return [r for r in record if r["ts"] > ultimo_timestamp]

def nuovo_checkpoint(caricati, precedente):
    return max([r["ts"] for r in caricati], default=precedente)
''',
 codice_corretto='''
def da_caricare(record, ultimo_timestamp):
    return [r for r in record if r["ts"] >= ultimo_timestamp]

def nuovo_checkpoint(caricati, precedente):
    return max([r["ts"] for r in caricati], default=precedente)
''',
 difetto="Il filtro con confronto stretto esclude i record che condividono esattamente il timestamp del checkpoint: se più record arrivano nello stesso istante, quelli oltre il primo non vengono mai caricati. Serve confronto non stretto più deduplicazione per chiave a valle — spostare il problema dall'ordinamento all'idempotenza.",
 test='''
def verifica(ns):
    lotto1 = [{"id": 1, "ts": 100}, {"id": 2, "ts": 101}]
    primo = ns["da_caricare"](lotto1, 0)
    cp = ns["nuovo_checkpoint"](primo, 0)
    # il record 3 arriva in ritardo, con lo STESSO timestamp del checkpoint
    lotto2 = [{"id": 2, "ts": 101}, {"id": 3, "ts": 101}, {"id": 4, "ts": 102}]
    secondo = ns["da_caricare"](lotto2, cp)
    ids = {r["id"] for r in secondo}
    assert 3 in ids, f"record con timestamp pari al checkpoint perso per sempre: {ids}"
'''),
]
