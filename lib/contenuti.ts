/**
 * Carica nel database locale i contenuti impacchettati nell'app.
 * Gira una sola volta, al primo avvio, e non richiede rete.
 *
 * I contenuti sono asset statici: non passano dal registro eventi, perché non
 * sono dati dell'utente e sono identici su tutti i dispositivi. Solo i tentativi,
 * le note e i progressi sono eventi sincronizzabili.
 */
import { database, inTransazione } from "./db";

type EsercizioSql = {
  id: string; tema: string; livello: number; consegna: string;
  soluzione: string; preparazione?: string;
  righe_attese: number; colonne_attese: string[];
};
type EsercizioCodice = {
  id: string; categoria: string; livello: number; titolo: string; consegna: string;
  codice_difettoso: string; codice_corretto: string; test: string; difetto: string;
};
type Flashcard = {
  id: string; tema: string; domanda: string; risposta: string;
  fonte: string; riferimento: string;
};
type Scenario = {
  id: string; tema: string; tipo: string; tempo_min: number;
  consegna: string; rubrica: string[];
};
type VolumeAperto = {
  codice: string; titolo: string; autore: string; tema_slug: string;
  trimestre: string; licenza: string; url: string; formato: string; nota: string;
};

const TEMI: Array<[string, string, string, string]> = [
  ["gestione", "Gestione delle persone", "gestione", "T0"],
  ["sql_base", "SQL — fondamenti", "dati", "T1"],
  ["sql_join", "SQL — join", "dati", "T1"],
  ["sql_agg", "SQL — aggregazione", "dati", "T1"],
  ["meal", "MEAL e indicatori", "kpi", "T1"],
  ["business_analysis", "Business analysis e BPMN", "business_analysis", "T1"],
  ["lettura_codice", "Lettura e verifica del codice", "ia", "T1"],
  ["sql_cte", "SQL — CTE e ricorsione", "dati", "T2"],
  ["sql_window", "SQL — window functions", "dati", "T2"],
  ["modellazione", "Modellazione dimensionale", "dati", "T2"],
  ["qualita_dati", "Qualità dei dati", "dati", "T2"],
  ["kpi", "KPI e misurazione", "kpi", "T2"],
  ["statistica", "Statistica applicata", "dati", "T2"],
  ["epidemiologia", "Analisi epidemiologica", "dati", "T2"],
  ["ia", "AI engineering", "ia", "T3"],
  ["gdpr", "GDPR e protezione dati", "governance", "T3"],
  ["ai_act", "AI Act e governance IA", "governance", "T3"],
  ["ottimizzazione", "SQL — piani di esecuzione e indici", "dati", "T4"],
  ["hardware", "Hardware, reti e infrastruttura", "hardware", "T5"],
  ["governance", "ITIL e governance dei servizi", "governance", "T5"],
  ["sicurezza", "ISO 27001, NIS2 e sicurezza", "governance", "T5"],
  ["salute_digitale", "DHIS2, FHIR e sistemi sanitari", "dati", "T6"],
];

function ordineRilevante(consegna: string, soluzione: string): boolean {
  return (
    /ordin|dal più|dalla più|prime? \d|ultim|classific|posizione|decrescent|crescent/i.test(consegna) ||
    /\blimit\b/i.test(soluzione)
  );
}

