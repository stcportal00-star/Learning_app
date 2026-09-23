/**
 * CONTROPROVA 3 — lente "riproducibilita".
 *
 * Difetto sotto esame: "Doppio tocco su Salva: resta una nota SENZA il suo
 * evento" (app/(tabs)/note.tsx:46, radice indicata in lib/db.ts).
 *
 * Scritto da zero: NON importa ne' prova-registro.mjs ne' gli altri file di
 * controprova. La transazione di expo e' RICOPIATA qui dentro
 * (node_modules/expo-sqlite/build/SQLiteDatabase.js:116-126) invece di passare
 * per withTransactionAsync del doppio: se il difetto esistesse solo per come il
 * banco implementa la transazione, questa copia non lo mostrerebbe.
 *
 * Il verdetto di ogni scenario si legge da una SECONDA connessione aperta con
 * node:sqlite sul file, fuori dal doppio: cosi' "orfana" significa orfana sul
 * disco, non nella testa del banco.
 *
 * Comando:
 *   node --import ./test/banco/carica.mjs test/simulazione/controprova-3-riproducibilita.mjs
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { configuraCartella, openDatabaseSync } from "../banco/expo-sqlite.mjs";

const cartella = configuraCartella(mkdtempSync(join(tmpdir(), "controprova3-")));

let passate = 0;
const rotte = [];
function verifica(nome, condizione, dettaglio = "") {
  if (condizione) { passate++; console.log(`  ok   ${nome}`); }
  else { rotte.push(nome); console.log(`  ROTTA ${nome} ${dettaglio}`); }
}

// ------------------------------------------------------------------ SCHEMA
// Le due sole tabelle che il difetto mette in gioco, copiate da lib/db.ts.
const SCHEMA = `
  CREATE TABLE IF NOT EXISTS meta (chiave TEXT PRIMARY KEY, valore TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS eventi (
    id TEXT PRIMARY KEY, hlc TEXT NOT NULL, dispositivo TEXT NOT NULL,
    entita TEXT NOT NULL, entita_id TEXT NOT NULL,
    tipo TEXT NOT NULL CHECK (tipo IN ('crea','aggiorna','elimina')),
    payload TEXT NOT NULL DEFAULT '{}', sincronizzato INTEGER NOT NULL DEFAULT 0);
  CREATE TABLE IF NOT EXISTS note (
    id TEXT PRIMARY KEY, tema_slug TEXT, titolo TEXT, testo TEXT NOT NULL DEFAULT '',
    pubblicabile INTEGER NOT NULL DEFAULT 0, origine_url TEXT,
    creato_a TEXT NOT NULL, hlc TEXT NOT NULL);
`;

/**
 * La transazione di expo, riga per riga da SQLiteDatabase.js. Non chiamo
 * withTransactionAsync del doppio apposta: qui la copia e' mia.
 */
async function conTransazioneCopiaDiExpo(d, compito) {
  try {
    await d.execAsync("BEGIN");
    await compito();
    await d.execAsync("COMMIT");
  } catch (e) {
    await d.execAsync("ROLLBACK");
    throw e;
  }
}

/** Lettura del verdetto da FUORI: seconda connessione, node:sqlite puro. */
function leggiDalDisco(percorso) {
  const c = new DatabaseSync(percorso, { readOnly: true });
  const note = c.prepare("SELECT id FROM note ORDER BY id").all().map((r) => r.id);
  const eventi = c.prepare("SELECT entita_id FROM eventi ORDER BY entita_id").all().map((r) => r.entita_id);
  c.close();
  const orfane = note.filter((id) => !eventi.includes(id));
  const eventiSenzaNota = eventi.filter((id) => !note.includes(id));
  return { note, eventi, orfane, eventiSenzaNota };
}

/** Il corpo di registra() PRIMA del fix, copiato da `git show 1e8db0a:lib/db.ts`. */
function registraPrimaDelFix(d, orologio, serializza) {
  return async (entita, entitaId, tipo, payload, proiezione) => {
    const h = orologio.adesso();
    const hlc = serializza(h);
    await conTransazioneCopiaDiExpo(d, async () => {
      await d.runAsync(
        `INSERT INTO eventi (id, hlc, dispositivo, entita, entita_id, tipo, payload)
         VALUES (?,?,?,?,?,?,?)`,
        [hlc + ":" + entitaId, hlc, h.dispositivo, entita, entitaId, tipo, JSON.stringify(payload)]
      );
      await proiezione(d, hlc);
      await d.runAsync(
        `INSERT INTO meta (chiave, valore) VALUES ('hlc', ?)
         ON CONFLICT (chiave) DO UPDATE SET valore = excluded.valore`,
        [h.ms.toString(16) + "-" + h.contatore.toString(16)]
      );
    });
    return hlc;
  };
}

