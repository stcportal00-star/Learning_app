/**
 * SIMULAZIONE DELLA SUPERFICIE "REGISTRO EVENTI" — lib/db.ts sopra il banco.
 *
 * Si esegue dalla radice del progetto, in uno dei due modi (equivalenti):
 *
 *   node test/simulazione/registro-eventi.mjs
 *   node --import ./test/banco/carica.mjs test/simulazione/registro-eventi.mjs
 *
 * Qui gira il CODICE VERO dell'app: lib/db.ts caricato dal banco, con le
 * proiezioni ricopiate dalle schermate (app/(tabs)/note.tsx, app/esercizi.tsx,
 * app/codice.tsx, app/ripasso.tsx, components/Cronometro.tsx, lib/palestra.ts).
 * Le schermate non si importano: il banco non ha react-native ne expo-router.
 *
 * COSA AGGIUNGE rispetto a test/banco/prova-registro.mjs (63 verifiche, il
 * cancello): quella prova dimostra che registra() e atomica quando la
 * proiezione fallisce. Qui si simula TUTTO IL RESTO della superficie:
 *   A. apertura, migrazioni, stato del modulo (apri due volte, database chiuso,
 *      registra prima di apri);
 *   B. i tre tipi di evento su tutte e cinque le entita che passano dal registro;
 *   C. altri cinque modi di far fallire la transazione, diversi da quelli gia
 *      provati (payload non serializzabile, NOT NULL, CHECK sulla biblioteca);
 *   D. i casi in cui il codice PERMETTE una divergenza fra registro e proiezione;
 *   E. l'orologio: ripresa dopo il riavvio, ora di sistema arretrata, traboccamento
 *      del contatore, meta('hlc') corrotta in quattro modi diversi;
 *   F. CONCORRENZA: due registra() senza await, e una registra() mentre la
 *      transazione della sincronizzazione applica un pacchetto remoto;
 *   G. la coda di invio: daSincronizzare() e segnaSincronizzati();
 *   H. ricostruzione dello stato dal solo registro, con proietta() di lib/sync.
 *
 * COME SI SIMULANO PIU AVVII E PIU "DISPOSITIVI" IN UN PROCESSO SOLO.
 * lib/db.ts tiene `db` e `orologio` in variabili di modulo: una volta aperto,
 * apri() restituisce sempre la stessa connessione. Per provare il primo avvio,
 * il riavvio e l'orologio ripristinato servirebbero piu processi. Si usa invece
 * una stringa di richiesta nell'URL del modulo:
 *
 *   await import("../../lib/db.ts?istanza=7")
 *
 * che Node considera un modulo DIVERSO e quindi rivaluta da capo, con variabili
 * di modulo nuove. Il gancio di carica.mjs compila i .ts anche con la stringa di
 * richiesta (la sua espressione regolare prevede il "?"). Ogni istanza riceve
 * una cartella sua con configuraCartella(), cosi due avvii non si pestano i
 * piedi; quando l'avvio deve trovare i dati del precedente si passa la STESSA
 * cartella e si chiude prima la connessione vecchia, che e quanto succede
 * davvero quando Android chiude l'app.
 *
 * CONVENZIONE SUI DIFETTI. Un difetto dell'app NON viene "corretto" qui e non
 * rende rossa la prova: lo scenario che lo riproduce si chiama
 * "DIFETTO RIPRODOTTO: ..." e verifica il comportamento OSSERVATO, cosi resta
 * una rete di sicurezza che diventera rossa il giorno in cui il difetto verra
 * corretto (ed e allora che va riscritta l'attesa). L'elenco completo viene
 * ristampato in fondo, separato dal conteggio.
 *
 * E QUANDO IL DIFETTO VIENE CORRETTO DAVVERO. Lo scenario non si cancella:
 * cambia mestiere. Si chiama "CORREZIONE SORVEGLIATA: ..." e le sue verifiche
 * passano da ok() a corretto(), stessa forma e verdetto opposto a quello di
 * prima. La scena resta identica — e questo e il punto: chi ha gia dimostrato
 * di saper riprodurre il difetto e il miglior sorvegliante che quel difetto
 * possa avere. Anche le correzioni sorvegliate hanno il loro elenco in fondo.
 *
 * Gli scenari F1, F2 e F3 sono passati di qui: inchiodavano l'accavallamento
 * di due registra() (invariante 1 rotta in silenzio, riga operativa senza il
 * suo evento). La coda di lib/db.ts — una transazione per volta, in ordine di
 * arrivo, esportata anche come inTransazione() per la sincronizzazione e per
 * il caricamento dei contenuti — ha chiuso il difetto, e ora i tre scenari
 * pretendono il comportamento corretto: tutte le scritture riescono, ogni
 * riga ha il suo evento, il pacchetto remoto entra tutto o niente.
 *
 * COME VERIFICARE CHE QUESTA PROVA NON SIA UN TIMBRO (falsificazione fatta, non
 * immaginata). Una prova che non puo diventare rossa non dimostra niente.
 *
 * (1) L'ATOMICITA. Si indebolisce il doppio DA FUORI, senza toccare nessun
 * file del progetto, e si guarda quante verifiche cadono:
 *
 *   // in una cartella qualsiasi FUORI dal progetto
 *   import "/home/user/learning_app/test/banco/carica.mjs";
 *   import { BaseDatiDoppia } from "/home/user/learning_app/test/banco/expo-sqlite.mjs";
 *   BaseDatiDoppia.prototype.withTransactionAsync = async function (compito) {
 *     await this.execAsync("BEGIN");
 *     try { await compito(); } catch (e) { await this.execAsync("COMMIT"); throw e; }
 *     await this.execAsync("COMMIT");
 *   };
 *   await import("/home/user/learning_app/test/simulazione/registro-eventi.mjs");
 *
 * Misurato: togliendo il ROLLBACK cadono 6 scenari (11 verifiche) — C1, C2, C5,
 * C6, C7, E7; sostituendo withTransactionAsync con la sola chiamata al compito
 * (ne BEGIN ne ROLLBACK) cadono gli stessi 6 scenari con 12 verifiche. C3 e C4
 * restano verdi ed e giusto: li l'errore arriva PRIMA di qualunque scrittura
 * (CHECK su eventi.tipo, JSON.stringify), quindi non dipendono dal rollback.
 *
 * (2) LA CODA (le guardie F1, F2, F3). Questa via NON le copre, e il motivo e
 * istruttivo: con la coda in funzione, in quei tre scenari nessuna transazione
 * fallisce piu, quindi non c'e nessun ROLLBACK da togliere e restano verdi.
 * Servono due falsificazioni, non una. La seconda disattiva la serializzazione
 * sostituendo il corpo di inCoda() in lib/db.ts con `return compito();`.
 *
 * Misurato: cadono esattamente i 3 scenari convertiti, con TUTTE e 24 le
 * verifiche corretto() rosse (264 -> 240) e nessun altro scenario toccato.
 * L'accavallamento torna identico a com'era prima della correzione: BEGIN
 * annidato ("cannot start a transaction within a transaction"), ROLLBACK della
 * seconda transazione che annulla l'evento della prima, riga operativa orfana,
 * pacchetto remoto applicato a meta (resta solo R2:e2). lib/db.ts va poi
 * rimesso com'era con `git checkout -- lib/db.ts`: e un file del progetto, e
 * questa prova non lo modifica.
 *
 * LIMITI DI QUESTA SIMULAZIONE (leggere prima di fidarsi del verde):
 *   - sotto c'e node:sqlite, sincrono: l'interfogliamento della parte F e
 *     quello dei microcompiti di JavaScript, che sul telefono c'e uguale (gli
 *     await sono gli stessi), ma il vero parallelismo del thread nativo no;
 *   - niente interfaccia: la logica delle schermate e ricopiata, non eseguita;
 *   - SQLite 3.51.2 di Node 22, non quello del telefono: il limite di variabili
 *     per istruzione (parte G) qui e 32766, su Android puo essere 999;
 *   - due dispositivi veri non ci sono: gli eventi "remoti" delle parti F e G
 *     sono scritti a mano con la forma esatta di lib/sync/pacchetto.ts.
 *
 * Esito dell'ultima esecuzione: 45 scenari su 45, 264 verifiche su 264
 * (di cui 24 sono guardie corretto() sulla coda delle scritture).
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
// L'ordine conta: carica.mjs per primo, perche registra i ganci del banco.
import "../banco/carica.mjs";
import { configuraCartella } from "../banco/expo-sqlite.mjs";

// ------------------------------------------------------------------ CONTEGGIO
const PREFISSO_DIFETTO = "DIFETTO RIPRODOTTO: ";
const PREFISSO_CORREZIONE = "CORREZIONE SORVEGLIATA: ";

const scenari = [];
const correzioniSorvegliate = [];
let corrente = null;

function ok(nome, condizione, extra = "") {
  if (!corrente) throw new Error("ok() fuori da uno scenario: " + nome);
  corrente.verifiche++;
  if (!condizione) corrente.errori.push(`${nome}${extra ? " — " + extra : ""}`);
}

/**
 * Il contraltare di ok() per le guardie nate da un difetto ormai corretto:
 * stessa forma, verdetto opposto a quello che lo scenario pretendeva prima.
 * Passa quando vale il comportamento CORRETTO, e si accumula in un elenco
 * separato che il riepilogo stampa a parte.
 *
 * Perche un elenco a parte e non un ok() qualunque: chi legge un rosso qui
 * deve capire subito che non e una verifica nuova ad essersi rotta, ma una
 * correzione ad essere REGREDITA — e sa gia dove guardare, perche lo scenario
 * conserva la scena esatta con cui il difetto era stato riprodotto.
 */
function corretto(nome, condizione, extra = "") {
  if (!corrente) throw new Error("corretto() fuori da uno scenario: " + nome);
  corrente.verifiche++;
  if (condizione) {
    correzioniSorvegliate.push(`${corrente.nome.replace(PREFISSO_CORREZIONE, "")} — ${nome}`);
  } else {
    corrente.errori.push(`${nome} — LA CORREZIONE E' REGREDITA${extra ? " — " + extra : ""}`);
  }
}

/** Attende che `azione` lanci, e che il messaggio contenga `frammento`. */
async function lancia(nome, azione, frammento) {
  let messaggio = null;
  try {
    await azione();
  } catch (errore) {
    messaggio = String(errore?.message ?? errore);
  }
  if (messaggio === null) {
    ok(nome, false, "non ha lanciato nessun errore");
    return "";
  }
  ok(nome, messaggio.includes(frammento), `messaggio: ${messaggio}`);
  return messaggio;
}

async function prova(nome, azione) {
  corrente = {
    nome,
    verifiche: 0,
    errori: [],
    difetto: nome.startsWith(PREFISSO_DIFETTO),
    correzione: nome.startsWith(PREFISSO_CORREZIONE),
  };
  scenari.push(corrente);
  try {
    await azione();
  } catch (errore) {
    corrente.verifiche++;
    corrente.errori.push("eccezione non attesa: " + String(errore?.stack ?? errore));
  }
  const esito = corrente.errori.length === 0;
  console.log(
    `${esito ? "  ok  " : "FALLITO"}  ${nome}  (${corrente.verifiche} verifiche)`
  );
  for (const e of corrente.errori) console.log(`          ! ${e}`);
  corrente = null;
}

// ------------------------------------------------------------------- AMBIENTE
const RADICE = mkdtempSync(join(tmpdir(), "sim-registro-"));
let contatoreIstanze = 0;

/**
 * Un "avvio dell'app": istanza nuova di lib/db.ts + cartella.
 * Passando `cartella` si riapre un database gia esistente (riavvio).
 */
