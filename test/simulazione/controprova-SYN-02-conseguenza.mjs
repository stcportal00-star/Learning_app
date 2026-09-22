/**
 * CONTROPROVA AVVERSARIALE — SYN-02, lente "CONSEGUENZA".
 *
 * Accusa da confutare: "Due generazioni ravvicinate del codice: il codice
 * MOSTRATO non e' quello valido", gravita' critico, imputata a
 * lib/sync/accoppiamento.ts.
 *
 * Un'altra lente (controprova-SYN-02-correttezza.mjs) ha gia' chiesto SE il
 * difetto esiste nel file accusato. Questa chiede una cosa diversa e
 * indipendente, quella che decide se vale la pena spendere giorni prima del
 * 1 ottobre:
 *
 *   PUO' ACCADERE ALL'UTENTE, in aereo, su un telefono o un tablet, seguendo
 *   l'app COME E' FATTA? E se accadesse, cosa perde davvero?
 *
 * Un difetto irraggiungibile non e' un difetto. Un difetto raggiungibile che
 * non toglie niente non e' critico.
 *
 * Quattro domande, in quest'ordine:
 *
 *   1. Quanto e' larga la finestra in cui un secondo tocco puo' entrare?
 *      Si misura sul codice vero, non si stima.
 *   2. Un dito umano ci arriva? Il pulsante "Genera" vive solo finche'
 *      `accoppiato` e' nullo: appena il salvataggio finisce, sparisce.
 *   3. La seconda meta' dello scenario ("rigenera perche' il primo non e'
 *      stato letto in tempo") e' una strada che l'app offre?
 *   4. CONCESSO tutto: concesso il doppio tocco, concessa la finestra,
 *      concesso il disallineamento. Cosa perde l'utente in aereo? E' vero
 *      che "l'accoppiamento fallisce SENZA SPIEGAZIONE"?
 *
 * Gira sul codice VERO (lib/sync/accoppiamento.ts, lib/sync/stato.ts,
 * lib/sync/pacchetto.ts, lib/sync/trasporto.ts) con il deposito del banco su
 * node:sqlite, che e' il doppio di expo-sqlite/kv-store.
 *
 * Si esegue dalla radice del progetto, senza argomenti:
 *
 *   node test/simulazione/controprova-SYN-02-conseguenza.mjs
 */
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const QUESTA_CARTELLA = dirname(fileURLToPath(import.meta.url));
const RADICE_PROGETTO = resolve(QUESTA_CARTELLA, "..", "..");

// ------------------------------------------------------- RIAVVIO CON I GANCI
if (!process.env.CONTROPROVA_SYN02_CONSEGUENZA) {
  const { variabileBanco } = await import("../banco/doppi-altri.mjs");
  const esito = spawnSync(
    process.execPath,
    ["--import", "./test/banco/carica.mjs", "test/simulazione/controprova-SYN-02-conseguenza.mjs"],
    {
      cwd: RADICE_PROGETTO,
      stdio: "inherit",
      env: {
        ...process.env,
        CONTROPROVA_SYN02_CONSEGUENZA: "1",
        BANCO_DOPPI: variabileBanco({
          // lib/sync/stato.ts importa AppState, che il doppio minimo del banco
          // non espone. Riuso il doppio gia' scritto per questa stessa
          // superficie invece di toccare file altrui.
          "react-native": join(QUESTA_CARTELLA, "controprova-SYN-02-react-native.mjs"),
        }),
      },
    }
  );
  process.exit(esito.status ?? 1);
}

// ------------------------------------------------------------------ CONTEGGIO
let verdi = 0;
const rosse = [];

function verifica(nome, condizione, dettaglio = "") {
  if (condizione) {
    verdi++;
    console.log("  ok    " + nome);
  } else {
    rosse.push(nome + (dettaglio ? " -> " + dettaglio : ""));
    console.log("  ROSSA " + nome + (dettaglio ? " -> " + dettaglio : ""));
  }
}

function sorgente(percorsoRelativo) {
  return readFileSync(join(RADICE_PROGETTO, percorsoRelativo), "utf8");
}

const adesso = () => Number(process.hrtime.bigint() / 1000n) / 1000; // millisecondi

