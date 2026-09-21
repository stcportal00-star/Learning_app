/**
 * La coda delle scritture di lib/db.ts, provata sul codice VERO.
 *
 * Esiste perche' la controprova del revisore (controprova-1-riproducibilita.mjs)
 * ricopia a mano la struttura VECCHIA di useAutoSync — `base.withTransactionAsync`
 * diretto — e quindi non tocca mai `inTransazione()`. Le sue due righe rosse
 * misurano codice che non e' piu' quello dell'app: una l'azzardo grezzo senza
 * lib/, l'altra la sincronizzazione com'era prima della correzione. Nessuna
 * delle due prova la correzione, e nessuna la smentisce.
 *
 *   node --import ./test/banco/carica.mjs test/simulazione/coda-scritture.mjs
 */
import "../banco/carica.mjs";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

const radice = mkdtempSync(join(tmpdir(), "coda-scritture-"));
const sqlite = await import("../banco/expo-sqlite.mjs");
const cartella = sqlite.configuraCartella(join(radice, "SQLite"));

const db = await import("../../lib/db.ts");
let passati = 0; const falliti = [];
const ok = (n, c, extra = "") => (c ? passati++ : falliti.push(`${n}${extra ? " — " + extra : ""}`));

await db.apri("telefono-prova");

// Il verdetto si legge da FUORI: una seconda connessione al file, non il doppio.
const fileDb = join(cartella, "percorso.db");
const daDisco = (sql) => {
  const q = new DatabaseSync(fileDb, { readOnly: true });
  try { return q.prepare(sql).all(); } finally { q.close(); }
};

const salvaNota = (id) =>
  db.registra("note", id, "crea", { titolo: id }, async (d, hlc) =>
    d.runAsync(
      `INSERT INTO note (id, tema_slug, titolo, testo, pubblicabile, origine_url, creato_a, hlc)
       VALUES (?,?,?,?,0,?,?,?)`,
      [id, null, id, "testo", null, new Date().toISOString(), hlc]));

// --- A: due registra() accavallate, senza await fra le due (doppio tocco su Salva)
await Promise.allSettled([salvaNota("n-A1"), salvaNota("n-A2")]);
const evA = daDisco("SELECT entita_id FROM eventi WHERE entita_id LIKE 'n-A%'");
const noteA = daDisco("SELECT id FROM note WHERE id LIKE 'n-A%'");
ok("A due registra() accavallate: due eventi e due note", evA.length === 2 && noteA.length === 2,
   `eventi ${evA.length}, note ${noteA.length}`);
ok("A nessuna riga orfana", noteA.length === evA.length);

// --- B: cinque accavallate insieme
await Promise.allSettled(["n-B1","n-B2","n-B3","n-B4","n-B5"].map(salvaNota));
const evB = daDisco("SELECT entita_id FROM eventi WHERE entita_id LIKE 'n-B%'");
ok("B cinque registra() insieme: cinque eventi", evB.length === 5, `eventi ${evB.length}`);
ok("B cinque righe note", daDisco("SELECT id FROM note WHERE id LIKE 'n-B%'").length === 5);

// --- C: la VERA via della sincronizzazione, quella corretta: inTransazione()
const applicaRemoti = (ids) =>
  db.inTransazione(async (d) => {
    for (const id of ids) {
      await d.runAsync(
        `INSERT OR IGNORE INTO eventi
         (id, hlc, dispositivo, entita, entita_id, tipo, payload, sincronizzato)
         VALUES (?,?,?,?,?,?,?,1)`,
        [id, "ffff-0:" + id, "altro-telefono", "note", id, "crea", "{}"]);
    }
  });

const esiti = await Promise.allSettled([salvaNota("n-C"), applicaRemoti(["rem-1", "rem-2"])]);
ok("C nessuna delle due e' stata respinta", esiti.every((e) => e.status === "fulfilled"),
   JSON.stringify(esiti.map((e) => e.status + (e.reason ? ":" + e.reason.message : ""))));
const evC = daDisco("SELECT entita_id FROM eventi WHERE entita_id = 'n-C'");
const noteC = daDisco("SELECT id FROM note WHERE id = 'n-C'");
ok("C la nota locale non resta orfana", !(noteC.length === 1 && evC.length === 0));
ok("C la nota locale c'e', con il suo evento", evC.length === 1 && noteC.length === 1);
const remoti = daDisco("SELECT id FROM eventi WHERE id LIKE 'rem-%'");
ok("C la transazione remota e' tutto-o-niente: 0 o 2, mai 1",
   remoti.length === 0 || remoti.length === 2, `applicati ${remoti.length}`);
ok("C i due eventi remoti sono applicati", remoti.length === 2);

// --- D: una scrittura che fallisce non blocca la coda per sempre
const rotta = db.registra("note", "n-D0", "crea", {}, async () => {
  throw new Error("proiezione rotta di proposito");
});
await Promise.allSettled([rotta]);
await salvaNota("n-D1");
ok("D dopo una scrittura fallita la coda continua a servire",
   daDisco("SELECT entita_id FROM eventi WHERE entita_id = 'n-D1'").length === 1);
ok("D la scrittura fallita non ha lasciato niente",
   daDisco("SELECT id FROM note WHERE id = 'n-D0'").length === 0 &&
   daDisco("SELECT entita_id FROM eventi WHERE entita_id = 'n-D0'").length === 0);

// --- E: l'ordine e' quello di arrivo
const ordine = ["n-E1", "n-E2", "n-E3", "n-E4"];
await Promise.allSettled(ordine.map(salvaNota));
const hlcOrdine = daDisco(
  "SELECT entita_id FROM eventi WHERE entita_id LIKE 'n-E%' ORDER BY hlc").map((r) => r.entita_id);
ok("E l'ordine degli HLC e' quello di arrivo",
   JSON.stringify(hlcOrdine) === JSON.stringify(ordine), JSON.stringify(hlcOrdine));

console.log(`\ncoda delle scritture — lib/db.ts, verdetto letto da una seconda connessione`);
console.log(`cartella: ${radice}`);
console.log(`\npassati ${passati} su ${passati + falliti.length}`);
for (const f of falliti) console.log(`  FALLITO: ${f}`);
process.exit(falliti.length ? 1 : 0);
