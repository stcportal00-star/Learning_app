"""Núcleo compartido: red, puntuación, autorreparación, licencia, muro de pago, dominio."""
import re, os, time, calendar, socket, gzip, zlib, html as H, urllib.request, urllib.error, urllib.parse
from dataclasses import dataclass, field
import feedparser
import temi_config as C
from lessico_patch import aplicar

socket.setdefaulttimeout(20)
UA = 'Mozilla/5.0 (compatible; percorso-fonti/1.0)'

FUERTES = {  # extracto del léxico fuerte de PROMPT-FONTI §3 (réplica). Sustituir por import del clasificador real (B3).
'sql_base':"sql, relational database, query optimizer, query plan, postgresql, sqlite, duckdb, transaction isolation, acid, join algorithm",
'ottimizzazione':"query performance, execution plan, cardinality estimation, vectorized execution, columnar storage, index selection, cost model, query rewriting",
'modellazione':"data modeling, dimensional model, star schema, data vault, entity relationship, data contract, semantic layer, schema evolution, data mesh",
'lettura_codice':"code comprehension, code review, static analysis, debugging, version control, refactoring, software maintenance",
'statistica':"causal inference, bayesian inference, regression, time series forecasting, confidence interval, hypothesis testing, propensity score, difference-in-differences, instrumental variable, survival analysis",
'epidemiologia':"epidemiology, disease surveillance, outbreak detection, incidence rate, case fatality, cohort study, case-control, seroprevalence, vaccination coverage, nutritional survey, smart survey, mortality survey",
'kpi':"key performance indicator, data visualization, dashboard design, indicator framework, visual encoding, chart design, performance measurement",
'qualita_dati':"data quality, data validation, reproducibility, research data management, missing data, record linkage, deduplication, data provenance, fair data",
'gdpr':"gdpr, general data protection regulation, data protection impact assessment, lawful basis, data minimisation, data subject rights, international data transfer, data protection by design, humanitarian data protection",
'ai_act':"ai act, artificial intelligence act, high-risk ai system, conformity assessment, general purpose ai, ai governance framework, algorithmic accountability, fundamental rights impact assessment",
'ia':"large language model, retrieval augmented generation, prompt injection, model evaluation, hallucination, fine-tuning, foundation model, ai risk management, red teaming, model card",
'business_analysis':"requirements elicitation, business process modeling, stakeholder analysis, process mining, value stream mapping, cost-benefit analysis, theory of change",
'governance':"service level objective, error budget, site reliability engineering, architecture decision record, data governance, stewardship, operating model, postmortem, change management",
'hardware':"mobile device management, network latency, offline first, intermittent connectivity, delay tolerant network, business continuity, disaster recovery, edge computing, satellite connectivity, power resilience",
'sicurezza':"incident response, threat modeling, vulnerability management, zero trust, security framework, ransomware, supply chain security, nis2, cyber resilience, penetration testing",
'meal':"monitoring and evaluation, humanitarian evaluation, accountability to affected populations, logical framework, outcome harvesting, needs assessment, sphere standards, core humanitarian standard, cash and voucher assistance, protection mainstreaming",
'salute_digitale':"health information system, dhis2, electronic health record, interoperability, hl7 fhir, icd-11, digital health intervention, telemedicine, health data standard, openmrs",
}
FUERTES = {k: [t.strip() for t in v.split(',')] for k, v in FUERTES.items()}
_BASE = None
def configurar(parche=True, dominio=None):
    global FUERTES, _BASE
    import lessico_patch as LP
    _BASE = _BASE or {k: list(v) for k, v in FUERTES.items()}
    FUERTES = {k: list(v) for k, v in _BASE.items()}
    if parche: LP.aplicar(FUERTES)
    if parche and (C.USAR_DOMINIO if dominio is None else dominio):
        for slug, terms in LP.DOMINIO.items():
            FUERTES.setdefault(slug, []).extend(t for t in terms if t not in FUERTES[slug])

# ---------------------------------------------------------------- red
@dataclass
class Resp:
    status: int | None; url: str; redirects: list = field(default_factory=list)
    ctype: str = ''; body: bytes = b''; error: str | None = None
    @property
    def transitorio(self): return self.status is None or self.status >= 500 or self.status == 429
    @property
    def permanente(self): return any(c in (301, 308) for c, _ in self.redirects)

