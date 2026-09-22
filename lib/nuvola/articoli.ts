/**
 * Gli articoli della rassegna quotidiana, dal lato dell'app.
 *
 * Quello che conta qui è la colonna `testo`: la conduttura estrae il testo
 * PRIMA di depositarlo, così leggere non richiede rete. Un elenco di
 * collegamenti sarebbe inutile proprio nei due mesi in cui serve.
 */
import { database, registra } from "../db";

export type Articolo = {
  id: string;
  titolo: string;
  autori: string | null;
  fonte: string | null;
  url: string | null;
  url_pdf: string | null;
  abstract: string | null;
  testo: string | null;
  tema_slug: string | null;
  trimestre: string | null;
  licenza: string | null;
  pubblicato_a: string | null;
  raccolto_a: string;
  letto: number;
  salvato: number;
  hlc: string | null;
};

export async function elencaArticoli(opzioni: {
  soloDaLeggere?: boolean;
  soloSalvati?: boolean;
  tema?: string | null;
  limite?: number;
} = {}): Promise<Articolo[]> {
  const dove: string[] = [];
  const valori: Array<string | number> = [];
  if (opzioni.soloDaLeggere) dove.push("letto = 0");
  if (opzioni.soloSalvati) dove.push("salvato = 1");
  if (opzioni.tema) { dove.push("tema_slug = ?"); valori.push(opzioni.tema); }
  valori.push(opzioni.limite ?? 300);
  return database().getAllAsync<Articolo>(
    `SELECT * FROM articoli ${dove.length ? "WHERE " + dove.join(" AND ") : ""}
     ORDER BY letto, raccolto_a DESC, titolo LIMIT ?`,
    valori
  );
}

export async function leggiArticolo(id: string): Promise<Articolo | null> {
  return database().getFirstAsync<Articolo>("SELECT * FROM articoli WHERE id = ?", [id]);
}

export async function segnaLetto(id: string, letto: boolean): Promise<void> {
  await registra("articoli", id, "aggiorna", { letto: letto ? 1 : 0 }, async (d, hlc) => {
    await d.runAsync("UPDATE articoli SET letto = ?, hlc = ? WHERE id = ?", [letto ? 1 : 0, hlc, id]);
  });
}

export async function segnaSalvato(id: string, salvato: boolean): Promise<void> {
  await registra("articoli", id, "aggiorna", { salvato: salvato ? 1 : 0 }, async (d, hlc) => {
    await d.runAsync("UPDATE articoli SET salvato = ?, hlc = ? WHERE id = ?",
      [salvato ? 1 : 0, hlc, id]);
  });
}

export async function contaNovita(): Promise<{ daLeggere: number; conTesto: number; volumiDaScaricare: number }> {
  const d = database();
  const [a, t, v] = await Promise.all([
    d.getFirstAsync<{ n: number }>("SELECT count(*) AS n FROM articoli WHERE letto = 0"),
    d.getFirstAsync<{ n: number }>(
      "SELECT count(*) AS n FROM articoli WHERE letto = 0 AND testo IS NOT NULL AND testo <> ''"),
    d.getFirstAsync<{ n: number }>(
      "SELECT count(*) AS n FROM biblioteca WHERE pdf_path IS NOT NULL AND (file_locale IS NULL OR file_locale = '')"),
  ]);
  return { daLeggere: a?.n ?? 0, conTesto: t?.n ?? 0, volumiDaScaricare: v?.n ?? 0 };
}

/** I temi presenti, con quanti articoli non letti ciascuno. */
export async function temiConNovita(): Promise<Array<{ tema_slug: string; n: number }>> {
  return database().getAllAsync<{ tema_slug: string; n: number }>(
    `SELECT tema_slug, count(*) AS n FROM articoli
     WHERE letto = 0 AND tema_slug IS NOT NULL GROUP BY tema_slug ORDER BY n DESC`
  );
}
