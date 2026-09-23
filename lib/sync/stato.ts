/**
 * Costruisce lo StatoSync leggendo database e preferenze locali.
 * Separato da auto.ts di proposito: là c'è la decisione pura e collaudabile,
 * qui l'accesso al mondo.
 */
import AsyncStorageLike from "expo-sqlite/kv-store";
import { AppState } from "react-native";
import { database } from "../db";
import { StatoSync, decidi, valutaDivergenza, Divergenza, Decisione } from "./auto";
import { Accoppiamento, passphraseDa } from "./accoppiamento";

const CHIAVE_ACCOPPIAMENTO = "accoppiamento";
const CHIAVE_ULTIMO_SCAMBIO = "ultimo_scambio";
const CHIAVE_FALLIMENTI = "fallimenti_consecutivi";

export async function salvaAccoppiamento(a: Accoppiamento) {
  await AsyncStorageLike.setItem(CHIAVE_ACCOPPIAMENTO, JSON.stringify(a));
}

export async function leggiAccoppiamentoSalvato(): Promise<Accoppiamento | null> {
  const v = await AsyncStorageLike.getItem(CHIAVE_ACCOPPIAMENTO);
  return v ? (JSON.parse(v) as Accoppiamento) : null;
}

export async function dimenticaAccoppiamento() {
  await AsyncStorageLike.removeItem(CHIAVE_ACCOPPIAMENTO);
  await AsyncStorageLike.removeItem(CHIAVE_ULTIMO_SCAMBIO);
  await AsyncStorageLike.removeItem(CHIAVE_FALLIMENTI);
}

export async function passphraseCorrente(): Promise<string | null> {
  const a = await leggiAccoppiamentoSalvato();
  return a ? passphraseDa(a) : null;
}

export async function registraScambio(riuscito: boolean) {
  if (riuscito) {
    await AsyncStorageLike.setItem(CHIAVE_ULTIMO_SCAMBIO, String(Date.now()));
    await AsyncStorageLike.setItem(CHIAVE_FALLIMENTI, "0");
  } else {
    const n = Number((await AsyncStorageLike.getItem(CHIAVE_FALLIMENTI)) ?? "0");
    await AsyncStorageLike.setItem(CHIAVE_FALLIMENTI, String(n + 1));
  }
}

export async function statoCorrente(inCorso = false, batteriaBassa = false): Promise<StatoSync> {
  const d = database();
  const sospesi = await d.getFirstAsync<{ n: number }>(
    "SELECT count(*) AS n FROM eventi WHERE sincronizzato = 0"
  );
  const ultimo = await AsyncStorageLike.getItem(CHIAVE_ULTIMO_SCAMBIO);
  const fallimenti = Number((await AsyncStorageLike.getItem(CHIAVE_FALLIMENTI)) ?? "0");
  const accoppiato = (await leggiAccoppiamentoSalvato()) !== null;

  return {
    inSospeso: sospesi?.n ?? 0,
    daUltimoScambioMs: ultimo ? Date.now() - Number(ultimo) : null,
    inPrimoPiano: AppState.currentState === "active",
    accoppiato,
    inCorso,
    fallimentiConsecutivi: fallimenti,
    batteriaBassa,
  };
}

export async function divergenzaCorrente(): Promise<Divergenza> {
  return valutaDivergenza(await statoCorrente());
}

export async function decisioneCorrente(inCorso = false): Promise<Decisione> {
  return decidi(await statoCorrente(inCorso));
}
