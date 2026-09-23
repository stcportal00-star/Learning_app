#!/usr/bin/env python3
"""
Dice PERCHE' Supabase non risponde, invece di dire solo che non risponde.

Esiste per un guasto preciso, e vale la pena raccontarlo. Alla prima corsa
vera, `pubblica.py` si e' fermato su «Supabase non risponde o la chiave non e'
piu' buona»: un messaggio che non distingue una rete caduta da una chiave
revocata, da uno schema non esposto, da una policy che rifiuta. Il motivo vero
stava nel corpo della risposta — un 404 di PostgREST, cioe' «questa tabella non
e' nella mia cache dello schema» — e `raggiungibile()`, che torna un booleano,
lo aveva buttato via.

Una conduttura che gira di notte senza nessuno che guardi deve lasciare scritto
il motivo, non il sintomo. Questo modulo prova una per una le quattro cose che
servono, e di ognuna stampa stato e corpo:

  1. lo schema `percorso` e' servito da PostgREST?
  2. la chiave passa le policy RLS in lettura?
  3. si puo' SCRIVERE (upsert) e poi ripulire?
  4. il deposito accetta un file e lo restituisce?

Non fallisce mai il job da solo: e' una diagnosi, non un cancello. Chi la legge
decide. Con --severo esce 1 se qualcosa non va, ed e' la forma da usare quando
la si vuole come cancello vero.
"""
import argparse
import json
import os
import sys
import urllib.error
import urllib.request

QUI = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, QUI)

from cliente import BASE, CHIAVE, SCHEMA, DEPOSITO, UTENTE, Nuvola  # noqa: E402
from estrattore import scarica  # noqa: E402

# Una riga di prova riconoscibile e cancellabile: se una diagnosi muore a
# meta', chi guarda l'archivio deve capire in un colpo d'occhio cos'e'.
CHIAVE_PROVA = "diagnosi:conduttura"
FILE_PROVA = "diagnosi/prova.pdf"

TIMEOUT = 20


def chiama(metodo, url, intestazioni, corpo=None):
    """Restituisce (stato, corpo_testuale). Non solleva mai: qui il guasto E'
    il dato, e un'eccezione lo nasconderebbe come ha gia' fatto una volta."""
    richiesta = urllib.request.Request(url, data=corpo, method=metodo)
    for k, v in intestazioni.items():
        richiesta.add_header(k, v)
    try:
        with urllib.request.urlopen(richiesta, timeout=TIMEOUT) as r:
            return r.status, r.read(4000).decode("utf-8", "replace")
    except urllib.error.HTTPError as e:
        return e.code, e.read(4000).decode("utf-8", "replace")
    except Exception as e:  # rete assente, DNS, TLS, timeout
        return 0, "%s: %s" % (type(e).__name__, e)


def base():
    return {"apikey": CHIAVE, "Authorization": "Bearer " + CHIAVE}


def lettura():
    return {**base(), "Accept-Profile": SCHEMA}


def scrittura():
    return {
        **base(),
        "Content-Profile": SCHEMA,
        "Content-Type": "application/json",
        "Prefer": "return=representation,resolution=merge-duplicates",
    }


def spiega(stato, corpo):
    """
    Traduce le risposte che contano in una frase che dice cosa fare. Sono
    quattro, e ognuna ha un rimedio diverso: confonderle costa una corsa.
    """
    try:
        dati = json.loads(corpo)
        codice = dati.get("code") or ""
        messaggio = dati.get("message") or ""
    except Exception:
        codice, messaggio = "", ""

    if stato == 0:
        return "la rete non arriva a Supabase. Nessun rimedio dal codice."
    if stato == 404 or codice == "PGRST205":
        return (
            "PostgREST non ha questa tabella nella cache dello schema. Lo schema "
            "e' stato esposto DOPO l'ultimo caricamento della cache: serve "
            "«NOTIFY pgrst, 'reload schema'» sul database (il solo 'reload config' "
            "non basta)."
        )
    if stato == 406 or codice == "PGRST106":
        return (
            "lo schema `%s` non e' fra quelli serviti. Va aggiunto agli schemi "
            "esposti: ALTER ROLE authenticator SET pgrst.db_schemas = "
            "'public, graphql_public, %s', poi NOTIFY pgrst, 'reload config'."
            % (SCHEMA, SCHEMA)
        )
    if stato in (401, 403):
        return (
            "la chiave e' rifiutata oppure una policy RLS non lascia passare. "
            "Se la lettura va e la scrittura no, e' la policy; se non va niente, "
            "e' la chiave (ruotala con SUPABASE_CHIAVE)."
        )
    if stato == 200 or stato == 201:
        return "a posto."
    return "risposta inattesa%s" % ((": " + messaggio) if messaggio else ".")


