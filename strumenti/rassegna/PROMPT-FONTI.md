# Prompt per cercare feed e fonti

Da incollare così com'è in un assistente con accesso al web. Tutto ciò che
contiene è stato letto dal codice, non ricordato: temi, aritmetica, liste di
scarto e copertura attuale sono quelli veri al 23 settembre 2026.

La versione precedente di questo prompt diceva *dove* cercare e non *di che
cosa* devono parlare le notizie. Le sezioni 1, 2 e 3 esistono per quello.

---

## ▼ DA QUI IN GIÙ È IL PROMPT ▼

Devi trovarmi feed RSS/Atom da aggiungere a una rassegna quotidiana
automatica. Non è un elenco di link da leggere: ogni fonte che mi proponi
diventa una riga in una tabella, viene interrogata ogni mattina da un
programma, e ciò che ne esce finisce in una biblioteca che leggo **offline, su
un telefono**. Una fonte sbagliata non è inutile: costa minuti ogni mattina e
sporca la biblioteca.

Leggi tutte e nove le sezioni prima di cercare. La 1, la 2 e la 3 dicono di
che cosa devono parlare le notizie; le altre dicono che forma devono avere.

---

### 1. Chi legge queste notizie, e perché

Una persona che ha appena preso la responsabilità di una **funzione dati
dentro un'organizzazione umanitaria medica**, con persone a riporto diretto e
un piano di crescita professionale a tre anni. Lavora **solo da telefono e
tablet**, senza PC.

Non legge per essere informato. Legge per produrre cose che hanno una scadenza
e un pubblico:

- una **valutazione d'impatto sulla protezione dei dati** su un flusso di dati
  sanitari, con base giuridica, necessità e proporzionalità, e rischi per
  popolazioni vulnerabili;
- una **policy interna sull'uso di IA generativa** applicabile al suo team,
  con soglia di revisione umana obbligatoria;
- un **albero di indicatori** della funzione dati, dalla missione alle foglie,
  con proprietario e frequenza;
- un'**architettura di infrastruttura di terreno** con tre profili di
  connettività e parametri misurabili;
- una **strategia dati a tre anni presentata alla direzione**, con i costi
  ricorrenti dichiarati;
- **un articolo pubblico al mese, per dodici mesi**, sui temi del suo piano.

Il dominio operativo è sanità e aiuto umanitario: strutture sanitarie,
pazienti, visite, vaccinazioni, indagini nutrizionali, distribuzioni,
valutazioni di bisogni, personale nazionale e internazionale, siti di campo
con connettività intermittente.

**Conseguenza pratica.** Una testata generalista di tecnologia non entra mai
nel merito di nessuna di queste cose. «L'IA cambierà il lavoro» non gli serve;
«come si scrive la soglia di accettazione di un harness di valutazione prima
di vedere i risultati» sì. Cerca fonti che entrano nel merito operativo: enti
normativi, autorità di protezione dati, organizzazioni umanitarie che
pubblicano metodo, riviste di salute digitale, blog di ingegneria dei dati
scritti da chi il sistema lo gestisce.

**Un vincolo temporale che cambia il valore di una fonte.** Dal 2 ottobre al
23 novembre 2026 è in viaggio senza rete affidabile. In quella finestra legge
solo ciò che è già sceso sul telefono. Quindi una fonte vale il doppio se i
suoi contenuti sono **testo estraibile o PDF**, e quasi niente se sono un
titolo che rimanda a una pagina da navigare.

---

### 2. Che cosa succede a una notizia dopo che l'hai trovata

Ogni mattina alle 08:00 locali un programma:

1. scarica il feed e legge **al massimo le prime 12 voci in ordine di
   documento** (non le più recenti per data: le prime che incontra);
2. costruisce una voce con titolo, autori, data, URL e sommario preso dalla
   `description`/`summary`/`content` del feed, **troncato a 4000 caratteri**;
3. le assegna al massimo **due temi** con un classificatore a soglia (sezione
   3 e 4); **se nessun tema supera la soglia, la voce sparisce**;
4. scarta le voci che sono rumore redazionale (sezione 6);
5. apre l'URL e ne estrae il **testo**, che è ciò che si leggerà in aereo. Se
   quello che scarica è un **PDF**, il file viene depositato per intero e si
   legge offline — è il caso migliore, con un tetto di 8 PDF per corsa;
