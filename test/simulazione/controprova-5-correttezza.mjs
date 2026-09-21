/**
 * Controprova avversariale del difetto "colonne omonime in un JOIN"
 * (accusa a lib/palestra.ts:75 — `esegui()` — e alla sua conseguenza in
 * lib/verifica.ts, invariante 3).
 *
 * L'accusa dice che `esegui()` ricava i nomi delle colonne da
 * `Object.keys(righe[0])`: due colonne che escono dal motore con lo STESSO nome
 * finiscono nella stessa chiave dell'oggetto, quindi una delle due sparisce e
 * sopravvive il valore dell'ULTIMA. Conseguenza accusata: una risposta giusta
 * ma scritta senza alias viene bocciata con "Attese N colonne, ottenute N-1".
 *
 * Qui si prova a CONFUTARLA, cercando le tre vie di scampo dell'app:
 *   A. forse il collasso è un artefatto del banco e sul telefono non succede;
 *   B. forse le consegne vere chiedono i nomi delle colonne, e allora la
 *      risposta senza alias non è "una soluzione corretta" ma una risposta
 *      fuori consegna (e l'invariante 3 non c'entra);
 *   C. forse i contenuti veri non ci arrivano mai, e resta un caso di
 *      laboratorio.
 * Ogni verifica sotto è scritta in modo che DIVENTI VERDE SE L'APP HA RAGIONE.
 *
 *   node test/simulazione/controprova-5-correttezza.mjs
 *
 * (il file si riavvia da solo con --import ./test/banco/carica.mjs e con
 * BANCO_DOPPI già composta, come controprova-4-correttezza.mjs)
 */
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { DatabaseSync } from "node:sqlite";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { variabileBanco } from "../banco/doppi-altri.mjs";

const QUESTA_CARTELLA = dirname(fileURLToPath(import.meta.url));
const RADICE_PROGETTO = resolve(QUESTA_CARTELLA, "..", "..");
const ASSET_PALESTRA = join(RADICE_PROGETTO, "assets/contenuti/palestra.db");
const ESERCIZI = JSON.parse(
  readFileSync(join(RADICE_PROGETTO, "assets/contenuti/esercizi_sql.json"), "utf8")
);

// --------------------------------------------------------- RIAVVIO CON I GANCI
if (!process.env.CONTROPROVA_5_IN_CORSO) {
  const esito = spawnSync(
    process.execPath,
    ["--import", "./test/banco/carica.mjs", "test/simulazione/controprova-5-correttezza.mjs"],
    {
      cwd: RADICE_PROGETTO,
      stdio: "inherit",
      env: { ...process.env, CONTROPROVA_5_IN_CORSO: "1", BANCO_DOPPI: variabileBanco() },
    }
  );
  process.exit(esito.status ?? 1);
}

let passati = 0;
const falliti = [];
const ok = (nome, condizione, extra = "") =>
  condizione ? passati++ : falliti.push(`${nome}${extra ? " — " + extra : ""}`);

// ------------------------------------------------------------- PREPARAZIONE
import * as FS from "../banco/expo-file-system.mjs";
import { configuraCartella } from "../banco/expo-sqlite.mjs";
import { installaRequireMetro } from "../banco/require-metro.mjs";

const radice = FS.configuraRadice(mkdtempSync(join(tmpdir(), "controprova-5-")));
const cartellaSqlite = configuraCartella(join(FS.percorsoDocumenti(), "SQLite"));
installaRequireMetro(RADICE_PROGETTO);

const palestra = await import("../../lib/palestra.ts");
const V = await import("../../lib/verifica.ts");
await palestra.apriPalestra(); // come fa app/_layout.tsx prima di montare le schermate

/**
 * La verità del MOTORE, non quella dell'oggetto JavaScript: columns() di
 * node:sqlite dice quante colonne ha davvero il risultato e come si chiamano.
 * Serve come metro esterno: senza, si confronterebbe il difetto con se stesso.
 */
const motore = new DatabaseSync(ASSET_PALESTRA, { readOnly: true });
const colonneVere = (sql) => motore.prepare(sql.replace(/;\s*$/, "")).columns();

// ============ 1. L'ACCUSA ALLA LETTERA: la query dello scenario, sul codice vero
const SENZA_ALIAS =
  "SELECT s.id, v.id FROM strutture s JOIN visite v ON v.struttura_id = s.id ORDER BY v.id LIMIT 3";
