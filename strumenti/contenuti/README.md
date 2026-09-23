# Percorso — contenuti pre-caricati

Materiale di studio da impacchettare nell'app **prima del 1 ottobre**. Tutto funziona **senza connessione**: è il contenuto pensato per la finestra 2 ottobre – 23 novembre.

**381 item di studio.**

## Contenuto

| File | Cosa contiene | Item |
|---|---|---|
| `palestra.db` | Database SQLite di allenamento, 14 tabelle, 2 MB | ~26.000 righe |
| `esercizi_sql.json` | Esercizi SQL livello 1-4, ognuno con soluzione di riferimento | 150 |
| `esercizi_codice.json` | Moduli Python con un difetto deliberato, correzione e test | 20 |
| `flashcard.json` | Schede domanda/risposta, ognuna con fonte citata | 199 |
| `scenari_rubrica.json` | Scenari senza risposta unica, valutati a rubrica | 12 |
| `fonti.json` | Fonti della rassegna con peso e categoria | 38 |
| `esclusioni_rassegna.json` | Termini che azzerano il punteggio di un articolo | 31 |
| `seed_percorso.sql` | Inserimenti pronti per lo schema `percorso` su Supabase | — |

## Come è garantita la correttezza

Nessun esercizio è stato accettato sulla fiducia.

**1. Esercizi SQL (150/150).** Ogni soluzione di riferimento viene **eseguita** contro `palestra.db`. Un esercizio entra solo se la query gira senza errori, restituisce almeno una riga e due esecuzioni danno lo stesso risultato. Nel JSON sono salvati `righe_attese`, `colonne_attese` e un'anteprima: l'app verifica la tua risposta **confrontando il risultato**, non il testo della query. Una soluzione diversa ma corretta passa comunque. Gli esercizi con chiave `preparazione` creano indici o tabelle e girano su una copia temporanea del database.

**2. Lettura del codice (20/20).** Ogni esercizio contiene un modulo difettoso, la versione corretta e un test. Il verificatore controlla che il test **fallisca** sul codice difettoso e **passi** sulla correzione. Se il bug non è dimostrabile per esecuzione, l'esercizio viene rifiutato: in questo lotto ne sono stati scartati e riscritti 5 proprio per questo motivo. Non è un giudizio a stabilire che c'è un difetto — è l'esecuzione.

**3. Flashcard (199).** Ogni scheda porta `fonte` e `riferimento` puntuali: articolo di regolamento, clausola di norma, capitolo. Lo script di impacchettamento **rifiuta** una scheda priva di citazione o con risposta sotto i 40 caratteri.

**4. Scenari (12).** Nessuna risposta corretta unica. Ognuno ha una rubrica di almeno 4 criteri per l'autovalutazione.

## Copertura per area

| Area | SQL | Flashcard | Altro |
|---|---|---|---|
| SQL fondamenti, join, aggregazione | 49 | — | — |
| Window functions | 23 | — | — |
| Piani di esecuzione e indici | 18 | — | — |
| CTE e ricorsione | 16 | — | — |
| Qualità dei dati | 14 | — | — |
| Modellazione dimensionale | 10 | 25 | — |
| MEAL, epidemiologia | 20 | — | — |
| GDPR e protezione dati | — | 25 | 2 scenari |
| AI Act e governance IA | — | 12 | 2 scenari |
| KPI e misurazione | — | 20 | 2 scenari |
| Hardware e reti | — | 22 | 1 scenario |
| Business analysis e BPMN | — | 15 | 2 scenari |
| ITIL e governance dei servizi | — | 15 | — |
| ISO 27001 e sicurezza | — | 15 | — |
| DHIS2 e HL7 FHIR | — | 24 | — |
| Statistica applicata | — | 26 | — |
| Lettura e verifica del codice | — | — | 20 moduli |

## Il database di allenamento

Dati **sintetici**, seed fisso 42, riproducibili identici. Nessun dato reale.

**Dominio clinico:** `strutture`, `pazienti`, `visite`, `diagnosi`, `prescrizioni`, `vaccinazioni`, `esami_lab`
**Dominio umanitario:** `progetti`, `siti`, `valutazioni`, `indicatori`, `misurazioni`, `distribuzioni`, `personale`

**Anomalie inserite di proposito**, per gli esercizi di qualità dei dati: misurazioni con valore nullo (~6%), valutazioni chiuse senza alcuna misurazione (~5%), distribuzioni con beneficiari superiori alla quantità, strutture senza visite, siti senza distribuzioni.

## Caricare su Supabase

```sql
-- sostituire prima l'uuid utente nella terza riga del file
\i seed_percorso.sql
```

Prerequisito: schema `percorso` già presente nel progetto `hgvzjeituvvwtskbxzzl`, e `percorso` aggiunto fra gli **Exposed schemas** nelle impostazioni API.

## Rigenerare e verificare

```bash
python3 genera_palestra.py    # ricostruisce il database
python3 verifica_esercizi.py  # esegue e valida le 150 query
python3 verifica_codice.py    # dimostra i 20 bug per esecuzione
python3 impacchetta.py        # valida le schede e riscrive JSON + seed SQL
```

I due verificatori escono con codice 1 se anche un solo esercizio fallisce: si prestano a essere messi in CI.

## Rischio tecnico da verificare per primo sul dispositivo

41 esercizi usano **window functions**, disponibili solo da SQLite 3.25. Prima di impacchettare, esegui su telefono e tablet:

```sql
SELECT sqlite_version();
```

Sotto la 3.25 serve un motore SQLite incluso nell'app (`expo-sqlite` recente oppure `op-sqlite`) invece di quello di sistema.

## Come usare il blocco di lettura del codice

È il blocco che vale di più e va usato in un ordine preciso:

1. Leggi il modulo difettoso e scrivi la tua ipotesi **prima** di guardare altro.
2. Esegui il test e osserva come fallisce.
3. Solo allora confronta con il campo `difetto`.
4. Correggi tu il codice e rilancia il test.

Saltare il passo 1 trasforma l'esercizio in lettura passiva e ne annulla il valore.

## Licenze

Dati sintetici generati per questo progetto. Le flashcard citano fonti pubbliche — regolamenti UE, norme ISO, NIST, standard HL7 e DHIS2, letteratura tecnica — senza riprodurne il testo: sono riformulazioni con riferimento puntuale per il controllo indipendente.
