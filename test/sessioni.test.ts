declare const process: { exit(code: number): never };
import { chiudiSessione, riepilogoSettimana, inizioSettimana, settimaneConsecutiveSottoMinimo, Sessione } from "../lib/sessioni";

let passati = 0;
const falliti: string[] = [];
function ok(n: string, c: boolean, e = "") { if (c) passati++; else falliti.push(`${n} ${e}`); }
const MIN = 60_000;

// ------------------------------------------------ chiusura del cronometro
{
  const t0 = new Date("2026-10-05T07:00:00").getTime();
  const r = chiudiSessione(t0, t0 + 30 * MIN, "mattina");
  ok("chiusura: blocco regolare", r.valida && r.minuti === 30 && !r.avviso);

  ok("chiusura: sotto i 5 minuti rifiutata", !chiudiSessione(t0, t0 + 3 * MIN, "mattina").valida);
  ok("chiusura: fine prima dell'inizio rifiutata", !chiudiSessione(t0, t0 - MIN, "mattina").valida);

  const dimenticato = chiudiSessione(t0, t0 + 9 * 60 * MIN, "lettura");
  ok("chiusura: cronometro dimenticato ridotto alla durata prevista",
     dimenticato.valida && dimenticato.minuti === 25 && Boolean(dimenticato.avviso));

  const lungo = chiudiSessione(t0, t0 + 70 * MIN, "mattina");
  ok("chiusura: blocco lungo registrato con avviso",
     lungo.valida && lungo.minuti === 70 && Boolean(lungo.avviso));
}

// ------------------------------------------------ settimana
{
  const lunedi = inizioSettimana(new Date("2026-10-08T15:00:00")); // giovedì
  ok("settimana: parte dal lunedì", lunedi.getDay() === 1 && lunedi.getHours() === 0);

  const s: Sessione[] = [
    { inizio: "2026-10-05T07:00:00", minuti: 30, tipo: "mattina" },
    { inizio: "2026-10-06T07:00:00", minuti: 30, tipo: "mattina" },
    { inizio: "2026-10-06T22:00:00", minuti: 25, tipo: "lettura" },
    { inizio: "2026-10-07T13:00:00", minuti: 45, tipo: "artefatto" },
    { inizio: "2026-09-28T07:00:00", minuti: 300, tipo: "mattina" }, // settimana precedente
  ];
  const r = riepilogoSettimana(s, new Date("2026-10-08T12:00:00"));
  ok("settimana: esclude la settimana precedente", r.minuti === 130, String(r.minuti));
  ok("settimana: somma per tipo", r.perTipo.mattina === 60 && r.perTipo.lettura === 25);
  ok("settimana: livello sopravvivenza sotto le 5 h", r.livello === "sopravvivenza");
  ok("settimana: calcola quanto manca", r.mancanoAlBase === 170);
  ok("settimana: 130 minuti non è sotto il minimo di 2 h", !r.sottoMinimo);

  const piena: Sessione[] = Array.from({ length: 11 }, (_, i) => ({
    inizio: `2026-10-0${5 + (i % 5)}T07:00:00`, minuti: 30, tipo: "mattina" as const,
  }));
  ok("settimana: 5,5 h è livello base", riepilogoSettimana(piena, new Date("2026-10-08")).livello === "base");
}

// ------------------------------------------------ regola delle tre settimane
{
  const oggi = new Date("2026-11-02T12:00:00");
  const vuote: Sessione[] = [];
  ok("tre settimane: nessuna sessione = serie lunga",
     settimaneConsecutiveSottoMinimo(vuote, oggi) >= 3);

  const conUnaBuona: Sessione[] = [
    { inizio: "2026-10-27T07:00:00", minuti: 150, tipo: "mattina" }, // settimana scorsa ok
  ];
  ok("tre settimane: una settimana valida interrompe la serie",
     settimaneConsecutiveSottoMinimo(conUnaBuona, oggi) === 0);
}

console.log(`Test superati : ${passati}`);
console.log(`Falliti       : ${falliti.length}`);
for (const f of falliti) console.log("  FALLITO " + f);
process.exit(falliti.length ? 1 : 0);
