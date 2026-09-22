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
for s in registro-eventi motore-sql import-database contenuti ripasso-e-sessioni \
         schermate-stato sync-fusione promemoria-notifiche; do
  esegui "$s" node "test/simulazione/$s.mjs"
done
esegui "coda-scritture" node --import ./test/banco/carica.mjs test/simulazione/coda-scritture.mjs
esegui "triage indipendente" node test/simulazione/triage-schermate-stato.mjs

echo "tutto verde"