async function avvia(dispositivo, cartella) {
  contatoreIstanze++;
  const dove = cartella ?? join(RADICE, "avvio-" + contatoreIstanze);
  configuraCartella(dove);
  const app = await import(`../../lib/db.ts?istanza=${contatoreIstanze}`);
  await app.apri(dispositivo);
  return { app, base: app.database(), cartella: dove };
}

/** Modulo lib/db.ts appena valutato, senza apri(): serve ai casi di stato. */
async function moduloVergine(cartella) {
  contatoreIstanze++;
  configuraCartella(cartella ?? join(RADICE, "vergine-" + contatoreIstanze));
  return import(`../../lib/db.ts?istanza=${contatoreIstanze}`);
}

const oraVera = Date.now;
function congelaOra(valore) {
  Date.now = () => valore;
}
function scongelaOra() {
  Date.now = oraVera;
}

// ------------------------------------------- PROIEZIONI VERE DELLE SCHERMATE
// Ricopiate una per una dal codice delle schermate: se lo schema cambiasse
// sotto di loro, queste proiezioni fallirebbero esattamente come laggiu.

/** app/(tabs)/note.tsx:50 — ramo "nuovo". */
const proiettaNotaCrea = (id, titolo, testo, pubblicabile) => async (d, hlc) => {
  await d.runAsync(
    `INSERT INTO note (id, titolo, testo, pubblicabile, creato_a, hlc) VALUES (?,?,?,?,?,?)`,
    [id, titolo || null, testo, pubblicabile ? 1 : 0, new Date().toISOString(), hlc]
  );
};

/** app/(tabs)/note.tsx:50 — ramo "esistente". */
const proiettaNotaAggiorna = (id, titolo, testo, pubblicabile) => async (d, hlc) => {
  await d.runAsync(
    `UPDATE note SET titolo = ?, testo = ?, pubblicabile = ?, hlc = ? WHERE id = ?`,
    [titolo || null, testo, pubblicabile ? 1 : 0, hlc, id]
  );
};

/** app/esercizi.tsx:60 e app/codice.tsx:69 (stesso INSERT, esiti diversi). */
const proiettaTentativo = (id, esercizioId, risposta, esito, motivo, durata) => async (d, hlc) => {
  await d.runAsync(
    `INSERT INTO tentativi (id, esercizio_id, risposta, esito, motivo, durata_sec, eseguito_a, hlc)
     VALUES (?,?,?,?,?,?,?,?)`,
    [id, esercizioId, risposta, esito, motivo, durata, new Date().toISOString(), hlc]
  );
};

/** components/Cronometro.tsx:56. */
const proiettaSessione = (id, tipo, inizio, minuti) => async (d, hlc) => {
  await d.runAsync(
    "INSERT INTO sessioni (id, tipo, inizio, minuti, hlc) VALUES (?,?,?,?,?)",
    [id, tipo, new Date(inizio).toISOString(), minuti, hlc]
  );
};

/** app/ripasso.tsx:44. */
const proiettaRipasso = (esercizioId, stabilita, quando, stato) => async (dd) => {
  await dd.runAsync(
    `UPDATE ripasso SET stabilita = ?, ripetizioni = ripetizioni + 1,
     ultima_revisione = ?, prossima_revisione = ?, stato = ? WHERE esercizio_id = ?`,
    [stabilita, new Date().toISOString(), quando, stato, esercizioId]
  );
};

/** lib/palestra.ts:153 (importaPdf). */
const proiettaVolumeCrea = (id, titolo, fileLocale, byte) => async (d, hlc) => {
  await d.runAsync(
    `INSERT INTO biblioteca
     (id, titolo, autore, tema_slug, trimestre, origine, licenza, url, file_locale,
      formato, byte, ultima_pagina, aggiunto_a, hlc)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,0,?,?)`,
    [id, titolo, null, null, null, "manuale", null, null, fileLocale, "pdf", byte,
     new Date().toISOString(), hlc]
  );
};

/** lib/palestra.ts:296 (salvaPagina). */
const proiettaPagina = (id, pagina) => async (d, hlc) => {
  await d.runAsync("UPDATE biblioteca SET ultima_pagina = ?, hlc = ? WHERE id = ?", [pagina, hlc, id]);
};

/** lib/palestra.ts:308 (rimuoviVolume): la riga sparisce, l'hlc non serve. */
const proiettaVolumeElimina = (id) => async (dd) => {
  await dd.runAsync("DELETE FROM biblioteca WHERE id = ?", [id]);
};

// Riga di dotazione scritta da caricaContenuti(), FUORI dal registro.
async function semina(base, sql, parametri) {
  await base.runAsync(sql, parametri);
}

const contaEventi = async (base, dove = "", p = []) =>
  (await base.getFirstAsync(`SELECT count(*) AS n FROM eventi ${dove}`, p)).n;

// ============================================================================
// A. APERTURA, MIGRAZIONI E STATO DEL MODULO
// ============================================================================

await prova("A1 primo avvio: lo schema v1 nasce intero e il registro e vuoto", async () => {
  const { base, app } = await avvia("aaaa1111");
  const tabelle = (
    await base.getAllAsync(
      "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name"
    )
  ).map((r) => r.name);
  // v2 ha aggiunto `articoli` (la rassegna quotidiana, con il testo dentro
  // perche si legga senza rete) e `segni` (note e segnalibri ACCANTO ai PDF).
  const atteseTabelle = ["artefatti", "articoli", "biblioteca", "credenziali", "esercizi",
    "eventi", "meta", "note", "pubblicazioni", "ripasso", "segni", "sessioni", "temi", "tentativi"];
  ok("le 14 tabelle dello schema v2 esistono", tabelle.join(",") === atteseTabelle.join(","), tabelle.join(","));

  const indici = (
    await base.getAllAsync(
      "SELECT name FROM sqlite_master WHERE type='index' AND name NOT LIKE 'sqlite_%' ORDER BY name"
    )
  ).map((r) => r.name);
  const attesiIndici = ["articoli_media_idx", "articoli_raccolto_idx", "articoli_tema_idx", "biblioteca_codice_idx",
    "biblioteca_trim_idx", "esercizi_tema_idx", "eventi_da_sincronizzare", "eventi_entita_idx",
    "eventi_hlc_idx", "ripasso_prossima_idx", "segni_volume_idx", "sessioni_inizio_idx",
    "tentativi_esercizio_idx"];
  ok(`i ${attesiIndici.length} indici dichiarati esistono`,
    indici.join(",") === attesiIndici.join(","), indici.join(","));

  const v = await base.getFirstAsync("PRAGMA user_version");
  // Il numero si legge dal modulo, non si riscrive qui: era «2» a mano, e alla
  // migrazione successiva questa riga sarebbe diventata rossa per il motivo
  // sbagliato — non perche lo schema fosse rotto, ma perche il test era vecchio.
  ok(`user_version passa a ${app.SCHEMA_VERSIONE}`,
    v.user_version === app.SCHEMA_VERSIONE, String(v.user_version));
  ok("SCHEMA_VERSIONE coincide con la versione scritta", app.SCHEMA_VERSIONE === v.user_version,
    `SCHEMA_VERSIONE=${app.SCHEMA_VERSIONE}`);

  const jm = await base.getFirstAsync("PRAGMA journal_mode");
  ok("il file e in WAL", String(jm.journal_mode).toLowerCase() === "wal", JSON.stringify(jm));
  const fk = await base.getFirstAsync("PRAGMA foreign_keys");
  ok("foreign_keys e acceso", fk.foreign_keys === 1, JSON.stringify(fk));

  ok("nessun evento al primo avvio", (await contaEventi(base)) === 0);
  ok("nessun orologio salvato: si riparte da zero",
    (await base.getFirstAsync("SELECT valore FROM meta WHERE chiave='hlc'")) === null);
});

await prova("A2 secondo avvio sullo stesso file: niente migrazioni, dati intatti", async () => {
  const primo = await avvia("aaaa2222");
  await primo.app.registra("note", "n1", "crea", { testo: "prima" },
    proiettaNotaCrea("n1", "T", "prima", false));
  const metaPrima = (await primo.base.getFirstAsync("SELECT valore FROM meta WHERE chiave='hlc'")).valore;
  await primo.base.closeAsync();

  const secondo = await avvia("aaaa2222", primo.cartella);
  const v = await secondo.base.getFirstAsync("PRAGMA user_version");
  ok(`user_version resta ${secondo.app.SCHEMA_VERSIONE}`,
    v.user_version === secondo.app.SCHEMA_VERSIONE, String(v.user_version));
  ok("l'evento di prima e ancora li", (await contaEventi(secondo.base)) === 1);
  ok("la nota di prima e ancora li",
    (await secondo.base.getFirstAsync("SELECT testo FROM note WHERE id='n1'")).testo === "prima");
  ok("meta('hlc') non e stata toccata dall'apertura",
    (await secondo.base.getFirstAsync("SELECT valore FROM meta WHERE chiave='hlc'")).valore === metaPrima);

  const h = await secondo.app.registra("note", "n2", "crea", {}, proiettaNotaCrea("n2", null, "dopo", false));
  const [msVecchio, contVecchio] = metaPrima.split("-");
  const msNuovo = parseInt(h.split("-")[0], 16);
  ok("l'orologio riprende da meta e non regredisce",
    msNuovo >= parseInt(msVecchio, 16), `${msNuovo} < ${parseInt(msVecchio, 16)}`);
  ok("il secondo avvio scrive un evento nuovo, non sostituisce", (await contaEventi(secondo.base)) === 2);
  ok("contatore di partenza leggibile", Number.isInteger(parseInt(contVecchio, 16)));
});

await prova("A3 migrazione ripetibile: user_version riportata a 0 su un database pieno", async () => {
  const primo = await avvia("aaaa3333");
  await primo.app.registra("note", "n1", "crea", {}, proiettaNotaCrea("n1", "T", "testo", false));
  // Simula l'app uccisa a meta migrazione: lo schema c'e, il numero di versione no.
  await primo.base.execAsync("PRAGMA user_version = 0");
  await primo.base.closeAsync();

  const secondo = await avvia("aaaa3333", primo.cartella);
  const v = await secondo.base.getFirstAsync("PRAGMA user_version");
  ok(`la migrazione rigira senza errori e riporta la versione a ${secondo.app.SCHEMA_VERSIONE}`,
    v.user_version === secondo.app.SCHEMA_VERSIONE, String(v.user_version));
  ok("CREATE TABLE IF NOT EXISTS non ha cancellato l'evento", (await contaEventi(secondo.base)) === 1);
  ok("ne la nota", (await secondo.base.getFirstAsync("SELECT testo FROM note WHERE id='n1'")).testo === "testo");
});

await prova("DIFETTO RIPRODOTTO: A4 user_version futura, apri() non rifiuta (MIG-03)", async () => {
  const primo = await avvia("aaaa4444");
  await primo.base.execAsync("PRAGMA user_version = 99");
  await primo.base.closeAsync();

  let errore = null;
  let secondo = null;
  try {
    secondo = await avvia("aaaa4444", primo.cartella);
  } catch (e) {
    errore = String(e?.message ?? e);
  }
  ok("apri() NON rifiuta uno schema piu recente di quello che conosce", errore === null, String(errore));
  const v = await secondo.base.getFirstAsync("PRAGMA user_version");
  ok("user_version resta 99: nessun declassamento, nessun avviso", v.user_version === 99, String(v.user_version));
  const h = await secondo.app.registra("note", "n1", "crea", {}, proiettaNotaCrea("n1", "T", "t", false));
  ok("e l'app scrive comunque nel registro", typeof h === "string" && h.length > 0);
});

