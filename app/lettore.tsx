import { useEffect, useRef, useState } from "react";
import { View, Text, Pressable, ActivityIndicator } from "react-native";
import { useLocalSearchParams, router } from "expo-router";
import { WebView, WebViewMessageEvent } from "react-native-webview";
import { database } from "../lib/db";
import { preparaLettore, pdfDiProva, salvaPagina, apriVolume, Volume } from "../lib/palestra";

type Messaggio =
  | { tipo: "pronto"; pagine: number }
  | { tipo: "pagina"; n: number }
  | { tipo: "errore"; messaggio: string };

/**
 * Lettore interno: pdf.js in un WebView, offline, con ripresa della pagina
 * sincronizzata fra dispositivi tramite il registro eventi.
 * Se qualcosa non va, resta sempre disponibile il visore del sistema.
 */
export default function Lettore() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [visore, setVisore] = useState<string | null>(null);
  const [pdf, setPdf] = useState<string | null>(null);
  const [volume, setVolume] = useState<Volume | null>(null);
  const [pagina, setPagina] = useState(1);
  const [totale, setTotale] = useState(0);
  const [errore, setErrore] = useState<string | null>(null);
  const salvataggio = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    (async () => {
      try {
        setVisore(await preparaLettore());
        if (id === "prova") {
          setPdf(await pdfDiProva());
          return;
        }
        const v = await database().getFirstAsync<Volume>("SELECT * FROM biblioteca WHERE id = ?", [String(id)]);
        if (!v) { setErrore("Volume non trovato."); return; }
        setVolume(v);
        if (!v.file_locale) { setErrore("Questo volume non è ancora sul dispositivo."); return; }
        setPagina(v.ultima_pagina > 0 ? v.ultima_pagina : 1);
        setPdf(v.file_locale);
      } catch (e) {
        setErrore(String(e));
      }
    })();
    return () => { if (salvataggio.current) clearTimeout(salvataggio.current); };
  }, [id]);

  function suMessaggio(e: WebViewMessageEvent) {
    let m: Messaggio;
    try { m = JSON.parse(e.nativeEvent.data) as Messaggio; } catch { return; }
    if (m.tipo === "pronto") setTotale(m.pagine);
    else if (m.tipo === "errore") {
      // Senza PC, logcat è l'unica traccia leggibile: il workflow la raccoglie
      // e la pubblica nel rapporto di build. Un guasto del lettore che resta
      // solo a schermo non arriva a chi deve ripararlo.
      console.error("lettore:", m.messaggio);
      setErrore(m.messaggio);
    }
    else if (m.tipo === "pagina") {
      setPagina(m.n);
      // Un evento per pagina sfogliata gonfierebbe il registro: si salva a riposo.
      if (salvataggio.current) clearTimeout(salvataggio.current);
      if (id !== "prova") salvataggio.current = setTimeout(() => void salvaPagina(String(id), m.n), 1500);
    }
  }

  const Intestazione = (
    <View style={{ flexDirection: "row", alignItems: "center", padding: 11, gap: 10,
                   borderBottomWidth: 1, borderColor: "#E4E4E7", backgroundColor: "#fff" }}>
      <Pressable onPress={() => router.back()} hitSlop={12}>
        <Text style={{ color: "#0C447C", fontSize: 16 }}>←</Text>
      </Pressable>
      <Text numberOfLines={1} style={{ flex: 1, fontSize: 14, fontWeight: "500" }}>
        {id === "prova" ? "PDF di prova" : volume?.titolo ?? ""}
      </Text>
      <Text style={{ fontSize: 12, opacity: 0.65 }}>{totale ? `${pagina} / ${totale}` : ""}</Text>
    </View>
  );

  if (errore) {
    return (
      <View style={{ flex: 1 }}>
        {Intestazione}
        <View style={{ padding: 22, gap: 14 }}>
          <Text style={{ fontSize: 14, lineHeight: 21 }}>{errore}</Text>
          {volume?.file_locale ? (
            <Pressable onPress={() => apriVolume(volume)}
              style={{ backgroundColor: "#18181B", padding: 13, borderRadius: 10, alignItems: "center" }}>
              <Text style={{ color: "#fff", fontWeight: "600" }}>Apri con il visore del sistema</Text>
            </Pressable>
          ) : null}
        </View>
      </View>
    );
  }

  if (!visore || !pdf) {
    return (
      <View style={{ flex: 1 }}>
        {Intestazione}
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}><ActivityIndicator /></View>
      </View>
    );
  }

  return (
    <View style={{ flex: 1 }}>
      {Intestazione}
      <WebView
        source={{ uri: visore }}
        originWhitelist={["*"]}
        javaScriptEnabled
        allowFileAccess
        allowFileAccessFromFileURLs
        allowUniversalAccessFromFileURLs
        setBuiltInZoomControls
        setDisplayZoomControls={false}
        injectedJavaScriptBeforeContentLoaded={
          `window.PERCORSO = ${JSON.stringify({ pdf, pagina })}; true;`
        }
        onMessage={suMessaggio}
        onError={(e) => setErrore(e.nativeEvent.description)}
        style={{ flex: 1, backgroundColor: "#F4F4F5" }}
      />
    </View>
  );
}
