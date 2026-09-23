"""Verifica §8 (p0-p9) con AUTORREPARACIÓN de url_feed.
Uso: python3 verifica_fonti.py fonti.sql [--sin-parche] [--licencia-estricta] [--sin-muro]
Salidas: informe.csv, activar.sql (reparar -> activar -> desactivar), estado_verifica.json, salud.md
Códigos de salida: 0 ok · 2 ok con avisos (tema sin fuentes / REVISAR) · 3 DISYUNTOR (no se escribió activar.sql) · 1 error de uso
  --sin-parche      solo si lessico_patch.MEDIDO NO está fusionado en el clasificador real
  --licencia-amplia decisión A: acepta 'Copyright/©' como licencia declarada
  --sin-muro        omite p9 (3 descargas extra por fuente)"""
import sys, re, csv, json, os, time
import fonti_core as K
import temi_config as C

LICENCIAS = {  # url_feed -> (licencia, url que la declara). Prevalece sobre la detección automática.
    'https://www.eurosurveillance.org/rss/content/eurosurveillance/latestarticles?fmt=rss': ('CC BY', 'https://doaj.org/toc/1560-7917'),
}
ESTADO = 'estado_verifica.json'
Q = r"'((?:[^']|'')*)'"
def filas(sql):  # (nome, url_feed, url_sito, categoria)
    S = r"\s*,\s*"
    return [tuple(x.replace("''", "'") for x in m)
            for m in re.findall(r"\(\s*" + Q + S + Q + S + Q + S + r"'(?:rss|sitemap)'" + S + Q, sql)]

