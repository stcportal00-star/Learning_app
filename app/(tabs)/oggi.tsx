import { useEffect, useState } from "react";
import { View, Text, ScrollView, useWindowDimensions } from "react-native";
import { database, derivaSospetta } from "../../lib/db";
import { versioneMotore, supportaWindowFunctions } from "../../lib/palestra";
import { divergenzaCorrente } from "../../lib/sync/stato";
import { Divergenza } from "../../lib/sync/auto";
import Cronometro from "../../components/Cronometro";
import { riepilogoSettimana, Sessione } from "../../lib/sessioni";

export default function Oggi() {
  const { width } = useWindowDimensions();
  const [s, setS] = useState({ minuti: 0, daRipassare: 0, risolti: 0, totali: 0, volumi: 0 });
  const [div, setDiv] = useState<Divergenza | null>(null);

  const [versione, setVersione] = useState(0);

  useEffect(() => {
    (async () => {
      const d = database();
      const sessioni = await d.getAllAsync<Sessione>(
        "SELECT inizio, minuti, tipo FROM sessioni WHERE inizio >= ?",
        [new Date(Date.now() - 8 * 864e5).toISOString()]);
      const settimana = riepilogoSettimana(sessioni, new Date());
      const [rip, ris, tot, vol] = await Promise.all([
        d.getFirstAsync<{ n: number }>("SELECT count(*) AS n FROM ripasso WHERE prossima_revisione <= ?", [new Date().toISOString()]),
        d.getFirstAsync<{ n: number }>("SELECT count(DISTINCT esercizio_id) AS n FROM tentativi WHERE esito = 'corretto'"),
        d.getFirstAsync<{ n: number }>("SELECT count(*) AS n FROM esercizi"),
        d.getFirstAsync<{ n: number }>("SELECT count(*) AS n FROM biblioteca"),
      ]);
      setS({ minuti: settimana.minuti, daRipassare: rip?.n ?? 0, risolti: ris?.n ?? 0,
             totali: tot?.n ?? 0, volumi: vol?.n ?? 0 });
      setDiv(await divergenzaCorrente());
    })();
  }, [versione]);

  const Scheda = ({ titolo, valore, nota }: { titolo: string; valore: string; nota?: string }) => (
    <View style={{ flex: 1, minWidth: 140, backgroundColor: "#F4F4F5", borderRadius: 11, padding: 13 }}>
      <Text style={{ fontSize: 12, opacity: 0.6 }}>{titolo}</Text>
      <Text style={{ fontSize: 24, fontWeight: "500", marginTop: 2 }}>{valore}</Text>
      {nota ? <Text style={{ fontSize: 11, opacity: 0.55, marginTop: 2 }}>{nota}</Text> : null}
    </View>
  );

  return (
    <ScrollView contentContainerStyle={{ padding: 16, gap: 12 }}>
      <Text style={{ fontSize: 22, fontWeight: "600" }}>Oggi</Text>
      <Text style={{ fontSize: 13, opacity: 0.6 }}>
        Tutto funziona offline. La sincronizzazione è un extra, non un requisito.
      </Text>

      {div && div.livello !== "allineati" ? (
        <View style={{ padding: 12, borderRadius: 10, marginTop: 4,
                       backgroundColor: div.livello === "marcata" ? "#FDECEC" : "#FDF0D5" }}>
          <Text style={{ fontSize: 13, lineHeight: 19,
                         color: div.livello === "marcata" ? "#A12B2B" : "#854F0B" }}>
            {div.messaggio}
          </Text>
        </View>
      ) : null}

      <Cronometro onRegistrata={() => setVersione((v) => v + 1)} />

      <View style={{ flexDirection: "row", gap: 10, flexWrap: "wrap", marginTop: 6 }}>
        <Scheda titolo="Settimana" valore={`${(s.minuti / 60).toFixed(1)} h`} nota="obiettivo 5 h" />
        <Scheda titolo="Da ripassare" valore={String(s.daRipassare)} nota="schede in coda" />
      </View>
      <View style={{ flexDirection: "row", gap: 10, flexWrap: "wrap" }}>
        <Scheda titolo="Esercizi risolti" valore={`${s.risolti} / ${s.totali}`} />
        <Scheda titolo="Libreria" valore={String(s.volumi)} nota="volumi" />
      </View>

      <View style={{ marginTop: 10, padding: 12, borderRadius: 10, borderWidth: 1, borderColor: "#E4E4E7" }}>
        <Text style={{ fontSize: 12, opacity: 0.6 }}>Motore SQL del dispositivo</Text>
        <Text style={{ fontSize: 14, marginTop: 2 }}>
          SQLite {versioneMotore()} · window functions {supportaWindowFunctions() ? "disponibili" : "NON disponibili"}
        </Text>
        <Text style={{ fontSize: 12, opacity: 0.6, marginTop: 8 }}>Schermo</Text>
        <Text style={{ fontSize: 14 }}>{Math.round(width)} dp · {width >= 600 ? "layout tablet" : "layout telefono"}</Text>
        {derivaSospetta() ? (
          <Text style={{ fontSize: 12, color: "#854F0B", marginTop: 8 }}>
            Deriva oraria rilevata fra i dispositivi: la fusione resta corretta, ma verifica il fuso.
          </Text>
        ) : null}
      </View>
    </ScrollView>
  );
}
