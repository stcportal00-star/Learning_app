#!/usr/bin/env python3
"""Verifica della rassegna. Nessuna rete: solo la logica pura.

    python3 verifica_rassegna.py

Si controlla ciò che resta vero a prescindere dagli archivi interrogati: la
tassonomia allineata alla biblioteca, la classificazione, la deduplicazione,
i filtri, la forma del manifesto. Le fonti cambiano risposta ogni giorno e non
si possono verificare qui senza rendere il risultato dipendente dalla rete —
per quelle c'è `catalogo.py --prova`, che gira su dati finti, e il rapporto
quotidiano, che elenca quali hanno risposto.
"""
import json
import re
import os
import sys
import tempfile

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import catalogo
import fonti_aperte as fonti
from specializzazioni import (SOGLIA, SPECIALIZZAZIONI, classifica, e_pubblicazione,
                              e_rumore, normalizza, punteggi, temi_solo_deboli,
                              termini_di_ricerca, trimestre_di)

RADICE = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

ok, ko = 0, []


def verifica(nome, condizione):
    global ok
    if condizione:
        ok += 1
    else:
        ko.append(nome)


# ---------------------------------------------------------------- tassonomia
biblioteca = json.load(open(os.path.join(RADICE, "assets", "contenuti", "biblioteca.json"),
                            encoding="utf-8"))
temi_biblioteca = {v["tema_slug"] for v in biblioteca}

verifica("ogni tema della biblioteca esiste nella tassonomia",
         temi_biblioteca <= set(SPECIALIZZAZIONI))
verifica("nessun tema inventato fuori dalla biblioteca",
         set(SPECIALIZZAZIONI) <= temi_biblioteca)

trimestri_biblioteca = {}
for v in biblioteca:
    trimestri_biblioteca.setdefault(v["tema_slug"], {}).setdefault(v["trimestre"], 0)
    trimestri_biblioteca[v["tema_slug"]][v["trimestre"]] += 1
for tema, conteggi in trimestri_biblioteca.items():
    dominante = max(sorted(conteggi), key=lambda t: conteggi[t])
    verifica(f"trimestre di {tema} coerente con la biblioteca ({dominante})",
             trimestre_di(tema) == dominante)

for tema, (nome, trim, forti, deboli, concetti) in SPECIALIZZAZIONI.items():
    verifica(f"{tema}: ha un nome leggibile", bool(nome) and nome != tema)
    verifica(f"{tema}: trimestre nel formato T1..T6", trim in {f"T{i}" for i in range(1, 7)})
    verifica(f"{tema}: almeno sei termini forti", len(forti) >= 6)
    verifica(f"{tema}: termini forti senza duplicati", len(set(forti)) == len(forti))
    verifica(f"{tema}: termini di ricerca non vuoti", len(termini_di_ricerca(tema)) > 0)

# ---------------------------------------------------------------- normalizzazione
verifica("normalizza toglie gli accenti", normalizza("Epidemiologìa") == "epidemiologia")
verifica("normalizza collassa gli spazi", normalizza("  a   b  ") == "a b")
verifica("normalizza regge il None", normalizza(None) == "")

# ---------------------------------------------------------------- classificazione
temi = classifica("Causal inference for outbreak detection",
                  "A cohort study on disease surveillance and incidence rate.",
                  ["Epidemiology", "Causal inference"])
assegnati = [t for t, _ in temi]
verifica("articolo epidemiologico classificato", "epidemiologia" in assegnati)
verifica("il tema più forte è il primo", temi == sorted(temi, key=lambda x: (-x[1], x[0])))

temi_sql = classifica("Query optimization with cardinality estimation",
                      "Execution plan selection in a columnar storage engine.")
verifica("articolo su SQL classificato", {"ottimizzazione", "sql_base"} & {t for t, _ in temi_sql})

verifica("titolo senza tema non viene classificato",
         classifica("Una riflessione generale del tutto priva di argomento") == [])
verifica("al più due temi per voce",
         len(classifica("causal inference sql gdpr ai act epidemiology dashboard")) <= 2)

verifica("confine di parola rispettato: 'ia' non compare dentro 'social'",
         "ia" not in punteggi("social media research"))

vuoti = punteggi("", "")
verifica("titolo vuoto non produce punteggi", vuoti == {})

