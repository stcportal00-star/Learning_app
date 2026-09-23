# -*- coding: utf-8 -*-
"""Banco esercizi SQL — livelli 3 e 4. Ogni soluzione viene eseguita e verificata."""

ESERCIZI_B = [
# ---------------------------------------------------------------- LIVELLO 3
dict(id="SQL-046", tema="sql_cte", livello=3,
 consegna="Con una CTE, calcola il numero di visite per struttura e poi mostra solo le strutture sopra la media generale.",
 soluzione="""WITH per_struttura AS (
  SELECT struttura_id, count(*) AS visite FROM visite GROUP BY struttura_id)
SELECT s.nome, s.paese, ps.visite
FROM per_struttura ps JOIN strutture s ON s.id = ps.struttura_id
WHERE ps.visite > (SELECT avg(visite) FROM per_struttura)
ORDER BY ps.visite DESC;"""),
dict(id="SQL-047", tema="sql_cte", livello=3,
 consegna="Trova i pazienti con almeno una diagnosi cronica E almeno una prescrizione di antibiotico. Mostra codice e regione.",
 soluzione="""WITH cronici AS (
  SELECT DISTINCT v.paziente_id FROM visite v
  JOIN diagnosi d ON d.visita_id = v.id WHERE d.cronica = 1),
antibiotici AS (
  SELECT DISTINCT v.paziente_id FROM visite v
  JOIN prescrizioni pr ON pr.visita_id = v.id WHERE pr.classe = 'antibiotico')
SELECT p.codice, p.regione FROM pazienti p
JOIN cronici c ON c.paziente_id = p.id
JOIN antibiotici a ON a.paziente_id = p.id
ORDER BY p.codice LIMIT 50;"""),
dict(id="SQL-048", tema="sql_cte", livello=3,
 consegna="Usa INTERSECT per trovare le regioni che compaiono sia nella tabella pazienti sia nella tabella siti.",
 soluzione="SELECT DISTINCT regione FROM pazienti INTERSECT SELECT DISTINCT regione FROM siti ORDER BY regione;"),
dict(id="SQL-049", tema="sql_cte", livello=3,
 consegna="Usa EXCEPT per trovare le regioni presenti nei siti umanitari ma senza alcun paziente registrato.",
 soluzione="SELECT DISTINCT regione FROM siti EXCEPT SELECT DISTINCT regione FROM pazienti ORDER BY regione;"),
dict(id="SQL-050", tema="sql_cte", livello=3,
 consegna="Con una subquery correlata, per ogni struttura mostra la data dell'ultima visita registrata.",
 soluzione="""SELECT s.nome, s.paese,
       (SELECT max(v.data) FROM visite v WHERE v.struttura_id = s.id) AS ultima_visita
FROM strutture s WHERE s.attiva = 1 ORDER BY ultima_visita DESC;"""),
dict(id="SQL-051", tema="epidemiologia", livello=3,
 consegna="Identifica i pazienti con visite ripetute entro 7 giorni (possibile riammissione). Usa un self-join e mostra paziente, prima e seconda data.",
 soluzione="""SELECT p.codice, v1.data AS prima, v2.data AS seconda,
       CAST(julianday(v2.data) - julianday(v1.data) AS INTEGER) AS giorni
FROM visite v1
JOIN visite v2 ON v2.paziente_id = v1.paziente_id AND v2.data > v1.data
JOIN pazienti p ON p.id = v1.paziente_id
WHERE julianday(v2.data) - julianday(v1.data) <= 7
ORDER BY giorni, p.codice LIMIT 50;"""),
dict(id="SQL-052", tema="sql_cte", livello=3,
 consegna="Calcola, per paese, la percentuale di visite concluse con abbandono, usando una CTE per i totali.",
 soluzione="""WITH tot AS (
  SELECT s.paese, count(*) AS visite,
         sum(CASE WHEN v.esito = 'abbandono' THEN 1 ELSE 0 END) AS abbandoni
  FROM visite v JOIN strutture s ON s.id = v.struttura_id GROUP BY s.paese)
SELECT paese, visite, abbandoni, round(100.0 * abbandoni / visite, 2) AS pct_abbandono
FROM tot ORDER BY pct_abbandono DESC;"""),
dict(id="SQL-053", tema="meal", livello=3,
 consegna="Per ogni indicatore, calcola lo scostamento medio percentuale del valore rispetto al target, ignorando i NULL.",
 soluzione="""WITH s AS (
  SELECT indicatore_id, valore, target FROM misurazioni
  WHERE valore IS NOT NULL AND target IS NOT NULL AND target <> 0)
SELECT i.codice, i.nome, round(avg(100.0 * (s.valore - s.target) / s.target), 2) AS scostamento_pct
FROM s JOIN indicatori i ON i.id = s.indicatore_id
GROUP BY i.id, i.codice, i.nome ORDER BY scostamento_pct;"""),
dict(id="SQL-054", tema="qualita_dati", livello=3,
 consegna="Costruisci un profilo di completezza della tabella misurazioni: righe totali, valori non nulli, percentuale di completezza per indicatore.",
 soluzione="""SELECT i.codice, count(*) AS righe, count(m.valore) AS non_nulli,
       round(100.0 * count(m.valore) / count(*), 2) AS completezza_pct
FROM misurazioni m JOIN indicatori i ON i.id = m.indicatore_id
GROUP BY i.id, i.codice ORDER BY completezza_pct;"""),
dict(id="SQL-055", tema="qualita_dati", livello=3,
 consegna="Trova le valutazioni marcate come completate ma che non hanno alcuna misurazione associata — incoerenza da correggere.",
 soluzione="""SELECT v.id, v.data, v.strumento, v.responsabile
FROM valutazioni v LEFT JOIN misurazioni m ON m.valutazione_id = v.id
WHERE v.completata = 1 AND m.id IS NULL ORDER BY v.data DESC;"""),
dict(id="SQL-056", tema="sql_cte", livello=3,
 consegna="Elenca le 5 diagnosi più frequenti per ciascun paese, usando una CTE con conteggio.",
 soluzione="""WITH conteggi AS (
  SELECT s.paese, d.codice_icd10, d.descrizione, count(*) AS casi
  FROM diagnosi d JOIN visite v ON v.id = d.visita_id
  JOIN strutture s ON s.id = v.struttura_id
  GROUP BY s.paese, d.codice_icd10, d.descrizione)
SELECT paese, codice_icd10, descrizione, casi FROM (
  SELECT *, row_number() OVER (PARTITION BY paese ORDER BY casi DESC) AS rn FROM conteggi)
WHERE rn <= 5 ORDER BY paese, casi DESC;"""),
dict(id="SQL-057", tema="meal", livello=3,
 consegna="Calcola il costo per beneficiario di ogni distribuzione e mostra le 20 meno efficienti.",
 soluzione="""SELECT d.id, s.nome AS sito, d.articolo,
       round(d.quantita * d.costo_unitario_eur / NULLIF(d.beneficiari, 0), 2) AS costo_per_beneficiario
FROM distribuzioni d JOIN siti s ON s.id = d.sito_id
WHERE d.beneficiari > 0
ORDER BY costo_per_beneficiario DESC LIMIT 20;"""),
dict(id="SQL-058", tema="sql_cte", livello=3,
 consegna="Con EXISTS, elenca i progetti che hanno almeno un sito non accessibile.",
 soluzione="""SELECT pr.nome, pr.paese, pr.stato FROM progetti pr
WHERE EXISTS (SELECT 1 FROM siti s WHERE s.progetto_id = pr.id AND s.accessibile = 0)
ORDER BY pr.nome;"""),
dict(id="SQL-059", tema="sql_cte", livello=3,
 consegna="Con NOT EXISTS, elenca i pazienti registrati che non hanno mai avuto una visita.",
 soluzione="""SELECT p.codice, p.regione, p.data_registrazione FROM pazienti p
WHERE NOT EXISTS (SELECT 1 FROM visite v WHERE v.paziente_id = p.id)
ORDER BY p.data_registrazione DESC LIMIT 50;"""),
dict(id="SQL-060", tema="epidemiologia", livello=3,
 consegna="Calcola il numero di casi di malaria (B54) per mese e per paese nel 2026.",
 soluzione="""SELECT s.paese, strftime('%Y-%m', v.data) AS mese, count(*) AS casi
FROM diagnosi d JOIN visite v ON v.id = d.visita_id
JOIN strutture s ON s.id = v.struttura_id
WHERE d.codice_icd10 = 'B54' AND v.data >= '2026-01-01'
GROUP BY s.paese, mese ORDER BY s.paese, mese;"""),
dict(id="SQL-061", tema="modellazione", livello=3,
 consegna="Costruisci una dimensione data degenerata: per ogni visita del 2026 estrai anno, mese, settimana ISO e trimestre.",
 soluzione="""SELECT v.id AS visita_id, v.data,
       strftime('%Y', v.data) AS anno,
       CAST(strftime('%m', v.data) AS INTEGER) AS mese,
       CAST(strftime('%W', v.data) AS INTEGER) AS settimana,
       (CAST(strftime('%m', v.data) AS INTEGER) + 2) / 3 AS trimestre
FROM visite v WHERE v.data >= '2026-01-01' ORDER BY v.data LIMIT 100;"""),
dict(id="SQL-062", tema="modellazione", livello=3,
 consegna="Costruisci una fact table aggregata a grana 'struttura-mese': visite, pazienti distinti, decessi.",
 soluzione="""SELECT v.struttura_id, strftime('%Y-%m', v.data) AS mese,
       count(*) AS visite, count(DISTINCT v.paziente_id) AS pazienti_distinti,
       sum(CASE WHEN v.esito = 'decesso' THEN 1 ELSE 0 END) AS decessi
FROM visite v GROUP BY v.struttura_id, mese ORDER BY mese DESC, visite DESC LIMIT 100;"""),
dict(id="SQL-063", tema="qualita_dati", livello=3,
 consegna="Rileva potenziali duplicati: pazienti con stessa data di nascita, stesso sesso e stessa regione.",
 soluzione="""SELECT data_nascita, sesso, regione, count(*) AS n, group_concat(codice) AS codici
FROM pazienti GROUP BY data_nascita, sesso, regione HAVING count(*) > 1
ORDER BY n DESC LIMIT 40;"""),
dict(id="SQL-064", tema="meal", livello=3,
 consegna="Per ogni progetto attivo, calcola il budget mensile implicito (budget diviso durata in mesi).",
 soluzione="""SELECT nome, budget_eur,
       CAST((julianday(data_fine) - julianday(data_inizio)) / 30.44 AS INTEGER) AS mesi,
       round(budget_eur / NULLIF((julianday(data_fine) - julianday(data_inizio)) / 30.44, 0), 2) AS budget_mensile
FROM progetti WHERE stato = 'attivo' ORDER BY budget_mensile DESC;"""),

# ---------------------------------------------------------------- LIVELLO 4
dict(id="SQL-065", tema="sql_window", livello=4,
 consegna="Classifica le strutture per numero di visite all'interno di ciascun paese usando RANK().",
 soluzione="""WITH c AS (
  SELECT s.paese, s.nome, count(*) AS visite
  FROM visite v JOIN strutture s ON s.id = v.struttura_id
  GROUP BY s.paese, s.nome)
SELECT paese, nome, visite, RANK() OVER (PARTITION BY paese ORDER BY visite DESC) AS posizione
FROM c ORDER BY paese, posizione;"""),
dict(id="SQL-066", tema="sql_window", livello=4,
 consegna="Calcola il totale cumulativo di visite per mese nel 2026 usando SUM() OVER.",
 soluzione="""WITH m AS (
  SELECT strftime('%Y-%m', data) AS mese, count(*) AS visite
  FROM visite WHERE data >= '2026-01-01' GROUP BY mese)
SELECT mese, visite, sum(visite) OVER (ORDER BY mese ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) AS cumulato
FROM m ORDER BY mese;"""),
dict(id="SQL-067", tema="sql_window", livello=4,
 consegna="Calcola la media mobile a 3 mesi delle visite mensili del 2026.",
 soluzione="""WITH m AS (
  SELECT strftime('%Y-%m', data) AS mese, count(*) AS visite
  FROM visite WHERE data >= '2026-01-01' GROUP BY mese)
SELECT mese, visite,
       round(avg(visite) OVER (ORDER BY mese ROWS BETWEEN 2 PRECEDING AND CURRENT ROW), 1) AS media_mobile_3m
FROM m ORDER BY mese;"""),
dict(id="SQL-068", tema="sql_window", livello=4,
 consegna="Per ogni paziente con più di una visita, calcola l'intervallo in giorni rispetto alla visita precedente usando LAG().",
 soluzione="""SELECT p.codice, v.data,
       LAG(v.data) OVER (PARTITION BY v.paziente_id ORDER BY v.data) AS visita_precedente,
       CAST(julianday(v.data) - julianday(LAG(v.data) OVER (PARTITION BY v.paziente_id ORDER BY v.data)) AS INTEGER) AS giorni
FROM visite v JOIN pazienti p ON p.id = v.paziente_id
ORDER BY p.codice, v.data LIMIT 60;"""),
dict(id="SQL-069", tema="sql_window", livello=4,
 consegna="Per ogni struttura, mostra la prima e l'ultima visita registrata usando FIRST_VALUE e LAST_VALUE.",
 soluzione="""SELECT DISTINCT s.nome,
       FIRST_VALUE(v.data) OVER (PARTITION BY s.id ORDER BY v.data
                                 ROWS BETWEEN UNBOUNDED PRECEDING AND UNBOUNDED FOLLOWING) AS prima,
       LAST_VALUE(v.data) OVER (PARTITION BY s.id ORDER BY v.data
                                ROWS BETWEEN UNBOUNDED PRECEDING AND UNBOUNDED FOLLOWING) AS ultima
FROM visite v JOIN strutture s ON s.id = v.struttura_id ORDER BY s.nome;"""),
dict(id="SQL-070", tema="sql_window", livello=4,
 consegna="Dividi le strutture in quartili per numero di visite usando NTILE(4).",
 soluzione="""WITH c AS (
  SELECT s.nome, count(*) AS visite FROM visite v
  JOIN strutture s ON s.id = v.struttura_id GROUP BY s.id, s.nome)
SELECT nome, visite, NTILE(4) OVER (ORDER BY visite) AS quartile FROM c ORDER BY visite DESC;"""),
dict(id="SQL-071", tema="sql_window", livello=4,
 consegna="Calcola la quota percentuale di ciascuna diagnosi sul totale del proprio paese, usando una window function.",
 soluzione="""WITH c AS (
  SELECT s.paese, d.codice_icd10, count(*) AS casi
  FROM diagnosi d JOIN visite v ON v.id = d.visita_id
  JOIN strutture s ON s.id = v.struttura_id
  GROUP BY s.paese, d.codice_icd10)
SELECT paese, codice_icd10, casi,
       round(100.0 * casi / sum(casi) OVER (PARTITION BY paese), 2) AS quota_pct
FROM c ORDER BY paese, quota_pct DESC;"""),
dict(id="SQL-072", tema="sql_window", livello=4,
 consegna="Per ogni indicatore, individua la misurazione più recente usando ROW_NUMBER() su data della valutazione.",
 soluzione="""WITH r AS (
  SELECT i.codice, m.valore, v.data,
         row_number() OVER (PARTITION BY i.id ORDER BY v.data DESC, m.id DESC) AS rn
  FROM misurazioni m JOIN indicatori i ON i.id = m.indicatore_id
  JOIN valutazioni v ON v.id = m.valutazione_id)
SELECT codice, valore, data FROM r WHERE rn = 1 ORDER BY codice;"""),
dict(id="SQL-073", tema="epidemiologia", livello=4,
 consegna="Costruisci una analisi di coorte: per ogni mese di registrazione del 2026, quanti pazienti hanno avuto almeno una visita nei 30 giorni successivi.",
 soluzione="""WITH coorte AS (
  SELECT p.id, strftime('%Y-%m', p.data_registrazione) AS mese_coorte, p.data_registrazione
  FROM pazienti p WHERE p.data_registrazione >= '2026-01-01'),
attivi AS (
  SELECT c.mese_coorte, c.id,
         max(CASE WHEN julianday(v.data) - julianday(c.data_registrazione) BETWEEN 0 AND 30 THEN 1 ELSE 0 END) AS attivo
  FROM coorte c LEFT JOIN visite v ON v.paziente_id = c.id
  GROUP BY c.mese_coorte, c.id)
SELECT mese_coorte, count(*) AS coorte, sum(attivo) AS attivi_30gg,
       round(100.0 * sum(attivo) / count(*), 2) AS retention_pct
FROM attivi GROUP BY mese_coorte ORDER BY mese_coorte;"""),
dict(id="SQL-074", tema="sql_window", livello=4,
 consegna="Calcola la variazione mese su mese (assoluta e percentuale) delle visite nel 2026.",
 soluzione="""WITH m AS (
  SELECT strftime('%Y-%m', data) AS mese, count(*) AS visite
  FROM visite WHERE data >= '2026-01-01' GROUP BY mese)
SELECT mese, visite,
       visite - LAG(visite) OVER (ORDER BY mese) AS delta,
       round(100.0 * (visite - LAG(visite) OVER (ORDER BY mese)) / LAG(visite) OVER (ORDER BY mese), 2) AS delta_pct
FROM m ORDER BY mese;"""),
dict(id="SQL-075", tema="sql_window", livello=4,
 consegna="Per ogni paziente, numera cronologicamente le sue visite e mostra solo la terza visita di ciascuno.",
 soluzione="""WITH n AS (
  SELECT v.paziente_id, v.data, v.tipo,
         row_number() OVER (PARTITION BY v.paziente_id ORDER BY v.data, v.id) AS num
  FROM visite v)
SELECT p.codice, n.data, n.tipo FROM n JOIN pazienti p ON p.id = n.paziente_id
WHERE n.num = 3 ORDER BY n.data LIMIT 50;"""),
dict(id="SQL-076", tema="sql_window", livello=4,
 consegna="Usa PERCENT_RANK() per posizionare i progetti in base al budget.",
 soluzione="""SELECT nome, donatore, budget_eur,
       round(PERCENT_RANK() OVER (ORDER BY budget_eur), 3) AS percentile
FROM progetti ORDER BY budget_eur DESC;"""),
dict(id="SQL-077", tema="sql_window", livello=4,
 consegna="Calcola la mediana approssimata della durata delle visite per tipo, usando NTILE o row_number.",
 soluzione="""WITH ordinate AS (
  SELECT tipo, durata_min,
         row_number() OVER (PARTITION BY tipo ORDER BY durata_min) AS rn,
         count(*) OVER (PARTITION BY tipo) AS n
  FROM visite WHERE durata_min IS NOT NULL)
SELECT tipo, round(avg(durata_min), 1) AS mediana
FROM ordinate WHERE rn IN ((n + 1) / 2, (n + 2) / 2)
GROUP BY tipo ORDER BY tipo;"""),
dict(id="SQL-078", tema="modellazione", livello=4,
 consegna="Costruisci un pivot: visite per tipo (colonne) e per paese (righe), usando aggregazione condizionale.",
 soluzione="""SELECT s.paese,
       sum(CASE WHEN v.tipo = 'ambulatoriale' THEN 1 ELSE 0 END) AS ambulatoriale,
       sum(CASE WHEN v.tipo = 'ricovero' THEN 1 ELSE 0 END) AS ricovero,
       sum(CASE WHEN v.tipo = 'emergenza' THEN 1 ELSE 0 END) AS emergenza,
       sum(CASE WHEN v.tipo = 'follow-up' THEN 1 ELSE 0 END) AS follow_up,
       sum(CASE WHEN v.tipo = 'nutrizionale' THEN 1 ELSE 0 END) AS nutrizionale
FROM visite v JOIN strutture s ON s.id = v.struttura_id
GROUP BY s.paese ORDER BY s.paese;"""),
dict(id="SQL-079", tema="sql_cte", livello=4,
 consegna="Con una CTE ricorsiva, genera il calendario di tutti i mesi del 2026 e affiancagli il numero di visite (zero dove non ce ne sono).",
 soluzione="""WITH RECURSIVE mesi(m) AS (
  SELECT '2026-01' UNION ALL
  SELECT strftime('%Y-%m', date(m || '-01', '+1 month')) FROM mesi WHERE m < '2026-12')
SELECT mesi.m AS mese, COALESCE(v.visite, 0) AS visite
FROM mesi LEFT JOIN (
  SELECT strftime('%Y-%m', data) AS mese, count(*) AS visite
  FROM visite GROUP BY mese) v ON v.mese = mesi.m
ORDER BY mesi.m;"""),
dict(id="SQL-080", tema="meal", livello=4,
 consegna="Per ogni progetto calcola il burn rate implicito: costo mensile del personale diviso budget mensile, in percentuale.",
 soluzione="""WITH costi AS (
  SELECT progetto_id, sum(costo_mensile_eur) AS costo_personale
  FROM personale GROUP BY progetto_id),
budget AS (
  SELECT id, budget_eur / NULLIF((julianday(data_fine) - julianday(data_inizio)) / 30.44, 0) AS budget_mensile
  FROM progetti)
SELECT pr.nome, round(c.costo_personale, 2) AS costo_personale,
       round(b.budget_mensile, 2) AS budget_mensile,
       round(100.0 * c.costo_personale / NULLIF(b.budget_mensile, 0), 1) AS quota_personale_pct
FROM progetti pr JOIN costi c ON c.progetto_id = pr.id JOIN budget b ON b.id = pr.id
ORDER BY quota_personale_pct DESC;"""),
dict(id="SQL-081", tema="qualita_dati", livello=4,
 consegna="Costruisci un cruscotto di qualità dei dati: per ogni tabella chiave, righe totali e una metrica di anomalia in un'unica risultante (usa UNION ALL).",
 soluzione="""SELECT 'misurazioni' AS tabella, count(*) AS righe,
       sum(CASE WHEN valore IS NULL THEN 1 ELSE 0 END) AS anomalie FROM misurazioni
UNION ALL
SELECT 'visite', count(*), sum(CASE WHEN durata_min IS NULL OR durata_min <= 0 THEN 1 ELSE 0 END) FROM visite
UNION ALL
SELECT 'distribuzioni', count(*), sum(CASE WHEN beneficiari > quantita THEN 1 ELSE 0 END) FROM distribuzioni
UNION ALL
SELECT 'valutazioni', count(*), sum(CASE WHEN completata = 0 THEN 1 ELSE 0 END) FROM valutazioni
ORDER BY anomalie DESC;"""),
dict(id="SQL-082", tema="sql_window", livello=4,
 consegna="Individua le strutture il cui numero di visite è calato per due mesi consecutivi nel 2026.",
 soluzione="""WITH m AS (
  SELECT struttura_id, strftime('%Y-%m', data) AS mese, count(*) AS visite
  FROM visite WHERE data >= '2026-01-01' GROUP BY struttura_id, mese),
d AS (
  SELECT struttura_id, mese, visite,
         LAG(visite, 1) OVER (PARTITION BY struttura_id ORDER BY mese) AS m1,
         LAG(visite, 2) OVER (PARTITION BY struttura_id ORDER BY mese) AS m2
  FROM m)
SELECT s.nome, d.mese, d.m2 AS due_mesi_fa, d.m1 AS mese_scorso, d.visite AS corrente
FROM d JOIN strutture s ON s.id = d.struttura_id
WHERE d.m1 IS NOT NULL AND d.m2 IS NOT NULL AND d.visite < d.m1 AND d.m1 < d.m2
ORDER BY d.mese DESC, s.nome LIMIT 40;"""),
dict(id="SQL-083", tema="epidemiologia", livello=4,
 consegna="Calcola il tasso di letalità (case fatality rate) per diagnosi: decessi sul totale delle visite con quella diagnosi, solo per diagnosi con almeno 200 casi.",
 soluzione="""SELECT d.codice_icd10, d.descrizione, count(*) AS casi,
       sum(CASE WHEN v.esito = 'decesso' THEN 1 ELSE 0 END) AS decessi,
       round(100.0 * sum(CASE WHEN v.esito = 'decesso' THEN 1 ELSE 0 END) / count(*), 2) AS cfr_pct
FROM diagnosi d JOIN visite v ON v.id = d.visita_id
GROUP BY d.codice_icd10, d.descrizione HAVING count(*) >= 200
ORDER BY cfr_pct DESC;"""),
dict(id="SQL-084", tema="modellazione", livello=4,
 consegna="Simula una slowly changing dimension di tipo 2 sul personale: per ogni progetto e ruolo, mostra l'intervallo di validità e se il record è corrente.",
 soluzione="""SELECT pr.nome AS progetto, pe.ruolo, pe.data_inizio,
       COALESCE(pe.data_fine, '9999-12-31') AS data_fine_effettiva,
       CASE WHEN pe.data_fine IS NULL THEN 1 ELSE 0 END AS corrente
FROM personale pe JOIN progetti pr ON pr.id = pe.progetto_id
ORDER BY pr.nome, pe.ruolo, pe.data_inizio LIMIT 60;"""),
dict(id="SQL-085", tema="meal", livello=4,
 consegna="Per ogni settore, calcola la percentuale di indicatori che hanno raggiunto o superato il target nella misurazione più recente.",
 soluzione="""WITH ultime AS (
  SELECT m.indicatore_id, m.valore, m.target,
         row_number() OVER (PARTITION BY m.indicatore_id ORDER BY v.data DESC, m.id DESC) AS rn
  FROM misurazioni m JOIN valutazioni v ON v.id = m.valutazione_id
  WHERE m.valore IS NOT NULL AND m.target IS NOT NULL)
SELECT i.settore, count(*) AS indicatori,
       sum(CASE WHEN u.valore >= u.target THEN 1 ELSE 0 END) AS raggiunti,
       round(100.0 * sum(CASE WHEN u.valore >= u.target THEN 1 ELSE 0 END) / count(*), 1) AS pct_raggiunti
FROM ultime u JOIN indicatori i ON i.id = u.indicatore_id
WHERE u.rn = 1 GROUP BY i.settore ORDER BY pct_raggiunti DESC;"""),
]
