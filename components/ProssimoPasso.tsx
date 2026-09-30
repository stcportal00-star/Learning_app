import { useCallback, useState } from "react";
import { View, Pressable } from "react-native";
import { router, useFocusEffect } from "expo-router";
import { leggiPercorso, leggiVolumi, volumeDaAprire } from "../lib/avanzamento";
// Rinominata: il componente si chiama come la funzione.
import {
  Indicazione, descriviPasso, destinazione, prossimoPasso as prossimoPassoDi, unitaConVerifiche,
} from "../lib/percorso";
import { Text } from "./Base";
import { C } from "../lib/tema";

type Stato = { indicazione: Indicazione | null; volume: string | null; superate: number; conVerifiche: number };

/**
 * «Che cosa faccio adesso»: il primo passo non fatto della prima unità non
 * superata. Sta in cima a Oggi e a Studio perché è la domanda con cui si
 * apre l'app; tutto il resto — conteggi, rassegna, cronometro — viene dopo.
 *
 * Si ricalcola a ogni ritorno in primo piano: le schede restano montate, e
 * dopo un esercizio risolto l'indicazione deve essere già la successiva.
 * Finché il primo calcolo non c'è, il riquadro non c'è: sono letture locali
 * di pochi millisecondi, una rotella sarebbe solo un lampo.
 */
export default function ProssimoPasso() {
  const [s, setS] = useState<Stato | null>(null);

  useFocusEffect(useCallback(() => {
    let vivo = true;
    (async () => {
      const unita = await leggiPercorso();
      const indicazione = prossimoPassoDi(unita);
      const volume = indicazione?.passo.tipo === "leggi"
        ? volumeDaAprire(await leggiVolumi(indicazione.unita.tema.slug)) : null;
      if (vivo) {
        setS({
          indicazione, volume,
          superate: unita.filter((u) => u.stato === "completa").length,
          conVerifiche: unitaConVerifiche(unita),
        });
      }
    })();
    return () => { vivo = false; };
  }, []));

  if (!s) return null;

  if (!s.indicazione) {
    return (
      <View style={{ padding: 14, borderRadius: 12, borderWidth: 1, borderColor: C.verde, backgroundColor: C.verdeFondo }}>
        <Text style={{ fontSize: 12, color: C.verde }}>Percorso</Text>
        <Text style={{ fontSize: 17, fontWeight: "600", marginTop: 3 }}>
          Tutte le {s.conVerifiche} unità sono superate.
        </Text>
        <Text style={{ fontSize: 13, opacity: 0.7, marginTop: 3, lineHeight: 18 }}>
          Le schede continuano a tornare nel ripasso, a intervalli crescenti.
        </Text>
      </View>
    );
  }

  const { unita, passo } = s.indicazione;
  const d = descriviPasso(passo);
  const slug = unita.tema.slug;
  return (
    <View style={{ padding: 14, borderRadius: 12, borderWidth: 1, borderColor: C.bluBordo, backgroundColor: C.bluFondo }}>
      <Text style={{ fontSize: 12, color: C.blu }}>
        Prossimo passo · unità {unita.posizione} · {s.superate} di {s.conVerifiche} superate
      </Text>
      <Text style={{ fontSize: 18, fontWeight: "600", marginTop: 3 }}>{d.titolo}</Text>
      <Text style={{ fontSize: 14, marginTop: 1 }}>{unita.tema.nome}</Text>
      <Text style={{ fontSize: 13, opacity: 0.7, marginTop: 4, lineHeight: 18 }}>{d.dettaglio}</Text>
      <View style={{ flexDirection: "row", gap: 8, marginTop: 11 }}>
        <Pressable onPress={() => router.push(destinazione(slug, passo, s.volume) as never)}
          style={{ paddingHorizontal: 15, paddingVertical: 9, borderRadius: 9, backgroundColor: C.primario }}>
          <Text style={{ fontSize: 14, fontWeight: "600", color: C.suPrimario }}>Comincia</Text>
        </Pressable>
        <Pressable onPress={() => router.push(`/unita?tema=${encodeURIComponent(slug)}` as never)}
          style={{ paddingHorizontal: 15, paddingVertical: 9, borderRadius: 9, backgroundColor: C.superficieAlta }}>
          <Text style={{ fontSize: 14, fontWeight: "600" }}>L'unità</Text>
        </Pressable>
      </View>
    </View>
  );
}