# determinismo: due chiamate identiche danno lo stesso esito
verifica("classificazione deterministica",
         classifica("Query optimization with cardinality estimation") ==
         classifica("Query optimization with cardinality estimation"))

# ---------------------------------------------------------------- filtri
verifica("ritrattazione scartata", not e_pubblicazione("Retracted: a former paper"))
verifica("erratum scartato", not e_pubblicazione("Erratum to: something"))
verifica("articolo normale conservato", e_pubblicazione("A study of cholera in Yemen"))

esclusioni = json.load(open(os.path.join(RADICE, "assets", "contenuti",
                                         "esclusioni_rassegna.json"), encoding="utf-8"))
verifica("il rumore redazionale è riconosciuto", e_rumore("Top 10 best tools", esclusioni))
verifica("un titolo scientifico non è rumore",
         not e_rumore("Bayesian inference for time series", esclusioni))

# Il confronto è a confine di parola, e questi due titoli sono il motivo. Con il
# confronto per sottostringa «valuation» catturava «evaluations»: sparivano
# proprio gli articoli sulla valutazione dei modelli, cioè il contenuto migliore
# del tema `ia`. E spariva in silenzio, perché una voce scartata come rumore non
# lascia traccia da nessuna parte.
verifica("«evaluations» non è «valuation»",
         not e_rumore("Cheating behaviour in frontier model evaluations", esclusioni))
verifica("ma «valuation» resta rumore",
         e_rumore("Acme raises Series B at $1B valuation", esclusioni))
verifica("e «Top 100» non è «top 10»",
         not e_rumore("Top 100 questions about causal inference", esclusioni))

# Due termini deboli nel titolo arrivano a 1,2 e la voce entra in libreria — è il
# contratto della rassegna — ma non dicono niente sulla FONTE che li pubblica.
# `verifica_fonti.py` conta come utili solo le voci con almeno un termine forte,
# e la distinzione deve stare qui, non in una seconda copia del classificatore.
verifica("un titolo di soli termini deboli supera la soglia",
         punteggi("How we changed our workflow and requirements")
         .get("business_analysis", 0) >= SOGLIA)
verifica("ma risulta fatto di soli termini deboli",
         "business_analysis" in
         temi_solo_deboli("How we changed our workflow and requirements"))
verifica("mentre un termine forte nel titolo non è «solo debole»",
         "epidemiologia" not in
         temi_solo_deboli("Cholera outbreak detection in Yemen"))

