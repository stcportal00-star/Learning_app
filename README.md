# Percorso

App di apprendimento offline-first per Android (telefono e tablet, stesso codice).

**Vincolo di progetto: tutto deve funzionare in aereo.** La rete è un extra, mai un requisito.

## Stato

| Modulo | Stato |
|---|---|
| Orologio logico ibrido (HLC) | fatto, 20 test superati |
| Motore di verifica degli esercizi | fatto, testato |
| Livello dati locale + registro eventi | fatto |
| Caricatore dei contenuti impacchettati | fatto |
| Palestra SQL in sola lettura | fatto |
| Libreria PDF con importazione manuale | fatto |
| Schermate complete (9 rotte) | fatto |
| Sincronizzazione (3 trasporti) | fatto, livelli 1-2 in attesa dei moduli nativi |
| Lettore PDF interno (pdf.js in WebView) con pagina sincronizzata | fatto — verificato in Node e sull'emulatore in CI |
| Note in Markdown con coda "da pubblicare" | fatto |
| Lettura del codice con ipotesi obbligatoria | fatto |
| `npm install` e typecheck completo | **eseguiti: 0 errori** |
| Build Android su dispositivo | da fare — richiede la tua macchina |
| Registro delle sessioni con cronometro persistente | fatto |
| Modulo Kotlin Nearby | da fare |
| Rassegna e papers | da fare, dopo il viaggio |

## Avvio

Il build non si fa in locale: lo fa GitHub Actions a ogni push (vedi "Tutto in git").
In locale servono solo:

```bash
npm ci
npm run verifica
```

## Decisioni che vale la pena conoscere

**Il registro eventi è la fonte di verità.** Ogni scrittura passa da `registra()`, che inserisce un evento e applica la proiezione nella stessa transazione. Fondere due dispositivi significa concatenare i registri e deduplicare per id: non esistono conflitti per costruzione.

**L'orologio è logico, non fisico.** Durante un volo i due dispositivi possono avere fusi diversi. Un HLC non regredisce mai e produce stringhe ordinabili lessicograficamente. La deriva superiore al minuto viene segnalata nella schermata Oggi.

**La verifica confronta i risultati, non le query.** Una soluzione diversa dalla mia ma corretta passa. Quando la consegna non richiede un ordinamento, il confronto è sul multiinsieme delle righe.

**Gli esercizi che creano indici girano su una copia temporanea** di `palestra.db`, eliminata subito dopo: il database originale resta intatto.

**Window functions.** Richiedono SQLite 3.25. All'avvio l'app interroga `sqlite_version()`: se il motore è più vecchio, i 21 esercizi interessati vengono esclusi dalla coda e compare un avviso, invece di fallire a metà.

## Libreria

Due origini, distinte nell'interfaccia:

- **aperta** — 52 testi ad accesso libero con licenza dichiarata (CC, pubblico dominio, accesso concesso dall'autore o dall'editore), più 20 repository da consultare. Si scaricano con `scarica_biblioteca.py` sul PC e si importano con "Importa manifesto".
- **manuale** — qualsiasi PDF o EPUB che decidi tu, tramite "Aggiungi PDF". Il file viene copiato nello spazio privato dell'app e resta leggibile offline. L'app non scarica nulla da sola e non si iscrive a nessun servizio.

## Test

```bash
npm test
```

Verifica orologio logico, fusione fra dispositivi con sette ore di deriva, e le otto condizioni del motore di confronto (ordine rilevante o no, colonne, righe, NULL, tolleranza sui decimali, errori di sintassi).

## Sincronizzazione

Tre trasporti dietro un'unica interfaccia, con degradazione automatica:

| Livello | Trasporto | Stato | Se fallisce |
|---|---|---|---|
| 1 | Prossimità (BLE + Wi-Fi Direct) | richiede modulo Kotlin | scende al 2 |
| 2 | Wi-Fi locale (hotspot + HTTP) | richiede modulo server | scende al 3 |
| 3 | **File cifrato** (foglio di condivisione) | **completo e collaudato** | non può fallire |

Il livello 3 è stato costruito per primo, non per ultimo: il trasferimento non lo esegue il nostro codice ma il sistema operativo, quindi è l'unico che non può rompersi. I livelli 1 e 2 sono comodità che eliminano due tocchi.

Ogni salto è registrato e mostrato all'utente: non compare mai un generico "sincronizzazione non riuscita", ma il motivo preciso di ogni livello saltato.

### Formato del pacchetto

