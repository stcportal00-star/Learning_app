/**
 * CONTROPROVA AVVERSARIALE del difetto HLC-02, lente "CONSEGUENZA".
 *
 * L'accusa (lib/sync/useAutoSync.ts:61): `Orologio.ricevi()` non e' chiamato da
 * nessuna parte, quindi dopo un pacchetto remoto con HLC piu' avanti del proprio
 * l'orologio locale resta indietro e "la modifica locale piu' recente perde".
 *
 * Che `ricevi()` sia codice morto e' gia' stato misurato altrove ed e' VERO.
 * Qui non si rimisura il meccanismo: si misura se la CONSEGUENZA dichiarata —
 * l'utente perde una modifica — puo' raggiungere l'utente in aereo, su un
 * telefono e un tablet, seguendo l'app COME E' FATTA OGGI.
 *
 * PERCHE' QUESTA FORMA: una perdita di dati non e' un fatto locale di hlc.ts.
 * E' una catena, e basta un anello aperto perche' non arrivi a nessuno. Gli
 * anelli sono cinque e qui si prova ad aprirne almeno uno:
 *
 *   A1  lo scambio deve poter avvenire su un dispositivo vero;
 *   A2  il valore remoto deve arrivare in cio' che una schermata LEGGE;
 *   A3  la deriva fra i due orologi deve coprire il tempo di reazione umano;
 *   A4  i due dispositivi devono aver toccato lo STESSO campo della STESSA
 *       entita' (altrimenti la fusione non confronta nulla);
 *   A5  qualcuno deve accorgersene, cioe' il danno deve essere osservabile.
 *
 * Gira il codice VERO — lib/db.ts, lib/hlc.ts, lib/sync/fusione.ts — sul banco
 * node:sqlite. `useAutoSync` non e' importabile (hook React + react-native),
 * quindi il blocco che applica il pacchetto e' ricopiato dalle sue righe 46-63
 * e il passo A2.0 verifica che la copia sia ancora fedele all'originale.
 *
 *   node test/simulazione/controprova-HLC-02-conseguenza.mjs
 *
 * Nessun file del progetto viene toccato: solo letture.
 */
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const QUESTA_CARTELLA = dirname(fileURLToPath(import.meta.url));
const RADICE = resolve(QUESTA_CARTELLA, "..", "..");

// Il banco si registra con --import: se si e' partiti senza, ci si riavvia da
// soli, cosi' il file gira anche con un `node` nudo.
if (!process.env.CONTROPROVA_HLC02_CONSEGUENZA) {
  const esito = spawnSync(
    process.execPath,
    ["--import", "./test/banco/carica.mjs", "test/simulazione/controprova-HLC-02-conseguenza.mjs"],
    { cwd: RADICE, stdio: "inherit", env: { ...process.env, CONTROPROVA_HLC02_CONSEGUENZA: "1" } }
  );
  process.exit(esito.status ?? 1);
}

const { configuraCartella } = await import("../banco/expo-sqlite.mjs");
const HLC = await import(pathToFileURL(join(RADICE, "lib/hlc.ts")).href);
const Fusione = await import(pathToFileURL(join(RADICE, "lib/sync/fusione.ts")).href);

// ------------------------------------------------------------------ CONTEGGIO
// `aperto` = l'anello della catena NON si chiude: la conseguenza non arriva
// all'utente, e l'app e' assolta su quel punto.
const aperti = [];
const chiusi = [];
const misure = [];

function anello(nome, aperto, dettaglio = "") {
  (aperto ? aperti : chiusi).push(`${nome}${dettaglio ? " — " + dettaglio : ""}`);
  console.log(`  ${aperto ? "APERTO " : "chiuso "}  ${nome}${dettaglio ? "  [" + dettaglio + "]" : ""}`);
}
function misura(nome, valore) {
  misure.push(`${nome}: ${valore}`);
  console.log(`  misura    ${nome}: ${valore}`);
}

