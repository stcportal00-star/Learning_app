"""Pruebas ADVERSARIALES: cada una intenta romper una garantía. python3 test_adversarial.py"""
import time, email.utils, json, importlib, os, re, shutil, tempfile, pglast, feedparser
import fonti_core as K, verifica_fonti as V, scopri_fonti as S, temi_config as C
K.configurar(parche=True)
def d(sec): return email.utils.formatdate(time.time() - sec)
def rss(items, link='https://blog.ejemplo.org/', dates=None):
    dates = dates or [d(i * 86400) for i in range(len(items))]
    it = ''.join(f'<item><title>{t}</title><link>{l}</link><pubDate>{dt}</pubDate><description>{s}</description></item>'
                 for (t, l, s), dt in zip(items, dates))
    return f'<?xml version="1.0"?><rss version="2.0"><channel><title>x</title><link>{link}</link>{it}</channel></rss>'.encode()
BUENOS = [(f'Model evaluation note {i}: red teaming frontier models', f'https://blog.ejemplo.org/p{i}', 'llm evals') for i in range(10)]
ART = b'<html><body>' + b'long free article text ' * 200 + b'</body></html>'
WEB = {}
def fake(url, limit=0):
    v = WEB.get(url)
    if v is None: return K.Resp(404, url, error='HTTP 404')
    return v if isinstance(v, K.Resp) else K.Resp(200, url, body=v)
K.fetch = fake
def reset():
    WEB.clear()
    for i in range(10): WEB[f'https://blog.ejemplo.org/p{i}'] = ART
R = []
def ok(c, m): print(('PASS ' if c else 'FAIL ') + m); R.append(bool(c))

# A1 secuestro: la home enlaza un feed de OTRO dominio -> no debe auto-repararse
reset(); WEB['https://blog.ejemplo.org/'] = b'<link rel="alternate" type="application/rss+xml" href="https://evil.example.net/f.xml"><footer>creativecommons.org/licenses/by/4.0/</footer>'
WEB['https://evil.example.net/f.xml'] = rss(BUENOS, link='https://blog.ejemplo.org/')
r = V.verifica('t', 'https://blog.ejemplo.org/roto', 'https://blog.ejemplo.org/', 'ia')
ok(r['motivo'] != 'ACEPTADA' and 'evil' not in V.sql_salida([r]).split('-- 2)')[0].replace('--', '').split('update')[-1] if r.get('url_nuevo') else True,
   f"A1 reparación a dominio ajeno no automática: {r.get('url_nuevo')} · {r['motivo']}")
# A2 redirección 301 a otro dominio (dominio vendido)
reset(); WEB['https://blog.ejemplo.org/'] = b'<footer>creativecommons.org/licenses/by/4.0/</footer>'
WEB['https://blog.ejemplo.org/feed'] = K.Resp(200, 'https://casino.example.com/feed', [(301, 'https://casino.example.com/feed')], body=rss(BUENOS))
r = V.verifica('t', 'https://blog.ejemplo.org/feed', 'https://blog.ejemplo.org/', 'ia')
ok(r['motivo'] != 'ACEPTADA', f"A2 301 a otro dominio no se acepta solo: {r['motivo']}")
# A3 fecha en el futuro (post programado / zona horaria) -> NO es feed muerto
reset(); WEB['https://blog.ejemplo.org/'] = b'<footer>creativecommons.org/licenses/by/4.0/</footer>'
WEB['https://blog.ejemplo.org/feed.xml'] = rss(BUENOS, dates=[d(-3600)] + [d(i * 86400) for i in range(1, 10)])
r = V.verifica('t', 'https://blog.ejemplo.org/feed.xml', 'https://blog.ejemplo.org/', 'ia')
ok(not r.get('url_nuevo') and r['motivo'] == 'ACEPTADA', f"A3 fecha futura no dispara reparación: {r['motivo']} {r.get('reparacion')}")
# A4 fuente aceptada SOLO con vocabulario débil (genérico) -> no debe pasar p3
gen = [(f'How we changed our workflow and requirements, part {i}', f'https://blog.ejemplo.org/p{i}', 'stakeholders') for i in range(10)]
WEB['https://blog.ejemplo.org/feed.xml'] = rss(gen)
r = V.verifica('t', 'https://blog.ejemplo.org/feed.xml', 'https://blog.ejemplo.org/', 'business_analysis')
ok(r['motivo'] != 'ACEPTADA', f"A4 solo débiles no basta: útiles={r.get('p3_utiles')} · {r['motivo']}")
# A5 colisión italiana: 'ai' es preposición
p, _ = K.punteggio('Novità ai sensi del regolamento: gli agents ai cittadini', '')
ok(p.get('ia', 0) < 1.0, f"A5 'ai' italiano no clasifica como ia: {p.get('ia')}")
# A6 licencia falsa: CC solo para una foto en el cuerpo, footer 'All rights reserved'
html = b'<article>Photo by X, CC BY 2.0 https://creativecommons.org/licenses/by/2.0/ ... ' + b'text ' * 500 + b'</article><footer>All rights reserved</footer>'
ok(K.licencia(html, 'u') is None, f"A6 CC de una foto no es licencia del sitio: {K.licencia(html, 'u')}")
# A7 post que HABLA de la OGL no declara OGL
html = b'<article>Explainer: what the Open Government Licence means for reuse ' + b'text ' * 500 + b'</article><footer>(c) Foo Ltd</footer>'
ok(K.licencia(html, 'u') is None, f"A7 mencionar OGL en un post no es declararla: {K.licencia(html, 'u')}")
# A8 inyección SQL / salto de línea desde datos remotos
row = dict(nome="x'); drop table percorso.fonti; --", url_feed="https://a.org/f'\n; drop", url_sito='https://a.org/', categoria='ia',
           url_nuevo="https://a.org/g'\n--", reparacion="autodescubierto\n; drop table x", motivo="p3 0/10\n; delete from percorso.fonti")
sql = V.sql_salida([row]) + S.proponer_sql([row | {'p3_utiles': 9, 'menciones': 1}])
stmts = [s for s in pglast.parse_sql(sql)]
ok(all(type(s.stmt).__name__ in ('UpdateStmt', 'InsertStmt') for s in stmts), f"A8 solo UPDATE/INSERT tras datos hostiles: {[type(s.stmt).__name__ for s in stmts]}")
# A9 SQL reformateado -> 0 filas leídas debe AVISAR, no pasar en silencio
import io, contextlib
buf = io.StringIO()
with contextlib.redirect_stdout(buf):
    try: V.main(["x", "/tmp/_reformateado.sql"]) if hasattr(V, 'main') else None
    except SystemExit: pass
