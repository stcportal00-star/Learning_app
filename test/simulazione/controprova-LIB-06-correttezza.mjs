/**
 * CONTROPROVA AVVERSARIALE del difetto LIB-06, lente "correttezza".
 *
 * L'accusa (lib/palestra.ts:321, rimuoviVolume): "Rimuovi" su un volume della
 * biblioteca APERTA cancella la voce di catalogo e la voce non torna piu'.
 * L'atteso dell'accusa: togliere il file scaricato non deve cancellare la voce;
 * il volume deve restare elencato come "non scaricato".
 *
 * Qui NON si cerca di confermare l'accusa: si cerca di SMONTARLA. Ogni verifica
 * confuta(...) e' scritta per diventare VERDE SE L'APP HA RAGIONE. Le vie di
 * scampo cercate sono otto:
 *
 *   A. forse rimuoviVolume() distingue gia' l'origine, e l'accusa legge codice
 *      che non esiste piu' (oggi sono state applicate due correzioni);
 *   B. forse la schermata non offre mai "Rimuovi" su un volume di dotazione,
 *      e lo scenario dell'accusa non e' raggiungibile con un dito;
 *   C. forse la riga sopravvive: il DELETE potrebbe non mordere le voci 'aperta';
 *   D. forse il riavvio la ripiazza: caricaContenuti() semina con INSERT OR
 *      IGNORE, cioe' un'operazione idempotente fatta apposta per ripetersi;
 *   E. forse "Importa biblioteca" la ricrea, che e' il gesto che l'utente farebbe;
 *   F. forse il registro eventi la ricostruisce: e' la fonte di verita'
 *      (invariante 1), e proietta() sa rimettere insieme un'entita';
 *   G. forse la perdita e' irrilevante perche' il volume si riprende a mano con
 *      "Aggiungi PDF", e allora e' un fastidio, non un difetto critico;
 *   H. forse l'accusa esagera sull'altro dispositivo, e va circoscritta.
 *
 * Gira il CODICE VERO sopra il banco (node:sqlite): lib/db.ts, lib/contenuti.ts,
 * lib/palestra.ts, lib/sync/fusione.ts, con i 52 volumi veri di
 * assets/contenuti/biblioteca.json.
 *
 *   node test/simulazione/controprova-LIB-06-correttezza.mjs
 *
 * Non tocca nessun file del progetto: solo letture e una radice temporanea.
 */
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { variabileBanco } from "../banco/doppi-altri.mjs";

const QUESTA_CARTELLA = dirname(fileURLToPath(import.meta.url));
const RADICE_PROGETTO = resolve(QUESTA_CARTELLA, "..", "..");

// --------------------------------------------------------- RIAVVIO CON I GANCI
// I doppi dei moduli nativi vanno registrati prima di qualunque import del
// codice dell'app: il file si riavvia da solo per non chiedere a chi esegue di
// ricordarsi una riga di comando lunga.
if (!process.env.CONTROPROVA_LIB06_IN_CORSO) {
  const esito = spawnSync(
    process.execPath,
    ["--import", "./test/banco/carica.mjs", "test/simulazione/controprova-LIB-06-correttezza.mjs"],
    {
      cwd: RADICE_PROGETTO,
      stdio: "inherit",
      env: { ...process.env, CONTROPROVA_LIB06_IN_CORSO: "1", BANCO_DOPPI: variabileBanco() },
    }
  );
  process.exit(esito.status ?? 1);
}

// ------------------------------------------------------------------ CONTEGGIO
// `confuta` passa quando l'APP ha ragione: e' una via di scampo che si e' aperta
// e il difetto cade. `conferma` passa quando la via di scampo e' chiusa.
// `circoscrive` non assolve ne' condanna: delimita cio' che resta in piedi.
const assoluzioni = [];
const condanne = [];
const confini = [];

function confuta(nome, condizione, extra = "") {
  if (condizione) assoluzioni.push(nome);
  else condanne.push(`${nome} — via di scampo CHIUSA${extra ? ": " + extra : ""}`);
}

function conferma(nome, condizione, extra = "") {
  if (condizione) condanne.push(nome + (extra ? " — " + extra : ""));
  else assoluzioni.push(`${nome} — NON riprodotto${extra ? ": " + extra : ""}`);
}

function circoscrive(nome, testo) {
  confini.push(`${nome}: ${testo}`);
}

// ------------------------------------------------------------- PREPARAZIONE
import * as FS from "../banco/expo-file-system.mjs";
import * as Selettore from "../banco/expo-document-picker.mjs";
import { configuraCartella } from "../banco/expo-sqlite.mjs";
import { installaRequireMetro } from "../banco/require-metro.mjs";

