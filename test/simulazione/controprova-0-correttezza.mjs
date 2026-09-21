/**
 * CONTROPROVA AVVERSARIALE del difetto "palestra.db non e' in sola lettura".
 *
 * Non sto cercando di confermare il difetto: sto cercando il modo di smontarlo.
 * Le tre vie di smontaggio possibili erano:
 *   1. esiste da qualche parte un filtro sul testo della risposta (non esiste:
 *      app/esercizi.tsx:53 passa `risposta` grezza a verifica(), che la passa
 *      grezza a esegui());
 *   2. getAllAsync() non esegue davvero una UPDATE, la prepara e basta
 *      (falso anche sul telefono: vedi la nota NATIVO qui sotto);
 *   3. e' il banco a divergere dal modulo vero (escluso leggendo il Kotlin).
 * Restava da misurare la via reale, ed e' quello che fa questo file.
 *
 * Si esegue dalla radice del progetto, senza argomenti:
 *
 *   node test/simulazione/controprova-0-correttezza.mjs
 *
 * Si riavvia da solo con i ganci del banco (stesso schema di motore-sql.mjs).
 *
 * NATIVO — perche' il verdetto non dipende dal banco. In expo-sqlite 16 la
 * catena e' getAllAsync(sql) -> prepareAsync -> SQLiteStatement.executeAsync
 * -> NativeStatement.runAsync, e su Android quest'ultima e'
 * node_modules/expo-sqlite/android/src/main/java/expo/modules/sqlite/SQLiteModule.kt:415,
 * che chiama sqlite3_step() e poi restituisce lastInsertRowId e changes.
 * Una UPDATE/DELETE si completa in quell'unico step: e' ESEGUITA, non solo
 * preparata. E il database e' aperto con sqlite3_open(dbPath) nudo
 * (SQLiteModule.kt:126), cioe' READWRITE|CREATE: nessun flag di sola lettura.
 *
 * DISTRUTTIVO per la COPIA temporanea di palestra.db, mai per l'asset del
 * progetto: la sezione 4 verifica l'md5 di assets/contenuti/palestra.db prima
 * e dopo. La radice temporanea resta sul disco se qualcosa fallisce.
 */
import { spawnSync } from "node:child_process";
import { DatabaseSync } from "node:sqlite";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { variabileBanco } from "../banco/doppi-altri.mjs";

const QUESTA_CARTELLA = dirname(fileURLToPath(import.meta.url));
const RADICE_PROGETTO = resolve(QUESTA_CARTELLA, "..", "..");
const ASSET_PALESTRA = join(RADICE_PROGETTO, "assets/contenuti/palestra.db");

if (!process.env.CONTROPROVA_IN_CORSO) {
  const esito = spawnSync(
    process.execPath,
    ["--import", "./test/banco/carica.mjs", "test/simulazione/controprova-0-correttezza.mjs"],
    {
      cwd: RADICE_PROGETTO,
      stdio: "inherit",
      env: { ...process.env, CONTROPROVA_IN_CORSO: "1", BANCO_DOPPI: variabileBanco() },
    }
  );
  process.exit(esito.status ?? 1);
}

let passati = 0;
const falliti = [];
function ok(nome, condizione, extra = "") {
  if (condizione) { passati++; console.log(`  ok   ${nome}`); }
  else { falliti.push(`${nome}${extra ? " — " + extra : ""}`); console.log(`  NO   ${nome} ${extra}`); }
}

const md5Di = (percorso) => createHash("md5").update(readFileSync(percorso)).digest("hex");

// ------------------------------------------------------------- PREPARAZIONE
import * as FS from "../banco/expo-file-system.mjs";
import { configuraCartella } from "../banco/expo-sqlite.mjs";
import { installaRequireMetro } from "../banco/require-metro.mjs";

const radice = FS.configuraRadice(mkdtempSync(join(tmpdir(), "controprova-0-")));
const cartellaSqlite = configuraCartella(join(FS.percorsoDocumenti(), "SQLite"));
installaRequireMetro(RADICE_PROGETTO);
rmSync(cartellaSqlite, { recursive: true, force: true });

const md5AssetPrima = md5Di(ASSET_PALESTRA);

const palestra = await import("../../lib/palestra.ts");
const V = await import("../../lib/verifica.ts");

// ============================================ 1. LA VIA REALE DELLA SCHERMATA
// app/esercizi.tsx:47-56: l'utente scrive nel campo, preme "Esegui e verifica",
// e per i 143 esercizi senza preparazione l'esecutore e' `esegui` nudo.
await palestra.apriPalestra();
const copia = join(cartellaSqlite, "palestra.db");
const md5Prima = md5Di(copia);
const nomePrima = (await palestra.esegui("SELECT nome FROM strutture WHERE id = 1")).righe[0][0];
const visitePrima = (await palestra.esegui("SELECT count(*) FROM visite")).righe[0][0];
console.log(`\n1. stato di partenza: nome=${nomePrima} visite=${visitePrima} md5=${md5Prima.slice(0, 12)}`);

// Un esercizio vero fra i 143 senza preparazione, scelto come "soluzione di
// riferimento" perche' e' quello che l'utente vedrebbe cambiare sotto i piedi.
const RIFERIMENTO = "SELECT count(*) AS n FROM visite";
const attesoPrima = (await palestra.esegui(RIFERIMENTO)).righe[0][0];

