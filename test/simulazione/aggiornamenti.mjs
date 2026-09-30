/**
 * SIMULAZIONE DEGLI AGGIORNAMENTI — lib/aggiornamenti.ts sopra il banco.
 *
 *   node test/simulazione/aggiornamenti.mjs
 *
 * Qui gira il CODICE VERO sopra expo-file-system, expo-intent-launcher e
 * kv-store doppiati, con `fetch` sostituito: nessuna rete, nessun GitHub.
 *
 * Le promesse che il modulo fa, e che si rompono in silenzio:
 *  - arriva solo una build di `main`, mai un esperimento di un ramo;
 *  - un telefono con la build più recente non si sente dire «aggiorna»;
 *  - in aereo il telefono ricorda che c'è un aggiornamento, invece di
 *    dimenticarlo al primo controllo fallito;
 *  - GitHub non viene interrogato a ogni apertura;
 *  - un APK scaricato a metà non arriva all'installatore;
 *  - l'installatore riceve il file con il permesso di leggerlo e il tipo giusto.
 */
import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const QUESTA_CARTELLA = dirname(fileURLToPath(import.meta.url));
const RADICE_PROGETTO = resolve(QUESTA_CARTELLA, "..", "..");

if (!process.env.BANCO_AGGIORNAMENTI_IN_CORSO) {
  const { variabileBanco } = await import("../banco/doppi-altri.mjs");
  const esito = spawnSync(
    process.execPath,
    ["--import", "./test/banco/carica.mjs", "test/simulazione/aggiornamenti.mjs"],
    {
      cwd: RADICE_PROGETTO,
      stdio: "inherit",
      env: { ...process.env, BANCO_AGGIORNAMENTI_IN_CORSO: "1", BANCO_DOPPI: variabileBanco() },
    }
  );
  process.exit(esito.status ?? 1);
}

// ================================================================= CONTEGGIO
let passate = 0;
const guasti = [];

function ok(nome, condizione, dettaglio = "") {
  if (condizione) passate++;
  else guasti.push(`${nome}${dettaglio ? "\n      " + dettaglio : ""}`);
}

function uguale(nome, ottenuto, atteso) {
  ok(nome, JSON.stringify(ottenuto) === JSON.stringify(atteso),
    `atteso  : ${JSON.stringify(atteso)}\n      ottenuto: ${JSON.stringify(ottenuto)}`);
}

// ================================================================= PREPARAZIONE
const { importaApp } = await import("../banco/carica.mjs");
const fs = await import("expo-file-system");
const intent = await import("expo-intent-launcher");
const kv = (await import("expo-sqlite/kv-store")).default;
const agg = await importaApp("lib/aggiornamenti.ts");

const URL_APK = (n) =>
  `https://github.com/stcportal00-star/Learning_app/releases/download/apk-${n}/percorso-${n}.apk`;

/** Una release come la restituisce l'API di GitHub, con i soli campi che contano. */
function release(n, campi = {}) {
  return {
    tag_name: `apk-${n}`, draft: false, prerelease: false,
    published_at: "2026-09-29T04:03:22Z",
    assets: [
      { name: "01-oggi.png", size: 36792, browser_download_url: `https://github.com/x/${n}.png` },
      { name: `percorso-${n}.apk`, size: 4096, browser_download_url: URL_APK(n) },
    ],
    ...campi,
  };
}

// L'elenco vero mescola tutto: build di main, build di rami (preliminari),
// e le release di servizio della conduttura.
const ELENCO = [
  release(31, { prerelease: true }),                 // un ramo, più recente di main
  { tag_name: "fonti", draft: false, prerelease: true, assets: [{ name: "stato-fonti.tar", size: 1, browser_download_url: "https://x/t" }] },
  { tag_name: "rassegna", draft: false, prerelease: false, assets: [{ name: "stato.tar", size: 1, browser_download_url: "https://x/s" }] },
  release(28),
  release(30, { draft: true }),                      // una bozza non esiste ancora
  release(27),
  { tag_name: "apk-29b", draft: false, prerelease: false, assets: [{ name: "x.apk", size: 1, browser_download_url: "https://x/y.apk" }] },
  release(29, { assets: [{ name: "01-oggi.png", size: 1, browser_download_url: "https://x/z.png" }] }), // senza APK
];

