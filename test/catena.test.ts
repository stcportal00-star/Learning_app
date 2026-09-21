declare const process: { exit(code: number): never };

import { sincronizza, riassumi, Trasporto, StatoTrasporto, EsitoTrasferimento } from "../lib/sync/trasporto";
import { EventoSerializzato } from "../lib/sync/pacchetto";

let passati = 0;
const falliti: string[] = [];
function ok(n: string, c: boolean, e = "") { if (c) passati++; else falliti.push(`${n} ${e}`); }

function finto(
  nome: string, livello: 1 | 2 | 3,
  stato: StatoTrasporto, comportamento: "ok" | "esplode" = "ok"
): Trasporto {
  return {
    nome, livello,
    async disponibilita() { return stato; },
    async scambia(daInviare): Promise<EsitoTrasferimento> {
      if (comportamento === "esplode") throw new Error("connessione persa a metà");
      return { inviati: daInviare.length, ricevuti: [], trasporto: nome, durataMs: 12 };
    },
  };
}

const eventi: EventoSerializzato[] = [
  { id: "a", hlc: "1", dispositivo: "tab1", entita: "note", entita_id: "n1", tipo: "crea", payload: "{}" },
];

(async () => {
  // 1. tutto disponibile: vince il livello 1
  {
    const r = await sincronizza(
      [finto("file", 3, { disponibile: true }),
       finto("prossimità", 1, { disponibile: true }),
       finto("wi-fi", 2, { disponibile: true })],
      eventi, { passphrase: "x" });
    ok("catena: preferisce il livello più basso", r.esito?.trasporto === "prossimità", r.esito?.trasporto);
  }

  // 2. prossimità senza permessi, wi-fi senza modulo: scende al file
  {
    const r = await sincronizza(
      [finto("prossimità", 1, { disponibile: false, motivo: "permessi Bluetooth negati", rimediabile: true }),
       finto("wi-fi", 2, { disponibile: false, motivo: "modulo non installato", rimediabile: true }),
       finto("file", 3, { disponibile: true })],
      eventi, { passphrase: "x" });
    ok("catena: degrada fino al file", r.esito?.trasporto === "file");
    ok("catena: registra il perché di ogni salto", r.diario.length === 3);
    ok("catena: il riassunto nomina i saltati", riassumi(r.diario).includes("permessi Bluetooth negati"));
  }

  // 3. prossimità disponibile ma fallisce a metà: degrada comunque
  {
    const r = await sincronizza(
      [finto("prossimità", 1, { disponibile: true }, "esplode"),
       finto("file", 3, { disponibile: true })],
      eventi, { passphrase: "x" });
    ok("catena: un fallimento in corsa non blocca", r.esito?.trasporto === "file");
    ok("catena: il fallimento è nel diario",
       r.diario.some((d) => d.esito === "fallito" && String(d.dettaglio).includes("a metà")));
  }

  // 4. nessun trasporto: esito nullo, ma diagnosi completa
  {
    const r = await sincronizza(
      [finto("prossimità", 1, { disponibile: false, motivo: "API troppo vecchia", rimediabile: false }),
       finto("file", 3, { disponibile: false, motivo: "WebCrypto assente", rimediabile: false })],
      eventi, { passphrase: "x" });
    ok("catena: nessun trasporto restituisce null", r.esito === null);
    ok("catena: spiega entrambi i motivi",
       riassumi(r.diario).includes("API troppo vecchia") && riassumi(r.diario).includes("WebCrypto assente"));
  }

  // 5. forzare un livello specifico
  {
    const r = await sincronizza(
      [finto("prossimità", 1, { disponibile: true }), finto("file", 3, { disponibile: true })],
      eventi, { passphrase: "x", soloLivello: 3 });
    ok("catena: soloLivello rispettato", r.esito?.trasporto === "file");
  }

  // 6. disponibilita() che solleva non deve interrompere la catena
  {
    const rotto: Trasporto = {
      nome: "rotto", livello: 1,
      async disponibilita(): Promise<StatoTrasporto> { throw new Error("modulo corrotto"); },
      async scambia(): Promise<EsitoTrasferimento> { throw new Error("mai"); },
    };
    const r = await sincronizza([rotto, finto("file", 3, { disponibile: true })], eventi, { passphrase: "x" });
    ok("catena: eccezione in disponibilita() è contenuta", r.esito?.trasporto === "file");
  }

  console.log(`Test superati : ${passati}`);
  console.log(`Falliti       : ${falliti.length}`);
  for (const f of falliti) console.log("  FALLITO " + f);
  process.exit(falliti.length ? 1 : 0);
})();
