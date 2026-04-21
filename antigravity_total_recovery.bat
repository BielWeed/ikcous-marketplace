@echo off
setlocal enabledelayedexpansion

echo #   ANTIGRAVITY TOTAL RECOVERY - SOLO-NINJA    #
echo #   Limpando Sandbox Bug (Protocolo Omega)     #
echo ################################################
echo.

:: Verifica Privilegios de Administrador
net session >nul 2>&1
if %errorLevel% NEQ 0 (
    echo [ERRO] Por favor, execute este script como ADMINISTRADOR.
    echo Clique com o botao direito e selecione 'Executar como administrador'.
    pause
    exit /b 1
)

echo [1/5] Encerrando Antigravity e processos Ninja...
taskkill /F /IM Antigravity.exe /T 2>nul
taskkill /F /IM node.exe /T 2>nul
timeout /t 2 >nul

echo [2/5] Purgando caches e estado global (SQLite)...
set "AG_DATA=%APPDATA%\Antigravity"
if exist "!AG_DATA!\Cache" rmdir /S /Q "!AG_DATA!\Cache"
if exist "!AG_DATA!\CachedData" rmdir /S /Q "!AG_DATA!\CachedData"
if exist "!AG_DATA!\Local Storage" rmdir /S /Q "!AG_DATA!\Local Storage"
echo [OK] Cache de estado limpo.

echo [3/5] Neutralizando Extensao de Sandbox (Claude Hijack)...
set "AG_PROG=%LOCALAPPDATA%\Programs\Antigravity\resources\app\extensions"
if exist "!AG_PROG!\antigravity-code-executor" (
    echo [MOVE] Movendo extensao intrusa para .OLD...
    move "!AG_PROG!\antigravity-code-executor" "!AG_PROG!\antigravity-code-executor.OLD"
) else (
    echo [SKIP] Extensao ja neutralizada ou nao encontrada.
)

echo [4/5] Disparando Ninja Nexus Omega v8.6.1...
if exist "C:\Users\Gabriel\.gemini\antigravity\mcp_modules\super-boot-nexus.ps1" (
    powershell -ExecutionPolicy Bypass -File "C:\Users\Gabriel\.gemini\antigravity\mcp_modules\super-boot-nexus.ps1"
) else (
    echo [AVISO] Script de boot Omega nao encontrado.
)

echo.
echo [5/5] SUCESSO! O Antigravity foi purificado.
echo.
echo INSTRUCOES FINAIS:
echo 1. Abra o Antigravity IDE normalmente.
echo 2. O Ninja Shell deve reaparecer nos MCP Servers.
echo 3. O erro de Sandbox no chat deve ter sumido.
echo.
pause
