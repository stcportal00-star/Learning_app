/**
 * Elenco dei doppi di QUESTO gruppo (tutti i moduli nativi tranne expo-sqlite,
 * che ha il suo file e il suo autore).
 *
 * Serve a due cose:
 *   - non ripetere a mano la variabile BANCO_DOPPI in ogni test;
 *   - dare agli altri agenti (test/simulazione/) un punto solo da importare.
 *
 * Uso da riga di comando:
 *
 *   BANCO_DOPPI="$(node -e 'import("./test/banco/doppi-altri.mjs").then(m=>console.log(m.variabileBanco()))')" \
 *     node --import ./test/banco/carica.mjs test/simulazione/mio-caso.mjs
 *
 * Uso da dentro un test che si riavvia da solo: vedi prova-altri.mjs.
 *
 * `expo-sqlite` e `expo-sqlite/kv-store` NON sono qui: il risolutore del banco
 * li registra già da sé. Il deposito in memoria si aggiunge di proposito,
 * quando un test lo preferisce a quello su SQLite (vedi KV_MEMORIA).
 */
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const QUESTA_CARTELLA = dirname(fileURLToPath(import.meta.url));

function qui(nome) {
  return join(QUESTA_CARTELLA, nome);
}

export const DOPPI_ALTRI = {
  "expo-file-system": qui("expo-file-system.mjs"),
  "expo-asset": qui("expo-asset.mjs"),
  "expo-crypto": qui("expo-crypto.mjs"),
  "expo-document-picker": qui("expo-document-picker.mjs"),
  "expo-intent-launcher": qui("expo-intent-launcher.mjs"),
  "expo-sharing": qui("expo-sharing.mjs"),
  "expo-notifications": qui("expo-notifications.mjs"),
  // Non è un modulo Expo, ma lib/notifiche.ts non si carica senza Platform.
  "react-native": qui("react-native.mjs"),
};

/** Deposito chiave-valore in memoria, da usare al posto di quello su SQLite. */
export const KV_MEMORIA = qui("kv-store-memoria.mjs");

/** Il valore pronto per la variabile d'ambiente BANCO_DOPPI. */
export function variabileBanco(aggiunte = {}) {
  return JSON.stringify({ ...DOPPI_ALTRI, ...aggiunte });
}
