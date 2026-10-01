/**
 * SIMULAZIONE DEL PERCORSO — lib/percorso.ts e lib/avanzamento.ts sopra il banco.
 *
 *   node test/simulazione/percorso.mjs
 *
 * Gira il CODICE VERO: i contenuti veri caricati da lib/contenuti.ts in un
 * SQLite vero, letti dalle query vere di lib/avanzamento.ts. Nessuna rete.
 *
 * Le promesse che il percorso fa, e che si rompono in silenzio:
 *  - le unità stanno nell'ordine del piano, e un tema senza materiale non è
 *    un'unità vuota da attraversare;
 *  - la soglia dell'80% è il minimo intero che la raggiunge, per ogni totale;
 *  - il prossimo passo non manda a leggere un volume che non è sul telefono;
 *  - un esercizio risolto, una scheda saputa, uno scenario scritto spostano
 *    l'avanzamento; una scheda ricaduta e una nota rimasta il modello no;
 *  - su un SQLite senza window functions l'unità che le richiede non esiste.
 */
import { spawnSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const QUESTA_CARTELLA = dirname(fileURLToPath(import.meta.url));
const RADICE_PROGETTO = resolve(QUESTA_CARTELLA, "..", "..");

if (!process.env.BANCO_PERCORSO_IN_CORSO) {
  const { variabileBanco } = await import("../banco/doppi-altri.mjs");
  const esito = spawnSync(
    process.execPath,
    ["--import", "./test/banco/carica.mjs", "test/simulazione/percorso.mjs"],
    {
      cwd: RADICE_PROGETTO,
      stdio: "inherit",
      env: { ...process.env, BANCO_PERCORSO_IN_CORSO: "1", BANCO_DOPPI: variabileBanco() },
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

// La rete è vietata: il percorso si calcola in aereo.
const reteTentata = [];
globalThis.fetch = (...a) => { reteTentata.push(String(a[0])); throw new Error("rete vietata"); };

const FS = await import("../banco/expo-file-system.mjs");
const { configuraCartella } = await import("../banco/expo-sqlite.mjs");
const { installaRequireMetro } = await import("../banco/require-metro.mjs");
FS.configuraRadice(mkdtempSync(join(tmpdir(), "sim-percorso-")));
configuraCartella(join(FS.percorsoDocumenti(), "SQLite"));
installaRequireMetro(RADICE_PROGETTO);

const P = await import("../../lib/percorso.ts");

// ============================================================ LOGICA PURA
const M = (x) => ({ ...P.MATERIALE_VUOTO, ...x });

// --- la soglia
uguale("P1 soglia di 15 è 12", P.soglia(15), 12);
uguale("P1 soglia di 7 è 6", P.soglia(7), 6);
uguale("P1 soglia di 30 è 24", P.soglia(30), 24);
uguale("P1 soglia di 1 è 1", P.soglia(1), 1);
uguale("P1 soglia di 0 è 0", P.soglia(0), 0);
for (let n = 1; n <= 200; n++) {
  const s = P.soglia(n);
  if (!(s * 100 >= n * 80 && (s - 1) * 100 < n * 80)) { ok(`P1 soglia minima intera per ${n}`, false, String(s)); break; }
}
ok("P1 la soglia è la minima intera che raggiunge l'80% per ogni n fra 1 e 200", true);

// --- i passi
{
  const passi = P.passiDi(M({ volumi: 2, esercizi: 30, schede: 10, scenari: 3, articoliDaLeggere: 4 }));
  uguale("P2 i passi seguono il ciclo leggi → esercizi → schede → scenario → rassegna",
    passi.map((p) => p.tipo), ["leggi", "esercizi", "schede", "scenario", "rassegna"]);
  uguale("P2 contano esercizi, schede e scenario; leggere e la rassegna no",
    passi.map((p) => p.conta), [false, true, true, true, false]);
  uguale("P2 le soglie", passi.map((p) => p.soglia), [1, 24, 8, 1, 0]);
  ok("P2 un volume che non è sul telefono non è un passo eseguibile", passi[0].eseguibile === false);
  ok("P2 con un volume sul telefono sì",
    P.passiDi(M({ volumi: 2, volumiSulTelefono: 1 }))[0].eseguibile === true);
  uguale("P2 un tema senza materiale non ha passi", P.passiDi(M({})), []);
  ok("P2 la rassegna non si supera mai (si tiene in pari)", passi[4].completo === false);
}

// --- lo stato di un'unità
{
  const st = (x) => P.statoDi(P.passiDi(M(x)));
  uguale("P3 solo lettura: senza verifiche", st({ volumi: 3, volumiIniziati: 3 }).stato, "senza_verifiche");
  uguale("P3 niente di fatto: da iniziare", st({ esercizi: 10 }).stato, "da_iniziare");
  uguale("P3 un volume iniziato basta a dire in corso", st({ esercizi: 10, volumi: 1, volumiIniziati: 1 }).stato, "in_corso");
  uguale("P3 sotto soglia: in corso", st({ esercizi: 10, risolti: 7 }).stato, "in_corso");
  uguale("P3 alla soglia: completa", st({ esercizi: 10, risolti: 8 }).stato, "completa");
  uguale("P3 completa anche senza aver letto (la lettura non conta)", st({ esercizi: 10, risolti: 8, volumi: 2 }).stato, "completa");
  uguale("P3 esercizi fatti, schede no: in corso", st({ esercizi: 10, risolti: 10, schede: 5 }).stato, "in_corso");
  const a = st({ esercizi: 10, risolti: 4, schede: 5, schedeSapute: 4 }).avanzamento;
  ok("P3 avanzamento: media dei passi, ciascuno pesato sulla sua soglia (4/8 e 4/4 → 0.75)", Math.abs(a - 0.75) < 1e-9, String(a));
  const oltre = st({ esercizi: 10, risolti: 10, schede: 5 }).avanzamento;
  ok("P3 un passo oltre la soglia non compensa quello a zero (1 e 0 → 0.5)", Math.abs(oltre - 0.5) < 1e-9, String(oltre));
}

// --- l'ordine delle unità
{
  const temi = [
    { slug: "c", nome: "C", trimestre: "T2" },
    { slug: "b", nome: "B", trimestre: "T1" },
    { slug: "a", nome: "A", trimestre: "T1" },
    { slug: "vuoto", nome: "Vuoto", trimestre: "T0" },
    { slug: "orfano", nome: "Orfano", trimestre: null },
    { slug: "ignoto", nome: "Ignoto", trimestre: "T1" },
  ];
  const mat = { a: M({ esercizi: 1 }), b: M({ esercizi: 1 }), c: M({ esercizi: 1 }), orfano: M({ schede: 1 }), ignoto: M({ esercizi: 1 }) };
  const u = P.costruisciPercorso(temi, mat, ["vuoto", "b", "a", "c"]);
  uguale("P4 per trimestre, poi nell'ordine di TEMI, poi gli sconosciuti, e senza trimestre in fondo",
    u.map((x) => x.tema.slug), ["b", "a", "ignoto", "c", "orfano"]);
  uguale("P4 un tema senza materiale non è un'unità, e le posizioni restano consecutive",
    u.map((x) => x.posizione), [1, 2, 3, 4, 5]);
}

// --- la numerazione: le unità di sola lettura non hanno numero
// La mattina dopo la conduttura porta articoli a un tema che non aveva niente
// e un volume a un tema fra due unità: i numeri delle unità con verifiche non
// si muovono, e l'ultimo resta il «di N» di Oggi. Le unità numerate sono una
// superata, una in corso e una da iniziare: il numero dipende dall'avere
// verifiche, non da quanto se n'è fatto.
{
  const temi = [
    { slug: "vuoto", nome: "Vuoto", trimestre: "T0" },
    { slug: "a", nome: "A", trimestre: "T1" },
    { slug: "lett", nome: "Lett", trimestre: "T1" },
    { slug: "b", nome: "B", trimestre: "T1" },
    { slug: "c", nome: "C", trimestre: "T2" },
  ];
  const ordine = temi.map((t) => t.slug);
  const prima = { a: M({ esercizi: 3, risolti: 3 }), b: M({ schede: 2, schedeSapute: 1 }), c: M({ scenari: 1 }) };
  const dopo = { ...prima, vuoto: M({ articoliDaLeggere: 3 }), lett: M({ volumi: 1, volumiSulTelefono: 1 }) };
  const numeri = (u) => Object.fromEntries(u.map((x) => [x.tema.slug, x.posizione]));
  const uPrima = P.costruisciPercorso(temi, prima, ordine);
  const uDopo = P.costruisciPercorso(temi, dopo, ordine);
  uguale("P4b prima: tre unità, numerate 1, 2, 3", numeri(uPrima), { a: 1, b: 2, c: 3 });
  uguale("P4b dopo: le unità di sola lettura ci sono, al loro posto, senza numero",
    uDopo.map((x) => [x.tema.slug, x.stato, x.posizione]),
    [["vuoto", "senza_verifiche", null], ["a", "completa", 1], ["lett", "senza_verifiche", null],
     ["b", "in_corso", 2], ["c", "da_iniziare", 3]]);
  const numerate = uDopo.filter((x) => x.posizione !== null);
  uguale("P4b i numeri delle unità con verifiche non si spostano",
    Object.fromEntries(numerate.map((x) => [x.tema.slug, x.posizione])), numeri(uPrima));
  uguale("P4b numerate sono esattamente le unità con verifiche, e il numero più alto è il loro conto",
    numerate.map((x) => x.posizione),
    Array.from({ length: P.unitaConVerifiche(uDopo) }, (_, i) => i + 1));
  const ind = P.prossimoPasso(uDopo);
  uguale("P4b il prossimo passo cade sempre su un'unità con un numero", ind && [ind.unita.tema.slug, ind.unita.posizione], ["b", 2]);
}

// --- il prossimo passo
{
  const temi = [
    { slug: "fatto", nome: "Fatto", trimestre: "T1" },
    { slug: "letture", nome: "Letture", trimestre: "T1" },
    { slug: "libro_assente", nome: "Libro assente", trimestre: "T1" },
    { slug: "libro_presente", nome: "Libro presente", trimestre: "T2" },
  ];
  const ordine = temi.map((t) => t.slug);
  const mat = {
    fatto: M({ esercizi: 5, risolti: 5 }),
    letture: M({ volumi: 2, volumiSulTelefono: 2 }),
    libro_assente: M({ volumi: 1, esercizi: 3, schede: 2 }),
    libro_presente: M({ volumi: 1, volumiSulTelefono: 1, esercizi: 3 }),
  };
  let ind = P.prossimoPasso(P.costruisciPercorso(temi, mat, ordine));
  uguale("P5 salta le unità complete e quelle senza verifiche",
    ind && ind.unita.tema.slug, "libro_assente");
  uguale("P5 non manda a leggere un volume che non è sul telefono: comincia dagli esercizi",
    ind && ind.passo.tipo, "esercizi");

  mat.libro_assente = M({ volumi: 1, esercizi: 3, risolti: 3, schede: 2 });
  ind = P.prossimoPasso(P.costruisciPercorso(temi, mat, ordine));
  uguale("P5 esercizi superati: tocca alle schede della stessa unità", ind && [ind.unita.tema.slug, ind.passo.tipo], ["libro_assente", "schede"]);

  mat.libro_assente = M({ volumi: 1, esercizi: 3, risolti: 3, schede: 2, schedeSapute: 2 });
  ind = P.prossimoPasso(P.costruisciPercorso(temi, mat, ordine));
  uguale("P5 con il volume sul telefono e mai aperto, prima si legge",
    ind && [ind.unita.tema.slug, ind.passo.tipo], ["libro_presente", "leggi"]);

  mat.libro_presente = M({ volumi: 1, volumiSulTelefono: 1, volumiIniziati: 1, esercizi: 3 });
  ind = P.prossimoPasso(P.costruisciPercorso(temi, mat, ordine));
  uguale("P5 volume iniziato: si passa agli esercizi", ind && ind.passo.tipo, "esercizi");

  mat.libro_presente = M({ volumi: 1, volumiSulTelefono: 1, esercizi: 3, risolti: 3 });
  ind = P.prossimoPasso(P.costruisciPercorso(temi, mat, ordine));
  uguale("P5 tutto superato: nessun prossimo passo, anche con un volume mai aperto", ind, null);
}

// --- dove porta un passo
{
  const p = (tipo) => ({ tipo, fatto: 0, totale: 1, soglia: 1, completo: false, conta: true, eseguibile: true });
  uguale("P6 esercizi SQL filtrati per tema", P.destinazione("sql_join", p("esercizi")), "/esercizi?tema=sql_join");
  uguale("P6 la lettura del codice ha la sua schermata", P.destinazione("lettura_codice", p("esercizi")), "/codice");
  uguale("P6 schede filtrate per tema", P.destinazione("kpi", p("schede")), "/ripasso?tema=kpi");
  uguale("P6 lo scenario si apre dall'unità", P.destinazione("kpi", p("scenario")), "/unita?tema=kpi");
  uguale("P6 leggi con un volume: il lettore", P.destinazione("kpi", p("leggi"), "vol 1"), "/lettore?id=vol%201");
  uguale("P6 leggi senza volume: la libreria", P.destinazione("kpi", p("leggi"), null), "/libreria");
  uguale("P6 la rassegna filtrata per tema", P.destinazione("gdpr", p("rassegna")), "/notizie?tema=gdpr");
  for (const t of ["leggi", "esercizi", "schede", "scenario", "rassegna"]) {
    const d = P.descriviPasso(p(t));
    ok(`P6 ogni passo ha titolo e spiegazione (${t})`, d.titolo.length > 0 && d.dettaglio.length > 0);
  }
}

// --- i progetti in parallelo
// Temi scelti fuori dall'ordine del piano; superato uno, il successivo della
// stessa area; mai due progetti sulla stessa unità.
{
  const temi = [
    { slug: "lett", nome: "Lett", trimestre: "T0", pista: "gestione" },
    { slug: "d1", nome: "D1", trimestre: "T1", pista: "dati" },
    { slug: "d2", nome: "D2", trimestre: "T1", pista: "dati" },
    { slug: "i", nome: "I", trimestre: "T3", pista: "ia" },
    { slug: "d3", nome: "D3", trimestre: "T4", pista: "dati" },
    { slug: "h", nome: "H", trimestre: "T5", pista: "hardware" },
    { slug: "orfano", nome: "Orfano", trimestre: "T5" },
  ];
  const ordine = temi.map((t) => t.slug);
  const fatto = M({ esercizi: 2, risolti: 2 });
  const aperto = M({ esercizi: 2 });
  const base = { lett: M({ articoliDaLeggere: 2 }), d1: aperto, d2: aperto, i: aperto, d3: aperto, h: aperto, orfano: aperto };
  const pr = (mat, seguiti) => P.progetti(P.costruisciPercorso(temi, { ...base, ...mat }, ordine), seguiti)
    .map((x) => [x.seguito, x.unita.tema.slug, x.passo && x.passo.tipo, x.subentrata]);

  uguale("P8 nessun tema seguito, nessun progetto", pr({}, []), []);
  uguale("P8 l'hardware prima di SQL: i progetti stanno nell'ordine in cui si sono scelti, non in quello del piano",
    pr({}, ["h", "d1"]), [["h", "h", "esercizi", false], ["d1", "d1", "esercizi", false]]);
  uguale("P8 superato il tema scelto, subentra il successivo della stessa area",
    pr({ d1: fatto }, ["d1"]), [["d1", "d2", "esercizi", true]]);
  uguale("P8 il successivo salta le unità già di un altro progetto (join e aggregazione, non due volte join)",
    pr({ d1: fatto }, ["d1", "d2"]), [["d1", "d3", "esercizi", true], ["d2", "d2", "esercizi", false]]);
  uguale("P8 prima: D2 aperto, D1 superato prende D3",
    pr({ d1: fatto }, ["d2", "d1"]), [["d2", "d2", "esercizi", false], ["d1", "d3", "esercizi", true]]);
  uguale("P8 superato anche D2, D3 resta a D1: un'unità non cambia progetto da un giorno all'altro",
    pr({ d1: fatto, d2: fatto }, ["d2", "d1"]), [["d2", "d2", null, false], ["d1", "d3", "esercizi", true]]);
  // Il verso opposto: superato prima D2 (il tema che nel piano viene dopo),
  // poi D1. Senza ricordo, D3 passerebbe a D1; con il ricordo resta a D2.
  const conRicordo = (mat, seguiti, prec) => P.progetti(P.costruisciPercorso(temi, { ...base, ...mat }, ordine), seguiti, prec)
    .map((x) => [x.seguito, x.unita.tema.slug, x.passo && x.passo.tipo, x.subentrata]);
  const ieri = P.subentrate(P.progetti(P.costruisciPercorso(temi, { ...base, d2: fatto }, ordine), ["d1", "d2"]));
  uguale("P8 il ricordo di ieri: D2 superato continua su D3", ieri, { d2: "d3" });
  uguale("P8 superato poi anche D1, D3 resta a D2 nell'altro verso",
    conRicordo({ d1: fatto, d2: fatto }, ["d1", "d2"], ieri), [["d1", "d1", null, false], ["d2", "d3", "esercizi", true]]);
  uguale("P8 senza ricordo lo stesso stato va nell'ordine del piano",
    conRicordo({ d1: fatto, d2: fatto }, ["d1", "d2"], {}), [["d1", "d3", "esercizi", true], ["d2", "d2", null, false]]);
  uguale("P8 un ricordo che non vale più (unità del tema che la segue di suo, o di un'altra area) si ignora",
    conRicordo({ d1: fatto }, ["d1", "h"], { d1: "h" }), [["d1", "d2", "esercizi", true], ["h", "h", "esercizi", false]]);
  uguale("P8 dopo l'ultimo dell'area si torna al primo rimasto indietro",
    pr({ d3: fatto }, ["d3"]), [["d3", "d1", "esercizi", true]]);
  uguale("P8 area tutta superata: il progetto resta, senza passo",
    pr({ d1: fatto, d2: fatto, d3: fatto }, ["d2"]), [["d2", "d2", null, false]]);
  const finita = (mat, seguiti) => P.progetti(P.costruisciPercorso(temi, { ...base, ...mat }, ordine), seguiti)
    .map((x) => [x.seguito, x.passo !== null, x.areaFinita]);
  uguale("P8 senza passo perché il resto dell'area è di un altro progetto: l'area NON è finita",
    finita({ d1: fatto, d3: fatto }, ["d1", "d2"]), [["d1", false, false], ["d2", true, false]]);
  uguale("P8 senza passo perché l'area è finita: lo si dice",
    finita({ d1: fatto, d2: fatto, d3: fatto }, ["d2"]), [["d2", false, true]]);
  uguale("P8 un tema senza area, superato, non ha un seguito",
    pr({ orfano: fatto }, ["orfano"]), [["orfano", "orfano", null, false]]);
  uguale("P8 temi di sola lettura, sconosciuti o ripetuti non fanno progetti",
    pr({}, ["lett", "zzz", "i", "i"]), [["i", "i", "esercizi", false]]);
  const fare = (mat, seguiti) => P.daFare(P.costruisciPercorso(temi, { ...base, ...mat }, ordine), seguiti)
    .map((x) => [x.unita.tema.slug, x.progetto ? x.progetto.seguito : "piano"]);
  uguale("P8 daFare: i passi dei progetti", fare({}, ["h", "i"]), [["h", "h"], ["i", "i"]]);
  uguale("P8 daFare: senza temi seguiti, il prossimo passo del piano", fare({}, []), [["d1", "piano"]]);
  uguale("P8 daFare: con l'area del solo progetto finita, torna il piano (non «tutte superate»)",
    fare({ h: fatto }, ["h"]), [["d1", "piano"]]);
  uguale("P8 daFare: con un progetto finito e uno aperto, solo quello aperto",
    fare({ h: fatto }, ["h", "i"]), [["i", "i"]]);
  uguale("P8 daFare: tutto superato, niente da fare",
    fare(Object.fromEntries(ordine.map((s) => [s, s === "lett" ? base.lett : fatto])), ["h"]), []);
  uguale("P8 senza progetti il piano resta quello di prima",
    P.prossimoPasso(P.costruisciPercorso(temi, base, ordine)).unita.tema.slug, "d1");
}

{
  const S = await import("../../lib/progetti.ts");
  uguale("P9 niente di salvato: nessun tema seguito", S.elencoSeguiti(null), []);
  uguale("P9 un valore illeggibile vale nessun tema seguito", S.elencoSeguiti("{rotto"), []);
  uguale("P9 un oggetto al posto dell'elenco, idem", S.elencoSeguiti('{"a":1}'), []);
  uguale("P9 si tengono le stringhe non vuote, una volta sola, nell'ordine",
    S.elencoSeguiti('["h","h",3,"","d1"]'), ["h", "d1"]);
  uguale("P9 i seguiti ricordati: illeggibili o non un oggetto valgono nessuno",
    [S.elencoSubentrate(null), S.elencoSubentrate("{rotto"), S.elencoSubentrate('["a"]')], [{}, {}, {}]);
  uguale("P9 i seguiti ricordati: solo coppie di stringhe non vuote",
    S.elencoSubentrate('{"d1":"d2","x":3,"y":"","":"z"}'), { d1: "d2" });
}

// --- gli scenari
{
  const s = { id: "SC-1", consegna: "Progetta un indicatore.", rubrica: ["Definizione chiara", "Fonte del dato"] };
  const m = P.modelloScenario(s, "KPI e misurazione");
  uguale("P7 il titolo della nota nomina il tema", m.titolo, "Scenario — KPI e misurazione");
  ok("P7 il modello porta consegna, rubrica come lista di controllo e la marca della risposta",
    m.testo.startsWith("Progetta un indicatore.") && m.testo.includes("- [ ] Fonte del dato") && m.testo.includes(P.MARCA_RISPOSTA));
  ok("P7 la nota rimasta il modello non è svolta", !P.scenarioSvolto(m.testo, m.testo));
  ok("P7 nemmeno con qualche a capo in più", !P.scenarioSvolto(m.testo + "\n\n  \n", m.testo));
  ok("P7 una nota svuotata non è svolta", !P.scenarioSvolto("   ", m.testo));
  ok("P7 una nota assente non è svolta", !P.scenarioSvolto(null, m.testo));
  ok("P7 una risposta scritta sì", P.scenarioSvolto(m.testo + "Tasso di copertura vaccinale.", m.testo));
}

// ============================================================ SUL DATABASE
const DB = await import("../../lib/db.ts");
const contenuti = await import("../../lib/contenuti.ts");
const A = await import("../../lib/avanzamento.ts");
const palestra = await import("../../lib/palestra.ts");
await DB.apri("dispperc");
await contenuti.caricaContenuti();
const d = DB.database();

const nuovo = await A.leggiPercorso();
const perSlug = (u) => Object.fromEntries(u.map((x) => [x.tema.slug, x]));
{
  const u = perSlug(nuovo);
  ok("S1 senza palestra aperta il motore è ignoto: niente window functions, niente unità sql_window",
    !palestra.supportaWindowFunctions() && !u.sql_window);
  ok("S1 «gestione» non ha materiale: non è un'unità", !u.gestione);
  uguale("S1 la prima unità è sql_base (T1, prima in TEMI dopo gestione)", nuovo[0].tema.slug, "sql_base");
  uguale("S1 le unità sono 20 (22 temi meno gestione e sql_window)", nuovo.length, 20);
  const pass = (slug, tipo) => u[slug].passi.find((p) => p.tipo === tipo);
  uguale("S1 sql_base: 30 esercizi, soglia 24", [pass("sql_base", "esercizi").totale, pass("sql_base", "esercizi").soglia], [30, 24]);
  uguale("S1 lettura_codice: i 20 moduli", pass("lettura_codice", "esercizi").totale, 20);
  uguale("S1 statistica: 26 schede", pass("statistica", "schede").totale, 26);
  uguale("S1 gli scenari sono 12 in tutto",
    nuovo.reduce((s, x) => s + (x.passi.find((p) => p.tipo === "scenario")?.totale ?? 0), 0), 12);
  uguale("S1 i volumi sono 52 in tutto",
    nuovo.reduce((s, x) => s + (x.passi.find((p) => p.tipo === "leggi")?.totale ?? 0), 0), 52);
  ok("S1 a un'installazione nuova nessuna unità è iniziata", nuovo.every((x) => x.stato === "da_iniziare" || x.stato === "senza_verifiche"));
  const ind = P.prossimoPasso(nuovo);
  uguale("S1 si comincia dagli esercizi di sql_base: i volumi non sono ancora sul telefono",
    ind && P.destinazione(ind.unita.tema.slug, ind.passo), "/esercizi?tema=sql_base");
  const trimestri = nuovo.map((x) => x.tema.trimestre);
  ok("S1 i trimestri non tornano mai indietro", trimestri.every((t, i) => i === 0 || trimestri[i - 1] <= t), trimestri.join(","));
}

// --- esercizi risolti
const adesso = new Date().toISOString();
const sqlBase = await d.getAllAsync("SELECT id FROM esercizi WHERE tema_slug = 'sql_base' AND tipo = 'sql_eseguibile' ORDER BY id");
async function tentativo(id, esercizio, esito) {
  await d.runAsync(
    "INSERT INTO tentativi (id, esercizio_id, risposta, esito, motivo, durata_sec, eseguito_a, hlc) VALUES (?,?,?,?,?,?,?,?)",
    [id, esercizio, "select 1", esito, "", 5, adesso, "0"]);
}
for (let i = 0; i < 23; i++) await tentativo(`t${i}`, sqlBase[i].id, "corretto");
await tentativo("t-doppio", sqlBase[0].id, "corretto");
await tentativo("t-errato", sqlBase[23].id, "errato");
{
  const u = perSlug(await A.leggiPercorso());
  const e = u.sql_base.passi.find((p) => p.tipo === "esercizi");
  uguale("S2 23 risolti (uno due volte, uno sbagliato): contano gli esercizi distinti", e.fatto, 23);
  uguale("S2 sotto la soglia di 24: in corso", u.sql_base.stato, "in_corso");
}
await tentativo("t23", sqlBase[23].id, "corretto");
{
  const u = await A.leggiPercorso();
  uguale("S2 al 24° risolto l'unità è completa", perSlug(u).sql_base.stato, "completa");
  const ind = P.prossimoPasso(u);
  uguale("S2 e il prossimo passo passa a sql_join", ind && ind.unita.tema.slug, "sql_join");
}

// --- schede
const stat = await d.getAllAsync("SELECT id FROM esercizi WHERE tema_slug = 'statistica' AND tipo = 'quiz_citato' ORDER BY id");
for (let i = 0; i < 20; i++) {
  await d.runAsync("UPDATE ripasso SET ripetizioni = 1, stato = 'ripasso', prossima_revisione = ? WHERE esercizio_id = ?",
    [new Date(Date.now() + 3 * 864e5).toISOString(), stat[i].id]);
}
await d.runAsync("UPDATE ripasso SET ripetizioni = 2, stato = 'ricaduta' WHERE esercizio_id = ?", [stat[20].id]);
{
  const m = (await A.leggiMateriali())["statistica"];
  uguale("S3 schede sapute: 20 (la ricaduta non conta)", m.schedeSapute, 20);
  uguale("S3 in scadenza: le 6 non ancora rimandate", m.schedeInScadenza, 6);
  const u = perSlug(await A.leggiPercorso());
  uguale("S3 statistica: 20 su soglia 21, in corso", [u.statistica.passi.find((p) => p.tipo === "schede").soglia, u.statistica.stato], [21, "in_corso"]);
}
await d.runAsync("UPDATE ripasso SET stato = 'ripasso' WHERE esercizio_id = ?", [stat[20].id]);
uguale("S3 ripresa la scheda ricaduta: 21, statistica senza scenari è completa",
  perSlug(await A.leggiPercorso()).statistica.stato, "completa");

// --- scenari
const scKpi = await A.leggiScenari("kpi");
uguale("S4 kpi ha 2 scenari, nessuno con una nota", scKpi.map((s) => s.notaId), [null, null]);
{
  const m = P.modelloScenario(scKpi[0], "KPI e misurazione");
  await d.runAsync(
    "INSERT INTO note (id, tema_slug, titolo, testo, pubblicabile, origine_url, creato_a, hlc) VALUES (?,?,?,?,0,?,?,?)",
    ["nota-sc", "kpi", m.titolo, m.testo, `scenario:${scKpi[0].id}`, adesso, "0"]);
  const dopo = await A.leggiScenari("kpi");
  ok("S4 la nota nata dal modello si ritrova dallo scenario, ma non è svolto",
    dopo[0].notaId === "nota-sc" && dopo[0].svolto === false);
  uguale("S4 e il passo scenario resta a zero", (await A.leggiMateriali()).kpi.scenariSvolti, 0);
  await d.runAsync("UPDATE note SET testo = ? WHERE id = 'nota-sc'", [m.testo + "Copertura: dosi / popolazione target."]);
  ok("S4 scritta la risposta, lo scenario è svolto", (await A.leggiScenari("kpi"))[0].svolto === true);
  uguale("S4 e conta nel passo", (await A.leggiMateriali()).kpi.scenariSvolti, 1);

  // Due dispositivi aprono lo stesso scenario prima di sincronizzarsi: sul
  // secondo nasce, DOPO, una nota rimasta il modello. Non deve cancellare la
  // risposta scritta sul primo.
  const nuova = (id, testo, hlc) => d.runAsync(
    "INSERT INTO note (id, tema_slug, titolo, testo, pubblicabile, origine_url, creato_a, hlc) VALUES (?,?,?,?,0,?,?,?)",
    [id, "kpi", m.titolo, testo, `scenario:${scKpi[0].id}`, adesso, hlc]);
  await nuova("nota-sc-tablet", m.testo, "0000000000ff-0000-tablet");
  const due = (await A.leggiScenari("kpi"))[0];
  ok("S4b una nota vuota nata dopo non toglie lo svolto", due.svolto === true, JSON.stringify(due));
  uguale("S4b e «Riapri la nota» porta alla risposta, non al modello", due.notaId, "nota-sc");
  await nuova("nota-sc-seconda", m.testo + "Seconda stesura.", "000000000100-0000-tablet");
  await nuova("nota-sc-prima", m.testo + "Prima stesura.", "000000000001-0000-telefono");
  uguale("S4c fra due risposte vale la più recente per HLC, non l'ultima inserita",
    (await A.leggiScenari("kpi"))[0].notaId, "nota-sc-seconda");
  uguale("S4c e lo scenario conta una volta sola", (await A.leggiMateriali()).kpi.scenariSvolti, 1);
  const m2 = P.modelloScenario(scKpi[1], "KPI e misurazione");
  await d.runAsync(
    "INSERT INTO note (id, tema_slug, titolo, testo, pubblicabile, origine_url, creato_a, hlc) VALUES (?,?,?,?,0,?,?,?), (?,?,?,?,0,?,?,?)",
    ["m2-vecchia", "kpi", m2.titolo, m2.testo, `scenario:${scKpi[1].id}`, adesso, "000000000200-0000-a",
     "m2-nuova", "kpi", m2.titolo, m2.testo, `scenario:${scKpi[1].id}`, adesso, "000000000300-0000-a"]);
  const solo = (await A.leggiScenari("kpi"))[1];
  ok("S4d con due note rimaste il modello: non svolto, e si riapre la più recente",
    solo.svolto === false && solo.notaId === "m2-nuova", JSON.stringify(solo));
}

// --- volumi
const volStat = await A.leggiVolumi("statistica");
uguale("S5 statistica ha 10 volumi, nessuno sul telefono", [volStat.length, volStat.filter((v) => v.file_locale).length], [10, 0]);
uguale("S5 senza file, nessun volume da aprire", A.volumeDaAprire(volStat), null);
await d.runAsync("UPDATE biblioteca SET file_locale = 'file:///a.pdf', ultima_pagina = 12 WHERE id = ?", [volStat[3].id]);
await d.runAsync("UPDATE biblioteca SET file_locale = 'file:///b.pdf' WHERE id = ?", [volStat[7].id]);
{
  const v = await A.leggiVolumi("statistica");
  uguale("S5 i volumi sul telefono vengono prima", v.slice(0, 2).map((x) => Boolean(x.file_locale)), [true, true]);
  uguale("S5 si apre prima quello mai aperto", A.volumeDaAprire(v), volStat[7].id);
  const m = (await A.leggiMateriali()).statistica;
  uguale("S5 sul telefono 2, iniziati 1", [m.volumiSulTelefono, m.volumiIniziati], [2, 1]);
}

// --- rassegna
await d.runAsync(
  "INSERT INTO articoli (id, titolo, tema_slug, raccolto_a, letto) VALUES ('a1','Uno','gdpr',?,0), ('a2','Due','gdpr',?,1)",
  [adesso, adesso]);
{
  const g = perSlug(await A.leggiPercorso()).gdpr;
  const r = g.passi.find((p) => p.tipo === "rassegna");
  uguale("S6 la rassegna del tema conta solo i non letti", r && r.totale, 1);
}

// --- la numerazione sui contenuti veri
// Ciò che si è visto sul telefono con la 38: la prima mattina la conduttura
// porta un articolo e un volume a «gestione» (T0), che fino a lì non aveva
// materiale, e SQL — fondamenti passava da «unità 1» a «unità 2».
{
  const numeriDi = (u) => Object.fromEntries(u.filter((x) => x.posizione !== null).map((x) => [x.tema.slug, x.posizione]));
  const prima = await A.leggiPercorso();
  await d.runAsync(
    "INSERT INTO articoli (id, titolo, tema_slug, raccolto_a, letto) VALUES ('a-gest','Tre','gestione',?,0)", [adesso]);
  await d.runAsync(
    "INSERT INTO biblioteca (id, titolo, tema_slug, trimestre, aggiunto_a) VALUES ('v-gest','Un manuale','gestione','T0',?)",
    [adesso]);
  const dopo = await A.leggiPercorso();
  const g = perSlug(dopo).gestione;
  ok("S10 «gestione» adesso è un'unità di sola lettura, la prima dell'elenco, senza numero",
    g && g.stato === "senza_verifiche" && dopo[0] === g && g.posizione === null);
  uguale("S10 sql_base resta l'unità 1", perSlug(dopo).sql_base.posizione, 1);
  uguale("S10 nessuna unità con verifiche cambia numero", numeriDi(dopo), numeriDi(prima));
  const conVerifiche = P.unitaConVerifiche(dopo);
  uguale("S10 i numeri vanno da 1 al «di N» di Oggi, senza buchi",
    dopo.filter((x) => x.posizione !== null).map((x) => x.posizione),
    Array.from({ length: conVerifiche }, (_, i) => i + 1));
  uguale("S10 le unità di sola lettura sono tutte e sole quelle senza numero",
    dopo.filter((x) => x.posizione === null).map((x) => x.tema.slug),
    dopo.filter((x) => x.stato === "senza_verifiche").map((x) => x.tema.slug));
}

// --- window functions
let conWindow = null;
try {
  await palestra.apriPalestra();
  conWindow = palestra.supportaWindowFunctions();
} catch (e) {
  ok("S7 apriPalestra sul banco", false, String(e));
}
if (!conWindow) {
  // Non si tace: una prova saltata letta come passata è peggio di una rossa.
  console.log("S7 saltata: il SQLite del banco non ha le window functions");
} else {
  const u = perSlug(await A.leggiPercorso());
  uguale("S7 con un SQLite che ha le window functions, sql_window è un'unità di 23 esercizi",
    u.sql_window && u.sql_window.passi.find((p) => p.tipo === "esercizi").totale, 23);
}

// --- i progetti sui contenuti veri, con il kv-store del banco
{
  const S = await import("../../lib/progetti.ts");
  uguale("S13 all'inizio nessun tema seguito", await S.leggiSeguiti(), []);
  await Promise.all([S.segui("hardware"), S.segui("ia"), S.segui("hardware")]);
  uguale("S13 tre tocchi ravvicinati: nessuno si perde, nessuno si ripete", await S.leggiSeguiti(), ["hardware", "ia"]);
  const u = await A.leggiPercorso();
  const pr = P.progetti(u, await S.leggiSeguiti());
  uguale("S13 due progetti fuori dall'ordine del piano: hardware (T5) e IA (T3), nessuno dei due è SQL",
    pr.map((x) => [x.unita.tema.slug, x.passo !== null, x.subentrata]), [["hardware", true, false], ["ia", true, false]]);
  ok("S13 le unità dei progetti portano l'area, che serve a trovare il seguito",
    pr.every((x) => x.unita.tema.pista === (x.unita.tema.slug === "ia" ? "ia" : "hardware")));
  await S.smettiDiSeguire("hardware");
  uguale("S13 smettere toglie solo quel tema", await S.leggiSeguiti(), ["ia"]);
  await S.smettiDiSeguire("ia");
  await S.ricordaSubentrate({ sql_base: "sql_agg" });
  await S.ricordaSubentrate({ sql_base: "sql_agg" });
  uguale("S13 il ricordo dei seguiti si rilegge com'è stato scritto", await S.leggiSubentrate(), { sql_base: "sql_agg" });
  await S.ricordaSubentrate({});
}

uguale("S8 nessun tentativo di rete", reteTentata, []);

// ============================================================ TETTO
// Il riquadro in alto di Esercizi e Codice: a tastiera chiusa il tetto, a
// tastiera aperta quanto resta al campo di scrittura, mai meno di due righe.
{
  const T = await import("../../lib/tetto.ts");
  uguale("T1 tastiera chiusa, telefono alto: il tetto pieno", T.tettoRiquadro(800, 0, 220, 0.3, 280), 220);
  uguale("T1 tastiera chiusa, schermo diviso: una frazione della finestra", T.tettoRiquadro(376, 0, 220, 0.3, 280), 113);
  uguale("T2 tastiera aperta su un telefono alto: si stringe solo quanto serve", T.tettoRiquadro(851, 300, 220, 0.3, 280), 220);
  uguale("T2 tastiera aperta su un telefono basso: resta lo spazio per l'editor", T.tettoRiquadro(700, 300, 220, 0.3, 280), 120);
  uguale("T3 mai meno di 72 dp", T.tettoRiquadro(640, 308, 300, 0.35, 260), 72);
}

// ============================================================ SORGENTI
// Tre difetti trovati in revisione che nessun banco può esercitare, perché
// vivono nella navigazione e nell'impaginazione: qui si guarda che la forma
// corretta resti nel sorgente.
const { readFileSync } = await import("node:fs");
const sorgente = (f) => readFileSync(join(RADICE_PROGETTO, f), "utf8");
{
  const unita = sorgente("app/unita.tsx");
  ok("S9 dall'unità Note e Libreria si raggiungono con dismissTo, mai aggiungendo schede alla pila",
    unita.includes("router.dismissTo(") &&
    !/router\.(navigate|push)\(\s*[`"(]\/(note|libreria)/.test(unita) &&
    !/router\.navigate\(/.test(unita));
  const note = sorgente("app/(tabs)/note.tsx");
  ok("S9 Note salva anche alla perdita del fuoco e in background, non solo allo smontaggio",
    /useFocusEffect\(useCallback\(\(\) => \(\) => \{ void salvaUscendo\.current\(\); \}, \[\]\)\)/.test(note) &&
    /stato === "background"\) void salvaUscendo\.current\(\)/.test(note));
  for (const [f, tetto] of [["app/esercizi.tsx", 220], ["app/codice.tsx", 300]]) {
    const t = sorgente(f);
    ok(`S9 ${f}: sul telefono il riquadro in alto non ha flex:1 dentro il tetto di ${tetto} dp`,
      t.includes(`maxHeight: tettoRiquadro(height, tastiera, ${tetto}, `) &&
      /affiancato \? \{ flex: 1[^}]*\} : \{ flexGrow: 0, flexShrink: 1/.test(t));
  }
  // Il «di N» e i numeri delle unità vengono da lib/percorso.ts: contati
  // nella schermata, divergevano (P4b e S10 provano la funzione, non il
  // componente).
  ok("S11 il «di N» di Oggi si conta con unitaConVerifiche() di lib/percorso.ts",
    sorgente("components/ProssimoPasso.tsx").includes("conVerifiche: unitaConVerifiche(unita),"));
  // Un'unità di sola lettura ha posizione null, e null è un figlio valido per
  // React: né tsc né il banco vedrebbero una cella vuota in Studio o
  // «Unità  · T0» nell'intestazione.
  ok("S12 Studio mette «·» al posto del numero che non c'è",
    sorgente("app/(tabs)/studio.tsx").includes('{u.stato === "completa" ? "✓" : u.posizione ?? "·"}'));
  ok("S12 l'intestazione dell'unità dice «Unità N» solo se il numero c'è",
    sorgente("app/unita.tsx").includes('{u.posizione !== null ? `Unità ${u.posizione} · ` : ""}') &&
    !/Unità \{u\.posizione\}/.test(sorgente("app/unita.tsx")));
  // I progetti vivono in tre schermate che il banco non disegna.
  const pp = sorgente("components/ProssimoPasso.tsx");
  ok("S14 il passo del piano si presenta come piano anche con dei temi seguiti, e l'intestazione conta solo i progetti aperti",
    pp.includes("dalPiano: v.progetto === null,") && pp.includes("{v.dalPiano\n") &&
    pp.includes("const aperti = s.voci.filter((v) => !v.dalPiano).length;") && !pp.includes("{s.seguiti\n"));
  ok("S14 il seguito non si chiama «il tema dopo»: può essere un tema rimasto indietro",
    pp.includes("è superato: si continua con un altro tema della sua area.") && !pp.includes("il tema dopo."));
  ok("S14 Oggi, Studio e le Notizie decidono che cosa fare con la stessa regola, daFare()",
    pp.includes("daFare(unita, seguiti, precedenti).map(") &&
    sorgente("app/(tabs)/studio.tsx").includes("const correnti = new Set(daFare(unita, seguiti, precedenti).map((v) => v.unita.tema.slug));") &&
    sorgente("app/(tabs)/notizie.tsx").includes("return areePerTe(daFare(unita, seguiti, precedenti).map((v) => v.unita.tema.slug));") &&
    ![pp, sorgente("app/(tabs)/studio.tsx"), sorgente("app/(tabs)/notizie.tsx")].some((t) => /prossimoPasso(Di)?\(unita\)/.test(t)));
  const un = sorgente("app/unita.tsx");
  // Notizie è la quinta scheda, Profilo si apre da Oggi.
  const schede = sorgente("app/(tabs)/_layout.tsx");
  const nomi = [...schede.matchAll(/<Tabs\.Screen name="([a-z]+)"/g)].map((m) => m[1]);
  uguale("S15 le cinque schede, con Notizie al posto di Profilo", nomi, ["oggi", "studio", "libreria", "note", "notizie"]);
  const { existsSync } = await import("node:fs");
  ok("S15 Profilo resta una rotta (/profilo, anche per il collegamento del test di fumo), fuori dalle schede",
    existsSync(join(RADICE_PROGETTO, "app/profilo.tsx")) && !existsSync(join(RADICE_PROGETTO, "app/(tabs)/profilo.tsx")));
  ok("S15 nessun testo a schermo nomina più la schermata Rassegna, che non c'è",
    !sorgente("app/articolo.tsx").includes("‹ Rassegna") &&
    P.descriviPasso({ tipo: "rassegna", fatto: 0, totale: 3, soglia: 0, completo: false, conta: false, eseguibile: true }).dettaglio.includes("nelle Notizie"));
  ok("S15 Profilo aperto ad app chiusa, senza niente sotto, torna a Oggi",
    sorgente("app/profilo.tsx").includes('router.canGoBack() ? router.back() : router.replace("/oggi")'));
  ok("S15 da Oggi si aprono Profilo e le Notizie",
    sorgente("app/(tabs)/oggi.tsx").includes('router.push("/profilo")') && sorgente("app/(tabs)/oggi.tsx").includes('router.push("/notizie?categoria=titoli")'));
  ok("S15 dall'unità alle Notizie si torna alla scheda, non se ne impila una seconda",
    un.includes('if (d === "/libreria" || d.startsWith("/notizie")) apriScheda(d);'));
  ok("S14 seguire non rilegge la schermata dal fuoco, e non abbassa la guardia dello scenario",
    un.includes("  }, [slug]));") && !un.includes("versione") && un.includes("setTuttiProgetti(progetti(tutte, seg, precedenti));"));
  ok("S14 Oggi e Studio ricordano chi ha quale seguito, e tutte le schermate ne tengono conto",
    pp.includes("void ricordaSubentrate(subentrate(tutti));") && pp.includes("progetti(unita, seguiti, precedenti)") &&
    un.includes("progetti(percorso, seg, prec)"));
  ok("S14 su un'unità subentrata si nomina il tema scelto che la tiene, e «Smetti» toglie quello",
    un.includes("`«${nomeDi(progettoQui.seguito)}» è superato: il progetto continua qui.`") && un.includes("Smetti di seguirlo"));
  ok("S14 dall'unità si segue e si smette di seguire",
    un.includes("cambiaSeguito(() => segui(slug))") && un.includes("cambiaSeguito(() => smettiDiSeguire(progettoQui.seguito))"));
}

console.log(`\nsimulazione percorso (lib/percorso.ts, lib/avanzamento.ts)`);
for (const f of falliti) console.log("  ✗ " + f);
console.log(`passati ${passate}, falliti ${falliti.length}`);
process.exit(falliti.length ? 1 : 0);