let chiamate = 0;
let rispostaRete = { stato: 200, corpo: ELENCO };
globalThis.fetch = async (url, opzioni = {}) => {
  chiamate++;
  const r = rispostaRete;
  if (r === "guasto") throw new TypeError("Network request failed");
  if (r === "muta") {
    // Una rete che non risponde mai: solo l'AbortController può chiudere.
    return new Promise((_, rifiuta) => {
      opzioni.signal?.addEventListener("abort", () => rifiuta(new Error("AbortError")));
    });
  }
  return {
    ok: r.stato >= 200 && r.stato < 300,
    status: r.stato,
    json: async () => r.corpo,
  };
};

async function azzera() {
  await kv.removeItem("aggiornamento_ultimo_controllo");
  chiamate = 0;
  rispostaRete = { stato: 200, corpo: ELENCO };
  intent.azzera();
  fs.azzeraRete();
}

// ================================================================= A1 numeri
uguale("A1 il numero di corsa si legge da tag e da extra",
  ["apk-27", "27", 27, " 27 ", "apk-27b", "", null, 0, -3, "build locale"].map(agg.numeroCorsa),
  [27, 27, 27, 27, null, null, null, null, null, null]);

// ================================================================= A2 quale release
// Solo `main`: preliminari, bozze, release di servizio e release senza APK
// restano fuori. Fra le buone vince il numero più alto, non la prima in elenco.
const scelta = agg.ultimaRelease(ELENCO);
uguale("A2 fra tutte vince la build di main con il numero più alto",
  scelta && [scelta.corsa, scelta.tag, scelta.url, scelta.byte], [28, "apk-28", URL_APK(28), 4096]);
// Una release rifatta a mano torna in cima all'elenco senza cambiare numero.
uguale("A2 vince il numero, non la posizione nell'elenco",
  agg.ultimaRelease([release(27), release(28)])?.corsa, 28);
uguale("A2 un elenco che non è un elenco non dà niente",
  [agg.ultimaRelease(null), agg.ultimaRelease({ message: "Not Found" }), agg.ultimaRelease([])],
  [null, null, null]);
uguale("A2 un indirizzo non https non si scarica",
  agg.ultimaRelease([release(40, { assets: [{ name: "p.apk", size: 1, browser_download_url: "http://x/p.apk" }] })]),
  null);

// ================================================================= A3 confronto
const c28 = { quando: 1, ultima: scelta };
uguale("A3 una build più vecchia vede l'aggiornamento",
  agg.confronta("27", c28).tipo, "disponibile");
uguale("A3 la stessa build è aggiornata",
  agg.confronta("28", c28).tipo, "aggiornata");
uguale("A3 una build di ramo più recente non torna indietro",
  agg.confronta("31", c28).tipo, "aggiornata");
uguale("A3 una build compilata a mano non si confronta",
  agg.confronta(null, c28).tipo, "locale");

// ================================================================= A4 controllo
await azzera();
uguale("A4 prima di ogni controllo lo stato è ignoto, senza rete",
  (await agg.statoNoto("27")).tipo, "ignoto");
uguale("A4 e leggerlo non chiama GitHub", chiamate, 0);

const T0 = 1_000_000_000_000;
let s = await agg.controlla("27", { adesso: T0 });
uguale("A4 il primo controllo chiede a GitHub e trova la 28",
  [s.tipo, s.tipo !== "ignoto" && s.ultima.corsa, chiamate], ["disponibile", 28, 1]);
uguale("A4 e lo stato noto adesso lo sa senza rete",
  (await agg.statoNoto("27")).tipo, "disponibile");

