# Handoff a Code: fonti RSS per la rassegna quotidiana

Stato al 23 settembre 2026. Sostituisce `deepseek_markdown_20260923_cfc134.md`.
Riferimento normativo: `PROMPT-FONTI.md` (§ citati sotto).

---

## 0. TL;DR

- **Fonti attive proposte: 0.** Nessuna fonte ha una licenza verificata (§8.7) e,
  con il lessico attuale, nessuna supera 4/10 nella replica del classificatore.
- Il collo di bottiglia **non è la ricerca**. Sono tre cose:
  1. il lessico (locuzioni esatte);
  2. il gate di licenza;
  3. una possibile bug del filtro rumore (§3, B1).
- Consegnato in questa sessione:
  - `fonti_v3.sql`: 57 fonti su 17 temi, tutte `attiva=false`;
  - `verifica_fonti.py`: esegue i passi 0–6 di §8 e genera `activar.sql`;
  - `lessico_patch.py`: estensione del lessico con effetto misurato.
- Il lavoro di Code: verificare il bug, fondere il lessico, integrare e schedulare
  il verificatore, eseguirlo sulle 57 fonti. Le licenze le compila l'utente.

---

## 1. File consegnati

| file | contenuto | stato |
|---|---|---|
| `fonti_v3.sql` | 2 `update` di pulizia (disattiva righe v1/v2) + `insert` di 57 fonti, `attiva=false` | parse Postgres OK (`pglast`) |
| `verifica_fonti.py` | passi p0–p6 di §8, p7 via dizionario `LICENCIAS`; scrive `informe.csv`, `activar.sql` (attiva **e** disattiva), `estado_verifica.json` | testato con controlli positivi e negativi |
| `lessico_patch.py` | `MEDIDO` (effetto misurato) e `NO_MEDIDO` (non testato); `aplicar(lessico, incluir_no_medido=False)` | — |

---

## 2. Risultati misurati

Tutte le cifre vengono dalla **replica** del classificatore:
- solo l'estratto dei termini forti di §3;
- nessun termine debole, nessuno stemming;
- titolo ×1.5, soglia 1.0.

Sono quindi **limiti inferiori**. L'arbitro è `diagnosi.py`.

### 2.1 Il lessico è il collo di bottiglia

Fonti pertinenti, prime 10 voci (tra parentesi: voci 11–20, validazione su dati non usati per costruire il patch):

| fonte (`url_feed`) | lessico attuale | con `MEDIDO` | tema principale con patch |
|---|---|---|---|
| UK AISI (`raw.githubusercontent.com/Olshansk/rss-feeds/main/feeds/feed_aisi.xml`) | 0/10 | 8/10 (5/10) | `ia` 5, `sicurezza` 3, `governance` 1 |
| Anthropic Red (`…/feed_anthropic_red.xml`) | 0/10 | 8/10 (6/10) | `sicurezza` 6, `ia` 3 |
| FAR.AI (`…/feed_far_ai.xml`) | 2/10 | 8/10 (9/10) | `ia` 10 |
| Anthropic Engineering (`…/feed_anthropic_engineering.xml`) | 0/10 | 5/10 (3/10) | scartata: instabile |

Causa: il classificatore vuole la locuzione esatta. `evals`/`evaluations` non fa
scattare `model evaluation`; `red team` non fa scattare `red teaming`.

### 2.2 Feed scartati con evidenza

| feed | motivo |
|---|---|
| `cdc.gov/mmwr/rss/mmwr.xml` | congelato: ultima voce 28/06/2018, `description` vuota, contiene errata |
| `github.com/dhis2/dhis2-core/releases.atom` | titoli = numero di versione, 0/10 |
| `github.com/openmrs/openmrs-core/releases.atom` | come sopra, 0/10 |
| `github.com/HL7/fhir/releases.atom` | 3 voci, l'ultima del 2023 |
| `github.com/hapifhir/hapi-fhir/releases.atom` | titoli `vX.Y.Z`, 0/10 |
| EleutherAI Papers (Olshansk) | link verso arxiv.org (doppione di cs.LG/cs.CL), 0/10 |
| Transluce (Olshansk) | 13 voci totali, sommari di 56–125 caratteri |
| Dagster (Olshansk) | blog di prodotto |
| Bing News RSS (17 feed `news:<slug>`) | **rifiutati**: ordinati per rilevanza (non per data), testate generaliste (§1), nessuna licenza per voce (§6c) |

### 2.3 Non verificabili dall'ambiente di questa sessione

