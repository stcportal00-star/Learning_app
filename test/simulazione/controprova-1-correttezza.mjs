/**
 * CONTROPROVA AVVERSARIALE del difetto "due registra() si interfogliano sul
 * BEGIN e lasciano una proiezione senza il suo evento" (lib/db.ts:155).
 *
 * Non cerco di confermarlo: cerco il modo di smontarlo. Le vie di smontaggio
 * erano quattro, e le misuro tutte:
 *   1. il difetto vive solo perche' il banco e' SINCRONO (node:sqlite), quindi
 *      l'interfogliamento sarebbe un artefatto -> sezione 2: rifaccio la stessa
 *      prova con ogni metodo *Async reso VERAMENTE asincrono (un macrotask di
 *      mezzo), cioe' come sul telefono;
 *   2. l'errore c'e' ma i dati restano integri (rollback pulito di entrambe)
 *      -> sezioni 1-3 contano eventi, righe proiettate e meta.hlc;
 *   3. l'errore e' esplicito e arriva al chiamante, quindi non e' silenzioso
 *      -> sezione 4 guarda cosa succede al chiamante scritto come note.tsx;
 *   4. il ROLLBACK e' solo nella testa del doppio -> sezione 5 riapre il file
 *      .db con una SECONDA connessione node:sqlite.
 *
 * Si esegue dalla radice del progetto, senza argomenti:
 *   node test/simulazione/controprova-1-correttezza.mjs
 * Si riavvia da solo, un processo figlio per scenario (apri() e' un singoletto).
 */
import { spawnSync } from "node:child_process";
import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const QUESTA_CARTELLA = dirname(fileURLToPath(import.meta.url));
const RADICE = resolve(QUESTA_CARTELLA, "..", "..");

// ------------------------------------------------------------------ genitore
if (!process.env.CONTROPROVA1_SCENARIO) {
  const scenari = ["F1-sincrono", "F1-asincrono", "F3-sincrono", "F3-asincrono", "riferimento"];
  const risultati = {};
  for (const s of scenari) {
    const e = spawnSync(
      process.execPath,
      ["--import", "./test/banco/carica.mjs", "test/simulazione/controprova-1-correttezza.mjs"],
      { cwd: RADICE, encoding: "utf8", env: { ...process.env, CONTROPROVA1_SCENARIO: s } }
    );
    const riga = (e.stdout || "").split("\n").find((r) => r.startsWith("ESITO "));
    if (!riga) {
      console.log(`[${s}] NESSUN ESITO\nstdout:\n${e.stdout}\nstderr:\n${e.stderr}`);
      process.exit(1);
    }
    risultati[s] = JSON.parse(riga.slice(6));
    console.log(`[${s}] ${riga.slice(6)}`);
    if (e.stderr.trim()) console.log(`[${s}] stderr: ${e.stderr.trim().split("\n")[0]}`);
  }
  console.log("\n--- lettura ---");
  const r = risultati["riferimento"];
  console.log(`riferimento (una registra() sola, niente concorrenza): eventi=${r.eventi} note=${r.note} hlc=${r.metaHlc}`);
  for (const s of ["F1-sincrono", "F1-asincrono", "F3-sincrono", "F3-asincrono"]) {
    const x = risultati[s];
    console.log(`${s}: eventi=${x.eventi} righeProiettate=${x.righeProiettate} metaAvanzato=${x.metaAvanzato} ` +
      `orfane=${x.orfane} esiti=${JSON.stringify(x.esiti)} suDisco=${JSON.stringify(x.suDisco)}`);
  }
  process.exit(0);
}

// -------------------------------------------------------------------- figlio
const scenario = process.env.CONTROPROVA1_SCENARIO;
const cartellaTmp = mkdtempSync(join(tmpdir(), `controprova1-${scenario}-`));

const sqlite = await import("../banco/expo-sqlite.mjs");
sqlite.configuraCartella(cartellaTmp);

