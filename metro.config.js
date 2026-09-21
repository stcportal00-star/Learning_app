// Metro deve trattare come asset i file che viaggiano dentro l'app:
//   .db    palestra.db, il database di allenamento
//   .html  il lettore PDF con pdf.js incorporato
//   .pdf   il PDF di prova usato dal test di fumo
const { getDefaultConfig } = require("expo/metro-config");
const config = getDefaultConfig(__dirname);
config.resolver.assetExts = [...config.resolver.assetExts, "db", "html", "pdf"];
module.exports = config;
