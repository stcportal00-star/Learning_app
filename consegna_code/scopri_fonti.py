"""Descubrimiento de fuentes POR KEYWORD. No entra en la corrida de las 08:00: se ejecuta aparte (semanal/mensual).
Uso: python3 scopri_fonti.py fonti.sql [--temi meal,hardware] [--por-tema 10] [--reliefweb-appname NOMBRE]
Cadena: keyword -> dominios que la mencionan (HN Algolia, ReliefWeb API, listas 'awesome' de GitHub)
        -> autodescubrimiento de feed en la home -> verifica_fonti.verifica (p0-p9) -> proponer.sql (attiva=false)
Todas las propuestas pasan después por verifica_fonti.py; nada se activa desde aquí."""
import sys, re, json, time, urllib.parse
from collections import Counter
import fonti_core as K
import temi_config as C
import verifica_fonti as V

AVISOS = []
def _json(url, reintento=True):
    r = K.fetch(url)
    try: js = json.loads(r.body) if r.body else {}
    except ValueError: js = {}
    if r.status in (403, 429) or 'rate limit' in str(js.get('message', '')).lower():
        if reintento: time.sleep(65); return _json(url, False)   # GitHub sin token: 10 búsquedas/min
        AVISOS.append(f'bloqueo o límite de uso (HTTP {r.status}): {url[:70]}')
    elif not r.body: AVISOS.append(f'sin respuesta ({r.error or r.status}): {url[:70]}')
    return js

def hn(kw):
    q = urllib.parse.quote(f'"{kw}"')
    js = _json(f'https://hn.algolia.com/api/v1/search?query={q}&tags=story&hitsPerPage=50')
    return [K.host(h['url']) for h in js.get('hits', []) if h.get('url')]

def reliefweb(kw, appname):
    q = urllib.parse.quote(kw)
    js = _json(f'https://api.reliefweb.int/v2/reports?appname={appname}&query[value]={q}'
               f'&fields[include][]=source.homepage&limit=100&sort[]=date:desc')
    return [K.host(s['homepage']) for it in js.get('data', []) for s in it.get('fields', {}).get('source', []) if s.get('homepage')]

def awesome(slug):
    q = urllib.parse.quote(C.AWESOME.get(slug, f'awesome {slug}') + ' in:name')  # el tema debe estar en el nombre del repo
    js = _json(f'https://api.github.com/search/repositories?q={q}&sort=stars&per_page=2')
    hosts = []
    for repo in js.get('items', []):
        r = K.fetch(f"https://raw.githubusercontent.com/{repo['full_name']}/{repo.get('default_branch', 'main')}/README.md")
        hosts += [K.host(u) for u in re.findall(r'\]\((https?://[^)\s]+)\)', r.body.decode('utf-8', 'ignore'))]
        time.sleep(1)
    return hosts

def conocidos(sql):
    """Dominios que ya tenemos. Si `sql` es --da-nuvola, se leen de la tabla.

    Importa que venga de la tabla: si no, el scouting volvería a proponer cada
    mes las mismas candidatas que ya propuso -el `on conflict do nothing` las
    tragaría en silencio- y gastaría la cuota de las APIs para nada.
    """
    filas = V.filas_de_nuvola() if sql == V.DESDE_NUBE else V.filas(sql)
    return {K.base(K.host(u)) for n, f, s, c in filas for u in (f, s) if u.startswith('http')}

def excluido(h, known):
    return (not h) or K.base(h) in known or any(h == x or h.endswith('.' + x) for x in C.EXCLUIR_DOMINIOS)

def candidatos(slug, known, appname=None, fuentes=(hn, awesome)):
    kws = C.KEYWORDS_SCOUT.get(slug) or K.FUERTES[slug][:4]
    cnt = Counter()
    for kw in kws:
        if hn in fuentes: cnt.update(hn(kw))
        if appname and reliefweb in fuentes and slug in C.TEMI_UMANITARI: cnt.update({h: 2 for h in reliefweb(kw, appname)})
    if awesome in fuentes: cnt.update(awesome(slug))
    return [(h, n) for h, n in cnt.most_common() if not excluido(h, known)]

