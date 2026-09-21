/**
 * SIMULAZIONE DELLA SUPERFICIE "schermate-stato": le macchine a stati delle 13
 * schermate di app/ piu' components/Cronometro.tsx.
 *
 * Si esegue dalla radice del progetto, senza argomenti e senza variabili:
 *
 *   node test/simulazione/schermate-stato.mjs
 *
 * Il file si riavvia da solo con `--import ./test/banco/carica.mjs` e con
 * BANCO_DOPPI gia' composta (doppi-altri.mjs piu' il mio react-native con
 * AppState): i ganci del banco vanno registrati prima di qualunque import.
 *
 * ---------------------------------------------------------------------------
 * COME SI PROVA UNA SCHERMATA SENZA INTERFACCIA, E PERCHE' QUESTO NON E' FINTO
 * ---------------------------------------------------------------------------
 * Il banco non ha doppi di react-native ne' di expo-router: un .tsx di app/ NON
 * si carica. La regola del banco e' esplicita: "copia la logica della schermata
 * nel test, non importare il .tsx".
 *
 * Qui la copia e' fatta in due pezzi, e il secondo e' quello che rende la copia
 * verificabile invece che arbitraria:
 *
 *   1. UN MICRO-REACT (una sessantina di righe, sotto): useStato, useEffetto,
 *      useRif, useRichiamo, un ciclo di disegno e una coda di effetti. Ha le due
 *      proprieta' che generano meta' dei difetti di questa superficie:
 *        - i gestori catturano i valori del PROPRIO disegno (chiusura), quindi
 *          due tocchi rapidi vedono entrambi lo stato vecchio;
 *        - gli effetti si rieseguono solo quando cambiano le dipendenze, quindi
 *          una scheda che resta montata non si aggiorna.
 *   2. LE ANCORE DI FEDELTA' (sezione ANCORE): ogni decisione ricopiata qui e'
 *      accompagnata dal frammento LETTERALE del .tsx da cui viene, cercato nel
 *      sorgente vero a ogni esecuzione. Se qualcuno cambia `Math.min(i + 1,
 *      coda.length - 1)` in app/esercizi.tsx, l'ancora diventa rossa e dice che
 *      e' QUESTA PROVA a essere da aggiornare, non l'app a essere rotta.
 *
 * Tutto cio' che sta sotto la schermata e' invece IL CODICE VERO, caricato dal
 * banco: lib/db.ts (apri, registra, database), lib/contenuti.ts (i 381
 * contenuti veri), lib/palestra.ts (biblioteca, lettore, salvaPagina),
 * lib/sessioni.ts, lib/verifica.ts, lib/promemoria.ts, lib/notifiche.ts,
 * lib/sync/stato.ts e lib/sync/accoppiamento.ts, con SQLite vero sotto.
 *
 * DUE TIPI DI VERIFICA, e la differenza conta:
 *   ok(...)      — il comportamento CORRETTO atteso. Rosso = qualcosa non va.
 *   difetto(...) — inchioda un comportamento SBAGLIATO dell'app, misurato qui.
 *                  Verde = il difetto e' ancora li'. Rosso = qualcuno l'ha
 *                  corretto e va aggiornata questa prova. Nessun difetto e'
 *                  stato corretto: la correzione la decide il coordinatore.
 *
 * CHE COSA NON PROVA, da sapere prima di fidarsi:
 *   - niente pixel, niente gesti, niente tastiera: il "punto di rottura 600dp"
 *     qui e' la CONDIZIONE `width >= 600` e il ramo che ne discende, non il
 *     disegno. Che una TextInput perda il cursore quando l'albero cambia
 *     struttura si vede solo sull'emulatore;
 *   - niente expo-router: la navigazione e' un giornale di chiamate
 *     (push/back), non uno stack vero. "Tornare indietro a meta'" qui significa
 *     smontare la schermata e rimontarla, che e' quello che fa lo stack;
 *   - niente Alert di sistema: e' un giornale con i pulsanti, che il test puo'
 *     premere;
 *   - il tempo e' virtuale (vedi OROLOGIO VIRTUALE): setTimeout e setInterval
 *     sono i miei, cosi' i 1500 ms del lettore e il secondo del cronometro si
 *     possono attraversare senza aspettarli davvero;
 *   - useAutoSync non e' caricato: la schermata Sincronizzazione riceve un
 *     doppio dell'hook. Il vero useAutoSync e' la superficie di un altro
 *     agente; qui conta la macchina a stati della schermata;
 *   - l'esecutore SQL di app/esercizi.tsx e' programmabile (creaEsecutore) e non
 *     e' esegui() di lib/palestra.ts: serve a produrre a comando la risposta
 *     corretta, l'errore di sintassi, la soluzione di riferimento che non gira e
 *     la query lenta. Il confronto lo fa comunque il VERO lib/verifica.ts, e il
 *     motore vero e' la superficie "motore-sql" di un altro agente;
 *   - nei rami di errore dell'avvio (A12-A19) apri/caricaContenuti/apriPalestra
 *     sono sostituiti da funzioni che sollevano a comando: il percorso felice
 *     (A1-A11), invece, e' quello vero e lascia nel database i 381 contenuti su
 *     cui lavorano tutte le altre sezioni.
 *
 * FALSIFICAZIONE — come ho controllato che questa prova non sia un timbro.
 * Tre finte correzioni, applicate a una COPIA di questo file (il codice dell'app
 * non si tocca), rieseguendo ogni volta. Numeri veri, misurati:
 *
 *   1. ESE-07, l'indice che non avanza: nel modello e nell'ancora
 *      `setIndice((i) => Math.min(i + 1, coda.length - 1))` diventa
 *      `setIndice((i) => i + 1)`.
 *      -> 465 su 468, uscita 1. Rossi: H31, H32 e l'ancora "ESE indice
 *         bloccato" (che continua a cercare nel .tsx il testo vecchio).
 *   2. CRO-03, il doppio tocco sul cronometro: in `ferma()` si aggiunge la
 *      guardia `if (!(await KV.getItem("cronometro_attivo"))) return;`.
 *      -> 467 su 468, uscita 1. Rosso: N20 (una sola sessione invece di due).
 *   3. RIP-01, lo stato vuoto mostrato durante il caricamento: si aggiunge a
 *      ModelloRipasso uno stato "caricamento" distinto dal vuoto.
 *      -> 466 su 468, uscita 1. Rossi: J1 e J17.
 *
 * In tutti e tre i casi il rosso cade ESATTAMENTE sulle verifiche che descrivono
 * quel difetto e su nessun'altra: la prova misura quello che dice di misurare.
 * Per rifarla: copiare questo file in test/simulazione/falsificazione-schermate.mjs,
 * sostituire nella copia anche il nome del file dentro la riga di riavvio, e
 * applicare una delle tre modifiche qui sopra.
 */
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { variabileBanco } from "../banco/doppi-altri.mjs";

const QUESTA_CARTELLA = dirname(fileURLToPath(import.meta.url));
const RADICE_PROGETTO = resolve(QUESTA_CARTELLA, "..", "..");

