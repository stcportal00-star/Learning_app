import { useEffect, useState } from "react";
import { Stack } from "expo-router";
import { View } from "react-native";
import { StatusBar } from "expo-status-bar";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import * as Crypto from "expo-crypto";
import AsyncStorageLike from "expo-sqlite/kv-store";
import { apri } from "../lib/db";
import { aggiornaContenuti, caricaContenuti } from "../lib/contenuti";
import { apriPalestra, versioneMotore, supportaWindowFunctions } from "../lib/palestra";
import { ripristina as ripristinaPromemoria } from "../lib/notifiche";
import { useNuvola } from "../lib/nuvola/useNuvola";
import { Text, ActivityIndicator } from "../components/Base";
import { C } from "../lib/tema";

export default function Radice() {
  const [pronto, setPronto] = useState(false);
  const [errore, setErrore] = useState<string | null>(null);
  const [avviso, setAvviso] = useState<string | null>(null);
  const [dispositivo, setDispositivo] = useState("");

  // Lo scambio con Supabase parte da qui, appena il database è aperto: è
  // l'unico posto montato per tutta la vita dell'app. Con la stringa vuota
  // l'effetto dentro il gancio gira a vuoto e non tocca la rete.
  useNuvola(pronto ? dispositivo : "");

  // Con l'edge-to-edge di SDK 54 la barra di stato è trasparente e il
  // contenuto ci passava sotto: titoli, frecce indietro e i pulsanti
  // principali, ora chiari, sotto l'orologio bianco. Il margine si mette una
  // volta qui, sopra tutte le schermate; la fascia della barra resta nera.
  const insets = useSafeAreaInsets();

  useEffect(() => {
    (async () => {
      try {
        // identificativo stabile del dispositivo, generato una sola volta
        let id = await AsyncStorageLike.getItem("dispositivo_id");
        if (!id) {
          id = (Crypto.randomUUID()).slice(0, 8);
          await AsyncStorageLike.setItem("dispositivo_id", id);
        }
        setDispositivo(id);
        await apri(id);
        await caricaContenuti();
        // Su un telefono già in uso caricaContenuti() salta: le schede e le
        // unità arrivate con questa versione le aggiunge questa.
        await aggiornaContenuti();
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
      <View style={{ flex: 1, justifyContent: "center", padding: 24, backgroundColor: C.sfondo }}>
        <Text style={{ fontSize: 16, fontWeight: "600", marginBottom: 8 }}>Avvio non riuscito</Text>
        <Text selectable style={{ fontSize: 13, opacity: 0.8 }}>{errore}</Text>
      </View>
    );
  }
  if (!pronto) {
    return (
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center", gap: 12, backgroundColor: C.sfondo }}>
        <ActivityIndicator />
        <Text style={{ opacity: 0.7 }}>Preparazione dei contenuti…</Text>
      </View>
    );
  }
  // `contentStyle` perché lo sfondo predefinito delle schermate impilate è il
  // grigio chiaro di React Navigation: senza, ogni schermata aperta da Studio
  // o da Profilo lampeggerebbe chiara sotto il contenuto.
  return (
    <View style={{ flex: 1, backgroundColor: C.sfondo, paddingTop: insets.top }}>
      <StatusBar style="light" />
      {avviso ? (
        <View style={{ backgroundColor: C.ambraFondo, padding: 10 }}>
          <Text style={{ fontSize: 12, color: C.ambra }}>{avviso}</Text>
        </View>
      ) : null}
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: C.sfondo } }} />
    </View>
  );
}
