/**
 * Controprova avversariale, lente CONSEGUENZA, del difetto
 * «DDL nel campo risposta: CREATE TABLE e DROP TABLE vengono eseguiti sulla
 * palestra» (accusa a lib/palestra.ts:58 esegui(), invariante 4).
 *
 * La domanda di questa lente non e' "il meccanismo esiste?" ma "l'utente in
 * aereo, sul suo telefono o sul tablet, ci finisce dentro, e cosa PERDE?".
 * Per rispondere non basta chiamare esegui() a mano: si ricalca il giro vero
 * della schermata — coda degli esercizi letta dal database come in
 * app/esercizi.tsx:31-38, scelta dell'esecutore come alla riga 49, verifica(),
 * e registrazione del tentativo con registra() — sul codice VERO di lib/, con
 * i contenuti VERI di assets/contenuti/.
 *
 * L'accusa e' composta da tre affermazioni e da una via d'accesso, e qui si
 * prova a farle avverare UNA PER UNA:
 *   A. «zzz_intrusa compare»          -> sezione 2
 *   B. «valutazioni sparisce»         -> sezione 2
 *   C. «da li' in poi verifica() risponde "La soluzione di riferimento non e'
 *       eseguibile su questo dispositivo", accusando il contenuto» -> sezione 4
 *   D. via d'accesso: «la schermata MOSTRA la preparazione, quindi l'utente
 *       riprova un CREATE INDEX su uno degli altri 143» -> sezione 3, ed e'
 *       la via piu' credibile di tutte, perche' la consegna di SQL-088 dice
 *       alla lettera "Crea un indice su visite(operatore)".
 *
 * Il verdetto non si legge nella testa del doppio: si legge sul DISCO, con una
 * seconda connessione node:sqlite in sola lettura sul file .db e con l'md5 del
 * file, che e' cio' che resta sul telefono dopo la chiusura dell'app.
 *
 * Le sezioni 6 e 7 sono le FALSIFICAZIONI: servono a dimostrare che il verde
 * qui sopra non e' un banco cieco. La 6 rifa' lo stesso DDL su una connessione
 * senza `PRAGMA query_only` e lo vede riuscire; la 7 mostra l'UNICA via che ho
 * trovato per far cadere la protezione, che pero' non e' quella dell'accusa.
 *
 *   node test/simulazione/controprova-4-conseguenza.mjs
 *
 * (il file si riavvia da solo con --import ./test/banco/carica.mjs e con
 * BANCO_DOPPI gia' composta: stessa ricetta di controprova-4-correttezza.mjs)
 */
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFileSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { DatabaseSync } from "node:sqlite";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { variabileBanco } from "../banco/doppi-altri.mjs";

const QUESTA_CARTELLA = dirname(fileURLToPath(import.meta.url));
const RADICE_PROGETTO = resolve(QUESTA_CARTELLA, "..", "..");

// --------------------------------------------------------- RIAVVIO CON I GANCI
if (!process.env.CONTROPROVA_4_CONS_IN_CORSO) {
  const esito = spawnSync(
    process.execPath,
    ["--import", "./test/banco/carica.mjs", "test/simulazione/controprova-4-conseguenza.mjs"],
    {
      cwd: RADICE_PROGETTO,
      stdio: "inherit",
      env: { ...process.env, CONTROPROVA_4_CONS_IN_CORSO: "1", BANCO_DOPPI: variabileBanco() },
    }
  );
  process.exit(esito.status ?? 1);
}

let passati = 0;
const falliti = [];
const ok = (nome, condizione, extra = "") =>
  condizione ? passati++ : falliti.push(`${nome}${extra ? " — " + extra : ""}`);

/** L'accusa dev'essere misurata, non subita: l'errore diventa un dato. */
async function tenta(azione) {
  try {
    return { riuscito: true, valore: await azione() };
  } catch (errore) {
    return { riuscito: false, errore: String(errore?.message ?? errore) };
  }
}

const md5Di = (percorso) => createHash("md5").update(readFileSync(percorso)).digest("hex");

// ------------------------------------------------------------- PREPARAZIONE
import * as FS from "../banco/expo-file-system.mjs";
import { configuraCartella } from "../banco/expo-sqlite.mjs";
import { installaRequireMetro } from "../banco/require-metro.mjs";

