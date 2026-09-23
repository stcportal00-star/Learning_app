import { useCallback, useEffect, useState } from "react";
import { View, Text, Pressable, ScrollView, TextInput, Alert, Linking } from "react-native";
import { useLocalSearchParams, router } from "expo-router";
import { leggiArticolo, segnaLetto, segnaSalvato, Articolo } from "../lib/nuvola/articoli";
import { annota, cancella, segniDi, Segno } from "../lib/nuvola/segni";
import {
  statoMedia, scaricaMedia, apriMedia, segnaVisto, dimenticaMedia, descriviByte,
} from "../lib/nuvola/media";

/**
 * La lettura di un articolo, con le note accanto.
 *
 * «Letto» si segna da sé all'apertura: chiedere un tocco in più per una cosa
 * che è già successa fa solo sì che l'elenco non torni mai pulito.
 */
/** Bottone piatto: la schermata ne ha già tre di questa forma. */
function Bottone({ testo, onPress, pieno = false, spento = false }: {
  testo: string; onPress: () => void; pieno?: boolean; spento?: boolean;
}) {
  return (
    <Pressable
      onPress={spento ? undefined : onPress}
      style={{
        paddingHorizontal: 13, paddingVertical: 8, borderRadius: 9,
        opacity: spento ? 0.5 : 1,
        backgroundColor: pieno ? "#18181B" : "#F4F4F5",
        borderWidth: pieno ? 0 : 1, borderColor: "#E4E4E7",
      }}>
      <Text style={{ fontSize: 13, fontWeight: "600", color: pieno ? "#fff" : "#3F3F46" }}>
        {testo}
      </Text>
    </Pressable>
  );
}

/**
 * L'allegato di una voce: un podcast, una conferenza, un video.
 *
 * Qui non c'è logica, di proposito: scaricare, aprire, segnare visto e liberare
 * stanno tutti in lib/nuvola/media.ts, che è provato sul banco. Questa è
 * l'unica parte che nessun test può raggiungere, quindi è anche l'unica che
 * deve limitarsi a mostrare.
 *
 * Non si scarica da soli e non si indovina la connessione: il bottone dice
 * quanti megabyte sono e chi legge decide. In roaming sbagliare costa.
 */
