@echo off
chcp 65001 >nul
title LendControl Pro - e-mail do backup
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0iniciar.ps1" -ConfigurarEmail
pause
