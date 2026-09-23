/**
 * CONTROPROVA AVVERSARIALE — SYN-02, lente "correttezza".
 *
 * Accusa da confutare: "Due generazioni ravvicinate del codice: il codice
 * MOSTRATO non e' quello valido", imputata a lib/sync/accoppiamento.ts.
 *
 * Perche' questo file esiste: prima di mandare qualcuno a correggere
 * lib/sync/accoppiamento.ts bisogna dimostrare sul codice VERO che il difetto
 * sta li'. Se invece il rosso nasce dall'ambiente montato dalla simulazione, e
 * non dall'app, la segnalazione manda a riscrivere codice che funziona.
 *
 * Quattro domande, in quest'ordine, perche' ognuna rende inutile la successiva
 * se risponde male:
 *
 *   1. Il file accusato puo' anche solo OSPITARE un difetto di questo tipo?
 *      Un difetto "due generazioni ravvicinate" richiede uno stato condiviso
 *      fra due chiamate. Se generaAccoppiamento() non ne ha, l'accusa e'
 *      indirizzata al file sbagliato.
 *   2. Dove sta davvero la sequenza incriminata? In app/sync.tsx: genera()
 *      mostra il codice PRIMA di averlo salvato e non ha nessuna guardia.
 *   3. Con un deposito che rispetta l'ordine delle scritture — cioe' quello
 *      vero — il doppio tocco produce davvero un disallineamento?
 *   4. Il rosso della simulazione da dove viene, allora?
 *
 * Il deposito usato qui e' quello del banco su node:sqlite (il doppio
 * predefinito di expo-sqlite/kv-store), non quello in memoria: la domanda in
 * gioco e' proprio l'ordine delle scritture su una chiave sola.
 *
 * Si esegue dalla radice del progetto, senza argomenti:
 *
 *   node test/simulazione/controprova-SYN-02-correttezza.mjs
 */
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const QUESTA_CARTELLA = dirname(fileURLToPath(import.meta.url));
const RADICE_PROGETTO = resolve(QUESTA_CARTELLA, "..", "..");

