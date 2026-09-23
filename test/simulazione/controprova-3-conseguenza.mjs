/**
 * Controprova avversariale, lente CONSEGUENZA, del difetto
 * "Doppio tocco su Salva: resta una nota SENZA il suo evento"
 * (app/(tabs)/note.tsx:46 — radice dichiarata in lib/db.ts:155).
 *
 * La domanda di questa lente non e' "il meccanismo esiste?" ma "l'utente in
 * aereo, sul suo telefono, ci finisce dentro?". Per rispondere non basta
 * ricopiare la schermata: bisogna far girare il codice VERO che sta oggi nel
 * repository, perche' e' quello che finisce nell'APK.
 *
 * Il verdetto si legge da una SECONDA connessione node:sqlite in sola lettura
 * sul file .db: cosi' si misura il disco, non la testa del doppio.
 *
 *   node --import ./test/banco/carica.mjs test/simulazione/controprova-3-conseguenza.mjs
 */
import "../banco/carica.mjs";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";

const radice = mkdtempSync(join(tmpdir(), "controprova-3-cons-"));
const sqlite = await import("../banco/expo-sqlite.mjs");
const cartella = sqlite.configuraCartella(join(radice, "SQLite"));

const db = await import("../../lib/db.ts");
await db.apri("telefono-in-aereo");

const fileDb = join(cartella, "percorso.db");
const daDisco = (sql, par = []) => {
  const q = new DatabaseSync(fileDb, { readOnly: true });
  try { return q.prepare(sql).all(...par); } finally { q.close(); }
};
const contaDisco = (sql, par = []) => daDisco(sql, par)[0].n;

let passati = 0; const falliti = [];
const ok = (n, c, extra = "") => (c ? passati++ : falliti.push(`${n}${extra ? " — " + extra : ""}`));

/** Attesa vera, non microtask: smonta l'obiezione "l'asincronia del banco e' finta". */
const respiro = () => new Promise((r) => setTimeout(r, 1));

/**
 * salva() di app/(tabs)/note.tsx ricopiata riga per riga (il banco non carica
 * i .tsx: niente react-native, niente expo-router). `apertaId` e' un argomento
 * perche' e' esattamente il punto dell'accusa: al secondo tocco vale ancora
 * "nuova", dato che setApertaId(id) sta DOPO l'await.
 */
