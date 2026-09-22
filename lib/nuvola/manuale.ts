/**
 * La via manuale: un PDF scelto a mano deve seguire la STESSA strada di uno
 * trovato dalla rassegna.
 *
 * Senza questo passaggio un file aggiunto dal telefono resta solo lì: non
 * arriva all'altro dispositivo, e sparisce con la disinstallazione. Con
 * questo, entra nel deposito remoto ed è esattamente indistinguibile da un
 * volume depositato dalla conduttura quotidiana — stessa tabella, stesso
 * bucket, stesso evento.
 *
 * L'altra via manuale è fuori dall'app: lasciare il file in
 * `biblioteca-manuale/` nel repository. Arriva allo stesso posto.
 */
import { File } from "expo-file-system";
import { database, registra } from "../db";
import { Nuvola } from "./cliente";

export type EsitoCaricamento =
  | { esito: "caricato"; percorso: string }
  | { esito: "gia_caricato"; percorso: string }
  | { esito: "senza_file" }
  | { esito: "senza_rete"; motivo: string };

/**
 * Il percorso nel deposito è l'identificativo del volume, non l'impronta del
 * contenuto: calcolare uno sha256 significa leggere in memoria l'intero file,
 * e su un manuale da cinquanta mega è il modo più diretto per farsi chiudere
 * l'app dal sistema proprio mentre si carica.
 */
export async function caricaVolumeInNuvola(
  volumeId: string,
  nuvola?: Nuvola
): Promise<EsitoCaricamento> {
  const d = database();
  const v = await d.getFirstAsync<{
    id: string;
    titolo: string;
    file_locale: string | null;
    formato: string | null;
    pdf_path: string | null;
  }>("SELECT id, titolo, file_locale, formato, pdf_path FROM biblioteca WHERE id = ?", [volumeId]);

  if (!v?.file_locale) return { esito: "senza_file" };
  if (v.pdf_path) return { esito: "gia_caricato", percorso: v.pdf_path };

  const f = new File(v.file_locale);
  if (!f.exists) return { esito: "senza_file" };

  const estensione = (v.formato || "pdf").replace(/[^a-z0-9]/gi, "") || "pdf";
  const percorso = `manuale/${v.id}.${estensione}`;
  const n = nuvola ?? new Nuvola();

  try {
    await n.caricaFile(
      percorso,
      v.file_locale,
      estensione === "epub" ? "application/epub+zip" : "application/pdf"
    );
  } catch (e) {
    // Il volume resta usabile qui: è già sul dispositivo. Manca solo la copia
    // remota, e si riproverà. Non è un errore da mostrare come un guasto.
    return { esito: "senza_rete", motivo: String(e) };
  }

  // `pdf_path` passa dal registro perché vale su QUALUNQUE dispositivo, al
  // contrario di `file_locale`, che è un percorso di questo telefono soltanto.
  await registra(
    "biblioteca",
    v.id,
    "aggiorna",
    { pdf_path: percorso, byte: f.size ?? null },
    async (dd, hlc) => {
      await dd.runAsync("UPDATE biblioteca SET pdf_path = ?, byte = ?, hlc = ? WHERE id = ?", [
        percorso,
        f.size ?? null,
        hlc,
        v.id,
      ]);
    }
  );

  return { esito: "caricato", percorso };
}

/**
 * Tutti i volumi che stanno qui ma non nel deposito. Gira dopo ogni scambio
 * riuscito: un file aggiunto in aereo si carica da sé al primo rientro in rete.
 */
export async function caricaArretrati(nuvola?: Nuvola, massimo = 3): Promise<number> {
  const d = database();
  const arretrati = await d.getAllAsync<{ id: string }>(
    `SELECT id FROM biblioteca
     WHERE origine = 'manuale' AND pdf_path IS NULL
       AND file_locale IS NOT NULL AND file_locale <> ''
     ORDER BY aggiunto_a DESC LIMIT ?`,
    [massimo]
  );
  const n = nuvola ?? new Nuvola();
  let fatti = 0;
  for (const a of arretrati) {
    const r = await caricaVolumeInNuvola(a.id, n);
    if (r.esito === "caricato") fatti++;
    // Un caricamento fallito non ferma gli altri: la rete può cadere a metà
    // elenco, e i rimanenti si riprovano al giro dopo.
  }
  return fatti;
}
