#!/usr/bin/env python3
"""Verifica tutti i lotti di esercizi SQL.
Gli esercizi con 'preparazione' girano su una copia temporanea del database."""
import sqlite3, json, sys, os, shutil, tempfile
from esercizi_sql_a import ESERCIZI_A
from esercizi_sql_b import ESERCIZI_B
from esercizi_sql_c import ESERCIZI_C

BASE = os.path.dirname(os.path.abspath(__file__))
DB = os.path.join(BASE, "palestra.db")
os.makedirs(os.path.join(BASE, "out"), exist_ok=True)
ES = ESERCIZI_A + ESERCIZI_B + ESERCIZI_C

ok, falliti, vuoti, non_det = [], [], [], []
con_ro = sqlite3.connect(DB)

for e in ES:
    prep = e.get("preparazione")
    tmp = None
    try:
        if prep:
            tmp = tempfile.mktemp(suffix=".db")
            shutil.copy(DB, tmp)
            con = sqlite3.connect(tmp)
            con.executescript(prep)
        else:
            con = con_ro
        r1 = con.execute(e["soluzione"]).fetchall()
        r2 = con.execute(e["soluzione"]).fetchall()
        cols = [d[0] for d in con.execute(e["soluzione"]).description]
    except Exception as ex:
        falliti.append((e["id"], str(ex)))
        continue
    finally:
        if tmp:
            try:
                con.close(); os.remove(tmp)
            except Exception:
                pass
    if not r1:
        vuoti.append(e["id"]); continue
    if r1 != r2:
        non_det.append(e["id"]); continue
    e["righe_attese"] = len(r1)
    e["colonne_attese"] = cols
    e["anteprima"] = [[str(c) for c in r] for r in r1[:2]]
    ok.append(e)

print(f"Totale esercizi   : {len(ES)}")
print(f"Validi            : {len(ok)}")
print(f"Errore SQL        : {len(falliti)}")
print(f"Risultato vuoto   : {len(vuoti)}")
print(f"Non deterministici: {len(non_det)}")
for i, m in falliti:
    print(f"  ERRORE {i}: {m}")
for i in vuoti:
    print(f"  VUOTO  {i}")
for i in non_det:
    print(f"  NONDET {i}")

with open(os.path.join(BASE, "out", "esercizi_sql.json"), "w", encoding="utf-8") as f:
    json.dump(ok, f, ensure_ascii=False, indent=1)

liv, tem = {}, {}
for e in ok:
    liv[e["livello"]] = liv.get(e["livello"], 0) + 1
    tem[e["tema"]] = tem.get(e["tema"], 0) + 1
print("\nPer livello:", dict(sorted(liv.items())))
print("Per tema   :", dict(sorted(tem.items(), key=lambda x: -x[1])))
sys.exit(1 if (falliti or vuoti or non_det) else 0)
