/**
 * Il percorso: in che ordine si studia, e a che punto si è.
 *
 * Senza questo modulo l'app era un magazzino ben fornito — 150 esercizi, 199
 * schede, 12 scenari, 52 volumi, la rassegna — senza nessuno che dicesse da
 * dove cominciare né quando un argomento si può dire imparato. Qui ogni tema è
 * un'UNITÀ, le unità stanno nell'ordine del piano (trimestre, poi l'ordine di
 * `TEMI` in lib/contenuti.ts, che mette le basi prima di ciò che le usa), e
 * dentro ogni unità i passi seguono il ciclo che fa restare le cose in testa:
 * leggere la fonte, esercitarsi, fissare i concetti a memoria, applicarli a un
 * caso, restare aggiornati.
 *
 * Logica pura: nessun database, nessuna rete. I conteggi arrivano da
 * lib/avanzamento.ts, che li legge dalle tabelle che l'app scrive già. Il
 * percorso NON scrive eventi suoi: l'avanzamento è una conseguenza di ciò che
 * si è fatto, non un secondo registro da tenere allineato al primo.
 */

/**
 * `pista` è l'area del tema (dati, ia, hardware…, vedi `TEMI`): serve ai
 * progetti, per sapere che cosa viene dopo un tema superato. È facoltativa
 * perché un tema senza area non ha un seguito, e resta un'unità come le altre.
 */
export type Tema = { slug: string; nome: string; trimestre: string | null; pista?: string | null };

/** Quanto materiale c'è per un tema, e quanto se n'è fatto. */
export type Materiale = {
  /** Esercizi eseguibili SU QUESTO DISPOSITIVO (SQL o lettura del codice). */
  esercizi: number;
  risolti: number;
  schede: number;
  /** Ripassate almeno una volta, e l'ultima volta non con «Di nuovo». */
  schedeSapute: number;
  schedeInScadenza: number;
  scenari: number;
  scenariSvolti: number;
  volumi: number;
  volumiSulTelefono: number;
  /** Letti oltre la prima pagina: il lettore salva la pagina solo quando cambia. */
  volumiIniziati: number;
  articoliDaLeggere: number;
};

export const MATERIALE_VUOTO: Materiale = {
  esercizi: 0, risolti: 0, schede: 0, schedeSapute: 0, schedeInScadenza: 0,
  scenari: 0, scenariSvolti: 0, volumi: 0, volumiSulTelefono: 0, volumiIniziati: 0,
  articoliDaLeggere: 0,
};

export type TipoPasso = "leggi" | "esercizi" | "schede" | "scenario" | "rassegna";

export type Passo = {
  tipo: TipoPasso;
  fatto: number;
  totale: number;
  /** Quanto basta perché il passo sia superato. */
  soglia: number;
  completo: boolean;
  /**
   * Se conta per chiudere l'unità. Leggere e la rassegna no: un manuale di
   * cinquecento pagine non si finisce in un'unità, e un volume che non è sul
   * telefono, in aereo, bloccherebbe il percorso fino a novembre.
   */
  conta: boolean;
  /** Si può fare adesso, senza rete. */
  eseguibile: boolean;
};

export type StatoUnita = "completa" | "in_corso" | "da_iniziare" | "senza_verifiche";

export type Unita = {
  tema: Tema;
  /**
   * 1, 2, 3… fra le sole unità con verifiche; null per quelle di sola
   * lettura. Queste nascono e spariscono con i volumi e gli articoli che la
   * conduttura porta ogni mattina: contate, spostavano il numero di tutte le
   * unità dopo di loro — SQL — fondamenti passava da «unità 1» a «unità 2»
   * senza che nello studio fosse cambiato niente, e il numero non stava più
   * dentro il «di N» di Oggi, che le unità di sola lettura non le conta.
   */
  posizione: number | null;
  passi: Passo[];
  stato: StatoUnita;
  /** Fra 0 e 1, sui soli passi che contano. */
  avanzamento: number;
};

/**
 * La padronanza si dichiara all'80%, la soglia classica del mastery learning:
 * pretendere il 100% vorrebbe dire restare fermi su un tema per l'ultimo
 * esercizio di livello 4, che resta comunque lì da fare.
 */
export const SOGLIA_PERCENTO = 80;
/** Uno scenario basta: ognuno chiede da trenta a sessanta minuti di scrittura. */
export const SCENARI_RICHIESTI = 1;

export function soglia(totale: number): number {
  return Math.ceil((totale * SOGLIA_PERCENTO) / 100);
}

function passo(
  tipo: TipoPasso, fatto: number, totale: number, sogliaPasso: number,
  conta: boolean, eseguibile: boolean, completo = fatto >= sogliaPasso,
): Passo {
  return { tipo, fatto, totale, soglia: sogliaPasso, completo, conta, eseguibile };
}

