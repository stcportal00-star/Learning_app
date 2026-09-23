declare const process: { exit(code: number): never };

import { cifra, decifra, impacchetta, EventoSerializzato } from "../lib/sync/pacchetto";
import { fondi, proietta, impronta, ordinaEventi } from "../lib/sync/fusione";
import { Orologio, serializza } from "../lib/hlc";

let passati = 0;
const falliti: string[] = [];
function ok(nome: string, cond: boolean, extra = "") {
  if (cond) passati++;
  else falliti.push(`${nome} ${extra}`);
}

function evento(
  o: Orologio, dispositivo: string, entita: string, id: string,
  tipo: "crea" | "aggiorna" | "elimina", payload: Record<string, unknown>, ms?: number
): EventoSerializzato {
  const h = o.adesso(ms);
  const hlc = serializza(h);
  return { id: `${hlc}:${id}`, hlc, dispositivo, entita, entita_id: id, tipo,
           payload: JSON.stringify(payload) };
}

(async () => {
  // ------------------------------------------------ cifratura
  {
    const tab = new Orologio("tab1");
    const p = impacchetta("tab1", [evento(tab, "tab1", "note", "n1", "crea", { testo: "ciao" })]);
    const involucro = await cifra(p, "passphrase-condivisa");
    ok("cifra: non contiene testo in chiaro", !involucro.includes("ciao"));

    const tornato = await decifra(involucro, "passphrase-condivisa");
    ok("cifra: round-trip", JSON.stringify(tornato) === JSON.stringify(p));

    try {
      await decifra(involucro, "passphrase-sbagliata");
      ok("cifra: passphrase errata respinta", false);
    } catch { ok("cifra: passphrase errata respinta", true); }

    // manomissione di un byte dei dati
    const rotto = JSON.parse(involucro);
    const d = rotto.dati as string;
    rotto.dati = d.slice(0, 20) + (d[20] === "A" ? "B" : "A") + d.slice(21);
    try {
      await decifra(JSON.stringify(rotto), "passphrase-condivisa");
      ok("cifra: manomissione rilevata", false);
    } catch { ok("cifra: manomissione rilevata", true); }

    try {
      await decifra('{"formato":"altro"}', "x");
      ok("cifra: formato estraneo respinto", false);
    } catch { ok("cifra: formato estraneo respinto", true); }

    const futuro = JSON.parse(involucro); futuro.versione = 99;
    try {
      await decifra(JSON.stringify(futuro), "passphrase-condivisa");
      ok("cifra: versione futura respinta con messaggio utile", false);
    } catch (e) {
      ok("cifra: versione futura respinta con messaggio utile",
         String(e).includes("Aggiorna l'app"));
    }
  }

  // ------------------------------------------------ fusione di base
  {
    const tab = new Orologio("tab1");
    const tel = new Orologio("tel2");
    const a = [evento(tab, "tab1", "note", "n1", "crea", { testo: "A" }, 1000)];
    const b = [evento(tel, "tel2", "note", "n2", "crea", { testo: "B" }, 1000)];

    const f = fondi(a, b);
    ok("fusione: eventi nuovi riconosciuti", f.nuovi.length === 1 && f.duplicati === 0);

    const f2 = fondi([...a, ...f.nuovi], b);
    ok("fusione: idempotente alla seconda esecuzione",
       f2.nuovi.length === 0 && f2.duplicati === 1);
  }

  // ------------------------------------------------ convergenza
  {
    // Scenario reale: tablet in aereo, telefono a terra. Entrambi lavorano,
    // poi si sincronizzano in ordine opposto.
    const tab = new Orologio("tab1");
    const tel = new Orologio("tel2");

    const daTablet = [
      evento(tab, "tab1", "tentativi", "t1", "crea", { esito: "corretto" }, 1000),
      evento(tab, "tab1", "note", "n1", "crea", { testo: "primo" }, 1100),
      evento(tab, "tab1", "note", "n1", "aggiorna", { testo: "primo rivisto" }, 1200),
    ];
    const daTelefono = [
      evento(tel, "tel2", "note", "n9", "crea", { testo: "sul telefono" }, 1050),
      evento(tel, "tel2", "tentativi", "t2", "crea", { esito: "errato" }, 1150),
    ];

    const tabletDopo = [...daTablet, ...fondi(daTablet, daTelefono).nuovi];
    const telefonoDopo = [...daTelefono, ...fondi(daTelefono, daTablet).nuovi];

    ok("convergenza: stessa impronta su entrambi",
       impronta(tabletDopo) === impronta(telefonoDopo),
       `${impronta(tabletDopo)} vs ${impronta(telefonoDopo)}`);
    ok("convergenza: nessun evento perso", tabletDopo.length === 5);

    const nota = proietta(tabletDopo, "note", "n1");
    ok("proiezione: ultimo valore vince", nota?.testo === "primo rivisto");
  }

  // ------------------------------------------------ conflitto sullo stesso campo
  {
    const tab = new Orologio("tab1");
    const tel = new Orologio("tel2");
    const base = evento(tab, "tab1", "note", "n1", "crea", { testo: "origine" }, 1000);

    // entrambi modificano lo stesso campo, il telefono più tardi
    const modTablet = evento(tab, "tab1", "note", "n1", "aggiorna", { testo: "versione tablet" }, 2000);
    const modTelefono = evento(tel, "tel2", "note", "n1", "aggiorna", { testo: "versione telefono" }, 3000);

    const f = fondi([base, modTablet], [modTelefono]);
    ok("conflitto: rilevato e registrato", f.conflitti.some((c) => c.campo === "testo"));

    const finale = proietta([base, modTablet, modTelefono], "note", "n1");
    ok("conflitto: vince l'HLC più alto", finale?.testo === "versione telefono", String(finale?.testo));

    // stesso risultato fondendo nell'ordine opposto
    const finaleInverso = proietta([modTelefono, base, modTablet], "note", "n1");
    ok("conflitto: risoluzione indipendente dall'ordine di arrivo",
       finale?.testo === finaleInverso?.testo);
  }

  // ------------------------------------------------ eliminazione
  {
    const tab = new Orologio("tab1");
    const crea = evento(tab, "tab1", "biblioteca", "b1", "crea", { titolo: "X" }, 1000);
    const elimina = evento(tab, "tab1", "biblioteca", "b1", "elimina", {}, 2000);
    ok("eliminazione: l'entità sparisce", proietta([crea, elimina], "biblioteca", "b1") === null);

    const riscrive = evento(tab, "tab1", "biblioteca", "b1", "crea", { titolo: "Y" }, 3000);
    const dopo = proietta([crea, elimina, riscrive], "biblioteca", "b1");
    ok("eliminazione: una scrittura successiva la annulla", dopo?.titolo === "Y");
  }

  // ------------------------------------------------ sync interrotta
  {
    // Il pacchetto arriva a metà: batteria scarica a metà trasferimento.
    const tab = new Orologio("tab1");
    const tutti = Array.from({ length: 10 }, (_, i) =>
      evento(tab, "tab1", "tentativi", `t${i}`, "crea", { n: i }, 1000 + i * 10));
    const meta = tutti.slice(0, 6);

    const primaTranche = fondi([], meta);
    const locale = primaTranche.nuovi;
    const secondaTranche = fondi(locale, tutti); // si riprova con l'intero pacchetto

    ok("ripresa: riprende senza duplicare",
       secondaTranche.nuovi.length === 4 && secondaTranche.duplicati === 6);
    ok("ripresa: stato finale completo",
       [...locale, ...secondaTranche.nuovi].length === 10);
  }

  // ------------------------------------------------ ordinamento
  {
    const tab = new Orologio("tab1");
    const e1 = evento(tab, "tab1", "x", "1", "crea", {}, 1000);
    const e2 = evento(tab, "tab1", "x", "2", "crea", {}, 1000); // stesso ms
    const e3 = evento(tab, "tab1", "x", "3", "crea", {}, 2000);
    const mescolati = [e3, e1, e2];
    const ordinati = ordinaEventi(mescolati).map((e) => e.entita_id);
    ok("ordinamento: causale anche nello stesso millisecondo",
       JSON.stringify(ordinati) === JSON.stringify(["1", "2", "3"]), ordinati.join(","));
  }

  console.log(`Test superati : ${passati}`);
  console.log(`Falliti       : ${falliti.length}`);
  for (const f of falliti) console.log("  FALLITO " + f);
  process.exit(falliti.length ? 1 : 0);
})();
