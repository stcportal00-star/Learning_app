/**
 * Controprova HLC-07 — lente "riproducibilita".
 *
 * Difetto sotto esame: se la riga meta('hlc') contiene un valore non
 * interpretabile, apri() semina l'Orologio con NaN, i timbri diventano
 * '000000000NaN-0NaN-<dispositivo>' e la seconda scrittura sulla stessa
 * entita' viola la chiave primaria di `eventi`; il riavvio non guarisce.
 *
 * Perche' questo file esiste e non riusa il collaudo dell'altro agente: un
 * difetto va creduto solo se si riproduce due volte per strade indipendenti.
 * Qui non si importa ne' si legge nessun file di simulazione altrui: si usa
 * soltanto il banco (test/banco/) e il codice VERO di lib/db.ts e lib/hlc.ts.
 *
 * Si esegue dalla radice del progetto:
 *   node --import ./test/banco/carica.mjs \
 *        test/simulazione/controprova-HLC-07-riproducibilita.mjs
 *
 * Il verdetto si legge SEMPRE da fuori dal banco: una seconda connessione
 * node:sqlite aperta sul file. Se leggessimo con la stessa connessione che ha
 * scritto, staremmo chiedendo all'imputato di testimoniare per se'.
 */
import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { configuraCartella } from "../banco/expo-sqlite.mjs";

const RADICE = resolve(import.meta.dirname, "..", "..");

let passati = 0;
const falliti = [];
function ok(nome, condizione, extra = "") {
  if (condizione) {
    passati++;
    console.log(`  ok   ${nome}${extra ? " — " + extra : ""}`);
  } else {
    falliti.push(`${nome}${extra ? " — " + extra : ""}`);
    console.log(`  NO   ${nome}${extra ? " — " + extra : ""}`);
  }
}

/**
 * Riavvio dell'app. Un'istanza nuova del modulo lib/db.ts: la query serve solo
 * a far ricaricare il modulo a Node, perche' `db` e `orologio` sono variabili
 * di modulo e apri() esce subito se `db` e' gia' valorizzato. Senza istanza
 * nuova non si puo' collaudare la SEMINA dell'orologio da meta, che avviene
 * una sola volta per processo.
 */
function riavvia(numero) {
  return import(pathToFileURL(resolve(RADICE, "lib/db.ts")).href + "?riavvio=" + numero);
}

/** Verdetto da fuori dal banco: connessione indipendente sullo stesso file. */
function daFuori(percorso, sql, parametri = []) {
  const connessione = new DatabaseSync(percorso);
  try {
    return connessione.prepare(sql).all(...parametri);
  } finally {
    connessione.close();
  }
}

function scriviDaFuori(percorso, sql, parametri = []) {
  const connessione = new DatabaseSync(percorso);
  try {
    connessione.prepare(sql).run(...parametri);
  } finally {
    connessione.close();
  }
}

/** Una nota qualunque: proiezione minima, serve solo ad avere una scrittura vera. */
function proiezioneNota(id, testo) {
  return async (d, hlc) =>
    d.runAsync(
      `INSERT INTO note (id, titolo, testo, creato_a, hlc) VALUES (?,?,?,?,?)
       ON CONFLICT (id) DO UPDATE SET testo = excluded.testo, hlc = excluded.hlc`,
      [id, "nota", testo, new Date().toISOString(), hlc]
    );
}

async function provaScrittura(modulo, entitaId, testo) {
  try {
    const hlc = await modulo.registra(
      "note", entitaId, "aggiorna", { testo }, proiezioneNota(entitaId, testo)
    );
    return { riuscita: true, hlc };
  } catch (errore) {
    return { riuscita: false, errore: String(errore?.message ?? errore) };
  }
}

// ====================================================== SCENARIO A: meta vuoto
const cartellaA = configuraCartella(mkdtempSync(join(tmpdir(), "controprova-hlc07-A-")));
const fileA = join(cartellaA, "percorso.db");

console.log("\nA. meta('hlc') svuotato da una corruzione esterna\n");

// --- A0. Prima l'uso normale, per avere una misura di riferimento.
const primo = await riavvia(1);
await primo.apri("dispositivo-alfa");
const base1 = await provaScrittura(primo, "nota-1", "primo testo");
const base2 = await provaScrittura(primo, "nota-1", "secondo testo");
ok("A0 uso normale: due scritture sulla stessa entita' riescono",
   base1.riuscita && base2.riuscita,
   `${base1.hlc} / ${base2.hlc ?? base2.errore}`);
ok("A0 i due timbri sono diversi e non contengono NaN",
   base1.hlc !== base2.hlc && !base1.hlc.includes("NaN") && !base2.hlc.includes("NaN"));

const metaSana = daFuori(fileA, "SELECT valore FROM meta WHERE chiave = 'hlc'")[0];
ok("A0 meta('hlc') e' rileggibile", /^[0-9a-f]+-[0-9a-f]+$/.test(metaSana.valore), metaSana.valore);

// Si chiude la connessione: cosi' il riavvio successivo ne apre una nuova,
// come farebbe l'app dopo essere stata chiusa dal sistema.
await primo.database().closeAsync();

// --- A1. La corruzione. Non la produce l'app: la produciamo noi da fuori,
// esattamente come la descrive lo scenario ("valore vuoto").
scriviDaFuori(fileA, "UPDATE meta SET valore = '' WHERE chiave = 'hlc'");
ok("A1 meta('hlc') ora e' vuoto",
   daFuori(fileA, "SELECT valore FROM meta WHERE chiave = 'hlc'")[0].valore === "");