- Rete limitata a GitHub e PyPI.
- Lo strumento web rifiuta URL costruiti.
- ReliefWeb blocca i bot.

**54 dei 57 `url_feed` non sono mai stati scaricati.** L'etichetta `H`/`M` nel file SQL indica confidenza a memoria, **non** verifica.

---

## 3. Compiti per Code, in ordine

### B1. Verificare il filtro rumore (§6b) — PRIMO

**Sospetto:** se il filtro confronta **sottostringhe**, allora `valuation`
(nella lista rumore) cattura `evaluation`. Ogni titolo con `monitoring and
evaluation`, `humanitarian evaluation` o `model evaluation` verrebbe scartato,
cioè il nucleo di `meal` e metà di `ia`.

Nella replica il bug esisteva e faceva scendere AISI da 8 a 5/10. Stesso rischio
per `hires` dentro `hiresolution`, `nomina` dentro `nominal`, `slams`, ecc.

- **Azione:** trovare nel codice la lista rumore (`round di finanziamento … acquires`)
  e controllare come confronta.
- **Correzione:** confronto a confine di parola sul titolo normalizzato,
  come in `verifica_fonti.py`: `f' {x} ' in norm(t)`.
- **Test di accettazione:**
  - `Cheating behaviour in frontier model evaluations` NON viene scartato;
  - `Acme raises Series B at $1B valuation` SÌ viene scartato.

### B2. Fondere il lessico

- Fondere `lessico_patch.MEDIDO` nel lessico forte reale.
- `NO_MEDIDO` resta fuori finché non esiste un feed di prova che ne misuri l'effetto.
  Contiene: `rgpd`, `dati personali`, `données personnelles`, `datos personales`,
  `postmortems`, `post-mortem`, `incident review`.
- **Attenzione:** `cyber` e `llm` da soli aumentano i falsi positivi se in futuro
  entrano testate generaliste.
- **Test:** `diagnosi.py --fonti` sui 3 feed di §2.1 → almeno 4 voci con tema su 10.

### B3. Collegare il verificatore al classificatore reale

- `verifica_fonti.py` contiene una **replica** del lessico e del punteggio
  (funzioni `punteggio`, `norm`, dizionario `L`, lista `RUMORE`).
- Sostituirle con un **import dal modulo reale** del classificatore, così la
  verifica e la produzione non possono divergere.
- Il flag `--sin-parche` resta solo finché B2 non è fatto.
- **Test:** stesso risultato di `diagnosi.py` sulle 3 fonti di §2.1.

### B4. Eseguire sulle 57 fonti

```bash
psql … -f fonti_v3.sql
python3 verifica_fonti.py fonti_v3.sql
```

- Leggere `informe.csv`.
- Il campo `motivo` spiega ogni rifiuto: `p0` morto, `p2` ordine, `p3` k/10,
  `p6` duplicati, `p7` senza licenza, `TRANSITORIO`, `caído N corridas seguidas`.
- Non applicare `activar.sql` finché l'utente non ha compilato `LICENCIAS` (§4).

### B5. Schedulare

- Eseguire `verifica_fonti.py` **prima** della corsa delle 08:00, almeno settimanalmente,
  e applicare `activar.sql`.
- Serve continuità: senza schedulazione, un feed che muore resta attivo.
- `estado_verifica.json` deve **persistere tra le esecuzioni**: conta i fallimenti di rete consecutivi.

### B6. Controllo finale

`diagnosi.py --fonti`: per ciascuno dei 17 slug, quante voci arrivano e quante prendono tema.

---

## 4. Decisioni aperte (dell'utente, non di Code)

| id | decisione | effetto |
|---|---|---|
| A | Come si interpreta §6c: basta «licenza dichiarata» (anche «tutti i diritti riservati» + URL) o serve licenza aperta? | Lettura larga: quasi tutti i blog passano. Lettura stretta: quasi nessuno. Oggi 0 attivazioni. |
| D | Obiettivo «quotidiano per tema» o «quotidiano a livello di biblioteca»? | Con §1 + §6c come regole dure, il quotidiano per tema non è garantito da nessuna fonte verificata. |

Licenze già note:

| fonte | licenza | dove è dichiarata |
|---|---|---|
| Eurosurveillance | CC BY | `https://doaj.org/toc/1560-7917` (già in `LICENCIAS`; il suo `url_feed` non è verificato) |
| UK AISI | OGL v3.0 probabile | nessuna dichiarazione trovata su aisi.gov.uk → non inserita |

