/**
 * SIMULAZIONE DELLA SUPERFICIE "import-database": tutto ciò che entra nell'app
 * passando da un file scelto dall'utente — la parte biblioteca di
 * lib/palestra.ts (importaPdf, importaBiblioteca, apriVolume, rimuoviVolume).
 *
 * Si esegue dalla radice del progetto, senza argomenti e senza variabili:
 *
 *   node test/simulazione/import-database.mjs
 *
 * Il file si riavvia da solo con `--import ./test/banco/carica.mjs` e con
 * BANCO_DOPPI già composta (test/banco/doppi-altri.mjs): i ganci del banco
 * vanno registrati prima di qualunque import del codice dell'app, e questo è
 * l'unico modo di ottenerlo senza chiedere a chi esegue di ricordarsi una
 * riga di comando lunga.
 *
 * COSA SIMULA. Ogni interazione che porta un file da fuori a dentro l'app:
 *   A. il contorno del selettore: opzioni chieste, annullamento, selettore
 *      che fallisce, provider che restituisce una selezione vuota;
 *   B. importazione di un PDF vero, dal tocco alla riga nel registro eventi;
 *   C. IL CUORE DELLA SUPERFICIE: l'utente sceglie un DATABASE al posto di un
 *      PDF (palestra.db, percorso.db, un .sqlite) e l'app lo accetta;
 *   D. file corrotti: zero byte, rumore, PDF troncato, database troncato;
 *   E. nomi ostili consegnati dal provider (assente, vuoto, con ../, enorme);
 *   F. file enorme (40 MB): copia completa e dimensione registrata;
 *   G. permessi negati e disco pieno durante la copia;
 *   H. la scrittura nel registro che fallisce DOPO la copia (file orfano);
 *   I-M. importaBiblioteca: selettore, percorso felice, manifesto corrotto,
 *      manifesto ostile, permessi negati a metà importazione;
 *   N. rimuoviVolume: l'ordine fra cancellazione del file e transazione;
 *   O. apriVolume: cosa succede al file importato quando lo si apre;
 *   P. doppio tocco su "Aggiungi PDF": due importazioni concorrenti;
 *   Q. stato finale: file orfani e righe che puntano al vuoto.
 *
 * DUE TIPI DI VERIFICA, e la differenza conta:
 *   ok(...)      — il comportamento CORRETTO atteso. Rosso = qualcosa non va.
 *   difetto(...) — inchioda un comportamento SBAGLIATO dell'app, misurato qui.
 *                  Verde = il difetto è ancora lì. Rosso = qualcuno l'ha
 *                  corretto e questa prova va aggiornata. I difetti NON sono
 *                  stati corretti: la correzione la decide il coordinatore.
 *
 * Non tocca nulla del progetto: lavora in una radice temporanea che cancella
 * alla fine, e che LASCIA se qualcosa fallisce, per poterla aprire.
 */
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { variabileBanco } from "../banco/doppi-altri.mjs";

const QUESTA_CARTELLA = dirname(fileURLToPath(import.meta.url));
const RADICE_PROGETTO = resolve(QUESTA_CARTELLA, "..", "..");
const ASSET_PALESTRA = join(RADICE_PROGETTO, "assets/contenuti/palestra.db");

// ------------------------------------------------------- RIAVVIO CON I GANCI
if (!process.env.IMPORT_DATABASE_IN_CORSO) {
  const esito = spawnSync(
    process.execPath,
    ["--import", "./test/banco/carica.mjs", "test/simulazione/import-database.mjs"],
    {
      cwd: RADICE_PROGETTO,
      stdio: "inherit",
      env: { ...process.env, IMPORT_DATABASE_IN_CORSO: "1", BANCO_DOPPI: variabileBanco() },
    }
  );
  process.exit(esito.status ?? 1);
}

// ------------------------------------------------------------------ CONTEGGIO
let passati = 0;
const falliti = [];
const difettiInchiodati = [];

function ok(nome, condizione, extra = "") {
  if (condizione) passati++;
  else falliti.push(`${nome}${extra ? " — " + extra : ""}`);
}

/**
 * Inchioda un difetto dell'app: passa finché il comportamento sbagliato è
 * ancora quello misurato qui. Se diventa rosso il difetto è stato corretto,
 * ed è questa prova a dover cambiare.
 */
function difetto(codice, nome, condizione, extra = "") {
  if (condizione) {
    passati++;
    difettiInchiodati.push(`${codice}: ${nome}`);
  } else {
    falliti.push(
      `${codice}: ${nome} — il comportamento è CAMBIATO (difetto corretto?): ` +
        `aggiornare la prova${extra ? " — " + extra : ""}`
    );
  }
}

/** Esegue `azione` aspettandosi un errore che contenga `frammentoAtteso`. */
async function lancia(nome, azione, frammentoAtteso) {
  try {
    await azione();
    falliti.push(`${nome} — non ha lanciato nessun errore`);
    return null;
  } catch (errore) {
    const messaggio = String(errore?.message ?? errore);
    ok(nome, messaggio.includes(frammentoAtteso), messaggio);
    return messaggio;
  }
}

// ------------------------------------------------------------- PREPARAZIONE
import * as FS from "../banco/expo-file-system.mjs";
import * as Selettore from "../banco/expo-document-picker.mjs";
import * as Intento from "../banco/expo-intent-launcher.mjs";
import * as Condivisione from "../banco/expo-sharing.mjs";
import { configuraCartella, openDatabaseSync } from "../banco/expo-sqlite.mjs";
import { installaRequireMetro } from "../banco/require-metro.mjs";

const radice = FS.configuraRadice(mkdtempSync(join(tmpdir(), "import-database-")));
// I database stanno dove li mette expo sul telefono: <documenti>/SQLite.
const cartellaSqlite = configuraCartella(join(FS.percorsoDocumenti(), "SQLite"));
installaRequireMetro(RADICE_PROGETTO);

/**
 * La cartella "esterna": i file che l'utente sceglie NON stanno nello spazio
 * privato dell'app (arrivano da Download, da Drive, da una chiavetta). Tenerli
 * fuori dalla radice del banco è ciò che rende credibile la prova: la copia
 * che il codice dell'app fa è una copia vera fra due mondi diversi.
 */
const esterna = mkdtempSync(join(tmpdir(), "import-database-esterni-"));

const DB = await import("../../lib/db.ts");
await DB.apri("dispimp1");
const base = DB.database();
const P = await import("../../lib/palestra.ts");

// ------------------------------------------------------------------ UTILITÀ
const md5Di = (percorso) => createHash("md5").update(readFileSync(percorso)).digest("hex");
const sha256Di = (percorso) => createHash("sha256").update(readFileSync(percorso)).digest("hex");

