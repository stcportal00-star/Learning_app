#!/usr/bin/env bash
# Collaudo della gestione della chiave di firma, eseguito in CI a ogni push.
#
# Garanzia protetta: la chiave NON cambia mai. Se cambiasse, gli aggiornamenti
# non si installerebbero e disinstallare cancellerebbe i dati dell'utente.
# Estrae il passo reale da apk.yml e lo esegue contro un gh simulato.
set -uo pipefail
cd "$(dirname "$0")/.." || exit 1
T=$(mktemp -d)
python3 - "$T" << 'PY'
import sys
y = open(".github/workflows/apk.yml", encoding="utf-8").read()
i = y.index("      - name: Chiave di firma persistente")
j = y.index("      - name: Progetto nativo (prebuild)")
blocco = y[i:j]
corpo = blocco[blocco.index("run: |") + len("run: |"):]
righe = [r[10:] if r.startswith("          ") else r for r in corpo.split("\n")]
open(sys.argv[1] + "/passo.sh", "w").write("\n".join(righe))
PY
mkdir -p "$T/bin"
cat > "$T/bin/gh" << 'GH'
#!/usr/bin/env bash
R="${FINTO_REMOTO:?}"; mkdir -p "$R"
[ "$1" = "release" ] || exit 2
cmd="$2"; shift 2
case "$cmd" in
  download) tag="$1"; shift; pat=""; dest="."
            while [ $# -gt 0 ]; do case "$1" in --pattern) pat="$2"; shift 2;; --dir) dest="$2"; shift 2;; *) shift;; esac; done
            [ -f "$R/$tag/$pat" ] || exit 1; cp "$R/$tag/$pat" "$dest/";;
  create|upload) tag="$1"; shift; mkdir -p "$R/$tag"; for a in "$@"; do [ -f "$a" ] && cp "$a" "$R/$tag/"; done; true;;
  delete-asset) rm -f "$R/$1/$2";;
esac
GH
chmod +x "$T/bin/gh"

esegui() {
  rm -rf "$T/runner"; mkdir -p "$T/runner"; : > "$T/out"; : > "$T/env"
  env -i PATH="$T/bin:$PATH" HOME="$T" FINTO_REMOTO="$1" PASSPHRASE="$2" \
    RUNNER_TEMP="$T/runner" GITHUB_OUTPUT="$T/out" GITHUB_ENV="$T/env" \
    GITHUB_REPOSITORY=prova/percorso GH_TOKEN=x bash "$T/passo.sh" > "$T/log" 2>&1
  local c=$?
  echo "$c|$(grep '^impronta=' "$T/out" | cut -d= -f2)|$(grep '^modo=' "$T/out" | cut -d= -f2-)"
}
ok=0; ko=0
controlla() { if [ "$2" = "1" ]; then ok=$((ok+1)); echo "  ok      $1"; else ko=$((ko+1)); echo "  FALLITO $1"; fi; }

A="$T/remotoA"
IFS='|' read -r c1 f1 m1 <<< "$(esegui "$A" '')"
controlla "senza secret: chiave creata in modalità automatica" "$([ "$c1" = 0 ] && [ -n "$f1" ] && [ "$m1" = automatica ] && echo 1)"
IFS='|' read -r c2 f2 _ <<< "$(esegui "$A" '')"
controlla "seconda esecuzione: stessa impronta" "$([ "$c2" = 0 ] && [ "$f2" = "$f1" ] && echo 1)"
IFS='|' read -r c3 f3 m3 <<< "$(esegui "$A" 'frase')"
controlla "secret aggiunto: stessa chiave, ora cifrata" "$([ "$c3" = 0 ] && [ "$f3" = "$f1" ] && [[ "$m3" == *migrata* ]] && echo 1)"
controlla "dopo la migrazione non resta la copia in chiaro" "$([ -f "$A/firma/firma.tar.enc" ] && [ ! -f "$A/firma/firma.tar" ] && echo 1)"
IFS='|' read -r c4 f4 _ <<< "$(esegui "$A" 'frase')"
controlla "modalità cifrata: stessa impronta" "$([ "$c4" = 0 ] && [ "$f4" = "$f1" ] && echo 1)"
controlla "password mascherata nei log di un'esecuzione riuscita" "$(grep -q '::add-mask::' "$T/log" && echo 1)"
IFS='|' read -r c5 f5 _ <<< "$(esegui "$A" '')"
controlla "secret rimosso: errore, nessuna chiave nuova" "$([ "$c5" != 0 ] && [ -z "$f5" ] && echo 1)"
IFS='|' read -r c6 f6 _ <<< "$(esegui "$A" 'sbagliata')"
controlla "passphrase sbagliata: errore, nessuna chiave nuova" "$([ "$c6" != 0 ] && [ -z "$f6" ] && echo 1)"

B="$T/remotoB"
IFS='|' read -r d1 g1 n1 <<< "$(esegui "$B" 'altra')"
controlla "secret presente dall'inizio: chiave nata cifrata" "$([ "$d1" = 0 ] && [ "$n1" = cifrata ] && [ ! -f "$B/firma/firma.tar" ] && echo 1)"
IFS='|' read -r d2 g2 _ <<< "$(esegui "$B" 'altra')"
controlla "seconda esecuzione: stessa impronta" "$([ "$d2" = 0 ] && [ "$g2" = "$g1" ] && echo 1)"

rm -rf "$T"
echo "Test firma: $ok superati, $ko falliti"
[ "$ko" -eq 0 ]