def prova_fonti():
    """Ogni `url_feed` di `percorso.fonti`: risponde, ed e' davvero un feed?

    Non basta lo stato 200: meta' degli indirizzi sbagliati sono la pagina del
    sito invece del feed, e quella risponde 200 benissimo. Si conta quante voci
    ne escono, perche' zero voci da un feed vivo e' un guasto quanto un 404.
    """
    import feed  # qui e non in testa: serve solo con --fonti

    try:
        righe = feed.leggi_fonti(Nuvola())
    except Exception as e:  # noqa: BLE001
        print("5 fonti RSS                        ---  NO")
        print("    non si riesce a leggere percorso.fonti: %s" % e)
        return ["lettura di percorso.fonti"]

    print("5 fonti RSS (%d attive)" % len(righe))
    if not righe:
        print("    nessuna riga attiva con metodo rss o sitemap: la conduttura")
        print("    girera' sui soli archivi aperti. Non e' un guasto.")
        return []

    guasti = []
    for r in righe:
        nome = str(r.get("nome") or "(senza nome)")[:28]
        url = (r.get("url_feed") or "").strip()
        if not url:
            print("  %-28s ---  NO  manca url_feed" % nome)
            guasti.append("fonte %s" % nome)
            continue
        try:
            # `scarica_fonte` e non `scarica`: una fonte con metodo 'sitemap' non
            # ha un XML da scaricare, ce l'ha da costruire. Provarla con lo
            # scaricatore normale direbbe «404» di una fonte perfettamente sana.
            dati = feed.scarica_fonte(url)
            voci = feed.analizza(dati, r.get("url_sito") or url)
        except Exception as e:  # noqa: BLE001
            print("  %-28s ---  NO  %s" % (nome, str(e)[:110]))
            guasti.append("fonte %s" % nome)
            continue
        if not voci:
            print("  %-28s 200  NO  risponde ma non contiene voci" % nome)
            guasti.append("fonte %s" % nome)
            continue
        con_tema = sum(1 for v in feed.voci_da(r, dati)
                       if feed.classifica_voce(v) is not None)
        print("  %-28s 200  ok  %d voci, %d con un tema" % (nome, len(voci), con_tema))
        if not con_tema:
            print("      nessuna voce ha preso un tema: la fonte risponde ma non")
            print("      porta niente in biblioteca. Categoria sbagliata, o fuori campo.")
    return guasti


def principale(argv=None):
    p = argparse.ArgumentParser(description="Dice perche' Supabase non risponde.")
    p.add_argument("--severo", action="store_true",
                   help="esce 1 se una prova non passa, invece di limitarsi a dirlo")
    p.add_argument("--fonti", action="store_true",
                   help="prova anche i feed RSS di percorso.fonti, uno per uno")
    a = p.parse_args(argv)

    print("Diagnosi della conduttura")
    print("  base    : %s" % BASE)
    print("  schema  : %s" % SCHEMA)
    print("  deposito: %s" % DEPOSITO)
    print("  chiave  : %s… (%d caratteri, da %s)" % (
        CHIAVE[:18], len(CHIAVE),
        "SUPABASE_CHIAVE" if os.environ.get("SUPABASE_CHIAVE") else "cliente.py"))
    print()

    guasti = []

    def prova(nome, metodo, url, intestazioni, corpo=None, attesi=(200, 201, 204)):
        stato, testo = chiama(metodo, url, intestazioni, corpo)
        ok = stato in attesi
        print("%-34s %s  %s" % (nome, stato or "---", "ok" if ok else "NO"))
        if not ok:
            print("    %s" % spiega(stato, testo))
            print("    corpo: %s" % testo[:300].replace("\n", " "))
            guasti.append(nome)
        return ok, stato, testo

    # 1. lettura: e' la prova che lo schema e' servito e la chiave e' buona.
    prova("1 lettura di percorso.temi", "GET",
          "%s/rest/v1/temi?select=id&limit=1" % BASE, lettura())
    prova("2 lettura di percorso.articoli", "GET",
          "%s/rest/v1/articoli?select=chiave&limit=1" % BASE, lettura())

    # 3. scrittura: una riga sola, riconoscibile, subito ripulita. Senza questa
    #    prova una policy che nega l'INSERT si scopre solo alla corsa vera.
    riga = json.dumps([{
        "utente_id": UTENTE,
        "chiave": CHIAVE_PROVA,
        "titolo": "riga di diagnosi, cancellabile",
        "url": "https://esempio.invalid/diagnosi",
    }]).encode()
    scritto, _, _ = prova("3 scrittura su percorso.articoli", "POST",
                          "%s/rest/v1/articoli?on_conflict=utente_id,chiave" % BASE,
                          scrittura(), riga)
    if scritto:
        stato, testo = chiama(
            "DELETE",
            "%s/rest/v1/articoli?chiave=eq.%s" % (BASE, CHIAVE_PROVA),
            {**base(), "Content-Profile": SCHEMA})
        print("%-34s %s  %s" % ("  e la riga di prova va via", stato,
                                "ok" if stato in (200, 204) else "NO"))
        if stato not in (200, 204):
            print("    corpo: %s" % testo[:200].replace("\n", " "))
            guasti.append("pulizia della riga di prova")

    # 4. deposito: i byte magici bastano, qui si prova il permesso, non il PDF.
    caricato, _, _ = prova(
        "4 caricamento nel deposito", "POST",
        "%s/storage/v1/object/%s/%s" % (BASE, DEPOSITO, FILE_PROVA),
        {**base(), "Content-Type": "application/pdf", "x-upsert": "true"},
        b"%PDF-1.4 diagnosi\n")
    if caricato:
        prova("  e si riscarica", "GET",
              "%s/storage/v1/object/%s/%s" % (BASE, DEPOSITO, FILE_PROVA), base())
        chiama("DELETE",
               "%s/storage/v1/object/%s/%s" % (BASE, DEPOSITO, FILE_PROVA), base())

    # 5. le fonti RSS. Non e' un permesso, ed e' fuori dalle quattro apposta:
    #    e' l'unica parte della conduttura che dipende da server di terzi, e un
    #    indirizzo sbagliato nella tabella `fonti` si paga con una riga nel
    #    rapporto ogni mattina finche' qualcuno non va a guardare. Meglio
    #    saperlo qui, in mezzo minuto, quando la fonte la si sta aggiungendo.
    if a.fonti:
        print()
        guasti += prova_fonti()

    print()
    if guasti:
        print("NON PASSATE: %s" % ", ".join(guasti))
        return 1 if a.severo else 0
    print("Tutte e quattro passate: la conduttura puo' scrivere.")
    return 0


if __name__ == "__main__":
    sys.exit(principale())
