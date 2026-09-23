# Prompt per Claude Code — sistema di fonti con autoguarigione

> Copia tutto da qui in giù e incollalo in Claude Code, dalla radice del repository.
> Prima copia la cartella `consegna_code/` nella radice del repository.

---

## Contesto

Nel repo c'è una pipeline quotidiana (08:00) che legge le fonti da `percorso.fonti` (Supabase, progetto `hgvzjeituvvwtskbxzzl`), classifica le voci per 17 temi e costruisce la biblioteca offline.

In `consegna_code/` trovi un sottosistema che:
- verifica le fonti;
- le **ripara da solo** quando cambiano (URL, dominio, feed sparito);
- scopre nuove fonti per keyword.

È stato provato su risposte HTTP reali. L'utente **non potrà intervenire in produzione**: tutto deve funzionare senza supervisione, e ogni errore deve fermarsi prima di toccare la base dati.

Leggi, in quest'ordine, prima di scrivere codice:

1. `consegna_code/HANDOFF-FONTI-CODE.md` §10 (prova reale, protezioni, runbook) e §8 (moduli).
2. `consegna_code/fonti_core.py`: rete, punteggio, autoscoperta, licenza, paywall, **guarigione profonda** (sezione `CURACIÓN PROFUNDA`).
3. `consegna_code/verifica_fonti.py`:
   - `verifica()`, `curar()`, `disyuntor()`, `salud()`, `sql_salida()`, `__main__`.
4. `consegna_code/temi_config.py`: tutti i parametri, niente è cablato nel codice.
5. `consegna_code/lessico_patch.py`: `MEDIDO`, `DOMINIO`.
6. `PROMPT-FONTI.md` (già nel repo): contratto originale. §3 lessico, §6 rumore e licenze, §8 i 7 passi.

Stato di partenza verificato: `python3 test_fonti.py` → 15/15; `python3 test_adversarial.py` → 37/37.

---

## Regole

- Non rompere nessun test esistente. Ogni correzione ha un nuovo test in `test_adversarial.py` che **fallisce prima** e passa dopo.
- Nessuna fonte si attiva senza passare da `verifica_fonti.py` → `activar.sql`.
- Non applicare mai `activar.sql` durante i test. Non scrivere in `percorso.*` salvo al compito 6, con conferma dell'utente.
- Nessuna chiave API nuova. Rete solo tramite `fonti_core.fetch()`.
- Le decisioni già prese restano come sono in `temi_config.py`:
  - `LICENCIA_AMPLIA=True`;
  - `USAR_DOMINIO=True`;
  - interruttori 40% / 50%.
- Messaggi e commenti nella lingua in cui sono già scritti.

---

## Compiti, in ordine (non passare al successivo senza aver soddisfatto il criterio)

### 1. Correggere il falso positivo reale di ReliefWeb (bloccante)

**Sintomo, osservato su dati reali.**
- Chiamata: `sintetizar_feed('https://reliefweb.int/')`.
- Risultato: un feed con la pagina `https://reliefweb.int/countries` (datata 2026 solo tramite `<lastmod>` del sitemap) e 4 rapporti del 2007–2009.
- Effetto: la voce «Countries» fa passare p0 (freschezza) e la fonte risulta `ACEPTADA`.

**Correzione richiesta in `fonti_core.sintetizar_feed()`:**

a. **Data affidabile.** `<lastmod>` non è una data di pubblicazione. Una voce la cui data viene **solo** da `lastmod`:
   - resta nel feed;
   - si segna come `fecha_debil`;
   - non deve contare per la freschezza.

   Implementazione suggerita: non scrivere `pubDate` per quelle voci, oppure non restituirle se non ci sono altre date.

b. **Freschezza del feed sintetizzato.** Si accetta solo se ci sono **almeno 3 voci** con data affidabile negli ultimi `MAX_DIAS_SIN_PUBLICAR` giorni. Nuovo parametro `SINTESIS_MIN_RECIENTES = 3` in `temi_config.py`.

c. **Pagine di navigazione.** Escludere gli URL con un solo segmento e senza trattino (`/countries`, `/updates`, `/blog`).

**Test da aggiungere.**
- **H10**, in `test_adversarial.py`: riproduce esattamente il caso.
  - Un sitemap con `/countries` (`lastmod` 2026, `<main>` lungo) e 4 rapporti con `datePublished` 2007–2009.
  - Atteso: `sintetizar_feed` restituisce `None`, oppure `verifica()` non dà `ACEPTADA`.
- **H11**: lo stesso sitemap con 3 articoli con `article:published_time` recenti → il feed viene accettato.

**Criterio:** H1–H11 passano; test_adversarial ≥ 39/39; test_fonti 15/15.

### 2. Supporto `metodo='sitemap'` nella pipeline (bloccante)

- La guarigione può riscrivere `url_feed='sitemap:https://sito/'` e `metodo='sitemap'`.
- La pipeline delle 08:00 oggi legge solo `rss`.
- Da fare:
  - trova il punto in cui la pipeline scarica e analizza i feed (cerca `feedparser` e `metodo` nel repo);
  - per `metodo in ('rss','sitemap')` usa `fonti_core.feed(url_feed)`, che gestisce entrambi e decomprime gzip/deflate.

