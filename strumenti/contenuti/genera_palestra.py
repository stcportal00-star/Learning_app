#!/usr/bin/env python3
"""
Genera palestra.db — base SQLite di allenamento per il percorso di apprendimento.
Due domini realistici e pertinenti al lavoro MSF:
  - salute/      : strutture, pazienti, visite, diagnosi, prescrizioni, vaccinazioni, esami_lab
  - umanitario/  : progetti, siti, valutazioni, indicatori, misurazioni, distribuzioni, personale

Dati SINTETICI generati con seed fisso (42). Nessun dato reale, nessun vincolo di privacy.
Rieseguire produce un file identico.
"""
import sqlite3, random, os, datetime as dt
from faker import Faker

SEED = 42
random.seed(SEED)
Faker.seed(SEED)
fake = Faker("it_IT")

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "palestra.db")
if os.path.exists(OUT):
    os.remove(OUT)

con = sqlite3.connect(OUT)
con.execute("PRAGMA foreign_keys = ON")
cur = con.cursor()

# ---------------------------------------------------------------- schema
cur.executescript("""
CREATE TABLE strutture (
  id INTEGER PRIMARY KEY, nome TEXT NOT NULL, tipo TEXT NOT NULL,
  paese TEXT NOT NULL, regione TEXT NOT NULL, letti INTEGER,
  data_apertura DATE NOT NULL, attiva INTEGER NOT NULL DEFAULT 1);

CREATE TABLE pazienti (
  id INTEGER PRIMARY KEY, codice TEXT NOT NULL UNIQUE, sesso TEXT NOT NULL,
  data_nascita DATE NOT NULL, regione TEXT NOT NULL, sfollato INTEGER NOT NULL,
  struttura_registrazione_id INTEGER REFERENCES strutture(id),
  data_registrazione DATE NOT NULL);

CREATE TABLE visite (
  id INTEGER PRIMARY KEY, paziente_id INTEGER NOT NULL REFERENCES pazienti(id),
  struttura_id INTEGER NOT NULL REFERENCES strutture(id), data DATE NOT NULL,
  tipo TEXT NOT NULL, esito TEXT NOT NULL, durata_min INTEGER,
  operatore TEXT NOT NULL);

CREATE TABLE diagnosi (
  id INTEGER PRIMARY KEY, visita_id INTEGER NOT NULL REFERENCES visite(id),
  codice_icd10 TEXT NOT NULL, descrizione TEXT NOT NULL,
  cronica INTEGER NOT NULL, gravita TEXT NOT NULL);

CREATE TABLE prescrizioni (
  id INTEGER PRIMARY KEY, visita_id INTEGER NOT NULL REFERENCES visite(id),
  farmaco TEXT NOT NULL, dose_mg REAL, giorni INTEGER NOT NULL,
  classe TEXT NOT NULL);

CREATE TABLE vaccinazioni (
  id INTEGER PRIMARY KEY, paziente_id INTEGER NOT NULL REFERENCES pazienti(id),
  vaccino TEXT NOT NULL, dose_num INTEGER NOT NULL, data DATE NOT NULL,
  struttura_id INTEGER NOT NULL REFERENCES strutture(id));

CREATE TABLE esami_lab (
  id INTEGER PRIMARY KEY, visita_id INTEGER NOT NULL REFERENCES visite(id),
  analita TEXT NOT NULL, valore REAL NOT NULL, unita TEXT NOT NULL,
  fuori_range INTEGER NOT NULL);

CREATE TABLE progetti (
  id INTEGER PRIMARY KEY, nome TEXT NOT NULL, paese TEXT NOT NULL,
  donatore TEXT NOT NULL, settore TEXT NOT NULL, data_inizio DATE NOT NULL,
  data_fine DATE, budget_eur REAL NOT NULL, stato TEXT NOT NULL);

CREATE TABLE siti (
  id INTEGER PRIMARY KEY, progetto_id INTEGER NOT NULL REFERENCES progetti(id),
  nome TEXT NOT NULL, tipo TEXT NOT NULL, regione TEXT NOT NULL,
  lat REAL, lon REAL, popolazione_stimata INTEGER, accessibile INTEGER NOT NULL);

CREATE TABLE valutazioni (
  id INTEGER PRIMARY KEY, sito_id INTEGER NOT NULL REFERENCES siti(id),
  data DATE NOT NULL, strumento TEXT NOT NULL, intervistati INTEGER NOT NULL,
  completata INTEGER NOT NULL, responsabile TEXT NOT NULL);

CREATE TABLE indicatori (
  id INTEGER PRIMARY KEY, codice TEXT NOT NULL UNIQUE, nome TEXT NOT NULL,
  settore TEXT NOT NULL, unita TEXT NOT NULL, direzione TEXT NOT NULL,
  disaggregabile INTEGER NOT NULL);

CREATE TABLE misurazioni (
  id INTEGER PRIMARY KEY, valutazione_id INTEGER NOT NULL REFERENCES valutazioni(id),
  indicatore_id INTEGER NOT NULL REFERENCES indicatori(id), valore REAL,
  baseline REAL, target REAL, qualita TEXT NOT NULL);

CREATE TABLE distribuzioni (
  id INTEGER PRIMARY KEY, sito_id INTEGER NOT NULL REFERENCES siti(id),
  data DATE NOT NULL, articolo TEXT NOT NULL, quantita INTEGER NOT NULL,
  beneficiari INTEGER NOT NULL, costo_unitario_eur REAL NOT NULL);

CREATE TABLE personale (
  id INTEGER PRIMARY KEY, progetto_id INTEGER NOT NULL REFERENCES progetti(id),
  ruolo TEXT NOT NULL, nazionale INTEGER NOT NULL, data_inizio DATE NOT NULL,
  data_fine DATE, costo_mensile_eur REAL NOT NULL);
""")

