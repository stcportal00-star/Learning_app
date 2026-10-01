/**
 * SIMULAZIONE DELLE NOTIZIE — lib/notizie.ts sopra il banco.
 *
 *   node test/simulazione/notizie.mjs
 *
 * Gira il CODICE VERO: la logica pura delle categorie, delle date e dei
 * gruppi, e le letture su un SQLite vero con lo schema vero. Nessuna rete.
 *
 * Le promesse, e che si rompono in silenzio:
 *  - ogni articolo sta in una categoria, anche senza tema o con un tema che
 *    il piano non conosce: sparire dall'elenco è peggio che finire in fondo;
 *  - «3 ore fa» solo se l'ora c'è: le date nude la conduttura le scrive come
 *    mezzanotte UTC, e un'ora inventata è peggio di «oggi»;
 *  - i giorni sono quelli del telefono, anche a cavallo della mezzanotte e in
 *    fusi diversi (verifica.sh la esegue in tre);
 *  - l'elenco non legge il testo degli articoli, che pesa, ma sa se c'è.
 */
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const QUESTA_CARTELLA = dirname(fileURLToPath(import.meta.url));
const RADICE_PROGETTO = resolve(QUESTA_CARTELLA, "..", "..");

if (!process.env.BANCO_NOTIZIE_IN_CORSO) {
  const { variabileBanco } = await import("../banco/doppi-altri.mjs");
  const esito = spawnSync(
    process.execPath,
    ["--import", "./test/banco/carica.mjs", "test/simulazione/notizie.mjs"],
    {
      cwd: RADICE_PROGETTO,
      stdio: "inherit",
      env: { ...process.env, BANCO_NOTIZIE_IN_CORSO: "1", BANCO_DOPPI: variabileBanco() },
    }
  );
  process.exit(esito.status ?? 1);
}

let passate = 0;
const falliti = [];
function ok(nome, condizione, extra = "") {
  if (condizione) passate++;
  else falliti.push(`${nome}${extra ? " — " + extra : ""}`);
}
function uguale(nome, ottenuto, atteso) {
  ok(nome, JSON.stringify(ottenuto) === JSON.stringify(atteso),
    `atteso ${JSON.stringify(atteso)}, ottenuto ${JSON.stringify(ottenuto)}`);
}

const reteTentata = [];
globalThis.fetch = (...a) => { reteTentata.push(String(a[0])); throw new Error("rete vietata"); };

const FS = await import("../banco/expo-file-system.mjs");
const { configuraCartella } = await import("../banco/expo-sqlite.mjs");
const { installaRequireMetro } = await import("../banco/require-metro.mjs");
FS.configuraRadice(mkdtempSync(join(tmpdir(), "sim-notizie-")));
configuraCartella(join(FS.percorsoDocumenti(), "SQLite"));
installaRequireMetro(RADICE_PROGETTO);

const N = await import("../../lib/notizie.ts");
const fuso = process.env.TZ || "(fuso del sistema)";

// ============================================================ CATEGORIE
uguale("N1 le categorie, sempre nello stesso ordine: per te, in primo piano, le aree del piano, esplorazione, salvati",
  N.categorie().map((c) => c.chiave),
  ["perte", "titoli", "gestione", "dati", "kpi", "business_analysis", "ia", "governance", "hardware", "esplorazione", "salvati"]);
{
  const dati = N.categorie().find((c) => c.chiave === "dati");
  ok("N1 l'area Dati e SQL raccoglie i suoi undici temi, SQL e statistica compresi",
    dati.temi.length === 11 && dati.temi.includes("sql_base") && dati.temi.includes("statistica"), dati.temi.join(","));
  uguale("N1 IA e codice: la lettura del codice e l'AI engineering",
    N.categorie().find((c) => c.chiave === "ia").temi, ["lettura_codice", "ia"]);
}
uguale("N2 l'area si ricava dal tema",
  ["statistica", "lettura_codice", "gdpr", "hardware"].map(N.areaDelTema), ["dati", "ia", "governance", "hardware"]);
uguale("N2 senza tema, con un tema ignoto o con l'esplorazione: esplorazione, mai fuori dall'elenco",
  [null, "salute-pubblica", "esplorazione"].map(N.areaDelTema), ["esplorazione", "esplorazione", "esplorazione"]);