# ------------------------------------------------- le altre tre lingue
# Il lessico è stato esteso a italiano, spagnolo e francese perché senza una
# fonte che pubblica in quelle lingue non entra MAI: prendeva zero temi e il
# verificatore la scartava. Queste fixture misurano le due direzioni, e sono
# state scritte PRIMA di conoscere i termini proposti — scriverle dopo, a
# partire dai termini, avrebbe provato solo se stesse.
#
# Prima dell'estensione: 4 attese su 15 e 8 rumori su 8.
#
# Si usa `classifica` e non `punteggi`, perché è la funzione che la conduttura
# chiama davvero ed è l'unica che applica la soglia: misurare senza soglia
# farebbe passare per successo un tema a 0,40, che non verrebbe assegnato.
ATTESI_ALTRE_LINGUE = [
    (
        'it',
        'qualita_dati',
        'Come si controlla che i dati raccolti sul campo siano buoni',
        "Parliamo di validazione dei dati e di che cosa fare quando un valore manca. La riproducibilita di un'analisi dipende da queste verifiche piu che dal modello scelto.",
    ),
    (
        'es',
        'qualita_dati',
        'Calidad de los datos en las organizaciones humanitarias',
        'Hablamos de la validacion de datos, de los datos faltantes y de como hacer reproducible un analisis recogido sobre el terreno.',
    ),
    (
        'fr',
        'qualita_dati',
        'La qualite des donnees dans les enquetes de terrain',
        "Nous parlons de la validation des donnees, des donnees manquantes et de la reproductibilite d'une analyse.",
    ),
    (
        'it',
        'gdpr',
        'Il trattamento dei dati personali nelle organizzazioni non profit',
        "La base giuridica del trattamento, la minimizzazione dei dati e i diritti dell'interessato secondo il regolamento generale sulla protezione dei dati.",
    ),
    (
        'es',
        'gdpr',
        'Proteccion de datos personales en las ONG',
        'La base juridica del tratamiento, la minimizacion de datos y los derechos del interesado segun el reglamento general de proteccion de datos.',
    ),
    (
        'fr',
        'gdpr',
        'La protection des donnees personnelles dans les ONG',
        'La base legale du traitement, la minimisation des donnees et les droits de la personne concernee selon le reglement general sur la protection des donnees.',
    ),
    (
        'it',
        'epidemiologia',
        "Sorveglianza delle malattie infettive dopo un'alluvione",
        'Come si costruisce un sistema di sorveglianza epidemiologica, come si legge il tasso di incidenza e come si riconosce un focolaio.',
    ),
    (
        'es',
        'epidemiologia',
        'Vigilancia epidemiologica despues de una inundacion',
        'Como se construye un sistema de vigilancia, como se lee la tasa de incidencia y como se detecta un brote.',
    ),
    (
        'fr',
        'epidemiologia',
        'Surveillance epidemiologique apres une inondation',
        "Comment construire un systeme de surveillance, lire le taux d'incidence et detecter une flambee epidemique.",
    ),
    (
        'it',
        'sicurezza',
        'Che cosa fare nelle prime ore di un attacco informatico',
        'La risposta agli incidenti, la gestione delle vulnerabilita e il modello di minaccia di una piccola organizzazione.',
    ),
    (
        'es',
        'sicurezza',
        'Que hacer en las primeras horas de un ciberataque',
        'La respuesta a incidentes, la gestion de vulnerabilidades y el modelado de amenazas de una organizacion pequena.',
    ),
    (
        'fr',
        'sicurezza',
        "Que faire dans les premieres heures d'une cyberattaque",
        'La reponse aux incidents, la gestion des vulnerabilites et la modelisation des menaces.',
    ),
    (
        'it',
        'sql_base',
        'Imparare a interrogare una base di dati relazionale',
        'Il piano di esecuzione di una interrogazione, le tabelle collegate e il motore relazionale che le tiene insieme.',
    ),
    (
        'es',
        'sql_base',
        'Aprender a consultar una base de datos relacional',
        'El plan de ejecucion de una consulta, las tablas relacionadas y el motor relacional que las mantiene.',
    ),
    (
        'fr',
        'sql_base',
        'Apprendre a interroger une base de donnees relationnelle',
        "Le plan d'execution d'une requete, les tables liees et le moteur relationnel.",
    ),
]

RUMORE_ALTRE_LINGUE = [
    (
        'it',
        'Il derby di domenica finisce in parita dopo un secondo tempo confuso',
        "L'allenatore ha parlato di una squadra stanca e di scelte che non hanno dato i risultati sperati. La societa valuta il mercato di gennaio.",
    ),
    (
        'es',
        'La receta de la abuela para el arroz con leche',
        'Los datos de la cocina tradicional dicen que el secreto esta en la canela y en la paciencia. Un plato sencillo que sale bien si se respeta el tiempo.',
    ),
    (
        'fr',
        'Le conseil municipal vote le budget de la voirie',
        "Les elus ont debattu pendant trois heures avant d'approuver le plan de rénovation des trottoirs du centre-ville.",
    ),
    (
        'it',
        'Acme annuncia il lancio della sua nuova piattaforma per le imprese',
        'La soluzione integrata promette di trasformare il modo in cui le aziende lavorano, con un approccio innovativo e orientato al cliente.',
    ),
    (
        'es',
        'El tiempo para el fin de semana: lluvia en el norte',
        'Se esperan precipitaciones en la cornisa cantabrica y temperaturas suaves en el resto del pais.',
    ),
    (
        'fr',
        'Ouverture de la saison des marches de Noel',
        "Les commercants attendent une frequentation en hausse par rapport a l'annee derniere malgre la meteo incertaine.",
    ),
    (
        'it',
        'Il nuovo romanzo che racconta la provincia italiana degli anni ottanta',
        'Una storia di famiglia raccontata con una lingua asciutta, in un paese dove tutti si conoscono e nessuno dice quello che pensa.',
    ),
    (
        'es',
        'Entrevista con el director de la orquesta municipal',
        'Habla de su formacion, del repertorio de la temporada y de como se prepara un concierto con musicos jovenes.',
    ),
]

