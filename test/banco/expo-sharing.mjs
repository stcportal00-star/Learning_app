/**
 * Doppio di `expo-sharing` — il foglio di condivisione di Android.
 *
 * È l'ultima spiaggia di due funzioni dell'app: `apriVolume()` ci finisce
 * quando nessun visore PDF è installato, e `TrasportoFile.esporta()` lo usa
 * come trasporto vero e proprio fra i due dispositivi. Entrambi i casi vanno
 * provati, e senza un giornale non si saprebbe nemmeno se il foglio è stato
 * aperto, né con quale file.
 *
 * Esiti programmabili: disponibile o no, e condivisione che fallisce.
 */
export const giornale = [];

let disponibile = true;
let erroreProssimaCondivisione = null;

/** Programma la disponibilità: su un dispositivo senza app di condivisione è falsa. */
export function programmaDisponibilita(valore) {
  disponibile = valore;
}

/** La prossima shareAsync fallisce con questo messaggio (poi torna a funzionare). */
export function programmaErrore(messaggio) {
  erroreProssimaCondivisione = messaggio;
}

export function azzera() {
  giornale.length = 0;
  disponibile = true;
  erroreProssimaCondivisione = null;
}

export async function isAvailableAsync() {
  giornale.push({ chiamata: "isAvailableAsync", esito: disponibile });
  return disponibile;
}

export async function shareAsync(url, opzioni = {}) {
  const registrazione = { chiamata: "shareAsync", url, opzioni, esito: "aperto" };
  giornale.push(registrazione);
  if (erroreProssimaCondivisione) {
    const messaggio = erroreProssimaCondivisione;
    erroreProssimaCondivisione = null;
    registrazione.esito = "errore";
    throw new Error(messaggio);
  }
  // Il foglio vero non dice cosa ha scelto l'utente: restituisce void.
  return undefined;
}

export default { isAvailableAsync, shareAsync };
