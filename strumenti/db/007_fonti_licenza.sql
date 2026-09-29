-- La licenza con cui una fonte è stata accettata, SCRITTA dalla verifica e
-- LETTA dalla rassegna quotidiana.
--
-- Fin qui la decisione di p7 si perdeva: `verifica_fonti.py` stabiliva con che
-- licenza una fonte entrava, e la rassegna di ogni mattina la ricalcolava da
-- capo dal solo indirizzo del feed. Per YouTube e Mastodon bastava — l'URL dice
-- già tutto. Per i podcast no: un podcast si riconosce dal CONTENUTO del feed
-- (episodi con un allegato audio), non dall'indirizzo, e ne esistono di due
-- tipi che vanno trattati in modo opposto:
--
--   - quelli che dichiarano una licenza (Creative Commons, termini del sito):
--     se ne estrae il testo, trascrizione dell'autore compresa;
--   - quelli che non la dichiarano: entrano «solo metadati» come YouTube —
--     titolo, descrizione, data, collegamento, allegato — e niente testo.
--
-- Dal solo URL la rassegna non può distinguerli, e trattarli tutti allo stesso
-- modo vorrebbe dire o estrarre testo che nessuno ha licenziato, o spegnere la
-- trascrizione proprio ai podcast che la licenziano. Quindi la decisione si
-- salva qui, una volta, da chi l'ha presa.
--
-- Colonna nullable e additiva: una fonte senza `licenza` si comporta
-- esattamente come prima (la rassegna ripiega sulle espressioni regolari di
-- `PIATTAFORME_METADATI`). `applica_fonti` la scrive solo se il cambio la porta,
-- quindi un payload vecchio produce lo stesso effetto di prima.
--
-- `fonti` non viaggia nel registro degli eventi — è una tabella della sola
-- conduttura — quindi questa colonna non tocca `lib/db.ts` né i payload che
-- `verifica_nuvola.py` confronta con lo schema.

alter table percorso.fonti add column if not exists licenza text;

comment on column percorso.fonti.licenza is
  'Licenza con cui la verifica ha accettato la fonte (testo | url). Se comincia per «solo metadati», la rassegna non estrae il testo delle sue voci.';

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
  licenziate int := 0;
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

    -- Nuovo: la licenza con cui la verifica ha deciso. Si scrive anche vuota,
    -- perché una fonte che PERDE la licenza (il sito toglie la CC) deve
    -- perdere anche il trattamento che quella licenza le dava.
    if c ? 'licenza' then
      update percorso.fonti
         set licenza = nullif(c->>'licenza', '')
       where url_feed = coalesce(nuovo, vecchio);
      get diagnostics n = row_count;
      licenziate := licenziate + n;
    end if;
  end loop;

  return jsonb_build_object('riparate', riparate, 'rinviate', rinviate,
                            'accese', accese, 'spente', spente,
                            'licenziate', licenziate,
                            'cambi', jsonb_array_length(cambi));
end
$$;

grant execute on function percorso.applica_fonti(jsonb) to anon, authenticated;