def verifica(nome, url, url_sito, cat, amplia=False, con_muro=True):
    r = dict(nome=nome, url_feed=url, url_sito=url_sito, categoria=cat, url_nuevo='', reparacion='')
    resp, d = K.feed(url)
    if resp.permanente and d.entries and resp.url != url:
        if not K.reparacion_segura(resp.url, url_sito, url):
            return r | dict(motivo=f'REVISAR redirección a otro dominio: {K.host(resp.url)}')
        r['url_nuevo'], r['reparacion'] = resp.url, 'redirección permanente'
    if not d.entries or K.muerto(d):
        if not d.entries and resp.transitorio:
            return r | dict(motivo=f'TRANSITORIO ({resp.error or resp.status})')
        cands = ([resp.url] if resp.url != url else [])
        disc, pag = K.descubrir(url_sito) if url_sito.startswith(('http', '/')) else ([], None)
        cands += [c for c in disc if c not in cands and c != url]
        mejor = None
        externos = [c for c in cands if not K.reparacion_segura(c, url_sito, url)]
        cands = [c for c in cands if c not in externos]
        for c in cands[:C.MAX_CANDIDATOS]:
            r2, d2 = K.feed(c)
            if d2.entries and not K.muerto(d2):
                n = K.utiles(d2, cat)[0]
                if mejor is None or n > mejor[0]: mejor = (n, c, r2, d2)
        if not mejor:                                     # CURACIÓN PROFUNDA: el sitio se movió, el feed cambió o no existe
            profunda = curar(nome, url, url_sito, cat, externos)
            if profunda.get('mejor'):
                mejor = profunda['mejor']; r['url_sito_nuevo'] = profunda.get('url_sito_nuevo', '')
                r['reparacion'] = profunda['via']
            else:
                why = 'muerto' if d.entries else ('bloqueo anti-bot (202 sin cuerpo)' if resp.status == 202 else resp.error or f'status={resp.status}')
                ext = profunda.get('revisar') or ''
                return r | dict(motivo=f'p1 roto ({why}); curación agotada ({profunda["intentos"]}){"; REVISAR " + ext if ext else ""}')
        else:
            r['reparacion'] = f'autodescubierto en {url_sito}'
        _, r['url_nuevo'], resp, d = mejor
        url_sito = r.get('url_sito_nuevo') or url_sito
    ef = r['url_nuevo'] or url
    es = d.entries[:10]
    fechas = [e.get('published_parsed') or e.get('updated_parsed') for e in es]
    r['p0_dias'] = K.dias_desde_ultima(d)
    r['p2_orden'] = bool(fechas[0]) and all(f is None or fechas[0] >= f for f in fechas)
    r['p3_utiles'], r['p3_media'], r['p3_cat'], r['p3_correlati'], r['p3_esplorazione'] = K.utiles(d, cat)
    links = [e.get('link', '') for e in es if e.get('link')]
    r['p4_pdf'] = sum(l.lower().split('?')[0].endswith('.pdf') for l in links)
    lens = sorted(len(K.texto(K.cuerpo(e))) for e in es); r['p5_sumario_med'] = lens[len(lens) // 2]
    keys = [re.sub(r'[^a-z0-9]', '', e.get('title', '').lower())[:120] for e in es]
    r['p6_distintos'] = f'{len(set(keys))}/{len(keys)}'
    canal = d.feed.get('link', '')
    r['p8_canal'] = canal
    pag = K.fetch(url_sito) if url_sito.startswith('http') else None
    canon = K.canonico(pag.body, pag.url) if pag and pag.body else ''
    r['p8_canonico'] = canon
    p8_ok = ((not canal) or not url_sito.startswith('http') or K.mismo_sitio(canal, url_sito)
             or (pag is not None and K.mismo_sitio(canal, pag.url)) or K.mismo_sitio(canal, canon))   # dominio propio declarado por el sitio
    lic = LICENCIAS.get(url) or LICENCIAS.get(ef)
    if not lic and pag and pag.body:
        # prioridad: licencia abierta (pie -> páginas de términos) antes que el mero aviso de copyright
        cache = {}
        def terminos():                                   # descarga perezosa: solo si el pie no basta
            for u2 in K.paginas_licencia(pag.body, pag.url):
                if u2 not in cache: cache[u2] = K.fetch(u2)
                yield cache[u2]
        for modo in ([False, True] if amplia else [False]):
            lic = K.licencia(pag.body, pag.url, modo) or next(
                (x for x in (K.licencia_pagina(p2.body, p2.url, modo) for p2 in terminos() if p2.body) if x), None)
            if lic: break
    r['p7_licencia'] = f'{lic[0]} | {lic[1]}' if lic else ''
    if con_muro:
        n, tot, det, trans = K.muro(links); r['p9_muro'] = f'{n}/{tot}'; r['p9_detalle'] = det
        if tot == 0 and trans and trans == min(3, len(links)):   # red caída al bajar artículos: no decidir hoy
            return r | dict(motivo=f'TRANSITORIO p9 (artículos: {det[:80]})')
    else: n, tot = 0, None
    fallos = [m for m, c in [
        ('p0 muerto/sin fechas', K.muerto(d)), ('p2 orden', not r['p2_orden']),
        (f"p3 {r['p3_utiles']}/10", r['p3_utiles'] < C.UMBRAL_VOCES),
        ('p6 duplicados', len(set(keys)) < len(keys) * C.UMBRAL_DISTINTOS),
        ('p7 sin licencia', not lic), (f'p8 canal={K.host(canal)} ≠ sitio', not p8_ok),
        (f'p9 muro {n}', n > C.PAYWALL_MAX),
        ('p9 sin texto accesible (artículos no descargables y sumario corto)', tot == 0 and r['p5_sumario_med'] < C.MIN_SUMARIO_SIN_ARTICULO)] if c]
    return r | dict(motivo='; '.join(fallos) or 'ACEPTADA')

def _mejor_de(cands, cat):
    mejor = None
    for c in cands[:C.MAX_CANDIDATOS]:
        r2, d2 = K.feed(c)
        if d2.entries and not K.muerto(d2):
            n = K.utiles(d2, cat)[0]
            if mejor is None or n > mejor[0]: mejor = (n, c, r2, d2)
    return mejor

def curar(nome, url, url_sito, cat, externos=()):
    """Cadena autónoma, de la evidencia más fuerte a la más débil. Solo aplica sola lo que puede probar que es LA MISMA fuente.
    1 sitio movido (canonical actual / redirección / canonical en copia archivada) -> redescubrir allí
    2 directorio de feeds por nombre y dominio -> solo candidatos cuyo website es el mismo sitio (o el sitio movido)
    3 sin feed: feed sintetizado con el sitemap y las páginas reales del sitio (metodo 'sitemap')"""
    intentos = []
    nuevo, via = K.sitio_movido(url_sito) if url_sito.startswith('http') else (None, None)
    sitios = [url_sito]
    if nuevo:
        intentos.append(f'sitio movido→{K.host(nuevo)}')
        disc, _ = K.descubrir(nuevo)
        m = _mejor_de(disc, cat)
        titulo_nuevo = (m[3].feed.get('title', '') if m else '') or K.texto((re.search(rb'(?is)<title>(.*?)</title>', K.fetch(nuevo).body or b'') or [b'', b''])[1])
        if m and K.similitud(titulo_nuevo, nome) >= C.IDENTIDAD_MIN:   # dominio caducado/comprado: otra identidad -> no se aplica solo
            return dict(mejor=m, via=f'sitio movido ({via}) → {K.host(nuevo)}', url_sito_nuevo=nuevo, intentos=intentos)
        if m: return dict(intentos=' → '.join(intentos), revisar=f'sitio movido a {K.host(nuevo)} con otra identidad ("{titulo_nuevo[:30]}")')
        sitios.append(nuevo)
    revisar = []
    for q in dict.fromkeys([nome, K.host(url_sito)]):
        for fu, titulo, web in K.feedly(q):
            if fu in (url,): continue
            if any(K.mismo_sitio(web or fu, s) for s in sitios):
                m = _mejor_de([fu], cat)
                if m: return dict(mejor=m, via=f'directorio de feeds ({titulo[:40]})', intentos=intentos + ['directorio'])
            elif K.similitud(titulo, nome) >= 0.8: revisar.append(f'{K.host(web or fu)} ("{titulo[:30]}")')
    intentos.append('directorio')
    for s in sitios:
        m = _mejor_de(['sitemap:' + s], cat)
        if m: return dict(mejor=m, via=f'feed sintetizado desde el sitemap de {K.host(s)}', intentos=intentos + ['sitemap'])
    intentos.append('sitemap')
    revisar += [K.host(x) for x in externos[:3]]
    return dict(intentos=' → '.join(intentos), revisar=', '.join(dict.fromkeys(revisar)))

esc = lambda u: u.replace("'", "''")
com = lambda s: re.sub(r'[\r\n]+', ' ', str(s))   # comentarios SQL: un salto de línea no debe abrir una sentencia
def sql_salida(rows):
    out = [f'-- generado por verifica_fonti.py {time.strftime("%Y-%m-%d %H:%M")}', '-- 1) reparaciones de url_feed']
    for r in rows:
        if r.get('url_nuevo'):
            o, n = esc(r['url_feed']), esc(r['url_nuevo'])
            out.append(f"update percorso.fonti f set url_feed = '{n}' where f.url_feed = '{o}' and not exists "
                       f"(select 1 from percorso.fonti g where g.utente_id = f.utente_id and g.url_feed = '{n}');  -- {com(r['reparacion'])}")
            out.append(f"update percorso.fonti set attiva = false where url_feed = '{o}';  -- si el nuevo ya existía")
            extra = []
            if r.get('url_sito_nuevo'): extra.append(f"url_sito = '{esc(r['url_sito_nuevo'])}'")
            if r['url_nuevo'].startswith('sitemap:'): extra.append("metodo = 'sitemap'")
            if extra: out.append(f"update percorso.fonti set {', '.join(extra)} where url_feed = '{n}';")
    out.append('-- 2) activar / desactivar (TRANSITORIO no se toca)')
    for r in rows:
        u = esc(r.get('url_nuevo') or r['url_feed'])
        if r['motivo'] == 'ACEPTADA': out.append(f"update percorso.fonti set attiva = true where url_feed = '{u}';")
        elif not r['motivo'].startswith('TRANSITORIO'): out.append(f"update percorso.fonti set attiva = false where url_feed = '{u}';  -- {com(r['motivo'][:80])}")
    return '\n'.join(out) + '\n'

def estado(rows):
    est = json.load(open(ESTADO)) if os.path.exists(ESTADO) else {}
    for r in rows:
        u = r['url_feed']
        est[u] = est.get(u, 0) + 1 if r['motivo'].startswith('TRANSITORIO') else 0
        if est[u] >= C.MAX_FALLOS_TRANSITORIOS: r['motivo'] = f'caído {est[u]} corridas seguidas'
    json.dump(est, open(ESTADO, 'w'), indent=1)

RED = re.compile(r'HTTP 403|HTTP 5\d\d|status=None|anti-bot|URLError|timeout|NO_DESCARGADA|sin texto accesible|TRANSITORIO')
def disyuntor(rows, previo):
    """Protege la producción de un entorno roto (proxy corporativo, caída de red, bloqueo de IP)."""
    n = len(rows) or 1
    red = sum(bool(RED.search(r['motivo'])) for r in rows)
    ok = sum(r['motivo'] == 'ACEPTADA' for r in rows)
    if red / n >= C.DISYUNTOR_RED: return f'{red}/{n} fuentes fallan por red o bloqueo (umbral {C.DISYUNTOR_RED:.0%})'
    if previo and previo >= 5 and ok < previo * (1 - C.DISYUNTOR_CAIDA): return f'aceptadas caen de {previo} a {ok}'
    return ''

def salud(rows, motivo_disyuntor, path='salud.md'):
    por_tema = {}
    for r in rows: por_tema.setdefault(r['categoria'], []).append(r)
    L = [f'# Salud de fuentes · {time.strftime("%Y-%m-%d %H:%M")}', '']
    if motivo_disyuntor: L += [f'**DISYUNTOR ACTIVADO: {motivo_disyuntor}. No se generó activar.sql; la base no cambia.**',
                               'Causa probable: red/proxy del entorno. Acción: repetir más tarde o desde otra red.', '']
    L += ['| tema | aceptadas | candidatas | reparadas | revisar |', '|---|---|---|---|---|']
    avisos = 0
    for t in sorted(por_tema):
        rs = por_tema[t]; a = sum(r['motivo'] == 'ACEPTADA' for r in rs)
        rv = sum(r['motivo'].startswith('REVISAR') or 'REVISAR' in r['motivo'] for r in rs)
        avisos += (a == 0) + rv
        L.append(f"| {t} | {a}{' ⚠️' if a == 0 else ''} | {len(rs)} | {sum(bool(r.get('url_nuevo')) for r in rs)} | {rv} |")
    L += ['', '## Rechazos por motivo']
    from collections import Counter
    cnt = Counter((re.match(r'(p\d+|TRANSITORIO|REVISAR|caído)', m) or re.match(r'\S+', m)).group(0)
                  for r in rows for m in r['motivo'].split('; ') if r['motivo'] != 'ACEPTADA' and not m.startswith('sin reparación'))
    L += [f'- {k}: {v}' for k, v in cnt.most_common()]
    open(path, 'w').write('\n'.join(L) + '\n')
    return avisos

def escribir(rows, csv_path='informe.csv', sql_path='activar.sql'):
    campos = list(dict.fromkeys(k for r in rows for k in r))
    with open(csv_path, 'w', newline='') as fh:
        w = csv.DictWriter(fh, campos); w.writeheader(); w.writerows(rows)
    open(sql_path, 'w').write(sql_salida(rows))

def verifica_segura(*a, **kw):
    try: return verifica(*a, **kw)
    except Exception as e:                       # una fuente rara nunca tumba la corrida ni cambia su estado
        return dict(nome=a[0], url_feed=a[1], url_sito=a[2], categoria=a[3], url_nuevo='', reparacion='',
                    motivo=f'TRANSITORIO error interno {type(e).__name__}: {str(e)[:60]}')

if __name__ == '__main__':
    K.configurar(parche='--sin-parche' not in sys.argv)
    amplia = C.LICENCIA_AMPLIA and '--licencia-estricta' not in sys.argv
    sql = open(sys.argv[1]).read(); fs = filas(sql)
    esperadas = len(re.findall(r"'(?:rss|sitemap)'", sql))
    if len(fs) != esperadas:
        sys.exit(f'ERROR: leídas {len(fs)} filas de {esperadas} con metodo rss; formato no reconocido. No se genera activar.sql.')
    rows = [verifica_segura(n, u, s, c, amplia, '--sin-muro' not in sys.argv) for n, u, s, c in fs]
    previo = (json.load(open(ESTADO)).get('__aceptadas__') if os.path.exists(ESTADO) else None)
    corte = disyuntor(rows, previo)
    avisos = salud(rows, corte)
    if corte:
        with open('informe.csv', 'w', newline='') as fh:
            w = csv.DictWriter(fh, list(dict.fromkeys(k for r in rows for k in r))); w.writeheader(); w.writerows(rows)
        open('activar.sql', 'w').write(f'-- DISYUNTOR: {corte}. Sin cambios.\n')
        print(f'DISYUNTOR: {corte} -> activar.sql vacío, ver salud.md'); sys.exit(3)
    estado(rows); escribir(rows)
    est = json.load(open(ESTADO)); est['__aceptadas__'] = sum(r['motivo'] == 'ACEPTADA' for r in rows); json.dump(est, open(ESTADO, 'w'), indent=1)
    for r in rows:
        rep = f"  [reparado: {r['reparacion']}]" if r.get('url_nuevo') else ''
        print(f"{r['nome'][:22]:22} {str(r.get('p3_utiles', '-')):>2}/10  {r['motivo']}{rep}")
    print(f"aceptadas {sum(r['motivo'] == 'ACEPTADA' for r in rows)}/{len(rows)} · reparadas {sum(bool(r.get('url_nuevo')) for r in rows)} -> activar.sql, salud.md")
    sys.exit(2 if avisos else 0)
