# -*- coding: utf-8 -*-
"""Banco esercizi SQL — lotto 2: ottimizzazione, piani di esecuzione, indici,
ricorsione, funzioni di stringa e data, JSON, anti-join, modellazione avanzata.

Gli esercizi con chiave 'preparazione' modificano lo schema: il verificatore
li esegue su una copia temporanea del database."""

ESERCIZI_C = [
# ============================================== OTTIMIZZAZIONE E PIANI (18)
dict(id="SQL-086", tema="ottimizzazione", livello=3,
 consegna="Mostra il piano di esecuzione della ricerca delle visite di un singolo paziente. Che cosa usa il motore?",
 soluzione="EXPLAIN QUERY PLAN SELECT * FROM visite WHERE paziente_id = 42;"),
dict(id="SQL-087", tema="ottimizzazione", livello=3,
 consegna="Confronta il piano di una ricerca su colonna indicizzata (visite.data) con quello su colonna non indicizzata (visite.operatore).",
 soluzione="EXPLAIN QUERY PLAN SELECT * FROM visite WHERE operatore = 'OP-007';"),
dict(id="SQL-088", tema="ottimizzazione", livello=3,
 consegna="Crea un indice su visite(operatore) e verifica che il piano cambi da scansione completa a ricerca su indice.",
 preparazione="CREATE INDEX idx_visite_operatore ON visite(operatore);",
 soluzione="EXPLAIN QUERY PLAN SELECT * FROM visite WHERE operatore = 'OP-007';"),
dict(id="SQL-089", tema="ottimizzazione", livello=4,
 consegna="Crea un indice composito su visite(struttura_id, data) e mostra il piano di una query che filtra su entrambe le colonne.",
 preparazione="CREATE INDEX idx_visite_str_data ON visite(struttura_id, data);",
 soluzione="EXPLAIN QUERY PLAN SELECT count(*) FROM visite WHERE struttura_id = 5 AND data >= '2026-01-01';"),
dict(id="SQL-090", tema="ottimizzazione", livello=4,
 consegna="Dimostra che l'ordine delle colonne in un indice composito conta: crea un indice su (data, struttura_id) e osserva il piano di una query che filtra SOLO su struttura_id.",
 preparazione="CREATE INDEX idx_visite_data_str ON visite(data, struttura_id);",
 soluzione="EXPLAIN QUERY PLAN SELECT count(*) FROM visite WHERE struttura_id = 5;"),
dict(id="SQL-091", tema="ottimizzazione", livello=4,
 consegna="Crea un indice coprente che permetta di rispondere alla query senza leggere la tabella, e verificalo nel piano (cerca 'COVERING INDEX').",
 preparazione="CREATE INDEX idx_cop ON visite(struttura_id, esito, paziente_id);",
 soluzione="EXPLAIN QUERY PLAN SELECT struttura_id, esito, count(DISTINCT paziente_id) FROM visite GROUP BY struttura_id, esito;"),
dict(id="SQL-092", tema="ottimizzazione", livello=4,
 consegna="Mostra come una funzione applicata alla colonna filtrata impedisce l'uso dell'indice: confronta il piano di strftime('%Y', data) = '2026'.",
 soluzione="EXPLAIN QUERY PLAN SELECT count(*) FROM visite WHERE strftime('%Y', data) = '2026';"),
dict(id="SQL-093", tema="ottimizzazione", livello=4,
 consegna="Riscrivi la query precedente in forma sargable (intervallo di date) e mostra che il piano ora usa l'indice su data.",
 soluzione="EXPLAIN QUERY PLAN SELECT count(*) FROM visite WHERE data >= '2026-01-01' AND data < '2027-01-01';"),
dict(id="SQL-094", tema="ottimizzazione", livello=3,
 consegna="Elenca tutti gli indici presenti nel database con la tabella a cui appartengono.",
 soluzione="SELECT name, tbl_name FROM sqlite_master WHERE type = 'index' AND name NOT LIKE 'sqlite_%' ORDER BY tbl_name, name;"),
dict(id="SQL-095", tema="ottimizzazione", livello=3,
 consegna="Usa PRAGMA per ispezionare le colonne della tabella visite con tipo, obbligatorietà e chiave primaria.",
 soluzione="PRAGMA table_info(visite);"),
dict(id="SQL-096", tema="ottimizzazione", livello=3,
 consegna="Usa PRAGMA per elencare le chiavi esterne dichiarate sulla tabella misurazioni.",
 soluzione="PRAGMA foreign_key_list(misurazioni);"),
dict(id="SQL-097", tema="ottimizzazione", livello=3,
 consegna="Usa PRAGMA per elencare gli indici definiti sulla tabella visite.",
 soluzione="PRAGMA index_list(visite);"),
dict(id="SQL-098", tema="ottimizzazione", livello=4,
 consegna="Mostra il piano di un join a tre tabelle e identifica quale tabella viene scansionata per prima.",
 soluzione="""EXPLAIN QUERY PLAN
SELECT s.paese, count(*) FROM diagnosi d
JOIN visite v ON v.id = d.visita_id
JOIN strutture s ON s.id = v.struttura_id
WHERE d.cronica = 1 GROUP BY s.paese;"""),
dict(id="SQL-099", tema="ottimizzazione", livello=4,
 consegna="Confronta il piano di una subquery correlata con quello della stessa logica espressa come join aggregato.",
 soluzione="""EXPLAIN QUERY PLAN
SELECT s.nome, (SELECT count(*) FROM visite v WHERE v.struttura_id = s.id) AS n FROM strutture s;"""),
dict(id="SQL-100", tema="ottimizzazione", livello=4,
 consegna="Mostra il piano della versione con join e GROUP BY della query precedente e confronta il numero di passaggi.",
 soluzione="""EXPLAIN QUERY PLAN
SELECT s.nome, count(v.id) AS n FROM strutture s
LEFT JOIN visite v ON v.struttura_id = s.id GROUP BY s.id, s.nome;"""),
dict(id="SQL-101", tema="ottimizzazione", livello=4,
 consegna="Crea un indice parziale solo sulle visite con esito 'decesso' e mostra il piano di una query filtrata su quell'esito.",
 preparazione="CREATE INDEX idx_decessi ON visite(data) WHERE esito = 'decesso';",
 soluzione="EXPLAIN QUERY PLAN SELECT data FROM visite WHERE esito = 'decesso' ORDER BY data;"),
dict(id="SQL-102", tema="ottimizzazione", livello=4,
 consegna="Crea un indice su espressione che calcoli l'anno della visita e verifica che venga usato.",
 preparazione="CREATE INDEX idx_anno ON visite(strftime('%Y', data));",
 soluzione="EXPLAIN QUERY PLAN SELECT count(*) FROM visite WHERE strftime('%Y', data) = '2026';"),
dict(id="SQL-103", tema="ottimizzazione", livello=4,
 consegna="Misura la selettività di una colonna: per visite.esito calcola valori distinti, righe totali e rapporto. Una selettività bassa rende l'indice poco utile.",
 soluzione="""SELECT count(DISTINCT esito) AS distinti, count(*) AS righe,
       round(1.0 * count(DISTINCT esito) / count(*), 6) AS selettivita FROM visite;"""),

# ============================================== RICORSIONE (6)
dict(id="SQL-104", tema="sql_cte", livello=4,
 consegna="Con una CTE ricorsiva genera la serie dei numeri da 1 a 100.",
 soluzione="WITH RECURSIVE n(x) AS (SELECT 1 UNION ALL SELECT x+1 FROM n WHERE x < 100) SELECT x FROM n;"),
dict(id="SQL-105", tema="sql_cte", livello=4,
 consegna="Genera il calendario giornaliero completo di gennaio 2026 e affianca il numero di visite per giorno, zero incluso.",
 soluzione="""WITH RECURSIVE g(d) AS (
  SELECT '2026-01-01' UNION ALL SELECT date(d, '+1 day') FROM g WHERE d < '2026-01-31')
SELECT g.d AS giorno, COALESCE(v.n, 0) AS visite
FROM g LEFT JOIN (SELECT data, count(*) AS n FROM visite GROUP BY data) v ON v.data = g.d
ORDER BY g.d;"""),
dict(id="SQL-106", tema="sql_cte", livello=4,
 consegna="Trova i giorni del 2026 in cui NON è stata registrata alcuna visita, usando un calendario ricorsivo e un anti-join.",
 soluzione="""WITH RECURSIVE g(d) AS (
  SELECT '2026-01-01' UNION ALL SELECT date(d, '+1 day') FROM g WHERE d < '2026-08-31')
SELECT g.d AS giorno_senza_visite FROM g
WHERE NOT EXISTS (SELECT 1 FROM visite v WHERE v.data = g.d) ORDER BY g.d;"""),
dict(id="SQL-107", tema="sql_cte", livello=4,
 consegna="Con una CTE ricorsiva, espandi ogni prescrizione nei singoli giorni di terapia, limitando a 200 righe.",
 soluzione="""WITH RECURSIVE exp(id, farmaco, giorno, totale) AS (
  SELECT id, farmaco, 1, giorni FROM prescrizioni WHERE giorni <= 7
  UNION ALL
  SELECT id, farmaco, giorno + 1, totale FROM exp WHERE giorno < totale)
SELECT id, farmaco, giorno, totale FROM exp ORDER BY id, giorno LIMIT 200;"""),
dict(id="SQL-108", tema="sql_cte", livello=4,
 consegna="Genera la serie dei mesi tra la data di inizio e di fine di ogni progetto attivo, limitando a 150 righe.",
 soluzione="""WITH RECURSIVE m(progetto_id, mese, fine) AS (
  SELECT id, strftime('%Y-%m', data_inizio), strftime('%Y-%m', data_fine)
  FROM progetti WHERE stato = 'attivo'
  UNION ALL
  SELECT progetto_id, strftime('%Y-%m', date(mese || '-01', '+1 month')), fine
  FROM m WHERE mese < fine)
SELECT progetto_id, mese FROM m ORDER BY progetto_id, mese LIMIT 150;"""),
dict(id="SQL-109", tema="sql_cte", livello=4,
 consegna="Usa una CTE ricorsiva per costruire una scala di soglie (0, 10, 20 ... 100) e classifica gli indicatori per valore medio in quelle fasce.",
 soluzione="""WITH RECURSIVE soglie(s) AS (
  SELECT 0 UNION ALL SELECT s + 10 FROM soglie WHERE s < 90),
medie AS (
  SELECT indicatore_id, avg(valore) AS media FROM misurazioni
  WHERE valore IS NOT NULL GROUP BY indicatore_id)
SELECT soglie.s AS soglia, count(medie.indicatore_id) AS indicatori
FROM soglie LEFT JOIN medie ON medie.media >= soglie.s AND medie.media < soglie.s + 10
GROUP BY soglie.s ORDER BY soglie.s;"""),

# ============================================== WINDOW AVANZATE (10)
dict(id="SQL-110", tema="sql_window", livello=4,
 consegna="Calcola per ogni struttura la somma mobile delle visite sulle ultime 3 righe mensili, con RANGE invece di ROWS, e osserva la differenza.",
 soluzione="""WITH m AS (
  SELECT struttura_id, strftime('%Y-%m', data) AS mese, count(*) AS n
  FROM visite WHERE data >= '2026-01-01' GROUP BY struttura_id, mese)
SELECT struttura_id, mese, n,
       sum(n) OVER (PARTITION BY struttura_id ORDER BY mese ROWS BETWEEN 2 PRECEDING AND CURRENT ROW) AS mobile
FROM m ORDER BY struttura_id, mese LIMIT 60;"""),
dict(id="SQL-111", tema="sql_window", livello=4,
 consegna="Usa una window function con FILTER per contare, nella stessa passata, visite totali e soli decessi per paese.",
 soluzione="""SELECT DISTINCT s.paese,
       count(*) OVER (PARTITION BY s.paese) AS visite,
       count(*) FILTER (WHERE v.esito = 'decesso') OVER (PARTITION BY s.paese) AS decessi
FROM visite v JOIN strutture s ON s.id = v.struttura_id ORDER BY s.paese;"""),
dict(id="SQL-112", tema="sql_window", livello=4,
 consegna="Calcola la differenza tra il valore di ciascuna misurazione e la media del proprio indicatore, usando una window function.",
 soluzione="""SELECT i.codice, m.valore,
       round(avg(m.valore) OVER (PARTITION BY m.indicatore_id), 2) AS media_indicatore,
       round(m.valore - avg(m.valore) OVER (PARTITION BY m.indicatore_id), 2) AS scarto
FROM misurazioni m JOIN indicatori i ON i.id = m.indicatore_id
WHERE m.valore IS NOT NULL ORDER BY abs(m.valore - avg(m.valore) OVER (PARTITION BY m.indicatore_id)) DESC LIMIT 40;"""),
dict(id="SQL-113", tema="sql_window", livello=4,
 consegna="Individua i valori anomali: misurazioni che si discostano di oltre due deviazioni standard dalla media del proprio indicatore. Calcola la deviazione manualmente.",
 soluzione="""WITH s AS (
  SELECT indicatore_id, avg(valore) AS mu,
         sqrt(avg(valore * valore) - avg(valore) * avg(valore)) AS sigma
  FROM misurazioni WHERE valore IS NOT NULL GROUP BY indicatore_id)
SELECT i.codice, m.valore, round(s.mu, 2) AS media, round(s.sigma, 2) AS dev_std
FROM misurazioni m JOIN s ON s.indicatore_id = m.indicatore_id
JOIN indicatori i ON i.id = m.indicatore_id
WHERE m.valore IS NOT NULL AND s.sigma > 0 AND abs(m.valore - s.mu) > 2 * s.sigma
ORDER BY abs(m.valore - s.mu) DESC LIMIT 40;"""),
dict(id="SQL-114", tema="sql_window", livello=4,
 consegna="Usa LEAD per calcolare, per ogni visita di un paziente, quanti giorni mancano alla successiva.",
 soluzione="""SELECT p.codice, v.data,
       LEAD(v.data) OVER (PARTITION BY v.paziente_id ORDER BY v.data) AS prossima,
       CAST(julianday(LEAD(v.data) OVER (PARTITION BY v.paziente_id ORDER BY v.data)) - julianday(v.data) AS INTEGER) AS giorni
FROM visite v JOIN pazienti p ON p.id = v.paziente_id ORDER BY p.codice, v.data LIMIT 60;"""),
dict(id="SQL-115", tema="sql_window", livello=4,
 consegna="Costruisci una classifica densa (DENSE_RANK) dei farmaci per numero di prescrizioni e confrontala con RANK: dove differiscono?",
 soluzione="""WITH c AS (SELECT farmaco, count(*) AS n FROM prescrizioni GROUP BY farmaco)
SELECT farmaco, n, RANK() OVER (ORDER BY n DESC) AS rango,
       DENSE_RANK() OVER (ORDER BY n DESC) AS rango_denso FROM c ORDER BY n DESC;"""),
dict(id="SQL-116", tema="sql_window", livello=4,
 consegna="Calcola il contributo cumulativo percentuale dei farmaci al totale delle prescrizioni: un'analisi di Pareto.",
 soluzione="""WITH c AS (SELECT farmaco, count(*) AS n FROM prescrizioni GROUP BY farmaco)
SELECT farmaco, n,
       round(100.0 * sum(n) OVER (ORDER BY n DESC ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW)
             / sum(n) OVER (), 2) AS cumulato_pct
FROM c ORDER BY n DESC;"""),
dict(id="SQL-117", tema="sql_window", livello=4,
 consegna="Per ogni paese, individua il mese del 2026 con il numero massimo di visite usando una window function.",
 soluzione="""WITH m AS (
  SELECT s.paese, strftime('%Y-%m', v.data) AS mese, count(*) AS n
  FROM visite v JOIN strutture s ON s.id = v.struttura_id
  WHERE v.data >= '2026-01-01' GROUP BY s.paese, mese),
r AS (SELECT *, row_number() OVER (PARTITION BY paese ORDER BY n DESC) AS rn FROM m)
SELECT paese, mese, n FROM r WHERE rn = 1 ORDER BY n DESC;"""),
dict(id="SQL-118", tema="sql_window", livello=4,
 consegna="Calcola la percentuale di completamento cumulativo delle valutazioni nel tempo, per strumento.",
 soluzione="""WITH v AS (
  SELECT strumento, data, count(*) AS n FROM valutazioni GROUP BY strumento, data)
SELECT strumento, data, n,
       sum(n) OVER (PARTITION BY strumento ORDER BY data ROWS UNBOUNDED PRECEDING) AS cumulato,
       round(100.0 * sum(n) OVER (PARTITION BY strumento ORDER BY data ROWS UNBOUNDED PRECEDING)
             / sum(n) OVER (PARTITION BY strumento), 1) AS pct
FROM v ORDER BY strumento, data LIMIT 80;"""),
dict(id="SQL-119", tema="sql_window", livello=4,
 consegna="Identifica sequenze consecutive: per ogni paziente, raggruppa le visite ravvicinate (entro 14 giorni) in episodi di cura usando la tecnica gaps-and-islands.",
 soluzione="""WITH ord AS (
  SELECT paziente_id, data,
         CASE WHEN julianday(data) - julianday(LAG(data) OVER (PARTITION BY paziente_id ORDER BY data)) <= 14
              THEN 0 ELSE 1 END AS nuovo_episodio
  FROM visite),
grp AS (
  SELECT paziente_id, data,
         sum(nuovo_episodio) OVER (PARTITION BY paziente_id ORDER BY data ROWS UNBOUNDED PRECEDING) AS episodio
  FROM ord)
SELECT paziente_id, episodio, count(*) AS visite, min(data) AS inizio, max(data) AS fine
FROM grp GROUP BY paziente_id, episodio HAVING count(*) > 2
ORDER BY visite DESC LIMIT 40;"""),

# ============================================== STRINGHE E DATE (8)
dict(id="SQL-120", tema="sql_base", livello=2,
 consegna="Estrai il prefisso numerico dal codice paziente (formato PZ-000001) e mostralo come intero.",
 soluzione="SELECT codice, CAST(substr(codice, 4) AS INTEGER) AS numero FROM pazienti ORDER BY numero LIMIT 20;"),
dict(id="SQL-121", tema="sql_base", livello=2,
 consegna="Normalizza il nome delle strutture rimuovendo spazi iniziali e finali e convertendo in maiuscolo.",
 soluzione="SELECT DISTINCT upper(trim(tipo)) AS tipo_normalizzato FROM strutture ORDER BY tipo_normalizzato;"),
dict(id="SQL-122", tema="sql_base", livello=2,
 consegna="Conta quante strutture contengono la parola 'Centro' nel nome, senza distinzione di maiuscole.",
 soluzione="SELECT count(*) AS n FROM strutture WHERE lower(nome) LIKE '%centro%';"),
dict(id="SQL-123", tema="sql_base", livello=3,
 consegna="Costruisci un'etichetta leggibile per ogni visita nel formato 'Paese — Tipo — AAAA-MM' usando la concatenazione.",
 soluzione="""SELECT DISTINCT s.paese || ' — ' || v.tipo || ' — ' || strftime('%Y-%m', v.data) AS etichetta
FROM visite v JOIN strutture s ON s.id = v.struttura_id ORDER BY etichetta LIMIT 50;"""),
dict(id="SQL-124", tema="sql_base", livello=3,
 consegna="Calcola la data di fine terapia di ogni prescrizione sommando i giorni alla data della visita.",
 soluzione="""SELECT pr.id, pr.farmaco, v.data AS inizio,
       date(v.data, '+' || pr.giorni || ' days') AS fine
FROM prescrizioni pr JOIN visite v ON v.id = pr.visita_id ORDER BY pr.id LIMIT 40;"""),
dict(id="SQL-125", tema="sql_base", livello=3,
 consegna="Trova le visite avvenute nell'ultimo giorno del mese.",
 soluzione="SELECT data, tipo, esito FROM visite WHERE data = date(data, 'start of month', '+1 month', '-1 day') ORDER BY data DESC LIMIT 40;"),
dict(id="SQL-126", tema="sql_base", livello=3,
 consegna="Calcola quanti giorni di età aveva ciascun paziente al momento della sua prima vaccinazione.",
 soluzione="""SELECT p.codice, va.vaccino, va.data,
       CAST(julianday(va.data) - julianday(p.data_nascita) AS INTEGER) AS giorni_eta
FROM vaccinazioni va JOIN pazienti p ON p.id = va.paziente_id
WHERE va.dose_num = 1 ORDER BY giorni_eta LIMIT 40;"""),
dict(id="SQL-127", tema="sql_base", livello=3,
 consegna="Raggruppa le visite per trimestre solare del 2026 usando l'aritmetica sui mesi.",
 soluzione="""SELECT 'T' || ((CAST(strftime('%m', data) AS INTEGER) + 2) / 3) AS trimestre, count(*) AS visite
FROM visite WHERE data >= '2026-01-01' AND data < '2027-01-01' GROUP BY trimestre ORDER BY trimestre;"""),

# ============================================== JSON (5)
dict(id="SQL-128", tema="sql_base", livello=4,
 consegna="Costruisci per ogni paziente un oggetto JSON con codice, sesso e regione.",
 soluzione="SELECT json_object('codice', codice, 'sesso', sesso, 'regione', regione) AS doc FROM pazienti LIMIT 20;"),
dict(id="SQL-129", tema="sql_base", livello=4,
 consegna="Per ogni visita, raggruppa i codici diagnosi in un array JSON.",
 soluzione="""SELECT v.id, json_group_array(d.codice_icd10) AS diagnosi
FROM visite v JOIN diagnosi d ON d.visita_id = v.id
GROUP BY v.id ORDER BY v.id LIMIT 30;"""),
dict(id="SQL-130", tema="sql_base", livello=4,
 consegna="Costruisci un documento JSON annidato per struttura, con i suoi contatori di visite per esito.",
 soluzione="""SELECT s.nome, json_group_object(v.esito, v.n) AS esiti
FROM strutture s JOIN (
  SELECT struttura_id, esito, count(*) AS n FROM visite GROUP BY struttura_id, esito) v
ON v.struttura_id = s.id GROUP BY s.id, s.nome LIMIT 20;"""),
dict(id="SQL-131", tema="sql_base", livello=4,
 consegna="Estrai un campo da un JSON costruito al volo, per verificare json_extract.",
 soluzione="""SELECT json_extract(json_object('codice', codice, 'regione', regione), '$.regione') AS regione_estratta
FROM pazienti LIMIT 20;"""),
dict(id="SQL-132", tema="sql_base", livello=4,
 consegna="Usa json_each per espandere un array JSON di codici in righe separate.",
 soluzione="""SELECT value AS codice FROM json_each('["A09","B54","J18","E43"]');"""),

# ============================================== ANTI-JOIN E INSIEMI (6)
dict(id="SQL-133", tema="sql_join", livello=3,
 consegna="Trova i pazienti che hanno ricevuto una prescrizione ma non hanno mai avuto un esame di laboratorio.",
 soluzione="""SELECT DISTINCT p.codice FROM pazienti p
JOIN visite v ON v.paziente_id = p.id
JOIN prescrizioni pr ON pr.visita_id = v.id
WHERE NOT EXISTS (
  SELECT 1 FROM visite v2 JOIN esami_lab e ON e.visita_id = v2.id WHERE v2.paziente_id = p.id)
ORDER BY p.codice LIMIT 50;"""),
dict(id="SQL-134", tema="sql_join", livello=3,
 consegna="Elenca i siti che non hanno mai ricevuto alcuna distribuzione, con progetto e popolazione stimata.",
 soluzione="""SELECT si.nome, pr.nome AS progetto, si.popolazione_stimata
FROM siti si JOIN progetti pr ON pr.id = si.progetto_id
WHERE NOT EXISTS (SELECT 1 FROM distribuzioni d WHERE d.sito_id = si.id)
ORDER BY si.popolazione_stimata DESC;"""),
dict(id="SQL-135", tema="sql_join", livello=4,
 consegna="Usa un FULL OUTER JOIN per confrontare i paesi presenti nelle strutture con quelli presenti nei progetti.",
 soluzione="""SELECT COALESCE(a.paese, b.paese) AS paese,
       CASE WHEN a.paese IS NULL THEN 'solo progetti'
            WHEN b.paese IS NULL THEN 'solo strutture' ELSE 'entrambi' END AS presenza
FROM (SELECT DISTINCT paese FROM strutture) a
FULL OUTER JOIN (SELECT DISTINCT paese FROM progetti) b ON a.paese = b.paese
ORDER BY paese;"""),
dict(id="SQL-136", tema="sql_join", livello=3,
 consegna="Per ogni settore presente negli indicatori, conta quanti progetti lo coprono: i settori con zero progetti sono lacune di copertura.",
 soluzione="""SELECT i.settore, count(DISTINCT pr.id) AS progetti,
       CASE WHEN count(pr.id) = 0 THEN 'lacuna' ELSE 'coperto' END AS stato
FROM indicatori i LEFT JOIN progetti pr ON pr.settore = i.settore
GROUP BY i.settore ORDER BY progetti, i.settore;"""),
dict(id="SQL-137", tema="sql_join", livello=4,
 consegna="Costruisci una matrice di copertura: per ogni coppia paese-settore indica se esiste almeno un progetto, usando un prodotto cartesiano controllato.",
 soluzione="""WITH paesi AS (SELECT DISTINCT paese FROM progetti),
settori AS (SELECT DISTINCT settore FROM progetti)
SELECT p.paese, s.settore,
       CASE WHEN EXISTS (SELECT 1 FROM progetti pr WHERE pr.paese = p.paese AND pr.settore = s.settore)
            THEN 1 ELSE 0 END AS coperto
FROM paesi p CROSS JOIN settori s ORDER BY p.paese, s.settore;"""),
dict(id="SQL-138", tema="sql_join", livello=4,
 consegna="Trova le coppie di strutture nello stesso paese con lo stesso tipo, evitando di elencare due volte la stessa coppia.",
 soluzione="""SELECT a.nome AS struttura_a, b.nome AS struttura_b, a.paese, a.tipo
FROM strutture a JOIN strutture b
  ON a.paese = b.paese AND a.tipo = b.tipo AND a.id < b.id
ORDER BY a.paese, a.tipo LIMIT 50;"""),

# ============================================== QUALITÀ DATI AVANZATA (6)
dict(id="SQL-139", tema="qualita_dati", livello=4,
 consegna="Verifica la coerenza temporale: esistono vaccinazioni con data anteriore alla nascita del paziente?",
 soluzione="""SELECT count(*) AS incoerenze FROM vaccinazioni va
JOIN pazienti p ON p.id = va.paziente_id WHERE va.data < p.data_nascita;"""),
dict(id="SQL-140", tema="qualita_dati", livello=4,
 consegna="Verifica se esistono visite registrate prima della data di registrazione del paziente.",
 soluzione="""SELECT count(*) AS visite_precedenti_registrazione FROM visite v
JOIN pazienti p ON p.id = v.paziente_id WHERE v.data < p.data_registrazione;"""),
dict(id="SQL-141", tema="qualita_dati", livello=4,
 consegna="Costruisci un profilo di cardinalità per la tabella visite: per ogni colonna categoriale, numero di valori distinti.",
 soluzione="""SELECT 'tipo' AS colonna, count(DISTINCT tipo) AS distinti FROM visite
UNION ALL SELECT 'esito', count(DISTINCT esito) FROM visite
UNION ALL SELECT 'operatore', count(DISTINCT operatore) FROM visite
UNION ALL SELECT 'struttura_id', count(DISTINCT struttura_id) FROM visite
ORDER BY distinti DESC;"""),
dict(id="SQL-142", tema="qualita_dati", livello=4,
 consegna="Calcola la freschezza dei dati: per ogni tabella con una data, giorni trascorsi dall'ultimo record rispetto al 2026-09-01.",
 soluzione="""SELECT 'visite' AS tabella, max(data) AS ultimo,
       CAST(julianday('2026-09-01') - julianday(max(data)) AS INTEGER) AS giorni FROM visite
UNION ALL SELECT 'valutazioni', max(data), CAST(julianday('2026-09-01') - julianday(max(data)) AS INTEGER) FROM valutazioni
UNION ALL SELECT 'distribuzioni', max(data), CAST(julianday('2026-09-01') - julianday(max(data)) AS INTEGER) FROM distribuzioni
UNION ALL SELECT 'vaccinazioni', max(data), CAST(julianday('2026-09-01') - julianday(max(data)) AS INTEGER) FROM vaccinazioni
ORDER BY giorni DESC;"""),
dict(id="SQL-143", tema="qualita_dati", livello=4,
 consegna="Rileva valori sospetti: misurazioni con valore negativo o superiore a 1000 su indicatori espressi in percentuale.",
 soluzione="""SELECT i.codice, i.unita, m.valore FROM misurazioni m
JOIN indicatori i ON i.id = m.indicatore_id
WHERE i.unita = 'percentuale' AND m.valore IS NOT NULL AND (m.valore < 0 OR m.valore > 100)
ORDER BY m.valore DESC LIMIT 40;"""),
dict(id="SQL-144", tema="qualita_dati", livello=4,
 consegna="Costruisci un punteggio di qualità per valutazione: percentuale di misurazioni di qualità alta sul totale.",
 soluzione="""SELECT v.id, v.strumento, v.data, count(*) AS misurazioni,
       round(100.0 * sum(CASE WHEN m.qualita = 'alta' THEN 1 ELSE 0 END) / count(*), 1) AS punteggio_qualita
FROM valutazioni v JOIN misurazioni m ON m.valutazione_id = v.id
GROUP BY v.id, v.strumento, v.data ORDER BY punteggio_qualita LIMIT 40;"""),

# ============================================== MODELLAZIONE AVANZATA (6)
dict(id="SQL-145", tema="modellazione", livello=4,
 consegna="Costruisci uno snapshot periodico mensile: per ogni struttura e mese, pazienti attivi e visite, anche dove il valore è zero.",
 soluzione="""WITH RECURSIVE mesi(m) AS (
  SELECT '2026-01' UNION ALL SELECT strftime('%Y-%m', date(m || '-01', '+1 month')) FROM mesi WHERE m < '2026-08'),
att AS (SELECT id FROM strutture WHERE attiva = 1)
SELECT att.id AS struttura_id, mesi.m AS mese,
       COALESCE(v.visite, 0) AS visite, COALESCE(v.pazienti, 0) AS pazienti
FROM att CROSS JOIN mesi
LEFT JOIN (
  SELECT struttura_id, strftime('%Y-%m', data) AS mese, count(*) AS visite,
         count(DISTINCT paziente_id) AS pazienti
  FROM visite GROUP BY struttura_id, mese) v
ON v.struttura_id = att.id AND v.mese = mesi.m
ORDER BY att.id, mesi.m LIMIT 120;"""),
dict(id="SQL-146", tema="modellazione", livello=4,
 consegna="Costruisci uno snapshot cumulativo del percorso paziente: prima visita, prima diagnosi cronica, ultima visita, con i rispettivi intervalli.",
 soluzione="""SELECT p.codice, min(v.data) AS prima_visita,
       min(CASE WHEN d.cronica = 1 THEN v.data END) AS prima_cronica,
       max(v.data) AS ultima_visita,
       CAST(julianday(max(v.data)) - julianday(min(v.data)) AS INTEGER) AS giorni_in_cura
FROM pazienti p JOIN visite v ON v.paziente_id = p.id
LEFT JOIN diagnosi d ON d.visita_id = v.id
GROUP BY p.id, p.codice HAVING count(v.id) > 3 ORDER BY giorni_in_cura DESC LIMIT 40;"""),
dict(id="SQL-147", tema="modellazione", livello=4,
 consegna="Simula una bridge table: per ogni visita con più diagnosi, assegna un peso uguale a 1/numero di diagnosi per evitare il doppio conteggio.",
 soluzione="""WITH n AS (SELECT visita_id, count(*) AS k FROM diagnosi GROUP BY visita_id)
SELECT d.visita_id, d.codice_icd10, n.k AS diagnosi_nella_visita,
       round(1.0 / n.k, 3) AS peso
FROM diagnosi d JOIN n ON n.visita_id = d.visita_id
WHERE n.k > 1 ORDER BY d.visita_id LIMIT 50;"""),
dict(id="SQL-148", tema="modellazione", livello=4,
 consegna="Applica la ponderazione della bridge table: conta i casi per codice ICD-10 in modo che ogni visita contribuisca per 1 in totale.",
 soluzione="""WITH n AS (SELECT visita_id, count(*) AS k FROM diagnosi GROUP BY visita_id)
SELECT d.codice_icd10, count(*) AS conteggio_grezzo,
       round(sum(1.0 / n.k), 2) AS conteggio_ponderato
FROM diagnosi d JOIN n ON n.visita_id = d.visita_id
GROUP BY d.codice_icd10 ORDER BY conteggio_ponderato DESC;"""),
dict(id="SQL-149", tema="modellazione", livello=4,
 consegna="Costruisci una junk dimension: tutte le combinazioni effettivamente osservate di tipo, esito e presenza di prescrizione.",
 soluzione="""SELECT v.tipo, v.esito,
       CASE WHEN EXISTS (SELECT 1 FROM prescrizioni pr WHERE pr.visita_id = v.id) THEN 1 ELSE 0 END AS con_prescrizione,
       count(*) AS occorrenze
FROM visite v GROUP BY v.tipo, v.esito, con_prescrizione ORDER BY occorrenze DESC;"""),
dict(id="SQL-150", tema="modellazione", livello=4,
 consegna="Crea una vista materializzata come tabella e verifica che contenga i dati aggregati per struttura e mese.",
 preparazione="""CREATE TABLE agg_struttura_mese AS
SELECT struttura_id, strftime('%Y-%m', data) AS mese, count(*) AS visite,
       count(DISTINCT paziente_id) AS pazienti,
       sum(CASE WHEN esito = 'decesso' THEN 1 ELSE 0 END) AS decessi
FROM visite GROUP BY struttura_id, mese;""",
 soluzione="SELECT * FROM agg_struttura_mese ORDER BY visite DESC LIMIT 30;"),
]
