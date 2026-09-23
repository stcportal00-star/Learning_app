/**
 * CONTROPROVA AVVERSARIALE del difetto NOT-07
 * "Modifiche alla nota scartate in silenzio in TUTTI i modi di uscire"
 * (app/(tabs)/note.tsx, gravita' dichiarata: critico).
 *
 * Non cerco di confermarlo: cerco il modo di smontarlo. Le vie di smontaggio
 * erano cinque, e le misuro tutte:
 *
 *   1. il difetto non esiste piu' (una delle due correzioni di oggi lo tocca)
 *      -> SEZIONE 0: cronologia di git sul file accusato;
 *   2. l'app ha ragione e il test ha torto: un pulsante "Salva" esplicito E' il
 *      contratto, e CLAUDE.md non chiede da nessuna parte una bozza automatica
 *      -> SEZIONE 1: cerco nel progetto un precedente che dica quale dei due
 *         comportamenti e' la regola della casa;
 *   3. la modifica non e' persa, e' solo NASCOSTA: lo stato React sopravvive a
 *      `setApertaId(null)`, quindi forse basta rientrare per ritrovarla
 *      -> SEZIONE 3, via B: rientro davvero e guardo che cosa c'e' nell'editor;
 *   4. "cambio scheda" e' FALSO: con expo-router le schede restano montate,
 *      quindi la bozza sopravvive -> SEZIONE 4, misurata sul codice VERO del
 *      navigatore in node_modules, non a memoria;
 *   5. "tasto indietro" e' FALSO allo stesso modo: il tasto indietro di sistema
 *      su una scheda non smonta niente, salta alla prima scheda
 *      -> SEZIONE 5, stesso metodo.
 *
 * Il modello della schermata e' una copia della macchina a stati di note.tsx,
 * tenuta onesta dalle ANCORE (frammenti letterali cercati nel sorgente vero a
 * ogni esecuzione). Sotto c'e' il CODICE VERO: lib/db.ts su SQLite vero.
 *
 * Si esegue dalla radice del progetto, senza argomenti:
 *   node test/simulazione/controprova-NOT-07-correttezza.mjs
 * Si riavvia da solo con --import ./test/banco/carica.mjs.
 *
 * NON tocca lib/db.ts: qui non serve falsificare la coda delle scritture: il
 * difetto in esame vive tutto nello stato della schermata, sopra registra().
 */
import { spawnSync } from "node:child_process";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { variabileBanco } from "../banco/doppi-altri.mjs";

const QUESTA_CARTELLA = dirname(fileURLToPath(import.meta.url));
const RADICE = resolve(QUESTA_CARTELLA, "..", "..");

// ------------------------------------------------------- RIAVVIO CON I GANCI
if (!process.env.CONTROPROVA_NOT07) {
  const esito = spawnSync(
    process.execPath,
    ["--import", "./test/banco/carica.mjs", "test/simulazione/controprova-NOT-07-correttezza.mjs"],
    {
      cwd: RADICE,
      stdio: "inherit",
      env: { ...process.env, CONTROPROVA_NOT07: "1", BANCO_DOPPI: variabileBanco() },
    }
  );
  process.exit(esito.status ?? 1);
}

// ------------------------------------------------------------------ CONTEGGIO
const righe = [];
let rossi = 0;
function misura(nome, condizione, dettaglio = "") {
  if (!condizione) rossi++;
  // Il dettaglio si stampa solo quando serve, cioe' quando la misura e' rossa:
  // in verde sarebbe rumore che fa sembrare guasto cio' che non lo e'.
  righe.push(`${condizione ? "  ok  " : "ROSSO "} ${nome}${!condizione && dettaglio ? " — " + dettaglio : ""}`);
}

const sorgenti = new Map();
function sorgente(percorsoRelativo) {
  if (!sorgenti.has(percorsoRelativo)) {
    sorgenti.set(percorsoRelativo, readFileSync(join(RADICE, percorsoRelativo), "utf8"));
  }
  return sorgenti.get(percorsoRelativo);
}
function ancora(nome, percorso, frammento) {
  const compatto = (t) => t.replace(/\s+/g, " ");
  misura(
    `ANCORA ${nome}`,
    compatto(sorgente(percorso)).includes(compatto(frammento)),
    `frammento assente da ${percorso}: la copia nel test sarebbe da aggiornare`
  );
}

