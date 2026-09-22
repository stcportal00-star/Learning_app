/**
 * Livello dati locale.
 *
 * Regola architetturale: l'app scrive SEMPRE in locale e non attende mai la
 * rete. Supabase è una destinazione di sincronizzazione, non una dipendenza di
 * funzionamento. In aereo tutto continua a funzionare.
 *
 * Il registro `eventi` è append-only ed è la fonte di verità: le tabelle
 * operative sono una proiezione. Fondere due dispositivi significa concatenare
 * i registri e deduplicare per id evento — non esistono conflitti per costruzione.
 */
import * as SQLite from "expo-sqlite";
import { Orologio, serializza, deserializza, HLC } from "./hlc";

let db: SQLite.SQLiteDatabase | null = null;
let orologio: Orologio | null = null;

export const SCHEMA_VERSIONE = 2;

const MIGRAZIONI: string[][] = [
  // v1
  [
    `CREATE TABLE IF NOT EXISTS meta (
       chiave TEXT PRIMARY KEY, valore TEXT NOT NULL);`,

    `CREATE TABLE IF NOT EXISTS eventi (
       id TEXT PRIMARY KEY,
       hlc TEXT NOT NULL,
       dispositivo TEXT NOT NULL,
       entita TEXT NOT NULL,
       entita_id TEXT NOT NULL,
       tipo TEXT NOT NULL CHECK (tipo IN ('crea','aggiorna','elimina')),
       payload TEXT NOT NULL DEFAULT '{}',
       sincronizzato INTEGER NOT NULL DEFAULT 0);`,
    `CREATE INDEX IF NOT EXISTS eventi_hlc_idx ON eventi (hlc);`,
    `CREATE INDEX IF NOT EXISTS eventi_da_sincronizzare ON eventi (sincronizzato, hlc);`,

    `CREATE TABLE IF NOT EXISTS temi (
       id TEXT PRIMARY KEY, slug TEXT UNIQUE NOT NULL, nome TEXT NOT NULL,
       pista TEXT NOT NULL, trimestre TEXT, attivo INTEGER NOT NULL DEFAULT 1);`,

    `CREATE TABLE IF NOT EXISTS esercizi (
       id TEXT PRIMARY KEY, tema_slug TEXT, tipo TEXT NOT NULL, livello INTEGER NOT NULL,
       consegna TEXT NOT NULL, dataset TEXT, soluzione_riferimento TEXT,
       preparazione TEXT, rubrica TEXT, fonte_citazione TEXT,
       righe_attese INTEGER, colonne_attese TEXT, ordine_rilevante INTEGER NOT NULL DEFAULT 0);`,
    `CREATE INDEX IF NOT EXISTS esercizi_tema_idx ON esercizi (tema_slug, livello);`,

    `CREATE TABLE IF NOT EXISTS tentativi (
       id TEXT PRIMARY KEY, esercizio_id TEXT NOT NULL, risposta TEXT,
       esito TEXT NOT NULL, motivo TEXT, durata_sec INTEGER,
       eseguito_a TEXT NOT NULL, hlc TEXT NOT NULL);`,
    `CREATE INDEX IF NOT EXISTS tentativi_esercizio_idx ON tentativi (esercizio_id, eseguito_a DESC);`,

    `CREATE TABLE IF NOT EXISTS ripasso (
       esercizio_id TEXT PRIMARY KEY, stabilita REAL NOT NULL DEFAULT 0,
       difficolta REAL NOT NULL DEFAULT 5, ripetizioni INTEGER NOT NULL DEFAULT 0,
       ultima_revisione TEXT, prossima_revisione TEXT NOT NULL,
       stato TEXT NOT NULL DEFAULT 'nuovo');`,
    `CREATE INDEX IF NOT EXISTS ripasso_prossima_idx ON ripasso (prossima_revisione);`,

    `CREATE TABLE IF NOT EXISTS sessioni (
       id TEXT PRIMARY KEY, tema_slug TEXT, tipo TEXT NOT NULL,
       inizio TEXT NOT NULL, minuti INTEGER NOT NULL, note TEXT, hlc TEXT NOT NULL);`,
    `CREATE INDEX IF NOT EXISTS sessioni_inizio_idx ON sessioni (inizio DESC);`,

    `CREATE TABLE IF NOT EXISTS note (
       id TEXT PRIMARY KEY, tema_slug TEXT, titolo TEXT, testo TEXT NOT NULL DEFAULT '',
       pubblicabile INTEGER NOT NULL DEFAULT 0, origine_url TEXT,
       creato_a TEXT NOT NULL, hlc TEXT NOT NULL);`,

    `CREATE TABLE IF NOT EXISTS artefatti (
       id TEXT PRIMARY KEY, titolo TEXT NOT NULL, trimestre TEXT,
       stato TEXT NOT NULL DEFAULT 'pianificato', descrizione TEXT, url TEXT, hlc TEXT);`,

    `CREATE TABLE IF NOT EXISTS credenziali (
       id TEXT PRIMARY KEY, nome TEXT NOT NULL, ente TEXT NOT NULL,
       costo_usd REAL DEFAULT 0, stato TEXT NOT NULL DEFAULT 'pianificata',
       data_esame TEXT, url_badge TEXT, scadenza TEXT, anno_previsto INTEGER, hlc TEXT);`,

    `CREATE TABLE IF NOT EXISTS pubblicazioni (
       id TEXT PRIMARY KEY, titolo TEXT NOT NULL, tipo TEXT NOT NULL,
       stato TEXT NOT NULL DEFAULT 'bozza', url TEXT, data_pubblicazione TEXT, hlc TEXT);`,

    `CREATE TABLE IF NOT EXISTS biblioteca (
       id TEXT PRIMARY KEY, titolo TEXT NOT NULL, autore TEXT,
       tema_slug TEXT, trimestre TEXT,
       origine TEXT NOT NULL DEFAULT 'aperta' CHECK (origine IN ('aperta','manuale')),
       licenza TEXT, url TEXT, file_locale TEXT, formato TEXT DEFAULT 'pdf',
       byte INTEGER, sha256 TEXT, pagine INTEGER, ultima_pagina INTEGER DEFAULT 0,
       aggiunto_a TEXT NOT NULL, hlc TEXT);`,
    `CREATE INDEX IF NOT EXISTS biblioteca_trim_idx ON biblioteca (trimestre, tema_slug);`,
  ],
  // v2 — ciò che arriva dalla nuvola, e i segni che si lasciano sopra.
  //
  // Tre aggiunte, tutte per lo stesso motivo: la rassegna quotidiana gira su
  // GitHub, deposita su Supabase, e da lì l'app deve poter leggere SENZA RETE.
  // Un articolo che si può solo aprire nel browser non è studiabile in metro.
  [
    // `articoli` tiene il TESTO, non il collegamento. È la differenza fra
    // "ho un elenco di cose da leggere" e "ho da leggere".
    `CREATE TABLE IF NOT EXISTS articoli (
       id TEXT PRIMARY KEY,
       titolo TEXT NOT NULL,
       autori TEXT, fonte TEXT, url TEXT, url_pdf TEXT,
       abstract TEXT, testo TEXT,
       tema_slug TEXT, trimestre TEXT, licenza TEXT,
       pubblicato_a TEXT, raccolto_a TEXT NOT NULL,
       letto INTEGER NOT NULL DEFAULT 0,
       salvato INTEGER NOT NULL DEFAULT 0,
       hlc TEXT);`,
    `CREATE INDEX IF NOT EXISTS articoli_raccolto_idx ON articoli (raccolto_a DESC);`,
    `CREATE INDEX IF NOT EXISTS articoli_tema_idx ON articoli (tema_slug, letto);`,

    // I segni stanno ACCANTO al file, mai dentro. Un'annotazione scritta
    // dentro il PDF cambia i byte: l'impronta non torna più, il volume non si
    // può riscaricare senza perdere il lavoro, e due dispositivi che segnano
    // lo stesso testo producono due file diversi impossibili da fondere.
    // Fuori, invece, un segno è un evento come gli altri e si fonde da sé.
    `CREATE TABLE IF NOT EXISTS segni (
       id TEXT PRIMARY KEY,
       volume_id TEXT NOT NULL,
       genere TEXT NOT NULL CHECK (genere IN ('nota','evidenza','segnalibro')),
       pagina INTEGER, ancora TEXT,
       testo TEXT NOT NULL DEFAULT '',
       creato_a TEXT NOT NULL, hlc TEXT);`,
    `CREATE INDEX IF NOT EXISTS segni_volume_idx ON segni (volume_id, pagina);`,

    // `codice` è la chiave stabile con cui la conduttura riconosce un volume
    // già pubblicato; `pdf_path` è dove stanno i byte nel deposito remoto.
    // `file_locale` resta una faccenda del telefono e non viaggia mai.
    `ALTER TABLE biblioteca ADD COLUMN codice TEXT;`,
    `ALTER TABLE biblioteca ADD COLUMN pdf_path TEXT;`,
    `ALTER TABLE biblioteca ADD COLUMN nota TEXT;`,
    `CREATE INDEX IF NOT EXISTS biblioteca_codice_idx ON biblioteca (codice);`,

    // La proiezione degli eventi ricevuti ricostruisce un'entità alla volta
    // leggendo tutti i suoi eventi. Senza questo indice è una scansione
    // dell'intero registro per ogni entità toccata: con qualche migliaio di
    // eventi e una rassegna che ne porta cento al giorno diventa quadratica.
    `CREATE INDEX IF NOT EXISTS eventi_entita_idx ON eventi (entita, entita_id, hlc);`,
  ],
];

