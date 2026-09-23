"""Pruebas deterministas sin red (fetch simulado). python3 test_fonti.py"""
import time, email.utils, json, pglast
import fonti_core as K, verifica_fonti as V, scopri_fonti as S, temi_config as C
K.configurar(parche=True)
def d(days): return email.utils.formatdate(time.time() - days * 86400)
def rss(items, link='https://blog.ejemplo.org/'):
    it = ''.join(f'<item><title>{t}</title><link>{l}</link><pubDate>{d(i)}</pubDate><description>{s}</description></item>'
                 for i, (t, l, s) in enumerate(items))
    return f'<?xml version="1.0"?><rss version="2.0"><channel><title>x</title><link>{link}</link>{it}</channel></rss>'.encode()
BUENOS = [(f'Model evaluation note {i}: red teaming frontier models', f'https://blog.ejemplo.org/p{i}', 'llm evals prompt injection') for i in range(10)]
CC = b'<html><head><link rel="alternate" type="application/rss+xml" href="/feed.xml"></head><body><a rel="license" href="https://creativecommons.org/licenses/by/4.0/">cc</a></body></html>'
ART = b'<html><body>' + b'long free article text ' * 200 + b'</body></html>'
WEB = {}
def fake(url, limit=0):
    v = WEB.get(url)
    if v is None: return K.Resp(404, url, error='HTTP 404')
    if isinstance(v, K.Resp): return v
    return K.Resp(200, url, body=v)
K.fetch = fake
def reset(): WEB.clear(); [WEB.__setitem__(f'https://blog.ejemplo.org/p{i}', ART) for i in range(10)]
ok = lambda c, m: print(('PASS ' if c else 'FAIL ') + m) or c
R = []

# 1 autorreparación: url_feed 404 -> <link rel=alternate> en url_sito
reset(); WEB['https://blog.ejemplo.org/'] = CC; WEB['https://blog.ejemplo.org/feed.xml'] = rss(BUENOS)
r = V.verifica('t', 'https://blog.ejemplo.org/rss-viejo', 'https://blog.ejemplo.org/', 'ia')
R.append(ok(r['url_nuevo'] == 'https://blog.ejemplo.org/feed.xml' and r['motivo'] == 'ACEPTADA', f"1 autorreparación <link>: {r['url_nuevo']} · {r['motivo']}"))
# 2 sin <link>: prueba de sufijos
reset(); WEB['https://blog.ejemplo.org/'] = b'<html>sin feed declarado creativecommons.org/licenses/by-sa/4.0/</html>'; WEB['https://blog.ejemplo.org/index.xml'] = rss(BUENOS)
r = V.verifica('t', 'https://blog.ejemplo.org/x', 'https://blog.ejemplo.org/', 'ia')
R.append(ok(r['url_nuevo'] == 'https://blog.ejemplo.org/index.xml', f"2 sufijos: {r['url_nuevo']} · licencia {r['p7_licencia']}"))
# 3 redirección permanente -> canonicaliza
reset(); WEB['https://blog.ejemplo.org/'] = CC
WEB['https://viejo.ejemplo.org/rss'] = K.Resp(200, 'https://blog.ejemplo.org/feed.xml', [(301, 'https://blog.ejemplo.org/feed.xml')], body=rss(BUENOS))
r = V.verifica('t', 'https://viejo.ejemplo.org/rss', 'https://blog.ejemplo.org/', 'ia')
R.append(ok(r['url_nuevo'] == 'https://blog.ejemplo.org/feed.xml' and r['reparacion'] == 'redirección permanente', '3 redirección 301 canonicalizada'))
# 4 feed muerto (>365 días) -> busca otro en el sitio
reset(); WEB['https://blog.ejemplo.org/'] = CC; WEB['https://blog.ejemplo.org/feed.xml'] = rss(BUENOS)
WEB['https://blog.ejemplo.org/old.xml'] = rss([(t, l, s) for t, l, s in BUENOS]).replace(b'<pubDate>', b'<pubDate>Thu, 28 Jun 2018 13:00:00 GMT</pubDate><x>').replace(b'</pubDate><description>', b'</x><description>')
r = V.verifica('t', 'https://blog.ejemplo.org/old.xml', 'https://blog.ejemplo.org/', 'ia')
R.append(ok(r['url_nuevo'] == 'https://blog.ejemplo.org/feed.xml', f"4 muerto -> reparado: {r['url_nuevo']} · {r['motivo']}"))
# 5 transitorio: no repara, no desactiva
reset(); WEB['https://blog.ejemplo.org/f'] = K.Resp(None, 'https://blog.ejemplo.org/f', error='URLError')
r = V.verifica('t', 'https://blog.ejemplo.org/f', 'https://blog.ejemplo.org/', 'ia')
R.append(ok(r['motivo'].startswith('TRANSITORIO') and 'attiva = false' not in V.sql_salida([r]), '5 transitorio sin tocar attiva'))
# 6 roto sin reparación posible
reset(); r = V.verifica('t', 'https://nada.ejemplo.org/f', 'https://nada.ejemplo.org/', 'ia')
R.append(ok(r['motivo'].startswith('p1 roto') and 'attiva = false' in V.sql_salida([r]), f"6 irreparable -> desactivar: {r['motivo']}"))
# 7 muro de pago
reset(); WEB['https://blog.ejemplo.org/'] = CC; WEB['https://blog.ejemplo.org/feed.xml'] = rss(BUENOS)
for i in range(3): WEB[f'https://blog.ejemplo.org/p{i}'] = b'<html>Intro... This post is for paid subscribers</html>'
r = V.verifica('t', 'https://blog.ejemplo.org/feed.xml', 'https://blog.ejemplo.org/', 'ia')
R.append(ok('p9 muro 3' in r['motivo'], f"7 muro detectado: {r['p9_muro']}"))
# 8 feed de otro sitio (p8)
reset(); WEB['https://blog.ejemplo.org/'] = CC; WEB['https://blog.ejemplo.org/feed.xml'] = rss(BUENOS, link='https://otro-dominio.com/')
r = V.verifica('t', 'https://blog.ejemplo.org/feed.xml', 'https://blog.ejemplo.org/', 'ia')
R.append(ok('p8' in r['motivo'], f"8 canal ajeno: {r['motivo']}"))
# 9 licencia: CC / OGL / ninguna / amplia
R.append(ok(K.licencia(CC, 'u')[0] == 'CC BY 4.0' and K.licencia(b'Open Government Licence v3.0', 'u')[0] == 'OGL'
            and K.licencia(b'(c) nada', 'u') is None and K.licencia(b'Copyright 2026 Foo', 'u', amplia=True) is not None
            and K.licencia(b'Copyright 2026 Foo', 'u') is None, '9 licencia CC/OGL/ninguna/amplia'))
