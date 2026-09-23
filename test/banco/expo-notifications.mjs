/**
 * Doppio di `expo-notifications` — notifiche LOCALI, quelle che programma il
 * sistema operativo a partire da un'ora.
 *
 * Cosa deve poter dimostrare il test, e che solo un giornale permette di
 * dimostrare: che `applica()` CANCELLA SEMPRE prima di riprogrammare. Senza
 * quella cancellazione, cambiare l'ora del promemoria lascerebbe in piedi
 * anche la vecchia notifica e dopo tre modifiche il telefono suonerebbe tre
 * volte a ore che nessuno ha più chiesto. Il conteggio finale non basterebbe a
 * scoprirlo (una programmata resta una programmata): serve l'ORDINE delle
 * chiamate, ed è per questo che il giornale conserva ogni voce in sequenza.
 *
 * Programmabili: stato del permesso (concesso, negato, negato per sempre) e
 * guasto della programmazione.
 *
 * Nomi, enum e forma degli oggetti seguono expo-notifications 0.32
 * (node_modules/expo-notifications/build).
 */

/** Giornale ispezionabile: ogni chiamata che cambia lo stato del sistema. */
export const giornale = [];

/** Le notifiche che il sistema ha in programma, nell'ordine in cui sono arrivate. */
const inProgramma = [];
const canali = new Map();

let permesso = { status: "granted", canAskAgain: true, expires: "never" };
let richiesteDiPermesso = 0;
let erroreProgrammazione = null;
let contatore = 0;

export const AndroidImportance = {
  UNKNOWN: 0,
  UNSPECIFIED: 1,
  NONE: 2,
  MIN: 3,
  LOW: 4,
  DEFAULT: 5,
  HIGH: 6,
  MAX: 7,
};

export const AndroidNotificationPriority = {
  MIN: "min",
  LOW: "low",
  DEFAULT: "default",
  HIGH: "high",
  MAX: "max",
};

export const SchedulableTriggerInputTypes = {
  CALENDAR: "calendar",
  DAILY: "daily",
  WEEKLY: "weekly",
  MONTHLY: "monthly",
  YEARLY: "yearly",
  DATE: "date",
  TIME_INTERVAL: "timeInterval",
};

// ------------------------------------------------------------ PROGRAMMA IL DOPPIO
/**
 * Stato del permesso. I tre casi che contano:
 *   { status: "granted" }                              concesso
 *   { status: "undetermined", canAskAgain: true }      mai chiesto
 *   { status: "denied", canAskAgain: false }           negato per sempre:
 *       Android non ripropone più la richiesta, e l'app deve dirlo invece di
 *       insistere. È il caso che il codice sbaglia più spesso.
 */
export function programmaPermesso(stato) {
  permesso = { expires: "never", canAskAgain: true, ...stato };
}

/** Che cosa risponde il sistema quando l'app CHIEDE il permesso. */
let rispostaAllaRichiesta = null;
export function programmaRispostaRichiesta(stato) {
  rispostaAllaRichiesta = { expires: "never", canAskAgain: true, ...stato };
}

/** La prossima scheduleNotificationAsync fallisce. */
export function programmaErrore(messaggio) {
  erroreProgrammazione = messaggio;
}

export function azzera() {
  giornale.length = 0;
  inProgramma.length = 0;
  canali.clear();
  permesso = { status: "granted", canAskAgain: true, expires: "never" };
  rispostaAllaRichiesta = null;
  erroreProgrammazione = null;
  richiesteDiPermesso = 0;
  contatore = 0;
}

/** Quante volte l'app ha CHIESTO il permesso: chiederlo a sproposito è un difetto. */
export function conteggioRichiestePermesso() {
  return richiesteDiPermesso;
}

export function canaliRegistrati() {
  return [...canali.values()];
}

// ------------------------------------------------------------------ PERMESSI
function esitoPermesso(stato) {
  return {
    status: stato.status,
    granted: stato.status === "granted",
    canAskAgain: stato.canAskAgain,
    expires: stato.expires ?? "never",
    android: { importance: AndroidImportance.DEFAULT },
  };
}

export async function getPermissionsAsync() {
  const esito = esitoPermesso(permesso);
  giornale.push({ azione: "legge-permesso", esito: esito.status });
  return esito;
}

export async function requestPermissionsAsync(richiesta) {
  richiesteDiPermesso++;
  if (rispostaAllaRichiesta) permesso = rispostaAllaRichiesta;
  else if (permesso.status === "undetermined") permesso = { ...permesso, status: "granted" };
  const esito = esitoPermesso(permesso);
  giornale.push({ azione: "chiede-permesso", richiesta, esito: esito.status });
  return esito;
}

