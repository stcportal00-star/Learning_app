# -*- coding: utf-8 -*-
"""Adattatori verso le biblioteche e gli archivi pubblici. Solo stdlib.

Ogni adattatore restituisce la stessa forma di voce, così il catalogo non deve
sapere da dove arriva ciò che elenca. Chi aggiunge una fonte tocca solo questo
file: `catalogo.py` e `ricercatore.py` non cambiano.

Regola che governa l'elenco delle fonti: si interrogano soltanto archivi che
distribuiscono ciò che hanno il diritto di distribuire — pubblico dominio,
licenza aperta, deposito dell'autore, prestito bibliotecario regolare. Una
fonte che aggira il diritto d'autore non entra qui, qualunque sia la sua
copertura: l'intera biblioteca del progetto è costruita sulla licenza
dichiarata (vedi l'intestazione di `strumenti/biblioteca_aperta.py`), e una
sola voce senza titolo di distribuzione la invaliderebbe tutta.

Forma della voce:
    chiave    stringa di deduplicazione (DOI normalizzato, o titolo normalizzato)
    titolo    str
    autori    list[str]
    data      "AAAA-MM-GG" oppure None
    doi       str oppure None
    tipo      articolo | preprint | libro | rapporto | norma
    fonte     nome dell'adattatore
    url       pagina di destinazione
    url_pdf   testo pieno ad accesso aperto, oppure None
    licenza   str oppure None
    abstract  str
    concetti  list[str]
    editore   str oppure None
"""
import json
import re
import time
import urllib.error
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET

from specializzazioni import normalizza

UA = "PercorsoRassegna/1.0 (strumento personale di studio; stdlib urllib)"

# Recapito richiesto dai "polite pool" di OpenAlex, Crossref e Unpaywall: senza
# di esso le stesse API rispondono da una coda più lenta e più soggetta a 429.
CONTATTO = "alessio.mirra.00@gmail.com"

TENTATIVI = 3
TIMEOUT = 30
# Intervallo minimo fra due chiamate allo stesso host. Nessuna delle API usate
# pubblica un limite duro per uso non autenticato: un decimo di secondo tiene
# il traffico sotto qualunque soglia ragionevole senza allungare la rassegna.
PAUSA_HOST = 0.12

_ultima_chiamata = {}


class FonteNonDisponibile(Exception):
    """La fonte non ha risposto. Non ferma la rassegna: la annota e prosegue."""


def _motivo(errore):
    """Il testo utile del corpo di una risposta d'errore, in una riga breve.

    Gli archivi spiegano i 400 nel corpo — campo ignoto, sintassi rifiutata — e
    quella frase è l'unica via per correggere l'interrogazione invece di
    indovinarla. Il corpo si legge una volta sola e non deve mai far fallire
    la gestione dell'errore che si sta già gestendo.
    """
    try:
        corpo = errore.read(1200).decode("utf-8", "replace")
    except Exception:
        return ""
    if not corpo:
        return ""
    try:                                   # quasi sempre JSON: si prende il messaggio
        dati = json.loads(corpo)
        for chiave in ("message", "error", "detail", "errors", "title"):
            if chiave in dati:
                corpo = json.dumps(dati[chiave], ensure_ascii=False)
                break
    except ValueError:
        corpo = re.sub(r"<[^>]+>", " ", corpo)   # HTML: via i tag
    corpo = " ".join(corpo.split())
    return f" — {corpo[:220]}" if corpo else ""


def _attendi(host):
    scorso = time.monotonic() - _ultima_chiamata.get(host, 0.0)
    if scorso < PAUSA_HOST:
        time.sleep(PAUSA_HOST - scorso)
    _ultima_chiamata[host] = time.monotonic()


