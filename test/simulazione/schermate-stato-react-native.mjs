/**
 * Doppio di `react-native` per la superficie "schermate-stato".
 *
 * Perche' non uso e non tocco test/banco/react-native.mjs: quel file e' di un
 * altro agente e contiene SOLO `Platform`. A me serve anche `AppState`, perche'
 * lib/sync/stato.ts legge `AppState.currentState` per sapere se l'app e' in
 * primo piano, e senza quel campo `divergenzaCorrente()` — che le schermate
 * Oggi, Profilo e Sincronizzazione chiamano al montaggio — morirebbe con
 * "Cannot read properties of undefined" prima di arrivare allo stato che voglio
 * provare.
 *
 * Si registra da fuori con BANCO_DOPPI, quindi nessun file di nessuno cambia.
 * `Platform` viene ripreso dal doppio del banco con un import relativo (che il
 * risolutore non rimappa): cosi' lib/notifiche.ts vede lo stesso "android" che
 * vede il resto delle prove e non nascono due verita' diverse.
 */
import { Platform, configuraPiattaforma } from "../banco/react-native.mjs";

export { Platform, configuraPiattaforma };

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

export default { Platform, AppState };
