/**
 * LENTE "FALSIFICAZIONE RO-01" — misura se le guardie di
 * test/simulazione/motore-sql.mjs possono davvero diventare rosse.
 *
 * PERCHE' ESISTE. La falsificazione della coda (corpo di inCoda() sostituito da
 * `return compito();` in lib/db.ts) lascia motore-sql.mjs a 126/126: ZERO rosse.
 * Il motivo non e' che le sue guardie siano vuote, ma che motore-sql.mjs non
 * importa mai lib/db.ts — carica solo lib/palestra.ts e lib/verifica.ts
 * (righe 183-184). Spegnere la coda, per quel file, non e' una misura: e' una
 * mutazione su codice che quel file non esegue.
 *
 * Quindi la domanda «le guardie di motore-sql possono fallire?» va posta con la
 * mutazione GIUSTA: quella della correzione che quelle guardie sorvegliano
 * davvero, cioe' RO-01 — `PRAGMA query_only = ON` in lib/palestra.ts. Sono
 * tredici asserzioni corretto(): PRE-06, RO-01a..e, RO-02, RO-02b, RO-02c,
 * RO-03b, RO-04, RO-04b.
 *
 * COME SI MISURA, SENZA TOCCARE NIENTE. Non si modifica lib/palestra.ts: si
 * rende inerte il solo `PRAGMA query_only = ON` al livello del motore
 * (node:sqlite), sotto il doppio del banco. Tutto il resto del PRAGMA e dello
 * schema continua a funzionare, altrimenti la prova cadrebbe prima di arrivare
 * alle guardie e la misura non varrebbe niente. Stessa tecnica di
 * test/simulazione/lente-tautologie-g6.mjs, che non tocca il progetto.
 *
 * Si esegue nella forma che motore-sql.mjs documenta da se' (righe 56-57),
 * perche' altrimenti quel file si riavvia da solo in un processo figlio e la
 * mutazione di questa lente resterebbe fuori:
 *
 *   BANCO_DOPPI="$(node -e 'import("./test/banco/doppi-altri.mjs").then(m=>console.log(m.variabileBanco()))')" \
 *     MOTORE_SQL_IN_CORSO=1 node --import ./test/banco/carica.mjs \
 *     test/simulazione/lente-falsificazione-ro01.mjs
 *
 * ATTESO se le guardie valgono: le tredici corretto() di RO-01/RO-02/RO-04
 * diventano rosse. Se restano verdi, sorvegliano una correzione che non stanno
 * misurando.
 *
 * MISURATO (21 settembre 2026): 126/126 con la coda spenta (mutazione che non
 * la tocca), 113/126 con questa lente — 13 rosse, 11 PRAGMA resi inerti.
 * Rosse: F16 PRE-06 (ok), PRE-06, RO-01, RO-01b, RO-01c, RO-01d, RO-01e,
 * RO-02, RO-02b, RO-02c, RO-03b, RO-04, RO-04b.
 *
 * VERDE, ed e' il punto: RO-01a (motore-sql.mjs riga 769). Non guarda la
 * connessione, guarda il TESTO di lib/palestra.ts con
 * `/PRAGMA query_only = ON/.test(sorgentePalestra)`. La sola lettura era
 * revocata su tutte e undici le aperture, gli UPDATE passavano, il file
 * cambiava — e RO-01a e' rimasta verde, perche' la stringa nel sorgente
 * c'era ancora. Peggio: basta cancellare la riga 47 di lib/palestra.ts
 * (il PRAGMA dentro apriPalestra(), cioe' esattamente cio' che RO-01a dice di
 * sorvegliare) e la riga 97 dentro eseguiConPreparazione() continua a far
 * combaciare la regex: regressione vera, guardia verde.
 */
import "../banco/carica.mjs";
import { DatabaseSync } from "node:sqlite";

// Solo la sola-lettura viene revocata. Il confronto e' sul testo esatto che
// lib/palestra.ts manda (righe 47 e 97): cosi' nessun altro PRAGMA cade con
// lui, e la differenza misurata e' attribuibile a RO-01 e a nient'altro.
const SOLA_LETTURA = /^\s*PRAGMA\s+query_only\s*=\s*ON\s*;?\s*$/i;

let revocate = 0;
const execVero = DatabaseSync.prototype.exec;
DatabaseSync.prototype.exec = function (sql, ...resto) {
  if (typeof sql === "string" && SOLA_LETTURA.test(sql)) {
    revocate++;
    return undefined; // la connessione resta scrivibile: RO-01 come se non fosse corretto
  }
  return execVero.call(this, sql, ...resto);
};

process.on("exit", () => {
  console.log(`\nlente RO-01: PRAGMA query_only resi inerti: ${revocate}`);
  if (revocate === 0) {
    console.log("MUTAZIONE ASSENTE: nessun query_only intercettato, misura NON valida");
  }
});

console.log(
  "lente RO-01: la sola lettura della palestra viene revocata; " +
    "attese ROSSE le tredici guardie corretto() di motore-sql.mjs.\n"
);

await import("./motore-sql.mjs");
