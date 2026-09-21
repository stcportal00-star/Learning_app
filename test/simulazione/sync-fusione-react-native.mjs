/**
 * Doppio di `react-native` per la superficie "sync-fusione".
 *
 * Perche' esiste accanto a test/banco/react-native.mjs invece di modificarlo:
 * quel file e' di un altro agente e il mio vincolo e' non toccarlo. Mi serve
 * pero' una cosa che li' non c'e': `AppState`. lib/sync/stato.ts legge
 * `AppState.currentState` per sapere se l'app e' in primo piano, e senza quel
 * campo `statoCorrente()` morirebbe con "Cannot read properties of undefined"
 * prima ancora di arrivare alla decisione che voglio provare.
 *
 * Si registra da fuori, con BANCO_DOPPI, quindi nessun file di nessuno cambia:
 *
 *   BANCO_DOPPI='{"react-native":"test/simulazione/sync-fusione-react-native.mjs"}'
 *
 * Platform viene ripreso tale e quale dal doppio del banco (import relativo,
 * che il risolutore non rimappa): cosi' TrasportoVicinanza vede lo stesso
 * "android" che vede il resto delle prove, e non nascono due verita' diverse.
 */
import { Platform, configuraPiattaforma } from "../banco/react-native.mjs";

export { Platform, configuraPiattaforma };

/**
 * Lo stato dell'app. Sul telefono e' "active", "background" o "inactive";
 * qui e' una variabile che il test sposta, perche' la meta' delle decisioni di
 * lib/sync/auto.ts dipende proprio dall'essere o no in primo piano.
 */
let statoApp = "active";

/** Il test finge il passaggio in secondo piano senza nessun sistema operativo. */
export function configuraStatoApp(nuovo) {
  statoApp = nuovo;
}

const ascoltatori = new Set();

export const AppState = {
  get currentState() {
    return statoApp;
  },
  addEventListener(tipo, ascoltatore) {
    const voce = { tipo, ascoltatore };
    ascoltatori.add(voce);
    return {
      remove() {
        ascoltatori.delete(voce);
      },
    };
  },
};

/** Sveglia gli ascoltatori come farebbe il sistema al ritorno in primo piano. */
export function emettiCambioStato(nuovo) {
  configuraStatoApp(nuovo);
  for (const { tipo, ascoltatore } of ascoltatori) {
    if (tipo === "change") ascoltatore(nuovo);
  }
}

export default { Platform, AppState };
