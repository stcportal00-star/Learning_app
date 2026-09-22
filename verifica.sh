#!/usr/bin/env bash
# Da eseguire prima di ogni commit. Tutto deve restare verde.
set -e
echo "— typecheck dell'intero progetto"
npx tsc --noEmit
echo "— test di logica"
npm test
echo "— lettore PDF incorporato"
node test/lettore.verifica.mjs 2>/dev/null

# I banchi di prova e le simulazioni girano sul CODICE VERO dell'app sopra
# node:sqlite. Stanno qui da quando i difetti confermati sono stati corretti:
# prima ne tenevano rossa una, e una prova rossa per ragioni che non sono
# regressioni smette di essere letta. Sono loro, e solo loro, a fermare la
# perdita di una correzione: typecheck e test di logica non si sono accorti,
# due volte in una sola sessione, che la coda delle scritture di lib/db.ts era
# stata disattivata dentro il file. Costano una ventina di secondi in tutto.
esegui() { # $1 nome, resto: comando
  local nome="$1"; shift
  local uscita
  if uscita=$("$@" 2>&1); then
    printf '   · %-22s %s\n' "$nome" "$(printf '%s\n' "$uscita" | grep -E '^(passati|Verifiche|[0-9]+ verifiche)' | tail -1)"
  else
    printf '%s\n' "$uscita"
    printf '   ✗ %s\n' "$nome"
    exit 1
  fi
}

echo "— banchi di prova (i doppi e il registro, sul codice vero)"
for b in prova-banco prova-altri prova-registro; do
  esegui "$b" node --import ./test/banco/carica.mjs "test/banco/$b.mjs"
done

echo "— simulazioni delle superfici (test/simulazione/)"
for s in registro-eventi motore-sql import-database contenuti ripasso-e-sessioni nuvola \
         schermate-stato sync-fusione ; do
  esegui "$s" node "test/simulazione/$s.mjs"
done
# promemoria-notifiche gira con l'OROLOGIO INCHIODATO, e non è una comodità.
# Le sue tre verifiche del blocco L3 passano prima delle 22:00 UTC e falliscono
# dopo: misurato inchiodando l'ora a 18:30, 20:30, 21:30 (408 su 408) e a
# 22:30, 23:30 (405 su 408). Il difetto è precedente a questa sessione — si
# riproduce anche al commit a460bae — e vive nell'app, non nella prova: alle
# 22:00 la query delle sessioni odierne smette di trovarle e «il blocco di oggi
# risulta già registrato» non compare più. Finché non è capito e corretto, la
# prova gira a un'ora fissa, e il passo qui sotto controlla OGNI VOLTA che il
# difetto notturno sia ancora quello che crediamo: se cambia, lo dice.
# Vedi DA-FARE.md, voce PRM-01.
FISSO_MATTINA=$(node -e "console.log(Date.parse('2026-09-22T09:00:00Z'))")
FISSO_SERA=$(node -e "console.log(Date.parse('2026-09-22T23:00:00Z'))")
esegui "promemoria-notifiche" env OROLOGIO_FISSO="$FISSO_MATTINA" \
  NODE_OPTIONS="--import=./test/banco/orologio-fisso.mjs" \
  node test/simulazione/promemoria-notifiche.mjs

sera=$(OROLOGIO_FISSO="$FISSO_SERA" NODE_OPTIONS="--import=./test/banco/orologio-fisso.mjs" \
       node test/simulazione/promemoria-notifiche.mjs 2>&1 | grep -E '^passati' | tail -1)
if [ "$sera" = "passati 405 su 408" ]; then
  printf '   · %-22s %s\n' "promemoria dopo le 22" "difetto notturno ancora presente (PRM-01), come atteso"
elif [ "$sera" = "passati 408 su 408" ]; then
  printf '   ! %-22s %s\n' "promemoria dopo le 22" \
    "PRM-01 NON si riproduce piu: correggi verifica.sh e chiudi la voce in DA-FARE.md"
else
  printf '   ✗ %-22s %s\n' "promemoria dopo le 22" "atteso 405 su 408, ottenuto: $sera"
  exit 1
fi

esegui "coda-scritture" node --import ./test/banco/carica.mjs test/simulazione/coda-scritture.mjs
esegui "triage indipendente" node test/simulazione/triage-schermate-stato.mjs

echo "tutto verde"