s = await agg.controlla("27", { adesso: T0 + agg.OGNI_MS - 1 });
uguale("A4 entro sei ore non si richiede a GitHub", [s.tipo, chiamate], ["disponibile", 1]);
const aMano = T0 + agg.OGNI_MS - 1;
s = await agg.controlla("27", { adesso: aMano, forza: true });
uguale("A4 a mano sì", chiamate, 2);
// Le sei ore ripartono dal controllo a mano: è l'ultima volta che si è chiesto.
s = await agg.controlla("27", { adesso: aMano + agg.OGNI_MS - 1 });
uguale("A4 e contano dall'ultimo controllo, anche se era a mano", chiamate, 2);
const dopoSei = aMano + agg.OGNI_MS;
s = await agg.controlla("27", { adesso: dopoSei });
uguale("A4 dopo sei ore di nuovo da solo", chiamate, 3);

// ================================================================= A5 in aereo
// Un controllo fallito non deve far dimenticare quello buono: in aereo il
// telefono deve continuare a sapere che all'arrivo c'è da installare.
rispostaRete = "guasto";
const scaduto = dopoSei + agg.OGNI_MS + 5;
s = await agg.controlla("27", { adesso: scaduto });
uguale("A5 senza rete si ricorda l'aggiornamento trovato prima", s.tipo, "disponibile");
uguale("A5 e il ricordo non viene sovrascritto", (await agg.ultimoControllo()).quando, dopoSei);
// Il fallimento non conta come controllo: se contasse, questo tentativo
// cinque millisecondi dopo aspetterebbe altre sei ore.
const primaDelGuasto = chiamate;
await agg.controlla("27", { adesso: scaduto + 5 });
uguale("A5 e il tentativo dopo non aspetta sei ore", chiamate, primaDelGuasto + 1);

// Una risposta buona senza build di main non è una notizia: trenta build di
// ramo di fila, o le release apk-* cancellate a mano. Il ricordo resta, e con
// lui il freno delle sei ore.
rispostaRete = { stato: 200, corpo: Array.from({ length: 30 }, (_, i) => release(40 + i, { prerelease: true })) };
const soloRami = scaduto + agg.OGNI_MS;
s = await agg.controlla("27", { adesso: soloRami });
uguale("A5 una pagina di sole build di ramo non fa dimenticare la 28",
  [s.tipo, s.tipo !== "ignoto" && s.ultima.corsa, (await agg.statoNoto("27")).tipo], ["disponibile", 28, "disponibile"]);
const primaDelFreno = chiamate;
await agg.controlla("27", { adesso: soloRami + 1000 });
uguale("A5 e il freno delle sei ore resta", chiamate, primaDelFreno);
ok("A5 e si chiede la pagina più lunga che GitHub concede", /per_page=100\b/.test(agg.ELENCO_RELEASE), agg.ELENCO_RELEASE);

// Un orologio che era avanti e poi è tornato giusto: l'ultimo controllo sta nel
// futuro. Vale come scaduto, altrimenti niente controlli fino a quella data.
rispostaRete = { stato: 200, corpo: ELENCO };
const primaDelFuturo = chiamate;
await agg.controlla("27", { adesso: soloRami - 3 * 24 * 3600 * 1000 });
uguale("A5 un controllo datato nel futuro non ferma quelli di oggi", chiamate, primaDelFuturo + 1);

await azzera();
rispostaRete = "guasto";
s = await agg.controlla("27");
uguale("A5 senza ricordo e senza rete: ignoto, con il motivo",
  [s.tipo, s.motivo], ["ignoto", "rete non raggiungibile"]);
rispostaRete = { stato: 403, corpo: { message: "API rate limit exceeded" } };
s = await agg.controlla("27");
ok("A5 il limite di richieste si dice per quello che è",
  s.tipo === "ignoto" && /limite di richieste/.test(s.motivo), JSON.stringify(s));
rispostaRete = { stato: 200, corpo: "<html>pagina di un captive portal</html>" };
s = await agg.controlla("27");
uguale("A5 una risposta che non è un elenco non inventa una release",
  [s.tipo, s.motivo], ["ignoto", "nessuna build di main pubblicata"]);

await azzera();
rispostaRete = "muta";
const inizio = Date.now();
s = await agg.controlla("27", { tempoMaxMs: 50 });
ok("A5 una rete muta si abbandona al tempo massimo",
  s.tipo === "ignoto" && s.motivo === "GitHub non ha risposto in tempo" && Date.now() - inizio < 2000,
  JSON.stringify(s));