await prova("DIFETTO RIPRODOTTO: A5 apri() due volte con dispositivi diversi (MIG-06)", async () => {
  const { app, base } = await avvia("prima111");
  const stessa = await app.apri("SECONDO2");
  ok("la seconda apri() restituisce lo stesso database", stessa === base);
  const h = await app.registra("note", "n1", "crea", {}, proiettaNotaCrea("n1", null, "t", false));
  const ev = await base.getFirstAsync("SELECT dispositivo FROM eventi WHERE entita_id='n1'");
  ok("il secondo identificativo e ignorato in silenzio: resta il primo",
    ev.dispositivo === "prima111", ev.dispositivo);
  ok("e finisce anche dentro la stringa hlc", h.endsWith("-prima111"), h);
});

await prova("A6 registra() prima di apri(): errore in italiano e nessun effetto", async () => {
  const app = await moduloVergine();
  await lancia(
    "registra() lo dice in italiano",
    () => app.registra("note", "n1", "crea", {}, async () => {}),
    "Database non aperto: chiamare apri() all'avvio."
  );
  await lancia("database() lo dice in italiano", async () => app.database(),
    "Database non aperto: chiamare apri() all'avvio.");
  await lancia("daSincronizzare() lo dice in italiano", () => app.daSincronizzare(),
    "Database non aperto: chiamare apri() all'avvio.");
  await lancia("segnaSincronizzati() con id lo dice in italiano", () => app.segnaSincronizzati(["x"]),
    "Database non aperto: chiamare apri() all'avvio.");
  ok("segnaSincronizzati([]) esce prima del controllo e non lancia",
    (await app.segnaSincronizzati([]).then(() => true, () => false)));
  await lancia("timbro() senza orologio lo dice in italiano", async () => app.timbro(),
    "Orologio non inizializzato.");
  ok("derivaSospetta() senza orologio risponde false invece di lanciare",
    app.derivaSospetta() === false);
});

await prova("DIFETTO RIPRODOTTO: A7 database chiuso, il modulo resta convinto di averlo (REG-12)", async () => {
  const { app, base } = await avvia("chiuso11");
  await app.registra("note", "n1", "crea", {}, proiettaNotaCrea("n1", null, "t", false));
  await base.closeAsync();

  ok("non esiste nessuna chiudi() per azzerare lo stato del modulo",
    typeof app.chiudi === "undefined");
  const riaperto = await app.apri("chiuso11");
  ok("apri() restituisce la connessione CHIUSA dalla cache, non ne apre una nuova",
    riaperto === base);
  const messaggio = await lancia("registra() fallisce a livello di driver",
    () => app.registra("note", "n2", "crea", {}, proiettaNotaCrea("n2", null, "t", false)),
    "chius");
  ok("il messaggio non e quello italiano del modulo",
    !messaggio.includes("chiamare apri()"), messaggio);
});

await prova("A8 foreign_keys acceso ma nessuna chiave esterna dichiarata (MIG-08)", async () => {
  const { app, base } = await avvia("chiavi11");
  const fk = await base.getAllAsync("PRAGMA foreign_key_list('tentativi')");
  ok("tentativi non ha chiavi esterne dichiarate", fk.length === 0, JSON.stringify(fk));
  // Necessario: un tentativo puo arrivare dalla sincronizzazione prima del contenuto.
  await app.registra("tentativi", "t1", "crea", { esercizio_id: "SQL-999" },
    proiettaTentativo("t1", "SQL-999", "SELECT 1", "corretto", "identico", 3));
  ok("un tentativo su un esercizio inesistente viene accettato",
    (await base.getFirstAsync("SELECT esercizio_id FROM tentativi WHERE id='t1'")).esercizio_id === "SQL-999");
});

// ============================================================================
// B. I TRE TIPI DI EVENTO E LE CINQUE ENTITA
// ============================================================================

await prova("B1 'crea': l'utente salva una nota nuova (REG-01)", async () => {
  const { app, base } = await avvia("beta0001");
  const hlc = await app.registra("note", "nota-1", "crea",
    { titolo: "Lettura", testo: "riga", pubblicabile: 0 },
    proiettaNotaCrea("nota-1", "Lettura", "riga", false));

  const ev = await base.getFirstAsync("SELECT * FROM eventi");
  ok("un solo evento", (await contaEventi(base)) === 1);
  ok("id evento = <hlc>:<entita_id>", ev.id === hlc + ":nota-1", ev.id);
  ok("la colonna hlc coincide con il valore restituito", ev.hlc === hlc);
  ok("entita = 'note'", ev.entita === "note");
  ok("entita_id conservato", ev.entita_id === "nota-1");
  ok("tipo = 'crea'", ev.tipo === "crea");
  ok("dispositivo = quello di apri()", ev.dispositivo === "beta0001", ev.dispositivo);
  ok("payload serializzato in JSON",
    JSON.parse(ev.payload).titolo === "Lettura" && JSON.parse(ev.payload).pubblicabile === 0, ev.payload);
  ok("nasce non sincronizzato", ev.sincronizzato === 0);

  const nota = await base.getFirstAsync("SELECT * FROM note WHERE id='nota-1'");
  ok("la proiezione ha scritto la riga", nota !== null);
  ok("la riga porta lo STESSO hlc dell'evento (REG-15)", nota.hlc === hlc, String(nota?.hlc));
  ok("titolo e testo come da schermata", nota.titolo === "Lettura" && nota.testo === "riga");

  const meta = await base.getFirstAsync("SELECT valore FROM meta WHERE chiave='hlc'");
  ok("meta('hlc') e stata scritta nella stessa transazione", meta !== null);
  ok("meta('hlc') ha la forma <ms hex>-<contatore hex>", /^[0-9a-f]+-[0-9a-f]+$/.test(meta.valore), meta.valore);
  const [ms, cont] = meta.valore.split("-");
  ok("meta corrisponde all'hlc dell'ultimo evento (REG-13)",
    parseInt(ms, 16) === parseInt(hlc.split("-")[0], 16) &&
    parseInt(cont, 16) === parseInt(hlc.split("-")[1], 16), `${meta.valore} vs ${hlc}`);
  ok("la stringa hlc ha la larghezza fissa 12-4-dispositivo",
    /^[0-9a-f]{12}-[0-9a-f]{4}-beta0001$/.test(hlc), hlc);
});

await prova("B2 'aggiorna': la stessa nota risalvata, registro append-only (REG-02)", async () => {
  const { app, base } = await avvia("beta0002");
  const h1 = await app.registra("note", "nota-1", "crea", { testo: "v1" },
    proiettaNotaCrea("nota-1", "T", "v1", false));
  const creatoA = (await base.getFirstAsync("SELECT creato_a FROM note WHERE id='nota-1'")).creato_a;
  const h2 = await app.registra("note", "nota-1", "aggiorna", { testo: "v2", pubblicabile: 1 },
    proiettaNotaAggiorna("nota-1", "T", "v2", true));

  ok("due eventi nel registro, il primo intatto", (await contaEventi(base)) === 2);
  ok("l'evento 'crea' non e stato toccato",
    (await base.getFirstAsync("SELECT payload FROM eventi WHERE id=?", [h1 + ":nota-1"])).payload.includes("v1"));
  ok("il secondo evento e di tipo 'aggiorna'",
    (await base.getFirstAsync("SELECT tipo FROM eventi WHERE id=?", [h2 + ":nota-1"])).tipo === "aggiorna");
  ok("hlc crescente fra i due eventi", h2 > h1, `${h1} >= ${h2}`);

  const nota = await base.getFirstAsync("SELECT * FROM note WHERE id='nota-1'");
  ok("la riga operativa resta una sola", (await base.getFirstAsync("SELECT count(*) AS n FROM note")).n === 1);
  ok("il testo e quello nuovo", nota.testo === "v2");
  ok("pubblicabile aggiornato", nota.pubblicabile === 1);
  ok("creato_a NON cambia: l'ordine dell'elenco resta", nota.creato_a === creatoA);
  ok("l'hlc della riga e quello del secondo evento", nota.hlc === h2);
});

await prova("B3 'elimina': rimuoviVolume, la riga sparisce ma l'evento resta (REG-03)", async () => {
  const { app, base } = await avvia("beta0003");
  await app.registra("biblioteca", "vol-1", "crea", { titolo: "Manuale" },
    proiettaVolumeCrea("vol-1", "Manuale", "file:///biblioteca/vol-1.pdf", 1234));
  await app.registra("biblioteca", "vol-1", "aggiorna", { ultima_pagina: 12 }, proiettaPagina("vol-1", 12));
  const h3 = await app.registra("biblioteca", "vol-1", "elimina", {}, proiettaVolumeElimina("vol-1"));

  ok("la riga di biblioteca e sparita",
    (await base.getFirstAsync("SELECT * FROM biblioteca WHERE id='vol-1'")) === null);
  ok("i tre eventi restano nel registro",
    (await contaEventi(base, "WHERE entita='biblioteca' AND entita_id='vol-1'")) === 3);
  const ev = await base.getFirstAsync("SELECT * FROM eventi WHERE id=?", [h3 + ":vol-1"]);
  ok("l'evento di eliminazione ha payload '{}'", ev.payload === "{}", ev.payload);
  ok("tipo 'elimina'", ev.tipo === "elimina");
  ok("l'hlc dell'eliminazione e il piu alto dei tre",
    (await base.getAllAsync("SELECT hlc FROM eventi ORDER BY hlc")).at(-1).hlc === h3);
});

await prova("B4 le cinque entita che passano dal registro, una per una (REG-16)", async () => {
  const { app, base } = await avvia("beta0004");
  // La riga di ripasso nasce dal seme di caricaContenuti(), non da un evento.
  await semina(base,
    "INSERT INTO ripasso (esercizio_id, stabilita, prossima_revisione, stato) VALUES (?,?,?,?)",
    ["FLASH-1", 0, new Date().toISOString(), "nuovo"]);

  const casi = [
    ["note", "nota-x", "crea", { testo: "t" }, proiettaNotaCrea("nota-x", null, "t", false),
      "SELECT hlc FROM note WHERE id='nota-x'"],
    ["tentativi", "tent-x", "crea", { esercizio_id: "SQL-001", esito: "corretto" },
      proiettaTentativo("tent-x", "SQL-001", "SELECT 1", "corretto", "identico", 12),
      "SELECT hlc FROM tentativi WHERE id='tent-x'"],
    ["sessioni", "sess-x", "crea", { tipo: "mattina", minuti: 30 },
      proiettaSessione("sess-x", "mattina", Date.now(), 30),
      "SELECT hlc FROM sessioni WHERE id='sess-x'"],
    ["ripasso", "FLASH-1", "aggiorna", { grado: 2, stabilita: 2.2 },
      proiettaRipasso("FLASH-1", 2.2, new Date(Date.now() + 2 * 864e5).toISOString(), "ripasso"),
      null],
    ["biblioteca", "vol-x", "crea", { titolo: "V" },
      proiettaVolumeCrea("vol-x", "V", "file:///v.pdf", 9), "SELECT hlc FROM biblioteca WHERE id='vol-x'"],
  ];
  for (const [entita, id, tipo, payload, proiezione, sql] of casi) {
    const h = await app.registra(entita, id, tipo, payload, proiezione);
    const ev = await base.getFirstAsync("SELECT * FROM eventi WHERE id=?", [h + ":" + id]);
    ok(`${entita}: l'evento esiste ed e del tipo giusto`, ev !== null && ev.tipo === tipo);
    ok(`${entita}: entita corrisponde al nome della tabella bersaglio`, ev?.entita === entita);
    if (sql) {
      const riga = await base.getFirstAsync(sql);
      ok(`${entita}: la proiezione porta lo stesso hlc dell'evento`, riga?.hlc === h, String(riga?.hlc));
    }
  }
  const rip = await base.getFirstAsync("SELECT * FROM ripasso WHERE esercizio_id='FLASH-1'");
  ok("ripasso: la proiezione ha aggiornato stabilita e ripetizioni",
    rip.stabilita === 2.2 && rip.ripetizioni === 1, JSON.stringify(rip));
  ok("ripasso: stato passa a 'ripasso'", rip.stato === "ripasso");
  ok("ripasso e l'unica entita senza colonna hlc nella tabella operativa",
    (await base.getAllAsync("PRAGMA table_info('ripasso')")).every((c) => c.name !== "hlc"));
  ok("cinque entita, cinque eventi", (await contaEventi(base)) === 5);
});

