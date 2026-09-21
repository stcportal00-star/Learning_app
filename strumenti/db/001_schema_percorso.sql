-- 001 — Schema base Percorso (già applicato sul progetto hgvzjeituvvwtskbxzzl)
create schema if not exists percorso;

create table percorso.dispositivi (
  id uuid primary key default gen_random_uuid(),
  utente_id uuid not null references auth.users(id) on delete cascade,
  nome text not null, piattaforma text not null default 'android',
  ultimo_hlc text, ultimo_sync timestamptz, creato_a timestamptz not null default now());

create table percorso.eventi (
  id uuid primary key,
  utente_id uuid not null references auth.users(id) on delete cascade,
  dispositivo_id uuid not null references percorso.dispositivi(id) on delete cascade,
  hlc text not null, entita text not null, entita_id uuid not null,
  tipo text not null check (tipo in ('crea','aggiorna','elimina')),
  payload jsonb not null default '{}'::jsonb, creato_a timestamptz not null default now());
create index eventi_utente_hlc_idx on percorso.eventi (utente_id, hlc);
create index eventi_entita_idx on percorso.eventi (entita, entita_id);

create table percorso.temi (
  id uuid primary key default gen_random_uuid(),
  utente_id uuid not null references auth.users(id) on delete cascade,
  slug text not null, nome text not null,
  pista text not null check (pista in ('dati','soluzioni','ia','gestione','governance','hardware','business_analysis','kpi')),
  trimestre text, attivo boolean not null default true, unique (utente_id, slug));

create table percorso.sessioni (
  id uuid primary key default gen_random_uuid(),
  utente_id uuid not null references auth.users(id) on delete cascade,
  tema_id uuid references percorso.temi(id) on delete set null,
  tipo text not null check (tipo in ('mattina','artefatto','lettura','paper','ripasso')),
  inizio timestamptz not null, minuti integer not null check (minuti > 0),
  note text, hlc text, dispositivo_id uuid references percorso.dispositivi(id) on delete set null);
create index sessioni_utente_inizio_idx on percorso.sessioni (utente_id, inizio desc);

create table percorso.esercizi (
  id uuid primary key default gen_random_uuid(),
  utente_id uuid not null references auth.users(id) on delete cascade,
  tema_id uuid references percorso.temi(id) on delete set null,
  tipo text not null check (tipo in ('sql_eseguibile','quiz_citato','rubrica','paper')),
  livello smallint not null check (livello between 1 and 4),
  consegna text not null, dataset text, soluzione_riferimento text, rubrica jsonb,
  fonte_citazione text, fonte_url text, licenza text,
  creato_a timestamptz not null default now(),
  constraint esercizio_verificabile check (
    (tipo = 'sql_eseguibile' and soluzione_riferimento is not null and dataset is not null)
    or (tipo = 'quiz_citato' and fonte_citazione is not null)
    or (tipo = 'rubrica' and rubrica is not null) or (tipo = 'paper')));
create index esercizi_tema_livello_idx on percorso.esercizi (tema_id, livello);

create table percorso.tentativi (
  id uuid primary key default gen_random_uuid(),
  utente_id uuid not null references auth.users(id) on delete cascade,
  esercizio_id uuid not null references percorso.esercizi(id) on delete cascade,
  risposta text, esito text not null check (esito in ('corretto','errato','parziale','saltato')),
  durata_sec integer, eseguito_a timestamptz not null default now(),
  hlc text, dispositivo_id uuid references percorso.dispositivi(id) on delete set null);
create index tentativi_esercizio_idx on percorso.tentativi (esercizio_id, eseguito_a desc);

create table percorso.ripasso (
  id uuid primary key default gen_random_uuid(),
  utente_id uuid not null references auth.users(id) on delete cascade,
  esercizio_id uuid not null references percorso.esercizi(id) on delete cascade,
  stabilita real not null default 0, difficolta real not null default 5,
  ripetizioni integer not null default 0, ultima_revisione timestamptz,
  prossima_revisione timestamptz not null default now(),
  stato text not null default 'nuovo' check (stato in ('nuovo','apprendimento','ripasso','ricaduta')),
  unique (utente_id, esercizio_id));
