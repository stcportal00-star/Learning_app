/**
 * CONTROPROVA AVVERSARIALE (lente: riproducibilita) sul difetto
 * "gli eventi ricevuti non vengono MAI proiettati".
 *
 * Scritta da zero: non importa, non legge e non si fida di nessuna prova
 * scritta dagli altri agenti. Il mio compito e' CONFUTARE il difetto, quindi
 * ogni passaggio e' costruito per dare al codice dell'app la possibilita' di
 * smentirmi:
 *
 *   - gli eventi "remoti" non sono inventati da me: passano dal vero
 *     impacchetta() + cifra() + decifra() di lib/sync/pacchetto.ts, cioe'
 *     esattamente la forma che un trasporto reale consegna a useAutoSync;
 *   - la sequenza applicativa non e' riassunta: e' ricopiata alla lettera da
 *     lib/sync/useAutoSync.ts righe 46-63, e il passo A verifica che la copia
 *     corrisponda ancora al sorgente (se il file cambia, la controprova si
 *     ferma invece di mentire);
 *   - c'e' un controllo POSITIVO (passo C) e una FALSIFICAZIONE (passo F):
 *     se la tabella `note` restasse vuota per colpa del banco o di una mia
 *     query sbagliata, quei due passi diventerebbero rossi per primi.
 *
 * Comando:
 *   node --import ./test/banco/carica.mjs test/simulazione/controprova-2-riproducibilita.mjs
 */
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { configuraCartella } from "../banco/expo-sqlite.mjs";

// ------------------------------------------------------------- verifiche
// Un contatore mio: non voglio dipendere dagli aiutanti di nessun altro,
// altrimenti un difetto del loro aiutante diventerebbe un difetto dell'app.
let verdi = 0;
const rossi = [];
function verifica(descrizione, condizione, dettaglio = "") {
  if (condizione) {
    verdi++;
    console.log(`  ok   ${descrizione}`);
  } else {
    rossi.push(descrizione);
    console.log(`  NO   ${descrizione}${dettaglio ? "  <- " + dettaglio : ""}`);
  }
}

// =========================================================== PASSO A
// Fedelta' della copia. Ricopio una sequenza dal sorgente vero: se domani
// quel sorgente cambia, la mia copia diventa una finzione. Quindi la
// confronto con il file, letteralmente, prima di dedurne qualunque cosa.
console.log("\nA. La sequenza che ricopio e' davvero quella di useAutoSync.ts");
const sorgenteHook = readFileSync(
  new URL("../../lib/sync/useAutoSync.ts", import.meta.url),
  "utf8"
);
const righeHook = sorgenteHook.split("\n");
// Le righe 46-63 del file sono il blocco "applica quello che ho ricevuto".
const bloccoApplicazione = righeHook.slice(45, 63).join("\n");

