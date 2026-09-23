/**
 * Motore di fusione.
 *
 * Il registro eventi è append-only, quindi fondere due dispositivi è
 * concatenare e deduplicare. Non esistono conflitti a livello di registro:
 * esistono solo a livello di PROIEZIONE, quando due dispositivi hanno
 * modificato lo stesso campo della stessa entità.
 *
 * Regola di risoluzione: vince l'HLC più alto. Poiché l'HLC include
 * l'identificativo del dispositivo come ultimo criterio, la risoluzione è
 * deterministica: i due dispositivi arrivano allo stesso stato finale
 * indipendentemente dall'ordine in cui si sincronizzano.
 *
 * Tutto qui dentro è puro: nessun accesso al database, nessuna rete.
 * È ciò che lo rende collaudabile.
 */
import { EventoSerializzato } from "./pacchetto";

export type EsitoFusione = {
  nuovi: EventoSerializzato[];
  duplicati: number;
  conflitti: Array<{ entita: string; entita_id: string; campo: string; vincitore: string }>;
  entitaToccate: Array<{ entita: string; entita_id: string }>;
};

/** Ordine causale: l'HLC è già ordinabile come stringa. */
export function ordinaEventi(e: EventoSerializzato[]): EventoSerializzato[] {
  return [...e].sort((a, b) => (a.hlc < b.hlc ? -1 : a.hlc > b.hlc ? 1 : a.id < b.id ? -1 : 1));
}

/**
 * Determina quali eventi remoti sono davvero nuovi e quali campi entrano in
 * conflitto con quanto già presente in locale.
 *
 * Non applica nulla: restituisce il piano. L'applicazione avviene in una sola
 * transazione, così una sincronizzazione interrotta non lascia stato parziale.
 */
export function fondi(
  locali: EventoSerializzato[],
  remoti: EventoSerializzato[]
): EsitoFusione {
  const idLocali = new Set(locali.map((e) => e.id));
  const nuovi: EventoSerializzato[] = [];
  let duplicati = 0;

  for (const r of remoti) {
    if (idLocali.has(r.id)) {
      duplicati++;
      continue;
    }
    nuovi.push(r);
    idLocali.add(r.id);
  }

  // Ultimo valore per campo, considerando il registro completo dopo la fusione
  const ultimo = new Map<string, { hlc: string; dispositivo: string }>();
  const conflitti: EsitoFusione["conflitti"] = [];

  for (const e of ordinaEventi([...locali, ...nuovi])) {
    let payload: Record<string, unknown>;
    try {
      payload = JSON.parse(e.payload) as Record<string, unknown>;
    } catch {
      payload = {};
    }
    const campi = e.tipo === "elimina" ? ["__eliminato"] : Object.keys(payload);
    for (const campo of campi) {
      const chiave = `${e.entita}\u001f${e.entita_id}\u001f${campo}`;
      const precedente = ultimo.get(chiave);
      if (precedente && precedente.dispositivo !== e.dispositivo) {
        conflitti.push({
          entita: e.entita,
          entita_id: e.entita_id,
          campo,
          vincitore: e.dispositivo,
        });
      }
      ultimo.set(chiave, { hlc: e.hlc, dispositivo: e.dispositivo });
    }
  }

  const viste = new Set<string>();
  const entitaToccate: EsitoFusione["entitaToccate"] = [];
  for (const e of nuovi) {
    const k = `${e.entita}\u001f${e.entita_id}`;
    if (!viste.has(k)) {
      viste.add(k);
      entitaToccate.push({ entita: e.entita, entita_id: e.entita_id });
    }
  }

  return { nuovi: ordinaEventi(nuovi), duplicati, conflitti, entitaToccate };
}

/**
 * Ricostruisce lo stato di un'entità dal registro: ultimo valore per campo,
 * secondo l'ordine HLC. Una eliminazione successiva a una modifica vince;
 * una modifica successiva a una eliminazione la resuscita, ed è voluto:
 * l'utente ha riscritto dopo aver cancellato.
 */
export function proietta(
  eventi: EventoSerializzato[],
  entita: string,
  entitaId: string
): Record<string, unknown> | null {
  let stato: Record<string, unknown> | null = null;
  for (const e of ordinaEventi(eventi)) {
    if (e.entita !== entita || e.entita_id !== entitaId) continue;
    if (e.tipo === "elimina") {
      stato = null;
      continue;
    }
    let payload: Record<string, unknown>;
    try {
      payload = JSON.parse(e.payload) as Record<string, unknown>;
    } catch {
      continue;
    }
    stato = { ...(stato ?? {}), ...payload };
  }
  return stato;
}

/**
 * Due dispositivi hanno lo stesso stato dopo la fusione?
 * Usato dai test e dalla diagnostica in app.
 */
export function impronta(eventi: EventoSerializzato[]): string {
  const ids = ordinaEventi(eventi).map((e) => e.id);
  let h = 0;
  for (const s of ids) {
    for (let i = 0; i < s.length; i++) {
      h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
    }
  }
  return `${ids.length}:${(h >>> 0).toString(16)}`;
}
