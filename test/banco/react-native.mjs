/**
 * Doppio MINIMO di `react-native`: solo `Platform`.
 *
 * Non è un modulo Expo, ma senza di lui `lib/notifiche.ts` non si carica: la
 * prima riga importa Platform, e il react-native vero in Node non parte (è
 * codice per l'impacchettatore di React Native, con sintassi Flow).
 *
 * Contiene SOLO quello che serve alla logica collaudabile senza schermo. I
 * componenti (View, Text, StyleSheet...) non ci sono di proposito: un test che
 * li importasse starebbe provando l'interfaccia, e l'interfaccia si prova
 * sull'emulatore, non qui.
 */
let sistema = "android";

/** Il test può fingere iOS: su iOS `applica()` non deve creare il canale Android. */
export function configuraPiattaforma(nome) {
  sistema = nome;
}

export const Platform = {
  get OS() {
    return sistema;
  },
  get Version() {
    return sistema === "android" ? 34 : "17.0";
  },
  select(scelte) {
    if (sistema in scelte) return scelte[sistema];
    if ("native" in scelte) return scelte.native;
    return scelte.default;
  },
};

export default { Platform };
