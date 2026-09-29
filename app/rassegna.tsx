import { useCallback, useEffect, useState } from "react";
import { View, Text, Pressable, FlatList, useWindowDimensions } from "react-native";
import { router } from "expo-router";
import { elencaArticoli, temiConNovita, Articolo } from "../lib/nuvola/articoli";
import { descriviByte } from "../lib/nuvola/media";

/**
 * La rassegna: quello che la conduttura ha raccolto stanotte.
 *
 * Ordine: prima i non letti, poi i più recenti. Chi apre questa schermata ha
 * dieci minuti, non un pomeriggio: la cosa da leggere deve stare in cima senza
 * che vada cercata.
 */
export default function Rassegna() {
  const { width } = useWindowDimensions();
  const colonne = width >= 900 ? 2 : 1;
  const [voci, setVoci] = useState<Articolo[]>([]);
  const [temi, setTemi] = useState<Array<{ tema_slug: string; n: number }>>([]);
  const [tema, setTema] = useState<string | null>(null);
  const [soloDaLeggere, setSoloDaLeggere] = useState(true);

  const ricarica = useCallback(async () => {
    setVoci(await elencaArticoli({ soloDaLeggere, tema }));
    setTemi(await temiConNovita());
  }, [soloDaLeggere, tema]);

  useEffect(() => { void ricarica(); }, [ricarica]);

  const Pillola = ({ testo, attiva, premuto }: { testo: string; attiva: boolean; premuto: () => void }) => (
    <Pressable onPress={premuto}
      style={{ paddingHorizontal: 11, paddingVertical: 6, borderRadius: 20,
               backgroundColor: attiva ? "#18181B" : "#F4F4F5" }}>
      <Text style={{ fontSize: 12, color: attiva ? "#fff" : "#3F3F46" }}>{testo}</Text>
    </Pressable>
  );

  return (
    <View style={{ flex: 1 }}>
      <View style={{ paddingHorizontal: 16, paddingTop: 14, paddingBottom: 6 }}>
        <Pressable onPress={() => router.back()}>
          <Text style={{ fontSize: 13, opacity: 0.6 }}>‹ Indietro</Text>
        </Pressable>
        <Text style={{ fontSize: 22, fontWeight: "600", marginTop: 6 }}>Rassegna</Text>
        <Text style={{ fontSize: 12, opacity: 0.6, marginTop: 2 }}>
          Il testo è già sul dispositivo: si legge senza rete.
        </Text>
      </View>

      <View style={{ flexDirection: "row", gap: 6, paddingHorizontal: 12, paddingVertical: 10, flexWrap: "wrap" }}>
        <Pillola testo={soloDaLeggere ? "Da leggere" : "Tutti"} attiva={soloDaLeggere}
          premuto={() => setSoloDaLeggere((v) => !v)} />
        <Pillola testo="Ogni tema" attiva={tema === null} premuto={() => setTema(null)} />
        {temi.slice(0, 8).map((t) => (
          <Pillola key={t.tema_slug} testo={`${t.tema_slug} ${t.n}`} attiva={tema === t.tema_slug}
            premuto={() => setTema((v) => (v === t.tema_slug ? null : t.tema_slug))} />
        ))}
      </View>

      <FlatList
        data={voci}
        key={colonne}
        numColumns={colonne}
        keyExtractor={(v) => v.id}
        contentContainerStyle={{ padding: 12, gap: 10 }}
        columnWrapperStyle={colonne > 1 ? { gap: 10 } : undefined}
        ListEmptyComponent={
          <Text style={{ opacity: 0.6, padding: 16, lineHeight: 20 }}>
            Niente ancora. La rassegna gira ogni mattina alle otto e deposita quello
            che trova; l'app lo ritira da sola appena c'è rete.
          </Text>
        }
        renderItem={({ item }) => (
          <Pressable
            onPress={() => router.push({ pathname: "/articolo", params: { id: item.id } })}
            style={{ flex: 1, borderWidth: 1, borderColor: "#E4E4E7", borderRadius: 11, padding: 13,
                     opacity: item.letto ? 0.55 : 1 }}>
            <View style={{ flexDirection: "row", gap: 6, marginBottom: 5, flexWrap: "wrap" }}>
              {item.url_media ? (
                // Un podcast o una conferenza non hanno testo, e senza questa
                // etichetta sembrerebbero articoli mal riusciti: dice invece
                // che cos'è la voce e quanto costa portarsela in aereo.
                <Text style={{ fontSize: 10, fontWeight: "600", color: "#6B3FA0",
                               backgroundColor: "#F1EAFA", paddingHorizontal: 7, paddingVertical: 2,
                               borderRadius: 5 }}>
                  {((item.tipo_media || "").startsWith("video/") ? "video" : "audio")
                    + (item.file_media ? " · sul telefono" : " · " + descriviByte(item.byte_media))}
                </Text>
              ) : item.testo ? (
                <Text style={{ fontSize: 10, fontWeight: "600", color: "#0F6E56",
                               backgroundColor: "#E8F5EE", paddingHorizontal: 7, paddingVertical: 2,
                               borderRadius: 5 }}>testo intero</Text>
              ) : (
                <Text style={{ fontSize: 10, opacity: 0.45, paddingVertical: 2 }}>solo sommario</Text>
              )}
              {item.salvato ? (
                <Text style={{ fontSize: 10, color: "#0C447C", backgroundColor: "#E6F0FA",
                               paddingHorizontal: 7, paddingVertical: 2, borderRadius: 5 }}>salvato</Text>
              ) : null}
              {item.trimestre ? (
                <Text style={{ fontSize: 10, opacity: 0.55, paddingVertical: 2 }}>{item.trimestre}</Text>
              ) : null}
              {item.fonte ? (
                <Text style={{ fontSize: 10, opacity: 0.45, paddingVertical: 2 }}>{item.fonte}</Text>
              ) : null}
            </View>
            <Text style={{ fontSize: 15, fontWeight: "500" }} numberOfLines={3}>{item.titolo}</Text>
            {item.autori ? (
              <Text style={{ fontSize: 12, opacity: 0.65, marginTop: 2 }} numberOfLines={1}>{item.autori}</Text>
            ) : null}
            {item.abstract ? (
              <Text style={{ fontSize: 12, opacity: 0.6, marginTop: 6, lineHeight: 18 }} numberOfLines={3}>
                {item.abstract}
              </Text>
            ) : null}
          </Pressable>
        )}
      />
    </View>
  );
}
