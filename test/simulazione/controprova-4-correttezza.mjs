/**
 * Controprova avversariale del difetto "DNS-DDL": «DDL nel campo risposta:
 * CREATE TABLE e DROP TABLE vengono eseguiti sulla palestra»
 * (accusa a lib/palestra.ts, esegui(), invariante 4).
 *
 * L'accusa dice tre cose, e qui si prova a farle succedere UNA PER UNA sul
 * codice VERO (lib/palestra.ts e lib/verifica.ts caricati dal banco, SQLite
 * vero, contenuti veri di assets/contenuti/esercizi_sql.json):
 *   1. `esegui("CREATE TABLE zzz_intrusa (x INTEGER)")` crea la tabella;
 *   2. `esegui("DROP TABLE valutazioni")` la fa sparire;
 *   3. da lì in poi verifica() accusa il contenuto con
 *      «La soluzione di riferimento non è eseguibile su questo dispositivo».
 * E aggiunge una via d'accesso: l'utente ricopia nel campo risposta il
 * CREATE INDEX che la schermata gli MOSTRA (app/esercizi.tsx:100-105).
 *
 * Il verdetto non si legge nella testa del doppio: si legge sul DISCO, con una
 * seconda connessione in sola lettura al file .db e con l'md5 del file.
 *
 *   node test/simulazione/controprova-4-correttezza.mjs
 *
 * (il file si riavvia da solo con --import ./test/banco/carica.mjs e con
 * BANCO_DOPPI già composta: stessa ricetta di test/simulazione/motore-sql.mjs)
 */
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { DatabaseSync } from "node:sqlite";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { variabileBanco } from "../banco/doppi-altri.mjs";

const QUESTA_CARTELLA = dirname(fileURLToPath(import.meta.url));
const RADICE_PROGETTO = resolve(QUESTA_CARTELLA, "..", "..");
const ASSET_PALESTRA = join(RADICE_PROGETTO, "assets/contenuti/palestra.db");
const ESERCIZI = JSON.parse(
  readFileSync(join(RADICE_PROGETTO, "assets/contenuti/esercizi_sql.json"), "utf8")
);

// --------------------------------------------------------- RIAVVIO CON I GANCI
if (!process.env.CONTROPROVA_4_IN_CORSO) {
  const esito = spawnSync(
    process.execPath,
    ["--import", "./test/banco/carica.mjs", "test/simulazione/controprova-4-correttezza.mjs"],
    {
      cwd: RADICE_PROGETTO,
      stdio: "inherit",
      env: { ...process.env, CONTROPROVA_4_IN_CORSO: "1", BANCO_DOPPI: variabileBanco() },
    }
  );
  process.exit(esito.status ?? 1);
}

let passati = 0;
const falliti = [];
const ok = (nome, condizione, extra = "") =>
  condizione ? passati++ : falliti.push(`${nome}${extra ? " — " + extra : ""}`);

/** L'accusa dev'essere misurata, non subita: l'errore diventa un dato. */
async function tenta(azione) {
  try {
    return { riuscito: true, valore: await azione() };
  } catch (errore) {
    return { riuscito: false, errore: String(errore?.message ?? errore) };
  }
}

const md5Di = (percorso) => createHash("md5").update(readFileSync(percorso)).digest("hex");

// ------------------------------------------------------------- PREPARAZIONE
import * as FS from "../banco/expo-file-system.mjs";
import { configuraCartella } from "../banco/expo-sqlite.mjs";
import { installaRequireMetro } from "../banco/require-metro.mjs";

const radice = FS.configuraRadice(mkdtempSync(join(tmpdir(), "controprova-4-")));
const cartellaSqlite = configuraCartella(join(FS.percorsoDocumenti(), "SQLite"));
installaRequireMetro(RADICE_PROGETTO);
rmSync(cartellaSqlite, { recursive: true, force: true }); // primo avvio assoluto

const palestra = await import("../../lib/palestra.ts");
const V = await import("../../lib/verifica.ts");

