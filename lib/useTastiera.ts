import { useEffect, useState } from "react";
import { Keyboard } from "react-native";

/**
 * Se la tastiera è aperta.
 *
 * Con l'edge-to-edge di SDK 54 la tastiera si sovrappone alla schermata
 * invece di restringerla: adjustResize non ha effetto. Le schermate che
 * tengono una consegna in alto e un campo di scrittura sotto devono farle
 * posto da sé, stringendo la consegna mentre si scrive.
 */
export function useTastiera(): boolean {
  const [aperta, setAperta] = useState(false);
  useEffect(() => {
    const su = Keyboard.addListener("keyboardDidShow", () => setAperta(true));
    const giu = Keyboard.addListener("keyboardDidHide", () => setAperta(false));
    return () => { su.remove(); giu.remove(); };
  }, []);
  return aperta;
}
