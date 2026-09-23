/**
 * LENTE "TAUTOLOGIE" — falsificazione mirata della guardia G6 di
 * test/simulazione/contenuti.mjs («colonne_attese coincide per NOMI e ORDINE
 * con quelle restituite»).
 *
 * PERCHE' ESISTE. G6 scorre le soluzioni degli esercizi SQL cosi:
 *
 *     try { righe = d.prepare(e.soluzione).all(); } catch { continue; }
 *     if (!righe.length) continue;
 *
 * Un esercizio che non si esegue, o che non restituisce righe, viene SALTATO
 * in silenzio: non finisce in nessuna delle due liste che lo scenario poi
 * pretende vuote. Le tre sorelle dello stesso file (G4 riga 962, G5 riga 978,
 * G7 riga 1017) l'errore lo REGISTRANO; G6 e' l'unica che lo inghiotte. Quindi
 * G6 non puo' diventare rossa quando le soluzioni smettono di girare: e' verde
 * con 143 esercizi controllati ed e' verde con ZERO esercizi controllati, e i
 * due casi non si distinguono dall'esito.
 *
 * COME SI MISURA. Non si tocca nessun file del progetto: si fa lanciare
 * `prepare()` per le sole soluzioni degli esercizi SQL, poi si esegue
 * contenuti.mjs cosi com'e'. Se il ragionamento e' giusto, G4, G5 e G7
 * diventano rosse e G6 resta VERDE.
 *
 *   node --import ./test/banco/carica.mjs test/simulazione/lente-tautologie-g6.mjs
 *
 * MISURATO (21 settembre 2026): vedere il riepilogo stampato da contenuti.mjs
 * in coda a questa esecuzione.
 */
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

const RADICE = new URL("../..", import.meta.url).pathname.replace(/\/$/, "");

// Le sole query da far fallire: le soluzioni vere degli esercizi SQL, cioe'
// esattamente quelle che G4/G5/G6/G7 preparano. Tutto il resto del file —
// letture di controllo, conteggi, schema — continua a funzionare, altrimenti
// la prova cadrebbe prima di arrivare a G6 e la misura non varrebbe niente.
const soluzioni = new Set(
  JSON.parse(readFileSync(RADICE + "/assets/contenuti/esercizi_sql.json", "utf8"))
    .map((e) => e.soluzione)
);

const preparaVero = DatabaseSync.prototype.prepare;
DatabaseSync.prototype.prepare = function (sql, ...resto) {
  if (typeof sql === "string" && soluzioni.has(sql)) {
    throw new Error("falsificazione della lente: la soluzione non e' eseguibile");
  }
  return preparaVero.call(this, sql, ...resto);
};

console.log(
  `lente tautologie: ${soluzioni.size} soluzioni SQL rese non eseguibili; ` +
    `attese ROSSE G4, G5, G7 — e VERDE G6, che e' il punto.\n`
);

await import("./contenuti.mjs");
