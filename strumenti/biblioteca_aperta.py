# -*- coding: utf-8 -*-
"""Biblioteca aperta — testi ad accesso libero, con licenza dichiarata.

Nessun contenuto protetto da diritto d'autore distribuito senza autorizzazione.
Ogni voce ha una licenza esplicita: pubblico dominio, Creative Commons, o
accesso libero concesso dall'editore o dall'autore.

Colonna 'formato':
  pdf   — scaricabile direttamente
  html  — libro web; lo scaricatore salva l'indice e segnala che serve
          la stampa in PDF dal browser o un mirror con wget
  hub   — repository o biblioteca: non si scarica, si consulta
"""

# ---------------------------------------------------------------- TESTI
BIBLIOTECA = [
# --- T1  SQL, fondamenti, lettura del codice
("BIB-01","Use The Index, Luke!","Markus Winand","ottimizzazione","T1","Accesso libero dell'autore","https://use-the-index-luke.com/","html","Il testo di riferimento su indici e piani di esecuzione. Copre da solo tutto il blocco ottimizzazione."),
("BIB-02","PostgreSQL Documentation","PostgreSQL Global Development Group","sql_base","T1","PostgreSQL License","https://www.postgresql.org/docs/current/","html","Scaricabile anche in PDF completo dal sito."),
("BIB-03","SQLite Documentation","SQLite Consortium","sql_base","T1","Pubblico dominio","https://sqlite.org/docs.html","html","Il motore che gira dentro l'app. Pubblico dominio."),
("BIB-04","Automate the Boring Stuff with Python","Al Sweigart","lettura_codice","T1","CC BY-NC-SA 3.0","https://automatetheboringstuff.com/","html","Per leggere ed eseguire codice, non per scriverlo di produzione."),
("BIB-05","The Missing Semester of Your CS Education","MIT","lettura_codice","T1","CC BY-NC-SA 4.0","https://missing.csail.mit.edu/","html","Shell, git, debugging. Colma esattamente le lacune operative."),
("BIB-06","Pro Git (2ª ed.)","Chacon & Straub","lettura_codice","T1","CC BY-NC-SA 3.0","https://github.com/progit/progit2/releases/download/2.1.450/progit.pdf","pdf","PDF ufficiale degli autori, 501 pagine, 18,8 MB: e' l'unico libro del T1 che si apre senza rete."),
("BIB-07","Readings in Database Systems (Red Book, 5ª ed.)","Bailis, Hellerstein, Stonebraker","modellazione","T1","Accesso libero dei curatori","http://www.redbook.io/","html","Letture commentate: utile per capire perché i sistemi sono come sono."),

# --- T2  modellazione, qualità, statistica
("BIB-08","R for Data Science (2ª ed.)","Wickham, Çetinkaya-Rundel, Grolemund","statistica","T2","CC BY-NC-ND 4.0","https://r4ds.hadley.nz/","html","La pista R: leggere, non scrivere. Ecosistema di Epicentre."),
("BIB-09","OpenIntro Statistics (4ª ed.)","Diez, Çetinkaya-Rundel, Barr","statistica","T2","CC BY-SA 3.0","https://raw.githubusercontent.com/OpenIntroStat/openintro-statistics/b27ac1ac7a01e8690094806392015cec958c9e84/main.pdf","pdf","PDF ufficiale, 422 pagine: indirizzo agganciato allo SHA del commit, non cambia sotto i piedi."),
("BIB-10","Introduction to Modern Statistics","Çetinkaya-Rundel & Hardin","statistica","T2","CC BY-SA 4.0","https://openintro-ims.netlify.app/","html","Successore moderno di OpenIntro."),
("BIB-11","Think Stats (3ª ed.)","Allen B. Downey","statistica","T2","CC BY-NC-SA 4.0","https://greenteapress.com/wp/think-stats-3e/","html","Statistica attraverso il codice. Adatto al tuo modo di ragionare."),
("BIB-12","Think Bayes (2ª ed.)","Allen B. Downey","statistica","T2","CC BY-NC-SA 4.0","https://allendowney.github.io/ThinkBayes2/","html","Inferenza bayesiana applicata."),
("BIB-13","An Introduction to Statistical Learning","James, Witten, Hastie, Tibshirani","statistica","T2","Accesso libero degli autori","https://www.statlearning.com/s/ISLR-Seventh-Printing.pdf","pdf","PDF ufficiale gratuito, edizioni R e Python."),
("BIB-14","The Elements of Statistical Learning","Hastie, Tibshirani, Friedman","statistica","T2","Accesso libero degli autori","https://hastie.su.domains/ElemStatLearn/","html","Versione avanzata del precedente."),
("BIB-15","Causal Inference: What If","Hernán & Robins","epidemiologia","T2","Accesso libero degli autori","https://miguelhernan.org/s/hernanrobins_WhatIf_19aug26.pdf","pdf","Confondimento, causalità, bias. Il testo più utile per il tuo dominio."),
("BIB-16","The Effect","Nick Huntington-Klein","statistica","T2","Accesso libero dell'autore","https://theeffectbook.net/","html","Inferenza causale applicata, taglio pratico."),
("BIB-17","Forecasting: Principles and Practice (3ª ed.)","Hyndman & Athanasopoulos","statistica","T2","Accesso libero degli autori","https://otexts.com/fpp3/","html","Serie storiche: utile per i trend di sorveglianza."),
("BIB-18","Fundamentals of Data Visualization","Claus O. Wilke","kpi","T2","Accesso libero dell'autore","https://clauswilke.com/dataviz/","html","Principi, non strumenti. Direttamente applicabile ai cruscotti."),
("BIB-19","Data Visualization: A Practical Introduction","Kieran Healy","kpi","T2","Accesso libero dell'autore","https://socviz.co/","html","Complementare a Wilke, con codice R."),
("BIB-20","Python Data Science Handbook","Jake VanderPlas","statistica","T2","CC BY-NC-ND 4.0 (codice MIT)","https://jakevdp.github.io/PythonDataScienceHandbook/","html","Riferimento operativo su pandas e numpy."),
("BIB-21","Modern Statistics for Modern Biology","Holmes & Huber","epidemiologia","T2","CC BY-NC-ND 4.0","https://www.huber.embl.de/msmb/","html","Statistica per dati biologici e clinici."),
("BIB-22","The Turing Way","The Turing Way Community","qualita_dati","T2","CC BY 4.0","https://the-turing-way.netlify.app/","html","Riproducibilità, etica dei dati, collaborazione. Molto citabile."),

# --- T3  IA, GDPR, AI Act
("BIB-23","Regolamento (UE) 2016/679 — GDPR, testo integrale","Unione Europea","gdpr","T3","Riuso consentito (EUR-Lex)","https://eur-lex.europa.eu/legal-content/IT/TXT/PDF/?uri=CELEX:32016R0679","pdf","Il testo, non un riassunto. Da avere offline."),
("BIB-24","Regolamento (UE) 2024/1689 — AI Act, testo integrale","Unione Europea","ai_act","T3","Riuso consentito (EUR-Lex)","https://eur-lex.europa.eu/legal-content/IT/TXT/PDF/?uri=CELEX:32024R1689","pdf","Idem."),
("BIB-25","Direttiva (UE) 2022/2555 — NIS2","Unione Europea","sicurezza","T3","Riuso consentito (EUR-Lex)","https://eur-lex.europa.eu/legal-content/IT/TXT/PDF/?uri=CELEX:32022L2555","pdf","Obblighi di sicurezza e notifica."),
("BIB-26","Linee guida e raccomandazioni EDPB","European Data Protection Board","gdpr","T3","Riuso consentito","https://www.edpb.europa.eu/our-work-tools/general-guidance/guidelines-recommendations-best-practices_en","hub","Interpretazione autorevole del GDPR."),
("BIB-27","Handbook on Data Protection in Humanitarian Action (2ª ed.)","ICRC / Brussels Privacy Hub","gdpr","T3","Accesso libero ICRC","https://www.cambridge.org/core/services/aop-cambridge-core/content/view/025CE3DFD1FAD908DD1412C20E49F955/9781009414623AR.pdf/Handbook_on_Data_Protection_in_Humanitarian_Action.pdf","pdf","Il testo chiave del tuo dominio. Priorità massima."),
("BIB-28","Data Responsibility Guidelines","OCHA Centre for Humanitarian Data","gdpr","T3","Accesso libero OCHA","https://data.humdata.org/dataset/2048a947-5714-4220-905b-e662cbcd14c8/resource/8bc5b848-8ece-4f1f-a78b-18dd972bb21a/download/data-responsibility-guidelines-2025.pdf","pdf","Operativo, non teorico."),
("BIB-29","NIST AI Risk Management Framework 1.0","NIST","ia","T3","Pubblico dominio","https://nvlpubs.nist.gov/nistpubs/ai/NIST.AI.100-1.pdf","pdf","Govern, Map, Measure, Manage."),
("BIB-30","OWASP Top 10 for LLM Applications","OWASP Foundation","ia","T3","CC BY-SA 4.0","https://genai.owasp.org/llm-top-10/","html","Dichiarata 'pdf' con l'indirizzo della pagina di progetto, che pdf non e'. Il PDF 2025 esiste ma sta in un repository che si dichiara archiviato: da riverificare da una rete non filtrata prima di rimetterlo."),
("BIB-31","Software Engineering at Google","Winters, Manshreck, Wright","ia","T3","CC BY-NC-ND 4.0","https://abseil.io/resources/swe-book","html","Pratiche di ingegneria su larga scala, lettura integrale libera."),

# --- T4  architettura dati
("BIB-32","dbt Developer Hub — documentazione","dbt Labs","modellazione","T4","Accesso libero","https://docs.getdbt.com/","html","Modelli, test, contratti di dati, layer semantico."),
("BIB-33","DuckDB Documentation","DuckDB Foundation","ottimizzazione","T4","MIT","https://duckdb.org/docs/","html","Motore analitico locale: ideale per lavorare offline."),
("BIB-34","Architecture Decision Records","ADR community / Nygard","business_analysis","T4","CC BY 4.0","https://adr.github.io/","html","Formati e esempi di ADR."),
("BIB-35","Site Reliability Engineering","Google","governance","T4","Accesso libero Google","https://sre.google/sre-book/table-of-contents/","html","SLI, SLO, error budget: fonte primaria."),
("BIB-36","The Site Reliability Workbook","Google","governance","T4","Accesso libero Google","https://sre.google/workbook/table-of-contents/","html","Applicazione pratica del precedente."),

# --- T5  hardware, reti, sicurezza
("BIB-37","NIST Cybersecurity Framework 2.0","NIST","sicurezza","T5","Pubblico dominio","https://www.nist.gov/cyberframework","html","Dichiarata 'pdf' su una pagina che pdf non e'. Il file ufficiale dovrebbe essere nvlpubs.nist.gov/nistpubs/CSWP/NIST.CSWP.29.pdf: non verificabile da qui (host bloccato), da provare prima di dichiararlo."),
("BIB-38","NIST SP 800-61 — Incident Handling Guide","NIST","sicurezza","T5","Pubblico dominio","https://nvlpubs.nist.gov/nistpubs/SpecialPublications/NIST.SP.800-61r2.pdf","pdf","Sequenza di risposta agli incidenti."),
("BIB-39","NIST SP 800-34 — Contingency Planning Guide","NIST","hardware","T5","Pubblico dominio","https://nvlpubs.nist.gov/nistpubs/Legacy/SP/nistspecialpublication800-34r1.pdf","pdf","RTO, RPO, continuità operativa."),
("BIB-40","NIST SP 800-124 — Mobile Device Security","NIST","hardware","T5","Pubblico dominio","https://nvlpubs.nist.gov/nistpubs/SpecialPublications/NIST.SP.800-124r2.pdf","pdf","Gestione di flotte di dispositivi sul campo."),
("BIB-41","Beej's Guide to Network Programming","Brian Hall","hardware","T5","CC BY-NC-ND 3.0","https://beej.us/guide/bgnet/","html","Reti dal basso, con chiarezza rara."),
("BIB-42","High Performance Browser Networking","Ilya Grigorik","hardware","T5","CC BY-NC-ND 4.0","https://hpbn.co/","html","Latenza, banda, BDP: la teoria dietro i profili di connettività."),
("BIB-43","ENISA Publications","ENISA","sicurezza","T5","Riuso consentito","https://www.enisa.europa.eu/publications","hub","Rapporti su minacce e buone pratiche."),

# --- T6  sanità digitale, standard umanitari
("BIB-44","HL7 FHIR — specifica","HL7 International","salute_digitale","T6","CC0 1.0","https://hl7.org/fhir/","html","Specifica completa, dominio pubblico."),
("BIB-45","DHIS2 Documentation","University of Oslo / HISP","salute_digitale","T6","BSD-3","https://docs.dhis2.org/","html","Guide utente, sviluppatore e implementazione."),
("BIB-46","OpenHIE Architecture Specification","OpenHIE Community","salute_digitale","T6","CC BY 4.0","https://guides.ohie.org/arch-spec/","html","Architettura di riferimento per sistemi informativi sanitari."),
("BIB-47","Sphere Handbook","Sphere Association","meal","T6","Accesso libero","https://spherestandards.org/handbook/","html","Standard minimi. Disponibile anche in italiano."),
("BIB-48","Core Humanitarian Standard","CHS Alliance","meal","T6","Accesso libero","https://corehumanitarianstandard.org/the-standard","html","I nove impegni."),
("BIB-49","Evaluation of Humanitarian Action Guide","ALNAP","meal","T6","Accesso libero","https://www.alnap.org/help-library/evaluation-of-humanitarian-action-guide","html","Metodologia di valutazione umanitaria."),
("BIB-50","SMART Methodology Manual","SMART Initiative","epidemiologia","T6","Accesso libero","https://smartmethodology.org/survey-planning-tools/smart-methodology/","html","Campionamento a grappoli, design effect, indagini nutrizionali."),
("BIB-51","Principles for Digital Development","Digital Impact Alliance","business_analysis","T6","CC BY 4.0","https://digitalprinciples.org/","html","Nove principi, molto citati nei bandi."),
("BIB-52","Principles of Epidemiology in Public Health Practice","CDC","epidemiologia","T6","Pubblico dominio","https://www.cdc.gov/csels/dsepd/ss1978/index.html","html","Corso autodidattico completo, dominio pubblico."),
]

