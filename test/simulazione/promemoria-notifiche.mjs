/**
 * SIMULAZIONE DELLA SUPERFICIE "PROMEMORIA E NOTIFICHE"
 * lib/promemoria.ts + lib/notifiche.ts + la logica di app/promemoria.tsx,
 * fatte girare sopra il banco con il CODICE VERO dell'app.
 *
 * Si esegue dalla radice del progetto, senza variabili d'ambiente:
 *
 *   node test/simulazione/promemoria-notifiche.mjs
 *
 * Il file si riavvia da solo con `--import ./test/banco/carica.mjs` e con
 * BANCO_DOPPI gia composta, come fa test/banco/prova-altri.mjs: i ganci del
 * banco vanno registrati prima di qualunque import, e questo e il solo modo di
 * ottenerlo senza chiedere a chi esegue di ricordarsi una riga di comando.
 *
 * PERCHE DUE INVOLUCRI GENERATI IN UNA CARTELLA TEMPORANEA.
 * I doppi del banco (expo-notifications.mjs, expo-sqlite-kv-store.mjs) sono di
 * altri agenti e non si toccano. Ma questa superficie vive proprio sui GUASTI:
 * "il permesso non risponde", "il deposito e illeggibile", "la programmazione
 * fallisce", e soprattutto "due applica() si accavallano". Gli spazi dei nomi
 * ESM sono in sola lettura: non si possono sostituire le funzioni dall'esterno.
 * Quindi qui si SCRIVONO DUE MODULI NUOVI in una cartella temporanea che
 * delegano ai doppi del banco aggiungendo due sole cose: un interruttore di
 * guasto e una coda di ritardi per governare l'ordine di risoluzione delle
 * promesse. Si registrano con BANCO_DOPPI, che non tocca niente di nessuno.
 * Nessun file del progetto viene modificato, nemmeno il banco.
 *
 * COSA SI SIMULA, in tredici parti:
 *   A. daTesto(): tutte le forme accettate, e quelle rifiutate che nessuno
 *      aveva ancora provato (cifre non ASCII, secondi, spazi interni, segni);
 *   B. oraValida() e comeTesto() ai confini;
 *   C. serializza/deserializza: giro completo, valori corrotti, esotici,
 *      campi misti, e la non-mutazione del PREDEFINITO;
 *   D. prossimaOccorrenza(): mezzanotte, cambio giorno/mese/anno, anno
 *      bisestile, e i due giorni dell'ora legale (con il fuso vero di Roma);
 *   E. giaFattoOggi(): i confini esatti della finestra, i fusi, e il parametro
 *      `p` che la funzione non guarda;
 *   F. testoNotifica() per tutti e cinque i blocchi;
 *   G. il deposito della preferenza: assente, vuoto, illeggibile, guasto in
 *      scrittura, e la forma esatta di cio che finisce in kv-store;
 *   H. i permessi: concesso, mai chiesto, negato, negato per sempre, revocato;
 *   I. applica(): spento, acceso, ordine delle chiamate, idempotenza, cambio
 *      d'ora e di tipo, iOS, ampiezza della cancellazione, ore impossibili;
 *   J. concorrenza: due applica() che si accavallano, in tre ordini diversi;
 *   K. ripristina() e programmate(): non devono mai sollevare;
 *   L. la SCHERMATA: la logica di app/promemoria.tsx ricopiata qui (il .tsx non
 *      si importa: il banco non ha react-native ne expo-router), con le
 *      sessioni vere scritte da registra() come fa components/Cronometro.tsx;
 *   M. offline: nessuna chiamata di rete in tutta la superficie, verificata con
 *      trappole su fetch, socket, TLS, http/https e DNS.
 *
 * CONVENZIONE SUI DIFETTI (la stessa degli altri agenti del banco).
 * Un difetto dell'app NON viene corretto qui e non rende rossa la prova: lo
 * scenario che lo riproduce si chiama "DIFETTO RIPRODOTTO: ..." e verifica il
 * comportamento OSSERVATO, cosi resta una rete di sicurezza che diventera
 * rossa il giorno in cui il difetto verra corretto. L'elenco viene ristampato
 * in fondo, separato dal conteggio.
 *
 * FALSIFICAZIONE (fatta e misurata, non immaginata). Una prova che non puo
 * diventare rossa non dimostra niente. Tre indebolimenti, tutti applicati DA
 * FUORI riscrivendo il sorgente in una COPIA del progetto (mai l'originale):
 *
 *   1) togliere `await N.cancelAllScheduledNotificationsAsync();` dalla riga 73
 *      di lib/notifiche.ts  -> 19 verifiche rosse (idempotenza, cambio d'ora,
 *      cambio di tipo, spegnimento, ampiezza della cancellazione);
 *   2) cambiare `if (!chiediSeManca || !attuale.canAskAgain) return false;`
 *      in `if (!chiediSeManca) return false;` (riga 46) -> 3 verifiche rosse:
 *      l'app torna a insistere su un permesso negato per sempre;
 *   3) cambiare `if (q.getTime() <= adesso.getTime())` in `<` (riga 95 di
 *      lib/promemoria.ts) -> 3 verifiche rosse: all'ora esatta si programma un
 *      avviso gia trascorso.
 *
 * La ricetta per rifare la falsificazione:
 *   cp -r /home/user/learning_app /tmp/falsifica && cd /tmp/falsifica
 *   sed -i '73d' lib/notifiche.ts
 *   node test/simulazione/promemoria-notifiche.mjs
 *
 * LIMITI DI QUESTA PROVA — cosa un verde qui NON dimostra:
 *   - IL TEMPO NON PASSA. Il doppio delle notifiche tiene una coda che non
 *     suona mai: si prova COSA viene chiesto al sistema operativo, non che il
 *     sistema mantenga la promessa. Che la notifica arrivi davvero alle 07:00,
 *     dopo un riavvio, con l'ottimizzazione della batteria attiva e con l'app
 *     mai aperta da giorni, lo dice solo il telefono.
 *   - NIENTE INTERFACCIA. app/promemoria.tsx non si carica: la sua logica e
 *     RICOPIATA qui e dichiarata sul posto. Un difetto che sta nel .tsx
 *     (ordine dei render, stato di React, tocco doppio reale) non si vede.
 *     Dove la copia riproduce una chiusura obsoleta di React lo dico sul posto.
 *   - L'ASINCRONIA E FINTA. Sotto c'e node:sqlite, sincrono. Gli
 *     interfogliamenti di questa prova sono costruiti con ritardi espliciti:
 *     dimostrano che l'accavallamento e POSSIBILE e cosa produce, non con
 *     quale probabilita avvenga su Android.
 *   - Il canale Android, l'importanza e il suono vengono registrati in una
 *     Map: che Android li onori non e provabile qui.
 */
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const QUESTA_CARTELLA = dirname(fileURLToPath(import.meta.url));
const RADICE_PROGETTO = resolve(QUESTA_CARTELLA, "..", "..");
const CARTELLA_BANCO = join(RADICE_PROGETTO, "test", "banco");

// ------------------------------------------------------- RIAVVIO CON I GANCI
if (!process.env.SIM_PROMEMORIA_IN_CORSO) {
  const { DOPPI_ALTRI } = await import(join(CARTELLA_BANCO, "doppi-altri.mjs"));
  const involucri = mkdtempSync(join(tmpdir(), "sim-promemoria-involucri-"));
  scriviInvolucri(involucri);

  const esito = spawnSync(
    process.execPath,
    ["--import", "./test/banco/carica.mjs", "test/simulazione/promemoria-notifiche.mjs"],
    {
      cwd: RADICE_PROGETTO,
      stdio: "inherit",
      env: {
        ...process.env,
        SIM_PROMEMORIA_IN_CORSO: "1",
        SIM_PROMEMORIA_INVOLUCRI: involucri,
        // Fuso di partenza fisso: senza, i confronti su mezzanotte e ora
        // legale dipenderebbero da dove gira il contenitore.
        TZ: "Europe/Rome",
        BANCO_DOPPI: JSON.stringify({
          ...DOPPI_ALTRI,
          "expo-notifications": join(involucri, "doppio-notifiche.mjs"),
          "expo-sqlite/kv-store": join(involucri, "doppio-kv.mjs"),
        }),
      },
    }
  );
  // Come le prove del banco: si pulisce solo se e andato tutto bene, perche
  // dopo un fallimento gli involucri servono per capire cosa e successo.
  if ((esito.status ?? 1) === 0) rmSync(involucri, { recursive: true, force: true });
  else console.log(`involucri conservati in: ${involucri}`);
  process.exit(esito.status ?? 1);
}

/**
 * Scrive i due moduli che delegano ai doppi del banco. Sono qui dentro e non
 * in due file del repository di proposito: nascono e muoiono con la prova, e
 * nessun altro agente puo inciamparci.
 */
function scriviInvolucri(cartella) {
  mkdirSync(cartella, { recursive: true });
  const notificheBanco = JSON.stringify(join(CARTELLA_BANCO, "expo-notifications.mjs"));
  const kvBanco = JSON.stringify(join(CARTELLA_BANCO, "expo-sqlite-kv-store.mjs"));

  writeFileSync(join(cartella, "doppio-notifiche.mjs"), `
/** Involucro di prova su expo-notifications del banco: guasti e ritardi. */
import * as banco from ${notificheBanco};

/** Messaggio d'errore, oppure null. Simula il nativo presente ma guasto. */
export const guasto = { attivo: null };
/** Code di ritardi in ms, una per operazione: governano l'interfogliamento. */
export const ritardi = { cancella: [], permesso: [], canale: [], programma: [] };

function attendi(coda) {
  const ms = coda.shift() ?? 0;
  return ms > 0 ? new Promise((r) => setTimeout(r, ms)) : Promise.resolve();
}
function controlla() {
  if (guasto.attivo) throw new Error(guasto.attivo);
}

export function azzeraInvolucro() {
  guasto.attivo = null;
  for (const c of Object.values(ritardi)) c.length = 0;
}

export const AndroidImportance = banco.AndroidImportance;
export const AndroidNotificationPriority = banco.AndroidNotificationPriority;
export const SchedulableTriggerInputTypes = banco.SchedulableTriggerInputTypes;

export async function getPermissionsAsync() {
  controlla(); await attendi(ritardi.permesso); return banco.getPermissionsAsync();
}
export async function requestPermissionsAsync(r) {
  controlla(); return banco.requestPermissionsAsync(r);
}
export async function setNotificationChannelAsync(id, c) {
  controlla(); await attendi(ritardi.canale); return banco.setNotificationChannelAsync(id, c);
}
export async function getNotificationChannelsAsync() {
  controlla(); return banco.getNotificationChannelsAsync();
}
export async function deleteNotificationChannelAsync(id) {
  controlla(); return banco.deleteNotificationChannelAsync(id);
}
export async function cancelAllScheduledNotificationsAsync() {
  controlla(); await attendi(ritardi.cancella); return banco.cancelAllScheduledNotificationsAsync();
}
export async function cancelScheduledNotificationAsync(i) {
  controlla(); return banco.cancelScheduledNotificationAsync(i);
}
export async function scheduleNotificationAsync(r) {
  controlla(); await attendi(ritardi.programma); return banco.scheduleNotificationAsync(r);
}
export async function getAllScheduledNotificationsAsync() {
  controlla(); return banco.getAllScheduledNotificationsAsync();
}
export async function dismissAllNotificationsAsync() {
  controlla(); return banco.dismissAllNotificationsAsync();
}
export function setNotificationHandler(g) { return banco.setNotificationHandler(g); }
export function addNotificationReceivedListener() { return banco.addNotificationReceivedListener(); }
export function addNotificationResponseReceivedListener() { return banco.addNotificationResponseReceivedListener(); }

export default {
  AndroidImportance, AndroidNotificationPriority, SchedulableTriggerInputTypes,
  addNotificationReceivedListener, addNotificationResponseReceivedListener,
  cancelAllScheduledNotificationsAsync, cancelScheduledNotificationAsync,
  deleteNotificationChannelAsync, dismissAllNotificationsAsync,
  getAllScheduledNotificationsAsync, getNotificationChannelsAsync,
  getPermissionsAsync, requestPermissionsAsync, scheduleNotificationAsync,
  setNotificationChannelAsync, setNotificationHandler,
};
`);

  writeFileSync(join(cartella, "doppio-kv.mjs"), `
/** Involucro di prova sul kv-store su SQLite del banco: guasti e giornale. */
import deposito from ${kvBanco};

export const guasto = { lettura: null, scrittura: null };
export const giornale = [];

const involucro = {
  async getItem(chiave) {
    if (guasto.lettura) { giornale.push({ azione: "legge", chiave, esito: "guasto" }); throw new Error(guasto.lettura); }
    const v = await deposito.getItem(chiave);
    giornale.push({ azione: "legge", chiave, esito: "ok", valore: v });
    return v;
  },
  async setItem(chiave, valore) {
    if (guasto.scrittura) { giornale.push({ azione: "scrive", chiave, esito: "guasto" }); throw new Error(guasto.scrittura); }
    await deposito.setItem(chiave, valore);
    giornale.push({ azione: "scrive", chiave, esito: "ok", valore });
  },
  async removeItem(chiave) { return deposito.removeItem(chiave); },
  async getAllKeys() { return deposito.getAllKeys(); },
  async clear() { return deposito.clear(); },
  getItemSync(chiave) { return deposito.getItemSync(chiave); },
  setItemSync(chiave, valore) { return deposito.setItemSync(chiave, valore); },
  removeItemSync(chiave) { return deposito.removeItemSync(chiave); },
};

/** Legge saltando l'involucro: serve a guardare cosa e finito davvero su disco. */
export function leggiGrezzo(chiave) { return deposito.getItemSync(chiave); }
export function chiaviGrezze() { return deposito.getAllKeysSync(); }
export function svuota() {
  deposito.clearSync();
  giornale.length = 0;
  guasto.lettura = null;
  guasto.scrittura = null;
}

export const AsyncStorage = involucro;
export const Storage = involucro;
export default involucro;
`);
}

