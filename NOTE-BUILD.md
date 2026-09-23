# NOTE-BUILD — prima sessione, 21 settembre 2026

Estrazione del progetto, APK firmato, test di fumo superato su emulatore
Android 14. Tredici build. Fino al quinto ogni fallimento aveva una causa
diversa dal precedente; dal sesto la stessa causa si ripete e non è nell'app.
Gli ultimi portano le correzioni trovate dal collaudo.

| Build | Esito | Causa del fallimento |
|---|---|---|
| 1 | fallito in 22 s | `actions/setup-java` non trovava file Gradle |
| 2 | fumo fallito | Android uccideva l'app in primo piano |
| 3 | fumo fallito | il lettore restava in attesa, senza errore |
| 4 | fumo fallito | il lettore andava in errore aprendo il documento |
| 5 | **riuscito** | — release `apk-5` pubblicata |
| 6 | fumo superato | `HTTP 403` creando la release |
| 7 | **annullato** | l'ho cancellato io: vedi sotto |
| 8 | fumo superato | `HTTP 403` creando la release, cinque volte |
| 9 | **riuscito** | — release `apk-9` pubblicata |
| 10 | **annullato** | l'ho cancellato io, di nuovo: un push su `lib/**` |
| 11 | **riuscito** | — release `apk-11`, con le correzioni del collaudo |
| 12 | fumo fallito, poi **riuscito** al secondo tentativo | l'emulatore, non l'app: vedi sotto — release `apk-12` |
| 13 | **riuscito** al primo tentativo | — release `apk-13`, con `NOT-07` corretto e le prove dentro `verifica.sh` |
| 14 | **annullato** | l'ho cancellato io, la terza volta con lo stesso meccanismo: un push mentre girava |
| 15 | **riuscito** | — release `apk-15`, con le dodici correzioni di `QRY` |
| 16 | **riuscito** | — release `apk-16`, il primo con la nuvola: schema v2, client `fetch`, proiezione, schermate nuove |
| 17 | **riuscito** | — release `apk-17`, con la diagnosi dei permessi. **È la build corrente**: i commit successivi toccano solo conduttura, prove e documenti |

Stato del test di fumo al build 13: schermata Oggi in **3 secondi**, tutte e
cinque le rotte percorse, lettore PDF che apre il documento di prova e ne conta
le **2 pagine in 2 secondi**, riavvio a freddo superato. Firma in modalità
**automatica**, impronta SHA-256
`CF:5C:B0:6D:24:F6:DE:44:AF:FC:4B:76:AD:09:17:41:A1:26:B3:29:20:6F:18:1E:27:B3:69:78:57:1C:C9:09`.

La schermata Oggi è passata da 6 secondi a 3. Non lo attribuisco alle
correzioni: è un campione solo, su un emulatore condiviso, e una spiegazione
plausibile — `caricaContenuti()` che ora passa da `inTransazione()` — resta
plausibile finché non è misurata su più corse.

**APK da installare: <https://github.com/stcportal00-star/Learning_app/releases/tag/apk-13>**
— `percorso-13.apk`, più le otto schermate del test di fumo. È la prima che
contiene tutti e tre i difetti critici corretti — `LIB-06`, `HLC-02`, `NOT-07`.
`apk-12` ha i primi due, `apk-11` e `apk-9` nessuno.

### Come si installa, sul telefono e sul tablet

Gli stessi passi sui due dispositivi: è lo stesso APK, ed è la stessa chiave di
firma, quindi il secondo dispositivo non è un caso a parte.

1. Sul dispositivo, apri la pagina della release qui sopra. Il repository è
   privato: serve essere entrati in GitHub con il tuo account, altrimenti il
   collegamento dà 404 e sembra un errore di indirizzo.
2. Tocca `percorso-13.apk` e scaricalo.
3. Apri il file scaricato (dalla notifica di download o da File → Download).
   Android chiede il permesso **«Installa app sconosciute»** per l'app da cui
   stai aprendo il file — browser o gestore file: concedilo a QUELLA app, una
   volta sola.
4. Installa. Al primo avvio l'app carica 381 contenuti nel database locale:
   sull'emulatore sono 3 secondi, sul telefono conta qualche secondo in più.
5. Se chiede il permesso per le notifiche, concedilo: servono ai promemoria
   dei blocchi di studio. Tutto il resto funziona anche senza.

**Gli aggiornamenti si installano sopra**, senza perdere niente, perché la
chiave di firma è sempre la stessa (è la ragione per cui la release privata
`firma` non va mai toccata). **Non disinstallare l'app per aggiornarla**:
disinstallare cancella il registro eventi, cioè tutto quello che hai fatto.

Per la biblioteca aperta: il workflow `biblioteca` (avvio manuale da Actions)
produce `biblioteca.zip`. Si scarica sul dispositivo, si estrae con l'app File,
poi nella scheda Libreria si tocca «Importa biblioteca» e si selezionano
INSIEME `manifesto.json` e i PDF.

### Il fumo del build 12 è fallito una volta, e non era l'app

Primo tentativo: «la schermata Oggi non è comparsa in 90 secondi». Secondo
tentativo, **sullo stesso identico APK** — il job scarica l'artefatto del
build, che non è stato ricompilato — Oggi in 3 secondi e tutto il resto
superato. Stessi byte, esito diverso: la differenza sta nel giro
dell'emulatore, che in quel tentativo aveva impiegato 63 secondi solo per il
boot.

