/**
 * SIMULAZIONE DELLA CACHE DEI MEDIA — lib/nuvola/media.ts sopra il banco.
 *
 *   node test/simulazione/media.mjs
 *
 * Si riavvia da solo con i ganci del banco, come le altre simulazioni: i doppi
 * vanno registrati prima di qualunque import.
 *
 * Qui gira il CODICE VERO: lib/nuvola/media.ts, lib/nuvola/articoli.ts e
 * lib/db.ts, sopra expo-sqlite e expo-file-system doppiati con file e database
 * VERI su disco. Un doppio in memoria non si accorgerebbe del caso che conta —
 * il file cancellato sotto i piedi da una pulizia del sistema — ed è proprio
 * quello che `statoMedia` esiste per vedere.
 *
 * La domanda a cui questa prova risponde è una sola, e non è «scarica?»:
 * **ciò che viene dichiarato è ciò che succede.** La cache promette tre cose —
 * il percorso locale non viaggia, visto vuol dire cancellato, e una voce già
 * vista non si riscarica da sola — e ognuna delle tre si rompe in silenzio.
 */
import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const QUESTA_CARTELLA = dirname(fileURLToPath(import.meta.url));
const RADICE_PROGETTO = resolve(QUESTA_CARTELLA, "..", "..");

if (!process.env.BANCO_MEDIA_IN_CORSO) {
  const { variabileBanco } = await import("../banco/doppi-altri.mjs");
  const esito = spawnSync(
    process.execPath,
    ["--import", "./test/banco/carica.mjs", "test/simulazione/media.mjs"],
    {
      cwd: RADICE_PROGETTO,
      stdio: "inherit",
      env: { ...process.env, BANCO_MEDIA_IN_CORSO: "1", BANCO_DOPPI: variabileBanco() },
    }
  );
  process.exit(esito.status ?? 1);
}

// ================================================================= CONTEGGIO
let passate = 0;
const guasti = [];

function ok(nome, condizione, dettaglio = "") {
  if (condizione) passate++;
  else guasti.push(`${nome}${dettaglio ? "\n      " + dettaglio : ""}`);
}

function uguale(nome, ottenuto, atteso) {
  ok(nome, JSON.stringify(ottenuto) === JSON.stringify(atteso),
    `atteso  : ${JSON.stringify(atteso)}\n      ottenuto: ${JSON.stringify(ottenuto)}`);
}

// ================================================================= PREPARAZIONE
const { importaApp } = await import("../banco/carica.mjs");
const fs = await import("expo-file-system");
const db = await importaApp("lib/db.ts");
const media = await importaApp("lib/nuvola/media.ts");

await db.apri("dispositivo-media");
const base = db.database();

const URL_AUDIO = "https://pod.example/ep/12.mp3";
const BYTE = Buffer.from("x".repeat(4096));

async function inserisci(id, campi = {}) {
  const r = {
    titolo: "Un episodio", url: "https://pod.example/ep/12",
    url_media: URL_AUDIO, tipo_media: "audio/mpeg", byte_media: 4096,
    visto_a: null, file_media: null, ...campi,
  };
  await base.runAsync(
    `INSERT OR REPLACE INTO articoli
       (id, titolo, url, url_media, tipo_media, byte_media, visto_a, file_media,
        raccolto_a, letto, salvato)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, '2026-09-23T00:00:00Z', 0, 0)`,
    [id, r.titolo, r.url, r.url_media, r.tipo_media, r.byte_media, r.visto_a, r.file_media]
  );
}

const leggi = (id) => base.getFirstAsync("SELECT * FROM articoli WHERE id = ?", [id]);
const eventiDi = (id) =>
  base.getAllAsync("SELECT * FROM eventi WHERE entita = 'articoli' AND entita_id = ? ORDER BY hlc", [id]);

// ================================================================= M1 stati
await inserisci("m1-senza", { url_media: null });
await inserisci("m1-da-scaricare");
await inserisci("m1-visto", { visto_a: "2026-09-23T10:00:00Z" });
await inserisci("m1-mancante", { file_media: "/tmp/cartella-che-non-esiste/x.mp3" });

uguale("M1 una voce senza allegato è «nessuno»",
  media.statoMedia(await leggi("m1-senza")), "nessuno");
