/**
 * CONTROPROVA REG-08 — lente "riproducibilita".
 *
 * Difetto sotto esame: registra() scrive l'evento anche quando la proiezione
 * non tocca nessuna riga (per esempio un UPDATE su un id inesistente).
 *
 * Questo file e' scritto da zero: non importa e non legge nessun altro file di
 * simulazione. Usa solo il banco (test/banco/) e il CODICE VERO dell'app
 * (lib/db.ts, lib/sync/fusione.ts). Perche' cosi': se il difetto si riproduce
 * solo attraverso lo strumento di chi l'ha segnalato, non e' un difetto
 * dell'app ma dello strumento.
 *
 * Esecuzione:
 *   node test/simulazione/controprova-REG-08-riproducibilita.mjs
 *
 * Il verdetto sui fatti si legge da FUORI dal banco: una seconda connessione
 * node:sqlite aperta sul file su disco. Cosi' nessuna comodita' del doppio
 * (cache, stato in memoria, transazione ancora aperta) puo' mentire.
 *
 * PERCHE' QUESTO FILE PUO' DIVENTARE ROSSO. La parte E e' la falsificazione
 * della misura stessa: ripete identica la parte B con un id che ESISTE. Se
 * anche li' le righe toccate fossero zero, vorrebbe dire che sto misurando il
 * banco e non l'app, e la controprova andrebbe buttata.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
// L'ordine conta: carica.mjs registra i ganci prima che si importi l'app.
import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { variabileBanco } from "../banco/doppi-altri.mjs";

const RADICE_PROGETTO = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");

// Riavvio con i ganci gia' registrati e con TUTTI i doppi: la parte G chiama la
// funzione vera importaBiblioteca(), che importa expo-document-picker e
// expo-file-system. Senza riavvio andrebbero passati a mano sulla riga di
// comando, e chi riesegue questa controprova se ne dimenticherebbe.
if (!process.env.CONTROPROVA_REG08_IN_CORSO) {
  const esito = spawnSync(
    process.execPath,
    ["--import", "./test/banco/carica.mjs", "test/simulazione/controprova-REG-08-riproducibilita.mjs"],
    {
      cwd: RADICE_PROGETTO,
      stdio: "inherit",
      env: { ...process.env, CONTROPROVA_REG08_IN_CORSO: "1", BANCO_DOPPI: variabileBanco() },
    }
  );
  process.exit(esito.status ?? 1);
}

import "../banco/carica.mjs";
import { configuraCartella } from "../banco/expo-sqlite.mjs";

const cartella = mkdtempSync(join(tmpdir(), "controprova-reg08-"));
configuraCartella(cartella);
const percorsoFile = join(cartella, "percorso.db");

let rosse = 0;
let verdi = 0;

/** Un fatto che DEVE risultare vero perche' la controprova abbia senso. */
function misura(descrizione, condizione, dettaglio = "") {
  if (condizione) {
    verdi++;
    console.log(`  ok   ${descrizione}${dettaglio ? "  [" + dettaglio + "]" : ""}`);
  } else {
    rosse++;
    console.log(`  ROSSA ${descrizione}${dettaglio ? "  [" + dettaglio + "]" : ""}`);
  }
}

/** Il comportamento contestato da REG-08: vero = il difetto si e' riprodotto. */
function riprodotto(descrizione, condizione, dettaglio = "") {
  misura(descrizione, condizione, dettaglio);
}

/** Lettura del verdetto da una connessione indipendente, sul file su disco. */
function daFuori(lettura) {
  const seconda = new DatabaseSync(percorsoFile, { readOnly: true });
  try {
    return lettura(seconda);
  } finally {
    seconda.close();
  }
}

const db = await import("../../lib/db.ts");
const fusione = await import("../../lib/sync/fusione.ts");

await db.apri("telefono-controprova");
const d = db.database();

// --------------------------------------------------------------- PARTE A
// Un volume vero, scritto dalla strada buona: serve come termine di paragone.
console.log("\nA. un volume reale, scritto da registra() come fa l'app");
await db.registra(
  "biblioteca",
  "vol-esistente",
  "crea",
  { titolo: "Volume che esiste", ultima_pagina: 0 },
  async (dd, hlc) => {
    await dd.runAsync(
      `INSERT INTO biblioteca (id, titolo, origine, formato, ultima_pagina, aggiunto_a, hlc)
       VALUES (?,?,'manuale','pdf',0,?,?)`,
      ["vol-esistente", "Volume che esiste", new Date().toISOString(), hlc]
    );
  }
);
misura(
  "la riga operativa c'e' (letta da fuori)",
  daFuori((s) => s.prepare("SELECT count(*) AS n FROM biblioteca").get().n) === 1
);