Prima di rilanciare ho cercato un meccanismo nel mio diff, e non c'è:
`useAutoSync` è montato **solo** in `app/sync.tsx`, una schermata impilata che
il test di fumo non apre mai, quindi né l'hook né `assorbiRemoto()` girano
all'avvio; e di `LIB-06` il test tocca il disegno della libreria, non
`onLongPress`. In più `npx expo export --platform android` costruisce il
bundle senza errori. Il rilancio è servito a separare «il difetto è nell'app»
da «il runner era lento», non a sperare.

Due cose imparate, e valgono più del singolo esito:

- **l'estratto di logcat, in questo caso, non serviva a niente.** `fumo.sh`
  filtra con `grep -E "FATAL EXCEPTION|AndroidRuntime|ReactNativeJS|E/|$PACCHETTO"`
  e poi taglia con `tail -n 120`: le ultime 120 righe erano tutte il ciclo di
  `uiautomator dump` del test stesso, e le righe dell'app — se c'erano — sono
  finite fuori. Non ho toccato `fumo.sh`: è la regola di questa sessione, e la
  regola vale anche quando toccarlo mi farebbe comodo.
- **il messaggio non distingue due casi diversi.** Lo script cerca «Avvio non
  riuscito» solo DOPO aver visto Oggi, quindi un avvio andato in errore
  produce esattamente la stessa frase di un avvio lento. Chi legge quel
  messaggio non sa quale dei due sia successo.

Due build annullati, il 7 e il 10, li ho cancellati io nello stesso modo: un
push che tocca `app/ lib/ components/ assets/ plugins/ package.json app.json
metro.config.js` fa ripartire `apk`, e `cancel-in-progress` uccide quello in
corso. Chi lavora qui lo tenga presente, e sappia che il filtro `paths` guarda
l'unione dei file di TUTTI i commit di un push, non solo dell'ultimo.

---

## Risolto

### Il build non poteva partire — `30adcb6`

`actions/setup-java@v6` era configurato con `cache: gradle`, che costruisce la
chiave di cache dai file Gradle del repository. Ma `android/` è in
`.gitignore` e nasce da `npx expo prebuild`, sette passi più in basso nello
stesso job: al passo 4 quei file non possono esistere, su nessun commit.
`setup-java` tratta l'assenza come errore fatale.

Tolta la riga `cache: gradle`. È l'unica modifica a un workflow dell'intera
sessione, ed è stata fatta solo dopo aver accertato che nessun test fosse
fallito: 99 test e i 10 scenari di `test-firma.sh` erano verdi sullo stesso
commit. Costo: le dipendenze Gradle si riscaricano a ogni build.

### Play Services uccideva l'app in primo piano — `8133e5b`

L'estratto di logcat, tolto il rumore dei dump di uiautomator, conteneva una
sola riga causale — nessun `FATAL EXCEPTION`, nessun crash:

```
Killing org.alessiomirra.percorso (adj 0): depends on provider
  com.google.android.gms/.fonts.provider.FontsProvider
  in dying proc com.google.android.gms.persistent
```

`androidx.emoji2` registra `EmojiCompatInitializer` in `androidx.startup`, e
quello interroga Play Services per un font scaricabile all'avvio del processo.
Arriva per via transitiva da AppCompat. Quando il processo che ospita quel
provider muore, Android uccide i client legati a esso.

Non è una stranezza dell'emulatore: Play Services si aggiorna e riavvia da
solo anche sui dispositivi veri, e con quel binding l'app muore mentre la si
sta usando. Per un'app che deve funzionare senza rete e senza servizi Google è
un difetto architetturale.

Nuovo plugin `plugins/senza-gms.js`: toglie dal manifest la sola meta-data di
emoji2, con `tools:node="remove"` dentro un provider `tools:node="merge"`.
`androidx.startup` resta per tutti gli altri inizializzatori. Si perde
`EmojiCompat`: le emoji sono quelle del font di sistema, che su Android 8+ le
disegna già tutte.

### Il lettore restava in attesa — `84398d5`

`fumo.sh` cerca anche `"Impossibile aprire il PDF"` a ogni giro e non l'aveva
mai trovato: il visore non era andato in errore, si era fermato.

Il generatore passava il worker a `GlobalWorkerOptions.workerSrc`, e da lì
pdf.js costruisce `new Worker(blob, {type:"module"})`. Un Worker non parte da
un documento `file://`, e pdf.js resta in attesa del messaggio `test` che non
arriverà: non solleva, non rifiuta, aspetta.

Il modulo del worker termina con `globalThis.pdfjsWorker = {WorkerMessageHandler}`.
Importandolo sul thread principale, pdf.js trova quel gestore e non costruisce
alcun Worker. È la via che pdf.js prevede per gli ambienti senza worker.

### Il lettore non trovava un'API — `bf406d8`

Il guardiano e `console.error` aggiunti al punto precedente hanno prodotto la
causa per esteso invece del silenzio:

```
E ReactNativeJS: 'lettore:', 'Impossibile aprire il PDF:
  Promise.withResolvers is not a function (al passo "apertura del documento")'
```

