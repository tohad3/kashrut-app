@echo off
chcp 65001 >nul
title Kashrut App - keep this window open
cd /d "%~dp0"
set "NODE=%LOCALAPPDATA%\nodejs-portable\node-v24.21.0-win-x64\node.exe"
if not exist "%NODE%" set "NODE=node"
rem open the browser two seconds later, after the server is up
start "" /min cmd /c "timeout /t 2 /nobreak >nul & start http://localhost:3000"
"%NODE%" server.js
echo.
echo The server stopped. If port 3000 is already in use, close the other window first.
pause