---

## 5. Catalogo in `fonti_v3.sql`

Livelli: **D** notizie quotidiane · **A** imparare · **P** professionalizzarsi.

Confidenza:
- **V** = misurata in sessione;
- **H** = URL con schema standard, non scaricato;
- **M** = incerta.

| slug | fonti (livello/confidenza) | copertura |
|---|---|---|
| sql_base | Postgres Weekly D/H · Use The Index Luke A/M · Modern SQL A/M · Haki Benita A/M | ok |
| ottimizzazione | Database Architects A/H · Small Datum P/H · jOOQ A/H | ok |
| modellazione | Joe Reis A/H · Martin Fowler P/H · benn P/H · Data Products P/M | ok |
| lettura_codice | Tidy First A/H · Julia Evans A/H · Pragmatic Engineer P/H (possibile paywall) | ok |
| statistica | R-bloggers D/H · Gelman A/H · Frank Harrell A/M | ok |
| epidemiologia | Eurosurveillance D/M · Your Local Epi D/H · Force of Infection A/M | manca il PDF ECDC CDTR |
| kpi | Nightingale A/H · Visualising Data P/H · FlowingData D/H · Storytelling w Data A/H · Datawrapper A/M | dataviz, **non** framework di indicatori |
| qualita_dati | rOpenSci P/H · SSI P/M | **debole** |
| gdpr | CNIL P/H (in francese: usa `RGPD`) · EDPS P/M · TeachPrivacy A/H · Olejnik A/M | nessuna fonte verificata per la DPIA |
| ai_act | AlgorithmWatch D/H · Ada Lovelace Inst P/M · Luiza Jarovsky D/M (possibile paywall) | nessuna fonte verificata per la policy IA |
| ia | UK AISI P/V · FAR.AI A/V · Hamel Husain P/H · Eugene Yan P/H · Latent Space D/H | ok con B2 |
| business_analysis | Flux Capacitor A/M | **debole** |
| governance | SRE Weekly D/V* · charity.wtf P/H · Surfing Complexity A/H | ok |
| hardware | APNIC D/H · Cloudflare D/H (rischio rumore prodotto) · ODK Forum P/H · Low-tech Magazine A/M | backbone, non campo |
| sicurezza | Anthropic Red P/V · NCSC UK P/H · SANS ISC D/H | ok con B2 |
| meal | ReliefWeb Assessments D/M (blocca i bot) · MERL Tech P/M · HPN P/M | dipende da B1 |
| salute_digitale | ICTworks D/V* · Health Intersections P/H · OpenMRS Talk P/H · JMIR A/M (doppione accademico) | ok |

\* V* = verificata solo come «risponde» nell'handoff precedente; punteggio mai misurato.

---

## 6. Parametri propri (non del prompt), dichiarati

| parametro | valore | nota |
|---|---|---|
| `MAX_DIAS_SIN_PUBLICAR` | 365 | §7.4 ammette cadenza mensile o rara |
| `UMBRAL_DISTINTOS` | 0.8 | il passo 6 non fissa una soglia |
| `MAX_FALLOS_TRANSITORIOS` | 3 | corse consecutive con errore di rete prima di disattivare |
| timeout per connessione | 20 s | — |
| p4 (tipo di link) | richiesta HEAD sulle prime 3 voci | se il server la rifiuta → `error`, non bloccante |

---

## 7. Cosa NON fare

- Non attivare fonti senza passare da `verifica_fonti.py` → `activar.sql`.
- Non reintrodurre feed di motori di ricerca (Bing, Google News/Alerts) senza la decisione D.
- Non fondere `NO_MEDIDO` senza un feed di prova.
- Non dichiarare «verificato» ciò che ha confidenza H/M.
- Non affermare che gli obiettivi sono chiusi finché B1–B6 e le decisioni A e D non sono risolti.

---

## 8. Aggiornamento v4: autoriparazione, temi correlati, scouting per keyword

Sostituisce `verifica_fonti.py` v3. Moduli:

| file | ruolo |
|---|---|
| `fonti_core.py` | rete, punteggio, autoscoperta feed, licenza, paywall, dominio |
| `temi_config.py` | parametri modificabili senza toccare il codice |
| `verifica_fonti.py` | CLI §8 (p0–p9) con autoriparazione |
| `scopri_fonti.py` | CLI di scouting per keyword |
| `test_fonti.py` | 15 test deterministici senza rete |

### 8.1 Autoriparazione di `url_feed`

