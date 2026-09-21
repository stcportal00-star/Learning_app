/**
 * Doppio di `expo-intent-launcher` — gli intent di Android.
 *
 * `apriVolume()` consegna il PDF al visore di sistema con un intent VIEW e, se
 * nessuna app lo raccoglie, ripiega sul foglio di condivisione. Quel ramo di
 * ripiego è la parte che si rompe sul telefono di qualcun altro, quindi deve
 * essere provabile: qui l'assenza di visore si programma in una riga.
 *
 * Il giornale conserva azione e parametri: il test verifica che il flag
 * FLAG_GRANT_READ_URI_PERMISSION ci sia davvero (senza, il visore esterno non
 * può leggere il file) e che il tipo MIME sia quello giusto per epub e pdf.
 */
export const giornale = [];

/** Codici di uscita veri di Android (ActivityResult). */
export const ResultCode = { Success: -1, Canceled: 0, FirstUser: 1 };

/** Solo le azioni che l'app usa; l'enum vero ne elenca centinaia di impostazioni. */
export const ActivityAction = {
  VIEW: "android.intent.action.VIEW",
  SEND: "android.intent.action.SEND",
  APPLICATION_DETAILS_SETTINGS: "android.settings.APPLICATION_DETAILS_SETTINGS",
  APP_NOTIFICATION_SETTINGS: "android.settings.APP_NOTIFICATION_SETTINGS",
};

let esitoProgrammato = { resultCode: ResultCode.Success };
let nessunVisore = false;

/** Da ora in poi nessuna app raccoglie gli intent: startActivityAsync solleva. */
export function programmaNessunVisore(attivo = true) {
  nessunVisore = attivo;
}

/** Esito da restituire quando l'intent riesce. */
export function programmaEsito(esito) {
  esitoProgrammato = esito;
}

export function azzera() {
  giornale.length = 0;
  esitoProgrammato = { resultCode: ResultCode.Success };
  nessunVisore = false;
}

export async function startActivityAsync(azione, parametri = {}) {
  const registrazione = { chiamata: "startActivityAsync", azione, parametri, esito: null };
  giornale.push(registrazione);
  if (nessunVisore) {
    registrazione.esito = "nessuna_app";
    // Messaggio nella forma che Android produce davvero: è quello che il
    // codice dell'app vede nel catch.
    throw new Error(
      "ActivityNotFoundException: No Activity found to handle Intent { act=" + azione + " }"
    );
  }
  registrazione.esito = esitoProgrammato;
  return esitoProgrammato;
}

export async function openApplication(pacchetto) {
  giornale.push({ chiamata: "openApplication", pacchetto });
}

export default { ActivityAction, ResultCode, startActivityAsync, openApplication };
