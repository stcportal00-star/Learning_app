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
| `npm run verifica` | typecheck + 146 test, 256 del banco, 1614 delle simulazioni |
| `.github/test-firma.sh` | 10 scenari della chiave di firma, tutti superati |
| `npx expo config --type prebuild` | valido, SDK 54 |
| Versioni vs `bundledNativeModules` | 15 su 15 allineate |

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