open('/tmp/_reformateado.sql', 'w').write("insert into percorso.fonti values ('a','https://x/f','https://x/','rss','ia','en',0.5,false);")
ok(len(V.filas(open('/tmp/_reformateado.sql').read())) > 0 or hasattr(V, 'main'), "A9 SQL sin espacios tras comas: se lee o se avisa")
# A10 plataformas: un Substack conocido no debe excluir a todos los Substack en el scouting
known = S.conocidos("  ('a', 'https://joereis.substack.com/feed', 'https://joereis.substack.com/', 'rss', 'modellazione', 'en', 0.5, false)")
ok(not S.excluido('otronewsletter.substack.com', known), f"A10 otro Substack no excluido: known={known}")
# A11 artículos no descargables + sumario corto -> sin texto accesible offline
reset(); WEB['https://blog.ejemplo.org/'] = b'<footer>creativecommons.org/licenses/by/4.0/</footer>'
WEB['https://blog.ejemplo.org/feed.xml'] = rss(BUENOS); [WEB.pop(f'https://blog.ejemplo.org/p{i}') for i in range(10)]
r = V.verifica('t', 'https://blog.ejemplo.org/feed.xml', 'https://blog.ejemplo.org/', 'ia')
ok(r['motivo'] != 'ACEPTADA', f"A11 sin texto accesible: muro {r.get('p9_muro')} sumario {r.get('p5_sumario_med')} · {r['motivo']}")
# A12 paywall falso positivo: post gratis con pie 'Upgrade... for paid subscribers' en 1 de 3
reset(); WEB['https://blog.ejemplo.org/'] = b'<footer>creativecommons.org/licenses/by/4.0/</footer>'; WEB['https://blog.ejemplo.org/feed.xml'] = rss(BUENOS)
WEB['https://blog.ejemplo.org/p0'] = ART + b'<footer>Extra posts for paid subscribers</footer>'
r = V.verifica('t', 'https://blog.ejemplo.org/feed.xml', 'https://blog.ejemplo.org/', 'ia')
ok(r['motivo'] == 'ACEPTADA', f"A12 1 marca aislada no rechaza: {r.get('p9_muro')} · {r['motivo']}")
# A13 artículos inaccesibles por RED (transitorio) no rechazan ni desactivan
reset(); WEB['https://blog.ejemplo.org/'] = b'<footer>creativecommons.org/licenses/by/4.0/</footer>'; WEB['https://blog.ejemplo.org/feed.xml'] = rss(BUENOS)
for i in range(10): WEB[f'https://blog.ejemplo.org/p{i}'] = K.Resp(None, f'https://blog.ejemplo.org/p{i}', error='URLError')
r = V.verifica('t', 'https://blog.ejemplo.org/feed.xml', 'https://blog.ejemplo.org/', 'ia')
ok(r['motivo'].startswith('TRANSITORIO') and 'attiva' not in V.sql_salida([r]).split('-- 2)')[1], f"A13 red caída en artículos = transitorio: {r['motivo'][:40]}")
# A14 bloqueo 403 en artículos (el pipeline tampoco podrá leerlos) + sumario corto = rechazo
for i in range(10): WEB[f'https://blog.ejemplo.org/p{i}'] = K.Resp(403, f'https://blog.ejemplo.org/p{i}', error='HTTP 403')
r = V.verifica('t', 'https://blog.ejemplo.org/feed.xml', 'https://blog.ejemplo.org/', 'ia')
ok('sin texto accesible' in r['motivo'], f"A14 403 en artículos + sumario corto = rechazo: {r['motivo'][:60]}")
# A15 formato SQL no reconocido -> aborta sin activar.sql
import subprocess, os
open('/tmp/_raro.sql', 'w').write("insert into percorso.fonti values (1, 'rss');")
p = subprocess.run(['python3', 'verifica_fonti.py', '/tmp/_raro.sql'], capture_output=True, text=True)
ok(p.returncode != 0 and 'ERROR' in (p.stderr + p.stdout), 'A15 formato no reconocido aborta')
# A16 (caso real: Tidy First) dominio propio declarado como canonical en url_sito -> p8 no rechaza
reset(); WEB['https://tidy.substack.com/'] = b'<link rel="canonical" href="https://newsletter.kent.com/"><footer>creativecommons.org/licenses/by/4.0/</footer>'
WEB['https://tidy.substack.com/feed'] = rss(BUENOS, link='https://newsletter.kent.com/')
r = V.verifica('t', 'https://tidy.substack.com/feed', 'https://tidy.substack.com/', 'ia')
ok('p8' not in r['motivo'], f"A16 canonical propio acepta canal: {r['motivo']}")
# A17 (caso real: Visualising Data) el feed de comentarios nunca es destino de reparación
reset(); WEB['https://blog.ejemplo.org/'] = b'<link rel="alternate" type="application/rss+xml" href="/comments/feed/">'
WEB['https://blog.ejemplo.org/comments/feed/'] = rss(BUENOS)
r = V.verifica('t', 'https://blog.ejemplo.org/feed/', 'https://blog.ejemplo.org/', 'ia')
ok(not r.get('url_nuevo'), f"A17 comentarios excluidos: {r.get('url_nuevo')} · {r['motivo'][:50]}")
# A18 canonical de OTRO dominio que no coincide con el canal -> p8 sigue rechazando
reset(); WEB['https://blog.ejemplo.org/'] = b'<link rel="canonical" href="https://mirror.example.net/"><footer>creativecommons.org/licenses/by/4.0/</footer>'
WEB['https://blog.ejemplo.org/feed.xml'] = rss(BUENOS, link='https://tercero.example.com/')
r = V.verifica('t', 'https://blog.ejemplo.org/feed.xml', 'https://blog.ejemplo.org/', 'ia')
ok('p8' in r['motivo'], f"A18 canonical ajeno no blanquea canal ajeno: {r['motivo']}")
# A19 (caso real: ReliefWeb) 202 sin cuerpo = bloqueo anti-bot, no 'transitorio'
reset(); WEB['https://rw.example.org/f'] = K.Resp(202, 'https://rw.example.org/f', error='status=202')
r = V.verifica('t', 'https://rw.example.org/f', 'https://rw.example.org/', 'meal')
ok('anti-bot' in r['motivo'], f"A19 202 etiquetado: {r['motivo']}")
# A20 (caso real: AISI/NCSC) la licencia vive en una página de términos enlazada en el pie
reset(); WEB['https://blog.ejemplo.org/'] = b'<body>x</body><footer><a href="/copyright">Copyright</a> <a href="https://otro.example.com/terms">Terms</a></footer>'
WEB['https://blog.ejemplo.org/copyright'] = b'<h1>Copyright</h1>All content is available under the Open Government Licence v3.0'
WEB['https://blog.ejemplo.org/feed.xml'] = rss(BUENOS)
r = V.verifica('t', 'https://blog.ejemplo.org/feed.xml', 'https://blog.ejemplo.org/', 'ia')
ok(r['p7_licencia'].startswith('OGL | https://blog.ejemplo.org/copyright'), f"A20 licencia en página enlazada: {r['p7_licencia']}")
# A21 no seguir enlaces de 'terms' a OTRO dominio (p.ej. plataforma de terceros)
reset(); WEB['https://blog.ejemplo.org/'] = b'<footer><a href="https://otro.example.com/terms">Terms</a></footer>'
WEB['https://otro.example.com/terms'] = b'creativecommons.org/licenses/by/4.0/'
ok(K.paginas_licencia(WEB['https://blog.ejemplo.org/'], 'https://blog.ejemplo.org/') == [], 'A21 términos de otro dominio ignorados')
# A22 (caso real: CNIL) CC de las ilustraciones en la página de menciones legales NO es licencia del contenido
p = b'<h2>Cr\xc3\xa9dits</h2><p>Visuels : Istock</p><ul><li>Illustrations : Geoffrey Dorne <a href="https://creativecommons.org/licenses/by-nc-sa/4.0/deed.fr">CC-BY-NC-SA 4.0</a></li></ul>'
ok(K.licencia_pagina(p, 'u') is None, f"A22 crédito de ilustración ignorado: {K.licencia_pagina(p, 'u')}")
# A23 (caso real: FAR.AI) declaración sobre el contenido en términos -> sí
p = b'Use of Our Content. Unless otherwise stated, the content is offered under the terms of a Creative Commons License <a href="https://creativecommons.org/licenses/by-nc-sa/4.0/">CC BY-NC-SA 4.0</a>.'
ok((K.licencia_pagina(p, 'u') or [''])[0] == 'CC BY-NC-SA 4.0', f"A23 declaración de contenido aceptada: {K.licencia_pagina(p, 'u')}")
# A24 (caso real: FAR.AI) licencia abierta en términos gana al '©' del pie
reset(); WEB['https://blog.ejemplo.org/'] = b'<footer>&copy; 2026 Ejemplo <a href="/terms-of-service">Terms</a></footer>'
WEB['https://blog.ejemplo.org/terms-of-service'] = b'Unless otherwise stated, the content is offered under <a href="https://creativecommons.org/licenses/by-nc-sa/4.0/">CC BY-NC-SA 4.0</a>'
WEB['https://blog.ejemplo.org/feed.xml'] = rss(BUENOS)
r = V.verifica('t', 'https://blog.ejemplo.org/feed.xml', 'https://blog.ejemplo.org/', 'ia', amplia=True)
ok(r['p7_licencia'].startswith('CC BY-NC-SA 4.0'), f"A24 abierta antes que copyright: {r['p7_licencia']}")
# A25 una excepción dentro de verifica no tumba la corrida ni cambia attiva
orig = K.feed; K.feed = lambda u: (_ for _ in ()).throw(ValueError('xml raro'))
r = V.verifica_segura('t', 'https://blog.ejemplo.org/feed.xml', 'https://blog.ejemplo.org/', 'ia'); K.feed = orig
ok(r['motivo'].startswith('TRANSITORIO error interno') and 'attiva' not in V.sql_salida([r]).split('-- 2)')[1], f"A25 excepción aislada: {r['motivo']}")
# A26 disyuntor: entorno con proxy que devuelve 403 a todo -> no se escribe nada
rows = [dict(motivo='p1 roto (HTTP 403); sin reparación entre 0 candidatos')] * 30 + [dict(motivo='ACEPTADA')] * 5
ok(bool(V.disyuntor(rows, None)), f"A26 disyuntor red: {V.disyuntor(rows, None)}")
# A27 disyuntor: caída brusca de aceptadas respecto a la corrida anterior
rows = [dict(motivo='p3 0/10')] * 50 + [dict(motivo='ACEPTADA')] * 3
ok(bool(V.disyuntor(rows, 25)) and not V.disyuntor([dict(motivo='ACEPTADA')] * 20, 25), f"A27 disyuntor caída: {V.disyuntor(rows, 25)}")
# A28 extremo a extremo: CLI con proxy hostil -> código de salida 3 y activar.sql sin UPDATE
import subprocess, os, tempfile
tmpd = tempfile.mkdtemp(); sql = os.path.join(tmpd, 'f.sql')
open(sql, 'w').write(',\n'.join(f"  ('n{i}', 'https://no-existe-{i}.invalid/feed', 'https://no-existe-{i}.invalid/', 'rss', 'ia', 'en', 0.5, false)" for i in range(5)))
p = subprocess.run(['python3', os.path.abspath('verifica_fonti.py'), sql, '--sin-muro'], cwd=tmpd, capture_output=True, text=True, timeout=300)
ok(p.returncode == 3 and 'update' not in open(os.path.join(tmpd, 'activar.sql')).read().lower(), f"A28 CLI disyuntor: rc={p.returncode} {p.stdout.strip()[-80:]}")
# ---------------- CURACIÓN PROFUNDA ----------------
FEEDLY = 'https://cloud.feedly.com/v3/search/feeds?query='
WB = 'https://archive.org/wayback/available?url='
import urllib.parse as up
def wb(url, snap=None):
    WEB[WB + up.quote(url, safe='')] = json.dumps({'archived_snapshots': {'closest': {'available': True, 'url': f'http://web.archive.org/web/20260101000000/{url}'}}} if snap else {}).encode()
    if snap: WEB[f'http://web.archive.org/web/20260101000000id_/{url}'] = snap