def chiedi(url, parametri=None, intestazioni=None, tentativi=TENTATIVI):
    """GET con backoff esponenziale. Restituisce il corpo come bytes.

    Rispetta Retry-After quando il server lo indica: su 429 indovinare un'attesa
    più breve di quella richiesta fa solo scattare il limite una seconda volta.
    """
    if parametri:
        url = url + ("&" if "?" in url else "?") + urllib.parse.urlencode(parametri)
    host = urllib.parse.urlparse(url).netloc
    ultimo = "sconosciuto"

    for tentativo in range(1, tentativi + 1):
        _attendi(host)
        # Accept esplicito: senza di esso export.arxiv.org risponde 406, e altri
        # archivi negoziano una rappresentazione HTML che poi non si sa leggere.
        testate = {"User-Agent": UA, "Accept": "application/json, application/atom+xml, */*"}
        testate.update(intestazioni or {})
        richiesta = urllib.request.Request(url, headers=testate)
        try:
            with urllib.request.urlopen(richiesta, timeout=TIMEOUT) as r:
                return r.read()
        except urllib.error.HTTPError as e:
            # Il corpo della risposta d'errore dice perché l'interrogazione è
            # stata respinta: quale campo non esiste, quale sintassi non si
            # accetta. Senza, un 400 ripetuto resta indistinguibile da un
            # archivio in avaria, e si finisce a correggere per tentativi.
            dettaglio = _motivo(e)
            if e.code in (404, 410):
                raise FonteNonDisponibile(f"HTTP {e.code}{dettaglio}")
            if e.code == 429:
                attesa = e.headers.get("Retry-After")
                pausa = float(attesa) if attesa and attesa.isdigit() else 2 ** tentativo
            elif 400 <= e.code < 500 and e.code not in (408, 429):
                # Un errore di richiesta non cambia esito ritentandolo: la
                # richiesta è la stessa. Si esce subito e si dice perché.
                raise FonteNonDisponibile(f"HTTP {e.code}{dettaglio}")
            else:
                pausa = 2 ** tentativo
            ultimo = f"HTTP {e.code}{dettaglio}"
        except Exception as e:                      # timeout, DNS, TLS, reset
            ultimo = type(e).__name__
            pausa = 2 ** tentativo
        if tentativo < tentativi:
            time.sleep(pausa)
    raise FonteNonDisponibile(ultimo)


def chiedi_json(url, parametri=None, intestazioni=None):
    try:
        return json.loads(chiedi(url, parametri, intestazioni).decode("utf-8", "replace"))
    except FonteNonDisponibile:
        raise
    except Exception as e:
        raise FonteNonDisponibile(f"risposta illeggibile: {type(e).__name__}")


def chiedi_xml(url, parametri=None):
    try:
        return ET.fromstring(chiedi(url, parametri))
    except FonteNonDisponibile:
        raise
    except ET.ParseError as e:
        raise FonteNonDisponibile(f"XML non valido: {e}")


# ------------------------------------------------------------------ normalizzazione

def chiave_di(doi, titolo):
    """DOI se c'è, altrimenti il titolo normalizzato senza punteggiatura.

    Lo stesso articolo arriva da OpenAlex con DOI e da arXiv senza: la chiave
    sul titolo è l'unico modo per accorgersene e non contarlo due volte.
    """
    if doi:
        return "doi:" + normalizza(doi).replace("https://doi.org/", "").strip("/")
    return "tit:" + re.sub(r"[^a-z0-9 ]+", "", normalizza(titolo))[:120]


def voce(titolo, fonte, url, **extra):
    """Costruisce una voce completa, con i campi mancanti a valore neutro."""
    doi = extra.get("doi")
    if doi:
        doi = re.sub(r"^https?://(dx\.)?doi\.org/", "", doi.strip(), flags=re.I) or None
    base = {
        "chiave": chiave_di(doi, titolo),
        "titolo": " ".join(str(titolo).split()),
        "autori": [a for a in extra.get("autori", []) if a][:12],
        "data": extra.get("data"),
        "doi": doi,
        "tipo": extra.get("tipo", "articolo"),
        "fonte": fonte,
        "url": url,
        "url_pdf": extra.get("url_pdf"),
        "licenza": extra.get("licenza"),
        "abstract": " ".join(str(extra.get("abstract") or "").split())[:4000],
        "concetti": [c for c in extra.get("concetti", []) if c][:24],
        "editore": extra.get("editore"),
    }
    return base


def _data_iso(*parti):
    """('2026','9','21') -> '2026-09-21'. None se l'anno manca."""
    parti = [p for p in parti if p not in (None, "")]
    if not parti:
        return None
    try:
        numeri = [int(p) for p in parti[:3]]
    except (TypeError, ValueError):
        return None
    while len(numeri) < 3:
        numeri.append(1)
    return "%04d-%02d-%02d" % tuple(numeri[:3])


