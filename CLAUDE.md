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
   - La chiave è una *publishable key* nel sorgente, di proposito: è la stessa
     che finisce nell'APK. Ciò che recinta i dati sono le policy RLS dello
     schema `percorso`, legate a un identificativo utente fisso.

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
- Massimo cinque schede. Il resto sono schermate impilate.
- I commenti spiegano **perché**, non cosa. Se un commento descrive ciò che il
  codice già dice, va tolto.

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
- La biblioteca aperta si scarica con il workflow `biblioteca` (avvio manuale).
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
