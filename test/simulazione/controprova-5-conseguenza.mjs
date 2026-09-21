/**
 * Controprova avversariale al difetto "colonne omonime in un JOIN".
 *
 * PERCHE' COSI': lib/palestra.ts non e' caricabile fuori dall'emulatore (require di un
 * asset .db, expo-file-system), quindi qui si RICOPIA alla lettera il corpo di esegui()
 * (palestra.ts:59-63) sopra node:sqlite, con la stessa composizione riga->oggetto che fa
 * expo (paramUtils.js:40-50, `row[nome[i]] = valori[i]`). Il motore di verifica invece e'
 * quello VERO, importato dal file dell'app.
 *
 * Comando: node --import ./test/banco/carica.mjs test/simulazione/controprova-5-conseguenza.mjs
 */
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { importaApp } from "../banco/carica.mjs";

const V = await importaApp("lib/verifica.ts");
const base = new DatabaseSync("/home/user/learning_app/assets/contenuti/palestra.db", { readOnly: true });

/** Il composeRow di expo: l'omonimo che arriva dopo sovrascrive quello prima. */
function componiRighe(nomi, valori) {
  return valori.map((v) => {
    const riga = {};
    for (let i = 0; i < nomi.length; i++) riga[nomi[i]] = v[i];
    return riga;
  });
}

/** Copia fedele di esegui() di lib/palestra.ts. */
async function esegui(sql) {
  const p = base.prepare(sql);
  const nomi = p.columns().map((c) => c.column ?? c.name);
  const grezze = p.all();            // node:sqlite compone gli oggetti come expo
  const righe = grezze;
  const colonne = righe.length ? Object.keys(righe[0]) : [];
  return { colonne, righe: righe.map((r) => colonne.map((c) => r[c])), _nomiVeri: nomi };
}

let ko = 0;
const dice = (t, c) => { console.log((c ? "  ok   " : "  FALLITO ") + t); if (!c) ko++; };

// ---------------------------------------------------------------- 1. il meccanismo
const r = await esegui(
  "SELECT s.id, v.id FROM strutture s JOIN visite v ON v.struttura_id = s.id ORDER BY v.id LIMIT 3"
);
console.log("\n1. DUE COLONNE OMONIME, LETTE DAL MOTORE");
console.log("   nomi veri dal motore :", JSON.stringify(r._nomiVeri));
console.log("   colonne di esegui()  :", JSON.stringify(r.colonne));
console.log("   righe di esegui()    :", JSON.stringify(r.righe));
dice("il motore restituisce 2 colonne", r._nomiVeri.length === 2);
dice("esegui() ne restituisce 1: l'omonima e' collassata", r.colonne.length === 1);
dice("sopravvive il valore dell'ULTIMA (v.id)", r.righe[1][0] === 2);

// ------------------------------------------------ 2. i contenuti veri: SQL-138 e SQL-134
const esercizi = JSON.parse(
  readFileSync("/home/user/learning_app/assets/contenuti/esercizi_sql.json", "utf8")
);
const perId = new Map(esercizi.map((e) => [e.id, e]));

const casi = [
  {
    id: "SQL-138",
    risposta:
      "SELECT a.nome, b.nome, a.paese, a.tipo\nFROM strutture a JOIN strutture b\n  ON a.paese = b.paese AND a.tipo = b.tipo AND a.id < b.id\nORDER BY a.paese, a.tipo LIMIT 50;",
  },
  {
    id: "SQL-134",
    risposta:
      "SELECT si.nome, pr.nome, si.popolazione_stimata\nFROM siti si JOIN progetti pr ON pr.id = si.progetto_id\nWHERE NOT EXISTS (SELECT 1 FROM distribuzioni d WHERE d.sito_id = si.id)\nORDER BY si.popolazione_stimata DESC;",
  },
];

console.log("\n2. CONTENUTI VERI: la stessa query con e senza alias di colonna");
for (const c of casi) {
  const e = perId.get(c.id);
  const ordine = V.ordineRilevante(e.consegna, e.soluzione);
  const esito = await V.verifica(esegui, c.risposta, e.soluzione, { ordineRilevante: ordine });
  const conAlias = await V.verifica(esegui, e.soluzione, e.soluzione, { ordineRilevante: ordine });
  console.log(`\n   ${c.id} — "${e.consegna}"`);
  console.log(`   consegna nomina i nomi delle colonne? ${
    e.colonne_attese.some((n) => e.consegna.toLowerCase().includes(n.toLowerCase())) ? "SI" : "NO"
  }  (attese: ${e.colonne_attese.join(", ")})`);
  console.log(`   ordineRilevante=${ordine}`);
  console.log(`   risposta identica al riferimento -> corretto=${conAlias.corretto} (${conAlias.motivo})`);
  console.log(`   stessa query SENZA alias         -> corretto=${esito.corretto} (${esito.motivo}) "${esito.dettaglio}"`);
  dice(`${c.id}: il riferimento passa`, conAlias.corretto === true);
  dice(`${c.id}: la risposta equivalente senza alias e' BOCCIATA`, esito.corretto === false);
}

// -------------------------------------------- 3. quanto e' diffuso sui 150 esercizi veri
console.log("\n3. AMPIEZZA SUI 150 ESERCIZI VERI");
let riferimentiCollassati = 0, riferimentiEseguibili = 0, esposti = 0;
const espostiId = [];
for (const e of esercizi) {
  if (e.preparazione) continue;
  let res;
  try { res = await esegui(e.soluzione); } catch { continue; }
  riferimentiEseguibili++;
  if (res.colonne.length !== res._nomiVeri.length) riferimentiCollassati++;
  // "esposto" = il riferimento usa un AS su una colonna il cui nome nudo e' gia' presente
  const nudi = (e.soluzione.match(/\b\w+\.(\w+)\s*(?:AS\s+\w+)?/gi) || []);
  if (/\bAS\s+\w+/i.test(e.soluzione) && /JOIN/i.test(e.soluzione)) {
    const senzaAlias = e.soluzione.replace(/\s+AS\s+\w+/gi, "");
    try {
      const r2 = await esegui(senzaAlias);
      if (r2.colonne.length < res.colonne.length) { esposti++; espostiId.push(e.id); }
    } catch { /* la rimozione degli alias puo' rompere l'ORDER BY: non e' un caso esposto */ }
  }
}
console.log(`   soluzioni di riferimento eseguibili: ${riferimentiEseguibili}`);
console.log(`   riferimenti che collassano da soli : ${riferimentiCollassati}`);
console.log(`   esercizi dove togliere gli alias fa perdere colonne: ${esposti} -> ${espostiId.join(", ")}`);
dice("nessun riferimento collassa da solo (l'app non e' rotta in partenza)", riferimentiCollassati === 0);
dice("almeno un esercizio vero e' esposto", esposti >= 1);

console.log(`\n${ko === 0 ? "TUTTE VERDI" : ko + " ROSSE"}`);
