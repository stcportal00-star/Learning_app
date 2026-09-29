/**
 * Gli aggiornamenti dell'app, presi da GitHub e installati dall'app stessa.
 *
 * Prima di questo modulo un APK nuovo voleva dire aprire il browser, trovare
 * la release giusta fra quelle preliminari e sperare che il browser interno
 * dell'app da cui si era partiti sapesse scaricare. Qui la strada è una sola:
 * l'app chiede a GitHub qual è l'ultima build di `main`, la scarica e la
 * consegna all'installatore di Android.
 *
 * Quattro regole.
 *
 *  1. **Solo le build di `main`.** `apk.yml` pubblica una release per ogni
 *     ramo, ma marca preliminari (`prerelease`) tutte quelle che non vengono da
 *     `main`: un esperimento di una sessione non deve arrivare sul telefono da
 *     solo. Qui si scartano allo stesso modo, più le bozze e ogni release che
 *     non si chiami `apk-N` o non porti un `.apk` (`fonti`, `rassegna`,
 *     `firma` stanno nello stesso elenco).
 *
 *  2. **Si confronta il numero di corsa**, cioè il `N` di `apk-N` contro
 *     `extra.corsa` della build che gira. Non il versionCode, che nasce da un
 *     orologio e non si legge in modo affidabile (vedi `app.config.js`), e non
 *     la data. Il contatore è unico per il workflow, rami compresi: una build
 *     di ramo più recente dell'ultima di `main` ha un numero più alto, e
 *     giustamente non le si propone di tornare indietro — Android lo
 *     rifiuterebbe comunque. Una build compilata a mano non ha numero: le si
 *     mostra l'ultima release e si lascia decidere a chi la tiene in mano.
 *
 *  3. **Mai in attesa, e non troppo spesso.** Nessuna schermata aspetta la
 *     rete (CLAUDE.md): l'ultimo controllo si conserva nel kv-store e si mostra
 *     subito, anche in aereo; quello nuovo parte dietro, al massimo ogni
 *     `OGNI_MS`. GitHub concede sessanta richieste l'ora a chi non si
 *     autentica, e un'app che le spende a ogni apertura resterebbe senza
 *     proprio il giorno in cui c'è un aggiornamento vero.
 *
 *  4. **Installare lo decide Android.** L'app scarica e consegna il file con un
 *     intent VIEW, come fa con un PDF o un podcast (`lib/nuvola/media.ts`).
 *     Nessun modulo nativo in più (invariante 8): il permesso
 *     `REQUEST_INSTALL_PACKAGES` in `app.json` è una riga del manifesto, e la
 *     prima volta Android chiede di consentire le installazioni da Percorso.
 *     La firma la controlla il sistema: un APK firmato con un'altra chiave non
 *     si installa sopra questo, qualunque cosa dica GitHub.
 */
import { File, Directory, Paths } from "expo-file-system";
import * as IntentLauncher from "expo-intent-launcher";
import AsyncStorageLike from "expo-sqlite/kv-store";

export const ELENCO_RELEASE =
  "https://api.github.com/repos/stcportal00-star/Learning_app/releases?per_page=30";

/** Sei ore: quattro controlli al giorno bastano per una build che esce di rado. */
export const OGNI_MS = 6 * 3600 * 1000;

/** Oltre questo si rinuncia: una rete che non risponde in un quarto di minuto è rete da aereo. */
export const TEMPO_MAX_MS = 15_000;

const CHIAVE = "aggiornamento_ultimo_controllo";
const TIPO_APK = "application/vnd.android.package-archive";

export type Release = {
  corsa: number;
  tag: string;
  url: string;
  byte: number;
  pubblicata: string;
};

/** Ciò che resta di un controllo: quando è stato fatto e che cosa ha trovato. */
export type Controllo = { quando: number; ultima: Release | null };

export type Stato =
  /** C'è una build di `main` più recente di questa. */
  | { tipo: "disponibile"; ultima: Release; quando: number }
  /** Questa build è l'ultima, o più recente dell'ultima di `main`. */
  | { tipo: "aggiornata"; ultima: Release; quando: number }
  /** Build compilata a mano: nessun numero con cui confrontare. */
  | { tipo: "locale"; ultima: Release; quando: number }
  /** Non si sa: mai controllato con successo, e adesso la rete non c'è. */
  | { tipo: "ignoto"; motivo: string };

