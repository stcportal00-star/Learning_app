/**
 * Controprova LIB-06 — lente "riproducibilita".
 *
 * Difetto da CONFUTARE: "Rimuovi" su un volume della biblioteca aperta
 * (origine='aperta') cancellerebbe la voce di catalogo invece di lasciarla
 * elencata come non scaricata, e il volume non tornerebbe piu'.
 *
 * Questo file e' scritto da zero e non importa ne' legge la simulazione
 * dell'altro agente: chiama solo il codice VERO dell'app sopra il banco
 * (lib/db.ts, lib/contenuti.ts, lib/palestra.ts su node:sqlite).
 *
 * Il verdetto si legge da FUORI dal banco: una seconda connessione a
 * percorso.db aperta con node:sqlite in sola lettura. Cosi' non si crede alla
 * cache di nessun modulo — si guarda cosa c'e' davvero sul file.
 *
 * Si esegue dalla radice del progetto, senza variabili d'ambiente:
 *
 *   node test/simulazione/controprova-LIB-06-riproducibilita.mjs
 *
 * NON tocca nulla del progetto: lavora in una radice temporanea e la cancella.
 */
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";

const QUESTA_CARTELLA = dirname(fileURLToPath(import.meta.url));
const RADICE_PROGETTO = resolve(QUESTA_CARTELLA, "..", "..");

// ------------------------------------------------------- RIAVVIO CON I GANCI
// I ganci del banco vanno registrati PRIMA di qualunque import del codice
// dell'app: il file si riavvia da solo, cosi' chi esegue non deve ricordare
// nessuna riga di comando.
if (!process.env.CONTROPROVA_LIB06_IN_CORSO) {
  const { variabileBanco, KV_MEMORIA } = await import("../banco/doppi-altri.mjs");
  const esito = spawnSync(
    process.execPath,
    ["--import", "./test/banco/carica.mjs", "test/simulazione/controprova-LIB-06-riproducibilita.mjs"],
    {
      cwd: RADICE_PROGETTO,
      stdio: "inherit",
      env: {
        ...process.env,
        CONTROPROVA_LIB06_IN_CORSO: "1",
        BANCO_DOPPI: variabileBanco({ "expo-sqlite/kv-store": KV_MEMORIA }),
      },
    }
  );
  process.exit(esito.status ?? 1);
}

// ------------------------------------------------------------------ CONTEGGIO
let passati = 0;
const falliti = [];
function ok(nome, condizione, extra = "") {
  if (condizione) passati++;
  else falliti.push(`${nome}${extra ? " — " + extra : ""}`);
}
/** Asserzione che INCHIODA il difetto: passa quando il difetto e' presente. */
function difetto(nome, condizione, extra = "") {
  ok(`[DIFETTO] ${nome}`, condizione, extra);
}

// ------------------------------------------------------------------- SCENARIO
const FS = await import("expo-file-system");
const Picker = await import("expo-document-picker");
const { installaRequireMetro } = await import("../banco/require-metro.mjs");
const { configuraCartella } = await import("../banco/expo-sqlite.mjs");

const radice = FS.configuraRadice(mkdtempSync(join(tmpdir(), "controprova-lib06-")));
// I database dove li mette expo sul telefono: <documenti>/SQLite.
const cartellaSqlite = configuraCartella(join(FS.percorsoDocumenti(), "SQLite"));
installaRequireMetro(RADICE_PROGETTO);

const PERCORSO_DB = join(cartellaSqlite, "percorso.db");

/**
 * Il verdetto letto da fuori: connessione indipendente al file, in sola
 * lettura. Se la riga c'e' qui, c'e' davvero.
 */
function daFuori(sql, parametri = []) {
  const seconda = new DatabaseSync(PERCORSO_DB, { readOnly: true });
  try {
    return seconda.prepare(sql).all(...parametri);
  } finally {
    seconda.close();
  }
}
function unaDaFuori(sql, parametri = []) {
  return daFuori(sql, parametri)[0] ?? null;
}