class _Rec(urllib.request.HTTPRedirectHandler):
    def __init__(self): self.chain = []
    def redirect_request(self, req, fp, code, msg, hdrs, newurl):
        self.chain.append((code, newurl)); return super().redirect_request(req, fp, code, msg, hdrs, newurl)

def fetch(url, limit=3_000_000) -> Resp:
    if os.path.exists(url): return Resp(200, url, body=open(url, 'rb').read())
    rec = _Rec(); op = urllib.request.build_opener(rec)
    try:
        r = op.open(urllib.request.Request(url, headers={'User-Agent': UA, 'Accept': '*/*', 'Accept-Encoding': 'gzip, deflate'}))
        return Resp(r.status, r.geturl(), rec.chain, r.headers.get('Content-Type', ''), descomprimir(r.read(limit), r.headers.get('Content-Encoding', '')))
    except urllib.error.HTTPError as e: return Resp(e.code, url, rec.chain, error=f'HTTP {e.code}')
    except Exception as e: return Resp(None, url, rec.chain, error=type(e).__name__)

def descomprimir(b, enc=''):
    """Caso real (Visualising Data): servidores que envían gzip aunque no se pida. Se detecta por cabecera o por firma."""
    try:
        if b[:2] == b'\x1f\x8b' or 'gzip' in enc.lower(): return gzip.decompress(b)
        if 'deflate' in enc.lower():
            try: return zlib.decompress(b)
            except zlib.error: return zlib.decompress(b, -zlib.MAX_WBITS)
    except (OSError, zlib.error, EOFError): pass
    return b

def feed(url):
    """url 'sitemap:https://sitio/' = feed sintetizado con contenido real del sitio (sin feed propio)."""
    if url.startswith('sitemap:'):
        b = sintetizar_feed(url[8:])
        return Resp(200 if b else 404, url, body=b or b''), (feedparser.parse(b) if b else feedparser.FeedParserDict(entries=[], feed={}))
    r = fetch(url)
    return r, (feedparser.parse(r.body) if r.body else feedparser.FeedParserDict(entries=[], feed={}))

# ---------------------------------------------------------------- texto y puntuación
norm = lambda s: ' ' + re.sub(r'[^a-z0-9\-]+', ' ', (s or '').lower()) + ' '
def texto(html_bytes_or_str):
    s = html_bytes_or_str.decode('utf-8', 'ignore') if isinstance(html_bytes_or_str, bytes) else html_bytes_or_str
    s = re.sub(r'(?is)<(script|style|noscript)\b.*?</\1>', ' ', s)
    return re.sub(r'\s+', ' ', H.unescape(re.sub(r'<[^>]+>', ' ', s))).strip()
def cuerpo(e): return e.content[0].value if e.get('content') else e.get('summary', '')
def contiene(ntexto, termino): return f' {termino} ' in ntexto

def punteggio(t, s):
    t, s, out, solo_deb = norm(t), norm(s[:4000]), {}, {}
    for k in FUERTES:
        vf = sum(1.5 if contiene(t, x) else 1.0 if contiene(s, x) else 0 for x in FUERTES[k])
        vd = sum(0.6 if contiene(t, x) else 0.4 if contiene(s, x) else 0 for x in C.RELACIONADOS.get(k, []))
        if vf + vd: out[k] = round(vf + vd, 2); solo_deb[k] = vf == 0
    return out, solo_deb

def es_rumore(t, slug=None):
    n = norm(t)
    return any(contiene(n, x) for x in C.RUMORE + C.RUMORE_EXTRA.get(slug, []))

