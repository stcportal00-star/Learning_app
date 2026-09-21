/**
 * palestra.ts — il database di allenamento incluso nell'app, in sola lettura.
 * biblioteca.ts (in fondo) — gestione dei PDF, aperti e importati a mano.
 *
 * Entrambi funzionano senza rete: è il vincolo di progetto.
 */
import * as SQLite from "expo-sqlite";
import { File, Directory, Paths } from "expo-file-system";
import { Asset } from "expo-asset";
import * as DocumentPicker from "expo-document-picker";
import * as Crypto from "expo-crypto";
import * as IntentLauncher from "expo-intent-launcher";
import * as Sharing from "expo-sharing";
import { database, registra } from "./db";
import { Riga } from "./verifica";

// ------------------------------------------------------------- PALESTRA
let palestra: SQLite.SQLiteDatabase | null = null;
let versioneSqlite: string | null = null;

/**
 * Copia palestra.db dagli asset nella cartella dell'app, una sola volta,
 * e la apre in sola lettura. Gli esercizi che creano indici lavorano su una
 * copia temporanea, così l'originale resta intatto.
 *
 * La sola lettura è `PRAGMA query_only`, non un'opzione di apertura:
 * `SQLiteOpenOptions` dell'SDK 54 non ne espone nessuna. E non è un filtro sul
 * testo della query, che violerebbe l'invariante 3 — è SQLite stesso a
 * respingere ogni scrittura, con "attempt to write a readonly database".
 * È una proprietà della connessione e non del file: va richiesta a ogni
 * apertura, e questa funzione apre una volta sola per avvio.
 */
export async function apriPalestra(): Promise<SQLite.SQLiteDatabase> {
  if (palestra) return palestra;

  const dir = new Directory(Paths.document, "SQLite");
  if (!dir.exists) dir.create({ intermediates: true });
  const dest = new File(dir, "palestra.db");
  if (!dest.exists) {
    const asset = Asset.fromModule(require("../assets/contenuti/palestra.db"));
    await asset.downloadAsync();
    new File(asset.localUri!).copy(dest);
  }

  palestra = await SQLite.openDatabaseAsync("palestra.db");
  // Prima di qualunque altra cosa: da qui in poi la connessione non scrive più.
  await palestra.execAsync("PRAGMA query_only = ON");
  const v = await palestra.getFirstAsync<{ v: string }>("SELECT sqlite_version() AS v");
  versioneSqlite = v?.v ?? null;
  return palestra;
}

/** Window functions richiedono SQLite 3.25. Va verificato sul dispositivo reale. */
export function supportaWindowFunctions(): boolean {
  if (!versioneSqlite) return false;
  const [a, b] = versioneSqlite.split(".").map(Number);
  return a > 3 || (a === 3 && b >= 25);
}

export function versioneMotore(): string {
  return versioneSqlite ?? "sconosciuta";
}

/**
 * Esecutore da passare a verifica(). Non modifica mai il database originale.
 *
 * Una risposta di scrittura — UPDATE, DELETE, DROP battuti nel campo per
 * distrazione o per curiosità — viene respinta da SQLite e risale a verifica(),
 * che la restituisce come `errore_sql` con il messaggio del motore. L'utente
 * legge perché, e la palestra resta intatta.
 */
export async function esegui(sql: string): Promise<{ colonne: string[]; righe: Riga[] }> {
  const d = await apriPalestra();
  const righe = await d.getAllAsync<Record<string, unknown>>(sql);
  const colonne = righe.length ? Object.keys(righe[0]) : [];
  return { colonne, righe: righe.map((r) => colonne.map((c) => r[c])) };
}

/**
 * Esercizi con `preparazione` (CREATE INDEX, CREATE TABLE): si lavora su una
 * copia usa-e-getta, che viene eliminata subito dopo.
 */
export async function eseguiConPreparazione(
  preparazione: string,
  sql: string
): Promise<{ colonne: string[]; righe: Riga[] }> {
  const cartella = new Directory(Paths.document, "SQLite");
  const temporanea = `palestra_tmp_${Date.now()}.db`;
  const copia = new File(cartella, temporanea);
  new File(cartella, "palestra.db").copy(copia);
  const d = await SQLite.openDatabaseAsync(temporanea);
  try {
    await d.execAsync(preparazione);
    // La preparazione ha finito di scrivere: da qui la copia è in sola lettura
    // come l'originale. Senza, la risposta dell'utente potrebbe alterare gli
    // indici appena creati e falsare il confronto con la soluzione.
    await d.execAsync("PRAGMA query_only = ON");
    const righe = await d.getAllAsync<Record<string, unknown>>(sql);
    const colonne = righe.length ? Object.keys(righe[0]) : [];
    return { colonne, righe: righe.map((r) => colonne.map((c) => r[c])) };
  } finally {
    await d.closeAsync();
    if (copia.exists) copia.delete();
  }
}

