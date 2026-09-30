/**
 * I colori dell'app. Nero pieno, per scelta dell'utente: su uno schermo OLED
 * il nero è pixel spento, e si studia di sera, in aereo, con la luce bassa.
 *
 * Costanti e basta: nessun contesto, nessun tema che cambia a caldo. Ogni
 * schermata importa `C` e scrive gli stili inline come prima (vedi le
 * convenzioni in CLAUDE.md); cambiare un colore qui lo cambia ovunque.
 *
 * I colori d'accento non sono quelli di prima schiariti a caso: su nero un
 * blu scuro come #0C447C non si legge. Ogni accento ha un «pieno» leggibile
 * come testo sul nero e un «fondo» scurissimo della stessa tinta, per i
 * riquadri che prima erano pastello su bianco.
 */
export const C = {
  /** Lo sfondo di tutto. */
  sfondo: "#000000",
  /** Riquadri pieni, pulsanti secondari, chip non selezionate. */
  superficie: "#141417",
  /** Un gradino sopra la superficie: premuto, selezionato in grigio. */
  superficieAlta: "#1F1F23",
  /** Bordi e separatori. */
  bordo: "#2A2A2F",
  /** Bordi che devono vedersi: caselle di spunta, campi attivi. */
  bordoForte: "#52525B",

  testo: "#F4F4F5",
  /** Testo di secondo piano che deve restare leggibile senza opacità. */
  testoSecondario: "#B4B4BB",
  /** Segnaposto e testo disattivato. */
  testoTenue: "#71717A",

  /**
   * Il pulsante principale si inverte: su nero un pulsante quasi nero
   * sparirebbe, quindi è chiaro con il testo nero.
   */
  primario: "#F4F4F5",
  suPrimario: "#000000",
  /** Pulsante principale non ancora premibile. */
  disattivo: "#2A2A2F",
  suDisattivo: "#71717A",

  blu: "#7CB8F2",
  bluFondo: "#0B1B2C",
  bluBordo: "#24527F",

  verde: "#4CC79A",
  verdeFondo: "#08231A",

  ambra: "#F2B35B",
  ambraFondo: "#271B06",

  rosso: "#F28B8B",
  rossoFondo: "#2A0D0D",

  viola: "#C3A3EE",
  violaFondo: "#1D1330",

  /** Il codice resta su fondo verde scurissimo, come in un terminale. */
  codiceFondo: "#0A1F17",
  codiceTesto: "#D7F0E4",
} as const;
