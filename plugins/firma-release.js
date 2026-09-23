/**
 * Plugin di configurazione Expo — firma di release e parametri di build Android.
 *
 * Perché esiste: ogni build di CI parte da una macchina nuova. Senza una chiave
 * di firma persistente, ogni APK sarebbe firmato con una chiave diversa, Android
 * rifiuterebbe l'aggiornamento ("app non installata"), e l'unico rimedio sarebbe
 * disinstallare — perdendo il database locale con tutti i progressi.
 *
 * La chiave arriva da variabili d'ambiente impostate dal workflow. Se mancano
 * (build locale di prova), si ricade sulla chiave di debug: l'APK funziona, ma
 * non è aggiornabile sopra una versione firmata con la chiave vera.
 *
 * Plugin in JavaScript puro: nessun modulo nativo, nessun rischio a runtime.
 */
const { withAppBuildGradle, withGradleProperties } = require("expo/config-plugins");

const MARCATORE = "// percorso:firma-release";

const BLOCCO_FIRMA = `
    ${MARCATORE}
    signingConfigs {
        percorsoRelease {
            def ks = System.getenv("PERCORSO_KEYSTORE")
            if (ks != null && new File(ks).exists()) {
                storeFile file(ks)
                storePassword System.getenv("PERCORSO_KEYSTORE_PASSWORD")
                keyAlias System.getenv("PERCORSO_KEY_ALIAS")
                keyPassword System.getenv("PERCORSO_KEY_PASSWORD")
            }
        }
    }
`;

function inserisciFirma(gradle) {
  if (gradle.includes(MARCATORE)) return gradle; // idempotente: prebuild può girare più volte

  // 1. blocco signingConfigs dentro android { ... }, subito dopo l'apertura
  const apertura = gradle.search(/android\s*\{/);
  if (apertura < 0) throw new Error("firma-release: blocco android { } non trovato in build.gradle");
  const fineApertura = gradle.indexOf("{", apertura) + 1;
  gradle = gradle.slice(0, fineApertura) + BLOCCO_FIRMA + gradle.slice(fineApertura);

  // 2. nel buildType release, la firma persistente se presente, altrimenti debug
  const release = gradle.search(/buildTypes\s*\{[\s\S]*?release\s*\{/);
  if (release < 0) throw new Error("firma-release: buildTypes.release non trovato in build.gradle");
  const inizioRelease = gradle.indexOf("{", gradle.indexOf("release", release)) + 1;
  const scelta = `
            signingConfig System.getenv("PERCORSO_KEYSTORE") != null ? signingConfigs.percorsoRelease : signingConfigs.debug`;
  gradle = gradle.slice(0, inizioRelease) + scelta + gradle.slice(inizioRelease);

  // 3. la riga del template che imponeva la firma di debug va neutralizzata
  gradle = gradle.replace(
    /(release\s*\{[\s\S]*?)\n(\s*)signingConfig signingConfigs\.debug(?!\s*$)/,
    "$1\n$2// sostituita da percorso:firma-release"
  );
  return gradle;
}

function impostaProprieta(props, chiave, valore) {
  const esistente = props.find((p) => p.type === "property" && p.key === chiave);
  if (esistente) esistente.value = valore;
  else props.push({ type: "property", key: chiave, value: valore });
}

module.exports = function firmaRelease(config) {
  config = withAppBuildGradle(config, (c) => {
    if (c.modResults.language !== "groovy") {
      throw new Error("firma-release: atteso build.gradle in Groovy");
    }
    c.modResults.contents = inserisciFirma(c.modResults.contents);
    return c;
  });

  config = withGradleProperties(config, (c) => {
    // x86 a 32 bit escluso: nessun dispositivo reale lo usa più.
    // x86_64 resta: serve all'emulatore del test di fumo in CI.
    // armeabi-v7a resta: il modello del tablet non è confermato e potrebbe essere a 32 bit.
    impostaProprieta(c.modResults, "reactNativeArchitectures", "armeabi-v7a,arm64-v8a,x86_64");
    // Le build release di React Native con la nuova architettura compilano C++:
    // senza memoria sufficiente per Gradle, i runner di CI falliscono a metà.
    impostaProprieta(c.modResults, "org.gradle.jvmargs", "-Xmx4g -XX:MaxMetaspaceSize=1g");
    return c;
  });

  return config;
};

module.exports.inserisciFirma = inserisciFirma; // esposto per i test
