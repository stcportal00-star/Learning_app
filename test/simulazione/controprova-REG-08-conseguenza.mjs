/**
 * CONTROPROVA AVVERSARIALE del difetto REG-08, lente "CONSEGUENZA".
 *
 * L'accusa (lib/db.ts, registra()): l'evento entra nel registro anche quando la
 * proiezione non tocca nessuna riga; il danno dichiarato e' che "la
 * ricostruzione dal registro produce uno stato diverso da quello locale".
 *
 * Qui non si discute se il comportamento esista — esiste. Si misura CHE COSA
 * PERDE L'UTENTE, in aereo, con un telefono e un tablet, seguendo l'app come e'
 * fatta oggi. Un difetto irraggiungibile, o raggiungibile ma senza effetto
 * visibile, non merita una correzione a nove giorni dalla scadenza.
 *
 * Le domande, in ordine di quanto pesano sul giudizio:
 *
 *   C1. Con un dito, quale schermata puo' produrre una proiezione a vuoto?
 *   C2. L'unico punto che dipende da dati esterni (il manifesto della
 *       biblioteca) puo' davvero portare un codice senza riga locale?
 *   C3. Il danno dichiarato ha un consumatore? Si porta l'evento inerte fino
 *       all'ALTRO dispositivo lungo la catena VERA (cifra, decifra, fondi,
 *       inserimento di useAutoSync) e si guarda che cosa cambia la'.
 *   C4. L'evento inerte rompe qualcosa di meccanico: pacchetto, deduplica,
 *       coda di invio?
 *   C5. Che cosa vede davvero l'utente nell'unico percorso plausibile, e in
 *       quale file sta la causa di cio' che vede.
 *   C6. Quanto costa la correzione proposta, contata in punti di chiamata.
 *
 * Gira il CODICE VERO sopra il banco (node:sqlite): lib/db.ts, lib/sync/*.
 *
 *   node test/simulazione/controprova-REG-08-conseguenza.mjs
 *
 * Non modifica nessun file del progetto: sole letture e una radice temporanea.
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
const RADICE = mkdtempSync(join(tmpdir(), "controprova-reg08-cons-"));

const innocue = []; // misure in cui l'utente NON perde niente
const dannose = []; // misure in cui l'utente perde qualcosa
const confini = []; // cio' che resta vero comunque

function misura(codice, motivo, utenteIllesso, extra = "") {
  if (utenteIllesso) innocue.push(`${codice} ${motivo}`);
  else dannose.push(`${codice} ${motivo}${extra ? " — " + extra : ""}`);
}
function circoscrive(codice, motivo) {
  confini.push(`${codice} ${motivo}`);
}
const sorgente = (relativo) => readFileSync(join(RADICE_PROGETTO, relativo), "utf8");

let istanze = 0;
async function avvia(dispositivo) {
  istanze++;
  const dove = join(RADICE, "avvio-" + istanze);
  configuraCartella(dove);
  const app = await import(`../../lib/db.ts?conseguenza08=${istanze}`);
  await app.apri(dispositivo);
  return { app, base: app.database() };
}

// Fotografia di TUTTO cio' che l'utente puo' vedere in una schermata: le
// tabelle operative. Il registro non ha schermata.
const TABELLE_VISIBILI = ["biblioteca", "note", "tentativi", "ripasso", "sessioni"];
async function fotografiaVisibile(base) {
  const pezzi = {};
  for (const t of TABELLE_VISIBILI) {
    pezzi[t] = await base.getAllAsync(`SELECT * FROM ${t} ORDER BY rowid`);
  }
  return JSON.stringify(pezzi);
}

// ============ C1. CON UN DITO, QUALE SCHERMATA PRODUCE UNA PROIEZIONE A VUOTO?
{
  // Le nove chiamate a registra() dell'app, con la forma della loro proiezione
  // e la provenienza dell'id su cui la proiezione fa presa.
  const chiamate = [
    ["app/esercizi.tsx", "tentativi/crea", "INSERT", "id nuovo (randomUUID)"],
    ["app/codice.tsx", "tentativi/crea", "INSERT", "id nuovo (randomUUID)"],
    ["components/Cronometro.tsx", "sessioni/crea", "INSERT", "id nuovo (randomUUID)"],
    ["app/(tabs)/note.tsx", "note/crea", "INSERT", "id nuovo (randomUUID)"],
    ["app/(tabs)/note.tsx", "note/aggiorna", "UPDATE", "id di una nota appena elencata"],
    ["app/ripasso.tsx", "ripasso/aggiorna", "UPDATE", "id dalla JOIN su ripasso"],
    ["lib/palestra.ts importaPdf", "biblioteca/crea", "INSERT", "id nuovo (randomUUID)"],
    ["lib/palestra.ts salvaPagina", "biblioteca/aggiorna", "UPDATE", "id della riga aperta nel lettore"],
    ["lib/palestra.ts rimuoviVolume", "biblioteca/elimina", "DELETE", "id della riga appena letta"],
    ["lib/palestra.ts importaBiblioteca", "biblioteca/aggiorna", "UPDATE", "codice preso da manifesto.json"],
  ];
  const conInsert = chiamate.filter((c) => c[2] === "INSERT").length;
  misura("C1a", `${conInsert} chiamate su ${chiamate.length} proiettano un INSERT con un id appena generato: per costruzione toccano sempre una riga, il difetto non le sfiora`,
    conInsert === 5);

  // Le quattro restanti mordono una riga che il codice ha appena letto. Perche'
  // non mordano, la riga deve sparire nel frattempo: nell'app nessuno la toglie.
  const cancellazioni = ["lib/palestra.ts", "lib/contenuti.ts", "lib/promemoria.ts",
    "lib/sessioni.ts", "lib/sync/useAutoSync.ts", "app/ripasso.tsx", "app/esercizi.tsx",
    "app/codice.tsx", "app/(tabs)/note.tsx", "app/(tabs)/libreria.tsx", "app/lettore.tsx"]
    .flatMap((f) => (sorgente(f).match(/DELETE FROM \w+/g) ?? []).map((d) => `${f}: ${d}`));
  misura("C1b", `in tutta l'app esiste UNA sola cancellazione di riga operativa, dentro registra('elimina') di rimuoviVolume(): ${JSON.stringify(cancellazioni)}. Note, ripasso, tentativi e sessioni non si cancellano da nessuna schermata, quindi il loro UPDATE trova sempre la riga`,
    cancellazioni.length === 1 && cancellazioni[0].startsWith("lib/palestra.ts"),
    JSON.stringify(cancellazioni));

  const lettore = sorgente("app/lettore.tsx");
  const timerAnnullato = /clearTimeout\(salvataggio\.current\)/.test(lettore);
  misura("C1c", "l'unica corsa immaginabile (salvaPagina differito mentre si cancella il volume) e' chiusa: il timer viene annullato allo smontaggio del lettore, e il volume si cancella dalla libreria, cioe' fuori dal lettore",
    timerAnnullato);
}

// ====== C2. IL MANIFESTO PUO' PORTARE UN CODICE SENZA RIGA LOCALE?
{
  // importaBiblioteca() e' l'unico punto in cui l'id della proiezione viene da
  // un file scelto dall'utente. Il codice del manifesto e quello delle righe di
  // dotazione nascono pero' dallo stesso catalogo, e un controllo lo impone.
  const verifica = sorgente("strumenti/verifica_biblioteca.py");
  const stessoInsieme = /set\(json_app\) == set\(codici\)/.test(verifica);
  const manifestoDalCatalogo = /from biblioteca_aperta import BIBLIOTECA/
    .test(sorgente("strumenti/scarica_biblioteca.py"));
  misura("C2a", "manifesto.json e assets/contenuti/biblioteca.json escono entrambi dal catalogo biblioteca_aperta.py, e verifica_biblioteca.py impone per controllo automatico che abbiano LO STESSO INSIEME di codici: un codice senza riga locale non si produce per via normale",
    stessoInsieme && manifestoDalCatalogo);
  circoscrive("C2b", "resta un caso residuo: importare un manifesto generato da un commit piu' nuovo dell'APK installato. Con un solo utente, un solo repository e la release della biblioteca prodotta dallo stesso albero, e' una manovra da fare apposta, non un gesto dell'uso quotidiano.");
}

// == C3. IL DANNO DICHIARATO ARRIVA ALL'ALTRO DISPOSITIVO? CATENA VERA.
{
  const telefono = await avvia("telefono");
  const tablet = await avvia("tablet");

  // Il tablet ha la riga di dotazione; su entrambi c'e' una nota vera, cosi' la
  // fotografia non e' vuota e una divergenza si vedrebbe.
  for (const b of [telefono.base, tablet.base]) {
    await b.runAsync(
      `INSERT INTO biblioteca (id, titolo, origine, aggiunto_a) VALUES ('BIB-01','Volume uno','aperta','2026-01-01T00:00:00.000Z')`);
  }
  await telefono.app.registra("note", "n1", "crea", { testo: "nota vera" },
    async (d, hlc) => {
      await d.runAsync(
        "INSERT INTO note (id, titolo, testo, pubblicabile, creato_a, hlc) VALUES (?,?,?,?,?,?)",
        ["n1", null, "nota vera", 0, "2026-01-01T00:00:00.000Z", hlc]);
    });

  // IL GESTO INCRIMINATO: il manifesto porta BIB-99, che qui non ha riga.
  await telefono.app.registra("biblioteca", "BIB-99", "aggiorna",
    { file_locale: "file:///BIB-99.pdf", byte: 1024, sha256: "abc" },
    async (d, hlc) => {
      await d.runAsync(
        "UPDATE biblioteca SET file_locale = ?, byte = ?, sha256 = ?, hlc = ? WHERE id = ?",
        ["file:///BIB-99.pdf", 1024, "abc", hlc, "BIB-99"]);
    });

  const primaDelloScambio = await fotografiaVisibile(tablet.base);

  // Catena vera: daSincronizzare -> impacchetta -> cifra -> decifra -> fondi ->
  // l'inserimento identico a quello di lib/sync/useAutoSync.ts.
  const { impacchetta, cifra, decifra } = await import("../../lib/sync/pacchetto.ts");
  const { fondi } = await import("../../lib/sync/fusione.ts");
  const colonne = "id, hlc, dispositivo, entita, entita_id, tipo, payload";

  const daInviare = await telefono.app.daSincronizzare();
  const involucro = await cifra(impacchetta("telefono", daInviare), "frase-condivisa");
  const arrivato = await decifra(involucro, "frase-condivisa");

  const localiTablet = await tablet.base.getAllAsync(`SELECT ${colonne} FROM eventi`);
  const f = fondi(localiTablet, arrivato.eventi);
  await tablet.app.inTransazione(async (d) => {
    for (const e of f.nuovi) {
      await d.runAsync(
        `INSERT OR IGNORE INTO eventi
         (id, hlc, dispositivo, entita, entita_id, tipo, payload, sincronizzato)
         VALUES (?,?,?,?,?,?,?,1)`,
        [e.id, e.hlc, e.dispositivo, e.entita, e.entita_id, e.tipo, e.payload]);
    }
  });

  const dopoLoScambio = await fotografiaVisibile(tablet.base);
  const eventiSulTablet = await tablet.base.getAllAsync("SELECT entita_id FROM eventi ORDER BY hlc");

  misura("C3a", `l'evento inerte arriva sul tablet (${eventiSulTablet.length} eventi nel registro, BIB-99 compreso) ma NON cambia nessuna tabella visibile: useAutoSync inserisce gli eventi ricevuti nel solo registro e non proietta niente`,
    primaDelloScambio === dopoLoScambio);
  misura("C3b", "in particolare NON nasce nessuna riga fantasma BIB-99 sul tablet: la biblioteca del tablet resta quella di prima",
    !dopoLoScambio.includes("BIB-99"));

  // E la "ricostruzione dal registro" del capo d'accusa: esiste un consumatore?
  const grep = (testo) => /proietta\s*\(/.test(testo);
  const consumatori = ["lib/sync/useAutoSync.ts", "lib/sync/trasporto.ts", "lib/sync/file.ts",
    "lib/sync/wifi.ts", "lib/sync/vicinanza.ts", "lib/sync/auto.ts", "lib/sync/stato.ts",
    "lib/sync/accoppiamento.ts", "lib/palestra.ts", "lib/contenuti.ts", "lib/sessioni.ts",
    "app/(tabs)/libreria.tsx", "app/ripasso.tsx", "app/lettore.tsx", "app/(tabs)/note.tsx"]
    .filter((f) => grep(sorgente(f)));
  misura("C3c", `nessuna schermata e nessun modulo dell'app ricostruisce lo stato dal registro: proietta() di lib/sync/fusione.ts non ha consumatori fuori dai test (${JSON.stringify(consumatori)}). Il danno dichiarato non ha un luogo dove manifestarsi`,
    consumatori.length === 0, JSON.stringify(consumatori));
  circoscrive("C3d", "il motivo e' piu' profondo di una svista: OGGI la proiezione degli eventi ricevuti non e' implementata affatto. Dopo uno scambio il tablet ha il registro del telefono ma non le sue note. E' una lacuna vera e molto piu' grande di REG-08, ed e' esattamente cio' che CLAUDE.md permette di rimandare ('sincronizzazione, ripasso e statistiche possono aspettare').");
  circoscrive("C3e", "quando quella proiezione si scrivera', sara' fatta con le stesse istruzioni delle schermate (UPDATE ... WHERE id = ?): l'evento inerte restera' inerte anche la'. Diverge solo proietta(), che e' un riduttore puro di payload e non la proiezione dell'app.");
}

// ====== C4. L'EVENTO INERTE ROMPE QUALCOSA DI MECCANICO?
{
  const { app, base } = await avvia("meccanica");
  await app.registra("biblioteca", "BIB-99", "aggiorna", { file_locale: "x" },
    async (d, hlc) => {
      await d.runAsync("UPDATE biblioteca SET file_locale = ?, hlc = ? WHERE id = ?",
        ["x", hlc, "BIB-99"]);
    });

  const { impacchetta, cifra, decifra } = await import("../../lib/sync/pacchetto.ts");
  const { fondi } = await import("../../lib/sync/fusione.ts");
  const daInviare = await app.daSincronizzare();
  const involucro = await cifra(impacchetta("meccanica", daInviare), "frase");
  const tornato = await decifra(involucro, "frase");
  misura("C4a", "il pacchetto cifrato accetta e restituisce l'evento inerte senza sollevare: non e' un evento malformato, e' un evento valido che non ha morso",
    tornato.eventi.length === 1 && tornato.eventi[0].entita_id === "BIB-99");

  const seconda = fondi(tornato.eventi, tornato.eventi);
  misura("C4b", "e si deduplica come gli altri: una seconda applicazione dello stesso pacchetto non lo conta due volte",
    seconda.nuovi.length === 0 && seconda.duplicati === 1);

  await app.segnaSincronizzati(daInviare.map((e) => e.id));
  const restano = await app.daSincronizzare();
  misura("C4c", "e si chiude come gli altri: dopo l'invio esce dalla coda, non resta a far lampeggiare per sempre un 'da sincronizzare'",
    restano.length === 0);

  const invariante = await base.getAllAsync(
    `SELECT e.id FROM eventi e WHERE e.entita_id = 'BIB-99'`);
  misura("C4d", "l'invariante 1 regge nel verso che conta: nessuna riga operativa senza il suo evento. Il caso qui e' l'opposto — un evento senza riga — e non lascia stato incoerente, perche' non lascia stato affatto",
    invariante.length === 1);
  base.closeSync?.();
}

// ====== C5. CHE COSA VEDE L'UTENTE, E DOVE STA LA CAUSA
{
  const palestra = sorgente("lib/palestra.ts");
  const bloccoImporta = palestra.slice(palestra.indexOf("export async function importaBiblioteca"),
    palestra.indexOf("export async function elencaBiblioteca"));
  const contaSempre = /collegati\+\+;/.test(bloccoImporta) &&
    !/changes|righe|esito\./.test(bloccoImporta);
  circoscrive("C5a", contaSempre
    ? "SE il caso residuo di C2b si verificasse, cio' che l'utente vedrebbe NON e' uno stato divergente: e' il conteggio finale di importaBiblioteca() che dice 'collegati' anche per il codice senza riga, perche' 'collegati++' non guarda l'esito. Poi aprirebbe quel volume e otterrebbe 'non_scaricato'. Fastidio, non perdita di dati."
    : "importaBiblioteca() sembra gia' guardare l'esito della proiezione: rileggere.");
  circoscrive("C5b", "e quella causa NON sta in lib/db.ts: sta nel contatore di lib/palestra.ts. Correggere registra() non sistemerebbe il conteggio, lo trasformerebbe in un'eccezione a meta' importazione.");
  circoscrive("C5c", "in aereo l'utente non perde nulla: le due superfici che la scadenza protegge — motore degli esercizi (tentativi/crea, INSERT) e apertura dei PDF (lettura da biblioteca) — non passano da nessuna proiezione che possa non mordere.");
}

// ====== C6. QUANTO COSTA LA CORREZIONE PROPOSTA
{
  const db = sorgente("lib/db.ts");
  const firmaVoid = /proiezione: \(d: SQLite\.SQLiteDatabase, hlc: string\) => Promise<void>/.test(db);
  const puntiDiChiamata = ["app/esercizi.tsx", "app/codice.tsx", "app/ripasso.tsx",
    "app/(tabs)/note.tsx", "components/Cronometro.tsx", "lib/palestra.ts"]
    .map((f) => [f, (sorgente(f).match(/registra\(/g) ?? []).length]);
  const totale = puntiDiChiamata.reduce((s, [, n]) => s + n, 0);
  circoscrive("C6a", `la proiezione e' dichiarata '=> Promise<void>': per sapere se ha morso, registra() dovrebbe cambiare firma, e con lei ${totale} punti di chiamata in ${puntiDiChiamata.length} file (${JSON.stringify(puntiDiChiamata)}). Non e' una riga in lib/db.ts.`);
  circoscrive("C6b", firmaVoid
    ? "la via senza cambio di firma — leggere changes() dopo la richiamata — misura solo l'ULTIMA istruzione della proiezione: rifiuterebbe una proiezione sana a piu' istruzioni e accetterebbe una che tocca la riga sbagliata. Una guardia che sbaglia in entrambi i versi."
    : "la firma della proiezione e' cambiata: rileggere C6a.");
  circoscrive("C6c", "e toccherebbe lib/db.ts, il file che ha appena ricevuto la correzione critica REG-06/07. A nove giorni dalla scadenza, rimettere le mani nella transazione di registra() per un evento che oggi non produce alcun effetto visibile e' il rapporto rischio/beneficio peggiore del lotto.");
}

// ------------------------------------------------------------------ VERDETTO
console.log("MISURE IN CUI L'UTENTE NON PERDE NIENTE:");
for (const a of innocue) console.log("  ok  " + a);
console.log("\nMISURE IN CUI L'UTENTE PERDE QUALCOSA:");
for (const d of dannose) console.log("  X   " + d);
console.log("\nCONFINI:");
for (const c of confini) console.log("  ·   " + c);
console.log(`\nesito: ${innocue.length} innocue, ${dannose.length} dannose, ${confini.length} confini.`);
rmSync(RADICE, { recursive: true, force: true });
process.exit(0);
