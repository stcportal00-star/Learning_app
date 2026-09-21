import { useEffect, useState } from "react";
import { View, Text, Pressable, TextInput, ScrollView, Switch, Alert, Linking } from "react-native";
import { router } from "expo-router";
import { database } from "../lib/db";
import { leggiPromemoria, salvaPromemoria, applica, permessoConcesso, programmate } from "../lib/notifiche";
import { Promemoria, comeTesto, daTesto, prossimaOccorrenza, giaFattoOggi, testoNotifica } from "../lib/promemoria";
import { TipoBlocco, DURATA_PREVISTA } from "../lib/sessioni";

const TIPI: TipoBlocco[] = ["mattina", "artefatto", "lettura", "paper", "ripasso"];
const NOMI: Record<TipoBlocco, string> = {
  mattina: "Mattino", artefatto: "Artefatto", lettura: "Lettura",
  paper: "Paper", ripasso: "Ripasso",
};

/**
 * Un solo promemoria quotidiano, non una sveglia per ogni blocco: il piano
 * prevede un blocco al mattino, e una fila di notifiche si ignora in blocco.
 */
export default function SchermataPromemoria() {
  const [p, setP] = useState<Promemoria | null>(null);
  const [testoOra, setTestoOra] = useState("");
  const [permesso, setPermesso] = useState(true);
  const [inCoda, setInCoda] = useState(0);
  const [fattoOggi, setFattoOggi] = useState(false);

  useEffect(() => {
    (async () => {
      const letto = await leggiPromemoria();
      setP(letto);
      setTestoOra(comeTesto(letto));
      setPermesso(await permessoConcesso(false));
      setInCoda(await programmate());
      const righe = await database().getAllAsync<{ inizio: string }>(
        "SELECT inizio FROM sessioni WHERE tipo = ? ORDER BY inizio DESC LIMIT 20", [letto.tipo]);
      setFattoOggi(giaFattoOggi(letto, righe.map((r) => r.inizio), new Date()));
    })();
  }, []);

  async function aggiorna(nuovo: Promemoria, chiediPermesso: boolean) {
    setP(nuovo);
    await salvaPromemoria(nuovo);
    if (nuovo.attivo && chiediPermesso && !(await permessoConcesso(true))) {
      setPermesso(false);
      Alert.alert(
        "Permesso negato",
        "Android non consente a Percorso di mostrare notifiche. Concedilo dalle impostazioni del sistema, poi torna qui.",
        [{ text: "Annulla", style: "cancel" },
         { text: "Impostazioni", onPress: () => void Linking.openSettings() }]
      );
      return;
    }
    setPermesso(await permessoConcesso(false));
    await applica(nuovo);
    setInCoda(await programmate());
  }

  function confermaOra() {
    if (!p) return;
    const letto = daTesto(testoOra);
    if (!letto) {
      Alert.alert("Ora non valida", "Scrivila come 07:30.");
      setTestoOra(comeTesto(p));
      return;
    }
    void aggiorna({ ...p, ...letto }, p.attivo);
  }

  if (!p) return <View style={{ flex: 1 }} />;

  const prossima = prossimaOccorrenza(p, new Date());
  const anteprima = testoNotifica(p);

  return (
    <ScrollView contentContainerStyle={{ padding: 16, gap: 14 }}>
      <Pressable onPress={() => router.back()} hitSlop={12}>
        <Text style={{ color: "#0C447C", fontSize: 16 }}>←</Text>
      </Pressable>
      <Text style={{ fontSize: 22, fontWeight: "600" }}>Promemoria</Text>
      <Text style={{ fontSize: 13, opacity: 0.6, lineHeight: 19 }}>
        Notifica locale, programmata dal telefono. Non serve rete: funziona anche in aereo.
      </Text>

      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between",
                     borderWidth: 1, borderColor: "#E4E4E7", borderRadius: 11, padding: 14 }}>
        <Text style={{ fontSize: 16, fontWeight: "500" }}>Promemoria quotidiano</Text>
        <Switch value={p.attivo} onValueChange={(v) => void aggiorna({ ...p, attivo: v }, v)} />
      </View>

      {p.attivo && !permesso ? (
        <View style={{ backgroundColor: "#FDECEC", borderRadius: 10, padding: 12 }}>
          <Text style={{ fontSize: 13, color: "#A12B2B", lineHeight: 19 }}>
            Il promemoria è acceso ma Android non permette le notifiche: non suonerà.
            Concedi il permesso dalle impostazioni del sistema.
          </Text>
          <Pressable onPress={() => void Linking.openSettings()} style={{ marginTop: 8 }}>
            <Text style={{ color: "#0C447C", fontWeight: "600" }}>Apri impostazioni</Text>
          </Pressable>
        </View>
      ) : null}

      <View style={{ borderWidth: 1, borderColor: "#E4E4E7", borderRadius: 11, padding: 14, gap: 10 }}>
        <Text style={{ fontSize: 12, opacity: 0.6 }}>Ora</Text>
        <TextInput
          value={testoOra}
          onChangeText={setTestoOra}
          onBlur={confermaOra}
          onSubmitEditing={confermaOra}
          keyboardType="numbers-and-punctuation"
          placeholder="07:30"
          style={{ fontSize: 26, fontWeight: "500", paddingVertical: 4 }}
        />
        <Text style={{ fontSize: 12, opacity: 0.55 }}>
          Ora locale del dispositivo: durante il viaggio segue il fuso in cui ti trovi.
        </Text>
      </View>

      <View style={{ borderWidth: 1, borderColor: "#E4E4E7", borderRadius: 11, padding: 14, gap: 8 }}>
        <Text style={{ fontSize: 12, opacity: 0.6 }}>Blocco</Text>
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
          {TIPI.map((t) => (
            <Pressable key={t} onPress={() => void aggiorna({ ...p, tipo: t }, p.attivo)}
              style={{ paddingVertical: 7, paddingHorizontal: 12, borderRadius: 9,
                       backgroundColor: p.tipo === t ? "#18181B" : "#F4F4F5" }}>
              <Text style={{ fontSize: 13, color: p.tipo === t ? "#fff" : "#18181B" }}>
                {NOMI[t]} · {DURATA_PREVISTA[t]}′
              </Text>
            </Pressable>
          ))}
        </View>
      </View>

      <View style={{ backgroundColor: "#F4F4F5", borderRadius: 11, padding: 14, gap: 4 }}>
        <Text style={{ fontSize: 12, opacity: 0.6 }}>Anteprima</Text>
        <Text style={{ fontSize: 15, fontWeight: "500" }}>{anteprima.titolo}</Text>
        <Text style={{ fontSize: 13, opacity: 0.75 }}>{anteprima.corpo}</Text>
      </View>

      <Text style={{ fontSize: 13, opacity: 0.7, lineHeight: 20 }}>
        {p.attivo && prossima
          ? `Prossimo avviso: ${prossima.toLocaleString("it-IT", { weekday: "long", hour: "2-digit", minute: "2-digit" })}.`
          : "Nessun avviso programmato."}
        {p.attivo && fattoOggi ? " Il blocco di oggi risulta già registrato." : ""}
        {` In coda nel sistema: ${inCoda}.`}
      </Text>
    </ScrollView>
  );
}
