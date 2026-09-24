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
import functools
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

# ----------------------------------------------- le altre tre lingue del lessico
# Fino a ieri questo vocabolario era tutto in inglese, e la conseguenza non era
# teorica: un testo italiano, spagnolo o francese senza gergo inglese prendeva
# ZERO temi, quindi una fonte che pubblica in quelle lingue veniva scartata dal
# verificatore e non entrava mai. Misurato prima della modifica: quindici testi
# veri nelle tre lingue, quattro classificati.
#
# Stanno QUI e non dentro `SPECIALIZZAZIONI` per tre ragioni:
#
#  1. si fondono in CODA alle liste inglesi, e l'ordine conta.
#     `consegna_code/scopri_fonti.py` e `consegna_code/test_fonti.py` prendono
#     `FUERTES[slug][:2]` e `[:4]` come parole con cui interrogare iTunes,
#     Hacker News e gli archivi aperti — e quelle si interrogano in inglese.
#     In testa, lo scouting cercherebbe «integrità referenziale» su Hacker News;
#  2. restano leggibili e revocabili in un blocco solo. Un lessico che decide
#     la classificazione di tutto l'archivio non si mescola alla sorgente che
#     era già stata verificata;
#  3. l'inglese resta la lingua di riferimento del vocabolario, che è ciò che
#     tiene allineati il verificatore delle fonti e la rassegna quotidiana.
#
# Due regole hanno governato la scelta dei termini, e si vedono nel risultato:
# LOCUZIONI, non parole singole — 274 su 321 hanno due o più parole — e nessuna
# stringa che, tolti gli accenti, sia anche una parola comune di un'altra
# lingua. Lo spagnolo «red» è l'esempio che è stato scartato apposta: diventa la
# stringa «red», che in inglese è un colore e comparirebbe ovunque.
#
# Gli accenti si possono scrivere: `normalizza()` li toglie al confronto. I
# plurali sono voci separate perché `occorre()` confronta a confine di parola, e
# «base de datos» non trova «bases de datos» — la stessa ragione per cui
# l'inglese elenca «index» e «indexes».
ALTRE_LINGUE = {
    "sql_base": (
        [
            "basi di dati relazionali", "integrità referenziale", "chiave primaria",
            "base di dati relazionale",
            "bases de datos relacionales", "base de datos relacional",
            "integridad referencial", "clave primaria", "claves foráneas",
            "bases de données relationnelles", "base de données relationnelle",
            "intégrité référentielle", "clé primaire", "clés étrangères"
        ],
        [
            "bases de datos", "algebra relazionale", "álgebra relacional",
            "algèbre relationnelle", "procedimientos almacenados", "procédures stockées"
        ],
    ),
    "ottimizzazione": (
        [
            "piano di esecuzione", "piani di esecuzione", "prestazioni delle query",
            "ottimizzazione delle query", "stima della cardinalità",
            "optimización de consultas", "estimación de cardinalidad", "consultas lentas",
            "optimisation des requêtes", "performance des requêtes", "requêtes lentes",
            "exécution vectorisée"
        ],
        [
            "profilazione del codice", "elaborazione parallela", "plan de ejecución",
            "planes de ejecución", "almacenamiento columnar", "traitement parallèle"
        ],
    ),
    "lettura_codice": (
        [
            "codice sorgente", "controllo di versione", "test unitari", "código fuente",
            "control de versiones", "pruebas unitarias", "refactorización", "code source",
            "revue de code", "tests unitaires", "débogage"
        ],
        [
            "debito tecnico", "leggibilità del codice", "righe di codice", "deuda técnica",
            "legibilidad del código", "líneas de código", "dette technique",
            "base de code"
        ],
    ),
    "modellazione": (
        [
            "modellazione dei dati", "ingegneria dei dati", "entità-relazione",
            "ingeniería de datos", "entidad-relación", "ingénierie des données",
            "entité-association", "entrepôt de données", "entrepôts de données"
        ],
        [
            "esquema en estrella", "architettura dei dati", "arquitectura de datos",
            "architecture des données", "tabla de hechos", "tablas de hechos",
            "table de faits"
        ],
    ),
    "statistica": (
        [
            "inferenza causale", "inferenza bayesiana", "intervallo di confidenza",
            "regressione logistica", "inferencia causal", "inferencia bayesiana",
            "intervalo de confianza", "regresión logística", "inférence causale",
            "inférence bayésienne", "intervalle de confiance"
        ],
        [
            "significatività statistica", "deviazione standard", "numerosità campionaria",
            "desviación estándar", "muestreo aleatorio", "distribución de probabilidad",
            "écart-type", "plan de sondage", "loi de probabilité"
        ],
    ),
    "epidemiologia": (
        [
            "epidemiologia", "épidémiologie", "sorveglianza epidemiologica",
            "vigilancia epidemiológica", "surveillance épidémiologique",
            "veille sanitaire", "malattie infettive", "enfermedades infecciosas",
            "maladies infectieuses", "copertura vaccinale", "cobertura vacunal",
            "couverture vaccinale"
        ],
        [
            "tasso di mortalità", "tasa de mortalidad", "taux de mortalité",
            "surmortalité", "paludisme", "tubercolosi"
        ],
    ),
    "kpi": (
        [
            "visualizzazione dati", "indicatori chiave di prestazione",
            "cruscotto direzionale", "grafico a barre", "visualización de datos",
            "cuadro de mando", "cuadros de mando", "indicadores clave de desempeño",
            "gráfico de barras", "indicateurs clés de performance"
        ],
        [
            "infografica", "infografiche", "scala di colori", "infografía", "infografías",
            "escala de color", "mapa de calor", "infographie", "échelle de couleurs",
            "indicateurs de performance"
        ],
    ),
    "qualita_dati": (
        [
            "qualità dei dati", "riproducibilità", "scienza aperta",
            "calidad de los datos", "reproducibilidad", "ciencia abierta",
            "datos abiertos", "qualité des données", "reproductibilité", "science ouverte",
            "données ouvertes"
        ],
        [
            "metadati", "pulizia dei dati", "dati mancanti", "metadatos",
            "limpieza de datos", "datos faltantes", "métadonnées", "nettoyage des données",
            "données manquantes"
        ],
    ),
    "gdpr": (
        [
            "protezione dei dati", "dati sensibili", "diritti degli interessati",
            "minimizzazione dei dati", "violazione dei dati", "protección de datos",
            "datos sensibles", "derecho al olvido",
            "transferencias internacionales de datos", "protection des données",
            "données à caractère personnel", "minimisation des données",
            "protection de la vie privée"
        ],
        [
            "titolare del trattamento", "responsabile del trattamento", "anonimizzazione",
            "pseudonimizzazione", "profilazione", "responsable del tratamiento",
            "encargado del tratamiento", "anonimización", "responsable du traitement",
            "cnil"
        ],
    ),
    "ai_act": (
        [
            "regolamento IA", "IA ad alto rischio", "IA per finalita generali",
            "reglamento de IA", "ley de IA", "IA de alto riesgo", "IA de uso general",
            "reglement IA", "IA a haut risque", "IA a usage general"
        ],
        ["responsabilita algoritmica", "gobernanza algoritmica"],
    ),
    "ia": (
        [
            "intelligenza artificiale", "apprendimento automatico", "modelli linguistici",
            "modello linguistico", "ia generativa", "inteligencia artificial",
            "aprendizaje automático", "modelos de lenguaje", "modelo de lenguaje",
            "intelligence artificielle", "apprentissage automatique", "modèles de langage",
            "modèle de langage", "ia générative"
        ],
        [
            "apprendimento profondo", "aprendizaje profundo", "apprentissage profond",
            "agente conversazionale", "agente conversacional", "agent conversationnel"
        ],
    ),
    "sicurezza": (
        [
            "sicurezza informatica", "cybersicurezza", "attacco informatico",
            "attacchi informatici", "ciberseguridad", "seguridad informática",
            "ciberataque", "ciberataques", "cybersécurité", "sécurité informatique",
            "cyberattaque", "cyberattaques", "rançongiciel", "hameçonnage"
        ],
        [
            "aggiornamenti di sicurezza", "autenticazione a due fattori", "crittografia",
            "brecha de seguridad", "autenticación de dos factores",
            "cifrado de extremo a extremo", "correctifs de sécurité",
            "chiffrement des données", "authentification à deux facteurs"
        ],
    ),
    "hardware": (
        [
            "connettività intermittente", "connettività satellitare", "cavi sottomarini",
            "gruppo di continuità", "conectividad satelital", "conectividad rural",
            "cables submarinos", "reprise après sinistre", "connectivité satellitaire",
            "câbles sous-marins"
        ],
        [
            "interruzione di corrente", "gruppo elettrogeno", "banda larga",
            "cortes de energía", "grupo electrógeno", "banda ancha", "coupures de courant",
            "délestage", "onduleur", "groupe électrogène"
        ],
    ),
    "governance": (
        [
            "governo dei dati", "affidabilita operativa", "gobernanza de datos",
            "gobierno del dato", "fiabilidad operativa", "gouvernance des donnees",
            "fiabilite operationnelle", "conduite du changement"
        ],
        [
            "livelli di servizio", "osservabilita", "turni di reperibilita",
            "acuerdo de nivel de servicio", "observabilidad", "niveaux de service",
            "observabilite"
        ],
    ),
    "business_analysis": (
        [
            "mappatura dei processi", "analisi dei requisiti", "raccolta dei requisiti",
            "levantamiento de requisitos", "ingeniería de requisitos",
            "minería de procesos", "cartographie des processus",
            "ingénierie des exigences"
        ],
        [
            "analisi costi-benefici", "criteri di accettazione", "requisiti funzionali",
            "mejora de procesos", "criterios de aceptación", "requisitos funcionales",
            "historias de usuario", "exigences fonctionnelles", "expression des besoins"
        ],
    ),
    "meal": (
        [
            "monitoraggio e valutazione", "quadro logico", "aiuti umanitari",
            "aiuto umanitario", "cooperazione allo sviluppo", "monitoreo y evaluación",
            "marco lógico", "ayuda humanitaria", "suivi-évaluation", "cadre logique",
            "aide humanitaire"
        ],
        [
            "sfollati", "rifugiati", "operatori umanitari", "desplazados internos",
            "refugiados", "ayuda alimentaria", "personnes déplacées", "réfugiés",
            "aide alimentaire"
        ],
    ),
    "salute_digitale": (
        [
            "sistema informativo sanitario", "sistemi informativi sanitari",
            "fascicolo sanitario elettronico", "cartella clinica elettronica",
            "sanità digitale", "telemedicina", "historia clínica electrónica",
            "sistema de información en salud", "sistemas de información en salud",
            "salud digital", "dossier médical partagé", "santé numérique", "e-santé",
            "télémédecine"
        ],
        [
            "dati clinici", "terminologia clinica", "teleconsulto", "datos clínicos",
            "teleconsulta", "données cliniques", "téléconsultation"
        ],
    ),
}

