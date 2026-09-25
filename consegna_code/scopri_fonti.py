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

def podcast(kw, pais=None):
    """Podcasts que hablan de esta keyword. -> [(url_feed, nombre, None)]

    La API de búsqueda de iTunes no pide clave y devuelve `feedUrl` directamente,
    que es lo único que necesitamos: el resto lo decide `verifica()`. Es la vía
    más corta a los divulgadores en otras lenguas, porque el catálogo es por país
    y el mismo término devuelve cosas distintas en cada uno.
    """
    q = urllib.parse.quote(kw)
    pais = f'&country={pais}' if pais else ''
    js = _json(f'https://itunes.apple.com/search?media=podcast&limit=20&term={q}{pais}')
    fuera = []
    for it in js.get('results', []):
        url = (it.get('feedUrl') or '').strip()
        if url.startswith('http'):
            fuera.append((url, (it.get('collectionName') or K.host(url))[:60], None))
    return fuera


def candidatos_feed(h):
    """Del dominio a los feeds que vale la pena verificar. -> [(url_feed, nombre, url_sitio)]

    El del sitio, y los de los perfiles que el sitio DECLARA suyos: el mismo
    divulgador publica en su blog y en YouTube, con ritmos distintos, y son dos
    fuentes, no una. Ninguna dirección se inventa: salen de la página que
    acabamos de descargar.
    """
    home = f'https://{h}/'
    feeds, pag = K.descubrir(home)
    fuera = [(f, h, home) for f in feeds[:1]]
    if pag is not None and pag.body:
        for p in K.perfiles(pag.body, home):
            uf, us = K.feed_de_perfil(p)
            # url_sitio es el PERFIL, no el blog: p8 compara el canal del feed
            # con el sitio, y un canal de YouTube nunca vivirá en el dominio
            # del blog.
            if uf and all(uf != x[0] for x in fuera):
                fuera.append((uf, f'{h} · {K.host(us)}', us))
    return fuera[:3]


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

def _sitio_del_feed(url_feed):
    """Para un feed suelto -un podcast de iTunes- el sitio es el que él declara."""
    _, d = K.feed(url_feed)
    enlace = (d.feed.get('link') or '').strip() if d.entries or d.feed else ''
    if enlace.startswith('http'):
        return enlace
    u = urllib.parse.urlparse(url_feed)
    return f'{u.scheme}://{u.netloc}/'


def explorar(slug, dominios, por_tema, amplia=False, sueltos=()):
    """Verifica candidatas y devuelve las que llegaron a puntuarse.

    `sueltos` son feeds que ya conocemos sin pasar por un dominio: los podcasts
    de la búsqueda de iTunes. Su sitio se pregunta al feed mismo, porque el
    dominio donde está alojado el mp3 casi nunca es el sitio del programa.
    """
    props = []
    cola = [(uf, nom, sit) for uf, nom, sit in sueltos]
    for h, menciones in dominios[:por_tema * 3]:
        cola += [(uf, nom, sit) for uf, nom, sit in candidatos_feed(h)]

    vistos = set()
    for url_feed, nombre, url_sitio in cola:
        if url_feed in vistos: continue
        vistos.add(url_feed)
        sitio = url_sitio or _sitio_del_feed(url_feed)
        row = V.verifica(nombre, url_feed, sitio, slug, amplia, con_muro=True)
        row['menciones'] = next((n for hh, n in dominios if hh == nombre), 0)
        if row['motivo'].startswith(('TRANSITORIO', 'p1')): continue
        # Sin 'p3_utiles' la fuente no llegó a puntuarse: `verifica()` sale antes
        # de p3 en cada camino de rechazo temprano -REVISAR por redirección a otro
        # dominio, entre ellos- y esa fila no es una candidata, es un aviso.
        # Caso real (corrida del 23-09): una sola fila así reventaba el scouting
        # entero con KeyError, y el programador reportaba «propuestas 0».
        if 'p3_utiles' not in row: continue
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
             # `lingua` NON e' una rilevazione: la colonna e' NOT NULL con
             # default 'en' nello schema, e qui si ripete quel default. Non
             # leggerla come un dato — contarci le fonti per lingua da' sempre
             # 'en' e fa sembrare che lo scouting non trovi niente in italiano
             # o spagnolo, anche quando ne ha trovate (verificato: le trova, e
             # cadono su p3 e p7, non sulla lingua).
             'categoria': r['categoria'], 'lingua': 'en', 'peso': 0.3}
            for r in rows if r.get('p3_utiles', 0) >= C.UMBRAL_VOCES]