/** `27`, `"27"`, `"apk-27"` → 27. Qualunque altra cosa → null. */
export function numeroCorsa(v: unknown): number | null {
  if (typeof v === "number") return Number.isInteger(v) && v > 0 ? v : null;
  if (typeof v !== "string") return null;
  const m = /^(?:apk-)?(\d+)$/.exec(v.trim());
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isSafeInteger(n) && n > 0 ? n : null;
}

/**
 * Dall'elenco delle release di GitHub all'ultima build di `main`, o null.
 *
 * Si sceglie il numero di corsa più alto e non la prima dell'elenco: l'ordine
 * dell'API è per data di creazione, e una release rifatta a mano cambierebbe
 * posto senza cambiare numero.
 */
export function ultimaRelease(elenco: unknown): Release | null {
  if (!Array.isArray(elenco)) return null;
  let migliore: Release | null = null;
  for (const r of elenco) {
    if (!r || typeof r !== "object") continue;
    const rel = r as Record<string, unknown>;
    if (rel.draft === true || rel.prerelease !== false) continue;
    const tag = typeof rel.tag_name === "string" ? rel.tag_name : "";
    if (!/^apk-\d+$/.test(tag)) continue;
    const corsa = numeroCorsa(tag);
    if (corsa === null) continue;
    const asset = (Array.isArray(rel.assets) ? rel.assets : []).find((a: unknown) => {
      const x = a as Record<string, unknown> | null;
      return !!x && typeof x.name === "string" && x.name.endsWith(".apk")
        && typeof x.browser_download_url === "string"
        && x.browser_download_url.startsWith("https://");
    }) as Record<string, unknown> | undefined;
    if (!asset) continue;
    if (migliore && migliore.corsa >= corsa) continue;
    migliore = {
      corsa,
      tag,
      url: asset.browser_download_url as string,
      byte: typeof asset.size === "number" && asset.size > 0 ? asset.size : 0,
      pubblicata: typeof rel.published_at === "string" ? rel.published_at : "",
    };
  }
  return migliore;
}

/** Il confronto, e nient'altro: nessuna rete, nessuno stato. */
export function confronta(corsaAttuale: unknown, c: Controllo): Stato {
  if (!c.ultima) return { tipo: "ignoto", motivo: "nessuna build di main pubblicata" };
  const qui = numeroCorsa(corsaAttuale);
  if (qui === null) return { tipo: "locale", ultima: c.ultima, quando: c.quando };
  return {
    tipo: c.ultima.corsa > qui ? "disponibile" : "aggiornata",
    ultima: c.ultima,
    quando: c.quando,
  };
}

export async function ultimoControllo(): Promise<Controllo | null> {
  try {
    const v = await AsyncStorageLike.getItem(CHIAVE);
    if (!v) return null;
    const c = JSON.parse(v) as Controllo;
    return typeof c?.quando === "number" ? c : null;
  } catch {
    // Un valore illeggibile è come nessun controllo: al prossimo si riscrive.
    return null;
  }
}

/**
 * Lo stato da mostrare, SENZA rete: l'ultimo controllo riuscito, confrontato
 * con questa build. È ciò che una schermata legge prima di tutto il resto.
 */
export async function statoNoto(corsaAttuale: unknown): Promise<Stato> {
  const c = await ultimoControllo();
  if (!c) return { tipo: "ignoto", motivo: "non ancora controllato" };
  return confronta(corsaAttuale, c);
}

/**
 * Chiede a GitHub, se è il momento o se `forza`. Non solleva mai.
 *
 * Un controllo fallito NON sovrascrive quello buono: in aereo il telefono deve
 * continuare a sapere che c'è un aggiornamento da installare all'arrivo, e un
 * `ignoto` al posto di quel ricordo lo farebbe dimenticare. Non aggiorna
 * nemmeno l'ora, così il tentativo successivo non aspetta sei ore.
 */
