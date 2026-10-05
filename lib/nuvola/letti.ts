/**
 * I PDF della rassegna già letti: si tolgono dal telefono, e resta il testo.
 *
 * L'utente legge in viaggio, con lo spazio che finisce: un PDF di un
 * articolo segnato «letto» occupa megabyte per una cosa che l'app ha già,
 * perché il testo dell'articolo sta nella riga di `articoli`. Si cancella il
 * file, non la riga: il volume resta in Libreria, e col wifi si riscarica a
 * mano se lo si rivuole. Da solo no: un PDF già letto non si riscarica.
 *
 * Solo quando il testo c'è davvero (TESTO_SUFFICIENTE): un articolo con il
 * solo sommario non ha altro che il PDF, e quello resta.
 *
 * `file_locale` si azzera senza evento, come quando si scarica: è un percorso
 * di QUESTO telefono (CLAUDE.md, invariante 9).
 */
import * as Crypto from "expo-crypto";
import { File } from "expo-file-system";
import { database, inTransazione } from "../db";

/** Sotto questa misura il testo è un sommario, e il PDF non si tocca. */
export const TESTO_SUFFICIENTE = 1000;

/**
 * Le impronte già calcolate. Il legame articolo → volume non cambia mai, e
 * `volumiLetti` gira a ogni apertura di Oggi su centinaia di articoli letti:
 * senza memoria sarebbero centinaia di chiamate native ogni volta.
 */
const impronte = new Map<string, string>();

/**
 * Il volume che porta il PDF di un articolo: lo stesso codice che gli dà la
 * conduttura, codice_stabile("RAS", chiave) in strumenti/nuvola/pubblica.py.
 */
export async function volumeDelPdf(articoloId: string): Promise<string> {
  const gia = impronte.get(articoloId);
  if (gia) return gia;
  const h = await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA1, articoloId);
  const codice = `RAS-${h.toLowerCase().slice(0, 16)}`;
  impronte.set(articoloId, codice);
  return codice;
}

/** I volumi dei PDF di articoli letti e con il testo. */
export async function volumiLetti(): Promise<Set<string>> {
  const righe = await database().getAllAsync<{ id: string }>(
    "SELECT id FROM articoli WHERE letto = 1 AND length(coalesce(testo, '')) >= ?",
    [TESTO_SUFFICIENTE]
  );
  return new Set(await Promise.all(righe.map((r) => volumeDelPdf(r.id))));
}

/**
 * Toglie dal telefono i PDF degli articoli letti che hanno il testo; con
 * `soloArticolo` quello di un articolo solo. Restituisce quanti file ha tolto.
 */
export async function liberaPdfLetti(soloArticolo?: string): Promise<number> {
  let codici: string[];
  if (soloArticolo) {
    const a = await database().getFirstAsync<{ ok: number }>(
      "SELECT 1 AS ok FROM articoli WHERE id = ? AND letto = 1 AND length(coalesce(testo, '')) >= ?",
      [soloArticolo, TESTO_SUFFICIENTE]
    );
    if (!a) return 0;
    codici = [await volumeDelPdf(soloArticolo)];
  } else {
    codici = [...(await volumiLetti())];
  }
  let tolti = 0;
  for (let i = 0; i < codici.length; i += 400) {
    const blocco = codici.slice(i, i + 400);
    const conFile = await database().getAllAsync<{ id: string; file_locale: string }>(
      `SELECT id, file_locale FROM biblioteca
       WHERE id IN (${blocco.map(() => "?").join(",")})
         AND file_locale IS NOT NULL AND file_locale <> ''`,
      blocco
    );
    for (const v of conFile) {
      try {
        const f = new File(v.file_locale);
        if (f.exists) f.delete();
      } catch {
        // Un file che non si lascia cancellare resta segnato com'è: si
        // riprova alla prossima passata.
        continue;
      }
      await inTransazione(async (d) => {
        await d.runAsync("UPDATE biblioteca SET file_locale = NULL WHERE id = ?", [v.id]);
      });
      tolti++;
    }
  }
  return tolti;
}
