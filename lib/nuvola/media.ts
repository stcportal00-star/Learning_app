/**
 * La cache dei media: un podcast, una conferenza, un video.
 *
 * Tre regole, e la terza è quella che giustifica il file.
 *
 *  1. **Si scarica solo quando l'utente lo chiede.** Nessun controllo della
 *     rete, nessuna euristica sul wifi: il bottone dice quanti megabyte sono —
 *     `byte_media` arriva dal feed apposta — e chi legge decide. Indovinare il
 *     tipo di connessione vorrebbe dire una dipendenza in più per sbagliare in
 *     roaming, che è esattamente il posto dove sbagliare costa.
 *
 *  2. **`file_media` non genera mai un evento.** È un percorso di QUESTO
 *     telefono, come `file_locale` della biblioteca: sincronizzarlo vorrebbe
 *     dire dire al tablet che ha un file che non ha. `visto_a` invece sì, è
 *     stato dell'utente come `letto`, e il tablet deve saperlo.
 *
 *  3. **Visto vuol dire cancellato.** Lo spazio di un telefono è finito, e una
 *     cache che non si svuota da sola smette di essere una cache: dopo due
 *     settimane di viaggio sarebbero venti gigabyte di roba già ascoltata, e
 *     il primo a non entrarci sarebbe il podcast di domani. La riga resta, con
 *     il suo `url_media`: se un giorno c'è rete e lo si rivuole, si riscarica.
 */
import { File, Directory, Paths } from "expo-file-system";
import * as IntentLauncher from "expo-intent-launcher";
import * as Sharing from "expo-sharing";
import { database, registra } from "../db";
import type { Articolo } from "./articoli";

export type StatoMedia =
  /** La voce non ha nessun allegato riproducibile. */
  | "nessuno"
  /** C'è l'indirizzo, il file no. */
  | "da_scaricare"
  /** Il file è qui e si apre senza rete. */
  | "in_cache"
  /** La riga dice che c'è, il disco dice di no: disinstallazione, pulizia, sistema. */
  | "mancante"
  /** Già visto: il file è stato cancellato apposta. */
  | "visto";

export function cartellaMedia(): Directory {
  const d = new Directory(Paths.document, "media");
  if (!d.exists) d.create({ intermediates: true });
  return d;
}

/**
 * Il nome del file sul disco. Si costruisce dall'`id` della voce e non dal
 * titolo: un titolo contiene barre, due punti ed emoji, e un nome di file con
 * una barra dentro è un file in una cartella che non esiste.
 */
function nomeFile(a: Articolo): string {
  const pulito = a.id.replace(/[^A-Za-z0-9._-]/g, "_").slice(0, 80);
  const coda = (a.tipo_media || "").startsWith("video/") ? ".mp4" : ".mp3";
  return pulito + coda;
}

export function statoMedia(a: Articolo): StatoMedia {
  if (!a.url_media) return "nessuno";
  if (a.file_media) {
    return new File(a.file_media).exists ? "in_cache" : "mancante";
  }
  return a.visto_a ? "visto" : "da_scaricare";
}

/**
 * Scarica l'allegato. Restituisce lo stato in cui si trova la voce dopo.
 *
 * Il percorso si scrive con un UPDATE e basta, senza `registra()`: vedi la
 * regola 2. Non è una scorciatoia — è l'unica scrittura del modulo che NON
 * deve viaggiare.
 */
export async function scaricaMedia(
  id: string
): Promise<{ stato: StatoMedia; byte?: number; errore?: string }> {
  const d = database();
  const a = await d.getFirstAsync<Articolo>("SELECT * FROM articoli WHERE id = ?", [id]);
  if (!a) return { stato: "nessuno", errore: "questa voce non c'è più" };
  if (!a.url_media) return { stato: "nessuno", errore: "questa voce non ha un allegato" };
  if (a.file_media && new File(a.file_media).exists) {
    return { stato: "in_cache", byte: new File(a.file_media).size ?? undefined };
  }

  const destinazione = new File(cartellaMedia(), nomeFile(a));
  if (destinazione.exists) destinazione.delete();
  // Si tengono due primitive e non l'oggetto: `File` qui dentro è quello di
  // expo-file-system, ma nel contesto dei tipi del progetto c'è anche il `File`
  // del DOM, e annotare una variabile con quel nome fa collidere i due.
  let uri = "";
  let byte: number | undefined;
  try {
    const scaricato = await File.downloadFileAsync(a.url_media, destinazione);
    uri = scaricato.uri;
    byte = scaricato.size ?? undefined;
  } catch (e) {
    // Un allegato che non si scarica non è un guasto dell'app: è un indirizzo
    // che il feed dichiarava e che oggi non risponde. La voce resta leggibile
    // — titolo, sommario, collegamento — e si riprova quando c'è rete.
    return { stato: "da_scaricare", errore: String(e).slice(0, 200) };
  }

  await d.runAsync("UPDATE articoli SET file_media = ? WHERE id = ?", [uri, id]);
  return { stato: "in_cache", byte };
}