# ---------------------------------------------------------------- dati
PAESI = [("Sud Sudan","SS"),("Repubblica Democratica del Congo","CD"),
         ("Yemen","YE"),("Bangladesh","BD"),("Haiti","HT"),("Nigeria","NG")]
REGIONI = {"SS":["Jonglei","Unity","Upper Nile","Warrap"],
           "CD":["Nord Kivu","Sud Kivu","Ituri","Tanganyika"],
           "YE":["Ta'izz","Hajjah","Aden","Sa'dah"],
           "BD":["Cox's Bazar","Chittagong","Sylhet"],
           "HT":["Artibonite","Ouest","Nord"],
           "NG":["Borno","Yobe","Adamawa"]}
TIPI_STRUTTURA = ["ospedale","centro salute","posto salute","clinica mobile","centro nutrizionale"]

strutture = []
sid = 0
for paese, cod in PAESI:
    for reg in REGIONI[cod]:
        for _ in range(random.randint(1, 3)):
            sid += 1
            tipo = random.choice(TIPI_STRUTTURA)
            letti = {"ospedale": random.randint(60, 240), "centro salute": random.randint(10, 40),
                     "posto salute": random.randint(0, 8), "clinica mobile": 0,
                     "centro nutrizionale": random.randint(15, 60)}[tipo]
            apertura = fake.date_between(dt.date(2015, 1, 1), dt.date(2024, 6, 30))
            attiva = 0 if random.random() < 0.08 else 1
            strutture.append((sid, f"{tipo.title()} {reg} {sid:03d}", tipo, paese, reg,
                              letti, apertura.isoformat(), attiva))
cur.executemany("INSERT INTO strutture VALUES (?,?,?,?,?,?,?,?)", strutture)

DIAGNOSI_CAT = [
    ("A09","Diarrea e gastroenterite di origine infettiva",0,"moderata"),
    ("B54","Malaria non specificata",0,"grave"),
    ("J18","Polmonite",0,"grave"),
    ("E43","Malnutrizione proteico-energetica grave",0,"grave"),
    ("E44","Malnutrizione proteico-energetica moderata",0,"moderata"),
    ("A15","Tubercolosi respiratoria",1,"grave"),
    ("B20","Malattia da HIV",1,"grave"),
    ("E11","Diabete mellito tipo 2",1,"moderata"),
    ("I10","Ipertensione essenziale",1,"lieve"),
    ("F43","Reazione a grave stress",1,"moderata"),
    ("T14","Trauma di sede non specificata",0,"grave"),
    ("O80","Parto spontaneo",0,"lieve"),
    ("L03","Cellulite",0,"lieve"),
    ("H10","Congiuntivite",0,"lieve"),
]
FARMACI = [("Amoxicillina",500,"antibiotico"),("Artemether-lumefantrina",80,"antimalarico"),
           ("Paracetamolo",500,"analgesico"),("ORS",0,"reidratante"),
           ("Ferro-folato",200,"integratore"),("Isoniazide",300,"antitubercolare"),
           ("Metformina",850,"antidiabetico"),("Ceftriaxone",1000,"antibiotico"),
           ("Zinco",20,"integratore"),("Amlodipina",5,"antipertensivo")]
