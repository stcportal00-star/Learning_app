import { useCallback, useEffect, useRef, useState } from "react";
import { View, Pressable, ScrollView, Alert } from "react-native";
import { useLocalSearchParams, router } from "expo-router";
import { WebView, WebViewMessageEvent } from "react-native-webview";
import { database } from "../lib/db";
import { preparaLettore, pdfDiProva, salvaPagina, apriVolume, Volume } from "../lib/palestra";
import { annota, cancella, segniDi, Segno } from "../lib/nuvola/segni";
import { Text, TextInput, ActivityIndicator } from "../components/Base";
import { C } from "../lib/tema";

type Messaggio =
  | { tipo: "pronto"; pagine: number }
  | { tipo: "pagina"; n: number }
  | { tipo: "errore"; messaggio: string };

/**
 * Lettore interno: pdf.js in un WebView, offline, con ripresa della pagina
 * sincronizzata fra dispositivi tramite il registro eventi.
 * Se qualcosa non va, resta sempre disponibile il visore del sistema.
 */
// Android chiude il processo che disegna il PDF quando la memoria non basta
// (un volume di cinquecento pagine, il tablet in orizzontale). Il WebView
// resta morto, e senza un gestore lo schermo restava bianco senza una parola:
// con questo compare il riquadro d'errore, con il visore del sistema.
const PROCESSO_CHIUSO =
  "Il lettore si è chiuso: il PDF ha chiesto più memoria di quella disponibile. " +
  "Aprilo con il visore del sistema, oppure torna indietro e riaprilo.";

export default function Lettore() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [visore, setVisore] = useState<string | null>(null);
  const [pdf, setPdf] = useState<string | null>(null);
  const [volume, setVolume] = useState<Volume | null>(null);
  const [pagina, setPagina] = useState(1);
  const [totale, setTotale] = useState(0);
  const [errore, setErrore] = useState<string | null>(null);
  const salvataggio = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [segni, setSegni] = useState<Segno[]>([]);
  const [pannello, setPannello] = useState(false);
  const [bozza, setBozza] = useState("");

  /**
   * I segni stanno ACCANTO al PDF, mai dentro. Annotarlo dentro cambierebbe i
   * byte del file: l'impronta non tornerebbe più, riscaricare il volume
   * cancellerebbe il lavoro, e due dispositivi che segnano lo stesso testo
   * darebbero due file diversi che nessuna fusione sa riconciliare. Fuori, un
   * segno è un evento come gli altri e si sincronizza da solo.
   */
  const ricaricaSegni = useCallback(async () => {
    if (!id || id === "prova") return;
    setSegni(await segniDi(String(id)));
  }, [id]);

  useEffect(() => { void ricaricaSegni(); }, [ricaricaSegni]);

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
                   borderBottomWidth: 1, borderColor: C.bordo, backgroundColor: C.sfondo }}>
      <Pressable onPress={() => router.back()} hitSlop={12}>
        <Text style={{ color: C.blu, fontSize: 16 }}>←</Text>
      </Pressable>
      <Text numberOfLines={1} style={{ flex: 1, fontSize: 14, fontWeight: "500" }}>
        {id === "prova" ? "PDF di prova" : volume?.titolo ?? ""}
      </Text>
      <Text style={{ fontSize: 12, opacity: 0.65 }}>{totale ? `${pagina} / ${totale}` : ""}</Text>
      {id !== "prova" ? (
        <Pressable onPress={() => setPannello((v) => !v)} hitSlop={10}
          style={{ paddingHorizontal: 9, paddingVertical: 4, borderRadius: 7,
                   backgroundColor: pannello ? C.primario : C.superficie }}>
          <Text style={{ fontSize: 12, fontWeight: "600", color: pannello ? C.suPrimario : C.testoSecondario }}>
            ✎ {segni.length}
          </Text>
        </Pressable>
      ) : null}
    </View>
  );

  async function aggiungiSegno(genere: "nota" | "segnalibro") {
    const testo = genere === "segnalibro" ? `Segnalibro a pagina ${pagina}` : bozza.trim();
    if (!testo) return;
    if (genere === "nota") setBozza("");
    await annota(String(id), genere, testo, pagina);
    await ricaricaSegni();
  }

  const Pannello = (
    <View style={{ maxHeight: "55%", borderTopWidth: 1, borderColor: C.bordo, backgroundColor: C.sfondo }}>
      <View style={{ flexDirection: "row", gap: 8, padding: 11, alignItems: "center" }}>
        <Text style={{ flex: 1, fontSize: 13, fontWeight: "600" }}>
          Segni su questo testo · pagina {pagina}
        </Text>
        <Pressable onPress={() => { void aggiungiSegno("segnalibro"); }}
          style={{ paddingHorizontal: 11, paddingVertical: 7, borderRadius: 8, backgroundColor: C.superficie }}>
          <Text style={{ fontSize: 12, fontWeight: "600" }}>Segnalibro</Text>
        </Pressable>
      </View>
      <ScrollView contentContainerStyle={{ paddingHorizontal: 11, paddingBottom: 11, gap: 8 }}>
        {segni.length === 0 ? (
          <Text style={{ fontSize: 12, opacity: 0.55, lineHeight: 18 }}>
            Nessun segno. Restano anche se il file viene riscaricato, e raggiungono
            l'altro dispositivo alla prima sincronizzazione.
          </Text>
        ) : null}
        {segni.map((sg) => (
          <Pressable key={sg.id}
            onPress={() => { if (sg.pagina) setPagina(sg.pagina); }}
            onLongPress={() => Alert.alert(sg.genere === "segnalibro" ? "Segnalibro" : "Nota", sg.testo, [
              { text: "Cancella", style: "destructive",
                onPress: async () => { await cancella(sg.id); await ricaricaSegni(); } },
              { text: "Annulla", style: "cancel" },
            ])}
            style={{ backgroundColor: sg.genere === "segnalibro" ? C.verdeFondo : C.superficie,
                     borderRadius: 8, padding: 10 }}>
            <Text style={{ fontSize: 10, opacity: 0.5 }}>
              {sg.pagina ? `p. ${sg.pagina}` : "—"} · {sg.genere}
            </Text>
            <Text style={{ fontSize: 13, lineHeight: 19, marginTop: 2 }}>{sg.testo}</Text>
          </Pressable>
        ))}
        <TextInput
          value={bozza}
          onChangeText={setBozza}
          placeholder={`Nota su pagina ${pagina}…`}
          multiline
          style={{ borderWidth: 1, borderColor: C.bordo, borderRadius: 8, padding: 10,
                   fontSize: 13, minHeight: 62, textAlignVertical: "top" }}
        />
        <Pressable onPress={() => { void aggiungiSegno("nota"); }}
          style={{ alignSelf: "flex-start", backgroundColor: C.primario,
                   paddingHorizontal: 13, paddingVertical: 8, borderRadius: 8 }}>
          <Text style={{ color: C.suPrimario, fontWeight: "600", fontSize: 12 }}>Aggiungi nota</Text>
        </Pressable>
      </ScrollView>
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
              style={{ backgroundColor: C.primario, padding: 13, borderRadius: 10, alignItems: "center" }}>
              <Text style={{ color: C.suPrimario, fontWeight: "600" }}>Apri con il visore del sistema</Text>
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
    <View style={{ flex: 1, backgroundColor: C.sfondo }}>
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
        onRenderProcessGone={() => setErrore(PROCESSO_CHIUSO)}
        style={{ flex: 1, backgroundColor: C.sfondo }}
      />
      {pannello ? Pannello : null}
    </View>
  );
}
