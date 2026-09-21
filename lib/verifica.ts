/**
 * Motore di verifica degli esercizi.
 *
 * Principio: la risposta non si confronta con il testo della soluzione, ma con
 * il RISULTATO della soluzione. Una query scritta diversamente ma corretta deve
 * passare. Il giudizio non è mio: è l'esecuzione.
 *
 * Tutto gira in locale su palestra.db, senza rete.
 */

export type Riga = unknown[];

export type Esito = {
  corretto: boolean;
  motivo:
    | "identico"
    | "identico_a_meno_dell_ordine"
    | "colonne_diverse"
    | "righe_diverse"
    | "valori_diversi"
    | "errore_sql";
  dettaglio: string;
  righeAttese?: number;
  righeOttenute?: number;
  errore?: string;
};

/** Normalizza un valore per il confronto: i numeri a 6 decimali, il resto come stringa. */
function norm(v: unknown): string {
  if (v === null || v === undefined) return "\u0000NULL";
  if (typeof v === "number") {
    return Number.isInteger(v) ? String(v) : v.toFixed(6);
  }
  if (typeof v === "boolean") return v ? "1" : "0";
  return String(v);
}

function chiaveRiga(r: Riga): string {
  return r.map(norm).join("\u001f");
}

function multiinsieme(righe: Riga[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const r of righe) {
    const k = chiaveRiga(r);
    m.set(k, (m.get(k) ?? 0) + 1);
  }
  return m;
}

function stessoMultiinsieme(a: Riga[], b: Riga[]): boolean {
  if (a.length !== b.length) return false;
  const ma = multiinsieme(a);
  const mb = multiinsieme(b);
  if (ma.size !== mb.size) return false;
  for (const [k, n] of ma) if (mb.get(k) !== n) return false;
  return true;
}

export type Esecutore = (sql: string) => Promise<{ colonne: string[]; righe: Riga[] }>;

/**
 * Confronta la risposta dell'utente con la soluzione di riferimento.
 *
 * `ordineRilevante` è vero quando la consegna chiede esplicitamente un
 * ordinamento: in quel caso due risultati con le stesse righe in ordine diverso
 * NON sono equivalenti. Altrimenti si confronta il multiinsieme.
 */
export async function verifica(
  esegui: Esecutore,
  rispostaUtente: string,
  soluzioneRiferimento: string,
  opzioni: { ordineRilevante?: boolean; preparazione?: string } = {}
): Promise<Esito> {
  let atteso: { colonne: string[]; righe: Riga[] };
  let ottenuto: { colonne: string[]; righe: Riga[] };

  if (opzioni.preparazione) {
    await esegui(opzioni.preparazione);
  }

  try {
    atteso = await esegui(soluzioneRiferimento);
  } catch (e) {
    // La soluzione di riferimento non gira: è un difetto del contenuto, non dell'utente.
    return {
      corretto: false,
      motivo: "errore_sql",
      dettaglio: "La soluzione di riferimento non è eseguibile su questo dispositivo.",
      errore: String(e),
    };
  }

  try {
    ottenuto = await esegui(rispostaUtente);
  } catch (e) {
    return {
      corretto: false,
      motivo: "errore_sql",
      dettaglio: "La query non viene eseguita.",
      errore: String(e),
    };
  }

  if (atteso.colonne.length !== ottenuto.colonne.length) {
    return {
      corretto: false,
      motivo: "colonne_diverse",
      dettaglio: `Attese ${atteso.colonne.length} colonne, ottenute ${ottenuto.colonne.length}.`,
      righeAttese: atteso.righe.length,
      righeOttenute: ottenuto.righe.length,
    };
  }

  if (atteso.righe.length !== ottenuto.righe.length) {
    return {
      corretto: false,
      motivo: "righe_diverse",
      dettaglio: `Attese ${atteso.righe.length} righe, ottenute ${ottenuto.righe.length}.`,
      righeAttese: atteso.righe.length,
      righeOttenute: ottenuto.righe.length,
    };
  }

  const identico =
    atteso.righe.length === ottenuto.righe.length &&
    atteso.righe.every((r, i) => chiaveRiga(r) === chiaveRiga(ottenuto.righe[i]));

  if (identico) {
    return { corretto: true, motivo: "identico", dettaglio: "Risultato identico." };
  }

  if (!opzioni.ordineRilevante && stessoMultiinsieme(atteso.righe, ottenuto.righe)) {
    return {
      corretto: true,
      motivo: "identico_a_meno_dell_ordine",
      dettaglio: "Stesse righe, ordine diverso. La consegna non richiedeva un ordinamento.",
    };
  }

  if (stessoMultiinsieme(atteso.righe, ottenuto.righe)) {
    return {
      corretto: false,
      motivo: "righe_diverse",
      dettaglio: "Le righe sono corrette ma l'ordine richiesto non è rispettato.",
    };
  }

  // Trova la prima differenza utile da mostrare
  const ma = multiinsieme(atteso.righe);
  const mancanti: string[] = [];
  for (const [k, n] of ma) {
    const m = multiinsieme(ottenuto.righe).get(k) ?? 0;
    if (m < n) mancanti.push(k.split("\u001f").join(" | "));
    if (mancanti.length >= 2) break;
  }
  return {
    corretto: false,
    motivo: "valori_diversi",
    dettaglio: mancanti.length
      ? `Righe attese e non trovate, ad esempio: ${mancanti[0]}`
      : "I valori non corrispondono.",
    righeAttese: atteso.righe.length,
    righeOttenute: ottenuto.righe.length,
  };
}

/** La consegna richiede un ordinamento esplicito? Euristica prudente. */
export function ordineRilevante(consegna: string, soluzione: string): boolean {
  const chiedeOrdine = /ordin|dal più|dalla più|prime? \d|ultim|classific|posizione|decrescent|crescent/i.test(
    consegna
  );
  const haLimit = /\blimit\b/i.test(soluzione);
  return chiedeOrdine || haLimit;
}