for _lingua, _atteso, _titolo, _testo in ATTESI_ALTRE_LINGUE:
    _temi = classifica(_titolo, _testo)
    verifica("%s: un testo su %s prende il suo tema" % (_lingua, _atteso),
             bool(_temi) and _temi[0][0] == _atteso)

# L'altra direzione, e senza di lei la prima non vuol dire niente: un lessico
# che assegna un tema a tutto passerebbe le quindici prove qui sopra.
for _lingua, _titolo, _testo in RUMORE_ALTRE_LINGUE:
    verifica("%s: «%s» non prende nessun tema" % (_lingua, _titolo[:34]),
             not classifica(_titolo, _testo))

# ---------------------------------------------------------------- chiavi e deduplicazione
verifica("il DOI normalizza l'URL completo",
         fonti.chiave_di("https://doi.org/10.1/AB", "x") == fonti.chiave_di("10.1/ab", "y"))
verifica("senza DOI la chiave viene dal titolo",
         fonti.chiave_di(None, "Un Titolo!") == fonti.chiave_di(None, "un titolo"))
verifica("titoli diversi danno chiavi diverse",
         fonti.chiave_di(None, "alfa") != fonti.chiave_di(None, "beta"))

v = fonti.voce("  Titolo   con  spazi  ", "prova", "https://e.org", doi="https://doi.org/10.1/x")
verifica("voce: titolo con spazi normalizzati", v["titolo"] == "Titolo con spazi")
verifica("voce: DOI ripulito dal prefisso", v["doi"] == "10.1/x")
verifica("voce: campi obbligatori presenti",
         all(k in v for k in ("chiave", "titolo", "autori", "data", "doi", "tipo",
                              "fonte", "url", "url_pdf", "licenza", "abstract",
                              "concetti", "editore")))
verifica("voce: autori vuoti scartati",
         fonti.voce("t", "f", "u", autori=["a", None, ""])["autori"] == ["a"])
# Un campo che c'e' ed e' nullo non e' un campo che manca: `get(k, [])` torna
# None nel primo caso, e la comprensione che segue esplode. E' la forma in cui
# arrivano i campi vuoti di un JSON, quindi bastera' un chiamante che legga
# `autori` da un feed invece di costruirlo per trovarla.
verifica("un elenco nullo non fa esplodere la voce",
         fonti.voce("t", "f", "u", autori=None, concetti=None)["autori"] == [])

# ---------------------------------------------------------------- setaccio completo
grezzo = catalogo.dati_di_prova()
nuove, scartate = catalogo.setaccia(grezzo, esclusioni, set(), "1970-01-01")
titoli = [v["titolo"] for v in nuove]

verifica("duplicato per DOI unito", scartate["duplicate"] == 1)
verifica("ritrattazione scartata dal setaccio", scartate["non_pubblicazione"] == 1)
verifica("rumore scartato dal setaccio", scartate["rumore"] == 1)
verifica("voce senza tema scartata", scartate["senza_tema"] == 1)
verifica("restano solo le due voci buone", len(nuove) == 2)
verifica("la copia conservata è quella con il testo pieno",
         any(v.get("url_pdf") for v in nuove if v["doi"] == "10.1000/a"))
verifica("ogni voce ha tema, trimestre e rilevanza",
         all(v.get("tema_slug") and v.get("trimestre") and v.get("rilevanza") for v in nuove))
verifica("ordinamento per rilevanza decrescente",
         [v["rilevanza"] for v in nuove] == sorted([v["rilevanza"] for v in nuove], reverse=True))

gia_viste = {v["chiave"] for v in grezzo}
_, scartate2 = catalogo.setaccia(grezzo, esclusioni, gia_viste, "1970-01-01")
verifica("il secondo giro non ripropone nulla", scartate2["gia_viste"] > 0)

vecchie = [fonti.voce("Query optimization study", "p", "u", doi="10.9/z", data="2000-01-01")]
_, scartate3 = catalogo.setaccia(vecchie, esclusioni, set(), "2026-01-01")
verifica("voce fuori finestra scartata", scartate3["fuori_finestra"] == 1)