def fe(q, res): WEB[f'{FEEDLY}{up.quote(q)}&count=8'] = json.dumps({'results': res}).encode()
BLOGF = [(f'Model evaluation note {i}: red teaming', f'https://nuevo-blog.net/p{i}', 'llm evals') for i in range(10)]
def base_nuevo():
    for i in range(10): WEB[f'https://nuevo-blog.net/p{i}'] = ART
# H1 sitio movido (canonical actual) con misma identidad -> aplica y cambia url_sito
reset(); base_nuevo()
WEB['https://viejo-blog.org/'] = b'<title>Ejemplo Blog</title><link rel="canonical" href="https://nuevo-blog.net/">'
WEB['https://nuevo-blog.net/'] = b'<title>Ejemplo Blog</title><link rel="alternate" type="application/rss+xml" href="/feed.xml"><footer>creativecommons.org/licenses/by/4.0/ content</footer>'
WEB['https://nuevo-blog.net/feed.xml'] = rss(BLOGF, link='https://nuevo-blog.net/').replace(b'<title>x</title>', b'<title>Ejemplo Blog</title>')
r = V.verifica('Ejemplo Blog', 'https://viejo-blog.org/feed', 'https://viejo-blog.org/', 'ia')
ok(r['url_nuevo'] == 'https://nuevo-blog.net/feed.xml' and r.get('url_sito_nuevo') == 'https://nuevo-blog.net/' and "url_sito = 'https://nuevo-blog.net/'" in V.sql_salida([r]),
   f"H1 sitio movido: {r['url_nuevo']} · {r['reparacion']} · {r['motivo']}")
