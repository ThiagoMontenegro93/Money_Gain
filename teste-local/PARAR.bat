@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo Parando o LendControl (os dados continuam guardados)...
docker compose --env-file .env.local down
pause
