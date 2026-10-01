/**
 * Doppio di `expo-network`: la rete la dichiara il test.
 *
 * Per difetto è il wifi, cioè il caso in cui l'app scarica da sola: un test
 * che non dichiara niente vede lo stesso comportamento di prima. Per provare
 * i dati mobili: `fissaRete({ type: NetworkStateType.CELLULAR })`.
 *
 * `fissaRete` avvisa anche chi ascolta, come fa Android a ogni cambio: è
 * così che si prova l'avvio della sincronizzazione all'arrivo del wifi.
 */
export const NetworkStateType = {
  NONE: "NONE",
  UNKNOWN: "UNKNOWN",
  CELLULAR: "CELLULAR",
  WIFI: "WIFI",
  BLUETOOTH: "BLUETOOTH",
  ETHERNET: "ETHERNET",
  WIMAX: "WIMAX",
  VPN: "VPN",
  OTHER: "OTHER",
};

const PER_DIFETTO = { type: NetworkStateType.WIFI, isConnected: true, isInternetReachable: true };
let stato = { ...PER_DIFETTO };
let guasto = null;
const ascoltatori = new Set();

export function fissaRete(nuovo) {
  stato = { ...PER_DIFETTO, ...nuovo };
  guasto = null;
  for (const a of [...ascoltatori]) a({ ...stato });
}

/** getNetworkStateAsync solleva, come su un dispositivo che non risponde. */
export function guastaStatoRete(motivo = "stato della rete non disponibile") {
  guasto = motivo;
}

export function azzeraRete() {
  stato = { ...PER_DIFETTO };
  guasto = null;
  ascoltatori.clear();
}

/** Quanti ascoltano adesso: per provare che chi smette smette davvero. */
export function quantiAscoltano() {
  return ascoltatori.size;
}

export async function getNetworkStateAsync() {
  if (guasto) throw new Error(guasto);
  return { ...stato };
}

export function addNetworkStateListener(ascolta) {
  ascoltatori.add(ascolta);
  return { remove: () => ascoltatori.delete(ascolta) };
}
