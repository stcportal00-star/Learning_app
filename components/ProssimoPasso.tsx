import { useCallback, useState } from "react";
import { View, Pressable } from "react-native";
import { router, useFocusEffect } from "expo-router";
import { leggiPercorso, leggiVolumi, volumeDaAprire } from "../lib/avanzamento";
import { leggiSeguiti } from "../lib/progetti";
import { TEMI, nomeArea } from "../lib/contenuti";
import {
  Passo, Unita, daFare, descriviPasso, destinazione, progetti, unitaConVerifiche,
} from "../lib/percorso";
import { Text } from "./Base";
import { C } from "../lib/tema";

/** Una cosa da fare adesso: il passo di un progetto, o quello del piano. */
type Voce = {
  unita: Unita;
  passo: Passo;
  volume: string | null;
  /** Il tema scelto, quando l'unità è il suo seguito. */
  dopo: string | null;
  /**
   * Viene dal piano e non da un progetto: succede anche con dei temi seguiti,
   * quando le loro aree sono finite, e allora non va presentato come «il tuo
   * progetto», né con la scritta dei progetti.
   */
  dalPiano: boolean;
};

type Stato = {
  voci: Voce[];
  /** Progetti la cui area è tutta superata: si dice, non si tace. */
  finiti: string[];
  seguiti: number;
  superate: number;
  conVerifiche: number;
};

const NOME_TEMA = new Map(TEMI.map(([slug, nome]) => [slug, nome]));

/**
 * «Che cosa faccio adesso». Sta in cima a Oggi e a Studio perché è la domanda
 * con cui si apre l'app; tutto il resto — conteggi, rassegna, cronometro —
 * viene dopo.
 *
 * Con dei temi seguiti, un riquadro per progetto: il passo di ciascuno, in
 * parallelo, nell'ordine in cui si sono scelti. Senza, il primo passo non
 * fatto della prima unità non superata, come nel piano. Il piano torna anche
 * quando tutti i progetti hanno finito la loro area: resta sempre qualcosa da
 * cominciare.
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
      const [unita, seguiti] = await Promise.all([leggiPercorso(), leggiSeguiti()]);
      const tutti = progetti(unita, seguiti);
      const voci = await Promise.all(daFare(unita, seguiti).map(async (v) => ({
        unita: v.unita,
        passo: v.passo,
        dopo: v.progetto?.subentrata ? v.progetto.seguito : null,
        dalPiano: v.progetto === null,
        volume: v.passo.tipo === "leggi" ? volumeDaAprire(await leggiVolumi(v.unita.tema.slug)) : null,
      })));
      if (vivo) {
        setS({
          voci,
          finiti: tutti.filter((p) => !p.passo && p.areaFinita).map((p) => p.seguito),
          seguiti: tutti.length,
          superate: unita.filter((u) => u.stato === "completa").length,
          conVerifiche: unitaConVerifiche(unita),
        });
      }
    })();
    return () => { vivo = false; };
  }, []));

  if (!s) return null;

  const Finiti = s.finiti.length ? (
    <Text style={{ fontSize: 12, color: C.verde, lineHeight: 18 }}>
      {s.finiti.map((f) => `«${NOME_TEMA.get(f) ?? f}»`).join(", ")}: area tutta superata.
      Da Studio se ne sceglie un altro.
    </Text>
  ) : null;

  if (!s.voci.length) {
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

  const Riquadro = ({ v }: { v: Voce }) => {
    const d = descriviPasso(v.passo);
    const slug = v.unita.tema.slug;
    const area = nomeArea(v.unita.tema.pista);
    return (
      <View style={{ padding: 14, borderRadius: 12, borderWidth: 1, borderColor: C.bluBordo, backgroundColor: C.bluFondo }}>
        <Text style={{ fontSize: 12, color: C.blu }}>
          {v.dalPiano
            ? `Prossimo passo · unità ${v.unita.posizione} · ${s.superate} di ${s.conVerifiche} superate`
            : `Unità ${v.unita.posizione}${area ? ` · ${area}` : ""}`}
        </Text>
        {v.dopo ? (
          <Text style={{ fontSize: 12, color: C.verde, marginTop: 2 }}>
            {/* Non «il tema dopo»: finita l'area in avanti, il seguito è un
                tema rimasto indietro, che nel piano viene prima. */}
            «{NOME_TEMA.get(v.dopo) ?? v.dopo}» è superato: si continua con un altro tema della sua area.
          </Text>
        ) : null}
        <Text style={{ fontSize: 18, fontWeight: "600", marginTop: 3 }}>{d.titolo}</Text>
        <Text style={{ fontSize: 14, marginTop: 1 }}>{v.unita.tema.nome}</Text>
        <Text style={{ fontSize: 13, opacity: 0.7, marginTop: 4, lineHeight: 18 }}>{d.dettaglio}</Text>
        <View style={{ flexDirection: "row", gap: 8, marginTop: 11 }}>
          <Pressable onPress={() => router.push(destinazione(slug, v.passo, v.volume) as never)}
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
  };

  const aperti = s.voci.filter((v) => !v.dalPiano).length;
  return (
    <View style={{ gap: 10 }}>
      {aperti ? (
        <Text style={{ fontSize: 12, fontWeight: "600", opacity: 0.6 }}>
          {aperti === 1 ? "Il tuo progetto" : `I tuoi ${aperti} progetti`} · {s.superate} di {s.conVerifiche} unità superate
        </Text>
      ) : null}
      {s.voci.map((v) => <Riquadro key={v.unita.tema.slug} v={v} />)}
      {Finiti}
      {!s.seguiti ? (
        // Il piano propone un ordine, non lo impone: chi vuole l'hardware
        // prima di SQL, o tre cose insieme, deve sapere dove si sceglie.
        <Text style={{ fontSize: 12, opacity: 0.55, lineHeight: 18 }}>
          Vuoi studiare altro, o più cose insieme? In Studio apri un'unità e tocca «Segui».
        </Text>
      ) : null}
    </View>
  );
}
