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

# ------------------------------------- 5bis. il cancello dell'orario

# È la verifica che protegge il requisito vero: «alle otto, ora mia». Un
# cancello sbagliato non fa rumore — la rassegna semplicemente non esce, e ce
# ne si accorge dopo giorni, in viaggio, quando è tardi. Qui si provano
# millecinquecento giorni in un decimo di secondo.
import cancello  # noqa: E402
from datetime import date as _data, timedelta as _delta  # noqa: E402

primo, ultimo = _data(2026, 9, 22), _data(2027, 12, 31)
zero, doppi, ore_sbagliate, fusi_sbagliati = [], [], [], []
giorno = primo
while giorno <= ultimo:
    aperte = cancello.quante_corse(giorno)
    if len(aperte) == 0:
        zero.append(giorno)
    elif len(aperte) > 1:
        doppi.append((giorno, [c for c, _, _ in aperte]))
    else:
        _cron, fuso, locale = aperte[0]
        if locale.hour != 8:
            ore_sbagliate.append((giorno, locale))
        atteso = cancello.MESSICO if giorno < cancello.CAMBIO else cancello.ROMA
        # Il confronto è sul giorno UTC del RIFERIMENTO, non su quello del
        # ciclo: il cron delle 14:00 UTC cade nello stesso giorno, ma il
        # cambio si valuta lì ed è lì che va controllato.
        if fuso != atteso and not (giorno == cancello.CAMBIO - _delta(days=0)):
            fusi_sbagliati.append((giorno, fuso, atteso))
    giorno += _delta(days=1)

prova_vero(
    "ogni giorno ha ESATTAMENTE una corsa: mai zero",
    not zero,
    "giornate perse: %s%s" % (zero[:5], "…" if len(zero) > 5 else ""))
prova_vero(
    "e mai due",
    not doppi,
    "giornate doppie: %s%s" % (doppi[:5], "…" if len(doppi) > 5 else ""))
prova_vero(
    "e sempre alle otto locali",
    not ore_sbagliate,
    "ore sbagliate: %s" % ore_sbagliate[:5])
prova_vero(
    "col fuso giusto per la data",
    not fusi_sbagliati,
    "fusi sbagliati: %s" % fusi_sbagliati[:5])

# I quattro giorni che contano, nominati uno per uno: sono quelli in cui una
# svista si vedrebbe solo il giorno dopo, e non si può recuperare.
def corsa_del(giorno):
    aperte = cancello.quante_corse(giorno)
    return (aperte[0][0], aperte[0][1], aperte[0][2].strftime("%H:%M")) if len(aperte) == 1 else aperte

prova("1 ottobre: ancora Città del Messico, cron delle 14 UTC",
      corsa_del(_data(2026, 10, 1)), ("0 14 * * *", cancello.MESSICO, "08:00"))
prova("2 ottobre: primo giorno di Roma, cron delle 6 UTC (ora legale)",
      corsa_del(_data(2026, 10, 2)), ("0 6 * * *", cancello.ROMA, "08:00"))
prova("25 ottobre: Roma è già tornata all'ora solare, cron delle 7 UTC",
      corsa_del(_data(2026, 10, 25)), ("0 7 * * *", cancello.ROMA, "08:00"))
prova("26 ottobre: e ci resta",
      corsa_del(_data(2026, 10, 26)), ("0 7 * * *", cancello.ROMA, "08:00"))

# Il cron nominale, non quello reale: è la differenza fra una corsa fatta e una
# giornata persa quando GitHub parte in ritardo.
from datetime import datetime as _dt, timezone as _tz  # noqa: E402
tardi = _dt(2026, 9, 25, 14, 47, tzinfo=_tz.utc)   # 47 minuti di ritardo
prova_vero(
    "un ritardo di GitHub non chiude il cancello",
    cancello.decidi(tardi, "0 14 * * *")[0],
    "con l'ora reale sarebbero le 08:47 e nessuno dei tre cancelli si aprirebbe")
prova_vero(
    "ma un cron che non c'entra resta chiuso anche in ritardo",
    not cancello.decidi(tardi, "0 6 * * *")[0])
prova_vero(
    "senza cron si ricade sull'ora reale, senza sollevare",
    cancello.decidi(_dt(2026, 9, 25, 9, 0, tzinfo=_tz.utc), "")[0] is False)
prova_vero(
    "un cron illeggibile non fa cadere il cancello",
    cancello.decidi(tardi, "questo non e' un cron")[0] in (True, False))

prova_vero(
    "le tre ore provate qui sono quelle accese nel workflow",
    all(("- cron: \"%s\"" % c) in open(
        os.path.join(RADICE, ".github", "workflows", "nuvola.yml"), encoding="utf-8").read()
        for c in cancello.CRON),
    "cancello.CRON e nuvola.yml si sono disallineati: la verifica proverebbe "
    "ore che non esistono e lascerebbe scoperte quelle vere")

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
