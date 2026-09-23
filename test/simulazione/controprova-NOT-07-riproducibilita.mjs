/**
 * CONTROPROVA NOT-07 — lente "riproducibilità".
 *
 * Difetto da confutare: «Modifiche alla nota scartate in silenzio in tutti i modi
 * di uscire» (tasto indietro, cambio scheda, apertura di un'altra nota).
 *
 * Regola di questa controprova: il difetto si riproduce con codice mio, scritto
 * da zero, che fa girare la schermata VERA app/(tabs)/note.tsx e il livello dati
 * VERO lib/db.ts su node:sqlite. Nessun import e nessuna lettura del file di
 * simulazione dell'altro agente: se il difetto esiste solo dentro il suo banco,
 * è confutato.
 *
 * Il verdetto sul disco si legge SEMPRE da fuori dal banco: una seconda
 * connessione node:sqlite aperta sul file percorso.db. Così l'assenza di una
 * scrittura non può essere un artefatto della connessione dell'app.
 *
 * Uso:  node test/simulazione/controprova-NOT-07-riproducibilita.mjs
 * (si rilancia da sé con i ganci del banco e i doppi accanto)
 */
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { DatabaseSync } from "node:sqlite";

const QUESTO = fileURLToPath(import.meta.url);
const CARTELLA = dirname(QUESTO);
const RADICE = resolve(CARTELLA, "..", "..");
const DOPPI_MIEI = join(CARTELLA, "controprova-NOT-07-riproducibilita-doppi.mjs");

// ------------------------------------------------ rilancio con i ganci del banco
// I ganci di risoluzione vanno registrati PRIMA che qualunque import dell'app
// parta: l'unico modo pulito è --import, quindi il file si rilancia da sé.
if (!process.env.CONTROPROVA_NOT07_PRONTA) {
  const cartellaDati = mkdtempSync(join(tmpdir(), "controprova-not07-"));
  const figlio = spawnSync(
    process.execPath,
    ["--import", join(RADICE, "test/banco/carica.mjs"), QUESTO],
    {
      stdio: "inherit",
      env: {
        ...process.env,
        CONTROPROVA_NOT07_PRONTA: "1",
        CONTROPROVA_NOT07_CARTELLA: cartellaDati,
        BANCO_SQLITE_CARTELLA: cartellaDati,
        BANCO_DOPPI: JSON.stringify({
          react: DOPPI_MIEI,
          "react/jsx-runtime": DOPPI_MIEI,
          "react/jsx-dev-runtime": DOPPI_MIEI,
          "react-native": DOPPI_MIEI,
          "expo-crypto": join(RADICE, "test/banco/expo-crypto.mjs"),
        }),
      },
    }
  );
  process.exit(figlio.status ?? 1);
}

// --------------------------------------------------------------- esiti
let falliti = 0;
const righe = [];

function accerta(id, descrizione, condizione, dettaglio = "") {
  const esito = condizione ? "OK  " : "ROSSO";
  if (!condizione) falliti += 1;
  righe.push(`${esito}  ${id}  ${descrizione}${dettaglio ? `  [${dettaglio}]` : ""}`);
}

function titolo(testo) {
  righe.push("");
  righe.push(`--- ${testo}`);
}

// ------------------------------------------------------- albero e pressioni
const nome = (n) => (typeof n?.tipo === "function" ? n.tipo.nomeFinto ?? n.tipo.name : String(n?.tipo));

/** Appiattisce l'albero. La FlatList non ha figli: le sue righe nascono da renderItem. */
function nodi(radice, fuori = []) {
  if (radice == null || typeof radice === "boolean") return fuori;
  if (Array.isArray(radice)) {
    for (const figlio of radice) nodi(figlio, fuori);
    return fuori;
  }
  if (typeof radice === "string" || typeof radice === "number") return fuori;
  if (!radice.$elemento) return fuori;
  fuori.push(radice);
  const props = radice.props ?? {};
  if (nome(radice) === "FlatList") {
    const dati = props.data ?? [];
    if (!dati.length && props.ListEmptyComponent) nodi(props.ListEmptyComponent, fuori);
    dati.forEach((item, index) => {
      if (props.renderItem) nodi(props.renderItem({ item, index }), fuori);
    });
    return fuori;
  }
  nodi(props.children, fuori);
  return fuori;
}

