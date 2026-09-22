/**
 * TRIAGE della superficie "schermate-stato" — verifica indipendente.
 *
 * Non sostituisce schermate-stato.mjs: ne ricontrolla in proprio le affermazioni
 * PORTANTI, quelle su cui si regge la gravita' dei difetti riportati, perche'
 * un difetto che arriva ai revisori dev'essere stato riprodotto due volte e con
 * due mani diverse.
 *
 * La differenza di metodo rispetto a schermate-stato.mjs e' deliberata: li' c'e'
 * un micro-React che RICOPIA la logica delle schermate, qui non c'e' nessuna
 * copia. Qui si fa solo una di queste tre cose:
 *
 *   1. si esercita il CODICE VERO (lib/db.ts, lib/sessioni.ts, lib/verifica.ts,
 *      lib/sync/accoppiamento.ts) con SQLite vero sotto;
 *   2. si legge il CONTENUTO VERO di assets/contenuti/ e ci si applica sopra la
 *      trasformazione letterale copiata dal .tsx nella stessa riga in cui la si
 *      verifica (cosi' la copia e' lunga una riga e si vede a occhio);
 *   3. si cerca un frammento LETTERALE nel sorgente del .tsx o di un asset.
 *
 * Serve a separare due cose che nel rapporto del simulatore stanno insieme:
 *   - i difetti VERI, riproducibili sul codice vero;
 *   - gli scenari che il banco puo' costruire ma che l'app non puo' raggiungere
 *     (ingressi che nessun percorso dell'app produce, o mitigazioni che stanno
 *     in un asset che il doppio del banco non riproduce).
 *
 * Si esegue dalla radice del progetto, senza argomenti:
 *
 *   node test/simulazione/triage-schermate-stato.mjs
 */
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const QUESTA = dirname(fileURLToPath(import.meta.url));
const RADICE = resolve(QUESTA, "..", "..");
const BANCO = join(RADICE, "test", "banco");

// Il banco va registrato prima di qualunque import dell'app: ci si riavvia.
if (!process.env.TRIAGE_SCHERMATE_IN_CORSO) {
  const { variabileBanco } = await import(join(BANCO, "doppi-altri.mjs"));
  const r = spawnSync(
    process.execPath,
    ["--import", join(BANCO, "carica.mjs"), join(QUESTA, "triage-schermate-stato.mjs")],
    {
      stdio: "inherit",
      cwd: RADICE,
      env: {
        ...process.env,
        TRIAGE_SCHERMATE_IN_CORSO: "1",
        // Il doppio con AppState: lib/sync/stato.ts lo legge al montaggio.
        BANCO_DOPPI: variabileBanco({
          "react-native": join(QUESTA, "schermate-stato-react-native.mjs"),
        }),
      },
    }
  );
  process.exit(r.status ?? 1);
}

const { importaApp } = await import(join(BANCO, "carica.mjs"));

// ------------------------------------------------------------------ verifiche
let passati = 0;
const rossi = [];

function ok(nome, condizione, dettaglio = "") {
  if (condizione) {
    passati++;
    console.log(`  ok   ${nome}`);
  } else {
    rossi.push(nome);
    console.log(`  ROSSO ${nome}${dettaglio ? " — " + dettaglio : ""}`);
  }
}

function sorgente(percorso) {
  return readFileSync(join(RADICE, percorso), "utf8");
}

function contiene(percorso, frammento) {
  return sorgente(percorso).includes(frammento);
}

