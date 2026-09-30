import { createContext, useContext } from "react";
import {
  Text as TestoNativo, TextInput as CampoNativo, ActivityIndicator as RotellaNativa,
  TextProps, TextInputProps, ActivityIndicatorProps,
} from "react-native";
import { C } from "../lib/tema";

/**
 * `Text`, `TextInput` e `ActivityIndicator` con i colori del tema nero.
 *
 * Esistono perché il colore predefinito del testo in React Native è il nero:
 * su sfondo nero ogni `<Text>` senza colore esplicito sparisce, e sono più di
 * duecento. Con React 19 `Text.defaultProps` non vale più, quindi l'unico modo
 * di non dimenticarne nessuno è che ogni schermata importi questi al posto di
 * quelli di react-native. Un colore esplicito nello stile vince comunque:
 * quello di base sta PRIMA nell'array.
 *
 * Un `<Text>` dentro un altro eredita il colore del contenitore: se qui gli si
 * desse il colore di base, un rosso o un verde del contenitore si perderebbe
 * sulle parole annidate. Il contesto dice solo «sei già dentro un testo».
 */
const DentroUnTesto = createContext(false);

export function Text(props: TextProps) {
  const dentro = useContext(DentroUnTesto);
  if (dentro) return <TestoNativo {...props} />;
  return (
    <DentroUnTesto.Provider value={true}>
      <TestoNativo {...props} style={[{ color: C.testo }, props.style]} />
    </DentroUnTesto.Provider>
  );
}

export function TextInput(props: TextInputProps) {
  return (
    <CampoNativo
      placeholderTextColor={C.testoTenue}
      selectionColor={C.blu}
      cursorColor={C.testo}
      keyboardAppearance="dark"
      {...props}
      style={[{ color: C.testo }, props.style]}
    />
  );
}

/** Il colore predefinito su Android è il colorPrimary del tema: blu scuro, invisibile sul nero. */
export function ActivityIndicator(props: ActivityIndicatorProps) {
  return <RotellaNativa color={C.testoSecondario} {...props} />;
}
