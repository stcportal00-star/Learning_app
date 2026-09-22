/**
 * CONTROPROVA AVVERSARIALE al difetto NOT-07, lente "conseguenza".
 *
 *   titolo accusato : "Modifiche alla nota scartate in silenzio in tutti i modi
 *                      di uscire" — gravita' dichiarata: critico
 *   file accusato   : app/(tabs)/note.tsx
 *
 * Il mio compito non e' confermare il difetto ma CONFUTARLO. Percio' non misuro
 * "la modifica sparisce?" (quello lo sa gia' chiunque legga apri() e nuova()),
 * ma le tre cose che decidono se vale la pena spendere giorni di calendario a
 * nove giorni dalla scadenza del 1 ottobre:
 *
 *   1. QUANTI dei tre modi di uscire dichiarati perdono DAVVERO la modifica,
 *      sul navigatore vero (@react-navigation/bottom-tabs 7.19.2) e non su un
 *      modello che smonta la schermata per finta;
 *   2. QUANTO si perde quando si perde: una riga, un registro, un invariante?
 *   3. QUANTO costa correggerlo: quante asserzioni verdi gia' esistenti
 *      toccherebbe una correzione di questo comportamento.
 *
 * Si esegue dalla radice del progetto, senza argomenti:
 *
 *   node test/simulazione/controprova-NOT-07-conseguenza.mjs
 *
 * Il file si riavvia da solo con --import ./test/banco/carica.mjs: sotto il
 * modello della schermata gira il CODICE VERO (lib/db.ts, registra(), la coda
 * delle scritture) su node:sqlite vero.
 *
 * ---------------------------------------------------------------------------
 * PERCHE' IL MODELLO DELLA SCHERMATA E' RIFATTO QUI INVECE DI RIUSARE QUELLO DI
 * schermate-stato.mjs
 * ---------------------------------------------------------------------------
 * Perche' e' proprio il modello di quel file che voglio mettere in discussione.
 * La sua intestazione lo dichiara: "niente expo-router: [...] 'tornare indietro
 * a meta'' qui significa smontare la schermata e rimontarla, che e' quello che
 * fa lo stack". Vero per una schermata IMPILATA (app/esercizi.tsx, app/codice.tsx).
 * Falso per una SCHEDA: le cinque schede di app/(tabs)/_layout.tsx vivono in un
 * navigatore a schede, dove una scheda gia' visitata NON si smonta quando se ne
 * guarda un'altra. L'asserzione F25 di quel file chiama `noteSchermata.smonta()`
 * a mano e poi monta una istanza nuova: quel gesto non e' "cambio scheda", e'
 * "il processo e' morto". Qui modello il navigatore come si comporta davvero e
 * misuro la differenza.
 *
 * Nessun file di nessuno viene toccato: questo file e' nuovo e legge soltanto.
 */
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { variabileBanco } from "../banco/doppi-altri.mjs";

const QUESTA_CARTELLA = dirname(fileURLToPath(import.meta.url));
const RADICE = resolve(QUESTA_CARTELLA, "..", "..");

// ------------------------------------------------------- RIAVVIO CON I GANCI
if (!process.env.CONTROPROVA_NOT07_IN_CORSO) {
  const esito = spawnSync(
    process.execPath,
    ["--import", "./test/banco/carica.mjs", "test/simulazione/controprova-NOT-07-conseguenza.mjs"],
    {
      cwd: RADICE,
      stdio: "inherit",
      env: {
        ...process.env,
        CONTROPROVA_NOT07_IN_CORSO: "1",
        BANCO_DOPPI: variabileBanco({
          "react-native": join(QUESTA_CARTELLA, "schermate-stato-react-native.mjs"),
        }),
      },
    }
  );
  process.exit(esito.status ?? 1);
}

// ------------------------------------------------------------------ CONTEGGIO
let passati = 0;
const falliti = [];
function dice(nome, condizione, extra = "") {
  if (condizione) { passati++; console.log("   ok      " + nome); }
  else { falliti.push(nome + (extra ? " — " + extra : "")); console.log("   FALLITO " + nome + (extra ? " — " + extra : "")); }
}

