/**
 * CONTROPROVA AVVERSARIALE del difetto HLC-02, lente "correttezza".
 *
 * L'accusa (lib/sync/useAutoSync.ts:61): `Orologio.ricevi()` non e' chiamato da
 * nessun punto di lib/ e app/, quindi dopo aver applicato un pacchetto remoto
 * con HLC piu' avanti del proprio l'orologio locale non avanza; la modifica
 * locale successiva nasce con un timbro MINORE di quella remota gia' vista e in
 * fusione perde pur essendo piu' recente.
 *
 * Qui NON si cerca di confermarla: si cerca di SMONTARLA. Ogni verifica sotto
 * e' scritta in modo che diventi VERDE SE L'APP HA RAGIONE. Le vie di scampo
 * cercate sono sei:
 *
 *   A. forse un chiamante c'e' e la scansione dell'accusa lo ha perso
 *      (alias, destrutturazione, accesso con le parentesi quadre);
 *   B. forse l'orologio assorbe il tempo remoto per un'altra strada, dentro
 *      la transazione vera che applica il pacchetto;
 *   C. forse e' il riavvio a ripararlo, ricostruendo l'orologio dal registro;
 *   D. forse la fusione non fa perdere niente lo stesso, perche' la risoluzione
 *      non guarda davvero l'HLC;
 *   E. forse serve una deriva irrealistica fra i due orologi, e allora e' un
 *      caso di laboratorio;
 *   F. forse SYN-01 (la sincronizzazione non proietta) rende la conseguenza
 *      inesistente: se il valore remoto non arriva mai nelle tabelle operative,
 *      non c'e' niente che possa vincere contro la modifica locale.
 *
 * Gira il CODICE VERO sopra il banco: lib/db.ts, lib/hlc.ts, lib/sync/fusione.ts
 * su node:sqlite. `useAutoSync` non e' importabile (e' un hook React e importa
 * react-native ed expo-router), quindi il blocco che applica il pacchetto e'
 * ricopiato dalle sue righe 46-63 e il passo B0 verifica che la copia sia
 * ancora fedele all'originale.
 *
 *   node test/simulazione/controprova-HLC-02-correttezza.mjs
 *
 * Nessun file del progetto viene toccato: solo letture.
 */
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const QUESTA_CARTELLA = dirname(fileURLToPath(import.meta.url));
const RADICE_PROGETTO = resolve(QUESTA_CARTELLA, "..", "..");

// --------------------------------------------------------- RIAVVIO CON I GANCI
// Il banco si registra con --import: se si e' partiti senza, ci si riavvia da
// soli, cosi' il file si esegue anche con un `node` nudo.
if (!process.env.CONTROPROVA_HLC02_IN_CORSO) {
  const esito = spawnSync(
    process.execPath,
    [
      "--import",
      "./test/banco/carica.mjs",
      "test/simulazione/controprova-HLC-02-correttezza.mjs",
    ],
    {
      cwd: RADICE_PROGETTO,
      stdio: "inherit",
      env: { ...process.env, CONTROPROVA_HLC02_IN_CORSO: "1" },
    }
  );
  process.exit(esito.status ?? 1);
}

const { configuraCartella } = await import("../banco/expo-sqlite.mjs");
const HLC = await import(pathToFileURL(join(RADICE_PROGETTO, "lib/hlc.ts")).href);
const Fusione = await import(
  pathToFileURL(join(RADICE_PROGETTO, "lib/sync/fusione.ts")).href
);

// ------------------------------------------------------------------ CONTEGGIO
// `confuta` passa quando l'APP ha ragione: e' la via di scampo che si e' aperta.
// `circoscrive` non assolve ne' condanna: delimita lo scenario in cui il difetto
// morde, e serve a non gonfiare la gravita' di cio' che resta in piedi.
const assoluzioni = [];
const condanne = [];
const confini = [];

