import { useEffect, useState } from "react";
import { View, Text, Pressable, ActivityIndicator } from "react-native";
import Constants from "expo-constants";
import {
  Stato, statoNoto, controlla, scaricaRelease, installa, megabyte,
} from "../lib/aggiornamenti";

/** Il numero di corsa di QUESTA build, o null se è stata compilata a mano. */
const CORSA = ((Constants.expoConfig?.extra ?? {}) as { corsa?: string | null }).corsa ?? null;

/**
 * Il riquadro degli aggiornamenti.
 *
 * In Oggi (`compatto`) compare solo quando c'è qualcosa da installare: una
 * riga che dice «tutto a posto» ogni mattina smette di essere letta, e il
 * giorno che dice altro non la legge nessuno. In Profilo c'è sempre, con il
 * controllo a mano.
 *
 * Lo stato noto si mostra subito, senza rete; il controllo nuovo parte dietro
 * e aggiorna il riquadro se trova qualcosa. Nessuna rotella in attesa della
 * rete, se non dopo un tocco di chi l'ha chiesto.
 */
export default function Aggiornamento({ compatto = false }: { compatto?: boolean }) {
  const [stato, setStato] = useState<Stato | null>(null);
  const [lavoro, setLavoro] = useState<"" | "controllo" | "scarico">("");
  const [avviso, setAvviso] = useState("");

  useEffect(() => {
    let vivo = true;
    (async () => {
      const noto = await statoNoto(CORSA);
      if (vivo) setStato(noto);
      const nuovo = await controlla(CORSA);
      if (vivo) setStato(nuovo);
    })();
    return () => { vivo = false; };
  }, []);

  if (compatto && stato?.tipo !== "disponibile") return null;

  async function controllaOra() {
    setLavoro("controllo");
    setAvviso("");
    try {
      setStato(await controlla(CORSA, { forza: true }));
    } finally {
      setLavoro("");
    }
  }

  async function scaricaEInstalla() {
    if (!stato || stato.tipo === "ignoto") return;
    setLavoro("scarico");
    setAvviso("");
    try {
      const esito = await scaricaRelease(stato.ultima);
      if (!esito.uri) {
        setAvviso(esito.errore ?? "scaricamento non riuscito");
        return;
      }
      const aperto = await installa(esito.uri);
      setAvviso(aperto === "aperto"
        ? "Android chiede di confermare. La prima volta chiede anche di consentire le installazioni da Percorso: consentile e torna indietro. I dati restano."
        : "Android non ha aperto l'installatore. Il file è scaricato: riprova fra un momento.");
    } finally {
      setLavoro("");
    }
  }

  const testo = !stato ? "…"
    : stato.tipo === "disponibile"
      ? `Nuova versione: build ${stato.ultima.corsa} (${megabyte(stato.ultima.byte)}). Stai usando la ${CORSA}.`
    : stato.tipo === "aggiornata"
      ? `Aggiornata: la build ${CORSA} è la più recente di main (ultima: ${stato.ultima.corsa}).`
    : stato.tipo === "locale"
      ? `Build compilata a mano. L'ultima di main è la ${stato.ultima.corsa} (${megabyte(stato.ultima.byte)}): installala solo se è più recente di questa.`
      : `Non so se ci sono aggiornamenti: ${stato.motivo}.`;

  const puoiScaricare = stato?.tipo === "disponibile" || stato?.tipo === "locale";
  const evidenza = stato?.tipo === "disponibile";

  return (
    <View style={{ padding: 13, borderRadius: 11, borderWidth: 1,
                   borderColor: evidenza ? "#B5D4F4" : "#E4E4E7",
                   backgroundColor: evidenza ? "#EEF5FC" : undefined }}>
      <Text style={{ fontSize: 15, fontWeight: "600" }}>Aggiornamenti</Text>
      <Text style={{ fontSize: 13, opacity: 0.75, marginTop: 3, lineHeight: 18 }}>{testo}</Text>
      {avviso ? (
        <Text style={{ fontSize: 12, opacity: 0.7, marginTop: 6, lineHeight: 17 }}>{avviso}</Text>
      ) : null}
      <View style={{ flexDirection: "row", gap: 8, marginTop: 10, alignItems: "center" }}>
        {lavoro ? (
          <>
            <ActivityIndicator />
            <Text style={{ fontSize: 12, opacity: 0.6 }}>
              {lavoro === "scarico" && stato && stato.tipo !== "ignoto"
                ? `Scarico ${megabyte(stato.ultima.byte)}…` : "Controllo…"}
            </Text>
          </>
        ) : (
          <>
            {puoiScaricare ? (
              <Pressable onPress={scaricaEInstalla}
                style={{ paddingHorizontal: 13, paddingVertical: 8, borderRadius: 9, backgroundColor: "#185FA5" }}>
                <Text style={{ fontSize: 13, fontWeight: "600", color: "#FFFFFF" }}>Scarica e installa</Text>
              </Pressable>
            ) : null}
            {!compatto ? (
              <Pressable onPress={controllaOra}
                style={{ paddingHorizontal: 13, paddingVertical: 8, borderRadius: 9, backgroundColor: "#F4F4F5" }}>
                <Text style={{ fontSize: 13, fontWeight: "600" }}>Controlla ora</Text>
              </Pressable>
            ) : null}
          </>
        )}
      </View>
    </View>
  );
}