// =========================================================================
// DA QUI IN POI GIRA IL FIGLIO, con i ganci del banco gia registrati.
// =========================================================================

// ------------------------------------------------------- TRAPPOLE DI RETE
// Si installano PRIMA di qualunque import dinamico del codice dell'app (gli
// import statici qui sotto sono solo moduli del banco, che non hanno rete):
// l'invariante offline si
// verifica, non si dichiara. Non basta dire "funziona": va dimostrato che
// nessuno ha nemmeno provato ad aprire un socket.
const retiTentate = [];
{
  const net = await import("node:net");
  const tls = await import("node:tls");
  const http = await import("node:http");
  const https = await import("node:https");
  const dns = await import("node:dns");

  globalThis.fetch = (...a) => {
    retiTentate.push({ via: "fetch", bersaglio: String(a[0]) });
    return Promise.reject(new Error("rete vietata in questa prova"));
  };
  const connettiOriginale = net.Socket.prototype.connect;
  net.Socket.prototype.connect = function (...a) {
    retiTentate.push({ via: "socket", bersaglio: JSON.stringify(a[0] ?? null) });
    return connettiOriginale.apply(this, a);
  };
  for (const [nome, modulo, chiave] of [
    ["tls.connect", tls.default ?? tls, "connect"],
    ["http.request", http.default ?? http, "request"],
    ["https.request", https.default ?? https, "request"],
    ["dns.lookup", dns.default ?? dns, "lookup"],
  ]) {
    const originale = modulo[chiave];
    try {
      modulo[chiave] = function (...a) {
        retiTentate.push({ via: nome, bersaglio: String(a[0]) });
        return originale.apply(this, a);
      };
    } catch {
      // alcune proprieta dei moduli nativi sono in sola lettura: non e un
      // problema, la trappola su Socket.connect copre comunque il caso.
    }
  }
}

// ------------------------------------------------------------------ CONTEGGIO
let passati = 0;
const falliti = [];
const difettiRiprodotti = [];

function ok(nome, condizione, extra = "") {
  if (condizione) {
    passati++;
    if (nome.startsWith("DIFETTO RIPRODOTTO")) difettiRiprodotti.push(nome);
  } else {
    falliti.push(`${nome}${extra ? " — " + extra : ""}`);
  }
}

