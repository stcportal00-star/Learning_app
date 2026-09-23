# -*- coding: utf-8 -*-
"""Tassonomia delle specializzazioni e classificatore delle nuove uscite.

Modulo puro: nessuna rete, nessun file, nessuno stato globale. Tutto ciò che
qui dentro viene deciso è riproducibile a parità di input, perché è l'unico
punto in cui si stabilisce "di che cosa parla" una pubblicazione. Se la
classificazione fosse sparsa fra gli adattatori delle fonti, due fonti che
descrivono lo stesso articolo lo catalogherebbero in modo diverso.

I `tema_slug` sono gli stessi di `assets/contenuti/biblioteca.json`: le nuove
uscite entrano nella stessa libreria dei 52 testi già catalogati, non in uno
schema parallelo. `verifica_rassegna.py` fallisce se i due insiemi divergono.
"""
import re
import unicodedata

# Punteggio minimo perché un tema venga assegnato. Sotto questa soglia la voce
# resta "non_classificato": preferiamo una voce da smistare a mano a una voce
# archiviata nel posto sbagliato, che poi non si ritrova più.
SOGLIA = 1.0

PESO_FORTE = 1.0
PESO_DEBOLE = 0.4
PESO_CONCETTO = 1.2   # i concetti OpenAlex sono già disambiguati a monte
PESO_TITOLO = 1.5     # moltiplicatore: un termine nel titolo vale più che nell'abstract

