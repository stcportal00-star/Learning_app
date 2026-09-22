/**
 * Lo scambio con Supabase: il quarto trasporto.
 *
 * Gli altri tre (prossimità, Wi-Fi locale, file) servono a tenere allineati
 * due dispositivi che stanno nella stessa stanza. Questo serve a due cose che
 * quelli non possono fare: ricevere ciò che la conduttura quotidiana ha
 * raccolto mentre il telefono era spento, e mettere al sicuro ciò che è stato
 * studiato senza dover avere l'altro dispositivo in mano.
 *
 * Non cambia l'architettura: viaggia lo stesso registro di eventi, con la
 * stessa deduplicazione per id. Supabase qui è un pari come gli altri, solo
 * che è sempre sveglio.
 *
 * Niente di tutto questo è necessario al funzionamento dell'app. Se la rete
 * non c'è, `sincronizzaNuvola` torna indietro con un motivo e nient'altro
 * accade: si continua a studiare offline, e gli eventi restano in coda.
 */
import { File, Directory, Paths } from "expo-file-system";
import {
  daSincronizzare,
  segnaSincronizzati,
  database,
  inTransazione,
  assorbiRemoto,
} from "../db";
import { fondi } from "../sync/fusione";
import type { EventoSerializzato } from "../sync/pacchetto";
import { Nuvola, ErroreNuvola } from "./cliente";
import { applica, EsitoProiezione } from "./proiezione";
import { caricaArretrati } from "./manuale";

/** Quanti eventi per viaggio. Oltre, il corpo della risposta diventa scomodo. */
const PAGINA = 500;
/** Quante pagine al massimo in una sola sincronizzazione. */
const PAGINE_MASSIME = 20;

export type EsitoNuvola = {
  riuscito: boolean;
  motivo: string;
  inviati: number;
  ricevuti: number;
  nuovi: number;
  proiezione: EsitoProiezione;
  scaricati: number;
};

type RigaEvento = {
  id: string;
  hlc: string;
  dispositivo_id: string;
  entita: string;
  entita_id: string;
  tipo: "crea" | "aggiorna" | "elimina";
  payload: Record<string, unknown>;
};

const VUOTO: EsitoProiezione = { scritte: 0, eliminate: 0, incomplete: [], sconosciute: 0 };

export type StatoNuvola = {
  /** ISO dell'ultimo scambio riuscito. null se non è mai riuscito. */
  ultimo: string | null;
  /** Cosa è successo l'ultima volta, riuscito o no. */
  motivo: string;
  /** Eventi locali non ancora saliti. */
  inSospeso: number;
};

/** Ciò che le schermate mostrano senza toccare la rete. */
export async function statoNuvola(): Promise<StatoNuvola> {
  const d = database();
  const [u, m, s] = await Promise.all([
    leggiMeta("nuvola_ultimo"),
    leggiMeta("nuvola_motivo"),
    d.getFirstAsync<{ n: number }>("SELECT count(*) AS n FROM eventi WHERE sincronizzato = 0"),
  ]);
  return { ultimo: u, motivo: m ?? "", inSospeso: s?.n ?? 0 };
}

async function scriviMeta(coppie: Array<[string, string]>): Promise<void> {
  await inTransazione(async (d) => {
    for (const [chiave, valore] of coppie) {
      await d.runAsync(
        `INSERT INTO meta (chiave, valore) VALUES (?, ?)
         ON CONFLICT (chiave) DO UPDATE SET valore = excluded.valore`,
        [chiave, valore]
      );
    }
  });
}

async function leggiMeta(chiave: string): Promise<string | null> {
  const r = await database().getFirstAsync<{ valore: string }>(
    "SELECT valore FROM meta WHERE chiave = ?",
    [chiave]
  );
  return r?.valore ?? null;
}

/**
 * Il segnaposto dice fin dove siamo già arrivati a leggere il registro remoto.
 * Senza, ogni sincronizzazione riscarica tutto dall'inizio: funziona, ma dopo
 * un mese di rassegne sono decine di migliaia di eventi per aprire l'app.
 *
 * Avanza ANCHE quando gli eventi letti sono tutti duplicati: sono già nostri,
 * e non rileggerli è proprio il punto.
 */
async function segnaposto(): Promise<string> {
  return (await leggiMeta("nuvola_hlc")) ?? "";
}