6. scrive una riga con titolo, url, sommario, testo, tema, trimestre e un voto
   0–100, e la fa comparire sul telefono.

Due conseguenze che devi tenere in mente mentre cerchi:

- **Un feed con solo il titolo e due righe di sommario vale poco**: il
  classificatore ha poco testo su cui lavorare e la biblioteca riceve un
  titolo. Un feed con `content:encoded` a testo pieno, o i cui link puntano a
  PDF, vale molto di più. **Dichiaramelo per ogni fonte.**
- **La deduplica è sul titolo normalizzato, troncato a 120 caratteri.** I
  bollettini con titoli seriali del tipo
  `Disease Outbreak News – Cholera – Country – 12 September 2026` collassano
  in **una sola riga al giorno** se i primi 120 caratteri alfanumerici
  coincidono. Controllalo e dimmelo.

---

### 3. I temi. Sono diciassette, e sono questi

Il classificatore conosce **solo** questi diciassette slug. Non esistono
categorie generiche: non c'è «tecnologia», non c'è «ricerca», non c'è
«dati». Una notizia che non cade qui dentro non ha dove andare.

Per ogni tema ti do il **lessico forte** che lo fa scattare. Sono le stringhe
vere del codice: cercale nei titoli e nei sommari delle fonti candidate.

| slug | tema | lessico forte (estratto) |
|---|---|---|
| `sql_base` | SQL e motori relazionali | sql, relational database, query optimizer, query plan, postgresql, sqlite, duckdb, transaction isolation, acid, join algorithm |
| `ottimizzazione` | Prestazioni e piani di esecuzione | query performance, execution plan, cardinality estimation, vectorized execution, columnar storage, index selection, cost model, query rewriting |
| `modellazione` | Modellazione e architettura dei dati | data modeling, dimensional model, star schema, data vault, entity relationship, data contract, semantic layer, schema evolution, data mesh |
| `lettura_codice` | Lettura ed esecuzione di codice | code comprehension, code review, static analysis, debugging, version control, refactoring, software maintenance |
| `statistica` | Statistica e inferenza | causal inference, bayesian inference, regression, time series forecasting, confidence interval, hypothesis testing, propensity score, difference-in-differences, instrumental variable, survival analysis |
| `epidemiologia` | Epidemiologia e sorveglianza | epidemiology, disease surveillance, outbreak detection, incidence rate, case fatality, cohort study, case-control, seroprevalence, vaccination coverage, nutritional survey, smart survey, mortality survey |
| `kpi` | Indicatori e visualizzazione | key performance indicator, data visualization, dashboard design, indicator framework, visual encoding, chart design, performance measurement |
| `qualita_dati` | Qualità e riproducibilità dei dati | data quality, data validation, reproducibility, research data management, missing data, record linkage, deduplication, data provenance, fair data |
| `gdpr` | Protezione dei dati | gdpr, general data protection regulation, data protection impact assessment, lawful basis, data minimisation, data subject rights, international data transfer, data protection by design, humanitarian data protection |
| `ai_act` | AI Act e regolazione dell'IA | ai act, artificial intelligence act, high-risk ai system, conformity assessment, general purpose ai, ai governance framework, algorithmic accountability, fundamental rights impact assessment |
| `ia` | Intelligenza artificiale applicata | large language model, retrieval augmented generation, prompt injection, model evaluation, hallucination, fine-tuning, foundation model, ai risk management, red teaming, model card |
| `business_analysis` | Analisi di processo e requisiti | requirements elicitation, business process modeling, stakeholder analysis, process mining, value stream mapping, cost-benefit analysis, theory of change |
| `governance` | Governance e affidabilità operativa | service level objective, error budget, site reliability engineering, architecture decision record, data governance, stewardship, operating model, postmortem, change management |
| `hardware` | Dispositivi, reti e continuità | mobile device management, network latency, offline first, intermittent connectivity, delay tolerant network, business continuity, disaster recovery, edge computing, satellite connectivity, power resilience |
| `sicurezza` | Sicurezza delle informazioni | incident response, threat modeling, vulnerability management, zero trust, security framework, ransomware, supply chain security, nis2, cyber resilience, penetration testing |
| `meal` | Monitoraggio, valutazione e apprendimento | monitoring and evaluation, humanitarian evaluation, accountability to affected populations, logical framework, outcome harvesting, needs assessment, sphere standards, core humanitarian standard, cash and voucher assistance, protection mainstreaming |
| `salute_digitale` | Salute digitale e sistemi informativi | health information system, dhis2, electronic health record, interoperability, hl7 fhir, icd-11, digital health intervention, telemedicine, health data standard, openmrs |