def dias_desde_ultima(d):
    fs = [e.get('published_parsed') or e.get('updated_parsed') for e in d.entries[:10]]
    u = max((f for f in fs if f), default=None)
    return max(0, int((time.time() - calendar.timegm(u)) // 86400)) if u else -1   # UTC; fecha futura = 0 días
def muerto(d):
    x = dias_desde_ultima(d); return not (0 <= x <= C.MAX_DIAS_SIN_PUBLICAR)

def utiles(d, cat):
    """-> (útiles con ≥1 término fuerte, media, coincide_categoria, correlati (solo débiles), esplorazione)"""
    ok, coincide, solo, expl = [], 0, 0, 0
    for e in d.entries[:10]:
        t, b = e.get('title', ''), texto(cuerpo(e))
        if es_rumore(t, cat): continue
        p, sd = punteggio(t, b)
        top = max(p, key=p.get) if p else None
        if p and p[top] >= C.UMBRAL and not sd[top]:
            ok.append(p[top]); coincide += top == cat
        elif p and p[top] >= C.UMBRAL:
            solo += 1                                   # 'correlati': útil como contexto, no cuenta para aceptar la fuente
        elif len(b) >= C.ESPLORAZIONE_MIN_CHARS or any(contiene(norm(t + ' ' + b[:500]), x) for x in C.ESPLORAZIONE_SEGNALI):
            expl += 1
    return len(ok), round(sum(ok) / len(ok), 2) if ok else 0, coincide, solo, expl

# ---------------------------------------------------------------- dominio
def host(u): return (urllib.parse.urlparse(u).hostname or '').lower().removeprefix('www.')
def base(h):
    for pl in C.PLATAFORMAS:
        if h == pl or h.endswith('.' + pl): return h          # cada Substack/Blogspot es una fuente distinta
    p = h.split('.')
    return '.'.join(p[-3:]) if len(p) >= 3 and len(p[-1]) == 2 and p[-2] in ('co', 'ac', 'gov', 'org', 'com', 'net') else '.'.join(p[-2:])
def mismo_sitio(a, b): return bool(a and b) and base(host(a)) == base(host(b))
def reparacion_segura(nuevo, url_sito, url_feed):
    h = host(nuevo)
    return mismo_sitio(nuevo, url_sito) or mismo_sitio(nuevo, url_feed) or h in C.HOSTS_FEED_ADMITIDOS

# ---------------------------------------------------------------- autodescubrimiento
def _attrs(tag): return {k.lower(): v for k, v in re.findall(r'([a-zA-Z\-:]+)\s*=\s*["\']([^"\']*)["\']', tag)}
def descubrir(url_sito, r=None):
    """-> (lista de candidatos de feed ordenada, Resp de la página)"""
    r = r or fetch(url_sito)
    html = r.body.decode('utf-8', 'ignore') if r.body else ''
    out = []
    for tag in re.findall(r'(?i)<link\b[^>]*>', html):
        a = _attrs(tag)
        if 'alternate' in a.get('rel', '').lower() and re.search(r'(?i)(rss|atom)\+xml|feed\+json', a.get('type', '')) and a.get('href'):
            out.append(urllib.parse.urljoin(r.url, H.unescape(a['href'])))
    if r.body or r.status:   # caso real (Visualising Data): el feed declarado falla pero /feed/atom/ funciona -> probar sufijos DESPUÉS de los declarados
        u = urllib.parse.urlparse(r.url); raiz = f'{u.scheme}://{u.netloc}'; limpio = r.url.split('?')[0].rstrip('/')
        for s in C.SUFIJOS_FEED:
            out += [limpio + s] if s.startswith('?') else [limpio + s, raiz + s] if limpio != raiz else [raiz + s]
    NO_FEED = re.compile(r'(?i)/comments/feed|/comments/?$|wp-json|oembed|[?&]replytocom=')
    return [u for u in dict.fromkeys(out) if not NO_FEED.search(u)], r      # feeds de comentarios no son la fuente

def canonico(html, url):
    """URL canónica declarada por la propia página (dominio propio de un Substack, migraciones)."""
    h = html if isinstance(html, str) else html.decode('utf-8', 'ignore')
    for tag in re.findall(r'(?i)<(?:link|meta)\b[^>]*>', h[:200000]):
        a = _attrs(tag)
        if a.get('rel', '').lower() == 'canonical' and a.get('href'): return urllib.parse.urljoin(url, a['href'])
        if a.get('property', '').lower() == 'og:url' and a.get('content'): return urllib.parse.urljoin(url, a['content'])
    return ''

# ---------------------------------------------------------------- licencia
LIC_ENLACE = re.compile(r'(?i)licen[cs]e|copyright|terms|legal|re-?use|conditions|condiciones|note-legali|mentions')
def paginas_licencia(html, url, maximo=3):
    """Enlaces del pie (mismo sitio) cuyo texto o destino sugiere licencia/términos: allí se declara a menudo (p.ej. gov.uk)."""
    h = html if isinstance(html, str) else html.decode('utf-8', 'ignore')
    foot = ' '.join(re.findall(r'(?is)<footer\b.*?</footer>', h)) or h[-max(1500, int(len(h) * 0.15)):]
    out = []
    for href, txt in re.findall(r'(?is)<a\b[^>]*href=["\']([^"\'#]+)["\'][^>]*>(.*?)</a>', foot):
        u = urllib.parse.urljoin(url, H.unescape(href))
        if mismo_sitio(u, url) and (LIC_ENLACE.search(texto(txt)) or LIC_ENLACE.search(urllib.parse.urlparse(u).path)):
            out.append(u)
    return list(dict.fromkeys(out))[:maximo]

CTX_NEG = re.compile(r'(?i)illustrat|image|photo|visuel|visual|icon|font|cr[ée]dit|picture|logo|foto|immagin|imagen')
CTX_POS = re.compile(r'(?i)content|contenu|contenut|contenido|material|this site|website|site web|sito|contribution|text|publica|articles|research')
def _en_contexto(h, i, j, exigir_pos):
    """Declaración de licencia del SITIO: sin palabras de crédito de imagen cerca; en páginas dedicadas, además con 'contenido/sitio/...' cerca."""
    t = texto(h[max(0, i - 400): j + 200]); pos_rel = len(texto(h[max(0, i - 400): i]))
    ventana = t[max(0, pos_rel - 160): pos_rel + 120]
    return not CTX_NEG.search(ventana) and (not exigir_pos or bool(CTX_POS.search(ventana)))
def _buscar_cc(h, exigir_pos):
    for m in re.finditer(r'(?i)creativecommons\.org/(licenses|publicdomain)/([a-z\-]+)/([\d.]+)', h):
        if _en_contexto(h, m.start(), m.end(), exigir_pos):
            return 'CC0' if m.group(2) == 'zero' else f'CC {m.group(2).upper()} {m.group(3)}'
    for m in re.finditer(r'(?i)open government licen[cs]e', h):
        if _en_contexto(h, m.start(), m.end(), exigir_pos): return 'OGL'
    return None

def licencia_pagina(html, url, amplia=False):
    """Página DEDICADA (términos/licencia): la declaración debe hablar del contenido y no ser un crédito de imagen."""
    h = html if isinstance(html, str) else html.decode('utf-8', 'ignore')
    x = _buscar_cc(h, exigir_pos=True)
    if x: return (x, url)
    if amplia and re.search(r'(?i)(©|&copy;|copyright\s+(©\s*)?\d{4}|all rights reserved)', h): return ('Copyright (todos los derechos reservados)', url)
    return None

def licencia(html, url, amplia=False):
    """rel=license vale en cualquier parte (declaración explícita). CC/OGL/copyright solo en el <footer>
    (o, sin footer, en el último 15% / 1500 caracteres): una foto CC o un post SOBRE la OGL no licencian el sitio."""
    h = html if isinstance(html, str) else html.decode('utf-8', 'ignore')
    for tag in re.findall(r'(?i)<(?:a|link)\b[^>]*\brel=["\'][^"\']*\blicense\b[^"\']*["\'][^>]*>', h):
        href = _attrs(tag).get('href', '')
        m = re.search(r'(?i)creativecommons\.org/(licenses|publicdomain)/([a-z\-]+)/([\d.]+)', href)
        if m: return ('CC0' if m.group(2) == 'zero' else f'CC {m.group(2).upper()} {m.group(3)}', url)
        if href: return ('rel=license', urllib.parse.urljoin(url, href))
    foot = ' '.join(re.findall(r'(?is)<footer\b.*?</footer>', h)) or h[-max(1500, int(len(h) * 0.15)):]
    x = _buscar_cc(foot, exigir_pos=False)
    if x: return (x, url)
    if amplia and re.search(r'(?i)(©|&copy;|copyright\s+(©\s*)?\d{4})', foot): return ('Copyright (todos los derechos reservados)', url)
    return None

# ---------------------------------------------------------------- muro de pago
def muro(links):
    """-> (n con muro, n muestreados, detalle, n fallos transitorios). Si el sitio bloquea, usa la copia archivada."""
    n, det, total, trans = 0, [], 0, 0
    for u in links[:3]:
        txt, via = texto_articulo(u)
        if not txt:
            trans += via in ('URLError', 'timeout', 'None') or via.startswith(('HTTP 5', 'TimeoutError')); det.append(f'{host(u)}: {via}'); continue
        if via == 'archivo': det.append(f'{host(u)}: texto desde archivo')
        total += 1; low = txt.lower()
        hit = next((m for m in C.MARCAS_PAYWALL if m in low), None)
        if hit: n += 1; det.append(f'{host(u)}: "{hit}"')
    return n, total, '; '.join(det), trans

# ================================================================ CURACIÓN PROFUNDA (autónoma)
import difflib, json as _json
def similitud(a, b):
    n = lambda s: re.sub(r'[^a-z0-9 ]+', ' ', (s or '').lower()).split()
    return difflib.SequenceMatcher(None, ' '.join(n(a)), ' '.join(n(b))).ratio()

def _json_de(r):
    try: return _json.loads(r.body) if r.body else {}
    except ValueError: return {}

def wayback_ultimo(url):
    """Última copia archivada (Internet Archive) -> (url_copia_cruda, Resp) o (None, None). Legal y pública."""
    js = _json_de(fetch('https://archive.org/wayback/available?url=' + urllib.parse.quote(url, safe='')))
    snap = (js.get('archived_snapshots') or {}).get('closest') or {}
    if not snap.get('available') or not snap.get('url'): return None, None
    cruda = re.sub(r'/web/(\d+)/', r'/web/\1id_/', snap['url'], count=1)     # id_ = contenido original sin barra del archivo
    return cruda, fetch(cruda)

def sitio_movido(url_sito):
    """¿A dónde se fue el sitio? canonical/og:url actual, o el de su última copia archivada."""
    r = fetch(url_sito)
    if r.body:
        c = canonico(r.body, r.url)
        if c and not mismo_sitio(c, url_sito): return c, 'canonical actual'
        if r.url and not mismo_sitio(r.url, url_sito): return r.url, 'redirección del sitio'
    cruda, ra = wayback_ultimo(url_sito)
    if ra and ra.body:
        c = canonico(ra.body, url_sito)
        if c and not mismo_sitio(c, url_sito): return c, 'canonical en copia archivada'
    return None, None

def feedly(consulta, n=8):
    """Directorio de feeds (sin clave). -> [(url_feed, titulo, website)]"""
    js = _json_de(fetch(f'https://cloud.feedly.com/v3/search/feeds?query={urllib.parse.quote(consulta)}&count={n}'))
    out = []
    for x in js.get('results', []):
        fid = x.get('feedId', '')
        if fid.startswith('feed/'): out.append((fid[5:], x.get('title', ''), x.get('website', '')))
    return out

def sitemap_urls(url_sito, maximo=40):
    """URLs recientes del sitio vía robots.txt/sitemaps -> [(loc, lastmod)] ordenadas por fecha desc."""
    u = urllib.parse.urlparse(url_sito); raiz = f'{u.scheme}://{u.netloc}'
    mapas = re.findall(r'(?im)^\s*sitemap:\s*(\S+)', (fetch(raiz + '/robots.txt').body or b'').decode('utf-8', 'ignore'))
    mapas += [raiz + p for p in ('/sitemap.xml', '/sitemap_index.xml', '/wp-sitemap.xml', '/post-sitemap.xml')]
    vistos, urls = set(), []
    cola = list(dict.fromkeys(mapas))
    while cola and len(vistos) < 8:
        m = cola.pop(0)
        if m in vistos: continue
        vistos.add(m); b = (fetch(m).body or b'').decode('utf-8', 'ignore')
        hijos = re.findall(r'(?is)<sitemap>.*?<loc>\s*([^<\s]+)\s*</loc>', b)
        # casos reales (HPN, ReliefWeb, Ada): los índices mezclan contenidos y taxonomías -> solo sub-mapas de CONTENIDO
        TAX = r'(?i)tag|categor|author|country|countr|event|organi[sz]ation|type-sitemap|page-sitemap|elementor|attachment|product|job|training'
        CONT = r'(?i)post|news|blog|article|publica|report|update|insight|analysis|feature|evidence'
        hijos = [h for h in hijos if not re.search(TAX, h.split('/')[-1])]
        cont = [h for h in hijos if re.search(CONT, h.split('/')[-1])]
        cola = (cont or hijos)[:6] + cola
        for loc, lm in re.findall(r'(?is)<url>\s*<loc>\s*([^<\s]+)\s*</loc>(?:.*?<lastmod>\s*([^<\s]+)\s*</lastmod>)?', b):
            urls.append((H.unescape(loc), lm or ''))
    urls = [x for x in dict.fromkeys(urls) if mismo_sitio(x[0], url_sito)]
    def clave(x):   # sin <lastmod> (caso real: Use The Index Luke) -> fecha deducida de la URL (/2024-12/, /2024/12/)
        m = re.search(r'/(20\d\d)[-/](\d\d)(?:[-/](\d\d))?', x[0])
        return x[1] or (f'{m.group(1)}-{m.group(2)}-{m.group(3) or "01"}' if m else '')
    return sorted(urls, key=clave, reverse=True)[:maximo]

def _meta(html, nombre):
    for tag in re.findall(r'(?i)<meta\b[^>]*>', html[:150000]):
        a = _attrs(tag)
        if nombre in (a.get('property', '').lower(), a.get('name', '').lower()): return H.unescape(a.get('content', ''))
    return ''

def sintetizar_feed(url_sito, n=10):
    """Feed RSS construido con contenido REAL del sitio (sitemap + páginas). -> bytes o None."""
    items, bajadas = [], 0
    for loc, lm in sitemap_urls(url_sito):
        if len(items) >= n or bajadas >= n + 6: break      # tope de descargas por síntesis
        if re.search(r'(?i)/(tag|category|author|page|feed|wp-content|search)/|\.(jpg|png|pdf|xml)$', loc): continue
        r = fetch(loc); bajadas += 1
        if not r.body: continue
        h = r.body.decode('utf-8', 'ignore')
        titulo = _meta(h, 'og:title') or texto((re.search(r'(?is)<title>(.*?)</title>', h) or [None, ''])[1])
        ruta = [p for p in urllib.parse.urlparse(loc).path.split('/') if p]
        if not ruta: continue                                                          # portada
        # página de ARTÍCULO = un bloque de contenido dominante (casos reales: Ada 15k de 15.5k; HPN 16.8k de 17.4k).
        # listados (ReliefWeb /updates: bloques de ~400) y fichas cortas (mapas: 726) no lo son.
        bloques = [texto(a) for a in re.findall(r'(?is)<article\b.*?</article>', h)] or [texto((re.search(r'(?is)<main\b.*?</main>', h) or [''])[0])]
        mayor = max(bloques, key=len) if bloques else ''
        if len(mayor) < 1500 or len(mayor) < 0.6 * sum(map(len, bloques)): continue
        m_url = re.search(r'/(20\d\d)[-/](\d\d)(?:[-/](\d\d))?', loc)
        fecha = (_meta(h, 'article:published_time') or (re.findall(r'"datePublished"\s*:\s*"([^"]+)"', h) or [''])[0]
                 or (f'{m_url.group(1)}-{m_url.group(2)}-{m_url.group(3) or "01"}' if m_url else '') or lm)   # lastmod: último recurso
        if not fecha: continue
        txt = mayor[:4000]
        if titulo and len(txt) > 200: items.append((titulo, loc, fecha, txt))
    if not items: return None
    esc = lambda s: H.escape(s or '', quote=False)
    xml = ''.join(f'<item><title>{esc(t)}</title><link>{esc(l)}</link><pubDate>{esc(f)}</pubDate><description>{esc(d)}</description></item>'
                  for t, l, f, d in items)
    return f'<?xml version="1.0"?><rss version="2.0"><channel><title>sintetizado</title><link>{esc(url_sito)}</link>{xml}</channel></rss>'.encode()

def texto_articulo(url):
    """Texto de un artículo; si el sitio lo bloquea (403/202/5xx) prueba la copia del Internet Archive."""
    r = fetch(url)
    if r.body: return texto(r.body), 'directo'
    if r.status in (401, 403, 202, 429) or r.transitorio:
        cruda, ra = wayback_ultimo(url)
        if ra and ra.body: return texto(ra.body), 'archivo'
    return '', r.error or str(r.status)
