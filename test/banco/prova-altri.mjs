/**
 * Prova dei doppi degli altri moduli nativi: expo-file-system (v19),
 * expo-asset, expo-crypto, expo-document-picker, expo-intent-launcher,
 * expo-sharing, expo-notifications e il deposito chiave-valore in memoria.
 *
 * Si esegue dalla radice del progetto, senza argomenti e senza variabili:
 *
 *   node test/banco/prova-altri.mjs
 *
 * Il file si riavvia da solo con `--import ./test/banco/carica.mjs` e con
 * BANCO_DOPPI già composta (vedi doppi-altri.mjs): i ganci del banco vanno
 * registrati prima che parta qualunque import, e questo è il solo modo di
 * ottenerlo senza chiedere a chi esegue di ricordarsi una riga di comando.
 *
 * Tre parti:
 *   A. i doppi da soli — file veri su disco, hash veri, giornali, esiti
 *      programmabili (successo, annullamento, errore);
 *   B. i moduli VERI dell'app sopra i doppi — lib/contenuti.ts, lib/palestra.ts
 *      e lib/notifiche.ts, compilati al volo dal risolutore del banco;
 *   C. le due invarianti che senza giornale non sarebbero verificabili:
 *      la copia temporanea della palestra viene CANCELLATA, e applica()
 *      CANCELLA SEMPRE prima di riprogrammare.
 *
 * Non tocca nulla del progetto: lavora in una radice temporanea che cancella
 * alla fine, e i doppi rifiutano per costruzione di scrivere fuori di lì.
 */
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { KV_MEMORIA, variabileBanco } from "./doppi-altri.mjs";

const QUESTA_CARTELLA = dirname(fileURLToPath(import.meta.url));
const RADICE_PROGETTO = resolve(QUESTA_CARTELLA, "..", "..");