/** Tutto il testo visibile sotto un nodo, righe della lista comprese. */
function testoDi(radice) {
  const pezzi = [];
  const raccogli = (n) => {
    if (n == null || typeof n === "boolean") return;
    if (Array.isArray(n)) return n.forEach(raccogli);
    if (typeof n === "string" || typeof n === "number") return void pezzi.push(String(n));
    if (!n.$elemento) return;
    const props = n.props ?? {};
    if (nome(n) === "FlatList") {
      const dati = props.data ?? [];
      if (!dati.length && props.ListEmptyComponent) raccogli(props.ListEmptyComponent);
      dati.forEach((item, index) => props.renderItem && raccogli(props.renderItem({ item, index })));
      return;
    }
    raccogli(props.children);
  };
  raccogli(radice);
  return pezzi.join(" ");
}

const schermata = (istanza) => istanza.albero;

function bottone(istanza, etichetta) {
  const trovato = nodi(schermata(istanza)).find(
    (n) => nome(n) === "Pressable" && testoDi(n).includes(etichetta)
  );
  if (!trovato) throw new Error(`Bottone "${etichetta}" non trovato nella schermata.`);
  return trovato;
}

function campo(istanza, segnaposto) {
  const trovato = nodi(schermata(istanza)).find(
    (n) => nome(n) === "TextInput" && n.props.placeholder === segnaposto
  );
  if (!trovato) throw new Error(`Campo "${segnaposto}" non trovato nella schermata.`);
  return trovato;
}

const editorAperto = (istanza) =>
  nodi(schermata(istanza)).some((n) => nome(n) === "TextInput" && n.props.placeholder === "Markdown");

/** Lascia finire le catene async del codice vero (ricarica, registra, coda). */
async function riposa(giri = 30) {
  for (let i = 0; i < giri; i++) await new Promise((r) => setImmediate(r));
}

async function premi(nodo) {
  await nodo.props.onPress();
  await riposa();
}

async function scrivi(nodo, valore) {
  await nodo.props.onChangeText(valore);
  await riposa();
}

// ------------------------------------------- verdetto letto FUORI dal banco
const CARTELLA_DATI = process.env.CONTROPROVA_NOT07_CARTELLA;
const FILE_DB = join(CARTELLA_DATI, "percorso.db");

/**
 * Seconda connessione, indipendente da quella dell'app. In sola lettura quando
 * si può: un lettore che non può scrivere non può nemmeno falsare il verdetto.
 */
function daFuori(sql, parametri = []) {
  let connessione;
  try {
    connessione = new DatabaseSync(FILE_DB, { readOnly: true });
  } catch {
    connessione = new DatabaseSync(FILE_DB);
  }
  try {
    return connessione.prepare(sql).all(...parametri);
  } finally {
    connessione.close();
  }
}

const notaDaFuori = (id) => daFuori("SELECT * FROM note WHERE id = ?", [id])[0] ?? null;
const quantiEventi = () => daFuori("SELECT COUNT(*) AS n FROM eventi")[0].n;

/** Parole con cui una schermata avviserebbe di una perdita imminente. */
const SPIE_AVVISO = ["non salvat", "perder", "perdi", "scartare", "sei sicuro", "vuoi salvare", "modifiche non"];
const avvisaDiPerdita = (istanza) => {
  const testo = testoDi(schermata(istanza)).toLowerCase();
  return SPIE_AVVISO.some((spia) => testo.includes(spia));
};

// ------------------------------------------------------------------ prova
const { importaApp } = await import(pathToFileURL(join(RADICE, "test/banco/carica.mjs")).href);
const doppi = await import(pathToFileURL(DOPPI_MIEI).href);
const db = await importaApp("lib/db.ts");
const schermoNote = await importaApp("app/(tabs)/note.tsx");
const Note = schermoNote.default;

