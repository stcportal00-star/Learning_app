/**
 * Notifiche locali — l'accesso al mondo. La decisione sta in promemoria.ts.
 *
 * Solo notifiche locali: le programma il sistema operativo a partire da
 * un'ora, senza token, senza server, senza rete. Una notifica remota tacerebbe
 * proprio in aereo.
 *
 * `expo-notifications` è nel catalogo Expo SDK 54 (~0.32.17, verificato in
 * node_modules/expo/bundledNativeModules.json): invariante 8 rispettata.
 *
 * Il modulo si importa in modo differito dentro le funzioni. Caricarlo in testa
 * lo farebbe eseguire all'avvio dell'app anche per chi non ha mai acceso i
 * promemoria, e farebbe fallire i test in Node, dove il nativo non esiste.
 */
import AsyncStorageLike from "expo-sqlite/kv-store";
import { Platform } from "react-native";
import { Promemoria, PREDEFINITO, serializza, deserializza, testoNotifica } from "./promemoria";

const CHIAVE = "promemoria";

/** Canale Android dedicato: l'utente può silenziarlo senza silenziare l'app. */
const CANALE = "blocchi";

export async function leggiPromemoria(): Promise<Promemoria> {
  try {
    return deserializza(await AsyncStorageLike.getItem(CHIAVE));
  } catch {
    // Una preferenza illeggibile non deve impedire di aprire la schermata.
    return { ...PREDEFINITO };
  }
}

export async function salvaPromemoria(p: Promemoria): Promise<void> {
  await AsyncStorageLike.setItem(CHIAVE, serializza(p));
}

/**
 * Chiede il permesso solo se non è già concesso. Restituisce false anche
 * quando l'utente ha negato in passato: in quel caso il sistema non ripropone
 * la richiesta, e l'unica via è l'impostazione di Android — lo schermo lo dice.
 */
export async function permessoConcesso(chiediSeManca: boolean): Promise<boolean> {
  const N = await import("expo-notifications");
  const attuale = await N.getPermissionsAsync();
  if (attuale.granted) return true;
  if (!chiediSeManca || !attuale.canAskAgain) return false;
  const chiesto = await N.requestPermissionsAsync();
  return chiesto.granted;
}

async function preparaCanale(): Promise<void> {
  if (Platform.OS !== "android") return;
  const N = await import("expo-notifications");
  await N.setNotificationChannelAsync(CANALE, {
    name: "Blocchi di studio",
    importance: N.AndroidImportance.DEFAULT,
    sound: "default",
  });
}

/**
 * Porta il sistema nello stato descritto dal promemoria: una sola notifica
 * quotidiana, o nessuna.
 *
 * Cancella sempre prima di programmare, e non solo quando spegne: senza,
 * cambiare l'ora lascerebbe in piedi anche la vecchia, e dopo qualche modifica
 * il telefono suonerebbe a ore che nessuno ha più chiesto. È anche ciò che
 * rende la funzione idempotente, così la si può richiamare a ogni avvio per
 * ripristinare la programmazione dopo un riavvio o un aggiornamento.
 */
export async function applica(p: Promemoria): Promise<boolean> {
  const N = await import("expo-notifications");
  await N.cancelAllScheduledNotificationsAsync();
  if (!p.attivo) return true;

  if (!(await permessoConcesso(false))) return false;
  await preparaCanale();

  const { titolo, corpo } = testoNotifica(p);
  await N.scheduleNotificationAsync({
    content: { title: titolo, body: corpo },
    trigger: {
      type: N.SchedulableTriggerInputTypes.DAILY,
      hour: p.ora,
      minute: p.minuto,
      channelId: CANALE,
    },
  });
  return true;
}

/**
 * Da chiamare all'avvio. Riallinea il sistema alla preferenza salvata senza
 * chiedere nulla e senza mai sollevare: un guasto delle notifiche non deve
 * impedire di studiare.
 */
export async function ripristina(): Promise<void> {
  try {
    const p = await leggiPromemoria();
    if (p.attivo) await applica(p);
  } catch {
    // volutamente silenzioso: è un extra, non un requisito di avvio
  }
}

/** Quante notifiche risultano programmate. Serve allo schermo per dire il vero. */
export async function programmate(): Promise<number> {
  try {
    const N = await import("expo-notifications");
    return (await N.getAllScheduledNotificationsAsync()).length;
  } catch {
    return 0;
  }
}
