# Caricamento manuale dei PDF

I PDF lasciati cadere in questa cartella entrano nella biblioteca dell'app al
primo push. Non serve altro: il workflow `nuvola` parte da sé su ogni modifica
di `biblioteca-manuale/**`, carica il file nel deposito, ne estrae il testo per
la lettura e la ricerca, e lo registra come una qualsiasi voce trovata dalla
rassegna. Compare nella Libreria alla prima sincronizzazione dell'app.

Senza indicazioni, il **nome del file** diventa il titolo: `Analisi dei piani
di esecuzione.pdf` → *Analisi dei piani di esecuzione*. Il resto viene
indovinato, e indovinare sul tema sbaglia spesso.

## Dare i dati giusti invece di quelli indovinati

Accanto al PDF si può mettere un file con lo stesso nome ed estensione `.json`:

    biblioteca-manuale/
      piani-di-esecuzione.pdf
      piani-di-esecuzione.json

```json
{
  "titolo": "Analisi dei piani di esecuzione in PostgreSQL",
  "autore": "Nome Cognome",
  "tema_slug": "ottimizzazione",
  "trimestre": "T1",
  "licenza": "CC BY 4.0"
}
```

Tutti i campi sono facoltativi: quelli presenti vincono sul nome del file,
quelli assenti restano indovinati.

- `tema_slug` — uno dei temi del piano di studio. L'elenco completo, con il
  trimestre di ciascuno, è in `strumenti/rassegna/specializzazioni.py`:
  `sql_base`, `ottimizzazione`, `lettura_codice`, `modellazione`, `statistica`,
  `epidemiologia`, `kpi`, `qualita_dati`, `gdpr`, `ai_act`, `ia`, `sicurezza`,
  `hardware`, `governance`, `business_analysis`, `meal`, `salute_digitale`.
- `trimestre` — da `T1` a `T6`. Se manca, si prende quello del tema.
- `licenza` — come la dichiara chi distribuisce il testo (`CC BY 4.0`,
  `pubblico dominio`, `uso personale`…).

## Una sola avvertenza

Questa cartella sta dentro il repository: ciò che ci finisce resta nella
cronologia di git. Va bene per un testo che si ha il diritto di conservare —
la stessa regola che governa tutta la biblioteca del progetto. Un documento
riservato, o di lavoro, non va qui.
