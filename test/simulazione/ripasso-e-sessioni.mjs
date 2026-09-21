/**
 * SIMULAZIONE DELLA SUPERFICIE "RIPASSO E SESSIONI".
 *
 * Copre lib/sessioni.ts (codice vero, caricato dal banco) e app/ripasso.tsx
 * (logica ricopiata riga per riga: il banco non ha react-native ne expo-router,
 * quindi un .tsx non si carica — vedi il limite 3 del banco).
 *
 * Si esegue dalla radice del progetto, in uno dei due modi (equivalenti):
 *
 *   node test/simulazione/ripasso-e-sessioni.mjs
 *   node --import ./test/banco/carica.mjs test/simulazione/ripasso-e-sessioni.mjs
 *
 * COSA SIMULA, nell'ordine:
 *   A. chiusura del cronometro: ogni tipo di blocco, ogni confine (5 min, doppio
 *      del previsto, 180 min), l'arrotondamento al minuto, i tipi fuori catalogo;
 *   B. inizioSettimana: i sette giorni, i due cambi d'ora, la non-mutazione;
 *   C. riepilogoSettimana: confini della finestra settimanale e delle tre soglie
 *      (120 / 300 / 480), piu i quattro modi in cui un dato sporco la falsa;
 *   D. la regola delle tre settimane;
 *   E. l'FSRS semplificato di app/ripasso.tsx (prossimo());
 *   F. la CODA del ripasso su un database vero: zero carte, una carta, tutte
 *      scadute (199 -> LIMIT 30), ordine, pareggi, avanzamento fino in fondo,
 *      interruzione a meta sessione e riapertura, riavvio dell'app;
 *   G. valuta() su un database vero: i quattro gradi, l'evento nel registro, il
 *      payload, la crescita della stabilita, il doppio tocco;
 *   H. integrazione: cronometro chiuso -> tabella sessioni -> query di
 *      app/(tabs)/oggi.tsx -> riepilogoSettimana.
 *
 * CONVENZIONE SUI DIFETTI (la stessa di test/simulazione/registro-eventi.mjs).
 * Un difetto dell'app NON viene corretto qui e non rende rossa la prova: lo
 * scenario si chiama "DIFETTO RIPRODOTTO: ..." e verifica il comportamento
 * OSSERVATO, cosi resta una rete che diventera rossa il giorno in cui il difetto
 * sara corretto — ed e allora che va riscritta l'attesa. L'elenco completo e
 * ristampato in fondo, separato dal conteggio.
 *
 * COME FALSIFICARE QUESTA PROVA (fatto, non immaginato). Una prova che non puo
 * diventare rossa non dimostra niente. Da una cartella QUALSIASI fuori dal
 * progetto, senza toccare nessun file:
 *
 *   import "/home/user/learning_app/test/banco/carica.mjs";
 *   import { BaseDatiDoppia } from "/home/user/learning_app/test/banco/expo-sqlite.mjs";
 *   const veroGetAll = BaseDatiDoppia.prototype.getAllAsync;
 *   BaseDatiDoppia.prototype.getAllAsync = async function (sql, ...resto) {
 *     return veroGetAll.call(this, sql.replace("LIMIT 30", "LIMIT 300"), ...resto);
 *   };
 *   await import("/home/user/learning_app/test/simulazione/ripasso-e-sessioni.mjs");
 *
 * MISURATO, non immaginato: togliendo il LIMIT 30 cadono 3 scenari e 5
 * verifiche — F4, F5 e F13, cioe esattamente i tre che parlano del tetto di 30
 * carte. Neutralizzando invece il ROLLBACK del doppio (withTransactionAsync che
 * fa COMMIT anche in caso di errore, stessa ricetta di prova-registro.mjs)
 * cadono 2 scenari e 5 verifiche — G8 e H3, i due in cui una scrittura deve
 * sparire per intero. Gli altri scenari restano verdi ed e giusto: non
 * dipendono ne dal limite ne dal rollback. Sono il motore e le transazioni vere
 * a far passare questa prova, non la compiacenza del doppio.
 *
 * LIMITI DI QUESTA SIMULAZIONE (leggere prima di fidarsi del verde):
 *   - niente interfaccia: la schermata e ricostruita come macchina a stati
 *     (SchermataRipasso qui sotto) a partire dal .tsx. Un difetto che sta
 *     nell'albero React — un tocco che parte due volte perche il Pressable non
 *     si disabilita, uno setState su componente smontato — qui non si vede;
 *   - sotto c'e node:sqlite, sincrono: l'interfogliamento dello scenario G8 e
 *     quello dei microcompiti di JavaScript (identico sul telefono, perche gli
 *     await sono gli stessi), non il parallelismo del thread nativo;
 *   - il fuso orario si cambia con process.env.TZ, che in Node ha effetto
 *     immediato: e il modo piu vicino al viaggio Roma -> Citta del Messico che si
 *     possa ottenere senza due dispositivi;
 *   - un secondo dispositivo non c'e: gli eventi "remoti" dello scenario H4 sono
 *     righe seminate a mano, con la forma esatta che avrebbero dopo la fusione.
 */
process.env.TZ = "Europe/Rome"; // il dispositivo dell'utente: tutto il resto lo dichiara
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
// L'ordine conta: carica.mjs per primo, perche registra i ganci del banco.
import "../banco/carica.mjs";
import { configuraCartella } from "../banco/expo-sqlite.mjs";

// ------------------------------------------------------------------ CONTEGGIO
const scenari = [];
let corrente = null;

function ok(nome, condizione, extra = "") {
  if (!corrente) throw new Error("ok() fuori da uno scenario: " + nome);
  corrente.verifiche++;
  if (!condizione) corrente.errori.push(`${nome}${extra ? " — " + extra : ""}`);
}

/** Attende che `azione` lanci, e che il messaggio contenga `frammento`. */
async function lancia(nome, azione, frammento) {
  let messaggio = null;
  try {
    await azione();
  } catch (errore) {
    messaggio = String(errore?.message ?? errore);
  }
  if (messaggio === null) {
    ok(nome, false, "non ha lanciato nessun errore");
    return "";
  }
  ok(nome, messaggio.includes(frammento), `messaggio: ${messaggio}`);
  return messaggio;
}

async function prova(nome, azione) {
  corrente = {
    nome,
    verifiche: 0,
    errori: [],
    difetto: nome.startsWith("DIFETTO RIPRODOTTO"),
    correzione: nome.startsWith("CORREZIONE SORVEGLIATA"),
  };
  scenari.push(corrente);
  try {
    await azione();
  } catch (errore) {
    corrente.verifiche++;
    corrente.errori.push("eccezione non attesa: " + String(errore?.stack ?? errore));
  }
  const esito = corrente.errori.length === 0;
  console.log(`${esito ? "  ok  " : "FALLITO"}  ${nome}  (${corrente.verifiche} verifiche)`);
  for (const e of corrente.errori) console.log(`          ! ${e}`);
  corrente = null;
}

// ------------------------------------------------------------------- AMBIENTE
const RADICE = mkdtempSync(join(tmpdir(), "sim-ripasso-"));
let contatoreIstanze = 0;

/**
 * Un "avvio dell'app": istanza nuova di lib/db.ts + cartella sua.
 * lib/db.ts tiene `db` in una variabile di modulo, quindi per simulare piu
 * avvii serve rivalutare il modulo: la stringa di richiesta nell'URL lo ottiene.
 * Passando `cartella` si riapre un database gia esistente (riavvio dell'app).
 */
async function avvia(dispositivo, cartella) {
  contatoreIstanze++;
  const dove = cartella ?? join(RADICE, "avvio-" + contatoreIstanze);
  configuraCartella(dove);
  const app = await import(`../../lib/db.ts?istanza=ripasso${contatoreIstanze}`);
  await app.apri(dispositivo);
  return { app, base: app.database(), cartella: dove };
}

/** Modulo lib/db.ts appena valutato e MAI aperto: serve allo scenario F15. */
async function moduloVergine() {
  contatoreIstanze++;
  configuraCartella(join(RADICE, "vergine-" + contatoreIstanze));
  return import(`../../lib/db.ts?istanza=ripasso${contatoreIstanze}`);
}

/**
 * Congela l'orologio di sistema. Deve sostituire ANCHE il costruttore di Date:
 * app/ripasso.tsx calcola la prossima scadenza con Date.now() ma scrive
 * ultima_revisione con new Date(), e la query della coda usa new Date() —
 * congelare solo Date.now lascerebbe meta simulazione sull'ora vera.
 */
const DateVera = Date;
function congelaOra(valore) {
  class DateCongelata extends DateVera {
    constructor(...argomenti) {
      if (argomenti.length === 0) super(valore);
      else super(...argomenti);
    }
    static now() { return valore; }
  }
  globalThis.Date = DateCongelata;
}
function scongelaOra() { globalThis.Date = DateVera; }

/** Esegue `fn` con un altro fuso orario di sistema, poi rimette quello di Roma. */
function conFuso(fuso, fn) {
  const precedente = process.env.TZ;
  process.env.TZ = fuso;
  try { return fn(); } finally { process.env.TZ = precedente; }
}

const MIN = 60_000;
const PASSATO = "2020-01-01T00:00:00.000Z";
const FUTURO = "2099-01-01T00:00:00.000Z";

/**
 * Semina una flashcard come fa caricaContenuti(): riga in `esercizi` e riga in
 * `ripasso`, entrambe FUORI dal registro eventi (e cosi anche sul telefono).
 */
async function seminaScheda(base, id, opzioni = {}) {
  await base.runAsync(
    `INSERT INTO esercizi (id, tema_slug, tipo, livello, consegna, soluzione_riferimento, fonte_citazione)
     VALUES (?,?,?,?,?,?,?)`,
    [id, opzioni.tema ?? "flashcard", "quiz_citato", 2,
     opzioni.consegna ?? `Domanda ${id}`,
     opzioni.risposta ?? `Risposta ${id}`,
     opzioni.fonte ?? null]);
  await base.runAsync(
    `INSERT INTO ripasso (esercizio_id, stabilita, ripetizioni, ultima_revisione, prossima_revisione, stato)
     VALUES (?,?,?,?,?,?)`,
    [id, opzioni.stabilita ?? 0, opzioni.ripetizioni ?? 0,
     opzioni.ultima ?? null, opzioni.quando ?? PASSATO, opzioni.stato ?? "nuovo"]);
}

// ============================================================================
// LA SCHERMATA app/ripasso.tsx COME MACCHINA A STATI
// Ricopiata riga per riga dal .tsx: query dell'effetto, prossimo(), valuta(),
// e il ramo di render. Se il .tsx cambia, questa copia va riallineata a mano —
// e il prezzo di non poter caricare un componente react-native nel banco.
// ============================================================================

/** app/ripasso.tsx:8 — FSRS semplificato. */
function prossimo(grado, stabilita) {
  if (grado === 0) return { stabilita: 0, giorni: 0 };
  const fattore = [0, 1.2, 2.2, 3.4][grado];
  const nuova = Math.max(1, (stabilita || 1) * fattore);
  return { stabilita: nuova, giorni: Math.round(nuova) };
}

/** I quattro gradi, nell'ordine in cui compaiono a schermo (app/ripasso.tsx:54). */
const GRADI = ["Di nuovo", "Difficile", "Bene", "Facile"];

class SchermataRipasso {
  constructor(app) {
    this.app = app;
    this.coda = [];      // useState<Scheda[]>([])
    this.i = 0;          // useState(0)
    this.scoperta = false; // useState(false)
    this.erroreEffetto = null; // sul telefono sarebbe una promessa non gestita
  }