# tema_slug -> (nome leggibile, trimestre dominante in biblioteca.json,
#               termini forti, termini deboli, concetti OpenAlex)
SPECIALIZZAZIONI = {
    "sql_base": (
        "SQL e motori relazionali", "T1",
        ["sql", "relational database", "query optimizer", "query plan", "postgresql",
         "sqlite", "duckdb", "transaction isolation", "acid", "join algorithm"],
        ["database", "rdbms", "index", "b-tree", "stored procedure", "normalization"],
        ["Relational database", "SQL", "Database", "Query optimization"],
    ),
    "ottimizzazione": (
        "Prestazioni e piani di esecuzione", "T1",
        ["query performance", "execution plan", "cardinality estimation", "vectorized execution",
         "columnar storage", "index selection", "cost model", "query rewriting"],
        ["latency", "throughput", "benchmark", "profiling", "cache", "parallelism"],
        ["Query optimization", "Database index", "Query plan"],
    ),
    "lettura_codice": (
        "Lettura ed esecuzione di codice", "T1",
        ["code comprehension", "program comprehension", "code review", "static analysis",
         "debugging", "version control", "refactoring", "software maintenance"],
        ["python", "shell", "git", "notebook", "readability", "technical debt"],
        ["Source code", "Software maintenance", "Debugging"],
    ),
    "modellazione": (
        "Modellazione e architettura dei dati", "T1",
        ["data modeling", "dimensional model", "star schema", "data vault", "entity relationship",
         "data contract", "semantic layer", "schema evolution", "data mesh"],
        ["warehouse", "lakehouse", "etl", "elt", "pipeline", "dbt", "ontology"],
        ["Data modeling", "Data warehouse", "Conceptual schema"],
    ),
    "statistica": (
        "Statistica e inferenza", "T2",
        ["causal inference", "bayesian inference", "regression", "time series forecasting",
         "statistical learning", "confidence interval", "hypothesis testing", "propensity score",
         "difference-in-differences", "instrumental variable", "survival analysis"],
        ["estimator", "variance", "bias", "bootstrap", "p-value", "prior", "posterior", "sampling"],
        ["Statistics", "Causal inference", "Bayesian statistics", "Regression analysis",
         "Time series", "Machine learning"],
    ),
    "epidemiologia": (
        "Epidemiologia e sorveglianza", "T2",
        ["epidemiology", "disease surveillance", "outbreak detection", "incidence rate",
         "case fatality", "cohort study", "case-control", "seroprevalence", "vaccination coverage",
         "nutritional survey", "smart survey", "mortality survey"],
        ["cholera", "measles", "malaria", "malnutrition", "tuberculosis", "cluster sampling"],
        ["Epidemiology", "Public health", "Disease surveillance", "Outbreak"],
    ),
    "kpi": (
        "Indicatori e visualizzazione", "T2",
        ["key performance indicator", "data visualization", "dashboard design", "indicator framework",
         "visual encoding", "chart design", "performance measurement"],
        ["metric", "baseline", "target", "scorecard", "chart", "legend", "colour scale"],
        ["Data visualization", "Performance indicator"],
    ),
    "qualita_dati": (
        "Qualità e riproducibilità dei dati", "T2",
        ["data quality", "data validation", "reproducibility", "research data management",
         "missing data", "record linkage", "deduplication", "data provenance", "fair data"],
        ["imputation", "outlier", "completeness", "consistency", "lineage", "audit trail"],
        ["Data quality", "Reproducibility", "Data management"],
    ),
    "gdpr": (
        "Protezione dei dati", "T3",
        ["gdpr", "general data protection regulation", "data protection impact assessment",
         "lawful basis", "data minimisation", "data subject rights", "international data transfer",
         "data protection by design", "humanitarian data protection"],
        ["privacy", "consent", "anonymisation", "pseudonymisation", "controller", "processor",
         "supervisory authority", "edpb"],
        ["Data Protection Act", "Privacy", "Information privacy"],
    ),
    "ai_act": (
        "AI Act e regolazione dell'IA", "T3",
        ["ai act", "artificial intelligence act", "high-risk ai system", "conformity assessment",
         "general purpose ai", "ai governance framework", "algorithmic accountability",
         "fundamental rights impact assessment"],
        ["regulation", "compliance", "notified body", "ce marking", "transparency obligation"],
        ["Artificial intelligence", "Regulation", "Technology policy"],
    ),
    "ia": (
        "Intelligenza artificiale applicata", "T3",
        ["large language model", "retrieval augmented generation", "prompt injection",
         "model evaluation", "hallucination", "fine-tuning", "foundation model",
         "ai risk management", "red teaming", "model card"],
        ["llm", "embedding", "transformer", "agent", "inference", "benchmark", "guardrail"],
        ["Large language model", "Artificial intelligence", "Natural language processing",
         "Deep learning"],
    ),
    "sicurezza": (
        "Sicurezza delle informazioni", "T5",
        ["incident response", "threat modeling", "vulnerability management", "zero trust",
         "security framework", "ransomware", "supply chain security", "nis2",
         "cyber resilience", "penetration testing"],
        ["encryption", "authentication", "mfa", "patch", "cve", "firewall", "backup", "siem"],
        ["Computer security", "Information security", "Cryptography"],
    ),
    "hardware": (
        "Dispositivi, reti e continuità", "T5",
        ["mobile device management", "network latency", "offline first", "intermittent connectivity",
         "delay tolerant network", "business continuity", "disaster recovery", "edge computing",
         "satellite connectivity", "power resilience"],
        ["bandwidth", "packet loss", "battery", "rugged", "vsat", "mesh network", "rto", "rpo"],
        ["Computer network", "Mobile computing", "Distributed computing"],
    ),
    "governance": (
        "Governance e affidabilità operativa", "T4",
        ["service level objective", "error budget", "site reliability engineering",
         "architecture decision record", "data governance", "stewardship", "operating model",
         "postmortem", "change management"],
        ["slo", "sli", "sla", "policy", "ownership", "runbook", "maturity model"],
        ["Corporate governance", "Information governance", "Reliability engineering"],
    ),
    "business_analysis": (
        "Analisi di processo e requisiti", "T4",
        ["requirements elicitation", "business process modeling", "stakeholder analysis",
         "process mining", "value stream mapping", "cost-benefit analysis", "theory of change"],
        ["bpmn", "user story", "acceptance criteria", "workflow", "bottleneck"],
        ["Business process", "Requirements engineering", "Systems analysis"],
    ),
    "meal": (
        "Monitoraggio, valutazione e apprendimento", "T6",
        ["monitoring and evaluation", "humanitarian evaluation", "accountability to affected populations",
         "logical framework", "outcome harvesting", "needs assessment", "sphere standards",
         "core humanitarian standard", "cash and voucher assistance", "protection mainstreaming"],
        ["meal", "logframe", "beneficiary", "feedback mechanism", "do no harm", "cluster coordination"],
        ["Humanitarian aid", "Program evaluation", "Development studies"],
    ),
    "salute_digitale": (
        "Salute digitale e sistemi informativi sanitari", "T6",
        ["health information system", "dhis2", "electronic health record", "interoperability",
         "hl7 fhir", "icd-11", "digital health intervention", "telemedicine",
         "health data standard", "openmrs"],
        ["ehr", "emr", "terminology", "registry", "clinical data", "who guideline"],
        ["Health informatics", "Electronic health record", "Digital health"],
    ),
}

