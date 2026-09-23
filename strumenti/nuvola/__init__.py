# -*- coding: utf-8 -*-
"""Accesso a Supabase per la conduttura: PostgREST e Storage, solo stdlib.

    from nuvola import Nuvola, ErroreNuvola        # con strumenti/ nel sys.path
    from strumenti.nuvola import Nuvola            # dalla radice del repository

    nuvola = Nuvola()
    if nuvola.raggiungibile():
        nuvola.innesta("articoli", righe, "utente_id,url")

Il pacchetto riesporta le costanti del progetto perche' chi scrive una tabella
non debba ricopiarle: un UTENTE trascritto a mano in un secondo file e' una
riga che sparisce sotto le regole RLS senza che nessuno veda un errore.

`cliente.py` non importa nulla dal pacchetto e non usa import relativi: resta
eseguibile da solo — `python3 strumenti/nuvola/cliente.py` — e quella corsa e'
l'autoverifica senza rete che il workflow fa girare prima di toccare la nuvola.
"""
from .cliente import BASE, CHIAVE, DEPOSITO, ErroreNuvola, Nuvola, SCHEMA, UTENTE

__all__ = ["Nuvola", "ErroreNuvola", "BASE", "SCHEMA", "DEPOSITO", "UTENTE", "CHIAVE"]