// L'utente scrive una scrittura al posto di una SELECT e preme il bottone.
const esito = await V.verifica(
  palestra.esegui,
  "UPDATE strutture SET nome = 'RUBATA' WHERE id = 1",
  RIFERIMENTO,
  { ordineRilevante: false }
);
console.log(`   verifica() dice: corretto=${esito.corretto} motivo=${esito.motivo}`);

const nomeDopo = (await palestra.esegui("SELECT nome FROM strutture WHERE id = 1")).righe[0][0];
ok("1a la UPDATE scritta nel campo risposta e' stata ESEGUITA sul database vero",
  nomePrima !== nomeDopo && nomeDopo === "RUBATA", `nome ora = ${nomeDopo}`);
ok("1b la schermata la annuncia solo come risposta sbagliata, senza dire che ha scritto",
  esito.corretto === false && esito.motivo !== "errore_sql", `motivo = ${esito.motivo}`);

// Seconda scrittura, stessa via: la DELETE.
await V.verifica(palestra.esegui, "DELETE FROM visite WHERE id <= 100", RIFERIMENTO, {});
const visiteDopo = (await palestra.esegui("SELECT count(*) FROM visite")).righe[0][0];
ok("1c la DELETE ha tolto 100 righe dalla palestra",
  visiteDopo === visitePrima - 100, `${visitePrima} -> ${visiteDopo}`);

// La via realistica non e' la malizia ma la curiosita': gli esercizi SQL-088..102
// parlano di indici e la schermata MOSTRA il testo della loro preparazione
// ("Preparazione gia' applicata", app/esercizi.tsx:100-104). Chi lo ricopia nel
// campo risposta di un esercizio SENZA preparazione scrive nella palestra vera.
await V.verifica(palestra.esegui, "CREATE INDEX idx_curioso ON visite(operatore)", RIFERIMENTO, {});
const indici = await palestra.esegui(
  "SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'idx_curioso'"
);
ok("1d anche un CREATE INDEX copiato dalla consegna resta scritto nella palestra",
  indici.righe.length === 1);

// ================================================ 2. IL DANNO E' SUL DISCO
const md5Dopo = md5Di(copia);
ok("2a il FILE palestra.db e' cambiato (non e' solo la cache in memoria)",
  md5Prima !== md5Dopo, `${md5Prima.slice(0, 12)} -> ${md5Dopo.slice(0, 12)}`);

// Una seconda connessione, indipendente da quella del modulo: se vede il danno,
// il COMMIT e' avvenuto davvero e nessuna chiusura lo annullera'.
const altra = new DatabaseSync(copia, { readOnly: true });
const nomeAltra = altra.prepare("SELECT nome FROM strutture WHERE id = 1").get().nome;
const visiteAltra = altra.prepare("SELECT count(*) AS n FROM visite").get().n;
altra.close();
ok("2b una seconda connessione allo stesso file vede la palestra rovinata",
  nomeAltra === "RUBATA" && visiteAltra === visitePrima - 100,
  `nome=${nomeAltra} visite=${visiteAltra}`);

// ================================= 3. LA CONSEGUENZA PER CHI STA STUDIANDO
const attesoDopo = (await palestra.esegui(RIFERIMENTO)).righe[0][0];
ok("3a la soluzione di RIFERIMENTO ora restituisce un altro risultato",
  attesoPrima !== attesoDopo, `${attesoPrima} -> ${attesoDopo}`);

// Da qui in poi la risposta giusta di ieri e' ancora giusta (il confronto e'
// fra due esecuzioni sullo stesso database rovinato): il danno non si vede.
// Si vede invece su tutto cio' che e' stato fissato quando il database era
// integro — le righe_attese del contenuto e i tentativi gia' registrati.
const contenuti = JSON.parse(
  readFileSync(join(RADICE_PROGETTO, "assets/contenuti/esercizi_sql.json"), "utf8")
);
const suVisite = contenuti.filter(
  (e) => !e.preparazione && /\bvisite\b/i.test(e.soluzione) && e.righe_attese != null
);
let divergenti = 0;
for (const e of suVisite) {
  try {
    const r = await palestra.esegui(e.soluzione);
    if (r.righe.length !== e.righe_attese) divergenti++;
  } catch { divergenti++; }
}
ok("3b esercizi del catalogo le cui righe_attese non tornano piu'",
  divergenti > 0, `${divergenti} su ${suVisite.length} esercizi che toccano visite`);

// ============================================ 4. L'ASSET NON E' STATO TOCCATO
ok("4a assets/contenuti/palestra.db e' intatto (il danno vive nella copia)",
  md5Di(ASSET_PALESTRA) === md5AssetPrima);

// Nessuna via di rientro: apriPalestra() ricopia solo se il file NON esiste
// (lib/palestra.ts:32), non c'e' integrity_check ne' ripristino. Lo si vede
// nel codice; qui si misura che il file danneggiato resta al suo posto.
ok("4b la copia danneggiata resta dov'e': nessun ripristino automatico",
  md5Di(copia) === md5Dopo);

console.log(`\npassati ${passati}, falliti ${falliti.length}`);
if (falliti.length) {
  for (const f of falliti) console.log(`  - ${f}`);
  console.log(`radice temporanea lasciata sul disco: ${radice}`);
  process.exit(1);
}
rmSync(radice, { recursive: true, force: true });
process.exit(0);