In quest'ordine:
1. Redirect permanente 301/308 → canonicalizza l'URL.
2. Feed 404, vuoto o morto (>365 giorni) → autoscoperta su `url_sito`: prima `<link rel="alternate">`, poi suffissi standard (`SUFIJOS_FEED`).
3. Tra i candidati vince quello con più voci utili.

Esito:
- `activar.sql` riceve `update ... set url_feed` con protezione anti-conflitto.
- Il TRANSITORIO non ripara e non disattiva.

Testato:
- dal vivo: `releases.atomX` rotto → `releases.atom` scoperto;
- con fixture: 404, suffissi, 301, feed morto, irreparabile.

### 8.2 Temi correlati ed esplorazione

- `RELACIONADOS`: livello **debole** (0.6 titolo / 0.4 sommario). Da soli non arrivano a 1.0; due insieme sì.
  **Compito per Code:** fonderli nel lessico debole del classificatore reale, altrimenti verificatore e pipeline divergono.
- `esplorazione`: voce senza tema, non rumore, con testo ≥1500 caratteri o con un segnale (`case study`, `lessons learned`…).
  **Compito per Code:** quota giornaliera `ESPLORAZIONE_MAX_DIA = 5` nel pipeline.
- `RUMORE_EXTRA` per tema (es. `pricing` è rumore in `ia`, non in `meal`), sempre a confine di parola.

### 8.3 Controlli aggiunti (correggono i buchi di verifica)

- **p8 canale:** il `<link>` del canale deve appartenere allo stesso dominio di `url_sito`. I mirror di Olshansk sono coerenti (verificato dal vivo).
- **p9 paywall:** scarica 3 articoli e cerca le marche di `MARCAS_PAYWALL`. Se più di 1 articolo su 3 ha il paywall → rifiutata.
  Se nessun articolo è scaricabile risulta `0/0`: informativo, non bloccante.
- **p7 automatico:** rileva CC (link a creativecommons.org), OGL e `rel=license` nella home.
  `--licencia-amplia` accetta anche «Copyright» (= decisione A).

### 8.4 Scouting per keyword (`scopri_fonti.py`, fuori dalla corsa delle 08:00)

Catena:
1. Keyword del lessico.
2. Domini che la citano: HN Algolia; API ReliefWeb (solo temi umanitari, richiede `appname`); liste «awesome» di GitHub.
3. Esclusione di domini noti, generalisti e social.
4. Autoscoperta del feed.
5. `verifica()` completa.
6. `proponer.sql` con `attiva=false`, peso 0.3.

Si attiva solo passando da `verifica_fonti.py`.

Stato dei test:
- liste awesome: dal vivo;
- HN, ReliefWeb e la catena completa: solo con fixture (rete della sessione limitata);
- limiti di uso delle API segnalati come `AVISO`, mai come «zero domini».

### 8.5 Compiti aggiuntivi per Code

- **B7.** Fondere `RELACIONADOS` nel lessico debole reale.
- **B8.** Quota `esplorazione` nel pipeline.
- **B9.** Schedulare `scopri_fonti.py` mensilmente, con `--reliefweb-appname` registrato (ReliefWeb richiede un `appname`; non verificato se serva approvazione preventiva).
- **B10.** Eseguire `python3 test_fonti.py` in CI: deve dare 15/15.

---

## 9. Test avversariali (v4.1)

`test_adversarial.py`: 15 attacchi al sistema. Sulla v4 ne fallivano 8, tutti corretti:

| id | attacco | difetto in v4 | correzione |
|---|---|---|---|
| A1 | la home punta a un feed su dominio estraneo | autoriparazione verso il dominio estraneo | riparazione automatica solo nello stesso sito (o host di `HOSTS_FEED_ADMITIDOS`); altrimenti `REVISAR` |
| A2 | 301 verso un altro dominio (dominio venduto) | accettata | `REVISAR redirección a otro dominio` |
| A3 | voce con data futura | segnata «morta» → riparazione di un feed sano | date in UTC (`calendar.timegm`); data futura = 0 giorni |
| A4 | fonte con solo vocabolario debole generico | 10/10 accettata | le voci utili richiedono ≥1 termine forte; quelle solo deboli vanno in `p3_correlati` |
| A5 | «ai» preposizione italiana | classificata `ia` | tolti `ai` e `process` da `RELACIONADOS` |
| A6 | licenza CC di una foto nel corpo | presa come licenza del sito | CC/OGL/copyright solo nel `<footer>` (o nell'ultimo 15% / 1500 caratteri); `rel=license` ovunque |
| A7 | post che *parla* dell'OGL | presa come OGL | come A6 |
| A8 | a capo nel testo remoto finito in un commento SQL | **SQL rotto / iniettabile** | commenti ripuliti (`com()`); verificato che si generano solo UPDATE/INSERT |

Più 7 attacchi che la v4 già reggeva o che coprono nuovo comportamento: A9–A15.

| id | copertura |
|---|---|
| A9 | SQL senza spazi dopo le virgole: letto |
| A10 | un Substack noto non esclude gli altri: piattaforme identificate per host completo |
| A11 | articoli non scaricabili + sommario corto → rifiuto |
| A12 | una marca paywall isolata non rifiuta |
| A13 | rete caduta sugli articoli → TRANSITORIO |
| A14 | 403 sugli articoli + sommario corto → rifiuto |
| A15 | formato SQL non riconosciuto → interrompe senza `activar.sql` |

Risultato: `test_fonti.py` 15/15, `test_adversarial.py` 15/15.

### Rischi residui dichiarati (non testabili o accettati)

- Un proxy aziendale che risponde 403 viene letto come «blocco» → rifiuto (A14).
  Nell'ambiente della sessione il proxy ha fatto proprio questo (`x-deny-reason: host_not_allowed`).
- Qualunque `raw.githubusercontent.com` è ammesso come destinazione di riparazione per le fonti mirror.
- I feed senza date falliscono p0.
- I marcatori paywall sono una lista finita: un paywall in JavaScript senza testo non viene rilevato,
  ma se il testo scaricato è corto scatta A11/A14 solo quando nessun articolo è scaricabile.
- I test sono scritti dallo stesso autore del codice. Serve una revisione indipendente (Code).

---

## 10. Prova nel mondo reale e messa in produzione (v5)

### 10.1 Metodo

Le risposte HTTP reali sono state scaricate con `pg_net` dal progetto Supabase dell'utente (circa 350 richieste: feed, home, candidati, articoli, pagine di termini).
Il codice **reale** (`verifica_fonti.verifica_segura`) è stato eseguito su quelle risposte.

- Nessuna scrittura nelle tabelle `percorso`.
- Le risposte restano in `net._http_response`, che si svuota da sola.
- Il percorso di redirect (301) è stato provato dal vivo con `urllib` su GitHub:
  `http://…releases.atom` → canonicalizzato a `https://…`.

### 10.2 Risultati su dati reali (`informe_prueba_real_2026-09-23.csv`, `salud_prueba_real_2026-09-23.md`)

- **Feed funzionanti così come scritti:** 48/57.
- **Riparati automaticamente (3):**

| fonte | nuovo `url_feed` |
|---|---|
| Flux Capacitor | `/blog/feed.xml` |
| SSI | `/rss` |
| Health Intersections | `/rss.xml` |

  Già corretti in `fonti_v4.sql`.
- **Irreparabili, disattivati con motivo corretto (6):**

| fonte | motivo |
|---|---|
| Use The Index Luke | feed morto da dic-2024 |
| Visualising Data | risposta vuota |
| EDPS | 403 |
| Ada Lovelace | feed senza voci |
| ReliefWeb | blocco anti-bot, 202 |
| HPN | nessun feed |

- **Licenze rilevate:** 11 licenze aperte. Ciascuna verificata leggendo il testo reale, in una di queste forme:
  - footer della home;
  - `rel=license`;
  - pagina di termini collegata dal footer (NCSC OGL, FAR.AI, ODK, CNIL CC BY-ND).
- **Paywall:** Pragmatic Engineer e Luiza Jarovsky rilevati. Una marca isolata su un post gratuito non fa rifiutare la fonte.
- **Fonti accettate: 25/57** (prima 4/57). Temi senza fonte: `ai_act`, `governance`, `qualita_dati` (segnalati in `salud.md`).

### 10.3 Difetti trovati SOLO con dati reali e corretti

Ogni correzione ha il suo test in `test_adversarial.py`.

| id | caso reale | difetto | correzione |
|---|---|---|---|
| A16 | Tidy First | dominio proprio `newsletter.kentbeck.com` rifiutato da p8 | accetta il dominio dichiarato dal sito con `canonical`/`og:url` |
| A17 | Visualising Data | feed dei commenti usato come riparazione | i feed dei commenti non sono mai una riparazione |
| A19 | ReliefWeb | 202 senza contenuto | etichettato «blocco anti-bot» |
| A20/A21 | AISI, NCSC | licenza su pagina separata ignorata | segue fino a 3 link di termini/licenza del footer, solo stesso sito |
| A22 | CNIL | CC dei crediti delle illustrazioni preso per licenza del contenuto | analisi del contesto: parole di credito immagine → no; nelle pagine dedicate serve «contenuto/sito/testi» vicino |
| A24 | FAR.AI | licenza aperta nei termini persa per il «©» del footer | priorità: licenza aperta prima dell'avviso di copyright |

### 10.4 Decisioni applicate (reversibili in `temi_config.py`)

- **`LICENCIA_AMPLIA = True` (decisione A).**
  - Valgono come licenza dichiarata: una licenza aperta (CC, OGL, `rel=license`), oppure l'avviso di copyright del sito con l'URL che lo dichiara.
  - Motivo: §6c esclude le biblioteche ombra (accesso illegale). La lettura personale di contenuti pubblicati con avviso di copyright è accesso legale.
  - Per tornare indietro: `False`, oppure eseguire con `--licencia-estricta`.
- **`USAR_DOMINIO = True`.** Vocabolario di dominio (`lessico_patch.DOMINIO`), scelto senza guardare le voci 11–20 e validato su di esse:
  - le fonti che arrivano a ≥4/10 sulle voci 11–20 passano da 19 a 32 su 36;
  - un controllo a campione (20 voci) ha trovato 4 errori; i termini che li causavano (`programming`, `testing`, `statistics`, `sampling`) sono stati tolti;
  - la precisione stimata dopo la pulizia è intorno all'80%.

### 10.5 Protezioni di produzione (senza assistenza)

- **Isolamento degli errori.** Un errore imprevisto su una fonte diventa `TRANSITORIO error interno` e non cambia il suo stato (A25).
- **Interruttore di rete.** Se almeno il 40% delle fonti fallisce per rete o blocco (proxy aziendale, IP bloccato, rete giù), `activar.sql` non contiene alcun UPDATE e l'uscita è 3 (A26, A28 end-to-end).
- **Interruttore di crollo.** Se le accettate calano di oltre il 50% rispetto alla corsa precedente, non si scrive nulla e l'uscita è 3 (A27).
- **Report di salute.** Ogni corsa scrive `salud.md`: per tema, accettate, candidate, riparate, da revisionare; più i rifiuti per motivo.

### 10.6 Runbook per l'operatore (nessuna assistenza richiesta)

```bash
python3 test_fonti.py && python3 test_adversarial.py        # devono dare 15/15 e 28/28 prima di qualsiasi deploy
python3 verifica_fonti.py fonti_v4.sql                      # settimanale, prima della corsa delle 08:00
```

| codice di uscita | significato | azione |
|---|---|---|
| 0 | tutto ok | applicare `activar.sql` |
| 2 | ok con avvisi (tema senza fonti, `REVISAR`) | applicare `activar.sql`; leggere `salud.md`; lanciare `scopri_fonti.py --temi <temi senza fonti>` e poi verificare `proponer.sql` |
| 3 | interruttore scattato | **non** applicare nulla; ripetere più tardi; se persiste, controllare rete/proxy |
| 1 | errore d'uso (formato SQL non riconosciuto) | correggere il formato di `fonti_*.sql` |

- `REVISAR` in `informe.csv`: redirect o riparazione verso un altro dominio. Si accetta solo manualmente, aggiornando `url_feed`.

### 10.7 Compiti rimasti per Code

- Fondere `lessico_patch.MEDIDO` + `DOMINIO` (forti) e `temi_config.RELACIONADOS` (deboli) nel classificatore reale.
  Finché non è fatto, il verificatore accetta fonti che la pipeline valuta più in basso.
- Schedulazione: `verifica_fonti.py` settimanale, `scopri_fonti.py` mensile.
- Persistere `estado_verifica.json` tra le corse.
- Quota `esplorazione` nella pipeline.

### 10.8 Limiti non eliminabili

- **Contenuti francesi.** La CNIL (2/10) resta sotto soglia.
- **Temi senza fonte che passa.** `ai_act`, `governance` e `qualita_dati` non hanno oggi una fonte che superi tutti i passi.
  - Sistema: lo segnala con uscita 2 e lo scouting propone candidate.
  - Nessun codice può garantire che esistano fonti idonee.
- **Rete dell'ambiente di prova.** `pg_net` segue i redirect in modo silenzioso. Il percorso redirect è stato quindi provato a parte, dal vivo, con `urllib`.
