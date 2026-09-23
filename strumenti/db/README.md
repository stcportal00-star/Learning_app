# Percorso — migrazioni del database

## File

| File | Contenuto | Stato |
|---|---|---|
| `001_schema_percorso.sql` | Schema base: 14 tabelle, event log con HLC, RLS | **già applicata** sul progetto `hgvzjeituvvwtskbxzzl` |
| `002_piano_modello.sql` | Modello del piano + funzione `installa_piano` | **da applicare** |
| `seed_percorso.sql` (cartella contenuti) | 381 item di studio | da applicare dopo la registrazione utente |

## Perché il piano è un modello e non righe dirette

Tutte le tabelle operative hanno `utente_id` con vincolo verso `auth.users`. Finché non esiste un utente registrato, nessuna riga può essere inserita.

La 002 risolve il problema separando i due livelli:

- **quattro tabelle `modello_*`** contengono il piano e non dipendono da alcun utente: esistono da subito, in sola lettura;
- **`percorso.installa_piano(uuid)`** copia il modello nelle tabelle dell'utente alla prima apertura dell'app.

La funzione è **idempotente**: rieseguirla non duplica nulla e non sovrascrive i progressi.

## Come applicarla

Dal SQL Editor di Supabase, oppure:

```bash
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f 002_piano_modello.sql
```

Poi, alla prima apertura dell'app (o manualmente dopo la registrazione):

```sql
select * from percorso.installa_piano(auth.uid());
```

## Verifica eseguita

Le due migrazioni sono state applicate e collaudate su **PostgreSQL 16.15** reale, con `auth.users`, `auth.uid()` e il ruolo `authenticated` ricostruiti localmente. Risultati:

| Controllo | Esito |
|---|---|
| 001 applicata senza errori | sì |
| 002 applicata senza errori | sì |
| Prima installazione | 22 temi, 19 artefatti, 12 credenziali, 14 pubblicazioni |
| Seconda esecuzione (idempotenza) | 0, 0, 0, 0 |
| RLS attiva | 18 tabelle su 18 |

## Il piano in numeri

**Temi per trimestre:** T0 1 · T1 6 · T2 7 · T3 3 · T4 1 · T5 3 · T6 1
**Artefatti per trimestre:** T0 4 · T1 2 · T2 3 · T3 3 · T4 2 · T5 2 · T6 3
**Credenziali:** Anno 1 → 4 a costo **0 USD** · Anno 2 → 4 per 1.135 USD · Anno 3 → 4 per 1.425 USD

Totale triennale 2.560 USD, di cui zero nel primo anno e il resto a carico del budget di sviluppo del personale.

## Nota

Il connettore Supabase non rispondeva al momento della stesura, quindi la 002 non è stata applicata da remoto. È pronta e verificata: va eseguita quando il servizio torna disponibile.