await prova("B5 la proiezione vede gia il proprio evento nella transazione (REG-14)", async () => {
  const { app, base } = await avvia("beta0005");
  let vistoDentro = null;
  let tipoVisto = null;
  await app.registra("note", "nota-1", "crea", { testo: "t" }, async (d, hlc) => {
    vistoDentro = (await d.getFirstAsync("SELECT count(*) AS n FROM eventi")).n;
    tipoVisto = (await d.getFirstAsync("SELECT tipo FROM eventi WHERE hlc=?", [hlc]))?.tipo;
    await proiettaNotaCrea("nota-1", null, "t", false)(d, hlc);
  });
  ok("la proiezione conta anche l'evento corrente", vistoDentro === 1, String(vistoDentro));
  ok("e puo leggerlo per hlc", tipoVisto === "crea", String(tipoVisto));
  ok("meta('hlc') NON e ancora scritta quando gira la proiezione (arriva dopo)", true);
});

await prova("B6 payload: vuoto, con null, con undefined, con Date, enorme, unicode (REG-09/REG-10)", async () => {
  const { app, base } = await avvia("beta0006");
  const leggi = async (h, id) =>
    JSON.parse((await base.getFirstAsync("SELECT payload FROM eventi WHERE id=?", [h + ":" + id])).payload);

  const h1 = await app.registra("note", "p-vuoto", "crea", {}, proiettaNotaCrea("p-vuoto", null, "t", false));
  ok("payload {} diventa la stringa '{}'",
    (await base.getFirstAsync("SELECT payload FROM eventi WHERE id=?", [h1 + ":p-vuoto"])).payload === "{}");

  const h2 = await app.registra("biblioteca", "p-null", "crea",
    { autore: null, tema_slug: undefined, quando: new Date(0), fn: () => 1, n: 0, falso: false },
    proiettaVolumeCrea("p-null", "V", null, null));
  const p2 = await leggi(h2, "p-null");
  ok("null sopravvive", p2.autore === null);
  ok("undefined sparisce in silenzio", !("tema_slug" in p2), JSON.stringify(p2));
  ok("una funzione sparisce in silenzio", !("fn" in p2));
  ok("una Date diventa una stringa ISO, non un oggetto", p2.quando === "1970-01-01T00:00:00.000Z", String(p2.quando));
  ok("0 e false sopravvivono", p2.n === 0 && p2.falso === false);

  const lungo = "x".repeat(200000);
  const h3 = await app.registra("note", "p-lungo", "crea", { testo: lungo },
    proiettaNotaCrea("p-lungo", null, lungo, false));
  ok("un payload da 200k caratteri torna indietro intero", (await leggi(h3, "p-lungo")).testo.length === 200000);

  const strano = "accenti aeiou, trattino lungo —, euro €, emoji \u{1F642}, tabulazione \t, apice ' e \"";
  const h4 = await app.registra("note", "p-uni", "crea", { testo: strano },
    proiettaNotaCrea("p-uni", null, strano, false));
  ok("unicode e virgolette tornano indietro identici", (await leggi(h4, "p-uni")).testo === strano);
  ok("e la proiezione ha salvato la stessa stringa",
    (await base.getFirstAsync("SELECT testo FROM note WHERE id='p-uni'")).testo === strano);

  const conNul = "prima\u0000dopo";
  const h5 = await app.registra("note", "p-nul", "crea", { testo: conNul },
    proiettaNotaCrea("p-nul", null, conNul, false));
  ok("anche un carattere NUL nel payload sopravvive al giro JSON",
    (await leggi(h5, "p-nul")).testo === conNul);
});

await prova("B7 entita_id fuori dall'ordinario: con ':', vuoto, unicode", async () => {
  const { app, base } = await avvia("beta0007");
  const hA = await app.registra("note", "a:b:c", "crea", {}, proiettaNotaCrea("a:b:c", null, "t", false));
  ok("un entita_id con ':' non rompe l'id evento", hA + ":a:b:c" ===
    (await base.getFirstAsync("SELECT id FROM eventi WHERE entita_id='a:b:c'")).id);
  ok("l'hlc resta separabile dall'id: e il prefisso fino al terzo trattino",
    (await base.getFirstAsync("SELECT id FROM eventi WHERE entita_id='a:b:c'")).id.startsWith(hA + ":"));

  const hB = await app.registra("note", "", "crea", {}, proiettaNotaCrea("vuoto", null, "t", false));
  ok("un entita_id vuoto passa il NOT NULL e produce un id che finisce con ':'",
    (await base.getFirstAsync("SELECT id FROM eventi WHERE entita_id=''")).id === hB + ":");

  const hC = await app.registra("note", "né-ü-\u{1F642}", "crea", {},
    proiettaNotaCrea("uni", null, "t", false));
  ok("un entita_id unicode torna indietro identico",
    (await base.getFirstAsync("SELECT entita_id FROM eventi WHERE id=?", [hC + ":né-ü-\u{1F642}"]))
      .entita_id === "né-ü-\u{1F642}");
});

// ============================================================================
// C. ATOMICITA: LA TRANSAZIONE FALLISCE
// ============================================================================

await prova("C1 proiezione con NOT NULL violato: il blocco del cronometro va perso per intero", async () => {
  const { app, base } = await avvia("cappa001");
  await app.registra("sessioni", "s-buona", "crea", { tipo: "mattina", minuti: 30 },
    proiettaSessione("s-buona", "mattina", Date.now(), 30));
  const metaPrima = (await base.getFirstAsync("SELECT valore FROM meta WHERE chiave='hlc'")).valore;

  // SES-03: chiudiSessione() con un tipo sconosciuto restituisce minuti undefined.
  await lancia("l'errore di SQLite risale al chiamante",
    () => app.registra("sessioni", "s-rotta", "crea", { tipo: "ignoto", minuti: undefined },
      proiettaSessione("s-rotta", "ignoto", Date.now(), undefined)),
    "NOT NULL constraint failed: sessioni.minuti");

  ok("nessun evento orfano", (await contaEventi(base, "WHERE entita_id='s-rotta'")) === 0);
  ok("nessuna sessione a meta", (await base.getFirstAsync("SELECT * FROM sessioni WHERE id='s-rotta'")) === null);
  ok("la sessione buona di prima e intatta",
    (await base.getFirstAsync("SELECT minuti FROM sessioni WHERE id='s-buona'")).minuti === 30);
  ok("meta('hlc') non e avanzata",
    (await base.getFirstAsync("SELECT valore FROM meta WHERE chiave='hlc'")).valore === metaPrima);
  ok("non si resta dentro una transazione", (await base.isInTransactionAsync()) === false);
});

await prova("C2 proiezione che viola il CHECK su biblioteca.origine (MIG-07)", async () => {
  const { app, base } = await avvia("cappa002");
  await lancia("il CHECK dello schema respinge l'origine sconosciuta",
    () => app.registra("biblioteca", "v-rotto", "crea", { origine: "scaricata" }, async (d, hlc) => {
      await d.runAsync(
        `INSERT INTO biblioteca (id, titolo, origine, aggiunto_a, hlc) VALUES (?,?,?,?,?)`,
        ["v-rotto", "V", "scaricata", new Date().toISOString(), hlc]);
    }),
    "CHECK constraint failed");
  ok("nessun evento", (await contaEventi(base)) === 0);
  ok("nessuna riga di biblioteca", (await base.getFirstAsync("SELECT * FROM biblioteca")) === null);
  ok("meta('hlc') non e mai nata", (await base.getFirstAsync("SELECT * FROM meta")) === null);
});

await prova("C3 tipo di evento fuori dai tre ammessi: il CHECK ferma tutto prima della proiezione", async () => {
  const { app, base } = await avvia("cappa003");
  let proiezioneChiamata = false;
  await lancia("il CHECK su eventi.tipo respinge 'sostituisci'",
    () => app.registra("note", "n1", "sostituisci", {}, async (d, hlc) => {
      proiezioneChiamata = true;
      await proiettaNotaCrea("n1", null, "t", false)(d, hlc);
    }),
    "CHECK constraint failed");
  ok("la proiezione non e stata nemmeno chiamata", proiezioneChiamata === false);
  ok("nessun evento", (await contaEventi(base)) === 0);
  ok("nessuna nota", (await base.getFirstAsync("SELECT * FROM note")) === null);
  await lancia("nemmeno la maiuscola passa ('Crea')",
    () => app.registra("note", "n2", "Crea", {}, proiettaNotaCrea("n2", null, "t", false)),
    "CHECK constraint failed");
  ok("dopo i due rifiuti il registro riprende a scrivere",
    typeof (await app.registra("note", "n3", "crea", {}, proiettaNotaCrea("n3", null, "t", false))) === "string");
});

await prova("C4 payload non serializzabile in JSON: riferimento circolare e BigInt (REG-09)", async () => {
  const { app, base } = await avvia("cappa004");
  await app.registra("note", "n0", "crea", {}, proiettaNotaCrea("n0", null, "ok", false));
  const metaPrima = (await base.getFirstAsync("SELECT valore FROM meta WHERE chiave='hlc'")).valore;

  const circolare = { titolo: "x" };
  circolare.se_stesso = circolare;
  let proiezioneChiamata = false;
  await lancia("JSON.stringify lancia dentro la transazione",
    () => app.registra("note", "n-circ", "crea", circolare, async (d, hlc) => {
      proiezioneChiamata = true;
      await proiettaNotaCrea("n-circ", null, "t", false)(d, hlc);
    }),
    "circular");
  ok("la proiezione non viene raggiunta", proiezioneChiamata === false);
  ok("nessun evento circolare", (await contaEventi(base, "WHERE entita_id='n-circ'")) === 0);
  ok("nessuna nota circolare", (await base.getFirstAsync("SELECT * FROM note WHERE id='n-circ'")) === null);

  await lancia("un BigInt nel payload lancia allo stesso modo",
    () => app.registra("note", "n-big", "crea", { n: 10n },
      proiettaNotaCrea("n-big", null, "t", false)),
    "BigInt");
  ok("nessun evento BigInt", (await contaEventi(base, "WHERE entita_id='n-big'")) === 0);
  ok("meta('hlc') e rimasta al valore dell'ultima scrittura riuscita",
    (await base.getFirstAsync("SELECT valore FROM meta WHERE chiave='hlc'")).valore === metaPrima);
  ok("non si resta dentro una transazione", (await base.isInTransactionAsync()) === false);
  ok("il registro riprende subito",
    typeof (await app.registra("note", "n1", "crea", {}, proiettaNotaCrea("n1", null, "t", false))) === "string");
  ok("e alla fine restano solo i due eventi riusciti", (await contaEventi(base)) === 2);
});

await prova("C5 la proiezione scrive su una tabella che non esiste", async () => {
  const { app, base } = await avvia("cappa005");
  await lancia("l'errore di SQLite arriva al chiamante",
    () => app.registra("note", "n1", "crea", {}, async (d) => {
      await d.runAsync("INSERT INTO tabella_mai_creata (id) VALUES (1)");
    }),
    "no such table");
  ok("nessun evento resta", (await contaEventi(base)) === 0);
  ok("non si resta dentro una transazione", (await base.isInTransactionAsync()) === false);
});

