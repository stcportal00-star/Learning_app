/**
 * Controprova avversariale del difetto "Doppio tocco su Salva: resta una nota
 * SENZA il suo evento" (app/(tabs)/note.tsx:46, invariante 1 rotta da schermo).
 *
 * Perche' esiste: l'accusa dice che due registra() accavallate corrono sulla
 * STESSA connessione e si danneggiano a vicenda. Qui la scena viene rifatta
 * sul codice VERO — lib/db.ts caricato dal banco, SQLite vero — ricopiando
 * salva() di note.tsx riga per riga, compreso lo stato React: al secondo tocco
 * apertaId vale ancora "nuova" perche' setApertaId(id) sta DOPO l'await.
 *
 * Il verdetto si legge da FUORI, con una seconda connessione in sola lettura
 * al file .db: cosi' non si misura la testa del doppio ma il disco.
 *
 *   node --import ./test/banco/carica.mjs test/simulazione/controprova-3-correttezza.mjs
 */
import "../banco/carica.mjs";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

const radice = mkdtempSync(join(tmpdir(), "controprova-3-"));
const sqlite = await import("../banco/expo-sqlite.mjs");
const cartella = sqlite.configuraCartella(join(radice, "SQLite"));

const db = await import("../../lib/db.ts");
await db.apri("telefono-controprova");

const fileDb = join(cartella, "percorso.db");
// Seconda connessione: il ROLLBACK va visto nel file, non nel doppio.
const daDisco = (sql, par = []) => {
  const q = new DatabaseSync(fileDb, { readOnly: true });
  try { return q.prepare(sql).all(...par); } finally { q.close(); }
};

let passati = 0; const falliti = [];
const ok = (n, c, extra = "") => (c ? passati++ : falliti.push(`${n}${extra ? " — " + extra : ""}`));

/**
 * salva() di app/(tabs)/note.tsx, ricopiata. Non importo il .tsx: il banco non
 * ha react-native ne' expo-router, e la schermata non si carica (limite noto).
 * `apertaId` e' passato come argomento perche' e' il punto dell'accusa: al
 * secondo tocco vale ancora "nuova".
 */
async function salva({ apertaId, titolo, testo, pubblicabile, id }) {
  if (!testo.trim() && !titolo.trim()) return;
  const nuovo = apertaId === "nuova" || !apertaId;
  await db.registra("note", id, nuovo ? "crea" : "aggiorna",
    { titolo, testo, pubblicabile: pubblicabile ? 1 : 0 },
    async (d, hlc) => {
      if (nuovo) {
        await d.runAsync(
          `INSERT INTO note (id, titolo, testo, pubblicabile, creato_a, hlc) VALUES (?,?,?,?,?,?)`,
          [id, titolo || null, testo, pubblicabile ? 1 : 0, new Date().toISOString(), hlc]);
      } else {
        await d.runAsync(
          `UPDATE note SET titolo = ?, testo = ?, pubblicabile = ?, hlc = ? WHERE id = ?`,
          [titolo || null, testo, pubblicabile ? 1 : 0, hlc, id]);
      }
    });
}

const orfane = (pref) => daDisco(
  `SELECT n.id FROM note n
    WHERE n.id LIKE ? AND NOT EXISTS (SELECT 1 FROM eventi e WHERE e.entita_id = n.id)`, [pref]
).map((r) => r.id);

// ---------------------------------------------------------------- A) la scena esatta dell'accusa
// Due onPress sovrapposti: il secondo parte PRIMA che il primo abbia finito
// (nessun await fra i due), con apertaId ancora "nuova" in entrambi.
const esitiA = await Promise.allSettled([
  salva({ apertaId: "nuova", titolo: "nota", testo: "testo del doppio tocco", pubblicabile: false, id: "nota-1" }),
  salva({ apertaId: "nuova", titolo: "nota", testo: "testo del doppio tocco", pubblicabile: false, id: "nota-2" }),
]);
const noteA = daDisco("SELECT id FROM note WHERE id LIKE 'nota-%'");
const evA = daDisco("SELECT entita_id, tipo FROM eventi WHERE entita_id LIKE 'nota-%'");
ok("A1 nessuna nota orfana (invariante 1)", orfane("nota-%").length === 0, `orfane=[${orfane("nota-%")}]`);
ok("A2 due note sul disco", noteA.length === 2, `note=${noteA.length}`);
ok("A3 due eventi sul disco", evA.length === 2, `eventi=${evA.length}`);
ok("A4 nessuna delle due promesse rigetta", esitiA.every((e) => e.status === "fulfilled"),
   esitiA.map((e) => e.status + (e.reason ? ":" + e.reason.message : "")).join(" | "));
ok("A5 nessun 'cannot start a transaction within a transaction'",
   !esitiA.some((e) => e.reason && /within a transaction/.test(e.reason.message)));
ok("A6 nessun 'cannot rollback - no transaction is active'",
   !esitiA.some((e) => e.reason && /no transaction is active/.test(e.reason.message)));

// ---------------------------------------------------------------- B) doppio tocco sullo STESSO id
// Il caso peggiore: stesso id evento -> UNIQUE su eventi.id. Se la seconda
// fallisce deve fallire PULITA, senza lasciare macerie della prima.
const esitiB = await Promise.allSettled([
  salva({ apertaId: null, titolo: "b", testo: "b", pubblicabile: false, id: "stessa-1" }),
  salva({ apertaId: null, titolo: "b", testo: "b", pubblicabile: false, id: "stessa-1" }),
]);
ok("B1 nessuna orfana anche con id ripetuto", orfane("stessa-%").length === 0, `orfane=[${orfane("stessa-%")}]`);
const noteB = daDisco("SELECT id FROM note WHERE id LIKE 'stessa-%'");
const evB = daDisco("SELECT id FROM eventi WHERE entita_id LIKE 'stessa-%'");
ok("B2 una sola nota, uno o due eventi coerenti", noteB.length === 1 && evB.length >= 1,
   `note=${noteB.length} eventi=${evB.length}`);
