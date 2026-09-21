/**
 * Doppio di `expo-asset` — la classe `Asset`.
 *
 * Sul telefono un asset è dentro l'APK: `downloadAsync()` lo estrae nello
 * spazio dell'app e `localUri` punta alla copia estratta. Qui il "pacchetto"
 * è la cartella del progetto e l'estrazione è una copia vera dentro la radice
 * del banco (cartella `pacchetto/`). Così `new File(asset.localUri!).copy(...)`
 * del codice dell'app lavora su un file vero e non sfiora il repository.
 *
 * `hash` è l'md5 vero del contenuto, come in expo. Non è un dettaglio
 * decorativo: `preparaLettore()` lo usa come firma per decidere se ricopiare
 * il lettore dopo un aggiornamento dell'app. Con un hash inventato quella
 * decisione non sarebbe verificabile.
 */
import { copyFileSync, existsSync, readFileSync, statSync } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { percorsoDa, percorsoPacchetto, uriDa } from "./expo-file-system.mjs";
import { descrittoreAsset, idAsset } from "./require-metro.mjs";

/** Chiave "id:hash": se il contenuto cambia nasce un asset nuovo, come dopo una nuova build. */
const cache = new Map();

function md5Di(percorso) {
  return createHash("md5").update(readFileSync(percorso)).digest("hex");
}

export class Asset {
  constructor({ name, type, hash, uri, width = null, height = null, percorso = null }) {
    this.name = name;
    this.type = type;
    this.hash = hash ?? null;
    this.uri = uri;
    this.localUri = null;
    this.width = width;
    this.height = height;
    this.downloaded = false;
    this.downloading = false;
    // Percorso di origine dentro il "pacchetto" (il repository): è ciò che
    // downloadAsync copia. Non esiste in expo, serve solo al doppio.
    this.percorsoOrigine = percorso;
  }

  /**
   * Estrae l'asset nello spazio dell'app. Il nome della copia contiene l'hash,
   * come fa expo (`ExponentAsset-<hash>.<tipo>`): due versioni diverse dello
   * stesso asset non si sovrascrivono a vicenda.
   */
  async downloadAsync() {
    if (this.downloaded && this.localUri && existsSync(percorsoDa(this.localUri))) return this;
    if (!this.percorsoOrigine || !existsSync(this.percorsoOrigine)) {
      throw new Error(`expo-asset (doppio): asset assente — ${this.name}.${this.type}`);
    }
    this.downloading = true;
    const destinazione = join(
      percorsoPacchetto(),
      `ExponentAsset-${this.hash}${this.type ? "." + this.type : ""}`
    );
    if (!existsSync(destinazione) || statSync(destinazione).size !== statSync(this.percorsoOrigine).size) {
      copyFileSync(this.percorsoOrigine, destinazione);
    }
    this.localUri = uriDa(destinazione);
    this.downloaded = true;
    this.downloading = false;
    return this;
  }

  /**
   * `require("../assets/...")` restituisce un numero (vedi require-metro.mjs):
   * qui quel numero torna a essere un file. Accetta anche un uri o l'oggetto
   * {uri, width, height}, come la firma vera.
   */
  static fromModule(modulo) {
    if (typeof modulo === "object" && modulo !== null && typeof modulo.uri === "string") {
      return Asset.fromURI(modulo.uri);
    }
    if (typeof modulo === "string") return Asset.fromURI(modulo);

    const descrittore = descrittoreAsset(modulo);
    if (!descrittore) {
      throw new Error(
        `expo-asset (doppio): modulo ${modulo} sconosciuto. ` +
          "Installare require-metro.mjs prima di importare il codice dell'app."
      );
    }
    if (!existsSync(descrittore.percorso)) {
      throw new Error(`expo-asset (doppio): file mancante — ${descrittore.percorso}`);
    }
    const hash = md5Di(descrittore.percorso);
    const chiave = `${descrittore.id}:${hash}`;
    if (cache.has(chiave)) return cache.get(chiave);
    const asset = new Asset({
      name: descrittore.nome,
      type: descrittore.tipo,
      hash,
      uri: uriDa(descrittore.percorso),
      percorso: descrittore.percorso,
    });
    cache.set(chiave, asset);
    return asset;
  }

  /** In expo serve per gli asset remoti; qui accetta solo `file://` locali. */
  static fromURI(uri) {
    const percorso = percorsoDa(uri);
    if (!existsSync(percorso)) {
      throw new Error(`expo-asset (doppio): nessun file per ${uri} (il banco è offline)`);
    }
    return Asset.fromModule(idAsset(percorso));
  }

  static fromMetadata(meta) {
    return new Asset({
      name: meta.name ?? "asset",
      type: meta.type ?? "",
      hash: meta.hash ?? null,
      uri: meta.uri ?? "",
      percorso: meta.percorso ?? null,
    });
  }

  static async loadAsync(moduli) {
    const elenco = Array.isArray(moduli) ? moduli : [moduli];
    return Promise.all(elenco.map((m) => Asset.fromModule(m).downloadAsync()));
  }
}

/** Gancio di comodo usato da expo negli hook React; qui basta l'asset già pronto. */
export function useAssets(moduli) {
  void moduli;
  throw new Error("expo-asset (doppio): useAssets è un hook React, fuori dal banco");
}

export function svuotaCacheAsset() {
  cache.clear();
}

export default { Asset, useAssets };
