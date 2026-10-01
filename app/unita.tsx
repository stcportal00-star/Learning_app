import { useCallback, useMemo, useRef, useState } from "react";
import { View, Pressable, ScrollView } from "react-native";
import { router, useFocusEffect, useLocalSearchParams, useNavigation } from "expo-router";
import * as Crypto from "expo-crypto";
import { registra } from "../lib/db";
import {
  Unita as UnitaPercorso, Passo, descriviPasso, destinazione, modelloScenario, progetti,
} from "../lib/percorso";
import { leggiSeguiti, leggiSubentrate, segui, smettiDiSeguire } from "../lib/progetti";
import {
  leggiPercorso, leggiScenari, leggiVolumi, volumeDaAprire, ScenarioDiUnita, VolumeDiUnita,
} from "../lib/avanzamento";
import { Text } from "../components/Base";
import { C } from "../lib/tema";

const ETICHETTA_STATO: Record<UnitaPercorso["stato"], string> = {
  completa: "Superata",
  in_corso: "In corso",
  da_iniziare: "Da iniziare",
  senza_verifiche: "Solo lettura",
};

/**
 * Un'unità del percorso: un tema, con i suoi passi nell'ordine in cui si
 * fanno. È la schermata che risponde a «che cosa studio adesso, e perché
 * questo prima di quello».
 *
 * Si rilegge a ogni ritorno in primo piano: si esce per fare un esercizio o
 * un ripasso, e al ritorno l'avanzamento deve essere già quello nuovo, non
 * quello di quando la schermata si era aperta. Lo scenario e il volume da
 * scaricare portano invece alle schede Note e Libreria, e l'unità si chiude
 * (vedi apriScheda): da lì l'indietro va a Oggi, e l'unità si riapre da Studio.
 */