# La fusione: in coda, senza duplicati, e senza toccare i concetti OpenAlex, che
# sono identificatori di un servizio esterno e non termini da tradurre.
def _fondi_le_lingue():
    """Dentro una funzione, e non a modulo: con `ALTRE_LINGUE` vuoto il `del`
    delle variabili di ciclo sollevava NameError e il modulo non si importava
    più. Un classificatore che non si importa ferma la rassegna di quella
    mattina, e il difetto sarebbe apparso solo il giorno in cui qualcuno svuota
    il blocco per provare una cosa."""
    for slug, (altri_forti, altri_deboli) in ALTRE_LINGUE.items():
        nome, trim, forti, deboli, concetti = SPECIALIZZAZIONI[slug]
        SPECIALIZZAZIONI[slug] = (
            nome, trim,
            forti + [t for t in altri_forti if t not in forti],
            deboli + [t for t in altri_deboli if t not in deboli],
            concetti,
        )


_fondi_le_lingue()


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


@functools.lru_cache(maxsize=4096)
def _modello(termine):
    """L'espressione compilata di un termine, una volta sola.

    La cache interna di `re` tiene 512 espressioni: con 793 termini nel
    vocabolario ogni chiamata ne buttava fuori una e ricompilava, e il costo si
    pagava per OGNI documento. Misurato sulle 2637 voci del catalogo vero:
    116 secondi senza questa cache, 7 con. Il vocabolario è fisso, le voci no —
    è il verso giusto in cui mettere il lavoro.
    """
    return re.compile(r"(?<!\w)" + re.escape(termine) + r"(?!\w)")


