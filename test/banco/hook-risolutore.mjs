/**
 * Ganci di caricamento (resolve + load) del banco. Girano in un thread a parte,
 * caricati da carica.mjs con module.register(): è la sola via in Node 22 per
 * cambiare cosa significa `import "expo-sqlite"` dentro il codice dell'app.
 *
 * Due lavori:
 *   1. RISOLVERE i moduli nativi verso i doppi di questa cartella (e verso
 *      quelli che un altro test aggiunge con la variabile BANCO_DOPPI).
 *   2. COMPILARE i .ts/.tsx al volo con il compilatore TypeScript che il
 *      progetto ha già in node_modules.
 *
 * Perché non basta lo spogliamento dei tipi incorporato in Node: lib/db.ts fa
 * `import { Orologio, serializza, HLC } from "./hlc"` e HLC è solo un tipo.
 * Node toglie le annotazioni ma non sa quali nomi siano tipi, quindi lascia
 * l'importazione e il caricamento muore con "does not provide an export named
 * 'HLC'". `ts.transpileModule` invece elide i nomi non usati come valori.
 * Il codice dell'app non si tocca: è il banco che si adatta.
 */
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, resolve as risolviPercorso } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const require = createRequire(import.meta.url);
const ts = require("typescript");

const QUESTA_CARTELLA = dirname(fileURLToPath(import.meta.url));
const RADICE_PROGETTO = risolviPercorso(QUESTA_CARTELLA, "..", "..");

/** Modulo nativo -> doppio. Le chiavi sono gli specificatori scritti nell'app. */
const DOPPI = new Map([
  ["expo-sqlite", pathToFileURL(risolviPercorso(QUESTA_CARTELLA, "expo-sqlite.mjs")).href],
  [
    "expo-sqlite/kv-store",
    pathToFileURL(risolviPercorso(QUESTA_CARTELLA, "expo-sqlite-kv-store.mjs")).href,
  ],
]);

// Altri agenti costruiscono altri doppi (expo-file-system, expo-asset, ...):
// li aggiungono da fuori, senza modificare questo file.
// BANCO_DOPPI='{"expo-file-system":"/percorso/assoluto/doppio.mjs"}'
if (process.env.BANCO_DOPPI) {
  for (const [specificatore, percorso] of Object.entries(JSON.parse(process.env.BANCO_DOPPI))) {
    DOPPI.set(
      specificatore,
      percorso.startsWith("file:") ? percorso : pathToFileURL(risolviPercorso(percorso)).href
    );
  }
}

// TypeScript permette di omettere l'estensione; ESM no. Si riprova a mano.
const ESTENSIONI = [".ts", ".tsx", ".mjs", ".js", "/index.ts", "/index.tsx"];

export async function resolve(specificatore, contesto, successivo) {
  const doppio = DOPPI.get(specificatore);
  if (doppio) return { url: doppio, format: "module", shortCircuit: true };

  // L'alias "@/..." di tsconfig.json punta alla radice del progetto.
  if (specificatore.startsWith("@/")) {
    return resolve(
      pathToFileURL(risolviPercorso(RADICE_PROGETTO, specificatore.slice(2))).href,
      contesto,
      successivo
    );
  }

  try {
    return await successivo(specificatore, contesto);
  } catch (errore) {
    const relativo = specificatore.startsWith(".") || specificatore.startsWith("/");
    if (!relativo && !specificatore.startsWith("file:")) throw errore;
    for (const estensione of ESTENSIONI) {
      try {
        return await successivo(specificatore + estensione, contesto);
      } catch {
        // si prova la prossima estensione
      }
    }
    throw errore;
  }
}

export async function load(url, contesto, successivo) {
  if (url.startsWith("file:") && /\.tsx?($|\?)/.test(url)) {
    const percorso = fileURLToPath(new URL(url));
    const sorgente = await readFile(percorso, "utf8");
    const compilato = ts.transpileModule(sorgente, {
      fileName: percorso,
      compilerOptions: {
        module: ts.ModuleKind.ESNext,
        target: ts.ScriptTarget.ES2022,
        jsx: ts.JsxEmit.ReactJSX,
        esModuleInterop: true,
        isolatedModules: true,
        inlineSourceMap: true,
        inlineSources: true,
      },
    }).outputText;
    return { format: "module", source: compilato, shortCircuit: true };
  }
  return successivo(url, contesto);
}
