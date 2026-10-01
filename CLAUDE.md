# CLAUDE.md — istruzioni di progetto

App di apprendimento offline-first per Android (telefono + tablet, stesso codice).
Utente: Alessio Mirra. Lingua del codice, dei commenti e dell'interfaccia: **italiano**.

## Vincolo che governa ogni decisione

**Tutto deve funzionare in aereo, senza rete, su entrambi i dispositivi.**

Se una funzionalità richiede internet per funzionare, va riprogettata o rimandata.
Supabase è una destinazione di sincronizzazione, mai una dipendenza di avvio.
Nessuna schermata deve mostrare uno stato di caricamento in attesa della rete.

## Scadenza

L'app deve essere utilizzabile il **1 ottobre 2026**. Dal 2 ottobre al 23 novembre
l'utente è in viaggio con connettività assente o inaffidabile. Ciò che non è pronto
entro quella data non serve a nulla per quella finestra.

Priorità in caso di conflitto: **motore degli esercizi e apertura dei PDF > tutto il resto**.
Sincronizzazione, ripasso e statistiche possono aspettare.

## Invarianti architetturali — non modificare senza discuterne

1. **Il registro `eventi` è la fonte di verità.** Ogni scrittura passa da
   `registra()` in `lib/db.ts`, che inserisce l'evento e applica la proiezione
   nella stessa transazione. Non scrivere mai direttamente in una tabella
   operativa: romperebbe la sincronizzazione in modo silenzioso.

2. **Gli HLC non si sostituiscono con `Date.now()`.** I due dispositivi possono
   avere fusi orari diversi durante un viaggio. Vedi `lib/hlc.ts`.

3. **La verifica degli esercizi confronta i RISULTATI, non il testo delle query.**
   Vedi `lib/verifica.ts`. Una soluzione diversa da quella di riferimento ma
   corretta deve passare.

4. **`palestra.db` è in sola lettura.** Gli esercizi con `preparazione` girano su
   una copia temporanea, eliminata subito dopo.

5. **Il trasporto 3 (file cifrato) non deve mai dipendere da codice nostro per il
   trasferimento.** È la rete di sicurezza: lo esegue il sistema operativo.

6. **Nessuna esportazione in chiaro** dei pacchetti di sincronizzazione.

7. **Niente dati reali di MSF in questo sistema.** È uno strumento personale.
   Se un giorno toccasse dati di lavoro, cambierebbe l'intero regime di protezione.

8. **Nessun modulo nativo fuori dal catalogo Expo SDK 54.** Il lavoro si svolge
   interamente da cloud e da telefono: non esiste un PC, quindi non esiste `adb`.
   Un crash nativo chiuderebbe l'app senza lasciare alcuna traccia leggibile.
   Il lettore PDF interno usa `react-native-webview` (nel catalogo) con pdf.js
   incorporato in `assets/lettore/lettore.html`: JavaScript puro, nessun modulo
   nativo di terze parti. Se si aggiorna `pdfjs-dist`, rigenerare con
   `node strumenti/genera-lettore.mjs`: la verifica fallisce se non combaciano.
   Prima di aggiungere qualunque dipendenza, verifica che sia in
   `node_modules/expo/bundledNativeModules.json`. Se non c'è, non si aggiunge.

