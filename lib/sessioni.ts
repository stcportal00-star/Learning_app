/**
 * Registro delle sessioni di studio.
 *
 * La schermata Oggi mostra "0 h" finché nessuno registra i blocchi: questo
 * modulo chiude il cerchio. Logica pura, collaudabile senza dispositivo.
 *
 * I blocchi del piano sono fissi e brevi per scelta: nessuno supera i 45
 * minuti, perché ciò che richiede due ore consecutive non sopravvive alla
 * vita reale.
 */

export type TipoBlocco = "mattina" | "artefatto" | "lettura" | "paper" | "ripasso";

export const DURATA_PREVISTA: Record<TipoBlocco, number> = {
  mattina: 30,
  artefatto: 45,
  lettura: 25,
  paper: 25,
  ripasso: 15,
};

export const OBIETTIVO_SETTIMANALE_MIN = 300; // 5 ore
export const MINIMO_SOPRAVVIVENZA_MIN = 120; // 2 ore: sotto, pausa dichiarata

/** Una sessione più corta di così è un'interruzione, non un blocco di studio. */
const MINIMO_VALIDO_MIN = 5;
/** Oltre questa soglia è quasi certamente un cronometro dimenticato acceso. */
const MASSIMO_PLAUSIBILE_MIN = 180;

export type EsitoChiusura =
  | { valida: true; minuti: number; avviso?: string }
  | { valida: false; motivo: string };

/**
 * Chiude un cronometro e decide se la sessione è registrabile.
 * Un cronometro dimenticato acceso per una notte non deve gonfiare la settimana.
 */
export function chiudiSessione(inizioMs: number, fineMs: number, tipo: TipoBlocco): EsitoChiusura {
  if (fineMs <= inizioMs) return { valida: false, motivo: "fine precedente all'inizio" };
  const minuti = Math.round((fineMs - inizioMs) / 60_000);

  if (minuti < MINIMO_VALIDO_MIN) {
    return { valida: false, motivo: `meno di ${MINIMO_VALIDO_MIN} minuti: non registrata` };
  }
  if (minuti > MASSIMO_PLAUSIBILE_MIN) {
    return {
      valida: true,
      minuti: DURATA_PREVISTA[tipo],
      avviso:
        `Cronometro rimasto acceso ${minuti} minuti: registrata la durata prevista ` +
        `del blocco (${DURATA_PREVISTA[tipo]} min). Correggila se è sbagliata.`,
    };
  }
  const previsto = DURATA_PREVISTA[tipo];
  if (minuti > previsto * 2) {
    return {
      valida: true,
      minuti,
      avviso: `Blocco di ${minuti} minuti, oltre il doppio dei ${previsto} previsti. ` +
              "Il piano regge solo se i blocchi restano brevi.",
    };
  }
  return { valida: true, minuti };
}

export type Sessione = { inizio: string; minuti: number; tipo: TipoBlocco };

/** Lunedì 00:00 della settimana che contiene `data`, in ora locale. */
export function inizioSettimana(data: Date): Date {
  const d = new Date(data);
  const giorno = (d.getDay() + 6) % 7; // lunedì = 0
  d.setDate(d.getDate() - giorno);
  d.setHours(0, 0, 0, 0);
  return d;
}

export type Riepilogo = {
  minuti: number;
  perTipo: Record<TipoBlocco, number>;
  livello: "sopravvivenza" | "base" | "surge";
  mancanoAlBase: number;
  sottoMinimo: boolean;
};

/**
 * Riepilogo della settimana secondo i tre livelli del piano:
 * sopravvivenza (2 h), base (5 h), surge (8 h).
 */
export function riepilogoSettimana(sessioni: Sessione[], riferimento: Date): Riepilogo {
  const da = inizioSettimana(riferimento).getTime();
  const a = da + 7 * 864e5;
  const perTipo: Record<TipoBlocco, number> = { mattina: 0, artefatto: 0, lettura: 0, paper: 0, ripasso: 0 };
  let minuti = 0;
  for (const s of sessioni) {
    const t = new Date(s.inizio).getTime();
    if (t < da || t >= a) continue;
    minuti += s.minuti;
    perTipo[s.tipo] += s.minuti;
  }
  const livello = minuti >= 480 ? "surge" : minuti >= OBIETTIVO_SETTIMANALE_MIN ? "base" : "sopravvivenza";
  return {
    minuti,
    perTipo,
    livello,
    mancanoAlBase: Math.max(0, OBIETTIVO_SETTIMANALE_MIN - minuti),
    sottoMinimo: minuti < MINIMO_SOPRAVVIVENZA_MIN,
  };
}

/**
 * Regola delle tre settimane: se se ne perdono tre di fila, non si recupera.
 * Si riprende da dove si era e si sposta il trimestre.
 */
export function settimaneConsecutiveSottoMinimo(sessioni: Sessione[], oggi: Date): number {
  let conteggio = 0;
  for (let i = 1; i <= 12; i++) {
    const rif = new Date(inizioSettimana(oggi).getTime() - i * 7 * 864e5 + 864e5);
    if (riepilogoSettimana(sessioni, rif).sottoMinimo) conteggio++;
    else break;
  }
  return conteggio;
}