export async function getExpoPushTokenAsync() {
  // Volutamente non implementata: un token richiede la rete e un server, e
  // l'app non lo usa. Meglio un errore netto che un finto token.
  throw new Error("expo-notifications (doppio): nessun token remoto, l'app usa solo notifiche locali");
}

// ------------------------------------------------------------------- CANALI
export async function setNotificationChannelAsync(id, canale) {
  const registrato = { id, ...canale };
  canali.set(id, registrato);
  giornale.push({ azione: "canale", id, canale: registrato });
  return registrato;
}

export async function getNotificationChannelsAsync() {
  return canaliRegistrati();
}

export async function deleteNotificationChannelAsync(id) {
  canali.delete(id);
  giornale.push({ azione: "cancella-canale", id });
}

// ------------------------------------------------------------ PROGRAMMAZIONE
/** Controlli che fa anche il modulo vero: un trigger malformato viene rifiutato. */
function controllaTrigger(trigger) {
  if (trigger === null || trigger === undefined) return;
  if (trigger.type === SchedulableTriggerInputTypes.DAILY) {
    const { hour, minute } = trigger;
    const valido =
      Number.isInteger(hour) && Number.isInteger(minute) &&
      hour >= 0 && hour <= 23 && minute >= 0 && minute <= 59;
    if (!valido) {
      throw new Error(
        `Failed to schedule the notification. Trigger is invalid: hour=${hour} minute=${minute}`
      );
    }
  }
}

export async function scheduleNotificationAsync(richiesta) {
  if (erroreProgrammazione) {
    const messaggio = erroreProgrammazione;
    erroreProgrammazione = null;
    giornale.push({ azione: "programma-fallita", errore: messaggio });
    throw new Error(messaggio);
  }
  controllaTrigger(richiesta?.trigger);
  const identificatore = richiesta?.identifier ?? `banco-notifica-${++contatore}`;
  const voce = {
    identifier: identificatore,
    content: { title: null, body: null, data: {}, ...(richiesta?.content ?? {}) },
    trigger: richiesta?.trigger ?? null,
  };
  inProgramma.push(voce);
  giornale.push({ azione: "programma", identificatore, notifica: voce });
  return identificatore;
}

export async function getAllScheduledNotificationsAsync() {
  return inProgramma.map((v) => ({ ...v }));
}

export async function cancelScheduledNotificationAsync(identificatore) {
  const indice = inProgramma.findIndex((v) => v.identifier === identificatore);
  if (indice >= 0) inProgramma.splice(indice, 1);
  giornale.push({ azione: "cancella", identificatore, trovata: indice >= 0 });
}

export async function cancelAllScheduledNotificationsAsync() {
  const quante = inProgramma.length;
  inProgramma.length = 0;
  giornale.push({ azione: "cancella-tutte", quante });
}

export async function dismissAllNotificationsAsync() {
  giornale.push({ azione: "chiudi-tutte" });
}

export async function presentNotificationAsync(contenuto) {
  giornale.push({ azione: "mostra-subito", contenuto });
  return `banco-immediata-${++contatore}`;
}

// ------------------------------------------------------------------ ASCOLTO
export function setNotificationHandler(gestore) {
  giornale.push({ azione: "gestore", impostato: gestore !== null });
}

function sottoscrizione(nome) {
  return { remove() { giornale.push({ azione: "toglie-ascolto", nome }); } };
}

export function addNotificationReceivedListener() {
  return sottoscrizione("ricevuta");
}

export function addNotificationResponseReceivedListener() {
  return sottoscrizione("risposta");
}

export default {
  AndroidImportance,
  AndroidNotificationPriority,
  SchedulableTriggerInputTypes,
  addNotificationReceivedListener,
  addNotificationResponseReceivedListener,
  cancelAllScheduledNotificationsAsync,
  cancelScheduledNotificationAsync,
  dismissAllNotificationsAsync,
  getAllScheduledNotificationsAsync,
  getNotificationChannelsAsync,
  getPermissionsAsync,
  presentNotificationAsync,
  requestPermissionsAsync,
  scheduleNotificationAsync,
  setNotificationChannelAsync,
  setNotificationHandler,
};

/* ------------------------------------------------------------ LIMITI NOTI
 * - Il tempo non passa: le notifiche restano "in programma" per sempre e non
 *   suonano mai. Il doppio prova COSA viene chiesto al sistema, non che il
 *   sistema mantenga la promessa: quello lo prova solo il telefono.
 * - Niente notifiche remote (token, server, rete): l'app non le usa.
 */
