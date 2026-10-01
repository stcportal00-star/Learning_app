/**
 * IL GIRO VERO: il codice dell'app contro il Supabase VERO.
 *
 * Tutto il resto delle prove gira contro un finto PostgREST scritto da noi, e
 * un finto server ha un difetto strutturale: risponde come CREDIAMO che
 * risponda quello vero. Un `Content-Profile` dimenticato, un `on_conflict` con
 * il nome di colonna storto, un payload mandato come stringa invece che come
 * oggetto — tutte cose che il nostro doppio accetta volentieri e che il
 * servizio vero rifiuta, di notte, senza nessuno che guardi.
 *
 * Qui si fa il giro intero con lib/nuvola/ vero sopra node:sqlite:
 *   1. si scrive una nota in locale con registra();
 *   2. la si manda su con sincronizzaNuvola();
 *   3. si cancella ogni traccia locale — evento, riga, segnaposto;
 *   4. si risincronizza, e la nota deve TORNARE: evento riscaricato,
 *      deduplicato, inserito e PROIETTATO nella tabella operativa.
 *
 * Il punto 4 è quello che conta: è la sequenza esatta che fa comparire sul
 * telefono la rassegna raccolta stanotte, e l'unico modo di provarla è farla.
 *
 * Non fa parte di `npm run verifica`: quella deve restare senza rete. Gira in
 * CI, dove la rete c'è. La nota di prova se ne va con un evento «elimina»:
 * dal registro remoto la chiave pubblica non cancella (migrazione 008), e
 * sui dispositivi arrivano tutti e due gli eventi, che si annullano.
 *
 *   node --import ./test/banco/carica.mjs test/rete/giro-vero.mjs
 */
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const QUESTA_CARTELLA = dirname(fileURLToPath(import.meta.url));
const RADICE_PROGETTO = resolve(QUESTA_CARTELLA, "..", "..");

// ------------------------------------------------------- RIAVVIO CON I GANCI
// I ganci del banco vanno registrati PRIMA di qualunque import dell'app, e
// questo e' il solo modo di ottenerlo senza chiedere a chi esegue di
// ricordarsi una riga di comando. Stessa forma di sync-fusione.mjs.
if (!process.env.BANCO_GIRO_VERO_IN_CORSO) {
  const { variabileBanco } = await import("../banco/doppi-altri.mjs");
  const esito = spawnSync(
    process.execPath,
    ["--import", "./test/banco/carica.mjs", "test/rete/giro-vero.mjs"],
    {
      cwd: RADICE_PROGETTO,
      stdio: "inherit",
      env: {
        ...process.env,
        BANCO_GIRO_VERO_IN_CORSO: "1",
        BANCO_SQLITE_CARTELLA: mkdtempSync(join(tmpdir(), "giro-vero-")),
        BANCO_DOPPI: variabileBanco({
          // `lib/sync/stato.ts`, che sincronia.ts si tira dietro, vuole
          // AppState: il doppio di react-native del banco ha solo Platform.
          "react-native": join(RADICE_PROGETTO, "test", "simulazione",
                               "sync-fusione-react-native.mjs"),
        }),
      },
    }
  );
  process.exit(esito.status ?? 1);
}

const { importaApp } = await import("../banco/carica.mjs");
const CARTELLA = process.env.BANCO_SQLITE_CARTELLA;

// Un marchio riconoscibile: se questa prova muore a metà, chi guarda
// l'archivio deve capire in un colpo d'occhio cosa sono queste righe. E
// unico: le righe di prova ora restano nel registro (strumenti/db/008), e un
// job rilanciato ha lo stesso GITHUB_RUN_ID e può avere lo stesso pid.
const MARCHIO = `prova-rete-${process.env.GITHUB_RUN_ID ?? "locale"}-` +
  `${process.env.GITHUB_RUN_ATTEMPT ?? "1"}-${randomUUID().slice(0, 8)}`;

let passate = 0;
const guasti = [];

function ok(nome, condizione, dettaglio = "") {
  if (condizione) { passate++; console.log(`  ok   ${nome}`); }
  else { guasti.push(`${nome}${dettaglio ? `\n       ${dettaglio}` : ""}`); console.log(`  NO   ${nome}`); }
}