export async function apri(dispositivoId: string): Promise<SQLite.SQLiteDatabase> {
  if (db) return db;
  db = await SQLite.openDatabaseAsync("percorso.db");
  await db.execAsync("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;");

  const riga = await db.getFirstAsync<{ user_version: number }>("PRAGMA user_version");
  const versione = riga?.user_version ?? 0;

  for (let v = versione; v < MIGRAZIONI.length; v++) {
    for (const istruzione of MIGRAZIONI[v]) {
      try {
        await db.execAsync(istruzione);
      } catch (e) {
        // SQLite non conosce «ADD COLUMN IF NOT EXISTS», e ogni altra
        // istruzione qui sopra è ripetibile. Una migrazione rieseguita su un
        // database che ha già la colonna — user_version azzerata da un
        // ripristino, un declassamento seguito da un aggiornamento — deve
        // poter proseguire, altrimenti l'app non si apre più e sul telefono
        // non c'è modo di ripararla.
        //
        // Si ingoia SOLO questo errore e SOLO su un ADD COLUMN: qualunque
        // altro guasto dello schema deve fermare l'avvio, perché andare avanti
        // su uno schema incompleto è peggio che non partire.
        if (
          !/duplicate column name/i.test(String(e)) ||
          !/ADD\s+COLUMN/i.test(istruzione)
        ) {
          throw e;
        }
      }
    }
  }
  if (versione < MIGRAZIONI.length) {
    await db.execAsync(`PRAGMA user_version = ${MIGRAZIONI.length}`);
  }

  const salvato = await db.getFirstAsync<{ valore: string }>(
    "SELECT valore FROM meta WHERE chiave = 'hlc'"
  );
  orologio = new Orologio(dispositivoId);
  if (salvato) {
    const [ms, cont] = salvato.valore.split("-");
    orologio = new Orologio(dispositivoId, {
      ms: parseInt(ms, 16),
      contatore: parseInt(cont, 16),
      dispositivo: dispositivoId,
    });
  }
  return db;
}

