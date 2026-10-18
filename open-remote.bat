@echo off
title Kashrut - open on the other computer
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0open-remote.ps1"
if errorlevel 1 pause