FS.configuraRadice(mkdtempSync(join(tmpdir(), "controprova-lib06-")));
configuraCartella(join(FS.percorsoDocumenti(), "SQLite"));
installaRequireMetro(RADICE_PROGETTO);

// La cartella "esterna": i file che l'utente sceglie non stanno nello spazio
// privato dell'app. Tenerli fuori rende vera la copia che fa il codice.
const esterna = mkdtempSync(join(tmpdir(), "controprova-lib06-esterni-"));

const DB = await import("../../lib/db.ts");
await DB.apri("dispLIB06");
const base = DB.database();
const Contenuti = await import("../../lib/contenuti.ts");
const P = await import("../../lib/palestra.ts");
const Fusione = await import("../../lib/sync/fusione.ts");

const SORGENTE_PALESTRA = readFileSync(join(RADICE_PROGETTO, "lib/palestra.ts"), "utf8");
const SORGENTE_LIBRERIA = readFileSync(join(RADICE_PROGETTO, "app/(tabs)/libreria.tsx"), "utf8");
const CATALOGO_VERO = JSON.parse(
  readFileSync(join(RADICE_PROGETTO, "assets/contenuti/biblioteca.json"), "utf8")
);

const riga = (id) => base.getFirstAsync("SELECT * FROM biblioteca WHERE id = ?", [id]);
const eventiDi = (id) =>
  base.getAllAsync(
    "SELECT id, hlc, dispositivo, entita, entita_id, tipo, payload FROM eventi WHERE entita_id = ? ORDER BY hlc",
    [id]
  );

function contenutoPdf(byte, etichetta) {
  const testa = `%PDF-1.7\n% ${etichetta}\n`;
  const coda = "\ntrailer\n%%EOF\n";
  return Buffer.from(testa + "0".repeat(Math.max(0, byte - testa.length - coda.length)) + coda, "utf8");
}

function scriviEsterno(nome, contenuto) {
  const percorso = join(esterna, nome);
  writeFileSync(percorso, contenuto);
  return percorso;
}

// Il primo avvio vero: i 52 volumi di dotazione entrano da caricaContenuti().
const semina = await Contenuti.caricaContenuti();
const VOLUMI_INIZIALI = (await base.getFirstAsync("SELECT count(*) AS n FROM biblioteca")).n;

// Due cavie prese dal catalogo VERO, non inventate: una voce senza PDF (un
// libro web) e una voce con PDF, cioe' i due casi che l'utente incontra.
const CAVIA_WEB = CATALOGO_VERO.find((v) => v.formato !== "pdf").codice;
const CAVIA_PDF = CATALOGO_VERO.find((v) => v.formato === "pdf").codice;

console.log(`seminati ${semina.biblioteca} volumi; in tabella ${VOLUMI_INIZIALI}`);
console.log(`cavie: ${CAVIA_WEB} (senza PDF) e ${CAVIA_PDF} (con PDF)\n`);

// ====================================================== A. IL CODICE E' CAMBIATO?
// Oggi sono state applicate due correzioni (RO-01, REG-06/07). Se una di esse
// avesse toccato rimuoviVolume(), l'accusa parlerebbe di codice morto.
const corpoRimuovi = SORGENTE_PALESTRA.slice(SORGENTE_PALESTRA.indexOf("export async function rimuoviVolume"));
confuta(
  "A1 rimuoviVolume() guarda l'origine del volume prima di cancellare",
  /origine/.test(corpoRimuovi.slice(0, corpoRimuovi.indexOf("\n}") + 2)),
  "il corpo non nomina mai 'origine'"
);
confuta(
  "A2 rimuoviVolume() azzera il collegamento al file invece di cancellare la riga",
  /UPDATE biblioteca SET file_locale = NULL/.test(corpoRimuovi),
  "l'unica scrittura e' DELETE FROM biblioteca WHERE id = ?"
);

