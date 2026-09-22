/**
 * SIMULAZIONE DELLA SUPERFICIE "NUVOLA" — lib/nuvola/ sopra il banco.
 *
 * Si esegue dalla radice del progetto, senza argomenti e senza variabili:
 *
 *   node test/simulazione/nuvola.mjs
 *
 * Il file si riavvia da solo con `--import ./test/banco/carica.mjs` e con
 * BANCO_DOPPI gia' composta, esattamente come test/simulazione/sync-fusione.mjs:
 * i ganci del banco vanno registrati prima di qualunque import, e questo e' il
 * solo modo di ottenerlo senza chiedere a chi esegue di ricordarsi una riga di
 * comando.
 *
 * Qui gira il CODICE VERO dell'app: lib/nuvola/cliente.ts, proiezione.ts,
 * sincronia.ts, articoli.ts, segni.ts, manuale.ts, piu' lib/db.ts, lib/hlc.ts,
 * lib/sync/fusione.ts e lib/sync/pacchetto.ts. Nessuna schermata si importa
 * (il banco non ha react-native ne' expo-router) e lib/nuvola/useNuvola.ts, che
 * e' un hook, non si chiama senza renderer.
 *
 * CINQUE PARTI:
 *   A. proiezione: il pezzo che mancava. Prima di lib/nuvola/proiezione.ts gli
 *      eventi ricevuti finivano nella tabella `eventi` e nessuna riga operativa
 *      cambiava — una nota scritta sull'altro dispositivo arrivava e restava
 *      invisibile. Dodici scenari, dal crea/aggiorna/elimina alla resurrezione,
 *      ai payload parziali, ai campi di una versione futura dell'app;
 *   B. scambio: sincronizzaNuvola() sopra il finto Supabase — invio, forma VERA
 *      del corpo, segnatura, discesa, deduplicazione, proiezione nella stessa
 *      transazione, segnaposto, invariante 2, assenza di rete, 400, paginazione;
 *   C. cliente: tentativi, attese misurate, blocchi da 200, intestazioni vere;
 *   D. giro completo fra DUE dispositivi: quello che il primo scrive con
 *      segni.ts e articoli.ts deve ricomparire IDENTICO sul secondo, che quelle
 *      righe non le ha mai viste;
 *   E. invariante 1: nessuna `registra()`/`inTransazione()` annidata dentro
 *      un'altra, sui sorgenti di lib/nuvola/ che prova-registro.mjs non guarda.
 *
 * LA RETE SI SIMULA, NON SI TOCCA. `globalThis.fetch` viene sostituito una
 * volta sola, all'avvio, con un finto server Supabase in memoria che conosce
 * PostgREST (GET con hlc=gt., order, limit, select; POST con on_conflict) e le
 * due rotte Storage, registra OGNI richiesta con le sue intestazioni vere, e si
 * puo' programmare per rispondere 500, 429, 400 o per far cadere la
 * connessione. Se qualcosa provasse a chiamare il fetch ORIGINALE, il test si
 * ferma: e' un difetto del test, non dell'app.
 *
 * LE ATTESE NON SI ASPETTANO. lib/nuvola/cliente.ts fra un tentativo e l'altro
 * aspetta 2s, 4s, 8s, 16s: un solo scenario costerebbe quattordici secondi.
 * `globalThis.setTimeout` viene sostituito con una versione che esegue subito e
 * ANNOTA la durata richiesta, cosi' le attese si MISURANO invece di subirle
 * (parte C4 confronta la sequenza esatta). L'originale torna al suo posto alla
 * fine.
 *
 * DUE DISPOSITIVI NELLO STESSO PROCESSO. lib/db.ts e' un singoletto di modulo:
 * `apri()` apre una volta e tiene la connessione in una variabile del modulo.
 * Per avere due dispositivi veri servono due GRAFI di moduli distinti, e per
 * averli si copia l'albero `lib/` in una cartella temporanea e lo si importa da
 * li': il codice eseguito e' lo stesso byte per byte (la copia la fa questo
 * test a ogni esecuzione), ma il registro dei moduli di Node li tiene separati,
 * quindi ogni dispositivo ha il suo `db`, il suo `orologio` e il suo
 * `colonneNote`. Il doppio di expo-sqlite fa il resto: cartelle diverse,
 * connessioni diverse.
 *
 * CONVENZIONE SUI DIFETTI. Un difetto dell'app NON viene corretto qui: lo
 * scenario che lo riproduce si chiama "DIFETTO RIPRODOTTO: ..." e verifica il
 * comportamento OSSERVATO OGGI, cosi' resta una rete di sicurezza che diventera'
 * rossa il giorno in cui il difetto sara' corretto (ed e' allora che va
 * riscritta l'attesa). L'elenco viene ristampato in fondo.
 *
 * COME VERIFICARE CHE QUESTA PROVA NON SIA UN TIMBRO (falsificazione fatta, non
 * immaginata). Una prova che non puo' diventare rossa non dimostra niente. Si
 * indebolisce il codice DA FUORI: si copia un modulo di lib/nuvola/ in una
 * cartella FUORI dal progetto, lo si guasta, e lo si sostituisce con la
 * variabile BANCO_NUVOLA_EXTRA (gancio previsto qui sotto). Nessun file del
 * progetto viene toccato. Le mutazioni provate, e il primo scenario che ciascuna
 * ha reso rosso, sono elencate in fondo al file sotto "FALSIFICAZIONE".
 */