// ------------------------------------------------------------- PREPARAZIONE
import * as FS from "../banco/expo-file-system.mjs";
import { configuraCartella } from "../banco/expo-sqlite.mjs";

const RADICE = FS.configuraRadice(mkdtempSync(join(tmpdir(), "controprova-syn02-cons-")));
configuraCartella(join(FS.percorsoDocumenti(), "SQLite"));

const Accoppiamento = await import("../../lib/sync/accoppiamento.ts");
const Stato = await import("../../lib/sync/stato.ts");
const Pacchetto = await import("../../lib/sync/pacchetto.ts");
const Trasporto = await import("../../lib/sync/trasporto.ts");
const KV = (await import("expo-sqlite/kv-store")).default;

const testoSync = sorgente("app/sync.tsx");

// ===========================================================================
// 1. QUANTO E' LARGA LA FINESTRA
// ===========================================================================
// genera() in app/sync.tsx e' fatta cosi':
//
//     const a = generaAccoppiamento();   // sincrona
//     setCodiceMostrato(a.codice);       // sincrona
//     await salvaAccoppiamento(a);       // <-- L'UNICA finestra
//     setAccoppiato(a);                  // qui il pulsante sparisce
//
// Fra il tocco e la sparizione del pulsante c'e' esattamente UN await: una
// scrittura chiave-valore. Tutto il difetto dipende da quanto dura.
console.log("\n1. la finestra vulnerabile: quanto dura, misurata sul codice vero");

verifica(
  "1a nel corpo di genera() c'e' un solo await, quello del salvataggio",
  (testoSync.match(/async function genera\(\) \{[\s\S]*?\n  \}/)?.[0].match(/await /g) ?? []).length === 1,
  JSON.stringify(testoSync.match(/async function genera\(\) \{[\s\S]*?\n  \}/)?.[0] ?? "")
);
verifica(
  "1b generaAccoppiamento() sta PRIMA dell'await: il codice mostrato e' gia' deciso quando la finestra si apre",
  /const a = generaAccoppiamento\(\);\s*\n\s*setCodiceMostrato\(a\.codice\);\s*\n\s*await salvaAccoppiamento\(a\);/.test(
    testoSync
  )
);

// Misura vera: mille salvataggi con il codice vero di lib/sync/stato.ts sul
// deposito su SQLite. E' l'unica cosa che tiene aperta la finestra.
await KV.removeItem("accoppiamento");
const durate = [];
for (let i = 0; i < 1000; i++) {
  const a = Accoppiamento.generaAccoppiamento();
  const t0 = adesso();
  await Stato.salvaAccoppiamento(a);
  durate.push(adesso() - t0);
}
durate.sort((x, y) => x - y);
const mediana = durate[Math.floor(durate.length / 2)];
const p99 = durate[Math.floor(durate.length * 0.99)];
const massimo = durate[durate.length - 1];
console.log(
  `     salvaAccoppiamento(): mediana ${mediana.toFixed(3)} ms, p99 ${p99.toFixed(3)} ms, massimo ${massimo.toFixed(3)} ms`
);

// Soglia scelta larga di proposito: 50 ms e' gia' tre volte il fotogramma di
// un Android a 60 Hz, e un INSERT OR REPLACE su una tabella di poche righe non
// ci arriva nemmeno su un telefono lento.
verifica(
  "1c la finestra p99 resta sotto i 50 ms: e' una scrittura sola su una tabella di poche righe",
  p99 < 50,
  `p99 ${p99.toFixed(3)} ms`
);
verifica(
  "1d anche il caso peggiore su mille prove resta sotto i 50 ms",
  massimo < 50,
  `massimo ${massimo.toFixed(3)} ms`
);

// ===========================================================================
// 2. UN DITO UMANO CI ARRIVA?
// ===========================================================================
// Il pulsante "Genera" e' disegnato SOLO nel ramo !accoppiato. Appena
// setAccoppiato(a) viene applicato, React ridisegna e il pulsante non c'e'
// piu': un secondo tocco cade sul vuoto. Perche' il difetto esista, il secondo
// tocco deve arrivare DENTRO la finestra del punto 1.
console.log("\n2. il secondo tocco: arriva dentro la finestra o cade nel vuoto?");

