"""Programador de la verificación de fuentes: decide qué hacer con cada código de salida.

    python3 programma_fonti.py fonti_v4.sql [--lavoro DIR] [--senza-applicare]

`verifica_fonti.py` mira y escribe un informe; NO toca la base. Quien decide es
esto, y decide poco a propósito:

    0  aplicar activar.json
    2  aplicar activar.json y lanzar el scouting para los temas con ⚠️ en salud.md
    3  NO aplicar nada; reintentar en la corrida siguiente; al tercer 3 seguido, avisar
    1  avisar y no aplicar (error de uso: el formato del .sql no se reconoce)

El 3 es el caso que justifica todo el archivo. El disyuntor salta cuando el
entorno está roto -proxy, IP bloqueada, red caída- y entonces media lista de
fuentes parece muerta. Aplicar esa lista apagaría fuentes sanas, y volver a
encenderlas exige saber cuáles eran: nadie lo sabrá dentro de un mes. Así que
con 3 no se escribe nada, ni una fila.

La carpeta de trabajo DEBE persistir entre corridas: ahí viven
`estado_verifica.json` (fallos transitorios seguidos por fuente, y cuántas
fuentes se aceptaron la vez anterior, que es la base del disyuntor de caída) y
`programma_fonti.json` (cuántos disyuntores llevamos seguidos). Sin persistencia
el disyuntor de caída no tiene con qué comparar y nunca salta, que es peor que
no tenerlo: da la impresión de una protección que no existe.
"""
import json
import os
import subprocess
import sys

QUI = os.path.dirname(os.path.abspath(__file__))
ESTADO = 'programma_fonti.json'
ACTIVAR = 'activar.json'
SALUD = 'salud.md'

# Tres corridas seguidas con el disyuntor puesto ya no son la red del día: es el
# entorno, y alguien tiene que mirarlo. Con la verificación semanal son tres
# semanas, que es mucho — pero avisar antes significaría avisar por una caída de
# red de un martes, y un aviso que se repite es un aviso que se ignora.
MAX_DISYUNTOR = 3


def temas_sin_fuentes(salud):
    """Los temas marcados ⚠️ en la tabla de salud.md: cero fuentes aceptadas."""
    fuera = []
    for linea in (salud or '').splitlines():
        if not linea.startswith('|') or '⚠️' not in linea:
            continue
        celdas = [c.strip() for c in linea.strip().strip('|').split('|')]
        if celdas and celdas[0] and celdas[0] != 'tema':
            fuera.append(celdas[0])
    return fuera


def _leer(path, si_falta):
    try:
        with open(path, encoding='utf-8') as fh:
            return json.load(fh)
    except (OSError, ValueError):
        return si_falta


def _texto(path):
    try:
        with open(path, encoding='utf-8') as fh:
            return fh.read()
    except OSError:
        return ''


def verificar_real(sql, lavoro):
    """Ejecuta verifica_fonti.py en la carpeta de trabajo y devuelve su código."""
    return subprocess.run(
        [sys.executable, os.path.join(QUI, 'verifica_fonti.py'), os.path.abspath(sql)],
        cwd=lavoro, check=False).returncode


def descubrir_real(temas, sql, lavoro):
    """Scouting por keyword para los temas sin ninguna fuente. Escribe proponer.sql."""
    return subprocess.run(
        [sys.executable, os.path.join(QUI, 'scopri_fonti.py'), os.path.abspath(sql),
         '--temi', ','.join(temas)],
        cwd=lavoro, check=False).returncode


def aplicar_real(cambios):
    """Una sola transacción: percorso.applica_fonti(jsonb) o nada.

    Veinte PATCH de PostgREST son veinte transacciones, y si la décima falla la
    tabla queda como nadie decidió. La función de la 004 recibe DATOS, nunca SQL.
    """
    sys.path.insert(0, os.path.join(os.path.dirname(QUI), 'strumenti', 'nuvola'))
    import cliente
    return cliente.Nuvola().chiama('applica_fonti', {'cambi': cambios})


