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

/**
 * Una sottolineatura su un PDF: dove sta e che cosa dice.
 *
 * I rettangoli sono in frazioni della pagina, [x, y, larghezza, altezza]
 * fra 0 e 1, così valgono su uno schermo di qualunque larghezza: lo stesso
 * segno fatto sul telefono cade nello stesso punto sul tablet. Viaggiano in
 * `ancora` come JSON {"r": [...]}, perché `ancora` è la colonna che dice
 * DOVE sta un segno, e così non serve cambiare lo schema.
 */
export type Evidenza = { id: string; pagina: number; r: number[][] };

/** Oltre, un rettangolo per riga non serve più: è una selezione sbagliata. */
const RETTANGOLI_MASSIMI = 200;
const TESTO_MASSIMO = 2000;

function rettangoliValidi(r: unknown): number[][] {
  if (!Array.isArray(r)) return [];
  const fuori: number[][] = [];
  for (const q of r.slice(0, RETTANGOLI_MASSIMI)) {
    if (!Array.isArray(q) || q.length !== 4) continue;
    const n = q.map(Number);
    if (!n.every(Number.isFinite)) continue;
    // Il visore arrotonda, e un bordo può uscire di un soffio dalla pagina.
    const [x, y] = [Math.min(Math.max(n[0], 0), 1), Math.min(Math.max(n[1], 0), 1)];
    const w = Math.min(Math.max(n[2], 0), 1 - x);
    const h = Math.min(Math.max(n[3], 0), 1 - y);
    if (w > 0 && h > 0) fuori.push([x, y, w, h]);
  }
  return fuori;
}

/**
 * Sottolinea ciò che è selezionato nel lettore. Solleva se la selezione non
 * dice niente (nessun testo, nessun rettangolo sulla pagina): un segno che
 * non si può disegnare né rileggere non va nel registro.
 */
export async function sottolinea(
  volumeId: string,
  testo: string,
  pagina: number,
  r: unknown
): Promise<Segno> {
  const parole = (testo ?? "").replace(/\s+/g, " ").trim().slice(0, TESTO_MASSIMO);
  const rettangoli = rettangoliValidi(r);
  if (!parole) throw new Error("niente testo selezionato");
  if (!Number.isInteger(pagina) || pagina < 1) throw new Error("pagina non valida");
  if (!rettangoli.length) throw new Error("la selezione non sta su una pagina");
  return annota(volumeId, "evidenza", parole, pagina, JSON.stringify({ r: rettangoli }));
}

/** Le sottolineature fra i segni, pronte per il visore. Le altre si ignorano. */
export function evidenzeDa(segni: Segno[]): Evidenza[] {
  const fuori: Evidenza[] = [];
  for (const s of segni) {
    if (s.genere !== "evidenza" || !s.pagina || !s.ancora) continue;
    let r: unknown;
    try {
      r = (JSON.parse(s.ancora) as { r?: unknown }).r;
    } catch {
      // Un'ancora che non è JSON viene da altro (una nota con «cap-2:tab-3»):
      // resta nella lista dei segni, solo non si disegna.
      continue;
    }
    const rettangoli = rettangoliValidi(r);
    if (rettangoli.length) fuori.push({ id: s.id, pagina: s.pagina, r: rettangoli });
  }
  return fuori;
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
