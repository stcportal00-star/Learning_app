import { useCallback, useEffect, useState } from "react";
import { View, Text, Pressable, FlatList, Alert, useWindowDimensions } from "react-native";
import { router } from "expo-router";
import { elencaBiblioteca, importaPdf, importaBiblioteca, rimuoviVolume, apriVolume, Volume } from "../../lib/palestra";
import { caricaVolumeInNuvola } from "../../lib/nuvola/manuale";
import { scaricaVolume } from "../../lib/nuvola/sincronia";

export default function Biblioteca() {
  const { width } = useWindowDimensions();
  const colonne = width >= 900 ? 2 : 1;
  const [volumi, setVolumi] = useState<Volume[]>([]);
  const [filtro, setFiltro] = useState<string | null>(null);
  const [scaricando, setScaricando] = useState<string | null>(null);

  const ricarica = useCallback(async () => {
    setVolumi(await elencaBiblioteca(filtro ?? undefined));
  }, [filtro]);

  useEffect(() => { ricarica(); }, [ricarica]);

  /**
   * Un PDF aggiunto a mano prende la stessa strada di uno trovato dalla
   * rassegna: prima sul dispositivo — dove serve subito e senza rete — poi nel
   * deposito remoto, così sopravvive alla disinstallazione e raggiunge
   * l'altro dispositivo. Il caricamento NON blocca: se la rete non c'è, il
   * volume è comunque già leggibile e sale al primo rientro.
   */
  async function aggiungi() {
    // LIB-07: senza questo catch un guasto dell'importazione — selettore che
    // non risponde, copia che non riesce, disco pieno — non produceva NIENTE
    // sullo schermo. L'utente tocca «Aggiungi PDF», non succede niente, e non
    // c'è modo di sapere se il file è troppo grande o se l'app è rotta.
    try {
      const v = await importaPdf();
      if (!v) return;
      await ricarica();
      Alert.alert("Aggiunto", `${v.titolo}\nOra è leggibile offline. La copia remota parte da sé.`);
      void caricaVolumeInNuvola(v.id).then(ricarica).catch(() => undefined);
    } catch (e) {
      Alert.alert("Non aggiunto",
        "Il file non è entrato nella biblioteca: " + String(e));
    }
  }

  async function scarica(v: Volume) {
    setScaricando(v.id);
    try {
      await scaricaVolume(v.id);
      await ricarica();
    } catch (e) {
      Alert.alert("Non scaricato",
        "La copia remota non si è fatta raggiungere. Riprova quando c'è rete: " + String(e));
    } finally {
      setScaricando(null);
    }
  }

  /**
   * L'esito di apriVolume() veniva buttato via: senza un'app per i PDF e senza
   * foglio di condivisione, toccare «Apri con il visore del sistema» non
   * faceva assolutamente niente, e l'apertura dei PDF è la priorità di questo
   * progetto. Qui si dice cosa è successo, e si nomina la via che resta: il
   * lettore interno, che è quello che fa un tocco semplice.
   */
  async function conVisoreDiSistema(v: Volume) {
    const esito = await apriVolume(v);
    if (esito === "nessun_visore") {
      Alert.alert("Nessuna app per aprirlo",
        "Su questo dispositivo non c'è un'app per i PDF, e nemmeno il foglio di condivisione. " +
        "Il lettore interno lo apre lo stesso: tocca il volume invece di tenerlo premuto.");
    } else if (esito === "non_scaricato") {
      Alert.alert("File non più sul dispositivo",
        "Il file non è più nello spazio dell'app. Reimporta la biblioteca per riaverlo.");
    }
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
            onPress={() => {
              if (item.file_locale) {
                router.push({ pathname: "/lettore", params: { id: item.id } });
              } else if (item.pdf_path) {
                Alert.alert(item.titolo,
                  "Il testo è nel deposito remoto ma non ancora su questo dispositivo. Scaricarlo adesso?",
                  [{ text: "Scarica", onPress: () => { void scarica(item); } },
                   { text: "Annulla", style: "cancel" }]);
              } else {
                Alert.alert("Non ancora sul dispositivo",
                  "Importa la biblioteca dalla release di GitHub, oppure aggiungi il PDF a mano.");
              }
            }}
            onLongPress={() => {
              const togli = async () => { await rimuoviVolume(item.id); await ricarica(); };
              Alert.alert(item.titolo, undefined, [
                ...(item.file_locale ? [{ text: "Apri con il visore del sistema", onPress: () => { void conVisoreDiSistema(item); } }] : []),
                // Un volume della biblioteca aperta non si cancella: la sua voce di
                // catalogo nasce una volta sola e non tornerebbe. Qui si può solo
                // liberare il file scaricato, e se non c'è non si offre niente.
                ...(item.origine === "manuale"
                  ? [{ text: "Rimuovi", style: "destructive" as const, onPress: togli }]
                  : item.file_locale
                    ? [{ text: "Rimuovi il file scaricato", style: "destructive" as const, onPress: togli }]
                    : []),
                { text: "Annulla", style: "cancel" as const },
              ]);
            }}
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
              ) : scaricando === item.id ? (
                <Text style={{ fontSize: 10, color: "#0C447C", paddingVertical: 2 }}>scarico…</Text>
              ) : item.pdf_path ? (
                <Text style={{ fontSize: 10, color: "#0C447C", paddingVertical: 2 }}>tocca per scaricare</Text>
              ) : (
                <Text style={{ fontSize: 10, opacity: 0.45, paddingVertical: 2 }}>non scaricato</Text>
              )}
            </View>
            <Text style={{ fontSize: 15, fontWeight: "500" }} numberOfLines={2}>{item.titolo}</Text>
            {item.autore ? (
              <Text style={{ fontSize: 12, opacity: 0.65, marginTop: 2 }}>{item.autore}</Text>
            ) : null}
            {item.nota ? (
              <Text style={{ fontSize: 12, opacity: 0.6, marginTop: 6, lineHeight: 18 }} numberOfLines={3}>
                {item.nota}
              </Text>
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
