"""Configuración editable: temas relacionados, ruido, exploración, autorreparación, descubrimiento.
Todo lo que aquí es 'parámetro propio' no viene de PROMPT-FONTI.md."""

# --- Temas relacionados (tier DÉBIL: 0.6 en título, 0.4 en sumario) ------------------------
# Solos no llegan al umbral 1.0; juntos (2 en título, o 1 fuerte + débiles) sí.
# DEBEN fusionarse también en el léxico débil del clasificador real (si no, verificador y pipeline divergen).
RELACIONADOS = {
    'sql_base':        ['database', 'databases', 'mysql', 'sql server', 'index', 'indexes', 'query', 'queries', 'schema'],
    'ottimizzazione':  ['performance', 'benchmark', 'benchmarks', 'latency', 'throughput', 'caching', 'profiling'],
    'modellazione':    ['schema', 'dbt', 'data warehouse', 'lakehouse', 'ontology', 'metrics layer', 'data product'],
    'lettura_codice':  ['python', 'git', 'testing', 'codebase', 'pull request', 'legacy code', 'code quality'],
    'statistica':      ['statistics', 'sampling', 'survey design', 'estimation', 'uncertainty', 'weighting', 'r package'],
    'epidemiologia':   ['outbreak', 'cholera', 'measles', 'dengue', 'mpox', 'malnutrition', 'public health', 'surveillance', 'mortality'],
    'kpi':             ['indicator', 'indicators', 'metrics', 'chart', 'charts', 'visualisation', 'visualization', 'infographic', 'power bi'],
    'qualita_dati':    ['data cleaning', 'open data', 'metadata', 'data standards', 'hxl', 'validation', 'data sharing'],
    'gdpr':            ['privacy', 'personal data', 'data breach', 'consent', 'data protection', 'biometric', 'data retention'],
    'ai_act':          ['ai regulation', 'ai policy', 'ai safety', 'compliance', 'european commission', 'ai office', 'standards'],
    'ia':              ['agents', 'benchmark', 'transformer', 'gpt', 'claude', 'gemini', 'open weights', 'inference'],
    'business_analysis': ['workflow', 'requirements', 'stakeholders', 'bpmn', 'use case', 'user research'],
    'governance':      ['reliability', 'outage', 'incident', 'on-call', 'sla', 'slo', 'runbook', 'decision making'],
    'hardware':        ['starlink', 'vsat', 'solar power', 'battery', 'generator', 'connectivity', 'mesh network', 'lora', 'android', 'tablet', 'sync'],
    'sicurezza':       ['phishing', 'malware', 'vulnerability', 'patch', 'breach', 'mfa', 'encryption', 'backup'],
    'meal':            ['humanitarian', 'aid', 'displacement', 'refugees', 'food security', 'evaluation', 'beneficiaries', 'localisation', 'anticipatory action', 'early warning'],
    'salute_digitale': ['ehr', 'health data', 'mhealth', 'digital health', 'health records', 'community health workers', 'fhir'],
}

# --- Exploración (off-topic interesante) ------------------------------------------------------
# Voz sin tema, sin ruido, con texto >= ESPLORAZIONE_MIN_CHARS -> candidata a 'esplorazione'.
# Cupo diario a implementar en el pipeline (Code): máximo ESPLORAZIONE_MAX_DIA voces.
ESPLORAZIONE_MIN_CHARS = 1500
ESPLORAZIONE_MAX_DIA = 5
ESPLORAZIONE_SEGNALI = ['case study', 'lessons learned', 'field notes', 'retrospective', 'how we built',
                        'deep dive', 'long read', 'history of', 'what we learned', 'post-mortem']

