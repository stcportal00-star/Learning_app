/**
 * Trasporto 1 — prossimità (Google Nearby Connections: BLE + Wi-Fi Direct).
 *
 * È ciò che hai chiesto: i due dispositivi si trovano da soli quando sono
 * vicini, senza internet e senza tocchi.
 *
 * DIPENDENZA NATIVA: richiede un modulo Kotlin che avvolga l'API Nearby
 * Connections di Google Play Services. La specifica del modulo è nel README.
 * Finché non è compilato, disponibilita() risponde "non disponibile" e la
 * catena scende al livello 2 e poi al 3.
 *
 * Permessi: su Android 12+ servono BLUETOOTH_SCAN, BLUETOOTH_ADVERTISE e
 * BLUETOOTH_CONNECT a runtime; su Android 8-11 serve ACCESS_FINE_LOCATION,
 * perché storicamente la scansione BLE è classificata come geolocalizzazione.
 * Sono già dichiarati in app.json.
 */
import { Platform } from "react-native";
import { Trasporto, StatoTrasporto, EsitoTrasferimento } from "./trasporto";
import { EventoSerializzato, cifra, decifra, impacchetta } from "./pacchetto";

type ModuloVicinanza = {
  permessiConcessi(): Promise<boolean>;
  richiediPermessi(): Promise<boolean>;
  /** Annuncia e cerca insieme; risolve quando un pari accetta. */
  connetti(idServizio: string, timeoutMs: number): Promise<string>;
  invia(idPari: string, dati: string): Promise<void>;
  ricevi(idPari: string, timeoutMs: number): Promise<string>;
  disconnetti(): Promise<void>;
};

let modulo: ModuloVicinanza | null = null;
export function registraVicinanza(m: ModuloVicinanza) { modulo = m; }

const ID_SERVIZIO = "org.alessiomirra.percorso.sync";

export class TrasportoVicinanza implements Trasporto {
  readonly nome = "prossimità";
  readonly livello = 1 as const;

  constructor(private dispositivo: string) {}

  async disponibilita(): Promise<StatoTrasporto> {
    if (Platform.OS !== "android") {
      return { disponibile: false, motivo: "solo Android", rimediabile: false };
    }
    if (!modulo) {
      return { disponibile: false, motivo: "modulo nativo non compilato", rimediabile: true };
    }
    if (!(await modulo.permessiConcessi())) {
      const concessi = await modulo.richiediPermessi();
      if (!concessi) {
        return { disponibile: false, motivo: "permessi Bluetooth negati", rimediabile: true };
      }
    }
    return { disponibile: true };
  }

  async scambia(
    daInviare: EventoSerializzato[],
    opzioni: { passphrase: string; timeoutMs?: number }
  ): Promise<EsitoTrasferimento> {
    if (!modulo) throw new Error("modulo prossimità non disponibile");
    const inizio = Date.now();
    const timeout = opzioni.timeoutMs ?? 15_000;
    const involucro = await cifra(impacchetta(this.dispositivo, daInviare), opzioni.passphrase);

    const pari = await modulo.connetti(ID_SERVIZIO, timeout);
    try {
      await modulo.invia(pari, involucro);
      const risposta = await modulo.ricevi(pari, timeout);
      const pacchetto = await decifra(risposta, opzioni.passphrase);
      return {
        inviati: daInviare.length,
        ricevuti: pacchetto.eventi,
        trasporto: this.nome,
        durataMs: Date.now() - inizio,
      };
    } finally {
      await modulo.disconnetti();
    }
  }
}