function uguale(nome, ottenuto, atteso) {
  const a = JSON.stringify(atteso), o = JSON.stringify(ottenuto);
  ok(nome, a === o, a === o ? "" : `atteso ${a}, ottenuto ${o}`);
}

const Cliente = await importaApp("lib/nuvola/cliente.ts");
const Db = await importaApp("lib/db.ts");
const Sincronia = await importaApp("lib/nuvola/sincronia.ts");

const nuvola = new Cliente.Nuvola();

/**
 * Pulizia delle tabelle che si possono pulire. `eventi` no: da lì la chiave
 * pubblica non cancella più (strumenti/db/008), e la nota di prova se ne va
 * con lapide().
 */
async function ripulisci() {
  const intestazioni = {
    apikey: Cliente.NUVOLA_CHIAVE,
    Authorization: `Bearer ${Cliente.NUVOLA_CHIAVE}`,
    "Content-Profile": Cliente.SCHEMA,
  };
  for (const [tabella, filtro] of [
    ["articoli", `chiave=like.${MARCHIO}*`],
  ]) {
    try {
      await fetch(`${Cliente.NUVOLA_BASE}/rest/v1/${tabella}?${filtro}`, {
        method: "DELETE", headers: intestazioni,
      });
    } catch { /* la pulizia non deve poter far fallire la prova */ }
  }
}

/**
 * Senza questa, la nota di prova resterebbe nel registro remoto e la
 * sincronizzazione la porterebbe fra le note dei due dispositivi. Si annulla
 * come si annulla ogni cosa nel registro: con un evento «elimina», che dopo
 * il «crea» vince per HLC. Rossa se non arriva su: meglio una CI rossa che una
 * nota estranea sul telefono.
 */
async function lapide(id) {
  const nome = "la nota di prova se ne va con un evento «elimina» nel registro remoto";
  try {
    await Db.registra("note", id, "elimina", {}, async (d) => {
      await d.runAsync("DELETE FROM note WHERE id = ?", [id]);
    });
  } catch (e) {
    ok(nome, false, String(e));
    return;
  }
  // Più tentativi, distanziati: finita la prova la cartella temporanea
  // sparisce, e con lei l'unica copia dell'«elimina» non ancora salita.
  let guasto = "";
  for (const attesa of [0, 2000, 4000, 8000]) {
    if (attesa) await new Promise((r) => setTimeout(r, attesa));
    try {
      const su = await Sincronia.sincronizzaNuvola({ scaricaVolumi: false });
      const remoti = await nuvola.seleziona("eventi",
        `select=tipo&entita_id=eq.${encodeURIComponent(id)}`);
      if (su.riuscito && remoti.some((r) => r.tipo === "elimina")) {
        ok(nome, true);
        return;
      }
      guasto = `${su.motivo} · ${JSON.stringify(remoti)}`;
    } catch (e) {
      guasto = String(e);
    }
  }
  ok(nome, false, guasto);
}

/**
 * Le note di prova rimaste senza «elimina» da corse passate (una corsa
 * annullata, la rete caduta proprio alla lapide) si annullano qui, con
 * l'«elimina» che sale insieme alla nota di questa corsa. Con DELETE non si
 * poteva: il «crea» restava, e nessuna corsa dopo lo guardava. Solo quelle
 * più vecchie di un quarto d'ora: una corsa che gira adesso, in parallelo
 * (push e pull request ne avviano due), la propria lapide la manda da sé.
 */