# --- Ruido (§6b) + extras por tema; comparación SIEMPRE a límite de palabra ------------------
RUMORE = ['round di finanziamento', 'funding round', 'series a', 'series b', 'valuation', 'nomina', 'appointed',
          'joins as', 'steps down', 'hires', 'lancia il nuovo', 'announces the launch', 'now available',
          'general availability', 'predizioni per il', 'predictions for', 'trends to watch', 'what to expect in',
          'migliori strumenti', 'best tools', 'top 10', 'top 5', 'listicle', 'ha dichiarato che', 'ceo says',
          'reacts to', 'slams', 'sparks debate', 'partnership with', 'acquisisce', 'acquires']
RUMORE_EXTRA = {
    'ia':       ['pricing', 'waitlist', 'webinar', 'sign up'],
    'hardware': ['deals', 'black friday', 'unboxing', 'hands-on'],
    'sicurezza':['webinar', 'sponsored'],
    'kpi':      ['giveaway', 'webinar'],
}

# --- Autorreparación de url_feed ---------------------------------------------------------------
SUFIJOS_FEED = ['/feed/', '/feed', '/rss', '/rss.xml', '/atom.xml', '/index.xml', '/feed.xml', '/feed/atom/', '/?feed=rss2', '/feed/rss/',
                '?format=rss', '/feeds/posts/default', '/blog/feed/', '/blog/rss.xml', '/latest.rss']
MAX_CANDIDATOS = 16
ESPEJOS = ['raw.githubusercontent.com']   # feeds generados por terceros: el canal apunta al editor

# --- Calidad de fuente -------------------------------------------------------------------------
MARCAS_PAYWALL = ['this post is for paid subscribers', 'for paid subscribers', 'subscribe to continue',
                  'subscribe to keep reading', 'become a paid subscriber', 'continue reading with a subscription',
                  'members only', 'sign in to read', 'premium content', 'this article is for subscribers']
PAYWALL_MAX = 1          # de 3 artículos muestreados; más de 1 con muro = fuente rechazada
UMBRAL_VOCES, UMBRAL, UMBRAL_DISTINTOS = 4, 1.0, 0.8
MAX_DIAS_SIN_PUBLICAR = 365
# Un feed sintetizado desde el sitemap se acepta solo si tiene al menos estas
# voces con fecha FIABLE (meta de publicación, JSON-LD o fecha en la URL) dentro
# de MAX_DIAS_SIN_PUBLICAR. Caso real (ReliefWeb): el <lastmod> del sitemap decía
# 2026 para /countries, una página de navegación, y esa sola voz hacía pasar p0
# mientras los 4 informes reales eran de 2007-2009.
SINTESIS_MIN_RECIENTES = 3
MAX_FALLOS_TRANSITORIOS = 3

# --- Descubrimiento por keyword (scopri_fonti.py) ---------------------------------------------
EXCLUIR_DOMINIOS = ['twitter.com', 'x.com', 'youtube.com', 'youtu.be', 'linkedin.com', 'facebook.com',
    'reddit.com', 'instagram.com', 'tiktok.com', 'news.ycombinator.com', 'github.com', 'gist.github.com',
    'arxiv.org', 'doi.org', 'wikipedia.org', 'nytimes.com', 'forbes.com', 'bloomberg.com', 'wsj.com',
    'theguardian.com', 'bbc.co.uk', 'bbc.com', 'cnn.com', 'reuters.com', 'techcrunch.com', 'theverge.com',
    'wired.com', 'businessinsider.com', 'ft.com', 'washingtonpost.com', 'medium.com', 'amazon.com',
    'google.com', 'apple.com', 'microsoft.com', 'docs.google.com', 'drive.google.com', 'bit.ly',
    'spdx.org', 'gitlab.com', 'shields.io', 'awesome.re', 'creativecommons.org', 'opensource.org']  # insignias/licencias/repos
