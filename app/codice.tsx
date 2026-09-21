import { useEffect, useState } from "react";
import { View, Text, TextInput, Pressable, ScrollView, Alert, useWindowDimensions } from "react-native";
import * as Crypto from "expo-crypto";
import * as Sharing from "expo-sharing";
import { File, Paths } from "expo-file-system";
import { database, registra } from "../lib/db";

type Esercizio = {
  id: string; livello: number; consegna: string;
  soluzione_riferimento: string; // la descrizione del difetto
  rubrica: string; // { corretto, test, categoria }
};

/**
 * Il valore di questo blocco sta nell'ordine, non nel contenuto.
 * Per questo l'ipotesi è obbligatoria e il resto resta chiuso finché non è scritta:
 * saltare il primo passo trasforma l'esercizio in lettura passiva e lo annulla.
 */
export default function Codice() {
  const { width } = useWindowDimensions();
  const affiancato = width >= 600;

  const [coda, setCoda] = useState<Esercizio[]>([]);
  const [i, setI] = useState(0);
  const [ipotesi, setIpotesi] = useState("");
  const [fase, setFase] = useState<"ipotesi" | "test" | "confronto">("ipotesi");
  const [iniziato, setIniziato] = useState(Date.now());

  useEffect(() => {
    (async () => {
      const d = database();
      setCoda(await d.getAllAsync<Esercizio>(
        `SELECT e.id, e.livello, e.consegna, e.soluzione_riferimento, e.rubrica
         FROM esercizi e WHERE e.tipo = 'lettura_codice'
           AND NOT EXISTS (SELECT 1 FROM tentativi t WHERE t.esercizio_id = e.id AND t.esito = 'corretto')
         ORDER BY e.livello, e.id`));
      setIniziato(Date.now());
    })();
  }, []);

  const e = coda[i];
  if (!e) {
    return (
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center", padding: 24 }}>
        <Text style={{ fontSize: 16 }}>Nessun modulo in coda.</Text>
      </View>
    );
  }

  const extra = JSON.parse(e.rubrica || "{}") as { corretto?: string; test?: string; categoria?: string };
  const [titoloEconsegna, ...restoCodice] = e.consegna.split("\n\n");
  const codiceDifettoso = restoCodice.slice(1).join("\n\n") || restoCodice.join("\n\n");

  /** Esporta modulo e test: il test si esegue sul computer, non sul telefono. */
  async function esportaPerIlPc() {
    const file = new File(Paths.cache, `${e.id}.py`);
    if (!file.exists) file.create();
    file.write(
      `# ${e.id} — modulo difettoso e test\n# Esegui: python ${e.id}.py\n\n` +
      `${codiceDifettoso}\n\n${extra.test ?? ""}\n\n` +
      `if __name__ == "__main__":\n    verifica(globals())\n    print("test superato")\n`
    );
    if (await Sharing.isAvailableAsync()) await Sharing.shareAsync(file.uri);
  }

  async function registraEsito(riuscito: boolean) {
    const id = Crypto.randomUUID();
    const durata = Math.round((Date.now() - iniziato) / 1000);
    await registra("tentativi", id, "crea",
      { esercizio_id: e.id, esito: riuscito ? "corretto" : "parziale" },
      async (d, hlc) => {
        await d.runAsync(
          `INSERT INTO tentativi (id, esercizio_id, risposta, esito, motivo, durata_sec, eseguito_a, hlc)
           VALUES (?,?,?,?,?,?,?,?)`,
          [id, e.id, ipotesi, riuscito ? "corretto" : "parziale",
           extra.categoria ?? null, durata, new Date().toISOString(), hlc]);
      });
    setIpotesi("");
    setFase("ipotesi");
    setIniziato(Date.now());
    setI((n) => n + 1);
  }

  const Codice = (
    <ScrollView style={{ flex: 1 }} horizontal={false}>
      <Text style={{ fontSize: 12, opacity: 0.6, padding: 12, paddingBottom: 4 }}>
        {e.id} · livello {e.livello} {extra.categoria && fase === "confronto" ? `· ${extra.categoria}` : ""}
      </Text>
      <Text style={{ fontSize: 15, paddingHorizontal: 12, lineHeight: 21 }}>{titoloEconsegna}</Text>
      <ScrollView horizontal style={{ margin: 12, backgroundColor: "#18181B", borderRadius: 9 }}>
        <Text selectable style={{ fontFamily: "monospace", fontSize: 12, color: "#E4E4E7", padding: 12, lineHeight: 18 }}>
          {codiceDifettoso}
        </Text>
      </ScrollView>
    </ScrollView>
  );

  const Pannello = (
    <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 12, gap: 12 }}>
      <View>
        <Text style={{ fontSize: 13, fontWeight: "600", marginBottom: 6 }}>
          1 · La tua ipotesi, prima di guardare oltre
        </Text>
        <TextInput
          value={ipotesi} onChangeText={setIpotesi} multiline
          editable={fase === "ipotesi"}
          placeholder="Dove sta il difetto, e in quale caso si manifesta?"
          style={{ borderWidth: 1, borderColor: "#E4E4E7", borderRadius: 9, padding: 11,
                   minHeight: 92, textAlignVertical: "top", fontSize: 14,
                   backgroundColor: fase === "ipotesi" ? "#fff" : "#FAFAFA" }} />
      </View>

      {fase === "ipotesi" ? (
        <Pressable
          onPress={() => ipotesi.trim().length < 15
            ? Alert.alert("Scrivi prima l'ipotesi",
                "Anche sbagliata. Saltare questo passo rende l'esercizio lettura passiva e ne annulla il valore.")
            : setFase("test")}
          style={{ backgroundColor: ipotesi.trim().length >= 15 ? "#18181B" : "#D4D4D8",
                   padding: 14, borderRadius: 10, alignItems: "center" }}>
          <Text style={{ color: "#fff", fontWeight: "600" }}>Mostra il test</Text>
        </Pressable>
      ) : null}

      {fase !== "ipotesi" ? (
        <View>
          <Text style={{ fontSize: 13, fontWeight: "600", marginBottom: 6 }}>
            2 · Il test che dimostra il difetto
          </Text>
          <ScrollView horizontal style={{ backgroundColor: "#18181B", borderRadius: 9 }}>
            <Text selectable style={{ fontFamily: "monospace", fontSize: 11, color: "#E4E4E7", padding: 11, lineHeight: 17 }}>
              {extra.test}
            </Text>
          </ScrollView>
          <Pressable onPress={esportaPerIlPc} style={{ marginTop: 8, padding: 10, borderRadius: 9,
                     borderWidth: 1, borderColor: "#E4E4E7", alignItems: "center" }}>
            <Text style={{ fontSize: 13, fontWeight: "600" }}>Esporta modulo e test per il computer</Text>
          </Pressable>
          <Text style={{ fontSize: 11, opacity: 0.55, marginTop: 6, lineHeight: 16 }}>
            Il test gira in Python, quindi sul computer, non qui. In aereo leggilo e basta:
            l'esecuzione si fa a terra.
          </Text>
        </View>
      ) : null}

      {fase === "test" ? (
        <Pressable onPress={() => setFase("confronto")}
          style={{ backgroundColor: "#18181B", padding: 14, borderRadius: 10, alignItems: "center" }}>
          <Text style={{ color: "#fff", fontWeight: "600" }}>Mostra il difetto e la correzione</Text>
        </Pressable>
      ) : null}

      {fase === "confronto" ? (
        <>
          <View style={{ padding: 12, backgroundColor: "#FDF0D5", borderRadius: 9 }}>
            <Text style={{ fontSize: 13, fontWeight: "600", color: "#854F0B", marginBottom: 4 }}>3 · Il difetto</Text>
            <Text style={{ fontSize: 14, lineHeight: 21 }}>{e.soluzione_riferimento}</Text>
          </View>
          <View>
            <Text style={{ fontSize: 13, fontWeight: "600", marginBottom: 6 }}>4 · La correzione</Text>
            <ScrollView horizontal style={{ backgroundColor: "#0F2A1F", borderRadius: 9 }}>
              <Text selectable style={{ fontFamily: "monospace", fontSize: 11, color: "#D7F0E4", padding: 11, lineHeight: 17 }}>
                {extra.corretto}
              </Text>
            </ScrollView>
          </View>
          <View style={{ flexDirection: "row", gap: 9 }}>
            <Pressable onPress={() => registraEsito(false)}
              style={{ flex: 1, padding: 13, borderRadius: 9, alignItems: "center", backgroundColor: "#FDECEC" }}>
              <Text style={{ fontWeight: "600", fontSize: 13 }}>Non l'avevo visto</Text>
            </Pressable>
            <Pressable onPress={() => registraEsito(true)}
              style={{ flex: 1, padding: 13, borderRadius: 9, alignItems: "center", backgroundColor: "#E8F5EE" }}>
              <Text style={{ fontWeight: "600", fontSize: 13 }}>L'avevo individuato</Text>
            </Pressable>
          </View>
          <Text style={{ fontSize: 11, opacity: 0.55, lineHeight: 16 }}>
            Rispondi onestamente: la statistica serve a te, non a un valutatore.
            Gli esercizi segnati come mancati tornano in coda.
          </Text>
        </>
      ) : null}
    </ScrollView>
  );

  return affiancato ? (
    <View style={{ flex: 1, flexDirection: "row" }}>
      <View style={{ flex: 1, borderRightWidth: 1, borderColor: "#E4E4E7" }}>{Codice}</View>
      <View style={{ flex: 1 }}>{Pannello}</View>
    </View>
  ) : (
    <View style={{ flex: 1 }}>
      <View style={{ maxHeight: 300 }}>{Codice}</View>
      {Pannello}
    </View>
  );
}