export async function sincronizzaNuvola(
  dispositivo: string,
  opzioni: { scaricaVolumi?: boolean; nuvola?: Nuvola } = {}
): Promise<EsitoNuvola> {
  const esito: EsitoNuvola = {
    riuscito: false,
    motivo: "",
    inviati: 0,
    ricevuti: 0,
    nuovi: 0,
    proiezione: { ...VUOTO },
    scaricati: 0,
  };
  const n = opzioni.nuvola ?? new Nuvola();

  if (!(await n.raggiungibile())) {
    esito.motivo = "Supabase non raggiungibile: si riprova al prossimo rientro in rete.";
    await scriviMeta([["nuvola_motivo", esito.motivo]]);
    return esito;
  }

  try {
    // ----------------------------------------------------------- si manda
    // Prima l'invio: se la rete cade a metà, ciò che è già partito è al
    // sicuro e il resto resta segnato come da inviare.
    for (let giro = 0; giro < PAGINE_MASSIME; giro++) {
      const daMandare = (await daSincronizzare(PAGINA)) as unknown as EventoSerializzato[];
      if (!daMandare.length) break;
      const righe: RigaEvento[] = daMandare.map((e) => ({
        id: e.id,
        hlc: e.hlc,
        dispositivo_id: e.dispositivo,
        entita: e.entita,
        entita_id: e.entita_id,
        tipo: e.tipo,
        // Il payload è testo in locale e jsonb nel remoto: mandarlo come
        // stringa lo farebbe arrivare come un jsonb di tipo stringa, e ogni
        // lettura successiva vedrebbe un campo solo al posto dei suoi campi.
        payload: analizza(e.payload),
      }));
      await n.innesta("eventi", righe as unknown as Array<Record<string, unknown>>, "id");
      await segnaSincronizzati(daMandare.map((e) => e.id));
      esito.inviati += daMandare.length;
      if (daMandare.length < PAGINA) break;
    }

    // ----------------------------------------------------------- si riceve
    let da = await segnaposto();
    for (let giro = 0; giro < PAGINE_MASSIME; giro++) {
      const query =
        `select=id,hlc,dispositivo_id,entita,entita_id,tipo,payload` +
        (da ? `&hlc=gt.${encodeURIComponent(da)}` : "") +
        `&order=hlc.asc&limit=${PAGINA}`;
      const remoti = await n.seleziona<RigaEvento>("eventi", query);
      if (!remoti.length) break;
      esito.ricevuti += remoti.length;

      const ricevuti: EventoSerializzato[] = remoti.map((r) => ({
        id: r.id,
        hlc: r.hlc,
        dispositivo: r.dispositivo_id,
        entita: r.entita,
        entita_id: r.entita_id,
        tipo: r.tipo,
        payload: JSON.stringify(r.payload ?? {}),
      }));

      // L'orologio prima di tutto (invariante 2): va assorbito anche quando
      // non arriva niente di nuovo, perché è l'ORA dell'altro a contare.
      // Sta fuori dalla transazione perché `assorbiRemoto` ne apre una sua.
      await assorbiRemoto(ricevuti.map((e) => e.hlc));

      // Si confronta solo con gli eventi locali delle entità che sono
      // arrivate: leggere l'intero registro a ogni pagina è la differenza
      // fra una sincronizzazione istantanea e una che dura mezzo minuto.
      const d = database();
      const entitaGiunte = [...new Set(ricevuti.map((e) => e.entita))];
      const locali = await d.getAllAsync<EventoSerializzato>(
        `SELECT id, hlc, dispositivo, entita, entita_id, tipo, payload
         FROM eventi WHERE entita IN (${entitaGiunte.map(() => "?").join(",")})`,
        entitaGiunte
      );
      const f = fondi(locali, ricevuti);
      esito.nuovi += f.nuovi.length;

      // Eventi e righe operative nella STESSA transazione: una
      // sincronizzazione interrotta non deve lasciare un registro che dice
      // una cosa e una tabella che ne dice un'altra.
      await inTransazione(async (dd) => {
        for (const e of f.nuovi) {
          await dd.runAsync(
            `INSERT OR IGNORE INTO eventi
             (id, hlc, dispositivo, entita, entita_id, tipo, payload, sincronizzato)
             VALUES (?,?,?,?,?,?,?,1)`,
            [e.id, e.hlc, e.dispositivo, e.entita, e.entita_id, e.tipo, e.payload]
          );
        }
        const p = await applica(dd, f.entitaToccate);
        esito.proiezione.scritte += p.scritte;
        esito.proiezione.eliminate += p.eliminate;
        esito.proiezione.sconosciute += p.sconosciute;
        esito.proiezione.incomplete.push(...p.incomplete);

        da = remoti[remoti.length - 1].hlc;
        await dd.runAsync(
          `INSERT INTO meta (chiave, valore) VALUES ('nuvola_hlc', ?)
           ON CONFLICT (chiave) DO UPDATE SET valore = excluded.valore`,
          [da]
        );
      });

      if (remoti.length < PAGINA) break;
    }

    esito.riuscito = true;
    esito.motivo = descrivi(esito);
  } catch (e) {
    esito.motivo =
      e instanceof ErroreNuvola
        ? e.message
        : `Scambio con Supabase interrotto: ${String(e)}`;
    await scriviMeta([["nuvola_motivo", esito.motivo]]);
    return esito;
  }

  // I file vengono DOPO, e fuori da ogni transazione: un PDF da venti mega
  // tenuto dentro una transazione SQLite bloccherebbe ogni altra scrittura
  // per tutto lo scaricamento.
  if (opzioni.scaricaVolumi !== false) {
    try {
      esito.scaricati = await scaricaVolumiMancanti(n);
    } catch (e) {
      esito.motivo += ` (i testi non si sono scaricati: ${String(e)})`;
    }
    try {
      // Nella stessa occasione partono i file aggiunti a mano mentre era
      // offline: è ciò che rende «Aggiungi PDF» in aereo una cosa che finisce
      // bene invece di un file che resta solo qui.
      const saliti = await caricaArretrati(n);
      if (saliti) esito.motivo += ` ${saliti} tuoi file messi al sicuro.`;
    } catch {
      // Già detto sopra: il volume è comunque leggibile su questo dispositivo.
    }
  }
  if (esito.scaricati) esito.motivo += ` ${esito.scaricati} testi scaricati.`;
  await scriviMeta([
    ["nuvola_ultimo", new Date().toISOString()],
    ["nuvola_motivo", esito.motivo],
  ]);
  return esito;
}

