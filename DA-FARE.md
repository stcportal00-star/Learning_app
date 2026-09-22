# DA-FARE — inventario di cio' che manca

Stato al 22 settembre 2026, commit `b85ae50`, dopo il build 13 (`apk-13`).

Questo file esiste perche' non esisteva: l'elenco dei difetti aperti stava
sparso fra `NOTE-BUILD.md`, le nove superfici di simulazione e la testa di chi
aveva appena letto il codice. Chi conta con un criterio solo ne conta la meta'
(vedi la voce 61).

## Come e' stato fatto, e quanto vale

Sei agenti hanno letto in parallelo sei territori del repository — i difetti
inchiodati dalle simulazioni, i documenti di progetto, i contenuti e gli
strumenti Python, la verifica automatica, il codice senza rete di sicurezza, la
scadenza del 2 ottobre — con l'obbligo di allegare a ogni voce una **prova**:
file e riga, o il comando che la mostra. Ne sono uscite 260 voci grezze. Due
critiche avversariali le hanno poi contestate — una cercando cio' che l'elenco
non vedeva, l'altra smontando le voci gonfiate, doppie o gia' risolte — e una
sintesi le ha ridotte alle 90 che seguono.

**Quello che questo elenco NON e':** non e' una verifica. Le prove citate sono
vere, ma la gravita' e' un giudizio, e su un progetto di questa dimensione un
giudizio sbaglia. Tratta ogni voce come un candidato con una fonte, non come
una sentenza.

### Verificate a mano, una per una

Queste le ho ricontrollate io sul codice, perche' cambiano cosa conviene fare:

| Voce | Verifica | Esito |
|---|---|---|
| 1 | `lib/contenuti.ts:69-73` | **vera** — se `esercizi` ha righe, `caricaContenuti()` esce e non ricarica mai piu' |
| 82 | conteggio su `biblioteca.json` | **vera** — T1: 7 voci, tutte `html`, zero PDF |
| 12 | `AndroidManifest.xml:21` + `app.json` | **vera** — `android:allowBackup="true"`, nessuna regola di esclusione |
| 32 | `app.json` | **vera** — nessun `versionCode`: tutti i build sono 1 |
| 58 | `app.json` | **vera** — nessuna `icon`, nessuna `adaptiveIcon` |
| 7 | `package.json` vs `bundledNativeModules.json` | **vera** — `react-native-webview` e' l'unica con `^`, il catalogo la fissa a `13.15.0` |
| 10 | `grep url 'app/(tabs)/libreria.tsx'` | **vera** — zero occorrenze: 38 voci su 52 non si aprono |
| 11 | `app/codice.tsx:51-52` | **vera** — `restoCodice.slice(1)` scarta proprio la consegna |

### Superata

**Voce 70 (LSV-01)** e' gia' chiusa: la guardia `RO-01a` non e' piu' una regex
sul sorgente, interroga `PRAGMA query_only` sulla connessione vera
(`test/simulazione/motore-sql.mjs:778-780`). La lente che la segnala e'
anteriore alla correzione, e nessuno la esegue — che e' esattamente il rischio
descritto nella voce 63. Stessa sorte per una voce su `applicaComeUseAutoSync`,
scartata dalla critica: quella copia e' stata riallineata con `f8b141d`.

---

# Inventario definitivo — 22 settembre 2026

## Prima del 2 ottobre

1. **Il contenuto si congela al PRIMO avvio: dopo, nessuna correzione ai JSON raggiunge più il dispositivo**
Non esiste versione del contenuto né rinfresco: se `esercizi` ha righe, `caricaContenuti()` esce subito e i sette `INSERT OR IGNORE` non girano mai più. Costo: ogni correzione di contenuto (indirizzi PDF, consegne, flashcard, `ordine_rilevante`) deve essere dentro l'APK che installi la prima volta, o non arriverà mai. (`lib/contenuti.ts:69-73`, unico chiamante `app/_layout.tsx:26`)

2. **SYN-01 — la sincronizzazione scrive nel registro e non proietta: quello che arriva dall'altro dispositivo non compare da nessuna parte**
`useAutoSync` fa solo `INSERT OR IGNORE INTO eventi`; `proietta()` non ha un solo chiamante e `entitaToccate` non viene mai letto. Costo: telefono e tablet sono due isole, e lo scambio dichiara di aver funzionato. *Già deciso*: NOTE-BUILD.md:500-526 lo lascia aperto perché chiuderlo è un refactoring delle dieci scritture. (`lib/sync/useAutoSync.ts:60-69`; `lib/sync/fusione.ts:101`; `test/simulazione/sync-fusione.mjs:1641`)

3. **Il prezzo di ogni correzione: chiudere un difetto rende ROSSO `npm run verifica`**
Ogni scenario `difetto()` fallisce quando il comportamento cambia: ogni correzione richiede una seconda modifica obbligatoria nel file di prova. Costo: 160 scenari così nelle dieci superfici eseguite — è il numero che decide quante voci di questo elenco si chiudono davvero in nove giorni. (`test/simulazione/motore-sql.mjs:114-123`; `verifica.sh` con `set -e`; `grep -cE '^\s*difetto\(' test/simulazione/*.mjs` → 85 + 39 + 36)

4. **AVV-01 / AVV-02 — se `palestra.db` si corrompe, il motore degli esercizi non ha modo di ripartire**
`apriPalestra()` ricopia solo `if (!dest.exists)`: un file a zero byte apre un database vuoto, uno troncato solleva «malformed», e non esiste ricopia né `PRAGMA integrity_check`. Costo: in aereo l'unica uscita è disinstallare, che cancella il registro eventi. (`lib/palestra.ts:38-43`; `test/simulazione/motore-sql.mjs:698,701,706,709`)