function richiediDb(): SQLite.SQLiteDatabase {
  if (!db) throw new Error("Database non aperto: chiamare apri() all'avvio.");
  return db;
}

export function timbro(): HLC {
  if (!orologio) throw new Error("Orologio non inizializzato.");
  return orologio.adesso();
}

export function derivaSospetta(): boolean {
  return orologio?.derivaSospetta ?? false;
}

/**
 * Registra un evento e applica la proiezione nella stessa transazione.
 * Nessuna scrittura passa per un'altra strada: è ciò che rende la
 * sincronizzazione una semplice concatenazione di registri.
 */
/**
 * Coda delle scritture. Una sola transazione per volta, in ordine di arrivo.
 *
 * Senza, due registra() che si accavallano rompono l'invariante 1 e lo fanno
 * in silenzio. Misurato: A apre la transazione; il BEGIN di B fallisce con
 * "cannot start a transaction within a transaction"; il ROLLBACK di B annulla
 * l'INSERT dell'evento di A, che intanto prosegue e scrive la proiezione in
 * autocommit. Sul disco resta la riga operativa SENZA il suo evento: non
 * raggiungerà mai l'altro dispositivo e sparirebbe da una ricostruzione dal
 * registro.
 *
 * Non è un caso di laboratorio. Due tocchi su Salva in Note bastano
 * (app/(tabs)/note.tsx non ha la guardia che app/esercizi.tsx ha), e lo stesso
 * accade quando la sincronizzazione applica un pacchetto mentre l'utente
 * scrive. Il ponte nativo non protegge: expo-sqlite su Android gira in
 * CoroutineScope(Dispatchers.IO) e non ha nessun lock per database, quindi
 * l'accavallamento sul dispositivo è più probabile che qui, non meno.
 *
 * La guardia sta qui e non nei bottoni perché l'invariante è del registro:
 * ogni chiamante nuovo la eredita senza doversela ricordare.
 *
 * IL PREZZO, e va letto prima di scrivere il decimo punto di scrittura.
 * Una `registra()` (o `inTransazione()`) chiamata DENTRO la proiezione di
 * un'altra non fallisce: si ferma. Si mette in coda dietro quella che la
 * contiene, e quella sta aspettando proprio lei. Nessuna delle due finisce,
 * la transazione esterna resta aperta e da quel momento l'app non scrive più
 * niente — senza un errore e senza un messaggio. Prima della coda lo stesso
 * annidamento falliva subito ("cannot rollback - no transaction is active").
 * Non è distinguibile qui dentro: una scrittura annidata e una scrittura
 * legittima partita altrove mentre questa è in corso hanno la stessa forma, e
 * la seconda DEVE aspettare. Quindi non c'è una guardia da aggiungere, c'è una
 * regola da rispettare: la proiezione scrive con la connessione che riceve,
 * e non apre mai una scrittura nuova. Oggi nessuno dei punti di scrittura
 * annida, e `test/banco/prova-registro.mjs` (E2 ed E3) lo verifica a ogni
 * `npm run verifica`.
 *
 * E deve coprire OGNI transazione su questo database, non solo registra():
 * basta che una scrittura passi da un'altra strada — la sincronizzazione che
 * applica un pacchetto, il caricamento dei contenuti al primo avvio — perché
 * l'accavallamento torni possibile. Per questo `inTransazione` è esportata: è
 * l'unico modo consentito di aprire una transazione qui dentro.
 */
