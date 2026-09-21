/**
 * Doppio di `expo-sqlite` INSTABILE: identico a quello del banco, tranne che
 * openDatabaseAsync fallisce per i nomi che cominciano con il prefisso indicato
 * dalla variabile MOTORE_SQL_APERTURA_ROTTA.
 *
 * Serve a uno scenario solo, PRE-02: in lib/palestra.ts la copia del file e
 * l'apertura stanno FUORI dal try, e il finally copre solo cio' che viene dopo.
 * Se l'apertura fallisce, la copia da 2 MB resta in Documents/SQLite per
 * sempre. Senza poter far fallire l'apertura, quel ramo non si puo' visitare.
 *
 * Si installa da fuori con BANCO_DOPPI, come prescrive il banco: non tocca
 * nessun file di test/banco/.
 */
import * as vero from "../banco/expo-sqlite.mjs";

export * from "../banco/expo-sqlite.mjs";

export async function openDatabaseAsync(nome, opzioni, cartella) {
  const prefisso = process.env.MOTORE_SQL_APERTURA_ROTTA;
  if (prefisso && String(nome).startsWith(prefisso)) {
    throw new Error(`apertura simulata come fallita per ${nome}`);
  }
  return vero.openDatabaseAsync(nome, opzioni, cartella);
}

export default { ...vero.default, openDatabaseAsync };