# ---------------------------------------------------------------- uscite su disco
with tempfile.TemporaryDirectory() as tmp:
    storico = catalogo.scrivi_catalogo(tmp, nuove, scartate, [("prova", "ok", "", 6, 0.1)],
                                       "2026-01-01", "2026-01-02")
    for nome in ("catalogo.json", "catalogo.md", "manifesto.json", "rapporto.txt"):
        verifica(f"scritto {nome}", os.path.exists(os.path.join(tmp, nome)))

    manifesto = json.load(open(os.path.join(tmp, "manifesto.json"), encoding="utf-8"))
    campi_attesi = {"codice", "titolo", "autore", "tema_slug", "trimestre",
                    "licenza", "url", "formato", "nota"}
    verifica("manifesto nella forma attesa da importaBiblioteca",
             all(campi_attesi <= set(m) for m in manifesto))
    verifica("manifesto: formato solo pdf o html",
             all(m["formato"] in ("pdf", "html") for m in manifesto))
    verifica("manifesto: codici distinti",
             len({m["codice"] for m in manifesto}) == len(manifesto))
    verifica("manifesto: ogni voce ha un indirizzo", all(m["url"] for m in manifesto))

    # Seconda scrittura sugli stessi dati: il catalogo non deve duplicare.
    storico2 = catalogo.scrivi_catalogo(tmp, nuove, scartate, [], "2026-01-01", "2026-01-02")
    verifica("catalogo incrementale senza duplicati", len(storico2) == len(storico))

# ---------------------------------------------------------------- ricercatore
import ricercatore

verifica("ogni via di accesso ha una qualità dichiarata",
         all(isinstance(v, int) for v in ricercatore.QUALITA.values()))
verifica("il prestito vale meno della copia scaricabile",
         ricercatore.QUALITA["prestito bibliotecario (una copia per volta)"]
         < ricercatore.QUALITA["pubblico dominio, scaricabile"])
verifica("la richiesta in biblioteca è l'ultima risorsa",
         min(ricercatore.QUALITA.values()) ==
         ricercatore.QUALITA["da richiedere in biblioteca (prestito interbibliotecario)"])
verifica("ogni accesso prodotto dagli adattatori ha una qualità nota",
         {"pubblico dominio, scaricabile", "libro ad accesso aperto", "copia aperta depositata",
          "copia aperta", "vista integrale", "testo su Internet Archive",
          "pubblico dominio, lettura integrale"} <= set(ricercatore.QUALITA))

with tempfile.NamedTemporaryFile("w", suffix=".txt", delete=False, encoding="utf-8") as f:
    f.write("# commento\n\nUn titolo qualunque\n10.1000/xyz\ndoi:10.2000/abc\n")
    elenco = f.name
voci = list(ricercatore.voci_da_elenco(elenco))
os.unlink(elenco)
verifica("elenco: commenti e righe vuote ignorati", len(voci) == 3)
verifica("elenco: titolo riconosciuto", voci[0]["titolo"] == "Un titolo qualunque")
verifica("elenco: DOI nudo riconosciuto", voci[1]["doi"] == "10.1000/xyz")
verifica("elenco: prefisso doi: rimosso", voci[2]["doi"] == "10.2000/abc")

# La catena dei libri deve restare allineata alle funzioni che esistono davvero.
verifica("catena dei libri tutta richiamabile",
         all(callable(f) for f in fonti.CATENA_LIBRI))

# ---------------------------------------------------------------- motivo degli errori
import io
import urllib.error

def _errore(codice, corpo, tipo="application/json"):
    return urllib.error.HTTPError("https://e.org", codice, "errore",
                                  {"Content-Type": tipo}, io.BytesIO(corpo.encode()))

verifica("motivo: estrae il messaggio da un JSON",
         "campo ignoto" in fonti._motivo(_errore(400, '{"message": "campo ignoto: access_right"}')))
verifica("motivo: estrae anche da una chiave errors",
         "sintassi" in fonti._motivo(_errore(400, '{"errors": ["sintassi non valida"]}')))
verifica("motivo: toglie i tag da una risposta HTML",
         "Not Acceptable" in fonti._motivo(_errore(406, "<html><body>Not Acceptable</body></html>", "text/html")))
