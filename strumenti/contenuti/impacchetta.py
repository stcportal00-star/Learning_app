#!/usr/bin/env python3
"""Valida e impacchetta tutto il contenuto pre-caricato per l'app Percorso."""
import json, os, shutil, uuid, hashlib
from flashcard_a import FLASHCARD_A
from flashcard_b import FLASHCARD_B
from flashcard_c import FLASHCARD_C
from scenari_e_fonti import SCENARI, FONTI, ESCLUSIONI

BASE = os.path.dirname(os.path.abspath(__file__))
OUT = "/mnt/user-data/outputs/percorso-contenuti"
os.makedirs(OUT, exist_ok=True)
errori = []

FLASH = FLASHCARD_A + FLASHCARD_B + FLASHCARD_C
visti = set()
for f in FLASH:
    if not f.get("fonte") or not f.get("riferimento"):
        errori.append(f"{f['id']}: fonte o riferimento mancante")
    if len(f.get("risposta", "")) < 40:
        errori.append(f"{f['id']}: risposta troppo breve")
    if f["id"] in visti:
        errori.append(f"{f['id']}: id duplicato")
    visti.add(f["id"])

for s in SCENARI:
    if len(s.get("rubrica", [])) < 4:
        errori.append(f"{s['id']}: rubrica con meno di 4 criteri")

slug = set()
for nome, url, metodo, cat, lingua, peso in FONTI:
    if metodo not in ("rss", "scrape", "api", "email"):
        errori.append(f"{nome}: metodo non valido")
    if not 0 <= peso <= 1:
        errori.append(f"{nome}: peso fuori intervallo")
    if nome in slug:
        errori.append(f"{nome}: fonte duplicata")
    slug.add(nome)

if errori:
    print("VALIDAZIONE FALLITA:")
    for e in errori:
        print("  " + e)
    raise SystemExit(1)

with open(os.path.join(BASE, "out", "esercizi_sql.json"), encoding="utf-8") as fh:
    ESERCIZI = json.load(fh)
with open(os.path.join(BASE, "out", "esercizi_codice.json"), encoding="utf-8") as fh:
    CODICE = json.load(fh)

def scrivi(nome, dati):
    with open(os.path.join(OUT, nome), "w", encoding="utf-8") as fh:
        json.dump(dati, fh, ensure_ascii=False, indent=1)

scrivi("esercizi_sql.json", ESERCIZI)
scrivi("esercizi_codice.json", CODICE)
scrivi("flashcard.json", FLASH)
scrivi("scenari_rubrica.json", SCENARI)
scrivi("fonti.json", [dict(nome=n, url=u, metodo=m, categoria=c, lingua=l, peso=p)
                      for n, u, m, c, l, p in FONTI])
scrivi("esclusioni_rassegna.json", ESCLUSIONI)
shutil.copy(os.path.join(BASE, "palestra.db"), os.path.join(OUT, "palestra.db"))

def esc(s):
    return "NULL" if s is None else "'" + str(s).replace("'", "''") + "'"

def uid(k):
    return str(uuid.UUID(hashlib.md5(k.encode()).hexdigest()))

TEMI = {
    "sql_base": ("SQL — fondamenti", "dati"), "sql_join": ("SQL — join", "dati"),
    "sql_agg": ("SQL — aggregazione", "dati"), "sql_cte": ("SQL — CTE e ricorsione", "dati"),
    "sql_window": ("SQL — window functions", "dati"), "ottimizzazione": ("SQL — piani e indici", "dati"),
    "qualita_dati": ("Qualità dei dati", "dati"), "modellazione": ("Modellazione dimensionale", "dati"),
    "epidemiologia": ("Analisi epidemiologica", "dati"), "meal": ("MEAL e indicatori", "kpi"),
    "gdpr": ("GDPR e protezione dati", "governance"), "ai_act": ("AI Act e governance IA", "governance"),
    "governance": ("ITIL e governance dei servizi", "governance"),
    "sicurezza": ("ISO 27001 e sicurezza", "governance"),
    "kpi": ("KPI e misurazione", "kpi"), "hardware": ("Hardware e reti", "hardware"),
    "business_analysis": ("Business analysis", "business_analysis"),
    "ia": ("AI engineering", "ia"), "statistica": ("Statistica applicata", "dati"),
    "salute_digitale": ("DHIS2, FHIR e sistemi sanitari", "dati"),
    "lettura_codice": ("Lettura e verifica del codice", "ia"),
}