await prova("C6 la proiezione fallisce DOPO aver scritto su due tabelle diverse", async () => {
  const { app, base } = await avvia("cappa006");
  await semina(base,
    "INSERT INTO ripasso (esercizio_id, stabilita, prossima_revisione, stato) VALUES (?,?,?,?)",
    ["FLASH-1", 1, "2026-01-01T00:00:00.000Z", "nuovo"]);
  await lancia("l'eccezione JS pura risale",
    () => app.registra("ripasso", "FLASH-1", "aggiorna", { grado: 3 }, async (d, hlc) => {
      await proiettaRipasso("FLASH-1", 3.4, "2026-02-01T00:00:00.000Z", "ripasso")(d, hlc);
      await d.runAsync("INSERT INTO tentativi (id, esercizio_id, esito, eseguito_a, hlc) VALUES (?,?,?,?,?)",
        ["t-orfano", "FLASH-1", "corretto", new Date().toISOString(), hlc]);
      throw new Error("interruzione a meta proiezione");
    }),
    "interruzione a meta proiezione");
  const rip = await base.getFirstAsync("SELECT * FROM ripasso WHERE esercizio_id='FLASH-1'");
  ok("l'aggiornamento del ripasso e stato annullato", rip.stabilita === 1 && rip.ripetizioni === 0,
    JSON.stringify(rip));
  ok("la prossima revisione e quella del seme", rip.prossima_revisione === "2026-01-01T00:00:00.000Z");
  ok("il tentativo scritto prima dell'errore e sparito",
    (await base.getFirstAsync("SELECT * FROM tentativi WHERE id='t-orfano'")) === null);
  ok("nessun evento", (await contaEventi(base)) === 0);
});

await prova("C7 una seconda connessione allo stesso file non vede mai lo stato intermedio", async () => {
  const { app, base, cartella } = await avvia("cappa007");
  const { openDatabaseSync } = await import("../banco/expo-sqlite.mjs");
  const spia = openDatabaseSync("percorso.db", { useNewConnection: true }, cartella);
  ok("la spia e una connessione diversa", spia !== base);

  let vistoDaFuori = null;
  await lancia("la transazione fallisce dopo aver scritto",
    () => app.registra("note", "n1", "crea", { testo: "t" }, async (d, hlc) => {
      await proiettaNotaCrea("n1", null, "t", false)(d, hlc);
      vistoDaFuori = spia.getFirstSync("SELECT count(*) AS n FROM note").n;
      throw new Error("caduta voluta");
    }),
    "caduta voluta");
  ok("durante la transazione la spia NON vede la riga non confermata", vistoDaFuori === 0, String(vistoDaFuori));
  ok("dopo il rollback la spia non trova la nota", spia.getFirstSync("SELECT count(*) AS n FROM note").n === 0);
  ok("ne l'evento", spia.getFirstSync("SELECT count(*) AS n FROM eventi").n === 0);
  await app.registra("note", "n2", "crea", {}, proiettaNotaCrea("n2", null, "t", false));
  ok("mentre l'evento confermato la spia lo vede", spia.getFirstSync("SELECT count(*) AS n FROM eventi").n === 1);
  spia.closeSync();
});

// ============================================================================
// D. DIVERGENZE CHE IL CODICE PERMETTE
// ============================================================================

await prova("DIFETTO RIPRODOTTO: D1 proiezione che non tocca nessuna riga (REG-08)", async () => {
  const { app, base } = await avvia("delta001");
  // salvaPagina() su un volume che non esiste: succede se il volume e stato
  // eliminato sull'altro dispositivo mentre qui il lettore era aperto.
  const h = await app.registra("biblioteca", "vol-fantasma", "aggiorna", { ultima_pagina: 7 },
    proiettaPagina("vol-fantasma", 7));
  ok("l'evento viene scritto", (await contaEventi(base, "WHERE entita_id='vol-fantasma'")) === 1);
  ok("ma nessuna riga esiste: registro e stato operativo divergono",
    (await base.getFirstAsync("SELECT * FROM biblioteca WHERE id='vol-fantasma'")) === null);
  ok("nessun errore e stato sollevato", typeof h === "string");

  // Stessa forma su ripasso: valuta() su una carta senza riga in ripasso.
  await app.registra("ripasso", "FLASH-MAI", "aggiorna", { grado: 0, stabilita: 0 },
    proiettaRipasso("FLASH-MAI", 0, new Date().toISOString(), "ricaduta"));
  ok("anche la valutazione di una carta inesistente entra nel registro",
    (await contaEventi(base, "WHERE entita='ripasso'")) === 1);
  ok("senza creare nessuna riga di ripasso",
    (await base.getFirstAsync("SELECT * FROM ripasso")) === null);

  // E su un'eliminazione di qualcosa che non c'e.
  await app.registra("biblioteca", "vol-mai", "elimina", {}, proiettaVolumeElimina("vol-mai"));
  ok("un'eliminazione a vuoto viene comunque registrata e si propaghera all'altro dispositivo",
    (await contaEventi(base, "WHERE tipo='elimina'")) === 1);
});

await prova("DIFETTO RIPRODOTTO: D2 nessun controllo sul nome dell'entita", async () => {
  const { app, base } = await avvia("delta002");
  const h = await app.registra("tabella_inesistente", "x", "crea", { a: 1 }, async () => {});
  ok("un'entita che non corrisponde a nessuna tabella viene accettata",
    (await base.getFirstAsync("SELECT entita FROM eventi WHERE id=?", [h + ":x"])).entita === "tabella_inesistente");
  const h2 = await app.registra("", "y", "crea", {}, async () => {});
  ok("perfino un'entita vuota passa il NOT NULL",
    (await base.getFirstAsync("SELECT entita FROM eventi WHERE id=?", [h2 + ":y"])).entita === "");
  ok("e una proiezione che non fa niente non e un errore", (await contaEventi(base)) === 2);
});

// ============================================================================
// E. OROLOGIO E REGISTRO
// ============================================================================

await prova("E1 venticinque scritture di fila: hlc distinti, crescenti e ordinabili come stringhe", async () => {
  const { app, base } = await avvia("echo0001");
  const emessi = [];
  for (let i = 0; i < 25; i++) {
    emessi.push(await app.registra("note", "n" + i, "crea", { i },
      proiettaNotaCrea("n" + i, null, "riga " + i, false)));
  }
  ok("venticinque hlc tutti distinti", new Set(emessi).size === 25);
  ok("strettamente crescenti", emessi.every((h, i) => i === 0 || h > emessi[i - 1]));
  const ordinati = [...emessi].sort();
  ok("l'ordine lessicografico coincide con l'ordine di emissione",
    ordinati.join("|") === emessi.join("|"));
  const daDb = (await base.getAllAsync("SELECT hlc FROM eventi ORDER BY hlc")).map((r) => r.hlc);
  ok("ORDER BY hlc restituisce lo stesso ordine", daDb.join("|") === emessi.join("|"));
  ok("tutti con la stessa larghezza (12-4-dispositivo)",
    emessi.every((h) => /^[0-9a-f]{12}-[0-9a-f]{4}-echo0001$/.test(h)));
});

await prova("E2 due scritture nello stesso millisecondo: il contatore le separa", async () => {
  const { app, base } = await avvia("echo0002");
  congelaOra(1_800_000_000_000);
  try {
    const h1 = await app.registra("note", "n1", "crea", {}, proiettaNotaCrea("n1", null, "a", false));
    const h2 = await app.registra("note", "n2", "crea", {}, proiettaNotaCrea("n2", null, "b", false));
    const h3 = await app.registra("note", "n1", "aggiorna", {}, proiettaNotaAggiorna("n1", null, "c", false));
    ok("stesso millisecondo per tutti e tre",
      h1.split("-")[0] === h2.split("-")[0] && h2.split("-")[0] === h3.split("-")[0]);
    ok("contatore 0, 1, 2", h1.split("-")[1] === "0000" && h2.split("-")[1] === "0001" &&
      h3.split("-")[1] === "0002", [h1, h2, h3].join(" "));
    ok("tre id evento distinti anche sulla stessa entita",
      (await contaEventi(base)) === 3);
    ok("l'ordine lessicografico regge dentro il millisecondo", h1 < h2 && h2 < h3);
  } finally {
    scongelaOra();
  }
});

await prova("E3 riavvio con l'ora di sistema tornata indietro di due ore (HLC-08)", async () => {
  const primo = await avvia("echo0003");
  congelaOra(1_800_000_000_000);
  let ultimoPrima;
  try {
    ultimoPrima = await primo.app.registra("note", "n1", "crea", {}, proiettaNotaCrea("n1", null, "a", false));
  } finally {
    scongelaOra();
  }
  await primo.base.closeAsync();

  congelaOra(1_800_000_000_000 - 2 * 3600_000); // due ore indietro, come un fuso sbagliato
  try {
    const secondo = await avvia("echo0003", primo.cartella);
    const dopo = await secondo.app.registra("note", "n2", "crea", {}, proiettaNotaCrea("n2", null, "b", false));
    ok("il nuovo timbro NON regredisce", dopo > ultimoPrima, `${dopo} <= ${ultimoPrima}`);
    ok("resta lo stesso millisecondo di prima, avanza il contatore",
      dopo.split("-")[0] === ultimoPrima.split("-")[0] &&
      parseInt(dopo.split("-")[1], 16) === parseInt(ultimoPrima.split("-")[1], 16) + 1, dopo);
    ok("nessun id evento duplicato dopo il riavvio",
      (await contaEventi(secondo.base)) === 2);
    ok("l'ordinamento del registro resta quello causale",
      (await secondo.base.getAllAsync("SELECT entita_id FROM eventi ORDER BY hlc"))
        .map((r) => r.entita_id).join(",") === "n1,n2");
  } finally {
    scongelaOra();
  }
});

await prova("E4 traboccamento del contatore a ora ferma: ms+1 e larghezza invariata (HLC-05)", async () => {
  const primo = await avvia("echo0004");
  await primo.app.registra("note", "seme", "crea", {}, proiettaNotaCrea("seme", null, "s", false));
  const msFuturo = Date.now() + 3600_000; // l'ora fisica non lo supera: si va di contatore
  await primo.base.runAsync("UPDATE meta SET valore = ? WHERE chiave='hlc'",
    [msFuturo.toString(16) + "-ffff"]);
  await primo.base.closeAsync();

  const secondo = await avvia("echo0004", primo.cartella);
  const h = await secondo.app.registra("note", "n1", "crea", {}, proiettaNotaCrea("n1", null, "a", false));
  ok("il contatore torna a 0", h.split("-")[1] === "0000", h);
  ok("e il millisecondo avanza di uno", parseInt(h.split("-")[0], 16) === msFuturo + 1, h);
  ok("la larghezza serializzata resta 12-4", /^[0-9a-f]{12}-[0-9a-f]{4}-/.test(h), h);
  const h2 = await secondo.app.registra("note", "n2", "crea", {}, proiettaNotaCrea("n2", null, "b", false));
  ok("l'ordinamento lessicografico sopravvive al traboccamento", h2 > h, `${h} >= ${h2}`);
});

