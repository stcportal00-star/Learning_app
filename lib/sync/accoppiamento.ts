/**
 * Accoppiamento dei tuoi due dispositivi.
 *
 * Problema: la passphrase di sincronizzazione va digitata a ogni scambio, e se
 * i due dispositivi sono entrambi in mano tua questo diventa un attrito inutile
 * che porta a non sincronizzare. Non sincronizzare significa divergere.
 *
 * Soluzione: si genera UNA VOLTA un segreto casuale sul primo dispositivo, lo
 * si trascrive sul secondo, e da lì in poi la sincronizzazione è silenziosa.
 *
 * Il codice usa Crockford base32: niente I, L, O, U, quindi nessuna confusione
 * fra 1/I/l e 0/O, e un carattere di controllo che intercetta un errore di
 * battitura prima che produca un pacchetto indecifrabile.
 */

const ALFABETO = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"; // Crockford: senza I, L, O, U
const LUNGHEZZA_SEGRETO = 20; // 160 bit

/** Normalizza l'input umano: maiuscole, niente trattini, I/L→1, O→0. */
export function normalizza(codice: string): string {
  return codice
    .toUpperCase()
    .replace(/[\s-]/g, "")
    .replace(/[IL]/g, "1")
    .replace(/O/g, "0")
    .replace(/U/g, "V");
}

function checksum(dati: string): string {
  let somma = 0;
  for (let i = 0; i < dati.length; i++) {
    somma = (somma * 33 + ALFABETO.indexOf(dati[i]) + 1) % 32;
  }
  return ALFABETO[somma];
}

function codifica(byte: Uint8Array): string {
  let bit = 0;
  let valore = 0;
  let fuori = "";
  for (const b of byte) {
    valore = (valore << 8) | b;
    bit += 8;
    while (bit >= 5) {
      fuori += ALFABETO[(valore >>> (bit - 5)) & 31];
      bit -= 5;
    }
  }
  if (bit > 0) fuori += ALFABETO[(valore << (5 - bit)) & 31];
  return fuori;
}

function decodifica(codice: string): Uint8Array {
  let bit = 0;
  let valore = 0;
  const fuori: number[] = [];
  for (const c of codice) {
    const i = ALFABETO.indexOf(c);
    if (i < 0) throw new Error(`Carattere non valido nel codice: ${c}`);
    valore = (valore << 5) | i;
    bit += 5;
    if (bit >= 8) {
      fuori.push((valore >>> (bit - 8)) & 255);
      bit -= 8;
    }
  }
  return new Uint8Array(fuori);
}

/** Raggruppa in blocchi da quattro per renderlo trascrivibile senza errori. */
export function formatta(codice: string): string {
  return (codice.match(/.{1,4}/g) ?? []).join("-");
}

export type Accoppiamento = { segreto: string; codice: string };

/**
 * Genera il segreto sul primo dispositivo.
 * Il codice mostrato all'utente contiene il segreto più un carattere di controllo.
 */
export function generaAccoppiamento(): Accoppiamento {
  const b = new Uint8Array(LUNGHEZZA_SEGRETO);
  (globalThis as { crypto: Crypto }).crypto.getRandomValues(b);
  const segreto = codifica(b);
  return { segreto, codice: formatta(segreto + checksum(segreto)) };
}

/**
 * Legge il codice sul secondo dispositivo.
 * Un errore di battitura viene intercettato qui, non a metà sincronizzazione.
 */
export function leggiAccoppiamento(inserito: string): Accoppiamento {
  const pulito = normalizza(inserito);
  if (pulito.length < 2) throw new Error("Codice troppo corto.");
  const segreto = pulito.slice(0, -1);
  const controllo = pulito.slice(-1);
  if (checksum(segreto) !== controllo) {
    throw new Error("Codice non valido: controlla di averlo trascritto correttamente.");
  }
  // verifica che sia decodificabile
  decodifica(segreto);
  return { segreto, codice: formatta(pulito) };
}

/**
 * La passphrase effettiva per AES non è il codice digitato, ma il segreto
 * completo: 160 bit di entropia reale, non una parola scelta da una persona.
 */
export function passphraseDa(a: Accoppiamento): string {
  return `percorso-v1:${a.segreto}`;
}
