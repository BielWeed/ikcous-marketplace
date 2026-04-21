@echo off
echo [NINJA] Iniciando Purga de Processos MCP Zumbis...
taskkill /F /IM node.exe /T
echo [NINJA] Limpando cache de logs...
del "C:\Users\Gabriel\.gemini\antigravity\mcp_modules\ninja-monolith.log"
echo [NINJA] Sistema limpo. Por favor, de RESTART no servidor na IDE agora.
pause
