/**
 * Il caso E2 di prova-registro.mjs, in un processo tutto suo.
 *
 * Perché separato: dalla coda delle scritture di lib/db.ts una registra()
 * annidata dentro la proiezione di un'altra NON fallisce più, si ferma — la
 * seconda si mette in coda dietro la prima, che sta aspettando proprio lei.
 * Nessuna delle due finisce, e con loro resta ferma per sempre ogni scrittura
 * successiva. Misurarlo nel processo del test lo avvelenerebbe: da quel punto
 * in poi ogni altra verifica che scrive resterebbe appesa. Qui il veleno sta
 * in un processo che poi muore.
 *
 * Stampa una riga JSON e esce 0: è il chiamante a giudicare.
 *
 *   node --import ./test/banco/carica.mjs test/banco/prova-registro-annidata.mjs
 */
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import "./carica.mjs";
import { configuraCartella } from "./expo-sqlite.mjs";

configuraCartella(mkdtempSync(join(tmpdir(), "prova-registro-annidata-")));
const app = await import("../../lib/db.ts");
await app.apri("banco-annidata");
const base = app.database();
const adesso = new Date().toISOString();

const annidata = app.registra("note", "nota-esterna", "crea", {}, async (d, hlc) => {
  await d.runAsync("INSERT INTO note (id, testo, creato_a, hlc) VALUES (?,?,?,?)",
    ["nota-esterna", "testo", adesso, hlc]);
  await app.registra("note", "nota-interna", "crea", {}, async (dd, hh) => {
    await dd.runAsync("INSERT INTO note (id, testo, creato_a, hlc) VALUES (?,?,?,?)",
      ["nota-interna", "testo", adesso, hh]);
  });
});
annidata.catch(() => undefined); // non deve diventare un rigetto non gestito

const esito = await Promise.race([
  annidata.then(() => "conclusa", (e) => "respinta: " + String(e?.message ?? e)),
  new Promise((r) => setTimeout(() => r("mai conclusa"), 400)),
]);

// Le letture non passano dalla coda, quindi si possono fare anche adesso.
const conta = async (t) => (await base.getFirstAsync(`SELECT COUNT(*) AS n FROM ${t}`)).n;
console.log(JSON.stringify({
  esito,
  note: await conta("note"),
  eventi: await conta("eventi"),
  inTransazione: await base.isInTransactionAsync(),
}));
process.exit(0);