9. **La nuvola è un pari, non un servizio.** `lib/nuvola/` parla con Supabase
   via `fetch` su PostgREST e Storage: nessuna libreria, nessuna dipendenza
   (invariante 8). Viaggia lo stesso registro di eventi degli altri tre
   trasporti, con la stessa deduplicazione per id. L'app non legge mai le
   tabelle remote: legge il registro e proietta.
   - `lib/nuvola/proiezione.ts` applica gli eventi ricevuti con la connessione
     che riceve. Mai `registra()` o `inTransazione()` annidate lì dentro: si
     metterebbero in coda dietro quella che le contiene e nessuna delle due
     finirebbe più.
   - Gli eventi ricevuti non generano eventi nuovi.
   - `file_locale` è l'UNICA scrittura che di proposito non genera un evento:
     è un percorso di questo telefono e altrove non significa niente.
   - **I file grossi scendono da soli solo sul wifi, e allora tutti**: PDF
     della rassegna, manuali, podcast non ancora visti (`lib/nuvola/rete.ts`,
     expo-network). Sui dati mobili si scambiano solo gli eventi. All'arrivo
     del wifi parte un giro (`quandoArrivaIlWifi`), e i giri sono uno per
     volta: chi chiede durante un giro riceve quello.
   - **Un articolo letto lascia il testo e toglie il PDF** dal telefono
     (`lib/nuvola/letti.ts`), solo se il testo ha almeno 1000 caratteri; un
     PDF già letto non si riscarica. Aprire un articolo in Notizie lo segna
     letto.
   - **Il segnaposto della lettura è l'ora d'arrivo sul server**
     (`creato_a`, meta `nuvola_creato`), mai l'HLC: un evento può arrivare
     con un HLC più vecchio di uno già letto — la conduttura dà gli HLC
     mentre lavora e carica alla fine, il tablet senza rete carica al
     rientro — e con l'HLC come segnaposto non si leggeva più. La lettura
     dopo parte dall'ora del server (intestazione Date della prima pagina)
     meno dieci minuti (`MARGINE_MS`: `now()` è l'inizio della transazione,
     e un caricamento lento diventa visibile dopo uno svelto), i doppioni li
     scarta `fondi()`. Dall'ultimo arrivo invece che dall'ora, a riposo ogni
     scambio riscaricava l'ultimo lotto della conduttura. Una lettura che si
     ferma a metà riparte dall'ultimo arrivo senza margine: con il margine,
     più di 3000 eventi arrivati in dieci minuti la fermavano per sempre. Si
     legge a pagine da 100, perché ogni pagina arrivi entro il timeout. Le
     prove sono B4 e B12–B17 in `test/simulazione/nuvola.mjs`.
   - **La soglia non perde eventi finché reggono quattro condizioni**, e chi
     tocca Supabase deve tenerle: ogni transazione che scrive in `eventi`
     dura meno di dieci minuti (meno il tempo di una query); l'orologio
     dell'intestazione Date e quello di Postgres stanno entro pochi secondi
     (uno avanti di più non si vede dall'app); le letture vanno al
     primario, non a una replica in ritardo; `max_rows` di PostgREST non
     scende sotto 100 (Supabase: 1000), o ogni pagina sembra l'ultima. Da
     `eventi` non si cancella mai: lo spostamento delle pagine fa solo
     rileggere.
   - La chiave è una *publishable key* nel sorgente, di proposito: è la stessa
     che finisce nell'APK. Ciò che recinta i dati sono le policy RLS dello
     schema `percorso`, legate a un identificativo utente fisso. Su
     `percorso.eventi` DELETE non è concesso (`strumenti/db/008`): un
     evento si annulla con un evento «elimina», anche nelle prove. UPDATE
     invece sì, ancora: fino alla build 49 l'app manda gli eventi con
     merge-duplicates, che senza UPDATE viene rifiutato. Dalla build 50 app
     e conduttura usano ignore-duplicates (un evento non cambia mai), e
     quando telefono e tablet hanno la 50 si applica `strumenti/db/009`.
     Fino ad allora chi ha la chiave può riscrivere il contenuto degli
     eventi; con INSERT potrà sempre aggiungerne di falsi.

## La conduttura quotidiana

`.github/workflows/nuvola.yml` gira ogni mattina alle **08:00 locali**: Città
del Messico fino al 2 ottobre 2026, Roma da lì in poi. Tre cron UTC accesi e un
cancello con `zoneinfo` che ne lascia passare esattamente uno; il cambio d'ora
di Roma del 25 ottobre si sistema da sé. **Non contare le ore a mano in quel
file.**

Fa, in una corsa: catalogo delle nuove uscite → ricerca delle copie
accessibili → `strumenti/nuvola/pubblica.py`, che estrae il testo, deposita i
PDF nel bucket `biblioteca`, scrive le righe di `percorso.articoli` e
`percorso.biblioteca` e soprattutto gli **eventi**, che sono ciò che l'app
legge davvero.

Di un PDF si tiene anche il testo, estratto con `pypdf` (fissato in
`nuvola.yml`, unica libreria di terze parti della conduttura, facoltativa:
senza, tutto gira come prima e il rapporto lo scrive). Gli articoli arrivati
col solo PDF ricevono il testo poco per volta (`testi_dai_pdf`, 60 a corsa,
scritti DOPO la rassegna e 10 per invio, perché un rifiuto non tocchi la
rassegna del giorno) con un evento «aggiorna» che porta solo `testo`. I manuali della release
`biblioteca-…` salgono nel deposito sotto `manuale/BIB-xx.pdf` con un
«aggiorna» di `pdf_path`, `byte` e `sha256` (`manuali_aperti`): il telefono
li scarica al primo wifi.

`rassegna.yml` non ha più un cron: questo lo comprende. Condividono il gruppo
di concorrenza perché toccano lo stesso `stato.tar`.

Per caricare un PDF a mano senza l'app: lasciarlo cadere in
`biblioteca-manuale/`, con un `<nome>.json` accanto se servono titolo e autore
veri. Il push fa il resto, per la stessa strada di un PDF trovato dalla
rassegna.

### I feed RSS

Nella stessa corsa entrano i feed dichiarati in `percorso.fonti`
(`metodo` fra `'rss'` e `'sitemap'`, `attiva = true`, in ordine di `peso`
decrescente).
`strumenti/nuvola/feed.py` legge RSS 2.0, Atom e RDF con lo stesso lettore,
classifica le voci con la tassonomia della rassegna e le **innesta nel
catalogo** prima della deduplica: da lì in giù una voce RSS è una voce come le
altre, stessa deduplica per titolo, stessa estrazione del testo, stesso evento.
Non esiste una seconda strada, e non deve esistere: sarebbe una seconda
deduplica da tenere allineata alla prima.

**Il lessico parla quattro lingue, e l'inglese resta il riferimento.** I termini
italiani, spagnoli e francesi stanno nel blocco `ALTRE_LINGUE` di
`specializzazioni.py` e si fondono in **coda** alle liste inglesi: `scopri_fonti.py`
e `test_fonti.py` leggono `FUERTES[slug][:2]` e `[:4]` come parole con cui
interrogare iTunes e Hacker News, e quelle si interrogano in inglese. Chi
aggiunge termini li mette in quel blocco, non dentro `SPECIALIZZAZIONI`, e mai
in testa. Due regole: locuzioni e non parole singole, e nessuna stringa che
tolti gli accenti sia anche una parola comune di un'altra lingua — lo spagnolo
«red» diventa «red», che in inglese è un colore. Le prove che contano sono in
`verifica_rassegna.py`, in fondo: quindici testi veri che devono prendere un
tema e otto che non devono prenderne nessuno. La seconda metà non è decorativa —
un lessico che assegna un tema a tutto supererebbe la prima.

**`percorso.fonti.lingua` non dice in che lingua è una fonte.** È `NOT NULL`
con default `'en'`, e lo scouting ripete quel default su ogni candidata: contare
le fonti per lingua dà sempre «tutte inglesi», anche quando ne ha trovate in
italiano e in spagnolo. Per sapere se una fonte non inglese è entrata si guarda
`candidatas.csv` nel tarball di stato, non quella colonna. Ci sono cascato: ho
usato quel conteggio come prova che lo scouting non trovava fonti non inglesi,
e non era vero — le trovava, e cadevano su p3 e p7.

Prima di cambiare il lessico, misura lo scarto sulle voci vere invece di
fidarti: `stato.tar` sulla release `rassegna` porta `catalogo.json` con qualche
migliaio di voci già classificate. Si confrontano le assegnazioni prima e dopo,
e ogni cambio di tema si guarda a mano. L'ultima volta furono nove su 2637, e
otto erano correzioni.

Due filtri, che non vanno confusi. Il tema lo assegna `classifica()`: senza
tema la voce cade. Il rumore redazionale lo toglie `pubblica.py` con
`assets/contenuti/esclusioni_rassegna.json`, e serve proprio qui, perché un
comunicato stampa come «Acme announces the launch of a GDPR compliance
platform» un tema pieno ce l'ha. Gli archivi aperti ci passano già dentro in
`catalogo.setaccia()`; i feed no, e ne portano molto di più.

Tetti: dodici voci per fonte e un terzo del tempo che resta, mai più di sei
minuti. Sono lì perché un bollettino quotidiano riempirebbe da solo il tetto
degli ottanta articoli e perché i minuti tolti al feed sono minuti tolti
all'estrazione del testo — e un catalogo di titoli senza testo, in aereo, non
si legge. Una fonte che non risponde non ferma le altre: finisce fra i «non
riusciti» del rapporto.

**La trascrizione che l'autore pubblica viene prima della pagina.** Un
`<podcast:transcript>` nel feed è un file che l'editore ha messo online
apposta, con la sua licenza, e `testo_della_voce()` lo prova per primo: per un
podcast la pagina dell'episodio porta le note di trasmissione, mentre la
trascrizione è l'unica cosa che rende quell'ora *studiabile* senza rete — si
cerca dentro, si annota una frase, si rilegge un passaggio. L'audio da solo non
fa nessuna delle tre. Trascrizioni non se ne generano: costerebbero una chiave,
una quota e un servizio che un giorno risponde 429, e quel giorno si è in volo.
`estrattore.testo_da_trascrizione()` riconosce il formato dal CONTENUTO — VTT,
SRT, il JSON del Podcast Namespace, HTML, testo — perché un feed che dichiara
`text/html` e serve VTT esiste.

C'è una terza strada, stretta di proposito: **l'esplorazione**. Al massimo
cinque voci al giorno (`temi_config.ESPLORAZIONE_MAX_DIA`) che nessun tema ha
preso ma che sono articoli veri — almeno millecinquecento caratteri di testo,
oppure un segnale di genere come «lessons learned» o «post-mortem» — entrano
sotto lo slug `esplorazione`, che non è il diciottesimo tema: non sta in
`modello_temi`, non ha trimestre, e ha rilevanza zero apposta, così se il tetto
degli ottanta articoli taglia, taglia queste per prime. Un margine che ruba il
posto al programma di studio smette di essere un margine.

`'sitemap'` non è un secondo modo di leggere un feed: è ciò che resta quando un
sito che vale la pena leggere non ne ha uno. `url_feed` vale allora
`sitemap:https://sito/`, e `feed.scarica_fonte()` costruisce il feed dal sitemap
e dalle pagine vere con `consegna_code/fonti_core.py` — lo stesso codice che gira
nella verifica settimanale, perché due definizioni di «che cosa è un articolo»
divergerebbero al primo sito strano. Quella riga la scrive l'autoriparazione di
`verifica_fonti.py`, non la si compila a mano.

Per aggiungere una fonte basta una riga in `percorso.fonti`: `nome`,
`url_feed`, `categoria` (uno degli slug di `modello_temi`), `peso` fra 0 e 1.
La categoria non entra nella classificazione — sarebbe un'etichetta che si
classifica da sé — ma se il tema calcolato coincide, la rilevanza sale del 20%.
Per provare la lista prima di fidarsene:
`python3 strumenti/nuvola/diagnosi.py --fonti`, oppure l'avvio a mano di
`nuvola.yml` con `diagnosi: si`. Dice quali rispondono, quante voci portano e
quante di quelle prendono un tema: una fonte che risponde 200 e non porta
niente in biblioteca è un guasto quanto un 404, e si vede solo così.

### La verifica delle fonti (settimanale)

`.github/workflows/fonti.yml` gira il lunedì alle 04:00 UTC — prima di tutti e
tre i cron di `nuvola.yml`, qualunque sia il fuso di quella settimana — e il
primo del mese va anche a cercarne di nuove. Sta fuori dalla corsa quotidiana
perché scarica ogni feed, apre tre articoli per fonte per cercare il muro di
pagamento e legge le pagine dei termini: un'ora di rete, che dentro le 08:00
sarebbe una rassegna persa ogni mattina.

La lista la legge dalla **tabella**, non dal file: `--da-nuvola`.
`consegna_code/fonti_v4.sql` è la semenza, applicata una volta sola. Se la
verifica leggesse il file, le candidate che lo scouting propone ogni mese non
sarebbero mai verificate — resterebbero spente per sempre, e la lista
smetterebbe di migliorare senza che si veda.

`consegna_code/verifica_fonti.py` guarda e scrive un rapporto; non tocca la
base. Decide `programma_fonti.py`, e decide poco: con 0 e 2 applica, con 2
lancia anche lo scouting per i temi che `salud.md` marca ⚠️, con 3
**non scrive niente** — l'interruttore è scattato, l'ambiente è rotto, e
applicare quella lista spegnerebbe fonti sane — e al terzo 3 di fila avvisa.
Con 1 avvisa e basta.

Due cose senza le quali non funziona:

- **La cartella `lavoro-fonti/` deve sopravvivere fra una corsa e l'altra.**
  Viaggia in `stato-fonti.tar` sulla release `fonti`. Dentro ci sono
  `estado_verifica.json` e `programma_fonti.json`: senza, l'interruttore di
  crollo non ha con cosa confrontare e non scatta mai, cioè è una protezione
  che sembra esserci.
- **Si applica in una transazione sola**, con la funzione
  `percorso.applica_fonti(jsonb)` della migrazione 004. Venti PATCH di
  PostgREST sono venti transazioni: se la decima fallisce, la tabella resta
  come nessuno ha deciso. La funzione riceve dati, mai SQL.

**La licenza con cui una fonte è entrata si salva in `percorso.fonti.licenza`**
(migrazione 007), e non si ricalcola. YouTube e Mastodon si riconoscono
dall'indirizzo; un podcast no — lo riconosce la verifica dagli allegati `audio/`
o `video/` di almeno metà delle voci — e fra i podcast c'è chi dichiara una
licenza e chi no. `verifica_fonti.py` decide e scrive, `feed.solo_metadati()`
legge il prefisso «solo metadati», `pubblica.py` non estrae. Da un podcast
senza licenza restano titolo, descrizione, allegato e collegamento alla
trascrizione, ma non il testo della trascrizione. La descrizione si conserva
fino a 500 caratteri (`pubblica.SOMMARIO_SOLO_METADATI`, la misura che RSS
0.91 dava a un `<description>`); la classificazione legge quella intera. La regola dei podcast si
prova DOPO il rilevamento automatico, apposta: un podcast con Creative Commons
deve continuare a dare la sua trascrizione come testo.

Il primo del mese lo scouting propone fonti nuove, e le **inserisce spente**
con `percorso.proponi_fonti(jsonb)`. Accenderle non è cosa sua: lo decide la
verifica del lunedì dopo. È la gamba per cui la lista migliora da sola invece
di invecchiare.

Lo stesso passo si lancia a mano, con `scouting: tutti` sull'avvio manuale, e
allora guarda **tutti** i temi invece dei soli rimasti orfani — è il modo di
trovare i divulgatori di ogni argomento, su YouTube, nei podcast, su Mastodon.
Serve perché il cron mensile cade il primo del mese, cioè il giorno della
scadenza: le fonti trovate lì si accenderebbero il lunedì dopo, a viaggio
iniziato e senza rete per accorgersene. Ogni mese su tutti i temi sarebbe
invece un'ora di rete per ritrovare le stesse, e il cron resta stretto apposta.

**Non c'è nessun interruttore da girare a mano, ed è voluto.** Un permesso da
concedere è proprio la cosa che dal 2 ottobre lascerebbe il sistema fermo senza
che nessuno lo sappia: la rete non c'è, dal telefono non si aprono le Actions,
e una fonte morta resterebbe morta fino a novembre. A proteggere sono i due
interruttori, che misurano da soli se la corsa è credibile. `applica: no`
sull'avvio manuale serve solo a guardare senza toccare.

Setup fatto una volta sola, e già fatto: le migrazioni
`strumenti/db/004_fonti_sitemap_e_applica.sql` (il CHECK con `sitemap` e le due
funzioni) e `consegna_code/fonti_v4.sql` (le 57 fonti, tutte `attiva = false`).

### Se Supabase rifiuta

Prima cosa: `python3 strumenti/nuvola/diagnosi.py`, oppure l'avvio a mano di
`nuvola.yml` con `diagnosi: si` (mezzo minuto invece di tredici). Prova i
quattro permessi uno per uno e stampa stato, corpo e rimedio. I quattro stati
hanno quattro rimedi diversi e confonderli costa una corsa quotidiana:

| stato | significato | rimedio |
|---|---|---|
| 404 (`PGRST205`) | la tabella non è nella cache dello schema di PostgREST | `NOTIFY pgrst, 'reload schema'` |
| 406 (`PGRST106`) | lo schema non è fra quelli serviti | `ALTER ROLE authenticator SET pgrst.db_schemas = 'public, graphql_public, percorso'` poi `NOTIFY pgrst, 'reload config'` |
| 401 | la chiave è rifiutata | ruotarla con il segreto `SUPABASE_CHIAVE` |
| 403 | una policy RLS non lascia passare | la policy `solo_utente_fisso` dello schema |

È già successo: esporre lo schema non basta, perché il `reload config` da solo
non ricostruisce la cache. La prima corsa vera è morta lì, e il messaggio
diceva «la chiave non è più buona», che era falso.

Due verifiche girano **prima di qualunque scrittura**, e senza rete:
`strumenti/nuvola/verifica_nuvola.py` (confronta il payload degli eventi con lo
schema vero letto da `lib/db.ts`) e `strumenti/nuvola/prova_conduttura.py`
(alza un finto PostgREST in locale e ci fa passare l'intera `pubblica.py`).

## Convenzioni

- Identificatori, commenti e testo dell'interfaccia in italiano.
- Nessun framework CSS: stili inline di React Native. `nativewind` è stata
  deliberatamente rimossa perché dichiarata e mai usata.
- Layout adattivo con un solo punto di rottura: `useWindowDimensions()`, 600dp.
  Niente rami separati per telefono e tablet.
- Massimo cinque schede: Oggi, Studio, Libreria, Note, Notizie. Il resto sono
  schermate impilate. Profilo è impilato e si apre dal pulsante in alto in
  Oggi: si apre di rado (aggiornamento, accoppiamento, promemoria), mentre le
  Notizie ogni giorno. La rotta resta `/profilo`, e il collegamento
  `percorso://profilo` del test di fumo continua ad aprirla.
- **Tema nero.** I colori stanno solo in `lib/tema.ts` (`C`): nessun esadecimale
  nelle schermate. `Text`, `TextInput` e `ActivityIndicator` si importano da
  `components/Base`, mai da `react-native`: il testo predefinito di React Native
  è nero, su sfondo nero sparisce, e con React 19 `defaultProps` non lo corregge
  più. Il pulsante principale è chiaro (`C.primario`) e il testo sopra va messo
  a mano a `C.suPrimario`: è l'unico caso in cui il colore predefinito è
  sbagliato. Lo sfondo delle schermate lo danno `contentStyle` (pila) e
  `sceneStyle` (schede); quello della finestra, della barra di stato e dello
  splash sta in `app.json`. Lo splash ha bisogno di un'immagine
  (`assets/avvio/splash.png`, trasparente): configurato senza, prebuild
  cancella il logo predefinito ma lo stile continua a citarlo, e il build
  muore al collegamento delle risorse. `userInterfaceStyle: dark` resta inerte finché
  `expo-system-ui` non è installato (prebuild lo dice): i dialoghi di sistema
  seguono il tema del telefono.
- I commenti spiegano **perché**, non cosa. Se un commento descrive ciò che il
  codice già dice, va tolto.

## Il percorso di studio

Studio non è un elenco di strumenti: è il **percorso**. `lib/percorso.ts`
(logica pura) fa di ogni tema un'unità, nell'ordine del piano — trimestre, poi
l'ordine di `TEMI` in `lib/contenuti.ts` —, e dentro ogni unità i passi del
ciclo: leggere la fonte, esercitarsi, fissare i concetti con le schede,
applicarli a uno scenario, restare aggiornati con la rassegna. Un tema senza
materiale non è un'unità. **Si numerano solo le unità con verifiche**: un tema
con soli volumi o articoli è un'unità di sola lettura, al suo posto
nell'elenco ma senza numero, perché nasce e sparisce con ciò che la
conduttura porta ogni mattina e, contato, spostava i numeri di tutte le altre.

- **Si supera all'80%** (`SOGLIA_PERCENTO`) degli esercizi e delle schede, più
  uno scenario svolto (`SCENARI_RICHIESTI`), dove ci sono. Leggere e la rassegna
  non contano per chiudere un'unità: un volume che non è sul telefono, in aereo,
  bloccherebbe il percorso fino a novembre.
- **Il prossimo passo** (`prossimoPasso()`) è il primo passo non fatto della
  prima unità non superata; la lettura viene prima solo se il volume è sul
  telefono e mai aperto. Sta in cima a Oggi e a Studio
  (`components/ProssimoPasso.tsx`), e si ricalcola a ogni ritorno in primo piano.
- **I progetti in parallelo** (`progetti()` in `lib/percorso.ts`). Il piano
  propone un ordine, non lo impone: dall'unità si «Segue» qualunque tema con
  verifiche non ancora superato, anche più d'uno, e Oggi e Studio mostrano un riquadro per
  progetto, nell'ordine in cui si sono scelti. Superato il tema scelto, al suo
  posto arriva il successivo della stessa area (`pista` di `TEMI`, nomi in
  `AREE`), poi il primo rimasto indietro; mai due progetti sulla stessa unità.
  Senza temi seguiti, o con tutte le aree finite, torna il prossimo passo del
  piano. Il seguito si ricalcola dall'avanzamento a ogni lettura; Oggi,
  Studio e l'unità ricordano solo chi aveva quale seguito
  (`percorso.subentrate`), anche durante una ricaduta, e il ricordo vale
  come preferenza finché l'unità è libera: senza, superati due temi della
  stessa area in ordine inverso, un'unità passava da un progetto all'altro. Scelta e ricordo stanno nel kv-store del dispositivo
  (`lib/progetti.ts`), non nel registro: come l'avanzamento, sono per
  dispositivo.
- **L'avanzamento non ha eventi suoi.** `lib/avanzamento.ts` lo legge dalle
  tabelle che l'app scrive già (tentativi, ripasso, note, biblioteca, articoli):
  un secondo registro dell'avanzamento andrebbe tenuto allineato al primo.
- **Gli scenari si svolgono in Note.** L'unità crea la nota con consegna e
  rubrica e `origine_url = scenario:<id>`; lo scenario è svolto quando la nota
  non è più il modello con cui è nata. Se la nota esiste già, si riapre quella.
- Esercizi, Ripasso e Notizie accettano `?tema=`: dall'unità si arriva già
  filtrati. Senza parametro fanno quello che facevano prima. Notizie è una
  scheda: dall'unità ci si va con `dismissTo`, come a Note e Libreria.
- **Da una schermata impilata a una scheda si va con `router.dismissTo`**, mai
  con `navigate` o `push`. In expo-router 6 NAVIGATE riusa una schermata della
  pila solo se è quella corrente: dall'unità, `navigate("/note")` impila un
  SECONDO gruppo di schede, con un secondo editor delle note che può
  sovrascrivere il primo. `dismissTo` torna alle schede che esistono già. Il
  prezzo, accettato: dopo «Svolgi in Note» l'indietro porta a Oggi, non
  all'unità, che si riapre da Studio.
- **Note salva uno alla volta, per sessione di modifica.** Note salva uscendo
  in tre modi — perdita del fuoco, background, smontaggio — oltre ai
  pulsanti, e i salvataggi possono sovrapporsi. Aprire una nota o
  cominciarne una nuova apre una sessione; ogni salvataggio porta la
  sessione del disegno da cui parte, passa dalla `catena` (uno alla volta) e
  scrive nella nota di quella sessione, con l'id letto quando tocca a lui. Id
  e copia salvata si aggiornano solo a scrittura riuscita. Con l'id preso
  dallo stato `apertaId`, due salvataggi della stessa nota nuova creavano
  due note; con un ref «della nota aperta», un gestore rimasto indietro
  scriveva nella nota aperta dopo. Le prove sono F11–F12d in
  `test/simulazione/schermate-stato.mjs`.
- **L'avanzamento è per dispositivo, per ora.** Gli eventi dei tentativi
  portano solo `{esercizio_id, esito}` e quelli del ripasso `{grado,
  stabilita}`: sull'altro dispositivo un tentativo ricevuto resta incompleto
  (manca `eseguito_a`, NOT NULL) e il ripasso aggiorna solo `stabilita`. Anche
  `file_locale` viaggia nel payload della biblioteca, e su un secondo
  dispositivo un volume può risultare «sul telefono» senza esserci. Chiuderlo
  è la decisione aperta in DA-FARE (voce 17 e SYN-01: sincronizzare davvero o
  tenere i due dispositivi come due isole), non una correzione da fare di
  passaggio.
- Le prove sono in `test/simulazione/percorso.mjs`, sul codice vero e sui
  contenuti veri.

## Le notizie

La quinta scheda (`app/(tabs)/notizie.tsx`, logica in `lib/notizie.ts`) è la
rassegna letta come un giornale. Le categorie sono fisse e nello stesso
ordine: Per te, In primo piano, le sette aree di `AREE`, Esplorazione,
Salvati.

- **Le categorie sono le aree, non i trimestri.** Il trimestre di un
  articolo lo scrive la conduttura, e per cinque temi non coincide con
  quello del piano; l'area si ricava dal tema con `TEMI`. Un articolo senza
  tema, o con un tema che il piano non conosce, finisce in Esplorazione: mai
  fuori dall'elenco.
- **In primo piano** ha una sezione per area con la notizia principale e tre
  dopo; **Per te** le aree dei progetti (senza progetti, quella dell'unità del
  piano). L'area intera e non il tema, perché le parti di SQL la conduttura
  non le assegna mai.
- **Le date sono quelle del telefono.** «3 ore fa» solo se l'ora c'è: le date
  nude la conduttura le scrive come mezzanotte UTC, e diventano «oggi»,
  «ieri». L'ordine è per data d'uscita, perché tutti gli articoli di una
  corsa hanno lo stesso `raccolto_a`. `verifica.sh` esegue
  `test/simulazione/notizie.mjs` in UTC, a Città del Messico e a Roma: un
  giorno calcolato in UTC passa la prima e sbaglia la seconda.
- L'elenco non legge la colonna `testo`, che pesa: sa solo se c'è.

## Stato verificato al momento della consegna

| Verifica | Esito |
|---|---|
| `npm install` | 980 pacchetti, nessun conflitto bloccante |
| `npx tsc --noEmit` | 0 errori sull'intero progetto |
| `npm run verifica` | typecheck + test di logica, 256 del banco, le simulazioni (compresa `nuvola`) e il triage — tutto verde |
| `.github/test-firma.sh` | 10 scenari della chiave di firma, tutti superati |
| `npx expo config --type prebuild` | valido, SDK 54 |
| Versioni vs `bundledNativeModules` | 15 su 15 allineate |

La riga `npm run verifica` non porta più un numero fisso: i conteggi cambiano a
ogni sessione e un numero stantio in un documento è peggio di nessun numero —
si legge come una misura e non lo è. Il comando stampa i suoi totali.

**Eseguito qui:** `expo prebuild` (il plugin di firma modifica `build.gradle` come previsto;
Gradle collegherà `react-native-webview` e 16 moduli Expo). **Mai eseguito:** la
compilazione Gradle e l'app su un dispositivo: li farà per la prima volta GitHub Actions.

## Comandi

```bash
npm run verifica  # typecheck + 136 test di logica + 10 del lettore PDF
                  # + i banchi (256) e le nove simulazioni (1614), ~30 s in tutto
npx tsc --noEmit  # typecheck dell'intero progetto
npm start         # richiede un dev client già installato
npx expo prebuild --platform android
```

Esegui `npm run verifica` **prima di ogni commit**. Deve restare verde.

## Ambiente di lavoro

Sessioni cloud di Claude Code avviate dall'app mobile. Nessun PC. **GitHub
Actions fa da PC**: compila, firma, installa su un emulatore, legge logcat.

- **Il build non si fa qui.** Qui si scrive, si verifica e si fa push. Il push
  avvia `.github/workflows/apk.yml`: build release firmato, test di fumo su
  emulatore Android 14, pubblicazione dell'APK **solo se il test passa**.
- **I risultati arrivano nell'issue "Rapporti di build"**: esito di ogni fase ed
  estratto di logcat. Leggilo con gli strumenti GitHub integrati dopo ogni push.
  Un crash nativo lì è leggibile: è ciò che rende possibile lavorare senza adb.
- **Firma persistente, gestita dal workflow.** Al primo build si genera una chiave
  e la si conserva nella release privata `firma`. Senza secret, l'archivio è
  protetto dalla riservatezza del repository; se l'utente aggiunge il secret
  `PASSPHRASE_FIRMA`, il build successivo cifra LA STESSA chiave. Non se ne genera
  mai una nuova: con un'altra chiave gli aggiornamenti non si installano, e
  disinstallare cancella i dati. `.github/test-firma.sh` lo verifica a ogni push.
  **Non eliminare mai la release `firma` e non toccare quel passo del workflow.**
- **Il `versionCode` si calcola, non si scrive.** Sta in `app.config.js`: minuti
  interi dall'epoca, la stessa formula ovunque. NON è il numero della corsa, e
  legarcelo sarebbe un guasto irreversibile in tre modi — un APK compilato a
  mano uscirebbe con 1 e non si installerebbe sopra una build di CI, proprio
  quando la rete non c'è; rieseguire una corsa vecchia ne conserva il numero e
  produce un downgrade; rinominare `apk.yml` azzera il contatore e blocca ogni
  aggiornamento per sempre, con la CI verde. **Il versionCode non deve mai
  decrescere**: per tornare a una build precedente si ricompila quel commit,
  non si reinstalla il vecchio APK, e non si disinstalla mai. Il numero della
  corsa vive in `version` (cioè `versionName`, leggibile in Impostazioni → App
  anche ad app rotta) e in `extra`, da cui lo legge la riga in Profilo.
- **Gli aggiornamenti si installano dall'app.** `lib/aggiornamenti.ts` chiede a
  GitHub l'elenco delle release, prende la build di `main` con il numero di
  corsa più alto (le preliminari dei rami restano fuori), la confronta con
  `extra.corsa` e, se è più recente, la scarica e la consegna all'installatore
  di Android con un intent VIEW. Il riquadro sta in Profilo (Oggi → Profilo,
  in alto), e in Oggi compare solo quando c'è qualcosa da installare. Si controlla al massimo ogni sei
  ore, l'ultimo esito si ricorda senza rete, e un controllo fallito non fa
  dimenticare quello buono. Serve il permesso `REQUEST_INSTALL_PACKAGES` in
  `app.json`: senza, Android rifiuta in silenzio. La firma la verifica il
  sistema, quindi la regola della chiave unica vale anche qui.
- La biblioteca aperta si scarica con il workflow `biblioteca` (avvio manuale);
  il pacchetto che produce lo porta nel deposito la conduttura del mattino.
- I trasporti di sincronizzazione 1 e 2 richiedono moduli nativi propri: non in
  questa fase. Il trasporto 3 passa dal foglio di condivisione e da Quick Share,
  che fra due Android funziona senza internet a livello di sistema operativo.

**Mai indebolire un test per farlo passare.** Se il test di fumo fallisce, il
difetto è nell'app, non in `fumo.sh` né nei workflow.

## Cosa NON fare

- Non aggiungere dipendenze senza motivo esplicito, e mai moduli nativi fuori
  dal catalogo Expo (invariante 8).
- Non migrare all'API legacy di `expo-file-system`: il codice usa già le classi
  `File` / `Directory` / `Paths` della v19, che è la strada giusta.
- Non introdurre uno stato globale (Redux, Zustand, context grandi). Lo stato
  vive in SQLite, le schermate lo leggono.
- Non riscrivere moduli che hanno test verdi per migliorarne lo stile.
- Non "sistemare tutto" in una sessione. Un obiettivo per volta, verificato.

## Contenuti

`assets/contenuti/` contiene 381 item già verificati per esecuzione:
150 esercizi SQL, 20 moduli di lettura del codice, 199 flashcard con citazione,
12 scenari a rubrica, 52 voci di biblioteca aperta. **Non modificarli a mano**:
si rigenerano con gli script Python in `strumenti/contenuti/`.