function analizza(testo: string): Record<string, unknown> {
  try {
    const v = JSON.parse(testo) as unknown;
    return v && typeof v === "object" && !Array.isArray(v)
      ? (v as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

function descrivi(e: EsitoNuvola): string {
  const pezzi: string[] = [];
  if (e.inviati) pezzi.push(`${e.inviati} inviati`);
  if (e.nuovi) pezzi.push(`${e.nuovi} nuovi`);
  if (e.proiezione.scritte) pezzi.push(`${e.proiezione.scritte} righe aggiornate`);
  if (e.proiezione.incomplete.length) {
    pezzi.push(`${e.proiezione.incomplete.length} righe incomplete saltate`);
  }
  return pezzi.length ? pezzi.join(", ") + "." : "Già allineato.";
}

// ------------------------------------------------------------------ volumi

export function cartellaVolumi(): Directory {
  const c = new Directory(Paths.document, "biblioteca");
  if (!c.exists) c.create({ intermediates: true });
  return c;
}

/**
 * Porta sul dispositivo i testi che il catalogo conosce ma che qui non ci sono.
 *
 * `file_locale` NON passa dal registro eventi: è un percorso di QUESTO
 * telefono e sull'altro dispositivo non esiste. Mandarlo in giro farebbe
 * credere all'altro di avere un file che non ha. Si scrive quindi con una
 * transazione semplice, ed è l'unica scrittura dell'app che di proposito non
 * genera un evento.
 */
export async function scaricaVolume(volumeId: string, nuvola?: Nuvola): Promise<boolean> {
  const d = database();
  const v = await d.getFirstAsync<{ id: string; pdf_path: string | null; formato: string | null }>(
    "SELECT id, pdf_path, formato FROM biblioteca WHERE id = ?",
    [volumeId]
  );
  if (!v?.pdf_path) return false;
  const n = nuvola ?? new Nuvola();
  const estensione = (v.formato || "pdf").replace(/[^a-z0-9]/gi, "") || "pdf";
  const destinazione = new File(cartellaVolumi(), `${v.id}.${estensione}`);
  const scaricato = await n.scaricaFile(v.pdf_path, destinazione);
  await inTransazione(async (dd) => {
    await dd.runAsync("UPDATE biblioteca SET file_locale = ?, byte = ? WHERE id = ?", [
      scaricato.uri,
      scaricato.size ?? null,
      v.id,
    ]);
  });
  return true;
}

export async function scaricaVolumiMancanti(n: Nuvola, massimo = 5): Promise<number> {
  const mancanti = await database().getAllAsync<{ id: string }>(
    `SELECT id FROM biblioteca
     WHERE pdf_path IS NOT NULL AND (file_locale IS NULL OR file_locale = '')
     ORDER BY aggiunto_a DESC LIMIT ?`,
    [massimo]
  );
  let fatti = 0;
  for (const v of mancanti) {
    try {
      if (await scaricaVolume(v.id, n)) fatti++;
    } catch {
      // Un volume che non si scarica non deve fermare gli altri: la riga resta
      // «non scaricato» e ci si riprova al prossimo giro.
    }
  }
  return fatti;
}
