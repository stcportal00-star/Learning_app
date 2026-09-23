#!/usr/bin/env bash
# Test di fumo su emulatore: installa, avvia, osserva.
#
# Non verifica la logica (lo fanno i 92 test): verifica che l'app SOPRAVVIVA
# sul sistema reale e disegni le schermate. È il controllo che senza PC non
# si potrebbe fare: un crash nativo qui lascia una traccia leggibile.
set -uo pipefail

PACCHETTO="${PACCHETTO:-org.alessiomirra.percorso}"
mkdir -p fumo
: > fumo/estratto.txt

annota() { echo "$*" | tee -a fumo/estratto.txt; }

testo_a_schermo() {
  adb shell uiautomator dump /sdcard/ui.xml >/dev/null 2>&1
  adb shell cat /sdcard/ui.xml 2>/dev/null | tr -d '\r'
}

vivo() {
  [ -n "$(adb shell pidof "$PACCHETTO" 2>/dev/null | tr -d '\r')" ]
}

fallisci() {
  annota "ESITO: FALLITO — $*"
  adb logcat -d > fumo/logcat.txt 2>/dev/null || true
  grep -E "FATAL EXCEPTION|AndroidRuntime|ReactNativeJS|E/|$PACCHETTO" fumo/logcat.txt \
    | tail -n 120 >> fumo/estratto.txt || true
  adb exec-out screencap -p > fumo/99-fallimento.png 2>/dev/null || true
  exit 1
}

annota "== installazione =="
adb install -r percorso.apk >> fumo/estratto.txt 2>&1 || fallisci "installazione rifiutata"

annota "== primo avvio =="
adb logcat -c
adb shell monkey -p "$PACCHETTO" -c android.intent.category.LAUNCHER 1 >/dev/null 2>&1
# Il primo avvio carica 381 item nel database locale: si concede più tempo.
for i in $(seq 1 30); do
  sleep 3
  vivo || fallisci "processo terminato durante il primo avvio (secondo $((i * 3)))"
  if testo_a_schermo | grep -q 'text="Oggi"'; then
    annota "schermata Oggi disegnata dopo circa $((i * 3)) s"
    break
  fi
  [ "$i" -eq 30 ] && fallisci "la schermata Oggi non è comparsa in 90 secondi"
done
if testo_a_schermo | grep -q "Avvio non riuscito"; then
  fallisci "errore JavaScript all'avvio: vedi la schermata"
fi
adb exec-out screencap -p > fumo/01-oggi.png

annota "== navigazione =="
for rotta in studio libreria note profilo esercizi; do
  adb shell am start -W -a android.intent.action.VIEW -d "percorso://$rotta" "$PACCHETTO" >/dev/null 2>&1
  sleep 4
  vivo || fallisci "processo terminato aprendo /$rotta"
  adb exec-out screencap -p > "fumo/02-$rotta.png"
  annota "/$rotta: ok"
done

annota "== lettore PDF interno =="
# L'intestazione mostra "1 / 2" solo quando pdf.js ha davvero aperto il file:
# è una verifica funzionale del lettore, non solo della sua sopravvivenza.
adb shell am start -W -a android.intent.action.VIEW -d "percorso://lettore?id=prova" "$PACCHETTO" >/dev/null 2>&1
for i in $(seq 1 15); do
  sleep 2
  vivo || fallisci "processo terminato aprendo il lettore"
  if testo_a_schermo | grep -q 'text="1 / 2"'; then
    annota "lettore: PDF di prova aperto, 2 pagine, dopo circa $((i * 2)) s"
    break
  fi
  if testo_a_schermo | grep -q "Impossibile aprire il PDF"; then
    adb exec-out screencap -p > fumo/04-lettore.png
    fallisci "il lettore non ha aperto il PDF di prova"
  fi
  [ "$i" -eq 15 ] && { adb exec-out screencap -p > fumo/04-lettore.png; fallisci "il lettore non ha segnalato le pagine in 30 secondi"; }
done
adb exec-out screencap -p > fumo/04-lettore.png

annota "== riavvio a freddo =="
# Verifica che migrazioni e caricamento dei contenuti siano idempotenti:
# un secondo avvio non deve ricaricare né rompere nulla.
adb shell am force-stop "$PACCHETTO"
sleep 2
adb logcat -c
adb shell monkey -p "$PACCHETTO" -c android.intent.category.LAUNCHER 1 >/dev/null 2>&1
sleep 12
vivo || fallisci "processo terminato al secondo avvio"
testo_a_schermo | grep -q 'text="Oggi"' || fallisci "Oggi non ricompare al secondo avvio"
adb exec-out screencap -p > fumo/03-riavvio.png

adb logcat -d > fumo/logcat.txt
if grep -q "FATAL EXCEPTION" fumo/logcat.txt; then
  fallisci "eccezione fatale registrata in logcat"
fi
grep -E "ReactNativeJS" fumo/logcat.txt | tail -n 40 >> fumo/estratto.txt || true
annota "ESITO: SUPERATO"