function Allegato({ a, aggiorna }: { a: Articolo; aggiorna: () => Promise<void> }) {
  const [inCorso, setInCorso] = useState(false);
  const [nota, setNota] = useState<string | null>(null);

  if (!a.url_media) return null;
  const stato = statoMedia(a);
  const video = (a.tipo_media || "").startsWith("video/");
  const peso = descriviByte(a.byte_media);

  async function conAttesa(azione: () => Promise<string | null>) {
    setInCorso(true);
    setNota(null);
    try {
      setNota(await azione());
    } catch (e) {
      setNota(String(e).slice(0, 160));
    } finally {
      setInCorso(false);
      await aggiorna();
    }
  }

  const scarica = () => conAttesa(async () => {
    const esito = await scaricaMedia(a.id);
    return esito.stato === "in_cache"
      ? null
      : `Non si è riusciti a scaricare: ${esito.errore || "indirizzo che non risponde"}. ` +
        "La voce resta leggibile, e si riprova quando c'è rete.";
  });

  const apri = () => conAttesa(async () => {
    const esito = await apriMedia(a.id);
    if (esito === "aperto") return null;
    return esito === "non_scaricato"
      ? "La copia non c'è più sul telefono. Si riscarica quando c'è rete."
      : "Nessuna app di questo telefono sa aprire questo tipo di file.";
  });

  return (
    <View style={{ borderWidth: 1, borderColor: "#E4E4E7", borderRadius: 11,
                   padding: 12, gap: 9, backgroundColor: "#FAFAFA" }}>
      <Text style={{ fontSize: 13, fontWeight: "600" }}>
        {video ? "Video" : "Audio"}
        <Text style={{ fontWeight: "400", opacity: 0.6 }}>{"  ·  " + peso}</Text>
      </Text>

      <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap" }}>
        {stato === "da_scaricare" || stato === "mancante" || stato === "visto" ? (
          <Bottone
            testo={inCorso ? "Scarico…" : stato === "da_scaricare" ? `Scarica (${peso})` : `Scarica di nuovo (${peso})`}
            onPress={scarica} pieno spento={inCorso} />
        ) : null}
        {stato === "in_cache" ? (
          <>
            <Bottone testo={video ? "Guarda" : "Ascolta"} onPress={apri} pieno spento={inCorso} />
            <Bottone
              testo="Visto"
              spento={inCorso}
              onPress={() => Alert.alert(
                "Segnare come visto?",
                "La copia sul telefono viene cancellata e lo spazio torna libero. "
                  + "La voce resta, e se un giorno c'è rete si riscarica.",
                [
                  { text: "Annulla", style: "cancel" },
                  { text: "Visto", onPress: () => void conAttesa(async () => {
                      await segnaVisto(a.id);
                      return null;
                    }) },
                ])} />
            <Bottone
              testo="Libera spazio"
              spento={inCorso}
              onPress={() => void conAttesa(async () => {
                await dimenticaMedia(a.id);
                return null;
              })} />
          </>
        ) : null}
        {a.url_trascrizione ? (
          <Bottone
            testo="Trascrizione"
            spento={inCorso}
            onPress={() => { void Linking.openURL(a.url_trascrizione!).catch(() =>
              Alert.alert("Senza rete", "La trascrizione dell'autore sta sul suo sito e richiede internet.")); }} />
        ) : null}
      </View>

      {stato === "mancante" ? (
        <Text style={{ fontSize: 11, opacity: 0.6, lineHeight: 17 }}>
          La copia locale non c'è più: l'ha tolta il sistema, o una pulizia dello spazio.
        </Text>
      ) : null}
      {stato === "visto" && a.visto_a ? (
        <Text style={{ fontSize: 11, opacity: 0.6, lineHeight: 17 }}>
          Visto il {a.visto_a.slice(0, 10)}. La copia è stata cancellata per fare spazio.
        </Text>
      ) : null}
      {stato === "da_scaricare" ? (
        <Text style={{ fontSize: 11, opacity: 0.6, lineHeight: 17 }}>
          Si scarica solo adesso, e solo se glielo si chiede: in viaggio i megabyte si contano.
        </Text>
      ) : null}
      {nota ? (
        <Text style={{ fontSize: 12, color: "#B45309", lineHeight: 18 }}>{nota}</Text>
      ) : null}
    </View>
  );
}

