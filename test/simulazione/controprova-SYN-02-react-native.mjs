/**
 * Doppio minimo di `react-native` per la controprova SYN-02.
 *
 * Perche' esiste: lib/sync/stato.ts — il codice VERO che salva l'accoppiamento —
 * importa `AppState` da react-native, e il doppio del banco (test/banco/react-native.mjs)
 * espone solo `Platform`. Senza `AppState` l'importazione fallisce in fase di
 * collegamento del modulo e la controprova non potrebbe usare il codice vero di
 * persistenza: sarebbe costretta a riscriverlo, cioe' a provare se stessa.
 *
 * Non tocca il banco: si innesta da fuori con BANCO_DOPPI.
 */

let piattaforma = "android";

export function configuraPiattaforma(nome) {
  piattaforma = nome;
}

export const Platform = {
  get OS() {
    return piattaforma;
  },
  select(mappa) {
    return mappa[piattaforma] ?? mappa.default;
  },
};

/**
 * `AppState.currentState` viene letto da statoCorrente(). Qui resta "active":
 * la controprova non esercita quella decisione, ma il valore deve esistere
 * perche' un `undefined` silenzioso maschererebbe un errore vero.
 */
export const AppState = {
  currentState: "active",
  addEventListener() {
    return { remove() {} };
  },
};

export default { Platform, AppState };
