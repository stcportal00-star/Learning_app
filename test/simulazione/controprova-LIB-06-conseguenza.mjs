/**
 * CONTROPROVA AVVERSARIALE del difetto LIB-06, lente "CONSEGUENZA".
 *
 * L'accusa: "Rimuovi" su un volume della biblioteca aperta (origine='aperta')
 * cancella la voce di CATALOGO invece di lasciarla elencata come non
 * scaricata, e "il volume non torna piu'".
 *
 * Che il DELETE sia incondizionato e' visibile a occhio in lib/palestra.ts:321
 * ed e' gia' stato misurato dalla lente "riproducibilita". Qui NON si rimisura
 * il meccanismo. Qui si prova a SMONTARE la conseguenza: perche' il difetto sia
 * vero davvero, la catena che porta il danno all'utente — in aereo, su un
 * telefono o un tablet, seguendo l'app COME E' FATTA OGGI — deve chiudersi
 * tutta. Basta un anello aperto e l'app e' assolta.
 *
 * Gli anelli sono cinque, e il compito di questo file e' aprirne almeno uno:
 *
 *   A1  il bottone "Rimuovi" deve essere RAGGIUNGIBILE su un volume 'aperta'
 *       (se l'interfaccia lo nasconde per origine, il difetto e' irraggiungibile);
 *   A2  dopo il tocco, la voce deve sparire da cio' che la schermata LEGGE
 *       (se resta elencata come non scaricata, l'atteso e' gia' rispettato);
 *   A3  RIAVVIARE l'app non deve riseminare il catalogo (caricaContenuti() gira
 *       a ogni avvio: se risemina, il danno dura una sessione e non e' critico);
 *   A4  il rimedio che l'app stessa offre — il bottone "Importa biblioteca" —
 *       non deve far tornare la voce (se la fa tornare, l'utente ha una via
 *       d'uscita in due tocchi e il difetto e' minore);
 *   A5  il danno deve poter accadere OFFLINE, senza rete, perche' lo scenario
 *       dichiarato e' l'aereo.
 *
 * Gira il codice VERO sul banco node:sqlite: lib/db.ts, lib/contenuti.ts,
 * lib/palestra.ts. Il verdetto sul database si legge da una SECONDA connessione
 * in sola lettura, per non credere alla cache di nessun modulo.
 *
 *   node test/simulazione/controprova-LIB-06-conseguenza.mjs
 *
 * NON tocca nulla del progetto: lavora in cartelle temporanee e le cancella.
 */
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";

const QUESTA_CARTELLA = dirname(fileURLToPath(import.meta.url));
const RADICE = resolve(QUESTA_CARTELLA, "..", "..");

// I ganci del banco vanno registrati PRIMA di ogni import del codice dell'app:
// il file si riavvia da solo, cosi' gira anche con un `node` nudo.
if (!process.env.CONTROPROVA_LIB06_CONSEGUENZA) {
  const { variabileBanco, KV_MEMORIA } = await import("../banco/doppi-altri.mjs");
  const esito = spawnSync(
    process.execPath,
    ["--import", "./test/banco/carica.mjs", "test/simulazione/controprova-LIB-06-conseguenza.mjs"],
    {
      cwd: RADICE,
      stdio: "inherit",
      env: {
        ...process.env,
        CONTROPROVA_LIB06_CONSEGUENZA: "1",
        BANCO_DOPPI: variabileBanco({ "expo-sqlite/kv-store": KV_MEMORIA }),
      },
    }
  );
  process.exit(esito.status ?? 1);
}

// ------------------------------------------------------------------ CONTEGGIO
// `aperto` = l'anello NON si chiude: la conseguenza non arriva all'utente.
const aperti = [];
const chiusi = [];
function anello(nome, aperto, dettaglio = "") {
  (aperto ? aperti : chiusi).push(`${nome}${dettaglio ? " — " + dettaglio : ""}`);
  console.log(`  ${aperto ? "APERTO " : "chiuso "}  ${nome}${dettaglio ? "  [" + dettaglio + "]" : ""}`);
}
function misura(nome, valore) {
  console.log(`  misura    ${nome}: ${valore}`);
}

// ------------------------------------------------------------------- SCENARIO
const FS = await import("expo-file-system");
const Picker = await import("expo-document-picker");
const { installaRequireMetro } = await import("../banco/require-metro.mjs");
const { configuraCartella } = await import("../banco/expo-sqlite.mjs");