/** I passi di un'unità, nell'ordine in cui si fanno. Un passo senza materiale non c'è. */
export function passiDi(m: Materiale): Passo[] {
  const passi: Passo[] = [];
  if (m.volumi > 0) {
    passi.push(passo("leggi", m.volumiIniziati, m.volumi, 1, false, m.volumiSulTelefono > 0));
  }
  if (m.esercizi > 0) {
    passi.push(passo("esercizi", m.risolti, m.esercizi, soglia(m.esercizi), true, true));
  }
  if (m.schede > 0) {
    passi.push(passo("schede", m.schedeSapute, m.schede, soglia(m.schede), true, true));
  }
  if (m.scenari > 0) {
    passi.push(passo("scenario", m.scenariSvolti, m.scenari, Math.min(SCENARI_RICHIESTI, m.scenari), true, true));
  }
  if (m.articoliDaLeggere > 0) {
    // Nessuna soglia: la rassegna non si «supera», si tiene in pari.
    passi.push(passo("rassegna", 0, m.articoliDaLeggere, 0, false, true, false));
  }
  return passi;
}

export function statoDi(passi: Passo[]): { stato: StatoUnita; avanzamento: number } {
  const contano = passi.filter((p) => p.conta);
  if (!contano.length) return { stato: "senza_verifiche", avanzamento: 0 };
  const avanzamento =
    contano.reduce((s, p) => s + Math.min(p.fatto / p.soglia, 1), 0) / contano.length;
  if (contano.every((p) => p.completo)) return { stato: "completa", avanzamento: 1 };
  const iniziata = contano.some((p) => p.fatto > 0) ||
    passi.some((p) => p.tipo === "leggi" && p.fatto > 0);
  return { stato: iniziata ? "in_corso" : "da_iniziare", avanzamento };
}

/**
 * Il trimestre ordina come stringa (T0 < T1 < … < T9); senza trimestre, in
 * fondo. Confronto per codice e non `localeCompare`: le regole della lingua
 * mettono la punteggiatura prima delle lettere, e «~» finirebbe in testa.
 */
function confrontaTrimestre(a: string | null, b: string | null): number {
  const x = a ?? "~";
  const y = b ?? "~";
  return x < y ? -1 : x > y ? 1 : 0;
}

/**
 * Le unità nell'ordine del percorso. `ordine` è la sequenza degli slug di
 * `TEMI`: la tabella `temi` non ha una colonna d'ordine, e il `rowid` non
 * basta, perché un tema arrivato da un altro dispositivo entra quando arriva.
 * Un tema senza nessun materiale non è un'unità: sarebbe un passo vuoto.
 */
export function costruisciPercorso(
  temi: Tema[], materiali: Record<string, Materiale>, ordine: string[],
): Unita[] {
  const indice = (slug: string) => {
    const i = ordine.indexOf(slug);
    return i < 0 ? ordine.length : i;
  };
  const ordinati = [...temi].sort((a, b) =>
    confrontaTrimestre(a.trimestre, b.trimestre) ||
    indice(a.slug) - indice(b.slug) ||
    a.slug.localeCompare(b.slug));

  const unita: Unita[] = [];
  let numero = 0;
  for (const tema of ordinati) {
    const passi = passiDi(materiali[tema.slug] ?? MATERIALE_VUOTO);
    if (!passi.length) continue;
    const s = statoDi(passi);
    unita.push({ tema, posizione: s.stato === "senza_verifiche" ? null : ++numero, passi, ...s });
  }
  return unita;
}

/**
 * Il «di N» di Oggi. Sta qui, accanto alla numerazione, e non nella
 * schermata: quando le due cose si contavano in due posti diversi, il numero
 * di un'unità è arrivato a superare N.
 */
export function unitaConVerifiche(unita: Unita[]): number {
  return unita.filter((u) => u.stato !== "senza_verifiche").length;
}

export type Indicazione = { unita: Unita; passo: Passo };

/**
 * La prossima cosa da fare: la prima unità non chiusa, e dentro quella il
 * primo passo non fatto che si può fare adesso. La lettura viene prima degli
 * esercizi se il volume è sul telefono e non è mai stato aperto; se non c'è,
 * non si aspetta la rete per cominciare.
 *
 * null vuol dire percorso finito: tutte le unità con verifiche sono chiuse.
 */
export function prossimoPasso(unita: Unita[]): Indicazione | null {
  for (const u of unita) {
    const p = passoDaFare(u);
    if (p) return { unita: u, passo: p };
  }
  return null;
}

