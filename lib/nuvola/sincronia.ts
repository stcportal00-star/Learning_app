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
import { liberaVisti, scaricaMediaMancanti } from "./media";
import { liberaPdfLetti, volumiLetti } from "./letti";
import { cePosto, suWifi } from "./rete";

/** Quanti eventi per viaggio in invio. Oltre, il corpo diventa scomodo. */
const PAGINA = 500;
/** Quante pagine al massimo in una sola sincronizzazione. */
const PAGINE_MASSIME = 20;
/**
 * In lettura, cento: gli eventi degli articoli portano il testo, e sul
 * registro vero cento consecutivi pesano fino a 2 MB, cinquecento fino a
 * 8,2. In React Native `fetch` risolve a corpo scaricato, quindi la pagina
 * intera deve arrivare dentro TIMEOUT_MS (20 s): 8,2 MB chiedono 3,3 Mbit/s,
 * e sotto quella rete la prima pagina cadeva a ogni scambio, per sempre.
 */
const PAGINA_LETTURA = 100;
/** 3000 eventi a scambio: il registro intero (2354 oggi) si rilegge in uno. */
const PAGINE_LETTURA = 30;

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

/** Come la legge il telefono: con l'ora d'arrivo, che assegna Postgres (default now()) e nessuno manda. */
type RigaRicevuta = RigaEvento & { creato_a: string };

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
 * Il segnaposto dice da dove comincia la prossima lettura del registro remoto.
 * Senza, ogni sincronizzazione riscarica tutto dall'inizio: funziona, ma dopo
 * un mese di rassegne sono decine di migliaia di eventi per aprire l'app.
 *
 * È un'ora d'ARRIVO sul server (`creato_a`, che assegna Postgres), non un
 * HLC, e si salva già tolto il margine: la calcola prossimaSoglia(). Un
 * evento può arrivare con un HLC più vecchio di altri già letti: la
 * conduttura dà gli HLC mentre lavora, il più rilevante per primo, e carica
 * tutto alla fine, fino a venti minuti dopo; il tablet senza rete scrive per
 * giorni e carica al rientro. Con l'HLC come
 * segnaposto quegli eventi non si leggevano mai: se il telefono si
 * sincronizzava durante la corsa, gli articoli più rilevanti non arrivavano
 * più, e lo stesso le note scritte offline sull'altro dispositivo. L'ora
 * d'arrivo invece cresce con l'arrivo, qualunque sia l'orologio di chi scrive.
 *
 * La chiave è nuova (nuvola_creato) apposta: alla prima sincronizzazione dopo
 * l'aggiornamento si rilegge tutto il registro remoto, una volta, e si
 * recupera quello che il segnaposto per HLC aveva fatto perdere. I doppioni li
 * scarta fondi(), per id.
 *
 * Avanza ANCHE quando gli eventi letti sono tutti duplicati: sono già nostri,
 * e non rileggerli è proprio il punto.
 */
async function segnaposto(): Promise<string> {
  const v = (await leggiMeta("nuvola_creato")) ?? "";
  // Finisce in una query: un valore illeggibile la farebbe rifiutare a ogni
  // scambio, per sempre. Meglio rileggere tutto, una volta.
  return Number.isNaN(istanteDelServer(v)) ? "" : v;
}

/**
 * Quanto prima di dove si è arrivati riparte la lettura dopo. `now()` di
 * Postgres è l'ora d'INIZIO della transazione: un caricamento lento può
 * diventare visibile dopo uno più svelto che ha un'ora più recente, e se nel
 * frattempo il telefono ha letto quello svelto, il lento cadrebbe prima della
 * soglia. Gli eventi riletti nel margine si scartano per id; un caricamento si
 * rilegge al più negli scambi dei dieci minuti dopo il suo arrivo.
 */
export const MARGINE_MS = 10 * 60 * 1000;

