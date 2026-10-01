/**
 * I temi seguiti: i progetti che si portano avanti in parallelo. Quale unità
 * e quale passo tocchino a ciascuno lo decide progetti() in lib/percorso.ts;
 * qui si ricorda soltanto la scelta.
 *
 * La scelta sta nel kv-store di questo dispositivo, come i promemoria, e non
 * nel registro degli eventi. L'avanzamento da cui i progetti si calcolano è
 * per dispositivo (CLAUDE.md, «L'avanzamento è per dispositivo»): una scelta
 * sincronizzata indicherebbe sull'altro telefono unità a un punto diverso, e
 * un evento nuovo vorrebbe una tabella nuova anche sulla nuvola.
 */
import AsyncStorageLike from "expo-sqlite/kv-store";

const CHIAVE = "percorso.seguiti";
/** Il seguito che ogni tema superato aveva l'ultima volta: vedi progetti(). */
const CHIAVE_SUBENTRATE = "percorso.subentrate";

/**
 * Il valore salvato, ripulito. Un valore illeggibile vale «nessun tema
 * seguito»: si torna al percorso del piano, e Oggi si apre lo stesso.
 */
export function elencoSeguiti(valore: string | null): string[] {
  try {
    const v = JSON.parse(valore ?? "[]");
    if (!Array.isArray(v)) return [];
    return [...new Set(v.filter((x): x is string => typeof x === "string" && x.length > 0))];
  } catch {
    return [];
  }
}

export async function leggiSeguiti(): Promise<string[]> {
  try {
    return elencoSeguiti(await AsyncStorageLike.getItem(CHIAVE));
  } catch {
    return [];
  }
}

// Uno alla volta: due tocchi ravvicinati («Segui» su un tema, «Smetti» su un
// altro) leggerebbero lo stesso elenco, e la seconda scrittura cancellerebbe
// la prima.
let coda: Promise<unknown> = Promise.resolve();

function inCoda<T>(f: () => Promise<T>): Promise<T> {
  const turno = coda.catch(() => {}).then(f);
  coda = turno;
  return turno;
}

function modifica(f: (elenco: string[]) => string[]): Promise<string[]> {
  return inCoda(async () => {
    const nuovo = f(await leggiSeguiti());
    await AsyncStorageLike.setItem(CHIAVE, JSON.stringify(nuovo));
    return nuovo;
  });
}

/** Il valore salvato dei seguiti, ripulito; illeggibile vale «nessuno». */
export function elencoSubentrate(valore: string | null): Record<string, string> {
  try {
    const v = JSON.parse(valore ?? "{}");
    if (!v || typeof v !== "object" || Array.isArray(v)) return {};
    return Object.fromEntries(Object.entries(v).filter(
      (x): x is [string, string] => typeof x[1] === "string" && x[0].length > 0 && x[1].length > 0));
  } catch {
    return {};
  }
}

export async function leggiSubentrate(): Promise<Record<string, string>> {
  try {
    return elencoSubentrate(await AsyncStorageLike.getItem(CHIAVE_SUBENTRATE));
  } catch {
    return {};
  }
}

/**
 * Ricorda i seguiti di adesso. Si scrive solo se cambiano: Oggi e Studio lo
 * chiamano a ogni ritorno in primo piano. Un errore non conta: senza il
 * ricordo si ricade nell'ordine del piano, che è comunque una risposta.
 */
export function ricordaSubentrate(m: Record<string, string>): Promise<void> {
  return inCoda(async () => {
    const nuovo = JSON.stringify(m);
    if (JSON.stringify(await leggiSubentrate()) === nuovo) return;
    await AsyncStorageLike.setItem(CHIAVE_SUBENTRATE, nuovo);
  }).catch(() => {});
}

/** In coda agli altri: l'ordine dei progetti è quello in cui si sono scelti. */
export function segui(slug: string): Promise<string[]> {
  return modifica((e) => (e.includes(slug) ? e : [...e, slug]));
}

export function smettiDiSeguire(slug: string): Promise<string[]> {
  return modifica((e) => e.filter((s) => s !== slug));
}
