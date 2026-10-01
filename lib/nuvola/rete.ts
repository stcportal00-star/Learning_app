/**
 * Su che rete si è. Serve a due cose sole: decidere se scaricare da soli i
 * file grossi (PDF della rassegna, manuali, podcast), e accorgersi di quando
 * arriva il wifi per farlo subito. Sul wifi sì, tutti; sui dati mobili
 * niente, perché in viaggio quei dati si pagano a megabyte e un mese di
 * rassegna sono centinaia di megabyte. Lo scambio degli eventi, che è testo
 * e pesa poco, va su qualunque rete.
 *
 * Un telefono che fa da hotspot al tablet, per il tablet è wifi: Android non
 * dice a expo-network se la rete è a consumo. È il limite noto della regola.
 */
import * as Network from "expo-network";

/**
 * Wifi utilizzabile: connesso, e con internet non smentita. Appena agganciato
 * Android può dire «connesso» prima di aver provato internet (il portale di un
 * albergo): lì un tentativo fallirebbe, e il prossimo arriverebbe solo col
 * giro dei dieci minuti. Si aspetta l'evento che dice che internet c'è.
 */
function wifiUtilizzabile(s: Network.NetworkState): boolean {
  return (
    s.isConnected !== false &&
    s.isInternetReachable !== false &&
    (s.type === Network.NetworkStateType.WIFI || s.type === Network.NetworkStateType.ETHERNET)
  );
}

export async function suWifi(): Promise<boolean> {
  try {
    return wifiUtilizzabile(await Network.getNetworkStateAsync());
  } catch {
    // Nel dubbio non si scarica: un megabyte non speso si recupera al
    // prossimo wifi, uno speso in roaming no.
    return false;
  }
}

/**
 * Chiama `fai` ogni volta che il wifi diventa utilizzabile, non a ogni evento:
 * Android ne manda anche per un cambio di segnale sulla stessa rete, e una
 * sincronizzazione per ciascuno sarebbe rumore. Restituisce come smettere.
 */
export function quandoArrivaIlWifi(fai: () => void): () => void {
  // Finché lo stato iniziale non è noto vale «non sul wifi»: nel peggiore dei
  // casi un evento di wifi arrivato prima fa partire un giro in più, che con
  // la rete già allineata costa una richiesta.
  let eraWifi = false;
  let primoEvento = false;
  void suWifi().then((w) => {
    if (!primoEvento) eraWifi = w;
  });
  const sub = Network.addNetworkStateListener((s) => {
    primoEvento = true;
    const ora = wifiUtilizzabile(s);
    if (ora && !eraWifi) fai();
    eraWifi = ora;
  });
  return () => sub.remove();
}