VACCINI = ["Morbillo","Polio orale","Pentavalente","BCG","Colera orale","Tetano"]
ANALITI = [("Emoglobina","g/dL",8,16),("Glicemia","mg/dL",60,200),
           ("Creatinina","mg/dL",0.4,2.2),("CD4","cell/mm3",100,1200),
           ("Test rapido malaria","idx",0,1)]

pazienti, visite, diagnosi, prescrizioni, vaccinazioni, esami = [], [], [], [], [], []
pid = vid = did = prid = vacid = labid = 0
attive = [s for s in strutture if s[7] == 1]

for _ in range(2400):
    pid += 1
    s = random.choice(attive)
    sesso = random.choices(["F", "M"], weights=[54, 46])[0]
    # piramide demografica realistica in contesto umanitario: forte peso pediatrico
    fascia = random.choices(["0-5", "5-17", "18-49", "50+"], weights=[30, 26, 33, 11])[0]
    limiti = {"0-5": (0, 5), "5-17": (5, 18), "18-49": (18, 50), "50+": (50, 92)}[fascia]
    eta_giorni = random.randint(int(limiti[0] * 365.25), int(limiti[1] * 365.25) - 1)
    nascita = dt.date(2026, 1, 1) - dt.timedelta(days=eta_giorni)
    registrazione = fake.date_between(max(dt.date.fromisoformat(s[6]), dt.date(2023, 1, 1)), dt.date(2026, 6, 30))
    pazienti.append((pid, f"PZ-{pid:06d}", sesso, nascita.isoformat(), s[4],
                     1 if random.random() < 0.38 else 0, s[0], registrazione.isoformat()))

    for _ in range(random.choices([0,1,2,3,4,5,6,8,11], weights=[4,22,24,18,12,8,5,4,3])[0]):
        vid += 1
        sv = s if random.random() < 0.82 else random.choice(attive)
        data_v = fake.date_between(registrazione, dt.date(2026, 8, 31))
        tipo = random.choices(["ambulatoriale","ricovero","emergenza","follow-up","nutrizionale"],
                              weights=[46,12,14,20,8])[0]
        esito = random.choices(["dimesso","riferito","abbandono","decesso","in cura"],
                               weights=[70,12,8,2,8])[0]
        visite.append((vid, pid, sv[0], data_v.isoformat(), tipo, esito,
                       random.randint(5, 90), f"OP-{random.randint(1,60):03d}"))

        for _ in range(random.choices([1,2,3], weights=[62,28,10])[0]):
            did += 1
            d = random.choice(DIAGNOSI_CAT)
            diagnosi.append((did, vid, d[0], d[1], d[2], d[3]))

        if random.random() < 0.78:
            for _ in range(random.choices([1,2,3], weights=[55,32,13])[0]):
                prid += 1
                f = random.choice(FARMACI)
                prescrizioni.append((prid, vid, f[0], float(f[1]), random.choice([3,5,7,10,14,30]), f[2]))

        if random.random() < 0.42:
            labid += 1
            a = random.choice(ANALITI)
            val = round(random.uniform(a[2], a[3]), 2)
            fuori = 1 if (val < a[2] * 1.1 or val > a[3] * 0.9) else 0
            esami.append((labid, vid, a[0], val, a[1], fuori))

    if eta_giorni < 6 * 365 and random.random() < 0.72:
        for n, v in enumerate(random.sample(VACCINI, random.randint(1, 4)), start=1):
            vacid += 1
            vaccinazioni.append((vacid, pid, v, n,
                                 fake.date_between(nascita, dt.date(2026, 8, 31)).isoformat(), s[0]))