verifica(
  "2a il pulsante Genera esiste solo mentre accoppiato e' nullo",
  /\{!accoppiato \? \(/.test(testoSync) &&
    testoSync.indexOf("onPress={genera}") > testoSync.indexOf("{!accoppiato ? (") &&
    testoSync.indexOf("onPress={genera}") < testoSync.indexOf("{codiceMostrato ? (")
);

/**
 * Modello della schermata con la regola che conta: il tocco arriva al
 * gestore solo se in quel momento il pulsante e' disegnato. Il ridisegno
 * avviene un fotogramma dopo che setAccoppiato e' stato chiamato (React non
 * ridisegna prima; 16 ms a 60 Hz e' la stima piu' GENEROSA verso l'accusa).
 */
const FOTOGRAMMA_MS = 16;

function creaSchermata() {
  const s = { codiceMostrato: null, accoppiato: null, pulsanteVisibile: true, chiamate: 0 };
  return {
    s,
    async tocca() {
      if (!s.pulsanteVisibile) return false; // il dito cade sul vuoto
      s.chiamate++;
      const a = Accoppiamento.generaAccoppiamento();
      s.codiceMostrato = a.codice;
      await Stato.salvaAccoppiamento(a);
      s.accoppiato = a;
      // Il ridisegno che toglie il pulsante: un fotogramma dopo.
      setTimeout(() => {
        s.pulsanteVisibile = false;
      }, FOTOGRAMMA_MS);
      return true;
    },
  };
}

const attendi = (ms) => new Promise((r) => setTimeout(r, ms));

// Intervalli fra i due tocchi. 100 ms e' gia' sotto il doppio tocco umano piu'
// rapido documentato dalle piattaforme (Android usa 300 ms come soglia di
// doppio tocco); 60 ms e' oltre il limite fisiologico e sta qui solo per non
// barare sull'estremo.
const INTERVALLI = [60, 100, 150, 300, 500];
const esitiTocco = [];
for (const intervallo of INTERVALLI) {
  let secondiAndatiAVuoto = 0;
  let disallineati = 0;
  const PROVE = 40;
  for (let i = 0; i < PROVE; i++) {
    await KV.removeItem("accoppiamento");
    const schermata = creaSchermata();
    const primo = schermata.tocca();
    await attendi(intervallo);
    const secondoHaColpito = await schermata.tocca();
    await primo;
    if (!secondoHaColpito) secondiAndatiAVuoto++;
    const salvato = await Stato.leggiAccoppiamentoSalvato();
    if (schermata.s.codiceMostrato !== salvato.codice) disallineati++;
  }
  esitiTocco.push({ intervallo, secondiAndatiAVuoto, disallineati, PROVE });
  console.log(
    `     tocchi a ${String(intervallo).padStart(3)} ms: secondo tocco nel vuoto ${secondiAndatiAVuoto}/${PROVE}, disallineamenti ${disallineati}/${PROVE}`
  );
}

const aCentoMs = esitiTocco.find((e) => e.intervallo === 100);
verifica(
  "2b a 100 ms fra i due tocchi (gia' piu' rapido di un doppio tocco umano) il secondo cade SEMPRE nel vuoto",
  aCentoMs.secondiAndatiAVuoto === aCentoMs.PROVE,
  `nel vuoto ${aCentoMs.secondiAndatiAVuoto}/${aCentoMs.PROVE}`
);
verifica(
  "2c a 300 ms (la soglia di doppio tocco di Android) idem: il pulsante non c'e' piu'",
  esitiTocco.find((e) => e.intervallo === 300).secondiAndatiAVuoto === 40
);
verifica(
  "2d a nessun intervallo provato, nemmeno 60 ms, si produce un disallineamento",
  esitiTocco.every((e) => e.disallineati === 0),
  JSON.stringify(esitiTocco.map((e) => `${e.intervallo}ms:${e.disallineati}`))
);

// Il caso limite estremo: due tocchi nello STESSO fotogramma, senza nemmeno un
// giro del ciclo di eventi in mezzo. Fisicamente impossibile con un dito solo,
// ma e' l'unica configurazione in cui il secondo tocco entra davvero.
await KV.removeItem("accoppiamento");
const simultanea = creaSchermata();
const a1 = simultanea.tocca();
const a2 = simultanea.tocca();
await Promise.all([a1, a2]);
const salvatoSimultaneo = await Stato.leggiAccoppiamentoSalvato();
verifica(
  "2e solo con due tocchi nello STESSO fotogramma il secondo entra: entrambi chiamano genera()",
  simultanea.s.chiamate === 2
);
verifica(
  "2f e anche allora il codice mostrato E' quello salvato: il deposito rispetta l'ordine di arrivo",
  simultanea.s.codiceMostrato === salvatoSimultaneo.codice,
  `mostrato ${simultanea.s.codiceMostrato?.slice(0, 9)}…, salvato ${salvatoSimultaneo.codice.slice(0, 9)}…`
);

// ===========================================================================
// 3. LA META' "RIGENERA" DELLO SCENARIO
// ===========================================================================
// Lo scenario dice anche: "rigenera perche' il primo non e' stato letto in
// tempo". Perche' sia una strada vera, l'app deve offrire un modo di
// rigenerare mentre un codice e' gia' a schermo.
console.log("\n3. rigenerare: l'app offre questa strada?");

verifica(
  "3a mentre il codice e' a schermo (accoppiato valorizzato) nessun pulsante chiama genera()",
  // Nel ramo accoppiato ci sono solo: Sincronizza adesso, e Dimentica.
  (testoSync.match(/onPress=\{genera\}/g) ?? []).length === 1 &&
    testoSync.indexOf("onPress={genera}") < testoSync.indexOf("{codiceMostrato ? (")
);
verifica(
  "3b l'unica via per rigenerare passa da 'Dimentica l'accoppiamento', protetta da un avviso a due scelte",
  /Dimenticare l'accoppiamento\?/.test(testoSync) &&
    /text: "Annulla", style: "cancel"/.test(testoSync) &&
    /style: "destructive"/.test(testoSync)
);
verifica(
  "3c dimenticare azzera ANCHE il codice mostrato: la seconda generazione riparte da schermo pulito, non si accavalla con la prima",
  /await dimenticaAccoppiamento\(\); setAccoppiato\(null\); setCodiceMostrato\(null\);/.test(testoSync)
);
// Conseguenza diretta: fra la prima e la seconda generazione ci sono per forza
// un avviso di sistema da confermare e un ridisegno completo. Nessun await
// della prima puo' essere ancora aperto: e' finito prima che il pulsante
// comparisse.
verifica(
  "3d quindi la meta' 'rigenera' dello scenario non e' ravvicinata per costruzione: richiede una conferma umana in mezzo",
  /dimenticaAccoppiamento/.test(testoSync) && /Alert\.alert\("Dimenticare l'accoppiamento\?"/.test(testoSync)
);

// ===========================================================================
// 4. CONCESSO IL DISALLINEAMENTO: COSA PERDE L'UTENTE
// ===========================================================================
// Qui si smette di discutere se accade e si suppone che accada. La domanda e'
// la gravita': l'accusa dice "l'accoppiamento fallisce SENZA SPIEGAZIONE".
console.log("\n4. concesso il disallineamento: cosa perde davvero l'utente in aereo");

const mostrato = Accoppiamento.generaAccoppiamento(); // quello a schermo
const salvato = Accoppiamento.generaAccoppiamento(); // quello finito nel deposito

// 4a — il codice a schermo e' intrinsecamente valido: l'altro dispositivo lo
// accetta. Vero, ed e' la parte spiacevole: al momento dell'accoppiamento non
// c'e' segnale.
let accettatoDallAltro = false;
try {
  const letto = Accoppiamento.leggiAccoppiamento(mostrato.codice);
  accettatoDallAltro = letto.segreto === mostrato.segreto;
} catch {
  accettatoDallAltro = false;
}
verifica(
  "4a il codice mostrato e' integro: l'altro dispositivo lo accetta senza errore (qui l'accusa ha ragione)",
  accettatoDallAltro === true
);

// 4b — ma al primo scambio il fallimento NON e' muto. Si cifra un pacchetto
// con la passphrase che l'altro dispositivo ha ricavato dal codice mostrato, e
// si prova ad aprirlo con quella che questo dispositivo ha davvero salvato.
const eventoFinto = {
  id: "e1",
  hlc: "0000000000000-0000-dispositivo",
  dispositivo: "altro",
  entita: "nota",
  entita_id: "n1",
  tipo: "crea",
  payload: "{}",
};
const involucro = await Pacchetto.cifra(
  Pacchetto.impacchetta("altro", [eventoFinto]),
  Accoppiamento.passphraseDa(Accoppiamento.leggiAccoppiamento(mostrato.codice))
);
let messaggioErrore = "";
try {
  await Pacchetto.decifra(involucro, Accoppiamento.passphraseDa(salvato));
  messaggioErrore = "(nessun errore: il pacchetto si e' aperto)";
} catch (e) {
  messaggioErrore = String(e);
}
console.log(`     errore reale al primo scambio: ${messaggioErrore}`);
verifica(
  "4b con la chiave sbagliata lo scambio fallisce con un messaggio esplicito, non in silenzio",
  /Passphrase errata oppure pacchetto alterato/.test(messaggioErrore),
  messaggioErrore
);

// 4c — e quel messaggio arriva fino alla schermata: riassumi() lo mette nel
// riquadro che app/sync.tsx disegna sotto il pulsante (riga con riassumi(ultimoDiario)).
const diarioFallito = [
  { trasporto: "prossimita", esito: "non disponibile", dettaglio: "modulo non presente" },
  { trasporto: "file cifrato", esito: "fallito", dettaglio: messaggioErrore },
];
const riassunto = Trasporto.riassumi(diarioFallito);
console.log(`     riquadro mostrato all'utente: ${riassunto}`);
verifica(
  "4c il riquadro della schermata riporta il motivo del fallimento all'utente",
  /Nessun trasporto ha funzionato/.test(riassunto) &&
    /Passphrase errata oppure pacchetto alterato/.test(riassunto),
  riassunto
);
verifica(
  "4d app/sync.tsx disegna davvero quel riassunto sotto il pulsante di sincronizzazione",
  /riassumi\(ultimoDiario\)/.test(testoSync)
);

// 4e — nessun dato si perde. La chiave di accoppiamento non tocca il registro
// eventi: uno scambio fallito lascia tutto dov'e'. Una chiave sbagliata
// equivale a non aver ancora sincronizzato, che e' lo stato normale in aereo.
verifica(
  "4e lib/sync/stato.ts scrive solo tre chiavi del deposito, nessuna tabella del registro",
  !/INSERT|UPDATE|DELETE/.test(sorgente("lib/sync/stato.ts")),
  "stato.ts non scrive nel database"
);
verifica(
  "4f il registro eventi resta intatto: uno scambio fallito non marca nulla come sincronizzato",
  /if \(r\.esito\)/.test(sorgente("lib/sync/useAutoSync.ts")),
  "la fusione avviene solo dentro if (r.esito)"
);

// 4g — la riparazione e' a portata di mano e non richiede rete: Dimentica su
// entrambi, rigenera, ritrascrivi. Tutto offline.
verifica(
  "4g la riparazione e' offerta nella stessa schermata e non richiede internet",
  /Dimentica l'accoppiamento/.test(testoSync) && /dimenticaAccoppiamento/.test(sorgente("lib/sync/stato.ts"))
);

// 4h — ordine di priorita' dichiarato dal progetto: la sincronizzazione e'
// esplicitamente rinviabile. Non si tocca il file, si cita.
const claude = sorgente("CLAUDE.md");
verifica(
  "4h CLAUDE.md colloca la sincronizzazione fra cio' che puo' aspettare la scadenza del 1 ottobre",
  /Sincronizzazione, ripasso e statistiche possono aspettare/.test(claude)
);

// ------------------------------------------------------------------- ESITO
rmSync(RADICE, { recursive: true, force: true });

console.log(`\nVerdi ${verdi}, rosse ${rosse.length}`);
if (rosse.length) {
  console.log("Rosse:");
  for (const r of rosse) console.log("  - " + r);
}
process.exit(rosse.length ? 1 : 0);
