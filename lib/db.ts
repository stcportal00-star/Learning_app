/**
 * Livello dati locale.
 *
 * Regola architetturale: l'app scrive SEMPRE in locale e non attende mai la
 * rete. Supabase è una destinazione di sincronizzazione, non una dipendenza di
 * funzionamento. In aereo tutto continua a funzionare.
 *
 * Il registro `eventi` è append-only ed è la fonte di verità: le tabelle
 * operative sono una proiezione. Fondere due dispositivi significa concatenare
 * i registri e deduplicare per id evento — non esistono conflitti per costruzione.
 */
import * as SQLite from "expo-sqlite";
import { Orologio, serializza, HLC } from "./hlc";

let db: SQLite.SQLiteDatabase | null = null;
let orologio: Orologio | null = null;

export const SCHEMA_VERSIONE = 1;

const MIGRAZIONI: string[][] = [
  // v1
  [
    `CREATE TABLE IF NOT EXISTS meta (
       chiave TEXT PRIMARY KEY, valore TEXT NOT NULL);`,

    `CREATE TABLE IF NOT EXISTS eventi (
       id TEXT PRIMARY KEY,
       hlc TEXT NOT NULL,
       dispositivo TEXT NOT NULL,
       entita TEXT NOT NULL,
       entita_id TEXT NOT NULL,
       tipo TEXT NOT NULL CHECK (tipo IN ('crea','aggiorna','elimina')),
       payload TEXT NOT NULL DEFAULT '{}',
       sincronizzato INTEGER NOT NULL DEFAULT 0);`,
    `CREATE INDEX IF NOT EXISTS eventi_hlc_idx ON eventi (hlc);`,
    `CREATE INDEX IF NOT EXISTS eventi_da_sincronizzare ON eventi (sincronizzato, hlc);`,

    `CREATE TABLE IF NOT EXISTS temi (
       id TEXT PRIMARY KEY, slug TEXT UNIQUE NOT NULL, nome TEXT NOT NULL,
       pista TEXT NOT NULL, trimestre TEXT, attivo INTEGER NOT NULL DEFAULT 1);`,

    `CREATE TABLE IF NOT EXISTS esercizi (
       id TEXT PRIMARY KEY, tema_slug TEXT, tipo TEXT NOT NULL, livello INTEGER NOT NULL,
       consegna TEXT NOT NULL, dataset TEXT, soluzione_riferimento TEXT,
       preparazione TEXT, rubrica TEXT, fonte_citazione TEXT,
       righe_attese INTEGER, colonne_attese TEXT, ordine_rilevante INTEGER NOT NULL DEFAULT 0);`,
    `CREATE INDEX IF NOT EXISTS esercizi_tema_idx ON esercizi (tema_slug, livello);`,

    `CREATE TABLE IF NOT EXISTS tentativi (
       id TEXT PRIMARY KEY, esercizio_id TEXT NOT NULL, risposta TEXT,
       esito TEXT NOT NULL, motivo TEXT, durata_sec INTEGER,
       eseguito_a TEXT NOT NULL, hlc TEXT NOT NULL);`,
    `CREATE INDEX IF NOT EXISTS tentativi_esercizio_idx ON tentativi (esercizio_id, eseguito_a DESC);`,

    `CREATE TABLE IF NOT EXISTS ripasso (
       esercizio_id TEXT PRIMARY KEY, stabilita REAL NOT NULL DEFAULT 0,
       difficolta REAL NOT NULL DEFAULT 5, ripetizioni INTEGER NOT NULL DEFAULT 0,
       ultima_revisione TEXT, prossima_revisione TEXT NOT NULL,
       stato TEXT NOT NULL DEFAULT 'nuovo');`,
    `CREATE INDEX IF NOT EXISTS ripasso_prossima_idx ON ripasso (prossima_revisione);`,

    `CREATE TABLE IF NOT EXISTS sessioni (
       id TEXT PRIMARY KEY, tema_slug TEXT, tipo TEXT NOT NULL,
       inizio TEXT NOT NULL, minuti INTEGER NOT NULL, note TEXT, hlc TEXT NOT NULL);`,
    `CREATE INDEX IF NOT EXISTS sessioni_inizio_idx ON sessioni (inizio DESC);`,

    `CREATE TABLE IF NOT EXISTS note (
       id TEXT PRIMARY KEY, tema_slug TEXT, titolo TEXT, testo TEXT NOT NULL DEFAULT '',
       pubblicabile INTEGER NOT NULL DEFAULT 0, origine_url TEXT,
       creato_a TEXT NOT NULL, hlc TEXT NOT NULL);`,

    `CREATE TABLE IF NOT EXISTS artefatti (
       id TEXT PRIMARY KEY, titolo TEXT NOT NULL, trimestre TEXT,
       stato TEXT NOT NULL DEFAULT 'pianificato', descrizione TEXT, url TEXT, hlc TEXT);`,

    `CREATE TABLE IF NOT EXISTS credenziali (
       id TEXT PRIMARY KEY, nome TEXT NOT NULL, ente TEXT NOT NULL,
       costo_usd REAL DEFAULT 0, stato TEXT NOT NULL DEFAULT 'pianificata',
       data_esame TEXT, url_badge TEXT, scadenza TEXT, anno_previsto INTEGER, hlc TEXT);`,

    `CREATE TABLE IF NOT EXISTS pubblicazioni (
       id TEXT PRIMARY KEY, titolo TEXT NOT NULL, tipo TEXT NOT NULL,
       stato TEXT NOT NULL DEFAULT 'bozza', url TEXT, data_pubblicazione TEXT, hlc TEXT);`,

    `CREATE TABLE IF NOT EXISTS biblioteca (
       id TEXT PRIMARY KEY, titolo TEXT NOT NULL, autore TEXT,
       tema_slug TEXT, trimestre TEXT,
       origine TEXT NOT NULL DEFAULT 'aperta' CHECK (origine IN ('aperta','manuale')),
       licenza TEXT, url TEXT, file_locale TEXT, formato TEXT DEFAULT 'pdf',
       byte INTEGER, sha256 TEXT, pagine INTEGER, ultima_pagina INTEGER DEFAULT 0,
       aggiunto_a TEXT NOT NULL, hlc TEXT);`,
    `CREATE INDEX IF NOT EXISTS biblioteca_trim_idx ON biblioteca (trimestre, tema_slug);`,
  ],
];

