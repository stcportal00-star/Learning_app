#!/usr/bin/env bash
# Da eseguire prima di ogni commit. Tutto deve restare verde.
set -e
echo "— typecheck dell'intero progetto"
npx tsc --noEmit
echo "— test di logica"
npm test
echo "— lettore PDF incorporato"
node test/lettore.verifica.mjs 2>/dev/null
echo "tutto verde"