export async function controlla(
  corsaAttuale: unknown,
  opzioni: { forza?: boolean; adesso?: number; tempoMaxMs?: number } = {}
): Promise<Stato> {
  const adesso = opzioni.adesso ?? Date.now();
  const precedente = await ultimoControllo();
  if (!opzioni.forza && precedente?.ultima && adesso - precedente.quando < OGNI_MS) {
    return confronta(corsaAttuale, precedente);
  }

  const interrompi = new AbortController();
  const timer = setTimeout(() => interrompi.abort(), opzioni.tempoMaxMs ?? TEMPO_MAX_MS);
  let motivo = "";
  try {
    const r = await fetch(ELENCO_RELEASE, {
      headers: { Accept: "application/vnd.github+json" },
      signal: interrompi.signal,
    });
    if (r.ok) {
      const ultima = ultimaRelease(await r.json());
      const c: Controllo = { quando: adesso, ultima };
      await AsyncStorageLike.setItem(CHIAVE, JSON.stringify(c));
      liberaScaricati(corsaAttuale);
      return confronta(corsaAttuale, c);
    }
    // 403 con il contatore a zero è il limite orario, non un divieto: si dice
    // così, perché «403» a chi legge suona come «non puoi», e passa da sé.
    motivo = r.status === 403 || r.status === 429
      ? "GitHub ha chiesto di aspettare (limite di richieste): si riprova più tardi"
      : `GitHub ha risposto ${r.status}`;
  } catch (e) {
    motivo = interrompi.signal.aborted
      ? "GitHub non ha risposto in tempo"
      : "rete non raggiungibile";
  } finally {
    clearTimeout(timer);
  }
  if (precedente?.ultima) return confronta(corsaAttuale, precedente);
  return { tipo: "ignoto", motivo };
}

export function cartellaAggiornamenti(): Directory {
  const d = new Directory(Paths.cache, "aggiornamenti");
  if (!d.exists) d.create({ intermediates: true });
  return d;
}

/**
 * Cancella gli APK già installati, o superati. Sessanta megabyte l'uno, e dopo
 * l'installazione non servono più: la prossima build è sempre un file nuovo.
 */
export function liberaScaricati(corsaAttuale: unknown): number {
  const qui = numeroCorsa(corsaAttuale);
  let liberati = 0;
  try {
    for (const voce of cartellaAggiornamenti().list()) {
      if (!(voce instanceof File)) continue;
      const m = /^percorso-(\d+)\.apk$/.exec(voce.name);
      // Senza numero di corsa non si sa che cosa è installato: meglio lasciare
      // un file di troppo che cancellare quello appena scaricato.
      if (m && qui !== null && Number(m[1]) <= qui) {
        voce.delete();
        liberati++;
      }
    }
  } catch {
    // La pulizia non deve mai impedire il controllo.
  }
  return liberati;
}

/**
 * Scarica l'APK della release. Restituisce l'uri del file, o il motivo.
 *
 * La lunghezza si controlla contro quella che GitHub dichiara: uno scarico
 * interrotto a metà produce un file che l'installatore rifiuta con «errore di
 * analisi del pacchetto», che non dice niente a chi è in aeroporto. Meglio
 * dirlo qui, e con parole sue.
 */
export async function scaricaRelease(r: Release): Promise<{ uri?: string; errore?: string }> {
  const destinazione = new File(cartellaAggiornamenti(), `percorso-${r.corsa}.apk`);
  if (destinazione.exists) destinazione.delete();
  let uri = "";
  let byte: number | null = null;
  try {
    const scaricato = await File.downloadFileAsync(r.url, destinazione);
    uri = scaricato.uri;
    byte = scaricato.size ?? null;
  } catch (e) {
    return { errore: "scaricamento non riuscito: " + String(e).slice(0, 160) };
  }
  if (r.byte > 0 && byte !== r.byte) {
    const f = new File(uri);
    if (f.exists) f.delete();
    return { errore: `file incompleto (${byte ?? 0} byte su ${r.byte}): riprova con una rete migliore` };
  }
  return { uri };
}

/**
 * Consegna l'APK all'installatore di Android. «aperto» vuol dire che Android
 * ha preso il file: da lì in poi decide lui, e la prima volta chiede di
 * consentire le installazioni da Percorso.
 */
export async function installa(uri: string): Promise<"aperto" | "mancante" | "errore"> {
  const f = new File(uri);
  if (!f.exists) return "mancante";
  try {
    await IntentLauncher.startActivityAsync("android.intent.action.VIEW", {
      data: f.contentUri,
      flags: 1, // FLAG_GRANT_READ_URI_PERMISSION: l'installatore deve poter leggere il file
      type: TIPO_APK,
    });
    return "aperto";
  } catch {
    return "errore";
  }
}

/** «58 MB»: quanto si sta per scaricare, detto a chi decide se farlo in roaming. */
export function megabyte(byte: number): string {
  if (!byte) return "dimensione sconosciuta";
  return `${Math.round(byte / 1_000_000)} MB`;
}
