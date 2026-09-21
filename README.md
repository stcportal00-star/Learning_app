# Learning_app

Repository di lavoro per il progetto **percorso**: estrazione del sorgente, build APK firmato, test di fumo su emulatore Android e pubblicazione della biblioteca.

## Stato

Segnaposto. Questo README viene sostituito dal README del progetto dopo l'estrazione.

## Passo mancante

Il repository attende il caricamento di `percorso.zip` nella radice del ramo `main`.

Caricamento dal telefono, via browser (l'app GitHub non permette l'upload di file):

1. apri `https://github.com/stcportal00-star/Learning_app/upload/main`
2. **choose your files** -> app **File** -> `percorso.zip`
3. **Commit changes**

Limite dell'upload via browser: 25 MB per file. Oltre tale soglia il caricamento va fatto come asset di una release (fino a 2 GB).

## Pipeline prevista dopo l'estrazione

| Workflow | Funzione |
| --- | --- |
| `verifica` | test e garanzia sulla chiave di firma |
| `apk` | build firmato, test di fumo su emulatore Android 14, pubblicazione dell'APK solo se il test passa, rapporto nell'issue "Rapporti di build" |
| `biblioteca` | scarica i testi aperti e li pubblica in una release privata |

Ramo di sviluppo: `claude/estrazione-build-apk-unamhj`.
