/**
 * Doppio di `expo-crypto`, appoggiato a node:crypto: hash VERI, casualità VERA.
 *
 * Perché non numeri finti: `Crypto.randomUUID()` genera gli id di note,
 * tentativi, sessioni e volumi importati. Un doppio che restituisse sempre lo
 * stesso valore farebbe collassare le chiavi primarie e i test passerebbero
 * (o fallirebbero) per un motivo che sul telefono non esiste. E il pacchetto
 * di sincronizzazione confronta impronte sha256: se l'hash è inventato, la
 * verifica non verifica niente.
 *
 * Nomi e valori seguono expo-crypto 15 (node_modules/expo-crypto/build).
 */
import { createHash, randomBytes, randomUUID as uuidNode, webcrypto } from "node:crypto";

export const CryptoDigestAlgorithm = {
  SHA1: "SHA-1",
  SHA256: "SHA-256",
  SHA384: "SHA-384",
  SHA512: "SHA-512",
  MD2: "MD2",
  MD4: "MD4",
  MD5: "MD5",
};

export const CryptoEncoding = { HEX: "hex", BASE64: "base64" };

/** Da "SHA-256" al nome che vuole node:crypto. MD2 e MD4 non esistono in Node. */
function nomeNode(algoritmo) {
  const tabella = {
    "SHA-1": "sha1",
    "SHA-256": "sha256",
    "SHA-384": "sha384",
    "SHA-512": "sha512",
    MD5: "md5",
  };
  const nome = tabella[algoritmo];
  if (!nome) {
    throw new Error(
      `expo-crypto (doppio): algoritmo ${algoritmo} non disponibile in Node ` +
        "(MD2 e MD4 esistono solo su iOS)"
    );
  }
  return nome;
}

export async function digestStringAsync(algoritmo, dati, opzioni = {}) {
  const codifica = opzioni.encoding ?? CryptoEncoding.HEX;
  return createHash(nomeNode(algoritmo)).update(String(dati), "utf8").digest(codifica);
}

export async function digest(algoritmo, dati) {
  const buffer = Buffer.from(dati instanceof ArrayBuffer ? new Uint8Array(dati) : dati);
  const impronta = createHash(nomeNode(algoritmo)).update(buffer).digest();
  return impronta.buffer.slice(impronta.byteOffset, impronta.byteOffset + impronta.byteLength);
}

export function getRandomBytes(quantita) {
  return new Uint8Array(randomBytes(quantita));
}

export async function getRandomBytesAsync(quantita) {
  return getRandomBytes(quantita);
}

export function getRandomValues(vettore) {
  return webcrypto.getRandomValues(vettore);
}

export function randomUUID() {
  return uuidNode();
}

export default {
  CryptoDigestAlgorithm,
  CryptoEncoding,
  digest,
  digestStringAsync,
  getRandomBytes,
  getRandomBytesAsync,
  getRandomValues,
  randomUUID,
};