// ------------------------------------------------------------------ SORGENTI
const sorgenti = [];
for (const radice of ["lib", "app", "components"]) {
  (function raccogli(c) {
    for (const v of readdirSync(c, { withFileTypes: true })) {
      const p = join(c, v.name);
      if (v.isDirectory()) raccogli(p);
      else if (/\.tsx?$/.test(v.name)) sorgenti.push(p);
    }
  })(join(RADICE, radice));
}
const testoDi = new Map(sorgenti.map((p) => [p.replace(RADICE + "/", ""), readFileSync(p, "utf8")]));

const RADICE_TEMP = mkdtempSync(join(tmpdir(), "controprova-hlc02-cons-"));
let istanze = 0;
async function avvia(dispositivo) {
  istanze++;
  configuraCartella(join(RADICE_TEMP, "avvio-" + istanze));
  const app = await import(pathToFileURL(join(RADICE, "lib/db.ts")).href + `?istanza=${istanze}`);
  await app.apri(dispositivo);
  return app;
}

console.log("\nCONTROPROVA HLC-02 — lente CONSEGUENZA");
console.log("la catena che deve chiudersi perche' l'utente perda una modifica\n");

// =========================================================================
// A1. Lo scambio puo' avvenire su un dispositivo vero?
// =========================================================================
console.log("A1. lo scambio: quali trasporti esistono davvero a runtime");

const autoSync = testoDi.get("lib/sync/useAutoSync.ts");
// I trasporti 1 e 2 funzionano solo se un modulo nativo si e' registrato.
// Se nessuno chiama registraVicinanza/registraServer, disponibilita() risponde
// sempre "non disponibile" e la catena scende al 3.
const registrazioni = [];
for (const [file, testo] of testoDi) {
  if (file === "lib/sync/vicinanza.ts" || file === "lib/sync/wifi.ts" || file === "lib/sync/index.ts") continue;
  for (const nome of ["registraVicinanza", "registraServer"]) {
    if (new RegExp(`\\b${nome}\\s*\\(`).test(testo)) registrazioni.push(`${file} -> ${nome}`);
  }
}
misura("chiamate a registraVicinanza/registraServer fuori dalle definizioni", registrazioni.length + (registrazioni.length ? " (" + registrazioni.join(", ") + ")" : ""));

