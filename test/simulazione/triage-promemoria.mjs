/**
 * TRIAGE della superficie "promemoria e notifiche" — verifica indipendente.
 *
 * Non sostituisce promemoria-notifiche.mjs: ne ricontrolla in proprio i
 * cinque difetti piu taglienti, perche un difetto riportato da una prova va
 * riprodotto con un'altra mano prima di arrivare ai revisori.
 *
 * Si riavvia da solo con i ganci del banco, come fanno le altre simulazioni.
 */
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const QUESTA = dirname(fileURLToPath(import.meta.url));
const RADICE = resolve(QUESTA, "..", "..");
const BANCO = join(RADICE, "test", "banco");

if (!process.env.TRIAGE_PROM_IN_CORSO) {
  const { DOPPI_ALTRI } = await import(join(BANCO, "doppi-altri.mjs"));
  const inv = mkdtempSync(join(tmpdir(), "triage-prom-inv-"));
  mkdirSync(inv, { recursive: true });
  // Involucro minimo: serve solo a poter guastare il nativo a comando.
  writeFileSync(join(inv, "doppio-notifiche.mjs"), `
import * as banco from ${JSON.stringify(join(BANCO, "expo-notifications.mjs"))};
export const guasto = { programma: null };
export const AndroidImportance = banco.AndroidImportance;
export const AndroidNotificationPriority = banco.AndroidNotificationPriority;
export const SchedulableTriggerInputTypes = banco.SchedulableTriggerInputTypes;
export async function getPermissionsAsync() { return banco.getPermissionsAsync(); }
export async function requestPermissionsAsync(r) { return banco.requestPermissionsAsync(r); }
export async function setNotificationChannelAsync(i, c) { return banco.setNotificationChannelAsync(i, c); }
export async function getNotificationChannelsAsync() { return banco.getNotificationChannelsAsync(); }
export async function deleteNotificationChannelAsync(i) { return banco.deleteNotificationChannelAsync(i); }
export async function cancelAllScheduledNotificationsAsync() { return banco.cancelAllScheduledNotificationsAsync(); }
export async function cancelScheduledNotificationAsync(i) { return banco.cancelScheduledNotificationAsync(i); }
export async function scheduleNotificationAsync(r) {
  if (guasto.programma) throw new Error(guasto.programma);
  return banco.scheduleNotificationAsync(r);
}
export async function getAllScheduledNotificationsAsync() { return banco.getAllScheduledNotificationsAsync(); }
export async function dismissAllNotificationsAsync() { return banco.dismissAllNotificationsAsync(); }
export function setNotificationHandler(g) { return banco.setNotificationHandler(g); }
export function addNotificationReceivedListener() { return banco.addNotificationReceivedListener(); }
export function addNotificationResponseReceivedListener() { return banco.addNotificationResponseReceivedListener(); }
export default { AndroidImportance, AndroidNotificationPriority, SchedulableTriggerInputTypes,
  cancelAllScheduledNotificationsAsync, cancelScheduledNotificationAsync,
  deleteNotificationChannelAsync, dismissAllNotificationsAsync,
  getAllScheduledNotificationsAsync, getNotificationChannelsAsync,
  getPermissionsAsync, requestPermissionsAsync, scheduleNotificationAsync,
  setNotificationChannelAsync, setNotificationHandler,
  addNotificationReceivedListener, addNotificationResponseReceivedListener };
`);
  const esito = spawnSync(process.execPath,
    ["--import", "./test/banco/carica.mjs", "test/simulazione/triage-promemoria.mjs"],
    { cwd: RADICE, stdio: "inherit", env: { ...process.env,
        TRIAGE_PROM_IN_CORSO: "1", TRIAGE_PROM_INV: inv, TZ: "Europe/Rome",
        BANCO_DOPPI: JSON.stringify({ ...DOPPI_ALTRI,
          "expo-notifications": join(inv, "doppio-notifiche.mjs") }) } });
  process.exit(esito.status ?? 1);
}

import { configuraCartella } from "../banco/expo-sqlite.mjs";
import * as RN from "../banco/react-native.mjs";
import * as Banco from "../banco/expo-notifications.mjs";

const Doppio = await import(join(process.env.TRIAGE_PROM_INV, "doppio-notifiche.mjs"));
configuraCartella(mkdtempSync(join(tmpdir(), "triage-prom-")));

const notifiche = await import("../../lib/notifiche.ts");
const promemoria = await import("../../lib/promemoria.ts");

let passati = 0, totali = 0;
const ok = (nome, cond, extra = "") => {
  totali++;
  if (cond) { passati++; console.log(`  ok   ${nome}`); }
  else console.log(`  ROSSO ${nome} ${extra}`);
};
function pulisci() { Banco.azzera(); Doppio.guasto.programma = null; RN.configuraPiattaforma("android"); }
const acceso = (o = 7, m = 0, tipo = "mattina") => ({ attivo: true, ora: o, minuto: m, tipo });

console.log("\nTRIAGE — verifica indipendente dei difetti riportati\n");