/** La proiezione di app/(tabs)/note.tsx:52, ricopiata (le schermate non si importano). */
function proiezioneNuovaNota(id, titolo, testo) {
  return async (d, hlc) => {
    await d.runAsync(
      `INSERT INTO note (id, titolo, testo, pubblicabile, creato_a, hlc) VALUES (?,?,?,?,?,?)`,
      [id, titolo || null, testo, 0, new Date().toISOString(), hlc]
    );
  };
}

console.log("CONTROPROVA 3 — riproducibilita del doppio tocco su Salva\n");

// ===================================================================== 1
// Il MECCANISMO, senza lib/db.ts: due transazioni sovrapposte sulla stessa
// connessione. Se il difetto e' reale, la sua radice si vede gia' qui.
console.log("1) meccanismo puro: due transazioni sovrapposte, una connessione");
{
  const d = openDatabaseSync("mecc.db");
  await d.execAsync(SCHEMA);
  const scrivi = async (n) => {
    await conTransazioneCopiaDiExpo(d, async () => {
      await d.runAsync(
        `INSERT INTO eventi (id, hlc, dispositivo, entita, entita_id, tipo, payload)
         VALUES (?,?,?,?,?,?,?)`,
        [`h${n}:nota-${n}`, `h${n}`, "disp-A", "note", `nota-${n}`, "crea", "{}"]
      );
      await proiezioneNuovaNota(`nota-${n}`, `t${n}`, `testo ${n}`)(d, `h${n}`);
    });
  };
  // I due tocchi: il secondo parte prima che il primo abbia finito.
  const esiti = await Promise.allSettled([scrivi(1), scrivi(2)]);
  const errori = esiti.filter((e) => e.status === "rejected").map((e) => String(e.reason?.message));
  console.log(`     esiti: ${esiti.map((e) => e.status).join(", ")}`);
  if (errori.length) console.log(`     errori: ${errori.join(" | ")}`);
  const v = leggiDalDisco(join(cartella, "mecc.db"));
  console.log(`     disco: note=${v.note.length} eventi=${v.eventi.length} orfane=[${v.orfane}]`);
  verifica("1.a il meccanismo produce una nota orfana", v.orfane.length > 0,
    `(orfane=${v.orfane.length})`);
  verifica("1.b l'errore che emerge e' quello dichiarato",
    errori.some((m) => /cannot start a transaction within a transaction|cannot rollback/.test(m)),
    `(${errori.join(" | ")})`);
  d.closeSync();
}

// ===================================================================== 2
// Lo stesso, ma con ASINCRONIA VERA: ogni chiamata *Async passa da un
// setTimeout. Serve a escludere che il difetto sia un artefatto del banco,
// che sotto e' sincrono.
console.log("\n2) stesso meccanismo con asincronia vera (setTimeout fra le query)");
{
  const base = openDatabaseSync("mecc-async.db");
  await base.execAsync(SCHEMA);
  const lento = {
    execAsync: async (s) => { await new Promise((r) => setTimeout(r, 1)); return base.execAsync(s); },
    runAsync: async (s, p) => { await new Promise((r) => setTimeout(r, 1)); return base.runAsync(s, p); },
  };
  const scrivi = async (n) => {
    await conTransazioneCopiaDiExpo(lento, async () => {
      await lento.runAsync(
        `INSERT INTO eventi (id, hlc, dispositivo, entita, entita_id, tipo, payload)
         VALUES (?,?,?,?,?,?,?)`,
        [`h${n}:nota-${n}`, `h${n}`, "disp-A", "note", `nota-${n}`, "crea", "{}"]
      );
      await proiezioneNuovaNota(`nota-${n}`, `t${n}`, `testo ${n}`)(lento, `h${n}`);
    });
  };
  const esiti = await Promise.allSettled([scrivi(1), scrivi(2)]);
  const errori = esiti.filter((e) => e.status === "rejected").map((e) => String(e.reason?.message));
  console.log(`     esiti: ${esiti.map((e) => e.status).join(", ")}`);
  if (errori.length) console.log(`     errori: ${errori.join(" | ")}`);
  const v = leggiDalDisco(join(cartella, "mecc-async.db"));
  console.log(`     disco: note=${v.note.length} eventi=${v.eventi.length} orfane=[${v.orfane}]`);
  verifica("2.a con asincronia vera il difetto resta", v.orfane.length > 0,
    `(orfane=${v.orfane.length})`);
  base.closeSync();
}