export default function Unita() {
  const { tema } = useLocalSearchParams<{ tema: string }>();
  const slug = String(tema ?? "");
  const [u, setU] = useState<UnitaPercorso | null>(null);
  const [trovata, setTrovata] = useState(true);
  const [volumi, setVolumi] = useState<VolumeDiUnita[]>([]);
  const [scenari, setScenari] = useState<ScenarioDiUnita[]>([]);
  const [seguiti, setSeguiti] = useState<string[]>([]);
  const [tutte, setTutte] = useState<UnitaPercorso[]>([]);
  const [precedenti, setPrecedenti] = useState<Record<string, string>>({});
  // I progetti si ricavano sempre dall'ultimo percorso e dall'ultimo elenco,
  // invece di calcolarli dove si scrive l'uno o l'altro: un calcolo fatto con
  // il percorso di prima dell'esercizio mostrava «Lo stai seguendo» sotto
  // un'unità appena superata.
  const tuttiProgetti = useMemo(() => progetti(tutte, seguiti, precedenti), [tutte, seguiti, precedenti]);
  // Ogni «Segui» o «Smetti» fa avanzare il giro: una lettura del fuoco
  // partita prima non deve rimettere l'elenco di prima sopra quello nuovo.
  const giro = useRef(0);
  const inCreazione = useRef(false);
  const navigation = useNavigation();

  useFocusEffect(useCallback(() => {
    let vivo = true;
    inCreazione.current = false;
    const g = giro.current;
    (async () => {
      const [percorso, v, s, seg, prec] = await Promise.all([
        leggiPercorso(), leggiVolumi(slug), leggiScenari(slug), leggiSeguiti(), leggiSubentrate()]);
      if (!vivo) return;
      const x = percorso.find((t) => t.tema.slug === slug) ?? null;
      setU(x); setTrovata(Boolean(x)); setVolumi(v); setScenari(s);
      setTutte(percorso); setPrecedenti(prec);
      if (giro.current === g) setSeguiti(seg);
    })();
    return () => { vivo = false; };
  }, [slug]));

  /**
   * Seguire non rilegge la schermata: ricalcola i progetti dall'elenco nuovo.
   * La rilettura sta nell'effetto del fuoco, che abbassa anche la guardia di
   * svolgi(); rileggere da lì a ogni «Segui» la abbassava mentre una nota di
   * scenario era ancora in coda dietro una sincronizzazione, e un secondo
   * «Svolgi in Note» ne creava una seconda.
   */
  async function cambiaSeguito(azione: () => Promise<string[]>) {
    giro.current += 1;
    setSeguiti(await azione());
  }

  /**
   * Note e Libreria sono SCHEDE, e questa schermata sta sopra di loro nella
   * pila. `navigate` e `push` da qui aggiungerebbero una seconda barra delle
   * schede con un secondo editor delle note: due copie della stessa nota in
   * memoria, e l'ultima a uscire sovrascrive l'altra. `dismissTo` torna alle
   * schede che esistono già e ci passa il parametro.
   */
  function apriScheda(href: string) {
    router.dismissTo(href as never);
  }

  /**
   * Lo scenario si svolge in Note. La nota nasce qui, con consegna e rubrica,
   * e porta `origine_url = scenario:<id>`: è così che l'unità la ritrova e sa
   * se lo scenario è svolto. Se esiste già, si riapre quella: due note per
   * lo stesso scenario sarebbero due risposte a metà.
   *
   * La guardia resta alzata dopo una creazione riuscita, finché la
   * schermata non se ne va o torna in primo piano: un secondo tocco nel
   * frattempo creerebbe una seconda nota.
   *
   * Mentre la scrittura è in coda (una sincronizzazione può tenerla ferma
   * qualche secondo) si può già essere andati altrove, a un esercizio o
   * indietro: dismissTo toglierebbe quella schermata, o verrebbe ignorato.
   * La nota si apre solo se l'unità è ancora quella davanti; altrimenti lo
   * scenario resta «iniziato» e la nota si riapre da qui.
   */
  async function svolgi(s: ScenarioDiUnita) {
    if (inCreazione.current) return;
    if (s.notaId) { apriScheda(`/note?nota=${encodeURIComponent(s.notaId)}`); return; }
    if (!u) return;
    inCreazione.current = true;
    let creata = false;
    try {
      const id = Crypto.randomUUID();
      const m = modelloScenario(s, u.tema.nome);
      const creato = new Date().toISOString();
      const origine = `scenario:${s.id}`;
      await registra("note", id, "crea",
        { titolo: m.titolo, testo: m.testo, pubblicabile: 0, tema_slug: slug, origine_url: origine, creato_a: creato },
        async (d, hlc) => {
          await d.runAsync(
            `INSERT INTO note (id, tema_slug, titolo, testo, pubblicabile, origine_url, creato_a, hlc)
             VALUES (?,?,?,?,0,?,?,?)`,
            [id, slug, m.titolo, m.testo, origine, creato, hlc]);
        });
      creata = true;
      setScenari((p) => p.map((x) => (x.id === s.id ? { ...x, notaId: id } : x)));
      if (navigation.isFocused()) apriScheda(`/note?nota=${encodeURIComponent(id)}`);
    } finally {
      if (!creata) inCreazione.current = false;
    }
  }

  if (!u) {
    return (
      <View style={{ flex: 1, padding: 16, gap: 12 }}>
        <Pressable onPress={() => router.back()}>
          <Text style={{ fontSize: 13, opacity: 0.6 }}>‹ Indietro</Text>
        </Pressable>
        <Text style={{ fontSize: 14, opacity: 0.7 }}>
          {trovata ? "…" : "Questo tema non ha materiale su questo dispositivo."}
        </Text>
      </View>
    );
  }

  // Il passo da fare adesso, con la stessa regola di prossimoPasso():
  // il primo non fatto che si può fare, e la lettura solo se il volume c'è.
  const corrente = u.stato === "completa" ? null
    : u.passi.find((p) => !p.completo && p.eseguibile && (p.conta || p.tipo === "leggi")) ?? null;

  const Segno = ({ p }: { p: Passo }) => (
    <Text style={{ fontSize: 13, fontWeight: "600",
                   color: p.completo ? C.verde : p === corrente ? C.blu : C.testoTenue }}>
      {p.completo ? "✓ superato" : p === corrente ? "→ adesso" : p.conta ? `${p.fatto}/${p.soglia}` : "facoltativo"}
    </Text>
  );

  // Il progetto che lavora qui, e quello nato da questo tema se ormai lavora
  // altrove (il tema è superato e si è passati al successivo dell'area).
  const progettoQui = tuttiProgetti.find((p) => p.passo && p.unita.tema.slug === slug) ?? null;
  const natoQui = seguiti.includes(slug)
    ? tuttiProgetti.find((p) => p.seguito === slug) ?? null : null;
  // Su un'unità subentrata si dice quale tema scelto la tiene, e «Smetti»
  // toglie quello. Più temi superati della stessa area possono passarsi
  // l'unità: tolto il primo, la prende il secondo, e senza il nome il tocco
  // sembrava non aver fatto niente mentre spariva un altro riquadro.
  const nomeDi = (s: string) => tutte.find((x) => x.tema.slug === s)?.tema.nome ?? s;
  const Seguito = u.stato === "senza_verifiche" ? null : progettoQui ? (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
      <Text style={{ fontSize: 13, color: C.blu, flex: 1, lineHeight: 18 }}>
        {progettoQui.subentrata
          ? `«${nomeDi(progettoQui.seguito)}» è superato: il progetto continua qui.`
          : "Lo stai seguendo: è uno dei tuoi progetti."}
      </Text>
      <Pressable onPress={() => { void cambiaSeguito(() => smettiDiSeguire(progettoQui.seguito)); }}
        style={{ paddingHorizontal: 12, paddingVertical: 7, borderRadius: 9, backgroundColor: C.superficieAlta }}>
        <Text style={{ fontSize: 13, fontWeight: "600" }}>
          {progettoQui.subentrata ? "Smetti di seguirlo" : "Smetti di seguire"}
        </Text>
      </Pressable>
    </View>
  ) : natoQui ? (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
      <Text style={{ fontSize: 13, color: C.verde, flex: 1, lineHeight: 18 }}>
        {natoQui.passo ? `Superato: il progetto continua con «${natoQui.unita.tema.nome}».`
          : natoQui.areaFinita ? "Superato, e con lui tutta l'area."
            : "Superato: il resto dell'area è già negli altri tuoi progetti."}
      </Text>
      <Pressable onPress={() => { void cambiaSeguito(() => smettiDiSeguire(slug)); }}
        style={{ paddingHorizontal: 12, paddingVertical: 7, borderRadius: 9, backgroundColor: C.superficieAlta }}>
        <Text style={{ fontSize: 13, fontWeight: "600" }}>Smetti di seguire</Text>
      </Pressable>
    </View>
  ) : u.stato !== "completa" ? (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
      <Text style={{ fontSize: 13, opacity: 0.65, flex: 1, lineHeight: 18 }}>
        Seguilo per portarlo avanti insieme agli altri, fuori dall'ordine del piano.
      </Text>
      <Pressable onPress={() => { void cambiaSeguito(() => segui(slug)); }}
        style={{ paddingHorizontal: 14, paddingVertical: 8, borderRadius: 9, backgroundColor: C.primario }}>
        <Text style={{ fontSize: 13, fontWeight: "600", color: C.suPrimario }}>Segui</Text>
      </Pressable>
    </View>
  ) : null;

  const vaiA = (p: Passo) => {
    const d = destinazione(slug, p, volumeDaAprire(volumi));
    // Libreria e Notizie sono schede: ci si torna, non si impilano.
    if (d === "/libreria" || d.startsWith("/notizie")) apriScheda(d); else router.push(d as never);
  };

  return (
    <ScrollView contentContainerStyle={{ padding: 16, gap: 12, paddingBottom: 32 }}>
      <Pressable onPress={() => router.back()}>
        <Text style={{ fontSize: 13, opacity: 0.6 }}>‹ Indietro</Text>
      </Pressable>
      <Text style={{ fontSize: 12, opacity: 0.6 }}>
        {u.posizione !== null ? `Unità ${u.posizione} · ` : ""}{u.tema.trimestre ? `${u.tema.trimestre} · ` : ""}{ETICHETTA_STATO[u.stato]}
      </Text>
      <Text style={{ fontSize: 22, fontWeight: "600" }}>{u.tema.nome}</Text>
      {Seguito}
      <View style={{ height: 6, borderRadius: 3, backgroundColor: C.superficieAlta, overflow: "hidden" }}>
        <View style={{ width: `${Math.round(u.avanzamento * 100)}%`, height: 6,
                       backgroundColor: u.stato === "completa" ? C.verde : C.blu }} />
      </View>
      <Text style={{ fontSize: 13, opacity: 0.65, lineHeight: 19 }}>
        Si supera con l'80% degli esercizi e delle schede e uno scenario svolto, dove ci sono.
        Leggere e le notizie non bloccano: si fanno quando il materiale è sul telefono.
      </Text>

      {u.passi.map((p, n) => {
        const d = descriviPasso(p);
        const evidenza = p === corrente;
        const toccabile = p.tipo !== "scenario" && p.tipo !== "leggi";
        const Corpo = (
          <View style={{ borderWidth: 1, borderRadius: 12, padding: 14, gap: 4,
                         borderColor: evidenza ? C.bluBordo : C.bordo,
                         backgroundColor: evidenza ? C.bluFondo : "transparent" }}>
            <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
              <Text style={{ fontSize: 16, fontWeight: "600", flex: 1 }}>{n + 1}. {d.titolo}</Text>
              <Segno p={p} />
            </View>
            <Text style={{ fontSize: 13, opacity: 0.7, lineHeight: 18 }}>{d.dettaglio}</Text>

            {p.tipo === "leggi" ? volumi.map((v) => (
              <Pressable key={v.id}
                onPress={() => v.file_locale
                  ? router.push(`/lettore?id=${encodeURIComponent(v.id)}` as never)
                  : apriScheda("/libreria")}
                style={{ marginTop: 8, padding: 10, borderRadius: 9, backgroundColor: C.superficie }}>
                <Text style={{ fontSize: 14, fontWeight: "500" }} numberOfLines={2}>{v.titolo}</Text>
                <Text style={{ fontSize: 12, marginTop: 2, color: v.file_locale ? C.testoSecondario : C.ambra }}>
                  {v.file_locale
                    ? (v.ultima_pagina > 0 ? `Pagina ${v.ultima_pagina}${v.pagine ? ` di ${v.pagine}` : ""}` : "Sul telefono, mai aperto")
                    : "Non è sul telefono: si scarica da Libreria"}
                  {v.autore ? ` · ${v.autore}` : ""}
                </Text>
              </Pressable>
            )) : null}

            {p.tipo === "scenario" ? scenari.map((s) => (
              <View key={s.id} style={{ marginTop: 8, padding: 11, borderRadius: 9, backgroundColor: C.superficie, gap: 8 }}>
                <Text style={{ fontSize: 14, lineHeight: 20 }}>{s.consegna}</Text>
                <Text style={{ fontSize: 12, opacity: 0.6 }}>
                  Rubrica: {s.rubrica.length} criteri{s.svolto ? " · svolto" : s.notaId ? " · iniziato" : ""}
                </Text>
                <Pressable onPress={() => { void svolgi(s); }}
                  style={{ alignSelf: "flex-start", paddingHorizontal: 13, paddingVertical: 8, borderRadius: 9,
                           backgroundColor: s.notaId ? C.superficieAlta : C.primario }}>
                  <Text style={{ fontSize: 13, fontWeight: "600", color: s.notaId ? C.testo : C.suPrimario }}>
                    {s.notaId ? "Riapri la nota" : "Svolgi in Note"}
                  </Text>
                </Pressable>
              </View>
            )) : null}
          </View>
        );
        return toccabile
          ? <Pressable key={p.tipo} onPress={() => vaiA(p)}>{Corpo}</Pressable>
          : <View key={p.tipo}>{Corpo}</View>;
      })}
    </ScrollView>
  );
}
