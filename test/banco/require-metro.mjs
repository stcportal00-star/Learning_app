/**
 * `require()` finto in stile Metro, per i moduli dell'app caricati come ESM.
 *
 * Perché serve: `lib/contenuti.ts` e `lib/palestra.ts` scrivono
 * `require("../assets/contenuti/esercizi_sql.json")` e
 * `Asset.fromModule(require("../assets/contenuti/palestra.db"))`. È l'idioma di
 * Metro, l'impacchettatore di React Native: a compilazione ogni asset diventa
 * un numero, e `require` restituisce quel numero (o direttamente l'oggetto, se
 * è un JSON). In Node quei file diventano moduli ESM, dove `require` non
 * esiste: senza questo gancio il codice dell'app muore con
 * "require is not defined" alla prima riga che tocca un asset.
 *
 * Il gancio sta qui e non nel risolutore del banco perché è una bugia
 * NECESSARIA ma LOCALE: la si installa nel test, si vede nel test.
 *
 * Limite del travestimento: un `require` globale non sa da quale file è stato
 * chiamato, mentre Metro sì. Qui i "../" iniziali si tolgono e il resto si
 * risolve dalla radice del progetto. Per gli asset dell'app basta: stanno
 * tutti sotto assets/ e sono sempre citati come "../assets/...".
 */
import { existsSync, readFileSync } from "node:fs";
import { basename, extname, isAbsolute, resolve as risolvi } from "node:path";

/** id numerico -> { id, percorso, nome, tipo }. È il registro degli asset di Metro. */
export const registroAsset = new Map();
/** specificatore scritto nel codice -> percorso vero (lo può cambiare un test). */
const sostituzioni = new Map();
const idPerPercorso = new Map();
const jsonLetti = new Map();
let prossimoId = 1;

let radiceProgetto = null;

/** Risolve "../assets/x", "@/assets/x", "assets/x" o un percorso assoluto. */
export function risolviSpecificatore(specificatore) {
  if (sostituzioni.has(specificatore)) return sostituzioni.get(specificatore);
  const testo = String(specificatore);
  if (isAbsolute(testo)) return testo;
  const ripulito = testo.replace(/^@\//, "").replace(/^(\.\.?\/)+/, "");
  return risolvi(radiceProgetto ?? process.cwd(), ripulito);
}

/**
 * Fa puntare uno specificatore a un altro file. Serve a simulare un
 * aggiornamento dell'app: `preparaLettore()` deve ricopiare il lettore quando
 * l'asset cambia, e senza questa leva non ci sarebbe modo di provarlo senza
 * toccare i file del repository.
 */
export function mappaAsset(specificatore, percorsoVero) {
  sostituzioni.set(specificatore, risolvi(percorsoVero));
}

export function annullaMappature() {
  sostituzioni.clear();
}

/** Registra un percorso come modulo asset e ne restituisce l'id numerico. */
export function idAsset(percorso) {
  const assoluto = risolvi(percorso);
  if (idPerPercorso.has(assoluto)) return idPerPercorso.get(assoluto);
  const id = prossimoId++;
  const nomeFile = basename(assoluto);
  const estensione = extname(nomeFile);
  registroAsset.set(id, {
    id,
    percorso: assoluto,
    nome: nomeFile.slice(0, nomeFile.length - estensione.length),
    tipo: estensione.replace(/^\./, ""),
  });
  idPerPercorso.set(assoluto, id);
  return id;
}

/** Descrittore di un id, per il doppio di expo-asset. */
export function descrittoreAsset(id) {
  return registroAsset.get(id) ?? null;
}

/**
 * Il `require` vero e proprio: JSON letto e interpretato (come fa Metro),
 * qualunque altro file registrato come asset e restituito come numero.
 */
export function requireFinto(specificatore) {
  const percorso = risolviSpecificatore(specificatore);
  if (!existsSync(percorso)) {
    throw new Error(`require finto: nessun file per "${specificatore}" (cercato in ${percorso})`);
  }
  if (percorso.endsWith(".json")) {
    // Metro incorpora il JSON già interpretato e lo condivide fra i chiamanti:
    // stessa cosa qui, altrimenti ogni require rileggerebbe 100 KB dal disco.
    if (!jsonLetti.has(percorso)) jsonLetti.set(percorso, JSON.parse(readFileSync(percorso, "utf8")));
    return jsonLetti.get(percorso);
  }
  return idAsset(percorso);
}

/**
 * Installa il gancio globale. Va chiamato PRIMA di importare i moduli dell'app
 * che toccano gli asset (l'import dinamico dei test lo garantisce).
 */
export function installaRequireMetro(radice) {
  radiceProgetto = risolvi(radice);
  if (typeof globalThis.require !== "function") globalThis.require = requireFinto;
  return globalThis.require;
}

export function disinstallaRequireMetro() {
  if (globalThis.require === requireFinto) delete globalThis.require;
}
