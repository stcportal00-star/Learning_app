import { useEffect, useState } from "react";
import { View, Text, Pressable, ActivityIndicator } from "react-native";
import Constants from "expo-constants";
import {
  Stato, statoNoto, controlla, scaricaRelease, installa, megabyte, numeroCorsa,
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
  const [lavoro, setLavoro] = useState<"" | "controllo" | "scarico" | "installa">("");
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
      // Le istruzioni PRIMA di aprire l'installatore: la promessa si risolve
      // solo quando l'installatore si chiude, e se l'installazione riesce
      // Android chiude anche l'app, quindi dopo non c'è nessuno a leggerle.
      setLavoro("installa");
      setAvviso("Conferma nell'installatore di Android. La prima volta chiede di consentire le installazioni da Percorso: consentile e torna qui. I dati restano.");
      const esito2 = await installa(esito.uri);
      // Se siamo ancora qui, l'installazione non è avvenuta.
      setAvviso(esito2 === "aperto"
        ? "L'aggiornamento non è stato installato (annullato, o in attesa del consenso). Il file è già scaricato: tocca di nuovo per riprovare, senza riscaricarlo."
        : esito2 === "mancante"
          ? "Il file scaricato non c'è più: tocca di nuovo per riscaricarlo."
          : "Android non ha aperto l'installatore. Il file è scaricato: riprova fra un momento.");
    } finally {
      setLavoro("");
    }
  }

  const testo = !stato ? "…"
    : stato.tipo === "disponibile"
      ? `Nuova versione: build ${stato.ultima.corsa} (${megabyte(stato.ultima.byte)}). Stai usando la ${CORSA}.`
    : stato.tipo === "aggiornata"
      // Due casi, da non confondere: sul telefono c'è l'ultima di main, oppure
      // una build di un ramo più recente. Dire «la più recente di main» nel
      // secondo caso era falso: il test di fumo l'ha mostrato sulla build 28.
      ? ((numeroCorsa(CORSA) ?? 0) > stato.ultima.corsa
        ? `Aggiornata: questa build (${CORSA}) è più recente dell'ultima di main (${stato.ultima.corsa}).`
        : `Aggiornata: è l'ultima build di main (${stato.ultima.corsa}).`)
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
              {/* Lo scarico occupa la coda dei moduli Expo, la stessa da cui passa
                  l'apertura di un PDF: fino alla fine, un PDF può tardare. */}
              {lavoro === "scarico" && stato && stato.tipo !== "ignoto"
                ? `Scarico ${megabyte(stato.ultima.byte)}… fino alla fine, i PDF possono tardare ad aprirsi.`
                : lavoro === "installa" ? "In attesa dell'installatore…" : "Controllo…"}
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
