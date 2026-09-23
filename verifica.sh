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
# promemoria-notifiche si esegue a QUATTRO ore diverse del giorno, e non e
# una precauzione teorica: per un giorno intero questa simulazione e stata
# verde la mattina e rossa la sera, sullo stesso commit, e sembrava un difetto
# dell'app. Non lo era. `conFuso()` non ripristinava un TZ che non c'era —
# `process.env.TZ = undefined` scrive la stringa "undefined", che non e un fuso
# valido e lascia addosso l'ultimo impostato — e il blocco L3 registrava una
# sessione a «due ore fa», che nelle due ore dopo la mezzanotte locale cade nel
# giorno prima. Due difetti della prova, nessuno dell'app.
#
# Provarla a un'ora sola avrebbe nascosto entrambi. Le quattro ore costano otto
# secondi e coprono i due confini che contano: subito dopo la mezzanotte e
# subito prima.
echo "— promemoria alle quattro ore che rompono (00:30, 06:30, 12:30, 23:30)"
for ora in 00 06 12 23; do
  istante=$(node -e "console.log(Date.parse('2026-09-23T${ora}:30:00Z'))")
  esegui "promemoria $ora:30" env OROLOGIO_FISSO="$istante" \
    NODE_OPTIONS="--import=./test/banco/orologio-fisso.mjs" \
    node test/simulazione/promemoria-notifiche.mjs
done

esegui "coda-scritture" node --import ./test/banco/carica.mjs test/simulazione/coda-scritture.mjs
esegui "triage indipendente" node test/simulazione/triage-schermate-stato.mjs

echo "tutto verde"
