import { useEffect, useState } from "react";
import {
  View, Text, TextInput, Pressable, ScrollView, useWindowDimensions, ActivityIndicator,
} from "react-native";
import { database, registra } from "../lib/db";
import { esegui, eseguiConPreparazione, supportaWindowFunctions } from "../lib/palestra";
import { verifica, Esito } from "../lib/verifica";
import * as Crypto from "expo-crypto";

type Esercizio = {
  id: string; tema_slug: string; tipo: string; livello: number; consegna: string;
  soluzione_riferimento: string; preparazione: string | null;
  righe_attese: number | null; ordine_rilevante: number; fonte_citazione: string | null;
};

export default function Esercizi() {
  const { width } = useWindowDimensions();
  const affiancato = width >= 600;

  const [coda, setCoda] = useState<Esercizio[]>([]);
  const [indice, setIndice] = useState(0);
  const [risposta, setRisposta] = useState("");
  const [esito, setEsito] = useState<Esito | null>(null);
  const [inCorso, setInCorso] = useState(false);
  const [iniziato, setIniziato] = useState<number>(Date.now());

  useEffect(() => {
    (async () => {
      const d = database();
      const filtro = supportaWindowFunctions() ? "" : " AND tema_slug <> 'sql_window'";
      const righe = await d.getAllAsync<Esercizio>(
        `SELECT e.* FROM esercizi e
         LEFT JOIN (SELECT esercizio_id, max(eseguito_a) AS ultimo, esito
                    FROM tentativi GROUP BY esercizio_id) t ON t.esercizio_id = e.id
         WHERE e.tipo = 'sql_eseguibile' AND e.dataset = 'palestra.db'${filtro}
           AND (t.esito IS NULL OR t.esito <> 'corretto')
         ORDER BY e.livello, e.id LIMIT 40`
      );
      setCoda(righe);
      setIniziato(Date.now());
    })();
  }, []);

  const corrente = coda[indice];

  async function controlla() {
    if (!corrente || !risposta.trim()) return;
    setInCorso(true);
    try {
      const esecutore = corrente.preparazione
        ? (sql: string) => eseguiConPreparazione(corrente.preparazione!, sql)
        : esegui;
      const r = await verifica(esecutore, risposta, corrente.soluzione_riferimento, {
        ordineRilevante: corrente.ordine_rilevante === 1,
      });
      setEsito(r);

      const id = Crypto.randomUUID();
      const durata = Math.round((Date.now() - iniziato) / 1000);
      await registra("tentativi", id, "crea",
        { esercizio_id: corrente.id, esito: r.corretto ? "corretto" : "errato" },
        async (d, hlc) => {
          await d.runAsync(
            `INSERT INTO tentativi (id, esercizio_id, risposta, esito, motivo, durata_sec, eseguito_a, hlc)
             VALUES (?,?,?,?,?,?,?,?)`,
            [id, corrente.id, risposta, r.corretto ? "corretto" : "errato",
             r.motivo, durata, new Date().toISOString(), hlc]
          );
        });
    } finally {
      setInCorso(false);
    }
  }

  function avanti() {
    setRisposta("");
    setEsito(null);
    setIniziato(Date.now());
    setIndice((i) => Math.min(i + 1, coda.length - 1));
  }

  if (!corrente) {
    return (
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center", padding: 24 }}>
        <Text style={{ fontSize: 16 }}>Nessun esercizio in coda.</Text>
        <Text style={{ opacity: 0.6, marginTop: 6, textAlign: "center" }}>
          Hai risolto tutto quello che era rimasto aperto.
        </Text>
      </View>
    );
  }

  const Consegna = (
    <ScrollView style={{ flex: 1, padding: 16 }}>
      <Text style={{ fontSize: 12, opacity: 0.6, marginBottom: 4 }}>
        {corrente.id} · livello {corrente.livello} · {corrente.tema_slug}
        {corrente.ordine_rilevante === 1 ? " · l'ordine conta" : ""}
      </Text>
      <Text style={{ fontSize: 16, lineHeight: 23 }}>{corrente.consegna}</Text>
      {corrente.preparazione ? (
        <View style={{ marginTop: 12, padding: 10, backgroundColor: "#F4F4F5", borderRadius: 8 }}>
          <Text style={{ fontSize: 11, opacity: 0.6, marginBottom: 4 }}>Preparazione già applicata</Text>
          <Text style={{ fontFamily: "monospace", fontSize: 12 }}>{corrente.preparazione}</Text>
        </View>
      ) : null}
      {corrente.righe_attese != null ? (
        <Text style={{ fontSize: 12, opacity: 0.5, marginTop: 10 }}>
          Righe attese: {corrente.righe_attese}
        </Text>
      ) : null}
    </ScrollView>
  );

  const Editor = (
    <View style={{ flex: 1, padding: 16 }}>
      <TextInput
        value={risposta}
        onChangeText={setRisposta}
        multiline
        autoCapitalize="none"
        autoCorrect={false}
        placeholder="SELECT …"
        style={{
          flex: 1, fontFamily: "monospace", fontSize: 14, textAlignVertical: "top",
          borderWidth: 1, borderColor: "#E4E4E7", borderRadius: 10, padding: 12, minHeight: 140,
        }}
      />
      <View style={{ flexDirection: "row", gap: 10, marginTop: 12 }}>
        <Pressable
          onPress={controlla}
          disabled={inCorso || !risposta.trim()}
          style={{
            flex: 1, backgroundColor: risposta.trim() ? "#18181B" : "#D4D4D8",
            padding: 14, borderRadius: 10, alignItems: "center",
          }}
        >
          {inCorso ? <ActivityIndicator color="#fff" />
                   : <Text style={{ color: "#fff", fontWeight: "600" }}>Esegui e verifica</Text>}
        </Pressable>
        {esito ? (
          <Pressable onPress={avanti}
            style={{ paddingHorizontal: 20, justifyContent: "center", borderRadius: 10,
                     borderWidth: 1, borderColor: "#E4E4E7" }}>
            <Text style={{ fontWeight: "600" }}>Avanti</Text>
          </Pressable>
        ) : null}
      </View>

      {esito ? (
        <View style={{
          marginTop: 14, padding: 12, borderRadius: 10,
          backgroundColor: esito.corretto ? "#E8F5EE" : "#FDECEC",
        }}>
          <Text style={{ fontWeight: "600", color: esito.corretto ? "#0F6E56" : "#A12B2B" }}>
            {esito.corretto ? "Corretto" : "Non ancora"}
          </Text>
          <Text style={{ marginTop: 4, fontSize: 13 }}>{esito.dettaglio}</Text>
          {esito.errore ? (
            <Text selectable style={{ marginTop: 6, fontFamily: "monospace", fontSize: 11, opacity: 0.8 }}>
              {esito.errore}
            </Text>
          ) : null}
          {!esito.corretto && esito.motivo !== "errore_sql" ? (
            <Text style={{ marginTop: 8, fontSize: 12, opacity: 0.7 }}>
              Il confronto è sul risultato, non sul testo della query: una soluzione diversa
              dalla mia ma corretta passa comunque.
            </Text>
          ) : null}
        </View>
      ) : null}
    </View>
  );

  return affiancato ? (
    <View style={{ flex: 1, flexDirection: "row" }}>
      <View style={{ flex: 1, borderRightWidth: 1, borderColor: "#E4E4E7" }}>{Consegna}</View>
      <View style={{ flex: 1 }}>{Editor}</View>
    </View>
  ) : (
    <View style={{ flex: 1 }}>
      <View style={{ maxHeight: 220 }}>{Consegna}</View>
      {Editor}
    </View>
  );
}