// Come PostgREST scrive un timestamptz: «2026-10-01T03:14:44.548609+00:00»,
// ma Postgres toglie gli zeri in coda ai decimali, e senza decimali non mette
// nemmeno il punto. Si legge a mano invece che con Date.parse: sui formati
// fuori dallo standard di JavaScript (microsecondi, scarto «+00:00») ogni
// motore decide a modo suo, e Hermes non è quello su cui girano i test.
const ORA_DEL_SERVER =
  /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2}):(\d{2})(?:\.(\d+))?(?:(Z)|([+-])(\d{2})(?::?(\d{2}))?)$/;

/**
 * Un'ora del server in millisecondi UTC, NaN se illeggibile. I microsecondi si
 * troncano: una soglia che ne deriva legge appena prima, mai dopo.
 */
export function istanteDelServer(s: string): number {
  const m = ORA_DEL_SERVER.exec(s);
  if (!m) return NaN;
  const [, anno, mese, giorno, ore, minuti, secondi, decimali = "", z, segno, oreScarto, minutiScarto = "00"] = m;
  const utc = Date.UTC(+anno, +mese - 1, +giorno, +ore, +minuti, +secondi, +(decimali + "00").slice(0, 3));
  const scarto = z ? 0 : (segno === "-" ? -1 : 1) * (+oreScarto * 60 + +minutiScarto) * 60_000;
  return utc - scarto;
}

const MESI = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** L'intestazione Date di HTTP («Thu, 01 Oct 2026 03:14:44 GMT»), NaN se illeggibile. */
export function istanteHttp(s: string | null): number {
  const m = /^[A-Z][a-z]{2}, (\d{2}) ([A-Z][a-z]{2}) (\d{4}) (\d{2}):(\d{2}):(\d{2}) GMT$/.exec(s ?? "");
  if (!m || !MESI.includes(m[2])) return NaN;
  return Date.UTC(+m[3], MESI.indexOf(m[2]), +m[1], +m[4], +m[5], +m[6]);
}

/**
 * Da dove comincia la prossima lettura, in UTC e al millesimo; "" se non si
 * sa, e allora resta quella di prima.
 *
 * Arrivati in fondo, si parte dall'ora del server della PRIMA pagina meno il
 * margine. Un evento che quella lettura non ha visto è diventato visibile
 * dopo, e la sua transazione è cominciata al più un margine prima: sta dopo la
 * soglia. Con l'ultimo arrivo al posto dell'ora, a riposo ogni scambio
 * riscaricava l'ultimo lotto della conduttura, un megabyte e mezzo di testo,
 * finché qualcuno non scriveva qualcosa di nuovo. Senza ora del server
 * (`oraDelServer` NaN: vedi oraAffidabile) si parte dall'ultimo arrivo meno
 * il margine.
 *
 * A metà lettura (una pagina piena, o le pagine dello scambio finite) si
 * riparte dall'ultimo arrivo letto SENZA margine, se è più di un margine
 * prima dell'ora: un evento che non si è visto è diventato visibile dopo la
 * prima pagina, quindi è arrivato dopo, e il margine lì non serve. Con il
 * margine sempre, più eventi di quanti ne legge uno scambio arrivati in dieci
 * minuti (il tablet che torna in rete con la coda di settimane) facevano
 * ripartire ogni scambio dagli stessi e fermavano la lettura per sempre. Se
 * l'ultimo arrivo è più recente, si riparte dall'ora meno il margine: col
 * passare del tempo la finestra si svuota, e la lettura riprende.
 */
/**
 * L'ora della prima pagina, o NaN se non ci si può fidare: manca, o è prima
 * dell'ultimo arrivo che quella stessa pagina ha letto (più il secondo che
 * l'intestazione Date tronca), cioè i due orologi non sono d'accordo.
 *
 * Si decide sulla PRIMA pagina e basta. Confrontata con l'ultimo arrivo di
 * una pagina dopo, scartava l'ora proprio quando la lettura è lunga e nel
 * frattempo arriva qualcosa: è normale, non un disaccordo. E la soglia
 * ripiegava sull'ultimo arrivo meno il margine, che può stare dopo un evento
 * entrato dietro la prima pagina con una transazione lenta: quell'evento non
 * si leggeva più.
 *
 * Un orologio HTTP AVANTI rispetto a Postgres non si vede da qui: si conta
 * che i due stiano entro pochi secondi, come due server sincronizzati.
 */
