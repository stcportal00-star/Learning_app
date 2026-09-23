-- 002 — Modello del piano di apprendimento.
-- Non dipende da auth.users: i dati esistono prima che l'utente si registri.
-- Alla prima apertura l'app chiama:  select * from percorso.installa_piano(auth.uid());

create table if not exists percorso.modello_temi (
  slug text primary key, nome text not null, pista text not null,
  trimestre text not null, ordine smallint not null);

create table if not exists percorso.modello_artefatti (
  codice text primary key, titolo text not null, trimestre text not null,
  descrizione text not null, ordine smallint not null);

create table if not exists percorso.modello_credenziali (
  codice text primary key, nome text not null, ente text not null,
  costo_usd numeric(8,2) not null default 0, anno_previsto smallint not null,
  nota text, ordine smallint not null);

create table if not exists percorso.modello_pubblicazioni (
  codice text primary key, titolo text not null, tipo text not null,
  mese_previsto smallint not null, ordine smallint not null);

alter table percorso.modello_temi          enable row level security;
alter table percorso.modello_artefatti     enable row level security;
alter table percorso.modello_credenziali   enable row level security;
alter table percorso.modello_pubblicazioni enable row level security;

drop policy if exists modello_temi_lettura on percorso.modello_temi;
drop policy if exists modello_artefatti_lettura on percorso.modello_artefatti;
drop policy if exists modello_credenziali_lettura on percorso.modello_credenziali;
drop policy if exists modello_pubblicazioni_lettura on percorso.modello_pubblicazioni;
create policy modello_temi_lettura          on percorso.modello_temi          for select to authenticated using (true);
create policy modello_artefatti_lettura     on percorso.modello_artefatti     for select to authenticated using (true);
create policy modello_credenziali_lettura   on percorso.modello_credenziali   for select to authenticated using (true);
create policy modello_pubblicazioni_lettura on percorso.modello_pubblicazioni for select to authenticated using (true);

-- ------------------------------------------------------------------- TEMI
insert into percorso.modello_temi (slug, nome, pista, trimestre, ordine) values
 ('gestione',          'Gestione delle persone',              'gestione',          'T0',  1),
 ('sql_base',          'SQL — fondamenti',                    'dati',              'T1',  2),
 ('sql_join',          'SQL — join',                          'dati',              'T1',  3),
 ('sql_agg',           'SQL — aggregazione',                  'dati',              'T1',  4),
 ('meal',              'MEAL e indicatori',                   'kpi',               'T1',  5),
 ('business_analysis', 'Business analysis e BPMN',            'business_analysis', 'T1',  6),
 ('lettura_codice',    'Lettura e verifica del codice',       'ia',                'T1',  7),
 ('sql_cte',           'SQL — CTE e ricorsione',              'dati',              'T2',  8),
 ('sql_window',        'SQL — window functions',              'dati',              'T2',  9),
 ('modellazione',      'Modellazione dimensionale',           'dati',              'T2', 10),
 ('qualita_dati',      'Qualità dei dati',                    'dati',              'T2', 11),
 ('kpi',               'KPI e misurazione',                   'kpi',               'T2', 12),
 ('statistica',        'Statistica applicata',                'dati',              'T2', 13),
 ('epidemiologia',     'Analisi epidemiologica',              'dati',              'T2', 14),
 ('ia',                'AI engineering',                      'ia',                'T3', 15),
 ('gdpr',              'GDPR e protezione dati',              'governance',        'T3', 16),
 ('ai_act',            'AI Act e governance IA',              'governance',        'T3', 17),
 ('ottimizzazione',    'SQL — piani di esecuzione e indici',  'dati',              'T4', 18),
 ('hardware',          'Hardware, reti e infrastruttura',     'hardware',          'T5', 19),
 ('governance',        'ITIL e governance dei servizi',       'governance',        'T5', 20),
 ('sicurezza',         'ISO 27001, NIS2 e sicurezza',         'governance',        'T5', 21),
 ('salute_digitale',   'DHIS2, FHIR e sistemi sanitari',      'dati',              'T6', 22)
on conflict (slug) do nothing;