**Tre trappole ortografiche, vere.**
- Il lessico è **inglese**, anche per fonti italiane o francesi. Va benissimo
  una fonte in italiano il cui gergo resta inglese (`gdpr`, `ransomware`,
  `nis2`, `ai act` scattano su un titolo italiano). Non va bene una fonte che
  traduce tutto.
- **Grafie britanniche obbligate**: `data minimisation`, `anonymisation`,
  `colour scale`. Le forme americane con la z o `color` **non** vengono
  riconosciute.
- Molti termini forti sono **locuzioni di due o tre parole**: `execution
  plan`, non `plan`; `outbreak detection`, non `outbreak`; `dashboard design`,
  non `dashboard`. Un blog che dice «faster queries» prende zero.

---

### 4. L'aritmetica che decide se una voce entra

Soglia **1.0**. Un termine nel **titolo** vale ×1.5. Termine forte = 1.0,
termine debole = 0.4. Quindi:

| dove | forza | punti | entra da solo? |
|---|---|---|---|
| titolo | forte | 1.5 | **sì** |
| titolo | debole | 0.6 | no (ne servono due) |
| sommario | forte | 1.0 | **sì, al pelo** |
| sommario | debole | 0.4 | no |

Esempi veri, calcolati:
- `PostgreSQL 18 released` → `sql` forte nel titolo = **1.5**, entra.
- `Cholera outbreak in Sudan` → `cholera` è **debole** e `outbreak` da solo
  **non è un termine** (lo è `outbreak detection`) = **0.6**, **scartata**.
  Con un sommario che cita `incidence rate` e `disease surveillance` arriva a
  3.0 ed entra. **È il tema che più dipende dal sommario.**
- `Media bias and the sampling of public opinion` → `bias` + `sampling`, due
  deboli nel titolo = **1.2**, entra come `statistica`. È un falso positivo:
  ecco perché le testate generaliste vanno evitate.
- `Chart-topping legend returns to the stage` → `chart` + `legend` = **1.2**,
  entra come `kpi`. Stesso motivo.

**Superare 1.0 non basta.** Dopo la deduplica, tutte le voci del giorno —
feed e archivi accademici insieme — vengono ordinate per punteggio e tagliate
a **80**. Una fonte che produce solo voci fra 1.0 e 1.2 è la prima a cadere.
Nella tua tabella dammi il **punteggio medio** delle voci che passano.

---

### 5. Cosa è già coperto. Non propormelo

**Archivi già interrogati ogni mattina**, uno per tema con i suoi termini
forti: OpenAlex · Crossref · DOAJ · Europe PMC · Zenodo · Unpaywall · DOAB ·
OpenLibrary · HathiTrust · Internet Archive · Project Gutenberg · Standard
Ebooks. Coprono ciò che ha un DOI o un ISBN, con **giorni o settimane di
ritardo**.

**arXiv è già interrogato via API**, ordinato per data di deposito, su queste
categorie: `cs.DB` `cs.LG` `cs.CR` `cs.CY` `cs.SE` `stat.ME` `stat.AP`
`stat.ML`. Un feed RSS di una di queste categorie è un doppione puro: non
propormelo. Una categoria arXiv **fuori** da questo elenco (per esempio
`cs.AI`, `cs.HC`, `cs.IR`) è invece ammessa.

**Feed RSS già attivi nella tabella** (due): Planet PostgreSQL · arXiv cs.AI

**Fonti già individuate ma non ancora attive** — queste **non** sono doppioni:
sono una lista scritta a mano dentro l'app, mai collegata alla rassegna. Otto
di esse non hanno un feed RSS e sono **il lavoro più prezioso che puoi fare**:
se trovi il loro feed, o un equivalente, proponimelo per primo.

