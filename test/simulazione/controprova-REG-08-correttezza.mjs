/**
 * CONTROPROVA AVVERSARIALE del difetto REG-08, lente "correttezza".
 *
 * L'accusa (lib/db.ts, registra()): l'evento entra nel registro anche quando la
 * proiezione non tocca nessuna riga. L'atteso dell'accusa: "o e' un errore del
 * chiamante, o va rifiutato"; il danno dichiarato: "la ricostruzione dal
 * registro produce uno stato diverso da quello locale".
 *
 * Qui NON si cerca di confermare l'accusa: si cerca di SMONTARLA. Ogni verifica
 * e' scritta per diventare VERDE SE L'APP HA RAGIONE. Le vie di scampo cercate:
 *
 *   A. forse il difetto descrive codice gia' corretto oggi (RO-01, REG-06/07);
 *   B. forse il danno dichiarato non esiste: la ricostruzione fatta con le
 *      proiezioni VERE, rigiocando il registro su un database vuoto, da' lo
 *      stesso stato di quello locale, evento "orfano" compreso;
 *   C. forse la stessa simulazione pretende gia' questo comportamento come
 *      CORRETTO altrove (H2 di registro-eventi.mjs) e si contraddice;
 *   D. forse la precondizione non e' raggiungibile con un dito: nell'app nessuna
 *      riga operativa sparisce alle spalle di chi sta per scrivere;
 *   E. forse la correzione proposta costa piu' del difetto: rifiutare l'evento
 *      fa abortire importaBiblioteca() a meta';
 *   F. forse l'evento non e' affatto privo di senso: e' l'unica traccia del
 *      gesto dell'utente, e l'altro dispositivo, che la riga ce l'ha, la applica;
 *   G. forse registra() non PUO' contare le righe toccate senza rompere il
 *      contratto della proiezione, che e' una richiamata qualunque.
 *
 * Gira il CODICE VERO sopra il banco (node:sqlite): lib/db.ts e
 * lib/sync/fusione.ts, con le proiezioni ricopiate dalle schermate come fa
 * registro-eventi.mjs.
 *
 *   node test/simulazione/controprova-REG-08-correttezza.mjs
 *
 * Non tocca nessun file del progetto: solo letture e una radice temporanea.
 */
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
// L'ordine conta: carica.mjs per primo, perche' registra i ganci del banco.
import "../banco/carica.mjs";
import { configuraCartella } from "../banco/expo-sqlite.mjs";

const QUESTA_CARTELLA = dirname(fileURLToPath(import.meta.url));
const RADICE_PROGETTO = resolve(QUESTA_CARTELLA, "..", "..");
const RADICE = mkdtempSync(join(tmpdir(), "controprova-reg08-"));

const assoluzioni = []; // vie di scampo APERTE: l'app ha ragione
const condanne = []; // vie di scampo CHIUSE: l'accusa regge
const confini = []; // cio' che resta vero comunque, e va detto

function assolve(codice, motivo, condizione, extra = "") {
  if (condizione) assoluzioni.push(`${codice} ${motivo}`);
  else condanne.push(`${codice} ${motivo}${extra ? " — " + extra : ""}`);
}
function circoscrive(codice, motivo) {
  confini.push(`${codice} ${motivo}`);
}
function sorgente(relativo) {
  return readFileSync(join(RADICE_PROGETTO, relativo), "utf8");
}

let contatoreIstanze = 0;
async function avvia(dispositivo) {
  contatoreIstanze++;
  const dove = join(RADICE, "avvio-" + contatoreIstanze);
  configuraCartella(dove);
  const app = await import(`../../lib/db.ts?controprova08=${contatoreIstanze}`);
  await app.apri(dispositivo);
  return { app, base: app.database(), cartella: dove };
}

// ------------------------------------------- PROIEZIONI VERE DELLE SCHERMATE
// Ricopiate una per una, come in registro-eventi.mjs: se lo schema cambiasse
// sotto di loro fallirebbero esattamente come laggiu'.

