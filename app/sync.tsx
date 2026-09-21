import { useEffect, useState } from "react";
import { View, Text, Pressable, TextInput, ScrollView, Alert, ActivityIndicator } from "react-native";
import AsyncStorageLike from "expo-sqlite/kv-store";
import { generaAccoppiamento, leggiAccoppiamento, Accoppiamento } from "../lib/sync/accoppiamento";
import { salvaAccoppiamento, leggiAccoppiamentoSalvato, dimenticaAccoppiamento, divergenzaCorrente } from "../lib/sync/stato";
import { useAutoSync } from "../lib/sync/useAutoSync";
import { riassumi } from "../lib/sync/trasporto";
import { Divergenza } from "../lib/sync/auto";

export default function Sync() {
  const [dispositivo, setDispositivo] = useState("");
  const [accoppiato, setAccoppiato] = useState<Accoppiamento | null>(null);
  const [codiceMostrato, setCodiceMostrato] = useState<string | null>(null);
  const [inserito, setInserito] = useState("");
  const [divergenza, setDivergenza] = useState<Divergenza | null>(null);
  const [inCorso, setInCorso] = useState(false);

  const { ultimoDiario, sincronizzaOra } = useAutoSync(dispositivo);

  useEffect(() => {
    (async () => {
      setDispositivo((await AsyncStorageLike.getItem("dispositivo_id")) ?? "");
      setAccoppiato(await leggiAccoppiamentoSalvato());
      setDivergenza(await divergenzaCorrente());
    })();
  }, [ultimoDiario]);

  async function genera() {
    const a = generaAccoppiamento();
    setCodiceMostrato(a.codice);
    await salvaAccoppiamento(a);
    setAccoppiato(a);
  }

  async function collega() {
    try {
      const a = leggiAccoppiamento(inserito);
      await salvaAccoppiamento(a);
      setAccoppiato(a);
      setInserito("");
      Alert.alert("Accoppiato", "I due dispositivi ora condividono la stessa chiave.");
    } catch (e) {
      Alert.alert("Codice non valido", String(e));
    }
  }

  const coloreDivergenza =
    divergenza?.livello === "allineati" ? "#E8F5EE"
    : divergenza?.livello === "leggera" ? "#FDF0D5" : "#FDECEC";

  return (
    <ScrollView contentContainerStyle={{ padding: 16, gap: 14 }}>
      <Text style={{ fontSize: 22, fontWeight: "600" }}>Sincronizzazione</Text>

      {divergenza ? (
        <View style={{ padding: 12, borderRadius: 10, backgroundColor: coloreDivergenza }}>
          <Text style={{ fontSize: 13, lineHeight: 19 }}>{divergenza.messaggio}</Text>
          {divergenza.minutiDaUltimoScambio !== null ? (
            <Text style={{ fontSize: 12, opacity: 0.6, marginTop: 4 }}>
              Ultimo scambio {divergenza.minutiDaUltimoScambio} minuti fa
            </Text>
          ) : null}
        </View>
      ) : null}

      {!accoppiato ? (
        <View style={{ gap: 12 }}>
          <Text style={{ fontSize: 13, opacity: 0.7, lineHeight: 19 }}>
            Accoppia i tuoi due dispositivi una volta sola. Genera il codice su uno
            e trascrivilo sull'altro: da lì in poi la sincronizzazione è silenziosa.
          </Text>
          <Pressable onPress={genera}
            style={{ backgroundColor: "#18181B", padding: 14, borderRadius: 10, alignItems: "center" }}>
            <Text style={{ color: "#fff", fontWeight: "600" }}>Genera il codice su questo dispositivo</Text>
          </Pressable>
          <Text style={{ textAlign: "center", opacity: 0.5, fontSize: 12 }}>oppure</Text>
          <TextInput value={inserito} onChangeText={setInserito} autoCapitalize="characters"
            autoCorrect={false} placeholder="XXXX-XXXX-XXXX-XXXX-X"
            style={{ borderWidth: 1, borderColor: "#E4E4E7", borderRadius: 10, padding: 13,
                     fontFamily: "monospace", fontSize: 16, letterSpacing: 1 }} />
          <Pressable onPress={collega} disabled={inserito.length < 4}
            style={{ borderWidth: 1, borderColor: "#E4E4E7", padding: 14, borderRadius: 10, alignItems: "center" }}>
            <Text style={{ fontWeight: "600" }}>Inserisci il codice dell'altro dispositivo</Text>
          </Pressable>
        </View>
      ) : (
        <View style={{ gap: 12 }}>
          {codiceMostrato ? (
            <View style={{ padding: 16, backgroundColor: "#F4F4F5", borderRadius: 11 }}>
              <Text style={{ fontSize: 12, opacity: 0.6, marginBottom: 8 }}>
                Trascrivi questo codice sull'altro dispositivo
              </Text>
              <Text selectable style={{ fontFamily: "monospace", fontSize: 19, letterSpacing: 2 }}>
                {codiceMostrato}
              </Text>
              <Text style={{ fontSize: 11, opacity: 0.55, marginTop: 10, lineHeight: 16 }}>
                Non contiene I, L, O né U: ogni carattere è inequivocabile.
                Un errore di battitura viene rifiutato subito, non a metà scambio.
              </Text>
            </View>
          ) : (
            <View style={{ padding: 12, backgroundColor: "#E8F5EE", borderRadius: 10 }}>
              <Text style={{ fontSize: 13, color: "#0F6E56" }}>Dispositivi accoppiati.</Text>
            </View>
          )}

          <Pressable onPress={async () => { setInCorso(true); await sincronizzaOra(); setInCorso(false); }}
            disabled={inCorso}
            style={{ backgroundColor: inCorso ? "#A1A1AA" : "#18181B", padding: 15,
                     borderRadius: 10, alignItems: "center" }}>
            {inCorso ? <ActivityIndicator color="#fff" />
                     : <Text style={{ color: "#fff", fontWeight: "600" }}>Sincronizza adesso</Text>}
          </Pressable>

          <Text style={{ fontSize: 12, opacity: 0.6, lineHeight: 18 }}>
            In automatico l'app tenta prossimità e wi-fi locale ogni volta che torna in primo piano.
            Il file cifrato richiede due tocchi, quindi si usa solo quando premi qui.
            Nessuno dei tre ha bisogno di internet: funzionano in aereo.
          </Text>

          {ultimoDiario.length ? (
            <View style={{ padding: 12, backgroundColor: "#F4F4F5", borderRadius: 10 }}>
              <Text style={{ fontSize: 13, lineHeight: 19 }}>{riassumi(ultimoDiario)}</Text>
            </View>
          ) : null}

          <Pressable onPress={() =>
            Alert.alert("Dimenticare l'accoppiamento?",
              "Dovrai rigenerare il codice su entrambi i dispositivi.",
              [{ text: "Annulla", style: "cancel" },
               { text: "Dimentica", style: "destructive",
                 onPress: async () => { await dimenticaAccoppiamento(); setAccoppiato(null); setCodiceMostrato(null); } }])}>
            <Text style={{ fontSize: 12, color: "#A12B2B", textAlign: "center", marginTop: 6 }}>
              Dimentica l'accoppiamento
            </Text>
          </Pressable>
        </View>
      )}
    </ScrollView>
  );
}
