// Il lettore in un browser vero (Chromium, con Playwright): il livello di
// testo, la selezione che diventa una sottolineatura, le sottolineature
// disegnate sulle pagine.
//
// Esiste perché `lettore.verifica.mjs` gira senza browser: dice che pdf.js
// apre il PDF, non che il dito può selezionare una riga. Quella parte vive
// solo dentro la WebView, ed è proprio la parte che mancava.
//
// Playwright non è una dipendenza del progetto: se non c'è, la prova si salta
// e lo dice. Nelle sessioni cloud c'è, con Chromium già installato.
import { execSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const RADICE = join(dirname(fileURLToPath(import.meta.url)), "..");

async function playwright() {
  try {
    return await import("playwright");
  } catch {
    try {
      const globale = execSync("npm root -g", { encoding: "utf8" }).trim();
      return createRequire(join(globale, "x.js"))("playwright");
    } catch {
      return null;
    }
  }
}

/**
 * Un PDF di una pagina con due righe, ciascuna scritta in due pezzi: pdf.js ne
 * fa più elementi per riga, e il browser più rettangoli per riga. È il caso
 * di ogni PDF vero, e quello che l'unione per riga deve sistemare.
 */
function pdfDueRighe() {
  const flusso = "BT /F1 24 Tf 72 700 Td (Prima) Tj 90 0 Td (riga) Tj ET " +
                 "BT /F1 24 Tf 72 640 Td (Seconda) Tj 120 0 Td (riga) Tj ET";
  const oggetti = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
    `<< /Length ${flusso.length} >>\nstream\n${flusso}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  let corpo = "%PDF-1.4\n";
  const offset = [];
  oggetti.forEach((o, i) => { offset.push(corpo.length); corpo += `${i + 1} 0 obj\n${o}\nendobj\n`; });
  const xref = corpo.length;
  corpo += `xref\n0 ${oggetti.length + 1}\n0000000000 65535 f \n`;
  for (const o of offset) corpo += `${String(o).padStart(10, "0")} 00000 n \n`;
  corpo += `trailer\n<< /Size ${oggetti.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  const via = join(mkdtempSync(join(tmpdir(), "lettore-")), "due-righe.pdf");
  writeFileSync(via, corpo, "latin1");
  return via;
}

const pw = await playwright();
if (!pw) {
  console.log("Verifiche saltate: Playwright non installato");
  process.exit(0);
}

let ok = 0;
const ko = [];
const verifica = (nome, condizione, extra = "") => (condizione ? ok++ : ko.push(nome + (extra ? " — " + extra : "")));

// Come la WebView dell'app con allowFileAccessFromFileURLs: il lettore è un
// file:// che legge un PDF file://.
const browser = await pw.chromium.launch({ args: ["--allow-file-access-from-files"] });
try {
  const pagina = await browser.newPage({ viewport: { width: 412, height: 860 } });
  const pdf = pathToFileURL(join(RADICE, "assets/lettore/prova.pdf")).href;
  const evidenzaIniziale = { id: "e0", pagina: 2, r: [[0.1, 0.2, 0.5, 0.03]] };
  await pagina.addInitScript(([pdf, iniziale]) => {
    window.PERCORSO = { pdf, pagina: 1, evidenze: [iniziale], colori: { evidenza: "#F2B35B" } };
    window.__messaggi = [];
    window.ReactNativeWebView = { postMessage: (s) => window.__messaggi.push(JSON.parse(s)) };
  }, [pdf, evidenzaIniziale]);
  await pagina.goto(pathToFileURL(join(RADICE, "assets/lettore/lettore.html")).href);

  const messaggi = () => pagina.evaluate(() => window.__messaggi);
  await pagina.waitForFunction(() => window.__messaggi.some((m) => m.tipo === "pronto" || m.tipo === "errore"),
    null, { timeout: 30000 });
  const pronto = (await messaggi()).find((m) => m.tipo === "pronto");
  verifica("il lettore si apre", pronto && pronto.pagine === 2, JSON.stringify(await messaggi()));

  // Le sottolineature salvate si disegnano quando la pagina arriva, non solo
  // quando l'app manda la lista: una pagina lontana si disegna dopo, e una
  // liberata per la memoria si ridisegna da capo.
  await pagina.evaluate(() => window.percorsoVaiA(2));
  await pagina.waitForSelector('.pagina[data-n="2"] .textLayer span', { timeout: 15000 }).catch(() => {});
  const allArrivo = await pagina.$$eval('.pagina[data-n="2"] .evidenze .evidenza', (d) => d.length);
  verifica("una sottolineatura salvata compare quando la sua pagina si disegna", allArrivo === 1, String(allArrivo));
  await pagina.evaluate(() => window.percorsoVaiA(1));

  // Il livello di testo: lo stesso testo del PDF, in elementi selezionabili.
  await pagina.waitForSelector('.pagina[data-n="1"] .textLayer span', { timeout: 15000 });
  const testo1 = await pagina.$eval('.pagina[data-n="1"] .textLayer', (t) => t.textContent);
  verifica("la pagina 1 ha il livello di testo con il suo testo", testo1.includes("pagina 1 di 2"), testo1);

  // Il testo trasparente sta sopra la scritta disegnata: la prima riga del
  // PDF (y = 700 su 842, corpo 28) cade nel primo sesto della pagina.
  const posto = await pagina.$eval('.pagina[data-n="1"]', (p) => {
    const s = p.querySelector(".textLayer span").getBoundingClientRect();
    const b = p.getBoundingClientRect();
    return { y: (s.top - b.top) / b.height, x: (s.left - b.left) / b.width };
  });
  verifica("e sta dove sta la scritta", posto.y > 0.08 && posto.y < 0.2 && posto.x > 0.08 && posto.x < 0.16,
    JSON.stringify(posto));

  // Selezionare come farebbe il dito: un intervallo sul testo della riga.
  await pagina.evaluate(() => {
    const span = document.querySelector('.pagina[data-n="1"] .textLayer span');
    const r = document.createRange();
    r.selectNodeContents(span);
    const s = document.getSelection();
    s.removeAllRanges();
    s.addRange(r);
  });
  await pagina.waitForFunction(() => window.__messaggi.some((m) => m.tipo === "selezione" && m.testo),
    null, { timeout: 5000 }).catch(() => {});
  const sel = (await messaggi()).filter((m) => m.tipo === "selezione" && m.testo).pop();
  verifica("la selezione arriva all'app con il testo e la pagina",
    sel && sel.testo === "Percorso - pagina 1 di 2" && sel.pagina === 1, JSON.stringify(sel));
  const rett = (sel && sel.r) || [];
  verifica("e con un rettangolo per la riga, in frazioni della pagina",
    rett.length === 1 && rett[0].every((v) => v >= 0 && v <= 1)
    && Math.abs(rett[0][1] - posto.y) < 0.03, JSON.stringify(rett));

  // Disegnata: tanti segni quanti rettangoli, sulla pagina giusta.
  await pagina.evaluate(([r, iniziale]) => window.percorsoEvidenze([iniziale, { id: "e1", pagina: 1, r }]),
    [rett, evidenzaIniziale]);
  const disegnate = await pagina.$$eval('.pagina[data-n="1"] .evidenze .evidenza', (d) => d.length);
  verifica("la sottolineatura si disegna sulla pagina 1", disegnate === rett.length, String(disegnate));
  const sopra = await pagina.$eval('.pagina[data-n="1"]', (p) => {
    const e = p.querySelector(".evidenza").getBoundingClientRect();
    const s = p.querySelector(".textLayer span").getBoundingClientRect();
    return Math.abs(e.top - s.top) < 3 && Math.abs(e.left - s.left) < 3;
  });
  verifica("sopra la riga che si era selezionata", sopra);

  // Tolta la selezione, l'app lo sa e nasconde «Sottolinea».
  await pagina.evaluate(() => window.percorsoTogliSelezione());
  await pagina.waitForTimeout(500);
  const ultima = (await messaggi()).filter((m) => m.tipo === "selezione").pop();
  verifica("tolta la selezione, l'app riceve il vuoto", ultima && ultima.testo === "", JSON.stringify(ultima));

  // Quelle che c'erano già si disegnano quando la pagina arriva.
  await pagina.evaluate(() => window.percorsoVaiA(2));
  await pagina.waitForSelector('.pagina[data-n="2"] .evidenze .evidenza', { timeout: 10000 }).catch(() => {});
  const seconda = await pagina.$$eval('.pagina[data-n="2"] .evidenze .evidenza', (d) => d.length);
  verifica("le sottolineature già salvate compaiono quando la pagina si disegna", seconda === 1, String(seconda));
  // Cancellata la sottolineatura nell'app, la lista nuova non la porta più.
  await pagina.evaluate((iniziale) => window.percorsoEvidenze([iniziale]), evidenzaIniziale);
  const altre = await pagina.$$eval('.pagina[data-n="1"] .evidenze .evidenza', (d) => d.length);
  verifica("e una nuova lista sostituisce la vecchia, non si somma", altre === 0, String(altre));

  // Una selezione di due righe, ognuna in più pezzi: due rettangoli, uno per riga.
  const righe = await browser.newPage({ viewport: { width: 412, height: 860 } });
  await righe.addInitScript((pdf) => {
    window.PERCORSO = { pdf, pagina: 1 };
    window.__messaggi = [];
    window.ReactNativeWebView = { postMessage: (s) => window.__messaggi.push(JSON.parse(s)) };
  }, pathToFileURL(pdfDueRighe()).href);
  await righe.goto(pathToFileURL(join(RADICE, "assets/lettore/lettore.html")).href);
  await righe.waitForSelector('.pagina[data-n="1"] .textLayer span', { timeout: 15000 });
  const pezzi = await righe.$$eval('.pagina[data-n="1"] .textLayer span', (s) => s.length);
  await righe.evaluate(() => {
    const spans = document.querySelectorAll('.pagina[data-n="1"] .textLayer span');
    const r = document.createRange();
    r.setStartBefore(spans[0]);
    r.setEndAfter(spans[spans.length - 1]);
    const s = document.getSelection();
    s.removeAllRanges();
    s.addRange(r);
  });
  await righe.waitForFunction(() => window.__messaggi.some((m) => m.tipo === "selezione" && m.testo),
    null, { timeout: 5000 }).catch(() => {});
  const due = (await righe.evaluate(() => window.__messaggi)).filter((m) => m.tipo === "selezione" && m.testo).pop();
  verifica("il PDF di prova ha più pezzi di testo che righe", pezzi >= 4, String(pezzi));
  verifica("due righe selezionate fanno due rettangoli, uno per riga",
    due && due.r.length === 2 && due.r[0][1] < due.r[1][1], JSON.stringify(due && due.r));
  verifica("e il testo le prende tutte e due", due && /Prima.*riga.*Seconda.*riga/.test(due.testo), due && due.testo);
} finally {
  await browser.close();
}

console.log(`${ok} verifiche passate` + (ko.length ? `, ${ko.length} fallite` : ""));
for (const k of ko) console.log("  FALLITA: " + k);
process.exit(ko.length ? 1 : 0);
