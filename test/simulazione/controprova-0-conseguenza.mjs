/**
 * CONTROPROVA con la lente "conseguenza" sul difetto RO (palestra.db scrivibile
 * dal campo risposta). Non ridimostra il meccanismo — lo fa gia' motore-sql.mjs,
 * sezione H — ma misura COSA PERDEVA L'UTENTE, e soprattutto se la via per
 * arrivarci era una via che l'app stessa insegna.
 *
 *   node test/simulazione/controprova-0-conseguenza.mjs
 *
 * CRONACA, perche' i numeri qui sotto non si spieghino da soli. Alla prima
 * esecuzione (21/09/2026, lib/palestra.ts di 11 KB, apertura senza PRAGMA) le
 * quindici verifiche dicevano che la scrittura passava: strutture.nome
 * diventava 'RUBATA', le visite scendevano da 7217 a 7117, l'md5 del file
 * cambiava, il riavvio non ripristinava nulla. Mentre scrivevo, il
 * coordinatore ha aggiunto `PRAGMA query_only = ON` in apriPalestra() e in
 * eseguiConPreparazione(): da allora le stesse verifiche misurano il rifiuto.
 * La sezione B e' rimasta: gira su una copia di servizio aperta col doppio
 * (non passa dall'app) e tiene il conto di che cosa sarebbe successo, cioe'
 * perche' quella correzione valeva la pena.
 *
 * Lavora in una radice temporanea. L'asset assets/contenuti/palestra.db non
 * viene mai aperto in scrittura.
 */
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdtempSync, mkdirSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { variabileBanco } from "../banco/doppi-altri.mjs";

const QUESTA_CARTELLA = dirname(fileURLToPath(import.meta.url));
const RADICE_PROGETTO = resolve(QUESTA_CARTELLA, "..", "..");
const ASSET_PALESTRA = join(RADICE_PROGETTO, "assets/contenuti/palestra.db");

// I ganci del banco vanno registrati prima di qualunque import dell'app.
if (!process.env.CONTROPROVA_CONSEGUENZA_IN_CORSO) {
  const esito = spawnSync(
    process.execPath,
    ["--import", "./test/banco/carica.mjs", "test/simulazione/controprova-0-conseguenza.mjs"],
    {
      cwd: RADICE_PROGETTO,
      stdio: "inherit",
      env: { ...process.env, CONTROPROVA_CONSEGUENZA_IN_CORSO: "1", BANCO_DOPPI: variabileBanco() },
    }
  );
  process.exit(esito.status ?? 1);
}

const FS = await import("../banco/expo-file-system.mjs");
const { configuraCartella, openDatabaseAsync } = await import("../banco/expo-sqlite.mjs");

const radice = mkdtempSync(join(tmpdir(), "conseguenza-"));
FS.configuraRadice(radice);
const cartellaSQLite = configuraCartella(join(FS.percorsoDocumenti(), "SQLite"));
mkdirSync(cartellaSQLite, { recursive: true });

// Primo avvio gia' avvenuto: palestra.db e' gia' nella cartella dell'app.
const percorsoPalestra = join(cartellaSQLite, "palestra.db");
copyFileSync(ASSET_PALESTRA, percorsoPalestra);

const palestra = await import("../../lib/palestra.ts");
const { verifica } = await import("../../lib/verifica.ts");
const ESERCIZI = JSON.parse(readFileSync(join(RADICE_PROGETTO, "assets/contenuti/esercizi_sql.json"), "utf8"));
const perId = (id) => ESERCIZI.find((e) => e.id === id);

let verdi = 0;
let rossi = 0;
function ok(nome, condizione, dettaglio = "") {
  if (condizione) { verdi++; console.log(`  ok    ${nome}${dettaglio ? " — " + dettaglio : ""}`); }
  else { rossi++; console.log(`  ROSSO ${nome}${dettaglio ? " — " + dettaglio : ""}`); }
}
const md5Palestra = () => createHash("md5").update(readFileSync(percorsoPalestra)).digest("hex");

const base = await palestra.apriPalestra();
const md5Iniziale = md5Palestra();
const visiteIniziali = (await base.getFirstAsync("SELECT count(*) AS n FROM visite")).n;
const nomeIniziale = (await base.getFirstAsync("SELECT nome FROM strutture WHERE id = 1")).nome;

