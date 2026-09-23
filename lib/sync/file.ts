/**
 * Trasporto 3 — pacchetto cifrato via foglio di condivisione di Android.
 *
 * Non può fallire perché il trasferimento non lo fa questo codice: lo fa il
 * sistema operativo (Bluetooth, Quick Share, cavo, qualunque cosa ci sia).
 * Noi scriviamo un file cifrato e lo consegniamo al selettore di sistema.
 *
 * Costo: due tocchi. Beneficio: funziona ovunque, anche in aereo, anche fra
 * dispositivi che non si sono mai visti, senza permessi speciali.
 */
import { File, Paths } from "expo-file-system";
import * as Sharing from "expo-sharing";
import * as DocumentPicker from "expo-document-picker";
import { Trasporto, StatoTrasporto, EsitoTrasferimento } from "./trasporto";
import { EventoSerializzato, cifra, decifra, impacchetta } from "./pacchetto";

export class TrasportoFile implements Trasporto {
  readonly nome = "file cifrato";
  readonly livello = 3 as const;

  constructor(private dispositivo: string) {}

  async disponibilita(): Promise<StatoTrasporto> {
    const c = (globalThis as { crypto?: Crypto }).crypto;
    if (!c?.subtle) {
      return { disponibile: false, motivo: "WebCrypto non disponibile", rimediabile: false };
    }
    return { disponibile: true };
  }

  /** Esporta: scrive il pacchetto cifrato e apre il foglio di condivisione. */
  async esporta(eventi: EventoSerializzato[], passphrase: string): Promise<string> {
    const involucro = await cifra(impacchetta(this.dispositivo, eventi), passphrase);
    const file = new File(Paths.cache, `percorso-${this.dispositivo}-${Date.now()}.pcs`);
    if (!file.exists) file.create();
    file.write(involucro);
    if (await Sharing.isAvailableAsync()) {
      await Sharing.shareAsync(file.uri, {
        mimeType: "application/octet-stream",
        dialogTitle: "Invia all'altro dispositivo",
      });
    }
    return file.uri;
  }

  /** Importa: apre il selettore e legge un pacchetto ricevuto. */
  async importa(passphrase: string): Promise<EventoSerializzato[]> {
    const scelta = await DocumentPicker.getDocumentAsync({
      type: "*/*",
      copyToCacheDirectory: true,
    });
    if (scelta.canceled || !scelta.assets?.length) return [];
    const testo = await new File(scelta.assets[0].uri).text();
    const pacchetto = await decifra(testo, passphrase);
    if (pacchetto.dispositivo === this.dispositivo) {
      throw new Error("Questo pacchetto è stato creato da questo stesso dispositivo.");
    }
    return pacchetto.eventi;
  }

  /**
   * Scambio completo: prima si esporta, poi si importa il pacchetto dell'altro.
   * Sono due gesti distinti e l'ordine non conta: il registro è append-only.
   */
  async scambia(
    daInviare: EventoSerializzato[],
    opzioni: { passphrase: string }
  ): Promise<EsitoTrasferimento> {
    const inizio = Date.now();
    await this.esporta(daInviare, opzioni.passphrase);
    const ricevuti = await this.importa(opzioni.passphrase);
    return {
      inviati: daInviare.length,
      ricevuti,
      trasporto: this.nome,
      durataMs: Date.now() - inizio,
    };
  }
}
