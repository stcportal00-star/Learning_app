/**
 * Promemoria dei blocchi di studio — decisione pura e collaudabile.
 * Separato da notifiche.ts di proposito: là c'è l'accesso al mondo, qui la
 * logica, che si verifica in Node senza emulatore e senza permessi.
 *
 * Nessuna rete: sono notifiche locali, programmate dal sistema operativo. Un
 * promemoria che dipendesse da un server tacerebbe proprio in aereo, che è la
 * finestra per cui l'app esiste.
 */
import { TipoBlocco, DURATA_PREVISTA } from "./sessioni";

export type Promemoria = {
  attivo: boolean;
  ora: number;      // 0-23, ora locale del dispositivo
  minuto: number;   // 0-59
  tipo: TipoBlocco;
};

/**
 * Spento all'inizio. Un'app che si mette a suonare senza che nessuno l'abbia
 * chiesto viene disinstallata, e il permesso va chiesto quando l'utente ha
 * appena espresso l'intenzione, non all'avvio.
 */
export const PREDEFINITO: Promemoria = { attivo: false, ora: 7, minuto: 0, tipo: "mattina" };

const TIPI: TipoBlocco[] = ["mattina", "artefatto", "lettura", "paper", "ripasso"];

export function tipoValido(t: string): t is TipoBlocco {
  return (TIPI as string[]).includes(t);
}

export function oraValida(ora: number, minuto: number): boolean {
  return Number.isInteger(ora) && Number.isInteger(minuto)
      && ora >= 0 && ora <= 23 && minuto >= 0 && minuto <= 59;
}

/** "07:30" per la lettura umana e per i campi di inserimento. */
export function comeTesto(p: Promemoria): string {
  return `${String(p.ora).padStart(2, "0")}:${String(p.minuto).padStart(2, "0")}`;
}

/**
 * Accetta "7:30", "07:30", "0730". Restituisce null su tutto il resto.
 * L'inserimento avviene con la tastiera del telefono, dove si sbaglia spesso:
 * meglio accettare le forme ragionevoli che imporne una.
 */
export function daTesto(testo: string): { ora: number; minuto: number } | null {
  const pulito = String(testo).trim();
  const m = /^(\d{1,2})[:.]?(\d{2})$/.exec(pulito);
  if (!m) return null;
  const ora = Number(m[1]);
  const minuto = Number(m[2]);
  return oraValida(ora, minuto) ? { ora, minuto } : null;
}

/** Forma serializzata per kv-store. Stabile: la si rilegge dopo un aggiornamento. */
export function serializza(p: Promemoria): string {
  return JSON.stringify({ attivo: p.attivo, ora: p.ora, minuto: p.minuto, tipo: p.tipo });
}

/**
 * Tollerante per costruzione: un valore corrotto o scritto da una versione
 * futura non deve impedire l'avvio, quindi si ricade sul predefinito campo
 * per campo invece di sollevare.
 */
export function deserializza(valore: string | null): Promemoria {
  if (!valore) return { ...PREDEFINITO };
  let g: unknown;
  try { g = JSON.parse(valore); } catch { return { ...PREDEFINITO }; }
  if (typeof g !== "object" || g === null) return { ...PREDEFINITO };
  const o = g as Record<string, unknown>;
  const ora = typeof o.ora === "number" ? o.ora : PREDEFINITO.ora;
  const minuto = typeof o.minuto === "number" ? o.minuto : PREDEFINITO.minuto;
  const tipo = typeof o.tipo === "string" && tipoValido(o.tipo) ? o.tipo : PREDEFINITO.tipo;
  return {
    attivo: o.attivo === true,
    ora: oraValida(ora, minuto) ? ora : PREDEFINITO.ora,
    minuto: oraValida(ora, minuto) ? minuto : PREDEFINITO.minuto,
    tipo,
  };
}

/**
 * Quando suonerà la prossima volta. Null se è spento.
 *
 * Si calcola in ora locale e non in UTC: durante il viaggio il fuso cambia, e
 * il promemoria deve restare alle sette del mattino di dove ci si trova, non
 * alle sette di casa. Per la stessa ragione qui non si usano gli HLC, che
 * servono a ordinare gli eventi fra dispositivi, non a dire che ore sono.
 */
export function prossimaOccorrenza(p: Promemoria, adesso: Date): Date | null {
  if (!p.attivo) return null;
  const q = new Date(adesso);
  q.setHours(p.ora, p.minuto, 0, 0);
  if (q.getTime() <= adesso.getTime()) q.setDate(q.getDate() + 1);
  return q;
}

/**
 * Vero se il blocco di oggi risulta già registrato, cioè se il promemoria
 * sarebbe rumore. Non spegne la notifica di sistema — quella si ripete ogni
 * giorno per costruzione — ma permette allo schermo di dirlo, che è la
 * differenza fra un avviso e un rimprovero.
 *
 * `sessioniOdierne` sono gli ISO di inizio delle sessioni già chiuse oggi.
 */
export function giaFattoOggi(p: Promemoria, sessioniOdierne: string[], adesso: Date): boolean {
  const inizioGiorno = new Date(adesso);
  inizioGiorno.setHours(0, 0, 0, 0);
  return sessioniOdierne.some((iso) => {
    const t = new Date(iso).getTime();
    return Number.isFinite(t) && t >= inizioGiorno.getTime() && t <= adesso.getTime();
  });
}

/** Il testo che comparirà sullo schermo bloccato. Breve: si legge di sbieco. */
export function testoNotifica(p: Promemoria): { titolo: string; corpo: string } {
  const nomi: Record<TipoBlocco, string> = {
    mattina: "Blocco del mattino",
    artefatto: "Blocco artefatto",
    lettura: "Blocco lettura",
    paper: "Blocco paper",
    ripasso: "Ripasso",
  };
  return {
    titolo: nomi[p.tipo],
    corpo: `${DURATA_PREVISTA[p.tipo]} minuti. Apri Percorso e avvia il cronometro.`,
  };
}