let codaScritture: Promise<unknown> = Promise.resolve();

function inCoda<T>(compito: () => Promise<T>): Promise<T> {
  // Il .catch() tiene la catena viva: senza, una scrittura fallita
  // bloccherebbe per sempre tutte quelle dopo.
  const mio = codaScritture.then(compito, compito);
  codaScritture = mio.catch(() => undefined);
  return mio;
}

/**
 * Una transazione, in coda dietro tutte le altre. Da usare al posto di
 * `db.withTransactionAsync()` ovunque: due transazioni aperte insieme sulla
 * stessa connessione non si annidano, si danneggiano.
 */
export function inTransazione(
  compito: (d: SQLite.SQLiteDatabase) => Promise<void>
): Promise<void> {
  const d = richiediDb();
  return inCoda(() => d.withTransactionAsync(() => compito(d)));
}

export async function registra(
  entita: string,
  entitaId: string,
  tipo: "crea" | "aggiorna" | "elimina",
  payload: Record<string, unknown>,
  proiezione: (d: SQLite.SQLiteDatabase, hlc: string) => Promise<void>
): Promise<string> {
  return inCoda(() => scriviEvento(entita, entitaId, tipo, payload, proiezione));
}

async function scriviEvento(
  entita: string,
  entitaId: string,
  tipo: "crea" | "aggiorna" | "elimina",
  payload: Record<string, unknown>,
  proiezione: (d: SQLite.SQLiteDatabase, hlc: string) => Promise<void>
): Promise<string> {
  const d = richiediDb();
  // Il timbro si prende DENTRO la coda: prenderlo fuori darebbe a due scritture
  // in attesa due timbri nell'ordine sbagliato rispetto a come verranno scritte.
  const h = timbro();
  const hlc = serializza(h);
  await d.withTransactionAsync(async () => {
    await d.runAsync(
      `INSERT INTO eventi (id, hlc, dispositivo, entita, entita_id, tipo, payload)
       VALUES (?,?,?,?,?,?,?)`,
      [hlc + ":" + entitaId, hlc, h.dispositivo, entita, entitaId, tipo, JSON.stringify(payload)]
    );
    await proiezione(d, hlc);
    await d.runAsync(
      `INSERT INTO meta (chiave, valore) VALUES ('hlc', ?)
       ON CONFLICT (chiave) DO UPDATE SET valore = excluded.valore`,
      [h.ms.toString(16) + "-" + h.contatore.toString(16)]
    );
  });
  return hlc;
}