// ===================================================================== 3
// Il codice VERO di prima del fix: il corpo di registra() com'era in 1e8db0a,
// con l'orologio HLC vero di lib/hlc.ts.
console.log("\n3) registra() com'era prima del fix (1e8db0a) + lib/hlc.ts vero");
{
  const hlc = await import("../../lib/hlc.ts");
  const d = openDatabaseSync("prefix.db");
  await d.execAsync(SCHEMA);
  const orologio = new hlc.Orologio("dispositivo-di-prova");
  const registra = registraPrimaDelFix(d, orologio, hlc.serializza);
  const salva = (id, testo) =>
    registra("note", id, "crea", { titolo: id, testo }, proiezioneNuovaNota(id, id, testo));
  const esiti = await Promise.allSettled([salva("nota-1", "primo tocco"), salva("nota-2", "secondo tocco")]);
  const errori = esiti.filter((e) => e.status === "rejected").map((e) => String(e.reason?.message));
  console.log(`     esiti: ${esiti.map((e) => e.status).join(", ")}`);
  if (errori.length) console.log(`     errori: ${errori.join(" | ")}`);
  const v = leggiDalDisco(join(cartella, "prefix.db"));
  console.log(`     disco: note=${v.note.length} eventi=${v.eventi.length} orfane=[${v.orfane}]`);
  verifica("3.a il codice pre-fix lascia una nota senza evento", v.orfane.length > 0,
    `(note=${v.note.length} eventi=${v.eventi.length})`);
  verifica("3.b entrambe le promesse rigettano (l'utente non vede nulla, onPress senza catch)",
    errori.length === 2, `(rigetti=${errori.length})`);
  d.closeSync();
}

// ===================================================================== 4
// Il codice VERO di OGGI (HEAD): lib/db.ts con la coda. Stesso doppio tocco.
console.log("\n4) lib/db.ts di OGGI (HEAD, con la coda): stesso doppio tocco");
{
  configuraCartella(join(cartella, "SQLite"));
  const app = await import("../../lib/db.ts");
  await app.apri("dispositivo-di-prova");
  const base = app.database();
  const salva = (id, testo) =>
    app.registra("note", id, "crea", { titolo: id, testo }, proiezioneNuovaNota(id, id, testo));
  const esiti = await Promise.allSettled([salva("nota-1", "primo tocco"), salva("nota-2", "secondo tocco")]);
  const errori = esiti.filter((e) => e.status === "rejected").map((e) => String(e.reason?.message));
  console.log(`     esiti: ${esiti.map((e) => e.status).join(", ")}`);
  if (errori.length) console.log(`     errori: ${errori.join(" | ")}`);
  const v = leggiDalDisco(join(cartella, "SQLite", "percorso.db"));
  console.log(`     disco: note=${v.note.length} eventi=${v.eventi.length} orfane=[${v.orfane}]`);
  verifica("4.a nessuna nota orfana", v.orfane.length === 0, `(orfane=[${v.orfane}])`);
  verifica("4.b nessun evento senza nota", v.eventiSenzaNota.length === 0, `(${v.eventiSenzaNota})`);
  verifica("4.c le due note ci sono entrambe", v.note.length === 2, `(note=${v.note.length})`);
  verifica("4.d nessuna promessa rigetta", errori.length === 0, `(${errori.join(" | ")})`);

  // Dieci tocchi ravvicinati, per non fermarsi al caso fortunato di due.
  const molti = await Promise.allSettled(
    Array.from({ length: 10 }, (_, i) => salva(`raffica-${i}`, `tocco ${i}`))
  );
  const v2 = leggiDalDisco(join(cartella, "SQLite", "percorso.db"));
  console.log(`     raffica di 10: note=${v2.note.length} eventi=${v2.eventi.length} orfane=[${v2.orfane}]`);
  verifica("4.e dieci tocchi insieme: nessuna orfana", v2.orfane.length === 0, `(${v2.orfane})`);
  verifica("4.f dieci tocchi insieme: nessun rigetto",
    molti.every((e) => e.status === "fulfilled"),
    `(${molti.filter((e) => e.status === "rejected").map((e) => String(e.reason?.message)).join(" | ")})`);

  // L'altra strada citata dal difetto: la sincronizzazione che applica un
  // pacchetto mentre l'utente scrive. Passa da inTransazione(), non da registra().
  const pacchetto = app.inTransazione(async (d) => {
    await d.runAsync(
      `INSERT INTO eventi (id, hlc, dispositivo, entita, entita_id, tipo, payload)
       VALUES (?,?,?,?,?,?,?)`,
      ["remoto:nota-r", "zzz", "disp-B", "note", "nota-r", "crea", "{}"]
    );
    await proiezioneNuovaNota("nota-r", "da remoto", "arrivata dall'altro dispositivo")(d, "zzz");
  });
  const misto = await Promise.allSettled([pacchetto, salva("nota-locale", "mentre sincronizza")]);
  const v3 = leggiDalDisco(join(cartella, "SQLite", "percorso.db"));
  console.log(`     sync + scrittura: note=${v3.note.length} eventi=${v3.eventi.length} orfane=[${v3.orfane}]`);
  verifica("4.g sync e scrittura accavallate: nessuna orfana", v3.orfane.length === 0, `(${v3.orfane})`);
  verifica("4.h sync e scrittura accavallate: nessun rigetto",
    misto.every((e) => e.status === "fulfilled"),
    `(${misto.filter((e) => e.status === "rejected").map((e) => String(e.reason?.message)).join(" | ")})`);
  void base;
}

console.log(`\n${passate} verifiche passate, ${rotte.length} rotte`);
if (rotte.length) { console.log(`cartella conservata: ${cartella}`); process.exit(1); }
rmSync(cartella, { recursive: true, force: true });