// Il trasporto 3 (file cifrato) entra nella catena solo se `forzato`.
const fileSoloSeForzato = /forzato \? \[new TrasportoFile/.test(autoSync);
misura("TrasportoFile entra in catena solo quando forzato", String(fileSoloSeForzato));
misura("chi monta useAutoSync", [...testoDi].filter(([f, t]) => f !== "lib/sync/useAutoSync.ts" && /useAutoSync\s*\(/.test(t)).map(([f]) => f).join(", ") || "nessuno");

const nessunTrasportoAutomatico = registrazioni.length === 0 && fileSoloSeForzato;
anello(
  "A1 lo scambio avviene da solo, senza che l'utente lo chieda",
  nessunTrasportoAutomatico,
  nessunTrasportoAutomatico
    ? "no: prossimita' e wi-fi non sono mai registrati, resta solo il file cifrato a due tocchi dalla schermata Sincronizzazione"
    : "si': almeno un trasporto automatico e' vivo"
);

// =========================================================================
// A2. Il valore remoto arriva in cio' che una schermata legge?
// =========================================================================
console.log("\nA2. dal pacchetto ricevuto a cio' che l'utente vede");

// A2.0 — la copia del blocco di useAutoSync e' ancora fedele?
const copiaFedele = /inTransazione\(/.test(autoSync) && /INSERT OR IGNORE\s+INTO eventi/.test(autoSync.replace(/\s+/g, " "));
misura("la copia del blocco di useAutoSync e' fedele all'originale", String(copiaFedele));
if (!copiaFedele) console.log("      ATTENZIONE: useAutoSync e' cambiato, le misure sotto vanno rilette.");

// A2.1 — chi, in lib/ e app/, legge la tabella `eventi`?
const lettoriEventi = [];
for (const [file, testo] of testoDi) {
  const righe = testo.split("\n");
  for (let i = 0; i < righe.length; i++) {
    if (/FROM\s+eventi\b/i.test(righe[i])) lettoriEventi.push(`${file}:${i + 1}`);
  }
}
console.log("      lettori della tabella eventi: " + lettoriEventi.join(", "));

// A2.2 — chi chiama proietta(), l'unica funzione che ricostruisce un'entita'
// dal registro applicando la regola "vince l'HLC piu' alto"?
const chiamanti = [];
for (const [file, testo] of testoDi) {
  if (file === "lib/sync/fusione.ts") continue;
  if (/\bproietta\s*\(/.test(testo)) chiamanti.push(file);
}
misura("chiamanti di proietta() in lib/ e app/", chiamanti.length ? chiamanti.join(", ") : "NESSUNO");

// A2.3 — le schermate leggono tabelle operative o il registro?
const tabelleLette = new Set();
for (const [file, testo] of testoDi) {
  if (!file.startsWith("app/") && !file.startsWith("components/")) continue;
  for (const m of testo.matchAll(/FROM\s+([a-z_]+)/gi)) tabelleLette.add(m[1].toLowerCase());
}
misura("tabelle lette dalle schermate", [...tabelleLette].sort().join(", "));

// -------------------- la prova a codice vero --------------------
// Si ricostruisce lo scenario dell'accusa nella sua versione piu' favorevole
// all'accusa: il tablet remoto ha l'orologio 90 minuti AVANTI, cosi' l'HLC
// remoto batte qualunque timbro locale fatto subito dopo.
const app = await avvia("telefono1");
const d = app.database();

async function segnaPagina(pagina) {
  return app.registra("biblioteca", "vol1", "aggiorna", { ultima_pagina: pagina }, async (dd, hlc) => {
    await dd.runAsync(
      `INSERT INTO biblioteca (id, titolo, origine, aggiunto_a, ultima_pagina, hlc)
       VALUES (?,?,?,?,?,?)
       ON CONFLICT (id) DO UPDATE SET ultima_pagina = excluded.ultima_pagina, hlc = excluded.hlc`,
      ["vol1", "Manuale di campo", "aperta", new Date().toISOString(), pagina, hlc]
    );
  });
}

await segnaPagina(120); // l'utente legge fino a pagina 120 sul telefono

// Il pacchetto del tablet: stesso volume, stesso campo, orologio 90 min avanti.
const orologioTablet = new HLC.Orologio("tablet2");
const hTablet = orologioTablet.adesso(Date.now() + 90 * 60_000);
const hlcTablet = HLC.serializza(hTablet);
const eventoRemoto = {
  id: hlcTablet + ":vol1",
  hlc: hlcTablet,
  dispositivo: "tablet2",
  entita: "biblioteca",
  entita_id: "vol1",
  tipo: "aggiorna",
  payload: JSON.stringify({ ultima_pagina: 300 }),
};

// Applicazione del pacchetto, ricopiata da useAutoSync.ts:46-63.
const locali = await d.getAllAsync(
  "SELECT id, hlc, dispositivo, entita, entita_id, tipo, payload FROM eventi"
);
const f = Fusione.fondi(locali, [eventoRemoto]);
await app.inTransazione(async (dd) => {
  for (const e of f.nuovi) {
    await dd.runAsync(
      `INSERT OR IGNORE INTO eventi
       (id, hlc, dispositivo, entita, entita_id, tipo, payload, sincronizzato)
       VALUES (?,?,?,?,?,?,?,1)`,
      [e.id, e.hlc, e.dispositivo, e.entita, e.entita_id, e.tipo, e.payload]
    );
  }
});

// Subito dopo lo scambio l'utente continua a leggere sul telefono: pagina 121.
const hlcLocaleDopo = await segnaPagina(121);

const timbroPiuBasso = hlcLocaleDopo < hlcTablet;
misura("il timbro locale dopo lo scambio e' PIU' BASSO di quello remoto", String(timbroPiuBasso));
console.log(`      locale ${hlcLocaleDopo}\n      remoto ${hlcTablet}`);

// Cosa legge la schermata del lettore (app/lettore.tsx:36)?
const vistoDalLettore = await d.getFirstAsync("SELECT * FROM biblioteca WHERE id = ?", ["vol1"]);
// Cosa direbbe invece una ricostruzione dal registro, che pero' nessuno esegue.
const tutti = await d.getAllAsync(
  "SELECT id, hlc, dispositivo, entita, entita_id, tipo, payload FROM eventi"
);
const daRegistro = Fusione.proietta(tutti, "biblioteca", "vol1");

console.log(`      app/lettore.tsx legge ultima_pagina = ${vistoDalLettore.ultima_pagina}`);
console.log(`      proietta() dal registro direbbe    = ${daRegistro.ultima_pagina}  (mai eseguito in app)`);

const utenteVedeLaSua = vistoDalLettore.ultima_pagina === 121;
const registroSbagliato = daRegistro.ultima_pagina === 300;
anello(
  "A2 il valore remoto raggiunge cio' che l'utente legge",
  utenteVedeLaSua && chiamanti.length === 0,
  utenteVedeLaSua
    ? `no: la tabella operativa conserva 121; nessuno chiama proietta(), nessuna schermata legge 'eventi'`
    : `si': la schermata mostra ${vistoDalLettore.ultima_pagina}`
);
misura("l'ordine SBAGLIATO resta comunque scritto nel registro", String(registroSbagliato));

// =========================================================================
// A3. La deriva copre il tempo di reazione umano?
// =========================================================================
console.log("\nA3. quanto dura la finestra in cui una modifica locale nasce perdente");

// adesso() mette ms = Date.now() appena l'ora di sistema supera lo stato: la
// finestra perdente dura quindi esattamente quanto il remoto e' avanti.
function finestraPerdenteMs(derivaMs) {
  const o = new HLC.Orologio("telefono1");
  const t0 = 1_700_000_000_000;
  o.adesso(t0);
  const remoto = new HLC.Orologio("tablet2").adesso(t0 + derivaMs);
  // si cerca il primo istante, dopo lo scambio, in cui il timbro locale vince
  for (let dt = 0; dt <= derivaMs + 2; dt++) {
    const mio = o.adesso(t0 + dt);
    if (HLC.confronta(mio, remoto) > 0) return dt;
  }
  return null;
}
for (const deriva of [0, 1_000, 60_000, 300_000]) {
  const f2 = finestraPerdenteMs(deriva);
  console.log(`      deriva ${String(deriva).padStart(7)} ms -> finestra perdente ${f2} ms`);
}
const finestraUnMinuto = finestraPerdenteMs(60_000);
anello(
  "A3 la finestra e' cosi' breve da non contenere un gesto umano",
  finestraUnMinuto < 1_000,
  `con un minuto di deriva la finestra dura ${finestraUnMinuto} ms: un tocco dopo lo scambio ci entra`
);

// =========================================================================
// A4. Stesso campo della stessa entita': quanto e' larga la superficie?
// =========================================================================
console.log("\nA4. dove due dispositivi possono davvero scontrarsi sullo stesso campo");

// Si estraggono i chiamanti veri di registra(): entita', tipo e campi toccati.
// Il terzo argomento puo' essere un ternario (app/(tabs)/note.tsx:50), e il
// payload puo' usare la forma abbreviata { grado, stabilita }: la lettura deve
// reggere entrambi, altrimenti la superficie contendibile risulta piu' piccola
// di quella vera e l'accusa verrebbe sgonfiata per un errore mio.
const scritture = [];
for (const [file, testo] of testoDi) {
  for (const m of testo.matchAll(/registra\(\s*"([a-z_]+)"\s*,\s*[^,]+?,\s*([^,]*?(?:crea|aggiorna|elimina)[^,]*?)\s*,\s*\{([^}]*)\}/g)) {
    const tipi = [...new Set([...m[2].matchAll(/"(crea|aggiorna|elimina)"/g)].map((x) => x[1]))];
    const campi = [...new Set(
      [...m[3].matchAll(/(?:^|[{,\s])([a-zA-Z_][a-zA-Z0-9_]*)\s*(?::|,|$|\s*\})/gm)].map((x) => x[1])
    )];
    scritture.push({ file, entita: m[1], tipo: tipi.join("/") || "?", campi });
  }
}
for (const s of scritture) {
  console.log(`      ${s.file.padEnd(28)} ${s.entita.padEnd(12)} ${s.tipo.padEnd(9)} ${s.campi.join(", ")}`);
}
// Una riga creata con un id nuovo su ogni dispositivo non puo' mai entrare in
// conflitto: nessun campo viene riscritto due volte.
const soloCreazioni = new Set(scritture.filter((s) => s.tipo === "crea").map((s) => s.entita));
// "crea/aggiorna" conta come riscrittura: la seconda volta riscrive in place.
const riscritture = scritture.filter((s) => s.tipo !== "crea");
const entitaContese = [...new Set(riscritture.map((s) => s.entita))];
misura("entita' scritte solo in creazione (id nuovo, mai contese)", [...soloCreazioni].join(", ") || "nessuna");
misura("entita' riscritte in place (le uniche contendibili)", entitaContese.join(", ") || "nessuna");
anello(
  "A4 non esiste nessun campo riscritto da entrambi i dispositivi",
  entitaContese.length === 0,
  entitaContese.length ? `esistono: ${entitaContese.join(", ")}` : "nessuno"
);

// =========================================================================
// A5. Il danno sarebbe osservabile?
// =========================================================================
console.log("\nA5. se il danno ci fosse, l'app lo direbbe?");

// fondi() calcola `conflitti`, ma useAutoSync usa solo `nuovi`.
const usaConflitti = /\bf\.conflitti|\.conflitti\b/.test(autoSync);
misura("useAutoSync usa l'elenco conflitti prodotto da fondi()", String(usaConflitti));
// derivaSospetta() si alza solo dentro ricevi(), che non gira mai.
const derivaDopo = app.derivaSospetta();
misura("derivaSospetta() dopo 90 minuti di deriva vera", String(derivaDopo));
anello(
  "A5 l'app segnalerebbe comunque lo scontro all'utente",
  !usaConflitti && derivaDopo === false,
  "no: i conflitti calcolati non vengono letti e derivaSospetta() resta false perche' si alza solo dentro ricevi()"
);

// =========================================================================
// COSTO DELLA CORREZIONE
// =========================================================================
console.log("\nCOSTO: cosa servirebbe per chiamare ricevi()");
const dbTesto = testoDi.get("lib/db.ts");
const orologioPrivato = /^let orologio: Orologio \| null = null;/m.test(dbTesto) && !/export\s+(const|let|function)\s+orologio/.test(dbTesto);
misura("l'orologio e' privato dentro lib/db.ts (serve una nuova esportazione)", String(orologioPrivato));
const persistenzaSoloInEvento = (dbTesto.match(/INSERT INTO meta \(chiave, valore\) VALUES \('hlc'/g) || []).length;
misura("punti che persistono l'orologio in meta (tutti dentro scriviEvento)", String(persistenzaSoloInEvento));
console.log("      -> nuova funzione esportata in lib/db.ts (assorbi + persistenza in meta, in coda)");
console.log("      -> una chiamata per evento ricevuto dentro l'inTransazione di useAutoSync.ts:54-63");
console.log("      -> lib/db.ts e' il file che porta la correzione critica della coda, appena atterrata");

// =========================================================================
console.log("\n" + "=".repeat(72));
console.log(`anelli APERTI (la conseguenza non arriva all'utente): ${aperti.length}`);
for (const a of aperti) console.log("   + " + a);
console.log(`anelli chiusi (la catena regge su questo punto): ${chiusi.length}`);
for (const c of chiusi) console.log("   ! " + c);
console.log("misure:");
for (const m of misure) console.log("   . " + m);
console.log("=".repeat(72));
