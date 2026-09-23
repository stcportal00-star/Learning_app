/**
 * CONTROPROVA (lente "conseguenza") al difetto n.1 — "due scritture non attese
 * si interfogliano sul BEGIN e lasciano una proiezione SENZA il suo evento".
 *
 * ESITO DELLA CONTROPROVA: il difetto NON si confuta. Era reale, raggiungibile
 * con un gesto ordinario, e nel frattempo e' stato CORRETTO in lib/db.ts con la
 * coda `inCoda`/`inTransazione`. Questo file cambia quindi mestiere: da prova
 * del difetto a GUARDIA della correzione.
 *
 * Comando:
 *   node --import ./test/banco/carica.mjs test/simulazione/controprova-1-conseguenza.mjs
 *
 * COSA AVEVO MISURATO PRIMA DELLA CORREZIONE (lib/db.ts senza coda, registra()
 * che chiamava d.withTransactionAsync direttamente). Ordine delle istruzioni
 * registrato mettendo una spia su execSync/runSync dell'istanza:
 *
 *     A: BEGIN                      <- la transazione di A si apre
 *     B: BEGIN  -> ERRORE "cannot start a transaction within a transaction"
 *     A: INSERT eventi              <- dentro la transazione di A
 *     B: ROLLBACK                   <- il catch di B annulla la transazione di A
 *     A: INSERT note                <- ora in autocommit: RESTA
 *     A: INSERT meta                <- in autocommit: RESTA
 *     A: COMMIT -> ERRORE, poi ROLLBACK -> ERRORE
 *
 *   risultato sul disco: 0 eventi, 1 riga note, meta.hlc avanzato.
 *   Invariante 1 rotta, entrambe le promesse rigettate, e siccome salva() di
 *   app/(tabs)/note.tsx non ha try/catch e onPress non attende la promessa,
 *   in release l'utente non vedeva NULLA.
 *
 * LA FINESTRA, misurata dando al database la latenza del telefono (ogni
 * chiamata e' un viaggio verso il thread nativo, il COMMIT in WAL fa una
 * fsync). Prima della correzione, con transazione ~18 ms:
 *     secondo scrittore a +0/+1 ms -> proiezione ORFANA (invariante 1 rotta)
 *     a +3..+12 ms                 -> ENTRAMBE le scritture sparite, in silenzio
 *     a +18 ms e oltre             -> sano
 *   Su un telefono lento (fsync sotto carico, transazione ~80 ms) la finestra
 *   si allargava fino a ~80 ms. Era una corsa vera, non un guasto fisso.
 *
 * PER RIFARE LA FALSIFICAZIONE: in lib/db.ts sostituire il corpo di inCoda con
 * `return compito();` (cioe' togliere la coda). Le verifiche di F1, della
 * finestra e di F3 qui sotto tornano rosse.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { configuraCartella } from "../banco/expo-sqlite.mjs";

const cartella = configuraCartella(mkdtempSync(join(tmpdir(), "controprova-1-")));
const app = await import("../../lib/db.ts");

let verdi = 0, rosse = 0;
function verifica(descrizione, condizione, dettaglio = "") {
  if (condizione) { verdi++; console.log("  ok   " + descrizione); }
  else { rosse++; console.log("  ROSSA " + descrizione + (dettaglio ? " -> " + dettaglio : "")); }
}
function titolo(t) { console.log("\n== " + t); }

await app.apri("dispositivo-a");
const base = app.database();

/** Copia fedele di salva() di app/(tabs)/note.tsx:46-65, senza lo stato di React. */
function salvaNota({ id, titolo: tit, testo, nuovo }) {
  return app.registra("note", id, nuovo ? "crea" : "aggiorna",
    { titolo: tit, testo, pubblicabile: 0 },
    async (d, hlc) => {
      if (nuovo) {
        await d.runAsync(
          `INSERT INTO note (id, titolo, testo, pubblicabile, creato_a, hlc) VALUES (?,?,?,?,?,?)`,
          [id, tit || null, testo, 0, new Date().toISOString(), hlc]);
      } else {
        await d.runAsync(
          `UPDATE note SET titolo = ?, testo = ?, pubblicabile = ?, hlc = ? WHERE id = ?`,
          [tit || null, testo, 0, hlc, id]);
      }
    });
}
const conta = async (sql, p = []) => (await base.getFirstAsync(`SELECT COUNT(*) AS n ${sql}`, p)).n;

// Spia sulle istruzioni davvero eseguite: e' l'unico modo di vedere un BEGIN
// annidato, perche' a valle il danno si vede solo come righe mancanti.
const istruzioni = [];
let spiaAccesa = false;
for (const metodo of ["execSync", "runSync"]) {
  const originale = base[metodo].bind(base);
  base[metodo] = (...a) => {
    if (spiaAccesa) istruzioni.push(String(a[0]).replace(/\s+/g, " ").trim().slice(0, 24));
    return originale(...a);
  };
}
const conSpia = async (fa) => {
  istruzioni.length = 0; spiaAccesa = true;
  try { return await fa(); } finally { spiaAccesa = false; }
};
/** Una transazione annidata si vede come due BEGIN senza un COMMIT in mezzo. */
function beginAnnidato() {
  let aperta = false;
  for (const i of istruzioni) {
    if (/^BEGIN/i.test(i)) { if (aperta) return true; aperta = true; }
    if (/^COMMIT|^ROLLBACK/i.test(i)) aperta = false;
  }
  return false;
}

