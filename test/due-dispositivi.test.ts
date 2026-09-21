declare const process: { exit(code: number): never };

import { generaAccoppiamento, leggiAccoppiamento, normalizza, passphraseDa } from "../lib/sync/accoppiamento";
import { decidi, valutaDivergenza, attesaBackoff, trasportiUtilizzabili, StatoSync } from "../lib/sync/auto";
import { cifra, decifra, impacchetta } from "../lib/sync/pacchetto";

let passati = 0;
const falliti: string[] = [];
function ok(n: string, c: boolean, e = "") { if (c) passati++; else falliti.push(`${n} ${e}`); }

const base: StatoSync = {
  inSospeso: 0, daUltimoScambioMs: 0, inPrimoPiano: true,
  accoppiato: true, inCorso: false, fallimentiConsecutivi: 0, batteriaBassa: false,
};
const con = (p: Partial<StatoSync>): StatoSync => ({ ...base, ...p });

(async () => {
  // -------------------------------------------------- accoppiamento
  {
    const a = generaAccoppiamento();
    ok("accoppiamento: codice raggruppato", a.codice.includes("-"));
    const letto = leggiAccoppiamento(a.codice);
    ok("accoppiamento: round-trip", letto.segreto === a.segreto);

    // trascrizione con spazi, minuscole e senza trattini
    const sporco = a.codice.toLowerCase().replace(/-/g, " ");
    ok("accoppiamento: tollera spazi e minuscole", leggiAccoppiamento(sporco).segreto === a.segreto);

    // confusioni tipiche: I→1, O→0, L→1
    ok("accoppiamento: normalizza I/L/O", normalizza("I0L-O1") === "101-01".replace("-", ""),
       normalizza("I0L-O1"));

    // un carattere sbagliato deve essere intercettato dal checksum
    let intercettati = 0;
    const tentativi = 40;
    for (let i = 0; i < tentativi; i++) {
      const g = generaAccoppiamento();
      const grezzo = normalizza(g.codice);
      const pos = i % (grezzo.length - 1);
      const alfabeto = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
      const nuovo = alfabeto[(alfabeto.indexOf(grezzo[pos]) + 7) % 32];
      const alterato = grezzo.slice(0, pos) + nuovo + grezzo.slice(pos + 1);
      try { leggiAccoppiamento(alterato); } catch { intercettati++; }
    }
    ok("accoppiamento: rileva l'errore di battitura", intercettati >= tentativi * 0.9,
       `${intercettati}/${tentativi}`);

    // la passphrase derivata apre davvero un pacchetto
    const p = impacchetta("tab1", []);
    const involucro = await cifra(p, passphraseDa(a));
    const tornato = await decifra(involucro, passphraseDa(letto));
    ok("accoppiamento: la passphrase derivata funziona", tornato.dispositivo === "tab1");

    const altro = generaAccoppiamento();
    try {
      await decifra(involucro, passphraseDa(altro));
      ok("accoppiamento: un altro segreto non apre", false);
    } catch { ok("accoppiamento: un altro segreto non apre", true); }
  }

  // -------------------------------------------------- politica automatica
  {
    ok("auto: non tenta senza accoppiamento", !decidi(con({ accoppiato: false })).tenta);
    ok("auto: non tenta in secondo piano", !decidi(con({ inPrimoPiano: false, inSospeso: 50 })).tenta);
    ok("auto: non tenta se già in corso", !decidi(con({ inCorso: true, inSospeso: 50 })).tenta);

    const primo = decidi(con({ daUltimoScambioMs: null }));
    ok("auto: primo scambio è urgente", primo.tenta && primo.urgenza === "alta");

    ok("auto: non ripete uno scambio appena fatto",
       !decidi(con({ inSospeso: 3, daUltimoScambioMs: 10_000 })).tenta);

    const molti = decidi(con({ inSospeso: 40, daUltimoScambioMs: 120_000 }));
    ok("auto: molti eventi in sospeso forzano lo scambio", molti.tenta && molti.urgenza === "alta");

    const periodico = decidi(con({ inSospeso: 2, daUltimoScambioMs: 20 * 60_000 }));
    ok("auto: scambio periodico con pochi eventi", periodico.tenta && periodico.urgenza === "normale");

    const ritiro = decidi(con({ inSospeso: 0, daUltimoScambioMs: 20 * 60_000 }));
    ok("auto: va a ritirare anche senza eventi propri", ritiro.tenta);

    ok("auto: batteria bassa blocca gli scambi piccoli",
       !decidi(con({ batteriaBassa: true, inSospeso: 3, daUltimoScambioMs: 20 * 60_000 })).tenta);
    ok("auto: batteria bassa non blocca uno scambio grande",
       decidi(con({ batteriaBassa: true, inSospeso: 40, daUltimoScambioMs: 20 * 60_000 })).tenta);
  }

  // -------------------------------------------------- backoff
  {
    ok("backoff: cresce", attesaBackoff(1) < attesaBackoff(3));
    ok("backoff: ha un tetto", attesaBackoff(20) === attesaBackoff(30));
    ok("backoff: blocca durante l'attesa",
       !decidi(con({ fallimentiConsecutivi: 3, daUltimoScambioMs: 1000, inSospeso: 50 })).tenta);
    ok("backoff: rilascia dopo l'attesa",
       decidi(con({ fallimentiConsecutivi: 1, daUltimoScambioMs: 5 * 60_000, inSospeso: 50 })).tenta);
  }

  // -------------------------------------------------- divergenza
  {
    ok("divergenza: allineati", valutaDivergenza(con({ inSospeso: 0, daUltimoScambioMs: 60_000 })).livello === "allineati");
    ok("divergenza: leggera", valutaDivergenza(con({ inSospeso: 5, daUltimoScambioMs: 10 * 60_000 })).livello === "leggera");

    const marcata = valutaDivergenza(con({ inSospeso: 40, daUltimoScambioMs: 30 * 60_000 }));
    ok("divergenza: marcata con molti eventi", marcata.livello === "marcata");
    ok("divergenza: avverte del rischio concreto", marcata.messaggio.includes("già fatti"));

    const mai = valutaDivergenza(con({ daUltimoScambioMs: null, inSospeso: 3 }));
    ok("divergenza: mai sincronizzato è marcata", mai.livello === "marcata");
  }

  // -------------------------------------------------- aereo
  {
    const aereo = trasportiUtilizzabili({ internet: false, bluetooth: true, wifi: true });
    ok("aereo: senza internet restano tutti e tre", aereo.length === 3 && aereo[0] === 1);

    const radioSpente = trasportiUtilizzabili({ internet: false, bluetooth: false, wifi: false });
    ok("aereo: a radio spente resta il file", radioSpente.length === 1 && radioSpente[0] === 3);

    const soloBt = trasportiUtilizzabili({ internet: false, bluetooth: true, wifi: false });
    ok("aereo: solo bluetooth dà prossimità e file",
       JSON.stringify(soloBt) === JSON.stringify([1, 3]));
  }

  console.log(`Test superati : ${passati}`);
  console.log(`Falliti       : ${falliti.length}`);
  for (const f of falliti) console.log("  FALLITO " + f);
  process.exit(falliti.length ? 1 : 0);
})();