function uguali(nome, ottenuto, atteso) {
  const a = JSON.stringify(atteso);
  const o = JSON.stringify(ottenuto);
  ok(nome, a === o, `atteso ${a}, ottenuto ${o}`);
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

async function nonLancia(nome, azione) {
  try {
    const v = await azione();
    passati++;
    return v;
  } catch (errore) {
    falliti.push(`${nome} — ha lanciato: ${String(errore?.message ?? errore)}`);
    return null;
  }
}

/** Esegue `azione` in un altro fuso orario e rimette quello di prima. */
async function conFuso(nome, azione) {
  const precedente = process.env.TZ;
  process.env.TZ = nome;
  try {
    return await azione();
  } finally {
    process.env.TZ = precedente;
  }
}

/** Una data in ORA LOCALE, senza passare da una stringa ambigua. */
function locale(anno, mese, giorno, ora = 0, minuto = 0, secondo = 0, ms = 0) {
  return new Date(anno, mese - 1, giorno, ora, minuto, secondo, ms);
}

// ------------------------------------------------------------- PREPARAZIONE
import { configuraCartella } from "../banco/expo-sqlite.mjs";
import * as RN from "../banco/react-native.mjs";
import * as Banco from "../banco/expo-notifications.mjs";

const involucri = process.env.SIM_PROMEMORIA_INVOLUCRI;
const Doppio = await import(join(involucri, "doppio-notifiche.mjs"));
const Kv = await import(join(involucri, "doppio-kv.mjs"));

// Obbligatoria: senza, due prove in parallelo si contendono lo stesso
// percorso.db. Qui dentro finiscono sia percorso.db sia ExpoSQLiteStorage.
const cartella = configuraCartella(mkdtempSync(join(tmpdir(), "sim-promemoria-")));

// Import DINAMICO del codice vero: uno statico verrebbe risolto prima dei ganci.
const promemoria = await import("../../lib/promemoria.ts");
const notifiche = await import("../../lib/notifiche.ts");
const sessioniLib = await import("../../lib/sessioni.ts");
const dbApp = await import("../../lib/db.ts");

const {
  PREDEFINITO, tipoValido, oraValida, comeTesto, daTesto,
  serializza, deserializza, prossimaOccorrenza, giaFattoOggi, testoNotifica,
} = promemoria;
const { DURATA_PREVISTA } = sessioniLib;

await dbApp.apri("sim-prom");

/** Riporta banco, involucri e deposito alla condizione di partenza. */
function pulisci() {
  Banco.azzera();
  Doppio.azzeraInvolucro();
  Kv.svuota();
  RN.configuraPiattaforma("android");
}

const azioni = () => Banco.giornale.map((v) => v.azione);
const inCoda = () => notifiche.programmate();
const acceso = (o = 7, m = 0, tipo = "mattina") => ({ attivo: true, ora: o, minuto: m, tipo });
const spento = (o = 7, m = 0, tipo = "mattina") => ({ attivo: false, ora: o, minuto: m, tipo });

// ==========================================================================
// PARTE A — daTesto(): le forme che l'utente digita sulla tastiera del telefono
// ==========================================================================
{
  const orario = (o, m) => ({ ora: o, minuto: m });

  uguali("A/forma canonica 07:30", daTesto("07:30"), orario(7, 30));
  uguali("A/senza zero iniziale 7:30", daTesto("7:30"), orario(7, 30));
  uguali("A/senza separatore 0730", daTesto("0730"), orario(7, 30));
  uguali("A/con il punto 7.30", daTesto("7.30"), orario(7, 30));
  uguali("A/con il punto e lo zero 07.30", daTesto("07.30"), orario(7, 30));
  uguali("A/spazi esterni tollerati", daTesto("  07:30  "), orario(7, 30));
  uguali("A/a capo finale tollerato dal trim", daTesto("07:30\n"), orario(7, 30));
  uguali("A/tabulazione tollerata dal trim", daTesto("\t07:30\t"), orario(7, 30));

  // Mezzanotte e un'ora valida, non un valore assente: le quattro forme.
  uguali("A/mezzanotte 00:00", daTesto("00:00"), orario(0, 0));
  uguali("A/mezzanotte 0:00", daTesto("0:00"), orario(0, 0));
  uguali("A/mezzanotte 0000", daTesto("0000"), orario(0, 0));
  uguali("A/mezzanotte 0.00", daTesto("0.00"), orario(0, 0));
  ok("A/mezzanotte torna in testo come 00:00", comeTesto({ ...PREDEFINITO, ora: 0, minuto: 0 }) === "00:00");

  uguali("A/ultimo minuto del giorno 23:59", daTesto("23:59"), orario(23, 59));

  // La forma a tre cifre: la regex la accetta leggendo la prima come ora.
  uguali("A/tre cifre 130 vale 01:30", daTesto("130"), orario(1, 30));
  uguali("A/tre cifre 000 vale 00:00", daTesto("000"), orario(0, 0));
  uguali("A/tre cifre 945 vale 09:45", daTesto("945"), orario(9, 45));

  // ------------------------------------------- forme che devono essere rifiutate
  const rifiutate = [
    ["ora impossibile", "25:00"],
    ["ora 24 rifiutata", "24:00"],
    ["minuto impossibile", "07:99"],
    ["minuto 60 rifiutato", "07:60"],
    ["minuto 60 senza separatore", "0760"],
    ["testo libero", "mattina"],
    ["stringa vuota", ""],
    ["soli spazi", "   "],
    ["minuto a una cifra", "7:3"],
    ["con i secondi", "07:30:00"],
    ["spazi interni", "7 : 30"],
    ["cinque cifre", "12345"],
    ["separatore sbagliato", "7-30"],
    ["ora negativa", "-7:30"],
    ["due sole cifre", "99"],
    ["una sola cifra", "7"],
    ["cifre arabo-indiane", "٠٧:٣٠"],
    ["separatore virgola", "7,30"],
    ["ora a tre cifre", "123:45"],
    ["dopo i minuti c'e altro", "07:30x"],
    ["prima dell'ora c'e altro", "x07:30"],
    ["con il fuso", "07:30+02:00"],
    ["notazione a 12 ore", "7:30 PM"],
    ["numero decimale", "7.5"],
    ["piu unario", "+7:30"],
    ["spazio interno senza separatore", "07 30"],
  ];
  for (const [che, valore] of rifiutate) {
    ok(`A/rifiutata: ${che} (${JSON.stringify(valore)})`, daTesto(valore) === null,
       JSON.stringify(daTesto(valore)));
  }

  // daTesto passa da String(): un valore non stringa non deve farla sollevare.
  uguali("A/il numero 730 passa da String() e vale 01:30... no: 07:30", daTesto(730), orario(7, 30));
  await nonLancia("A/null non solleva", async () => daTesto(null));
  await nonLancia("A/undefined non solleva", async () => daTesto(undefined));
  ok("A/null non e un'ora", daTesto(null) === null);
  ok("A/undefined non e un'ora", daTesto(undefined) === null);
}

// ==========================================================================
// PARTE B — oraValida(), comeTesto(), tipoValido() ai confini
// ==========================================================================
{
  ok("B/mezzanotte valida", oraValida(0, 0));
  ok("B/23:59 valida", oraValida(23, 59));
  ok("B/24 rifiutata", !oraValida(24, 0));
  ok("B/minuto 60 rifiutato", !oraValida(7, 60));
  ok("B/ora negativa rifiutata", !oraValida(-1, 0));
  ok("B/minuto negativo rifiutato", !oraValida(7, -1));
  ok("B/ora frazionaria rifiutata", !oraValida(7.5, 0));
  ok("B/minuto frazionario rifiutato", !oraValida(7, 0.5));
  ok("B/NaN rifiutato", !oraValida(NaN, 0));
  ok("B/Infinity rifiutato", !oraValida(Infinity, 0));
  ok("B/-Infinity rifiutato", !oraValida(0, -Infinity));
  ok("B/stringa numerica rifiutata", !oraValida("7", 30));
  ok("B/null rifiutato", !oraValida(null, 0));
  ok("B/undefined rifiutato", !oraValida(undefined, undefined));
  ok("B/-0 accettato come 0", oraValida(-0, -0));

  ok("B/comeTesto mette lo zero iniziale", comeTesto(acceso(7, 5)) === "07:05");
  ok("B/comeTesto a mezzogiorno", comeTesto(acceso(12, 30)) === "12:30");
  ok("B/comeTesto a mezzanotte", comeTesto(acceso(0, 0)) === "00:00");
  ok("B/comeTesto alle 23:59", comeTesto(acceso(23, 59)) === "23:59");
  // Andata e ritorno su tutte le 1440 ore del giorno: e il contratto fra il
  // campo di testo della schermata e la preferenza salvata.
  let giroCompleto = 0;
  for (let o = 0; o < 24; o++) {
    for (let m = 0; m < 60; m++) {
      const letto = daTesto(comeTesto(acceso(o, m)));
      if (letto && letto.ora === o && letto.minuto === m) giroCompleto++;
    }
  }
  ok("B/tutte le 1440 ore del giorno fanno andata e ritorno", giroCompleto === 1440, `${giroCompleto}/1440`);

  for (const t of ["mattina", "artefatto", "lettura", "paper", "ripasso"]) {
    ok(`B/tipo valido: ${t}`, tipoValido(t));
  }
  for (const t of ["", "Mattina", "MATTINA", "studio", "mattina ", "toString", "constructor"]) {
    ok(`B/tipo non valido: ${JSON.stringify(t)}`, !tipoValido(t));
  }

  ok("B/il predefinito e spento", PREDEFINITO.attivo === false);
  ok("B/il predefinito ha un'ora valida", oraValida(PREDEFINITO.ora, PREDEFINITO.minuto));
  ok("B/il predefinito ha un tipo valido", tipoValido(PREDEFINITO.tipo));
  uguali("B/il predefinito e 07:00 mattina spento", PREDEFINITO,
         { attivo: false, ora: 7, minuto: 0, tipo: "mattina" });
}

// ==========================================================================
// PARTE C — serializza / deserializza: la preferenza deve sopravvivere a tutto
// ==========================================================================
{
  const p = { attivo: true, ora: 6, minuto: 45, tipo: "lettura" };
  uguali("C/andata e ritorno identico", deserializza(serializza(p)), p);
  uguali("C/serializza scrive esattamente i quattro campi",
         Object.keys(JSON.parse(serializza(p))).sort(), ["attivo", "minuto", "ora", "tipo"]);

  // Un campo in piu nell'oggetto in ingresso non deve finire sul disco.
  uguali("C/serializza ignora i campi estranei",
         Object.keys(JSON.parse(serializza({ ...p, segreto: 1, tipo2: "x" }))).sort(),
         ["attivo", "minuto", "ora", "tipo"]);

  uguali("C/assente da il predefinito", deserializza(null), PREDEFINITO);
  uguali("C/stringa vuota da il predefinito", deserializza(""), PREDEFINITO);
  uguali("C/undefined da il predefinito", deserializza(undefined), PREDEFINITO);
  uguali("C/illeggibile da il predefinito", deserializza("{non json"), PREDEFINITO);
  uguali("C/troncato da il predefinito", deserializza('{"attivo":true,"ora":'), PREDEFINITO);
  uguali("C/numero da il predefinito", deserializza("42"), PREDEFINITO);
  uguali("C/stringa JSON da il predefinito", deserializza('"07:30"'), PREDEFINITO);
  uguali("C/null JSON da il predefinito", deserializza("null"), PREDEFINITO);
  uguali("C/true JSON da il predefinito", deserializza("true"), PREDEFINITO);
  // Un array supera la guardia typeof, ma tutti i campi ricadono lo stesso.
  uguali("C/array vuoto equivale al predefinito", deserializza("[]"), PREDEFINITO);
  uguali("C/array pieno equivale al predefinito", deserializza("[1,2]"), PREDEFINITO);

  ok("C/attivo solo se esattamente true",
     deserializza('{"attivo":"si","ora":7,"minuto":0,"tipo":"mattina"}').attivo === false);
  ok("C/attivo 1 non basta",
     deserializza('{"attivo":1,"ora":7,"minuto":0,"tipo":"mattina"}').attivo === false);
  ok("C/attivo true resta acceso",
     deserializza('{"attivo":true,"ora":7,"minuto":0,"tipo":"mattina"}').attivo === true);

  ok("C/ora fuori scala ricade sul predefinito",
     deserializza('{"attivo":true,"ora":99,"minuto":0,"tipo":"mattina"}').ora === PREDEFINITO.ora);
  ok("C/tipo ignoto ricade sul predefinito",
     deserializza('{"attivo":true,"ora":7,"minuto":0,"tipo":"inventato"}').tipo === PREDEFINITO.tipo);
  ok("C/campi ignoti di una versione futura non disturbano",
     deserializza('{"attivo":true,"ora":8,"minuto":15,"tipo":"mattina","nuovo":1}').ora === 8);

  // oraValida e valutata sulla COPPIA: un minuto assurdo trascina anche l'ora.
  uguali("C/minuto fuori scala fa ricadere ANCHE l'ora (coppia, non campo)",
         deserializza('{"attivo":true,"ora":9,"minuto":99,"tipo":"mattina"}'),
         { attivo: true, ora: 7, minuto: 0, tipo: "mattina" });
  uguali("C/minuto negativo fa ricadere la coppia",
         deserializza('{"attivo":true,"ora":9,"minuto":-1,"tipo":"mattina"}'),
         { attivo: true, ora: 7, minuto: 0, tipo: "mattina" });
  // Ora come stringa: ricade l'ora, ma il minuto valido sopravvive perche
  // oraValida(7,15) e vera.
  uguali("C/ora come stringa: ricade l'ora, il minuto resta",
         deserializza('{"attivo":true,"ora":"8","minuto":15,"tipo":"mattina"}'),
         { attivo: true, ora: 7, minuto: 15, tipo: "mattina" });
  uguali("C/ora frazionaria ricade sulla coppia",
         deserializza('{"attivo":true,"ora":7.5,"minuto":30,"tipo":"mattina"}'),
         { attivo: true, ora: 7, minuto: 0, tipo: "mattina" });
  uguali("C/ora NaN non e rappresentabile in JSON: diventa null e ricade",
         deserializza('{"attivo":true,"ora":null,"minuto":30,"tipo":"mattina"}'),
         { attivo: true, ora: 7, minuto: 30, tipo: "mattina" });
  uguali("C/tipo non stringa ricade",
         deserializza('{"attivo":true,"ora":7,"minuto":0,"tipo":3}'),
         { attivo: true, ora: 7, minuto: 0, tipo: "mattina" });
  uguali("C/oggetto vuoto da il predefinito con attivo falso",
         deserializza("{}"), PREDEFINITO);

  // Il PREDEFINITO e una costante esportata: se deserializza restituisse LUI
  // invece di una copia, il primo chiamante che tocca il risultato
  // cambierebbe il predefinito per tutta l'app.
  const uno = deserializza(null);
  uno.ora = 23;
  uno.attivo = true;
  ok("C/deserializza restituisce una COPIA, non il predefinito",
     PREDEFINITO.ora === 7 && PREDEFINITO.attivo === false, JSON.stringify(PREDEFINITO));
  ok("C/due deserializza danno oggetti distinti", deserializza(null) !== deserializza(null));

  // Andata e ritorno su tutti e cinque i tipi, acceso e spento.
  let giri = 0;
  for (const t of ["mattina", "artefatto", "lettura", "paper", "ripasso"]) {
    for (const a of [true, false]) {
      const q = { attivo: a, ora: 21, minuto: 5, tipo: t };
      if (JSON.stringify(deserializza(serializza(q))) === JSON.stringify(q)) giri++;
    }
  }
  ok("C/andata e ritorno per i 5 tipi, acceso e spento", giri === 10, `${giri}/10`);
}

// ==========================================================================
// PARTE D — prossimaOccorrenza(): mezzanotte, cambio giorno, ora legale
// ==========================================================================
{
  ok("D/spento non programma niente", prossimaOccorrenza(spento(), locale(2026, 10, 5, 6, 0)) === null);
  ok("D/spento a mezzanotte non programma", prossimaOccorrenza(spento(0, 0), locale(2026, 10, 5, 0, 0)) === null);

  const oggi = prossimaOccorrenza(acceso(7, 0), locale(2026, 10, 5, 6, 0));
  ok("D/oggi se l'ora non e ancora passata",
     oggi.getDate() === 5 && oggi.getHours() === 7 && oggi.getMinutes() === 0);
  const domani = prossimaOccorrenza(acceso(7, 0), locale(2026, 10, 5, 8, 0));
  ok("D/domani se l'ora e gia passata", domani.getDate() === 6 && domani.getHours() === 7);

  // All'istante esatto si va al giorno dopo: programmare un avviso per un
  // istante gia trascorso lo farebbe suonare subito o mai.
  const esatto = prossimaOccorrenza(acceso(7, 0), locale(2026, 10, 5, 7, 0, 0, 0));
  ok("D/all'ora esatta si passa al giorno dopo", esatto.getDate() === 6 && esatto.getHours() === 7);
  const unMsPrima = prossimaOccorrenza(acceso(7, 0), locale(2026, 10, 5, 6, 59, 59, 999));
  ok("D/un millisecondo prima si programma ancora per oggi", unMsPrima.getDate() === 5);
  const unMsDopo = prossimaOccorrenza(acceso(7, 0), locale(2026, 10, 5, 7, 0, 0, 1));
  ok("D/un millisecondo dopo si va a domani", unMsDopo.getDate() === 6);

  ok("D/secondi e millisecondi azzerati",
     (() => { const q = prossimaOccorrenza(acceso(7, 0), locale(2026, 10, 5, 6, 59, 59, 777));
              return q.getSeconds() === 0 && q.getMilliseconds() === 0; })());

  // ------------------------------------------------------------ mezzanotte
  const mezzanotteDa2359 = prossimaOccorrenza(acceso(0, 0), locale(2026, 10, 5, 23, 59));
  ok("D/promemoria a mezzanotte valutato alle 23:59 suona fra un minuto",
     mezzanotteDa2359.getDate() === 6 && mezzanotteDa2359.getHours() === 0
     && mezzanotteDa2359.getTime() - locale(2026, 10, 5, 23, 59).getTime() === 60_000);
  const mezzanotteDa235959 = prossimaOccorrenza(acceso(0, 0), locale(2026, 10, 5, 23, 59, 59, 999));
  ok("D/a un millisecondo da mezzanotte manca ancora un millisecondo",
     mezzanotteDa235959.getTime() - locale(2026, 10, 5, 23, 59, 59, 999).getTime() === 1);
  // All'istante esatto di mezzanotte si salta di 24 ore: e la stessa regola
  // del <= di sopra, ma qui costa un giorno intero di silenzio.
  const mezzanotteEsatta = prossimaOccorrenza(acceso(0, 0), locale(2026, 10, 5, 0, 0, 0, 0));
  ok("D/a mezzanotte in punto il prossimo avviso e a 24 ore di distanza",
     mezzanotteEsatta.getTime() - locale(2026, 10, 5, 0, 0, 0, 0).getTime() === 24 * 3600_000);
  const mezzanotteUnMsDopo = prossimaOccorrenza(acceso(0, 0), locale(2026, 10, 5, 0, 0, 0, 1));
  ok("D/un millisecondo dopo mezzanotte: mancano quasi 24 ore",
     mezzanotteUnMsDopo.getDate() === 6 && mezzanotteUnMsDopo.getHours() === 0);

  // ------------------------------------------ cambio di mese, anno, bisestile
  const fineMese = prossimaOccorrenza(acceso(7, 0), locale(2026, 10, 31, 9, 0));
  ok("D/attraversa il cambio di mese", fineMese.getMonth() === 10 && fineMese.getDate() === 1);
  const fineGennaio = prossimaOccorrenza(acceso(7, 0), locale(2026, 1, 31, 9, 0));
  ok("D/31 gennaio porta al 1 febbraio", fineGennaio.getMonth() === 1 && fineGennaio.getDate() === 1);
  const capodanno = prossimaOccorrenza(acceso(7, 0), locale(2026, 12, 31, 23, 59));
  ok("D/il 31 dicembre alle 23:59 porta al 1 gennaio dell'anno dopo",
     capodanno.getFullYear() === 2027 && capodanno.getMonth() === 0
     && capodanno.getDate() === 1 && capodanno.getHours() === 7);
  const capodanooMezzanotte = prossimaOccorrenza(acceso(0, 0), locale(2026, 12, 31, 12, 0));
  ok("D/mezzanotte del 31 dicembre porta al 1 gennaio",
     capodanooMezzanotte.getFullYear() === 2027 && capodanooMezzanotte.getDate() === 1);
  // 2028 e bisestile: il 28 febbraio porta al 29, non al 1 marzo.
  const bisestile = prossimaOccorrenza(acceso(7, 0), locale(2028, 2, 28, 9, 0));
  ok("D/anno bisestile: dal 28 febbraio si passa al 29",
     bisestile.getMonth() === 1 && bisestile.getDate() === 29, bisestile.toString());
  const nonBisestile = prossimaOccorrenza(acceso(7, 0), locale(2027, 2, 28, 9, 0));
  ok("D/anno non bisestile: dal 28 febbraio si passa al 1 marzo",
     nonBisestile.getMonth() === 2 && nonBisestile.getDate() === 1);

  // ---------------------------------------------------------- ora legale
  // Il commento del modulo promette che l'avviso resta all'ora locale del
  // posto in cui ci si trova: e proprio nei due giorni del cambio che la
  // promessa si mette alla prova. Fuso vero, non finto.
  await conFuso("Europe/Rome", () => {
    // Primavera 2026: la notte fra il 28 e il 29 marzo le 02:00 diventano
    // 03:00. Le 02:30 di quel giorno NON ESISTONO.
    const primavera = prossimaOccorrenza(acceso(2, 30), locale(2026, 3, 29, 0, 30));
    ok("D/ora legale in primavera: le 02:30 inesistenti scivolano alle 03:30",
       primavera.getHours() === 3 && primavera.getMinutes() === 30 && primavera.getDate() === 29,
       primavera.toString());

    // Autunno 2026: la notte fra il 24 e il 25 ottobre le 03:00 tornano
    // 02:00. Le 02:30 esistono due volte: si sceglie la prima (CEST, +2).
    const autunno = prossimaOccorrenza(acceso(2, 30), locale(2026, 10, 25, 0, 30));
    ok("D/ora legale in autunno: delle due 02:30 si sceglie la prima (offset -120)",
       autunno.getHours() === 2 && autunno.getMinutes() === 30 && autunno.getTimezoneOffset() === -120,
       `${autunno.toString()} offset ${autunno.getTimezoneOffset()}`);

    // La conseguenza concreta: nel giorno del cambio la distanza fra due
    // avvisi consecutivi NON e di 24 ore.
    const sabato = prossimaOccorrenza(acceso(7, 0), locale(2026, 10, 24, 6, 0));
    const domenica = prossimaOccorrenza(acceso(7, 0), locale(2026, 10, 24, 8, 0));
    ok("D/tornando indietro l'ora, fra due avvisi passano 25 ore",
       domenica.getTime() - sabato.getTime() === 25 * 3600_000,
       String((domenica.getTime() - sabato.getTime()) / 3600_000));
    const venerdi = prossimaOccorrenza(acceso(7, 0), locale(2026, 3, 28, 6, 0));
    const sabatoP = prossimaOccorrenza(acceso(7, 0), locale(2026, 3, 28, 8, 0));
    ok("D/andando avanti l'ora, fra due avvisi passano 23 ore",
       sabatoP.getTime() - venerdi.getTime() === 23 * 3600_000,
       String((sabatoP.getTime() - venerdi.getTime()) / 3600_000));
  });

  // Il viaggio: la stessa preferenza vista da due fusi da due istanti locali
  // diversi. L'avviso resta alle 07:00 del posto, come promette il commento.
  const aRoma = await conFuso("Europe/Rome", () =>
    prossimaOccorrenza(acceso(7, 0), locale(2026, 11, 3, 6, 0)));
  const aCittaDelMessico = await conFuso("America/Mexico_City", () =>
    prossimaOccorrenza(acceso(7, 0), locale(2026, 11, 3, 6, 0)));
  ok("D/in viaggio l'avviso resta alle 07:00 locali, non alle 07:00 di casa",
     aRoma.getHours() === 7 && aCittaDelMessico.getHours() === 7
     && aRoma.getTime() !== aCittaDelMessico.getTime());

  // La data passata non viene modificata: e un oggetto del chiamante.
  const riferimento = locale(2026, 10, 5, 8, 0);
  const copia = riferimento.getTime();
  prossimaOccorrenza(acceso(7, 0), riferimento);
  ok("D/non modifica la data ricevuta", riferimento.getTime() === copia);
}

// ==========================================================================
// PARTE E — giaFattoOggi(): i confini esatti della finestra
// ==========================================================================
{
  const adesso = locale(2026, 10, 5, 9, 0);
  const p = acceso();
  const iso = (d) => d.toISOString();

  ok("E/sessione di stamattina riconosciuta", giaFattoOggi(p, [iso(locale(2026, 10, 5, 7, 10))], adesso));
  ok("E/sessione di ieri non conta", !giaFattoOggi(p, [iso(locale(2026, 10, 4, 7, 10))], adesso));
  ok("E/nessuna sessione", !giaFattoOggi(p, [], adesso));
  ok("E/data illeggibile ignorata senza sollevare", !giaFattoOggi(p, ["non una data"], adesso));
  ok("E/stringa vuota ignorata", !giaFattoOggi(p, [""], adesso));
  ok("E/sessione nel futuro di oggi non conta", !giaFattoOggi(p, [iso(locale(2026, 10, 5, 23, 0))], adesso));
  ok("E/fra piu sessioni basta quella di oggi",
     giaFattoOggi(p, [iso(locale(2026, 10, 1, 7, 0)), iso(locale(2026, 10, 5, 8, 0))], adesso));
  ok("E/tutte fuori finestra: falso",
     !giaFattoOggi(p, [iso(locale(2026, 10, 4, 23, 59)), iso(locale(2026, 10, 5, 9, 0, 0, 1))], adesso));

  // I tre confini esatti, che nessuno aveva ancora provato.
  ok("E/confine: sessione esattamente a mezzanotte locale conta (>=)",
     giaFattoOggi(p, [iso(locale(2026, 10, 5, 0, 0, 0, 0))], adesso));
  ok("E/confine: un millisecondo prima di mezzanotte non conta",
     !giaFattoOggi(p, [iso(locale(2026, 10, 4, 23, 59, 59, 999))], adesso));
  ok("E/confine: sessione esattamente ad adesso conta (<=)",
     giaFattoOggi(p, [iso(adesso)], adesso));
  ok("E/confine: un millisecondo dopo adesso non conta",
     !giaFattoOggi(p, [iso(new Date(adesso.getTime() + 1))], adesso));

  // Forme ISO diverse: il confronto avviene su epoch, quindi regge.
  ok("E/ISO con offset esplicito riconosciuto",
     giaFattoOggi(p, ["2026-10-05T07:10:00+02:00"], locale(2026, 10, 5, 9, 0)));
  ok("E/ISO in UTC con Z riconosciuto",
     giaFattoOggi(p, [new Date("2026-10-05T05:10:00Z").toISOString()], locale(2026, 10, 5, 9, 0)));
  ok("E/ISO senza fuso letto come ora locale",
     giaFattoOggi(p, ["2026-10-05T07:10:00"], locale(2026, 10, 5, 9, 0)));

  // La firma suggerisce che il promemoria conti: non conta. Il filtro per
  // tipo lo fa la query SQL del chiamante (app/promemoria.tsx riga 34).
  const soloDiOggi = [iso(locale(2026, 10, 5, 7, 10))];
  let identici = 0;
  for (const t of ["mattina", "artefatto", "lettura", "paper", "ripasso"]) {
    if (giaFattoOggi({ ...p, tipo: t }, soloDiOggi, adesso) === true) identici++;
  }
  ok("E/giaFattoOggi NON guarda il tipo del promemoria: stesso esito per tutti e cinque",
     identici === 5, `${identici}/5`);
  ok("E/giaFattoOggi non guarda nemmeno `attivo`",
     giaFattoOggi(spento(), soloDiOggi, adesso) === true);

  // Il fuso decide dove cade la mezzanotte: la stessa sessione puo essere di
  // oggi a Roma e di ieri a Citta del Messico.
  // 00:30 del 5 a Roma = 16:30 del 4 a Citta del Messico. L'istante del
  // controllo e lo stesso: 09:00 a Roma, 01:00 in Messico.
  const notturna = "2026-10-05T00:30:00+02:00";
  const controllo = new Date("2026-10-05T07:00:00Z");
  const aRoma = await conFuso("Europe/Rome", () => giaFattoOggi(p, [notturna], controllo));
  const aMessico = await conFuso("America/Mexico_City", () => giaFattoOggi(p, [notturna], controllo));
  ok("E/la stessa sessione e di oggi a Roma e di ieri in Messico",
     aRoma === true && aMessico === false, `roma ${aRoma} messico ${aMessico}`);

  // Non deve modificare l'elenco ricevuto.
  const elenco = [iso(locale(2026, 10, 5, 7, 10))];
  giaFattoOggi(p, elenco, adesso);
  ok("E/non modifica l'elenco ricevuto", elenco.length === 1);
  const rif = locale(2026, 10, 5, 9, 0);
  const prima = rif.getTime();
  giaFattoOggi(p, elenco, rif);
  ok("E/non modifica la data ricevuta", rif.getTime() === prima);
}

// ==========================================================================
// PARTE F — testoNotifica(): il testo che si legge di sbieco sullo schermo
// ==========================================================================
{
  const attesi = {
    mattina: "Blocco del mattino",
    artefatto: "Blocco artefatto",
    lettura: "Blocco lettura",
    paper: "Blocco paper",
    ripasso: "Ripasso",
  };
  for (const [tipo, titolo] of Object.entries(attesi)) {
    const t = testoNotifica(acceso(7, 0, tipo));
    ok(`F/titolo di ${tipo}`, t.titolo === titolo, t.titolo);
    ok(`F/corpo di ${tipo} dichiara i minuti previsti`,
       t.corpo === `${DURATA_PREVISTA[tipo]} minuti. Apri Percorso e avvia il cronometro.`, t.corpo);
    // Android mostra una riga sola sullo schermo bloccato.
    ok(`F/corpo di ${tipo} sotto gli 80 caratteri`, t.corpo.length <= 80, String(t.corpo.length));
    ok(`F/titolo di ${tipo} non vuoto e breve`, t.titolo.length > 0 && t.titolo.length <= 40);
  }
  // Il corpo piu lungo e quello di artefatto (45 minuti): e il caso peggiore.
  const lunghezze = Object.keys(attesi).map((t) => testoNotifica(acceso(7, 0, t)).corpo.length);
  ok("F/il corpo piu lungo e quello dell'artefatto",
     testoNotifica(acceso(7, 0, "artefatto")).corpo.length === Math.max(...lunghezze));

  ok("F/il testo non dipende dall'ora",
     testoNotifica(acceso(7, 0)).corpo === testoNotifica(acceso(23, 59)).corpo);
  ok("F/il testo non dipende da `attivo`",
     testoNotifica(acceso(7, 0)).titolo === testoNotifica(spento(7, 0)).titolo);

  // Tipo fuori dai cinque: deserializza lo impedisce, ma la funzione non si
  // difende da sola. Chi la chiamasse da una scorciatoia futura (deep link,
  // azione di notifica) otterrebbe un testo senza senso invece di un errore.
  const fuori = testoNotifica({ attivo: true, ora: 7, minuto: 0, tipo: "inventato" });
  ok("F/tipo fuori dai cinque: titolo undefined e corpo 'undefined minuti'",
     fuori.titolo === undefined && fuori.corpo.startsWith("undefined minuti"), JSON.stringify(fuori));
}

// ==========================================================================
// PARTE G — il deposito della preferenza (lib/notifiche.ts + kv-store vero)
// ==========================================================================
{
  pulisci();
  // Nessuna chiave: si parte dal predefinito e NON si scrive niente. Un'app
  // che inizializzasse il deposito al primo sguardo perderebbe la differenza
  // fra "mai impostato" e "impostato cosi".
  uguali("G/preferenza assente da il predefinito", await notifiche.leggiPromemoria(), PREDEFINITO);
  ok("G/leggere non scrive nulla nel deposito", Kv.chiaviGrezze().length === 0,
     JSON.stringify(Kv.chiaviGrezze()));
  ok("G/la lettura tocca la chiave 'promemoria' e basta",
     Kv.giornale.length === 1 && Kv.giornale[0].azione === "legge" && Kv.giornale[0].chiave === "promemoria",
     JSON.stringify(Kv.giornale));

  // Valore vuoto o illeggibile: la schermata si deve aprire lo stesso.
  pulisci();
  Kv.default.setItemSync("promemoria", "");
  uguali("G/valore vuoto da il predefinito", await notifiche.leggiPromemoria(), PREDEFINITO);
  Kv.default.setItemSync("promemoria", "{tronc");
  uguali("G/valore illeggibile da il predefinito", await notifiche.leggiPromemoria(), PREDEFINITO);
  Kv.default.setItemSync("promemoria", "[object Object]");
  uguali("G/valore scritto male da una versione futura da il predefinito",
         await notifiche.leggiPromemoria(), PREDEFINITO);

  // Il deposito che si guasta in lettura: leggiPromemoria ha un catch.
  pulisci();
  Kv.guasto.lettura = "database is locked";
  const letto = await nonLancia("G/deposito guasto in lettura non solleva", () => notifiche.leggiPromemoria());
  uguali("G/deposito guasto in lettura da il predefinito", letto, PREDEFINITO);
  Kv.guasto.lettura = null;

  // Scrittura: la forma esatta di cio che finisce sul disco.
  pulisci();
  await notifiche.salvaPromemoria({ attivo: true, ora: 6, minuto: 45, tipo: "lettura" });
  const grezzo = Kv.leggiGrezzo("promemoria");
  uguali("G/salva scrive esattamente i quattro campi",
         Object.keys(JSON.parse(grezzo)).sort(), ["attivo", "minuto", "ora", "tipo"]);
  uguali("G/salva scrive i valori giusti", JSON.parse(grezzo),
         { attivo: true, ora: 6, minuto: 45, tipo: "lettura" });
  ok("G/salva usa la chiave 'promemoria'", Kv.chiaviGrezze().includes("promemoria"));
  ok("G/salva non crea altre chiavi", Kv.chiaviGrezze().length === 1, JSON.stringify(Kv.chiaviGrezze()));
  uguali("G/giro completo deposito -> lettura", await notifiche.leggiPromemoria(),
         { attivo: true, ora: 6, minuto: 45, tipo: "lettura" });

  // Campi estranei dell'oggetto in memoria non devono finire sul disco.
  await notifiche.salvaPromemoria({ attivo: false, ora: 8, minuto: 0, tipo: "paper", extra: "x" });
  uguali("G/i campi estranei non arrivano al disco",
         Object.keys(JSON.parse(Kv.leggiGrezzo("promemoria"))).sort(),
         ["attivo", "minuto", "ora", "tipo"]);

  // Scritture rapide consecutive: vince l'ultima, senza residui.
  await Promise.all([
    notifiche.salvaPromemoria(acceso(5, 0)),
    notifiche.salvaPromemoria(acceso(6, 0)),
    notifiche.salvaPromemoria(acceso(9, 15)),
  ]);
  const dopoTre = await notifiche.leggiPromemoria();
  ok("G/tre scritture rapide lasciano una sola chiave", Kv.chiaviGrezze().length === 1);
  ok("G/tre scritture rapide: vince una delle tre, senza mescolanze",
     [5, 6, 9].includes(dopoTre.ora) && (dopoTre.ora !== 9 || dopoTre.minuto === 15),
     JSON.stringify(dopoTre));

  // Il guasto in scrittura NON e gestito, a differenza della lettura: la
  // promessa rigetta e il chiamante deve occuparsene.
  pulisci();
  Kv.guasto.scrittura = "disk I/O error";
  await lancia("G/deposito guasto in scrittura rigetta (nessun catch in salvaPromemoria)",
               () => notifiche.salvaPromemoria(acceso()), "disk I/O error");
  ok("G/dopo un guasto in scrittura il deposito resta vuoto", Kv.chiaviGrezze().length === 0);
  Kv.guasto.scrittura = null;

  // Una preferenza corrotta non blocca: si rilegge il predefinito e si
  // sovrascrive alla prima modifica. L'effetto collaterale va conosciuto:
  // la preferenza vera e perduta senza che nessuno lo dica.
  pulisci();
  Kv.default.setItemSync("promemoria", '{"attivo":true,"ora":21,"minuto":30,"tipo":"ripasso"');
  const rotta = await notifiche.leggiPromemoria();
  ok("G/preferenza corrotta: l'utente vede spento alle 07:00", rotta.attivo === false && rotta.ora === 7);
  await notifiche.salvaPromemoria(rotta);
  ok("G/DIFETTO RIPRODOTTO: salvando dopo una lettura corrotta la preferenza vera sparisce senza avviso",
     JSON.parse(Kv.leggiGrezzo("promemoria")).ora === 7);
}

// ==========================================================================
// PARTE H — i permessi: chiedere solo quando serve, e mai insistere
// ==========================================================================
{
  // Concesso: non si chiede mai, in nessuno dei due modi.
  pulisci();
  Banco.programmaPermesso({ status: "granted" });
  ok("H/permesso concesso: permessoConcesso(false) e vero", (await notifiche.permessoConcesso(false)) === true);
  ok("H/permesso concesso: permessoConcesso(true) e vero", (await notifiche.permessoConcesso(true)) === true);
  ok("H/permesso concesso: nessuna richiesta sprecata", Banco.conteggioRichiestePermesso() === 0);

  // Mai chiesto: leggere non deve far comparire il dialogo di sistema. E il
  // percorso dell'apertura della schermata, dove un dialogo a sorpresa
  // sarebbe esattamente cio che fa disinstallare l'app.
  pulisci();
  Banco.programmaPermesso({ status: "undetermined", canAskAgain: true });
  ok("H/mai chiesto: permessoConcesso(false) e falso", (await notifiche.permessoConcesso(false)) === false);
  ok("H/mai chiesto: leggere NON fa comparire il dialogo", Banco.conteggioRichiestePermesso() === 0);
  uguali("H/mai chiesto: si e solo letto lo stato", azioni(), ["legge-permesso"]);

  // Mai chiesto e l'utente concede.
  pulisci();
  Banco.programmaPermesso({ status: "undetermined", canAskAgain: true });
  Banco.programmaRispostaRichiesta({ status: "granted" });
  ok("H/richiesta accolta: restituisce vero", (await notifiche.permessoConcesso(true)) === true);
  ok("H/richiesta accolta: chiesto una volta sola", Banco.conteggioRichiestePermesso() === 1);
  uguali("H/richiesta accolta: prima si legge, poi si chiede", azioni(), ["legge-permesso", "chiede-permesso"]);

  // Mai chiesto e l'utente nega.
  pulisci();
  Banco.programmaPermesso({ status: "undetermined", canAskAgain: true });
  Banco.programmaRispostaRichiesta({ status: "denied", canAskAgain: false });
  ok("H/richiesta negata: restituisce falso", (await notifiche.permessoConcesso(true)) === false);
  ok("H/richiesta negata: chiesto una volta sola", Banco.conteggioRichiestePermesso() === 1);

  // Negato per sempre: Android non ripropone il dialogo, e l'app non deve
  // sprecare l'unica richiesta che il sistema concede.
  pulisci();
  Banco.programmaPermesso({ status: "denied", canAskAgain: false });
  ok("H/negato per sempre: permessoConcesso(false) e falso", (await notifiche.permessoConcesso(false)) === false);
  ok("H/negato per sempre: permessoConcesso(true) resta falso", (await notifiche.permessoConcesso(true)) === false);
  ok("H/negato per sempre: NON si chiede mai", Banco.conteggioRichiestePermesso() === 0);

  // Negato ma ancora richiedibile (revoca dalle impostazioni): si puo chiedere.
  pulisci();
  Banco.programmaPermesso({ status: "denied", canAskAgain: true });
  Banco.programmaRispostaRichiesta({ status: "granted" });
  ok("H/negato ma richiedibile: chiedendo si puo riottenere", (await notifiche.permessoConcesso(true)) === true);
  ok("H/negato ma richiedibile: una sola richiesta", Banco.conteggioRichiestePermesso() === 1);

  // Il modulo nativo presente ma guasto: l'errore risale (permessoConcesso
  // non ha catch). E il percorso che lascia bianca la schermata, vedi PARTE L.
  pulisci();
  Doppio.guasto.attivo = "Cannot find native module 'ExpoNotifications'";
  await lancia("H/nativo guasto: permessoConcesso rigetta e non inghiotte",
               () => notifiche.permessoConcesso(false), "ExpoNotifications");
  Doppio.guasto.attivo = null;
}

// ==========================================================================
// PARTE I — applica(): portare il sistema nello stato descritto dalla preferenza
// ==========================================================================
{
  const coda = () => Banco.giornale.filter((v) => v.azione === "programma").map((v) => v.notifica);

  // ------------------------------------------------------------- spento
  pulisci();
  ok("I/spento: applica riesce", (await notifiche.applica(spento())) === true);
  uguali("I/spento: cancella e basta, non legge il permesso e non crea canali",
         azioni(), ["cancella-tutte"]);
  ok("I/spento: nessuna notifica in coda", (await inCoda()) === 0);
  ok("I/spento: nessun canale creato", Banco.canaliRegistrati().length === 0);
  ok("I/spento: nessuna richiesta di permesso", Banco.conteggioRichiestePermesso() === 0);

  // Spento con permesso negato per sempre: deve funzionare lo stesso.
  pulisci();
  Banco.programmaPermesso({ status: "denied", canAskAgain: false });
  ok("I/spento senza permesso: riesce comunque", (await notifiche.applica(spento())) === true);
  ok("I/spento senza permesso: non chiede niente", Banco.conteggioRichiestePermesso() === 0);
  uguali("I/spento senza permesso: solo la cancellazione", azioni(), ["cancella-tutte"]);

  // -------------------------------------------------- acceso, permesso dato
  pulisci();
  ok("I/acceso: applica riesce", (await notifiche.applica(acceso(7, 30))) === true);
  uguali("I/acceso: l'ordine e cancella, leggi permesso, canale, programma",
         azioni(), ["cancella-tutte", "legge-permesso", "canale", "programma"]);
  ok("I/acceso: esattamente una notifica in coda", (await inCoda()) === 1);
  const unica = coda()[0];
  uguali("I/acceso: il trigger e quotidiano all'ora chiesta, sul canale blocchi",
         unica.trigger, { type: "daily", hour: 7, minute: 30, channelId: "blocchi" });
  uguali("I/acceso: il contenuto e quello di testoNotifica",
         { title: unica.content.title, body: unica.content.body },
         { title: testoNotifica(acceso(7, 30)).titolo, body: testoNotifica(acceso(7, 30)).corpo });
  const canale = Banco.canaliRegistrati()[0];
  uguali("I/acceso: il canale Android e 'blocchi' con nome, importanza e suono",
         { id: canale.id, name: canale.name, importance: canale.importance, sound: canale.sound },
         { id: "blocchi", name: "Blocchi di studio", importance: 5, sound: "default" });
  ok("I/acceso: il canale viene creato PRIMA di programmare",
     azioni().indexOf("canale") < azioni().indexOf("programma"));
  ok("I/acceso: non chiede il permesso, lo legge soltanto", Banco.conteggioRichiestePermesso() === 0);

  // Mezzanotte e l'ultimo minuto: gli zeri non devono sparire per strada.
  pulisci();
  await notifiche.applica(acceso(0, 0));
  uguali("I/mezzanotte: hour 0 e minute 0 arrivano al sistema", coda()[0].trigger,
         { type: "daily", hour: 0, minute: 0, channelId: "blocchi" });
  pulisci();
  await notifiche.applica(acceso(23, 59));
  uguali("I/23:59: arriva al sistema", coda()[0].trigger,
         { type: "daily", hour: 23, minute: 59, channelId: "blocchi" });

  // ------------------------------------------------- acceso, permesso mancante
  pulisci();
  Banco.programmaPermesso({ status: "denied", canAskAgain: false });
  ok("I/acceso senza permesso: restituisce FALSO, cosi lo schermo puo dirlo",
     (await notifiche.applica(acceso())) === false);
  uguali("I/acceso senza permesso: ha cancellato e letto, poi si e fermato",
         azioni(), ["cancella-tutte", "legge-permesso"]);
  ok("I/acceso senza permesso: coda vuota", (await inCoda()) === 0);
  ok("I/acceso senza permesso: nessun canale creato", Banco.canaliRegistrati().length === 0);
  ok("I/acceso senza permesso: non chiede il permesso da dentro applica",
     Banco.conteggioRichiestePermesso() === 0);

  // Permesso mai chiesto: applica non lo chiede (chiederlo qui sarebbe un
  // dialogo a sorpresa all'avvio, dentro ripristina()).
  pulisci();
  Banco.programmaPermesso({ status: "undetermined", canAskAgain: true });
  ok("I/permesso mai chiesto: applica restituisce falso senza chiedere",
     (await notifiche.applica(acceso())) === false && Banco.conteggioRichiestePermesso() === 0);

  // ------------------------------------------------------------ idempotenza
  pulisci();
  let sempreUna = true;
  for (let i = 0; i < 10; i++) {
    await notifiche.applica(acceso(7, 0));
    if ((await inCoda()) !== 1) sempreUna = false;
  }
  ok("I/dieci applica consecutivi lasciano sempre UNA sola notifica", sempreUna);
  ok("I/dieci applica: dieci cancellazioni e dieci programmazioni",
     azioni().filter((a) => a === "cancella-tutte").length === 10
     && azioni().filter((a) => a === "programma").length === 10);
  ok("I/ogni programmazione e preceduta da una cancellazione, sempre",
     Banco.giornale.every((v, i) => v.azione !== "programma"
       || Banco.giornale.slice(0, i).some((w) => w.azione === "cancella-tutte")),
     azioni().join(","));

  // ------------------------------------------------------- cambio dell'ora
  pulisci();
  await notifiche.applica(acceso(7, 0));
  await notifiche.applica(acceso(8, 30));
  ok("I/cambio d'ora: resta una sola notifica", (await inCoda()) === 1);
  uguali("I/cambio d'ora: e quella nuova, nessun residuo alle 07:00",
         (await Doppio.getAllScheduledNotificationsAsync()).map((v) => `${v.trigger.hour}:${v.trigger.minute}`),
         ["8:30"]);
  await notifiche.applica(acceso(9, 0));
  await notifiche.applica(acceso(10, 0));
  await notifiche.applica(acceso(11, 0));
  uguali("I/tre cambi d'ora di fila: una sola notifica, l'ultima",
         (await Doppio.getAllScheduledNotificationsAsync()).map((v) => `${v.trigger.hour}:${v.trigger.minute}`),
         ["11:0"]);
  await notifiche.applica(acceso(11, 5));
  uguali("I/cambio del solo minuto: una sola notifica",
         (await Doppio.getAllScheduledNotificationsAsync()).map((v) => `${v.trigger.hour}:${v.trigger.minute}`),
         ["11:5"]);

  // ------------------------------------------------------- cambio del tipo
  pulisci();
  await notifiche.applica(acceso(7, 0, "mattina"));
  await notifiche.applica(acceso(7, 0, "ripasso"));
  ok("I/cambio di tipo: resta una sola notifica", (await inCoda()) === 1);
  const dopoTipo = (await Doppio.getAllScheduledNotificationsAsync())[0];
  uguali("I/cambio di tipo: cambia il contenuto, non l'ora",
         { t: dopoTipo.content.title, h: dopoTipo.trigger.hour },
         { t: "Ripasso", h: 7 });
  // Tutti e cinque i tipi, uno dopo l'altro.
  pulisci();
  let tuttiUno = true;
  for (const t of ["mattina", "artefatto", "lettura", "paper", "ripasso"]) {
    await notifiche.applica(acceso(7, 0, t));
    const v = (await Doppio.getAllScheduledNotificationsAsync());
    if (v.length !== 1 || v[0].content.title !== testoNotifica(acceso(7, 0, t)).titolo) tuttiUno = false;
  }
  ok("I/i cinque tipi programmati in fila: sempre una sola notifica, contenuto giusto", tuttiUno);

  // ------------------------------------------------------------------ iOS
  pulisci();
  RN.configuraPiattaforma("ios");
  await notifiche.applica(acceso());
  ok("I/su iOS non si crea nessun canale Android", Banco.canaliRegistrati().length === 0);
  ok("I/su iOS si programma lo stesso", (await inCoda()) === 1);
  ok("I/su iOS il channelId resta nel trigger, ignorato dalla piattaforma",
     (await Doppio.getAllScheduledNotificationsAsync())[0].trigger.channelId === "blocchi");
  RN.configuraPiattaforma("android");

  // ------------------------------------------- ampiezza della cancellazione
  // cancelAllScheduledNotificationsAsync non e ristretta al canale 'blocchi':
  // oggi l'app non ha altre notifiche locali, quindi il difetto e latente,
  // ma il giorno in cui ne aggiungesse una verrebbe spazzata via a ogni
  // modifica del promemoria.
  pulisci();
  await Doppio.scheduleNotificationAsync({
    content: { title: "Estranea", body: "di un'altra funzione dell'app" },
    trigger: { type: "daily", hour: 20, minute: 0, channelId: "altro" },
  });
  ok("I/preparazione: la notifica estranea e in coda", (await inCoda()) === 1);
  await notifiche.applica(acceso(7, 0));
  const dopoApplica = await Doppio.getAllScheduledNotificationsAsync();
  ok("I/DIFETTO RIPRODOTTO: applica cancella TUTTE le notifiche locali, non solo quelle del canale blocchi",
     dopoApplica.length === 1 && dopoApplica[0].content.title !== "Estranea",
     JSON.stringify(dopoApplica.map((v) => v.content.title)));
  // Anche spegnendo: uno spegnimento del promemoria azzera tutto il sistema.
  pulisci();
  await Doppio.scheduleNotificationAsync({ content: { title: "Estranea" }, trigger: null });
  await notifiche.applica(spento());
  ok("I/DIFETTO RIPRODOTTO: anche spegnere il promemoria spazza via le notifiche estranee",
     (await inCoda()) === 0);

  // ------------------------------------------------------- ore impossibili
  // applica non valida nulla: passa al sistema operativo quello che riceve.
  // Oggi deserializza fa da guardia, ma una scorciatoia futura no.
  pulisci();
  await lancia("I/DIFETTO RIPRODOTTO: ora 99 non viene fermata da applica, la rifiuta il sistema",
               () => notifiche.applica(acceso(99, 0)), "Trigger is invalid");
  ok("I/dopo il rifiuto la coda e VUOTA: la cancellazione era gia avvenuta",
     (await inCoda()) === 0);
  ok("I/dopo il rifiuto il canale era gia stato creato",
     Banco.canaliRegistrati().length === 1);
  pulisci();
  await lancia("I/ora frazionaria rifiutata dal sistema",
               () => notifiche.applica(acceso(7.5, 0)), "Trigger is invalid");
  pulisci();
  await lancia("I/minuto negativo rifiutato dal sistema",
               () => notifiche.applica(acceso(7, -1)), "Trigger is invalid");

  // --------------------------------------------- guasto della programmazione
  pulisci();
  await notifiche.applica(acceso(7, 0));
  ok("I/preparazione: una notifica buona in coda", (await inCoda()) === 1);
  Banco.programmaErrore("Failed to schedule the notification");
  await lancia("I/DIFETTO RIPRODOTTO: se la programmazione fallisce, applica rigetta senza rimediare",
               () => notifiche.applica(acceso(8, 0)), "Failed to schedule");
  ok("I/dopo il guasto l'utente resta SENZA notifiche: la vecchia era gia stata cancellata",
     (await inCoda()) === 0);

  // Il nativo guasto: applica rigetta subito, senza toccare niente.
  pulisci();
  Doppio.guasto.attivo = "Cannot find native module 'ExpoNotifications'";
  await lancia("I/nativo assente: applica rigetta", () => notifiche.applica(acceso()), "ExpoNotifications");
  Doppio.guasto.attivo = null;
  ok("I/nativo assente: il giornale del sistema resta vuoto", Banco.giornale.length === 0);
}

// ==========================================================================
// PARTE J — due applica() che si accavallano
// ==========================================================================
// applica() non ha lucchetto: cancella, poi programma. Se due chiamate si
// interfogliano, le due cancellazioni avvengono PRIMA delle due
// programmazioni e nella coda restano due notifiche quotidiane. Qui
// l'interfogliamento non e lasciato al caso: lo si costruisce con i ritardi
// dell'involucro, cosi la prova e ripetibile.
{
  // Scaldata: il primo import dinamico dentro applica() costa qualche tick in
  // piu, e senza questa chiamata i due percorsi non partirebbero pari.
  pulisci();
  await notifiche.applica(acceso());

  // --------------------------------- due accensioni identiche, senza ritardi
  pulisci();
  await Promise.all([notifiche.applica(acceso(7, 0)), notifiche.applica(acceso(7, 0))]);
  ok("J/DIFETTO RIPRODOTTO: due applica concorrenti lasciano DUE notifiche quotidiane",
     (await inCoda()) === 2, String(await inCoda()));
  uguali("J/l'interfogliamento: le due cancellazioni precedono le due programmazioni",
         azioni().filter((a) => a === "cancella-tutte" || a === "programma"),
         ["cancella-tutte", "cancella-tutte", "programma", "programma"]);

  // ------------------------------- due accensioni a ore diverse: suona due volte
  pulisci();
  await Promise.all([notifiche.applica(acceso(7, 0)), notifiche.applica(acceso(9, 0))]);
  uguali("J/DIFETTO RIPRODOTTO: due ore diverse restano entrambe programmate",
         (await Doppio.getAllScheduledNotificationsAsync())
           .map((v) => `${v.trigger.hour}:${v.trigger.minute}`).sort(),
         ["7:0", "9:0"]);

  // --------------------- ordine di risoluzione invertito: l'esito CAMBIA
  // La prima chiamata si attarda sulla cancellazione: quando riprende,
  // cancella anche il lavoro gia finito della seconda. Stesso codice, stesso
  // ingresso, esito diverso: e la firma di una corsa.
  pulisci();
  Doppio.ritardi.cancella.push(40, 0);
  await Promise.all([notifiche.applica(acceso(7, 0)), notifiche.applica(acceso(9, 0))]);
  uguali("J/DIFETTO RIPRODOTTO: invertendo l'ordine di risoluzione ne resta UNA sola, e non e l'ultima chiesta",
         (await Doppio.getAllScheduledNotificationsAsync())
           .map((v) => `${v.trigger.hour}:${v.trigger.minute}`),
         ["7:0"]);
  Doppio.azzeraInvolucro();

  // ----------------- spegnimento che arriva mentre l'accensione e in volo
  // Esito: la preferenza dice SPENTO e il telefono ha una notifica in coda.
  pulisci();
  Doppio.ritardi.programma.push(30);
  const accensione = notifiche.applica(acceso(7, 0));
  ok("J/lo spegnimento concorrente riesce", (await notifiche.applica(spento())) === true);
  await accensione;
  ok("J/DIFETTO RIPRODOTTO: spegnendo durante un'accensione resta programmata una notifica con la preferenza SPENTA",
     (await inCoda()) === 1, String(await inCoda()));
  Doppio.azzeraInvolucro();

  // --------------- accensione che arriva mentre lo spegnimento e in volo
  pulisci();
  await notifiche.applica(acceso(7, 0));
  Doppio.ritardi.cancella.push(30);
  const spegnimento = notifiche.applica(spento());
  await notifiche.applica(acceso(8, 0));
  await spegnimento;
  ok("J/DIFETTO RIPRODOTTO: accendendo durante uno spegnimento la notifica appena chiesta sparisce",
     (await inCoda()) === 0, String(await inCoda()));
  Doppio.azzeraInvolucro();

  // ------------------------------------ tre accensioni sovrapposte: tre avvisi
  pulisci();
  await Promise.all([
    notifiche.applica(acceso(7, 0)),
    notifiche.applica(acceso(8, 0)),
    notifiche.applica(acceso(9, 0)),
  ]);
  ok("J/DIFETTO RIPRODOTTO: tre applica sovrapposti lasciano TRE notifiche",
     (await inCoda()) === 3, String(await inCoda()));

  // -------------------------------- e invece in sequenza va sempre bene
  // La controprova: il difetto sta nella sovrapposizione, non in applica().
  pulisci();
  for (const o of [7, 8, 9, 10, 11, 12]) await notifiche.applica(acceso(o, 0));
  ok("J/in sequenza (con await) resta sempre una sola notifica", (await inCoda()) === 1);
}

// ==========================================================================
// PARTE K — ripristina() all'avvio e programmate(): non devono mai sollevare
// ==========================================================================
{
  // Preferenza spenta: ripristina non deve nemmeno toccare la coda di sistema.
  pulisci();
  await notifiche.salvaPromemoria(spento());
  await Doppio.scheduleNotificationAsync({ content: { title: "Estranea" }, trigger: null });
  const giornalePrima = Banco.giornale.length;
  await notifiche.ripristina();
  ok("K/promemoria spento: ripristina NON chiama applica e non tocca la coda",
     Banco.giornale.length === giornalePrima, azioni().join(","));
  ok("K/promemoria spento: la notifica estranea sopravvive all'avvio", (await inCoda()) === 1);
  ok("K/promemoria spento: nessuna richiesta di permesso all'avvio",
     Banco.conteggioRichiestePermesso() === 0);

  // Preferenza assente: equivale a spento.
  pulisci();
  await nonLancia("K/preferenza assente: ripristina non solleva", () => notifiche.ripristina());
  uguali("K/preferenza assente: non si tocca nulla", azioni(), []);

  // Dopo un riavvio del telefono la coda di sistema e vuota: si riprogramma.
  pulisci();
  await notifiche.salvaPromemoria(acceso(6, 15, "lettura"));
  await notifiche.ripristina();
  ok("K/dopo il riavvio ripristina riporta la coda a 1", (await inCoda()) === 1);
  uguali("K/dopo il riavvio la notifica e quella della preferenza salvata",
         (await Doppio.getAllScheduledNotificationsAsync())
           .map((v) => ({ h: v.trigger.hour, m: v.trigger.minute, t: v.content.title })),
         [{ h: 6, m: 15, t: "Blocco lettura" }]);
  ok("K/ripristina non chiede mai il permesso all'utente", Banco.conteggioRichiestePermesso() === 0);

  // Ripristina e idempotente quanto applica: due avvii di fila, una notifica.
  await notifiche.ripristina();
  await notifiche.ripristina();
  ok("K/tre ripristina consecutivi lasciano una sola notifica", (await inCoda()) === 1);

  // Permesso revocato nel frattempo: niente notifica, nessuna eccezione.
  pulisci();
  await notifiche.salvaPromemoria(acceso());
  Banco.programmaPermesso({ status: "denied", canAskAgain: false });
  await nonLancia("K/permesso revocato: ripristina non solleva", () => notifiche.ripristina());
  ok("K/permesso revocato: coda a 0", (await inCoda()) === 0);

  // Deposito guasto: l'avvio prosegue comunque.
  pulisci();
  await notifiche.salvaPromemoria(acceso());
  await notifiche.applica(acceso());
  Kv.guasto.lettura = "database is locked";
  await nonLancia("K/deposito guasto: ripristina non solleva", () => notifiche.ripristina());
  ok("K/deposito guasto: legge il predefinito (spento) e quindi non tocca la coda",
     (await inCoda()) === 1);
  Kv.guasto.lettura = null;

  // Modulo nativo assente: e il caso dell'invariante 8 andata storta.
  pulisci();
  await notifiche.salvaPromemoria(acceso());
  Doppio.guasto.attivo = "Cannot find native module 'ExpoNotifications'";
  await nonLancia("K/nativo assente: ripristina non solleva (l'app parte lo stesso)",
                  () => notifiche.ripristina());
  Doppio.guasto.attivo = null;

  // Programmazione che fallisce all'avvio: idem.
  pulisci();
  await notifiche.salvaPromemoria(acceso());
  Banco.programmaErrore("Failed to schedule the notification");
  await nonLancia("K/programmazione fallita: ripristina non solleva", () => notifiche.ripristina());
  ok("K/programmazione fallita: coda a 0, in silenzio", (await inCoda()) === 0);

  // ------------------------------------------------------------ programmate()
  pulisci();
  ok("K/programmate() su coda vuota vale 0", (await notifiche.programmate()) === 0);
  await notifiche.applica(acceso());
  ok("K/programmate() conta quelle vere", (await notifiche.programmate()) === 1);
  await Doppio.scheduleNotificationAsync({ content: { title: "Estranea" }, trigger: null });
  ok("K/programmate() conta TUTTE le notifiche locali, non solo le nostre",
     (await notifiche.programmate()) === 2);

  Doppio.guasto.attivo = "Cannot find native module 'ExpoNotifications'";
  const conteggioGuasto = await nonLancia("K/programmate() non solleva mai",
                                          () => notifiche.programmate());
  ok("K/DIFETTO RIPRODOTTO: programmate() in errore restituisce 0, indistinguibile da 'nessuna notifica'",
     conteggioGuasto === 0, String(conteggioGuasto));
  Doppio.guasto.attivo = null;
  ok("K/...e infatti la coda vera in quel momento non era vuota",
     (await notifiche.programmate()) === 2);
}

// ==========================================================================
// PARTE L — la schermata /promemoria
// ==========================================================================
// app/promemoria.tsx NON si importa: il banco non ha react-native ne
// expo-router, e una schermata si prova sull'emulatore. Qui sotto c'e la sua
// LOGICA ricopiata riga per riga (montaggio, aggiorna, confermaOra e i tre
// testi derivati dal render), con le stesse chiamate alle stesse funzioni
// vere. Il valore della copia sta nel fatto che sotto gira il codice vero di
// lib/notifiche.ts, lib/promemoria.ts e lib/db.ts.
//
// UNA FEDELTA CHE CONTA: in React `p` dentro un gestore e il valore del
// RENDER, non quello aggiornato. Qui lo si riproduce passando esplicitamente
// il `p` renderizzato a confermaOra(), che e cio che rende possibile lo
// scenario della doppia conferma (onBlur + onSubmitEditing).
{
  let contatoreSessioni = 0;
  async function registraSessione(tipo, inizio, minuti = 30) {
    const id = `sessione-di-prova-${++contatoreSessioni}`;
    // Stessa scrittura di components/Cronometro.tsx:56, invariante 1 inclusa.
    await dbApp.registra("sessioni", id, "crea", { tipo, minuti }, async (d, hlc) => {
      await d.runAsync(
        "INSERT INTO sessioni (id, tipo, inizio, minuti, hlc) VALUES (?,?,?,?,?)",
        [id, tipo, new Date(inizio).toISOString(), minuti, hlc]);
    });
  }
  // Pulizia della PROVA, non dell'app: qui si tocca la tabella operativa
  // direttamente perche serve riportare lo schermo alla condizione di
  // partenza. Nel codice dell'app questo sarebbe una violazione dell'invariante 1.
  const svuotaSessioni = () => dbApp.database().runAsync("DELETE FROM sessioni");

  function creaSchermata() {
    const s = { p: null, testoOra: "", permesso: true, inCoda: 0, fattoOggi: false };
    const avvisi = [];
    let impostazioniAperte = 0;

    async function montaggio() {
      const letto = await notifiche.leggiPromemoria();
      s.p = letto;
      s.testoOra = comeTesto(letto);
      s.permesso = await notifiche.permessoConcesso(false);
      s.inCoda = await notifiche.programmate();
      const righe = await dbApp.database().getAllAsync(
        "SELECT inizio FROM sessioni WHERE tipo = ? ORDER BY inizio DESC LIMIT 20", [letto.tipo]);
      s.fattoOggi = giaFattoOggi(letto, righe.map((r) => r.inizio), new Date());
    }

    async function aggiorna(nuovo, chiediPermesso) {
      s.p = nuovo;
      await notifiche.salvaPromemoria(nuovo);
      if (nuovo.attivo && chiediPermesso && !(await notifiche.permessoConcesso(true))) {
        s.permesso = false;
        avvisi.push({
          titolo: "Permesso negato",
          bottoni: ["Annulla", "Impostazioni"],
          apriImpostazioni: () => { impostazioniAperte++; },
        });
        return;
      }
      s.permesso = await notifiche.permessoConcesso(false);
      await notifiche.applica(nuovo);
      s.inCoda = await notifiche.programmate();
    }

    function confermaOra(pRenderizzato = s.p) {
      if (!pRenderizzato) return;
      const letto = daTesto(s.testoOra);
      if (!letto) {
        avvisi.push({ titolo: "Ora non valida", messaggio: "Scrivila come 07:30." });
        s.testoOra = comeTesto(pRenderizzato);
        return;
      }
      return aggiorna({ ...pRenderizzato, ...letto }, pRenderizzato.attivo);
    }

    return {
      stato: s,
      avvisi,
      montaggio,
      aggiorna,
      confermaOra,
      scriviOra: (t) => { s.testoOra = t; },
      commutaInterruttore: (v) => aggiorna({ ...s.p, attivo: v }, v),
      scegliTipo: (t) => aggiorna({ ...s.p, tipo: t }, s.p.attivo),
      tornaIndietro: () => "profilo",
      // ------------------------------------------- cio che si vede a schermo
      schermoVuoto: () => s.p === null,
      bannerRosso: () => Boolean(s.p && s.p.attivo && !s.permesso),
      impostazioniAperte: () => impostazioniAperte,
      anteprima: () => testoNotifica(s.p),
      rigaStato: (adesso = new Date()) => {
        const prossima = prossimaOccorrenza(s.p, adesso);
        return (s.p.attivo && prossima
          ? `Prossimo avviso: ${prossima.toLocaleString("it-IT", { weekday: "long", hour: "2-digit", minute: "2-digit" })}.`
          : "Nessun avviso programmato.")
          + (s.p.attivo && s.fattoOggi ? " Il blocco di oggi risulta gia registrato." : "")
          + ` In coda nel sistema: ${s.inCoda}.`;
      },
    };
  }

  // Riga di app/(tabs)/profilo.tsx:44-46, per verificare la coerenza al rientro.
  const rigaProfilo = (prom) => prom.attivo
    ? `Blocco ${prom.tipo} alle ${comeTesto(prom)}, ogni giorno.`
    : "Nessun avviso. Notifica locale, funziona anche in aereo.";

  // ------------------------------------------- L1: apertura, preferenza assente
  pulisci();
  await svuotaSessioni();
  {
    const sc = creaSchermata();
    await sc.montaggio();
    ok("L/apertura senza preferenza: interruttore spento", sc.stato.p.attivo === false);
    ok("L/apertura senza preferenza: campo a 07:00", sc.stato.testoOra === "07:00");
    ok("L/apertura senza preferenza: tipo mattina", sc.stato.p.tipo === "mattina");
    ok("L/apertura: il permesso si LEGGE, non si chiede", Banco.conteggioRichiestePermesso() === 0);
    ok("L/apertura: in coda 0", sc.stato.inCoda === 0);
    ok("L/apertura: nessun banner rosso", sc.bannerRosso() === false);
    ok("L/apertura: nessun avviso a sorpresa", sc.avvisi.length === 0);
    ok("L/apertura: lo schermo non e piu vuoto", sc.schermoVuoto() === false);
    ok("L/apertura: riga di stato senza avviso programmato",
       sc.rigaStato() === "Nessun avviso programmato. In coda nel sistema: 0.", sc.rigaStato());
    ok("L/apertura: l'apertura NON scrive la preferenza", Kv.chiaviGrezze().length === 0);
  }

  // ------------------------------------- L2: apertura con preferenza salvata
  pulisci();
  await svuotaSessioni();
  await notifiche.salvaPromemoria(acceso(6, 45, "lettura"));
  await notifiche.applica(acceso(6, 45, "lettura"));
  {
    const sc = creaSchermata();
    await sc.montaggio();
    ok("L/apertura con preferenza: campo a 06:45", sc.stato.testoOra === "06:45");
    ok("L/apertura con preferenza: tipo lettura evidenziato", sc.stato.p.tipo === "lettura");
    ok("L/apertura con preferenza: in coda 1", sc.stato.inCoda === 1);
    uguali("L/apertura con preferenza: anteprima del blocco lettura",
           sc.anteprima(), { titolo: "Blocco lettura", corpo: "25 minuti. Apri Percorso e avvia il cronometro." });
    ok("L/apertura con preferenza: la riga di stato nomina il prossimo avviso",
       sc.rigaStato().startsWith("Prossimo avviso: ") && sc.rigaStato().endsWith("In coda nel sistema: 1."),
       sc.rigaStato());
    ok("L/apertura con preferenza: 'gia registrato' assente senza sessioni",
       !sc.rigaStato().includes("gia registrato"));
  }

  // --------------------------------- L3: 'gia fatto oggi' con sessioni vere
  pulisci();
  await svuotaSessioni();
  await notifiche.salvaPromemoria(acceso(7, 0, "mattina"));
  await registraSessione("mattina", Date.now() - 2 * 3600_000, 30);
  await registraSessione("ripasso", Date.now() - 3 * 3600_000, 15);
  {
    const sc = creaSchermata();
    await sc.montaggio();
    ok("L/una sessione 'mattina' di oggi fa comparire 'gia registrato'", sc.stato.fattoOggi === true);
    ok("L/...e la riga di stato lo dice", sc.rigaStato().includes("Il blocco di oggi risulta gia registrato."),
       sc.rigaStato());
    // Il tipo cambia, la frase no: fattoOggi e calcolato UNA volta al montaggio.
    await sc.scegliTipo("paper");
    ok("L/DIFETTO RIPRODOTTO: cambiando tipo la frase 'gia registrato' resta quella del tipo precedente",
       sc.stato.p.tipo === "paper" && sc.stato.fattoOggi === true
       && sc.rigaStato().includes("gia registrato"), sc.rigaStato());
    // La controprova: aprendo di nuovo la schermata sul tipo 'paper' la frase sparisce.
    const sc2 = creaSchermata();
    await sc2.montaggio();
    ok("L/...riaprendo la schermata sul tipo 'paper' la frase sparisce correttamente",
       sc2.stato.p.tipo === "paper" && sc2.stato.fattoOggi === false);
  }

  // Sessione di ieri dello stesso tipo: non deve contare.
  pulisci();
  await svuotaSessioni();
  await notifiche.salvaPromemoria(acceso(7, 0, "mattina"));
  await registraSessione("mattina", Date.now() - 26 * 3600_000, 30);
  {
    const sc = creaSchermata();
    await sc.montaggio();
    ok("L/una sessione di ieri non fa comparire 'gia registrato'", sc.stato.fattoOggi === false);
  }

  // ------------------------------------ L4: un passo dell'apertura fallisce
  // La mappa dei lettori diceva "la schermata resta BIANCA per sempre". E
  // FALSO, e vale la pena inchiodarlo: setP(letto) avviene PRIMA di
  // permessoConcesso(), quindi React ha gia di che renderizzare quando
  // l'effetto rigetta. Il danno vero e un altro, ed e piu insidioso: la
  // promessa rigetta senza catch, e `permesso` resta al suo valore INIZIALE,
  // che e `true`. Risultato: notifiche impossibili e nessun banner rosso.
  pulisci();
  await svuotaSessioni();
  await notifiche.salvaPromemoria(acceso(7, 0));
  Doppio.guasto.attivo = "Cannot find native module 'ExpoNotifications'";
  {
    const sc = creaSchermata();
    let rigettata = false;
    await sc.montaggio().catch(() => { rigettata = true; });
    ok("L/DIFETTO RIPRODOTTO: se permessoConcesso solleva, l'effetto di apertura rigetta senza catch",
       rigettata === true);
    ok("L/...ma lo schermo NON resta vuoto: setP avviene prima del passo che fallisce",
       sc.schermoVuoto() === false);
    ok("L/DIFETTO RIPRODOTTO: `permesso` resta al valore iniziale true e il banner rosso NON compare",
       sc.stato.permesso === true && sc.bannerRosso() === false);
    ok("L/DIFETTO RIPRODOTTO: 'In coda nel sistema' resta 0 anche se nessuno ha potuto contarle",
       sc.stato.inCoda === 0 && sc.rigaStato().endsWith("In coda nel sistema: 0."), sc.rigaStato());
    ok("L/...e il campo dell'ora e comunque corretto: il guasto non e del deposito",
       sc.stato.testoOra === "07:00");
  }
  Doppio.guasto.attivo = null;

  // L'unico passo che potrebbe lasciare lo schermo bianco e il primo, e non
  // puo fallire: leggiPromemoria ha un catch e non rigetta mai, nemmeno con
  // il deposito rotto. Lo si verifica invece di crederci.
  pulisci();
  Kv.guasto.lettura = "database is locked";
  await nonLancia("L/lo schermo bianco per il primo passo non e raggiungibile: leggiPromemoria non rigetta mai",
                  () => notifiche.leggiPromemoria());
  Kv.guasto.lettura = null;

  // Query sulle sessioni che fallisce: e l'ULTIMO passo dell'effetto, quindi
  // tutto il resto e gia stato impostato. Effetto visibile: manca solo la
  // frase "gia registrato", piu una promessa non gestita.
  pulisci();
  await svuotaSessioni();
  await notifiche.salvaPromemoria(acceso(7, 0, "mattina"));
  await registraSessione("mattina", Date.now() - 2 * 3600_000, 30);
  {
    const sc = creaSchermata();
    let rigettata = false;
    // Si sostituisce la SOLA query, per isolare l'ultimo passo dell'effetto.
    const montaggioConQueryRotta = async () => {
      const letto = await notifiche.leggiPromemoria();
      sc.stato.p = letto;
      sc.stato.testoOra = comeTesto(letto);
      sc.stato.permesso = await notifiche.permessoConcesso(false);
      sc.stato.inCoda = await notifiche.programmate();
      const righe = await Promise.reject(new Error("Database non aperto: chiamare apri() all'avvio."));
      sc.stato.fattoOggi = giaFattoOggi(letto, righe.map((r) => r.inizio), new Date());
    };
    await montaggioConQueryRotta().catch(() => { rigettata = true; });
    ok("L/DIFETTO RIPRODOTTO: un errore della query sulle sessioni rigetta l'effetto, senza catch",
       rigettata === true);
    ok("L/...lo schermo e pieno e coerente, manca solo la frase 'gia registrato'",
       sc.schermoVuoto() === false && sc.stato.fattoOggi === false
       && !sc.rigaStato().includes("gia registrato"), sc.rigaStato());
  }
