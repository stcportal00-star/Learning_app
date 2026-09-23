/**
 * Controprova AVVERSARIALE di HLC-02, lente "riproducibilita".
 *
 * Tesi da confutare: `Orologio.ricevi()` (lib/hlc.ts:78) non e' chiamato da
 * nessun punto di lib/ e app/, quindi l'orologio locale non avanza mai quando
 * arriva un evento remoto piu' avanti, e la modifica locale successiva perde.
 *
 * Perche' questo file esiste separato: il difetto e' stato segnalato da un
 * altro agente sulla base di una scansione. Una scansione puo' sbagliare in
 * due modi opposti — puo' non vedere una chiamata scritta in altra forma
 * (`orologio?.ricevi`, `Reflect.get`, un alias), e puo' vedere un difetto che
 * non produce nessun danno. Qui si ricostruisce tutto da zero, senza leggere
 * ne' importare test/simulazione/sync-fusione.mjs, e si pretende che la
 * differenza si veda sul codice VERO, non su una copia.
 *
 * Esecuzione (dalla radice del progetto):
 *   node test/simulazione/controprova-HLC-02-riproducibilita.mjs
 *
 * Non tocca niente del progetto: la parte C lavora in una cartella temporanea.
 *
 * Quattro parti:
 *   A. la scansione, rifatta con criteri MIEI e volutamente piu' larghi di
 *      quelli dell'accusa, piu' il controllo che la chiamata non possa
 *      esistere in forma dinamica (chi tiene l'Orologio e cosa espone).
 *   B. la conseguenza sulla fusione, con lib/hlc.ts e lib/sync/fusione.ts
 *      VERI: stesso scenario due volte, l'unica differenza e' se si chiama
 *      `ricevi()` o no. Se il vincitore non cambia, HLC-02 e' innocuo.
 *   C. la stessa cosa end-to-end attraverso lib/db.ts vero su node:sqlite,
 *      col verdetto letto da FUORI (seconda connessione al file): serve a
 *      escludere che lo stato persistito (meta.hlc) recuperi da solo al
 *      riavvio, cosa che renderebbe il difetto transitorio e non critico.
 *   D. l'effetto collaterale deterministico: la spia di deriva oraria in
 *      app/(tabs)/oggi.tsx. Non dipende da nessuna ipotesi sugli orologi.
 *
 * DOPO LA CORREZIONE (lasciato com'era, e' il verbale di una verifica fatta
 * prima). La parte A e' ora ROSSA in tutte e quattro le righe, ed e' il modo
 * in cui questo file annuncia che il difetto non c'e' piu': `lib/db.ts`
 * chiama `orologio.ricevi()` ed esporta `assorbiRemoto()`, che l'hook di
 * sincronizzazione invoca prima di applicare il pacchetto. La parte C invece
 * continua a mostrare il vecchio esito perche' RICOPIA a mano la sequenza di
 * useAutoSync com'era allora, senza l'assorbimento: misura quel codice, non
 * quello dell'app. La prova della correzione sul codice vero e' lo scenario
 * I11 di sync-fusione.mjs.
 */