/**
 * Apre l'allegato con il lettore del sistema, per la stessa strada di
 * `apriVolume()` in lib/palestra.ts, e per la stessa ragione: nessun modulo
 * nativo di terze parti.
 *
 * `expo-video` sta nel catalogo di Expo e si potrebbe adottare, ma a otto
 * giorni dalla scadenza un modulo nativo in più è un rischio che si paga tutto
 * in una volta — un crash nativo, senza PC e senza adb, non lascia niente da
 * leggere. Android un lettore audio e video ce l'ha già, funziona offline e
 * ricorda da solo il punto. Dentro l'app si decide che cosa è stato visto, che
 * è l'unica cosa che l'app deve sapere.
 */
export async function apriMedia(
  id: string
): Promise<"aperto" | "non_scaricato" | "nessun_lettore"> {
  const a = await database().getFirstAsync<Articolo>(
    "SELECT * FROM articoli WHERE id = ?", [id]);
  if (!a?.file_media) return "non_scaricato";
  const f = new File(a.file_media);
  if (!f.exists) return "non_scaricato";
  const tipo = a.tipo_media || "audio/mpeg";
  try {
    await IntentLauncher.startActivityAsync("android.intent.action.VIEW", {
      data: f.contentUri,
      flags: 1, // FLAG_GRANT_READ_URI_PERMISSION: il lettore esterno deve poter leggere il file
      type: tipo,
    });
    return "aperto";
  } catch {
    // Nessuna app registrata per quel tipo: si passa dal foglio di condivisione.
    if (await Sharing.isAvailableAsync()) {
      await Sharing.shareAsync(f.uri, { mimeType: tipo });
      return "aperto";
    }
    return "nessun_lettore";
  }
}

/** Cancella la copia locale e basta. Non tocca `visto_a`: non è la stessa cosa. */
export async function dimenticaMedia(id: string): Promise<boolean> {
  const d = database();
  const a = await d.getFirstAsync<Articolo>("SELECT * FROM articoli WHERE id = ?", [id]);
  if (!a?.file_media) return false;
  const f = new File(a.file_media);
  if (f.exists) f.delete();
  await d.runAsync("UPDATE articoli SET file_media = NULL WHERE id = ?", [id]);
  return true;
}

/**
 * «L'ho visto»: si registra l'evento E si libera lo spazio, in quest'ordine.
 *
 * L'ordine conta. `registra()` apre una transazione e applica la proiezione
 * dentro; cancellare il file prima vorrebbe dire che una registrazione fallita
 * lascia il file già sparito e la riga che dice di averlo. Così invece il caso
 * peggiore è un file rimasto su disco con `visto_a` scritto, e quello si
 * ripulisce da solo alla prossima passata.
 */
export async function segnaVisto(id: string, quando?: string): Promise<void> {
  const istante = quando ?? new Date().toISOString();
  await registra("articoli", id, "aggiorna", { visto_a: istante }, async (d, hlc) => {
    await d.runAsync("UPDATE articoli SET visto_a = ?, hlc = ? WHERE id = ?", [istante, hlc, id]);
  });
  await dimenticaMedia(id);
}

/**
 * La passata di pulizia: i file di ciò che è già stato visto.
 *
 * Serve perché `segnaVisto` può essere interrotta fra l'evento e la
 * cancellazione, e perché un `visto_a` può arrivare DALL'ALTRO dispositivo —
 * lì il file non c'era, qui sì, e nessuno lo cancellerebbe mai.
 */
export async function liberaVisti(): Promise<{ liberati: number; byte: number }> {
  const d = database();
  const righe = await d.getAllAsync<Articolo>(
    "SELECT * FROM articoli WHERE visto_a IS NOT NULL AND file_media IS NOT NULL"
  );
  let liberati = 0;
  let byte = 0;
  for (const a of righe) {
    const f = new File(a.file_media as string);
    if (f.exists) {
      byte += f.size ?? 0;
      f.delete();
      liberati++;
    }
    await d.runAsync("UPDATE articoli SET file_media = NULL WHERE id = ?", [a.id]);
  }
  return { liberati, byte };
}

/**
 * I byte come si dicono a chi deve decidere se scaricare in roaming.
 *
 * Sotto il mezzo megabyte si scrive in KB: «0,4 MB» e «0,0 MB» sono la stessa
 * cosa per chi legge, e un bottone che dice zero su un file che esiste sembra
 * rotto. Sopra, un decimale basta: la scelta è fra dodici e centoventi, non
 * fra 12,3 e 12,4.
 */
export function descriviByte(byte?: number | null): string {
  if (!byte || byte < 0) return "peso ignoto";
  if (byte < 512 * 1024) return `${Math.max(1, Math.round(byte / 1024))} KB`;
  return `${(byte / (1024 * 1024)).toFixed(1).replace(".", ",")} MB`;
}

/** Quanto occupa la cache adesso, per poterlo dire su una schermata. */
export async function spazioMedia(): Promise<{ file: number; byte: number }> {
  const righe = await database().getAllAsync<{ file_media: string }>(
    "SELECT file_media FROM articoli WHERE file_media IS NOT NULL"
  );
  let file = 0;
  let byte = 0;
  for (const r of righe) {
    const f = new File(r.file_media);
    if (f.exists) {
      file++;
      byte += f.size ?? 0;
    }
  }
  return { file, byte };
}
