#!/usr/bin/env python3
"""
Verifica della conduttura SENZA RETE.

Gira come primo passo del workflow, prima di qualunque chiamata a Supabase:
una conduttura rotta non deve poter scrivere sul database. Trenta secondi qui
valgono una corsa quotidiana che non sporca l'archivio.

La verifica che conta più di tutte è la terza: il payload degli eventi viene
confrontato con lo SCHEMA VERO delle tabelle dell'app, letto da lib/db.ts. È
l'unico modo per accorgersi che una colonna obbligatoria è stata aggiunta al
telefono e la conduttura non la manda: senza, gli eventi arriverebbero,
la proiezione li salterebbe in silenzio, e sullo schermo non comparirebbe
niente senza un solo errore da nessuna parte.
"""
import os
import re
import subprocess
import sys

QUI = os.path.dirname(os.path.abspath(__file__))
RADICE = os.path.abspath(os.path.join(QUI, "..", ".."))
sys.path.insert(0, QUI)

import pubblica  # noqa: E402

passate = 0
guasti = []


def prova(nome, ottenuto, atteso):
    global passate
    if ottenuto == atteso:
        passate += 1
    else:
        guasti.append("%s\n    atteso : %r\n    ottenuto: %r" % (nome, atteso, ottenuto))


def prova_vero(nome, condizione, spiegazione=""):
    global passate
    if condizione:
        passate += 1
    else:
        guasti.append("%s%s" % (nome, ("\n    " + spiegazione) if spiegazione else ""))


# ------------------------------------------------- 1. chiavi deterministiche

a = pubblica.codice_stabile("RAS", "openalex:W123")
b = pubblica.codice_stabile("RAS", "openalex:W123")
prova("codice_stabile è deterministico", a, b)
prova_vero(
    "codice_stabile cambia con il seme",
    a != pubblica.codice_stabile("RAS", "openalex:W124"),
)
prova_vero(
    "codice_stabile è sicuro come nome di file",
    re.fullmatch(r"RAS-[0-9a-f]{16}", a) is not None,
    "un codice con / o spazi romperebbe il percorso nel deposito: %r" % a,
)

# ------------------------------------------------------------- 2. orologio

o = pubblica.Orologio("rassegna", ms=1_700_000_000_000)
primo, secondo, terzo = o.adesso(), o.adesso(), o.adesso()
prova_vero(
    "l'HLC ha la forma di lib/hlc.ts",
    re.fullmatch(r"[0-9a-f]{12}-[0-9a-f]{4}-rassegna", primo) is not None,
    primo,
)
prova_vero("gli HLC crescono in ordine lessicografico", primo < secondo < terzo)
prova_vero(
    "il dispositivo non contiene trattini",
    "-" not in pubblica.DISPOSITIVO,
    "deserializza() in lib/hlc.ts divide sui trattini: un identificativo con un "
    "trattino dentro tornerebbe indietro sbagliato",
)
e = pubblica.evento(o, "articoli", "chiave:1", "crea", {"titolo": "x"})
prova("l'id dell'evento è hlc:entita_id", e["id"], e["hlc"] + ":chiave:1")
prova("il payload resta un oggetto", isinstance(e["payload"], dict), True)

# ------------------------------- 3. il payload copre le colonne obbligatorie


def colonne_obbligatorie(tabella):
    """
    Legge lo schema vero dell'app da lib/db.ts. Cerca il CREATE TABLE della
    tabella e tiene le colonne NOT NULL senza DEFAULT che non sono la chiave
    primaria: sono esattamente quelle che la proiezione non può inventare.
    """
    sorgente = open(os.path.join(RADICE, "lib", "db.ts"), encoding="utf-8").read()
    m = re.search(
        r"CREATE TABLE IF NOT EXISTS %s\s*\((.*?)\);" % re.escape(tabella),
        sorgente,
        re.S,
    )
    if not m:
        return None
    corpo = m.group(1)
    # Si separano le colonne sulle virgole di primo livello: dentro un CHECK
    # (tipo IN ('a','b')) ci sono virgole che non separano niente.
    pezzi, livello, corrente = [], 0, []
    for c in corpo:
        if c == "(":
            livello += 1
        elif c == ")":
            livello -= 1
        if c == "," and livello == 0:
            pezzi.append("".join(corrente))
            corrente = []
        else:
            corrente.append(c)
    pezzi.append("".join(corrente))

    obbligatorie = []
    for pezzo in pezzi:
        p = pezzo.strip()
        if not p or p.upper().startswith(("PRIMARY KEY", "UNIQUE", "CHECK", "FOREIGN KEY")):
            continue
        nome = p.split()[0]
        alto = p.upper()
        if "NOT NULL" in alto and "DEFAULT" not in alto and "PRIMARY KEY" not in alto:
            obbligatorie.append(nome)
    return obbligatorie


