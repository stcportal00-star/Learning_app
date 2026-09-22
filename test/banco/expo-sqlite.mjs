/**
 * Doppio di `expo-sqlite` per far girare il codice dell'app dentro Node, senza device.
 *
 * Perché SQLite vero e non un finto: un doppio che finge le transazioni direbbe
 * sempre di sì. Qui il motore è `node:sqlite` (built-in di Node 22, nessuna
 * dipendenza nuova): le transazioni fanno davvero BEGIN/COMMIT/ROLLBACK, i
 * vincoli UNIQUE e CHECK falliscono davvero. Se il collaudo passa, vuol dire
 * qualcosa; se fallisce, il difetto è nel codice dell'app, non nel banco.
 *
 * L'API riproduce quella di expo-sqlite 16.0.10 (vedi
 * node_modules/expo-sqlite/build/SQLiteDatabase.d.ts): stesse firme, stessi
 * nomi, stessi valori di ritorno — compreso `lastInsertRowId` con la I
 * maiuscola, che in `node:sqlite` si chiama invece `lastInsertRowid`.
 *
 * Cosa NON riproduce è scritto in fondo al file, sotto "LIMITI NOTI".
 */
import { DatabaseSync } from "node:sqlite";
import { existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import { tmpdir } from "node:os";

// --------------------------------------------------------------- CARTELLA
// Sul telefono expo mette i file in <documenti>/SQLite/<nome>. Qui la cartella
// è una directory temporanea per processo, così due test in parallelo non si
// pestano i piedi. Un test che vuole partire da un file preparato (per esempio
// una copia di palestra.db) la sposta con configuraCartella().
let cartellaBase = process.env.BANCO_SQLITE_CARTELLA || null;

export function configuraCartella(percorso) {
  cartellaBase = percorso;
  mkdirSync(percorso, { recursive: true });
  defaultDatabaseDirectory = cartellaBase;
  return cartellaBase;
}

export function cartellaCorrente() {
  // Cartella distinta per processo: più agenti (o più test) in parallelo non
  // devono ritrovarsi con lo stesso percorso.db sotto le mani.
  if (!cartellaBase) cartellaBase = mkdtempSync(join(tmpdir(), "banco-sqlite-"));
  else mkdirSync(cartellaBase, { recursive: true });
  defaultDatabaseDirectory = cartellaBase;
  return cartellaBase;
}

/** I nomi in memoria restano tali: è il modo più veloce per un test isolato. */
function inMemoria(nome) {
  return nome === ":memory:" || nome === "" || nome == null;
}

export function percorsoDatabase(nome, cartella) {
  if (inMemoria(nome)) return ":memory:";
  if (isAbsolute(nome)) return nome;
  if (cartella) mkdirSync(cartella, { recursive: true });
  return join(cartella ?? cartellaCorrente(), nome);
}

// ------------------------------------------------------------- PARAMETRI
/**
 * expo accetta booleani; `node:sqlite` li rifiuta con TypeError. Convertirli
 * qui evita che il doppio sia più severo del modulo vero e faccia fallire un
 * test per un motivo che sul telefono non esisterebbe.
 */
function convertiValore(valore) {
  if (valore === undefined) return null;
  if (typeof valore === "boolean") return valore ? 1 : 0;
  return valore;
}

/**
 * Riproduce normalizeParams di expo: array, argomenti variadici oppure oggetto
 * con parametri nominali ($x, :x, @x). `node:sqlite` vuole le chiavi nude,
 * quindi il prefisso va tolto.
 */
function normalizzaParametri(argomenti) {
  let parametri = argomenti.length > 1 ? argomenti : argomenti[0];
  if (parametri == null) parametri = [];
  if (
    typeof parametri !== "object" ||
    parametri instanceof ArrayBuffer ||
    ArrayBuffer.isView(parametri)
  ) {
    parametri = [parametri];
  }
  if (Array.isArray(parametri)) return parametri.map(convertiValore);
  const nominali = {};
  for (const chiave of Object.keys(parametri)) {
    const nudo = /^[$:@]/.test(chiave) ? chiave.slice(1) : chiave;
    nominali[nudo] = convertiValore(parametri[chiave]);
  }
  return [nominali];
}

/** I parametri nominali viaggiano come un solo oggetto, quelli posizionali sparsi. */
function argomentiBind(parametri) {
  return Array.isArray(parametri) ? parametri : [parametri];
}

/**
 * `node:sqlite` restituisce oggetti con prototipo nullo. Il codice dell'app fa
 * Object.keys() e accessi per chiave — funzionerebbe comunque — ma un oggetto
 * normale è ciò che arriva dal modulo vero, e basta un `hasOwnProperty` da
 * qualche parte per far divergere i due mondi.
 */
function rigaNormale(riga) {
  return riga == null ? riga : { ...riga };
}

// ------------------------------------------------------------ ISTRUZIONE
class IstruzioneDoppia {
  constructor(basedati, istruzione, sorgente) {
    this.basedati = basedati;
    this.istruzione = istruzione;
    this.sorgente = sorgente;
    this.finalizzata = false;
  }

  nomiColonne() {
    return this.istruzione.columns().map((c) => c.name);
  }

  /**
   * Un'istruzione che restituisce colonne (SELECT, o INSERT ... RETURNING) va
   * letta con all(); le altre con run(), che è l'unico modo di avere changes e
   * lastInsertRowid. Per le prime i due contatori si leggono dalla connessione,
   * esattamente come fa sqlite3_changes() sotto expo.
   */
  esegui(argomenti) {
    if (this.finalizzata) throw new Error("Istruzione già finalizzata.");
    const parametri = normalizzaParametri(argomenti);
    const colonne = this.nomiColonne();
    if (colonne.length > 0) {
      const righe = this.istruzione.all(...argomentiBind(parametri)).map(rigaNormale);
      const contatori = this.basedati.contatori();
      return { colonne, righe, changes: contatori.changes, lastInsertRowId: contatori.lastInsertRowId };
    }
    const esito = this.istruzione.run(...argomentiBind(parametri));
    return {
      colonne,
      righe: [],
      changes: Number(esito.changes),
      lastInsertRowId: Number(esito.lastInsertRowid),
    };
  }

  executeSync(...argomenti) {
    return risultatoEsecuzione(this.esegui(argomenti));
  }

  async executeAsync(...argomenti) {
    return risultatoEsecuzione(this.esegui(argomenti));
  }

  /**
   * Il risultato GREZZO: i valori in ordine di SELECT, non ricostruiti
   * dall'oggetto. La differenza conta esattamente dove serve: con due colonne
   * omonime (`SELECT s.id, v.id`) l'oggetto ne ha UNA sola, e ricomporre le
   * posizioni leggendo `riga[nome]` restituirebbe due volte lo stesso valore —
   * cioè il difetto dell'app, riprodotto dentro lo strumento che dovrebbe
   * misurarlo. node:sqlite ha `setReturnArrays`, che dà i valori veri.
   */
  executeForRawResultSync(...argomenti) {
    if (this.finalizzata) throw new Error("Istruzione già finalizzata.");
    const parametri = normalizzaParametri(argomenti);
    const colonne = this.nomiColonne();
    if (colonne.length === 0) {
      const esito = this.esegui(argomenti);
      return risultatoEsecuzione({ ...esito, righe: [] });
    }
    this.istruzione.setReturnArrays(true);
    let righe;
    try {
      righe = this.istruzione.all(...argomentiBind(parametri)).map((r) => r.slice());
    } finally {
      this.istruzione.setReturnArrays(false);
    }
    const contatori = this.basedati.contatori();
    return risultatoEsecuzione({
      colonne,
      righe,
      changes: contatori.changes,
      lastInsertRowId: contatori.lastInsertRowId,
    });
  }

  async executeForRawResultAsync(...argomenti) {
    return this.executeForRawResultSync(...argomenti);
  }

  getColumnNamesSync() {
    return this.nomiColonne();
  }

  async getColumnNamesAsync() {
    return this.nomiColonne();
  }

  // node:sqlite non espone finalize(): l'istruzione muore col garbage collector.
  // Si segna soltanto lo stato, così un uso dopo la finalizzazione fallisce
  // come fallirebbe sul telefono invece di passare in silenzio.
  finalizeSync() {
    this.finalizzata = true;
  }

  async finalizeAsync() {
    this.finalizzata = true;
  }
}

/**
 * Riproduce SQLiteExecuteAsyncResult: cursore con getFirst/getAll/reset e
 * iterazione. Il vincolo "il cursore deve essere all'inizio" è quello vero di
 * expo: senza, un test potrebbe leggere due volte e non accorgersene.
 */
function risultatoEsecuzione(esito) {
  let indice = 0;
  const guardia = (nome) => {
    if (indice !== 0) {
      throw new Error(
        `Il cursore non è all'inizio: chiamare resetAsync() prima di ${nome}().`
      );
    }
  };
  const risultato = {
    lastInsertRowId: esito.lastInsertRowId,
    changes: esito.changes,
    getFirstSync() {
      guardia("getFirst");
      indice = esito.righe.length;
      return esito.righe.length ? esito.righe[0] : null;
    },
    async getFirstAsync() {
      return risultato.getFirstSync();
    },
    getAllSync() {
      guardia("getAll");
      indice = esito.righe.length;
      return esito.righe.slice();
    },
    async getAllAsync() {
      return risultato.getAllSync();
    },
    resetSync() {
      indice = 0;
    },
    async resetAsync() {
      indice = 0;
    },
    next() {
      return indice < esito.righe.length
        ? { value: esito.righe[indice++], done: false }
        : { value: undefined, done: true };
    },
    async return() {
      indice = esito.righe.length;
      return { value: undefined, done: true };
    },
    [Symbol.iterator]() {
      return risultato;
    },
    [Symbol.asyncIterator]() {
      return {
        async next() {
          return risultato.next();
        },
        async return() {
          return risultato.return();
        },
        [Symbol.asyncIterator]() {
          return this;
        },
      };
    },
  };
  return risultato;
}

// -------------------------------------------------------------- DATABASE
const connessioni = new Map(); // percorso -> BaseDatiDoppia

export class BaseDatiDoppia {
  constructor(percorso, nome, opzioni) {
    this.databasePath = percorso;
    this.nomeDatabase = nome;
    this.options = opzioni ?? {};
    this.motore = new DatabaseSync(percorso, {
      // expo tiene i vincoli di chiave esterna spenti finché non si dà il
      // PRAGMA, e lib/db.ts lo dà a mano: si parte quindi spenti come laggiù.
      enableForeignKeyConstraints: false,
    });
    this.chiusa = false;
  }

  richiediAperta() {
    if (this.chiusa) throw new Error("Database chiuso.");
    return this.motore;
  }

  contatori() {
    const r = this.richiediAperta()
      .prepare("SELECT changes() AS c, last_insert_rowid() AS r")
      .get();
    return { changes: Number(r?.c ?? 0), lastInsertRowId: Number(r?.r ?? 0) };
  }

  // ---- esecuzione
  execSync(sorgente) {
    this.richiediAperta().exec(sorgente);
  }

  async execAsync(sorgente) {
    this.execSync(sorgente);
  }

  prepareSync(sorgente) {
    return new IstruzioneDoppia(this, this.richiediAperta().prepare(sorgente), sorgente);
  }

  async prepareAsync(sorgente) {
    return this.prepareSync(sorgente);
  }

  runSync(sorgente, ...parametri) {
    const esito = this.prepareSync(sorgente).esegui(parametri);
    return { lastInsertRowId: esito.lastInsertRowId, changes: esito.changes };
  }

  async runAsync(sorgente, ...parametri) {
    return this.runSync(sorgente, ...parametri);
  }

  getFirstSync(sorgente, ...parametri) {
    const esito = this.prepareSync(sorgente).esegui(parametri);
    // expo restituisce null quando non c'è nessuna riga; node:sqlite undefined.
    return esito.righe.length ? esito.righe[0] : null;
  }

  async getFirstAsync(sorgente, ...parametri) {
    return this.getFirstSync(sorgente, ...parametri);
  }

  getAllSync(sorgente, ...parametri) {
    return this.prepareSync(sorgente).esegui(parametri).righe;
  }

  async getAllAsync(sorgente, ...parametri) {
    return this.getAllSync(sorgente, ...parametri);
  }

  *getEachSync(sorgente, ...parametri) {
    yield* this.getAllSync(sorgente, ...parametri);
  }

  async *getEachAsync(sorgente, ...parametri) {
    yield* this.getAllSync(sorgente, ...parametri);
  }

  // ---- transazioni
  isInTransactionSync() {
    return this.richiediAperta().isTransaction;
  }

  async isInTransactionAsync() {
    return this.isInTransactionSync();
  }

  /**
   * Copia fedele di expo: BEGIN, corpo, COMMIT; se il corpo lancia, ROLLBACK e
   * si rilancia l'errore originale. È il comportamento su cui si appoggia
   * registra() in lib/db.ts, dove evento e proiezione devono cadere insieme.
   */
  async withTransactionAsync(compito) {
    try {
      await this.execAsync("BEGIN");
      await compito();
      await this.execAsync("COMMIT");
    } catch (errore) {
      await this.execAsync("ROLLBACK");
      throw errore;
    }
  }

  withTransactionSync(compito) {
    try {
      this.execSync("BEGIN");
      compito();
      this.execSync("COMMIT");
    } catch (errore) {
      this.execSync("ROLLBACK");
      throw errore;
    }
  }

  /**
   * expo apre una connessione separata e passa un oggetto `txn`. Qui la
   * connessione è la stessa (vedi LIMITI NOTI): cambia il BEGIN, che è
   * IMMEDIATE, e l'oggetto passato al compito, che è il database stesso.
   */
  async withExclusiveTransactionAsync(compito) {
    let errore;
    try {
      await this.execAsync("BEGIN IMMEDIATE");
      await compito(this);
      await this.execAsync("COMMIT");
    } catch (e) {
      await this.execAsync("ROLLBACK");
      errore = e;
    }
    if (errore) throw errore;
  }

  withExclusiveTransactionSync(compito) {
    let errore;
    try {
      this.execSync("BEGIN IMMEDIATE");
      compito(this);
      this.execSync("COMMIT");
    } catch (e) {
      this.execSync("ROLLBACK");
      errore = e;
    }
    if (errore) throw errore;
  }

  // ---- chiusura
  closeSync() {
    if (this.chiusa) return;
    this.chiusa = true;
    connessioni.delete(this.databasePath);
    this.motore.close();
  }

  async closeAsync() {
    this.closeSync();
  }

  // ---- non disponibili: si fallisce forte invece di fingere
  serializeSync() {
    throw new Error(
      "Doppio expo-sqlite: serializeAsync/serializeSync non esistono in node:sqlite (Node 22)."
    );
  }

  async serializeAsync() {
    return this.serializeSync();
  }

  async createSessionAsync() {
    throw new Error(
      "Doppio expo-sqlite: le sessioni/changeset di expo non sono riprodotte."
    );
  }

  createSessionSync() {
    throw new Error(
      "Doppio expo-sqlite: le sessioni/changeset di expo non sono riprodotte."
    );
  }

  async loadExtensionAsync() {
    throw new Error(
      "Doppio expo-sqlite: nessuna estensione caricabile (serve allowExtension su node:sqlite)."
    );
  }

  loadExtensionSync() {
    return this.loadExtensionAsync();
  }
}

// ------------------------------------------------------- API DEL MODULO
export function openDatabaseSync(nome, opzioni, cartella) {
  const percorso = percorsoDatabase(nome, cartella);
  // expo riusa la connessione già aperta per lo stesso file, a meno di
  // useNewConnection: due openDatabaseAsync() vedono gli stessi dati.
  if (!opzioni?.useNewConnection && percorso !== ":memory:") {
    const gia = connessioni.get(percorso);
    if (gia && !gia.chiusa) return gia;
  }
  const basedati = new BaseDatiDoppia(percorso, nome, opzioni);
  if (percorso !== ":memory:") connessioni.set(percorso, basedati);
  return basedati;
}

export async function openDatabaseAsync(nome, opzioni, cartella) {
  return openDatabaseSync(nome, opzioni, cartella);
}

export function deleteDatabaseSync(nome, cartella) {
  const percorso = percorsoDatabase(nome, cartella);
  const aperta = connessioni.get(percorso);
  if (aperta && !aperta.chiusa) aperta.closeSync();
  for (const suffisso of ["", "-wal", "-shm", "-journal"]) {
    const f = percorso + suffisso;
    if (existsSync(f)) rmSync(f);
  }
}

export async function deleteDatabaseAsync(nome, cartella) {
  deleteDatabaseSync(nome, cartella);
}

/** Nessun update hook in node:sqlite: la sottoscrizione non riceverà mai nulla. */
export function addDatabaseChangeListener() {
  return { remove() {} };
}

export async function deserializeDatabaseAsync() {
  throw new Error("Doppio expo-sqlite: deserializeDatabase* non esiste in node:sqlite (Node 22).");
}

export function deserializeDatabaseSync() {
  throw new Error("Doppio expo-sqlite: deserializeDatabase* non esiste in node:sqlite (Node 22).");
}

export async function backupDatabaseAsync() {
  throw new Error(
    "Doppio expo-sqlite: backupDatabaseAsync non riprodotto (node:sqlite copia su un percorso, non su un database aperto)."
  );
}

export function backupDatabaseSync() {
  throw new Error("Doppio expo-sqlite: backupDatabaseSync non riprodotto.");
}

// Vincolo vivo: vale null finché non si apre il primo database (o finché non
// si chiama configuraCartella). Importare il doppio non deve creare cartelle.
export let defaultDatabaseDirectory = cartellaBase;
export const bundledExtensions = {};

// Nomi della classe come li espone expo, per chi li usa a runtime.
export const SQLiteDatabase = BaseDatiDoppia;
export const SQLiteStatement = IstruzioneDoppia;

export default {
  openDatabaseAsync,
  openDatabaseSync,
  deleteDatabaseAsync,
  deleteDatabaseSync,
  addDatabaseChangeListener,
  deserializeDatabaseAsync,
  deserializeDatabaseSync,
  backupDatabaseAsync,
  backupDatabaseSync,
  SQLiteDatabase,
  SQLiteStatement,
  bundledExtensions,
  configuraCartella,
  cartellaCorrente,
  percorsoDatabase,
};

/*
 * LIMITI NOTI (leggere prima di credere a un test verde)
 *
 * 1. Tutto è sincrono sotto il cofano: i metodi *Async restituiscono una
 *    promessa già risolta. Sul telefono le query girano su un altro thread e
 *    una withTransactionAsync PUÒ essere interrotta da un'altra query: qui no.
 *    Un difetto di concorrenza reale non si manifesta nel banco.
 * 2. withExclusiveTransactionAsync usa la stessa connessione, non una nuova:
 *    non riproduce l'errore "database is locked" fra connessioni.
 * 3. serializeAsync, deserializeDatabaseAsync, backupDatabaseAsync,
 *    createSessionAsync e loadExtensionAsync non hanno equivalente utilizzabile
 *    in node:sqlite su Node 22: lanciano un errore esplicito.
 * 4. addDatabaseChangeListener non emette nulla (node:sqlite non ha update hook).
 * 5. SQLiteProvider e gli hook React (useSQLiteContext, ...) non sono qui: il
 *    banco carica moduli di lib/, non componenti.
 * 6. Gli INTEGER oltre 2^53 tornano come number (node:sqlite li darebbe come
 *    BigInt solo con setReadBigInts): l'app non ne usa.
 * 7. Le classi di errore differiscono: qui arriva un Error con code
 *    ERR_SQLITE_ERROR; il messaggio SQLite ("UNIQUE constraint failed: ...")
 *    è invece lo stesso.
 * 8. journal_mode = WAL su un database :memory: resta "memory": SQLite ignora
 *    la richiesta, come farebbe ovunque.
 */
