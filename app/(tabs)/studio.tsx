import { useEffect, useState } from "react";
import { View, Text, Pressable, ScrollView } from "react-native";
import { Link } from "expo-router";
import { database } from "../../lib/db";
import { supportaWindowFunctions } from "../../lib/palestra";

type Conteggio = { sql: number; codice: number; ripasso: number; scenari: number };

export default function Studio() {
  const [c, setC] = useState<Conteggio>({ sql: 0, codice: 0, ripasso: 0, scenari: 0 });

  useEffect(() => {
    (async () => {
      const d = database();
      const adesso = new Date().toISOString();
      const filtro = supportaWindowFunctions() ? "" : " AND tema_slug <> 'sql_window'";
      const [sql, cod, rip, sce] = await Promise.all([
        d.getFirstAsync<{ n: number }>(
          `SELECT count(*) AS n FROM esercizi e WHERE e.tipo='sql_eseguibile' AND e.dataset='palestra.db'${filtro}
           AND NOT EXISTS (SELECT 1 FROM tentativi t WHERE t.esercizio_id=e.id AND t.esito='corretto')`),
        d.getFirstAsync<{ n: number }>(
          `SELECT count(*) AS n FROM esercizi e WHERE e.tipo='lettura_codice'
           AND NOT EXISTS (SELECT 1 FROM tentativi t WHERE t.esercizio_id=e.id AND t.esito='corretto')`),
        d.getFirstAsync<{ n: number }>("SELECT count(*) AS n FROM ripasso WHERE prossima_revisione <= ?", [adesso]),
        d.getFirstAsync<{ n: number }>("SELECT count(*) AS n FROM esercizi WHERE tipo='rubrica'"),
      ]);
      setC({ sql: sql?.n ?? 0, codice: cod?.n ?? 0, ripasso: rip?.n ?? 0, scenari: sce?.n ?? 0 });
    })();
  }, []);

  const Voce = ({ href, titolo, nota, n }: { href: string; titolo: string; nota: string; n: number }) => (
    <Link href={href as never} asChild>
      <Pressable style={{ borderWidth: 1, borderColor: "#E4E4E7", borderRadius: 12, padding: 15 }}>
        <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
          <Text style={{ fontSize: 17, fontWeight: "500" }}>{titolo}</Text>
          <Text style={{ fontSize: 20, fontWeight: "500", opacity: n ? 1 : 0.3 }}>{n}</Text>
        </View>
        <Text style={{ fontSize: 13, opacity: 0.6, marginTop: 4, lineHeight: 18 }}>{nota}</Text>
      </Pressable>
    </Link>
  );

  return (
    <ScrollView contentContainerStyle={{ padding: 16, gap: 12 }}>
      <Text style={{ fontSize: 22, fontWeight: "600" }}>Studio</Text>
      <Voce href="/esercizi" titolo="Esercizi SQL" n={c.sql}
        nota="La risposta si verifica eseguendola: una soluzione diversa dalla mia ma corretta passa." />
      <Voce href="/codice" titolo="Lettura del codice" n={c.codice}
        nota="Un modulo, un difetto, un test che lo dimostra. Prima l'ipotesi, poi il resto." />
      <Voce href="/ripasso" titolo="Ripasso" n={c.ripasso}
        nota="Schede con citazione puntuale: ogni risposta è verificabile alla fonte." />
      <View style={{ borderWidth: 1, borderColor: "#E4E4E7", borderRadius: 12, padding: 15, opacity: 0.75 }}>
        <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
          <Text style={{ fontSize: 17, fontWeight: "500" }}>Scenari a rubrica</Text>
          <Text style={{ fontSize: 20, fontWeight: "500" }}>{c.scenari}</Text>
        </View>
        <Text style={{ fontSize: 13, opacity: 0.6, marginTop: 4, lineHeight: 18 }}>
          Nessuna risposta corretta unica: si producono in Note e si valutano con la rubrica.
        </Text>
      </View>
    </ScrollView>
  );
}