uguale("N2 i nomi dei temi sono quelli del piano, non gli slug",
  [N.nomeTema("sql_base"), N.nomeTema("esplorazione"), N.nomeTema("boh"), N.nomeTema(null)],
  ["SQL — fondamenti", "Esplorazione", null, null]);

// ============================================================ DATE
// «adesso» è mezzanotte e mezza del 1° ottobre, ora del telefono: il confine
// che rompe «ieri».
const adesso = new Date(2026, 9, 1, 0, 30);
const fa = (minuti) => new Date(adesso.getTime() - minuti * 60000).toISOString();
const localeIso = (a, m, g, h = 12) => new Date(a, m - 1, g, h, 0).toISOString();
uguale(`N3 [${fuso}] meno di un minuto, o nel futuro: adesso`, [N.quando(fa(0.5), adesso), N.quando(fa(-120), adesso)], ["adesso", "adesso"]);
uguale(`N3 [${fuso}] minuti e ore`, [fa(12), fa(65), fa(180)].map((d) => N.quando(d, adesso)), ["12 min fa", "1 ora fa", "3 ore fa"]);
uguale(`N3 [${fuso}] alle 23:50 di ieri: 40 minuti fa, ma nel gruppo di ieri`,
  [N.quando(fa(40), adesso), N.gruppoDi(fa(40), adesso)], ["40 min fa", "Ieri"]);
uguale(`N3 [${fuso}] giorni, poi la data, con l'anno solo se è un altro`,
  [localeIso(2026, 9, 29), localeIso(2026, 9, 23), localeIso(2025, 9, 12)].map((d) => N.quando(d, adesso)),
  ["2 giorni fa", "23 set", "12 set 2025"]);
uguale(`N3 [${fuso}] una data nuda non si trasforma in un'ora: oggi, ieri, e mai «ore fa»`,
  ["2026-10-01T00:00:00+00:00", "2026-09-30T00:00:00+00:00", "2026-10-01", "2026-09-30T00:00:00Z"].map((d) => N.quando(d, adesso)),
  ["oggi", "ieri", "oggi", "ieri"]);
uguale(`N3 [${fuso}] niente data o data illeggibile: niente etichetta`, [N.quando(null, adesso), N.quando("boh", adesso)], ["", ""]);
uguale(`N4 [${fuso}] i gruppi: oggi, ieri, questa settimana, prima; il futuro è oggi`,
  [fa(10), localeIso(2026, 9, 30), localeIso(2026, 9, 27), localeIso(2026, 9, 20), fa(-600)].map((d) => N.gruppoDi(d, adesso)),
  ["Oggi", "Ieri", "Questa settimana", "Prima", "Oggi"]);
uguale("N4 la data di un articolo: l'uscita, e senza, l'arrivo",
  [N.dataDi({ pubblicato_a: "2026-09-29T00:00:00+00:00", raccolto_a: "2026-09-30T08:00:00+00:00" }),
   N.dataDi({ pubblicato_a: null, raccolto_a: "2026-09-30T08:00:00+00:00" })],
  ["2026-09-29T00:00:00+00:00", "2026-09-30T08:00:00+00:00"]);
uguale("N4 un'uscita dopo l'arrivo (il fascicolo a stampa di Crossref) vale l'arrivo",
  [N.dataDi({ pubblicato_a: "2121-10-01T00:00:00+00:00", raccolto_a: "2026-09-30T08:00:00+00:00" }),
   N.dataDi({ pubblicato_a: "2026-10-01T00:00:00+00:00", raccolto_a: "2026-09-30T08:00:00.123456+00:00" })],
  ["2026-09-30T08:00:00+00:00", "2026-09-30T08:00:00.123456+00:00"]);

// ============================================================ FONTI
uguale("N5 la fonte come la scrive un giornale",
  ["rss[Blog dei motori]", "openalex[gdpr]", "arxiv+openalex", "zenodo", "europepmc", "sconosciuta", null].map(N.fonteLeggibile),
  ["Blog dei motori", "OpenAlex", "arXiv", "Zenodo", "Europe PMC", "sconosciuta", ""]);