> **Senza feed RSS, da trovare:** Garante Privacy (comunicati) · EUR-Lex
> (nuovi atti) · Hugging Face Daily Papers · Anthropic Engineering · Google
> SRE Blog.
>
> *(Altre tre della stessa lista non hanno feed e non servono: OpenAlex e
> Semantic Scholar sono già coperti dagli archivi, e gli avvisi di Google
> Scholar arrivano per posta per costruzione.)*
>
> **Già con feed, non riproporle:** EDPB News · AI Act Explorer / Future of
> Life · ENISA Publications · noyb · Agenda Digitale · Guerre di Rete · dbt
> Labs · DuckDB · MotherDuck · Jack Vanlightly · Data Engineering Weekly ·
> Simon Willison · arXiv cs.CL · arXiv cs.SE · Import AI · Ahead of AI ·
> OCHA Centre for Humanitarian Data · ICRC Humanitarian Law & Policy · MSF
> Field Research · Epicentre · The New Humanitarian · ALNAP · DHIS2 News ·
> Lancet Digital Health · BMJ Health & Care Informatics · WHO Bulletin · MIT
> Sloan Management Review · CIO Dive.

**Deroga sui doppioni accademici.** Un feed di rivista indicizzata è
ammesso **se pubblica il giorno stesso** e l'archivio arriva con ritardo —
per esempio le rapid communications di Eurosurveillance o l'MMWR. Dichiarami
il ritardo tipico che hai osservato.

---

### 6. Cosa viene buttato via. Sono due liste diverse

**(a) Non è una pubblicazione** — scartato *prima* della classificazione:
errata, ritrattazioni, `conference programme`, indici di fascicolo, apparati
editoriali. Un feed che pubblica soprattutto programmi di conferenza è morto
in partenza, anche se il tema è perfetto.

**(b) Rumore redazionale** — scartato per titolo, anche quando il tema è
pieno. Lista completa: round di finanziamento · funding round · series a ·
series b · valuation · nomina · appointed · joins as · steps down · hires ·
lancia il nuovo · announces the launch · now available · general availability
· predizioni per il · predictions for · trends to watch · what to expect in ·
migliori strumenti · best tools · top 10 · top 5 · listicle · ha dichiarato
che · ceo says · reacts to · slams · sparks debate · partnership with ·
acquisisce · acquires.

Serve perché un comunicato stampa come «Acme **announces the launch** of a
GDPR compliance platform» un tema pieno ce l'ha. Se il contenuto tipico di
una fonte è fatto di annunci di prodotto, nomine e raccolte di capitale, non
propormela: il 90% delle sue voci morirà qui.

**(c) Mai biblioteche ombra.** Niente Z-Library, LibGen, Anna's Archive,
Sci-Hub. Ogni voce deve avere una licenza dichiarata e citabile.

---

### 7. Dove guardare davvero

In ordine di valore per me:

1. **Autorità e organismi normativi europei e nazionali** su protezione dati,
   IA e sicurezza: EDPS, CNIL, AEPD, ICO, ACN, AgID, autorità di controllo
   nazionali, comitati e gruppi di lavoro. Bersagli: `gdpr`, `ai_act`,
   `sicurezza`. Molti pubblicano in italiano o francese con gergo inglese:
   sono un buco reale, perché gli archivi aperti sono interrogati solo in
   inglese e non li vedono mai.
2. **Organizzazioni umanitarie che pubblicano metodo**, non comunicati:
   linee guida di valutazione, standard, note tecniche, lezioni apprese.
   Bersagli: `meal`, `epidemiologia`, `gdpr` (protezione dati umanitari).
3. **Bollettini epidemiologici e di sorveglianza** a pubblicazione rapida.
   Bersagli: `epidemiologia`, `salute_digitale`.
4. **Standard e specifiche di salute digitale**: ballot e release note FHIR,
   note di versione DHIS2, aggiornamenti di classificazioni e terminologie.
   Bersaglio: `salute_digitale`. La cadenza può essere mensile o rara: va
   benissimo, non esiste una finestra temporale per i feed.
5. **Blog di ingegneria scritti da chi gestisce il sistema**, non dal
   marketing: affidabilità, postmortem, piani di esecuzione, modellazione.
   Bersagli: `governance`, `ottimizzazione`, `modellazione`, `sql_base`.
