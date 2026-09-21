/**
 * Pacchetto di sincronizzazione: il formato che viaggia fra i due dispositivi,
 * qualunque sia il trasporto usato (file, Wi-Fi locale, prossimità).
 *
 * Perché cifrato: il trasporto più affidabile è un file che passa dal foglio di
 * condivisione di Android. Quel file può finire in Download, in un backup, o
 * essere spedito per errore. Cifrarlo rende irrilevante dove finisce.
 *
 * AES-256-GCM con chiave derivata da una passphrase condivisa tramite PBKDF2.
 * GCM è autenticato: un pacchetto manomesso non si apre, non si apre "a metà".
 *
 * Usa WebCrypto, disponibile sia in React Native (expo-crypto) sia in Node:
 * lo stesso codice gira in produzione e nei test.
 */

export const VERSIONE_PACCHETTO = 1;
const ITERAZIONI_PBKDF2 = 210_000; // allineato alle raccomandazioni OWASP correnti
const LUNGHEZZA_IV = 12;
const LUNGHEZZA_SALE = 16;

export type EventoSerializzato = {
  id: string;
  hlc: string;
  dispositivo: string;
  entita: string;
  entita_id: string;
  tipo: "crea" | "aggiorna" | "elimina";
  payload: string;
};

export type Pacchetto = {
  versione: number;
  dispositivo: string;
  creato: string;
  eventi: EventoSerializzato[];
};

function subtle(): SubtleCrypto {
  const c = (globalThis as { crypto?: Crypto }).crypto;
  if (!c?.subtle) {
    throw new Error(
      "WebCrypto non disponibile: impossibile cifrare il pacchetto. " +
        "L'esportazione in chiaro non è prevista."
    );
  }
  return c.subtle;
}

function casuali(n: number): Uint8Array {
  const b = new Uint8Array(n);
  (globalThis as { crypto: Crypto }).crypto.getRandomValues(b);
  return b;
}

async function derivaChiave(passphrase: string, sale: Uint8Array): Promise<CryptoKey> {
  const s = subtle();
  const materiale = await s.importKey(
    "raw",
    new TextEncoder().encode(passphrase),
    "PBKDF2",
    false,
    ["deriveKey"]
  );
  return s.deriveKey(
    { name: "PBKDF2", salt: sale as BufferSource, iterations: ITERAZIONI_PBKDF2, hash: "SHA-256" },
    materiale,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );
}

function base64(b: Uint8Array): string {
  let s = "";
  for (const x of b) s += String.fromCharCode(x);
  // btoa esiste sia in RN sia in Node 16+
  return (globalThis as { btoa: (s: string) => string }).btoa(s);
}

function daBase64(s: string): Uint8Array {
  const bin = (globalThis as { atob: (s: string) => string }).atob(s);
  const b = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) b[i] = bin.charCodeAt(i);
  return b;
}

/**
 * Serializza e cifra. L'involucro esterno resta in chiaro (versione, sale, IV):
 * serve a poter decifrare, e non rivela nulla sul contenuto.
 */
export async function cifra(p: Pacchetto, passphrase: string): Promise<string> {
  const sale = casuali(LUNGHEZZA_SALE);
  const iv = casuali(LUNGHEZZA_IV);
  const chiave = await derivaChiave(passphrase, sale);
  const testo = new TextEncoder().encode(JSON.stringify(p));
  const cifrato = await subtle().encrypt(
    { name: "AES-GCM", iv: iv as BufferSource },
    chiave,
    testo as BufferSource
  );
  return JSON.stringify({
    formato: "percorso-sync",
    versione: VERSIONE_PACCHETTO,
    kdf: { nome: "PBKDF2-SHA256", iterazioni: ITERAZIONI_PBKDF2, sale: base64(sale) },
    iv: base64(iv),
    dati: base64(new Uint8Array(cifrato)),
  });
}

export async function decifra(involucro: string, passphrase: string): Promise<Pacchetto> {
  let esterno: {
    formato?: string; versione?: number;
    kdf?: { iterazioni: number; sale: string }; iv?: string; dati?: string;
  };
  try {
    esterno = JSON.parse(involucro);
  } catch {
    throw new Error("Il file non è un pacchetto di sincronizzazione.");
  }
  if (esterno.formato !== "percorso-sync") {
    throw new Error("Formato non riconosciuto.");
  }
  if ((esterno.versione ?? 0) > VERSIONE_PACCHETTO) {
    throw new Error(
      `Il pacchetto è in versione ${esterno.versione}, questa app legge fino alla ${VERSIONE_PACCHETTO}. ` +
        "Aggiorna l'app sull'altro dispositivo."
    );
  }
  const sale = daBase64(esterno.kdf!.sale);
  const iv = daBase64(esterno.iv!);
  const chiave = await derivaChiave(passphrase, sale);
  let chiaro: ArrayBuffer;
  try {
    chiaro = await subtle().decrypt(
      { name: "AES-GCM", iv: iv as BufferSource },
      chiave,
      daBase64(esterno.dati!) as BufferSource
    );
  } catch {
    // GCM è autenticato: qui non si distingue una passphrase errata da una manomissione.
    throw new Error("Passphrase errata oppure pacchetto alterato.");
  }
  return JSON.parse(new TextDecoder().decode(chiaro)) as Pacchetto;
}

export function impacchetta(dispositivo: string, eventi: EventoSerializzato[]): Pacchetto {
  return {
    versione: VERSIONE_PACCHETTO,
    dispositivo,
    creato: new Date().toISOString(),
    eventi: [...eventi].sort((a, b) => (a.hlc < b.hlc ? -1 : a.hlc > b.hlc ? 1 : 0)),
  };
}
