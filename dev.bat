@echo off
REM Wrapper: aggira l'execution policy lanciando lo script .ps1 in Bypass.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0dev-with-env.ps1"