**Criterio:**
- Un test di integrazione con una fonte `sitemap:` simulata genera voci nella pipeline.
- Le fonti `rss` si comportano esattamente come prima (confronto dell'output su un fixture).

### 3. Fondere il lessico nel classificatore reale (bloccante)

Oggi il verificatore usa una **replica** del classificatore (`fonti_core.FUERTES`, `punteggio`, `norm`, `es_rumore`). La produzione deve usare una sola fonte di verità.

a. Individua il classificatore reale: cerca la lista rumore `'round di finanziamento'` e i termini `'data minimisation'`.

b. Fondi nel lessico **forte** reale `lessico_patch.MEDIDO` + `lessico_patch.DOMINIO`, e nel lessico **debole** reale `temi_config.RELACIONADOS`.
   Pesi: forte 1.5 titolo / 1.0 sommario; debole 0.6 / 0.4.

c. Il filtro rumore reale deve confrontare **parole intere** (`f' {x} ' in norm(t)`), non sottostringhe. Caso reale: `valuation` catturava `evaluation`.

d. Le voci con **solo** termini deboli vanno in `correlati`: non contano come «utili».

e. Sostituisci in `fonti_core` la replica con import dal modulo reale. Una sola implementazione.

**Criterio:**
- Test A4, A5, A11 e 10 continuano a passare usando il classificatore reale.
- Nuovo test: `'Cheating behaviour in frontier model evaluations'` non è rumore; `'Acme raises Series B at $1B valuation'` sì.

### 4. Quota `esplorazione` (non bloccante)

- Nella pipeline: al massimo `temi_config.ESPLORAZIONE_MAX_DIA` voci al giorno senza tema, ma con testo ≥ `ESPLORAZIONE_MIN_CHARS` o con un segnale di `ESPLORAZIONE_SEGNALI`.
- Vanno sotto uno slug `esplorazione`, separato dai 17 temi.

**Criterio:** test con 10 voci candidate → ne entrano esattamente 5.

### 5. Schedulazione e persistenza (bloccante)

- `verifica_fonti.py fonti_v4.sql`:
  - **settimanale**, prima della corsa delle 08:00;
  - la cartella di lavoro deve **persistere** `estado_verifica.json` tra le corse (conta i fallimenti di rete e le fonti accettate precedenti per l'interruttore).
- `scopri_fonti.py fonti_v4.sql --temi <temi con 0 fonti in salud.md>`: **mensile**.
- Gestione dei codici di uscita di `verifica_fonti.py`:

| codice | azione |
|---|---|
| 0 | applicare `activar.sql` |
| 2 | applicare `activar.sql` e lanciare `scopri_fonti.py` per i temi con ⚠️ in `salud.md` |
| 3 | **non applicare nulla**; riprovare alla corsa successiva; dopo 3 corse consecutive con 3, notificare |
| 1 | notificare, non applicare |

- `activar.sql` si applica in **una sola transazione**; se fallisce, rollback completo.

**Criterio:** test dello scheduler che simula i codici 0, 2, 3 e verifica che con 3 la base resta intatta.

### 6. Prima esecuzione reale (con conferma dell'utente)

1. Esegui `python3 test_fonti.py && python3 test_adversarial.py` e tutti i test nuovi. Tutto verde.
2. Esegui `python3 verifica_fonti.py consegna_code/fonti_v4.sql` dall'ambiente di produzione (rete reale).
3. Mostra all'utente `salud.md` e il riepilogo di `informe.csv` (accettate per tema, riparate, REVISAR).
4. **Solo dopo la conferma esplicita dell'utente:** carica `fonti_v4.sql` e applica `activar.sql`.
5. `diagnosi.py --fonti` finale: ogni tema riceve voci?

**Criteri di confronto.** La prova reale del 23/09 ha dato 25/57 accettate (`informe_prueba_real_2026-09-23.csv`).
- Una differenza di ±5 è normale: i feed cambiano.
- Se il risultato è molto più basso ed è scattato l'interruttore, il problema è la rete, non il codice.

---

## Fatti verificati su dati reali (non rimetterli in discussione senza prove)

- **Autoguarigione riuscita:**

| fonte | nuovo `url_feed` | come |
|---|---|---|
| Flux Capacitor | `/blog/feed.xml` | feed standard trovato |
| SSI | `/rss` | feed standard trovato |
| Health Intersections | `/rss.xml` | feed standard trovato |
| Visualising Data | `/feed/atom/` | feed standard trovato |
| Ada Lovelace | `sitemap:` | sitemap, contenuti reali 2026 |
| HPN | `sitemap:` | sitemap, contenuti reali 2026 |

- **Irrecuperabili, con il motivo corretto:**
  - Use The Index Luke: blog morto da dic-2024;
  - EDPS: 403 su tutto.
- **Licenze:** le 11 aperte rilevate sono state lette una per una sulla pagina reale. CNIL è `CC BY-ND 4.0` per i testi, **non** `CC BY-NC-SA` (quella riguarda le illustrazioni).
- **Paywall rilevato:** Pragmatic Engineer, Luiza Jarovsky.
- **gzip:** alcuni server lo inviano senza che venga richiesto; `fetch()` decomprime (verificato dal vivo).

## Consegna attesa da Code

- PR con i compiti 1–5, un commit per compito.
- Output di tutti i test.
- Aggiornare `HANDOFF-FONTI-CODE.md` con una §11 «Integrazione»: cosa è cambiato, dove sta il classificatore unico, come è schedulato.
- Elenco esplicito di qualsiasi cosa **non** sia stata completata.
