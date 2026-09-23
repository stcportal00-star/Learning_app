-- 004 — «sitemap» fra i metodi ammessi, e un modo di applicare le decisioni
-- della verifica settimanale in UNA sola transazione.
--
-- Due cose che vanno insieme perché la prima senza la seconda non serve e la
-- seconda senza la prima si rompe.

-- 1) Il CHECK della 001 ammetteva rss, scrape, api, email. L'autoriparazione di
-- `consegna_code/verifica_fonti.py` scrive `metodo = 'sitemap'` quando un sito
-- che vale la pena leggere non ha un feed e il suo contenuto va ricostruito dal
-- sitemap: senza questa riga quell'UPDATE viene rifiutato con 23514, e la
-- riparazione fallisce dopo aver già rinominato `url_feed`.
alter table percorso.fonti drop constraint if exists fonti_metodo_check;
alter table percorso.fonti
  add constraint fonti_metodo_check
  check (metodo in ('rss','sitemap','scrape','api','email'));

-- 2) `activar.sql` è una ventina di UPDATE. Applicarli via PostgREST significa
-- una PATCH per riga, cioè venti transazioni: se la decima fallisce, la tabella
-- resta in uno stato che nessuno ha deciso — metà delle fonti riparate, metà no,
-- e nessun modo di sapere quale metà senza rileggerle tutte. Una funzione è una
-- transazione sola: o passa tutto o non cambia niente.
--
-- Prende dati, non SQL. Una funzione che eseguisse il testo che le arriva
-- sarebbe una porta aperta con la chiave publishable che sta dentro l'APK.
--
-- `security invoker`: le policy RLS restano quelle di chi chiama, quindi la
-- funzione vede e tocca soltanto le righe del proprietario. È anche il motivo
-- per cui qui dentro non c'è nessun filtro su `utente_id`: aggiungerlo
-- darebbe l'impressione che sia lui a proteggere, e il giorno in cui qualcuno
-- lo togliesse non si accorgerebbe di aver tolto niente.
create or replace function percorso.applica_fonti(cambi jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = percorso, public
as $$
declare
  c jsonb;
  vecchio text;
  nuovo text;
  n int;
  riparate int := 0;
  rinviate int := 0;
  accese int := 0;
  spente int := 0;
begin
  if jsonb_typeof(cambi) is distinct from 'array' then
    raise exception 'applica_fonti: atteso un array di cambi, arrivato %',
      coalesce(jsonb_typeof(cambi), 'null');
  end if;

  for c in select * from jsonb_array_elements(cambi)
  loop
    vecchio := nullif(c->>'url_feed', '');
    nuovo := nullif(c->>'url_nuovo', '');
    if vecchio is null then
      raise exception 'applica_fonti: un cambio senza url_feed: %', c;
    end if;

    if nuovo is not null then
      if exists (select 1 from percorso.fonti g where g.url_feed = nuovo) then
        -- L'indirizzo nuovo c'è già: rinominare violerebbe l'unicità. Si spegne
        -- il vecchio e si lascia vivere quello che esisteva, che è la stessa
        -- cosa che fa `sql_salida()`.
        update percorso.fonti set attiva = false where url_feed = vecchio;
        get diagnostics n = row_count;
        rinviate := rinviate + n;
      else
        update percorso.fonti set url_feed = nuovo where url_feed = vecchio;
        get diagnostics n = row_count;
        riparate := riparate + n;
      end if;
      update percorso.fonti
         set url_sito = coalesce(nullif(c->>'url_sito', ''), url_sito),
             metodo = coalesce(nullif(c->>'metodo', ''), metodo)
       where url_feed = nuovo;
    end if;

    if c ? 'attiva' then
      update percorso.fonti
         set attiva = (c->>'attiva')::boolean
       where url_feed = coalesce(nuovo, vecchio);
      get diagnostics n = row_count;
      if (c->>'attiva')::boolean then
        accese := accese + n;
      else
        spente := spente + n;
      end if;
    end if;
  end loop;

  return jsonb_build_object('riparate', riparate, 'rinviate', rinviate,
                            'accese', accese, 'spente', spente,
                            'cambi', jsonb_array_length(cambi));
end
$$;

-- 3) Le proposte dello scouting mensile. Entrano SEMPRE spente e con peso basso:
-- non è questa funzione a decidere che una fonte è buona, è `verifica_fonti.py`
-- della settimana dopo. Separata da `applica_fonti` di proposito — quella non
-- deve poter inserire niente, e questa non deve poter accendere niente.
--
-- `utente_id` non si passa: lo mette il default `percorso.utente_fisso()`, che è
-- anche ciò che la policy `solo_utente_fisso` pretende.
create or replace function percorso.proponi_fonti(nuove jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = percorso, public
as $$
declare
  c jsonb;
  n int;
  inserite int := 0;
begin
  if jsonb_typeof(nuove) is distinct from 'array' then
    raise exception 'proponi_fonti: atteso un array, arrivato %',
      coalesce(jsonb_typeof(nuove), 'null');
  end if;

  for c in select * from jsonb_array_elements(nuove)
  loop
    if nullif(c->>'url_feed', '') is null or nullif(c->>'nome', '') is null
       or nullif(c->>'categoria', '') is null then
      raise exception 'proponi_fonti: proposta incompleta: %', c;
    end if;
    insert into percorso.fonti (nome, url_feed, url_sito, metodo, categoria, lingua, peso, attiva)
    values (c->>'nome', c->>'url_feed', nullif(c->>'url_sito', ''),
            coalesce(nullif(c->>'metodo', ''), 'rss'), c->>'categoria',
            coalesce(nullif(c->>'lingua', ''), 'en'),
            coalesce((c->>'peso')::real, 0.3), false)
    on conflict (utente_id, url_feed) do nothing;
    get diagnostics n = row_count;
    inserite := inserite + n;
  end loop;

  return jsonb_build_object('inserite', inserite, 'proposte', jsonb_array_length(nuove));
end
$$;

-- `anon` e non solo `authenticated`: la conduttura parla con la chiave
-- publishable, che è il ruolo anon, ed è la policy `solo_utente_fisso` a
-- recintare le righe — non il ruolo. Con il solo grant a `authenticated` queste
-- funzioni sarebbero irraggiungibili proprio da chi deve chiamarle.
revoke all on function percorso.applica_fonti(jsonb) from public;
revoke all on function percorso.proponi_fonti(jsonb) from public;
grant execute on function percorso.applica_fonti(jsonb) to anon, authenticated;
grant execute on function percorso.proponi_fonti(jsonb) to anon, authenticated;