// ============================================================ RIGHE
const notizia = (id, extra = {}) => ({
  id, titolo: id, autori: null, fonte: null, abstract: null, tema_slug: null, pubblicato_a: null,
  raccolto_a: fa(5), letto: 0, salvato: 0, url_media: null, tipo_media: null, byte_media: null,
  file_media: null, ha_testo: 1, ...extra,
});
{
  const r = N.righeTitoli([
    { chiave: "dati", nome: "Dati e SQL", notizie: ["d1", "d2", "d3", "d4", "d5"].map((x) => notizia(x)) },
    { chiave: "kpi", nome: "KPI e MEAL", notizie: [] },
    { chiave: "ia", nome: "IA e codice", notizie: [notizia("i1")] },
  ]);
  uguale("N6 in primo piano: una sezione per area con qualcosa, la principale e al massimo tre dopo",
    r.map((x) => x.tipo === "sezione" ? `[${x.titolo}>${x.categoria}]` : `${x.tipo}:${x.notizia.id}`),
    ["[Dati e SQL>dati]", "principale:d1", "voce:d2", "voce:d3", "voce:d4", "[IA e codice>ia]", "principale:i1"]);
  ok("N6 le chiavi delle righe non si ripetono", new Set(r.map((x) => x.chiave)).size === r.length);
}
{
  const r = N.righePerGiorno([
    notizia("o1", { pubblicato_a: fa(10) }), notizia("o2", { pubblicato_a: fa(20) }),
    notizia("i1", { pubblicato_a: fa(40) }), notizia("p1", { pubblicato_a: localeIso(2026, 9, 10) }),
  ], adesso);
  uguale(`N7 [${fuso}] per giorno: un'intestazione per giorno, la prima notizia in evidenza`,
    r.map((x) => x.tipo === "sezione" ? `[${x.titolo}]` : `${x.tipo}:${x.notizia.id}`),
    ["[Oggi]", "principale:o1", "voce:o2", "[Ieri]", "principale:i1", "[Prima]", "principale:p1"]);
}
uguale("N8 per te: le aree dei temi studiati, una volta sola, senza l'esplorazione",
  N.areePerTe(["sql_base", "hardware", "sql_join", "esplorazione"]), ["dati", "hardware"]);
uguale("N8 senza temi studiati, nessuna area", N.areePerTe([]), []);