verifica("motivo: corpo vuoto non produce rumore", fonti._motivo(_errore(400, "")) == "")
verifica("motivo: un corpo illeggibile non solleva",
         fonti._motivo(urllib.error.HTTPError("https://e.org", 400, "x", {}, None)) == "")
verifica("motivo: la riga resta breve",
         len(fonti._motivo(_errore(400, '{"message": "' + "x" * 4000 + '"}'))) < 260)

# Forma reale della risposta di Zenodo: il messaggio generico da solo non dice
# nulla di azionabile, il campo rifiutato sta in errors e deve venire prima.
_zenodo = ('{"message": "A validation error occurred.", "status": 400, '
           '"errors": [{"field": "sort", "messages": ["Not a valid choice."]}]}')
_reso = fonti._motivo(_errore(400, _zenodo))
verifica("motivo: il campo rifiutato precede il messaggio generico",
         _reso.index("sort") < _reso.index("A validation error"))
verifica("motivo: conserva comunque il messaggio generico",
         "A validation error" in _reso)

# Il recapito non è nel sorgente: si dichiara, non si eredita.
verifica("contatto assente se PERCORSO_CONTATTO non è impostato",
         fonti.CONTATTO == os.environ.get("PERCORSO_CONTATTO", "").strip())
verifica("cortesia non inventa un recapito",
         ("mailto" in fonti._cortesia({})) == bool(fonti.CONTATTO))
verifica("nessun indirizzo di posta scritto nel sorgente delle fonti",
         not re.search(r"[\w.+-]+@[\w-]+\.[\w.]+",
                       open(os.path.join(os.path.dirname(os.path.abspath(__file__)),
                                         "fonti_aperte.py"), encoding="utf-8").read()))

# ------------------------------------------------- interrogazioni già respinte dagli archivi
# Guardie di regressione: ognuna di queste sintassi ha fatto rispondere 4xx a
# tutto l'archivio nella rassegna del 21/09/2026. Il rapporto quotidiano le
# segnalerebbe di nuovo, ma un giorno dopo: meglio non riscriverle affatto.
_fonti_src = open(os.path.join(os.path.dirname(os.path.abspath(__file__)),
                               "fonti_aperte.py"), encoding="utf-8").read()
verifica("DOAJ senza intervallo su bibjson.year (era HTTP 400)",
         "bibjson.year:[" not in _fonti_src)
verifica("Zenodo senza access_right nell'interrogazione (era HTTP 400)",
         "access_right:open" not in _fonti_src)
verifica("arXiv su https (su http rispondeva HTTP 406)",
         "http://export.arxiv.org" not in _fonti_src)
verifica("ogni richiesta dichiara un Accept (arXiv rispondeva 406 senza)",
         '"Accept"' in _fonti_src)
# "Page size cannot be greater than 25": superarlo non tronca, fa respingere
# tutta l'interrogazione con 400.
verifica("Zenodo entro il tetto di pagina non autenticato",
         fonti.ZENODO_PAGINA_MASSIMA <= 25 and "min(massimo, ZENODO_PAGINA_MASSIMA)" in _fonti_src)

# --------------------------------------------- una fonte spenta non tace mai
# Unpaywall senza recapito non parte: ogni voce con DOI perde la fonte che da
# sola risponde alla domanda. Il 21/09/2026 sono uscite 19 voci su 19 "senza via
# di accesso" e dal rapporto sembravano un esito, non uno strumento spento.
_ricerc_src = open(os.path.join(os.path.dirname(os.path.abspath(__file__)),
                                "ricercatore.py"), encoding="utf-8").read()
_cat_src = open(os.path.join(os.path.dirname(os.path.abspath(__file__)),
                             "catalogo.py"), encoding="utf-8").read()
_flusso = open(os.path.join(RADICE, ".github", "workflows", "rassegna.yml"),
               encoding="utf-8").read()

verifica("il ricercatore dichiara le fonti spente prima di trattare le voci",
         "if not fonti.CONTATTO:" in _ricerc_src and "spente.append" in _ricerc_src)
verifica("le fonti spente finiscono anche nel file dell'esito",
         '"fonti_spente": spente' in _ricerc_src)
verifica("le fonti spente si rileggono accanto ai numeri del riepilogo",
         "Fonti spente in questa corsa" in _ricerc_src)