function confuta(nome, condizione, extra = "") {
  if (condizione) assoluzioni.push(nome);
  else condanne.push(`${nome}${extra ? " — " + extra : ""}`);
  console.log(`  ${condizione ? "CONFUTATO " : "in piedi  "}  ${nome}${extra ? "  [" + extra + "]" : ""}`);
}

function circoscrive(nome, condizione, extra = "") {
  confini.push(`${nome}: ${condizione ? "si'" : "no"}${extra ? " (" + extra + ")" : ""}`);
  console.log(`  confine     ${nome}: ${condizione ? "si'" : "no"}${extra ? "  [" + extra + "]" : ""}`);
}

// ------------------------------------------------------------------- AMBIENTE
const RADICE_TEMP = mkdtempSync(join(tmpdir(), "controprova-hlc02-"));
let contatoreIstanze = 0;

/** Un "avvio dell'app": istanza nuova di lib/db.ts, con la sua cartella. */
async function avvia(dispositivo, cartella) {
  contatoreIstanze++;
  const dove = cartella ?? join(RADICE_TEMP, "avvio-" + contatoreIstanze);
  configuraCartella(dove);
  const app = await import(
    pathToFileURL(join(RADICE_PROGETTO, "lib/db.ts")).href + `?istanza=${contatoreIstanze}`
  );
  await app.apri(dispositivo);
  return { app, base: app.database(), cartella: dove };
}

/** Un evento nella forma esatta che lib/db.ts scrive e i trasporti consegnano. */
function eventoRemoto(orologio, dispositivo, entita, entitaId, payload, oraFisica) {
  const h = orologio.adesso(oraFisica);
  const hlc = HLC.serializza(h);
  return {
    id: hlc + ":" + entitaId,
    hlc,
    dispositivo,
    entita,
    entita_id: entitaId,
    tipo: "aggiorna",
    payload: JSON.stringify(payload),
  };
}

console.log("\nCONTROPROVA HLC-02 — si cercano le sei vie di scampo dell'app\n");

// =========================================================================
// A. Il chiamante esiste e la scansione dell'accusa lo ha perso?
// =========================================================================
console.log("A. un chiamante di Orologio.ricevi in lib/, app/ o components/");

const sorgenti = [];
for (const radice of ["lib", "app", "components"]) {
  (function raccogli(cartella) {
    for (const voce of readdirSync(cartella, { withFileTypes: true })) {
      const percorso = join(cartella, voce.name);
      if (voce.isDirectory()) raccogli(percorso);
      else if (/\.tsx?$/.test(voce.name)) sorgenti.push(percorso);
    }
  })(join(RADICE_PROGETTO, radice));
}

// L'accusa cercava `.ricevi(` in file che nominano "Orologio". Qui si allarga:
// qualunque menzione di "ricevi" in un file che nomini l'orologio o l'HLC,
// compresi `const { ricevi } = orologio` e `orologio["ricevi"]`, che una
// ricerca di `.ricevi(` non vedrebbe.
const sospetti = [];
for (const percorso of sorgenti) {
  if (percorso.endsWith(join("lib", "hlc.ts"))) continue; // la definizione
  const testo = readFileSync(percorso, "utf8");
  if (!/\bricevi\b/.test(testo)) continue;
  const parlaDiOrologio = /Orologio|orologio|\bHLC\b|hlc\.ts|timbro\b/.test(testo);
  const righe = testo.split("\n");
  for (let i = 0; i < righe.length; i++) {
    if (!/\bricevi\b/.test(righe[i])) continue;
    sospetti.push({
      file: percorso.replace(RADICE_PROGETTO + "/", ""),
      riga: i + 1,
      testo: righe[i].trim(),
      parlaDiOrologio,
    });
  }
}
for (const s of sospetti) {
  console.log(`      ${s.file}:${s.riga}  ${s.testo}`);
}
// Le uniche occorrenze note sono in lib/sync/vicinanza.ts, dove `ricevi` e' un
// metodo del MODULO NATIVO di prossimita' (un'interfaccia di trasporto), non
// dell'orologio: quel file non nomina mai l'Orologio.
const chiamantiOrologio = sospetti.filter((s) => s.parlaDiOrologio);
confuta(
  "A1 esiste almeno un chiamante di Orologio.ricevi fuori dalla definizione",
  chiamantiOrologio.length > 0,
  `sorgenti esaminate: ${sorgenti.length}, occorrenze di "ricevi": ${sospetti.length}, in file che parlano dell'orologio: ${chiamantiOrologio.length}`
);

