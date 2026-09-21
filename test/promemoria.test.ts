declare const process: { exit(code: number): never };
import {
  PREDEFINITO, Promemoria, oraValida, tipoValido, comeTesto, daTesto,
  serializza, deserializza, prossimaOccorrenza, giaFattoOggi, testoNotifica,
} from "../lib/promemoria";

let passati = 0;
const falliti: string[] = [];
function ok(n: string, c: boolean, e = "") { if (c) passati++; else falliti.push(`${n} ${e}`); }

const acceso = (o: number, m: number): Promemoria => ({ attivo: true, ora: o, minuto: m, tipo: "mattina" });

// ------------------------------------------------ predefinito
{
  ok("predefinito: spento", PREDEFINITO.attivo === false);
  ok("predefinito: ora valida", oraValida(PREDEFINITO.ora, PREDEFINITO.minuto));
  ok("predefinito: tipo valido", tipoValido(PREDEFINITO.tipo));
}

// ------------------------------------------------ validazione dell'ora
{
  ok("ora: mezzanotte valida", oraValida(0, 0));
  ok("ora: 23:59 valida", oraValida(23, 59));
  ok("ora: 24 rifiutata", !oraValida(24, 0));
  ok("ora: minuto 60 rifiutato", !oraValida(7, 60));
  ok("ora: negativa rifiutata", !oraValida(-1, 0));
  ok("ora: frazionaria rifiutata", !oraValida(7.5, 0));
}

// ------------------------------------------------ testo dell'ora
{
  ok("testo: zero iniziale", comeTesto(acceso(7, 5)) === "07:05");
  ok("testo: mezzogiorno", comeTesto(acceso(12, 30)) === "12:30");

  ok("lettura: forma canonica", JSON.stringify(daTesto("07:30")) === JSON.stringify({ ora: 7, minuto: 30 }));
  ok("lettura: senza zero iniziale", JSON.stringify(daTesto("7:30")) === JSON.stringify({ ora: 7, minuto: 30 }));
  ok("lettura: senza separatore", JSON.stringify(daTesto("0730")) === JSON.stringify({ ora: 7, minuto: 30 }));
  ok("lettura: con punto", JSON.stringify(daTesto("7.30")) === JSON.stringify({ ora: 7, minuto: 30 }));
  ok("lettura: spazi tollerati", JSON.stringify(daTesto("  07:30 ")) === JSON.stringify({ ora: 7, minuto: 30 }));
  ok("lettura: ora impossibile rifiutata", daTesto("25:00") === null);
  ok("lettura: minuto impossibile rifiutato", daTesto("07:99") === null);
  ok("lettura: testo libero rifiutato", daTesto("mattina") === null);
  ok("lettura: vuoto rifiutato", daTesto("") === null);
}

// ------------------------------------------------ persistenza
{
  const p = { attivo: true, ora: 6, minuto: 45, tipo: "lettura" } as Promemoria;
  ok("persistenza: andata e ritorno", JSON.stringify(deserializza(serializza(p))) === JSON.stringify(p));

  ok("persistenza: assente dà il predefinito",
     JSON.stringify(deserializza(null)) === JSON.stringify(PREDEFINITO));
  ok("persistenza: illeggibile dà il predefinito",
     JSON.stringify(deserializza("{non json")) === JSON.stringify(PREDEFINITO));
  ok("persistenza: non oggetto dà il predefinito",
     JSON.stringify(deserializza("42")) === JSON.stringify(PREDEFINITO));
  ok("persistenza: ora fuori scala ricade sul predefinito",
     deserializza('{"attivo":true,"ora":99,"minuto":0,"tipo":"mattina"}').ora === PREDEFINITO.ora);
  ok("persistenza: tipo ignoto ricade sul predefinito",
     deserializza('{"attivo":true,"ora":7,"minuto":0,"tipo":"inventato"}').tipo === PREDEFINITO.tipo);
  ok("persistenza: attivo solo se esattamente true",
     deserializza('{"attivo":"si","ora":7,"minuto":0,"tipo":"mattina"}').attivo === false);
  // Una versione futura che aggiunge campi non deve spegnere il promemoria.
  ok("persistenza: campi ignoti non disturbano",
     deserializza('{"attivo":true,"ora":8,"minuto":15,"tipo":"mattina","nuovo":1}').ora === 8);
}