// ================================== B. LO SCENARIO E' RAGGIUNGIBILE CON UN DITO?
// Se "Rimuovi" comparisse solo sui volumi scaricati, un volume di dotazione mai
// scaricato non potrebbe essere cancellato per sbaglio.
const menuLungo = SORGENTE_LIBRERIA.slice(
  SORGENTE_LIBRERIA.indexOf("onLongPress"),
  SORGENTE_LIBRERIA.indexOf("style={{ flex: 1, borderWidth: 1")
);
confuta(
  "B1 la schermata offre 'Rimuovi' solo sui volumi gia' scaricati",
  /file_locale \? \[[^\]]*Rimuovi/s.test(menuLungo),
  "'Rimuovi' sta fuori dal ramo condizionale: e' offerto a ogni volume"
);
confuta(
  "B2 'Rimuovi' chiede una conferma prima di cancellare",
  (menuLungo.match(/Alert\.alert/g) ?? []).length > 1,
  "un solo Alert: il tocco su 'Rimuovi' esegue subito rimuoviVolume()"
);
circoscrive(
  "B3",
  `il catalogo vero ha ${CATALOGO_VERO.length} voci, di cui ` +
    `${CATALOGO_VERO.filter((v) => v.formato !== "pdf").length} senza PDF ` +
    "(libri web): su quelle 'Rimuovi' non puo' liberare spazio, perche' non c'e' " +
    "nessun file da togliere. L'unico effetto possibile e' cancellare la voce."
);

// ================================ C. LA RIGA SOPRAVVIVE AL DELETE? (CODICE VERO)
const primaWeb = await riga(CAVIA_WEB);
await P.rimuoviVolume(CAVIA_WEB);
const dopoWeb = await riga(CAVIA_WEB);
confuta(
  "C1 la voce di dotazione senza PDF sopravvive a 'Rimuovi'",
  dopoWeb !== null,
  `la riga ${CAVIA_WEB} ("${primaWeb.titolo}") e' sparita dalla tabella`
);
confuta(
  "C2 dopo 'Rimuovi' il volume resta elencato come non scaricato",
  (await P.elencaBiblioteca()).some((v) => v.id === CAVIA_WEB),
  "elencaBiblioteca() non lo restituisce piu'"
);

// Il caso dell'accusa alla lettera: volume di dotazione CON il PDF collegato.
const pdfCavia = scriviEsterno("cavia.pdf", contenutoPdf(900, "cavia"));
const manifesto = scriviEsterno(
  "manifesto.json",
  JSON.stringify([{ codice: CAVIA_PDF, titolo: "cavia", file: "cavia.pdf", byte: 900 }])
);
Selettore.azzera();
Selettore.programma({ percorsi: [manifesto, pdfCavia] });
const collegamento = await P.importaBiblioteca();
const collegata = await riga(CAVIA_PDF);
conferma(
  "C3 il volume di dotazione risulta scaricato dopo 'Importa biblioteca'",
  collegamento.collegati === 1 && Boolean(collegata?.file_locale)
);

await P.rimuoviVolume(CAVIA_PDF);
const dopoPdf = await riga(CAVIA_PDF);
confuta(
  "C4 'Rimuovi' toglie il file ma lascia la voce con file_locale a NULL",
  dopoPdf !== null && dopoPdf.file_locale === null,
  dopoPdf === null ? "la riga di catalogo e' stata cancellata insieme al file" : "file_locale ancora valorizzato"
);
circoscrive(
  "C5",
  "con la riga se ne vanno titolo, autore, licenza, url e trimestre: " +
    `per ${CAVIA_PDF} spariscono anche "${collegata.url ?? "(nessun url)"}" e la licenza, ` +
    "cioe' le uniche coordinate per ritrovare il testo."
);

// ========================== D. IL RIAVVIO LA RIPIAZZA? (INSERT OR IGNORE E' IDEMPOTENTE)
// caricaContenuti() semina con INSERT OR IGNORE: se girasse a ogni avvio,
// rimetterebbe da sola le voci cancellate e il difetto sarebbe innocuo.
const secondoAvvio = await Contenuti.caricaContenuti();
confuta(
  "D1 il riavvio dell'app riporta le voci di dotazione cancellate",
  (await riga(CAVIA_WEB)) !== null,
  `caricaContenuti() ha restituito saltato=${secondoAvvio.saltato}: la guardia ` +
    "e' 'SELECT count(*) FROM esercizi', quindi dal secondo avvio non semina piu' nulla"
);
confuta(
  "D2 la semina della biblioteca ha una guardia propria, separata dagli esercizi",
  semina.saltato === false && secondoAvvio.saltato === false,
  "un'unica guardia sugli esercizi governa anche i 52 volumi"
);

