/**
 * Doppio di `expo-document-picker`.
 *
 * Il selettore vero apre una finestra di sistema e aspetta un dito: in Node
 * non c'è né finestra né dito. Questo doppio fa due cose:
 *
 *   1. SCRIVE NEL GIORNALE ogni chiamata ricevuta, con le opzioni. Il test può
 *      controllare che `importaPdf()` chieda davvero PDF ed EPUB e non
 *      "qualunque cosa", e che `importaBiblioteca()` chieda multiple: true.
 *   2. RESTITUISCE ESITI PROGRAMMATI dal test: file scelti, annullamento,
 *      errore. Sono i tre rami che il codice dell'app deve saper reggere, e
 *      l'annullamento è quello che in mano a un utente capita più spesso.
 *
 * Forma del risultato come in expo 14 (node_modules/expo-document-picker):
 *   { canceled: true,  assets: null }
 *   { canceled: false, assets: [{ name, uri, size, mimeType, lastModified }] }
 */
import { copyFileSync, existsSync, statSync } from "node:fs";
import { basename, extname, join } from "node:path";
import { percorsoCache, uriDa } from "./expo-file-system.mjs";

/** Giornale ispezionabile: una voce per chiamata, in ordine. */
export const giornale = [];

/** Coda degli esiti programmati. Vuota = l'utente annulla. */
const esiti = [];

const TIPI = new Map([
  [".pdf", "application/pdf"],
  [".epub", "application/epub+zip"],
  [".json", "application/json"],
  [".pcs", "application/octet-stream"],
  [".txt", "text/plain"],
]);

/**
 * Programma i prossimi esiti, nell'ordine. Ogni voce può essere:
 *   { percorsi: ["/percorso/vero.pdf"] }  -> l'utente sceglie quei file
 *   { annullato: true }                   -> l'utente chiude il selettore
 *   { errore: "messaggio" }               -> il selettore fallisce
 *   { assets: [...] }                     -> risultato costruito a mano
 *   (opzioni) => risultato                -> funzione, per i casi difficili
 */
export function programma(...voci) {
  esiti.push(...voci);
}

/** Svuota giornale e coda: da chiamare fra un caso di prova e l'altro. */
export function azzera() {
  giornale.length = 0;
  esiti.length = 0;
}

function assetDa(percorso, opzioni) {
  if (!existsSync(percorso)) {
    throw new Error(`expo-document-picker (doppio): file inesistente — ${percorso}`);
  }
  const nome = basename(percorso);
  let scelto = percorso;
  // Il selettore vero, con copyToCacheDirectory, consegna una COPIA in cache:
  // l'originale può stare in una cartella a cui l'app non ha accesso stabile.
  // Riprodurlo conta: è la copia che il codice dell'app poi ricopia altrove.
  if (opzioni?.copyToCacheDirectory !== false) {
    scelto = join(percorsoCache(), nome);
    if (scelto !== percorso) copyFileSync(percorso, scelto);
  }
  const stato = statSync(scelto);
  return {
    name: nome,
    uri: uriDa(scelto),
    size: stato.size,
    mimeType: TIPI.get(extname(nome).toLowerCase()) ?? "application/octet-stream",
    lastModified: Math.round(stato.mtimeMs),
  };
}

export async function getDocumentAsync(opzioni = {}) {
  const voce = esiti.shift();
  const registrazione = { chiamata: "getDocumentAsync", opzioni, esito: null };
  giornale.push(registrazione);

  if (typeof voce === "function") {
    const risultato = await voce(opzioni);
    registrazione.esito = risultato;
    return risultato;
  }
  if (voce && voce.errore) {
    registrazione.esito = { errore: voce.errore };
    throw new Error(voce.errore);
  }
  if (!voce || voce.annullato) {
    // Nessun esito programmato: l'utente ha annullato. È il caso più comune sul
    // telefono, quindi è anche il comportamento predefinito del doppio.
    const risultato = { canceled: true, assets: null };
    registrazione.esito = risultato;
    return risultato;
  }

  const assets = voce.assets ?? (voce.percorsi ?? []).map((p) => assetDa(p, opzioni));
  if (!opzioni.multiple && assets.length > 1) {
    throw new Error(
      "expo-document-picker (doppio): programmati più file ma multiple non è attivo"
    );
  }
  const risultato = { canceled: false, assets };
  registrazione.esito = risultato;
  return risultato;
}

export default { getDocumentAsync };