const radice = FS.configuraRadice(mkdtempSync(join(tmpdir(), "controprova-4-cons-")));
const cartellaSqlite = configuraCartella(join(FS.percorsoDocumenti(), "SQLite"));
installaRequireMetro(RADICE_PROGETTO);
rmSync(cartellaSqlite, { recursive: true, force: true }); // primo avvio assoluto

const db = await import("../../lib/db.ts");
const palestra = await import("../../lib/palestra.ts");
const contenuti = await import("../../lib/contenuti.ts");
const V = await import("../../lib/verifica.ts");

// app/_layout.tsx:20-27 nell'ordine vero: identificativo, apri(), contenuti,
// apriPalestra(), e solo DOPO le schermate si montano. E' l'unico stato in cui
// l'utente puo' battere qualcosa nel campo risposta.
await db.apri("telefono-in-aereo");
await contenuti.caricaContenuti();
await palestra.apriPalestra();

const fileDb = join(cartellaSqlite, "palestra.db");
const md5Iniziale = md5Di(fileDb);

/** Sguardo da fuori: una connessione indipendente, in sola lettura, sul file. */
const daDisco = (sql, par = []) => {
  const q = new DatabaseSync(fileDb, { readOnly: true });
  try { return q.prepare(sql).all(...par); } finally { q.close(); }
};
const schemaDisco = () =>
  JSON.stringify(daDisco("SELECT type, name FROM sqlite_master ORDER BY type, name"));
const schemaIniziale = schemaDisco();
const valutazioniIniziali = daDisco("SELECT count(*) AS n FROM valutazioni")[0].n;

/** I 150 esercizi come li legge la schermata: dal database, non dal JSON. */
const base = db.database();
const esercizioDb = async (id) =>
  base.getFirstAsync("SELECT * FROM esercizi WHERE id = ?", [id]);

/**
 * controlla() di app/esercizi.tsx:45-71 ricopiata: il banco non carica i .tsx
 * (niente react-native, niente expo-router), ma le righe che contano sono
 * queste tre — la scelta dell'esecutore, verifica(), e il tentativo che finisce
 * nel registro eventi. Restituisce cio' che l'utente VEDE.
 */
async function controlla(esercizio, risposta) {
  const esecutore = esercizio.preparazione
    ? (sql) => palestra.eseguiConPreparazione(esercizio.preparazione, sql)
    : palestra.esegui;
  const esito = await V.verifica(esecutore, risposta, esercizio.soluzione_riferimento, {
    ordineRilevante: esercizio.ordine_rilevante === 1,
  });
  const id = `tentativo-${esercizio.id}-${Math.random().toString(16).slice(2)}`;
  await db.registra("tentativi", id, "crea",
    { esercizio_id: esercizio.id, esito: esito.corretto ? "corretto" : "errato" },
    async (d, hlc) => {
      await d.runAsync(
        `INSERT INTO tentativi (id, esercizio_id, risposta, esito, motivo, durata_sec, eseguito_a, hlc)
         VALUES (?,?,?,?,?,?,?,?)`,
        [id, esercizio.id, risposta, esito.corretto ? "corretto" : "errato",
         esito.motivo, 12, new Date().toISOString(), hlc]);
    });
  return esito;
}

const SQL001 = await esercizioDb("SQL-001"); // senza preparazione -> palestra vera
const SQL014 = await esercizioDb("SQL-014"); // senza preparazione, gira su valutazioni
const SQL088 = await esercizioDb("SQL-088"); // con preparazione -> copia usa-e-getta

// ===========================================================================
// 1. LA SCHERMATA E' DAVVERO RAGGIUNGIBILE, E LA PALESTRA DAVVERO SCRIVIBILE
//    DAL PUNTO DI VISTA DEL FILE. Senza questa sezione il verde che segue
//    potrebbe essere "non e' successo niente perche' non gira niente".
// ===========================================================================
ok("1a la coda degli esercizi che la schermata legge non e' vuota",
  (await base.getAllAsync(
    `SELECT e.id FROM esercizi e WHERE e.tipo = 'sql_eseguibile' AND e.dataset = 'palestra.db'`
  )).length === 150);
ok("1b SQL-088 mostra a schermo una preparazione, ed e' un CREATE INDEX",
  /^CREATE INDEX/i.test(SQL088.preparazione ?? ""), String(SQL088.preparazione));
ok("1c la consegna di SQL-088 dice all'utente di creare l'indice: la via d'accesso dell'accusa e' credibile",
  /crea un indice/i.test(SQL088.consegna), SQL088.consegna);
