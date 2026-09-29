"""Programador de la verificación de fuentes: decide qué hacer con cada código de salida.

    python3 programma_fonti.py --da-nuvola [--lavoro DIR] [--senza-applicare]
    python3 programma_fonti.py fonti_v4.sql [--lavoro DIR]      # desde la semilla

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
PROPONER = 'proponer.json'
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


def _fuente(sql):
    """`--da-nuvola` es una bandera, no una ruta: no se le pone prefijo."""
    return sql if sql.startswith('-') else os.path.abspath(sql)


def verificar_real(sql, lavoro):
    """Ejecuta verifica_fonti.py en la carpeta de trabajo y devuelve su código."""
    return subprocess.run(
        [sys.executable, os.path.join(QUI, 'verifica_fonti.py'), _fuente(sql)],
        cwd=lavoro, check=False).returncode


def descubrir_real(temas, sql, lavoro):
    """Scouting por keyword para los temas sin ninguna fuente. Escribe proponer.*."""
    return subprocess.run(
        [sys.executable, os.path.join(QUI, 'scopri_fonti.py'), _fuente(sql),
         '--temi', ','.join(temas)],
        cwd=lavoro, check=False).returncode


def _nuvola():
    sys.path.insert(0, os.path.join(os.path.dirname(QUI), 'strumenti', 'nuvola'))
    import cliente
    return cliente.Nuvola()


def aplicar_real(cambios):
    """Una sola transacción: percorso.applica_fonti(jsonb) o nada.

    Veinte PATCH de PostgREST son veinte transacciones, y si la décima falla la
    tabla queda como nadie decidió. La función de la 004 recibe DATOS, nunca SQL.
    """
    return _nuvola().chiama('applica_fonti', {'cambi': cambios})


def proponer_real(propuestas):
    """Las candidatas del scouting entran en la tabla APAGADAS, con peso 0,3.

    Es la pata que hace que la lista mejore sola: sin esto, `proponer.sql` queda
    en un archivo que alguien tendría que abrir, y después del lanzamiento no hay
    ese alguien. Encenderlas no es cosa de aquí: lo decide la verificación de la
    semana siguiente, que es la única que las mira de verdad.
    """
    return _nuvola().chiama('proponi_fonti', {'nuove': propuestas})


def avisar_real(texto):
    """El canal es el resumen del job: es lo que el usuario lee desde el teléfono."""
    print(texto, file=sys.stderr)
    resumen = os.environ.get('GITHUB_STEP_SUMMARY')
    if resumen:
        with open(resumen, 'a', encoding='utf-8') as fh:
            fh.write('\n## Fuentes\n\n' + texto + '\n')


def _en_seco(cambios):
    """Marcha en seco: calcula, enseña los primeros tres, y no toca `percorso`."""
    print('EN SECO: %d cambios NO aplicados. Los primeros tres: %s'
          % (len(cambios), json.dumps(cambios[:3], ensure_ascii=False)))


def _proponer(lavoro, proponer):
    """Mete en la tabla lo que el scouting acaba de escribir, y borra el archivo.

    Borrarlo importa: si la corrida siguiente lo encontrara ahí, volvería a
    proponer las mismas y el `on conflict do nothing` lo taparía sin decir nada.
    """
    camino = os.path.join(lavoro, PROPONER)
    propuestas = _leer(camino, [])
    if not propuestas:
        return 0
    proponer(propuestas)
    try:
        os.remove(camino)
    except OSError:
        pass
    return len(propuestas)


def programar(sql, lavoro, verificar=verificar_real, aplicar=aplicar_real,
              descubrir=descubrir_real, avisar=avisar_real, proponer=proponer_real):
    """-> dict con lo que se hizo. No levanta: un programador que levanta no programa."""
    camino_estado = os.path.join(lavoro, ESTADO)
    est = _leer(camino_estado, {})
    seguidos = int(est.get('disyuntores_seguidos') or 0)

    codigo = verificar(sql, lavoro)
    hecho = {'codigo': codigo, 'aplicados': 0, 'temas': [], 'propuestas': 0,
             'aviso': '', 'disyuntores_seguidos': seguidos}

    if codigo in (0, 2):
        seguidos = 0
        cambios = _leer(os.path.join(lavoro, ACTIVAR), [])
        if cambios:
            aplicar(cambios)
            hecho['aplicados'] = len(cambios)
        if codigo == 2:
            temas = temas_sin_fuentes(_texto(os.path.join(lavoro, SALUD)))
            if temas:
                fallo = descubrir(temas, sql, lavoro)
                hecho['temas'] = temas
                hecho['propuestas'] = _proponer(lavoro, proponer)
                # Un scouting que revienta y un scouting que no encuentra nada
                # escriben el mismo «propuestas 0». La diferencia es que el
                # primero deja muerta la pata que hace mejorar la lista, y sin
                # esta línea nadie se entera nunca. Corrida real del 23-09:
                # KeyError en explorar(), y el informe decía 0 tan tranquilo.
                if fallo:
                    hecho['aviso'] = (
                        'El scouting ha salido con %s: las propuestas de este mes '
                        'no existen, y no es que no haya candidatas. Mira el log '
                        'del paso. La verificación sí se ha aplicado.' % fallo)
                    avisar(hecho['aviso'])
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
    # Lo usa el paso mensual: mete en la tabla, APAGADAS, las candidatas que
    # `scopri_fonti.py` acaba de escribir. Sin esto `proponer.json` se queda en
    # un archivo, y después del lanzamiento no hay nadie que lo abra.
    if argv and argv[0] == '--proponi':
        destino = argv[1] if len(argv) > 1 and not argv[1].startswith('-') else os.getcwd()
        n = _proponer(destino, _en_seco if '--senza-applicare' in argv else proponer_real)
        print('proposte inserite (spente): %d' % n)
        sys.exit(0)
    if not argv or (argv[0].startswith('-') and argv[0] != '--da-nuvola'):
        sys.exit(__doc__)
    sql = argv[0]
    lavoro = argv[argv.index('--lavoro') + 1] if '--lavoro' in argv else os.getcwd()
    os.makedirs(lavoro, exist_ok=True)
    # Marcha en seco a petición: calcula y escribe el informe, y no toca
    # `percorso`. NO es el modo por defecto — un sistema que después del
    # lanzamiento espera que alguien le dé permiso es un sistema parado.
    seco = '--senza-applicare' in argv
    r = programar(sql, lavoro,
                  aplicar=_en_seco if seco else aplicar_real,
                  proponer=_en_seco if seco else proponer_real)
    print('codigo %(codigo)s · aplicados %(aplicados)d · propuestas %(propuestas)d · '
          'temas %(temas)s · disyuntores seguidos %(disyuntores_seguidos)d' % r)
    # Rojo solo cuando hace falta una persona: un job que se pone rojo todas las
    # semanas por una caída de red deja de leerse en tres semanas.
    sys.exit(1 if r['aviso'] else 0)
