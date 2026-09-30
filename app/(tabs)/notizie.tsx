import { useCallback, useEffect, useRef, useState } from "react";
import { View, Pressable, FlatList, ScrollView } from "react-native";
import { router, useFocusEffect, useLocalSearchParams } from "expo-router";
import {
  Categoria, Notizia, Riga, ESPLORAZIONE, areaDelTema, areePerTe, categorie, contaPerCategoria,
  contaPerTema, dataDi, fonteLeggibile, leggiNotizie, nomeTema, quando, righePerGiorno, righeTitoli,
  temiDellArea,
} from "../../lib/notizie";
import { descriviByte } from "../../lib/nuvola/media";
import { leggiPercorso } from "../../lib/avanzamento";
import { leggiSeguiti } from "../../lib/progetti";
import { progetti, prossimoPasso } from "../../lib/percorso";
import { nomeArea } from "../../lib/contenuti";
import { Text } from "../../components/Base";
import { C } from "../../lib/tema";

const CATEGORIE = categorie();
const GIORNI = ["domenica", "lunedì", "martedì", "mercoledì", "giovedì", "venerdì", "sabato"];
const MESI = ["gennaio", "febbraio", "marzo", "aprile", "maggio", "giugno", "luglio", "agosto",
  "settembre", "ottobre", "novembre", "dicembre"];

type Conti = Array<{ tema_slug: string | null; daLeggere: number; tutti: number }>;

/**
 * Le notizie: quello che la conduttura ha raccolto, per categoria, come un
 * giornale. «In primo piano» ha una sezione per area con la notizia
 * principale; «Per te» le aree dei progetti; ogni area ha i suoi temi; in
 * fondo l'esplorazione e i salvati.
 *
 * La barra delle categorie sta ferma sopra la lista: è il modo di passare da
 * un'area all'altra, e se scorresse via con gli articoli andrebbe ripescata
 * in cima ogni volta.
 *
 * Si rilegge a ogni ritorno sulla scheda: aprire un articolo lo segna letto,
 * e al ritorno la lista deve già saperlo.
 */
