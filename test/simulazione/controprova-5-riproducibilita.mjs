/**
 * Controprova avversariale n.5 — lente "riproducibilità".
 *
 * Scritta da zero, senza importare né fidarsi del test dell'altro agente
 * (motore-sql.mjs) e senza il doppio del banco per expo-sqlite: qui si parla
 * direttamente a node:sqlite sul VERO assets/contenuti/palestra.db.
 *
 * Perché non uso il doppio: se il collasso delle colonne omonime fosse un
 * artefatto del doppio, la controprova non varrebbe nulla. Quindi ricostruisco
 * il percorso vero riga per riga:
 *   1. i NOMI delle colonne li chiedo a SQLite (Stmt.columns() -> sqlite3_column_name),
 *      cioè la stessa fonte che il modulo nativo di expo passa a composeRows();
 *   2. i VALORI li prendo grezzi (setReturnArrays(true)), senza passare da un
 *      oggetto, così nessun collasso è già avvenuto prima della mia misura;
 *   3. l'oggetto riga lo costruisco con la trascrizione fedele di
 *      node_modules/expo-sqlite/build/paramUtils.js -> composeRows();
 *   4. da lì applico la trascrizione fedele di lib/palestra.ts:72-77 esegui().
 * L'unico pezzo dell'app che carico davvero è lib/verifica.ts, che è puro
 * TypeScript senza moduli nativi: quello è il giudice, e voglio il suo verdetto
 * vero, non la mia idea del suo verdetto.
 *
 * Comando:
 *   node --import ./test/banco/carica.mjs test/simulazione/controprova-5-riproducibilita.mjs
 */
import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, copyFileSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const RADICE = resolve(import.meta.dirname, "..", "..");

let verdi = 0;
const rossi = [];
function esigi(descrizione, condizione, extra = "") {
  if (condizione) { verdi++; console.log(`  ok   ${descrizione}`); }
  else { rossi.push(descrizione); console.log(`  NO   ${descrizione} ${extra}`); }
}
function titolo(t) { console.log(`\n== ${t}`); }

// --- cartella isolata: gli altri agenti girano in parallelo -----------------
const cartella = mkdtempSync(join(tmpdir(), "controprova5-"));
const percorsoDb = join(cartella, "palestra.db");
copyFileSync(join(RADICE, "assets", "contenuti", "palestra.db"), percorsoDb);

const db = new DatabaseSync(percorsoDb, { readOnly: true });

/**
 * Trascrizione fedele di composeRows() di expo-sqlite (paramUtils.js).
 * La riporto qui invece di importarla perché voglio che si veda a occhio nudo
 * che l'assegnamento è `row[nome] = valore` in un ciclo: è lì che due colonne
 * omonime diventano una.
 */
function componiRighe(nomiColonne, listaValori) {
  if (listaValori.length === 0) return [];
  const risultati = [];
  for (const valori of listaValori) {
    const riga = {};
    for (let i = 0; i < nomiColonne.length; i++) riga[nomiColonne[i]] = valori[i];
    risultati.push(riga);
  }
  return risultati;
}

/** Nomi di colonna e valori GREZZI, come li vede SQLite prima di ogni oggetto. */
function grezzo(sql) {
  const stmt = db.prepare(sql);
  const nomi = stmt.columns().map((c) => c.name);
  stmt.setReturnArrays(true);
  return { nomi, valori: stmt.all() };
}

/** Trascrizione fedele di lib/palestra.ts:72-77 esegui(), sopra il percorso vero. */
function eseguiComeLApp(sql) {
  const { nomi, valori } = grezzo(sql);
  const righeOggetto = componiRighe(nomi, valori);          // expo: composeRows
  const colonne = righeOggetto.length ? Object.keys(righeOggetto[0]) : [];
  return { colonne, righe: righeOggetto.map((r) => colonne.map((c) => r[c])) };
}