// ================================================================= A6 scarico
await azzera();
const r28 = agg.ultimaRelease(ELENCO);
fs.rispondi(URL_APK(28), Buffer.alloc(4096, 1));
const giusto = await agg.scaricaRelease(r28);
ok("A6 lo scarico completo dà un file", !!giusto.uri && new fs.File(giusto.uri).exists, JSON.stringify(giusto));
uguale("A6 con il nome della build", giusto.uri && giusto.uri.endsWith("percorso-28.apk"), true);

fs.rispondi(URL_APK(28), Buffer.alloc(1000, 1));
const troncato = await agg.scaricaRelease(r28);
ok("A6 uno scarico a metà si dice, e il file sparisce",
  !troncato.uri && /incompleto/.test(troncato.errore ?? "")
  && !new fs.File(agg.cartellaAggiornamenti(), "percorso-28.apk").exists,
  JSON.stringify(troncato));

fs.guastaRete(URL_APK(28), "rete non raggiungibile");
const fallito = await agg.scaricaRelease(r28);
ok("A6 uno scarico fallito non lascia un file né un uri",
  !fallito.uri && /non riuscito/.test(fallito.errore ?? ""), JSON.stringify(fallito));

// ================================================================= A7 installatore
await azzera();
fs.rispondi(URL_APK(28), Buffer.alloc(4096, 1));
const pronto = await agg.scaricaRelease(r28);
uguale("A7 l'APK va all'installatore", await agg.installa(pronto.uri), "aperto");
const chiamata = intent.giornale.at(-1);
uguale("A7 con VIEW, il tipo di un APK e il permesso di leggerlo",
  chiamata && [chiamata.azione, chiamata.parametri.type, chiamata.parametri.flags],
  ["android.intent.action.VIEW", "application/vnd.android.package-archive", 1]);
ok("A7 e un uri che l'installatore può aprire",
  typeof chiamata?.parametri.data === "string" && chiamata.parametri.data.length > 0,
  JSON.stringify(chiamata?.parametri));
uguale("A7 un file sparito non apre niente", await agg.installa(pronto.uri + ".no"), "mancante");
intent.programmaNessunVisore();
uguale("A7 un installatore che rifiuta si dice", await agg.installa(pronto.uri), "errore");

// ================================================================= A8 pulizia
// Sessanta megabyte l'uno: dopo l'installazione non servono più. Ma senza
// numero di corsa non si sa che cosa è installato, e non si cancella niente.
await azzera();
for (const n of [26, 27, 28]) {
  new fs.File(agg.cartellaAggiornamenti(), `percorso-${n}.apk`).write(Buffer.alloc(10));
}
uguale("A8 una build locale non cancella niente", agg.liberaScaricati(null), 0);
uguale("A8 la build 27 cancella la 26 e sé stessa, non la 28", agg.liberaScaricati("27"), 2);
uguale("A8 resta solo la 28",
  agg.cartellaAggiornamenti().list().map((f) => f.name).sort(), ["percorso-28.apk"]);
// Installata la 28 all'aeroporto, e poi niente rete per settimane: la pulizia
// non deve aspettare un controllo riuscito, le basta sapere quale build gira.
rispostaRete = "guasto";
await agg.controlla("28");
uguale("A8 dopo l'installazione l'APK si cancella anche senza rete",
  agg.cartellaAggiornamenti().list().map((f) => f.name), []);

uguale("A9 i megabyte si dicono tondi", [agg.megabyte(58085325), agg.megabyte(0)],
  ["58 MB", "dimensione sconosciuta"]);

// ================================================================= ESITO
if (guasti.length) {
  console.log("SIMULAZIONE DEGLI AGGIORNAMENTI: ROSSA\n");
  for (const g of guasti) console.log("  ✗ " + g);
  console.log(`\n${passate} verifiche passate, ${guasti.length} fallite`);
  process.exit(1);
}
console.log(`${passate} verifiche passate`);