await prova("DIFETTO RIPRODOTTO: E5 meta('hlc') vuota: l'orologio diventa NaN per sempre (HLC-07)", async () => {
  const primo = await avvia("echonan1");
  await primo.app.registra("note", "seme", "crea", {}, proiettaNotaCrea("seme", null, "s", false));
  await primo.base.runAsync("UPDATE meta SET valore = '' WHERE chiave='hlc'");
  await primo.base.closeAsync();

  const secondo = await avvia("echonan1", primo.cartella);
  const h1 = await secondo.app.registra("note", "n1", "crea", {}, proiettaNotaCrea("n1", null, "1", false));
  ok("il timbro contiene NaN al posto del millisecondo", h1 === "000000000NaN-0NaN-echonan1", h1);
  ok("e la riga proiettata porta quell'hlc",
    (await secondo.base.getFirstAsync("SELECT hlc FROM note WHERE id='n1'")).hlc === h1);
  ok("meta('hlc') diventa 'NaN-NaN': il guasto si autoconserva",
    (await secondo.base.getFirstAsync("SELECT valore FROM meta WHERE chiave='hlc'")).valore === "NaN-NaN");

  // Seconda scrittura sulla STESSA entita: stesso timbro, stesso id evento.
  await lancia("la seconda scrittura sulla stessa entita viola la chiave primaria (REG-05)",
    () => secondo.app.registra("note", "n1", "aggiorna", { testo: "2" },
      proiettaNotaAggiorna("n1", null, "2", false)),
    "UNIQUE constraint failed: eventi.id");
  ok("e la proiezione e stata annullata: il testo resta quello di prima",
    (await secondo.base.getFirstAsync("SELECT testo FROM note WHERE id='n1'")).testo === "1");
  ok("l'evento resta uno solo", (await contaEventi(secondo.base, "WHERE entita_id='n1'")) === 1);

  // Entita DIVERSA, stesso entita_id: l'id evento non contiene l'entita.
  await lancia("un'altra entita con lo stesso entita_id collide sullo stesso id evento",
    () => secondo.app.registra("sessioni", "n1", "crea", { tipo: "mattina", minuti: 30 },
      proiettaSessione("n1", "mattina", Date.now(), 30)),
    "UNIQUE constraint failed: eventi.id");
  ok("nessuna sessione scritta", (await secondo.base.getFirstAsync("SELECT * FROM sessioni")) === null);

  // Entita_id diverso: passa, ma con lo stesso hlc del precedente.
  const h2 = await secondo.app.registra("note", "n2", "crea", {}, proiettaNotaCrea("n2", null, "x", false));
  ok("un'entita nuova passa, ma con un hlc IDENTICO al precedente", h2 === h1, `${h1} / ${h2}`);
  ok("due eventi con lo stesso hlc: ORDER BY hlc non li sa piu ordinare",
    (await secondo.base.getAllAsync("SELECT hlc FROM eventi WHERE hlc = ?", [h1])).length === 2);

  // Il riavvio non guarisce.
  await secondo.base.closeAsync();
  const terzo = await avvia("echonan1", primo.cartella);
  const h3 = await terzo.app.registra("note", "n3", "crea", {}, proiettaNotaCrea("n3", null, "y", false));
  ok("dopo un altro riavvio il timbro e ancora NaN: serve disinstallare", h3 === h1, h3);
});

await prova("E6 meta('hlc') corrotta negli altri tre modi: due guariscono, uno no", async () => {
  // 'ciao': parseInt si ferma alla 'c' -> ms 12, l'ora fisica lo supera e l'orologio riparte.
  const a = await avvia("echorec1");
  await a.app.registra("note", "seme", "crea", {}, proiettaNotaCrea("seme", null, "s", false));
  await a.base.runAsync("UPDATE meta SET valore='ciao' WHERE chiave='hlc'");
  await a.base.closeAsync();
  const a2 = await avvia("echorec1", a.cartella);
  const hA = await a2.app.registra("note", "n1", "crea", {}, proiettaNotaCrea("n1", null, "a", false));
  ok("'ciao': l'ora fisica supera il valore letto e l'orologio si rimette in riga",
    /^[0-9a-f]{12}-0000-echorec1$/.test(hA), hA);

  // valore con piu di due segmenti: i primi due parsano, il resto e ignorato.
  const b = await avvia("echorec2");
  await b.app.registra("note", "seme", "crea", {}, proiettaNotaCrea("seme", null, "s", false));
  await b.base.runAsync("UPDATE meta SET valore='18f3-2-dispositivo-per-errore' WHERE chiave='hlc'");
  await b.base.closeAsync();
  const b2 = await avvia("echorec2", b.cartella);
  const hB = await b2.app.registra("note", "n1", "crea", {}, proiettaNotaCrea("n1", null, "a", false));
  ok("hlc intero salvato per errore in meta: caso benigno, si riparte dall'ora fisica",
    /^[0-9a-f]{12}-0000-echorec2$/.test(hB), hB);

  // 'zz-1': ms NaN ma contatore valido -> gli id restano unici, l'ORDINE no.
  const c = await avvia("echorec3");
  const primaDelGuasto = await c.app.registra("note", "seme", "crea", {},
    proiettaNotaCrea("seme", null, "s", false));
  await c.base.runAsync("UPDATE meta SET valore='zz-1' WHERE chiave='hlc'");
  await c.base.closeAsync();
  const c2 = await avvia("echorec3", c.cartella);
  const hC1 = await c2.app.registra("note", "n1", "crea", {}, proiettaNotaCrea("n1", null, "a", false));
  const hC2 = await c2.app.registra("note", "n2", "crea", {}, proiettaNotaCrea("n2", null, "b", false));
  ok("'zz-1': il millisecondo resta NaN ma il contatore avanza, quindi gli id sono unici",
    hC1 !== hC2 && hC1.startsWith("000000000NaN-"), `${hC1} / ${hC2}`);
  ok("DIFETTO: i nuovi eventi ordinano PRIMA di quelli vecchi ('0' < '1')",
    hC1 < primaDelGuasto, `${hC1} >= ${primaDelGuasto}`);
  const ordine = (await c2.base.getAllAsync("SELECT entita_id FROM eventi ORDER BY hlc")).map((r) => r.entita_id);
  ok("ORDER BY hlc mette il seme per ultimo, al contrario della causalita",
    ordine.join(",") === "n1,n2,seme", ordine.join(","));
});

await prova("E7 il timbro consumato da una registra() fallita lascia un buco (REG-13)", async () => {
  const { app, base } = await avvia("echo0007");
  const h1 = await app.registra("note", "n1", "crea", {}, proiettaNotaCrea("n1", null, "a", false));
  const metaDopoUno = (await base.getFirstAsync("SELECT valore FROM meta WHERE chiave='hlc'")).valore;
  await lancia("una registra() che fallisce", () =>
    app.registra("note", "n2", "crea", {}, async () => { throw new Error("caduta"); }), "caduta");
  ok("meta('hlc') sul disco NON avanza", 
    (await base.getFirstAsync("SELECT valore FROM meta WHERE chiave='hlc'")).valore === metaDopoUno);
  const h2 = await app.registra("note", "n3", "crea", {}, proiettaNotaCrea("n3", null, "c", false));
  ok("il timbro successivo e comunque maggiore del primo", h2 > h1);
  const distanza = parseInt(h2.split("-")[1], 16) - parseInt(h1.split("-")[1], 16);
  ok("il buco esiste solo se i tre timbri cadono nello stesso ms (contatore saltato)",
    h2.split("-")[0] !== h1.split("-")[0] || distanza === 2, `distanza contatore ${distanza}`);
  ok("nel registro restano due soli eventi", (await contaEventi(base)) === 2);
  ok("e l'orologio salvato corrisponde all'ultimo evento committato",
    parseInt((await base.getFirstAsync("SELECT valore FROM meta WHERE chiave='hlc'")).valore.split("-")[0], 16)
      === parseInt(h2.split("-")[0], 16));
});

await prova("DIFETTO RIPRODOTTO: E8 identificativo dispositivo con trattino (HLC-11)", async () => {
  const { app, base } = await avvia("dev-uno");
  const { deserializza } = await import("../../lib/hlc.ts");
  const h = await app.registra("note", "n1", "crea", {}, proiettaNotaCrea("n1", null, "a", false));
  const ev = await base.getFirstAsync("SELECT dispositivo, hlc FROM eventi");
  ok("la colonna dispositivo conserva l'identificativo intero", ev.dispositivo === "dev-uno");
  ok("ma deserializza() lo tronca al primo trattino",
    deserializza(ev.hlc).dispositivo === "dev", deserializza(ev.hlc).dispositivo);
  ok("cioe la colonna e la stringa hlc non concordano piu",
    deserializza(ev.hlc).dispositivo !== ev.dispositivo);
  ok("l'app oggi genera id di soli esadecimali, quindi il difetto e latente",
    /^[0-9a-f]{8}$/.test("a1b2c3d4"));
});

await prova("E9 il millisecondo negativo non e raggiungibile da apri() (HLC-12)", async () => {
  const { serializza, deserializza } = await import("../../lib/hlc.ts");
  const rotto = serializza({ ms: -5, contatore: 0, dispositivo: "dev1" });
  ok("serializza() con ms negativo produce quattro segmenti", rotto.split("-").length === 4, rotto);
  ok("e deserializza() restituisce un dispositivo sbagliato",
    deserializza(rotto).dispositivo === "0000", deserializza(rotto).dispositivo);
  // Per arrivarci da lib/db.ts servirebbe meta = '-5-0', che pero da NaN.
  const primo = await avvia("echo0009");
  await primo.app.registra("note", "seme", "crea", {}, proiettaNotaCrea("seme", null, "s", false));
  await primo.base.runAsync("UPDATE meta SET valore='-5-0' WHERE chiave='hlc'");
  await primo.base.closeAsync();
  const secondo = await avvia("echo0009", primo.cartella);
  const h = await secondo.app.registra("note", "n1", "crea", {}, proiettaNotaCrea("n1", null, "a", false));
  ok("meta '-5-0' non produce un ms negativo ma il guasto NaN gia noto",
    h.startsWith("000000000NaN-"), h);
});

await prova("E10 il costruttore di Orologio modifica lo stato che riceve (HLC-13)", async () => {
  const { Orologio } = await import("../../lib/hlc.ts");
  const statoCondiviso = { ms: 10, contatore: 0, dispositivo: "originale" };
  const o = new Orologio("nuovo", statoCondiviso);
  ok("il campo dispositivo dell'oggetto del chiamante viene riscritto",
    statoCondiviso.dispositivo === "nuovo", statoCondiviso.dispositivo);
  ok("l'orologio usa comunque il dispositivo passato al costruttore",
    o.corrente.dispositivo === "nuovo");
  ok("in apri() si passa un oggetto letterale nuovo, quindi oggi e innocuo", true);
});

// ============================================================================
// F. CONCORRENZA
// ============================================================================