// ---------------------------------------------------------------------------
titolo("1. Il meccanismo, su tabelle vere ma query mia");
{
  const sql =
    "SELECT s.id, v.id FROM strutture s JOIN visite v ON v.struttura_id = s.id ORDER BY v.id LIMIT 3";
  const g = grezzo(sql);
  const dopo = eseguiComeLApp(sql);

  esigi("SQLite restituisce 2 colonne", g.nomi.length === 2, JSON.stringify(g.nomi));
  esigi("le due colonne hanno lo STESSO nome 'id'",
    g.nomi[0] === "id" && g.nomi[1] === "id", JSON.stringify(g.nomi));
  esigi("i valori grezzi sono 2 per riga e DIVERSI fra loro",
    g.valori.length === 3 && g.valori.every((r) => r.length === 2) &&
    g.valori.some((r) => r[0] !== r[1]), JSON.stringify(g.valori));

  esigi("esegui() dell'app ne dichiara 1 sola", dopo.colonne.length === 1,
    JSON.stringify(dopo.colonne));
  esigi("sopravvive il valore dell'ULTIMA colonna (v.id), il primo (s.id) è perso",
    dopo.righe.every((r, i) => r.length === 1 && r[0] === g.valori[i][1]) &&
    g.valori.some((r, i) => r[0] !== dopo.righe[i][0]),
    `grezzo=${JSON.stringify(g.valori)} dopo=${JSON.stringify(dopo.righe)}`);

  // Controprova del meccanismo: con alias distinti il collasso sparisce.
  const conAlias = eseguiComeLApp(
    "SELECT s.id AS sid, v.id AS vid FROM strutture s JOIN visite v ON v.struttura_id = s.id ORDER BY v.id LIMIT 3");
  esigi("la STESSA query con alias distinti conserva 2 colonne", conAlias.colonne.length === 2,
    JSON.stringify(conAlias.colonne));
  esigi("e conserva entrambi i valori",
    conAlias.righe.every((r, i) => r[0] === g.valori[i][0] && r[1] === g.valori[i][1]),
    JSON.stringify(conAlias.righe));
}

// ---------------------------------------------------------------------------
titolo("2. Contenuti VERI: la risposta corretta senza alias, su SQL-138 e SQL-134");
const esercizi = JSON.parse(
  readFileSync(join(RADICE, "assets", "contenuti", "esercizi_sql.json"), "utf8"));
const perId = new Map(esercizi.map((e) => [e.id, e]));

/**
 * Le risposte "naturali": stessa logica della soluzione di riferimento, senza
 * gli alias di colonna, che nessuna delle due consegne chiede.
 */
const casi = [
  {
    id: "SQL-138",
    risposta:
      "SELECT a.nome, b.nome, a.paese, a.tipo\n" +
      "FROM strutture a JOIN strutture b\n" +
      "  ON a.paese = b.paese AND a.tipo = b.tipo AND a.id < b.id\n" +
      "ORDER BY a.paese, a.tipo LIMIT 50;",
  },
  {
    id: "SQL-134",
    risposta:
      "SELECT si.nome, pr.nome, si.popolazione_stimata\n" +
      "FROM siti si JOIN progetti pr ON pr.id = si.progetto_id\n" +
      "WHERE NOT EXISTS (SELECT 1 FROM distribuzioni d WHERE d.sito_id = si.id)\n" +
      "ORDER BY si.popolazione_stimata DESC;",
  },
];

for (const caso of casi) {
  const es = perId.get(caso.id);
  console.log(`\n  -- ${caso.id} (${es.consegna})`);

  const rif = eseguiComeLApp(es.soluzione);
  const utente = eseguiComeLApp(caso.risposta);
  const gRif = grezzo(es.soluzione);
  const gUtente = grezzo(caso.risposta);

  esigi(`${caso.id}: le due query chiedono a SQLite lo stesso numero di colonne`,
    gRif.nomi.length === gUtente.nomi.length,
    `${gRif.nomi.length} vs ${gUtente.nomi.length}`);

  // La riprova che la risposta è CORRETTA: valori grezzi identici, riga per riga.
  const identicaAllOrigine =
    gRif.valori.length === gUtente.valori.length &&
    gRif.valori.every((r, i) => r.length === gUtente.valori[i].length &&
      r.every((v, j) => String(v) === String(gUtente.valori[i][j])));
  esigi(`${caso.id}: la risposta senza alias dà a SQLite ESATTAMENTE lo stesso risultato`,
    identicaAllOrigine,
    `righe rif=${gRif.valori.length} utente=${gUtente.valori.length}`);

  esigi(`${caso.id}: il riferimento (con alias) sopravvive a esegui(): ${es.colonne_attese.length} colonne`,
    rif.colonne.length === es.colonne_attese.length,
    JSON.stringify(rif.colonne));
  esigi(`${caso.id}: la risposta senza alias PERDE una colonna passando da esegui()`,
    utente.colonne.length === rif.colonne.length - 1,
    `attese ${rif.colonne.length}, ottenute ${utente.colonne.length} -> ${JSON.stringify(utente.colonne)}`);

  caso.rif = rif; caso.utente = utente; caso.es = es;
}

