#!/usr/bin/env python3
"""Un esercizio di lettura del codice è valido solo se il test FALLISCE sulla
versione difettosa e PASSA su quella corretta. Nessun giudizio soggettivo."""
import json, os, sys
from esercizi_codice import ESERCIZI_CODICE

BASE = os.path.dirname(os.path.abspath(__file__))
os.makedirs(os.path.join(BASE, "out"), exist_ok=True)

def esegui(codice, test):
    ns = {}
    exec(codice, ns)
    tns = {}
    exec(test, tns)
    tns["verifica"](ns)

ok, problemi = [], []
for e in ESERCIZI_CODICE:
    # 1. il test deve fallire sul codice difettoso
    try:
        esegui(e["codice_difettoso"], e["test"])
        problemi.append((e["id"], "il test PASSA sul codice difettoso: il bug non è dimostrato"))
        continue
    except Exception as ex:
        motivo = type(ex).__name__
    # 2. il test deve passare sul codice corretto
    try:
        esegui(e["codice_corretto"], e["test"])
    except Exception as ex:
        problemi.append((e["id"], f"il test FALLISCE sulla correzione: {type(ex).__name__}: {ex}"))
        continue
    e["fallimento_atteso"] = motivo
    ok.append(e)

print(f"Totale esercizi di codice : {len(ESERCIZI_CODICE)}")
print(f"Validi                    : {len(ok)}")
print(f"Problemi                  : {len(problemi)}")
for i, m in problemi:
    print(f"  {i}: {m}")

with open(os.path.join(BASE, "out", "esercizi_codice.json"), "w", encoding="utf-8") as f:
    json.dump(ok, f, ensure_ascii=False, indent=1)

cat = {}
for e in ok:
    cat[e["categoria"]] = cat.get(e["categoria"], 0) + 1
print("\nPer categoria:", dict(sorted(cat.items(), key=lambda x: -x[1])))
sys.exit(1 if problemi else 0)