function cartellaBiblioteca() {
  return join(FS.percorsoDocumenti(), "biblioteca");
}

function fileBiblioteca() {
  return existsSync(cartellaBiblioteca()) ? readdirSync(cartellaBiblioteca()).sort() : [];
}

function scriviEsterno(nome, contenuto) {
  const percorso = join(esterna, nome);
  writeFileSync(percorso, contenuto);
  return percorso;
}

/** Un PDF plausibile: firma vera, lunghezza a piacere, coda %%EOF. */
function contenutoPdf(byte = 1024, etichetta = "prova") {
  const testa = `%PDF-1.7\n% ${etichetta}\n`;
  const coda = "\ntrailer\n%%EOF\n";
  const riempimento = "0".repeat(Math.max(0, byte - testa.length - coda.length));
  return Buffer.from(testa + riempimento + coda, "utf8");
}

/** Un asset costruito a mano: serve per i nomi che il doppio non saprebbe produrre. */
function assetFinto(percorso, nome) {
  return {
    name: nome,
    uri: FS.uriDa(percorso),
    size: existsSync(percorso) ? statSync(percorso).size : 0,
    mimeType: "application/octet-stream",
    lastModified: Date.now(),
  };
}

async function contaEventi() {
  const r = await base.getFirstAsync("SELECT count(*) AS n FROM eventi");
  return r.n;
}

async function contaBiblioteca() {
  const r = await base.getFirstAsync("SELECT count(*) AS n FROM biblioteca");
  return r.n;
}

async function riga(id) {
  return base.getFirstAsync("SELECT * FROM biblioteca WHERE id = ?", [id]);
}

async function eventiDi(entitaId) {
  return base.getAllAsync(
    "SELECT * FROM eventi WHERE entita_id = ? ORDER BY hlc", [entitaId]);
}

async function metaHlc() {
  const r = await base.getFirstAsync("SELECT valore FROM meta WHERE chiave = 'hlc'");
  return r?.valore ?? null;
}

/**
 * Sostituisce temporaneamente un metodo di File: è così che si simulano i
 * permessi negati e il disco pieno senza toccare il doppio di nessun altro.
 * `copy` vive sul prototipo della classe base, quindi assegnarlo su File lo
 * oscura solo per i file (le cartelle restano sane) e `delete` lo ripristina.
 */
async function conMetodoGuasto(nomeMetodo, sostituto, azione) {
  const originale = Object.getOwnPropertyDescriptor(FS.File.prototype, nomeMetodo);
  Object.defineProperty(FS.File.prototype, nomeMetodo, {
    value: sostituto, configurable: true, writable: true,
  });
  try {
    return await azione();
  } finally {
    if (originale) Object.defineProperty(FS.File.prototype, nomeMetodo, originale);
    else delete FS.File.prototype[nomeMetodo];
  }
}

const negaPermesso = function () {
  throw new Error(
    "UnableToCopyException: EACCES (Permission denied): /data/user/0/app/files/biblioteca"
  );
};

const discoPieno = function () {
  throw new Error("UnableToCopyException: ENOSPC (No space left on device)");
};

// Le righe di dotazione che caricaContenuti() semina al primo avvio: servono a
// importaBiblioteca(), che collega i PDF alle voci di catalogo già presenti.
const SEMI = [
  ["BIB-01", "Use The Index, Luke!", "T1", "html"],
  ["BIB-02", "PostgreSQL Documentation", "T1", "pdf"],
  ["BIB-03", "SQLite Documentation", "T1", "pdf"],
  ["BIB-04", "Designing Data-Intensive Applications", "T2", "pdf"],
  ["BIB-05", "The Art of PostgreSQL", "T2", "pdf"],
  ["BIB-06", "Fundamentals of Data Engineering", "T3", "pdf"],
];
const ADESSO = new Date().toISOString();
for (const [codice, titolo, trimestre, formato] of SEMI) {
  await base.runAsync(
    `INSERT OR IGNORE INTO biblioteca
     (id, titolo, autore, tema_slug, trimestre, origine, licenza, url, formato, aggiunto_a)
     VALUES (?,?,?,?,?,'aperta',?,?,?,?)`,
    [codice, titolo, null, "sql_base", trimestre, "Licenza aperta", "https://esempio.invalid/", formato, ADESSO]
  );
}

// ===================================================== A. IL CONTORNO DEL SELETTORE
// L'annullamento è l'interazione più frequente: il selettore di Android si apre
// a tutto schermo e il tasto indietro è a un dito di distanza.
Selettore.azzera();
Intento.azzera();
Condivisione.azzera();

const eventiIniziali = await contaEventi();
const bibliotecaIniziale = await contaBiblioteca();

Selettore.programma({ annullato: true });
const esitoAnnullato = await P.importaPdf();
const chiamataA = Selettore.giornale.at(-1);

ok("A01 il test e l'app vedono lo stesso doppio del selettore", Selettore.giornale.length === 1);
ok("A02 importaPdf() annullato dall'utente restituisce null", esitoAnnullato === null);
ok(
  "A03 importaPdf() chiede PDF ed EPUB, non 'qualunque file'",
  JSON.stringify(chiamataA.opzioni.type) ===
    JSON.stringify(["application/pdf", "application/epub+zip"]),
  JSON.stringify(chiamataA.opzioni.type)
);
ok(
  "A04 importaPdf() chiede la copia in cache (l'originale può non essere più leggibile)",
  chiamataA.opzioni.copyToCacheDirectory === true
);
ok("A05 importaPdf() chiede un solo file", chiamataA.opzioni.multiple === false);
ok("A06 annullando non nasce nessuna riga in biblioteca", (await contaBiblioteca()) === bibliotecaIniziale);
ok("A07 annullando non nasce nessun evento nel registro", (await contaEventi()) === eventiIniziali);
ok("A08 annullando non nasce nessun file nella cartella biblioteca", fileBiblioteca().length === 0);
ok(
  "A09 annullando non viene nemmeno creata la cartella biblioteca",
  !existsSync(cartellaBiblioteca())
);

// Provider che dice "non annullato" ma non consegna niente: capita con alcuni
// gestori di file di Android, ed è la stessa condizione di uscita.
Selettore.programma({ assets: [] });
ok("A10 selezione vuota (assets: []) restituisce null", (await P.importaPdf()) === null);
Selettore.programma(() => ({ canceled: false, assets: null }));
ok("A11 selezione con assets null restituisce null", (await P.importaPdf()) === null);
ok("A12 nessuna scrittura dopo le selezioni vuote", (await contaEventi()) === eventiIniziali);