// ------------------------------------------------------- RIAVVIO CON I GANCI
if (!process.env.BANCO_ALTRI_IN_CORSO) {
  const esito = spawnSync(
    process.execPath,
    ["--import", "./test/banco/carica.mjs", "test/banco/prova-altri.mjs"],
    {
      cwd: RADICE_PROGETTO,
      stdio: "inherit",
      env: {
        ...process.env,
        BANCO_ALTRI_IN_CORSO: "1",
        // Il deposito chiave-valore in memoria prende il posto di quello su
        // SQLite: così questa prova esercita il doppio scritto qui.
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
const md5Di = (percorso) => createHash("md5").update(readFileSync(percorso)).digest("hex");

// ------------------------------------------------------------- PREPARAZIONE
import * as FS from "./expo-file-system.mjs";
import * as Picker from "./expo-document-picker.mjs";
import * as Sharing from "./expo-sharing.mjs";
import * as Intent from "./expo-intent-launcher.mjs";
import * as Notifiche from "./expo-notifications.mjs";
import * as RN from "./react-native.mjs";
import { installaRequireMetro, mappaAsset } from "./require-metro.mjs";
import { configuraCartella } from "./expo-sqlite.mjs";

const { File, Directory, Paths } = FS;

// Radice finta del dispositivo: documenti/, cache/, pacchetto/.
const radice = FS.configuraRadice(mkdtempSync(join(tmpdir(), "prova-altri-")));
// I database stanno dove li mette expo sul telefono: <documenti>/SQLite.
// Senza questa riga apriPalestra() copierebbe il file in un posto e
// openDatabaseAsync ne aprirebbe un altro, vuoto.
const cartellaSqlite = configuraCartella(join(FS.percorsoDocumenti(), "SQLite"));
// `require("../assets/...")` del codice dell'app: vedi require-metro.mjs.
installaRequireMetro(RADICE_PROGETTO);

// ============================================================ PARTE A1
// expo-file-system: file VERI, e le regole vere di expo su copy/create/delete.
const fsDalSpecificatore = await import("expo-file-system");
ok('import "expo-file-system" arriva al doppio', fsDalSpecificatore.File === File);

ok("Paths.document esiste ed è dentro la radice", Paths.document.exists && Paths.document.uri.startsWith(FS.uriDa(radice)));
ok("l'uri di una cartella finisce con la barra, come in expo", Paths.document.uri.endsWith("/"));
ok("l'uri di un file non finisce con la barra", !new File(Paths.document, "x.txt").uri.endsWith("/"));

const prove = new Directory(Paths.document, "prove", "annidata");
prove.create({ intermediates: true });
ok("Directory.create({intermediates}) crea anche i livelli intermedi", prove.exists);
await lancia("Directory.create su una cartella che esiste già fallisce", () => prove.create(), "already exists");
prove.create({ idempotent: true });
ok("...ma con idempotent: true tace", prove.exists);

const nota = new File(prove, "nota.txt");
ok("un File non ancora creato non esiste e misura 0", !nota.exists && nota.size === 0);
nota.create();
nota.write("ciao mondo");
ok("File.write + File.text leggono e scrivono davvero", (await nota.text()) === "ciao mondo");
ok("File.textSync legge lo stesso contenuto", nota.textSync() === "ciao mondo");
ok("File.size è il numero di byte veri", nota.size === Buffer.byteLength("ciao mondo"));
ok("File.md5 è l'md5 vero del contenuto", nota.md5 === createHash("md5").update("ciao mondo").digest("hex"));
ok("File.base64", (await nota.base64()) === Buffer.from("ciao mondo").toString("base64"));
ok("File.bytes restituisce Uint8Array", (await nota.bytes()) instanceof Uint8Array);
ok("File.type dall'estensione", nota.type === "text/plain");
ok("File.info() riporta esistenza e dimensione", nota.info().exists && nota.info().size === 10);
ok("File.info({md5}) riporta l'impronta", nota.info({ md5: true }).md5 === nota.md5);
nota.write("riscritto");
ok("File.write sovrascrive il contenuto precedente", (await nota.text()) === "riscritto");
await lancia("File.create su un file che esiste già fallisce", () => nota.create(), "already exists");

const copia = new File(prove, "copia.txt");
nota.copy(copia);
ok("File.copy copia il contenuto", copia.exists && copia.textSync() === "riscritto");
await lancia(
  "File.copy su una destinazione occupata fallisce (come copyRecursively di Android)",
  () => nota.copy(copia),
  "already exists"
);
copia.delete();
ok("File.delete cancella davvero", !copia.exists);
await lancia("File.delete su un file assente fallisce", () => copia.delete(), "does not exist");

const dentroCartella = new Directory(Paths.cache, "cartella-di-arrivo");
dentroCartella.create();
nota.copy(dentroCartella);
ok("File.copy dentro una Directory conserva il nome", new File(dentroCartella, "nota.txt").exists);
const daSpostare = new File(dentroCartella, "nota.txt");
daSpostare.move(new File(dentroCartella, "spostata.txt"));
ok("File.move sposta e aggiorna l'uri", daSpostare.uri.endsWith("spostata.txt") && daSpostare.exists);
daSpostare.rename("rinominata.txt");
ok("File.rename rinomina e aggiorna l'uri", daSpostare.name === "rinominata.txt" && daSpostare.exists);
await lancia("File.rename rifiuta un nome con barre", () => daSpostare.rename("a/b.txt"), "single path segment");

ok("Directory.list elenca il contenuto", dentroCartella.list().length === 1);
ok("Directory.list restituisce File e Directory", dentroCartella.list()[0] instanceof File);
ok("Directory.size somma i byte contenuti", dentroCartella.size === daSpostare.size);
ok("Paths.info distingue file e cartelle",
  Paths.info(dentroCartella.uri).isDirectory === true && Paths.info(daSpostare.uri).isDirectory === false);
ok("Paths.join/basename/extname", Paths.basename(daSpostare.uri) === "rinominata.txt" && Paths.extname(daSpostare.uri) === ".txt");
ok("un File che punta a una cartella non 'esiste'", !new File(dentroCartella.uri).exists);
await lancia("...e leggerlo è un errore di tipo", () => new File(dentroCartella.uri).text(), "InvalidType");

// La rete non c'è, e il doppio lo dice invece di fingere un download.
await lancia("File.downloadFileAsync è chiusa: il banco è offline",
  () => File.downloadFileAsync("https://esempio.invalido/x.pdf", Paths.cache), "offline");

// Protezione del repository: fuori dalla radice non si scrive e non si cancella.
const fileDelProgetto = new File(join(RADICE_PROGETTO, "NOTE-BUILD.md"));
ok("un file del progetto si può LEGGERE", fileDelProgetto.exists && fileDelProgetto.size > 0);
await lancia("...ma cancellarlo è rifiutato dal doppio",
  () => fileDelProgetto.delete(), "fuori dalla radice del banco");
ok("e il file del progetto è ancora lì", fileDelProgetto.exists);

// ============================================================ PARTE A2
// expo-crypto: hash veri, casualità vera.
const Crypto = await import("expo-crypto");
const impronta = await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, "abc");
ok("digestStringAsync SHA-256 dà l'impronta giusta (vettore noto)",
  impronta === "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad", impronta);
ok("digestStringAsync in base64",
  (await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, "abc", { encoding: "base64" })) ===
    Buffer.from(impronta, "hex").toString("base64"));
const uuidi = new Set(Array.from({ length: 200 }, () => Crypto.randomUUID()));
ok("randomUUID genera identificatori distinti", uuidi.size === 200);
ok("randomUUID ha la forma di un UUID v4",
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test([...uuidi][0]));
ok("getRandomBytes restituisce la quantità chiesta", Crypto.getRandomBytes(16).length === 16);
ok("getRandomValues riempie il vettore", Crypto.getRandomValues(new Uint8Array(8)).some((b) => b !== 0));

// ============================================================ PARTE A3
// expo-asset + require in stile Metro.
const Asset = (await import("expo-asset")).Asset;
const moduloDb = require("../assets/contenuti/palestra.db");
ok("require di un asset restituisce un numero, come Metro", typeof moduloDb === "number");
ok("require di un JSON restituisce il contenuto già interpretato",
  Array.isArray(require("../assets/contenuti/biblioteca.json")));

const assetDb = Asset.fromModule(moduloDb);
ok("Asset.fromModule riconosce nome e tipo", assetDb.name === "palestra" && assetDb.type === "db");
ok("Asset.hash è l'md5 VERO del file (serve a preparaLettore)",
  assetDb.hash === md5Di(join(RADICE_PROGETTO, "assets/contenuti/palestra.db")));
ok("prima di downloadAsync non c'è copia locale", assetDb.localUri === null);
await assetDb.downloadAsync();
ok("downloadAsync estrae l'asset nello spazio dell'app",
  assetDb.downloaded && new File(assetDb.localUri).exists);
ok("la copia estratta è identica all'originale",
  new File(assetDb.localUri).size === new File(join(RADICE_PROGETTO, "assets/contenuti/palestra.db")).size);
ok("la copia sta dentro la radice del banco, non nel repository",
  FS.percorsoDa(assetDb.localUri).startsWith(radice));

// ============================================================ PARTE A4
// Giornali ed esiti programmabili: selettore, condivisione, intent.
Picker.azzera();
const annullata = await Picker.getDocumentAsync({ type: "application/pdf" });
ok("selettore: senza esiti programmati l'utente annulla",
  annullata.canceled === true && annullata.assets === null);
ok("selettore: la chiamata finisce nel giornale con le sue opzioni",
  Picker.giornale.length === 1 && Picker.giornale[0].opzioni.type === "application/pdf");

const cartellaFinta = join(radice, "scaricati");
mkdirSync(cartellaFinta, { recursive: true });
const pdfFinto = join(cartellaFinta, "manuale.pdf");
writeFileSync(pdfFinto, "%PDF-1.4 finto ma vero come file\n");
Picker.programma({ percorsi: [pdfFinto] });
const scelta = await Picker.getDocumentAsync({ type: ["application/pdf"], copyToCacheDirectory: true });
ok("selettore: esito programmato con file veri",
  scelta.canceled === false && scelta.assets[0].name === "manuale.pdf");
ok("selettore: con copyToCacheDirectory il file arriva dalla cache, come sul telefono",
  FS.percorsoDa(scelta.assets[0].uri).startsWith(FS.percorsoCache()));
ok("selettore: dimensione e tipo MIME veri",
  scelta.assets[0].size === readFileSync(pdfFinto).length && scelta.assets[0].mimeType === "application/pdf");
Picker.programma({ errore: "il selettore è esploso" });
await lancia("selettore: esito di errore programmabile",
  () => Picker.getDocumentAsync({}), "il selettore è esploso");

Sharing.azzera();
ok("condivisione: disponibile per impostazione predefinita", await Sharing.isAvailableAsync());
await Sharing.shareAsync("file:///x.pdf", { mimeType: "application/pdf" });
ok("condivisione: la chiamata è nel giornale con url e opzioni",
  Sharing.giornale.at(-1).url === "file:///x.pdf" && Sharing.giornale.at(-1).opzioni.mimeType === "application/pdf");
Sharing.programmaDisponibilita(false);
ok("condivisione: la disponibilità è programmabile", (await Sharing.isAvailableAsync()) === false);
Sharing.programmaErrore("foglio di condivisione non disponibile");
await lancia("condivisione: esito di errore programmabile",
  () => Sharing.shareAsync("file:///x.pdf"), "non disponibile");
Sharing.azzera();

Intent.azzera();
const esitoIntent = await Intent.startActivityAsync(Intent.ActivityAction.VIEW, { data: "content://x", flags: 1 });
ok("intent: esito di successo e voce nel giornale",
  esitoIntent.resultCode === Intent.ResultCode.Success && Intent.giornale.at(-1).parametri.flags === 1);
Intent.programmaNessunVisore();
await lancia("intent: nessuna app registrata -> ActivityNotFoundException",
  () => Intent.startActivityAsync(Intent.ActivityAction.VIEW, {}), "No Activity found");
Intent.programmaNessunVisore(false);
Intent.programmaEsito({ resultCode: Intent.ResultCode.Canceled });
ok("intent: esito 'annullato dall'utente' programmabile",
  (await Intent.startActivityAsync(Intent.ActivityAction.VIEW, {})).resultCode === Intent.ResultCode.Canceled);
Intent.azzera();

// ============================================================ PARTE A5
// Notifiche: giornale, permessi programmabili, trigger controllato.
Notifiche.azzera();
const N = await import("expo-notifications");
ok('import "expo-notifications" arriva al doppio', N.SchedulableTriggerInputTypes.DAILY === "daily");
const id1 = await N.scheduleNotificationAsync({
  content: { title: "Blocco", body: "Si comincia" },
  trigger: { type: N.SchedulableTriggerInputTypes.DAILY, hour: 7, minute: 0, channelId: "blocchi" },
});
ok("notifiche: programmare restituisce un identificatore", typeof id1 === "string");
ok("notifiche: la programmata risulta in elenco", (await N.getAllScheduledNotificationsAsync()).length === 1);
await N.cancelAllScheduledNotificationsAsync();
ok("notifiche: cancellare svuota l'elenco", (await N.getAllScheduledNotificationsAsync()).length === 0);
ok("notifiche: il giornale conserva l'ordine delle azioni",
  Notifiche.giornale.map((v) => v.azione).join(",") === "programma,cancella-tutte",
  Notifiche.giornale.map((v) => v.azione).join(","));
await lancia("notifiche: un trigger giornaliero malformato è rifiutato",
  () => N.scheduleNotificationAsync({ content: {}, trigger: { type: "daily", hour: 99, minute: 0 } }),
  "Trigger is invalid");
Notifiche.programmaPermesso({ status: "denied", canAskAgain: false });
const permessoNegato = await N.getPermissionsAsync();
ok("notifiche: permesso negato per sempre",
  permessoNegato.granted === false && permessoNegato.canAskAgain === false);
Notifiche.azzera();

// ============================================================ PARTE A6
// Deposito chiave-valore in memoria.
const kv = (await import("expo-sqlite/kv-store")).default;
await kv.setItem("chiave", "valore");
ok("kv in memoria: setItem/getItem", (await kv.getItem("chiave")) === "valore");
ok("kv in memoria: chiave assente restituisce null", (await kv.getItem("mai-scritta")) === null);
await kv.multiSet([["a", "1"], ["b", "2"]]);
ok("kv in memoria: multiGet",
  JSON.stringify(await kv.multiGet(["a", "b"])) === JSON.stringify([["a", "1"], ["b", "2"]]));
await kv.setItem("conf", JSON.stringify({ suono: true, ora: "08:00" }));
await kv.mergeItem("conf", JSON.stringify({ ora: "21:30" }));
const fusa = JSON.parse(await kv.getItem("conf"));
ok("kv in memoria: mergeItem fonde invece di sostituire", fusa.suono === true && fusa.ora === "21:30");
await lancia("kv in memoria: un valore non stringa è rifiutato, come la colonna TEXT vera",
  async () => kv.setItem("oggetto", { a: 1 }), "deve essere una stringa");
await kv.removeItem("a");
ok("kv in memoria: removeItem", (await kv.getItem("a")) === null);
await kv.clear();
ok("kv in memoria: clear svuota tutto", (await kv.getAllKeys()).length === 0);

// ============================================================ PARTE B1
// lib/db.ts e lib/contenuti.ts: i contenuti impacchettati entrano nel database.
const db = await import("../../lib/db.ts");
await db.apri("prova-altri");
const base = db.database();

const contenuti = await import("../../lib/contenuti.ts");
const caricati = await contenuti.caricaContenuti();
ok("caricaContenuti() ha letto i JSON dell'app col require finto",
  caricati.saltato === false && caricati.sql > 0 && caricati.flashcard > 0 && caricati.biblioteca > 0,
  JSON.stringify(caricati));
ok("caricaContenuti() ha scritto gli esercizi",
  (await base.getFirstAsync("SELECT COUNT(*) AS n FROM esercizi")).n ===
    caricati.sql + caricati.codice + caricati.flashcard + caricati.scenari);
ok("caricaContenuti() ha scritto i temi e la coda di ripasso",
  (await base.getFirstAsync("SELECT COUNT(*) AS n FROM temi")).n === caricati.temi &&
  (await base.getFirstAsync("SELECT COUNT(*) AS n FROM ripasso")).n === caricati.flashcard);
ok("caricaContenuti() alla seconda chiamata non ricarica nulla",
  (await contenuti.caricaContenuti()).saltato === true);
ok("i contenuti NON passano dal registro eventi (sono uguali su ogni dispositivo)",
  (await base.getFirstAsync("SELECT COUNT(*) AS n FROM eventi")).n === 0);

// ============================================================ PARTE B2
// lib/palestra.ts: l'asset diventa un database aperto davvero.
const palestra = await import("../../lib/palestra.ts");
await palestra.apriPalestra();
const palestraCopiata = new File(Paths.document, "SQLite", "palestra.db");
ok("apriPalestra() ha copiato l'asset nello spazio dell'app", palestraCopiata.exists);
ok("la copia ha gli stessi byte dell'asset del repository",
  palestraCopiata.size === new File(join(RADICE_PROGETTO, "assets/contenuti/palestra.db")).size);
ok("versioneMotore() legge la versione vera di SQLite", /^3\./.test(palestra.versioneMotore()), palestra.versioneMotore());
ok("supportaWindowFunctions() è vero su node:sqlite (>= 3.25)", palestra.supportaWindowFunctions());

const conteggio = await palestra.esegui("SELECT COUNT(*) AS n FROM pazienti");
ok("esegui() interroga la palestra vera",
  conteggio.colonne.join(",") === "n" && conteggio.righe[0][0] > 0, JSON.stringify(conteggio.righe[0]));
const finestra = await palestra.esegui(
  "SELECT id, ROW_NUMBER() OVER (ORDER BY id) AS posizione FROM pazienti LIMIT 3"
);
ok("esegui() regge le window functions (41 esercizi ne dipendono)", finestra.righe.length === 3);
await lancia("esegui() lascia risalire l'errore SQL",
  () => palestra.esegui("SELECT * FROM tabella_inesistente"), "no such table");

// --- l'invariante: la copia temporanea deve sparire
const primaDellaPreparazione = readdirSync(cartellaSqlite).filter((n) => n.startsWith("palestra_tmp_"));
const conIndice = await palestra.eseguiConPreparazione(
  "CREATE INDEX idx_prova_diagnosi ON diagnosi (codice_icd10);",
  "SELECT codice_icd10, COUNT(*) AS n FROM diagnosi GROUP BY 1 ORDER BY n DESC LIMIT 3"
);
ok("eseguiConPreparazione() esegue preparazione e query sulla copia",
  conIndice.righe.length === 3 && conIndice.colonne.join(",") === "codice_icd10,n");
const dopoLaPreparazione = readdirSync(cartellaSqlite).filter((n) => n.startsWith("palestra_tmp_"));
ok("eseguiConPreparazione() CANCELLA la copia temporanea (file veri, non promesse)",
  primaDellaPreparazione.length === 0 && dopoLaPreparazione.length === 0,
  `rimaste: ${dopoLaPreparazione.join(", ")}`);
const indiciSullOriginale = await palestra.esegui(
  "SELECT COUNT(*) AS n FROM sqlite_master WHERE name = 'idx_prova_diagnosi'"
);
ok("eseguiConPreparazione() non tocca la palestra originale", indiciSullOriginale.righe[0][0] === 0);

// ============================================================ PARTE B3
// Importazione di un PDF: selettore -> copia nello spazio privato -> evento.
Picker.azzera();
const pdfScelto = join(cartellaFinta, "Dispensa di SQL.pdf");
writeFileSync(pdfScelto, "%PDF-1.4 dispensa\n".repeat(20));
Picker.programma({ percorsi: [pdfScelto] });
const volume = await palestra.importaPdf({ tema_slug: "sql_base", trimestre: "T1" });
ok("importaPdf() restituisce il volume importato", volume !== null && volume.origine === "manuale");
ok("importaPdf() usa il nome del file come titolo", volume.titolo === "Dispensa di SQL");
ok("importaPdf() copia il file nello spazio privato dell'app",
  new File(volume.file_locale).exists && FS.percorsoDa(volume.file_locale).startsWith(join(FS.percorsoDocumenti(), "biblioteca")));
ok("importaPdf() registra i byte veri", volume.byte === readFileSync(pdfScelto).length);
ok("importaPdf() chiede al selettore PDF ed EPUB, non 'qualunque cosa'",
  JSON.stringify(Picker.giornale.at(-1).opzioni.type) === JSON.stringify(["application/pdf", "application/epub+zip"]));
ok("importaPdf() ha scritto la riga in biblioteca",
  (await base.getFirstAsync("SELECT COUNT(*) AS n FROM biblioteca WHERE id = ?", [volume.id])).n === 1);
ok("importaPdf() ha registrato l'evento sincronizzabile",
  (await base.getFirstAsync("SELECT COUNT(*) AS n FROM eventi WHERE entita = 'biblioteca'")).n === 1);

const righeBibliotecaPrima = (await base.getFirstAsync("SELECT COUNT(*) AS n FROM biblioteca")).n;
Picker.programma({ annullato: true });
ok("importaPdf() annullato dall'utente restituisce null", (await palestra.importaPdf()) === null);
ok("...e non scrive niente", (await base.getFirstAsync("SELECT COUNT(*) AS n FROM biblioteca")).n === righeBibliotecaPrima);

// ============================================================ PARTE B4
// Importazione della biblioteca aperta: manifesto + PDF scelti insieme.
const pdfBiblioteca = join(cartellaFinta, "bib-01.pdf");
writeFileSync(pdfBiblioteca, "%PDF-1.4 volume aperto\n");
const manifesto = join(cartellaFinta, "manifesto.json");
writeFileSync(manifesto, JSON.stringify([
  { codice: "BIB-01", titolo: "Use The Index, Luke!", file: "bib-01.pdf",
    byte: readFileSync(pdfBiblioteca).length, sha256: "a".repeat(64) },
  { codice: "BIB-02", titolo: "Volume senza file", file: "assente.pdf" },
]));
Picker.programma({ percorsi: [manifesto, pdfBiblioteca] });
const esitoBiblioteca = await palestra.importaBiblioteca({});
ok("importaBiblioteca() collega le voci che hanno il file e conta le altre",
  esitoBiblioteca.collegati === 1 && esitoBiblioteca.senzaFile === 1, JSON.stringify(esitoBiblioteca));
const bib01 = await base.getFirstAsync("SELECT file_locale, sha256 FROM biblioteca WHERE id = 'BIB-01'");
ok("importaBiblioteca() scrive il percorso locale nella riga già presente",
  Boolean(bib01?.file_locale) && new File(bib01.file_locale).exists);
ok("importaBiblioteca() salva l'impronta dichiarata dal manifesto", bib01.sha256 === "a".repeat(64));

Picker.programma({ percorsi: [pdfBiblioteca] });
const senzaManifesto = await palestra.importaBiblioteca({});
ok("importaBiblioteca() senza manifesto spiega cosa manca",
  senzaManifesto.errore?.includes("manifesto.json"), JSON.stringify(senzaManifesto));
Picker.programma({ annullato: true });
ok("importaBiblioteca() annullata non collega niente",
  JSON.stringify(await palestra.importaBiblioteca({})) === JSON.stringify({ collegati: 0, senzaFile: 0 }));

// ============================================================ PARTE B5
// Apertura di un volume: intent di sistema, e ripiego sulla condivisione.
Intent.azzera();
Sharing.azzera();
const elenco = await palestra.elencaBiblioteca();
const importato = elenco.find((v) => v.id === volume.id);
ok("elencaBiblioteca() vede il volume importato", Boolean(importato));
ok("elencaBiblioteca(trimestre) filtra", (await palestra.elencaBiblioteca("T1")).every((v) => v.trimestre === "T1"));

ok("apriVolume() consegna il file al visore di sistema", (await palestra.apriVolume(importato)) === "aperto");
const intentInviato = Intent.giornale.at(-1);
ok("apriVolume() usa l'azione VIEW", intentInviato.azione === "android.intent.action.VIEW");
ok("apriVolume() passa un content:// e non un file://",
  intentInviato.parametri.data.startsWith("content://"), intentInviato.parametri.data);
ok("apriVolume() concede il permesso di lettura al visore esterno (flags 1)",
  intentInviato.parametri.flags === 1);
ok("apriVolume() dichiara il tipo MIME giusto", intentInviato.parametri.type === "application/pdf");

Intent.programmaNessunVisore();
ok("apriVolume() senza visori ripiega sul foglio di condivisione",
  (await palestra.apriVolume(importato)) === "aperto");
ok("...e il foglio ha ricevuto proprio quel file",
  Sharing.giornale.at(-1).chiamata === "shareAsync" &&
  FS.percorsoDa(Sharing.giornale.at(-1).url) === FS.percorsoDa(importato.file_locale));

Sharing.programmaDisponibilita(false);
ok("apriVolume() senza visori e senza condivisione lo dice",
  (await palestra.apriVolume(importato)) === "nessun_visore");
Intent.azzera();
Sharing.azzera();

ok("apriVolume() di un volume mai scaricato",
  (await palestra.apriVolume({ ...importato, file_locale: null })) === "non_scaricato");
ok("apriVolume() con un percorso che non esiste più",
  (await palestra.apriVolume({ ...importato, file_locale: FS.uriDa(join(radice, "sparito.pdf")) })) === "non_scaricato");

// ============================================================ PARTE B6
// Lettore: si ricopia SOLO quando l'asset cambia.
const uriLettore = await palestra.preparaLettore();
const lettoreCopiato = new File(uriLettore);
const md5Lettore = md5Di(join(RADICE_PROGETTO, "assets/lettore/lettore.html"));
ok("preparaLettore() copia il lettore nello spazio dell'app", lettoreCopiato.exists);
ok("preparaLettore() scrive la firma dell'asset",
  new File(Paths.document, "lettore", "versione.txt").textSync() === md5Lettore);

// Un segno riconoscibile: se la seconda chiamata ricopiasse, sparirebbe.
lettoreCopiato.write("SEGNO-CHE-NON-DEVE-SPARIRE");
await palestra.preparaLettore();
ok("preparaLettore() NON ricopia quando l'asset non è cambiato",
  lettoreCopiato.textSync() === "SEGNO-CHE-NON-DEVE-SPARIRE");

// Aggiornamento dell'app: l'asset cambia, la firma cambia, il lettore si rifà.
const lettoreNuovo = join(radice, "lettore-aggiornato.html");
writeFileSync(lettoreNuovo, "<html>lettore versione nuova</html>");
mappaAsset("../assets/lettore/lettore.html", lettoreNuovo);
await palestra.preparaLettore();
ok("preparaLettore() RICOPIA quando l'asset è cambiato",
  lettoreCopiato.textSync() === "<html>lettore versione nuova</html>");
ok("...e aggiorna la firma",
  new File(Paths.document, "lettore", "versione.txt").textSync() === md5Di(lettoreNuovo));

const uriProva = await palestra.pdfDiProva();
ok("pdfDiProva() mette a disposizione il PDF di due pagine",
  new File(uriProva).size === new File(join(RADICE_PROGETTO, "assets/lettore/prova.pdf")).size);

// ============================================================ PARTE B7
// Pagina di lettura e rimozione.
await palestra.salvaPagina(volume.id, 7);
ok("salvaPagina() aggiorna la riga",
  (await base.getFirstAsync("SELECT ultima_pagina FROM biblioteca WHERE id = ?", [volume.id])).ultima_pagina === 7);
ok("salvaPagina() viaggia nel registro eventi (si riprende sull'altro dispositivo)",
  (await base.getFirstAsync("SELECT COUNT(*) AS n FROM eventi WHERE entita = 'biblioteca' AND tipo = 'aggiorna'")).n > 0);

const fileDaRimuovere = new File(volume.file_locale);
await palestra.rimuoviVolume(volume.id);
ok("rimuoviVolume() cancella il file dal disco", !fileDaRimuovere.exists);
ok("rimuoviVolume() toglie la riga",
  (await base.getFirstAsync("SELECT COUNT(*) AS n FROM biblioteca WHERE id = ?", [volume.id])).n === 0);

// ============================================================ PARTE C
// lib/notifiche.ts — l'invariante che il giornale rende verificabile.
const notifiche = await import("../../lib/notifiche.ts");
Notifiche.azzera();
await kv.clear();

ok("leggiPromemoria() senza preferenza salvata torna al predefinito (spento)",
  (await notifiche.leggiPromemoria()).attivo === false);
const promemoria = { attivo: true, ora: 21, minuto: 30, tipo: "ripasso" };
await notifiche.salvaPromemoria(promemoria);
const riletto = await notifiche.leggiPromemoria();
ok("salvaPromemoria()/leggiPromemoria() passano dal deposito chiave-valore",
  riletto.ora === 21 && riletto.minuto === 30 && riletto.tipo === "ripasso" && riletto.attivo === true);

ok("applica() con permesso concesso riesce", (await notifiche.applica(promemoria)) === true);
const azioni = Notifiche.giornale.map((v) => v.azione);
ok("applica() CANCELLA PRIMA di programmare",
  azioni.indexOf("cancella-tutte") >= 0 && azioni.indexOf("cancella-tutte") < azioni.indexOf("programma"),
  azioni.join(","));
ok("applica() crea il canale Android dedicato",
  Notifiche.canaliRegistrati().some((c) => c.id === "blocchi" && c.name === "Blocchi di studio"));
const programmate1 = await N.getAllScheduledNotificationsAsync();
ok("applica() lascia UNA sola notifica in programma", programmate1.length === 1);
ok("applica() programma all'ora chiesta, sul canale giusto",
  programmate1[0].trigger.hour === 21 && programmate1[0].trigger.minute === 30 &&
  programmate1[0].trigger.type === "daily" && programmate1[0].trigger.channelId === "blocchi");
ok("applica() mette titolo e corpo veri",
  Boolean(programmate1[0].content.title) && Boolean(programmate1[0].content.body),
  JSON.stringify(programmate1[0].content));
ok("applica() non chiede mai il permesso all'utente (lo fa lo schermo, al momento giusto)",
  Notifiche.conteggioRichiestePermesso() === 0);

// Cambiare ora tre volte non deve lasciare tre sveglie in piedi.
for (const ora of [6, 7, 8]) await notifiche.applica({ ...promemoria, ora });
const programmate2 = await N.getAllScheduledNotificationsAsync();
ok("dopo tre cambi d'ora resta UNA notifica sola (idempotenza)", programmate2.length === 1,
  `ne restano ${programmate2.length}`);
ok("...ed è l'ultima ora chiesta", programmate2[0].trigger.hour === 8);
const sequenza = Notifiche.giornale.filter((v) => v.azione === "programma" || v.azione === "cancella-tutte");
ok("ogni programmazione è preceduta da una cancellazione, sempre",
  sequenza.every((v, i) => v.azione !== "programma" || sequenza[i - 1]?.azione === "cancella-tutte"),
  sequenza.map((v) => v.azione).join(","));
ok("programmate() conta quelle vere", (await notifiche.programmate()) === 1);

ok("applica() con promemoria spento riesce", (await notifiche.applica({ ...promemoria, attivo: false })) === true);
ok("...e non lascia nessuna notifica", (await N.getAllScheduledNotificationsAsync()).length === 0);

// Permesso negato per sempre: si cancella comunque, non si programma, non si insiste.
Notifiche.azzera();
Notifiche.programmaPermesso({ status: "denied", canAskAgain: false });
ok("applica() senza permesso restituisce false", (await notifiche.applica(promemoria)) === false);
ok("...ma ha comunque cancellato le notifiche vecchie",
  Notifiche.giornale.some((v) => v.azione === "cancella-tutte"));
ok("...e non ha programmato niente", (await N.getAllScheduledNotificationsAsync()).length === 0);
ok("...e non ha chiesto il permesso, perché Android non lo ripropone",
  Notifiche.conteggioRichiestePermesso() === 0);
ok("permessoConcesso(true) con permesso negato per sempre resta false",
  (await notifiche.permessoConcesso(true)) === false);
ok("...senza sprecare la richiesta", Notifiche.conteggioRichiestePermesso() === 0);

Notifiche.azzera();
Notifiche.programmaPermesso({ status: "undetermined", canAskAgain: true });
ok("permessoConcesso(true) con permesso mai chiesto lo chiede una volta",
  (await notifiche.permessoConcesso(true)) === true && Notifiche.conteggioRichiestePermesso() === 1);

// Il canale è una cosa di Android: su iOS non si crea.
Notifiche.azzera();
RN.configuraPiattaforma("ios");
await notifiche.applica(promemoria);
ok("su iOS applica() programma senza creare canali Android",
  Notifiche.canaliRegistrati().length === 0 && (await N.getAllScheduledNotificationsAsync()).length === 1);
RN.configuraPiattaforma("android");

// ripristina(): riallinea all'avvio, e non solleva mai.
Notifiche.azzera();
await notifiche.ripristina();
ok("ripristina() riprogramma la preferenza salvata", (await N.getAllScheduledNotificationsAsync()).length === 1);
Notifiche.azzera();
Notifiche.programmaErrore("guasto del servizio notifiche");
let haSollevato = false;
try {
  await notifiche.ripristina();
} catch {
  haSollevato = true;
}
ok("ripristina() non solleva neanche se le notifiche si guastano", !haSollevato);

// ================================================================== ESITO
console.log("\nbanco: doppi di expo-file-system, expo-asset, expo-crypto,");
console.log("expo-document-picker, expo-intent-launcher, expo-sharing,");
console.log("expo-notifications e kv-store in memoria");
console.log(`radice di prova: ${radice}`);
for (const f of falliti) console.log(`  FALLITO: ${f}`);
console.log(`${passati} verifiche passate, ${falliti.length} fallite`);

// Come per prova-banco.mjs: si pulisce solo se è andato tutto bene, perché
// dopo un fallimento i file servono per capire cosa è successo.
if (falliti.length) process.exit(1);
rmSync(radice, { recursive: true, force: true });