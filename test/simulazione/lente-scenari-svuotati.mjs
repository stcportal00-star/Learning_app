/**
 * LENTE "SCENARI SVUOTATI" — le guardie delle guardie.
 *
 *   node test/simulazione/lente-scenari-svuotati.mjs
 *
 * PERCHE' ESISTE. Le sedici asserzioni convertite da difetto() a corretto()
 * sorvegliano due correzioni critiche (RO-01, REG-06/REG-07). Un'asserzione
 * puo' restare scritta benissimo e non provare piu' niente perche' il CORPO
 * dello scenario che la precede ha smesso di esercitare la concorrenza: due
 * await in fila al posto di una corsa, oppure una corsa che passa da una copia
 * a mano di `withTransactionAsync` invece che da registra()/inTransazione().
 * In tutti e due i casi la guardia resta VERDE per sempre — e una guardia che
 * non puo' diventare rossa e' peggio di una rossa, perche' la rossa si vede.
 *
 * Questa lente non falsifica niente e non tocca nessun file: legge i sorgenti
 * e pretende che i corpi degli scenari conservino la forma che rende le
 * guardie falsificabili. E' il complemento statico della falsificazione vera
 * (sostituire il corpo di inCoda() con `return compito();`), che resta il
 * verdetto di merito ma richiede di modificare lib/db.ts e quindi non si puo'
 * lasciare in un file da eseguire a ogni giro.
 *
 * MISURA DI RIFERIMENTO, presa il 21/09/2026 con la coda disattivata
 * (inCoda -> `return compito();`) e lib/db.ts rimesso subito con git:
 *
 *   coda-scritture       12/12  ->   3/12     (9 rosse)
 *   contenuti           308/308 -> 301/308    (7 rosse, scenario I1)
 *   import-database     220/220 -> 218/220    (2 rosse, IMP-36 e IMP-37)
 *   registro-eventi     264/264 -> 240/264   (24 rosse, scenari F1 F2 F3)
 *   ripasso-e-sessioni  365/365 -> 356/365    (9 rosse, scenario G8)
 *   schermate-stato     469/469 -> 466/469    (3 rosse, F11 F12 H26)
 *   motore-sql, promemoria-notifiche, sync-fusione: invariati (attesi tali)
 *
 * E con la sola lettura revocata (tolto `PRAGMA query_only = ON` da
 * apriPalestra(), lib/palestra.ts rimesso subito con git):
 *
 *   motore-sql          126/126 -> 115/126   (11 rosse su 12 guardie RO-*)
 *
 * AVVERTENZA SULLA MISURA. Se piu' revisori lavorano nello stesso albero, la
 * falsificazione di uno viene annullata dal `git checkout` dell'altro mentre
 * la prova e' ancora in corso, e il risultato e' un falso "guardia svuotata".
 * E' successo davvero durante questa revisione. Chi rifa' la misura deve
 * controllare che la mutazione sia presente PRIMA e DOPO ogni file, non solo
 * all'inizio del giro.
 *
 * CONVENZIONE. Come nel resto di test/simulazione/, un difetto trovato non
 * viene corretto qui: lo scenario che lo riproduce si chiama
 * "DIFETTO RIPRODOTTO" e verifica il comportamento OSSERVATO, cosi' resta
 * verde adesso e diventa rosso il giorno in cui il difetto viene corretto.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const RADICE = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const leggi = (percorso) => readFileSync(join(RADICE, percorso), "utf8");

let passati = 0;
const falliti = [];
const difettiRiprodotti = [];

function ok(nome, condizione, extra = "") {
  if (condizione) passati++;
  else falliti.push(`${nome}${extra ? " — " + extra : ""}`);
}

function difetto(codice, nome, condizione, extra = "") {
  ok(`${codice}: ${nome}`, condizione, extra);
  if (condizione) difettiRiprodotti.push(`${codice}: ${nome}`);
}

/**
 * Il testo di uno scenario, dal suo inizio all'inizio del successivo.
 * Serve perche' la domanda non e' "il file contiene una corsa" ma "la corsa
 * sta dentro QUESTO scenario": un Promise.allSettled trecento righe piu' giu'
 * non dice niente sulla guardia che si sta esaminando.
 */