def _disabbrevia_openalex(indice):
    """OpenAlex consegna l'abstract come indice posizione->parole. Lo ricompone."""
    if not isinstance(indice, dict):
        return ""
    posizioni = []
    for parola, punti in indice.items():
        for p in punti or []:
            posizioni.append((p, parola))
    posizioni.sort()
    return " ".join(p for _, p in posizioni)


# ------------------------------------------------------------------ fonti periodiche

def openalex(da, a, termini=None, per_pagina=120):
    """OpenAlex: l'indice più ampio, con i concetti già assegnati.

    Si filtra su `is_oa:true` perché una voce senza copia legalmente leggibile
    non serve a chi studia offline: finirebbe nel catalogo come promemoria di
    qualcosa che non si può aprire.
    """
    filtri = [f"from_publication_date:{da}", f"to_publication_date:{a}", "is_oa:true"]
    parametri = {
        "filter": ",".join(filtri),
        "per-page": per_pagina,
        "sort": "cited_by_count:desc",
        "mailto": CONTATTO,
    }
    if termini:
        parametri["search"] = " OR ".join(f'"{t}"' for t in termini)

    dati = chiedi_json("https://api.openalex.org/works", parametri)
    uscite = []
    for w in dati.get("results", []):
        posizione = w.get("best_oa_location") or w.get("primary_location") or {}
        uscite.append(voce(
            w.get("title") or w.get("display_name") or "(senza titolo)",
            "openalex",
            w.get("doi") or (posizione.get("landing_page_url") or w.get("id") or ""),
            doi=w.get("doi"),
            data=w.get("publication_date"),
            autori=[(a_.get("author") or {}).get("display_name")
                    for a_ in w.get("authorships", [])],
            tipo="preprint" if w.get("type") == "preprint" else "articolo",
            url_pdf=posizione.get("pdf_url"),
            licenza=posizione.get("license"),
            abstract=_disabbrevia_openalex(w.get("abstract_inverted_index")),
            # OpenAlex sta sostituendo "concepts" con "topics" e per ora restituisce
            # entrambi. Si leggono tutti e due: quando i concepts spariranno, la
            # classificazione continuerà a ricevere le etichette senza accorgersene.
            concetti=[c.get("display_name") for c in w.get("concepts", [])
                      if (c.get("score") or 0) >= 0.3]
                     + [t.get("display_name") for t in (w.get("topics") or [])],
            editore=(posizione.get("source") or {}).get("display_name"),
        ))
    return uscite


def arxiv(categorie, massimo=100):
    """arXiv: preprint, ordinati per data di inserimento. Deposito dell'autore."""
    query = " OR ".join(f"cat:{c}" for c in categorie)
    radice = chiedi_xml("https://export.arxiv.org/api/query", {
        "search_query": query,
        "sortBy": "submittedDate",
        "sortOrder": "descending",
        "max_results": massimo,
    })
    ns = {"a": "http://www.w3.org/2005/Atom"}
    uscite = []
    for e in radice.findall("a:entry", ns):
        titolo = (e.findtext("a:title", "", ns) or "").strip()
        if not titolo:
            continue
        pagina, pdf = "", None
        for link in e.findall("a:link", ns):
            if link.get("type") == "application/pdf":
                pdf = link.get("href")
            elif link.get("rel") == "alternate":
                pagina = link.get("href") or ""
        doi = e.findtext("{http://arxiv.org/schemas/atom}doi", None, ns)
        uscite.append(voce(
            titolo, "arxiv", pagina or pdf or "",
            doi=doi,
            data=(e.findtext("a:published", "", ns) or "")[:10] or None,
            autori=[a_.findtext("a:name", "", ns) for a_ in e.findall("a:author", ns)],
            tipo="preprint",
            url_pdf=pdf,
            licenza="deposito arXiv (licenza dichiarata dall'autore)",
            abstract=e.findtext("a:summary", "", ns),
            concetti=[c.get("term") for c in e.findall("a:category", ns)],
            editore="arXiv",
        ))
    return uscite


