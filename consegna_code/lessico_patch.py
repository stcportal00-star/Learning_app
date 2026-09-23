"""Parche al léxico fuerte del clasificador (añadir a los términos existentes, peso 1.0).
MEDIDO: efecto verificado en AISI, Anthropic Red y FAR.AI (voces 1-10 y 11-20).
NO_MEDIDO: añadido por regla general, sin feed de prueba en esta sesión."""
MEDIDO = {
    "ia": ["llm", "llms", "evals", "eval", "evaluations", "red team", "jailbreak",
           "jailbreaking", "agentic", "ai agent", "ai agents", "language model",
           "language models", "frontier model", "frontier models", "interpretability",
           "sandbagging", "model behaviour", "model behavior"],
    "sicurezza": ["exploit", "exploits", "0-day", "0-days", "zero-day", "zero-days", "cve",
                  "cyber", "cybersecurity", "misconfiguration", "misconfigurations"],
    "governance": ["incident report"],
}
NO_MEDIDO = {
    "gdpr": ["rgpd", "dati personali", "données personnelles", "datos personales"],
    "governance": ["postmortems", "post-mortem", "incident review"],
}
def aplicar(lessico: dict, incluir_no_medido: bool = False) -> dict:
    fuentes = [MEDIDO] + ([NO_MEDIDO] if incluir_no_medido else [])
    for extra in fuentes:
        for slug, terms in extra.items():
            base = lessico.setdefault(slug, [])
            base.extend(t for t in terms if t not in base)
    return lessico

# DOMINIO: términos inequívocos de cada disciplina (glosarios estándar), elegidos SIN mirar las voces 11-20;
# validados en esas voces reservadas (ver HANDOFF §10). Mismo peso que el léxico fuerte.
DOMINIO = {
    'sicurezza':       ['malware', 'phishing', 'vulnerability', 'vulnerabilities', 'ddos', 'botnet', 'infostealer',
                        'backdoor', 'threat intelligence', 'security advisory', 'patch tuesday', 'cyberattack'],
    'hardware':        ['bgp', 'routing security', 'internet outage', 'submarine cable', 'solar power', 'starlink',
                        'off-grid', 'battery storage', 'rural connectivity', 'mesh network'],
    'kpi':             ['data visualisation', 'dataviz', 'data vis', 'infographic', 'infographics', 'chart', 'charts',
                        'visualisation', 'visualization', 'data storytelling'],
    'qualita_dati':    ['open data', 'metadata', 'data sharing', 'data standards', 'research software', 'open science',
                        'reproducible', 'data documentation', 'data dictionary'],
    'epidemiologia':   ['outbreak', 'outbreaks', 'vaccination', 'vaccines', 'measles', 'influenza', 'epidemiological',
                        'public health', 'mpox', 'cholera', 'dengue', 'pathogen', 'pathogens', 'antimicrobial resistance'],
    'statistica':      ['statistical', 'bayesian', 'anova', 'nonparametric', 'mixed models', 'estimator'],
    'gdpr':            ['privacy', 'data protection', 'personal data', 'rgpd', 'données personnelles', 'dati personali',
                        'datos personales', 'data breach'],
    'ai_act':          ['ai regulation', 'ai policy', 'algorithmic', 'ai governance', 'ai safety institute'],
    'meal':            ['humanitarian', 'm&e', 'merl', 'community feedback', 'feedback mechanisms', 'impact evaluation',
                        'community listening'],
    'salute_digitale': ['digital health', 'health data', 'fhir', 'ehr', 'emr', 'mhealth', 'bahmni', 'health informatics'],
    'lettura_codice':  ['software engineering', 'codebase', 'code quality', 'unit tests'],
    'business_analysis': ['process mining', 'workflow analysis', 'business process', 'process improvement'],
    'governance':      ['incident', 'incidents', 'outage', 'outages', 'observability', 'on-call', 'reliability'],
    'sql_base':        ['postgres', 'mysql', 'sql server', 'database', 'databases'],
    'ottimizzazione':  ['benchmark', 'benchmarks', 'query compilation', 'performance tuning', 'partition pruning'],
    'modellazione':    ['data engineering', 'data products', 'data warehouse', 'lakehouse', 'dbt', 'shift left'],
    'ia':              ['machine learning', 'artificial intelligence', 'neural network', 'ai model', 'ai models'],
}
def aplicar_todo(lessico: dict) -> dict:
    aplicar(lessico)
    for slug, terms in DOMINIO.items():
        base = lessico.setdefault(slug, [])
        base.extend(t for t in terms if t not in base)
    return lessico
