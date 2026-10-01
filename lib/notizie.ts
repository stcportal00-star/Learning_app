/**
 * Le notizie per categoria, come in un giornale: in primo piano, per te, e
 * una sezione per area. Le categorie sono le aree del piano (`AREE`), non i
 * trimestri: il trimestre di un articolo lo mette la conduttura e per cinque
 * temi non coincide con quello del piano, mentre l'area si ricava dal tema.
 *
 * La prima metà è logica pura (categorie, date, gruppi, righe) e si prova in
 * test/simulazione/notizie.mjs senza React Native; le letture sono in fondo.
 * Nessuna rete: il testo è già sul telefono, e qui non si legge nemmeno,
 * perché per un elenco basta sapere se c'è.
 */
import { database } from "./db";
import { AREE, TEMI } from "./contenuti";

export type Notizia = {
  id: string;
  titolo: string;
  autori: string | null;
  fonte: string | null;
  abstract: string | null;
  tema_slug: string | null;
  pubblicato_a: string | null;
  raccolto_a: string;
  letto: number;
  salvato: number;
  url_media: string | null;
  tipo_media: string | null;
  byte_media: number | null;
  file_media: string | null;
  ha_testo: number;
};

/** Lo slug della conduttura per gli articoli che nessun tema ha preso. */
export const ESPLORAZIONE = "esplorazione";

export type Categoria =
  | { tipo: "perte"; chiave: "perte"; nome: string }
  | { tipo: "titoli"; chiave: "titoli"; nome: string }
  | { tipo: "area"; chiave: string; nome: string; temi: string[] }
  | { tipo: "esplorazione"; chiave: "esplorazione"; nome: string }
  | { tipo: "salvati"; chiave: "salvati"; nome: string };

const AREA_DEL_TEMA = new Map(TEMI.map(([slug, , pista]) => [slug, pista]));
const NOME_DEL_TEMA = new Map(TEMI.map(([slug, nome]) => [slug, nome]));

export function nomeTema(slug: string | null): string | null {
  if (!slug) return null;
  if (slug === ESPLORAZIONE) return "Esplorazione";
  return NOME_DEL_TEMA.get(slug) ?? null;
}

/**
 * L'area di un tema. Un articolo senza tema, o con un tema che il piano non
 * conosce, finisce con l'esplorazione: sparire dall'elenco sarebbe peggio.
 */
export function areaDelTema(slug: string | null): string {
  return (slug && AREA_DEL_TEMA.get(slug)) || ESPLORAZIONE;
}

export function temiDellArea(pista: string): string[] {
  return TEMI.filter(([, , p]) => p === pista).map(([slug]) => slug);
}

/** Le categorie, sempre nello stesso ordine: una barra che cambia ordine si rilegge ogni volta. */
export function categorie(): Categoria[] {
  return [
    { tipo: "perte", chiave: "perte", nome: "Per te" },
    { tipo: "titoli", chiave: "titoli", nome: "In primo piano" },
    ...AREE.map(([chiave, nome]) => ({ tipo: "area" as const, chiave, nome, temi: temiDellArea(chiave) })),
    { tipo: "esplorazione", chiave: "esplorazione", nome: "Esplorazione" },
    { tipo: "salvati", chiave: "salvati", nome: "Salvati" },
  ];
}

// ------------------------------------------------------------------ date

const MESI = ["gen", "feb", "mar", "apr", "mag", "giu", "lug", "ago", "set", "ott", "nov", "dic"];

/**
 * La data di un articolo: quando è uscito, ma mai dopo il giorno in cui è
 * arrivato; se non si sa, quel giorno. Crossref preferisce la data del
 * fascicolo a stampa, che per un articolo uscito prima in rete cade mesi
 * avanti (nel catalogo vero, fino al 2121): presa così com'è, quell'articolo
 * starebbe in cima a ogni lista, «oggi», per settimane.
 *
 * Il giorno, non l'istante: le date d'uscita vere sono nude (mezzanotte UTC),
 * mentre raccolto_a ha l'ora della corsa. Con l'istante, un articolo senza
 * data o datato nel futuro veniva dopo mezzanotte e quindi prima di tutti
 * quelli della sua corsa, e faceva da notizia principale dell'area per tutto
 * il viaggio; con il giorno pareggia con loro, e decide la rilevanza.
 *
 * Le due date le scrive la stessa conduttura nello stesso formato, e si
 * confrontano come testo, come fa `DATA` nella query.
 */