cur.executemany("INSERT INTO pazienti VALUES (?,?,?,?,?,?,?,?)", pazienti)
cur.executemany("INSERT INTO visite VALUES (?,?,?,?,?,?,?,?)", visite)
cur.executemany("INSERT INTO diagnosi VALUES (?,?,?,?,?,?)", diagnosi)
cur.executemany("INSERT INTO prescrizioni VALUES (?,?,?,?,?,?)", prescrizioni)
cur.executemany("INSERT INTO vaccinazioni VALUES (?,?,?,?,?,?)", vaccinazioni)
cur.executemany("INSERT INTO esami_lab VALUES (?,?,?,?,?,?)", esami)

# ------------------------------------------------- dominio umanitario
DONATORI = ["ECHO","BHA/USAID","FCDO","SIDA","AICS","Fondi privati","UNHCR","UNICEF"]
SETTORI = ["salute","nutrizione","WASH","protezione","sicurezza alimentare","salute mentale"]
progetti = []
for i in range(1, 23):
    paese, cod = random.choice(PAESI)
    inizio = fake.date_between(dt.date(2023, 1, 1), dt.date(2026, 3, 1))
    durata = random.choice([12, 18, 24, 36])
    fine = inizio + dt.timedelta(days=durata * 30)
    stato = "chiuso" if fine < dt.date(2026, 9, 1) else "attivo"
    progetti.append((i, f"{random.choice(SETTORI).title()} {paese} {inizio.year}", paese,
                     random.choice(DONATORI), random.choice(SETTORI), inizio.isoformat(),
                     fine.isoformat(), round(random.uniform(180_000, 4_500_000), 2), stato))
cur.executemany("INSERT INTO progetti VALUES (?,?,?,?,?,?,?,?,?)", progetti)

siti = []
sid2 = 0
for p in progetti:
    cod = [c for n, c in PAESI if n == p[2]][0]
    for _ in range(random.randint(2, 7)):
        sid2 += 1
        siti.append((sid2, p[0], f"{random.choice(['Campo','Villaggio','Sito','Insediamento'])} {fake.last_name()}",
                     random.choice(["campo profughi","comunità ospitante","insediamento informale","struttura sanitaria"]),
                     random.choice(REGIONI[cod]), round(random.uniform(-4, 14), 4),
                     round(random.uniform(12, 45), 4), random.randint(400, 48000),
                     0 if random.random() < 0.17 else 1))
cur.executemany("INSERT INTO siti VALUES (?,?,?,?,?,?,?,?,?)", siti)

INDICATORI = [
    ("SAL-001","Consultazioni ambulatoriali totali","salute","numero","aumento",1),
    ("SAL-002","Tasso di mortalità grezzo","salute","per 10.000/giorno","diminuzione",1),
    ("SAL-003","Copertura vaccinale morbillo 6-59 mesi","salute","percentuale","aumento",1),
    ("NUT-001","Prevalenza malnutrizione acuta globale","nutrizione","percentuale","diminuzione",1),
    ("NUT-002","Tasso di guarigione programma nutrizionale","nutrizione","percentuale","aumento",1),
    ("NUT-003","Tasso di abbandono programma nutrizionale","nutrizione","percentuale","diminuzione",1),
    ("WAS-001","Litri di acqua potabile per persona al giorno","WASH","litri","aumento",0),
    ("WAS-002","Persone per latrina funzionante","WASH","rapporto","diminuzione",0),
    ("PRO-001","Casi di protezione riferiti e presi in carico","protezione","numero","aumento",1),
    ("PRO-002","Tempo mediano di risposta a un caso","protezione","giorni","diminuzione",0),
    ("SIC-001","Punteggio consumo alimentare accettabile","sicurezza alimentare","percentuale","aumento",1),
    ("SMH-001","Sessioni di supporto psicosociale erogate","salute mentale","numero","aumento",1),
    ("ACC-001","Reclami ricevuti tramite meccanismo di feedback","protezione","numero","aumento",1),
    ("ACC-002","Reclami risolti entro 30 giorni","protezione","percentuale","aumento",0),
]
cur.executemany("INSERT INTO indicatori VALUES (?,?,?,?,?,?,?)",
                [(i + 1,) + v for i, v in enumerate(INDICATORI)])

