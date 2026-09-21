/**
 * Plugin di configurazione Expo — recide la dipendenza da Google Play Services.
 *
 * Perché esiste: il test di fumo del build 2 ha ucciso l'app senza alcun crash.
 * L'unica riga causale in logcat era
 *
 *   Killing org.alessiomirra.percorso (adj 0): depends on provider
 *   com.google.android.gms/.fonts.provider.FontsProvider
 *   in dying proc com.google.android.gms.persistent
 *
 * L'app era in primo piano (adj 0) e non è andata in errore: ActivityManager
 * l'ha terminata perché teneva un binding a un content provider ospitato in un
 * processo di Play Services che stava morendo. Quando il processo che ospita un
 * provider muore, Android uccide anche i client legati a quel provider.
 *
 * Da dove viene il binding: androidx.emoji2 registra EmojiCompatInitializer in
 * androidx.startup, e quell'inizializzatore chiede a Play Services un font
 * scaricabile all'avvio del processo. Nessuna riga del nostro codice lo domanda:
 * arriva per via transitiva da AppCompat, che React Native porta con sé.
 *
 * Perché è un difetto e non una stranezza dell'emulatore: Play Services si
 * aggiorna e riavvia da solo anche sui dispositivi veri. Con questo binding
 * l'app muore in mano all'utente quando capita — e muore in primo piano, cioè
 * mentre si sta leggendo. Per un'applicazione il cui vincolo di fondo è
 * funzionare in aereo, senza rete e senza servizi Google (CLAUDE.md, primo
 * capoverso), una dipendenza di runtime da Play Services è un difetto
 * architetturale, non un dettaglio.
 *
 * Che cosa si perde: EmojiCompat non viene inizializzato, quindi le emoji sono
 * quelle del font di sistema invece di quelle aggiornabili da Play Services.
 * Su Android 8 e successivi il font di sistema le disegna già tutte, e
 * l'interfaccia dell'app è testo italiano.
 *
 * Plugin in JavaScript puro: nessun modulo nativo, nessun rischio a runtime.
 */
const { withAndroidManifest } = require("expo/config-plugins");

const PROVIDER = "androidx.startup.InitializationProvider";
const AUTORITA = "${applicationId}.androidx-startup";
const INIZIALIZZATORE = "androidx.emoji2.text.EmojiCompatInitializer";
const TOOLS = "http://schemas.android.com/tools";

/**
 * Dichiara il provider di androidx.startup nel manifest principale e toglie da
 * esso il solo inizializzatore di emoji2.
 *
 * Si usa tools:node="merge" sul provider e tools:node="remove" sulla singola
 * meta-data: così androidx.startup resta in piedi per tutti gli altri
 * inizializzatori (fra cui quello del ciclo di vita del processo), e cade solo
 * la voce che porta a Play Services. Rimuovere l'intero provider spegnerebbe
 * anche quelli, che servono.
 */
function senzaEmojiCompat(manifest) {
  manifest.$ = manifest.$ || {};
  // Le direttive tools:* sono istruzioni per il fonditore dei manifest: senza
  // il namespace dichiarato il build fallisce con un errore di attributo ignoto.
  manifest.$["xmlns:tools"] = TOOLS;

  const applicazione = manifest.application && manifest.application[0];
  if (!applicazione) throw new Error("senza-gms: blocco <application> non trovato nel manifest");

  applicazione.provider = applicazione.provider || [];
  let provider = applicazione.provider.find(
    (p) => p.$ && p.$["android:name"] === PROVIDER
  );
  if (!provider) {
    provider = {
      $: {
        "android:name": PROVIDER,
        // Deve combaciare con l'autorità dichiarata dalla libreria, altrimenti
        // il fonditore vede due provider distinti e non rimuove nulla.
        "android:authorities": AUTORITA,
        "android:exported": "false",
        "tools:node": "merge",
      },
    };
    applicazione.provider.push(provider);
  } else {
    provider.$["tools:node"] = "merge";
  }

  provider["meta-data"] = provider["meta-data"] || [];
  const gia = provider["meta-data"].some(
    (m) => m.$ && m.$["android:name"] === INIZIALIZZATORE
  );
  if (!gia) {
    // idempotente: prebuild può girare più volte sulla stessa cartella
    provider["meta-data"].push({
      $: { "android:name": INIZIALIZZATORE, "tools:node": "remove" },
    });
  }

  return manifest;
}

module.exports = function senzaGms(config) {
  return withAndroidManifest(config, (c) => {
    c.modResults.manifest = senzaEmojiCompat(c.modResults.manifest);
    return c;
  });
};

module.exports.senzaEmojiCompat = senzaEmojiCompat; // esposto per i test