export function dataDi(n: Pick<Notizia, "pubblicato_a" | "raccolto_a">): string {
  const p = n.pubblicato_a;
  return p && p <= n.raccolto_a ? p : `${n.raccolto_a.slice(0, 10)}T00:00:00+00:00`;
}

/**
 * Una data senza ora. La conduttura scrive le date nude come mezzanotte UTC
 * (pubblica.data_iso): dire «3 ore fa» di un articolo del giorno prima
 * sarebbe un'ora inventata.
 */
function soloGiorno(iso: string): boolean {
  return /^\d{4}-\d{2}-\d{2}(T00:00:00(\.0+)?(Z|\+00:00))?$/.test(iso);
}

/** Il giorno di calendario, nell'ora del telefono; per le date nude, il giorno scritto. */
function giorno(iso: string): Date | null {
  if (soloGiorno(iso)) {
    const [a, m, g] = iso.slice(0, 10).split("-").map(Number);
    return new Date(a, m - 1, g);
  }
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

/** Quanti giorni di calendario fa. Una data nel futuro vale oggi. */
function giorniFa(iso: string, adesso: Date): number | null {
  const g = giorno(iso);
  if (!g) return null;
  const oggi = new Date(adesso.getFullYear(), adesso.getMonth(), adesso.getDate());
  return Math.max(0, Math.round((oggi.getTime() - g.getTime()) / 864e5));
}

/** «adesso», «12 min fa», «3 ore fa», «ieri», «4 giorni fa», «12 set», «12 set 2025». */
export function quando(iso: string | null, adesso: Date): string {
  if (!iso) return "";
  const giorni = giorniFa(iso, adesso);
  if (giorni === null) return "";
  if (!soloGiorno(iso)) {
    const minuti = Math.floor((adesso.getTime() - new Date(iso).getTime()) / 60000);
    if (minuti < 1) return "adesso";
    if (minuti < 60) return `${minuti} min fa`;
    if (minuti < 24 * 60) {
      const ore = Math.floor(minuti / 60);
      return ore === 1 ? "1 ora fa" : `${ore} ore fa`;
    }
  }
  if (giorni === 0) return "oggi";
  if (giorni === 1) return "ieri";
  if (giorni < 7) return `${giorni} giorni fa`;
  const g = giorno(iso)!;
  return `${g.getDate()} ${MESI[g.getMonth()]}${g.getFullYear() === adesso.getFullYear() ? "" : ` ${g.getFullYear()}`}`;
}

export type Giorno = "Oggi" | "Ieri" | "Questa settimana" | "Prima";

export function gruppoDi(iso: string, adesso: Date): Giorno {
  const g = giorniFa(iso, adesso);
  if (g === null) return "Prima";
  if (g === 0) return "Oggi";
  if (g === 1) return "Ieri";
  if (g < 7) return "Questa settimana";
  return "Prima";
}

// ----------------------------------------------------------------- fonti

const ARCHIVI: Record<string, string> = {
  arxiv: "arXiv", openalex: "OpenAlex", doaj: "DOAJ", crossref: "Crossref", zenodo: "Zenodo",
  europepmc: "Europe PMC", doab: "DOAB", gutenberg: "Project Gutenberg", standard_ebooks: "Standard Ebooks",
};

/**
 * La fonte come la scrive un giornale. La conduttura scrive «rss[Nome del
 * feed]» per i feed, il nome dell'archivio per gli archivi aperti (a volte con
 * il tema fra parentesi), e «a+b» quando due fonti portano lo stesso articolo:
 * se ne mostra la prima. Il feed si riconosce prima di dividere sul «+»: il
 * nome di un feed viene da iTunes così com'è, e «Data + Society» esiste.
 */
export function fonteLeggibile(fonte: string | null): string {
  if (!fonte) return "";
  const rss = /^rss\[([^\]]*)\]/.exec(fonte.trim());
  if (rss) return rss[1].trim();
  const base = fonte.split("+")[0].trim().replace(/\[.*\]$/, "");
  return ARCHIVI[base] ?? base;
}

// ----------------------------------------------------------------- righe

/**
 * Quello che la lista disegna, già in ordine. Una lista sola per ogni vista,
 * perché una lista dentro una lista, su Android, non scorre bene.
 */
export type Riga =
  | { tipo: "sezione"; chiave: string; titolo: string; categoria: string | null }
  | { tipo: "principale"; chiave: string; notizia: Notizia }
  | { tipo: "voce"; chiave: string; notizia: Notizia }
  | { tipo: "vuoto"; chiave: string; testo: string };

