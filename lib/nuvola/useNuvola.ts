/**
 * Quando parlare con Supabase.
 *
 * Il requisito è «appena torna in rete». Si prova spesso finché è offline e
 * di rado quando è allineato, e subito in due momenti: quando l'app torna in
 * primo piano, e quando arriva il wifi (expo-network, nel catalogo dell'SDK:
 * invariante 8). Il secondo l'ha chiesto l'utente: col wifi si scarica tutto,
 * e aspettare il giro dei dieci minuti vorrebbe dire perdere il wifi di un
 * caffè. I timer in secondo piano su Android non girano comunque: con l'app
 * chiusa non scende niente.
 *
 * Sta montato nella radice, non in una schermata: se vivesse dentro
 * `app/sync.tsx` — che è dove vive `useAutoSync` — non girerebbe mai, perché
 * quella schermata non la apre nessuno.
 */
import { useEffect, useRef, useState } from "react";
import { AppState, AppStateStatus } from "react-native";
import { sincronizzaNuvola, EsitoNuvola } from "./sincronia";
import { quandoArrivaIlWifi } from "./rete";

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
    const smettiWifi = quandoArrivaIlWifi(() => void tenta());
    void giro();

    return () => {
      vivo = false;
      sub.remove();
      smettiWifi();
      if (timer.current) clearTimeout(timer.current);
    };
  }, [dispositivo]);

  return { ultimo, sincronizzaOra: tenta };
}