async function riparaOrfane() {
  try {
    const righe = await nuvola.seleziona("eventi",
      "select=entita_id,tipo,creato_a&entita=eq.note&entita_id=like.prova-rete-*" +
      "&order=creato_a.desc&limit=400");
    const annullate = new Set(righe.filter((r) => r.tipo === "elimina").map((r) => r.entita_id));
    const prima = Date.now() - 15 * 60_000;
    const orfane = [...new Set(righe
      .filter((r) => r.tipo === "crea" && !annullate.has(r.entita_id) &&
                     Sincronia.istanteDelServer(r.creato_a) < prima)
      .map((r) => r.entita_id))];
    for (const id of orfane) {
      await Db.registra("note", id, "elimina", {}, async (d) => {
        await d.runAsync("DELETE FROM note WHERE id = ?", [id]);
      });
    }
    if (orfane.length) console.log(`Note di prova orfane annullate: ${orfane.join(", ")}\n`);
  } catch (e) {
    // Una riparazione mancata non ferma la prova: la ritenta la corsa dopo.
    console.log(`Riparazione delle note orfane non riuscita: ${String(e)}\n`);
  }
}

let notaSalita = null;

/**
 * Fissa da dove legge il prossimo scambio: un secondo prima di `creatoA`. La
 * prova non rilegge mai il registro dall'inizio. Uno scambio legge al più
 * 3000 eventi (lib/nuvola/sincronia.ts), e oltre quella misura la nota di
 * prova, che è l'evento più recente, non tornava più giù: CI rossa a ogni
 * push con l'app sana, dal giorno in cui il registro passa i 3000 eventi.
 */
async function leggiDa(creatoA) {
  const soglia = new Date(Sincronia.istanteDelServer(creatoA) - 1000).toISOString();
  await Db.inTransazione(async (dd) => {
    await dd.runAsync(
      `INSERT INTO meta (chiave, valore) VALUES ('nuvola_creato', ?)
       ON CONFLICT (chiave) DO UPDATE SET valore = excluded.valore`, [soglia]);
  });
}