const radice = FS.configuraRadice(mkdtempSync(join(tmpdir(), "lib06-conseguenza-")));
const cartellaSqlite = configuraCartella(join(FS.percorsoDocumenti(), "SQLite"));
installaRequireMetro(RADICE);
const PERCORSO_DB = join(cartellaSqlite, "percorso.db");

/** Verdetto letto da fuori: se la riga c'e' qui, c'e' davvero sul file. */
function daFuori(sql, parametri = []) {
  const seconda = new DatabaseSync(PERCORSO_DB, { readOnly: true });
  try {
    return seconda.prepare(sql).all(...parametri);
  } finally {
    seconda.close();
  }
}
const unaDaFuori = (sql, p = []) => daFuori(sql, p)[0] ?? null;

const db = await import("../../lib/db.ts");
await db.apri("lib06c");
const contenuti = await import("../../lib/contenuti.ts");
const palestra = await import("../../lib/palestra.ts");

console.log("\n=== LIB-06, lente CONSEGUENZA: si prova ad APRIRE almeno un anello ===\n");

// --------------------------------------------------------------------- A1
// L'anello si apre se l'interfaccia NON offre "Rimuovi" sui volumi 'aperta'.
// Si legge il sorgente della schermata, perche' e' li' che vive il bottone:
// se ci fosse un filtro per origine, il codice di lib/palestra.ts non sarebbe
// mai raggiunto con un id 'aperta' e il difetto sarebbe teorico.
const schermata = readFileSync(join(RADICE, "app/(tabs)/libreria.tsx"), "utf8");
const menuLungo = schermata.slice(schermata.indexOf("onLongPress"), schermata.indexOf("style={{ flex: 1, borderWidth"));
const rimuoviProtetto = /origine[^\n]*Rimuovi|Rimuovi[^\n]*origine/.test(menuLungo);
anello("A1 il menu lungo offre 'Rimuovi' anche sui volumi 'aperta'", rimuoviProtetto,
  rimuoviProtetto ? "l'interfaccia filtra per origine" : "nessun filtro su origine nel menu");