/**
 * Il passo da fare adesso dentro un'unità, con la regola di prossimoPasso():
 * il primo non fatto che si può fare, e fra quelli che non contano solo la
 * lettura. null per un'unità superata o di sola lettura.
 */
export function passoDaFare(u: Unita): Passo | null {
  if (u.stato === "completa" || u.stato === "senza_verifiche") return null;
  return u.passi.find((p) => !p.completo && p.eseguibile && (p.conta || p.tipo === "leggi")) ?? null;
}

// ---------------------------------------------------------------- progetti

/**
 * Un progetto è un tema che si è scelto di seguire, in parallelo agli altri e
 * fuori dall'ordine del piano: SQL, l'hardware e l'IA insieme, o l'hardware
 * prima di SQL.
 */
export type Progetto = {
  /** Il tema scelto. È la chiave del progetto: smettere di seguirlo toglie questo. */
  seguito: string;
  /** L'unità su cui si lavora adesso: il tema scelto, o chi ne ha preso il posto. */
  unita: Unita;
  /** null quando non resta niente da fare per questo progetto: vedi `areaFinita`. */
  passo: Passo | null;
  /** Il tema scelto è superato (o è già di un altro progetto) e questa unità è il suo seguito. */
  subentrata: boolean;
  /**
   * Nell'area del tema scelto non resta niente da fare. Un progetto senza
   * passo con l'area non finita è un tema superato il cui resto d'area è già
   * negli altri progetti (si segue lettura del codice e AI engineering, che
   * stanno nella stessa area): dirgli «area tutta superata» sarebbe falso.
   */
  areaFinita: boolean;
};

/**
 * I progetti, nell'ordine in cui si sono scelti.
 *
 * Quando il tema scelto è superato, al suo posto arriva il successivo della
 * stessa area, nell'ordine del piano; se dopo non c'è niente, il primo rimasto
 * indietro nell'area. Il progetto finisce solo quando l'area è tutta superata.
 * Si ricalcola ogni volta dall'avanzamento, senza scrivere niente: un
 * seguito salvato andrebbe tenuto allineato all'avanzamento, e divergerebbe al
 * primo ripasso che fa ricadere un'unità.
 *
 * Due progetti non finiscono mai sulla stessa unità. Prima si assegnano le
 * unità scelte che hanno ancora qualcosa da fare, poi i seguiti: chi segue SQL
 * — fondamenti e SQL — join, finite le fondamenta, si trova join e aggregazione,
 * non due volte join. I seguiti si assegnano nell'ordine del piano dei temi
 * scelti, non in quello in cui si sono scelti: così un'unità resta al
 * progetto che l'aveva quando un altro tema scelto viene superato, e il suo
 * riquadro non passa da un progetto all'altro da un giorno all'altro.
 *
 * Un tema che su questo dispositivo non è un'unità (sql_window senza window
 * functions, un tema senza materiale) si salta: la scelta resta, e vale dove
 * l'unità c'è.
 */
export function progetti(unita: Unita[], seguiti: string[]): Progetto[] {
  const presi = new Set<string>();
  const libera = (u: Unita) => !presi.has(u.tema.slug) && passoDaFare(u) !== null;
  const scelti = [...new Set(seguiti)]
    .map((s) => ({ s, i: unita.findIndex((u) => u.tema.slug === s) }))
    .filter((x) => x.i >= 0 && unita[x.i].stato !== "senza_verifiche");

  const assegnate = new Map<string, Unita>();
  for (const { s, i } of scelti) {
    if (libera(unita[i])) { assegnate.set(s, unita[i]); presi.add(unita[i].tema.slug); }
  }
  for (const { s, i } of [...scelti].sort((a, b) => a.i - b.i)) {
    if (assegnate.has(s)) continue;
    const area = unita[i].tema.pista;
    const nellArea = (u: Unita) => Boolean(area) && u.tema.pista === area && libera(u);
    const seguito = unita.slice(i + 1).find(nellArea) ?? unita.slice(0, i).find(nellArea);
    if (seguito) { assegnate.set(s, seguito); presi.add(seguito.tema.slug); }
  }

  return scelti.map(({ s, i }) => {
    const u = assegnate.get(s) ?? unita[i];
    const area = unita[i].tema.pista;
    const areaFinita = area
      ? !unita.some((x) => x.tema.pista === area && passoDaFare(x) !== null)
      : passoDaFare(unita[i]) === null;
    return { seguito: s, unita: u, passo: passoDaFare(u), subentrata: u !== unita[i], areaFinita };
  });
}

/** Una cosa da fare adesso: il passo di un progetto, o quello del piano (`progetto` null). */
export type DaFare = { unita: Unita; passo: Passo; progetto: Progetto | null };