ok("1d il file palestra.db esiste sul disco dell'app ed e' scrivibile a livello di filesystem",
  md5Iniziale.length === 32 && !daDisco("PRAGMA database_list").some((r) => r.name === "mancante"));
{
  const buono = await controlla(SQL001, SQL001.soluzione_riferimento);
  ok("1e il giro completo funziona: la soluzione vera di SQL-001 passa",
    buono.corretto === true && buono.motivo === "identico", JSON.stringify(buono));
}

// ===========================================================================
// 2. L'ACCUSA ALLA LETTERA, PASSANDO DAL CAMPO RISPOSTA DELLA SCHERMATA.
// ===========================================================================
{
  const e = await controlla(SQL001, "CREATE TABLE zzz_intrusa (x INTEGER)");
  ok("2a A. CREATE TABLE battuto nel campo risposta NON crea niente: l'esito e' errore_sql",
    e.corretto === false && e.motivo === "errore_sql", JSON.stringify(e));
  ok("2b ...e SQLite lo respinge per la sola lettura della connessione",
    /readonly/i.test(String(e.errore)), String(e.errore));
  ok("2c zzz_intrusa NON compare in sqlite_master letto da fuori",
    daDisco("SELECT count(*) AS n FROM sqlite_master WHERE name = 'zzz_intrusa'")[0].n === 0);
}
{
  const e = await controlla(SQL014, "DROP TABLE valutazioni");
  ok("2d B. DROP TABLE battuto nel campo risposta NON cancella niente",
    e.corretto === false && e.motivo === "errore_sql" && /readonly/i.test(String(e.errore)),
    JSON.stringify(e));
  ok("2e valutazioni e' ancora sul disco, con le stesse righe di prima",
    daDisco("SELECT count(*) AS n FROM valutazioni")[0].n === valutazioniIniziali);
}
{
  // L'intera classe delle scritture, non solo il DDL: e' la stessa porta.
  for (const [nome, sql] of [
    ["DELETE", "DELETE FROM valutazioni"],
    ["UPDATE", "UPDATE pazienti SET sesso = 'X'"],
    ["INSERT", "INSERT INTO strutture (id, nome) VALUES (999, 'finta')"],
    ["ALTER", "ALTER TABLE visite ADD COLUMN zzz TEXT"],
    ["DROP INDEX", "DROP INDEX idx_visite_data"],
    ["VACUUM", "VACUUM"],
  ]) {
    const r = await tenta(() => palestra.esegui(sql));
    ok(`2f ${nome} respinto`, r.riuscito === false && /readonly/i.test(String(r.errore)),
      JSON.stringify(r));
  }
}
ok("2g lo schema sul disco e' bit per bit quello di partenza",
  schemaDisco() === schemaIniziale);
ok("2h il FILE non e' stato toccato: stesso md5 dopo tutti i tentativi",
  md5Di(fileDb) === md5Iniziale);

// ===========================================================================
// 3. D. LA VIA D'ACCESSO CHE L'ACCUSA INDICA, PRESA SUL SERIO:
//    l'utente ricopia nel campo risposta la preparazione che la schermata gli
//    MOSTRA (app/esercizi.tsx:100-105) e la batte su un esercizio dei 143 che
//    non ne hanno una — cioe' contro la palestra vera e permanente.
// ===========================================================================
{
  const preparazioniMostrate = await base.getAllAsync(
    "SELECT id, preparazione FROM esercizi WHERE preparazione IS NOT NULL ORDER BY id");
  ok("3a le preparazioni mostrate a schermo sono 7, come dice l'accusa",
    preparazioniMostrate.length === 7, String(preparazioniMostrate.length));
  for (const p of preparazioniMostrate) {
    const e = await controlla(SQL001, p.preparazione);
    ok(`3b la preparazione di ${p.id} ricopiata nella palestra vera viene respinta`,
      e.corretto === false && e.motivo === "errore_sql" && /readonly/i.test(String(e.errore)),
      JSON.stringify(e));
  }
  ok("3c nessuno dei 7 oggetti e' comparso sul disco",
    daDisco(`SELECT count(*) AS n FROM sqlite_master
             WHERE name IN ('idx_visite_operatore','idx_visite_str_data','idx_visite_data_str',
                            'idx_cop','idx_decessi','idx_anno','agg_struttura_mese')`)[0].n === 0);
  ok("3d e il file e' ancora quello di partenza", md5Di(fileDb) === md5Iniziale);
}

