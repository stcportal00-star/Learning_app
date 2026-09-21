import { useCallback, useEffect, useState } from "react";
import { View, Text, TextInput, Pressable, FlatList, useWindowDimensions } from "react-native";
import * as Crypto from "expo-crypto";
import { database, registra } from "../../lib/db";

type Nota = {
  id: string; tema_slug: string | null; titolo: string | null;
  testo: string; pubblicabile: number; creato_a: string;
};

/**
 * Le note sono l'uscita del blocco di lettura serale e l'ingresso del post mensile.
 * Il campo `pubblicabile` esiste per questo: al momento di scrivere non si parte
 * da una pagina bianca, ma dalla coda delle note già marcate.
 */
export default function Note() {
  const { width } = useWindowDimensions();
  const affiancato = width >= 600;

  const [note, setNote] = useState<Nota[]>([]);
  const [apertaId, setApertaId] = useState<string | null>(null);
  const [titolo, setTitolo] = useState("");
  const [testo, setTesto] = useState("");
  const [pubblicabile, setPubblicabile] = useState(false);
  const [soloPubblicabili, setSoloPubblicabili] = useState(false);

  const ricarica = useCallback(async () => {
    const d = database();
    setNote(await d.getAllAsync<Nota>(
      soloPubblicabili
        ? "SELECT * FROM note WHERE pubblicabile = 1 ORDER BY creato_a DESC"
        : "SELECT * FROM note ORDER BY creato_a DESC"));
  }, [soloPubblicabili]);

  useEffect(() => { ricarica(); }, [ricarica]);

  function apri(n: Nota) {
    setApertaId(n.id); setTitolo(n.titolo ?? ""); setTesto(n.testo);
    setPubblicabile(n.pubblicabile === 1);
  }

  function nuova() {
    setApertaId("nuova"); setTitolo(""); setTesto(""); setPubblicabile(false);
  }

  async function salva() {
    if (!testo.trim() && !titolo.trim()) return;
    const id = apertaId === "nuova" || !apertaId ? Crypto.randomUUID() : apertaId;
    const nuovo = apertaId === "nuova" || !apertaId;
    await registra("note", id, nuovo ? "crea" : "aggiorna",
      { titolo, testo, pubblicabile: pubblicabile ? 1 : 0 },
      async (d, hlc) => {
        if (nuovo) {
          await d.runAsync(
            `INSERT INTO note (id, titolo, testo, pubblicabile, creato_a, hlc) VALUES (?,?,?,?,?,?)`,
            [id, titolo || null, testo, pubblicabile ? 1 : 0, new Date().toISOString(), hlc]);
        } else {
          await d.runAsync(
            `UPDATE note SET titolo = ?, testo = ?, pubblicabile = ?, hlc = ? WHERE id = ?`,
            [titolo || null, testo, pubblicabile ? 1 : 0, hlc, id]);
        }
      });
    setApertaId(id);
    await ricarica();
  }

  const Elenco = (
    <View style={{ flex: 1 }}>
      <View style={{ flexDirection: "row", gap: 8, padding: 12 }}>
        <Pressable onPress={nuova}
          style={{ backgroundColor: "#18181B", paddingHorizontal: 14, paddingVertical: 9, borderRadius: 9 }}>
          <Text style={{ color: "#fff", fontWeight: "600", fontSize: 13 }}>Nuova nota</Text>
        </Pressable>
        <Pressable onPress={() => setSoloPubblicabili((v) => !v)}
          style={{ paddingHorizontal: 12, paddingVertical: 9, borderRadius: 9,
                   backgroundColor: soloPubblicabili ? "#18181B" : "#F4F4F5" }}>
          <Text style={{ fontSize: 13, fontWeight: "600", color: soloPubblicabili ? "#fff" : "#3F3F46" }}>
            Da pubblicare
          </Text>
        </Pressable>
      </View>
      <FlatList
        data={note}
        keyExtractor={(n) => n.id}
        contentContainerStyle={{ paddingHorizontal: 12, gap: 8, paddingBottom: 16 }}
        ListEmptyComponent={
          <Text style={{ opacity: 0.6, padding: 12, lineHeight: 19 }}>
            Nessuna nota. Una per sessione di lettura: che cosa si applica a MSF o al tuo lavoro.
            È la nota l'obiettivo, non le pagine lette.
          </Text>}
        renderItem={({ item }) => (
          <Pressable onPress={() => apri(item)}
            style={{ borderWidth: 1, borderRadius: 10, padding: 12,
                     borderColor: apertaId === item.id ? "#18181B" : "#E4E4E7" }}>
            <View style={{ flexDirection: "row", justifyContent: "space-between", gap: 8 }}>
              <Text style={{ fontSize: 15, fontWeight: "500", flex: 1 }} numberOfLines={1}>
                {item.titolo || "senza titolo"}
              </Text>
              {item.pubblicabile === 1 ? (
                <Text style={{ fontSize: 10, color: "#0C447C", backgroundColor: "#E6F0FA",
                               paddingHorizontal: 6, paddingVertical: 2, borderRadius: 5 }}>
                  da pubblicare
                </Text>
              ) : null}
            </View>
            <Text style={{ fontSize: 12, opacity: 0.6, marginTop: 3 }} numberOfLines={2}>{item.testo}</Text>
          </Pressable>
        )}
      />
    </View>
  );

  const Editor = apertaId ? (
    <View style={{ flex: 1, padding: 12, gap: 10 }}>
      <TextInput value={titolo} onChangeText={setTitolo} placeholder="Titolo"
        style={{ borderWidth: 1, borderColor: "#E4E4E7", borderRadius: 9, padding: 11, fontSize: 16 }} />
      <TextInput value={testo} onChangeText={setTesto} multiline placeholder="Markdown"
        style={{ flex: 1, borderWidth: 1, borderColor: "#E4E4E7", borderRadius: 9, padding: 11,
                 fontSize: 15, textAlignVertical: "top", minHeight: 150, lineHeight: 21 }} />
      <Pressable onPress={() => setPubblicabile((v) => !v)}
        style={{ flexDirection: "row", alignItems: "center", gap: 9, paddingVertical: 4 }}>
        <View style={{ width: 20, height: 20, borderRadius: 5, borderWidth: 1.5,
                       borderColor: pubblicabile ? "#18181B" : "#A1A1AA",
                       backgroundColor: pubblicabile ? "#18181B" : "transparent" }} />
        <Text style={{ fontSize: 14 }}>Materiale per il post mensile</Text>
      </Pressable>
      <Pressable onPress={salva}
        style={{ backgroundColor: "#18181B", padding: 14, borderRadius: 10, alignItems: "center" }}>
        <Text style={{ color: "#fff", fontWeight: "600" }}>Salva</Text>
      </Pressable>
    </View>
  ) : (
    <View style={{ flex: 1, alignItems: "center", justifyContent: "center", padding: 24 }}>
      <Text style={{ opacity: 0.55, textAlign: "center", lineHeight: 20 }}>
        Scegli una nota o creane una nuova.
      </Text>
    </View>
  );

  return affiancato ? (
    <View style={{ flex: 1, flexDirection: "row" }}>
      <View style={{ width: 320, borderRightWidth: 1, borderColor: "#E4E4E7" }}>{Elenco}</View>
      <View style={{ flex: 1 }}>{Editor}</View>
    </View>
  ) : apertaId ? (
    <View style={{ flex: 1 }}>
      <Pressable onPress={() => setApertaId(null)} style={{ padding: 12 }}>
        <Text style={{ fontSize: 14, color: "#0C447C" }}>← Tutte le note</Text>
      </Pressable>
      {Editor}
    </View>
  ) : Elenco;
}