// ------------------------------------------------------- RIAVVIO CON I GANCI
if (!process.env.SCHERMATE_STATO_IN_CORSO) {
  const esito = spawnSync(
    process.execPath,
    ["--import", "./test/banco/carica.mjs", "test/simulazione/schermate-stato.mjs"],
    {
      cwd: RADICE_PROGETTO,
      stdio: "inherit",
      env: {
        ...process.env,
        SCHERMATE_STATO_IN_CORSO: "1",
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
const difettiInchiodati = [];

function ok(nome, condizione, extra = "") {
  if (condizione) passati++;
  else falliti.push(`${nome}${extra ? " — " + extra : ""}`);
}

/**
 * Inchioda un difetto dell'app: passa finche' il comportamento sbagliato e'
 * quello misurato qui. Se diventa rosso il difetto e' stato corretto ed e'
 * questa prova a dover cambiare.
 */
function difetto(codice, nome, condizione, extra = "") {
  if (condizione) {
    passati++;
    difettiInchiodati.push(`${codice}: ${nome}`);
  } else {
    falliti.push(
      `${codice}: ${nome} — il comportamento e' CAMBIATO (difetto corretto?): aggiornare la prova${
        extra ? " — " + extra : ""
      }`
    );
  }
}

async function tenta(azione) {
  try {
    return { riuscito: true, valore: await azione() };
  } catch (errore) {
    return { riuscito: false, errore: String(errore?.message ?? errore) };
  }
}

// --------------------------------------------------------- TRAPPOLA DI RETE
/**
 * L'app e' offline-first: nessuna schermata deve toccare la rete. Qui fetch e
 * XMLHttpRequest vengono sostituiti da una trappola che REGISTRA e solleva, cosi'
 * una chiamata non si limiterebbe a fallire: si vedrebbe, con il suo indirizzo.
 */
const chiamateDiRete = [];
globalThis.fetch = (...a) => {
  chiamateDiRete.push(String(a[0]));
  throw new Error("rete vietata in questa simulazione: " + String(a[0]));
};
class XMLHttpRequestVietata {
  open(metodo, indirizzo) {
    chiamateDiRete.push(`${metodo} ${indirizzo}`);
    throw new Error("rete vietata in questa simulazione: " + indirizzo);
  }
}
globalThis.XMLHttpRequest = XMLHttpRequestVietata;

// ----------------------------------------------------------------- ANCORE
/**
 * Fedelta' della copia: il frammento deve esistere, alla lettera, nel sorgente
 * vero. Gli spazi sono normalizzati perche' un a capo non e' una differenza.
 */
const sorgenti = new Map();
function sorgenteDi(percorsoRelativo) {
  if (!sorgenti.has(percorsoRelativo)) {
    sorgenti.set(
      percorsoRelativo,
      readFileSync(join(RADICE_PROGETTO, percorsoRelativo), "utf8").replace(/\s+/g, " ")
    );
  }
  return sorgenti.get(percorsoRelativo);
}

function ancora(nome, percorso, frammento) {
  const presente = sorgenteDi(percorso).includes(frammento.replace(/\s+/g, " "));
  ok(
    `ANCORA ${nome}`,
    presente,
    presente ? "" : `il frammento non e' piu' in ${percorso}: la copia nel test e' da aggiornare`
  );
}

// ------------------------------------------------------- OROLOGIO VIRTUALE
/**
 * Il tempo delle schermate. `adesso()` sostituisce Date.now() nelle copie, e i
 * timer sono i miei: cosi' i 1500 ms di attesa del lettore e i secondi del
 * cronometro si attraversano subito e in modo deterministico.
 */
let tempoVirtuale = Date.now();
let prossimoTimer = 1;
let timer = [];

const adesso = () => tempoVirtuale;
const dataOra = () => new Date(tempoVirtuale);

function impostaTimeout(fn, ms) {
  const id = prossimoTimer++;
  timer.push({ id, quando: tempoVirtuale + ms, fn, ripeti: 0 });
  return id;
}
function impostaIntervallo(fn, ms) {
  const id = prossimoTimer++;
  timer.push({ id, quando: tempoVirtuale + ms, fn, ripeti: ms });
  return id;
}
function annullaTimer(id) {
  timer = timer.filter((t) => t.id !== id);
}
function timerAttivi() {
  return timer.length;
}
function avanzaTempo(ms) {
  const fine = tempoVirtuale + ms;
  // Il tetto esiste solo per non girare a vuoto in caso di errore: se lo si
  // tocca la prova deve fallire, non mostrare un orologio fermo a meta'.
  let giro = 0;
  for (; giro < 100000; giro++) {
    const scaduti = timer.filter((t) => t.quando <= fine).sort((a, b) => a.quando - b.quando);
    if (!scaduti.length) break;
    const t = scaduti[0];
    tempoVirtuale = t.quando;
    if (t.ripeti) t.quando += t.ripeti;
    else timer = timer.filter((x) => x !== t);
    t.fn();
  }
  if (giro >= 100000) throw new Error("avanzaTempo: troppi scatti di timer, il tempo virtuale non e' affidabile");
  tempoVirtuale = fine;
}

// ------------------------------------------------------------- MICRO-REACT
let istanzaCorrente = null;

class Istanza {
  constructor(nome, funzione, props) {
    this.nome = nome;
    this.funzione = funzione;
    this.props = props ?? {};
    this.stati = [];
    this.statiPronti = [];
    this.effetti = [];
    this.riferimenti = [];
    this.memo = [];
    this.coda = [];
    this.sporco = false;
    this.schermo = null;
    this.attese = [];
    this.rigetti = [];
    this.montata = true;
    this.disegni = 0;
  }

  disegna() {
    const precedente = istanzaCorrente;
    istanzaCorrente = this;
    this.iStato = 0;
    this.iEffetto = 0;
    this.iRif = 0;
    this.iMemo = 0;
    this.coda = [];
    this.sporco = false;
    try {
      this.schermo = this.funzione(this.props);
      this.disegni++;
      for (const voce of this.coda) {
        const vecchio = this.effetti[voce.i];
        if (vecchio && typeof vecchio.pulizia === "function") vecchio.pulizia();
        const ritorno = voce.fn();
        this.effetti[voce.i] = {
          deps: voce.deps,
          pulizia: typeof ritorno === "function" ? ritorno : null,
        };
      }
    } finally {
      istanzaCorrente = precedente;
    }
    return this.schermo;
  }

  /** Disegna finche' lo schermo non e' fermo e nessuna promessa e' in volo. */
  async stabilizza(limite = 80) {
    for (let giro = 0; giro < limite; giro++) {
      if (this.sporco && this.montata) {
        this.disegna();
        continue;
      }
      if (this.attese.length) {
        const attese = this.attese;
        this.attese = [];
        await Promise.allSettled(attese);
        continue;
      }
      await new Promise((r) => setImmediate(r));
      if (!this.attese.length && !(this.sporco && this.montata)) return this.schermo;
    }
    throw new Error(`${this.nome}: lo schermo non si stabilizza`);
  }

  /** Il tasto indietro di sistema, o il cambio di scheda: l'albero se ne va. */
  smonta() {
    for (const e of this.effetti) if (e && typeof e.pulizia === "function") e.pulizia();
    this.montata = false;
  }
}

function useStato(iniziale) {
  const inst = istanzaCorrente;
  const i = inst.iStato++;
  if (!inst.statiPronti[i]) {
    inst.stati[i] = typeof iniziale === "function" ? iniziale() : iniziale;
    inst.statiPronti[i] = true;
  }
  const valore = inst.stati[i];
  const imposta = (nuovo) => {
    const calcolato = typeof nuovo === "function" ? nuovo(inst.stati[i]) : nuovo;
    if (!Object.is(calcolato, inst.stati[i])) {
      inst.stati[i] = calcolato;
      inst.sporco = true;
    }
  };
  return [valore, imposta];
}

function useEffetto(fn, deps) {
  const inst = istanzaCorrente;
  const i = inst.iEffetto++;
  const prec = inst.effetti[i];
  const cambiato =
    !prec ||
    !deps ||
    !prec.deps ||
    deps.length !== prec.deps.length ||
    deps.some((d, k) => !Object.is(d, prec.deps[k]));
  if (cambiato) inst.coda.push({ i, fn, deps });
}

function useRif(iniziale) {
  const inst = istanzaCorrente;
  const i = inst.iRif++;
  if (!inst.riferimenti[i]) inst.riferimenti[i] = { current: iniziale };
  return inst.riferimenti[i];
}

function useRichiamo(fn, deps) {
  const inst = istanzaCorrente;
  const i = inst.iMemo++;
  const prec = inst.memo[i];
  const cambiato =
    !prec || deps.length !== prec.deps.length || deps.some((d, k) => !Object.is(d, prec.deps[k]));
  if (cambiato) inst.memo[i] = { deps, valore: fn };
  return inst.memo[i].valore;
}

/** useWindowDimensions: la larghezza sta nelle props, cosi' la prova la ruota. */
function useDimensioni() {
  return { width: istanzaCorrente.props.larghezza ?? 392 };
}

/**
 * L'equivalente del `(async () => {...})()` scritto negli effetti delle
 * schermate: la promessa non e' attesa da nessuno. Qui viene tracciata, cosi'
 * il test puo' aspettarla e soprattutto puo' CONTARE i rigetti — che nell'app
 * sono promesse non gestite (riquadro rosso in sviluppo, silenzio in release).
 */
function avvia(promessa) {
  const inst = istanzaCorrente;
  const tracciata = Promise.resolve(promessa).catch((e) => {
    inst.rigetti.push(e);
  });
  inst.attese.push(tracciata);
}

async function monta(nome, funzione, props) {
  const inst = new Istanza(nome, funzione, props);
  inst.disegna();
  await inst.stabilizza();
  return inst;
}

/** Un tocco: esegue il gestore, aspetta l'effetto e ridisegna. */
async function tocca(inst, azione) {
  let rigetto = null;
  try {
    await azione();
  } catch (e) {
    rigetto = e;
    inst.rigetti.push(e);
  }
  await inst.stabilizza();
  return rigetto;
}

/**
 * Due dita sullo stesso pulsante, prima che React abbia ridisegnato: le due
 * chiamate partono dalla stessa chiusura, come sul telefono.
 */
async function toccaDueVolte(inst, azione) {
  const prima = Promise.resolve().then(azione);
  const seconda = Promise.resolve().then(azione);
  const esiti = await Promise.allSettled([prima, seconda]);
  await inst.stabilizza();
  return esiti;
}

/** Rotazione o schermo diviso: cambia la larghezza e si ridisegna. */
async function ruota(inst, larghezza) {
  inst.props.larghezza = larghezza;
  inst.sporco = true;
  return inst.stabilizza();
}

// ------------------------------------------------- ALERT E NAVIGAZIONE FINTI
const avvisi = [];
const navigazione = [];
const console_errori = [];

const Avviso = {
  alert(titolo, messaggio, pulsanti) {
    const voce = { titolo, messaggio, pulsanti: pulsanti ?? [] };
    avvisi.push(voce);
    return voce;
  },
};

const instradatore = {
  push(dove) {
    navigazione.push({ tipo: "push", dove });
  },
  back() {
    navigazione.push({ tipo: "back" });
  },
};

function ultimoAvviso() {
  return avvisi[avvisi.length - 1];
}
function pulsante(voce, testo) {
  return (voce?.pulsanti ?? []).find((p) => p.text === testo);
}

// ------------------------------------------------------------- PREPARAZIONE
import * as FS from "../banco/expo-file-system.mjs";
import { configuraCartella } from "../banco/expo-sqlite.mjs";
import { installaRequireMetro } from "../banco/require-metro.mjs";
import * as SelettoreFile from "../banco/expo-document-picker.mjs";
import * as Notifiche from "../banco/expo-notifications.mjs";
import KV from "../banco/expo-sqlite-kv-store.mjs";
import { configuraStatoApp } from "./schermate-stato-react-native.mjs";

const radiceFinta = FS.configuraRadice(mkdtempSync(join(tmpdir(), "schermate-stato-")));
const cartellaSqlite = configuraCartella(join(FS.percorsoDocumenti(), "SQLite"));
installaRequireMetro(RADICE_PROGETTO);
configuraStatoApp("active");

const DB = await import("../../lib/db.ts");
const Contenuti = await import("../../lib/contenuti.ts");
const Palestra = await import("../../lib/palestra.ts");
const Sessioni = await import("../../lib/sessioni.ts");
const Verifica = await import("../../lib/verifica.ts");
const Prom = await import("../../lib/promemoria.ts");
const NotificheApp = await import("../../lib/notifiche.ts");
const StatoSync = await import("../../lib/sync/stato.ts");
const Accoppiamento = await import("../../lib/sync/accoppiamento.ts");

/** Monta senza aspettare: serve a guardare lo schermo MENTRE sta caricando. */
function montaSenzaAttendere(nome, funzione, props) {
  const inst = new Istanza(nome, funzione, props);
  inst.disegna();
  return inst;
}

/** Lascia girare i microtask e i task in coda, senza toccare il tempo virtuale. */
async function respira(giri = 4) {
  for (let i = 0; i < giri; i++) await new Promise((r) => setImmediate(r));
}

/** Una promessa che il test sblocca quando vuole. */
function rimandata() {
  let risolvi, rifiuta;
  const promessa = new Promise((a, b) => {
    risolvi = a;
    rifiuta = b;
  });
  return { promessa, risolvi, rifiuta };
}

// ===========================================================================
// SEZIONE A — app/_layout.tsx: avvio, caricamento, errore, banner
// ===========================================================================
ancora("RAD ordine avvio", "app/_layout.tsx", "setPronto(true);");
ancora("RAD ripristino non atteso", "app/_layout.tsx", "void ripristinaPromemoria();");
ancora("RAD errore come stringa", "app/_layout.tsx", "setErrore(String(e));");
ancora("RAD titolo errore", "app/_layout.tsx", "Avvio non riuscito");
ancora("RAD testo attesa", "app/_layout.tsx", "Preparazione dei contenuti…");
ancora("RAD banner 21 esercizi", "app/_layout.tsx", "21 esercizi di livello 4 non saranno eseguibili");
ancora("RAD id di 8 caratteri", "app/_layout.tsx", "(Crypto.randomUUID()).slice(0, 8)");

/** Copia della macchina a stati di app/_layout.tsx (Radice). */
function ModelloRadice(p) {
  const [pronto, setPronto] = useStato(false);
  const [errore, setErrore] = useStato(null);
  const [avviso, setAvviso] = useStato(null);

  useEffetto(() => {
    avvia(
      (async () => {
        try {
          let id = await p.kv.getItem("dispositivo_id");
          if (!id) {
            id = p.randomUUID().slice(0, 8);
            await p.kv.setItem("dispositivo_id", id);
          }
          await p.apri(id);
          await p.caricaContenuti();
          await p.apriPalestra();
          if (!p.supportaWindowFunctions()) {
            setAvviso(
              `SQLite ${p.versioneMotore()} non supporta le window functions: ` +
                `21 esercizi di livello 4 non saranno eseguibili su questo dispositivo.`
            );
          }
          setPronto(true);
          p.giornale.push("ripristinaPromemoria");
          void p.ripristinaPromemoria();
        } catch (e) {
          setErrore(String(e));
        }
      })()
    );
  }, []);

  if (errore) {
    return {
      stato: "errore",
      titolo: "Avvio non riuscito",
      testo: errore,
      selezionabile: true,
      pulsanti: [], // nessuna riprova: e' il difetto RAD-03
      stack: false,
    };
  }
  if (!pronto) {
    return { stato: "caricamento", indicatore: true, testo: "Preparazione dei contenuti…", stack: false };
  }
  return { stato: "pronto", avviso, stack: true };
}

const giornaleAvvio = [];
const apriRimandata = rimandata();

const ambienteAvvio = {
  kv: KV,
  randomUUID: () => "abcdef01-2345-6789-abcd-ef0123456789",
  apri: (id) => {
    giornaleAvvio.push("apri:" + id);
    return apriRimandata.promessa.then(() => DB.apri(id));
  },
  caricaContenuti: async () => {
    giornaleAvvio.push("caricaContenuti");
    return Contenuti.caricaContenuti();
  },
  apriPalestra: async () => {
    giornaleAvvio.push("apriPalestra");
    return Palestra.apriPalestra();
  },
  supportaWindowFunctions: () => Palestra.supportaWindowFunctions(),
  versioneMotore: () => Palestra.versioneMotore(),
  ripristinaPromemoria: async () => {
    giornaleAvvio.push("ripristina-eseguito");
  },
  giornale: giornaleAvvio,
};

const radice = montaSenzaAttendere("Radice", ModelloRadice, { ...ambienteAvvio });
ok("A1 al primo disegno la radice mostra SOLO lo schermo di attesa", radice.schermo.stato === "caricamento");
ok("A2 lo schermo di attesa ha l'indicatore e il testo dei contenuti", radice.schermo.indicatore === true && radice.schermo.testo === "Preparazione dei contenuti\u2026");
ok("A3 durante il caricamento non esiste nessuno Stack navigabile", radice.schermo.stack === false);

// Si lascia girare la parte asincrona fino a dove si ferma: apri() e' rimandata.
await respira(8);
ok("A4 il dispositivo_id viene generato e apri() chiamata con quello", giornaleAvvio[0] === "apri:abcdef01", giornaleAvvio.join(","));
const idSalvato = await KV.getItem("dispositivo_id");
ok("A5 l'identificativo salvato e' di 8 caratteri", idSalvato?.length === 8, String(idSalvato));
ok("A6 finche' apri() non risponde lo schermo resta quello di attesa", radice.schermo.stato === "caricamento");

apriRimandata.risolvi();
await radice.stabilizza();

ok("A7 finito l'avvio la radice e' pronta e monta lo Stack", radice.schermo.stato === "pronto" && radice.schermo.stack === true);
ok("A8 su un motore con window functions nessun banner giallo", radice.schermo.avviso === null, String(radice.schermo.avviso));
ok("A9 l'ordine e' apri, contenuti, palestra, poi il ripristino dei promemoria", giornaleAvvio.join(",") === "apri:abcdef01,caricaContenuti,apriPalestra,ripristinaPromemoria,ripristina-eseguito", giornaleAvvio.join(","));
ok("A10 nessun rigetto non gestito nell'avvio riuscito", radice.rigetti.length === 0);

// Il database e' aperto per davvero: da qui in poi le schermate lavorano su
// SQLite vero, con i 381 contenuti veri.
const base = DB.database();
const contaEsercizi = await base.getFirstAsync("SELECT count(*) AS n FROM esercizi");
ok("A11 caricaContenuti() ha davvero riempito il database (381 esercizi)", contaEsercizi.n === 381, String(contaEsercizi.n));

// Il caricamento dei contenuti semina `ripasso.prossima_revisione` con l'ora
// del momento in cui gira: l'orologio virtuale, fermo dall'avvio del processo,
// resterebbe indietro di qualche millisecondo e le 199 schede risulterebbero
// non ancora scadute. Lo si riporta all'ora vera adesso, una volta sola.
tempoVirtuale = Date.now() + 1000;

const secondaCarica = await Contenuti.caricaContenuti();
ok("A12 un secondo avvio salta il caricamento dei contenuti", secondaCarica.saltato === true);

// --- il ramo di errore: un qualunque passo che solleva
const radiceRotta = await monta("RadiceRotta", ModelloRadice, {
  ...ambienteAvvio,
  apri: async () => {
    throw new Error("database disk image is malformed");
  },
  giornale: [],
});
ok("A13 un passo che solleva porta allo schermo 'Avvio non riuscito'", radiceRotta.schermo.stato === "errore" && radiceRotta.schermo.titolo === "Avvio non riuscito");
ok("A14 il testo dell'errore e' selezionabile (serve a copiarlo senza PC)", radiceRotta.schermo.selezionabile === true && radiceRotta.schermo.testo.includes("malformed"));
ok("A15 nello stato di errore non esiste nessuno Stack: non si naviga", radiceRotta.schermo.stack === false);
difetto("RAD-03", "A16 nello stato di errore non c'e' nessun pulsante di riprova: l'unica via e' chiudere l'app", radiceRotta.schermo.pulsanti.length === 0);

const radiceOggetto = await monta("RadiceOggetto", ModelloRadice, {
  ...ambienteAvvio,
  apri: async () => {
    throw { codice: 5 };
  },
  giornale: [],
});
difetto("RAD-03b", "A17 un errore senza toggle utile diventa '[object Object]' a schermo", radiceOggetto.schermo.testo === "[object Object]", radiceOggetto.schermo.testo);

// --- il banner delle window functions
const radiceVecchia = await monta("RadiceVecchia", ModelloRadice, {
  ...ambienteAvvio,
  apri: async () => {},
  caricaContenuti: async () => {},
  apriPalestra: async () => {},
  supportaWindowFunctions: () => false,
  versioneMotore: () => "3.22.0",
  giornale: [],
});
ok("A18 senza window functions compare il banner con la versione del motore", radiceVecchia.schermo.stato === "pronto" && radiceVecchia.schermo.avviso.startsWith("SQLite 3.22.0 non supporta"));
const finestraNelTema = await base.getFirstAsync("SELECT count(*) AS n FROM esercizi WHERE tema_slug = 'sql_window'");
difetto("RAD-04", "A19 il banner dichiara 21 esercizi mentre nel contenuto il tema sql_window ne ha un altro numero", radiceVecchia.schermo.avviso.includes("21 esercizi") && finestraNelTema.n !== 21, `sql_window nel database: ${finestraNelTema.n}`);

const radiceSenzaPalestra = await monta("RadiceSenzaPalestra", ModelloRadice, {
  ...ambienteAvvio,
  apri: async () => {},
  caricaContenuti: async () => {},
  apriPalestra: async () => {},
  supportaWindowFunctions: () => false,
  versioneMotore: () => "sconosciuta",
  giornale: [],
});
difetto("RAD-04b", "A20 con la palestra non aperta il banner mente: 'SQLite sconosciuta non supporta le window functions'", radiceSenzaPalestra.schermo.avviso.includes("SQLite sconosciuta non supporta"));

// --- il ripristino dei promemoria non deve poter bloccare l'avvio.
// Qui gira il VERO lib/notifiche.ts ripristina(), con il sistema che fallisce
// la programmazione: e' il caso di un modulo nativo che si lamenta all'avvio.
await KV.setItem("promemoria", JSON.stringify({ attivo: true, ora: 7, minuto: 0, tipo: "mattina" }));
Notifiche.programmaErrore("modulo nativo assente");
const radiceRipristinoRotto = await monta("RadiceRipristino", ModelloRadice, {
  ...ambienteAvvio,
  apri: async () => {},
  caricaContenuti: async () => {},
  apriPalestra: async () => {},
  ripristinaPromemoria: () => NotificheApp.ripristina(),
  giornale: [],
});
ok("A21 il vero ripristina() con le notifiche rotte non impedisce l'avvio ne' rigetta", radiceRipristinoRotto.schermo.stato === "pronto" && radiceRipristinoRotto.rigetti.length === 0);
Notifiche.azzera();
await KV.removeItem("promemoria");

const radiceRipristinoLento = montaSenzaAttendere("RadiceLenta", ModelloRadice, {
  ...ambienteAvvio,
  apri: async () => {},
  caricaContenuti: async () => {},
  apriPalestra: async () => {},
  ripristinaPromemoria: () => new Promise(() => {}),
  giornale: [],
});
await new Promise((r) => setImmediate(r));
await new Promise((r) => setImmediate(r));
await new Promise((r) => setImmediate(r));
await new Promise((r) => setImmediate(r));
if (radiceRipristinoLento.sporco) radiceRipristinoLento.disegna();
ok("A22 un ripristino che non finisce mai non ritarda il pronto (void, non await)", radiceRipristinoLento.schermo.stato === "pronto");
radiceRipristinoLento.smonta();

// ===========================================================================
// SEZIONE B — app/(tabs)/_layout.tsx: il punto di rottura a 600dp
// ===========================================================================
ancora("TAB soglia tablet", "app/(tabs)/_layout.tsx", "const tablet = width >= 600;");
ancora("TAB posizione barra", "app/(tabs)/_layout.tsx", 'tabBarPosition: tablet ? "left" : "bottom"');
ancora("TAB etichetta", "app/(tabs)/_layout.tsx", 'tabBarLabelPosition: tablet ? "beside-icon" : "below-icon"');

function ModelloSchede() {
  const { width } = useDimensioni();
  const tablet = width >= 600;
  return {
    intestazioneVisibile: false,
    posizioneBarra: tablet ? "left" : "bottom",
    posizioneEtichetta: tablet ? "beside-icon" : "below-icon",
    schede: ["oggi", "studio", "libreria", "note", "profilo"],
    larghezza: width,
  };
}

const schede = await monta("Schede", ModelloSchede, { larghezza: 392 });
ok("B1 su telefono (392dp) la barra e' in basso con l'etichetta sotto l'icona", schede.schermo.posizioneBarra === "bottom" && schede.schermo.posizioneEtichetta === "below-icon");
ok("B2 le schede sono esattamente cinque, nell'ordine del piano", schede.schermo.schede.join(",") === "oggi,studio,libreria,note,profilo");
ok("B3 nessuna intestazione di sistema sopra le schede", schede.schermo.intestazioneVisibile === false);

await ruota(schede, 599);
ok("B4 a 599dp si e' ancora in layout telefono", schede.schermo.posizioneBarra === "bottom");
await ruota(schede, 600);
ok("B5 a 600dp esatti si passa al layout tablet (il confronto e' >=, non >)", schede.schermo.posizioneBarra === "left" && schede.schermo.posizioneEtichetta === "beside-icon");
await ruota(schede, 601);
ok("B6 a 601dp resta tablet", schede.schermo.posizioneBarra === "left");
const disegniPrima = schede.disegni;
await ruota(schede, 800);
await ruota(schede, 1024);
ok("B7 rotazioni ripetute non perdono l'elenco delle schede", schede.schermo.schede.length === 5 && schede.disegni > disegniPrima);
await ruota(schede, 392);
ok("B8 tornando a telefono la barra torna in basso, senza stati intermedi", schede.schermo.posizioneBarra === "bottom");


// ===========================================================================
// SEZIONE C — app/(tabs)/oggi.tsx: riquadri, divergenza, diagnostica
// ===========================================================================
ancora("OGG sessioni 8 giorni", "app/(tabs)/oggi.tsx", 'SELECT inizio, minuti, tipo FROM sessioni WHERE inizio >= ?');
ancora("OGG da ripassare", "app/(tabs)/oggi.tsx", "SELECT count(*) AS n FROM ripasso WHERE prossima_revisione <= ?");
ancora("OGG risolti", "app/(tabs)/oggi.tsx", "SELECT count(DISTINCT esercizio_id) AS n FROM tentativi WHERE esito = 'corretto'");
ancora("OGG totali", "app/(tabs)/oggi.tsx", "SELECT count(*) AS n FROM esercizi");
ancora("OGG dipendenza versione", "app/(tabs)/oggi.tsx", "}, [versione]);");
ancora("OGG ore con un decimale", "app/(tabs)/oggi.tsx", "`${(s.minuti / 60).toFixed(1)} h`");
ancora("OGG soglia layout", "app/(tabs)/oggi.tsx", '{Math.round(width)} dp · {width >= 600 ? "layout tablet" : "layout telefono"}');

/** Copia della macchina a stati di app/(tabs)/oggi.tsx. */
function ModelloOggi(p) {
  const { width } = useDimensioni();
  const [s, setS] = useStato({ minuti: 0, daRipassare: 0, risolti: 0, totali: 0, volumi: 0 });
  const [div, setDiv] = useStato(null);
  const [versione, setVersione] = useStato(0);

  useEffetto(() => {
    avvia(
      (async () => {
        const d = p.database();
        const sessioni = await d.getAllAsync(
          "SELECT inizio, minuti, tipo FROM sessioni WHERE inizio >= ?",
          [new Date(adesso() - 8 * 864e5).toISOString()]
        );
        const settimana = Sessioni.riepilogoSettimana(sessioni, dataOra());
        const [rip, ris, tot, vol] = await Promise.all([
          d.getFirstAsync("SELECT count(*) AS n FROM ripasso WHERE prossima_revisione <= ?", [dataOra().toISOString()]),
          d.getFirstAsync("SELECT count(DISTINCT esercizio_id) AS n FROM tentativi WHERE esito = 'corretto'"),
          d.getFirstAsync("SELECT count(*) AS n FROM esercizi"),
          d.getFirstAsync("SELECT count(*) AS n FROM biblioteca"),
        ]);
        setS({
          minuti: settimana.minuti,
          daRipassare: rip?.n ?? 0,
          risolti: ris?.n ?? 0,
          totali: tot?.n ?? 0,
          volumi: vol?.n ?? 0,
        });
        setDiv(await p.divergenzaCorrente());
      })()
    );
  }, [versione]);

  return {
    titolo: "Oggi",
    riquadroDivergenza:
      div && div.livello !== "allineati"
        ? {
            sfondo: div.livello === "marcata" ? "#FDECEC" : "#FDF0D5",
            colore: div.livello === "marcata" ? "#A12B2B" : "#854F0B",
            messaggio: div.messaggio,
          }
        : null,
    onRegistrata: () => setVersione((v) => v + 1),
    schede: [
      { titolo: "Settimana", valore: `${(s.minuti / 60).toFixed(1)} h`, nota: "obiettivo 5 h" },
      { titolo: "Da ripassare", valore: String(s.daRipassare), nota: "schede in coda" },
      { titolo: "Esercizi risolti", valore: `${s.risolti} / ${s.totali}` },
      { titolo: "Libreria", valore: String(s.volumi), nota: "volumi" },
    ],
    diagnostica: {
      motore: `SQLite ${p.versioneMotore()} · window functions ${
        p.supportaWindowFunctions() ? "disponibili" : "NON disponibili"
      }`,
      schermo: `${Math.round(width)} dp · ${width >= 600 ? "layout tablet" : "layout telefono"}`,
      deriva: p.derivaSospetta(),
    },
  };
}

const ambienteOggi = {
  database: () => DB.database(),
  divergenzaCorrente: () => StatoSync.divergenzaCorrente(),
  versioneMotore: () => Palestra.versioneMotore(),
  supportaWindowFunctions: () => Palestra.supportaWindowFunctions(),
  derivaSospetta: () => DB.derivaSospetta(),
  larghezza: 392,
};

const oggiPrimo = montaSenzaAttendere("Oggi", ModelloOggi, { ...ambienteOggi });
const valoriIniziali = oggiPrimo.schermo.schede.map((x) => x.valore).join(" | ");
ok("C1 al primo disegno i riquadri partono da zero, non da NaN ne' da 'undefined'", valoriIniziali === "0.0 h | 0 | 0 / 0 | 0 volumi".replace(" volumi", ""), valoriIniziali);
ok("C2 non esiste nessuno stato di caricamento: i riquadri sono gia' a schermo", oggiPrimo.schermo.schede.length === 4 && oggiPrimo.schermo.riquadroDivergenza === null);
await oggiPrimo.stabilizza();

const schedeOggi = Object.fromEntries(oggiPrimo.schermo.schede.map((x) => [x.titolo, x.valore]));
ok("C3 'Esercizi risolti' mostra 0 su 381 al primo avvio", schedeOggi["Esercizi risolti"] === "0 / 381", schedeOggi["Esercizi risolti"]);
ok("C4 'Da ripassare' mostra le 199 flashcard seminate come gia' scadute", schedeOggi["Da ripassare"] === "199", schedeOggi["Da ripassare"]);
ok("C5 'Libreria' mostra i 52 volumi della biblioteca aperta", schedeOggi["Libreria"] === "52", schedeOggi["Libreria"]);
ok("C6 'Settimana' mostra 0.0 h senza sessioni, mai NaN", schedeOggi["Settimana"] === "0.0 h", schedeOggi["Settimana"]);
ok("C7 non accoppiato: riquadro rosso con il messaggio dei progressi separati", oggiPrimo.schermo.riquadroDivergenza?.sfondo === "#FDECEC" && oggiPrimo.schermo.riquadroDivergenza?.messaggio.startsWith("Dispositivi non accoppiati"));
ok("C8 la diagnostica riporta la versione vera del motore", oggiPrimo.schermo.diagnostica.motore === `SQLite ${Palestra.versioneMotore()} · window functions disponibili`, oggiPrimo.schermo.diagnostica.motore);
ok("C9 la diagnostica dichiara il layout telefono a 392dp", oggiPrimo.schermo.diagnostica.schermo === "392 dp · layout telefono", oggiPrimo.schermo.diagnostica.schermo);

await ruota(oggiPrimo, 392.72727);
ok("C10 una larghezza frazionaria viene arrotondata: '393 dp', non '392.72727 dp'", oggiPrimo.schermo.diagnostica.schermo === "393 dp · layout telefono", oggiPrimo.schermo.diagnostica.schermo);
await ruota(oggiPrimo, 600);
ok("C11 a 600dp esatti la diagnostica dice 'layout tablet'", oggiPrimo.schermo.diagnostica.schermo === "600 dp · layout tablet");
await ruota(oggiPrimo, 392);
ok("C12 la rotazione non fa ripartire le query (la dipendenza e' solo [versione])", oggiPrimo.schermo.schede[2].valore === "0 / 381");
ok("C13 senza scambi con l'altro dispositivo la deriva oraria non e' segnalata", oggiPrimo.schermo.diagnostica.deriva === false);

// --- una sessione registrata dal cronometro: onRegistrata fa ricalcolare
const idSessione = "sess-oggi-1";
await DB.registra("sessioni", idSessione, "crea", { tipo: "mattina", minuti: 30 }, async (d, hlc) => {
  await d.runAsync("INSERT INTO sessioni (id, tipo, inizio, minuti, hlc) VALUES (?,?,?,?,?)", [
    idSessione, "mattina", dataOra().toISOString(), 30, hlc,
  ]);
});
await oggiPrimo.stabilizza();
ok("C14 finche' onRegistrata non viene chiamato la settimana NON cambia da sola", oggiPrimo.schermo.schede[0].valore === "0.0 h", oggiPrimo.schermo.schede[0].valore);
await tocca(oggiPrimo, () => oggiPrimo.schermo.onRegistrata());
ok("C15 onRegistrata alza 'versione' e la settimana sale a 0.5 h", oggiPrimo.schermo.schede[0].valore === "0.5 h", oggiPrimo.schermo.schede[0].valore);
ok("C16 lo stesso ricalcolo aggiorna anche il riquadro divergenza (1 evento in sospeso)", oggiPrimo.schermo.riquadroDivergenza?.messaggio.includes("Dispositivi non accoppiati"));

// --- OGG-05: si torna alla scheda Oggi dopo aver lavorato altrove
await DB.registra("tentativi", "tent-oggi-1", "crea", { esercizio_id: "SQL-001", esito: "corretto" }, async (d, hlc) => {
  await d.runAsync(
    "INSERT INTO tentativi (id, esercizio_id, risposta, esito, motivo, durata_sec, eseguito_a, hlc) VALUES (?,?,?,?,?,?,?,?)",
    ["tent-oggi-1", "SQL-001", "select 1", "corretto", "identico", 12, dataOra().toISOString(), hlc]
  );
});
await oggiPrimo.stabilizza();
difetto("OGG-05", "C17 tornando su Oggi dopo aver risolto un esercizio i contatori restano quelli del primo montaggio", oggiPrimo.schermo.schede[2].valore === "0 / 381", oggiPrimo.schermo.schede[2].valore);

const oggiRimontato = await monta("OggiRimontato", ModelloOggi, { ...ambienteOggi });
ok("C18 solo chiudendo e riaprendo l'app (rimontaggio) il conteggio si aggiorna", oggiRimontato.schermo.schede[2].valore === "1 / 381", oggiRimontato.schermo.schede[2].valore);

// --- OGG-06: numeratore e denominatore non parlano della stessa popolazione
await DB.registra("tentativi", "tent-oggi-2", "crea", { esercizio_id: "COD-01", esito: "corretto" }, async (d, hlc) => {
  await d.runAsync(
    "INSERT INTO tentativi (id, esercizio_id, risposta, esito, motivo, durata_sec, eseguito_a, hlc) VALUES (?,?,?,?,?,?,?,?)",
    ["tent-oggi-2", "COD-01", "ipotesi", "corretto", null, 30, dataOra().toISOString(), hlc]
  );
});
const oggiDueTipi = await monta("OggiDueTipi", ModelloOggi, { ...ambienteOggi });
const sqlEseguibili = await base.getFirstAsync("SELECT count(*) AS n FROM esercizi WHERE tipo = 'sql_eseguibile'");
difetto("OGG-06", "C19 il numeratore somma tentativi di QUALSIASI tipo, il denominatore conta tutti i 381 esercizi", oggiDueTipi.schermo.schede[2].valore === "2 / 381" && sqlEseguibili.n === 150, `sql eseguibili: ${sqlEseguibili.n}`);

// --- OGG-02: una sessione con data illeggibile gonfia la settimana
await base.runAsync("INSERT INTO sessioni (id, tipo, inizio, minuti, hlc) VALUES (?,?,?,?,?)", [
  "sess-rotta", "mattina", "non-una-data", 600, "0-0-prova",
]);
const oggiDataRotta = await monta("OggiDataRotta", ModelloOggi, { ...ambienteOggi });
difetto("OGG-02", "C20 una sessione con inizio illeggibile viene conteggiata nella settimana (10 h in piu')", oggiDataRotta.schermo.schede[0].valore === "10.5 h", oggiDataRotta.schermo.schede[0].valore);
// pulizia del test: la riga sporca e' mia, la tolgo a mano (non e' codice dell'app)
await base.runAsync("DELETE FROM sessioni WHERE id = 'sess-rotta'");

// --- OGG-01 limite: una query che solleva lascia la schermata a zero, in silenzio
const oggiRotto = await monta("OggiRotto", ModelloOggi, {
  ...ambienteOggi,
  database: () => {
    throw new Error("Database non aperto: chiamare apri() all'avvio.");
  },
});
difetto("OGG-01", "C21 se la lettura solleva, i riquadri restano a zero senza nessun messaggio d'errore", oggiRotto.schermo.schede[2].valore === "0 / 0" && oggiRotto.rigetti.length === 1, `rigetti: ${oggiRotto.rigetti.length}`);
ok("C22 il rigetto della schermata Oggi e' davvero una promessa non gestita (nessun catch nel codice)", !sorgenteDi("app/(tabs)/oggi.tsx").includes("catch"));

// --- la divergenza quando i due dispositivi sono allineati
const accoppiamentoProva = Accoppiamento.generaAccoppiamento();
await StatoSync.salvaAccoppiamento(accoppiamentoProva);
await base.runAsync("UPDATE eventi SET sincronizzato = 1");
await KV.setItem("ultimo_scambio", String(Date.now()));
const oggiAllineato = await monta("OggiAllineato", ModelloOggi, { ...ambienteOggi });
ok("C23 accoppiati, senza eventi in sospeso e con uno scambio recente: nessun riquadro", oggiAllineato.schermo.riquadroDivergenza === null);

await base.runAsync("UPDATE eventi SET sincronizzato = 0");
const oggiLeggera = await monta("OggiLeggera", ModelloOggi, { ...ambienteOggi });
ok("C24 con pochi eventi in sospeso il riquadro diventa giallo, non rosso", oggiLeggera.schermo.riquadroDivergenza?.sfondo === "#FDF0D5" && oggiLeggera.schermo.riquadroDivergenza?.colore === "#854F0B", JSON.stringify(oggiLeggera.schermo.riquadroDivergenza));
await StatoSync.dimenticaAccoppiamento();

// ===========================================================================
// SEZIONE D — app/(tabs)/studio.tsx: i quattro conteggi e la navigazione
// ===========================================================================
ancora("STU query sql", "app/(tabs)/studio.tsx", "SELECT count(*) AS n FROM esercizi e WHERE e.tipo='sql_eseguibile' AND e.dataset='palestra.db'");
ancora("STU non esiste corretto", "app/(tabs)/studio.tsx", "AND NOT EXISTS (SELECT 1 FROM tentativi t WHERE t.esercizio_id=e.id AND t.esito='corretto')");
ancora("STU filtro window", "app/(tabs)/studio.tsx", `const filtro = supportaWindowFunctions() ? "" : " AND tema_slug <> 'sql_window'";`);
ancora("STU effetto senza dipendenze", "app/(tabs)/studio.tsx", "}, []);");
ancora("STU opacita' dello zero", "app/(tabs)/studio.tsx", "opacity: n ? 1 : 0.3");

/** Copia della macchina a stati di app/(tabs)/studio.tsx. */
function ModelloStudio(p) {
  const [c, setC] = useStato({ sql: 0, codice: 0, ripasso: 0, scenari: 0 });

  useEffetto(() => {
    avvia(
      (async () => {
        const d = p.database();
        const adessoIso = dataOra().toISOString();
        const filtro = p.supportaWindowFunctions() ? "" : " AND tema_slug <> 'sql_window'";
        const [sql, cod, rip, sce] = await Promise.all([
          d.getFirstAsync(
            `SELECT count(*) AS n FROM esercizi e WHERE e.tipo='sql_eseguibile' AND e.dataset='palestra.db'${filtro}
             AND NOT EXISTS (SELECT 1 FROM tentativi t WHERE t.esercizio_id=e.id AND t.esito='corretto')`
          ),
          d.getFirstAsync(
            `SELECT count(*) AS n FROM esercizi e WHERE e.tipo='lettura_codice'
             AND NOT EXISTS (SELECT 1 FROM tentativi t WHERE t.esercizio_id=e.id AND t.esito='corretto')`
          ),
          d.getFirstAsync("SELECT count(*) AS n FROM ripasso WHERE prossima_revisione <= ?", [adessoIso]),
          d.getFirstAsync("SELECT count(*) AS n FROM esercizi WHERE tipo='rubrica'"),
        ]);
        setC({ sql: sql?.n ?? 0, codice: cod?.n ?? 0, ripasso: rip?.n ?? 0, scenari: sce?.n ?? 0 });
      })()
    );
  }, []);

  const voce = (href, titolo, n) => ({
    href,
    titolo,
    n,
    opacita: n ? 1 : 0.3,
    toccabile: true,
    premi: () => instradatore.push(href),
  });

  return {
    titolo: "Studio",
    voci: [
      voce("/esercizi", "Esercizi SQL", c.sql),
      voce("/codice", "Lettura del codice", c.codice),
      voce("/ripasso", "Ripasso", c.ripasso),
    ],
    scenari: { titolo: "Scenari a rubrica", n: c.scenari, toccabile: false },
  };
}

const ambienteStudio = {
  database: () => DB.database(),
  supportaWindowFunctions: () => Palestra.supportaWindowFunctions(),
};

const studioPrimo = montaSenzaAttendere("Studio", ModelloStudio, { ...ambienteStudio });
ok("D1 al primo disegno i quattro conteggi sono a zero (nessuno stato di caricamento)", studioPrimo.schermo.voci.every((v) => v.n === 0) && studioPrimo.schermo.scenari.n === 0);
ok("D2 un conteggio a zero e' sbiadito ma la voce resta toccabile", studioPrimo.schermo.voci[0].opacita === 0.3 && studioPrimo.schermo.voci[0].toccabile === true);
await studioPrimo.stabilizza();

const conteggi = Object.fromEntries(studioPrimo.schermo.voci.map((v) => [v.titolo, v.n]));
ok("D3 'Esercizi SQL' conta i 149 ancora aperti (150 meno quello gia' risolto)", conteggi["Esercizi SQL"] === 149, String(conteggi["Esercizi SQL"]));
ok("D4 'Lettura del codice' conta i 19 ancora aperti (20 meno quello risolto)", conteggi["Lettura del codice"] === 19, String(conteggi["Lettura del codice"]));
ok("D5 'Ripasso' conta le 199 schede scadute", conteggi["Ripasso"] === 199, String(conteggi["Ripasso"]));
ok("D6 gli 'Scenari a rubrica' sono 12 e il riquadro NON e' toccabile", studioPrimo.schermo.scenari.n === 12 && studioPrimo.schermo.scenari.toccabile === false);

navigazione.length = 0;
await tocca(studioPrimo, () => studioPrimo.schermo.voci[0].premi());
ok("D7 il tocco su 'Esercizi SQL' naviga a /esercizi", navigazione.length === 1 && navigazione[0].dove === "/esercizi");
await toccaDueVolte(studioPrimo, () => studioPrimo.schermo.voci[2].premi());
difetto("STU-03", "D8 il doppio tocco su una voce impila due volte la stessa rotta: servono due 'indietro'", navigazione.length === 3 && navigazione[1].dove === "/ripasso" && navigazione[2].dove === "/ripasso");
navigazione.length = 0;

// --- STU-02: i conteggi non scendono mai finche' la scheda resta montata
await DB.registra("tentativi", "tent-studio-1", "crea", { esercizio_id: "SQL-002", esito: "corretto" }, async (d, hlc) => {
  await d.runAsync(
    "INSERT INTO tentativi (id, esercizio_id, risposta, esito, motivo, durata_sec, eseguito_a, hlc) VALUES (?,?,?,?,?,?,?,?)",
    ["tent-studio-1", "SQL-002", "select 1", "corretto", "identico", 9, dataOra().toISOString(), hlc]
  );
});
await studioPrimo.stabilizza();
difetto("STU-02", "D9 risolto un esercizio, il numero in Studio non cambia fino al riavvio dell'app", studioPrimo.schermo.voci[0].n === 149, String(studioPrimo.schermo.voci[0].n));
const studioRimontato = await monta("StudioRimontato", ModelloStudio, { ...ambienteStudio });
ok("D10 rimontando la scheda il conteggio scende a 148", studioRimontato.schermo.voci[0].n === 148, String(studioRimontato.schermo.voci[0].n));

// --- STU-04: Studio e la coda di /esercizi non contano la stessa cosa
await DB.registra("tentativi", "tent-studio-2", "crea", { esercizio_id: "SQL-002", esito: "errato" }, async (d, hlc) => {
  await d.runAsync(
    "INSERT INTO tentativi (id, esercizio_id, risposta, esito, motivo, durata_sec, eseguito_a, hlc) VALUES (?,?,?,?,?,?,?,?)",
    ["tent-studio-2", "SQL-002", "select 2", "errato", "valori_diversi", 11, new Date(adesso() + 1000).toISOString(), hlc]
  );
});
const studioDopoRicaduta = await monta("StudioRicaduta", ModelloStudio, { ...ambienteStudio });
const codaEsercizi = await base.getAllAsync(
  `SELECT e.id FROM esercizi e
   LEFT JOIN (SELECT esercizio_id, max(eseguito_a) AS ultimo, esito
              FROM tentativi GROUP BY esercizio_id) t ON t.esercizio_id = e.id
   WHERE e.tipo = 'sql_eseguibile' AND e.dataset = 'palestra.db'
     AND (t.esito IS NULL OR t.esito <> 'corretto')
   ORDER BY e.livello, e.id LIMIT 40`
);
const sql002InCoda = codaEsercizi.some((r) => r.id === "SQL-002");
difetto("STU-04", "D11 dopo una ricaduta Studio esclude l'esercizio (NOT EXISTS) mentre la coda di /esercizi lo rimette dentro", studioDopoRicaduta.schermo.voci[0].n === 148 && sql002InCoda === true, `studio ${studioDopoRicaduta.schermo.voci[0].n}, in coda: ${sql002InCoda}`);
difetto("STU-04b", "D12 Studio non applica il LIMIT 40 della coda: 148 contro 40", studioDopoRicaduta.schermo.voci[0].n === 148 && codaEsercizi.length === 40, `coda: ${codaEsercizi.length}`);

// --- il filtro delle window functions
const studioSenzaWindow = await monta("StudioSenzaWindow", ModelloStudio, {
  ...ambienteStudio,
  supportaWindowFunctions: () => false,
});
const nelTema = await base.getFirstAsync("SELECT count(*) AS n FROM esercizi WHERE tema_slug = 'sql_window' AND tipo = 'sql_eseguibile'");
ok("D13 senza window functions il conteggio esclude l'intero tema sql_window", studioSenzaWindow.schermo.voci[0].n === studioDopoRicaduta.schermo.voci[0].n - nelTema.n, `${studioSenzaWindow.schermo.voci[0].n} contro ${studioDopoRicaduta.schermo.voci[0].n} - ${nelTema.n}`);

// ===========================================================================
// SEZIONE E — app/(tabs)/libreria.tsx: elenco, filtri, import, rimozione
// ===========================================================================
import * as IntentLauncher from "../banco/expo-intent-launcher.mjs";
import * as Condivisione from "../banco/expo-sharing.mjs";

ancora("LIB due colonne a 900", "app/(tabs)/libreria.tsx", "const colonne = width >= 900 ? 2 : 1;");
ancora("LIB chiave della lista", "app/(tabs)/libreria.tsx", "key={colonne}");
ancora("LIB avviso non scaricato", "app/(tabs)/libreria.tsx", '"Non ancora sul dispositivo"');
ancora("LIB esito di apriVolume ignorato", "app/(tabs)/libreria.tsx", "onPress: () => { void apriVolume(item); }");
ancora("LIB conteggio annunciato", "app/(tabs)/libreria.tsx", "`${r.collegati} volumi ora disponibili offline.`");
ancora("LIB ricarica dipende dal filtro", "app/(tabs)/libreria.tsx", "}, [filtro]);");

/** Copia della macchina a stati di app/(tabs)/libreria.tsx. */
function ModelloLibreria(p) {
  const { width } = useDimensioni();
  const colonne = width >= 900 ? 2 : 1;
  const [volumi, setVolumi] = useStato([]);
  const [filtro, setFiltro] = useStato(null);

  const ricarica = useRichiamo(async () => {
    setVolumi(await p.elencaBiblioteca(filtro ?? undefined));
  }, [filtro]);

  useEffetto(() => {
    avvia(ricarica());
  }, [ricarica]);

  async function aggiungi() {
    const v = await p.importaPdf();
    if (v) {
      await ricarica();
      Avviso.alert("Aggiunto", v.titolo);
    }
  }

  async function daRelease() {
    const r = await p.importaBiblioteca();
    await ricarica();
    if (r.errore) {
      Avviso.alert("Importazione", r.errore);
      return;
    }
    Avviso.alert(
      "Importazione",
      `${r.collegati} volumi ora disponibili offline.` +
        (r.senzaFile
          ? ` ${r.senzaFile} voci senza PDF: sono libri web, da leggere online o da salvare in PDF.`
          : "")
    );
  }

  const trimestri = ["T1", "T2", "T3", "T4", "T5", "T6"];

  return {
    aggiungi,
    daRelease,
    filtro,
    chiaveLista: colonne,
    colonne,
    chip: [
      { etichetta: "Tutti", scelto: filtro === null, premi: () => setFiltro(null) },
      ...trimestri.map((t) => ({ etichetta: t, scelto: filtro === t, premi: () => setFiltro(t) })),
    ],
    vuoto: volumi.length === 0,
    testoVuoto:
      'Nessun volume. "Aggiungi PDF" per i tuoi file; "Importa biblioteca" per i testi aperti scaricati dalla release di GitHub.',
    volumi: volumi.map((item) => ({
      id: item.id,
      titolo: item.titolo,
      badge: item.origine === "manuale" ? "tuo file" : "aperta",
      coloreBadge: item.origine === "manuale" ? "#0C447C" : "#0F6E56",
      trimestre: item.trimestre,
      stato: item.file_locale ? "offline" : "non scaricato",
      ripresa: item.ultima_pagina > 0 ? `ripresa a pagina ${item.ultima_pagina}` : null,
      premi: () =>
        item.file_locale
          ? instradatore.push({ pathname: "/lettore", params: { id: item.id } })
          : Avviso.alert(
              "Non ancora sul dispositivo",
              "Importa la biblioteca dalla release di GitHub, oppure aggiungi il PDF a mano."
            ),
      pressioneLunga: () =>
        Avviso.alert(item.titolo, undefined, [
          ...(item.file_locale
            ? [
                {
                  text: "Apri con il visore del sistema",
                  onPress: () => {
                    void p.apriVolume(item);
                  },
                },
              ]
            : []),
          {
            text: "Rimuovi",
            style: "destructive",
            onPress: async () => {
              await p.rimuoviVolume(item.id);
              await ricarica();
            },
          },
          { text: "Annulla", style: "cancel" },
        ]),
    })),
  };
}

const esitiApriVolume = [];
const ambienteLibreria = {
  elencaBiblioteca: (t) => Palestra.elencaBiblioteca(t),
  importaPdf: () => Palestra.importaPdf(),
  importaBiblioteca: () => Palestra.importaBiblioteca(),
  rimuoviVolume: (id) => Palestra.rimuoviVolume(id),
  apriVolume: async (v) => {
    const esito = await Palestra.apriVolume(v);
    esitiApriVolume.push(esito);
    return esito;
  },
  larghezza: 392,
};

const libreriaPrima = montaSenzaAttendere("Libreria", ModelloLibreria, { ...ambienteLibreria });
difetto("LIB-01", "E1 al primo disegno, con 52 volumi nel database, la libreria mostra lo stato vuoto che invita a importare", libreriaPrima.schermo.vuoto === true && libreriaPrima.schermo.testoVuoto.startsWith("Nessun volume."));
await libreriaPrima.stabilizza();
ok("E2 caricata, la libreria elenca i 52 volumi della biblioteca aperta", libreriaPrima.schermo.volumi.length === 52, String(libreriaPrima.schermo.volumi.length));
const primo = libreriaPrima.schermo.volumi[0];
ok("E3 un volume della biblioteca aperta ha il badge verde 'aperta'", primo.badge === "aperta" && primo.coloreBadge === "#0F6E56");
ok("E4 senza file locale il volume e' marcato 'non scaricato'", primo.stato === "non scaricato");
ok("E5 con ultima_pagina a 0 non compare nessuna riga di ripresa", primo.ripresa === null);
ok("E6 sotto i 900dp la lista e' a una colonna", libreriaPrima.schermo.colonne === 1);

avvisi.length = 0;
navigazione.length = 0;
await tocca(libreriaPrima, () => primo.premi());
ok("E7 toccare un volume non scaricato apre l'avviso e NON naviga", ultimoAvviso()?.titolo === "Non ancora sul dispositivo" && navigazione.length === 0);

// --- pressione lunga su un volume non scaricato: due soli pulsanti
await tocca(libreriaPrima, () => primo.pressioneLunga());
ok("E8 la pressione lunga su un volume non scaricato offre solo Rimuovi e Annulla", ultimoAvviso().pulsanti.map((b) => b.text).join(",") === "Rimuovi,Annulla");
const volumiPrimaDellAnnulla = libreriaPrima.schermo.volumi.length;
ok("E9 'Annulla' non ha nessun gestore: non cambia nulla", pulsante(ultimoAvviso(), "Annulla").onPress === undefined && libreriaPrima.schermo.volumi.length === volumiPrimaDellAnnulla);

// --- LIB-07: Aggiungi PDF, annullando il selettore
const pdfFinto = join(radiceFinta, "Il manuale del dato.pdf");
writeFileSync(pdfFinto, "%PDF-1.4\n% finto ma con la firma giusta\n");
SelettoreFile.azzera();
avvisi.length = 0;
SelettoreFile.programma({ annullato: true });
await tocca(libreriaPrima, () => libreriaPrima.schermo.aggiungi());
ok("E10 annullare il selettore non produce nessun avviso e nessun volume", avvisi.length === 0 && libreriaPrima.schermo.volumi.length === volumiPrimaDellAnnulla);
ok("E11 il selettore e' stato aperto chiedendo PDF ed EPUB, non 'qualunque cosa'", SelettoreFile.giornale[0].opzioni.type.join(",") === "application/pdf,application/epub+zip");

// --- Aggiungi PDF, scelta riuscita
SelettoreFile.programma({ percorsi: [pdfFinto] });
await tocca(libreriaPrima, () => libreriaPrima.schermo.aggiungi());
ok("E12 il PDF importato compare in elenco con il badge 'tuo file'", libreriaPrima.schermo.volumi.some((v) => v.badge === "tuo file" && v.titolo === "Il manuale del dato"));
ok("E13 l'avviso 'Aggiunto' riporta il titolo dedotto dal nome, senza estensione", ultimoAvviso()?.titolo === "Aggiunto" && ultimoAvviso()?.messaggio === "Il manuale del dato");
const importato = libreriaPrima.schermo.volumi.find((v) => v.badge === "tuo file");
ok("E14 il volume importato risulta 'offline'", importato.stato === "offline");

// --- LIB-07: la copia che fallisce non e' protetta da nessun try/catch
SelettoreFile.programma({
  assets: [{ name: "fantasma.pdf", uri: "file:///non/esiste/fantasma.pdf", size: 10, mimeType: "application/pdf" }],
});
avvisi.length = 0;
const rigettiPrima = libreriaPrima.rigetti.length;
const erroreAggiunta = await tocca(libreriaPrima, () => libreriaPrima.schermo.aggiungi());
difetto("LIB-07", "E15 se la copia fallisce l'eccezione risale alla schermata: nessun messaggio, promessa non gestita", erroreAggiunta !== null && avvisi.length === 0 && libreriaPrima.rigetti.length === rigettiPrima + 1, String(erroreAggiunta));

// --- LIB-07b: doppio tocco su 'Aggiungi PDF'
SelettoreFile.azzera();
SelettoreFile.programma({ annullato: true }, { annullato: true });
await toccaDueVolte(libreriaPrima, () => libreriaPrima.schermo.aggiungi());
difetto("LIB-07c", "E16 il doppio tocco apre DUE selettori: niente impedisce la seconda chiamata", SelettoreFile.giornale.length === 2);

// --- il volume importato si apre nel lettore
navigazione.length = 0;
const conFile = libreriaPrima.schermo.volumi.find((v) => v.stato === "offline");
await tocca(libreriaPrima, () => conFile.premi());
ok("E17 toccare un volume scaricato naviga a /lettore con il suo id", navigazione.length === 1 && navigazione[0].dove.pathname === "/lettore" && navigazione[0].dove.params.id === conFile.id);
navigazione.length = 0;
await toccaDueVolte(libreriaPrima, () => conFile.premi());
difetto("LIB-03", "E18 il doppio tocco impila DUE lettori: due WebView e due pdf.js in memoria", navigazione.length === 2);

// --- LIB-05: l'esito di apriVolume e' ignorato dalla schermata
IntentLauncher.programmaNessunVisore(true);
Condivisione.programmaDisponibilita(false);
avvisi.length = 0;
esitiApriVolume.length = 0;
await tocca(libreriaPrima, () => conFile.pressioneLunga());
ok("E19 la pressione lunga su un volume scaricato offre anche 'Apri con il visore del sistema'", ultimoAvviso().pulsanti.map((b) => b.text).join(",") === "Apri con il visore del sistema,Rimuovi,Annulla");
await tocca(libreriaPrima, () => pulsante(ultimoAvviso(), "Apri con il visore del sistema").onPress());
await respira(4);
difetto("LIB-05", "E20 senza visore ne' foglio di condivisione apriVolume risponde 'nessun_visore' e la schermata non dice nulla", esitiApriVolume[0] === "nessun_visore" && avvisi.length === 1, JSON.stringify(esitiApriVolume));
IntentLauncher.programmaNessunVisore(false);
Condivisione.programmaDisponibilita(true);

// --- i filtri per trimestre
await tocca(libreriaPrima, () => libreriaPrima.schermo.chip.find((c) => c.etichetta === "T4").premi());
ok("E21 il chip T4 diventa quello scelto e l'elenco mostra solo i volumi di T4", libreriaPrima.schermo.chip.find((c) => c.etichetta === "T4").scelto === true && libreriaPrima.schermo.volumi.every((v) => v.trimestre === "T4"));
const volumiT4 = libreriaPrima.schermo.volumi.length;
ok("E22 i volumi di T4 sono i 5 del contenuto", volumiT4 === 5, String(volumiT4));
ok("E23 il PDF aggiunto a mano (trimestre nullo) non compare sotto nessun filtro", !libreriaPrima.schermo.volumi.some((v) => v.badge === "tuo file"));

// --- LIB-06: rimuovere un volume della biblioteca APERTA lo cancella per sempre
const daRimuovere = libreriaPrima.schermo.volumi[0];
await tocca(libreriaPrima, () => daRimuovere.pressioneLunga());
await tocca(libreriaPrima, () => pulsante(ultimoAvviso(), "Rimuovi").onPress());
ok("E24 'Rimuovi' toglie subito il volume dall'elenco", libreriaPrima.schermo.volumi.length === volumiT4 - 1);
const eventoElimina = await base.getFirstAsync("SELECT * FROM eventi WHERE entita_id = ? AND tipo = 'elimina'", [daRimuovere.id]);
ok("E25 la rimozione passa dal registro eventi con un evento 'elimina'", eventoElimina !== null && eventoElimina.entita === "biblioteca");
const ricarico = await Contenuti.caricaContenuti();
const tornato = await base.getFirstAsync("SELECT id FROM biblioteca WHERE id = ?", [daRimuovere.id]);
difetto("LIB-06", "E26 la voce di catalogo non torna piu': caricaContenuti salta e l'eliminazione e' definitiva", ricarico.saltato === true && tornato === null);

// --- LIB-02: svuotato un trimestre, lo stato vuoto sotto filtro parla di importazione
for (const v of [...libreriaPrima.schermo.volumi]) {
  await tocca(libreriaPrima, () => v.pressioneLunga());
  await tocca(libreriaPrima, () => pulsante(ultimoAvviso(), "Rimuovi").onPress());
}
difetto("LIB-02", "E27 con il filtro T4 ormai vuoto compare il testo che invita a importare, fuorviante sotto un filtro", libreriaPrima.schermo.vuoto === true && libreriaPrima.schermo.testoVuoto.includes("Importa biblioteca"));
await tocca(libreriaPrima, () => libreriaPrima.schermo.chip.find((c) => c.etichetta === "Tutti").premi());
ok("E28 tornando su 'Tutti' l'elenco si ripopola", libreriaPrima.schermo.volumi.length > 40);

// --- LIB-08: Importa biblioteca
SelettoreFile.azzera();
avvisi.length = 0;
SelettoreFile.programma({ percorsi: [pdfFinto] });
await tocca(libreriaPrima, () => libreriaPrima.schermo.daRelease());
ok("E29 senza manifesto.json l'avviso lo dice e non cambia nulla", ultimoAvviso().messaggio === "Seleziona anche manifesto.json insieme ai PDF.");

SelettoreFile.azzera();
avvisi.length = 0;
SelettoreFile.programma({ annullato: true });
await tocca(libreriaPrima, () => libreriaPrima.schermo.daRelease());
difetto("LIB-08", "E30 annullando l'importazione l'avviso annuncia comunque '0 volumi ora disponibili offline.'", ultimoAvviso().messaggio === "0 volumi ora disponibili offline.", ultimoAvviso().messaggio);

const codiceEsistente = (await base.getFirstAsync("SELECT id FROM biblioteca WHERE origine = 'aperta' LIMIT 1")).id;
const pdfRelease = join(radiceFinta, "volume-aperto.pdf");
writeFileSync(pdfRelease, "%PDF-1.4\n% volume della release\n");
const manifesto = join(radiceFinta, "manifesto.json");
writeFileSync(
  manifesto,
  JSON.stringify([
    { codice: codiceEsistente, titolo: "Volume vero", file: "volume-aperto.pdf", byte: 30 },
    { codice: "BIB-INESISTENTE", titolo: "Volume fantasma", file: "volume-aperto.pdf", byte: 30 },
    { codice: "BIB-SENZA-FILE", titolo: "Solo web" },
  ])
);
SelettoreFile.azzera();
avvisi.length = 0;
SelettoreFile.programma({ percorsi: [manifesto, pdfRelease] });
await tocca(libreriaPrima, () => libreriaPrima.schermo.daRelease());
ok("E31 con il manifesto l'avviso riassume i collegati e le voci senza PDF", ultimoAvviso().messaggio.startsWith("2 volumi ora disponibili offline.") && ultimoAvviso().messaggio.includes("1 voci senza PDF"), ultimoAvviso().messaggio);
const collegatoDavvero = await base.getFirstAsync("SELECT file_locale FROM biblioteca WHERE id = ?", [codiceEsistente]);
ok("E32 il volume esistente risulta ora scaricato", collegatoDavvero.file_locale !== null);
const fantasma = await base.getFirstAsync("SELECT id FROM biblioteca WHERE id = 'BIB-INESISTENTE'");
difetto("LIB-08b", "E33 il conteggio annuncia 2 collegati ma uno dei due codici non esiste in biblioteca: l'UPDATE non ha toccato nulla", fantasma === null && ultimoAvviso().messaggio.startsWith("2 volumi"));

// --- LIB-08c: manifesto illeggibile
const manifestoRotto = join(radiceFinta, "manifesto-rotto.json");
writeFileSync(manifestoRotto, '[{"codice":"BIB-01","file":');
SelettoreFile.azzera();
avvisi.length = 0;
const rigettiPrimaManifesto = libreriaPrima.rigetti.length;
SelettoreFile.programma({ percorsi: [manifestoRotto, pdfRelease] });
const erroreManifesto = await tocca(libreriaPrima, () => libreriaPrima.schermo.daRelease());
difetto("LIB-08c", "E34 un manifesto troncato fa risalire l'eccezione: nessun avviso, promessa non gestita", erroreManifesto !== null && avvisi.length === 0 && libreriaPrima.rigetti.length === rigettiPrimaManifesto + 1, String(erroreManifesto));

// --- LIB-09: il punto di rottura della libreria non e' quello del progetto
await ruota(libreriaPrima, 600);
difetto("LIB-09", "E35 a 600dp (layout tablet per tutto il resto) la libreria resta a una colonna", libreriaPrima.schermo.colonne === 1);
await ruota(libreriaPrima, 900);
ok("E36 a 900dp la libreria passa a due colonne", libreriaPrima.schermo.colonne === 2);
difetto("LIB-09b", "E37 cambiando numero di colonne cambia anche la chiave della FlatList: la lista si rimonta e la posizione di scorrimento si perde", libreriaPrima.schermo.chiaveLista === 2);
await ruota(libreriaPrima, 392);
libreriaPrima.smonta();

// ===========================================================================
// SEZIONE F — app/(tabs)/note.tsx: editor, salvataggio, abbandono
// ===========================================================================
ancora("NOT guardia del vuoto", "app/(tabs)/note.tsx", "if (!testo.trim() && !titolo.trim()) return;");
ancora("NOT id nuovo o esistente", "app/(tabs)/note.tsx", 'const id = apertaId === "nuova" || !apertaId ? Crypto.randomUUID() : apertaId;');
ancora("NOT setApertaId dopo l'await", "app/(tabs)/note.tsx", "setApertaId(id); await ricarica();");
ancora("NOT titolo vuoto come NULL", "app/(tabs)/note.tsx", "titolo || null");
ancora("NOT ordine dell'elenco", "app/(tabs)/note.tsx", "SELECT * FROM note ORDER BY creato_a DESC");
ancora("NOT filtro pubblicabili", "app/(tabs)/note.tsx", "SELECT * FROM note WHERE pubblicabile = 1 ORDER BY creato_a DESC");
ancora("NOT ritorno all'elenco", "app/(tabs)/note.tsx", "← Tutte le note");

/** Copia della macchina a stati di app/(tabs)/note.tsx. */
function ModelloNote(p) {
  const { width } = useDimensioni();
  const affiancato = width >= 600;

  const [note, setNote] = useStato([]);
  const [apertaId, setApertaId] = useStato(null);
  const [titolo, setTitolo] = useStato("");
  const [testo, setTesto] = useStato("");
  const [pubblicabile, setPubblicabile] = useStato(false);
  const [soloPubblicabili, setSoloPubblicabili] = useStato(false);

  const ricarica = useRichiamo(async () => {
    const d = p.database();
    setNote(
      await d.getAllAsync(
        soloPubblicabili
          ? "SELECT * FROM note WHERE pubblicabile = 1 ORDER BY creato_a DESC"
          : "SELECT * FROM note ORDER BY creato_a DESC"
      )
    );
  }, [soloPubblicabili]);

  useEffetto(() => {
    avvia(ricarica());
  }, [ricarica]);

  function apriNota(n) {
    setApertaId(n.id);
    setTitolo(n.titolo ?? "");
    setTesto(n.testo);
    setPubblicabile(n.pubblicabile === 1);
  }

  function nuova() {
    setApertaId("nuova");
    setTitolo("");
    setTesto("");
    setPubblicabile(false);
  }

  async function salva() {
    if (!testo.trim() && !titolo.trim()) return;
    const id = apertaId === "nuova" || !apertaId ? p.randomUUID() : apertaId;
    const nuovo = apertaId === "nuova" || !apertaId;
    await p.registra(
      "note",
      id,
      nuovo ? "crea" : "aggiorna",
      { titolo, testo, pubblicabile: pubblicabile ? 1 : 0 },
      async (d, hlc) => {
        if (nuovo) {
          await d.runAsync(
            `INSERT INTO note (id, titolo, testo, pubblicabile, creato_a, hlc) VALUES (?,?,?,?,?,?)`,
            [id, titolo || null, testo, pubblicabile ? 1 : 0, dataOra().toISOString(), hlc]
          );
        } else {
          await d.runAsync(
            `UPDATE note SET titolo = ?, testo = ?, pubblicabile = ?, hlc = ? WHERE id = ?`,
            [titolo || null, testo, pubblicabile ? 1 : 0, hlc, id]
          );
        }
      }
    );
    setApertaId(id);
    await ricarica();
  }

  const elenco = {
    nuova,
    filtroAttivo: soloPubblicabili,
    premiFiltro: () => setSoloPubblicabili((v) => !v),
    vuoto: note.length === 0,
    testoVuoto:
      "Nessuna nota. Una per sessione di lettura: che cosa si applica a MSF o al tuo lavoro. È la nota l'obiettivo, non le pagine lette.",
    voci: note.map((n) => ({
      id: n.id,
      titolo: n.titolo || "senza titolo",
      anteprima: n.testo,
      daPubblicare: n.pubblicabile === 1,
      evidenziata: apertaId === n.id,
      premi: () => apriNota(n),
    })),
  };

  const editor = apertaId
    ? {
        tipo: "editor",
        titolo,
        testo,
        pubblicabile,
        scriviTitolo: setTitolo,
        scriviTesto: setTesto,
        spunta: () => setPubblicabile((v) => !v),
        salva,
      }
    : { tipo: "invito", testo: "Scegli una nota o creane una nuova." };

  return affiancato
    ? { disposizione: "affiancata", elenco, editor, larghezzaElenco: 320, ritornoElenco: null }
    : apertaId
      ? { disposizione: "editor", elenco, editor, ritornoElenco: () => setApertaId(null) }
      : { disposizione: "elenco", elenco, editor: null, ritornoElenco: null };
}

let contatoreUuid = 0;
const ambienteNote = {
  database: () => DB.database(),
  registra: (...a) => DB.registra(...a),
  randomUUID: () => `nota-${++contatoreUuid}`,
  larghezza: 392,
};

const noteSchermata = montaSenzaAttendere("Note", ModelloNote, { ...ambienteNote });
ok("F1 su telefono senza note si vede solo l'elenco", noteSchermata.schermo.disposizione === "elenco" && noteSchermata.schermo.editor === null);
await noteSchermata.stabilizza();
ok("F2 l'elenco vuoto mostra il testo guida sulla nota per sessione", noteSchermata.schermo.elenco.vuoto === true && noteSchermata.schermo.elenco.testoVuoto.startsWith("Nessuna nota."));

await ruota(noteSchermata, 700);
ok("F3 a 700dp si vedono elenco (320dp) e pannello destro con l'invito", noteSchermata.schermo.disposizione === "affiancata" && noteSchermata.schermo.editor.tipo === "invito" && noteSchermata.schermo.larghezzaElenco === 320);
await ruota(noteSchermata, 392);

await tocca(noteSchermata, () => noteSchermata.schermo.elenco.nuova());
ok("F4 'Nuova nota' apre l'editor vuoto con la casella non spuntata", noteSchermata.schermo.disposizione === "editor" && noteSchermata.schermo.editor.titolo === "" && noteSchermata.schermo.editor.testo === "" && noteSchermata.schermo.editor.pubblicabile === false);
ok("F5 su telefono compare il ritorno all'elenco", typeof noteSchermata.schermo.ritornoElenco === "function");

// --- NOT-05: salvare a vuoto non fa niente, e non lo dice
avvisi.length = 0;
const noteInDbPrima = (await base.getFirstAsync("SELECT count(*) AS n FROM note")).n;
await tocca(noteSchermata, () => noteSchermata.schermo.editor.scriviTesto("    \n  "));
await tocca(noteSchermata, () => noteSchermata.schermo.editor.salva());
const noteInDbDopo = (await base.getFirstAsync("SELECT count(*) AS n FROM note")).n;
difetto("NOT-05", "F6 con titolo e testo di soli spazi il pulsante nero non scrive nulla e non spiega perche'", noteInDbDopo === noteInDbPrima && avvisi.length === 0);

// --- salvataggio di una nota nuova
await tocca(noteSchermata, () => noteSchermata.schermo.editor.scriviTitolo("Kleppmann cap. 5"));
await tocca(noteSchermata, () => noteSchermata.schermo.editor.scriviTesto("La replica a singolo leader si applica al registro eventi di MSF."));
await tocca(noteSchermata, () => noteSchermata.schermo.editor.salva());
ok("F7 la nota nuova compare in cima all'elenco", noteSchermata.schermo.elenco.voci[0].titolo === "Kleppmann cap. 5");
ok("F8 dopo il salvataggio la nota aperta e' quella vera (l'editor resta sul contenuto)", noteSchermata.schermo.elenco.voci[0].evidenziata === true);
const eventoNota = await base.getFirstAsync("SELECT * FROM eventi WHERE entita = 'note' ORDER BY hlc DESC LIMIT 1");
ok("F9 il salvataggio passa dal registro con un evento 'crea'", eventoNota.tipo === "crea" && JSON.parse(eventoNota.payload).titolo === "Kleppmann cap. 5");
ok("F10 nessun riscontro visivo del salvataggio riuscito: nessun avviso", avvisi.length === 0);

// --- NOT-03: doppio tocco su Salva con una nota NUOVA.
// Due varianti, perche' sul telefono capitano tutte e due:
//   (a) due dita davvero contemporanee, con le due registra() sovrapposte;
//   (b) secondo tocco sul pulsante del disegno PRECEDENTE, cioe' prima che
//       React abbia mostrato il nuovo stato (setApertaId sta dopo l'await).
await tocca(noteSchermata, () => noteSchermata.schermo.elenco.nuova());
await tocca(noteSchermata, () => noteSchermata.schermo.editor.scriviTesto("Nota scritta con due dita."));
const primaDelDoppio = (await base.getFirstAsync("SELECT count(*) AS n FROM note")).n;
const esitiDoppioSalva = await toccaDueVolte(noteSchermata, () => noteSchermata.schermo.editor.salva());
const dopoIlDoppio = (await base.getFirstAsync("SELECT count(*) AS n FROM note")).n;
const messaggiDoppio = esitiDoppioSalva.map((e) => (e.status === "rejected" ? String(e.reason?.message) : "risolta"));
difetto("NOT-03/REG-06", "F11 due tocchi CONTEMPORANEI su Salva: tutte e due le scritture falliscono (transazione annidata) e l'utente non vede nulla", messaggiDoppio.includes("cannot start a transaction within a transaction") && avvisi.length === 0, messaggiDoppio.join(" | "));
const notaScrittaDueDita = await base.getAllAsync("SELECT id FROM note WHERE testo = 'Nota scritta con due dita.'");
const eventiDiQuellaNota = notaScrittaDueDita.length
  ? await base.getAllAsync("SELECT id FROM eventi WHERE entita_id = ?", [notaScrittaDueDita[0].id])
  : [];
difetto("NOT-03b", "F12 dopo il doppio tocco resta una nota SENZA il suo evento: la riga e' stata scritta fuori dalla transazione e non si sincronizzera' mai", dopoIlDoppio === primaDelDoppio + 1 && notaScrittaDueDita.length === 1 && eventiDiQuellaNota.length === 0, `note ${primaDelDoppio}->${dopoIlDoppio}, eventi della nota: ${eventiDiQuellaNota.length}`);

// (b) il secondo tocco usa il gestore del disegno precedente
await tocca(noteSchermata, () => noteSchermata.schermo.elenco.nuova());
await tocca(noteSchermata, () => noteSchermata.schermo.editor.scriviTesto("Secondo tocco sul pulsante vecchio."));
const salvaVecchio = noteSchermata.schermo.editor.salva;
const primaDelTardivo = (await base.getFirstAsync("SELECT count(*) AS n FROM note")).n;
await tocca(noteSchermata, () => salvaVecchio());
await tocca(noteSchermata, () => salvaVecchio());
const dopoIlTardivo = (await base.getFirstAsync("SELECT count(*) AS n FROM note")).n;
const duplicate = await base.getAllAsync("SELECT id FROM note WHERE testo = 'Secondo tocco sul pulsante vecchio.'");
difetto("NOT-03c", "F12b un secondo tocco sul pulsante del disegno precedente crea una SECONDA nota: apertaId e' ancora 'nuova' in quella chiusura", dopoIlTardivo === primaDelTardivo + 2 && duplicate.length === 2 && duplicate[0].id !== duplicate[1].id, `note ${primaDelTardivo}->${dopoIlTardivo}`);

// --- salvataggio di una nota ESISTENTE
const notaEsistente = noteSchermata.schermo.elenco.voci.find((v) => v.titolo === "Kleppmann cap. 5");
await tocca(noteSchermata, () => notaEsistente.premi());
ok("F13 aprendo una nota dall'elenco l'editor mostra titolo e testo salvati", noteSchermata.schermo.editor.titolo === "Kleppmann cap. 5" && noteSchermata.schermo.editor.testo.startsWith("La replica"));
const creatoPrima = (await base.getFirstAsync("SELECT creato_a FROM note WHERE id = ?", [notaEsistente.id])).creato_a;
await tocca(noteSchermata, () => noteSchermata.schermo.editor.scriviTesto("La replica a singolo leader si applica al registro eventi. Aggiunta."));
await tocca(noteSchermata, () => noteSchermata.schermo.editor.salva());
const creatoDopo = (await base.getFirstAsync("SELECT creato_a FROM note WHERE id = ?", [notaEsistente.id])).creato_a;
const eventiSullaNota = await base.getAllAsync("SELECT tipo FROM eventi WHERE entita_id = ? ORDER BY hlc", [notaEsistente.id]);
ok("F14 il salvataggio di una nota esistente e' un 'aggiorna' e non tocca creato_a", creatoDopo === creatoPrima && eventiSullaNota.map((e) => e.tipo).join(",") === "crea,aggiorna");
ok("F15 l'anteprima nell'elenco riporta il testo aggiornato", noteSchermata.schermo.elenco.voci.find((v) => v.id === notaEsistente.id).anteprima.endsWith("Aggiunta."));

await tocca(noteSchermata, () => noteSchermata.schermo.editor.salva());
const eventiDopoSalvataggioInutile = await base.getAllAsync("SELECT tipo FROM eventi WHERE entita_id = ?", [notaEsistente.id]);
difetto("NOT-04", "F16 salvare senza aver modificato nulla scrive comunque un altro evento nel registro", eventiDopoSalvataggioInutile.length === 3);

// --- la casella e il filtro
await tocca(noteSchermata, () => noteSchermata.schermo.editor.spunta());
ok("F17 la spunta 'Materiale per il post mensile' e' solo stato locale finche' non si salva", noteSchermata.schermo.editor.pubblicabile === true && (await base.getFirstAsync("SELECT pubblicabile FROM note WHERE id = ?", [notaEsistente.id])).pubblicabile === 0);
await tocca(noteSchermata, () => noteSchermata.schermo.editor.salva());
ok("F18 dopo il salvataggio la nota risulta da pubblicare, con il suo distintivo nell'elenco", noteSchermata.schermo.elenco.voci.find((v) => v.id === notaEsistente.id).daPubblicare === true);
await tocca(noteSchermata, () => noteSchermata.schermo.elenco.premiFiltro());
ok("F19 il filtro 'Da pubblicare' mostra solo le note marcate", noteSchermata.schermo.elenco.filtroAttivo === true && noteSchermata.schermo.elenco.voci.length === 1);
ok("F20 con il filtro attivo l'editor continua a mostrare la nota aperta", noteSchermata.schermo.editor.titolo === "Kleppmann cap. 5");

await tocca(noteSchermata, () => noteSchermata.schermo.elenco.premiFiltro());
const noteTotaliOra = (await base.getFirstAsync("SELECT count(*) AS n FROM note")).n;
ok("F21 spegnendo il filtro tornano tutte le note", noteSchermata.schermo.elenco.voci.length === noteTotaliOra, `${noteSchermata.schermo.elenco.voci.length} contro ${noteTotaliOra}`);

// --- NOT-06: nota aperta che sparisce dal filtro
const notaNonPubblicabile = noteSchermata.schermo.elenco.voci.find((v) => !v.daPubblicare);
await tocca(noteSchermata, () => notaNonPubblicabile.premi());
await tocca(noteSchermata, () => noteSchermata.schermo.elenco.premiFiltro());
const testoNotaAperta = noteSchermata.schermo.editor.testo;
difetto("NOT-06", "F22 sotto il filtro la nota aperta resta nell'editor pur non essendo piu' nell'elenco", testoNotaAperta.length > 0 && !noteSchermata.schermo.elenco.voci.some((v) => v.id === notaNonPubblicabile.id));
await tocca(noteSchermata, () => noteSchermata.schermo.elenco.premiFiltro());

// --- NOT-07: abbandono con modifiche non salvate
await tocca(noteSchermata, () => noteSchermata.schermo.editor.scriviTesto("Modifica della sera che non verra' salvata."));
avvisi.length = 0;
await tocca(noteSchermata, () => noteSchermata.schermo.elenco.nuova());
const testoSulDisco = (await base.getFirstAsync("SELECT testo FROM note WHERE id = ?", [notaNonPubblicabile.id])).testo;
difetto("NOT-07", "F23 'Nuova nota' scarta le modifiche non salvate senza chiedere niente", testoSulDisco === testoNotaAperta && avvisi.length === 0 && noteSchermata.schermo.editor.testo === "");

await tocca(noteSchermata, () => notaNonPubblicabile.premi());
await tocca(noteSchermata, () => noteSchermata.schermo.editor.scriviTesto("Seconda modifica, stavolta esco dall'elenco."));
await tocca(noteSchermata, () => noteSchermata.schermo.ritornoElenco());
difetto("NOT-07b", "F24 '← Tutte le note' butta via le modifiche allo stesso modo, senza bozza", noteSchermata.schermo.disposizione === "elenco" && (await base.getFirstAsync("SELECT testo FROM note WHERE id = ?", [notaNonPubblicabile.id])).testo === testoNotaAperta);

// --- il tasto indietro di sistema: la scheda si smonta con le modifiche in memoria
await tocca(noteSchermata, () => noteSchermata.schermo.elenco.voci[0].premi());
await tocca(noteSchermata, () => noteSchermata.schermo.editor.scriviTesto("Terza modifica, poi il tasto indietro."));
noteSchermata.smonta();
const noteRimontate = await monta("NoteRimontate", ModelloNote, { ...ambienteNote });
difetto("NOT-07c", "F25 rimontando la scheda la modifica in memoria e' sparita e nessuno l'ha salvata", noteRimontate.schermo.disposizione === "elenco" && !noteRimontate.schermo.elenco.voci.some((v) => v.anteprima.includes("Terza modifica")));

// --- la rotazione non perde il testo in scrittura
await tocca(noteRimontate, () => noteRimontate.schermo.elenco.nuova());
await tocca(noteRimontate, () => noteRimontate.schermo.editor.scriviTesto("Testo scritto prima di girare il telefono."));
await ruota(noteRimontate, 700);
ok("F26 ruotando a 700dp il testo in scrittura resta (vive nello stato, non nel componente)", noteRimontate.schermo.disposizione === "affiancata" && noteRimontate.schermo.editor.testo === "Testo scritto prima di girare il telefono.");
await ruota(noteRimontate, 392);
ok("F27 tornando a telefono con una nota aperta si vede l'editor a tutta pagina", noteRimontate.schermo.disposizione === "editor");

// --- solo titolo, titolo vuoto, testo con caratteri speciali
await tocca(noteRimontate, () => noteRimontate.schermo.editor.scriviTesto(""));
await tocca(noteRimontate, () => noteRimontate.schermo.editor.scriviTitolo("Solo titolo"));
await tocca(noteRimontate, () => noteRimontate.schermo.editor.salva());
ok("F28 una nota con il solo titolo si salva, con testo vuoto", (await base.getFirstAsync("SELECT testo FROM note WHERE titolo = 'Solo titolo'")).testo === "");
await tocca(noteRimontate, () => noteRimontate.schermo.elenco.nuova());
await tocca(noteRimontate, () => noteRimontate.schermo.editor.scriviTesto("Appunto con emoji 📌 e *markdown* e un \u0000 di controllo."));
await tocca(noteRimontate, () => noteRimontate.schermo.editor.salva());
const senzaTitolo = await base.getFirstAsync("SELECT titolo, testo FROM note WHERE testo LIKE 'Appunto con emoji%'");
ok("F29 il titolo vuoto finisce a NULL e l'elenco lo mostra come 'senza titolo'", senzaTitolo.titolo === null && noteRimontate.schermo.elenco.voci.some((v) => v.titolo === "senza titolo"));
ok("F30 emoji, markdown e caratteri di controllo si salvano alla lettera", senzaTitolo.testo.includes("📌") && senzaTitolo.testo.includes("*markdown*"));
noteRimontate.smonta();

// ===========================================================================
// SEZIONE G — app/(tabs)/profilo.tsx: sezioni vuote e sottotitoli fermi
// ===========================================================================
ancora("PRF artefatti", "app/(tabs)/profilo.tsx", "SELECT trimestre, count(*) AS n FROM artefatti GROUP BY trimestre ORDER BY trimestre");
ancora("PRF credenziali", "app/(tabs)/profilo.tsx", "IFNULL(sum(costo_usd),0) AS costo");
ancora("PRF invito supabase", "app/(tabs)/profilo.tsx", "Sincronizza il piano da Supabase.");
ancora("PRF effetto senza dipendenze", "app/(tabs)/profilo.tsx", "}, []);");
ancora("PRF sottotitolo promemoria", "app/(tabs)/profilo.tsx", "`Blocco ${prom.tipo} alle ${comeTesto(prom)}, ogni giorno.`");

/** Copia della macchina a stati di app/(tabs)/profilo.tsx. */
function ModelloProfilo(p) {
  const [art, setArt] = useStato([]);
  const [cred, setCred] = useStato([]);
  const [div, setDiv] = useStato(null);
  const [prom, setProm] = useStato(Prom.PREDEFINITO);

  useEffetto(() => {
    avvia(
      (async () => {
        const d = p.database();
        setArt(await d.getAllAsync("SELECT trimestre, count(*) AS n FROM artefatti GROUP BY trimestre ORDER BY trimestre"));
        setCred(
          await d.getAllAsync(
            "SELECT anno_previsto, count(*) AS n, IFNULL(sum(costo_usd),0) AS costo FROM credenziali GROUP BY anno_previsto ORDER BY anno_previsto"
          )
        );
        setDiv(await p.divergenzaCorrente());
        setProm(await p.leggiPromemoria());
      })()
    );
  }, []);

  return {
    titolo: "Profilo",
    sincronizzazione: {
      titolo: "Sincronizzazione",
      sottotitolo: div ? div.messaggio : "Accoppia i tuoi due dispositivi.",
      premi: () => instradatore.push("/sync"),
    },
    promemoria: {
      titolo: "Promemoria",
      sottotitolo: prom.attivo
        ? `Blocco ${prom.tipo} alle ${Prom.comeTesto(prom)}, ogni giorno.`
        : "Nessun avviso. Notifica locale, funziona anche in aereo.",
      premi: () => instradatore.push("/promemoria"),
    },
    artefatti: art.length === 0 ? ["Sincronizza il piano da Supabase."] : art.map((a) => `${a.trimestre} · ${a.n}`),
    credenziali:
      cred.length === 0
        ? ["Sincronizza il piano da Supabase."]
        : cred.map((c) => `Anno ${c.anno_previsto} · ${c.n} · ${c.costo.toFixed(0)} USD`),
  };
}

const ambienteProfilo = {
  database: () => DB.database(),
  divergenzaCorrente: () => StatoSync.divergenzaCorrente(),
  leggiPromemoria: () => NotificheApp.leggiPromemoria(),
};

const profilo = montaSenzaAttendere("Profilo", ModelloProfilo, { ...ambienteProfilo });
ok("G1 al primo disegno il sottotitolo della sincronizzazione e' il testo di ripiego", profilo.schermo.sincronizzazione.sottotitolo === "Accoppia i tuoi due dispositivi.");
await profilo.stabilizza();
ok("G2 senza piano sincronizzato entrambe le sezioni invitano a sincronizzare da Supabase", profilo.schermo.artefatti[0] === "Sincronizza il piano da Supabase." && profilo.schermo.credenziali[0] === "Sincronizza il piano da Supabase.");
ok("G3 il sottotitolo della sincronizzazione riporta la divergenza corrente", profilo.schermo.sincronizzazione.sottotitolo.startsWith("Dispositivi non accoppiati"), profilo.schermo.sincronizzazione.sottotitolo);
ok("G4 con i promemoria spenti il sottotitolo parla di notifica locale che funziona in aereo", profilo.schermo.promemoria.sottotitolo === "Nessun avviso. Notifica locale, funziona anche in aereo.");

navigazione.length = 0;
await tocca(profilo, () => profilo.schermo.promemoria.premi());
ok("G5 la voce Promemoria naviga a /promemoria", navigazione[0].dove === "/promemoria");
await toccaDueVolte(profilo, () => profilo.schermo.sincronizzazione.premi());
difetto("PRF-02b", "G6 il doppio tocco impila due volte la schermata di sincronizzazione", navigazione.length === 3);
navigazione.length = 0;

// --- PRF-02: si torna da /promemoria dopo aver acceso l'avviso
await NotificheApp.salvaPromemoria({ attivo: true, ora: 7, minuto: 30, tipo: "lettura" });
await profilo.stabilizza();
difetto("PRF-02", "G7 tornando dal promemoria il sottotitolo resta quello di prima: l'effetto non si riesegue", profilo.schermo.promemoria.sottotitolo === "Nessun avviso. Notifica locale, funziona anche in aereo.");
const profiloRimontato = await monta("ProfiloRimontato", ModelloProfilo, { ...ambienteProfilo });
ok("G8 rimontando la scheda il sottotitolo dice il blocco e l'ora", profiloRimontato.schermo.promemoria.sottotitolo === "Blocco lettura alle 07:30, ogni giorno.", profiloRimontato.schermo.promemoria.sottotitolo);
await KV.removeItem("promemoria");

// --- artefatti e credenziali popolati, compreso l'anno nullo e il costo mancante
await base.runAsync("INSERT INTO artefatti (id, titolo, trimestre, stato) VALUES ('art-1','Cruscotto','T1','pianificato')");
await base.runAsync("INSERT INTO credenziali (id, nome, ente, costo_usd, anno_previsto) VALUES ('cre-1','DP-900','Microsoft',99.4,2026)");
await base.runAsync("INSERT INTO credenziali (id, nome, ente, costo_usd, anno_previsto) VALUES ('cre-2','Senza anno','Ente',NULL,NULL)");
const profiloPieno = await monta("ProfiloPieno", ModelloProfilo, { ...ambienteProfilo });
ok("G9 gli artefatti compaiono come 'trimestre · conteggio'", profiloPieno.schermo.artefatti[0] === "T1 · 1", profiloPieno.schermo.artefatti[0]);
ok("G10 il costo NULL diventa 0 grazie a IFNULL, senza NaN ne' errori su toFixed", profiloPieno.schermo.credenziali.includes("Anno null · 1 · 0 USD"), profiloPieno.schermo.credenziali.join(" / "));
difetto("PRF-01", "G11 una credenziale senza anno previsto compare come 'Anno null'", profiloPieno.schermo.credenziali.some((r) => r.startsWith("Anno null")));
ok("G12 il costo viene arrotondato a zero decimali", profiloPieno.schermo.credenziali.includes("Anno 2026 · 1 · 99 USD"), profiloPieno.schermo.credenziali.join(" / "));

// --- una lettura che solleva lascia le sezioni vuote, in silenzio
const profiloRotto = await monta("ProfiloRotto", ModelloProfilo, {
  ...ambienteProfilo,
  database: () => {
    throw new Error("Database non aperto: chiamare apri() all'avvio.");
  },
});
difetto("PRF-01b", "G13 se la lettura solleva le sezioni restano al testo di ripiego, senza spiegazione", profiloRotto.schermo.artefatti[0] === "Sincronizza il piano da Supabase." && profiloRotto.rigetti.length === 1);


// ===========================================================================
// SEZIONE H — app/esercizi.tsx: coda, verifica, Avanti, doppio tocco
// ===========================================================================
ancora("ESE coda", "app/esercizi.tsx", "AND (t.esito IS NULL OR t.esito <> 'corretto') ORDER BY e.livello, e.id LIMIT 40");
ancora("ESE indice bloccato", "app/esercizi.tsx", "setIndice((i) => Math.min(i + 1, coda.length - 1));");
ancora("ESE pulsante disabilitato", "app/esercizi.tsx", "disabled={inCorso || !risposta.trim()}");
ancora("ESE colore del pulsante", "app/esercizi.tsx", 'backgroundColor: risposta.trim() ? "#18181B" : "#D4D4D8"');
ancora("ESE stato vuoto", "app/esercizi.tsx", "Nessun esercizio in coda.");
ancora("ESE nota sul confronto", "app/esercizi.tsx", '{!esito.corretto && esito.motivo !== "errore_sql" ? (');
ancora("ESE durata", "app/esercizi.tsx", "const durata = Math.round((Date.now() - iniziato) / 1000);");
ancora("ESE esito prima della scrittura", "app/esercizi.tsx", "setEsito(r);");
ancora("ESE altezza della consegna", "app/esercizi.tsx", "<View style={{ maxHeight: 220 }}>{Consegna}</View>");

/** Copia della macchina a stati di app/esercizi.tsx. */
function ModelloEsercizi(p) {
  const { width } = useDimensioni();
  const affiancato = width >= 600;

  const [coda, setCoda] = useStato([]);
  const [indice, setIndice] = useStato(0);
  const [risposta, setRisposta] = useStato("");
  const [esito, setEsito] = useStato(null);
  const [inCorso, setInCorso] = useStato(false);
  const [iniziato, setIniziato] = useStato(adesso());

  useEffetto(() => {
    avvia(
      (async () => {
        const d = p.database();
        const filtro = p.supportaWindowFunctions() ? "" : " AND tema_slug <> 'sql_window'";
        const righe = await d.getAllAsync(
          `SELECT e.* FROM esercizi e
           LEFT JOIN (SELECT esercizio_id, max(eseguito_a) AS ultimo, esito
                      FROM tentativi GROUP BY esercizio_id) t ON t.esercizio_id = e.id
           WHERE e.tipo = 'sql_eseguibile' AND e.dataset = 'palestra.db'${filtro}
             AND (t.esito IS NULL OR t.esito <> 'corretto')
           ORDER BY e.livello, e.id LIMIT 40`
        );
        setCoda(righe);
        setIniziato(adesso());
      })()
    );
  }, []);

  const corrente = coda[indice];

  async function controlla() {
    if (!corrente || !risposta.trim()) return;
    setInCorso(true);
    try {
      const esecutore = corrente.preparazione
        ? (sql) => p.eseguiConPreparazione(corrente.preparazione, sql)
        : p.esegui;
      const r = await Verifica.verifica(esecutore, risposta, corrente.soluzione_riferimento, {
        ordineRilevante: corrente.ordine_rilevante === 1,
      });
      setEsito(r);

      const id = p.randomUUID();
      const durata = Math.round((adesso() - iniziato) / 1000);
      await p.registra(
        "tentativi",
        id,
        "crea",
        { esercizio_id: corrente.id, esito: r.corretto ? "corretto" : "errato" },
        async (d, hlc) => {
          await d.runAsync(
            `INSERT INTO tentativi (id, esercizio_id, risposta, esito, motivo, durata_sec, eseguito_a, hlc)
             VALUES (?,?,?,?,?,?,?,?)`,
            [id, corrente.id, risposta, r.corretto ? "corretto" : "errato", r.motivo, durata, dataOra().toISOString(), hlc]
          );
        }
      );
    } finally {
      setInCorso(false);
    }
  }

  function avanti() {
    setRisposta("");
    setEsito(null);
    setIniziato(adesso());
    setIndice((i) => Math.min(i + 1, coda.length - 1));
  }

  if (!corrente) {
    return {
      stato: "vuoto",
      titolo: "Nessun esercizio in coda.",
      sottotitolo: "Hai risolto tutto quello che era rimasto aperto.",
    };
  }

  return {
    stato: "esercizio",
    indice,
    lunghezzaCoda: coda.length,
    consegna: {
      intestazione:
        `${corrente.id} · livello ${corrente.livello} · ${corrente.tema_slug}` +
        (corrente.ordine_rilevante === 1 ? " · l'ordine conta" : ""),
      testo: corrente.consegna,
      preparazione: corrente.preparazione,
      righeAttese: corrente.righe_attese != null ? `Righe attese: ${corrente.righe_attese}` : null,
    },
    editor: {
      risposta,
      scrivi: setRisposta,
      maiuscoleAutomatiche: false,
      correzioneAutomatica: false,
      pulsante: {
        colore: risposta.trim() ? "#18181B" : "#D4D4D8",
        disabilitato: inCorso || !risposta.trim(),
        indicatore: inCorso,
        premi: controlla,
      },
      avanti: esito ? avanti : null,
    },
    riquadroEsito: esito
      ? {
          sfondo: esito.corretto ? "#E8F5EE" : "#FDECEC",
          titolo: esito.corretto ? "Corretto" : "Non ancora",
          dettaglio: esito.dettaglio,
          errore: esito.errore ?? null,
          notaSulConfronto: !esito.corretto && esito.motivo !== "errore_sql",
          motivo: esito.motivo,
        }
      : null,
    disposizione: affiancato ? "affiancata" : "consegna-sopra-220dp",
  };
}

/** Esecutore programmabile: sostituisce esegui() di lib/palestra.ts. */
function creaEsecutore() {
  const chiamate = [];
  const regole = new Map();
  return {
    chiamate,
    programma(sql, esito) {
      regole.set(sql, esito);
    },
    azzera() {
      chiamate.length = 0;
      regole.clear();
    },
    async esegui(sql) {
      chiamate.push(sql);
      const r = regole.get(sql) ?? { colonne: ["n"], righe: [[1]] };
      if (r.attesa) await r.attesa;
      if (r.errore) throw new Error(r.errore);
      return { colonne: r.colonne ?? ["n"], righe: r.righe ?? [[1]] };
    },
  };
}

const motore = creaEsecutore();
let contatoreTentativi = 0;
const ambienteEsercizi = {
  database: () => DB.database(),
  supportaWindowFunctions: () => Palestra.supportaWindowFunctions(),
  esegui: (sql) => motore.esegui(sql),
  eseguiConPreparazione: (prep, sql) => motore.esegui(`PREPARAZIONE[${prep}] ${sql}`),
  registra: (...a) => DB.registra(...a),
  randomUUID: () => `tent-ese-${++contatoreTentativi}`,
  larghezza: 392,
};

const esercizi = montaSenzaAttendere("Esercizi", ModelloEsercizi, { ...ambienteEsercizi });
difetto("ESE-01", "H1 al primo disegno, con 148 esercizi aperti, la schermata dichiara 'Nessun esercizio in coda.'", esercizi.schermo.stato === "vuoto" && esercizi.schermo.sottotitolo === "Hai risolto tutto quello che era rimasto aperto.");
await esercizi.stabilizza();
ok("H2 caricata, la coda si ferma a 40 esercizi", esercizi.schermo.lunghezzaCoda === 40, String(esercizi.schermo.lunghezzaCoda));
ok("H3 l'intestazione mostra id, livello e tema dell'esercizio corrente", /^SQL-\d+ · livello \d+ · \S+/.test(esercizi.schermo.consegna.intestazione), esercizi.schermo.consegna.intestazione);
ok("H4 la consegna e' quella dell'esercizio, non vuota", esercizi.schermo.consegna.testo.length > 10);
ok("H5 con risposta vuota il pulsante e' grigio e disabilitato", esercizi.schermo.editor.pulsante.colore === "#D4D4D8" && esercizi.schermo.editor.pulsante.disabilitato === true);
ok("H6 la tastiera non corregge ne' mette maiuscole (una tastiera che corregge SELECT rende l'app inusabile)", esercizi.schermo.editor.maiuscoleAutomatiche === false && esercizi.schermo.editor.correzioneAutomatica === false);
ok("H7 prima di una verifica non c'e' nessun riquadro di esito ne' il pulsante Avanti", esercizi.schermo.riquadroEsito === null && esercizi.schermo.editor.avanti === null);

await tocca(esercizi, () => esercizi.schermo.editor.scrivi("   \n  "));
ok("H8 una risposta di soli spazi e a capo lascia il pulsante grigio e disabilitato", esercizi.schermo.editor.pulsante.disabilitato === true && esercizi.schermo.editor.pulsante.colore === "#D4D4D8");
await tocca(esercizi, () => esercizi.schermo.editor.pulsante.premi());
ok("H9 premendolo comunque (il tocco arriva prima del ridisegno) non succede nulla", esercizi.schermo.riquadroEsito === null);

// --- H: risposta corretta
const esercizioCorrente = esercizi.schermo.consegna.intestazione.split(" ")[0];
const rifCorrente = (await base.getFirstAsync("SELECT soluzione_riferimento, ordine_rilevante FROM esercizi WHERE id = ?", [esercizioCorrente])).soluzione_riferimento;
motore.programma(rifCorrente, { colonne: ["paese", "n"], righe: [["IT", 3], ["FR", 2]] });
motore.programma("SELECT paese, count(*) FROM visite GROUP BY paese", { colonne: ["paese", "n"], righe: [["IT", 3], ["FR", 2]] });
await tocca(esercizi, () => esercizi.schermo.editor.scrivi("SELECT paese, count(*) FROM visite GROUP BY paese"));
ok("H10 con del testo il pulsante diventa nero e attivo", esercizi.schermo.editor.pulsante.colore === "#18181B" && esercizi.schermo.editor.pulsante.disabilitato === false);
avanzaTempo(45_000);
await tocca(esercizi, () => esercizi.schermo.editor.pulsante.premi());
ok("H11 una risposta scritta diversamente ma con lo stesso risultato e' Corretto (invariante 3)", esercizi.schermo.riquadroEsito.titolo === "Corretto" && esercizi.schermo.riquadroEsito.sfondo === "#E8F5EE" && esercizi.schermo.riquadroEsito.dettaglio === "Risultato identico.");
ok("H12 comparso l'esito, compare anche il pulsante Avanti", typeof esercizi.schermo.editor.avanti === "function");
const tentativo1 = await base.getFirstAsync("SELECT * FROM tentativi WHERE id = 'tent-ese-1'");
ok("H13 il tentativo e' registrato come corretto, con motivo e durata in secondi", tentativo1.esito === "corretto" && tentativo1.motivo === "identico" && tentativo1.durata_sec === 45, JSON.stringify(tentativo1));
ok("H14 il riquadro verde non mostra la nota sul confronto (e' riservata agli errori)", esercizi.schermo.riquadroEsito.notaSulConfronto === false);
ok("H15 la coda resta di 40: l'esercizio appena risolto non sparisce durante la sessione", esercizi.schermo.lunghezzaCoda === 40);

// --- H: Avanti
const idPrimo = esercizi.schermo.consegna.intestazione;
await tocca(esercizi, () => esercizi.schermo.editor.avanti());
ok("H16 Avanti passa all'esercizio successivo, svuota la risposta e toglie l'esito", esercizi.schermo.indice === 1 && esercizi.schermo.editor.risposta === "" && esercizi.schermo.riquadroEsito === null && esercizi.schermo.consegna.intestazione !== idPrimo);

// --- H: errore SQL nella risposta
const rif2 = (await base.getFirstAsync("SELECT soluzione_riferimento FROM esercizi WHERE id = ?", [esercizi.schermo.consegna.intestazione.split(" ")[0]])).soluzione_riferimento;
motore.programma(rif2, { colonne: ["a"], righe: [[1]] });
motore.programma("SELEC * FROM visite", { errore: 'near "SELEC": syntax error' });
await tocca(esercizi, () => esercizi.schermo.editor.scrivi("SELEC * FROM visite"));
await tocca(esercizi, () => esercizi.schermo.editor.pulsante.premi());
ok("H17 una query che non gira da 'Non ancora' con il messaggio grezzo di SQLite", esercizi.schermo.riquadroEsito.titolo === "Non ancora" && esercizi.schermo.riquadroEsito.dettaglio === "La query non viene eseguita." && esercizi.schermo.riquadroEsito.errore.includes('near "SELEC": syntax error'));
ok("H18 con motivo errore_sql la nota sul confronto per risultato NON compare", esercizi.schermo.riquadroEsito.notaSulConfronto === false && esercizi.schermo.riquadroEsito.motivo === "errore_sql");
const tentativo2 = await base.getFirstAsync("SELECT * FROM tentativi WHERE id = 'tent-ese-2'");
difetto("QRY-02", "H19 un errore di battitura viene comunque registrato come tentativo 'errato': sporca la statistica", tentativo2.esito === "errato" && tentativo2.motivo === "errore_sql");

// --- H: risposta sbagliata (non un errore SQL)
motore.programma("SELECT 1", { colonne: ["a"], righe: [[9]] });
await tocca(esercizi, () => esercizi.schermo.editor.scrivi("SELECT 1"));
await tocca(esercizi, () => esercizi.schermo.editor.pulsante.premi());
ok("H20 una risposta con valori diversi mostra la nota 'il confronto e' sul risultato'", esercizi.schermo.riquadroEsito.titolo === "Non ancora" && esercizi.schermo.riquadroEsito.notaSulConfronto === true, esercizi.schermo.riquadroEsito.motivo);

// --- ESE-05: la soluzione di RIFERIMENTO non gira
motore.programma(rif2, { errore: "no such function: ROW_NUMBER" });
await tocca(esercizi, () => esercizi.schermo.editor.scrivi("SELECT 1"));
await tocca(esercizi, () => esercizi.schermo.editor.pulsante.premi());
ok("H21 se non gira la soluzione di riferimento il messaggio lo dice", esercizi.schermo.riquadroEsito.dettaglio === "La soluzione di riferimento non è eseguibile su questo dispositivo.");
const tentativoRif = await base.getFirstAsync("SELECT * FROM tentativi ORDER BY rowid DESC LIMIT 1");
difetto("ESE-05", "H22 un difetto del CONTENUTO viene registrato come tentativo 'errato' a carico dell'utente", tentativoRif.esito === "errato");
motore.programma(rif2, { colonne: ["a"], righe: [[1]] });

// --- ESE-03: lo spinner e il doppio tocco
const attesaVerifica = rimandata();
motore.programma("SELECT lento", { attesa: attesaVerifica.promessa, colonne: ["a"], righe: [[1]] });
await tocca(esercizi, () => esercizi.schermo.editor.scrivi("SELECT lento"));
const premiLento = esercizi.schermo.editor.pulsante.premi;
const verificaInVolo = premiLento();
await respira(3);
if (esercizi.sporco) esercizi.disegna();
ok("H23 durante l'esecuzione il pulsante mostra l'indicatore ed e' disabilitato", esercizi.schermo.editor.pulsante.indicatore === true && esercizi.schermo.editor.pulsante.disabilitato === true);
attesaVerifica.risolvi();
await tocca(esercizi, () => verificaInVolo);
ok("H24 finita l'esecuzione il pulsante torna attivo", esercizi.schermo.editor.pulsante.indicatore === false);

const chiamatePrima = motore.chiamate.length;
const tentativiPrima = (await base.getFirstAsync("SELECT count(*) AS n FROM tentativi")).n;
const esitiDoppioEsegui = await toccaDueVolte(esercizi, () => esercizi.schermo.editor.pulsante.premi());
const chiamateDopo = motore.chiamate.length;
const tentativiDopo = (await base.getFirstAsync("SELECT count(*) AS n FROM tentativi")).n;
difetto("ESE-03", "H25 due tocchi prima che inCorso diventi vero eseguono DUE verifiche complete (quattro query)", chiamateDopo - chiamatePrima === 4, `chiamate ${chiamateDopo - chiamatePrima}`);
difetto("ESE-03b", "H26 le due scritture concorrenti si accavallano: non si ottengono due tentativi puliti", tentativiDopo - tentativiPrima <= 1 && esitiDoppioEsegui.some((e) => e.status === "rejected"), `tentativi ${tentativiPrima}->${tentativiDopo}`);

// il doppio tocco seriale (secondo tocco sul pulsante del disegno precedente)
const premiVecchio = esercizi.schermo.editor.pulsante.premi;
const tentativiPrimaSeriale = (await base.getFirstAsync("SELECT count(*) AS n FROM tentativi")).n;
await tocca(esercizi, () => premiVecchio());
await tocca(esercizi, () => premiVecchio());
const tentativiDopoSeriale = (await base.getFirstAsync("SELECT count(*) AS n FROM tentativi")).n;
difetto("QRY-18", "H27 tocchi ripetuti sulla stessa risposta inseriscono un tentativo e un evento ogni volta", tentativiDopoSeriale - tentativiPrimaSeriale === 2);

// --- ESE-09: la durata cresce fra due verifiche consecutive senza Avanti
const idDurata = `tent-ese-${contatoreTentativi}`;
const durataPrecedente = (await base.getFirstAsync("SELECT durata_sec FROM tentativi WHERE id = ?", [idDurata])).durata_sec;
avanzaTempo(8 * 3600 * 1000);
await tocca(esercizi, () => esercizi.schermo.editor.pulsante.premi());
const durataLunga = (await base.getFirstAsync("SELECT durata_sec FROM tentativi ORDER BY rowid DESC LIMIT 1")).durata_sec;
difetto("ESE-09", "H28 la durata non si azzera fra due verifiche e non ha nessun tetto: otto ore registrate come durata del tentativo", durataLunga >= 28800 && durataLunga > durataPrecedente, `${durataPrecedente} -> ${durataLunga}`);
await tocca(esercizi, () => esercizi.schermo.editor.avanti());
avanzaTempo(5000);
await tocca(esercizi, () => esercizi.schermo.editor.scrivi("SELECT 1"));
motore.programma((await base.getFirstAsync("SELECT soluzione_riferimento FROM esercizi WHERE id = ?", [esercizi.schermo.consegna.intestazione.split(" ")[0]])).soluzione_riferimento, { colonne: ["a"], righe: [[1]] });
await tocca(esercizi, () => esercizi.schermo.editor.pulsante.premi());
const durataDopoAvanti = (await base.getFirstAsync("SELECT durata_sec FROM tentativi ORDER BY rowid DESC LIMIT 1")).durata_sec;
ok("H29 Avanti azzera il cronometro dell'esercizio: la durata riparte da pochi secondi", durataDopoAvanti === 5, String(durataDopoAvanti));

// --- ESE-07: si arriva in fondo alla coda come ci arriva l'utente, cioe'
// rispondendo: il pulsante Avanti esiste solo dopo un esito.
async function rispondiEAvanza(inst) {
  await tocca(inst, () => inst.schermo.editor.scrivi("SELECT 1"));
  await tocca(inst, () => inst.schermo.editor.pulsante.premi());
  await tocca(inst, () => inst.schermo.editor.avanti());
}
for (let k = esercizi.schermo.indice; k < 39; k++) await rispondiEAvanza(esercizi);
ok("H30 rispondendo a tutti si arriva all'ultimo esercizio della coda (indice 39)", esercizi.schermo.indice === 39, String(esercizi.schermo.indice));
const ultimaIntestazione = esercizi.schermo.consegna.intestazione;
await rispondiEAvanza(esercizi);
difetto("ESE-07", "H31 risolto l'ULTIMO esercizio, Avanti non avanza: l'indice resta a 39 e lo stato vuoto non si raggiunge mai", esercizi.schermo.indice === 39 && esercizi.schermo.stato === "esercizio" && esercizi.schermo.consegna.intestazione === ultimaIntestazione);
await rispondiEAvanza(esercizi);
await rispondiEAvanza(esercizi);
difetto("ESE-07b", "H32 insistendo si resta inchiodati sulla stessa scheda, che si svuota ogni volta senza nessuna spiegazione", esercizi.schermo.indice === 39 && esercizi.schermo.editor.risposta === "" && esercizi.schermo.riquadroEsito === null);

// --- il punto di rottura (schermata fresca: le prove precedenti hanno
// consumato la coda, e con una coda esaurita non ci sarebbe piu' nessun editor)
esercizi.smonta();
const eserciziLayout = await monta("EserciziLayout", ModelloEsercizi, { ...ambienteEsercizi });
await ruota(eserciziLayout, 600);
ok("H33 a 600dp consegna a sinistra ed editor a destra", eserciziLayout.schermo.disposizione === "affiancata");
const rispostaPrimaDellaRotazione = "SELECT nome FROM strutture";
await tocca(eserciziLayout, () => eserciziLayout.schermo.editor.scrivi(rispostaPrimaDellaRotazione));
await ruota(eserciziLayout, 392);
ok("H34 tornando sotto i 600dp la consegna torna sopra, alta al massimo 220dp", eserciziLayout.schermo.disposizione === "consegna-sopra-220dp");
ok("H35 la risposta gia' scritta sopravvive al cambio di disposizione", eserciziLayout.schermo.editor.risposta === rispostaPrimaDellaRotazione);

// --- uscita dalla schermata mentre la verifica e' in volo
const attesaUscita = rimandata();
motore.programma("SELECT in volo", { attesa: attesaUscita.promessa, colonne: ["a"], righe: [[1]] });
motore.programma((await base.getFirstAsync("SELECT soluzione_riferimento FROM esercizi WHERE id = ?", [eserciziLayout.schermo.consegna.intestazione.split(" ")[0]])).soluzione_riferimento, { colonne: ["a"], righe: [[1]] });
await tocca(eserciziLayout, () => eserciziLayout.schermo.editor.scrivi("SELECT in volo"));
const tentativiPrimaUscita = (await base.getFirstAsync("SELECT count(*) AS n FROM tentativi")).n;
const inVolo = eserciziLayout.schermo.editor.pulsante.premi();
eserciziLayout.smonta();
navigazione.push({ tipo: "back" });
attesaUscita.risolvi();
await inVolo;
await respira(4);
const tentativiDopoUscita = (await base.getFirstAsync("SELECT count(*) AS n FROM tentativi")).n;
difetto("ESE-03c", "H36 uscendo a meta' verifica il tentativo viene comunque registrato, e gli setState cadono su un componente smontato", tentativiDopoUscita === tentativiPrimaUscita + 1);

// --- coda davvero vuota: lo stesso schermo del caricamento
const esercizeVuoto = await monta("EserciziVuoto", ModelloEsercizi, {
  ...ambienteEsercizi,
  database: () => ({ getAllAsync: async () => [] }),
});
difetto("ESE-01b", "H37 una coda davvero vuota mostra lo STESSO schermo del caricamento: i due casi sono indistinguibili", esercizeVuoto.schermo.stato === "vuoto" && esercizeVuoto.schermo.titolo === "Nessun esercizio in coda.");

// --- esercizio con preparazione: si passa dall'esecutore della copia temporanea
const esercizioPreparato = await base.getFirstAsync("SELECT * FROM esercizi WHERE preparazione IS NOT NULL LIMIT 1");
const esercizePrep = await monta("EserciziPreparazione", ModelloEsercizi, {
  ...ambienteEsercizi,
  database: () => ({ getAllAsync: async () => [esercizioPreparato] }),
});
ok("H38 un esercizio con preparazione la mostra nel riquadro 'Preparazione gia' applicata'", esercizePrep.schermo.consegna.preparazione === esercizioPreparato.preparazione);
motore.azzera();
await tocca(esercizePrep, () => esercizePrep.schermo.editor.scrivi("SELECT 1"));
await tocca(esercizePrep, () => esercizePrep.schermo.editor.pulsante.premi());
ok("H39 con preparazione entrambe le query passano dall'esecutore della copia temporanea", motore.chiamate.length === 2 && motore.chiamate.every((c) => c.startsWith("PREPARAZIONE[")), motore.chiamate.join(" || "));
ok("H40 'Righe attese' compare solo quando l'esercizio lo dichiara", esercizePrep.schermo.consegna.righeAttese === (esercizioPreparato.righe_attese != null ? `Righe attese: ${esercizioPreparato.righe_attese}` : null));
esercizePrep.smonta();


// ===========================================================================
// SEZIONE I — app/codice.tsx: rubrica, fasi, esportazione, verdetto
// ===========================================================================
ancora("CDC rubrica nel render", "app/codice.tsx", 'const extra = JSON.parse(e.rubrica || "{}")');
ancora("CDC taglio della consegna", "app/codice.tsx", 'const codiceDifettoso = restoCodice.slice(1).join("\\n\\n") || restoCodice.join("\\n\\n");');
ancora("CDC soglia dell'ipotesi", "app/codice.tsx", "ipotesi.trim().length < 15");
ancora("CDC avanzamento libero", "app/codice.tsx", "setI((n) => n + 1);");
ancora("CDC stato vuoto", "app/codice.tsx", "Nessun modulo in coda.");
ancora("CDC categoria solo in confronto", "app/codice.tsx", 'extra.categoria && fase === "confronto"');
ancora("CDC esportazione", "app/codice.tsx", "if (await Sharing.isAvailableAsync()) await Sharing.shareAsync(file.uri);");
ancora("CDC blocco main", "app/codice.tsx", 'if __name__ == "__main__":');

/** Copia della macchina a stati di app/codice.tsx. */
function ModelloCodice(p) {
  const { width } = useDimensioni();
  const affiancato = width >= 600;

  const [coda, setCoda] = useStato([]);
  const [i, setI] = useStato(0);
  const [ipotesi, setIpotesi] = useStato("");
  const [fase, setFase] = useStato("ipotesi");
  const [iniziato, setIniziato] = useStato(adesso());

  useEffetto(() => {
    avvia(
      (async () => {
        const d = p.database();
        setCoda(
          await d.getAllAsync(
            `SELECT e.id, e.livello, e.consegna, e.soluzione_riferimento, e.rubrica
             FROM esercizi e WHERE e.tipo = 'lettura_codice'
               AND NOT EXISTS (SELECT 1 FROM tentativi t WHERE t.esercizio_id = e.id AND t.esito = 'corretto')
             ORDER BY e.livello, e.id`
          )
        );
        setIniziato(adesso());
      })()
    );
  }, []);

  const e = coda[i];
  if (!e) return { stato: "vuoto", titolo: "Nessun modulo in coda." };

  // ATTENZIONE: nel .tsx questa riga sta nel corpo del render, senza try/catch.
  const extra = JSON.parse(e.rubrica || "{}");
  const [titoloEconsegna, ...restoCodice] = e.consegna.split("\n\n");
  const codiceDifettoso = restoCodice.slice(1).join("\n\n") || restoCodice.join("\n\n");

  async function esportaPerIlPc() {
    const file = new FS.File(FS.Paths.cache, `${e.id}.py`);
    if (!file.exists) file.create();
    file.write(
      `# ${e.id} — modulo difettoso e test\n# Esegui: python ${e.id}.py\n\n` +
        `${codiceDifettoso}\n\n${extra.test ?? ""}\n\n` +
        `if __name__ == "__main__":\n    verifica(globals())\n    print("test superato")\n`
    );
    if (await Condivisione.isAvailableAsync()) await Condivisione.shareAsync(file.uri);
  }

  async function registraEsito(riuscito) {
    const id = p.randomUUID();
    const durata = Math.round((adesso() - iniziato) / 1000);
    await p.registra(
      "tentativi",
      id,
      "crea",
      { esercizio_id: e.id, esito: riuscito ? "corretto" : "parziale" },
      async (d, hlc) => {
        await d.runAsync(
          `INSERT INTO tentativi (id, esercizio_id, risposta, esito, motivo, durata_sec, eseguito_a, hlc)
           VALUES (?,?,?,?,?,?,?,?)`,
          [id, e.id, ipotesi, riuscito ? "corretto" : "parziale", extra.categoria ?? null, durata, dataOra().toISOString(), hlc]
        );
      }
    );
    setIpotesi("");
    setFase("ipotesi");
    setIniziato(adesso());
    setI((n) => n + 1);
  }

  return {
    stato: "modulo",
    indice: i,
    lunghezzaCoda: coda.length,
    intestazione: `${e.id} · livello ${e.livello} ${extra.categoria && fase === "confronto" ? `· ${extra.categoria}` : ""}`,
    testoInAlto: titoloEconsegna,
    codiceDifettoso,
    fase,
    ipotesi,
    scriviIpotesi: setIpotesi,
    campoModificabile: fase === "ipotesi",
    sfondoCampo: fase === "ipotesi" ? "#fff" : "#FAFAFA",
    mostraIlTest:
      fase === "ipotesi"
        ? {
            colore: ipotesi.trim().length >= 15 ? "#18181B" : "#D4D4D8",
            premi: () =>
              ipotesi.trim().length < 15
                ? Avviso.alert(
                    "Scrivi prima l'ipotesi",
                    "Anche sbagliata. Saltare questo passo rende l'esercizio lettura passiva e ne annulla il valore."
                  )
                : setFase("test"),
          }
        : null,
    pannelloTest: fase !== "ipotesi" ? { testo: extra.test, esporta: esportaPerIlPc } : null,
    mostraIlDifetto: fase === "test" ? { premi: () => setFase("confronto") } : null,
    confronto:
      fase === "confronto"
        ? {
            difetto: e.soluzione_riferimento,
            correzione: extra.corretto,
            individuato: () => registraEsito(true),
            mancato: () => registraEsito(false),
          }
        : null,
    disposizione: affiancato ? "affiancata" : "codice-sopra-300dp",
  };
}

let contatoreCodice = 0;
const ambienteCodice = {
  database: () => DB.database(),
  registra: (...a) => DB.registra(...a),
  randomUUID: () => `tent-cod-${++contatoreCodice}`,
  larghezza: 392,
};

const codice = montaSenzaAttendere("Codice", ModelloCodice, { ...ambienteCodice });
difetto("COD-01", "I1 al primo disegno la schermata dichiara 'Nessun modulo in coda.' pur avendone 19", codice.schermo.stato === "vuoto");
await codice.stabilizza();
ok("I2 caricata, la coda contiene i 19 moduli non ancora individuati", codice.schermo.lunghezzaCoda === 19, String(codice.schermo.lunghezzaCoda));
ok("I3 si parte in fase ipotesi, con il campo modificabile e bianco", codice.schermo.fase === "ipotesi" && codice.schermo.campoModificabile === true && codice.schermo.sfondoCampo === "#fff");
ok("I4 il pannello del test e il confronto restano chiusi", codice.schermo.pannelloTest === null && codice.schermo.confronto === null);
ok("I5 la categoria del difetto NON compare in fase ipotesi (sarebbe un indizio)", !codice.schermo.intestazione.includes("·  ") && /^COD-\d+ · livello \d+ *$/.test(codice.schermo.intestazione), codice.schermo.intestazione);
ok("I6 il codice difettoso e' nel blocco scuro", codice.schermo.codiceDifettoso.includes("def ") || codice.schermo.codiceDifettoso.length > 20);

// --- CDC-02: il taglio della consegna, misurato su TUTTI i moduli veri
// Il campo `consegna` nel database e' `${titolo}\n\n${consegna}\n\n${codice}`
// (lib/contenuti.ts riga 106): il secondo blocco e' proprio la consegna, e
// slice(1) lo butta via. Qui lo si misura su tutti e venti i moduli veri.
const codiceOriginale = new Map(
  JSON.parse(readFileSync(join(RADICE_PROGETTO, "assets/contenuti/esercizi_codice.json"), "utf8")).map((c) => [
    c.id,
    { consegna: c.consegna, codice: c.codice_difettoso },
  ])
);
const moduliVeri = await base.getAllAsync("SELECT id, consegna FROM esercizi WHERE tipo = 'lettura_codice'");
const appiattisci = (x) => String(x).replace(/\s+/g, " ").trim();
let consegnePerse = 0;
let codiciInteri = 0;
let conRigheVuoteNelCodice = 0;
for (const m of moduliVeri) {
  const originale = codiceOriginale.get(m.id);
  const [titolo, ...resto] = m.consegna.split("\n\n");
  const mostrato = resto.slice(1).join("\n\n") || resto.join("\n\n");
  if (!appiattisci(`${titolo} ${mostrato}`).includes(appiattisci(originale.consegna))) consegnePerse++;
  if (appiattisci(mostrato) === appiattisci(originale.codice)) codiciInteri++;
  if (resto.length > 2) conRigheVuoteNelCodice++;
}
difetto("CDC-02", "I7 su tutti e 20 i moduli veri il testo della consegna (secondo blocco) non arriva a schermo: resta solo il titolo", consegnePerse === 20, `consegne perse: ${consegnePerse}`);
ok("I8 il codice difettoso arriva comunque intero, anche nel modulo che ha una riga vuota dentro il codice", codiciInteri === 20 && conRigheVuoteNelCodice === 1, `codici interi ${codiciInteri}, con riga vuota ${conRigheVuoteNelCodice}`);

// --- CDC-03: la soglia dei 15 caratteri
avvisi.length = 0;
await tocca(codice, () => codice.schermo.scriviIpotesi("troppo corta"));
ok("I9 sotto i 15 caratteri il pulsante e' grigio", codice.schermo.mostraIlTest.colore === "#D4D4D8");
await tocca(codice, () => codice.schermo.mostraIlTest.premi());
ok("I10 premendolo compare l'avviso e la fase non cambia", ultimoAvviso().titolo === "Scrivi prima l'ipotesi" && codice.schermo.fase === "ipotesi");
await tocca(codice, () => codice.schermo.scriviIpotesi("               "));
await tocca(codice, () => codice.schermo.mostraIlTest.premi());
ok("I11 quindici spazi non bastano: il trim li toglie", codice.schermo.fase === "ipotesi" && avvisi.length === 2);
await tocca(codice, () => codice.schermo.scriviIpotesi("aaaaaaaaaaaaaaa"));
difetto("CDC-03", "I12 quindici caratteri qualsiasi aprono il pannello: il vincolo e' sulla lunghezza, non sul contenuto", codice.schermo.mostraIlTest.colore === "#18181B");
await tocca(codice, () => codice.schermo.mostraIlTest.premi());
ok("I13 raggiunta la soglia si passa alla fase test", codice.schermo.fase === "test");
ok("I14 in fase test il campo dell'ipotesi diventa non modificabile e grigio", codice.schermo.campoModificabile === false && codice.schermo.sfondoCampo === "#FAFAFA");
ok("I15 compaiono il test e il pulsante di esportazione", codice.schermo.pannelloTest !== null && typeof codice.schermo.pannelloTest.esporta === "function");
difetto("CDC-03b", "I16 non esiste nessun modo di tornare alla fase ipotesi per correggere quanto scritto", codice.schermo.mostraIlTest === null);

// --- CDC-04/COD-05: esportazione per il computer
Condivisione.azzera();
Condivisione.programmaDisponibilita(true);
await tocca(codice, () => codice.schermo.pannelloTest.esporta());
const idModulo = codice.schermo.intestazione.split(" ")[0];
const fileEsportato = new FS.File(FS.Paths.cache, `${idModulo}.py`);
ok("I17 l'esportazione scrive <id>.py nella cache", fileEsportato.exists === true);
const contenutoPy = await fileEsportato.text();
ok("I18 il file contiene intestazione, codice difettoso, test e blocco __main__", contenutoPy.startsWith(`# ${idModulo} — modulo difettoso e test`) && contenutoPy.includes('if __name__ == "__main__":') && contenutoPy.includes("verifica(globals())"));
ok("I19 con il foglio di condivisione disponibile il file viene condiviso", Condivisione.giornale.some((g) => g.chiamata === "shareAsync"));

Condivisione.azzera();
Condivisione.programmaDisponibilita(false);
avvisi.length = 0;
await tocca(codice, () => codice.schermo.pannelloTest.esporta());
difetto("COD-05", "I20 senza foglio di condivisione il file viene scritto ma a schermo non succede NULLA", !Condivisione.giornale.some((g) => g.chiamata === "shareAsync") && avvisi.length === 0);
Condivisione.programmaDisponibilita(true);

// --- fase confronto e verdetto
await tocca(codice, () => codice.schermo.mostraIlDifetto.premi());
ok("I21 in fase confronto compaiono il difetto e la correzione", codice.schermo.fase === "confronto" && codice.schermo.confronto.difetto.length > 5 && codice.schermo.confronto.correzione.length > 5);
ok("I22 solo ora l'intestazione rivela la categoria del difetto", /· \w+$/.test(codice.schermo.intestazione.trim()) && codice.schermo.intestazione.split("·").length === 3, codice.schermo.intestazione);

avanzaTempo(120_000);
const moduloValutato = idModulo;
await tocca(codice, () => codice.schermo.confronto.mancato());
const tentativoParziale = await base.getFirstAsync("SELECT * FROM tentativi WHERE esercizio_id = ? ORDER BY rowid DESC LIMIT 1", [moduloValutato]);
ok("I23 'Non l'avevo visto' registra un tentativo parziale con motivo uguale alla categoria", tentativoParziale.esito === "parziale" && tentativoParziale.motivo !== null && tentativoParziale.risposta === "aaaaaaaaaaaaaaa");
ok("I24 dopo il verdetto si torna in fase ipotesi, con campo svuotato e modulo successivo", codice.schermo.fase === "ipotesi" && codice.schermo.ipotesi === "" && codice.schermo.indice === 1);
ok("I25 il cronometro del modulo riparte: la durata registrata era quella vera", tentativoParziale.durata_sec === 120, String(tentativoParziale.durata_sec));

const codaDopoParziale = await base.getAllAsync(
  `SELECT e.id FROM esercizi e WHERE e.tipo = 'lettura_codice'
     AND NOT EXISTS (SELECT 1 FROM tentativi t WHERE t.esercizio_id = e.id AND t.esito = 'corretto')`
);
ok("I26 un modulo segnato 'parziale' resta in coda, come promette il testo a schermo", codaDopoParziale.some((r) => r.id === moduloValutato));

// --- COD-06: doppio tocco sul verdetto
async function portaAlConfronto(inst) {
  await tocca(inst, () => inst.schermo.scriviIpotesi("ipotesi lunga abbastanza per passare"));
  await tocca(inst, () => inst.schermo.mostraIlTest.premi());
  await tocca(inst, () => inst.schermo.mostraIlDifetto.premi());
}
await portaAlConfronto(codice);
const indicePrimaDelDoppio = codice.schermo.indice;
const moduloSaltato = codice.schermo.lunghezzaCoda > indicePrimaDelDoppio + 1 ? codice.schermo.indice + 1 : null;
const individuaVecchio = codice.schermo.confronto.individuato;
const tentativiPrimaCodice = (await base.getFirstAsync("SELECT count(*) AS n FROM tentativi")).n;
await tocca(codice, () => individuaVecchio());
await tocca(codice, () => individuaVecchio());
const tentativiDopoCodice = (await base.getFirstAsync("SELECT count(*) AS n FROM tentativi")).n;
difetto("COD-06", "I27 un secondo tocco sul verdetto registra un altro tentativo E fa avanzare l'indice di due: un modulo viene saltato senza essere mostrato", tentativiDopoCodice - tentativiPrimaCodice === 2 && codice.schermo.indice === indicePrimaDelDoppio + 2 && moduloSaltato !== null, `indice ${indicePrimaDelDoppio} -> ${codice.schermo.indice}`);

// --- il punto di rottura e la conservazione della fase
await portaAlConfronto(codice);
await ruota(codice, 700);
ok("I28 a 700dp codice a sinistra e pannello a destra, fase e ipotesi conservate", codice.schermo.disposizione === "affiancata" && codice.schermo.fase === "confronto" && codice.schermo.ipotesi.startsWith("ipotesi lunga"));
await ruota(codice, 392);
ok("I29 sotto i 600dp il codice torna in alto (massimo 300dp)", codice.schermo.disposizione === "codice-sopra-300dp");

// --- indietro in fase confronto senza dare il verdetto
const tentativiPrimaUscitaCodice = (await base.getFirstAsync("SELECT count(*) AS n FROM tentativi")).n;
codice.smonta();
const codiceRimontato = await monta("CodiceRimontato", ModelloCodice, { ...ambienteCodice });
const tentativiDopoUscitaCodice = (await base.getFirstAsync("SELECT count(*) AS n FROM tentativi")).n;
difetto("COD-06b", "I30 uscendo in fase confronto senza verdetto si perdono ipotesi e tempo impiegato, e nessun tentativo viene registrato", tentativiDopoUscitaCodice === tentativiPrimaUscitaCodice && codiceRimontato.schermo.fase === "ipotesi" && codiceRimontato.schermo.ipotesi === "");

// --- CDC-01: rubrica illeggibile, rubrica 'null', rubrica assente
const moduloFinto = (nomeRubrica) => ({
  id: "COD-99",
  livello: 3,
  consegna: "Titolo\n\nConsegna\n\ncodice()",
  soluzione_riferimento: "il difetto",
  rubrica: nomeRubrica,
});
const rubricaRotta = await tenta(() =>
  monta("CodiceRubricaRotta", ModelloCodice, {
    ...ambienteCodice,
    database: () => ({ getAllAsync: async () => [moduloFinto('{"corretto":"x","test":')] }),
  })
);
difetto("CDC-01", "I31 una rubrica JSON troncata fa cadere l'intero albero in fase di render: schermata rossa in sviluppo, chiusura in release", rubricaRotta.riuscito === false && rubricaRotta.errore.includes("JSON"), String(rubricaRotta.errore));

const rubricaNulla = await tenta(() =>
  monta("CodiceRubricaNull", ModelloCodice, {
    ...ambienteCodice,
    database: () => ({ getAllAsync: async () => [moduloFinto("null")] }),
  })
);
difetto("CDC-01b", "I32 la stringa 'null' passa JSON.parse e poi extra.categoria solleva nello stesso render", rubricaNulla.riuscito === false && rubricaNulla.errore.includes("null"), String(rubricaNulla.errore));

const rubricaAssente = await monta("CodiceRubricaAssente", ModelloCodice, {
  ...ambienteCodice,
  database: () => ({ getAllAsync: async () => [moduloFinto(null)] }),
});
await tocca(rubricaAssente, () => rubricaAssente.schermo.scriviIpotesi("ipotesi lunga abbastanza per passare"));
await tocca(rubricaAssente, () => rubricaAssente.schermo.mostraIlTest.premi());
difetto("CDC-01c", "I33 con rubrica NULL il blocco del test resta VUOTO, senza nessuna spiegazione", rubricaAssente.schermo.pannelloTest.testo === undefined);
Condivisione.azzera();
await tocca(rubricaAssente, () => rubricaAssente.schermo.pannelloTest.esporta());
const pyRotto = await new FS.File(FS.Paths.cache, "COD-99.py").text();
difetto("CDC-04", "I34 senza test l'esportazione produce un .py che chiama verifica(), funzione che nel file non esiste", pyRotto.includes("verifica(globals())") && !pyRotto.includes("def verifica"));

// --- fine della coda: qui, a differenza di /esercizi, lo stato vuoto si raggiunge
const codaCorta = await monta("CodiceCodaCorta", ModelloCodice, {
  ...ambienteCodice,
  database: () => ({ getAllAsync: async () => [moduloFinto('{"corretto":"x","test":"y","categoria":"z"}')] }),
});
await portaAlConfronto(codaCorta);
await tocca(codaCorta, () => codaCorta.schermo.confronto.individuato());
ok("I35 valutato l'ultimo modulo si raggiunge davvero 'Nessun modulo in coda.'", codaCorta.schermo.stato === "vuoto" && codaCorta.schermo.titolo === "Nessun modulo in coda.");

// ===========================================================================
// SEZIONE J — app/ripasso.tsx: coda di 30, scoperta, quattro gradi
// ===========================================================================
ancora("RIP coda", "app/ripasso.tsx", "WHERE r.prossima_revisione <= ? ORDER BY r.prossima_revisione LIMIT 30");
ancora("RIP fattori", "app/ripasso.tsx", "const fattore = [0, 1.2, 2.2, 3.4][grado];");
ancora("RIP ricaduta", "app/ripasso.tsx", 'grado === 0 ? "ricaduta" : "ripasso"');
ancora("RIP avanzamento", "app/ripasso.tsx", "setI((n) => n + 1);");
ancora("RIP stato vuoto", "app/ripasso.tsx", "Nessuna scheda da ripassare.");
ancora("RIP contatore", "app/ripasso.tsx", "{i + 1} di {coda.length}");

function prossimoRipasso(grado, stabilita) {
  if (grado === 0) return { stabilita: 0, giorni: 0 };
  const fattore = [0, 1.2, 2.2, 3.4][grado];
  const nuova = Math.max(1, (stabilita || 1) * fattore);
  return { stabilita: nuova, giorni: Math.round(nuova) };
}

/** Copia della macchina a stati di app/ripasso.tsx. */
function ModelloRipasso(p) {
  const [coda, setCoda] = useStato([]);
  const [i, setI] = useStato(0);
  const [scoperta, setScoperta] = useStato(false);

  useEffetto(() => {
    avvia(
      (async () => {
        const d = p.database();
        setCoda(
          await d.getAllAsync(
            `SELECT e.id, e.consegna, e.soluzione_riferimento, e.fonte_citazione
             FROM ripasso r JOIN esercizi e ON e.id = r.esercizio_id
             WHERE r.prossima_revisione <= ? ORDER BY r.prossima_revisione LIMIT 30`,
            [dataOra().toISOString()]
          )
        );
      })()
    );
  }, []);

  const s = coda[i];
  if (!s) return { stato: "vuoto", titolo: "Nessuna scheda da ripassare." };

  async function valuta(grado) {
    const d = p.database();
    const r = await d.getFirstAsync("SELECT stabilita FROM ripasso WHERE esercizio_id = ?", [s.id]);
    const { stabilita, giorni } = prossimoRipasso(grado, r?.stabilita ?? 0);
    const quando = new Date(adesso() + giorni * 864e5).toISOString();
    await p.registra("ripasso", s.id, "aggiorna", { grado, stabilita }, async (dd, hlc) => {
      await dd.runAsync(
        `UPDATE ripasso SET stabilita = ?, ripetizioni = ripetizioni + 1,
         ultima_revisione = ?, prossima_revisione = ?, stato = ? WHERE esercizio_id = ?`,
        [stabilita, dataOra().toISOString(), quando, grado === 0 ? "ricaduta" : "ripasso", s.id]
      );
    });
    setScoperta(false);
    setI((n) => n + 1);
  }

  const gradi = ["Di nuovo", "Difficile", "Bene", "Facile"];
  return {
    stato: "scheda",
    contatore: `${i + 1} di ${coda.length}`,
    indice: i,
    idScheda: s.id,
    domanda: s.consegna,
    risposta: scoperta ? s.soluzione_riferimento : null,
    fonte: scoperta && s.fonte_citazione ? s.fonte_citazione : null,
    mostraRisposta: scoperta ? null : () => setScoperta(true),
    gradi: scoperta
      ? gradi.map((g, n) => ({ etichetta: g, sfondo: n === 0 ? "#FDECEC" : "#F4F4F5", premi: () => valuta(n) }))
      : null,
  };
}

const ambienteRipasso = {
  database: () => DB.database(),
  registra: (...a) => DB.registra(...a),
};

const ripasso = montaSenzaAttendere("Ripasso", ModelloRipasso, { ...ambienteRipasso });
difetto("RIP-01", "J1 al primo disegno la schermata dice 'Nessuna scheda da ripassare' pur avendone 199 scadute", ripasso.schermo.stato === "vuoto");
await ripasso.stabilizza();
ok("J2 caricata, il contatore dice '1 di 30': la coda e' un'istantanea di 30 schede", ripasso.schermo.contatore === "1 di 30", ripasso.schermo.contatore);
ok("J3 la domanda e' visibile e la risposta e' nascosta", ripasso.schermo.domanda.length > 5 && ripasso.schermo.risposta === null && ripasso.schermo.gradi === null);

await tocca(ripasso, () => ripasso.schermo.mostraRisposta());
ok("J4 'Mostra la risposta' scopre la risposta e i quattro gradi", ripasso.schermo.risposta.length > 3 && ripasso.schermo.gradi.length === 4);
ok("J5 il primo grado ('Di nuovo') ha lo sfondo rosso chiaro", ripasso.schermo.gradi[0].etichetta === "Di nuovo" && ripasso.schermo.gradi[0].sfondo === "#FDECEC");
ok("J6 la scheda ha una citazione della fonte", typeof ripasso.schermo.fonte === "string" && ripasso.schermo.fonte.includes("—"), String(ripasso.schermo.fonte));
const eventiPrimaDiScoprire = (await base.getFirstAsync("SELECT count(*) AS n FROM eventi WHERE entita = 'ripasso'")).n;
ok("J7 scoprire la risposta non scrive nulla sul database", eventiPrimaDiScoprire === 0);

// --- valutazione 'Bene'
const schedaBene = ripasso.schermo.idScheda;
await tocca(ripasso, () => ripasso.schermo.gradi[2].premi());
const rigaBene = await base.getFirstAsync("SELECT * FROM ripasso WHERE esercizio_id = ?", [schedaBene]);
ok("J8 grado 'Bene' su una scheda nuova porta la stabilita' a 2.2 e la prossima revisione a due giorni", Math.abs(rigaBene.stabilita - 2.2) < 1e-9 && rigaBene.stato === "ripasso" && rigaBene.ripetizioni === 1);
const distanzaGiorni = Math.round((new Date(rigaBene.prossima_revisione).getTime() - adesso()) / 864e5);
ok("J9 la prossima revisione cade fra due giorni", distanzaGiorni === 2, String(distanzaGiorni));
const eventoRipasso = await base.getFirstAsync("SELECT * FROM eventi WHERE entita_id = ? AND entita = 'ripasso'", [schedaBene]);
ok("J10 la valutazione passa dal registro con tipo 'aggiorna' e payload {grado, stabilita}", eventoRipasso.tipo === "aggiorna" && JSON.parse(eventoRipasso.payload).grado === 2);
ok("J11 dopo la valutazione la risposta si richiude e si passa alla scheda successiva", ripasso.schermo.risposta === null && ripasso.schermo.contatore === "2 di 30");

// --- valutazione 'Di nuovo'
await tocca(ripasso, () => ripasso.schermo.mostraRisposta());
const schedaRicaduta = ripasso.schermo.idScheda;
await tocca(ripasso, () => ripasso.schermo.gradi[0].premi());
const rigaRicaduta = await base.getFirstAsync("SELECT * FROM ripasso WHERE esercizio_id = ?", [schedaRicaduta]);
ok("J12 grado 'Di nuovo' azzera la stabilita' e rimette la scheda scaduta adesso", rigaRicaduta.stabilita === 0 && rigaRicaduta.stato === "ricaduta" && new Date(rigaRicaduta.prossima_revisione).getTime() <= adesso());
ok("J13 la scheda ricaduta NON ricompare nella sessione in corso (la coda e' un'istantanea)", ripasso.schermo.idScheda !== schedaRicaduta && ripasso.schermo.contatore === "3 di 30");

// --- RIP-10: doppio tocco su un grado
await tocca(ripasso, () => ripasso.schermo.mostraRisposta());
const schedaDoppia = ripasso.schermo.idScheda;
const indicePrimaRipasso = ripasso.schermo.indice;
const valutaVecchio = ripasso.schermo.gradi[3].premi;
await tocca(ripasso, () => valutaVecchio());
await tocca(ripasso, () => valutaVecchio());
const rigaDoppia = await base.getFirstAsync("SELECT * FROM ripasso WHERE esercizio_id = ?", [schedaDoppia]);
const eventiDoppi = await base.getAllAsync("SELECT id FROM eventi WHERE entita_id = ? AND entita = 'ripasso'", [schedaDoppia]);
difetto("RIP-10", "J14 due tocchi sullo stesso grado scrivono due eventi, contano due ripetizioni e saltano una scheda", eventiDoppi.length === 2 && rigaDoppia.ripetizioni === 2 && ripasso.schermo.indice === indicePrimaRipasso + 2, `eventi ${eventiDoppi.length}, ripetizioni ${rigaDoppia.ripetizioni}, indice ${indicePrimaRipasso} -> ${ripasso.schermo.indice}`);

// --- REG-08 visto dalla schermata: la riga di ripasso non c'e' piu'
await tocca(ripasso, () => ripasso.schermo.mostraRisposta());
const schedaSenzaRiga = ripasso.schermo.idScheda;
await base.runAsync("DELETE FROM ripasso WHERE esercizio_id = ?", [schedaSenzaRiga]);
await tocca(ripasso, () => ripasso.schermo.gradi[2].premi());
const eventoOrfano = await base.getFirstAsync("SELECT id FROM eventi WHERE entita_id = ? AND entita = 'ripasso'", [schedaSenzaRiga]);
const rigaInesistente = await base.getFirstAsync("SELECT * FROM ripasso WHERE esercizio_id = ?", [schedaSenzaRiga]);
difetto("REG-08", "J15 se la riga di ripasso non esiste l'UPDATE non tocca nulla ma l'evento viene scritto lo stesso: registro e stato divergono", eventoOrfano !== null && rigaInesistente === null);

// --- RIP-11: una scrittura che fallisce non arriva all'utente
const ripassoRotto = await monta("RipassoRotto", ModelloRipasso, {
  ...ambienteRipasso,
  registra: async () => {
    throw new Error("disco pieno");
  },
});
await tocca(ripassoRotto, () => ripassoRotto.schermo.mostraRisposta());
const indicePrimaErrore = ripassoRotto.schermo.indice;
avvisi.length = 0;
const erroreValutazione = await tocca(ripassoRotto, () => ripassoRotto.schermo.gradi[1].premi());
difetto("RIP-11", "J16 se la scrittura fallisce la carta non avanza, la risposta resta scoperta e nessun avviso compare", erroreValutazione !== null && ripassoRotto.schermo.indice === indicePrimaErrore && ripassoRotto.schermo.risposta !== null && avvisi.length === 0);

// --- RIP-12: database non aperto, stesso schermo di 'hai finito tutto'
const ripassoSenzaDb = await monta("RipassoSenzaDb", ModelloRipasso, {
  ...ambienteRipasso,
  database: () => {
    throw new Error("Database non aperto: chiamare apri() all'avvio.");
  },
});
difetto("RIP-12", "J17 con il database non aperto la schermata dice 'Nessuna scheda da ripassare': indistinguibile da 'hai finito tutto'", ripassoSenzaDb.schermo.stato === "vuoto" && ripassoSenzaDb.rigetti.length === 1);

// --- fonte_citazione assente
const ripassoSenzaFonte = await monta("RipassoSenzaFonte", ModelloRipasso, {
  ...ambienteRipasso,
  database: () => ({
    getAllAsync: async () => [{ id: "X-1", consegna: "domanda", soluzione_riferimento: "risposta", fonte_citazione: null }],
    getFirstAsync: async () => ({ stabilita: 0 }),
  }),
});
await tocca(ripassoSenzaFonte, () => ripassoSenzaFonte.schermo.mostraRisposta());
ok("J18 con fonte_citazione NULL non compare nessuna riga di citazione e nessun 'null' a schermo", ripassoSenzaFonte.schermo.fonte === null && ripassoSenzaFonte.schermo.risposta === "risposta");

// --- RIP-04: finita la sessione restano scadute le altre
const ripassoSessione = await monta("RipassoSessione", ModelloRipasso, { ...ambienteRipasso });
for (let k = 0; k < 30; k++) {
  if (ripassoSessione.schermo.stato === "vuoto") break;
  await tocca(ripassoSessione, () => ripassoSessione.schermo.mostraRisposta());
  await tocca(ripassoSessione, () => ripassoSessione.schermo.gradi[2].premi());
}
const ancoraScadute = (await base.getFirstAsync("SELECT count(*) AS n FROM ripasso WHERE prossima_revisione <= ?", [dataOra().toISOString()])).n;
difetto("RIP-04", "J19 esaurite le 30 schede compare 'Nessuna scheda da ripassare' mentre ne restano scadute piu' di cento", ripassoSessione.schermo.stato === "vuoto" && ancoraScadute > 100, `ancora scadute: ${ancoraScadute}`);
const ripassoNuovaSessione = await monta("RipassoNuovaSessione", ModelloRipasso, { ...ambienteRipasso });
ok("J20 uscendo e rientrando la coda si ricostruisce con le schede rimaste", ripassoNuovaSessione.schermo.stato === "scheda" && ripassoNuovaSessione.schermo.contatore === "1 di 30");



// ===========================================================================
// SEZIONE K — app/lettore.tsx: caricamento, errori, salvataggio della pagina
// ===========================================================================
ancora("LET volume non trovato", "app/lettore.tsx", 'setErrore("Volume non trovato.");');
ancora("LET non sul dispositivo", "app/lettore.tsx", "Questo volume non è ancora sul dispositivo.");
ancora("LET id come stringa", "app/lettore.tsx", 'const v = await database().getFirstAsync<Volume>("SELECT * FROM biblioteca WHERE id = ?", [String(id)]);');
ancora("LET attesa prima di salvare", "app/lettore.tsx", 'if (id !== "prova") salvataggio.current = setTimeout(() => void salvaPagina(String(id), m.n), 1500);');
ancora("LET pulizia del timer", "app/lettore.tsx", "return () => { if (salvataggio.current) clearTimeout(salvataggio.current); };");
ancora("LET messaggio non JSON ignorato", "app/lettore.tsx", "try { m = JSON.parse(e.nativeEvent.data) as Messaggio; } catch { return; }");
ancora("LET traccia in logcat", "app/lettore.tsx", 'console.error("lettore:", m.messaggio);');

/** Copia della macchina a stati di app/lettore.tsx. */
function ModelloLettore(p) {
  const id = p.id;
  const [visore, setVisore] = useStato(null);
  const [pdf, setPdf] = useStato(null);
  const [volume, setVolume] = useStato(null);
  const [pagina, setPagina] = useStato(1);
  const [totale, setTotale] = useStato(0);
  const [errore, setErrore] = useStato(null);
  const salvataggio = useRif(null);

  useEffetto(() => {
    avvia(
      (async () => {
        try {
          setVisore(await p.preparaLettore());
          if (id === "prova") {
            setPdf(await p.pdfDiProva());
            return;
          }
          const v = await p.database().getFirstAsync("SELECT * FROM biblioteca WHERE id = ?", [String(id)]);
          if (!v) {
            setErrore("Volume non trovato.");
            return;
          }
          setVolume(v);
          if (!v.file_locale) {
            setErrore("Questo volume non è ancora sul dispositivo.");
            return;
          }
          setPagina(v.ultima_pagina > 0 ? v.ultima_pagina : 1);
          setPdf(v.file_locale);
        } catch (e) {
          setErrore(String(e));
        }
      })()
    );
    return () => {
      if (salvataggio.current) annullaTimer(salvataggio.current);
    };
  }, [id]);

  function suMessaggio(dati) {
    let m;
    try {
      m = JSON.parse(dati);
    } catch {
      return;
    }
    if (m.tipo === "pronto") setTotale(m.pagine);
    else if (m.tipo === "errore") {
      console_errori.push(["lettore:", m.messaggio]);
      setErrore(m.messaggio);
    } else if (m.tipo === "pagina") {
      setPagina(m.n);
      if (salvataggio.current) annullaTimer(salvataggio.current);
      if (id !== "prova") salvataggio.current = impostaTimeout(() => void p.salvaPagina(String(id), m.n), 1500);
    }
  }

  const intestazione = {
    indietro: () => instradatore.back(),
    titolo: id === "prova" ? "PDF di prova" : (volume?.titolo ?? ""),
    contatore: totale ? `${pagina} / ${totale}` : "",
  };

  if (errore) {
    return {
      stato: "errore",
      intestazione,
      testo: errore,
      ripiegoVisore: volume?.file_locale ? true : false,
      suMessaggio,
    };
  }
  if (!visore || !pdf) return { stato: "attesa", intestazione, indicatore: true, suMessaggio };
  return {
    stato: "lettore",
    intestazione,
    iniezione: `window.PERCORSO = ${JSON.stringify({ pdf, pagina })}; true;`,
    suMessaggio,
    suErroreWebView: (descrizione) => setErrore(descrizione),
  };
}

const ambienteLettore = {
  database: () => DB.database(),
  preparaLettore: () => Palestra.preparaLettore(),
  pdfDiProva: () => Palestra.pdfDiProva(),
  salvaPagina: (id, n) => Palestra.salvaPagina(id, n),
};

const lettoreProva = montaSenzaAttendere("LettoreProva", ModelloLettore, { ...ambienteLettore, id: "prova" });
ok("K1 mentre visore e pdf mancano si vede l'intestazione piu' l'indicatore", lettoreProva.schermo.stato === "attesa" && lettoreProva.schermo.indicatore === true);
ok("K2 l'intestazione ha subito il tasto indietro, anche durante l'attesa", typeof lettoreProva.schermo.intestazione.indietro === "function");
await lettoreProva.stabilizza();
ok("K3 con id 'prova' il titolo e' 'PDF di prova' e il lettore si carica", lettoreProva.schermo.stato === "lettore" && lettoreProva.schermo.intestazione.titolo === "PDF di prova");
ok("K4 il contatore resta vuoto finche' pdf.js non dice quante pagine ci sono", lettoreProva.schermo.intestazione.contatore === "");
await tocca(lettoreProva, () => lettoreProva.schermo.suMessaggio(JSON.stringify({ tipo: "pronto", pagine: 2 })));
ok("K5 il messaggio 'pronto' porta il contatore a '1 / 2'", lettoreProva.schermo.intestazione.contatore === "1 / 2");
await tocca(lettoreProva, () => lettoreProva.schermo.suMessaggio(JSON.stringify({ tipo: "pagina", n: 2 })));
ok("K6 sfogliando, il contatore segue la pagina", lettoreProva.schermo.intestazione.contatore === "2 / 2");
const timerDopoProva = timerAttivi();
ok("K7 per il PDF di prova non viene armato nessun salvataggio di pagina", timerDopoProva === 0, String(timerDopoProva));
await tocca(lettoreProva, () => lettoreProva.schermo.suMessaggio("{non json"));
ok("K8 un messaggio non JSON viene ignorato in silenzio, senza crash", lettoreProva.schermo.stato === "lettore");
await tocca(lettoreProva, () => lettoreProva.schermo.suMessaggio(JSON.stringify({ tipo: "sconosciuto" })));
ok("K9 un messaggio con tipo sconosciuto viene ignorato allo stesso modo", lettoreProva.schermo.stato === "lettore");
navigazione.length = 0;
await tocca(lettoreProva, () => lettoreProva.schermo.intestazione.indietro());
ok("K10 il tasto ← chiama router.back()", navigazione[0].tipo === "back");
lettoreProva.smonta();

// --- volume vero, con file: ripresa, sfogliamento, salvataggio differito
const volumeConFile = await base.getFirstAsync("SELECT * FROM biblioteca WHERE file_locale IS NOT NULL LIMIT 1");
const lettore = await monta("Lettore", ModelloLettore, { ...ambienteLettore, id: volumeConFile.id });
ok("K11 il lettore apre il volume e mostra il suo titolo", lettore.schermo.stato === "lettore" && lettore.schermo.intestazione.titolo === volumeConFile.titolo);
ok("K12 la pagina iniziale e' 1 quando non c'e' una ripresa", lettore.schermo.iniezione.includes('"pagina":1'));
await tocca(lettore, () => lettore.schermo.suMessaggio(JSON.stringify({ tipo: "pronto", pagine: 120 })));
await tocca(lettore, () => lettore.schermo.suMessaggio(JSON.stringify({ tipo: "pagina", n: 7 })));
ok("K13 cambiando pagina si arma un solo timer di salvataggio", timerAttivi() === 1 && lettore.schermo.intestazione.contatore === "7 / 120");
const eventiPrimaSalvataggio = (await base.getFirstAsync("SELECT count(*) AS n FROM eventi WHERE entita_id = ?", [volumeConFile.id])).n;
avanzaTempo(1400);
await respira(2);
const eventiA1400 = (await base.getFirstAsync("SELECT count(*) AS n FROM eventi WHERE entita_id = ?", [volumeConFile.id])).n;
ok("K14 prima di 1,5 secondi non e' stato ancora scritto niente", eventiA1400 === eventiPrimaSalvataggio);
avanzaTempo(200);
await respira(4);
const rigaDopoSalvataggio = await base.getFirstAsync("SELECT ultima_pagina FROM biblioteca WHERE id = ?", [volumeConFile.id]);
ok("K15 passati 1,5 secondi di quiete la pagina viene salvata nel registro e nella riga", rigaDopoSalvataggio.ultima_pagina === 7);

// sfogliata rapida: un solo evento alla fine
const eventiPrimaSfogliata = (await base.getFirstAsync("SELECT count(*) AS n FROM eventi WHERE entita_id = ?", [volumeConFile.id])).n;
for (let n = 8; n <= 30; n++) {
  await tocca(lettore, () => lettore.schermo.suMessaggio(JSON.stringify({ tipo: "pagina", n })));
  avanzaTempo(100);
}
avanzaTempo(1500);
await respira(4);
const eventiDopoSfogliata = (await base.getFirstAsync("SELECT count(*) AS n FROM eventi WHERE entita_id = ?", [volumeConFile.id])).n;
ok("K16 una sfogliata di 23 pagine produce un solo evento, non ventitre", eventiDopoSfogliata - eventiPrimaSfogliata === 1, String(eventiDopoSfogliata - eventiPrimaSfogliata));
ok("K17 la pagina salvata e' l'ultima della sfogliata", (await base.getFirstAsync("SELECT ultima_pagina FROM biblioteca WHERE id = ?", [volumeConFile.id])).ultima_pagina === 30);

// --- LET-04: si esce entro 1,5 secondi dall'ultimo cambio pagina
await tocca(lettore, () => lettore.schermo.suMessaggio(JSON.stringify({ tipo: "pagina", n: 88 })));
lettore.smonta();
avanzaTempo(5000);
await respira(4);
const paginaDopoUscita = (await base.getFirstAsync("SELECT ultima_pagina FROM biblioteca WHERE id = ?", [volumeConFile.id])).ultima_pagina;
difetto("LET-04", "K18 uscendo entro 1,5 secondi dall'ultimo cambio pagina la pagina NON viene mai salvata: alla riapertura si torna indietro", paginaDopoUscita === 30, String(paginaDopoUscita));

// --- la ripresa alla riapertura
const lettoreRiaperto = await monta("LettoreRiaperto", ModelloLettore, { ...ambienteLettore, id: volumeConFile.id });
ok("K19 riaprendo il volume si riparte dall'ultima pagina salvata", lettoreRiaperto.schermo.iniezione.includes('"pagina":30'));

// --- pagina fuori intervallo: nessuna validazione
await tocca(lettoreRiaperto, () => lettoreRiaperto.schermo.suMessaggio(JSON.stringify({ tipo: "pronto", pagine: 120 })));
await tocca(lettoreRiaperto, () => lettoreRiaperto.schermo.suMessaggio(JSON.stringify({ tipo: "pagina", n: 99999 })));
avanzaTempo(1600);
await respira(4);
difetto("LET-04b", "K20 una pagina fuori intervallo inviata dalla WebView viene salvata senza nessuna validazione", (await base.getFirstAsync("SELECT ultima_pagina FROM biblioteca WHERE id = ?", [volumeConFile.id])).ultima_pagina === 99999);

// --- messaggio di errore da pdf.js
console_errori.length = 0;
await tocca(lettoreRiaperto, () => lettoreRiaperto.schermo.suMessaggio(JSON.stringify({ tipo: "errore", messaggio: "InvalidPDFException: struttura non valida" })));
ok("K21 un errore del lettore finisce in console.error con il prefisso 'lettore:' (unica traccia in logcat)", console_errori.length === 1 && console_errori[0][0] === "lettore:");
ok("K22 lo schermo passa all'errore e offre il ripiego sul visore di sistema", lettoreRiaperto.schermo.stato === "errore" && lettoreRiaperto.schermo.ripiegoVisore === true && lettoreRiaperto.schermo.testo.includes("InvalidPDF"));
ok("K23 anche in errore l'intestazione con il tasto indietro resta", typeof lettoreRiaperto.schermo.intestazione.indietro === "function");
lettoreRiaperto.smonta();

// --- LET-05: la WebView che non dice niente
const lettoreMuto = await monta("LettoreMuto", ModelloLettore, { ...ambienteLettore, id: volumeConFile.id });
avanzaTempo(60_000);
await respira(3);
difetto("LET-05", "K24 se la WebView non invia ne' 'pronto' ne' 'errore' non scatta nessun tempo massimo: si resta su una pagina vuota per sempre", lettoreMuto.schermo.stato === "lettore" && lettoreMuto.schermo.intestazione.contatore === "" && timerAttivi() === 0);
await tocca(lettoreMuto, () => lettoreMuto.schermo.suErroreWebView("net::ERR_ACCESS_DENIED"));
ok("K25 onError della WebView porta allo stesso stato di errore, con la descrizione nativa", lettoreMuto.schermo.stato === "errore" && lettoreMuto.schermo.testo === "net::ERR_ACCESS_DENIED");
lettoreMuto.smonta();

// --- LET-02: id assente, inesistente, ripetuto
const lettoreSenzaId = await monta("LettoreSenzaId", ModelloLettore, { ...ambienteLettore, id: undefined });
difetto("LET-02", "K26 senza id si interroga il volume 'undefined' e si ottiene il generico 'Volume non trovato.'", lettoreSenzaId.schermo.stato === "errore" && lettoreSenzaId.schermo.testo === "Volume non trovato." && lettoreSenzaId.schermo.ripiegoVisore === false);
const lettoreIdDoppio = await monta("LettoreIdDoppio", ModelloLettore, { ...ambienteLettore, id: ["BIB-01", "BIB-02"] });
difetto("LET-02b", "K27 un id ripetuto nella query string diventa 'BIB-01,BIB-02' e nessun volume viene trovato", lettoreIdDoppio.schermo.stato === "errore" && lettoreIdDoppio.schermo.testo === "Volume non trovato.");
const volumeSenzaFile = await base.getFirstAsync("SELECT * FROM biblioteca WHERE file_locale IS NULL LIMIT 1");
const lettoreSenzaFile = await monta("LettoreSenzaFile", ModelloLettore, { ...ambienteLettore, id: volumeSenzaFile.id });
ok("K28 un volume non ancora scaricato lo dice, con il titolo nell'intestazione e senza ripiego", lettoreSenzaFile.schermo.stato === "errore" && lettoreSenzaFile.schermo.testo === "Questo volume non è ancora sul dispositivo." && lettoreSenzaFile.schermo.ripiegoVisore === false && lettoreSenzaFile.schermo.intestazione.titolo === volumeSenzaFile.titolo);

// --- preparaLettore che solleva
const lettoreVisoreRotto = await monta("LettoreVisoreRotto", ModelloLettore, {
  ...ambienteLettore,
  id: volumeConFile.id,
  preparaLettore: async () => {
    throw new Error("asset del lettore mancante");
  },
});
ok("K29 se la preparazione del lettore solleva, lo schermo mostra il testo dell'eccezione", lettoreVisoreRotto.schermo.stato === "errore" && lettoreVisoreRotto.schermo.testo.includes("asset del lettore mancante"));

// ===========================================================================
// SEZIONE L — app/promemoria.tsx: interruttore, ora, tipo, permessi
// ===========================================================================
ancora("PRM schermo bianco", "app/promemoria.tsx", 'if (!p) return <View style={{ flex: 1 }} />;');
ancora("PRM due conferme", "app/promemoria.tsx", "onBlur={confermaOra} onSubmitEditing={confermaOra}");
ancora("PRM ora non valida", "app/promemoria.tsx", 'Alert.alert("Ora non valida", "Scrivila come 07:30.");');
ancora("PRM uscita dopo il permesso negato", "app/promemoria.tsx", '{ text: "Impostazioni", onPress: () => void Linking.openSettings() }');
ancora("PRM sessioni del tipo", "app/promemoria.tsx", 'SELECT inizio FROM sessioni WHERE tipo = ? ORDER BY inizio DESC LIMIT 20');
ancora("PRM riga di stato", "app/promemoria.tsx", "` In coda nel sistema: ${inCoda}.`");
ancora("PRM banner permesso", "app/promemoria.tsx", "{p.attivo && !permesso ? (");

/** Copia della macchina a stati di app/promemoria.tsx. */
function ModelloPromemoria(p) {
  const [pref, setPref] = useStato(null);
  const [testoOra, setTestoOra] = useStato("");
  const [permesso, setPermesso] = useStato(true);
  const [inCoda, setInCoda] = useStato(0);
  const [fattoOggi, setFattoOggi] = useStato(false);

  useEffetto(() => {
    avvia(
      (async () => {
        const letto = await p.leggiPromemoria();
        setPref(letto);
        setTestoOra(Prom.comeTesto(letto));
        setPermesso(await p.permessoConcesso(false));
        setInCoda(await p.programmate());
        const righe = await p
          .database()
          .getAllAsync("SELECT inizio FROM sessioni WHERE tipo = ? ORDER BY inizio DESC LIMIT 20", [letto.tipo]);
        setFattoOggi(Prom.giaFattoOggi(letto, righe.map((r) => r.inizio), dataOra()));
      })()
    );
  }, []);

  async function aggiorna(nuovo, chiediPermesso) {
    setPref(nuovo);
    await p.salvaPromemoria(nuovo);
    if (nuovo.attivo && chiediPermesso && !(await p.permessoConcesso(true))) {
      setPermesso(false);
      Avviso.alert(
        "Permesso negato",
        "Android non consente a Percorso di mostrare notifiche. Concedilo dalle impostazioni del sistema, poi torna qui.",
        [
          { text: "Annulla", style: "cancel" },
          { text: "Impostazioni", onPress: () => p.apriImpostazioni() },
        ]
      );
      return;
    }
    setPermesso(await p.permessoConcesso(false));
    await p.applica(nuovo);
    setInCoda(await p.programmate());
  }

  function confermaOra() {
    if (!pref) return;
    const letto = Prom.daTesto(testoOra);
    if (!letto) {
      Avviso.alert("Ora non valida", "Scrivila come 07:30.");
      setTestoOra(Prom.comeTesto(pref));
      return;
    }
    // Nel .tsx e' `void aggiorna(...)`: qui la promessa si restituisce per
    // poterla attendere, il comportamento e' lo stesso.
    return aggiorna({ ...pref, ...letto }, pref.attivo);
  }

  if (!pref) return { stato: "bianco", indietro: null };

  const prossima = Prom.prossimaOccorrenza(pref, dataOra());
  const anteprima = Prom.testoNotifica(pref);

  return {
    stato: "pronto",
    indietro: () => instradatore.back(),
    interruttore: { valore: pref.attivo, cambia: (v) => aggiorna({ ...pref, attivo: v }, v) },
    bannerPermesso: pref.attivo && !permesso,
    apriImpostazioniDaBanner: () => p.apriImpostazioni(),
    testoOra,
    scriviOra: setTestoOra,
    confermaOra,
    tipi: ["mattina", "artefatto", "lettura", "paper", "ripasso"].map((t) => ({
      tipo: t,
      scelto: pref.tipo === t,
      premi: () => aggiorna({ ...pref, tipo: t }, pref.attivo),
    })),
    anteprima,
    rigaStato:
      (pref.attivo && prossima
        ? `Prossimo avviso: ${prossima.toLocaleString("it-IT", { weekday: "long", hour: "2-digit", minute: "2-digit" })}.`
        : "Nessun avviso programmato.") +
      (pref.attivo && fattoOggi ? " Il blocco di oggi risulta già registrato." : "") +
      ` In coda nel sistema: ${inCoda}.`,
    inCoda,
  };
}

let impostazioniAperte = 0;
const ambientePromemoria = {
  database: () => DB.database(),
  leggiPromemoria: () => NotificheApp.leggiPromemoria(),
  salvaPromemoria: (x) => NotificheApp.salvaPromemoria(x),
  permessoConcesso: (chiedi) => NotificheApp.permessoConcesso(chiedi),
  applica: (x) => NotificheApp.applica(x),
  programmate: () => NotificheApp.programmate(),
  apriImpostazioni: () => {
    impostazioniAperte++;
  },
};

Notifiche.azzera();
await KV.removeItem("promemoria");
const promemoriaAttesa = rimandata();
const promemoriaLento = montaSenzaAttendere("PromemoriaLento", ModelloPromemoria, {
  ...ambientePromemoria,
  leggiPromemoria: () => promemoriaAttesa.promessa.then(() => NotificheApp.leggiPromemoria()),
});
difetto("PRM-01", "L1 durante il caricamento la schermata e' completamente BIANCA: niente indicatore e niente tasto indietro", promemoriaLento.schermo.stato === "bianco" && promemoriaLento.schermo.indietro === null);
promemoriaAttesa.risolvi();
await promemoriaLento.stabilizza();
ok("L2 finito il caricamento compare lo schermo completo", promemoriaLento.schermo.stato === "pronto");
promemoriaLento.smonta();

// --- SCH-02: un passo dell'effetto che solleva.
// La mappa dei lettori diceva "la schermata resta BIANCA per sempre": misurato,
// NON e' cosi'. setP(letto) avviene PRIMA della lettura delle sessioni, quindi
// lo schermo si disegna lo stesso; quello che si perde in silenzio e' il resto
// dell'effetto (permesso, coda di sistema, 'gia' fatto oggi'). Lo schermo bianco
// si ottiene solo se la LETTURA DELLA PREFERENZA non risponde (caso L1).
const promemoriaRotto = await monta("PromemoriaRotto", ModelloPromemoria, {
  ...ambientePromemoria,
  database: () => {
    throw new Error("Database non aperto: chiamare apri() all'avvio.");
  },
});
difetto("SCH-02", "L3 una query che solleva dentro l'effetto non blocca lo schermo ma lo lascia con dati parziali e una promessa non gestita", promemoriaRotto.schermo.stato === "pronto" && promemoriaRotto.rigetti.length === 1 && promemoriaRotto.schermo.rigaStato.endsWith("In coda nel sistema: 0."), promemoriaRotto.schermo.stato);

// --- apertura normale
const promemoria = await monta("Promemoria", ModelloPromemoria, { ...ambientePromemoria });
ok("L4 senza preferenza salvata il campo mostra 07:00 e l'interruttore e' spento", promemoria.schermo.testoOra === "07:00" && promemoria.schermo.interruttore.valore === false);
ok("L5 il tipo predefinito e' 'mattina' ed e' quello evidenziato", promemoria.schermo.tipi.find((t) => t.scelto).tipo === "mattina");
ok("L6 l'anteprima mostra titolo e corpo della notifica del mattino", promemoria.schermo.anteprima.titolo === "Blocco del mattino" && promemoria.schermo.anteprima.corpo === "30 minuti. Apri Percorso e avvia il cronometro.");
ok("L7 a promemoria spento la riga di stato dice che non c'e' nessun avviso", promemoria.schermo.rigaStato === "Nessun avviso programmato. In coda nel sistema: 0.", promemoria.schermo.rigaStato);
ok("L8 con promemoria spento non compare nessun banner rosso", promemoria.schermo.bannerPermesso === false);

// --- SCH-03: accensione con permesso gia' concesso
Notifiche.programmaPermesso({ status: "granted" });
await tocca(promemoria, () => promemoria.schermo.interruttore.cambia(true));
ok("L9 accendendo con il permesso gia' concesso viene programmata UNA notifica", promemoria.schermo.inCoda === 1 && (await Notifiche.getAllScheduledNotificationsAsync()).length === 1);
ok("L10 nessun dialogo di sistema e nessun banner", Notifiche.conteggioRichiestePermesso() === 0 && promemoria.schermo.bannerPermesso === false);
ok("L11 la riga di stato annuncia il prossimo avviso", promemoria.schermo.rigaStato.startsWith("Prossimo avviso:") && promemoria.schermo.rigaStato.endsWith("In coda nel sistema: 1."), promemoria.schermo.rigaStato);
const preferenzaSalvata = JSON.parse(await KV.getItem("promemoria"));
ok("L12 la preferenza salvata contiene esattamente i quattro campi", Object.keys(preferenzaSalvata).join(",") === "attivo,ora,minuto,tipo" && preferenzaSalvata.attivo === true);
const programmata = (await Notifiche.getAllScheduledNotificationsAsync())[0];
ok("L13 la notifica e' quotidiana, alle 07:00, sul canale 'blocchi'", programmata.trigger.hour === 7 && programmata.trigger.minute === 0 && programmata.trigger.channelId === "blocchi");
ok("L14 il canale Android 'blocchi' e' stato creato", Notifiche.canaliRegistrati().some((c) => c.name === "Blocchi di studio"));

// --- SCH-08: cambio dell'ora, forme accettate
for (const [scritto, atteso] of [["7:30", "07:30"], ["0815", "08:15"], ["9.05", "09:05"], ["  06:45  ", "06:45"]]) {
  await tocca(promemoria, () => promemoria.schermo.scriviOra(scritto));
  await tocca(promemoria, () => promemoria.schermo.confermaOra());
  const attuale = (await Notifiche.getAllScheduledNotificationsAsync())[0];
  ok(`L15 '${scritto}' viene accettato e riprogrammato a ${atteso}`, (await Notifiche.getAllScheduledNotificationsAsync()).length === 1 && `${String(attuale.trigger.hour).padStart(2, "0")}:${String(attuale.trigger.minute).padStart(2, "0")}` === atteso, JSON.stringify(attuale.trigger));
}
ok("L16 dopo ogni cambio resta UNA sola notifica in coda, mai due", promemoria.schermo.inCoda === 1);
await tocca(promemoria, () => promemoria.schermo.scriviOra("0000"));
await tocca(promemoria, () => promemoria.schermo.confermaOra());
ok("L17 mezzanotte e' un'ora valida", (await Notifiche.getAllScheduledNotificationsAsync())[0].trigger.hour === 0);

// --- SCH-09: ora non valida
avvisi.length = 0;
const codaPrimaDellErrore = await Notifiche.getAllScheduledNotificationsAsync();
await tocca(promemoria, () => promemoria.schermo.scriviOra("25:00"));
await tocca(promemoria, () => promemoria.schermo.confermaOra());
ok("L18 un'ora fuori scala produce l'avviso e riporta il campo al valore precedente", ultimoAvviso().titolo === "Ora non valida" && promemoria.schermo.testoOra === "00:00");
const codaDopoErrore = await Notifiche.getAllScheduledNotificationsAsync();
ok("L19 con un'ora non valida non si salva e non si riprogramma nulla", codaDopoErrore.length === codaPrimaDellErrore.length && codaDopoErrore[0].identifier === codaPrimaDellErrore[0].identifier);
for (const sbagliata of ["7:3", "07:30:00", "7 : 30", "12345", "", "   "]) {
  avvisi.length = 0;
  await tocca(promemoria, () => promemoria.schermo.scriviOra(sbagliata));
  await tocca(promemoria, () => promemoria.schermo.confermaOra());
  ok(`L20 la forma '${sbagliata}' viene rifiutata con l'avviso`, ultimoAvviso().titolo === "Ora non valida" && promemoria.schermo.testoOra === "00:00");
}

// --- SCH-10: onBlur e onSubmitEditing scattano tutti e due
await tocca(promemoria, () => promemoria.schermo.scriviOra("07:30"));
const confermaVecchia = promemoria.schermo.confermaOra;
const esitiDoppiaConferma = await Promise.allSettled([confermaVecchia(), confermaVecchia()]);
await promemoria.stabilizza();
const codaDopoDoppiaConferma = await Notifiche.getAllScheduledNotificationsAsync();
difetto("SCH-10", "L21 due conferme per la stessa modifica (uscita dal campo piu' invio) eseguono due volte cancella+programma", esitiDoppiaConferma.every((e) => e.status === "fulfilled") && Notifiche.giornale.filter((g) => g.azione === "cancella-tutte").length >= 2);
difetto("SCH-10b", "L22 dopo la doppia conferma restano DUE notifiche quotidiane in coda: il telefono suonera' due volte", codaDopoDoppiaConferma.length === 2, `in coda: ${codaDopoDoppiaConferma.length}`);

// --- NOT-13: due applica() concorrenti con ore diverse, isolati dal resto
await NotificheApp.applica({ attivo: true, ora: 7, minuto: 30, tipo: "mattina" });
const codaPrimaConcorrenza = (await Notifiche.getAllScheduledNotificationsAsync()).length;
await Promise.all([
  NotificheApp.applica({ attivo: true, ora: 6, minuto: 0, tipo: "mattina" }),
  NotificheApp.applica({ attivo: true, ora: 21, minuto: 0, tipo: "lettura" }),
]);
const codaConcorrente = await Notifiche.getAllScheduledNotificationsAsync();
difetto("NOT-13", "L23 due applica() avviati senza attendersi lasciano DUE notifiche quotidiane: il telefono suona due volte", codaPrimaConcorrenza === 1 && codaConcorrente.length === 2, `in coda: ${codaConcorrente.length}`);
await NotificheApp.applica({ attivo: true, ora: 7, minuto: 30, tipo: "mattina" });

// --- SCH-12: cambio del tipo di blocco
const promemoriaTipo = await monta("PromemoriaTipo", ModelloPromemoria, { ...ambientePromemoria });
await tocca(promemoriaTipo, () => promemoriaTipo.schermo.tipi.find((t) => t.tipo === "artefatto").premi());
ok("L24 scegliendo 'artefatto' l'anteprima cambia e resta una sola notifica", promemoriaTipo.schermo.anteprima.titolo === "Blocco artefatto" && promemoriaTipo.schermo.anteprima.corpo.startsWith("45 minuti") && promemoriaTipo.schermo.inCoda === 1);
ok("L25 il chip scelto e' quello nuovo", promemoriaTipo.schermo.tipi.find((t) => t.scelto).tipo === "artefatto");

// --- SCH-13: 'gia' fatto oggi' non segue il tipo scelto
await DB.registra("sessioni", "sess-prom-1", "crea", { tipo: "artefatto", minuti: 45 }, async (d, hlc) => {
  await d.runAsync("INSERT INTO sessioni (id, tipo, inizio, minuti, hlc) VALUES (?,?,?,?,?)", [
    "sess-prom-1", "artefatto", dataOra().toISOString(), 45, hlc,
  ]);
});
const promemoriaFatto = await monta("PromemoriaFatto", ModelloPromemoria, { ...ambientePromemoria });
ok("L26 con il blocco di oggi gia' registrato la riga di stato lo dice", promemoriaFatto.schermo.rigaStato.includes("Il blocco di oggi risulta già registrato."), promemoriaFatto.schermo.rigaStato);
await tocca(promemoriaFatto, () => promemoriaFatto.schermo.tipi.find((t) => t.tipo === "paper").premi());
difetto("SCH-13", "L27 cambiando tipo la frase 'gia' registrato' resta quella del tipo precedente: non viene mai ricalcolata", promemoriaFatto.schermo.rigaStato.includes("Il blocco di oggi risulta già registrato.") && promemoriaFatto.schermo.anteprima.titolo === "Blocco paper");

// --- SCH-05: accensione con permesso negato per sempre
Notifiche.azzera();
Notifiche.programmaPermesso({ status: "denied", canAskAgain: false });
await KV.setItem("promemoria", JSON.stringify({ attivo: false, ora: 7, minuto: 0, tipo: "mattina" }));
await Notifiche.scheduleNotificationAsync({ content: { title: "vecchia" }, trigger: { type: "daily", hour: 5, minute: 0 } });
const promemoriaNegato = await monta("PromemoriaNegato", ModelloPromemoria, { ...ambientePromemoria });
avvisi.length = 0;
impostazioniAperte = 0;
await tocca(promemoriaNegato, () => promemoriaNegato.schermo.interruttore.cambia(true));
ok("L28 con il permesso negato compare l'avviso con Annulla e Impostazioni", ultimoAvviso().titolo === "Permesso negato" && ultimoAvviso().pulsanti.map((b) => b.text).join(",") === "Annulla,Impostazioni");
ok("L29 il permesso negato per sempre non viene richiesto di nuovo", Notifiche.conteggioRichiestePermesso() === 0);
ok("L30 compare il banner rosso: acceso ma non suonera'", promemoriaNegato.schermo.bannerPermesso === true);
const preferenzaNegata = JSON.parse(await KV.getItem("promemoria"));
difetto("SCH-05", "L31 la preferenza resta salvata come attiva ma applica() non viene mai chiamata: la vecchia notifica resta in coda", preferenzaNegata.attivo === true && (await Notifiche.getAllScheduledNotificationsAsync()).length === 1);
difetto("SCH-05b", "L32 'In coda nel sistema' resta il valore stantio letto all'apertura", promemoriaNegato.schermo.inCoda === 1);
await tocca(promemoriaNegato, () => pulsante(ultimoAvviso(), "Impostazioni").onPress());
ok("L33 il pulsante Impostazioni apre le impostazioni di sistema", impostazioniAperte === 1);

// --- SCH-07: spegnimento
await tocca(promemoriaNegato, () => promemoriaNegato.schermo.interruttore.cambia(false));
ok("L34 spegnendo si cancella tutto, anche senza permesso, e senza nessun dialogo", (await Notifiche.getAllScheduledNotificationsAsync()).length === 0 && promemoriaNegato.schermo.inCoda === 0 && Notifiche.conteggioRichiestePermesso() === 0);
ok("L35 spento, il banner rosso sparisce", promemoriaNegato.schermo.bannerPermesso === false);
ok("L36 la riga di stato torna a 'Nessun avviso programmato. In coda nel sistema: 0.'", promemoriaNegato.schermo.rigaStato === "Nessun avviso programmato. In coda nel sistema: 0.");

// --- SCH-11: cambio dell'ora a promemoria spento
avvisi.length = 0;
await tocca(promemoriaNegato, () => promemoriaNegato.schermo.scriviOra("06:15"));
await tocca(promemoriaNegato, () => promemoriaNegato.schermo.confermaOra());
ok("L37 a promemoria spento la nuova ora si salva senza chiedere permessi e senza programmare", JSON.parse(await KV.getItem("promemoria")).ora === 6 && (await Notifiche.getAllScheduledNotificationsAsync()).length === 0 && Notifiche.conteggioRichiestePermesso() === 0);

// --- SCH-04: accensione con permesso da chiedere e utente che concede
Notifiche.azzera();
Notifiche.programmaPermesso({ status: "undetermined", canAskAgain: true });
Notifiche.programmaRispostaRichiesta({ status: "granted" });
const promemoriaChiede = await monta("PromemoriaChiede", ModelloPromemoria, { ...ambientePromemoria });
avvisi.length = 0;
await tocca(promemoriaChiede, () => promemoriaChiede.schermo.interruttore.cambia(true));
ok("L38 il dialogo di sistema compare una sola volta e, concesso, si programma la notifica", Notifiche.conteggioRichiestePermesso() === 1 && promemoriaChiede.schermo.inCoda === 1 && avvisi.length === 0 && promemoriaChiede.schermo.bannerPermesso === false);

navigazione.length = 0;
await tocca(promemoriaChiede, () => promemoriaChiede.schermo.indietro());
ok("L39 il tasto ← torna indietro", navigazione[0].tipo === "back");
Notifiche.azzera();
await KV.removeItem("promemoria");


// ===========================================================================
// SEZIONE M — app/sync.tsx: accoppiamento, codice, scambio, dimenticanza
// ===========================================================================
ancora("SYN segnaposto", "app/sync.tsx", 'placeholder="XXXX-XXXX-XXXX-XXXX-X"');
ancora("SYN pulsante inserimento", "app/sync.tsx", "disabled={inserito.length < 4}");
ancora("SYN codice mostrato prima del salvataggio", "app/sync.tsx", "setCodiceMostrato(a.codice); await salvaAccoppiamento(a);");
ancora("SYN errore del codice", "app/sync.tsx", 'Alert.alert("Codice non valido", String(e));');
ancora("SYN dipendenza dal diario", "app/sync.tsx", "}, [ultimoDiario]);");
ancora("SYN conferma della dimenticanza", "app/sync.tsx", '"Dovrai rigenerare il codice su entrambi i dispositivi."');

/** Doppio dell'hook useAutoSync: il vero hook e' un'altra superficie. */
function creaHookSync() {
  const stato = { chiamate: 0, attesa: null, diarioDaPubblicare: [], dispositiviVisti: [] };
  return {
    stato,
    hook(dispositivo) {
      const [diario, setDiario] = useStato([]);
      stato.dispositiviVisti.push(dispositivo);
      return {
        ultimoDiario: diario,
        sincronizzaOra: async () => {
          stato.chiamate++;
          if (stato.attesa) await stato.attesa;
          setDiario(stato.diarioDaPubblicare);
        },
      };
    },
  };
}

/** Copia della macchina a stati di app/sync.tsx. */
function ModelloSync(p) {
  const [dispositivo, setDispositivo] = useStato("");
  const [accoppiato, setAccoppiato] = useStato(null);
  const [codiceMostrato, setCodiceMostrato] = useStato(null);
  const [inserito, setInserito] = useStato("");
  const [divergenza, setDivergenza] = useStato(null);
  const [inCorso, setInCorso] = useStato(false);

  const { ultimoDiario, sincronizzaOra } = p.hookSync(dispositivo);

  useEffetto(() => {
    avvia(
      (async () => {
        setDispositivo((await KV.getItem("dispositivo_id")) ?? "");
        setAccoppiato(await p.leggiAccoppiamentoSalvato());
        setDivergenza(await p.divergenzaCorrente());
      })()
    );
  }, [ultimoDiario]);

  async function genera() {
    const a = p.generaAccoppiamento();
    setCodiceMostrato(a.codice);
    await p.salvaAccoppiamento(a);
    setAccoppiato(a);
  }

  async function collega() {
    try {
      const a = p.leggiAccoppiamento(inserito);
      await p.salvaAccoppiamento(a);
      setAccoppiato(a);
      setInserito("");
      Avviso.alert("Accoppiato", "I due dispositivi ora condividono la stessa chiave.");
    } catch (e) {
      Avviso.alert("Codice non valido", String(e));
    }
  }

  const coloreDivergenza =
    divergenza?.livello === "allineati" ? "#E8F5EE" : divergenza?.livello === "leggera" ? "#FDF0D5" : "#FDECEC";

  return {
    dispositivo,
    riquadroDivergenza: divergenza
      ? { colore: coloreDivergenza, messaggio: divergenza.messaggio, minuti: divergenza.minutiDaUltimoScambio }
      : null,
    vista: accoppiato ? "accoppiato" : "da-accoppiare",
    genera,
    segnaposto: "XXXX-XXXX-XXXX-XXXX-X",
    inserito,
    scrivi: setInserito,
    collega,
    pulsanteCollegaDisabilitato: inserito.length < 4,
    codiceMostrato,
    notaCaratteri: codiceMostrato ? "Non contiene I, L, O né U: ogni carattere è inequivocabile." : null,
    riquadroVerde: accoppiato && !codiceMostrato ? "Dispositivi accoppiati." : null,
    sincronizza: {
      inCorso,
      colore: inCorso ? "#A1A1AA" : "#18181B",
      premi: async () => {
        setInCorso(true);
        await sincronizzaOra();
        setInCorso(false);
      },
    },
    riassuntoDiario: ultimoDiario.length ? `voci nel diario: ${ultimoDiario.length}` : null,
    dimentica: () =>
      Avviso.alert("Dimenticare l'accoppiamento?", "Dovrai rigenerare il codice su entrambi i dispositivi.", [
        { text: "Annulla", style: "cancel" },
        {
          text: "Dimentica",
          style: "destructive",
          onPress: async () => {
            await p.dimenticaAccoppiamento();
            setAccoppiato(null);
            setCodiceMostrato(null);
          },
        },
      ]),
  };
}

const hookSync = creaHookSync();
let ritardoSalvataggio = null;
const ambienteSync = {
  hookSync: (d) => hookSync.hook(d),
  leggiAccoppiamentoSalvato: () => StatoSync.leggiAccoppiamentoSalvato(),
  divergenzaCorrente: () => StatoSync.divergenzaCorrente(),
  generaAccoppiamento: () => Accoppiamento.generaAccoppiamento(),
  leggiAccoppiamento: (t) => Accoppiamento.leggiAccoppiamento(t),
  salvaAccoppiamento: async (a) => {
    if (ritardoSalvataggio) await ritardoSalvataggio;
    return StatoSync.salvaAccoppiamento(a);
  },
  dimenticaAccoppiamento: () => StatoSync.dimenticaAccoppiamento(),
};

const sync = montaSenzaAttendere("Sync", ModelloSync, { ...ambienteSync });
difetto("SYN-01", "M1 al primo disegno l'hook di sincronizzazione riceve un identificativo di dispositivo VUOTO", hookSync.stato.dispositiviVisti[0] === "");
await sync.stabilizza();
ok("M2 non accoppiati: riquadro rosso e vista di accoppiamento", sync.schermo.vista === "da-accoppiare" && sync.schermo.riquadroDivergenza.colore === "#FDECEC" && sync.schermo.riquadroDivergenza.messaggio.startsWith("Dispositivi non accoppiati"));
ok("M3 l'identificativo del dispositivo viene letto dal kv-store", sync.schermo.dispositivo.length === 8);
ok("M4 con meno di quattro caratteri il pulsante di inserimento e' disabilitato", sync.schermo.pulsanteCollegaDisabilitato === true);
await tocca(sync, () => sync.schermo.scrivi("AB"));
difetto("ACC-04b", "M5 il pulsante disabilitato non ha nessuna differenza visiva che lo segnali", sync.schermo.pulsanteCollegaDisabilitato === true && sync.schermo.codiceMostrato === null);
await tocca(sync, () => sync.schermo.scrivi(""));

// --- generazione del codice
await tocca(sync, () => sync.schermo.genera());
ok("M6 generando si passa alla vista accoppiata con il codice a schermo", sync.schermo.vista === "accoppiato" && typeof sync.schermo.codiceMostrato === "string");
const codiceGenerato = sync.schermo.codiceMostrato;
ok("M7 il codice e' formattato a blocchi di quattro", /^[0-9A-Z]{4}(-[0-9A-Z]{4})+(-[0-9A-Z])?$/.test(codiceGenerato), codiceGenerato);
ok("M8 la nota spiega che I, L, O e U non compaiono", sync.schermo.notaCaratteri.includes("I, L, O né U"));
const salvatoDavvero = await StatoSync.leggiAccoppiamentoSalvato();
ok("M9 il codice mostrato e' quello effettivamente salvato", salvatoDavvero.codice === codiceGenerato);
difetto("ACC-08", "M10 il segnaposto promette 4 blocchi piu' uno mentre il codice vero ne ha 8 piu' uno", sync.schermo.segnaposto.split("-").length === 5 && codiceGenerato.split("-").length === 9, `segnaposto ${sync.schermo.segnaposto}, codice con ${codiceGenerato.split("-").length} blocchi`);

// --- SYN-02: doppio tocco su 'Genera', con il salvataggio lento
const sync2 = await monta("SyncDoppiaGenerazione", ModelloSync, { ...ambienteSync });
const salvataggioLento = rimandata();
ritardoSalvataggio = salvataggioLento.promessa;
const generaVecchio = sync2.schermo.genera;
const primaGenerazione = generaVecchio();
await respira(2);
ritardoSalvataggio = null;
const secondaGenerazione = generaVecchio();
await secondaGenerazione;
if (sync2.sporco) sync2.disegna();
const mostratoDopoSeconda = sync2.schermo.codiceMostrato;
salvataggioLento.risolvi();
await primaGenerazione;
await sync2.stabilizza();
const salvatoFinale = await StatoSync.leggiAccoppiamentoSalvato();
difetto("SYN-02", "M11 due generazioni ravvicinate: il codice mostrato non e' quello salvato, e l'utente trascriverebbe un segreto che questo dispositivo non possiede", mostratoDopoSeconda !== salvatoFinale.codice, `mostrato ${mostratoDopoSeconda?.slice(0, 9)}…, salvato ${salvatoFinale.codice.slice(0, 9)}…`);
sync2.smonta();

// --- inserimento del codice dell'altro dispositivo
await StatoSync.dimenticaAccoppiamento();
const syncInserimento = await monta("SyncInserimento", ModelloSync, { ...ambienteSync });
avvisi.length = 0;
await tocca(syncInserimento, () => syncInserimento.schermo.scrivi(codiceGenerato));
await tocca(syncInserimento, () => syncInserimento.schermo.collega());
ok("M12 un codice valido accoppia, svuota il campo e conferma con l'avviso", ultimoAvviso().titolo === "Accoppiato" && syncInserimento.schermo.inserito === "" && syncInserimento.schermo.vista === "accoppiato");
ok("M13 accoppiati senza aver generato qui, si vede il riquadro verde e non il codice", syncInserimento.schermo.riquadroVerde === "Dispositivi accoppiati." && syncInserimento.schermo.codiceMostrato === null);
const salvatoDaInserimento = await StatoSync.leggiAccoppiamentoSalvato();
ok("M14 il segreto salvato e' quello dell'altro dispositivo", salvatoDaInserimento.segreto === salvatoDavvero.segreto);

// --- normalizzazione e codice sbagliato
await StatoSync.dimenticaAccoppiamento();
const syncNormalizza = await monta("SyncNormalizza", ModelloSync, { ...ambienteSync });
const codiceSporco = codiceGenerato.toLowerCase().replace(/-/g, " ");
await tocca(syncNormalizza, () => syncNormalizza.schermo.scrivi(codiceSporco));
avvisi.length = 0;
await tocca(syncNormalizza, () => syncNormalizza.schermo.collega());
ok("M15 minuscole, spazi e trattini mancanti vengono normalizzati e il codice passa", ultimoAvviso().titolo === "Accoppiato");
await StatoSync.dimenticaAccoppiamento();
const syncSbagliato = await monta("SyncSbagliato", ModelloSync, { ...ambienteSync });
const codiceRotto = codiceGenerato.slice(0, -1) + (codiceGenerato.endsWith("Z") ? "Y" : "Z");
await tocca(syncSbagliato, () => syncSbagliato.schermo.scrivi(codiceRotto));
avvisi.length = 0;
await tocca(syncSbagliato, () => syncSbagliato.schermo.collega());
ok("M16 un carattere sbagliato viene respinto dal carattere di controllo", ultimoAvviso().titolo === "Codice non valido" && syncSbagliato.schermo.vista === "da-accoppiare");
difetto("SCH-02c", "M17 il messaggio mostrato all'utente include il prefisso 'Error: '", ultimoAvviso().messaggio.startsWith("Error: "), ultimoAvviso().messaggio);

// --- 'Sincronizza adesso'
await StatoSync.salvaAccoppiamento(salvatoDavvero);
const syncScambio = await monta("SyncScambio", ModelloSync, { ...ambienteSync });
hookSync.stato.diarioDaPubblicare = [{ trasporto: "file", esito: "riuscito" }];
const attesaScambio = rimandata();
hookSync.stato.attesa = attesaScambio.promessa;
const scambioInVolo = syncScambio.schermo.sincronizza.premi();
await respira(2);
if (syncScambio.sporco) syncScambio.disegna();
ok("M18 durante lo scambio il pulsante diventa grigio con l'indicatore", syncScambio.schermo.sincronizza.inCorso === true && syncScambio.schermo.sincronizza.colore === "#A1A1AA");
attesaScambio.risolvi();
hookSync.stato.attesa = null;
await tocca(syncScambio, () => scambioInVolo);
ok("M19 finito lo scambio il pulsante torna nero e compare il riassunto del diario", syncScambio.schermo.sincronizza.inCorso === false && syncScambio.schermo.riassuntoDiario === "voci nel diario: 1");
const chiamatePrimaDoppio = hookSync.stato.chiamate;
await toccaDueVolte(syncScambio, () => syncScambio.schermo.sincronizza.premi());
difetto("SYN-04b", "M20 il doppio tocco su 'Sincronizza adesso' chiama due volte lo scambio: la guardia della schermata non basta", hookSync.stato.chiamate === chiamatePrimaDoppio + 2);

// --- 'Dimentica l'accoppiamento'
avvisi.length = 0;
await tocca(syncScambio, () => syncScambio.schermo.dimentica());
ok("M21 la dimenticanza chiede conferma, con Annulla e Dimentica", ultimoAvviso().titolo === "Dimenticare l'accoppiamento?" && ultimoAvviso().pulsanti.map((b) => b.text).join(",") === "Annulla,Dimentica");
ok("M22 'Annulla' non ha gestore: non cambia nulla", pulsante(ultimoAvviso(), "Annulla").onPress === undefined && syncScambio.schermo.vista === "accoppiato");
const divergenzaPrimaDimenticanza = syncScambio.schermo.riquadroDivergenza.messaggio;
await tocca(syncScambio, () => pulsante(ultimoAvviso(), "Dimentica").onPress());
ok("M23 confermando si torna alla vista non accoppiata e il segreto sparisce dal kv-store", syncScambio.schermo.vista === "da-accoppiare" && (await StatoSync.leggiAccoppiamentoSalvato()) === null);
difetto("SYN-05", "M24 il riquadro di divergenza non si aggiorna subito: dipende da [ultimoDiario]", syncScambio.schermo.riquadroDivergenza.messaggio === divergenzaPrimaDimenticanza);
// Si finge lo scambio riuscito con il vecchio pari: gli eventi risultano inviati.
await base.runAsync("UPDATE eventi SET sincronizzato = 1");
const inviatiAlVecchioPari = (await base.getFirstAsync("SELECT count(*) AS n FROM eventi WHERE sincronizzato = 1")).n;
await StatoSync.salvaAccoppiamento(salvatoDavvero);
await StatoSync.dimenticaAccoppiamento();
const ancoraMarcati = (await base.getFirstAsync("SELECT count(*) AS n FROM eventi WHERE sincronizzato = 1")).n;
const daInviareDopo = await DB.daSincronizzare();
difetto("SCH-01", "M25 dimenticato l'accoppiamento, gli eventi gia' inviati al vecchio pari restano marcati: il nuovo dispositivo non ricevera' mai la storia pregressa", ancoraMarcati === inviatiAlVecchioPari && inviatiAlVecchioPari > 0 && daInviareDopo.length === 0, `marcati ${inviatiAlVecchioPari}, ancora marcati ${ancoraMarcati}, da inviare ${daInviareDopo.length}`);
await base.runAsync("UPDATE eventi SET sincronizzato = 0");
syncScambio.smonta();

// ===========================================================================
// SEZIONE N — components/Cronometro.tsx: avvio, ripresa, chiusura
// ===========================================================================
ancora("CRO chiave del cronometro", "components/Cronometro.tsx", 'const CHIAVE = "cronometro_attivo";');
ancora("CRO guardia della chiusura", "components/Cronometro.tsx", "if (!attivo) return;");
ancora("CRO ripresa senza protezione", "components/Cronometro.tsx", "if (v) setAttivo(JSON.parse(v));");
ancora("CRO salvataggio prima dello stato", "components/Cronometro.tsx", "await AsyncStorageLike.setItem(CHIAVE, JSON.stringify(stato)); setAttivo(stato);");
ancora("CRO chiave tolta prima della scrittura", "components/Cronometro.tsx", "await AsyncStorageLike.removeItem(CHIAVE);");
ancora("CRO soglia del colore", "components/Cronometro.tsx", "const oltre = trascorsi >= previsti;");
ancora("CRO contatore", "components/Cronometro.tsx", 'const mm = String(Math.floor(trascorsi / 60)).padStart(2, "0");');

const ETICHETTE_CRONOMETRO = {
  mattina: "Mattina",
  artefatto: "Artefatto",
  lettura: "Lettura",
  paper: "Paper",
  ripasso: "Ripasso",
};

/** Copia della macchina a stati di components/Cronometro.tsx. */
function ModelloCronometro(p) {
  const [attivo, setAttivo] = useStato(null);
  const [adessoStato, setAdesso] = useStato(adesso());
  const timerRif = useRif(null);

  useEffetto(() => {
    avvia(
      (async () => {
        const v = await KV.getItem("cronometro_attivo");
        if (v) setAttivo(JSON.parse(v));
      })()
    );
  }, []);

  useEffetto(() => {
    if (attivo) {
      timerRif.current = impostaIntervallo(() => setAdesso(adesso()), 1000);
    }
    return () => {
      if (timerRif.current) annullaTimer(timerRif.current);
    };
  }, [attivo]);

  async function avviaBlocco(tipo) {
    const stato = { inizio: adesso(), tipo };
    await KV.setItem("cronometro_attivo", JSON.stringify(stato));
    setAttivo(stato);
  }

  async function ferma() {
    if (!attivo) return;
    const esito = Sessioni.chiudiSessione(attivo.inizio, adesso(), attivo.tipo);
    await KV.removeItem("cronometro_attivo");
    const tipo = attivo.tipo;
    const inizio = attivo.inizio;
    setAttivo(null);

    if (!esito.valida) {
      Avviso.alert("Non registrata", esito.motivo);
      return;
    }
    const id = p.randomUUID();
    await p.registra("sessioni", id, "crea", { tipo, minuti: esito.minuti }, async (d, hlc) => {
      await d.runAsync("INSERT INTO sessioni (id, tipo, inizio, minuti, hlc) VALUES (?,?,?,?,?)", [
        id,
        tipo,
        new Date(inizio).toISOString(),
        esito.minuti,
        hlc,
      ]);
    });
    if (esito.avviso) Avviso.alert("Registrata", esito.avviso);
    p.onRegistrata?.();
  }

  if (attivo) {
    const trascorsi = Math.floor((adessoStato - attivo.inizio) / 1000);
    const previsti = Sessioni.DURATA_PREVISTA[attivo.tipo] * 60;
    const mm = String(Math.floor(trascorsi / 60)).padStart(2, "0");
    const ss = String(trascorsi % 60).padStart(2, "0");
    const oltre = trascorsi >= previsti;
    return {
      stato: "in-corso",
      sfondo: oltre ? "#FDF0D5" : "#18181B",
      etichetta: `${ETICHETTE_CRONOMETRO[attivo.tipo]} · previsti ${Sessioni.DURATA_PREVISTA[attivo.tipo]} min`,
      contatore: `${mm}:${ss}`,
      oltre,
      chiudi: ferma,
    };
  }

  return {
    stato: "scelta",
    tipi: Object.keys(ETICHETTE_CRONOMETRO).map((t) => ({
      tipo: t,
      etichetta: ETICHETTE_CRONOMETRO[t],
      durata: `${Sessioni.DURATA_PREVISTA[t]} min`,
      premi: () => avviaBlocco(t),
    })),
  };
}

let contatoreSessioni = 0;
let registrateAvvisate = 0;
const ambienteCronometro = {
  registra: (...a) => DB.registra(...a),
  randomUUID: () => `sess-cro-${++contatoreSessioni}`,
  onRegistrata: () => {
    registrateAvvisate++;
  },
};

await KV.removeItem("cronometro_attivo");
const cronometro = await monta("Cronometro", ModelloCronometro, { ...ambienteCronometro });
ok("N1 senza blocco in corso si vedono i cinque tipi con le durate previste", cronometro.schermo.stato === "scelta" && cronometro.schermo.tipi.map((t) => `${t.etichetta} ${t.durata}`).join(", ") === "Mattina 30 min, Artefatto 45 min, Lettura 25 min, Paper 25 min, Ripasso 15 min");
ok("N2 senza blocco in corso non gira nessun timer", timerAttivi() === 0);

await tocca(cronometro, () => cronometro.schermo.tipi[0].premi());
ok("N3 avviando un blocco la vista diventa quella attiva, con etichetta e minuti previsti", cronometro.schermo.stato === "in-corso" && cronometro.schermo.etichetta === "Mattina · previsti 30 min" && cronometro.schermo.contatore === "00:00");
ok("N4 lo stato e' scritto nel kv-store PRIMA che la vista cambi: sopravvive alla chiusura dell'app", JSON.parse(await KV.getItem("cronometro_attivo")).tipo === "mattina");
ok("N5 il riquadro parte nero, non ambra", cronometro.schermo.sfondo === "#18181B" && cronometro.schermo.oltre === false);
avanzaTempo(65_000);
await cronometro.stabilizza();
ok("N6 dopo 65 secondi il contatore dice 01:05", cronometro.schermo.contatore === "01:05", cronometro.schermo.contatore);
avanzaTempo(29 * 60_000);
await cronometro.stabilizza();
ok("N7 superati i 30 minuti previsti il riquadro passa ad ambra", cronometro.schermo.oltre === true && cronometro.schermo.sfondo === "#FDF0D5");

// --- chiusura regolare
avvisi.length = 0;
registrateAvvisate = 0;
await tocca(cronometro, () => cronometro.schermo.chiudi());
const sessioneRegistrata = await base.getFirstAsync("SELECT * FROM sessioni WHERE id = 'sess-cro-1'");
ok("N8 chiudendo un blocco di 30 minuti e 5 secondi si registrano 30 minuti (arrotondamento al minuto)", sessioneRegistrata.minuti === 30 && sessioneRegistrata.tipo === "mattina", JSON.stringify(sessioneRegistrata));
ok("N9 la chiusura non mostra nessun avviso e richiama onRegistrata", avvisi.length === 0 && registrateAvvisate === 1);
ok("N10 la chiave del cronometro e' stata rimossa e la vista e' tornata alla scelta", (await KV.getItem("cronometro_attivo")) === null && cronometro.schermo.stato === "scelta");
ok("N11 chiuso il blocco il timer viene fermato", timerAttivi() === 0);
const eventoSessione = await base.getFirstAsync("SELECT * FROM eventi WHERE entita_id = 'sess-cro-1'");
ok("N12 la sessione passa dal registro eventi (l'app SCRIVE davvero le sessioni)", eventoSessione.entita === "sessioni" && eventoSessione.tipo === "crea");

// --- blocco troppo breve
await tocca(cronometro, () => cronometro.schermo.tipi[2].premi());
avanzaTempo(3 * 60_000);
await cronometro.stabilizza();
avvisi.length = 0;
registrateAvvisate = 0;
const sessioniPrimaBreve = (await base.getFirstAsync("SELECT count(*) AS n FROM sessioni")).n;
await tocca(cronometro, () => cronometro.schermo.chiudi());
ok("N13 un blocco di 3 minuti non viene registrato e l'avviso spiega perche'", ultimoAvviso().titolo === "Non registrata" && ultimoAvviso().messaggio === "meno di 5 minuti: non registrata");
ok("N14 nessuna riga, nessun evento e onRegistrata non viene chiamato", (await base.getFirstAsync("SELECT count(*) AS n FROM sessioni")).n === sessioniPrimaBreve && registrateAvvisate === 0);
ok("N15 la chiave viene comunque rimossa: il cronometro si azzera", (await KV.getItem("cronometro_attivo")) === null && cronometro.schermo.stato === "scelta");

// --- confine dei 5 minuti (4 minuti e 31 secondi arrotondano a 5)
await tocca(cronometro, () => cronometro.schermo.tipi[4].premi());
avanzaTempo(4 * 60_000 + 31_000);
await cronometro.stabilizza();
avvisi.length = 0;
await tocca(cronometro, () => cronometro.schermo.chiudi());
const sessioneConfine = await base.getFirstAsync("SELECT * FROM sessioni ORDER BY rowid DESC LIMIT 1");
ok("N16 quattro minuti e trentuno secondi arrotondano a 5 e la sessione viene registrata", sessioneConfine.minuti === 5 && sessioneConfine.tipo === "ripasso", JSON.stringify(sessioneConfine));

// --- oltre il doppio del previsto
await tocca(cronometro, () => cronometro.schermo.tipi[4].premi());
avanzaTempo(31 * 60_000);
await cronometro.stabilizza();
avvisi.length = 0;
await tocca(cronometro, () => cronometro.schermo.chiudi());
ok("N17 un ripasso di 31 minuti (oltre il doppio dei 15 previsti) si registra con l'avviso sullo sforamento", ultimoAvviso().titolo === "Registrata" && ultimoAvviso().messaggio.includes("oltre il doppio") && (await base.getFirstAsync("SELECT minuti FROM sessioni ORDER BY rowid DESC LIMIT 1")).minuti === 31);

// --- cronometro dimenticato acceso
await tocca(cronometro, () => cronometro.schermo.tipi[0].premi());
avanzaTempo(10 * 3600 * 1000);
await cronometro.stabilizza();
ok("N18 dopo dieci ore il contatore supera le due cifre: '600:00', senza troncamenti", cronometro.schermo.contatore === "600:00", cronometro.schermo.contatore);
avvisi.length = 0;
await tocca(cronometro, () => cronometro.schermo.chiudi());
ok("N19 oltre i 180 minuti si registra la durata PREVISTA del blocco, non le dieci ore", (await base.getFirstAsync("SELECT minuti FROM sessioni ORDER BY rowid DESC LIMIT 1")).minuti === 30 && ultimoAvviso().messaggio.includes("Cronometro rimasto acceso"));

// --- CRO-03: doppio tocco su 'Chiudi il blocco'
await tocca(cronometro, () => cronometro.schermo.tipi[0].premi());
avanzaTempo(20 * 60_000);
await cronometro.stabilizza();
const chiudiVecchio = cronometro.schermo.chiudi;
const sessioniPrimaDoppia = (await base.getFirstAsync("SELECT count(*) AS n FROM sessioni")).n;
registrateAvvisate = 0;
await tocca(cronometro, () => chiudiVecchio());
await tocca(cronometro, () => chiudiVecchio());
const sessioniDopoDoppia = (await base.getFirstAsync("SELECT count(*) AS n FROM sessioni")).n;
difetto("CRO-03", "N20 un secondo tocco su 'Chiudi il blocco' registra una SECONDA sessione: la guardia `if (!attivo) return` legge la chiusura del disegno precedente", sessioniDopoDoppia - sessioniPrimaDoppia === 2 && registrateAvvisate === 2, `sessioni ${sessioniPrimaDoppia} -> ${sessioniDopoDoppia}`);

// --- CRO-02: ripresa con valore corrotto nel kv-store
await KV.setItem("cronometro_attivo", "{non e' json");
const cronometroCorrotto = await monta("CronometroCorrotto", ModelloCronometro, { ...ambienteCronometro });
difetto("CRO-02", "N21 un valore corrotto nel kv-store fa rigettare l'effetto: il cronometro resta sulla scelta e il valore non viene mai ripulito", cronometroCorrotto.schermo.stato === "scelta" && cronometroCorrotto.rigetti.length === 1 && (await KV.getItem("cronometro_attivo")) === "{non e' json");

// --- CRO-02b: tipo sconosciuto arrivato da una versione futura
await KV.setItem("cronometro_attivo", JSON.stringify({ inizio: adesso() - 60_000, tipo: "meditazione" }));
const cronometroTipoIgnoto = await monta("CronometroTipoIgnoto", ModelloCronometro, { ...ambienteCronometro });
difetto("CRO-02b", "N22 un tipo di blocco sconosciuto produce 'undefined · previsti undefined min' e il superamento (previsti = NaN) non scatta mai", cronometroTipoIgnoto.schermo.etichetta === "undefined · previsti undefined min" && cronometroTipoIgnoto.schermo.oltre === false, cronometroTipoIgnoto.schermo.etichetta);
avvisi.length = 0;
const sessioniPrimaIgnoto = (await base.getFirstAsync("SELECT count(*) AS n FROM sessioni")).n;
await tocca(cronometroTipoIgnoto, () => cronometroTipoIgnoto.schermo.chiudi());
ok("N23 chiudendo un blocco di tipo sconosciuto e breve si ricade nell'avviso 'Non registrata'", ultimoAvviso()?.titolo === "Non registrata" && (await base.getFirstAsync("SELECT count(*) AS n FROM sessioni")).n === sessioniPrimaIgnoto);

// --- SES-03 visto dalla schermata: tipo sconosciuto e durata oltre le tre ore
await KV.setItem("cronometro_attivo", JSON.stringify({ inizio: adesso() - 4 * 3600 * 1000, tipo: "meditazione" }));
const cronometroIgnotoLungo = await monta("CronometroIgnotoLungo", ModelloCronometro, { ...ambienteCronometro });
avvisi.length = 0;
const chiusuraLunga = await tocca(cronometroIgnotoLungo, () => cronometroIgnotoLungo.schermo.chiudi());
difetto("SES-03", "N24 tipo sconosciuto e oltre 180 minuti: chiudiSessione restituisce minuti undefined e la scrittura fallisce sul NOT NULL, perdendo la sessione", chiusuraLunga !== null && String(chiusuraLunga?.message ?? chiusuraLunga).includes("NOT NULL") && (await KV.getItem("cronometro_attivo")) === null, String(chiusuraLunga?.message ?? chiusuraLunga));

// --- CRO-02c: ora di inizio nel futuro
await KV.setItem("cronometro_attivo", JSON.stringify({ inizio: adesso() + 65_000, tipo: "mattina" }));
const cronometroFuturo = await monta("CronometroFuturo", ModelloCronometro, { ...ambienteCronometro });
difetto("CRO-02c", "N25 con l'ora di inizio nel futuro il contatore mostra un tempo negativo", cronometroFuturo.schermo.contatore === "-2:-5", cronometroFuturo.schermo.contatore);
avvisi.length = 0;
await tocca(cronometroFuturo, () => cronometroFuturo.schermo.chiudi());
ok("N26 chiudendo, l'avviso dice che la fine precede l'inizio e non si registra nulla", ultimoAvviso().titolo === "Non registrata" && ultimoAvviso().messaggio === "fine precedente all'inizio");

// --- CRO-03b: la scrittura che fallisce dopo che la chiave e' gia' stata tolta
await KV.removeItem("cronometro_attivo");
const cronometroScritturaRotta = await monta("CronometroScritturaRotta", ModelloCronometro, {
  ...ambienteCronometro,
  registra: async () => {
    throw new Error("database bloccato");
  },
});
await tocca(cronometroScritturaRotta, () => cronometroScritturaRotta.schermo.tipi[0].premi());
avanzaTempo(25 * 60_000);
await cronometroScritturaRotta.stabilizza();
avvisi.length = 0;
registrateAvvisate = 0;
const erroreChiusura = await tocca(cronometroScritturaRotta, () => cronometroScritturaRotta.schermo.chiudi());
difetto("CRO-03b", "N27 se la scrittura fallisce il blocco e' perso: la chiave e' gia' stata tolta, nessun avviso, nessun onRegistrata", erroreChiusura !== null && (await KV.getItem("cronometro_attivo")) === null && avvisi.length === 0 && registrateAvvisate === 0);

// --- ripresa dopo la chiusura dell'app
await KV.removeItem("cronometro_attivo");
const cronometroPrima = await monta("CronometroPrimaDellaChiusura", ModelloCronometro, { ...ambienteCronometro });
await tocca(cronometroPrima, () => cronometroPrima.schermo.tipi[1].premi());
cronometroPrima.smonta();
avanzaTempo(42 * 60_000);
const cronometroRipreso = await monta("CronometroRipreso", ModelloCronometro, { ...ambienteCronometro });
ok("N28 riaperta l'app il blocco risulta ancora in corso, con il tempo vero trascorso", cronometroRipreso.schermo.stato === "in-corso" && cronometroRipreso.schermo.contatore === "42:00" && cronometroRipreso.schermo.etichetta === "Artefatto · previsti 45 min", cronometroRipreso.schermo.contatore);
avvisi.length = 0;
await tocca(cronometroRipreso, () => cronometroRipreso.schermo.chiudi());
ok("N29 e si chiude normalmente, registrando i 42 minuti veri", (await base.getFirstAsync("SELECT minuti FROM sessioni ORDER BY rowid DESC LIMIT 1")).minuti === 42 && avvisi.length === 0);
cronometroRipreso.smonta();

// --- il legame con la schermata Oggi: onRegistrata fa ricalcolare i riquadri
const oggiConCronometro = await monta("OggiConCronometro", ModelloOggi, { ...ambienteOggi });
const settimanaPrima = oggiConCronometro.schermo.schede[0].valore;
const cronometroInOggi = await monta("CronometroInOggi", ModelloCronometro, {
  ...ambienteCronometro,
  onRegistrata: () => oggiConCronometro.schermo.onRegistrata(),
});
await tocca(cronometroInOggi, () => cronometroInOggi.schermo.tipi[0].premi());
avanzaTempo(30 * 60_000);
await cronometroInOggi.stabilizza();
await tocca(cronometroInOggi, () => cronometroInOggi.schermo.chiudi());
await oggiConCronometro.stabilizza();
ok("N30 chiuso un blocco dentro Oggi, il riquadro 'Settimana' cresce di mezz'ora", oggiConCronometro.schermo.schede[0].valore !== settimanaPrima && Number(oggiConCronometro.schermo.schede[0].valore.replace(" h", "")) - Number(settimanaPrima.replace(" h", "")) >= 0.4, `${settimanaPrima} -> ${oggiConCronometro.schermo.schede[0].valore}`);
cronometroInOggi.smonta();
oggiConCronometro.smonta();


// ===========================================================================
// SEZIONE O — app/index.tsx e la permanenza delle schede
// ===========================================================================
ancora("IDX reindirizzamento", "app/index.tsx", '<Redirect href="/(tabs)/oggi" />');
ok("O1 la rotta '/' e' un Redirect, non una push: non resta nello stack", sorgenteDi("app/index.tsx").includes("Redirect") && !sorgenteDi("app/index.tsx").includes("router.push"));
ok("O2 la radice non mostra nessuna interfaccia propria: reindirizza e basta", sorgenteDi("app/index.tsx").length < 200);

// Le schede restano montate quando si passa da una all'altra: e' la ragione per
// cui i conteggi di Oggi e Studio non si aggiornano (C17, D9). Qui si verifica
// il rovescio della medaglia, che invece e' un pregio: lo stato dell'elenco.
const libreriaPermanenza = await monta("LibreriaPermanenza", ModelloLibreria, { ...ambienteLibreria });
await tocca(libreriaPermanenza, () => libreriaPermanenza.schermo.chip.find((c) => c.etichetta === "T2").premi());
const conteggioT2 = libreriaPermanenza.schermo.volumi.length;
await libreriaPermanenza.stabilizza();
ok("O3 cambiando scheda e tornando, il filtro scelto in Libreria e' ancora attivo", libreriaPermanenza.schermo.filtro === "T2" && libreriaPermanenza.schermo.volumi.length === conteggioT2 && conteggioT2 > 0);
libreriaPermanenza.smonta();

ok("O4 in tutta la simulazione nessuna schermata ha toccato la rete", chiamateDiRete.length === 0, chiamateDiRete.join(", "));

// ===========================================================================
// RIEPILOGO
// ===========================================================================
const totale = passati + falliti.length;
console.log("");
console.log(`Difetti dell'app inchiodati da questa prova: ${difettiInchiodati.length}`);
for (const d of difettiInchiodati) console.log("  · " + d);
console.log("");
for (const f of falliti) console.log("ROSSO  " + f);
console.log("");
console.log(`passati ${passati} su ${totale}`);

if (falliti.length) {
  console.log(`La cartella temporanea NON viene cancellata: ${radiceFinta}`);
  process.exit(1);
}
rmSync(radiceFinta, { recursive: true, force: true });
process.exit(0);
