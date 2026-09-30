/**
 * Il tetto del riquadro in alto di Esercizi e Lettura del codice (la
 * consegna, o il codice) sul telefono. Logica pura, senza react-native: si
 * prova in test/simulazione/percorso.mjs.
 *
 * `massimo` a tastiera chiusa, e mai più di una frazione della finestra, per
 * lo schermo diviso. A tastiera aperta quanto resta dopo aver lasciato
 * `riserva` dp al campo di scrittura — con l'edge-to-edge la tastiera copre
 * invece di restringere (vedi lib/useTastiera.ts) — e mai meno di 72 dp,
 * due righe.
 */
export function tettoRiquadro(
  finestra: number, tastiera: number, massimo: number, frazione: number, riserva: number,
): number {
  const chiusa = Math.min(massimo, Math.round(finestra * frazione));
  if (!tastiera) return chiusa;
  return Math.max(72, Math.min(chiusa, finestra - tastiera - riserva));
}