uguale("M1 con l'indirizzo e senza file è «da_scaricare»",
  media.statoMedia(await leggi("m1-da-scaricare")), "da_scaricare");
uguale("M1 già vista e senza file è «visto», non «da_scaricare»",
  media.statoMedia(await leggi("m1-visto")), "visto");
// Il caso per cui `statoMedia` guarda il disco invece di fidarsi della riga:
// una pulizia del sistema porta via il file e lascia la colonna piena. Senza
// questo controllo il lettore si aprirebbe su un file che non c'è, in aereo.
uguale("M1 il file sparito dal disco è «mancante», non «in_cache»",
  media.statoMedia(await leggi("m1-mancante")), "mancante");

// ================================================================= M2 scarico
fs.azzeraRete();
fs.rispondi(URL_AUDIO, BYTE);
const esito = await media.scaricaMedia("m1-da-scaricare");
uguale("M2 lo scarico riesce e dichiara i byte veri", [esito.stato, esito.byte], ["in_cache", 4096]);

const dopo = await leggi("m1-da-scaricare");
ok("M2 il percorso finisce nella riga", !!dopo.file_media, JSON.stringify(dopo.file_media));
ok("M2 e il file esiste davvero su disco", new fs.File(dopo.file_media).exists);
uguale("M2 lo stato letto dalla riga è «in_cache»", media.statoMedia(dopo), "in_cache");

// La regola 2 del modulo, ed è quella che si rompe in silenzio: `file_media` è
// un percorso di QUESTO telefono. Se viaggiasse, il tablet crederebbe di avere
// un file che non ha, e lo stato direbbe «in_cache» su un disco vuoto.
uguale("M2 lo scarico NON scrive nessun evento", (await eventiDi("m1-da-scaricare")).length, 0);

// ================================================================= M3 guasto
fs.azzeraRete();
await inserisci("m3");
const rotto = await media.scaricaMedia("m3");
uguale("M3 un indirizzo che non risponde lascia la voce da scaricare", rotto.stato, "da_scaricare");
ok("M3 e il motivo si legge", (rotto.errore || "").length > 10, rotto.errore);
uguale("M3 senza scrivere niente nella riga", (await leggi("m3")).file_media, null);

// ================================================================= M4 visto
fs.azzeraRete();
fs.rispondi(URL_AUDIO, BYTE);
await inserisci("m4");
await media.scaricaMedia("m4");
const primaDelVisto = (await leggi("m4")).file_media;
ok("M4 il file c'è prima", new fs.File(primaDelVisto).exists);

await media.segnaVisto("m4", "2026-09-23T12:00:00Z");
const m4 = await leggi("m4");
uguale("M4 «visto» scrive la data", m4.visto_a, "2026-09-23T12:00:00Z");
ok("M4 e cancella il file dal disco", !new fs.File(primaDelVisto).exists, primaDelVisto);
uguale("M4 e azzera il percorso nella riga", m4.file_media, null);

uguale("M4 e lo stato diventa «visto»", media.statoMedia(m4), "visto");

const eventi4 = await eventiDi("m4");
uguale("M4 «visto» scrive UN evento, perché è stato dell'utente", eventi4.length, 1);
const payload4 = JSON.parse(eventi4[0].payload);
uguale("M4 l'evento porta visto_a", payload4.visto_a, "2026-09-23T12:00:00Z");
ok("M4 e NON porta file_media", !("file_media" in payload4), JSON.stringify(payload4));

// ================================================================= M5 già visto
fs.azzeraRete();
fs.rispondi(URL_AUDIO, BYTE);
uguale("M5 una voce vista si può comunque riscaricare a mano",
  (await media.scaricaMedia("m4")).stato, "in_cache");

// ================================================================= M6 pulizia
// `visto_a` può arrivare DALL'ALTRO dispositivo: lì il file non c'era, qui sì,
// e senza questa passata nessuno lo cancellerebbe mai.
fs.azzeraRete();
fs.rispondi(URL_AUDIO, BYTE);
await inserisci("m6");
await media.scaricaMedia("m6");
const fileM6 = (await leggi("m6")).file_media;
await base.runAsync("UPDATE articoli SET visto_a = ? WHERE id = ?", ["2026-09-23T13:00:00Z", "m6"]);