/**
 * Che cosa fare adesso: i passi dei progetti, e se nessun progetto ne ha uno
 * (nessun tema seguito, o le loro aree tutte finite) il prossimo passo del
 * piano. Una regola sola per Oggi, Studio e le Notizie: copiata in tre
 * schermate, una avrebbe potuto smettere di tornare al piano, e Oggi avrebbe
 * detto «tutte le unità sono superate» con decine ancora da fare.
 */
export function daFare(unita: Unita[], seguiti: string[]): DaFare[] {
  const conPasso = progetti(unita, seguiti).filter((p) => p.passo);
  if (conPasso.length) return conPasso.map((p) => ({ unita: p.unita, passo: p.passo!, progetto: p }));
  const piano = prossimoPasso(unita);
  return piano ? [{ unita: piano.unita, passo: piano.passo, progetto: null }] : [];
}

/** Il titolo e la riga di spiegazione di un passo, come li mostra lo schermo. */
export function descriviPasso(p: Passo): { titolo: string; dettaglio: string } {
  switch (p.tipo) {
    case "leggi":
      return {
        titolo: "Leggi la fonte",
        dettaglio: p.eseguibile
          ? (p.fatto ? `Iniziati ${p.fatto} volumi su ${p.totale}.` : `${p.totale === 1 ? "Un volume" : `${p.totale} volumi`} del tema: prima la teoria, poi la pratica.`)
          : "I volumi del tema non sono ancora sul telefono: si scaricano da Libreria, con la rete.",
      };
    case "esercizi":
      return {
        titolo: "Esercitati",
        dettaglio: `${p.fatto} risolti su ${p.totale}. Si supera a ${p.soglia}.`,
      };
    case "schede":
      return {
        titolo: "Fissa i concetti",
        dettaglio: `${p.fatto} schede sapute su ${p.totale}. Si supera a ${p.soglia}: poi tornano da sole, a intervalli crescenti.`,
      };
    case "scenario":
      return {
        titolo: "Applica a un caso",
        dettaglio: p.fatto
          ? `${p.fatto} scenari svolti su ${p.totale}.`
          : `${p.totale === 1 ? "Uno scenario" : `${p.totale} scenari`} con rubrica: se ne svolge uno, in Note.`,
      };
    case "rassegna":
      return {
        titolo: "Resta aggiornato",
        dettaglio: `${p.totale} articoli del tema da leggere nella rassegna.`,
      };
  }
}

/** Dove porta un passo. `volume` è il volume da aprire, per la lettura. */
export function destinazione(slug: string, p: Passo, volume?: string | null): string {
  switch (p.tipo) {
    case "leggi":
      return volume ? `/lettore?id=${encodeURIComponent(volume)}` : "/libreria";
    case "esercizi":
      return slug === "lettura_codice" ? "/codice" : `/esercizi?tema=${encodeURIComponent(slug)}`;
    case "schede":
      return `/ripasso?tema=${encodeURIComponent(slug)}`;
    case "scenario":
      return `/unita?tema=${encodeURIComponent(slug)}`;
    case "rassegna":
      return `/notizie?tema=${encodeURIComponent(slug)}`;
  }
}

// ------------------------------------------------------------------ scenari

export type Scenario = { id: string; consegna: string; rubrica: string[] };

export const MARCA_RISPOSTA = "## La mia risposta";

/**
 * Il testo con cui nasce la nota di uno scenario: la consegna e la rubrica
 * come lista di controllo, poi lo spazio per rispondere. Lo scenario si
 * svolge in Note perché Note è già il posto dove si scrive, si salva uscendo
 * e si sincronizza: una seconda superficie di scrittura sarebbe un secondo
 * posto dove perdere un testo.
 */
export function modelloScenario(s: Scenario, nomeTema: string): { titolo: string; testo: string } {
  const rubrica = s.rubrica.map((r) => `- [ ] ${r}`).join("\n");
  return {
    titolo: `Scenario — ${nomeTema}`,
    testo: `${s.consegna}\n\n## Rubrica\n${rubrica}\n\n${MARCA_RISPOSTA}\n\n`,
  };
}

/**
 * Svolto vuol dire: la nota non è più il modello con cui è nata, e non è
 * vuota. Non si cerca la risposta sotto la marca, perché chi scrive può
 * riordinare o cancellarla; si accetta il prezzo che anche una modifica
 * minima alla rubrica conti come svolto: chi la fa sta lavorando sul caso.
 */
export function scenarioSvolto(testoNota: string | null | undefined, modello: string): boolean {
  const t = (testoNota ?? "").trim();
  return t.length > 0 && t !== modello.trim();
}
