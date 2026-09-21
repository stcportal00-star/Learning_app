/**
 * Controprova avversariale: "gli eventi ricevuti non vengono mai proiettati".
 *
 * Perché questo file esiste: prima di mandare qualcuno a correggere
 * lib/sync/useAutoSync.ts bisogna dimostrare sul codice VERO che la sequenza
 * di applicazione dei ricevuti lascia le tabelle operative vuote. Qui la
 * sequenza delle righe 46-63 dell'hook e' ricopiata alla lettera (l'hook non e'
 * importabile: e' un modulo React) e usa il vero fondi() di lib/sync/fusione.ts
 * e il vero database aperto da lib/db.ts.
 */
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { configuraCartella } from "../banco/expo-sqlite.mjs";

const cartella = configuraCartella(mkdtempSync(join(tmpdir(), "controprova-2-")));

let verdi = 0;
let rosse = 0;
function verifica(nome, condizione, dettaglio = "") {
  if (condizione) { verdi++; console.log("  ok   " + nome); }
  else { rosse++; console.log("  ROSSA " + nome + (dettaglio ? " -> " + dettaglio : "")); }
}

const db = await import("../../lib/db.ts");
const fusione = await import("../../lib/sync/fusione.ts");

await db.apri("locale-a");
const base = db.database();

// 1. Percorso LOCALE: passa da registra(), quindi proietta. Serve da controllo:
//    se questo fosse rosso il difetto sarebbe altrove e la controprova nulla.
await db.registra("note", "locale-1", "crea", { titolo: "Nota scritta qui" }, async (d, hlc) => {
  await d.runAsync(
    "INSERT INTO note (id, titolo, testo, creato_a, hlc) VALUES (?,?,?,?,?)",
    ["locale-1", "Nota scritta qui", "", new Date().toISOString(), hlc]
  );
});
const notaLocale = await base.getFirstAsync("SELECT titolo FROM note WHERE id = 'locale-1'");
verifica("controllo: la nota scritta in locale e' visibile nella tabella note",
  notaLocale && notaLocale.titolo === "Nota scritta qui", JSON.stringify(notaLocale));

// 2. Percorso REMOTO: la sequenza dell'hook, righe 46-63, ricopiata.
const ricevuti = [
  {
    id: "0000019a2b3c4d5e-0001-telefono:remota-1",
    hlc: "0000019a2b3c4d5e-0001-telefono",
    dispositivo: "telefono",
    entita: "note",
    entita_id: "remota-1",
    tipo: "crea",
    payload: JSON.stringify({ titolo: "Nota dal telefono", testo: "scritta sull'altro dispositivo" }),
  },
  {
    id: "0000019a2b3c4d5f-0001-telefono:esercizio-7",
    hlc: "0000019a2b3c4d5f-0001-telefono",
    dispositivo: "telefono",
    entita: "ripasso",
    entita_id: "esercizio-7",
    tipo: "aggiorna",
    payload: JSON.stringify({ stabilita: 9.5, prossima_revisione: "2026-12-01", stato: "ripassato" }),
  },
];

const locali = await base.getAllAsync(
  "SELECT id, hlc, dispositivo, entita, entita_id, tipo, payload FROM eventi"
);
const f = fusione.fondi(locali, ricevuti);
verifica("fondi() considera nuovi entrambi gli eventi ricevuti", f.nuovi.length === 2, String(f.nuovi.length));
verifica("fondi() calcola entitaToccate (due entita')", f.entitaToccate.length === 2, JSON.stringify(f.entitaToccate));

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

// 3. Le due domande che decidono la controprova.
const eventiRemoti = await base.getFirstAsync(
  "SELECT count(*) AS n FROM eventi WHERE entita_id = 'remota-1'");
const righeNote = await base.getFirstAsync(
  "SELECT count(*) AS n FROM note WHERE id = 'remota-1'");
const righeRipasso = await base.getFirstAsync(
  "SELECT count(*) AS n FROM ripasso WHERE esercizio_id = 'esercizio-7'");

verifica("l'evento ricevuto E' nel registro", eventiRemoti.n === 1, JSON.stringify(eventiRemoti));
verifica("DIFETTO: la tabella note NON contiene la nota ricevuta", righeNote.n === 0, JSON.stringify(righeNote));
verifica("DIFETTO: la tabella ripasso NON contiene la scheda ricevuta", righeRipasso.n === 0, JSON.stringify(righeRipasso));

// 4. Il dato non e' perduto: e' nel registro. proietta() lo ricostruisce, ma
//    nessuno in lib/ o app/ la chiama. Questo separa "dato perso" da "dato invisibile".
const tuttiEventi = await base.getAllAsync(
  "SELECT id, hlc, dispositivo, entita, entita_id, tipo, payload FROM eventi");
const stato = fusione.proietta(tuttiEventi, "note", "remota-1");
verifica("proietta() ricostruisce la nota dal registro (il dato c'e', e' solo invisibile)",
  stato && stato.titolo === "Nota dal telefono", JSON.stringify(stato));

// 5. Quello che vede la schermata note (app/(tabs)/note.tsx riga 32, query identica).
const elenco = await base.getAllAsync("SELECT * FROM note ORDER BY creato_a DESC");
verifica("la query della schermata note restituisce SOLO la nota locale",
  elenco.length === 1 && elenco[0].id === "locale-1", JSON.stringify(elenco.map((n) => n.id)));

console.log(`\nverdi ${verdi} · rosse ${rosse}`);
if (rosse) console.log("cartella conservata: " + cartella);
process.exit(rosse ? 1 : 0);
