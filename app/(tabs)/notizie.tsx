import { useCallback, useEffect, useRef, useState } from "react";
import { View, Pressable, FlatList, ScrollView } from "react-native";
import { router, useFocusEffect, useLocalSearchParams } from "expo-router";
import {
  Categoria, Notizia, Riga, ESPLORAZIONE, areaDelTema, areePerTe, categorie, contaPerCategoria,
  contaPerTema, dataDi, fonteLeggibile, leggiNotizie, messaggioVuoto, nomeTema, quando, righePerGiorno, righeTitoli,
  temiDellArea,
} from "../../lib/notizie";
import { descriviByte } from "../../lib/nuvola/media";
import { leggiPercorso } from "../../lib/avanzamento";
import { leggiSeguiti } from "../../lib/progetti";
import { daFare } from "../../lib/percorso";
import { nomeArea } from "../../lib/contenuti";
import { Text } from "../../components/Base";
import { C } from "../../lib/tema";

const CATEGORIE = categorie();
/**
 * Quante notizie per volta. La tabella non si sfoltisce e ogni corsa porta
 * fino a ottanta articoli: a metà viaggio un'area ne ha centinaia. Con un
 * tetto fisso la lista finiva in silenzio mentre la barra ne contava di più;
 * a pagine, le altre arrivano scorrendo.
 */