verifica(
  "il blocco 46-63 legge tutti gli eventi locali",
  bloccoApplicazione.includes(
    "SELECT id, hlc, dispositivo, entita, entita_id, tipo, payload FROM eventi"
  )
);
verifica(
  "il blocco 46-63 chiama fondi(locali, r.esito.ricevuti)",
  bloccoApplicazione.includes("fondi(locali, r.esito.ricevuti)")
);
verifica(
  "il blocco 46-63 inserisce con INSERT OR IGNORE dentro withTransactionAsync",
  bloccoApplicazione.includes("withTransactionAsync") &&
    bloccoApplicazione.includes("INSERT OR IGNORE INTO eventi")
);
// Il cuore della questione: nel blocco che applica non c'e' nessuna
// proiezione. Lo verifico sul testo, non a memoria.
verifica(
  "nel blocco 46-63 NON compare alcuna proiezione (proietta/entitaToccate)",
  !bloccoApplicazione.includes("proietta") &&
    !bloccoApplicazione.includes("entitaToccate")
);
verifica(
  "in TUTTO useAutoSync.ts non compare mai proietta(), registra() ne' entitaToccate",
  !/\bproietta\s*\(/.test(sorgenteHook) &&
    !/\bregistra\s*\(/.test(sorgenteHook) &&
    !sorgenteHook.includes("entitaToccate")
);
// Ultima via di fuga per il codice: qualcuno, da qualche altra parte,
// potrebbe riproiettare dopo lo scambio. Se esistesse, il difetto sarebbe
// confutato. La cerco nell'intero albero delle sorgenti.
const { execFileSync } = await import("node:child_process");
const radice = new URL("../../", import.meta.url).pathname;
function cercaSorgenti(espressione) {
  try {
    return execFileSync(
      "grep",
      ["-rn", "--include=*.ts", "--include=*.tsx", "-E", espressione, "lib", "app", "components", "plugins"],
      { cwd: radice, encoding: "utf8" }
    )
      .trim()
      .split("\n")
      .filter(Boolean);
  } catch {
    return []; // grep esce 1 quando non trova nulla
  }
}
const chiamantiProietta = cercaSorgenti("\\bproietta\\s*\\(").filter(
  (r) => !r.startsWith("lib/sync/fusione.ts")
);
const lettoriEntitaToccate = cercaSorgenti("entitaToccate").filter(
  (r) => !r.startsWith("lib/sync/fusione.ts")
);
verifica(
  "nessun chiamante di proietta() fuori da fusione.ts (dove e' solo definita)",
  chiamantiProietta.length === 0,
  chiamantiProietta.join(" | ")
);
verifica(
  "nessun lettore di entitaToccate fuori da fusione.ts",
  lettoriEntitaToccate.length === 0,
  lettoriEntitaToccate.join(" | ")
);

// =========================================================== PASSO B
// Banco. Cartella tutta mia: altri agenti girano in parallelo e non voglio
// che un percorso.db condiviso spieghi un risultato al posto del codice.
console.log("\nB. Preparazione del banco");
const cartella = configuraCartella(
  mkdtempSync(join(tmpdir(), "controprova-2-riproducibilita-"))
);

const db = await import("../../lib/db.ts");
const fusione = await import("../../lib/sync/fusione.ts");
const pacchetto = await import("../../lib/sync/pacchetto.ts");
const hlcMod = await import("../../lib/hlc.ts");

await db.apri("dispositivo-locale-A");
const base = db.database();
verifica("database aperto", Boolean(base));

// =========================================================== PASSO C
// CONTROLLO POSITIVO. Una nota scritta in locale come fa la schermata
// (app/(tabs)/note.tsx: registra() + INSERT INTO note nella proiezione)
// DEVE comparire nella tabella operativa. Se questo passo fosse rosso, il
// vuoto del passo E non direbbe niente sul codice: direbbe che ho sbagliato
// io il banco o la query.
console.log("\nC. Controllo positivo: la scrittura LOCALE arriva nella tabella note");
const creatoA = new Date().toISOString();
await db.registra(
  "note",
  "locale-1",
  "crea",
  { titolo: "Nota scritta qui", testo: "corpo locale", pubblicabile: 0 },
  async (d, hlc) => {
    await d.runAsync(
      `INSERT INTO note (id, titolo, testo, pubblicabile, creato_a, hlc) VALUES (?,?,?,?,?,?)`,
      ["locale-1", "Nota scritta qui", "corpo locale", 0, creatoA, hlc]
    );
  }
);
// La query e' quella vera della schermata note.tsx, non una mia variante.
const elencoDopoLocale = await base.getAllAsync(
  "SELECT * FROM note ORDER BY creato_a DESC"
);
verifica(
  "la nota locale e' visibile con la query della schermata",
  elencoDopoLocale.length === 1 && elencoDopoLocale[0].id === "locale-1"
);

// =========================================================== PASSO D
// Il percorso remoto, costruito con il codice vero del trasporto.
// Gli eventi "ricevuti" non li scrivo a mano: li faccio uscire da
// impacchetta() -> cifra() -> decifra(), cioe' dallo stesso codice che gira
// sul telefono. Cosi' nessuno puo' dirmi che ho inventato una forma di dato
// che l'app non riceverebbe mai.
console.log("\nD. Ricezione di eventi remoti attraverso il vero pacchetto cifrato");
const orologioRemoto = new hlcMod.Orologio("telefono-remoto-B");
function eventoRemoto(entita, entitaId, tipo, payload) {
  // L'id e' composto come lo compone lib/db.ts sull'altro dispositivo:
  // hlc + ":" + entita_id. Riprodurre la convenzione conta, perche' la
  // deduplicazione di fondi() lavora proprio sugli id.
  const h = hlcMod.serializza(orologioRemoto.adesso(Date.now() + 5_000));
  return {
    id: h + ":" + entitaId,
    hlc: h,
    dispositivo: "telefono-remoto-B",
    entita,
    entita_id: entitaId,
    tipo,
    payload: JSON.stringify(payload),
  };
}

const eventiDalTelefono = [
  // Lo scenario del difetto, parola per parola.
  eventoRemoto("note", "remota-1", "crea", { titolo: "Nota dal telefono" }),
  // Un aggiornamento remoto di una nota che qui esiste gia': se la fusione
  // producesse qualcosa di visibile, il titolo locale cambierebbe.
  eventoRemoto("note", "locale-1", "aggiorna", {
    titolo: "Titolo corretto sull'altro dispositivo",
  }),
  // La conseguenza citata nello scenario: un ripasso gia' fatto altrove.
  eventoRemoto("ripasso", "es-sql-01", "aggiorna", { grado: 3, stabilita: 4.2 }),
];

const involucro = await pacchetto.cifra(
  pacchetto.impacchetta("telefono-remoto-B", eventiDalTelefono),
  "passphrase-di-prova"
);
const aperto = await pacchetto.decifra(involucro, "passphrase-di-prova");
const ricevuti = aperto.eventi;
verifica(
  "il pacchetto cifrato vero restituisce i 3 eventi remoti",
  ricevuti.length === 3
);

// --- COPIA LETTERALE di lib/sync/useAutoSync.ts righe 46-63 ---------------
// (il passo A ha appena verificato che questo e' ancora il sorgente vero)
const d = db.database();
const locali = await d.getAllAsync(
  "SELECT id, hlc, dispositivo, entita, entita_id, tipo, payload FROM eventi"
);
const f = fusione.fondi(locali, ricevuti);
await d.withTransactionAsync(async () => {
  for (const e of f.nuovi) {
    await d.runAsync(
      `INSERT OR IGNORE INTO eventi
       (id, hlc, dispositivo, entita, entita_id, tipo, payload, sincronizzato)
       VALUES (?,?,?,?,?,?,?,1)`,
      [e.id, e.hlc, e.dispositivo, e.entita, e.entita_id, e.tipo, e.payload]
    );
  }
});
// --- fine della copia -----------------------------------------------------

// =========================================================== PASSO E
// Cosa e' rimasto sul disco dopo lo scambio.
console.log("\nE. Dopo lo scambio: registro pieno, tabelle operative ferme");
const eventiRemotiInRegistro = await base.getFirstAsync(
  "SELECT count(*) AS n FROM eventi WHERE dispositivo = 'telefono-remoto-B'"
);
verifica(
  "i 3 eventi remoti SONO nel registro eventi",
  eventiRemotiInRegistro.n === 3,
  `trovati ${eventiRemotiInRegistro?.n}`
);

const notaRemota = await base.getFirstAsync(
  "SELECT count(*) AS n FROM note WHERE id = 'remota-1'"
);
verifica(
  "la nota ricevuta NON esiste nella tabella note (il difetto)",
  notaRemota.n === 0,
  `trovate ${notaRemota?.n} righe`
);

const elencoSchermata = await base.getAllAsync(
  "SELECT * FROM note ORDER BY creato_a DESC"
);
verifica(
  "la schermata Note continua a vedere solo la nota locale",
  elencoSchermata.length === 1 && elencoSchermata[0].id === "locale-1"
);

const notaAggiornata = await base.getFirstAsync(
  "SELECT titolo FROM note WHERE id = 'locale-1'"
);
verifica(
  "anche l'AGGIORNAMENTO remoto e' perso: il titolo locale non cambia",
  notaAggiornata.titolo === "Nota scritta qui",
  `titolo attuale: ${notaAggiornata?.titolo}`
);

// La riga di ripasso qui non esiste nemmeno (il catalogo non e' caricato):
// verifico allora la forma piu' forte, cioe' che lo scambio non abbia
// scritto NULLA in nessuna tabella operativa toccata dagli eventi remoti.
const righeRipasso = await base.getFirstAsync(
  "SELECT count(*) AS n FROM ripasso WHERE esercizio_id = 'es-sql-01'"
);
verifica(
  "nessuna riga di ripasso creata o aggiornata dallo scambio",
  righeRipasso.n === 0
);

// L'informazione per proiettare c'era, ed e' stata buttata via.
verifica(
  "fondi() aveva calcolato entitaToccate per tutte e 3 le entita'",
  f.entitaToccate.length === 3,
  JSON.stringify(f.entitaToccate)
);
const tuttiEventi = await base.getAllAsync(
  "SELECT id, hlc, dispositivo, entita, entita_id, tipo, payload FROM eventi"
);
const statoRicostruito = fusione.proietta(tuttiEventi, "note", "remota-1");
verifica(
  "proietta() saprebbe ricostruire la nota remota, ma nessuno la chiama",
  statoRicostruito && statoRicostruito.titolo === "Nota dal telefono",
  JSON.stringify(statoRicostruito)
);

// =========================================================== PASSO F
// FALSIFICAZIONE. Se la tabella `note` fosse vuota per un motivo mio
// (nome di tabella sbagliato, transazione non confermata, banco rotto),
// nemmeno una INSERT esplicita la riempirebbe. La faccio: se dopo questa la
// nota compare, l'unica differenza rispetto al passo E e' la proiezione
// mancante. E' il controllo che rende la diagnosi non falsificabile a meta'.
console.log("\nF. Falsificazione: aggiungo a mano la proiezione che manca");
const statoDaProiettare = fusione.proietta(tuttiEventi, "note", "remota-1");
await base.runAsync(
  `INSERT INTO note (id, titolo, testo, pubblicabile, creato_a, hlc) VALUES (?,?,?,?,?,?)`,
  [
    "remota-1",
    statoDaProiettare.titolo,
    "",
    0,
    new Date().toISOString(),
    ricevuti[0].hlc,
  ]
);
const dopoProiezioneManuale = await base.getFirstAsync(
  "SELECT titolo FROM note WHERE id = 'remota-1'"
);
verifica(
  "con la proiezione la nota compare: il vuoto del passo E e' sua e solo sua",
  dopoProiezioneManuale && dopoProiezioneManuale.titolo === "Nota dal telefono"
);

// =========================================================== esito
console.log(
  `\nverdi: ${verdi}   rossi: ${rossi.length}` +
    (rossi.length ? "\n  " + rossi.join("\n  ") : "")
);
console.log(`cartella di lavoro: ${cartella}`);
process.exit(rossi.length ? 1 : 0);