-- -------------------------------------------------------------- ARTEFATTI
insert into percorso.modello_artefatti (codice, titolo, trimestre, descrizione, ordine) values
 ('ART-01','Mappa dei flussi di dati','T0','Origine, trasformazione, consumo e retention di ogni flusso. Nessuno la possiede completa: chi la disegna diventa indispensabile.',1),
 ('ART-02','Colloqui individuali con il team','T0','Inventario documentato di competenze, aspirazioni e attriti di ogni riporto diretto.',2),
 ('ART-03','Inventario degli asset analitici','T0','Cruscotti, script e basi dati con proprietario, criticità e stato.',3),
 ('ART-04','Diagnosi e roadmap a 12 mesi','T0','Diagnosi del team dati e piano a dodici mesi, presentato alla direzione.',4),
 ('ART-05','Modello BPMN as-is e to-be','T1','Flusso dei dati di valutazione dal terreno alla sede, con divario quantificato.',5),
 ('ART-06','Primo ciclo di obiettivi e riscontro','T1','Ciclo completo di definizione obiettivi e feedback per ogni riporto diretto.',6),
 ('ART-07','Albero dei KPI della funzione dati','T2','Dalla missione agli indicatori operativi, con proprietario e frequenza per ogni foglia.',7),
 ('ART-08','Set di SLI di qualità del dato','T2','Freschezza, completezza, validità e unicità con soglie giustificate e conseguenze.',8),
 ('ART-09','Modello dimensionale proprio','T2','Fatto, dimensioni conformi e grana dichiarata su un processo reale.',9),
 ('ART-10','Harness di valutazione IA','T3','Set di valutazione, metriche, casi limite, soglia dichiarata prima dei risultati.',10),
 ('ART-11','Policy sull''uso di IA generativa','T3','Ambito, soglia di revisione umana obbligatoria, provenienza del codice, rischio di manutenibilità.',11),
 ('ART-12','DPIA di un flusso di dati sanitari','T3','Base giuridica, necessità e proporzionalità, rischi per popolazioni vulnerabili, raccomandazione.',12),
 ('ART-13','Architettura dati obiettivo','T4','Livelli, contratti di dati, retention per categoria GDPR, lineage e proprietà.',13),
 ('ART-14','Due ADR per trimestre','T4','Contesto, opzioni, decisione, conseguenze negative accettate, criterio di verifica.',14),
 ('ART-15','Architettura di infrastruttura di terreno','T5','Tre profili di connettività con parametri misurabili e conseguenze progettuali.',15),
 ('ART-16','Home lab operativo','T5','Backend della rassegna ospitato su hardware proprio: reti, energia, amministrazione.',16),
 ('ART-17','Politica di qualità del dato','T6','Metriche, proprietari, soglie e procedura di risposta alle violazioni.',17),
 ('ART-18','Catalogo dati e dizionario istituzionale','T6','Definizioni condivise e lineage documentato.',18),
 ('ART-19','Strategia dati a 3 anni','T6','Documento di strategia presentato alla direzione, con costi ricorrenti dichiarati.',19)
on conflict (codice) do nothing;

-- ------------------------------------------------------------ CREDENZIALI
insert into percorso.modello_credenziali (codice, nome, ente, costo_usd, anno_previsto, nota, ordine) values
 ('CR-01','SC-900 Security, Compliance and Identity','Microsoft',0,1,'Voucher gratuito tramite Security Virtual Training Day. Ancora il discorso GDPR.',1),
 ('CR-02','AZ-900 Azure Fundamentals','Microsoft',0,1,'Voucher gratuito tramite Virtual Training Days.',2),
 ('CR-03','dbt Fundamentals','dbt Labs',0,1,'Corso gratuito con badge verificabile, allineato alla pista dati.',3),
 ('CR-04','Networking Basics','Cisco Networking Academy',0,1,'Badge gratuito. Chiude visibilmente la lacuna su reti e hardware.',4),
 ('CR-05','PL-300 Power BI Data Analyst','Microsoft',165,2,'Competenza già posseduta: servono settimane di ripasso, non di apprendimento.',5),
 ('CR-06','dbt Analytics Engineering Certification','dbt Labs',200,2,'Differenziatore moderno, quasi assente nel settore umanitario.',6),
 ('CR-07','CDMP Associate','DAMA International',370,2,'La credenziale che dice "governo dei dati" a un comitato di direzione.',7),
 ('CR-08','DHIS2 Academy','DHIS2 / University of Oslo',400,2,'Vale più di qualunque certificazione generica dentro MSF.',8),
 ('CR-09','ITIL 4 Foundation','PeopleCert',400,3,'Vocabolario dei servizi. Necessaria, non urgente.',9),
 ('CR-10','ISO/IEC 42001 Foundation','ente accreditato',300,3,'Norma nuova sulla gestione della IA: essere precoci è un segnale forte.',10),
 ('CR-11','CDPSE Data Privacy Solutions Engineer','ISACA',575,3,'Privacy più ingegneria dei dati: incastro migliore di CGEIT e meno costosa.',11),
 ('CR-12','Project DPro','PM4NGOs',150,3,'Riconosciuta nel settore. Opportunistica, non prioritaria.',12)