// ===========================================================================
// 4. C. LA CONSEGUENZA DICHIARATA — «da li' in poi verifica() accusa il
//    contenuto» — NON ARRIVA. E' la parte che riguarda davvero l'utente in
//    aereo: dopo i tentativi di sopra, l'app deve restare un'app che funziona.
// ===========================================================================
{
  const dopo = await controlla(SQL014, SQL014.soluzione_riferimento);
  ok("4a l'esercizio sulla tabella che l'accusa dava per cancellata si risolve ancora",
    dopo.corretto === true, JSON.stringify(dopo));
  ok("4b il messaggio che l'accusa promette non compare mai",
    dopo.dettaglio !== "La soluzione di riferimento non è eseguibile su questo dispositivo.",
    dopo.dettaglio);
  const sbagliata = await controlla(SQL014, "SELECT count(*) AS n FROM pazienti");
  ok("4c e una risposta semplicemente sbagliata resta 'sbagliata', non 'contenuto rotto'",
    sbagliata.corretto === false && sbagliata.motivo !== "errore_sql", JSON.stringify(sbagliata));
  const tentativi = await base.getAllAsync(
    "SELECT esito, motivo FROM tentativi ORDER BY eseguito_a");
  ok("4d cio' che l'utente vede: il tentativo con il DDL e' archiviato come 'errato', non perde il turno",
    tentativi.some((t) => t.esito === "errato" && t.motivo === "errore_sql"));
  ok("4e ogni tentativo ha il suo evento: il registro non si e' rotto per strada",
    (await base.getFirstAsync("SELECT count(*) AS n FROM eventi WHERE entita = 'tentativi'")).n
      === tentativi.length);
}

// ===========================================================================
// 5. L'ALTRA META' DELLA SCHERMATA: i 7 esercizi CON preparazione passano da
//    eseguiConPreparazione(), che lavora su una copia usa-e-getta. Qui l'utente
//    ha un motivo vero per battere un CREATE INDEX: glielo chiede la consegna.
// ===========================================================================
{
  const giusto = await controlla(SQL088, SQL088.soluzione_riferimento);
  ok("5a l'esercizio con preparazione si risolve: la copia temporanea riceve l'indice",
    giusto.corretto === true, JSON.stringify(giusto));
  const e = await controlla(SQL088, SQL088.preparazione);
  ok("5b l'utente che ubbidisce alla consegna e ricopia il CREATE INDEX viene respinto anche sulla copia",
    e.corretto === false && e.motivo === "errore_sql", JSON.stringify(e));
  // Qui SQLite si ferma prima ancora di arrivare alla sola lettura, perche'
  // l'indice esiste gia': l'ha creato la preparazione. Serve quindi un nome
  // NUOVO per misurare davvero query_only sulla copia usa-e-getta.
  const nuovoIndice = await controlla(SQL088, "CREATE INDEX idx_mio ON visite(esito)");
  ok("5b-bis un CREATE INDEX con un nome mai visto, sulla copia, cade sulla sola lettura",
    nuovoIndice.corretto === false && nuovoIndice.motivo === "errore_sql"
      && /readonly/i.test(String(nuovoIndice.errore)), JSON.stringify(nuovoIndice));
  ok("5c la palestra permanente non si accorge di niente",
    md5Di(fileDb) === md5Iniziale && schemaDisco() === schemaIniziale);
  ok("5d nessuna copia palestra_tmp_*.db rimasta a occupare la memoria del telefono",
    readdirSync(cartellaSqlite).filter((f) => f.startsWith("palestra_tmp_")).length === 0,
    JSON.stringify(readdirSync(cartellaSqlite)));
}