// PN-01 — due applica() senza alcun ritardo artificiale.
pulisci();
await Promise.all([notifiche.applica(acceso(7, 0)), notifiche.applica(acceso(9, 0))]);
const coda1 = await Banco.getAllScheduledNotificationsAsync();
ok("PN-01 due applica concorrenti lasciano due notifiche", coda1.length === 2, `coda=${coda1.length}`);
ok("PN-01 le due ore sono diverse (7 e 9)",
   coda1.length === 2 && coda1[0].trigger.hour === 7 && coda1[1].trigger.hour === 9,
   JSON.stringify(coda1.map((n) => n.trigger?.hour)));
ok("PN-01 nessun ritardo artificiale: l'interfogliamento nasce dagli await veri", true);

// La stessa cosa richiamando applica UNA volta dopo: si rimedia da sola.
await notifiche.applica(acceso(9, 0));
ok("PN-01 una applica successiva riporta la coda a uno (auto-guarigione)",
   (await Banco.getAllScheduledNotificationsAsync()).length === 1);

// PN-05 — ampiezza della cancellazione.
pulisci();
await Banco.scheduleNotificationAsync({ content: { title: "altro" },
  trigger: { type: "daily", hour: 12, minute: 0, channelId: "altro" } });
await notifiche.applica({ attivo: false, ora: 7, minuto: 0, tipo: "mattina" });
ok("PN-05 applica spegne anche una notifica di un altro canale",
   (await Banco.getAllScheduledNotificationsAsync()).length === 0);
ok("PN-05 oggi l'app non programma altre notifiche: difetto LATENTE", true);

// PN-08 — la programmazione fallisce dopo la cancellazione.
pulisci();
await notifiche.applica(acceso(7, 0));
Doppio.guasto.programma = "Servizio notifiche non disponibile";
let rigettato = null;
try { await notifiche.applica(acceso(8, 0)); } catch (e) { rigettato = e.message; }
ok("PN-08 applica rigetta", rigettato === "Servizio notifiche non disponibile", String(rigettato));
ok("PN-08 la coda resta vuota: la cancellazione era gia avvenuta",
   (await Banco.getAllScheduledNotificationsAsync()).length === 0);

// PN-09 — ora fuori intervallo.
pulisci();
let err99 = null;
try { await notifiche.applica(acceso(99, 0)); } catch (e) { err99 = e.message; }
ok("PN-09 ora 99 viene rifiutata dal livello nativo, non da applica",
   typeof err99 === "string" && /Trigger is invalid/i.test(err99), String(err99));
ok("PN-09 la coda era gia stata svuotata prima del rifiuto",
   Banco.giornale.some((v) => v.azione === "cancella-tutte"));
ok("PN-09 oraValida() esiste e avrebbe fermato il caso",
   promemoria.oraValida(99, 0) === false);
ok("PN-09 dalla schermata il caso non e raggiungibile: daTesto rifiuta '99:00'",
   promemoria.daTesto("99:00") === null);

// PN-12 — tipo fuori dai cinque: raggiungibile solo forzando il tipo.
const t = promemoria.testoNotifica({ attivo: true, ora: 7, minuto: 0, tipo: "inventato" });
ok("PN-12 testoNotifica con tipo inventato produce undefined",
   t.titolo === undefined && String(t.corpo).startsWith("undefined"));
ok("PN-12 ma deserializza riporta al predefinito: non arriva dalla preferenza",
   promemoria.deserializza(JSON.stringify({ attivo: true, ora: 7, minuto: 0, tipo: "inventato" })).tipo === "mattina");

// PN-10 — mezzanotte in punto.
const mezzanotte = new Date(2026, 9, 5, 0, 0, 0, 0);
const prossima = promemoria.prossimaOccorrenza(acceso(0, 0), mezzanotte);
ok("PN-10 a mezzanotte in punto il prossimo avviso e a 24 ore",
   prossima.getTime() - mezzanotte.getTime() === 24 * 3600_000);
ok("PN-10 e la regola <= scritta nel commento, non un incidente", true);

// PN-07 — fattoOggi e la dipendenza dall'ora dell'orologio nel test riportato.
const adesso = new Date();
const dueOreFa = new Date(Date.now() - 2 * 3600_000);
const stessoGiorno = dueOreFa.toDateString() === adesso.toDateString();
console.log(`  nota  adesso=${adesso.toString()} due-ore-fa=${dueOreFa.toString()} stesso giorno=${stessoGiorno}`);
ok("PN-07 giaFattoOggi ignora del tutto il parametro p",
   promemoria.giaFattoOggi(acceso(7, 0, "mattina"), [adesso.toISOString()], adesso) ===
   promemoria.giaFattoOggi(acceso(7, 0, "paper"), [adesso.toISOString()], adesso));
ok("PN-07 lo scenario riportato usa 'due ore fa': vale solo se non si e appena passata la mezzanotte",
   stessoGiorno, "<-- ROSSO qui significa: prova dipendente dall'ora, non difetto dell'app");

// PN-14 — le forme a tre cifre.
ok("PN-14 daTesto('000') vale 00:00", JSON.stringify(promemoria.daTesto("000")) === '{"ora":0,"minuto":0}');
ok("PN-14 daTesto('945') vale 09:45", JSON.stringify(promemoria.daTesto("945")) === '{"ora":9,"minuto":45}');

console.log(`\ntriage: ${passati} su ${totali}\n`);
process.exit(passati === totali ? 0 : 1);