# Un solo punto in cui si dichiara che cosa NON è una pubblicazione: preprint
# ritirati, errata, atti di conferenza senza testo. Separato dalle esclusioni
# redazionali di esclusioni_rassegna.json, che riguardano il rumore giornalistico.
NON_PUBBLICAZIONI = [
    "retracted", "retraction of", "erratum", "corrigendum", "withdrawn",
    "table of contents", "front matter", "back matter", "editorial board",
    "call for papers", "conference programme", "author index", "issue information",
]

_ACCENTI = re.compile(r"[̀-ͯ]")


def normalizza(testo):
    """Minuscolo, senza accenti, spazi collassati. La chiave di ogni confronto.

    Senza la rimozione degli accenti "epidemiologìa" e "epidemiologia" sarebbero
    due termini distinti, e le fonti in lingue diverse smetterebbero di allinearsi.
    """
    if not testo:
        return ""
    testo = unicodedata.normalize("NFD", str(testo))
    testo = _ACCENTI.sub("", testo)
    testo = unicodedata.normalize("NFC", testo).lower()
    return re.sub(r"\s+", " ", testo).strip()


def _occorre(termine, testo):
    """Confronto a confine di parola: 'ia' non deve trovarsi dentro 'social'."""
    return re.search(r"(?<!\w)" + re.escape(termine) + r"(?!\w)", testo) is not None


def punteggi(titolo, abstract="", concetti=()):
    """Punteggio per ogni tema. Restituisce un dict tema_slug -> float > 0."""
    t = normalizza(titolo)
    a = normalizza(abstract)
    c = {normalizza(x) for x in concetti or ()}

    esiti = {}
    for tema, (_, _, forti, deboli, concetti_tema) in SPECIALIZZAZIONI.items():
        p = 0.0
        for termine in forti:
            n = normalizza(termine)
            if _occorre(n, t):
                p += PESO_FORTE * PESO_TITOLO
            elif _occorre(n, a):
                p += PESO_FORTE
        for termine in deboli:
            n = normalizza(termine)
            if _occorre(n, t):
                p += PESO_DEBOLE * PESO_TITOLO
            elif _occorre(n, a):
                p += PESO_DEBOLE
        for concetto in concetti_tema:
            if normalizza(concetto) in c:
                p += PESO_CONCETTO
        if p > 0:
            esiti[tema] = round(p, 3)
    return esiti


def classifica(titolo, abstract="", concetti=(), massimo=2):
    """Temi assegnati, dal più forte. Lista vuota se nessuno supera la soglia.

    `massimo` limita l'assegnazione multipla: un articolo su inferenza causale in
    epidemiologia appartiene onestamente a due temi, uno su dieci temi a nessuno.
    """
    esiti = punteggi(titolo, abstract, concetti)
    sopra = [(tema, p) for tema, p in esiti.items() if p >= SOGLIA]
    # Ordine deterministico: punteggio decrescente, poi slug alfabetico a parità.
    sopra.sort(key=lambda x: (-x[1], x[0]))
    return sopra[:massimo]


def e_pubblicazione(titolo):
    """Falso per errata, ritrattazioni e apparati editoriali."""
    t = normalizza(titolo)
    return not any(_occorre(normalizza(m), t) for m in NON_PUBBLICAZIONI)


def e_rumore(titolo, esclusioni):
    """Falso positivo redazionale: usa assets/contenuti/esclusioni_rassegna.json."""
    t = normalizza(titolo)
    return any(normalizza(e) in t for e in esclusioni or ())


def trimestre_di(tema):
    """Trimestre del piano di studio a cui il tema appartiene."""
    voce = SPECIALIZZAZIONI.get(tema)
    return voce[1] if voce else None


def nome_di(tema):
    voce = SPECIALIZZAZIONI.get(tema)
    return voce[0] if voce else tema


def termini_di_ricerca(tema, quanti=6):
    """I termini forti di un tema, per costruire le interrogazioni alle fonti."""
    voce = SPECIALIZZAZIONI.get(tema)
    return list(voce[2][:quanti]) if voce else []
