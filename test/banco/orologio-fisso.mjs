/**
 * Inchioda l'orologio a un istante, per le prove che dipendono dall'ora.
 *
 *   OROLOGIO_FISSO=$(node -e "console.log(Date.parse('2026-09-22T09:00:00Z'))") \
 *   NODE_OPTIONS="--import=./test/banco/orologio-fisso.mjs" node test/simulazione/X.mjs
 *
 * Va bene anche per una prova che si riavvia da sé: NODE_OPTIONS è una
 * variabile d'ambiente e il processo figlio la eredita, mentre `--import`
 * sulla riga di comando no.
 *
 * Serve perché una prova che passa la mattina e fallisce la sera non è una
 * prova: è un rumore che insegna a ignorare il rosso. Chi la inchioda deve
 * però dire ANCHE cosa succede all'ora che rompe, o il difetto sparisce dalla
 * vista invece che dal codice — vedi `verifica.sh` e DA-FARE.md.
 *
 * `new Date(...)` con argomenti resta quello vero: si inchioda solo l'ADESSO.
 */
const FISSO = Number(process.env.OROLOGIO_FISSO);
if (!Number.isFinite(FISSO)) {
  throw new Error(
    "OROLOGIO_FISSO deve essere un istante in millisecondi. " +
      'Esempio: OROLOGIO_FISSO=$(node -e "console.log(Date.parse(\'2026-09-22T09:00:00Z\'))")'
  );
}

const Vero = Date;

function Falso(...argomenti) {
  // Senza `new` Date() restituisce una stringa: va lasciata al vero Date,
  // altrimenti si perde il comportamento e non si guadagna niente.
  if (!new.target) return Vero(...argomenti);
  return argomenti.length ? new Vero(...argomenti) : new Vero(FISSO);
}

Falso.prototype = Vero.prototype;
Falso.now = () => FISSO;
Falso.parse = Vero.parse;
Falso.UTC = Vero.UTC;

globalThis.Date = Falso;
