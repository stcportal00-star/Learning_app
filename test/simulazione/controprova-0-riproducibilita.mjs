/**
 * controprova-0-riproducibilita.mjs — controprova AVVERSARIALE, scritta da zero.
 *
 * Domanda: e vero che una query di SCRITTURA scritta nel campo risposta di un
 * esercizio viene eseguita davvero su palestra.db (invariante 4 di CLAUDE.md)?
 *
 * Non mi fido del test dell'altro agente: qui non ne importo nemmeno una riga.
 * Uso solo la libreria standard di Node 22, node:sqlite e i doppi del banco per
 * caricare il CODICE VERO dell'app (lib/palestra.ts, lib/verifica.ts).
 *
 * Comando:
 *   BANCO_DOPPI="$(node -e 'import("./test/banco/doppi-altri.mjs").then(m=>console.log(m.variabileBanco()))')" \
 *     node --import ./test/banco/carica.mjs test/simulazione/controprova-0-riproducibilita.mjs
 *
 * Le cinque prove, dalla piu' indipendente alla piu' vicina all'app:
 *   A. motore nudo: nessun banco, nessuna app — solo node:sqlite sul file vero.
 *   B. via reale dell'app: esegui() di lib/palestra.ts, con md5 del file.
 *   C. via reale completa: verifica() di lib/verifica.ts con l'esecutore vero.
 *   D. danno permanente: un SECONDO PROCESSO che rifa apriPalestra() da capo.
 *   E. non e' un artefatto del banco: si legge il sorgente VERO di expo-sqlite.
 *
 * Se una qualunque di queste fallisce, il difetto NON e' riproducibile.
 */