console.log("\nA. LA VIA REALE — il campo risposta di un esercizio SENZA preparazione");
console.log("   (app/esercizi.tsx:52 passa `esegui` per 143 esercizi su 150)");
const soluzione094 = perId("SQL-094").soluzione;
// Ogni modo plausibile di scrivere, battuto nel campo risposta.
const SCRITTURE = [
  "UPDATE strutture SET nome = 'RUBATA' WHERE id = 1",
  "DELETE FROM visite WHERE id <= 100",
  "INSERT INTO strutture (nome) VALUES ('FINTA')",
  "DROP TABLE visite",
  "CREATE INDEX idx_visite_operatore ON visite(operatore)",
  "CREATE TABLE scarabocchio (a INTEGER)",
  "ALTER TABLE strutture RENAME TO strutture_vecchie",
  "UPDATE strutture SET nome = 'RUBATA' WHERE id = 1 RETURNING nome",
  "WITH x AS (SELECT 1) DELETE FROM visite WHERE id IN (SELECT * FROM x)",
  "VACUUM",
];
for (const sql of SCRITTURE) {
  const esito = await verifica(palestra.esegui, sql, soluzione094, { ordineRilevante: false });
  const respinta = esito.corretto === false && esito.motivo === "errore_sql";
  ok(`respinta: ${sql.slice(0, 46)}`, respinta,
    respinta ? String(esito.errore).replace(/^Error:\s*/, "").slice(0, 52)
             : `ESEGUITA — l'utente legge "${esito.dettaglio}"`);
}
ok("la palestra e' identica byte per byte (invariante 4)", md5Palestra() === md5Iniziale,
  `md5 ${md5Iniziale.slice(0, 12)}`);
ok("nessuna riga persa", (await base.getFirstAsync("SELECT count(*) AS n FROM visite")).n === visiteIniziali,
  `visite: ${visiteIniziali}`);
ok("nessun valore alterato",
  (await base.getFirstAsync("SELECT nome FROM strutture WHERE id = 1")).nome === nomeIniziale);
// Chi guarda solo la connessione non vedrebbe un danno rimasto sul file.
const altra = await openDatabaseAsync("palestra.db", { useNewConnection: true });
ok("anche una seconda connessione vede la palestra intatta",
  (await altra.getFirstAsync("SELECT count(*) AS n FROM visite")).n === visiteIniziali);

console.log("\nA-bis. IL RESIDUO: due PRAGMA che query_only lascia passare");
console.log("   (misurato, NON corretto: decide il coordinatore)");
const esitoSchema = await verifica(palestra.esegui, "PRAGMA writable_schema = ON", soluzione094, {});
ok("PRAGMA writable_schema passa...", esitoSchema.motivo !== "errore_sql");
const esitoMaster = await verifica(palestra.esegui,
  "UPDATE sqlite_master SET sql = 'CREATE TABLE visite(x)' WHERE name = 'visite'", soluzione094, {});
ok("...ma e' un vicolo cieco: la scrittura sullo schema resta respinta",
  esitoMaster.motivo === "errore_sql", String(esitoMaster.errore).replace(/^Error:\s*/, "").slice(0, 52));
const md5PrimaWal = md5Palestra();
const esitoWal = await verifica(palestra.esegui, "PRAGMA journal_mode = WAL", soluzione094, {});
const md5DopoWal = md5Palestra();
ok("PRAGMA journal_mode = WAL passa e cambia l'intestazione del file",
  esitoWal.motivo !== "errore_sql" && md5DopoWal !== md5PrimaWal,
  `md5 ${md5PrimaWal.slice(0, 12)} -> ${md5DopoWal.slice(0, 12)}: l'invariante 4 letta "byte per byte" cade ancora qui`);
ok("ma i DATI restano intatti e le scritture restano respinte",
  (await base.getFirstAsync("SELECT count(*) AS n FROM visite")).n === visiteIniziali &&
  (await verifica(palestra.esegui, "DELETE FROM visite WHERE id <= 5", soluzione094, {})).motivo === "errore_sql",
  "il danno dell'utente e' nullo: cambia il modo di giornale, non il contenuto");
// Si torna al modo di prima, cosi' i confronti di md5 che seguono restano leggibili.
await palestra.esegui("PRAGMA journal_mode = DELETE").catch(() => {});
const md5Ripristinato = md5Palestra();

