/**
 * Applica al database operativo gli eventi arrivati da fuori.
 *
 * Il pezzo che mancava. `useAutoSync` inseriva gli eventi ricevuti nella
 * tabella `eventi` e si fermava lì: il registro cresceva, ma nessuna riga
 * operativa cambiava, quindi sullo schermo non compariva niente. Una nota
 * scritta sul tablet arrivava sul telefono e restava invisibile. Con la
 * conduttura quotidiana il difetto diventa totale: la rassegna deposita cento
 * articoli e l'app non ne mostra uno.
 *
 * Regole che questo file rispetta, e che vanno rispettate da chiunque lo tocchi:
 *
 *  1. Si scrive SOLO con la connessione ricevuta. Mai `registra()`, mai
 *     `inTransazione()` qui dentro: una scrittura annidata nella proiezione di
 *     un'altra si mette in coda dietro quella che la contiene, e nessuna delle
 *     due finisce più (vedi il commento lungo in lib/db.ts).
 *  2. Gli eventi ricevuti NON generano eventi nuovi. Sono già nel registro:
 *     riscriverli farebbe rimbalzare all'infinito la stessa modifica fra i
 *     due dispositivi.
 *  3. Le colonne si filtrano contro lo schema VERO della tabella. Un evento
 *     scritto da una versione più nuova dell'app porta campi che qui non
 *     esistono: ignorarli è l'unico modo perché una versione vecchia continui
 *     a funzionare invece di rompersi a ogni sincronizzazione.
 */
import type * as SQLite from "expo-sqlite";
import { proietta } from "../sync/fusione";
import type { EventoSerializzato } from "../sync/pacchetto";

type Descrittore = { tabella: string; chiave: string };

/**
 * Le sole entità che si sanno proiettare. Un'entità sconosciuta viene contata
 * e saltata: è un evento di una versione futura, non un guasto.
 */
const ENTITA: Record<string, Descrittore> = {
  note: { tabella: "note", chiave: "id" },
  biblioteca: { tabella: "biblioteca", chiave: "id" },
  articoli: { tabella: "articoli", chiave: "id" },
  segni: { tabella: "segni", chiave: "id" },
  tentativi: { tabella: "tentativi", chiave: "id" },
  ripasso: { tabella: "ripasso", chiave: "esercizio_id" },
  sessioni: { tabella: "sessioni", chiave: "id" },
  temi: { tabella: "temi", chiave: "id" },
  esercizi: { tabella: "esercizi", chiave: "id" },
  artefatti: { tabella: "artefatti", chiave: "id" },
  credenziali: { tabella: "credenziali", chiave: "id" },
  pubblicazioni: { tabella: "pubblicazioni", chiave: "id" },
};

export type EsitoProiezione = {
  scritte: number;
  eliminate: number;
  /** Entità di cui esiste l'evento ma non si è potuta creare la riga. */
  incomplete: Array<{ entita: string; entita_id: string; mancano: string[] }>;
  /** Entità che questa versione dell'app non conosce. */
  sconosciute: number;
};

type Colonna = { name: string; notnull: number; dflt_value: string | null; pk: number };

const colonneNote = new Map<string, Colonna[]>();

async function colonne(d: SQLite.SQLiteDatabase, tabella: string): Promise<Colonna[]> {
  const gia = colonneNote.get(tabella);
  if (gia) return gia;
  // `tabella` non viene mai da fuori: è un valore di ENTITA, scritto qui sopra.
  const righe = await d.getAllAsync<Colonna>(`PRAGMA table_info(${tabella})`);
  colonneNote.set(tabella, righe);
  return righe;
}

/** Solo per i test: lo schema cambia fra un database di prova e l'altro. */
export function dimenticaSchema(): void {
  colonneNote.clear();
}

/**
 * SQLite non ha booleani e non ha oggetti. Senza questa conversione un
 * `true` arrivato da JSON finisce in colonna come la stringa "true", e ogni
 * `WHERE letto = 1` successivo lo salta in silenzio.
 */