// Il selettore che fallisce: su Android succede quando un secondo selettore
// viene aperto mentre il primo è ancora a schermo (doppio tocco).
Selettore.programma({ errore: "ActivityNotFoundException: no document picker" });
await lancia(
  "A13 selettore che fallisce: l'eccezione risale a chi ha chiamato importaPdf()",
  () => P.importaPdf(),
  "ActivityNotFoundException"
);
difetto(
  "IMP-01",
  "app/(tabs)/libreria.tsx chiama importaPdf() senza try/catch: l'errore del selettore diventa una promessa non gestita",
  // La schermata fa: async function aggiungi() { const v = await importaPdf(); ... }
  // Nessun catch: qui si riproduce la stessa catena e si misura che l'errore
  // esce dalla funzione della schermata senza che nessuno lo mostri all'utente.
  await (async () => {
    Selettore.programma({ errore: "Attempt to invoke virtual method on a null object reference" });
    async function aggiungiComeLaSchermata() {
      const v = await P.importaPdf();
      return v ? "Alert: Aggiunto" : "niente";
    }
    try {
      await aggiungiComeLaSchermata();
      return false;
    } catch {
      return true; // nessun messaggio per l'utente: la promessa muore qui
    }
  })()
);

// ============================================== B. IMPORTAZIONE DI UN PDF VERO
const pdfBuono = scriviEsterno("Manuale di SQL.pdf", contenutoPdf(4096, "manuale"));
Selettore.azzera();
Selettore.programma({ percorsi: [pdfBuono] });

const eventiPrimaB = await contaEventi();
const metaPrimaB = await metaHlc();
const volume = await P.importaPdf();

ok("B01 importaPdf() restituisce il volume importato", volume !== null && typeof volume === "object");
ok(
  "B02 l'id del volume è un UUID generato dall'app, non il nome del file",
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(volume.id),
  volume.id
);
ok("B03 la cartella biblioteca viene creata alla prima importazione", existsSync(cartellaBiblioteca()));
ok(
  "B04 il file è copiato come <uuid>.pdf nello spazio privato dell'app",
  fileBiblioteca().includes(`${volume.id}.pdf`),
  fileBiblioteca().join(", ")
);
const copiatoB = join(cartellaBiblioteca(), `${volume.id}.pdf`);
ok("B05 la copia è identica all'originale, byte per byte", md5Di(copiatoB) === md5Di(pdfBuono));
ok("B06 il titolo è il nome del file senza estensione", volume.titolo === "Manuale di SQL", volume.titolo);
ok("B07 l'origine dichiarata è 'manuale'", volume.origine === "manuale");
ok("B08 il formato dedotto è 'pdf'", volume.formato === "pdf");
ok("B09 la pagina di ripresa parte da 0", volume.ultima_pagina === 0);
ok("B10 byte è la dimensione vera del file copiato", volume.byte === statSync(pdfBuono).size, String(volume.byte));
ok("B11 autore, licenza e url restano vuoti (nessuno li conosce)",
  volume.autore === null && volume.licenza === null && volume.url === null);

const rigaB = await riga(volume.id);
ok("B12 la riga in biblioteca esiste dopo l'importazione", rigaB !== null);
ok("B13 file_locale punta al file copiato", rigaB.file_locale === FS.uriDa(copiatoB), String(rigaB.file_locale));
ok("B14 la riga conserva titolo, origine e formato", rigaB.titolo === "Manuale di SQL" && rigaB.origine === "manuale" && rigaB.formato === "pdf");
ok("B15 la riga registra i byte", rigaB.byte === volume.byte);
ok("B16 aggiunto_a è un istante ISO", typeof rigaB.aggiunto_a === "string" && !Number.isNaN(Date.parse(rigaB.aggiunto_a)));
ok("B17 sha256 resta vuoto per un file importato a mano", rigaB.sha256 === null);

const eventiB = await eventiDi(volume.id);
ok("B18 l'importazione scrive esattamente un evento", eventiB.length === 1, String(eventiB.length));
ok("B19 l'evento è di tipo 'crea' sull'entità 'biblioteca'",
  eventiB[0]?.tipo === "crea" && eventiB[0]?.entita === "biblioteca");
ok("B20 l'id dell'evento è <hlc>:<id volume>", eventiB[0]?.id === `${eventiB[0]?.hlc}:${volume.id}`);
ok("B21 la riga e l'evento portano lo stesso hlc", rigaB.hlc === eventiB[0]?.hlc);
ok("B22 il dispositivo dell'evento è quello passato ad apri()", eventiB[0]?.dispositivo === "dispimp1");
const payloadB = JSON.parse(eventiB[0].payload);
ok("B23 il payload dell'evento porta il percorso locale (serve all'altro dispositivo)",
  payloadB.file_locale === rigaB.file_locale);
ok("B24 il payload porta titolo, formato e byte", payloadB.titolo === "Manuale di SQL" && payloadB.formato === "pdf" && payloadB.byte === volume.byte);
ok("B25 il registro cresce di un solo evento", (await contaEventi()) === eventiPrimaB + 1);
ok("B26 meta.hlc avanza con l'importazione", (await metaHlc()) !== metaPrimaB);
const elenco = await P.elencaBiblioteca();
ok("B27 elencaBiblioteca() mostra il volume appena importato", elenco.some((v) => v.id === volume.id));
ok(
  "B28 la copia in cache lasciata dal selettore NON viene ripulita (si accumula a ogni importazione)",
  existsSync(join(FS.percorsoCache(), "Manuale di SQL.pdf"))
);

// Opzioni: la firma le prevede tutte, nessuna schermata le usa oggi.
const pdfOpzioni = scriviEsterno("qualcosa.pdf", contenutoPdf(900, "opzioni"));
Selettore.programma({ percorsi: [pdfOpzioni] });
const conOpzioni = await P.importaPdf({
  titolo: "Titolo scelto a mano", autore: "A. Mirra", tema_slug: "ottimizzazione", trimestre: "T4",
});
const rigaOpzioni = await riga(conOpzioni.id);
ok("B29 opzioni.titolo ha la precedenza sul nome del file", rigaOpzioni.titolo === "Titolo scelto a mano");
ok("B30 opzioni.autore finisce nella riga", rigaOpzioni.autore === "A. Mirra");
ok("B31 opzioni.tema_slug e opzioni.trimestre finiscono nella riga",
  rigaOpzioni.tema_slug === "ottimizzazione" && rigaOpzioni.trimestre === "T4");
const soloT4 = await P.elencaBiblioteca("T4");
ok("B32 elencaBiblioteca('T4') filtra per trimestre", soloT4.length === 1 && soloT4[0].id === conOpzioni.id);