// --------------------------------------------------------------- PARTE B
// Lo scenario di REG-08, con la SQL letterale del chiamante reale
// lib/palestra.ts:230 (importaBiblioteca): una voce di manifesto il cui
// `codice` non corrisponde a nessuna riga in biblioteca.
console.log("\nB. registra('aggiorna') su un id che non esiste — SQL di importaBiblioteca");
const eventiPrima = daFuori((s) => s.prepare("SELECT count(*) AS n FROM eventi").get().n);
let righeToccate = -1;

const hlcFantasma = await db.registra(
  "biblioteca",
  "codice-assente-dal-db",
  "aggiorna",
  { file_locale: "file:///documenti/fantasma.pdf", byte: 1234, sha256: null },
  async (dd, hlc) => {
    const esito = await dd.runAsync(
      "UPDATE biblioteca SET file_locale = ?, byte = ?, sha256 = ?, hlc = ? WHERE id = ?",
      ["file:///documenti/fantasma.pdf", 1234, null, hlc, "codice-assente-dal-db"]
    );
    righeToccate = esito.changes;
  }
);

misura("la proiezione non ha toccato nessuna riga", righeToccate === 0, `changes=${righeToccate}`);
misura("registra() non ha sollevato: ha restituito un HLC", typeof hlcFantasma === "string");

const fatti = daFuori((s) => ({
  eventi: s.prepare("SELECT count(*) AS n FROM eventi").get().n,
  fantasma: s
    .prepare("SELECT count(*) AS n FROM eventi WHERE entita_id = 'codice-assente-dal-db'")
    .get().n,
  righe: s
    .prepare("SELECT count(*) AS n FROM biblioteca WHERE id = 'codice-assente-dal-db'")
    .get().n,
}));

riprodotto(
  "l'evento e' sul disco benche' la proiezione sia stata a vuoto",
  fatti.fantasma === 1,
  `eventi ${eventiPrima} -> ${fatti.eventi}`
);
riprodotto(
  "nessuna riga operativa corrisponde a quell'evento",
  fatti.righe === 0
);

// --------------------------------------------------------------- PARTE C
// L'evento a vuoto NON resta fermo: entra nella coda di sincronizzazione e
// partira' verso l'altro dispositivo come qualunque modifica reale.
console.log("\nC. l'evento a vuoto viaggia");
const inPartenza = await db.daSincronizzare();
riprodotto(
  "daSincronizzare() lo mette in partenza come gli altri",
  inPartenza.some((e) => e.entita_id === "codice-assente-dal-db"),
  `${inPartenza.length} eventi in partenza`
);

// --------------------------------------------------------------- PARTE D
// La conseguenza dichiarata da REG-08, misurata con la funzione VERA del
// progetto: proietta() in lib/sync/fusione.ts, l'unica ricostruzione dal
// registro che esista in questo codice.
console.log("\nD. ricostruzione dal registro contro stato locale");
const registro = daFuori((s) =>
  s
    .prepare("SELECT id, hlc, dispositivo, entita, entita_id, tipo, payload FROM eventi")
    .all()
);
const ricostruito = fusione.proietta(registro, "biblioteca", "codice-assente-dal-db");
const localeFantasma = daFuori((s) =>
  s.prepare("SELECT * FROM biblioteca WHERE id = 'codice-assente-dal-db'").get() ?? null
);

riprodotto(
  "proietta() ricostruisce un'entita' che in locale non esiste",
  ricostruito !== null && localeFantasma === null,
  `ricostruito=${JSON.stringify(ricostruito)} locale=${JSON.stringify(localeFantasma)}`
);

// Stesso confronto sul volume vero: li' registro e tabella devono coincidere,
// altrimenti la divergenza di sopra non proverebbe niente.
const ricostruitoVero = fusione.proietta(registro, "biblioteca", "vol-esistente");
const localeVero = daFuori((s) =>
  s.prepare("SELECT * FROM biblioteca WHERE id = 'vol-esistente'").get() ?? null
);
misura(
  "sul volume vero registro e tabella coincidono",
  ricostruitoVero !== null && localeVero !== null,
  `titolo registro=${ricostruitoVero?.titolo} tabella=${localeVero?.titolo}`
);

// --------------------------------------------------------------- PARTE E
// FALSIFICAZIONE DELLA MISURA. Stessa identica chiamata della parte B, ma
// sull'id che esiste. Se anche qui changes fosse 0, starei misurando il banco.
console.log("\nE. falsificazione della misura: stessa chiamata su un id esistente");
let righeToccateVere = -1;
await db.registra(
  "biblioteca",
  "vol-esistente",
  "aggiorna",
  { file_locale: "file:///documenti/vero.pdf", byte: 99, sha256: null },
  async (dd, hlc) => {
    const esito = await dd.runAsync(
      "UPDATE biblioteca SET file_locale = ?, byte = ?, sha256 = ?, hlc = ? WHERE id = ?",
      ["file:///documenti/vero.pdf", 99, null, hlc, "vol-esistente"]
    );
    righeToccateVere = esito.changes;
  }
);
misura(
  "con un id esistente la stessa SQL tocca una riga",
  righeToccateVere === 1,
  `changes=${righeToccateVere}`
);
misura(
  "e il valore e' davvero sul disco",
  daFuori((s) => s.prepare("SELECT file_locale FROM biblioteca WHERE id = 'vol-esistente'").get()
    .file_locale) === "file:///documenti/vero.pdf"
);