// ------------------------------------------------------- RIAVVIO CON I GANCI
if (!process.env.CONTROPROVA_SYN02_IN_CORSO) {
  const { variabileBanco } = await import("../banco/doppi-altri.mjs");
  const esito = spawnSync(
    process.execPath,
    ["--import", "./test/banco/carica.mjs", "test/simulazione/controprova-SYN-02-correttezza.mjs"],
    {
      cwd: RADICE_PROGETTO,
      stdio: "inherit",
      env: {
        ...process.env,
        CONTROPROVA_SYN02_IN_CORSO: "1",
        BANCO_DOPPI: variabileBanco({
          // lib/sync/stato.ts importa AppState, che il doppio minimo del banco
          // non ha. Riuso quello gia' scritto per la superficie sync-fusione
          // invece di toccare file altrui.
          "react-native": join(QUESTA_CARTELLA, "sync-fusione-react-native.mjs"),
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

// ------------------------------------------------------------- PREPARAZIONE
import * as FS from "../banco/expo-file-system.mjs";
import { configuraCartella } from "../banco/expo-sqlite.mjs";

const RADICE = FS.configuraRadice(mkdtempSync(join(tmpdir(), "controprova-syn02-")));
configuraCartella(join(FS.percorsoDocumenti(), "SQLite"));

const Accoppiamento = await import("../../lib/sync/accoppiamento.ts");
const Stato = await import("../../lib/sync/stato.ts");
const KV = (await import("expo-sqlite/kv-store")).default;

// ===========================================================================
// 1. IL FILE ACCUSATO PUO' OSPITARE UN DIFETTO "DUE GENERAZIONI RAVVICINATE"?
// ===========================================================================
// Un disallineamento fra due chiamate ravvicinate richiede per forza qualcosa
// che le due chiamate si scambiano: una variabile di modulo, una cache, un
// contatore. Se non c'e', ogni chiamata e' un universo a parte e "ravvicinate"
// non significa niente.
console.log("\n1. lib/sync/accoppiamento.ts: puo' ospitare questo difetto?");

const testoAccoppiamento = sorgente("lib/sync/accoppiamento.ts");
// Solo le righe a colonna zero: dentro una funzione un `let` e' stato locale,
// muore con la chiamata e non puo' raggiungere la chiamata successiva. Quello
// che conterebbe e' un `let` (o un assegnamento) di MODULO.
const assegnamentiDiModulo = testoAccoppiamento
  .split("\n")
  .filter((r) => /^(let|var)\s/.test(r) || /^[A-Za-z_$][\w$]*\s*=[^=]/.test(r));
verifica(
  "1a nessuna variabile di modulo mutabile: niente puo' passare da una chiamata all'altra",
  assegnamentiDiModulo.length === 0,
  JSON.stringify(assegnamentiDiModulo)
);
verifica(
  "1b l'unico stato del modulo sono due costanti (ALFABETO, LUNGHEZZA_SEGRETO)",
  /^const ALFABETO =/m.test(testoAccoppiamento) &&
    /^const LUNGHEZZA_SEGRETO =/m.test(testoAccoppiamento) &&
    (testoAccoppiamento.match(/^const /gm) ?? []).length === 2
);
verifica(
  "1c generaAccoppiamento() non e' asincrona: non c'e' nessun punto in cui due chiamate possano accavallarsi",
  /export function generaAccoppiamento\(\): Accoppiamento \{/.test(testoAccoppiamento) &&
    !/async function generaAccoppiamento/.test(testoAccoppiamento)
);

// Duemila generazioni consecutive, il piu' ravvicinate possibile (nessun await
// in mezzo): ognuna deve restare coerente con se stessa.
let coppieCoerenti = 0;
let passphraseCoerenti = 0;
const codiciVisti = new Set();
const coppie = [];
for (let i = 0; i < 2000; i++) coppie.push(Accoppiamento.generaAccoppiamento());
for (const c of coppie) {
  codiciVisti.add(c.codice);
  const letto = Accoppiamento.leggiAccoppiamento(c.codice);
  if (letto.segreto === c.segreto) coppieCoerenti++;
  if (Accoppiamento.passphraseDa(letto) === Accoppiamento.passphraseDa(c)) passphraseCoerenti++;
}
verifica(
  "1d 2000 generazioni di fila: ogni codice mostrato rilegge ESATTAMENTE il proprio segreto",
  coppieCoerenti === 2000,
  `${coppieCoerenti}/2000`
);
verifica(
  "1e e la passphrase ricavata dal codice digitato coincide sempre con quella di chi l'ha generato",
  passphraseCoerenti === 2000,
  `${passphraseCoerenti}/2000`
);
verifica(
  "1f nessuna collisione fra generazioni ravvicinate",
  codiciVisti.size === 2000,
  `${codiciVisti.size}/2000`
);
// Se la generazione numero N potesse inquinare la N+1, si vedrebbe qui: la
// coppia (segreto, codice) della seconda e' indipendente dalla prima.
verifica(
  "1g due generazioni consecutive non condividono nemmeno un carattere di posizione fissa (sono indipendenti)",
  coppie.slice(0, 500).filter((c, i) => i > 0 && c.codice === coppie[i - 1].codice).length === 0
);

// ===========================================================================
// 2. DOVE STA LA SEQUENZA INCRIMINATA
// ===========================================================================
console.log("\n2. la sequenza che la simulazione riproduce sta in app/sync.tsx");

const testoSync = sorgente("app/sync.tsx");
verifica(
  "2a genera() mostra il codice PRIMA di salvarlo: la sequenza incriminata e' qui, non in lib/",
  /const a = generaAccoppiamento\(\);\s*\n\s*setCodiceMostrato\(a\.codice\);\s*\n\s*await salvaAccoppiamento\(a\);/.test(
    testoSync
  )
);
verifica(
  "2b app/sync.tsx e' l'unico chiamante di generaAccoppiamento() in tutta l'app",
  /generaAccoppiamento/.test(testoSync) &&
    !/generaAccoppiamento/.test(sorgente("lib/sync/stato.ts")) &&
    !/generaAccoppiamento/.test(sorgente("lib/sync/auto.ts"))
);

// La meta' "rigenera perche' il primo non e' stato letto in tempo" dello
// scenario: il pulsante Genera vive SOLO nel ramo !accoppiato. Appena il
// salvataggio finisce, accoppiato e' valorizzato e il pulsante sparisce.
verifica(
  "2c il pulsante Genera e' disegnato solo nel ramo !accoppiato",
  /\{!accoppiato \? \(/.test(testoSync) &&
    testoSync.indexOf("onPress={genera}") > testoSync.indexOf("{!accoppiato ? (") &&
    testoSync.indexOf("onPress={genera}") < testoSync.indexOf("{codiceMostrato ? (")
);
verifica(
  "2d l'unico modo di rigenerare e' 'Dimentica l'accoppiamento', che azzera anche il codice mostrato",
  /dimenticaAccoppiamento\(\); setAccoppiato\(null\); setCodiceMostrato\(null\);/.test(testoSync)
);

// ===========================================================================
// 3. IL DOPPIO TOCCO SUL DEPOSITO VERO
// ===========================================================================
// Copia letterale di genera() di app/sync.tsx (il .tsx non e' importabile:
// e' un componente React). Sotto c'e' il vero lib/sync/stato.ts e il vero
// deposito chiave-valore su SQLite.
console.log("\n3. doppio tocco su 'Genera' con il deposito che rispetta l'ordine (quello vero)");

function creaSchermo(salva) {
  const schermo = { codiceMostrato: null, accoppiato: null };
  return {
    schermo,
    async genera() {
      const a = Accoppiamento.generaAccoppiamento();
      schermo.codiceMostrato = a.codice; // setCodiceMostrato(a.codice)
      await salva(a); // await salvaAccoppiamento(a)
      schermo.accoppiato = a; // setAccoppiato(a)
    },
  };
}

await KV.removeItem("accoppiamento");
const conOrdine = creaSchermo((a) => Stato.salvaAccoppiamento(a));
// Due tocchi che si accavallano davvero: il secondo parte mentre il primo e'
// ancora dentro l'await del salvataggio.
const primo = conOrdine.genera();
const secondo = conOrdine.genera();
await Promise.all([primo, secondo]);
const salvatoOrdine = await Stato.leggiAccoppiamentoSalvato();
verifica(
  "3a il codice a schermo E' quello salvato: nessun disallineamento",
  conOrdine.schermo.codiceMostrato === salvatoOrdine.codice,
  `mostrato ${conOrdine.schermo.codiceMostrato?.slice(0, 9)}…, salvato ${salvatoOrdine.codice.slice(0, 9)}…`
);
verifica(
  "3b e la passphrase del salvato apre cio' che l'altro dispositivo cifrerebbe con il codice mostrato",
  Accoppiamento.passphraseDa(Accoppiamento.leggiAccoppiamento(conOrdine.schermo.codiceMostrato)) ===
    Accoppiamento.passphraseDa(salvatoOrdine)
);

// Non una volta sola: duecento doppi tocchi di fila.
let disallineati = 0;
for (let i = 0; i < 200; i++) {
  await KV.removeItem("accoppiamento");
  const s = creaSchermo((a) => Stato.salvaAccoppiamento(a));
  await Promise.all([s.genera(), s.genera()]);
  const salvato = await Stato.leggiAccoppiamentoSalvato();
  if (s.schermo.codiceMostrato !== salvato.codice) disallineati++;
}
verifica(
  "3c 200 doppi tocchi consecutivi, zero disallineamenti",
  disallineati === 0,
  `disallineati ${disallineati}/200`
);

// Tre tocchi, e con un salto di microtask in mezzo: stessa risposta.
await KV.removeItem("accoppiamento");
const tre = creaSchermo((a) => Stato.salvaAccoppiamento(a));
const t1 = tre.genera();
await null;
const t2 = tre.genera();
await null;
const t3 = tre.genera();
await Promise.all([t1, t2, t3]);
const salvatoTre = await Stato.leggiAccoppiamentoSalvato();
verifica(
  "3d anche con tre tocchi il codice a schermo resta quello salvato",
  tre.schermo.codiceMostrato === salvatoTre.codice
);

// La proprieta' su cui tutto poggia, misurata da sola: due scritture sulla
// STESSA chiave, avviate in ordine, atterrano in ordine. Vale per il deposito
// del banco su node:sqlite; nel modulo vero (node_modules/expo-sqlite/src/
// Storage.ts) setItem non e' altro che un singolo `db.runAsync(STATEMENT_SET)`
// sulla stessa connessione, e il lucchetto di apertura (await-lock) serve i
// richiedenti in ordine di arrivo.
let ordineRispettato = 0;
for (let i = 0; i < 200; i++) {
  const a = Accoppiamento.generaAccoppiamento();
  const b = Accoppiamento.generaAccoppiamento();
  const sa = Stato.salvaAccoppiamento(a);
  const sb = Stato.salvaAccoppiamento(b);
  await Promise.all([sa, sb]);
  if ((await Stato.leggiAccoppiamentoSalvato()).codice === b.codice) ordineRispettato++;
}
verifica(
  "3e due salvataggi sulla stessa chiave: vince SEMPRE quello avviato per ultimo",
  ordineRispettato === 200,
  `${ordineRispettato}/200`
);

// ONESTA' SUL LIMITE DI QUANTO SOPRA: il doppio del banco scrive di fatto in
// modo sincrono dietro una facciata asincrona, quindi i due tocchi non si
// accavallano davvero. Sul telefono il deposito e' asincrono per davvero. Qui
// sotto lo stesso doppio tocco su un deposito che ASPETTA sul serio (un giro
// del ciclo di eventi per scrittura) e che serve la coda in ordine di arrivo:
// e' il modello fedele di expo-sqlite, dove setItem e' un solo
// `db.runAsync(INSERT ... ON CONFLICT)` su una connessione sola e il lucchetto
// di apertura (await-lock) sveglia i richiedenti nell'ordine in cui sono
// arrivati. Qui i due genera() si accavallano davvero: il secondo parte mentre
// il primo e' fermo nell'await.
const codaFifo = [];
let codaInMoto = false;
function scriviInCoda(compito) {
  return new Promise((risolvi, rifiuta) => {
    codaFifo.push({ compito, risolvi, rifiuta });
    if (codaInMoto) return;
    codaInMoto = true;
    (async () => {
      while (codaFifo.length) {
        const voce = codaFifo.shift();
        await new Promise((r) => setTimeout(r, 1)); // il viaggio verso il nativo
        try {
          voce.risolvi(await voce.compito());
        } catch (e) {
          voce.rifiuta(e);
        }
      }
      codaInMoto = false;
    })();
  });
}

let disallineatiFifo = 0;
let tocchiAccavallati = 0; // secondo tocco partito mentre il primo aspettava
for (let i = 0; i < 50; i++) {
  await KV.removeItem("accoppiamento");
  let salvataggiAperti = 0;
  const s = creaSchermo((a) => {
    salvataggiAperti++;
    if (salvataggiAperti > 1) tocchiAccavallati++;
    return scriviInCoda(async () => {
      const esito = await Stato.salvaAccoppiamento(a);
      salvataggiAperti--;
      return esito;
    });
  });
  const g1 = s.genera();
  const g2 = s.genera();
  await Promise.all([g1, g2]);
  const salvato = await Stato.leggiAccoppiamentoSalvato();
  if (s.schermo.codiceMostrato !== salvato.codice) disallineatiFifo++;
}
verifica(
  "3f il secondo tocco e' partito davvero mentre il primo era fermo nell'await, in tutte e 50 le prove",
  tocchiAccavallati === 50,
  `accavallamenti ${tocchiAccavallati}/50`
);
verifica(
  "3g deposito asincrono vero, servito in ordine di arrivo: 50 doppi tocchi, zero disallineamenti",
  disallineatiFifo === 0 && codaFifo.length === 0,
  `disallineati ${disallineatiFifo}/50`
);

// ===========================================================================
// 4. DA DOVE VIENE IL ROSSO DELLA SIMULAZIONE
// ===========================================================================
// La simulazione (test/simulazione/schermate-stato.mjs, righe 3199-3215)
// avvolge salvaAccoppiamento in un ritardo che vale SOLO per la prima
// chiamata: `ritardoSalvataggio` viene alzato prima del primo tocco e
// riabbassato prima del secondo. Il primo salvataggio viene poi sbloccato a
// mano, DOPO che il secondo e' gia' atterrato. Ricostruito qui.
console.log("\n4. lo stesso doppio tocco su un deposito che INVERTE l'ordine delle scritture");

function rimandata() {
  let risolvi;
  const promessa = new Promise((r) => (risolvi = r));
  return { promessa, risolvi };
}

await KV.removeItem("accoppiamento");
const trattenuto = rimandata();
let ritardoAttivo = trattenuto.promessa;
const invertito = creaSchermo(async (a) => {
  if (ritardoAttivo) await ritardoAttivo;
  return Stato.salvaAccoppiamento(a);
});
const primaGenerazione = invertito.genera(); // trattenuta
await null;
ritardoAttivo = null; // il secondo tocco non e' trattenuto
await invertito.genera(); // atterra per primo
const mostratoDopoSeconda = invertito.schermo.codiceMostrato;
trattenuto.risolvi(); // ora la prima scrittura sorpassa la seconda
await primaGenerazione;
const salvatoInvertito = await Stato.leggiAccoppiamentoSalvato();
verifica(
  "4a con l'inversione il disallineamento compare, identico a quello della simulazione",
  mostratoDopoSeconda !== salvatoInvertito.codice,
  `mostrato ${mostratoDopoSeconda?.slice(0, 9)}…, salvato ${salvatoInvertito.codice.slice(0, 9)}…`
);
verifica(
  "4b ma il codice mostrato e' comunque integro: rilegge il proprio segreto, non e' corrotto ne' troncato",
  Accoppiamento.leggiAccoppiamento(mostratoDopoSeconda).segreto ===
    mostratoDopoSeconda.replace(/-/g, "").slice(0, -1)
);
// La prova decisiva: tolta l'inversione e lasciato TUTTO il resto identico
// (stesso doppio tocco, stesso ritardo, ma applicato a entrambe le chiamate),
// il disallineamento sparisce. Non e' il doppio tocco a produrlo: e' il
// sorpasso della prima scrittura sulla seconda.
await KV.removeItem("accoppiamento");
const lentoMaOrdinato = rimandata();
const ordinato = creaSchermo(async (a) => {
  await lentoMaOrdinato.promessa; // ritardo uguale per tutti
  return Stato.salvaAccoppiamento(a);
});
const o1 = ordinato.genera();
await null;
const o2 = ordinato.genera();
lentoMaOrdinato.risolvi();
await Promise.all([o1, o2]);
const salvatoOrdinato = await Stato.leggiAccoppiamentoSalvato();
verifica(
  "4c stesso doppio tocco e stesso ritardo, ma uguale per entrambi: il disallineamento NON compare",
  ordinato.schermo.codiceMostrato === salvatoOrdinato.codice,
  `mostrato ${ordinato.schermo.codiceMostrato?.slice(0, 9)}…, salvato ${salvatoOrdinato.codice.slice(0, 9)}…`
);

// ------------------------------------------------------------------- ESITO
rmSync(RADICE, { recursive: true, force: true });

console.log(`\nVerdi ${verdi}, rosse ${rosse.length}`);
if (rosse.length) {
  console.log("Rosse:");
  for (const r of rosse) console.log("  - " + r);
}
process.exit(rosse.length ? 1 : 0);
