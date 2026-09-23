/**
 * CONTROPROVA SYN-02 — lente "riproducibilita".
 *
 * Difetto da confutare: "due generazioni ravvicinate del codice di
 * accoppiamento e il codice MOSTRATO non e' quello valido"
 * (file accusato: lib/sync/accoppiamento.ts).
 *
 * Scritta da zero: non importa e non legge il file di simulazione dell'altro
 * agente. Il compito di una controprova e' rifare il percorso partendo dal
 * codice vero, non ereditare le convinzioni di chi ha segnalato.
 *
 * Si esegue dalla radice del progetto:
 *
 *   BANCO_DOPPI='{"react-native":"test/simulazione/controprova-SYN-02-react-native.mjs"}' \
 *     node --import ./test/banco/carica.mjs \
 *     test/simulazione/controprova-SYN-02-riproducibilita.mjs
 *
 * Quattro parti:
 *   A. la funzione accusata, in isolamento: generazioni consecutive nello
 *      stesso tick e a distanza di pochi millisecondi.
 *   B. lo scenario dell'utente: la genera() di app/sync.tsx rifatta riga per
 *      riga sopra il codice VERO di persistenza (lib/sync/stato.ts) e il
 *      deposito VERO (expo-sqlite/kv-store su node:sqlite). Il verdetto si
 *      legge DA FUORI, con una seconda connessione al file.
 *   C. la condizione necessaria: cosa dovrebbe succedere nel mondo perche' il
 *      difetto esista davvero.
 *   D. falsificazione della controprova stessa: un generatore malato e una
 *      genera() malata devono far diventare ROSSE queste asserzioni. Un test
 *      che non sa fallire non ha dimostrato niente.
 *
 * Non modifica niente del progetto: lavora in una cartella temporanea.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

// ------------------------------------------------------------ contabilita
let passate = 0;
const rosse = [];

/** Asserzione che sorveglia una proprieta' che DEVE valere. */
function corretto(nome, condizione, dettaglio = "") {
  if (condizione) passate++;
  else rosse.push(`${nome}${dettaglio ? " — " + dettaglio : ""}`);
}

/** Come corretto(), ma su un banco isolato: serve alla parte D. */
function correttoIn(esito, nome, condizione, dettaglio = "") {
  if (condizione) esito.passate++;
  else esito.rosse.push(`${nome}${dettaglio ? " — " + dettaglio : ""}`);
}

const attesa = (ms) => new Promise((r) => setTimeout(r, ms));

// ------------------------------------------------------------ caricamento
// Import DINAMICO: i doppi devono essere gia' registrati quando il modulo gira.
const SQLite = await import("expo-sqlite");
const cartella = SQLite.configuraCartella(mkdtempSync(join(tmpdir(), "controprova-syn02-")));

const accoppiamento = await import("../../lib/sync/accoppiamento.ts");
const { generaAccoppiamento, leggiAccoppiamento, normalizza, passphraseDa } = accoppiamento;

// ============================================================ PARTE A
// La funzione accusata, senza schermo e senza deposito: se il difetto sta
// davvero in accoppiamento.ts, qui si vede senza nessun intermediario.

const RIPETIZIONI = 5000;
const visti = new Set();
let aRotti = 0;
let aPrimoNonPiuValido = 0;

// Il primo risultato viene messo da parte e ricontrollato DOPO ogni generazione
// successiva: se il modulo tenesse uno stato condiviso (un buffer riusato, una
// variabile di modulo), il codice gia' mostrato smetterebbe di valere.
const primo = generaAccoppiamento();
const primoCodice = primo.codice;
const primoSegreto = primo.segreto;

