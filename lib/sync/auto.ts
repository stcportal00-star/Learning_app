/**
 * Politica di sincronizzazione automatica.
 *
 * Con entrambi i dispositivi in mano, il rischio non è più "non riesco a
 * connettermi": è DIVERGERE senza accorgersene. Fai venti esercizi sul tablet,
 * prendi il telefono, e il telefono ti ripropone gli stessi venti.
 *
 * Questo modulo decide QUANDO tentare uno scambio. È volutamente puro: nessuna
 * rete, nessun database, solo una decisione a partire da uno stato osservabile.
 * È ciò che lo rende collaudabile senza due telefoni in mano.
 */

export type StatoSync = {
  /** Eventi locali non ancora inviati al pari. */
  inSospeso: number;
  /** Millisecondi dall'ultimo scambio riuscito. null se mai avvenuto. */
  daUltimoScambioMs: number | null;
  /** L'app è in primo piano adesso? */
  inPrimoPiano: boolean;
  /** Il dispositivo è accoppiato con il suo pari? */
  accoppiato: boolean;
  /** Un tentativo è già in corso? */
  inCorso: boolean;
  /** Tentativi consecutivi falliti: serve per il backoff. */
  fallimentiConsecutivi: number;
  /** Batteria sotto la soglia critica: non si insiste con la radio. */
  batteriaBassa: boolean;
};

export type Decisione =
  | { tenta: false; motivo: string }
  | { tenta: true; motivo: string; urgenza: "alta" | "normale" };

const SOGLIA_EVENTI_URGENTE = 25;
const INTERVALLO_MINIMO_MS = 90_000; // non più di uno scambio ogni minuto e mezzo
const INTERVALLO_PERIODICO_MS = 15 * 60_000; // scambio di cortesia ogni quarto d'ora
const BACKOFF_BASE_MS = 60_000;
const BACKOFF_MASSIMO_MS = 30 * 60_000;

/** Attesa minima dopo N fallimenti consecutivi. */
export function attesaBackoff(fallimenti: number): number {
  if (fallimenti <= 0) return 0;
  return Math.min(BACKOFF_BASE_MS * 2 ** (fallimenti - 1), BACKOFF_MASSIMO_MS);
}

export function decidi(s: StatoSync): Decisione {
  if (!s.accoppiato) return { tenta: false, motivo: "dispositivi non accoppiati" };
  if (s.inCorso) return { tenta: false, motivo: "scambio già in corso" };
  if (!s.inPrimoPiano) return { tenta: false, motivo: "app in secondo piano" };
  if (s.batteriaBassa && s.inSospeso < SOGLIA_EVENTI_URGENTE) {
    return { tenta: false, motivo: "batteria bassa, niente radio per pochi eventi" };
  }

  const attesa = attesaBackoff(s.fallimentiConsecutivi);
  const trascorso = s.daUltimoScambioMs;

  if (s.fallimentiConsecutivi > 0 && trascorso !== null && trascorso < attesa) {
    return {
      tenta: false,
      motivo: `backoff dopo ${s.fallimentiConsecutivi} fallimenti: mancano ${Math.ceil((attesa - trascorso) / 1000)} s`,
    };
  }

  if (trascorso === null) {
    return { tenta: true, motivo: "primo scambio dopo l'accoppiamento", urgenza: "alta" };
  }

  if (trascorso < INTERVALLO_MINIMO_MS) {
    return { tenta: false, motivo: "scambio troppo recente" };
  }

  if (s.inSospeso >= SOGLIA_EVENTI_URGENTE) {
    return { tenta: true, motivo: `${s.inSospeso} eventi in sospeso`, urgenza: "alta" };
  }

  if (s.inSospeso > 0 && trascorso >= INTERVALLO_PERIODICO_MS) {
    return { tenta: true, motivo: "scambio periodico", urgenza: "normale" };
  }

  if (s.inSospeso === 0 && trascorso >= INTERVALLO_PERIODICO_MS) {
    // Nessun evento locale, ma il pari potrebbe averne: si va a ritirare.
    return { tenta: true, motivo: "ritiro eventuali novità dal pari", urgenza: "normale" };
  }

  return { tenta: false, motivo: "nulla da scambiare" };
}

// ------------------------------------------------------------ divergenza
export type Divergenza = {
  livello: "allineati" | "leggera" | "marcata";
  messaggio: string;
  eventiLocali: number;
  minutiDaUltimoScambio: number | null;
};

/**
 * Quanto sono lontani i due dispositivi? Serve a mostrare un avviso PRIMA che
 * l'utente ricominci a lavorare su quello sbagliato.
 */
export function valutaDivergenza(s: StatoSync): Divergenza {
  const minuti = s.daUltimoScambioMs === null ? null : Math.floor(s.daUltimoScambioMs / 60_000);

  if (!s.accoppiato) {
    return {
      livello: "marcata",
      messaggio: "Dispositivi non accoppiati: i progressi restano separati.",
      eventiLocali: s.inSospeso,
      minutiDaUltimoScambio: minuti,
    };
  }
  if (s.inSospeso === 0 && minuti !== null && minuti < 60) {
    return {
      livello: "allineati",
      messaggio: "Allineati.",
      eventiLocali: 0,
      minutiDaUltimoScambio: minuti,
    };
  }
  if (s.inSospeso >= SOGLIA_EVENTI_URGENTE || (minuti !== null && minuti >= 240) || minuti === null) {
    return {
      livello: "marcata",
      messaggio:
        minuti === null
          ? "Mai sincronizzato: l'altro dispositivo non sa nulla di questo lavoro."
          : `${s.inSospeso} eventi non condivisi, ultimo scambio ${minuti} minuti fa. ` +
            "Se passi all'altro dispositivo, ti riproporrà esercizi già fatti.",
      eventiLocali: s.inSospeso,
      minutiDaUltimoScambio: minuti,
    };
  }
  return {
    livello: "leggera",
    messaggio: `${s.inSospeso} eventi da condividere.`,
    eventiLocali: s.inSospeso,
    minutiDaUltimoScambio: minuti,
  };
}

/**
 * In aereo la rete dati non c'è, ma Bluetooth e Wi-Fi restano utilizzabili
 * dopo il decollo. La mancanza di internet NON deve disattivare la
 * sincronizzazione: i trasporti 1 e 2 sono progettati proprio per questo.
 */
export function trasportiUtilizzabili(connettivita: {
  internet: boolean;
  bluetooth: boolean;
  wifi: boolean;
}): Array<1 | 2 | 3> {
  const livelli: Array<1 | 2 | 3> = [];
  if (connettivita.bluetooth) livelli.push(1);
  if (connettivita.wifi) livelli.push(2);
  livelli.push(3); // il file non dipende da nessuna radio
  return livelli;
}