export async function caricaContenuti(): Promise<{
  temi: number; sql: number; codice: number; flashcard: number;
  scenari: number; biblioteca: number; saltato: boolean;
}> {
  const d = database();
  const gia = await d.getFirstAsync<{ n: number }>("SELECT count(*) AS n FROM esercizi");
  if ((gia?.n ?? 0) > 0) {
    return { temi: 0, sql: 0, codice: 0, flashcard: 0, scenari: 0, biblioteca: 0, saltato: true };
  }

  const sql: EsercizioSql[] = require("../assets/contenuti/esercizi_sql.json");
  const codice: EsercizioCodice[] = require("../assets/contenuti/esercizi_codice.json");
  const flash: Flashcard[] = require("../assets/contenuti/flashcard.json");
  const scenari: Scenario[] = require("../assets/contenuti/scenari_rubrica.json");
  const volumi: VolumeAperto[] = require("../assets/contenuti/biblioteca.json");

  await inTransazione(async (d) => {
    for (const [slug, nome, pista, trimestre] of TEMI) {
      await d.runAsync(
        `INSERT OR IGNORE INTO temi (id, slug, nome, pista, trimestre) VALUES (?,?,?,?,?)`,
        [`tema:${slug}`, slug, nome, pista, trimestre]
      );
    }

    for (const e of sql) {
      await d.runAsync(
        `INSERT OR IGNORE INTO esercizi
         (id, tema_slug, tipo, livello, consegna, dataset, soluzione_riferimento,
          preparazione, righe_attese, colonne_attese, ordine_rilevante)
         VALUES (?,?,'sql_eseguibile',?,?,'palestra.db',?,?,?,?,?)`,
        [e.id, e.tema, e.livello, e.consegna, e.soluzione, e.preparazione ?? null,
         e.righe_attese, JSON.stringify(e.colonne_attese),
         ordineRilevante(e.consegna, e.soluzione) ? 1 : 0]
      );
    }

    for (const c of codice) {
      await d.runAsync(
        `INSERT OR IGNORE INTO esercizi
         (id, tema_slug, tipo, livello, consegna, dataset, soluzione_riferimento, rubrica)
         VALUES (?,'lettura_codice','lettura_codice',?,?,'python',?,?)`,
        [c.id, c.livello, `${c.titolo}\n\n${c.consegna}\n\n${c.codice_difettoso}`,
         c.difetto, JSON.stringify({ corretto: c.codice_corretto, test: c.test, categoria: c.categoria })]
      );
    }

    for (const f of flash) {
      await d.runAsync(
        `INSERT OR IGNORE INTO esercizi
         (id, tema_slug, tipo, livello, consegna, soluzione_riferimento, fonte_citazione)
         VALUES (?,?,'quiz_citato',2,?,?,?)`,
        [f.id, f.tema, f.domanda, f.risposta, `${f.fonte} — ${f.riferimento}`]
      );
    }

    for (const s of scenari) {
      await d.runAsync(
        `INSERT OR IGNORE INTO esercizi
         (id, tema_slug, tipo, livello, consegna, rubrica)
         VALUES (?,?,'rubrica',4,?,?)`,
        [s.id, s.tema, s.consegna, JSON.stringify(s.rubrica)]
      );
    }

    const adesso = new Date().toISOString();
    for (const v of volumi) {
      // `nota` e `codice` esistono in tabella dalla v2 dello schema: la nota
      // dice a cosa serve il volume, ed era l'unico campo dei 52 che veniva
      // letto dal JSON e poi buttato via prima di arrivare a schermo.
      await d.runAsync(
        `INSERT OR IGNORE INTO biblioteca
         (id, codice, titolo, autore, tema_slug, trimestre, origine, licenza, url,
          formato, nota, aggiunto_a)
         VALUES (?,?,?,?,?,?,'aperta',?,?,?,?,?)`,
        [v.codice, v.codice, v.titolo, v.autore, v.tema_slug, v.trimestre, v.licenza,
         v.url, v.formato, v.nota ?? null, adesso]
      );
    }

    // coda di ripasso: tutte le schede con citazione partono come "nuovo"
    for (const f of flash) {
      await d.runAsync(
        `INSERT OR IGNORE INTO ripasso (esercizio_id, prossima_revisione) VALUES (?,?)`,
        [f.id, adesso]
      );
    }
  });

  return {
    temi: TEMI.length, sql: sql.length, codice: codice.length,
    flashcard: flash.length, scenari: scenari.length, biblioteca: volumi.length,
    saltato: false,
  };
}