  /** L'useEffect con dipendenze []: gira una volta sola, al montaggio. */
  async monta() {
    try {
      const d = this.app.database();
      this.coda = await d.getAllAsync(
        `SELECT e.id, e.consegna, e.soluzione_riferimento, e.fonte_citazione
         FROM ripasso r JOIN esercizi e ON e.id = r.esercizio_id
         WHERE r.prossima_revisione <= ? ORDER BY r.prossima_revisione LIMIT 30`,
        [new Date().toISOString()]);
    } catch (errore) {
      // Nel .tsx questa promessa non e gestita: l'errore non arriva a schermo.
      this.erroreEffetto = errore;
    }
    return this;
  }

  /** Cio che l'utente vede in questo istante. */
  render() {
    const s = this.coda[this.i];
    if (!s) return { vuota: true, testo: "Nessuna scheda da ripassare." };
    return {
      vuota: false,
      contatore: `${this.i + 1} di ${this.coda.length}`,
      consegna: s.consegna,
      rispostaVisibile: this.scoperta,
      risposta: this.scoperta ? s.soluzione_riferimento : null,
      // Il ternario del .tsx: NULL e stringa vuota sono entrambi falsi.
      citazione: this.scoperta && s.fonte_citazione ? s.fonte_citazione : null,
      pulsanti: this.scoperta ? [...GRADI] : ["Mostra la risposta"],
    };
  }

  mostraRisposta() { this.scoperta = true; }

  /** app/ripasso.tsx:38 — la scheda e quella catturata dalla chiusura al tocco. */
  async valuta(grado) {
    const s = this.coda[this.i];
    const d = this.app.database();
    const r = await d.getFirstAsync(
      "SELECT stabilita FROM ripasso WHERE esercizio_id = ?", [s.id]);
    const { stabilita, giorni } = prossimo(grado, r?.stabilita ?? 0);
    const quando = new Date(Date.now() + giorni * 864e5).toISOString();
    await this.app.registra("ripasso", s.id, "aggiorna", { grado, stabilita }, async (dd, hlc) => {
      await dd.runAsync(
        `UPDATE ripasso SET stabilita = ?, ripetizioni = ripetizioni + 1,
         ultima_revisione = ?, prossima_revisione = ?, stato = ? WHERE esercizio_id = ?`,
        [stabilita, new Date().toISOString(), quando, grado === 0 ? "ricaduta" : "ripasso", s.id]);
    });
    this.scoperta = false;
    this.i = this.i + 1;
  }

  /** Il giro completo che fa l'utente su una carta: scopri, valuta. */
  async carta(grado) { this.mostraRisposta(); await this.valuta(grado); }
}

/** components/Cronometro.tsx:56 — proiezione della chiusura di un blocco. */
const proiettaSessione = (id, tipo, inizio, minuti) => async (d, hlc) => {
  await d.runAsync(
    "INSERT INTO sessioni (id, tipo, inizio, minuti, hlc) VALUES (?,?,?,?,?)",
    [id, tipo, new Date(inizio).toISOString(), minuti, hlc]);
};

// ============================================================================
// A. CHIUSURA DEL CRONOMETRO — lib/sessioni.ts, chiudiSessione()
// ============================================================================
const sessioni = await import("../../lib/sessioni.ts");
const { chiudiSessione, inizioSettimana, riepilogoSettimana,
        settimaneConsecutiveSottoMinimo, DURATA_PREVISTA } = sessioni;
const T0 = new Date("2026-10-05T07:00:00").getTime(); // un lunedi qualunque

await prova("A1 ogni tipo di blocco chiuso alla sua durata prevista e regolare", async () => {
  for (const [tipo, previsti] of Object.entries(DURATA_PREVISTA)) {
    const r = chiudiSessione(T0, T0 + previsti * MIN, tipo);
    ok(`${tipo}: valida`, r.valida === true);
    ok(`${tipo}: ${previsti} minuti registrati`, r.minuti === previsti, String(r.minuti));
    ok(`${tipo}: nessun avviso`, r.avviso === undefined);
  }
  ok("le cinque durate previste sono quelle del piano",
    JSON.stringify(DURATA_PREVISTA) ===
    JSON.stringify({ mattina: 30, artefatto: 45, lettura: 25, paper: 25, ripasso: 15 }));
});

await prova("A2 la durata e arrotondata al minuto, non troncata", async () => {
  ok("29m29s -> 29", chiudiSessione(T0, T0 + (29 * 60 + 29) * 1000, "mattina").minuti === 29);
  ok("29m30s -> 30", chiudiSessione(T0, T0 + (29 * 60 + 30) * 1000, "mattina").minuti === 30);
  ok("29m31s -> 30", chiudiSessione(T0, T0 + (29 * 60 + 31) * 1000, "mattina").minuti === 30);
  ok("un secondo esatto non basta", chiudiSessione(T0, T0 + 1000, "mattina").valida === false);
});

await prova("A3 confine dei 5 minuti: sotto non si registra, l'arrotondamento decide", async () => {
  ok("4m29s rifiutata", chiudiSessione(T0, T0 + (4 * 60 + 29) * 1000, "mattina").valida === false);
  const bordo = chiudiSessione(T0, T0 + (4 * 60 + 30) * 1000, "mattina");
  ok("4m30s arrotonda a 5 e viene registrata", bordo.valida === true && bordo.minuti === 5,
    JSON.stringify(bordo));
  ok("4m31s registrata come 5", chiudiSessione(T0, T0 + (4 * 60 + 31) * 1000, "mattina").minuti === 5);
  ok("5m00s registrata", chiudiSessione(T0, T0 + 5 * MIN, "mattina").minuti === 5);
  const rifiutata = chiudiSessione(T0, T0 + 3 * MIN, "mattina");
  ok("il motivo nomina il minimo", rifiutata.valida === false &&
    rifiutata.motivo === "meno di 5 minuti: non registrata", JSON.stringify(rifiutata));
});

await prova("A4 fine precedente o uguale all'inizio (orologio spostato indietro)", async () => {
  const indietro = chiudiSessione(T0, T0 - MIN, "mattina");
  ok("rifiutata", indietro.valida === false);
  ok("il motivo lo dice", indietro.motivo === "fine precedente all'inizio", indietro.motivo);
  ok("fine identica all'inizio e rifiutata", chiudiSessione(T0, T0, "mattina").valida === false);
  ok("un millisecondo avanti non basta comunque (sotto i 5 minuti)",
    chiudiSessione(T0, T0 + 1, "mattina").valida === false);
});

await prova("A5 confine del doppio della durata prevista", async () => {
  const doppio = chiudiSessione(T0, T0 + 60 * MIN, "mattina"); // 2 x 30
  ok("60 minuti su 30 previsti: nessun avviso (il confronto e >)",
    doppio.valida === true && doppio.minuti === 60 && doppio.avviso === undefined,
    JSON.stringify(doppio));
  const oltre = chiudiSessione(T0, T0 + 61 * MIN, "mattina");
  ok("61 minuti: avviso, minuti reali", oltre.valida === true && oltre.minuti === 61 &&
    typeof oltre.avviso === "string");
  ok("l'avviso nomina i minuti e i previsti",
    oltre.avviso.includes("61 minuti") && oltre.avviso.includes("30 previsti"), oltre.avviso);
  const ripassoLungo = chiudiSessione(T0, T0 + 31 * MIN, "ripasso"); // 2 x 15 = 30
  ok("ripasso a 31 minuti supera il doppio dei 15 previsti",
    ripassoLungo.valida === true && ripassoLungo.minuti === 31 && Boolean(ripassoLungo.avviso));
});

await prova("A6 confine dei 180 minuti: cronometro dimenticato", async () => {
  const esatti = chiudiSessione(T0, T0 + 180 * MIN, "mattina");
  ok("180 esatti: minuti reali (il confronto e >)", esatti.valida === true && esatti.minuti === 180,
    JSON.stringify(esatti));
  ok("180 esatti hanno comunque l'avviso del doppio", esatti.avviso.includes("oltre il doppio"));
  const uno = chiudiSessione(T0, T0 + 181 * MIN, "mattina");
  ok("181: si registra la durata PREVISTA, non quella reale", uno.minuti === 30, String(uno.minuti));
  ok("l'avviso dichiara i minuti reali e quelli registrati",
    uno.avviso.includes("181 minuti") && uno.avviso.includes("(30 min)"), uno.avviso);
});

await prova("A7 cronometro dimenticato tutta la notte non gonfia la settimana", async () => {
  for (const [tipo, previsti] of Object.entries(DURATA_PREVISTA)) {
    const notte = chiudiSessione(T0, T0 + 10 * 60 * MIN, tipo); // 10 ore
    ok(`${tipo}: registra ${previsti} invece di 600`, notte.valida === true && notte.minuti === previsti,
      String(notte.minuti));
  }
  const treGiorni = chiudiSessione(T0, T0 + 72 * 60 * MIN, "lettura");
  ok("tre giorni interi restano 25 minuti", treGiorni.minuti === 25);
});

await prova("DIFETTO RIPRODOTTO: A8 tipo di blocco fuori dai cinque, oltre 180 min (SES-03)", async () => {
  // Uno sconosciuto puo arrivare da una versione futura o dalla fusione.
  const r = chiudiSessione(T0, T0 + 200 * MIN, "sconosciuto");
  ok("la chiusura si dichiara VALIDA", r.valida === true);
  ok("ma i minuti sono indefiniti", r.minuti === undefined, String(r.minuti));
  ok("e l'avviso mostra 'undefined min' all'utente",
    r.avviso.includes("(undefined min)"), r.avviso);
  // Cosa succede poi lo dimostra lo scenario H3: la riga non entra e il blocco si perde.
});

await prova("DIFETTO RIPRODOTTO: A9 tipo fuori catalogo con durata regolare passa inosservato", async () => {
  const r = chiudiSessione(T0, T0 + 30 * MIN, "sconosciuto");
  ok("minuti corretti", r.minuti === 30);
  ok("nessun avviso: il confronto con previsto*2 e NaN, quindi sempre falso",
    r.avviso === undefined);
  ok("il difetto emerge solo oltre la soglia dei 180 minuti",
    chiudiSessione(T0, T0 + 181 * MIN, "sconosciuto").minuti === undefined);
});

await prova("DIFETTO RIPRODOTTO: A10 inizio corrotto dal kv-store: minuti NaN (CRO-02)", async () => {
  // components/Cronometro.tsx fa JSON.parse del valore salvato senza validarlo:
  // un inizio non numerico arriva fin qui.
  const r = chiudiSessione(NaN, T0 + 30 * MIN, "mattina");
  ok("la guardia fine <= inizio non scatta (ogni confronto con NaN e falso)", r.valida === true);
  ok("i minuti sono NaN", Number.isNaN(r.minuti), String(r.minuti));
  ok("nessun avviso", r.avviso === undefined);
  const testo = chiudiSessione("ieri", T0, "mattina");
  ok("un inizio testuale produce lo stesso esito", testo.valida === true && Number.isNaN(testo.minuti));
});

// ============================================================================
// B. INIZIO DELLA SETTIMANA — lib/sessioni.ts, inizioSettimana()
// ============================================================================