def avisar_real(texto):
    """El canal es el resumen del job: es lo que el usuario lee desde el teléfono."""
    print(texto, file=sys.stderr)
    resumen = os.environ.get('GITHUB_STEP_SUMMARY')
    if resumen:
        with open(resumen, 'a', encoding='utf-8') as fh:
            fh.write('\n## Fuentes\n\n' + texto + '\n')


def programar(sql, lavoro, verificar=verificar_real, aplicar=aplicar_real,
              descubrir=descubrir_real, avisar=avisar_real):
    """-> dict con lo que se hizo. No levanta: un programador que levanta no programa."""
    camino_estado = os.path.join(lavoro, ESTADO)
    est = _leer(camino_estado, {})
    seguidos = int(est.get('disyuntores_seguidos') or 0)

    codigo = verificar(sql, lavoro)
    hecho = {'codigo': codigo, 'aplicados': 0, 'temas': [], 'aviso': '',
             'disyuntores_seguidos': seguidos}

    if codigo in (0, 2):
        seguidos = 0
        cambios = _leer(os.path.join(lavoro, ACTIVAR), [])
        if cambios:
            aplicar(cambios)
            hecho['aplicados'] = len(cambios)
        if codigo == 2:
            temas = temas_sin_fuentes(_texto(os.path.join(lavoro, SALUD)))
            if temas:
                descubrir(temas, sql, lavoro)
                hecho['temas'] = temas
    elif codigo == 3:
        # Ni se lee activar.json: el archivo está vacío por diseño, y leerlo
        # daría a entender que hay un caso en que sí se aplicaría.
        seguidos += 1
        if seguidos >= MAX_DISYUNTOR:
            hecho['aviso'] = (
                'Disyuntor puesto %d corridas seguidas: ya no es la red de un día. '
                'Mira salud.md y la red del runner; la base no ha cambiado.' % seguidos)
            avisar(hecho['aviso'])
    else:
        # El 1 es un error de uso, no del entorno: no toca la cuenta de
        # disyuntores, que si no una corrida mal invocada borraría la señal.
        hecho['aviso'] = ('verifica_fonti.py ha salido con %d: el formato de %s no se '
                          'reconoce. No se ha aplicado nada.' % (codigo, sql))
        avisar(hecho['aviso'])

    hecho['disyuntores_seguidos'] = seguidos
    est['disyuntores_seguidos'] = seguidos
    with open(camino_estado, 'w', encoding='utf-8') as fh:
        json.dump(est, fh, indent=1)
    return hecho


if __name__ == '__main__':
    argv = sys.argv[1:]
    # Lo usa el workflow mensual: los temas con ⚠️ en salud.md, en una línea.
    # Un here-doc de Python dentro de un `run:` de YAML rompe el bloque en
    # cuanto el terminador queda en la columna cero, y eso no lo ve nadie hasta
    # que el workflow no arranca.
    if argv and argv[0] == '--temi-scoperti':
        camino = argv[1] if len(argv) > 1 else SALUD
        print(','.join(temas_sin_fuentes(_texto(camino))))
        sys.exit(0)
    if not argv or argv[0].startswith('-'):
        sys.exit(__doc__)
    sql = argv[0]
    lavoro = argv[argv.index('--lavoro') + 1] if '--lavoro' in argv else os.getcwd()
    os.makedirs(lavoro, exist_ok=True)
    # Marcha en seco: calcula y escribe el informe, pero no toca `percorso`. Es el
    # modo por defecto del workflow hasta que el usuario arma la variable, porque
    # la primera escritura real en una base que nadie vigila es decisión suya.
    seco = '--senza-applicare' in argv
    def _en_seco(cambios):
        print('EN SECO: %d cambios NO aplicados. Los primeros tres: %s'
              % (len(cambios), json.dumps(cambios[:3], ensure_ascii=False)))
    r = programar(sql, lavoro, aplicar=_en_seco if seco else aplicar_real)
    print('codigo %(codigo)s · aplicados %(aplicados)d · temas %(temas)s · '
          'disyuntores seguidos %(disyuntores_seguidos)d' % r)
    # Rojo solo cuando hace falta una persona: un job que se pone rojo todas las
    # semanas por una caída de red deja de leerse en tres semanas.
    sys.exit(1 if r['aviso'] else 0)