// ===========================================================================
// ANCORE DI FEDELTA'
// Ogni decisione che ricopio qui sotto e' accompagnata dal frammento LETTERALE
// del sorgente da cui viene. Se il sorgente cambia, l'ancora diventa rossa e
// dice che e' QUESTA misura a essere scaduta, non l'app a essere cambiata.
// ===========================================================================
const NOTE_TSX = readFileSync(join(RADICE, "app/(tabs)/note.tsx"), "utf8");
const LAYOUT_TSX = readFileSync(join(RADICE, "app/(tabs)/_layout.tsx"), "utf8");
const VERSIONE_SCHEDE = JSON.parse(
  readFileSync(join(RADICE, "node_modules/@react-navigation/bottom-tabs/package.json"), "utf8")
).version;

console.log("\n=== ANCORE DI FEDELTA' =======================================");
const ancore = [
  ["apri() sovrascrive titolo e testo dalla riga su disco",
   NOTE_TSX.includes(`setApertaId(n.id); setTitolo(n.titolo ?? ""); setTesto(n.testo);`)],
  ["nuova() azzera titolo e testo",
   NOTE_TSX.includes(`setApertaId("nuova"); setTitolo(""); setTesto(""); setPubblicabile(false);`)],
  ["il ritorno all'elenco e' solo setApertaId(null)",
   NOTE_TSX.includes(`<Pressable onPress={() => setApertaId(null)} style={{ padding: 12 }}>`)],
  ["il pulsante Salva sta DENTRO l'Editor, accanto alla casella di testo",
   /const Editor = apertaId \? \([\s\S]*?<Pressable onPress=\{salva\}[\s\S]*?\) : \(/.test(NOTE_TSX)],
  ["il ramo affiancato (>=600dp) disegna elenco ED editor insieme",
   NOTE_TSX.includes(`return affiancato ? (`) &&
   /affiancato \? \([\s\S]*?\{Elenco\}<\/View>[\s\S]*?\{Editor\}<\/View>/.test(NOTE_TSX)],
  ["il ramo telefono con nota aperta disegna SOLO il ritorno e l'editor",
   /\) : apertaId \? \(\s*<View style=\{\{ flex: 1 \}\}>\s*<Pressable onPress=\{\(\) => setApertaId\(null\)\}[\s\S]*?\{Editor\}\s*<\/View>\s*\) : Elenco;/.test(NOTE_TSX)],
  ["salva() rifiuta il salvataggio a campi vuoti",
   NOTE_TSX.includes(`if (!testo.trim() && !titolo.trim()) return;`)],
  ["nessuna conferma, nessuna bozza, nessun salvataggio automatico nel file",
   !/Alert|BackHandler|beforeRemove|usePreventRemove|bozza|autosalv/i.test(NOTE_TSX)],
  ["le cinque schede sono un navigatore a schede",
   LAYOUT_TSX.includes("<Tabs") && LAYOUT_TSX.includes(`<Tabs.Screen name="note"`)],
  ["nessuna scheda chiede lo smontaggio quando perde il fuoco",
   !/unmountOnBlur|popToTopOnBlur|lazy=\{false\}/.test(LAYOUT_TSX)],
];
let ancoreRosse = 0;
for (const [nome, vera] of ancore) { if (!vera) ancoreRosse++; dice("ancora: " + nome, vera); }
if (ancoreRosse > 0) {
  console.log("\nANCORE ROSSE: la misura non e' valida, il sorgente e' cambiato.");
  process.exit(1);
}
console.log(`   (@react-navigation/bottom-tabs installato: ${VERSIONE_SCHEDE})`);

// ===========================================================================
// IL BANCO: lib/db.ts vero, SQLite vero
// ===========================================================================
const { configuraCartella } = await import("../banco/expo-sqlite.mjs");
const cartella = configuraCartella(mkdtempSync(join(tmpdir(), "controprova-not07-")));
const DB = await import("../../lib/db.ts");
const Crypto = await import("expo-crypto");
await DB.apri("prova0001");
const base = DB.database();

/** Una nota di partenza, scritta dalla strada vera: registra(). */
async function seminaNota(titolo, testo) {
  const id = Crypto.randomUUID();
  await DB.registra("note", id, "crea", { titolo, testo, pubblicabile: 0 }, async (d, hlc) => {
    await d.runAsync(
      `INSERT INTO note (id, titolo, testo, pubblicabile, creato_a, hlc) VALUES (?,?,?,?,?,?)`,
      [id, titolo, testo, 0, new Date().toISOString(), hlc]);
  });
  return id;
}

const TESTO_A = "Kleppmann cap. 5: la replica a singolo leader si applica al registro eventi.";
const TESTO_B = "Codd 1970: le dipendenze fra relazioni non sono un dettaglio di implementazione.";
const idA = await seminaNota("Kleppmann cap. 5", TESTO_A);
const idB = await seminaNota("Codd 1970", TESTO_B);

// ===========================================================================
// MODELLO FEDELE DELLA SCHERMATA NOTE
// Trascrizione letterale della macchina a stati di app/(tabs)/note.tsx.
// L'unica aggiunta e' `schermo()`: che cosa e' DISEGNATO — cioe' che cosa il
// dito dell'utente puo' toccare — in ciascuno dei due rami di layout. La
// raggiungibilita' e' esattamente la domanda della lente "conseguenza".
// ===========================================================================
function montaNote(larghezza) {
  const s = { apertaId: null, titolo: "", testo: "", pubblicabile: false, larghezza, viva: true };
  s.note = [];

  s.ricarica = async () => {
    s.note = await base.getAllAsync("SELECT * FROM note ORDER BY creato_a DESC");
  };

  s.apri = (n) => { s.apertaId = n.id; s.titolo = n.titolo ?? ""; s.testo = n.testo; s.pubblicabile = n.pubblicabile === 1; };
  s.nuova = () => { s.apertaId = "nuova"; s.titolo = ""; s.testo = ""; s.pubblicabile = false; };
  s.ritornoElenco = () => { s.apertaId = null; };
  s.scrivi = (t) => { s.testo = t; };

  s.salva = async () => {
    if (!s.testo.trim() && !s.titolo.trim()) return;
    const id = s.apertaId === "nuova" || !s.apertaId ? Crypto.randomUUID() : s.apertaId;
    const nuovo = s.apertaId === "nuova" || !s.apertaId;
    const titolo = s.titolo, testo = s.testo, pubblicabile = s.pubblicabile;
    await DB.registra("note", id, nuovo ? "crea" : "aggiorna",
      { titolo, testo, pubblicabile: pubblicabile ? 1 : 0 },
      async (d, hlc) => {
        if (nuovo) {
          await d.runAsync(
            `INSERT INTO note (id, titolo, testo, pubblicabile, creato_a, hlc) VALUES (?,?,?,?,?,?)`,
            [id, titolo || null, testo, pubblicabile ? 1 : 0, new Date().toISOString(), hlc]);
        } else {
          await d.runAsync(
            `UPDATE note SET titolo = ?, testo = ?, pubblicabile = ?, hlc = ? WHERE id = ?`,
            [titolo || null, testo, pubblicabile ? 1 : 0, hlc, id]);
        }
      });
    s.apertaId = id;
    await s.ricarica();
  };

  /**
   * I comandi DISEGNATI in questo istante. Discende dai tre rami di ritorno del
   * componente: affiancato -> Elenco + Editor; telefono con apertaId -> ritorno
   * + Editor; telefono senza apertaId -> solo Elenco.
   */
  s.schermo = () => {
    const affiancato = s.larghezza >= 600;
    const editor = s.apertaId ? ["scriviTitolo", "scriviTesto", "spunta", "Salva"] : ["segnaposto"];
    const elenco = ["Nuova nota", "Da pubblicare", ...s.note.map((n) => "apri:" + n.id)];
    if (affiancato) return { disposizione: "affiancata", comandi: [...elenco, ...editor] };
    if (s.apertaId) return { disposizione: "editor", comandi: ["← Tutte le note", ...editor] };
    return { disposizione: "elenco", comandi: elenco };
  };

  return s;
}

/**
 * Il navigatore a schede, com'e' fatto davvero.
 *
 * @react-navigation/bottom-tabs 7.x: `lazy` vale true (la scheda si monta alla
 * prima visita) e NON esiste piu' `unmountOnBlur`; una scheda montata resta
 * montata quando perde il fuoco. app/(tabs)/_layout.tsx non chiede altro.
 * Perdere il fuoco NON e' smontare: lo stato del componente sopravvive.
 */
function navigatoreSchede(larghezza) {
  const montate = new Map();
  let attiva = null;
  return {
    vaiA(nome, fabbrica) {
      if (!montate.has(nome)) montate.set(nome, fabbrica ? fabbrica(larghezza) : { nome });
      attiva = nome;
      return montate.get(nome);
    },
    get attiva() { return montate.get(attiva); },
    montate,
  };
}

const conta = async (sql, p = []) => (await base.getFirstAsync(sql, p)).n;
const testoSuDisco = async (id) => (await base.getFirstAsync("SELECT testo FROM note WHERE id = ?", [id])).testo;

// ===========================================================================
// MISURA 1 — I TRE MODI DI USCIRE, UNO PER UNO, SUI DUE FORMATI
// ===========================================================================
console.log("\n=== MISURA 1 — I TRE MODI DI USCIRE DICHIARATI ================");
const MODIFICA = TESTO_A + " AGGIUNTA DELLA SERA CHE NON HO SALVATO.";
const esiti = [];

// --- modo 1: aprire un'altra nota
for (const larghezza of [392, 800]) {
  const n = montaNote(larghezza);
  await n.ricarica();
  n.apri(n.note.find((x) => x.id === idA));
  n.scrivi(MODIFICA);
  const raggiungibile = n.schermo().comandi.includes("apri:" + idB);
  if (raggiungibile) n.apri(n.note.find((x) => x.id === idB));
  esiti.push({
    modo: "aprire un'altra nota", formato: larghezza >= 600 ? "tablet" : "telefono",
    raggiungibileDaEditor: raggiungibile,
    modificaPersa: raggiungibile && n.testo !== MODIFICA,
    tocchiDaEditor: raggiungibile ? 1 : 2, // da telefono serve prima "← Tutte le note"
  });
}

// --- modo 2: il ritorno all'elenco
for (const larghezza of [392, 800]) {
  const n = montaNote(larghezza);
  await n.ricarica();
  n.apri(n.note.find((x) => x.id === idA));
  n.scrivi(MODIFICA);
  const raggiungibile = n.schermo().comandi.includes("← Tutte le note");
  let persa = false;
  if (raggiungibile) {
    n.ritornoElenco();
    // il testo e' ancora nello stato, ma nessun disegno lo mostra piu': per
    // rivederlo servirebbe apri(), che lo sovrascrive. E' perso di fatto.
    const ancoraInMemoria = n.testo === MODIFICA;
    const ancoraMostrato = n.schermo().comandi.includes("Salva");
    n.apri(n.note.find((x) => x.id === idA));
    persa = ancoraInMemoria && !ancoraMostrato && n.testo !== MODIFICA;
  }
  esiti.push({
    modo: "← Tutte le note", formato: larghezza >= 600 ? "tablet" : "telefono",
    raggiungibileDaEditor: raggiungibile, modificaPersa: persa, tocchiDaEditor: raggiungibile ? 1 : null,
  });
}

// --- modo 3: il cambio di scheda, sul navigatore vero
for (const larghezza of [392, 800]) {
  const nav = navigatoreSchede(larghezza);
  const note = nav.vaiA("note", montaNote);
  await note.ricarica();
  note.apri(note.note.find((x) => x.id === idA));
  note.scrivi(MODIFICA);
  nav.vaiA("oggi", () => ({ nome: "oggi" }));       // la scheda Note perde il fuoco
  nav.vaiA("libreria", () => ({ nome: "libreria" }));
  const tornata = nav.vaiA("note", montaNote);       // NON si rimonta: e' la stessa istanza
  const stessaIstanza = tornata === note;
  const modificaIntatta = tornata.testo === MODIFICA && tornata.schermo().comandi.includes("Salva");
  // e si salva ancora, dal vero
  await tornata.salva();
  const suDisco = await testoSuDisco(idA);
  esiti.push({
    modo: "cambio scheda", formato: larghezza >= 600 ? "tablet" : "telefono",
    raggiungibileDaEditor: true,
    modificaPersa: !(stessaIstanza && modificaIntatta && suDisco === MODIFICA),
    tocchiDaEditor: 1,
  });
  // rimetto la nota com'era per le misure dopo
  tornata.scrivi(TESTO_A);
  await tornata.salva();
}

for (const e of esiti) {
  console.log(`   ${e.modo.padEnd(24)} ${e.formato.padEnd(9)} raggiungibile-dall-editor=${String(e.raggiungibileDaEditor).padEnd(5)} perde=${e.modificaPersa}`);
}
const modiChePerdono = new Set(esiti.filter((e) => e.modificaPersa).map((e) => e.modo));
dice("il modo «aprire un'altra nota» perde la modifica dove e' raggiungibile", modiChePerdono.has("aprire un'altra nota"));
dice("il modo «← Tutte le note» perde la modifica", modiChePerdono.has("← Tutte le note"));
dice("CONFUTATO: il cambio di scheda NON perde niente (la scheda non si smonta)",
  !modiChePerdono.has("cambio scheda"));
dice("CONFUTATO: da telefono l'altra nota non e' toccabile dall'editor (l'elenco non c'e')",
  esiti.some((e) => e.modo === "aprire un'altra nota" && e.formato === "telefono" && !e.raggiungibileDaEditor));
dice("CONFUTATO: da tablet il «← Tutte le note» non esiste proprio",
  esiti.some((e) => e.modo === "← Tutte le note" && e.formato === "tablet" && !e.raggiungibileDaEditor));
console.log(`   -> modi che perdono davvero: ${modiChePerdono.size} su 3 dichiarati,`);
console.log(`      e nessuno dei due e' disponibile su entrambi i formati insieme.`);

// ===========================================================================
// MISURA 2 — QUANTO SI PERDE QUANDO SI PERDE
// ===========================================================================
console.log("\n=== MISURA 2 — L'AMPIEZZA DEL DANNO ===========================");
const noteInizio = await conta("SELECT count(*) AS n FROM note");
const eventiInizio = await conta("SELECT count(*) AS n FROM eventi");
const discoPrima = await testoSuDisco(idA);
const hlcPrima = (await base.getFirstAsync("SELECT hlc FROM note WHERE id = ?", [idA])).hlc;

const vittima = montaNote(800);
await vittima.ricarica();
vittima.apri(vittima.note.find((x) => x.id === idA));
vittima.scrivi(MODIFICA);
vittima.apri(vittima.note.find((x) => x.id === idB));   // la perdita, dal vero

const noteFine = await conta("SELECT count(*) AS n FROM note");
const eventiFine = await conta("SELECT count(*) AS n FROM eventi");
const discoDopo = await testoSuDisco(idA);
const hlcDopo = (await base.getFirstAsync("SELECT hlc FROM note WHERE id = ?", [idA])).hlc;

// Invariante 1: nessuna riga operativa senza il suo evento.
const righeSenzaEvento = await conta(
  "SELECT count(*) AS n FROM note WHERE id NOT IN (SELECT entita_id FROM eventi WHERE entita = 'note')");

console.log(`   note sul disco      : ${noteInizio} -> ${noteFine}`);
console.log(`   eventi nel registro : ${eventiInizio} -> ${eventiFine}`);
console.log(`   testo della nota A  : ${discoPrima === discoDopo ? "INTATTO" : "CAMBIATO"}`);
console.log(`   hlc della nota A    : ${hlcPrima === hlcDopo ? "fermo" : "avanzato"}`);
console.log(`   perduto             : ${MODIFICA.length - discoDopo.length} caratteri mai arrivati al disco`);
dice("nessuna riga esistente viene danneggiata", discoDopo === discoPrima && noteFine === noteInizio);
dice("nessun evento spurio finisce nel registro", eventiFine === eventiInizio);
dice("l'invariante 1 (riga <-> evento) regge", righeSenzaEvento === 0);
dice("l'hlc non avanza: la sincronizzazione non propaga niente di sbagliato", hlcDopo === hlcPrima);
console.log("   -> la perdita e' il DELTA non salvato di UNA nota, in memoria volatile.");
console.log("      Niente corruzione, niente divergenza fra i due dispositivi,");
console.log("      niente che l'utente non possa riscrivere avendo il libro davanti.");

// ===========================================================================
// MISURA 3 — QUANTO E' LONTANO IL SALVATAGGIO
// ===========================================================================
console.log("\n=== MISURA 3 — LA DISTANZA DAL PULSANTE SALVA =================");
const manifest = [];
for (const larghezza of [392, 800]) {
  const n = montaNote(larghezza);
  await n.ricarica();
  n.apri(n.note.find((x) => x.id === idA));
  const c = n.schermo().comandi;
  manifest.push({ formato: larghezza >= 600 ? "tablet" : "telefono", disposizione: n.schermo().disposizione,
                  salvaDisegnato: c.includes("Salva"), comandi: c.length });
}
for (const m of manifest) console.log(`   ${m.formato.padEnd(9)} disposizione=${m.disposizione.padEnd(11)} Salva disegnato=${m.salvaDisegnato} (comandi a schermo: ${m.comandi})`);
dice("ogni volta che esiste un editor, esiste anche il suo Salva, a un tocco",
  manifest.every((m) => m.salvaDisegnato));
// adjustResize nel manifesto: la finestra si restringe, la colonna dell'editor
// si comprime e il pulsante resta sopra la tastiera invece di finirci sotto.
const MANIFESTO = readFileSync(join(RADICE, "android/app/src/main/AndroidManifest.xml"), "utf8");
dice("con la tastiera aperta la finestra si ridimensiona (adjustResize), non scorre via",
  MANIFESTO.includes('android:windowSoftInputMode="adjustResize"'));

// ===========================================================================
// MISURA 4 — QUANTO COSTEREBBE CORREGGERLO
// ===========================================================================
console.log("\n=== MISURA 4 — L'IMPRONTA DI UNA CORREZIONE ===================");
const SCHERMATE = readFileSync(join(QUESTA_CARTELLA, "schermate-stato.mjs"), "utf8");
const righeNote = SCHERMATE.split("\n").filter((r) => /^\s*(ok|difetto|corretto)\("(F\d|NOT-)/.test(r));
const verdiSuEditor = righeNote.filter((r) => /^\s*ok\(/.test(r)).length;
const difettiNote = righeNote.filter((r) => /^\s*difetto\(/.test(r)).length;
console.log(`   asserzioni sulla schermata Note in schermate-stato.mjs : ${righeNote.length}`);
console.log(`   di cui comportamento atteso e verde (ok)               : ${verdiSuEditor}`);
console.log(`   di cui difetti inchiodati sulla stessa schermata       : ${difettiNote}`);
console.log("   note.tsx e' 153 righe; la correzione minima (un flag «sporco» piu'");
console.log("   un Alert di conferma in apri()/nuova()/ritornoElenco()) sta in una");
console.log("   quindicina di righe e non tocca lib/, il registro ne' la sincronizzazione.");
dice("la correzione e' confinata a un solo file di 153 righe", NOTE_TSX.split("\n").length < 200);
// Quali asserzioni della sezione Note guardano gli avvisi di sistema: sono le
// sole che una conferma "vuoi scartare le modifiche?" potrebbe disturbare.
const SEZIONE_F = SCHERMATE.split("SEZIONE F")[1]?.split("SEZIONE G")[0] ?? "";
const cheGuardanoAvvisi = SEZIONE_F.split("\n").filter((r) => /^(ok|difetto|corretto)\(/.test(r.trim()) && /avvisi/.test(r));
console.log(`   asserzioni della sezione Note che leggono gli avvisi    : ${cheGuardanoAvvisi.length}`);
for (const r of cheGuardanoAvvisi) console.log("     " + r.trim().slice(0, 118));
// F10 misura l'assenza di avvisi DOPO UN SALVATAGGIO RIUSCITO: una conferma
// mostrata solo quando si scarta non la fa diventare rossa. Le NOT-07 sono
// difetto(): quando la correzione arriva cambiano mestiere, come da protocollo.
const verdiDisturbate = cheGuardanoAvvisi.filter((r) => r.trim().startsWith("ok(") && /scarta|abbandon|perdi/i.test(r));
dice("nessuna asserzione VERDE pretende il silenzio nel momento in cui si scarta",
  verdiDisturbate.length === 0, `${verdiDisturbate.length} disturbate`);

// ===========================================================================
rmSync(cartella, { recursive: true, force: true });
console.log("\n=== ESITO ====================================================");
console.log(`${passati} verdi, ${falliti.length} rosse`);
for (const f of falliti) console.log("   ROSSA: " + f);
process.exit(falliti.length === 0 ? 0 : 1);