await prova("B1 tutti i sette giorni riportano allo stesso lunedi", async () => {
  const atteso = new Date("2026-10-05T00:00:00").getTime(); // lunedi
  const giorni = ["05", "06", "07", "08", "09", "10", "11"];
  for (const g of giorni) {
    const d = inizioSettimana(new Date(`2026-10-${g}T15:30:00`));
    ok(`il ${g} ottobre parte dal 5`, d.getTime() === atteso, d.toString());
    ok(`il ${g}: e lunedi`, d.getDay() === 1);
    ok(`il ${g}: e mezzanotte esatta`, d.getHours() === 0 && d.getMinutes() === 0 &&
      d.getSeconds() === 0 && d.getMilliseconds() === 0);
  }
});

await prova("B2 la domenica torna indietro di sei giorni, non avanti di uno", async () => {
  const domenica = new Date("2026-10-11T23:59:59");
  const lunedi = inizioSettimana(domenica);
  ok("si torna al 5 ottobre", lunedi.getDate() === 5 && lunedi.getMonth() === 9, lunedi.toString());
  ok("la domenica non appartiene alla settimana successiva", lunedi < domenica);
});

await prova("B3 un lunedi a mezzanotte resta invariato, e la data in ingresso non viene mutata", async () => {
  const lunedi = new Date("2026-10-05T00:00:00");
  const copia = lunedi.getTime();
  ok("resta se stesso", inizioSettimana(lunedi).getTime() === copia);
  ok("l'argomento non e stato mutato", lunedi.getTime() === copia);
  const giovedi = new Date("2026-10-08T15:00:00");
  const prima = giovedi.getTime();
  inizioSettimana(giovedi);
  ok("nemmeno partendo da meta settimana", giovedi.getTime() === prima);
});

await prova("B4 cambio d'ora d'autunno: il lunedi resta mezzanotte locale (SES-07)", async () => {
  // In Italia l'ora legale finisce domenica 25 ottobre 2026.
  const dopo = inizioSettimana(new Date("2026-10-28T12:00:00")); // mercoledi dopo il cambio
  ok("lunedi 26 ottobre", dopo.getDate() === 26, dopo.toString());
  ok("alle 00:00 locali, non alle 01:00", dopo.getHours() === 0, dopo.toString());
  const durante = inizioSettimana(new Date("2026-10-25T12:00:00")); // la domenica del cambio
  ok("la domenica del cambio parte dal 19", durante.getDate() === 19 && durante.getHours() === 0,
    durante.toString());
});

await prova("B5 cambio d'ora di primavera: stesso requisito", async () => {
  // In Italia l'ora legale inizia domenica 29 marzo 2026.
  const dopo = inizioSettimana(new Date("2026-03-31T12:00:00"));
  ok("lunedi 30 marzo alle 00:00", dopo.getDate() === 30 && dopo.getHours() === 0, dopo.toString());
  const durante = inizioSettimana(new Date("2026-03-29T12:00:00"));
  ok("la domenica del cambio parte dal 23", durante.getDate() === 23 && durante.getHours() === 0,
    durante.toString());
});

await prova("B6 cambio di mese e di anno", async () => {
  const capodanno = inizioSettimana(new Date("2027-01-01T10:00:00")); // venerdi
  ok("il 1 gennaio 2027 appartiene alla settimana del 28 dicembre 2026",
    capodanno.getFullYear() === 2026 && capodanno.getMonth() === 11 && capodanno.getDate() === 28,
    capodanno.toString());
  const primoDelMese = inizioSettimana(new Date("2026-11-01T10:00:00")); // domenica
  ok("il 1 novembre (domenica) risale al 26 ottobre",
    primoDelMese.getMonth() === 9 && primoDelMese.getDate() === 26, primoDelMese.toString());
});

// ============================================================================
// C. RIEPILOGO DELLA SETTIMANA — lib/sessioni.ts, riepilogoSettimana()
// ============================================================================
const GIOVEDI = new Date("2026-10-08T12:00:00");

await prova("C1 nessuna sessione: zero ovunque, mai NaN ne undefined", async () => {
  const r = riepilogoSettimana([], GIOVEDI);
  ok("minuti a zero", r.minuti === 0);
  ok("tutte e cinque le voci del ripartito sono a zero",
    Object.values(r.perTipo).every((v) => v === 0) && Object.keys(r.perTipo).length === 5,
    JSON.stringify(r.perTipo));
  ok("livello sopravvivenza", r.livello === "sopravvivenza");
  ok("mancano 300 minuti al base", r.mancanoAlBase === 300);
  ok("sotto il minimo", r.sottoMinimo === true);
});

await prova("C2 la finestra settimanale e chiusa a sinistra e aperta a destra", async () => {
  const s = [
    { inizio: "2026-10-05T00:00:00", minuti: 10, tipo: "mattina" }, // lunedi 00:00 esatto
    { inizio: "2026-10-11T23:59:59", minuti: 20, tipo: "lettura" }, // domenica 23:59:59
    { inizio: "2026-10-04T23:59:59", minuti: 40, tipo: "paper" },   // un secondo prima
    { inizio: "2026-10-12T00:00:00", minuti: 80, tipo: "paper" },   // lunedi successivo 00:00
  ];
  const r = riepilogoSettimana(s, GIOVEDI);
  ok("il lunedi a mezzanotte e dentro, il lunedi dopo e fuori", r.minuti === 30, String(r.minuti));
  ok("il ripartito segue lo stesso confine", r.perTipo.paper === 0 && r.perTipo.mattina === 10 &&
    r.perTipo.lettura === 20, JSON.stringify(r.perTipo));
});

await prova("C3 somma per tipo su tutti e cinque i blocchi", async () => {
  const s = [
    { inizio: "2026-10-05T07:00:00", minuti: 30, tipo: "mattina" },
    { inizio: "2026-10-05T18:00:00", minuti: 45, tipo: "artefatto" },
    { inizio: "2026-10-06T22:00:00", minuti: 25, tipo: "lettura" },
    { inizio: "2026-10-07T13:00:00", minuti: 25, tipo: "paper" },
    { inizio: "2026-10-08T08:00:00", minuti: 15, tipo: "ripasso" },
    { inizio: "2026-10-09T07:00:00", minuti: 30, tipo: "mattina" },
  ];
  const r = riepilogoSettimana(s, GIOVEDI);
  ok("totale", r.minuti === 170, String(r.minuti));
  ok("mattina sommata due volte", r.perTipo.mattina === 60);
  ok("artefatto", r.perTipo.artefatto === 45);
  ok("lettura", r.perTipo.lettura === 25);
  ok("paper", r.perTipo.paper === 25);
  ok("ripasso", r.perTipo.ripasso === 15);
  ok("la somma del ripartito coincide con il totale",
    Object.values(r.perTipo).reduce((a, b) => a + b, 0) === r.minuti);
});

await prova("C4 confine del minimo di sopravvivenza: 120 minuti", async () => {
  const con = (m) => riepilogoSettimana([{ inizio: "2026-10-06T07:00:00", minuti: m, tipo: "mattina" }], GIOVEDI);
  ok("119 e sotto il minimo", con(119).sottoMinimo === true);
  ok("120 NON e sotto il minimo (il confronto e <)", con(120).sottoMinimo === false);
  ok("121 non e sotto il minimo", con(121).sottoMinimo === false);
  ok("120 resta comunque livello sopravvivenza", con(120).livello === "sopravvivenza");
});

await prova("C5 confini dei tre livelli: 300 e 480 minuti", async () => {
  const con = (m) => riepilogoSettimana([{ inizio: "2026-10-06T07:00:00", minuti: m, tipo: "mattina" }], GIOVEDI);
  ok("299 e sopravvivenza", con(299).livello === "sopravvivenza");
  ok("299: manca 1 minuto al base", con(299).mancanoAlBase === 1);
  ok("300 e base", con(300).livello === "base");
  ok("300: non manca piu niente", con(300).mancanoAlBase === 0);
  ok("479 e base", con(479).livello === "base");
  ok("480 e surge", con(480).livello === "surge");
  ok("mancanoAlBase non diventa mai negativo", con(1000).mancanoAlBase === 0);
});

await prova("DIFETTO RIPRODOTTO: C6 una data illeggibile finisce in OGNI settimana (SES-04)", async () => {
  const sporca = [{ inizio: "non-una-data", minuti: 99, tipo: "mattina" }];
  const questa = riepilogoSettimana(sporca, GIOVEDI);
  ok("conteggiata nella settimana corrente", questa.minuti === 99, String(questa.minuti));
  const altra = riepilogoSettimana(sporca, new Date("2025-01-15T12:00:00"));
  ok("e anche in una settimana di un altro anno", altra.minuti === 99, String(altra.minuti));
  const futura = riepilogoSettimana(sporca, new Date("2030-06-01T12:00:00"));
  ok("e pure in una settimana futura", futura.minuti === 99);
  for (const vuota of ["", null, undefined, "2026-13-45"]) {
    ok(`anche con inizio ${JSON.stringify(vuota)}`,
      riepilogoSettimana([{ inizio: vuota, minuti: 7, tipo: "mattina" }], GIOVEDI).minuti === 7 ||
      // new Date(null) vale 0 (epoch): quella riga viene scartata correttamente.
      vuota === null, JSON.stringify(vuota));
  }
});

await prova("DIFETTO RIPRODOTTO: C7 un tipo sconosciuto rende NaN il suo ripartito (SES-05)", async () => {
  const r = riepilogoSettimana([
    { inizio: "2026-10-06T07:00:00", minuti: 40, tipo: "mattina" },
    { inizio: "2026-10-06T09:00:00", minuti: 50, tipo: "meditazione" },
  ], GIOVEDI);
  ok("il TOTALE resta corretto", r.minuti === 90, String(r.minuti));
  ok("ma nel ripartito compare una chiave nuova", "meditazione" in r.perTipo);
  ok("con valore NaN", Number.isNaN(r.perTipo.meditazione), String(r.perTipo.meditazione));
  ok("le cinque voci legittime restano sane", r.perTipo.mattina === 40);
  ok("la somma del ripartito non torna piu con il totale",
    Number.isNaN(Object.values(r.perTipo).reduce((a, b) => a + b, 0)));
});

await prova("DIFETTO RIPRODOTTO: C8 minuti non numerici: null somma zero, stringa concatena (SES-09)", async () => {
  const conNull = riepilogoSettimana([{ inizio: "2026-10-06T07:00:00", minuti: null, tipo: "mattina" }], GIOVEDI);
  ok("null non rompe il totale", conNull.minuti === 0);
  ok("ma dichiara la settimana sotto il minimo", conNull.sottoMinimo === true);
  const conStringa = riepilogoSettimana([
    { inizio: "2026-10-06T07:00:00", minuti: "30", tipo: "mattina" },
  ], GIOVEDI);
  ok("una stringa viene CONCATENATA, non sommata", conStringa.minuti === "030", String(conStringa.minuti));
  ok("il ripartito eredita la concatenazione", conStringa.perTipo.mattina === "030");
  ok("mancanoAlBase invece riconverte a numero e dice 270",
    conStringa.mancanoAlBase === 270, String(conStringa.mancanoAlBase));
  ok("e sottoMinimo confronta 30 con 120, quindi e vero", conStringa.sottoMinimo === true);
});