function valore(v: unknown): string | number | null {
  if (v === null || v === undefined) return null;
  if (typeof v === "boolean") return v ? 1 : 0;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "string") return v;
  return JSON.stringify(v);
}

/**
 * Proietta le entità indicate leggendo il registro locale.
 *
 * Va chiamata DENTRO una `inTransazione()`, con la connessione che questa
 * fornisce: gli eventi ricevuti e le righe che ne derivano devono comparire
 * insieme o per niente.
 */
export async function applica(
  d: SQLite.SQLiteDatabase,
  toccate: Array<{ entita: string; entita_id: string }>
): Promise<EsitoProiezione> {
  const esito: EsitoProiezione = { scritte: 0, eliminate: 0, incomplete: [], sconosciute: 0 };

  for (const t of toccate) {
    const desc = ENTITA[t.entita];
    if (!desc) {
      esito.sconosciute++;
      continue;
    }

    const eventi = (await d.getAllAsync<EventoSerializzato>(
      `SELECT id, hlc, dispositivo, entita, entita_id, tipo, payload
       FROM eventi WHERE entita = ? AND entita_id = ? ORDER BY hlc`,
      [t.entita, t.entita_id]
    )) as unknown as EventoSerializzato[];
    if (!eventi.length) continue;

    const stato = proietta(eventi, t.entita, t.entita_id);

    if (stato === null) {
      await d.runAsync(
        `DELETE FROM ${desc.tabella} WHERE ${desc.chiave} = ?`,
        [t.entita_id]
      );
      esito.eliminate++;
      continue;
    }

    const schema = await colonne(d, desc.tabella);
    const nomi = new Set(schema.map((c) => c.name));
    const campi = Object.keys(stato).filter((k) => nomi.has(k) && k !== desc.chiave);

    // L'HLC della riga è quello dell'ultimo evento che l'ha toccata: è ciò che
    // permette a un confronto «vince il più recente» di funzionare anche
    // guardando solo la tabella operativa.
    const ultimoHlc = eventi[eventi.length - 1].hlc;
    if (nomi.has("hlc") && !campi.includes("hlc")) campi.push("hlc");
    const leggi = (c: string) => (c === "hlc" ? ultimoHlc : valore(stato[c]));

    const esistente = await d.getFirstAsync<{ presente: number }>(
      `SELECT 1 AS presente FROM ${desc.tabella} WHERE ${desc.chiave} = ?`,
      [t.entita_id]
    );

    if (esistente) {
      if (!campi.length) continue;
      await d.runAsync(
        `UPDATE ${desc.tabella} SET ${campi.map((c) => `${c} = ?`).join(", ")} WHERE ${desc.chiave} = ?`,
        [...campi.map(leggi), t.entita_id]
      );
      esito.scritte++;
      continue;
    }

    // La riga non c'è: per crearla servono tutte le colonne obbligatorie.
    // Diversi punti di scrittura dell'app mandano payload PARZIALI (un
    // tentativo manda esercizio_id ed esito, non la risposta né la durata):
    // da quelli non si può ricostruire una riga nuova, e inventare valori
    // sarebbe peggio che non averla. Si conta e si va avanti, invece di far
    // fallire l'intera sincronizzazione per una riga sola.
    const mancano = schema
      .filter((c) => c.notnull === 1 && c.dflt_value === null && c.pk === 0)
      .map((c) => c.name)
      .filter((n) => !campi.includes(n) || leggi(n) === null);
    if (mancano.length) {
      esito.incomplete.push({ entita: t.entita, entita_id: t.entita_id, mancano });
      continue;
    }

    const tutte = [desc.chiave, ...campi];
    await d.runAsync(
      `INSERT INTO ${desc.tabella} (${tutte.join(", ")}) VALUES (${tutte.map(() => "?").join(",")})`,
      [t.entita_id, ...campi.map(leggi)]
    );
    esito.scritte++;
  }

  return esito;
}
