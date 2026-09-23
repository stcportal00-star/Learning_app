/**
 * Configurazione calcolata. `app.json` resta la base statica e la fonte di
 * verita' per tutto il resto: qui si aggiunge soltanto cio' che dipende da
 * DOVE e QUANDO il build viene fatto, e che quindi in un file committato
 * sarebbe sempre stantio.
 *
 * ## Perche' il versionCode non e' il numero della corsa
 *
 * Android accetta un aggiornamento solo se il versionCode non scende. Legarlo
 * a `github.run_number` sembra ovvio ed e' una trappola in tre modi:
 *
 * 1. Un APK compilato a mano non ha un numero di corsa: uscirebbe con 1 — il
 *    valore di ripiego di Expo, `config-plugins/build/android/Version.js:74` —
 *    e Android lo rifiuterebbe sopra una build di CI. Dal 2 ottobre al 23
 *    novembre la rete non c'e', e compilare a mano e' l'unica correzione
 *    possibile: quella strada non si chiude.
 * 2. Rieseguire una corsa vecchia ne conserva il numero. Il build uscirebbe
 *    con un versionCode piu' basso di quello gia' installato e il telefono
 *    direbbe soltanto «App non installata».
 * 3. Il contatore riparte da 1 se il file del workflow viene rinominato. Da
 *    quel giorno nessun aggiornamento si installerebbe piu', per sempre, e la
 *    CI resterebbe verde: il guasto si vede solo sul telefono, e l'unico
 *    rimedio sarebbe disinstallare, cioe' perdere il database.
 *
 * I minuti dall'epoca risolvono tutti e tre con una formula sola, uguale
 * ovunque. Qualunque build, fatto da chiunque, e' piu' recente di tutti i
 * precedenti: si installa sopra, e per tornare indietro si ricompila il
 * vecchio commit invece di disinstallare. Oggi vale circa 29,8 milioni e
 * cresce di ~525.000 l'anno; il tetto di Android e' 2.100.000.000, cioe'
 * quasi quattromila anni di margine.
 *
 * ## Perche' il numero di corsa sta altrove
 *
 * «Quale APK e' piu' recente» e «quale codice sta girando» sono due domande
 * diverse e vanno su due campi diversi. Il versionCode risponde alla prima e
 * nessuno lo legge a schermo — di proposito: nasce da un orologio, e viene
 * letto due volte in momenti diversi (dal prebuild per il manifesto, dal task
 * Gradle di expo-constants per l'asset JS), quindi i due valori possono
 * differire di qualche minuto. Mostrarne uno significherebbe dichiarare un
 * numero che il sistema non ha.
 *
 * Alla seconda rispondono `version` — che diventa `versionName` e compare in
 * Impostazioni → App anche quando l'app non si apre — ed `extra`, che porta
 * corsa e commit sullo schermo. Nessuno dei due nasce da un orologio: o la
 * variabile c'e', o non c'e'.
 */
const CORSA = (process.env.GITHUB_RUN_NUMBER || "").trim();
const COMMIT = (process.env.GITHUB_SHA || "").trim().slice(0, 7);

/**
 * Minuti interi dall'epoca. `Math.floor` e non un arrotondamento: due build a
 * un minuto di distanza devono dare numeri diversi ma crescenti, mai uguali
 * per difetto e poi minori.
 */
function minutiDallEpoca() {
  return Math.floor(Date.now() / 60000);
}

module.exports = ({ config }) => ({
  ...config,
  // `0.1.0+42` e non `0.1.0`: e' l'unico posto in cui il numero di build si
  // legge senza aprire l'app, e quando l'app non si apre e' l'unico che resta.
  version: CORSA ? `${config.version}+${CORSA}` : config.version,
  android: {
    ...config.android,
    versionCode: minutiDallEpoca(),
  },
  extra: {
    ...config.extra,
    corsa: CORSA || null,
    // Sette caratteri di SHA identificano il codice anche quando la release
    // non esiste — il fumo puo' fallire, e la pubblicazione ha gia' incontrato
    // un 403 che la fa ritentare cinque volte. Il numero di corsa da solo
    // promette una release che potrebbe non esserci.
    commit: COMMIT || null,
  },
});
