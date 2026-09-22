/**
 * Cliente Supabase scritto a mano, sopra `fetch`.
 *
 * Perché non la libreria ufficiale: `@supabase/supabase-js` tira dentro
 * `ws`, `node-fetch` e una manciata di polyfill che su React Native vanno
 * puntellati uno per uno. L'invariante 8 dice di non aggiungere dipendenze
 * fuori dal catalogo Expo, e qui non serve davvero niente: PostgREST e
 * Storage sono due API HTTP, e `fetch` c'è già.
 *
 * La chiave è una PUBLISHABLE key. Sta nel sorgente di proposito: è la scelta
 * dichiarata per questo strumento personale — chi ha l'APK ha questo accesso,
 * e nell'APK la chiave ci finirebbe comunque. Le righe restano recintate da
 * una policy RLS che le lega a un identificativo utente fisso, così una
 * policy scritta male non apre l'intero schema. Nessun dato di lavoro qui
 * dentro (invariante 7).
 */
import { File, Directory } from "expo-file-system";

export const NUVOLA_BASE = "https://hgvzjeituvvwtskbxzzl.supabase.co";
export const NUVOLA_CHIAVE = "sb_publishable_VO5g-rRFJUPHwjBQsuLyoQ_PNMi1D-P";
export const SCHEMA = "percorso";
export const DEPOSITO = "biblioteca";
export const UTENTE = "00000000-0000-4000-8000-000000000001";

const TENTATIVI = 4;
const ATTESE_MS = [2000, 4000, 8000, 16000];
const TIMEOUT_MS = 20_000;

export class ErroreNuvola extends Error {
  constructor(readonly stato: number, readonly corpo: string, messaggio: string) {
    super(messaggio);
    this.name = "ErroreNuvola";
  }
}