// Via di smontaggio 1: rendo l'asincronia VERA. Sul telefono ogni *Async passa
// dal ponte nativo e cede davvero il thread JS; qui sotto c'e' node:sqlite, che
// e' sincrono. Se il difetto sparisse con l'asincronia vera, sarebbe un
// artefatto del banco.
if (scenario.endsWith("-asincrono")) {
  const proto = sqlite.SQLiteDatabase.prototype;
  for (const nome of ["execAsync", "runAsync", "getFirstAsync", "getAllAsync"]) {
    const originale = proto[nome];
    proto[nome] = async function (...a) {
      await new Promise((ok) => setTimeout(ok, 1));
      return originale.apply(this, a);
    };
  }
}

const app = await import("../../lib/db.ts");
await app.apri("dispositivo-A");
const base = app.database();

const esiti = [];
async function esegui(promessa, etichetta) {
  try { await promessa; esiti.push([etichetta, "ok"]); }
  catch (e) { esiti.push([etichetta, "errore: " + String(e.message).slice(0, 60)]); }
}

function proiezioneNota(id, testo) {
  return async (d, hlc) =>
    d.runAsync(
      `INSERT INTO note (id, titolo, testo, pubblicabile, creato_a, hlc) VALUES (?,?,?,?,?,?)`,
      [id, null, testo, 0, new Date().toISOString(), hlc]
    );
}

if (scenario === "riferimento") {
  // Controllo positivo: una registra() sola, nessuna concorrenza.
  await esegui(app.registra("note", "n1", "crea", { testo: "a" }, proiezioneNota("n1", "a")), "sola");
} else if (scenario.startsWith("F1")) {
  // Due tocchi su Salva: due registra() in volo, nessun await fra le due.
  const p1 = app.registra("note", "n1", "crea", { testo: "primo" }, proiezioneNota("n1", "primo"));
  const p2 = app.registra("note", "n2", "crea", { testo: "secondo" }, proiezioneNota("n2", "secondo"));
  await Promise.all([esegui(p1, "tocco1"), esegui(p2, "tocco2")]);
} else {
  // F3: registra() locale in volo mentre parte la transazione di useAutoSync.
  const p1 = app.registra("note", "n1", "crea", { testo: "locale" }, proiezioneNota("n1", "locale"));
  const p2 = base.withTransactionAsync(async () => {
    for (const e of [["R1", "0001"], ["R2", "0002"]]) {
      await base.runAsync(
        `INSERT OR IGNORE INTO eventi (id, hlc, dispositivo, entita, entita_id, tipo, payload, sincronizzato)
         VALUES (?,?,?,?,?,?,?,1)`,
        [e[0], e[1] + "-0-pari", "pari", "note", "r" + e[0], "crea", "{}"]
      );
    }
  });
  await Promise.all([esegui(p1, "registra-locale"), esegui(p2, "transazione-sync")]);
}

const eventi = base.getAllSync("SELECT id, entita_id FROM eventi");
const note = base.getAllSync("SELECT id FROM note");
const meta = base.getFirstSync("SELECT valore FROM meta WHERE chiave = 'hlc'");

// Via di smontaggio 4: una SECONDA connessione, sul file vero.
const percorso = join(cartellaTmp, "percorso.db");
const seconda = new DatabaseSync(percorso, { readOnly: true });
const suDisco = {
  eventi: seconda.prepare("SELECT count(*) c FROM eventi").get().c,
  note: seconda.prepare("SELECT count(*) c FROM note").get().c,
};
seconda.close();

const idEventiNota = new Set(eventi.map((e) => e.entita_id));
const orfane = note.filter((n) => !idEventiNota.has(n.id)).map((n) => n.id);

console.log("ESITO " + JSON.stringify({
  eventi: eventi.length,
  righeProiettate: note.length,
  metaHlc: meta ? meta.valore : null,
  metaAvanzato: Boolean(meta),
  orfane,
  esiti,
  suDisco,
}));
rmSync(cartellaTmp, { recursive: true, force: true });
