/**
 * I segni: note, evidenziazioni e segnalibri lasciati su un testo.
 *
 * Stanno ACCANTO al file, mai dentro. Annotare dentro il PDF cambierebbe i
 * byte, e con i byte l'impronta: il volume non si potrebbe più riscaricare
 * senza perdere il lavoro, e due dispositivi che segnano lo stesso testo
 * produrrebbero due file diversi che nessuna fusione sa riconciliare.
 *
 * Fuori, invece, un segno è un evento come gli altri: si sincronizza da sé,
 * si fonde senza conflitti, e vale sia per un PDF sia per un articolo di cui
 * abbiamo solo il testo.
 */
import * as Crypto from "expo-crypto";
import { database, registra } from "../db";

export type Genere = "nota" | "evidenza" | "segnalibro";

export type Segno = {
  id: string;
  volume_id: string;
  genere: Genere;
  pagina: number | null;
  ancora: string | null;
  testo: string;
  creato_a: string;
  hlc: string | null;
};

/**
 * Il payload porta TUTTI i campi della riga, non solo quelli cambiati.
 * È ciò che permette all'altro dispositivo di creare la riga dal solo evento:
 * con un payload parziale la proiezione non può inventare le colonne
 * obbligatorie e salta la riga in silenzio.
 */
export async function annota(
  volumeId: string,
  genere: Genere,
  testo: string,
  pagina: number | null = null,
  ancora: string | null = null
): Promise<Segno> {
  const s: Segno = {
    id: Crypto.randomUUID(),
    volume_id: volumeId,
    genere,
    pagina,
    ancora,
    testo,
    creato_a: new Date().toISOString(),
    hlc: null,
  };
  const hlc = await registra(
    "segni",
    s.id,
    "crea",
    {
      volume_id: s.volume_id,
      genere: s.genere,
      pagina: s.pagina,
      ancora: s.ancora,
      testo: s.testo,
      creato_a: s.creato_a,
    },
    async (d, h) => {
      await d.runAsync(
        `INSERT INTO segni (id, volume_id, genere, pagina, ancora, testo, creato_a, hlc)
         VALUES (?,?,?,?,?,?,?,?)`,
        [s.id, s.volume_id, s.genere, s.pagina, s.ancora, s.testo, s.creato_a, h]
      );
    }
  );
  return { ...s, hlc };
}

export async function riscrivi(id: string, testo: string): Promise<void> {
  await registra("segni", id, "aggiorna", { testo }, async (d, h) => {
    await d.runAsync("UPDATE segni SET testo = ?, hlc = ? WHERE id = ?", [testo, h, id]);
  });
}

export async function cancella(id: string): Promise<void> {
  await registra("segni", id, "elimina", {}, async (d) => {
    await d.runAsync("DELETE FROM segni WHERE id = ?", [id]);
  });
}

export async function segniDi(volumeId: string): Promise<Segno[]> {
  return database().getAllAsync<Segno>(
    "SELECT * FROM segni WHERE volume_id = ? ORDER BY pagina IS NULL, pagina, creato_a",
    [volumeId]
  );
}

export async function quantiSegni(volumeId: string): Promise<number> {
  const r = await database().getFirstAsync<{ n: number }>(
    "SELECT count(*) AS n FROM segni WHERE volume_id = ?",
    [volumeId]
  );
  return r?.n ?? 0;
}