async function salva({ apertaId, titolo, testo, pubblicabile = false, lento = false }) {
  if (!testo.trim() && !titolo.trim()) return null;
  const id = apertaId === "nuova" || !apertaId ? randomUUID() : apertaId;
  const nuovo = apertaId === "nuova" || !apertaId;
  await db.registra("note", id, nuovo ? "crea" : "aggiorna",
    { titolo, testo, pubblicabile: pubblicabile ? 1 : 0 },
    async (d, hlc) => {
      if (lento) await respiro();            // la finestra che l'accusa vuole aperta
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
  return id;
}

/** Note presenti sul disco senza un evento che le giustifichi: le orfane dell'accusa. */
const orfane = () => daDisco(
  `SELECT n.id FROM note n
    WHERE NOT EXISTS (SELECT 1 FROM eventi e WHERE e.entita = 'note' AND e.entita_id = n.id)`
).map((r) => r.id);

// ---------------------------------------------------------------------------
// 1. LA SCENA ESATTA DELL'ACCUSA: due tocchi sovrapposti su Salva.
//    Il secondo parte PRIMA che il primo abbia finito: nessun await fra i due.
// ---------------------------------------------------------------------------
{
  const esiti = await Promise.allSettled([
    salva({ apertaId: "nuova", titolo: "Lettura serale", testo: "Primo tocco", lento: true }),
    salva({ apertaId: "nuova", titolo: "Lettura serale", testo: "Primo tocco", lento: true }),
  ]);
  const rigettate = esiti.filter((e) => e.status === "rejected");
  ok("1a doppio tocco: nessuna promessa muore in silenzio su un onPress senza catch",
     rigettate.length === 0, rigettate.map((e) => String(e.reason?.message)).join(" | "));
  ok("1b doppio tocco: 2 note sul disco", contaDisco("SELECT COUNT(*) n FROM note") === 2,
     `note=${contaDisco("SELECT COUNT(*) n FROM note")}`);
  ok("1c doppio tocco: 2 eventi sul disco",
     contaDisco("SELECT COUNT(*) n FROM eventi WHERE entita='note'") === 2,
     `eventi=${contaDisco("SELECT COUNT(*) n FROM eventi WHERE entita='note'")}`);
  ok("1d doppio tocco: NESSUNA nota orfana (invariante 1)", orfane().length === 0,
     `orfane=${JSON.stringify(orfane())}`);
  ok("1e doppio tocco: meta.hlc avanzato, il registro e' vivo",
     daDisco("SELECT valore FROM meta WHERE chiave='hlc'").length === 1);
}

// ---------------------------------------------------------------------------
// 2. IL DITO NERVOSO: cinque tocchi in raffica, come succede quando lo schermo
//    non da' feedback (il Pressable di note.tsx non ha disabled).
// ---------------------------------------------------------------------------
{
  const prima = contaDisco("SELECT COUNT(*) n FROM note");
  const esiti = await Promise.allSettled(
    Array.from({ length: 5 }, (_, i) =>
      salva({ apertaId: "nuova", titolo: `Raffica ${i}`, testo: "testo", lento: true })));
  ok("2a raffica di 5: nessuna promessa rigettata",
     esiti.every((e) => e.status === "fulfilled"),
     esiti.filter((e) => e.status === "rejected").map((e) => String(e.reason?.message)).join(" | "));
  ok("2b raffica di 5: 5 note nuove", contaDisco("SELECT COUNT(*) n FROM note") - prima === 5);
  ok("2c raffica di 5: nessuna orfana", orfane().length === 0, `orfane=${JSON.stringify(orfane())}`);
}

// ---------------------------------------------------------------------------
// 3. LA SINCRONIZZAZIONE MENTRE SI SCRIVE. Via VERA: inTransazione(), come la
//    usa oggi lib/sync/useAutoSync.ts:54. E' lo scenario gemello citato
//    dall'accusa ("lo stesso accade quando la sincronizzazione applica un
//    pacchetto mentre l'utente scrive").
// ---------------------------------------------------------------------------
{
  const prima = contaDisco("SELECT COUNT(*) n FROM note");
  const pacchettoRemoto = db.inTransazione(async (d) => {
    for (let i = 0; i < 3; i++) {
      await respiro();
      await d.runAsync(
        `INSERT OR IGNORE INTO eventi (id, hlc, dispositivo, entita, entita_id, tipo, payload, sincronizzato)
         VALUES (?,?,?,?,?,?,?,1)`,
        [`remoto-${i}`, `0000-${i}`, "tablet", "note", `nota-remota-${i}`, "crea", "{}"]);
    }
  });
  const scritturaLocale = salva({ apertaId: "nuova", titolo: "In aereo", testo: "mentre sincronizza", lento: true });
  const esiti = await Promise.allSettled([pacchettoRemoto, scritturaLocale]);
  ok("3a sync+scrittura: nessuna delle due rigetta",
     esiti.every((e) => e.status === "fulfilled"),
     esiti.filter((e) => e.status === "rejected").map((e) => String(e.reason?.message)).join(" | "));
  ok("3b sync+scrittura: i 3 eventi remoti sono sul disco",
     contaDisco("SELECT COUNT(*) n FROM eventi WHERE dispositivo='tablet'") === 3);
  ok("3c sync+scrittura: la nota locale c'e' con il suo evento",
     contaDisco("SELECT COUNT(*) n FROM note") - prima === 1 && orfane().length === 0,
     `orfane=${JSON.stringify(orfane())}`);
}

// ---------------------------------------------------------------------------
// 4. LA PROIEZIONE CHE LANCIA, SOTTO ACCAVALLAMENTO. Se la coda morisse a una
//    scrittura fallita, l'utente resterebbe con l'app muta fino al riavvio:
//    quella si' sarebbe una conseguenza in aereo.
// ---------------------------------------------------------------------------
{
  const rotta = db.registra("note", "id-rotto", "crea", {}, async () => {
    await respiro();
    throw new Error("proiezione rotta apposta");
  });
  const sana = salva({ apertaId: "nuova", titolo: "Dopo il guasto", testo: "il registro deve riprendere", lento: true });
  const [e1, e2] = await Promise.allSettled([rotta, sana]);
  ok("4a la scrittura rotta rigetta con il SUO motivo, non con un messaggio di transazione",
     e1.status === "rejected" && /proiezione rotta apposta/.test(String(e1.reason?.message)),
     String(e1.reason?.message));
  ok("4b la scrittura sana accanto sopravvive", e2.status === "fulfilled",
     String(e2.reason?.message));
  ok("4c nessun residuo della rotta sul disco",
     contaDisco("SELECT COUNT(*) n FROM eventi WHERE entita_id='id-rotto'") === 0);
  ok("4d nessuna orfana", orfane().length === 0, `orfane=${JSON.stringify(orfane())}`);
  const dopo = await salva({ apertaId: "nuova", titolo: "Riprende", testo: "coda viva", lento: true });
  ok("4e la coda non si e' piantata: si scrive ancora", typeof dopo === "string");
}

// ---------------------------------------------------------------------------
// 5. IL MECCANISMO ESISTE ANCORA? Sì — ma fuori da registra(). Due
//    withTransactionAsync accavallate a mano sulla stessa connessione, cioe'
//    il codice di PRIMA della coda. Serve a dimostrare che il verde qui sopra
//    non e' il banco che non sa riprodurre la concorrenza, ma la coda che la
//    governa. Questa e' la falsificazione, ed e' rossa per costruzione.
// ---------------------------------------------------------------------------
{
  const d = db.database();
  const senzaCoda = (id) => d.withTransactionAsync(async () => {
    await respiro();
    await d.runAsync(
      `INSERT INTO note (id, titolo, testo, pubblicabile, creato_a, hlc) VALUES (?,?,?,?,?,?)`,
      [id, "grezza", "aggirando la coda", 0, new Date().toISOString(), `x-${id}`]);
  });
  const esiti = await Promise.allSettled([senzaCoda("grezza-1"), senzaCoda("grezza-2")]);
  const rotto = esiti.some((e) => e.status === "rejected");
  ok("5a AGGIRANDO la coda il danno torna: due withTransactionAsync a mano si danneggiano",
     rotto, "se questa riga e' rossa, il banco non riproduce l'accavallamento e il verde sopra non vale");
  console.log("    5 (diagnostica) esiti grezzi:",
    esiti.map((e) => e.status === "rejected" ? String(e.reason?.message) : "ok").join(" | "));
}

console.log(`\npassati ${passati}, falliti ${falliti.length}`);
for (const f of falliti) console.log("  ROSSO:", f);
console.log("cartella:", radice);
process.exit(falliti.length ? 1 : 0);