await prova("DIFETTO RIPRODOTTO: C9 due fusi orari, stessi eventi, totali diversi (SES-06)", async () => {
  // La sessione e la stessa: un istante assoluto. Cambia solo il dispositivo.
  const s = [{ inizio: "2026-10-25T23:30:00Z", minuti: 45, tipo: "lettura" }];
  const riferimento = "2026-10-26T12:00:00Z"; // lunedi, su entrambi i dispositivi
  const roma = conFuso("Europe/Rome", () => riepilogoSettimana(s, new Date(riferimento)).minuti);
  const messico = conFuso("America/Mexico_City", () => riepilogoSettimana(s, new Date(riferimento)).minuti);
  ok("a Roma la sessione cade nella settimana corrente", roma === 45, String(roma));
  ok("a Citta del Messico no: e ancora la domenica precedente", messico === 0, String(messico));
  ok("i due dispositivi non concordano sul totale settimanale", roma !== messico);
  // E il viceversa, per mostrare che non e un caso isolato.
  const s2 = [{ inizio: "2026-10-19T04:30:00Z", minuti: 30, tipo: "mattina" }];
  const rif2 = "2026-10-20T12:00:00Z";
  const roma2 = conFuso("Europe/Rome", () => riepilogoSettimana(s2, new Date(rif2)).minuti);
  const messico2 = conFuso("America/Mexico_City", () => riepilogoSettimana(s2, new Date(rif2)).minuti);
  ok("nell'altro verso la divergenza si inverte", roma2 === 30 && messico2 === 0,
    `roma=${roma2} messico=${messico2}`);
});

// ============================================================================
// D. REGOLA DELLE TRE SETTIMANE
// ============================================================================
const OGGI_REGOLA = new Date("2026-11-02T12:00:00"); // lunedi

await prova("D1 nessuna sessione: la serie arriva al tetto di 12 (SES-08)", async () => {
  ok("dodici settimane sotto il minimo", settimaneConsecutiveSottoMinimo([], OGGI_REGOLA) === 12,
    String(settimaneConsecutiveSottoMinimo([], OGGI_REGOLA)));
  ok("un utente appena installato sarebbe subito avvisato: comportamento da decidere",
    settimaneConsecutiveSottoMinimo([], new Date()) === 12);
});

await prova("D2 una settimana valida interrompe subito la serie", async () => {
  const buona = [{ inizio: "2026-10-27T07:00:00", minuti: 150, tipo: "mattina" }]; // settimana scorsa
  ok("serie a zero", settimaneConsecutiveSottoMinimo(buona, OGGI_REGOLA) === 0,
    String(settimaneConsecutiveSottoMinimo(buona, OGGI_REGOLA)));
  ok("esattamente 120 minuti bastano a interromperla",
    settimaneConsecutiveSottoMinimo([{ inizio: "2026-10-27T07:00:00", minuti: 120, tipo: "mattina" }],
      OGGI_REGOLA) === 0);
  ok("119 minuti non bastano",
    settimaneConsecutiveSottoMinimo([{ inizio: "2026-10-27T07:00:00", minuti: 119, tipo: "mattina" }],
      OGGI_REGOLA) >= 1);
});

await prova("D3 la serie si ferma alla prima settimana buona incontrata", async () => {
  // Buona tre settimane fa: le due precedenti sono vuote, quindi serie = 2.
  const s = [{ inizio: "2026-10-13T07:00:00", minuti: 200, tipo: "mattina" }];
  ok("serie di due", settimaneConsecutiveSottoMinimo(s, OGGI_REGOLA) === 2,
    String(settimaneConsecutiveSottoMinimo(s, OGGI_REGOLA)));
  const s2 = [{ inizio: "2026-10-27T07:00:00", minuti: 200, tipo: "mattina" },
              { inizio: "2026-10-13T07:00:00", minuti: 200, tipo: "mattina" }];
  ok("con la settimana scorsa buona la serie e zero",
    settimaneConsecutiveSottoMinimo(s2, OGGI_REGOLA) === 0);
});

await prova("D4 la settimana in corso non entra nel conteggio", async () => {
  // Il ciclo parte da i = 1: la settimana corrente, ancora incompleta, non conta.
  const soloQuesta = [{ inizio: "2026-11-02T08:00:00", minuti: 300, tipo: "mattina" }];
  ok("300 minuti fatti oggi non interrompono la serie",
    settimaneConsecutiveSottoMinimo(soloQuesta, OGGI_REGOLA) === 12,
    String(settimaneConsecutiveSottoMinimo(soloQuesta, OGGI_REGOLA)));
  ok("ed e coerente: la settimana in corso non e ancora persa",
    riepilogoSettimana(soloQuesta, OGGI_REGOLA).minuti === 300);
});

// ============================================================================
// E. FSRS SEMPLIFICATO — app/ripasso.tsx, prossimo()
// ============================================================================

await prova("E1 grado 0 (Di nuovo): azzera tutto e rimette la carta in scadenza", async () => {
  const r = prossimo(0, 12.5);
  ok("stabilita azzerata", r.stabilita === 0);
  ok("giorni a zero: scade subito", r.giorni === 0);
  ok("vale anche su una carta nuova", JSON.stringify(prossimo(0, 0)) === JSON.stringify({ stabilita: 0, giorni: 0 }));
  ok("una seconda ricaduta di fila lascia stabilita 0", prossimo(0, prossimo(0, 30).stabilita).stabilita === 0);
});

await prova("E2 gradi 1, 2 e 3 su una carta nuova (stabilita 0)", async () => {
  const uno = prossimo(1, 0), due = prossimo(2, 0), tre = prossimo(3, 0);
  ok("Difficile: stabilita 1.2, un giorno", uno.stabilita === 1.2 && uno.giorni === 1, JSON.stringify(uno));
  ok("Bene: stabilita 2.2, due giorni", due.stabilita === 2.2 && due.giorni === 2, JSON.stringify(due));
  ok("Facile: stabilita 3.4, tre giorni", tre.stabilita === 3.4 && tre.giorni === 3, JSON.stringify(tre));
  ok("la base (stabilita || 1) porta a 1 anche stabilita 0", prossimo(1, 0).stabilita === prossimo(1, undefined).stabilita);
});

await prova("E3 crescita geometrica su valutazioni ripetute (RIP-09)", async () => {
  let s = 0;
  const giorni = [];
  for (let n = 0; n < 3; n++) { const p = prossimo(3, s); s = p.stabilita; giorni.push(p.giorni); }
  ok("3, 12, 39 giorni", JSON.stringify(giorni) === "[3,12,39]", JSON.stringify(giorni));
  ok("la stabilita finale e circa 39.3", Math.abs(s - 39.304) < 1e-9, String(s));
  ok("nessun tetto massimo: dopo dieci Facile si superano i mille giorni",
    (() => { let x = 0; for (let n = 0; n < 10; n++) x = prossimo(3, x).stabilita; return x; })() > 1000);
  let dopoSerie = 0;
  for (let n = 0; n < 5; n++) dopoSerie = prossimo(3, dopoSerie).stabilita;
  ok("un solo 'Di nuovo' azzera l'intera serie", prossimo(0, dopoSerie).stabilita === 0);
});

await prova("E4 il pavimento Math.max(1, ...) impedisce intervalli sotto il giorno", async () => {
  const r = prossimo(1, 0.1); // 0.1 * 1.2 = 0.12
  ok("la stabilita non scende sotto 1", r.stabilita === 1, String(r.stabilita));
  ok("e i giorni restano 1", r.giorni === 1);
  ok("con stabilita 0.9 e grado 1 si resta a 1.08", Math.abs(prossimo(1, 0.9).stabilita - 1.08) < 1e-9);
  ok("l'arrotondamento di 1.08 da comunque un giorno", prossimo(1, 0.9).giorni === 1);
  ok("il confine di Math.round: 1.5 diventa 2", prossimo(1, 1.25).giorni === 2, String(prossimo(1, 1.25).giorni));
});

await prova("DIFETTO RIPRODOTTO: E5 un grado fuori da 0..3 produce una data non valida (RIP-03)", async () => {
  // A schermo i pulsanti sono quattro, quindi oggi e latente: il giorno in cui
  // qualcuno aggiungesse un quinto grado, o lo chiamasse da un deep link, la
  // schermata lancerebbe invece di registrare.
  const r = prossimo(4, 1);
  ok("stabilita NaN", Number.isNaN(r.stabilita));
  ok("giorni NaN", Number.isNaN(r.giorni));
  await lancia("e la data della prossima revisione lancia",
    async () => new Date(Date.now() + r.giorni * 864e5).toISOString(), "Invalid time value");
  ok("stesso esito con un grado negativo", Number.isNaN(prossimo(-1, 1).giorni));
});

await prova("DIFETTO RIPRODOTTO: E6 una stabilita corrotta manda la data fuori intervallo (RIP-03)", async () => {
  // Una stabilita enorme puo arrivare dalla fusione o da una colonna corrotta.
  const r = prossimo(3, 1e9);
  ok("giorni enorme", r.giorni === 3400000000, String(r.giorni));
  await lancia("toISOString lancia invece di salvare",
    async () => new Date(Date.now() + r.giorni * 864e5).toISOString(), "Invalid time value");
  ok("il confine e circa 100 milioni di giorni",
    (() => { try { new Date(Date.now() + 1e8 * 864e5).toISOString(); return false; } catch { return true; } })());
  ok("una stabilita plausibile (1000 giorni) resta scrivibile",
    typeof new Date(Date.now() + prossimo(3, 300).giorni * 864e5).toISOString() === "string");
});

// ============================================================================
// F. LA CODA DEL RIPASSO SU UN DATABASE VERO
// ============================================================================

await prova("F1 zero carte scadute: stato vuoto e nessuna scrittura", async () => {
  const { app, base } = await avvia("ripasso01");
  await seminaScheda(base, "Q-001", { quando: FUTURO });
  await seminaScheda(base, "Q-002", { quando: FUTURO });
  const schermata = await new SchermataRipasso(app).monta();
  const vista = schermata.render();
  ok("la coda e vuota", schermata.coda.length === 0);
  ok("compare il messaggio", vista.vuota === true && vista.testo === "Nessuna scheda da ripassare.");
  ok("nessun contatore", vista.contatore === undefined);
  ok("nessun evento nel registro",
    (await base.getFirstAsync("SELECT count(*) AS n FROM eventi")).n === 0);
  ok("le due carte restano intatte",
    (await base.getFirstAsync("SELECT count(*) AS n FROM ripasso WHERE stato='nuovo'")).n === 2);
});

await prova("F2 tabella ripasso completamente vuota: stesso stato vuoto", async () => {
  const { app, base } = await avvia("ripasso02");
  const schermata = await new SchermataRipasso(app).monta();
  ok("stato vuoto", schermata.render().vuota === true);
  ok("nessun errore", schermata.erroreEffetto === null);
  // Con esercizi presenti ma nessuna riga di ripasso il JOIN non produce nulla.
  await base.runAsync(
    `INSERT INTO esercizi (id, tipo, livello, consegna) VALUES ('SQL-001','sql_eseguibile',1,'x')`);
  const seconda = await new SchermataRipasso(app).monta();
  ok("un esercizio senza riga di ripasso non entra in coda", seconda.coda.length === 0);
});

await prova("F3 una sola carta scaduta: '1 di 1', poi lo stato vuoto", async () => {
  const { app, base } = await avvia("ripasso03");
  await seminaScheda(base, "Q-010", { consegna: "Che cos'e un HLC?", risposta: "Un orologio logico ibrido." });
  const schermata = await new SchermataRipasso(app).monta();
  let vista = schermata.render();
  ok("contatore '1 di 1'", vista.contatore === "1 di 1", vista.contatore);
  ok("la consegna e visibile", vista.consegna === "Che cos'e un HLC?");
  ok("la risposta e nascosta", vista.rispostaVisibile === false && vista.risposta === null);
  ok("un solo pulsante", JSON.stringify(vista.pulsanti) === JSON.stringify(["Mostra la risposta"]));
  schermata.mostraRisposta();
  vista = schermata.render();
  ok("dopo il tocco la risposta compare", vista.risposta === "Un orologio logico ibrido.");
  ok("e compaiono i quattro gradi", JSON.stringify(vista.pulsanti) === JSON.stringify(GRADI));
  await schermata.valuta(2);
  vista = schermata.render();
  ok("valutata l'unica carta si passa allo stato vuoto", vista.vuota === true);
  ok("l'indice e avanzato a 1", schermata.i === 1);
  ok("un evento e stato scritto", (await base.getFirstAsync("SELECT count(*) AS n FROM eventi")).n === 1);
});

