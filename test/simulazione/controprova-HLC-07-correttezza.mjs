/**
 * Controprova avversariale su HLC-07, lente "correttezza".
 *
 * Scheda sotto esame:
 *   "meta('hlc') illeggibile rende l'orologio NaN per sempre e blocca le
 *    scritture sull'entita'. Valori citati: vuoto, oppure 'zz-1'."
 *
 * Non si tratta di ripetere la scena dello scenario E5 di registro-eventi.mjs
 * (quella gira gia' e passa). Qui si attaccano le TRE cose che rendono una
 * scheda di difetto azionabile, e che E5 non verifica:
 *
 *   A. il meccanismo esiste davvero? (si risponde onestamente, riproducendolo)
 *   B. la PRECONDIZIONE e' raggiungibile dall'app, o va iniettata dall'esterno?
 *   C. il comportamento descritto in "ottenuto" corrisponde ai valori che la
 *      scheda stessa nomina?
 *   D. il comportamento "atteso" dalla scheda e' davvero quello corretto,
 *      secondo l'invariante 2 del progetto?
 *
 * Gira sul banco (node:sqlite) con il codice VERO: lib/db.ts e lib/hlc.ts.
 * Non modifica nessun file del progetto: lavora in una cartella temporanea e
 * non tocca lib/.
 *
 *   node test/simulazione/controprova-HLC-07-correttezza.mjs
 */
