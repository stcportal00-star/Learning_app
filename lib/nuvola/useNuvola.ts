/**
 * Quando parlare con Supabase.
 *
 * Il requisito è «appena torna in rete». Senza un modulo nativo che avvisi del
 * cambio di connettività — e aggiungerne uno significherebbe una dipendenza in
 * più (invariante 8) — la cosa onesta è provarci spesso finché è offline e di
 * rado quando è allineato. In pratica il momento che conta è uno solo:
 * l'utente riprende in mano il telefono, l'app torna in primo piano, e lì si
 * tenta subito. I timer in secondo piano su Android non girano comunque.
 *
 * Sta montato nella radice, non in una schermata: se vivesse dentro
 * `app/sync.tsx` — che è dove vive `useAutoSync` — non girerebbe mai, perché
 * quella schermata non la apre nessuno.
 */
import { useEffect, useRef, useState } from "react";
import { AppState, AppStateStatus } from "react-native";
import { sincronizzaNuvola, EsitoNuvola } from "./sincronia";

const QUANDO_VA = 10 * 60_000;
const QUANDO_NON_VA = 60_000;

export function useNuvola(dispositivo: string) {
  const [ultimo, setUltimo] = useState<EsitoNuvola | null>(null);
  const inCorso = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  async function tenta(): Promise<EsitoNuvola | null> {
    if (inCorso.current) return null;
    inCorso.current = true;
    try {
      const e = await sincronizzaNuvola();
      setUltimo(e);
      return e;
    } catch {
      // `sincronizzaNuvola` non rilancia: se ci arriviamo è un guasto di
      // programmazione, e non deve comunque poter far cadere l'app.
      return null;
    } finally {
      inCorso.current = false;
    }
  }

  useEffect(() => {
    // Finché la radice non ha letto l'identificativo del dispositivo e aperto
    // il database non c'è niente da scambiare, e `database()` solleverebbe.
    if (!dispositivo) return;
    let vivo = true;

    async function giro() {
      const e = await tenta();
      if (!vivo) return;
      timer.current = setTimeout(giro, e?.riuscito ? QUANDO_VA : QUANDO_NON_VA);
    }

    const sub = AppState.addEventListener("change", (s: AppStateStatus) => {
      if (s === "active") void tenta();
    });
    void giro();

    return () => {
      vivo = false;
      sub.remove();
      if (timer.current) clearTimeout(timer.current);
    };
  }, [dispositivo]);

  return { ultimo, sincronizzaOra: tenta };
}