import { spawnSync } from "node:child_process";
import { cpSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const QUESTA_CARTELLA = dirname(fileURLToPath(import.meta.url));
const RADICE_PROGETTO = resolve(QUESTA_CARTELLA, "..", "..");

// ------------------------------------------------------- RIAVVIO CON I GANCI
if (!process.env.BANCO_NUVOLA_IN_CORSO) {
  const { variabileBanco } = await import("../banco/doppi-altri.mjs");
  // Gancio per la FALSIFICAZIONE: permette di sostituire un modulo dell'app con
  // una copia indebolita tenuta FUORI dal progetto. Vuoto in condizioni normali.
  const sostituzioni = process.env.BANCO_NUVOLA_EXTRA
    ? JSON.parse(process.env.BANCO_NUVOLA_EXTRA)
    : {};
  const esito = spawnSync(
    process.execPath,
    ["--import", "./test/banco/carica.mjs", "test/simulazione/nuvola.mjs"],
    {
      cwd: RADICE_PROGETTO,
      stdio: "inherit",
      env: {
        ...process.env,
        BANCO_NUVOLA_IN_CORSO: "1",
        BANCO_DOPPI: variabileBanco({ ...sostituzioni }),
      },
    }
  );
  process.exit(esito.status ?? 1);
}

// ================================================================= CONTEGGIO
// Fail-fast: al PRIMO fallimento si stampa cosa si attendeva e cosa si e'
// ottenuto, si rimettono a posto i globali sostituiti e si esce con stato 1.
// Una simulazione che prosegue dopo il primo rosso fa leggere cento righe per
// trovare la prima che conta.
const scenari = [];
let corrente = null;
let verificheTotali = 0;

function ok(nome, condizione, extra = "") {
  if (!corrente) throw new Error("ok() fuori da uno scenario: " + nome);
  verificheTotali++;
  corrente.verifiche++;
  if (!condizione) fallisci(nome, extra);
}

function uguali(nome, ottenuto, atteso) {
  const a = JSON.stringify(ottenuto);
  const b = JSON.stringify(atteso);
  ok(nome, a === b, `atteso  ${b}\n         ottenuto ${a}`);
}

function fallisci(nome, extra) {
  console.log("");
  console.log(`  NO   ${corrente ? corrente.nome : "(fuori scenario)"}`);
  console.log(`         ${nome}`);
  if (extra) console.log(`         ${extra}`);
  rimettiGlobali();
  console.log("");
  console.log(`Cartella conservata per l'ispezione: ${RADICE}`);
  console.log(`${verificheTotali - 1} verifiche passate, 1 fallita`);
  process.exit(1);
}

/** Attende che `azione` lanci, e che il messaggio contenga `frammento`. */
async function lancia(nome, azione, frammento) {
  let errore = null;
  try {
    await azione();
  } catch (e) {
    errore = e;
  }
  if (errore === null) {
    ok(nome, false, "non ha lanciato nessun errore");
    return null;
  }
  const messaggio = String(errore?.message ?? errore);
  ok(nome, messaggio.includes(frammento), `atteso un messaggio con "${frammento}", ottenuto: ${messaggio}`);
  return errore;
}

async function scenario(nome, corpo) {
  corrente = { nome, verifiche: 0 };
  scenari.push(corrente);
  try {
    await corpo();
  } catch (errore) {
    verificheTotali++;
    corrente.verifiche++;
    fallisci("eccezione non attesa", String(errore?.stack ?? errore));
  }
  console.log(`  ok   ${nome}  (${corrente.verifiche})`);
  corrente = null;
}

// ============================================================ PREPARAZIONE
import * as FS from "../banco/expo-file-system.mjs";
import { configuraCartella } from "../banco/expo-sqlite.mjs";

// Radice finta del dispositivo (documenti/, cache/, pacchetto/): e' l'ordine
// che il banco prescrive quando si usano insieme expo-file-system ed expo-sqlite.
const RADICE = FS.configuraRadice(mkdtempSync(join(tmpdir(), "nuvola-")));

const fetchOriginale = globalThis.fetch;
const setTimeoutOriginale = globalThis.setTimeout;
const clearTimeoutOriginale = globalThis.clearTimeout;

function rimettiGlobali() {
  globalThis.fetch = fetchOriginale;
  globalThis.setTimeout = setTimeoutOriginale;
  globalThis.clearTimeout = clearTimeoutOriginale;
}

/**
 * Apre un dispositivo: una cartella di database tutta sua e un GRAFO di moduli
 * tutto suo.
 *
 * `copia = false` usa i sorgenti veri del progetto (e quindi accetta le
 * sostituzioni di BANCO_NUVOLA_EXTRA: e' li' che si fa la falsificazione).
 * `copia = true` importa da una copia dell'albero lib/ fatta adesso: stesso
 * codice, grafo separato, quindi un secondo lib/db.ts con il suo singoletto.
 */
async function apriDispositivo(nome, dispositivoId, copia) {
  let radiceLib = RADICE_PROGETTO;
  if (copia) {
    radiceLib = join(RADICE, "grafi", nome);
    cpSync(join(RADICE_PROGETTO, "lib"), join(radiceLib, "lib"), { recursive: true });
  }
  const da = (percorso) =>
    copia
      ? import(pathToFileURL(join(radiceLib, percorso)).href)
      : import(join("../..", percorso).replace(/\\/g, "/"));

  // La cartella si fissa PRIMA di apri(): il doppio di expo-sqlite riusa la
  // connessione gia' aperta per lo stesso percorso, quindi due dispositivi che
  // condividessero la cartella condividerebbero anche il file.
  configuraCartella(join(RADICE, "dati", nome, "SQLite"));

  const Db = await da("lib/db.ts");
  const Proiezione = await da("lib/nuvola/proiezione.ts");
  const Sincronia = await da("lib/nuvola/sincronia.ts");
  const Cliente = await da("lib/nuvola/cliente.ts");
  const Articoli = await da("lib/nuvola/articoli.ts");
  const Segni = await da("lib/nuvola/segni.ts");
  const HLC = await da("lib/hlc.ts");
  await Db.apri(dispositivoId);
  return { nome, dispositivoId, Db, Proiezione, Sincronia, Cliente, Articoli, Segni, HLC };
}

// Il dispositivo principale gira sui sorgenti VERI del progetto: parti A, B, C.
const tab = await apriDispositivo("tablet", "tab1", false);

const BASE_FINTA = "https://finto.supabase.prova";
const CHIAVE_FINTA = "sb_publishable_finta_per_il_banco";
const UTENTE_ATTESO = tab.Cliente.UTENTE;

// =================================================== IL FINTO SERVER SUPABASE
/**
 * Un Supabase in memoria: PostgREST (rest/v1) e Storage (storage/v1).
 *
 * Conserva OGNI richiesta con metodo, url, intestazioni e corpo, perche' meta'
 * delle verifiche di questa simulazione sono sulla forma vera di quello che
 * parte: un payload mandato come stringa invece che come oggetto, un
 * Accept-Profile mancante o un Prefer senza resolution=merge-duplicates sono
 * guasti che si vedono solo guardando la richiesta.
 */
function nuovoServitore() {
  const tabelle = new Map();
  const deposito = new Map();
  const richieste = [];
  const regole = [];

  function tabella(nome) {
    if (!tabelle.has(nome)) tabelle.set(nome, new Map());
    return tabelle.get(nome);
  }

  function risposta(stato, corpo) {
    return {
      ok: stato >= 200 && stato < 300,
      status: stato,
      async text() {
        return corpo;
      },
      async json() {
        return corpo === "" ? null : JSON.parse(corpo);
      },
    };
  }

  const servitore = {
    tabelle,
    deposito,
    richieste,
    /** Righe gia' presenti nel registro remoto, come le avrebbe messe la conduttura. */
    semina(nomeTabella, righe) {
      for (const r of righe) tabella(nomeTabella).set(r.id, r);
    },
    /**
     * Programma una risposta forzata. `quando` filtra sulla richiesta, `volte`
     * dice quante richieste consuma (Infinity per sempre), `rete: true` fa
     * cadere la connessione invece di rispondere.
     */
    programma(regola) {
      regole.push({ volte: Infinity, ...regola, usate: 0 });
    },
    azzeraRichieste() {
      richieste.length = 0;
    },
    /** Le richieste al registro remoto, che e' quello che interessa quasi sempre. */
    versoEventi(metodo) {
      return richieste.filter((r) => r.percorso === "/rest/v1/eventi" && r.metodo === metodo);
    },

    async rispondi(url, opzioni = {}) {
      const u = new URL(String(url));
      const metodo = (opzioni.method ?? "GET").toUpperCase();
      const richiesta = {
        metodo,
        url: String(url),
        percorso: u.pathname,
        parametri: u.searchParams,
        intestazioni: { ...(opzioni.headers ?? {}) },
        corpo: opzioni.body,
      };
      richieste.push(richiesta);

      for (const regola of regole) {
        if (regola.usate >= regola.volte) continue;
        if (regola.quando && !regola.quando(richiesta)) continue;
        regola.usate++;
        if (regola.rete) {
          // La forma con cui `fetch` segnala una rete assente: un TypeError.
          throw new TypeError("fetch failed: rete assente (finto server)");
        }
        return risposta(regola.stato, regola.corpo ?? "");
      }

      if (u.pathname.startsWith("/rest/v1/")) return restV1(u, metodo, richiesta);
      if (u.pathname.startsWith("/storage/v1/object/")) return storageV1(u, metodo, richiesta);
      return risposta(404, JSON.stringify({ message: `rotta ignota al finto server: ${u.pathname}` }));
    },
  };

  function restV1(u, metodo, richiesta) {
    const nome = u.pathname.slice("/rest/v1/".length);
    if (metodo === "GET") {
      let righe = [...tabella(nome).values()];
      for (const [chiave, valore] of u.searchParams) {
        if (chiave === "select" || chiave === "order" || chiave === "limit") continue;
        const punto = valore.indexOf(".");
        const operatore = valore.slice(0, punto);
        const atteso = valore.slice(punto + 1);
        if (operatore === "gt") righe = righe.filter((r) => String(r[chiave]) > atteso);
        else if (operatore === "eq") righe = righe.filter((r) => String(r[chiave]) === atteso);
        else {
          return risposta(400, JSON.stringify({ message: `operatore ${operatore} non implementato` }));
        }
      }
      const ordine = u.searchParams.get("order");
      if (ordine) {
        const [campo, verso] = ordine.split(".");
        const segno = verso === "desc" ? -1 : 1;
        righe = [...righe].sort((a, b) =>
          String(a[campo]) < String(b[campo]) ? -segno : String(a[campo]) > String(b[campo]) ? segno : 0
        );
      }
      const limite = Number(u.searchParams.get("limit") ?? "0");
      if (limite > 0) righe = righe.slice(0, limite);
      const select = u.searchParams.get("select");
      if (select && select !== "*") {
        const colonne = select.split(",");
        righe = righe.map((r) => Object.fromEntries(colonne.map((c) => [c, r[c]])));
      }
      return risposta(200, JSON.stringify(righe));
    }
    if (metodo === "POST") {
      const suConflitto = u.searchParams.get("on_conflict") ?? "id";
      let righe;
      try {
        righe = JSON.parse(String(richiesta.corpo));
      } catch {
        return risposta(400, JSON.stringify({ message: "corpo non JSON" }));
      }
      if (!Array.isArray(righe)) return risposta(400, JSON.stringify({ message: "atteso un array" }));
      for (const r of righe) tabella(nome).set(r[suConflitto], r);
      // Prefer: return=minimal -> corpo vuoto, come fa PostgREST davvero.
      return risposta(201, "");
    }
    return risposta(405, JSON.stringify({ message: `metodo ${metodo} non previsto` }));
  }

  function storageV1(u, metodo, richiesta) {
    const dopo = u.pathname.slice("/storage/v1/object/".length);
    const taglio = dopo.indexOf("/");
    const secchio = dopo.slice(0, taglio);
    const percorso = dopo.slice(taglio + 1);
    if (secchio !== tab.Cliente.DEPOSITO) {
      return risposta(404, JSON.stringify({ message: `deposito ignoto: ${secchio}` }));
    }
    if (metodo === "POST" || metodo === "PUT") {
      deposito.set(percorso, String(richiesta.corpo));
      return risposta(200, JSON.stringify({ Key: `${secchio}/${percorso}` }));
    }
    if (metodo === "GET") {
      if (!deposito.has(percorso)) {
        return risposta(404, JSON.stringify({ message: "Object not found" }));
      }
      return risposta(200, deposito.get(percorso));
    }
    return risposta(405, JSON.stringify({ message: `metodo ${metodo} non previsto` }));
  }

  return servitore;
}

// Un solo `fetch` sostituito, per tutta la durata della prova: se un modulo
// provasse a uscire davvero in rete, qui si ferma con un errore invece di
// partire. `servitoreInUso` si cambia fra uno scenario e l'altro.
let servitoreInUso = null;
globalThis.fetch = async (url, opzioni) => {
  if (!servitoreInUso) {
    throw new Error(`il test ha provato a toccare la rete vera: ${String(url)}`);
  }
  return servitoreInUso.rispondi(url, opzioni);
};

function servitoreNuovo() {
  servitoreInUso = nuovoServitore();
  return servitoreInUso;
}

// ======================================================= LE ATTESE SI MISURANO
/**
 * `setTimeout` che non aspetta: esegue subito e annota la durata richiesta.
 *
 * Serve a due cose. La prima e' il tempo: le attese fra i tentativi di
 * lib/nuvola/cliente.ts sono 2s, 4s, 8s, 16s, e un solo scenario di riprova
 * costerebbe quattordici secondi veri. La seconda e' che cosi' le attese
 * diventano OSSERVABILI: la parte C confronta la sequenza esatta delle durate
 * chieste, cosa che aspettando davvero non si potrebbe fare.
 *
 * Conseguenza da conoscere: anche il timer che arma l'AbortController scatta
 * subito, quindi ogni richiesta parte con il segnale gia' abortito. Il finto
 * `fetch` ignora il segnale di proposito — l'annullamento per scadenza si
 * simula con una regola `rete: true`, non lasciandolo scattare per caso.
 */
const durateChieste = [];
globalThis.setTimeout = (funzione, ms, ...resto) => {
  durateChieste.push(ms);
  funzione(...resto);
  return { finto: true };
};
globalThis.clearTimeout = () => {};

function azzeraDurate() {
  durateChieste.length = 0;
}

// ==================================================== ATTREZZI PER GLI EVENTI
// L'istante di partenza e' fisso: gli HLC di questa simulazione devono essere
// riproducibili e ordinabili a mano, non dipendere dall'ora di chi esegue.
const MS_BASE = Date.parse("2026-09-01T08:00:00.000Z");

/** Un evento serializzato con la forma esatta di lib/sync/pacchetto.ts. */
function evento(app, scarto, entita, entitaId, tipo, payload, dispositivo = "altro") {
  const hlc = app.HLC.serializza({ ms: MS_BASE + scarto, contatore: 0, dispositivo });
  return {
    id: `${hlc}:${entitaId}`,
    hlc,
    dispositivo,
    entita,
    entita_id: entitaId,
    tipo,
    payload: typeof payload === "string" ? payload : JSON.stringify(payload),
  };
}

/**
 * Deposita eventi nel registro come li avrebbe messi una sincronizzazione
 * (sincronizzato = 1), SENZA proiettarli: e' proprio la proiezione che la
 * parte A deve provare a parte.
 */
async function depositaEventi(app, eventi) {
  await app.Db.inTransazione(async (d) => {
    for (const e of eventi) {
      await d.runAsync(
        `INSERT OR REPLACE INTO eventi
         (id, hlc, dispositivo, entita, entita_id, tipo, payload, sincronizzato)
         VALUES (?,?,?,?,?,?,?,1)`,
        [e.id, e.hlc, e.dispositivo, e.entita, e.entita_id, e.tipo, e.payload]
      );
    }
  });
}

/** Chiama applica() come la chiama sincronia.ts: dentro una inTransazione(). */
async function proietta(app, toccate) {
  let esito = null;
  await app.Db.inTransazione(async (d) => {
    esito = await app.Proiezione.applica(d, toccate);
  });
  return esito;
}

/** Deposita gli eventi e li proietta, restituendo l'esito della proiezione. */
async function riceviEProietta(app, eventi) {
  await depositaEventi(app, eventi);
  const viste = new Set();
  const toccate = [];
  for (const e of eventi) {
    const k = `${e.entita}\u001f${e.entita_id}`;
    if (viste.has(k)) continue;
    viste.add(k);
    toccate.push({ entita: e.entita, entita_id: e.entita_id });
  }
  return proietta(app, toccate);
}

const riga = (app, tabella, chiave, id) =>
  app.Db.database().getFirstAsync(`SELECT * FROM ${tabella} WHERE ${chiave} = ?`, [id]);

// =========================================================================
// PARTE A — proiezione: il pezzo che mancava
// =========================================================================

await scenario("A1 un 'crea' remoto per articoli crea la riga, con i campi giusti", async () => {
  const esito = await riceviEProietta(tab, [
    evento(tab, 1000, "articoli", "a-uno", "crea", {
      titolo: "Triage in contesti a risorse limitate",
      autori: "R. Kaur; M. Diallo",
      fonte: "BMJ Global Health",
      url: "https://esempio.org/triage",
      abstract: "Sintesi di dodici studi.",
      testo: "Il testo intero, estratto dalla conduttura prima del deposito.",
      tema_slug: "salute-pubblica",
      trimestre: "2026-Q4",
      licenza: "CC-BY-4.0",
      pubblicato_a: "2026-08-20",
      raccolto_a: "2026-09-01T06:00:00.000Z",
      letto: 0,
      salvato: 0,
    }),
  ]);
  uguali("una riga scritta, nessuna incompleta, nessuna sconosciuta",
    { scritte: esito.scritte, eliminate: esito.eliminate, incomplete: esito.incomplete, sconosciute: esito.sconosciute },
    { scritte: 1, eliminate: 0, incomplete: [], sconosciute: 0 });

  const r = await riga(tab, "articoli", "id", "a-uno");
  ok("la riga esiste", r !== null && r !== undefined, "nessuna riga in articoli");
  uguali("i campi del payload sono in colonna",
    { titolo: r.titolo, autori: r.autori, fonte: r.fonte, tema_slug: r.tema_slug, licenza: r.licenza },
    { titolo: "Triage in contesti a risorse limitate", autori: "R. Kaur; M. Diallo",
      fonte: "BMJ Global Health", tema_slug: "salute-pubblica", licenza: "CC-BY-4.0" });
  ok("il testo e' quello dell'articolo, non un riassunto",
     r.testo === "Il testo intero, estratto dalla conduttura prima del deposito.", String(r.testo));
  // L'hlc della riga non sta nel payload: lo mette la proiezione, ed e' cio'
  // che permette a un confronto «vince il piu' recente» di funzionare
  // guardando la sola tabella operativa.
  ok("l'hlc della riga e' quello dell'ultimo evento che l'ha toccata",
     r.hlc === tab.HLC.serializza({ ms: MS_BASE + 1000, contatore: 0, dispositivo: "altro" }), String(r.hlc));
});

await scenario("A2 lo stesso per biblioteca e per segni", async () => {
  const esito = await riceviEProietta(tab, [
    evento(tab, 1100, "biblioteca", "b-uno", "crea", {
      titolo: "Where There Is No Doctor",
      autore: "D. Werner",
      origine: "aperta",
      licenza: "CC-BY-NC-SA",
      formato: "pdf",
      pagine: 512,
      aggiunto_a: "2026-09-01T06:10:00.000Z",
    }),
    evento(tab, 1200, "segni", "s-uno", "crea", {
      volume_id: "b-uno",
      genere: "evidenza",
      pagina: 44,
      ancora: "cap-3:par-2",
      testo: "Protocollo di reidratazione orale",
      creato_a: "2026-09-01T06:20:00.000Z",
    }),
  ]);
  uguali("due righe scritte", [esito.scritte, esito.incomplete.length], [2, 0]);

  const v = await riga(tab, "biblioteca", "id", "b-uno");
  uguali("la voce di biblioteca ha i campi del payload",
    { titolo: v.titolo, autore: v.autore, pagine: v.pagine, origine: v.origine },
    { titolo: "Where There Is No Doctor", autore: "D. Werner", pagine: 512, origine: "aperta" });
  ok("e il default della colonna vale dove il payload tace", v.ultima_pagina === 0, String(v.ultima_pagina));

  const s = await riga(tab, "segni", "id", "s-uno");
  uguali("il segno e' ricostruito per intero",
    { volume_id: s.volume_id, genere: s.genere, pagina: s.pagina, ancora: s.ancora, testo: s.testo, creato_a: s.creato_a },
    { volume_id: "b-uno", genere: "evidenza", pagina: 44, ancora: "cap-3:par-2",
      testo: "Protocollo di reidratazione orale", creato_a: "2026-09-01T06:20:00.000Z" });
});

await scenario("A3 un 'aggiorna' remoto cambia SOLO i campi che porta", async () => {
  const esito = await riceviEProietta(tab, [
    evento(tab, 2000, "articoli", "a-uno", "aggiorna", { salvato: 1 }),
  ]);
  uguali("una riga aggiornata", [esito.scritte, esito.eliminate], [1, 0]);
  const r = await riga(tab, "articoli", "id", "a-uno");
  // Se la proiezione riscrivesse la riga intera dal solo payload, titolo e
  // testo diventerebbero NULL e l'articolo resterebbe illeggibile per sempre.
  uguali("cambia il campo che porta e nient'altro",
    { salvato: r.salvato, letto: r.letto, titolo: r.titolo, fonte: r.fonte, testo: r.testo },
    { salvato: 1, letto: 0, titolo: "Triage in contesti a risorse limitate",
      fonte: "BMJ Global Health", testo: "Il testo intero, estratto dalla conduttura prima del deposito." });
  ok("e l'hlc della riga avanza all'ultimo evento",
     r.hlc === tab.HLC.serializza({ ms: MS_BASE + 2000, contatore: 0, dispositivo: "altro" }), String(r.hlc));
});

await scenario("A4 un 'elimina' cancella la riga", async () => {
  const esito = await riceviEProietta(tab, [
    evento(tab, 2100, "segni", "s-uno", "elimina", {}),
  ]);
  uguali("una riga eliminata, nessuna scritta", [esito.scritte, esito.eliminate], [0, 1]);
  const s = await riga(tab, "segni", "id", "s-uno");
  ok("la riga non c'e' piu'", s === null || s === undefined, JSON.stringify(s));
});

await scenario("A5 crea + elimina + crea successivo fa rivivere la riga", async () => {
  // L'ordine e' quello degli HLC, non quello di arrivo: il terzo evento e' il
  // piu' recente, quindi la riga deve tornare con i campi del terzo payload.
  const esito = await riceviEProietta(tab, [
    evento(tab, 3000, "segni", "s-due", "crea", {
      volume_id: "b-uno", genere: "nota", pagina: 7, ancora: null,
      testo: "prima stesura", creato_a: "2026-09-01T07:00:00.000Z",
    }),
    evento(tab, 3100, "segni", "s-due", "elimina", {}),
    evento(tab, 3200, "segni", "s-due", "crea", {
      volume_id: "b-uno", genere: "nota", pagina: 7, ancora: null,
      testo: "riscritta dopo averla cancellata", creato_a: "2026-09-01T07:02:00.000Z",
    }),
  ]);
  uguali("la riga risulta scritta, non eliminata", [esito.scritte, esito.eliminate], [1, 0]);
  const s = await riga(tab, "segni", "id", "s-due");
  ok("ed e' quella del terzo evento", s?.testo === "riscritta dopo averla cancellata", String(s?.testo));
});

await scenario("A6 payload PARZIALE su riga inesistente: niente riga, niente eccezione, conteggio", async () => {
  // E' il caso vero di articoli.segnaLetto(), che manda solo { letto: 1 }: se
  // l'articolo sull'altro dispositivo non c'e' ancora, dal solo payload non si
  // puo' ricostruire una riga, e inventare un titolo sarebbe peggio.
  const esito = await riceviEProietta(tab, [
    evento(tab, 4000, "articoli", "a-mai-vista", "aggiorna", { letto: 1 }),
  ]);
  uguali("nessuna scrittura, una incompleta con le colonne che mancano",
    { scritte: esito.scritte, eliminate: esito.eliminate, incomplete: esito.incomplete, sconosciute: esito.sconosciute },
    { scritte: 0, eliminate: 0,
      incomplete: [{ entita: "articoli", entita_id: "a-mai-vista", mancano: ["titolo", "raccolto_a"] }],
      sconosciute: 0 });
  const r = await riga(tab, "articoli", "id", "a-mai-vista");
  ok("e nessuna riga mezza vuota resta in tabella", r === null || r === undefined, JSON.stringify(r));
});

await scenario("A7 lo stesso payload parziale su una riga che ESISTE la aggiorna", async () => {
  const esito = await riceviEProietta(tab, [
    evento(tab, 4100, "articoli", "a-uno", "aggiorna", { letto: 1 }),
  ]);
  uguali("una scrittura, nessuna incompleta", [esito.scritte, esito.incomplete.length], [1, 0]);
  const r = await riga(tab, "articoli", "id", "a-uno");
  uguali("letto passa a 1 e il resto resta", { letto: r.letto, salvato: r.salvato, titolo: r.titolo },
    { letto: 1, salvato: 1, titolo: "Triage in contesti a risorse limitate" });
});

await scenario("A8 un campo che la tabella locale non ha viene ignorato senza errore", async () => {
  // E' l'evento scritto da una versione piu' nuova dell'app. Rompersi qui
  // significherebbe che il vecchio dispositivo non sincronizza piu' niente.
  const esito = await riceviEProietta(tab, [
    evento(tab, 4200, "articoli", "a-futuro", "crea", {
      titolo: "Un articolo di una versione futura",
      raccolto_a: "2026-09-01T06:30:00.000Z",
      punteggio_rilevanza: 0.87,
      incorporamento: [0.1, 0.2],
    }),
  ]);
  uguali("la riga si crea lo stesso", [esito.scritte, esito.incomplete.length, esito.sconosciute], [1, 0, 0]);
  const r = await riga(tab, "articoli", "id", "a-futuro");
  uguali("con i campi noti", { titolo: r.titolo, raccolto_a: r.raccolto_a },
    { titolo: "Un articolo di una versione futura", raccolto_a: "2026-09-01T06:30:00.000Z" });
  ok("e nessuna colonna inventata", !Object.keys(r).includes("punteggio_rilevanza"), Object.keys(r).join(","));
});

await scenario("A9 un'entita' sconosciuta viene contata e non solleva", async () => {
  const esito = await riceviEProietta(tab, [
    evento(tab, 4300, "podcast", "p-uno", "crea", { titolo: "Entita' che questa versione non conosce" }),
  ]);
  uguali("contata fra le sconosciute, nient'altro",
    { scritte: esito.scritte, eliminate: esito.eliminate, incomplete: esito.incomplete, sconosciute: esito.sconosciute },
    { scritte: 0, eliminate: 0, incomplete: [], sconosciute: 1 });
});

await scenario("A10 true/false arrivano in colonna come 1/0, non come 'true'/'false'", async () => {
  // SQLite non ha booleani: senza conversione il JSON `true` finisce in colonna
  // come la stringa "true", la riga c'e' ma `WHERE letto = 1` non la trova, e
  // l'articolo resta per sempre nell'elenco dei non letti.
  await riceviEProietta(tab, [
    evento(tab, 4400, "articoli", "a-booleani", "crea", {
      titolo: "Booleani veri", raccolto_a: "2026-09-01T06:40:00.000Z",
      letto: true, salvato: false,
    }),
  ]);
  const perValore = await riga(tab, "articoli", "id", "a-booleani");
  uguali("in colonna ci sono 1 e 0", [perValore.letto, perValore.salvato], [1, 0]);
  // La verifica che conta davvero: la riga si deve TROVARE con il confronto che
  // usa l'app, non solo assomigliare a un 1 quando la si stampa.
  const trovata = await tab.Db.database().getFirstAsync(
    "SELECT id FROM articoli WHERE letto = 1 AND id = ?", ["a-booleani"]);
  ok("e WHERE letto = 1 la trova", trovata?.id === "a-booleani", JSON.stringify(trovata));
  const nonLetti = await tab.Db.database().getFirstAsync(
    "SELECT count(*) AS n FROM articoli WHERE letto = 0 AND id = ?", ["a-booleani"]);
  ok("mentre WHERE letto = 0 non la trova", nonLetti.n === 0, String(nonLetti.n));
});

await scenario("A11 l'ordine conta: due eventi sullo stesso campo si risolvono per HLC crescente", async () => {
  // I due eventi arrivano in DUE scambi separati, e al contrario: prima quello
  // piu' recente, poi quello piu' vecchio. E' il caso vero di due dispositivi
  // che si raggiungono per strade diverse. Se la proiezione applicasse
  // l'ultimo payload ARRIVATO, la pagina di lettura tornerebbe indietro a 44 e
  // l'utente ritroverebbe il libro dove lo aveva lasciato due settimane prima.
  await riceviEProietta(tab, [
    evento(tab, 5100, "biblioteca", "b-uno", "aggiorna", { ultima_pagina: 120 }, "tardi"),
  ]);
  const primo = await riga(tab, "biblioteca", "id", "b-uno");
  ok("il primo scambio porta la pagina a 120", primo.ultima_pagina === 120, String(primo.ultima_pagina));

  await riceviEProietta(tab, [
    evento(tab, 5000, "biblioteca", "b-uno", "aggiorna", { ultima_pagina: 44 }, "presto"),
  ]);
  const v = await riga(tab, "biblioteca", "id", "b-uno");
  ok("l'evento piu' vecchio, arrivato dopo, NON vince", v.ultima_pagina === 120, String(v.ultima_pagina));
  ok("e l'hlc della riga resta quello dell'evento vincente",
     v.hlc === tab.HLC.serializza({ ms: MS_BASE + 5100, contatore: 0, dispositivo: "tardi" }), String(v.hlc));
});

await scenario("A12 ripasso usa esercizio_id come chiave, non id", async () => {
  const esito = await riceviEProietta(tab, [
    evento(tab, 5200, "ripasso", "SQL-014", "crea", {
      stabilita: 3.5, difficolta: 4.2, ripetizioni: 2,
      ultima_revisione: "2026-08-30", prossima_revisione: "2026-09-06", stato: "ripasso",
    }),
  ]);
  uguali("una riga scritta", [esito.scritte, esito.incomplete.length], [1, 0]);
  const r = await riga(tab, "ripasso", "esercizio_id", "SQL-014");
  uguali("la chiave e' finita nella colonna giusta",
    { esercizio_id: r.esercizio_id, ripetizioni: r.ripetizioni, prossima_revisione: r.prossima_revisione, stato: r.stato },
    { esercizio_id: "SQL-014", ripetizioni: 2, prossima_revisione: "2026-09-06", stato: "ripasso" });
  // ripasso non ha colonna hlc: la proiezione non deve inventarla.
  ok("nessuna colonna hlc inventata su ripasso", !Object.keys(r).includes("hlc"), Object.keys(r).join(","));
});

await scenario("A13 CORREZIONE SORVEGLIATA (useAutoSync): anche i tre trasporti locali proiettano", async () => {
  // Era un difetto, e il piu' grave dei due: lib/nuvola/proiezione.ts chiudeva
  // il buco SOLO sulla strada di Supabase. lib/sync/useAutoSync.ts —
  // prossimita', Wi-Fi locale e file cifrato, cioe' le tre strade che
  // funzionano IN AEREO — inseriva gli eventi ricevuti nella tabella `eventi`
  // e si fermava li'. Sul dispositivo che riceve, la nota scritta sull'altro
  // restava invisibile finche' non capitava di passare da Supabase, che in
  // viaggio e' proprio cio' che non c'e'.
  //
  // Verdetto rovesciato: un rosso qui adesso vuol dire che la chiamata e'
  // stata tolta, e con lei la sola ragione per cui una modifica fatta sul
  // tablet si vede sul telefono senza internet.
  //
  // L'hook non si importa (serve un renderer, e il banco non ha react-native
  // intero): si guarda il SORGENTE, che per questa domanda basta e avanza, e
  // poi si riesegue la sua sequenza riga per riga.
  const sorgente = readFileSync(join(RADICE_PROGETTO, "lib", "sync", "useAutoSync.ts"), "utf8");
  ok("useAutoSync inserisce gli eventi ricevuti nel registro",
     sorgente.includes("INSERT OR IGNORE INTO eventi"), "l'INSERT non c'e' piu': rileggere lo scenario");
  ok("e nomina applica()", /\bapplica\s*\(/.test(sorgente), "non la nomina piu': la correzione e' regredita");
  ok("importandola da lib/nuvola/proiezione", sorgente.includes("nuvola/proiezione"),
     "non la importa piu': la correzione e' regredita");
  ok("e la chiama DENTRO la transazione che inserisce gli eventi",
     sorgente.indexOf("INSERT OR IGNORE INTO eventi") < sorgente.indexOf("applica(d, f.entitaToccate)"),
     "fuori dalla transazione, un'interruzione lascerebbe il registro avanti e le tabelle indietro");

  // La sequenza di useAutoSync, ricopiata: assorbi, fondi, inserisci. Nient'altro.
  const daLAltroDispositivo = evento(tab, 6000, "segni", "s-da-trasporto-locale", "crea", {
    volume_id: "b-uno", genere: "nota", pagina: 3, ancora: null,
    testo: "scritta sul tablet, arrivata per file cifrato",
    creato_a: "2026-09-01T09:00:00.000Z",
  }, "tab-vicino");
  await tab.Db.assorbiRemoto([daLAltroDispositivo.hlc]);
  const locali = await tab.Db.database().getAllAsync(
    "SELECT id, hlc, dispositivo, entita, entita_id, tipo, payload FROM eventi");
  const Fusione = await import("../../lib/sync/fusione.ts");
  const f = Fusione.fondi(locali, [daLAltroDispositivo]);
  // La sequenza corretta dell'hook, ricopiata: assorbi, fondi, inserisci E
  // PROIETTA, tutto dentro la stessa transazione.
  const Proiezione = await import("../../lib/nuvola/proiezione.ts");
  let esito;
  await tab.Db.inTransazione(async (d) => {
    for (const e of f.nuovi) {
      await d.runAsync(
        `INSERT OR IGNORE INTO eventi
         (id, hlc, dispositivo, entita, entita_id, tipo, payload, sincronizzato)
         VALUES (?,?,?,?,?,?,?,1)`,
        [e.id, e.hlc, e.dispositivo, e.entita, e.entita_id, e.tipo, e.payload]
      );
    }
    esito = await Proiezione.applica(d, f.entitaToccate);
  });

  const nelRegistro = await tab.Db.database().getFirstAsync(
    "SELECT id FROM eventi WHERE entita_id = ?", ["s-da-trasporto-locale"]);
  ok("l'evento e' nel registro", nelRegistro?.id === daLAltroDispositivo.id, JSON.stringify(nelRegistro));
  uguali("e la proiezione ha scritto la sua riga", [esito.scritte, esito.eliminate], [1, 0]);
  const dopo = await riga(tab, "segni", "id", "s-da-trasporto-locale");
  ok("la riga operativa ESISTE: il segno si vede, senza essere passati da internet",
     dopo !== null && dopo !== undefined, JSON.stringify(dopo));
  ok("ed e' quella scritta sull'altro dispositivo",
     dopo?.testo === "scritta sul tablet, arrivata per file cifrato", String(dopo?.testo));
});

// =========================================================================
// PARTE B — scambio: lib/nuvola/sincronia.ts sopra il finto Supabase
// =========================================================================

/** Svuota la coda di invio: ogni scenario di parte B parte da una coda nota. */
async function svuotaCoda(app) {
  const coda = await app.Db.daSincronizzare(5000);
  await app.Db.segnaSincronizzati(coda.map((e) => e.id));
  return coda.length;
}

async function leggiMeta(app, chiave) {
  const r = await app.Db.database().getFirstAsync("SELECT valore FROM meta WHERE chiave = ?", [chiave]);
  return r?.valore ?? null;
}

/**
 * Fissa il segnaposto della nuvola. E' stato dell'app, non del test: si tocca
 * per riportare uno scenario a una condizione nota (registro remoto da
 * rileggere dall'inizio), come farebbe una reinstallazione.
 */
async function fissaSegnaposto(app, valore) {
  await app.Db.inTransazione(async (d) => {
    await d.runAsync(
      `INSERT INTO meta (chiave, valore) VALUES ('nuvola_hlc', ?)
       ON CONFLICT (chiave) DO UPDATE SET valore = excluded.valore`,
      [valore]
    );
  });
}

/**
 * Gli eventi che il finto registro remoto contiene nascono DIECI MINUTI avanti
 * rispetto a ora: le scritture locali usano l'orologio vero, e un evento remoto
 * piu' vecchio di loro non avanzerebbe mai il segnaposto, che e' l'hlc
 * dell'ultima riga letta. Con lo scarto, l'ordine e' quello che si vuole
 * verificare invece che quello che capita.
 */
const PARTENZA_B = Date.now() + 10 * 60_000;
const hlcRemoto = (scarto, dispositivo) =>
  tab.HLC.serializza({ ms: PARTENZA_B + scarto, contatore: 0, dispositivo });

const sincronizza = (app, servitore) => {
  // E' questo il Supabase con cui si parla per la durata della chiamata: il
  // finto `fetch` e' uno solo e instrada su di lui.
  servitoreInUso = servitore;
  return app.Sincronia.sincronizzaNuvola({
    // I volumi si spengono: `File.downloadFileAsync` nel banco solleva sempre
    // (il banco e' offline per progetto) e qui si sta provando lo scambio di
    // eventi, non lo scaricamento dei PDF.
    scaricaVolumi: false,
    nuvola: new app.Cliente.Nuvola(BASE_FINTA, CHIAVE_FINTA),
  });
};

let servitore = servitoreNuovo();

await scenario("B1 gli eventi locali salgono, e il payload arriva come OGGETTO", async () => {
  servitore = servitoreNuovo();
  await svuotaCoda(tab);
  await fissaSegnaposto(tab, "");

  // Scrittura vera dell'app, non un evento costruito a mano.
  const segno = await tab.Segni.annota("b-vol-1", "nota", "Questo sale per primo", 12, "cap-1:par-4");
  const coda = await tab.Db.daSincronizzare(10);
  uguali("un solo evento in coda", coda.map((e) => e.entita_id), [segno.id]);

  const esito = await sincronizza(tab, servitore);
  uguali("riuscito, un inviato", [esito.riuscito, esito.inviati], [true, 1]);

  const invii = servitore.versoEventi("POST");
  ok("una sola richiesta di scrittura", invii.length === 1, String(invii.length));
  const corpo = JSON.parse(String(invii[0].corpo));
  ok("con una sola riga", corpo.length === 1, String(corpo.length));
  const r = corpo[0];

  // IL PUNTO. `payload` in locale e' TESTO, nel remoto e' jsonb. Mandarlo come
  // stringa lo farebbe arrivare come un jsonb di tipo stringa, e ogni lettura
  // successiva vedrebbe un campo solo al posto dei suoi campi: la proiezione
  // sull'altro dispositivo non troverebbe piu' ne' volume_id ne' genere.
  ok("il payload e' un oggetto, non una stringa",
     r.payload !== null && typeof r.payload === "object" && !Array.isArray(r.payload),
     `tipo ${Array.isArray(r.payload) ? "array" : typeof r.payload}: ${JSON.stringify(r.payload)}`);
  uguali("e porta i campi del segno, uno per uno", r.payload, {
    volume_id: "b-vol-1", genere: "nota", pagina: 12,
    ancora: "cap-1:par-4", testo: "Questo sale per primo", creato_a: segno.creato_a,
  });
  uguali("la riga remota ha la forma della tabella eventi",
    { id: r.id, hlc: r.hlc, dispositivo_id: r.dispositivo_id, entita: r.entita, entita_id: r.entita_id, tipo: r.tipo, utente_id: r.utente_id },
    { id: coda[0].id, hlc: segno.hlc, dispositivo_id: "tab1", entita: "segni",
      entita_id: segno.id, tipo: "crea", utente_id: UTENTE_ATTESO });

  // Le intestazioni VERE: senza Content-Profile PostgREST scrive nello schema
  // public invece che in `percorso`, e senza resolution=merge-duplicates un
  // reinvio dello stesso evento tornerebbe 409 invece di non fare nulla.
  uguali("intestazioni dell'upsert",
    { apikey: invii[0].intestazioni.apikey,
      Authorization: invii[0].intestazioni.Authorization,
      "Content-Profile": invii[0].intestazioni["Content-Profile"],
      "Content-Type": invii[0].intestazioni["Content-Type"],
      Prefer: invii[0].intestazioni.Prefer },
    { apikey: CHIAVE_FINTA, Authorization: `Bearer ${CHIAVE_FINTA}`,
      "Content-Profile": "percorso", "Content-Type": "application/json",
      Prefer: "return=minimal,resolution=merge-duplicates" });
  ok("e l'upsert e' per id", invii[0].parametri.get("on_conflict") === "id", invii[0].url);

  const letture = servitore.versoEventi("GET");
  ok("la lettura dichiara lo schema di lettura",
     letture[0].intestazioni["Accept-Profile"] === "percorso",
     JSON.stringify(letture[0].intestazioni));

  // L'evento appena caricato ritorna giu' nello stesso scambio: e' l'occasione
  // per vedere che la deduplicazione per id regge anche sui propri eventi.
  uguali("torna giu' e viene riconosciuto come gia' nostro", [esito.ricevuti, esito.nuovi], [1, 0]);
});

await scenario("B2 dopo l'invio riuscito quegli eventi risultano sincronizzato = 1", async () => {
  const sospesi = await tab.Db.daSincronizzare(10);
  uguali("nessun evento resta in coda", sospesi, []);
  const riga = await tab.Db.database().getFirstAsync(
    "SELECT sincronizzato FROM eventi WHERE entita = 'segni' AND tipo = 'crea' ORDER BY hlc DESC LIMIT 1");
  ok("l'ultimo segno scritto in locale e' segnato", riga?.sincronizzato === 1, JSON.stringify(riga));
  const stato = await tab.Sincronia.statoNuvola();
  ok("e lo stato mostrato dalle schermate dice zero in sospeso", stato.inSospeso === 0, JSON.stringify(stato));
});

await scenario("B3 gli eventi remoti scendono, si deduplicano per id, entrano e vengono PROIETTATI", async () => {
  // La conduttura quotidiana ha depositato un articolo mentre il telefono era
  // spento. Nel registro remoto c'e' anche il nostro segno, gia' nostro.
  servitore.semina("eventi", [
    {
      id: "ev-articolo-1", hlc: hlcRemoto(7000, "rassegna"),
      dispositivo_id: "rassegna", entita: "articoli", entita_id: "b-art-1", tipo: "crea",
      payload: {
        titolo: "Catene del freddo e vaccini", autori: "L. Okonjo",
        fonte: "Lancet Global Health", raccolto_a: "2026-09-01T05:00:00.000Z",
        testo: "Testo integrale depositato dalla conduttura.", tema_slug: "logistica",
      },
      utente_id: UTENTE_ATTESO,
    },
  ]);
  await fissaSegnaposto(tab, "");
  servitore.azzeraRichieste();

  const esito = await sincronizza(tab, servitore);
  uguali("due letti, uno solo nuovo (l'altro e' il nostro segno)",
    { riuscito: esito.riuscito, ricevuti: esito.ricevuti, nuovi: esito.nuovi },
    { riuscito: true, ricevuti: 2, nuovi: 1 });
  uguali("e la proiezione ha scritto una riga",
    { scritte: esito.proiezione.scritte, eliminate: esito.proiezione.eliminate,
      incomplete: esito.proiezione.incomplete, sconosciute: esito.proiezione.sconosciute },
    { scritte: 1, eliminate: 0, incomplete: [], sconosciute: 0 });

  const ev = await tab.Db.database().getFirstAsync(
    "SELECT id, sincronizzato FROM eventi WHERE id = ?", ["ev-articolo-1"]);
  uguali("l'evento e' nel registro, gia' marcato come scambiato", ev, { id: "ev-articolo-1", sincronizzato: 1 });
  const art = await riga(tab, "articoli", "id", "b-art-1");
  uguali("e la riga operativa esiste, leggibile senza rete",
    { titolo: art?.titolo, fonte: art?.fonte, tema_slug: art?.tema_slug, letto: art?.letto },
    { titolo: "Catene del freddo e vaccini", fonte: "Lancet Global Health", tema_slug: "logistica", letto: 0 });
  ok("e il testo e' arrivato per intero",
     art.testo === "Testo integrale depositato dalla conduttura.", String(art.testo));
  ok("la lettura ha chiesto la pagina con il limite di sincronia.ts",
     servitore.versoEventi("GET")[0].parametri.get("limit") === "500",
     servitore.versoEventi("GET")[0].url);
});

await scenario("B3bis la transazione e' UNA: se la proiezione cade, nemmeno l'evento resta", async () => {
  // Un evento malformato (genere fuori dal CHECK della tabella `segni`) fa
  // fallire l'INSERT della proiezione. Se evento e riga non fossero nella
  // stessa transazione, il registro direbbe una cosa e la tabella un'altra, e
  // il segnaposto sarebbe avanzato oltre un evento mai applicato.
  const velenoso = servitoreNuovo();
  velenoso.semina("eventi", [
    {
      id: "ev-veleno", hlc: hlcRemoto(7100, "guasto"),
      dispositivo_id: "guasto", entita: "segni", entita_id: "s-veleno", tipo: "crea",
      payload: { volume_id: "b-uno", genere: "scarabocchio", testo: "x", creato_a: "2026-09-01T09:30:00.000Z" },
      utente_id: UTENTE_ATTESO,
    },
  ]);
  const primaSegnaposto = await leggiMeta(tab, "nuvola_hlc");
  const esito = await sincronizza(tab, velenoso);

  ok("lo scambio non e' riuscito", esito.riuscito === false, JSON.stringify(esito));
  ok("e il motivo dice che si e' rotto lo scambio",
     esito.motivo.startsWith("Scambio con Supabase interrotto:"), esito.motivo);
  ok("il motivo nomina il vincolo violato", esito.motivo.includes("CHECK"), esito.motivo);
  const ev = await tab.Db.database().getFirstAsync("SELECT id FROM eventi WHERE id = ?", ["ev-veleno"]);
  ok("l'evento NON e' rimasto nel registro", ev === null || ev === undefined, JSON.stringify(ev));
  const s = await riga(tab, "segni", "id", "s-veleno");
  ok("e nessuna riga e' rimasta a meta'", s === null || s === undefined, JSON.stringify(s));
  ok("il segnaposto non e' avanzato", (await leggiMeta(tab, "nuvola_hlc")) === primaSegnaposto,
     `${primaSegnaposto} -> ${await leggiMeta(tab, "nuvola_hlc")}`);
  // Il registro resta usabile: se il ROLLBACK avesse lasciato una transazione
  // aperta, da qui in poi l'app non scriverebbe piu' niente, e in silenzio
  // (vedi il commento lungo in lib/db.ts).
  const dopoIlRollback = await tab.Segni.annota("b-vol-1", "segnalibro", "il registro scrive ancora", 1, null);
  const scritta = await riga(tab, "segni", "id", dopoIlRollback.id);
  ok("e la prima scrittura dopo il rollback arriva a destinazione",
     scritta?.id === dopoIlRollback.id, JSON.stringify(scritta));
  await svuotaCoda(tab);
});

await scenario("B4 il segnaposto avanza, e una seconda sincronizzazione non riscarica", async () => {
  const atteso = hlcRemoto(7000, "rassegna");
  ok("il segnaposto e' l'hlc dell'ultimo evento ricevuto",
     (await leggiMeta(tab, "nuvola_hlc")) === atteso, String(await leggiMeta(tab, "nuvola_hlc")));

  servitore.azzeraRichieste();
  const esito = await sincronizza(tab, servitore);
  uguali("il secondo giro non riceve niente e non ha niente da mandare",
    { riuscito: esito.riuscito, ricevuti: esito.ricevuti, nuovi: esito.nuovi, inviati: esito.inviati },
    { riuscito: true, ricevuti: 0, nuovi: 0, inviati: 0 });
  ok("e la domanda partita chiede solo cio' che viene dopo il segnaposto",
     servitore.versoEventi("GET")[0].parametri.get("hlc") === "gt." + atteso,
     servitore.versoEventi("GET")[0].url);
  ok("motivo onesto quando non c'e' nulla da fare", esito.motivo.startsWith("Già allineato."), esito.motivo);
});

await scenario("B5 il segnaposto avanza ANCHE quando gli eventi ricevuti sono tutti duplicati", async () => {
  // Senza questo, ogni sincronizzazione ripartirebbe dall'inizio del registro
  // remoto: dopo un mese di rassegne sono decine di migliaia di eventi per
  // aprire l'app, e il segnaposto smetterebbe di servire proprio a chi ne ha
  // piu' bisogno.
  await fissaSegnaposto(tab, "");
  servitore.azzeraRichieste();
  const esito = await sincronizza(tab, servitore);
  uguali("due eventi riletti, nessuno nuovo", [esito.ricevuti, esito.nuovi], [2, 0]);
  const atteso = hlcRemoto(7000, "rassegna");
  ok("e il segnaposto e' tornato in fondo lo stesso",
     (await leggiMeta(tab, "nuvola_hlc")) === atteso, String(await leggiMeta(tab, "nuvola_hlc")));
});

await scenario("B6 l'orologio assorbe gli HLC ricevuti (invariante 2)", async () => {
  // Due dispositivi su fusi orari diversi: se l'orologio locale non assorbisse
  // il tempo dell'altro, la prima modifica scritta QUI dopo lo scambio
  // nascerebbe con un HLC piu' basso di quella appena ricevuta e perderebbe
  // ogni confronto «vince il piu' recente», pur essendo successiva.
  const avanti = Date.now() + 3 * 3600_000;
  const hlcRemoto = tab.HLC.serializza({ ms: avanti, contatore: 7, dispositivo: "telefono-avanti" });
  servitore.semina("eventi", [
    {
      id: "ev-avanti", hlc: hlcRemoto, dispositivo_id: "telefono-avanti",
      entita: "articoli", entita_id: "b-art-1", tipo: "aggiorna",
      payload: { salvato: 1 }, utente_id: UTENTE_ATTESO,
    },
  ]);
  const esito = await sincronizza(tab, servitore);
  uguali("l'evento del dispositivo avanti e' entrato", [esito.ricevuti, esito.nuovi], [1, 1]);

  const segno = await tab.Segni.annota("b-vol-1", "segnalibro", "scritto dopo lo scambio", 1, null);
  ok("il primo evento locale dopo lo scambio ha un HLC piu' alto del piu' alto ricevuto",
     segno.hlc > hlcRemoto, `${segno.hlc} contro ${hlcRemoto}`);
  ok("e l'identificativo resta questo dispositivo, non quello remoto",
     segno.hlc.endsWith("-tab1"), segno.hlc);
  // L'orologio assorbito e' anche su disco: sopravvive alla chiusura dell'app
  // anche se dopo la fusione non si scrive nient'altro.
  const salvato = await leggiMeta(tab, "hlc");
  ok("meta('hlc') e' al tempo assorbito", parseInt(String(salvato).split("-")[0], 16) >= avanti, String(salvato));
});

await scenario("B7 senza rete non solleva: riuscito false, motivo, e nessun evento segnato", async () => {
  const spenta = servitoreNuovo();
  spenta.programma({ rete: true });
  const coda = await tab.Db.daSincronizzare(10);
  ok("c'e' almeno un evento in sospeso da proteggere", coda.length >= 1, String(coda.length));

  const esito = await sincronizza(tab, spenta);
  uguali("torna indietro senza lanciare",
    { riuscito: esito.riuscito, inviati: esito.inviati, ricevuti: esito.ricevuti },
    { riuscito: false, inviati: 0, ricevuti: 0 });
  ok("con un motivo leggibile e in italiano",
     esito.motivo === "Supabase non raggiungibile: si riprova al prossimo rientro in rete.", esito.motivo);
  ok("nessuna scrittura e' stata nemmeno tentata", spenta.versoEventi("POST").length === 0);
  const dopo = await tab.Db.daSincronizzare(10);
  uguali("gli eventi in sospeso sono ancora tutti li'", dopo.map((e) => e.id), coda.map((e) => e.id));
  ok("e il motivo e' scritto dove le schermate lo leggono",
     (await leggiMeta(tab, "nuvola_motivo")) === esito.motivo, String(await leggiMeta(tab, "nuvola_motivo")));
  servitoreInUso = servitore;
});

await scenario("B8 un 400 in invio interrompe, non segna nulla, e riporta il corpo della risposta", async () => {
  const respinge = servitoreNuovo();
  const corpoErrore = '{"code":"PGRST204","message":"Could not find the \'payload\' column of \'eventi\'"}';
  respinge.programma({ quando: (r) => r.metodo === "POST", stato: 400, corpo: corpoErrore });
  const coda = await tab.Db.daSincronizzare(10);
  ok("c'e' qualcosa da mandare", coda.length >= 1, String(coda.length));

  const esito = await sincronizza(tab, respinge);
  ok("non riuscito", esito.riuscito === false, JSON.stringify(esito));
  ok("il motivo riporta lo stato", esito.motivo.includes("400"), esito.motivo);
  ok("e il corpo vero della risposta", esito.motivo.includes("Could not find the 'payload' column"), esito.motivo);
  ok("un 4xx non si riprova: un solo tentativo di scrittura",
     respinge.versoEventi("POST").length === 1, String(respinge.versoEventi("POST").length));
  ok("la discesa non e' nemmeno cominciata", respinge.versoEventi("GET").length === 0);
  const dopo = await tab.Db.daSincronizzare(10);
  uguali("e gli eventi restano da inviare", dopo.map((e) => e.id), coda.map((e) => e.id));
  servitoreInUso = servitore;
});

await scenario("B9 paginazione: con piu' eventi del limite di pagina si fanno piu' giri", async () => {
  // PAGINA in lib/nuvola/sincronia.ts vale 500: 501 eventi devono costare due
  // giri e arrivare tutti. Se il ciclo si fermasse alla prima pagina, l'ultimo
  // articolo di ogni rassegna abbondante non arriverebbe mai.
  const tanti = servitoreNuovo();
  const righe = [];
  for (let i = 0; i < 501; i++) {
    righe.push({
      id: `ev-pag-${String(i).padStart(4, "0")}`,
      hlc: hlcRemoto(900000 + i, "rassegna"),
      dispositivo_id: "rassegna", entita: "note", entita_id: `b-pag-${String(i).padStart(4, "0")}`,
      tipo: "crea",
      payload: { titolo: `nota ${i}`, testo: "corpo", creato_a: "2026-09-01T10:00:00.000Z" },
      utente_id: UTENTE_ATTESO,
    });
  }
  tanti.semina("eventi", righe);
  await svuotaCoda(tab);
  await fissaSegnaposto(tab, "");

  const esito = await sincronizza(tab, tanti);
  uguali("arrivano tutti, e tutti nuovi",
    { riuscito: esito.riuscito, ricevuti: esito.ricevuti, nuovi: esito.nuovi }, { riuscito: true, ricevuti: 501, nuovi: 501 });
  const letture = tanti.versoEventi("GET");
  ok("in due giri, non in uno", letture.length === 2, String(letture.length));
  ok("il primo giro parte dall'inizio", letture[0].parametri.get("hlc") === null, letture[0].url);
  ok("il secondo riparte dall'ultimo hlc del primo",
     letture[1].parametri.get("hlc") === "gt." + righe[499].hlc, letture[1].url);
  const quante = await tab.Db.database().getFirstAsync(
    "SELECT count(*) AS n FROM note WHERE id LIKE 'b-pag-%'");
  ok("e 501 righe operative sono state scritte", quante.n === 501, String(quante.n));
  ok("la proiezione le conta tutte", esito.proiezione.scritte === 501, String(esito.proiezione.scritte));
  servitoreInUso = servitore;
});

await scenario("B10 CORREZIONE SORVEGLIATA: sincronizzaNuvola non finge di scegliere il mittente", async () => {
  // Era "DIFETTO RIPRODOTTO: il parametro `dispositivo` non viene mai letto".
  // La firma era sincronizzaNuvola(dispositivo, opzioni), useNuvola glielo
  // passava, e il corpo non lo nominava mai: l'identita' del mittente viaggia
  // nel campo `dispositivo` che registra() ha scritto dentro ogni evento
  // quando l'evento e' nato, e da fuori non si puo' cambiare. Innocuo finche'
  // nessuno ci crede; il giorno in cui qualcuno ci mettesse un filtro per
  // dispositivo, scriverebbe codice morto senza accorgersene.
  //
  // Il parametro non c'e' piu'. Verdetto rovesciato: un rosso qui vuol dire
  // che e' tornato.
  const sorgente = readFileSync(join(RADICE_PROGETTO, "lib", "nuvola", "sincronia.ts"), "utf8");
  const firma = sorgente.slice(
    sorgente.indexOf("export async function sincronizzaNuvola"),
    sorgente.indexOf("): Promise<EsitoNuvola>"));
  ok("la firma non prende nessun dispositivo", !/\bdispositivo\b/.test(firma), firma.trim());
  ok("e nemmeno i chiamanti glielo passano",
     !/sincronizzaNuvola\(\s*["'`]/.test(
        readFileSync(join(RADICE_PROGETTO, "lib", "nuvola", "useNuvola.ts"), "utf8")
        + readFileSync(join(RADICE_PROGETTO, "app", "(tabs)", "oggi.tsx"), "utf8")),
     "qualcuno passa ancora una stringa: la firma e' tornata a promettere cio' che non fa");

  // E si vede anche da fuori: cio' che parte porta il dispositivo dell'evento.
  await svuotaCoda(tab);
  const segno = await tab.Segni.annota("b-vol-1", "nota", "chi sono io?", 2, null);
  const servitoreBis = servitoreNuovo();
  await sincronizza(tab, servitoreBis);
  const corpoInviato = JSON.parse(String(servitoreBis.versoEventi("POST")[0].corpo));
  ok("il dispositivo dichiarato e' quello che ha scritto l'evento",
     corpoInviato[0].dispositivo_id === "tab1", corpoInviato[0].dispositivo_id);
  ok("e l'evento e' proprio il nostro", corpoInviato[0].entita_id === segno.id, corpoInviato[0].entita_id);
  servitoreInUso = servitore;
});

// =========================================================================
// PARTE C — cliente: tentativi, attese misurate, blocchi, intestazioni
// =========================================================================

const nuvolaDiProva = () => new tab.Cliente.Nuvola(BASE_FINTA, CHIAVE_FINTA);

await scenario("C1 su 500 riprova quattro volte in tutto, poi solleva ErroreNuvola", async () => {
  const guasto = servitoreNuovo();
  guasto.programma({ stato: 500, corpo: "guasto interno del database" });
  azzeraDurate();

  const errore = await lancia("solleva", () => nuvolaDiProva().seleziona("articoli", "select=id"),
    "Supabase ha risposto 500");
  ok("e' un ErroreNuvola", errore instanceof tab.Cliente.ErroreNuvola, String(errore?.name));
  ok("con lo stato nel campo", errore.stato === 500, String(errore.stato));
  ok("e il corpo nel campo", errore.corpo === "guasto interno del database", String(errore.corpo));
  ok("il messaggio porta il corpo della risposta",
     errore.message.includes("guasto interno del database"), errore.message);
  ok("il messaggio porta la rotta, senza ripetere la base",
     errore.message.includes("/rest/v1/articoli?select=id") && !errore.message.includes(BASE_FINTA),
     errore.message);
  ok("quattro tentativi in tutto, non uno di piu'", guasto.richieste.length === 4, String(guasto.richieste.length));
  servitoreInUso = servitore;
});

await scenario("C2 su 400 solleva SUBITO, un solo tentativo", async () => {
  // Un 4xx e' un difetto nostro (colonna sbagliata, policy che rifiuta):
  // riprovarlo e' un minuto perso e nasconde il messaggio vero.
  const rifiuta = servitoreNuovo();
  rifiuta.programma({ stato: 400, corpo: "colonna inesistente" });
  azzeraDurate();
  const errore = await lancia("solleva", () => nuvolaDiProva().seleziona("articoli", "select=id"),
    "Supabase ha risposto 400");
  ok("un solo tentativo", rifiuta.richieste.length === 1, String(rifiuta.richieste.length));
  ok("e nessuna attesa richiesta fra i tentativi",
     durateChieste.filter((d) => d !== 20000).length === 0, JSON.stringify(durateChieste));
  ok("lo stato e' nel campo", errore.stato === 400, String(errore.stato));
  servitoreInUso = servitore;
});

await scenario("C3 su 429 riprova, e riesce quando il limite si apre", async () => {
  const strozza = servitoreNuovo();
  strozza.programma({ stato: 429, corpo: "too many requests", volte: 2 });
  strozza.semina("articoli", [{ id: "c-uno", titolo: "passato dopo due 429" }]);
  const righe = await nuvolaDiProva().seleziona("articoli", "select=id,titolo");
  uguali("la lettura riesce", righe, [{ id: "c-uno", titolo: "passato dopo due 429" }]);
  ok("dopo tre richieste in tutto", strozza.richieste.length === 3, String(strozza.richieste.length));
  servitoreInUso = servitore;
});

await scenario("C4 le attese chieste sono 2000, 4000, 8000 ms", async () => {
  // Misurate, non aspettate: il finto setTimeout annota la durata ed esegue
  // subito. Si confronta la SEQUENZA INTERA, timer di scadenza compresi, cosi'
  // la verifica cade anche se qualcuno cambiasse l'ordine o ne aggiungesse uno.
  const guasto = servitoreNuovo();
  guasto.programma({ stato: 503, corpo: "in manutenzione" });
  azzeraDurate();
  await lancia("fallisce dopo i quattro tentativi",
    () => nuvolaDiProva().seleziona("articoli", "select=id"), "503");
  uguali("un timer di scadenza per tentativo, e le tre attese crescenti in mezzo",
    durateChieste, [20000, 2000, 20000, 4000, 20000, 8000, 20000]);
  uguali("cioe' le attese del raddoppio, senza la quarta che non serve",
    durateChieste.filter((d) => d !== 20000), [2000, 4000, 8000]);
  servitoreInUso = servitore;
});

await scenario("C5 innesta con elenco vuoto non tocca la rete", async () => {
  const muto = servitoreNuovo();
  const scritte = await nuvolaDiProva().innesta("eventi", [], "id");
  ok("torna zero", scritte === 0, String(scritte));
  ok("e nessuna richiesta e' partita", muto.richieste.length === 0, String(muto.richieste.length));
  servitoreInUso = servitore;
});

await scenario("C6 innesta con 450 righe manda tre richieste, e ogni riga porta utente_id", async () => {
  // I blocchi da 200 esistono perche' un corpo troppo grande prende un 413 e si
  // perde TUTTO il gruppo, non l'eccedenza.
  const grosso = servitoreNuovo();
  const righe = [];
  for (let i = 0; i < 450; i++) righe.push({ id: `c-riga-${i}`, hlc: `h${i}` });
  const scritte = await nuvolaDiProva().innesta("eventi", righe, "id");
  ok("dichiara 450 righe scritte", scritte === 450, String(scritte));
  const invii = grosso.versoEventi("POST");
  uguali("tre richieste, da 200, 200 e 50",
    invii.map((r) => JSON.parse(String(r.corpo)).length), [200, 200, 50]);
  const tutte = invii.flatMap((r) => JSON.parse(String(r.corpo)));
  ok("ogni riga porta l'identificativo dell'utente",
     tutte.every((r) => r.utente_id === UTENTE_ATTESO), JSON.stringify(tutte.find((r) => r.utente_id !== UTENTE_ATTESO)));
  ok("e nessuna riga si e' persa per strada",
     tutte.length === 450 && new Set(tutte.map((r) => r.id)).size === 450, String(tutte.length));
  ok("l'upsert e' dichiarato su id in ogni richiesta",
     invii.every((r) => r.parametri.get("on_conflict") === "id"));
  servitoreInUso = servitore;
});

await scenario("C7 raggiungibile() torna false invece di sollevare quando la rete non c'e'", async () => {
  const spenta = servitoreNuovo();
  spenta.programma({ rete: true });
  ok("false, non un'eccezione", (await nuvolaDiProva().raggiungibile()) === false);
  ok("e ci prova una volta sola: non e' una richiesta da riprovare",
     spenta.richieste.length === 1, String(spenta.richieste.length));
  // Anche una chiave rifiutata e' un «non raggiungibile»: la domanda che pone
  // e' «posso parlare con Supabase adesso», e la risposta e' no in entrambi i casi.
  const rifiuta = servitoreNuovo();
  rifiuta.programma({ stato: 401, corpo: "Invalid API key" });
  ok("false anche con la chiave rifiutata", (await nuvolaDiProva().raggiungibile()) === false);
  const chiesto = rifiuta.richieste[0];
  ok("la sonda e' una lettura minima", chiesto.url.endsWith("/rest/v1/articoli?select=id&limit=1"), chiesto.url);
  uguali("con le intestazioni di lettura",
    { apikey: chiesto.intestazioni.apikey, Authorization: chiesto.intestazioni.Authorization,
      "Accept-Profile": chiesto.intestazioni["Accept-Profile"] },
    { apikey: CHIAVE_FINTA, Authorization: `Bearer ${CHIAVE_FINTA}`, "Accept-Profile": "percorso" });
  servitoreInUso = servitore;
});

await scenario("C8 Storage: il caricamento va al deposito giusto, con x-upsert", async () => {
  const deposito = servitoreNuovo();
  await nuvolaDiProva().caricaFile("manuale/vol-9.pdf", "file:///finto/vol-9.pdf");
  const chiesto = deposito.richieste[0];
  ok("una sola richiesta", deposito.richieste.length === 1, String(deposito.richieste.length));
  ok("verso il deposito dichiarato in cliente.ts",
     chiesto.percorso === `/storage/v1/object/${tab.Cliente.DEPOSITO}/manuale/vol-9.pdf`, chiesto.percorso);
  ok("in POST", chiesto.metodo === "POST", chiesto.metodo);
  ok("con x-upsert, perche' un reinvio dello stesso volume non deve fallire",
     chiesto.intestazioni["x-upsert"] === "true", JSON.stringify(chiesto.intestazioni));
  ok("e la chiave", chiesto.intestazioni.apikey === CHIAVE_FINTA);
  ok("il deposito finto ha ricevuto qualcosa", deposito.deposito.has("manuale/vol-9.pdf"));
  // Un PDF non sta nei venti secondi delle chiamate REST: il timeout e' altro.
  ok("il timer di scadenza del caricamento e' quello lungo",
     durateChieste.includes(120000), JSON.stringify(durateChieste.slice(-3)));
  servitoreInUso = servitore;
});

// =========================================================================
// PARTE D — giro completo fra due dispositivi
// =========================================================================

await scenario("D1 quello che il primo scrive ricompare IDENTICO sul secondo", async () => {
  // La domanda: i payload scritti dall'app sono abbastanza completi perche' la
  // proiezione ricostruisca la riga su un dispositivo che non l'ha mai vista?
  // Due grafi di moduli separati, due database, un solo finto Supabase in mezzo.
  const uno = await apriDispositivo("d1", "d1-tablet", true);
  const due = await apriDispositivo("d2", "d2-telefono", true);
  const nuvola = servitoreNuovo();

  // La conduttura quotidiana ha depositato un articolo: e' cosi' che un
  // articolo arriva sui dispositivi, nessuno dei due lo scrive.
  nuvola.semina("eventi", [
    {
      id: "ev-d-articolo", hlc: hlcRemoto(1000, "rassegna"), dispositivo_id: "rassegna",
      entita: "articoli", entita_id: "d-art-1", tipo: "crea",
      payload: {
        titolo: "Acqua e igiene nei campi profughi", autori: "S. Haddad",
        fonte: "PLOS Med", raccolto_a: "2026-09-02T05:00:00.000Z",
        testo: "Il testo intero, perche' leggere non deve richiedere rete.",
        tema_slug: "acqua", letto: 0, salvato: 0,
      },
      utente_id: UTENTE_ATTESO,
    },
  ]);

  const primoGiro = await sincronizza(uno, nuvola);
  uguali("il tablet riceve l'articolo e lo proietta",
    { riuscito: primoGiro.riuscito, nuovi: primoGiro.nuovi, scritte: primoGiro.proiezione.scritte },
    { riuscito: true, nuovi: 1, scritte: 1 });

  // Le due scritture vere dell'app, con il codice vero.
  const segno = await uno.Segni.annota(
    "d-vol-1", "nota", "Tabella 3: rivedere le unita' di misura", 31, "cap-2:tab-3");
  await uno.Articoli.segnaLetto("d-art-1", true);

  const salita = await sincronizza(uno, nuvola);
  uguali("il tablet manda le sue due scritture", [salita.riuscito, salita.inviati], [true, 2]);

  // Il secondo dispositivo non ha mai visto nessuna di queste righe.
  const primaDelloScambio = await riga(due, "segni", "id", segno.id);
  ok("sul telefono non c'e' niente, prima", primaDelloScambio === null || primaDelloScambio === undefined);

  const discesa = await sincronizza(due, nuvola);
  uguali("il telefono riceve i tre eventi e ne proietta due entita'",
    { riuscito: discesa.riuscito, ricevuti: discesa.ricevuti, nuovi: discesa.nuovi,
      scritte: discesa.proiezione.scritte, incomplete: discesa.proiezione.incomplete },
    { riuscito: true, ricevuti: 3, nuovi: 3, scritte: 2, incomplete: [] });

  const segnoUno = await riga(uno, "segni", "id", segno.id);
  const segnoDue = await riga(due, "segni", "id", segno.id);
  ok("il segno esiste sul secondo dispositivo", segnoDue !== null && segnoDue !== undefined, "nessuna riga");
  uguali("ed e' identico, colonna per colonna", segnoDue, segnoUno);
  uguali("con il contenuto scritto sul primo",
    { volume_id: segnoDue.volume_id, genere: segnoDue.genere, pagina: segnoDue.pagina,
      ancora: segnoDue.ancora, testo: segnoDue.testo },
    { volume_id: "d-vol-1", genere: "nota", pagina: 31, ancora: "cap-2:tab-3",
      testo: "Tabella 3: rivedere le unita' di misura" });

  const artUno = await riga(uno, "articoli", "id", "d-art-1");
  const artDue = await riga(due, "articoli", "id", "d-art-1");
  ok("l'articolo esiste sul secondo dispositivo", artDue !== null && artDue !== undefined, "nessuna riga");
  uguali("ed e' identico, colonna per colonna", artDue, artUno);
  ok("compreso il 'letto' messo sul primo dispositivo", artDue.letto === 1, String(artDue.letto));
  ok("e il testo integrale, che e' cio' che rende l'articolo studiabile in aereo",
     artDue.testo === "Il testo intero, perche' leggere non deve richiedere rete.", String(artDue.testo));

  // Le API di lettura dell'app vedono la stessa cosa delle due query dirette.
  const segniDelVolume = await due.Segni.segniDi("d-vol-1");
  uguali("segniDi() sul secondo dispositivo trova la nota", segniDelVolume.map((s) => s.id), [segno.id]);
  const letti = await due.Articoli.elencaArticoli({ soloDaLeggere: true });
  ok("e l'articolo non compare piu' fra quelli da leggere",
     !letti.some((a) => a.id === "d-art-1"), JSON.stringify(letti.map((a) => a.id)));

  servitoreInUso = servitore;
});

// =========================================================================
// PARTE E — invariante 1 e la trappola della scrittura annidata
// =========================================================================

/**
 * Lo stesso scanner di test/banco/prova-registro.mjs (parte E3), ricopiato.
 *
 * Dalla parentesi aperta di ogni `registra(` / `inTransazione(` si scorre fino
 * alla sua chiusura contando le parentesi: dentro quegli argomenti c'e' la
 * proiezione. Se li' dentro compare un'altra scrittura, e' un annidamento, e un
 * annidamento con la coda delle scritture di lib/db.ts non fallisce: si ferma,
 * e con lui ogni scrittura successiva dell'app, senza un errore e senza un
 * messaggio (vedi il commento lungo in lib/db.ts).
 *
 * Non vede gli annidamenti INDIRETTI (una funzione che ne chiama un'altra):
 * quelli li ferma solo chi legge.
 */
function annidamentiIn(percorso, testo) {
  const trovati = [];
  const cerca = /\b(registra|inTransazione)\s*\(/g;
  let trovato;
  while ((trovato = cerca.exec(testo))) {
    let i = trovato.index + trovato[0].length;
    let livello = 1;
    while (i < testo.length && livello > 0) {
      if (testo[i] === "(") livello++;
      else if (testo[i] === ")") livello--;
      i++;
    }
    const argomenti = testo.slice(trovato.index + trovato[0].length, i - 1);
    if (/\b(registra|inTransazione)\s*\(/.test(argomenti)) {
      trovati.push(`${percorso}: dentro ${trovato[1]}()`);
    }
  }
  return trovati;
}

await scenario("E1 lo scanner degli annidamenti sa diventare rosso", async () => {
  // Senza questo controllo, E2 sarebbe un timbro: uno scanner che non trova
  // mai niente passerebbe anche su un file pieno di annidamenti.
  const annidato = `
    await registra("note", id, "crea", payload, async (d, hlc) => {
      await registra("temi", "t1", "aggiorna", {}, async () => {});
    });
  `;
  uguali("un annidamento inventato viene visto",
    annidamentiIn("finto.ts", annidato), ["finto.ts: dentro registra()"]);
  const pulito = `
    await registra("note", id, "crea", payload, async (d, hlc) => {
      await d.runAsync("INSERT INTO note VALUES (?)", [id]);
    });
    await inTransazione(async (d) => { await d.runAsync("DELETE FROM note"); });
  `;
  uguali("e due scritture sorelle non vengono scambiate per annidate",
    annidamentiIn("finto.ts", pulito), []);
});

await scenario("E2 prova-registro.mjs non guarda lib/nuvola: la verifica vive qui", async () => {
  // La domanda posta a questa simulazione era: l'elenco di sorgenti della
  // parte E3 di prova-registro.mjs COMPRENDE lib/nuvola/*.ts? Oggi no. Quel
  // file non si tocca (e' di un altro banco): lo stesso controllo sta qui
  // sotto, in E3. Il giorno in cui quell'elenco crescera', questa verifica
  // diventera' rossa — ed e' il momento di togliere E3 da qui.
  const registro = readFileSync(join(RADICE_PROGETTO, "test", "banco", "prova-registro.mjs"), "utf8");
  const blocco = registro.match(/const sorgentiScrittura = \[([\s\S]*?)\];/);
  ok("l'elenco di prova-registro.mjs si trova ancora", blocco !== null, "la parte E3 e' cambiata forma");
  const elencoAltrui = [...blocco[1].matchAll(/"([^"]+)"/g)].map((m) => m[1]);
  ok("ed e' un elenco di sorgenti veri", elencoAltrui.length >= 5, JSON.stringify(elencoAltrui));
  uguali("nessun file di lib/nuvola/ e' fra quelli che guarda",
    elencoAltrui.filter((p) => p.startsWith("lib/nuvola/")), []);

  // E i sorgenti di lib/nuvola/ che scrivono davvero ci sono: non si sta
  // verificando il vuoto.
  const scrittori = sorgentiNuvola().filter((p) =>
    /\b(registra|inTransazione)\s*\(/.test(readFileSync(p, "utf8")));
  ok("lib/nuvola/ ha punti di scrittura da sorvegliare", scrittori.length >= 4,
     JSON.stringify(scrittori.map((p) => p.replace(RADICE_PROGETTO + "/", ""))));
});

function sorgentiNuvola() {
  const cartella = join(RADICE_PROGETTO, "lib", "nuvola");
  return readdirSync(cartella, { withFileTypes: true })
    .filter((v) => v.isFile() && /\.tsx?$/.test(v.name))
    .map((v) => join(cartella, v.name))
    .sort();
}

await scenario("E3 nessuna scrittura di lib/nuvola/ e' annidata dentro un'altra", async () => {
  const sorgenti = sorgentiNuvola();
  ok("si esaminano tutti i file di lib/nuvola/", sorgenti.length >= 6,
     JSON.stringify(sorgenti.map((p) => p.replace(RADICE_PROGETTO + "/", ""))));
  const annidamenti = [];
  for (const percorso of sorgenti) {
    annidamenti.push(...annidamentiIn(percorso.replace(RADICE_PROGETTO + "/", ""), readFileSync(percorso, "utf8")));
  }
  uguali("nessun annidamento", annidamenti, []);

  // La regola scritta in testa a proiezione.ts, verificata: quel file scrive
  // SOLO con la connessione che riceve, e non apre mai una scrittura propria.
  const proiezione = readFileSync(join(RADICE_PROGETTO, "lib", "nuvola", "proiezione.ts"), "utf8");
  ok("proiezione.ts non importa ne' registra ne' inTransazione",
     !/\b(registra|inTransazione)\b/.test(
       proiezione
         .split("export async function applica")[0]
         .replace(/\/\*[\s\S]*?\*\//g, " ")
         .replace(/\/\/[^\n]*/g, " ")
     ),
     "proiezione.ts ha cominciato a importare una scrittura propria");
  ok("e applica() riceve la connessione invece di prenderla da se'",
     /export async function applica\(\s*d: SQLite\.SQLiteDatabase/.test(proiezione),
     "la firma di applica() e' cambiata: rileggere la regola 1 in testa al file");
});

// =========================================================================
// RIEPILOGO
// =========================================================================
rimettiGlobali();

const difetti = scenari.filter((s) => s.nome.includes("DIFETTO RIPRODOTTO"));
console.log("");
console.log(`DIFETTI DELL'APP RIPRODOTTI E NON CORRETTI: ${difetti.length}`);
for (const d of difetti) console.log(`  · ${d.nome.replace(/^\S+\s/, "")}`);

console.log("");
console.log(`Scenari: ${scenari.length}, tutti verdi.`);
rmSync(RADICE, { recursive: true, force: true });
console.log(`${verificheTotali} verifiche passate, 0 fallite`);
process.exit(0);

/* ------------------------------------------------------------ FALSIFICAZIONE
 * Fatta, non immaginata.
 *
 * Ricetta. Si copia l'albero `lib/` FUORI dal progetto, si guasta UN file della
 * copia, e si dirotta su quella copia il dispositivo principale con
 * BANCO_NUVOLA_EXTRA (le chiavi sono gli specificatori con cui questo test
 * importa i moduli). Nessun file del progetto si tocca, e i due dispositivi
 * della parte D continuano a girare sul codice vero, che e' quello che serve.
 *
 *   cp -r lib /fuori/mutante && $EDITOR /fuori/mutante/nuvola/proiezione.ts
 *   BANCO_NUVOLA_EXTRA='{"../../lib/db.ts":"/fuori/mutante/db.ts",
 *                        "../../lib/hlc.ts":"/fuori/mutante/hlc.ts",
 *                        "../../lib/sync/fusione.ts":"/fuori/mutante/sync/fusione.ts",
 *                        "../../lib/nuvola/proiezione.ts":"/fuori/mutante/nuvola/proiezione.ts",
 *                        "../../lib/nuvola/sincronia.ts":"/fuori/mutante/nuvola/sincronia.ts",
 *                        "../../lib/nuvola/cliente.ts":"/fuori/mutante/nuvola/cliente.ts",
 *                        "../../lib/nuvola/articoli.ts":"/fuori/mutante/nuvola/articoli.ts",
 *                        "../../lib/nuvola/segni.ts":"/fuori/mutante/nuvola/segni.ts"}' \
 *     node test/simulazione/nuvola.mjs
 *
 * L'albero va sostituito INTERO, non il solo file guastato: mezzo grafo dalla
 * copia e mezzo dal progetto darebbero due lib/db.ts, due singoletti, e un
 * «Database non aperto» che non dice niente sulla mutazione (misurato).
 *
 * Le cinque mutazioni provate, e lo scenario che ciascuna ha reso rosso. La
 * prova si ferma al primo rosso, quindi si misura quello:
 *
 *   (a) proiezione.ts, valore(): tolta la riga
 *       `if (typeof v === "boolean") return v ? 1 : 0;`.
 *       MISURATO: rosso ad A10, «in colonna ci sono 1 e 0» — atteso [1,0],
 *       ottenuto ["true","false"]. E' la falsificazione che conta di piu': la
 *       riga c'e' e sembra a posto finche' non la si CERCA come fa l'app.
 *
 *   (b) proiezione.ts: il calcolo di `mancano` sostituito con `[]`, cioe' si
 *       prova a creare la riga anche senza le colonne obbligatorie.
 *       MISURATO: rosso ad A6, «NOT NULL constraint failed: articoli.titolo» —
 *       la proiezione solleva invece di contare la riga fra le incomplete, e
 *       con lei cadrebbe l'intera sincronizzazione per una riga sola.
 *
 *   (c) sincronia.ts: `payload: analizza(e.payload)` sostituito con
 *       `payload: e.payload`, cioe' il payload parte come stringa.
 *       MISURATO: rosso a B1, «il payload e' un oggetto, non una stringa».
 *
 *   (d) sincronia.ts: tolta la riga `await assorbiRemoto(...)`.
 *       MISURATO: rosso a B6 — il primo evento locale scritto dopo lo scambio
 *       nasce piu' vecchio di quello appena ricevuto (invariante 2).
 *
 *   (e) cliente.ts: `daRiprovare()` che torna sempre `true`, cioe' si riprova
 *       anche un 4xx.
 *       MISURATO: rosso a B8, «un 4xx non si riprova» — quattro tentativi di
 *       scrittura invece di uno. Si noti che cade PRIMA di C2, che e' lo
 *       scenario scritto apposta per quella regola: e' la conferma che la
 *       stessa proprieta' e' sorvegliata in due punti diversi.
 *
 * LIMITI DI QUESTA SIMULAZIONE (leggere prima di fidarsi del verde):
 *   - niente rete vera: il finto server risponde come PostgREST per le poche
 *     forme che l'app usa. Non prova le policy RLS, che sono meta' della
 *     recinzione dei dati e vivono solo su Supabase;
 *   - niente Storage vero: `File.downloadFileAsync` nel banco solleva sempre,
 *     quindi lo scaricamento dei volumi (scaricaVolumiMancanti) non e' coperto
 *     qui. Il caricamento sì, perche' passa da `fetch`;
 *   - niente interfaccia: lib/nuvola/useNuvola.ts e' un hook e senza renderer
 *     non si chiama. Le sue soglie (10 minuti / 1 minuto) non sono verificate;
 *   - i due dispositivi della parte D girano nello stesso processo, uno dopo
 *     l'altro: provano la convergenza, non il parallelismo.
 */