6. **Connettività difficile, continuità operativa, dispositivi in campo**:
   reti satellitari, offline-first, resilienza energetica, gestione della
   flotta di dispositivi. Bersaglio: `hardware` — ed è il tema che descrive
   le condizioni stesse del suo lavoro, oggi quasi scoperto.
7. **Analisi di processo e requisiti**: process mining, theory of change,
   value stream mapping. Bersaglio: `business_analysis`, oggi scoperto.

I temi oggi **più scoperti**, in ordine: `business_analysis`, `hardware`,
`meal`, `kpi`, `qualita_dati`, `lettura_codice`.

---

### 8. Prima di propormi una fonte, provala

Per **ciascuna** candidata, e dichiarami l'esito:

1. Scarica davvero l'URL del feed. Deve essere un feed, non la pagina del
   sito: un indirizzo sbagliato risponde 200 lo stesso.
2. Guarda le **prime 10 voci in ordine di documento**. La prima è la più
   recente? Una fonte che mette in cima voci fisse o l'archivio più vecchio
   consegna dodici voci morte ogni mattina.
3. Conta quante di quelle 10 supererebbero la soglia 1.0 con l'aritmetica
   della sezione 4. **Accetto una fonte da 4 su 10 in su.**
4. Guarda dove puntano i `<link>`: pagina HTML o **PDF**? Dichiaralo.
5. Guarda se la `description` è due righe o testo pieno. Dichiaralo.
6. Prendi i primi 120 caratteri alfanumerici dei 10 titoli: sono distinti fra
   loro? Se no, la fonte collasserà in poche righe al giorno.
7. Trova la licenza dei contenuti e l'URL della pagina che la dichiara.

Se non puoi scaricare il feed, **dillo** e segna la fonte come non verificata.
Non inventare un indirizzo: un `url_feed` finto costa una corsa quotidiana.

---

### 9. Come voglio la risposta

**(A) Le righe SQL**, pronte da incollare:

```sql
insert into percorso.fonti (nome, url_feed, url_sito, metodo, categoria, lingua, peso, attiva)
values
  ('Nome leggibile', 'https://.../feed.xml', 'https://.../', 'rss', '<uno dei 17 slug>', 'en', 0.7, true)
on conflict (utente_id, url_feed) do nothing;
```

Vincoli veri:
- `categoria` deve essere **uno dei diciassette slug della sezione 3**, scritto
  identico. Non entra nella classificazione, ma se coincide col tema calcolato
  la rilevanza sale del 20%. Una categoria inventata non fa danno, ma spreca
  quel 20%.
- `peso` fra 0 e 1. Decide l'ordine di lettura: quando la corsa è lenta i feed
  hanno meno di sei minuti e **le fonti con peso basso non vengono nemmeno
  scaricate**. Metti 0.7+ solo a ciò che consideri irrinunciabile.
- `lingua` è informativo, il codice non lo legge. Mettilo giusto, ma non usarlo
  come criterio.
- `metodo` deve essere `'rss'`: gli altri valori ammessi (`scrape`, `api`,
  `email`) esistono nello schema ma **non vengono letti da nessuno**.
- `nome` diventa l'etichetta `rss[<nome>]` su ogni voce. Tienilo corto e
  riconoscibile.

**(B) La tabella di motivazione**, una riga per fonte:

| nome | tema/i bersaglio | voci utili su 10 | punteggio medio | link → | sommario | titoli distinti | licenza | perché questa |
|---|---|---|---|---|---|---|---|---|
| | uno dei 17 slug | es. 6/10 | es. 2.1 | html / **pdf** | 2 righe / testo pieno | sì / no | nome + url | una frase |

**(C) Le fonti che hai scartato** e in una riga perché. Mi serve quanto le
altre: mi dice dove hai già guardato.

**Quante.** Da 12 a 20 fonti accettate, distribuite sui temi scoperti della
sezione 7. Meglio 12 provate che 30 supposte.

**Come collauderò.** Incollo le righe e lancio
`python3 strumenti/nuvola/diagnosi.py --fonti`, che per ogni fonte stampa
quante voci porta e quante di quelle prendono un tema. Scrivi la tua risposta
sapendo che finirà lì dentro.

## ▲ FIN QUI È IL PROMPT ▲