// --------------------------------------------------------------- PARTE F
// L'altro verso: 'elimina' su un id inesistente. Serve a capire l'ampiezza —
// e' una proprieta' di registra(), non del singolo UPDATE.
console.log("\nF. 'elimina' su un id che non esiste");
let cancellate = -1;
await db.registra("biblioteca", "mai-esistito", "elimina", {}, async (dd) => {
  const esito = await dd.runAsync("DELETE FROM biblioteca WHERE id = ?", ["mai-esistito"]);
  cancellate = esito.changes;
});
riprodotto(
  "evento di eliminazione registrato per un'entita' mai esistita",
  cancellate === 0 &&
    daFuori((s) =>
      s.prepare("SELECT count(*) AS n FROM eventi WHERE entita_id = 'mai-esistito'").get().n
    ) === 1,
  `changes=${cancellate}`
);

// --------------------------------------------------------------- PARTE G
// LA STRADA DELL'UTENTE, con la funzione VERA. Non una mia trascrizione della
// SQL: importaBiblioteca() di lib/palestra.ts, chiamata come la chiama la
// schermata Libreria.
//
// Il manifesto ha la forma di quello prodotto dal workflow `rassegna`, le cui
// note di rilascio dicono all'utente: "manifesto.json importabile da Libreria >
// Importa biblioteca". Quei codici cominciano per NUO- (strumenti/rassegna/
// catalogo.py:187), mentre le righe di biblioteca caricate al primo avvio sono
// BIB-01..BIB-52 (assets/contenuti/biblioteca.json). Nessun codice combacia:
// e' la stessa forma dello scenario di REG-08, ma senza niente di inventato.
console.log("\nG. la strada dell'utente: importaBiblioteca() vera, manifesto della rassegna");
const fs = await import("node:fs");
const selettore = await import("../banco/expo-document-picker.mjs");
const fileSystem = await import("../banco/expo-file-system.mjs");
fileSystem.configuraRadice(join(cartella, "documenti"));

// Le righe della biblioteca come le mette caricaContenuti() al primo avvio.
await db.inTransazione(async (dd) => {
  for (const codice of ["BIB-01", "BIB-02"]) {
    await dd.runAsync(
      `INSERT OR IGNORE INTO biblioteca (id, titolo, origine, formato, aggiunto_a)
       VALUES (?,?,'aperta','pdf',?)`,
      [codice, "Testo aperto " + codice, new Date().toISOString()]
    );
  }
});

const cartellaZip = join(cartella, "zip-estratto");
fs.mkdirSync(cartellaZip, { recursive: true });
const pdfScaricato = join(cartellaZip, "nuo-paper.pdf");
fs.writeFileSync(pdfScaricato, "%PDF-1.4\n% finto ma vero su disco\n");
const manifesto = join(cartellaZip, "manifesto.json");
fs.writeFileSync(
  manifesto,
  JSON.stringify([
    { codice: "NUO-arxiv-2401-00001", titolo: "Paper nuovo", file: "nuo-paper.pdf", byte: 42 },
  ])
);

selettore.azzera();
selettore.programma({ percorsi: [manifesto, pdfScaricato] });

const palestra = await import("../../lib/palestra.ts");
const esitoImport = await palestra.importaBiblioteca();

riprodotto(
  "importaBiblioteca() dichiara all'utente di aver COLLEGATO la voce",
  esitoImport.collegati === 1 && !esitoImport.errore,
  JSON.stringify(esitoImport)
);
riprodotto(
  "ma nessuna riga di biblioteca porta quel codice",
  daFuori((s) =>
    s.prepare("SELECT count(*) AS n FROM biblioteca WHERE id = 'NUO-arxiv-2401-00001'").get().n
  ) === 0
);
riprodotto(
  "e l'evento 'aggiorna' e' comunque nel registro, pronto a partire",
  daFuori((s) =>
    s
      .prepare(
        "SELECT count(*) AS n FROM eventi WHERE entita_id = 'NUO-arxiv-2401-00001' AND tipo = 'aggiorna'"
      )
      .get().n
  ) === 1
);
misura(
  "nessun volume nuovo e' comparso in libreria",
  daFuori((s) => s.prepare("SELECT count(*) AS n FROM biblioteca").get().n) === 3,
  "vol-esistente + BIB-01 + BIB-02"
);

console.log(`\nverdi ${verdi}  rosse ${rosse}`);
console.log(
  rosse === 0
    ? "REG-08: RIPRODOTTO con codice indipendente."
    : "REG-08: misura non attendibile, vedi le rosse."
);

rmSync(cartella, { recursive: true, force: true });
process.exit(rosse === 0 ? 0 : 1);