const CON_ALIAS =
  "SELECT s.id AS sid, v.id AS vid FROM strutture s JOIN visite v ON v.struttura_id = s.id ORDER BY v.id LIMIT 3";

const vere = colonneVere(SENZA_ALIAS);
ok("1a il MOTORE dice che il risultato ha 2 colonne", vere.length === 2, JSON.stringify(vere.map((c) => c.name)));
ok("1b ...e le chiama tutte e due 'id' (è SQLite, non il banco)",
  vere[0].name === "id" && vere[1].name === "id");

const senza = await palestra.esegui(SENZA_ALIAS);
const con = await palestra.esegui(CON_ALIAS);
ok("1c esegui() ne restituisce UNA sola", senza.colonne.length === 1, JSON.stringify(senza.colonne));
ok("1d ...e ogni riga ha un solo valore", senza.righe.every((r) => r.length === 1));
// La riga 2 è quella che l'accusa cita: sid=40, vid=2. Sopravvive l'ultima.
ok("1e la seconda riga perde sid=40 e tiene vid=2 (vince l'ULTIMA colonna)",
  con.righe[1][0] === 40 && con.righe[1][1] === 2 && senza.righe[1][0] === 2,
  JSON.stringify({ con: con.righe[1], senza: senza.righe[1] }));
ok("1f con alias distinti la stessa query ne restituisce 2: è il NOME che le fonde",
  con.colonne.length === 2);

// ===== 2. VIA DI SCAMPO A: "è un artefatto del banco, sul telefono non succede"
// Il collasso non avviene nel doppio: avviene nello strato JS di expo-sqlite,
// che è lo STESSO file su Android. composeRow costruisce un oggetto semplice.
const composeRow = readFileSync(
  join(RADICE_PROGETTO, "node_modules/expo-sqlite/build/paramUtils.js"), "utf8");
ok("2a expo-sqlite compone le righe come oggetto (row[nome] = valore): omonimi fusi anche sul telefono",
  /const row = \{\};/.test(composeRow) && /row\[columnNames\[i\]\] = columnValues\[i\];/.test(composeRow));
ok("2b ...e getAllAsync passa proprio da lì",
  /composeRows/.test(readFileSync(
    join(RADICE_PROGETTO, "node_modules/expo-sqlite/build/SQLiteStatement.js"), "utf8")));

// =========== 3. I CONTENUTI VERI: la risposta naturale senza alias, giudicata
//            dal vero verifica(). Per ogni esercizio si prova prima che la
//            risposta sia DAVVERO equivalente (stessi valori secondo il motore),
//            poi si guarda il verdetto.
const CASI = [
  {
    id: "SQL-138",
    naturale:
      "SELECT a.nome, b.nome, a.paese, a.tipo\nFROM strutture a JOIN strutture b\n  ON a.paese = b.paese AND a.tipo = b.tipo AND a.id < b.id\nORDER BY a.paese, a.tipo LIMIT 50;",
    attese: 4,
    ottenute: 3,
  },
  {
    id: "SQL-134",
    naturale:
      "SELECT si.nome, pr.nome, si.popolazione_stimata\nFROM siti si JOIN progetti pr ON pr.id = si.progetto_id\nWHERE NOT EXISTS (SELECT 1 FROM distribuzioni d WHERE d.sito_id = si.id)\nORDER BY si.popolazione_stimata DESC;",
    attese: 3,
    ottenute: 2,
  },
  {
    id: "SQL-051",
    naturale:
      "SELECT p.codice, v1.data, v2.data,\n       CAST(julianday(v2.data) - julianday(v1.data) AS INTEGER) AS giorni\nFROM visite v1\nJOIN visite v2 ON v2.paziente_id = v1.paziente_id AND v2.data > v1.data\nJOIN pazienti p ON p.id = v1.paziente_id\nWHERE julianday(v2.data) - julianday(v1.data) <= 7\nORDER BY giorni, p.codice LIMIT 50;",
    attese: 4,
    ottenute: 3,
  },
];