STRUMENTI = ["RNA","valutazione multisettoriale","monitoraggio protezione","post-distribution monitoring","indagine SMART"]
valutazioni, misurazioni, distribuzioni = [], [], []
vlid = mid = dstid = 0
for s in siti:
    for _ in range(random.randint(1, 5)):
        vlid += 1
        prog = progetti[s[1] - 1]
        data_val = fake.date_between(dt.date.fromisoformat(prog[5]), min(dt.date.fromisoformat(prog[6]), dt.date(2026, 8, 31)))
        completata = 0 if random.random() < 0.12 else 1
        valutazioni.append((vlid, s[0], data_val.isoformat(), random.choice(STRUMENTI),
                            random.randint(18, 420), completata, f"MEAL-{random.randint(1,14):02d}"))
        # anomalia deliberata (~5%): valutazione chiusa senza alcuna misurazione
        if completata == 1 and random.random() < 0.05:
            continue
        for ind in random.sample(range(1, len(INDICATORI) + 1), random.randint(2, 6)):
            mid += 1
            base = round(random.uniform(5, 95), 2)
            valore = None if random.random() < 0.06 else round(base * random.uniform(0.6, 1.5), 2)
            misurazioni.append((mid, vlid, ind, valore, base, round(base * 1.25, 2),
                                random.choices(["alta","media","bassa"], weights=[62,28,10])[0]))
    for _ in range(random.randint(0, 4)):
        dstid += 1
        art = random.choice(["kit igiene","telo plastico","zanzariera","kit cucina","coperta","secchio","sapone"])
        distribuzioni.append((dstid, s[0], fake.date_between(dt.date(2023, 6, 1), dt.date(2026, 8, 31)).isoformat(),
                              art, random.randint(50, 3000), random.randint(40, 2400),
                              round(random.uniform(1.2, 38.0), 2)))

cur.executemany("INSERT INTO valutazioni VALUES (?,?,?,?,?,?,?)", valutazioni)
cur.executemany("INSERT INTO misurazioni VALUES (?,?,?,?,?,?,?)", misurazioni)
cur.executemany("INSERT INTO distribuzioni VALUES (?,?,?,?,?,?,?)", distribuzioni)

RUOLI = ["Project Coordinator","Medical Team Leader","MEAL Manager","Data Analyst",
         "Logistics Manager","Nurse Supervisor","WASH Officer","Field Officer","Epidemiologo"]
personale = []
prsid = 0
for p in progetti:
    for _ in range(random.randint(4, 14)):
        prsid += 1
        naz = 1 if random.random() < 0.72 else 0
        inizio = fake.date_between(dt.date.fromisoformat(p[5]), dt.date.fromisoformat(p[6]))
        fine = None if random.random() < 0.55 else fake.date_between(inizio, dt.date.fromisoformat(p[6])).isoformat()
        personale.append((prsid, p[0], random.choice(RUOLI), naz, inizio.isoformat(), fine,
                          round(random.uniform(600, 2200) if naz else random.uniform(2800, 6500), 2)))
cur.executemany("INSERT INTO personale VALUES (?,?,?,?,?,?,?)", personale)

con.commit()
cur.executescript("""
CREATE INDEX idx_visite_paziente ON visite(paziente_id);
CREATE INDEX idx_visite_data ON visite(data);
CREATE INDEX idx_diagnosi_visita ON diagnosi(visita_id);
CREATE INDEX idx_misurazioni_val ON misurazioni(valutazione_id);
""")
con.commit()

print("Tabella                righe")
for t in ["strutture","pazienti","visite","diagnosi","prescrizioni","vaccinazioni","esami_lab",
          "progetti","siti","valutazioni","indicatori","misurazioni","distribuzioni","personale"]:
    print(f"{t:<22} {con.execute(f'SELECT count(*) FROM {t}').fetchone()[0]:>7}")
print(f"\nFile: {OUT}  ({os.path.getsize(OUT)/1024/1024:.2f} MB)")
con.close()
