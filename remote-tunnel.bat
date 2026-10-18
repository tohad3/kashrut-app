@echo off
title Kashrut remote access - keep this window open
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0tunnel.ps1"
pause