await prova("F4 tutte le carte scadute: la coda si ferma a 30 (RIP-03 della mappa)", async () => {
  const { app, base } = await avvia("ripasso04");
  for (let n = 0; n < 199; n++) {
    await seminaScheda(base, `Q-${String(n).padStart(3, "0")}`,
      { quando: new Date(Date.UTC(2020, 0, 1, 0, 0, n)).toISOString() });
  }
  ok("199 carte scadute nel database",
    (await base.getFirstAsync("SELECT count(*) AS n FROM ripasso WHERE prossima_revisione <= ?",
      [new Date().toISOString()])).n === 199);
  const schermata = await new SchermataRipasso(app).monta();
  ok("ma la coda ne prende 30", schermata.coda.length === 30, String(schermata.coda.length));
  ok("il contatore dice '1 di 30', non '1 di 199'", schermata.render().contatore === "1 di 30",
    schermata.render().contatore);
  ok("e la prima e la piu scaduta", schermata.coda[0].id === "Q-000", schermata.coda[0].id);
  ok("l'ultima della coda e la trentesima per scadenza", schermata.coda[29].id === "Q-029");
});

await prova("F5 confini della coda: esattamente 29, 30 e 31 carte scadute", async () => {
  for (const quante of [29, 30, 31]) {
    const { app, base } = await avvia("ripasso05-" + quante);
    for (let n = 0; n < quante; n++) {
      await seminaScheda(base, `Q-${n}`, { quando: new Date(Date.UTC(2020, 0, 1, 0, 0, n)).toISOString() });
    }
    const schermata = await new SchermataRipasso(app).monta();
    const atteso = Math.min(quante, 30);
    ok(`con ${quante} scadute la coda ne ha ${atteso}`, schermata.coda.length === atteso,
      String(schermata.coda.length));
  }
});

await prova("F6 il confine della scadenza e <= adesso, al millisecondo", async () => {
  const { app, base } = await avvia("ripasso06");
  const adesso = Date.UTC(2026, 9, 8, 12, 0, 0);
  congelaOra(adesso);
  try {
    await seminaScheda(base, "Q-PRIMA", { quando: new Date(adesso - 1).toISOString() });
    await seminaScheda(base, "Q-ESATTA", { quando: new Date(adesso).toISOString() });
    await seminaScheda(base, "Q-DOPO", { quando: new Date(adesso + 1).toISOString() });
    const schermata = await new SchermataRipasso(app).monta();
    const ids = schermata.coda.map((c) => c.id);
    ok("la carta scaduta un ms fa c'e", ids.includes("Q-PRIMA"));
    ok("quella scaduta all'istante esatto pure (confronto <=)", ids.includes("Q-ESATTA"));
    ok("quella che scade fra un ms no", !ids.includes("Q-DOPO"), JSON.stringify(ids));
    ok("due carte in coda", schermata.coda.length === 2);
  } finally { scongelaOra(); }
});

await prova("F7 ordine per scadenza crescente, e pareggio totale stabile (CON-14)", async () => {
  const { app, base } = await avvia("ripasso07");
  await seminaScheda(base, "Q-TARDI", { quando: "2024-06-01T00:00:00.000Z" });
  await seminaScheda(base, "Q-PRESTO", { quando: "2020-01-01T00:00:00.000Z" });
  await seminaScheda(base, "Q-MEZZO", { quando: "2022-01-01T00:00:00.000Z" });
  const ordinata = await new SchermataRipasso(app).monta();
  ok("la piu vecchia per prima",
    JSON.stringify(ordinata.coda.map((c) => c.id)) === JSON.stringify(["Q-PRESTO", "Q-MEZZO", "Q-TARDI"]),
    JSON.stringify(ordinata.coda.map((c) => c.id)));

  // Pareggio totale: e la situazione del primo avvio, 199 carte con la stessa data.
  const { app: app2, base: base2 } = await avvia("ripasso07b");
  for (const id of ["Q-C", "Q-A", "Q-B"]) await seminaScheda(base2, id, { quando: PASSATO });
  const uno = await new SchermataRipasso(app2).monta();
  const due = await new SchermataRipasso(app2).monta();
  ok("a parita di scadenza l'ordine e quello di inserimento",
    JSON.stringify(uno.coda.map((c) => c.id)) === JSON.stringify(["Q-C", "Q-A", "Q-B"]),
    JSON.stringify(uno.coda.map((c) => c.id)));
  ok("ed e stabile fra due aperture: si rivede la stessa prima carta",
    JSON.stringify(uno.coda.map((c) => c.id)) === JSON.stringify(due.coda.map((c) => c.id)));
});

await prova("F8 una riga di ripasso senza esercizio corrispondente sparisce dalla coda (CON-08)", async () => {
  const { app, base } = await avvia("ripasso08");
  await seminaScheda(base, "Q-VERA");
  await base.runAsync(
    "INSERT INTO ripasso (esercizio_id, prossima_revisione) VALUES ('Q-ORFANA', ?)", [PASSATO]);
  const schermata = await new SchermataRipasso(app).monta();
  ok("il JOIN la esclude", schermata.coda.length === 1 && schermata.coda[0].id === "Q-VERA",
    JSON.stringify(schermata.coda.map((c) => c.id)));
  ok("ma il contatore di Studio la conta lo stesso",
    (await base.getFirstAsync("SELECT count(*) AS n FROM ripasso WHERE prossima_revisione <= ?",
      [new Date().toISOString()])).n === 2);
  // Stesso effetto con esercizio_id NULL: NULL = NULL non e mai vero.
  await base.runAsync("INSERT INTO ripasso (esercizio_id, prossima_revisione) VALUES (NULL, ?)", [PASSATO]);
  const seconda = await new SchermataRipasso(app).monta();
  ok("una riga con esercizio_id NULL resta comunque fuori", seconda.coda.length === 1);
});

await prova("F9 fonte_citazione: NULL e stringa vuota non mostrano nulla (RIP-06)", async () => {
  const { app, base } = await avvia("ripasso09");
  await seminaScheda(base, "Q-N", { fonte: null, quando: "2020-01-01T00:00:01.000Z" });
  await seminaScheda(base, "Q-V", { fonte: "", quando: "2020-01-01T00:00:02.000Z" });
  await seminaScheda(base, "Q-C", { fonte: "Kleppmann — cap. 5", quando: "2020-01-01T00:00:03.000Z" });
  const schermata = await new SchermataRipasso(app).monta();
  schermata.mostraRisposta();
  ok("con NULL nessun blocco citazione", schermata.render().citazione === null);
  ok("e nessuna stringa 'null' a schermo", String(schermata.render().citazione) !== "null" ||
    schermata.render().citazione === null);
  schermata.i = 1; schermata.scoperta = true;
  ok("con stringa vuota il ternario la tratta come assente", schermata.render().citazione === null);
  schermata.i = 2;
  ok("con una fonte vera la citazione compare", schermata.render().citazione === "Kleppmann — cap. 5");
});

await prova("F10 'Mostra la risposta' non scrive niente ed e idempotente (RIP-05)", async () => {
  const { app, base } = await avvia("ripasso10");
  await seminaScheda(base, "Q-020");
  const schermata = await new SchermataRipasso(app).monta();
  const primaEventi = (await base.getFirstAsync("SELECT count(*) AS n FROM eventi")).n;
  const primaRipasso = await base.getFirstAsync("SELECT * FROM ripasso WHERE esercizio_id='Q-020'");
  schermata.mostraRisposta();
  schermata.mostraRisposta();
  schermata.mostraRisposta();
  ok("la risposta resta scoperta", schermata.render().rispostaVisibile === true);
  ok("l'indice non e avanzato", schermata.i === 0);
  ok("nessun evento scritto", (await base.getFirstAsync("SELECT count(*) AS n FROM eventi")).n === primaEventi);
  const dopo = await base.getFirstAsync("SELECT * FROM ripasso WHERE esercizio_id='Q-020'");
  ok("la riga di ripasso e identica", JSON.stringify(dopo) === JSON.stringify(primaRipasso));
});

await prova("F11 avanzamento fino in fondo a una coda di cinque carte", async () => {
  const { app, base } = await avvia("ripasso11");
  for (let n = 0; n < 5; n++) {
    await seminaScheda(base, `Q-${n}`, { quando: new Date(Date.UTC(2020, 0, 1, 0, 0, n)).toISOString() });
  }
  const schermata = await new SchermataRipasso(app).monta();
  const visti = [];
  for (let n = 0; n < 5; n++) {
    const vista = schermata.render();
    ok(`passo ${n}: contatore corretto`, vista.contatore === `${n + 1} di 5`, vista.contatore);
    ok(`passo ${n}: la risposta riparte nascosta`, vista.rispostaVisibile === false);
    visti.push(vista.consegna);
    await schermata.carta(2);
  }
  ok("tutte e cinque le carte sono state mostrate, una sola volta ciascuna",
    new Set(visti).size === 5, JSON.stringify(visti));
  ok("esaurita la coda compare lo stato vuoto", schermata.render().vuota === true);
  ok("cinque eventi nel registro", (await base.getFirstAsync("SELECT count(*) AS n FROM eventi")).n === 5);
  ok("cinque carte passate allo stato 'ripasso'",
    (await base.getFirstAsync("SELECT count(*) AS n FROM ripasso WHERE stato='ripasso'")).n === 5);
});

await prova("F12 interruzione a meta sessione: le valutate restano, la coda si ricostruisce", async () => {
  const { app, base, cartella } = await avvia("ripasso12");
  for (let n = 0; n < 10; n++) {
    await seminaScheda(base, `Q-${n}`, { quando: new Date(Date.UTC(2020, 0, 1, 0, 0, n)).toISOString() });
  }
  const prima = await new SchermataRipasso(app).monta();
  for (let n = 0; n < 4; n++) await prima.carta(2); // quattro carte, poi l'utente esce
  ok("quattro valutate", prima.i === 4);
  ok("quattro eventi scritti", (await base.getFirstAsync("SELECT count(*) AS n FROM eventi")).n === 4);

  // Uscita dalla schermata e rientro: il componente si rimonta da zero.
  const seconda = await new SchermataRipasso(app).monta();
  ok("la coda nuova ha sei carte", seconda.coda.length === 6, String(seconda.coda.length));
  ok("riparte da Q-4", seconda.coda[0].id === "Q-4", seconda.coda[0].id);
  ok("nessuna delle quattro valutate e tornata",
    seconda.coda.every((c) => !["Q-0", "Q-1", "Q-2", "Q-3"].includes(c.id)),
    JSON.stringify(seconda.coda.map((c) => c.id)));
  ok("il contatore riparte da '1 di 6'", seconda.render().contatore === "1 di 6");

  // E ora il riavvio vero dell'app: connessione chiusa, modulo rivalutato.
  app.database().closeSync();
  const riaperta = await avvia("ripasso12", cartella);
  const terza = await new SchermataRipasso(riaperta.app).monta();
  ok("dopo il riavvio la coda e ancora di sei carte", terza.coda.length === 6, String(terza.coda.length));
  ok("e i quattro eventi sono sopravvissuti",
    (await riaperta.base.getFirstAsync("SELECT count(*) AS n FROM eventi")).n === 4);
  ok("le quattro carte hanno la nuova scadenza fra due giorni",
    (await riaperta.base.getFirstAsync(
      "SELECT count(*) AS n FROM ripasso WHERE stato='ripasso' AND stabilita = 2.2")).n === 4);
});