AES-256-GCM, chiave derivata con PBKDF2-SHA256 a 210.000 iterazioni da una passphrase condivisa fra i tuoi due dispositivi. GCM è autenticato: un pacchetto manomesso non si apre affatto, non si apre parzialmente. L'esportazione in chiaro non è prevista, perché il file passa da Download e da eventuali backup.

### Fusione

Il registro è append-only, quindi fondere è concatenare e deduplicare per id evento. I conflitti esistono solo a livello di proiezione, quando due dispositivi hanno modificato lo stesso campo: vince l'HLC più alto, e poiché l'HLC include l'id del dispositivo come ultimo criterio, i due arrivano allo stesso stato finale **indipendentemente dall'ordine in cui si sincronizzano**. È verificato da un test che confronta l'impronta dei due registri.

### Modulo nativo per la prossimità — specifica

Da implementare in Kotlin come modulo Expo, avvolgendo `com.google.android.gms:play-services-nearby`. Interfaccia richiesta da `lib/sync/vicinanza.ts`:

```kotlin
permessiConcessi(): Boolean
richiediPermessi(): Boolean
connetti(idServizio: String, timeoutMs: Int): String   // avvia advertising e discovery, ritorna l'id del pari
invia(idPari: String, dati: String)
ricevi(idPari: String, timeoutMs: Int): String
disconnetti()
```

Strategia consigliata: `P2P_POINT_TO_POINT`. Permessi a runtime su Android 12+: `BLUETOOTH_SCAN`, `BLUETOOTH_ADVERTISE`, `BLUETOOTH_CONNECT`; su Android 8-11 `ACCESS_FINE_LOCATION`. Già dichiarati in `app.json`.

Finché il modulo non è compilato, `disponibilita()` risponde onestamente "non disponibile" e la catena degrada senza errori. È una scelta deliberata: meglio un trasporto assente che uno che finge di esserci e si rompe a metà trasferimento.

## Test

```bash
npm test
```

| Suite | Test | Cosa verifica |
|---|---|---|
| nucleo | 20 | orologio logico, deriva di 7 ore fra dispositivi, motore di confronto dei risultati |
| sync | 19 | cifratura, manomissione, convergenza, conflitti, eliminazioni, ripresa da sync interrotta |
| catena | 10 | degradazione fra i tre trasporti, diagnosi di ogni salto, eccezioni contenute |

**49 test, tutti superati.**

## Scenario: entrambi i dispositivi con te, in aereo

È lo scenario per cui l'app è ottimizzata, e cambia due cose.

**Prossimità e wi-fi funzionano davvero.** La modalità aereo disattiva la rete dati, ma Bluetooth e Wi-Fi si riattivano a mano dopo il decollo. I trasporti 1 e 2 non hanno mai avuto bisogno di internet: scambiano direttamente fra i due apparecchi. `trasportiUtilizzabili()` ragiona su radio disponibili, non su connettività: l'assenza di internet non disattiva nulla.

**Il rischio non è più la connessione: è la divergenza.** Fai venti esercizi sul tablet, prendi il telefono, e il telefono te li ripropone. Per questo:

- **Accoppiamento una volta sola.** Si genera un segreto da 160 bit su un dispositivo e si trascrive sull'altro. Il codice è in Crockford base32 — niente I, L, O, U — con carattere di controllo: un errore di battitura viene rifiutato subito, non a metà scambio. Da lì in poi nessuna passphrase da digitare.
- **Scambio automatico al ritorno in primo piano** e ogni cinque minuti, con i soli trasporti silenziosi. Il file cifrato richiede due tocchi e quindi si attiva solo su richiesta esplicita.
- **Backoff esponenziale** da 1 a 30 minuti dopo fallimenti consecutivi, per non tenere le radio accese a vuoto.
- **Batteria bassa**: si rinuncia agli scambi piccoli, non a quelli con molti eventi in sospeso.
- **Indicatore di divergenza** nella schermata Oggi. Quando i due dispositivi si sono allontanati, l'avviso è esplicito sulla conseguenza concreta: "ti riproporrà esercizi già fatti".

### Test

| Suite | Test |
|---|---|
| nucleo | 20 |
| sync | 19 |
| catena | 10 |
| due-dispositivi | 29 |
| sessioni | 14 |

**92 test, tutti superati** (con la suite `sessioni`, 14). La suite `due-dispositivi` copre fra l'altro: round-trip del codice di accoppiamento, tolleranza a spazi e minuscole, intercettazione di un carattere sbagliato su 40 codici generati a caso, derivazione della passphrase, e le decisioni della politica automatica in tutti i casi limite (batteria, backoff, secondo piano, primo scambio).