create index ripasso_prossima_idx on percorso.ripasso (utente_id, prossima_revisione);

create table percorso.note (
  id uuid primary key default gen_random_uuid(),
  utente_id uuid not null references auth.users(id) on delete cascade,
  tema_id uuid references percorso.temi(id) on delete set null,
  titolo text, testo text not null default '', pubblicabile boolean not null default false,
  origine_url text, creato_a timestamptz not null default now(), hlc text);
create index note_pubblicabile_idx on percorso.note (utente_id, pubblicabile);

create table percorso.artefatti (
  id uuid primary key default gen_random_uuid(),
  utente_id uuid not null references auth.users(id) on delete cascade,
  titolo text not null, trimestre text,
  stato text not null default 'pianificato' check (stato in ('pianificato','in_corso','consegnato')),
  descrizione text, url text, aggiornato_a timestamptz not null default now());

create table percorso.credenziali (
  id uuid primary key default gen_random_uuid(),
  utente_id uuid not null references auth.users(id) on delete cascade,
  nome text not null, ente text not null, costo_usd numeric(8,2) default 0,
  stato text not null default 'pianificata' check (stato in ('pianificata','in_preparazione','ottenuta','scaduta')),
  data_esame date, url_badge text, scadenza date, anno_previsto smallint);
create index credenziali_scadenza_idx on percorso.credenziali (utente_id, scadenza);

create table percorso.pubblicazioni (
  id uuid primary key default gen_random_uuid(),
  utente_id uuid not null references auth.users(id) on delete cascade,
  titolo text not null,
  tipo text not null check (tipo in ('post','articolo','repository','intervento','documento')),
  stato text not null default 'bozza' check (stato in ('bozza','pubblicato')),
  url text, data_pubblicazione date, nota_id uuid references percorso.note(id) on delete set null);

create table percorso.fonti (
  id uuid primary key default gen_random_uuid(),
  utente_id uuid not null references auth.users(id) on delete cascade,
  nome text not null, url_feed text, url_sito text,
  metodo text not null default 'rss' check (metodo in ('rss','scrape','api','email')),
  categoria text not null, lingua text not null default 'en',
  peso real not null default 0.5 check (peso between 0 and 1), attiva boolean not null default true);

create table percorso.articoli (
  id uuid primary key default gen_random_uuid(),
  utente_id uuid not null references auth.users(id) on delete cascade,
  fonte_id uuid references percorso.fonti(id) on delete set null,
  titolo text not null, url text not null, pubblicato_a timestamptz, testo text, simhash text,
  punteggio smallint check (punteggio between 0 and 100), salvato boolean not null default false,
  pdf_path text, raccolto_a timestamptz not null default now(), unique (utente_id, url));
create index articoli_punteggio_idx on percorso.articoli (utente_id, raccolto_a desc, punteggio desc);

create table percorso.papers (
  id uuid primary key default gen_random_uuid(),
  utente_id uuid not null references auth.users(id) on delete cascade,
  origine text not null check (origine in ('openalex','arxiv','semantic_scholar','hf_daily','scholar_alert')),
  identificativo text not null, titolo text not null, autori text[], abstract text,
  url_pdf text, pubblicato_a date, punteggio smallint check (punteggio between 0 and 100),
  letto boolean not null default false, nota_id uuid references percorso.note(id) on delete set null,
  unique (utente_id, origine, identificativo));
create index papers_da_leggere_idx on percorso.papers (utente_id, letto, punteggio desc);

do $$
declare t text;
begin
  foreach t in array array['dispositivi','eventi','temi','sessioni','esercizi','tentativi','ripasso','note','artefatti','credenziali','pubblicazioni','fonti','articoli','papers']
  loop
    execute format('alter table percorso.%I enable row level security', t);
    execute format('create policy %I on percorso.%I for all to authenticated using (utente_id = (select auth.uid())) with check (utente_id = (select auth.uid()))', t || '_proprietario', t);
  end loop;
end $$;