const db = await import("../../lib/db.ts");
await db.apri("lib06");
const contenuti = await import("../../lib/contenuti.ts");
const palestra = await import("../../lib/palestra.ts");

// ---- 1. primo avvio: il catalogo della biblioteca aperta entra nel database
const caricati = await contenuti.caricaContenuti();
ok("primo avvio: caricaContenuti() ha seminato il catalogo",
  caricati.saltato === false && caricati.biblioteca > 0, JSON.stringify(caricati));

const CODICE = "BIB-01";
const primaRiga = unaDaFuori("SELECT * FROM biblioteca WHERE id = ?", [CODICE]);
ok("il volume del catalogo esiste, e' 'aperta' e non e' ancora scaricato",
  primaRiga?.origine === "aperta" && primaRiga?.file_locale == null,
  JSON.stringify(primaRiga));

// ---- 2. l'utente importa la biblioteca dalla release: il volume si scarica
const cartellaFinta = mkdtempSync(join(tmpdir(), "release-lib06-"));
const pdfVolume = join(cartellaFinta, "bib-01.pdf");
writeFileSync(pdfVolume, "%PDF-1.4 volume della biblioteca aperta\n".repeat(5));
const manifesto = join(cartellaFinta, "manifesto.json");
writeFileSync(manifesto, JSON.stringify([
  { codice: CODICE, titolo: "Use The Index, Luke!", file: "bib-01.pdf",
    byte: readFileSync(pdfVolume).length, sha256: "b".repeat(64) },
]));

Picker.programma({ percorsi: [manifesto, pdfVolume] });
const importazione = await palestra.importaBiblioteca();
ok("importaBiblioteca() collega il volume del catalogo",
  importazione.collegati === 1, JSON.stringify(importazione));

const scaricata = unaDaFuori("SELECT * FROM biblioteca WHERE id = ?", [CODICE]);
ok("dopo l'importazione il volume ha il file locale",
  Boolean(scaricata?.file_locale), JSON.stringify(scaricata));
const percorsoPdfLocale = FS.percorsoDa(scaricata.file_locale);
ok("il PDF esiste davvero nello spazio privato dell'app", existsSync(percorsoPdfLocale));

// ---- 3. tocco lungo -> "Rimuovi" (app/(tabs)/libreria.tsx riga 85:
//        la voce e' offerta per OGNI volume, senza distinzione di origine)
await palestra.rimuoviVolume(CODICE);

ok("Rimuovi cancella il PDF scaricato (questo e' giusto)", !existsSync(percorsoPdfLocale));

const dopoRimozione = unaDaFuori("SELECT * FROM biblioteca WHERE id = ?", [CODICE]);
difetto("la voce di CATALOGO sparisce invece di restare 'non scaricata'",
  dopoRimozione === null,
  dopoRimozione ? JSON.stringify(dopoRimozione) : "riga assente");

const elenco = await palestra.elencaBiblioteca();
difetto("la schermata Libreria non elenca piu' il volume",
  !elenco.some((v) => v.id === CODICE), `elencati: ${elenco.length}`);

// ---- 4. "non torna piu'": le tre sole strade per riaverlo
// 4a. riavvio dell'app: caricaContenuti() salta, perche' gli esercizi ci sono
const secondoAvvio = await contenuti.caricaContenuti();
ok("al riavvio caricaContenuti() salta (guardia su esercizi)", secondoAvvio.saltato === true);
difetto("il riavvio dell'app NON riporta la voce di catalogo",
  unaDaFuori("SELECT * FROM biblioteca WHERE id = ?", [CODICE]) === null);