TEMI_UMANITARI = {'meal', 'epidemiologia', 'hardware', 'salute_digitale', 'gdpr', 'qualita_dati'}
AWESOME = {   # consulta a la API de búsqueda de GitHub; se leen los enlaces del README
    'sql_base': 'awesome sql', 'ottimizzazione': 'awesome database', 'modellazione': 'awesome data engineering',
    'lettura_codice': 'awesome code review', 'statistica': 'awesome statistics', 'epidemiologia': 'awesome epidemiology',
    'kpi': 'awesome dataviz', 'qualita_dati': 'awesome data quality', 'gdpr': 'awesome privacy',
    'ai_act': 'awesome ai policy', 'ia': 'awesome llm evaluation', 'business_analysis': 'awesome process mining',
    'governance': 'awesome sre', 'hardware': 'awesome offline first', 'sicurezza': 'awesome incident response',
    'meal': 'awesome humanitarian', 'salute_digitale': 'awesome digital health',
}
KEYWORDS_SCOUT = {}   # slug -> [términos]; vacío = primeros 4 términos fuertes del léxico

# Los catálogos de iTunes que se preguntan al buscar podcasts. El mismo término
# devuelve programas distintos en cada país, y es la vía más corta a quien
# divulga en italiano, español o francés: los archivos abiertos se interrogan
# solo en inglés y esa gente no la ven nunca (PROMPT-FONTI §7).
PAESI_PODCAST = ['it', 'us', 'es', 'fr']

# --- Plataformas: el HOST completo identifica la fuente (no el dominio base) ------------------
PLATAFORMAS = ['substack.com', 'blogspot.com', 'github.io', 'wordpress.com', 'ghost.io', 'medium.com',
               'netlify.app', 'pages.dev', 'hashnode.dev', 'buttondown.email', 'beehiiv.com', 'tumblr.com']
# --- Reparación: solo automática dentro del mismo sitio; estos hosts de feed se admiten además
HOSTS_FEED_ADMITIDOS = ['feeds.feedburner.com', 'feedpress.me', 'raw.githubusercontent.com']
MIN_SUMARIO_SIN_ARTICULO = 500   # si no se puede descargar ningún artículo, el sumario debe tener al menos esto

# --- Plataformas donde la licencia NO es del sitio, sino de cada voz -----------
# Un canal de YouTube o un perfil de Mastodon no declaran una licencia de sitio:
# la decide quien publica, vídeo por vídeo. p7 los rechazaría a todos, y con
# razón mientras se guarde el texto.
#
# De estas fuentes se guarda SOLO el metadato -título, descripción, fecha,
# enlace- y nunca el texto descargado. Eso sí es una licencia declarada y
# citable, y no es una promesa: `feed.py` marca esas voces y `pubblica.py` no
# les extrae el texto. Quitar una entrada de aquí significa que sus fuentes
# vuelven a caer en p7; quitarla del pipeline sin quitarla de aquí sería
# declarar una cosa y hacer otra.
PIATTAFORME_METADATI = [
    (r'(?i)^https?://(?:www\.)?youtube\.com/feeds/videos\.xml\?channel_id=UC',
     'solo metadati e collegamento; su YouTube la licenza è di chi pubblica, voce per voce'),
    (r'(?i)^https?://[^/]+/@[A-Za-z0-9_]+\.rss$',
     'solo metadati e collegamento; su Mastodon la licenza è di chi pubblica, voce per voce'),
]

# --- Producción ------------------------------------------------------------------------------
LICENCIA_AMPLIA = True      # decisión A aplicada: licencia declarada = CC/OGL/rel=license O aviso de copyright del sitio.
                            # Revertir: False, o ejecutar con --licencia-estricta.
USAR_DOMINIO = True         # vocabulario de dominio (lessico_patch.DOMINIO), validado en voces reservadas 11-20
DISYUNTOR_RED = 0.40        # si >=40% de las fuentes fallan por red/bloqueo en una corrida -> NO se escribe nada (entorno roto)
DISYUNTOR_CAIDA = 0.50      # si las aceptadas caen >50% respecto a la corrida anterior -> NO se escribe nada
IDENTIDAD_MIN = 0.5         # similitud mínima nombre↔título del nuevo sitio para aplicar sola una migración de dominio