// ---------------------------------------------------------------------------
titolo("CONTROLLO — due salvataggi SEQUENZIALI (un tocco, poi l'altro)");
{
  const id = randomUUID();
  await salvaNota({ id, titolo: "nota seq", testo: "primo", nuovo: true });
  await salvaNota({ id, titolo: "nota seq", testo: "secondo", nuovo: false });
  verifica("2 eventi nel registro", await conta("FROM eventi WHERE entita_id = ?", [id]) === 2);
  verifica("1 riga nota con l'ultimo testo",
    (await base.getFirstAsync("SELECT testo FROM note WHERE id = ?", [id]))?.testo === "secondo");
}

// ---------------------------------------------------------------------------
titolo("F1 — DOPPIO TOCCO su Salva (app/(tabs)/note.tsx:127, nessuna guardia sul bottone)");
{
  // Fedele a salva(): ogni tocco chiama Crypto.randomUUID() per conto suo e
  // apertaId e' ancora "nuova" per entrambi (React non ha ancora ridisegnato),
  // quindi i due tocchi creano DUE id distinti, tutti e due con tipo 'crea'.
  const id1 = randomUUID(), id2 = randomUUID();
  const esiti = await conSpia(() => Promise.allSettled([
    salvaNota({ id: id1, titolo: "doppio tocco", testo: "contenuto importante", nuovo: true }),
    salvaNota({ id: id2, titolo: "doppio tocco", testo: "contenuto importante", nuovo: true }),
  ]));
  const eventi = await conta("FROM eventi WHERE entita_id IN (?,?)", [id1, id2]);
  const note = await conta("FROM note WHERE id IN (?,?)", [id1, id2]);
  console.log("     istruzioni: " + istruzioni.join(" | "));
  verifica("nessun BEGIN annidato: la coda ha serializzato le due scritture", !beginAnnidato());
  verifica("nessuna delle due chiamate e' rigettata", esiti.every((e) => e.status === "fulfilled"),
    JSON.stringify(esiti.map((e) => e.reason?.message)));
  verifica("INVARIANTE 1: 2 eventi per 2 righe note", eventi === 2 && note === 2,
    "eventi=" + eventi + " note=" + note);
  const daInviare = await app.daSincronizzare();
  verifica("tutte e due le note partiranno verso l'altro dispositivo",
    [id1, id2].every((x) => daInviare.some((e) => e.entita_id === x)));
}

// ---------------------------------------------------------------------------
titolo("F1bis — doppio tocco sullo STESSO id (schermo gia' ridisegnato fra i due tocchi)");
{
  const id = randomUUID();
  const esiti = await conSpia(() => Promise.allSettled([
    salvaNota({ id, titolo: "stesso id", testo: "a", nuovo: true }),
    salvaNota({ id, titolo: "stesso id", testo: "b", nuovo: false }),
  ]));
  verifica("nessun BEGIN annidato", !beginAnnidato(), istruzioni.join(" | "));
  verifica("2 eventi, 1 riga: la seconda scrittura aggiorna la prima",
    await conta("FROM eventi WHERE entita_id = ?", [id]) === 2 &&
    await conta("FROM note WHERE id = ?", [id]) === 1);
  verifica("nessun rigetto", esiti.every((e) => e.status === "fulfilled"));
}

// ---------------------------------------------------------------------------
titolo("LA FINESTRA — con la latenza del telefono, a ogni distanza");
{
  // Sotto il banco c'e' node:sqlite, che e' sincrono: una finestra misurata in
  // giri di event loop non direbbe niente all'utente. Qui do all'ISTANZA la
  // latenza del dispositivo e misuro in millisecondi.
  const dormi = (ms) => new Promise((r) => setTimeout(r, ms));
  const originali = {};
  let LATENZA = 4, FSYNC = 60;  // telefono economico, fsync sotto carico di I/O
  for (const metodo of ["execAsync", "runAsync", "getFirstAsync", "getAllAsync"]) {
    originali[metodo] = base[metodo].bind(base);
    base[metodo] = async (...a) => {
      await dormi(LATENZA + (metodo === "execAsync" && /COMMIT/i.test(String(a[0])) ? FSYNC : 0));
      return originali[metodo](...a);
    };
  }
  const esiti = [];
  for (const ms of [0, 1, 10, 30, 60, 90]) {
    const id1 = randomUUID(), id2 = randomUUID();
    const a = salvaNota({ id: id1, testo: "c", nuovo: true });
    await dormi(ms);
    const b = salvaNota({ id: id2, testo: "c", nuovo: true });
    const r = await conSpia(() => Promise.allSettled([a, b]));
    const eventi = await conta("FROM eventi WHERE entita_id IN (?,?)", [id1, id2]);
    const note = await conta("FROM note WHERE id IN (?,?)", [id1, id2]);
    const sano = eventi === 2 && note === 2 && r.every((e) => e.status === "fulfilled") && !beginAnnidato();
    esiti.push([ms, sano]);
    console.log("     +" + String(ms).padStart(2) + " ms -> eventi=" + eventi + " note=" + note +
                (sano ? "   sano" : "   DANNEGGIATO"));
  }
  verifica("transazione ~" + (LATENZA * 5 + FSYNC) + " ms: sano a ogni distanza (prima rompeva fino a ~" +
    (LATENZA * 5 + FSYNC) + " ms)", esiti.every(([, s]) => s), JSON.stringify(esiti));
  for (const metodo of Object.keys(originali)) base[metodo] = originali[metodo];
}