// ============================================================ A. INVARIANTE 1
// NOT-03b / ESE-03 / COD-06 / CRO-03b poggiano tutti sulla stessa domanda:
// due registra() sovrapposte sulla STESSA connessione lasciano davvero una riga
// operativa senza il suo evento? Qui si usa lib/db.ts vero, senza nessuna copia.
console.log("\nA. lib/db.ts — due registra() sovrapposte (invariante 1)");
{
  const { apri, registra, database } = await importaApp("lib/db.ts");
  await apri("triage-a");
  const d = database();

  const scrivi = (id) =>
    registra("note", id, "crea", { testo: id }, async (dd, hlc) => {
      await dd.runAsync(
        "INSERT INTO note (id, titolo, testo, pubblicabile, creato_a, hlc) VALUES (?,?,?,?,?,?)",
        [id, null, id, 0, new Date().toISOString(), hlc]
      );
    });

  const esiti = await Promise.allSettled([scrivi("nota-1"), scrivi("nota-2")]);
  const motivi = esiti.map((e) => (e.status === "rejected" ? String(e.reason) : "ok"));

  const note = await d.getAllAsync("SELECT id FROM note");
  const eventi = await d.getAllAsync("SELECT entita_id FROM eventi WHERE entita = 'note'");
  const idEventi = new Set(eventi.map((e) => e.entita_id));
  const orfane = note.filter((n) => !idEventi.has(n.id));

  // Le tre righe qui sotto misuravano il difetto REG-06/REG-07, ed erano verdi
  // quando lo erano. La coda delle scritture di lib/db.ts (f890774) lo ha
  // chiuso, e da allora questo triage le teneva rosse come se fosse una
  // cattiva notizia: erano l'unica cosa in tutto il file a non essersi accorta
  // di una correzione. Girate, con lo stesso codice sotto e la misura identica.
  ok(
    "A1 nessuna delle due registra() sovrapposte viene respinta: la coda le serializza",
    esiti.every((e) => e.status === "fulfilled"),
    motivi.join(" | ")
  );
  ok(
    "A2 e nessun errore di transazione annidata compare piu'",
    !motivi.some((m) => /transaction/i.test(m)),
    motivi.join(" | ")
  );
  ok(
    "A3 nessuna riga in note resta senza il suo evento (invariante 1 tenuta)",
    orfane.length === 0 && note.length === 2,
    `note=${note.length} eventi=${idEventi.size} orfane=${orfane.length}`
  );
  console.log(`       note=${note.length} eventi=${idEventi.size} orfane=${JSON.stringify(orfane.map((o) => o.id))}`);
  console.log(`       motivi=${motivi.join(" | ")}`);

  // L'app usa SEMPRE withTransactionAsync, mai la variante esclusiva: e' la
  // radice comune di tutti i doppi tocchi che scrivono.
  ok("A4 lib/db.ts usa withTransactionAsync (non esclusiva)", contiene("lib/db.ts", "await d.withTransactionAsync("));
  ok(
    "A5 expo-sqlite documenta che la non esclusiva puo' essere interrotta",
    readFileSync(join(RADICE, "node_modules/expo-sqlite/build/SQLiteDatabase.js"), "utf8")
      .includes("use `withExclusiveTransactionAsync` instead")
  );
}