await prova("DIFETTO RIPRODOTTO: F13 esaurite le 30, la schermata dice che non c'e nulla (RIP-04)", async () => {
  const { app, base } = await avvia("ripasso13");
  for (let n = 0; n < 45; n++) {
    await seminaScheda(base, `Q-${String(n).padStart(3, "0")}`,
      { quando: new Date(Date.UTC(2020, 0, 1, 0, 0, n)).toISOString() });
  }
  const schermata = await new SchermataRipasso(app).monta();
  ok("la sessione parte con 30 carte", schermata.coda.length === 30);
  for (let n = 0; n < 30; n++) await schermata.carta(2);
  ok("l'utente vede 'Nessuna scheda da ripassare.'",
    schermata.render().testo === "Nessuna scheda da ripassare.");
  const ancoraScadute = (await base.getFirstAsync(
    "SELECT count(*) AS n FROM ripasso WHERE prossima_revisione <= ?", [new Date().toISOString()])).n;
  ok("mentre 15 carte sono ancora scadute", ancoraScadute === 15, String(ancoraScadute));
  ok("e il contatore della schermata Studio continua a mostrarle", ancoraScadute > 0);
  // Per continuare bisogna uscire e rientrare: la coda e un'istantanea del montaggio.
  const rientro = await new SchermataRipasso(app).monta();
  ok("uscendo e rientrando ricompaiono", rientro.coda.length === 15, String(rientro.coda.length));
});

await prova("DIFETTO RIPRODOTTO: F14 database non aperto: schermo indistinguibile da 'hai finito' (RIP-12)", async () => {
  const app = await moduloVergine(); // apri() non e mai stata chiamata
  const schermata = await new SchermataRipasso(app).monta();
  ok("l'effetto e fallito", schermata.erroreEffetto !== null);
  ok("con il messaggio italiano di db.ts",
    String(schermata.erroreEffetto?.message).includes("Database non aperto"),
    String(schermata.erroreEffetto?.message));
  ok("ma a schermo compare 'Nessuna scheda da ripassare.'",
    schermata.render().testo === "Nessuna scheda da ripassare.");
  ok("identico allo schermo di chi ha davvero finito", schermata.render().vuota === true);
  // Nel .tsx quella promessa non e gestita: l'utente non vede alcun errore.
});

await prova("DIFETTO RIPRODOTTO: F15 una scadenza in formato locale rompe filtro e ordine (RIP-13)", async () => {
  const { app, base } = await avvia("ripasso15");
  await seminaScheda(base, "Q-ISO", { quando: "2020-01-01T00:00:00.000Z" });
  // Una riga arrivata da un dispositivo che scrivesse la data locale, senza Z.
  await seminaScheda(base, "Q-LOCALE", { quando: "01/06/2020 10:00" });
  await seminaScheda(base, "Q-VUOTA", { quando: "" });
  const schermata = await new SchermataRipasso(app).monta();
  const ids = schermata.coda.map((c) => c.id);
  ok("la stringa vuota ordina prima di tutto e passa il filtro", ids[0] === "Q-VUOTA", JSON.stringify(ids));
  ok("la data in formato locale passa il confronto testuale", ids.includes("Q-LOCALE"));
  ok("la riga ISO resta al suo posto", ids.includes("Q-ISO"));
  ok("il confronto e lessicografico, non cronologico: '0' viene prima di '2'",
    ids.indexOf("Q-LOCALE") < ids.indexOf("Q-ISO"), JSON.stringify(ids));
  // Una data locale del 2099 passerebbe comunque il filtro <= adesso.
  await seminaScheda(base, "Q-FUTURA-LOCALE", { quando: "01/06/2099 10:00" });
  const seconda = await new SchermataRipasso(app).monta();
  ok("una scadenza del 2099 scritta cosi risulta gia scaduta",
    seconda.coda.some((c) => c.id === "Q-FUTURA-LOCALE"),
    JSON.stringify(seconda.coda.map((c) => c.id)));
});

// ============================================================================
// G. VALUTAZIONE DI UNA CARTA — app/ripasso.tsx, valuta()
// ============================================================================

await prova("G1 grado 0 'Di nuovo': ricaduta, scadenza immediata, evento nel registro (RIP-07)", async () => {
  const { app, base } = await avvia("valuta01");
  await seminaScheda(base, "Q-030", { stabilita: 8, ripetizioni: 3 });
  const adesso = Date.UTC(2026, 9, 8, 9, 0, 0);
  congelaOra(adesso);
  try {
    const schermata = await new SchermataRipasso(app).monta();
    await schermata.carta(0);
    const riga = await base.getFirstAsync("SELECT * FROM ripasso WHERE esercizio_id='Q-030'");
    ok("stabilita azzerata", riga.stabilita === 0, String(riga.stabilita));
    ok("prossima revisione = adesso, quindi di nuovo scaduta",
      riga.prossima_revisione === new Date(adesso).toISOString(), riga.prossima_revisione);
    ok("stato 'ricaduta'", riga.stato === "ricaduta", riga.stato);
    ok("ripetizioni incrementata", riga.ripetizioni === 4, String(riga.ripetizioni));
    ok("ultima_revisione aggiornata", riga.ultima_revisione === new Date(adesso).toISOString());
    const evento = await base.getFirstAsync("SELECT * FROM eventi");
    ok("un evento 'aggiorna' su entita 'ripasso'", evento.tipo === "aggiorna" && evento.entita === "ripasso");
    ok("con entita_id uguale all'esercizio", evento.entita_id === "Q-030");
    ok("payload {grado:0, stabilita:0}", evento.payload === JSON.stringify({ grado: 0, stabilita: 0 }),
      evento.payload);
  } finally { scongelaOra(); }
});

await prova("G2 gradi 1, 2 e 3: scadenza a uno, due e tre giorni, stato 'ripasso'", async () => {
  const adesso = Date.UTC(2026, 9, 8, 9, 0, 0);
  for (const [grado, giorni, stabilita] of [[1, 1, 1.2], [2, 2, 2.2], [3, 3, 3.4]]) {
    const { app, base } = await avvia("valuta02-" + grado);
    await seminaScheda(base, "Q-040");
    congelaOra(adesso);
    try {
      const schermata = await new SchermataRipasso(app).monta();
      await schermata.carta(grado);
      const riga = await base.getFirstAsync("SELECT * FROM ripasso WHERE esercizio_id='Q-040'");
      ok(`grado ${grado}: stabilita ${stabilita}`, Math.abs(riga.stabilita - stabilita) < 1e-9,
        String(riga.stabilita));
      ok(`grado ${grado}: scade fra ${giorni} giorni`,
        riga.prossima_revisione === new Date(adesso + giorni * 864e5).toISOString(),
        riga.prossima_revisione);
      ok(`grado ${grado}: stato 'ripasso'`, riga.stato === "ripasso");
    } finally { scongelaOra(); }
  }
});

await prova("G3 evento e proiezione nella stessa transazione, con l'id previsto (invariante 1)", async () => {
  const { app, base } = await avvia("valuta03");
  await seminaScheda(base, "Q-050");
  const schermata = await new SchermataRipasso(app).monta();
  await schermata.carta(3);
  const evento = await base.getFirstAsync("SELECT * FROM eventi");
  ok("id evento = hlc + ':' + esercizio_id", evento.id === evento.hlc + ":Q-050", evento.id);
  ok("il dispositivo e quello dell'avvio", evento.dispositivo === "valuta03", evento.dispositivo);
  ok("l'evento nasce non sincronizzato", evento.sincronizzato === 0);
  const meta = await base.getFirstAsync("SELECT valore FROM meta WHERE chiave='hlc'");
  ok("meta.hlc e stata avanzata nella stessa transazione", typeof meta?.valore === "string" &&
    meta.valore.includes("-"), JSON.stringify(meta));
  ok("una sola riga in eventi per una sola valutazione",
    (await base.getFirstAsync("SELECT count(*) AS n FROM eventi")).n === 1);
  // La riga di ripasso NON porta l'hlc: la tabella non ha quella colonna.
  const colonne = await base.getAllAsync("PRAGMA table_info(ripasso)");
  ok("la tabella ripasso non ha una colonna hlc (la proiezione infatti la ignora)",
    !colonne.some((c) => c.name === "hlc"), JSON.stringify(colonne.map((c) => c.name)));
});

await prova("DIFETTO RIPRODOTTO: G4 il payload non porta la scadenza all'altro dispositivo (RIP-14)", async () => {
  const { app, base } = await avvia("valuta04");
  await seminaScheda(base, "Q-060");
  const schermata = await new SchermataRipasso(app).monta();
  await schermata.carta(3);
  const payload = JSON.parse((await base.getFirstAsync("SELECT payload FROM eventi")).payload);
  ok("il payload ha solo due campi", Object.keys(payload).length === 2, JSON.stringify(payload));
  ok("grado e stabilita ci sono", payload.grado === 3 && Math.abs(payload.stabilita - 3.4) < 1e-9);
  ok("prossima_revisione NON viaggia", !("prossima_revisione" in payload));
  ok("ultima_revisione NON viaggia", !("ultima_revisione" in payload));
  ok("stato NON viaggia", !("stato" in payload));
  ok("ripetizioni NON viaggia (ed e un incremento relativo, non idempotente in replay)",
    !("ripetizioni" in payload));
  // Ricostruendo lo stato dal solo registro l'altro dispositivo non saprebbe quando ripassare.
});

await prova("G5 crescita su valutazioni ripetute della stessa carta (RIP-09)", async () => {
  const { app, base } = await avvia("valuta05");
  await seminaScheda(base, "Q-070");
  const stabilitaViste = [];
  for (let giro = 0; giro < 3; giro++) {
    const schermata = await new SchermataRipasso(app).monta();
    // Ogni giro e una riapertura della schermata: la carta e tornata scadibile.
    await base.runAsync("UPDATE ripasso SET prossima_revisione = ? WHERE esercizio_id='Q-070'", [PASSATO]);
    const fresca = await new SchermataRipasso(app).monta();
    ok(`giro ${giro}: la carta e in coda`, fresca.coda.length === 1);
    await fresca.carta(3);
    stabilitaViste.push((await base.getFirstAsync(
      "SELECT stabilita FROM ripasso WHERE esercizio_id='Q-070'")).stabilita);
    void schermata;
  }
  ok("3.4 -> 11.56 -> 39.3",
    stabilitaViste.map((s) => Math.round(s * 100) / 100).join(",") === "3.4,11.56,39.3",
    JSON.stringify(stabilitaViste));
  ok("ripetizioni conta tre giri",
    (await base.getFirstAsync("SELECT ripetizioni FROM ripasso WHERE esercizio_id='Q-070'")).ripetizioni === 3);
  ok("tre eventi nel registro", (await base.getFirstAsync("SELECT count(*) AS n FROM eventi")).n === 3);
  ok("la colonna difficolta non viene mai scritta: resta al default 5",
    (await base.getFirstAsync("SELECT difficolta FROM ripasso WHERE esercizio_id='Q-070'")).difficolta === 5);
});