// ----------------------------------------------------------- BIBLIOTECA
export type Volume = {
  id: string;
  titolo: string;
  autore: string | null;
  tema_slug: string | null;
  trimestre: string | null;
  origine: "aperta" | "manuale";
  licenza: string | null;
  url: string | null;
  file_locale: string | null;
  formato: string;
  byte: number | null;
  ultima_pagina: number;
};

function cartellaPdf(): Directory {
  const d = new Directory(Paths.document, "biblioteca");
  if (!d.exists) d.create({ intermediates: true });
  return d;
}

/**
 * Importazione manuale di un PDF scelto dall'utente.
 * Il file viene copiato nello spazio privato dell'app, così resta leggibile
 * offline anche se l'originale viene spostato o cancellato.
 * Non scarica nulla da internet: apre il selettore di sistema.
 */
export async function importaPdf(opzioni?: {
  tema_slug?: string;
  trimestre?: string;
  titolo?: string;
  autore?: string;
}): Promise<Volume | null> {
  const scelta = await DocumentPicker.getDocumentAsync({
    type: ["application/pdf", "application/epub+zip"],
    copyToCacheDirectory: true,
    multiple: false,
  });
  if (scelta.canceled || !scelta.assets?.length) return null;

  const scelto = scelta.assets[0];
  const cartella = cartellaPdf();

  const id = Crypto.randomUUID();
  const estensione = scelto.name.toLowerCase().endsWith(".epub") ? "epub" : "pdf";
  const destinazione = new File(cartella, `${id}.${estensione}`);
  new File(scelto.uri).copy(destinazione);

  const titolo = opzioni?.titolo ?? scelto.name.replace(/\.(pdf|epub)$/i, "");

  const volume: Volume = {
    id,
    titolo,
    autore: opzioni?.autore ?? null,
    tema_slug: opzioni?.tema_slug ?? null,
    trimestre: opzioni?.trimestre ?? null,
    origine: "manuale",
    licenza: null,
    url: null,
    file_locale: destinazione.uri,
    formato: estensione,
    byte: destinazione.size ?? null,
    ultima_pagina: 0,
  };

  await registra("biblioteca", id, "crea", volume as unknown as Record<string, unknown>,
    async (d, hlc) => {
      await d.runAsync(
        `INSERT INTO biblioteca
         (id, titolo, autore, tema_slug, trimestre, origine, licenza, url, file_locale,
          formato, byte, ultima_pagina, aggiunto_a, hlc)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,0,?,?)`,
        [id, volume.titolo, volume.autore, volume.tema_slug, volume.trimestre, "manuale",
         null, null, destinazione.uri, estensione, volume.byte, new Date().toISOString(), hlc]
      );
    });

  return volume;
}

/**
 * Importa la biblioteca aperta scaricata dalla release di GitHub.
 *
 * Flusso sul telefono: si scarica biblioteca.zip, lo si estrae con l'app File,
 * poi qui si selezionano INSIEME manifesto.json e i PDF. Ogni PDF viene COPIATO
 * nella cartella privata dell'app: su Android non è possibile mettere file lì a
 * mano, quindi senza la copia il volume resterebbe collegato a un percorso vuoto.
 *
 * Le voci del manifesto si collegano per codice alle righe già presenti in
 * libreria (caricate al primo avvio con file_locale vuoto).
 */
export async function importaBiblioteca(): Promise<{ collegati: number; senzaFile: number; errore?: string }> {
  const scelta = await DocumentPicker.getDocumentAsync({
    type: ["application/json", "application/pdf"],
    copyToCacheDirectory: true,
    multiple: true,
  });
  if (scelta.canceled || !scelta.assets?.length) return { collegati: 0, senzaFile: 0 };

  const manifesto = scelta.assets.find((a) => a.name.toLowerCase().endsWith(".json"));
  if (!manifesto) {
    return { collegati: 0, senzaFile: 0, errore: "Seleziona anche manifesto.json insieme ai PDF." };
  }
  const voci = JSON.parse(await new File(manifesto.uri).text()) as Array<{
    codice: string; titolo: string; file?: string; byte?: number; sha256?: string;
  }>;

  const cartella = cartellaPdf();
  const copiati = new Map<string, string>(); // nome file -> uri locale
  for (const a of scelta.assets) {
    if (!a.name.toLowerCase().endsWith(".pdf")) continue;
    const destinazione = new File(cartella, a.name);
    if (destinazione.exists) destinazione.delete();
    new File(a.uri).copy(destinazione);
    copiati.set(a.name, destinazione.uri);
  }

  let collegati = 0;
  let senzaFile = 0;
  for (const v of voci) {
    const uri = v.file ? copiati.get(v.file) : undefined;
    if (!uri) { senzaFile++; continue; }
    await registra("biblioteca", v.codice, "aggiorna",
      { file_locale: uri, byte: v.byte ?? null, sha256: v.sha256 ?? null },
      async (d, hlc) => {
        await d.runAsync(
          "UPDATE biblioteca SET file_locale = ?, byte = ?, sha256 = ?, hlc = ? WHERE id = ?",
          [uri, v.byte ?? null, v.sha256 ?? null, hlc, v.codice]);
      });
    collegati++;
  }
  return { collegati, senzaFile };
}