def doaj(termini, da, massimo=100):
    """DOAJ: articoli di riviste interamente ad accesso aperto.

    Nessun filtro sull'anno nell'interrogazione: `bibjson.year` è una stringa e
    la sintassi a intervallo fa rispondere 400 all'intero archivio. Si ordina
    per data di inserimento e si lascia la finestra al setaccio, che la applica
    su `created_date` — a piena precisione, mentre `bibjson.year`/`month` si
    ferma al mese e farebbe scartare articoli usciti da pochi giorni.
    """
    espressione = " OR ".join(f'bibjson.title:"{t}"' for t in termini)
    dati = chiedi_json(
        "https://doaj.org/api/search/articles/" + urllib.parse.quote(espressione, safe=""),
        {"pageSize": min(massimo, 100), "sort": "created_date:desc"},
    )
    uscite = []
    for r in dati.get("results", []):
        b = r.get("bibjson", {})
        collegamenti = b.get("link") or []
        pagina = next((l.get("url") for l in collegamenti if l.get("type") == "fulltext"), "")
        doi = next((i.get("id") for i in b.get("identifier", []) if i.get("type") == "doi"), None)
        uscite.append(voce(
            b.get("title") or "(senza titolo)", "doaj", pagina or "",
            doi=doi,
            data=(r.get("created_date") or "")[:10] or _data_iso(b.get("year"), b.get("month")),
            autori=[a_.get("name") for a_ in b.get("author", [])],
            url_pdf=pagina if (pagina or "").lower().endswith(".pdf") else None,
            licenza=next((l.get("type") for l in (b.get("journal") or {}).get("license", [])), None),
            abstract=b.get("abstract") or "",
            concetti=b.get("keywords") or [],
            editore=(b.get("journal") or {}).get("title"),
        ))
    return uscite


def europepmc(termini, da, massimo=100):
    """Europe PMC: biomedicina ed epidemiologia, con filtro sul testo pieno aperto."""
    espressione = " OR ".join(f'"{t}"' for t in termini)
    dati = chiedi_json("https://www.ebi.ac.uk/europepmc/webservices/rest/search", {
        "query": f"({espressione}) AND (OPEN_ACCESS:y) AND (FIRST_PDATE:[{da} TO 3000-01-01])",
        "format": "json",
        "pageSize": min(massimo, 100),
        "sort": "P_PDATE_D desc",
    })
    uscite = []
    for r in (dati.get("resultList") or {}).get("result", []):
        pmcid = r.get("pmcid")
        uscite.append(voce(
            r.get("title") or "(senza titolo)", "europepmc",
            f"https://europepmc.org/article/{r.get('source', 'MED')}/{r.get('id', '')}",
            doi=r.get("doi"),
            data=r.get("firstPublicationDate"),
            autori=[a_.strip() for a_ in (r.get("authorString") or "").split(",") if a_.strip()],
            url_pdf=(f"https://europepmc.org/articles/{pmcid}?pdf=render" if pmcid else None),
            licenza="accesso aperto (Europe PMC)",
            abstract=r.get("abstractText") or "",
            editore=r.get("journalTitle"),
        ))
    return uscite


def crossref(termini, da, massimo=100):
    """Crossref: copre gli editori che non compaiono negli archivi aperti."""
    dati = chiedi_json("https://api.crossref.org/works", {
        "query.bibliographic": " ".join(termini),
        "filter": f"from-pub-date:{da},has-abstract:true",
        "rows": min(massimo, 100),
        "sort": "published", "order": "desc",
        "mailto": CONTATTO,
    })
    uscite = []
    for r in (dati.get("message") or {}).get("items", []):
        titolo = (r.get("title") or [None])[0]
        if not titolo:
            continue
        parti = ((r.get("published-print") or r.get("published-online")
                  or r.get("issued") or {}).get("date-parts") or [[]])[0]
        licenze = [l.get("URL") for l in r.get("license", []) if l.get("URL")]
        uscite.append(voce(
            titolo, "crossref", r.get("URL") or "",
            doi=r.get("DOI"),
            data=_data_iso(*parti),
            autori=[" ".join(x for x in (a_.get("given"), a_.get("family")) if x)
                    for a_ in r.get("author", [])],
            tipo="libro" if (r.get("type") or "").startswith("book") else "articolo",
            licenza=licenze[0] if licenze else None,
            abstract=re.sub(r"<[^>]+>", " ", r.get("abstract") or ""),
            concetti=r.get("subject") or [],
            editore=r.get("publisher"),
        ))
    return uscite