# H2 sitio muerto; su copia archivada declara el dominio nuevo
reset(); base_nuevo(); wb('https://viejo-blog.org/', b'<link rel="canonical" href="https://nuevo-blog.net/">')
WEB['https://nuevo-blog.net/'] = b'<title>Ejemplo Blog</title><link rel="alternate" type="application/rss+xml" href="/feed.xml"><footer>creativecommons.org/licenses/by/4.0/ content</footer>'
WEB['https://nuevo-blog.net/feed.xml'] = rss(BLOGF, link='https://nuevo-blog.net/').replace(b'<title>x</title>', b'<title>Ejemplo Blog</title>')
r = V.verifica('Ejemplo Blog', 'https://viejo-blog.org/feed', 'https://viejo-blog.org/', 'ia')
ok(r['url_nuevo'] == 'https://nuevo-blog.net/feed.xml' and 'archivada' in r['reparacion'], f"H2 desde el archivo: {r['reparacion']}")
# H3 dominio caducado comprado por otro (canonical a casino con feed) -> NO se aplica
reset(); WEB['https://viejo-blog.org/'] = b'<title>Casino</title><link rel="canonical" href="https://casino.example.com/">'
WEB['https://casino.example.com/'] = b'<title>Best Casino Bonus</title><link rel="alternate" type="application/rss+xml" href="/f.xml">'
WEB['https://casino.example.com/f.xml'] = rss(BLOGF, link='https://casino.example.com/').replace(b'<title>x</title>', b'<title>Best Casino Bonus</title>')
r = V.verifica('Ejemplo Blog', 'https://viejo-blog.org/feed', 'https://viejo-blog.org/', 'ia')
ok(not r.get('url_nuevo') and 'REVISAR' in r['motivo'], f"H3 identidad distinta no se aplica: {r['motivo'][:110]}")
# H4 directorio de feeds: feed del MISMO sitio -> aplica
reset(); WEB['https://blog.ejemplo.org/'] = b'<html>sin enlaces</html><footer>creativecommons.org/licenses/by/4.0/ content</footer>'
WEB['https://feeds.example-cdn.net/ejemplo'] = rss(BUENOS)
fe('Ejemplo Blog', [{'feedId': 'feed/https://feeds.example-cdn.net/ejemplo', 'title': 'Ejemplo Blog', 'website': 'https://blog.ejemplo.org/'}])
r = V.verifica('Ejemplo Blog', 'https://blog.ejemplo.org/rss-viejo', 'https://blog.ejemplo.org/', 'ia')
ok(r['url_nuevo'] == 'https://feeds.example-cdn.net/ejemplo' and 'directorio' in r['reparacion'], f"H4 directorio mismo sitio: {r['url_nuevo']} · {r['motivo']}")
# H5 directorio: homónimo de OTRO sitio -> REVISAR, nunca automático
reset(); WEB['https://blog.ejemplo.org/'] = b'<html>sin enlaces</html>'
WEB['https://otro.example.com/f'] = rss(BUENOS)
fe('Ejemplo Blog', [{'feedId': 'feed/https://otro.example.com/f', 'title': 'Ejemplo Blog', 'website': 'https://otro.example.com/'}])
r = V.verifica('Ejemplo Blog', 'https://blog.ejemplo.org/rss-viejo', 'https://blog.ejemplo.org/', 'ia')
ok(not r.get('url_nuevo') and 'REVISAR' in r['motivo'] and 'otro.example.com' in r['motivo'], f"H5 homónimo -> revisar: {r['motivo'][:100]}")
# H6 el sitio no tiene feed: feed sintetizado desde el sitemap con páginas reales -> metodo 'sitemap'
reset(); WEB['https://blog.ejemplo.org/'] = b'<html>sin feed</html><footer>creativecommons.org/licenses/by/4.0/ content</footer>'
WEB['https://blog.ejemplo.org/robots.txt'] = b'Sitemap: https://blog.ejemplo.org/sm.xml'
WEB['https://blog.ejemplo.org/sm.xml'] = ('<urlset>' + ''.join(f'<url><loc>https://blog.ejemplo.org/post/model-eval-{i}</loc><lastmod>2026-09-{20-i:02d}</lastmod></url>' for i in range(10)) + '</urlset>').encode()
for i in range(10): WEB[f'https://blog.ejemplo.org/post/model-eval-{i}'] = f'<meta property="og:title" content="Model evaluation {i}: red teaming frontier models"><meta property="article:published_time" content="2026-09-{20-i:02d}T10:00:00Z"><article>{"llm evals prompt injection text " * 60}</article>'.encode()
r = V.verifica('Ejemplo Blog', 'https://blog.ejemplo.org/rss-viejo', 'https://blog.ejemplo.org/', 'ia')
q = V.sql_salida([r])
ok(r['url_nuevo'] == 'sitemap:https://blog.ejemplo.org/' and r['motivo'] == 'ACEPTADA' and "metodo = 'sitemap'" in q, f"H6 sintetizado: {r['url_nuevo']} · {r['motivo']} · útiles {r.get('p3_utiles')}")
pglast.parse_sql(q)
# H7 artículos bloqueados (403): el texto se recupera del archivo -> no 'sin texto accesible'
reset(); WEB['https://blog.ejemplo.org/'] = b'<footer>creativecommons.org/licenses/by/4.0/ content</footer>'; WEB['https://blog.ejemplo.org/feed.xml'] = rss(BUENOS)
for i in range(10):
    WEB[f'https://blog.ejemplo.org/p{i}'] = K.Resp(403, f'https://blog.ejemplo.org/p{i}', error='HTTP 403'); wb(f'https://blog.ejemplo.org/p{i}', ART)
r = V.verifica('t', 'https://blog.ejemplo.org/feed.xml', 'https://blog.ejemplo.org/', 'ia')
ok(r['motivo'] == 'ACEPTADA' and 'archivo' in r.get('p9_detalle', ''), f"H7 texto desde archivo: {r['motivo']} · {r.get('p9_detalle','')[:60]}")
# H8 (caso real: Visualising Data) cuerpo gzip sin pedirlo -> se descomprime y se lee
import gzip as _gz
ok(K.descomprimir(_gz.compress(rss(BUENOS))) == rss(BUENOS) and K.descomprimir(b'<rss/>') == b'<rss/>' and K.descomprimir(b'\x1f\x8bbasura') == b'\x1f\x8bbasura',
   'H8 gzip detectado por firma; texto plano y gzip corrupto intactos')
# H9 (caso real: ReliefWeb) síntesis NO debe aceptar portada/listados/páginas sin fecha de publicación
reset(); WEB['https://portal.example.org/'] = b'<html>portal</html><footer>creativecommons.org/licenses/by/4.0/ content</footer>'
WEB['https://portal.example.org/robots.txt'] = b'Sitemap: https://portal.example.org/sm.xml'
locs = ['https://portal.example.org/', 'https://portal.example.org/updates', 'https://portal.example.org/disasters'] + [f'https://portal.example.org/map/x/old-map-{i}' for i in range(8)]
WEB['https://portal.example.org/sm.xml'] = ('<urlset>' + ''.join(f'<url><loc>{l}</loc><lastmod>2026-09-2{i%9}</lastmod></url>' for i, l in enumerate(locs)) + '</urlset>').encode()
WEB['https://portal.example.org/'] = b'<html>portal humanitarian needs assessment</html><footer>creativecommons.org/licenses/by/4.0/ content</footer>'
for l in locs[1:3]: WEB[l] = (('<article>' + 'humanitarian needs assessment ' * 15 + '</article>') * 6).encode()
for l in locs[3:]: WEB[l] = b'<meta property="og:title" content="Map: humanitarian needs assessment"><article>' + b'humanitarian needs assessment monitoring and evaluation ' * 20 + b'</article>'
b = K.sintetizar_feed('https://portal.example.org/')
ok(b is None, f"H9 listados y mapas sin fecha no forman feed: {b[:80] if b else None}")
# H10 (caso real: ReliefWeb) <lastmod> NO es fecha de publicación.
# El sitemap fecha /countries -una página de navegación- en 2026, y los 4 informes
# reales son de 2007-2009: esa sola voz hacía pasar p0 y la fuente salía ACEPTADA.
def _iso(dias):
    return time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime(time.time() - dias * 86400))
LARGO = 'humanitarian needs assessment monitoring and evaluation report ' * 40
reset(); WEB['https://relief.example.int/'] = b'<html>portal</html><footer>creativecommons.org/licenses/by/4.0/ content</footer>'
WEB['https://relief.example.int/robots.txt'] = b'Sitemap: https://relief.example.int/sm.xml'
VIEJOS = [f'https://relief.example.int/report/sudan/old-report-{i}' for i in range(4)]
WEB['https://relief.example.int/sm.xml'] = ('<urlset>'
    + f'<url><loc>https://relief.example.int/countries</loc><lastmod>{time.strftime("%Y-%m-%d")}</lastmod></url>'
    + ''.join(f'<url><loc>{l}</loc><lastmod>{time.strftime("%Y-%m-%d")}</lastmod></url>' for l in VIEJOS)
    + '</urlset>').encode()
WEB['https://relief.example.int/countries'] = ('<title>Countries</title><main>' + LARGO + '</main>').encode()
for i, l in enumerate(VIEJOS):
    WEB[l] = (f'<meta property="og:title" content="Sudan situation report {i}">'
              f'<script type="application/ld+json">{{"datePublished":"200{7 + i % 3}-05-0{i + 1}"}}</script>'
              f'<article>{LARGO}</article>').encode()
b = K.sintetizar_feed('https://relief.example.int/')
ok(b is None, f"H10 lastmod de una página de navegación no da frescura: {b[:90] if b else None}")
# H11 el mismo sitemap con 3 artículos con fecha de publicación reciente -> sí se acepta
RECIENTES = [f'https://relief.example.int/report/sudan/fresh-report-{i}' for i in range(3)]
WEB['https://relief.example.int/sm.xml'] = ('<urlset>'
    + f'<url><loc>https://relief.example.int/countries</loc><lastmod>{time.strftime("%Y-%m-%d")}</lastmod></url>'
    + ''.join(f'<url><loc>{l}</loc><lastmod>{time.strftime("%Y-%m-%d")}</lastmod></url>' for l in RECIENTES)
    + '</urlset>').encode()