`Promise.withResolvers` è ES2024, disponibile da Chrome 119. pdf.js 6 la chiama
in 41 punti, fra cui `MessageHandler.sendWithPromise`, che è il percorso di
ogni apertura. La build legacy porta core-js ma non questo riempitivo.

Non riguarda solo l'emulatore: sul telefono la WebView è quella che il Play
Store ha installato, e in due mesi senza rete non si aggiorna. Cinque righe,
esattamente il comportamento della specifica, prima del caricamento di pdf.js.

### Rassegna delle nuove pubblicazioni — `47845c9`, `9bc9e93`, `445596b`, `1192538`

Strumento richiesto durante la sessione: `strumenti/rassegna/` cataloga ogni
giorno le nuove uscite per specializzazione e cerca copie legalmente
accessibili. I `tema_slug` sono quelli di `assets/contenuti/biblioteca.json`,
e il manifesto prodotto ha la forma che `importaBiblioteca()` già legge.
Dettagli in `strumenti/rassegna/README.md`.

Tre adattatori erano respinti dagli archivi e sono stati corretti: DOAJ
(intervallo su `bibjson.year`, che è una stringa), arXiv (intestazione
`Accept` mancante), Zenodo (campo `access_right`, rimosso nel passaggio a
InvenioRDM). Il recapito per i polite pool è uscito dal sorgente e si dichiara
con `PERCORSO_CONTATTO`.

---

### Il `403` sulla pubblicazione era passeggero, e mi ero sbagliato a dire il contrario

`POST /repos/.../releases` ha risposto `403 Resource not accessible by
integration` per sette tentativi: il build 6, il suo riavvio, e cinque nel build
8 fra le 18:54 e le 19:01. Mi sono fermato, come dice la regola, e ho scritto
che **non** era una condizione passeggera.

Era sbagliato. Il build 9 ha pubblicato al **primo tentativo** alle 19:26:02,
con `apk.yml` invariato — stesso comando, stesso `--latest`, stesso token. Il
limite si è esaurito da solo in circa venticinque minuti. La lettura originale
era giusta; era la finestra di ritenti a essere corta, sette minuti e mezzo.

Cade anche l'esperimento che avevo indicato come prossimo: **`--latest` non
c'entra**, ha pubblicato con `--latest`. E *Workflow permissions* non andava
toccato: era corretto fin dall'inizio, come diceva il log di "Set up job".

Resta utile la traccia del ragionamento, perché l'errore è istruttivo: avevo
una differenza reale fra due chiamate (`--latest` contro `--prerelease`) e l'ho
scambiata per la causa. Una differenza osservata non è una causa finché non la
si prova, e qui la prova è arrivata da sola e diceva di no.

Ciò che resta accertato:

- il build 5 ha creato `apk-5` alle 16:39 **con lo stesso workflow, mai
  modificato in quel passo prima del fallimento**;
- il blocco `GITHUB_TOKEN Permissions` di "Set up job" è **identico** fra il
  build 5 (riuscito) e il build 6 (respinto): `Contents: write · Issues:
  write · Metadata: read`;
- alle **18:51:40**, tre minuti prima del primo 403, il workflow `biblioteca`
  ha **creato** la release `biblioteca-20260921` nello stesso repository con
  lo stesso tipo di token. Creare release funziona; da `apk.yml` no;
- il repository è privato su piano gratuito, quindi i *ruleset* non esistono:
  `GET /rulesets` risponde "Upgrade to GitHub Pro". Nessuna protezione dei tag
  può essere la causa;
- nella stessa corsa il job `rapporto` (`issues: write`) scrive senza problemi.

Con l'esito del build 9, la spiegazione più semplice è un limite secondario
legato alla sequenza di chiamate, non una differenza di permessi. Si esaurisce
da sé.

**Se ricapita**: l'APK resta comunque fra gli artefatti della corsa, e la
release si può rifare avviando `apk` a mano mezz'ora dopo. Il passo ritenta già
cinque volte in sette minuti e mezzo; allargare la finestra costerebbe minuti di
runner fermo, e la degradazione attuale — artefatto sempre presente, release
talvolta no — è accettabile.

---

## Aperto

### La biblioteca aperta non conteneva un solo PDF vero