export function oraAffidabile(oraHttp: string | null, ultimoArrivoPrimaPagina: number): number {
  const ora = istanteHttp(oraHttp);
  return ultimoArrivoPrimaPagina > ora + 1000 ? NaN : ora;
}

export function prossimaSoglia(fine: boolean, ultimoArrivo: number, oraDelServer: number): string {
  const daOra = oraDelServer - MARGINE_MS;
  const ms = Number.isNaN(daOra)
    ? ultimoArrivo - MARGINE_MS
    : fine
      ? daOra
      : Math.min(ultimoArrivo, daOra);
  return Number.isNaN(ms) ? "" : new Date(ms).toISOString();
}

type OpzioniNuvola = { scaricaVolumi?: boolean; nuvola?: Nuvola };

/** Il giro in corso, se ce n'è uno. */
let inVolo: Promise<EsitoNuvola> | null = null;

/**
 * Un giro per volta: chi chiede mentre uno è in corso riceve quello.
 *
 * Col wifi un giro scarica tutto, e può durare minuti. Nel frattempo il
 * bottone «Ora» di Oggi, il ritorno in primo piano e l'arrivo del wifi
 * chiamano di nuovo: due giri insieme scaricherebbero gli stessi file nello
 * stesso posto e caricherebbero due volte gli stessi PDF aggiunti a mano.
 *
 * Non prende il dispositivo, e non è una dimenticanza: l'identità del mittente
 * viaggia dentro ogni evento, nel campo `dispositivo` che `registra()` ci ha
 * scritto quando l'evento è nato. Un parametro qui prometterebbe che il
 * chiamante possa cambiarla, e non può.
 */
export function sincronizzaNuvola(opzioni: OpzioniNuvola = {}): Promise<EsitoNuvola> {
  if (!inVolo) {
    inVolo = unGiro(opzioni).finally(() => {
      inVolo = null;
    });
  }
  return inVolo;
}