export async function apri(dispositivoId: string): Promise<SQLite.SQLiteDatabase> {
  if (db) return db;
  db = await SQLite.openDatabaseAsync("percorso.db");
  await db.execAsync("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;");

  const riga = await db.getFirstAsync<{ user_version: number }>("PRAGMA user_version");
  const versione = riga?.user_version ?? 0;

  for (let v = versione; v < MIGRAZIONI.length; v++) {
    for (const istruzione of MIGRAZIONI[v]) await db.execAsync(istruzione);
  }
  if (versione < MIGRAZIONI.length) {
    await db.execAsync(`PRAGMA user_version = ${MIGRAZIONI.length}`);
  }

  const salvato = await db.getFirstAsync<{ valore: string }>(
    "SELECT valore FROM meta WHERE chiave = 'hlc'"
  );
  orologio = new Orologio(dispositivoId);
  if (salvato) {
    const [ms, cont] = salvato.valore.split("-");
    orologio = new Orologio(dispositivoId, {
      ms: parseInt(ms, 16),
      contatore: parseInt(cont, 16),
      dispositivo: dispositivoId,
    });
  }
  return db;
}

function richiediDb(): SQLite.SQLiteDatabase {
  if (!db) throw new Error("Database non aperto: chiamare apri() all'avvio.");
  return db;
}

export function timbro(): HLC {
  if (!orologio) throw new Error("Orologio non inizializzato.");
  return orologio.adesso();
}

export function derivaSospetta(): boolean {
  return orologio?.derivaSospetta ?? false;
}

/**
 * Registra un evento e applica la proiezione nella stessa transazione.
 * Nessuna scrittura passa per un'altra strada: è ciò che rende la
 * sincronizzazione una semplice concatenazione di registri.
 */
export async function registra(
  entita: string,
  entitaId: string,
  tipo: "crea" | "aggiorna" | "elimina",
  payload: Record<string, unknown>,
  proiezione: (d: SQLite.SQLiteDatabase, hlc: string) => Promise<void>
): Promise<string> {
  const d = richiediDb();
  const h = timbro();
  const hlc = serializza(h);
  await d.withTransactionAsync(async () => {
    await d.runAsync(
      `INSERT INTO eventi (id, hlc, dispositivo, entita, entita_id, tipo, payload)
       VALUES (?,?,?,?,?,?,?)`,
      [hlc + ":" + entitaId, hlc, h.dispositivo, entita, entitaId, tipo, JSON.stringify(payload)]
    );
    await proiezione(d, hlc);
    await d.runAsync(
      `INSERT INTO meta (chiave, valore) VALUES ('hlc', ?)
       ON CONFLICT (chiave) DO UPDATE SET valore = excluded.valore`,
      [h.ms.toString(16) + "-" + h.contatore.toString(16)]
    );
  });
  return hlc;
}

/** Eventi non ancora inviati, in ordine causale. Usato dai tre trasporti di sync. */
export async function daSincronizzare(limite = 500) {
  return richiediDb().getAllAsync<{
    id: string; hlc: string; dispositivo: string; entita: string;
    entita_id: string; tipo: string; payload: string;
  }>(
    `SELECT id, hlc, dispositivo, entita, entita_id, tipo, payload
     FROM eventi WHERE sincronizzato = 0 ORDER BY hlc LIMIT ?`,
    [limite]
  );
}

export async function segnaSincronizzati(ids: string[]) {
  if (!ids.length) return;
  const segnaposto = ids.map(() => "?").join(",");
  await richiediDb().runAsync(
    `UPDATE eventi SET sincronizzato = 1 WHERE id IN (${segnaposto})`,
    ids
  );
}

export function database() {
  return richiediDb();
}