// app/_layout.tsx:27 apre la palestra e ASPETTA prima di montare le schermate:
// qui si riproduce quell'ordine, perché è l'unico stato in cui esegui() gira.
await palestra.apriPalestra();
const fileDb = join(cartellaSqlite, "palestra.db");
const md5Prima = md5Di(fileDb);

/** Sguardo da fuori: una connessione indipendente, in sola lettura, al file. */
const daDisco = (sql) => {
  const q = new DatabaseSync(fileDb, { readOnly: true });
  try {
    return q.prepare(sql).all();
  } finally {
    q.close();
  }
};
/**
 * Come daDisco(), ma restituisce `null` invece di lanciare: se un giorno il DDL
 * passasse davvero, la tabella non ci sarebbe più e questa prova deve diventare
 * ROSSA in modo leggibile, non morire con "no such table".
 */
const daDiscoSicuro = (sql) => {
  try {
    return daDisco(sql);
  } catch {
    return null;
  }
};
const schemaPrima = JSON.stringify(daDisco("SELECT type, name FROM sqlite_master ORDER BY type, name"));

// ============================ 1. L'ACCUSA ALLA LETTERA: CREATE TABLE zzz_intrusa
const create = await tenta(() => palestra.esegui("CREATE TABLE zzz_intrusa (x INTEGER)"));
ok("1a CREATE TABLE dal campo risposta NON viene eseguito: SQLite lo respinge",
  create.riuscito === false, JSON.stringify(create));
ok("1b ...e il motivo è la sola lettura della connessione, non un errore di sintassi",
  /readonly/i.test(String(create.errore)), String(create.errore));
ok("1c zzz_intrusa non compare in sqlite_master letto DA FUORI",
  daDisco("SELECT count(*) AS n FROM sqlite_master WHERE name = 'zzz_intrusa'")[0].n === 0);

// ============================== 2. L'ACCUSA ALLA LETTERA: DROP TABLE valutazioni
const drop = await tenta(() => palestra.esegui("DROP TABLE valutazioni"));
ok("2a DROP TABLE dal campo risposta viene respinto", drop.riuscito === false, JSON.stringify(drop));
ok("2b ...con lo stesso motivo di sola lettura", /readonly/i.test(String(drop.errore)));
ok("2c valutazioni è ancora nello schema sul disco",
  daDisco("SELECT count(*) AS n FROM sqlite_master WHERE name = 'valutazioni'")[0].n === 1);
const righeValutazioni = daDiscoSicuro("SELECT count(*) AS n FROM valutazioni");
ok("2d la tabella ha ancora le sue righe",
  righeValutazioni !== null && righeValutazioni[0].n > 0,
  JSON.stringify(righeValutazioni));

// =============== 3. LA CONSEGUENZA ACCUSATA: verifica() che accusa il contenuto
// SQL-014 è un esercizio VERO che gira su valutazioni: se il DROP fosse passato,
// qui si leggerebbe «La soluzione di riferimento non è eseguibile...».
const sql014 = ESERCIZI.find((e) => e.id === "SQL-014");
const esito014 = await V.verifica(palestra.esegui, sql014.soluzione, sql014.soluzione);
ok("3a l'esercizio SQL-014 su valutazioni resta risolvibile dopo i due tentativi di DDL",
  esito014.corretto === true && esito014.motivo === "identico", JSON.stringify(esito014));
ok("3b nessun 'La soluzione di riferimento non è eseguibile su questo dispositivo'",
  !String(esito014.dettaglio).includes("non è eseguibile"), esito014.dettaglio);

// Anche una risposta giusta ma scritta diversamente (invariante 3) continua a passare.
const esito014bis = await V.verifica(
  palestra.esegui,
  "SELECT count(1) AS non_completate FROM valutazioni WHERE NOT completata",
  sql014.soluzione
);
ok("3c ...e una soluzione equivalente scritta diversamente passa ancora",
  esito014bis.corretto === true, JSON.stringify(esito014bis));

