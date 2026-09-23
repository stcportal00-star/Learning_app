// Verifica il lettore generato senza browser:
// 1. le stringhe incorporate sono intatte e caricabili come moduli ES
// 2. pdf.js incorporato apre il PDF di prova: 2 pagine, testo atteso
// 3. il codice del visore è sintatticamente valido
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
process.chdir(join(dirname(fileURLToPath(import.meta.url)), ".."));
const html = readFileSync("assets/lettore/lettore.html", "utf8");
const estrai = (nome) => {
  const m = html.match(new RegExp(`const ${nome} = ("(?:[^"\\\\]|\\\\.)*");`));
  if (!m) throw new Error(`${nome} non trovato`);
  return JSON.parse(m[1].replace(/<\\\//g, "</"));
};
const LIB = estrai("LIB"), WORKER = estrai("WORKER");
const dataUrl = (s) => "data:text/javascript;base64," + Buffer.from(s).toString("base64");

const avvisoOriginale = console.warn; console.warn = () => {};
const logOriginale = console.log;
const pdfjs = await import(dataUrl(LIB));
pdfjs.GlobalWorkerOptions.workerSrc = dataUrl(WORKER);
const dati = new Uint8Array(readFileSync("assets/lettore/prova.pdf"));
const doc = await pdfjs.getDocument({ data: dati }).promise;
console.warn = avvisoOriginale;
let ok = 0, ko = [];
const verifica = (n, c) => (c ? ok++ : ko.push(n));
verifica("pdf.js incorporato si carica come modulo ES", typeof pdfjs.getDocument === "function");
verifica("il PDF di prova ha 2 pagine", doc.numPages === 2);
for (const i of [1, 2]) {
  const t = (await (await doc.getPage(i)).getTextContent()).items.map((x) => x.str).join("");
  verifica(`pagina ${i}: testo atteso`, t.includes(`pagina ${i} di 2`));
}
const script = html.slice(html.lastIndexOf("<script>") + 8, html.lastIndexOf("</script>"));
try { new vm.Script(script); verifica("codice del visore sintatticamente valido", true); }
catch (e) { verifica("codice del visore sintatticamente valido: " + e.message, false); }
verifica("nessun </script> spurio dentro le stringhe", (html.match(/<\/script>/g) || []).length === 1);
const installata = JSON.parse(readFileSync("node_modules/pdfjs-dist/package.json", "utf8")).version;
verifica(`lettore.html generato con pdf.js ${installata} (se no: node strumenti/genera-lettore.mjs)`,
  html.includes(`pdf.js ${installata} `));
// Senza questo riempitivo il lettore non apre alcun documento sulle WebView
// anteriori a Chrome 119, e il guasto si vede solo sul dispositivo.
verifica("il visore definisce Promise.withResolvers prima di caricare pdf.js",
  html.indexOf("Promise.withResolvers = function") < html.lastIndexOf("import(blob(LIB))"));
// Il worker gira sul thread principale: un Worker non parte da file://.
// Il controllo va ristretto al nostro visore: la stringa con pdf.js contiene
// GlobalWorkerOptions.workerSrc come parte della libreria, non come assegnazione.
const visore = script.slice(script.lastIndexOf("(async () => {"));
verifica("il visore non assegna workerSrc",
  !visore.includes("GlobalWorkerOptions.workerSrc"));
verifica("il visore importa il worker sul thread principale",
  visore.includes("import(blob(WORKER))"));
console.log(`Test superati : ${ok}`);
for (const k of ko) console.log("  FALLITA: " + k);
process.exit(ko.length ? 1 : 0);