function attendi(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Un 4xx è un difetto nostro (colonna sbagliata, policy che rifiuta): riprovarlo
 * è solo tempo perso e nasconde il messaggio vero. Un 5xx, un 429 o una rete
 * caduta sono transitori: quelli si riprovano.
 */
function daRiprovare(stato: number): boolean {
  return stato === 0 || stato === 429 || stato >= 500;
}

export class Nuvola {
  constructor(
    private readonly base: string = NUVOLA_BASE,
    private readonly chiave: string = NUVOLA_CHIAVE,
    private readonly timeoutMs: number = TIMEOUT_MS
  ) {}

  private intestazioni(extra: Record<string, string> = {}): Record<string, string> {
    return {
      apikey: this.chiave,
      Authorization: `Bearer ${this.chiave}`,
      ...extra,
    };
  }

  /**
   * `fetch` in React Native non ha timeout: senza AbortController una
   * connessione appesa resta appesa finché l'utente non chiude l'app, e la
   * sincronizzazione automatica non riparte mai più perché si crede in corso.
   */
  private async chiama(
    url: string,
    opzioni: RequestInit,
    attesa = this.timeoutMs
  ): Promise<Response> {
    let ultimo: ErroreNuvola | null = null;
    for (let t = 0; t < TENTATIVI; t++) {
      const taglia = new AbortController();
      const timer = setTimeout(() => taglia.abort(), attesa);
      try {
        const r = await fetch(url, { ...opzioni, signal: taglia.signal });
        if (r.ok) return r;
        const corpo = await r.text().catch(() => "");
        ultimo = new ErroreNuvola(
          r.status,
          corpo,
          `Supabase ha risposto ${r.status} su ${url.replace(this.base, "")}: ${corpo.slice(0, 400)}`
        );
        if (!daRiprovare(r.status)) throw ultimo;
      } catch (e) {
        if (e instanceof ErroreNuvola) {
          if (!daRiprovare(e.stato)) throw e;
          ultimo = e;
        } else {
          // Rete assente, DNS, connessione tagliata, abort del timeout: tutti
          // transitori per definizione, e tutti indistinguibili da qui.
          ultimo = new ErroreNuvola(0, "", `Rete non raggiungibile: ${String(e)}`);
        }
      } finally {
        clearTimeout(timer);
      }
      if (t < TENTATIVI - 1) await attendi(ATTESE_MS[t]);
    }
    throw ultimo ?? new ErroreNuvola(0, "", "Richiesta fallita senza motivo noto.");
  }

  // ------------------------------------------------------------- PostgREST

  async seleziona<T>(tabella: string, query = ""): Promise<T[]> {
    const r = await this.chiama(
      `${this.base}/rest/v1/${tabella}${query ? "?" + query : ""}`,
      { method: "GET", headers: this.intestazioni({ "Accept-Profile": SCHEMA }) }
    );
    return (await r.json()) as T[];
  }

  /**
   * Upsert. I blocchi da 200 esistono perché un corpo troppo grande prende un
   * 413 e si perde TUTTO il gruppo, non l'eccedenza.
   */
  async innesta(
    tabella: string,
    righe: Array<Record<string, unknown>>,
    suConflitto: string
  ): Promise<number> {
    if (!righe.length) return 0;
    let scritte = 0;
    for (let i = 0; i < righe.length; i += 200) {
      const blocco = righe.slice(i, i + 200).map((r) => ({ utente_id: UTENTE, ...r }));
      await this.chiama(
        `${this.base}/rest/v1/${tabella}?on_conflict=${encodeURIComponent(suConflitto)}`,
        {
          method: "POST",
          headers: this.intestazioni({
            "Content-Profile": SCHEMA,
            "Content-Type": "application/json",
            Prefer: "return=minimal,resolution=merge-duplicates",
          }),
          body: JSON.stringify(blocco),
        }
      );
      scritte += blocco.length;
    }
    return scritte;
  }

  // ---------------------------------------------------------------- Storage

  /**
   * Scarica direttamente su disco. Passare per una stringa base64 in memoria
   * significa il triplo dei byte nell'heap JS: su un PDF da cinquanta mega è
   * la strada breve per farsi uccidere dal sistema a metà scaricamento.
   */
  async scaricaFile(percorso: string, destinazione: File | Directory): Promise<File> {
    const url = `${this.base}/storage/v1/object/${DEPOSITO}/${percorso}`;
    const sceso = await File.downloadFileAsync(url, destinazione, {
      headers: this.intestazioni(),
      idempotent: true,
    });
    // `downloadFileAsync` è dichiarata sulla classe base e restituisce il tipo
    // della base, non quello di `expo-file-system`. Si ricostruisce dall'uri
    // invece di forzare il tipo: un cast qui nasconderebbe il giorno in cui
    // la firma cambia davvero.
    return new File(sceso.uri);
  }

  /**
   * Carica per multipart con l'URI del file: è l'unica forma che su React
   * Native non fa passare i byte dal motore JavaScript.
   */
  async caricaFile(percorso: string, uriLocale: string, tipo = "application/pdf"): Promise<void> {
    const modulo = new FormData();
    modulo.append("file", {
      uri: uriLocale,
      name: percorso.split("/").pop() ?? "file.pdf",
      type: tipo,
    } as unknown as Blob);
    await this.chiama(
      `${this.base}/storage/v1/object/${DEPOSITO}/${percorso}`,
      {
        method: "POST",
        headers: this.intestazioni({ "x-upsert": "true" }),
        body: modulo,
      },
      120_000 // un PDF da caricare non sta nei venti secondi delle chiamate REST
    );
  }

  /** Una lettura minima: dice se la rete c'è E se la chiave è ancora buona. */
  async raggiungibile(): Promise<boolean> {
    try {
      const taglia = new AbortController();
      const timer = setTimeout(() => taglia.abort(), 8000);
      try {
        const r = await fetch(`${this.base}/rest/v1/articoli?select=id&limit=1`, {
          method: "GET",
          headers: this.intestazioni({ "Accept-Profile": SCHEMA }),
          signal: taglia.signal,
        });
        return r.ok;
      } finally {
        clearTimeout(timer);
      }
    } catch {
      return false;
    }
  }
}
