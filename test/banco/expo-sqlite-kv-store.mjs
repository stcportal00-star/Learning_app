/**
 * Doppio di `expo-sqlite/kv-store` (il rimpiazzo di AsyncStorage dentro expo-sqlite).
 *
 * Perché sta qui: `lib/sync/stato.ts`, `lib/notifiche.ts`, `app/_layout.tsx` e
 * `components/Cronometro.tsx` importano questo sottopercorso. Senza il doppio,
 * il risolutore del banco riuscirebbe a caricare lib/db.ts ma si fermerebbe al
 * primo modulo che tocca lo stato della sincronizzazione.
 *
 * Schema e istruzioni sono quelli veri (node_modules/expo-sqlite/build/Storage.js):
 * tabella `storage(key TEXT PRIMARY KEY NOT NULL, value TEXT)` nel database
 * `ExpoSQLiteStorage`, così anche un test che guarda dentro il file trova
 * quello che troverebbe sul telefono.
 */
import { openDatabaseSync } from "./expo-sqlite.mjs";

const CREA = "CREATE TABLE IF NOT EXISTS storage (key TEXT PRIMARY KEY NOT NULL, value TEXT);";

export class SQLiteStorage {
  constructor(nomeDatabase) {
    this.nomeDatabase = nomeDatabase;
    this.basedati = null;
  }

  db() {
    if (!this.basedati || this.basedati.chiusa) {
      this.basedati = openDatabaseSync(this.nomeDatabase);
      this.basedati.execSync(CREA);
    }
    return this.basedati;
  }

  // ------------------------------------------------------------ sincrono
  getItemSync(chiave) {
    const r = this.db().getFirstSync("SELECT value FROM storage WHERE key = ?;", chiave);
    return r ? r.value : null;
  }

  setItemSync(chiave, valore) {
    // expo accetta anche una funzione di aggiornamento: nuovo = f(precedente).
    const finale = typeof valore === "function" ? valore(this.getItemSync(chiave)) : valore;
    this.db().runSync(
      "INSERT INTO storage (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value;",
      [chiave, finale]
    );
  }

  removeItemSync(chiave) {
    return this.db().runSync("DELETE FROM storage WHERE key = ?;", chiave).changes > 0;
  }

  getAllKeysSync() {
    return this.db().getAllSync("SELECT key FROM storage;").map((r) => r.key);
  }

  clearSync() {
    return this.db().runSync("DELETE FROM storage;").changes > 0;
  }

  getLengthSync() {
    const r = this.db().getFirstSync("SELECT COUNT(*) as count FROM storage;");
    return r ? r.count : 0;
  }

  getKeyByIndexSync(indice) {
    if (!Number.isSafeInteger(indice) || indice < 0) return null;
    const r = this.db().getFirstSync("SELECT key FROM storage LIMIT 1 OFFSET ?;", indice);
    return r ? r.key : null;
  }

  closeSync() {
    if (this.basedati && !this.basedati.chiusa) this.basedati.closeSync();
    this.basedati = null;
  }

  // ------------------------------------------------------------ asincrono
  async getItemAsync(chiave) {
    return this.getItemSync(chiave);
  }
  async setItemAsync(chiave, valore) {
    this.setItemSync(chiave, valore);
  }
  async removeItemAsync(chiave) {
    return this.removeItemSync(chiave);
  }
  async getAllKeysAsync() {
    return this.getAllKeysSync();
  }
  async clearAsync() {
    return this.clearSync();
  }
  async getLengthAsync() {
    return this.getLengthSync();
  }
  async getKeyByIndexAsync(indice) {
    return this.getKeyByIndexSync(indice);
  }
  async closeAsync() {
    this.closeSync();
  }

  // ------------------------------------- alias compatibili con AsyncStorage
  async getItem(chiave) {
    return this.getItemSync(chiave);
  }
  async setItem(chiave, valore) {
    this.setItemSync(chiave, valore);
  }
  async removeItem(chiave) {
    this.removeItemSync(chiave);
  }
  async getAllKeys() {
    return this.getAllKeysSync();
  }
  async clear() {
    this.clearSync();
  }
  async close() {
    this.closeSync();
  }
  async mergeItem(chiave, valore) {
    const precedente = this.getItemSync(chiave);
    if (precedente == null) {
      this.setItemSync(chiave, valore);
      return;
    }
    this.setItemSync(chiave, JSON.stringify(fondi(JSON.parse(precedente), JSON.parse(valore))));
  }
  async multiGet(chiavi) {
    return chiavi.map((c) => [c, this.getItemSync(c)]);
  }
  async multiSet(coppie) {
    for (const [c, v] of coppie) this.setItemSync(c, v);
  }
  async multiRemove(chiavi) {
    for (const c of chiavi) this.removeItemSync(c);
  }
  async multiMerge(coppie) {
    for (const [c, v] of coppie) await this.mergeItem(c, v);
  }
}

/** Fusione profonda come quella di AsyncStorage: gli oggetti si uniscono, il resto si sostituisce. */
function fondi(precedente, nuovo) {
  if (
    precedente === null ||
    nuovo === null ||
    typeof precedente !== "object" ||
    typeof nuovo !== "object" ||
    Array.isArray(precedente) ||
    Array.isArray(nuovo)
  ) {
    return nuovo;
  }
  const esito = { ...precedente };
  for (const chiave of Object.keys(nuovo)) esito[chiave] = fondi(precedente[chiave], nuovo[chiave]);
  return esito;
}

export const AsyncStorage = new SQLiteStorage("ExpoSQLiteStorage");
export const Storage = AsyncStorage;
export default AsyncStorage;