# 10 relacionados: 2 débiles en título pasan, 1 no
p1, _ = K.punteggio('Mortality and surveillance in camps', ''); p2, _ = K.punteggio('Mortality in camps', '')
R.append(ok(p1.get('epidemiologia', 0) >= 1.0 and p2.get('epidemiologia', 0) < 1.0, f'10 débiles: 2 términos {p1.get("epidemiologia")} ≥1, 1 término {p2.get("epidemiologia")} <1'))
# 11 ruido a límite de palabra + extra por tema
R.append(ok(not K.es_rumore('Cheating behaviour in frontier model evaluations') and K.es_rumore('Acme raises Series B at $1B valuation')
            and K.es_rumore('New pricing for agents', 'ia') and not K.es_rumore('New pricing for agents', 'meal'), '11 ruido: palabra completa + extra por tema'))
# 12 exploración
import feedparser
dd = feedparser.parse(rss([('Lessons learned from a decade of fieldwork', 'https://x/1', 'long ' * 400)] + BUENOS[:3]))
R.append(ok(K.utiles(dd, 'ia')[4] == 1, f'12 esplorazione contada: {K.utiles(dd, "ia")}'))
# 13 descubrimiento por keyword (HN simulado) excluye conocidos/sociales y propone
reset(); WEB['https://blog.ejemplo.org/'] = CC; WEB['https://blog.ejemplo.org/feed.xml'] = rss(BUENOS)
hits = [{'url': u} for u in ['https://blog.ejemplo.org/a', 'https://blog.ejemplo.org/b', 'https://twitter.com/x', 'https://duckdb.org/x']]
for kw in K.FUERTES['ia'][:4]:
    WEB[f'https://hn.algolia.com/api/v1/search?query=%22{kw.replace(" ", "%20")}%22&tags=story&hitsPerPage=50'] = json.dumps({'hits': hits}).encode()
doms = S.candidatos('ia', {'duckdb.org'}, fuentes=(S.hn,))
props = S.explorar('ia', doms, 2)
R.append(ok([h for h, _ in doms] == ['blog.ejemplo.org'] and props and props[0]['motivo'] == 'ACEPTADA', f'13 scouting: dominios {doms} -> {props[0]["motivo"] if props else None}'))
# 14 SQL generado válido
for i, q in enumerate([V.sql_salida([r, props[0]]), S.proponer_sql(props * 2)]):
    try: pglast.parse_sql(q); R.append(ok(True, f'14.{i} SQL válido'))
    except Exception as e: R.append(ok(False, f'14.{i} SQL: {e}'))
print(f'\n{sum(R)}/{len(R)} pruebas OK')
