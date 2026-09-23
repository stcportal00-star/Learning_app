import { useEffect, useState } from "react";
import { View, Text, ScrollView } from "react-native";
import { Link } from "expo-router";
import Constants from "expo-constants";
import { Pressable } from "react-native";
import { database } from "../../lib/db";
import { divergenzaCorrente } from "../../lib/sync/stato";
import { Divergenza } from "../../lib/sync/auto";
import { leggiPromemoria } from "../../lib/notifiche";
import { Promemoria, PREDEFINITO, comeTesto } from "../../lib/promemoria";

/**
 * Quale build sta girando, in una riga. Si calcola una volta sola al caricamento
 * del modulo: non cambia mentre l'app e' aperta.
 *
 * Tre esiti distinti, e la distinzione conta. `expoConfig` nullo significa che
 * l'asset di configurazione non si e' aperto — un guasto, non un build locale, e
 * confonderli farebbe dire «locale» a un APK di CI. `corsa` assente significa
 * che il build non e' nato da una corsa di GitHub, cioe' compilato a mano.
 *
 * Il versionCode non compare: nasce da un orologio e viene letto due volte in
 * momenti diversi, quindi qui direbbe un numero che il sistema puo' non avere.
 * Il suo mestiere e' lasciar installare l'aggiornamento, non farsi leggere.
 */
function comeSiChiamaQuestaBuild(): string {
  const c = Constants.expoConfig;
  if (!c) return "build sconosciuta";
  const extra = (c.extra ?? {}) as { corsa?: string | null; commit?: string | null };
  const versione = c.version ?? "?";
  if (!extra.corsa) return `Percorso ${versione} · build locale`;
  return `Percorso ${versione} · build ${extra.corsa}${extra.commit ? ` · ${extra.commit}` : ""}`;
}

const QUESTA_BUILD = comeSiChiamaQuestaBuild();

export default function Profilo() {
  const [art, setArt] = useState<Array<{ trimestre: string; n: number }>>([]);
  const [cred, setCred] = useState<Array<{ anno_previsto: number; n: number; costo: number }>>([]);
  const [div, setDiv] = useState<Divergenza | null>(null);
  const [prom, setProm] = useState<Promemoria>(PREDEFINITO);

  useEffect(() => {
    (async () => {
      const d = database();
      setArt(await d.getAllAsync("SELECT trimestre, count(*) AS n FROM artefatti GROUP BY trimestre ORDER BY trimestre"));
      setCred(await d.getAllAsync("SELECT anno_previsto, count(*) AS n, IFNULL(sum(costo_usd),0) AS costo FROM credenziali GROUP BY anno_previsto ORDER BY anno_previsto"));
      setDiv(await divergenzaCorrente());
      setProm(await leggiPromemoria());
    })();
  }, []);

  return (
    <ScrollView contentContainerStyle={{ padding: 16, gap: 16 }}>
      <Text style={{ fontSize: 22, fontWeight: "600" }}>Profilo</Text>

      {/* Sotto il titolo e non in fondo: quando serve — un crash, un
          aggiornamento che non si installa, due dispositivi che si comportano
          in modo diverso — serve subito, e finisce nello screenshot che il test
          di fumo allega alla release senza che nessuno debba scorrere. */}
      <Text style={{ fontSize: 12, opacity: 0.55, marginTop: -10 }}>{QUESTA_BUILD}</Text>

      <Link href="/sync" asChild>
        <Pressable style={{ borderWidth: 1, borderColor: "#E4E4E7", borderRadius: 11, padding: 14 }}>
          <Text style={{ fontSize: 16, fontWeight: "500" }}>Sincronizzazione</Text>
          <Text style={{ fontSize: 13, opacity: 0.65, marginTop: 3, lineHeight: 18 }}>
            {div ? div.messaggio : "Accoppia i tuoi due dispositivi."}
          </Text>
        </Pressable>
      </Link>

      <Link href="/promemoria" asChild>
        <Pressable style={{ borderWidth: 1, borderColor: "#E4E4E7", borderRadius: 11, padding: 14 }}>
          <Text style={{ fontSize: 16, fontWeight: "500" }}>Promemoria</Text>
          <Text style={{ fontSize: 13, opacity: 0.65, marginTop: 3, lineHeight: 18 }}>
            {prom.attivo
              ? `Blocco ${prom.tipo} alle ${comeTesto(prom)}, ogni giorno.`
              : "Nessun avviso. Notifica locale, funziona anche in aereo."}
          </Text>
        </Pressable>
      </Link>

      <View>
        <Text style={{ fontSize: 15, fontWeight: "600", marginBottom: 8 }}>Artefatti per trimestre</Text>
        {art.length === 0 ? <Text style={{ opacity: 0.6 }}>Sincronizza il piano da Supabase.</Text> :
          art.map((a) => (
            <Text key={a.trimestre} style={{ fontSize: 14, paddingVertical: 3 }}>{a.trimestre} · {a.n}</Text>
          ))}
      </View>
      <View>
        <Text style={{ fontSize: 15, fontWeight: "600", marginBottom: 8 }}>Credenziali per anno</Text>
        {cred.length === 0 ? <Text style={{ opacity: 0.6 }}>Sincronizza il piano da Supabase.</Text> :
          cred.map((c) => (
            <Text key={c.anno_previsto} style={{ fontSize: 14, paddingVertical: 3 }}>
              Anno {c.anno_previsto} · {c.n} · {c.costo.toFixed(0)} USD
            </Text>
          ))}
      </View>
    </ScrollView>
  );
}
