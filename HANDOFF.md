# HANDOFF — passaggio a Claude Code

Questo documento serve una volta sola: per la prima sessione. Poi si archivia.

## Contesto in dieci righe

App personale di apprendimento, Android, telefono e tablet insieme, tutto offline.
Serve all'utente durante un viaggio dal 2 ottobre al 23 novembre 2026, in cui avrà
entrambi i dispositivi e connettività assente o inaffidabile.

Il contenuto (381 item) è già prodotto e verificato per esecuzione. Il database
remoto (Supabase, schema `percorso`) è già creato e popolato con il piano di
apprendimento. Il codice dell'app è scritto, tipizzato e coperto da 92 test di
logica pura.

**Non è mai stato compilato né eseguito su un dispositivo.** È l'unica cosa che
manca, ed è l'unica che non si poteva fare altrove.

## Preparazione, dal telefono

Due azioni, le uniche che Claude Code non può fare:

1. **Repository GitHub privato `percorso`**, con README, e caricamento di
   `percorso.zip`. Una sessione cloud parte sempre da un repository, e lo zip
   esiste solo nella conversazione in cui è stato prodotto.
2. **Claude Code**, scheda Code dell'app: scegliere `percorso`, incollare
   `PRIMO-PROMPT.md`.

Tutto il resto lo fa Claude Code con GitHub Actions: estrazione, verifica, build,
firma, test su emulatore, pubblicazione, biblioteca. Alla fine resta solo
l'installazione dell'APK, che Android fa confermare all'utente.

Facoltativo, in qualunque momento: il secret `PASSPHRASE_FIRMA` per cifrare la
chiave di firma. Il build successivo cifra la chiave esistente, senza cambiarla.

## Sessione 1 — un solo obiettivo

**Arrivare a un APK pubblicato in una release, con il test di fumo superato.**

Istruzioni operative in `PRIMO-PROMPT.md`. Poi, dal telefono: Releases >
ultima build > scaricare l'APK > installare. Stesso APK sul tablet.

## Già risolto prima della consegna

Trovato con una prova da estrazione pulita, eseguendo esattamente i passi dello script:

| Problema | Effetto se non risolto | Correzione |
|---|---|---|
| `expo-file-system` v19 ha rimosso l'API a funzioni | 6 errori di tipo, crash all'avvio | migrato a `File` / `Directory` / `Paths` |
| `react-dom` non dichiarata: npm prendeva la 19.3.0, incompatibile con react 19.1.0 | `npm install` lo forzava in silenzio con un avviso; **`npm ci` falliva — e la CI usa `npm ci`**: il primo build in cloud si sarebbe rotto | fissata a 19.1.0 come da SDK 54; zero avvisi ERESOLVE |
| `package-lock.json` assente dal pacchetto | installazioni non riproducibili fra macchine | incluso; `npm ci` da estrazione pulita: 859 pacchetti, 92 test verdi |
| `nativewind` dichiarata e mai usata | configurazione babel e tailwind mancante al build | rimossa |
| Metro non riconosce `.db` come asset | `palestra.db` fuori dal bundle | `metro.config.js` aggiunto |
| `react-native-pdf` e `react-native-blob-util`: moduli nativi di terze parti | fuori dal catalogo Expo, rischio di crash nativo | sostituiti da `react-native-webview` (catalogo) + pdf.js incorporato: lettore interno con ripresa della pagina sincronizzata, verificato in Node e sull'emulatore |
| Chiave di firma diversa a ogni build di CI | aggiornamenti rifiutati da Android; disinstallare cancella i dati | chiave generata una volta e conservata nella release `firma`; migrazione alla cifratura senza cambiarla; ogni build ne verifica l'impronta prima di pubblicare; 10 scenari collaudati a ogni push |
| L'importazione del manifesto collegava PDF mai copiati | volumi collegati a percorsi vuoti | `importaBiblioteca()` copia i PDF nello spazio dell'app e li collega per codice |
| Build filtrato sul ramo `main` | le sessioni cloud pubblicano su rami nuovi: il build non partirebbe mai | workflow attivo su ogni ramo |

## Fallimenti attesi, con il rimedio

Nessuno di questi è stato osservato: sono previsioni basate sulle dipendenze in uso.

| Sintomo | Causa probabile | Rimedio |
|---|---|---|
| `expo-sqlite/kv-store` non risolto | il sottomodulo cambia percorso fra versioni minori | sostituire con `expo-sqlite/kv-store` o `AsyncStorage`; è usato solo per `dispositivo_id` e accoppiamento |
| `Asset.fromModule(require(".db"))` fallisce | Metro non riconosce `.db` come asset | aggiungere `assetExts: [...defaultAssetExts, "db"]` in `metro.config.js` |
| Gradle esaurisce la memoria in CI | runner con RAM limitata, 3 architetture native | ridurre `reactNativeArchitectures` in `plugins/firma-release.js` (es. `arm64-v8a,x86_64`) dopo aver verificato che il tablet sia a 64 bit |
| `crypto.subtle` non definito | WebCrypto non esposto in questa versione di `expo-crypto` | verificare con un log all'avvio; se manca, la sincronizzazione va disattivata temporaneamente — **non aggirare cifrando in chiaro** |
| `tabBarPosition: "left"` ignorato | opzione non supportata dalla versione di `expo-router` | ripiegare su barra in basso anche su tablet; è cosmetico, non bloccante |
| window functions non disponibili | SQLite di sistema più vecchio di 3.25 | già gestito: l'app esclude quegli esercizi e mostra un avviso. Verificare che l'avviso compaia davvero |

## Prima verifica su dispositivo

```sql
SELECT sqlite_version();
```

Compare nella schermata Oggi. Se è inferiore a 3.25, i 41 esercizi con window
functions non sono eseguibili: valutare `op-sqlite` al posto di `expo-sqlite`.

## Sessioni successive, in ordine

1. **Prova in modalità aereo** — 24 ore usando solo l'app, entrambi i dispositivi.
   È il collaudo che conta davvero.
2. **Modulo Kotlin Nearby** — specifica nel README. Solo se i punti 1 e 2 sono chiusi.
3. **Notifiche** — promemoria dei blocchi del mattino.

Rassegna delle notizie e coda dei paper: **dopo il viaggio**. Richiedono rete e
non servono in aereo.

## Diagnosi senza PC

- **Crash nativo all'avvio**: il test di fumo lo intercetta sull'emulatore;
  logcat finisce nell'issue "Rapporti di build".
- **Errore JavaScript all'avvio**: compare a schermo ("Avvio non riuscito") e
  nella schermata catturata dal test di fumo, pubblicata nella release.
- **Crash solo sul dispositivo reale** (hardware specifico, Bluetooth): non
  riproducibile sull'emulatore. È il limite che resta; per questo i moduli
  nativi propri non entrano in questa fase.

## Regola di rinuncia

Se al 29 settembre l'app non si avvia in modo affidabile, si smette di lavorarci.
L'utente parte con `assets/contenuti/` e un qualunque client SQLite: i 381 item
funzionano senza l'app. Costruire lo strumento non deve consumare il tempo che
doveva servire a usarlo.

## Documenti di riferimento

- `CLAUDE.md` — invarianti, convenzioni e divieti. Leggerlo per primo.
- `README.md` — architettura, decisioni, specifica del modulo nativo.
- `strumenti/contenuti/README.md` — come sono stati generati e verificati i contenuti.
- `strumenti/db/` — migrazioni SQL già applicate su Supabase.
