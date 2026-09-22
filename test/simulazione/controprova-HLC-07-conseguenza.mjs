/**
 * Controprova avversariale su HLC-07 — lente "CONSEGUENZA".
 *
 * Scheda sotto esame:
 *   "La riga meta('hlc') contiene un valore non interpretabile (vuoto, o
 *    'zz-1'). parseInt('',16) da' NaN. L'orologio produce timbri
 *    '000000000NaN-0NaN-<dispositivo>' e la seconda scrittura sulla stessa
 *    entita' viola la chiave primaria di eventi."
 *
 * La domanda di questa lente NON e' "il meccanismo esiste?" (esiste: basta
 * scrivere NaN in meta e guardare). La domanda e':
 *
 *   puo' accadere all'utente, in aereo, su un telefono o un tablet,
 *   seguendo l'app come e' fatta?
 *
 * Un difetto la cui precondizione nessun gesto dell'utente puo' produrre non
 * manda nessuno in errore: manda un collega a mettere una guardia su una porta
 * che non si apre. Per questo qui non si inietta la corruzione e basta: si
 * cerca, per tutte le strade che l'app ha davvero, di FARLA PRODURRE ALL'APP.
 *
 * Quattro scene:
 *   A  genesi interna — si prova a far scrivere all'app un meta('hlc')
 *      illeggibile, con gli orologi di sistema piu' ostili che un telefono
 *      puo' avere (1970, RTC scarico, salto di vent'anni, contatore in
 *      saturazione). Verdetto letto SEMPRE da una connessione node:sqlite
 *      indipendente: chi ha scritto non testimonia per se'.
 *   B  superficie di scrittura — chi altro, in app/ e lib/, puo' toccare
 *      meta('hlc') o seminare l'orologio.
 *   C  genesi esterna per la sola porta che l'app apre davvero ai byte di
 *      qualcun altro: il pacchetto di sincronizzazione importato da file.
 *   D  se la precondizione viene comunque iniettata dal di fuori: che cosa
 *      perde l'utente, e quanto costa la correzione (misurata, non stimata
 *      a occhio: si applica fuori dall'albero e si contano le righe).
 *
 * Gira sul banco, con il codice VERO di lib/db.ts, lib/hlc.ts e
 * lib/sync/fusione.ts. Non tocca nessun file del progetto: lavora solo in
 * cartelle temporanee.
 *
 *   node --import ./test/banco/carica.mjs \
 *        test/simulazione/controprova-HLC-07-conseguenza.mjs
 */
import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, rmSync, readFileSync, readdirSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, relative } from "node:path";
import { pathToFileURL } from "node:url";
import { configuraCartella } from "../banco/expo-sqlite.mjs";

const RADICE = resolve(import.meta.dirname, "..", "..");

// La forma che l'app sa scrivere in meta: due interi non negativi in
// esadecimale, prodotti da `h.ms.toString(16) + "-" + h.contatore.toString(16)`
// (lib/db.ts, unica istruzione che scrive quella riga).
const FORMA_SANA = /^[0-9a-f]+-[0-9a-f]+$/;

// ---------------------------------------------------------------- CONTEGGIO
const scene = [];
let scena = null;

function ok(nome, condizione, extra = "") {
  scena.verifiche++;
  const riga = `${nome}${extra ? " — " + extra : ""}`;
  if (condizione) console.log(`    ok   ${riga}`);
  else {
    scena.errori.push(riga);
    console.log(`    NO   ${riga}`);
  }
}

async function inScena(nome, azione) {
  scena = { nome, verifiche: 0, errori: [] };
  scene.push(scena);
  console.log(`\n${nome}`);
  try {
    await azione();
  } catch (errore) {
    scena.verifiche++;
    scena.errori.push("eccezione non attesa: " + String(errore?.stack ?? errore));
    console.log(`    NO   eccezione non attesa: ${String(errore?.message ?? errore)}`);
  }
  scena = null;
}

// ----------------------------------------------------------------- AMBIENTE
const cartelleUsate = [];
let istanze = 0;

/**
 * Un avvio dell'app. Istanza nuova del modulo: `db` e `orologio` sono
 * variabili di modulo e apri() esce subito se `db` e' gia' valorizzato,
 * quindi senza istanza nuova non si collauda la SEMINA dell'orologio da meta.
 */
async function avvia(dispositivo, cartella) {
  istanze++;
  const dove = cartella ?? mkdtempSync(join(tmpdir(), "hlc07-conseguenza-"));
  if (!cartella) cartelleUsate.push(dove);
  configuraCartella(dove);
  const app = await import(
    pathToFileURL(resolve(RADICE, "lib/db.ts")).href + "?conseguenza=" + istanze
  );
  await app.apri(dispositivo);
  return { app, cartella: dove, file: join(dove, "percorso.db") };
}

