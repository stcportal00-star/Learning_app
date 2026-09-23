/**
 * CONTROPROVA DI RIPRODUCIBILITA — scritta da zero, senza guardare i test
 * dell'altro agente. Domanda unica: due registra() che si accavallano
 * lasciano davvero una riga operativa SENZA il suo evento (invariante 1)?
 *
 * Perche' da zero: un difetto confermato da un solo test puo' essere un
 * artefatto di quel test. Qui ricopio la logica di salva() di
 * app/(tabs)/note.tsx (il .tsx non si puo' importare: niente react-native nel
 * banco) e leggo il risultato con una SECONDA connessione aperta direttamente
 * con node:sqlite sul file .db — cosi' il verdetto non passa mai dal doppio.
 *
 * Comando:
 *   node --import ./test/banco/carica.mjs test/simulazione/controprova-1-riproducibilita.mjs
 */
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { configuraCartella } from "../banco/expo-sqlite.mjs";

const cartella = configuraCartella(mkdtempSync(join(tmpdir(), "controprova-1-")));
const percorsoFile = join(cartella, "percorso.db");

const app = await import("../../lib/db.ts");
await app.apri("dispositivo-controprova");

let verdi = 0;
let rossi = 0;
function verifica(descrizione, condizione, dettaglio) {
  if (condizione) { verdi++; console.log("  ok   " + descrizione); }
  else { rossi++; console.log("  ROSSO " + descrizione + (dettaglio ? " -> " + dettaglio : "")); }
}

/** Legge il file .db da fuori: il doppio non c'entra, questo e' il disco. */
function daDisco(sql, ...parametri) {
  const seconda = new DatabaseSync(percorsoFile, { readOnly: true });
  try { return seconda.prepare(sql).all(...parametri); }
  finally { seconda.close(); }
}

/** Copia fedele di salva() di app/(tabs)/note.tsx (nota nuova). */
function salvaNota(id, titolo, testo) {
  return app.registra("note", id, "crea", { titolo, testo, pubblicabile: 0 },
    async (d, hlc) => {
      await d.runAsync(
        "INSERT INTO note (id, titolo, testo, pubblicabile, creato_a, hlc) VALUES (?,?,?,?,?,?)",
        [id, titolo, testo, 0, new Date().toISOString(), hlc]);
    });
}

// =====================================================================
// F1 — due tocchi su Salva. onPress={salva} non ha ne' disabled ne' un ref
// "in corso" (app/(tabs)/note.tsx:127), quindi le due salva() partono senza
// che la prima sia attesa: e' esattamente questo, nessun trucco in piu'.
// =====================================================================
console.log("F1 — due tocchi su Salva senza guardia");

const hlcPrima = daDisco("SELECT valore FROM meta WHERE chiave = 'hlc'")[0]?.valore ?? null;

const a = salvaNota("nota-A", "prima", "testo A");
const b = salvaNota("nota-B", "seconda", "testo B");
const esiti = await Promise.allSettled([a, b]);

console.log("  esito A: " + esiti[0].status +
  (esiti[0].status === "rejected" ? " (" + esiti[0].reason.message + ")" : ""));
console.log("  esito B: " + esiti[1].status +
  (esiti[1].status === "rejected" ? " (" + esiti[1].reason.message + ")" : ""));

const eventiDisco = daDisco("SELECT id, entita_id FROM eventi WHERE entita = 'note'");
const noteDisco = daDisco("SELECT id FROM note");
const hlcDopo = daDisco("SELECT valore FROM meta WHERE chiave = 'hlc'")[0]?.valore ?? null;

console.log("  sul disco: " + eventiDisco.length + " eventi, " + noteDisco.length +
  " note, meta.hlc " + hlcPrima + " -> " + hlcDopo);

// L'invariante 1 di CLAUDE.md: nessuna riga operativa senza il suo evento.
const idEventi = new Set(eventiDisco.map((e) => e.entita_id));
const orfane = noteDisco.filter((n) => !idEventi.has(n.id)).map((n) => n.id);
verifica("invariante 1: nessuna nota senza il suo evento",
  orfane.length === 0, "note orfane: " + JSON.stringify(orfane));

// =====================================================================
// F2 — controllo negativo. Le stesse due scritture, ma la seconda parte DOPO
// la prima (cioe' con la guardia che note.tsx non ha). Se qui e' tutto sano,
// la rottura di F1 viene dall'accavallamento e non da registra() in se'.
// =====================================================================
console.log("F2 — controllo negativo: le stesse due scritture, ma in sequenza");
await salvaNota("nota-C", "terza", "testo C");
await salvaNota("nota-D", "quarta", "testo D");

const eventiCD = daDisco("SELECT entita_id FROM eventi WHERE entita_id IN ('nota-C','nota-D')");
const noteCD = daDisco("SELECT id FROM note WHERE id IN ('nota-C','nota-D')");
verifica("in sequenza: 2 eventi e 2 note, tutto appaiato",
  eventiCD.length === 2 && noteCD.length === 2,
  eventiCD.length + " eventi / " + noteCD.length + " note");

// =====================================================================
// F3 — la sincronizzazione automatica. La transazione di
// lib/sync/useAutoSync.ts:52 (INSERT OR IGNORE dei pacchetti ricevuti) parte
// da 'void tenta(false)' e non e' coordinata con registra(). La ricopio qui.
// =====================================================================
console.log("F3 — transazione di useAutoSync mentre una registra() e' in volo");
const base = app.database();