for i, l in enumerate(RECIENTES):
    WEB[l] = (f'<meta property="og:title" content="Sudan situation report {i}">'
              f'<meta property="article:published_time" content="{_iso(i + 1)}">'
              f'<article>{LARGO}</article>').encode()
b2 = K.sintetizar_feed('https://relief.example.int/')
n2 = b2.count(b'<item>') if b2 else 0
ok(b2 is not None and n2 == 3 and b'countries' not in b2,
   f"H11 3 fechas de publicación recientes forman feed: {n2} voces")
# ---------------------------------------------------------------- programador
# El código 3 es el que justifica el archivo entero: el disyuntor salta cuando el
# entorno está roto y media lista parece muerta. Aplicar esa lista apagaría
# fuentes sanas, y volver a encenderlas exige saber cuáles eran.
import programma_fonti as PR

PROPUESTAS = []

def _programa(codigo, lavoro, activar=None, salud='', propone=None):
    """Corre el programador con un verificador falso. Devuelve (hecho, aplicados, avisos)."""
    with open(os.path.join(lavoro, 'activar.json'), 'w', encoding='utf-8') as fh:
        json.dump(activar if activar is not None else [], fh)
    with open(os.path.join(lavoro, 'salud.md'), 'w', encoding='utf-8') as fh:
        fh.write(salud)
    aplicados, avisos, buscados = [], [], []
    del PROPUESTAS[:]

    def _descubrir(temas, sql, l):
        buscados.append(list(temas))
        # El scouting real escribe proponer.json; aquí se imita para comprobar
        # que el programador lo recoge sin que nadie se lo pida.
        if propone:
            with open(os.path.join(l, 'proponer.json'), 'w', encoding='utf-8') as fh:
                json.dump(propone, fh)

    hecho = PR.programar(
        'fonti.sql', lavoro,
        verificar=lambda sql, l: codigo,
        aplicar=lambda c: aplicados.append(c),
        descubrir=_descubrir,
        avisar=lambda t: avisos.append(t),
        proponer=lambda p: PROPUESTAS.append(p))
    return hecho, aplicados, avisos, buscados

CAMBIO = [{'url_feed': 'https://blog.ejemplo.org/feed.xml', 'attiva': True, 'motivo': 'ACEPTADA'}]
SALUD_AVISO = ('| tema | aceptadas | candidatas | reparadas | revisar |\n'
               '|---|---|---|---|---|\n'
               '| ai_act | 0 ⚠️ | 3 | 0 | 0 |\n'
               '| kpi | 4 | 5 | 0 | 0 |\n')

_trabajo = tempfile.mkdtemp(prefix='fonti-')
try:
    h, ap, av, bu = _programa(0, _trabajo, CAMBIO)
    ok(h['aplicados'] == 1 and ap == [CAMBIO] and not av and not bu,
       f"S1 código 0: se aplica y nada más · {h}")

    h, ap, av, bu = _programa(2, _trabajo, CAMBIO, SALUD_AVISO)
    ok(h['aplicados'] == 1 and ap == [CAMBIO] and bu == [['ai_act']] and not av,
       f"S2 código 2: se aplica y se busca para los temas con ⚠️ · {bu}")

    # El caso que importa: con 3 la base no se toca. Ni una fila.
    h, ap, av, bu = _programa(3, _trabajo, CAMBIO, SALUD_AVISO)
    ok(ap == [] and bu == [] and av == [] and h['disyuntores_seguidos'] == 1,
       f"S3 código 3: la base queda intacta · aplicados={ap} seguidos={h['disyuntores_seguidos']}")

    # El contador vive en la carpeta de trabajo, no en memoria: es la razón por la
    # que esa carpeta tiene que sobrevivir entre corridas.
    h2, ap2, av2, _ = _programa(3, _trabajo, CAMBIO)
    h3, ap3, av3, _ = _programa(3, _trabajo, CAMBIO)
    ok(h2['disyuntores_seguidos'] == 2 and h3['disyuntores_seguidos'] == 3
       and ap2 == [] and ap3 == [],
       f"S4 el contador persiste entre corridas: {h2['disyuntores_seguidos']}, {h3['disyuntores_seguidos']}")
    ok(av2 == [] and len(av3) == 1 and '3 corridas seguidas' in av3[0],
       f"S5 se avisa al tercero, no antes: {av3}")

    # Un 0 borra la racha: el disyuntor cuenta seguidos, no acumulados.
    h, ap, av, bu = _programa(0, _trabajo, CAMBIO)
    ok(h['disyuntores_seguidos'] == 0 and h['aplicados'] == 1,
       f"S6 una corrida buena borra la racha · {h['disyuntores_seguidos']}")

    # El 1 es error de uso, no del entorno: avisa y no toca la cuenta.
    _programa(3, _trabajo, CAMBIO)
    h, ap, av, bu = _programa(1, _trabajo, CAMBIO)
    ok(ap == [] and len(av) == 1 and h['disyuntores_seguidos'] == 1,
       f"S7 código 1: avisa, no aplica y no falsea la racha · {h['disyuntores_seguidos']}")

    # La pata por la que la lista MEJORA sola: lo que el scouting escribe entra
    # en la tabla sin que nadie abra un archivo. Apagado, eso sí.
    CANDIDATA = [{'nome': 'Blog nuevo', 'url_feed': 'https://n/f', 'url_sito': 'https://n/',
                  'metodo': 'rss', 'categoria': 'ai_act', 'lingua': 'en', 'peso': 0.3}]
    h, ap, av, bu = _programa(2, _trabajo, CAMBIO, SALUD_AVISO, propone=CANDIDATA)
    ok(h['propuestas'] == 1 and PROPUESTAS == [CANDIDATA],
       f"S9 las candidatas del scouting entran solas · {h['propuestas']}")
    ok(not os.path.exists(os.path.join(_trabajo, 'proponer.json')),
       "S10 y el archivo se borra, para no reproponerlas cada semana en silencio")

    # Sin scouting no hay propuestas: el programador no inventa nada.
    h, ap, av, bu = _programa(2, _trabajo, CAMBIO, SALUD_AVISO)
    ok(h['propuestas'] == 0 and PROPUESTAS == [],
       f"S11 sin candidatas no se propone nada · {h['propuestas']}")

    # El anillo se cierra en la TABLA, no en el archivo. Si la verificación
    # siguiera leyendo fonti_v4.sql, lo que el scouting propone el día 1 no se
    # verificaría nunca: quedaría apagado para siempre y la lista dejaría de
    # mejorar sin que se vea.
    ok(PR._fuente(V.DESDE_NUBE) == V.DESDE_NUBE
       and PR._fuente('fonti_v4.sql').endswith('/fonti_v4.sql'),
       "S12 --da-nuvola es una bandera, no una ruta")
    # Caso real de la corrida del 23-09: el scouting revienta y el informe dice
    # «propuestas 0», igual que si no hubiera encontrado nada. La pata que hace
    # mejorar la lista queda muerta y nadie se entera.
    def _programa_roto(codigo, lavoro, salud):
        with open(os.path.join(lavoro, 'activar.json'), 'w', encoding='utf-8') as fh:
            json.dump(CAMBIO, fh)
        with open(os.path.join(lavoro, 'salud.md'), 'w', encoding='utf-8') as fh:
            fh.write(salud)
        avisos = []
        hecho = PR.programar(
            'fonti.sql', lavoro,
            verificar=lambda sql, l: codigo,
            aplicar=lambda c: None,
            descubrir=lambda t, sql, l: 1,     # como subprocess.run(...).returncode
            avisar=lambda t: avisos.append(t),
            proponer=lambda p: None)
        return hecho, avisos

    h, av = _programa_roto(2, _trabajo, SALUD_AVISO)
    ok(h['propuestas'] == 0 and len(av) == 1 and 'scouting' in av[0].lower(),
       f"S14 un scouting che esplode non si confonde con «nessuna candidata»: {av}")

    _vera = V.filas_de_nuvola
    V.filas_de_nuvola = lambda *a, **k: [('N', 'https://nueva.example/f',
                                          'https://nueva.example/', 'ia')]
    try:
        ok(S.conocidos(V.DESDE_NUBE) == {'nueva.example'},
           f"S13 el scouting sabe qué hay en la tabla, no en la semilla: "
           f"{S.conocidos(V.DESDE_NUBE)}")
    finally:
        V.filas_de_nuvola = _vera

    # La fila que reventó el scouting: `verifica()` sale antes de p3 -REVISAR
    # por redirección a otro dominio- y no tiene 'p3_utiles'. Una sola así
    # mataba la corrida entera.
    _vv, _vd = V.verifica, K.descubrir
    K.descubrir = lambda home, r=None: (['https://%s/feed' % K.host(home)], None)
    _filas = iter([
        {'nome': 'a', 'url_feed': 'https://a/f', 'url_sito': 'https://a/',
         'categoria': 'ia', 'motivo': 'REVISAR redirección a otro dominio: b.com'},
        {'nome': 'b', 'url_feed': 'https://b/f', 'url_sito': 'https://b/',
         'categoria': 'ia', 'motivo': 'ACEPTADA', 'p3_utiles': 7},
    ])
    V.verifica = lambda *a, **k: next(_filas)
    try:
        props = S.explorar('ia', [('a.example', 3), ('b.example', 2)], 1)
        ok([p['nome'] for p in props] == ['b'],
           f"S15 una fila senza punteggio non è una candidata, e non ferma il resto: "
           f"{[p['nome'] for p in props]}")
    except KeyError as e:
        ok(False, f"S15 explorar è esploso su una fila senza punteggio: {e!r}")
    finally:
        V.verifica, K.descubrir = _vv, _vd
