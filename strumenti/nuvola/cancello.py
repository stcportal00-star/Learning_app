#!/usr/bin/env python3
"""
Decide se questa è la corsa delle otto di mattina.

Il requisito è un'ora locale, non un'ora UTC: le 08:00 di Città del Messico
fino al 2 ottobre 2026, le 08:00 di Roma da lì in poi. GitHub Actions accetta
solo cron in UTC e non sa niente dei fusi né dell'ora legale, quindi si
accendono tutte e tre le ore UTC che in qualche configurazione dell'anno
valgono le 08:00 locali, e questo modulo chiude le due che non servono.

Sta in un file suo e non dentro il workflow per una ragione sola: così si può
PROVARE. Un cancello sbagliato non fa rumore — la rassegna semplicemente non
esce, e ce ne si accorge dopo giorni, in viaggio, quando è tardi.

Si ragiona sull'ora NOMINALE del cron, non su quella reale. GitHub fa partire i
lavori pianificati con ritardi che nelle ore affollate superano l'ora: con
l'ora reale un ritardo di dieci minuti sul cron delle 06:00 darebbe le 09:0x a
Roma, nessuno dei tre cancelli si aprirebbe, e la giornata sarebbe persa in
silenzio.
"""
import argparse
import os
import sys
from datetime import date, datetime, time, timedelta, timezone
from zoneinfo import ZoneInfo

# Il giorno in cui l'utente si sposta dal Messico all'Italia.
CAMBIO = date(2026, 10, 2)

MESSICO = "America/Mexico_City"
ROMA = "Europe/Rome"

# Le tre ore UTC accese in .github/workflows/nuvola.yml. Stanno qui perché la
# verifica possa provarle tutte: se il workflow ne aggiunge o toglie una e
# questo elenco resta indietro, la prova se ne accorge.
CRON = ("0 14 * * *", "0 6 * * *", "0 7 * * *")

ORA_LOCALE_VOLUTA = 8


def ora_nominale(adesso, cron):
    """
    L'istante che il cron INTENDEVA, non quello in cui il runner si è mosso.
    Un cron illeggibile o assente fa ricadere sull'ora reale, che è la
    risposta onesta quando non si sa che corsa sia.
    """
    pezzi = (cron or "").split()
    if len(pezzi) < 2:
        return adesso, False
    try:
        minuto, ora = int(pezzi[0]), int(pezzi[1])
    except ValueError:
        return adesso, False
    if not (0 <= minuto < 60 and 0 <= ora < 24):
        return adesso, False
    return adesso.replace(hour=ora, minute=minuto, second=0, microsecond=0), True


def decidi(adesso, cron=""):
    """
    Restituisce (esegui, fuso, ora_locale, riferimento_utc).

    `adesso` deve essere consapevole del fuso (UTC). Non si legge l'orologio
    qui dentro: è ciò che rende questo modulo provabile su mille giorni senza
    aspettarli.
    """
    riferimento, _nominale = ora_nominale(adesso, cron)
    fuso = ZoneInfo(MESSICO if riferimento.date() < CAMBIO else ROMA)
    locale = riferimento.astimezone(fuso)
    return locale.hour == ORA_LOCALE_VOLUTA, fuso, locale, riferimento


def giorni_fra(da, a):
    g = da
    while g <= a:
        yield g
        g += timedelta(days=1)


def quante_corse(giorno):
    """
    Quante delle tre ore accese aprono il cancello in questo giorno UTC.
    Deve essere sempre UNA: zero significa una giornata persa, due significa
    la rassegna fatta due volte e il catalogo interrogato il doppio.
    """
    aperte = []
    for cron in CRON:
        adesso = datetime.combine(giorno, time(0, 0), tzinfo=timezone.utc)
        esegui, fuso, locale, _ = decidi(adesso, cron)
        if esegui:
            aperte.append((cron, fuso.key, locale))
    return aperte


def principale(argv=None):
    p = argparse.ArgumentParser(description="Il cancello dell'orario.")
    p.add_argument("--cron", default=os.environ.get("CRON", ""))
    p.add_argument("--uscita", default=os.environ.get("GITHUB_OUTPUT", ""))
    a = p.parse_args(argv)

    adesso = datetime.now(timezone.utc)
    esegui, fuso, locale, riferimento = decidi(adesso, a.cron)

    print("Cron acceso:  %s" % (a.cron or "(nessuno)"))
    print("Adesso:       %s UTC" % adesso.strftime("%Y-%m-%d %H:%M"))
    print("Riferimento:  %s UTC" % riferimento.strftime("%Y-%m-%d %H:%M"))
    print("Fuso scelto:  %s" % fuso.key)
    print("Ora locale:   %s" % locale.strftime("%Y-%m-%d %H:%M %Z"))
    print("Esecuzione:   %s" % (
        "SI, sono le %02d locali" % ORA_LOCALE_VOLUTA if esegui
        else "NO, non sono le %02d locali" % ORA_LOCALE_VOLUTA))

    if a.uscita:
        with open(a.uscita, "a", encoding="utf-8") as f:
            f.write("esegui=%s\n" % ("si" if esegui else "no"))
    return 0


if __name__ == "__main__":
    sys.exit(principale())
