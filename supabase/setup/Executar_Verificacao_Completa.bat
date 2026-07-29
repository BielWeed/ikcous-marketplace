@echo off
title Verificar Completo - Backend IKCOUS
echo Iniciando script de verificacao completa do backend...
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0Verificar_Completo.ps1"
echo.
echo Pressione qualquer tecla para fechar...
pause > nul