def zenodo(termini, da, massimo=60):
    """Zenodo: rapporti, dati e materiali grigi depositati dagli autori."""
    espressione = " OR ".join(f'"{t}"' for t in termini)
    # Solo i termini nell'interrogazione. Zenodo è passato a InvenioRDM: il campo
    # `access_right` non esiste più e l'intervallo su `created` viene rifiutato,
    # e un campo ignoto non viene ignorato — fa rispondere 400 a tutta la query.
    # L'ordinamento per data recente più il setaccio danno la stessa finestra.
    dati = chiedi_json("https://zenodo.org/api/records", {
        "q": espressione,
        "size": min(massimo, 100),
        "sort": "newest",
    })
    uscite = []
    for r in (dati.get("hits") or {}).get("hits", []):
        m = r.get("metadata", {})
        # L'accesso si verifica sulla risposta, dove convivono il campo nuovo
        # (access.record) e quello vecchio (metadata.access_right).
        aperto = ((r.get("access") or {}).get("record") == "public"
                  or m.get("access_right") == "open")
        if not aperto:
            continue
        pdf = next((f.get("links", {}).get("self") for f in r.get("files", [])
                    if (f.get("key") or "").lower().endswith(".pdf")), None)
        uscite.append(voce(
            m.get("title") or "(senza titolo)", "zenodo",
            r.get("links", {}).get("html") or r.get("doi_url") or "",
            doi=m.get("doi"),
            data=(m.get("publication_date") or "")[:10] or None,
            autori=[a_.get("name") for a_ in m.get("creators", [])],
            tipo="rapporto",
            url_pdf=pdf,
            licenza=(m.get("license") or {}).get("id") if isinstance(m.get("license"), dict)
                    else m.get("license"),
            abstract=re.sub(r"<[^>]+>", " ", m.get("description") or ""),
            concetti=m.get("keywords") or [],
            editore="Zenodo",
        ))
    return uscite


def doab(termini, massimo=40):
    """DOAB: libri accademici interamente ad accesso aperto."""
    uscite = []
    for termine in termini[:3]:
        try:
            dati = chiedi_json("https://directory.doabooks.org/rest/search", {
                "query": termine, "expand": "metadata", "limit": min(massimo, 40),
            })
        except FonteNonDisponibile:
            continue
        for r in dati if isinstance(dati, list) else []:
            campi = {m.get("key"): m.get("value") for m in (r.get("metadata") or [])}
            titolo = r.get("name") or campi.get("dc.title")
            if not titolo:
                continue
            uscite.append(voce(
                titolo, "doab",
                campi.get("dc.identifier.uri") or f"https://directory.doabooks.org/handle/{r.get('handle', '')}",
                data=_data_iso(campi.get("dc.date.issued", "")[:4]),
                autori=[campi.get("dc.contributor.author")] if campi.get("dc.contributor.author") else [],
                tipo="libro",
                licenza=campi.get("dc.rights") or "accesso aperto (DOAB)",
                abstract=campi.get("dc.description.abstract") or "",
                concetti=[campi.get("dc.subject")] if campi.get("dc.subject") else [],
                editore=campi.get("publisher") or campi.get("dc.publisher"),
            ))
    return uscite


def gutendex(termini, massimo=40):
    """Project Gutenberg: pubblico dominio verificato, nessuna ambiguità di licenza."""
    uscite = []
    for termine in termini[:3]:
        try:
            dati = chiedi_json("https://gutendex.com/books", {"search": termine, "sort": "popular"})
        except FonteNonDisponibile:
            continue
        for r in (dati.get("results") or [])[:massimo]:
            formati = r.get("formats") or {}
            pdf = next((u for t, u in formati.items() if "pdf" in t), None)
            epub = next((u for t, u in formati.items() if "epub" in t), None)
            uscite.append(voce(
                r.get("title") or "(senza titolo)", "gutenberg",
                f"https://www.gutenberg.org/ebooks/{r.get('id')}",
                autori=[a_.get("name") for a_ in r.get("authors", [])],
                tipo="libro",
                url_pdf=pdf or epub,
                licenza="pubblico dominio",
                concetti=(r.get("subjects") or [])[:8],
                editore="Project Gutenberg",
            ))
    return uscite