// ========================== C. L'UTENTE SCEGLIE UN DATABASE AL POSTO DI UN PDF
// Il selettore di Android chiede PDF ed EPUB, ma molti gestori di file
// IGNORANO il filtro dei tipi: quello che torna indietro può essere qualunque
// cosa. Qui si misura cosa succede quando è un database.
Selettore.azzera();
Selettore.programma({ percorsi: [ASSET_PALESTRA] });
const dbImportato = await P.importaPdf();

difetto(
  "IMP-02",
  "un database SQLite viene importato in biblioteca senza alcun controllo della firma del file",
  dbImportato !== null
);
const copiaDb = join(cartellaBiblioteca(), `${dbImportato.id}.pdf`);
difetto(
  "IMP-03",
  "il database viene salvato con estensione .pdf (solo .epub è riconosciuto, tutto il resto è 'pdf')",
  existsSync(copiaDb) && dbImportato.formato === "pdf",
  `${dbImportato.formato} — ${fileBiblioteca().join(", ")}`
);
ok(
  "C04 il contenuto copiato è quello del database, non un PDF",
  readFileSync(copiaDb).subarray(0, 15).toString("latin1") === "SQLite format 3",
  readFileSync(copiaDb).subarray(0, 15).toString("latin1")
);
ok("C05 la copia del database è integra (2 MB, identica all'originale)",
  md5Di(copiaDb) === md5Di(ASSET_PALESTRA) && statSync(copiaDb).size === statSync(ASSET_PALESTRA).size);

// La prova che non è un dettaglio formale: il file dentro biblioteca è un
// database vero e leggibile, e nessuna schermata dell'app potrà mai aprirlo.
const apertaDiNascosto = openDatabaseSync(copiaDb, { useNewConnection: true });
const pazienti = await apertaDiNascosto.getFirstAsync("SELECT count(*) AS n FROM pazienti");
await apertaDiNascosto.closeAsync();
difetto(
  "IMP-04",
  "il file salvato come .pdf resta un database interrogabile: in biblioteca finisce un archivio di dati, non un libro",
  typeof pazienti?.n === "number" && pazienti.n > 0,
  `pazienti: ${pazienti?.n}`
);
difetto(
  "IMP-05",
  "il titolo conserva l'estensione .db (la regex toglie solo .pdf e .epub)",
  dbImportato.titolo === "palestra.db",
  dbImportato.titolo
);
const rigaDb = await riga(dbImportato.id);
ok("C08 la riga del database importato è indistinguibile da quella di un PDF",
  rigaDb.origine === "manuale" && rigaDb.formato === "pdf" && rigaDb.file_locale !== null);
ok("C09 l'evento 'crea' viene scritto anche per il database", (await eventiDi(dbImportato.id)).length === 1);

// Cosa succede quando l'utente tocca il volume: l'app consegna al visore di
// sistema un file che dichiara application/pdf e database non lo è.
Intento.azzera();
const esitoApertura = await P.apriVolume(rigaDb);
const intento = Intento.giornale.at(-1);
difetto(
  "IMP-06",
  "apriVolume() lancia un intent VIEW application/pdf su un database, e dichiara 'aperto'",
  esitoApertura === "aperto" && intento?.parametri?.type === "application/pdf",
  `${esitoApertura} / ${intento?.parametri?.type}`
);

// Un .sqlite: stessa storia, estensione diversa.
const sqliteEsterno = scriviEsterno("archivio.sqlite", readFileSync(ASSET_PALESTRA).subarray(0, 65536));
Selettore.programma({ percorsi: [sqliteEsterno] });
const sqliteImportato = await P.importaPdf();
difetto(
  "IMP-07",
  "anche un .sqlite entra in biblioteca come 'pdf'",
  sqliteImportato !== null && sqliteImportato.formato === "pdf" &&
    sqliteImportato.titolo === "archivio.sqlite"
);

// Il caso peggiore: l'utente sceglie il PROPRIO database personale, quello che
// l'app usa per note, tentativi e registro eventi. Sul telefono è raggiungibile
// solo con un gestore di file che veda lo spazio dell'app, ma è raggiungibile.
const percorsoPersonale = join(cartellaSqlite, "percorso.db");
ok("C13 il database personale dell'app esiste dove expo lo mette", existsSync(percorsoPersonale));
Selettore.programma({ percorsi: [percorsoPersonale] });
const personaleImportato = await P.importaPdf();
const copiaPersonale = join(cartellaBiblioteca(), `${personaleImportato.id}.pdf`);
difetto(
  "IMP-08",
  "l'app accetta come 'PDF' una copia del proprio database personale (percorso.db) e la mette in biblioteca",
  existsSync(copiaPersonale) &&
    readFileSync(copiaPersonale).subarray(0, 15).toString("latin1") === "SQLite format 3"
);
ok(
  "C15 la copia è un file distinto dall'originale (non un collegamento)",
  statSync(copiaPersonale).ino !== statSync(percorsoPersonale).ino
);

// ============================================= D. FILE CORROTTI O NON-PDF
const casiCorrotti = [
  ["vuoto.pdf", Buffer.alloc(0), "un file da zero byte"],
  ["rumore.pdf", Buffer.from([0x00, 0xff, 0x10, 0x42, 0x7f, 0x01, 0x99]), "sette byte di rumore"],
  ["troncato.pdf", Buffer.from("%PDF-1.4\n1 0 obj\n<< /Type /Cata", "utf8"), "un PDF tagliato a metà"],
  ["pagina.pdf", Buffer.from("<!DOCTYPE html><html><body>404 Not Found</body></html>", "utf8"), "una pagina HTML salvata come .pdf"],
];
for (const [nome, contenuto, descrizione] of casiCorrotti) {
  const percorso = scriviEsterno(nome, contenuto);
  Selettore.programma({ percorsi: [percorso] });
  const v = await P.importaPdf();
  const arrivato = v && join(cartellaBiblioteca(), `${v.id}.pdf`);
  difetto(
    `IMP-09/${nome}`,
    `${descrizione} viene importato senza obiezioni e compare in biblioteca`,
    v !== null && existsSync(arrivato) && (await riga(v.id)) !== null
  );
  if (nome === "vuoto.pdf") {
    ok("D05 un file da zero byte registra byte = 0, non null", (await riga(v.id)).byte === 0,
      String((await riga(v.id)).byte));
  }
}

