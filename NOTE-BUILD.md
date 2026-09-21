# NOTE-BUILD — prima sessione, 21 settembre 2026

Estrazione del progetto, APK firmato, test di fumo superato su emulatore
Android 14. Otto build. Fino al quinto ogni fallimento aveva una causa diversa
dal precedente; dal sesto la stessa causa si ripete e non è nell'app.

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

Stato del test di fumo al build 8: schermata Oggi in **6 secondi**, tutte e
cinque le rotte percorse, lettore PDF che apre il documento di prova e ne conta
le **2 pagine in 4 secondi**, riavvio a freddo superato. Firma in modalità
**automatica**, impronta SHA-256
`CF:5C:B0:6D:24:F6:DE:44:AF:FC:4B:76:AD:09:17:41:A1:26:B3:29:20:6F:18:1E:27:B3:69:78:57:1C:C9:09`.

L'APK del build 8 non è in una release ma fra gli artefatti della corsa:
<https://github.com/stcportal00-star/Learning_app/actions/runs/35638783313>
— 27,9 MB, scade il 5 ottobre 2026.

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

## Aperto

### La pubblicazione dell'APK è respinta con `HTTP 403` — **fermato qui**

`POST /repos/.../releases` risponde `403 Resource not accessible by
integration`. Cinque tentativi con attese crescenti fra 18:54 e 19:01, tutti
respinti. Prima ancora: il build 6 e il suo riavvio. Sette tentativi in tutto
sulla stessa causa, quindi mi sono fermato — è la regola della sessione.

Ciò che è accertato, non ipotizzato:

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

Le due chiamate differiscono per due sole opzioni: `apk.yml` usa `--latest`
(più `--repo` e `--target`), `biblioteca.yml` usa `--prerelease`. È l'unica
differenza rimasta fra un'operazione che riesce e una che fallisce, ed è
l'esperimento da fare per primo — una variabile sola. **Non l'ho fatto**: la
regola dice di fermarsi e riportare, e l'APK è comunque scaricabile.

Da controllare, nell'ordine: Impostazioni → Actions → General → Workflow
permissions ("Read and write"); poi se esiste un limite di spesa o una
restrizione sul repository.

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

## Conteggi

`npm run verifica`: typecheck a 0 errori, 92 test di logica e 10 del lettore.
I test del lettore sono passati da 7 a 10: tre guardie nuove impediscono che
una rigenerazione perda il riempitivo di `Promise.withResolvers`, riassegni
`workerSrc` o smetta di importare il worker sul thread principale. I due
conteggi dichiarati in `CLAUDE.md` sono stati aggiornati di conseguenza.

`strumenti/rassegna/verifica_rassegna.py`: 199 test, nessuna rete.
`strumenti/verifica_biblioteca.py`: 216 test, nessuna rete, eseguito da
`verifica.yml` a ogni push e da `biblioteca.yml` prima di scaricare.

Mai modificati: `fumo.sh`, `test-firma.sh`, il passo della chiave di firma,
la release `firma`.
