/**
 * Controprova avversariale, lente CONSEGUENZA, sul difetto 2:
 * "gli eventi ricevuti non vengono mai proiettati".
 *
 * La correttezza del difetto e' gia' stata mostrata altrove: qui la domanda e'
 * un'altra e piu' severa. Un difetto che non raggiunge l'utente non e' un
 * difetto. Quindi questo file non chiede "la tabella note resta vuota?" ma
 * "l'utente, in aereo, con i suoi due Android, perde davvero qualcosa e in
 * cambio di che cosa?".
 *
 * Percio' qui NON si guardano le tabelle: si eseguono, verbatim, le QUERY DELLE
 * SCHERMATE (app/(tabs)/note.tsx, app/ripasso.tsx, app/(tabs)/oggi.tsx) e si
 * guarda cosa vedrebbe l'utente, e si eseguono anche riassumi() e
 * valutaDivergenza() veri, che sono le due frasi che l'app gli mostra dopo lo
 * scambio. La sequenza di applicazione dei ricevuti e' la copia alla lettera
 * delle righe 46-63 di lib/sync/useAutoSync.ts (l'hook non e' importabile: usa
 * React e AppState).
 *
 * Comando:
 *   node --import ./test/banco/carica.mjs test/simulazione/controprova-2-conseguenza.mjs
 *
 * Falsificazione: se qualcuno aggiunge la proiezione dei ricevuti, le verifiche
 * marcate [ATTESO-ROSSO-DOPO-LA-CORREZIONE] diventano rosse. E' voluto: sono
 * la fotografia del comportamento di oggi, non il contratto desiderato.
 */
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { configuraCartella } from "../banco/expo-sqlite.mjs";

const cartella = configuraCartella(mkdtempSync(join(tmpdir(), "controprova-2-cons-")));

let verdi = 0;
let rosse = 0;
function verifica(nome, condizione, dettaglio = "") {
  if (condizione) { verdi++; console.log("  ok    " + nome); }
  else { rosse++; console.log("  ROSSA " + nome + (dettaglio ? " -> " + dettaglio : "")); }
}

const db = await import("../../lib/db.ts");
const fusione = await import("../../lib/sync/fusione.ts");
const trasporto = await import("../../lib/sync/trasporto.ts");
const auto = await import("../../lib/sync/auto.ts");

await db.apri("tablet");
const base = db.database();

// ---------------------------------------------------------------------------
// Preparazione: lo stato che il TABLET ha gia' suo. Le righe di esercizi e
// ripasso sono contenuto precaricato (caricaContenuti), non passano da
// registra(): le scrivo come fa lib/contenuti.ts, direttamente.
// ---------------------------------------------------------------------------
await base.runAsync(
  `INSERT INTO esercizi (id, tema_slug, tipo, livello, consegna, soluzione_riferimento)
   VALUES ('es-7','sql','query',2,'Conta le righe per cliente','SELECT cliente, count(*) FROM ordini GROUP BY cliente')`
);
const ieri = new Date(Date.now() - 864e5).toISOString();
await base.runAsync(
  `INSERT INTO ripasso (esercizio_id, stabilita, ripetizioni, prossima_revisione, stato)
   VALUES ('es-7', 1.0, 1, ?, 'ripasso')`, [ieri]
);

// Una nota scritta qui, che passa da registra(): e' il CONTROLLO. Se questa non
// si vedesse, il difetto sarebbe altrove e tutta la controprova sarebbe nulla.
await db.registra("note", "locale-1", "crea", { titolo: "Scritta sul tablet" }, async (d, hlc) => {
  await d.runAsync(
    "INSERT INTO note (id, titolo, testo, creato_a, hlc) VALUES (?,?,?,?,?)",
    ["locale-1", "Scritta sul tablet", "", new Date().toISOString(), hlc]
  );
});

