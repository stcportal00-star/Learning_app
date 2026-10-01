import { useEffect, useState } from "react";
import {
  View, Pressable, ScrollView, useWindowDimensions,
} from "react-native";
import { Text, TextInput, ActivityIndicator } from "../components/Base";
import { C } from "../lib/tema";
import { database, registra } from "../lib/db";
import { esegui, eseguiConPreparazione, supportaWindowFunctions } from "../lib/palestra";
import { verifica, Esito } from "../lib/verifica";
import * as Crypto from "expo-crypto";
import { useLocalSearchParams } from "expo-router";
import { useTastiera } from "../lib/useTastiera";
import { tettoRiquadro } from "../lib/tetto";

type Esercizio = {
  id: string; tema_slug: string; tipo: string; livello: number; consegna: string;
  soluzione_riferimento: string; preparazione: string | null;
  righe_attese: number | null; ordine_rilevante: number; fonte_citazione: string | null;
};

export default function Esercizi() {
  const { width, height } = useWindowDimensions();
  const affiancato = width >= 600;
  const tastiera = useTastiera();
  // Dal percorso si arriva con il tema dell'unità: la coda è quella del tema,
  // non i 150 esercizi di tutti i trimestri. Da Studio, senza tema, tutto.
  const { tema } = useLocalSearchParams<{ tema?: string }>();

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
         WHERE e.tipo = 'sql_eseguibile' AND e.dataset = 'palestra.db'${filtro}${tema ? " AND e.tema_slug = ?" : ""}
           AND (t.esito IS NULL OR t.esito <> 'corretto')
         ORDER BY e.livello, e.id LIMIT 40`,
        tema ? [String(tema)] : []
      );
      setCoda(righe);
      setIniziato(Date.now());
    })();
  }, [tema]);

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
    // Dopo l'ultimo si va oltre, e la schermata dice che la coda è finita.
    // Fermarsi sull'ultimo ripresentava la stessa scheda, svuotata, a ogni
    // «Avanti», senza una parola.
    setIndice((i) => i + 1);
  }

  if (!corrente) {
    const finita = coda.length > 0;
    return (
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center", padding: 24 }}>
        <Text style={{ fontSize: 16 }}>{finita ? "Coda finita." : "Nessun esercizio in coda."}</Text>
        <Text style={{ opacity: 0.6, marginTop: 6, textAlign: "center" }}>
          {finita
            ? "Quelli non ancora risolti tornano la prossima volta che apri gli esercizi."
            : "Hai risolto tutto quello che era rimasto aperto."}
        </Text>
      </View>
    );
  }

  // Sul telefono la consegna sta in un contenitore con la sola altezza
  // massima: con flex:1 la base è zero e il contenitore si stringeva al
  // padding, 32 dp — si vedeva la riga dell'id e non la domanda. Senza flex
  // prende l'altezza del testo, e oltre il tetto scorre. Affiancata (tablet)
  // riempie la colonna come prima.
  // Il padding sta nel contenitore del contenuto: sulla ScrollView sposta il
  // contenuto in giù ma non allunga lo scorrimento, e gli ultimi 16 dp non si
  // raggiungevano. La chiave fa ripartire ogni esercizio dall'inizio.
  const Consegna = (
    <ScrollView key={corrente.id} style={affiancato ? { flex: 1 } : { flexGrow: 0, flexShrink: 1 }}
      contentContainerStyle={{ padding: 16 }}>
      <Text style={{ fontSize: 12, opacity: 0.6, marginBottom: 4 }}>
        {corrente.id} · livello {corrente.livello} · {corrente.tema_slug}
        {corrente.ordine_rilevante === 1 ? " · l'ordine conta" : ""}
      </Text>
      <Text style={{ fontSize: 16, lineHeight: 23 }}>{corrente.consegna}</Text>
      {corrente.preparazione ? (
        <View style={{ marginTop: 12, padding: 10, backgroundColor: C.superficie, borderRadius: 8 }}>
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
          borderWidth: 1, borderColor: C.bordo, borderRadius: 10, padding: 12, minHeight: 140,
        }}
      />
      <View style={{ flexDirection: "row", gap: 10, marginTop: 12 }}>
        <Pressable
          onPress={controlla}
          disabled={inCorso || !risposta.trim()}
          style={{
            flex: 1, backgroundColor: risposta.trim() ? C.primario : C.disattivo,
            padding: 14, borderRadius: 10, alignItems: "center",
          }}
        >
          {inCorso ? <ActivityIndicator color={risposta.trim() ? C.suPrimario : C.suDisattivo} />
                   : <Text style={{ color: risposta.trim() ? C.suPrimario : C.suDisattivo, fontWeight: "600" }}>Esegui e verifica</Text>}
        </Pressable>
        {esito ? (
          <Pressable onPress={avanti}
            style={{ paddingHorizontal: 20, justifyContent: "center", borderRadius: 10,
                     borderWidth: 1, borderColor: C.bordo }}>
            <Text style={{ fontWeight: "600" }}>Avanti</Text>
          </Pressable>
        ) : null}
      </View>

      {esito ? (
        <View style={{
          marginTop: 14, padding: 12, borderRadius: 10,
          backgroundColor: esito.corretto ? C.verdeFondo : C.rossoFondo,
        }}>
          <Text style={{ fontWeight: "600", color: esito.corretto ? C.verde : C.rosso }}>
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
      <View style={{ flex: 1, borderRightWidth: 1, borderColor: C.bordo }}>{Consegna}</View>
      <View style={{ flex: 1 }}>{Editor}</View>
    </View>
  ) : (
    <View style={{ flex: 1 }}>
      {/* Il tetto segue la finestra (schermo diviso) e si stringe mentre si
          scrive, quanto basta a lasciare all'editor circa otto righe e il
          pulsante: la tastiera copre invece di restringere. */}
      <View style={{ maxHeight: tettoRiquadro(height, tastiera, 220, 0.3, 280) }}>{Consegna}</View>
      {Editor}
    </View>
  );
}
