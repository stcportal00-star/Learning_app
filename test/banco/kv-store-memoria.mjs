/**
 * Doppio di `expo-sqlite/kv-store` tenuto in una Map, con la stessa API
 * asincrona del modulo vero (il rimpiazzo di AsyncStorage dentro expo-sqlite).
 *
 * Esiste accanto al doppio su SQLite (expo-sqlite-kv-store.mjs) perché serve a
 * un'altra cosa: quello prova che l'app funziona sul deposito vero, questo dà
 * a un test un deposito che nasce e muore con il test stesso, senza file, senza
 * cartelle e senza residui fra un caso e l'altro. Si sceglie da fuori, senza
 * toccare il banco:
 *
 *   BANCO_DOPPI='{"expo-sqlite/kv-store":"test/banco/kv-store-memoria.mjs"}'
 *
 * Nota sul tipo dei valori: il deposito vero è una tabella SQLite con colonna
 * TEXT, quindi accetta SOLO stringhe. Qui il controllo è esplicito, perché un
 * doppio che accettasse un oggetto lascerebbe passare un `setItem(chiave,
 * oggetto)` che sul telefono salverebbe "[object Object]".
 */

/** Il deposito. Esportato di proposito: un test può guardarci dentro. */
export const deposito = new Map();

function esigiStringa(chiave, valore) {
  if (typeof valore !== "string") {
    throw new TypeError(
      `kv-store (doppio): il valore di "${chiave}" deve essere una stringa, ricevuto ${typeof valore}`
    );
  }
}

/** Fusione profonda come quella di AsyncStorage: gli oggetti si uniscono, il resto si sostituisce. */
function fondi(precedente, nuovo) {
  if (
    precedente === null || nuovo === null ||
    typeof precedente !== "object" || typeof nuovo !== "object" ||
    Array.isArray(precedente) || Array.isArray(nuovo)
  ) {
    return nuovo;
  }
  const esito = { ...precedente };
  for (const chiave of Object.keys(nuovo)) esito[chiave] = fondi(precedente[chiave], nuovo[chiave]);
  return esito;
}

export class SQLiteStorage {
  constructor(nomeDatabase = "ExpoSQLiteStorage") {
    this.nomeDatabase = nomeDatabase;
    this.dati = deposito;
  }

  // ------------------------------------------------------------ sincrono
  getItemSync(chiave) {
    return this.dati.has(chiave) ? this.dati.get(chiave) : null;
  }

  setItemSync(chiave, valore) {
    // expo accetta anche una funzione di aggiornamento: nuovo = f(precedente).
    const finale = typeof valore === "function" ? valore(this.getItemSync(chiave)) : valore;
    esigiStringa(chiave, finale);
    this.dati.set(chiave, finale);
  }

  removeItemSync(chiave) {
    return this.dati.delete(chiave);
  }

  getAllKeysSync() {
    return [...this.dati.keys()];
  }

  clearSync() {
    const c = this.dati.size > 0;
    this.dati.clear();
    return c;
  }

  getLengthSync() {
    return this.dati.size;
  }

  getKeyByIndexSync(indice) {
    if (!Number.isSafeInteger(indice) || indice < 0) return null;
    return this.getAllKeysSync()[indice] ?? null;
  }

  closeSync() {
    // Niente da chiudere: la memoria se ne va con il processo.
  }

  // ------------------------------------------------------------ asincrono
  async getItemAsync(chiave) { return this.getItemSync(chiave); }
  async setItemAsync(chiave, valore) { this.setItemSync(chiave, valore); }
  async removeItemAsync(chiave) { return this.removeItemSync(chiave); }
  async getAllKeysAsync() { return this.getAllKeysSync(); }
  async clearAsync() { return this.clearSync(); }
  async getLengthAsync() { return this.getLengthSync(); }
  async getKeyByIndexAsync(indice) { return this.getKeyByIndexSync(indice); }
  async closeAsync() { this.closeSync(); }

  // ------------------------------------- alias compatibili con AsyncStorage
  async getItem(chiave) { return this.getItemSync(chiave); }
  async setItem(chiave, valore) { this.setItemSync(chiave, valore); }
  async removeItem(chiave) { this.removeItemSync(chiave); }
  async getAllKeys() { return this.getAllKeysSync(); }
  async clear() { this.clearSync(); }
  async close() { this.closeSync(); }

  async mergeItem(chiave, valore) {
    const precedente = this.getItemSync(chiave);
    if (precedente == null) {
      this.setItemSync(chiave, valore);
      return;
    }
    this.setItemSync(chiave, JSON.stringify(fondi(JSON.parse(precedente), JSON.parse(valore))));
  }
  async multiGet(chiavi) { return chiavi.map((c) => [c, this.getItemSync(c)]); }
  async multiSet(coppie) { for (const [c, v] of coppie) this.setItemSync(c, v); }
  async multiRemove(chiavi) { for (const c of chiavi) this.removeItemSync(c); }
  async multiMerge(coppie) { for (const [c, v] of coppie) await this.mergeItem(c, v); }
}

/** Svuota il deposito fra un caso di prova e l'altro. */
export function azzera() {
  deposito.clear();
}

export const AsyncStorage = new SQLiteStorage();
export const Storage = AsyncStorage;
export default AsyncStorage;
