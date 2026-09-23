-- 003 — le prime fonti RSS della conduttura quotidiana.
--
-- Righe di dati, non schema: la tabella `percorso.fonti` esiste dalla 001.
-- Stanno in un file perché sono una decisione, non un accidente — e perché
-- chi rifà il database da zero deve ritrovare la stessa biblioteca.
--
-- Nessuno di questi indirizzi è stato provato dalla sessione che li ha
-- scritti: quel contenitore non ha uscita verso internet. Li prova la prima
-- corsa, oppure `python3 strumenti/nuvola/diagnosi.py --fonti`. Una fonte che
-- non risponde si spegne con `attiva = false`, non si cancella: il motivo per
-- cui era stata scelta resta scritto.
--
-- `categoria` deve essere uno degli slug di `percorso.modello_temi`. Non entra
-- nella classificazione — sarebbe un'etichetta che si classifica da sé — ma
-- quando il tema calcolato coincide la rilevanza sale del 20%.
--
-- `peso` decide l'ordine di lettura quando il tetto di sei minuti taglia:
-- prima i pesanti. Gli archivi aperti coprono già le pubblicazioni indicizzate
-- con qualche giorno di ritardo; questi feed servono per il giorno stesso.

-- Senza questo vincolo `on conflict do nothing` non protegge da niente: la
-- chiave primaria è un uuid casuale, che non collide mai, e rieseguire il file
-- raddoppierebbe le righe in silenzio. Con il vincolo, riapplicarlo è un
-- nulla di fatto — che è ciò che una migrazione di dati deve essere.
alter table percorso.fonti
  add constraint fonti_utente_url_feed_unico unique (utente_id, url_feed);

insert into percorso.fonti (nome, url_feed, url_sito, metodo, categoria, lingua, peso, attiva)
values
  ('Planet PostgreSQL', 'https://planet.postgresql.org/rss20.xml',
   'https://planet.postgresql.org/', 'rss', 'sql_base', 'en', 0.7, true),
  -- Spente, e il motivo resta scritto: `catalogo.py:42` interroga gia' l'API
  -- di arXiv su cs.DB, cs.LG, cs.CR, cs.CY, cs.SE, stat.ME, stat.AP, stat.ML,
  -- ordinata per data di deposito. Queste tre erano doppioni puri: mangiavano
  -- il tetto di dodici voci per fonte e il tetto di ottanta articoli per
  -- consegnare cio' che l'archivio consegna gia'. Restano qui perche' il
  -- giorno in cui quelle categorie uscissero da CATEGORIE_ARXIV, riaccenderle
  -- e' cambiare una parola.
  ('arXiv cs.DB', 'https://rss.arxiv.org/rss/cs.DB',
   'https://arxiv.org/list/cs.DB/recent', 'rss', 'modellazione', 'en', 0.5, false),
  ('arXiv stat.AP', 'https://rss.arxiv.org/rss/stat.AP',
   'https://arxiv.org/list/stat.AP/recent', 'rss', 'statistica', 'en', 0.5, false),
  ('arXiv cs.CR', 'https://rss.arxiv.org/rss/cs.CR',
   'https://arxiv.org/list/cs.CR/recent', 'rss', 'sicurezza', 'en', 0.5, false),
  -- cs.AI NON e' in CATEGORIE_ARXIV: questa porta qualcosa che l'archivio non
  -- porta, ed e' l'unica delle quattro che lo faccia.
  ('arXiv cs.AI', 'https://rss.arxiv.org/rss/cs.AI',
   'https://arxiv.org/list/cs.AI/recent', 'rss', 'ia', 'en', 0.5, true)
on conflict (utente_id, url_feed) do nothing;