ok("B3 se una fallisce, l'errore e' esplicito e non mascherato",
   esitiB.filter((e) => e.status === "rejected")
         .every((e) => !/no transaction is active|within a transaction/.test(e.reason.message)),
   esitiB.map((e) => e.status + (e.reason ? ":" + e.reason.message : "")).join(" | "));

// ---------------------------------------------------------------- C) dieci tocchi furiosi
const esitiC = await Promise.allSettled(
  Array.from({ length: 10 }, (_, i) =>
    salva({ apertaId: "nuova", titolo: "c", testo: "c", pubblicabile: true, id: `furia-${i}` })));
ok("C1 dieci note, dieci eventi, zero orfane",
   daDisco("SELECT id FROM note WHERE id LIKE 'furia-%'").length === 10 &&
   daDisco("SELECT id FROM eventi WHERE entita_id LIKE 'furia-%'").length === 10 &&
   orfane("furia-%").length === 0,
   `note=${daDisco("SELECT id FROM note WHERE id LIKE 'furia-%'").length} ` +
   `eventi=${daDisco("SELECT id FROM eventi WHERE entita_id LIKE 'furia-%'").length} ` +
   `orfane=[${orfane("furia-%")}]`);
ok("C2 nessuna delle dieci rigetta", esitiC.every((e) => e.status === "fulfilled"));

// ---------------------------------------------------------------- D) salva() mentre la sync applica
// L'altra meta' dell'accusa: la sincronizzazione che scrive mentre l'utente salva.
const esitiD = await Promise.allSettled([
  salva({ apertaId: "nuova", titolo: "d", testo: "d", pubblicabile: false, id: "mentre-sync" }),
  db.inTransazione(async (d) => {
    await d.runAsync(
      `INSERT INTO eventi (id, hlc, dispositivo, entita, entita_id, tipo, payload, sincronizzato)
       VALUES (?,?,?,?,?,?,?,1)`,
      ["remoto-1", "ffff-0-altro", "altro-telefono", "note", "remota-1", "crea", "{}"]);
    await d.runAsync(
      `INSERT INTO note (id, titolo, testo, pubblicabile, creato_a, hlc) VALUES (?,?,?,0,?,?)`,
      ["remota-1", "remota", "dall'altro telefono", new Date().toISOString(), "ffff-0-altro"]);
  }),
]);
ok("D1 salva() + inTransazione() insieme: entrambe riuscite", esitiD.every((e) => e.status === "fulfilled"),
   esitiD.map((e) => e.status + (e.reason ? ":" + e.reason.message : "")).join(" | "));
ok("D2 nessuna orfana ne' locale ne' remota",
   orfane("mentre-sync").length === 0 && orfane("remota-%").length === 0);

// ---------------------------------------------------------------- E) controllo globale
const tutteOrfane = daDisco(
  `SELECT n.id FROM note n WHERE NOT EXISTS (SELECT 1 FROM eventi e WHERE e.entita_id = n.id)`);
ok("E1 ZERO righe note senza evento in tutto il database", tutteOrfane.length === 0,
   `orfane=[${tutteOrfane.map((r) => r.id)}]`);
ok("E2 meta.hlc presente e avanzato", daDisco("SELECT valore FROM meta WHERE chiave='hlc'").length === 1);

// ---------------------------------------------------------------- F) falsificazione
// Se la coda NON ci fosse, il danno accadrebbe davvero? Si apre a mano una
// seconda transazione sulla stessa connessione, SCAVALCANDO registra().
// Serve a dimostrare che la prova sopra e' verde per merito della coda e non
// perche' il banco e' incapace di produrre il guasto.
const base = db.database();
let guastoRiprodotto = false;
try {
  await Promise.allSettled([
    base.withTransactionAsync(async () => {
      await base.runAsync(
        `INSERT INTO note (id, titolo, testo, pubblicabile, creato_a, hlc) VALUES (?,?,?,0,?,?)`,
        ["scavalco-1", "x", "x", new Date().toISOString(), "zzz-1"]);
    }),
    base.withTransactionAsync(async () => {
      await base.runAsync(
        `INSERT INTO note (id, titolo, testo, pubblicabile, creato_a, hlc) VALUES (?,?,?,0,?,?)`,
        ["scavalco-2", "x", "x", new Date().toISOString(), "zzz-2"]);
    }),
  ]);
} catch { /* il guasto e' proprio questo */ }
guastoRiprodotto = daDisco("SELECT id FROM note WHERE id LIKE 'scavalco-%'").length !== 2;
ok("F1 scavalcando registra() il banco SA produrre il guasto (prova non cieca)",
   guastoRiprodotto,
   `note scavalco=${daDisco("SELECT id FROM note WHERE id LIKE 'scavalco-%'").length} (2 = il banco non riproduce nulla)`);

console.log(`\npassati ${passati}, falliti ${falliti.length}`);
for (const f of falliti) console.log("  ROSSO " + f);
console.log(falliti.length ? `cartella: ${cartella}` : "");
process.exit(falliti.length ? 1 : 0);
