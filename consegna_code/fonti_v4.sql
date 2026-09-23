-- 0) Limpieza por si v1/v2 ya se insertaron (on conflict do nothing NO desactiva filas existentes)
update percorso.fonti set attiva = false where url_feed like 'https://www.bing.com/news/search%';
update percorso.fonti set attiva = false where url_feed in (
  'https://postgresweekly.com/rss/',
  'https://databasearchitects.blogspot.com/feeds/posts/default',
  'https://smalldatum.blogspot.com/feeds/posts/default',
  'https://blog.jooq.org/feed/',
  'https://joereis.substack.com/feed',
  'https://martinfowler.com/feed.atom',
  'https://benn.substack.com/feed',
  'https://tidyfirst.substack.com/feed',
  'https://jvns.ca/atom.xml',
  'https://newsletter.pragmaticengineer.com/feed',
  'https://www.r-bloggers.com/feed/',
  'https://statmodeling.stat.columbia.edu/feed/',
  'https://yourlocalepidemiologist.substack.com/feed',
  'https://nightingaledvs.com/feed/',
  'https://visualisingdata.com/feed/atom/',
  'https://flowingdata.com/feed',
  'https://www.storytellingwithdata.com/blog?format=rss',
  'https://ropensci.org/blog/index.xml',
  'https://www.cnil.fr/fr/rss.xml',
  'https://teachprivacy.com/feed/',
  'https://algorithmwatch.org/en/feed/',
  'https://raw.githubusercontent.com/Olshansk/rss-feeds/main/feeds/feed_aisi.xml',
  'https://raw.githubusercontent.com/Olshansk/rss-feeds/main/feeds/feed_far_ai.xml',
  'https://hamel.dev/index.xml',
  'https://eugeneyan.com/rss/',
  'https://www.latent.space/feed',
  'https://sreweekly.com/feed/',
  'https://charity.wtf/feed/',
  'https://surfingcomplexity.blog/feed/',
  'https://blog.apnic.net/feed/',
  'https://blog.cloudflare.com/rss/',
  'https://forum.getodk.org/latest.rss',
  'https://raw.githubusercontent.com/Olshansk/rss-feeds/main/feeds/feed_anthropic_red.xml',
  'https://www.ncsc.gov.uk/api/1/services/v1/all-rss-feed.xml',
  'https://isc.sans.edu/rssfeed_full.xml',
  'https://reliefweb.int/updates/rss.xml?advanced-search=(F4)',
  'https://www.ictworks.org/feed/',
  'https://www.healthintersections.com.au/rss.xml',
  'https://talk.openmrs.org/latest.rss'
);
-- percorso.fonti v4 · 3 url_feed reparados con datos reales (2026-09-23) · sin capa Bing (viola §1 y §6c) · todas attiva=false · activar solo vía verifica_fonti.py -> activar.sql
-- capa: D=diario A=aprender P=profesionalizar | conf: V=medida en sesión, H=alta, M=media (memoria, no descargadas)
insert into percorso.fonti (nome, url_feed, url_sito, metodo, categoria, lingua, peso, attiva)
values
  -- sql_base
  ('Postgres Weekly', 'https://postgresweekly.com/rss/', 'https://postgresweekly.com/', 'rss', 'sql_base', 'en', 0.5, false), -- D/H
  ('Use The Index Luke', 'https://use-the-index-luke.com/blog/feed.xml', 'https://use-the-index-luke.com/', 'rss', 'sql_base', 'en', 0.4, false), -- A/M
  ('Modern SQL', 'https://modern-sql.com/feed', 'https://modern-sql.com/', 'rss', 'sql_base', 'en', 0.4, false), -- A/M
  ('Haki Benita', 'https://hakibenita.com/feeds/all.atom.xml', 'https://hakibenita.com/', 'rss', 'sql_base', 'en', 0.4, false), -- A/M
  -- ottimizzazione
  ('Database Architects', 'https://databasearchitects.blogspot.com/feeds/posts/default', 'https://databasearchitects.blogspot.com/', 'rss', 'ottimizzazione', 'en', 0.5, false), -- A/H
  ('Small Datum', 'https://smalldatum.blogspot.com/feeds/posts/default', 'https://smalldatum.blogspot.com/', 'rss', 'ottimizzazione', 'en', 0.5, false), -- P/H
  ('jOOQ blog', 'https://blog.jooq.org/feed/', 'https://blog.jooq.org/', 'rss', 'ottimizzazione', 'en', 0.4, false), -- A/H
  -- modellazione
  ('Joe Reis', 'https://joereis.substack.com/feed', 'https://joereis.substack.com/', 'rss', 'modellazione', 'en', 0.5, false), -- A/H
  ('Martin Fowler', 'https://martinfowler.com/feed.atom', 'https://martinfowler.com/', 'rss', 'modellazione', 'en', 0.6, false), -- P/H
  ('benn.substack', 'https://benn.substack.com/feed', 'https://benn.substack.com/', 'rss', 'modellazione', 'en', 0.4, false), -- P/H
  ('Data Products', 'https://dataproducts.substack.com/feed', 'https://dataproducts.substack.com/', 'rss', 'modellazione', 'en', 0.4, false), -- P/M
  -- lettura_codice
  ('Tidy First', 'https://tidyfirst.substack.com/feed', 'https://tidyfirst.substack.com/', 'rss', 'lettura_codice', 'en', 0.5, false), -- A/H
  ('Julia Evans', 'https://jvns.ca/atom.xml', 'https://jvns.ca/', 'rss', 'lettura_codice', 'en', 0.5, false), -- A/H
  ('Pragmatic Engineer', 'https://newsletter.pragmaticengineer.com/feed', 'https://newsletter.pragmaticengineer.com/', 'rss', 'lettura_codice', 'en', 0.4, false), -- P/H
  -- statistica
  ('R-bloggers', 'https://www.r-bloggers.com/feed/', 'https://www.r-bloggers.com/', 'rss', 'statistica', 'en', 0.6, false), -- D/H
  ('Gelman blog', 'https://statmodeling.stat.columbia.edu/feed/', 'https://statmodeling.stat.columbia.edu/', 'rss', 'statistica', 'en', 0.5, false), -- A/H
  ('Frank Harrell', 'https://www.fharrell.com/index.xml', 'https://www.fharrell.com/', 'rss', 'statistica', 'en', 0.4, false), -- A/M
  -- epidemiologia
  ('Eurosurveillance', 'https://www.eurosurveillance.org/rss/content/eurosurveillance/latestarticles?fmt=rss', 'https://www.eurosurveillance.org/', 'rss', 'epidemiologia', 'en', 0.7, false), -- D/M
  ('Your Local Epi', 'https://yourlocalepidemiologist.substack.com/feed', 'https://yourlocalepidemiologist.substack.com/', 'rss', 'epidemiologia', 'en', 0.4, false), -- D/H
  ('Force of Infection', 'https://caitlinrivers.substack.com/feed', 'https://caitlinrivers.substack.com/', 'rss', 'epidemiologia', 'en', 0.5, false), -- A/M
  -- kpi
  ('Nightingale', 'https://nightingaledvs.com/feed/', 'https://nightingaledvs.com/', 'rss', 'kpi', 'en', 0.5, false), -- A/H
  ('Visualising Data', 'https://visualisingdata.com/feed/atom/', 'https://visualisingdata.com/', 'rss', 'kpi', 'en', 0.5, false), -- P/H
  ('FlowingData', 'https://flowingdata.com/feed', 'https://flowingdata.com/', 'rss', 'kpi', 'en', 0.4, false), -- D/H
  ('Storytelling w Data', 'https://www.storytellingwithdata.com/blog?format=rss', 'https://www.storytellingwithdata.com/blog', 'rss', 'kpi', 'en', 0.4, false), -- A/H
  ('Datawrapper blog', 'https://blog.datawrapper.de/feed/', 'https://blog.datawrapper.de/', 'rss', 'kpi', 'en', 0.4, false), -- A/M
  -- qualita_dati
  ('rOpenSci', 'https://ropensci.org/blog/index.xml', 'https://ropensci.org/blog/', 'rss', 'qualita_dati', 'en', 0.5, false), -- P/H
  ('SSI', 'https://www.software.ac.uk/rss', 'https://www.software.ac.uk/', 'rss', 'qualita_dati', 'en', 0.4, false), -- P/M
  -- gdpr
  ('CNIL', 'https://www.cnil.fr/fr/rss.xml', 'https://www.cnil.fr/', 'rss', 'gdpr', 'fr', 0.6, false), -- P/H
  ('EDPS', 'https://www.edps.europa.eu/feed/news_en', 'https://www.edps.europa.eu/', 'rss', 'gdpr', 'en', 0.6, false), -- P/M
  ('TeachPrivacy', 'https://teachprivacy.com/feed/', 'https://teachprivacy.com/', 'rss', 'gdpr', 'en', 0.4, false), -- A/H
  ('Olejnik', 'https://blog.lukaszolejnik.com/rss/', 'https://blog.lukaszolejnik.com/', 'rss', 'gdpr', 'en', 0.4, false), -- A/M
  -- ai_act
  ('AlgorithmWatch', 'https://algorithmwatch.org/en/feed/', 'https://algorithmwatch.org/en/', 'rss', 'ai_act', 'en', 0.5, false), -- D/H
  ('Ada Lovelace Inst', 'https://www.adalovelaceinstitute.org/feed/', 'https://www.adalovelaceinstitute.org/', 'rss', 'ai_act', 'en', 0.5, false), -- P/M
  ('Luiza Jarovsky', 'https://www.luizasnewsletter.com/feed', 'https://www.luizasnewsletter.com/', 'rss', 'ai_act', 'en', 0.4, false), -- D/M
  -- ia
  ('UK AISI', 'https://raw.githubusercontent.com/Olshansk/rss-feeds/main/feeds/feed_aisi.xml', 'https://www.aisi.gov.uk/blog', 'rss', 'ia', 'en', 0.5, false), -- P/V
  ('FAR.AI', 'https://raw.githubusercontent.com/Olshansk/rss-feeds/main/feeds/feed_far_ai.xml', 'https://www.far.ai/research', 'rss', 'ia', 'en', 0.4, false), -- A/V
  ('Hamel Husain', 'https://hamel.dev/index.xml', 'https://hamel.dev/', 'rss', 'ia', 'en', 0.5, false), -- P/H
  ('Eugene Yan', 'https://eugeneyan.com/rss/', 'https://eugeneyan.com/', 'rss', 'ia', 'en', 0.5, false), -- P/H
  ('Latent Space', 'https://www.latent.space/feed', 'https://www.latent.space/', 'rss', 'ia', 'en', 0.4, false), -- D/H
  -- business_analysis
  ('Flux Capacitor', 'https://fluxicon.com/blog/feed.xml', 'https://fluxicon.com/blog/', 'rss', 'business_analysis', 'en', 0.5, false), -- A/M
  -- governance
  ('SRE Weekly', 'https://sreweekly.com/feed/', 'https://sreweekly.com/', 'rss', 'governance', 'en', 0.5, false), -- D/V
  ('charity.wtf', 'https://charity.wtf/feed/', 'https://charity.wtf/', 'rss', 'governance', 'en', 0.5, false), -- P/H
  ('Surfing Complexity', 'https://surfingcomplexity.blog/feed/', 'https://surfingcomplexity.blog/', 'rss', 'governance', 'en', 0.5, false), -- A/H
  -- hardware
  ('APNIC Blog', 'https://blog.apnic.net/feed/', 'https://blog.apnic.net/', 'rss', 'hardware', 'en', 0.5, false), -- D/H
  ('Cloudflare Blog', 'https://blog.cloudflare.com/rss/', 'https://blog.cloudflare.com/', 'rss', 'hardware', 'en', 0.4, false), -- D/H
  ('ODK Forum', 'https://forum.getodk.org/latest.rss', 'https://forum.getodk.org/', 'rss', 'hardware', 'en', 0.3, false), -- P/H
  ('Low-tech Magazine', 'https://solar.lowtechmagazine.com/posts/index.xml', 'https://solar.lowtechmagazine.com/', 'rss', 'hardware', 'en', 0.3, false), -- A/M
  -- sicurezza
  ('Anthropic Red', 'https://raw.githubusercontent.com/Olshansk/rss-feeds/main/feeds/feed_anthropic_red.xml', 'https://red.anthropic.com/', 'rss', 'sicurezza', 'en', 0.5, false), -- P/V
  ('NCSC UK', 'https://www.ncsc.gov.uk/api/1/services/v1/all-rss-feed.xml', 'https://www.ncsc.gov.uk/', 'rss', 'sicurezza', 'en', 0.6, false), -- P/H
  ('SANS ISC', 'https://isc.sans.edu/rssfeed_full.xml', 'https://isc.sans.edu/', 'rss', 'sicurezza', 'en', 0.5, false), -- D/H
  -- meal
  ('ReliefWeb Assess', 'https://reliefweb.int/updates/rss.xml?advanced-search=(F4)', 'https://reliefweb.int/', 'rss', 'meal', 'en', 0.7, false), -- D/M
  ('MERL Tech', 'https://merltech.org/feed/', 'https://merltech.org/', 'rss', 'meal', 'en', 0.5, false), -- P/M
  ('HPN', 'https://odihpn.org/feed/', 'https://odihpn.org/', 'rss', 'meal', 'en', 0.5, false), -- P/M
  -- salute_digitale
  ('ICTworks', 'https://www.ictworks.org/feed/', 'https://www.ictworks.org/', 'rss', 'salute_digitale', 'en', 0.6, false), -- D/V
  ('Health Intersections', 'https://www.healthintersections.com.au/rss.xml', 'https://www.healthintersections.com.au/', 'rss', 'salute_digitale', 'en', 0.5, false), -- P/H
  ('OpenMRS Talk', 'https://talk.openmrs.org/latest.rss', 'https://talk.openmrs.org/', 'rss', 'salute_digitale', 'en', 0.3, false), -- P/H
  ('JMIR', 'https://www.jmir.org/feed/atom', 'https://www.jmir.org/', 'rss', 'salute_digitale', 'en', 0.4, false) -- A/M
on conflict (utente_id, url_feed) do nothing;