// Un database troncato: il caso "file corrotto" che riguarda davvero questa
// superficie. Entra in biblioteca e nessuno si accorgerà mai che è rotto.
const dbTroncato = scriviEsterno("guasto.db", readFileSync(ASSET_PALESTRA).subarray(0, 40000));
Selettore.programma({ percorsi: [dbTroncato] });
const troncatoImportato = await P.importaPdf();
const copiaTroncata = join(cartellaBiblioteca(), `${troncatoImportato.id}.pdf`);
let dbTroncatoLeggibile = true;
try {
  const c = openDatabaseSync(copiaTroncata, { useNewConnection: true });
  await c.getFirstAsync("SELECT count(*) AS n FROM pazienti");
  await c.closeAsync();
} catch {
  dbTroncatoLeggibile = false;
}
ok("D06 il database troncato è davvero illeggibile (il file è corrotto sul serio)", !dbTroncatoLeggibile);
difetto(
  "IMP-10",
  "un file corrotto viene comunque copiato, registrato ed elencato: l'errore emergerà solo all'apertura, in viaggio",
  existsSync(copiaTroncata) && (await riga(troncatoImportato.id)) !== null
);

// L'estensione decide tutto, e la decide con un solo endsWith('.epub').
const casiEstensione = [
  ["appunti", "pdf", "appunti", "nessuna estensione"],
  ["LIBRO.PDF", "pdf", "LIBRO", "estensione maiuscola"],
  ["tomo.EPUB", "epub", "tomo", "epub maiuscolo"],
  ["finto.epub.pdf", "pdf", "finto.epub", "doppia estensione che finisce in pdf"],
  ["libro.pdf.epub", "epub", "libro.pdf", "doppia estensione che finisce in epub"],
  ["archivio.tar.gz", "pdf", "archivio.tar.gz", "un archivio compresso"],
];
for (const [nome, formatoAtteso, titoloAtteso, descrizione] of casiEstensione) {
  const percorso = scriviEsterno(nome, contenutoPdf(300, nome));
  Selettore.programma({ percorsi: [percorso] });
  const v = await P.importaPdf();
  ok(
    `D07/${nome} ${descrizione}: formato '${formatoAtteso}', titolo '${titoloAtteso}'`,
    v.formato === formatoAtteso && v.titolo === titoloAtteso &&
      fileBiblioteca().includes(`${v.id}.${formatoAtteso}`),
    `${v.formato} / ${v.titolo}`
  );
}

// ======================== E. NOMI OSTILI CONSEGNATI DAL PROVIDER DI ANDROID
// `scelto.name` arriva dal provider che ha aperto il file: non è il nome di un
// file sul disco, è una stringa qualsiasi. Alcuni provider non la mandano.
const pdfNome = scriviEsterno("base-nomi.pdf", contenutoPdf(512, "nomi"));

const bibliotecaPrimaE = await contaBiblioteca();
const fileBibliotecaPrimaE = fileBiblioteca().length;
Selettore.programma({ assets: [assetFinto(pdfNome, undefined)] });
const messaggioSenzaNome = await lancia(
  "E01 provider che non manda il nome: importaPdf() solleva",
  () => P.importaPdf(),
  "toLowerCase"
);
difetto(
  "IMP-11",
  "senza scelto.name l'app muore su un TypeError in inglese ('Cannot read properties of undefined'), non su un messaggio comprensibile",
  String(messaggioSenzaNome).includes("Cannot read properties of undefined")
);
ok("E03 il fallimento sul nome avviene PRIMA della copia: nessun file nuovo",
  fileBiblioteca().length === fileBibliotecaPrimaE);
ok("E04 il fallimento sul nome non lascia righe a metà", (await contaBiblioteca()) === bibliotecaPrimaE);

Selettore.programma({ assets: [assetFinto(pdfNome, "")] });
const nomeVuoto = await P.importaPdf();
difetto(
  "IMP-12",
  "un nome vuoto produce un volume dal titolo vuoto, che in elenco appare come una scheda senza testo",
  nomeVuoto !== null && nomeVuoto.titolo === "" && (await riga(nomeVuoto.id)).titolo === ""
);

Selettore.programma({ assets: [assetFinto(pdfNome, "../../fuga.pdf")] });
const nomeConFuga = await P.importaPdf();
ok(
  "E06 un nome con ../ NON fa uscire il file dalla cartella biblioteca (il nome sul disco è l'uuid)",
  existsSync(join(cartellaBiblioteca(), `${nomeConFuga.id}.pdf`)) &&
    !existsSync(join(FS.percorsoDocumenti(), "fuga.pdf"))
);
difetto(
  "IMP-13",
  "il nome ostile finisce però intatto nel titolo mostrato all'utente ('../../fuga')",
  nomeConFuga.titolo === "../../fuga",
  nomeConFuga.titolo
);

const nomeLungo = "L".repeat(300) + ".pdf";
Selettore.programma({ assets: [assetFinto(pdfNome, nomeLungo)] });
const conNomeLungo = await P.importaPdf();
ok("E08 un nome di 300 caratteri non rompe l'importazione", (await riga(conNomeLungo.id)).titolo.length === 300);

Selettore.programma({ assets: [assetFinto(pdfNome, "riga\nsecondariga.pdf")] });
const conACapo = await P.importaPdf();
ok("E09 un nome con un a capo viene salvato letterale", conACapo.titolo === "riga\nsecondariga");

// ========================================================= F. FILE ENORME
// "Aggiungi PDF" su un libro di 40 MB: nessun indicatore di avanzamento,
// nessun limite, nessuna possibilità di annullare. Si misura che almeno il
// file arrivi intero e che la dimensione registrata sia quella vera.
const BYTE_ENORMI = 40 * 1024 * 1024;
const pezzo = Buffer.alloc(1024 * 1024, 0x41);
const pdfEnorme = join(esterna, "Atlante enorme.pdf");
writeFileSync(pdfEnorme, contenutoPdf(1024, "enorme"));
{
  const { appendFileSync } = await import("node:fs");
  while (statSync(pdfEnorme).size < BYTE_ENORMI) appendFileSync(pdfEnorme, pezzo);
}
const byteVeri = statSync(pdfEnorme).size;
Selettore.programma({ percorsi: [pdfEnorme] });
const inizioCopia = Date.now();
const enorme = await P.importaPdf();
const durataCopia = Date.now() - inizioCopia;
const copiaEnorme = join(cartellaBiblioteca(), `${enorme.id}.pdf`);

ok("F01 il file enorme viene importato", enorme !== null && existsSync(copiaEnorme));
ok("F02 la copia da 40 MB è completa, non troncata", statSync(copiaEnorme).size === byteVeri,
  `${statSync(copiaEnorme).size} invece di ${byteVeri}`);
ok("F03 la copia da 40 MB è identica all'originale", md5Di(copiaEnorme) === md5Di(pdfEnorme));
ok("F04 byte registrato è la dimensione vera e completa", (await riga(enorme.id)).byte === byteVeri);
ok("F05 l'evento del file enorme è stato scritto", (await eventiDi(enorme.id)).length === 1);
console.log(`    (F: copia di ${(byteVeri / 1048576).toFixed(0)} MB in ${durataCopia} ms, ` +
  "sul telefono il tocco resta bloccato per tutto questo tempo senza alcun indicatore)");