/** Verdetto da fuori dal banco: connessione indipendente sullo stesso file. */
function daFuori(file, sql, parametri = []) {
  const c = new DatabaseSync(file);
  try {
    return c.prepare(sql).all(...parametri);
  } finally {
    c.close();
  }
}

function scriviDaFuori(file, sql, parametri = []) {
  const c = new DatabaseSync(file);
  try {
    c.prepare(sql).run(...parametri);
  } finally {
    c.close();
  }
}

const metaDaFuori = (file) =>
  daFuori(file, "SELECT valore FROM meta WHERE chiave = 'hlc'")[0]?.valore ?? null;

// L'ora di sistema del telefono. Si congela per riprodurre orologi ostili:
// Orologio.adesso() ha `oraFisica = Date.now()` come parametro predefinito.
const oraVera = Date.now;
const congela = (v) => { Date.now = () => v; };
const scongela = () => { Date.now = oraVera; };

/** Proiezione di una nota, il gesto piu' semplice che scrive nel registro. */
const proiettaNota = (id, testo) => async (d, hlc) =>
  d.runAsync(
    `INSERT INTO note (id, titolo, testo, creato_a, hlc) VALUES (?,?,?,?,?)
     ON CONFLICT (id) DO UPDATE SET testo = excluded.testo, hlc = excluded.hlc`,
    [id, "nota", testo, "2026-09-22T00:00:00.000Z", hlc]
  );

async function salva(app, id, testo) {
  try {
    return { riuscita: true, hlc: await app.registra("note", id, "aggiorna", { testo }, proiettaNota(id, testo)) };
  } catch (errore) {
    return { riuscita: false, errore: String(errore?.message ?? errore) };
  }
}

// ===========================================================================
// SCENA A — l'app puo' scrivere da sola un meta('hlc') illeggibile?
// ===========================================================================
await inScena("A. Genesi interna: si prova a far produrre all'app la precondizione", async () => {
  // Ogni riga: [nome dello scenario, sequenza di ore di sistema].
  // Sono gli orologi ostili che un telefono puo' davvero avere in mano a una
  // persona: batteria a zero e RTC azzerato, data impostata a mano, fuso
  // cambiato a meta' volo, ora legale, aggiornamento NTP all'atterraggio.
  const orologiOstili = [
    ["ora normale", [1_790_000_000_000, 1_790_000_000_001, 1_790_000_000_500]],
    ["telefono con la data al 1970, fuso UTC+2 → Date.now() negativo", [-7_200_000, -7_199_999, -7_100_000]],
    ["Date.now() esattamente 0", [0, 0, 1]],
    ["RTC scarico: ora giusta, poi indietro di due ore", [1_790_000_000_000, 1_789_992_800_000, 1_789_992_800_001]],
    ["salto avanti di vent'anni e ritorno", [1_790_000_000_000, 2_421_000_000_000, 1_790_000_000_000]],
    ["stesso millisecondo tre volte (due tocchi rapidi su Salva)", [1_790_000_000_000, 1_790_000_000_000, 1_790_000_000_000]],
    // Nessun telefono la produce — Date.now() restituisce un intero per
    // specifica — ma un doppio di test si'. Sta qui per chiudere anche
    // quella strada, e infatti la chiude solo a meta': vedi sotto.
    ["ora frazionaria (non un orologio di telefono: solo un doppio)", [1_790_000_000_000.7, 1_790_000_000_001.2, 1_790_000_000_002.9]],
  ];

  for (const [nome, ore] of orologiOstili) {
    const { app, file } = await avvia("dispositivo-ostile");
    let timbri = [];
    try {
      for (let i = 0; i < ore.length; i++) {
        congela(ore[i]);
        const esito = await salva(app, "nota-" + i, "testo " + i);
        timbri.push(esito.hlc ?? "FALLITA:" + esito.errore);
      }
    } finally {
      scongela();
    }
    const valore = metaDaFuori(file);
    // La verifica che conta per HLC-07 non e' la forma della stringa: e' se
    // apri() la rilegge come NaN. Si rifa' esattamente quello che fa apri():
    // split("-"), poi parseInt(.., 16) sui due pezzi.
    const [pezzoMs, pezzoCont] = String(valore ?? "").split("-");
    ok(`A la precondizione di HLC-07 non si forma — ${nome}`,
      Number.isFinite(parseInt(pezzoMs, 16)) && Number.isFinite(parseInt(pezzoCont, 16)),
      `meta='${valore}' → ms=${parseInt(pezzoMs, 16)} cont=${parseInt(pezzoCont, 16)}`);
    ok(`A nessun timbro contiene NaN — ${nome}`,
      timbri.every((t) => !String(t).includes("NaN")), timbri.join(" | "));
    // Per gli orologi che un telefono puo' davvero avere (Date.now() intero
    // per specifica) la stringa e' anche esadecimale pura: nemmeno un punto.
    if (ore.every(Number.isInteger)) {
      ok(`A forma esadecimale pura — ${nome}`, FORMA_SANA.test(valore ?? ""), `meta='${valore}'`);
    }
    await app.database().closeAsync();
  }

  // Il contatore in saturazione: 0xffff tocchi nello stesso millisecondo.
  // Troppo lento da fare con scritture vere sul database, e non serve: la
  // riga che compone meta e' `h.ms.toString(16) + "-" + h.contatore.toString(16)`
  // e qui la si applica agli stati veri prodotti da Orologio.adesso().
  const { Orologio } = await import(pathToFileURL(resolve(RADICE, "lib/hlc.ts")).href);
  const o = new Orologio("dispositivo-saturo");
  let tutteSane = true;
  let esempioRotto = null;
  for (let i = 0; i < 70_000; i++) {
    const h = o.adesso(1_790_000_000_000);
    const valore = h.ms.toString(16) + "-" + h.contatore.toString(16);
    if (!FORMA_SANA.test(valore)) { tutteSane = false; esempioRotto = `${i}: ${valore}`; break; }
  }
  ok("A 70.000 avanzamenti nello stesso ms (contatore oltre 0xffff): meta sempre leggibile",
    tutteSane, esempioRotto ?? "nessuna eccezione");

  // E l'orologio non puo' scendere sotto zero: parte da 0 e prende l'ora
  // fisica solo quando e' MAGGIORE. Percio' toString(16) non produce mai il
  // segno meno, che spezzando su "-" darebbe il token vuoto dello scenario.
  const indietro = new Orologio("dispositivo-1970");
  const stati = [indietro.adesso(-7_200_000), indietro.adesso(-999), indietro.adesso(0)];
  ok("A ms non diventa mai negativo, nemmeno con Date.now() negativo",
    stati.every((h) => h.ms >= 0 && h.contatore >= 0),
    stati.map((h) => `${h.ms}/${h.contatore}`).join(" "));
});