await prova("DIFETTO RIPRODOTTO: G6 riga di ripasso assente: evento scritto, nulla cambia (REG-08)", async () => {
  const { app, base } = await avvia("valuta06");
  // Una flashcard arrivata per sincronizzazione senza la sua riga di ripasso:
  // la schermata non la mostrerebbe, ma valuta() puo essere raggiunta con una
  // coda gia caricata e la riga cancellata nel frattempo (fusione, o seed parziale).
  await seminaScheda(base, "Q-080");
  const schermata = await new SchermataRipasso(app).monta();
  ok("la carta e in coda", schermata.coda.length === 1);
  await base.runAsync("DELETE FROM ripasso WHERE esercizio_id='Q-080'");
  await schermata.carta(2);
  ok("l'evento e stato scritto lo stesso",
    (await base.getFirstAsync("SELECT count(*) AS n FROM eventi")).n === 1);
  ok("ma nessuna riga di ripasso esiste",
    (await base.getFirstAsync("SELECT count(*) AS n FROM ripasso")).n === 0);
  ok("registro e stato operativo sono divergenti, senza alcun errore",
    (await base.getFirstAsync("SELECT entita_id FROM eventi")).entita_id === "Q-080");
  ok("e l'indice e avanzato come se tutto fosse andato bene", schermata.i === 1);
});

await prova("G7 una carta ricaduta torna in coda solo alla riapertura, non subito (RIP-07)", async () => {
  const { app, base } = await avvia("valuta07");
  await seminaScheda(base, "Q-090", { quando: "2020-01-01T00:00:01.000Z" });
  await seminaScheda(base, "Q-091", { quando: "2020-01-01T00:00:02.000Z" });
  const schermata = await new SchermataRipasso(app).monta();
  ok("due carte in coda", schermata.coda.length === 2);
  await schermata.carta(0); // Di nuovo su Q-090
  ok("si passa alla seconda, non si ritorna sulla prima",
    schermata.render().consegna === "Domanda Q-091", schermata.render().consegna);
  ok("la coda resta di due: e un'istantanea", schermata.coda.length === 2);
  await schermata.carta(2);
  ok("finita la sessione lo schermo e vuoto", schermata.render().vuota === true);
  const rientro = await new SchermataRipasso(app).monta();
  ok("rientrando la ricaduta e tornata", rientro.coda.length === 1 && rientro.coda[0].id === "Q-090",
    JSON.stringify(rientro.coda.map((c) => c.id)));
});

await prova("CORREZIONE SORVEGLIATA: G8 doppio tocco su due gradi: due scritture accavallate, entrambe intere (RIP-10)", async () => {
  const { app, base } = await avvia("valuta08");
  await seminaScheda(base, "Q-100");
  const schermata = await new SchermataRipasso(app).monta();
  schermata.mostraRisposta();
  // Due tocchi rapidi prima che il primo await sia risolto: i Pressable non si
  // disabilitano, quindi sul telefono e esattamente questo che parte.
  //
  // Prima della coda di lib/db.ts qui si rompeva l'invariante 1: il BEGIN della
  // seconda transazione falliva, il suo ROLLBACK annullava l'INSERT dell'evento
  // della prima, che intanto proseguiva in autocommit e lasciava la riga di
  // ripasso SENZA il suo evento. Questo scenario sapeva riprodurre il difetto:
  // per questo e il posto giusto dove sorvegliare che non torni.
  const esiti = await Promise.allSettled([schermata.valuta(2), schermata.valuta(3)]);
  ok("entrambe le valutazioni riescono", esiti.every((e) => e.status === "fulfilled"),
    JSON.stringify(esiti.map((e) => (e.status === "rejected" ? String(e.reason?.message ?? e.reason) : "ok"))));
  const eventi = await base.getAllAsync(
    "SELECT id, entita, entita_id, tipo, payload, hlc FROM eventi ORDER BY hlc");
  const riga = await base.getFirstAsync("SELECT * FROM ripasso WHERE esercizio_id='Q-100'");
  // Senza la coda il registro resta VUOTO: si legge quel che c'e senza dare per
  // scontato che ci sia, cosi ogni guardia diventa rossa in modo leggibile
  // invece di far cadere lo scenario con un TypeError.
  const [primo = null, secondo = null] = eventi;
  const caricoPrimo = primo ? JSON.parse(primo.payload) : null;
  const caricoSecondo = secondo ? JSON.parse(secondo.payload) : null;
  ok("due tocchi, due eventi nel registro", eventi.length === 2, JSON.stringify(eventi));
  ok("due tocchi, due ripetizioni sulla carta", riga.ripetizioni === 2, String(riga.ripetizioni));
  ok("invariante 1: tante proiezioni quanti eventi, tutti di questa carta",
    riga.ripetizioni === eventi.length &&
      eventi.every((e) => e.entita === "ripasso" && e.entita_id === "Q-100" && e.tipo === "aggiorna"),
    JSON.stringify(eventi));
  ok("i due tocchi restano due eventi distinti e ordinati, non uno solo",
    primo !== null && secondo !== null && primo.id !== secondo.id && primo.hlc < secondo.hlc,
    JSON.stringify(eventi.map((e) => e.hlc)));
  ok("una transazione per volta, in ordine di ARRIVO: prima il grado 2, poi il grado 3",
    caricoPrimo?.grado === 2 && caricoSecondo?.grado === 3,
    JSON.stringify(eventi.map((e) => e.payload)));
  // Tutto-o-niente per davvero: lo stato finale della riga e quello scritto
  // dall'ULTIMA transazione della coda, non un miscuglio delle due.
  ok("la riga porta la stabilita dell'ultimo evento, non un miscuglio delle due scritture",
    caricoSecondo !== null && riga.stabilita === caricoSecondo.stabilita,
    `${riga.stabilita} contro ${secondo?.payload}`);
  // Tre giorni e la scadenza del grado 3, cioe del SECONDO tocco: se la seconda
  // scrittura si fosse persa la carta tornerebbe a due giorni, quelli del grado 2.
  const giorniDiScadenza = Math.round(
    (new Date(riga.prossima_revisione).getTime() - Date.now()) / 864e5);
  ok("la scadenza e quella del secondo grado (tre giorni) e la carta esce dalla coda",
    giorniDiScadenza === 3 && riga.prossima_revisione > new Date().toISOString() &&
      riga.stato === "ripasso",
    `${riga.prossima_revisione} (${giorniDiScadenza} giorni) / ${riga.stato}`);
  ok("nessuno dei due eventi si e perso per strada: la sincronizzazione ne vede due",
    (await app.daSincronizzare()).length === 2,
    String((await app.daSincronizzare()).length));
  // La coda protegge il REGISTRO, non il Pressable: il doppio tocco fa comunque
  // avanzare l'indice di due e saltare una carta. Quello e un difetto della
  // schermata, non dell'invariante 1, e non si sorveglia da qui.
});

await prova("G9 valutazioni sequenziali rapide (senza sovrapposizione) restano integre", async () => {
  const { app, base } = await avvia("valuta09");
  for (let n = 0; n < 6; n++) {
    await seminaScheda(base, `Q-${n}`, { quando: new Date(Date.UTC(2020, 0, 1, 0, 0, n)).toISOString() });
  }
  const schermata = await new SchermataRipasso(app).monta();
  for (let n = 0; n < 6; n++) await schermata.carta(n % 4); // tutti e quattro i gradi
  ok("sei eventi", (await base.getFirstAsync("SELECT count(*) AS n FROM eventi")).n === 6);
  ok("sei id evento distinti",
    (await base.getFirstAsync("SELECT count(DISTINCT id) AS n FROM eventi")).n === 6);
  ok("ogni carta ha esattamente una ripetizione",
    (await base.getFirstAsync("SELECT count(*) AS n FROM ripasso WHERE ripetizioni = 1")).n === 6);
  const ricadute = (await base.getFirstAsync("SELECT count(*) AS n FROM ripasso WHERE stato='ricaduta'")).n;
  ok("le due valutate con 'Di nuovo' sono in ricaduta", ricadute === 2, String(ricadute));
  const hlcOrdinati = (await base.getAllAsync("SELECT hlc FROM eventi ORDER BY hlc")).map((r) => r.hlc);
  ok("gli hlc sono strettamente crescenti",
    hlcOrdinati.every((h, n) => n === 0 || h > hlcOrdinati[n - 1]), JSON.stringify(hlcOrdinati));
});

await prova("G10 la sessione di ripasso non tocca nessun'altra tabella", async () => {
  const { app, base } = await avvia("valuta10");
  await seminaScheda(base, "Q-110");
  await base.runAsync(
    `INSERT INTO sessioni (id,tipo,inizio,minuti,hlc) VALUES ('s1','mattina','2026-10-05T07:00:00Z',30,'h')`);
  const schermata = await new SchermataRipasso(app).monta();
  await schermata.carta(2);
  ok("la tabella sessioni e intatta",
    (await base.getFirstAsync("SELECT count(*) AS n FROM sessioni")).n === 1);
  ok("nessun tentativo registrato",
    (await base.getFirstAsync("SELECT count(*) AS n FROM tentativi")).n === 0);
  ok("nessuna nota", (await base.getFirstAsync("SELECT count(*) AS n FROM note")).n === 0);
  ok("l'esercizio non e stato modificato",
    (await base.getFirstAsync("SELECT consegna FROM esercizi WHERE id='Q-110'")).consegna === "Domanda Q-110");
  ok("un solo evento, di entita 'ripasso'",
    (await base.getFirstAsync("SELECT count(*) AS n FROM eventi WHERE entita='ripasso'")).n === 1);
});

// ============================================================================
// H. INTEGRAZIONE: CRONOMETRO -> SESSIONI -> RIQUADRO DELLA SETTIMANA
// ============================================================================

/** La query di app/(tabs)/oggi.tsx:20 — ultimi otto giorni. */
async function sessioniDiOggi(base, adesso = Date.now()) {
  return base.getAllAsync(
    "SELECT inizio, minuti, tipo FROM sessioni WHERE inizio >= ?",
    [new Date(adesso - 8 * 864e5).toISOString()]);
}

/** components/Cronometro.tsx:43 — la chiusura completa, registro compreso. */
async function chiudiBlocco(app, id, inizio, fine, tipo) {
  const esito = chiudiSessione(inizio, fine, tipo);
  if (!esito.valida) return { esito, registrata: false };
  await app.registra("sessioni", id, "crea", { tipo, minuti: esito.minuti },
    proiettaSessione(id, tipo, inizio, esito.minuti));
  return { esito, registrata: true };
}

await prova("H1 un blocco chiuso arriva fino al riquadro 'Settimana' di Oggi", async () => {
  const { app, base } = await avvia("sessione01");
  const lunedi = new Date("2026-10-05T07:00:00").getTime();
  congelaOra(new Date("2026-10-08T12:00:00").getTime());
  try {
    const { esito, registrata } = await chiudiBlocco(app, "s-1", lunedi, lunedi + 30 * MIN, "mattina");
    ok("la chiusura e valida", esito.valida === true && esito.minuti === 30);
    ok("la riga e stata scritta", registrata === true);
    const riga = await base.getFirstAsync("SELECT * FROM sessioni WHERE id='s-1'");
    ok("minuti sulla riga", riga.minuti === 30);
    ok("inizio in ISO", riga.inizio === new Date(lunedi).toISOString(), riga.inizio);
    ok("la riga porta l'hlc dell'evento",
      riga.hlc === (await base.getFirstAsync("SELECT hlc FROM eventi")).hlc);
    const lette = await sessioniDiOggi(base);
    ok("la query di Oggi la trova", lette.length === 1);
    const settimana = riepilogoSettimana(lette, new Date());
    ok("il riquadro mostra 30 minuti", settimana.minuti === 30);
    ok("cioe 0.5 h", (settimana.minuti / 60).toFixed(1) === "0.5");
    ok("livello sopravvivenza e sotto il minimo", settimana.livello === "sopravvivenza" &&
      settimana.sottoMinimo === true);
  } finally { scongelaOra(); }
});