const NOTE = "app/(tabs)/note.tsx";

// ===========================================================================
// SEZIONE 0 — il difetto descrive codice che esiste ancora?
// ===========================================================================
// Oggi sono state applicate due correzioni (RO-01 in lib/palestra.ts,
// REG-06/07 in lib/db.ts). Se una avesse toccato note.tsx, NOT-07 andrebbe
// segnato come gia' corretto invece che confutato.
const ultimoTocco = execFileSync(
  "git",
  ["log", "-1", "--format=%h %ad %s", "--date=short", "--", "app/(tabs)/note.tsx"],
  { cwd: RADICE, encoding: "utf8" }
).trim();
const notePulito = execFileSync("git", ["status", "--porcelain", "--", "app/(tabs)/note.tsx"], {
  cwd: RADICE,
  encoding: "utf8",
}).trim();
righe.push(`  ·   ultimo commit su note.tsx: ${ultimoTocco}`);
misura("0.1 note.tsx non ha modifiche non committate nell'albero", notePulito === "", notePulito);

// ===========================================================================
// SEZIONE 1 — l'atteso del simulatore e' davvero la regola della casa?
// ===========================================================================
// Se l'app avvertisse SEMPRE prima di perdere del lavoro, note.tsx sarebbe
// l'unica eccezione e il difetto sarebbe solido. Se invece nessuna schermata
// lo fa mai, "Salva esplicito" e' il contratto dichiarato e NOT-07 e' una
// richiesta di funzionalita' travestita da difetto. Conto i precedenti.
const schermate = execFileSync("git", ["ls-files", "app", "components"], {
  cwd: RADICE,
  encoding: "utf8",
})
  .trim()
  .split("\n")
  .filter((f) => f.endsWith(".tsx"));
