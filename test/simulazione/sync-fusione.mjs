/**
 * SIMULAZIONE DELLA SUPERFICIE "SYNC-FUSIONE" — lib/sync/ sopra il banco.
 *
 * Si esegue dalla radice del progetto, senza argomenti e senza variabili:
 *
 *   node test/simulazione/sync-fusione.mjs
 *
 * Il file si riavvia da solo con `--import ./test/banco/carica.mjs` e con
 * BANCO_DOPPI gia' composta (come fa test/banco/prova-altri.mjs): i ganci del
 * banco vanno registrati prima di qualunque import, e questo e' il solo modo di
 * ottenerlo senza chiedere a chi esegue di ricordarsi una riga di comando.
 *
 * Qui gira il CODICE VERO dell'app: lib/sync/pacchetto.ts, fusione.ts,
 * accoppiamento.ts, trasporto.ts, file.ts, wifi.ts, vicinanza.ts, auto.ts,
 * stato.ts, piu' lib/db.ts e lib/hlc.ts. Le schermate (app/sync.tsx) e l'hook
 * useAutoSync NON si importano: il banco non ha react-native ne' expo-router e
 * un hook senza renderer non si chiama. Dove serve, la loro logica e' RICOPIATA
 * nel test riga per riga (vedi parte I), che e' la via indicata dal banco.
 *
 * NOVE PARTI:
 *   A. impacchetta(): forma, ordine causale, immutabilita', pacchetto al limite
 *      dei 500 eventi di daSincronizzare();
 *   B. cifratura: giro completo, manomissioni, involucri malformati in nove
 *      modi, invariante 6 (niente uscita in chiaro), assenza di oracolo;
 *   C. fusione: nuovi/duplicati, convergenza, conflitti, payload malformati,
 *      eliminazione e resurrezione, impronta, ordinamento;
 *   D. accoppiamento: giro completo, battitura, trasposizione, troncamento,
 *      caratteri estranei, passphrase derivata;
 *   E. catena dei trasporti: casi al contorno non coperti da test/catena.test.ts;
 *   F. trasporto 3 (file): scambio vero fra due dispositivi, annullamenti,
 *      foglio di condivisione assente, file estranei, residui in cache;
 *   G. trasporti 1 e 2: nessuna uscita in chiaro nemmeno li', assenza onesta
 *      quando il modulo nativo non c'e';
 *   H. politica automatica: soglie esatte, backoff, divergenza;
 *   I. stato su disco e applicazione di un pacchetto: lib/sync/stato.ts sopra
 *      lib/db.ts vero, e la sequenza di useAutoSync ricopiata.
 *
 * CONVENZIONE SUI DIFETTI. Un difetto dell'app NON viene corretto qui e non
 * rende rossa la prova: lo scenario che lo riproduce si chiama
 * "DIFETTO RIPRODOTTO: ..." e verifica il comportamento OSSERVATO OGGI, cosi'
 * resta una rete di sicurezza che diventera' rossa il giorno in cui il difetto
 * sara' corretto (ed e' allora che va riscritta l'attesa). L'elenco completo
 * viene ristampato in fondo, separato dal conteggio.
 *
 * COME VERIFICARE CHE QUESTA PROVA NON SIA UN TIMBRO (falsificazione fatta, non
 * immaginata). Una prova che non puo' diventare rossa non dimostra niente. Si
 * indebolisce il codice DA FUORI: si copia un modulo di lib/sync/ in una
 * cartella FUORI dal progetto, lo si guasta, e lo si sostituisce con la
 * variabile BANCO_SYNC_FUSIONE_EXTRA (gancio previsto qui sotto). Nessun file
 * del progetto viene toccato.
 *
 *   (a) CIFRATURA FINTA — in una copia di lib/sync/pacchetto.ts si sostituisce
 *       il corpo di cifra() con `const cifrato = testo.buffer` e quello di
 *       decifra() con `chiaro = daBase64(esterno.dati!).buffer`: il giro
 *       completo continua a funzionare, ma il pacchetto esce in chiaro
 *       (codificato in base64, non cifrato).
 *
 *         BANCO_SYNC_FUSIONE_EXTRA='{"../../lib/sync/pacchetto.ts":"/fuori/pacchetto-in-chiaro.ts",
 *                                    "./pacchetto":"/fuori/pacchetto-in-chiaro.ts"}' \
 *           node test/simulazione/sync-fusione.mjs
 *
 *       MISURATO: 14 scenari rossi su 91 (A5, B1, B3, B4, B5, B6, B7, B12,
 *       B19, D6, F1, G2, G3, G4), 18 verifiche cadute.
 *
 *   (b) CHECKSUM POSIZIONALE — in una copia di lib/sync/accoppiamento.ts si
 *       cambia `somma * 33` in `somma * 31`, cioe' si CORREGGE il difetto
 *       ACC-03 (33 e' congruo a 1 modulo 32, 31 no).
 *
 *       MISURATO: 1 scenario rosso, ed e' esattamente D3, lo scenario che
 *       riproduce quel difetto. E' la prova che gli scenari "DIFETTO
 *       RIPRODOTTO" sono reti di sicurezza vere: diventano rossi il giorno in
 *       cui il difetto viene corretto, e vanno riscritti allora.
 *
 * COSA HA INSEGNATO LA FALSIFICAZIONE (e che senza non si sarebbe saputo): al
 * primo giro l'indebolimento (a) NON faceva cadere F1, G2, G3, G4, cioe'
 * proprio le quattro verifiche dell'invariante 6. Il motivo: cercavano la
 * parola in chiaro con includes() sull'involucro, e un pacchetto non cifrato
 * ma codificato in base64 la superava. Da li' e' nata contieneInChiaro(), che
 * guarda anche DENTRO il campo `dati` decodificato. Il controllo di prima
 * sembrava verde per merito del codice: era verde per debolezza propria.
 *
 * LIMITI DI QUESTA SIMULAZIONE (leggere prima di fidarsi del verde):
 *   - niente interfaccia: app/sync.tsx non si carica, la sua logica e' ricopiata;
 *   - niente secondo dispositivo vero: il "pari" e' un secondo Orologio e un
 *     secondo TrasportoFile nello stesso processo, con un file che passa di
 *     mano. Bastano per la fusione, non per il parallelismo reale;
 *   - niente rete: il trasporto wi-fi gira con fetch sostituito dal test, e
 *     quello di prossimita' con un modulo nativo finto. Provano che il
 *     contenuto e' cifrato, non che la radio funzioni;
 *   - lib/db.ts e' un singoletto di modulo: la parte I apre il database UNA
 *     volta e non puo' provare due dispositivi che scrivono davvero insieme;
 *   - PBKDF2 a 210.000 iterazioni: ogni cifratura costa ~50-100 ms. Le
 *     cifrature sono contate apposta per tenere la prova sotto il minuto.
 */
import { spawnSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const QUESTA_CARTELLA = dirname(fileURLToPath(import.meta.url));
const RADICE_PROGETTO = resolve(QUESTA_CARTELLA, "..", "..");

// ------------------------------------------------------- RIAVVIO CON I GANCI
if (!process.env.BANCO_SYNC_FUSIONE_IN_CORSO) {
  const { KV_MEMORIA, variabileBanco } = await import("../banco/doppi-altri.mjs");
  // Gancio per la FALSIFICAZIONE (vedi in fondo): permette di sostituire un
  // modulo dell'app con una copia indebolita tenuta FUORI dal progetto, senza
  // modificare niente qui dentro. Vuoto in condizioni normali.
  const sostituzioni = process.env.BANCO_SYNC_FUSIONE_EXTRA
    ? JSON.parse(process.env.BANCO_SYNC_FUSIONE_EXTRA)
    : {};
  const esito = spawnSync(
    process.execPath,
    ["--import", "./test/banco/carica.mjs", "test/simulazione/sync-fusione.mjs"],
    {
      cwd: RADICE_PROGETTO,
      stdio: "inherit",
      env: {
        ...process.env,
        BANCO_SYNC_FUSIONE_IN_CORSO: "1",
        BANCO_DOPPI: variabileBanco({
          // Deposito chiave-valore in memoria: nasce e muore con il processo,
          // cosi' due esecuzioni in parallelo non si contendono un file.
          "expo-sqlite/kv-store": KV_MEMORIA,
          // Il doppio di react-native del banco ha solo Platform; stato.ts
          // vuole anche AppState. Il mio lo aggiunge senza toccare il loro.
          "react-native": join(QUESTA_CARTELLA, "sync-fusione-react-native.mjs"),
          ...sostituzioni,
        }),
      },
    }
  );
  process.exit(esito.status ?? 1);
}

// ------------------------------------------------------------------ CONTEGGIO
const scenari = [];
let corrente = null;

function ok(nome, condizione, extra = "") {
  if (!corrente) throw new Error("ok() fuori da uno scenario: " + nome);
  corrente.verifiche++;
  if (!condizione) corrente.errori.push(`${nome}${extra ? " — " + extra : ""}`);
}

function uguali(nome, ottenuto, atteso) {
  const a = JSON.stringify(ottenuto);
  const b = JSON.stringify(atteso);
  ok(nome, a === b, `atteso ${b}, ottenuto ${a}`);
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

/** Come lancia(), ma restituisce il messaggio senza pretendere nulla su di esso. */
async function messaggioDi(azione) {
  try {
    await azione();
    return null;
  } catch (errore) {
    return String(errore?.message ?? errore);
  }
}

async function scenario(nome, corpo) {
  corrente = { nome, verifiche: 0, errori: [] };
  scenari.push(corrente);
  try {
    await corpo();
  } catch (errore) {
    corrente.verifiche++;
    corrente.errori.push("eccezione non attesa — " + (errore?.stack ?? String(errore)));
  }
  corrente = null;
}

// ------------------------------------------------------------- PREPARAZIONE
import * as FS from "../banco/expo-file-system.mjs";
import * as Picker from "../banco/expo-document-picker.mjs";
import * as Sharing from "../banco/expo-sharing.mjs";
import { configuraCartella } from "../banco/expo-sqlite.mjs";
import * as RN from "./sync-fusione-react-native.mjs";

// Radice finta del dispositivo (documenti/, cache/, pacchetto/) e cartella dei
// database dentro di essa: e' l'ordine che il banco prescrive quando si usano
// insieme expo-file-system ed expo-sqlite.
const RADICE = FS.configuraRadice(mkdtempSync(join(tmpdir(), "sync-fusione-")));
const CARTELLA_DB = configuraCartella(join(FS.percorsoDocumenti(), "SQLite"));

// Codice vero dell'app. Import dinamico obbligatorio: uno statico sarebbe
// risolto prima che i ganci del banco esistano.
const Pacchetto = await import("../../lib/sync/pacchetto.ts");
const Fusione = await import("../../lib/sync/fusione.ts");
const Accoppiamento = await import("../../lib/sync/accoppiamento.ts");
const Trasporto = await import("../../lib/sync/trasporto.ts");
const File3 = await import("../../lib/sync/file.ts");
const Wifi = await import("../../lib/sync/wifi.ts");
const Vicinanza = await import("../../lib/sync/vicinanza.ts");
const Auto = await import("../../lib/sync/auto.ts");
const Stato = await import("../../lib/sync/stato.ts");
const HLC = await import("../../lib/hlc.ts");
const Db = await import("../../lib/db.ts");

const { cifra, decifra, impacchetta, VERSIONE_PACCHETTO } = Pacchetto;
const { fondi, proietta, impronta, ordinaEventi } = Fusione;
const { Orologio, serializza } = HLC;

const PASSPHRASE = "percorso-v1:PROVA0000PROVA0000PROVA0000PROVA0";

/** Un evento serializzato con la forma esatta di lib/sync/pacchetto.ts. */
function evento(orologio, dispositivo, entita, entitaId, tipo, payload, ms) {
  const h = orologio.adesso(ms);
  const hlc = serializza(h);
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

/** Sostituisce globalThis.crypto e restituisce la funzione che lo ripristina. */
function sostituisciCrypto(finto) {
  const originale = Object.getOwnPropertyDescriptor(globalThis, "crypto");
  Object.defineProperty(globalThis, "crypto", {
    value: finto,
    configurable: true,
    writable: true,
  });
  return () => Object.defineProperty(globalThis, "crypto", originale);
}

function fileNellaCache(estensione = ".pcs") {
  return readdirSync(FS.percorsoCache()).filter((n) => n.endsWith(estensione));
}

/**
 * Cerca una parola nell'involucro E dentro il suo campo `dati` decodificato.
 *
 * Perche' non basta involucro.includes(parola): i dati viaggiano in base64, e
 * un pacchetto NON cifrato ma solo codificato passerebbe il controllo ingenuo
 * pur essendo perfettamente leggibile da chiunque. Misurato: indebolendo
 * cifra() in modo che restituisca il chiaro codificato in base64, la sola
 * includes() restava verde. L'invariante 6 si verifica qui dentro.
 */
function contieneInChiaro(involucro, parola) {
  if (String(involucro).includes(parola)) return true;
  try {
    const esterno = JSON.parse(involucro);
    if (typeof esterno?.dati === "string") {
      if (Buffer.from(esterno.dati, "base64").toString("utf8").includes(parola)) return true;
      if (Buffer.from(esterno.dati, "base64").toString("latin1").includes(parola)) return true;
    }
  } catch {
    // non e' un involucro JSON: la sola ricerca testuale e' quanto si puo' fare
  }
  return false;
}

// =========================================================================
// PARTE A — impacchetta(): cosa viaggia, e in che ordine
// =========================================================================

await scenario("A1 impacchetta: versione, mittente, istante e ordine causale", async () => {
  const o = new Orologio("tab1");
  const primo = evento(o, "tab1", "note", "n1", "crea", { t: "A" }, 1000);
  const secondo = evento(o, "tab1", "note", "n2", "crea", { t: "B" }, 2000);
  // Ingresso volutamente al contrario: impacchetta deve rimetterli in ordine.
  const p = impacchetta("tab1", [secondo, primo]);

  ok("versione dichiarata", p.versione === VERSIONE_PACCHETTO);
  ok("mittente dichiarato", p.dispositivo === "tab1");
  ok("creato e' un ISO 8601 valido", !Number.isNaN(Date.parse(p.creato)));
  uguali("eventi ordinati per hlc crescente", p.eventi.map((e) => e.entita_id), ["n1", "n2"]);
});

await scenario("A2 impacchetta: non muta l'array ricevuto dal chiamante", async () => {
  const o = new Orologio("tab1");
  const a = evento(o, "tab1", "note", "n1", "crea", {}, 2000);
  const b = evento(o, "tab1", "note", "n2", "crea", {}, 1000);
  const ingresso = [a, b];
  const copia = ingresso.slice();
  impacchetta("tab1", ingresso);
  // Se usasse eventi.sort() invece di [...eventi].sort(), daSincronizzare()
  // restituirebbe al chiamante un array riordinato sotto i piedi.
  uguali("l'ordine dell'ingresso e' intatto", ingresso.map((e) => e.entita_id), copia.map((e) => e.entita_id));
});

await scenario("A3 impacchetta: lista vuota produce comunque un pacchetto valido", async () => {
  const p = impacchetta("tab1", []);
  uguali("eventi vuoti", p.eventi, []);
  ok("resta cifrabile", (await cifra(p, PASSPHRASE)).length > 0);
});

await scenario("A4 impacchetta: a parita' di hlc conserva l'ordine di arrivo", async () => {
  // impacchetta NON usa l'id come spareggio, a differenza di ordinaEventi:
  // fra due eventi con lo stesso hlc l'ordine e' quello con cui arrivano.
  const hlc = "000000000064-0000-tab1";
  const x = { id: hlc + ":zz", hlc, dispositivo: "tab1", entita: "note", entita_id: "zz", tipo: "crea", payload: "{}" };
  const y = { id: hlc + ":aa", hlc, dispositivo: "tab1", entita: "note", entita_id: "aa", tipo: "crea", payload: "{}" };
  uguali("ordine di arrivo conservato", impacchetta("tab1", [x, y]).eventi.map((e) => e.entita_id), ["zz", "aa"]);
  uguali("ordinaEventi invece spareggia per id", ordinaEventi([x, y]).map((e) => e.entita_id), ["aa", "zz"]);
});

await scenario("A5 PKT-02: pacchetto al limite dei 500 eventi di daSincronizzare()", async () => {
  const o = new Orologio("tab1");
  const eventi = [];
  for (let i = 0; i < 500; i++) {
    eventi.push(
      evento(o, "tab1", "tentativi", `t${i}`, "crea", {
        esercizio_id: `SQL-${i}`,
        risposta: "SELECT paese, count(*) FROM strutture GROUP BY paese",
        esito: i % 3 === 0 ? "corretto" : "errato",
        durata_sec: 40 + i,
      }, 1_700_000_000_000 + i)
    );
  }
  const p = impacchetta("tab1", eventi);
  const t0 = Date.now();
  const involucro = await cifra(p, PASSPHRASE);
  const tCifra = Date.now() - t0;
  const t1 = Date.now();
  const tornato = await decifra(involucro, PASSPHRASE);
  const tDecifra = Date.now() - t1;

  ok("500 eventi tornano tutti", tornato.eventi.length === 500);
  ok("il primo e l'ultimo sono intatti",
     tornato.eventi[0].id === p.eventi[0].id && tornato.eventi[499].id === p.eventi[499].id);
  ok("nessuna risposta SQL in chiaro nell'involucro", !contieneInChiaro(involucro, "SELECT"));
  ok("cifratura sotto il secondo", tCifra < 1000, `${tCifra} ms`);
  ok("decifratura sotto il secondo", tDecifra < 1000, `${tDecifra} ms`);
});

// =========================================================================
// PARTE B — cifratura: l'invariante 6 vive qui
// =========================================================================

// Un involucro valido riusato da piu' scenari: cifrare costa 210.000
// iterazioni di PBKDF2, quindi si cifra una volta e si manomette la copia.
const pacchettoBase = impacchetta("tab1", [
  (() => {
    const o = new Orologio("tab1");
    return evento(o, "tab1", "note", "n1", "crea", { titolo: "Lettura serale", testo: "segreto-in-chiaro" }, 1000);
  })(),
]);
const involucroBase = await cifra(pacchettoBase, PASSPHRASE);

/** Copia dell'involucro buono, con una manomissione applicata. */
function involucroManomesso(mutazione) {
  const c = JSON.parse(involucroBase);
  const sostituto = mutazione(c);
  return sostituto === undefined ? JSON.stringify(c) : sostituto;
}

await scenario("B1 cifra: giro completo e nessun testo in chiaro nell'involucro", async () => {
  const tornato = await decifra(involucroBase, PASSPHRASE);
  uguali("il pacchetto torna identico", tornato, pacchettoBase);
  ok("il testo della nota non compare in chiaro", !contieneInChiaro(involucroBase, "segreto-in-chiaro"));
  ok("nemmeno il titolo", !contieneInChiaro(involucroBase, "Lettura serale"));
  ok("nemmeno il nome dell'entita'", !contieneInChiaro(involucroBase, '"note"'));
});

await scenario("B2 cifra: l'involucro dichiara formato, versione, kdf, iv e dati", async () => {
  const e = JSON.parse(involucroBase);
  ok("formato", e.formato === "percorso-sync");
  ok("versione", e.versione === VERSIONE_PACCHETTO);
  ok("nome del kdf", e.kdf.nome === "PBKDF2-SHA256");
  ok("iterazioni OWASP", e.kdf.iterazioni === 210000);
  ok("sale di 16 byte", Buffer.from(e.kdf.sale, "base64").length === 16);
  ok("iv di 12 byte", Buffer.from(e.iv, "base64").length === 12);
  ok("dati presenti", typeof e.dati === "string" && e.dati.length > 0);
});

await scenario("B3 cifra: due cifrature dello stesso pacchetto sono diverse", async () => {
  // Sale e iv nuovi a ogni chiamata: due esportazioni consecutive non devono
  // essere confrontabili byte a byte da chi le intercetta.
  const secondo = await cifra(pacchettoBase, PASSPHRASE);
  const a = JSON.parse(involucroBase);
  const b = JSON.parse(secondo);
  ok("sale diverso", a.kdf.sale !== b.kdf.sale);
  ok("iv diverso", a.iv !== b.iv);
  ok("dati diversi", a.dati !== b.dati);
});

await scenario("B4 decifra: passphrase errata respinta", async () => {
  await lancia("respinta", () => decifra(involucroBase, PASSPHRASE + "x"), "Passphrase errata");
});

await scenario("B5 decifra: manomissione di un byte dei dati respinta da GCM", async () => {
  const rotto = involucroManomesso((c) => {
    c.dati = c.dati.slice(0, 20) + (c.dati[20] === "A" ? "B" : "A") + c.dati.slice(21);
  });
  await lancia("respinta", () => decifra(rotto, PASSPHRASE), "Passphrase errata oppure pacchetto alterato");
});

await scenario("B6 decifra: manomissione dell'iv respinta", async () => {
  const rotto = involucroManomesso((c) => {
    const b = Buffer.from(c.iv, "base64");
    b[0] = b[0] ^ 0xff;
    c.iv = b.toString("base64");
  });
  await lancia("respinta", () => decifra(rotto, PASSPHRASE), "Passphrase errata oppure pacchetto alterato");
});

await scenario("B7 INV6-02: passphrase errata e manomissione danno lo stesso messaggio", async () => {
  // Messaggi diversi sarebbero un oracolo: direbbero a chi prova una chiave se
  // ha sbagliato la chiave o il file. Qui devono essere indistinguibili.
  const daPassphrase = await messaggioDi(() => decifra(involucroBase, "altra"));
  const rotto = involucroManomesso((c) => {
    c.dati = c.dati.slice(0, 12) + (c.dati[12] === "C" ? "D" : "C") + c.dati.slice(13);
  });
  const daManomissione = await messaggioDi(() => decifra(rotto, PASSPHRASE));
  ok("nessun oracolo", daPassphrase === daManomissione, `${daPassphrase} / ${daManomissione}`);
});

await scenario("B8 decifra: formato estraneo e versione futura", async () => {
  await lancia("formato estraneo", () => decifra('{"formato":"altro"}', PASSPHRASE), "Formato non riconosciuto");
  const futuro = involucroManomesso((c) => { c.versione = 99; });
  const m = await lancia("versione futura", () => decifra(futuro, PASSPHRASE), "Aggiorna l'app");
  ok("la versione letta e' nel messaggio", m.includes("99"));
});

await scenario("B9 DIFETTO RIPRODOTTO (CIF-03): involucro senza kdf -> TypeError in inglese", async () => {
  // Atteso: "Il file non e' un pacchetto di sincronizzazione." in italiano.
  // Oggi: esterno.kdf!.sale su undefined. app/sync.tsx mostra String(e) tale e
  // quale, quindi l'utente legge un messaggio inglese del motore JavaScript.
  const senzaKdf = involucroManomesso((c) => { delete c.kdf; });
  const m = await lancia("kdf mancante", () => decifra(senzaKdf, PASSPHRASE), "Cannot read properties of undefined");
  ok("il messaggio non e' in italiano", !m.includes("pacchetto di sincronizzazione"));
  const senzaSale = involucroManomesso((c) => { delete c.kdf.sale; });
  await lancia("kdf senza sale", () => decifra(senzaSale, PASSPHRASE), "not correctly encoded");
  const senzaIv = involucroManomesso((c) => { delete c.iv; });
  await lancia("iv mancante", () => decifra(senzaIv, PASSPHRASE), "not correctly encoded");
});

await scenario("B10 DIFETTO RIPRODOTTO (CIF-04): sale o iv non base64 -> DOMException fuori dal try", async () => {
  // daBase64(kdf.sale) e daBase64(iv) stanno FUORI dal try che traduce gli
  // errori: solo daBase64(dati) e' protetto. Due campi su tre sfuggono.
  const saleRotto = involucroManomesso((c) => { c.kdf.sale = "@@@@"; });
  await lancia("sale non base64", () => decifra(saleRotto, PASSPHRASE), "Invalid character");
  const ivRotto = involucroManomesso((c) => { c.iv = "@@@@"; });
  await lancia("iv non base64", () => decifra(ivRotto, PASSPHRASE), "Invalid character");
  // Il terzo campo, protetto, produce invece il messaggio italiano previsto.
  const datiRotti = involucroManomesso((c) => { c.dati = "@@@@"; });
  await lancia("dati non base64 (protetto)", () => decifra(datiRotti, PASSPHRASE), "Passphrase errata oppure pacchetto alterato");
});

await scenario("B11 DIFETTO RIPRODOTTO (CIF-05): involucro 'null' -> TypeError", async () => {
  await lancia("null", () => decifra("null", PASSPHRASE), "Cannot read properties of null");
  // Gli altri non-oggetti sono invece respinti correttamente.
  await lancia("array", () => decifra("[]", PASSPHRASE), "Formato non riconosciuto");
  await lancia("numero", () => decifra("123", PASSPHRASE), "Formato non riconosciuto");
  await lancia("stringa", () => decifra('"testo"', PASSPHRASE), "Formato non riconosciuto");
  await lancia("vero", () => decifra("true", PASSPHRASE), "Formato non riconosciuto");
});

await scenario("B12 CIF-06: pacchetto troncato, in tre punti diversi", async () => {
  await lancia("file di 0 byte", () => decifra("", PASSPHRASE), "Il file non è un pacchetto di sincronizzazione");
  const meta = involucroBase.slice(0, Math.floor(involucroBase.length / 2));
  await lancia("json spezzato a meta'", () => decifra(meta, PASSPHRASE), "Il file non è un pacchetto di sincronizzazione");
  const datiTagliati = involucroManomesso((c) => { c.dati = c.dati.slice(0, c.dati.length - 8); });
  await lancia("involucro integro, dati tagliati", () => decifra(datiTagliati, PASSPHRASE), "Passphrase errata oppure pacchetto alterato");
  // In nessuno dei tre casi torna un pacchetto parziale: o tutto o niente.
});

await scenario("B13 DIFETTO RIPRODOTTO (CIF-07): versione 0 o assente non viene respinta", async () => {
  // Il controllo e' solo (versione ?? 0) > 1: una versione piu' VECCHIA, o
  // assente del tutto, passa e si arriva a tentare la decifratura.
  const zero = involucroManomesso((c) => { c.versione = 0; });
  const p1 = await decifra(zero, PASSPHRASE);
  ok("versione 0 accettata", p1.eventi.length === 1);
  const assente = involucroManomesso((c) => { delete c.versione; });
  const p2 = await decifra(assente, PASSPHRASE);
  ok("versione assente accettata", p2.eventi.length === 1);
  // E nemmeno la versione INTERNA al pacchetto viene mai verificata.
  const interno = await cifra({ ...pacchettoBase, versione: 42 }, PASSPHRASE);
  ok("versione interna 42 accettata senza obiezioni", (await decifra(interno, PASSPHRASE)).versione === 42);
});

await scenario("B14 DIFETTO RIPRODOTTO (CIF-08): kdf.iterazioni e kdf.nome non sono mai letti", async () => {
  // derivaChiave usa sempre la costante: il profilo KDF dichiarato
  // nell'involucro e' decorativo. Se un domani si alzassero le iterazioni, i
  // vecchi pacchetti fallirebbero con "Passphrase errata", non con
  // "profilo non supportato".
  const falsificato = involucroManomesso((c) => { c.kdf.iterazioni = 1000; c.kdf.nome = "PBKDF2-INVENTATO"; });
  const p = await decifra(falsificato, PASSPHRASE);
  ok("si decifra lo stesso", p.eventi.length === 1);
});

await scenario("B15 DIFETTO RIPRODOTTO (CIF-09): decifra non valida la forma del pacchetto", async () => {
  // JSON.parse seguito da "as Pacchetto": nessun controllo. Un pacchetto senza
  // eventi arriva a fondi(), che poi muore su "remoti is not iterable".
  const senzaEventi = await cifra({ versione: 1, dispositivo: "tel2", creato: "adesso" }, PASSPHRASE);
  const p = await decifra(senzaEventi, PASSPHRASE);
  ok("eventi undefined passa a valle", p.eventi === undefined);
  await lancia("e fa cadere fondi()", async () => fondi([], p.eventi), "not iterable");

  const eventiNonArray = await cifra({ versione: 1, dispositivo: "tel2", creato: "adesso", eventi: { a: 1 } }, PASSPHRASE);
  const q = await decifra(eventiNonArray, PASSPHRASE);
  ok("eventi non-array passa a valle", !Array.isArray(q.eventi));

  // Nemmeno la forma del singolo evento e' controllata.
  const eventoMonco = await cifra({ versione: 1, dispositivo: "tel2", creato: "adesso", eventi: [{ id: "solo-id" }] }, PASSPHRASE);
  const r = await decifra(eventoMonco, PASSPHRASE);
  ok("evento senza hlc ne' tipo accettato", r.eventi[0].hlc === undefined);
});

await scenario("B16 CIF-10: accenti, euro, trattini lunghi ed emoji sopravvivono al giro", async () => {
  const testo = "però — 12 € · citazione «rientro» · 汉字 · 🚀 fine";
  const o = new Orologio("tab1");
  const p = impacchetta("tab1", [evento(o, "tab1", "note", "n9", "crea", { testo }, 5000)]);
  const tornato = await decifra(await cifra(p, PASSPHRASE), PASSPHRASE);
  ok("testo identico byte per byte", JSON.parse(tornato.eventi[0].payload).testo === testo);
});

await scenario("B17 DIFETTO RIPRODOTTO: campo dati assente -> diagnosi 'Passphrase errata'", async () => {
  // daBase64(esterno.dati!) e' dentro il try, quindi un involucro a cui manca
  // proprio il carico utile viene diagnosticato come chiave sbagliata: chi
  // legge va a ricontrollare il codice di accoppiamento per niente.
  const senzaDati = involucroManomesso((c) => { delete c.dati; });
  await lancia("diagnosi fuorviante", () => decifra(senzaDati, PASSPHRASE), "Passphrase errata oppure pacchetto alterato");
});

await scenario("B18 INV6: senza WebCrypto si solleva, non si esporta in chiaro", async () => {
  // La domanda dell'invariante 6 e': esiste un ripiego che scrive il pacchetto
  // leggibile quando la cifratura non e' disponibile? No.
  const ripristina = sostituisciCrypto({ getRandomValues: (b) => b });
  try {
    const m = await lancia("cifra solleva", () => cifra(pacchettoBase, PASSPHRASE), "WebCrypto non disponibile");
    ok("il messaggio dichiara che il chiaro non e' previsto", m.includes("in chiaro non è prevista"));
  } finally {
    ripristina();
  }
  // Senza nemmeno l'oggetto crypto l'errore c'e' comunque, ma e' un TypeError
  // inglese: casuali() tocca getRandomValues PRIMA che subtle() parli italiano.
  const ripristina2 = sostituisciCrypto(undefined);
  try {
    await lancia("senza crypto del tutto: TypeError", () => cifra(pacchettoBase, PASSPHRASE), "getRandomValues");
  } finally {
    ripristina2();
  }
  ok("crypto ripristinato", typeof globalThis.crypto.subtle === "object");
});

await scenario("B19 cifra: una passphrase vuota non viene rifiutata", async () => {
  // Comportamento da conoscere: la robustezza della chiave e' garantita solo
  // da chi la costruisce (passphraseDa), non da cifra().
  const involucro = await cifra(impacchetta("tab1", []), "");
  ok("giro completo con passphrase vuota", (await decifra(involucro, "")).eventi.length === 0);
  await lancia("e un'altra non apre", () => decifra(involucro, "x"), "Passphrase errata");
});

// =========================================================================
// PARTE C — fusione, conflitti, proiezione
// =========================================================================

await scenario("C1 fondi: eventi nuovi riconosciuti, duplicati contati", async () => {
  const tab = new Orologio("tab1");
  const tel = new Orologio("tel2");
  const locali = [evento(tab, "tab1", "note", "n1", "crea", { t: "A" }, 1000)];
  const remoti = [
    evento(tel, "tel2", "note", "n2", "crea", { t: "B" }, 1000),
    evento(tel, "tel2", "note", "n3", "crea", { t: "C" }, 1001),
  ];
  const f = fondi(locali, remoti);
  ok("due nuovi", f.nuovi.length === 2);
  ok("nessun duplicato", f.duplicati === 0);
  uguali("entita' toccate", f.entitaToccate, [
    { entita: "note", entita_id: "n2" },
    { entita: "note", entita_id: "n3" },
  ]);
  uguali("i nuovi escono in ordine causale", f.nuovi.map((e) => e.entita_id), ["n2", "n3"]);
});

await scenario("C2 FUS-03: lo stesso pacchetto importato due volte non aggiunge nulla", async () => {
  const tab = new Orologio("tab1");
  const tel = new Orologio("tel2");
  const locali = [evento(tab, "tab1", "note", "n1", "crea", { t: "A" }, 1000)];
  const remoti = [evento(tel, "tel2", "note", "n2", "crea", { t: "B" }, 1000)];
  const primo = fondi(locali, remoti);
  const secondo = fondi([...locali, ...primo.nuovi], remoti);
  ok("nessun nuovo alla seconda", secondo.nuovi.length === 0);
  ok("contati come duplicati", secondo.duplicati === 1);
  uguali("nessuna entita' toccata", secondo.entitaToccate, []);
});

await scenario("C3 DIFETTO RIPRODOTTO (FUS-06): i conflitti sono ricalcolati sull'intera storia", async () => {
  // Atteso: conflitti descrive i conflitti INTRODOTTI da questa fusione.
  // Oggi il ciclo gira su [...locali, ...nuovi], quindi una storia gia' fusa
  // da giorni continua a produrre lo stesso conflitto a ogni scambio.
  const tab = new Orologio("tab1");
  const tel = new Orologio("tel2");
  const creaTablet = evento(tab, "tab1", "note", "n1", "crea", { testo: "A" }, 1000);
  const aggiornaTelefono = evento(tel, "tel2", "note", "n1", "aggiorna", { testo: "B" }, 2000);

  const f = fondi([creaTablet, aggiornaTelefono], []);
  ok("nessun evento nuovo", f.nuovi.length === 0);
  ok("nessun duplicato", f.duplicati === 0);
  ok("eppure un conflitto viene riportato", f.conflitti.length === 1);
  uguali("con vincitore e campo", f.conflitti[0], {
    entita: "note", entita_id: "n1", campo: "testo", vincitore: "tel2",
  });

  // Tre eventi alternati sullo stesso campo: due conflitti per un solo disaccordo.
  const terzo = evento(tab, "tab1", "note", "n1", "aggiorna", { testo: "C" }, 3000);
  ok("tre eventi alternati -> due conflitti", fondi([creaTablet, aggiornaTelefono, terzo], []).conflitti.length === 2);
});

await scenario("C4 FUS-02: convergenza, qualunque sia l'ordine di fusione", async () => {
  const tab = new Orologio("tab1");
  const tel = new Orologio("tel2");
  const dalTablet = [
    evento(tab, "tab1", "note", "n1", "crea", { t: "A" }, 1000),
    evento(tab, "tab1", "tentativi", "t1", "crea", { esito: "corretto" }, 1500),
  ];
  const dalTelefono = [
    evento(tel, "tel2", "note", "n2", "crea", { t: "B" }, 1200),
    evento(tel, "tel2", "ripasso", "SQL-001", "aggiorna", { grado: 2 }, 1800),
  ];
  const tabletDopo = [...dalTablet, ...fondi(dalTablet, dalTelefono).nuovi];
  const telefonoDopo = [...dalTelefono, ...fondi(dalTelefono, dalTablet).nuovi];
  ok("stessa impronta", impronta(tabletDopo) === impronta(telefonoDopo), `${impronta(tabletDopo)} / ${impronta(telefonoDopo)}`);
  ok("nessun evento perso", tabletDopo.length === 4 && telefonoDopo.length === 4);
  uguali("stesso ordine causale",
    ordinaEventi(tabletDopo).map((e) => e.id),
    ordinaEventi(telefonoDopo).map((e) => e.id));
});

await scenario("C5 FUS-04: ripresa dopo una sincronizzazione interrotta", async () => {
  const tel = new Orologio("tel2");
  const dieci = [];
  for (let i = 0; i < 10; i++) dieci.push(evento(tel, "tel2", "note", `r${i}`, "crea", { i }, 1000 + i));
  const parziale = dieci.slice(0, 6);
  const dopoTranche = fondi([], parziale).nuovi;
  const f = fondi(dopoTranche, dieci);
  ok("solo i mancanti sono nuovi", f.nuovi.length === 4);
  ok("i gia' arrivati sono duplicati", f.duplicati === 6);
  ok("stato finale completo", [...dopoTranche, ...f.nuovi].length === 10);
});

await scenario("C6 DIFETTO RIPRODOTTO (FUS-05): stesso id, contenuto diverso, scartato in silenzio", async () => {
  const o = new Orologio("tab1");
  const locale = evento(o, "tab1", "note", "n1", "crea", { testo: "mio" }, 1000);
  const remotoFinto = { ...locale, payload: JSON.stringify({ testo: "sostituito" }) };
  const f = fondi([locale], [remotoFinto]);
  ok("nessun nuovo", f.nuovi.length === 0);
  ok("contato come duplicato qualunque", f.duplicati === 1);
  ok("nessun segnale separato: la forma dell'esito non ha un campo per questo",
     !Object.keys(f).includes("sospetti"));
  uguali("la proiezione conserva il valore locale",
    proietta([locale, ...f.nuovi], "note", "n1"), { testo: "mio" });
});

await scenario("C7 DIFETTO RIPRODOTTO (FUS-07): remoti null o undefined -> TypeError", async () => {
  // In useAutoSync il catch generico assorbe tutto: l'utente vede una
  // sincronizzazione fallita e nessun motivo.
  await lancia("undefined", async () => fondi([], undefined), "not iterable");
  await lancia("null", async () => fondi([], null), "not iterable");
  // I locali mancanti cadono prima, su .map
  await lancia("locali undefined", async () => fondi(undefined, []), "");
});

await scenario("C8 FUS-08: payload malformati non interrompono la fusione", async () => {
  const o = new Orologio("d1");
  const vuoto = evento(o, "d1", "note", "p1", "crea", "", 1000);
  const troncato = evento(o, "d1", "note", "p2", "crea", '{"a":', 1001);
  const array = evento(o, "d1", "note", "p3", "crea", "[1,2]", 1002);
  const f = fondi([], [vuoto, troncato, array]);
  ok("tutti e tre accettati come eventi", f.nuovi.length === 3);
  ok("nessun conflitto inventato", f.conflitti.length === 0);
  uguali("proietta salta il payload illeggibile", proietta([vuoto], "note", "p1"), null);
  uguali("e anche quello troncato", proietta([troncato], "note", "p2"), null);
  // Un array e' JSON valido: Object.keys lo accetta e i suoi indici diventano campi.
  uguali("l'array diventa un oggetto di indici", proietta([array], "note", "p3"), { 0: 1, 1: 2 });
});

await scenario("C9 DIFETTO RIPRODOTTO (FUS-08): payload 'null' fa cadere fondi()", async () => {
  // JSON.parse("null") riesce, quindi il try non scatta; poi Object.keys(null)
  // solleva FUORI dal try e l'intera fusione si ferma, perdendo anche gli
  // eventi validi dello stesso pacchetto.
  const o = new Orologio("d1");
  const nullo = evento(o, "d1", "note", "p4", "crea", "null", 1000);
  const buono = evento(o, "d1", "note", "p5", "crea", { t: "valido" }, 1001);
  await lancia("fondi cade", async () => fondi([], [nullo, buono]), "Cannot convert undefined or null to object");
  // proietta, invece, regge: lo spread di null e' un oggetto vuoto.
  uguali("proietta sopravvive", proietta([nullo], "note", "p4"), {});
  // Un evento 'elimina' con payload nullo non passa da Object.keys e non cade.
  const eliminaNullo = evento(o, "d1", "note", "p6", "elimina", "null", 1002);
  ok("un elimina con payload nullo non cade", fondi([], [eliminaNullo]).nuovi.length === 1);
});

await scenario("C10 FUS-09: sullo stesso campo vince l'HLC piu' alto", async () => {
  const tab = new Orologio("tab1");
  const tel = new Orologio("tel2");
  const primo = evento(tab, "tab1", "biblioteca", "v1", "aggiorna", { ultima_pagina: 10 }, 1000);
  const dopo = evento(tel, "tel2", "biblioteca", "v1", "aggiorna", { ultima_pagina: 44 }, 2000);
  uguali("vince il piu' recente", proietta([primo, dopo], "biblioteca", "v1"), { ultima_pagina: 44 });
  uguali("anche fondendo al contrario", proietta([dopo, primo], "biblioteca", "v1"), { ultima_pagina: 44 });
  const f = fondi([primo], [dopo]);
  ok("il conflitto e' segnalato", f.conflitti.length === 1);
  ok("con il dispositivo vincitore", f.conflitti[0].vincitore === "tel2");
});

await scenario("C11 DIFETTO RIPRODOTTO (FUS-10): un campo chiamato __eliminato confonde la fusione", async () => {
  const tab = new Orologio("tab1");
  const tel = new Orologio("tel2");
  const conCampoSentinella = evento(tab, "tab1", "note", "n1", "aggiorna", { __eliminato: false }, 1000);
  const eliminazioneVera = evento(tel, "tel2", "note", "n1", "elimina", {}, 2000);
  const f = fondi([conCampoSentinella], [eliminazioneVera]);
  ok("il campo legittimo e l'eliminazione sono lo stesso campo", f.conflitti.length === 1);
  ok("e il campo si chiama proprio __eliminato", f.conflitti[0].campo === "__eliminato");
});

await scenario("C12 FUS-11: eliminazione e riscrittura: la resurrezione e' PARZIALE", async () => {
  const o = new Orologio("tab1");
  const crea = evento(o, "tab1", "biblioteca", "v1", "crea", { titolo: "SQL Antipatterns", autore: "Karwin", pagine: 328 }, 1000);
  const elimina = evento(o, "tab1", "biblioteca", "v1", "elimina", {}, 2000);
  const riscrive = evento(o, "tab1", "biblioteca", "v1", "aggiorna", { ultima_pagina: 12 }, 3000);
  uguali("dopo l'eliminazione non c'e' nulla", proietta([crea, elimina], "biblioteca", "v1"), null);
  // proietta azzera lo stato a null: l'aggiornamento successivo riparte da zero
  // e titolo/autore/pagine NON tornano. Se non e' voluto, e' perdita silenziosa.
  uguali("la riscrittura riporta solo i campi del suo payload",
    proietta([crea, elimina, riscrive], "biblioteca", "v1"), { ultima_pagina: 12 });
  ok("titolo e autore sono persi", proietta([crea, elimina, riscrive], "biblioteca", "v1").titolo === undefined);
});

await scenario("C13 FUS-12: impronta, nei due versi", async () => {
  const o = new Orologio("tab1");
  const a = evento(o, "tab1", "note", "n1", "crea", {}, 1000);
  const b = evento(o, "tab1", "note", "n2", "crea", {}, 2000);
  ok("registro vuoto", impronta([]) === "0:0");
  ok("indipendente dall'ordine di ingresso", impronta([a, b]) === impronta([b, a]));
  ok("insiemi diversi, impronte diverse", impronta([a]) !== impronta([a, b]));
  ok("conta gli eventi nel prefisso", impronta([a, b]).startsWith("2:"));
});

await scenario("C14 FUS-13: ordinaEventi ordina e non muta, ma non e' un comparatore corretto", async () => {
  // I due eventi vanno generati in ordine CRESCENTE di ora fisica: l'orologio
  // non torna mai indietro, quindi chiedere prima 2000 e poi 1000 produrrebbe
  // due timbri entrambi a ms 2000, con il secondo piu' alto del primo.
  const o = new Orologio("tab1");
  const presto = evento(o, "tab1", "note", "a", "crea", {}, 1000);
  const tardi = evento(o, "tab1", "note", "z", "crea", {}, 2000);
  ok("il timbro cresce con l'ora fisica", presto.hlc < tardi.hlc);
  const ingresso = [tardi, presto];
  uguali("ordina per hlc", ordinaEventi(ingresso).map((e) => e.entita_id), ["a", "z"]);
  uguali("non muta l'ingresso", ingresso.map((e) => e.entita_id), ["z", "a"]);
  // Due elementi identici: il comparatore restituisce 1 invece di 0, contro il
  // contratto di Array.sort. Innocuo finche' gli id sono unici, ma e' una mina.
  const gemello = { ...presto };
  ok("due elementi identici non fanno cadere l'ordinamento",
     ordinaEventi([presto, gemello]).length === 2);
});

await scenario("C15 DIFETTO RIPRODOTTO (FUS-14): due dispositivi con lo stesso identificativo", async () => {
  // Scenario reale: ripristino da backup. I due dispositivi nascono con lo
  // stesso dispositivo_id, l'hlc lo contiene, l'id evento e' hlc:entita_id:
  // due eventi DIVERSI nello stesso ms e contatore diventano lo stesso id.
  const uno = new Orologio("gemello");
  const due = new Orologio("gemello");
  const suA = evento(uno, "gemello", "note", "n1", "crea", { testo: "scritto sul tablet" }, 1000);
  const suB = evento(due, "gemello", "note", "n1", "crea", { testo: "scritto sul telefono" }, 1000);
  ok("gli id collidono", suA.id === suB.id);
  const f = fondi([suA], [suB]);
  ok("il secondo e' contato come duplicato", f.duplicati === 1 && f.nuovi.length === 0);
  uguali("la nota del telefono sparisce senza avviso",
    proietta([suA, ...f.nuovi], "note", "n1"), { testo: "scritto sul tablet" });
  ok("nessun controllo rifiuta l'accoppiamento fra id uguali: fondi non guarda il mittente",
     f.conflitti.length === 0);
});

await scenario("C16 proietta: entita' sconosciuta, altre entita' ignorate, ultimo valore per campo", async () => {
  const o = new Orologio("tab1");
  const eventi = [
    evento(o, "tab1", "note", "n1", "crea", { titolo: "primo", testo: "x" }, 1000),
    evento(o, "tab1", "note", "n2", "crea", { titolo: "altra nota" }, 1100),
    evento(o, "tab1", "tentativi", "n1", "crea", { esito: "errato" }, 1200),
    evento(o, "tab1", "note", "n1", "aggiorna", { testo: "y" }, 1300),
  ];
  uguali("entita' mai vista", proietta(eventi, "note", "inesistente"), null);
  uguali("solo i propri eventi, ultimo valore per campo",
    proietta(eventi, "note", "n1"), { titolo: "primo", testo: "y" });
  uguali("stesso id ma altra entita' non si mescola",
    proietta(eventi, "tentativi", "n1"), { esito: "errato" });
  uguali("registro vuoto", proietta([], "note", "n1"), null);
});

// =========================================================================
// PARTE D — accoppiamento: il codice che l'utente trascrive a mano
// =========================================================================

const ALFABETO_CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

await scenario("D1 ACC-01: giro completo del codice, 32 caratteri piu' il controllo", async () => {
  const a = Accoppiamento.generaAccoppiamento();
  ok("segreto di 32 caratteri (160 bit)", a.segreto.length === 32, String(a.segreto.length));
  ok("codice formattato di 41 caratteri", a.codice.length === 41, String(a.codice.length));
  uguali("nove blocchi", a.codice.split("-").map((b) => b.length), [4, 4, 4, 4, 4, 4, 4, 4, 1]);
  ok("solo caratteri Crockford", [...a.segreto].every((c) => ALFABETO_CROCKFORD.includes(c)));
  ok("niente I, L, O, U", !/[ILOU]/.test(a.codice));
  const letto = Accoppiamento.leggiAccoppiamento(a.codice);
  ok("rilettura fedele", letto.segreto === a.segreto);
  ok("e stessa passphrase", Accoppiamento.passphraseDa(letto) === Accoppiamento.passphraseDa(a));
});

await scenario("D2 ACC-02: ogni sostituzione di un carattere viene intercettata", async () => {
  // La somma e' modulo 32 sull'indice di ogni carattere: cambiarne uno cambia
  // la somma, sempre. E' la garanzia forte di questo checksum.
  const a = Accoppiamento.generaAccoppiamento();
  const pulito = Accoppiamento.normalizza(a.codice);
  let accettate = 0;
  let provate = 0;
  for (let i = 0; i < pulito.length; i++) {
    for (const c of ALFABETO_CROCKFORD) {
      if (c === pulito[i]) continue;
      provate++;
      const rotto = pulito.slice(0, i) + c + pulito.slice(i + 1);
      try {
        Accoppiamento.leggiAccoppiamento(rotto);
        accettate++;
      } catch {
        // rifiutato: e' quello che deve succedere
      }
    }
  }
  ok("tutte le sostituzioni provate", provate === 33 * 31, String(provate));
  ok("nessuna sostituzione passa", accettate === 0, `${accettate} accettate`);
});

await scenario("D3 DIFETTO RIPRODOTTO (ACC-03): nessuna trasposizione viene intercettata", async () => {
  // checksum() calcola (somma*33 + indice + 1) % 32 e 33 e' congruo a 1 modulo
  // 32: la formula collassa in una SOMMA, insensibile all'ordine. Lo scambio di
  // due cifre e' l'errore di trascrizione piu' comune dopo la sostituzione.
  const a = Accoppiamento.generaAccoppiamento();
  const pulito = Accoppiamento.normalizza(a.codice);
  let accettate = 0;
  let provate = 0;
  // Solo le trasposizioni DENTRO il segreto (i due caratteri scambiati stanno
  // entrambi nei primi 32). L'ultima coppia e' un caso a se': li' si scambia un
  // carattere del segreto con quello di CONTROLLO, che nella somma non entra,
  // quindi quello scambio a volte viene intercettato. Il rischio vero sono le
  // 31 trasposizioni interne, ed e' quello che si misura qui.
  for (let i = 0; i + 1 < a.segreto.length; i++) {
    if (pulito[i] === pulito[i + 1]) continue;
    provate++;
    const scambiato = pulito.slice(0, i) + pulito[i + 1] + pulito[i] + pulito.slice(i + 2);
    try {
      Accoppiamento.leggiAccoppiamento(scambiato);
      accettate++;
    } catch {
      // mai
    }
  }
  ok("almeno venti trasposizioni interne provate", provate >= 20, String(provate));
  ok("TUTTE accettate come codice valido", accettate === provate, `${accettate} su ${provate}`);
  // La causa, isolata: la somma non dipende dall'ordine, quindi un segreto
  // completamente rimescolato passa con lo STESSO carattere di controllo.
  const rimescolato = [...a.segreto].reverse().join("");
  const controllo = pulito[pulito.length - 1];
  const letto = messaggioDiSincrono(() => Accoppiamento.leggiAccoppiamento(rimescolato + controllo));
  ok("perfino il segreto rovesciato passa con lo stesso controllo", letto === null, String(letto));
  // E il segreto ottenuto e' diverso: ogni scambio successivo fallira' con
  // "Passphrase errata", senza dire che la colpa e' della trascrizione.
  const scambiato = pulito.slice(0, 2) + pulito[3] + pulito[2] + pulito.slice(4);
  if (pulito[2] !== pulito[3]) {
    ok("e produce un segreto diverso da quello del pari",
       Accoppiamento.leggiAccoppiamento(scambiato).segreto !== a.segreto);
  } else {
    ok("e produce un segreto diverso da quello del pari", true);
  }
});

await scenario("D4 DIFETTO RIPRODOTTO (ACC-04): un codice troncato viene accettato", async () => {
  // leggiAccoppiamento controlla solo length >= 2 e non confronta mai con
  // LUNGHEZZA_SEGRETO: per OGNI troncamento esiste un carattere di controllo
  // che lo fa passare, e il segreto risultante ha meno entropia.
  const a = Accoppiamento.generaAccoppiamento();
  let lunghezzeAccettate = 0;
  for (let n = 1; n < 32; n++) {
    const parziale = a.segreto.slice(0, n);
    const passa = [...ALFABETO_CROCKFORD].some((c) => {
      try {
        return Accoppiamento.leggiAccoppiamento(parziale + c).segreto === parziale;
      } catch {
        return false;
      }
    });
    if (passa) lunghezzeAccettate++;
  }
  ok("ogni lunghezza di troncamento ha un controllo valido", lunghezzeAccettate === 31, String(lunghezzeAccettate));
  // Il caso estremo: un segreto di un solo carattere, cioe' 5 bit di entropia.
  const cortissimo = [...ALFABETO_CROCKFORD].find((c) => {
    try {
      return Accoppiamento.leggiAccoppiamento("0" + c).segreto === "0";
    } catch {
      return false;
    }
  });
  ok("perfino un segreto di un carattere e' accettato", cortissimo !== undefined);
});

await scenario("D5 ACC-05: caratteri estranei, due messaggi diversi per lo stesso errore", async () => {
  const a = Accoppiamento.generaAccoppiamento();
  const pulito = Accoppiamento.normalizza(a.codice);
  // ALFABETO.indexOf restituisce -1 e contribuisce 0: il piu' delle volte il
  // checksum non torna e si esce con "Codice non valido".
  const conDollaro = "$" + pulito.slice(1);
  const messaggio = await messaggioDi(() => Accoppiamento.leggiAccoppiamento(conDollaro));
  ok("rifiutato", messaggio !== null);
  ok("con uno dei due messaggi previsti",
     messaggio.includes("Codice non valido") || messaggio.includes("Carattere non valido"),
     String(messaggio));
  // Il secondo messaggio esiste davvero: si raggiunge quando il checksum torna
  // per caso. Lo si forza cercando il carattere di controllo giusto.
  const segretoStrano = "$" + pulito.slice(1, 32);
  const controllo = [...ALFABETO_CROCKFORD].find((c) => {
    const m = String(messaggioDiSincrono(() => Accoppiamento.leggiAccoppiamento(segretoStrano + c)));
    return m.includes("Carattere non valido");
  });
  ok("il secondo messaggio e' raggiungibile", controllo !== undefined);
});

function messaggioDiSincrono(azione) {
  try {
    azione();
    return null;
  } catch (e) {
    return String(e?.message ?? e);
  }
}

await scenario("D6 ACC-06: la passphrase derivata apre il pacchetto, un altro segreto no", async () => {
  const generato = Accoppiamento.generaAccoppiamento();
  const letto = Accoppiamento.leggiAccoppiamento(generato.codice.toLowerCase());
  const involucro = await cifra(impacchetta("tab1", []), Accoppiamento.passphraseDa(generato));
  const p = await decifra(involucro, Accoppiamento.passphraseDa(letto));
  ok("il pari apre il pacchetto", p.dispositivo === "tab1");
  const altro = Accoppiamento.generaAccoppiamento();
  await lancia("un altro accoppiamento non apre",
    () => decifra(involucro, Accoppiamento.passphraseDa(altro)), "Passphrase errata");
  ok("la passphrase e' il segreto, non il codice",
     Accoppiamento.passphraseDa(generato) === "percorso-v1:" + generato.segreto);
});

await scenario("D7 normalizza: minuscole, spazi, trattini, a capo, I/L/O/U", async () => {
  const n = Accoppiamento.normalizza;
  ok("minuscole", n("abcd") === "ABCD");
  ok("trattini e spazi", n("AB-CD EF") === "ABCDEF");
  ok("a capo finale (incollato dagli appunti)", n("ABCD\n") === "ABCD");
  ok("tabulazione", n("AB\tCD") === "ABCD");
  ok("I e L diventano 1", n("IL") === "11");
  ok("O diventa 0", n("OO") === "00");
  ok("U diventa V", n("U") === "V");
  ok("i caratteri estranei restano", n("$") === "$");
});

await scenario("D8 leggiAccoppiamento: codice vuoto, di un carattere, di soli trattini", async () => {
  await lancia("vuoto", async () => Accoppiamento.leggiAccoppiamento(""), "Codice troppo corto");
  await lancia("un carattere", async () => Accoppiamento.leggiAccoppiamento("A"), "Codice troppo corto");
  await lancia("solo trattini", async () => Accoppiamento.leggiAccoppiamento("----"), "Codice troppo corto");
  // Due caratteri superano la lunghezza minima e finiscono sul checksum.
  const m = await messaggioDi(async () => Accoppiamento.leggiAccoppiamento("00"));
  ok("due caratteri arrivano al checksum", m === null || m.includes("Codice non valido"), String(m));
});

await scenario("D9 DIFETTO RIPRODOTTO (ACC-08): il segnaposto della schermata promette 4 blocchi", async () => {
  // Non importo app/sync.tsx (il banco non ha react-native ne' expo-router):
  // ne leggo il TESTO, che e' quanto basta a confrontare il segnaposto con la
  // forma vera del codice. Un utente che si ferma dove finisce il segnaposto
  // produce esattamente il troncamento accettato in D4.
  const sorgente = readFileSync(join(RADICE_PROGETTO, "app", "sync.tsx"), "utf8");
  const trovato = sorgente.match(/placeholder="([^"]+)"/);
  ok("il segnaposto esiste", trovato !== null);
  const segnaposto = trovato ? trovato[1] : "";
  ok("il segnaposto e' XXXX-XXXX-XXXX-XXXX-X", segnaposto === "XXXX-XXXX-XXXX-XXXX-X", segnaposto);
  const vero = Accoppiamento.generaAccoppiamento().codice;
  ok("ma il codice vero e' piu' del doppio", vero.length === 41 && segnaposto.length === 21);
  ok("e ha nove blocchi invece di cinque",
     vero.split("-").length === 9 && segnaposto.split("-").length === 5);
});

// =========================================================================
// PARTE E — catena dei trasporti: i contorni non coperti da catena.test.ts
// =========================================================================

/** Trasporto finto, programmabile, con la forma dell'interfaccia vera. */
function trasportoFinto(nome, livello, opzioni = {}) {
  return {
    nome,
    livello,
    chiamate: [],
    async disponibilita() {
      this.chiamate.push("disponibilita");
      if (opzioni.disponibilitaSolleva) throw new Error(opzioni.disponibilitaSolleva);
      return opzioni.disponibile === false
        ? { disponibile: false, motivo: opzioni.motivo ?? "non installato", rimediabile: true }
        : { disponibile: true };
    },
    async scambia(daInviare) {
      this.chiamate.push("scambia");
      if (opzioni.scambiaSolleva) throw new Error(opzioni.scambiaSolleva);
      return {
        inviati: opzioni.inviati ?? daInviare.length,
        ricevuti: opzioni.ricevuti ?? [],
        trasporto: nome,
        durataMs: 1,
      };
    },
  };
}

await scenario("E1 DIFETTO RIPRODOTTO (CAT-02): soloLivello senza corrispondenza -> riassunto monco", async () => {
  const t = trasportoFinto("file cifrato", 3);
  const r = await Trasporto.sincronizza([t], [], { passphrase: "x", soloLivello: 1 });
  ok("nessun esito", r.esito === null);
  uguali("diario vuoto", r.diario, []);
  ok("il trasporto non e' stato nemmeno interrogato", t.chiamate.length === 0);
  const riassunto = Trasporto.riassumi(r.diario);
  ok("frase che finisce con uno spazio e nessuna spiegazione",
     riassunto === "Nessun trasporto ha funzionato. ", JSON.stringify(riassunto));
});

await scenario("E2 CAT-02: elenco di trasporti vuoto", async () => {
  const r = await Trasporto.sincronizza([], [], { passphrase: "x" });
  ok("nessun esito", r.esito === null);
  uguali("diario vuoto", r.diario, []);
});

await scenario("E3 CAT-03: un trasporto riuscito con zero ricevuti ferma la catena", async () => {
  // Indistinguibile da FIL-03/FIL-04, dove nulla e' stato davvero consegnato.
  const primo = trasportoFinto("prossimità", 1, { ricevuti: [] });
  const secondo = trasportoFinto("file cifrato", 3);
  const r = await Trasporto.sincronizza([secondo, primo], [], { passphrase: "x" });
  ok("esito valorizzato", r.esito !== null && r.esito.ricevuti.length === 0);
  ok("considerato riuscito", r.diario[0].esito === "riuscito");
  ok("il livello 3 non viene nemmeno provato", secondo.chiamate.length === 0);
  ok("il riassunto non nomina saltati", Trasporto.riassumi(r.diario).startsWith("Sincronizzato via prossimità"));
});

await scenario("E4 catena: due trasporti dello stesso livello, ordine di ingresso", async () => {
  const a = trasportoFinto("primo-a-pari-livello", 2);
  const b = trasportoFinto("secondo-a-pari-livello", 2);
  const r = await Trasporto.sincronizza([a, b], [], { passphrase: "x" });
  ok("vince quello passato per primo", r.esito.trasporto === "primo-a-pari-livello");
  ok("l'altro non viene toccato", b.chiamate.length === 0);
});

await scenario("E5 catena: sincronizza non muta l'elenco dei trasporti ricevuto", async () => {
  const alto = trasportoFinto("alto", 3);
  const basso = trasportoFinto("basso", 1);
  const elenco = [alto, basso];
  await Trasporto.sincronizza(elenco, [], { passphrase: "x" });
  uguali("ordine dell'ingresso intatto", elenco.map((t) => t.nome), ["alto", "basso"]);
});

await scenario("E6 catena: disponibilita' che solleva non ferma la catena", async () => {
  const rotto = trasportoFinto("prossimità", 1, { disponibilitaSolleva: "modulo esploso" });
  const buono = trasportoFinto("file cifrato", 3);
  const r = await Trasporto.sincronizza([rotto, buono], [], { passphrase: "x" });
  ok("si arriva al file", r.esito.trasporto === "file cifrato");
  ok("l'eccezione e' nel diario", r.diario[0].esito === "non verificabile");
  ok("con il testo dell'errore", r.diario[0].dettaglio.includes("modulo esploso"));
  ok("il riassunto nomina il saltato", Trasporto.riassumi(r.diario).includes("prossimità"));
});

await scenario("E7 catena: il numero di inviati dichiarato dal trasporto finisce nel diario", async () => {
  // E' il dato che useAutoSync IGNORA (vedi I7): qui si fissa che esiste.
  const t = trasportoFinto("prossimità", 1, { inviati: 2 });
  const r = await Trasporto.sincronizza([t], [{ id: "a" }, { id: "b" }, { id: "c" }], { passphrase: "x" });
  ok("l'esito riporta 2 inviati su 3 passati", r.esito.inviati === 2);
  ok("e il diario lo scrive", r.diario[0].dettaglio.startsWith("2 inviati"));
});

// =========================================================================
// PARTE F — trasporto 3 (file): l'unico che non puo' fallire
// =========================================================================

/** Ripulisce i giornali dei doppi fra un caso e l'altro. */
function azzeraDoppi() {
  Picker.azzera();
  Sharing.azzera();
}

await scenario("F1 FIL-01: il .pcs contiene SOLO l'involucro cifrato", async () => {
  azzeraDoppi();
  const tablet = new File3.TrasportoFile("tab1");
  const o = new Orologio("tab1");
  const eventi = [evento(o, "tab1", "note", "n1", "crea", { testo: "parola-che-non-deve-uscire" }, 1000)];
  const uri = await tablet.esporta(eventi, PASSPHRASE);
  const contenuto = readFileSync(fileURLToPath(uri), "utf8");

  ok("il file esiste", contenuto.length > 0);
  ok("nessun testo della nota", !contieneInChiaro(contenuto, "parola-che-non-deve-uscire"));
  ok("nessun nome di entita'", !contieneInChiaro(contenuto, "note"));
  ok("e' l'involucro previsto", JSON.parse(contenuto).formato === "percorso-sync");
  ok("il foglio di condivisione e' stato aperto",
     Sharing.giornale.some((v) => v.chiamata === "shareAsync" && v.url === uri));
  const p = await decifra(contenuto, PASSPHRASE);
  ok("e si riapre con la passphrase giusta", p.eventi.length === 1);
});

await scenario("F2 FIL: scambio completo fra due dispositivi attraverso il file", async () => {
  azzeraDoppi();
  const tablet = new File3.TrasportoFile("tab1");
  const telefono = new File3.TrasportoFile("tel2");
  const oTab = new Orologio("tab1");
  const oTel = new Orologio("tel2");
  const dalTablet = [evento(oTab, "tab1", "note", "n1", "crea", { t: "dal tablet" }, 1000)];
  const dalTelefono = [evento(oTel, "tel2", "tentativi", "t1", "crea", { esito: "corretto" }, 1100)];

  // Il tablet esporta; il telefono importa quel file.
  const uriTablet = await tablet.esporta(dalTablet, PASSPHRASE);
  Picker.programma({ percorsi: [fileURLToPath(uriTablet)] });
  const ricevutiDalTelefono = await telefono.importa(PASSPHRASE);
  uguali("il telefono riceve l'evento del tablet",
    ricevutiDalTelefono.map((e) => e.id), dalTablet.map((e) => e.id));

  // E viceversa.
  const uriTelefono = await telefono.esporta(dalTelefono, PASSPHRASE);
  Picker.programma({ percorsi: [fileURLToPath(uriTelefono)] });
  const ricevutiDalTablet = await tablet.importa(PASSPHRASE);
  uguali("il tablet riceve l'evento del telefono",
    ricevutiDalTablet.map((e) => e.id), dalTelefono.map((e) => e.id));

  // Fusione sui due lati: stesso stato.
  const tabletDopo = [...dalTablet, ...fondi(dalTablet, ricevutiDalTablet).nuovi];
  const telefonoDopo = [...dalTelefono, ...fondi(dalTelefono, ricevutiDalTelefono).nuovi];
  ok("convergono", impronta(tabletDopo) === impronta(telefonoDopo));
  ok("il selettore e' stato aperto con type '*/*'",
     Picker.giornale.every((v) => v.opzioni.type === "*/*"));
});

await scenario("F3 DIFETTO RIPRODOTTO (FIL-02): nome parlante e file che resta in cache", async () => {
  azzeraDoppi();
  const prima = fileNellaCache().length;
  const tablet = new File3.TrasportoFile("a1b2c3d4");
  const uri = await tablet.esporta([], PASSPHRASE);
  const nome = uri.split("/").pop();
  ok("il nome espone l'identificativo del dispositivo", nome.includes("a1b2c3d4"), nome);
  ok("e l'istante dell'esportazione", /percorso-a1b2c3d4-\d{10,}\.pcs$/.test(nome), nome);
  // Nessuna .delete() in lib/sync/file.ts: a differenza di lib/palestra.ts, che
  // ripulisce le proprie copie temporanee, qui ogni scambio lascia una copia.
  const dopo = fileNellaCache().length;
  ok("il file e' ancora li' dopo l'esportazione", dopo === prima + 1, `${prima} -> ${dopo}`);
  const secondo = await tablet.esporta([], PASSPHRASE);
  ok("e una seconda esportazione ne lascia un altro",
     fileNellaCache().length === prima + 2 && secondo !== uri);
});

await scenario("F4 DIFETTO RIPRODOTTO (FIL-03): senza foglio di condivisione lo scambio risulta riuscito", async () => {
  azzeraDoppi();
  Sharing.programmaDisponibilita(false);
  const tablet = new File3.TrasportoFile("tab1");
  const o = new Orologio("tab1");
  const daInviare = [evento(o, "tab1", "note", "n1", "crea", { t: "A" }, 1000)];
  // Il pari, per chiudere lo scambio, deve pur consegnare qualcosa.
  const telefono = new File3.TrasportoFile("tel2");
  const uriPari = await telefono.esporta([], PASSPHRASE);
  Picker.programma({ percorsi: [fileURLToPath(uriPari)] });

  const esito = await tablet.scambia(daInviare, { passphrase: PASSPHRASE });
  ok("nessuna condivisione aperta",
     !Sharing.giornale.some((v) => v.chiamata === "shareAsync"));
  ok("eppure lo scambio dichiara 1 inviato", esito.inviati === 1);
  ok("e la catena lo considera riuscito",
     (await Trasporto.sincronizza([tablet], daInviare, { passphrase: PASSPHRASE })) !== null);
  // Conseguenza a valle: useAutoSync marcherebbe sincronizzato = 1 un evento
  // che nessuno ha ricevuto (vedi I7).
  Sharing.programmaDisponibilita(true);
});

await scenario("F5 DIFETTO RIPRODOTTO (FIL-04): annullare il selettore produce uno scambio 'riuscito'", async () => {
  azzeraDoppi();
  const tablet = new File3.TrasportoFile("tab1");
  const o = new Orologio("tab1");
  const daInviare = [evento(o, "tab1", "note", "n1", "crea", { t: "A" }, 1000)];
  // Nessun esito programmato = l'utente annulla (comportamento del doppio).
  const esito = await tablet.scambia(daInviare, { passphrase: PASSPHRASE });
  uguali("nessun evento ricevuto", esito.ricevuti, []);
  ok("ma inviati dichiara comunque 1", esito.inviati === 1);
  const r = await Trasporto.sincronizza([tablet], daInviare, { passphrase: PASSPHRASE });
  ok("e la catena si ferma qui, dichiarando successo", r.esito !== null);
  ok("il diario dice 'riuscito'", r.diario[r.diario.length - 1].esito === "riuscito");
});

await scenario("F6 FIL-05: un pacchetto creato da questo stesso dispositivo viene rifiutato", async () => {
  azzeraDoppi();
  const tablet = new File3.TrasportoFile("tab1");
  const uri = await tablet.esporta([], PASSPHRASE);
  Picker.programma({ percorsi: [fileURLToPath(uri)] });
  await lancia("rifiutato con messaggio in italiano",
    () => tablet.importa(PASSPHRASE), "creato da questo stesso dispositivo");
});

await scenario("F7 FIL-05: eventi propri dentro il pacchetto del pari NON vengono rifiutati", async () => {
  // Il confronto e' su pacchetto.dispositivo, non sui singoli eventi: sono
  // eventi nostri che tornano indietro, e la deduplicazione per id li assorbe.
  azzeraDoppi();
  const telefono = new File3.TrasportoFile("tel2");
  const tablet = new File3.TrasportoFile("tab1");
  const o = new Orologio("tab1");
  const mioEvento = evento(o, "tab1", "note", "n1", "crea", { t: "mio" }, 1000);
  const uri = await telefono.esporta([mioEvento], PASSPHRASE);
  Picker.programma({ percorsi: [fileURLToPath(uri)] });
  const ricevuti = await tablet.importa(PASSPHRASE);
  ok("accettato", ricevuti.length === 1);
  ok("e la fusione lo riconosce come gia' visto", fondi([mioEvento], ricevuti).duplicati === 1);
});

await scenario("F8 DIFETTO RIPRODOTTO (FIL-06): con dispositivo vuoto il pacchetto del pari sembra proprio", async () => {
  // app/sync.tsx inizializza useAutoSync con "" prima che il kv-store risponda:
  // in quella finestra i pacchetti nascono con dispositivo: "".
  azzeraDoppi();
  const appenaAvviato = new File3.TrasportoFile("");
  const pariAppenaAvviato = new File3.TrasportoFile("");
  const uri = await pariAppenaAvviato.esporta([], PASSPHRASE);
  ok("il pacchetto dichiara un mittente vuoto",
     (await decifra(readFileSync(fileURLToPath(uri), "utf8"), PASSPHRASE)).dispositivo === "");
  Picker.programma({ percorsi: [fileURLToPath(uri)] });
  await lancia("scambiato per proprio e rifiutato",
    () => appenaAvviato.importa(PASSPHRASE), "creato da questo stesso dispositivo");
  ok("e il nome del file diventa 'percorso--<istante>.pcs'",
     uri.split("/").pop().startsWith("percorso--"), uri);
});

await scenario("F9 FIL-07: un file che non e' un pacchetto -> messaggio in italiano", async () => {
  azzeraDoppi();
  const finto = join(FS.percorsoDocumenti(), "manuale.pdf");
  writeFileSync(finto, "%PDF-1.7\n%finto documento di prova\n");
  Picker.programma({ percorsi: [finto] });
  const tablet = new File3.TrasportoFile("tab1");
  await lancia("respinto", () => tablet.importa(PASSPHRASE), "Il file non è un pacchetto di sincronizzazione");
  // Un JSON che non e' un involucro nostro: secondo messaggio previsto.
  const altroJson = join(FS.percorsoDocumenti(), "manifesto.json");
  writeFileSync(altroJson, JSON.stringify({ voci: [] }));
  Picker.programma({ percorsi: [altroJson] });
  await lancia("json estraneo respinto", () => tablet.importa(PASSPHRASE), "Formato non riconosciuto");
});

await scenario("F10 DIFETTO RIPRODOTTO (FIL-08): il trasporto file ignora timeoutMs", async () => {
  // L'interfaccia Trasporto prevede timeoutMs e useAutoSync passa 15.000 ms.
  // TrasportoFile.scambia non lo accetta nemmeno come parametro: la promessa
  // resta appesa finche' l'utente non compie i due gesti.
  azzeraDoppi();
  const tablet = new File3.TrasportoFile("tab1");
  const telefono = new File3.TrasportoFile("tel2");
  const uriPari = await telefono.esporta([], PASSPHRASE);
  // Il selettore "lento": risponde dopo 120 ms, molto oltre il timeout chiesto.
  Picker.programma(async () => {
    await new Promise((r) => setTimeout(r, 120));
    return { canceled: false, assets: [{ name: "pari.pcs", uri: uriPari, size: 1, mimeType: "application/octet-stream" }] };
  });
  const inizio = Date.now();
  const esito = await tablet.scambia([], { passphrase: PASSPHRASE, timeoutMs: 1 });
  const durata = Date.now() - inizio;
  ok("nessun annullamento: lo scambio riesce lo stesso", esito.trasporto === "file cifrato");
  ok("e ha atteso ben oltre il millisecondo chiesto", durata >= 100, `${durata} ms`);
});

await scenario("F11 FIL: disponibilita' onesta quando WebCrypto manca", async () => {
  const tablet = new File3.TrasportoFile("tab1");
  uguali("disponibile con WebCrypto", await tablet.disponibilita(), { disponibile: true });
  const ripristina = sostituisciCrypto({ getRandomValues: (b) => b });
  try {
    const stato = await tablet.disponibilita();
    ok("non disponibile senza subtle", stato.disponibile === false);
    ok("con motivo leggibile", stato.motivo === "WebCrypto non disponibile");
    ok("e dichiarato non rimediabile", stato.rimediabile === false);
  } finally {
    ripristina();
  }
});

// =========================================================================
// PARTE G — trasporti 1 e 2: assenza onesta, e nessuna uscita in chiaro
// =========================================================================

await scenario("G1 trasporti 1 e 2: senza modulo nativo sono onestamente assenti", async () => {
  const vicinanza = new Vicinanza.TrasportoVicinanza("tab1");
  const wifi = new Wifi.TrasportoWifi("tab1");
  const s1 = await vicinanza.disponibilita();
  ok("prossimita' non disponibile", s1.disponibile === false);
  ok("con motivo esplicito", s1.motivo === "modulo nativo non compilato");
  ok("ma rimediabile", s1.rimediabile === true);
  const s2 = await wifi.disponibilita();
  ok("wi-fi non disponibile", s2.disponibile === false);
  ok("con motivo esplicito", s2.motivo === "modulo server locale non installato");
  await lancia("e scambia() solleva invece di fingere",
    () => wifi.scambia([], { passphrase: PASSPHRASE }), "server locale non disponibile");
  await lancia("idem per la prossimita'",
    () => vicinanza.scambia([], { passphrase: PASSPHRASE }), "modulo prossimità non disponibile");
});

await scenario("G2 INV6-01: il trasporto prossimita' consegna solo cifrato", async () => {
  const consegnato = [];
  const o = new Orologio("tel2");
  const risposta = await cifra(
    impacchetta("tel2", [evento(o, "tel2", "note", "n2", "crea", { t: "dal pari" }, 1000)]),
    PASSPHRASE
  );
  Vicinanza.registraVicinanza({
    async permessiConcessi() { return true; },
    async richiediPermessi() { return true; },
    async connetti() { return "pari-1"; },
    async invia(pari, dati) { consegnato.push(dati); },
    async ricevi() { return risposta; },
    async disconnetti() { consegnato.push("disconnesso"); },
  });
  const t = new Vicinanza.TrasportoVicinanza("tab1");
  ok("ora e' disponibile", (await t.disponibilita()).disponibile === true);
  const oTab = new Orologio("tab1");
  const esito = await t.scambia(
    [evento(oTab, "tab1", "note", "n1", "crea", { t: "riservato-prossimita" }, 1000)],
    { passphrase: PASSPHRASE, timeoutMs: 15000 }
  );
  ok("quello che esce e' un involucro", JSON.parse(consegnato[0]).formato === "percorso-sync");
  ok("e non contiene il testo in chiaro", !contieneInChiaro(consegnato[0], "riservato-prossimita"));
  ok("il pari e' stato ricevuto e decifrato", esito.ricevuti.length === 1);
  ok("con disconnessione garantita dal finally", consegnato[consegnato.length - 1] === "disconnesso");
});

await scenario("G3 INV6-01: il trasporto wi-fi manda solo cifrato", async () => {
  const inviati = [];
  const o = new Orologio("tel2");
  const risposta = await cifra(impacchetta("tel2", [evento(o, "tel2", "note", "n2", "crea", {}, 1000)]), PASSPHRASE);
  let fermato = false;
  Wifi.registraServer({
    async avvia(porta, contenuto) { inviati.push({ dove: "server", contenuto }); return "http://127.0.0.1:" + porta; },
    async ferma() { fermato = true; },
  });
  const fetchOriginale = globalThis.fetch;
  globalThis.fetch = async (url, opzioni) => {
    inviati.push({ dove: String(url), contenuto: opzioni.body });
    return { ok: true, async text() { return risposta; } };
  };
  try {
    const t = new Wifi.TrasportoWifi("tab1");
    ok("ora e' disponibile", (await t.disponibilita()).disponibile === true);
    const oTab = new Orologio("tab1");
    const esito = await t.scambia(
      [evento(oTab, "tab1", "note", "n1", "crea", { t: "riservato-wifi" }, 1000)],
      { passphrase: PASSPHRASE, timeoutMs: 15000 }
    );
    ok("il contenuto servito e' cifrato", JSON.parse(inviati[0].contenuto).formato === "percorso-sync");
    ok("nessun testo in chiaro servito", !contieneInChiaro(inviati[0].contenuto, "riservato-wifi"));
    ok("nessun testo in chiaro nel corpo della POST", !contieneInChiaro(inviati[1].contenuto, "riservato-wifi"));
    ok("l'indirizzo e' locale, non internet", inviati[1].dove.startsWith("http://127.0.0.1:8787"));
    ok("il pari e' stato decifrato", esito.ricevuti.length === 1);
    ok("il server viene fermato dal finally", fermato === true);
  } finally {
    globalThis.fetch = fetchOriginale;
  }
});

await scenario("G4 INV6-01: nemmeno un HTTP fallito lascia uscire il chiaro", async () => {
  const corpi = [];
  Wifi.registraServer({
    async avvia(porta, contenuto) { corpi.push(contenuto); return "http://127.0.0.1:" + porta; },
    async ferma() {},
  });
  const fetchOriginale = globalThis.fetch;
  globalThis.fetch = async (url, opzioni) => {
    corpi.push(opzioni.body);
    return { ok: false, status: 500, async text() { return ""; } };
  };
  try {
    const t = new Wifi.TrasportoWifi("tab1");
    const oTab = new Orologio("tab1");
    await lancia("il trasporto fallisce",
      () => t.scambia([evento(oTab, "tab1", "note", "n1", "crea", { t: "riservato-500" }, 1000)],
                      { passphrase: PASSPHRASE }), "HTTP 500");
    ok("e nulla di quanto e' uscito era in chiaro",
       corpi.every((c) => !contieneInChiaro(c, "riservato-500")));
  } finally {
    globalThis.fetch = fetchOriginale;
  }
});

// =========================================================================
// PARTE H — politica automatica e divergenza (funzioni pure)
// =========================================================================

/** Stato completo con i valori piu' comuni, da modificare caso per caso. */
function stato(modifiche = {}) {
  return {
    inSospeso: 0,
    daUltimoScambioMs: 0,
    inPrimoPiano: true,
    accoppiato: true,
    inCorso: false,
    fallimentiConsecutivi: 0,
    batteriaBassa: false,
    ...modifiche,
  };
}

await scenario("H1 AUT-07: soglie esatte della politica automatica", async () => {
  // 25 eventi esatti con 90 s esatti trascorsi: la soglia e' >=, quindi tenta.
  const a = Auto.decidi(stato({ inSospeso: 25, daUltimoScambioMs: 90_000 }));
  ok("25 eventi e 90 s -> tenta", a.tenta === true && a.urgenza === "alta", JSON.stringify(a));
  // 90 s esatti con un solo evento: sotto tutte le altre soglie.
  const b = Auto.decidi(stato({ inSospeso: 1, daUltimoScambioMs: 90_000 }));
  ok("1 evento e 90 s -> nulla da scambiare", b.tenta === false && b.motivo === "nulla da scambiare", JSON.stringify(b));
  // Un millisecondo sotto il minimo: troppo recente.
  const c = Auto.decidi(stato({ inSospeso: 30, daUltimoScambioMs: 89_999 }));
  ok("89.999 ms -> scambio troppo recente", c.tenta === false && c.motivo === "scambio troppo recente");
  // 24 eventi non bastano per l'urgenza, ma il periodico scatta a 15 minuti.
  const d = Auto.decidi(stato({ inSospeso: 24, daUltimoScambioMs: 15 * 60_000 }));
  ok("24 eventi e 15 minuti -> periodico normale", d.tenta === true && d.urgenza === "normale");
  const e = Auto.decidi(stato({ inSospeso: 0, daUltimoScambioMs: 15 * 60_000 }));
  ok("nessun evento e 15 minuti -> si ritira dal pari", e.tenta === true && e.motivo.includes("ritiro"));
  // Batteria bassa: la soglia e' la stessa, 25 esatti passano.
  const f = Auto.decidi(stato({ inSospeso: 25, daUltimoScambioMs: 90_000, batteriaBassa: true }));
  ok("batteria bassa con 25 eventi -> tenta", f.tenta === true);
  const g = Auto.decidi(stato({ inSospeso: 24, daUltimoScambioMs: 90_000, batteriaBassa: true }));
  ok("batteria bassa con 24 eventi -> blocca", g.tenta === false && g.motivo.includes("batteria bassa"));
});

await scenario("H2 DIFETTO RIPRODOTTO (AUT-03): senza uno scambio riuscito il backoff non morde mai", async () => {
  // registraScambio(false) incrementa solo i fallimenti: daUltimoScambioMs resta
  // null finche' non c'e' un successo, e il controllo del backoff e'
  // condizionato a trascorso !== null. Con prossimita' e wi-fi assenti (il caso
  // di oggi, SYN-03) i tentativi ripartono a ogni ritorno in primo piano e ogni
  // 5 minuti, per sempre.
  for (const fallimenti of [1, 3, 9, 50]) {
    const d = Auto.decidi(stato({ daUltimoScambioMs: null, fallimentiConsecutivi: fallimenti }));
    ok(`con ${fallimenti} fallimenti consecutivi tenta comunque`, d.tenta === true, JSON.stringify(d));
    ok(`e lo dichiara urgente`, d.tenta && d.urgenza === "alta");
    ok(`con il motivo del primo scambio`, d.motivo === "primo scambio dopo l'accoppiamento");
  }
  // Il backoff calcolato ci sarebbe: e' il codice che non lo consulta.
  ok("attesaBackoff(9) vale il tetto di 30 minuti", Auto.attesaBackoff(9) === 30 * 60_000);
});

await scenario("H3 DIFETTO RIPRODOTTO (AUT-04): il backoff si misura dall'ultimo SUCCESSO", async () => {
  // Dopo un successo seguito da tre fallimenti rapidi, il tempo continua a
  // scorrere dal successo: la condizione trascorso < attesa smette di valere
  // quasi subito e il freno non morde piu'.
  const attesa = Auto.attesaBackoff(3); // 4 minuti
  const appenaFallito = Auto.decidi(stato({ inSospeso: 30, daUltimoScambioMs: attesa - 1, fallimentiConsecutivi: 3 }));
  ok("un millisecondo prima: bloccato", appenaFallito.tenta === false && appenaFallito.motivo.startsWith("backoff"));
  const subitoDopo = Auto.decidi(stato({ inSospeso: 30, daUltimoScambioMs: attesa, fallimentiConsecutivi: 3 }));
  ok("al millisecondo dopo: riparte, pur avendo appena fallito", subitoDopo.tenta === true);
  ok("attesaBackoff cresce", Auto.attesaBackoff(1) === 60_000 && Auto.attesaBackoff(2) === 120_000);
  ok("e si azzera a zero fallimenti", Auto.attesaBackoff(0) === 0 && Auto.attesaBackoff(-1) === 0);
});

await scenario("H4 DIFETTO RIPRODOTTO (AUT-05): un tempo trascorso negativo blocca tutto", async () => {
  // L'ora di sistema riportata indietro dopo uno scambio riuscito: Date.now()
  // meno il valore salvato diventa negativo.
  const d = Auto.decidi(stato({ inSospeso: 100, daUltimoScambioMs: -60 * 60_000 }));
  ok("bloccato", d.tenta === false);
  ok("con il motivo sbagliato", d.motivo === "scambio troppo recente");
  const v = Auto.valutaDivergenza(stato({ inSospeso: 3, daUltimoScambioMs: -60 * 60_000 }));
  ok("e la schermata mostra minuti negativi", v.minutiDaUltimoScambio === -60, String(v.minutiDaUltimoScambio));
});

await scenario("H5 DIFETTO RIPRODOTTO (AUT-06): '0 eventi da condividere' quando non c'e' nulla da condividere", async () => {
  const v = Auto.valutaDivergenza(stato({ inSospeso: 0, daUltimoScambioMs: 120 * 60_000 }));
  ok("livello leggera", v.livello === "leggera");
  ok("messaggio che non dice niente", v.messaggio === "0 eventi da condividere.", v.messaggio);
});

await scenario("H6 valutaDivergenza: i tre livelli e i loro confini", async () => {
  ok("non accoppiato -> marcata",
     Auto.valutaDivergenza(stato({ accoppiato: false })).livello === "marcata");
  ok("mai sincronizzato -> marcata",
     Auto.valutaDivergenza(stato({ daUltimoScambioMs: null })).messaggio.startsWith("Mai sincronizzato"));
  ok("zero eventi e 59 minuti -> allineati",
     Auto.valutaDivergenza(stato({ inSospeso: 0, daUltimoScambioMs: 59 * 60_000 })).livello === "allineati");
  ok("zero eventi e 60 minuti esatti -> non piu' allineati",
     Auto.valutaDivergenza(stato({ inSospeso: 0, daUltimoScambioMs: 60 * 60_000 })).livello === "leggera");
  ok("24 eventi e 239 minuti -> leggera",
     Auto.valutaDivergenza(stato({ inSospeso: 24, daUltimoScambioMs: 239 * 60_000 })).livello === "leggera");
  ok("24 eventi e 240 minuti esatti -> marcata",
     Auto.valutaDivergenza(stato({ inSospeso: 24, daUltimoScambioMs: 240 * 60_000 })).livello === "marcata");
  ok("25 eventi -> marcata anche subito dopo uno scambio",
     Auto.valutaDivergenza(stato({ inSospeso: 25, daUltimoScambioMs: 0 })).livello === "marcata");
  const m = Auto.valutaDivergenza(stato({ inSospeso: 30, daUltimoScambioMs: 300 * 60_000 }));
  ok("il messaggio marcato avverte del rischio concreto", m.messaggio.includes("esercizi già fatti"));
});

await scenario("H7 decidi: ordine delle guardie", async () => {
  // Non accoppiato vince su tutto, poi inCorso, poi il secondo piano.
  ok("non accoppiato prima di tutto",
     Auto.decidi(stato({ accoppiato: false, inCorso: true, inPrimoPiano: false })).motivo === "dispositivi non accoppiati");
  ok("in corso prima del secondo piano",
     Auto.decidi(stato({ inCorso: true, inPrimoPiano: false })).motivo === "scambio già in corso");
  ok("secondo piano prima della batteria",
     Auto.decidi(stato({ inPrimoPiano: false, batteriaBassa: true })).motivo === "app in secondo piano");
});

await scenario("H8 AUT-08: trasportiUtilizzabili, in aereo e non", async () => {
  uguali("tutto acceso", Auto.trasportiUtilizzabili({ internet: true, bluetooth: true, wifi: true }), [1, 2, 3]);
  uguali("in aereo con le radio riaccese", Auto.trasportiUtilizzabili({ internet: false, bluetooth: true, wifi: true }), [1, 2, 3]);
  uguali("radio spente: resta il file", Auto.trasportiUtilizzabili({ internet: false, bluetooth: false, wifi: false }), [3]);
  uguali("solo bluetooth", Auto.trasportiUtilizzabili({ internet: false, bluetooth: true, wifi: false }), [1, 3]);
  ok("il file c'e' sempre", Auto.trasportiUtilizzabili({ internet: true, bluetooth: false, wifi: false }).includes(3));
});

// =========================================================================
// PARTE I — stato su disco e applicazione del pacchetto (lib/db.ts vero)
// =========================================================================

// Da qui in poi serve il database vero: lib/db.ts e' un singoletto di modulo,
// quindi si apre UNA volta sola per tutto il processo.
await Db.apri("tab1");
const base = Db.database();

/**
 * La sequenza di useAutoSync, ricopiata riga per riga da lib/sync/useAutoSync.ts
 * (righe 46-63). L'hook non si puo' chiamare senza renderer, e `tenta` non e'
 * esportata: copiarla e' l'unico modo di provare cosa succede ai dati.
 * Se un domani l'hook cambiera', questa copia va riallineata: e' il prezzo.
 */
async function applicaComeUseAutoSync(ricevuti, daInviare) {
  // Prima riga del ramo `if (r.esito)`: l'orologio assorbe il tempo del
  // pacchetto. Era il difetto HLC-02, ora corretto, e la copia lo segue.
  await Db.assorbiRemoto(ricevuti.map((e) => e.hlc));
  const locali = await base.getAllAsync(
    "SELECT id, hlc, dispositivo, entita, entita_id, tipo, payload FROM eventi"
  );
  const f = fondi(locali, ricevuti);
  // `Db.inTransazione` e non `base.withTransactionAsync`: anche questa e'
  // com'e' oggi l'hook, dalla correzione della coda delle scritture.
  await Db.inTransazione(async (base) => {
    for (const e of f.nuovi) {
      await base.runAsync(
        `INSERT OR IGNORE INTO eventi
         (id, hlc, dispositivo, entita, entita_id, tipo, payload, sincronizzato)
         VALUES (?,?,?,?,?,?,?,1)`,
        [e.id, e.hlc, e.dispositivo, e.entita, e.entita_id, e.tipo, e.payload]
      );
    }
  });
  if (daInviare) await Db.segnaSincronizzati(daInviare.map((e) => e.id));
  return f;
}

await scenario("I1 stato: salvataggio, rilettura e cancellazione dell'accoppiamento", async () => {
  const a = Accoppiamento.generaAccoppiamento();
  await Stato.salvaAccoppiamento(a);
  const letto = await Stato.leggiAccoppiamentoSalvato();
  ok("riletto identico", letto.segreto === a.segreto && letto.codice === a.codice);
  ok("la passphrase corrente deriva da li'", (await Stato.passphraseCorrente()) === Accoppiamento.passphraseDa(a));
  await Stato.dimenticaAccoppiamento();
  ok("dopo il dimentica non c'e' piu' nulla", (await Stato.leggiAccoppiamentoSalvato()) === null);
  ok("e nemmeno una passphrase", (await Stato.passphraseCorrente()) === null);
});

await scenario("I2 INV6-01 (c): il segreto e' salvato in chiaro nel deposito chiave-valore", async () => {
  // L'invariante 6 riguarda i pacchetti, e quelli sono cifrati. La CHIAVE,
  // pero', sta in chiaro accanto a loro: chi legge il deposito apre tutto.
  const { deposito } = await import("../banco/kv-store-memoria.mjs");
  const a = Accoppiamento.generaAccoppiamento();
  await Stato.salvaAccoppiamento(a);
  const grezzo = deposito.get("accoppiamento");
  ok("la voce esiste", typeof grezzo === "string");
  ok("e contiene il segreto leggibile", grezzo.includes(a.segreto));
  ok("nessuna cifratura, nessun offuscamento", JSON.parse(grezzo).segreto === a.segreto);
});

await scenario("I3 DIFETTO RIPRODOTTO: registraScambio(false) non registra il momento del tentativo", async () => {
  const { deposito } = await import("../banco/kv-store-memoria.mjs");
  deposito.delete("ultimo_scambio");
  deposito.delete("fallimenti_consecutivi");
  await Stato.registraScambio(false);
  await Stato.registraScambio(false);
  ok("i fallimenti si contano", deposito.get("fallimenti_consecutivi") === "2");
  ok("ma l'istante del tentativo non viene mai scritto", deposito.get("ultimo_scambio") === undefined);
  const s = await Stato.statoCorrente();
  ok("quindi daUltimoScambioMs resta null", s.daUltimoScambioMs === null);
  ok("ed e' esattamente la condizione che disattiva il backoff (H2)",
     Auto.decidi({ ...s, accoppiato: true }).tenta === true);
  // Un successo, invece, scrive entrambe le cose e azzera i fallimenti.
  await Stato.registraScambio(true);
  ok("il successo scrive l'istante", Number(deposito.get("ultimo_scambio")) > 0);
  ok("e azzera i fallimenti", deposito.get("fallimenti_consecutivi") === "0");
});

await scenario("I4 statoCorrente: conta gli eventi in sospeso e legge il primo piano", async () => {
  const o = new Orologio("tab1");
  // Tre eventi locali scritti dal registro vero.
  for (const n of ["s1", "s2", "s3"]) {
    await Db.registra("note", n, "crea", { titolo: n }, async (d, hlc) => {
      await d.runAsync(
        "INSERT INTO note (id, titolo, testo, creato_a, hlc) VALUES (?,?,?,?,?)",
        [n, n, "", new Date().toISOString(), hlc]
      );
    });
  }
  const s = await Stato.statoCorrente();
  ok("tre eventi in sospeso", s.inSospeso === 3, String(s.inSospeso));
  ok("in primo piano", s.inPrimoPiano === true);
  RN.configuraStatoApp("background");
  ok("in secondo piano dopo il cambio", (await Stato.statoCorrente()).inPrimoPiano === false);
  RN.configuraStatoApp("active");
  ok("inCorso e batteria arrivano dal chiamante",
     (await Stato.statoCorrente(true, true)).inCorso === true);
  const d = await Stato.decisioneCorrente(true);
  ok("e la decisione li usa", d.tenta === false && d.motivo === "scambio già in corso");
  ok("divergenzaCorrente risponde senza sollevare",
     typeof (await Stato.divergenzaCorrente()).livello === "string");
  ok("orologio non toccato da questo scenario", o.corrente.ms === 0);
});

await scenario("I5 DIFETTO RIPRODOTTO (SCH-01): dimenticare l'accoppiamento non rimette in coda gli eventi", async () => {
  const daInviare = await Db.daSincronizzare();
  ok("ci sono eventi da inviare", daInviare.length >= 3);
  await Db.segnaSincronizzati(daInviare.map((e) => e.id));
  ok("dopo l'invio la coda e' vuota", (await Db.daSincronizzare()).length === 0);

  await Stato.salvaAccoppiamento(Accoppiamento.generaAccoppiamento());
  await Stato.dimenticaAccoppiamento();
  // dimenticaAccoppiamento tocca solo tre chiavi del kv-store: la colonna
  // sincronizzato resta a 1 e quegli eventi non ripartiranno mai piu'.
  ok("la coda resta vuota anche dopo aver dimenticato il pari",
     (await Db.daSincronizzare()).length === 0);
  const n = await base.getFirstAsync("SELECT count(*) AS n FROM eventi WHERE sincronizzato = 1");
  ok("gli eventi restano marcati come inviati", n.n >= 3, JSON.stringify(n));
  ok("un nuovo pari non ricevera' mai la storia pregressa", true);
});

await scenario("I6 DIFETTO RIPRODOTTO (SYN-01): gli eventi ricevuti non vengono MAI proiettati", async () => {
  // E' il difetto piu' grave della superficie. Qui si esegue la sequenza esatta
  // di useAutoSync su un pacchetto remoto che crea una nota.
  const tel = new Orologio("tel2");
  const remoto = evento(tel, "tel2", "note", "remota-1", "crea",
    { titolo: "Nota dal telefono", testo: "scritta sull'altro dispositivo" }, Date.now());

  const f = await applicaComeUseAutoSync([remoto], null);
  ok("l'evento remoto e' stato riconosciuto come nuovo", f.nuovi.length === 1);
  ok("ed entitaToccate lo dichiara", f.entitaToccate.length === 1 && f.entitaToccate[0].entita_id === "remota-1");

  const inRegistro = await base.getFirstAsync("SELECT count(*) AS n FROM eventi WHERE id = ?", [remoto.id]);
  ok("l'evento e' nel registro", inRegistro.n === 1);
  const inTabella = await base.getFirstAsync("SELECT count(*) AS n FROM note WHERE id = 'remota-1'");
  ok("ma la riga operativa NON esiste: la schermata Note non la vedra' mai", inTabella.n === 0);

  // La ricostruzione dal solo registro, invece, la vedrebbe: il dato c'e', e'
  // l'applicazione che manca.
  const tuttiGliEventi = await base.getAllAsync(
    "SELECT id, hlc, dispositivo, entita, entita_id, tipo, payload FROM eventi"
  );
  const ricostruita = proietta(tuttiGliEventi, "note", "remota-1");
  ok("proietta() saprebbe ricostruirla", ricostruita !== null && ricostruita.titolo === "Nota dal telefono");
  ok("ma proietta non e' chiamata da useAutoSync: entitaToccate resta inutilizzata", true);
});

await scenario("I7 DIFETTO RIPRODOTTO (SYN-04): segnaSincronizzati marca tutto, anche con inviati = 0", async () => {
  const o = new Orologio("tab1");
  await Db.registra("note", "perduta-1", "crea", { titolo: "non arrivera' mai" }, async (d, hlc) => {
    await d.runAsync(
      "INSERT INTO note (id, titolo, testo, creato_a, hlc) VALUES (?,?,?,?,?)",
      ["perduta-1", "non arrivera' mai", "", new Date().toISOString(), hlc]
    );
  });
  const daInviare = await Db.daSincronizzare();
  ok("l'evento e' in coda", daInviare.some((e) => e.entita_id === "perduta-1"));

  // Il trasporto dichiara ZERO inviati (il caso di FIL-03 e FIL-04): esito non
  // nullo, quindi useAutoSync marca comunque tutto quanto gli era stato dato.
  const trasporto = trasportoFinto("file cifrato", 3, { inviati: 0, ricevuti: [] });
  const r = await Trasporto.sincronizza([trasporto], daInviare, { passphrase: PASSPHRASE });
  ok("l'esito dichiara zero inviati", r.esito.inviati === 0);
  await applicaComeUseAutoSync(r.esito.ricevuti, daInviare);

  ok("eppure la coda e' vuota", (await Db.daSincronizzare()).length === 0);
  const riga = await base.getFirstAsync(
    "SELECT sincronizzato FROM eventi WHERE entita_id = 'perduta-1'"
  );
  ok("l'evento mai inviato risulta sincronizzato", riga.sincronizzato === 1);
  ok("e daSincronizzare() non lo restituira' mai piu': divergenza permanente",
     !(await Db.daSincronizzare()).some((e) => e.entita_id === "perduta-1"));
});

await scenario("I8 SYN-02 (registro): applicare due volte lo stesso pacchetto non duplica nulla", async () => {
  const tel = new Orologio("tel2");
  const remoti = [
    evento(tel, "tel2", "note", "remota-2", "crea", { titolo: "A" }, Date.now() + 1),
    evento(tel, "tel2", "note", "remota-3", "crea", { titolo: "B" }, Date.now() + 2),
  ];
  const prima = await base.getFirstAsync("SELECT count(*) AS n FROM eventi");
  const f1 = await applicaComeUseAutoSync(remoti, null);
  const f2 = await applicaComeUseAutoSync(remoti, null);
  const dopo = await base.getFirstAsync("SELECT count(*) AS n FROM eventi");
  ok("due nuovi la prima volta", f1.nuovi.length === 2);
  ok("zero nuovi la seconda", f2.nuovi.length === 0 && f2.duplicati === 2);
  ok("il registro e' cresciuto di due soli eventi", dopo.n === prima.n + 2, `${prima.n} -> ${dopo.n}`);
  const marcati = await base.getFirstAsync(
    "SELECT sincronizzato FROM eventi WHERE id = ?", [remoti[0].id]
  );
  ok("gli eventi ricevuti nascono gia' sincronizzati", marcati.sincronizzato === 1);
  ok("quindi non tornano al mittente", !(await Db.daSincronizzare()).some((e) => e.id === remoti[0].id));
});

await scenario("I9 SYN-09: un evento remoto con tipo fuori dal CHECK sparisce in silenzio", async () => {
  // La domanda aperta della mappa era: INSERT OR IGNORE ignora anche una
  // violazione di CHECK, o fa saltare l'intera transazione portandosi via gli
  // eventi validi dello stesso pacchetto? MISURATO QUI: la ignora come un
  // conflitto di chiave. La buona notizia e' che il resto del pacchetto entra;
  // la cattiva e' che l'evento illecito sparisce senza che nessuno lo sappia,
  // e il pari continuera' a credere di averlo consegnato.
  const tel = new Orologio("tel2");
  const cattivo = evento(tel, "tel2", "note", "cattiva", "sostituisci", { t: "x" }, Date.now() + 10);
  const buono = evento(tel, "tel2", "note", "buona", "crea", { titolo: "valida" }, Date.now() + 11);
  const prima = await base.getFirstAsync("SELECT count(*) AS n FROM eventi");
  let messaggio = null;
  try {
    await applicaComeUseAutoSync([cattivo, buono], null);
  } catch (e) {
    messaggio = String(e?.message ?? e);
  }
  const dopo = await base.getFirstAsync("SELECT count(*) AS n FROM eventi");
  const cattivoPresente = await base.getFirstAsync("SELECT count(*) AS n FROM eventi WHERE entita_id='cattiva'");
  const buonoPresente = await base.getFirstAsync("SELECT count(*) AS n FROM eventi WHERE entita_id='buona'");
  ok("l'evento con tipo illecito non entra mai", cattivoPresente.n === 0);
  ok("nessun errore risale al chiamante", messaggio === null, String(messaggio));
  ok("OR IGNORE assorbe il CHECK e l'evento valido entra", buonoPresente.n === 1);
  ok("il registro cresce di uno solo", dopo.n === prima.n + 1, `${prima.n} -> ${dopo.n}`);
  ok("e fondi() lo aveva dichiarato nuovo: i due conteggi divergono",
     (await applicaComeUseAutoSync([cattivo], null)).duplicati === 0);
});

await scenario("I10 DIFETTO RIPRODOTTO (SYN-02): la guardia inCorso e' alzata dopo due await", async () => {
  // Copia fedele dell'ordine di useAutoSync.tenta: il controllo del ref avviene
  // PRIMA di due await, e il ref viene alzato solo dopo. Due invocazioni
  // ravvicinate superano entrambe il controllo.
  const inCorso = { current: false };
  let scambiAvviati = 0;
  async function tentaComeHook() {
    if (inCorso.current) return "saltato";
    await Stato.decisioneCorrente(false); // primo await
    await Stato.passphraseCorrente(); // secondo await
    inCorso.current = true;
    try {
      scambiAvviati++;
      await new Promise((r) => setTimeout(r, 1));
    } finally {
      inCorso.current = false;
    }
    return "eseguito";
  }
  await Stato.salvaAccoppiamento(Accoppiamento.generaAccoppiamento());
  const esiti = await Promise.all([tentaComeHook(), tentaComeHook()]);
  uguali("entrambe passano la guardia", esiti, ["eseguito", "eseguito"]);
  ok("due scambi avviati insieme", scambiAvviati === 2);
  // E la decisione riceve sempre inCorso = false, quindi il ramo
  // "scambio già in corso" di decidi() non si attiva mai da qui.
  ok("decisioneCorrente e' chiamata con inCorso false",
     (await Stato.decisioneCorrente(false)).motivo !== "scambio già in corso");
});

await scenario("I11 CORRETTO (HLC-02): l'orologio locale assorbe il tempo del pacchetto ricevuto", async () => {
  // L'invariante 2 vuole che dopo una fusione l'orologio locale assorba l'HLC
  // ricevuto. Prima non lo faceva nessuno: Orologio.ricevi() era scritto,
  // collaudato in test/nucleo.test.ts, e senza un solo chiamante.
  const sorgenti = [];
  (function raccogli(cartella) {
    for (const voce of readdirSync(cartella, { withFileTypes: true })) {
      const percorso = join(cartella, voce.name);
      if (voce.isDirectory()) raccogli(percorso);
      else if (/\.tsx?$/.test(voce.name)) sorgenti.push(percorso);
    }
  })(join(RADICE_PROGETTO, "lib"));
  (function raccogli(cartella) {
    for (const voce of readdirSync(cartella, { withFileTypes: true })) {
      const percorso = join(cartella, voce.name);
      if (voce.isDirectory()) raccogli(percorso);
      else if (/\.tsx?$/.test(voce.name)) sorgenti.push(percorso);
    }
  })(join(RADICE_PROGETTO, "app"));

  // Attenzione a non confondere due "ricevi": lib/sync/vicinanza.ts chiama
  // `modulo.ricevi()`, che e' il modulo nativo di prossimita', non l'orologio.
  // Chi chiama Orologio.ricevi deve per forza nominare l'Orologio nel file.
  const chiamanti = sorgenti.filter((p) => {
    if (p.endsWith(join("lib", "db.ts"))) return false; // la definizione
    return /assorbiRemoto\s*\(/.test(readFileSync(p, "utf8"));
  });
  ok("almeno trenta sorgenti esaminate", sorgenti.length >= 30, String(sorgenti.length));
  // I chiamanti sono DUE, uno per ogni porta da cui entrano eventi di un altro
  // dispositivo: i tre trasporti locali (useAutoSync) e la copia remota su
  // Supabase (lib/nuvola/sincronia.ts). L'elenco resta esatto di proposito: un
  // TERZO chiamante e' quasi sempre una quarta porta aperta senza accorgersene,
  // e una porta che non assorbe l'orologio fa nascere ogni modifica successiva
  // piu' vecchia di quelle appena ricevute (invariante 2).
  uguali("i chiamanti sono le due sole porte da cui entrano eventi altrui",
    chiamanti.map((p) => p.replace(RADICE_PROGETTO + "/", "")).sort(),
    ["lib/nuvola/sincronia.ts", "lib/sync/useAutoSync.ts"]);
  ok("e assorbiRemoto passa da Orologio.ricevi, non da una copia sua",
     /orologio\.ricevi\(/.test(readFileSync(join(RADICE_PROGETTO, "lib", "db.ts"), "utf8")));
  // Il confronto e' con l'INSERIMENTO degli eventi ricevuti, non con la prima
  // inTransazione( del file: lib/nuvola/sincronia.ts ne apre una prima, per
  // scrivere lo stato dello scambio, e un confronto con quella misurerebbe
  // l'ordine sbagliato. Cio che deve venire dopo l'assorbimento e' l'uso degli
  // eventi altrui, ed e' li' che si guarda.
  for (const porta of [join("lib", "sync", "useAutoSync.ts"), join("lib", "nuvola", "sincronia.ts")]) {
    ok(`l'assorbimento avviene PRIMA di applicare gli eventi ricevuti (${porta})`,
       (() => {
         const testo = readFileSync(join(RADICE_PROGETTO, porta), "utf8");
         const assorbe = testo.indexOf("assorbiRemoto(");
         const applica = testo.indexOf("INSERT OR IGNORE INTO eventi");
         return assorbe >= 0 && applica >= 0 && assorbe < applica;
       })());
  }

  // Lo stesso scenario di prima, ma sul CODICE VERO: il pari ha l'ora avanti
  // di due ore, si fonde, poi si scrive in locale. Prima la scrittura locale,
  // pur successiva, nasceva con un HLC piu' basso e perdeva.
  const adesso = Date.now();
  const telefonoAvanti = new Orologio("tel2");
  const remoto = evento(telefonoAvanti, "tel2", "biblioteca", "v9", "aggiorna", { ultima_pagina: 200 }, adesso + 2 * 3600_000);

  const assorbito = await Db.assorbiRemoto([remoto.hlc]);
  ok("assorbiRemoto restituisce il nuovo stato dell'orologio", assorbito !== null && Number.isFinite(assorbito.ms));
  ok("l'orologio locale ha superato il remoto",
     assorbito.ms > HLC.deserializza(remoto.hlc).ms ||
     (assorbito.ms === HLC.deserializza(remoto.hlc).ms && assorbito.contatore > HLC.deserializza(remoto.hlc).contatore),
     `${JSON.stringify(assorbito)} contro ${remoto.hlc}`);
  ok("e l'identificativo resta QUESTO dispositivo, non quello remoto", assorbito.dispositivo === "tab1");

  // Persistenza, e va letta ADESSO: dopo la prima registra() locale meta('hlc')
  // sarebbe aggiornato comunque da quella, e il controllo non direbbe piu'
  // niente sull'assorbimento. L'orologio deve sopravvivere alla chiusura
  // dell'app anche se dopo la fusione non si scrive nient'altro.
  const salvato = await base.getFirstAsync("SELECT valore FROM meta WHERE chiave = 'hlc'");
  const [msSalvato] = salvato.valore.split("-");
  ok("meta('hlc') e' gia' al tempo assorbito, senza aspettare una scrittura locale",
     parseInt(msSalvato, 16) >= HLC.deserializza(remoto.hlc).ms, salvato.valore);

  const hlcLocale = await Db.registra("biblioteca", "v9", "aggiorna", { ultima_pagina: 201 }, async () => {});
  ok("la scrittura locale successiva ha un HLC piu' alto di quello remoto",
     hlcLocale > remoto.hlc, `${hlcLocale} contro ${remoto.hlc}`);
  const localeSerializzato = {
    id: `${hlcLocale}:v9`, hlc: hlcLocale, dispositivo: "tab1",
    entita: "biblioteca", entita_id: "v9", tipo: "aggiorna",
    payload: JSON.stringify({ ultima_pagina: 201 }),
  };
  uguali("e infatti la modifica locale VINCE, com'e' giusto che sia",
    proietta([remoto, localeSerializzato], "biblioteca", "v9"), { ultima_pagina: 201 });

  // La deriva fra i due dispositivi ora si vede: e' l'altra meta' di ricevi().
  ok("derivaSospetta() si alza dopo aver assorbito due ore di scarto", Db.derivaSospetta() === true);


  // Un hlc illeggibile non deve entrare nell'orologio: un NaN non ne uscirebbe
  // piu' e guasterebbe ogni timbro successivo.
  const primaDellaSpazzatura = Db.timbro();
  await Db.assorbiRemoto(["", "non-un-hlc", "zzzz-zzzz-tel2"]);
  const dopoLaSpazzatura = Db.timbro();
  ok("un hlc illeggibile viene saltato: l'orologio resta finito",
     Number.isFinite(dopoLaSpazzatura.ms) && Number.isFinite(dopoLaSpazzatura.contatore),
     JSON.stringify(dopoLaSpazzatura));
  ok("e non torna indietro", dopoLaSpazzatura.ms >= primaDellaSpazzatura.ms);
  ok("un pacchetto vuoto non tocca l'orologio", (await Db.assorbiRemoto([])) === null);

  // L'evento scritto qui sopra e' vero e resterebbe in coda: I12 conta quanti
  // eventi ci sono da inviare, e questo scenario non deve lasciargliene uno.
  await Db.segnaSincronizzati([localeSerializzato.id]);
});

await scenario("I12 daSincronizzare: ordine causale, limite e coda vuota", async () => {
  // Gli eventi gia' presenti sono tutti marcati; si riparte da una coda pulita.
  const o = new Orologio("tab1");
  for (let i = 0; i < 5; i++) {
    await Db.registra("note", `coda-${i}`, "crea", { i }, async (d, hlc) => {
      await d.runAsync(
        "INSERT INTO note (id, titolo, testo, creato_a, hlc) VALUES (?,?,?,?,?)",
        [`coda-${i}`, `coda ${i}`, "", new Date().toISOString(), hlc]
      );
    });
  }
  const coda = await Db.daSincronizzare();
  ok("cinque in coda", coda.length === 5, String(coda.length));
  const hlcOrdinati = coda.map((e) => e.hlc);
  uguali("in ordine di hlc crescente", hlcOrdinati, [...hlcOrdinati].sort());
  ok("il limite si rispetta", (await Db.daSincronizzare(2)).length === 2);
  await Db.segnaSincronizzati(coda.map((e) => e.id));
  uguali("coda vuota dopo l'invio", await Db.daSincronizzare(), []);
  await Db.segnaSincronizzati([]);
  ok("segnaSincronizzati([]) non solleva", true);
  await Db.segnaSincronizzati(["id-che-non-esiste"]);
  ok("un id inesistente non solleva", true);
});

// =========================================================================
// RIEPILOGO
// =========================================================================

const totali = scenari.length;
const passati = scenari.filter((s) => s.errori.length === 0).length;
const verifiche = scenari.reduce((n, s) => n + s.verifiche, 0);
const verificheFallite = scenari.reduce((n, s) => n + s.errori.length, 0);

console.log("");
for (const s of scenari) {
  if (s.errori.length === 0) {
    console.log(`  ok   ${s.nome}  (${s.verifiche})`);
  } else {
    console.log(`  NO   ${s.nome}`);
    for (const e of s.errori) console.log(`         ${e}`);
  }
}

const difetti = scenari.filter((s) => s.nome.includes("DIFETTO RIPRODOTTO"));
console.log("");
console.log(`DIFETTI DELL'APP RIPRODOTTI E NON CORRETTI: ${difetti.length}`);
for (const d of difetti) console.log(`  · ${d.nome.replace(/^\S+\s/, "")}`);

console.log("");
console.log(`Verifiche: passate ${verifiche - verificheFallite} su ${verifiche}`);
console.log(`passati ${passati} su ${totali}`);

// La cartella temporanea resta quando qualcosa e' rosso: dentro ci sono il
// database e i pacchetti .pcs da aprire per capire cosa e' successo.
if (passati === totali) {
  rmSync(RADICE, { recursive: true, force: true });
} else {
  console.log(`Cartella conservata per l'ispezione: ${RADICE}`);
}

process.exit(passati === totali ? 0 : 1);

/* ------------------------------------------------------------ FALSIFICAZIONE
 * Fatta, non immaginata: la ricetta completa e i numeri misurati sono in testa
 * a questo file, sotto "COME VERIFICARE CHE QUESTA PROVA NON SIA UN TIMBRO".
 * In breve: cifratura finta -> 14 scenari rossi; checksum reso posizionale
 * (cioe' difetto ACC-03 corretto) -> 1 scenario rosso, proprio quello che lo
 * riproduce. Esito dell'ultima esecuzione pulita: 91 scenari su 91, 341
 * verifiche su 341, 32 difetti dell'app riprodotti e non corretti.
 */