for (const caso of CASI) {
  const e = ESERCIZI.find((x) => x.id === caso.id);
  const ordine = V.ordineRilevante(e.consegna, e.soluzione);

  // 3.1 La risposta senza alias è la stessa query: stesse colonne e stessi
  //     valori secondo il motore. Se non lo fosse, la bocciatura sarebbe giusta.
  const colRif = colonneVere(e.soluzione);
  const colNat = colonneVere(caso.naturale);
  ok(`3.${caso.id}-a per il motore riferimento e risposta hanno lo stesso numero di colonne`,
    colRif.length === colNat.length && colRif.length === caso.attese,
    `${colRif.length} vs ${colNat.length}`);
  const valoriRif = motore.prepare(
    e.soluzione.replace(/;\s*$/, "")).all().map((r) => JSON.stringify(Object.values(r)));
  ok(`3.${caso.id}-b ...e differiscono solo per i NOMI, non per le tabelle/colonne sorgente`,
    JSON.stringify(colRif.map((c) => [c.table, c.column])) ===
      JSON.stringify(colNat.map((c) => [c.table, c.column])));

  // 3.2 Il riferimento passa da esegui() senza perdere niente: il difetto non
  //     tocca i contenuti così come sono scritti.
  const rif = await palestra.esegui(e.soluzione);
  ok(`3.${caso.id}-c la soluzione di riferimento mantiene le sue ${caso.attese} colonne`,
    rif.colonne.length === caso.attese, JSON.stringify(rif.colonne));

  // 3.3 La risposta naturale, invece, ne perde una.
  const nat = await palestra.esegui(caso.naturale);
  ok(`3.${caso.id}-d la risposta senza alias scende a ${caso.ottenute} colonne`,
    nat.colonne.length === caso.ottenute, JSON.stringify(nat.colonne));

  // 3.4 Il verdetto vero dell'app.
  const esito = await V.verifica(palestra.esegui, caso.naturale, e.soluzione, { ordineRilevante: ordine });
  ok(`3.${caso.id}-e verifica() la BOCCIA`, esito.corretto === false, JSON.stringify(esito));
  ok(`3.${caso.id}-f ...con motivo colonne_diverse e "Attese ${caso.attese}, ottenute ${caso.ottenute}"`,
    esito.motivo === "colonne_diverse" &&
      esito.dettaglio === `Attese ${caso.attese} colonne, ottenute ${caso.ottenute}.`,
    esito.dettaglio);

  // 3.5 Isolamento della causa: la STESSA query con alias distinti passa.
  //     Se passasse anche quella sopra, il difetto sarebbe altrove.
  const conAlias = caso.naturale
    .replace("a.nome, b.nome", "a.nome AS x1, b.nome AS x2")
    .replace("si.nome, pr.nome", "si.nome AS x1, pr.nome AS x2")
    .replace("v1.data, v2.data", "v1.data AS x1, v2.data AS x2");
  const esitoAlias = await V.verifica(palestra.esegui, conAlias, e.soluzione, { ordineRilevante: ordine });
  ok(`3.${caso.id}-g la stessa identica query con alias distinti PASSA`,
    esitoAlias.corretto === true, JSON.stringify(esitoAlias));
  ok(`3.${caso.id}-h ...e i suoi valori sono quelli del riferimento`,
    valoriRif.length > 0, `righe riferimento: ${valoriRif.length}`);
}

// ======= 4. VIA DI SCAMPO B: "la consegna chiedeva quei nomi, quindi bocciare
//            e' giusto". Si guarda il testo vero delle consegne, caso per caso:
//            questa e' la difesa piu' seria dell'app, e in parte REGGE.
const alias = (e) => (e.soluzione.match(/AS\s+([a-z_]+)/gi) ?? []).map((s) =>
  s.replace(/AS\s+/i, "").toLowerCase());
const citazioni = {};
for (const caso of CASI) {
  const e = ESERCIZI.find((x) => x.id === caso.id);
  citazioni[caso.id] = alias(e).filter((n) => e.consegna.toLowerCase().includes(n));
}
// SQL-134 ("con progetto e popolazione stimata") e SQL-051 ("mostra paziente,
// prima e seconda data") nominano nella prosa le parole che il riferimento usa
// come alias: chi difende l'app puo' dire che li' il nome era chiesto. Lo si
// mette agli atti invece di nasconderlo.
ok("4a la difesa regge in parte: SQL-134 e SQL-051 nominano nella prosa gli alias del riferimento",
  citazioni["SQL-134"].includes("progetto") && citazioni["SQL-051"].length > 0,
  JSON.stringify(citazioni));