def proponer_sql(rows):
    esc = lambda s: s.replace("'", "''")
    vals = [f"  ('{esc(r['nome'])}', '{esc(r.get('url_nuevo') or r['url_feed'])}', '{esc(r['url_sito'])}', 'rss', "
            # 'en' e' il default dello schema ripetuto, non una lingua misurata:
            # vedi il commento in proponer_json().
            f"'{r['categoria']}', 'en', 0.3, false)  -- {r['menciones']} menciones · {V.com(r['motivo'][:60])}"
            for r in rows if r.get('p3_utiles', 0) >= C.UMBRAL_VOCES]
    if not vals: return '-- sin propuestas\n'
    body = [v.replace(')  --', '),  --', 1) for v in vals[:-1]] + [vals[-1]]
    return ('insert into percorso.fonti (nome, url_feed, url_sito, metodo, categoria, lingua, peso, attiva)\nvalues\n'
            + '\n'.join(body) + '\non conflict (utente_id, url_feed) do nothing;\n')

def _guardar(todas):
    """Los tres ficheros de salida, escritos tras cada tema.

    '/dev/null' también para el JSON de `escribir`: por defecto escribe
    `activar.json`, que es el fichero que el programador APLICA. Meter ahí las
    candidatas del scouting significaría encender fuentes nunca verificadas.
    """
    V.escribir(todas, 'candidatas.csv', '/dev/null', '/dev/null')
    with open('proponer.sql', 'w', encoding='utf-8') as fh:
        fh.write(proponer_sql(todas))
    with open('proponer.json', 'w', encoding='utf-8') as fh:
        json.dump(proponer_json(todas), fh, ensure_ascii=False, indent=1)


if __name__ == '__main__':
    a = sys.argv
    K.configurar(parche='--sin-parche' not in a)
    sql = a[1] if a[1] == V.DESDE_NUBE else open(a[1]).read()
    known = conocidos(sql)
    temi = a[a.index('--temi') + 1].split(',') if '--temi' in a else list(K.FUERTES)
    por = int(a[a.index('--por-tema') + 1]) if '--por-tema' in a else 5
    app = a[a.index('--reliefweb-appname') + 1] if '--reliefweb-appname' in a else None
    fuentes = (hn, awesome, reliefweb) if app else (hn, awesome)
    # Los países del catálogo de iTunes: el mismo término devuelve programas
    # distintos en cada uno, y es la vía más corta a los divulgadores que no
    # publican en inglés. La lista vive en temi_config, no aquí.
    paises = list(getattr(C, 'PAESI_PODCAST', ()) or [None])
    todas = []
    for slug in temi:
        doms = candidatos(slug, known, app, fuentes)
        sueltos = []
        for kw in (C.KEYWORDS_SCOUT.get(slug) or K.FUERTES[slug][:2]):
            for pais in paises:
                sueltos += [x for x in podcast(kw, pais)
                            if not excluido(K.host(x[0]), known)]
        props = explorar(slug, doms, por, '--licencia-amplia' in a, sueltos[:12])
        todas += props; known |= {K.base(K.host(p['url_sito'])) for p in props}
        print(f"{slug:18} dominios {len(doms):3} · podcast {len(sueltos):3} · evaluados {len(props):2} · con ≥{C.UMBRAL_VOCES}/10: {sum(p['p3_utiles'] >= C.UMBRAL_VOCES for p in props)}")
        # Se escribe DESPUÉS DE CADA TEMA, no solo al final. Con diecisiete
        # temas y cuatro lenguas esta pasada roza el tope del paso, y un
        # tope alcanzado mataba el proceso antes de la única escritura: una
        # hora y media de red tirada, y el fichero vacío no se distingue de
        # «no había nada». Así lo que se ha encontrado hasta aquí ya está en
        # disco, y el paso siguiente lo propone igual.
        _guardar(todas)
    _guardar(todas)
    for w in dict.fromkeys(AVISOS): print('AVISO', w)   # una API caída no debe parecer 'cero dominios'
    print('-> candidatas.csv, proponer.sql, proponer.json (attiva=false; activar solo vía verifica_fonti.py)')