/** Solo il codice: i commenti parlano anche di cio' che lo scenario evita. */
function senzaCommenti(testo) {
  return testo.replace(/^[ \t]*\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");
}

function corpoScenario(sorgente, ancora) {
  const inizio = sorgente.indexOf(ancora);
  if (inizio < 0) return null;
  const resto = sorgente.slice(inizio + ancora.length);
  const fine = resto.search(/\nawait (prova|scenario)\(/);
  return fine < 0 ? resto : resto.slice(0, fine);
}

// ===========================================================================
// A. LE CORSE PARTONO DAVVERO INSIEME
// ===========================================================================
// Due chiamate lanciate insieme (Promise.all/allSettled costruito con le
// chiamate gia' avviate, senza await fra l'una e l'altra) sono l'unica forma
// che esercita la coda. Due await in sequenza non si accavallano mai: con o
// senza coda il risultato e' identico, e la guardia diventa un timbro.

const GUARDIE_DI_CONCORRENZA = [
  {
    file: "test/simulazione/registro-eventi.mjs",
    ancora: 'await prova("CORREZIONE SORVEGLIATA: F1 due registra() senza await intermedio (REG-06)"',
    nome: "F1 due registra() accavallate",
    viaVera: /app\.registra\(/,
  },
  {
    file: "test/simulazione/registro-eventi.mjs",
    ancora: 'await prova("CORREZIONE SORVEGLIATA: F2 tre registra() sovrapposte',
    nome: "F2 tre registra() sovrapposte",
    viaVera: /app\.registra\(/,
  },
  {
    file: "test/simulazione/registro-eventi.mjs",
    ancora: 'await prova("CORREZIONE SORVEGLIATA: F3 registra() mentre la sincronizzazione applica un pacchetto (REG-07)"',
    nome: "F3 registra() contro il pacchetto remoto",
    // Qui la via vera e' la seconda meta' della correzione: la
    // sincronizzazione deve passare dalla STESSA coda, non da
    // d.withTransactionAsync(). Serializzare solo registra() non bastava.
    viaVera: /app\.inTransazione\(/,
  },
  {
    file: "test/simulazione/ripasso-e-sessioni.mjs",
    ancora: 'await prova("CORREZIONE SORVEGLIATA: G8 doppio tocco su due gradi',
    nome: "G8 doppio tocco su due gradi",
    viaVera: /schermata\.valuta\(/,
  },
  {
    file: "test/simulazione/contenuti.mjs",
    ancora: 'await scenario("CORREZIONE SORVEGLIATA I1 · due caricaContenuti() concorrenti',
    nome: "I1 due caricaContenuti() concorrenti",
    viaVera: /contenuti\.caricaContenuti\(\)/,
  },
];

for (const g of GUARDIE_DI_CONCORRENZA) {
  const corpo = corpoScenario(leggi(g.file), g.ancora);
  ok(`A · lo scenario "${g.nome}" esiste ancora in ${g.file}`, corpo !== null);
  if (!corpo) continue;

  // La forma che conta: le chiamate sono gia' avviate quando entrano
  // nell'array, quindi si sovrappongono. `Promise.allSettled([a(), b()])` si
  // accavalla; `await a(); await b();` no.
  ok(`A · "${g.nome}" lancia le chiamate INSIEME (Promise.all/allSettled)`,
    /Promise\.all(Settled)?\(\s*\[/.test(corpo));

  ok(`A · "${g.nome}" passa dalla via vera dell'app`, g.viaVera.test(corpo),
    `atteso ${g.viaVera}`);

  // Una copia a mano della struttura vecchia riprodurrebbe l'azzardo grezzo
  // sulla connessione nuda e non direbbe niente sulla correzione: sarebbe
  // verde con la coda e verde senza. L'errore e' gia' stato commesso qui.
  //
  // I commenti vanno tolti prima di guardare: F3 nomina apposta
  // `d.withTransactionAsync()` per dire che NON e' quella la via usata, e una
  // lente che non distingue il codice dalla prosa accusa lo scenario migliore.
  ok(`A · "${g.nome}" NON apre transazioni a mano sulla connessione`,
    !/\b(base|d|db)\.withTransactionAsync\(/.test(senzaCommenti(corpo)));
}

// Le tre guardie di schermate-stato (F11, F12, H26) non stanno dentro uno
// scenario: si appoggiano all'aiutante toccaDueVolte, che e' il punto in cui
// la corsa puo' essere svuotata per tutte e tre in un colpo solo.
const SCHERMATE = leggi("test/simulazione/schermate-stato.mjs");
const TOCCA_DUE_VOLTE = corpoScenario(SCHERMATE, "async function toccaDueVolte(inst, azione) {")
  ?? SCHERMATE.slice(SCHERMATE.indexOf("async function toccaDueVolte"));
ok("A · toccaDueVolte avvia il secondo tocco PRIMA di attendere il primo",
  /const prima = Promise\.resolve\(\)\.then\(azione\);\s*\n\s*const seconda = Promise\.resolve\(\)\.then\(azione\);/
    .test(TOCCA_DUE_VOLTE),
  "se fra i due then comparisse un await, F11 F12 e H26 diventerebbero tre timbri");
ok("A · F11 e F12 usano ancora toccaDueVolte sul pulsante Salva",
  /const esitiDoppioSalva = await toccaDueVolte\(/.test(SCHERMATE));
ok("A · H26 usa ancora toccaDueVolte sul pulsante Esegui",
  /const esitiDoppioEsegui = await toccaDueVolte\(/.test(SCHERMATE));

// E le due di import-database, anch'esse fuori da uno scenario.
const IMPORT_DB = leggi("test/simulazione/import-database.mjs");
ok("A · IMP-36/IMP-37 lanciano due importaPdf() insieme",
  /await Promise\.allSettled\(\[P\.importaPdf\(\), P\.importaPdf\(\)\]\)/.test(IMPORT_DB));

// ===========================================================================
// B. DIFETTO RIPRODOTTO (LSV-01): la guardia RO-01a cerca il PRAGMA nel file
//    intero, non in apriPalestra()
// ===========================================================================
// RO-01a dice "apriPalestra() impone PRAGMA query_only subito dopo
// l'apertura", ma prova la sua tesi con una regex su TUTTO lib/palestra.ts.
// La stessa stringa compare una seconda volta in eseguiConPreparazione(), che
// e' un'altra connessione e un'altra funzione: finche' quella resta, la
// guardia e' vera anche se apriPalestra() ha perso la sua riga.
//
// Qui lo si dimostra senza toccare niente sul disco: si toglie la riga IN
// MEMORIA e si riapplica la regex della guardia alla copia mutilata.
const SORGENTE_PALESTRA = leggi("lib/palestra.ts");
const REGEX_DELLA_GUARDIA = /PRAGMA query_only = ON/;
const RIGA_DI_APRI = '  await palestra.execAsync("PRAGMA query_only = ON");';

ok("B · la riga che RO-01a dice di sorvegliare e' al suo posto",
  SORGENTE_PALESTRA.includes(RIGA_DI_APRI));
const palestraSenzaSolaLettura = SORGENTE_PALESTRA.replace(RIGA_DI_APRI, "");
difetto("LSV-01",
  "RO-01a (test/simulazione/motore-sql.mjs:769) resta VERDE anche con apriPalestra() privata del PRAGMA: la regex trova l'altra occorrenza, quella di eseguiConPreparazione()",
  REGEX_DELLA_GUARDIA.test(palestraSenzaSolaLettura) &&
    (SORGENTE_PALESTRA.match(/PRAGMA query_only = ON/g) ?? []).length === 2,
  `occorrenze nel file: ${(SORGENTE_PALESTRA.match(/PRAGMA query_only = ON/g) ?? []).length}`);

// La conseguenza misurata, che e' la ragione per cui vale la pena dirlo:
// revocando la sola lettura in apriPalestra() cadono 11 delle 12 guardie RO-*
// (126 -> 115). L'unica che resta in piedi e' proprio RO-01a, cioe' quella che
// nel nome promette di sorvegliare esattamente quella riga.
ok("B · le altre guardie RO-* sono invece comportamentali (passano da palestra.esegui)",
  /corretto\("RO-01",[\s\S]{0,400}?hUpdate\.riuscito === false/.test(leggi("test/simulazione/motore-sql.mjs")));

// ===========================================================================
// C. DIFETTO RIPRODOTTO (LSV-02): la copia a mano di useAutoSync in
//    sync-fusione e' rimasta alla struttura PRIMA della correzione
// ===========================================================================
// applicaComeUseAutoSync() si dichiara "ricopiata riga per riga da
// lib/sync/useAutoSync.ts (righe 46-63)" e si impegna a essere riallineata se
// l'hook cambia. L'hook e' cambiato — la correzione REG-07 gli ha messo
// inTransazione() al posto di withTransactionAsync() — e la copia no.
//
// Nessuna guardia ne risulta falsamente verde, perche' in sync-fusione quella
// funzione e' sempre chiamata da sola, mai in corsa. Ma la superficie "sync"
// e' oggi CIECA alla coda (341/341 invariati con la coda disattivata), e il
// commento promette una fedelta' che non c'e' piu': chi ci costruisse sopra
// uno scenario di concorrenza otterrebbe una guardia svuotata senza accorgersene.
const HOOK = leggi("lib/sync/useAutoSync.ts");
const SYNC_FUSIONE = leggi("test/simulazione/sync-fusione.mjs");
const COPIA = corpoScenario(SYNC_FUSIONE, "async function applicaComeUseAutoSync(ricevuti, daInviare) {")
  ?? "";

ok("C · l'hook vero applica il pacchetto remoto dentro la coda",
  /await inTransazione\(async \(d\) => \{/.test(HOOK));
difetto("LSV-02",
  "applicaComeUseAutoSync (test/simulazione/sync-fusione.mjs:1533) usa ancora base.withTransactionAsync, mentre lib/sync/useAutoSync.ts:54 e' passato a inTransazione()",
  /base\.withTransactionAsync\(/.test(COPIA) && !/inTransazione\(/.test(COPIA),
  "la copia si dichiara fedele riga per riga all'hook, e non lo e' piu'");

// ===========================================================================
// ESITO
// ===========================================================================
console.log("\nlente \"scenari svuotati\" — i corpi degli scenari che reggono le guardie");
if (difettiRiprodotti.length) {
  console.log(`\nDIFETTI RIPRODOTTI (${difettiRiprodotti.length}). Sono VERDI perche' verificano il`);
  console.log("comportamento OSSERVATO: diventeranno rossi quando verranno corretti.");
  for (const d of difettiRiprodotti) console.log("  - " + d);
}
console.log(`\npassati ${passati} su ${passati + falliti.length}`);
for (const f of falliti) console.log("  FALLITO: " + f);
process.exit(falliti.length ? 1 : 0);