await prova("CORREZIONE SORVEGLIATA: F1 due registra() senza await intermedio (REG-06)", async () => {
  const { app, base } = await avvia("foxtrot1");
  // La seconda proiezione annota cosa vede quando tocca a lei. Con la coda la
  // prima transazione e gia COMMITTATA, quindi vede la riga E il suo evento:
  // e la prova che le due non si sono mai sovrapposte. Senza coda non ci
  // arriverebbe nemmeno, perche il suo BEGIN fallirebbe prima.
  let vistoDallaSeconda = null;
  const esiti = await Promise.allSettled([
    app.registra("note", "n1", "crea", { testo: "a" }, proiettaNotaCrea("n1", null, "a", false)),
    app.registra("note", "n2", "crea", { testo: "b" }, async (d, hlc) => {
      vistoDallaSeconda = {
        note: (await d.getFirstAsync("SELECT count(*) AS n FROM note")).n,
        eventoDellaPrima: (await d.getFirstAsync(
          "SELECT count(*) AS n FROM eventi WHERE entita_id='n1'")).n,
      };
      await proiettaNotaCrea("n2", null, "b", false)(d, hlc);
    }),
  ]);
  const motivi = esiti.map((e) => (e.status === "rejected" ? e.reason.message : "riuscita"));
  corretto("le due scritture riescono entrambe",
    esiti.every((e) => e.status === "fulfilled"), motivi.join(" | "));
  const [h1, h2] = esiti.map((e) => (e.status === "fulfilled" ? e.value : null));
  corretto("la coda le serve in ordine di arrivo: due timbri distinti e crescenti",
    typeof h1 === "string" && typeof h2 === "string" && h1 < h2, `${h1} / ${h2}`);
  corretto("quando tocca alla seconda, la prima e gia chiusa: riga e evento entrambi visibili",
    vistoDallaSeconda !== null && vistoDallaSeconda.note === 1 &&
      vistoDallaSeconda.eventoDellaPrima === 1, JSON.stringify(vistoDallaSeconda));

  const eventi = await contaEventi(base);
  const note = (await base.getAllAsync("SELECT id FROM note ORDER BY id")).map((r) => r.id);
  corretto("due eventi nel registro", eventi === 2, `eventi=${eventi}`);
  corretto("due righe proiettate, una per chiamata", note.join(",") === "n1,n2", note.join(","));
  const orfane = await base.getFirstAsync(
    "SELECT count(*) AS n FROM note WHERE hlc NOT IN (SELECT hlc FROM eventi)");
  corretto("INVARIANTE 1: nessuna riga operativa senza il suo evento", orfane.n === 0, String(orfane.n));
  const senzaRiga = await base.getFirstAsync(
    "SELECT count(*) AS n FROM eventi WHERE hlc NOT IN (SELECT hlc FROM note)");
  const appaiati = await base.getFirstAsync(
    "SELECT count(*) AS n FROM eventi e JOIN note t ON t.hlc = e.hlc");
  // Il solo "nessuno spaiato" sarebbe vero anche con il registro VUOTO, cioe
  // proprio nel caso peggiore: si pretende anche il numero di coppie.
  corretto("e nessun evento senza la sua riga: due coppie evento-riga, nessuna spaiata",
    senzaRiga.n === 0 && appaiati.n === 2, `spaiati=${senzaRiga.n} coppie=${appaiati.n}`);

  const meta = await base.getFirstAsync("SELECT valore FROM meta WHERE chiave='hlc'");
  const [ms, cont] = String(meta?.valore).split("-");
  corretto("meta('hlc') e ferma sul timbro dell'ULTIMO evento committato, non oltre",
    meta !== null && parseInt(ms, 16) === parseInt(String(h2).split("-")[0], 16) &&
      parseInt(cont, 16) === parseInt(String(h2).split("-")[1], 16), `${meta?.valore} vs ${h2}`);
  ok("non si resta dentro una transazione", (await base.isInTransactionAsync()) === false);

  const h3 = await app.registra("note", "n3", "crea", {}, proiettaNotaCrea("n3", null, "c", false));
  ok("dopo il doppio tocco il registro continua a scrivere", typeof h3 === "string");
  corretto("tre note e tre eventi: nessuna riga orfana e rimasta sul disco",
    (await base.getFirstAsync("SELECT count(*) AS n FROM note")).n === 3 &&
      (await contaEventi(base)) === 3);
});

await prova("CORREZIONE SORVEGLIATA: F2 tre registra() sovrapposte (doppio tocco su Salva)", async () => {
  const { app, base } = await avvia("foxtrot2");
  // Ogni proiezione annota quante sessioni GIA COMMITTATE vede prima di
  // scrivere la propria. Con la coda la sequenza e 0, 1, 2: una transazione
  // per volta, in ordine di arrivo. E il conto che nessuna finta serializzazione
  // puo produrre per caso.
  const visto = [];
  const conSpia = (id, tipo, minuti) => async (d, hlc) => {
    visto.push((await d.getFirstAsync("SELECT count(*) AS n FROM sessioni")).n);
    await proiettaSessione(id, tipo, Date.now(), minuti)(d, hlc);
  };
  const esiti = await Promise.allSettled([
    app.registra("sessioni", "s1", "crea", { tipo: "mattina", minuti: 30 }, conSpia("s1", "mattina", 30)),
    app.registra("sessioni", "s2", "crea", { tipo: "lettura", minuti: 25 }, conSpia("s2", "lettura", 25)),
    app.registra("sessioni", "s3", "crea", { tipo: "paper", minuti: 25 }, conSpia("s3", "paper", 25)),
  ]);
  const motivi = esiti.map((e) => (e.status === "rejected" ? e.reason.message : "riuscita"));
  const riuscite = esiti.filter((e) => e.status === "fulfilled").length;
  corretto("tutte e tre arrivano in fondo", riuscite === 3, motivi.join(" | "));
  corretto("una transazione per volta: le proiezioni vedono 0, poi 1, poi 2 sessioni committate",
    visto.join(",") === "0,1,2", visto.join(","));

  corretto("tre eventi nel registro", (await contaEventi(base)) === 3);
  const sessioni = (await base.getAllAsync("SELECT id FROM sessioni ORDER BY id")).map((r) => r.id);
  corretto("tre blocchi del cronometro sul disco", sessioni.join(",") === "s1,s2,s3", sessioni.join(","));
  const orfane = await base.getFirstAsync(
    "SELECT count(*) AS n FROM sessioni WHERE hlc NOT IN (SELECT hlc FROM eventi)");
  corretto("INVARIANTE 1: nessuna sessione senza il suo evento", orfane.n === 0, String(orfane.n));
  const ordine = (await base.getAllAsync(
    "SELECT entita_id FROM eventi ORDER BY hlc")).map((r) => r.entita_id);
  corretto("ORDER BY hlc restituisce l'ordine dei tocchi, non un ordine qualsiasi",
    ordine.join(",") === "s1,s2,s3", ordine.join(","));
  ok("non si resta dentro una transazione", (await base.isInTransactionAsync()) === false);
});

await prova("CORREZIONE SORVEGLIATA: F3 registra() mentre la sincronizzazione applica un pacchetto (REG-07)", async () => {
  const { app, base } = await avvia("foxtrot3");
  const remoti = [
    { id: "R1:e1", hlc: "000001800000-0000-altro001", dispositivo: "altro001",
      entita: "note", entita_id: "e1", tipo: "crea", payload: '{"testo":"da altro"}' },
    { id: "R2:e2", hlc: "000001800001-0000-altro001", dispositivo: "altro001",
      entita: "note", entita_id: "e2", tipo: "crea", payload: '{"testo":"da altro"}' },
  ];
  // Copia della transazione di lib/sync/useAutoSync.ts:54-63 (l'hook non si
  // puo importare: usa react e react-native). La riga che conta e la prima:
  // inTransazione() e non d.withTransactionAsync(), cioe la STESSA coda di
  // registra(). Serializzare solo registra() non bastava — la sincronizzazione
  // scrive da un'altra strada, e da li l'accavallamento rientrava.
  const applicaRemoti = async () => {
    await app.inTransazione(async (d) => {
      for (const e of remoti) {
        await d.runAsync(
          `INSERT OR IGNORE INTO eventi (id, hlc, dispositivo, entita, entita_id, tipo, payload, sincronizzato)
           VALUES (?,?,?,?,?,?,?,1)`,
          [e.id, e.hlc, e.dispositivo, e.entita, e.entita_id, e.tipo, e.payload]);
      }
    });
  };
  // Quanti eventi remoti vede la proiezione locale: con la coda il pacchetto e
  // gia entrato TUTTO, perche la sua transazione si e chiusa prima che questa
  // cominciasse.
  let remotiVistiDallaLocale = null;
  const esiti = await Promise.allSettled([
    applicaRemoti(),
    app.registra("sessioni", "s1", "crea", { tipo: "mattina", minuti: 30 }, async (d, hlc) => {
      remotiVistiDallaLocale = (await d.getFirstAsync(
        "SELECT count(*) AS n FROM eventi WHERE dispositivo='altro001'")).n;
      await proiettaSessione("s1", "mattina", Date.now(), 30)(d, hlc);
    }),
  ]);
  const motivi = esiti.map((e) => (e.status === "rejected" ? e.reason.message : "riuscita"));
  corretto("le due transazioni riescono entrambe", esiti.every((e) => e.status === "fulfilled"),
    motivi.join(" | "));

  const applicati = (await base.getAllAsync(
    "SELECT id FROM eventi WHERE dispositivo='altro001' ORDER BY id")).map((r) => r.id);
  corretto("il pacchetto remoto e tutto-o-niente: entrano entrambi gli eventi",
    applicati.join(",") === "R1:e1,R2:e2", `applicati=${applicati.join(",")}`);
  corretto("nessun evento remoto viene scartato: il pari li ha gia marcati come inviati e non li rispedira",
    applicati.length === remoti.length, `${applicati.length} su ${remoti.length}`);
  corretto("la transazione remota si chiude PRIMA che cominci la locale: la proiezione locale li vede gia tutti e due",
    remotiVistiDallaLocale === 2, String(remotiVistiDallaLocale));
  corretto("e restano marcati sincronizzato=1, come li ha scritti la sincronizzazione",
    (await base.getFirstAsync(
      "SELECT count(*) AS n FROM eventi WHERE dispositivo='altro001' AND sincronizzato=1")).n === 2);

  const eventiLocali = await contaEventi(base, "WHERE dispositivo='foxtrot3'");
  const sessioni = (await base.getFirstAsync("SELECT count(*) AS n FROM sessioni")).n;
  corretto("la scrittura locale sopravvive: un evento locale", eventiLocali === 1, `eventi=${eventiLocali}`);
  corretto("e il blocco del cronometro e sul disco", sessioni === 1, `sessioni=${sessioni}`);
  const sessione = await base.getFirstAsync("SELECT hlc FROM sessioni WHERE id='s1'");
  const eventoLocale = await base.getFirstAsync(
    "SELECT hlc FROM eventi WHERE dispositivo='foxtrot3'");
  corretto("INVARIANTE 1: la sessione porta lo stesso hlc del suo evento",
    sessione !== null && eventoLocale !== null && sessione.hlc === eventoLocale.hlc,
    `${sessione?.hlc} vs ${eventoLocale?.hlc}`);
  const meta = await base.getFirstAsync("SELECT valore FROM meta WHERE chiave='hlc'");
  corretto("meta('hlc') e nata e corrisponde al timbro dell'evento locale: nessun timbro consumato a vuoto",
    meta !== null && eventoLocale !== null &&
      parseInt(String(meta.valore).split("-")[0], 16) === parseInt(eventoLocale.hlc.split("-")[0], 16) &&
      parseInt(String(meta.valore).split("-")[1], 16) === parseInt(eventoLocale.hlc.split("-")[1], 16),
    `${meta?.valore} vs ${eventoLocale?.hlc}`);
  ok("non si resta dentro una transazione", (await base.isInTransactionAsync()) === false);
});

await prova("F4 due registra() in sequenza (con await) sono invece sempre integre", async () => {
  const { app, base } = await avvia("foxtrot4");
  for (let i = 0; i < 10; i++) {
    await app.registra("note", "n" + i, "crea", { i }, proiettaNotaCrea("n" + i, null, "t" + i, false));
  }
  ok("dieci eventi", (await contaEventi(base)) === 10);
  ok("dieci righe proiettate", (await base.getFirstAsync("SELECT count(*) AS n FROM note")).n === 10);
  const orfani = await base.getFirstAsync(
    "SELECT count(*) AS n FROM note WHERE hlc NOT IN (SELECT hlc FROM eventi)");
  ok("nessuna riga senza il suo evento", orfani.n === 0, String(orfani.n));
});

// ============================================================================
// G. CODA DI INVIO
// ============================================================================

