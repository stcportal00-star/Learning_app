import { useEffect, useState } from "react";
import { Stack } from "expo-router";
import { View, Text, ActivityIndicator } from "react-native";
import * as Crypto from "expo-crypto";
import AsyncStorageLike from "expo-sqlite/kv-store";
import { apri } from "../lib/db";
import { caricaContenuti } from "../lib/contenuti";
import { apriPalestra, versioneMotore, supportaWindowFunctions } from "../lib/palestra";
import { ripristina as ripristinaPromemoria } from "../lib/notifiche";

export default function Radice() {
  const [pronto, setPronto] = useState(false);
  const [errore, setErrore] = useState<string | null>(null);
  const [avviso, setAvviso] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        // identificativo stabile del dispositivo, generato una sola volta
        let id = await AsyncStorageLike.getItem("dispositivo_id");
        if (!id) {
          id = (Crypto.randomUUID()).slice(0, 8);
          await AsyncStorageLike.setItem("dispositivo_id", id);
        }
        await apri(id);
        await caricaContenuti();
        await apriPalestra();
        if (!supportaWindowFunctions()) {
          setAvviso(
            `SQLite ${versioneMotore()} non supporta le window functions: ` +
            `21 esercizi di livello 4 non saranno eseguibili su questo dispositivo.`
          );
        }
        setPronto(true);
        // Dopo il pronto e senza await: un riavvio del telefono azzera le
        // notifiche programmate, ma ripristinarle non deve ritardare l'avvio
        // né impedirlo se fallisce.
        void ripristinaPromemoria();
      } catch (e) {
        setErrore(String(e));
      }
    })();
  }, []);

  if (errore) {
    return (
      <View style={{ flex: 1, justifyContent: "center", padding: 24 }}>
        <Text style={{ fontSize: 16, fontWeight: "600", marginBottom: 8 }}>Avvio non riuscito</Text>
        <Text selectable style={{ fontSize: 13, opacity: 0.8 }}>{errore}</Text>
      </View>
    );
  }
  if (!pronto) {
    return (
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center", gap: 12 }}>
        <ActivityIndicator />
        <Text style={{ opacity: 0.7 }}>Preparazione dei contenuti…</Text>
      </View>
    );
  }
  return (
    <>
      {avviso ? (
        <View style={{ backgroundColor: "#FDF0D5", padding: 10 }}>
          <Text style={{ fontSize: 12, color: "#854F0B" }}>{avviso}</Text>
        </View>
      ) : null}
      <Stack screenOptions={{ headerShown: false }} />
    </>
  );
}