// --- A2. Riavvio con la riga corrotta.
const secondo = await riavvia(2);
await secondo.apri("dispositivo-alfa");
const dopo1 = await provaScrittura(secondo, "nota-2", "dopo la corruzione");
ok("A2 il primo timbro dopo il riavvio e' NaN",
   dopo1.riuscita && dopo1.hlc === "000000000NaN-0NaN-dispositivo-alfa",
   dopo1.hlc ?? dopo1.errore);

// --- A3. Seconda scrittura sulla STESSA entita'.
const dopo2 = await provaScrittura(secondo, "nota-2", "seconda scrittura");
ok("A3 la seconda scrittura sulla stessa entita' fallisce",
   !dopo2.riuscita, dopo2.errore ?? dopo2.hlc);
ok("A3 fallisce per violazione della chiave primaria di eventi",
   !dopo2.riuscita && /UNIQUE|PRIMARY|constraint/i.test(dopo2.errore ?? ""), dopo2.errore ?? "");

// Il verdetto vero: cosa c'e' sul disco. La transazione deve aver fatto
// ROLLBACK, quindi un solo evento e la nota ferma al primo testo.
const eventiNota2 = daFuori(fileA,
  "SELECT id, hlc FROM eventi WHERE entita_id = 'nota-2' ORDER BY rowid");
const testoNota2 = daFuori(fileA, "SELECT testo FROM note WHERE id = 'nota-2'");
ok("A3 sul disco resta un solo evento per quell'entita'", eventiNota2.length === 1,
   JSON.stringify(eventiNota2));
// La proiezione e' tornata indietro con la transazione: sulla nota resta il
// testo della PRIMA scrittura, la seconda e' andata perduta con un errore.
ok("A3 la seconda modifica e' persa: la nota resta al testo precedente",
   testoNota2[0]?.testo === "dopo la corruzione", testoNota2[0]?.testo);

// --- A4. Quanto e' largo il danno: un'altra entita'.
const altra1 = await provaScrittura(secondo, "nota-3", "altra entita'");
const altra2 = await provaScrittura(secondo, "nota-3", "altra entita' bis");
ok("A4 su un'entita' MAI scritta la prima volta passa ancora", altra1.riuscita,
   altra1.hlc ?? altra1.errore);
ok("A4 ma la seconda no: ogni entita' resta a un solo evento per sempre",
   !altra2.riuscita, altra2.errore ?? altra2.hlc);

// --- A5. Il riavvio non guarisce.
const metaDopo = daFuori(fileA, "SELECT valore FROM meta WHERE chiave = 'hlc'")[0];
ok("A5 in meta e' stato riscritto NaN-NaN", metaDopo.valore === "NaN-NaN", metaDopo.valore);
await secondo.database().closeAsync();

const terzo = await riavvia(3);
await terzo.apri("dispositivo-alfa");
const dopoRiavvio = await provaScrittura(terzo, "nota-4", "dopo il secondo riavvio");
ok("A5 dopo un secondo riavvio il timbro e' ancora NaN",
   dopoRiavvio.riuscita && dopoRiavvio.hlc === "000000000NaN-0NaN-dispositivo-alfa",
   dopoRiavvio.hlc ?? dopoRiavvio.errore);
const dopoRiavvio2 = await provaScrittura(terzo, "nota-4", "e ancora");
ok("A5 e la seconda scrittura fallisce di nuovo", !dopoRiavvio2.riuscita,
   dopoRiavvio2.errore ?? dopoRiavvio2.hlc);

// --- A6. Ordinamento del registro: i timbri NaN finiscono in testa.
const ordine = daFuori(fileA, "SELECT hlc FROM eventi ORDER BY hlc LIMIT 1")[0];
ok("A6 i timbri NaN si ordinano PRIMA di quelli veri (ORDER BY hlc)",
   ordine.hlc.includes("NaN"), ordine.hlc);

await terzo.database().closeAsync();

// =============================================== SCENARIO B: meta = 'zz-1'
// Lo scenario del difetto cita 'zz-1' come secondo esempio. Va misurato a
// parte: 'zz-1' si spezza in due, quindi il contatore NON e' NaN.
const cartellaB = configuraCartella(mkdtempSync(join(tmpdir(), "controprova-hlc07-B-")));
const fileB = join(cartellaB, "percorso.db");

console.log("\nB. meta('hlc') = 'zz-1'\n");

const quarto = await riavvia(4);
await quarto.apri("dispositivo-beta");
await provaScrittura(quarto, "nota-b", "seme");
await quarto.database().closeAsync();
scriviDaFuori(fileB, "UPDATE meta SET valore = 'zz-1' WHERE chiave = 'hlc'");

const quinto = await riavvia(5);
await quinto.apri("dispositivo-beta");
const b1 = await provaScrittura(quinto, "nota-b2", "prima");
const b2 = await provaScrittura(quinto, "nota-b2", "seconda");
ok("B1 il timbro ha il tempo fisico NaN",
   (b1.hlc ?? "").startsWith("000000000NaN-"), b1.hlc ?? b1.errore);
ok("B2 ma il contatore avanza, quindi NON c'e' violazione di chiave",
   b1.riuscita && b2.riuscita && b1.hlc !== b2.hlc, `${b1.hlc} / ${b2.hlc ?? b2.errore}`);
await quinto.database().closeAsync();

// ================================================================ ESITO
rmSync(cartellaA, { recursive: true, force: true });
rmSync(cartellaB, { recursive: true, force: true });

console.log(`\nPassati: ${passati}   Falliti: ${falliti.length}`);
for (const f of falliti) console.log("  - " + f);
process.exit(falliti.length ? 1 : 0);