// Peggioramento misurabile, non un anello a se': su un volume 'aperta' MAI
// scaricato il ramo "Apri con il visore" non viene montato, quindi l'unica
// azione offerta oltre ad Annulla e' proprio quella distruttiva.
const apriSoloSeScaricato = /item\.file_locale\s*\?\s*\[\{[^\]]*Apri con il visore/.test(menuLungo);
misura("azioni offerte su un volume 'aperta' non scaricato",
  apriSoloSeScaricato ? "solo 'Rimuovi' e 'Annulla'" : "anche altre");
misura("conferma supplementare prima della cancellazione",
  /Alert\.alert\([^)]*Alert\.alert/s.test(menuLungo) ? "presente" : "assente: un solo tocco cancella");

// --------------------------------------------------------------------- A2
// Primo avvio: il catalogo entra nel database come lo trova l'utente.
const caricati = await contenuti.caricaContenuti();
const CODICE = daFuori("SELECT id FROM biblioteca WHERE origine = 'aperta' ORDER BY id")[0]?.id;
const prima = unaDaFuori("SELECT * FROM biblioteca WHERE id = ?", [CODICE]);
misura("catalogo seminato al primo avvio", `${caricati.biblioteca} voci 'aperta'`);
misura("volume scelto per la prova", `${CODICE} (file_locale: ${prima?.file_locale ?? "vuoto"})`);

// L'utente tocca "Rimuovi". Si guarda cosa LEGGE la schermata dopo: elencare e'
// esattamente cio' che fa `ricarica()` in libreria.tsx.
await palestra.rimuoviVolume(CODICE);
const elencoDopo = await palestra.elencaBiblioteca();
const ancoraElencato = elencoDopo.some((v) => v.id === CODICE);
anello("A2 dopo 'Rimuovi' la voce sparisce dall'elenco che la schermata legge",
  ancoraElencato,
  ancoraElencato ? "resta elencata: l'atteso e' rispettato" : "non e' piu' fra i volumi elencati");

// --------------------------------------------------------------------- A3
// caricaContenuti() gira a OGNI avvio (app/_layout.tsx:26) e le voci sono
// scritte con INSERT OR IGNORE: se la guardia guardasse la biblioteca, il
// riavvio riseminerebbe la voce e il danno durerebbe una sola sessione.
const riavvio = await contenuti.caricaContenuti();
const tornataDopoRiavvio = unaDaFuori("SELECT * FROM biblioteca WHERE id = ?", [CODICE]) !== null;
misura("secondo avvio: caricaContenuti()", riavvio.saltato ? "SALTATO" : "rieseguito");
anello("A3 riavviare l'app non rimette la voce nel catalogo", tornataDopoRiavvio,
  riavvio.saltato
    ? "la guardia conta gli esercizi, non la biblioteca: il riseminamento non parte mai"
    : "il riseminamento e' ripartito");

// --------------------------------------------------------------------- A4
// Il rimedio che l'app OFFRE all'utente: il bottone "Importa biblioteca".
// Se rimettesse la voce, l'utente avrebbe una via d'uscita e il difetto
// scenderebbe di gravita'. Si chiama la funzione VERA con il selettore doppio.
const cartellaRelease = mkdtempSync(join(tmpdir(), "release-lib06c-"));
const pdfVolume = join(cartellaRelease, "volume.pdf");
writeFileSync(pdfVolume, "%PDF-1.4 volume della biblioteca aperta\n".repeat(5));
const manifesto = join(cartellaRelease, "manifesto.json");
writeFileSync(manifesto, JSON.stringify([
  { codice: CODICE, titolo: prima.titolo, file: "volume.pdf",
    byte: readFileSync(pdfVolume).length, sha256: "c".repeat(64) },
]));

Picker.azzera();
Picker.programma({ percorsi: [manifesto, pdfVolume] });
const esitoImporto = await palestra.importaBiblioteca();
const tornataDopoImporto = unaDaFuori("SELECT * FROM biblioteca WHERE id = ?", [CODICE]) !== null;
anello("A4 reimportare la biblioteca dalla release non rimette la voce", tornataDopoImporto,
  tornataDopoImporto ? "la voce e' tornata" : "importaBiblioteca fa solo UPDATE: 0 righe toccate");

// Quanto e' fuorviante il rimedio: il messaggio mostrato dalla schermata
// (libreria.tsx:27-29) conta i "collegati" senza guardare le righe toccate.
misura("messaggio mostrato all'utente dopo la reimportazione",
  `"${esitoImporto.collegati} volumi ora disponibili offline" (senzaFile: ${esitoImporto.senzaFile})`);
misura("voci davvero presenti in catalogo con quel codice",
  String(daFuori("SELECT id FROM biblioteca WHERE id = ?", [CODICE]).length));

// --------------------------------------------------------------------- A5
// Lo scenario dichiarato e' l'aereo. Se una delle operazioni avesse bisogno di
// rete, offline il danno non accadrebbe. Si controlla che il percorso che
// cancella non tocchi la rete: nessuna fetch nel giro rimuoviVolume/registra.
const sorgentePalestra = readFileSync(join(RADICE, "lib/palestra.ts"), "utf8");
const sorgenteDb = readFileSync(join(RADICE, "lib/db.ts"), "utf8");
const usaRete = /\bfetch\s*\(|XMLHttpRequest/.test(sorgentePalestra + sorgenteDb);
anello("A5 la cancellazione avviene interamente offline", usaRete,
  usaRete ? "c'e' una chiamata di rete nel percorso" : "solo SQLite locale: funziona in aereo");

// --------------------------------------------------------------------- COSTO
// Non e' un anello: serve al coordinatore per decidere se sta nella scadenza.
const righeRimuovi = sorgentePalestra.split("\n").slice(320, 331).join("\n");
console.log("\n--- superficie della correzione (lib/palestra.ts, rimuoviVolume) ---");
console.log(righeRimuovi);
const chiamateRimuovi = (readFileSync(join(RADICE, "app/(tabs)/libreria.tsx"), "utf8")
  .match(/rimuoviVolume\(/g) ?? []).length;
misura("chiamanti di rimuoviVolume nell'interfaccia", String(chiamateRimuovi));

// ------------------------------------------------------------------- VERDETTO
rmSync(radice, { recursive: true, force: true });
rmSync(cartellaRelease, { recursive: true, force: true });

console.log(`\nAnelli APERTI (assolvono l'app): ${aperti.length}`);
for (const a of aperti) console.log(`  APERTO: ${a}`);
console.log(`Anelli chiusi (la conseguenza passa): ${chiusi.length}`);
console.log(
  aperti.length > 0
    ? "\nLIB-06 CONFUTATO sulla conseguenza: almeno un anello non si chiude."
    : "\nLIB-06 NON confutato: la catena si chiude tutta, il danno raggiunge l'utente."
);
process.exit(0);
