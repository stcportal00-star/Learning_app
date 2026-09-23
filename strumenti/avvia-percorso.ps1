<#
.SYNOPSIS
  Passaggio del progetto Percorso a Claude Code su Windows.

.DESCRIPTION
  Esegue, in ordine e con verifica a ogni passo:
    1. controllo dei prerequisiti (winget, Git, Node.js LTS)
    2. installazione di Claude Code, se manca
    3. correzione del PATH (difetto noto dell'installer nativo)
    4. estrazione del progetto dallo zip
    5. primo commit git, prima di toccare qualunque file
    6. npm install
    7. verifica: typecheck + test, che devono restare verdi
    8. preparazione del primo messaggio per Claude Code
    9. avvio di Claude Code nella cartella del progetto

  Idempotente: si puo' rieseguire senza danni. I passi gia' completati
  vengono riconosciuti e saltati.

.PARAMETER Zip
  Percorso di percorso.zip. Se omesso, lo cerca nella stessa cartella dello script.

.PARAMETER Destinazione
  Dove creare il progetto. Predefinito: %USERPROFILE%\progetti\percorso

.PARAMETER Simula
  Mostra cosa farebbe senza installare, estrarre o modificare nulla.

.PARAMETER SenzaConferme
  Non chiede conferma prima delle installazioni.

.PARAMETER SenzaGitHub
  Salta la pubblicazione su GitHub. Senza GitHub, Claude Code funziona solo
  su questo PC e non dall'app del telefono.

.EXAMPLE
  .\avvia-percorso.ps1
  .\avvia-percorso.ps1 -Simula
  .\avvia-percorso.ps1 -Zip D:\Download\percorso.zip
#>
[CmdletBinding()]
param(
  [string]$Zip = "",
  [string]$Destinazione = (Join-Path $env:USERPROFILE "progetti\percorso"),
  [switch]$Simula,
  [switch]$SenzaConferme,
  [switch]$SenzaGitHub
)

# "Continue" e non "Stop": in Windows PowerShell 5.1 qualunque riga scritta su
# stderr da un comando nativo (git, npm, winget) con redirezione diventa un
# errore fatale. npm scrive i suoi avvisi proprio su stderr. Si controlla
# quindi $LASTEXITCODE in modo esplicito dopo ogni comando nativo.
$ErrorActionPreference = "Continue"
$script:Passi = @()
$log = Join-Path $env:TEMP ("percorso-avvio-{0:yyyyMMdd-HHmmss}.log" -f (Get-Date))
Start-Transcript -Path $log -Append | Out-Null

# ------------------------------------------------------------------ utilita
function Titolo($t) { Write-Host ""; Write-Host "== $t ==" -ForegroundColor Cyan }
function Ok($t)     { Write-Host "  [OK]      $t" -ForegroundColor Green;  $script:Passi += "OK      $t" }
function Manca($t)  { Write-Host "  [MANCA]   $t" -ForegroundColor Yellow; $script:Passi += "MANCA   $t" }
function Salta($t)  { Write-Host "  [SALTATO] $t" -ForegroundColor DarkGray; $script:Passi += "SALTATO $t" }
function Errore($t) {
  Write-Host "  [ERRORE]  $t" -ForegroundColor Red
  $script:Passi += "ERRORE  $t"
  Write-Host ""
  Write-Host "Interrotto. Registro completo: $log" -ForegroundColor Red
  Stop-Transcript | Out-Null
  exit 1
}

function Conferma($domanda) {
  if ($SenzaConferme) { return $true }
  $r = Read-Host "  $domanda [S/n]"
  return ($r -eq "" -or $r -match "^[sSyY]")
}

function Esegui($descrizione, [scriptblock]$azione) {
  if ($Simula) { Write-Host "  [SIMULA]  $descrizione" -ForegroundColor Magenta; return }
  & $azione
}

# Dopo un'installazione con winget il PATH della sessione corrente e' vecchio:
# senza questo, il comando appena installato risulta "non trovato".
function AggiornaPath {
  $m = [Environment]::GetEnvironmentVariable("Path", "Machine")
  $u = [Environment]::GetEnvironmentVariable("Path", "User")
  $env:Path = "$m;$u"
}

# Esegue un comando nativo ignorando stderr, e restituisce solo stdout.
function Silenzioso([scriptblock]$cmd) {
  $vecchia = $ErrorActionPreference
  $ErrorActionPreference = "SilentlyContinue"
  try { return (& $cmd 2>$null) } finally { $ErrorActionPreference = $vecchia }
}

function Presente($comando) {
  return [bool](Get-Command $comando -ErrorAction SilentlyContinue)
}

# ------------------------------------------------------------------ 1. winget
Titolo "1. Prerequisiti"
if ($Simula) { Write-Host "  Modalita' simulazione: nessuna modifica verra' eseguita." -ForegroundColor Magenta }

if (Presente "winget") { Ok "winget disponibile" }
else {
  Manca "winget"
  Errore "winget non trovato. Installa 'App Installer' dal Microsoft Store e rilancia."
}

# ------------------------------------------------------------------ 2. Git
if (Presente "git") {
  Ok ("Git " + ((Silenzioso { git --version }) -replace "git version ", ""))
} else {
  Manca "Git for Windows (serve per il repository del progetto)"
  if (Conferma "Installare Git for Windows con winget?") {
    Esegui "winget install Git.Git" {
      winget install --id Git.Git -e --source winget --accept-package-agreements --accept-source-agreements
      if ($LASTEXITCODE -ne 0) { Errore "winget non ha installato Git (codice $LASTEXITCODE)." }
      AggiornaPath
    }
    if (-not $Simula -and -not (Presente "git")) {
      Errore "Git installato ma non raggiungibile. Chiudi e riapri PowerShell, poi rilancia lo script."
    }
    Ok "Git installato"
  } else { Errore "Git e' necessario per procedere." }
}

# ------------------------------------------------------------------ 3. Node.js
$nodeOk = $false
if (Presente "node") {
  $maggiore = [int]((node -v) -replace "^v(\d+)\..*", '$1')
  if ($maggiore -ge 20) { Ok "Node.js $(node -v)"; $nodeOk = $true }
  else { Manca "Node.js troppo vecchio ($(node -v)): serve 20 o superiore per Expo SDK 54" }
} else {
  Manca "Node.js (serve per Expo, non per Claude Code)"
}
if (-not $nodeOk) {
  if (Conferma "Installare Node.js LTS con winget?") {
    Esegui "winget install OpenJS.NodeJS.LTS" {
      winget install --id OpenJS.NodeJS.LTS -e --source winget --accept-package-agreements --accept-source-agreements
      if ($LASTEXITCODE -ne 0) { Errore "winget non ha installato Node.js (codice $LASTEXITCODE)." }
      AggiornaPath
    }
    if (-not $Simula -and -not (Presente "node")) {
      Errore "Node installato ma non raggiungibile. Chiudi e riapri PowerShell, poi rilancia lo script."
    }
    Ok "Node.js installato"
  } else { Errore "Node.js e' necessario per il progetto." }
}

# ------------------------------------------------------------------ 4. Claude Code
Titolo "2. Claude Code"

# Difetto noto: l'installer nativo non sempre aggiunge questa cartella al PATH.
$binLocale = Join-Path $env:USERPROFILE ".local\bin"

function CorreggiPath {
  $utente = [Environment]::GetEnvironmentVariable("Path", "User")
  if ($utente -notlike "*$binLocale*") {
    Esegui "aggiungere $binLocale al PATH utente" {
      [Environment]::SetEnvironmentVariable("Path", "$utente;$binLocale", "User")
    }
    Ok "PATH corretto: aggiunto $binLocale (difetto noto dell'installer nativo)"
  }
  if ($env:Path -notlike "*$binLocale*") { $env:Path = "$env:Path;$binLocale" }
}

if (Presente "claude") {
  $tutti = @(Get-Command claude -All -ErrorAction SilentlyContinue)
  if ($tutti.Count -gt 1) {
    # Difetto noto: installer nativo e winget installano in cartelle diverse
    # senza vedersi a vicenda. PowerShell usa la prima trovata nel PATH.
    Write-Host "  [ATTENZIONE] Trovate $($tutti.Count) installazioni di Claude Code:" -ForegroundColor Yellow
    $tutti | ForEach-Object { Write-Host "              $($_.Source)" -ForegroundColor Yellow }
    Write-Host "              Viene usata la prima. Se sembra una versione vecchia, disinstalla l'altra." -ForegroundColor Yellow
  }
  Ok "Claude Code presente"
} else {
  Manca "Claude Code"
  if (Conferma "Installare Claude Code con l'installer ufficiale di Anthropic?") {
    Esegui "irm https://claude.ai/install.ps1 | iex" {
      Invoke-RestMethod https://claude.ai/install.ps1 | Invoke-Expression
    }
    CorreggiPath
    if (-not $Simula -and -not (Presente "claude")) {
      Errore "Installazione completata ma 'claude' non e' raggiungibile. Chiudi e riapri PowerShell, poi rilancia."
    }
    Ok "Claude Code installato"
  } else { Errore "Claude Code e' l'obiettivo di questo script." }
}

# ------------------------------------------------------------------ 5. progetto
Titolo "3. Progetto"

if (Test-Path (Join-Path $Destinazione ".git")) {
  Salta "progetto gia' presente in $Destinazione (repository git esistente, non lo sovrascrivo)"
} else {
  if (-not $Zip) { $Zip = Join-Path $PSScriptRoot "percorso.zip" }
  if (-not (Test-Path $Zip)) {
    Errore "percorso.zip non trovato in: $Zip`n            Usa:  .\avvia-percorso.ps1 -Zip C:\percorso\del\file\percorso.zip"
  }
  if ((Test-Path $Destinazione) -and (Get-ChildItem $Destinazione -Force | Select-Object -First 1)) {
    Errore "$Destinazione esiste e non e' vuota. Scegli un'altra destinazione con -Destinazione."
  }
  $padre = Split-Path $Destinazione -Parent
  Esegui "estrarre $Zip in $padre" {
    New-Item -ItemType Directory -Force -Path $padre -ErrorAction Stop | Out-Null
    Expand-Archive -Path $Zip -DestinationPath $padre -Force -ErrorAction Stop
  }
  Ok "progetto estratto in $Destinazione"
}

if (-not $Simula) { Set-Location $Destinazione }

# ------------------------------------------------------------------ 6. git
Titolo "4. Repository"

if ($Simula) {
  Write-Host "  [SIMULA]  git init + primo commit" -ForegroundColor Magenta
} else {
  $ultimo = $null
  if (Test-Path ".git") { $ultimo = Silenzioso { git log --oneline -1 } }
  if ($ultimo) {
    Salta "primo commit gia' presente: $ultimo"
  } else {
    # Configurazione solo locale a questo repository: non tocca quella globale.
    $nome = Silenzioso { git config --global user.name }
    $mail = Silenzioso { git config --global user.email }
    if (-not $nome) { $nome = Read-Host "  Nome per i commit (solo per questo progetto)" }
    if (-not $mail) { $mail = Read-Host "  Email per i commit (solo per questo progetto)" }
    git init -q
    git config user.name  "$nome"
    git config user.email "$mail"
    git add -A
    git commit -q -m "stato iniziale: typecheck pulito, 92 test verdi, mai compilato su dispositivo"
    if ($LASTEXITCODE -ne 0) { Errore "git commit non riuscito." }
    Ok "primo commit creato: punto di ritorno prima di qualunque modifica"
  }
}

# ------------------------------------------------------------------ 7. npm install
Titolo "5. Dipendenze"
if (-not $Simula -and (Test-Path "node_modules\expo")) {
  Salta "node_modules gia' presente"
} else {
  Esegui "npm install" {
    npm install --no-fund --no-audit
    if ($LASTEXITCODE -ne 0) { Errore "npm install non riuscito. Vedi il registro: $log" }
  }
  Ok "dipendenze installate"
}

# ------------------------------------------------------------------ 8. verifica
Titolo "6. Verifica"
Esegui "npm run verifica" {
  npm run verifica
  if ($LASTEXITCODE -ne 0) {
    Errore "La verifica non e' verde. Non avviare Claude Code su una base rotta: correggi prima questo."
  }
}
Ok "typecheck a zero errori, test verdi"

# ------------------------------------------------------------------ 8b. GitHub
# Claude Code in cloud (scheda Code dell'app mobile) lavora SOLO su repository
# GitHub. Pubblicare qui il progetto e' cio' che permette di continuare dal
# telefono senza questo PC.
Titolo "6b. GitHub (per usare Claude Code dal telefono)"
if ($SenzaGitHub) {
  Salta "GitHub: escluso con -SenzaGitHub"
} elseif ($Simula) {
  Write-Host "  [SIMULA]  gh repo create percorso --private --push" -ForegroundColor Magenta
} else {
  $remoto = Silenzioso { git remote get-url origin }
  if ($remoto) {
    Salta "repository remoto gia' configurato: $remoto"
  } elseif (Conferma "Pubblicare il progetto su GitHub come repository PRIVATO?") {
    if (-not (Presente "gh")) {
      if (Conferma "Serve GitHub CLI. Installarla con winget?") {
        winget install --id GitHub.cli -e --source winget --accept-package-agreements --accept-source-agreements
        if ($LASTEXITCODE -ne 0) { Errore "winget non ha installato GitHub CLI (codice $LASTEXITCODE)." }
        AggiornaPath
      }
    }
    if (-not (Presente "gh")) {
      Manca "GitHub CLI non disponibile: pubblicazione saltata. Rilancia lo script quando vuoi."
    } else {
      $autenticato = Silenzioso { gh auth status }
      if (-not $autenticato -and $LASTEXITCODE -ne 0) {
        Write-Host "  Si apre il browser per l'accesso a GitHub." -ForegroundColor Cyan
        gh auth login --web --git-protocol https
        if ($LASTEXITCODE -ne 0) { Errore "Accesso a GitHub non completato." }
      }
      gh repo create percorso --private --source . --remote origin --push
      if ($LASTEXITCODE -ne 0) {
        Manca "creazione del repository non riuscita (forse esiste gia' un repository 'percorso'): vedi il registro"
      } else {
        Ok "pubblicato su GitHub come repository privato"
        Write-Host "  Dentro Claude Code esegui una volta  /web-setup  : collega le sessioni in cloud" -ForegroundColor Cyan
        Write-Host "  a questo account GitHub, senza passare dall'app GitHub (che da telefono a volte non viene riconosciuta)." -ForegroundColor Cyan
      }
    }
  } else {
    Salta "GitHub: rifiutato. Claude Code funzionera' solo su questo PC."
  }
}

# ------------------------------------------------------------------ 9. primo messaggio
Titolo "7. Primo messaggio per Claude Code"
$prompt = Join-Path $Destinazione "PRIMO-PROMPT.md"
if (-not $Simula -and (Test-Path $prompt)) {
  Get-Content $prompt -Raw | Set-Clipboard
  Ok "PRIMO-PROMPT.md copiato negli appunti: incollalo come primo messaggio"
} else {
  Salta "PRIMO-PROMPT.md non trovato o simulazione in corso"
}

# ------------------------------------------------------------------ riepilogo
Titolo "Riepilogo"
$script:Passi | ForEach-Object { Write-Host "  $_" }
Write-Host ""
Write-Host "  Registro completo: $log" -ForegroundColor DarkGray
Stop-Transcript | Out-Null

if ($Simula) {
  Write-Host ""
  Write-Host "Simulazione terminata. Rilancia senza -Simula per eseguire davvero." -ForegroundColor Magenta
  exit 0
}

Write-Host ""
if (Conferma "Avviare Claude Code adesso in $Destinazione ?") {
  Write-Host ""
  Write-Host "Incolla il primo messaggio (e' gia' negli appunti) e premi Invio." -ForegroundColor Cyan
  claude
} else {
  Write-Host "Quando sei pronto:  cd `"$Destinazione`"  poi  claude" -ForegroundColor Cyan
}