// ==================================================== B. CRONOMETRO E SESSIONI
console.log("\nB. lib/sessioni.ts — chiusura del blocco");
{
  const { chiudiSessione, riepilogoSettimana, DURATA_PREVISTA } = await importaApp("lib/sessioni.ts");

  // SES-03: tipo sconosciuto oltre le tre ore -> minuti undefined.
  const quattroOre = chiudiSessione(0, 4 * 3600_000, "meditazione");
  ok(
    "B1 SES-03 tipo sconosciuto oltre 180 min -> valida:true con minuti undefined",
    quattroOre.valida === true && quattroOre.minuti === undefined,
    JSON.stringify(quattroOre)
  );
  // ...ma il tipo sconosciuto non e' producibile dall'app: TipoBlocco e' chiuso
  // e l'unica scrittura della chiave kv usa Object.keys(ETICHETTE).
  ok(
    "B2 SES-03 l'app scrive solo tipi noti (avvia() itera le etichette)",
    contiene("components/Cronometro.tsx", "(Object.keys(ETICHETTE) as TipoBlocco[]).map((t) => (")
  );
  ok(
    "B3 SES-03 i cinque tipi noti hanno tutti una durata prevista",
    ["mattina", "artefatto", "lettura", "paper", "ripasso"].every((t) => typeof DURATA_PREVISTA[t] === "number")
  );

  // OGG-02: una data illeggibile non viene scartata dal riepilogo.
  const soloBuona = riepilogoSettimana([{ inizio: new Date().toISOString(), minuti: 30, tipo: "mattina" }], new Date());
  const conRotta = riepilogoSettimana(
    [
      { inizio: new Date().toISOString(), minuti: 30, tipo: "mattina" },
      { inizio: "non-una-data", minuti: 600, tipo: "mattina" },
    ],
    new Date()
  );
  ok(
    "B4 OGG-02 una riga con data illeggibile entra nel totale della settimana",
    conRotta.minuti === soloBuona.minuti + 600,
    `${soloBuona.minuti} -> ${conRotta.minuti}`
  );
  // Il progetto sa gia' come si fa: giaFattoOggi() scarta le date NaN.
  ok(
    "B5 OGG-02 lib/promemoria.ts scarta invece le date NaN (Number.isFinite)",
    contiene("lib/promemoria.ts", "Number.isFinite(t)")
  );
  ok(
    "B6 OGG-02 riepilogoSettimana non ha nessuna guardia equivalente",
    !sorgente("lib/sessioni.ts").includes("Number.isFinite")
  );

  // CRO-03b: la chiave se ne va PRIMA della scrittura, e la scrittura non e'
  // protetta. Si legge nell'ordine delle righe di ferma().
  const cro = sorgente("components/Cronometro.tsx");
  const posRimozione = cro.indexOf("await AsyncStorageLike.removeItem(CHIAVE);");
  const posRegistra = cro.indexOf('await registra("sessioni"');
  ok(
    "B7 CRO-03b removeItem(CHIAVE) precede registra(): se la scrittura fallisce il blocco e' perso",
    posRimozione > 0 && posRegistra > posRimozione
  );
  ok(
    "B8 CRO-03b nessun try/catch attorno alla scrittura della sessione",
    !/try\s*\{[\s\S]*registra\("sessioni"/.test(cro)
  );
  ok(
    "B9 CRO-03 la guardia di ferma() legge lo stato del disegno, non il deposito",
    contiene("components/Cronometro.tsx", "if (!attivo) return;") &&
      cro.indexOf("setAttivo(null);") > posRimozione
  );
  // CRO-02: l'effetto di lettura non ha try/catch, al contrario della
  // convenzione dichiarata in lib/promemoria.ts (deserializza tollerante).
  ok(
    "B10 CRO-02 JSON.parse del kv senza try/catch dentro l'effetto",
    contiene("components/Cronometro.tsx", "if (v) setAttivo(JSON.parse(v));") && !cro.includes("catch")
  );
}

// ========================================================= C. LETTURA CODICE
console.log("\nC. app/codice.tsx — la consegna sui 20 moduli veri");
{
  const moduli = JSON.parse(readFileSync(join(RADICE, "assets/contenuti/esercizi_codice.json"), "utf8"));
  ok("C0 i moduli di lettura del codice sono 20", moduli.length === 20, String(moduli.length));

  let persi = 0;
  let codiceIntegro = 0;
  for (const m of moduli) {
    // lib/contenuti.ts:106 compone cosi' la colonna consegna.
    const consegnaDb = `${m.titolo}\n\n${m.consegna}\n\n${m.codice_difettoso}`;
    // app/codice.tsx:51-52, ricopiate qui letteralmente e verificate sotto.
    const [titoloEconsegna, ...restoCodice] = consegnaDb.split("\n\n");
    const codiceDifettoso = restoCodice.slice(1).join("\n\n") || restoCodice.join("\n\n");
    // A schermo va solo titoloEconsegna (riga 89) e codiceDifettoso (riga 92).
    if (!`${titoloEconsegna}`.includes(m.consegna)) persi++;
    if (codiceDifettoso === m.codice_difettoso) codiceIntegro++;
  }
  ok("C1 CDC-02 la consegna non arriva a schermo in 20 moduli su 20", persi === 20, `persi=${persi}`);
  ok("C2 CDC-02 il codice arriva invece intero in tutti e 20", codiceIntegro === 20, `integri=${codiceIntegro}`);
  ok("C3 CDC-02 composizione in lib/contenuti.ts come misurata", contiene("lib/contenuti.ts", "`${c.titolo}\\n\\n${c.consegna}\\n\\n${c.codice_difettoso}`"));
  ok("C4 CDC-02 trasformazione in app/codice.tsx come misurata", contiene("app/codice.tsx", 'const codiceDifettoso = restoCodice.slice(1).join("\\n\\n") || restoCodice.join("\\n\\n");'));
  ok("C5 CDC-02 a schermo si stampa solo titoloEconsegna", contiene("app/codice.tsx", ">{titoloEconsegna}</Text>"));

  // CDC-01: la rubrica illeggibile e' costruita dal banco, non dall'app.
  ok(
    "C6 CDC-01 la rubrica e' sempre prodotta da JSON.stringify di un oggetto",
    contiene("lib/contenuti.ts", "JSON.stringify({ corretto: c.codice_corretto, test: c.test, categoria: c.categoria })")
  );
  ok("C7 CDC-01 JSON.parse sta nel corpo del render, senza try/catch", contiene("app/codice.tsx", 'const extra = JSON.parse(e.rubrica || "{}")'));

  // COD-05: il .py rotto richiede un modulo senza test. Non ne esiste nessuno.
  const senzaTest = moduli.filter((m) => !m.test).length;
  const conVerifica = moduli.filter((m) => /def\s+verifica\s*\(/.test(m.test || "")).length;
  ok("C8 COD-05 nessun modulo e' privo di test", senzaTest === 0, `senzaTest=${senzaTest}`);
  ok("C9 COD-05 tutti e 20 i test definiscono verifica()", conVerifica === 20, `conVerifica=${conVerifica}`);
  ok("C10 COD-05 l'esito di Sharing.isAvailableAsync() non produce nessun messaggio", contiene("app/codice.tsx", "if (await Sharing.isAvailableAsync()) await Sharing.shareAsync(file.uri);"));
}

// ================================================== D. CODA DEGLI ESERCIZI
console.log("\nD. app/esercizi.tsx — fondo della coda e attribuzione del tentativo");
{
  ok("D1 ESE-07 l'indice e' bloccato sull'ultimo elemento", contiene("app/esercizi.tsx", "setIndice((i) => Math.min(i + 1, coda.length - 1));"));
  ok("D2 ESE-07 lo stesso passaggio in app/codice.tsx scorre oltre la fine", contiene("app/codice.tsx", "setI((n) => n + 1);"));
  ok("D3 ESE-07 avanti() svuota il campo e l'esito", contiene("app/esercizi.tsx", "setRisposta(\"\");"));
  ok("D4 ESE-01 lo stato vuoto non distingue il caricamento", contiene("app/esercizi.tsx", "Hai risolto tutto quello che era rimasto aperto."));

  // ESE-05: verifica() dichiara il difetto del CONTENUTO, la schermata lo
  // registra come errore dell'utente. Motore vero, esecutore programmabile.
  const { verifica } = await importaApp("lib/verifica.ts");
  const esecutore = async (sql) => {
    if (sql === "SELECT rotta") throw new Error("no such table: rotta");
    return { colonne: ["a"], righe: [[1]] };
  };
  const esito = await verifica(esecutore, "SELECT 1 AS a", "SELECT rotta", {});
  ok(
    "D5 ESE-05 verifica() riconosce la soluzione di riferimento non eseguibile",
    esito.corretto === false && esito.motivo === "errore_sql" &&
      esito.dettaglio.includes("soluzione di riferimento non è eseguibile"),
    JSON.stringify(esito)
  );
  ok("D6 ESE-05 lib/verifica.ts lo chiama un difetto del contenuto", contiene("lib/verifica.ts", "è un difetto del contenuto, non dell'utente"));
  ok(
    "D7 ESE-05 la schermata registra comunque 'errato' senza guardare il motivo",
    contiene("app/esercizi.tsx", '{ esercizio_id: corrente.id, esito: r.corretto ? "corretto" : "errato" },')
  );
  // ...mentre il refuso dell'utente produce lo STESSO motivo: li' 'errato' e' giusto.
  const refuso = await verifica(
    async (sql) => { if (sql === "SELEC 1") throw new Error('near "SELEC": syntax error'); return { colonne: ["a"], righe: [[1]] }; },
    "SELEC 1", "SELECT 1 AS a", {}
  );
  ok(
    "D8 ESE-05 un refuso dell'utente da' lo stesso motivo: li' 'errato' e' corretto",
    refuso.motivo === "errore_sql" && refuso.corretto === false,
    JSON.stringify(refuso.dettaglio)
  );
  ok("D9 ESE-09 la durata si azzera solo in avanti(), senza tetto", contiene("app/esercizi.tsx", "const durata = Math.round((Date.now() - iniziato) / 1000);"));
}

// ============================================================== E. LETTORE
console.log("\nE. app/lettore.tsx e assets/lettore/lettore.html");
{
  ok("E1 LET-04 il cleanup annulla il timer senza salvare", contiene("app/lettore.tsx", "return () => { if (salvataggio.current) clearTimeout(salvataggio.current); };"));
  ok("E2 LET-04 il salvataggio e' a 1500 ms dall'ultimo cambio pagina", contiene("app/lettore.tsx", "salvaPagina(String(id), m.n), 1500)"));
  ok("E3 LET-04b la pagina ricevuta non viene confrontata con il totale", !/m\.n\s*(<=|<|>|>=)\s*totale/.test(sorgente("app/lettore.tsx")));

  // LET-05: il tempo massimo esiste, ma sta nell'asset, non nella schermata.
  const lettore = readFileSync(join(RADICE, "assets/lettore/lettore.html"), "utf8");
  ok("E4 LET-05 lettore.html ha un guardiano a 20 s", lettore.includes("const guardiano = setTimeout(") && lettore.includes("}, 20000);"));
  ok("E5 LET-05 allo scadere il guardiano invia un messaggio 'errore'", lettore.includes('invia({ tipo: "errore", messaggio });'));
  ok("E6 LET-05 il guardiano e' documentato come rimedio al blocco silenzioso", lettore.includes("Un blocco silenzioso è il guasto peggiore"));
  ok("E7 LET-05 la schermata non ha nessun timer proprio", !/setTimeout\([^)]*setErrore/.test(sorgente("app/lettore.tsx")));
  ok("E8 LET-04b il lettore ricondiziona comunque la pagina iniziale", lettore.includes("Math.min(Math.max(1, Number(cfg.pagina) || 1), n)"));
}

// ======================================================== F. SINCRONIZZAZIONE
console.log("\nF. app/sync.tsx e lib/sync/accoppiamento.ts");
{
  const { generaAccoppiamento } = await importaApp("lib/sync/accoppiamento.ts");
  const a = generaAccoppiamento();
  const gruppiVeri = a.codice.split("-").length;
  const gruppiSegnaposto = "XXXX-XXXX-XXXX-XXXX-X".split("-").length;
  ok("F1 ACC-08 il codice vero ha 9 gruppi", gruppiVeri === 9, `${gruppiVeri} — ${a.codice}`);
  ok("F2 ACC-08 il segnaposto ne promette 5", gruppiSegnaposto === 5);
  ok("F3 ACC-08 il segnaposto e' quello misurato", contiene("app/sync.tsx", 'placeholder="XXXX-XXXX-XXXX-XXXX-X"'));
  // Un codice troncato non produce MAI il segreto giusto: o il carattere di
  // controllo lo rifiuta (31 volte su 32), o passa ma con un segreto diverso,
  // che fallirebbe comunque. In nessun caso si perdono dati in silenzio.
  // Su 200 codici veri, perche' una sola estrazione sarebbe una moneta truccata.
  const { leggiAccoppiamento } = await importaApp("lib/sync/accoppiamento.ts");
  let mai = true;
  let rifiutati = 0;
  for (let i = 0; i < 200; i++) {
    const c = generaAccoppiamento();
    const troncato = c.codice.split("-").slice(0, 5).join("-");
    try {
      const letto = leggiAccoppiamento(troncato);
      if (letto.segreto === c.segreto) mai = false;
    } catch {
      rifiutati++;
    }
  }
  ok("F4 ACC-08 un codice troncato non restituisce mai il segreto giusto", mai);
  ok("F4b ACC-08 quasi sempre lo rifiuta gia' il carattere di controllo", rifiutati >= 180, `rifiutati=${rifiutati}/200`);

  ok("F5 SYN-02 il codice si mostra PRIMA di averlo salvato", /setCodiceMostrato\(a\.codice\);\s*\n\s*await salvaAccoppiamento\(a\);/.test(sorgente("app/sync.tsx")));
  ok("F6 SYN-02 genera() non ha nessun catch", !/async function genera\(\)[\s\S]*?catch/.test(sorgente("app/sync.tsx").split("async function collega")[0]));
  ok("F7 SYN-01 l'hook riceve dispositivo prima che il kv abbia risposto", /const \[dispositivo, setDispositivo\] = useState\(""\);/.test(sorgente("app/sync.tsx")) && contiene("app/sync.tsx", "useAutoSync(dispositivo)"));
  // Il corpo della funzione, isolato: dentro ci sono solo tre removeItem.
  const corpoDimentica = sorgente("lib/sync/stato.ts").split("export async function dimenticaAccoppiamento()")[1].split("}")[0];
  ok(
    "F8 SCH-01 dimenticaAccoppiamento tocca solo le tre chiavi del kv",
    (corpoDimentica.match(/removeItem/g) || []).length === 3 && !/eventi|sincronizzato|UPDATE/i.test(corpoDimentica),
    corpoDimentica.trim().replace(/\s+/g, " ")
  );
  ok("F9 SCH-01 daSincronizzare() filtra su sincronizzato = 0", contiene("lib/db.ts", "FROM eventi WHERE sincronizzato = 0 ORDER BY hlc LIMIT ?"));
}

// ============================================================ G. PROMEMORIA
console.log("\nG. app/promemoria.tsx e lib/notifiche.ts");
{
  ok("G1 SCH-10 il campo conferma sia su onBlur sia su onSubmitEditing", contiene("app/promemoria.tsx", "onBlur={confermaOra}") && contiene("app/promemoria.tsx", "onSubmitEditing={confermaOra}"));
  ok("G2 SCH-10 applica() cancella e riprogramma senza nessuna serializzazione", contiene("lib/notifiche.ts", "await N.cancelAllScheduledNotificationsAsync();"));

  // Due applica() sovrapposte sul doppio delle notifiche: lo scenario del
  // doppio onBlur+onSubmitEditing, senza passare dalla schermata.
  const N = await import("expo-notifications");
  const { applica } = await importaApp("lib/notifiche.ts");
  await N.cancelAllScheduledNotificationsAsync();
  await Promise.all([
    applica({ attivo: true, ora: 7, minuto: 30, tipo: "mattina" }),
    applica({ attivo: true, ora: 7, minuto: 30, tipo: "mattina" }),
  ]);
  const inCoda = (await N.getAllScheduledNotificationsAsync()).length;
  ok("G3 SCH-10 due applica() sovrapposte lasciano DUE notifiche quotidiane", inCoda === 2, `in coda=${inCoda}`);

  ok("G4 SCH-05 il permesso negato ritorna prima di applica()", /Alert\.alert\(\s*\n?\s*"Permesso negato"[\s\S]*?return;\s*\n\s*\}\s*\n\s*setPermesso/.test(sorgente("app/promemoria.tsx")));
  ok("G5 SCH-05 la preferenza e' gia' stata salvata prima del controllo", /await salvaPromemoria\(nuovo\);\s*\n\s*if \(nuovo\.attivo && chiediPermesso/.test(sorgente("app/promemoria.tsx")));
  ok("G6 SCH-13 fattoOggi e' calcolato una sola volta al montaggio", contiene("app/promemoria.tsx", "setFattoOggi(giaFattoOggi(letto, righe.map((r) => r.inizio), new Date()));") && contiene("app/promemoria.tsx", "}, []);"));
  ok("G7 PRM-01 durante il caricamento si disegna una View vuota", contiene("app/promemoria.tsx", 'if (!p) return <View style={{ flex: 1 }} />;'));
}

// ========================================== H. SCHEDE MONTATE E CONTEGGI
console.log("\nH. Oggi, Studio, Profilo, Libreria");
{
  ok("H1 OGG-05 l'effetto di Oggi dipende solo da [versione]", contiene("app/(tabs)/oggi.tsx", "}, [versione]);"));
  ok("H2 OGG-05 l'effetto di Studio non ha dipendenze", contiene("app/(tabs)/studio.tsx", "}, []);"));
  ok("H3 PRF-02 l'effetto del Profilo non ha dipendenze", contiene("app/(tabs)/profilo.tsx", "}, []);"));
  ok("H4 OGG-05 nessuna schermata usa useFocusEffect", !["app/(tabs)/oggi.tsx", "app/(tabs)/studio.tsx", "app/(tabs)/profilo.tsx"].some((f) => contiene(f, "useFocusEffect")));

  // OGG-06: numeratore e denominatore su popolazioni diverse, sui contenuti veri.
  const sql = JSON.parse(readFileSync(join(RADICE, "assets/contenuti/esercizi_sql.json"), "utf8"));
  const flash = JSON.parse(readFileSync(join(RADICE, "assets/contenuti/flashcard.json"), "utf8"));
  const scen = JSON.parse(readFileSync(join(RADICE, "assets/contenuti/scenari_rubrica.json"), "utf8"));
  const codice = JSON.parse(readFileSync(join(RADICE, "assets/contenuti/esercizi_codice.json"), "utf8"));
  const totale = sql.length + flash.length + scen.length + codice.length;
  const conTentativi = sql.length + codice.length; // solo questi due tipi scrivono in `tentativi`
  ok("H5 OGG-06 il denominatore conta tutti i 381 esercizi", totale === 381, String(totale));
  ok("H6 OGG-06 il numeratore puo' arrivare al massimo a 170", conTentativi === 170, String(conTentativi));
  ok("H7 OGG-06 il denominatore e' davvero count(*) FROM esercizi", contiene("app/(tabs)/oggi.tsx", 'SELECT count(*) AS n FROM esercizi"'));
  ok("H8 OGG-06 il ripasso non scrive in tentativi", !contiene("app/ripasso.tsx", "tentativi"));

  // RAD-04: il banner dichiara 21, il contenuto ne ha 23.
  const window4 = sql.filter((e) => e.tema === "sql_window");
  ok("H9 RAD-04 il tema sql_window ha 23 esercizi", window4.length === 23, String(window4.length));
  ok("H10 RAD-04 sono tutti di livello 4", window4.every((e) => e.livello === 4));
  ok("H11 RAD-04 il banner ne dichiara 21", contiene("app/_layout.tsx", "21 esercizi di livello 4 non saranno eseguibili"));
  ok("H12 RAD-03 lo stato di errore non offre nessun pulsante", /Avvio non riuscito[\s\S]{0,400}?<\/View>/.test(sorgente("app/_layout.tsx")) && !/Avvio non riuscito[\s\S]{0,400}?Pressable/.test(sorgente("app/_layout.tsx")));

  // LIB-09: punto di rottura fuori convenzione.
  ok("H13 LIB-09 la libreria rompe a 900dp", contiene("app/(tabs)/libreria.tsx", "const colonne = width >= 900 ? 2 : 1;"));
  ok("H14 LIB-09 le altre schermate rompono a 600dp", ["app/(tabs)/note.tsx", "app/esercizi.tsx", "app/codice.tsx"].every((f) => contiene(f, "width >= 600")));
  ok("H15 LIB-09 CLAUDE.md impone un solo punto di rottura a 600dp", contiene("CLAUDE.md", "un solo punto di rottura: `useWindowDimensions()`, 600dp"));

  // LIB-06 (corretto dopo questo triage): rimuovere un volume 'aperta' non si
  // recuperava piu'. H17 e H18 restano veri, e sono la ragione per cui la riga
  // non si puo' cancellare; H16 ora vale solo per i PDF aggiunti a mano.
  ok("H16 LIB-06 l'evento 'elimina' e il DELETE esistono ancora, ma solo sul ramo dei volumi aggiunti a mano", contiene("lib/palestra.ts", 'await registra("biblioteca", id, "elimina", {}, async (dd) => {') && contiene("lib/palestra.ts", 'if (v.origine === "aperta") {'));
  ok("H16b LIB-06 il ramo 'aperta' azzera file_locale invece di cancellare la riga", contiene("lib/palestra.ts", 'UPDATE biblioteca SET file_locale = NULL, hlc = ? WHERE id = ?'));
  ok("H17 LIB-06 caricaContenuti() salta tutto se esistono gia' esercizi", contiene("lib/contenuti.ts", 'SELECT count(*) AS n FROM esercizi') && contiene("lib/contenuti.ts", "saltato: true"));
  ok("H18 LIB-06 la voce di catalogo si reinserisce solo dentro caricaContenuti()", (sorgente("lib/palestra.ts") + sorgente("app/(tabs)/libreria.tsx")).indexOf("INSERT OR IGNORE INTO biblioteca") === -1);
  ok("H19 LIB-05 l'esito di apriVolume e' scartato", contiene("app/(tabs)/libreria.tsx", "onPress: () => { void apriVolume(item); }"));
  ok("H20 LIB-08 l'annullamento produce comunque il messaggio di successo", contiene("lib/palestra.ts", "if (scelta.canceled || !scelta.assets?.length) return { collegati: 0, senzaFile: 0 };") && contiene("app/(tabs)/libreria.tsx", "volumi ora disponibili offline."));
  ok("H21 LIB-08 collegati++ non guarda le righe toccate dall'UPDATE", /await registra\("biblioteca", v\.codice, "aggiorna",[\s\S]*?collegati\+\+;/.test(sorgente("lib/palestra.ts")));
  ok("H22 LIB-08 JSON.parse del manifesto non e' protetto", contiene("lib/palestra.ts", "const voci = JSON.parse(await new File(manifesto.uri).text())"));
  ok("H23 LIB-07 aggiungi() non ha catch", !/async function aggiungi\(\)[\s\S]*?catch/.test(sorgente("app/(tabs)/libreria.tsx").split("async function daRelease")[0]));

  // STU-04: due definizioni diverse di "aperto".
  ok("H24 STU-04 Studio esclude ogni esercizio mai risolto", contiene("app/(tabs)/studio.tsx", "AND NOT EXISTS (SELECT 1 FROM tentativi t WHERE t.esercizio_id=e.id AND t.esito='corretto')"));
  ok("H25 STU-04 /esercizi guarda invece l'ULTIMO tentativo", contiene("app/esercizi.tsx", "AND (t.esito IS NULL OR t.esito <> 'corretto')"));
  ok("H26 STU-04 solo /esercizi applica il LIMIT 40", contiene("app/esercizi.tsx", "LIMIT 40") && !contiene("app/(tabs)/studio.tsx", "LIMIT"));
}

// ============================================================== I. NOTE
console.log("\nI. app/(tabs)/note.tsx");
{
  ok("I1 NOT-03c setApertaId(id) sta dopo l'await", contiene("app/(tabs)/note.tsx", "setApertaId(id);\n    await ricarica();"));
  ok("I2 NOT-03b/c salva() non ha nessuna guardia di riesecuzione", !/const \[inCorso|salvataggioInCorso|if \(inCorso\)/.test(sorgente("app/(tabs)/note.tsx")));
  // NOT-07 corretto dopo questo triage: le tre vie di uscita passano tutte da
  // esci(), che salva se c'e' qualcosa da salvare. Le righe restano, con il
  // verso cambiato: erano la prova del difetto, ora sono la prova della
  // correzione, ed e' lo stesso file a doverlo dire.
  ok("I3 NOT-07 'Nuova nota' passa da esci(), che salva prima di azzerare i campi", contiene("app/(tabs)/note.tsx", "onPress={() => { void esci(nuova); }}"));
  ok("I4 NOT-07 '← Tutte le note' passa dallo stesso esci()", contiene("app/(tabs)/note.tsx", "onPress={() => { void esci(() => setApertaId(null)); }}"));
  ok("I4b NOT-07 e anche aprire un'ALTRA nota dall'elenco (la stessa no: rimetterebbe il testo vecchio)", contiene("app/(tabs)/note.tsx", "onPress={() => { if (apertaId !== item.id) void esci(() => apri(item)); }}"));
  ok("I4c NOT-07 lo smontaggio della scheda salva dalla pulizia dell'effetto", contiene("app/(tabs)/note.tsx", "useEffect(() => () => { void salvaUscendo.current(); }, []);"));
  ok("I5 NOT-07 si salva e basta: nessun avviso da toccare, nessuna domanda", !/Alert/.test(sorgente("app/(tabs)/note.tsx")));
  ok("I6 NOT-05 il salvataggio vuoto esce in silenzio", contiene("app/(tabs)/note.tsx", "if (!testo.trim() && !titolo.trim()) return;"));
  // Il controllo guardava tutto il file; ora daSalvare() contiene proprio
  // quei confronti, ma serve a decidere se salvare USCENDO, non a fermare il
  // pulsante. NOT-04 riguarda il pulsante, e per quello si guarda salva().
  ok("I7 NOT-04 il pulsante Salva non confronta niente: riscrive comunque", !/titolo !== |testo !== |immutata|invariata/.test(sorgente("app/(tabs)/note.tsx").split("async function salva()")[1].split("const Elenco")[0]));
}

// ============================================================= J. RIPASSO
console.log("\nJ. app/ripasso.tsx");
{
  ok("J1 RIP-10 setI e' dopo l'await, senza guardia", contiene("app/ripasso.tsx", "setScoperta(false);\n    setI((n) => n + 1);"));
  ok("J2 RIP-11 il gestore onPress non ha catch", contiene("app/ripasso.tsx", "onPress={() => valuta(n)}") && !contiene("app/ripasso.tsx", "catch"));
  ok("J3 RIP-04 la coda si ferma a 30 schede", contiene("app/ripasso.tsx", "ORDER BY r.prossima_revisione LIMIT 30"));
  ok("J4 RIP-04 esaurita la coda si ricade sullo stesso testo dello stato vuoto", contiene("app/ripasso.tsx", "Nessuna scheda da ripassare."));
  ok("J5 REG-08 l'UPDATE del ripasso non verifica le righe toccate", contiene("app/ripasso.tsx", "UPDATE ripasso SET stabilita = ?"));
  ok("J6 REG-08 la riga di ripasso e' creata dai contenuti e non viene mai cancellata", contiene("lib/contenuti.ts", "INSERT OR IGNORE INTO ripasso (esercizio_id, prossima_revisione) VALUES (?,?)") && !/DELETE FROM ripasso/.test(sorgente("lib/contenuti.ts") + sorgente("lib/palestra.ts") + sorgente("app/ripasso.tsx")));
}

// ================================================================= ESITO
console.log(`\npassati ${passati} su ${passati + rossi.length}`);
if (rossi.length) {
  console.log("rossi:");
  for (const r of rossi) console.log("  · " + r);
  process.exit(1);
}
