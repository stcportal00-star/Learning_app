#!/usr/bin/env python3
"""Perché arXiv risponde 406: lo chiede al server invece di indovinarlo.

    python3 diagnosi_arxiv.py

Questo strumento esiste per una lezione già pagata. Con Zenodo ho tentato due
correzioni a indovinare — `access_right`, poi `sort` — e sbagliate entrambe;
il campo vero (`size`, tetto di 25) è saltato fuori solo quando ho smesso di
correggere e ho fatto riportare al rapporto il corpo della risposta d'errore.
Su arXiv ho già speso due tentativi allo stesso modo: https al posto di http,
e un Accept esplicito. Il 406 è rimasto, e arriva con il corpo vuoto: non c'è
nulla da leggere.

Quindi niente terzo tentativo alla cieca. Si manda una matrice di varianti che
differiscono per UNA dimensione ciascuna e si guarda quale passa: la variante
che cambia esito nomina la causa. Le intestazioni della risposta si stampano
per intero perché un 406 senza corpo le ha come unica voce — di solito è lì
che un CDN dice chi ha respinto e perché.

Va eseguito dove arXiv è davvero raggiungibile. Dal contenitore di sviluppo il
proxy nega la CONNECT verso export.arxiv.org, quindi la diagnosi gira in
Actions, nel workflow rassegna, e solo quando il rapporto segnala arXiv caduta.

Esce sempre con 0: una diagnosi che fa fallire il job non si legge.
"""
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

INDIRIZZO = "https://export.arxiv.org/api/query"
UA_NOSTRO = "PercorsoRassegna/1.0 (strumento personale di studio)"
UA_BROWSER = ("Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 "
              "(KHTML, like Gecko) Chrome/124.0 Safari/537.36")
ACCEPT_NOSTRO = "application/json, application/atom+xml, */*"

CATENA = "cat:cs.DB OR cat:cs.LG OR cat:cs.CR OR cat:cs.CY OR cat:cs.SE"
PAUSA = 3.0            # arXiv chiede una richiesta ogni tre secondi
TIMEOUT = 30

# I parametri che fonti_aperte.arxiv manda davvero, e una versione minima per
# separare "la query è troppo grande" da "il trasporto è respinto".
PARAMETRI = {"search_query": CATENA, "sortBy": "submittedDate",
             "sortOrder": "descending", "max_results": 100}
PARAMETRI_MINIMI = {"search_query": "cat:cs.DB", "max_results": 2}

TESTATE = {"User-Agent": UA_NOSTRO, "Accept": ACCEPT_NOSTRO}

# Due famiglie, ognuna col suo confronto.
#
#   "testate"  — stesso indirizzo e stessi parametri del controllo, cambia UNA
#                sola intestazione. Se una passa, la causa è quella intestazione.
#   "richiesta" — stesse intestazioni del controllo, cambia l'indirizzo o i
#                parametri. Se una passa, la causa non è nelle intestazioni.
#
# Il controllo appartiene a entrambe e non cambia niente: se non riproduce il
# 406, le altre non significano nulla e non si tocca il codice.
VARIANTI = [
    ("controllo", "controllo — identica a fonti_aperte.arxiv",
     INDIRIZZO, PARAMETRI, TESTATE),

    ("testate", "Accept: */* soltanto — isola l'elenco di tipi",
     INDIRIZZO, PARAMETRI, {**TESTATE, "Accept": "*/*"}),

    ("testate", "Accept: application/atom+xml — il tipo che arXiv produce davvero",
     INDIRIZZO, PARAMETRI, {**TESTATE, "Accept": "application/atom+xml"}),

    ("testate", "User-Agent da browser — isola un blocco sul nostro nome",
     INDIRIZZO, PARAMETRI, {**TESTATE, "User-Agent": UA_BROWSER}),

    ("testate", "Accept-Encoding: gzip — urllib manda identity, che qualche CDN respinge",
     INDIRIZZO, PARAMETRI, {**TESTATE, "Accept-Encoding": "gzip, deflate"}),

    ("richiesta", "richiesta minima — isola la dimensione della query dal trasporto",
     INDIRIZZO, PARAMETRI_MINIMI, TESTATE),

    ("richiesta", "max_results 2 sulla catena intera — isola la dimensione chiesta",
     INDIRIZZO, {**PARAMETRI, "max_results": 2}, TESTATE),

    ("richiesta", "http al posto di https — l'indirizzo della documentazione arXiv",
     INDIRIZZO.replace("https://", "http://"), PARAMETRI_MINIMI, TESTATE),
]


