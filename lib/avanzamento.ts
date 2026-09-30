/**
 * Legge dalle tabelle quanto materiale c'è per ogni tema e quanto se n'è
 * fatto, e ne ricava il percorso di lib/percorso.ts.
 *
 * Solo letture, e solo tabelle che l'app scrive già: tentativi, ripasso,
 * note, biblioteca, articoli. Nessuna rete, nessun evento nuovo.
 */
import { database } from "./db";
import { supportaWindowFunctions } from "./palestra";
import { TEMI } from "./contenuti";
import {
  Materiale, MATERIALE_VUOTO, Tema, Unita, Scenario, costruisciPercorso,
  modelloScenario, scenarioSvolto,
} from "./percorso";

type Conteggio = { tema: string | null; totale: number; fatti: number | null; altri?: number | null };

export type ScenarioDiUnita = Scenario & { notaId: string | null; svolto: boolean };
export type VolumeDiUnita = {
  id: string; titolo: string; autore: string | null; file_locale: string | null;
  ultima_pagina: number; pagine: number | null;
};

/**
 * Il filtro delle window functions è lo stesso di Studio e di Esercizi: su un
 * telefono il cui SQLite non le ha, quei 23 esercizi non si possono risolvere,
 * e un'unità che li contasse non si chiuderebbe mai.
 */
function filtroWindow(): string {
  return supportaWindowFunctions() ? "" : " AND e.tema_slug <> 'sql_window'";
}

function parseRubrica(testo: string | null): string[] {
  try {
    const v = JSON.parse(testo ?? "[]");
    return Array.isArray(v) ? v.map(String) : [];
  } catch {
    return [];
  }
}

/** Gli scenari di un tema, o di tutti, con la loro nota e se sono svolti. */
async function scenari(tema?: string): Promise<Array<ScenarioDiUnita & { tema: string | null }>> {
  const d = database();
  const righe = await d.getAllAsync<{ id: string; tema: string | null; consegna: string; rubrica: string | null }>(
    `SELECT id, tema_slug AS tema, consegna, rubrica FROM esercizi
     WHERE tipo = 'rubrica'${tema ? " AND tema_slug = ?" : ""} ORDER BY id`,
    tema ? [tema] : []);
  // La nota più recente per scenario: se per qualche ragione ne esistono due
  // (due dispositivi che l'hanno aperta prima di sincronizzarsi), vale
  // l'ultima scritta.
  const note = await d.getAllAsync<{ id: string; origine_url: string; testo: string }>(
    `SELECT id, origine_url, testo FROM note WHERE origine_url LIKE 'scenario:%' ORDER BY creato_a`);
  const perScenario = new Map(note.map((n) => [n.origine_url.slice("scenario:".length), n]));
  const nomi = new Map(TEMI.map(([slug, nome]) => [slug, nome]));
  return righe.map((r) => {
    const s: Scenario = { id: r.id, consegna: r.consegna, rubrica: parseRubrica(r.rubrica) };
    const nota = perScenario.get(r.id);
    const modello = modelloScenario(s, nomi.get(r.tema ?? "") ?? r.tema ?? "");
    return { ...s, tema: r.tema, notaId: nota?.id ?? null, svolto: nota ? scenarioSvolto(nota.testo, modello.testo) : false };
  });
}

export async function leggiMateriali(adesso = new Date()): Promise<Record<string, Materiale>> {
  const d = database();
  const [esercizi, schede, volumi, articoli, tuttiScenari] = await Promise.all([
    d.getAllAsync<Conteggio>(
      `SELECT e.tema_slug AS tema, count(*) AS totale,
              sum(EXISTS (SELECT 1 FROM tentativi t WHERE t.esercizio_id = e.id AND t.esito = 'corretto')) AS fatti
       FROM esercizi e
       WHERE (e.tipo = 'sql_eseguibile' AND e.dataset = 'palestra.db' OR e.tipo = 'lettura_codice')${filtroWindow()}
       GROUP BY e.tema_slug`),
    d.getAllAsync<Conteggio>(
      `SELECT e.tema_slug AS tema, count(*) AS totale,
              sum(r.ripetizioni > 0 AND r.stato <> 'ricaduta') AS fatti,
              sum(r.prossima_revisione <= ?) AS altri
       FROM esercizi e JOIN ripasso r ON r.esercizio_id = e.id
       WHERE e.tipo = 'quiz_citato'
       GROUP BY e.tema_slug`, [adesso.toISOString()]),
    d.getAllAsync<Conteggio & { aperti: number | null }>(
      `SELECT tema_slug AS tema, count(*) AS totale,
              sum(file_locale IS NOT NULL) AS fatti,
              sum(ultima_pagina > 0) AS aperti
       FROM biblioteca GROUP BY tema_slug`),
    d.getAllAsync<Conteggio>(
      `SELECT tema_slug AS tema, count(*) AS totale, 0 AS fatti
       FROM articoli WHERE letto = 0 GROUP BY tema_slug`),
    scenari(),
  ]);

  const m: Record<string, Materiale> = {};
  const di = (tema: string | null) => {
    const k = tema ?? "";
    return (m[k] ??= { ...MATERIALE_VUOTO });
  };
  for (const r of esercizi) { di(r.tema).esercizi = r.totale; di(r.tema).risolti = r.fatti ?? 0; }
  for (const r of schede) {
    const x = di(r.tema);
    x.schede = r.totale; x.schedeSapute = r.fatti ?? 0; x.schedeInScadenza = r.altri ?? 0;
  }
  for (const r of volumi) {
    const x = di(r.tema);
    x.volumi = r.totale; x.volumiSulTelefono = r.fatti ?? 0; x.volumiIniziati = r.aperti ?? 0;
  }
  for (const r of articoli) di(r.tema).articoliDaLeggere = r.totale;
  for (const s of tuttiScenari) {
    const x = di(s.tema);
    x.scenari++;
    if (s.svolto) x.scenariSvolti++;
  }
  return m;
}

export async function leggiPercorso(adesso = new Date()): Promise<Unita[]> {
  const temi = await database().getAllAsync<Tema>(
    "SELECT slug, nome, trimestre FROM temi WHERE attivo = 1");
  return costruisciPercorso(temi, await leggiMateriali(adesso), TEMI.map(([slug]) => slug));
}

/** Il volume da aprire per il passo «Leggi»: il primo sul telefono mai aperto, se c'è. */
export function volumeDaAprire(volumi: VolumeDiUnita[]): string | null {
  const v = volumi.find((v) => v.file_locale && !(v.ultima_pagina > 0)) ??
    volumi.find((v) => v.file_locale);
  return v?.id ?? null;
}

export async function leggiVolumi(tema: string): Promise<VolumeDiUnita[]> {
  return database().getAllAsync<VolumeDiUnita>(
    `SELECT id, titolo, autore, file_locale, ultima_pagina, pagine FROM biblioteca
     WHERE tema_slug = ? ORDER BY file_locale IS NULL, titolo`, [tema]);
}

export async function leggiScenari(tema: string): Promise<ScenarioDiUnita[]> {
  return scenari(tema);
}