// ---------------------------------------------------------------------------
titolo("3. Il verdetto del VERO lib/verifica.ts");
{
  const verificaMod = await import(join(RADICE, "lib", "verifica.ts"));
  const { verifica, ordineRilevante } = verificaMod;

  for (const caso of casi) {
    const esecutore = async (sql) => eseguiComeLApp(sql);
    const opzioni = {
      ordineRilevante: ordineRilevante(caso.es.consegna, caso.es.soluzione),
    };
    const esito = await verifica(esecutore, caso.risposta, caso.es.soluzione, opzioni);
    console.log(`\n  -- ${caso.id}: ${JSON.stringify(esito)}`);
    esigi(`${caso.id}: verifica() BOCCIA una risposta corretta`, esito.corretto === false);
    esigi(`${caso.id}: e il motivo è 'colonne_diverse'`, esito.motivo === "colonne_diverse",
      String(esito.motivo));
    esigi(`${caso.id}: dettaglio = "Attese ${caso.rif.colonne.length} colonne, ottenute ${caso.utente.colonne.length}."`,
      esito.dettaglio === `Attese ${caso.rif.colonne.length} colonne, ottenute ${caso.utente.colonne.length}.`,
      esito.dettaglio);

    // Falsificazione: la stessa risposta con alias qualunque (anche diversi da
    // quelli del riferimento) deve passare. Se passasse anche senza alias, il
    // difetto non sarebbe nel collasso ma altrove.
    const conAlias = caso.risposta.replace(
      caso.id === "SQL-138" ? "SELECT a.nome, b.nome," : "SELECT si.nome, pr.nome,",
      caso.id === "SQL-138" ? "SELECT a.nome AS x1, b.nome AS x2," : "SELECT si.nome AS x1, pr.nome AS x2,");
    esigi(`${caso.id}: la sostituzione per la falsificazione ha morso`, conAlias !== caso.risposta);
    const esito2 = await verifica(esecutore, conAlias, caso.es.soluzione, opzioni);
    esigi(`${caso.id}: la STESSA query con alias qualunque PASSA (${esito2.motivo})`,
      esito2.corretto === true, JSON.stringify(esito2));
  }
}

// ---------------------------------------------------------------------------
titolo("4. Controllo: quante delle 150 soluzioni di RIFERIMENTO collassano?");
{
  let collassi = 0, eseguite = 0, saltate = 0;
  for (const es of esercizi) {
    if (!es.soluzione) { saltate++; continue; }
    let g;
    try { g = grezzo(es.soluzione); } catch { saltate++; continue; }
    eseguite++;
    if (new Set(g.nomi).size !== g.nomi.length) {
      collassi++;
      console.log(`     collasso nel riferimento: ${es.id} -> ${JSON.stringify(g.nomi)}`);
    }
  }
  console.log(`     eseguite ${eseguite}, saltate ${saltate}`);
  esigi("le 150 soluzioni di riferimento non ne soffrono (0 collassi)", collassi === 0,
    `collassi=${collassi}`);
}

// ---------------------------------------------------------------------------
titolo("5. Quanti esercizi hanno un riferimento con alias che la risposta naturale perderebbe?");
{
  // Misura di portata, non una verifica: quanti riferimenti usano un alias su
  // una colonna il cui nome nudo è già presente nella stessa SELECT.
  let esposti = 0;
  for (const es of esercizi) {
    if (!es.soluzione) continue;
    let nudi;
    try {
      // Tolgo gli "AS <alias>" di primo livello e riguardo i nomi che restano.
      const senzaAlias = es.soluzione.replace(/\s+AS\s+[A-Za-z_][A-Za-z0-9_]*/gi, "");
      nudi = grezzo(senzaAlias).nomi;
    } catch { continue; }
    if (new Set(nudi).size !== nudi.length) {
      esposti++;
      console.log(`     ${es.id}: senza alias -> ${JSON.stringify(nudi)}`);
    }
  }
  console.log(`     esercizi esposti: ${esposti}`);
  esigi("almeno un esercizio dei contenuti veri è esposto", esposti >= 1, `esposti=${esposti}`);
}

// ---------------------------------------------------------------------------
console.log(`\n==== verdi ${verdi}, rossi ${rossi.length}`);
if (rossi.length) {
  for (const r of rossi) console.log(`  rosso: ${r}`);
  console.log(`cartella conservata: ${cartella}`);
  process.exitCode = 1;
} else {
  db.close();
  rmSync(cartella, { recursive: true, force: true });
}