/** In primo piano: per ogni area con qualcosa, la notizia principale e le tre dopo. */
export function righeTitoli(perArea: Array<{ chiave: string; nome: string; notizie: Notizia[] }>): Riga[] {
  const r: Riga[] = [];
  for (const a of perArea) {
    if (!a.notizie.length) continue;
    r.push({ tipo: "sezione", chiave: `s:${a.chiave}`, titolo: a.nome, categoria: a.chiave });
    a.notizie.slice(0, 4).forEach((n, i) =>
      r.push({ tipo: i === 0 ? "principale" : "voce", chiave: `${a.chiave}:${n.id}`, notizia: n }));
  }
  return r;
}

const GIORNI: Giorno[] = ["Oggi", "Ieri", "Questa settimana", "Prima"];

/**
 * Una categoria: le notizie per giorno (oggi, ieri, questa settimana, prima),
 * e la prima di ogni giorno in evidenza. Dentro il giorno, l'ordine in cui
 * arrivano.
 *
 * I giorni si riempiono e poi si scrivono nel loro ordine, invece di aprire
 * un giorno nuovo a ogni cambio: la query ordina per l'ora UTC, i giorni sono
 * quelli del telefono, e una data nuda vale il giorno scritto. A Città del
 * Messico un articolo delle 21 di ieri (le 3 UTC di oggi) viene prima di un
 * articolo di arXiv datato oggi, e si avevano «Ieri», «Oggi», «Ieri», con
 * due intestazioni dalla stessa chiave.
 */
export function righePerGiorno(notizie: Notizia[], adesso: Date): Riga[] {
  const perGiorno = new Map<Giorno, Notizia[]>(GIORNI.map((g) => [g, []]));
  for (const n of notizie) perGiorno.get(gruppoDi(dataDi(n), adesso))!.push(n);
  const r: Riga[] = [];
  for (const g of GIORNI) {
    const voci = perGiorno.get(g)!;
    if (!voci.length) continue;
    r.push({ tipo: "sezione", chiave: `g:${g}`, titolo: g, categoria: null });
    voci.forEach((n, i) => r.push({ tipo: i === 0 ? "principale" : "voce", chiave: n.id, notizia: n }));
  }
  return r;
}

/**
 * Le aree di «Per te»: quelle dei progetti, e senza progetti quella dell'unità
 * del piano. Si prende l'area intera e non il solo tema, perché cinque temi
 * del piano la conduttura non li assegna mai (gestione, SQL — join,
 * aggregazione, CTE e window functions): chi studia SQL — join leggerebbe una
 * sezione sempre vuota.
 */
export function areePerTe(temiAttivi: string[]): string[] {
  return [...new Set(temiAttivi.map(areaDelTema).filter((a) => a !== ESPLORAZIONE))];
}

/**
 * Che cosa dire quando una lista è vuota. Il consiglio deve potersi seguire:
 * «Tutti» non aiuta in una categoria che non ha articoli nemmeno letti, e
 * «segui un tema» non si può fare quando tutte le unità sono superate — che
 * è l'unico caso in cui «Per te» resta senza aree, perché senza progetti
 * prende quella del piano.
 */
export function messaggioVuoto(o: {
  tipo: Categoria["tipo"];
  /** Sul telefono non c'è nessun articolo. */
  nessunArticolo: boolean;
  /** Quante aree ha «Per te». */
  areePerTe: number;
  /** Gli articoli della categoria, letti o no. */
  inCategoria: number;
  soloDaLeggere: boolean;
}): string {
  if (o.nessunArticolo) {
    return "Niente ancora. La rassegna gira ogni mattina alle otto e deposita quello che trova; l'app lo ritira da sola appena c'è rete.";
  }
  if (o.tipo === "salvati") return "Nessun articolo salvato. Nell'articolo, «Salva» lo tiene qui.";
  if (o.tipo === "perte" && !o.areePerTe) {
    return "Hai superato tutte le unità: le notizie di ogni area sono in «In primo piano».";
  }
  if (!o.inCategoria) return "Nessun articolo in questa categoria, per ora.";
  if (o.soloDaLeggere) return "Niente da leggere qui. «Tutti» mostra anche gli articoli già letti.";
  return "Nessun articolo in questa categoria.";
}

// --------------------------------------------------------------- letture