async function unGiro(opzioni: OpzioniNuvola): Promise<EsitoNuvola> {
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
      await n.innesta("eventi", righe as unknown as Array<Record<string, unknown>>, "id", "ignora");
      await segnaSincronizzati(daMandare.map((e) => e.id));
      esito.inviati += daMandare.length;
      if (daMandare.length < PAGINA) break;
    }

    // ----------------------------------------------------------- si riceve
    // Per ora d'arrivo, e a parità per id (un caricamento è una transazione,
    // e le sue righe hanno la stessa ora). Le pagine si contano dall'inizio
    // della lettura: una riga che arriva durante lo scambio ha un'ora più
    // recente e finisce in fondo; una arrivata in ritardo con un'ora vecchia
    // fa rileggere una riga già letta, che fondi() scarta, e lei si legge
    // allo scambio dopo, dentro il margine.
    const soglia = await segnaposto();
    let oraDelServer = NaN;
    let ultimoArrivo = NaN;
    for (let giro = 0; giro < PAGINE_LETTURA; giro++) {
      const query =
        `select=id,hlc,dispositivo_id,entita,entita_id,tipo,payload,creato_a` +
        (soglia ? `&creato_a=gte.${encodeURIComponent(soglia)}` : "") +
        `&order=creato_a.asc,id.asc&limit=${PAGINA_LETTURA}&offset=${giro * PAGINA_LETTURA}`;
      const { righe: remoti, ora } = await n.selezionaConOra<RigaRicevuta>("eventi", query);
      const fine = remoti.length < PAGINA_LETTURA;
      if (remoti.length) ultimoArrivo = istanteDelServer(remoti[remoti.length - 1].creato_a);
      if (giro === 0) oraDelServer = oraAffidabile(ora, ultimoArrivo);
      const prossima = prossimaSoglia(fine, ultimoArrivo, oraDelServer);
      if (!remoti.length) {
        // Niente di nuovo, ma il tempo è passato: la soglia avanza lo stesso.
        if (prossima) await scriviMeta([["nuvola_creato", prossima]]);
        break;
      }
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

        if (prossima) {
          await dd.runAsync(
            `INSERT INTO meta (chiave, valore) VALUES ('nuvola_creato', ?)
             ON CONFLICT (chiave) DO UPDATE SET valore = excluded.valore`,
            [prossima]
          );
        }
      });

      if (fine) break;
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

  // Gli allegati di ciò che risulta già visto se ne vanno qui, e questo è il
  // solo momento in cui ha senso: `visto_a` può essere arrivato ADESSO
  // dall'altro dispositivo, dove il file non c'era. Senza questa passata la
  // copia rimasta qui non la cancellerebbe nessuno, e la cache dei media
  // smetterebbe di svuotarsi da sola proprio nel viaggio per cui esiste.
  //
  // Fuori da ogni transazione e senza rete: cancellare file non è uno scambio.
  try {
    const liberati = await liberaVisti();
    if (liberati.liberati) {
      esito.motivo += ` ${liberati.liberati} allegati già visti tolti dal telefono.`;
    }
  } catch {
    // Un file che non si lascia cancellare non deve far fallire una
    // sincronizzazione riuscita: si riprova alla prossima.
  }
  // Lo stesso per i PDF degli articoli letti, anche sull'altro dispositivo:
  // il «letto» può essere appena arrivato da lì.
  try {
    const tolti = await liberaPdfLetti();
    if (tolti) esito.motivo += ` ${tolti} PDF già letti tolti dal telefono (resta il testo).`;
  } catch {
    // Come sopra: si riprova alla prossima.
  }

  // I file vengono DOPO, e fuori da ogni transazione: un PDF da venti mega
  // tenuto dentro una transazione SQLite bloccherebbe ogni altra scrittura
  // per tutto lo scaricamento.
  //
  // Solo sul wifi, e allora TUTTO: i PDF che mancano, i manuali, i podcast non
  // ancora visti. Sui dati mobili niente: in viaggio si pagano a megabyte, e
  // un mese di rassegna sono centinaia di megabyte (lib/nuvola/rete.ts).
  if (opzioni.scaricaVolumi !== false && (await suWifi())) {
    try {
      esito.scaricati = await scaricaVolumiMancanti(n, Infinity);
    } catch (e) {
      esito.motivo += ` (i testi non si sono scaricati: ${String(e)})`;
    }
    try {
      const podcast = await scaricaMediaMancanti();
      if (podcast) esito.motivo += ` ${podcast} podcast scaricati.`;
    } catch {
      // Un podcast che non scende resta «da scaricare», e ci si riprova.
    }
    if (!cePosto(0)) {
      esito.motivo += " Spazio quasi finito: il resto si scarica quando se ne libera (si tiene 1 GB per l'app).";
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
  // Il limite si applica qui e non in SQL: col wifi è Infinity, che SQLite
  // non accetta come LIMIT. I PDF di articoli già letti non si riscaricano: il
  // testo è già qui, ed è proprio per lasciarlo al posto del file che sono
  // stati tolti (letti.ts).
  const letti = await volumiLetti();
  const mancanti = (
    await database().getAllAsync<{ id: string; byte: number | null }>(
      `SELECT id, byte FROM biblioteca
       WHERE pdf_path IS NOT NULL AND (file_locale IS NULL OR file_locale = '')
       ORDER BY aggiunto_a DESC`
    )
  )
    .filter((v) => !letti.has(v.id))
    .slice(0, massimo);
  let fatti = 0;
  for (const v of mancanti) {
    // La riserva di spazio (rete.ts): un manuale da venti mega che non entra
    // non ferma i PDF piccoli dopo di lui.
    if (!cePosto(v.byte)) continue;
    try {
      if (await scaricaVolume(v.id, n)) fatti++;
    } catch {
      // Un volume che non si scarica non deve fermare gli altri: la riga resta
      // «non scaricato» e ci si riprova al prossimo giro.
    }
  }
  return fatti;
}
