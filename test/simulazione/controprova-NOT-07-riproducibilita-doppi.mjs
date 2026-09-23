/**
 * Doppi scritti da zero per far girare la schermata VERA `app/(tabs)/note.tsx`
 * dentro Node, senza emulatore e senza toccare il codice dell'app.
 *
 * Perché da zero e non riusando la simulazione dell'altro agente: una controprova
 * che si appoggia al banco di chi ha aperto il difetto non prova niente. Se il
 * difetto si vede solo con quel banco, il difetto è del banco.
 *
 * Tre specificatori vengono dirottati qui (variabile BANCO_DOPPI del banco):
 *   "react"             -> ganci minimi: useState, useEffect, useCallback, useMemo, useRef
 *   "react/jsx-runtime" -> jsx/jsxs/Fragment, che restituiscono oggetti inerti
 *   "react-native"      -> marcatori per View, Text, TextInput, Pressable, FlatList
 *
 * Non c'è nessun motore di rendering: la schermata è una funzione che, dati i
 * suoi stati, restituisce un albero di oggetti. Per il difetto NOT-07 basta e
 * avanza, perché la domanda è "che cosa succede agli stati `titolo` e `testo`
 * quando si esce", non "che pixel disegna Android".
 */

// ------------------------------------------------------------------ GANCI
let istanzaCorrente = null;

function ganciDi() {
  if (!istanzaCorrente) throw new Error("Gancio chiamato fuori da un render: banco rotto.");
  return istanzaCorrente;
}

function depsUguali(a, b) {
  if (!a || !b || a.length !== b.length) return false;
  return a.every((v, i) => Object.is(v, b[i]));
}

export function useState(iniziale) {
  const istanza = ganciDi();
  const indice = istanza.indiceGancio++;
  if (istanza.ganci.length <= indice) {
    istanza.ganci[indice] = {
      tipo: "stato",
      valore: typeof iniziale === "function" ? iniziale() : iniziale,
    };
  }
  const gancio = istanza.ganci[indice];
  // L'impostatore è ricreato a ogni render come in React: la sua identità non
  // entra in nessuna lista di dipendenze di note.tsx, quindi non fa danno.
  const imposta = (prossimo) => {
    const valore = typeof prossimo === "function" ? prossimo(gancio.valore) : prossimo;
    if (Object.is(valore, gancio.valore)) return;
    gancio.valore = valore;
    programmaRender(istanza);
  };
  return [gancio.valore, imposta];
}

export function useCallback(funzione, deps) {
  const istanza = ganciDi();
  const indice = istanza.indiceGancio++;
  const gancio = istanza.ganci[indice];
  if (gancio && gancio.tipo === "callback" && depsUguali(gancio.deps, deps)) return gancio.funzione;
  istanza.ganci[indice] = { tipo: "callback", funzione, deps: deps ? [...deps] : null };
  return funzione;
}

export function useMemo(calcola, deps) {
  const istanza = ganciDi();
  const indice = istanza.indiceGancio++;
  const gancio = istanza.ganci[indice];
  if (gancio && gancio.tipo === "memo" && depsUguali(gancio.deps, deps)) return gancio.valore;
  const valore = calcola();
  istanza.ganci[indice] = { tipo: "memo", valore, deps: deps ? [...deps] : null };
  return valore;
}

export function useRef(iniziale) {
  const istanza = ganciDi();
  const indice = istanza.indiceGancio++;
  if (!istanza.ganci[indice]) istanza.ganci[indice] = { tipo: "rif", corrente: { current: iniziale } };
  return istanza.ganci[indice].corrente;
}

export function useEffect(funzione, deps) {
  const istanza = ganciDi();
  const indice = istanza.indiceGancio++;
  const gancio = istanza.ganci[indice];
  if (!gancio || gancio.tipo !== "effetto") {
    istanza.ganci[indice] = {
      tipo: "effetto", funzione, deps: deps ? [...deps] : null, pulizia: null, daEseguire: true,
    };
    return;
  }
  if (!deps || !depsUguali(gancio.deps, deps)) {
    gancio.funzione = funzione;
    gancio.deps = deps ? [...deps] : null;
    gancio.daEseguire = true;
  }
}

export const useLayoutEffect = useEffect;

// -------------------------------------------------------------- RENDERING
function programmaRender(istanza) {
  if (istanza.inRender) { istanza.sporca = true; return; }
  rendi(istanza);
}