// ---------------------------------------------------------------------------
// Lo scambio: il telefono ha lavorato in aereo e manda tre eventi.
// Un'ora di studio, una nota, e un ripasso fatto sull'es-7.
// ---------------------------------------------------------------------------
const ricevuti = [
  {
    id: "0000019a2b3c4d5e-0001-telefono:remota-1",
    hlc: "0000019a2b3c4d5e-0001-telefono",
    dispositivo: "telefono",
    entita: "note",
    entita_id: "remota-1",
    tipo: "crea",
    payload: JSON.stringify({ titolo: "Nota dal telefono", testo: "scritta in volo", pubblicabile: 0 }),
  },
  {
    id: "0000019a2b3c4d5f-0001-telefono:sess-9",
    hlc: "0000019a2b3c4d5f-0001-telefono",
    dispositivo: "telefono",
    entita: "sessioni",
    entita_id: "sess-9",
    tipo: "crea",
    payload: JSON.stringify({ tipo: "studio", minuti: 45 }),
  },
  {
    id: "0000019a2b3c4d60-0001-telefono:es-7",
    hlc: "0000019a2b3c4d60-0001-telefono",
    dispositivo: "telefono",
    entita: "ripasso",
    entita_id: "es-7",
    tipo: "aggiorna",
    payload: JSON.stringify({ grado: 3, stabilita: 6.4 }),
  },
];

// --- copia alla lettera di useAutoSync.ts righe 46-63 ---
const locali = await base.getAllAsync(
  "SELECT id, hlc, dispositivo, entita, entita_id, tipo, payload FROM eventi"
);
const f = fusione.fondi(locali, ricevuti);
await base.withTransactionAsync(async () => {
  for (const e of f.nuovi) {
    await base.runAsync(
      `INSERT OR IGNORE INTO eventi
       (id, hlc, dispositivo, entita, entita_id, tipo, payload, sincronizzato)
       VALUES (?,?,?,?,?,?,?,1)`,
      [e.id, e.hlc, e.dispositivo, e.entita, e.entita_id, e.tipo, e.payload]
    );
  }
});
// --- fine copia ---

console.log("\n1. Lo scambio e' andato a buon fine: quanto e' entrato nel registro?");
const nEventi = await base.getFirstAsync("SELECT count(*) AS n FROM eventi");
verifica("i tre eventi ricevuti sono nel registro eventi", nEventi.n === 4, JSON.stringify(nEventi));
verifica("fondi() aveva anche calcolato le entita toccate", f.entitaToccate.length === 3,
  JSON.stringify(f.entitaToccate));

console.log("\n2. Quello che l'utente VEDE, con le query vere delle schermate.");

// app/(tabs)/note.tsx riga 31-32, verbatim
const elencoNote = await base.getAllAsync("SELECT * FROM note ORDER BY creato_a DESC");
verifica("controllo: la nota scritta sul tablet c'e'",
  elencoNote.some((n) => n.id === "locale-1"), JSON.stringify(elencoNote.map((n) => n.id)));
verifica("[ATTESO-ROSSO-DOPO-LA-CORREZIONE] la nota del telefono NON compare nella schermata Note",
  !elencoNote.some((n) => n.id === "remota-1"), JSON.stringify(elencoNote.map((n) => n.id)));

// app/ripasso.tsx righe 25-28, verbatim: la coda di oggi
const coda = await base.getAllAsync(
  `SELECT e.id, e.consegna, e.soluzione_riferimento, e.fonte_citazione
   FROM ripasso r JOIN esercizi e ON e.id = r.esercizio_id
   WHERE r.prossima_revisione <= ? ORDER BY r.prossima_revisione LIMIT 30`,
  [new Date().toISOString()]
);
verifica("[ATTESO-ROSSO-DOPO-LA-CORREZIONE] es-7, gia' ripassato sul telefono, e' ancora in coda sul tablet",
  coda.some((s) => s.id === "es-7"), JSON.stringify(coda.map((s) => s.id)));
const rip = await base.getFirstAsync("SELECT stabilita, ripetizioni FROM ripasso WHERE esercizio_id='es-7'");
verifica("[ATTESO-ROSSO-DOPO-LA-CORREZIONE] la stabilita non e' avanzata (1.0, non 6.4)",
  rip.stabilita === 1.0 && rip.ripetizioni === 1, JSON.stringify(rip));

// app/(tabs)/oggi.tsx righe 21-28, verbatim (i contatori della schermata di apertura)
const oggi = new Date(); oggi.setHours(0, 0, 0, 0);
const sessioniOggi = await base.getAllAsync(
  "SELECT inizio, minuti, tipo FROM sessioni WHERE inizio >= ?", [oggi.toISOString()]);