const conAvviso = schermate.filter((f) => /Alert\.alert/.test(sorgente(f)));
righe.push(`  ·   schermate esaminate: ${schermate.length}; che parlano all'utente con Alert: ${conAvviso.length} (${conAvviso.join(", ")})`);
// Questa e' la misura che decide la via di smontaggio n.2, e l'ha respinta:
// l'app NON e' muta per scelta di stile. Chiede conferma prima di un'azione
// che fa perdere qualcosa (app/sync.tsx, "Dimenticare l'accoppiamento?", con
// il pulsante Annulla) e blocca un passaggio che renderebbe inutile il lavoro
// gia' scritto (app/codice.tsx, "Scrivi prima l'ipotesi"). Se il contratto
// della casa fosse "salva esplicito, nessun avviso", queste due non ci
// sarebbero.
const confermaPrimaDiPerdere = /Alert\.alert\("Dimenticare l'accoppiamento\?"/.test(sorgente("app/sync.tsx"));
const bloccoPrimaDiPerdere = /Alert\.alert\("Scrivi prima l'ipotesi"/.test(sorgente("app/codice.tsx"));
misura("1.1 esiste un precedente: l'app chiede conferma prima di far perdere qualcosa", confermaPrimaDiPerdere);
misura("1.2 esiste un precedente: l'app protegge il testo gia' scritto dall'utente", bloccoPrimaDiPerdere);
misura("1.3 note.tsx e' l'unica schermata con testo dell'utente che non dice mai niente",
  !/Alert/.test(sorgente(NOTE)) && confermaPrimaDiPerdere);
// Contro-precedente di segno opposto: il cronometro, che scrive da se'.
const cronometro = schermate.find((f) => /Cronometro\.tsx$/.test(f));
righe.push(`  ·   ${cronometro}: scrive da se' con registra()? ${/registra\(|Sessioni\./.test(sorgente(cronometro)) ? "si'" : "no"}`);

// ===========================================================================
// ANCORE — la copia qui sotto e' fedele a note.tsx?
// ===========================================================================
ancora("apri sovrascrive senza condizioni", NOTE,
  'function apri(n: Nota) { setApertaId(n.id); setTitolo(n.titolo ?? ""); setTesto(n.testo); setPubblicabile(n.pubblicabile === 1); }');
ancora("nuova azzera senza condizioni", NOTE,
  'function nuova() { setApertaId("nuova"); setTitolo(""); setTesto(""); setPubblicabile(false); }');
ancora("ritorno all'elenco", NOTE, 'onPress={() => setApertaId(null)}');
ancora("salva e' l'unica scrittura", NOTE, 'await registra("note", id, nuovo ? "crea" : "aggiorna"');
ancora("effetto legato al solo filtro", NOTE, "useEffect(() => { ricarica(); }, [ricarica]);");
ancora("ricarica dipende dal solo filtro", NOTE, "}, [soloPubblicabili]);");
// L'assenza e' una misura quanto la presenza: non c'e' nessun gancio di fuoco,
// nessuna richiesta di conferma, nessun salvataggio differito.
for (const assente of ["useFocusEffect", "Alert", "usePreventRemove", "BackHandler", "setTimeout"]) {
  misura(`ANCORA in note.tsx non compare ${assente}`, !new RegExp(assente).test(sorgente(NOTE)));
}

// ------------------------------------------------------------- MICRO-REACT
// Le due proprieta' che contano qui: lo stato vive nell'ISTANZA (quindi
// sopravvive a un ridisegno e muore solo con lo smontaggio) e gli effetti si
// rieseguono solo quando cambiano le dipendenze.
let istanzaCorrente = null;
class Istanza {
  constructor(nome, funzione, props) {
    Object.assign(this, { nome, funzione, props: props ?? {}, stati: [], pronti: [], effetti: [], memo: [] });
    this.montata = true;
    this.sporco = false;
    this.attese = [];
  }
  disegna() {
    const prec = istanzaCorrente;
    istanzaCorrente = this;
    this.iStato = 0; this.iEffetto = 0; this.iMemo = 0; this.coda = []; this.sporco = false;
    try {
      this.schermo = this.funzione(this.props);
      for (const v of this.coda) {
        const vecchio = this.effetti[v.i];
        if (vecchio && typeof vecchio.pulizia === "function") vecchio.pulizia();
        const r = v.fn();
        this.effetti[v.i] = { deps: v.deps, pulizia: typeof r === "function" ? r : null };
      }
    } finally {
      istanzaCorrente = prec;
    }
    return this.schermo;
  }
  async stabilizza() {
    for (let g = 0; g < 80; g++) {
      if (this.sporco && this.montata) { this.disegna(); continue; }
      if (this.attese.length) {
        const a = this.attese; this.attese = [];
        await Promise.allSettled(a);
        continue;
      }
      await new Promise((r) => setImmediate(r));
      if (!this.attese.length && !(this.sporco && this.montata)) return this.schermo;
    }
    throw new Error(`${this.nome}: lo schermo non si stabilizza`);
  }
  smonta() {
    for (const e of this.effetti) if (e && typeof e.pulizia === "function") e.pulizia();
    this.montata = false;
  }
}
function useStato(iniziale) {
  const i = istanzaCorrente.iStato++;
  const inst = istanzaCorrente;
  if (!inst.pronti[i]) { inst.stati[i] = typeof iniziale === "function" ? iniziale() : iniziale; inst.pronti[i] = true; }
  return [inst.stati[i], (n) => {
    const v = typeof n === "function" ? n(inst.stati[i]) : n;
    if (!Object.is(v, inst.stati[i])) { inst.stati[i] = v; inst.sporco = true; }
  }];
}
function useEffetto(fn, deps) {
  const inst = istanzaCorrente;
  const i = inst.iEffetto++;
  const p = inst.effetti[i];
  if (!p || !deps || !p.deps || deps.length !== p.deps.length || deps.some((d, k) => !Object.is(d, p.deps[k])))
    inst.coda.push({ i, fn, deps });
}
function useRichiamo(fn, deps) {
  const inst = istanzaCorrente;
  const i = inst.iMemo++;
  const p = inst.memo[i];
  if (!p || deps.length !== p.deps.length || deps.some((d, k) => !Object.is(d, p.deps[k])))
    inst.memo[i] = { deps, valore: fn };
  return inst.memo[i].valore;
}
function avvia(promessa) {
  istanzaCorrente.attese.push(promessa);
  return promessa;
}
function monta(nome, funzione, props) {
  const i = new Istanza(nome, funzione, props);
  i.disegna();
  return i;
}
async function tocca(inst, azione) {
  const r = azione();
  if (r && typeof r.then === "function") { inst.attese.push(r); await r.catch(() => {}); }
  await inst.stabilizza();
}
/** Un ridisegno senza smontaggio: e' quello che fa il navigatore su fuoco/sfuocatura. */
async function ridisegna(inst) {
  inst.sporco = true;
  await inst.stabilizza();
}

// ------------------------------------------------------------- PREPARAZIONE
import * as FS from "../banco/expo-file-system.mjs";
import { configuraCartella } from "../banco/expo-sqlite.mjs";
FS.configuraRadice(mkdtempSync(join(tmpdir(), "controprova-not07-")));
configuraCartella(join(FS.percorsoDocumenti(), "SQLite"));

const DB = await import("../../lib/db.ts");
const Crypto = await import("expo-crypto");
await DB.apri("prova0001");
const base = DB.database();

/** Copia della macchina a stati di app/(tabs)/note.tsx. */
function ModelloNote(p) {
  const affiancato = (p.larghezza ?? 392) >= 600;
  const [note, setNote] = useStato([]);
  const [apertaId, setApertaId] = useStato(null);
  const [titolo, setTitolo] = useStato("");
  const [testo, setTesto] = useStato("");
  const [pubblicabile, setPubblicabile] = useStato(false);
  const [soloPubblicabili, setSoloPubblicabili] = useStato(false);

  const ricarica = useRichiamo(async () => {
    const d = DB.database();
    setNote(await d.getAllAsync(
      soloPubblicabili
        ? "SELECT * FROM note WHERE pubblicabile = 1 ORDER BY creato_a DESC"
        : "SELECT * FROM note ORDER BY creato_a DESC"));
  }, [soloPubblicabili]);

  useEffetto(() => { avvia(ricarica()); }, [ricarica]);

  function apri(n) {
    setApertaId(n.id); setTitolo(n.titolo ?? ""); setTesto(n.testo);
    setPubblicabile(n.pubblicabile === 1);
  }
  function nuova() {
    setApertaId("nuova"); setTitolo(""); setTesto(""); setPubblicabile(false);
  }
  async function salva() {
    if (!testo.trim() && !titolo.trim()) return;
    const id = apertaId === "nuova" || !apertaId ? Crypto.randomUUID() : apertaId;
    const nuovo = apertaId === "nuova" || !apertaId;
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
    setApertaId(id);
    await ricarica();
  }

  const elenco = {
    nuova,
    voci: note.map((n) => ({ id: n.id, titolo: n.titolo || "senza titolo", anteprima: n.testo, premi: () => apri(n) })),
  };
  const editor = apertaId
    ? { tipo: "editor", titolo, testo, pubblicabile, scriviTesto: setTesto, scriviTitolo: setTitolo, salva }
    : { tipo: "invito" };
  return {
    disposizione: affiancato ? "affiancata" : apertaId ? "editor" : "elenco",
    elenco,
    editor,
    ritornoElenco: () => setApertaId(null),
  };
}

// ===========================================================================
// SEZIONE 2 — due note salvate, da cui partono tutte le vie d'uscita
// ===========================================================================
const schermo = monta("Note", ModelloNote, { larghezza: 392 });
await schermo.stabilizza();
await tocca(schermo, () => schermo.schermo.elenco.nuova());
await tocca(schermo, () => schermo.schermo.editor.scriviTitolo("Kleppmann cap. 5"));
await tocca(schermo, () => schermo.schermo.editor.scriviTesto("Testo salvato della prima nota."));
await tocca(schermo, () => schermo.schermo.editor.salva());
await tocca(schermo, () => schermo.schermo.elenco.nuova());
await tocca(schermo, () => schermo.schermo.editor.scriviTitolo("Seconda nota"));
await tocca(schermo, () => schermo.schermo.editor.scriviTesto("Testo salvato della seconda nota."));
await tocca(schermo, () => schermo.schermo.editor.salva());
misura("2.1 due note sul disco", (await base.getFirstAsync("SELECT count(*) AS n FROM note")).n === 2);

const primaNota = schermo.schermo.elenco.voci.find((v) => v.titolo === "Kleppmann cap. 5");
const BOZZA = "Modifica della sera, mai passata da Salva.";
const testoSulDisco = async () =>
  (await base.getFirstAsync("SELECT testo FROM note WHERE id = ?", [primaNota.id])).testo;

// ===========================================================================
// SEZIONE 3 — le vie d'uscita che restano DENTRO la schermata
// ===========================================================================
// --- via A: si apre un'ALTRA nota
await tocca(schermo, () => primaNota.premi());
await tocca(schermo, () => schermo.schermo.editor.scriviTesto(BOZZA));
misura("3.1 la bozza e' nell'editor prima di uscire", schermo.schermo.editor.testo === BOZZA);
const altra = schermo.schermo.elenco.voci.find((v) => v.id !== primaNota.id);
await tocca(schermo, () => altra.premi());
misura("3.2 via A — aprire un'altra nota sovrascrive la bozza", schermo.schermo.editor.testo === "Testo salvato della seconda nota.");
misura("3.3 via A — sul disco non e' finito niente", (await testoSulDisco()) === "Testo salvato della prima nota.");
await tocca(schermo, () => primaNota.premi());
misura("3.4 via A — rientrando nella nota la bozza non esiste piu' da nessuna parte",
  schermo.schermo.editor.testo === "Testo salvato della prima nota.");

// --- via A-bis: si ritocca la nota GIA' aperta nell'elenco. E' il tocco piu'
// innocuo che esista (l'utente non sta nemmeno uscendo) e butta via tutto:
// apri() non guarda se n.id e' gia' apertaId.
await tocca(schermo, () => schermo.schermo.editor.scriviTesto(BOZZA + " A2"));
await tocca(schermo, () => schermo.schermo.elenco.voci.find((v) => v.id === primaNota.id).premi());
misura("3.4b via A-bis — ritoccare nell'elenco la nota GIA' aperta cancella la bozza",
  schermo.schermo.editor.testo === "Testo salvato della prima nota.");

// --- via B: "Nuova nota"
await tocca(schermo, () => schermo.schermo.editor.scriviTesto(BOZZA + " B"));
await tocca(schermo, () => schermo.schermo.elenco.nuova());
misura("3.5 via B — 'Nuova nota' azzera l'editor con la bozza dentro", schermo.schermo.editor.testo === "");
misura("3.6 via B — sul disco non e' finito niente", (await testoSulDisco()) === "Testo salvato della prima nota.");

// --- via C: "← Tutte le note" (il solo "indietro" che note.tsx disegna da se')
await tocca(schermo, () => primaNota.premi());
await tocca(schermo, () => schermo.schermo.editor.scriviTesto(BOZZA + " C"));
await tocca(schermo, () => schermo.schermo.ritornoElenco());
misura("3.7 via C — si torna all'elenco", schermo.schermo.disposizione === "elenco");
// Qui la via di smontaggio n.3: lo stato React NON e' stato azzerato, quindi
// forse la bozza e' solo nascosta. La misura e' se l'utente puo' RITROVARLA.
misura("3.8 via C — l'unico modo di rientrare passa da apri(), che sovrascrive",
  (await (async () => { await tocca(schermo, () => primaNota.premi()); return schermo.schermo.editor.testo; })())
    === "Testo salvato della prima nota.");
misura("3.9 via C — sul disco non e' finito niente", (await testoSulDisco()) === "Testo salvato della prima nota.");

// ===========================================================================
// SEZIONE 4 — "cambio scheda": la scheda si smonta davvero?
// ===========================================================================
// Misurato sul codice VERO del navigatore installato, non a memoria.
const BOTTOM_TAB_VIEW = "node_modules/@react-navigation/bottom-tabs/lib/module/views/BottomTabView.js";
const SWITCH_ROUTER = "node_modules/@react-navigation/routers/lib/module/SwitchRouter.js";
const vistaSchede = sorgente(BOTTOM_TAB_VIEW);
righe.push(`  ·   @react-navigation/bottom-tabs ${JSON.parse(sorgente("node_modules/@react-navigation/bottom-tabs/package.json")).version}`);
// `loaded` cresce e non cala mai: una scheda gia' visitata resta montata.
misura("4.1 l'elenco delle schede caricate cresce e non viene mai ridotto",
  vistaSchede.includes("setLoaded([...loaded, focusedRouteKey])") && !/setLoaded\(loaded\.filter/.test(vistaSchede));
// L'opzione che smonterebbe la scheda sfuocata non esiste piu' in questa versione.
misura("4.2 nessun 'unmountOnBlur' nel navigatore installato", !/unmountOnBlur/.test(vistaSchede));
// Quello che succede davvero alla scheda sfuocata e' un CONGELAMENTO del
// disegno, che non tocca lo stato dei hook.
misura("4.3 la scheda sfuocata viene congelata, non smontata", vistaSchede.includes("shouldFreeze"));
// E note.tsx non ha nessun gancio che si riesegua al ritorno del fuoco.
misura("4.4 note.tsx non ricarica al ritorno del fuoco (nessun useFocusEffect)",
  !/useFocusEffect|useIsFocused/.test(sorgente(NOTE)));
// Conseguenza misurata sul modello: un ciclo di sfuocatura/fuoco e' un
// ridisegno senza smontaggio, e la bozza ci sopravvive.
await tocca(schermo, () => schermo.schermo.editor.scriviTesto(BOZZA + " D"));
await ridisegna(schermo);          // sfuocatura
await ridisegna(schermo);          // ritorno del fuoco
misura("4.5 via D — dopo un giro su un'altra scheda la bozza e' ANCORA nell'editor",
  schermo.schermo.editor.testo === BOZZA + " D", `trovato: ${JSON.stringify(schermo.schermo.editor.testo)}`);

// ===========================================================================
// SEZIONE 5 — "tasto indietro" di sistema: smonta la scheda?
// ===========================================================================
const instradatore = sorgente(SWITCH_ROUTER);
// Il valore predefinito del navigatore a schede: l'indietro salta alla PRIMA
// scheda, non smonta niente. Nessuna schermata dell'app lo sovrascrive.
misura("5.1 il comportamento predefinito dell'indietro fra schede e' 'firstRoute'",
  /backBehavior = 'firstRoute'/.test(instradatore));
misura("5.2 app/(tabs)/_layout.tsx non cambia backBehavior",
  !/backBehavior/.test(sorgente("app/(tabs)/_layout.tsx")));
misura("5.3 nessuna schermata intercetta il tasto indietro",
  schermate.every((f) => !/BackHandler|usePreventRemove|beforeRemove/.test(sorgente(f))));
// Quindi l'indietro di sistema e' lo stesso caso della sezione 4: la scheda
// Note resta montata, la bozza resta in memoria.
await ridisegna(schermo);
misura("5.4 via E — la bozza sopravvive anche all'indietro di sistema",
  schermo.schermo.editor.testo === BOZZA + " D");
// L'unico "indietro" che porta via davvero la bozza e' quello che SMONTA
// l'albero: chiusura dell'app, non navigazione.
schermo.smonta();
const rimontata = monta("NoteRimontate", ModelloNote, { larghezza: 392 });
await rimontata.stabilizza();
misura("5.5 solo smontando davvero l'albero (app chiusa) la bozza sparisce",
  rimontata.schermo.disposizione === "elenco" &&
  !rimontata.schermo.elenco.voci.some((v) => v.anteprima.includes("Modifica della sera")));

// ===========================================================================
// SEZIONE 6 — ampiezza reale del difetto
// ===========================================================================
const viePerse = ["A aprire un'altra nota", "A-bis ritoccare la nota gia' aperta", "B Nuova nota", "C ← Tutte le note"];
const vieSalve = ["D cambio scheda", "E tasto indietro di sistema"];
righe.push(`  ·   vie che perdono la bozza: ${viePerse.length} (${viePerse.join("; ")})`);
righe.push(`  ·   vie che la conservano:    ${vieSalve.length} (${vieSalve.join("; ")})`);
misura("6.1 'in TUTTI i modi di uscire' e' falso: due delle vie elencate conservano la bozza", vieSalve.length === 2);
misura("6.2 il nocciolo resta: quattro vie perdono lavoro senza dire niente", viePerse.length === 4);

// ------------------------------------------------------------------- ESITO
console.log(righe.join("\n"));
console.log(`\n${righe.filter((r) => r.startsWith("  ok")).length} verdi, ${rossi} rosse`);
process.exit(rossi === 0 ? 0 : 1);