for (let i = 0; i < RIPETIZIONI; i++) {
  const a = generaAccoppiamento();
  visti.add(a.codice);

  // Il controllo che conta: il codice MOSTRATO, riletto come lo rileggerebbe
  // l'altro dispositivo, deve riportare al segreto di QUESTA generazione.
  let riletto = null;
  try {
    riletto = leggiAccoppiamento(a.codice);
  } catch {
    riletto = null;
  }
  if (!riletto || riletto.segreto !== a.segreto) aRotti++;

  // E il codice gia' in mano all'utente deve restare valido.
  let primoRiletto = null;
  try {
    primoRiletto = leggiAccoppiamento(primoCodice);
  } catch {
    primoRiletto = null;
  }
  if (!primoRiletto || primoRiletto.segreto !== primoSegreto || primo.segreto !== primoSegreto) {
    aPrimoNonPiuValido++;
  }
}

corretto(
  `A1 ${RIPETIZIONI} generazioni di fila: il codice mostrato e' sempre quello valido`,
  aRotti === 0,
  `${aRotti} disallineate`
);
corretto(
  "A2 una generazione successiva non invalida il codice gia' mostrato",
  aPrimoNonPiuValido === 0,
  `${aPrimoNonPiuValido} volte`
);
corretto(
  "A3 nessun codice ripetuto (niente buffer condiviso, niente seme sull'orologio)",
  visti.size === RIPETIZIONI,
  `${RIPETIZIONI - visti.size} collisioni`
);

// La coppia e' autoportante per costruzione: il codice contiene il segreto piu'
// il carattere di controllo. Lo si verifica a mano, senza fidarsi di leggi().
{
  const a = generaAccoppiamento();
  corretto(
    "A4 il codice mostrato contiene esattamente il segreto valido",
    normalizza(a.codice).slice(0, -1) === a.segreto,
    `${normalizza(a.codice).slice(0, -1)} vs ${a.segreto}`
  );
}

// "A breve distanza" alla lettera: stesso millisecondo, poi 0, 1, 3, 10 ms.
for (const ritardo of [0, 0, 1, 3, 10]) {
  const uno = generaAccoppiamento();
  if (ritardo > 0) await attesa(ritardo);
  const due = generaAccoppiamento();

  corretto(
    `A5 (+${ritardo}ms) primo codice ancora valido dopo la seconda generazione`,
    leggiAccoppiamento(uno.codice).segreto === uno.segreto
  );
  corretto(
    `A5 (+${ritardo}ms) secondo codice valido e diverso dal primo`,
    leggiAccoppiamento(due.codice).segreto === due.segreto && due.segreto !== uno.segreto
  );
  corretto(
    `A5 (+${ritardo}ms) due passphrase distinte`,
    passphraseDa(uno) !== passphraseDa(due)
  );
}

// ============================================================ PARTE B
// Lo scenario dell'utente, con il codice vero di persistenza e il deposito vero.
const stato = await import("../../lib/sync/stato.ts");
const CHIAVE = "accoppiamento";
const PERCORSO_DEPOSITO = join(cartella, "ExpoSQLiteStorage");

/**
 * Il verdetto letto DA FUORI dal banco: una seconda connessione al file, in
 * sola lettura. Se guardassi il deposito attraverso lo stesso oggetto che ha
 * scritto, un difetto che vive nella cache in memoria resterebbe invisibile.
 */
function segretoMemorizzatoDaFuori() {
  let connessione;
  try {
    connessione = new DatabaseSync(PERCORSO_DEPOSITO, { readOnly: true });
  } catch {
    connessione = new DatabaseSync(PERCORSO_DEPOSITO);
  }
  try {
    const riga = connessione
      .prepare("SELECT value FROM storage WHERE key = ?")
      .get(CHIAVE);
    return riga ? JSON.parse(riga.value) : null;
  } finally {
    connessione.close();
  }
}

/**
 * La genera() di app/sync.tsx, rifatta riga per riga (la schermata non si
 * importa: e' JSX). L'ordine delle quattro righe e' quello vero, compreso il
 * punto in cui la funzione si sospende.
 */