// ============================================================ SUL DATABASE
const DB = await import("../../lib/db.ts");
await DB.apri("dispnotizie");
const d = DB.database();
const art = async (id, tema, extra = {}) => {
  const a = { testo: "Il testo intero.", pubblicato_a: null, raccolto_a: "2026-09-30T08:00:00+00:00", letto: 0, salvato: 0, ...extra };
  await d.runAsync(
    `INSERT INTO articoli (id, titolo, fonte, tema_slug, testo, pubblicato_a, raccolto_a, letto, salvato, url_media, tipo_media)
     VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
    [id, `Titolo ${id}`, "rss[Prova]", tema, a.testo, a.pubblicato_a, a.raccolto_a, a.letto, a.salvato,
     a.url_media ?? null, a.tipo_media ?? null]);
};
await art("g1", "gdpr", { pubblicato_a: "2026-09-29T10:00:00+00:00" });
await art("g2", "ai_act", { pubblicato_a: "2026-09-30T06:00:00+00:00", testo: "" });
await art("g3", "gdpr", { letto: 1, pubblicato_a: "2026-09-30T07:00:00+00:00" });
await art("s1", "statistica", { testo: null });
await art("e1", "esplorazione");
await art("x1", "salute-pubblica");
await art("n1", null, { salvato: 1, letto: 1 });
await art("h1", "hardware", { url_media: "https://esempio.org/a.mp3", tipo_media: "audio/mpeg" });
// Dal catalogo vero: Crossref data l'articolo con il fascicolo a stampa.
await art("cr", "ai_act", { pubblicato_a: "2121-10-01T00:00:00+00:00", raccolto_a: "2026-09-28T08:00:00+00:00" });

const gov = N.categorie().find((c) => c.chiave === "governance").temi;
{
  const r = await N.leggiNotizie({ temi: gov, soloDaLeggere: true, limite: 50 });
  uguale("D1 un'area, da leggere: solo i suoi temi e solo i non letti, dal più recente",
    r.map((x) => x.id), ["g2", "g1", "cr"]);
  uguale("D1 l'elenco sa se il testo c'è, senza leggerlo", r.slice(0, 2).map((x) => [x.id, Boolean(x.ha_testo)]), [["g2", false], ["g1", true]]);
  const cr = r.find((x) => x.id === "cr");
  uguale("D1 l'articolo datato 2121 sta al giorno in cui è arrivato, non in cima come «oggi»",
    [N.quando(N.dataDi(cr), new Date(2026, 9, 1, 12)), N.gruppoDi(N.dataDi(cr), new Date(2026, 9, 1, 12))],
    ["3 giorni fa", "Questa settimana"]);
  ok("D1 il testo non viaggia nell'elenco", r.every((x) => !("testo" in x)));
  const tutti = await N.leggiNotizie({ temi: gov, soloDaLeggere: false, limite: 50 });
  uguale("D2 «Tutti» comprende i già letti, sempre per data d'uscita", tutti.map((x) => x.id), ["g3", "g2", "g1", "cr"]);
  uguale("D2 il limite vale", (await N.leggiNotizie({ temi: gov, soloDaLeggere: false, limite: 1 })).map((x) => x.id), ["g3"]);
  uguale("D2 un elenco di temi vuoto non trova niente", await N.leggiNotizie({ temi: [], soloDaLeggere: false, limite: 9 }), []);
}
{
  const fuori = await N.leggiNotizie({ temi: null, fuoriDalPiano: true, soloDaLeggere: false, limite: 50 });
  uguale("D3 esplorazione: lo slug dell'esplorazione, i temi ignoti e gli articoli senza tema",
    fuori.map((x) => x.id).sort(), ["e1", "n1", "x1"]);
  const salvati = await N.leggiNotizie({ temi: null, soloDaLeggere: false, soloSalvati: true, limite: 50 });
  uguale("D4 salvati: letti o no", salvati.map((x) => x.id), ["n1"]);
}
{
  const conti = await N.contaPerTema();
  const daLeggere = N.contaPerCategoria(conti, true);
  const tutti = N.contaPerCategoria(conti, false);
  uguale("D5 i numeri della barra, da leggere: governance 3, dati 1, hardware 1, esplorazione 2",
    ["governance", "dati", "hardware", "esplorazione"].map((a) => daLeggere.get(a) ?? 0), [3, 1, 1, 2]);
  uguale("D5 e in tutto: governance 4, esplorazione 3", ["governance", "esplorazione"].map((a) => tutti.get(a) ?? 0), [4, 3]);
  const somma = [...tutti.values()].reduce((s, n) => s + n, 0);
  uguale("D5 nessun articolo si perde fra le categorie", somma, 9);
}

// ============================================================ SORGENTI
// La schermata non gira sul banco: si guarda che la forma giusta resti.
{
  const s = readFileSync(join(RADICE_PROGETTO, "app/(tabs)/notizie.tsx"), "utf8");
  ok("S1 il ?tema= dell'unità si legge a ogni arrivo e si consuma",
    s.includes("router.setParams({ tema: undefined } as never);") && s.includes("}, [temaChiesto]);"));
  ok("S1 il tema scelto resta visibile fra i filtri anche a zero", s.includes(".filter((x) => x.n > 0 || x.t === tema)"));
  ok("S1 si rilegge a ogni ritorno sulla scheda, per sapere che cosa si è letto",
    s.includes("useFocusEffect(useCallback(() => {") && s.includes("}, [categoria, tema, soloDaLeggere]));"));
  ok("S1 la barra delle categorie sta fuori dalla lista, ferma",
    s.indexOf("<ScrollView ref={barra} horizontal") > 0 && s.indexOf("<ScrollView ref={barra} horizontal") < s.indexOf("<FlatList"));
}

uguale("D6 nessun tentativo di rete", reteTentata, []);

console.log(`\nsimulazione notizie (lib/notizie.ts) — fuso ${fuso}`);
for (const f of falliti) console.log("  ✗ " + f);
console.log(`passati ${passate}, falliti ${falliti.length}`);
process.exit(falliti.length ? 1 : 0);
