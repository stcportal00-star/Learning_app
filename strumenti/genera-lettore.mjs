#!/usr/bin/env node
/**
 * Genera il lettore PDF interno all'app:
 *   assets/lettore/lettore.html  — pdf.js di Mozilla incorporato, funziona offline
 *   assets/lettore/prova.pdf     — PDF di 2 pagine per il test di fumo su emulatore
 *
 * Perché un HTML con pdf.js e non un modulo nativo: tutto il lavoro avviene da
 * cloud e telefono, senza adb. react-native-webview è nel catalogo Expo SDK 54
 * (invariante 8); pdf.js è JavaScript puro. Nessun codice nativo di terze parti.
 *
 * Libreria e worker sono incorporati come stringhe e caricati tramite Blob URL:
 * evita il caricamento di moduli ES da file://, che Chromium blocca per CORS.
 *
 * Il worker si importa sul thread principale invece di passarlo a workerSrc.
 * Il modulo del worker termina con globalThis.pdfjsWorker = {WorkerMessageHandler};
 * importandolo qui, pdf.js trova quel gestore e non costruisce alcun Worker.
 * Con workerSrc impostato costruirebbe new Worker(blob, {type:"module"}), e un
 * Worker non parte da un documento file://: pdf.js resta in attesa del messaggio
 * "test" che non arriverà, senza sollevare nulla. È il blocco osservato nel
 * test di fumo del build 3. Costo: l'analisi del PDF avviene sul thread
 * principale, quindi un documento molto lungo può far scattare l'interfaccia.
 * Un lettore che scatta è preferibile a un lettore che non apre.
 *
 * Uso:  node strumenti/genera-lettore.mjs
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const RADICE = join(dirname(fileURLToPath(import.meta.url)), "..");
const PDFJS = join(RADICE, "node_modules/pdfjs-dist/legacy/build");
const USCITA = join(RADICE, "assets/lettore");

const lib = readFileSync(join(PDFJS, "pdf.min.mjs"), "utf8");
const worker = readFileSync(join(PDFJS, "pdf.worker.min.mjs"), "utf8");
const versione = JSON.parse(readFileSync(join(RADICE, "node_modules/pdfjs-dist/package.json"), "utf8")).version;

// Stringa JS sicura dentro <script>: JSON.stringify gestisce virgolette e
// caratteri di controllo; "</" va spezzato o il parser HTML chiuderebbe lo script.
const comeStringa = (s) => JSON.stringify(s).replace(/<\//g, "<\\/");

export const VISORE_JS = `
// pdf.js 6 chiama Promise.withResolvers in 41 punti, fra cui il gestore dei
// messaggi usato all'apertura di ogni documento. È ES2024: esiste da Chrome
// 119, e la WebView di sistema può essere più vecchia — sull'emulatore
// Android 14 del test di fumo lo è, e sul telefono dell'utente è quella che il
// Play Store ha installato, che in due mesi senza rete non si aggiorna.
// La build legacy di pdf.js porta core-js ma non questo riempitivo.
// Cinque righe, esattamente il comportamento della specifica.
if (typeof Promise.withResolvers !== "function") {
  Promise.withResolvers = function () {
    let resolve, reject;
    const promise = new Promise((sciogli, rifiuta) => { resolve = sciogli; reject = rifiuta; });
    return { promise, resolve, reject };
  };
}

(async () => {
  const invia = (m) => window.ReactNativeWebView && window.ReactNativeWebView.postMessage(JSON.stringify(m));
  const stato = document.getElementById("stato");

  // Un blocco silenzioso è il guasto peggiore: niente eccezione, niente
  // messaggio, solo un'attesa che non finisce. Il guardiano lo trasforma in un
  // errore leggibile che dice a quale passo ci si è fermati, e fa comparire il
  // ripiego sul visore del sistema invece di lasciare l'utente davanti a nulla.
  let fase = "avvio";
  let pronto = false;
  const guardiano = setTimeout(() => {
    if (pronto) return;
    const messaggio = "Impossibile aprire il PDF: bloccato al passo \\"" + fase + "\\"";
    stato.textContent = messaggio;
    invia({ tipo: "errore", messaggio });
  }, 20000);

  try {
    const blob = (s) => URL.createObjectURL(new Blob([s], { type: "text/javascript" }));
    fase = "caricamento della libreria";
    const pdfjs = await import(blob(LIB));

    // Definisce globalThis.pdfjsWorker: pdf.js userà il gestore sul thread
    // principale e non costruirà un Worker, che da file:// non partirebbe.
    fase = "caricamento del worker sul thread principale";
    await import(blob(WORKER));

    const cfg = window.PERCORSO || {};
    if (!cfg.pdf) throw new Error("nessun file indicato");

    // Nessuna richiesta a intervalli: su file:// il caricamento in un colpo solo è il più robusto.
    fase = "apertura del documento";
    const doc = await pdfjs.getDocument({ url: cfg.pdf, disableRange: true, disableStream: true }).promise;
    const n = doc.numPages;
    fase = "lettura della prima pagina";
    const prima = await doc.getPage(1);
    const vp1 = prima.getViewport({ scale: 1 });
    const contenitore = document.getElementById("pagine");
    const pagine = [];

    for (let i = 1; i <= n; i++) {
      const d = document.createElement("div");
      d.className = "pagina";
      d.dataset.n = String(i);
      d.style.aspectRatio = vp1.width + " / " + vp1.height;
      contenitore.appendChild(d);
      pagine.push(d);
    }
    pronto = true;
    clearTimeout(guardiano);
    stato.remove();
    invia({ tipo: "pronto", pagine: n });

    const disegnate = new Map();
    async function disegna(i) {
      if (disegnate.has(i)) return;
      disegnate.set(i, null);
      const p = await doc.getPage(i);
      const base = p.getViewport({ scale: 1 });
      const div = pagine[i - 1];
      div.style.aspectRatio = base.width + " / " + base.height;
      const scala = (div.clientWidth * (window.devicePixelRatio || 1)) / base.width;
      const vp = p.getViewport({ scale: scala });
      const c = document.createElement("canvas");
      c.width = Math.floor(vp.width);
      c.height = Math.floor(vp.height);
      await p.render({ canvasContext: c.getContext("2d"), viewport: vp }).promise;
      if (disegnate.has(i)) { div.replaceChildren(c); disegnate.set(i, c); }
    }
    // Memoria: su un tablet economico un PDF lungo esaurirebbe la RAM se si
    // tenessero tutte le pagine disegnate. Si liberano quelle lontane.
    function libera(corrente) {
      for (const [i] of disegnate) {
        if (Math.abs(i - corrente) > 6) { pagine[i - 1].replaceChildren(); disegnate.delete(i); }
      }
    }

    const visibili = new Map();
    let corrente = 0;
    const osservatore = new IntersectionObserver((voci) => {
      for (const v of voci) {
        const i = Number(v.target.dataset.n);
        if (v.isIntersecting) { visibili.set(i, v.intersectionRatio); disegna(i); }
        else visibili.delete(i);
      }
      let migliore = corrente, massimo = -1;
      for (const [i, r] of visibili) if (r > massimo) { massimo = r; migliore = i; }
      if (migliore && migliore !== corrente) {
        corrente = migliore;
        invia({ tipo: "pagina", n: corrente });
        libera(corrente);
      }
    }, { rootMargin: "100% 0px", threshold: [0, 0.25, 0.5, 0.75, 1] });
    pagine.forEach((p) => osservatore.observe(p));

    const iniziale = Math.min(Math.max(1, Number(cfg.pagina) || 1), n);
    if (iniziale > 1) requestAnimationFrame(() => pagine[iniziale - 1].scrollIntoView());
  } catch (e) {
    clearTimeout(guardiano);
    const messaggio = "Impossibile aprire il PDF: " + String((e && e.message) || e)
                    + " (al passo \\"" + fase + "\\")";
    stato.textContent = messaggio;
    invia({ tipo: "errore", messaggio });
  }
})();
`;

const html = `<!doctype html>
<html lang="it">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=5, user-scalable=yes">
<title>Lettore</title>
<!-- pdf.js ${versione} (Mozilla, Apache-2.0), incorporato per l'uso offline -->
<style>
  html, body { margin: 0; background: #F4F4F5; }
  #pagine { display: flex; flex-direction: column; align-items: center; gap: 8px; padding: 8px 0 40px; }
  .pagina { width: calc(100vw - 16px); background: #fff; box-shadow: 0 1px 3px rgba(0,0,0,.14); }
  .pagina canvas { display: block; width: 100%; height: auto; }
  #stato { padding: 40vh 24px 0; text-align: center; font: 14px system-ui, sans-serif; color: #71717A; }
</style>
</head>
<body>
<div id="stato">Apertura in corso…</div>
<div id="pagine"></div>
<script>
const LIB = ${comeStringa(lib)};
const WORKER = ${comeStringa(worker)};
${VISORE_JS}
</script>
</body>
</html>
`;

// ---------------------------------------------------------------- PDF di prova
// Due pagine, costruito a mano con tabella xref esatta: nessuna dipendenza.
function pdfDiProva() {
  const testi = ["Percorso - pagina 1 di 2", "Percorso - pagina 2 di 2"];
  const oggetti = [];
  oggetti.push("<< /Type /Catalog /Pages 2 0 R >>");
  oggetti.push("<< /Type /Pages /Kids [3 0 R 5 0 R] /Count 2 >>");
  const font = 7;
  testi.forEach((t, k) => {
    const pagina = 3 + k * 2;
    const flusso = `BT /F1 28 Tf 72 700 Td (${t}) Tj ET`;
    oggetti[pagina - 1] = `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents ${pagina + 1} 0 R /Resources << /Font << /F1 ${font} 0 R >> >> >>`;
    oggetti[pagina] = `<< /Length ${flusso.length} >>\nstream\n${flusso}\nendstream`;
  });
  oggetti[font - 1] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>";

  let corpo = "%PDF-1.4\n";
  const offset = [];
  oggetti.forEach((o, i) => {
    offset.push(corpo.length);
    corpo += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const xref = corpo.length;
  corpo += `xref\n0 ${oggetti.length + 1}\n0000000000 65535 f \n`;
  for (const o of offset) corpo += `${String(o).padStart(10, "0")} 00000 n \n`;
  corpo += `trailer\n<< /Size ${oggetti.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return corpo;
}

mkdirSync(USCITA, { recursive: true });
writeFileSync(join(USCITA, "lettore.html"), html);
writeFileSync(join(USCITA, "prova.pdf"), pdfDiProva(), "latin1");

console.log(`lettore.html  ${(html.length / 1024).toFixed(0)} KB  (pdf.js ${versione})`);
console.log(`prova.pdf     2 pagine`);