await db.apri("banco07");
doppi.configuraSchermo(390); // telefono: è l'unica impaginazione che ha il tasto indietro

const app = doppi.monta(Note);
await riposa();

titolo("Controllo positivo: il banco muove davvero il codice vero");
accerta("BANCO-1", "la schermata si monta e mostra l'elenco vuoto",
  testoDi(schermata(app)).includes("Nessuna nota"));

await premi(bottone(app, "Nuova nota"));
await scrivi(campo(app, "Titolo"), "Prima nota");
await scrivi(campo(app, "Markdown"), "riga uno");
const eventiPrimaDelSalva = quantiEventi();
await premi(bottone(app, "Salva"));

const salvate = daFuori("SELECT * FROM note");
accerta("BANCO-2", "Salva scrive davvero sul file, e si vede da fuori dal banco",
  salvate.length === 1 && salvate[0].testo === "riga uno",
  `note sul disco: ${salvate.length}`);
accerta("BANCO-3", "e scrive anche l'evento nel registro",
  quantiEventi() === eventiPrimaDelSalva + 1);

const idPrima = salvate[0]?.id;

titolo("Uscita 1 — tasto indietro (← Tutte le note)");
await scrivi(campo(app, "Markdown"), "riga uno\nriga due scritta e mai salvata");
accerta("IND-1", "l'editor mostra la modifica prima di uscire",
  campo(app, "Markdown").props.value.includes("mai salvata"));
const eventiPrimaDiUscire = quantiEventi();

await premi(bottone(app, "Tutte le note"));

accerta("IND-2", "uscendo non si apre nessun avviso di perdita",
  !avvisaDiPerdita(app) && doppi.avvisiMostrati.length === 0,
  `avvisi: ${doppi.avvisiMostrati.length}`);
accerta("IND-3", "uscendo non viene scritto niente sul disco",
  notaDaFuori(idPrima).testo === "riga uno" && quantiEventi() === eventiPrimaDiUscire,
  `testo sul disco: ${JSON.stringify(notaDaFuori(idPrima).testo)}`);
accerta("IND-4", "l'editor si è chiuso: si è tornati all'elenco", !editorAperto(app));

// Rientrare nella nota è l'unico modo per rivedere l'editor sul telefono:
// apri() riscrive gli stati dalla riga del database, quindi la modifica muore qui.
await premi(bottone(app, "Prima nota"));
accerta("IND-5", "rientrando nella nota la modifica non c'è più",
  campo(app, "Markdown").props.value === "riga uno",
  `testo nell'editor: ${JSON.stringify(campo(app, "Markdown").props.value)}`);

titolo("Uscita 2 — cambio scheda");
await scrivi(campo(app, "Markdown"), "riga uno\nseconda modifica in sospeso");
const eventiPrimaDellaScheda = quantiEventi();

// Che cosa fa DAVVERO expo-router qui: BottomTabView tiene un elenco `loaded`
// e, una volta caricata, la scheda resta montata (congelata, non smontata).
// Verifica statica sulla libreria installata, perché il banco non ha il navigatore.
const sorgenteNavigatore = readFileSync(
  join(RADICE, "node_modules/@react-navigation/bottom-tabs/lib/module/views/BottomTabView.js"), "utf8");
accerta("SCH-1", "la scheda resta montata: nessun unmountOnBlur, solo `loaded` e freeze",
  !sorgenteNavigatore.includes("unmountOnBlur") &&
    sorgenteNavigatore.includes("setLoaded") && sorgenteNavigatore.includes("freezeOnBlur"));

// Tornare sulla scheda = ridisegnare la stessa istanza, non rimontarla.
doppi.ridisegna(app);
await riposa();
accerta("SCH-2", "tornando sulla scheda la modifica è ANCORA nell'editor",
  campo(app, "Markdown").props.value.includes("seconda modifica in sospeso"),
  `testo nell'editor: ${JSON.stringify(campo(app, "Markdown").props.value)}`);
