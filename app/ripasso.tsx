import { useEffect, useState } from "react";
import { View, Text, Pressable, ScrollView } from "react-native";
import { database, registra } from "../lib/db";

type Scheda = { id: string; consegna: string; soluzione_riferimento: string; fonte_citazione: string | null };

/** FSRS semplificato: quattro gradi, intervalli crescenti, ricaduta azzerante. */
function prossimo(grado: number, stabilita: number): { stabilita: number; giorni: number } {
  if (grado === 0) return { stabilita: 0, giorni: 0 };
  const fattore = [0, 1.2, 2.2, 3.4][grado];
  const nuova = Math.max(1, (stabilita || 1) * fattore);
  return { stabilita: nuova, giorni: Math.round(nuova) };
}

export default function Ripasso() {
  const [coda, setCoda] = useState<Scheda[]>([]);
  const [i, setI] = useState(0);
  const [scoperta, setScoperta] = useState(false);

  useEffect(() => {
    (async () => {
      const d = database();
      setCoda(await d.getAllAsync<Scheda>(
        `SELECT e.id, e.consegna, e.soluzione_riferimento, e.fonte_citazione
         FROM ripasso r JOIN esercizi e ON e.id = r.esercizio_id
         WHERE r.prossima_revisione <= ? ORDER BY r.prossima_revisione LIMIT 30`,
        [new Date().toISOString()]));
    })();
  }, []);

  const s = coda[i];
  if (!s) return (
    <View style={{ flex: 1, alignItems: "center", justifyContent: "center", padding: 24 }}>
      <Text style={{ fontSize: 16 }}>Nessuna scheda da ripassare.</Text>
    </View>
  );

  async function valuta(grado: number) {
    const d = database();
    const r = await d.getFirstAsync<{ stabilita: number }>(
      "SELECT stabilita FROM ripasso WHERE esercizio_id = ?", [s.id]);
    const { stabilita, giorni } = prossimo(grado, r?.stabilita ?? 0);
    const quando = new Date(Date.now() + giorni * 864e5).toISOString();
    await registra("ripasso", s.id, "aggiorna", { grado, stabilita }, async (dd, hlc) => {
      await dd.runAsync(
        `UPDATE ripasso SET stabilita = ?, ripetizioni = ripetizioni + 1,
         ultima_revisione = ?, prossima_revisione = ?, stato = ? WHERE esercizio_id = ?`,
        [stabilita, new Date().toISOString(), quando, grado === 0 ? "ricaduta" : "ripasso", s.id]);
    });
    setScoperta(false);
    setI((n) => n + 1);
  }

  const gradi = ["Di nuovo", "Difficile", "Bene", "Facile"];
  return (
    <View style={{ flex: 1, padding: 16 }}>
      <Text style={{ fontSize: 12, opacity: 0.55 }}>{i + 1} di {coda.length}</Text>
      <ScrollView style={{ flex: 1, marginTop: 12 }}>
        <Text style={{ fontSize: 18, lineHeight: 26 }}>{s.consegna}</Text>
        {scoperta ? (
          <View style={{ marginTop: 18, paddingTop: 16, borderTopWidth: 1, borderColor: "#E4E4E7" }}>
            <Text style={{ fontSize: 15, lineHeight: 23 }}>{s.soluzione_riferimento}</Text>
            {s.fonte_citazione ? (
              <Text style={{ fontSize: 12, opacity: 0.6, marginTop: 12 }}>{s.fonte_citazione}</Text>
            ) : null}
          </View>
        ) : null}
      </ScrollView>
      {scoperta ? (
        <View style={{ flexDirection: "row", gap: 7 }}>
          {gradi.map((g, n) => (
            <Pressable key={g} onPress={() => valuta(n)}
              style={{ flex: 1, padding: 12, borderRadius: 9, alignItems: "center",
                       backgroundColor: n === 0 ? "#FDECEC" : "#F4F4F5" }}>
              <Text style={{ fontSize: 12, fontWeight: "600" }}>{g}</Text>
            </Pressable>
          ))}
        </View>
      ) : (
        <Pressable onPress={() => setScoperta(true)}
          style={{ backgroundColor: "#18181B", padding: 15, borderRadius: 10, alignItems: "center" }}>
          <Text style={{ color: "#fff", fontWeight: "600" }}>Mostra la risposta</Text>
        </Pressable>
      )}
    </View>
  );
}