try {
  console.log(`Giro vero contro ${Cliente.NUVOLA_BASE}`);
  console.log(`Marchio di questa corsa: ${MARCHIO}\n`);

  const risponde = await nuvola.raggiungibile();
  ok("la nuvola risponde e la chiave passa", risponde,
     "senza questo il resto non significa niente: esegui strumenti/nuvola/diagnosi.py");

  // Senza rete non si prova niente e non si finge di averlo provato: si esce
  // rosso con una riga sola, invece di ventisette righe di guasti derivati che
  // nascondono l'unico che conta.
  if (risponde) {
  await Db.apri("provarete");
  await riparaOrfane();

  // ---------------------------------------------------------------- 1. scrivi
  const idNota = `${MARCHIO}-nota`;
  const testo = "scritta dal giro vero, e deve tornare indietro";
  await Db.registra("note", idNota, "crea",
    { titolo: "giro vero", testo, pubblicabile: 0, creato_a: new Date().toISOString() },
    async (d, hlc) => {
      await d.runAsync(
        `INSERT INTO note (id, titolo, testo, pubblicabile, creato_a, hlc) VALUES (?,?,?,?,?,?)`,
        [idNota, "giro vero", testo, 0, new Date().toISOString(), hlc]);
    });

  // Anche il primo scambio parte da adesso, non dall'inizio del registro.
  const [ultimo] = await nuvola.seleziona("eventi", "select=creato_a&order=creato_a.desc&limit=1");
  if (ultimo?.creato_a) await leggiDa(ultimo.creato_a);

  const inSospeso = await Db.daSincronizzare(500);
  ok("l'evento è in coda per salire", inSospeso.some((e) => e.entita_id === idNota));

  // ------------------------------------------------------------------ 2. manda
  const salita = await Sincronia.sincronizzaNuvola({ scaricaVolumi: false });
  // Da qui la nota può essere sul server, anche se lo scambio dice di no: la
  // lapide va mandata comunque.
  notaSalita = idNota;
  ok("lo scambio riesce", salita.riuscito, salita.motivo);
  ok("e ha mandato almeno il nostro evento", salita.inviati >= 1, String(salita.inviati));

  const remoti = await nuvola.seleziona("eventi",
    `select=id,hlc,entita,entita_id,tipo,payload,creato_a&entita_id=eq.${encodeURIComponent(idNota)}`);
  uguale("su Supabase c'è esattamente un evento per quella nota", remoti.length, 1);
  ok("con il payload come OGGETTO, non come stringa",
     remoti[0] && typeof remoti[0].payload === "object" && remoti[0].payload !== null,
     JSON.stringify(remoti[0]?.payload)?.slice(0, 120));
  uguale("e il testo è quello scritto qui", remoti[0]?.payload?.testo, testo);

  // ------------------------------------------- 3. cancella ogni traccia locale
  // Evento e riga via; il segnaposto torna a un secondo prima della nota,
  // così lo scambio dopo la deve riscaricare comunque.
  const d = Db.database();
  await Db.inTransazione(async (dd) => {
    await dd.runAsync("DELETE FROM eventi WHERE entita_id = ?", [idNota]);
    await dd.runAsync("DELETE FROM note WHERE id = ?", [idNota]);
  });
  if (remoti[0]?.creato_a) await leggiDa(remoti[0].creato_a);
  const sparita = await d.getFirstAsync("SELECT id FROM note WHERE id = ?", [idNota]);
  ok("in locale non ne resta niente", !sparita);

  // ------------------------------------------------------------- 4. e ritorna
  const discesa = await Sincronia.sincronizzaNuvola({ scaricaVolumi: false });
  ok("il secondo scambio riesce", discesa.riuscito, discesa.motivo);
  ok("l'evento è stato riconosciuto come nuovo e riscaricato",
     discesa.nuovi >= 1, `nuovi=${discesa.nuovi} ricevuti=${discesa.ricevuti}`);
  ok("e la PROIEZIONE ha riscritto la riga operativa",
     discesa.proiezione.scritte >= 1, JSON.stringify(discesa.proiezione));

  const tornata = await d.getFirstAsync("SELECT id, titolo, testo FROM note WHERE id = ?", [idNota]);
  ok("la nota è di nuovo nella tabella", Boolean(tornata), JSON.stringify(tornata));
  uguale("con il testo intatto", tornata?.testo, testo);
  uguale("e il titolo intatto", tornata?.titolo, "giro vero");

  // Il segnaposto deve essere avanzato, o domani si riscarica tutto da capo.
  const segnaposto = await d.getFirstAsync("SELECT valore FROM meta WHERE chiave = 'nuvola_creato'");
  ok("il segnaposto è avanzato", Boolean(segnaposto?.valore), JSON.stringify(segnaposto));

  // ------------------------------------------------------------- 5. deposito
  const percorso = `${MARCHIO}/prova.pdf`;
  const byte = new TextEncoder().encode("%PDF-1.4 giro vero\n");
  const messo = await fetch(
    `${Cliente.NUVOLA_BASE}/storage/v1/object/${Cliente.DEPOSITO}/${percorso}`,
    { method: "POST", headers: {
        apikey: Cliente.NUVOLA_CHIAVE,
        Authorization: `Bearer ${Cliente.NUVOLA_CHIAVE}`,
        "Content-Type": "application/pdf", "x-upsert": "true" },
      body: byte });
  ok("il deposito accetta un file dall'app", messo.ok, String(messo.status));
  const ripreso = await fetch(
    `${Cliente.NUVOLA_BASE}/storage/v1/object/${Cliente.DEPOSITO}/${percorso}`,
    { headers: { apikey: Cliente.NUVOLA_CHIAVE, Authorization: `Bearer ${Cliente.NUVOLA_CHIAVE}` } });
  ok("e lo restituisce identico",
     ripreso.ok && (await ripreso.text()) === "%PDF-1.4 giro vero\n", String(ripreso.status));
  await fetch(`${Cliente.NUVOLA_BASE}/storage/v1/object/${Cliente.DEPOSITO}/${percorso}`,
    { method: "DELETE", headers: {
        apikey: Cliente.NUVOLA_CHIAVE, Authorization: `Bearer ${Cliente.NUVOLA_CHIAVE}` } });
  }
} finally {
  if (notaSalita) await lapide(notaSalita);
  await ripulisci();
  rmSync(CARTELLA, { recursive: true, force: true });
}

console.log("");
if (guasti.length) {
  for (const g of guasti) console.log(`  ✗ ${g}`);
  console.log(`\n${passate} verifiche passate, ${guasti.length} fallite`);
  process.exit(1);
}
console.log(`${passate} verifiche passate`);
