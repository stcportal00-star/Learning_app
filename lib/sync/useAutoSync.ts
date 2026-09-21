/**
 * Tentativo automatico di scambio quando l'app torna in primo piano.
 *
 * Con entrambi i dispositivi in tasca, questo è il meccanismo che evita la
 * divergenza: prendi il telefono, l'app si riallinea prima che tu cominci.
 * Se non ci riesce, non disturba: lo dirà il riquadro nella schermata Oggi.
 */
import { useEffect, useRef, useState } from "react";
import { AppState, AppStateStatus } from "react-native";
import { daSincronizzare, segnaSincronizzati, database } from "../db";
import { sincronizza, DiarioSync } from "./trasporto";
import { TrasportoFile } from "./file";
import { TrasportoWifi } from "./wifi";
import { TrasportoVicinanza } from "./vicinanza";
import { fondi } from "./fusione";
import { EventoSerializzato } from "./pacchetto";
import { decisioneCorrente, passphraseCorrente, registraScambio } from "./stato";

export function useAutoSync(dispositivo: string) {
  const [ultimoDiario, setUltimoDiario] = useState<DiarioSync>([]);
  const inCorso = useRef(false);

  async function tenta(forzato = false) {
    if (inCorso.current) return;
    const decisione = await decisioneCorrente(false);
    if (!forzato && !decisione.tenta) return;

    const passphrase = await passphraseCorrente();
    if (!passphrase) return;

    inCorso.current = true;
    try {
      const daInviare = (await daSincronizzare()) as unknown as EventoSerializzato[];
      const r = await sincronizza(
        [
          new TrasportoVicinanza(dispositivo),
          new TrasportoWifi(dispositivo),
          // Il file richiede due tocchi: in automatico si prova solo se forzato.
          ...(forzato ? [new TrasportoFile(dispositivo)] : []),
        ],
        daInviare,
        { passphrase, timeoutMs: 15_000 }
      );
      setUltimoDiario(r.diario);

      if (r.esito) {
        const d = database();
        const locali = await d.getAllAsync<EventoSerializzato>(
          "SELECT id, hlc, dispositivo, entita, entita_id, tipo, payload FROM eventi"
        );
        const f = fondi(locali, r.esito.ricevuti);
        await d.withTransactionAsync(async () => {
          for (const e of f.nuovi) {
            await d.runAsync(
              `INSERT OR IGNORE INTO eventi
               (id, hlc, dispositivo, entita, entita_id, tipo, payload, sincronizzato)
               VALUES (?,?,?,?,?,?,?,1)`,
              [e.id, e.hlc, e.dispositivo, e.entita, e.entita_id, e.tipo, e.payload]
            );
          }
        });
        await segnaSincronizzati(daInviare.map((e) => e.id));
      }
      await registraScambio(Boolean(r.esito));
    } catch {
      await registraScambio(false);
    } finally {
      inCorso.current = false;
    }
  }

  useEffect(() => {
    const sub = AppState.addEventListener("change", (s: AppStateStatus) => {
      if (s === "active") void tenta(false);
    });
    void tenta(false);
    const timer = setInterval(() => void tenta(false), 5 * 60_000);
    return () => { sub.remove(); clearInterval(timer); };
  }, [dispositivo]);

  return { ultimoDiario, sincronizzaOra: () => tenta(true) };
}