// 4b. nuova importazione dalla release: importaBiblioteca() fa solo UPDATE
Picker.programma({ percorsi: [manifesto, pdfVolume] });
const secondaImportazione = await palestra.importaBiblioteca();
difetto("reimportare la biblioteca NON ricrea la riga (solo UPDATE, nessun INSERT)",
  unaDaFuori("SELECT * FROM biblioteca WHERE id = ?", [CODICE]) === null,
  JSON.stringify(secondaImportazione));
difetto("...e l'app dichiara comunque all'utente che il volume e' disponibile",
  secondaImportazione.collegati === 1, JSON.stringify(secondaImportazione));

// 4c. il registro: l'eliminazione e' un evento sincronizzabile, quindi la
//     perdita viaggia anche sull'altro dispositivo, e nessun evento 'crea'
//     esiste per una riga di catalogo (i contenuti non passano dal registro).
const eventi = daFuori(
  "SELECT tipo, COUNT(*) AS n FROM eventi WHERE entita = 'biblioteca' AND entita_id = ? GROUP BY tipo",
  [CODICE]
);
const perTipo = Object.fromEntries(eventi.map((e) => [e.tipo, e.n]));
difetto("nel registro c'e' l'evento 'elimina' e nessun 'crea' che possa ricostruirla",
  (perTipo.elimina ?? 0) === 1 && (perTipo.crea ?? 0) === 0, JSON.stringify(perTipo));

// ---- 5. controllo: su un volume 'manuale' la cancellazione e' giusta,
//        quindi il difetto e' nella mancata distinzione, non in DELETE in se'.
const pdfMio = join(cartellaFinta, "Appunti miei.pdf");
writeFileSync(pdfMio, "%PDF-1.4 appunti\n");
Picker.programma({ percorsi: [pdfMio] });
const mio = await palestra.importaPdf();
ok("importaPdf() crea un volume 'manuale'", mio?.origine === "manuale");
await palestra.rimuoviVolume(mio.id);
ok("Rimuovi su un volume 'manuale' cancella la riga, ed e' corretto: era tuo, e lo puoi riaggiungere",
  unaDaFuori("SELECT * FROM biblioteca WHERE id = ?", [mio.id]) === null);

// ---- 5bis. il caso peggiore: un volume 'aperta' MAI scaricato.
//        Qui non c'e' nessun file da liberare, quindi "Rimuovi" non puo'
//        significare altro che "togli dall'elenco": e invece distrugge la voce.
const MAI_SCARICATO = "BIB-02";
const primaMai = unaDaFuori("SELECT origine, file_locale FROM biblioteca WHERE id = ?", [MAI_SCARICATO]);
ok("il secondo volume e' 'aperta' e non e' mai stato scaricato",
  primaMai?.origine === "aperta" && primaMai?.file_locale == null, JSON.stringify(primaMai));
await palestra.rimuoviVolume(MAI_SCARICATO);
difetto("Rimuovi su un volume mai scaricato cancella comunque la voce di catalogo",
  unaDaFuori("SELECT * FROM biblioteca WHERE id = ?", [MAI_SCARICATO]) === null);

// ---- 6. quanto e' grande la perdita: quante voci di catalogo sono a rischio
const catalogo = unaDaFuori("SELECT COUNT(*) AS n FROM biblioteca WHERE origine = 'aperta'");
console.log(`\nVoci di catalogo 'aperta' ancora presenti: ${catalogo.n} (seminate: ${caricati.biblioteca})`);

// ------------------------------------------------------------------- VERDETTO
rmSync(radice, { recursive: true, force: true });
rmSync(cartellaFinta, { recursive: true, force: true });

console.log(`\nPassate: ${passati}   Fallite: ${falliti.length}`);
for (const f of falliti) console.log(`  FALLITA: ${f}`);
console.log(
  falliti.length === 0
    ? "\nLIB-06 RIPRODOTTO: il difetto e' presente nel codice vero."
    : "\nLIB-06 NON riprodotto integralmente: vedi le asserzioni fallite."
);
process.exit(falliti.length === 0 ? 0 : 1);