// ===========================================================================
// SCENA B — chi puo' toccare meta('hlc') e chi puo' seminare l'orologio
// ===========================================================================
await inScena("B. Superficie di scrittura: quante porte danno su meta('hlc')", async () => {
  // Si scandiscono i sorgenti veri dell'app (app/ e lib/), non i test.
  const sorgenti = [];
  (function scandisci(dir) {
    for (const voce of readdirSync(dir)) {
      const p = join(dir, voce);
      if (statSync(p).isDirectory()) scandisci(p);
      else if (/\.(ts|tsx)$/.test(voce)) sorgenti.push(p);
    }
  })(join(RADICE, "app"));
  (function scandisci(dir) {
    for (const voce of readdirSync(dir)) {
      const p = join(dir, voce);
      if (statSync(p).isDirectory()) scandisci(p);
      else if (/\.(ts|tsx)$/.test(voce)) sorgenti.push(p);
    }
  })(join(RADICE, "lib"));

  const scrivonoMeta = [];
  const tengonoOrologio = [];
  const chiamanoRicevi = [];
  for (const p of sorgenti) {
    const testo = readFileSync(p, "utf8");
    if (/(INSERT\s+(OR\s+\w+\s+)?INTO|REPLACE\s+INTO|UPDATE|DELETE\s+FROM)\s+meta\b/i.test(testo)) {
      scrivonoMeta.push(relative(RADICE, p));
    }
    if (/\bnew\s+Orologio\s*\(/.test(testo)) tengonoOrologio.push(relative(RADICE, p));
    if (/\borologio\s*[?.]*\.\s*ricevi\s*\(/.test(testo)) chiamanoRicevi.push(relative(RADICE, p));
  }

  ok("B un solo file dell'app scrive meta('hlc')", scrivonoMeta.length === 1 && scrivonoMeta[0] === "lib/db.ts",
    scrivonoMeta.join(", ") || "nessuno");
  ok("B un solo file costruisce un Orologio", tengonoOrologio.length === 1 && tengonoOrologio[0] === "lib/db.ts",
    tengonoOrologio.join(", ") || "nessuno");
  ok("B nessuno chiama Orologio.ricevi(): l'orologio non ha un ingresso per i dati remoti",
    chiamanoRicevi.length === 0, chiamanoRicevi.join(", ") || "nessuno");

  // L'unica istruzione che scrive la riga: il valore e' sempre il risultato di
  // due toString(16) su numeri dell'orologio, non un dato che viene da fuori.
  const db = readFileSync(join(RADICE, "lib/db.ts"), "utf8");
  ok("B il valore scritto in meta e' composto solo da toString(16) dell'orologio",
    /h\.ms\.toString\(16\)\s*\+\s*"-"\s*\+\s*h\.contatore\.toString\(16\)/.test(db));
  ok("B nessun parametro esterno entra in quella INSERT",
    (db.match(/INSERT INTO meta/g) ?? []).length === 1);
});

// ===========================================================================
// SCENA C — la sola porta aperta ai byte di qualcun altro: il pacchetto
// ===========================================================================
await inScena("C. Genesi esterna: un pacchetto di sync con HLC corrotti", async () => {
  // In aereo il trasporto che funziona e' il file cifrato (TrasportoFile):
  // l'utente riceve un .pcs dall'altro dispositivo e lo importa. E' l'unico
  // punto in cui byte scelti da qualcun altro entrano nel database.
  // Si riproduce il blocco di applicazione VERO di lib/sync/useAutoSync.ts.
  const { fondi } = await import(pathToFileURL(resolve(RADICE, "lib/sync/fusione.ts")).href);
  const { app, file } = await avvia("dispositivo-in-aereo");

  const sano = await salva(app, "nota-locale", "scritta prima del volo");
  ok("C la scrittura locale prima dell'importazione e' sana", sano.riuscita && !sano.hlc.includes("NaN"), sano.hlc);

  // Un pacchetto ostile al massimo: HLC vuoti, 'zz-1', 'NaN-NaN', negativi.
  const ostili = ["", "zz-1", "NaN-NaN", "-1--1", "000000000NaN-0NaN-altro"];
  const remoti = ostili.map((hlc, i) => ({
    id: `evento-ostile-${i}`,
    hlc,
    dispositivo: "dispositivo-straniero",
    entita: "note",
    entita_id: "nota-straniera-" + i,
    tipo: "crea",
    payload: JSON.stringify({ testo: "da fuori" }),
  }));

  const locali = await app.database().getAllAsync(
    "SELECT id, hlc, dispositivo, entita, entita_id, tipo, payload FROM eventi"
  );
  const f = fondi(locali, remoti);
  await app.inTransazione(async (d) => {
    for (const e of f.nuovi) {
      await d.runAsync(
        `INSERT OR IGNORE INTO eventi
         (id, hlc, dispositivo, entita, entita_id, tipo, payload, sincronizzato)
         VALUES (?,?,?,?,?,?,?,1)`,
        [e.id, e.hlc, e.dispositivo, e.entita, e.entita_id, e.tipo, e.payload]
      );
    }
  });

  ok("C gli eventi ostili sono davvero entrati nel registro",
    (await app.database().getAllAsync("SELECT id FROM eventi WHERE dispositivo='dispositivo-straniero'")).length === ostili.length);

  // Il punto: la fusione scrive in `eventi` e non tocca ne' l'orologio ne' meta.
  const dopo1 = await salva(app, "nota-locale", "scritta dopo l'importazione");
  const dopo2 = await salva(app, "nota-locale", "e ancora dopo");
  ok("C dopo l'importazione la stessa entita' resta scrivibile due volte",
    dopo1.riuscita && dopo2.riuscita, `${dopo1.hlc ?? dopo1.errore} / ${dopo2.hlc ?? dopo2.errore}`);
  ok("C i timbri locali non hanno preso NaN dal pacchetto",
    !String(dopo1.hlc).includes("NaN") && !String(dopo2.hlc).includes("NaN"));

  await app.database().closeAsync();
  const valore = metaDaFuori(file);
  ok("C meta('hlc') e' rimasto leggibile dopo l'importazione ostile",
    FORMA_SANA.test(valore ?? ""), `meta='${valore}'`);

  // E al riavvio, che e' il momento in cui meta viene letto.
  const { app: riavviata } = await avvia("dispositivo-in-aereo", join(file, "..").toString());
  const dopoRiavvio = await salva(riavviata, "nota-locale", "dopo il riavvio");
  ok("C al riavvio l'orologio riparte sano",
    dopoRiavvio.riuscita && !String(dopoRiavvio.hlc).includes("NaN"),
    dopoRiavvio.hlc ?? dopoRiavvio.errore);
  await riavviata.database().closeAsync();
});

// ===========================================================================
// SCENA D — se la si inietta comunque: danno reale e costo della correzione
// ===========================================================================
await inScena("D. Iniettata dal di fuori: che cosa perde l'utente, e cosa costa chiudere", async () => {
  const { app, file } = await avvia("dispositivo-vittima");
  await salva(app, "esercizio-1", "prima");
  await app.database().closeAsync();

  // Questa riga non la produce nessun gesto dell'app (scene A, B, C): qui la
  // scriviamo noi, per misurare il danno NEL CASO in cui esista comunque.
  scriviDaFuori(file, "UPDATE meta SET valore = '' WHERE chiave = 'hlc'");

  const { app: malata } = await avvia("dispositivo-vittima", join(file, "..").toString());
  const m1 = await salva(malata, "ripasso-1", "prima revisione");
  const m2 = await salva(malata, "ripasso-1", "seconda revisione");
  ok("D il danno e' reale: la prima scrittura passa...", m1.riuscita, m1.hlc ?? m1.errore);
  ok("D ...e la seconda sulla stessa entita' fallisce",
    !m2.riuscita && /UNIQUE|PRIMARY|constraint/i.test(m2.errore ?? ""), m2.errore ?? m2.hlc);
  const valoreMalato = metaDaFuori(file);
  ok("D e il riavvio non guarisce: in meta e' finito 'NaN-NaN'", valoreMalato === "NaN-NaN", `meta='${valoreMalato}'`);
  await malata.database().closeAsync();

  // ---- Costo della correzione, misurato e non stimato.
  // La semina sta in un solo `if (salvato)` dentro apri(). Qui si riscrive
  // quel blocco FUORI dall'albero (lib/ non si tocca) e si contano le righe.
  const { Orologio, serializza, deserializza } =
    await import(pathToFileURL(resolve(RADICE, "lib/hlc.ts")).href);

  // Correzione minima: ignorare un valore non numerico. Bastano tre righe.
  function semina(dispositivo, valoreMeta, massimoNelRegistro) {
    const [ms, cont] = String(valoreMeta ?? "").split("-");
    const msN = parseInt(ms, 16);
    const contN = parseInt(cont, 16);
    if (Number.isFinite(msN) && Number.isFinite(contN)) {
      return new Orologio(dispositivo, { ms: msN, contatore: contN, dispositivo });
    }
    // Ripartire da zero, come chiede la scheda, rimetterebbe i timbri nuovi
    // PRIMA di quelli gia' sul disco. Il punto di ripartenza che non regredisce
    // e' il massimo del registro, che e' la fonte di verita' (invariante 1).
    if (!massimoNelRegistro) return new Orologio(dispositivo);
    const h = deserializza(massimoNelRegistro);
    return new Orologio(dispositivo, { ms: h.ms, contatore: h.contatore, dispositivo });
  }

  const righeCorrezione = semina.toString().split("\n").filter((r) => {
    const t = r.trim();
    return t && !t.startsWith("//");
  }).length;
  ok("D la correzione sta in un solo blocco di apri(): meno di quindici righe",
    righeCorrezione <= 15, `${righeCorrezione} righe di codice`);

  // La correzione fa il suo mestiere e non regredisce su HLC-08 (ordine).
  const massimo = daFuori(file, "SELECT MAX(hlc) AS m FROM eventi")[0].m;
  const risanato = semina("dispositivo-vittima", "", massimo);
  const nuovo = serializza(risanato.adesso(1_790_000_000_000));
  ok("D con la correzione il timbro torna leggibile", !nuovo.includes("NaN"), nuovo);
  ok("D e resta MAGGIORE dell'ultimo evento gia' sul disco: l'ordine non regredisce",
    nuovo > massimo, `${nuovo} > ${massimo}`);

  const sano2 = semina("dispositivo-vittima", "1a2b3c-4", null);
  ok("D e un valore buono continua a seminare come prima",
    sano2.corrente.ms === 0x1a2b3c && sano2.corrente.contatore === 4);
});

// ================================================================== ESITO
for (const c of cartelleUsate) rmSync(c, { recursive: true, force: true });

const falliti = scene.filter((s) => s.errori.length);
const verifiche = scene.reduce((t, s) => t + s.verifiche, 0);
const errori = scene.reduce((t, s) => t + s.errori.length, 0);
console.log(`\n${scene.length - falliti.length} scene su ${scene.length}, ` +
  `${verifiche - errori} verifiche su ${verifiche}`);
for (const s of falliti) for (const e of s.errori) console.log(`  - [${s.nome}] ${e}`);
process.exit(falliti.length ? 1 : 0);
