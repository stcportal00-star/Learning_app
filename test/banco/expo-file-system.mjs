/**
 * Doppio di `expo-file-system` v19 — le classi `File`, `Directory` e `Paths`.
 * NON l'API legacy (readAsStringAsync, documentDirectory, ...): il codice
 * dell'app usa solo la nuova, e un doppio che offrisse anche la vecchia
 * lascerebbe passare un uso che sul telefono stampa un avviso di deprecazione.
 *
 * Perché file VERI e non una finta memoria: `lib/palestra.ts` copia
 * palestra.db, lavora su una copia temporanea e poi la CANCELLA. Con un doppio
 * in memoria la cancellazione sarebbe una riga di registro da credere sulla
 * parola; con node:fs il test guarda la cartella e vede se il file c'è o no.
 *
 * Tutto vive dentro una radice temporanea isolata (una per processo, come fa
 * il doppio di expo-sqlite): due agenti in parallelo non si pestano i piedi, e
 * niente di quello che fa l'app finisce nel repository.
 *
 * Protezione deliberata: la LETTURA è permessa ovunque (comodo per leggere un
 * asset del progetto), la SCRITTURA e la CANCELLAZIONE solo dentro la radice.
 * Se un difetto dell'app puntasse una delete() su un file del repository, qui
 * si ferma con un errore invece di distruggerlo.
 *
 * Le firme e i comportamenti seguono la versione installata (19.0.24) e il suo
 * codice Android (node_modules/expo-file-system/android/.../FileSystemPath.kt):
 *   - copy() su una destinazione che esiste già FALLISCE (copyRecursively);
 *   - create() su un file che esiste già FALLISCE, se non si passa overwrite;
 *   - write() crea il file se manca, poi sovrascrive il contenuto;
 *   - delete() su ciò che non esiste FALLISCE;
 *   - `exists` di un File è falso se al suo posto c'è una cartella.
 * Quello che NON riproduce è scritto in fondo, sotto "LIMITI NOTI".
 */