import { DatabaseSync } from "node:sqlite";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { copyFileSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const QUI = dirname(fileURLToPath(import.meta.url));
const RADICE = resolve(QUI, "..", "..");
const PALESTRA_ASSET = join(RADICE, "assets", "contenuti", "palestra.db");

let verdi = 0;
let rossi = 0;
const cartellaProva = mkdtempSync(join(tmpdir(), "controprova-0-"));

/** Verifica minimale: nessuna dipendenza, il messaggio dice cosa si pretendeva. */
function esigi(condizione, descrizione, dettaglio = "") {
  if (condizione) {
    verdi++;
    console.log(`  ok   ${descrizione}`);
  } else {
    rossi++;
    console.log(`  NO   ${descrizione}${dettaglio ? "  <- " + dettaglio : ""}`);
  }
}

function md5(percorso) {
  return createHash("md5").update(readFileSync(percorso)).digest("hex");
}

function titolo(t) {
  console.log(`\n--- ${t}`);
}

// ====================================================================== A
// Motore nudo. Serve a stabilire il fatto di base senza nessun doppio in mezzo:
// aprire il file come lo apre apriPalestra() (nessuna opzione di sola lettura,
// perche' l'SDK 54 non ne espone) e chiedere le RIGHE di una UPDATE.
titolo("A. motore nudo: node:sqlite sul file vero, nessun banco, nessuna app");
{
  const copia = join(cartellaProva, "a-motore.db");
  copyFileSync(PALESTRA_ASSET, copia);
  const prima = md5(copia);

  const d = new DatabaseSync(copia); // come SQLite.openDatabaseAsync("palestra.db")
  const nomePrima = d.prepare("SELECT nome FROM strutture WHERE id = 1").get().nome;

  // expo, dentro getAllAsync, PREPARA e poi fa avanzare il cursore: in SQLite
  // un solo passo basta a portare a termine una UPDATE senza RETURNING.
  const righe = d.prepare("UPDATE strutture SET nome = 'RUBATA' WHERE id = 1").all();

  const nomeDopo = d.prepare("SELECT nome FROM strutture WHERE id = 1").get().nome;
  d.close();

  esigi(nomePrima !== "RUBATA", "prima la struttura 1 non si chiama RUBATA", nomePrima);
  esigi(Array.isArray(righe) && righe.length === 0, "la UPDATE restituisce zero righe (sembra innocua)");
  esigi(nomeDopo === "RUBATA", "ma la scrittura e' avvenuta", `ora: ${nomeDopo}`);
  esigi(md5(copia) !== prima, "il file su disco e' cambiato");
}

// ====================================================================== B
// Via reale dell'app: lib/palestra.ts vero, caricato dal banco.
titolo("B. via reale: esegui() di lib/palestra.ts sul palestra.db vero");

// Ordine obbligatorio: prima la radice del file system finto, poi la cartella
// di expo-sqlite, e solo dopo si importa il codice dell'app.
const FS = await import("../banco/expo-file-system.mjs");
const SQL = await import("../banco/expo-sqlite.mjs");
const radiceDispositivo = join(cartellaProva, "dispositivo");
FS.configuraRadice(radiceDispositivo);
const cartellaSqlite = SQL.configuraCartella(join(FS.percorsoDocumenti(), "SQLite"));

// Metto io la copia al posto giusto: cosi' apriPalestra() trova dest.exists e
// non passa da expo-asset. Un doppio in meno fra me e il difetto.
const filePalestra = join(cartellaSqlite, "palestra.db");
copyFileSync(PALESTRA_ASSET, filePalestra);
const md5Originale = md5(PALESTRA_ASSET);
esigi(md5(filePalestra) === md5Originale, "parto da una copia identica all'asset", md5Originale);

const palestra = await import("../../lib/palestra.ts");
await palestra.apriPalestra();

// Fotografia di partenza, letta con una connessione MIA e separata.
function letturaIndipendente(sql) {
  const d = new DatabaseSync(filePalestra, { readOnly: true });
  try {
    return d.prepare(sql).all();
  } finally {
    d.close();
  }
}

const nomePrimaB = letturaIndipendente("SELECT nome FROM strutture WHERE id = 1")[0].nome;
const visitePrima = letturaIndipendente("SELECT count(*) AS c FROM visite")[0].c;
esigi(visitePrima === 7217, "le visite di partenza sono 7217", String(visitePrima));

// Le due query dello scenario, passate a esegui() esattamente come fa
// app/esercizi.tsx quando l'esercizio non ha preparazione.
const esitoUpdate = await palestra.esegui("UPDATE strutture SET nome = 'RUBATA' WHERE id = 1");
const esitoDelete = await palestra.esegui("DELETE FROM visite WHERE id <= 100");

esigi(esitoUpdate.righe.length === 0, "esegui(UPDATE) non solleva errori e torna zero righe");
esigi(esitoDelete.righe.length === 0, "esegui(DELETE) non solleva errori e torna zero righe");

const nomeDopoB = letturaIndipendente("SELECT nome FROM strutture WHERE id = 1")[0].nome;
const visiteDopo = letturaIndipendente("SELECT count(*) AS c FROM visite")[0].c;

esigi(nomePrimaB !== "RUBATA" && nomeDopoB === "RUBATA",
  "una SECONDA connessione vede strutture.nome = 'RUBATA'", `${nomePrimaB} -> ${nomeDopoB}`);
esigi(visiteDopo === 7117, "una SECONDA connessione vede 7117 visite", String(visiteDopo));
esigi(md5(filePalestra) !== md5Originale, "md5 del file cambiato", `${md5Originale} -> ${md5(filePalestra)}`);

// ====================================================================== C
// Via reale COMPLETA: verifica() vera, esecutore vero, contenuti veri.
// Due domande: (1) la risposta di scrittura arriva fino al motore passando da
// verifica()? (2) il danno cambia l'esito delle soluzioni di riferimento?
titolo("C. via reale completa: verifica() + soluzioni vere di esercizi_sql.json");
{
  const verifica = await import("../../lib/verifica.ts");
  const esercizi = JSON.parse(readFileSync(join(RADICE, "assets", "contenuti", "esercizi_sql.json"), "utf8"));
  const senzaPreparazione = esercizi.filter((e) => !e.preparazione);
  esigi(esercizi.length === 150 && senzaPreparazione.length === 143,
    "150 esercizi, 143 senza preparazione (la via che passa da esegui())",
    `${esercizi.length} / ${senzaPreparazione.length}`);

  // Ricostruisco il file sano per misurare il prima/dopo delle soluzioni.
  copyFileSync(PALESTRA_ASSET, filePalestra);
  esigi(md5(filePalestra) === md5Originale, "file rimesso sano prima della prova C");

  const chiave = (r) => JSON.stringify(r.righe);
  const prima = new Map();
  for (const e of senzaPreparazione) {
    try {
      prima.set(e.id, chiave(await palestra.esegui(e.soluzione)));
    } catch {
      // una soluzione che non gira qui non c'entra con questa prova
    }
  }

  // La risposta dell'utente e' una scrittura. verifica() esegue prima la
  // soluzione di riferimento e poi la risposta: nessuna delle due e' filtrata.
  const bersaglio = senzaPreparazione[0];
  const esito = await verifica.verifica(
    palestra.esegui,
    "DELETE FROM visite WHERE id <= 100",
    bersaglio.soluzione,
    { ordineRilevante: false }
  );
  esigi(esito.motivo !== "errore_sql",
    "verifica() non rifiuta la risposta di scrittura: la esegue", esito.motivo);

  const visiteDopoC = letturaIndipendente("SELECT count(*) AS c FROM visite")[0].c;
  esigi(visiteDopoC === 7117, "passando da verifica() spariscono comunque 100 visite", String(visiteDopoC));

  let cambiate = 0;
  for (const e of senzaPreparazione) {
    if (!prima.has(e.id)) continue;
    try {
      if (chiave(await palestra.esegui(e.soluzione)) !== prima.get(e.id)) cambiate++;
    } catch {
      cambiate++;
    }
  }
  esigi(cambiate > 0,
    `le soluzioni di riferimento cambiano risultato dopo il danno: ${cambiate} esercizi su ${prima.size}`);

  // Il ripristino a inizio prova C ha rimesso il nome originale: rifaccio anche
  // la UPDATE, cosi' la prova D trova sul disco tutti e due i danni.
  await palestra.esegui("UPDATE strutture SET nome = 'RUBATA' WHERE id = 1");
}

// ====================================================================== D
// Danno permanente. apriPalestra() ricopia SOLO se !dest.exists: un riavvio
// dell'app non ripara niente. Lo provo con un PROCESSO NUOVO, che rifa tutto
// da capo sulla stessa cartella del "dispositivo".
titolo("D. danno permanente: un secondo processo rifa apriPalestra() da zero");
{
  const figlio = join(cartellaProva, "riavvio.mjs");
  writeFileSync(figlio, `
import { join } from "node:path";
const FS = await import(${JSON.stringify(pathToFileURL(join(RADICE, "test/banco/expo-file-system.mjs")).href)});
const SQL = await import(${JSON.stringify(pathToFileURL(join(RADICE, "test/banco/expo-sqlite.mjs")).href)});
FS.configuraRadice(${JSON.stringify(radiceDispositivo)});
SQL.configuraCartella(join(FS.percorsoDocumenti(), "SQLite"));
const p = await import(${JSON.stringify(pathToFileURL(join(RADICE, "lib/palestra.ts")).href)});
await p.apriPalestra();
const r = await p.esegui("SELECT nome FROM strutture WHERE id = 1");
const v = await p.esegui("SELECT count(*) AS c FROM visite");
console.log(JSON.stringify({ nome: r.righe[0][0], visite: v.righe[0][0] }));
`);
  const uscita = execFileSync(process.execPath, [
    "--import", pathToFileURL(join(RADICE, "test/banco/carica.mjs")).href,
    figlio,
  ], {
    cwd: RADICE,
    encoding: "utf8",
    env: { ...process.env, BANCO_DOPPI: process.env.BANCO_DOPPI ?? "{}" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const riga = uscita.trim().split("\n").filter((l) => l.startsWith("{")).pop();
  const stato = JSON.parse(riga);
  esigi(stato.nome === "RUBATA",
    "dopo il 'riavvio' la struttura 1 si chiama ancora RUBATA", String(stato.nome));
  esigi(stato.visite === 7117,
    "dopo il 'riavvio' le visite sono ancora 7117", String(stato.visite));
}

// ====================================================================== E
// Non e' un artefatto del banco: lo dice il sorgente VERO di expo-sqlite.
titolo("E. il sorgente vero di expo-sqlite, non il doppio");
{
  const statement = readFileSync(join(RADICE, "node_modules/expo-sqlite/build/SQLiteStatement.js"), "utf8");
  const database = readFileSync(join(RADICE, "node_modules/expo-sqlite/build/SQLiteDatabase.js"), "utf8");
  const opzioni = readFileSync(join(RADICE, "node_modules/expo-sqlite/build/NativeDatabase.d.ts"), "utf8");

  // getAllAsync di SQLiteDatabase esegue PRIMA statement.executeAsync(), che
  // chiama nativeStatement.runAsync(): il primo passo del cursore, cioe' la
  // scrittura, e' gia' avvenuto quando si vanno a leggere le righe.
  esigi(/async getAllAsync\([\s\S]{0,400}?statement\.executeAsync\(/.test(database),
    "SQLiteDatabase.getAllAsync() chiama statement.executeAsync() prima di leggere");
  esigi(/async executeAsync\([\s\S]{0,300}?nativeStatement\.runAsync\(/.test(statement),
    "executeAsync() passa per nativeStatement.runAsync(), che fa avanzare il cursore");
  esigi(/this SQL query may be a write operation/.test(statement),
    "expo stessa annota che una query passata a getAllAsync puo' essere una scrittura");
  esigi(!/readOnly|read_only|readonly/i.test(opzioni),
    "SQLiteOpenOptions dell'SDK 54 non espone nessuna opzione di sola lettura");

  // E la via reale: 143 esercizi su 150 usano l'esecutore condiviso.
  const schermata = readFileSync(join(RADICE, "app/esercizi.tsx"), "utf8");
  esigi(/preparazione[\s\S]{0,160}eseguiConPreparazione[\s\S]{0,40}:\s*esegui/.test(schermata),
    "app/esercizi.tsx passa `esegui` a verifica() quando manca la preparazione");
  const sorgentePalestra = readFileSync(join(RADICE, "lib/palestra.ts"), "utf8");
  esigi(/openDatabaseAsync\("palestra\.db"\)\s*;/.test(sorgentePalestra),
    "apriPalestra() apre senza nessuna opzione, malgrado il commento 'in sola lettura'");
  const corpoApri = sorgentePalestra.slice(
    sorgentePalestra.indexOf("export async function apriPalestra"),
    sorgentePalestra.indexOf("export function supportaWindowFunctions"));
  esigi(/if \(!dest\.exists\)/.test(corpoApri),
    "apriPalestra() ricopia l'asset solo se il file non c'e': un file rovinato resta");
  esigi(!/integrity_check|quick_check/i.test(corpoApri),
    "nessun controllo d'integrita' in apriPalestra(): il danno non si scopre da solo");
}

// ====================================================================== fine
console.log(`\n================ verdi: ${verdi}   rossi: ${rossi}`);
if (rossi === 0) {
  rmSync(cartellaProva, { recursive: true, force: true });
  console.log("DIFETTO RIPRODOTTO: la scrittura passa, palestra.db non e' in sola lettura.");
} else {
  console.log(`cartella lasciata per l'ispezione: ${cartellaProva}`);
}
process.exit(rossi === 0 ? 0 : 1);
