import { useEffect, useState } from "react";
import { Keyboard } from "react-native";

/**
 * Quanto è alta la tastiera, in dp: 0 se è chiusa.
 *
 * Con l'edge-to-edge di SDK 54 la tastiera si sovrappone alla schermata
 * invece di restringerla: adjustResize non ha effetto. Le schermate che
 * tengono una consegna in alto e un campo di scrittura sotto devono farle
 * posto da sé, stringendo la consegna mentre si scrive — ma solo quanto
 * serve: su un telefono alto il campo non è coperto, e stringere a vuoto
 * nasconderebbe proprio il testo su cui si sta scrivendo.
 */
export function useTastiera(): number {
  const [altezza, setAltezza] = useState(0);
  useEffect(() => {
    const su = Keyboard.addListener("keyboardDidShow", (e) => setAltezza(e.endCoordinates.height));
    const giu = Keyboard.addListener("keyboardDidHide", () => setAltezza(0));
    return () => { su.remove(); giu.remove(); };
  }, []);
  return altezza;
}