5. **QRY-06 / QRY-07 / QRY-03a — `esegui()` deduce le colonne da `Object.keys(righe[0])`: i JOIN con colonne omonime perdono metà del risultato**
Due colonne con lo stesso nome collassano in una (sopravvive l'ultima), con zero righe dichiara zero colonne e la diagnosi parla di colonne invece che di righe. Costo: una risposta corretta può risultare errata e una sbagliata corretta — invariante 3, per 52 giorni l'unico giudizio che ricevi. (`lib/palestra.ts:75,99`; `test/simulazione/motore-sql.mjs:263,274,276,385,391,241,355,363`)

6. **QRY-16 — una query che non termina blocca il motore per sempre**
Nessun limite di tempo, nessun annullamento sull'esecuzione della risposta. Costo: nella prova il processo è stato ucciso dall'esterno dopo 4 s; sul telefono l'unico rimedio è la chiusura forzata dell'app. (`test/simulazione/motore-sql.mjs:744`)

7. **`react-native-webview` è l'unica dipendenza dichiarata con `^`, e nessuno controlla il catalogo Expo**
Il catalogo la fissa a `13.15.0` esatto, `package.json` accetta fino a `<14.0.0`; le altre 15 usano `~`. Nessuno script legge `bundledNativeModules.json`, quindi un `npm install` in una sessione cloud esce dal catalogo con typecheck e 1616 verifiche verdi, e il guasto compare come crash nativo sul dispositivo — invariante 8. (`package.json:33` contro `:15-32`; `node_modules/expo/bundledNativeModules.json` → `13.15.0`)

8. **Il lettore marca una pagina come disegnata PRIMA di disegnarla e non intercetta mai un errore di render**
`disegna(i)` fa `disegnate.set(i, null)` prima di `await p.render(...)`, senza try/catch, ed è chiamata senza `await` né `catch`. Costo: una pagina che fallisce resta bianca per sempre, ogni passaggio successivo esce subito e nessun messaggio arriva a React Native; il guardiano dei 20 s è già stato azzerato. (`strumenti/genera-lettore.mjs:112-114,124,140,106-107`)

9. **Il lettore non ha alcun tetto alla risoluzione dei canvas e ne tiene vivi fino a tredici**
Scala = `clientWidth × devicePixelRatio ÷ larghezza pagina`, senza massimo; `libera()` misura la finestra in pagine (±6), non in byte. Costo: su un tablet 1200 dp a dpr 2 una A4 è ~32 MB di bitmap, tredici fanno ~400 MB — e il lettore in tutta la sua vita ha aperto un solo PDF da 876 byte. (`strumenti/genera-lettore.mjs:175,121-127,129-133`)

10. **Trentotto voci di biblioteca su 52 non si aprono dall'app, e il messaggio dice il falso**
Le 36 `html` e le 2 `hub` hanno un indirizzo nel catalogo, ma la schermata non legge mai il campo `url`. Costo: tocchi una scheda dopo l'altra e leggi sempre «Importa la biblioteca dalla release di GitHub», che per quelle voci non sarà mai vero. (`grep -n "url" 'app/(tabs)/libreria.tsx'` → nessun risultato; `app/(tabs)/libreria.tsx:78-80`)

11. **CDC-02 — su tutti e 20 i moduli di lettura del codice la consegna non arriva mai a schermo**
`split("\n\n")` tiene solo il primo blocco e l'ultimo: la domanda, che sta in mezzo, sparisce. Costo: uno dei cinque tipi di contenuto parte dimezzato; è una riga. (`app/codice.tsx:51-52`; `lib/contenuti.ts:106`; `test/simulazione/contenuti.mjs:1138`)

12. **`android:allowBackup="true"` senza regole di esclusione: il registro eventi e il segreto di accoppiamento finiscono nel backup di Google**
Nessun `dataExtractionRules` né `fullBackupContent`, e `app.json` non imposta nulla: Auto Backup copia `files/SQLite/`, cioè `percorso.db` e il kv-store con il segreto da 160 bit da cui si deriva la chiave AES. Costo: esce in chiaro la chiave che apre i pacchetti, e sopra i 25 MB (i PDF) il backup smette in silenzio. (`android/app/src/main/AndroidManifest.xml:25`; `app.json` blocco android; `lib/sync/stato.ts:17`, `lib/sync/accoppiamento.ts:109-111`)

13. **Manca `SCHEDULE_EXACT_ALARM`: da Android 12 il promemoria quotidiano è programmato come sveglia INESATTA**
`expo-notifications` interroga `canScheduleExactAlarms()`, che risponde false senza quel permesso, e ricade su `setAndAllowWhileIdle`. Costo: in Doze la notifica delle 20:30 può slittare di minuti o ore, e le 408 verifiche girano su un doppio che non può vederlo. (`grep -o 'SCHEDULE_EXACT_ALARM\|USE_EXACT_ALARM'` su `app.json` e sul manifest → nessun risultato; `node_modules/expo-notifications/.../ExpoSchedulingDelegate.kt:105-121`; `lib/notifiche.ts:80-88`)

14. **La sincronizzazione automatica non può riuscire finché mancano i moduli nativi, e non lo dice a schermo**
In catena automatica ci sono solo prossimità e wi-fi, entrambi «non disponibile»; `TrasportoFile` entra solo se forzato dal pulsante. Costo: `r.esito` è null a ogni giro, il backoff sale a 30 minuti e il riquadro di divergenza di Oggi resta acceso senza spiegare perché. (`lib/sync/useAutoSync.ts:35-40`; `lib/sync/vicinanza.ts:211-213`, `lib/sync/wifi.ts:127-133`; `lib/sync/auto.ts:41-44`)

15. **La sincronizzazione invia al massimo 500 eventi per scambio, non ripete il giro e non dice quanti ne restano**
`daSincronizzare()` ha il limite predefinito a 500 e `useAutoSync` lo chiama senza argomento, senza ciclo. Costo: dopo settimane in aereo uno scambio ne porta 500, marca quei 500, dichiara «riuscito», e l'indicatore di divergenza è solo temporale — i dispositivi risultano allineati con un migliaio di eventi fermi. (`lib/db.ts:287`; `lib/sync/useAutoSync.ts:33,70`; `lib/sync/auto.ts:100-137`)

16. **SCH-01 / SYN-04 — eventi marcati come inviati che nessuno ha ricevuto, e non torneranno mai in coda**
Dimenticando l'accoppiamento il marcatore «inviato» non viene azzerato; e annullando il selettore di file lo scambio restituisce un esito valido con zero ricevuti, da cui `segnaSincronizzati` marca tutto. Costo: divergenza permanente e silenziosa in entrambi i casi. (`test/simulazione/schermate-stato.mjs:3380`; `lib/sync/file.ts:52` con `lib/sync/useAutoSync.ts:70,72`; `test/simulazione/sync-fusione.mjs:1667`)

17. **Il percorso assoluto del file locale viaggia dentro il payload degli eventi di biblioteca**
`file_locale` è un URI `file:///data/user/0/...`, sintatticamente valido anche sull'altro dispositivo dove il file non esiste. Costo: è una decisione sulla FORMA del dato da prendere PRIMA di chiudere SYN-01, altrimenti il tablet si riempie di righe che l'elenco mostra come disponibili offline. (`lib/palestra.ts:167,231,350`; `lib/sync/fusione.ts:101`)

18. **Il codice di accoppiamento non ha nessun controllo di lunghezza: circa il 3% dei codici sbagliati viene accettato**
Il codice generato è sempre 33 caratteri, ma `leggiAccoppiamento` accetta qualunque stringa ≥ 2 e verifica solo un carattere di controllo su 32; il pulsante si abilita a 4. Costo: l'Alert dice «i due dispositivi ora condividono la stessa chiave», poi ogni scambio fallisce alla decifratura parlando di pacchetto manomesso, e l'unica uscita è «Dimentica l'accoppiamento» (voce 16). (`lib/sync/accoppiamento.ts:17,94,97`; `app/sync.tsx:81`)

19. **CRO-03b / SES-03 — il blocco cronometrato si perde se la scrittura fallisce, e non si può reinserire a mano**
La chiave `cronometro_attivo` viene rimossa (riga 46) prima della scrittura della sessione (riga 56), senza try/catch; con un tipo di blocco non riconosciuto `chiudiSessione()` restituisce minuti `undefined` e l'INSERT cade sul NOT NULL. Costo: il blocco svanisce senza avviso e l'app non ha nessuna schermata per inserire una sessione a mano. Basta invertire i due passi. (`components/Cronometro.tsx:46,56`; `test/simulazione/schermate-stato.mjs:3617,3593`)

20. **Nessuna schermata regge un doppio tocco: sono due guardie di rientranza, una sui pulsanti che scrivono e una sulla navigazione**
Oggi: due sessioni registrate, due eventi di ripasso con una scheda saltata, un modulo di codice saltato senza essere mostrato, due notifiche quotidiane in coda, due lettori impilati, due selettori di file, due note. Costo: l'app si usa la sera con una mano — quattordici manifestazioni per due `useRef`. (`test/simulazione/schermate-stato.mjs:3572,2615,2434,3073-3074,1264,1255,1636,1032,1810,2091,2120,3362`)

21. **Cinque schermate confondono «sto caricando» con «non c'è niente»**
`if (!x) return <Vuoto/>` senza flag di caricamento, in Libreria, Esercizi, Codice, Ripasso. Costo: al primo disegno leggi «Nessuna scheda da ripassare» con 199 scadute e «Hai risolto tutto quello che era rimasto aperto» con 148 aperti — e quando è davvero finito lo schermo è identico. Un `useState(true)` per schermata. (`app/(tabs)/libreria.tsx:69-74`; `app/esercizi.tsx:82-91`; `app/codice.tsx:42-49`; `app/ripasso.tsx:32-36`; `test/simulazione/schermate-stato.mjs:1204,2009,2185,2332,2575`)

22. **RIP-04 — il ripasso si ferma a 30 schede e annuncia che non ce n'è più**
La coda è `LIMIT 30`, non viene mai ricaricata e, esaurita, ricade sul testo dello stato vuoto. Costo: al primo avvio tutte e 199 le flashcard sono scadute; ne fai 30, leggi che hai finito, e 169 restano ferme per settimane. (`app/ripasso.tsx:26`; `lib/contenuti.ts:139-142`; `test/simulazione/schermate-stato.mjs:2667`)

23. **OGG-05 / STU-02 / PRF-02 — i contatori di Oggi, Studio e Profilo restano fermi fino al riavvio dell'app**
`useEffect` al montaggio, nessun `useFocusEffect`. Costo: risolto un esercizio i numeri non cambiano — ed è l'unico riscontro quotidiano che hai in viaggio. Il meccanismo esiste già e non è collegato al focus: `setVersione` di Oggi. (`app/(tabs)/oggi.tsx:15,17,61`; `app/(tabs)/studio.tsx:12`; `test/simulazione/schermate-stato.mjs:908,1043,1816`)

24. **LET-04 — uscendo entro 1,5 secondi dal cambio pagina la posizione non viene salvata**
Il salvataggio è rinviato con un `setTimeout` e la pulizia fa solo `clearTimeout`, senza svuotare il rinvio allo smontaggio. Costo: su un libro di centinaia di pagine letto ogni sera per 52 giorni, il segno si perde regolarmente; è già stato fatto per le note. (`app/lettore.tsx:63-64,46`; `test/simulazione/schermate-stato.mjs:2833`)

25. **L'importazione dei PDF non guarda i primi byte: entra qualunque cosa**
Un database SQLite, un file a zero byte, sette byte di rumore, un PDF troncato, una pagina HTML rinominata: tutti copiati, registrati ed elencati come volumi, con il formato dedotto dall'estensione. Costo: l'errore emerge solo quando provi ad aprire il libro, in viaggio. Una riga `%PDF-` prima di copiare, come già fatto per lo scaricatore. (`lib/palestra.ts:152-154`; `test/simulazione/import-database.mjs:427,433,452,485,500,523,549`; NOTE-BUILD.md:246-256)

26. **La cartella biblioteca accumula file che nessuna riga nomina e nessuna funzione dell'app cancella**
Copia interrotta, transazione fallita dopo la copia, manifesto non iterabile, nome con maiuscole diverse, voce difettosa che interrompe il ciclo: ogni caso lascia un orfano, e `importaBiblioteca()` non ha alcun try/catch che restituisca il conteggio parziale. Costo: in sette settimane senza PC lo spazio si consuma e dal telefono non c'è rimedio. (`test/simulazione/import-database.mjs:716,770,941,1082,1118,1156,1179,1403`)

27. **IMP-35 / LIB-05 — `apriVolume()` risponde «nessun_visore» e la schermata non lo dice**
`onPress: () => { void apriVolume(item); }`: l'esito non viene letto. Costo: tocchi «Apri con il visore del sistema» e non succede assolutamente nulla — ed è l'apertura dei PDF, priorità massima. Una riga. (`app/(tabs)/libreria.tsx:84`; `test/simulazione/import-database.mjs:1308`; `test/simulazione/schermate-stato.mjs:1275`)

28. **Il test di fumo non installa mai un APK nuovo sopra uno vecchio**
Gira su emulatore nuovo a ogni corsa: `adb install -r` è sempre una prima installazione, e il «riavvio a freddo» prova lo stesso APK. Costo: l'operazione che le istruzioni raccomandano con più insistenza — installare sopra senza disinstallare — non è mai stata eseguita, né su dispositivo né in CI. Due righe: installare due volte con dati scritti in mezzo. (`.github/fumo.sh:34,85-93`; `.github/workflows/apk.yml:186-196`)

29. **Il cancello di logcat cerca solo `FATAL EXCEPTION`: un ANR passa il test di fumo e non arriva nemmeno nel rapporto**
Un ANR non è un'eccezione fatale: il processo resta vivo, `vivo` resta vero, il test stampa SUPERATO, e l'estratto allegato all'issue è solo le ultime 40 righe ReactNativeJS. Costo: l'ANR è proprio il modo in cui questa app fallirà — pdf.js sul thread principale, copie da 2 MB sincrone, 654 righe in una sola transazione al primo avvio. (`.github/fumo.sh:95-98`; `lib/palestra.ts:41,91`; `lib/contenuti.ts:83-152`)

30. **Quattro schermate su nove non vengono mai aperte da nessun controllo, né in CI né in locale**
`fumo.sh` percorre studio, libreria, note, profilo, esercizi e il lettore: restano fuori `codice`, `ripasso`, `promemoria` e `sync` — l'unica che monta `useAutoSync` e l'unica che tocca i permessi delle notifiche. Costo: un crash all'apertura di /ripasso si manifesterebbe per la prima volta in viaggio, senza PC e senza logcat. (`.github/fumo.sh:55,66`; `app/sync.tsx:18`; `app/promemoria.tsx:42-51`)

31. **RAD-03 — se l'avvio fallisce, la schermata di errore non offre nulla da toccare**
Due soli `<Text>`, nessun pulsante «Riprova», e l'errore passa da `String(e)` quindi un oggetto senza `toString` utile diventa `[object Object]`. Costo: in aereo quella schermata è il capolinea. (`app/_layout.tsx:40,45-51`; `test/simulazione/schermate-stato.mjs:676,685`)

32. **Tutti e tredici i build hanno `versionCode 1` e l'app non mostra da nessuna parte quale build sta girando**
`app.json` non dichiara `android.versionCode` e nessun passo del workflow lo modifica; `expo prebuild --clean` rigenera sempre 1. Costo: dal telefono non hai modo di sapere se `percorso-13.apk` è davvero entrato né se telefono e tablet girano lo stesso codice — con la regola «mai disinstallare» e una sincronizzazione che presuppone due dispositivi allineati. Il riquadro diagnostico di Oggi esiste già: manca la riga. (`app.json:5`; `android/app/build.gradle:104-105`; `app/(tabs)/oggi.tsx:72-78`)

33. **Nulla cancella la cache: ogni «Sincronizza adesso» e ogni PDF importato ci lasciano una copia**
Il pacchetto `.pcs` ha `Date.now()` nel nome e non si sovrascrive mai; i tre selettori usano `copyToCacheDirectory: true`, quindi importare la biblioteca scrive ogni PDF due volte. Costo: secondo accumulo, indipendente dagli orfani di biblioteca, che il sistema recupera solo quando lo spazio è già finito. (`lib/sync/file.ts:34`; `app/codice.tsx:56`; `lib/palestra.ts:143,202`; `grep -rn "\.delete()" app lib components` → solo `lib/palestra.ts:103,220,297,345`)

34. **RO-03 / RO-03c — `ATTACH DATABASE` battuto nel campo risposta riesce, e resta attaccato per tutte le verifiche successive**
La connessione della palestra è una variabile di modulo e `query_only` non ferma l'ATTACH. Costo: limitato alla lettura — `query_only` vale su ogni database della connessione, anche attaccato (RO-03b è verde su questo) — ma un esercizio legge i dati di un altro database e ce li ritrova al successivo. Serve DETACH o il divieto. (`lib/palestra.ts:47`; `test/simulazione/motore-sql.mjs:845,851-854,856`)

35. **REG-08 — se la riga di ripasso non esiste l'UPDATE non tocca nulla ma l'evento viene scritto lo stesso**
Nessuna verifica che la proiezione abbia toccato una riga. Costo: registro e stato divergono, cioè l'invariante 1. Lo stesso schema in IMP-23/24, dove un codice assente dal catalogo viene contato fra i «collegati» e l'evento si propaga all'altro dispositivo. (`test/simulazione/schermate-stato.mjs:2624`; `test/simulazione/import-database.mjs:1014,1019`)

36. **PRE-02 / PRE-04 — copie temporanee della palestra orfane sul disco, e collisione fra due esecuzioni nello stesso millisecondo**
La copia e l'apertura stanno fuori dal `try`, non c'è `finally` che cancelli, non c'è pulizia all'avvio, e il nome usa solo il millisecondo. Costo: 2 MB orfani per ogni apertura fallita, che sopravvivono a ogni riapertura; e due esecuzioni concorrenti falliscono con `FileAlreadyExistsException`. (`test/simulazione/motore-sql.mjs:716,719,639`)

37. **PRM-01 — durante il caricamento la schermata Promemoria è completamente bianca: niente indicatore, niente tasto indietro**
Costo: se la lettura è lenta sei su uno schermo bianco senza via d'uscita visibile — ed è l'unica schermata che tocca i permessi delle notifiche. (`test/simulazione/schermate-stato.mjs:3000`)

38. **ESE-07 — risolto l'ultimo esercizio della coda, «Avanti» non avanza e la scheda si svuota a ogni tocco**
`Math.min(i + 1, coda.length - 1)` inchioda l'indice sull'ultimo elemento invece di passare allo stato «finito». Costo: la coda non si chiude da dentro — uscendo e rientrando si ricostruisce — ma la risposta scritta viene cancellata a ogni tocco senza nessun messaggio. (`test/simulazione/schermate-stato.mjs:2148,2151`; `app/esercizi.tsx:27-42`)

39. **COD-06b — uscendo dalla fase confronto senza verdetto si perdono l'ipotesi scritta e il tempo impiegato**
Nessun salvataggio della bozza allo smontaggio, come si è invece scelto di fare per le note (NOT-07). Costo: al rimontaggio fase «ipotesi» e campo vuoto, nessun tentativo registrato. (`test/simulazione/schermate-stato.mjs:2448`)

40. **CRO-02 — un valore corrotto in `cronometro_attivo` blocca il cronometro e non viene mai ripulito**
L'effetto rigetta, il cronometro resta sulla schermata di scelta, il KV conserva il valore rotto; un tipo non riconosciuto produce «undefined · previsti undefined min» e con l'ora di inizio nel futuro il contatore stampa «-2:-5». Costo: è la radice di SES-03 (voce 19), e l'orologio spostato indietro cambiando fuso è plausibile in viaggio. Un try/catch che cancelli la chiave. (`test/simulazione/schermate-stato.mjs:3577,3582,3598`)

41. **NOT-04 / QRY-18 / IMP-18 — eventi scritti anche quando non è cambiato niente**
Salvare una nota senza modifiche, ritoccare la stessa risposta, ripetere l'importazione della biblioteca: ogni volta un evento nuovo. Costo: il registro e il pacchetto di sincronizzazione crescono senza ragione — e il pacchetto ha un tetto di 500 (voce 15). (`test/simulazione/schermate-stato.mjs:1652,2120`; `test/simulazione/import-database.mjs:879`)

42. **SCH-05 — negato il permesso, la preferenza resta salvata come attiva e `applica()` non viene mai chiamata**
Costo: la vecchia notifica resta programmata nel sistema. L'app avvisa già due volte (Alert e banner rosso permanente): manca solo di non salvare, o di applicare. (`test/simulazione/schermate-stato.mjs:3117`; `app/promemoria.tsx:44-49,89-99`)

43. **IMP-25 / IMP-26 — sha256 e byte vengono presi dal manifesto e mai confrontati con il file copiato**
Costo: un PDF sostituito passa inosservato e la riga dichiara una dimensione che non è quella del file. `statSync` e un digest. (`test/simulazione/import-database.mjs:1035,1041`)

44. **SYN-02 — due generazioni ravvicinate del codice di accoppiamento: quello mostrato non è quello salvato; e il codice non si può più rivedere**
`codiceMostrato` è stato del componente e non viene reinizializzato dall'accoppiamento salvato, che pure contiene il codice. Costo: trascriveresti sull'altro dispositivo un segreto che questo non possiede, e l'unico modo di rivedere il codice è «Dimentica l'accoppiamento», cioè la voce 16. (`test/simulazione/schermate-stato.mjs:3315`; `app/sync.tsx:13,23,101-105,127-136`)

45. **CDC-01 — una rubrica illeggibile fa cadere l'albero durante il disegno: in release l'app si chiude**
Il `JSON.parse` è dentro il render, senza try/catch e senza validazione della forma dopo il parse. Costo: chiusura senza traccia — ma la rubrica la scrive l'app stessa al primo avvio e non arriva mai dall'esterno, quindi serve una riga di database corrotta, non un tuo gesto. Un try/catch fuori dal render. (`test/simulazione/schermate-stato.mjs:2464,2472`; `lib/contenuti.ts:106-107`)

46. **Il ramo di errore della sincronizzazione inghiotte tutto, e la schermata può continuare a dire «Sincronizzato»**
`} catch { await registraScambio(false); }`: nessuna variabile catturata, nessuna voce nel diario, nessuna stampa — e il diario è già stato pubblicato prima di `assorbiRemoto`, `fondi` e la transazione. Costo: senza PC logcat è l'unica traccia leggibile, e in tutta l'app c'è un solo `console.` (`lib/sync/useAutoSync.ts:44,73-75`; `grep -rn "console\." app lib components` → `app/lettore.tsx:57`)

## Dopo

47. **La biblioteca aperta arriva sul dispositivo come 8 file su 52, non come 52 titoli**
14 voci `pdf` (8 scaricabili, 3 EUR-Lex che tornano 0 byte, 3 che puntano a una pagina di presentazione: BIB-09, BIB-30, BIB-37), 36 `html` e 2 `hub` che il workflow scarta perché chiamato senza `--includi-html`. Costo: il conto «undici verificate byte per byte» di NOTE-BUILD è ottimista di tre, e la prossima sessione crede che manchino tre voci invece di sei. (`strumenti/scarica_biblioteca.py:123-127`; `.github/workflows/biblioteca.yml:33`; `strumenti/biblioteca_aperta.py:28,51,62`; `strumenti/verifica_biblioteca.py:266-270`)

48. **Due cancelli della biblioteca non possono dire di no**
`scarica_biblioteca.py` non chiama mai `sys.exit` con codice diverso da zero: il workflow è verde anche con zero PDF su cinquantadue, impacchetta e pubblica. E nessuno dei 216 test collega il formato `pdf` alla forma dell'indirizzo, per cui le tre voci sbagliate passano tutte. (`grep -n "sys.exit" strumenti/scarica_biblioteca.py` → nessun risultato; `.github/workflows/biblioteca.yml:32-33,72-81`; `python3 strumenti/verifica_biblioteca.py` → 216/0 con le tre voci in catalogo)

49. **VER-04 / ORD-01 / ORD-02 — l'euristica dell'ordine è fragile, e il rimedio ovvio non funzionerebbe**
`ordineRilevante()` esportata da `lib/verifica.ts:183` non ha chiamanti di produzione: l'app usa la copia privata di `lib/contenuti.ts:58`, chiamata una volta sola per scrivere una COLONNA. Costo: correggerla sarebbe verde nelle prove, invisibile nell'app e comunque inefficace su un dispositivo già avviato (voce 1). Con il contenuto spedito i falsi positivi misurati sono zero. (`app/esercizi.tsx:54` legge `ordine_rilevante`; `test/simulazione/contenuti.mjs:533-545`)

50. **I tetti mancanti del motore mordono meno di quanto sembri, ma restano**
64.000 righe materializzate sono qualche centinaio di KB; le due copie da 2 MB per verifica riguardano 7 esercizi su 150 (SQL-088/089/090/091/101/102/150); la riserializzazione quadratica di `multiinsieme` ha come caso peggiore 464 righe, e solo sul ramo `valori_diversi`. Costo: batteria e secondi, non memoria esaurita — il caso che morde davvero è la voce 6. (`test/simulazione/motore-sql.mjs:302,590,487`; `app/esercizi.tsx:50-52`)

51. **Diagnosi e messaggi del confronto: motivi riusati e marcatori grezzi**
L'ordine sbagliato riusa `righe_diverse`, le colonne invertite danno `valori_diversi`, il dettaglio stampa il marcatore `\u0000NULL` e raccoglie due righe mostrandone una. Costo: leggi un motivo che non dice dove hai sbagliato. Nota: QRY-05b (colonne scambiate con valori identici) NON va chiuso — è l'invariante 3, e chiuderlo renderebbe rosso QRY-09. (`test/simulazione/motore-sql.mjs:338,375,458,463,397-400`)

52. **Colonne scritte che nessuno legge, e tentativi contati come errori dell'utente**
`durata_sec` è scritta in due punti e non ha un solo SELECT; un errore di sintassi e un difetto del contenuto finiscono come tentativo `errato`. Costo: nessuna schermata mostra una percentuale di riuscita, quindi il danno reale è solo la crescita del registro — e `motivo` è già in tabella per distinguerli. (`grep -rn "durata_sec" app lib components` → nessun SELECT; `app/esercizi.tsx:67`; `app/(tabs)/oggi.tsx:26`)

53. **Due sezioni su quattro del Profilo sono permanentemente vuote e rimandano a un Supabase che nell'app non esiste**
Nessuna riga di `app/` o `lib/` scrive in `artefatti`, `credenziali` o `pubblicazioni`, e non c'è codice Supabase. Costo: un testo di ripiego che non diventerà mai vero. O una via per riempirle, o una frase onesta. (`app/(tabs)/profilo.tsx:20-21,53,60`; `lib/db.ts:72,76,81`)

54. **Codice scritto, collaudato e senza chiamanti**
La regola delle tre settimane (`settimaneConsecutiveSottoMinimo`), `impronta()` — che è proprio ciò che renderebbe visibile SYN-01 — `confronta()` degli HLC, `trasportiUtilizzabili()` e `SCHEMA_VERSIONE`, che può restare 1 mentre le migrazioni diventano due perché il codice usa `MIGRAZIONI.length`. Costo: peso morto, e una costante che può divergere in silenzio. (`lib/sessioni.ts:114`; `lib/sync/fusione.ts:124-128`; `lib/hlc.ts:41`; `lib/sync/auto.ts:144`; `lib/db.ts:18` contro `:104-108`)

55. **Tre dipendenze dichiarate e mai usate, nella stessa condizione per cui `nativewind` è stata rimossa**
`expo-constants`, `expo-status-bar` e `react-dom` compaiono solo in `package.json`. Costo: `expo-constants` è un modulo nativo compilato dentro l'APK per niente — ed è proprio quello che darebbe il numero di build della voce 32. (`grep` sui sorgenti → una sola riga ciascuno: `package.json:17,27,29`)

56. **Le sette autorizzazioni dichiarate coprono solo funzioni che non esistono**
Bluetooth, posizione fine e wi-fi servono ai trasporti 1 e 2, che non hanno modulo nativo; l'unica autorizzazione davvero usata, `POST_NOTIFICATIONS`, arriva solo dalla fusione del manifest della libreria. Costo: il telefono elencherà «Posizione» fra i permessi di un'app personale offline. (`app.json:16-24`; `android/app/src/main/AndroidManifest.xml:2-13`; `node_modules/expo-notifications/android/src/main/AndroidManifest.xml:3`)

57. **Trasporti 1 e 2: manca il modulo Kotlin, e i punti d'innesto vanno lasciati dove sono**
`registraVicinanza` e `registraServer` non hanno chiamanti per progetto, non per dimenticanza. Costo: nessuno prima del viaggio — è già dichiarato in CLAUDE.md:115-117. (`lib/sync/vicinanza.ts:32`; `lib/sync/wifi.ts:26`)

58. **Nessuna icona: l'app arriva sui due dispositivi con il segnaposto del template e senza icona adattiva**
`app.json` non dichiara né `icon` né `adaptiveIcon`, in `assets/` non c'è nessuna immagine, e non esiste `mipmap-anydpi-v26` — su `minSdkVersion 26`, la versione in cui le icone adattive sono nate. Costo: indistinguibile da qualunque progetto Expo non configurato. (`ls android/app/src/main/res/` → solo mipmap-hdpi…xxxhdpi; `app.json:15`)

59. **LIB-09 — a 600dp la libreria resta a una colonna, e portarla a due farà perdere la posizione di scorrimento**
Il punto di rottura è a 900dp invece dei 600 imposti dalle convenzioni, e la `key` della FlatList è legata al numero di colonne. Costo: due caratteri e una `key`, insieme; la seconda metà non si manifesta finché non si corregge la prima. (`app/(tabs)/libreria.tsx:8`; `test/simulazione/schermate-stato.mjs:1387,1390`)

60. **Frasi che mentono senza conseguenze**
Filtro vuoto che invita a importare la biblioteca; `fattoOggi` calcolato una volta sola al montaggio; banner che dichiara 21 esercizi e «SQLite sconosciuta non supporta le window functions» senza aver verificato; «Anno null»; `id` mancante o ripetuto nel lettore; «Error: » davanti al messaggio; segnaposto del codice di accoppiamento a 5 blocchi contro 9 reali. (`test/simulazione/schermate-stato.mjs:1311,3102,699,710,1828,2865,2867,3344,3297`)

61. **Non esiste l'elenco dei difetti ancora aperti, e i due criteri per contarli danno numeri inconciliabili**
Tre superfici usano `difetto()` (85 + 39 + 36 = 160), cinque ne usano un'altra con `DIFETTO RIPRODOTTO` (altri 103). Costo: chiunque conti con un solo criterio ne conta circa la metà; il diario ne nomina ventuno e chiude con «e gli altri», e la sua frase «nessuno di loro perde dati» è smentita da SES-03 e CRO-03b. (`grep -cE '^\s*difetto\(' test/simulazione/*.mjs`; `grep -rc "DIFETTO RIPRODOTTO" test/simulazione/*.mjs`; `contenuti.mjs:180`, `promemoria-notifiche.mjs:324`)

62. **I codici dei difetti non sono univoci, e su due di essi il diario dice il contrario delle prove**
SYN-01 indica due difetti diversi; REG-08 e SYN-02 sono dichiarati caduti nel diario e restano verdi nelle simulazioni. (`sync-fusione.mjs:1641` contro `schermate-stato.mjs:3280`; `schermate-stato.mjs:2624,3315`; `registro-eventi.mjs:803`)

63. **Quarantasei file su cinquantasei in `test/simulazione/` non li esegue nessuno**
Trentanove controprove avversariali, tre lenti e `triage-promemoria.mjs` — quest'ultimo scritto come il gemello che invece gira, e che è la riverifica indipendente dei cinque difetti più taglienti dei promemoria. Costo: verbali che possono marcire senza che niente diventi rosso, e nessun modo di distinguerli dalle prove vive se non leggendoli uno per uno. (`verifica.sh:36-44` esegue dieci file; `ls test/simulazione/*.mjs | wc -l` → 56; `test/simulazione/triage-promemoria.mjs:162`)

64. **`npm run verifica` verde in locale non significa verifica verde in CI, e la pubblicazione dell'APK non dipende da nessuna delle due**
`verifica.yml` aggiunge i 216 test della biblioteca e i 10 della chiave di firma, che `verifica.sh` non contiene; i quattro workflow sono indipendenti e `pubblica` dipende solo da `[build, fumo]`. Costo: verde locale e push rosso; oppure verifica rossa e APK pubblicato come `latest`. Mitigato: `apk.yml:147-158` confronta davvero l'impronta della firma prima di pubblicare. (`verifica.sh:1-43` contro `.github/workflows/verifica.yml:23-37`; `grep -n "workflow_run\|workflow_call" .github/workflows/*.yml` → nessun risultato)

65. **Aggiungere un test in TypeScript non lo fa girare: servono due modifiche a mano, e dimenticarle è silenzioso**
`npm test` elenca a mano sei file compilati, `tsconfig.test.json` elenca a mano i sorgenti. Costo: è lo stesso schema che il diario chiama la lacuna di processo più costosa della sessione — «le guardie c'erano; nessuno le eseguiva». (`package.json:10`; `tsconfig.test.json`, campo `include`)

66. **`npx expo export` non è in nessuno script: il bundle è un effetto collaterale del build da 75 minuti**
`verifica.yml` fa typecheck e test ma non chiede mai a Metro di risolvere il grafo dei moduli. Costo: un `require()` verso un asset inesistente o una regola rotta di `metro.config.js` non sono visibili a `tsc --noEmit`, e un push che tocca solo `test/` o `strumenti/` non costruisce il bundle affatto. (`grep -rn "expo export"` → solo NOTE-BUILD.md:81; `.github/workflows/verifica.yml:23-27`; `.github/workflows/apk.yml:15-27,145`)

67. **I 199 test della rassegna non girano quando cambia il file di dati che leggono**
`rassegna.yml` filtra su `strumenti/rassegna/**`, ma il codice legge `assets/contenuti/esclusioni_rassegna.json`. Costo: l'errore si manifesta il mattino dopo nel cron delle 05:00, in un job che nessuno guarda. (`.github/workflows/rassegna.yml:29-32`; `strumenti/rassegna/catalogo.py:38`; `verifica_rassegna.py:104`)

68. **Il rapporto nell'issue dei build scrive «riuscito» anche quando la pubblicazione è fallita**
L'esito è calcolato da BUILD e FUMO soltanto; `PUBBLICA` compare solo dentro la tabella. Costo: è l'unico canale diagnostico senza PC, e riporta un successo dove non c'è un APK scaricabile. (`.github/workflows/apk.yml:295-297` contro `:307`)

69. **`fumo.sh`: l'estratto di logcat taglia via le righe dell'app, e il controllo dell'avvio in errore è morto**
`grep` + `tail -n 120` ha lasciato nel build 12 solo il ciclo di uiautomator; e «Avvio non riuscito» è cercato dopo aver visto Oggi, che nel caso di errore non appare mai — quindi quella riga non viene mai raggiunta. *Già nel diario*: NOTE-BUILD.md:85-94. (`.github/fumo.sh:27-28,40-49`)

70. **LSV-01 — la guardia che sorveglia la sola lettura resta verde anche senza il PRAGMA**
La regex cerca `PRAGMA query_only = ON` nel sorgente e ne trova due occorrenze, `lib/palestra.ts:45` e `:93`. Costo: togliere quella di `apriPalestra()` non fa diventare rossa la prova. È la lente stessa a dirlo, e nessuno la esegue (voce 63). (`test/simulazione/lente-scenari-svuotati.mjs:198`)

71. **`plugins/senza-gms.js` non ha nessuna prova, e niente controlla che il manifest fuso sia davvero senza emoji2**
La funzione è esposta «per i test» e i test non esistono; il guasto che previene non produce crash, quindi non lascia traccia. Costo: una riga di grep sul manifest fuso. Il gemello `firma-release.js` è nella stessa condizione, ma lì la rete c'è. (`plugins/senza-gms.js:103`; nessuna occorrenza di `emoji` in `apk.yml` né in `fumo.sh`; `.github/workflows/apk.yml:147-158`)

72. **Il protocollo del lettore è ancorato solo per un terzo**
Solo il messaggio «errore» è confrontato con l'HTML vero; «pronto» e «pagina» la simulazione se li fabbrica dal tipo TypeScript. Costo: una rigenerazione con nomi diversi non farebbe diventare rosso niente, e «pagina» — che guida il salvataggio — non è esercitato da nessuna parte su un dispositivo. (`test/simulazione/triage-schermate-stato.mjs:305`; `test/simulazione/schermate-stato.mjs:2782,2784`; `strumenti/genera-lettore.mjs:72,109,147,160`)

73. **`impacchetta.py` scrive fuori dal repository, e i due verificatori dei contenuti non girano in nessuna CI**
La destinazione è inchiodata a `/mnt/user-data/outputs/percorso-contenuti`, che su questa macchina è vuota; `verifica_esercizi.py` e `verifica_codice.py` non sono chiamati né da `verifica.sh` né da alcun workflow, malgrado il loro README dica che «si prestano a essere messi in CI». Costo: il giro di rigenerazione non si chiude, e una modifica a `esercizi_sql_*.py` non diventa rossa da nessuna parte. (`strumenti/contenuti/impacchetta.py:10,61`; `grep -rn 'python' .github/workflows/`; `verifica.sh` senza righe python)

74. **`fonti.json` e `repository.json` sono contenuti che nessuno legge**
`lib/contenuti.ts` carica cinque file; questi due non compaiono in nessun `.ts`, `.tsx`, `.mjs` o `.py` all'infuori di `impacchetta.py`, e `repository.json` non è nemmeno nella tabella del README. Costo: o si collegano, o si dichiara che sono materiale di riferimento. (`lib/contenuti.ts:75-79`; `strumenti/contenuti/impacchetta.py:58`)

75. **I numeri dei documenti sono indietro, e HANDOFF.md doveva essere archiviato dopo la prima sessione**
Il diario dice 92 test (sono 136 + 10), 481 e 1614 verifiche (sono 483 e 1616), «otto siti di chiamata» a `registra()` (sono dieci — proprio il numero che misura quanto costa SYN-01), 41 esercizi con window functions (sono 23 nel tema, 24 in tutto, e l'app ne annuncia 21). HANDOFF.md dichiara alla prima riga «poi si archivia» ed è ancora in radice con 92 test e 859 pacchetti. (`NOTE-BUILD.md:606,362,617,520,585-586,320`; `HANDOFF.md:3,13,51,78`; `app/_layout.tsx:31`; `grep -rnE "(await|void|return) +registra\(" app lib components` → 10)

76. **Due esercizi usano le window functions ma sfuggono al filtro che dovrebbe escluderli**
SQL-056 (`sql_cte`) e SQL-085 (`meal`) hanno `OVER(` fuori dal tema `sql_window`, che è l'unica cosa che il filtro esclude. Costo: nullo per settimane — in ordine di coda sono il 59° e il 103°, e i primi 40 sono tutti di livello 1 e 2 — ma se SQLite fosse sotto 3.25 fallirebbero accusando il dispositivo. (`app/esercizi.tsx:30,37`; `app/(tabs)/studio.tsx:16`; `test/simulazione/contenuti.mjs` G8)

77. **PRE-05c — se la preparazione dell'esercizio è rotta, il messaggio accusa il telefono**
«La soluzione di riferimento non è eseguibile su questo dispositivo» per un difetto del contenuto. (`test/simulazione/motore-sql.mjs:609`)

78. **arXiv risponde 406 e Unpaywall resta spenta: strumenti da cloud, nessuno tocca il viaggio**
Otto varianti della richiesta tutte respinte, con la diagnosi chiusa di proposito; Unpaywall attende solo un segreto (voce 86). Costo: nessuno prima del 23 novembre — girano su GitHub Actions e richiedono rete. *Già deciso*: NOTE-BUILD.md:267-281 e HANDOFF.md («Rassegna e coda dei paper: dopo il viaggio»). (`strumenti/rassegna/diagnosi_arxiv.py`; `strumenti/rassegna/fonti_aperte.py:135`)

## Non è codice: tocca a te

79. **Installare l'APK su telefono E tablet, e non disinstallare mai per aggiornare**
Scaricare `percorso-13.apk` dalla release `apk-13` (serve l'accesso a GitHub, il repository è privato), concedere «Installa app sconosciute», installare su entrambi. Costo: finché non è fatto, niente di tutto il resto è verificabile — e disinstallare cancella il registro eventi. (`NOTE-BUILD.md:35-61`, `:311-314`)

80. **La prova in modalità aereo per 24 ore su entrambi i dispositivi non è mai stata fatta**
Usare solo l'app, senza rete, su telefono e tablet insieme. Costo: tutto ciò che oggi è verificato lo è su emulatore e sopra `node:sqlite`; restano fuori i guasti dell'hardware vero, e HANDOFF.md la chiama «il collaudo che conta davvero». (`NOTE-BUILD.md:311-314`; `HANDOFF.md:83-84`)

81. **Leggere `sqlite_version()` nel riquadro di Oggi al primo avvio**
Il riquadro esiste già e stampa la versione e se le window functions sono disponibili. Costo: un avvio e uno sguardo — da quel numero dipendono 24 esercizi su 150 (voce 76). (`app/(tabs)/oggi.tsx:72-78`; `app/_layout.tsx:28-33`)

82. **Nel trimestre del viaggio non c'è un solo libro apribile senza rete**
Il viaggio (2 ottobre – 23 novembre) cade nel T1, e le sette voci del T1 sono tutte `html`: i quattordici PDF del catalogo sono di T2, T3 e T5. Costo: procurarsi il PDF ufficiale di Pro Git e Automate the Boring Stuff, o salvare a mano gli altri, e caricarli con «Aggiungi PDF» PRIMA di partire — altrimenti la priorità massima non ha niente da aprire nel trimestre giusto. (`python3` su `assets/contenuti/biblioteca.json` → `('T1','html') 7`, nessun `('T1','pdf')`; `lib/contenuti.ts:35-40`)

83. **La biblioteca aperta non è ancora sui dispositivi, e dal 2 ottobre non sarà più possibile metterla**
Avviare il workflow «biblioteca», scaricare lo zip sul dispositivo, estrarlo con l'app File, poi Libreria → «Importa biblioteca» selezionando INSIEME `manifesto.json` e i PDF. Costo: richiede rete e account GitHub, e va rifatto su entrambi i dispositivi. (`NOTE-BUILD.md:63-67`; `CLAUDE.md:114`)

84. **Il lettore PDF ha aperto un solo documento in tutta la sua vita: 876 byte, due pagine**
Manca la prova che un libro vero — centinaia di pagine, decine di MB — si apra su telefono e su tablet, con il documento caricato in un colpo solo e pdf.js sul thread principale. Costo: è la funzione a priorità massima insieme agli esercizi, e le voci 8 e 9 sono esattamente ciò che questa prova troverebbe. (`ls -la assets/lettore/` → `prova.pdf`, 876 byte; `strumenti/genera-lettore.mjs:90`)

85. **Le notifiche e il layout del tablet non sono mai stati esercitati**
Il test di fumo non tocca i permessi, la programmazione né la consegna delle notifiche, e gira su un profilo telefono aprendo le rotte con collegamenti profondi: né il punto di rottura né `tabBarPosition: "left"` sono mai stati disegnati. Costo: due gesti al primo avvio su ciascun dispositivo. (`grep -n "notif\|promemoria" .github/fumo.sh` → nessun risultato; `.github/workflows/apk.yml:189-191`; `.github/fumo.sh:55-60`; `app/(tabs)/_layout.tsx:18`)

86. **`crypto.subtle` non è mai stato verificato su un dispositivo vero**
Tutta la cifratura dei pacchetti ci passa, e il codice che lo usa vive solo dietro `app/sync.tsx`, che il fumo non apre mai. Costo: se su Android manca, la sincronizzazione va disattivata — meglio saperlo prima del 2 ottobre. (`lib/sync/pacchetto.ts:38-46`; `NOTE-BUILD.md:77-79`; `HANDOFF.md:68`)

87. **Il segreto `PERCORSO_CONTATTO` non è impostato: Unpaywall resta spenta**
Impostazioni → Secrets and variables → Actions → nuovo segreto con un indirizzo di posta raggiungibile. Costo: senza, `unpaywall()` solleva e la fonte principale non viene interrogata su nessuna voce con DOI. Non tocca il viaggio. (`strumenti/rassegna/fonti_aperte.py:53,556-558`; `.github/workflows/rassegna.yml:72,125` passano già il segreto)

88. **Il segreto `PASSPHRASE_FIRMA` è facoltativo e non manca niente senza**
La chiave è già persistente e non cambia mai; il segreto aggiunge solo la cifratura a riposo di una chiave che vive in una release privata, e `test-firma.sh` lo verifica a ogni push. (`CLAUDE.md:107-112`; `HANDOFF.md:33-34`)

89. **La decisione della regola di rinuncia scade fra sette giorni**
Entro il 29 settembre: se l'app non si avvia in modo affidabile su entrambi i dispositivi, si smette di lavorarci e si parte con `assets/contenuti/` e un client SQLite qualunque. Costo: oggi è il 22 settembre e l'app non è ancora stata avviata su un dispositivo vero. (`HANDOFF.md:102-106`; `CLAUDE.md:16-18`)

90. **Decidere adesso che cosa fare di SYN-01, perché la risposta cambia il resto dell'elenco**
Due strade: chiuderlo (e allora prima va risolta la voce 17, la forma di `file_locale`), oppure dichiarare i due dispositivi due isole e tenere ciascun tipo di lavoro sempre sullo stesso. Costo: senza questa decisione, le voci 15, 16, 17, 44 e 46 non hanno un ordine sensato.

---

**Voci in tutto: 90.**
**Toccano il viaggio (Prima del 2 ottobre + Non è codice): 58.**
**Se avessi un'ora: installare l'APK su telefono e tablet, aprire Oggi e leggere `sqlite_version()`** — è il gesto che sblocca la regola di rinuncia del 29 settembre, decide se le voci 76 e 81 esistono, e trasforma 89 righe scritte da un emulatore in un elenco che parla di due dispositivi veri.

---

## PRM-01 — i promemoria perdono le sessioni di oggi dopo le 22:00 UTC

**Aggiunta il 22 settembre 2026.** Non veniva da nessuno dei sei agenti: si è
presentata da sé, facendo diventare rosso `npm run verifica` a fine giornata
dopo essere stato verde la mattina, sullo stesso commit.

**Cosa si osserva.** Tre verifiche del blocco L3 di
`test/simulazione/promemoria-notifiche.mjs` — quelle su «il blocco di oggi
risulta già registrato» — passano prima delle 22:00 UTC e falliscono dopo.
`giaFattoOggi()` riceve un elenco VUOTO di sessioni odierne, mentre la stessa
identica interrogazione (`SELECT inizio FROM sessioni WHERE tipo = ?`) eseguita
una riga prima e una riga dopo il montaggio della schermata le righe le trova.

**Misurato, non dedotto.** Con l'orologio inchiodato da
`test/banco/orologio-fisso.mjs`:

| ora UTC | esito |
|---|---|
| 02:30 | 408 su 408 |
| 07:50 | 408 su 408 |
| 12:00 | 408 su 408 |
| 18:30 | 408 su 408 |
| 20:30 | 408 su 408 |
| 21:30 | 408 su 408 |
| **22:30** | **405 su 408** |
| **23:30** | **405 su 408** |

Il confine è netto: le 22:00 UTC.

**Non è di questa sessione.** Si riproduce identica al commit `a460bae`, cioè
prima di qualunque modifica del lavoro sulla nuvola. Non tocca la
sincronizzazione né la conduttura quotidiana.

**Perché conta.** Non è solo rumore nella verifica: se la causa è nell'app e
non nella prova, allora un promemoria impostato di sera non riconosce il blocco
già fatto quel giorno, e lo ripropone. L'app va in viaggio il 2 ottobre.

**Riproduzione.**

```bash
OROLOGIO_FISSO=$(node -e "console.log(Date.parse('2026-09-22T23:00:00Z'))") \
NODE_OPTIONS="--import=./test/banco/orologio-fisso.mjs" \
node test/simulazione/promemoria-notifiche.mjs
```

**Stato.** Aperta, causa non individuata. `verifica.sh` fa girare la
simulazione a un'ora fissa del mattino — così il rosso torna a significare
qualcosa — e subito dopo la rifà alle 23:00 come SENTINELLA: se il difetto
smette di riprodursi, lo dice e chiede di chiudere questa voce. Il difetto non
è stato nascosto, è stato inchiodato.
