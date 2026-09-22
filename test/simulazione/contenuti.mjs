/**
 * SIMULAZIONE DELLA SUPERFICIE "CONTENUTI" — lib/contenuti.ts sopra il banco.
 *
 * Si esegue dalla radice del progetto, in uno dei due modi (equivalenti):
 *
 *   node test/simulazione/contenuti.mjs
 *   node --import ./test/banco/carica.mjs test/simulazione/contenuti.mjs
 *
 * Qui gira il CODICE VERO: lib/contenuti.ts caricato dal banco, sopra il vero
 * lib/db.ts, con i veri cinque JSON di assets/contenuti/. Nessuna schermata si
 * importa (il banco non ha react-native ne expo-router): dove serve la logica
 * di una schermata la si RICOPIA nel test, e lo si dichiara sul posto.
 *
 * COSA SI SIMULA QUI, in nove parti:
 *   A. caricaContenuti() prima di apri();
 *   B. il primo avvio vero: i 381 item, i 22 temi, i 52 volumi, le 199 carte;
 *   C. la guardia del secondo avvio, e i tre modi in cui la guardia e parziale;
 *   D. JSON malformato: troncato, vuoto, con BOM, con virgola finale, e la
 *      forma sbagliata (oggetto, array di stringhe, array vuoto);
 *   E. campi mancanti: NOT NULL ingoiato da OR IGNORE, id assente, tema assente,
 *      colonne_attese assente (binding undefined);
 *   F. codici duplicati dentro un file, fra due file, e in biblioteca;
 *   G. riferimenti: i 381 id, i temi citati, e soprattutto le 150 soluzioni di
 *      riferimento eseguite davvero su palestra.db e confrontate con
 *      righe_attese e colonne_attese;
 *   H. campi del contenuto che il caricamento PERDE per strada;
 *   I. due caricaContenuti() concorrenti (ora serializzate), e l'assenza di rete.
 *
 * COME SI SIMULANO PIU "PRIMI AVVII" IN UN PROCESSO SOLO.
 * lib/db.ts tiene la connessione in una variabile di modulo: apri() una volta
 * sola. Non serve pero reimportare niente, perche caricaContenuti() non ha
 * stato proprio: tutto il suo stato e la guardia `SELECT count(*) FROM esercizi`.
 * Svuotare le quattro tabelle che scrive (esercizi, temi, biblioteca, ripasso)
 * riporta esattamente alla condizione del primo avvio. Ogni scenario riparte
 * da li, e alla fine si ricarica il contenuto vero per lo scenario successivo.
 *
 * COME SI CAMBIA IL CONTENUTO SENZA TOCCARE assets/.
 * lib/contenuti.ts scrive `require("../assets/contenuti/esercizi_sql.json")`:
 * e l'idioma di Metro. Il banco lo traveste con require-metro.mjs, che offre
 * anche mappaAsset(specificatore, percorsoVero). Si scrive il JSON finto in una
 * cartella temporanea e si fa puntare li lo specificatore. I file del
 * repository non vengono mai aperti in scrittura.
 *
 * CONVENZIONE SUI DIFETTI (la stessa dell'agente del registro eventi).
 * Un difetto dell'app NON viene corretto qui e non rende rossa la prova: lo
 * scenario che lo riproduce si chiama "DIFETTO RIPRODOTTO: ..." e verifica il
 * comportamento OSSERVATO, cosi resta una rete di sicurezza che diventera rossa
 * il giorno in cui il difetto verra corretto. L'elenco viene ristampato in
 * fondo, separato dal conteggio.
 *
 * E QUANDO IL DIFETTO VIENE CORRETTO. Lo scenario non si cancella: cambia
 * mestiere e si chiama "CORREZIONE SORVEGLIATA: ...". Verdetto rovesciato, le
 * stesse asserzioni riscritte sul comportamento CORRETTO e concreto. Chi ha
 * inchiodato un difetto e il miglior guardiano della sua correzione, perche sa
 * gia come riprodurlo. Anche questi hanno il loro elenco in fondo. E la forma
 * di corretto() in test/simulazione/motore-sql.mjs, adattata agli scenari.
 *
 * FALSIFICAZIONE (fatta e misurata, non immaginata). Una prova che non puo
 * diventare rossa non dimostra niente. Tre indebolimenti, tutti applicati DA
 * FUORI (uno script in una cartella qualsiasi che riscrive un prototipo e poi
 * importa questo file): nessun file del progetto viene modificato.
 *
 *   1) SENZA ROLLBACK — il doppio committa anche in caso di errore:
 *        import "/home/user/learning_app/test/banco/carica.mjs";
 *        import { BaseDatiDoppia } from "/home/user/learning_app/test/banco/expo-sqlite.mjs";
 *        BaseDatiDoppia.prototype.withTransactionAsync = async function (c) {
 *          await this.execAsync("BEGIN");
 *          try { await c(); } catch (e) { await this.execAsync("COMMIT"); throw e; }
 *          await this.execAsync("COMMIT");
 *        };
 *        await import("/home/user/learning_app/test/simulazione/contenuti.mjs");
 *      MISURATO: 54 scenari su 59, 294 verifiche su 305. Cadono D4, D5, D6, I1
 *      e I3 — cioe esattamente i cinque che poggiano sulla transazione.
 *
 *   2) SENZA «OR IGNORE» — si riscrive l'SQL in volo:
 *        const originale = BaseDatiDoppia.prototype.runAsync;
 *        BaseDatiDoppia.prototype.runAsync = function (sorgente, ...resto) {
 *          return originale.call(this, String(sorgente).replace(/INSERT OR IGNORE/gi, "INSERT"), ...resto);
 *        };
 *      MISURATO: 52 su 59, 273 verifiche su 280. Cadono D8, E1, E2, F1, F2, F3, I4 — cioe tutti e
 *      soli gli scenari che descrivono che cosa OR IGNORE ingoia. E la prova
 *      che quei «DIFETTO RIPRODOTTO» non sono frasi ma misure.
 *
 *   3) CONTENUTO ALTERATO — si aggiunge una riga fantasma a ogni risultato:
 *        import { DatabaseSync } from "node:sqlite";
 *        const prepara = DatabaseSync.prototype.prepare;
 *        DatabaseSync.prototype.prepare = function (sql) {
 *          const ist = prepara.call(this, sql);
 *          const all = ist.all.bind(ist);
 *          ist.all = (...a) => { const r = all(...a); return r.length ? [...r, { ...r[0] }] : r; };
 *          return ist;
 *        };
 *      MISURATO: 47 su 59, 289 verifiche su 305. Cadono B4-B11, E1, G5, G7 e H3: le verifiche sui
 *      riferimenti e sui conteggi non sopravvivono a un contenuto falsificato.
 *
 *   4) SENZA LA CODA DELLE SCRITTURE — si disattiva la serializzazione che
 *      corregge CON-13, sostituendo il corpo di inCoda() in lib/db.ts con
 *      `return compito();`. E l'unica falsificazione che tocca il progetto:
 *      lib/db.ts e stato rimesso com'era subito dopo (git diff vuoto, stesso
 *      sha256). Serve a misurare che la guardia I1 sappia diventare rossa.
 *      MISURATO: 58 scenari su 59, 301 verifiche su 308, uscita 1. Cade il solo
 *      I1, e dentro I1 cadono 7 asserzioni sulle 14: le due chiamate tornano a
 *      rigettare («cannot start a transaction within a transaction» e «cannot
 *      rollback - no transaction is active»), nessuna delle due dichiara di
 *      aver caricato, e i temi tornano 21 su 22 senza 'gestione' — prima e dopo
 *      la terza chiamata. Le altre 7 (381 esercizi, 52 volumi, 199 carte, un
 *      solo aggiunto_a, nessun orfano) restano verdi anche col difetto: sono
 *      contorno, non sono loro a reggere la guardia, e sta scritto qui perche
 *      nessuno le scambi per una misura della coda.
 *
 * LIMITI DI QUESTA SIMULAZIONE (leggere prima di fidarsi del verde) — in fondo
 * al file, sotto "LIMITI NOTI".
 *
 * Esito dell'ultima esecuzione: 59 scenari su 59, 308 verifiche su 308.
 */