import { DatabaseSync } from "node:sqlite";
import { readdirSync, readFileSync, mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
// L'ordine conta: carica.mjs registra i ganci prima che si importi l'app.
import "../banco/carica.mjs";
import { configuraCartella } from "../banco/expo-sqlite.mjs";

const RADICE = new URL("../../", import.meta.url).pathname.replace(/\/$/, "");

let rosse = 0;
let verdi = 0;

function verifica(titolo, condizione, dettaglio = "") {
  if (condizione) {
    verdi++;
    console.log(`  ok   ${titolo}`);
  } else {
    rosse++;
    console.log(`  ROSSA ${titolo}${dettaglio ? "\n        " + dettaglio : ""}`);
  }
}

function titolo(t) {
  console.log(`\n${t}\n${"-".repeat(t.length)}`);
}

/** Tutti i sorgenti dell'app sotto le cartelle indicate. */
function sorgenti(cartelle) {
  const trovati = [];
  const scendi = (dir) => {
    for (const voce of readdirSync(dir)) {
      if (voce === "node_modules" || voce.startsWith(".")) continue;
      const p = join(dir, voce);
      if (statSync(p).isDirectory()) scendi(p);
      else if (/\.tsx?$/.test(voce)) trovati.push(p);
    }
  };
  for (const c of cartelle) scendi(join(RADICE, c));
  return trovati;
}

// =====================================================================
titolo("PARTE A — la chiamata esiste? (scansione rifatta da zero)");

const FILE_APP = sorgenti(["lib", "app", "components"]);
verifica(
  "la scansione vede davvero dei sorgenti (se no, misura non valida)",
  FILE_APP.length > 20,
  `trovati ${FILE_APP.length} file`
);

// Criterio 1 — ogni `.ricevi(` dell'app, senza filtri, elencato con la sua
// riga. Volutamente piu' largo dell'accusa: se una chiamata all'orologio
// esiste sotto altro nome di variabile, deve comparire qui.
const occorrenzeRicevi = [];
for (const f of FILE_APP) {
  const righe = readFileSync(f, "utf8").split("\n");
  righe.forEach((riga, i) => {
    if (/\.ricevi\s*\(/.test(riga)) {
      occorrenzeRicevi.push({ file: relative(RADICE, f), riga: i + 1, testo: riga.trim() });
    }
  });
}
console.log("  .ricevi( in lib/ app/ components/:");
for (const o of occorrenzeRicevi) console.log(`    ${o.file}:${o.riga}  ${o.testo}`);

// Il solo `.ricevi(` dell'app e' il modulo nativo di prossimita', non
// l'orologio: il difetto lo dice, e va confermato o smentito qui.
const riceviNonOrologio = occorrenzeRicevi.filter((o) => o.file === "lib/sync/vicinanza.ts");
const riceviAltrove = occorrenzeRicevi.filter((o) => o.file !== "lib/sync/vicinanza.ts");
verifica(
  "l'unico `.ricevi(` dell'app e' quello del modulo di prossimita'",
  riceviNonOrologio.length === occorrenzeRicevi.length,
  riceviAltrove.map((o) => `${o.file}:${o.riga} ${o.testo}`).join("\n        ")
);

// Criterio 2 — l'obiezione seria: una chiamata puo' non assomigliare a
// `.ricevi(`. Ma per chiamarla bisogna avere in mano un Orologio, e un
// Orologio si ottiene solo importando lib/hlc.ts. Quindi l'insieme dei file
// che POTREBBERO chiamarla e' chiuso e piccolo: si controlla quello.
const importaHlc = FILE_APP.filter((f) => {
  const t = readFileSync(f, "utf8");
  return /from\s+["'][^"']*\/hlc["']|from\s+["']\.\/hlc["']|require\(["'][^"']*hlc["']\)/.test(t);
});
const nomiImportaHlc = importaHlc.map((f) => relative(RADICE, f)).sort();
console.log(`  file che importano lib/hlc.ts: ${nomiImportaHlc.join(", ") || "(nessuno)"}`);
verifica(
  "solo lib/db.ts importa l'Orologio: l'insieme dei possibili chiamanti e' chiuso",
  nomiImportaHlc.length === 1 && nomiImportaHlc[0] === "lib/db.ts",
  nomiImportaHlc.join(", ")
);

// Criterio 3 — dentro lib/db.ts: l'istanza si chiama `orologio`. Si cerca
// QUALSIASI uso di quella variabile, non solo `.ricevi`, per leggere con gli
// occhi cosa l'app sa farle fare.
const testoDb = readFileSync(join(RADICE, "lib/db.ts"), "utf8");
const usiOrologio = [...testoDb.matchAll(/orologio\s*[?!]?\s*\.\s*(\w+)/g)].map((m) => m[1]);
const usiUnici = [...new Set(usiOrologio)].sort();
console.log(`  membri dell'Orologio usati da lib/db.ts: ${usiUnici.join(", ")}`);
verifica(
  "lib/db.ts non usa mai ricevi() sull'orologio, in nessuna forma",
  !usiUnici.includes("ricevi"),
  `usi trovati: ${usiUnici.join(", ")}`
);

// Criterio 4 — e se lib/db.ts esportasse l'orologio, lasciando che un altro
// file lo faccia avanzare? Si guarda la superficie esportata.
const esportati = [...testoDb.matchAll(/export\s+(?:async\s+)?(?:function|const|class)\s+(\w+)/g)]
  .map((m) => m[1])
  .sort();
console.log(`  superficie esportata di lib/db.ts: ${esportati.join(", ")}`);
verifica(
  "lib/db.ts non esporta l'Orologio ne' un modo per assorbire un HLC remoto",
  !esportati.includes("orologio") && !esportati.some((n) => /ricevi|assorbi|allinea/i.test(n)),
  esportati.join(", ")
);

// Criterio 5 — il punto indicato dal difetto (useAutoSync) e' l'unico posto
// dove arrivano eventi remoti. Si guarda cosa fa con gli HLC ricevuti.
const testoAuto = readFileSync(join(RADICE, "lib/sync/useAutoSync.ts"), "utf8");
verifica(
  "useAutoSync applica il pacchetto remoto (e' il punto dove l'orologio dovrebbe avanzare)",
  /r\.esito\.ricevuti/.test(testoAuto) && /INSERT OR IGNORE\s+INTO eventi/.test(testoAuto)
);
verifica(
  "...e in quel punto non nomina mai l'orologio",
  !/orologio|Orologio|hlc\b.*ricevi/i.test(testoAuto.replace(/\be\.hlc\b|hlc,/g, ""))
);

// =====================================================================
titolo("PARTE B — la conseguenza, su lib/hlc.ts e lib/sync/fusione.ts VERI");

const HLC = await import(new URL("../../lib/hlc.ts", import.meta.url).href);
const FUS = await import(new URL("../../lib/sync/fusione.ts", import.meta.url).href);

verifica("il metodo ricevi() esiste davvero (se no il difetto e' un altro)",
  typeof HLC.Orologio.prototype.ricevi === "function");

/**
 * Scenario. Telefono e tablet, come li usa l'utente di questo progetto.
 * Il tablet e' rimasto in modalita' aereo e il suo orologio di sistema e'
 * avanti di tre minuti: e' l'ipotesi dichiarata in testa a lib/hlc.ts
 * ("i due dispositivi possono avere ore di sistema diverse") ed e' la sola
 * ragione per cui un HLC serve al posto di Date.now().
 */
const T0 = 1_760_000_000_000;
const DERIVA_TABLET = 180_000; // tre minuti avanti

function eventoNota(hlcStr, dispositivo, testo) {
  return {
    id: `${hlcStr}:nota-1`,
    hlc: hlcStr,
    dispositivo,
    entita: "note",
    entita_id: "nota-1",
    tipo: "aggiorna",
    payload: JSON.stringify({ testo }),
  };
}

/** Il tablet scrive per primo, ma col suo orologio avanti. */
const orolTablet = new HLC.Orologio("tablet");
const hlcTablet = HLC.serializza(orolTablet.adesso(T0 + DERIVA_TABLET));
const evTablet = eventoNota(hlcTablet, "tablet", "versione del tablet");

/**
 * Il telefono ha gia' una sua storia (un evento precedente), poi riceve il
 * pacchetto del tablet, poi — DIECI SECONDI DOPO in tempo reale, quindi
 * l'ultima parola dell'utente — riscrive lo stesso campo.
 * Due orologi identici: uno si comporta come l'app oggi, l'altro chiama il
 * `ricevi()` vero. Nient'altro cambia.
 */
function corsa(chiamaRicevi) {
  const orol = new HLC.Orologio("telefono");
  const hlcPrimo = HLC.serializza(orol.adesso(T0));
  const evPrimo = eventoNota(hlcPrimo, "telefono", "prima stesura");

  if (chiamaRicevi) orol.ricevi(HLC.deserializza(evTablet.hlc), T0 + 10_000);

  const hlcDopo = HLC.serializza(orol.adesso(T0 + 10_000));
  const evDopo = eventoNota(hlcDopo, "telefono", "versione del telefono");

  const esito = FUS.fondi([evPrimo, evDopo], [evTablet]);
  const stato = FUS.proietta([evPrimo, evDopo, ...esito.nuovi], "note", "nota-1");
  return { hlcDopo, stato, esito };
}

const senza = corsa(false);
const con = corsa(true);

console.log(`  hlc del tablet (orologio avanti) : ${evTablet.hlc}`);
console.log(`  hlc locale SENZA ricevi()        : ${senza.hlcDopo}`);
console.log(`  hlc locale CON   ricevi()        : ${con.hlcDopo}`);
console.log(`  testo proiettato SENZA ricevi()  : ${JSON.stringify(senza.stato?.testo)}`);
console.log(`  testo proiettato CON   ricevi()  : ${JSON.stringify(con.stato?.testo)}`);

verifica(
  "SENZA ricevi(): il timbro locale resta MINORE di quello remoto gia' visto",
  senza.hlcDopo < evTablet.hlc,
  `${senza.hlcDopo} vs ${evTablet.hlc}`
);
verifica(
  "SENZA ricevi(): la modifica piu' recente dell'utente PERDE nella fusione",
  senza.stato?.testo === "versione del tablet",
  `proiettato: ${JSON.stringify(senza.stato?.testo)}`
);
verifica(
  "CON ricevi(): il timbro locale supera quello remoto",
  con.hlcDopo > evTablet.hlc,
  `${con.hlcDopo} vs ${evTablet.hlc}`
);
verifica(
  "CON ricevi(): la modifica piu' recente VINCE — la sola differenza e' la chiamata",
  con.stato?.testo === "versione del telefono",
  `proiettato: ${JSON.stringify(con.stato?.testo)}`
);
verifica(
  "il vincitore CAMBIA fra le due corse (se no il difetto sarebbe innocuo)",
  senza.stato?.testo !== con.stato?.testo
);

// Controllo di onesta': senza deriva il difetto NON deve mordere. Se mordesse
// comunque, vorrebbe dire che sto misurando altro.
{
  const orolPari = new HLC.Orologio("tablet");
  const hlcPari = HLC.serializza(orolPari.adesso(T0)); // nessuna deriva
  const evPari = eventoNota(hlcPari, "tablet", "versione del tablet");
  const orol = new HLC.Orologio("telefono");
  const evDopo = eventoNota(HLC.serializza(orol.adesso(T0 + 10_000)), "telefono", "versione del telefono");
  const stato = FUS.proietta([evPari, evDopo], "note", "nota-1");
  verifica(
    "con orologi allineati la modifica locale vince gia' oggi (il difetto e' condizionato alla deriva)",
    stato?.testo === "versione del telefono"
  );
}

// =====================================================================
titolo("PARTE C — end-to-end su lib/db.ts vero, verdetto letto da FUORI");

const cartella = mkdtempSync(join(tmpdir(), "controprova-hlc02-"));
configuraCartella(cartella);
let percorsoFile = null;

try {
  const DB = await import(new URL("../../lib/db.ts", import.meta.url).href);
  await DB.apri("telefono");
  percorsoFile = join(cartella, "percorso.db");

  const proiezioneNota = (testo) => async (d, hlc) => {
    await d.runAsync(
      `INSERT INTO note (id, titolo, testo, creato_a, hlc) VALUES (?,?,?,?,?)
       ON CONFLICT (id) DO UPDATE SET testo = excluded.testo, hlc = excluded.hlc`,
      ["nota-1", "Nota di prova", testo, new Date(T0).toISOString(), hlc]
    );
  };

  // 1. L'utente scrive sul telefono.
  await DB.registra("note", "nota-1", "crea", { testo: "prima stesura" }, proiezioneNota("prima stesura"));

  // 2. Arriva il pacchetto del tablet, col suo orologio avanti. Si riproduce
  //    ESATTAMENTE il passaggio di lib/sync/useAutoSync.ts:54-63: gli eventi
  //    remoti entrano in transazione e nessuno tocca l'orologio.
  const hlcRemoto = HLC.serializza({ ms: Date.now() + DERIVA_TABLET, contatore: 0, dispositivo: "tablet" });
  await DB.inTransazione(async (d) => {
    await d.runAsync(
      `INSERT OR IGNORE INTO eventi
       (id, hlc, dispositivo, entita, entita_id, tipo, payload, sincronizzato)
       VALUES (?,?,?,?,?,?,?,1)`,
      [`${hlcRemoto}:nota-1`, hlcRemoto, "tablet", "note", "nota-1", "aggiorna",
       JSON.stringify({ testo: "versione del tablet" })]
    );
  });

  // 3. L'utente riscrive sul telefono DOPO aver ricevuto: e' l'ultima parola.
  await DB.registra("note", "nota-1", "aggiorna", { testo: "versione del telefono" },
    proiezioneNota("versione del telefono"));

  // --- verdetto letto da una SECONDA connessione allo stesso file, fuori dal
  //     banco: cosi' non si sta credendo alla parola del doppio.
  const fuori = new DatabaseSync(percorsoFile);
  const righe = fuori.prepare(
    "SELECT id, hlc, dispositivo, entita, entita_id, tipo, payload FROM eventi ORDER BY hlc"
  ).all();
  const metaHlc = fuori.prepare("SELECT valore FROM meta WHERE chiave = 'hlc'").get();
  fuori.close();

  const evLocaleDopo = righe.find((r) => r.payload.includes("versione del telefono"));
  const evRemoto = righe.find((r) => r.dispositivo === "tablet");

  console.log(`  eventi sul file: ${righe.length}`);
  console.log(`  hlc remoto (tablet) : ${evRemoto?.hlc}`);
  console.log(`  hlc locale (dopo)   : ${evLocaleDopo?.hlc}`);
  console.log(`  meta.hlc persistito : ${metaHlc?.valore}`);

  verifica("il pacchetto remoto e l'evento locale sono entrambi sul file",
    Boolean(evRemoto && evLocaleDopo));
  verifica(
    "sul file, il timbro locale PIU' RECENTE e' minore di quello remoto gia' applicato",
    evLocaleDopo && evRemoto && evLocaleDopo.hlc < evRemoto.hlc,
    `${evLocaleDopo?.hlc} vs ${evRemoto?.hlc}`
  );

  // Il punto che decide la gravita': lo stato persistito recupera da solo?
  // meta.hlc e' cio' che lib/db.ts:110-121 ricarica all'avvio. Se contenesse
  // il tempo remoto, il difetto durerebbe una sessione e non sarebbe critico.
  const msPersistito = parseInt(String(metaHlc?.valore).split("-")[0], 16);
  const msRemoto = HLC.deserializza(evRemoto.hlc).ms;
  verifica(
    "meta.hlc NON ha assorbito il tempo remoto: nemmeno un riavvio recupera",
    Number.isFinite(msPersistito) && msPersistito < msRemoto,
    `persistito ${msPersistito} vs remoto ${msRemoto}`
  );

  // La fusione vera, alimentata dalle righe lette da fuori.
  const statoFuso = FUS.proietta(righe, "note", "nota-1");
  console.log(`  proiezione dal registro: ${JSON.stringify(statoFuso?.testo)}`);
  verifica(
    "ricostruendo dal registro (la fonte di verita' dichiarata) vince il tablet",
    statoFuso?.testo === "versione del tablet",
    `proiettato: ${JSON.stringify(statoFuso?.testo)}`
  );

  // E la tabella operativa dice il contrario: le due facce divergono.
  const fuori2 = new DatabaseSync(percorsoFile);
  const notaTab = fuori2.prepare("SELECT testo FROM note WHERE id = 'nota-1'").get();
  fuori2.close();
  console.log(`  tabella operativa note : ${JSON.stringify(notaTab?.testo)}`);
  verifica(
    "la tabella operativa e il registro non concordano piu' sullo stesso campo",
    notaTab?.testo !== statoFuso?.testo,
    `tabella ${JSON.stringify(notaTab?.testo)} vs registro ${JSON.stringify(statoFuso?.testo)}`
  );
} finally {
  rmSync(cartella, { recursive: true, force: true });
}

// =====================================================================
titolo("PARTE D — effetto deterministico: la spia di deriva e' morta");

/**
 * Questo non dipende da nessuna ipotesi sugli orologi. `derivaRilevata` viene
 * scritta SOLO dentro ricevi() (lib/hlc.ts:80). Se ricevi() non e' mai
 * chiamata, `derivaSospetta` non puo' diventare vera, e il riquadro di
 * app/(tabs)/oggi.tsx:79 non si accende mai — proprio nel caso che dovrebbe
 * segnalare. E' la stessa causa radice, ma con conseguenza certa.
 */
const testoHlc = readFileSync(join(RADICE, "lib/hlc.ts"), "utf8");
const scrittureDeriva = [...testoHlc.matchAll(/this\.derivaRilevata\s*=/g)].length;
const dentroRicevi = testoHlc.slice(testoHlc.indexOf("ricevi(remoto"));
verifica(
  "derivaRilevata ha una sola scrittura in tutto lib/hlc.ts",
  scrittureDeriva === 1,
  `scritture: ${scrittureDeriva}`
);
verifica(
  "...e sta dentro ricevi()",
  /this\.derivaRilevata\s*=/.test(dentroRicevi.slice(0, dentroRicevi.indexOf("get derivaSospetta")))
);

const testoOggi = readFileSync(join(RADICE, "app/(tabs)/oggi.tsx"), "utf8");
verifica(
  "app/(tabs)/oggi.tsx mostra davvero un riquadro condizionato a derivaSospetta()",
  /derivaSospetta\(\)\s*\?/.test(testoOggi)
);

{
  // Prova viva: un orologio che vive come quello dell'app non segnala mai.
  const comeApp = new HLC.Orologio("telefono");
  for (let i = 0; i < 50; i++) comeApp.adesso(T0 + i * 1000);
  const comeDovrebbe = new HLC.Orologio("telefono");
  comeDovrebbe.ricevi({ ms: T0 + 600_000, contatore: 0, dispositivo: "tablet" }, T0);
  verifica(
    "orologio usato come fa l'app (solo adesso()): deriva mai sospetta",
    comeApp.derivaSospetta === false
  );
  verifica(
    "stesso orologio con ricevi(): dieci minuti di deriva vengono segnalati",
    comeDovrebbe.derivaSospetta === true
  );
}

// =====================================================================
console.log(`\n${"=".repeat(60)}`);
console.log(`verdi: ${verdi}   ROSSE: ${rosse}`);
console.log(rosse === 0
  ? "HLC-02: riprodotto in modo indipendente. NON confutato."
  : "HLC-02: qualche verifica non regge — leggere le rosse.");
process.exit(rosse === 0 ? 0 : 1);
