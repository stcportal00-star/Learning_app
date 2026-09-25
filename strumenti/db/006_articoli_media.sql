-- 006 — l'allegato riproducibile di una voce, e quando l'hai visto.
--
-- Un podcast, una conferenza, un video: il feed dichiara già dove sta il file e
-- quanto pesa (`<enclosure>`, `<link rel="enclosure">`, `<media:content>`), e
-- fino a ieri buttavamo via tutte e tre le cose. `strumenti/nuvola/feed.py` ora
-- le legge; qui trovano una colonna dove stare.
--
-- Queste colonne devono esistere PRIMA della corsa di domattina. La finestra di
-- `catalogo.py` è mobile — `setaccia()` scarta come «fuori_finestra» tutto ciò
-- che è più vecchio di `--giorni` — quindi una voce raccolta senza il suo
-- allegato non lo riprende mai più: le fonti non la restituiscono.
alter table percorso.articoli
  add column if not exists url_media text,
  add column if not exists tipo_media text,
  add column if not exists byte_media bigint,
  add column if not exists url_trascrizione text,
  add column if not exists visto_a timestamptz;

comment on column percorso.articoli.url_media is
  'Indirizzo DIRETTO del file audio o video dichiarato dal feed. Il telefono lo '
  'scarica da solo quando è in wifi: non passa da qui e non passa dal deposito, '
  'perché duecento megabyte per voce non stanno né nel piano gratuito né nel '
  'tempo della corsa quotidiana.';

comment on column percorso.articoli.url_trascrizione is
  'La trascrizione che l''autore PUBBLICA (<podcast:transcript>). Non se ne '
  'generano: una trascrizione automatica costa una chiave, una quota e un '
  'servizio che un giorno risponde 429 — e quel giorno si è in aereo.';

comment on column percorso.articoli.visto_a is
  'Quando l''utente l''ha visto o ascoltato. È il segnale con cui il telefono '
  'cancella la copia locale: lo spazio di un telefono è finito, e una cache che '
  'non si svuota da sola smette di essere una cache.';

-- Il percorso del file SUL TELEFONO non sta qui e non ci starà mai: è
-- `file_media` nella tabella locale, accanto a `file_locale` di `biblioteca`, e
-- come quello non genera mai un evento. Su un altro dispositivo non significa
-- niente, e sincronizzarlo vorrebbe dire dire al tablet che ha un file che non
-- ha.