def standard_ebooks(massimo=30):
    """Standard Ebooks: pubblico dominio ricomposto con cura tipografica."""
    radice = chiedi_xml("https://standardebooks.org/feeds/atom/new-releases")
    ns = {"a": "http://www.w3.org/2005/Atom"}
    uscite = []
    for e in radice.findall("a:entry", ns)[:massimo]:
        titolo = (e.findtext("a:title", "", ns) or "").strip()
        if not titolo:
            continue
        pagina = next((l.get("href") for l in e.findall("a:link", ns)
                       if l.get("rel") in (None, "alternate")), "")
        uscite.append(voce(
            titolo, "standard_ebooks", pagina,
            data=(e.findtext("a:updated", "", ns) or "")[:10] or None,
            autori=[a_.findtext("a:name", "", ns) for a_ in e.findall("a:author", ns)],
            tipo="libro",
            licenza="pubblico dominio",
            abstract=e.findtext("a:summary", "", ns) or "",
            editore="Standard Ebooks",
        ))
    return uscite


# ------------------------------------------------------------------ ricerca puntuale

def unpaywall(doi):
    """La copia aperta e legale di un articolo con DOI, depositata da autore o editore.

    È la risposta legittima alla domanda per cui si finisce sulle biblioteche
    pirata: circa metà della letteratura recente ha una copia depositata
    regolarmente, e questa API la trova.
    """
    dati = chiedi_json(f"https://api.unpaywall.org/v2/{urllib.parse.quote(doi)}",
                       {"email": CONTATTO})
    posizione = dati.get("best_oa_location") or {}
    if not dati.get("is_oa") or not (posizione.get("url_for_pdf") or posizione.get("url")):
        return None
    return {
        "via": "unpaywall",
        "accesso": "copia aperta depositata",
        "url": posizione.get("url_for_pdf") or posizione.get("url"),
        "licenza": posizione.get("license") or dati.get("oa_status"),
        "ospite": posizione.get("host_type"),
        "titolo": dati.get("title"),
    }


def openalex_per_titolo(titolo):
    """Risolve un titolo in DOI e, se esiste, nella sua copia aperta."""
    dati = chiedi_json("https://api.openalex.org/works", {
        "search": titolo, "per-page": 3, "mailto": CONTATTO,
    })
    for w in dati.get("results", []):
        if normalizza(w.get("title") or "")[:60] != normalizza(titolo)[:60]:
            continue
        posizione = w.get("best_oa_location") or {}
        return {
            "via": "openalex",
            "accesso": "copia aperta" if w.get("open_access", {}).get("is_oa") else "solo scheda",
            "url": posizione.get("pdf_url") or posizione.get("landing_page_url") or w.get("id"),
            "licenza": posizione.get("license"),
            "doi": (w.get("doi") or "").replace("https://doi.org/", "") or None,
            "titolo": w.get("title"),
        }
    return None


def openlibrary(titolo):
    """Open Library: pubblico dominio scaricabile, o prestito regolare di Internet Archive.

    Il prestito digitale controllato è un servizio bibliotecario legittimo: una
    copia per volta, con restituzione. Non è distribuzione senza titolo.
    """
    dati = chiedi_json("https://openlibrary.org/search.json", {
        "q": titolo, "limit": 3, "fields": "title,author_name,ia,ebook_access,first_publish_year,key",
    })
    for d in dati.get("docs", []):
        if normalizza(d.get("title") or "")[:50] != normalizza(titolo)[:50]:
            continue
        accesso = d.get("ebook_access") or "no_ebook"
        if accesso == "no_ebook":
            return None
        ia = (d.get("ia") or [None])[0]
        return {
            "via": "openlibrary",
            "accesso": {"public": "pubblico dominio, scaricabile",
                        "borrowable": "prestito bibliotecario (una copia per volta)",
                        "printdisabled": "accesso riservato a utenti con disabilità di lettura"}
                       .get(accesso, accesso),
            "url": (f"https://archive.org/details/{ia}" if ia
                    else "https://openlibrary.org" + (d.get("key") or "")),
            "licenza": "pubblico dominio" if accesso == "public" else "prestito controllato",
            "titolo": d.get("title"),
        }
    return None


