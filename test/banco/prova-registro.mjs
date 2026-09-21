/**
 * Prova del CANCELLO: il registro eventi dell'app (lib/db.ts, il file vero)
 * sopra il banco, con l'invariante 1 del progetto messa alla frusta.
 *
 * Si esegue dalla radice del progetto, in uno dei due modi (equivalenti):
 *
 *   node test/banco/prova-registro.mjs
 *   node --import ./test/banco/carica.mjs test/banco/prova-registro.mjs
 *
 * Il primo modo basta perché importare carica.mjs registra i ganci del banco
 * prima che il corpo di questo file giri; il codice dell'app viene poi caricato
 * con import DINAMICO, che è la regola del banco (un import statico verrebbe
 * risolto prima dei ganci).
 *
 * Perché questa prova esiste e non basta prova-banco.mjs: là si verifica che il
 * doppio sia SQLite vero; qui si verifica la sola cosa su cui poggia tutto il
 * resto del progetto — che registra() sia ATOMICA. Se il rollback non reggesse,
 * ogni prova costruita su questo banco direbbe di sì a un'app che in mano
 * all'utente lascerebbe eventi senza proiezione (o viceversa): il registro
 * smetterebbe di essere la fonte di verità e la fusione fra due dispositivi
 * ricostruirebbe uno stato che sul telefono non è mai esistito.
 *
 * Quattro parti:
 *   A. apertura e migrazioni attraverso lib/db.ts;
 *   B. registra() per i TRE tipi di evento ('crea', 'aggiorna', 'elimina'),
 *      con le stesse proiezioni delle schermate vere — evento in tabella E
 *      proiezione applicata;
 *   C. l'invariante: la proiezione lancia A METÀ e non deve restare NIENTE,
 *      né l'evento né le righe già scritte. Cinque modi di fallire.
 *   D. la transazione è vera anche fuori dalla connessione dell'app: una
 *      seconda connessione allo stesso file non vede mai lo stato intermedio.
 *
 * Non tocca nulla del progetto: lavora in una cartella temporanea.
 *
 * COME VERIFICARE CHE QUESTA PROVA NON SIA UN TIMBRO. Una prova che non puo'
 * diventare rossa non dimostra niente. Si toglie il ROLLBACK alla stessa
 * istanza del doppio che vede l'app e si riesegue: devono cadere le verifiche
 * della parte C (fatto: 18 rosse su 63, uscita 1).
 *
 *   // falsificazione.mjs, in una cartella qualsiasi FUORI dal progetto
 *   import "/home/user/learning_app/test/banco/carica.mjs";
 *   import { BaseDatiDoppia } from "/home/user/learning_app/test/banco/expo-sqlite.mjs";
 *   BaseDatiDoppia.prototype.withTransactionAsync = async function (compito) {
 *     await this.execAsync("BEGIN");
 *     try { await compito(); } catch (e) { await this.execAsync("COMMIT"); throw e; }
 *     await this.execAsync("COMMIT");
 *   };
 *   await import("/home/user/learning_app/test/banco/prova-registro.mjs");
 *
 * Togliendo invece anche il BEGIN (proiezione eseguita senza transazione)
 * cadono pure "la proiezione gira DENTRO la transazione" e la spia della
 * parte D: 20 rosse. Le due falsificazioni insieme dicono che sono le
 * transazioni a far passare questa prova, non la compiacenza del doppio.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
// L'ordine conta: carica.mjs per primo, perché registra i ganci.
import "./carica.mjs";
import { configuraCartella, openDatabaseSync } from "./expo-sqlite.mjs";

// ------------------------------------------------------------------ CONTEGGIO
let passati = 0;
const falliti = [];
function ok(nome, condizione, extra = "") {
  if (condizione) passati++;
  else falliti.push(`${nome}${extra ? " — " + extra : ""}`);
}
async function lancia(nome, azione, frammentoAtteso) {
  try {
    await azione();
    falliti.push(`${nome} — non ha lanciato nessun errore`);
    return null;
  } catch (errore) {
    const messaggio = String(errore?.message ?? errore);
    ok(nome, messaggio.includes(frammentoAtteso), messaggio);
    return messaggio;
  }
}

// Cartella temporanea per processo: due agenti in parallelo non si pestano i
// piedi e nessun percorso.db sopravvive alla prova.
const cartella = configuraCartella(mkdtempSync(join(tmpdir(), "prova-registro-")));

// ================================================================== PARTE A
// lib/db.ts vero, compilato al volo, con expo-sqlite sostituito dal doppio.
const app = await import("../../lib/db.ts");

ok("lib/db.ts esporta registra()", typeof app.registra === "function");
await lancia(
  "prima di apri() il registro rifiuta di scrivere",
  () => app.registra("note", "x", "crea", {}, async () => {}),
  "Database non aperto"
);

const DISPOSITIVO = "banco-cancello";
await app.apri(DISPOSITIVO);
const base = app.database();

ok(
  "apri() ha portato lo schema alla versione attesa",
  (await base.getFirstAsync("PRAGMA user_version"))?.user_version === app.SCHEMA_VERSIONE
);
const modo = (await base.getFirstAsync("PRAGMA journal_mode"))?.journal_mode;
ok("il file dell'app è in WAL (come sul telefono)", modo === "wal", String(modo));

// Scorciatoie di lettura: contare è il modo più onesto di dire "non è rimasto
// niente", perché non dipende da quale riga si va a cercare.
const conta = async (tabella, dove = "") =>
  (await base.getFirstAsync(`SELECT COUNT(*) AS n FROM ${tabella} ${dove}`)).n;
const orologioSalvato = async () =>
  (await base.getFirstAsync("SELECT valore FROM meta WHERE chiave = 'hlc'"))?.valore ?? null;

// ================================================================== PARTE B
// Tre tipi di evento, tre entità, le proiezioni delle schermate vere.
const adesso = new Date().toISOString();

// --- 'crea' su sessioni: è ciò che fa components/Cronometro.tsx a fine sessione.
const hlcSessione = await app.registra(
  "sessioni",
  "ses-1",
  "crea",
  { tipo: "studio", minuti: 25 },
  async (d, hlc) => {
    ok("la proiezione gira DENTRO la transazione", await d.isInTransactionAsync());
    await d.runAsync("INSERT INTO sessioni (id, tipo, inizio, minuti, hlc) VALUES (?,?,?,?,?)", [
      "ses-1",
      "studio",
      adesso,
      25,
      hlc,
    ]);
  }
);
ok("crea: l'evento è nella tabella eventi", (await conta("eventi", "WHERE entita_id = 'ses-1'")) === 1);
ok("crea: la proiezione è applicata", (await conta("sessioni", "WHERE id = 'ses-1'")) === 1);

const eventoSessione = await base.getFirstAsync(
  "SELECT id, hlc, dispositivo, entita, tipo, payload, sincronizzato FROM eventi WHERE entita_id = 'ses-1'"
);
ok("crea: l'id dell'evento è <hlc>:<entita_id>", eventoSessione.id === hlcSessione + ":ses-1", eventoSessione.id);
ok("crea: l'evento porta il dispositivo", eventoSessione.dispositivo === DISPOSITIVO);
ok("crea: il payload torna indietro intero", JSON.parse(eventoSessione.payload).minuti === 25);
ok("crea: l'evento nasce non sincronizzato", eventoSessione.sincronizzato === 0);
ok(
  "crea: la riga proiettata porta lo stesso hlc dell'evento",
  (await base.getFirstAsync("SELECT hlc FROM sessioni WHERE id = 'ses-1'")).hlc === eventoSessione.hlc
);
ok("crea: l'orologio è stato salvato in meta", typeof (await orologioSalvato()) === "string");

// --- 'crea' su biblioteca: lib/palestra.ts importaVolume().
await app.registra("biblioteca", "vol-1", "crea", { titolo: "Manuale SQL" }, async (d, hlc) => {
  await d.runAsync(
    `INSERT INTO biblioteca (id, titolo, autore, origine, formato, ultima_pagina, aggiunto_a, hlc)
     VALUES (?,?,?,?,?,0,?,?)`,
    ["vol-1", "Manuale SQL", "Ignoto", "manuale", "pdf", adesso, hlc]
  );
});
ok("crea: il secondo evento si aggiunge, non sostituisce", (await conta("eventi")) === 2);

// --- 'aggiorna' su biblioteca: lib/palestra.ts salvaPagina(), la pagina che
// viaggia nel registro per riprendere la lettura sull'altro dispositivo.
await app.registra("biblioteca", "vol-1", "aggiorna", { ultima_pagina: 42 }, async (d, hlc) => {
  await d.runAsync("UPDATE biblioteca SET ultima_pagina = ?, hlc = ? WHERE id = ?", [42, hlc, "vol-1"]);
});
ok(
  "aggiorna: l'evento è nella tabella eventi",
  (await conta("eventi", "WHERE entita_id = 'vol-1' AND tipo = 'aggiorna'")) === 1
);
ok(
  "aggiorna: la proiezione ha cambiato la riga",
  (await base.getFirstAsync("SELECT ultima_pagina FROM biblioteca WHERE id = 'vol-1'")).ultima_pagina === 42
);
ok("aggiorna: la riga resta una sola", (await conta("biblioteca")) === 1);

// --- 'aggiorna' su ripasso: app/ripasso.tsx valuta(). La riga esiste già,
// come dopo un'importazione di contenuti: la si prepara fuori dal registro
// apposta, per provare un aggiornamento che NON crea nulla.
await base.runAsync(
  "INSERT INTO ripasso (esercizio_id, stabilita, prossima_revisione, stato) VALUES (?,?,?,?)",
  ["es-1", 0, adesso, "nuovo"]
);
await app.registra("ripasso", "es-1", "aggiorna", { grado: 3, stabilita: 2.5 }, async (d) => {
  await d.runAsync(
    `UPDATE ripasso SET stabilita = ?, ripetizioni = ripetizioni + 1,
     ultima_revisione = ?, stato = ? WHERE esercizio_id = ?`,
    [2.5, adesso, "ripasso", "es-1"]
  );
});
const scheda = await base.getFirstAsync("SELECT stabilita, ripetizioni, stato FROM ripasso WHERE esercizio_id = 'es-1'");
ok(
  "aggiorna: la proiezione su ripasso è applicata",
  scheda.stabilita === 2.5 && scheda.ripetizioni === 1 && scheda.stato === "ripasso",
  JSON.stringify(scheda)
);

// --- 'elimina' su biblioteca: lib/palestra.ts rimuoviVolume().
await app.registra("biblioteca", "vol-1", "elimina", {}, async (d) => {
  await d.runAsync("DELETE FROM biblioteca WHERE id = ?", ["vol-1"]);
});
ok("elimina: la proiezione ha tolto la riga", (await conta("biblioteca")) === 0);
ok(
  "elimina: l'evento RESTA nel registro (append-only)",
  (await conta("eventi", "WHERE entita_id = 'vol-1' AND tipo = 'elimina'")) === 1
);
ok("elimina: il registro conserva tutti e tre gli eventi del volume", (await conta("eventi", "WHERE entita_id = 'vol-1'")) === 3);

// --- i tre tipi ci sono davvero, e sono ordinabili per hlc
const tipi = (await base.getAllAsync("SELECT DISTINCT tipo FROM eventi ORDER BY tipo")).map((r) => r.tipo);
ok("i tre tipi di evento sono stati registrati", tipi.join(",") === "aggiorna,crea,elimina", tipi.join(","));
const ordinati = (await base.getAllAsync("SELECT hlc FROM eventi ORDER BY hlc")).map((r) => r.hlc);
ok(
  "gli hlc sono strettamente crescenti (ordine causale)",
  ordinati.every((h, i) => i === 0 || h > ordinati[i - 1]),
  ordinati.join(" ")
);

const EVENTI_BUONI = await conta("eventi");
ok("cinque registra() riuscite, cinque eventi", EVENTI_BUONI === 5, String(EVENTI_BUONI));

// ================================================================== PARTE C
// L'INVARIANTE 1: se la proiezione lancia, non deve restare NIENTE — né la
// proiezione a metà né l'evento che la precede nella transazione.
const SESSIONI_BUONE = await conta("sessioni");
const NOTE_BUONE = await conta("note");
const orologioPrima = await orologioSalvato();

// --- C1. eccezione a metà fra DUE tabelle: la prima scrittura è già andata,
//     la seconda non parte. È il caso che un doppio bugiardo lascerebbe passare.
let scrittureC1 = 0;
await lancia(
  "C1 proiezione che lancia a metà: l'errore risale al chiamante",
  () =>
    app.registra("note", "nota-ko", "crea", { titolo: "a metà" }, async (d, hlc) => {
      await d.runAsync(
        "INSERT INTO note (id, titolo, testo, creato_a, hlc) VALUES (?,?,?,?,?)",
        ["nota-ko", "a metà", "testo", adesso, hlc]
      );
      scrittureC1++;
      await d.runAsync("INSERT INTO sessioni (id, tipo, inizio, minuti, hlc) VALUES (?,?,?,?,?)", [
        "ses-ko",
        "studio",
        adesso,
        10,
        hlc,
      ]);
      scrittureC1++;
      throw new Error("guasto simulato a metà proiezione");
    }),
  "guasto simulato a metà proiezione"
);
ok("C1: la proiezione era arrivata a scrivere davvero", scrittureC1 === 2);
ok("C1: nessun evento orfano", (await conta("eventi")) === EVENTI_BUONI, String(await conta("eventi")));
ok("C1: nessuna nota rimasta", (await conta("note")) === NOTE_BUONE);
ok("C1: nessuna sessione rimasta", (await conta("sessioni")) === SESSIONI_BUONE);
ok("C1: l'orologio salvato NON è avanzato", (await orologioSalvato()) === orologioPrima);
ok("C1: non si resta dentro una transazione", (await base.isInTransactionAsync()) === false);

// --- C2. a lanciare è SQLite, non la proiezione: chiave primaria doppia sulla
//     seconda scrittura. L'errore non nasce nel codice del test.
await lancia(
  "C2 vincolo violato a metà proiezione: l'errore di SQLite risale",
  () =>
    app.registra("sessioni", "ses-2", "crea", { minuti: 5 }, async (d, hlc) => {
      await d.runAsync("INSERT INTO sessioni (id, tipo, inizio, minuti, hlc) VALUES (?,?,?,?,?)", [
        "ses-2",
        "studio",
        adesso,
        5,
        hlc,
      ]);
      // stessa chiave della sessione scritta nella parte B: SQLite rifiuta
      await d.runAsync("INSERT INTO sessioni (id, tipo, inizio, minuti, hlc) VALUES (?,?,?,?,?)", [
        "ses-1",
        "studio",
        adesso,
        5,
        hlc,
      ]);
    }),
  "UNIQUE constraint failed"
);
ok("C2: nessun evento orfano", (await conta("eventi")) === EVENTI_BUONI);
ok("C2: la sessione scritta prima dell'errore è sparita", (await conta("sessioni", "WHERE id = 'ses-2'")) === 0);
ok("C2: la sessione buona di prima è intatta", (await conta("sessioni", "WHERE id = 'ses-1'")) === 1);

// --- C3. promessa RIFIUTATA invece di throw: è il modo in cui fallirebbe una
//     proiezione che attende un'altra operazione asincrona. Se
//     withTransactionAsync non attendesse davvero, qui il COMMIT arriverebbe
//     prima del rifiuto e l'evento resterebbe.
await lancia(
  "C3 proiezione che rifiuta la promessa: l'errore risale lo stesso",
  () =>
    app.registra("note", "nota-ko2", "crea", {}, async (d, hlc) => {
      await d.runAsync("INSERT INTO note (id, testo, creato_a, hlc) VALUES (?,?,?,?)", [
        "nota-ko2",
        "testo",
        adesso,
        hlc,
      ]);
      await Promise.reject(new Error("rifiuto asincrono simulato"));
    }),
  "rifiuto asincrono simulato"
);
ok("C3: nessun evento orfano", (await conta("eventi")) === EVENTI_BUONI);
ok("C3: nessuna nota rimasta", (await conta("note")) === NOTE_BUONE);

// --- C4. l'errore arriva DOPO l'ultima scrittura della proiezione: il rollback
//     deve riprendersi anche l'INSERT dell'evento, che è la PRIMA istruzione
//     della transazione e la più facile da dimenticare.
await lancia(
  "C4 errore dopo l'ultima scrittura: torna indietro anche l'evento",
  () =>
    app.registra("sessioni", "ses-3", "crea", {}, async (d, hlc) => {
      await d.runAsync("INSERT INTO sessioni (id, tipo, inizio, minuti, hlc) VALUES (?,?,?,?,?)", [
        "ses-3",
        "studio",
        adesso,
        5,
        hlc,
      ]);
      throw new Error("guasto in coda alla proiezione");
    }),
  "guasto in coda"
);
ok("C4: nessun evento orfano", (await conta("eventi")) === EVENTI_BUONI);
ok("C4: nessuna sessione rimasta", (await conta("sessioni")) === SESSIONI_BUONE);

// --- C5. a fallire è l'INSERT dell'evento (tipo fuori dal CHECK dello schema):
//     la proiezione non deve nemmeno partire.
let proiezioneChiamata = false;
await lancia(
  "C5 tipo di evento inventato: il CHECK dello schema lo rifiuta",
  () =>
    app.registra("note", "nota-ko3", "inventato", {}, async () => {
      proiezioneChiamata = true;
    }),
  "CHECK constraint failed"
);
ok("C5: la proiezione non è stata nemmeno chiamata", proiezioneChiamata === false);
ok("C5: nessun evento orfano", (await conta("eventi")) === EVENTI_BUONI);

// --- il registro è ancora usabile dopo cinque fallimenti di fila: se il
//     ROLLBACK avesse lasciato una transazione aperta, questa registra()
//     morirebbe con "cannot start a transaction within a transaction".
await app.registra("sessioni", "ses-ok", "crea", { minuti: 50 }, async (d, hlc) => {
  await d.runAsync("INSERT INTO sessioni (id, tipo, inizio, minuti, hlc) VALUES (?,?,?,?,?)", [
    "ses-ok",
    "lavoro",
    adesso,
    50,
    hlc,
  ]);
});
ok("dopo i fallimenti il registro riprende a scrivere", (await conta("eventi")) === EVENTI_BUONI + 1);
ok("dopo i fallimenti la proiezione è di nuovo applicata", (await conta("sessioni", "WHERE id = 'ses-ok'")) === 1);
ok("l'orologio salvato è avanzato solo con l'evento riuscito", (await orologioSalvato()) !== orologioPrima);

// --- la coda di sincronizzazione non contiene nessuno degli eventi annullati
const coda = await app.daSincronizzare();
ok("daSincronizzare() vede solo gli eventi sopravvissuti", coda.length === EVENTI_BUONI + 1, String(coda.length));
ok(
  "daSincronizzare() non contiene nessun evento annullato",
  coda.every((e) => !["nota-ko", "nota-ko2", "nota-ko3", "ses-2", "ses-3"].includes(e.entita_id))
);

// ================================================================== PARTE D
// La transazione è vera anche vista da fuori: una seconda connessione allo
// stesso file non vede lo stato intermedio e, dopo il rollback, non trova
// traccia di niente. È la prova che il ROLLBACK avviene nel file e non solo
// nella testa del doppio.
const spia = openDatabaseSync("percorso.db", { useNewConnection: true });
const contaSpia = (tabella) => spia.getFirstSync(`SELECT COUNT(*) AS n FROM ${tabella}`).n;
const eventiPrimaDellaSpia = await conta("eventi");
ok("la spia è una connessione diversa da quella dell'app", spia !== base);
ok("la spia vede gli eventi già confermati", contaSpia("eventi") === eventiPrimaDellaSpia);

let vistiDallaSpiaDentro = null;
await lancia(
  "D transazione vista da fuori: la proiezione lancia",
  () =>
    app.registra("sessioni", "ses-spia", "crea", {}, async (d, hlc) => {
      await d.runAsync("INSERT INTO sessioni (id, tipo, inizio, minuti, hlc) VALUES (?,?,?,?,?)", [
        "ses-spia",
        "studio",
        adesso,
        7,
        hlc,
      ]);
      // Lettura da un'ALTRA connessione mentre la transazione è aperta.
      vistiDallaSpiaDentro = contaSpia("eventi");
      throw new Error("guasto con la spia a guardare");
    }),
  "guasto con la spia"
);
ok(
  "D: durante la transazione la spia NON vede l'evento non confermato",
  vistiDallaSpiaDentro === eventiPrimaDellaSpia,
  `spia: ${vistiDallaSpiaDentro}, attesi: ${eventiPrimaDellaSpia}`
);
ok("D: dopo il rollback la spia non trova l'evento", contaSpia("eventi") === eventiPrimaDellaSpia);
ok("D: dopo il rollback la spia non trova la sessione", spia.getFirstSync("SELECT COUNT(*) AS n FROM sessioni WHERE id = 'ses-spia'").n === 0);
spia.closeSync();

// ================================================================== PARTE E
// Due trappole per chi costruira' qui sopra: non sono difetti del banco (il
// doppio copia riga per riga withTransactionAsync di expo, vedi
// node_modules/expo-sqlite/build/SQLiteDatabase.js), ma si comportano allo
// stesso modo sul telefono e conviene trovarle scritte invece che scoprirle.

// --- E1. apri() e' un singoletto di modulo: la seconda chiamata restituisce
//     il database gia' aperto e IGNORA in silenzio l'altro identificativo di
//     dispositivo. Due dispositivi nello stesso processo non si simulano
//     attraverso lib/db.ts.
const stessoDatabase = await app.apri("un-altro-dispositivo");
ok("E1: apri() due volte restituisce lo stesso database", stessoDatabase === base);
await app.registra("sessioni", "ses-dopo-apri", "crea", {}, async (d, hlc) => {
  await d.runAsync("INSERT INTO sessioni (id, tipo, inizio, minuti, hlc) VALUES (?,?,?,?,?)", [
    "ses-dopo-apri",
    "studio",
    adesso,
    5,
    hlc,
  ]);
});
ok(
  "E1: il secondo apri() non cambia il dispositivo degli eventi",
  (await base.getFirstAsync("SELECT dispositivo FROM eventi WHERE entita_id = 'ses-dopo-apri'")).dispositivo ===
    DISPOSITIVO
);

// --- E2. registra() dentro una proiezione: SQLite non annida le transazioni,
//     e il ROLLBACK della registra() interna chiude quella ESTERNA. Il dato
//     resta integro (non si salva niente), ma l'errore che arriva in superficie
//     e' "cannot rollback - no transaction is active": il messaggio vero
//     ("cannot start a transaction within a transaction") viene mangiato dal
//     secondo ROLLBACK. Chi vede quel messaggio cerchi una registra() annidata.
const eventiPrimaAnnidata = await conta("eventi");
const sessioniPrimaAnnidata = await conta("sessioni");
await lancia(
  "E2 registra() annidata: fallisce (transazioni non annidabili)",
  () =>
    app.registra("note", "nota-esterna", "crea", {}, async (d, hlc) => {
      await d.runAsync("INSERT INTO note (id, testo, creato_a, hlc) VALUES (?,?,?,?)", [
        "nota-esterna",
        "testo",
        adesso,
        hlc,
      ]);
      await app.registra("note", "nota-interna", "crea", {}, async (dd, hh) => {
        await dd.runAsync("INSERT INTO note (id, testo, creato_a, hlc) VALUES (?,?,?,?)", [
          "nota-interna",
          "testo",
          adesso,
          hh,
        ]);
      });
    }),
  "cannot rollback"
);
ok("E2: nessun evento sopravvive all'annidamento", (await conta("eventi")) === eventiPrimaAnnidata);
ok("E2: nessuna nota sopravvive all'annidamento", (await conta("note")) === NOTE_BUONE);
ok("E2: le sessioni non sono state toccate", (await conta("sessioni")) === sessioniPrimaAnnidata);
ok("E2: dopo l'annidamento non si resta in transazione", (await base.isInTransactionAsync()) === false);
// Il registro deve restare usabile: altrimenti un errore di un test
// contagerebbe tutti quelli dopo.
await app.registra("sessioni", "ses-fine", "crea", {}, async (d, hlc) => {
  await d.runAsync("INSERT INTO sessioni (id, tipo, inizio, minuti, hlc) VALUES (?,?,?,?,?)", [
    "ses-fine",
    "studio",
    adesso,
    5,
    hlc,
  ]);
});
ok("E2: dopo l'annidamento il registro riprende a scrivere", (await conta("sessioni", "WHERE id = 'ses-fine'")) === 1);

// ==================================================================== ESITO
console.log(`\nbanco: registro eventi di lib/db.ts — SQLite ${(await base.getFirstAsync("SELECT sqlite_version() AS v")).v}`);
console.log(`cartella di prova: ${cartella}`);
for (const f of falliti) console.log(`  FALLITO: ${f}`);
console.log(`${passati} verifiche passate, ${falliti.length} fallite`);

// Dopo un fallimento i file restano: servono a capire cosa è successo.
if (falliti.length) process.exit(1);
rmSync(cartella, { recursive: true, force: true });