def explorar(slug, dominios, por_tema, amplia=False):
    props = []
    for h, menciones in dominios[:por_tema * 3]:
        home = f'https://{h}/'
        feeds, pag = K.descubrir(home)
        if not feeds: continue
        row = V.verifica(h, feeds[0], home, slug, amplia, con_muro=True)
        row['menciones'] = menciones
        if row['motivo'].startswith(('TRANSITORIO', 'p1')): continue
        props.append(row)
        if sum(p['p3_utiles'] >= C.UMBRAL_VOCES for p in props) >= por_tema: break
    return props

def proponer_json(rows):
    """Las mismas propuestas de proponer_sql(), para percorso.proponi_fonti.

    El .sql lo lee una persona cuando quiere entender qué salió; esto lo aplica
    el programador sin que nadie mire, que es el único modo de que la lista de
    fuentes siga mejorando después del lanzamiento.
    """
    return [{'nome': r['nome'], 'url_feed': r.get('url_nuevo') or r['url_feed'],
             'url_sito': r['url_sito'], 'metodo': 'sitemap' if str(
                 r.get('url_nuevo') or '').startswith('sitemap:') else 'rss',
             'categoria': r['categoria'], 'lingua': 'en', 'peso': 0.3}
            for r in rows if r.get('p3_utiles', 0) >= C.UMBRAL_VOCES]


def proponer_sql(rows):
    esc = lambda s: s.replace("'", "''")
    vals = [f"  ('{esc(r['nome'])}', '{esc(r.get('url_nuevo') or r['url_feed'])}', '{esc(r['url_sito'])}', 'rss', "
            f"'{r['categoria']}', 'en', 0.3, false)  -- {r['menciones']} menciones · {V.com(r['motivo'][:60])}"
            for r in rows if r.get('p3_utiles', 0) >= C.UMBRAL_VOCES]
    if not vals: return '-- sin propuestas\n'
    body = [v.replace(')  --', '),  --', 1) for v in vals[:-1]] + [vals[-1]]
    return ('insert into percorso.fonti (nome, url_feed, url_sito, metodo, categoria, lingua, peso, attiva)\nvalues\n'
            + '\n'.join(body) + '\non conflict (utente_id, url_feed) do nothing;\n')

if __name__ == '__main__':
    a = sys.argv
    K.configurar(parche='--sin-parche' not in a)
    sql = a[1] if a[1] == V.DESDE_NUBE else open(a[1]).read()
    known = conocidos(sql)
    temi = a[a.index('--temi') + 1].split(',') if '--temi' in a else list(K.FUERTES)
    por = int(a[a.index('--por-tema') + 1]) if '--por-tema' in a else 5
    app = a[a.index('--reliefweb-appname') + 1] if '--reliefweb-appname' in a else None
    fuentes = (hn, awesome, reliefweb) if app else (hn, awesome)
    todas = []
    for slug in temi:
        doms = candidatos(slug, known, app, fuentes)
        props = explorar(slug, doms, por, '--licencia-amplia' in a)
        todas += props; known |= {K.base(K.host(p['url_sito'])) for p in props}
        print(f"{slug:18} dominios {len(doms):3} · evaluados {len(props):2} · con ≥{C.UMBRAL_VOCES}/10: {sum(p['p3_utiles'] >= C.UMBRAL_VOCES for p in props)}")
    # '/dev/null' anche per il JSON: `escribir` scrive `activar.json` per
    # difetto, e quello è il file che il programmatore applica. Scriverci dentro
    # le candidate dello scouting significherebbe accendere fonti mai verificate.
    V.escribir(todas, 'candidatas.csv', '/dev/null', '/dev/null')
    for w in dict.fromkeys(AVISOS): print('AVISO', w)   # una API caída no debe parecer 'cero dominios'
    open('proponer.sql', 'w').write(proponer_sql(todas))
    with open('proponer.json', 'w', encoding='utf-8') as fh:
        json.dump(proponer_json(todas), fh, ensure_ascii=False, indent=1)
    print('-> candidatas.csv, proponer.sql, proponer.json (attiva=false; activar solo vía verifica_fonti.py)')