// ------------------------------------------------ prossima occorrenza
{
  ok("prossima: spento non programma", prossimaOccorrenza({ ...PREDEFINITO }, new Date("2026-10-05T06:00:00")) === null);

  const mattina = prossimaOccorrenza(acceso(7, 0), new Date("2026-10-05T06:00:00"));
  ok("prossima: oggi se l'ora non è passata",
     mattina !== null && mattina.getDate() === 5 && mattina.getHours() === 7 && mattina.getMinutes() === 0);

  const domani = prossimaOccorrenza(acceso(7, 0), new Date("2026-10-05T08:00:00"));
  ok("prossima: domani se l'ora è passata",
     domani !== null && domani.getDate() === 6 && domani.getHours() === 7);

  // Al minuto esatto si passa al giorno dopo: altrimenti il sistema
  // programmerebbe un avviso per un istante già trascorso.
  const esatto = prossimaOccorrenza(acceso(7, 0), new Date("2026-10-05T07:00:00"));
  ok("prossima: all'ora esatta va al giorno dopo", esatto !== null && esatto.getDate() === 6);

  const fineMese = prossimaOccorrenza(acceso(7, 0), new Date("2026-10-31T09:00:00"));
  ok("prossima: attraversa il cambio di mese",
     fineMese !== null && fineMese.getMonth() === 10 && fineMese.getDate() === 1);

  const secondi = prossimaOccorrenza(acceso(7, 0), new Date("2026-10-05T06:59:59"));
  ok("prossima: secondi azzerati", secondi !== null && secondi.getSeconds() === 0 && secondi.getMilliseconds() === 0);
}

// ------------------------------------------------ blocco già fatto oggi
{
  const adesso = new Date("2026-10-05T09:00:00");
  const p = acceso(7, 0);

  ok("fatto: sessione di stamattina riconosciuta",
     giaFattoOggi(p, ["2026-10-05T07:10:00"], adesso));
  ok("fatto: sessione di ieri non conta",
     !giaFattoOggi(p, ["2026-10-04T07:10:00"], adesso));
  ok("fatto: nessuna sessione",
     !giaFattoOggi(p, [], adesso));
  ok("fatto: data illeggibile ignorata",
     !giaFattoOggi(p, ["non una data"], adesso));
  // Una sessione registrata più tardi oggi non è ancora avvenuta al momento
  // del controllo: non deve far credere che il blocco sia chiuso.
  ok("fatto: sessione nel futuro di oggi non conta",
     !giaFattoOggi(p, ["2026-10-05T23:00:00"], adesso));
  ok("fatto: fra più sessioni basta quella di oggi",
     giaFattoOggi(p, ["2026-10-01T07:00:00", "2026-10-05T08:00:00"], adesso));
}

// ------------------------------------------------ testo della notifica
{
  const t = testoNotifica(acceso(7, 0));
  ok("notifica: titolo del blocco", t.titolo === "Blocco del mattino");
  ok("notifica: corpo con la durata prevista", t.corpo.startsWith("30 minuti"));

  const r = testoNotifica({ attivo: true, ora: 20, minuto: 0, tipo: "ripasso" });
  ok("notifica: titolo per il ripasso", r.titolo === "Ripasso");
  // Corpo breve: sullo schermo bloccato Android ne mostra una riga sola.
  ok("notifica: corpo breve", r.corpo.length <= 80);
}

console.log(`Test superati : ${passati}`);
console.log(`Falliti       : ${falliti.length}`);
for (const f of falliti) console.log(`  FALLITO: ${f}`);
process.exit(falliti.length ? 1 : 0);