const liberati = await media.liberaVisti();
ok("M6 la passata libera il file di ciò che risulta visto altrove", liberati.liberati >= 1,
  JSON.stringify(liberati));
ok("M6 e il file se ne va davvero", !new fs.File(fileM6).exists, fileM6);
uguale("M6 senza scrivere un evento in più", (await eventiDi("m6")).length, 0);

// ================================================================= M7 spazio
fs.azzeraRete();
fs.rispondi(URL_AUDIO, BYTE);
await inserisci("m7");
await media.scaricaMedia("m7");
const spazio = await media.spazioMedia();
ok("M7 lo spazio occupato si può dire a chi guarda", spazio.file >= 1 && spazio.byte >= 4096,
  JSON.stringify(spazio));

// ================================================================= M8 dimentica
const fileM7 = (await leggi("m7")).file_media;
uguale("M8 «dimentica» libera il file", await media.dimenticaMedia("m7"), true);
ok("M8 e il file non c'è più", !new fs.File(fileM7).exists);
uguale("M8 ma NON segna la voce come vista", (await leggi("m7")).visto_a, null);
uguale("M8 e non scrive eventi", (await eventiDi("m7")).length, 0);

// ================================================================= M9 lettore
// L'allegato si apre con il lettore del sistema, come i PDF della biblioteca:
// zero moduli nativi in più, e Android il lettore ce l'ha già. Il ramo che si
// rompe sul telefono di qualcun altro è il ripiego, quindi si prova tutto.
const intent = await import("expo-intent-launcher");
const condivisione = await import("expo-sharing");

fs.azzeraRete();
intent.azzera();
condivisione.azzera();
await inserisci("m9-senza-file");
uguale("M9 senza copia locale non si apre niente",
  await media.apriMedia("m9-senza-file"), "non_scaricato");
uguale("M9 e nessun intent parte", intent.giornale.length, 0);

fs.rispondi(URL_AUDIO, BYTE);
await inserisci("m9", { tipo_media: "video/mp4" });
await media.scaricaMedia("m9");
uguale("M9 con la copia locale si apre", await media.apriMedia("m9"), "aperto");
const chiamata = intent.giornale.at(-1);
uguale("M9 con l'azione VIEW", chiamata.azione, "android.intent.action.VIEW");
uguale("M9 e il tipo che la fonte dichiara", chiamata.parametri.type, "video/mp4");
// Senza FLAG_GRANT_READ_URI_PERMISSION il lettore esterno riceve un indirizzo
// che non ha il permesso di leggere, e si apre su un errore invece che sul video.
uguale("M9 e il permesso di lettura sull'indirizzo", chiamata.parametri.flags, 1);

intent.programmaNessunVisore(true);
uguale("M9 senza lettore registrato si ripiega sul foglio di condivisione",
  await media.apriMedia("m9"), "aperto");
uguale("M9 e il foglio riceve il file",
  (condivisione.giornale.at(-1) || {}).chiamata, "shareAsync");

condivisione.programmaDisponibilita(false);
uguale("M9 senza nemmeno il foglio lo dice, invece di fingere",
  await media.apriMedia("m9"), "nessun_lettore");
intent.programmaNessunVisore(false);
condivisione.programmaDisponibilita(true);

// La riga dice che il file c'è, il disco dice di no: una pulizia del sistema.
// Senza questo controllo l'intent parte su un indirizzo vuoto e il lettore si
// apre su un errore, che in aereo non si distingue da un'app rotta.
const contateInizio = intent.giornale.length;
await base.runAsync("UPDATE articoli SET file_media = ? WHERE id = ?",
  ["file:///tmp/cartella-che-non-esiste/m9.mp4", "m9"]);
uguale("M9 con il file sparito dal disco non si apre niente",
  await media.apriMedia("m9"), "non_scaricato");
uguale("M9 e nessun intent parte lo stesso", intent.giornale.length, contateInizio);

// ================================================================= ESITO
if (guasti.length) {
  console.log("SIMULAZIONE DEI MEDIA: ROSSA\n");
  for (const g of guasti) console.log("  ✗ " + g);
  console.log(`\n${passate} verifiche passate, ${guasti.length} fallite`);
  process.exit(1);
}
console.log(`${passate} verifiche passate`);
