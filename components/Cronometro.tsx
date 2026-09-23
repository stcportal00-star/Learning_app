import { useEffect, useRef, useState } from "react";
import { View, Text, Pressable, Alert } from "react-native";
import * as Crypto from "expo-crypto";
import AsyncStorageLike from "expo-sqlite/kv-store";
import { registra } from "../lib/db";
import { chiudiSessione, DURATA_PREVISTA, TipoBlocco } from "../lib/sessioni";

const CHIAVE = "cronometro_attivo";
const ETICHETTE: Record<TipoBlocco, string> = {
  mattina: "Mattina", artefatto: "Artefatto", lettura: "Lettura", paper: "Paper", ripasso: "Ripasso",
};

/**
 * Il cronometro sopravvive alla chiusura dell'app: l'ora di inizio è salvata
 * in locale, non in memoria. Si può avviare sul telefono, chiudere l'app,
 * riaprirla un'ora dopo, e il blocco risulta comunque registrato.
 */
export default function Cronometro({ onRegistrata }: { onRegistrata?: () => void }) {
  const [attivo, setAttivo] = useState<{ inizio: number; tipo: TipoBlocco } | null>(null);
  const [adesso, setAdesso] = useState(Date.now());
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    (async () => {
      const v = await AsyncStorageLike.getItem(CHIAVE);
      if (v) setAttivo(JSON.parse(v));
    })();
  }, []);

  useEffect(() => {
    if (attivo) {
      timer.current = setInterval(() => setAdesso(Date.now()), 1000);
    }
    return () => { if (timer.current) clearInterval(timer.current); };
  }, [attivo]);

  async function avvia(tipo: TipoBlocco) {
    const stato = { inizio: Date.now(), tipo };
    await AsyncStorageLike.setItem(CHIAVE, JSON.stringify(stato));
    setAttivo(stato);
  }

  async function ferma() {
    if (!attivo) return;
    const esito = chiudiSessione(attivo.inizio, Date.now(), attivo.tipo);
    await AsyncStorageLike.removeItem(CHIAVE);
    const tipo = attivo.tipo;
    const inizio = attivo.inizio;
    setAttivo(null);

    if (!esito.valida) {
      Alert.alert("Non registrata", esito.motivo);
      return;
    }
    const id = Crypto.randomUUID();
    await registra("sessioni", id, "crea", { tipo, minuti: esito.minuti }, async (d, hlc) => {
      await d.runAsync(
        "INSERT INTO sessioni (id, tipo, inizio, minuti, hlc) VALUES (?,?,?,?,?)",
        [id, tipo, new Date(inizio).toISOString(), esito.minuti, hlc]);
    });
    if (esito.avviso) Alert.alert("Registrata", esito.avviso);
    onRegistrata?.();
  }

  if (attivo) {
    const trascorsi = Math.floor((adesso - attivo.inizio) / 1000);
    const previsti = DURATA_PREVISTA[attivo.tipo] * 60;
    const mm = String(Math.floor(trascorsi / 60)).padStart(2, "0");
    const ss = String(trascorsi % 60).padStart(2, "0");
    const oltre = trascorsi >= previsti;
    return (
      <View style={{ padding: 14, borderRadius: 12, backgroundColor: oltre ? "#FDF0D5" : "#18181B" }}>
        <Text style={{ fontSize: 12, color: oltre ? "#854F0B" : "#A1A1AA" }}>
          {ETICHETTE[attivo.tipo]} · previsti {DURATA_PREVISTA[attivo.tipo]} min
        </Text>
        <Text style={{ fontSize: 34, fontWeight: "500", color: oltre ? "#854F0B" : "#fff",
                       fontVariant: ["tabular-nums"], marginVertical: 4 }}>
          {mm}:{ss}
        </Text>
        <Pressable onPress={ferma}
          style={{ backgroundColor: oltre ? "#854F0B" : "#fff", padding: 12, borderRadius: 9, alignItems: "center" }}>
          <Text style={{ fontWeight: "600", color: oltre ? "#fff" : "#18181B" }}>Chiudi il blocco</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={{ gap: 8 }}>
      <Text style={{ fontSize: 13, fontWeight: "600" }}>Avvia un blocco</Text>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 7 }}>
        {(Object.keys(ETICHETTE) as TipoBlocco[]).map((t) => (
          <Pressable key={t} onPress={() => avvia(t)}
            style={{ paddingHorizontal: 13, paddingVertical: 10, borderRadius: 9,
                     borderWidth: 1, borderColor: "#E4E4E7" }}>
            <Text style={{ fontSize: 13, fontWeight: "500" }}>{ETICHETTE[t]}</Text>
            <Text style={{ fontSize: 11, opacity: 0.55 }}>{DURATA_PREVISTA[t]} min</Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}
