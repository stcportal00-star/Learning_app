import { useCallback, useEffect, useState } from "react";
import { View, Text, Pressable, FlatList, Alert, useWindowDimensions } from "react-native";
import { router } from "expo-router";
import { elencaBiblioteca, importaPdf, importaBiblioteca, rimuoviVolume, apriVolume, Volume } from "../../lib/palestra";

export default function Biblioteca() {
  const { width } = useWindowDimensions();
  const colonne = width >= 900 ? 2 : 1;
  const [volumi, setVolumi] = useState<Volume[]>([]);
  const [filtro, setFiltro] = useState<string | null>(null);

  const ricarica = useCallback(async () => {
    setVolumi(await elencaBiblioteca(filtro ?? undefined));
  }, [filtro]);

  useEffect(() => { ricarica(); }, [ricarica]);

  async function aggiungi() {
    const v = await importaPdf();
    if (v) { await ricarica(); Alert.alert("Aggiunto", v.titolo); }
  }

  async function daRelease() {
    const r = await importaBiblioteca();
    await ricarica();
    if (r.errore) { Alert.alert("Importazione", r.errore); return; }
    Alert.alert("Importazione",
      `${r.collegati} volumi ora disponibili offline.` +
      (r.senzaFile ? ` ${r.senzaFile} voci senza PDF: sono libri web, da leggere online o da salvare in PDF.` : ""));
  }

  const trimestri = ["T1", "T2", "T3", "T4", "T5", "T6"];

  return (
    <View style={{ flex: 1 }}>
      <View style={{ flexDirection: "row", gap: 8, padding: 12, flexWrap: "wrap" }}>
        <Pressable onPress={aggiungi}
          style={{ backgroundColor: "#18181B", paddingHorizontal: 14, paddingVertical: 10, borderRadius: 9 }}>
          <Text style={{ color: "#fff", fontWeight: "600", fontSize: 13 }}>Aggiungi PDF</Text>
        </Pressable>
        <Pressable onPress={daRelease}
          style={{ borderWidth: 1, borderColor: "#E4E4E7", paddingHorizontal: 14, paddingVertical: 10, borderRadius: 9 }}>
          <Text style={{ fontWeight: "600", fontSize: 13 }}>Importa biblioteca</Text>
        </Pressable>
      </View>

      <View style={{ flexDirection: "row", gap: 6, paddingHorizontal: 12, paddingBottom: 10, flexWrap: "wrap" }}>
        <Pressable onPress={() => setFiltro(null)}
          style={{ paddingHorizontal: 11, paddingVertical: 6, borderRadius: 20,
                   backgroundColor: filtro === null ? "#18181B" : "#F4F4F5" }}>
          <Text style={{ fontSize: 12, color: filtro === null ? "#fff" : "#3F3F46" }}>Tutti</Text>
        </Pressable>
        {trimestri.map((t) => (
          <Pressable key={t} onPress={() => setFiltro(t)}
            style={{ paddingHorizontal: 11, paddingVertical: 6, borderRadius: 20,
                     backgroundColor: filtro === t ? "#18181B" : "#F4F4F5" }}>
            <Text style={{ fontSize: 12, color: filtro === t ? "#fff" : "#3F3F46" }}>{t}</Text>
          </Pressable>
        ))}
      </View>

      <FlatList
        data={volumi}
        key={colonne}
        numColumns={colonne}
        keyExtractor={(v) => v.id}
        contentContainerStyle={{ padding: 12, gap: 10 }}
        columnWrapperStyle={colonne > 1 ? { gap: 10 } : undefined}
        ListEmptyComponent={
          <Text style={{ opacity: 0.6, padding: 16 }}>
            Nessun volume. "Aggiungi PDF" per i tuoi file; "Importa biblioteca" per i testi
            aperti scaricati dalla release di GitHub.
          </Text>
        }
        renderItem={({ item }) => (
          <Pressable
            onPress={() => item.file_locale
              ? router.push({ pathname: "/lettore", params: { id: item.id } })
              : Alert.alert("Non ancora sul dispositivo",
                  "Importa la biblioteca dalla release di GitHub, oppure aggiungi il PDF a mano.")}
            onLongPress={() =>
              Alert.alert(item.titolo, undefined, [
                ...(item.file_locale ? [{ text: "Apri con il visore del sistema", onPress: () => { void apriVolume(item); } }] : []),
                { text: "Rimuovi", style: "destructive" as const,
                  onPress: async () => { await rimuoviVolume(item.id); await ricarica(); } },
                { text: "Annulla", style: "cancel" as const },
              ])
            }
            style={{ flex: 1, borderWidth: 1, borderColor: "#E4E4E7", borderRadius: 11, padding: 13 }}>
            <View style={{ flexDirection: "row", gap: 6, marginBottom: 5 }}>
              <Text style={{ fontSize: 10, fontWeight: "600",
                             color: item.origine === "manuale" ? "#0C447C" : "#0F6E56",
                             backgroundColor: item.origine === "manuale" ? "#E6F0FA" : "#E8F5EE",
                             paddingHorizontal: 7, paddingVertical: 2, borderRadius: 5 }}>
                {item.origine === "manuale" ? "tuo file" : "aperta"}
              </Text>
              {item.trimestre ? (
                <Text style={{ fontSize: 10, opacity: 0.55, paddingVertical: 2 }}>{item.trimestre}</Text>
              ) : null}
              {item.file_locale ? (
                <Text style={{ fontSize: 10, color: "#0F6E56", paddingVertical: 2 }}>offline</Text>
              ) : (
                <Text style={{ fontSize: 10, opacity: 0.45, paddingVertical: 2 }}>non scaricato</Text>
              )}
            </View>
            <Text style={{ fontSize: 15, fontWeight: "500" }} numberOfLines={2}>{item.titolo}</Text>
            {item.autore ? (
              <Text style={{ fontSize: 12, opacity: 0.65, marginTop: 2 }}>{item.autore}</Text>
            ) : null}
            {item.licenza ? (
              <Text style={{ fontSize: 11, opacity: 0.5, marginTop: 6 }}>{item.licenza}</Text>
            ) : null}
            {item.ultima_pagina > 0 ? (
              <Text style={{ fontSize: 11, opacity: 0.6, marginTop: 4 }}>
                ripresa a pagina {item.ultima_pagina}
              </Text>
            ) : null}
          </Pressable>
        )}
      />
    </View>
  );
}
