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
#
# Il vocabolario è uno solo, e sta qui. Ai termini del piano di studio si sono
# aggiunti quelli misurati sui feed reali (`consegna_code/lessico_patch.py`:
# `MEDIDO`, verificato su AISI, Anthropic e FAR.AI; `DOMINIO`, scelto dai
# glossari senza guardare le voci di controllo e validato su quelle) e i temi
# correlati di `temi_config.RELACIONADOS`, questi ultimi al livello debole.
# Senza la fusione il verificatore delle fonti e la rassegna quotidiana
# davano due punteggi diversi allo stesso articolo, e una fonte accettata a
# 6/10 dal primo ne portava in libreria due.
#
# Un termine promosso a forte esce dai deboli: contarlo in tutti e due i
# livelli lo farebbe valere 2,1 in un titolo invece di 1,5.
SPECIALIZZAZIONI = {
    "sql_base": (
        "SQL e motori relazionali", "T1",
        ["sql", "relational database", "query optimizer", "query plan", "postgresql",
         "sqlite", "duckdb", "transaction isolation", "acid", "join algorithm", "postgres",
         "mysql", "sql server", "database", "databases"],
        ["rdbms", "index", "b-tree", "stored procedure", "normalization", "indexes",
         "query", "queries", "schema"],
        ["Relational database", "SQL", "Database", "Query optimization"],
    ),
    "ottimizzazione": (
        "Prestazioni e piani di esecuzione", "T1",
        ["query performance", "execution plan", "cardinality estimation",
         "vectorized execution", "columnar storage", "index selection", "cost model",
         "query rewriting", "benchmark", "benchmarks", "query compilation",
         "performance tuning", "partition pruning"],
        ["latency", "throughput", "profiling", "cache", "parallelism", "performance",
         "caching"],
        ["Query optimization", "Database index", "Query plan"],
    ),
    "lettura_codice": (
        "Lettura ed esecuzione di codice", "T1",
        ["code comprehension", "program comprehension", "code review", "static analysis",
         "debugging", "version control", "refactoring", "software maintenance",
         "software engineering", "codebase", "code quality", "unit tests"],
        ["python", "shell", "git", "notebook", "readability", "technical debt", "testing",
         "pull request", "legacy code"],
        ["Source code", "Software maintenance", "Debugging"],
    ),
    "modellazione": (
        "Modellazione e architettura dei dati", "T1",
        ["data modeling", "dimensional model", "star schema", "data vault",
         "entity relationship", "data contract", "semantic layer", "schema evolution",
         "data mesh", "data engineering", "data products", "data warehouse", "lakehouse",
         "dbt", "shift left"],
        ["warehouse", "etl", "elt", "pipeline", "ontology", "schema", "metrics layer",
         "data product"],
        ["Data modeling", "Data warehouse", "Conceptual schema"],
    ),
    "statistica": (
        "Statistica e inferenza", "T2",
        ["causal inference", "bayesian inference", "regression", "time series forecasting",
         "statistical learning", "confidence interval", "hypothesis testing",
         "propensity score", "difference-in-differences", "instrumental variable",
         "survival analysis", "statistical", "bayesian", "anova", "nonparametric",
         "mixed models", "estimator"],
        ["variance", "bias", "bootstrap", "p-value", "prior", "posterior", "sampling",
         "statistics", "survey design", "estimation", "uncertainty", "weighting",
         "r package"],
        ["Statistics", "Causal inference", "Bayesian statistics", "Regression analysis",
         "Time series", "Machine learning"],
    ),
    "epidemiologia": (
        "Epidemiologia e sorveglianza", "T2",
        ["epidemiology", "disease surveillance", "outbreak detection", "incidence rate",
         "case fatality", "cohort study", "case-control", "seroprevalence",
         "vaccination coverage", "nutritional survey", "smart survey", "mortality survey",
         "outbreak", "outbreaks", "vaccination", "vaccines", "measles", "influenza",
         "epidemiological", "public health", "mpox", "cholera", "dengue", "pathogen",
         "pathogens", "antimicrobial resistance"],
        ["malaria", "malnutrition", "tuberculosis", "cluster sampling", "surveillance",
         "mortality"],
        ["Epidemiology", "Public health", "Disease surveillance", "Outbreak"],
    ),
    "kpi": (
        "Indicatori e visualizzazione", "T2",
        ["key performance indicator", "data visualization", "dashboard design",
         "indicator framework", "visual encoding", "chart design",
         "performance measurement", "data visualisation", "dataviz", "data vis",
         "infographic", "infographics", "chart", "charts", "visualisation", "visualization",
         "data storytelling"],
        ["metric", "baseline", "target", "scorecard", "legend", "colour scale", "indicator",
         "indicators", "metrics", "power bi"],
        ["Data visualization", "Performance indicator"],
    ),
    "qualita_dati": (
        "Qualità e riproducibilità dei dati", "T2",
        ["data quality", "data validation", "reproducibility", "research data management",
         "missing data", "record linkage", "deduplication", "data provenance", "fair data",
         "open data", "metadata", "data sharing", "data standards", "research software",
         "open science", "reproducible", "data documentation", "data dictionary"],
        ["imputation", "outlier", "completeness", "consistency", "lineage", "audit trail",
         "data cleaning", "hxl", "validation"],
        ["Data quality", "Reproducibility", "Data management"],
    ),
    "gdpr": (
        "Protezione dei dati", "T3",
        ["gdpr", "general data protection regulation", "data protection impact assessment",
         "lawful basis", "data minimisation", "data subject rights",
         "international data transfer", "data protection by design",
         "humanitarian data protection", "privacy", "data protection", "personal data",
         "rgpd", "données personnelles", "dati personali", "datos personales", "data breach"],
        ["consent", "anonymisation", "pseudonymisation", "controller", "processor",
         "supervisory authority", "edpb", "biometric", "data retention"],
        ["Data Protection Act", "Privacy", "Information privacy"],
    ),
    "ai_act": (
        "AI Act e regolazione dell'IA", "T3",
        ["ai act", "artificial intelligence act", "high-risk ai system",
         "conformity assessment", "general purpose ai", "ai governance framework",
         "algorithmic accountability", "fundamental rights impact assessment",
         "ai regulation", "ai policy", "algorithmic", "ai governance", "ai safety institute"],
        ["regulation", "compliance", "notified body", "ce marking",
         "transparency obligation", "ai safety", "european commission", "ai office",
         "standards"],
        ["Artificial intelligence", "Regulation", "Technology policy"],
    ),
    "ia": (
        "Intelligenza artificiale applicata", "T3",
        ["large language model", "retrieval augmented generation", "prompt injection",
         "model evaluation", "hallucination", "fine-tuning", "foundation model",
         "ai risk management", "red teaming", "model card", "llm", "llms", "evals", "eval",
         "evaluations", "red team", "jailbreak", "jailbreaking", "agentic", "ai agent",
         "ai agents", "language model", "language models", "frontier model",
         "frontier models", "interpretability", "sandbagging", "model behaviour",
         "model behavior", "machine learning", "artificial intelligence", "neural network",
         "ai model", "ai models"],
        ["embedding", "transformer", "agent", "inference", "benchmark", "guardrail",
         "agents", "gpt", "claude", "gemini", "open weights"],
        ["Large language model", "Artificial intelligence", "Natural language processing",
         "Deep learning"],
    ),
    "sicurezza": (
        "Sicurezza delle informazioni", "T5",
        ["incident response", "threat modeling", "vulnerability management", "zero trust",
         "security framework", "ransomware", "supply chain security", "nis2",
         "cyber resilience", "penetration testing", "exploit", "exploits", "0-day",
         "0-days", "zero-day", "zero-days", "cve", "cyber", "cybersecurity",
         "misconfiguration", "misconfigurations", "malware", "phishing", "vulnerability",
         "vulnerabilities", "ddos", "botnet", "infostealer", "backdoor",
         "threat intelligence", "security advisory", "patch tuesday", "cyberattack"],
        ["encryption", "authentication", "mfa", "patch", "firewall", "backup", "siem",
         "breach"],
        ["Computer security", "Information security", "Cryptography"],
    ),
    "hardware": (
        "Dispositivi, reti e continuità", "T5",
        ["mobile device management", "network latency", "offline first",
         "intermittent connectivity", "delay tolerant network", "business continuity",
         "disaster recovery", "edge computing", "satellite connectivity",
         "power resilience", "bgp", "routing security", "internet outage",
         "submarine cable", "solar power", "starlink", "off-grid", "battery storage",
         "rural connectivity", "mesh network"],
        ["bandwidth", "packet loss", "battery", "rugged", "vsat", "rto", "rpo", "generator",
         "connectivity", "lora", "android", "tablet", "sync"],
        ["Computer network", "Mobile computing", "Distributed computing"],
    ),
    "governance": (
        "Governance e affidabilità operativa", "T4",
        ["service level objective", "error budget", "site reliability engineering",
         "architecture decision record", "data governance", "stewardship",
         "operating model", "postmortem", "change management", "incident report",
         "incident", "incidents", "outage", "outages", "observability", "on-call",
         "reliability"],
        ["slo", "sli", "sla", "policy", "ownership", "runbook", "maturity model",
         "decision making"],
        ["Corporate governance", "Information governance", "Reliability engineering"],
    ),
    "business_analysis": (
        "Analisi di processo e requisiti", "T4",
        ["requirements elicitation", "business process modeling", "stakeholder analysis",
         "process mining", "value stream mapping", "cost-benefit analysis",
         "theory of change", "workflow analysis", "business process", "process improvement"],
        ["bpmn", "user story", "acceptance criteria", "workflow", "bottleneck",
         "requirements", "stakeholders", "use case", "user research"],
        ["Business process", "Requirements engineering", "Systems analysis"],
    ),
    "meal": (
        "Monitoraggio, valutazione e apprendimento", "T6",
        ["monitoring and evaluation", "humanitarian evaluation",
         "accountability to affected populations", "logical framework",
         "outcome harvesting", "needs assessment", "sphere standards",
         "core humanitarian standard", "cash and voucher assistance",
         "protection mainstreaming", "humanitarian", "m&e", "merl", "community feedback",
         "feedback mechanisms", "impact evaluation", "community listening"],
        ["meal", "logframe", "beneficiary", "feedback mechanism", "do no harm",
         "cluster coordination", "aid", "displacement", "refugees", "food security",
         "evaluation", "beneficiaries", "localisation", "anticipatory action",
         "early warning"],
        ["Humanitarian aid", "Program evaluation", "Development studies"],
    ),
    "salute_digitale": (
        "Salute digitale e sistemi informativi sanitari", "T6",
        ["health information system", "dhis2", "electronic health record",
         "interoperability", "hl7 fhir", "icd-11", "digital health intervention",
         "telemedicine", "health data standard", "openmrs", "digital health", "health data",
         "fhir", "ehr", "emr", "mhealth", "bahmni", "health informatics"],
        ["terminology", "registry", "clinical data", "who guideline", "health records",
         "community health workers"],
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


def occorre(termine, testo):
    """Confronto a confine di parola: 'ia' non deve trovarsi dentro 'social'.

    È l'unica regola di confronto del sistema, e vale anche per il filtro del
    rumore e per il verificatore delle fonti: due regole diverse sono due idee
    diverse di che cosa significhi «il testo contiene questo termine».
    """
    return re.search(r"(?<!\w)" + re.escape(termine) + r"(?!\w)", testo) is not None


def _valuta(titolo, abstract="", concetti=()):
    """-> {tema: (totale, forte)}, dove `forte` è la parte che NON viene dai deboli.

    La distinzione serve a una domanda sola, e non è «di che cosa parla questa
    voce»: è «questa FONTE parla di questo argomento». Due termini deboli nel
    titolo fanno 1,2 e la voce entra in libreria — così dice il contratto della
    rassegna — ma dieci voci così non dicono nulla sul feed che le pubblica, e
    `verifica_fonti.py` non deve accettarlo per quelle.
    """
    t = normalizza(titolo)
    a = normalizza(abstract)
    c = {normalizza(x) for x in concetti or ()}

    esiti = {}
    for tema, (_, _, forti, deboli, concetti_tema) in SPECIALIZZAZIONI.items():
        p = f = 0.0
        for termine in forti:
            n = normalizza(termine)
            if occorre(n, t):
                f += PESO_FORTE * PESO_TITOLO
            elif occorre(n, a):
                f += PESO_FORTE
        for concetto in concetti_tema:
            if normalizza(concetto) in c:
                f += PESO_CONCETTO
        p = f
        for termine in deboli:
            n = normalizza(termine)
            if occorre(n, t):
                p += PESO_DEBOLE * PESO_TITOLO
            elif occorre(n, a):
                p += PESO_DEBOLE
        if p > 0:
            esiti[tema] = (round(p, 3), round(f, 3))
    return esiti


def punteggi(titolo, abstract="", concetti=()):
    """Punteggio per ogni tema. Restituisce un dict tema_slug -> float > 0."""
    return {tema: tot for tema, (tot, _) in _valuta(titolo, abstract, concetti).items()}


def temi_solo_deboli(titolo, abstract="", concetti=()):
    """I temi il cui punteggio non contiene nemmeno un termine forte o un concetto."""
    return {tema for tema, (_, forte) in _valuta(titolo, abstract, concetti).items()
            if not forte}


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
    return not any(occorre(normalizza(m), t) for m in NON_PUBBLICAZIONI)


def e_rumore(titolo, esclusioni):
    """Falso positivo redazionale: usa assets/contenuti/esclusioni_rassegna.json.

    A confine di parola, come tutto il resto del modulo. Con il confronto per
    sottostringa «valuation» catturava «evaluations»: ogni articolo su una
    valutazione di modelli — cioè il cuore del tema `ia`, e la ragione per cui
    metà delle fonti nuove esiste — spariva come se fosse un comunicato su un
    round di finanziamento. Un filtro che toglie il contenuto migliore è
    peggio di nessun filtro, perché non lascia traccia.
    """
    t = normalizza(titolo)
    return any(occorre(normalizza(e), t) for e in esclusioni or ())


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