export default function SchedaArticolo() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [a, setA] = useState<Articolo | null>(null);
  const [note, setNote] = useState<Segno[]>([]);
  const [bozza, setBozza] = useState("");
  const [errore, setErrore] = useState<string | null>(null);

  const ricarica = useCallback(async () => {
    if (!id) return;
    setNote(await segniDi(String(id)));
  }, [id]);

  useEffect(() => {
    (async () => {
      try {
        const v = await leggiArticolo(String(id));
        if (!v) { setErrore("Articolo non trovato."); return; }
        setA(v);
        await ricarica();
        if (!v.letto) {
          await segnaLetto(v.id, true);
          setA({ ...v, letto: 1 });
        }
      } catch (e) {
        setErrore(String(e));
      }
    })();
  }, [id, ricarica]);

  async function aggiungiNota() {
    const t = bozza.trim();
    if (!t || !a) return;
    setBozza("");
    await annota(a.id, "nota", t);
    await ricarica();
  }

  if (errore) {
    return (
      <View style={{ flex: 1, padding: 20, gap: 10 }}>
        <Pressable onPress={() => router.back()}>
          <Text style={{ fontSize: 13, opacity: 0.6 }}>‹ Indietro</Text>
        </Pressable>
        <Text style={{ fontSize: 14 }}>{errore}</Text>
      </View>
    );
  }
  if (!a) return <View style={{ flex: 1 }} />;

  const corpo = a.testo && a.testo.trim() ? a.testo : a.abstract || "";

  return (
    <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 48, gap: 12 }}>
      <Pressable onPress={() => router.back()}>
        <Text style={{ fontSize: 13, opacity: 0.6 }}>‹ Rassegna</Text>
      </Pressable>

      <Text style={{ fontSize: 21, fontWeight: "600", lineHeight: 28 }}>{a.titolo}</Text>
      <Text style={{ fontSize: 12, opacity: 0.6 }}>
        {[a.autori, a.fonte, a.pubblicato_a?.slice(0, 10)].filter(Boolean).join(" · ") || "—"}
      </Text>
      {a.licenza ? <Text style={{ fontSize: 11, opacity: 0.5 }}>{a.licenza}</Text> : null}

      <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap" }}>
        <Pressable
          onPress={async () => { await segnaSalvato(a.id, !a.salvato); setA({ ...a, salvato: a.salvato ? 0 : 1 }); }}
          style={{ paddingHorizontal: 13, paddingVertical: 8, borderRadius: 9,
                   backgroundColor: a.salvato ? "#18181B" : "#F4F4F5" }}>
          <Text style={{ fontSize: 13, fontWeight: "600", color: a.salvato ? "#fff" : "#3F3F46" }}>
            {a.salvato ? "Salvato" : "Salva"}
          </Text>
        </Pressable>
        <Pressable
          onPress={async () => { await segnaLetto(a.id, !a.letto); setA({ ...a, letto: a.letto ? 0 : 1 }); }}
          style={{ paddingHorizontal: 13, paddingVertical: 8, borderRadius: 9,
                   borderWidth: 1, borderColor: "#E4E4E7" }}>
          <Text style={{ fontSize: 13, fontWeight: "600" }}>
            {a.letto ? "Segna da leggere" : "Segna letto"}
          </Text>
        </Pressable>
        {a.url ? (
          <Pressable
            onPress={() => { void Linking.openURL(a.url!).catch(() => Alert.alert("Senza rete", "La pagina originale richiede internet. Il testo qui sopra no.")); }}
            style={{ paddingHorizontal: 13, paddingVertical: 8, borderRadius: 9,
                     borderWidth: 1, borderColor: "#E4E4E7" }}>
            <Text style={{ fontSize: 13, fontWeight: "600" }}>Originale</Text>
          </Pressable>
        ) : null}
      </View>

      <Allegato a={a} aggiorna={async () => {
        const v = await leggiArticolo(String(id));
        if (v) setA(v);
      }} />

      {corpo ? (
        <Text selectable style={{ fontSize: 15, lineHeight: 24, marginTop: 4 }}>{corpo}</Text>
      ) : (
        <Text style={{ fontSize: 13, opacity: 0.6, lineHeight: 20, marginTop: 4 }}>
          Di questa voce la conduttura non è riuscita a estrarre il testo: la fonte lo
          serve solo dietro una pagina che richiede rete. Resta il collegamento.
        </Text>
      )}

      <View style={{ marginTop: 18, paddingTop: 14, borderTopWidth: 1, borderColor: "#E4E4E7", gap: 10 }}>
        <Text style={{ fontSize: 15, fontWeight: "600" }}>Note</Text>
        <Text style={{ fontSize: 11, opacity: 0.55, lineHeight: 17 }}>
          Le note stanno accanto al testo, non dentro: si sincronizzano da sole e
          restano anche se il testo viene riscaricato.
        </Text>
        {note.map((n) => (
          <Pressable key={n.id}
            onLongPress={() => Alert.alert("Nota", n.testo, [
              { text: "Cancella", style: "destructive", onPress: async () => { await cancella(n.id); await ricarica(); } },
              { text: "Annulla", style: "cancel" },
            ])}
            style={{ backgroundColor: "#F8F8F9", borderRadius: 9, padding: 11 }}>
            <Text style={{ fontSize: 13, lineHeight: 20 }}>{n.testo}</Text>
            <Text style={{ fontSize: 10, opacity: 0.45, marginTop: 4 }}>{n.creato_a.slice(0, 16).replace("T", " ")}</Text>
          </Pressable>
        ))}
        <TextInput
          value={bozza}
          onChangeText={setBozza}
          placeholder="Scrivi una nota su questo testo…"
          multiline
          style={{ borderWidth: 1, borderColor: "#E4E4E7", borderRadius: 9, padding: 11,
                   fontSize: 14, minHeight: 74, textAlignVertical: "top" }}
        />
        <Pressable onPress={aggiungiNota}
          style={{ alignSelf: "flex-start", backgroundColor: "#18181B",
                   paddingHorizontal: 14, paddingVertical: 9, borderRadius: 9 }}>
          <Text style={{ color: "#fff", fontWeight: "600", fontSize: 13 }}>Aggiungi nota</Text>
        </Pressable>
      </View>
    </ScrollView>
  );
}