// ================== 4. LA VIA D'ACCESSO ACCUSATA: il CREATE INDEX che si VEDE
// app/esercizi.tsx mostra la preparazione di SQL-088. L'accusa dice che un
// utente la ricopia nel campo risposta di uno dei 143 esercizi SENZA
// preparazione e la scrive nella palestra vera. Si rifà esattamente quello.
const sql088 = ESERCIZI.find((e) => e.id === "SQL-088");
const sql001 = ESERCIZI.find((e) => e.id === "SQL-001");
const esitoIndice = await V.verifica(palestra.esegui, sql088.preparazione, sql001.soluzione, {
  ordineRilevante: true,
});
ok("4a il CREATE INDEX ricopiato nel campo risposta finisce in errore_sql",
  esitoIndice.motivo === "errore_sql", JSON.stringify(esitoIndice));
ok("4b ...accusando la RISPOSTA dell'utente, non il contenuto dell'esercizio",
  esitoIndice.dettaglio === "La query non viene eseguita." &&
    /readonly/i.test(String(esitoIndice.errore)),
  JSON.stringify(esitoIndice));
ok("4c l'indice idx_visite_operatore non esiste nella palestra vera",
  daDisco("SELECT count(*) AS n FROM sqlite_master WHERE name = 'idx_visite_operatore'")[0].n === 0);

// La stessa preparazione per la via LEGITTIMA (SQL-088 ha preparazione): copia
// usa-e-getta, come fa app/esercizi.tsx:50-52. La palestra vera non la vede.
const esecutorePreparato = (sql) => palestra.eseguiConPreparazione(sql088.preparazione, sql);
const esito088 = await V.verifica(esecutorePreparato, sql088.soluzione, sql088.soluzione, {
  ordineRilevante: true,
});
ok("4d l'esercizio con preparazione funziona lo stesso, sulla copia temporanea",
  esito088.corretto === true, JSON.stringify(esito088));
ok("4e ...e l'indice della preparazione NON è finito nella palestra vera",
  daDisco("SELECT count(*) AS n FROM sqlite_master WHERE name = 'idx_visite_operatore'")[0].n === 0);
ok("4f nessuna copia temporanea lasciata indietro",
  readdirSync(cartellaSqlite).filter((n) => n.startsWith("palestra_tmp_")).length === 0,
  JSON.stringify(readdirSync(cartellaSqlite)));

// ============================================ 5. IL FILE, DOPO TUTTI I TENTATIVI
ok("5a lo schema sul disco è identico a prima",
  JSON.stringify(daDisco("SELECT type, name FROM sqlite_master ORDER BY type, name")) === schemaPrima);
ok("5b palestra.db è identico byte per byte a prima dei tentativi di DDL",
  md5Di(fileDb) === md5Prima);
ok("5c ...e identico all'asset del repository",
  md5Di(fileDb) === md5Di(ASSET_PALESTRA));

// ========================= 6. DA DOVE VIENE LA PROTEZIONE (e come farla cadere)
// Non è un filtro sul testo della query (violerebbe l'invariante 3): è il
// PRAGMA della riga 47 di lib/palestra.ts. Si rilegge lo stato dalla
// connessione viva, così la prova dice ANCHE perché il difetto non c'è.
const statoPragma = await palestra.esegui("PRAGMA query_only");
ok("6a la connessione memorizzata ha query_only = 1",
  statoPragma.righe[0][0] === 1, JSON.stringify(statoPragma.righe));
ok("6b una SELECT normale continua a funzionare: non è un divieto generico",
  (await palestra.esegui("SELECT count(*) AS n FROM visite")).righe[0][0] > 0);

// ============================================================ ESITO
console.log(`\ncontroprova 4 — DDL nel campo risposta, SQLite ${palestra.versioneMotore()}`);
for (const f of falliti) console.log(`  FALLITO: ${f}`);
console.log(`\npassati ${passati} su ${passati + falliti.length}`);
if (falliti.length) {
  console.log(`radice di prova NON cancellata: ${radice}`);
  process.exit(1);
}
if (existsSync(radice)) rmSync(radice, { recursive: true, force: true });
process.exit(0);