function creaSchermata() {
  const schermata = { codiceMostrato: null, accoppiato: null };
  schermata.genera = async () => {
    const a = generaAccoppiamento();
    schermata.codiceMostrato = a.codice;
    await stato.salvaAccoppiamento(a);
    schermata.accoppiato = a;
  };
  return schermata;
}

/** Il giudizio: chi digita quello che vede ottiene la chiave che il telefono usa. */
async function verificaAllineamento(etichetta, schermata) {
  const memorizzato = segretoMemorizzatoDaFuori();
  const daSchermo = leggiAccoppiamento(schermata.codiceMostrato);

  corretto(`${etichetta}: il deposito non e' vuoto`, memorizzato !== null);
  corretto(
    `${etichetta}: il codice a schermo e' quello memorizzato`,
    memorizzato !== null && daSchermo.segreto === memorizzato.segreto,
    `schermo ${daSchermo.segreto.slice(0, 8)}… / deposito ${String(memorizzato?.segreto).slice(0, 8)}…`
  );
  corretto(
    `${etichetta}: stessa passphrase sui due dispositivi`,
    memorizzato !== null && passphraseDa(daSchermo) === passphraseDa(memorizzato)
  );
  // Anche lo stato della schermata deve finire d'accordo con il deposito,
  // altrimenti la sincronizzazione userebbe una chiave e lo schermo un'altra.
  corretto(
    `${etichetta}: stato della schermata allineato al deposito`,
    memorizzato !== null && schermata.accoppiato?.segreto === memorizzato.segreto
  );
  return leggiAccoppiamento(schermata.codiceMostrato).segreto === memorizzato?.segreto;
}

// B1 — doppio tocco senza nessuna pausa: il secondo parte mentre il primo
// salvataggio e' ancora sospeso sull'await.
{
  const s = creaSchermata();
  const primaChiamata = s.genera();
  const secondaChiamata = s.genera();
  await Promise.all([primaChiamata, secondaChiamata]);
  await verificaAllineamento("B1 doppio tocco nello stesso tick", s);
}

// B2 — rigenerazione a pochi millisecondi, come chi non ha fatto in tempo a
// trascrivere e ripreme il pulsante.
for (const ritardo of [0, 1, 5, 25]) {
  const s = creaSchermata();
  await s.genera();
  await attesa(ritardo);
  await s.genera();
  await verificaAllineamento(`B2 rigenerazione dopo ${ritardo}ms`, s);
}

// B3 — raffica: venti tocchi accavallati. Se esistesse una finestra stretta fra
// il mostrare e il salvare, venti tentativi la troverebbero piu' di uno.
{
  const s = creaSchermata();
  await Promise.all(Array.from({ length: 20 }, () => s.genera()));
  await verificaAllineamento("B3 raffica di venti tocchi", s);
}

// B4 — il percorso completo: il secondo dispositivo digita cio' che vede sul
// primo, passando per leggiAccoppiamento() e per il codice vero di salvataggio.
{
  const primoDispositivo = creaSchermata();
  await primoDispositivo.genera();
  await primoDispositivo.genera(); // due generazioni ravvicinate, come da segnalazione

  const digitato = primoDispositivo.codiceMostrato.toLowerCase(); // l'utente digita come gli pare
  const secondoDispositivo = leggiAccoppiamento(digitato);
  const suPrimoDispositivo = segretoMemorizzatoDaFuori();

  corretto(
    "B4 il secondo dispositivo ricava la stessa passphrase del primo",
    passphraseDa(secondoDispositivo) === passphraseDa(suPrimoDispositivo),
    `${passphraseDa(secondoDispositivo).slice(0, 20)}… vs ${passphraseDa(suPrimoDispositivo).slice(0, 20)}…`
  );
}

// B5 — la rigenerazione come la permette davvero la schermata: una volta
// accoppiati il pulsante "Genera" sparisce, quindi per rifare il codice si passa
// da "Dimentica l'accoppiamento". Si prova il percorso intero, due volte di
// fila, perche' e' li' che l'utente della segnalazione finisce.
{
  const s = creaSchermata();
  await s.genera();
  await stato.dimenticaAccoppiamento();
  corretto("B5 dimentica svuota davvero il deposito", segretoMemorizzatoDaFuori() === null);
  await s.genera();
  await s.genera();
  await verificaAllineamento("B5 rigenerazione dopo dimentica", s);
}