await prova("H2 una settimana intera di blocchi porta al livello base", async () => {
  const { app, base } = await avvia("sessione02");
  congelaOra(new Date("2026-10-09T18:00:00").getTime()); // venerdi
  try {
    const blocchi = [
      ["2026-10-05T07:00:00", "mattina", 30], ["2026-10-05T18:00:00", "artefatto", 45],
      ["2026-10-06T07:00:00", "mattina", 30], ["2026-10-06T22:00:00", "lettura", 25],
      ["2026-10-07T07:00:00", "mattina", 30], ["2026-10-07T18:00:00", "artefatto", 45],
      ["2026-10-08T07:00:00", "mattina", 30], ["2026-10-08T21:00:00", "paper", 25],
      ["2026-10-09T07:00:00", "mattina", 30], ["2026-10-09T13:00:00", "ripasso", 15],
      ["2026-10-09T17:00:00", "artefatto", 45],
    ];
    let n = 0;
    for (const [quando, tipo, minuti] of blocchi) {
      const inizio = new Date(quando).getTime();
      const r = await chiudiBlocco(app, "s-" + (++n), inizio, inizio + minuti * MIN, tipo);
      ok(`blocco ${n} registrato`, r.registrata === true);
    }
    const settimana = riepilogoSettimana(await sessioniDiOggi(base), new Date());
    ok("totale 350 minuti", settimana.minuti === 350, String(settimana.minuti));
    ok("livello base", settimana.livello === "base");
    ok("non manca piu niente al base", settimana.mancanoAlBase === 0);
    ok("ripartito coerente", settimana.perTipo.mattina === 150 && settimana.perTipo.artefatto === 135 &&
      settimana.perTipo.lettura === 25 && settimana.perTipo.paper === 25 && settimana.perTipo.ripasso === 15,
      JSON.stringify(settimana.perTipo));
    ok("undici eventi nel registro", (await base.getFirstAsync("SELECT count(*) AS n FROM eventi")).n === 11);
  } finally { scongelaOra(); }
});

await prova("DIFETTO RIPRODOTTO: H3 tipo fuori catalogo + cronometro dimenticato = blocco perso (SES-03)", async () => {
  const { app, base } = await avvia("sessione03");
  const inizio = new Date("2026-10-05T07:00:00").getTime();
  const esito = chiudiSessione(inizio, inizio + 200 * MIN, "sconosciuto");
  ok("chiudiSessione dice che e valida", esito.valida === true);
  ok("con minuti indefiniti", esito.minuti === undefined);
  // Cronometro.tsx ha GIA rimosso la chiave dal kv-store a questo punto: il
  // blocco non e piu recuperabile in nessun modo.
  await lancia("l'INSERT viola il NOT NULL della colonna minuti",
    () => app.registra("sessioni", "s-perso", "crea", { tipo: "sconosciuto", minuti: esito.minuti },
      proiettaSessione("s-perso", "sconosciuto", inizio, esito.minuti)),
    "NOT NULL constraint failed: sessioni.minuti");
  ok("nessuna riga in sessioni", (await base.getFirstAsync("SELECT count(*) AS n FROM sessioni")).n === 0);
  ok("nessun evento nel registro (il rollback ha fatto il suo lavoro)",
    (await base.getFirstAsync("SELECT count(*) AS n FROM eventi")).n === 0);
  ok("meta.hlc non e avanzata",
    (await base.getFirstAsync("SELECT valore FROM meta WHERE chiave='hlc'")) === null);
  ok("il riquadro della settimana resta a zero",
    riepilogoSettimana(await sessioniDiOggi(base), new Date()).minuti === 0);
  // L'integrita del database regge; a essere perso e il lavoro dell'utente.
});

await prova("DIFETTO RIPRODOTTO: H4 una sessione con tipo ignoto arrivata per fusione (SES-05)", async () => {
  const { app, base } = await avvia("sessione04");
  congelaOra(new Date("2026-10-08T12:00:00").getTime());
  try {
    const inizio = new Date("2026-10-05T07:00:00").getTime();
    await chiudiBlocco(app, "s-1", inizio, inizio + 30 * MIN, "mattina");
    // Una riga scritta da un dispositivo con una versione piu nuova dell'app.
    await base.runAsync(
      `INSERT INTO sessioni (id,tipo,inizio,minuti,hlc) VALUES (?,?,?,?,?)`,
      ["s-remota", "meditazione", "2026-10-06T07:00:00.000Z", 50, "hlc-remoto"]);
    const settimana = riepilogoSettimana(await sessioniDiOggi(base), new Date());
    ok("il totale include comunque i 50 minuti", settimana.minuti === 80, String(settimana.minuti));
    ok("ma il ripartito acquisisce una chiave NaN", Number.isNaN(settimana.perTipo.meditazione),
      JSON.stringify(settimana.perTipo));
    ok("le ore mostrate a schermo restano leggibili", (settimana.minuti / 60).toFixed(1) === "1.3");
    ok("mentre il ripartito per tipo non lo e",
      String(settimana.perTipo.meditazione) === "NaN");
  } finally { scongelaOra(); }
});

await prova("H5 la finestra di otto giorni di Oggi copre sempre l'intera settimana corrente", async () => {
  const { app, base } = await avvia("sessione05");
  // Il caso peggiore: domenica sera, la settimana e iniziata 6 giorni e 23 ore fa.
  congelaOra(new Date("2026-10-11T23:00:00").getTime());
  try {
    const lunedi = new Date("2026-10-05T00:30:00").getTime();
    await chiudiBlocco(app, "s-1", lunedi, lunedi + 30 * MIN, "mattina");
    // Domenica della settimana precedente: dentro gli otto giorni, fuori dalla settimana.
    const vecchia = new Date("2026-10-04T09:00:00").getTime();
    await chiudiBlocco(app, "s-2", vecchia, vecchia + 45 * MIN, "artefatto");
    const lette = await sessioniDiOggi(base);
    ok("la query di Oggi riporta entrambe (otto giorni indietro)", lette.length === 2,
      String(lette.length));
    const settimana = riepilogoSettimana(lette, new Date());
    ok("ma il riepilogo tiene solo quella della settimana", settimana.minuti === 30,
      String(settimana.minuti));
    ok("il blocco della domenica precedente resta fuori", settimana.perTipo.artefatto === 0);
  } finally { scongelaOra(); }
});

await prova("H6 blocchi non validi non scrivono nulla e non muovono il riquadro", async () => {
  const { app, base } = await avvia("sessione06");
  congelaOra(new Date("2026-10-08T12:00:00").getTime());
  try {
    const inizio = new Date("2026-10-08T09:00:00").getTime();
    const breve = await chiudiBlocco(app, "s-breve", inizio, inizio + 3 * MIN, "mattina");
    ok("un blocco di tre minuti non viene registrato", breve.registrata === false);
    ok("con il motivo giusto", breve.esito.motivo === "meno di 5 minuti: non registrata");
    const indietro = await chiudiBlocco(app, "s-indietro", inizio, inizio - MIN, "lettura");
    ok("e nemmeno uno con fine precedente all'inizio", indietro.registrata === false);
    ok("nessuna riga in sessioni", (await base.getFirstAsync("SELECT count(*) AS n FROM sessioni")).n === 0);
    ok("nessun evento", (await base.getFirstAsync("SELECT count(*) AS n FROM eventi")).n === 0);
    ok("il riquadro resta a zero", riepilogoSettimana(await sessioniDiOggi(base), new Date()).minuti === 0);
    // E un blocco dimenticato tutta la notte registra solo la durata prevista.
    const notte = new Date("2026-10-08T22:00:00").getTime();
    const r = await chiudiBlocco(app, "s-notte", notte, notte + 10 * 60 * MIN, "lettura");
    ok("dieci ore diventano 25 minuti", r.registrata === true && r.esito.minuti === 25);
    ok("la settimana non si gonfia",
      riepilogoSettimana(await sessioniDiOggi(base), new Date()).minuti === 25);
  } finally { scongelaOra(); }
});

await prova("H7 ripasso e sessioni convivono nello stesso registro senza interferire", async () => {
  const { app, base } = await avvia("sessione07");
  congelaOra(new Date("2026-10-08T12:00:00").getTime());
  try {
    await seminaScheda(base, "Q-200");
    await seminaScheda(base, "Q-201", { quando: "2020-01-01T00:00:05.000Z" });
    const inizio = new Date("2026-10-08T08:00:00").getTime();
    await chiudiBlocco(app, "s-1", inizio, inizio + 15 * MIN, "ripasso");
    const schermata = await new SchermataRipasso(app).monta();
    await schermata.carta(2);
    await schermata.carta(1);
    const eventi = await base.getAllAsync("SELECT entita, entita_id, tipo FROM eventi ORDER BY hlc");
    ok("tre eventi in tutto", eventi.length === 3, JSON.stringify(eventi));
    ok("il primo e la sessione", eventi[0].entita === "sessioni" && eventi[0].tipo === "crea");
    ok("gli altri due sono ripassi", eventi[1].entita === "ripasso" && eventi[2].entita === "ripasso");
    ok("il riquadro della settimana vede 15 minuti",
      riepilogoSettimana(await sessioniDiOggi(base), new Date()).minuti === 15);
    ok("il contatore 'Da ripassare' di Oggi e sceso a zero",
      (await base.getFirstAsync("SELECT count(*) AS n FROM ripasso WHERE prossima_revisione <= ?",
        [new Date().toISOString()])).n === 0);
    ok("tutti gli eventi sono ancora da sincronizzare",
      (await app.daSincronizzare()).length === 3);
  } finally { scongelaOra(); }
});

// ============================================================================
// RIEPILOGO
// ============================================================================
const verificheTotali = scenari.reduce((n, s) => n + s.verifiche, 0);
const verificheFallite = scenari.reduce((n, s) => n + s.errori.length, 0);
const scenariPassati = scenari.filter((s) => s.errori.length === 0).length;
const difetti = scenari.filter((s) => s.difetto);
const correzioni = scenari.filter((s) => s.correzione);

if (correzioni.length) {
  console.log("");
  console.log("CORREZIONI SORVEGLIATE (erano difetti riprodotti, ora sono guardie)");
  for (const c of correzioni) console.log("  - " + c.nome.replace("CORREZIONE SORVEGLIATA: ", ""));
}
console.log("");
console.log("DIFETTI DELL'APP RIPRODOTTI (non corretti: decide il coordinatore)");
for (const d of difetti) console.log("  - " + d.nome.replace("DIFETTO RIPRODOTTO: ", ""));
console.log("");
console.log(`Verifiche: passati ${verificheTotali - verificheFallite} su ${verificheTotali}`);
console.log(`passati ${scenariPassati} su ${scenari.length} scenari`);

if (scenariPassati === scenari.length) {
  rmSync(RADICE, { recursive: true, force: true });
} else {
  console.log(`I file di lavoro restano qui per l'autopsia: ${RADICE}`);
  process.exit(1);
}
