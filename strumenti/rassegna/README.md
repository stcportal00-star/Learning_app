# Rassegna — nuove pubblicazioni, catalogate per specializzazione

Due strumenti che lavorano insieme e si usano anche separatamente.

**`catalogo.py`** interroga ogni giorno gli archivi aperti, scarta il rumore,
assegna a ogni uscita i temi del piano di studio e aggiorna un catalogo
incrementale.

**`ricercatore.py`** prende un titolo, un DOI o l'intero catalogo e cerca dove
esiste una copia legalmente accessibile, dalla più durevole alla più precaria.

Girano in GitHub Actions (`.github/workflows/rassegna.yml`, ogni mattina alle
05:00 UTC) e pubblicano nella release `rassegna`, che ha un tag fisso: dal
telefono resta un segnalibro solo.

---

## Che cosa entra nel catalogo

Una voce passa solo se supera, in quest'ordine:

| Filtro | Scarta |
|---|---|
| `e_pubblicazione` | ritrattazioni, errata, corrigenda, apparati editoriali |
| `e_rumore` | rumore redazionale, da `assets/contenuti/esclusioni_rassegna.json` |
| finestra temporale | voci più vecchie della finestra (i libri di pubblico dominio sono esenti) |
| `visti.json` | ciò che era già comparso in una rassegna precedente |
| deduplicazione | la stessa opera da più archivi: resta la copia più completa |
| `classifica` | ciò che non raggiunge la soglia in nessun tema |

L'ultimo filtro è il più severo, ed è voluto: una voce catalogata nel tema
sbagliato non si ritrova più, una voce scartata si ritrova con una ricerca.

## I temi

Sono gli stessi `tema_slug` di `assets/contenuti/biblioteca.json` — le nuove
uscite entrano nella stessa libreria dei 52 testi già catalogati, non in uno
schema parallelo. `verifica_rassegna.py` fallisce se i due insiemi divergono o
se il trimestre di un tema smette di corrispondere a quello dominante nella
biblioteca.

| Trimestre | Temi |
|---|---|
| T1 | `sql_base`, `ottimizzazione`, `lettura_codice`, `modellazione` |
| T2 | `statistica`, `epidemiologia`, `kpi`, `qualita_dati` |
| T3 | `gdpr`, `ai_act`, `ia` |
| T4 | `governance`, `business_analysis` |
| T5 | `sicurezza`, `hardware` |
| T6 | `meal`, `salute_digitale` |

La classificazione è a punteggio: termini forti (peso 1), termini deboli (0,4),
concetti già disambiguati dall'archivio (1,2), e un moltiplicatore 1,5 per ciò
che compare nel titolo invece che nell'abstract. Sotto 1,0 la voce non viene
assegnata. Al più due temi per voce.

## Le fonti

Periodiche, per il catalogo quotidiano:

| Fonte | Che cosa porta |
|---|---|
| OpenAlex | l'indice più ampio, con concetti già assegnati; filtrato su accesso aperto |
| arXiv | preprint depositati dagli autori |
| Crossref | editori assenti dagli archivi aperti |
| DOAJ | riviste interamente ad accesso aperto |
| Europe PMC | biomedicina ed epidemiologia, con testo pieno aperto |
| Zenodo | rapporti, dati, letteratura grigia |
| DOAB | libri accademici ad accesso aperto |
| Project Gutenberg | pubblico dominio verificato |
| Standard Ebooks | pubblico dominio ricomposto |

Puntuali, per il ricercatore: Unpaywall, OpenAlex, HathiTrust, Open Library,
Internet Archive, Google Books, e come ultima risorsa l'indirizzo di ricerca
WorldCat per la richiesta in biblioteca.

## Perché non ci sono le biblioteche ombra

Z-Library (bookos), Library Genesis, Anna's Archive e simili distribuiscono
opere protette senza averne titolo. Non sono interrogate qui, e non per una
cautela astratta: l'intera biblioteca del progetto poggia sulla licenza
dichiarata — l'intestazione di `strumenti/biblioteca_aperta.py` lo pone come
primo vincolo, e ogni voce del manifesto che l'app importa porta il proprio
titolo di distribuzione. Una sola voce senza quel titolo renderebbe il
manifesto inservibile come dichiarazione.

`verifica_rassegna.py` lo verifica a ogni corsa: nessun indirizzo interrogato
può appartenere a quei domini.

La parte legittima della stessa esigenza è coperta, e copre molto. Unpaywall e
OpenAlex trovano la copia depositata regolarmente di circa metà della
letteratura recente — è la stessa copia, messa a disposizione da chi ne ha il
diritto. Per i libri, DOAB e Project Gutenberg danno il testo da tenere;
Open Library e Internet Archive danno il prestito digitale controllato, che è
un servizio bibliotecario regolare. Quando non basta, il ricercatore dice
dove chiedere il volume invece di restituire una voce vuota.

## Uso a mano

```bash
# catalogo: finestra di sette giorni, due temi soltanto
python3 strumenti/rassegna/catalogo.py --cartella rassegna --giorni 7 \
    --temi statistica epidemiologia

# catalogo: prova senza rete, su dati finti
python3 strumenti/rassegna/catalogo.py --cartella /tmp/prova --prova

# ricercatore: un titolo
python3 strumenti/rassegna/ricercatore.py --titolo "Causal Inference: What If"

# ricercatore: un DOI, con tutte le vie trovate invece della sola migliore
python3 strumenti/rassegna/ricercatore.py --doi 10.1000/xyz --tutte-le-vie

# ricercatore: le voci del catalogo che non hanno ancora un testo pieno
python3 strumenti/rassegna/ricercatore.py --catalogo rassegna/catalogo.json \
    --solo-senza-testo --uscita rassegna/trovati.json

# verifica della logica, senza rete
python3 strumenti/rassegna/verifica_rassegna.py
```

## Uscite

| File | A che serve |
|---|---|
| `catalogo.md` | da leggere: le nuove uscite raggruppate per tema e trimestre |
| `catalogo.json` | il catalogo completo, incrementale |
| `manifesto.json` | importabile da **Libreria > Importa biblioteca**, stessa forma di `scarica_biblioteca.py` |
| `trovati.json` | per ogni voce senza testo pieno, la via di accesso migliore trovata |
| `rapporto.txt` | quali fonti hanno risposto, quanto hanno messo, che cosa è stato scartato e perché |
| `visti.json` | stato interno: le chiavi già viste. Non finisce in `rassegna.zip` |

## Guasti, e come si leggono

Il rapporto quotidiano elenca ogni fonte con il suo esito. Una fonte che non
risponde **non ferma la rassegna**: viene annotata e le altre proseguono. Una
rassegna parziale ogni giorno vale più di una rassegna completa che salta il
giorno in cui un archivio è in manutenzione.

Se *nessuna* fonte risponde, `catalogo.py` esce con codice 1: non è "nessuna
novità", è un guasto da guardare.

Gli adattatori non sono stati provati dal vivo dal contenitore di sviluppo — la
politica di rete dell'ambiente nega la connessione a quegli host. La prova dal
vivo è la prima corsa in Actions, e il rapporto dice esattamente quali fonti
hanno risposto. Per questo il workflow gira anche sul push di
`strumenti/rassegna/**`.
