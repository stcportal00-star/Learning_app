declare const process: { exit(code: number): never };

import { Orologio, serializza, deserializza, confronta } from "../lib/hlc";
import { verifica, ordineRilevante, Riga } from "../lib/verifica";

let passati = 0;
const falliti: string[] = [];
function ok(nome: string, condizione: boolean, extra = "") {
  if (condizione) passati++;
  else falliti.push(`${nome} ${extra}`);
}

// ---------------------------------------------------------------- HLC
{
  const o = new Orologio("aaaa");
  const a = o.adesso(1000);
  const b = o.adesso(1000); // stesso millisecondo
  ok("HLC contatore avanza nello stesso ms", b.contatore === a.contatore + 1);

  const c = o.adesso(999); // orologio di sistema torna indietro
  ok("HLC non torna mai indietro", c.ms >= b.ms, `${c.ms} < ${b.ms}`);

  const d = o.adesso(2000);
  ok("HLC azzera il contatore al nuovo ms", d.ms === 2000 && d.contatore === 0);

  // ordinamento lessicografico coerente con il confronto numerico
  const serie = [o.adesso(3000), o.adesso(3000), o.adesso(4000), o.adesso(4000)];
  const perStringa = serie.map(serializza).sort();
  const perConfronto = [...serie].sort(confronta).map(serializza);
  ok("HLC ordinabile come stringa", JSON.stringify(perStringa) === JSON.stringify(perConfronto));

  const round = deserializza(serializza(serie[0]));
  ok("HLC round-trip", round.ms === serie[0].ms && round.contatore === serie[0].contatore &&
     round.dispositivo === serie[0].dispositivo);
}

// -------------------------------------- fusione fra due dispositivi (volo)
{
  // Tablet a Roma, telefono ancora su fuso messicano: 7 ore di differenza.
  const tablet = new Orologio("tab1");
  const telefono = new Orologio("tel2");

  const eTablet = tablet.adesso(1_700_000_000_000);
  const eTelefono = telefono.adesso(1_700_000_000_000 - 7 * 3600 * 1000);

  // il tablet riceve l'evento del telefono, molto più "vecchio"
  const dopo = tablet.ricevi(eTelefono, 1_700_000_000_001);
  ok("fusione: l'orologio non regredisce", dopo.ms >= eTablet.ms, `${dopo.ms} < ${eTablet.ms}`);
  ok("fusione: deriva rilevata", tablet.derivaSospetta);

  // il telefono riceve l'evento del tablet, molto più "avanti"
  const dopo2 = telefono.ricevi(eTablet, 1_700_000_000_000 - 7 * 3600 * 1000);
  ok("fusione: assorbe il tempo remoto", dopo2.ms === eTablet.ms);

  // nessun evento collide
  const tutti = [eTablet, eTelefono, dopo, dopo2].map(serializza);
  ok("fusione: nessun timbro duplicato", new Set(tutti).size === tutti.length);
}

// ------------------------------------------------------- motore di verifica
function esecutoreFinto(mappa: Record<string, { colonne: string[]; righe: Riga[] }>) {
  return async (sql: string) => {
    const k = sql.trim();
    if (!(k in mappa)) throw new Error("near syntax error");
    return mappa[k];
  };
}

(async () => {
  const rif = { colonne: ["paese", "n"], righe: [["Yemen", 10], ["Haiti", 5]] as Riga[] };

  // 1. query diversa, stesso risultato nello stesso ordine
  {
    const e = await verifica(
      esecutoreFinto({ A: rif, B: rif }), "A", "B", { ordineRilevante: true });
    ok("verifica: risultato identico passa", e.corretto && e.motivo === "identico");
  }

  // 2. stesse righe, ordine diverso, ordine NON richiesto
  {
    const invertito = { colonne: rif.colonne, righe: [...rif.righe].reverse() };
    const e = await verifica(
      esecutoreFinto({ A: invertito, B: rif }), "A", "B", { ordineRilevante: false });
    ok("verifica: ordine irrilevante passa", e.corretto && e.motivo === "identico_a_meno_dell_ordine");
  }

  // 3. stesse righe, ordine diverso, ordine RICHIESTO
  {
    const invertito = { colonne: rif.colonne, righe: [...rif.righe].reverse() };
    const e = await verifica(
      esecutoreFinto({ A: invertito, B: rif }), "A", "B", { ordineRilevante: true });
    ok("verifica: ordine richiesto non passa", !e.corretto, e.motivo);
  }

  // 4. numero di righe diverso
  {
    const corto = { colonne: rif.colonne, righe: [rif.righe[0]] };
    const e = await verifica(esecutoreFinto({ A: corto, B: rif }), "A", "B");
    ok("verifica: righe diverse", !e.corretto && e.motivo === "righe_diverse");
  }

  // 5. numero di colonne diverso
  {
    const largo = { colonne: ["paese", "n", "extra"], righe: [["Yemen", 10, 1], ["Haiti", 5, 2]] as Riga[] };
    const e = await verifica(esecutoreFinto({ A: largo, B: rif }), "A", "B");
    ok("verifica: colonne diverse", !e.corretto && e.motivo === "colonne_diverse");
  }

  // 6. errore di sintassi nella risposta
  {
    const e = await verifica(esecutoreFinto({ B: rif }), "SELEC *", "B");
    ok("verifica: errore SQL gestito", !e.corretto && e.motivo === "errore_sql");
  }

  // 7. differenza solo nei decimali oltre la sesta cifra: deve passare
  {
    const quasi = { colonne: ["v"], righe: [[0.1 + 0.2]] as Riga[] };
    const esatto = { colonne: ["v"], righe: [[0.3]] as Riga[] };
    const e = await verifica(esecutoreFinto({ A: quasi, B: esatto }), "A", "B");
    ok("verifica: tolleranza sui float", e.corretto, e.dettaglio);
  }

  // 8. NULL distinto da stringa vuota
  {
    const conNull = { colonne: ["v"], righe: [[null]] as Riga[] };
    const conVuoto = { colonne: ["v"], righe: [[""]] as Riga[] };
    const e = await verifica(esecutoreFinto({ A: conNull, B: conVuoto }), "A", "B");
    ok("verifica: NULL diverso da stringa vuota", !e.corretto);
  }

  // 9. euristica sull'ordine
  ok("euristica: rileva 'ordinate per'", ordineRilevante("Elenca le strutture ordinate per nome", "select 1"));
  ok("euristica: rileva LIMIT", ordineRilevante("Mostra alcune righe", "select * from t limit 10"));
  ok("euristica: non si attiva su consegna neutra",
     !ordineRilevante("Conta i pazienti per sesso", "select sesso, count(*) from p group by sesso"));

  console.log(`Test superati : ${passati}`);
  console.log(`Falliti       : ${falliti.length}`);
  for (const f of falliti) console.log("  FALLITO " + f);
  process.exit(falliti.length ? 1 : 0);
})();
