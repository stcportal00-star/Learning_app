/**
 * Scenari della superficie motore-sql che NON si possono provare nel processo
 * principale, perche' hanno bisogno dello stato del modulo lib/palestra.ts
 * FRESCO (la connessione e la versione sono variabili di modulo, memorizzate
 * per sempre alla prima apertura) oppure perche' il processo non finisce piu'.
 *
 * Non si esegue a mano: lo lancia test/simulazione/motore-sql.mjs, che legge
 * la riga JSON stampata alla fine.
 *
 *   node --import ./test/banco/carica.mjs test/simulazione/motore-sql-figlio.mjs <scenario> <radice>
 */
import { mkdirSync, writeFileSync, copyFileSync, readdirSync, truncateSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import * as FS from "../banco/expo-file-system.mjs";
import { configuraCartella } from "../banco/expo-sqlite.mjs";
import { installaRequireMetro } from "../banco/require-metro.mjs";

const QUESTA_CARTELLA = dirname(fileURLToPath(import.meta.url));
const RADICE_PROGETTO = resolve(QUESTA_CARTELLA, "..", "..");
const ASSET_PALESTRA = join(RADICE_PROGETTO, "assets/contenuti/palestra.db");

const [scenario, radiceRichiesta] = process.argv.slice(2);
const radice = FS.configuraRadice(radiceRichiesta);
const cartellaSqlite = configuraCartella(join(FS.percorsoDocumenti(), "SQLite"));
installaRequireMetro(RADICE_PROGETTO);

const esito = { scenario, radice };
const messaggio = (e) => String(e?.message ?? e);

async function conPalestraPreparata(prepara) {
  mkdirSync(cartellaSqlite, { recursive: true });
  prepara(join(cartellaSqlite, "palestra.db"));
  const palestra = await import("../../lib/palestra.ts");
  try {
    await palestra.apriPalestra();
    esito.apertura = "riuscita";
  } catch (e) {
    esito.apertura = messaggio(e);
    return palestra;
  }
  try {
    const r = await palestra.esegui("SELECT count(*) AS n FROM visite");
    esito.primaQuery = `riuscita: ${r.righe[0][0]} righe`;
  } catch (e) {
    esito.primaQuery = messaggio(e);
  }
  // Una seconda chiamata deve dire se lo stato e' definitivo o se l'app
  // riesce a riprendersi da sola (ricopia, PRAGMA integrity_check, ...).
  try {
    await palestra.apriPalestra();
    const r = await palestra.esegui("SELECT count(*) AS n FROM visite");
    esito.secondoTentativo = `riuscito: ${r.righe[0][0]} righe`;
  } catch (e) {
    esito.secondoTentativo = messaggio(e);
  }
  esito.fileRicopiato =
    readdirSync(cartellaSqlite).includes("palestra.db") &&
    esito.primaQuery?.startsWith("riuscita");
  return palestra;
}

if (scenario === "palestra-vuota") {
  // AVV-01, limite: la cartella c'e' e palestra.db c'e' ma e' a zero byte
  // (copia interrotta da un kill di Android). dest.exists e' vero: non si
  // ricopia piu'.
  await conPalestraPreparata((percorso) => writeFileSync(percorso, ""));
} else if (scenario === "palestra-troncata") {
  // AVV-02: copia interrotta a meta'. L'intestazione c'e', il resto no.
  await conPalestraPreparata((percorso) => {
    copyFileSync(ASSET_PALESTRA, percorso);
    truncateSync(percorso, 100000);
  });
} else if (scenario === "palestra-spazzatura") {
  // AVV-02b: non e' proprio un database.
  await conPalestraPreparata((percorso) =>
    writeFileSync(percorso, Buffer.alloc(4096, 0x41)));
} else if (scenario === "palestra-altro-database") {
  // AVV-03: un database SQLite VALIDO che pero' non e' la palestra. E' il caso
  // che distingue una verifica vera ("ci sono i dati degli esercizi") da una
  // che si accontenta ("il file si apre"): qui si apre benissimo, e non serve
  // a niente. Senza questo scenario, controllare `visite` o `sqlite_master`
  // sarebbe la stessa cosa, e la guardia non saprebbe dirlo.
  await conPalestraPreparata((percorso) => {
    const d = new DatabaseSync(percorso);
    d.exec("CREATE TABLE appunti (id INTEGER PRIMARY KEY, testo TEXT)");
    d.exec("INSERT INTO appunti (testo) VALUES ('non sono la palestra')");
    d.close();
  });
} else if (scenario === "copia-orfana") {
  // PRE-02: la copia e l'apertura stanno fuori dal try. Se l'apertura
  // fallisce, la copia temporanea resta sul disco per sempre.
  const palestra = await import("../../lib/palestra.ts");
  await palestra.apriPalestra();
  process.env.MOTORE_SQL_APERTURA_ROTTA = "palestra_tmp_";
  try {
    await palestra.eseguiConPreparazione("CREATE INDEX idx_x ON visite(esito);", "SELECT 1");
    esito.esecuzione = "riuscita (l'apertura non e' fallita)";
  } catch (e) {
    esito.esecuzione = messaggio(e);
  }
  esito.residui = readdirSync(cartellaSqlite).filter((n) => n.startsWith("palestra_tmp_"));
  esito.byteResidui = esito.residui.reduce(
    (t, n) => t + new FS.File(cartellaSqlite, n).size, 0);
  // Nessuna pulizia all'avvio: una nuova apertura non tocca gli orfani.
  await palestra.apriPalestra();
  esito.residuiDopoRiapertura = readdirSync(cartellaSqlite).filter((n) => n.startsWith("palestra_tmp_"));
} else if (scenario === "query-infinita") {
  // QRY-16: nessun limite di tempo, nessun annullamento. Questo processo non
  // finisce: e' il genitore a ucciderlo, ed e' quella la dimostrazione.
  const palestra = await import("../../lib/palestra.ts");
  await palestra.apriPalestra();
  console.log(JSON.stringify({ scenario, stato: "prima-della-query" }));
  await palestra.esegui(
    "WITH RECURSIVE r(n) AS (SELECT 1 UNION ALL SELECT n + 1 FROM r) SELECT n FROM r WHERE n < 0");
  console.log(JSON.stringify({ scenario, stato: "la-query-e-finita-da-sola" }));
} else {
  esito.errore = `scenario sconosciuto: ${scenario}`;
}

console.log(JSON.stringify(esito));
