import { useCallback, useEffect, useState } from "react";
import { View, Pressable, ScrollView } from "react-native";
import { Link, router, useFocusEffect } from "expo-router";
import { database } from "../../lib/db";
import { supportaWindowFunctions } from "../../lib/palestra";
import { leggiPercorso } from "../../lib/avanzamento";
import { Unita, progetti, prossimoPasso } from "../../lib/percorso";
import { leggiSeguiti } from "../../lib/progetti";
import ProssimoPasso from "../../components/ProssimoPasso";
import { Text } from "../../components/Base";
import { C } from "../../lib/tema";

type Conteggio = { sql: number; codice: number; ripasso: number; scenari: number };

const ETICHETTA_STATO: Record<Unita["stato"], string> = {
  completa: "superata",
  in_corso: "in corso",
  da_iniziare: "da iniziare",
  senza_verifiche: "solo lettura",
};

/**
 * Studio è il percorso: le unità nell'ordine in cui si affrontano, ognuna con
 * il suo avanzamento, e in cima la prossima cosa da fare. Gli strumenti per
 * tipo — tutti gli esercizi SQL, tutto il ripasso — restano sotto, per chi
 * vuole esercitarsi fuori ordine; ma non sono più l'ingresso.
 */
export default function Studio() {
  const [c, setC] = useState<Conteggio>({ sql: 0, codice: 0, ripasso: 0, scenari: 0 });
  const [unita, setUnita] = useState<Unita[]>([]);
  const [seguiti, setSeguiti] = useState<string[]>([]);

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

  // Il percorso sì si rilegge a ogni ritorno: è la parte di Studio che cambia
  // mentre si studia, e un avanzamento fermo a quando si è aperta l'app
  // direbbe che l'esercizio appena risolto non è servito.
  useFocusEffect(useCallback(() => {
    let vivo = true;
    (async () => {
      const [u, s] = await Promise.all([leggiPercorso(), leggiSeguiti()]);
      if (vivo) { setUnita(u); setSeguiti(s); }
    })();
    return () => { vivo = false; };
  }, []));

  // «Adesso» sono le unità dei progetti; senza progetti, quella del piano.
  const attivi = progetti(unita, seguiti).filter((p) => p.passo).map((p) => p.unita.tema.slug);
  const correnti = new Set(attivi.length ? attivi : [prossimoPasso(unita)?.unita.tema.slug ?? ""]);

  const Voce = ({ href, titolo, nota, n }: { href: string; titolo: string; nota: string; n: number }) => (
    <Link href={href as never} asChild>
      <Pressable style={{ borderWidth: 1, borderColor: C.bordo, borderRadius: 12, padding: 15 }}>
        <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
          <Text style={{ fontSize: 17, fontWeight: "500" }}>{titolo}</Text>
          <Text style={{ fontSize: 20, fontWeight: "500", opacity: n ? 1 : 0.3 }}>{n}</Text>
        </View>
        <Text style={{ fontSize: 13, opacity: 0.6, marginTop: 4, lineHeight: 18 }}>{nota}</Text>
      </Pressable>
    </Link>
  );

  const RigaUnita = ({ u }: { u: Unita }) => {
    const qui = correnti.has(u.tema.slug);
    const colore = u.stato === "completa" ? C.verde : qui ? C.blu : C.testoTenue;
    return (
      <Pressable onPress={() => router.push(`/unita?tema=${encodeURIComponent(u.tema.slug)}` as never)}
        style={{ borderWidth: 1, borderRadius: 11, padding: 12, gap: 7,
                 borderColor: qui ? C.bluBordo : C.bordo, backgroundColor: qui ? C.bluFondo : "transparent" }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
          <Text style={{ fontSize: 13, fontWeight: "600", color: colore, width: 22 }}>
            {u.stato === "completa" ? "✓" : u.posizione ?? "·"}
          </Text>
          <Text style={{ fontSize: 15, fontWeight: "500", flex: 1 }} numberOfLines={1}>{u.tema.nome}</Text>
          <Text style={{ fontSize: 12, color: colore }}>{qui ? "adesso" : ETICHETTA_STATO[u.stato]}</Text>
        </View>
        {u.stato !== "senza_verifiche" ? (
          <View style={{ height: 4, borderRadius: 2, backgroundColor: C.superficieAlta, overflow: "hidden", marginLeft: 32 }}>
            <View style={{ width: `${Math.round(u.avanzamento * 100)}%`, height: 4,
                           backgroundColor: u.stato === "completa" ? C.verde : C.blu }} />
          </View>
        ) : null}
      </Pressable>
    );
  };

  // Le unità per trimestre, nell'ordine in cui arrivano: leggiPercorso() le
  // ha già ordinate, qui si mettono solo le intestazioni.
  const gruppi: Array<{ trimestre: string; unita: Unita[] }> = [];
  for (const u of unita) {
    const t = u.tema.trimestre ?? "Senza trimestre";
    const ultimo = gruppi[gruppi.length - 1];
    if (ultimo && ultimo.trimestre === t) ultimo.unita.push(u);
    else gruppi.push({ trimestre: t, unita: [u] });
  }

  return (
    <ScrollView contentContainerStyle={{ padding: 16, gap: 12, paddingBottom: 32 }}>
      <Text style={{ fontSize: 22, fontWeight: "600" }}>Studio</Text>
      <Text style={{ fontSize: 13, opacity: 0.6, lineHeight: 19 }}>
        L'ordine del piano è un consiglio: puoi seguire i temi che vuoi, anche più d'uno insieme
        (apri l'unità e tocca «Segui»). Ogni unità: leggi la fonte, esercitati, fissa i concetti
        con le schede, applica a uno scenario. Si supera all'80%.
      </Text>

      <ProssimoPasso />

      {gruppi.map((g) => (
        <View key={g.trimestre} style={{ gap: 8 }}>
          <Text style={{ fontSize: 12, fontWeight: "600", opacity: 0.55, marginTop: 6 }}>{g.trimestre}</Text>
          {g.unita.map((u) => <RigaUnita key={u.tema.slug} u={u} />)}
        </View>
      ))}

      <Text style={{ fontSize: 12, fontWeight: "600", opacity: 0.55, marginTop: 14 }}>Fuori ordine, per tipo</Text>
      <Voce href="/esercizi" titolo="Esercizi SQL" n={c.sql}
        nota="La risposta si verifica eseguendola: una soluzione diversa dalla mia ma corretta passa." />
      <Voce href="/codice" titolo="Lettura del codice" n={c.codice}
        nota="Un modulo, un difetto, un test che lo dimostra. Prima l'ipotesi, poi il resto." />
      <Voce href="/ripasso" titolo="Ripasso" n={c.ripasso}
        nota="Schede con citazione puntuale: ogni risposta è verificabile alla fonte." />
      <View style={{ borderWidth: 1, borderColor: C.bordo, borderRadius: 12, padding: 15, opacity: 0.75 }}>
        <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
          <Text style={{ fontSize: 17, fontWeight: "500" }}>Scenari a rubrica</Text>
          <Text style={{ fontSize: 20, fontWeight: "500" }}>{c.scenari}</Text>
        </View>
        <Text style={{ fontSize: 13, opacity: 0.6, marginTop: 4, lineHeight: 18 }}>
          Nessuna risposta corretta unica: si aprono dall'unità del loro tema, si svolgono in Note e si
          valutano con la rubrica.
        </Text>
      </View>
    </ScrollView>
  );
}
