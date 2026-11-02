@echo off
cd /d "%~dp0"
node --env-file-if-exists="%~dp0.env.local" "%~dp0server.mjs"
pause