## Verifiche già eseguite

Non solo test di logica: `npm install` è stato eseguito davvero (980 pacchetti) e il
typecheck gira sui tipi reali di Expo e React Native.

| Verifica | Esito |
|---|---|
| `npm install` | 980 pacchetti, nessun conflitto bloccante |
| `tsc --noEmit` su tutta l'app | **0 errori** |
| `expo config --type prebuild` | valido, SDK 54 risolto |
| Allineamento versioni con `bundledNativeModules` | 15 pacchetti su 15 allineati |
| Suite di test | 99 superati |

Il primo typecheck ha trovato 6 errori reali: `expo-file-system` v19 ha sostituito le
funzioni (`documentDirectory`, `copyAsync`, `readAsStringAsync`) con le classi
`File`, `Directory` e `Paths`. Il codice è stato migrato alla nuova API invece di
usare il livello di compatibilità, che è deprecato. `nativewind` era dichiarata e
mai usata: rimossa, perché avrebbe richiesto configurazione babel e tailwind
senza dare nulla in cambio.

## Navigazione

Cinque schede — il massimo leggibile su un telefono — più tre schermate impilate.

```
(tabs)
  Oggi        stato, divergenza fra dispositivi, motore SQL del dispositivo
  Studio      hub: esercizi SQL, lettura del codice, ripasso, scenari
  Libreria    volumi aperti e PDF tuoi, filtro per trimestre
  Note        Markdown, coda "da pubblicare" per il post mensile
  Profilo     artefatti, credenziali, accesso alla sincronizzazione

impilate
  /esercizi   editor SQL con verifica per esecuzione
  /codice     modulo difettoso, ipotesi obbligatoria, test, correzione
  /ripasso    FSRS semplificato su schede con citazione
  /sync       accoppiamento e scambio
```

Su tablet (≥600dp) la barra passa a sinistra e le schermate a due pannelli si
affiancano: consegna e editor, elenco note ed editor. Stesso codice, nessun ramo
per dispositivo.

## Il blocco di lettura del codice

L'ordine è imposto dall'interfaccia, non suggerito:

1. Scrivi l'ipotesi. Sotto i 15 caratteri il pulsante non sblocca nulla.
2. Compare il test che dimostra il difetto.
3. Solo allora la descrizione del difetto e la correzione.
4. Dichiari se l'avevi individuato. Gli esercizi mancati tornano in coda.

Il test è in Python, quindi si esegue sul computer: l'app esporta modulo e test
in un unico file pronto da lanciare. In aereo si legge e si ragiona; l'esecuzione
si fa a terra.


## Registro delle sessioni

Il cronometro salva l'ora di inizio in locale, non in memoria: si può avviare un
blocco, chiudere l'app e riaprirla un'ora dopo senza perdere nulla. Tre regole
del piano sono imposte dal codice, non affidate alla disciplina:

- **sotto i 5 minuti** una sessione non viene registrata: è un'interruzione;
- **oltre le 3 ore** si assume un cronometro dimenticato acceso e si registra la
  durata prevista del blocco, con un avviso che invita a correggerla;
- **oltre il doppio della durata prevista** la sessione è registrata ma segnalata,
  perché il piano regge solo se i blocchi restano brevi.

Il riepilogo settimanale parte dal lunedì e classifica la settimana nei tre
livelli del piano: sopravvivenza (2 h), base (5 h), surge (8 h).
`settimaneConsecutiveSottoMinimo()` implementa la regola delle tre settimane.


## Tutto in git

GitHub Actions fa ciò che farebbe un PC.

| Workflow | Quando | Cosa fa |
|---|---|---|
| `verifica` | ogni push | typecheck + 99 test |
| `apk` | push che toccano l'app, o a mano | build release firmato, test su emulatore Android 14, APK pubblicato **solo se il test passa**, rapporto con logcat nell'issue "Rapporti di build" |
| `biblioteca` | a mano | scarica i 52 testi aperti e li pubblica in una release privata |

Il test di fumo (`.github/fumo.sh`) installa l'APK, attende che compaia la
schermata Oggi, naviga fra le cinque sezioni, apre un PDF di prova nel lettore e
verifica che segnali "1 / 2", riavvia a freddo. Cattura una schermata per ogni
passo: quelle del build riuscito sono allegate alla release, visibili dal telefono.

La firma usa una chiave generata una sola volta e conservata cifrata nella
release `firma`. Ogni build ne verifica l'impronta prima di pubblicare: un APK
firmato con un'altra chiave non si installerebbe sopra il precedente.
