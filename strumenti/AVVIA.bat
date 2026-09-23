@echo off
chcp 65001 >nul
echo.
echo  Percorso - passaggio a Claude Code
echo  -----------------------------------
echo  Per vedere cosa succederebbe senza modificare nulla:
echo     AVVIA.bat -Simula
echo.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0avvia-percorso.ps1" %*
echo.
pause