accerta("SCH-3", "non è sul disco, ma è ancora nell'editor: da salvare, non persa",
  notaDaFuori(idPrima).testo === "riga uno" && quantiEventi() === eventiPrimaDellaScheda);

// Controfattuale: se la schermata venisse davvero distrutta (processo ucciso dal
// sistema, o unmountOnBlur — che qui NON c'è), allora sì che la modifica sparisce.
doppi.smonta(app);
const app2 = doppi.monta(Note);
await riposa();
await premi(bottone(app2, "Prima nota"));
accerta("SCH-4", "solo un vero smontaggio (app chiusa) perde la modifica",
  campo(app2, "Markdown").props.value === "riga uno");

titolo("Uscita 3 — apertura di un'altra nota (impaginazione affiancata, >=600dp)");
// Sul telefono l'elenco non è visibile mentre l'editor è aperto: per toccare
// un'altra nota si passa comunque dal tasto indietro. L'uscita "apro un'altra
// nota" senza passare da indietro esiste solo affiancata, quindi si prova lì.
doppi.smonta(app2);
doppi.configuraSchermo(800);
const tab = doppi.monta(Note);
await riposa();
accerta("ALT-0", "affiancata: elenco ed editor insieme, nessun tasto indietro",
  testoDi(schermata(tab)).includes("Prima nota") &&
    !testoDi(schermata(tab)).includes("Tutte le note"));

await premi(bottone(tab, "Nuova nota"));
await scrivi(campo(tab, "Titolo"), "Seconda nota");
await scrivi(campo(tab, "Markdown"), "testo due");
await premi(bottone(tab, "Salva"));

await premi(bottone(tab, "Prima nota"));
await scrivi(campo(tab, "Markdown"), "riga uno\nterza modifica mai salvata");
const eventiPrimaDelSalto = quantiEventi();
await premi(bottone(tab, "Seconda nota"));

accerta("ALT-1", "aprendo l'altra nota non compare nessun avviso",
  !avvisaDiPerdita(tab) && doppi.avvisiMostrati.length === 0);
accerta("ALT-2", "l'editor mostra ora la seconda nota",
  campo(tab, "Markdown").props.value === "testo due");
accerta("ALT-3", "la prima nota sul disco è rimasta indietro",
  notaDaFuori(idPrima).testo === "riga uno" && quantiEventi() === eventiPrimaDelSalto,
  `testo sul disco: ${JSON.stringify(notaDaFuori(idPrima).testo)}`);
await premi(bottone(tab, "Prima nota"));
accerta("ALT-4", "e riaprendola la modifica è persa",
  campo(tab, "Markdown").props.value === "riga uno",
  `testo nell'editor: ${JSON.stringify(campo(tab, "Markdown").props.value)}`);

titolo("Nessuna rete di sicurezza nel codice della schermata");
const sorgente = readFileSync(join(RADICE, "app/(tabs)/note.tsx"), "utf8");
for (const guardia of ["Alert", "usePreventRemove", "beforeRemove", "setInterval", "useFocusEffect", "confirm"]) {
  accerta(`SRC-${guardia}`, `note.tsx non usa ${guardia}`, !sorgente.includes(guardia));
}
accerta("SRC-apri", "apri() riscrive gli stati senza confrontarli con quelli in corso",
  /function apri\(n: Nota\) \{\s*setApertaId\(n\.id\); setTitolo/.test(sorgente));

// --------------------------------------------------------------- resoconto
righe.push("");
righe.push(`asserzioni: ${righe.filter((r) => r.startsWith("OK") || r.startsWith("ROSSO")).length}, rosse: ${falliti}`);
righe.push(
  falliti === 0
    ? "ESITO: il difetto NOT-07 si riproduce con codice scritto da zero — CONFERMATO, con una precisazione sul cambio scheda."
    : "ESITO: qualcosa non torna, leggere le righe ROSSO."
);
righe.push(`file di prova: ${FILE_DB} (${existsSync(FILE_DB) ? "presente" : "assente"})`);
console.log(righe.join("\n"));
process.exit(falliti === 0 ? 0 : 1);