export async function elencaBiblioteca(trimestre?: string): Promise<Volume[]> {
  const d = database();
  return trimestre
    ? d.getAllAsync<Volume>(
        "SELECT * FROM biblioteca WHERE trimestre = ? ORDER BY origine, titolo", [trimestre])
    : d.getAllAsync<Volume>("SELECT * FROM biblioteca ORDER BY origine, titolo");
}

/**
 * Apre un volume con il visore PDF del sistema.
 *
 * Scelta deliberata: nessun modulo nativo di terze parti. Nel flusso di lavoro
 * senza PC non esiste adb, quindi un crash nativo sarebbe impossibile da
 * diagnosticare. expo-intent-launcher è un modulo di prima parte di Expo.
 * Il visore del sistema funziona offline e ricorda da solo la pagina.
 */
export async function apriVolume(
  v: Volume
): Promise<"aperto" | "non_scaricato" | "nessun_visore"> {
  if (!v.file_locale) return "non_scaricato";
  const f = new File(v.file_locale);
  if (!f.exists) return "non_scaricato";
  const tipo = v.formato === "epub" ? "application/epub+zip" : "application/pdf";
  try {
    await IntentLauncher.startActivityAsync("android.intent.action.VIEW", {
      data: f.contentUri,
      flags: 1, // FLAG_GRANT_READ_URI_PERMISSION: il visore esterno deve poter leggere il file
      type: tipo,
    });
    return "aperto";
  } catch {
    // Nessuna app registrata per il formato: si passa dal foglio di condivisione.
    if (await Sharing.isAvailableAsync()) {
      await Sharing.shareAsync(f.uri, { mimeType: tipo });
      return "aperto";
    }
    return "nessun_visore";
  }
}

// ---------------------------------------------------------------- LETTORE
/**
 * Copia il lettore HTML (pdf.js incorporato) nello spazio dell'app.
 * Si ricopia quando l'asset cambia: dopo un aggiornamento dell'app una copia
 * vecchia del lettore resterebbe altrimenti in uso per sempre.
 */
export async function preparaLettore(): Promise<string> {
  const asset = Asset.fromModule(require("../assets/lettore/lettore.html"));
  await asset.downloadAsync();
  const cartella = new Directory(Paths.document, "lettore");
  if (!cartella.exists) cartella.create({ intermediates: true });
  const destinazione = new File(cartella, "lettore.html");
  const firma = new File(cartella, "versione.txt");
  const attuale = asset.hash ?? String(new File(asset.localUri!).size);
  if (!destinazione.exists || !firma.exists || (await firma.text()) !== attuale) {
    if (destinazione.exists) destinazione.delete();
    new File(asset.localUri!).copy(destinazione);
    if (!firma.exists) firma.create();
    firma.write(attuale);
  }
  return destinazione.uri;
}

/** PDF di due pagine incluso nell'app: serve al test di fumo su emulatore. */
export async function pdfDiProva(): Promise<string> {
  const asset = Asset.fromModule(require("../assets/lettore/prova.pdf"));
  await asset.downloadAsync();
  const destinazione = new File(cartellaPdf(), "prova.pdf");
  if (!destinazione.exists) new File(asset.localUri!).copy(destinazione);
  return destinazione.uri;
}

/** La pagina viaggia nel registro eventi: si riprende sull'altro dispositivo. */
export async function salvaPagina(id: string, pagina: number) {
  await registra("biblioteca", id, "aggiorna", { ultima_pagina: pagina }, async (d, hlc) => {
    await d.runAsync("UPDATE biblioteca SET ultima_pagina = ?, hlc = ? WHERE id = ?", [pagina, hlc, id]);
  });
}

export async function rimuoviVolume(id: string) {
  const d = database();
  const v = await d.getFirstAsync<Volume>("SELECT * FROM biblioteca WHERE id = ?", [id]);
  if (v?.file_locale) {
    const f = new File(v.file_locale);
    if (f.exists) f.delete();
  }
  await registra("biblioteca", id, "elimina", {}, async (dd) => {
    await dd.runAsync("DELETE FROM biblioteca WHERE id = ?", [id]);
  });
}