// =================================== G. PERMESSI NEGATI E DISCO PIENO
const pdfPermessi = scriviEsterno("permessi.pdf", contenutoPdf(700, "permessi"));
const fileBibliotecaPrimaG = fileBiblioteca().length;
const eventiPrimaG = await contaEventi();
const metaPrimaG = await metaHlc();

Selettore.programma({ percorsi: [pdfPermessi] });
const messaggioPermessi = await conMetodoGuasto("copy", negaPermesso, () =>
  lancia("G01 copia con permesso negato: importaPdf() solleva", () => P.importaPdf(), "EACCES")
);
difetto(
  "IMP-14",
  "il permesso negato arriva all'utente come messaggio grezzo del filesystem in inglese, senza traduzione né contesto",
  String(messaggioPermessi).includes("Permission denied")
);
ok("G03 con la copia negata nessun file resta nella cartella biblioteca",
  fileBiblioteca().length === fileBibliotecaPrimaG);
ok("G04 con la copia negata nessun evento viene scritto", (await contaEventi()) === eventiPrimaG);
ok("G05 con la copia negata meta.hlc non avanza", (await metaHlc()) === metaPrimaG);

Selettore.programma({ percorsi: [pdfPermessi] });
await conMetodoGuasto("copy", discoPieno, () =>
  lancia("G06 disco pieno durante la copia: importaPdf() solleva ENOSPC", () => P.importaPdf(), "ENOSPC")
);
ok("G07 con il disco pieno nessuna riga viene creata", (await contaEventi()) === eventiPrimaG);

// Copia che si interrompe a metà: è ciò che succede davvero quando lo spazio
// finisce DURANTE la scrittura di un file grande.
const copiaTroncataMeta = function (destinazione) {
  const arrivo = destinazione.percorso;
  writeFileSync(arrivo, readFileSync(this.percorso).subarray(0, 64));
  throw new Error("UnableToCopyException: ENOSPC (No space left on device) after partial write");
};
Selettore.programma({ percorsi: [pdfPermessi] });
await conMetodoGuasto("copy", copiaTroncataMeta, () =>
  lancia("G08 copia interrotta a metà: importaPdf() solleva", () => P.importaPdf(), "ENOSPC")
);
const orfaniParziali = fileBiblioteca().length - fileBibliotecaPrimaG;
difetto(
  "IMP-15",
  "una copia interrotta lascia un file parziale in biblioteca che nessuna riga nomina: l'app non lo cancellerà mai",
  orfaniParziali === 1,
  `file nuovi: ${orfaniParziali}`
);
ok("G10 il file parziale non ha comunque prodotto né riga né evento", (await contaEventi()) === eventiPrimaG);

// La cartella biblioteca sostituita da un file (succede con una sincronizzazione
// esterna o un ripristino maldestro): l'errore arriva prima di ogni copia.
const percorsoBiblioteca = cartellaBiblioteca();
const parcheggio = join(FS.percorsoDocumenti(), "biblioteca-parcheggio");
renameSync(percorsoBiblioteca, parcheggio);
writeFileSync(percorsoBiblioteca, "non sono una cartella");
Selettore.programma({ percorsi: [pdfPermessi] });
await lancia(
  "G11 cartella biblioteca occupata da un file: l'errore è quello di expo, non una copia a vuoto",
  () => P.importaPdf(),
  "InvalidTypeFolderException"
);
rmSync(percorsoBiblioteca);
renameSync(parcheggio, percorsoBiblioteca);
ok("G12 dopo il guasto la cartella torna al suo posto e l'elenco è intatto",
  (await P.elencaBiblioteca()).length === (await contaBiblioteca()));

// Dopo tutti i guasti il modulo deve essere ancora sano: se non lo fosse, ogni
// prova successiva misurerebbe le macerie invece del comportamento vero.
Selettore.programma({ percorsi: [pdfPermessi] });
const dopoIGuasti = await P.importaPdf();
ok("G13 dopo i guasti una importazione normale riesce ancora", dopoIGuasti !== null &&
  (await riga(dopoIGuasti.id)) !== null);

// ================= H. LA SCRITTURA NEL REGISTRO FALLISCE DOPO LA COPIA
// Disco pieno al momento della transazione, database bloccato, vincolo
// violato: il file è già stato copiato, la transazione no.
await base.execAsync(
  `CREATE TRIGGER blocca_insert BEFORE INSERT ON biblioteca
   WHEN NEW.titolo = 'SCRITTURA-RIFIUTATA'
   BEGIN SELECT RAISE(ABORT, 'simulazione: scrittura rifiutata'); END;`
);
const pdfRifiutato = scriviEsterno("SCRITTURA-RIFIUTATA.pdf", contenutoPdf(640, "rifiutata"));
const fileBibliotecaPrimaH = fileBiblioteca().length;
const eventiPrimaH = await contaEventi();
const metaPrimaH = await metaHlc();
Selettore.programma({ percorsi: [pdfRifiutato] });
await lancia(
  "H01 se la proiezione viene rifiutata, importaPdf() solleva",
  () => P.importaPdf(),
  "simulazione: scrittura rifiutata"
);
ok("H02 nessuna riga resta in biblioteca (l'invariante 1 regge)",
  (await base.getFirstAsync("SELECT count(*) AS n FROM biblioteca WHERE titolo = 'SCRITTURA-RIFIUTATA'")).n === 0);
ok("H03 nessun evento resta nel registro", (await contaEventi()) === eventiPrimaH);
ok("H04 meta.hlc non avanza dopo il rollback", (await metaHlc()) === metaPrimaH);
difetto(
  "IMP-16",
  "il file è già stato copiato prima della transazione: resta sul disco orfano, senza riga e senza modo di cancellarlo dall'app",
  fileBiblioteca().length === fileBibliotecaPrimaH + 1,
  `file nuovi: ${fileBiblioteca().length - fileBibliotecaPrimaH}`
);
await base.execAsync("DROP TRIGGER blocca_insert");
Selettore.programma({ percorsi: [pdfRifiutato] });
const dopoRifiuto = await P.importaPdf();
ok("H06 tolto il vincolo, il registro riprende a scrivere senza strascichi",
  dopoRifiuto !== null && (await eventiDi(dopoRifiuto.id)).length === 1);

// ================== I. IMPORTA BIBLIOTECA: IL CONTORNO DEL SELETTORE
/** Scrive un manifesto e restituisce il percorso. Il contenuto può essere rotto. */
function scriviManifesto(nome, contenuto) {
  return scriviEsterno(nome, typeof contenuto === "string" ? contenuto : JSON.stringify(contenuto, null, 1));
}