/**
 * Assorbe il tempo di un pacchetto ricevuto (invariante 2).
 *
 * Senza questo passo l'orologio locale non sa niente dell'ora dell'altro
 * dispositivo: il primo evento scritto qui DOPO una fusione nasce con un HLC
 * più basso di quello appena ricevuto e perde ogni confronto «vince il più
 * recente» pur essendo successivo. Con i due dispositivi su fusi diversi — il
 * caso per cui l'HLC esiste — è il modo silenzioso di perdere una modifica.
 * `Orologio.ricevi()` c'era già, collaudato, e non lo chiamava nessuno.
 *
 * Tre cautele:
 *   - la scrittura di meta('hlc') passa dalla coda come tutte le altre: fuori
 *     riaprirebbe l'accavallamento che inTransazione() ha chiuso;
 *   - un hlc illeggibile viene SALTATO, non assorbito: un NaN entrerebbe
 *     nell'orologio e da lì non uscirebbe più, guastando ogni timbro futuro;
 *   - si assorbono tutti gli hlc ricevuti, duplicati compresi: il tempo
 *     dell'altro dispositivo è informazione anche quando l'evento è già noto.
 */
export async function assorbiRemoto(hlcRemoti: string[]): Promise<HLC | null> {
  if (!orologio || !hlcRemoti.length) return null;
  let assorbito: HLC | null = null;
  for (const grezzo of hlcRemoti) {
    const remoto = deserializza(grezzo);
    if (!Number.isFinite(remoto.ms) || !Number.isFinite(remoto.contatore)) continue;
    assorbito = orologio.ricevi(remoto);
  }
  if (!assorbito) return null;

  const stato = assorbito;
  await inTransazione(async (d) => {
    await d.runAsync(
      `INSERT INTO meta (chiave, valore) VALUES ('hlc', ?)
       ON CONFLICT (chiave) DO UPDATE SET valore = excluded.valore`,
      [stato.ms.toString(16) + "-" + stato.contatore.toString(16)]
    );
  });
  return stato;
}

/** Eventi non ancora inviati, in ordine causale. Usato dai tre trasporti di sync. */
export async function daSincronizzare(limite = 500) {
  return richiediDb().getAllAsync<{
    id: string; hlc: string; dispositivo: string; entita: string;
    entita_id: string; tipo: string; payload: string;
  }>(
    `SELECT id, hlc, dispositivo, entita, entita_id, tipo, payload
     FROM eventi WHERE sincronizzato = 0 ORDER BY hlc LIMIT ?`,
    [limite]
  );
}

export async function segnaSincronizzati(ids: string[]) {
  if (!ids.length) return;
  const segnaposto = ids.map(() => "?").join(",");
  await richiediDb().runAsync(
    `UPDATE eventi SET sincronizzato = 1 WHERE id IN (${segnaposto})`,
    ids
  );
}

export function database() {
  return richiediDb();
}