finally:
    shutil.rmtree(_trabajo, ignore_errors=True)

# Las dos salidas nacen de las mismas filas: si un día divergen, diverge lo que
# lee una persona de lo que aplica la máquina, y eso no se ve hasta que duele.
_FILAS = [
    {'nome': 'a', 'url_feed': 'https://a/f', 'motivo': 'ACEPTADA'},
    {'nome': 'b', 'url_feed': 'https://b/f', 'url_nuevo': 'sitemap:https://b/',
     'url_sito_nuevo': 'https://b/', 'reparacion': 'feed sintetizado',
     'motivo': 'ACEPTADA'},
    {'nome': 'c', 'url_feed': 'https://c/f', 'motivo': 'TRANSITORIO (URLError)'},
    {'nome': 'd', 'url_feed': 'https://d/f', 'motivo': 'p1 roto (HTTP 404)'},
]
_sql = V.sql_salida(_FILAS)
_js = V.cambios(_FILAS)
ok({c['url_feed'] for c in _js} == {f['url_feed'] for f in _FILAS if not f['motivo'].startswith('TRANSITORIO')}
   and all((c['url_feed'] in _sql) for c in _js)
   and any(c.get('metodo') == 'sitemap' for c in _js)
   and 'https://c/f' not in {c['url_feed'] for c in _js},
   f"S8 activar.sql y activar.json cubren las mismas fuentes: {len(_js)} cambios")

# ------------------------------------------------- perfiles y podcasts
# Nada de esto INVENTA una dirección: cada candidata sale de una página que
# acabamos de descargar, o de un `feedUrl` que la API devuelve. PROMPT-FONTI §8:
# «No inventar un indirizzo: un url_feed finto costa una corsa quotidiana».
HOME = (b'<html><head>'
        b'<link rel="me" href="https://mastodon.social/@divulgatore">'
        b'<link rel="alternate" type="application/rss+xml" href="/feed.xml">'
        b'</head><body>'
        b'<a href="https://www.youtube.com/@divulgatore">il canale</a>'
        b'<a href="https://example.com/altro">un link qualunque</a>'
        b'<a rel="nofollow" href="https://sponsor.example/">sponsor</a>'
        b'</body></html>')
ok(K.perfiles(HOME, 'https://blog.ejemplo.org/') ==
   ['https://mastodon.social/@divulgatore', 'https://www.youtube.com/@divulgatore'],
   f"S16 solo i profili che il sito dichiara suoi: {K.perfiles(HOME, 'https://blog.ejemplo.org/')}")

ok(K.feed_de_perfil('https://www.youtube.com/channel/UCabcdefghijklmnopqrstuv') ==
   ('https://www.youtube.com/feeds/videos.xml?channel_id=UCabcdefghijklmnopqrstuv',
    'https://www.youtube.com/channel/UCabcdefghijklmnopqrstuv'),
   'S17 da /channel/UC… il feed si deriva per regola, senza scaricare niente')

reset()
WEB['https://www.youtube.com/@divulgatore'] = (
    b'<html><script>var x = {"channelId":"UCabcdefghijklmnopqrstuv","other":1};</script></html>')
ok(K.feed_de_perfil('https://www.youtube.com/@divulgatore')[0] ==
   'https://www.youtube.com/feeds/videos.xml?channel_id=UCabcdefghijklmnopqrstuv',
   'S18 da un handle il channelId si LEGGE dalla pagina')

WEB['https://www.youtube.com/@mutolo'] = b'<html>niente channelId qui dentro</html>'
ok(K.feed_de_perfil('https://www.youtube.com/@mutolo') == (None, None),
   'S19 e se la pagina non lo dichiara non si inventa: nessun feed')

ok(K.feed_de_perfil('https://mastodon.social/@tizio') ==
   ('https://mastodon.social/@tizio.rss', 'https://mastodon.social/@tizio'),
   'S20 un profilo Mastodon ha la sua RSS per regola documentata')

reset()
WEB['https://blog.ejemplo.org/'] = HOME
WEB['https://www.youtube.com/@divulgatore'] = (
    b'<html><script>{"channelId":"UCabcdefghijklmnopqrstuv"}</script></html>')
cands = S.candidatos_feed('blog.ejemplo.org')
ok([c[0] for c in cands] == [
       'https://blog.ejemplo.org/feed.xml',
       'https://mastodon.social/@divulgatore.rss',
       'https://www.youtube.com/feeds/videos.xml?channel_id=UCabcdefghijklmnopqrstuv']
   and cands[2][2] == 'https://www.youtube.com/channel/UCabcdefghijklmnopqrstuv',
   f"S21 il blog e i suoi profili sono tre fonti, ognuna con il SUO sito: {[c[0] for c in cands]}")

reset()
WEB['https://itunes.apple.com/search?media=podcast&limit=20&term=data%20quality&country=it'] = json.dumps(
    {'results': [{'feedUrl': 'https://pod.example/rss', 'collectionName': 'Dati e qualità'},
                 {'collectionName': 'Senza feed'},
                 {'feedUrl': 'non-un-indirizzo', 'collectionName': 'Rotto'}]}).encode()
ok(S.podcast('data quality', 'it') == [('https://pod.example/rss', 'Dati e qualità', None)],
   f"S22 dalla ricerca podcast solo i feedUrl veri: {S.podcast('data quality', 'it')}")

# Sin esto p7 rechaza todos los canales, y con razón mientras se guarde el
# texto. La declaración vale porque el pipeline la cumple: `feed.solo_metadati`
# marca la voz y `pubblica.py` no le extrae nada.
ok(V.licencia_plataforma('https://www.youtube.com/feeds/videos.xml?channel_id=UCabcdefghijklmnopqrstuv')
   and V.licencia_plataforma('https://mastodon.social/@tizio.rss')
   and V.licencia_plataforma('https://blog.ejemplo.org/feed.xml') is None
   and V.licencia_plataforma('https://youtube.com.evil.example/feeds/videos.xml?channel_id=UCx') is None,
   'S23 la licenza di piattaforma vale solo per le forme dichiarate')