// ============================================================ PARTE C
// La condizione necessaria. Il codice mostrato e quello memorizzato possono
// divergere solo se le due scritture arrivano al deposito in ordine inverso
// rispetto ai due tocchi. Qui si misura se il deposito vero puo' farlo.
{
  const ordineScritture = [];
  const s = { codiceMostrato: null };
  const finti = [];
  for (let i = 0; i < 5; i++) {
    const a = generaAccoppiamento();
    s.codiceMostrato = a.codice;
    finti.push(
      stato.salvaAccoppiamento(a).then(() => ordineScritture.push(a.segreto))
    );
  }
  await Promise.all(finti);

  const ultimoMostrato = normalizza(s.codiceMostrato).slice(0, -1);
  corretto(
    "C1 il deposito vero conserva l'ordine: l'ultima scrittura e' l'ultimo tocco",
    ordineScritture[ordineScritture.length - 1] === ultimoMostrato
  );
  corretto(
    "C2 e sul file resta proprio quella",
    segretoMemorizzatoDaFuori()?.segreto === ultimoMostrato
  );
}

// ============================================================ PARTE D
// La controprova falsifica se stessa: con un generatore malato e una genera()
// malata queste stesse asserzioni devono diventare rosse. Se restassero verdi,
// il verde delle parti A e B non significherebbe niente.
{
  const esito = { passate: 0, rosse: [] };

  // D1 — generatore malato: mostra il codice di una generazione e tiene il
  // segreto di un'altra. E' esattamente il difetto SYN-02 come descritto.
  const uno = generaAccoppiamento();
  const due = generaAccoppiamento();
  const malato = { segreto: uno.segreto, codice: due.codice };
  correttoIn(
    esito,
    "D1 il codice mostrato e' quello valido",
    leggiAccoppiamento(malato.codice).segreto === malato.segreto
  );

  // D2 — schermata malata: mostra il primo codice e salva il secondo.
  const s = { codiceMostrato: null, accoppiato: null };
  const a1 = generaAccoppiamento();
  const a2 = generaAccoppiamento();
  s.codiceMostrato = a1.codice;
  await stato.salvaAccoppiamento(a2);
  s.accoppiato = a2;
  const memorizzato = segretoMemorizzatoDaFuori();
  correttoIn(
    esito,
    "D2 il codice a schermo e' quello memorizzato",
    leggiAccoppiamento(s.codiceMostrato).segreto === memorizzato.segreto
  );

  corretto(
    "D la controprova sa diventare rossa quando il difetto c'e' davvero",
    esito.passate === 0 && esito.rosse.length === 2,
    `passate ${esito.passate}, rosse ${esito.rosse.length}`
  );

  // Il deposito resta con il valore malato: le verifiche di B sono gia' finite,
  // ma lo si rimette a posto per non lasciare trappole a chi legge.
  await stato.salvaAccoppiamento(a1);
  corretto(
    "D3 deposito ripulito dopo la falsificazione",
    segretoMemorizzatoDaFuori()?.segreto === a1.segreto
  );
}

// ------------------------------------------------------------ rapporto
rmSync(cartella, { recursive: true, force: true });

console.log(`\nCONTROPROVA SYN-02 (riproducibilita) — ${passate} verdi, ${rosse.length} rosse`);
for (const r of rosse) console.log(`  ROSSA  ${r}`);
console.log(
  rosse.length === 0
    ? "\nVERDETTO: SYN-02 NON riprodotto. Il codice mostrato e' sempre quello valido.\n"
    : "\nVERDETTO: qualcosa non torna, leggere le rosse qui sopra.\n"
);
process.exit(rosse.length === 0 ? 0 : 1);