import { mkdtempSync, rmSync, readFileSync, readdirSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
// L'ordine conta: carica.mjs per primo, perche' registra i ganci del banco.
import "../banco/carica.mjs";
import { configuraCartella } from "../banco/expo-sqlite.mjs";

const RADICE_PROGETTO = join(import.meta.dirname, "..", "..");

// ------------------------------------------------------------------ CONTEGGIO
const scenari = [];
let corrente = null;

function ok(nome, condizione, extra = "") {
  if (!corrente) throw new Error("ok() fuori da uno scenario: " + nome);
  corrente.verifiche++;
  if (!condizione) corrente.errori.push(`${nome}${extra ? " — " + extra : ""}`);
}

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

/** Attende che `azione` NON lanci, e restituisce il suo risultato. */
async function passa(nome, azione) {
  try {
    const esito = await azione();
    ok(nome, true);
    return esito;
  } catch (errore) {
    ok(nome, false, "ha lanciato: " + String(errore?.message ?? errore));
    return null;
  }
}

async function prova(nome, azione) {
  corrente = { nome, verifiche: 0, errori: [] };
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
const RADICE = mkdtempSync(join(tmpdir(), "controprova-hlc07-"));
let contatoreIstanze = 0;

async function avvia(dispositivo, cartella) {
  contatoreIstanze++;
  const dove = cartella ?? join(RADICE, "avvio-" + contatoreIstanze);
  configuraCartella(dove);
  const app = await import(`../../lib/db.ts?controprova07=${contatoreIstanze}`);
  await app.apri(dispositivo);
  return { app, base: app.database(), cartella: dove };
}

const oraVera = Date.now;
const congelaOra = (v) => { Date.now = () => v; };
const scongelaOra = () => { Date.now = oraVera; };

/** Proiezione vera di app/(tabs)/note.tsx, ramo "nuovo". */
const proiettaNotaCrea = (id, testo) => async (d, hlc) => {
  await d.runAsync(
    `INSERT INTO note (id, titolo, testo, pubblicabile, creato_a, hlc) VALUES (?,?,?,?,?,?)`,
    [id, null, testo, 0, new Date().toISOString(), hlc]
  );
};

/** Proiezione vera di app/(tabs)/note.tsx, ramo "modifica". */
const proiettaNotaAggiorna = (id, testo) => async (d, hlc) => {
  await d.runAsync(`UPDATE note SET titolo=?, testo=?, pubblicabile=?, hlc=? WHERE id=?`,
    [null, testo, 0, hlc, id]);
};

const leggiMeta = async (base) =>
  (await base.getFirstAsync("SELECT valore FROM meta WHERE chiave='hlc'"))?.valore ?? null;

/**
 * La lettura di apri(), ricopiata alla lettera da lib/db.ts:116-121.
 * Serve a misurare il GIRO COMPLETO scrittura -> lettura senza riaprire il db.
 */
function leggiComeApri(valore) {
  const [ms, cont] = valore.split("-");
  return { ms: parseInt(ms, 16), contatore: parseInt(cont, 16) };
}

// =============================================================== PARTE A
// Onesta' prima di tutto: il meccanismo descritto dalla scheda esiste.
// Se questa parte fallisse, la confutazione sarebbe gratuita e andrebbe buttata.

await prova("A il meccanismo NaN e' reale, con meta VUOTA e iniettata dall'esterno", async () => {
  const primo = await avvia("echonan9");
  await primo.app.registra("note", "seme", "crea", {}, proiettaNotaCrea("seme", "s"));
  // L'UPDATE qui sotto e' la PRECONDIZIONE: nessun codice dell'app la produce.
  // La parte B e' tutta dedicata a dimostrarlo.
  await primo.base.runAsync("UPDATE meta SET valore='' WHERE chiave='hlc'");
  await primo.base.closeAsync();

  const secondo = await avvia("echonan9", primo.cartella);
  const h1 = await secondo.app.registra("note", "n1", "crea", {}, proiettaNotaCrea("n1", "1"));
  ok("il timbro e' '000000000NaN-0NaN-<dispositivo>'", h1 === "000000000NaN-0NaN-echonan9", h1);
  ok("meta diventa 'NaN-NaN': il guasto si autoconserva", (await leggiMeta(secondo.base)) === "NaN-NaN");
  await lancia("la seconda scrittura sulla stessa entita' viola la chiave primaria",
    () => secondo.app.registra("note", "n1", "aggiorna", {}, proiettaNotaAggiorna("n1", "2")),
    "UNIQUE constraint failed: eventi.id");
  ok("CONCLUSIONE A: con meta VUOTA la scheda descrive il comportamento giusto", true);
});

// =============================================================== PARTE B
// Il punto decisivo: l'app puo' scrivere in meta un valore che poi non sa
// rileggere? Se no, la precondizione della scheda non e' raggiungibile.

await prova("B1 meta('hlc') ha UN SOLO scrittore in tutto il codice dell'app", async () => {
  const sorgenti = [];
  const cammina = (cartella) => {
    for (const voce of readdirSync(cartella)) {
      const percorso = join(cartella, voce);
      if (statSync(percorso).isDirectory()) cammina(percorso);
      else if (/\.tsx?$/.test(voce)) sorgenti.push(percorso);
    }
  };
  for (const c of ["lib", "app", "components"]) cammina(join(RADICE_PROGETTO, c));
  ok("i sorgenti esaminati sono molti (il rastrello funziona)", sorgenti.length > 20, String(sorgenti.length));

  const scrittori = sorgenti.filter((p) =>
    /(INSERT\s+INTO|UPDATE|DELETE\s+FROM|REPLACE\s+INTO)\s+meta\b/i.test(readFileSync(p, "utf8")));
  ok("scrive in meta soltanto lib/db.ts",
    scrittori.length === 1 && relative(RADICE_PROGETTO, scrittori[0]) === "lib/db.ts",
    scrittori.map((p) => relative(RADICE_PROGETTO, p)).join(", "));

  // L'altra via per far entrare un NaN nell'orologio sarebbe assorbire un HLC
  // remoto malformato: Orologio.ricevi() con un ms NaN propaga NaN via Math.max.
  // Ma nessuno la chiama: e' codice morto, quindi non e' una via.
  const chiamanti = sorgenti.filter((p) => {
    const testo = readFileSync(p, "utf8");
    return /\.ricevi\s*\(/.test(testo) && /from\s+["'][^"']*hlc["']/.test(testo);
  });
  ok("nessuno chiama Orologio.ricevi(): la via dell'HLC remoto non esiste ancora",
    chiamanti.length === 0, chiamanti.map((p) => relative(RADICE_PROGETTO, p)).join(", "));

  const importatori = sorgenti.filter((p) => {
    const testo = readFileSync(p, "utf8");
    return /import\s*\{[^}]*\bderializza\b[^}]*\}\s*from\s*["'][^"']*hlc["']/.test(testo) ||
      /import\s*\{[^}]*\bdeserializza\b[^}]*\}\s*from\s*["'][^"']*\/hlc["']/.test(testo);
  });
  ok("e nessuno importa deserializza() da hlc fuori dai test",
    importatori.length === 0, importatori.map((p) => relative(RADICE_PROGETTO, p)).join(", "));
});