// =============================== E. "IMPORTA BIBLIOTECA" LA RICREA? (IL GESTO OVVIO)
// E' cio' che farebbe l'utente: riprendere il pacchetto e reimportarlo.
const pdfRitorno = scriviEsterno("ritorno.pdf", contenutoPdf(900, "ritorno"));
const manifestoRitorno = scriviEsterno(
  "manifesto-ritorno.json",
  JSON.stringify([{ codice: CAVIA_PDF, titolo: "cavia", file: "ritorno.pdf", byte: 900 }])
);
Selettore.azzera();
Selettore.programma({ percorsi: [manifestoRitorno, pdfRitorno] });
const reimportazione = await P.importaBiblioteca();
confuta(
  "E1 reimportare la biblioteca ricrea la voce cancellata",
  (await riga(CAVIA_PDF)) !== null,
  "importaBiblioteca() esegue solo UPDATE ... WHERE id = ?: senza riga non c'e' niente da aggiornare"
);
conferma(
  "E2 la reimportazione riferisce comunque il volume come disponibile offline",
  reimportazione.collegati === 1 && (await riga(CAVIA_PDF)) === null,
  `collegati=${reimportazione.collegati}, senzaFile=${reimportazione.senzaFile}, riga assente`
);

// ============================= F. IL REGISTRO EVENTI LA RICOSTRUISCE? (INVARIANTE 1)
const eventiCavia = await eventiDi(CAVIA_PDF);
const proiezione = Fusione.proietta(eventiCavia, "biblioteca", CAVIA_PDF);
confuta(
  "F1 il registro eventi sa ricostruire la voce cancellata",
  proiezione !== null && Boolean(proiezione.titolo),
  `proietta() restituisce ${proiezione === null ? "null" : JSON.stringify(proiezione)}`
);
confuta(
  "F2 esiste un evento 'crea' per la voce di dotazione, da cui ripartire",
  eventiCavia.some((e) => e.tipo === "crea"),
  "le voci di dotazione entrano da caricaContenuti(), che di proposito non passa dal " +
    "registro: nel registro esistono solo 'aggiorna' e 'elimina'"
);
circoscrive(
  "F3",
  "non e' una violazione dell'invariante 1 ma la sua conseguenza: cio' che non " +
    "e' mai nato da un evento non puo' rinascere da un evento."
);

// ===================== G. SI RIPRENDE A MANO CON "AGGIUNGI PDF"? (RIMEDIO DELL'UTENTE)
const pdfMano = scriviEsterno("a-mano.pdf", contenutoPdf(900, "a-mano"));
Selettore.azzera();
Selettore.programma({ percorsi: [pdfMano] });
const riaggiunto = await P.importaPdf();
confuta(
  "G1 riaggiungere il PDF a mano rimette la voce con il suo codice di catalogo",
  riaggiunto.id === CAVIA_PDF,
  `la voce rinasce con id ${riaggiunto.id} e origine '${riaggiunto.origine}': ` +
    "codice, licenza, url, tema e trimestre non tornano"
);
confuta(
  "G2 il rimedio a mano vale anche per i libri web (nessun PDF da riaggiungere)",
  false,
  `${CATALOGO_VERO.filter((v) => v.formato !== "pdf").length} voci su ${CATALOGO_VERO.length} ` +
    "non hanno alcun file: per loro non esiste rimedio"
);

// ====================================== H. E L'ALTRO DISPOSITIVO? (PORTATA DELL'ACCUSA)
const eliminaInviato = eventiCavia.filter((e) => e.tipo === "elimina");
const useAutoSync = readFileSync(join(RADICE_PROGETTO, "lib/sync/useAutoSync.ts"), "utf8");
circoscrive(
  "H1",
  `l'evento 'elimina' (${eliminaInviato.length}) entra nel pacchetto ed e' ricevuto ` +
    "dall'altro dispositivo, ma useAutoSync inserisce gli eventi e non proietta nulla " +
    `(${/INSERT OR IGNORE INTO eventi/.test(useAutoSync) ? "solo INSERT nel registro" : "verificare"}): ` +
    "oggi la riga sopravvive sul secondo dispositivo, e sopravvive DISALLINEATA. " +
    "Quando la proiezione verra' collegata, la cancellazione la raggiungera'."
);
circoscrive(
  "H2",
  "l'unica via di ritorno misurata e' cancellare i dati dell'app o reinstallarla, " +
    "che rimette i 52 volumi ma butta tentativi, note, sessioni e ripasso."
);

// ------------------------------------------------------------------ VERDETTO
console.log("VIE DI SCAMPO APERTE (l'app ha ragione):");
for (const a of assoluzioni) console.log("  ok  " + a);
console.log("\nVIE DI SCAMPO CHIUSE (il difetto regge):");
for (const c of condanne) console.log("  X   " + c);
console.log("\nCONFINI:");
for (const c of confini) console.log("  ·   " + c);
console.log(
  `\nesito: ${assoluzioni.length} vie aperte, ${condanne.length} chiuse, ${confini.length} confini.`
);
process.exit(0);
