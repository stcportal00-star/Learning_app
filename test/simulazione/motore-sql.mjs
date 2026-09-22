/**
 * SIMULAZIONE DELLA SUPERFICIE "motore-sql": lib/palestra.ts e lib/verifica.ts.
 *
 * Si esegue dalla radice del progetto, senza argomenti e senza variabili:
 *
 *   node test/simulazione/motore-sql.mjs
 *
 * Il file si riavvia da solo con `--import ./test/banco/carica.mjs` e con
 * BANCO_DOPPI gia' composta (vedi test/banco/doppi-altri.mjs): i ganci del
 * banco vanno registrati prima di qualunque import, e questo e' il solo modo
 * di ottenerlo senza chiedere a chi esegue di ricordarsi una riga di comando.
 *
 * COSA SIMULA. Ogni interazione che passa per il motore degli esercizi:
 *   A. lo stato del modulo PRIMA che la palestra sia aperta;
 *   B. apriPalestra(): copia dell'asset, apertura, memorizzazione;
 *   C. esegui(): forma del risultato e casi limite del driver (colonne
 *      duplicate, omonime, alias numerici, BLOB, piu' istruzioni, PRAGMA);
 *   D. verifica(): tutti i modi in cui due risultati possono differire;
 *   E. ordineRilevante() e la sua copia privata in lib/contenuti.ts;
 *   F. eseguiConPreparazione(): copia temporanea, cancellazione, collisioni;
 *   G. scenari che richiedono lo stato del modulo FRESCO o un processo che si
 *      pianta: girano in processi figli (motore-sql-figlio.mjs);
 *   H. sola lettura (invariante 4): scritture, DDL, ATTACH, PRAGMA di stato.
 *      Sono DISTRUTTIVI per la copia temporanea e stanno apposta in fondo.
 *
 * DUE TIPI DI VERIFICA, e la differenza conta:
 *   ok(...)      — il comportamento CORRETTO atteso. Rosso = qualcosa non va.
 *   difetto(...) — inchioda un comportamento SBAGLIATO dell'app, misurato qui.
 *                  Verde = il difetto e' ancora li'. Rosso = qualcuno l'ha
 *                  corretto e questa prova va aggiornata. I difetti NON sono
 *                  stati corretti: la correzione la decide il coordinatore.
 *
 * Non tocca nulla del progetto: lavora in una radice temporanea che cancella
 * alla fine (e che LASCIA se qualcosa fallisce, per poterla aprire).
 * L'asset assets/contenuti/palestra.db non viene mai scritto: la sezione H
 * rovina la COPIA nella radice temporanea, che poi sparisce.
 *
 * COME VERIFICARE CHE QUESTA PROVA NON SIA UN TIMBRO. Si finge la correzione
 * che il coordinatore potrebbe applicare a RO-01, cioe' una palestra aperta
 * davvero in sola lettura, e si guarda se la sezione H diventa rossa.
 * Fatto: 13 verifiche rosse su 126, uscita 1, nessuna eccezione.
 *
 *   // falsificazione.mjs, in una cartella qualsiasi FUORI dal progetto
 *   import "/home/user/learning_app/test/banco/carica.mjs";
 *   import { BaseDatiDoppia } from "/home/user/learning_app/test/banco/expo-sqlite.mjs";
 *   const originale = BaseDatiDoppia.prototype.prepareSync;
 *   const SCRITTURA = /^\s*(insert|update|delete|drop|create|alter|attach|pragma\s+\w+\s*=)/i;
 *   BaseDatiDoppia.prototype.prepareSync = function (sorgente) {
 *     if (this.nomeDatabase === "palestra.db" && SCRITTURA.test(sorgente)) {
 *       throw new Error("attempt to write a readonly database");
 *     }
 *     return originale.call(this, sorgente);
 *   };
 *   await import("/home/user/learning_app/test/simulazione/motore-sql.mjs");
 *
 *   BANCO_DOPPI="$(node -e 'import("./test/banco/doppi-altri.mjs").then(m=>console.log(m.variabileBanco()))')" \
 *     MOTORE_SQL_IN_CORSO=1 node --import ./test/banco/carica.mjs /percorso/falsificazione.mjs
 *
 * INSTABILITA' DEL BANCO, da sapere prima di copiare questo schema. Con
 * node:sqlite, i ganci del banco e un risultato grande materializzato (la
 * verifica QRY-15 porta in memoria 64.000 righe) il processo puo' morire di
 * SEGMENTATION FAULT nella CHIUSURA di Node, DOPO che il riepilogo e' gia'
 * stato stampato: l'uscita diventa 139 e sembra un fallimento che non c'e'.
 * Riprodotto a intermittenza (3 volte su 4, poi 1 su 4) tagliando il file
 * subito dopo quella riga; non dipende da rmSync ne' da closeAsync. Non e' un
 * difetto dell'app: e' la chiusura di node:sqlite sotto pressione di memoria.
 * Rimedio adottato: questa prova esce con process.exit() esplicito, cosi' il
 * verdetto e' il suo. Le tre prove di test/banco/ non ne soffrono (misurato:
 * 12 esecuzioni, tutte a 0).
 */
import { spawnSync } from "node:child_process";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { variabileBanco } from "../banco/doppi-altri.mjs";

const QUESTA_CARTELLA = dirname(fileURLToPath(import.meta.url));
const RADICE_PROGETTO = resolve(QUESTA_CARTELLA, "..", "..");
const ASSET_PALESTRA = join(RADICE_PROGETTO, "assets/contenuti/palestra.db");

// ------------------------------------------------------- RIAVVIO CON I GANCI
if (!process.env.MOTORE_SQL_IN_CORSO) {
  const esito = spawnSync(
    process.execPath,
    ["--import", "./test/banco/carica.mjs", "test/simulazione/motore-sql.mjs"],
    {
      cwd: RADICE_PROGETTO,
      stdio: "inherit",
      env: { ...process.env, MOTORE_SQL_IN_CORSO: "1", BANCO_DOPPI: variabileBanco() },
    }
  );
  process.exit(esito.status ?? 1);
}

// ------------------------------------------------------------------ CONTEGGIO
let passati = 0;
const falliti = [];
const difettiInchiodati = [];
const correzioniSorvegliate = [];

function ok(nome, condizione, extra = "") {
  if (condizione) passati++;
  else falliti.push(`${nome}${extra ? " — " + extra : ""}`);
}

/**
 * Inchioda un difetto dell'app: passa finche' il comportamento sbagliato e'
 * ancora quello misurato. Se un giorno diventa rosso vuol dire che il difetto
 * e' stato corretto, ed e' questa prova a dover cambiare.
 */
function difetto(codice, nome, condizione, extra = "") {
  if (condizione) {
    passati++;
    difettiInchiodati.push(`${codice}: ${nome}`);
  } else {
    falliti.push(
      `${codice}: ${nome} — il comportamento e' CAMBIATO (difetto corretto?): aggiornare la prova${extra ? " — " + extra : ""}`
    );
  }
}

/**
 * Il contraltare di difetto(): passa quando vale il comportamento CORRETTO.
 * Gli scenari non si cancellano quando un difetto viene corretto — cambiano
 * mestiere. Da prova che il difetto c'e' a guardia che non torni.
 */