const PAGINA = 100;
/** La colonna del giornale: oltre 820 dp le righe diventano troppo lunghe da leggere. */
const COLONNA = { width: "100%", maxWidth: 820, alignSelf: "center" } as const;
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
  // Le righe con la vista per cui si sono lette: vedi `righe` più sotto.
  const [caricato, setCaricato] = useState<{ vista: string; righe: Riga[]; quante: number; pieno: boolean } | null>(null);
  const [conti, setConti] = useState<Conti>([]);
  const [perTe, setPerTe] = useState<string[]>([]);
  const [adesso, setAdesso] = useState(() => new Date());

  // Si arriva con una vista chiesta: dall'unità ?tema= (l'area del tema,
  // filtrata su di lui), da Oggi ?categoria= (il riquadro conta tutti i non
  // letti, e deve aprire una vista che li mostri, non quella in cui si era
  // lasciata la scheda). La scheda resta montata, quindi i parametri si
  // leggono a ogni arrivo e poi si consumano: un ritorno alla scheda non deve
  // rimettere un filtro che si era tolto.
  const { tema: temaChiesto, categoria: categoriaChiesta } =
    useLocalSearchParams<{ tema?: string; categoria?: string }>();
  useEffect(() => {
    if (temaChiesto) {
      const t = String(temaChiesto);
      const area = areaDelTema(t);
      setCategoria(area);
      setTema(area === ESPLORAZIONE ? null : t);
    } else if (categoriaChiesta && CATEGORIE.some((c) => c.chiave === categoriaChiesta)) {
      setCategoria(String(categoriaChiesta));
      setTema(null);
      setSoloDaLeggere(true);
    } else {
      return;
    }
    router.setParams({ tema: undefined, categoria: undefined } as never);
  }, [temaChiesto, categoriaChiesta]);

  // La vista che si guarda: cambia con la categoria, il tema e «Da leggere»,
  // non con un ritorno alla scheda.
  const vista = `${categoria}|${tema ?? ""}|${soloDaLeggere ? "1" : "0"}`;
  // Le pagine valgono per la vista: cambiandola si riparte dalla prima.
  const [pagine, setPagine] = useState({ vista: "", n: 1 });
  const quante = (pagine.vista === vista ? pagine.n : 1) * PAGINA;

  useFocusEffect(useCallback(() => {
    let vivo = true;
    (async () => {
      const ora = new Date();
      const cat = CATEGORIE.find((x) => x.chiave === categoria) ?? CATEGORIE[1];
      // Il percorso serve a «Per te» prima della sua query; le altre viste
      // partono subito, insieme ai conteggi.
      const aree = Promise.all([leggiPercorso(), leggiSeguiti()]).then(([unita, seguiti]) => {
        return areePerTe(daFare(unita, seguiti).map((v) => v.unita.tema.slug));
      });
      // `pieno`: la query ha dato tutte quelle chieste, quindi ce ne possono
      // essere altre.
      const perGiorno = async (f: Parameters<typeof leggiNotizie>[0]) => {
        const n = await leggiNotizie(f);
        return { righe: righePerGiorno(n, ora), pieno: n.length >= f.limite };
      };
      const righeDellaVista = (async (): Promise<{ righe: Riga[]; pieno: boolean }> => {
        if (cat.tipo === "titoli") {
          const sezioni = await Promise.all(
            CATEGORIE.filter((x) => x.tipo === "area" || x.tipo === "esplorazione").map(async (x) => ({
              chiave: x.chiave, nome: x.nome,
              notizie: await leggiNotizie({
                temi: x.tipo === "area" ? x.temi : null, fuoriDalPiano: x.tipo === "esplorazione",
                soloDaLeggere, limite: 4,
              }),
            })));
          return { righe: righeTitoli(sezioni), pieno: false };
        }
        if (cat.tipo === "perte") {
          return perGiorno({ temi: (await aree).flatMap(temiDellArea), soloDaLeggere, limite: quante });
        }
        if (cat.tipo === "area") {
          return perGiorno({ temi: tema && cat.temi.includes(tema) ? [tema] : cat.temi, soloDaLeggere, limite: quante });
        }
        if (cat.tipo === "esplorazione") {
          return perGiorno({ temi: null, fuoriDalPiano: true, soloDaLeggere, limite: quante });
        }
        // I salvati sono quelli da tenere: letti o no, si vedono tutti.
        return perGiorno({ temi: null, soloDaLeggere: false, soloSalvati: true, limite: quante });
      })();
      const [c, a, r] = await Promise.all([contaPerTema(), aree, righeDellaVista]);
      if (!vivo) return;
      setConti(c); setPerTe(a); setAdesso(ora); setCaricato({ vista, righe: r.righe, quante, pieno: r.pieno });
    })();
    return () => { vivo = false; };
  }, [vista, categoria, tema, soloDaLeggere, quante]));

  // Arrivati in fondo, la pagina dopo. Solo se l'ultima lettura è di questa
  // pagina ed era piena: FlatList chiama più volte mentre la lettura è in
  // corso, e ogni chiamata in più sarebbe una pagina in più.
  function altre() {
    if (caricato && caricato.vista === vista && caricato.quante === quante && caricato.pieno) {
      setPagine({ vista, n: quante / PAGINA + 1 });
    }
  }

  // Le righe valgono solo per la vista da cui sono state lette. Cambiando
  // categoria, sotto la linguetta nuova restavano per un momento le righe di
  // quella di prima, e un tema appena scelto le disegnava senza il loro tema;
  // da Salvati vuoto lampeggiava il messaggio di lista vuota. Meglio un
  // istante di niente. Tornando sulla scheda la vista è la stessa, e le righe
  // restano finché arrivano quelle nuove.
  const righe = caricato && caricato.vista === vista ? caricato.righe : null;

  const perCategoria = contaPerCategoria(conti, soloDaLeggere);
  const nuovi = conti.reduce((s, r) => s + r.daLeggere, 0);
  const cat = CATEGORIE.find((x) => x.chiave === categoria) ?? CATEGORIE[1];

  function scegli(chiave: string) {
    setCategoria(chiave);
    setTema(null);
  }

  const lista = useRef<FlatList<Riga>>(null);
  // Una vista nuova si apre dall'inizio. FlatList conserva lo scorrimento
  // quando cambiano i dati: dopo «Tutto ›» a metà di In primo piano l'area
  // si apriva al diciottesimo articolo, con i temi e il primo giorno fuori
  // dallo schermo. Tornando da un articolo la vista è la stessa, e si resta
  // dove si era.
  useEffect(() => { lista.current?.scrollToOffset({ offset: 0, animated: false }); }, [vista]);

  // La barra scorre in orizzontale: la categoria scelta da fuori (un'area
  // aperta dall'unità, «Tutto ›» in primo piano) deve venire in vista. Si
  // porta al centro, e vicino all'inizio la barra resta all'inizio: a filo
  // del bordo, all'apertura su In primo piano «Per te» restava tagliata a
  // sinistra, e se ne vedeva solo il numero.
  const barra = useRef<ScrollView>(null);
  const larghezzaBarra = useRef(0);
  const posizioni = useRef(new Map<string, { x: number; w: number }>());
  const inVista = (chiave: string, animated: boolean) => {
    const p = posizioni.current.get(chiave);
    if (!p || !larghezzaBarra.current) return;
    barra.current?.scrollTo({ x: Math.max(0, p.x + p.w / 2 - larghezzaBarra.current / 2), animated });
  };
  useEffect(() => { inVista(categoria, true); }, [categoria]);

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
    // Il tema si dice quando la lista ne mescola più d'uno. L'esplorazione
    // no: sta solo nella sua categoria, che lo dice già, e su un telefono la
    // riga è una sola.
    if (!tema && n.tema_slug !== ESPLORAZIONE) parti.push(nomeTema(n.tema_slug) ?? "");
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

  // Gli articoli della categoria, letti o no: decide se «Tutti» può aiutare.
  const inTutto = contaPerCategoria(conti, false);
  const inCategoria =
    cat.tipo === "area" && tema ? (conti.find((r) => r.tema_slug === tema)?.tutti ?? 0)
      : cat.tipo === "area" || cat.tipo === "esplorazione" ? (inTutto.get(cat.chiave) ?? 0)
        : cat.tipo === "perte" ? perTe.reduce((s, a) => s + (inTutto.get(a) ?? 0), 0)
          : conti.reduce((s, r) => s + r.tutti, 0);
  const vuota = messaggioVuoto({
    tipo: cat.tipo, nessunArticolo: conti.length === 0, areePerTe: perTe.length, inCategoria, soloDaLeggere,
  });

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
      {/* Intestazione e barra nella stessa colonna della lista: su un tablet
          largo la lista sta al centro a 820 dp, e il titolo e «Da leggere»
          a filo dei bordi non si allineavano con quello che comandano. */}
      <View style={COLONNA}>
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
          onLayout={(e) => { larghezzaBarra.current = e.nativeEvent.layout.width; inVista(categoria, false); }}
          style={{ flexGrow: 0, borderBottomWidth: 1, borderColor: C.bordo, marginTop: 8 }}
          contentContainerStyle={{ paddingHorizontal: 10 }}>
          {CATEGORIE.map((c) => {
            const attiva = c.chiave === categoria;
            const n = numeroDi(c);
            return (
              <Pressable key={c.chiave} onPress={() => scegli(c.chiave)}
                onLayout={(e) => {
                  const { x, width } = e.nativeEvent.layout;
                  posizioni.current.set(c.chiave, { x, w: width });
                  // Al primo arrivo dall'unità la categoria si sceglie prima
                  // che la barra sia misurata, e l'effetto qui sopra non trova
                  // dove scorrere; e i numeri, quando arrivano, allargano le
                  // linguette prima di questa. Si riprova quando la misura c'è.
                  if (attiva) inVista(c.chiave, false);
                }}
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
      </View>

      <FlatList
        ref={lista}
        data={righe ?? []}
        keyExtractor={(r) => r.chiave}
        renderItem={disegna}
        ListHeaderComponent={Intestazione}
        ListEmptyComponent={righe ? (
          <Text style={{ opacity: 0.6, paddingVertical: 16, lineHeight: 20 }}>{vuota}</Text>
        ) : null}
        onEndReached={altre}
        onEndReachedThreshold={0.6}
        ListFooterComponent={righe && caricato?.pieno ? (
          <Text style={{ fontSize: 12, color: C.testoTenue, paddingVertical: 14 }}>Arrivano i più vecchi…</Text>
        ) : null}
        contentContainerStyle={[COLONNA, { padding: 16, paddingBottom: 32 }]}
      />
    </View>
  );
}