on conflict (codice) do nothing;

-- ---------------------------------------------------------- PUBBLICAZIONI
insert into percorso.modello_pubblicazioni (codice, titolo, tipo, mese_previsto, ordine) values
 ('PUB-01','Perché un responsabile dati deve saper leggere il codice, non scriverlo','post',1,1),
 ('PUB-02','Le tre query SQL che uso ogni settimana','post',2,2),
 ('PUB-03','Modellare in BPMN un flusso di valutazione di terreno','post',3,3),
 ('PUB-04','La grana della tabella dei fatti: l''errore che costa di più','post',4,4),
 ('PUB-05','Misurare l''immisurabile: la catena di chiarificazione applicata al MEAL','post',5,5),
 ('PUB-06','SLI di qualità del dato: freschezza, completezza, validità','post',6,6),
 ('PUB-07','Che cosa significa davvero valutare un sistema di IA','post',7,7),
 ('PUB-08','Una policy di IA generativa per un''organizzazione umanitaria','post',8,8),
 ('PUB-09','Contratti di dati fra team analitici','post',9,9),
 ('PUB-10','Connettività di terreno: tre profili e le loro conseguenze progettuali','post',10,10),
 ('PUB-11','Che cosa ho imparato costruendo un home lab','post',11,11),
 ('PUB-12','Un anno di apprendimento in pubblico: che cosa ha funzionato','post',12,12),
 ('PUB-13','Harness di valutazione IA — repository pubblico','repository',7,13),
 ('PUB-14','Abstract per ICT4D Conference o MERL Tech','intervento',10,14)
on conflict (codice) do nothing;

-- -------------------------------------------------- funzione di installazione
create or replace function percorso.installa_piano(u uuid)
returns table (temi int, artefatti int, credenziali int, pubblicazioni int)
language plpgsql security invoker as $fn$
declare t int; a int; c int; p int;
begin
  insert into percorso.temi (utente_id, slug, nome, pista, trimestre)
  select u, m.slug, m.nome, m.pista, m.trimestre from percorso.modello_temi m
  on conflict (utente_id, slug) do nothing;
  get diagnostics t = row_count;

  insert into percorso.artefatti (utente_id, titolo, trimestre, stato, descrizione)
  select u, m.titolo, m.trimestre, 'pianificato', m.descrizione from percorso.modello_artefatti m
  where not exists (select 1 from percorso.artefatti x where x.utente_id = u and x.titolo = m.titolo);
  get diagnostics a = row_count;

  insert into percorso.credenziali (utente_id, nome, ente, costo_usd, stato, anno_previsto)
  select u, m.nome, m.ente, m.costo_usd, 'pianificata', m.anno_previsto from percorso.modello_credenziali m
  where not exists (select 1 from percorso.credenziali x where x.utente_id = u and x.nome = m.nome);
  get diagnostics c = row_count;

  insert into percorso.pubblicazioni (utente_id, titolo, tipo, stato)
  select u, m.titolo, m.tipo, 'bozza' from percorso.modello_pubblicazioni m
  where not exists (select 1 from percorso.pubblicazioni x where x.utente_id = u and x.titolo = m.titolo);
  get diagnostics p = row_count;

  return query select t, a, c, p;
end $fn$;