verifica("il rapporto quotidiano distingue una fonte muta da una spenta",
         "RECAPITO NON DICHIARATO" in _cat_src)
# Il recapito viaggia in un segreto, mai nel sorgente: è un dato personale.
verifica("il flusso passa il recapito ai due passi che lo usano",
         _flusso.count("PERCORSO_CONTATTO: ${{ secrets.PERCORSO_CONTATTO }}") == 2)
verifica("nessun indirizzo di posta scritto nei sorgenti della rassegna",
         not re.search(r"[\w.+-]+@[\w-]+\.[\w.]+", _fonti_src + _ricerc_src + _cat_src))

# ------------------------------------------------------------- diagnosi di arXiv
# La diagnosi vale solo se la prima variante è davvero identica alla richiesta
# che fallisce: se UA o Accept cambiano in fonti_aperte e non qui, il controllo
# smette di essere un controllo e le altre varianti non dimostrano più nulla.
import diagnosi_arxiv as diagnosi

_controllo = diagnosi.VARIANTI[0]
verifica("la prima variante della diagnosi è il controllo",
         _controllo[0] == "controllo")
verifica("il controllo manda lo stesso User-Agent di fonti_aperte",
         _controllo[4]["User-Agent"] == fonti.UA)
verifica("il controllo manda lo stesso Accept di chiedi()",
         _controllo[4]["Accept"] in _fonti_src)
verifica("il controllo interroga l'indirizzo di fonti_aperte.arxiv",
         _controllo[2] in _fonti_src)
verifica("il controllo manda i parametri di fonti_aperte.arxiv",
         set(_controllo[3]) == {"search_query", "sortBy", "sortOrder", "max_results"})

# Ogni variante isola UNA dimensione: quelle della famiglia "testate" cambiano
# una sola intestazione e nient'altro, quelle della famiglia "richiesta" non
# toccano le intestazioni. Senza questo, una variante che cambia due cose
# insieme passa o fallisce senza dire quale delle due contava.
for _fam, _desc, _ind, _par, _test in diagnosi.VARIANTI[1:]:
    if _fam == "testate":
        verifica(f"variante testate senza altri cambiamenti: {_desc[:34]}",
                 _ind == _controllo[2] and _par == _controllo[3])
        _diverse = [k for k in set(_test) | set(_controllo[4])
                    if _test.get(k) != _controllo[4].get(k)]
        verifica(f"variante testate cambia una sola intestazione: {_desc[:34]}",
                 len(_diverse) == 1)
    else:
        verifica(f"variante richiesta non tocca le intestazioni: {_desc[:34]}",
                 _test == _controllo[4])
        verifica(f"variante richiesta cambia qualcosa: {_desc[:34]}",
                 _ind != _controllo[2] or _par != _controllo[3])

verifica("la diagnosi rispetta la pausa chiesta da arXiv", diagnosi.PAUSA >= 3.0)
# Una diagnosi che fa fallire il job non la legge nessuno: la rassegna del
# giorno deve pubblicare comunque.
verifica("la diagnosi esce sempre con 0", "return 0" in
         open(os.path.join(os.path.dirname(os.path.abspath(__file__)),
                           "diagnosi_arxiv.py"), encoding="utf-8").read())

# ---------------------------------------------------------------- nessuna fonte ombra
sorgenti = ""
for nome in ("fonti_aperte.py", "catalogo.py", "ricercatore.py", "diagnosi_arxiv.py"):
    with open(os.path.join(os.path.dirname(os.path.abspath(__file__)), nome),
              encoding="utf-8") as f:
        sorgenti += f.read().lower()
# I nomi compaiono solo nel testo che spiega perché sono esclusi: mai in un indirizzo.
import re as _re
indirizzi = " ".join(_re.findall(r"https?://[^\s\"')]+", sorgenti))
verifica("nessuna biblioteca ombra fra gli indirizzi interrogati",
         not any(o in indirizzi for o in
                 ("bookos", "b-ok", "zlibrary", "z-lib", "libgen", "library.lol",
                  "annas-archive", "sci-hub")))

print(f"Test superati : {ok}")
print(f"Falliti       : {len(ko)}")
for k in ko:
    print(f"  FALLITO: {k}")
sys.exit(1 if ko else 0)
