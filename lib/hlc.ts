/**
 * Orologio logico ibrido (HLC).
 *
 * Perché non basta Date.now(): durante un volo internazionale i due dispositivi
 * possono avere ore di sistema diverse, e un semplice timestamp produrrebbe
 * ordinamenti incoerenti o perdita silenziosa di eventi in fase di fusione.
 *
 * Un HLC combina:
 *   - un tempo fisico in millisecondi, che non torna mai indietro
 *   - un contatore logico, che cresce quando due eventi cadono nello stesso ms
 *   - l'identificativo del dispositivo, per rompere i pareggi in modo stabile
 *
 * La stringa prodotta è ordinabile lessicograficamente: si può usare
 * direttamente in ORDER BY e come chiave di deduplicazione.
 *
 * Formato:  <48 bit esadecimali><4 cifre contatore>-<id dispositivo>
 * Esempio:  0193ac4f2e10-0003-a1b2c3d4
 */

export type HLC = { ms: number; contatore: number; dispositivo: string };

const MAX_CONTATORE = 0xffff;
const DERIVA_MASSIMA_MS = 60_000; // oltre un minuto di deriva: si segnala

export function serializza(h: HLC): string {
  return (
    h.ms.toString(16).padStart(12, "0") +
    "-" +
    h.contatore.toString(16).padStart(4, "0") +
    "-" +
    h.dispositivo
  );
}

export function deserializza(s: string): HLC {
  const [ms, cont, dispositivo] = s.split("-");
  return { ms: parseInt(ms, 16), contatore: parseInt(cont, 16), dispositivo };
}

/** Confronto totale e stabile fra due HLC. */
export function confronta(a: HLC, b: HLC): number {
  if (a.ms !== b.ms) return a.ms - b.ms;
  if (a.contatore !== b.contatore) return a.contatore - b.contatore;
  return a.dispositivo < b.dispositivo ? -1 : a.dispositivo > b.dispositivo ? 1 : 0;
}

export class Orologio {
  private stato: HLC;
  public derivaRilevata = 0;

  constructor(dispositivo: string, statoIniziale?: HLC) {
    this.stato = statoIniziale ?? { ms: 0, contatore: 0, dispositivo };
    this.stato.dispositivo = dispositivo;
  }

  /** Evento locale: avanza l'orologio e restituisce il nuovo timbro. */
  adesso(oraFisica: number = Date.now()): HLC {
    if (oraFisica > this.stato.ms) {
      this.stato = { ms: oraFisica, contatore: 0, dispositivo: this.stato.dispositivo };
    } else {
      // l'ora di sistema è ferma o è tornata indietro: si avanza il contatore
      this.stato = {
        ms: this.stato.ms,
        contatore: this.stato.contatore + 1,
        dispositivo: this.stato.dispositivo,
      };
      if (this.stato.contatore > MAX_CONTATORE) {
        this.stato = { ms: this.stato.ms + 1, contatore: 0, dispositivo: this.stato.dispositivo };
      }
    }
    return { ...this.stato };
  }

  /**
   * Evento ricevuto da un altro dispositivo durante la sincronizzazione.
   * L'orologio locale non torna mai indietro e assorbe il tempo remoto.
   */
  ricevi(remoto: HLC, oraFisica: number = Date.now()): HLC {
    const deriva = Math.abs(remoto.ms - oraFisica);
    if (deriva > this.derivaRilevata) this.derivaRilevata = deriva;

    const massimo = Math.max(this.stato.ms, remoto.ms, oraFisica);
    let contatore: number;
    if (massimo === this.stato.ms && massimo === remoto.ms) {
      contatore = Math.max(this.stato.contatore, remoto.contatore) + 1;
    } else if (massimo === this.stato.ms) {
      contatore = this.stato.contatore + 1;
    } else if (massimo === remoto.ms) {
      contatore = remoto.contatore + 1;
    } else {
      contatore = 0;
    }
    this.stato = { ms: massimo, contatore, dispositivo: this.stato.dispositivo };
    return { ...this.stato };
  }

  /** Deriva superiore a un minuto fra i due dispositivi: da mostrare all'utente. */
  get derivaSospetta(): boolean {
    return this.derivaRilevata > DERIVA_MASSIMA_MS;
  }

  get corrente(): HLC {
    return { ...this.stato };
  }
}
