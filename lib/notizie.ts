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

/** La data di un articolo: quando è uscito, e se non si sa, quando è arrivato. */
export function dataDi(n: Pick<Notizia, "pubblicato_a" | "raccolto_a">): string {
  return n.pubblicato_a || n.raccolto_a;
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
 * se ne mostra la prima.
 */
export function fonteLeggibile(fonte: string | null): string {
  if (!fonte) return "";
  const prima = fonte.split("+")[0].trim();
  const rss = /^rss\[(.*)\]$/.exec(prima);
  if (rss) return rss[1].trim();
  const base = prima.replace(/\[.*\]$/, "");
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

/**
 * Una categoria: le notizie per giorno (oggi, ieri, questa settimana, prima),
 * e la prima di ogni giorno in evidenza. L'ordine dentro il giorno è quello
 * che arriva, cioè per data.
 */
export function righePerGiorno(notizie: Notizia[], adesso: Date): Riga[] {
  const r: Riga[] = [];
  let ultimo: Giorno | null = null;
  for (const n of notizie) {
    const g = gruppoDi(dataDi(n), adesso);
    const nuovo = g !== ultimo;
    if (nuovo) r.push({ tipo: "sezione", chiave: `g:${g}`, titolo: g, categoria: null });
    r.push({ tipo: nuovo ? "principale" : "voce", chiave: n.id, notizia: n });
    ultimo = g;
  }
  return r;
}

/**
 * Le aree di «Per te»: quelle dei progetti, e senza progetti quella dell'unità
 * del piano. Si prende l'area intera e non il solo tema, perché cinque temi
 * del piano la conduttura non li assegna mai (le parti di SQL): chi studia
 * SQL — fondamenti leggerebbe una sezione sempre vuota.
 */
export function areePerTe(temiAttivi: string[]): string[] {
  return [...new Set(temiAttivi.map(areaDelTema).filter((a) => a !== ESPLORAZIONE))];
}

// --------------------------------------------------------------- letture

const COLONNE = `id, titolo, autori, fonte, abstract, tema_slug, pubblicato_a, raccolto_a, letto, salvato,
  url_media, tipo_media, byte_media, file_media, (testo IS NOT NULL AND testo <> '') AS ha_testo`;

/** Per data d'uscita: la conduttura dà a tutti gli articoli di una corsa lo stesso raccolto_a. */
const PER_DATA = "ORDER BY COALESCE(pubblicato_a, raccolto_a) DESC, titolo";

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
