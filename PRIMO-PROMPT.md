Fai tutto tu, dall'inizio alla fine. Io lavoro solo da telefono e alla fine installerò l'APK: nient'altro.

Questo repository contiene solo percorso.zip e un README. Lavori da un ambiente cloud senza PC. Build, firma, test su emulatore e pubblicazione avvengono in GitHub Actions, avviati dai tuoi push.

1 — Estrai il progetto
- decomprimi percorso.zip; contiene una cartella percorso/
- sposta tutto il contenuto di percorso/ nella radice, file nascosti inclusi (.gitignore e .github/)
- elimina percorso.zip e la cartella percorso/ vuota

2 — Leggi CLAUDE.md e HANDOFF.md per intero prima di qualunque altra cosa.

3 — Verifica: `npm ci` e poi `npm run verifica`. Devono dare typecheck a zero errori e 99 test verdi. Se non è così, fermati e riportami l'errore.

4 — Commit "estrazione del progetto" e push. Il push avvia tre workflow:
- verifica: test e garanzia sulla chiave di firma
- apk: build firmato, test di fumo su emulatore Android 14, pubblicazione dell'APK solo se il test passa, rapporto nell'issue "Rapporti di build"
- biblioteca: scarica i testi aperti e li pubblica in una release privata

5 — Attendi i risultati. Un build completo richiede circa 30-45 minuti. Controlla l'issue "Rapporti di build" ogni 5 minuti: il commento compare quando il workflow apk termina. Se dopo 60 minuti l'issue non esiste, il workflow non è partito: verifica che .github/workflows/ sia arrivato nella radice del ramo pubblicato.

6 — Se il rapporto indica un fallimento: la causa è nell'estratto di logcat. Correggi solo quella causa, `npm run verifica` verde, commit con il perché nel messaggio, push, torna al punto 5. Se la stessa causa resiste a tre tentativi, fermati e riportami l'estratto: niente correzioni alla cieca.

7 — Quando il rapporto dice "riuscito", controlla anche che esista la release biblioteca. Poi dammi, in quest'ordine:
- numero di build, secondi alla comparsa della schermata Oggi, esito del lettore PDF, modalità e impronta della firma
- il link diretto alla release con l'APK e quello alla release della biblioteca (ricavali da `git remote get-url origin`)
- le istruzioni per me, passo per passo: scaricare e installare l'APK sul telefono e sul tablet; scaricare biblioteca.zip, estrarlo con l'app File, importarlo da Libreria > Importa biblioteca

8 — Chiudi aggiornando NOTE-BUILD.md con ciò che hai risolto e ciò che resta aperto, e fai l'ultimo commit.

Regole per tutta la sessione:
- nessuna funzionalità nuova, nessun refactoring
- un commit per correzione, con il perché nel messaggio
- mai modificare fumo.sh, test-firma.sh o i workflow per far passare un test: se un test fallisce, il difetto è nell'app
- mai toccare la release "firma" né il passo del workflow che gestisce la chiave