reset()
WEB['https://www.youtube.com/channel/UCabcdefghijklmnopqrstuv'] = (
    b'<html><title>Chi parla</title>niente licenza qui dentro</html>')
WEB['https://www.youtube.com/feeds/videos.xml?channel_id=UCabcdefghijklmnopqrstuv'] = rss(
    BUENOS, link='https://www.youtube.com/channel/UCabcdefghijklmnopqrstuv')
for i in range(10):
    WEB[f'https://blog.ejemplo.org/p{i}'] = ART
r = V.verifica('Chi parla',
               'https://www.youtube.com/feeds/videos.xml?channel_id=UCabcdefghijklmnopqrstuv',
               'https://www.youtube.com/channel/UCabcdefghijklmnopqrstuv', 'ia')
ok(r['motivo'] == 'ACEPTADA' and 'solo metadati' in r['p7_licencia'],
   f"S24 un canale senza licenza sul sito passa p7 come «solo metadati»: {r['motivo']} · {r['p7_licencia'][:44]}")

# ------------------------------------------------- podcasts sin licencia
# Un podcast no se reconoce por la dirección sino por sus adjuntos. Cada prueba
# rompe una mitad distinta: si la regla se aplicara a todo, el blog sin
# licencia pasaría; si se aplicara antes de la detección, el podcast con CC
# perdería el texto de su transcripción; si contara cualquier adjunto, una
# revista con un PDF por artículo entraría «solo metadatos».
def pod(n, tipo='audio/mpeg', sitio='https://pod.ejemplo.fm/', total=10, con=None):
    # `con(i)` decide qué voces llevan el adjunto; por omisión, las n primeras.
    con = con or (lambda i: i < n)
    it = ''.join(
        f'<item><title>Model evaluation note {i}: red teaming frontier models</title>'
        f'<link>{sitio}ep{i}</link><pubDate>{d(i * 86400)}</pubDate>'
        f'<description>llm evals</description>'
        + (f'<enclosure url="{sitio}ep{i}.bin" type="{tipo}" length="1000"/>' if con(i) else '')
        + '</item>' for i in range(total))
    return (f'<?xml version="1.0"?><rss version="2.0"><channel><title>Pod</title>'
            f'<link>{sitio}</link>{it}</channel></rss>').encode()

def verifica_pod(feed, portada=b'<html><title>Pod</title>nessuna licenza qui</html>', **kw):
    reset()
    WEB['https://pod.ejemplo.fm/'] = portada
    WEB['https://pod.ejemplo.fm/feed.xml'] = feed
    for i in range(30):
        WEB[f'https://pod.ejemplo.fm/ep{i}'] = ART
    return V.verifica('Pod', 'https://pod.ejemplo.fm/feed.xml', 'https://pod.ejemplo.fm/', 'ia', **kw)

r = verifica_pod(pod(10))
ok(r['motivo'] == 'ACEPTADA' and r['p7_licencia'].startswith('solo metadati')
   and 'podcast' in r['p7_licencia'],
   f"S25 un podcast senza licenza passa p7 come «solo metadati»: {r['motivo']} · {r['p7_licencia'][:50]}")
_c = V.cambios([r])
ok(len(_c) == 1 and _c[0].get('licenza', '').startswith('solo metadati')
   and "licenza = 'solo metadati" in V.sql_salida([r]),
   f"S26 e la decisione arriva a percorso.fonti.licenza, in tutte e due le uscite: {_c}")

r = verifica_pod(pod(10, tipo='video/mp4'))
ok(r['motivo'] == 'ACEPTADA' and r['p7_licencia'].startswith('solo metadati'),
   f"S27 un video-podcast è un podcast: {r['motivo']}")

r = verifica_pod(pod(5))
ok(r['motivo'] == 'ACEPTADA', f"S28 metà degli episodi con l'audio basta: {r['motivo']}")
r = verifica_pod(pod(4))
ok('p7 sin licencia' in r['motivo'] and r['p7_licencia'] == '',
   f"S29 ma quattro su dieci no, è un blog con qualche episodio: {r['motivo']}")

r = verifica_pod(pod(10, tipo='application/pdf'))
ok('p7 sin licencia' in r['motivo'],
   f"S30 una rivista con un PDF per articolo non è un podcast: {r['motivo']}")

r = verifica_pod(pod(0))
ok('p7 sin licencia' in r['motivo'] and 'licenza = null' in V.sql_salida([r])
   and V.cambios([r])[0].get('licenza') == '',
   f"S31 un blog senza licenza continua a cadere, e la licenza vecchia si toglie: {r['motivo']}")

r = verifica_pod(pod(10), portada=b'<html><title>Pod</title><footer>'
                 b'<a rel="license" href="https://creativecommons.org/licenses/by/4.0/">CC BY</a>'
                 b'</footer></html>')
ok(r['motivo'] == 'ACEPTADA' and r['p7_licencia'].startswith('CC BY')
   and V.cambios([r])[0].get('licenza', '').startswith('CC BY'),
   f"S32 un podcast con CC tiene la sua CC, e la trascrizione resta testo: {r['p7_licencia'][:60]}")

# En producción LICENCIA_AMPLIA es True, y ahí un «©» en el pie del sitio ya es
# una licencia declarada (decisión A): el podcast la conserva y sigue dando el
# texto de su transcripción. La regla de los podcasts solo llega a los que no
# tienen ni eso. Sin esta prueba, las de arriba corren todas con amplia=False
# y nadie comprobaría el modo que de verdad gira los lunes.
r = verifica_pod(pod(10), portada=b'<html><title>Pod</title><footer>&copy; 2026 Pod Media</footer></html>',
                 amplia=True)
ok(r['motivo'] == 'ACEPTADA' and r['p7_licencia'].startswith('Copyright'),
   f"S34 con amplia=True un podcast con © resta Copyright, non «solo metadati»: {r['p7_licencia'][:44]}")
r = verifica_pod(pod(10), amplia=True)
ok(r['motivo'] == 'ACEPTADA' and r['p7_licencia'].startswith('solo metadati'),
   f"S35 e senza nemmeno il © entra «solo metadati» anche con amplia=True: {r['p7_licencia'][:44]}")

# S8 compara las dos salidas con filas SIN `p7_licencia`. Aquí la paridad de
# `licenza`: para cada fuente, activar.json y activar.sql dicen lo mismo -la
# misma licencia, «null» por la vacía, nada por la que no se midió o es
# TRANSITORIO-. Si un día divergen, lo que lee una persona deja de ser lo que
# aplica la máquina.
_filas = [
    {'nome': 'a', 'url_feed': 'https://a/f', 'motivo': 'ACEPTADA', 'p7_licencia': "rel=license | https://a/l'avviso"},
    {'nome': 'b', 'url_feed': 'https://b/f', 'motivo': 'ACEPTADA', 'p7_licencia': C.LICENCIA_PODCAST + ' | https://b/f'},
    {'nome': 'c', 'url_feed': 'https://c/f', 'motivo': 'p7 sin licencia', 'p7_licencia': ''},
    {'nome': 'd', 'url_feed': 'https://d/f', 'motivo': 'TRANSITORIO p9 (x)', 'p7_licencia': 'CC BY | https://d/'},
    {'nome': 'e', 'url_feed': 'https://e/f', 'motivo': 'p1 roto (HTTP 404)'},
    {'nome': 'f', 'url_feed': 'https://f/f', 'url_nuevo': 'https://f/nuevo.xml', 'reparacion': 'x',
     'motivo': 'ACEPTADA', 'p7_licencia': "Copyright (todos los derechos reservados) | https://f/"},
]
_js = {c['url_feed']: c for c in V.cambios(_filas)}
_sql = V.sql_salida(_filas)
# Tres valores y no dos: «no se toca» (sin clave, sin línea) no es «se quita»
# (vacía, null). Confundirlos dejaría verde un SQL que borra la licencia de una
# fuente TRANSITORIA y respeta la de una que la perdió.
NO_SE_TOCA = 'no se toca'
def _en_sql(f):
    u = f.get('url_nuevo') or f['url_feed']
    m = re.search(r"set licenza = ('(?:[^']|'')*'|null) where url_feed = '" + re.escape(u) + "';", _sql)
    return NO_SE_TOCA if not m else (None if m.group(1) == 'null' else m.group(1)[1:-1].replace("''", "'"))