await prova("B2 sotto orari ostili il valore scritto in meta e' SEMPRE rileggibile", async () => {
  // Sei regimi d'orologio, tutti plausibili su un telefono in viaggio.
  const regimi = [
    ["ora normale", null],
    ["ora congelata (due scritture nello stesso ms)", 1_800_000_000_000],
    ["fuso indietro di due ore", 1_800_000_000_000 - 2 * 3600_000],
    ["RTC azzerato: si riparte dal 1970", 0],
    ["RTC prima del 1970: Date.now() negativo", -86_400_000],
    ["data assurda nel futuro", 4_102_444_800_000],
  ];

  const { app, base } = await avvia("echogiro1");
  let scritture = 0;
  for (const [nome, ora] of regimi) {
    if (ora === null) scongelaOra(); else congelaOra(ora);
    try {
      for (let i = 0; i < 4; i++) {
        const h = await app.registra("note", `g${scritture}`, "crea", {}, proiettaNotaCrea(`g${scritture}`, "x"));
        scritture++;
        const valore = await leggiMeta(base);
        ok(`[${nome}] meta e' di soli esadecimali: ${valore}`,
          /^[0-9a-f]+-[0-9a-f]+$/.test(valore), valore);
        const riletto = leggiComeApri(valore);
        ok(`[${nome}] rileggendolo come fa apri() non esce NaN`,
          Number.isFinite(riletto.ms) && Number.isFinite(riletto.contatore), valore);
        ok(`[${nome}] e il valore riletto e' ESATTAMENTE il timbro appena emesso`,
          riletto.ms === parseInt(h.split("-")[0], 16) &&
          riletto.contatore === parseInt(h.split("-")[1], 16), `${valore} vs ${h}`);
      }
    } finally {
      scongelaOra();
    }
  }
  ok("le scritture provate sono ventiquattro", scritture === 24, String(scritture));
});

await prova("B3 nemmeno il traboccamento del contatore sporca meta", async () => {
  // Il caso limite gia' noto (E4/HLC-05): contatore a ffff e ora ferma.
  const primo = await avvia("echogiro2");
  await primo.app.registra("note", "seme", "crea", {}, proiettaNotaCrea("seme", "s"));
  const msFuturo = Date.now() + 3600_000;
  await primo.base.runAsync("UPDATE meta SET valore = ? WHERE chiave='hlc'",
    [msFuturo.toString(16) + "-ffff"]);
  await primo.base.closeAsync();

  const secondo = await avvia("echogiro2", primo.cartella);
  for (let i = 0; i < 3; i++) {
    await secondo.app.registra("note", `t${i}`, "crea", {}, proiettaNotaCrea(`t${i}`, "x"));
    const valore = await leggiMeta(secondo.base);
    ok(`dopo il traboccamento meta resta esadecimale (${valore})`,
      /^[0-9a-f]+-[0-9a-f]+$/.test(valore), valore);
    ok("e rileggendolo non esce NaN", Number.isFinite(leggiComeApri(valore).ms), valore);
  }
});

await prova("B4 venti riavvii consecutivi: il giro andata-ritorno non si rompe mai", async () => {
  // Il guasto della scheda, se fosse raggiungibile, si autoconserva: basterebbe
  // che UNA volta l'app scrivesse un valore illeggibile perche' resti tale.
  // Venti cicli scrittura/chiusura/riapertura con ore diverse dicono di no.
  let cartella;
  let ultimo = null;
  for (let ciclo = 0; ciclo < 20; ciclo++) {
    const istanza = await avvia("echogiro3", cartella);
    cartella = istanza.cartella;
    congelaOra(1_700_000_000_000 + (ciclo % 3 === 0 ? -ciclo * 5000 : ciclo * 7000));
    try {
      await istanza.app.registra("note", `r${ciclo}`, "crea", {}, proiettaNotaCrea(`r${ciclo}`, "x"));
    } finally {
      scongelaOra();
    }
    ultimo = await leggiMeta(istanza.base);
    ok(`ciclo ${ciclo}: meta rileggibile (${ultimo})`,
      /^[0-9a-f]+-[0-9a-f]+$/.test(ultimo) && Number.isFinite(leggiComeApri(ultimo).ms), ultimo);
    await istanza.base.closeAsync();
  }
  ok("CONCLUSIONE B: l'app non sa produrre la precondizione della scheda", ultimo !== null);
});

// =============================================================== PARTE C
// La scheda nomina DUE valori. Il secondo non si comporta come dice.