def occorre(termine, testo):
    """Confronto a confine di parola: 'ia' non deve trovarsi dentro 'social'.

    È l'unica regola di confronto del sistema, e vale anche per il filtro del
    rumore e per il verificatore delle fonti: due regole diverse sono due idee
    diverse di che cosa significhi «il testo contiene questo termine».
    """
    return _modello(termine).search(testo) is not None


# Il vocabolario normalizzato UNA VOLTA, all'importazione.
#
# Prima stava dentro `_valuta`, che chiamava `normalizza()` su ogni termine per
# ogni voce: con 312 termini si pagava e non si vedeva, con 793 si vede. Misurato
# sulle stesse 2637 voci del catalogo vero: 13,9 secondi prima delle tre lingue
# nuove, 128 dopo — nove volte, non due e mezzo, perché `unicodedata.normalize`
# costa e veniva rifatto identico per ogni documento. Precalcolando: 7,9.
#
# Sta QUI, sotto `normalizza()` e sotto la fusione di ALTRE_LINGUE, perché ha
# bisogno di tutt'e due. Da questo punto in poi `SPECIALIZZAZIONI` non si tocca
# più: chi la modificasse a caldo troverebbe una cache ferma alla versione di
# prima, e il difetto sarebbe silenzioso.
_NORMALIZZATI = {
    tema: ([normalizza(x) for x in forti],
           [normalizza(x) for x in deboli],
           {normalizza(x) for x in concetti_tema})
    for tema, (_, _, forti, deboli, concetti_tema) in SPECIALIZZAZIONI.items()
}


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
    for tema, (forti, deboli, concetti_tema) in _NORMALIZZATI.items():
        p = f = 0.0
        for n in forti:
            if occorre(n, t):
                f += PESO_FORTE * PESO_TITOLO
            elif occorre(n, a):
                f += PESO_FORTE
        f += PESO_CONCETTO * len(concetti_tema & c)
        p = f
        for n in deboli:
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