const COLONNE = `id, titolo, autori, fonte, abstract, tema_slug, pubblicato_a, raccolto_a, letto, salvato,
  url_media, tipo_media, byte_media, file_media, (testo IS NOT NULL AND testo <> '') AS ha_testo`;

/**
 * La stessa data di dataDi(), in SQL. Per data d'uscita e non d'arrivo: la
 * conduttura dà a tutti gli articoli di una corsa lo stesso raccolto_a.
 */
const DATA = `CASE WHEN pubblicato_a IS NOT NULL AND pubblicato_a <= raccolto_a THEN pubblicato_a
  ELSE substr(raccolto_a, 1, 10) || 'T00:00:00+00:00' END`;
/**
 * L'HLC con cui l'articolo è nato: quello del suo primo evento. pubblica.py
 * scrive gli eventi di una corsa in ordine di rilevanza, con un HLC che
 * cresce, e quello della nascita non lo cambia più nessuno. Il `hlc` della
 * riga invece è dell'ultima scrittura: «Segna da leggere», «Salva» o lo
 * stesso evento arrivato dal tablet gliene danno uno nuovo, e un articolo
 * tenuto da parte finiva in fondo al suo giorno, fuori da In primo piano. La
 * ricerca usa eventi_entita_idx. Senza eventi (nelle prove, o un articolo
 * scritto a mano) vale il `hlc` della riga.
 */
const NASCITA = `COALESCE((SELECT min(e.hlc) FROM eventi e
  WHERE e.entita = 'articoli' AND e.entita_id = articoli.id), hlc)`;

/**
 * Il giorno, poi la corsa, poi la rilevanza dentro la corsa. Le date d'uscita
 * sono quasi tutte nude, e in un giorno ne cadono decine, anche di corse
 * diverse. La rilevanza si confronta solo dentro una corsa (gli HLC di due
 * corse non dicono niente l'uno dell'altro, e sul telefono il punteggio non
 * c'è): a parità di giorno viene prima la corsa più recente, e dentro la corsa
 * la più rilevante, non la prima in ordine alfabetico.
 */
const PER_DATA = `ORDER BY substr(${DATA}, 1, 10) DESC, raccolto_a DESC, ${NASCITA}, titolo`;

export type Filtro = {
  /** null: ogni tema. Un elenco vuoto non trova niente. */
  temi: string[] | null;
  /** Gli articoli senza tema o con un tema che il piano non conosce. */
  fuoriDalPiano?: boolean;
  soloDaLeggere: boolean;
  soloSalvati?: boolean;
  limite: number;
};

export async function leggiNotizie(f: Filtro): Promise<Notizia[]> {
  const dove: string[] = [];
  const valori: Array<string | number> = [];
  if (f.temi) {
    if (!f.temi.length) return [];
    dove.push(`tema_slug IN (${f.temi.map(() => "?").join(",")})`);
    valori.push(...f.temi);
  }
  if (f.fuoriDalPiano) {
    const noti = TEMI.map(([slug]) => slug);
    dove.push(`(tema_slug IS NULL OR tema_slug NOT IN (${noti.map(() => "?").join(",")}))`);
    valori.push(...noti);
  }
  if (f.soloDaLeggere) dove.push("letto = 0");
  if (f.soloSalvati) dove.push("salvato = 1");
  valori.push(f.limite);
  return database().getAllAsync<Notizia>(
    `SELECT ${COLONNE} FROM articoli ${dove.length ? "WHERE " + dove.join(" AND ") : ""} ${PER_DATA} LIMIT ?`,
    valori);
}

/** Quanti articoli per tema, da leggere e in tutto: i numeri della barra e dei filtri. */
export async function contaPerTema(): Promise<Array<{ tema_slug: string | null; daLeggere: number; tutti: number }>> {
  return database().getAllAsync(
    `SELECT tema_slug, sum(letto = 0) AS daLeggere, count(*) AS tutti FROM articoli GROUP BY tema_slug`);
}

/** Da `contaPerTema()` ai numeri per categoria. */
export function contaPerCategoria(
  righe: Array<{ tema_slug: string | null; daLeggere: number; tutti: number }>, soloDaLeggere: boolean,
): Map<string, number> {
  const m = new Map<string, number>();
  for (const r of righe) {
    const n = soloDaLeggere ? r.daLeggere : r.tutti;
    const a = areaDelTema(r.tema_slug);
    m.set(a, (m.get(a) ?? 0) + n);
  }
  return m;
}