export default function Notizie() {
  const [categoria, setCategoria] = useState<string>("titoli");
  const [tema, setTema] = useState<string | null>(null);
  const [soloDaLeggere, setSoloDaLeggere] = useState(true);
  const [righe, setRighe] = useState<Riga[] | null>(null);
  const [conti, setConti] = useState<Conti>([]);
  const [perTe, setPerTe] = useState<string[]>([]);
  const [adesso, setAdesso] = useState(() => new Date());

  // Dall'unità si arriva con ?tema=: si apre l'area del tema, filtrata su di
  // lui. La scheda può essere già montata, quindi il parametro si legge a
  // ogni arrivo e poi si consuma: un ritorno alla scheda non deve rimettere
  // un filtro che si era tolto.
  const { tema: temaChiesto } = useLocalSearchParams<{ tema?: string }>();
  useEffect(() => {
    if (!temaChiesto) return;
    const t = String(temaChiesto);
    const area = areaDelTema(t);
    setCategoria(area);
    setTema(area === ESPLORAZIONE ? null : t);
    router.setParams({ tema: undefined } as never);
  }, [temaChiesto]);

  useFocusEffect(useCallback(() => {
    let vivo = true;
    (async () => {
      const ora = new Date();
      const [c, unita, seguiti] = await Promise.all([contaPerTema(), leggiPercorso(), leggiSeguiti()]);
      const attivi = progetti(unita, seguiti).filter((p) => p.passo).map((p) => p.unita.tema.slug);
      const piano = prossimoPasso(unita)?.unita.tema.slug;
      const aree = areePerTe(attivi.length ? attivi : piano ? [piano] : []);
      const cat = CATEGORIE.find((x) => x.chiave === categoria) ?? CATEGORIE[1];
      let r: Riga[];
      if (cat.tipo === "titoli") {
        const sezioni = await Promise.all(
          CATEGORIE.filter((x) => x.tipo === "area" || x.tipo === "esplorazione").map(async (x) => ({
            chiave: x.chiave, nome: x.nome,
            notizie: await leggiNotizie({
              temi: x.tipo === "area" ? x.temi : null, fuoriDalPiano: x.tipo === "esplorazione",
              soloDaLeggere, limite: 4,
            }),
          })));
        r = righeTitoli(sezioni);
      } else if (cat.tipo === "perte") {
        r = righePerGiorno(await leggiNotizie({
          temi: aree.flatMap(temiDellArea), soloDaLeggere, limite: 150 }), ora);
      } else if (cat.tipo === "area") {
        r = righePerGiorno(await leggiNotizie({
          temi: tema && cat.temi.includes(tema) ? [tema] : cat.temi, soloDaLeggere, limite: 200 }), ora);
      } else if (cat.tipo === "esplorazione") {
        r = righePerGiorno(await leggiNotizie({ temi: null, fuoriDalPiano: true, soloDaLeggere, limite: 200 }), ora);
      } else {
        // I salvati sono quelli da tenere: letti o no, si vedono tutti.
        r = righePerGiorno(await leggiNotizie({ temi: null, soloDaLeggere: false, soloSalvati: true, limite: 300 }), ora);
      }
      if (!vivo) return;
      setConti(c); setPerTe(aree); setAdesso(ora); setRighe(r);
    })();
    return () => { vivo = false; };
  }, [categoria, tema, soloDaLeggere]));

  const perCategoria = contaPerCategoria(conti, soloDaLeggere);
  const totale = conti.reduce((s, r) => s + (soloDaLeggere ? r.daLeggere : r.tutti), 0);
  const nuovi = conti.reduce((s, r) => s + r.daLeggere, 0);
  const cat = CATEGORIE.find((x) => x.chiave === categoria) ?? CATEGORIE[1];

  function scegli(chiave: string) {
    setCategoria(chiave);
    setTema(null);
  }

  // La barra scorre in orizzontale: la categoria scelta da fuori (un'area
  // aperta dall'unità, «Tutto su…» in primo piano) deve venire in vista.
  const barra = useRef<ScrollView>(null);
  const posizioni = useRef(new Map<string, number>());
  useEffect(() => {
    const x = posizioni.current.get(categoria);
    if (x !== undefined) barra.current?.scrollTo({ x: Math.max(0, x - 16), animated: true });
  }, [categoria]);

  const numeroDi = (c: Categoria): number | null => {
    if (c.tipo === "area" || c.tipo === "esplorazione") return perCategoria.get(c.chiave) ?? 0;
    if (c.tipo === "perte") return perTe.reduce((s, a) => s + (perCategoria.get(a) ?? 0), 0);
    return null;
  };

  const Pillola = ({ testo, attiva, premuto }: { testo: string; attiva: boolean; premuto: () => void }) => (
    <Pressable onPress={premuto}
      style={{ paddingHorizontal: 11, paddingVertical: 6, borderRadius: 20,
               backgroundColor: attiva ? C.primario : C.superficie }}>
      <Text style={{ fontSize: 12, color: attiva ? C.suPrimario : C.testoSecondario }}>{testo}</Text>
    </Pressable>
  );

  const Etichetta = ({ testo, colore, fondo }: { testo: string; colore: string; fondo?: string }) => (
    <Text style={{ fontSize: 10, fontWeight: "600", color: colore, backgroundColor: fondo,
                   paddingHorizontal: fondo ? 7 : 0, paddingVertical: 2, borderRadius: 5 }}>{testo}</Text>
  );

  const Meta = ({ n }: { n: Notizia }) => {
    const parti = [fonteLeggibile(n.fonte), quando(dataDi(n), adesso)];
    // Il tema si dice quando la lista ne mescola più d'uno.
    if (!tema) parti.push(nomeTema(n.tema_slug) ?? "");
    return (
      <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 6 }}>
        <Text style={{ fontSize: 11, color: C.testoTenue, flexShrink: 1 }} numberOfLines={1}>
          {parti.filter(Boolean).join(" · ")}
        </Text>
        {n.url_media ? (
          // Un podcast o una conferenza non hanno testo: l'etichetta dice che
          // cos'è la voce e quanto pesa portarsela in aereo.
          <Etichetta colore={C.viola} fondo={C.violaFondo}
            testo={((n.tipo_media || "").startsWith("video/") ? "video" : "audio")
              + (n.file_media ? " · sul telefono" : " · " + descriviByte(n.byte_media))} />
        ) : !n.ha_testo ? (
          <Etichetta colore={C.testoTenue} testo="solo sommario" />
        ) : null}
        {n.salvato ? <Etichetta colore={C.blu} fondo={C.bluFondo} testo="salvato" /> : null}
      </View>
    );
  };

  const apri = (n: Notizia) => router.push({ pathname: "/articolo", params: { id: n.id } });

  const disegna = ({ item }: { item: Riga }) => {
    if (item.tipo === "sezione") {
      return item.categoria ? (
        <Pressable onPress={() => scegli(item.categoria!)}
          style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center",
                   marginTop: 18, marginBottom: 8 }}>
          <Text style={{ fontSize: 18, fontWeight: "600" }}>{item.titolo}</Text>
          <Text style={{ fontSize: 13, color: C.blu }}>Tutto ›</Text>
        </Pressable>
      ) : (
        <Text style={{ fontSize: 12, fontWeight: "600", color: C.testoSecondario, marginTop: 16, marginBottom: 6 }}>
          {item.titolo}
        </Text>
      );
    }
    if (item.tipo === "vuoto") {
      return <Text style={{ opacity: 0.6, paddingVertical: 16, lineHeight: 20 }}>{item.testo}</Text>;
    }
    const n = item.notizia;
    if (item.tipo === "principale") {
      return (
        <Pressable onPress={() => apri(n)}
          style={{ backgroundColor: C.superficie, borderRadius: 12, padding: 14, gap: 6, marginBottom: 2,
                   opacity: n.letto ? 0.55 : 1 }}>
          <Meta n={n} />
          <Text style={{ fontSize: 18, fontWeight: "600", lineHeight: 24 }} numberOfLines={4}>{n.titolo}</Text>
          {n.abstract ? (
            <Text style={{ fontSize: 13, color: C.testoSecondario, lineHeight: 19 }} numberOfLines={3}>
              {n.abstract}
            </Text>
          ) : null}
        </Pressable>
      );
    }
    return (
      <Pressable onPress={() => apri(n)}
        style={{ paddingVertical: 12, paddingHorizontal: 2, gap: 4, borderBottomWidth: 1, borderColor: C.bordo,
                 opacity: n.letto ? 0.55 : 1 }}>
        <Meta n={n} />
        <Text style={{ fontSize: 15, fontWeight: "500", lineHeight: 21 }} numberOfLines={3}>{n.titolo}</Text>
      </Pressable>
    );
  };

  const vuota =
    conti.length === 0
      ? "Niente ancora. La rassegna gira ogni mattina alle otto e deposita quello che trova; l'app lo ritira da sola appena c'è rete."
      : cat.tipo === "salvati"
        ? "Nessun articolo salvato. Nell'articolo, «Salva» lo tiene qui."
        : cat.tipo === "perte" && !perTe.length
          ? "Qui arrivano le notizie delle aree che studi: segui un tema da Studio."
          : soloDaLeggere && totale === 0
            ? "Tutto letto. «Tutti» mostra anche gli articoli già letti."
            : soloDaLeggere
              ? "Niente da leggere qui. «Tutti» mostra anche gli articoli già letti."
              : "Nessun articolo in questa categoria.";

  const Intestazione = (
    <View style={{ gap: 10 }}>
      {cat.tipo === "perte" && perTe.length ? (
        <Text style={{ fontSize: 12, color: C.testoSecondario, lineHeight: 18 }}>
          Dalle aree che studi: {perTe.map((a) => nomeArea(a) ?? a).join(", ")}.
        </Text>
      ) : null}
      {cat.tipo === "area" ? (
        // I temi dell'area che hanno qualcosa, e sempre quello scelto: un
        // filtro acceso che non si vede fa sembrare vuota un'area che non lo è.
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
          <Pillola testo="Tutti i temi" attiva={tema === null} premuto={() => setTema(null)} />
          {cat.temi
            .map((t) => ({ t, n: conti.find((r) => r.tema_slug === t)?.[soloDaLeggere ? "daLeggere" : "tutti"] ?? 0 }))
            .filter((x) => x.n > 0 || x.t === tema)
            .map((x) => (
              <Pillola key={x.t} testo={`${nomeTema(x.t) ?? x.t} ${x.n}`} attiva={tema === x.t}
                premuto={() => setTema((v) => (v === x.t ? null : x.t))} />
            ))}
        </View>
      ) : null}
    </View>
  );

  return (
    <View style={{ flex: 1 }}>
      <View style={{ paddingHorizontal: 16, paddingTop: 14, gap: 2 }}>
        <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
          <Text style={{ fontSize: 22, fontWeight: "600" }}>Notizie</Text>
          <Pillola testo={soloDaLeggere ? "Da leggere" : "Tutti"} attiva={soloDaLeggere}
            premuto={() => setSoloDaLeggere((v) => !v)} />
        </View>
        <Text style={{ fontSize: 12, color: C.testoTenue }}>
          {GIORNI[adesso.getDay()]} {adesso.getDate()} {MESI[adesso.getMonth()]}
          {nuovi ? ` · ${nuovi} da leggere` : ""} · il testo è già sul telefono
        </Text>
      </View>

      <ScrollView ref={barra} horizontal showsHorizontalScrollIndicator={false}
        style={{ flexGrow: 0, borderBottomWidth: 1, borderColor: C.bordo, marginTop: 8 }}
        contentContainerStyle={{ paddingHorizontal: 10 }}>
        {CATEGORIE.map((c) => {
          const attiva = c.chiave === categoria;
          const n = numeroDi(c);
          return (
            <Pressable key={c.chiave} onPress={() => scegli(c.chiave)}
              onLayout={(e) => posizioni.current.set(c.chiave, e.nativeEvent.layout.x)}
              style={{ paddingHorizontal: 10, paddingTop: 10, paddingBottom: 8,
                       borderBottomWidth: 2, borderColor: attiva ? C.blu : "transparent" }}>
              <Text style={{ fontSize: 14, fontWeight: attiva ? "600" : "400",
                             color: attiva ? C.testo : C.testoSecondario }}>
                {c.nome}{n ? <Text style={{ fontSize: 11, color: C.testoTenue }}> {n}</Text> : null}
              </Text>
            </Pressable>
          );
        })}
      </ScrollView>

      <FlatList
        data={righe ?? []}
        keyExtractor={(r) => r.chiave}
        renderItem={disegna}
        ListHeaderComponent={Intestazione}
        ListEmptyComponent={righe ? (
          <Text style={{ opacity: 0.6, paddingVertical: 16, lineHeight: 20 }}>{vuota}</Text>
        ) : null}
        contentContainerStyle={{ padding: 16, paddingBottom: 32, width: "100%", maxWidth: 820, alignSelf: "center" }}
      />
    </View>
  );
}