/** Il messaggio che app/(tabs)/libreria.tsx mostra dopo daRelease(). */
function messaggioSchermata(r) {
  if (r.errore) return r.errore;
  return `${r.collegati} volumi ora disponibili offline.` +
    (r.senzaFile ? ` ${r.senzaFile} voci senza PDF: sono libri web, da leggere online o da salvare in PDF.` : "");
}

Selettore.azzera();
const eventiPrimaI = await contaEventi();
Selettore.programma({ annullato: true });
const annullataBiblioteca = await P.importaBiblioteca();
const chiamataI = Selettore.giornale.at(-1);
ok("I01 annullando, importaBiblioteca() restituisce collegati 0 e senzaFile 0",
  annullataBiblioteca.collegati === 0 && annullataBiblioteca.senzaFile === 0);
ok("I02 annullando non c'è nessun campo errore", annullataBiblioteca.errore === undefined);
ok("I03 importaBiblioteca() chiede JSON e PDF insieme",
  JSON.stringify(chiamataI.opzioni.type) === JSON.stringify(["application/json", "application/pdf"]));
ok("I04 importaBiblioteca() chiede la selezione multipla", chiamataI.opzioni.multiple === true);
ok("I05 annullando non viene scritto nessun evento", (await contaEventi()) === eventiPrimaI);
difetto(
  "IMP-17",
  "annullando, la schermata annuncia comunque '0 volumi ora disponibili offline.': un annullamento sembra un'importazione riuscita a vuoto",
  messaggioSchermata(annullataBiblioteca) === "0 volumi ora disponibili offline.",
  messaggioSchermata(annullataBiblioteca)
);

const pdfBib02 = scriviEsterno("BIB-02_PostgreSQL_Documentation.pdf", contenutoPdf(3000, "postgres"));
const pdfBib03 = scriviEsterno("BIB-03_SQLite_Documentation.pdf", contenutoPdf(2500, "sqlite"));

Selettore.programma({ percorsi: [pdfBib02, pdfBib03] });
const senzaManifesto = await P.importaBiblioteca();
ok("I07 senza manifesto.json la funzione restituisce un errore come DATO, non come eccezione",
  senzaManifesto.errore === "Seleziona anche manifesto.json insieme ai PDF.");
ok("I08 senza manifesto non viene copiato nessun PDF",
  !fileBiblioteca().includes("BIB-02_PostgreSQL_Documentation.pdf"));
ok("I09 senza manifesto non viene scritto nessun evento", (await contaEventi()) === eventiPrimaI);
ok("I10 la schermata mostra proprio quel messaggio", messaggioSchermata(senzaManifesto) ===
  "Seleziona anche manifesto.json insieme ai PDF.");

// ========================= J. IMPORTA BIBLIOTECA: IL PERCORSO FELICE
const vociBuone = [
  { codice: "BIB-02", titolo: "PostgreSQL Documentation", file: basename(pdfBib02),
    byte: statSync(pdfBib02).size, sha256: sha256Di(pdfBib02) },
  { codice: "BIB-03", titolo: "SQLite Documentation", file: basename(pdfBib03),
    byte: statSync(pdfBib03).size, sha256: sha256Di(pdfBib03) },
  { codice: "BIB-04", titolo: "Designing Data-Intensive Applications" }, // libro web: nessun file
];
const manifestoBuono = scriviManifesto("manifesto.json", vociBuone);
const eventiPrimaJ = await contaEventi();
Selettore.programma({ percorsi: [manifestoBuono, pdfBib02, pdfBib03] });
const esitoJ = await P.importaBiblioteca();

ok("J01 i volumi con PDF risultano collegati", esitoJ.collegati === 2, JSON.stringify(esitoJ));
ok("J02 la voce senza file è contata come 'senza PDF'", esitoJ.senzaFile === 1);
ok("J03 nessun campo errore nel percorso felice", esitoJ.errore === undefined);
ok("J04 i PDF sono copiati in biblioteca con il LORO nome, non con un uuid",
  fileBiblioteca().includes(basename(pdfBib02)) && fileBiblioteca().includes(basename(pdfBib03)));
ok("J05 la copia è identica all'originale",
  md5Di(join(cartellaBiblioteca(), basename(pdfBib02))) === md5Di(pdfBib02));
const rigaJ2 = await riga("BIB-02");
ok("J06 file_locale della riga di catalogo punta alla copia",
  rigaJ2.file_locale === FS.uriDa(join(cartellaBiblioteca(), basename(pdfBib02))));
ok("J07 byte e sha256 del manifesto finiscono nella riga",
  rigaJ2.byte === statSync(pdfBib02).size && rigaJ2.sha256 === sha256Di(pdfBib02));
ok("J08 l'origine resta 'aperta': un volume di catalogo non diventa 'manuale'", rigaJ2.origine === "aperta");
ok("J09 il titolo di catalogo non viene sovrascritto da quello del manifesto",
  rigaJ2.titolo === "PostgreSQL Documentation");
const eventiJ2 = await eventiDi("BIB-02");
ok("J10 il collegamento scrive un evento 'aggiorna'", eventiJ2.length === 1 && eventiJ2[0].tipo === "aggiorna");
ok("J11 la riga e l'evento portano lo stesso hlc", rigaJ2.hlc === eventiJ2[0].hlc);
const payloadJ = JSON.parse(eventiJ2[0].payload);
ok("J12 il payload porta file_locale, byte e sha256",
  payloadJ.file_locale === rigaJ2.file_locale && payloadJ.byte === rigaJ2.byte && payloadJ.sha256 === rigaJ2.sha256);
ok("J13 vengono scritti esattamente due eventi (uno per volume collegato)",
  (await contaEventi()) === eventiPrimaJ + 2);
ok("J14 la voce senza file resta senza file_locale", (await riga("BIB-04")).file_locale === null);
ok("J15 la schermata annuncia il numero giusto",
  messaggioSchermata(esitoJ).startsWith("2 volumi ora disponibili offline."));
const elencoJ = await P.elencaBiblioteca("T1");
ok("J16 elencaBiblioteca mostra i volumi ora disponibili offline",
  elencoJ.filter((v) => v.file_locale).length === 2);

// Seconda importazione dello STESSO pacchetto: l'utente ripete il gesto perché
// non è sicuro che sia andata bene.
Selettore.programma({ percorsi: [manifestoBuono, pdfBib02, pdfBib03] });
const esitoJbis = await P.importaBiblioteca();
ok("J17 la seconda importazione ricollega gli stessi volumi", esitoJbis.collegati === 2);
ok("J18 il PDF già presente viene cancellato e ricopiato senza errori",
  md5Di(join(cartellaBiblioteca(), basename(pdfBib02))) === md5Di(pdfBib02));