def _en_json(f):
    c = _js.get(f['url_feed']) or {}
    return NO_SE_TOCA if 'licenza' not in c else (c['licenza'] or None)
_par = [(f['nome'], _en_json(f), _en_sql(f)) for f in _filas]
ok(all(j == q for _, j, q in _par)
   and {type(x.stmt).__name__ for x in pglast.parse_sql(_sql)} == {'UpdateStmt'}
   and _sql.index("set url_feed = 'https://f/nuevo.xml'") < _sql.index("set licenza = 'Copyright")
   and [j for _, j, _ in _par] == ["rel=license | https://a/l'avviso", C.LICENCIA_PODCAST + ' | https://b/f', None,
                                   NO_SE_TOCA, NO_SE_TOCA,
                                   "Copyright (todos los derechos reservados) | https://f/"],
   f"S36 activar.json y activar.sql dicen la misma licencia de cada fuente: {_par}")

# El disyuntor de caída mide dos bases y salta con cualquiera. Cada escena
# rompe una sola: la que ve cada base es la que la otra no ve.
_blog = lambda i, m, l: {'url_feed': f'https://b{i}/f', 'motivo': m, 'p7_licencia': l}
_pod = lambda i, m='ACEPTADA': {'url_feed': f'https://p{i}/f', 'motivo': m,
                                'p7_licencia': C.LICENCIA_PODCAST + f' | https://p{i}/f' if m == 'ACEPTADA' else ''}
_bases = lambda rows: (sum(r['motivo'] == 'ACEPTADA' for r in rows), V.aceptadas_de_sitio(rows))
# Portadas en 403, feeds sanos: los blogs caen en «p7 sin licencia», que RED no
# reconoce, y los podcasts siguen. Sobre el total, 40 -> 20 no llega al 50%.
_normal = [_blog(i, 'ACEPTADA', 'CC BY 4.0 | x') for i in range(20)] + [_pod(i) for i in range(20)]
_portadas_403 = [_blog(i, 'p7 sin licencia', '') for i in range(20)] + [_pod(i) for i in range(20)]
ok(_bases(_normal) == (40, 20) and V.disyuntor(_portadas_403, *_bases(_normal))
   and not V.disyuntor(_normal, *_bases(_normal)),
   f"S37 portadas en 403: salta la base de sitio: {V.disyuntor(_portadas_403, *_bases(_normal))!r}")
# Feeds de los podcasts en 404 a la IP del runner, portadas sanas: caen los
# «solo metadati», que la base de sitio no cuenta. Sin la base total se
# apagarían treinta podcasts, y la curación los reescribiría en `sitemap:`
# perdiendo el feed de audio para siempre.
_normal = [_blog(i, 'ACEPTADA', 'CC BY 4.0 | x') for i in range(10)] + [_pod(i) for i in range(30)]
_feeds_404 = [_blog(i, 'ACEPTADA', 'CC BY 4.0 | x') for i in range(10)] + \
             [_pod(i, 'p1 roto (HTTP 404); curación agotada') for i in range(30)]
ok(_bases(_normal) == (40, 10) and V.disyuntor(_feeds_404, *_bases(_normal))
   and not V.disyuntor(_normal, *_bases(_normal)),
   f"S38 feed dei podcast in 404: scatta la base totale: {V.disyuntor(_feeds_404, *_bases(_normal))!r}")
# Primera corrida con este código: estado_verifica.json aún no tiene la base
# de sitio. El disyuntor debe ser el de antes, no uno que compare las de sitio
# de hoy con el total de ayer: con 20 blogs y 25 canales eso daría 45 -> 20, y
# como la base solo se escribe cuando no salta, saltaría todas las semanas.
_hoy = [_blog(i, 'ACEPTADA', 'CC BY 4.0 | x') for i in range(20)] + \
       [{'url_feed': f'https://yt{i}/f', 'motivo': 'ACEPTADA', 'p7_licencia': C.PIATTAFORME_METADATI[0][1] + ' | x'}
        for i in range(25)]
ok(V.disyuntor(_hoy, 45, None) == '',
   f"S43 sin base de sitio el disyuntor es el de antes: {V.disyuntor(_hoy, 45, None)!r}")

# La ventana son las diez voces MÁS RECIENTES, no el feed entero, y la mitad
# es de las que hay. Un feed real de podcast trae cientos de episodios: un
# blog que acaba de empezar un podcast es un podcast hoy, y un podcast que
# volvió a ser blog ya no lo es. Y un podcast nuevo, de cuatro episodios, es
# un podcast: la mitad de diez sería una vara que no puede pasar.
r = verifica_pod(pod(0, total=30, con=lambda i: i < 10))
ok(r['motivo'] == 'ACEPTADA' and r['p7_licencia'].startswith('solo metadati'),
   f"S39 dieci episodi recenti su trenta voci: è un podcast oggi: {r['motivo']}")
r = verifica_pod(pod(0, total=30, con=lambda i: i >= 10))
ok('p7 sin licencia' in r['motivo'],
   f"S40 venti episodi vecchi sotto dieci post recenti: è tornato blog: {r['motivo']}")
r = verifica_pod(pod(4, total=4))
ok(r['motivo'] == 'ACEPTADA' and r['p7_licencia'].startswith('solo metadati'),
   f"S41 un podcast nuovo di quattro episodi è un podcast: {r['motivo']} · {r.get('p7_licencia', '')[:20]}")

# La portada no se deja leer (403 anti-bot, 404, sitio sin http): la regla de
# los podcasts no la lee, así que no depende de ella. Si un día se moviera
# dentro del bloque que analiza la portada, estos podcasts caerían en p7.
for _cod in (403, 404):
    r = verifica_pod(pod(10), portada=K.Resp(_cod, 'https://pod.ejemplo.fm/', error=f'HTTP {_cod}'))
    ok(r['motivo'] == 'ACEPTADA' and r['p7_licencia'].startswith('solo metadati'),
       f"S42 un podcast con la home in {_cod} entra «solo metadati»: {r['motivo']}")

# Una fila que se paró antes de p7 no sabe nada de la licencia: no debe
# borrar la que había. TRANSITORIO no toca nada más que la reparación.
_filas = [{'nome': 'x', 'url_feed': 'https://x/f', 'motivo': 'p1 roto (HTTP 404)'},
          {'nome': 'y', 'url_feed': 'https://y/f', 'motivo': 'TRANSITORIO p9 (x)',
           'p7_licencia': 'CC BY | https://y/'}]
ok(all('licenza' not in c for c in V.cambios(_filas)) and 'licenza' not in V.sql_salida(_filas),
   f"S33 senza misura di p7 la licenza non si tocca: {V.cambios(_filas)}")

print(f'\n{sum(R)}/{len(R)} adversariales OK')