# ------------------------------------------------------------ REPOSITORY
# Non si scaricano: si consultano per trovare altro materiale legale.
REPOSITORY = [
("HUB-01","Directory of Open Access Books (DOAB)","https://www.doabooks.org/","Oltre 90.000 libri accademici ad accesso aperto, con licenza verificata."),
("HUB-02","OAPEN Library","https://library.oapen.org/","Monografie accademiche ad accesso aperto, molte su salute pubblica e sviluppo."),
("HUB-03","OpenStax","https://openstax.org/subjects","Manuali universitari CC BY: statistica, informatica, economia."),
("HUB-04","LibreTexts","https://libretexts.org/","Testi universitari aperti, forte sezione statistica e informatica."),
("HUB-05","Open Textbook Library","https://open.umn.edu/opentextbooks","Manuali aperti recensiti da docenti."),
("HUB-06","Project Gutenberg","https://www.gutenberg.org/","Oltre 70.000 opere di pubblico dominio."),
("HUB-07","Internet Archive — Open Texts","https://archive.org/details/texts","Collezione di testi liberamente accessibili."),
("HUB-08","HathiTrust — Public Domain","https://www.hathitrust.org/","Digitalizzazioni di pubblico dominio."),
("HUB-09","arXiv","https://arxiv.org/","Preprint di informatica, statistica e matematica."),
("HUB-10","PubMed Central","https://www.ncbi.nlm.nih.gov/pmc/","Letteratura biomedica ad accesso aperto."),
("HUB-11","Zenodo","https://zenodo.org/","Archivio CERN: dati, software e pubblicazioni con DOI."),
("HUB-12","World Bank Open Knowledge Repository","https://openknowledge.worldbank.org/","Rapporti e libri CC BY su sviluppo e dati."),
("HUB-13","WHO Publications / IRIS","https://iris.who.int/","Repository istituzionale OMS, CC BY-NC-SA."),
("HUB-14","ReliefWeb","https://reliefweb.int/","Rapporti e valutazioni umanitarie."),
("HUB-15","Humanitarian Data Exchange (HDX)","https://data.humdata.org/","Dataset umanitari aperti, utili anche per esercizi."),
("HUB-16","OpenAlex","https://openalex.org/","Catalogo aperto di 250 milioni di lavori accademici, con API."),
("HUB-17","Semantic Scholar","https://www.semanticscholar.org/","Ricerca accademica con API aperta e TLDR automatici."),
("HUB-18","Unpaywall","https://unpaywall.org/","Trova la versione legale ad accesso aperto di un articolo a partire dal DOI."),
("HUB-19","CORE","https://core.ac.uk/","Aggregatore di repository ad accesso aperto."),
("HUB-20","MediaLibraryOnLine (MLOL)","https://www.medialibrary.it/","Prestito digitale delle biblioteche italiane. Richiede iscrizione a una biblioteca aderente, possibile una volta in Italia."),
]