def hathitrust(titolo=None, oclc=None, isbn=None):
    """HathiTrust: 'full view' significa pubblico dominio accertato."""
    if isbn:
        chiave = f"isbn:{isbn}"
    elif oclc:
        chiave = f"oclc:{oclc}"
    else:
        return None
    dati = chiedi_json(
        f"https://catalog.hathitrust.org/api/volumes/brief/json/{urllib.parse.quote(chiave)}")
    for _, record in (dati or {}).items():
        for elemento in record.get("items", []):
            if elemento.get("usRightsString", "").lower().startswith("full"):
                return {
                    "via": "hathitrust",
                    "accesso": "pubblico dominio, lettura integrale",
                    "url": elemento.get("itemURL"),
                    "licenza": elemento.get("usRightsString"),
                    "titolo": titolo,
                }
    return None


def doab_per_titolo(titolo):
    trovati = doab([titolo], massimo=5)
    for v in trovati:
        if normalizza(v["titolo"])[:50] == normalizza(titolo)[:50]:
            return {"via": "doab", "accesso": "libro ad accesso aperto",
                    "url": v["url_pdf"] or v["url"], "licenza": v["licenza"], "titolo": v["titolo"]}
    return None


def gutenberg_per_titolo(titolo):
    trovati = gutendex([titolo], massimo=5)
    for v in trovati:
        if normalizza(v["titolo"])[:50] == normalizza(titolo)[:50]:
            return {"via": "gutenberg", "accesso": "pubblico dominio, scaricabile",
                    "url": v["url_pdf"] or v["url"], "licenza": "pubblico dominio",
                    "titolo": v["titolo"]}
    return None


def internet_archive(titolo):
    """Archive.org, collezioni a testo pieno con diritti accertati."""
    dati = chiedi_json("https://archive.org/advancedsearch.php", {
        "q": f'title:("{titolo}") AND mediatype:(texts)',
        "fl[]": "identifier", "rows": 3, "output": "json",
    })
    for d in ((dati.get("response") or {}).get("docs") or []):
        return {"via": "internet_archive", "accesso": "testo su Internet Archive",
                "url": f"https://archive.org/details/{d.get('identifier')}",
                "licenza": "da verificare sulla scheda", "titolo": titolo}
    return None


def google_books(titolo):
    """Google Books: utile solo per sapere se esiste una vista integrale legale."""
    dati = chiedi_json("https://www.googleapis.com/books/v1/volumes", {"q": titolo, "maxResults": 3})
    for v in dati.get("items", []):
        info = v.get("volumeInfo", {})
        if normalizza(info.get("title") or "")[:50] != normalizza(titolo)[:50]:
            continue
        # Due campi distinti dicono cose diverse: viewability quante pagine si
        # vedono, accessViewStatus se l'opera è di pubblico dominio. Serve che
        # almeno uno dei due dichiari la lettura integrale.
        vista = info.get("viewability") or ""
        stato = (v.get("accessInfo") or {}).get("accessViewStatus") or ""
        if vista != "ALL_PAGES" and stato != "FULL_PUBLIC_DOMAIN":
            return None
        return {"via": "google_books", "accesso": "vista integrale",
                "url": info.get("previewLink"), "licenza": stato or vista,
                "titolo": info.get("title")}
    return None


def worldcat_scheda(titolo):
    """Non un'API: l'indirizzo di ricerca per il prestito interbibliotecario.

    Quando nessun archivio aperto ha il testo, la via legittima resta la
    biblioteca fisica. Meglio un collegamento onesto che una voce vuota.
    """
    return {"via": "worldcat", "accesso": "da richiedere in biblioteca (prestito interbibliotecario)",
            "url": "https://search.worldcat.org/search?q=" + urllib.parse.quote(titolo),
            "licenza": None, "titolo": titolo}


# Ordine di interrogazione del ricercatore: prima ciò che si scarica e si tiene,
# poi ciò che si legge in prestito, infine ciò che si richiede in biblioteca.
CATENA_LIBRI = [gutenberg_per_titolo, doab_per_titolo, hathitrust, openlibrary,
                internet_archive, google_books]
