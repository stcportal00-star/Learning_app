/**
 * I tre trasporti dietro un'unica interfaccia.
 *
 * La catena degrada da sola:
 *
 *   1. vicinanza   BLE + Wi-Fi Direct      automatico, nessun tocco
 *          ↓ permessi negati, API < 26, nessun pari trovato entro 15 s
 *   2. wifiLocale  hotspot + HTTP locale   automatico se la stessa rete
 *          ↓ nessuna rete comune, porta occupata
 *   3. file        pacchetto cifrato       NON PUÒ FALLIRE
 *
 * Il livello 3 non dipende da codice nostro per il trasferimento: lo esegue il
 * sistema operativo tramite il foglio di condivisione. È la rete di sicurezza,
 * ed è per questo che è il primo a essere stato costruito, non l'ultimo.
 */
import { EventoSerializzato } from "./pacchetto";

export type StatoTrasporto =
  | { disponibile: true }
  | { disponibile: false; motivo: string; rimediabile: boolean };

export type EsitoTrasferimento = {
  inviati: number;
  ricevuti: EventoSerializzato[];
  trasporto: string;
  durataMs: number;
};

export interface Trasporto {
  readonly nome: string;
  readonly livello: 1 | 2 | 3;
  /** Verifica preventiva: permessi, versione di sistema, moduli nativi presenti. */
  disponibilita(): Promise<StatoTrasporto>;
  /** Scambio bidirezionale. Solleva se fallisce: la catena passa al livello successivo. */
  scambia(
    daInviare: EventoSerializzato[],
    opzioni: { passphrase: string; timeoutMs?: number }
  ): Promise<EsitoTrasferimento>;
}

export type DiarioSync = Array<{ trasporto: string; esito: string; dettaglio?: string }>;

/**
 * Prova i trasporti in ordine di livello e restituisce il primo che riesce.
 * Ogni fallimento è registrato: l'utente vede perché si è arrivati al file,
 * invece di un generico "sincronizzazione non riuscita".
 */
export async function sincronizza(
  trasporti: Trasporto[],
  daInviare: EventoSerializzato[],
  opzioni: { passphrase: string; timeoutMs?: number; soloLivello?: 1 | 2 | 3 }
): Promise<{ esito: EsitoTrasferimento | null; diario: DiarioSync }> {
  const diario: DiarioSync = [];
  const ordinati = [...trasporti].sort((a, b) => a.livello - b.livello);

  for (const t of ordinati) {
    if (opzioni.soloLivello && t.livello !== opzioni.soloLivello) continue;

    let stato: StatoTrasporto;
    try {
      stato = await t.disponibilita();
    } catch (e) {
      diario.push({ trasporto: t.nome, esito: "non verificabile", dettaglio: String(e) });
      continue;
    }

    if (!stato.disponibile) {
      diario.push({ trasporto: t.nome, esito: "non disponibile", dettaglio: stato.motivo });
      continue;
    }

    try {
      const r = await t.scambia(daInviare, opzioni);
      diario.push({
        trasporto: t.nome,
        esito: "riuscito",
        dettaglio: `${r.inviati} inviati, ${r.ricevuti.length} ricevuti in ${r.durataMs} ms`,
      });
      return { esito: r, diario };
    } catch (e) {
      diario.push({ trasporto: t.nome, esito: "fallito", dettaglio: String(e) });
    }
  }

  return { esito: null, diario };
}

/** Riassunto leggibile del diario, per la schermata di sincronizzazione. */
export function riassumi(diario: DiarioSync): string {
  const riuscito = diario.find((d) => d.esito === "riuscito");
  if (!riuscito) {
    return "Nessun trasporto ha funzionato. " + diario.map((d) => `${d.trasporto}: ${d.dettaglio ?? d.esito}`).join(" · ");
  }
  const saltati = diario.filter((d) => d.esito !== "riuscito");
  if (!saltati.length) return `Sincronizzato via ${riuscito.trasporto}. ${riuscito.dettaglio}`;
  return (
    `Sincronizzato via ${riuscito.trasporto}. ${riuscito.dettaglio}. ` +
    `Saltati: ${saltati.map((s) => `${s.trasporto} (${s.dettaglio ?? s.esito})`).join(", ")}`
  );
}