r = ["-- Seed contenuti Percorso — schema percorso",
     "-- Sostituire :utente con l'uuid reale di auth.users prima di eseguire.",
     "\\set utente '00000000-0000-0000-0000-000000000000'", "", "-- temi"]
for s, (nome, pista) in TEMI.items():
    r.append(f"INSERT INTO percorso.temi (id, utente_id, slug, nome, pista) VALUES "
             f"('{uid('tema:'+s)}', :'utente', {esc(s)}, {esc(nome)}, {esc(pista)}) "
             f"ON CONFLICT (utente_id, slug) DO NOTHING;")

r.append("\n-- esercizi SQL, verificati per esecuzione")
for e in ESERCIZI:
    cons = e["consegna"] + ("\n\n[Preparazione]\n" + e["preparazione"] if e.get("preparazione") else "")
    r.append("INSERT INTO percorso.esercizi (id, utente_id, tema_id, tipo, livello, consegna, dataset, "
             "soluzione_riferimento, licenza) VALUES ("
             f"'{uid('es:'+e['id'])}', :'utente', '{uid('tema:'+e['tema'])}', 'sql_eseguibile', {e['livello']}, "
             f"{esc(cons)}, 'palestra.db', {esc(e['soluzione'])}, 'Dati sintetici — uso libero');")

r.append("\n-- esercizi di lettura del codice, bug dimostrato da test")
for e in CODICE:
    r.append("INSERT INTO percorso.esercizi (id, utente_id, tema_id, tipo, livello, consegna, dataset, "
             "soluzione_riferimento, rubrica) VALUES ("
             f"'{uid('cod:'+e['id'])}', :'utente', '{uid('tema:lettura_codice')}', 'sql_eseguibile', {e['livello']}, "
             f"{esc(e['titolo'] + ' — ' + e['consegna'] + chr(10) + chr(10) + e['codice_difettoso'])}, "
             f"'python', {esc(e['difetto'])}, "
             f"{esc(json.dumps({'codice_corretto': e['codice_corretto'], 'test': e['test'], 'categoria': e['categoria']}, ensure_ascii=False))}::jsonb);")

r.append("\n-- flashcard con citazione")
for f in FLASH:
    r.append("INSERT INTO percorso.esercizi (id, utente_id, tema_id, tipo, livello, consegna, "
             "soluzione_riferimento, fonte_citazione) VALUES ("
             f"'{uid('fc:'+f['id'])}', :'utente', '{uid('tema:'+f['tema'])}', 'quiz_citato', 2, "
             f"{esc(f['domanda'])}, {esc(f['risposta'])}, {esc(f['fonte'] + ' — ' + f['riferimento'])});")

r.append("\n-- scenari a rubrica")
for s in SCENARI:
    r.append("INSERT INTO percorso.esercizi (id, utente_id, tema_id, tipo, livello, consegna, rubrica) VALUES ("
             f"'{uid('sc:'+s['id'])}', :'utente', '{uid('tema:'+s['tema'])}', 'rubrica', 4, "
             f"{esc(s['consegna'])}, {esc(json.dumps(s['rubrica'], ensure_ascii=False))}::jsonb);")

r.append("\n-- fonti della rassegna")
for n, u, m, c, l, p in FONTI:
    r.append("INSERT INTO percorso.fonti (id, utente_id, nome, url_feed, metodo, categoria, lingua, peso) VALUES ("
             f"'{uid('fonte:'+n)}', :'utente', {esc(n)}, {esc(u)}, {esc(m)}, {esc(c)}, {esc(l)}, {p});")

with open(os.path.join(OUT, "seed_percorso.sql"), "w", encoding="utf-8") as fh:
    fh.write("\n".join(r) + "\n")

tot = len(ESERCIZI) + len(CODICE) + len(FLASH) + len(SCENARI)
print(f"Esercizi SQL verificati   : {len(ESERCIZI)}")
print(f"Esercizi lettura codice   : {len(CODICE)}")
print(f"Flashcard con citazione   : {len(FLASH)}")
print(f"Scenari a rubrica         : {len(SCENARI)}")
print(f"Fonti                     : {len(FONTI)}")
print(f"Temi                      : {len(TEMI)}")
print(f"\nTOTALE ITEM DI STUDIO     : {tot}")
for f in sorted(os.listdir(OUT)):
    print(f"  {f:<30} {os.path.getsize(os.path.join(OUT, f))/1024:>8.1f} KB")