import {
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import {
  basename,
  dirname,
  extname,
  isAbsolute,
  join,
  normalize,
  parse as analizzaPercorso,
  relative as relativo,
  resolve as risolvi,
  sep,
} from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

// ---------------------------------------------------------------- RADICE
// Sul telefono le tre cartelle stanno in posti diversi dello spazio privato
// dell'app. Qui sono tre sottocartelle di un'unica radice usa-e-getta.
const SOTTOCARTELLE = { documenti: "documenti", cache: "cache", pacchetto: "pacchetto" };

let radice = process.env.BANCO_FS_RADICE || null;

function preparaRadice(percorso) {
  for (const nome of Object.values(SOTTOCARTELLE)) {
    mkdirSync(join(percorso, nome), { recursive: true });
  }
  return percorso;
}

/** Fissa la radice finta del dispositivo. Il test la crea e la cancella lui. */
export function configuraRadice(percorso) {
  radice = preparaRadice(risolvi(percorso));
  return radice;
}

/** La radice in uso; se nessuno l'ha scelta ne nasce una temporanea. */
export function radiceCorrente() {
  if (!radice) radice = preparaRadice(mkdtempSync(join(tmpdir(), "banco-fs-")));
  return radice;
}

/** Percorso su disco di una cartella nota, per chi deve accordarsi col doppio di expo-sqlite. */
export function percorsoDocumenti() {
  return join(radiceCorrente(), SOTTOCARTELLE.documenti);
}
export function percorsoCache() {
  return join(radiceCorrente(), SOTTOCARTELLE.cache);
}
export function percorsoPacchetto() {
  return join(radiceCorrente(), SOTTOCARTELLE.pacchetto);
}

// ------------------------------------------------------------ CONVERSIONI
/** Da uri `file:///...` (o da un File/Directory) al percorso del sistema. */
export function percorsoDa(riferimento) {
  if (riferimento instanceof PercorsoDoppio) return riferimento.percorso;
  const testo = String(riferimento);
  if (testo.startsWith("file:")) return fileURLToPath(new URL(testo));
  return risolvi(testo);
}

/** Da percorso a uri. Le cartelle, come in expo, finiscono con la barra. */
export function uriDa(percorso, cartella = false) {
  const uri = pathToFileURL(percorso).href;
  return cartella && !uri.endsWith("/") ? uri + "/" : uri;
}

/**
 * Unisce i pezzi passati al costruttore, come fa `Paths.join` di expo: il primo
 * pezzo assoluto fa da base, i successivi si attaccano come segmenti relativi.
 */
function unisci(pezzi) {
  if (!pezzi.length) throw new Error("expo-file-system (doppio): manca il percorso");
  let costruito = null;
  for (const pezzo of pezzi) {
    const testo = pezzo instanceof PercorsoDoppio ? pezzo.percorso : String(pezzo);
    const assoluto = testo.startsWith("file:") ? fileURLToPath(new URL(testo)) : testo;
    if (costruito === null || isAbsolute(assoluto)) costruito = assoluto;
    else costruito = join(costruito, assoluto);
  }
  return normalize(costruito);
}

// I tipi che servono all'app: PDF ed EPUB per la biblioteca, il resto per i
// pacchetti di sincronizzazione e per il lettore.
const TIPI = new Map([
  [".pdf", "application/pdf"],
  [".epub", "application/epub+zip"],
  [".html", "text/html"],
  [".json", "application/json"],
  [".txt", "text/plain"],
  [".py", "text/x-python"],
  [".db", "application/vnd.sqlite3"],
]);

// ------------------------------------------------------------- PERMESSI
function dentroLaRadice(percorso) {
  const r = radiceCorrente();
  return percorso === r || percorso.startsWith(r + sep);
}

/** La scrittura fuori dalla radice è un difetto del test o dell'app: si ferma qui. */
function esigiScrivibile(percorso, operazione) {
  if (dentroLaRadice(percorso)) return;
  throw new Error(
    `expo-file-system (doppio): ${operazione} fuori dalla radice del banco — ${percorso}. ` +
      "Il doppio scrive solo dentro " + radiceCorrente()
  );
}

// ------------------------------------------------------------ CLASSE BASE
class PercorsoDoppio {
  constructor(pezzi) {
    this.percorso = unisci(pezzi);
    this.validatePath();
  }

  /** In expo è il gancio di validazione chiamato dal costruttore. Qui non serve. */
  validatePath() {}

  get uri() {
    return uriDa(this.percorso, this instanceof Directory);
  }

  get name() {
    return basename(this.percorso);
  }

  get parentDirectory() {
    return new Directory(dirname(this.percorso));
  }

  get modificationTime() {
    return existsSync(this.percorso) ? Math.round(statSync(this.percorso).mtimeMs) : null;
  }

  get creationTime() {
    return existsSync(this.percorso) ? Math.round(statSync(this.percorso).birthtimeMs) : null;
  }

  delete() {
    if (!existsSync(this.percorso)) {
      throw new Error(`UnableToDeleteException: uri '${this.uri}' does not exist`);
    }
    esigiScrivibile(this.percorso, "cancellazione");
    rmSync(this.percorso, { recursive: true, force: true });
  }

  /**
   * Destinazione vera di una copia o di uno spostamento, con le stesse regole
   * di getMoveOrCopyPath() su Android: dentro una cartella si conserva il nome,
   * su un file si prende il percorso del file, e la cartella che deve
   * contenere il risultato deve esistere.
   */
  destinazioneDi(destinazione) {
    if (destinazione instanceof Directory) {
      if (this instanceof File) {
        if (!destinazione.exists) throw new Error("DestinationDoesNotExistException");
        return join(destinazione.percorso, this.name);
      }
      if (destinazione.exists) return join(destinazione.percorso, this.name);
      if (!existsSync(dirname(destinazione.percorso))) {
        throw new Error("DestinationDoesNotExistException");
      }
      return destinazione.percorso;
    }
    if (!(this instanceof File)) throw new Error("CopyOrMoveDirectoryToFileException");
    if (!existsSync(dirname(destinazione.percorso))) {
      throw new Error("DestinationDoesNotExistException");
    }
    return destinazione.percorso;
  }

  copy(destinazione) {
    const arrivo = this.destinazioneDi(destinazione);
    esigiScrivibile(arrivo, "copia");
    // Kotlin copyRecursively() non sovrascrive: rifiuta se la destinazione c'è
    // già. Il doppio fa lo stesso, altrimenti nasconderebbe una copia doppia.
    if (existsSync(arrivo)) {
      throw new Error(`FileAlreadyExistsException: ${uriDa(arrivo)} already exists`);
    }
    if (statSync(this.percorso).isDirectory()) cpSync(this.percorso, arrivo, { recursive: true });
    else copyFileSync(this.percorso, arrivo);
  }

  move(destinazione) {
    const arrivo = this.destinazioneDi(destinazione);
    esigiScrivibile(this.percorso, "spostamento");
    esigiScrivibile(arrivo, "spostamento");
    renameSync(this.percorso, arrivo);
    // Come in expo: dopo move l'oggetto punta alla nuova posizione.
    this.percorso = arrivo;
  }

  rename(nuovoNome) {
    if (!nuovoNome || nuovoNome === "." || nuovoNome === ".." || /[\\/]/.test(nuovoNome)) {
      throw new Error("UnableToCreateException: child name must be a single path segment");
    }
    const arrivo = join(dirname(this.percorso), nuovoNome);
    esigiScrivibile(this.percorso, "rinomina");
    esigiScrivibile(arrivo, "rinomina");
    renameSync(this.percorso, arrivo);
    this.percorso = arrivo;
  }

  toString() {
    return this.uri;
  }
}

// ---------------------------------------------------------------- FILE
export class File extends PercorsoDoppio {
  constructor(...pezzi) {
    super(pezzi);
  }

  /** Falso anche quando al suo posto c'è una cartella: è `file.isFile()` di Android. */
  get exists() {
    return existsSync(this.percorso) && statSync(this.percorso).isFile();
  }

  get size() {
    return this.exists ? statSync(this.percorso).size : 0;
  }

  get md5() {
    return this.exists ? createHash("md5").update(readFileSync(this.percorso)).digest("hex") : null;
  }

  get type() {
    return this.exists ? (TIPI.get(this.extension.toLowerCase()) ?? "application/octet-stream") : "";
  }

  get extension() {
    return extname(this.percorso);
  }

  /**
   * Su Android è l'uri `content://` che un'app esterna può leggere: è quello
   * che `apriVolume()` passa a IntentLauncher. Qui è una forma riconoscibile,
   * costruita sul percorso relativo, che il test può confrontare.
   */
  get contentUri() {
    return "content://banco.percorso.fileprovider/" +
      relativo(radiceCorrente(), this.percorso).split(sep).join("/");
  }

  /** In expo è la validazione del tipo: un File che punta a una cartella è un errore. */
  validateType() {
    if (existsSync(this.percorso) && statSync(this.percorso).isDirectory()) {
      throw new Error(`InvalidTypeFileException: ${this.uri} is a directory`);
    }
  }

  create(opzioni = {}) {
    this.validateType();
    esigiScrivibile(this.percorso, "creazione");
    if (!opzioni.overwrite && this.exists) {
      throw new Error("UnableToCreateException: it already exists");
    }
    if (opzioni.intermediates) mkdirSync(dirname(this.percorso), { recursive: true });
    if (!existsSync(dirname(this.percorso))) {
      throw new Error("UnableToCreateException: parent directory does not exist");
    }
    // Con overwrite il file preesistente viene troncato, come fa expo cancellandolo
    // e ricreandolo; senza, "wx" fa fallire la creazione di un file che c'è già.
    writeFileSync(this.percorso, "", { flag: opzioni.overwrite ? "w" : "wx" });
  }

  write(contenuto, opzioni = {}) {
    this.validateType();
    esigiScrivibile(this.percorso, "scrittura");
    if (!existsSync(dirname(this.percorso))) {
      throw new Error("UnableToCreateException: parent directory does not exist");
    }
    if (typeof contenuto === "string" && opzioni.encoding === "base64") {
      writeFileSync(this.percorso, Buffer.from(contenuto, "base64"));
      return;
    }
    writeFileSync(this.percorso, typeof contenuto === "string" ? contenuto : Buffer.from(contenuto));
  }

  esigiEsistente() {
    this.validateType();
    if (!this.exists) throw new Error(`UnableToReadException: uri '${this.uri}' does not exist`);
  }

  textSync() {
    this.esigiEsistente();
    return readFileSync(this.percorso, "utf8");
  }
  async text() {
    return this.textSync();
  }

  base64Sync() {
    this.esigiEsistente();
    return readFileSync(this.percorso).toString("base64");
  }
  async base64() {
    return this.base64Sync();
  }

  bytesSync() {
    this.esigiEsistente();
    return new Uint8Array(readFileSync(this.percorso));
  }
  async bytes() {
    return this.bytesSync();
  }
  async arrayBuffer() {
    const b = this.bytesSync();
    return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
  }

  info(opzioni = {}) {
    if (!this.exists) return { exists: false, uri: this.uri };
    const s = statSync(this.percorso);
    const esito = {
      exists: true,
      uri: this.uri,
      size: s.size,
      modificationTime: Math.round(s.mtimeMs),
      creationTime: Math.round(s.birthtimeMs),
    };
    if (opzioni.md5) esito.md5 = this.md5;
    return esito;
  }

  /** La scrittura in rete non esiste offline: il doppio lo dice invece di fingere. */
  static async downloadFileAsync() {
    throw new Error(
      "expo-file-system (doppio): il banco è offline, File.downloadFileAsync non è disponibile"
    );
  }

  static async pickFileAsync() {
    throw new Error("expo-file-system (doppio): usa il doppio di expo-document-picker");
  }
}

// ------------------------------------------------------------- DIRECTORY
export class Directory extends PercorsoDoppio {
  constructor(...pezzi) {
    super(pezzi);
  }

  get exists() {
    return existsSync(this.percorso) && statSync(this.percorso).isDirectory();
  }

  /** Somma ricorsiva dei byte contenuti; null se la cartella non c'è. */
  get size() {
    if (!this.exists) return null;
    let totale = 0;
    for (const voce of readdirSync(this.percorso, { withFileTypes: true })) {
      const figlio = join(this.percorso, voce.name);
      totale += voce.isDirectory() ? new Directory(figlio).size : statSync(figlio).size;
    }
    return totale;
  }

  validateType() {
    if (existsSync(this.percorso) && !statSync(this.percorso).isDirectory()) {
      throw new Error(`InvalidTypeFolderException: ${this.uri} is a file`);
    }
  }

  create(opzioni = {}) {
    this.validateType();
    esigiScrivibile(this.percorso, "creazione");
    if (this.exists) {
      if (opzioni.idempotent) return;
      throw new Error("UnableToCreateException: it already exists");
    }
    if (!opzioni.intermediates && !existsSync(dirname(this.percorso))) {
      throw new Error("UnableToCreateException: parent directory does not exist");
    }
    mkdirSync(this.percorso, { recursive: Boolean(opzioni.intermediates) });
  }

  createFile(nome, tipoMime = null) {
    const f = new File(this.percorso, nome);
    f.create();
    // tipoMime esiste per l'API SAF di Android; qui il tipo viene dall'estensione.
    void tipoMime;
    return f;
  }

  createDirectory(nome) {
    const d = new Directory(this.percorso, nome);
    d.create();
    return d;
  }

  listAsRecords() {
    if (!this.exists) throw new Error(`UnableToReadException: uri '${this.uri}' does not exist`);
    return readdirSync(this.percorso, { withFileTypes: true }).map((voce) => ({
      isDirectory: voce.isDirectory(),
      uri: uriDa(join(this.percorso, voce.name), voce.isDirectory()),
    }));
  }

  list() {
    return this.listAsRecords().map((r) =>
      r.isDirectory ? new Directory(r.uri) : new File(r.uri)
    );
  }

  info() {
    if (!this.exists) return { exists: false, uri: this.uri };
    const s = statSync(this.percorso);
    return {
      exists: true,
      uri: this.uri,
      size: this.size,
      modificationTime: Math.round(s.mtimeMs),
      creationTime: Math.round(s.birthtimeMs),
      files: readdirSync(this.percorso),
    };
  }

  static async pickDirectoryAsync() {
    throw new Error("expo-file-system (doppio): nessun selettore di cartelle senza device");
  }
}

// ------------------------------------------------------------------ PATHS
/** Le utilità di percorso di expo, appoggiate a node:path. */
export class Paths {
  static get document() {
    return new Directory(percorsoDocumenti());
  }
  static get cache() {
    return new Directory(percorsoCache());
  }
  static get bundle() {
    return new Directory(percorsoPacchetto());
  }
  static get appleSharedContainers() {
    return {};
  }
  static get totalDiskSpace() {
    return 64 * 1024 * 1024 * 1024;
  }
  static get availableDiskSpace() {
    return 32 * 1024 * 1024 * 1024;
  }

  static info(...uri) {
    const percorso = unisci(uri);
    if (!existsSync(percorso)) return { exists: false, isDirectory: null };
    return { exists: true, isDirectory: statSync(percorso).isDirectory() };
  }

  static join(...pezzi) {
    return unisci(pezzi);
  }
  static relative(da, a) {
    return relativo(percorsoDa(da), percorsoDa(a));
  }
  static isAbsolute(p) {
    const testo = p instanceof PercorsoDoppio ? p.percorso : String(p);
    return testo.startsWith("file:") || isAbsolute(testo);
  }
  static normalize(p) {
    return normalize(percorsoDa(p));
  }
  static dirname(p) {
    return dirname(percorsoDa(p));
  }
  static basename(p, estensione) {
    return basename(percorsoDa(p), estensione);
  }
  static extname(p) {
    return extname(percorsoDa(p));
  }
  static parse(p) {
    return analizzaPercorso(percorsoDa(p));
  }
}

export const EncodingType = { UTF8: "utf8", Base64: "base64" };

export default { File, Directory, Paths, EncodingType };

/* ------------------------------------------------------------ LIMITI NOTI
 * - Nessun uri `content://` o `asset://` vero: `contentUri` è una stringa
 *   riconoscibile, non un permesso concesso a un'altra app. Va bene per
 *   verificare COSA viene passato all'intent, non che l'intent funzioni.
 * - Niente permessi del sistema: su Android expo rifiuta le cartelle a cui
 *   l'app non ha accesso; qui il solo limite è la radice del banco.
 * - Nessun flusso (`readableStream`, `writableStream`, `open()`/FileHandle):
 *   il codice dell'app non li usa. Se un giorno li usasse, il doppio deve
 *   crescere — meglio un errore chiaro che un finto successo.
 * - `File.downloadFileAsync` solleva sempre: l'app è offline per progetto.
 * - `size` di un File inesistente è 0 (come in expo), quindi `size ?? null`
 *   nel codice dell'app non diventa mai null: è il comportamento vero.
 */
