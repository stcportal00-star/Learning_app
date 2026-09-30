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

function modifica(f: (elenco: string[]) => string[]): Promise<string[]> {
  const turno = coda.catch(() => {}).then(async () => {
    const nuovo = f(await leggiSeguiti());
    await AsyncStorageLike.setItem(CHIAVE, JSON.stringify(nuovo));
    return nuovo;
  });
  coda = turno;
  return turno;
}

/** In coda agli altri: l'ordine dei progetti è quello in cui si sono scelti. */
export function segui(slug: string): Promise<string[]> {
  return modifica((e) => (e.includes(slug) ? e : [...e, slug]));
}

export function smettiDiSeguire(slug: string): Promise<string[]> {
  return modifica((e) => e.filter((s) => s !== slug));
}