// ---------------------------------------------------------------------------
titolo("F3 — il pacchetto remoto (lib/sync/useAutoSync.ts) mentre l'utente salva");
{
  // Copia fedele del blocco corretto di useAutoSync.ts: ora passa da inTransazione().
  const ricevuti = Array.from({ length: 40 }, (_, n) => ({
    id: "remoto-" + n, hlc: "0000018f0000-0000-dispositivo-b", dispositivo: "dispositivo-b",
    entita: "note", entita_id: "nota-remota-" + n, tipo: "crea", payload: "{}",
  }));
  const idLocale = randomUUID();
  const esiti = await conSpia(() => Promise.allSettled([
    app.inTransazione(async (d) => {
      for (const e of ricevuti) {
        await d.runAsync(
          `INSERT OR IGNORE INTO eventi
           (id, hlc, dispositivo, entita, entita_id, tipo, payload, sincronizzato)
           VALUES (?,?,?,?,?,?,?,1)`,
          [e.id, e.hlc, e.dispositivo, e.entita, e.entita_id, e.tipo, e.payload]);
      }
    }),
    salvaNota({ id: idLocale, titolo: "mentre sincronizza", testo: "ciao", nuovo: true }),
  ]));
  const remoti = await conta("FROM eventi WHERE dispositivo = 'dispositivo-b'");
  verifica("nessun BEGIN annidato fra fusione e scrittura locale", !beginAnnidato());
  verifica("tutti e 40 gli eventi remoti applicati", remoti === 40, "remoti=" + remoti);
  verifica("la scrittura locale dell'utente e' integra",
    await conta("FROM eventi WHERE entita_id = ?", [idLocale]) === 1 &&
    await conta("FROM note WHERE id = ?", [idLocale]) === 1);
  verifica("nessun rigetto", esiti.every((e) => e.status === "fulfilled"),
    JSON.stringify(esiti.map((e) => e.reason?.message)));
}

// ---------------------------------------------------------------------------
titolo("RISCHIO RESIDUO — una transazione aperta FUORI dalla coda rompe ancora tutto");
{
  // La coda protegge solo chi ci passa. Questa sezione tiene in vita la prova
  // del difetto originale: se un domani qualcuno riscrive
  // `database().withTransactionAsync(...)` invece di `inTransazione(...)`,
  // il danno torna identico a quello misurato prima della correzione.
  const idLocale = randomUUID();
  const esiti = await conSpia(() => Promise.allSettled([
    base.withTransactionAsync(async () => {          // <- NON in coda: la via vietata
      await base.runAsync("INSERT OR IGNORE INTO meta (chiave, valore) VALUES (?,?)", ["fuori", "1"]);
      await base.runAsync("INSERT OR IGNORE INTO meta (chiave, valore) VALUES (?,?)", ["fuori2", "1"]);
    }),
    salvaNota({ id: idLocale, titolo: "vittima", testo: "perduta", nuovo: true }),
  ]));
  const eventoLocale = await conta("FROM eventi WHERE entita_id = ?", [idLocale]);
  const notaLocale = await conta("FROM note WHERE id = ?", [idLocale]);
  console.log("     istruzioni: " + istruzioni.join(" | "));
  console.log("     esiti: " + esiti.map((e) => e.status + (e.reason ? " (" + e.reason.message + ")" : "")).join(" | "));
  verifica("il BEGIN annidato si ripresenta (la coda non copre chi non ci passa)", beginAnnidato());
  verifica("e la scrittura dell'utente viene danneggiata",
    !(eventoLocale === 1 && notaLocale === 1),
    "evento=" + eventoLocale + " nota=" + notaLocale);
  console.log("     -> lasciare `inTransazione()` come unica porta: e' questa la correzione.");
}

// ---------------------------------------------------------------------------
console.log("\n=== " + verdi + " verdi, " + rosse + " rosse");
if (rosse === 0) rmSync(cartella, { recursive: true, force: true });
else console.log("cartella conservata: " + cartella);
process.exit(rosse === 0 ? 0 : 1);
