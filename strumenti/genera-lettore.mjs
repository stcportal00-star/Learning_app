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

    // Le sottolineature: rettangoli in frazioni della pagina (0..1), così
    // valgono a qualunque larghezza e su qualunque dispositivo. Le dà l'app,
    // che le tiene come segni («evidenza») accanto al file, mai dentro.
    const COLORE = (cfg.colori && cfg.colori.evidenza) || "#F2B35B";
    const evidenze = new Map();
    function impostaEvidenze(lista) {
      evidenze.clear();
      for (const e of lista || []) {
        if (!e || !(e.pagina > 0) || !Array.isArray(e.r)) continue;
        if (!evidenze.has(e.pagina)) evidenze.set(e.pagina, []);
        evidenze.get(e.pagina).push(e);
      }
      for (const [i, c] of disegnate) if (c) disegnaEvidenze(i);
    }
    function disegnaEvidenze(i) {
      const strato = pagine[i - 1].querySelector(".evidenze");
      if (!strato) return;
      const pezzi = [];
      for (const e of evidenze.get(i) || []) {
        for (const q of e.r) {
          if (!Array.isArray(q) || q.length !== 4) continue;
          const s = document.createElement("div");
          s.className = "evidenza";
          s.style.left = q[0] * 100 + "%";
          s.style.top = q[1] * 100 + "%";
          s.style.width = q[2] * 100 + "%";
          s.style.height = q[3] * 100 + "%";
          s.style.background = COLORE + "55";
          s.style.borderBottom = "2px solid " + COLORE;
          pezzi.push(s);
        }
      }
      strato.replaceChildren(...pezzi);
    }

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
      if (!disegnate.has(i)) return;
      // Sopra il disegno, nell'ordine: le sottolineature, poi il testo
      // trasparente di pdf.js, che è ciò che si seleziona col dito. Senza il
      // livello di testo un PDF è un'immagine: niente da selezionare, niente
      // da sottolineare.
      const strato = document.createElement("div");
      strato.className = "evidenze";
      const testo = document.createElement("div");
      testo.className = "textLayer";
      const css = div.clientWidth / base.width;
      testo.style.setProperty("--total-scale-factor", String(css));
      div.replaceChildren(c, strato, testo);
      disegnate.set(i, c);
      disegnaEvidenze(i);
      try {
        await new pdfjs.TextLayer({
          textContentSource: p.streamTextContent(),
          container: testo,
          viewport: p.getViewport({ scale: css }),
        }).render();
      } catch (e) {
        // Una pagina senza testo (una scansione) resta leggibile: solo non si
        // sottolinea.
      }
    }

    // La selezione si legge a riposo: mentre il dito trascina le maniglie
    // gli eventi arrivano a decine.
    let attesa = null;
    let selezionato = "";
    document.addEventListener("selectionchange", () => {
      clearTimeout(attesa);
      attesa = setTimeout(leggiSelezione, 250);
    });
    function leggiSelezione() {
      const sel = document.getSelection();
      const testo = sel && !sel.isCollapsed ? sel.toString().replace(/\\s+/g, " ").trim() : "";
      if (!testo) {
        if (selezionato) { selezionato = ""; invia({ tipo: "selezione", testo: "" }); }
        return;
      }
      const range = sel.getRangeAt(0);
      const nodo = range.startContainer.nodeType === 1 ? range.startContainer : range.startContainer.parentElement;
      const pag = nodo && nodo.closest ? nodo.closest(".pagina") : null;
      if (!pag) return;
      const r = rettangoli(range, pag);
      if (!r.length) return;
      selezionato = testo;
      invia({ tipo: "selezione", testo: testo.slice(0, 2000), pagina: Number(pag.dataset.n), r });
    }
    // I rettangoli della selezione sulla pagina dove comincia, in frazioni
    // della pagina, uniti per riga: una riga di dieci parole sono dieci
    // rettangoli per il browser e uno solo per chi la rilegge.
    function rettangoli(range, pag) {
      const box = pag.getBoundingClientRect();
      const grezzi = [];
      for (const q of range.getClientRects()) {
        const x0 = Math.max(q.left, box.left), x1 = Math.min(q.right, box.right);
        const y0 = Math.max(q.top, box.top), y1 = Math.min(q.bottom, box.bottom);
        if (x1 - x0 < 1 || y1 - y0 < 1) continue;
        grezzi.push([(x0 - box.left) / box.width, (y0 - box.top) / box.height,
                     (x1 - x0) / box.width, (y1 - y0) / box.height]);
      }
      // Prima le righe: il browser dà per ogni pezzo due rettangoli (il
      // riquadro dell'elemento e quello del testo) con altezze appena diverse,
      // e i pezzi di una riga non arrivano in ordine. Poi, dentro la riga, si
      // uniscono i pezzi separati da meno di un ventesimo di pagina: lo spazio
      // fra due parole di un PDF vero arriva a tre centesimi, il margine fra
      // due colonne di solito no.
      grezzi.sort((a, b) => a[1] - b[1]);
      const righe = [];
      for (const q of grezzi) {
        const riga = righe.find((g) => Math.abs(g.y - q[1]) < Math.min(g.h, q[3]) / 2);
        if (riga) riga.pezzi.push(q);
        else righe.push({ y: q[1], h: q[3], pezzi: [q] });
      }
      const uniti = [];
      for (const riga of righe) {
        riga.pezzi.sort((a, b) => a[0] - b[0]);
        let u = null;
        for (const q of riga.pezzi) {
          if (u && q[0] <= u[0] + u[2] + 0.05) {
            const x1 = Math.max(u[0] + u[2], q[0] + q[2]);
            const y0 = Math.min(u[1], q[1]), y1 = Math.max(u[1] + u[3], q[1] + q[3]);
            u[2] = x1 - u[0]; u[1] = y0; u[3] = y1 - y0;
          } else {
            u = q.slice();
            uniti.push(u);
          }
        }
      }
      return uniti.slice(0, 200).map((q) => q.map((v) => Math.round(v * 10000) / 10000));
    }

    // Ciò che l'app chiama da fuori, con injectJavaScript.
    window.percorsoEvidenze = impostaEvidenze;
    window.percorsoVaiA = (n) => { const d = pagine[n - 1]; if (d) d.scrollIntoView(); };
    window.percorsoTogliSelezione = () => {
      const s = document.getSelection();
      if (s) s.removeAllRanges();
    };
    impostaEvidenze(cfg.evidenze);
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
  html, body { margin: 0; background: #000000; }
  #pagine { display: flex; flex-direction: column; align-items: center; gap: 8px; padding: 8px 0 40px; }
  .pagina { position: relative; width: calc(100vw - 16px); background: #fff; }
  .pagina canvas { display: block; width: 100%; height: auto; }
  /* Le regole di pdf.js per il livello di testo, senza annidamento: il CSS
     annidato di pdf_viewer.css non lo capiscono le WebView prima di Chrome
     112, e il telefono in viaggio non si aggiorna. */
  .evidenze { position: absolute; inset: 0; pointer-events: none; z-index: 1; }
  .evidenza { position: absolute; border-radius: 2px; }
  .textLayer { position: absolute; inset: 0; width: 100% !important; height: 100% !important;
               overflow: hidden; line-height: 1; text-align: initial; z-index: 2;
               -webkit-text-size-adjust: none; text-size-adjust: none; transform-origin: 0 0;
               --min-font-size: 1;
               --text-scale-factor: calc(var(--total-scale-factor) * var(--min-font-size));
               --min-font-size-inv: calc(1 / var(--min-font-size)); }
  .textLayer span, .textLayer br { color: transparent; position: absolute; white-space: pre;
               cursor: text; transform-origin: 0% 0%; -webkit-user-select: text; user-select: text; }
  .textLayer > :not(.markedContent), .textLayer .markedContent span:not(.markedContent) {
               z-index: 1; --font-height: 0;
               font-size: calc(var(--text-scale-factor) * var(--font-height));
               --scale-x: 1; --rotate: 0deg;
               transform: rotate(var(--rotate)) scaleX(var(--scale-x)) scale(var(--min-font-size-inv)); }
  .textLayer .markedContent { display: contents; }
  .textLayer span[role="img"] { -webkit-user-select: none; user-select: none; cursor: default; }
  .textLayer ::selection { background: rgba(0, 90, 255, 0.3); }
  .textLayer br::selection { background: transparent; }
  .textLayer .endOfContent { display: block; position: absolute; inset: 100% 0 0; z-index: 0;
               cursor: default; -webkit-user-select: none; user-select: none; }
  .textLayer.selecting .endOfContent { top: 0; }
  #stato { padding: 40vh 24px 0; text-align: center; font: 14px system-ui, sans-serif; color: #A1A1AA; }
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
