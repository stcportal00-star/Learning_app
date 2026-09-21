/**
 * CONTROPROVA 4 — lente "riproducibilita".
 *
 * Difetto da confutare: "DDL nel campo risposta: CREATE TABLE e DROP TABLE
 * vengono eseguiti sulla palestra" (lib/palestra.ts, esegui()).
 *
 * Scritto da zero, senza riusare nessuna verifica degli altri agenti: qui si
 * apre la palestra VERA (assets/contenuti/palestra.db, 2 MB, 14 tabelle) con il
 * codice VERO di lib/palestra.ts, si battono nel campo risposta le due
 * istruzioni dello scenario e si guarda il file sul disco da una SECONDA
 * connessione, indipendente dal doppio.
 *
 * Perche' la seconda connessione: un doppio che si limitasse a tenere in testa
 * lo schema direbbe quello che vogliamo sentirci dire. Il file .db invece non
 * mente.
 *
 * Comando:
 *   BANCO_DOPPI="$(node -e 'import("./test/banco/doppi-altri.mjs").then(m=>console.log(m.variabileBanco()))')" \
 *     node --import ./test/banco/carica.mjs test/simulazione/controprova-4-riproducibilita.mjs
 */
import { DatabaseSync } from "node:sqlite";
import { copyFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { RADICE_PROGETTO } from "../banco/carica.mjs";
import * as FS from "../banco/expo-file-system.mjs";
import { configuraCartella } from "../banco/expo-sqlite.mjs";
import { installaRequireMetro } from "../banco/require-metro.mjs";

let verdi = 0;
const rossi = [];

function conferma(titolo, condizione, dettaglio = "") {
  if (condizione) {
    verdi++;
    console.log(`  ok   ${titolo}`);
  } else {
    rossi.push(titolo);
    console.log(`  ROSSO ${titolo}${dettaglio ? " -> " + dettaglio : ""}`);
  }
}

/** Esegue e riporta l'esito senza far cadere il test: serve sapere SE ha lanciato. */
async function prova(fn) {
  try {
    return { riuscito: true, valore: await fn() };
  } catch (e) {
    return { riuscito: false, errore: e };
  }
}

const PALESTRA_ORIGINALE = join(RADICE_PROGETTO, "assets/contenuti/palestra.db");

// ====================================================================== A
// Semantica del motore, senza una riga di codice dell'app: PRAGMA query_only
// respinge davvero la DDL? Se qui fosse verde il difetto sarebbe reale a monte.
console.log("\nA. node:sqlite nudo — cosa fa PRAGMA query_only con la DDL");

const cartellaA = mkdtempSync(join(tmpdir(), "controprova4-a-"));
const copiaA = join(cartellaA, "palestra.db");
copyFileSync(PALESTRA_ORIGINALE, copiaA);

const nudo = new DatabaseSync(copiaA); // aperto in LETTURA-SCRITTURA di proposito
nudo.exec("PRAGMA query_only = ON");
const statoPragma = nudo.prepare("PRAGMA query_only").all();
conferma("query_only risulta attivo sulla connessione", JSON.stringify(statoPragma).includes("1"),
  JSON.stringify(statoPragma));

for (const istruzione of [
  "CREATE TABLE zzz_intrusa (x INTEGER)",
  "DROP TABLE valutazioni",
  "CREATE INDEX idx_intruso ON visite(data)",
  "DELETE FROM valutazioni",
  "INSERT INTO valutazioni (id) VALUES (999999)",
  "UPDATE visite SET esito = 'x'",
]) {
  let messaggio = "NESSUN ERRORE";
  try {
    nudo.prepare(istruzione).all(); // la stessa via di getAllAsync: prepare + step
  } catch (e) {
    messaggio = String(e.message);
  }
  conferma(`respinta: ${istruzione.slice(0, 44)}`, /readonly/i.test(messaggio), messaggio);
}
nudo.close();

// La tabella e' ancora la', il file non e' stato toccato.
const controlloA = new DatabaseSync(copiaA, { readOnly: true });
const tabelleA = controlloA.prepare(
  "SELECT name FROM sqlite_master WHERE type IN ('table','index')").all().map((r) => r.name);
conferma("A: 'valutazioni' e' ancora nel file", tabelleA.includes("valutazioni"));
conferma("A: 'zzz_intrusa' non e' nel file", !tabelleA.includes("zzz_intrusa"));
conferma("A: 'idx_intruso' non e' nel file", !tabelleA.includes("idx_intruso"));
controlloA.close();

// ====================================================================== B
// Lo scenario esatto del difetto, ma passando dal codice vero.
console.log("\nB. lib/palestra.ts vero — lo scenario del difetto, parola per parola");

const radice = FS.configuraRadice(mkdtempSync(join(tmpdir(), "controprova4-b-")));
const cartellaSqlite = configuraCartella(join(FS.percorsoDocumenti(), "SQLite"));
installaRequireMetro(RADICE_PROGETTO);

const palestraApp = await import("../../lib/palestra.ts");
const verificaApp = await import("../../lib/verifica.ts");

await palestraApp.apriPalestra();
conferma("apriPalestra() ha aperto la palestra vera", true);
console.log(`       motore: SQLite ${palestraApp.versioneMotore()}`);

const percorsoVivo = join(cartellaSqlite, "palestra.db");

const creata = await prova(() => palestraApp.esegui("CREATE TABLE zzz_intrusa (x INTEGER)"));
conferma("esegui('CREATE TABLE zzz_intrusa ...') LANCIA invece di eseguire", !creata.riuscito,
  creata.riuscito ? JSON.stringify(creata.valore) : "");
conferma("l'errore e' quello del motore ('readonly')",
  !creata.riuscito && /readonly/i.test(String(creata.errore?.message ?? creata.errore)),
  String(creata.errore?.message ?? creata.errore));

const caduta = await prova(() => palestraApp.esegui("DROP TABLE valutazioni"));
conferma("esegui('DROP TABLE valutazioni') LANCIA invece di eseguire", !caduta.riuscito,
  caduta.riuscito ? JSON.stringify(caduta.valore) : "");
conferma("l'errore e' quello del motore ('readonly')",
  !caduta.riuscito && /readonly/i.test(String(caduta.errore?.message ?? caduta.errore)),
  String(caduta.errore?.message ?? caduta.errore));

// L'esempio citato nella segnalazione: l'utente che riprova un CREATE INDEX
// visto nella preparazione di SQL-088 su un esercizio che non ne ha una.
const indice = await prova(() =>
  palestraApp.esegui("CREATE INDEX idx_visite_operatore ON visite(operatore)"));
conferma("esegui('CREATE INDEX ...') LANCIA invece di eseguire", !indice.riuscito,
  indice.riuscito ? JSON.stringify(indice.valore) : "");

// Il file sul disco, letto da fuori: e' la prova che non e' una finzione del doppio.
const controlloB = new DatabaseSync(percorsoVivo, { readOnly: true });
const oggettiB = controlloB.prepare(
  "SELECT name FROM sqlite_master WHERE type IN ('table','index')").all().map((r) => r.name);
conferma("B: sqlite_master NON contiene zzz_intrusa", !oggettiB.includes("zzz_intrusa"),
  oggettiB.join(","));
conferma("B: sqlite_master contiene ancora valutazioni", oggettiB.includes("valutazioni"));
conferma("B: sqlite_master NON contiene idx_visite_operatore",
  !oggettiB.includes("idx_visite_operatore"));
const quante = controlloB.prepare("SELECT count(*) AS n FROM valutazioni").get().n;
conferma("B: le righe di valutazioni sono ancora leggibili", quante > 0, `n=${quante}`);
controlloB.close();

// ====================================================================== C
// La conseguenza dichiarata: "da li in poi verifica() risponde 'La soluzione di
// riferimento non e' eseguibile'". Si prova con un esercizio VERO che legge
// proprio la tabella che si sarebbe dovuta perdere.
console.log("\nC. la conseguenza dichiarata su verifica() con un esercizio vero");

const esercizi = (await import("node:fs")).readFileSync(
  join(RADICE_PROGETTO, "assets/contenuti/esercizi_sql.json"), "utf8");
const elenco = JSON.parse(esercizi);
const suValutazioni = elenco.find((e) => e.id === "SQL-014");
conferma("SQL-014 trovato nei contenuti veri e legge valutazioni",
  !!suValutazioni && /valutazioni/i.test(suValutazioni.soluzione));

const esito = await verificaApp.verifica(
  palestraApp.esegui, suValutazioni.soluzione, suValutazioni.soluzione, {});
conferma("verifica() NON dice 'La soluzione di riferimento non e' eseguibile'",
  esito.motivo !== "errore_sql", `${esito.motivo}: ${esito.dettaglio}`);
conferma("verifica() dopo i tentativi di DDL risponde ancora 'corretto'", esito.corretto === true,
  JSON.stringify(esito));

// E cosa vede l'utente che batte una DDL nel campo risposta?
const esitoDdl = await verificaApp.verifica(
  palestraApp.esegui, "CREATE TABLE zzz_intrusa (x INTEGER)", suValutazioni.soluzione, {});
conferma("una DDL nel campo risposta torna come errore_sql dell'utente",
  esitoDdl.motivo === "errore_sql" && esitoDdl.dettaglio === "La query non viene eseguita.",
  `${esitoDdl.motivo}: ${esitoDdl.dettaglio}`);
console.log(`       messaggio mostrato: ${esitoDdl.errore}`);

// ====================================================================== D
// Onesta': esiste una via DIVERSA da quella dichiarata? query_only e' una
// proprieta' della connessione, e PRAGMA si puo' ribattere. Questa non e' la
// segnalazione in esame, ma va guardata perche' se passasse cambierebbe il
// giudizio sul MERITO (non sulla riproducibilita' dello scenario dichiarato).
console.log("\nD. controllo laterale: la risposta puo' spegnere il PRAGMA?");

const spegni = await prova(() => palestraApp.esegui("PRAGMA query_only = OFF"));
const dopoSpegnimento = await prova(() =>
  palestraApp.esegui("CREATE TABLE zzz_intrusa2 (x INTEGER)"));
console.log(`       PRAGMA query_only = OFF -> ${spegni.riuscito ? "accettata" : "respinta"}`);
console.log(`       CREATE TABLE dopo       -> ${dopoSpegnimento.riuscito ? "ESEGUITA" : "respinta"}`);
const controlloD = new DatabaseSync(percorsoVivo, { readOnly: true });
const oggettiD = controlloD.prepare(
  "SELECT name FROM sqlite_master WHERE type='table'").all().map((r) => r.name);
controlloD.close();
console.log(`       zzz_intrusa2 nel file   -> ${oggettiD.includes("zzz_intrusa2")}`);
console.log("       (annotazione, non fa parte dello scenario in esame)");

// ====================================================================== FINE
console.log(`\nverdi: ${verdi}   rossi: ${rossi.length}`);
if (rossi.length) {
  console.log("rossi:");
  for (const r of rossi) console.log("  - " + r);
  console.log(`cartelle NON cancellate: ${cartellaA} ${radice}`);
  process.exitCode = 1;
} else {
  rmSync(cartellaA, { recursive: true, force: true });
  rmSync(radice, { recursive: true, force: true });
}