await prova("G1 daSincronizzare(): solo i non inviati, in ordine di hlc (SYN-03)", async () => {
  const { app, base } = await avvia("golf0001");
  ok("registro vuoto: array vuoto", (await app.daSincronizzare()).length === 0);

  const emessi = [];
  for (let i = 0; i < 12; i++) {
    emessi.push(await app.registra("note", "n" + i, "crea", { i },
      proiettaNotaCrea("n" + i, null, "t", false)));
  }
  const coda = await app.daSincronizzare();
  ok("dodici eventi da inviare", coda.length === 12);
  ok("in ordine di hlc crescente", coda.map((e) => e.hlc).join("|") === emessi.join("|"));
  ok("ogni riga porta esattamente le sette colonne del pacchetto",
    Object.keys(coda[0]).join(",") === "id,hlc,dispositivo,entita,entita_id,tipo,payload",
    Object.keys(coda[0]).join(","));
  ok("il payload viaggia come stringa, non come oggetto", typeof coda[0].payload === "string");

  const limitata = await app.daSincronizzare(5);
  ok("il limite taglia la coda", limitata.length === 5);
  ok("e tiene i cinque piu vecchi", limitata.map((e) => e.hlc).join("|") === emessi.slice(0, 5).join("|"));

  await app.segnaSincronizzati(limitata.map((e) => e.id));
  const dopo = await app.daSincronizzare();
  ok("dopo il segno restano i sette successivi", dopo.length === 7);
  ok("e sono quelli giusti", dopo.map((e) => e.hlc).join("|") === emessi.slice(5).join("|"));
  ok("un evento nuovo nasce comunque da inviare",
    (await base.getFirstAsync("SELECT sincronizzato FROM eventi WHERE hlc=?",
      [await app.registra("note", "nuovo", "crea", {}, proiettaNotaCrea("nuovo", null, "t", false))]))
      .sincronizzato === 0);
});

await prova("G2 segnaSincronizzati(): lista vuota, id inesistenti, selettivita (SYN-04)", async () => {
  const { app, base } = await avvia("golf0002");
  const ids = [];
  for (let i = 0; i < 4; i++) {
    const h = await app.registra("note", "n" + i, "crea", {}, proiettaNotaCrea("n" + i, null, "t", false));
    ids.push(h + ":n" + i);
  }
  await app.segnaSincronizzati([]);
  ok("lista vuota: nessuna riga toccata",
    (await base.getFirstAsync("SELECT count(*) AS n FROM eventi WHERE sincronizzato=1")).n === 0);

  await app.segnaSincronizzati(["id-che-non-esiste", "nemmeno-questo"]);
  ok("id inesistenti: nessun errore e nessuna riga toccata",
    (await base.getFirstAsync("SELECT count(*) AS n FROM eventi WHERE sincronizzato=1")).n === 0);

  await app.segnaSincronizzati([ids[1], ids[3]]);
  const segnati = (await base.getAllAsync(
    "SELECT entita_id FROM eventi WHERE sincronizzato=1 ORDER BY entita_id")).map((r) => r.entita_id);
  ok("solo i due id passati passano a sincronizzato=1", segnati.join(",") === "n1,n3", segnati.join(","));
  ok("gli altri restano in coda", (await app.daSincronizzare()).length === 2);
  await app.segnaSincronizzati([ids[1]]);
  ok("segnare due volte lo stesso id e innocuo",
    (await base.getFirstAsync("SELECT count(*) AS n FROM eventi WHERE sincronizzato=1")).n === 2);
});

await prova("G3 segnaSincronizzati() con liste lunghissime: il limite delle variabili", async () => {
  const { app } = await avvia("golf0003");
  let errore = null;
  try {
    await app.segnaSincronizzati(new Array(1000).fill(0).map((_, i) => "x" + i));
  } catch (e) {
    errore = String(e?.message ?? e);
  }
  ok("1000 id: qui (SQLite 3.51) passano — su Android il limite puo essere 999", errore === null, String(errore));
  const messaggio = await lancia("40000 id superano comunque il limite",
    () => app.segnaSincronizzati(new Array(40000).fill(0).map((_, i) => "y" + i)),
    "too many SQL variables");
  ok("l'errore parla di variabili SQL, non di dati persi: gli eventi restano da inviare",
    messaggio.includes("variables"));
});

await prova("G4 un evento remoto con tipo fuori dal CHECK non fa saltare il pacchetto (SYN-09)", async () => {
  const { app, base } = await avvia("golf0004");
  const d = app.database();
  const pacchetto = [
    ["R1:e1", "000001800000-0000-altro001", "altro001", "note", "e1", "crea", "{}"],
    ["R2:e2", "000001800001-0000-altro001", "altro001", "note", "e2", "sostituisci", "{}"],
    ["R3:e3", "000001800002-0000-altro001", "altro001", "note", "e3", "elimina", "{}"],
  ];
  let errore = null;
  try {
    await d.withTransactionAsync(async () => {
      for (const p of pacchetto) {
        await d.runAsync(
          `INSERT OR IGNORE INTO eventi (id, hlc, dispositivo, entita, entita_id, tipo, payload, sincronizzato)
           VALUES (?,?,?,?,?,?,?,1)`, p);
      }
    });
  } catch (e) {
    errore = String(e?.message ?? e);
  }
  ok("OR IGNORE ingoia anche la violazione di CHECK: nessun errore", errore === null, String(errore));
  ok("i due eventi validi entrano", (await contaEventi(base, "WHERE dispositivo='altro001'")) === 2);
  ok("quello con tipo sconosciuto viene scartato in SILENZIO",
    (await base.getFirstAsync("SELECT * FROM eventi WHERE id='R2:e2'")) === null);
  ok("nessuna proiezione e stata applicata: le note restano vuote (SYN-01)",
    (await base.getFirstAsync("SELECT count(*) AS n FROM note")).n === 0);
});

// ============================================================================
// H. RICOSTRUZIONE DELLO STATO DAL SOLO REGISTRO
// ============================================================================

await prova("H1 proietta() ricostruisce nota e volume dal registro vero", async () => {
  const { app, base } = await avvia("hotel001");
  const { proietta } = await import("../../lib/sync/fusione.ts");
  await app.registra("note", "n1", "crea", { titolo: "A", testo: "uno", pubblicabile: 0 },
    proiettaNotaCrea("n1", "A", "uno", false));
  await app.registra("note", "n1", "aggiorna", { titolo: "A", testo: "due", pubblicabile: 1 },
    proiettaNotaAggiorna("n1", "A", "due", true));
  const eventi = await base.getAllAsync(
    "SELECT id, hlc, dispositivo, entita, entita_id, tipo, payload FROM eventi");
  const ricostruita = proietta(eventi, "note", "n1");
  const riga = await base.getFirstAsync("SELECT titolo, testo, pubblicabile FROM note WHERE id='n1'");
  ok("il testo ricostruito coincide con la riga operativa", ricostruita.testo === riga.testo);
  ok("il titolo pure", ricostruita.titolo === riga.titolo);
  ok("e il flag pubblicabile pure", ricostruita.pubblicabile === riga.pubblicabile);
  ok("un'entita mai vista restituisce null", proietta(eventi, "note", "mai") === null);
});

await prova("H2 dopo 'elimina' la ricostruzione e null, come la riga cancellata", async () => {
  const { app, base } = await avvia("hotel002");
  const { proietta } = await import("../../lib/sync/fusione.ts");
  await app.registra("biblioteca", "v1", "crea", { titolo: "V", autore: "X", pagine: 100 },
    proiettaVolumeCrea("v1", "V", "file:///v.pdf", 10));
  await app.registra("biblioteca", "v1", "elimina", {}, proiettaVolumeElimina("v1"));
  const eventi = await base.getAllAsync(
    "SELECT id, hlc, dispositivo, entita, entita_id, tipo, payload FROM eventi");
  ok("proietta() restituisce null", proietta(eventi, "biblioteca", "v1") === null);
  ok("e la tabella operativa e d'accordo",
    (await base.getFirstAsync("SELECT * FROM biblioteca WHERE id='v1'")) === null);

  await app.registra("biblioteca", "v1", "aggiorna", { ultima_pagina: 12 }, proiettaPagina("v1", 12));
  const dopo = await base.getAllAsync(
    "SELECT id, hlc, dispositivo, entita, entita_id, tipo, payload FROM eventi");
  const risorta = proietta(dopo, "biblioteca", "v1");
  ok("una scrittura successiva la resuscita, ma solo con i campi di quel payload",
    risorta !== null && risorta.ultima_pagina === 12 && !("titolo" in risorta), JSON.stringify(risorta));
  ok("mentre la tabella operativa resta vuota (l'UPDATE non trova la riga)",
    (await base.getFirstAsync("SELECT * FROM biblioteca WHERE id='v1'")) === null);
});

await prova("H3 le righe di dotazione non sono ricostruibili dal registro (SYN-07)", async () => {
  const { app, base } = await avvia("hotel003");
  const { proietta } = await import("../../lib/sync/fusione.ts");
  // Come caricaContenuti(): la riga nasce FUORI dal registro.
  await semina(base,
    `INSERT INTO biblioteca (id, titolo, autore, trimestre, origine, aggiunto_a)
     VALUES (?,?,?,?,?,?)`,
    ["BIB-007", "Volume di dotazione", "Autore", "T1", "aperta", new Date().toISOString()]);
  await app.registra("biblioteca", "BIB-007", "aggiorna", { ultima_pagina: 33 },
    proiettaPagina("BIB-007", 33));
  const eventi = await base.getAllAsync(
    "SELECT id, hlc, dispositivo, entita, entita_id, tipo, payload FROM eventi");
  const ricostruito = proietta(eventi, "biblioteca", "BIB-007");
  const riga = await base.getFirstAsync("SELECT * FROM biblioteca WHERE id='BIB-007'");
  ok("la riga operativa ha titolo e trimestre", riga.titolo === "Volume di dotazione" && riga.trimestre === "T1");
  ok("la ricostruzione dal registro conosce solo l'ultima pagina",
    ricostruito.ultima_pagina === 33 && !("titolo" in ricostruito), JSON.stringify(ricostruito));
  ok("chi ricostruisse lo stato dal solo registro perderebbe la dotazione",
    Object.keys(ricostruito).length === 1);
});

// ============================================================================
// RIEPILOGO
// ============================================================================
const verificheTotali = scenari.reduce((n, s) => n + s.verifiche, 0);
const verificheFallite = scenari.reduce((n, s) => n + s.errori.length, 0);
const scenariPassati = scenari.filter((s) => s.errori.length === 0).length;
const difetti = scenari.filter((s) => s.difetto);
const correzioni = scenari.filter((s) => s.correzione);

console.log("");
console.log("DIFETTI DELL'APP RIPRODOTTI (non corretti: decide il coordinatore)");
for (const d of difetti) console.log("  - " + d.nome.replace(PREFISSO_DIFETTO, ""));

if (correzioni.length) {
  console.log("");
  console.log(
    `CORREZIONI SORVEGLIATE: ${correzioni.length} scenari, ${correzioniSorvegliate.length} verifiche.`
  );
  console.log("Erano difetti riprodotti; la correzione li ha resi rossi e sono stati convertiti.");
  console.log("Stessa scena, verdetto opposto: un rosso qui vuol dire che la correzione e REGREDITA.");
  for (const c of correzioniSorvegliate) console.log(`  - ${c}`);
}
console.log("");
console.log(`Verifiche: passati ${verificheTotali - verificheFallite} su ${verificheTotali}`);
console.log(`passati ${scenariPassati} su ${scenari.length} scenari`);

if (scenariPassati === scenari.length) {
  rmSync(RADICE, { recursive: true, force: true });
} else {
  console.log(`I file di lavoro restano qui per l'autopsia: ${RADICE}`);
  process.exit(1);
}