// =========================================================================
// B. L'orologio assorbe il tempo remoto per un'altra strada?
// =========================================================================
console.log("\nB. l'orologio locale dopo l'applicazione VERA di un pacchetto remoto");

// B0: la copia del blocco di useAutoSync e' ancora fedele all'originale.
const sorgenteAuto = readFileSync(
  join(RADICE_PROGETTO, "lib/sync/useAutoSync.ts"),
  "utf8"
);
const copiaFedele =
  /inTransazione\(/.test(sorgenteAuto) &&
  /INSERT OR IGNORE\s*\n?\s*INTO eventi|INSERT OR IGNORE INTO eventi/.test(sorgenteAuto);
confuta(
  "B0 useAutoSync applica i pacchetti in un modo DIVERSO da quello che ricopio",
  !copiaFedele,
  copiaFedele ? "no: usa inTransazione + INSERT OR IGNORE INTO eventi, come la copia" : "il blocco e' cambiato: ricontrollare"
);

const tablet = await avvia("tab1");

// Una scrittura locale vera, che porta l'orologio all'ora di sistema.
await tablet.app.registra("biblioteca", "v9", "aggiorna", { ultima_pagina: 10 }, async (d, hlc) => {
  await d.runAsync(
    `INSERT INTO biblioteca (id, titolo, origine, aggiunto_a, ultima_pagina, hlc)
     VALUES (?,?,?,?,?,?)
     ON CONFLICT (id) DO UPDATE SET ultima_pagina = excluded.ultima_pagina, hlc = excluded.hlc`,
    ["v9", "Manuale", "manuale", new Date().toISOString(), 10, hlc]
  );
});

// Il pari ha l'ora avanti di due ore: e' la deriva che l'invariante 2 dichiara
// possibile e che lib/hlc.ts misura con `derivaRilevata`.
const ADESSO = Date.now();
const telefonoAvanti = new HLC.Orologio("tel2");
const pacchetto = eventoRemoto(
  telefonoAvanti,
  "tel2",
  "biblioteca",
  "v9",
  { ultima_pagina: 200 },
  ADESSO + 2 * 3600_000
);

// --- copia delle righe 46-63 di lib/sync/useAutoSync.ts -------------------
const localiPrima = await tablet.base.getAllAsync(
  "SELECT id, hlc, dispositivo, entita, entita_id, tipo, payload FROM eventi"
);
const fusione = Fusione.fondi(localiPrima, [pacchetto]);
await tablet.app.inTransazione(async (d) => {
  for (const e of fusione.nuovi) {
    await d.runAsync(
      `INSERT OR IGNORE INTO eventi
       (id, hlc, dispositivo, entita, entita_id, tipo, payload, sincronizzato)
       VALUES (?,?,?,?,?,?,?,1)`,
      [e.id, e.hlc, e.dispositivo, e.entita, e.entita_id, e.tipo, e.payload]
    );
  }
});
// --- fine della copia -----------------------------------------------------

const timbroDopoFusione = HLC.serializza(tablet.app.timbro());
confuta(
  "B1 il timbro locale dopo la fusione supera l'HLC remoto appena applicato",
  timbroDopoFusione > pacchetto.hlc,
  `locale ${timbroDopoFusione} vs remoto ${pacchetto.hlc}`
);

confuta(
  "B2 derivaSospetta() si alza dopo aver visto due ore di deriva",
  tablet.app.derivaSospetta() === true,
  `derivaSospetta() = ${tablet.app.derivaSospetta()} (app/(tabs)/oggi.tsx:79 mostra il riquadro solo se e' true)`
);

// =========================================================================
// C. E' il riavvio a ripararlo?
// =========================================================================
console.log("\nC. il riavvio dell'app ricostruisce l'orologio dal registro?");

await tablet.base.closeAsync();
const dopoRiavvio = await avvia("tab1", tablet.cartella);
const eventiVisti = await dopoRiavvio.base.getAllAsync(
  "SELECT id, hlc FROM eventi ORDER BY hlc"
);
const timbroDopoRiavvio = HLC.serializza(dopoRiavvio.app.timbro());
confuta(
  "C1 dopo il riavvio il timbro locale supera l'HLC remoto gia' nel registro",
  timbroDopoRiavvio > pacchetto.hlc,
  `${eventiVisti.length} eventi nel registro, timbro ${timbroDopoRiavvio} vs remoto ${pacchetto.hlc}`
);

// =========================================================================
// D. La fusione fa davvero perdere la modifica locale?
// =========================================================================
console.log("\nD. chi vince nella proiezione, a codice vero");

// La modifica locale arriva un secondo dopo la fusione: e' la sequenza reale
// (si prende il tablet, si sincronizza, si continua a leggere e si aggiorna
// la pagina). L'orologio locale e' quello vero, ripreso dal registro.
const localeDopo = await dopoRiavvio.app.registra(
  "biblioteca",
  "v9",
  "aggiorna",
  { ultima_pagina: 201 },
  async (d, hlc) => {
    await d.runAsync("UPDATE biblioteca SET ultima_pagina = 201, hlc = ? WHERE id = ?", [hlc, "v9"]);
  }
);

const tuttiGliEventi = await dopoRiavvio.base.getAllAsync(
  "SELECT id, hlc, dispositivo, entita, entita_id, tipo, payload FROM eventi"
);
const ricostruito = Fusione.proietta(tuttiGliEventi, "biblioteca", "v9");
confuta(
  "D1 la ricostruzione dal registro conserva la modifica locale piu' recente",
  ricostruito && ricostruito.ultima_pagina === 201,
  `proietta() restituisce ultima_pagina = ${ricostruito ? ricostruito.ultima_pagina : "null"}; timbro locale ${localeDopo} vs remoto ${pacchetto.hlc}`
);

// La stessa domanda posta a fondi(), che e' cio' che la sincronizzazione
// userebbe per dire all'utente chi ha vinto.
const conflitti = Fusione.fondi(
  tuttiGliEventi.filter((e) => e.dispositivo === "tab1"),
  [pacchetto]
).conflitti.filter((c) => c.entita_id === "v9" && c.campo === "ultima_pagina");
confuta(
  "D2 fondi() dichiara vincitore il dispositivo locale",
  conflitti.length > 0 && conflitti[conflitti.length - 1].vincitore === "tab1",
  conflitti.length ? `vincitore dichiarato: ${conflitti[conflitti.length - 1].vincitore}` : "nessun conflitto rilevato"
);

// =========================================================================
// E. Serve una deriva irrealistica?
// =========================================================================
console.log("\nE. quanta deriva serve perche' il difetto morda");

// E1: con gli orologi allineati e un secondo fra la fusione e la modifica,
// la modifica locale vince lo stesso. E' la via di scampo piu' seria: se fosse
// cosi' in ogni caso realistico, il difetto sarebbe di laboratorio.
const pariAllineato = new HLC.Orologio("tel2");
const remotoAllineato = eventoRemoto(pariAllineato, "tel2", "note", "n1", { testo: "dal telefono" }, ADESSO);
const localeAllineato = new HLC.Orologio("tab1");
const scrittaDopoUnSecondo = eventoRemoto(localeAllineato, "tab1", "note", "n1", { testo: "dal tablet" }, ADESSO + 1000);
const esitoAllineato = Fusione.proietta([remotoAllineato, scrittaDopoUnSecondo], "note", "n1");
circoscrive(
  "E1 con orologi allineati la modifica locale vince senza bisogno di ricevi()",
  esitoAllineato.testo === "dal tablet",
  `testo finale: ${esitoAllineato.testo}`
);

// E2: quanta deriva serve? Si cerca la soglia: il pari avanti di X ms, la
// modifica locale un secondo dopo la fusione.
let sogliaMs = null;
for (const derivaMs of [1, 100, 1000, 2000, 5000, 60_000]) {
  const pari = new HLC.Orologio("tel2");
  const r = eventoRemoto(pari, "tel2", "note", "s1", { testo: "remoto" }, ADESSO + derivaMs);
  const mio = new HLC.Orologio("tab1");
  const l = eventoRemoto(mio, "tab1", "note", "s1", { testo: "locale" }, ADESSO + 1000);
  if (Fusione.proietta([r, l], "note", "s1").testo === "remoto") {
    sogliaMs = derivaMs;
    break;
  }
}
circoscrive(
  "E2 la deriva minima che fa perdere una modifica fatta un secondo dopo",
  sogliaMs !== null,
  sogliaMs === null ? "nessuna deriva provata basta" : `${sogliaMs} ms (~${(sogliaMs / 1000).toFixed(1)} s)`
);

// E3: e senza NESSUNA deriva? Se il timbro remoto cade nello stesso
// millisecondo con il contatore piu' alto, l'orologio locale riparte da
// contatore 0 e perde ugualmente. Qui la deriva e' zero.
const pariStessoMs = new HLC.Orologio("tel2");
let remotoStessoMs = null;
for (let i = 0; i < 4; i++) remotoStessoMs = eventoRemoto(pariStessoMs, "tel2", "note", "z1", { testo: "remoto" }, ADESSO);
const mioStessoMs = new HLC.Orologio("tab1");
const localeStessoMs = eventoRemoto(mioStessoMs, "tab1", "note", "z1", { testo: "locale" }, ADESSO);
confuta(
  "E3 senza deriva alcuna (stesso millisecondo) la modifica locale vince comunque",
  Fusione.proietta([remotoStessoMs, localeStessoMs], "note", "z1").testo === "locale",
  `remoto ${remotoStessoMs.hlc} vs locale ${localeStessoMs.hlc}`
);

// =========================================================================
// F. SYN-01 rende la conseguenza inesistente?
// =========================================================================
console.log("\nF. SYN-01 (la sincronizzazione non proietta) assolve HLC-02?");

// Se il valore remoto non arriva mai nella tabella operativa, l'utente oggi
// non vede nessuna perdita: la via di scampo sarebbe che il difetto non abbia
// conseguenza. Si guarda la tabella operativa E il registro, che l'invariante 1
// dichiara fonte di verita'.
const rigaOperativa = await dopoRiavvio.base.getFirstAsync(
  "SELECT ultima_pagina FROM biblioteca WHERE id = 'v9'"
);
circoscrive(
  "F1 la tabella operativa oggi conserva il valore locale (SYN-01 maschera la perdita)",
  rigaOperativa.ultima_pagina === 201,
  `biblioteca.ultima_pagina = ${rigaOperativa.ultima_pagina}`
);
confuta(
  "F2 anche il registro — fonte di verita', invariante 1 — conserva l'ordine giusto",
  ricostruito && ricostruito.ultima_pagina === 201,
  `una ricostruzione dal registro darebbe ultima_pagina = ${ricostruito ? ricostruito.ultima_pagina : "null"}`
);

// =========================================================================
// RIEPILOGO
// =========================================================================
console.log("\n" + "=".repeat(72));
console.log(`vie di scampo aperte (APP ASSOLTA): ${assoluzioni.length}`);
for (const a of assoluzioni) console.log(`   + ${a}`);
console.log(`accuse rimaste in piedi: ${condanne.length}`);
for (const c of condanne) console.log(`   ! ${c}`);
console.log("confini dello scenario:");
for (const c of confini) console.log(`   . ${c}`);
console.log("=".repeat(72));

rmSync(RADICE_TEMP, { recursive: true, force: true });
process.exit(0);