// ===========================================================================
// 6. FALSIFICAZIONE A — il banco SA creare e cancellare tabelle in questo file.
//    Stesso DDL, stesso file, ma su una connessione senza `PRAGMA query_only`:
//    se questa sezione fosse verde al contrario, tutto il resto non varrebbe
//    niente. Si lavora su una COPIA, per non sporcare le sezioni precedenti.
// ===========================================================================
{
  const copia = join(cartellaSqlite, "falsificazione.db");
  rmSync(copia, { force: true });
  copyFileSync(fileDb, copia);
  const scrivibile = new DatabaseSync(copia);
  // Le chiavi esterne si spengono per pareggiare la connessione dell'app: senza,
  // qui il DROP cadrebbe su "FOREIGN KEY constraint failed" (misurazioni punta a
  // valutazioni) e la falsificazione misurerebbe la cosa sbagliata.
  scrivibile.exec("PRAGMA foreign_keys = OFF");
  ok("6-pre la copia di lavoro contiene davvero la palestra",
    Number(scrivibile.prepare("SELECT count(*) AS n FROM valutazioni").get().n) === valutazioniIniziali);
  const fattoCreate = await tenta(async () => scrivibile.prepare("CREATE TABLE zzz_intrusa (x INTEGER)").all());
  const fattoDrop = await tenta(async () => scrivibile.prepare("DROP TABLE valutazioni").all());
  const vede = scrivibile.prepare(
    "SELECT count(*) AS n FROM sqlite_master WHERE name IN ('zzz_intrusa','valutazioni')").get();
  scrivibile.close();
  ok("6a SENZA query_only lo stesso CREATE TABLE riesce", fattoCreate.riuscito === true,
    JSON.stringify(fattoCreate));
  ok("6b SENZA query_only lo stesso DROP TABLE riesce", fattoDrop.riuscito === true,
    JSON.stringify(fattoDrop));
  ok("6c ...e si vede: zzz_intrusa c'e', valutazioni non c'e' piu'", Number(vede.n) === 1,
    JSON.stringify(vede));
  rmSync(copia, { force: true });
}

// ===========================================================================
// 7. FALSIFICAZIONE B — L'UNICA VIA CHE FA CADERE LA PROTEZIONE, e non e'
//    quella dell'accusa: `PRAGMA query_only = OFF` battuto nel campo risposta.
//    Non e' un DDL, quindi query_only non lo ferma, e da li' in poi la
//    connessione torna scrivibile. Serve un invio a parte (getAllAsync prepara
//    UNA istruzione sola: "PRAGMA ...; DROP ..." nello stesso campo non passa).
//    Va in fondo perche' rompe davvero il file: tutte le misure sopra sono gia'
//    state prese. Segnalazione al coordinatore, non correzione.
// ===========================================================================
{
  const insieme = await tenta(() =>
    palestra.esegui("PRAGMA query_only = OFF; DROP TABLE valutazioni"));
  ok("7a un invio solo NON esegue i due colpi: getAllAsync compila la PRIMA istruzione e ignora il resto",
    insieme.riuscito === true && insieme.valore.righe.length === 0, JSON.stringify(insieme));
  ok("7b infatti valutazioni e' ancora li' dopo quell'invio",
    daDisco("SELECT count(*) AS n FROM valutazioni")[0].n === valutazioniIniziali);
  const statoPragma = await tenta(() => palestra.esegui("PRAGMA query_only"));
  ok("7c ...ma la meta' eseguita era il PRAGMA, e la connessione ora e' tornata scrivibile",
    Number(statoPragma.valore?.righe?.[0]?.[0]) === 0, JSON.stringify(statoPragma));

  const drop = await tenta(() => palestra.esegui("DROP TABLE valutazioni"));
  console.log("    7 (diagnostica) PRAGMA rimasto:", JSON.stringify(statoPragma.valore),
    "\n    7 (diagnostica) DROP al secondo invio:", JSON.stringify(drop));
  ok("7c-bis il DROP al SECONDO invio riesce: difetto DIVERSO da quello in esame (il pragma, non il DDL)",
    drop.riuscito === true,
    "se questa riga e' rossa la protezione e' ancora piu' forte di quanto scritto nel rapporto");
  ok("7d ...e il danno e' permanente sul disco, quindi la misura di sopra sapeva vedere il danno",
    daDisco("SELECT count(*) AS n FROM sqlite_master WHERE name = 'valutazioni'")[0].n === 0);
  ok("7e ed e' cosi' che si sarebbe presentata la conseguenza C dell'accusa",
    (await V.verifica(palestra.esegui, "SELECT 1", SQL014.soluzione_riferimento)).dettaglio
      === "La soluzione di riferimento non è eseguibile su questo dispositivo.");
}

console.log(`\ncontroprova 4 — lente conseguenza, SQLite ${palestra.versioneMotore()}`);
console.log(`\npassati ${passati} su ${passati + falliti.length}`);
for (const f of falliti) console.log("  ROSSO:", f);
if (!falliti.length) rmSync(radice, { recursive: true, force: true });
else console.log("cartella conservata:", radice);
process.exit(falliti.length ? 1 : 0);