function transazioneSync(idRemoti) {
  // Copia della struttura di useAutoSync.ts: withTransactionAsync + INSERT OR IGNORE.
  return base.withTransactionAsync(async () => {
    for (const id of idRemoti) {
      await base.runAsync(
        `INSERT OR IGNORE INTO eventi
         (id, hlc, dispositivo, entita, entita_id, tipo, payload, sincronizzato)
         VALUES (?,?,?,?,?,?,?,1)`,
        [id, "ffff-0:" + id, "altro-telefono", "note", id, "crea", "{}"]);
    }
  });
}

const locale = salvaNota("nota-E", "quinta", "testo E");
const remota = transazioneSync(["remoto-1", "remoto-2"]);
const esitiF3 = await Promise.allSettled([locale, remota]);
console.log("  esito scrittura locale: " + esitiF3[0].status +
  (esitiF3[0].status === "rejected" ? " (" + esitiF3[0].reason.message + ")" : ""));
console.log("  esito transazione sync: " + esitiF3[1].status +
  (esitiF3[1].status === "rejected" ? " (" + esitiF3[1].reason.message + ")" : ""));

const eventiE = daDisco("SELECT entita_id FROM eventi WHERE entita_id = 'nota-E'");
const noteE = daDisco("SELECT id FROM note WHERE id = 'nota-E'");
const remoti = daDisco("SELECT id, sincronizzato FROM eventi WHERE id LIKE 'remoto-%'");
console.log("  sul disco: evento nota-E " + eventiE.length + ", riga note nota-E " +
  noteE.length + ", eventi remoti applicati " + remoti.length +
  " " + JSON.stringify(remoti));
verifica("invariante 1 anche con la sync: nota-E non resta orfana",
  !(noteE.length === 1 && eventiE.length === 0),
  "riga note senza evento");
verifica("la transazione di sync e' tutto-o-niente (0 o 2 remoti, mai 1)",
  remoti.length !== 1, remoti.length + " eventi remoti");


// =====================================================================
// F4 — LA CONTROPROVA DELLA CONTROPROVA. Obiezione legittima: nel banco
// node:sqlite e' sincrono, quindi BEGIN accade subito e l'accavallamento
// potrebbe essere un artefatto. Qui niente banco e niente lib/: solo
// node:sqlite, withTransactionAsync copiato alla lettera da expo
// (node_modules/expo-sqlite/build/SQLiteDatabase.js:115) e 5 ms di attesa
// per ogni query, come il passaggio sul thread nativo del telefono.
// Serve a misurare la FINESTRA: quanto distanti devono essere due scritture
// perche' non si facciano male.
// =====================================================================
async function f4() {
  console.log("F4 — stessa forma, con latenza vera e senza banco: quanto dura la finestra");
  const { DatabaseSync: DB } = await import("node:sqlite");
  const file = join(mkdtempSync(join(tmpdir(), "controprova-1-latenza-")), "p.db");
  const q = new DB(file);
  q.exec("PRAGMA journal_mode = WAL");
  q.exec("CREATE TABLE eventi (id TEXT PRIMARY KEY, entita_id TEXT)");
  q.exec("CREATE TABLE note (id TEXT PRIMARY KEY)");

  const attesa = (ms) => new Promise((r) => setTimeout(r, ms));
  const esegui = async (sql, ...p) => { await attesa(5); q.prepare(sql).run(...p); };
  const comando = async (sql) => { await attesa(5); q.exec(sql); };

  async function conTransazione(compito) {          // copia da expo, alla lettera
    try { await comando("BEGIN"); await compito(); await comando("COMMIT"); }
    catch (e) { await comando("ROLLBACK"); throw e; }
  }
  const scritturaUtente = (id) => conTransazione(async () => {
    await esegui("INSERT INTO eventi (id, entita_id) VALUES (?,?)", "ev-" + id, id);
    await esegui("INSERT INTO note (id) VALUES (?)", id);
  });
  // useAutoSync.ts:52: un INSERT per evento ricevuto, fino a 500.
  const scritturaSync = (quanti) => conTransazione(async () => {
    for (let i = 0; i < quanti; i++)
      await esegui("INSERT OR IGNORE INTO eventi (id, entita_id) VALUES (?,?)", "r" + i, "r" + i);
  });

  let rotture = 0;
  for (const ritardo of [0, 2, 10, 100, 250, 400, 600]) {
    q.exec("DELETE FROM eventi; DELETE FROM note;");
    const sync = scritturaSync(50);                 // finestra ~350 ms
    await attesa(ritardo);                          // l'utente tocca Salva qui
    const utente = scritturaUtente("utente");
    await Promise.allSettled([sync, utente]);
    const ev = q.prepare("SELECT entita_id FROM eventi").all().map((r) => r.entita_id);
    const nt = q.prepare("SELECT id FROM note").all().map((r) => r.id);
    const orfana = nt.includes("utente") && !ev.includes("utente");
    const persa = !nt.includes("utente");
    if (orfana || persa) rotture++;
    console.log("  tocco a +" + String(ritardo).padStart(3) + " ms | eventi " +
      String(ev.length).padStart(2) + " note " + nt.length +
      " | nota orfana: " + orfana + " | scrittura utente persa: " + persa);
  }
  q.close();
  verifica("con latenza vera le due scritture non si danneggiano mai",
    rotture === 0, rotture + " tempi su 7 con perdita o riga orfana");
}

await f4();

console.log("\nverdi " + verdi + " / rossi " + rossi);
console.log("cartella: " + cartella);
process.exit(rossi ? 1 : 0);
