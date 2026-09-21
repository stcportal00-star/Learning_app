# -*- coding: utf-8 -*-
"""Banco esercizi SQL — livelli 1 e 2. Ogni soluzione viene eseguita e verificata."""

ESERCIZI_A = [
# ---------------------------------------------------------------- LIVELLO 1
dict(id="SQL-001", tema="sql_base", livello=1,
 consegna="Elenca nome, tipo e regione di tutte le strutture del Sud Sudan, ordinate per nome.",
 soluzione="SELECT nome, tipo, regione FROM strutture WHERE paese = 'Sud Sudan' ORDER BY nome;"),
dict(id="SQL-002", tema="sql_base", livello=1,
 consegna="Quante strutture sono attualmente attive? Restituisci un'unica colonna chiamata strutture_attive.",
 soluzione="SELECT count(*) AS strutture_attive FROM strutture WHERE attiva = 1;"),
dict(id="SQL-003", tema="sql_base", livello=1,
 consegna="Elenca i tipi di struttura distinti presenti nel database.",
 soluzione="SELECT DISTINCT tipo FROM strutture ORDER BY tipo;"),
dict(id="SQL-004", tema="sql_base", livello=1,
 consegna="Mostra le 10 strutture con più letti: nome, paese, letti.",
 soluzione="SELECT nome, paese, letti FROM strutture ORDER BY letti DESC LIMIT 10;"),
dict(id="SQL-005", tema="sql_base", livello=1,
 consegna="Conta i pazienti per sesso.",
 soluzione="SELECT sesso, count(*) AS pazienti FROM pazienti GROUP BY sesso ORDER BY sesso;"),
dict(id="SQL-006", tema="sql_base", livello=1,
 consegna="Quanti pazienti risultano sfollati e quanti no? Usa un'etichetta leggibile ('sfollato' / 'non sfollato').",
 soluzione="""SELECT CASE sfollato WHEN 1 THEN 'sfollato' ELSE 'non sfollato' END AS stato,
       count(*) AS pazienti FROM pazienti GROUP BY sfollato ORDER BY sfollato DESC;"""),
dict(id="SQL-007", tema="sql_base", livello=1,
 consegna="Elenca le visite del tipo 'emergenza' avvenute nel 2026, con data, struttura_id ed esito. Ordina dalla più recente.",
 soluzione="SELECT data, struttura_id, esito FROM visite WHERE tipo = 'emergenza' AND data >= '2026-01-01' ORDER BY data DESC;"),
dict(id="SQL-008", tema="sql_base", livello=1,
 consegna="Quali farmaci appartengono alla classe 'antibiotico'? Elenco senza duplicati.",
 soluzione="SELECT DISTINCT farmaco FROM prescrizioni WHERE classe = 'antibiotico' ORDER BY farmaco;"),
dict(id="SQL-009", tema="sql_base", livello=1,
 consegna="Conta gli esami di laboratorio fuori range.",
 soluzione="SELECT count(*) AS esami_fuori_range FROM esami_lab WHERE fuori_range = 1;"),
dict(id="SQL-010", tema="sql_base", livello=1,
 consegna="Elenca i progetti attivi con budget superiore a 1.000.000 EUR: nome, donatore, budget_eur.",
 soluzione="SELECT nome, donatore, budget_eur FROM progetti WHERE stato = 'attivo' AND budget_eur > 1000000 ORDER BY budget_eur DESC;"),
dict(id="SQL-011", tema="sql_base", livello=1,
 consegna="Quali siti NON sono accessibili? Mostra nome, regione e popolazione_stimata.",
 soluzione="SELECT nome, regione, popolazione_stimata FROM siti WHERE accessibile = 0 ORDER BY popolazione_stimata DESC;"),
dict(id="SQL-012", tema="sql_base", livello=1,
 consegna="Elenca gli indicatori del settore nutrizione con la loro unità e direzione attesa.",
 soluzione="SELECT codice, nome, unita, direzione FROM indicatori WHERE settore = 'nutrizione' ORDER BY codice;"),
dict(id="SQL-013", tema="sql_base", livello=1,
 consegna="Calcola il valore totale distribuito in euro (quantita * costo_unitario_eur) per l'intero dataset. Arrotonda a 2 decimali.",
 soluzione="SELECT round(sum(quantita * costo_unitario_eur), 2) AS valore_totale_eur FROM distribuzioni;"),
dict(id="SQL-014", tema="sql_base", livello=1,
 consegna="Quante valutazioni risultano NON completate?",
 soluzione="SELECT count(*) AS non_completate FROM valutazioni WHERE completata = 0;"),
dict(id="SQL-015", tema="qualita_dati", livello=1,
 consegna="Quante misurazioni hanno il valore mancante (NULL)?",
 soluzione="SELECT count(*) AS valori_mancanti FROM misurazioni WHERE valore IS NULL;"),
dict(id="SQL-016", tema="sql_base", livello=1,
 consegna="Elenca il personale internazionale (nazionale = 0) con ruolo e costo mensile, dal più costoso.",
 soluzione="SELECT ruolo, costo_mensile_eur FROM personale WHERE nazionale = 0 ORDER BY costo_mensile_eur DESC;"),
dict(id="SQL-017", tema="sql_base", livello=1,
 consegna="Mostra le diagnosi croniche distinte con il loro codice ICD-10.",
 soluzione="SELECT DISTINCT codice_icd10, descrizione FROM diagnosi WHERE cronica = 1 ORDER BY codice_icd10;"),
dict(id="SQL-018", tema="sql_base", livello=1,
 consegna="Quante visite si sono concluse con esito 'decesso'?",
 soluzione="SELECT count(*) AS decessi FROM visite WHERE esito = 'decesso';"),

# ---------------------------------------------------------------- LIVELLO 2
dict(id="SQL-019", tema="sql_join", livello=2,
 consegna="Per ogni visita di tipo 'ricovero', mostra la data, il nome della struttura e il paese. Limita a 50 righe.",
 soluzione="""SELECT v.data, s.nome AS struttura, s.paese
FROM visite v JOIN strutture s ON s.id = v.struttura_id
WHERE v.tipo = 'ricovero' ORDER BY v.data DESC LIMIT 50;"""),
dict(id="SQL-020", tema="sql_agg", livello=2,
 consegna="Conta le visite per paese, ordinando dal paese con più visite.",
 soluzione="""SELECT s.paese, count(*) AS visite
FROM visite v JOIN strutture s ON s.id = v.struttura_id
GROUP BY s.paese ORDER BY visite DESC;"""),
dict(id="SQL-021", tema="sql_agg", livello=2,
 consegna="Quali sono le 10 diagnosi più frequenti? Mostra codice, descrizione e numero di casi.",
 soluzione="""SELECT codice_icd10, descrizione, count(*) AS casi
FROM diagnosi GROUP BY codice_icd10, descrizione ORDER BY casi DESC LIMIT 10;"""),
dict(id="SQL-022", tema="sql_agg", livello=2,
 consegna="Calcola la durata media delle visite per tipo, arrotondata a 1 decimale, solo per i tipi con almeno 100 visite.",
 soluzione="""SELECT tipo, round(avg(durata_min), 1) AS durata_media, count(*) AS n
FROM visite GROUP BY tipo HAVING count(*) >= 100 ORDER BY durata_media DESC;"""),
dict(id="SQL-023", tema="sql_join", livello=2,
 consegna="Per ogni struttura attiva, conta i pazienti registrati. Includi anche le strutture con zero pazienti.",
 soluzione="""SELECT s.nome, s.tipo, count(p.id) AS pazienti
FROM strutture s LEFT JOIN pazienti p ON p.struttura_registrazione_id = s.id
WHERE s.attiva = 1 GROUP BY s.id, s.nome, s.tipo ORDER BY pazienti DESC;"""),
dict(id="SQL-024", tema="epidemiologia", livello=2,
 consegna="Calcola il numero di visite per mese nel 2026 (formato AAAA-MM), ordinato cronologicamente.",
 soluzione="""SELECT strftime('%Y-%m', data) AS mese, count(*) AS visite
FROM visite WHERE data >= '2026-01-01' GROUP BY mese ORDER BY mese;"""),
dict(id="SQL-025", tema="epidemiologia", livello=2,
 consegna="Calcola l'età in anni compiuti di ogni paziente alla data del 2026-09-01. Mostra codice, data_nascita ed eta. Limita a 30 righe.",
 soluzione="""SELECT codice, data_nascita,
       CAST((julianday('2026-09-01') - julianday(data_nascita)) / 365.25 AS INTEGER) AS eta
FROM pazienti ORDER BY eta DESC LIMIT 30;"""),
dict(id="SQL-026", tema="epidemiologia", livello=2,
 consegna="Distribuisci i pazienti nelle fasce d'età 0-4, 5-17, 18-49, 50+ al 2026-09-01 e contali per fascia.",
 soluzione="""SELECT CASE
         WHEN (julianday('2026-09-01') - julianday(data_nascita))/365.25 < 5 THEN '0-4'
         WHEN (julianday('2026-09-01') - julianday(data_nascita))/365.25 < 18 THEN '5-17'
         WHEN (julianday('2026-09-01') - julianday(data_nascita))/365.25 < 50 THEN '18-49'
         ELSE '50+' END AS fascia,
       count(*) AS pazienti
FROM pazienti GROUP BY fascia ORDER BY fascia;"""),
dict(id="SQL-027", tema="sql_agg", livello=2,
 consegna="Per ogni esito di visita, calcola il numero e la percentuale sul totale, arrotondata a 2 decimali.",
 soluzione="""SELECT esito, count(*) AS n,
       round(100.0 * count(*) / (SELECT count(*) FROM visite), 2) AS percentuale
FROM visite GROUP BY esito ORDER BY n DESC;"""),
dict(id="SQL-028", tema="sql_join", livello=2,
 consegna="Elenca i 15 pazienti con più visite: codice paziente, regione e numero di visite.",
 soluzione="""SELECT p.codice, p.regione, count(v.id) AS visite
FROM pazienti p JOIN visite v ON v.paziente_id = p.id
GROUP BY p.id, p.codice, p.regione ORDER BY visite DESC, p.codice LIMIT 15;"""),
dict(id="SQL-029", tema="meal", livello=2,
 consegna="Per ogni progetto, conta i siti e somma la popolazione stimata coperta.",
 soluzione="""SELECT pr.nome, pr.paese, count(si.id) AS siti, sum(si.popolazione_stimata) AS popolazione
FROM progetti pr JOIN siti si ON si.progetto_id = pr.id
GROUP BY pr.id, pr.nome, pr.paese ORDER BY popolazione DESC;"""),
dict(id="SQL-030", tema="meal", livello=2,
 consegna="Quante valutazioni sono state condotte per ciascuno strumento, e quanti intervistati in totale?",
 soluzione="""SELECT strumento, count(*) AS valutazioni, sum(intervistati) AS intervistati_totali
FROM valutazioni GROUP BY strumento ORDER BY valutazioni DESC;"""),
dict(id="SQL-031", tema="meal", livello=2,
 consegna="Per ogni indicatore, calcola il valore medio misurato (ignorando i NULL) e il numero di misurazioni valide.",
 soluzione="""SELECT i.codice, i.nome, round(avg(m.valore), 2) AS valore_medio, count(m.valore) AS misurazioni_valide
FROM indicatori i JOIN misurazioni m ON m.indicatore_id = i.id
GROUP BY i.id, i.codice, i.nome ORDER BY i.codice;"""),
dict(id="SQL-032", tema="sql_agg", livello=2,
 consegna="Quali classi di farmaco sono prescritte più spesso? Mostra classe, numero di prescrizioni e giorni medi di terapia.",
 soluzione="""SELECT classe, count(*) AS prescrizioni, round(avg(giorni), 1) AS giorni_medi
FROM prescrizioni GROUP BY classe ORDER BY prescrizioni DESC;"""),
dict(id="SQL-033", tema="sql_join", livello=2,
 consegna="Per ogni paese, calcola quante diagnosi croniche sono state registrate.",
 soluzione="""SELECT s.paese, count(*) AS diagnosi_croniche
FROM diagnosi d
JOIN visite v ON v.id = d.visita_id
JOIN strutture s ON s.id = v.struttura_id
WHERE d.cronica = 1 GROUP BY s.paese ORDER BY diagnosi_croniche DESC;"""),
dict(id="SQL-034", tema="qualita_dati", livello=2,
 consegna="Trova le misurazioni di bassa qualità: mostra codice indicatore, valore e la valutazione di origine. Limita a 40.",
 soluzione="""SELECT i.codice, m.valore, m.qualita, v.strumento, v.data
FROM misurazioni m
JOIN indicatori i ON i.id = m.indicatore_id
JOIN valutazioni v ON v.id = m.valutazione_id
WHERE m.qualita = 'bassa' ORDER BY v.data DESC LIMIT 40;"""),
dict(id="SQL-035", tema="meal", livello=2,
 consegna="Calcola il costo totale del personale per progetto (costo mensile sommato), separando nazionale e internazionale.",
 soluzione="""SELECT pr.nome,
       round(sum(CASE WHEN pe.nazionale = 1 THEN pe.costo_mensile_eur ELSE 0 END), 2) AS costo_nazionale,
       round(sum(CASE WHEN pe.nazionale = 0 THEN pe.costo_mensile_eur ELSE 0 END), 2) AS costo_internazionale
FROM progetti pr JOIN personale pe ON pe.progetto_id = pr.id
GROUP BY pr.id, pr.nome ORDER BY costo_internazionale DESC;"""),
dict(id="SQL-036", tema="sql_agg", livello=2,
 consegna="Quante vaccinazioni sono state somministrate per tipo di vaccino, e qual è la dose media?",
 soluzione="""SELECT vaccino, count(*) AS dosi, round(avg(dose_num), 2) AS dose_media
FROM vaccinazioni GROUP BY vaccino ORDER BY dosi DESC;"""),
dict(id="SQL-037", tema="epidemiologia", livello=2,
 consegna="Conta le visite per giorno della settimana (0=domenica). Ordina per numero di visite decrescente.",
 soluzione="""SELECT strftime('%w', data) AS giorno_settimana, count(*) AS visite
FROM visite GROUP BY giorno_settimana ORDER BY visite DESC;"""),
dict(id="SQL-038", tema="sql_join", livello=2,
 consegna="Elenca le strutture che non hanno mai registrato alcuna visita.",
 soluzione="""SELECT s.nome, s.tipo, s.paese FROM strutture s
LEFT JOIN visite v ON v.struttura_id = s.id
WHERE v.id IS NULL ORDER BY s.nome;"""),
dict(id="SQL-039", tema="meal", livello=2,
 consegna="Per ogni articolo distribuito, calcola quantità totale, beneficiari totali e costo totale in euro.",
 soluzione="""SELECT articolo, sum(quantita) AS quantita, sum(beneficiari) AS beneficiari,
       round(sum(quantita * costo_unitario_eur), 2) AS costo_eur
FROM distribuzioni GROUP BY articolo ORDER BY costo_eur DESC;"""),
dict(id="SQL-040", tema="sql_agg", livello=2,
 consegna="Calcola il tasso di esami fuori range per analita, in percentuale, con almeno 50 esami.",
 soluzione="""SELECT analita, count(*) AS esami,
       round(100.0 * sum(fuori_range) / count(*), 2) AS pct_fuori_range
FROM esami_lab GROUP BY analita HAVING count(*) >= 50 ORDER BY pct_fuori_range DESC;"""),
dict(id="SQL-041", tema="epidemiologia", livello=2,
 consegna="Calcola quanti giorni sono passati tra la registrazione del paziente e la sua prima visita. Mostra i 20 con attesa maggiore.",
 soluzione="""SELECT p.codice, p.data_registrazione, min(v.data) AS prima_visita,
       CAST(julianday(min(v.data)) - julianday(p.data_registrazione) AS INTEGER) AS giorni_attesa
FROM pazienti p JOIN visite v ON v.paziente_id = p.id
GROUP BY p.id, p.codice, p.data_registrazione ORDER BY giorni_attesa DESC LIMIT 20;"""),
dict(id="SQL-042", tema="meal", livello=2,
 consegna="Per ogni donatore, somma il budget e conta i progetti. Mostra solo i donatori con più di un progetto.",
 soluzione="""SELECT donatore, count(*) AS progetti, round(sum(budget_eur), 2) AS budget_totale
FROM progetti GROUP BY donatore HAVING count(*) > 1 ORDER BY budget_totale DESC;"""),
dict(id="SQL-043", tema="qualita_dati", livello=2,
 consegna="Verifica la coerenza referenziale: esistono visite che puntano a una struttura inesistente?",
 soluzione="""SELECT count(*) AS visite_orfane FROM visite v
LEFT JOIN strutture s ON s.id = v.struttura_id WHERE s.id IS NULL;"""),
dict(id="SQL-044", tema="qualita_dati", livello=2,
 consegna="Trova le distribuzioni in cui i beneficiari superano la quantità distribuita — anomalia logica da segnalare.",
 soluzione="""SELECT d.id, s.nome AS sito, d.articolo, d.quantita, d.beneficiari
FROM distribuzioni d JOIN siti s ON s.id = d.sito_id
WHERE d.beneficiari > d.quantita ORDER BY (d.beneficiari - d.quantita) DESC;"""),
dict(id="SQL-045", tema="sql_join", livello=2,
 consegna="Per ogni regione, conta pazienti sfollati e non sfollati in due colonne separate.",
 soluzione="""SELECT regione,
       sum(CASE WHEN sfollato = 1 THEN 1 ELSE 0 END) AS sfollati,
       sum(CASE WHEN sfollato = 0 THEN 1 ELSE 0 END) AS non_sfollati
FROM pazienti GROUP BY regione ORDER BY sfollati DESC;"""),
]
