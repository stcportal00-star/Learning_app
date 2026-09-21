/**
 * Trasporto 2 — Wi-Fi locale.
 *
 * Il dispositivo che avvia lo scambio apre un hotspot (o entrambi sono sulla
 * stessa rete) e serve il pacchetto cifrato su HTTP locale. Non serve internet:
 * un hotspot senza connessione dati funziona benissimo.
 *
 * DIPENDENZA NATIVA: un server HTTP su dispositivo non esiste in JavaScript
 * puro. Serve un modulo nativo. Finché non è installato, disponibilita()
 * risponde "non disponibile" e la catena degrada al trasporto 3 senza errori.
 *
 * Questa è una scelta deliberata: meglio un trasporto onestamente assente che
 * un trasporto che finge di esserci e fallisce a metà trasferimento.
 */
import { Trasporto, StatoTrasporto, EsitoTrasferimento } from "./trasporto";
import { EventoSerializzato, cifra, decifra, impacchetta } from "./pacchetto";

type ServerLocale = {
  avvia(porta: number, contenuto: string): Promise<string>; // ritorna l'URL
  ferma(): Promise<void>;
};

let moduloServer: ServerLocale | null = null;

/** Registrato all'avvio dell'app se il modulo nativo è presente. */
export function registraServer(s: ServerLocale) {
  moduloServer = s;
}

export class TrasportoWifi implements Trasporto {
  readonly nome = "wi-fi locale";
  readonly livello = 2 as const;

  constructor(private dispositivo: string, private porta = 8787) {}

  async disponibilita(): Promise<StatoTrasporto> {
    if (!moduloServer) {
      return {
        disponibile: false,
        motivo: "modulo server locale non installato",
        rimediabile: true,
      };
    }
    return { disponibile: true };
  }

  async scambia(
    daInviare: EventoSerializzato[],
    opzioni: { passphrase: string; timeoutMs?: number }
  ): Promise<EsitoTrasferimento> {
    if (!moduloServer) throw new Error("server locale non disponibile");
    const inizio = Date.now();
    const involucro = await cifra(impacchetta(this.dispositivo, daInviare), opzioni.passphrase);
    const url = await moduloServer.avvia(this.porta, involucro);
    try {
      // L'altro dispositivo scarica da `url` e risponde con il proprio pacchetto.
      const risposta = await fetch(`${url}/pari`, {
        method: "POST",
        body: involucro,
        headers: { "Content-Type": "application/json" },
        signal: AbortSignal.timeout(opzioni.timeoutMs ?? 30_000),
      });
      if (!risposta.ok) throw new Error(`HTTP ${risposta.status}`);
      const pacchetto = await decifra(await risposta.text(), opzioni.passphrase);
      return {
        inviati: daInviare.length,
        ricevuti: pacchetto.eventi,
        trasporto: this.nome,
        durataMs: Date.now() - inizio,
      };
    } finally {
      await moduloServer.ferma();
    }
  }
}