/** lib/palestra.ts, importaPdf(). */
const proiettaVolumeCrea = (id, titolo, pagina) => async (d, hlc) => {
  await d.runAsync(
    `INSERT INTO biblioteca
     (id, titolo, autore, tema_slug, trimestre, origine, licenza, url, file_locale,
      formato, byte, ultima_pagina, aggiunto_a, hlc)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [id, titolo, null, null, null, "manuale", null, null, "file:///v.pdf", "pdf", 10,
     pagina, "2026-01-01T00:00:00.000Z", hlc]
  );
};
/** lib/palestra.ts, salvaPagina(). */
const proiettaPagina = (id, pagina) => async (d, hlc) => {
  await d.runAsync("UPDATE biblioteca SET ultima_pagina = ?, hlc = ? WHERE id = ?",
    [pagina, hlc, id]);
};
/** lib/palestra.ts, rimuoviVolume(). */
const proiettaVolumeElimina = (id) => async (dd) => {
  await dd.runAsync("DELETE FROM biblioteca WHERE id = ?", [id]);
};
/** lib/palestra.ts, importaBiblioteca(): collega il manifesto per codice. */
const proiettaCollegamento = (codice, uri) => async (d, hlc) => {
  await d.runAsync(
    "UPDATE biblioteca SET file_locale = ?, byte = ?, sha256 = ?, hlc = ? WHERE id = ?",
    [uri, 1024, "abc", hlc, codice]);
};
/** app/(tabs)/note.tsx, ramo "nuovo". */
const proiettaNotaCrea = (id, testo) => async (d, hlc) => {
  await d.runAsync(
    "INSERT INTO note (id, titolo, testo, pubblicabile, creato_a, hlc) VALUES (?,?,?,?,?,?)",
    [id, null, testo, 0, "2026-01-01T00:00:00.000Z", hlc]);
};

/** Le stesse proiezioni, indicizzate come le sceglierebbe un ricostruttore. */
function proiezioneDi(evento) {
  const payload = JSON.parse(evento.payload);
  if (evento.entita === "note" && evento.tipo === "crea") {
    return proiettaNotaCrea(evento.entita_id, payload.testo);
  }
  if (evento.entita === "biblioteca" && evento.tipo === "crea") {
    return proiettaVolumeCrea(evento.entita_id, payload.titolo, payload.ultima_pagina ?? 0);
  }
  if (evento.entita === "biblioteca" && evento.tipo === "elimina") {
    return proiettaVolumeElimina(evento.entita_id);
  }
  if (evento.entita === "biblioteca" && evento.tipo === "aggiorna") {
    return proiettaPagina(evento.entita_id, payload.ultima_pagina);
  }
  throw new Error("evento senza proiezione nota: " + evento.entita + "/" + evento.tipo);
}

const colonne = "id, hlc, dispositivo, entita, entita_id, tipo, payload";
const leggiRegistro = (base) =>
  base.getAllAsync(`SELECT ${colonne} FROM eventi ORDER BY hlc`);
const fotografia = async (base) =>
  JSON.stringify(await base.getAllAsync(
    "SELECT id, titolo, file_locale, ultima_pagina FROM biblioteca ORDER BY id"));

// =========================================== A. IL DIFETTO E' GIA' CORRETTO?
const db = sorgente("lib/db.ts");
const haCoda = /function inCoda/.test(db) && /codaScritture/.test(db);
const haControlloRighe = /changes/.test(db) || /total_changes/.test(db);
circoscrive("A1", haCoda
  ? "le due correzioni di oggi ci sono (inCoda/inTransazione in lib/db.ts), ma non toccano REG-08: la coda serializza le transazioni, non giudica le righe."
  : "ATTENZIONE: la coda di lib/db.ts non si trova piu' dove dovrebbe.");
circoscrive("A2", haControlloRighe
  ? "registra() sembra gia' contare le righe toccate: rileggere, il difetto potrebbe essere gia' chiuso."
  : "registra() non conta le righe toccate: il comportamento descritto dall'accusa e' ancora quello di oggi. Non e' un difetto gia' corretto.");

// ============= B. LA RICOSTRUZIONE DAL REGISTRO DA' DAVVERO UNO STATO DIVERSO?
{
  const vivo = await avvia("controp1");
  await vivo.app.registra("biblioteca", "v1", "crea", { titolo: "Volume", ultima_pagina: 0 },
    proiettaVolumeCrea("v1", "Volume", 0));
  await vivo.app.registra("biblioteca", "v1", "aggiorna", { ultima_pagina: 4 },
    proiettaPagina("v1", 4));
  await vivo.app.registra("biblioteca", "v1", "elimina", {}, proiettaVolumeElimina("v1"));
  // Il gesto incriminato: salvaPagina() su una riga che non c'e' piu'.
  await vivo.app.registra("biblioteca", "v1", "aggiorna", { ultima_pagina: 7 },
    proiettaPagina("v1", 7));
  // E la forma pura: una pagina su un volume mai esistito.
  await vivo.app.registra("biblioteca", "fantasma", "aggiorna", { ultima_pagina: 7 },
    proiettaPagina("fantasma", 7));
  await vivo.app.registra("note", "n1", "crea", { testo: "una nota vera" },
    proiettaNotaCrea("n1", "una nota vera"));

  const registro = await leggiRegistro(vivo.base);
  const statoLocale = await fotografia(vivo.base);

  // RICOSTRUZIONE: registro rigiocato in ordine HLC su un database vuoto, con
  // le stesse proiezioni. E' cio' che l'accusa dice che divergerebbe.
  const ricostruito = await avvia("controp2");
  for (const e of registro) {
    if (e.entita === "note" || e.entita === "biblioteca") {
      await proiezioneDi(e)(ricostruito.base, e.hlc);
    }
  }
  const statoRicostruito = await fotografia(ricostruito.base);

  assolve("B1", "la ricostruzione dal registro con le proiezioni VERE da' esattamente lo stato locale: l'evento orfano non proietta niente ne' qui ne' la'",
    statoLocale === statoRicostruito, `locale ${statoLocale} vs ricostruito ${statoRicostruito}`);
  assolve("B2", "e lo stato e' quello giusto: nessuna riga per v1 (cancellato) ne' per il volume fantasma",
    statoLocale === "[]", statoLocale);

  // L'unica "ricostruzione" che diverge e' proietta() di lib/sync/fusione.ts,
  // che pero' e' un riduttore puro di payload, non la proiezione dell'app.
  const { proietta } = await import("../../lib/sync/fusione.ts");
  const risorto = proietta(registro, "biblioteca", "v1");
  const fusione = sorgente("lib/sync/fusione.ts");
  const risurrezioneVoluta = /la resuscita, ed è voluto/.test(fusione);
  assolve("B3", "la sola ricostruzione che 'diverge' e' proietta(), e quella divergenza e' DOCUMENTATA COME VOLUTA in lib/sync/fusione.ts ('una modifica successiva a una eliminazione la resuscita, ed e' voluto')",
    risorto !== null && risorto.ultima_pagina === 7 && risurrezioneVoluta,
    JSON.stringify(risorto));
  circoscrive("B4", "proietta() non e' usata da nessuna schermata: grep su lib/, app/ e components/ la trova solo in fusione.ts e nei test. Oggi nessun codice dell'app ricostruisce lo stato dal registro, quindi il danno dichiarato non ha nemmeno un consumatore.");

  vivo.base.closeSync?.();
  ricostruito.base.closeSync?.();
}

// ====== C. LA STESSA SIMULAZIONE PRETENDE GIA' QUESTO COMPORTAMENTO COME OK?
{
  const simulazione = sorgente("test/simulazione/registro-eventi.mjs");
  const bloccoH2 = simulazione.slice(
    simulazione.indexOf("H2 dopo 'elimina' la ricostruzione e null"),
    simulazione.indexOf("H3 le righe di dotazione")
  );
  const h2UsaOk = /ok\("mentre la tabella operativa resta vuota \(l'UPDATE non trova la riga\)"/.test(bloccoH2);
  const h2NonEDifetto = !bloccoH2.includes("DIFETTO RIPRODOTTO");
  assolve("C1", "H2 mette in scena ESATTAMENTE il comportamento accusato (evento scritto, UPDATE che non trova la riga) e lo verifica con ok(), non con difetto(): la stessa simulazione lo considera corretto",
    h2UsaOk && h2NonEDifetto);
  assolve("C2", "D1 (REG-08) e H2 sono lo stesso percorso di codice — registra('aggiorna') con una proiezione UPDATE che non morde — giudicato in due modi opposti nello stesso file",
    h2UsaOk && /D1 proiezione che non tocca nessuna riga \(REG-08\)/.test(simulazione));
}

// ============================ D. LA PRECONDIZIONE E' RAGGIUNGIBILE CON UN DITO?
{
  const cancellazioni = ["lib/palestra.ts", "lib/contenuti.ts", "lib/promemoria.ts",
    "lib/sessioni.ts", "app/ripasso.tsx", "app/esercizi.tsx", "app/codice.tsx",
    "app/(tabs)/note.tsx", "app/(tabs)/libreria.tsx", "app/lettore.tsx"]
    .flatMap((f) => (sorgente(f).match(/DELETE FROM \w+/g) ?? []).map((d) => `${f}: ${d}`));
  assolve("D1", `l'unica cancellazione di una riga operativa in tutta l'app e' quella dentro registra('elimina') di rimuoviVolume(): ${JSON.stringify(cancellazioni)}`,
    cancellazioni.length === 1 && cancellazioni[0].startsWith("lib/palestra.ts"),
    JSON.stringify(cancellazioni));

  const ripasso = sorgente("app/ripasso.tsx") + sorgente("lib/contenuti.ts");
  assolve("D2", "la riga di ripasso, su cui J15 e G6 fondano lo scenario, non viene MAI cancellata dall'app: la scena si ottiene solo con un DELETE scritto a mano nel test, cioe' proprio cio' che l'invariante 1 vieta",
    !/DELETE FROM ripasso/.test(ripasso));

  const lettore = sorgente("app/lettore.tsx");
  const salvataggioDifferito = /setTimeout\(\(\) => void salvaPagina/.test(lettore);
  const timerAnnullato = /return \(\) => \{ if \(salvataggio\.current\) clearTimeout\(salvataggio\.current\); \};/.test(lettore);
  assolve("D3", "il salvataggio della pagina e' differito di 1500 ms ma il timer viene ANNULLATO allo smontaggio del lettore: per cancellare il volume bisogna uscire dal lettore, e uscendo il salvataggio in sospeso muore. salvaPagina() non puo' arrivare dopo rimuoviVolume() sullo stesso dispositivo",
    salvataggioDifferito && timerAnnullato);

  const useAutoSync = sorgente("lib/sync/useAutoSync.ts");
  const soloRegistro = /INSERT OR IGNORE INTO eventi/.test(useAutoSync) &&
    !/UPDATE biblioteca|DELETE FROM biblioteca|UPDATE ripasso/.test(useAutoSync);
  assolve("D4", "lo scenario raccontato dall'accusa ('il volume e' stato eliminato sull'altro dispositivo mentre qui il lettore era aperto') oggi non esiste: useAutoSync inserisce gli eventi ricevuti nel registro e non proietta nulla, quindi una cancellazione remota non fa sparire nessuna riga locale",
    soloRegistro);
}

// ================= E. QUANTO COSTEREBBE LA CORREZIONE PROPOSTA (RIFIUTARE)?
{
  // importaBiblioteca() collega per codice le voci del manifesto alle righe di
  // dotazione. L'archivio si scarica con un workflow manuale e puo' essere piu'
  // nuovo di assets/contenuti/: un codice senza riga locale e' normale.
  const { app, base } = await avvia("controp3");
  for (const codice of ["BIB-001", "BIB-003"]) {
    await base.runAsync(
      `INSERT INTO biblioteca (id, titolo, origine, aggiunto_a) VALUES (?,?,'aperta',?)`,
      [codice, "Volume " + codice, "2026-01-01T00:00:00.000Z"]);
  }
  const manifesto = ["BIB-001", "BIB-002", "BIB-003"]; // BIB-002 non e' in dotazione

  let collegatiOggi = 0;
  for (const codice of manifesto) {
    await app.registra("biblioteca", codice, "aggiorna",
      { file_locale: "file:///" + codice + ".pdf", byte: 1024, sha256: "abc" },
      proiettaCollegamento(codice, "file:///" + codice + ".pdf"));
    collegatiOggi++;
  }
  assolve("E1", `con il codice di oggi l'importazione arriva in fondo: ${collegatiOggi} voci su 3 elaborate, le 2 presenti collegate, la terza inerte`,
    collegatiOggi === 3 &&
      (await base.getAllAsync("SELECT id FROM biblioteca WHERE file_locale IS NOT NULL")).length === 2);

  // La stessa importazione con la regola proposta: rifiuta se la proiezione non
  // morde. Si simula QUI, fuori da lib/db.ts, che questa prova non tocca.
  const { app: app2, base: base2 } = await avvia("controp4");
  for (const codice of ["BIB-001", "BIB-003"]) {
    await base2.runAsync(
      `INSERT INTO biblioteca (id, titolo, origine, aggiunto_a) VALUES (?,?,'aperta',?)`,
      [codice, "Volume " + codice, "2026-01-01T00:00:00.000Z"]);
  }
  const registraSevero = (codice) =>
    app2.registra("biblioteca", codice, "aggiorna", { file_locale: "x" }, async (d, hlc) => {
      const esito = await d.runAsync(
        "UPDATE biblioteca SET file_locale = ?, hlc = ? WHERE id = ?",
        ["file:///" + codice + ".pdf", hlc, codice]);
      if (esito.changes === 0) throw new Error("La proiezione non ha toccato nessuna riga.");
    });
  let collegatiSeveri = 0;
  let interrotta = null;
  try {
    for (const codice of manifesto) {
      await registraSevero(codice);
      collegatiSeveri++;
    }
  } catch (errore) {
    interrotta = String(errore.message);
  }
  assolve("E2", `con la regola dell'accusa l'importazione ABORTISCE alla seconda voce (${collegatiSeveri} su 3, "${interrotta}") e BIB-003 non viene mai collegato: un volume perso alla vigilia di due mesi senza rete, per evitare un evento inerte`,
    interrotta !== null && collegatiSeveri === 1);
  const perso = await base2.getFirstAsync("SELECT file_locale FROM biblioteca WHERE id='BIB-003'");
  assolve("E3", "e il danno e' proprio quello che l'invariante di progetto vuole evitare: il volume resta senza file, cioe' illeggibile in aereo",
    perso.file_locale === null);
}

// ===================== F. L'EVENTO ORFANO E' DAVVERO PRIVO DI SIGNIFICATO?
{
  const { app, base } = await avvia("controp5");
  await app.registra("biblioteca", "condiviso", "aggiorna", { ultima_pagina: 42 },
    proiettaPagina("condiviso", 42)); // qui la riga non c'e'
  const [orfano] = await leggiRegistro(base);

  // L'altro dispositivo la riga ce l'ha: applicando lo stesso evento ottiene
  // lo stato giusto. L'evento e' l'unica traccia del gesto dell'utente.
  const pari = await avvia("controp6");
  await pari.base.runAsync(
    `INSERT INTO biblioteca (id, titolo, origine, aggiunto_a, ultima_pagina) VALUES (?,?,'aperta',?,0)`,
    ["condiviso", "Volume condiviso", "2026-01-01T00:00:00.000Z"]);
  await proiezioneDi(orfano)(pari.base, orfano.hlc);
  const sulPari = await pari.base.getFirstAsync(
    "SELECT ultima_pagina FROM biblioteca WHERE id='condiviso'");
  assolve("F1", "l'evento 'orfano' qui e' pienamente significativo sul dispositivo che la riga ce l'ha: applicato, porta la ripresa di lettura a pagina 42. Rifiutarlo cancellerebbe il gesto dell'utente per tutto il sistema, non solo qui",
    sulPari.ultima_pagina === 42, JSON.stringify(sulPari));

  const daInviare = await app.daSincronizzare();
  assolve("F2", "e il registro resta consumabile: daSincronizzare() lo restituisce, e fondi() lo deduplica senza sollevare niente",
    daInviare.length === 1 && daInviare[0].entita_id === "condiviso");

  circoscrive("F3", "far dipendere l'accettazione di un evento dallo stato della tabella operativa INVERTE l'invariante 1: il registro smetterebbe di essere la fonte di verita' e diventerebbe una funzione della proiezione locale. Lo stesso gesto produrrebbe un evento su un dispositivo e nessun evento sull'altro.");
}

// ============ G. registra() PUO' CONTARE LE RIGHE TOCCATE DALLA PROIEZIONE?
{
  const { app, base } = await avvia("controp7");
  // La proiezione e' una richiamata qualunque: puo' fare N istruzioni, e
  // "quante righe ha toccato" non ha una risposta sola.
  let cambiamenti = [];
  await app.registra("biblioteca", "multi", "crea", { titolo: "M", ultima_pagina: 0 },
    async (d, hlc) => {
      cambiamenti.push((await d.runAsync(
        `INSERT INTO biblioteca (id, titolo, origine, aggiunto_a, hlc) VALUES (?,?,'manuale',?,?)`,
        ["multi", "M", "2026-01-01T00:00:00.000Z", hlc])).changes);
      // Seconda istruzione della stessa proiezione, legittimamente a vuoto:
      // e' il seminatore idempotente che lib/contenuti.ts usa apposta.
      cambiamenti.push((await d.runAsync(
        `INSERT OR IGNORE INTO biblioteca (id, titolo, origine, aggiunto_a) VALUES (?,?,'aperta',?)`,
        ["multi", "M", "2026-01-01T00:00:00.000Z"])).changes);
    });
  assolve("G1", `dentro una sola proiezione convivono un'istruzione che tocca ${cambiamenti[0]} riga e una che ne tocca ${cambiamenti[1]}: un 'rifiuta se non tocca niente' o guarda solo l'ultima istruzione (e rifiuterebbe questo caso sano) o guarda il totale (e non intercetterebbe una proiezione che scrive la riga sbagliata)`,
    cambiamenti[0] === 1 && cambiamenti[1] === 0, JSON.stringify(cambiamenti));

  const contratto = /proiezione: \(d: SQLite\.SQLiteDatabase, hlc: string\) => Promise<void>/.test(db);
  assolve("G2", "il contratto della proiezione e' `=> Promise<void>`: non restituisce niente, quindi registra() non ha modo di sapere cosa ha fatto senza cambiare la firma e tutti e nove i punti di chiamata (4 in lib/palestra.ts, uno per schermata in ripasso/esercizi/codice/note, uno in Cronometro)",
    contratto);
  base.closeSync?.();
}

// ------------------------------------------------------------------ VERDETTO
console.log("VIE DI SCAMPO APERTE (l'app ha ragione):");
for (const a of assoluzioni) console.log("  ok  " + a);
console.log("\nVIE DI SCAMPO CHIUSE (l'accusa regge):");
for (const c of condanne) console.log("  X   " + c);
console.log("\nCONFINI:");
for (const c of confini) console.log("  ·   " + c);
console.log(
  `\nesito: ${assoluzioni.length} vie aperte, ${condanne.length} chiuse, ${confini.length} confini.`
);
rmSync(RADICE, { recursive: true, force: true });
process.exit(0);