def prova(indirizzo, parametri, testate):
    """Restituisce (esito, codice, intestazioni, primi byte del corpo)."""
    url = indirizzo + "?" + urllib.parse.urlencode(parametri)
    richiesta = urllib.request.Request(url, headers=testate)
    try:
        with urllib.request.urlopen(richiesta, timeout=TIMEOUT) as r:
            corpo = r.read(400)
            return "ok", r.status, dict(r.headers), corpo
    except urllib.error.HTTPError as e:
        return "http", e.code, dict(e.headers), e.read(400)
    except Exception as e:
        return "rete", 0, {}, f"{type(e).__name__}: {e}".encode()


def main():
    print(f"Diagnosi arXiv — {time.strftime('%Y-%m-%d %H:%M:%S')} UTC")
    print(f"{len(VARIANTI)} varianti, una dimensione per volta rispetto al controllo.\n")

    esiti = []
    for numero, (famiglia, descrizione, indirizzo, parametri, testate) in enumerate(VARIANTI, 1):
        if numero > 1:
            time.sleep(PAUSA)
        esito, codice, intestazioni, corpo = prova(indirizzo, parametri, testate)
        passa = esito == "ok"
        esiti.append((famiglia, descrizione, passa, codice))

        print(f"[{numero}/{len(VARIANTI)}] [{famiglia}] {descrizione}")
        print(f"        inviato : {testate}")
        print(f"        esito   : {'PASSA' if passa else 'RESPINTA'}  "
              f"{esito} {codice or ''}")
        if not passa:
            # Un 406 col corpo vuoto ha solo le intestazioni: è lì che un CDN
            # dice chi ha respinto. Si stampano tutte, non una selezione, per
            # non scartare proprio quella che spiega.
            for chiave, valore in sorted(intestazioni.items()):
                print(f"        < {chiave}: {valore}")
        testo = corpo.decode("utf-8", "replace").strip()
        print(f"        corpo   : {' '.join(testo.split())[:300] or '(vuoto)'}")
        print()

    passate = [d for _, d, p, _ in esiti if p]
    respinte = [(d, c) for _, d, p, c in esiti if not p]

    print("=" * 72)
    if not esiti[0][2] and passate:
        print("LETTURA: il controllo è respinto e qualche variante passa.")
        print("La causa è nella dimensione che distingue la prima variante che passa:")
        for famiglia, descrizione, passa, _ in esiti:
            if passa:
                print(f"  → [{famiglia}] {descrizione}")
                break
    elif esiti[0][2]:
        print("LETTURA: il controllo PASSA. La richiesta di fonti_aperte.arxiv va bene")
        print("così com'è: il 406 visto in rassegna era passeggero o legato al momento.")
        print("Non correggere nulla su questa base.")
    else:
        print("LETTURA: respinte tutte. La causa non è in nessuna delle dimensioni")
        print("provate. Non inventare una nuova ipotesi a tavolino: le intestazioni")
        print("qui sopra sono ciò che il server ha detto: vanno lette prima di")
        print("toccare il codice.")
    print(f"Passate {len(passate)} su {len(esiti)}.")
    for descrizione, codice in respinte:
        print(f"  respinta {codice}: {descrizione}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
