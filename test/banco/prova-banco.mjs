/**
 * Prova del banco: dimostra che il doppio di expo-sqlite è SQLite vero e che
 * il codice dell'app gira sopra di esso senza device.
 *
 * Si esegue così, dalla radice del progetto:
 *
 *   node --import ./test/banco/carica.mjs test/banco/prova-banco.mjs
 *
 * Due parti:
 *   A. il doppio da solo — transazione che riesce, transazione che fa ROLLBACK,
 *      vincoli UNIQUE/CHECK/foreign key che falliscono davvero;
 *   B. lib/db.ts caricato attraverso il risolutore — registra() scrive evento e
 *      proiezione nella stessa transazione, e se la proiezione lancia non resta
 *      traccia dell'evento.
 *
 * Questa prova NON modifica nulla del progetto: lavora in una cartella
 * temporanea creata al volo.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { configuraCartella } from "./expo-sqlite.mjs";

let passati = 0;
const falliti = [];
function ok(nome, condizione, extra = "") {
  if (condizione) passati++;
  else falliti.push(`${nome}${extra ? " — " + extra : ""}`);
}
async function lancia(nome, azione, frammentoAtteso) {
  try {
    await azione();
    falliti.push(`${nome} — non ha lanciato nessun errore`);
    return null;
  } catch (errore) {
    const messaggio = String(errore?.message ?? errore);
    ok(nome, messaggio.includes(frammentoAtteso), messaggio);
    return messaggio;
  }
}

// Cartella temporanea: i database di prova non devono sopravvivere al test.
const cartella = configuraCartella(mkdtempSync(join(tmpdir(), "prova-banco-")));

// ============================================================ PARTE A
// Il modulo si chiede col suo nome vero: se arriva il doppio, il risolutore
// sta facendo il suo mestiere.
const SQLite = await import("expo-sqlite");
ok("import \"expo-sqlite\" arriva al doppio", typeof SQLite.openDatabaseAsync === "function");

const d = await SQLite.openDatabaseAsync("prova.db");
await d.execAsync("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;");

await d.execAsync(`
  CREATE TABLE conti (
    id TEXT PRIMARY KEY,
    saldo INTEGER NOT NULL CHECK (saldo >= 0));
  CREATE TABLE movimenti (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    conto_id TEXT NOT NULL REFERENCES conti (id),
    importo INTEGER NOT NULL);
`);

const inserito = await d.runAsync("INSERT INTO conti (id, saldo) VALUES (?, ?)", ["a", 100]);
ok("runAsync riporta changes", inserito.changes === 1, JSON.stringify(inserito));
ok("runAsync riporta lastInsertRowId", typeof inserito.lastInsertRowId === "number");

const conta = async (tabella) =>
  (await d.getFirstAsync(`SELECT COUNT(*) AS n FROM ${tabella}`)).n;

ok("getFirstAsync senza righe restituisce null",
  (await d.getFirstAsync("SELECT * FROM conti WHERE id = ?", "inesistente")) === null);

// --- transazione che va a buon fine
await d.withTransactionAsync(async () => {
  await d.runAsync("INSERT INTO conti (id, saldo) VALUES (?, ?)", ["b", 50]);
  await d.runAsync("INSERT INTO conti (id, saldo) VALUES (?, ?)", ["c", 70]);
  ok("isInTransactionAsync è vero dentro la transazione", await d.isInTransactionAsync());
});
ok("transazione riuscita: COMMIT ha tenuto le due righe", (await conta("conti")) === 3);
ok("isInTransactionAsync è falso fuori dalla transazione", (await d.isInTransactionAsync()) === false);

// --- transazione che deve fare ROLLBACK
const messaggioRollback = await lancia(
  "transazione fallita: l'errore risale al chiamante",
  () =>
    d.withTransactionAsync(async () => {
      await d.runAsync("INSERT INTO conti (id, saldo) VALUES (?, ?)", ["d", 10]);
      // stessa chiave primaria di una riga già scritta: SQLite deve rifiutare
      await d.runAsync("INSERT INTO conti (id, saldo) VALUES (?, ?)", ["a", 999]);
    }),
  "UNIQUE constraint failed"
);
ok("transazione fallita: ROLLBACK ha tolto anche la riga buona",
  (await conta("conti")) === 3, `righe: ${await conta("conti")}`);
ok("dopo il ROLLBACK non si resta in transazione", (await d.isInTransactionAsync()) === false);

// --- i vincoli falliscono davvero
await lancia("il vincolo CHECK fallisce davvero",
  () => d.runAsync("INSERT INTO conti (id, saldo) VALUES (?, ?)", ["e", -1]),
  "CHECK constraint failed");
await lancia("il vincolo di chiave esterna fallisce davvero (PRAGMA applicato)",
  () => d.runAsync("INSERT INTO movimenti (conto_id, importo) VALUES (?, ?)", ["zzz", 5]),
  "FOREIGN KEY constraint failed");

// --- lettura
const tutti = await d.getAllAsync("SELECT id, saldo FROM conti ORDER BY id");
ok("getAllAsync restituisce le righe come oggetti",
  tutti.length === 3 && tutti[0].id === "a" && tutti[0].saldo === 100);

const raccolti = [];
for await (const riga of d.getEachAsync("SELECT id FROM conti ORDER BY id")) raccolti.push(riga.id);
ok("getEachAsync itera le righe", raccolti.join(",") === "a,b,c", raccolti.join(","));

const istruzione = await d.prepareAsync("SELECT saldo FROM conti WHERE id = ?");
const esecuzione = await istruzione.executeAsync("b");
const primaRiga = await esecuzione.getFirstAsync();
ok("prepareAsync + executeAsync + getFirstAsync", primaRiga?.saldo === 50);
ok("getColumnNamesAsync", (await istruzione.getColumnNamesAsync()).join(",") === "saldo");
await istruzione.finalizeAsync();

// --- parametri nella forma che usa expo
ok("parametri nominali stile $nome",
  (await d.getFirstAsync("SELECT saldo FROM conti WHERE id = $id", { $id: "c" }))?.saldo === 70);
ok("parametri variadici", (await d.getAllAsync("SELECT id FROM conti WHERE saldo > ? AND id <> ?", 40, "b")).length === 2);

// --- persistenza su file: chiudo e riapro
await d.closeAsync();
const riaperto = await SQLite.openDatabaseAsync("prova.db");
ok("i dati sopravvivono alla chiusura (file vero su disco)",
  (await riaperto.getFirstAsync("SELECT COUNT(*) AS n FROM conti")).n === 3);
await riaperto.closeAsync();

// ============================================================ PARTE B
// lib/db.ts, il modulo vero dell'app, compilato al volo e con expo-sqlite
// sostituito dal doppio.
const app = await import("../../lib/db.ts");
await app.apri("dispositivo-prova");
const base = app.database();

ok("lib/db.ts ha applicato le migrazioni",
  (await base.getFirstAsync("PRAGMA user_version"))?.user_version === app.SCHEMA_VERSIONE);
ok("lib/db.ts ha creato le tabelle attese",
  (await base.getAllAsync(
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('eventi','sessioni','meta')"
  )).length === 3);

const adesso = new Date().toISOString();
const hlc = await app.registra("sessioni", "s1", "crea", { minuti: 25 }, async (dd, h) => {
  await dd.runAsync(
    "INSERT INTO sessioni (id, tema_slug, tipo, inizio, minuti, note, hlc) VALUES (?,?,?,?,?,?,?)",
    ["s1", "sql", "studio", adesso, 25, null, h]
  );
});
ok("registra() ha scritto l'evento", (await base.getFirstAsync("SELECT COUNT(*) AS n FROM eventi")).n === 1);
ok("registra() ha scritto la proiezione", (await base.getFirstAsync("SELECT COUNT(*) AS n FROM sessioni")).n === 1);
ok("registra() ha salvato l'orologio in meta",
  typeof (await base.getFirstAsync("SELECT valore FROM meta WHERE chiave = 'hlc'"))?.valore === "string");
ok("registra() restituisce l'HLC serializzato", typeof hlc === "string" && hlc.includes("dispositivo-prova"));

// --- la proiezione lancia: evento e proiezione devono sparire insieme
await lancia(
  "registra(): se la proiezione lancia, l'errore risale",
  () =>
    app.registra("sessioni", "s2", "crea", { minuti: 10 }, async (dd, h) => {
      await dd.runAsync(
        "INSERT INTO sessioni (id, tema_slug, tipo, inizio, minuti, note, hlc) VALUES (?,?,?,?,?,?,?)",
        ["s2", "sql", "studio", adesso, 10, null, h]
      );
      throw new Error("guasto simulato nella proiezione");
    }),
  "guasto simulato"
);
ok("registra(): ROLLBACK, nessun evento orfano",
  (await base.getFirstAsync("SELECT COUNT(*) AS n FROM eventi")).n === 1);
ok("registra(): ROLLBACK, nessuna sessione orfana",
  (await base.getFirstAsync("SELECT COUNT(*) AS n FROM sessioni")).n === 1);

// --- il CHECK sul tipo di evento è quello dello schema dell'app
await lancia(
  "registra(): il CHECK su eventi.tipo rifiuta un tipo inventato",
  () => app.registra("sessioni", "s3", "inventato", {}, async () => {}),
  "CHECK constraint failed"
);
ok("registra(): dopo il CHECK gli eventi restano uno",
  (await base.getFirstAsync("SELECT COUNT(*) AS n FROM eventi")).n === 1);

// --- coda di sincronizzazione
const daInviare = await app.daSincronizzare();
ok("daSincronizzare() vede l'evento non inviato", daInviare.length === 1 && daInviare[0].entita === "sessioni");
await app.segnaSincronizzati(daInviare.map((e) => e.id));
ok("segnaSincronizzati() svuota la coda", (await app.daSincronizzare()).length === 0);

// ============================================================ PARTE C
// Il sottopercorso expo-sqlite/kv-store: lo importano lib/sync/stato.ts,
// lib/notifiche.ts e il Cronometro. Anche qui sotto c'è SQLite vero.
const kv = (await import("expo-sqlite/kv-store")).default;
await kv.setItem("dispositivo_id", "abc123");
ok("kv-store: setItem/getItem", (await kv.getItem("dispositivo_id")) === "abc123");
ok("kv-store: chiave assente restituisce null", (await kv.getItem("mai_scritta")) === null);
await kv.multiSet([["a", "1"], ["b", "2"]]);
ok("kv-store: multiGet",
  JSON.stringify(await kv.multiGet(["a", "b"])) === JSON.stringify([["a", "1"], ["b", "2"]]));
await kv.setItem("conf", JSON.stringify({ suono: true, ora: "08:00" }));
await kv.mergeItem("conf", JSON.stringify({ ora: "21:30" }));
const fusa = JSON.parse(await kv.getItem("conf"));
ok("kv-store: mergeItem fonde invece di sostituire", fusa.suono === true && fusa.ora === "21:30",
  JSON.stringify(fusa));
await kv.removeItem("a");
ok("kv-store: removeItem", (await kv.getItem("a")) === null);
ok("kv-store: getAllKeys", (await kv.getAllKeys()).sort().join(",") === "b,conf,dispositivo_id");
// La tabella è quella vera di expo: storage(key, value).
const deposito = await SQLite.openDatabaseAsync("ExpoSQLiteStorage");
ok("kv-store: dietro c'è la tabella storage di expo",
  (await deposito.getFirstAsync(
    "SELECT COUNT(*) AS n FROM sqlite_master WHERE type='table' AND name='storage'"
  )).n === 1);
await kv.clear();
ok("kv-store: clear svuota tutto", (await kv.getAllKeys()).length === 0);
await kv.close();

// ============================================================ ESITO
// La versione del motore conta: sotto 3.25 non esistono le window functions e
// 41 esercizi della palestra non sarebbero eseguibili (vedi lib/palestra.ts).
const versione = (await base.getFirstAsync("SELECT sqlite_version() AS v"))?.v;

console.log(`\nbanco expo-sqlite su node:sqlite — SQLite ${versione}`);
console.log(`cartella di prova: ${cartella}`);
for (const f of falliti) console.log(`  FALLITO: ${f}`);
console.log(`${passati} verifiche passate, ${falliti.length} fallite`);

// Si pulisce solo se è andato tutto bene: dopo un fallimento i file di prova
// servono per capire cosa è successo.
if (falliti.length) process.exit(1);
rmSync(cartella, { recursive: true, force: true });