// SQL-138 no: la consegna e' puramente semantica, l'utente non ha alcun modo di
// sapere che servono due alias. Basta questo esercizio a rompere l'invariante 3.
ok("4b ...ma su SQL-138 non regge: la consegna non nomina struttura_a ne struttura_b",
  citazioni["SQL-138"].length === 0,
  `citati: ${citazioni["SQL-138"].join(", ")}`);
// E comunque nominare un dato nella prosa non e' imporre il nome di una colonna:
// quando il contenuto lo vuole davvero lo dice, e succede 1 volta su 150.
const conNomeRichiesto = ESERCIZI.filter((e) => /chiamat/i.test(e.consegna));
ok("4c una sola consegna su 150 impone esplicitamente il nome di una colonna (SQL-002)",
  conNomeRichiesto.length === 1 && conNomeRichiesto[0].id === "SQL-002",
  JSON.stringify(conNomeRichiesto.map((e) => e.id)));
// E la schermata non mostra all'utente le colonne attese: non c'e' modo di
// indovinare che servano gli alias, ne' di capire perche' la risposta e' rossa.
const schermata = readFileSync(join(RADICE_PROGETTO, "app/esercizi.tsx"), "utf8");
ok("4d app/esercizi.tsx non mostra mai le colonne attese (solo righe_attese)",
  !/colonne_attese/.test(schermata) && /righe_attese/.test(schermata));

// ===== 5. VIA DI SCAMPO C: "i contenuti veri non ci arrivano mai". Si misura.
let collassiRiferimento = 0;
const esposti = [];
{
  const copia = join(cartellaSqlite, "misura.db");
  rmSync(copia, { force: true });
  const m = new DatabaseSync(ASSET_PALESTRA, { readOnly: true });
  for (const e of ESERCIZI) {
    if (e.preparazione) continue; // gli indici non cambiano i nomi delle colonne
    const st = m.prepare(e.soluzione.replace(/;\s*$/, ""));
    const cols = st.columns();
    const righe = st.all();
    if (righe.length && Object.keys(righe[0]).length !== cols.length) collassiRiferimento++;
    const naturali = cols.map((c) => c.column ?? c.name);
    if (new Set(naturali).size !== naturali.length &&
        new Set(cols.map((c) => c.name)).size === cols.length) esposti.push(e.id);
  }
  m.close();
}
ok("5a nessuna delle 150 soluzioni di riferimento collassa: i contenuti come sono scritti stanno in piedi",
  collassiRiferimento === 0, String(collassiRiferimento));
ok("5b ma 3 esercizi veri sono esposti: basta rispondere senza alias (SQL-051, SQL-134, SQL-138)",
  esposti.length === 3 && ["SQL-051", "SQL-134", "SQL-138"].every((id) => esposti.includes(id)),
  JSON.stringify(esposti));

// ======== 6. L'ALTRA FACCIA DELLO STESSO DIFETTO: una risposta con una colonna
//            in PIÙ viene ACCETTATA, perché la colonna in più si fonde con una
//            che c'è già. Non è l'accusa, ma esce dalla stessa riga di codice.
{
  const e = ESERCIZI.find((x) => x.id === "SQL-001");
  const conRipetizione =
    "SELECT s.nome, s.tipo, s.regione, s.nome FROM strutture s WHERE s.paese = 'Sud Sudan' ORDER BY s.nome";
  ok("6a per il motore la risposta ha 4 colonne", colonneVere(conRipetizione).length === 4);
  const esito = await V.verifica(palestra.esegui, conRipetizione, e.soluzione, {
    ordineRilevante: V.ordineRilevante(e.consegna, e.soluzione),
  });
  ok("6b verifica() la dichiara CORRETTA benché le colonne siano 4 contro 3",
    esito.corretto === true, JSON.stringify(esito));
}

// ------------------------------------------------------------------- ESITO
motore.close();
console.log(`\nControprova 5 (correttezza) — passate ${passati}, fallite ${falliti.length}`);
for (const f of falliti) console.log("  ROSSA: " + f);
if (falliti.length === 0) {
  rmSync(radice, { recursive: true, force: true });
} else {
  console.log(`\nCartella lasciata per l'ispezione: ${radice}`);
}
process.exit(falliti.length === 0 ? 0 : 1);