function corretto(codice, nome, condizione, extra = "") {
  if (condizione) {
    passati++;
    correzioniSorvegliate.push(`${codice}: ${nome}`);
  } else {
    falliti.push(
      `${codice}: ${nome} — LA CORREZIONE E' REGREDITA${extra ? " — " + extra : ""}`
    );
  }
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

/**
 * Esegue e riporta l'esito come DATO invece di lasciar cadere la prova.
 * Serve nella sezione H: se un giorno la palestra venisse aperta davvero in
 * sola lettura, le scritture verrebbero RIFIUTATE, e questa prova deve
 * diventare rossa in modo leggibile, non morire con un'eccezione.
 */
async function tenta(azione) {
  try {
    return { riuscito: true, valore: await azione() };
  } catch (errore) {
    return { riuscito: false, errore: String(errore?.message ?? errore) };
  }
}

const md5Di = (percorso) => createHash("md5").update(readFileSync(percorso)).digest("hex");
const nomiTmp = (cartella) => readdirSync(cartella).filter((n) => n.startsWith("palestra_tmp_"));

// ------------------------------------------------------------- PREPARAZIONE
import * as FS from "../banco/expo-file-system.mjs";
import { configuraCartella, openDatabaseSync } from "../banco/expo-sqlite.mjs";
import { installaRequireMetro } from "../banco/require-metro.mjs";

const radice = FS.configuraRadice(mkdtempSync(join(tmpdir(), "motore-sql-")));
// I database stanno dove li mette expo sul telefono: <documenti>/SQLite.
const cartellaSqlite = configuraCartella(join(FS.percorsoDocumenti(), "SQLite"));
installaRequireMetro(RADICE_PROGETTO);

// apriPalestra() deve poter creare lui la cartella: e' il primo avvio assoluto.
rmSync(cartellaSqlite, { recursive: true, force: true });

const palestra = await import("../../lib/palestra.ts");
const V = await import("../../lib/verifica.ts");

// =========================================================== A. PRIMA DELL'APERTURA
ok(
  "A1 versioneMotore() prima di apriPalestra() risponde 'sconosciuta'",
  palestra.versioneMotore() === "sconosciuta",
  palestra.versioneMotore()
);
ok(
  "A2 supportaWindowFunctions() prima dell'apertura e' falsa (scelta prudente)",
  palestra.supportaWindowFunctions() === false
);

// ================================================================ B. apriPalestra
ok("B1 prima dell'apertura la cartella SQLite non esiste", !existsSync(cartellaSqlite));

const base = await palestra.apriPalestra();
const fileCopiato = join(cartellaSqlite, "palestra.db");
ok("B2 apriPalestra() crea la cartella SQLite con gli intermedi", existsSync(cartellaSqlite));
ok("B3 apriPalestra() copia l'asset palestra.db nello spazio dell'app", existsSync(fileCopiato));
ok(
  "B4 la copia e' identica all'asset, byte per byte",
  md5Di(fileCopiato) === md5Di(ASSET_PALESTRA)
);
ok("B5 apriPalestra() restituisce una connessione utilizzabile", typeof base.getAllAsync === "function");
ok(
  "B6 versioneMotore() legge la versione vera del motore",
  /^3\.\d+/.test(palestra.versioneMotore()),
  palestra.versioneMotore()
);
ok("B7 supportaWindowFunctions() e' vero da 3.25 in su", palestra.supportaWindowFunctions() === true);

const mtimePrima = statSync(fileCopiato).mtimeMs;
const base2 = await palestra.apriPalestra();
ok("B8 la seconda apriPalestra() restituisce la connessione gia' memorizzata", base === base2);
ok("B9 la seconda apriPalestra() non ricopia il file", statSync(fileCopiato).mtimeMs === mtimePrima);

const finestra = await palestra.esegui(
  "SELECT operatore, row_number() OVER (ORDER BY operatore) AS n FROM visite LIMIT 3"
);
ok("B10 una window function gira davvero su questo motore", finestra.righe.length === 3);


// ================================================================ C. esegui()
// Forma del risultato e casi limite del driver. Sono la materia prima di
// verifica(): se qui si perde qualcosa, il confronto giudica un risultato monco.

const tre = await palestra.esegui("SELECT id, nome FROM strutture ORDER BY id LIMIT 3");
ok("C1 esegui() restituisce i nomi delle colonne nell'ordine della SELECT",
  JSON.stringify(tre.colonne) === JSON.stringify(["id", "nome"]), JSON.stringify(tre.colonne));
ok("C2 esegui() restituisce le righe come array di valori, non come oggetti",
  tre.righe.length === 3 && Array.isArray(tre.righe[0]) && tre.righe[0].length === 2);
ok("C3 i valori arrivano con il tipo di SQLite (INTEGER e TEXT)",
  typeof tre.righe[0][0] === "number" && typeof tre.righe[0][1] === "string");

const vuoto = await palestra.esegui("SELECT id, nome FROM strutture WHERE id < 0");
ok("C4 una query senza righe restituisce zero righe", vuoto.righe.length === 0);
difetto("QRY-03a", "esegui() deduce le colonne da righe[0]: con zero righe dichiara ZERO colonne",
  vuoto.colonne.length === 0, JSON.stringify(vuoto.colonne));

await lancia("C5 tabella inesistente: l'errore grezzo di SQLite risale al chiamante",
  () => palestra.esegui("SELECT * FROM tabella_che_non_esiste"), "no such table");
await lancia("C6 sintassi errata: il messaggio nomina il punto dell'errore",
  () => palestra.esegui("SELEC * FROM visite"), "syntax error");
await lancia("C7 una risposta fatta del solo commento '-- niente' non e' una query eseguibile",
  () => palestra.esegui("-- niente"), "");

// QRY-19: piu' istruzioni separate da punto e virgola.
const dueIstruzioni = await palestra.esegui("SELECT 1 AS a; SELECT 2 AS b");
ok("C8 di due istruzioni separate da ';' viene eseguita solo la PRIMA",
  JSON.stringify(dueIstruzioni.colonne) === JSON.stringify(["a"]) && dueIstruzioni.righe[0][0] === 1);
await palestra.esegui("SELECT 1 AS a; CREATE TABLE zzz_coda_scartata (x)");
const codaScartata = await palestra.esegui(
  "SELECT count(*) AS n FROM sqlite_master WHERE name = 'zzz_coda_scartata'");
ok("C9 ...e la coda scartata non viene eseguita nemmeno se e' distruttiva",
  codaScartata.righe[0][0] === 0);

// QRY-06: colonne omonime nella stessa SELECT.
const duplicata = await palestra.esegui("SELECT id, id FROM strutture ORDER BY id LIMIT 2");
difetto("QRY-06", "SELECT id, id dichiara UNA sola colonna: Object.keys collassa gli omonimi",
  duplicata.colonne.length === 1, JSON.stringify(duplicata.colonne));
const aliasRipetuto = await palestra.esegui("SELECT nome AS a, tipo AS a FROM strutture LIMIT 1");
difetto("QRY-06b", "anche un alias ripetuto (nome AS a, tipo AS a) collassa a una colonna",
  aliasRipetuto.colonne.length === 1);

// QRY-07: due colonne omonime di tabelle diverse in un JOIN.
const omonime = await palestra.esegui(
  "SELECT s.id, v.id FROM strutture s JOIN visite v ON v.struttura_id = s.id ORDER BY v.id LIMIT 3");
const controlloOmonime = await palestra.esegui(
  "SELECT s.id AS sid, v.id AS vid FROM strutture s JOIN visite v ON v.struttura_id = s.id ORDER BY v.id LIMIT 3");
difetto("QRY-07", "un JOIN con due colonne omonime perde meta' del risultato: resta una colonna sola",
  omonime.colonne.length === 1 && controlloOmonime.colonne.length === 2);
difetto("QRY-07b", "...e il valore che sopravvive e' quello dell'ULTIMA colonna, non della prima",
  omonime.righe.every((r, i) => r[0] === controlloOmonime.righe[i][1]) &&
    controlloOmonime.righe.some((r) => r[0] !== r[1]));

// QRY-08: nomi di colonna che sono stringhe numeriche.
const numeriche = await palestra.esegui('SELECT 2 AS "2", 1 AS "1", 0.5 AS x');
difetto("QRY-08", "colonne con nome numerico vengono RIORDINATE: Object.keys mette prima gli interi",
  JSON.stringify(numeriche.colonne) === JSON.stringify(["1", "2", "x"]), JSON.stringify(numeriche.colonne));
ok("C10 ...e i valori seguono il riordino delle chiavi, non la SELECT",
  numeriche.righe[0][0] === 1 && numeriche.righe[0][1] === 2 && numeriche.righe[0][2] === 0.5);

// RO-04 (parte di sola lettura): i PRAGMA di LETTURA servono agli esercizi.
const info = await palestra.esegui("PRAGMA table_info(visite)");
ok("C11 PRAGMA table_info(visite) restituisce le sue 8 righe e 6 colonne",
  info.righe.length === 8 && info.colonne.length === 6, JSON.stringify(info.colonne));
const piano = await palestra.esegui("EXPLAIN QUERY PLAN SELECT * FROM visite WHERE operatore = 'OP-007'");
ok("C12 EXPLAIN QUERY PLAN gira e senza indice dichiara una scansione",
  piano.righe.length === 1 && String(piano.righe[0][3]).includes("SCAN visite"),
  JSON.stringify(piano.righe));

// QRY-13: i BLOB arrivano come Uint8Array.
const blob = await palestra.esegui("SELECT x'0102' AS b");
ok("C13 un BLOB arriva come Uint8Array", blob.righe[0][0] instanceof Uint8Array);

// QRY-15: nessun limite implicito sulle righe materializzate.
const esplosiva = await palestra.esegui("SELECT a.id FROM strutture a, strutture b, strutture c");
difetto("QRY-15", "nessun tetto alle righe materializzate: 64.000 righe tornano tutte in memoria",
  esplosiva.righe.length === 64000, String(esplosiva.righe.length));

// =============================================================== D. verifica()
// Il confronto fra la risposta dell'utente e la soluzione di riferimento.
// Qui l'esecutore e' programmato dal test: si isola il CONFRONTO dal motore,
// cosi' ogni scenario mette in campo esattamente i due risultati che vuole.

const RIF = "-- soluzione di riferimento";
const UTE = "-- risposta dell'utente";

/** Confronta due risultati gia' pronti passando per il vero verifica(). */
function confronta(atteso, ottenuto, opzioni = {}) {
  const esecutore = async (sql) => {
    const v = sql === RIF ? atteso : sql === UTE ? ottenuto : null;
    if (v === null) throw new Error(`query non programmata: ${sql}`);
    if (v instanceof Error) throw v;
    return v;
  };
  return V.verifica(esecutore, UTE, RIF, opzioni);
}
const ris = (colonne, righe) => ({ colonne, righe });

// ---- i tre esiti che l'utente deve poter ottenere
const d1 = await confronta(ris(["a", "b"], [[1, "x"], [2, "y"]]), ris(["a", "b"], [[1, "x"], [2, "y"]]));
ok("D1 QRY-01 due risultati identici: corretto, motivo 'identico'",
  d1.corretto === true && d1.motivo === "identico", JSON.stringify(d1));

const d2 = await confronta(ris(["a"], [[1], [2], [3]]), ris(["a"], [[3], [1], [2]]));
ok("D2 VER-02 stesse righe in ordine diverso, ordine non richiesto: corretto",
  d2.corretto === true && d2.motivo === "identico_a_meno_dell_ordine", JSON.stringify(d2));

const d3 = await confronta(ris(["a"], [[1], [2], [3]]), ris(["a"], [[3], [1], [2]]), { ordineRilevante: true });
ok("D3 VER-03 stesse righe in ordine diverso, ordine RICHIESTO: non corretto",
  d3.corretto === false && d3.motivo === "righe_diverse" &&
    d3.dettaglio.includes("l'ordine richiesto non è rispettato"), JSON.stringify(d3));
difetto("VER-03b", "l'ordine sbagliato riusa il motivo 'righe_diverse' del conteggio righe: chi legge solo il motivo non distingue i due casi",
  d3.motivo === "righe_diverse");

const d4 = await confronta(ris(["a"], [[1]]), new Error('near "SELEC": syntax error'));
ok("D4 QRY-02 la query dell'utente non gira: errore_sql con il messaggio grezzo",
  d4.corretto === false && d4.motivo === "errore_sql" &&
    d4.dettaglio === "La query non viene eseguita." && d4.errore.includes("SELEC"), JSON.stringify(d4));

const d5 = await confronta(new Error("no such function: row_number"), ris(["a"], [[1]]));
ok("D5 VER-01 la soluzione di riferimento non gira: la colpa e' attribuita al contenuto",
  d5.corretto === false && d5.motivo === "errore_sql" &&
    d5.dettaglio.includes("soluzione di riferimento"), JSON.stringify(d5));

// ---- QRY-03: zero righe da una parte sola
const d6 = await V.verifica(palestra.esegui,
  "SELECT id, nome FROM strutture WHERE id < 0",
  "SELECT id, nome FROM strutture ORDER BY id LIMIT 4");
difetto("QRY-03", "risposta a ZERO righe: la diagnosi parla di colonne, non di righe",
  d6.motivo === "colonne_diverse" && d6.dettaglio.includes("ottenute 0"), JSON.stringify(d6));
ok("D6b ...e il campo righeOttenute dice comunque 0 su 4 attese",
  d6.righeAttese === 4 && d6.righeOttenute === 0);

const d7 = await V.verifica(palestra.esegui,
  "SELECT id, nome FROM strutture ORDER BY id LIMIT 4",
  "SELECT id, nome FROM strutture WHERE id < 0");
difetto("QRY-03b", "a parti invertite (riferimento vuoto, risposta piena) la diagnosi e' altrettanto sbagliata",
  d7.motivo === "colonne_diverse", JSON.stringify(d7));

// ---- QRY-04: entrambi vuoti
const d8 = await V.verifica(palestra.esegui,
  "SELECT 1 WHERE 0",
  "SELECT id, nome, tipo, paese FROM strutture WHERE id < 0");
difetto("QRY-04", "due risultati VUOTI passano come 'identico': 'SELECT 1 WHERE 0' risolve l'esercizio",
  d8.corretto === true && d8.motivo === "identico", JSON.stringify(d8));

// ---- QRY-05: stesse colonne in ordine diverso
const d9 = await confronta(ris(["paese", "n"], [["IT", 3], ["FR", 5]]), ris(["n", "paese"], [[3, "IT"], [5, "FR"]]));
difetto("QRY-05", "colonne invertite: l'esito e' 'valori_diversi', mai un messaggio sull'ordine delle colonne",
  d9.corretto === false && d9.motivo === "valori_diversi", JSON.stringify(d9));
const d10 = await confronta(ris(["a", "b"], [["X", "X"], ["Y", "Y"]]), ris(["b", "a"], [["X", "X"], ["Y", "Y"]]));
difetto("QRY-05b", "se le due colonne scambiate contengono gli stessi valori lo scambio passa come corretto",
  d10.corretto === true, JSON.stringify(d10));

// ---- QRY-06 e QRY-07 dentro verifica(), sul database vero
const d11 = await V.verifica(palestra.esegui,
  "SELECT id, id FROM strutture ORDER BY id LIMIT 3",
  "SELECT id FROM strutture ORDER BY id LIMIT 3");
difetto("QRY-06c", "una risposta con la colonna DUPLICATA passa come 'identico' contro un riferimento a una colonna",
  d11.corretto === true && d11.motivo === "identico", JSON.stringify(d11));

const d12 = await V.verifica(palestra.esegui,
  "SELECT s.id, v.id FROM strutture s JOIN visite v ON v.struttura_id = s.id ORDER BY v.id LIMIT 3",
  "SELECT v.id FROM strutture s JOIN visite v ON v.struttura_id = s.id ORDER BY v.id LIMIT 3");
difetto("QRY-07c", "una risposta a due colonne omonime passa contro un riferimento a una sola colonna",
  d12.corretto === true, JSON.stringify(d12));

const d13 = await V.verifica(palestra.esegui, 'SELECT 2 AS "2", 1 AS "1"', 'SELECT 1 AS "1", 2 AS "2"');
difetto("QRY-08b", "colonne numeriche: proiettarle in ordine INVERTITO passa come 'identico'",
  d13.corretto === true && d13.motivo === "identico", JSON.stringify(d13));

// ---- QRY-09: alias diversi, stessi valori: DEVE passare (invariante 3)
const d14 = await confronta(ris(["paese", "quanti"], [["IT", 3]]), ris(["nazione", "totale"], [["IT", 3]]));
ok("D14 QRY-09 alias di colonna diversi ma stessi valori: corretto (invariante 3)",
  d14.corretto === true && d14.motivo === "identico", JSON.stringify(d14));

// ---- QRY-10 / QRY-11: tipi
const d15 = await confronta(ris(["a"], [[10]]), ris(["a"], [["10"]]));
ok("D15 QRY-10 scelta documentata: TEXT '10' e INTEGER 10 sono considerati uguali",
  d15.corretto === true, JSON.stringify(d15));
const d16 = await confronta(ris(["a"], [[10]]), ris(["a"], [[10.0]]));
ok("D16 QRY-11 REAL 10.0 e INTEGER 10 sono uguali (comportamento voluto)", d16.corretto === true);
const d17 = await confronta(ris(["a"], [[2.5]]), ris(["a"], [[2.5000001]]));
ok("D17 QRY-12 la tolleranza a sei decimali assorbe il rumore IEEE754", d17.corretto === true);
const d18 = await confronta(ris(["a"], [[0.1 + 0.2]]), ris(["a"], [[0.3]]));
ok("D18 QRY-12 0.1+0.2 vale 0.3", d18.corretto === true, JSON.stringify(d18));
// La mappa dei lettori dava 0.1234561 e 0.1234567 per indistinguibili: e' falso,
// toFixed ARROTONDA e le due stringhe divergono. Il falso positivo vero sta
// altrove: la tolleranza e' ASSOLUTA, quindi morde i valori piccoli.
const d19a = await confronta(ris(["a"], [[0.1234561]]), ris(["a"], [[0.1234567]]));
ok("D19 QRY-12b toFixed arrotonda: 0.1234561 e 0.1234567 restano distinti",
  d19a.corretto === false, JSON.stringify(d19a));
const d19 = await confronta(ris(["a"], [[1e-7]]), ris(["a"], [[4e-7]]));
difetto("QRY-12c", "la tolleranza e' ASSOLUTA a sei decimali: 1e-7 e 4e-7 (quattro volte tanto) passano come uguali",
  d19.corretto === true, JSON.stringify(d19));
const d19b = await confronta(ris(["a"], [[-1e-7]]), ris(["a"], [[1e-7]]));
ok("D19b ...ma lo zero negativo resta distinto da quello positivo ('-0.000000')",
  d19b.corretto === false, JSON.stringify(d19b));
const d20 = await confronta(ris(["a"], [[1e21]]), ris(["a"], [["1000000000000000000000"]]));
ok("D20 QRY-11b oltre 2^53 la notazione esponenziale NON pareggia con le cifre estese",
  d20.corretto === false, JSON.stringify(d20));

// ---- QRY-13: BLOB
const d21 = await confronta(ris(["b"], [[new Uint8Array([1, 2])]]), ris(["b"], [["1,2"]]));
difetto("QRY-13", "un BLOB x'0102' e la stringa di testo '1,2' sono indistinguibili",
  d21.corretto === true, JSON.stringify(d21));
const d22 = await confronta(ris(["b"], [[new Uint8Array([1, 2])]]), ris(["b"], [[new Uint8Array([1, 3])]]));
ok("D22 QRY-13b due BLOB diversi restano diversi", d22.corretto === false);

// ---- QRY-14: NULL contro stringa vuota e contro zero
const d23 = await confronta(ris(["a"], [[null]]), ris(["a"], [[""]]));
ok("D23 QRY-14 NULL non pareggia con la stringa vuota", d23.corretto === false);
const d24 = await confronta(ris(["a"], [[null]]), ris(["a"], [[0]]));
ok("D24 QRY-14b NULL non pareggia con 0", d24.corretto === false);
const d25 = await confronta(ris(["a"], [[null]]), ris(["a"], [["\u0000NULL"]]));
difetto("QRY-14c", "una stringa che contiene letteralmente il marcatore \\u0000NULL pareggia con un NULL vero",
  d25.corretto === true, JSON.stringify(d25));
const d26 = await confronta(ris(["a", "b"], [["a\u001fb", "c"]]), ris(["a", "b"], [["a", "b\u001fc"]]));
difetto("QRY-14d", "il separatore \\u001f fra colonne ha la stessa collisione: due righe diverse danno la stessa chiave",
  d26.corretto === true, JSON.stringify(d26));

// ---- conteggi e multiinsieme
const d27 = await confronta(ris(["a"], [[1], [2]]), ris(["a"], [[1], [2], [3]]));
ok("D27 numero di righe diverso: motivo 'righe_diverse' con attese e ottenute",
  d27.motivo === "righe_diverse" && d27.righeAttese === 2 && d27.righeOttenute === 3, JSON.stringify(d27));
const d28 = await confronta(ris(["a"], [[1], [1], [2]]), ris(["a"], [[1], [2], [2]]));
ok("D28 VER-02b il confronto e' un multiinsieme: le ripetizioni contano",
  d28.corretto === false && d28.motivo === "valori_diversi", JSON.stringify(d28));

// ---- VER-05: il messaggio di differenza
const d29 = await confronta(ris(["a", "b"], [[null, "x"]]), ris(["a", "b"], [["y", "x"]]));
difetto("VER-05", "la riga d'esempio mostra il marcatore \\u0000NULL grezzo all'utente",
  d29.dettaglio.includes("\u0000NULL"), JSON.stringify(d29));
ok("D29b ...e le colonne della riga d'esempio sono separate da ' | '", d29.dettaglio.includes(" | "));

const d30 = await confronta(ris(["a"], [[1], [2], [3]]), ris(["a"], [[9], [8], [7]]));
difetto("VER-05b", "il ciclo raccoglie fino a 2 righe mancanti ma ne mostra una sola",
  d30.dettaglio.includes("1") && !d30.dettaglio.includes("2"), JSON.stringify(d30));

// VER-05c: il multiinsieme dell'ottenuto viene RICOSTRUITO dentro il ciclo.
// Si conta quante volte ogni riga ottenuta viene riserializzata: se il
// ricalcolo fosse fuori dal ciclo il conto sarebbe lineare, non quadratico.
let serializzazioni = 0;
class RigaContata extends Array {
  map(f) {
    serializzazioni++;
    return Array.prototype.map.call(this, f);
  }
}
const N = 200;
const attese = [];
const ottenute = [];
for (let i = 0; i < N; i++) {
  attese.push([i]);
  const r = new RigaContata();
  Array.prototype.push.call(r, i === N - 1 ? -1 : i);
  ottenute.push(r);
}
serializzazioni = 0;
const d31 = await confronta(ris(["a"], attese), ris(["a"], ottenute));
difetto("VER-05c", `multiinsieme(ottenuto) ricostruito a ogni chiave attesa: ${serializzazioni} riserializzazioni per ${N} righe`,
  d31.motivo === "valori_diversi" && serializzazioni >= N * N, String(serializzazioni));

// ---- QRY-18: due verifiche identiche di fila
const d32a = await confronta(ris(["a"], [[1]]), ris(["a"], [[1]]));
const d32b = await confronta(ris(["a"], [[1]]), ris(["a"], [[1]]));
ok("D32 QRY-18 il motore e' senza memoria: due verifiche identiche danno lo stesso esito",
  JSON.stringify(d32a) === JSON.stringify(d32b));

// ========================================================== E. ordineRilevante()
// Decide se due risultati con le stesse righe in ordine diverso siano
// equivalenti. E' l'euristica che stabilisce quanto e' severo il confronto.

ok("E1 'dalla più alta' nella consegna rende l'ordine rilevante",
  V.ordineRilevante("Elenca le strutture dalla più alta occupazione", "SELECT 1") === true);
ok("E2 'in ordine decrescente' rende l'ordine rilevante",
  V.ordineRilevante("Ordina in ordine decrescente", "SELECT 1") === true);
ok("E3 'le prime 5' rende l'ordine rilevante",
  V.ordineRilevante("Mostra le prime 5 strutture", "SELECT 1") === true);
ok("E4 'ultima visita' rende l'ordine rilevante",
  V.ordineRilevante("Trova l'ultima visita di ogni paziente", "SELECT 1") === true);
ok("E5 una consegna neutra con soluzione senza LIMIT non rende l'ordine rilevante",
  V.ordineRilevante("Conta le visite per struttura", "SELECT struttura_id, count(*) FROM visite GROUP BY 1") === false);
ok("E6 un LIMIT nella soluzione rende l'ordine rilevante",
  V.ordineRilevante("Conta le visite", "SELECT * FROM visite LIMIT 10") === true);
ok("E7 'limite' NON e' 'limit': il confine di parola regge",
  V.ordineRilevante("Conta le visite", "SELECT * FROM soglie WHERE nome = 'limite superiore'") === false);
difetto("ORD-01", "'ordin' dentro un'altra parola basta: 'coordinamento' rende l'ordine rilevante",
  V.ordineRilevante("Elenca le strutture di coordinamento regionale", "SELECT 1") === true);
difetto("ORD-02", "LIMIT dentro una stringa letterale della soluzione rende l'ordine rilevante",
  V.ordineRilevante("Conta le visite", "SELECT * FROM t WHERE nome = 'LIMIT'") === true);
ok("E8 il confronto e' insensibile alle maiuscole",
  V.ordineRilevante("CLASSIFICA le strutture", "SELECT 1") === true);

// VER-04: l'euristica e' duplicata testualmente in lib/contenuti.ts, dove
// calcola la colonna esercizi.ordine_rilevante memorizzata al primo avvio.
// Se le due copie divergono, cio' che e' memorizzato non coincide piu' con
// cio' che verifica le risposte. Questa prova le tiene incollate.
const REGOLA_CONSEGNA = "/ordin|dal più|dalla più|prime? \\d|ultim|classific|posizione|decrescent|crescent/i.test(";
const REGOLA_LIMIT = "/\\blimit\\b/i.test(";
const sorgenteVerifica = readFileSync(join(RADICE_PROGETTO, "lib/verifica.ts"), "utf8");
const sorgenteContenuti = readFileSync(join(RADICE_PROGETTO, "lib/contenuti.ts"), "utf8");
ok("E9 VER-04 le due copie dell'euristica usano la STESSA espressione sulla consegna",
  sorgenteVerifica.includes(REGOLA_CONSEGNA) && sorgenteContenuti.includes(REGOLA_CONSEGNA));
ok("E10 ...e la stessa espressione sul LIMIT della soluzione",
  sorgenteVerifica.includes(REGOLA_LIMIT) && sorgenteContenuti.includes(REGOLA_LIMIT));

// VER-04, la conseguenza: tre esercizi hanno LIMIT senza ORDER BY, quindi
// ordine_rilevante = 1 su un risultato che SQLite non garantisce.
const esercizi = JSON.parse(readFileSync(join(RADICE_PROGETTO, "assets/contenuti/esercizi_sql.json"), "utf8"));
const limitSenzaOrdine = esercizi.filter(
  (e) => /\blimit\b/i.test(e.soluzione) && !/order\s+by/i.test(e.soluzione));
difetto("VER-04", `${limitSenzaOrdine.length} esercizi hanno LIMIT senza ORDER BY (${limitSenzaOrdine.map((e) => e.id).join(", ")}) e l'euristica li dichiara a ordine rilevante`,
  limitSenzaOrdine.length === 3 &&
    limitSenzaOrdine.every((e) => V.ordineRilevante(e.consegna, e.soluzione) === true));

// ========================================== F. eseguiConPreparazione()
// Gli esercizi di ottimizzazione girano su una COPIA usa-e-getta: e' il modo
// in cui l'invariante 4 dovrebbe essere protetta.

const SQL088 = esercizi.find((e) => e.id === "SQL-088");
const SQL150 = esercizi.find((e) => e.id === "SQL-150");

ok("F0 nessun residuo temporaneo prima di cominciare", nomiTmp(cartellaSqlite).length === 0);

// PRE-01: la copia esiste DURANTE l'esecuzione e sparisce subito dopo.
// La copia e' sincrona e avviene prima del primo await: si puo' guardare.
const inVolo = palestra.eseguiConPreparazione(SQL088.preparazione, SQL088.soluzione);
const durante = nomiTmp(cartellaSqlite);
const piano088 = await inVolo;
ok("F1 PRE-01 durante l'esecuzione esiste UNA copia temporanea palestra_tmp_<ms>.db",
  durante.length === 1 && /^palestra_tmp_\d+\.db$/.test(durante[0]), JSON.stringify(durante));
ok("F2 PRE-01 al termine la cartella SQLite non contiene piu' nessuna copia",
  nomiTmp(cartellaSqlite).length === 0, JSON.stringify(nomiTmp(cartellaSqlite)));
ok("F3 PRE-01 la preparazione ha effetto: il piano usa l'indice creato",
  piano088.righe.length === 1 && String(piano088.righe[0][3]).includes("idx_visite_operatore"),
  JSON.stringify(piano088.righe));
const indiciOriginale = await palestra.esegui(
  "SELECT count(*) AS n FROM sqlite_master WHERE type = 'index' AND name = 'idx_visite_operatore'");
ok("F4 PRE-01 invariante 4: l'indice NON compare nella palestra originale", indiciOriginale.righe[0][0] === 0);

// SQL-150 crea una TABELLA: la copia deve restare l'unica a conoscerla.
const agg = await palestra.eseguiConPreparazione(SQL150.preparazione, SQL150.soluzione);
ok("F5 una preparazione che CREA UNA TABELLA funziona sulla copia", agg.righe.length === 30);
const tabellaOriginale = await palestra.esegui(
  "SELECT count(*) AS n FROM sqlite_master WHERE name = 'agg_struttura_mese'");
ok("F6 ...e la tabella non esiste nella palestra originale", tabellaOriginale.righe[0][0] === 0);
ok("F7 nessun residuo dopo l'esercizio SQL-150", nomiTmp(cartellaSqlite).length === 0);

// PRE-01, il costo: verifica() chiama l'esecutore DUE volte, quindi per un
// solo tocco su "Esegui e verifica" si fanno due copie da 2 MB e due CREATE INDEX.
let chiamateEsecutore = 0;
const esecutoreContato = (sql) => {
  chiamateEsecutore++;
  return palestra.eseguiConPreparazione(SQL088.preparazione, sql);
};
const inizioCosto = Date.now();
const esito088 = await V.verifica(esecutoreContato, SQL088.soluzione, SQL088.soluzione, {
  ordineRilevante: V.ordineRilevante(SQL088.consegna, SQL088.soluzione),
});
const costoMs = Date.now() - inizioCosto;
ok("F8 PRE-01 un esercizio con preparazione risolto correttamente passa", esito088.corretto === true,
  JSON.stringify(esito088));
difetto("PRE-01b", `una sola verifica invoca l'esecutore 2 volte: 2 copie da 2 MB e 2 CREATE INDEX (${costoMs} ms qui, su hardware da server)`,
  chiamateEsecutore === 2, String(chiamateEsecutore));
ok("F9 anche dopo una verifica intera non resta nessuna copia", nomiTmp(cartellaSqlite).length === 0);

// PRE-05: la preparazione stessa fallisce.
await lancia("F10 PRE-05 una preparazione non valida solleva",
  () => palestra.eseguiConPreparazione("CREATE INDEX ;;", "SELECT 1"), "syntax error");
ok("F11 PRE-05 ...e il finally cancella comunque la copia temporanea",
  nomiTmp(cartellaSqlite).length === 0, JSON.stringify(nomiTmp(cartellaSqlite)));
await lancia("F12 PRE-05b un indice gia' esistente nella preparazione solleva",
  () => palestra.eseguiConPreparazione(
    "CREATE INDEX idx_due ON visite(esito); CREATE INDEX idx_due ON visite(tipo);", "SELECT 1"),
  "already exists");

// PRE-05, il messaggio che arriva all'utente: dentro verifica() il primo
// esecutore invocato e' quello della soluzione di RIFERIMENTO.
const esitoPrepRotta = await V.verifica(
  (sql) => palestra.eseguiConPreparazione("CREATE INDEX ;;", sql),
  "SELECT 1", "SELECT 1");
difetto("PRE-05c", "se la preparazione dell'esercizio e' rotta l'utente legge 'La soluzione di riferimento non è eseguibile su questo dispositivo'",
  esitoPrepRotta.motivo === "errore_sql" && esitoPrepRotta.dettaglio.includes("soluzione di riferimento"),
  JSON.stringify(esitoPrepRotta));

// PRE-03: i file collaterali della copia (-wal, -shm).
const primaWal = readdirSync(cartellaSqlite).slice();
await palestra.eseguiConPreparazione("PRAGMA journal_mode = WAL;", "SELECT count(*) AS n FROM visite");
const residuiWal = readdirSync(cartellaSqlite).filter((n) => /^palestra_tmp_.*(-wal|-shm)$/.test(n));
ok("F13 PRE-03 con journal_mode=WAL sulla copia non restano sidecar orfani dopo la chiusura",
  residuiWal.length === 0, JSON.stringify(residuiWal));
ok("F14 PRE-03b ...e nemmeno il file principale della copia",
  nomiTmp(cartellaSqlite).length === 0, JSON.stringify(readdirSync(cartellaSqlite)));
void primaWal;

// PRE-04: il nome della copia e' palestra_tmp_${Date.now()}.db. Due esecuzioni
// concorrenti nello stesso millisecondo si contendono lo stesso file. Qui
// l'orologio viene congelato per rendere la collisione deterministica: sul
// telefono la stessa cosa capita da sola se due verifiche partono insieme
// (doppio tocco su "Esegui e verifica" prima che inCorso diventi vero).
const oraVera = Date.now;
Date.now = () => 1700000000000;
let collisione = null;
try {
  const primaCopia = palestra.eseguiConPreparazione("CREATE INDEX idx_a ON visite(esito);", "SELECT 1 AS a");
  const secondaCopia = palestra.eseguiConPreparazione("CREATE INDEX idx_b ON visite(tipo);", "SELECT 2 AS b");
  const esiti = await Promise.allSettled([primaCopia, secondaCopia]);
  collisione = esiti.map((e) => (e.status === "rejected" ? String(e.reason?.message ?? e.reason) : "ok"));
} finally {
  Date.now = oraVera;
}
difetto("PRE-04", `due esecuzioni concorrenti nello stesso millisecondo si contendono palestra_tmp_<ms>.db: ${JSON.stringify(collisione)}`,
  collisione.some((e) => e !== "ok"));
ok("F15 PRE-04b dopo la collisione non resta nessuna copia orfana",
  nomiTmp(cartellaSqlite).length === 0, JSON.stringify(nomiTmp(cartellaSqlite)));

// PRE-06: il ramo opzioni.preparazione di verifica(), che app/esercizi.tsx non usa.
const esitoRamoMorto = await V.verifica(
  (sql) => palestra.eseguiConPreparazione("CREATE INDEX idx_c ON visite(operatore);", sql),
  "EXPLAIN QUERY PLAN SELECT * FROM visite WHERE operatore = 'OP-007'",
  "EXPLAIN QUERY PLAN SELECT * FROM visite WHERE operatore = 'OP-007'",
  { preparazione: "CREATE INDEX idx_d ON visite(esito);" });
ok("F16 PRE-06 il ramo opzioni.preparazione non fa piu' cadere la schermata",
  esitoRamoMorto.motivo === "errore_sql", JSON.stringify(esitoRamoMorto));
corretto("PRE-06", "il ramo opzioni.preparazione riporta l'errore invece di lasciarlo uscire da verifica()",
  esitoRamoMorto.motivo === "errore_sql" &&
    esitoRamoMorto.dettaglio.includes("preparazione") &&
    nomiTmp(cartellaSqlite).length === 0, JSON.stringify(esitoRamoMorto));

// VER-04, la conseguenza misurabile: un indice che cambia il PIANO cambia anche
// l'ORDINE del risultato di SQL-128, che ha LIMIT senza ORDER BY.
const SQL128 = esercizi.find((e) => e.id === "SQL-128");
const senzaIndice = await palestra.esegui(SQL128.soluzione);
const conIndice = await palestra.eseguiConPreparazione(
  "CREATE INDEX idx_ord ON pazienti(regione, codice, sesso);", SQL128.soluzione);
difetto("VER-04b", "SQL-128 (LIMIT senza ORDER BY): creato un indice di copertura il risultato cambia del tutto, e l'ordine e' dichiarato rilevante",
  JSON.stringify(senzaIndice.righe) !== JSON.stringify(conIndice.righe),
  JSON.stringify([senzaIndice.righe[0], conIndice.righe[0]]));

// ====================================== G. SCENARI IN UN PROCESSO A PARTE
// lib/palestra.ts memorizza la connessione e la versione in variabili di
// modulo: una volta aperta la palestra non si torna indietro. Gli scenari di
// avvio degradato hanno quindi bisogno di un processo fresco, e quello della
// query che non termina di un processo da uccidere.

function figlio(scenario, doppiAggiuntivi = {}) {
  const cartella = mkdtempSync(join(tmpdir(), `motore-sql-${scenario}-`));
  const esito = spawnSync(
    process.execPath,
    ["--import", "./test/banco/carica.mjs", "test/simulazione/motore-sql-figlio.mjs", scenario, cartella],
    {
      cwd: RADICE_PROGETTO,
      encoding: "utf8",
      timeout: 120000,
      env: { ...process.env, BANCO_DOPPI: variabileBanco(doppiAggiuntivi), MOTORE_SQL_IN_CORSO: "1" },
    }
  );
  const righe = String(esito.stdout || "").trim().split("\n").filter(Boolean);
  let riportato = null;
  try {
    riportato = JSON.parse(righe[righe.length - 1]);
  } catch {
    riportato = { errore: `uscita non interpretabile: ${esito.stdout} ${esito.stderr}` };
  }
  rmSync(cartella, { recursive: true, force: true });
  return riportato;
}

// AVV-01, limite: palestra.db presente ma a ZERO byte (copia interrotta).
const gVuota = figlio("palestra-vuota");
difetto("AVV-01", "palestra.db a zero byte: dest.exists e' vero, la copia non si ripete e l'apertura RIESCE su un database vuoto",
  gVuota.apertura === "riuscita" && String(gVuota.primaQuery).includes("no such table"),
  JSON.stringify(gVuota));
difetto("AVV-01b", "...e lo stato e' definitivo: nessuna ricopia, nessun PRAGMA integrity_check, il secondo tentativo fallisce uguale",
  String(gVuota.secondoTentativo).includes("no such table") && gVuota.fileRicopiato === false);

// AVV-02: copia troncata a meta' e file che non e' un database.
const gTroncata = figlio("palestra-troncata");
difetto("AVV-02", `palestra.db troncata: l'apertura fallisce e non esiste nessun percorso di ricopia ("${gTroncata.apertura}")`,
  String(gTroncata.apertura).includes("malformed"), JSON.stringify(gTroncata));
const gSpazzatura = figlio("palestra-spazzatura");
difetto("AVV-02b", `palestra.db sostituita da spazzatura: "${gSpazzatura.apertura}", e l'app non ha modo di ripartire`,
  String(gSpazzatura.apertura).includes("not a database"), JSON.stringify(gSpazzatura));

// PRE-02: la copia e l'apertura stanno FUORI dal try di eseguiConPreparazione.
const gOrfana = figlio("copia-orfana", {
  "expo-sqlite": join(QUESTA_CARTELLA, "motore-sql-doppio-instabile.mjs"),
});
difetto("PRE-02", `se openDatabaseAsync solleva, la copia temporanea resta sul disco: ${gOrfana.byteResidui} byte orfani`,
  Array.isArray(gOrfana.residui) && gOrfana.residui.length === 1 && gOrfana.byteResidui > 2000000,
  JSON.stringify(gOrfana));
difetto("PRE-02b", "...e nessuna pulizia all'avvio: la copia orfana sopravvive alla riapertura della palestra",
  Array.isArray(gOrfana.residuiDopoRiapertura) && gOrfana.residuiDopoRiapertura.length === 1);

// QRY-16: una query che non termina. Il processo figlio va ucciso dal padre:
// e' esattamente cio' che l'utente non puo' fare sul telefono.
const gInfinita = await new Promise((risolvi) => {
  const cartella = mkdtempSync(join(tmpdir(), "motore-sql-infinita-"));
  const processo = spawn(
    process.execPath,
    ["--import", "./test/banco/carica.mjs", "test/simulazione/motore-sql-figlio.mjs", "query-infinita", cartella],
    { cwd: RADICE_PROGETTO, env: { ...process.env, BANCO_DOPPI: variabileBanco(), MOTORE_SQL_IN_CORSO: "1" } }
  );
  let uscita = "";
  processo.stdout.on("data", (d) => (uscita += d));
  let ucciso = false;
  const orologio = setTimeout(() => {
    ucciso = true;
    processo.kill("SIGKILL");
  }, 4000);
  processo.on("close", (codice, segnale) => {
    clearTimeout(orologio);
    rmSync(cartella, { recursive: true, force: true });
    risolvi({ ucciso, codice, segnale, uscita: uscita.trim() });
  });
});
difetto("QRY-16", "una query che non termina blocca il motore per sempre: nessun limite di tempo, nessun annullamento (il processo e' stato ucciso dall'esterno dopo 4 s)",
  gInfinita.ucciso === true && gInfinita.segnale === "SIGKILL" &&
    gInfinita.uscita.includes("prima-della-query") && !gInfinita.uscita.includes("finita-da-sola"),
  JSON.stringify(gInfinita));

// ============================== H. SOLA LETTURA (invariante 4) — DISTRUTTIVI
// "palestra.db è in sola lettura": lo dice CLAUDE.md, lo dice il commento in
// testa a lib/palestra.ts. Qui si verifica se lo dice anche il codice.
//
// Questi scenari ROVINANO la copia di palestra.db della cartella temporanea:
// stanno apposta in fondo, dopo tutti gli altri. La cartella e' usa-e-getta e
// l'asset del repository non viene mai toccato.
//
// Ogni scrittura passa da tenta(): se un domani la palestra venisse aperta
// davvero in sola lettura, qui si legge un rifiuto e le verifiche diventano
// rosse in modo leggibile, invece di far cadere la prova con un'eccezione.
//
// Questo commento descriveva il codice PRIMA della correzione — diceva che la
// via di esecuzione non contiene nessuna protezione — mentre due righe sotto la
// prova pretende ormai il contrario. Un commento rimasto indietro e' peggio di
// nessun commento: chi legge si fa l'idea sbagliata di cosa sia sorvegliato.
//
// Stato vero: apriPalestra() impone PRAGMA query_only = ON sulla connessione, e
// il doppio del banco lo rispetta perche' node:sqlite implementa quella pragma
// per davvero. Quindi qui non si misura piu' l'assenza di una protezione: si
// misura che la protezione c'e' e che regge a ogni forma di scrittura.

// RO-01a guardava il TESTO di lib/palestra.ts con una regex, non il
// comportamento della connessione. Due lenti del revisore l'hanno smontata
// separatamente, e la seconda ha aggiunto il colpo di grazia: quella stringa
// compare DUE volte nel file — in apriPalestra() e in eseguiConPreparazione() —
// quindi togliendo la prima la guardia sarebbe rimasta verde mentre la palestra
// tornava scrivibile. Ora si chiede alla connessione, che e' l'unico testimone
// che conta.
const statoQueryOnly = await palestra.esegui("PRAGMA query_only");
corretto("RO-01a", "la connessione della palestra dichiara query_only attivo",
  Number(statoQueryOnly.righe[0][0]) === 1, JSON.stringify(statoQueryOnly.righe));

const md5Prima = md5Di(fileCopiato);
const visitePrima = (await palestra.esegui("SELECT count(*) AS n FROM visite")).righe[0][0];
const rifPrima = await palestra.esegui(
  "SELECT esito, count(*) AS n FROM visite GROUP BY esito ORDER BY esito");

// QRY-19 di nuovo, ma con la coda DISTRUTTIVA: deve restare scartata.
await tenta(() => palestra.esegui("SELECT 1 AS a; DELETE FROM visite"));
const visiteDopoCoda = (await palestra.esegui("SELECT count(*) AS n FROM visite")).righe[0][0];
ok("H1 QRY-19b la seconda istruzione di 'SELECT 1; DELETE FROM visite' non viene eseguita",
  visiteDopoCoda === visitePrima, `${visitePrima} -> ${visiteDopoCoda}`);

// RO-01: una query di SCRITTURA nel campo risposta.
const hUpdate = await tenta(() => palestra.esegui("UPDATE strutture SET nome = 'RUBATA' WHERE id = 1"));
const nomeDopo = (await palestra.esegui("SELECT nome FROM strutture WHERE id = 1")).righe[0][0];
corretto("RO-01", "un UPDATE scritto nel campo risposta viene RESPINTO da SQLite",
  hUpdate.riuscito === false && nomeDopo !== "RUBATA" &&
    String(hUpdate.errore).includes("readonly"), JSON.stringify({ hUpdate, nomeDopo }));

const hDelete = await tenta(() => palestra.esegui("DELETE FROM visite WHERE id <= 100"));
const visiteDopo = (await palestra.esegui("SELECT count(*) AS n FROM visite")).righe[0][0];
corretto("RO-01b", `un DELETE viene respinto: le visite restano ${visitePrima}`,
  hDelete.riuscito === false && visiteDopo === visitePrima, JSON.stringify(hDelete));

// Il danno e' sul FILE, non nella testa del processo.
corretto("RO-01c", "il file palestra.db sul disco e' identico byte per byte",
  md5Di(fileCopiato) === md5Prima);
const altraConnessione = openDatabaseSync("palestra.db", { useNewConnection: true }, cartellaSqlite);
const visteDaFuori = await altraConnessione.getFirstAsync("SELECT count(*) AS n FROM visite");
corretto("RO-01d", "una seconda connessione allo stesso file vede la palestra intatta",
  Number(visteDaFuori.n) === visitePrima);
await altraConnessione.closeAsync();

// La conseguenza per gli esercizi: le soluzioni di riferimento cambiano risultato.
const rifDopo = await palestra.esegui(
  "SELECT esito, count(*) AS n FROM visite GROUP BY esito ORDER BY esito");
corretto("RO-01e", "le soluzioni di riferimento danno lo stesso risultato di prima: gli esercizi successivi restano coerenti",
  JSON.stringify(rifPrima.righe) === JSON.stringify(rifDopo.righe));

// RO-02: DDL nel campo risposta.
const hCreate = await tenta(() => palestra.esegui("CREATE TABLE zzz_intrusa (x INTEGER)"));
const intrusa = await palestra.esegui(
  "SELECT count(*) AS n FROM sqlite_master WHERE name = 'zzz_intrusa'");
corretto("RO-02", "CREATE TABLE scritto nel campo risposta viene respinto",
  hCreate.riuscito === false && intrusa.righe[0][0] === 0, JSON.stringify(hCreate));

const hDrop = await tenta(() => palestra.esegui("DROP TABLE valutazioni"));
const rimasta = await palestra.esegui(
  "SELECT count(*) AS n FROM sqlite_master WHERE name = 'valutazioni'");
corretto("RO-02b", "DROP TABLE viene respinto: lo schema della palestra non e' modificabile dall'utente",
  hDrop.riuscito === false && rimasta.righe[0][0] === 1, JSON.stringify(hDrop));

const esitoDopoDrop = await V.verifica(palestra.esegui,
  "SELECT count(*) AS n FROM valutazioni", "SELECT count(*) AS n FROM valutazioni");
corretto("RO-02c", "la tabella e' ancora li': l'esercizio su di essa funziona invece di accusare il contenuto",
  esitoDopoDrop.motivo !== "errore_sql", JSON.stringify(esitoDopoDrop));

// RO-03: ATTACH di un altro database dalla risposta.
const altroFile = join(cartellaSqlite, "segreti.db");
const altro = openDatabaseSync("segreti.db", { useNewConnection: true }, cartellaSqlite);
await altro.execAsync("CREATE TABLE segreti (chiave TEXT); INSERT INTO segreti VALUES ('passphrase');");
await altro.closeAsync();
const hAttach = await tenta(() => palestra.esegui(`ATTACH DATABASE '${altroFile}' AS altro`));
const letturaAltrui = await tenta(() => palestra.esegui("SELECT chiave FROM altro.segreti"));
difetto("RO-03", "ATTACH DATABASE dalla risposta riesce: la connessione della palestra raggiunge altri database",
  hAttach.riuscito === true && letturaAltrui.riuscito === true &&
    letturaAltrui.valore.righe[0][0] === "passphrase",
  JSON.stringify({ hAttach, letturaAltrui }));
const hScritturaAltrui = await tenta(() =>
  palestra.esegui("INSERT INTO altro.segreti VALUES ('aggiunta dalla palestra')"));
const contaAltrui = await tenta(() => palestra.esegui("SELECT count(*) AS n FROM altro.segreti"));
corretto("RO-03b", "...ma NON ci si puo' scrivere: query_only vale su ogni database della connessione, anche attaccato",
  hScritturaAltrui.riuscito === false && contaAltrui.valore.righe[0][0] === 1,
  JSON.stringify(hScritturaAltrui));
const elencoAttaccati = await palestra.esegui("PRAGMA database_list");
difetto("RO-03c", "l'ATTACH resta attivo sulla connessione memorizzata, per tutte le verifiche successive",
  elencoAttaccati.righe.some((r) => r[1] === "altro"), JSON.stringify(elencoAttaccati.righe));

// RO-04: PRAGMA che cambiano stato.
const hPragma = await tenta(() => palestra.esegui("PRAGMA user_version = 99"));
const versioneUtente = await palestra.esegui("PRAGMA user_version");
corretto("RO-04", "un PRAGMA di scrittura (user_version = 99) viene respinto",
  hPragma.riuscito === false && versioneUtente.righe[0][0] !== 99,
  JSON.stringify({ hPragma, righe: versioneUtente.righe }));
const controlloFile = openDatabaseSync("palestra.db", { useNewConnection: true }, cartellaSqlite);
const versioneSulFile = await controlloFile.getFirstAsync("PRAGMA user_version");
corretto("RO-04b", "...e il FILE non ne porta traccia",
  Number(versioneSulFile.user_version) !== 99);
await controlloFile.closeAsync();

// ==================================================================== ESITO
console.log(`\nsimulazione: motore-sql — lib/palestra.ts + lib/verifica.ts, SQLite ${palestra.versioneMotore()}`);
console.log(`radice di prova: ${radice}`);
if (correzioniSorvegliate.length) {
  console.log(`\ncorrezioni sorvegliate (erano difetti, ora sono guardie): ${correzioniSorvegliate.length}`);
  for (const c of correzioniSorvegliate) console.log(`  - ${c}`);
}
if (difettiInchiodati.length) {
  console.log(
    `\nDIFETTI DELL'APP INCHIODATI da questa prova (${difettiInchiodati.length} scenari). Sono VERDI perche' il`
  );
  console.log(
    "difetto e' ancora li': ciascuno RIPRODUCE il difetto, non lo corregge. Se uno diventa"
  );
  console.log("rosso vuol dire che l'app e' cambiata, ed e' questa prova a dover essere aggiornata.");
  for (const d of difettiInchiodati) console.log(`  DIFETTO ${d}`);
}
for (const f of falliti) console.log(`  FALLITO: ${f}`);
const totale = passati + falliti.length;
console.log(
  `\npassati ${passati} su ${totale}` +
    (difettiInchiodati.length
      ? ` — ATTENZIONE: ${difettiInchiodati.length} dei ${totale} scenari inchiodano un DIFETTO dell'app (elenco qui sopra).`
      : "")
);
if (falliti.length) {
  console.log(`la radice di prova NON viene cancellata: ${radice}`);
  process.exit(1);
}
rmSync(radice, { recursive: true, force: true });
// Uscita esplicita, e non la fine naturale del processo: vedi "INSTABILITA'
// DEL BANCO" nell'intestazione. Il verdetto di questa prova deve essere il
// suo, non quello della chiusura di node:sqlite.
process.exit(0);