await prova("C 'zz-1', il secondo valore della scheda, NON blocca le scritture", async () => {
  const primo = await avvia("echozz1");
  await primo.app.registra("note", "seme", "crea", {}, proiettaNotaCrea("seme", "s"));
  await primo.base.runAsync("UPDATE meta SET valore='zz-1' WHERE chiave='hlc'");
  await primo.base.closeAsync();

  const secondo = await avvia("echozz1", primo.cartella);
  const h1 = await secondo.app.registra("note", "n1", "crea", {}, proiettaNotaCrea("n1", "1"));
  ok("il contatore NON e' 'NaN' come dice la scheda, ma '0002'",
    h1 === "000000000NaN-0002-echozz1", h1);
  ok("quindi il timbro '000000000NaN-0NaN-<dispositivo>' della scheda qui non si presenta",
    h1 !== "000000000NaN-0NaN-echozz1");

  // La scheda: "la seconda scrittura sulla stessa entita' viola la chiave
  // primaria e da li' in poi quell'entita' non e' piu' scrivibile."
  await passa("la SECONDA scrittura sulla stessa entita' riesce, nessuna chiave primaria violata",
    () => secondo.app.registra("note", "n1", "aggiorna", {}, proiettaNotaAggiorna("n1", "2")));
  await passa("e anche la terza",
    () => secondo.app.registra("note", "n1", "aggiorna", {}, proiettaNotaAggiorna("n1", "3")));
  ok("il testo proiettato e' l'ultimo scritto: l'entita' e' viva",
    (await secondo.base.getFirstAsync("SELECT testo FROM note WHERE id='n1'")).testo === "3");
  ok("nel registro ci sono tre eventi su n1, tutti con id diverso",
    (await secondo.base.getAllAsync("SELECT id FROM eventi WHERE entita_id='n1'")).length === 3);

  // Quel che 'zz-1' rompe davvero e' l'ORDINE, non la scrivibilita'.
  const ordine = (await secondo.base.getAllAsync("SELECT entita_id FROM eventi ORDER BY hlc"))
    .map((r) => r.entita_id);
  ok("CONCLUSIONE C: con 'zz-1' si rompe l'ordinamento, NON la scrittura",
    ordine[ordine.length - 1] === "seme", ordine.join(","));
});

// =============================================================== PARTE D
// L'"atteso" della scheda: "un valore corrotto deve essere ignorato e
// l'orologio deve ripartire". Ripartire DA DOVE? Se da Date.now(), la
// correzione chiesta reintroduce il danno che la scheda imputa al difetto.

await prova("D 'ignorare e ripartire' da Date.now() viola l'invariante 2", async () => {
  const { Orologio, serializza } = await import("../../lib/hlc.ts");

  // Scena: il telefono ha gia' scritto eventi con l'ora giusta, poi la batteria
  // si scarica del tutto e l'RTC riparte indietro. E' il caso che l'invariante 2
  // di CLAUDE.md nomina per esteso ("i due dispositivi possono avere fusi orari
  // diversi") e che lo scenario E3/HLC-08 pretende non regredisca.
  const msGiusto = 1_800_000_000_000;
  const { app, base } = await avvia("echorip1");
  congelaOra(msGiusto);
  let ultimoVero;
  try {
    ultimoVero = await app.registra("note", "n1", "crea", {}, proiettaNotaCrea("n1", "a"));
  } finally {
    scongelaOra();
  }

  // L'orologio "ripartito da zero", cioe' esattamente cio' che la scheda chiede.
  const rinato = new Orologio("echorip1");
  const dopoRipartenza = serializza(rinato.adesso(msGiusto - 2 * 3600_000));
  ok("il timbro rigenerato e' MINORE dell'ultimo evento gia' sul disco",
    dopoRipartenza < ultimoVero, `${dopoRipartenza} vs ${ultimoVero}`);
  ok("cioe' ORDER BY hlc metterebbe il nuovo evento PRIMA del vecchio: ordine causale perso",
    dopoRipartenza < ultimoVero);

  // E il caso peggiore: se l'ora e' tornata esattamente dov'era, l'orologio
  // ripartito riemette lo STESSO timbro, quindi lo STESSO id evento.
  const gemello = new Orologio("echorip1");
  const timbroGemello = serializza(gemello.adesso(msGiusto));
  ok("ripartendo con la stessa ora fisica il timbro e' identico al primo",
    timbroGemello === ultimoVero, `${timbroGemello} vs ${ultimoVero}`);
  ok("quindi l'id evento rigenerato collide con uno gia' scritto",
    (await base.getFirstAsync("SELECT id FROM eventi WHERE id = ?",
      [timbroGemello + ":n1"])) !== null);
  ok("CONCLUSIONE D: la correzione chiesta dalla scheda, presa alla lettera, " +
    "riproduce la stessa violazione di chiave primaria che la scheda lamenta", true);

  // Il punto di ripartenza sicuro non e' Date.now(): e' MAX(hlc) del registro,
  // che e' la fonte di verita' (invariante 1) e non puo' regredire.
  const massimo = await base.getFirstAsync("SELECT MAX(hlc) AS m FROM eventi");
  ok("il registro conosce gia' il punto di ripartenza giusto",
    massimo.m === ultimoVero, String(massimo.m));
});

// ------------------------------------------------------------------- RIEPILOGO
const falliti = scenari.filter((s) => s.errori.length);
const verifiche = scenari.reduce((t, s) => t + s.verifiche, 0);
console.log(`\n${scenari.length - falliti.length} scenari su ${scenari.length}, ` +
  `${verifiche - falliti.reduce((t, s) => t + s.errori.length, 0)} verifiche su ${verifiche}`);
rmSync(RADICE, { recursive: true, force: true });
process.exit(falliti.length ? 1 : 0);