ok("J19 i dati finali sono identici (l'operazione è idempotente sui dati)",
  (await riga("BIB-02")).file_locale === rigaJ2.file_locale);
difetto(
  "IMP-18",
  "ogni ripetizione scrive comunque un evento nuovo per volume: il registro cresce e il pacchetto di sincronizzazione con lui",
  (await eventiDi("BIB-02")).length === 2
);

// ==================== K. MANIFESTO CORROTTO: IL CASO "FILE CORROTTO"
// La funzione dichiara di restituire gli errori come dato ({errore}); un JSON
// illeggibile invece solleva, e la schermata non ha try/catch.
//
// Due famiglie, e la differenza è visibile sul disco: JSON.parse viene PRIMA
// della copia dei PDF, il ciclo sulle voci DOPO. Un manifesto con la sintassi
// rotta non lascia nulla; uno sintatticamente valido ma non iterabile lascia
// i PDF già copiati e nessuna riga che li nomini.
const pdfSolitario = scriviEsterno("BIB-05_The_Art_of_PostgreSQL.pdf", contenutoPdf(1800, "arte"));

const rottiAlParse = [
  ["troncato", '[{"codice":"BIB-02","file":"x.pdf"', "Unexpected end of JSON input", "un manifesto tagliato dall'estrazione dello zip"],
  ["vuoto", "", "Unexpected end of JSON input", "un file di zero byte"],
  ["bom", "﻿[]", "not valid JSON", "un manifesto con il BOM iniziale"],
  ["html", "<!DOCTYPE html><html>errore 404</html>", "not valid JSON", "una pagina HTML salvata come manifesto.json"],
  ["virgola", '[{"codice":"BIB-02"},]', "not valid JSON", "una virgola finale di troppo"],
];
for (const [etichetta, contenuto, frammento, descrizione] of rottiAlParse) {
  const percorso = scriviManifesto(`manifesto-${etichetta}.json`, contenuto);
  const primaFile = fileBiblioteca().length;
  const primaEventi = await contaEventi();
  Selettore.programma({ percorsi: [percorso, pdfSolitario] });
  await lancia(
    `K01/${etichetta} ${descrizione}: importaBiblioteca() SOLLEVA invece di restituire {errore}`,
    () => P.importaBiblioteca(),
    frammento
  );
  ok(`K02/${etichetta} il parse precede la copia: nessun PDF finisce in biblioteca`,
    fileBiblioteca().length === primaFile && !fileBiblioteca().includes(basename(pdfSolitario)));
  ok(`K03/${etichetta} nessun evento viene scritto`, (await contaEventi()) === primaEventi);
}
difetto(
  "IMP-19",
  "JSON.parse del manifesto non è protetto: un manifesto illeggibile diventa una promessa non gestita, mentre il campo {errore} esiste già per il manifesto mancante",
  true
);

const rottiAllIterazione = [
  ["oggetto", '{"BIB-02":{"file":"x.pdf"}}', "un oggetto invece di un elenco"],
  ["nullo", "null", "il testo 'null'"],
  ["numero", "123", "un numero"],
];
for (const [etichetta, contenuto, descrizione] of rottiAllIterazione) {
  const percorso = scriviManifesto(`manifesto-${etichetta}.json`, contenuto);
  const primaEventi = await contaEventi();
  if (existsSync(join(cartellaBiblioteca(), basename(pdfSolitario)))) {
    rmSync(join(cartellaBiblioteca(), basename(pdfSolitario)));
  }
  Selettore.programma({ percorsi: [percorso, pdfSolitario] });
  await lancia(
    `K04/${etichetta} ${descrizione}: il for...of solleva 'voci is not iterable'`,
    () => P.importaBiblioteca(),
    "is not iterable"
  );
  difetto(
    `IMP-21/${etichetta}`,
    "manifesto non iterabile: i PDF sono GIÀ stati copiati quando l'errore arriva, e restano in biblioteca senza nessuna riga che li nomini",
    fileBiblioteca().includes(basename(pdfSolitario))
  );
  ok(`K06/${etichetta} nessun evento viene scritto`, (await contaEventi()) === primaEventi);
}

// Un manifesto sintatticamente valido ma pieno di cose sbagliate NON solleva:
// scivola via in silenzio contando tutto come "senza PDF".
const manifestoStringhe = scriviManifesto("manifesto-stringhe.json", ["BIB-02", "BIB-03", "BIB-04"]);
Selettore.programma({ percorsi: [manifestoStringhe, pdfSolitario] });
const esitoStringhe = await P.importaBiblioteca();
difetto(
  "IMP-20",
  "un manifesto di sole stringhe passa senza errore e dichiara tre 'voci senza PDF': l'utente non saprà mai che il manifesto era sbagliato",
  esitoStringhe.collegati === 0 && esitoStringhe.senzaFile === 3,
  JSON.stringify(esitoStringhe)
);

// Il manifesto si riconosce solo dall'estensione: qualunque .json viene letto.
const jsonEstraneo = scriviManifesto("impostazioni.json", { tema: "scuro", lingua: "it" });
Selettore.programma({ percorsi: [jsonEstraneo, pdfSolitario] });
await lancia(
  "K08 un .json qualsiasi viene preso per il manifesto (è l'estensione a decidere)",
  () => P.importaBiblioteca(),
  "is not iterable"
);
const manifestoMaiuscolo = scriviManifesto("MANIFESTO.JSON", [vociBuone[0]]);
Selettore.programma({ percorsi: [manifestoMaiuscolo, pdfBib02] });
const esitoMaiuscolo = await P.importaBiblioteca();
ok("K09 un manifesto con nome maiuscolo viene riconosciuto (find con toLowerCase)",
  esitoMaiuscolo.collegati === 1, JSON.stringify(esitoMaiuscolo));

// Due manifesti nella stessa selezione: vince il primo trovato.
const manifestoAlternativo = scriviManifesto("altro-manifesto.json", [
  { codice: "BIB-06", titolo: "Fundamentals", file: basename(pdfBib03), byte: 1, sha256: "x" },
]);
Selettore.programma({ percorsi: [manifestoMaiuscolo, manifestoAlternativo, pdfBib02, pdfBib03] });
const esitoDueManifesti = await P.importaBiblioteca();
ok("K10 con due .json vince il primo dell'elenco: il secondo è ignorato in silenzio",
  esitoDueManifesti.collegati === 1 && (await riga("BIB-06")).file_locale === null,
  JSON.stringify(esitoDueManifesti));