verifica("[ATTESO-ROSSO-DOPO-LA-CORREZIONE] i 45 minuti studiati sul telefono non entrano nel totale di Oggi",
  sessioniOggi.length === 0, JSON.stringify(sessioniOggi));

console.log("\n3. Quello che l'app GLI DICE, con le funzioni vere.");
// Il diario che il trasporto file produce quando lo scambio riesce davvero.
const diario = [
  { trasporto: "prossimita", esito: "non disponibile", dettaglio: "modulo nativo non compilato" },
  { trasporto: "wi-fi locale", esito: "non disponibile", dettaglio: "modulo server locale non installato" },
  { trasporto: "file cifrato", esito: "riuscito", dettaglio: "2 inviati, 3 ricevuti in 90 ms" },
];
const frase = trasporto.riassumi(diario);
verifica("l'app dichiara lo scambio riuscito e conta i ricevuti", /riuscit|Sincronizzato via file cifrato/.test(frase) && frase.includes("3 ricevuti"), frase);

// valutaDivergenza() vera, con lo stato subito dopo uno scambio riuscito.
const divergenza = auto.valutaDivergenza({
  inSospeso: 0,
  daUltimoScambioMs: 1000,
  inPrimoPiano: true,
  accoppiato: true,
  inCorso: false,
  fallimentiConsecutivi: 0,
  batteriaBassa: false,
});
verifica("il riquadro della schermata Sync dice 'Allineati' mentre le tabelle non lo sono",
  divergenza.livello === "allineati", JSON.stringify(divergenza));

console.log("\n4. Il danno e' permanente o recuperabile?");
// Una scrittura locale successiva non ricostruisce niente.
await db.registra("note", "locale-2", "crea", { titolo: "Seconda nota" }, async (d, hlc) => {
  await d.runAsync(
    "INSERT INTO note (id, titolo, testo, creato_a, hlc) VALUES (?,?,?,?,?)",
    ["locale-2", "Seconda nota", "", new Date().toISOString(), hlc]);
});
const dopo = await base.getFirstAsync("SELECT count(*) AS n FROM note WHERE id='remota-1'");
verifica("[ATTESO-ROSSO-DOPO-LA-CORREZIONE] una scrittura locale successiva non recupera il ricevuto",
  dopo.n === 0, JSON.stringify(dopo));

// Ma il dato NON e' perso: e' nel registro, e proietta() saprebbe ricavarlo.
const tuttiEventi = await base.getAllAsync(
  "SELECT id, hlc, dispositivo, entita, entita_id, tipo, payload FROM eventi");
const statoNota = fusione.proietta(tuttiEventi, "note", "remota-1");
verifica("il dato ricevuto NON e' perso: proietta() lo ricostruisce dal registro",
  statoNota && statoNota.titolo === "Nota dal telefono", JSON.stringify(statoNota));

// Il ripasso invece e' recuperabile solo in parte: il payload dell'evento
// ripasso non contiene prossima_revisione (app/ripasso.tsx la calcola da
// Date.now()), quindi nemmeno una proiezione corretta potrebbe ricostruire
// quando rivedere la scheda senza rifare il calcolo.
const statoRipasso = fusione.proietta(tuttiEventi, "ripasso", "es-7");
verifica("il payload del ripasso remoto non porta prossima_revisione: la correzione dovra' ricalcolarla",
  statoRipasso !== null && !("prossima_revisione" in statoRipasso), JSON.stringify(statoRipasso));

console.log("\n5. Il ricevuto entra con sincronizzato = 1: il tablet non lo rigira a nessuno.");
const sosp = await base.getFirstAsync(
  "SELECT count(*) AS n FROM eventi WHERE sincronizzato = 0 AND dispositivo = 'telefono'");
verifica("nessun evento del telefono resta in coda di invio sul tablet", sosp.n === 0, JSON.stringify(sosp));

console.log(`\nVerdi: ${verdi}  Rosse: ${rosse}`);
if (rosse) { console.log("Cartella conservata: " + cartella); process.exit(1); }