console.log("\nB. QUANTO COSTAVA, quando la scrittura passava (misurato su una copia di servizio)");
const vivi = ESERCIZI.filter((e) => !e.preparazione);
copyFileSync(ASSET_PALESTRA, join(cartellaSQLite, "servizio.db"));
const servizio = await openDatabaseAsync("servizio.db", { useNewConnection: true });
const impronta = async (e) => {
  try { return JSON.stringify(await servizio.getAllAsync(e.soluzione)); }
  catch (err) { return "ERRORE:" + String(err).slice(0, 40); }
};
const prima = new Map();
for (const e of vivi) prima.set(e.id, await impronta(e));
await servizio.runAsync("DELETE FROM visite WHERE data >= '2026-01-01'");
let cambiati = 0;
let hintRotti = 0;
for (const e of vivi) {
  if (await impronta(e) !== prima.get(e.id)) cambiati++;
  if (e.righe_attese != null) {
    try { if ((await servizio.getAllAsync(e.soluzione)).length !== e.righe_attese) hintRotti++; }
    catch { hintRotti++; }
  }
}
ok("una sola DELETE avrebbe falsato molti esercizi", cambiati > 0,
  `${cambiati} dei ${vivi.length} esercizi vivi cambiano risultato`);
ok("...e il suggerimento 'Righe attese' della consegna avrebbe mentito", hintRotti > 0,
  `${hintRotti} esercizi mostrerebbero un numero che il database non da' piu'`);
await servizio.runAsync("DROP TABLE visite");
let morti = 0;
for (const e of vivi) { try { await servizio.getAllAsync(e.soluzione); } catch { morti++; } }
ok("un DROP TABLE avrebbe ucciso gran parte del motore", morti > 0,
  `${morti} dei ${vivi.length} non piu' eseguibili, con il messaggio che incolpa il DISPOSITIVO`);
ok("nessuna via di ritorno in lib/palestra.ts (apriPalestra ricopia solo se il file manca)",
  !Object.keys(palestra).some((n) => /ripristin|reimposta|ricopia|riparaz|integrit/i.test(n)),
  `esportazioni: ${Object.keys(palestra).join(", ")}`);

console.log("\nC. LA COPIA TEMPORANEA — i 7 esercizi con preparazione");
const es088 = perId("SQL-088");
const esecutore088 = (sql) => palestra.eseguiConPreparazione(es088.preparazione, sql);
const esito088 = await verifica(esecutore088, es088.soluzione, es088.soluzione, {});
ok("SQL-088 si risolve: la preparazione scrive sulla copia", esito088.corretto === true, esito088.dettaglio);
const scritturaSuCopia = await verifica(esecutore088, "DROP INDEX idx_visite_operatore", es088.soluzione, {});
ok("ma la RISPOSTA non puo' piu' toccare nemmeno la copia",
  scritturaSuCopia.motivo === "errore_sql", String(scritturaSuCopia.errore).slice(0, 52));
ok("l'indice dell'esercizio non e' finito nella palestra viva",
  (await base.getAllAsync("SELECT name FROM sqlite_master WHERE type='index' AND name='idx_visite_operatore'")).length === 0);
ok("nessuna copia temporanea lasciata indietro",
  readdirSync(cartellaSQLite).filter((f) => f.startsWith("palestra_tmp_")).length === 0,
  readdirSync(cartellaSQLite).join(", "));

console.log("\nD. NON REGREDISCE NULLA: tutte e 150 le soluzioni di riferimento vere");
let girate = 0;
const fallite = [];
for (const e of ESERCIZI) {
  try {
    if (e.preparazione) await palestra.eseguiConPreparazione(e.preparazione, e.soluzione);
    else await palestra.esegui(e.soluzione);
    girate++;
  } catch (err) { fallite.push(`${e.id}: ${String(err).slice(0, 60)}`); }
}
ok("ogni soluzione di riferimento gira ancora sotto query_only", fallite.length === 0,
  `${girate}/${ESERCIZI.length} eseguite${fallite.length ? " — " + fallite.slice(0, 3).join(" | ") : ""}`);
ok("e la palestra e' ancora identica a fine simulazione", md5Palestra() === md5Ripristinato,
  `md5 ${md5Palestra().slice(0, 12)} (= quello di partenza, a meno del giro su WAL di A-bis)`);

console.log(`\nRIEPILOGO  verdi=${verdi}  rossi=${rossi}`);
if (rossi === 0) rmSync(radice, { recursive: true, force: true });
else console.log("cartella lasciata per l'ispezione:", radice);
process.exit(rossi === 0 ? 0 : 1);