function rendi(istanza) {
  istanza.inRender = true;
  try {
    do {
      istanza.sporca = false;
      istanza.indiceGancio = 0;
      const precedente = istanzaCorrente;
      istanzaCorrente = istanza;
      try {
        istanza.albero = istanza.componente(istanza.props);
      } finally {
        istanzaCorrente = precedente;
      }
      istanza.render += 1;
    } while (istanza.sporca);
  } finally {
    istanza.inRender = false;
  }
  eseguiEffetti(istanza);
}

function eseguiEffetti(istanza) {
  for (const gancio of istanza.ganci) {
    if (!gancio || gancio.tipo !== "effetto" || !gancio.daEseguire) continue;
    gancio.daEseguire = false;
    if (typeof gancio.pulizia === "function") gancio.pulizia();
    gancio.pulizia = gancio.funzione() ?? null;
  }
}

/** Monta il componente: una sola istanza, con i suoi ganci e il suo albero. */
export function monta(componente, props = {}) {
  const istanza = {
    componente, props, ganci: [], indiceGancio: 0,
    albero: null, inRender: false, sporca: false, render: 0,
  };
  rendi(istanza);
  return istanza;
}

/** Smonta: è ciò che accade quando la schermata viene davvero distrutta. */
export function smonta(istanza) {
  for (const gancio of istanza.ganci) {
    if (gancio?.tipo === "effetto" && typeof gancio.pulizia === "function") gancio.pulizia();
  }
  istanza.albero = null;
  istanza.smontata = true;
}

/**
 * Ridisegna senza toccare gli stati: è quello che fa react-freeze quando una
 * scheda torna in primo piano. Serve al caso "cambio scheda".
 */
export function ridisegna(istanza) {
  rendi(istanza);
}

// ----------------------------------------------------------- JSX RUNTIME
export const Fragment = Symbol("Frammento");

export function jsx(tipo, props, chiave) {
  return { $elemento: true, tipo, props: props ?? {}, chiave };
}
export const jsxs = jsx;
export const jsxDEV = jsx;

export function createElement(tipo, props, ...figli) {
  const p = { ...(props ?? {}) };
  if (figli.length) p.children = figli.length === 1 ? figli[0] : figli;
  return jsx(tipo, p);
}

export default { useState, useEffect, useCallback, useMemo, useRef, createElement, Fragment };

// ---------------------------------------------------------- REACT NATIVE
function marcatore(nome) {
  // Funzione e non oggetto: il transpilato la usa solo come identificatore di
  // tipo, e una funzione nominata rende leggibili gli errori del banco.
  const componente = function () {
    throw new Error(`${nome} non si renderizza: è un marcatore del banco.`);
  };
  componente.nomeFinto = nome;
  return componente;
}

export const View = marcatore("View");
export const Text = marcatore("Text");
export const TextInput = marcatore("TextInput");
export const Pressable = marcatore("Pressable");
export const TouchableOpacity = marcatore("TouchableOpacity");
export const FlatList = marcatore("FlatList");
export const ScrollView = marcatore("ScrollView");
export const ActivityIndicator = marcatore("ActivityIndicator");
export const Switch = marcatore("Switch");
export const Modal = marcatore("Modal");

export const StyleSheet = {
  create: (fogli) => fogli,
  flatten: (stile) => (Array.isArray(stile) ? Object.assign({}, ...stile.filter(Boolean)) : stile),
  hairlineWidth: 1,
  absoluteFillObject: {},
};

/**
 * Registro degli avvisi: se la schermata mostrasse un "stai per perdere le
 * modifiche", passerebbe di qui. Sta nel doppio e non nel test perché la
 * domanda "avverte o no" è la meta' del difetto NOT-07.
 */
export const avvisiMostrati = [];
export const Alert = {
  alert(titolo, messaggio, bottoni) {
    avvisiMostrati.push({ titolo, messaggio, bottoni });
  },
};

let schermo = { width: 390, height: 844, scale: 3, fontScale: 1 };

/** Telefono (<600dp) o tablet (>=600dp): note.tsx cambia impaginazione qui. */
export function configuraSchermo(larghezza, altezza = 844) {
  schermo = { ...schermo, width: larghezza, height: altezza };
}

export function useWindowDimensions() {
  return schermo;
}

export const Dimensions = { get: () => schermo, addEventListener: () => ({ remove() {} }) };

let sistema = "android";
export const Platform = {
  get OS() { return sistema; },
  get Version() { return 34; },
  select(scelte) { return sistema in scelte ? scelte[sistema] : (scelte.native ?? scelte.default); },
};