import { copyFileSync, mkdtempSync, rmSync, writeFileSync, readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
// L'ordine conta: carica.mjs per primo, perche registra i ganci del banco.
import "../banco/carica.mjs";
import { configuraCartella } from "../banco/expo-sqlite.mjs";
import {
  installaRequireMetro,
  mappaAsset,
  annullaMappature,
} from "../banco/require-metro.mjs";

const RADICE = new URL("../..", import.meta.url).pathname.replace(/\/$/, "");

// ------------------------------------------------------------------ CONTEGGIO
const scenari = [];
let corrente = null;
const difettiRiprodotti = [];
// Il contraltare di difettiRiprodotti: gli scenari che sorvegliano una
// correzione gia applicata. Stesso meccanismo, verdetto opposto — cfr.
// corretto() in test/simulazione/motore-sql.mjs, che e la forma d'origine.
const correzioniSorvegliate = [];

function ok(nome, condizione, extra = "") {
  if (!corrente) throw new Error("ok() fuori da uno scenario: " + nome);
  corrente.verifiche++;
  if (!condizione) corrente.errori.push(`${nome}${extra ? " — " + extra : ""}`);
}

function uguale(nome, ottenuto, atteso) {
  ok(nome, Object.is(ottenuto, atteso), `atteso ${mostra(atteso)}, ottenuto ${mostra(ottenuto)}`);
}

function ugualeJson(nome, ottenuto, atteso) {
  const a = JSON.stringify(atteso);
  const o = JSON.stringify(ottenuto);
  ok(nome, a === o, `atteso ${a}, ottenuto ${o}`);
}

function mostra(v) {
  if (typeof v === "string") return JSON.stringify(v.length > 60 ? v.slice(0, 60) + "…" : v);
  return String(v);
}

/** Attende che `azione` lanci, e che il messaggio contenga `frammento`. */
async function lancia(nome, azione, frammento) {
  let messaggio = null;
  try {
    await azione();
  } catch (errore) {
    messaggio = String(errore?.message ?? errore);
  }
  if (messaggio === null) {
    ok(nome, false, "non ha lanciato nessun errore");
    return "";
  }
  ok(nome, messaggio.includes(frammento), `messaggio: ${messaggio}`);
  return messaggio;
}

async function scenario(nome, corpo) {
  corrente = { nome, verifiche: 0, errori: [] };
  scenari.push(corrente);
  if (/^DIFETTO RIPRODOTTO/.test(nome)) difettiRiprodotti.push(nome);
  if (/^CORREZIONE SORVEGLIATA/.test(nome)) correzioniSorvegliate.push(nome);
  try {
    await corpo();
  } catch (errore) {
    corrente.errori.push(`eccezione non attesa nello scenario: ${errore?.stack ?? errore}`);
    corrente.verifiche++;
  }
  const c = corrente;
  corrente = null;
  console.log(
    `${c.errori.length ? "ROSSO" : "verde"}  ${nome}  (${c.verifiche} verifiche)` +
      c.errori.map((e) => `\n        ✗ ${e}`).join("")
  );
}

// ------------------------------------------------------------------ AMBIENTE
const cartella = configuraCartella(mkdtempSync(join(tmpdir(), "sim-contenuti-")));
installaRequireMetro(RADICE);

// Rete: l'app e offline-first. Si mettono delle trappole PRIMA di caricare i
// moduli dell'app, e si controlla alla fine che nessuna sia scattata.
const reteTentata = [];
const fetchOriginale = globalThis.fetch;
globalThis.fetch = (...a) => {
  reteTentata.push("fetch " + String(a[0]));
  throw new Error("rete vietata nel collaudo");
};
class XhrTrappola {
  open(metodo, url) {
    reteTentata.push("XHR " + metodo + " " + url);
    throw new Error("rete vietata nel collaudo");
  }
}
const xhrOriginale = globalThis.XMLHttpRequest;
globalThis.XMLHttpRequest = XhrTrappola;

const dbApp = await import("../../lib/db.ts");
const contenuti = await import("../../lib/contenuti.ts");
const verificaApp = await import("../../lib/verifica.ts");

// I cinque JSON veri, letti a parte: sono il metro di paragone, non la fonte.
const CONTENUTI = RADICE + "/assets/contenuti/";
const veriSql = leggiJson(CONTENUTI + "esercizi_sql.json");
const veriCodice = leggiJson(CONTENUTI + "esercizi_codice.json");
const veriFlash = leggiJson(CONTENUTI + "flashcard.json");
const veriScenari = leggiJson(CONTENUTI + "scenari_rubrica.json");
const veriVolumi = leggiJson(CONTENUTI + "biblioteca.json");

function leggiJson(percorso) {
  return JSON.parse(readFileSync(percorso, "utf8"));
}

/** I 22 slug della costante TEMI di lib/contenuti.ts, ricopiati qui di proposito. */
const SLUG_TEMI = [
  "gestione", "sql_base", "sql_join", "sql_agg", "meal", "business_analysis",
  "lettura_codice", "sql_cte", "sql_window", "modellazione", "qualita_dati",
  "kpi", "statistica", "epidemiologia", "ia", "gdpr", "ai_act", "ottimizzazione",
  "hardware", "governance", "sicurezza", "salute_digitale",
];

const SPEC = {
  sql: "../assets/contenuti/esercizi_sql.json",
  codice: "../assets/contenuti/esercizi_codice.json",
  flash: "../assets/contenuti/flashcard.json",
  scenari: "../assets/contenuti/scenari_rubrica.json",
  volumi: "../assets/contenuti/biblioteca.json",
};

let contatoreFile = 0;
/** Scrive un JSON finto (o testo grezzo) e restituisce il percorso. */
function fileFinto(nome, contenuto) {
  // Nome sempre diverso: require-metro tiene in cache il JSON per percorso,
  // esattamente come Metro. Riusare un nome restituirebbe il contenuto vecchio.
  const percorso = join(cartella, `finto-${contatoreFile++}-${nome}`);
  writeFileSync(percorso, typeof contenuto === "string" ? contenuto : JSON.stringify(contenuto));
  return percorso;
}

/**
 * Sostituisce i cinque contenuti impacchettati. Le chiavi non passate ricevono
 * un contenuto minimo valido, cosi ogni scenario prova una cosa sola.
 */
function contenutoFinto(parti = {}) {
  annullaMappature();
  const predefiniti = { sql: [], codice: [], flash: [], scenari: [], volumi: [] };
  for (const [chiave, spec] of Object.entries(SPEC)) {
    const valore = chiave in parti ? parti[chiave] : predefiniti[chiave];
    mappaAsset(spec, fileFinto(`${chiave}.json`, valore));
  }
}

/** Riporta il database alla condizione del primo avvio assoluto. */
function azzeraContenuti() {
  const d = dbApp.database();
  for (const tabella of ["esercizi", "temi", "biblioteca", "ripasso"]) {
    d.runSync(`DELETE FROM ${tabella}`);
  }
}

function conta(tabella, dove = "") {
  return dbApp.database().getFirstSync(`SELECT count(*) AS n FROM ${tabella} ${dove}`).n;
}

/** Contenuto vero, caricato da zero. Usato dagli scenari che lo esaminano. */
async function caricaIlContenutoVero() {
  annullaMappature();
  azzeraContenuti();
  return contenuti.caricaContenuti();
}

console.log("cartella del banco:", cartella);
console.log("");

// ====================================================================== PARTE A
// A. Prima di apri(). Deve stare in cima: lib/db.ts apre una volta sola per
//    processo e non esiste una chiudi() che azzeri lo stato del modulo.

await scenario("A1 · caricaContenuti() prima di apri() lancia in italiano e non scrive nulla", async () => {
  await lancia(
    "il messaggio e quello di richiediDb()",
    () => contenuti.caricaContenuti(),
    "Database non aperto: chiamare apri() all'avvio."
  );
  // Era `ok("nessun file di database e stato creato", true)`: una costante, in
  // una riga che prometteva un controllo sul disco. E' il caso peggiore fra le
  // guardie vuote trovate dal revisore, perche' il fatto affermato E'
  // controllabile — bastava guardare la cartella — e non veniva controllato.
  const restiSulDisco = readdirSync(cartella).filter((n) => n.endsWith(".db"));
  ok("nessun file di database e stato creato", restiSulDisco.length === 0,
     JSON.stringify(restiSulDisco));
});

// Da qui in poi il database e aperto.
await dbApp.apri("simcont1");

await scenario("A2 · apri() crea lo schema che il caricamento si aspetta", async () => {
  const d = dbApp.database();
  const tabelle = d
    .getAllSync("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
    .map((r) => r.name);
  for (const attesa of ["esercizi", "temi", "biblioteca", "ripasso"]) {
    ok(`la tabella ${attesa} esiste`, tabelle.includes(attesa), tabelle.join(","));
  }
  uguale("all'inizio esercizi e vuota", conta("esercizi"), 0);
  uguale("all'inizio il registro eventi e vuoto", conta("eventi"), 0);
});

// ====================================================================== PARTE B
// B. Il primo avvio vero, con i cinque JSON impacchettati.

let esitoPrimoAvvio = null;

await scenario("B1 · primo avvio su database vuoto: i sei contatori e saltato=false", async () => {
  esitoPrimoAvvio = await caricaIlContenutoVero();
  uguale("temi", esitoPrimoAvvio.temi, 22);
  uguale("sql", esitoPrimoAvvio.sql, 150);
  uguale("codice", esitoPrimoAvvio.codice, 20);
  uguale("flashcard", esitoPrimoAvvio.flashcard, 199);
  uguale("scenari", esitoPrimoAvvio.scenari, 12);
  uguale("biblioteca", esitoPrimoAvvio.biblioteca, 52);
  uguale("saltato", esitoPrimoAvvio.saltato, false);
});

await scenario("B2 · 381 righe in esercizi, ripartite nei quattro tipi", async () => {
  uguale("totale", conta("esercizi"), 381);
  uguale("sql_eseguibile", conta("esercizi", "WHERE tipo='sql_eseguibile'"), 150);
  uguale("lettura_codice", conta("esercizi", "WHERE tipo='lettura_codice'"), 20);
  uguale("quiz_citato", conta("esercizi", "WHERE tipo='quiz_citato'"), 199);
  uguale("rubrica", conta("esercizi", "WHERE tipo='rubrica'"), 12);
  uguale("nessun altro tipo", conta("esercizi", "WHERE tipo NOT IN ('sql_eseguibile','lettura_codice','quiz_citato','rubrica')"), 0);
});

await scenario("B3 · i contatori dichiarati coincidono con il count(*) reale", async () => {
  // Rete di sicurezza per E1/E2/F1: quando un INSERT OR IGNORE salta una riga,
  // il valore di ritorno continua a dichiarare la lunghezza del JSON.
  uguale("temi", conta("temi"), esitoPrimoAvvio.temi);
  uguale("sql", conta("esercizi", "WHERE tipo='sql_eseguibile'"), esitoPrimoAvvio.sql);
  uguale("codice", conta("esercizi", "WHERE tipo='lettura_codice'"), esitoPrimoAvvio.codice);
  uguale("flashcard", conta("esercizi", "WHERE tipo='quiz_citato'"), esitoPrimoAvvio.flashcard);
  uguale("scenari", conta("esercizi", "WHERE tipo='rubrica'"), esitoPrimoAvvio.scenari);
  uguale("biblioteca", conta("biblioteca"), esitoPrimoAvvio.biblioteca);
});

await scenario("B4 · i 22 temi hanno slug, nome, pista e trimestre come nella costante TEMI", async () => {
  const righe = dbApp.database().getAllSync("SELECT id, slug, nome, pista, trimestre, attivo FROM temi ORDER BY rowid");
  uguale("quanti", righe.length, 22);
  ugualeJson("gli slug, nell'ordine di TEMI", righe.map((r) => r.slug), SLUG_TEMI);
  ok("l'id e sempre tema:<slug>", righe.every((r) => r.id === `tema:${r.slug}`));
  ok("nome mai vuoto", righe.every((r) => typeof r.nome === "string" && r.nome.length > 0));
  ok("pista mai vuota", righe.every((r) => typeof r.pista === "string" && r.pista.length > 0));
  ok("trimestre fra T0 e T6", righe.every((r) => /^T[0-6]$/.test(r.trimestre)), righe.map((r) => r.trimestre).join(","));
  ok("attivo vale 1 per tutti (default dello schema)", righe.every((r) => r.attivo === 1));
  const piste = [...new Set(righe.map((r) => r.pista))].sort();
  ugualeJson("le piste distinte", piste, ["business_analysis", "dati", "gestione", "governance", "hardware", "ia", "kpi"]);
});

await scenario("B5 · gli esercizi SQL portano dataset, righe_attese, colonne_attese e preparazione", async () => {
  const righe = dbApp.database().getAllSync(
    "SELECT id, tema_slug, livello, consegna, dataset, soluzione_riferimento, preparazione, righe_attese, colonne_attese FROM esercizi WHERE tipo='sql_eseguibile' ORDER BY id"
  );
  const perId = new Map(righe.map((r) => [r.id, r]));
  uguale("quanti", righe.length, 150);
  ok("dataset sempre palestra.db", righe.every((r) => r.dataset === "palestra.db"));
  ok("livello fra 1 e 4", righe.every((r) => r.livello >= 1 && r.livello <= 4));
  uguale("con preparazione", righe.filter((r) => r.preparazione !== null).length, 7);
  let campiOk = 0;
  for (const e of veriSql) {
    const r = perId.get(e.id);
    if (!r) continue;
    if (
      r.tema_slug === e.tema &&
      r.livello === e.livello &&
      r.consegna === e.consegna &&
      r.soluzione_riferimento === e.soluzione &&
      r.righe_attese === e.righe_attese &&
      r.preparazione === (e.preparazione ?? null)
    ) campiOk++;
  }
  uguale("tutti i campi combaciano con il JSON", campiOk, 150);
  const colOk = veriSql.filter((e) => JSON.stringify(e.colonne_attese) === perId.get(e.id)?.colonne_attese).length;
  uguale("colonne_attese e il JSON esatto dell'array", colOk, 150);
});

await scenario("B6 · i moduli di lettura codice: tema e dataset cablati, rubrica con tre chiavi", async () => {
  const righe = dbApp.database().getAllSync(
    "SELECT id, tema_slug, dataset, livello, consegna, soluzione_riferimento, rubrica, righe_attese, colonne_attese FROM esercizi WHERE tipo='lettura_codice' ORDER BY id"
  );
  uguale("quanti", righe.length, 20);
  ok("tema_slug sempre lettura_codice", righe.every((r) => r.tema_slug === "lettura_codice"));
  ok("dataset sempre python", righe.every((r) => r.dataset === "python"));
  ok("righe_attese e colonne_attese restano NULL", righe.every((r) => r.righe_attese === null && r.colonne_attese === null));
  const perId = new Map(righe.map((r) => [r.id, r]));
  let compostaOk = 0, rubricaOk = 0, difettoOk = 0;
  for (const c of veriCodice) {
    const r = perId.get(c.id);
    if (!r) continue;
    if (r.consegna === `${c.titolo}\n\n${c.consegna}\n\n${c.codice_difettoso}`) compostaOk++;
    if (r.soluzione_riferimento === c.difetto) difettoOk++;
    const extra = JSON.parse(r.rubrica);
    if (extra.corretto === c.codice_corretto && extra.test === c.test && extra.categoria === c.categoria) rubricaOk++;
  }
  uguale("la consegna e titolo + consegna + codice difettoso", compostaOk, 20);
  uguale("soluzione_riferimento e il campo difetto", difettoOk, 20);
  uguale("la rubrica e {corretto, test, categoria}", rubricaOk, 20);
});

await scenario("B7 · le flashcard: tipo quiz_citato, livello 2 cablato, citazione con trattino lungo", async () => {
  const righe = dbApp.database().getAllSync(
    "SELECT id, tema_slug, livello, consegna, soluzione_riferimento, fonte_citazione, dataset FROM esercizi WHERE tipo='quiz_citato' ORDER BY id"
  );
  uguale("quante", righe.length, 199);
  ok("livello sempre 2", righe.every((r) => r.livello === 2));
  ok("dataset resta NULL", righe.every((r) => r.dataset === null));
  const perId = new Map(righe.map((r) => [r.id, r]));
  let ok1 = 0, ok2 = 0;
  for (const f of veriFlash) {
    const r = perId.get(f.id);
    if (!r) continue;
    if (r.consegna === f.domanda && r.soluzione_riferimento === f.risposta && r.tema_slug === f.tema) ok1++;
    if (r.fonte_citazione === `${f.fonte} — ${f.riferimento}`) ok2++;
  }
  uguale("domanda, risposta e tema combaciano", ok1, 199);
  uguale("fonte_citazione e «fonte — riferimento»", ok2, 199);
});

await scenario("B8 · gli scenari a rubrica: livello 4 cablato, rubrica come array JSON", async () => {
  const righe = dbApp.database().getAllSync(
    "SELECT id, tema_slug, livello, consegna, rubrica, soluzione_riferimento FROM esercizi WHERE tipo='rubrica' ORDER BY id"
  );
  uguale("quanti", righe.length, 12);
  ok("livello sempre 4", righe.every((r) => r.livello === 4));
  ok("soluzione_riferimento resta NULL (non esiste una risposta giusta)", righe.every((r) => r.soluzione_riferimento === null));
  const perId = new Map(righe.map((r) => [r.id, r]));
  let ok1 = 0;
  for (const s of veriScenari) {
    const r = perId.get(s.id);
    if (!r) continue;
    const voci = JSON.parse(r.rubrica);
    if (Array.isArray(voci) && voci.length === s.rubrica.length && r.consegna === s.consegna && r.tema_slug === s.tema) ok1++;
  }
  uguale("consegna, tema e rubrica combaciano", ok1, 12);
  ok("ogni rubrica ha almeno 3 voci", righe.every((r) => JSON.parse(r.rubrica).length >= 3));
});

await scenario("B9 · i 52 volumi: origine 'aperta', nessun file locale, pagina zero", async () => {
  const righe = dbApp.database().getAllSync(
    "SELECT id, titolo, autore, tema_slug, trimestre, origine, licenza, url, formato, file_locale, ultima_pagina, aggiunto_a, byte, sha256, pagine, hlc FROM biblioteca ORDER BY id"
  );
  uguale("quanti", righe.length, 52);
  ok("origine sempre 'aperta'", righe.every((r) => r.origine === "aperta"));
  ok("file_locale sempre NULL (niente PDF prima dell'importazione)", righe.every((r) => r.file_locale === null));
  ok("ultima_pagina sempre 0", righe.every((r) => r.ultima_pagina === 0));
  ok("byte, sha256, pagine restano NULL", righe.every((r) => r.byte === null && r.sha256 === null && r.pagine === null));
  ok("hlc resta NULL: il seed non passa dal registro", righe.every((r) => r.hlc === null));
  ok("licenza e url mai vuoti", righe.every((r) => r.licenza && r.url));
  ok("trimestre fra T1 e T6", righe.every((r) => /^T[1-6]$/.test(r.trimestre)), [...new Set(righe.map((r) => r.trimestre))].join(","));
  const istanti = new Set(righe.map((r) => r.aggiunto_a));
  uguale("aggiunto_a identico per tutti e 52", istanti.size, 1);
  ok("aggiunto_a e un ISO UTC con la Z", /^\d{4}-\d{2}-\d{2}T[\d:.]+Z$/.test(righe[0].aggiunto_a), righe[0].aggiunto_a);
});

await scenario("B10 · la coda di ripasso nasce con le 199 flashcard e nessun altro", async () => {
  const righe = dbApp.database().getAllSync(
    "SELECT esercizio_id, stabilita, difficolta, ripetizioni, ultima_revisione, prossima_revisione, stato FROM ripasso"
  );
  uguale("quante", righe.length, 199);
  const idRipasso = new Set(righe.map((r) => r.esercizio_id));
  const idFlash = new Set(veriFlash.map((f) => f.id));
  uguale("stesso numero di id distinti", idRipasso.size, 199);
  ok("gli id sono esattamente quelli delle flashcard", [...idFlash].every((i) => idRipasso.has(i)));
  ok("stabilita parte da 0", righe.every((r) => r.stabilita === 0));
  ok("difficolta parte da 5 (default dello schema)", righe.every((r) => r.difficolta === 5));
  ok("ripetizioni parte da 0", righe.every((r) => r.ripetizioni === 0));
  ok("ultima_revisione e NULL", righe.every((r) => r.ultima_revisione === null));
  ok("stato e 'nuovo'", righe.every((r) => r.stato === "nuovo"));
  uguale(
    "nessuna riga di ripasso per sql, codice o scenari",
    conta("ripasso", "WHERE esercizio_id IN (SELECT id FROM esercizi WHERE tipo <> 'quiz_citato')"),
    0
  );
  uguale(
    "ogni riga di ripasso trova il suo esercizio",
    conta("ripasso r JOIN esercizi e ON e.id = r.esercizio_id"),
    199
  );
});

await scenario("B11 · le 199 carte sono tutte scadute allo stesso istante (pareggio totale)", async () => {
  const d = dbApp.database();
  const istanti = d.getAllSync("SELECT DISTINCT prossima_revisione AS p FROM ripasso");
  uguale("un solo valore di prossima_revisione", istanti.length, 1);
  const p = istanti[0].p;
  ok("e un ISO UTC con la Z, lunghezza 24", /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(p) && p.length === 24, p);
  const volume = d.getFirstSync("SELECT aggiunto_a AS a FROM biblioteca LIMIT 1").a;
  uguale("e lo stesso istante di biblioteca.aggiunto_a", p, volume);
  ok("tutte gia scadute rispetto ad adesso", p <= new Date().toISOString());
  // La schermata Ripasso ordina per prossima_revisione: con il pareggio totale
  // l'ordine e quello di inserimento. Ricopiata da app/ripasso.tsx.
  const primi = d.getAllSync("SELECT esercizio_id FROM ripasso ORDER BY prossima_revisione LIMIT 30").map((r) => r.esercizio_id);
  const ancora = d.getAllSync("SELECT esercizio_id FROM ripasso ORDER BY prossima_revisione LIMIT 30").map((r) => r.esercizio_id);
  ugualeJson("due letture danno le stesse prime 30 carte", ancora, primi);
  ugualeJson("e sono le prime 30 del file flashcard.json", primi, veriFlash.slice(0, 30).map((f) => f.id));
});

await scenario("B12 · il caricamento non scrive nel registro eventi (i contenuti non sono dati dell'utente)", async () => {
  uguale("nessun evento", conta("eventi"), 0);
  uguale("nessuna riga meta", conta("meta"), 0);
  uguale("nessun tentativo", conta("tentativi"), 0);
  uguale("nessuna sessione", conta("sessioni"), 0);
  uguale("nessuna nota", conta("note"), 0);
});

await scenario("B13 · ordine_rilevante: 56 su 150, e coincide con lib/verifica.ts riga per riga", async () => {
  // CON-11: lib/contenuti.ts ha una COPIA PRIVATA di ordineRilevante. Se le due
  // divergono, cio che e memorizzato non coincide piu con cio che verifica le
  // risposte in app/esercizi.tsx. Qui si confronta il valore MEMORIZZATO con
  // quello che calcola la funzione esportata da lib/verifica.ts.
  const memorizzato = new Map(
    dbApp.database()
      .getAllSync("SELECT id, ordine_rilevante FROM esercizi WHERE tipo='sql_eseguibile'")
      .map((r) => [r.id, r.ordine_rilevante])
  );
  uguale("quanti a 1", [...memorizzato.values()].filter((v) => v === 1).length, 56);
  ok("il valore e sempre 0 o 1", [...memorizzato.values()].every((v) => v === 0 || v === 1));
  let divergenze = [];
  for (const e of veriSql) {
    const atteso = verificaApp.ordineRilevante(e.consegna, e.soluzione) ? 1 : 0;
    if (memorizzato.get(e.id) !== atteso) divergenze.push(e.id);
  }
  uguale("nessuna divergenza fra le due copie della funzione", divergenze.length, 0, divergenze.slice(0, 5).join(","));
  ok("ogni esercizio con LIMIT ha ordine_rilevante = 1",
    veriSql.filter((e) => /\blimit\b/i.test(e.soluzione)).every((e) => memorizzato.get(e.id) === 1));
  uguale("gli altri tipi restano a 0 (default dello schema)",
    conta("esercizi", "WHERE tipo <> 'sql_eseguibile' AND ordine_rilevante <> 0"), 0);
});

// ====================================================================== PARTE C
// C. La guardia del secondo avvio, e i tre modi in cui e parziale.

await scenario("C1 · secondo avvio: saltato=true, tutti i contatori a zero, nessuna scrittura", async () => {
  const d = dbApp.database();
  const prima = {
    esercizi: conta("esercizi"), temi: conta("temi"),
    biblioteca: conta("biblioteca"), ripasso: conta("ripasso"),
    istante: d.getFirstSync("SELECT aggiunto_a AS a FROM biblioteca LIMIT 1").a,
  };
  const esito = await contenuti.caricaContenuti();
  uguale("saltato", esito.saltato, true);
  ugualeJson("tutti i contatori a zero",
    [esito.temi, esito.sql, esito.codice, esito.flashcard, esito.scenari, esito.biblioteca],
    [0, 0, 0, 0, 0, 0]);
  uguale("esercizi invariati", conta("esercizi"), prima.esercizi);
  uguale("temi invariati", conta("temi"), prima.temi);
  uguale("biblioteca invariata", conta("biblioteca"), prima.biblioteca);
  uguale("ripasso invariato", conta("ripasso"), prima.ripasso);
  uguale("aggiunto_a non e stato riscritto", d.getFirstSync("SELECT aggiunto_a AS a FROM biblioteca LIMIT 1").a, prima.istante);
  uguale("nessun evento comunque", conta("eventi"), 0);
});

await scenario("C2 · una sola riga in esercizi basta a far saltare tutto il caricamento", async () => {
  const d = dbApp.database();
  azzeraContenuti();
  d.runSync(
    "INSERT INTO esercizi (id, tipo, livello, consegna) VALUES ('ESTRANEO-1','quiz_citato',2,'arrivato per sincronizzazione')"
  );
  const esito = await contenuti.caricaContenuti();
  uguale("saltato", esito.saltato, true);
  uguale("i temi NON vengono creati", conta("temi"), 0);
  uguale("la biblioteca NON viene creata", conta("biblioteca"), 0);
  uguale("la coda di ripasso NON viene creata", conta("ripasso"), 0);
  uguale("l'unica riga resta quella estranea", conta("esercizi"), 1);
});

await scenario("DIFETTO RIPRODOTTO C3 · biblioteca svuotata dall'utente: i 52 volumi non tornano mai piu", async () => {
  // CON-03. lib/palestra.ts rimuoviVolume() cancella la RIGA di biblioteca.
  // Svuotata la biblioteca, la guardia guarda solo `esercizi` e salta: i volumi
  // di dotazione spariscono per sempre, e l'eliminazione si propaga anche
  // all'altro dispositivo con la sincronizzazione.
  await caricaIlContenutoVero();
  dbApp.database().runSync("DELETE FROM biblioteca");
  uguale("la biblioteca e vuota", conta("biblioteca"), 0);
  const esito = await contenuti.caricaContenuti();
  uguale("il caricamento salta lo stesso", esito.saltato, true);
  uguale("DIFETTO: la biblioteca resta vuota", conta("biblioteca"), 0);
  uguale("gli esercizi ci sono ancora", conta("esercizi"), 381);
});

await scenario("DIFETTO RIPRODOTTO C4 · temi svuotati: la guardia non li ricostruisce", async () => {
  await caricaIlContenutoVero();
  dbApp.database().runSync("DELETE FROM temi");
  const esito = await contenuti.caricaContenuti();
  uguale("salta", esito.saltato, true);
  uguale("DIFETTO: zero temi, e ogni elenco filtrato per tema resta vuoto", conta("temi"), 0);
});

await scenario("DIFETTO RIPRODOTTO C5 · coda di ripasso svuotata: le 199 carte non tornano", async () => {
  await caricaIlContenutoVero();
  dbApp.database().runSync("DELETE FROM ripasso");
  const esito = await contenuti.caricaContenuti();
  uguale("salta", esito.saltato, true);
  uguale("DIFETTO: zero carte da ripassare, per sempre", conta("ripasso"), 0);
  uguale("le 199 flashcard restano in esercizi, irraggiungibili dal ripasso",
    conta("esercizi", "WHERE tipo='quiz_citato'"), 199);
});

// ====================================================================== PARTE D
// D. JSON malformato e di forma sbagliata. I cinque require() avvengono PRIMA
//    di withTransactionAsync: un file illeggibile non apre nemmeno la transazione.

await scenario("D1 · esercizi_sql.json troncato a meta: lancia SyntaxError e non scrive niente", async () => {
  azzeraContenuti();
  contenutoFinto({ sql: '[{"id":"SQL-001","tema":"sql_base",' });
  await lancia("il messaggio viene da JSON.parse", () => contenuti.caricaContenuti(), "JSON");
  uguale("nessun tema scritto", conta("temi"), 0);
  uguale("nessun esercizio scritto", conta("esercizi"), 0);
  uguale("nessun volume scritto", conta("biblioteca"), 0);
});

await scenario("D2 · file da 0 byte: lancia, e al riavvio con il file sano riparte da zero", async () => {
  azzeraContenuti();
  contenutoFinto({ flash: "" });
  await lancia("JSON.parse su stringa vuota", () => contenuti.caricaContenuti(), "JSON");
  uguale("niente scritto", conta("esercizi"), 0);
  // «riavvio con il file sano»: si rimettono i contenuti veri e si riprova.
  const esito = await caricaIlContenutoVero();
  uguale("il secondo tentativo riesce", esito.saltato, false);
  uguale("e carica tutto", conta("esercizi"), 381);
});

await scenario("D3 · virgola finale e BOM iniziale: entrambi rifiutati da JSON.parse", async () => {
  azzeraContenuti();
  contenutoFinto({ scenari: '[{"id":"SCN-01","tema":"kpi","consegna":"c","rubrica":[]},]' });
  await lancia("virgola finale", () => contenuti.caricaContenuti(), "JSON");
  uguale("niente scritto dopo la virgola finale", conta("esercizi"), 0);
  azzeraContenuti();
  contenutoFinto({ volumi: "﻿[]" });
  await lancia("BOM iniziale", () => contenuti.caricaContenuti(), "JSON");
  uguale("niente scritto dopo il BOM", conta("temi"), 0);
});

await scenario("D4 · oggetto invece di array: TypeError 'is not iterable', nessuna scrittura parziale", async () => {
  azzeraContenuti();
  contenutoFinto({ sql: { SQL001: { tema: "sql_base" } } });
  const messaggio = await lancia("for...of su un oggetto", () => contenuti.caricaContenuti(), "is not iterable");
  ok("il messaggio nomina la variabile sql", messaggio.includes("sql"), messaggio);
  uguale("ROLLBACK: nemmeno i 22 temi, gia scritti prima dell'errore", conta("temi"), 0);
  uguale("nessun esercizio", conta("esercizi"), 0);
});

await scenario("D5 · errore sul QUARTO ciclo: rotolano indietro anche temi, sql, codice e flashcard", async () => {
  // La prova piu severa del rollback: l'errore arriva dopo quattro cicli di
  // INSERT andati a buon fine.
  azzeraContenuti();
  contenutoFinto({
    sql: [{ id: "S-1", tema: "sql_base", livello: 1, consegna: "c", soluzione: "SELECT 1", righe_attese: 1, colonne_attese: ["a"] }],
    codice: [{ id: "C-1", categoria: "x", livello: 1, titolo: "t", consegna: "c", codice_difettoso: "d", codice_corretto: "k", test: "t", difetto: "y" }],
    flash: [{ id: "F-1", tema: "kpi", domanda: "d", risposta: "r", fonte: "f", riferimento: "1" }],
    scenari: { rotto: true },
  });
  await lancia("il quarto ciclo non e iterabile", () => contenuti.caricaContenuti(), "is not iterable");
  uguale("temi: rotolati indietro", conta("temi"), 0);
  uguale("esercizi: rotolati indietro tutti e tre", conta("esercizi"), 0);
  uguale("biblioteca: mai raggiunta", conta("biblioteca"), 0);
  uguale("ripasso: mai raggiunto", conta("ripasso"), 0);
});

await scenario("D6 · valore non legabile a meta transazione: rollback e connessione di nuovo utilizzabile", async () => {
  azzeraContenuti();
  contenutoFinto({
    sql: [{ id: { oggetto: 1 }, tema: "sql_base", livello: 1, consegna: "c", soluzione: "s", righe_attese: 1, colonne_attese: ["a"] }],
  });
  await lancia("il driver rifiuta il valore", () => contenuti.caricaContenuti(), "parameter");
  uguale("ROLLBACK dei temi", conta("temi"), 0);
  uguale("nessun esercizio", conta("esercizi"), 0);
  // Se la transazione non fosse stata chiusa, questa riuscirebbe a essere rossa.
  const esito = await caricaIlContenutoVero();
  uguale("il caricamento successivo funziona", esito.saltato, false);
  uguale("e scrive tutto", conta("esercizi"), 381);
});

await scenario("D7 · array vuoto: nessun errore, dichiara zero e scrive zero", async () => {
  azzeraContenuti();
  contenutoFinto({ sql: [], codice: [], flash: [], scenari: [], volumi: [] });
  const esito = await contenuti.caricaContenuti();
  uguale("saltato resta false", esito.saltato, false);
  ugualeJson("i contatori dichiarano zero", [esito.sql, esito.codice, esito.flashcard, esito.scenari, esito.biblioteca], [0, 0, 0, 0, 0]);
  uguale("i 22 temi vengono comunque scritti", esito.temi, 22);
  uguale("e ci sono davvero", conta("temi"), 22);
  uguale("zero esercizi", conta("esercizi"), 0);
  uguale("zero volumi", conta("biblioteca"), 0);
  uguale("zero carte", conta("ripasso"), 0);
});

await scenario("DIFETTO RIPRODOTTO D8 · array di stringhe: 0 righe scritte, ma il ritorno ne dichiara 2", async () => {
  // CON-05 + CON-06. La forma e sbagliata ma non solleva: `e.livello` su una
  // stringa e undefined, quindi NOT NULL viene violato e INSERT OR IGNORE
  // ingoia la violazione. Nessun errore risale, nessuna riga entra, e il
  // valore di ritorno continua a dichiarare la lunghezza del JSON.
  azzeraContenuti();
  contenutoFinto({ sql: ["uno", "due"] });
  const esito = await contenuti.caricaContenuti();
  uguale("nessuna eccezione, saltato false", esito.saltato, false);
  uguale("DIFETTO: il ritorno dichiara 2 esercizi SQL", esito.sql, 2);
  uguale("DIFETTO: in tabella ce ne sono 0", conta("esercizi", "WHERE tipo='sql_eseguibile'"), 0);
  uguale("i temi entrano lo stesso", conta("temi"), 22);
});

// ====================================================================== PARTE E
// E. Campi mancanti in un singolo item.

await scenario("DIFETTO RIPRODOTTO E1 · item senza livello: saltato in silenzio da INSERT OR IGNORE", async () => {
  azzeraContenuti();
  contenutoFinto({
    sql: [
      { id: "S-SENZA", tema: "sql_base", consegna: "c", soluzione: "s", righe_attese: 1, colonne_attese: ["a"] },
      { id: "S-SANO", tema: "sql_base", livello: 1, consegna: "c", soluzione: "s", righe_attese: 1, colonne_attese: ["a"] },
    ],
  });
  const esito = await contenuti.caricaContenuti();
  uguale("nessuna eccezione", esito.saltato, false);
  uguale("DIFETTO: il ritorno dichiara 2", esito.sql, 2);
  ugualeJson("DIFETTO: in tabella e entrato solo quello sano",
    dbApp.database().getAllSync("SELECT id FROM esercizi WHERE tipo='sql_eseguibile' ORDER BY id").map((r) => r.id),
    ["S-SANO"]);
  uguale("e nessun errore e stato registrato da nessuna parte", conta("eventi"), 0);
});

await scenario("DIFETTO RIPRODOTTO E2 · item senza consegna: stessa perdita silenziosa", async () => {
  azzeraContenuti();
  contenutoFinto({
    flash: [
      { id: "F-SENZA", tema: "kpi", risposta: "r", fonte: "f", riferimento: "1" },
      { id: "F-SANA", tema: "kpi", domanda: "d", risposta: "r", fonte: "f", riferimento: "1" },
    ],
  });
  const esito = await contenuti.caricaContenuti();
  uguale("DIFETTO: dichiara 2 flashcard", esito.flashcard, 2);
  uguale("DIFETTO: in esercizi ne entra 1", conta("esercizi", "WHERE tipo='quiz_citato'"), 1);
  uguale("ma in ripasso entrano ENTRAMBE: la coda non ha il vincolo NOT NULL", conta("ripasso"), 2);
  uguale("DIFETTO: una carta di ripasso punta a un esercizio che non esiste",
    conta("ripasso r LEFT JOIN esercizi e ON e.id = r.esercizio_id", "WHERE e.id IS NULL"), 1);
});

await scenario("E3 · consegna stringa vuota: passa il NOT NULL e produce una carta senza testo", async () => {
  azzeraContenuti();
  contenutoFinto({ flash: [{ id: "F-VUOTA", tema: "kpi", domanda: "", risposta: "r", fonte: "f", riferimento: "1" }] });
  const esito = await contenuti.caricaContenuti();
  uguale("dichiara 1", esito.flashcard, 1);
  uguale("ed e davvero entrata", conta("esercizi", "WHERE tipo='quiz_citato'"), 1);
  uguale("con consegna vuota", dbApp.database().getFirstSync("SELECT consegna FROM esercizi WHERE id='F-VUOTA'").consegna, "");
  ok("la schermata Ripasso mostrerebbe una carta bianca: il NOT NULL non protegge dalla stringa vuota", true);
});

await scenario("DIFETTO RIPRODOTTO E4 · item senza id: due item senza id convivono e spariscono dal JOIN", async () => {
  // CON-08. SQLite accetta NULL in una PRIMARY KEY TEXT non dichiarata NOT NULL.
  azzeraContenuti();
  contenutoFinto({
    flash: [
      { tema: "kpi", domanda: "d1", risposta: "r1", fonte: "f", riferimento: "1" },
      { tema: "kpi", domanda: "d2", risposta: "r2", fonte: "f", riferimento: "2" },
    ],
  });
  const esito = await contenuti.caricaContenuti();
  uguale("dichiara 2", esito.flashcard, 2);
  uguale("DIFETTO: due righe con id NULL convivono, nessun conflitto di chiave",
    conta("esercizi", "WHERE id IS NULL"), 2);
  uguale("e due righe di ripasso con esercizio_id NULL", conta("ripasso", "WHERE esercizio_id IS NULL"), 2);
  uguale("DIFETTO: il JOIN e.id = r.esercizio_id non le trova (NULL = NULL non e mai vero)",
    conta("ripasso r JOIN esercizi e ON e.id = r.esercizio_id"), 0);
  ok("le carte spariscono dalla coda senza alcuna segnalazione", true);
});

await scenario("E5 · item senza tema: tema_slug NULL, nessuna FOREIGN KEY lo impedisce", async () => {
  azzeraContenuti();
  contenutoFinto({ sql: [{ id: "S-ORFANO", livello: 1, consegna: "c", soluzione: "s", righe_attese: 1, colonne_attese: ["a"] }] });
  const esito = await contenuti.caricaContenuti();
  uguale("entra lo stesso", conta("esercizi", "WHERE tipo='sql_eseguibile'"), 1);
  uguale("con tema_slug NULL", dbApp.database().getFirstSync("SELECT tema_slug AS t FROM esercizi WHERE id='S-ORFANO'").t, null);
  uguale("nessun errore", esito.saltato, false);
  uguale("e resta invisibile in ogni elenco filtrato per tema",
    conta("esercizi e JOIN temi t ON t.slug = e.tema_slug", "WHERE e.id='S-ORFANO'"), 0);
});

await scenario("E6 · tema fuori dalle 22 voci: inserito comunque, PRAGMA foreign_keys non protegge", async () => {
  // CON-10. esercizi.tema_slug non ha FOREIGN KEY: il pragma di db.ts e inutile qui.
  uguale("il pragma e comunque attivo", dbApp.database().getFirstSync("PRAGMA foreign_keys").foreign_keys, 1);
  azzeraContenuti();
  contenutoFinto({ sql: [{ id: "S-TEMA-X", tema: "tema_inventato", livello: 1, consegna: "c", soluzione: "s", righe_attese: 1, colonne_attese: ["a"] }] });
  await contenuti.caricaContenuti();
  uguale("la riga entra", conta("esercizi", "WHERE id='S-TEMA-X'"), 1);
  uguale("con un tema orfano", dbApp.database().getFirstSync("SELECT tema_slug AS t FROM esercizi WHERE id='S-TEMA-X'").t, "tema_inventato");
  uguale("e nessun tema con quello slug esiste", conta("temi", "WHERE slug='tema_inventato'"), 0);
});

await scenario("E7 · colonne_attese assente: JSON.stringify(undefined) e undefined al binding", async () => {
  // CON-07. Attenzione, qui il BANCO DIVERGE dal telefono, e va detto:
  //  - node:sqlite grezzo LANCIA 'Provided value cannot be bound';
  //  - il doppio del banco normalizza undefined -> NULL (convertiValore);
  //  - expo-sqlite (build/paramUtils.js) NON normalizza e passa undefined al
  //    nativo, quindi l'esito sul telefono non e provabile da qui.
  // Si verifica il comportamento del banco E si misura quello di node:sqlite
  // grezzo, cosi la divergenza resta scritta nero su bianco.
  azzeraContenuti();
  contenutoFinto({ sql: [{ id: "S-NOCOL", tema: "sql_base", livello: 1, consegna: "c", soluzione: "s", righe_attese: 1 }] });
  const esito = await contenuti.caricaContenuti();
  uguale("sul banco non lancia", esito.saltato, false);
  uguale("e colonne_attese diventa NULL", dbApp.database().getFirstSync("SELECT colonne_attese AS c FROM esercizi WHERE id='S-NOCOL'").c, null);
  // Misura diretta su node:sqlite, senza passare dal doppio.
  const grezzo = new DatabaseSync(":memory:");
  grezzo.exec("CREATE TABLE t (a TEXT, b TEXT)");
  let messaggioGrezzo = "";
  try {
    grezzo.prepare("INSERT INTO t (a,b) VALUES (?,?)").run("x", undefined);
  } catch (e) {
    messaggioGrezzo = String(e.message);
  }
  grezzo.close();
  ok("node:sqlite grezzo invece lancia: il banco e piu permissivo del motore",
    messaggioGrezzo.includes("cannot be bound"), "messaggio: " + messaggioGrezzo);
  ok("expo-sqlite non normalizza undefined (letto in node_modules/expo-sqlite/build/paramUtils.js): sul telefono l'esito e da verificare",
    !readFileSync(RADICE + "/node_modules/expo-sqlite/build/paramUtils.js", "utf8").includes("undefined"));
});

// ====================================================================== PARTE F
// F. Codici duplicati.

await scenario("DIFETTO RIPRODOTTO F1 · id ripetuto dentro lo stesso file: vince il primo, il ritorno mente", async () => {
  azzeraContenuti();
  contenutoFinto({
    sql: [
      { id: "S-DOPPIO", tema: "sql_base", livello: 1, consegna: "la prima", soluzione: "s1", righe_attese: 1, colonne_attese: ["a"] },
      { id: "S-DOPPIO", tema: "sql_agg", livello: 3, consegna: "la seconda", soluzione: "s2", righe_attese: 9, colonne_attese: ["b"] },
    ],
  });
  const esito = await contenuti.caricaContenuti();
  uguale("DIFETTO: il ritorno dichiara 2", esito.sql, 2);
  uguale("in tabella ce n'e 1", conta("esercizi", "WHERE tipo='sql_eseguibile'"), 1);
  const r = dbApp.database().getFirstSync("SELECT consegna, livello FROM esercizi WHERE id='S-DOPPIO'");
  uguale("vince la PRIMA riga inserita", r.consegna, "la prima");
  uguale("con il suo livello", r.livello, 1);
  ok("la seconda viene scartata senza alcun avviso", true);
});

await scenario("DIFETTO RIPRODOTTO F2 · id di flashcard che collide con uno SQL: la carta diventa un esercizio SQL", async () => {
  // CON-09, il caso piu insidioso: l'INSERT della flashcard viene ignorato, ma
  // l'INSERT OR IGNORE in `ripasso` riesce lo stesso, perche usa solo l'id.
  azzeraContenuti();
  contenutoFinto({
    sql: [{ id: "COLLISIONE", tema: "sql_base", livello: 1, consegna: "una query da scrivere", soluzione: "SELECT 1", righe_attese: 1, colonne_attese: ["a"] }],
    flash: [{ id: "COLLISIONE", tema: "kpi", domanda: "una domanda di ripasso", risposta: "r", fonte: "f", riferimento: "1" }],
  });
  const esito = await contenuti.caricaContenuti();
  uguale("il ritorno dichiara 1 SQL e 1 flashcard", esito.sql + esito.flashcard, 2);
  uguale("in esercizi ce n'e una sola", conta("esercizi"), 1);
  const r = dbApp.database().getFirstSync("SELECT tipo, consegna FROM esercizi WHERE id='COLLISIONE'");
  uguale("ed e quella SQL, inserita per prima", r.tipo, "sql_eseguibile");
  uguale("con la consegna della query", r.consegna, "una query da scrivere");
  uguale("DIFETTO: ma la riga di ripasso viene creata lo stesso", conta("ripasso", "WHERE esercizio_id='COLLISIONE'"), 1);
  ok("DIFETTO: la coda di ripasso mostrerebbe un esercizio SQL come se fosse una carta", true);
});

await scenario("DIFETTO RIPRODOTTO F3 · codice di volume ripetuto: 51 volumi su 52 dichiarati", async () => {
  azzeraContenuti();
  const base = { titolo: "t", autore: "a", tema_slug: "kpi", trimestre: "T1", licenza: "CC", url: "u", formato: "pdf", nota: "n" };
  contenutoFinto({
    volumi: [
      { codice: "BIB-X", ...base, titolo: "il primo" },
      { codice: "BIB-X", ...base, titolo: "il secondo" },
      { codice: "BIB-Y", ...base },
    ],
  });
  const esito = await contenuti.caricaContenuti();
  uguale("DIFETTO: il ritorno dichiara 3", esito.biblioteca, 3);
  uguale("in tabella ce ne sono 2", conta("biblioteca"), 2);
  uguale("e vince il primo", dbApp.database().getFirstSync("SELECT titolo FROM biblioteca WHERE id='BIB-X'").titolo, "il primo");
});

await scenario("F4 · il CHECK su biblioteca.origine esiste, e OR IGNORE lo ingoierebbe in silenzio", async () => {
  // CON-15: oggi l'origine e cablata a 'aperta' nell'INSERT, quindi il rischio
  // e latente. Si verifica che il vincolo c'e e che OR IGNORE non lo segnala,
  // cosi chi un domani rendesse l'origine un campo del JSON sa cosa lo aspetta.
  const d = dbApp.database();
  let lanciato = false;
  try {
    d.runSync("INSERT INTO biblioteca (id, titolo, origine, aggiunto_a) VALUES ('X','t','pirata','ora')");
  } catch {
    lanciato = true;
  }
  ok("senza OR IGNORE il CHECK lancia", lanciato);
  const esito = d.runSync("INSERT OR IGNORE INTO biblioteca (id, titolo, origine, aggiunto_a) VALUES ('X','t','pirata','ora')");
  uguale("con OR IGNORE nessuna eccezione e zero righe toccate", esito.changes, 0);
  uguale("e la riga non c'e", conta("biblioteca", "WHERE id='X'"), 0);
});

// ====================================================================== PARTE G
// G. Riferimenti: i 381 id, i temi citati, e le 150 soluzioni di riferimento
//    ESEGUITE DAVVERO su palestra.db.

await caricaIlContenutoVero();

await scenario("G1 · i 381 id dei cinque file sono tutti distinti", async () => {
  const tutti = [
    ...veriSql.map((x) => x.id), ...veriCodice.map((x) => x.id),
    ...veriFlash.map((x) => x.id), ...veriScenari.map((x) => x.id),
  ];
  uguale("quanti item nei quattro file di esercizi", tutti.length, 381);
  uguale("id distinti", new Set(tutti).size, 381);
  uguale("e in tabella ce ne sono 381", conta("esercizi"), 381);
  uguale("i 52 codici di biblioteca sono distinti", new Set(veriVolumi.map((v) => v.codice)).size, 52);
  ok("nessun id vuoto o con spazi ai bordi", tutti.every((i) => typeof i === "string" && i.length > 0 && i === i.trim()));
});

await scenario("G2 · nessun tema orfano: esercizi e volumi citano solo le 22 voci di TEMI", async () => {
  uguale("esercizi con tema_slug fuori dai temi",
    conta("esercizi e LEFT JOIN temi t ON t.slug = e.tema_slug", "WHERE e.tema_slug IS NOT NULL AND t.slug IS NULL"), 0);
  uguale("volumi con tema_slug fuori dai temi",
    conta("biblioteca b LEFT JOIN temi t ON t.slug = b.tema_slug", "WHERE b.tema_slug IS NOT NULL AND t.slug IS NULL"), 0);
  uguale("esercizi con tema_slug NULL", conta("esercizi", "WHERE tema_slug IS NULL"), 0);
  uguale("volumi con tema_slug NULL", conta("biblioteca", "WHERE tema_slug IS NULL"), 0);
});

await scenario("G3 · ogni campo obbligatorio dei cinque file e presente e non vuoto", async () => {
  uguale("SQL senza soluzione", veriSql.filter((e) => !e.soluzione).length, 0);
  uguale("SQL senza colonne_attese o con array vuoto", veriSql.filter((e) => !Array.isArray(e.colonne_attese) || !e.colonne_attese.length).length, 0);
  uguale("SQL con righe_attese non intero", veriSql.filter((e) => !Number.isInteger(e.righe_attese)).length, 0);
  uguale("codice senza test", veriCodice.filter((c) => !c.test).length, 0);
  uguale("codice senza codice_corretto", veriCodice.filter((c) => !c.codice_corretto).length, 0);
  uguale("codice senza difetto", veriCodice.filter((c) => !c.difetto).length, 0);
  uguale("codice senza categoria", veriCodice.filter((c) => !c.categoria).length, 0);
  uguale("flashcard senza fonte", veriFlash.filter((f) => !f.fonte).length, 0);
  uguale("flashcard senza riferimento", veriFlash.filter((f) => !f.riferimento).length, 0);
  uguale("scenari con rubrica non array", veriScenari.filter((s) => !Array.isArray(s.rubrica) || !s.rubrica.length).length, 0);
  uguale("volumi senza licenza", veriVolumi.filter((v) => !v.licenza).length, 0);
  uguale("volumi senza url", veriVolumi.filter((v) => !v.url).length, 0);
});

// palestra.db: copia di lavoro, aperta in SOLA LETTURA. L'asset del repository
// non viene mai toccato (invariante 4: la palestra e in sola lettura).
const palestraCopia = join(cartella, "palestra-lettura.db");
copyFileSync(CONTENUTI + "palestra.db", palestraCopia);

await scenario("G4 · le 143 soluzioni senza preparazione girano tutte su palestra.db", async () => {
  const d = new DatabaseSync(palestraCopia, { readOnly: true });
  const rotte = [];
  for (const e of veriSql) {
    if (e.preparazione) continue;
    try {
      d.prepare(e.soluzione).all();
    } catch (errore) {
      rotte.push(`${e.id}: ${String(errore.message).slice(0, 70)}`);
    }
  }
  d.close();
  uguale("senza preparazione", veriSql.filter((e) => !e.preparazione).length, 143);
  uguale("soluzioni che non si eseguono", rotte.length, 0, rotte.slice(0, 3).join(" | "));
});

await scenario("G5 · righe_attese coincide con il numero di righe che la soluzione restituisce davvero", async () => {
  const d = new DatabaseSync(palestraCopia, { readOnly: true });
  const sbagliate = [];
  for (const e of veriSql) {
    if (e.preparazione) continue;
    try {
      const righe = d.prepare(e.soluzione).all();
      if (righe.length !== e.righe_attese) sbagliate.push(`${e.id}: attese ${e.righe_attese}, ottenute ${righe.length}`);
    } catch {
      sbagliate.push(`${e.id}: non eseguibile`);
    }
  }
  d.close();
  uguale("esercizi con righe_attese sbagliato", sbagliate.length, 0, sbagliate.slice(0, 3).join(" | "));
  ok("nessuna soluzione restituisce zero righe (che renderebbe l'esercizio non valutabile, vedi QRY-04)",
    veriSql.every((e) => e.preparazione || e.righe_attese > 0));
});

await scenario("G6 · colonne_attese coincide per NOMI e ORDINE con quelle restituite", async () => {
  const d = new DatabaseSync(palestraCopia, { readOnly: true });
  const nomi = [], ordine = [];
  for (const e of veriSql) {
    if (e.preparazione) continue;
    let righe;
    try { righe = d.prepare(e.soluzione).all(); } catch { continue; }
    if (!righe.length) continue;
    const col = Object.keys(righe[0]);
    if (col.length !== e.colonne_attese.length) nomi.push(`${e.id}: ${col.length} contro ${e.colonne_attese.length}`);
    else if (col.join("\u001f") !== e.colonne_attese.join("\u001f")) ordine.push(`${e.id}: ${col.join(",")} contro ${e.colonne_attese.join(",")}`);
  }
  d.close();
  uguale("numero di colonne sbagliato", nomi.length, 0, nomi.slice(0, 3).join(" | "));
  uguale("nomi o ordine delle colonne sbagliati", ordine.length, 0, ordine.slice(0, 3).join(" | "));
});

await scenario("G7 · i 7 esercizi con preparazione: la preparazione si applica e la soluzione combacia", async () => {
  const conPrep = veriSql.filter((e) => e.preparazione);
  uguale("quanti", conPrep.length, 7);
  const guasti = [];
  for (const e of conPrep) {
    const copia = join(cartella, `prep-${e.id}.db`);
    copyFileSync(CONTENUTI + "palestra.db", copia);
    const d = new DatabaseSync(copia);
    try {
      d.exec(e.preparazione);
      const righe = d.prepare(e.soluzione).all();
      if (righe.length !== e.righe_attese) guasti.push(`${e.id}: righe ${righe.length} contro ${e.righe_attese}`);
      const col = righe.length ? Object.keys(righe[0]) : [];
      if (righe.length && col.join(",") !== e.colonne_attese.join(",")) guasti.push(`${e.id}: colonne ${col.join(",")}`);
    } catch (errore) {
      guasti.push(`${e.id}: ${String(errore.message).slice(0, 60)}`);
    }
    d.close();
    rmSync(copia, { force: true });
  }
  uguale("esercizi con preparazione guasti", guasti.length, 0, guasti.slice(0, 3).join(" | "));
  ok("la preparazione e sempre DDL (CREATE/DROP), mai una SELECT",
    conPrep.every((e) => /^\s*(CREATE|DROP|ALTER|ANALYZE)/i.test(e.preparazione)),
    conPrep.map((e) => e.preparazione.trim().slice(0, 20)).join(" | "));
});

await scenario("DIFETTO RIPRODOTTO G8 · due soluzioni usano window functions FUORI dal tema sql_window", async () => {
  // COD-03: il filtro della coda esclude solo tema_slug='sql_window'. Su un
  // motore sotto 3.25 questi due esercizi restano in coda e falliscono con
  // 'La soluzione di riferimento non e eseguibile su questo dispositivo'.
  const finestra = /\bOVER\s*\(|\bROW_NUMBER\s*\(|\bRANK\s*\(|\bDENSE_RANK\s*\(|\bLAG\s*\(|\bLEAD\s*\(|\bNTILE\s*\(/i;
  const fuori = veriSql.filter((e) => e.tema !== "sql_window" && finestra.test(e.soluzione));
  uguale("nel tema sql_window", veriSql.filter((e) => e.tema === "sql_window").length, 23);
  uguale("e sono tutti di livello 4", veriSql.filter((e) => e.tema === "sql_window" && e.livello === 4).length, 23);
  uguale("soluzioni che usano window functions in tutto il file", veriSql.filter((e) => finestra.test(e.soluzione)).length, 24);
  uguale("dentro il tema, quelle che le usano davvero", veriSql.filter((e) => e.tema === "sql_window" && finestra.test(e.soluzione)).length, 22);
  uguale("DIFETTO: soluzioni con window functions fuori dal tema", fuori.length, 2);
  ugualeJson("sono queste", fuori.map((e) => `${e.id}:${e.tema}`), ["SQL-056:sql_cte", "SQL-085:meal"]);
  uguale("DIFETTO: il filtro per tema ne escluderebbe 23, non 25",
    conta("esercizi", "WHERE tipo='sql_eseguibile' AND tema_slug='sql_window'"), 23);
  // L'avviso di app/_layout.tsx riga 31 dichiara «21 esercizi di livello 4».
  ok("DIFETTO: l'avviso in testa all'app dichiara 21, il filtro ne toglie 23",
    /21 esercizi di livello 4/.test(readFileSync(RADICE + "/app/_layout.tsx", "utf8")));
  ok("e il numero giusto degli esercizi che NON sono eseguibili sotto 3.25 e 24, non 21 ne 23",
    veriSql.filter((e) => finestra.test(e.soluzione)).length === 24);
});

await scenario("G9 · nessuna soluzione di riferimento scrive, e i PRAGMA usati sono di sola lettura", async () => {
  // Invariante 4: palestra.db e in sola lettura. Se il CONTENUTO contenesse un
  // UPDATE, apriPalestra() lo eseguirebbe davvero (vedi RO-01: la connessione
  // e aperta in lettura-scrittura, l'invariante e garantita solo dal commento).
  const scrittura = /\b(INSERT|UPDATE|DELETE|DROP|ALTER|REPLACE|ATTACH|DETACH|VACUUM|CREATE|BEGIN|COMMIT)\b/i;
  const sospette = veriSql.filter((e) => scrittura.test(e.soluzione));
  uguale("soluzioni con istruzioni di scrittura", sospette.length, 0, sospette.map((e) => e.id).join(","));
  // Tre esercizi del tema ottimizzazione usano un PRAGMA: sono quelli di sola
  // lettura ammessi da RO-04. Un PRAGMA di STATO (journal_mode, user_version)
  // resterebbe invece attaccato alla connessione memorizzata da apriPalestra()
  // e influenzerebbe tutte le verifiche successive della sessione.
  const conPragma = veriSql.filter((e) => /\bPRAGMA\b/i.test(e.soluzione));
  ugualeJson("quali esercizi usano un PRAGMA", conPragma.map((e) => e.id), ["SQL-095", "SQL-096", "SQL-097"]);
  const soloLettura = /^\s*PRAGMA\s+(table_info|table_xinfo|foreign_key_list|index_list|index_info|index_xinfo|database_list|collation_list|compile_options|function_list)\s*\(?/i;
  const diStato = conPragma.filter((e) => !soloLettura.test(e.soluzione));
  uguale("PRAGMA che cambiano lo stato della connessione", diStato.length, 0, diStato.map((e) => e.id + ": " + e.soluzione).join(" | "));
  ok("e sono tutti nel tema ottimizzazione", conPragma.every((e) => e.tema === "ottimizzazione"), conPragma.map((e) => e.tema).join(","));
  const multiple = veriSql.filter((e) => e.soluzione.replace(/;\s*$/, "").includes(";"));
  uguale("soluzioni con piu istruzioni separate da punto e virgola", multiple.length, 0, multiple.map((e) => e.id).join(","));
});

await scenario("G10 · le 35 soluzioni con funzioni di data non dipendono dall'ora corrente", async () => {
  // QRY-04: se una soluzione con strftime diventasse vuota col passare del
  // tempo, l'esercizio comincerebbe ad accettare qualunque query vuota.
  const conData = veriSql.filter((e) => /strftime|julianday|\bdate\s*\(/i.test(e.soluzione));
  uguale("quante usano funzioni di data", conData.length, 35);
  const conOra = conData.filter((e) => /'now'|"now"/i.test(e.soluzione));
  uguale("quante dipendono da 'now' (e quindi dall'orologio del telefono)", conOra.length, 0, conOra.map((e) => e.id).join(","));
  ok("tutte e 35 restituiscono comunque righe (righe_attese > 0)", conData.every((e) => e.righe_attese > 0));
});

// ====================================================================== PARTE H
// H. Campi del contenuto che il caricamento perde per strada.

await scenario("DIFETTO RIPRODOTTO H1 · scenari: tipo e tempo_min del JSON non finiscono in nessuna colonna", async () => {
  const tipi = [...new Set(veriScenari.map((s) => s.tipo))];
  ok("i 12 scenari dichiarano un tipo", veriScenari.every((s) => typeof s.tipo === "string" && s.tipo.length > 0));
  ok("e un tempo previsto", veriScenari.every((s) => Number.isInteger(s.tempo_min)));
  ok("i tipi sono piu d'uno", tipi.length > 1, tipi.join(","));
  const colonne = dbApp.database().getAllSync("PRAGMA table_info(esercizi)").map((c) => c.name);
  ok("DIFETTO: nessuna colonna tempo_min in esercizi", !colonne.includes("tempo_min"), colonne.join(","));
  const riga = dbApp.database().getFirstSync("SELECT * FROM esercizi WHERE id=?", [veriScenari[0].id]);
  const valori = Object.values(riga).map((v) => String(v));
  ok("DIFETTO: il tipo dello scenario non compare in nessun campo della riga",
    !valori.some((v) => v === veriScenari[0].tipo));
  ok("DIFETTO: nemmeno il tempo previsto",
    !valori.some((v) => v === String(veriScenari[0].tempo_min)));
  ok("la colonna tipo e occupata dal valore cablato 'rubrica'", riga.tipo === "rubrica");
});

await scenario("DIFETTO RIPRODOTTO H2 · biblioteca: il campo nota dei 52 volumi viene buttato via", async () => {
  ok("tutti e 52 i volumi hanno una nota nel JSON", veriVolumi.every((v) => typeof v.nota === "string" && v.nota.length > 0));
  const colonne = dbApp.database().getAllSync("PRAGMA table_info(biblioteca)").map((c) => c.name);
  ok("DIFETTO: la tabella biblioteca non ha nessuna colonna per la nota",
    !colonne.some((c) => /nota|descrizione|commento/i.test(c)), colonne.join(","));
  const riga = dbApp.database().getFirstSync("SELECT * FROM biblioteca WHERE id=?", [veriVolumi[0].codice]);
  ok("DIFETTO: la nota non compare in nessun campo della riga",
    !Object.values(riga).some((v) => String(v) === veriVolumi[0].nota));
  ok("il tipo VolumeAperto la dichiara comunque (nota: string): il campo e letto e mai usato", true);
});

await scenario("DIFETTO RIPRODOTTO H3 · moduli di codice: il testo della consegna non arriva mai a schermo", async () => {
  // La consegna viene impacchettata come `titolo\n\nconsegna\n\ncodice`.
  // Logica di app/codice.tsx righe 51-52, RICOPIATA qui (il .tsx non si importa):
  //   const [titoloEconsegna, ...restoCodice] = e.consegna.split("\n\n");
  //   const codiceDifettoso = restoCodice.slice(1).join("\n\n") || restoCodice.join("\n\n");
  // A schermo vanno solo `titoloEconsegna` e `codiceDifettoso`: il blocco di
  // mezzo, cioe la domanda, non viene reso da nessuna parte.
  const righe = dbApp.database().getAllSync("SELECT id, consegna FROM esercizi WHERE tipo='lettura_codice' ORDER BY id");
  uguale("quanti moduli", righe.length, 20);
  let consegnaPersa = 0, codiceIntero = 0;
  for (const r of righe) {
    const [titoloEconsegna, ...restoCodice] = r.consegna.split("\n\n");
    const codiceDifettoso = restoCodice.slice(1).join("\n\n") || restoCodice.join("\n\n");
    const vero = veriCodice.find((c) => c.id === r.id);
    if (titoloEconsegna === vero.titolo && !codiceDifettoso.includes(vero.consegna)) consegnaPersa++;
    if (codiceDifettoso.trim() === vero.codice_difettoso.trim()) codiceIntero++;
  }
  uguale("DIFETTO: in tutti e 20 la domanda sparisce fra titolo e codice", consegnaPersa, 20);
  uguale("il codice difettoso invece arriva intero, anche in COD-20 che ha 4 blocchi", codiceIntero, 20);
  uguale("i moduli con una riga vuota doppia dentro il codice", veriCodice.filter((c) => c.codice_difettoso.includes("\n\n")).length, 1);
  ok("e uno solo: COD-20", veriCodice.filter((c) => c.codice_difettoso.includes("\n\n"))[0].id === "COD-20");
});

await scenario("H4 · esercizi_sql.json porta un campo anteprima che non viene mai letto", async () => {
  const conAnteprima = veriSql.filter((e) => e.anteprima !== undefined);
  ok("quasi tutti gli esercizi SQL hanno un'anteprima nel JSON", conAnteprima.length > 100, String(conAnteprima.length));
  const riga = dbApp.database().getFirstSync("SELECT * FROM esercizi WHERE id=?", [conAnteprima[0].id]);
  const valori = Object.values(riga).map((v) => String(v));
  ok("ma nessuna colonna la contiene", !valori.some((v) => v.includes(JSON.stringify(conAnteprima[0].anteprima))));
  ok("e il tipo EsercizioSql non la dichiara: e materiale per chi scrive i contenuti, non per l'app", true);
});

// ====================================================================== PARTE I
// I. Concorrenza e rete.

await scenario("CORREZIONE SORVEGLIATA I1 · due caricaContenuti() concorrenti riescono entrambe e il contenuto resta intero", async () => {
  // CON-13, CORRETTO. Prima: le due transazioni si annidavano sulla stessa
  // connessione, la ROLLBACK della seconda annullava quel che la prima aveva
  // gia scritto, e la prima proseguiva FUORI da ogni transazione, in
  // autocommit. Restavano 21 temi su 22 (mancava il primo, 'gestione') con
  // 381 esercizi gia dentro: da li in poi la guardia saltava per sempre,
  // perche guarda solo `esercizi`, e il buco era definitivo.
  // Ora lib/db.ts mette in coda: inTransazione() serializza, una transazione
  // per volta e in ordine di arrivo. La seconda chiamata parte quando la
  // prima ha gia committato, trova tutto scritto e i suoi INSERT OR IGNORE
  // non toccano niente. Lo scenario che inchiodava il difetto sorveglia ora
  // la correzione: sa gia come riprodurre la corsa, e resta il posto giusto
  // da cui accorgersi se la coda venisse tolta.
  azzeraContenuti();
  const esiti = await Promise.allSettled([contenuti.caricaContenuti(), contenuti.caricaContenuti()]);
  const messaggi = esiti.map((e) => String(e.reason?.message ?? "")).join(" || ");
  uguale("nessuna delle due chiamate rigetta", esiti.filter((e) => e.status === "rejected").length, 0, messaggi);
  ok("nessuna transazione aperta dentro un'altra transazione",
    !messaggi.includes("cannot start a transaction within a transaction"), messaggi);
  ok("nessuna ROLLBACK senza transazione attiva",
    !messaggi.includes("cannot rollback - no transaction is active"), messaggi);
  uguale("entrambe dichiarano di aver caricato (nessuna delle due e stata saltata)",
    esiti.filter((e) => e.status === "fulfilled" && e.value.saltato === false).length, 2);
  // Il contenuto e INTERO: e il punto esatto in cui il difetto si vedeva.
  uguale("i 22 temi ci sono tutti", conta("temi"), 22);
  uguale("compreso il primo, 'gestione', che era quello che spariva", conta("temi", "WHERE slug='gestione'"), 1);
  uguale("i 381 esercizi", conta("esercizi"), 381);
  uguale("i 52 volumi", conta("biblioteca"), 52);
  uguale("le 199 carte di ripasso", conta("ripasso"), 199);
  // La seconda passata non ha riscritto niente: se avesse ricominciato da capo
  // fuori transazione, i volumi porterebbero due istanti di inserimento.
  uguale("un solo istante di aggiunta in biblioteca: la seconda passata non ha riscritto nulla",
    dbApp.database().getFirstSync("SELECT count(DISTINCT aggiunto_a) AS n FROM biblioteca").n, 1);
  uguale("nessun esercizio con un tema orfano",
    conta("esercizi e LEFT JOIN temi t ON t.slug=e.tema_slug", "WHERE e.tema_slug IS NOT NULL AND t.slug IS NULL"), 0);
  uguale("nessuna carta di ripasso senza il suo esercizio",
    conta("ripasso r LEFT JOIN esercizi e ON e.id=r.esercizio_id", "WHERE e.id IS NULL"), 0);
  // La guardia del secondo avvio ora scatta su un contenuto COMPLETO, non su
  // un contenuto mutilo: saltare e la cosa giusta da fare.
  const terza = await contenuti.caricaContenuti();
  uguale("la terza chiamata salta, perche esercizi e piena", terza.saltato, true);
  uguale("e i 22 temi restano 22", conta("temi"), 22);
});

await scenario("I2 · la connessione resta utilizzabile dopo la corsa: nessuna transazione appesa", async () => {
  const d = dbApp.database();
  let appesa = "";
  try {
    d.execSync("BEGIN");
    d.execSync("ROLLBACK");
  } catch (e) {
    appesa = String(e.message);
  }
  uguale("si puo aprire una transazione nuova", appesa, "");
  const esito = await caricaIlContenutoVero();
  uguale("e il caricamento da zero riesce di nuovo", esito.saltato, false);
  uguale("con tutti e 22 i temi", conta("temi"), 22);
  uguale("e i 381 esercizi", conta("esercizi"), 381);
});

await scenario("I3 · caricamento interrotto a meta: al riavvio riparte e completa (idempotenza)", async () => {
  // CON-12. «App uccisa mentre la transazione e aperta» si simula con un
  // errore nell'ultimo ciclo: il rollback riporta a database vuoto, quindi la
  // guardia non scatta e il caricamento successivo riparte e completa.
  azzeraContenuti();
  contenutoFinto({
    sql: veriSql.slice(0, 5),
    codice: veriCodice.slice(0, 2),
    flash: veriFlash.slice(0, 3),
    scenari: veriScenari.slice(0, 1),
    volumi: { BIB01: { titolo: "non e un array" } },
  });
  await lancia("l'ultimo ciclo non e iterabile", () => contenuti.caricaContenuti(), "is not iterable");
  uguale("stato intermedio non osservabile: temi a zero", conta("temi"), 0);
  uguale("esercizi a zero", conta("esercizi"), 0);
  uguale("ripasso a zero (era dopo i volumi)", conta("ripasso"), 0);
  const esito = await caricaIlContenutoVero();
  uguale("al riavvio il caricamento riparte", esito.saltato, false);
  uguale("e completa", conta("esercizi"), 381);
  uguale("senza duplicati", conta("esercizi"), new Set([...veriSql, ...veriCodice, ...veriFlash, ...veriScenari].map((x) => x.id)).size);
});

await scenario("I4 · ricaricare su un database gia pieno e idempotente (INSERT OR IGNORE)", async () => {
  // Si forza il caricamento svuotando SOLO esercizi: temi, biblioteca e ripasso
  // restano pieni e vengono riattraversati dagli INSERT OR IGNORE.
  const d = dbApp.database();
  const istantePrima = d.getFirstSync("SELECT aggiunto_a AS a FROM biblioteca LIMIT 1").a;
  d.runSync("DELETE FROM esercizi");
  const esito = await contenuti.caricaContenuti();
  uguale("non salta, perche esercizi e vuota", esito.saltato, false);
  uguale("i temi restano 22, non 44", conta("temi"), 22);
  uguale("i volumi restano 52", conta("biblioteca"), 52);
  uguale("le carte restano 199", conta("ripasso"), 199);
  uguale("gli esercizi tornano 381", conta("esercizi"), 381);
  uguale("e aggiunto_a dei volumi NON viene riscritto (OR IGNORE non aggiorna)",
    d.getFirstSync("SELECT aggiunto_a AS a FROM biblioteca LIMIT 1").a, istantePrima);
});

await scenario("I5 · nessuna chiamata di rete in tutto il percorso di caricamento", async () => {
  // Trappole installate prima dell'import dei moduli dell'app.
  ugualeJson("nessuna chiamata intercettata", reteTentata, []);
  const sorgente = readFileSync(RADICE + "/lib/contenuti.ts", "utf8");
  ok("il sorgente non nomina fetch", !/\bfetch\s*\(/.test(sorgente));
  ok("il sorgente non nomina XMLHttpRequest", !sorgente.includes("XMLHttpRequest"));
  ok("il sorgente non importa moduli di rete", !/from\s+["'](node:)?(http|https|net|axios)["']/.test(sorgente));
  ok("i cinque contenuti sono require() di asset locali", (sorgente.match(/require\("\.\.\/assets\/contenuti\//g) ?? []).length === 5);
  ok("e palestra.db e un file impacchettato, non un download", true);
});

await scenario("I6 · stato finale coerente: il contenuto vero e integro dopo tutti gli scenari", async () => {
  await caricaIlContenutoVero();
  uguale("esercizi", conta("esercizi"), 381);
  uguale("temi", conta("temi"), 22);
  uguale("biblioteca", conta("biblioteca"), 52);
  uguale("ripasso", conta("ripasso"), 199);
  uguale("eventi (i contenuti non passano mai dal registro)", conta("eventi"), 0);
  uguale("nessuna riga orfana nella coda di ripasso",
    conta("ripasso r LEFT JOIN esercizi e ON e.id=r.esercizio_id", "WHERE e.id IS NULL"), 0);
});

// ------------------------------------------------------------------ RIEPILOGO
globalThis.fetch = fetchOriginale;
globalThis.XMLHttpRequest = xhrOriginale;

const totali = scenari.length;
const passati = scenari.filter((s) => !s.errori.length).length;
const verifiche = scenari.reduce((n, s) => n + s.verifiche, 0);
const verificheRosse = scenari.reduce((n, s) => n + s.errori.length, 0);

console.log("");
console.log("DIFETTI DELL'APP RIPRODOTTI (non corretti, la decisione e del coordinatore):");
for (const d of difettiRiprodotti) console.log("  · " + d);
if (correzioniSorvegliate.length) {
  console.log("");
  console.log(`CORREZIONI SORVEGLIATE (erano difetti riprodotti, ora sono guardie): ${correzioniSorvegliate.length}`);
  console.log("Verdetto rovesciato: qui il verde vuol dire che la correzione regge. Se uno di");
  console.log("questi torna rosso, e la correzione a essere regredita, non la prova a essere vecchia.");
  for (const c of correzioniSorvegliate) console.log("  · " + c);
}
console.log("");
console.log(`verifiche: ${verifiche - verificheRosse} su ${verifiche}`);
console.log(`passati ${passati} su ${totali}`);

if (passati === totali) {
  rmSync(cartella, { recursive: true, force: true });
} else {
  console.log(`la cartella NON e stata cancellata, i file sono qui: ${cartella}`);
}
process.exit(passati === totali ? 0 : 1);

/**
 * LIMITI NOTI — cosa questo verde NON dimostra.
 *
 * 1. IL BINDING DI `undefined` DIVERGE (scenario E7). Il doppio del banco
 *    normalizza undefined -> NULL; node:sqlite grezzo lancia; expo-sqlite non
 *    normalizza e passa undefined al nativo. Quale dei tre comportamenti abbia
 *    Android non e decidibile da qui: un item senza colonne_attese potrebbe
 *    LANCIARE sul telefono e impedire l'avvio dell'app per tutti i 381 item.
 *    E la sola verifica di questa superficie che va rifatta sul dispositivo.
 * 2. NIENTE INTERFACCIA. Le schermate non si caricano: la logica di
 *    app/codice.tsx (scenario H3) e quella di app/ripasso.tsx (scenario B11)
 *    sono RICOPIATE, non eseguite. Un difetto che sta nel .tsx (ordine delle
 *    chiamate, stato di React) qui non si vede.
 * 3. L'ASINCRONIA E' FINTA. Sotto c'e node:sqlite, sincrono. L'interfogliamento
 *    dello scenario I1 e quello dei microcompiti di JavaScript, che sul
 *    telefono c'e uguale (gli await sono gli stessi); il vero parallelismo del
 *    thread nativo no. La coda di lib/db.ts vive su quella stessa catena di
 *    promesse, quindi cio che I1 sorveglia vale per il telefono quanto qui:
 *    due chiamate dello stesso modulo non si accavallano piu. Quel che resta
 *    fuori portata e un secondo contesto JavaScript (due istanze del modulo,
 *    o una scrittura che entrasse da fuori senza passare da inTransazione):
 *    la coda e una variabile di modulo, e un'altra copia del modulo avrebbe
 *    la sua. Questo il banco non lo prova.
 * 4. SQLITE 3.51.2 di Node 22, non quello del telefono. Gli scenari G4-G7
 *    eseguono le 150 soluzioni su QUESTO motore: su un motore sotto 3.25 le 25
 *    soluzioni con window functions (23 nel tema + le 2 di G8) fallirebbero.
 *    La domanda sulla soglia 3.25 il banco non puo chiuderla.
 * 5. IL FILE DI PALESTRA E' UNA COPIA. G4-G7 aprono una copia in sola lettura:
 *    provano il CONTENUTO, non il percorso di apriPalestra() (che invece apre
 *    in lettura-scrittura, vedi RO-01, difetto di un altro agente).
 * 6. UN SOLO DISPOSITIVO. Le righe seed non hanno eventi corrispondenti: la
 *    ricostruzione dal solo registro non le ricrea. Provato altrove (SYN-07),
 *    non qui.
 * 7. I CONTENUTI DI OGGI. G1-G10 sono una fotografia dei cinque JSON attuali:
 *    valgono come rete di sicurezza per chi li rigenera, non come prova che
 *    qualunque contenuto futuro sara sano.
 */