for tabella, costruisci in (
    ("articoli", lambda: pubblica.payload_articolo(
        pubblica.riga_articolo(
            {"chiave": "k", "titolo": "T", "autori": ["A"], "url": "https://e.invalid/x"},
            "testo",
            {"adesso": "2026-09-22T00:00:00+00:00"},
        )
    )),
    ("biblioteca", lambda: pubblica.payload_volume({
        "codice": "RAS-0", "titolo": "T", "pdf_path": "rassegna/RAS-0.pdf",
        "aggiunto_a": "2026-09-22T00:00:00+00:00",
    })),
):
    richieste = colonne_obbligatorie(tabella)
    if richieste is None:
        guasti.append("lo schema di `%s` non si trova in lib/db.ts" % tabella)
        continue
    payload = costruisci()
    mancanti = [c for c in richieste if payload.get(c) in (None, "")]
    prova_vero(
        "il payload di `%s` copre le colonne obbligatorie" % tabella,
        not mancanti,
        "mancano %r; senza, la proiezione sul telefono salta la riga in silenzio "
        "e la rassegna non compare" % (mancanti,),
    )

prova_vero(
    "il payload di `biblioteca` non porta file_locale",
    "file_locale" not in pubblica.payload_volume({
        "codice": "c", "titolo": "t", "pdf_path": "p", "aggiunto_a": "a"}),
    "è un percorso di UN telefono: sull'altro dispositivo farebbe credere di "
    "avere un file che non c'è",
)

# ------------------------------------------------------------------ 4. date

prova("data solo giorno", pubblica.data_iso("2026-09-21"), "2026-09-21T00:00:00+00:00")
prova("data vuota", pubblica.data_iso(""), None)
prova("data illeggibile", pubblica.data_iso("primavera"), None)
prova(
    "data con ora e Z",
    pubblica.data_iso("2026-09-21T10:00:00Z"),
    "2026-09-21T10:00:00+00:00",
)

# ------------------------------------------- 5. riga articolo senza sorprese

r = pubblica.riga_articolo(
    {"chiave": "k2", "titolo": None, "autori": None, "rilevanza": 3.7},
    None,
    {"adesso": "2026-09-22T00:00:00+00:00"},
)
prova("titolo assente non diventa None", r["titolo"], "(senza titolo)")
prova_vero("url assente non resta vuoto", bool(r["url"]), r["url"])
prova("autori assenti diventano elenco vuoto", r["autori"], [])
prova("la rilevanza entra in uno smallint", r["punteggio"], 370)
r2 = pubblica.riga_articolo(
    {"chiave": "k3", "titolo": "t", "rilevanza": 10_000},
    None,
    {"adesso": "x"},
)
prova_vero("una rilevanza assurda resta dentro lo smallint", r2["punteggio"] <= 32000)

# ------------------------------- 6. le autoverifiche degli altri due moduli

# `prova_conduttura.py` sta in fondo perché è la più lenta delle tre e perché
# non ha senso farla partire se le funzioni pure sono già rosse: alza un server
# locale e ci fa passare l'intera pubblica.py.
for modulo in ("cliente.py", "estrattore.py", "prova_conduttura.py"):
    percorso = os.path.join(QUI, modulo)
    if not os.path.exists(percorso):
        guasti.append("manca %s" % modulo)
        continue
    esito = subprocess.run(
        [sys.executable, percorso], capture_output=True, text=True, timeout=120
    )
    prova_vero(
        "autoverifica di %s" % modulo,
        esito.returncode == 0,
        (esito.stdout + esito.stderr)[-1200:],
    )

# ------------------------------------------------------------------- esito

if guasti:
    print("VERIFICA DELLA CONDUTTURA: ROSSA\n")
    for g in guasti:
        print("  ✗ " + g)
    print("\n%d verifiche passate, %d fallite" % (passate, len(guasti)))
    sys.exit(1)
print("%d verifiche passate" % passate)
