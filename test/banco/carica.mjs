/**
 * Punto di ingresso del banco: registra i ganci che sostituiscono i moduli
 * nativi con i doppi e insegnano a Node a leggere i .ts del progetto.
 *
 * Uso (la via provata, vedi prova-banco.mjs):
 *
 *   node --import ./test/banco/carica.mjs test/banco/prova-banco.mjs
 *
 * Dentro il test il codice dell'app si carica così:
 *
 *   const db = await import("../../lib/db.ts");
 *
 * Deve essere un import DINAMICO: gli import statici di un modulo vengono
 * risolti prima che il corpo del modulo giri, quindi in un test che registra i
 * ganci da sé partirebbero prima dei doppi. Con --import il problema non si
 * pone, ma la forma dinamica funziona in entrambi i casi ed è quella da usare.
 *
 * Per aggiungere altri doppi (expo-file-system, expo-asset, ...) senza toccare
 * questi file, si passa la variabile d'ambiente:
 *
 *   BANCO_DOPPI='{"expo-file-system":"test/banco/expo-file-system.mjs"}' node --import ...
 */
import { register } from "node:module";
import { dirname, resolve as risolviPercorso } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

register("./hook-risolutore.mjs", import.meta.url);

export const CARTELLA_BANCO = dirname(fileURLToPath(import.meta.url));
export const RADICE_PROGETTO = risolviPercorso(CARTELLA_BANCO, "..", "..");

/**
 * Carica un modulo dell'app per percorso relativo alla radice del progetto.
 * Comodità: `await importaApp("lib/db.ts")` invece di comporre l'URL a mano.
 */
export function importaApp(percorsoRelativo) {
  return import(pathToFileURL(risolviPercorso(RADICE_PROGETTO, percorsoRelativo)).href);
}