Il conto "13 scaricati su 19" era falso. Lo scaricatore leggeva il
`Content-Type` e poi non lo guardava: l'unico controllo era `dimensione >
1024`, quindi una pagina di presentazione salvata con estensione `.pdf`
passava per un libro, entrava nel manifesto col suo sha256 e l'app la
importava. *Causal Inference: What If* erano 2,6 MB di HTML.

Col controllo sui primi cinque byte il conto vero è uscito: **0 su 19**.

Ricostruita con `strumenti/trova_pdf.py`, che chiede l'indirizzo alla pagina
che lo presenta invece di indovinarlo. Undici proposte verificate, otto
accettate dopo il confronto col titolo, tre respinte (una traduzione uzbeca, il
piano strategico OWASP al posto della Top 10, la CSF 1.1 al posto della 2.0).
Cinque voci senza alcun PDF pubblico sono passate a formato `html`, che è la
verità: si aprono nel browser e si stampano.

Conto onesto adesso: quattordici voci `pdf`, di cui **undici con indirizzo
verificato byte per byte**, tre ancora da risolvere; trentasei `html`, due
`hub`.

### arXiv risponde `406` e la causa non è nella richiesta — **fermato qui**

Otto varianti mandate da `strumenti/rassegna/diagnosi_arxiv.py`, una dimensione
per volta: `Accept` in quattro forme, User-Agent da browser, `Accept-Encoding:
gzip`, query minima, `max_results 2`, http invece di https. **Tutte e otto
respinte con 406**, corpo vuoto, nessun `Content-Type`, catena
`Via: 1.1 varnish` con tre nodi Fastly.

Quando cambiare qualunque dimensione della richiesta non cambia niente, la
richiesta non è la variabile. Resta la sola dimensione non verificabile da qui:
da dove si chiede. `fonti_aperte.arxiv` non si tocca — non c'è niente di
sbagliato da correggere, e OpenAlex indicizza comunque i preprint di arXiv.

Le altre fonti funzionano: **76 chiamate riuscite su 77** nella corsa delle
18:14, Zenodo compresa.

### Unpaywall era spenta in produzione

`unpaywall()` comincia con `if not CONTATTO: raise`, e `PERCORSO_CONTATTO` non
era impostato in nessun punto del workflow: in ogni corsa, su ogni voce con
DOI, la fonte principale non veniva interrogata. Il riepilogo mostrava
diciannove "senza via di accesso" su diciannove, che sembravano un esito.

Il workflow ora passa il recapito da un segreto, e l'assenza è dichiarata in
tre punti invece di tacere. **Per riaccenderla**: Impostazioni → Secrets and
variables → Actions → nuovo segreto `PERCORSO_CONTATTO`, un indirizzo di posta
raggiungibile. Serve a loro per avvisare chi interroga troppo.

### Ho cancellato io il build 7

Avevo trattenuto apposta il commit della biblioteca perché tocca `assets/**`.
Poi ho spinto il commit successivo e il push si è portato dietro anche quello:
`apk` è scattato e `cancel-in-progress` ha ucciso il build 7 dentro il passo di
pubblicazione. Ventisei minuti di runner persi, niente di irreversibile. Chi
lavora su questo repository tenga presente che un push di più commit fa
scattare i filtri `paths` sull'unione dei file di tutti i commit.

### pdf.js gira sul thread principale

È il compromesso accettato per far partire il lettore da `file://`. Su un
documento molto lungo l'interfaccia può scattare durante l'analisi. Da
riconsiderare solo se il problema si manifesta nell'uso reale: un lettore che
scatta è preferibile a un lettore che non apre.

### Mai provato su un dispositivo vero

Tutto ciò che è verificato lo è su emulatore. Restano fuori portata i guasti
legati all'hardware specifico, e la prova in modalità aereo per ventiquattro
ore su entrambi i dispositivi — che `HANDOFF.md` indica come il collaudo che
conta davvero.

### `sqlite_version()` non ancora letta

`HANDOFF.md` chiede di controllarla nella schermata Oggi: sotto 3.25 i 41
esercizi con window functions non sono eseguibili. Il test di fumo non la
legge; va guardata al primo avvio sul telefono.

---

---

## Collaudo in ambiente virtuale — 21 settembre 2026, sera

L'app aveva 146 test, tutti sui moduli puri: hlc, verifica, sync, sessioni,
promemoria. Tutto ciò che importa un modulo nativo — `lib/db.ts`, che è la fonte
di verità, e `lib/palestra.ts`, che è il motore degli esercizi — non era **mai
stato eseguito da nessun test**. Sono le due cose che `CLAUDE.md` dichiara a
priorità massima.

La mappa iniziale ha contato **337 interazioni possibili, 276 scoperte**.

### Il banco: far girare il codice vero senza dispositivo

Node 22 ha `node:sqlite` incorporato, quindi il doppio di `expo-sqlite` gira su
SQLite **vero**: le transazioni fanno davvero BEGIN/COMMIT e un ROLLBACK annulla
davvero. Un doppio compiacente avrebbe confermato gli invarianti senza
verificarli. `expo-file-system` sta su `node:fs`, `expo-crypto` su `node:crypto`;
picker, sharing, intent e notifiche tengono un giornale ispezionabile.

Nessuna dipendenza nuova: l'invariante 8 resta intatta.

Il banco si falsifica da sé, ed è la ragione per cui i suoi numeri valgono
qualcosa. Togliendo il `ROLLBACK` al doppio diventano rosse 18 verifiche su 63;
togliendo anche il `BEGIN`, 20. Se non ne diventasse rossa nessuna, le 63 verdi
sarebbero compiacenza e non prova.

### Le otto superfici

| superficie | esito |
|---|---|
| `registro-eventi` | 45 scenari · 264 verifiche · verde |
| `motore-sql` | 126 scenari · verde |
| `import-database` | 223 scenari · verde |
| `contenuti` | 59 scenari · 309 verifiche · verde |
| `ripasso-e-sessioni` | 67 scenari · verde |
| `schermate-stato` | 481 verifiche · verde |
| `sync-fusione` | 91 scenari · 350 verifiche · verde |
| `promemoria-notifiche` | 408 verifiche · verde |
| `coda-scritture` | 12 verifiche · verde (aggiunta con la correzione della coda) |

Un numero verde qui non vuol dire che l'app sia sana: vuol dire che lo scenario
fa quello che dice. Molti scenari **inchiodano** un difetto, cioè verificano che
ci sia.

Due misure rassicuranti, e vanno dette perché il resto di questa sezione è un
elenco di guasti: le **150 soluzioni di riferimento** degli esercizi SQL sono
state eseguite contro `palestra.db` e confrontate con `righe_attese` e
`colonne_attese` — zero divergenze su righe, nomi e ordine delle colonne. E
`sync-fusione` è verde su tutte e 91 le verifiche.

### Corretto: `palestra.db` non era in sola lettura — `f868318`

Il difetto peggiore trovato. `lib/palestra.ts` lo dichiarava in due commenti e
il codice non lo attuava: `UPDATE` e `DELETE` battuti nel campo risposta
venivano **eseguiti**, l'md5 del file cambiava, e da quel momento le soluzioni
di riferimento davano risultati diversi — ogni esercizio successivo incoerente.
Nessun avviso: l'app diceva «Non ancora» e registrava il tentativo come errato.

In aereo, senza rete e senza PC, bastava una riga di scrittura per curiosità o
per errore — o ricopiando il `CREATE INDEX` che la consegna stessa mostra — e
la palestra era rovinata per sempre. `apriPalestra()` ricopia solo se il file
manca, non fa `integrity_check` e non ha ripristino: l'unica uscita era
disinstallare, che cancella il registro eventi.

Corretto con `PRAGMA query_only = ON`, non con un filtro sul testo — che
violerebbe l'invariante 3 e si aggira — e non aprendo in sola lettura, che nel
`SQLiteOpenOptions` dell'SDK 54 **non esiste**. È SQLite a respingere, con
*attempt to write a readonly database*.

Confermato da tre revisori avversariali, nessuno dei quali è riuscito a
confutarlo; uno l'ha riprodotto da zero, 26 prove su 26.

### Corretto: l'unica chiamata non protetta in `verifica()` — `e36c869`

Scoperta di conseguenza. `verifica()` proteggeva con un `try` la soluzione di
riferimento e la risposta dell'utente, ma non `esegui(opzioni.preparazione)`.
Finché la palestra accettava ogni scrittura non falliva mai niente e non se ne
accorgeva nessuno; appena `query_only` ha cominciato a respingere, quel ramo è
passato da «non fa nulla» a «fa cadere la schermata». `app/esercizi.tsx` non lo
percorre, ma resta esportato.

Correggerne uno ne ha scoperto un altro: è il senso di collaudare.

### Corretto: l'invariante 1 si rompeva a due tocchi su Salva — `f890774`

`REG-06/REG-07`. Due `registra()` accavallate annidavano le transazioni: il
`ROLLBACK` della seconda annullava l'`INSERT` dell'evento della prima, che
proseguiva in autocommit e scriveva comunque la proiezione. Restava una riga
**senza il suo evento** — invisibile all'altro dispositivo, assente da una
ricostruzione dal registro. `app/(tabs)/note.tsx:127` non ha la guardia che
`app/esercizi.tsx:131` ha: due tocchi bastavano.

Avevo scritto qui che era da guardare con sospetto, perché il banco dichiara
la propria asincronia finta. I revisori hanno smontato il sospetto invece di
aggirarlo: scenari rifatti con `setTimeout(1)` — esito identico; verdetto letto
da una seconda connessione fuori dal doppio; una spia su `execSync` che ha
registrato l'ordine vero delle istruzioni. E il sorgente Android di
expo-sqlite: `CoroutineScope(Dispatchers.IO)`, nessun mutex per database. La
documentazione di expo lo dice da sola, sopra il metodo: *«This transaction is
not exclusive and can be interrupted by other async queries»*.

Corretto con una coda in `lib/db.ts`: una transazione per volta. Il primo
tentativo era incompleto — serializzare solo `registra()` non bastava, perché
`useAutoSync` e `contenuti` aprivano transazioni per conto loro. Ora
`inTransazione()` è l'unica porta.

### Corretto: «Rimuovi» cancellava per sempre un volume della biblioteca — `8fb942a`

`LIB-06`. La voce di catalogo di un volume della biblioteca aperta nasce una
volta sola, dentro `caricaContenuti()`, che al secondo avvio salta tutto perché
gli esercizi ci sono già; e «Importa biblioteca» **aggiorna** righe esistenti,
non le crea. `rimuoviVolume()` faceva `DELETE` su qualunque origine: il volume
non tornava più, nemmeno reimportando la release, e l'evento `elimina` portava
la perdita anche sull'altro dispositivo. Bastava una pressione lunga di troppo
su un volume mai scaricato.

Ora per l'origine `aperta` si cancella il file e si azzera `file_locale`: il
volume torna «non scaricato» e la prossima importazione lo ricollega.
`ultima_pagina` resta, perché è l'unica cosa che non si potrebbe ricostruire.
Un PDF aggiunto a mano invece esiste solo lì e se ne va con la sua riga. Nel
menu della pressione lunga la voce dice ora quello che fa — «Rimuovi il file
scaricato» — e su un volume mai scaricato non compare.

La conferma più bella non è mia: `import-database`, scritta da un'altra mano,
è diventata rossa **da sola** sulle due prove che inchiodavano il difetto
(`IMP-32`, `IMP-34`). Erano lì apposta per quel giorno.

### Corretto: l'orologio non assorbiva il tempo dei pacchetti ricevuti — `f8b141d`

`HLC-02`. `Orologio.ricevi()` era scritto, documentato e coperto da
`test/nucleo.test.ts`, e non lo chiamava nessuno. Dopo una fusione l'orologio
locale restava indietro, e la **prima** modifica scritta qui dopo lo scambio
nasceva con un HLC più basso di quello appena ricevuto: in «vince il più
recente» perdeva pur essendo successiva, senza un errore e senza un avviso.
È il caso per cui l'invariante 2 esiste: due dispositivi, due fusi, un viaggio.
Effetto collaterale, il riquadro di deriva oraria in Oggi era codice morto,
perché `derivaSospetta()` non si alzava mai.

`lib/db.ts` esporta ora `assorbiRemoto()`, dieci righe che passano da
`Orologio.ricevi()` e salvano `meta('hlc')` **dentro** `inTransazione()`;
`useAutoSync` la chiama come prima cosa del ramo `if (r.esito)`. Un hlc
illeggibile viene saltato e non assorbito: un `NaN` nell'orologio non ne
uscirebbe più. La trappola del trattino nell'identificativo di dispositivo si
è rivelata innocua qui: di un HLC remoto servono solo `ms` e contatore, e
l'identificativo che resta è sempre quello locale.

Anche qui la conferma viene da fuori: la controprova avversariale di un altro
agente ha la parte A **rossa in tutte e quattro le righe**, ed è il modo in cui
quel verbale annuncia che il difetto non c'è più. La sua parte C mostra ancora
il vecchio esito perché ricopia a mano `useAutoSync` com'era: misura quel
codice, non l'app. L'ho annotato nel file invece di riscriverlo — è il verbale
di una verifica fatta prima, e va letto per quello che era.

### Corretto: le modifiche a una nota sparivano da ogni via d'uscita — `cf42950`

`NOT-07`. Il testo di una nota non sta in nessuna tabella finché non si tocca
Salva, e ogni modo di lasciare l'editor lo buttava via senza dire niente:
«Nuova nota», «← Tutte le note», aprire un'altra nota dall'elenco, e
soprattutto il cambio di scheda o il tasto indietro di sistema, che smontano la
schermata senza passare da nessun pulsante. Per un'app il cui scopo dichiarato
è «una nota per sessione di lettura», era la perdita di dati più probabile di
tutte.

Ora si esce salvando, da tutte e quattro le vie. Per lo smontaggio il
salvataggio parte dalla pulizia dell'effetto: che nessuno ne veda più l'esito
non lo ferma, perché `registra()` vive nel livello dati e la sua transazione è
già in coda quando il componente non c'è più.

**Salvare invece di chiedere.** Una bozza in più si cancella con due tocchi, un
testo perso no; e un avviso da toccare, in un'app che si usa la sera con una
mano, è un pedaggio che si paga ogni volta per un caso che capita di rado.
Resta aperto `NOT-04`: il pulsante Salva riscrive anche senza modifiche.

### Ancora aperto: la sincronizzazione non mostra mai ciò che riceve

`SYN-01`, confermato, e per un'app su due dispositivi è grave.

`lib/sync/useAutoSync.ts:46-63` applica gli eventi ricevuti con un solo
`INSERT OR IGNORE INTO eventi … sincronizzato = 1`. **Nessuna proiezione**, né
dentro né dopo la transazione. E:

- `proietta()` (`lib/sync/fusione.ts:101`) ha **zero chiamanti** in tutto il
  progetto: esiste solo la sua definizione;
- `entitaToccate`, calcolato da `fondi()`, non viene **mai letto**;
- nessuna ricostruzione dal registro all'avvio — `app/_layout.tsx` fa `apri()`,
  `caricaContenuti()`, `apriPalestra()` e i promemoria;
- tutte le schermate leggono le tabelle operative, non `eventi`.

Quindi una nota scritta sul telefono arriva nel registro del tablet e **non
compare da nessuna parte**. La sincronizzazione dice di aver funzionato, e per
l'utente non cambia niente.

**Perché non l'ho corretto stanotte.** Le proiezioni non sono centralizzate:
sono closure che ognuno degli otto siti di chiamata passa a `registra()`. Far
proiettare la sincronizzazione richiede di centralizzarle — un refactoring, che
le regole di questa sessione vietano, su una funzionalità che questo stesso
documento e `CLAUDE.md` dichiarano rinviabile («Sincronizzazione, ripasso e
statistiche possono aspettare»), a nove giorni dalla scadenza. Correggerlo di
mia iniziativa la notte prima della consegna sarebbe stato il rischio sbagliato.

È la prima cosa da fare dopo il viaggio, o prima se si decide che i due
dispositivi devono davvero vedersi.

### Ancora aperto: il resto

Trentanove scenari del solo `motore-sql` inchiodano difetti non ancora
corretti, più altri sulle altre superfici.

**Correzione a quanto scrivevo qui prima.** Avevo messo `HLC-07` — `meta('hlc')`
illeggibile che rende l'orologio `NaN` per sempre — fra le cose aperte,
classificato «alto». Era un **candidato**, non un difetto, e la verifica
avversariale l'ha **confutato** due lenti su tre. Non c'è niente da correggere.
Insieme a lui sono caduti `SYN-02` e `REG-08`, anche quelli che avevo elencato
come reali. Le confutazioni valgono quanto le conferme, e un elenco di difetti
che non si accorcia mai è un elenco di cui non fidarsi.

### Confermati dalla verifica avversariale, non ancora corretti

Nessuno. I tre che erano correggibili senza refactoring — `HLC-02`
(`f8b141d`), `LIB-06` (`8fb942a`), `NOT-07` (`cf42950`) — sono corretti, con
le loro guardie e la falsificazione di ognuna. Resta `SYN-01`, aperto per la
ragione scritta sopra, che non è cambiata: correggerlo è un refactoring, e
questa sessione non ne fa.

Restano aperti anche i difetti minori inchiodati dalle simulazioni (`NOT-04`,
`LIB-02`, `LIB-05`, `LIB-07`, `LIB-08`, `CRO-02`, `SES-03`, `SCH-05` e gli
altri): nessuno di loro perde dati, e sono elencati scenario per scenario nelle
superfici, con il codice davanti.

### Mai contestati

`RO-03` e `QRY-03`: tutti e sei i revisori sono caduti con `API Error: 529
Overloaded`, e con loro la sintesi. Restano **candidati**. Sei agenti caduti per
un errore del server non sono una verifica, sono un buco, e vanno trattati così.

Le tre verifiche rosse di `promemoria-notifiche` che avevo segnalato **non sono
riproducibili** sul file committato: 408 su 408 con ogni fuso orario e con la
coda disattivata. Avevo misurato una versione che l'agente stava ancora
scrivendo — l'ho visto crescere da 832 a 1967 righe in quella finestra. Resta
inchiodato, come difetto cosmetico, che `fattoOggi` è calcolato una volta sola
al montaggio: cambiando tipo di blocco la frase «già registrato» resta quella
del tipo precedente.

### La trappola trovata dal collegare le prove alla verifica

Appena `prova-registro.mjs` è entrato in `verifica.sh` si è visto che non
finiva più, e la ragione è una conseguenza della correzione della coda che
nessuno aveva previsto: **una `registra()` annidata dentro la proiezione di
un'altra non fallisce più, si ferma.** La interna si mette in fila dietro
quella che la contiene, e quella sta aspettando proprio lei. La transazione
esterna resta aperta e da quel momento l'app non scrive più niente, senza un
errore e senza un messaggio. Prima della coda lo stesso annidamento falliva
subito, ed è quello che quel file verificava dal principio.

Non c'è una guardia da aggiungere: da dentro `lib/db.ts` una scrittura
annidata e una scrittura legittima partita altrove mentre la prima è in corso
hanno esattamente la stessa forma, e la seconda **deve** aspettare. C'è una
regola, ed è scritta nel commento della coda: la proiezione scrive con la
connessione che riceve e non apre mai una scrittura nuova. Oggi nessuno dei
nove punti di scrittura annida, e ora due prove lo verificano a ogni
`npm run verifica` — una misura il blocco in un processo a parte, l'altra
conta le parentesi dentro ogni `registra()` per accorgersi di un annidamento
nuovo il giorno in cui qualcuno lo scrive.

### Una cosa che vale più dei numeri

`promemoria-notifiche.mjs` è nato senza il blocco finale che stampa il riepilogo:
contava le verifiche e usciva `0` qualunque cosa accadesse. Era un test che non
poteva fallire. Appena l'agente ha aggiunto il riepilogo, il file ha fallito.

È lo stesso guasto della biblioteca — `dimensione > 1024` che approvava tredici
pagine HTML come libri — e della sola lettura dichiarata nei commenti e mai
attuata. Un controllo che non può dire di no non è un controllo debole: è
l'assenza di un controllo travestita da controllo.

---

## Conteggi

`npm run verifica`: typecheck a 0 errori, 92 test di logica e 10 del lettore.
I test del lettore sono passati da 7 a 10: tre guardie nuove impediscono che
una rigenerazione perda il riempitivo di `Promise.withResolvers`, riassegni
`workerSrc` o smetta di importare il worker sul thread principale. I due
conteggi dichiarati in `CLAUDE.md` sono stati aggiornati di conseguenza.

`strumenti/rassegna/verifica_rassegna.py`: 199 test, nessuna rete.
`strumenti/verifica_biblioteca.py`: 216 test, nessuna rete, eseguito da
`verifica.yml` a ogni push e da `biblioteca.yml` prima di scaricare.

`test/banco/`: 256 verifiche fra i tre banchi di prova.
`test/simulazione/`: nove superfici più il triage indipendente, 1614 verifiche
sul codice vero, tutte verdi.

**E da `da52897` sono dentro `verifica.sh`**, che era l'ultima lacuna di
processo: prima la verifica non toccava il codice vero sopra SQLite, ed è per
questo che due volte, in questa sessione, la coda delle scritture di
`lib/db.ts` ha potuto essere disattivata dentro il file senza che niente
diventasse rosso. Le guardie c'erano; nessuno le eseguiva. Trenta secondi in
tutto, e l'uscita è 1 alla prima rossa. Non si poteva farlo prima perché una
superficie era rossa per un difetto aperto, e una prova rossa per ragioni che
non sono regressioni smette di essere letta.

Mai modificati: `fumo.sh`, `test-firma.sh`, il passo della chiave di firma,
la release `firma`.


---

# La nuvola — 22/23 settembre 2026

Sessione a parte, con uno scopo diverso dalle altre: non correggere difetti ma
aggiungere la sola cosa che mancava perché l'app serva davvero durante il
viaggio — una rassegna che arriva da sola, e un posto dove ciò che si studia
non si perde.

## Cosa è stato costruito

Supabase come **quarto trasporto**, non come dipendenza. Viaggia lo stesso
registro di eventi degli altri tre, con la stessa deduplicazione per id; è un
pari che non dorme mai, e l'unico che può ricevere ciò che è stato raccolto
mentre il telefono era spento. Niente dipendenze nuove: PostgREST e Storage
sono due API HTTP e `fetch` c'è già.

La conduttura quotidiana gira su GitHub alle **08:00 locali** — Città del
Messico fino al 2 ottobre, Roma da lì in poi — estrae il TESTO degli articoli
prima di depositarli, carica i PDF nel deposito, e scrive gli **eventi**, che
sono ciò che l'app legge davvero.

## I cinque difetti trovati, in ordine di quanto sono costati

**1. Gli eventi ricevuti non venivano MAI proiettati** (SYN-01). Il registro
cresceva, le tabelle no: una nota scritta sul tablet arrivava sul telefono e
restava invisibile. Esisteva da prima di questa sessione e riguardava anche i
tre trasporti offline — cioè proprio quelli del viaggio. È il difetto più
grave dell'intera sessione, e sarebbe rimasto invisibile per sempre, perché
non produce nessun errore.

**2. La cache dello schema di PostgREST.** Esporre lo schema `percorso`
aggiorna la *configurazione* del servizio, non la sua *cache dello schema*:
ogni tabella rispondeva 404 mentre chiave e policy erano perfette. Il
messaggio dell'app diceva «la chiave non è più buona», che era falso e mandava
a controllare la cosa sbagliata. Da qui `diagnosi.py`, che prova i quattro
permessi uno per uno e di ognuno stampa stato, corpo e rimedio.

**3. `articoli.punteggio` ha un CHECK 0..100**, e ci scrivevo `rilevanza*100`:
370 su una voce da 3.7. Ottanta articoli preparati, cinquantasei col testo
intero, otto PDF già nel deposito — tutto perso sull'ultima scrittura. La
correzione successiva stava dentro il vincolo ma saturava, e dava 100 a tutte
e ottanta: un voto costante non ordina niente. Terza stesura, una curva che
non satura per costruzione.

**4. Diciassette articoli su ottanta erano doppioni.** Lo stesso articolo da
due archivi ha due chiavi diverse, e la setacciatura deduplica per chiave.

**5. Il difetto che non c'era.** Per un giorno intero `npm run verifica` è
stata verde la mattina e rossa la sera, e la diagnosi scritta in `DA-FARE.md`
accusava l'app: «un promemoria impostato di sera non riconosce il blocco già
fatto». Era falso. La simulazione fissa il fuso a Europe/Rome, dove fra le
22:00 e le 24:00 UTC è già domani; il blocco L3 registrava una sessione a «due
ore fa» chiamandola «di oggi». `giaFattoOggi()` rispondeva giusto.

## Cosa ha funzionato, come metodo

Ogni correzione falsificata, e **due falsificazioni hanno cambiato la
conclusione**: rimettere il ripristino rotto di `conFuso` lasciava la prova
verde, quindi non era la causa che avevo appena scritto; e la prima stesura
della guardia su `conFuso` passava anche col codice rotto, perché misurava lo
stato di partenza invece del ripristino.

Il difetto 3 è passato attraverso il finto PostgREST senza un fiato: **un
doppio che accetta ciò che il servizio rifiuta non è una prova, è un
permesso**. Ora fa rispettare i CHECK veri e risponde 400 col codice 23514.

Il giro completo contro il Supabase VERO (`test/rete/giro-vero.mjs`) gira a
ogni push: scrive una nota col codice dell'app, la manda su, cancella ogni
traccia locale, risincronizza, e pretende che torni — evento riscaricato,
deduplicato, proiettato.

## Cosa resta aperto

- **La PR non è stata unita**, e finché non lo è i cron non partono: GitHub
  esegue gli `schedule:` solo dal ramo predefinito, e `.github/workflows/` su
  `main` non esiste.
- **Il progetto Supabase ospita una seconda applicazione** senza rapporto con
  Percorso. La chiave publishable dell'APK è la chiave `anon` dell'intero
  progetto e raggiunge anche quella. È una decisione da prendere, non un
  difetto da correggere.
- **Ventiquattro articoli senza testo**: quelle fonti rispondono 403 a chi non
  è un browser. Unpaywall le coprirebbe, e aspetta il segreto
  `PERCORSO_CONTATTO`.
- **Le fonti dell'utente**: la tabella `fonti` è vuota.
