@echo off
chcp 65001 > nul

cd /d "C:\Users\Gabriel\Downloads\app_mkt"

:: Inicializar variáveis de status
set "STATUS_TYPECHECK=Pendente"
set "STATUS_ESLINT=Pendente"
set "STATUS_KNIP=Pendente"
set "STATUS_DEPCHECK=Pendente"
set "STATUS_JSCPD=Pendente"
set "STATUS_SQLFLUFF=Pendente"
set "STATUS_NPMAUDIT=Pendente"
set "STATUS_SECRETLINT=Pendente"
set "STATUS_DEPCRUISE=Pendente"
set "STATUS_SEMGREP=Pendente"
set "STATUS_MARKDOWNLINT=Pendente"

:: --- 1. TYPESCRIPT TYPECHECK ---
echo Executando Verificação de Tipos TypeScript...
call npx tsc --noEmit
if %errorlevel% equ 0 (
    set "STATUS_TYPECHECK=SUCESSO (Sem erros de tipos)"
) else (
    set "STATUS_TYPECHECK=FALHA   (Erros de tipos encontrados)"
)

:: --- 2. ESLINT LINTER ---
echo Executando ESLint (Linter Frontend)...
call npx eslint .
if %errorlevel% equ 0 (
    set "STATUS_ESLINT=SUCESSO (Sem erros de linting)"
) else (
    set "STATUS_ESLINT=FALHA   (Erros/Avisos encontrados)"
)

:: --- 3. KNIP (CÓDIGO MORTO) ---
echo Executando Knip (Detector de Código Morto)...
call npx knip
if %errorlevel% equ 0 (
    set "STATUS_KNIP=SUCESSO (Nenhum código morto detectado)"
) else (
    set "STATUS_KNIP=FALHA   (Código morto/órfão encontrado)"
)

:: --- 4. DEPCHECK ---
echo Executando Depcheck (Checagem de package.json)...
call npx depcheck
if %errorlevel% equ 0 (
    set "STATUS_DEPCHECK=SUCESSO (Dependências limpas)"
) else (
    set "STATUS_DEPCHECK=AVISO   (Dependências obsoletas/não usadas)"
)

:: --- 5. JSCPD (CÓDIGO DUPLICADO) ---
echo Executando JSCPD (Detector de Código Duplicado)...
call npx jscpd src --ignore "**/.vercel/**,**/node_modules/**,**/dist/**"
if %errorlevel% equ 0 (
    set "STATUS_JSCPD=SUCESSO (Sem código duplicado)"
) else (
    set "STATUS_JSCPD=AVISO   (Duplicações encontradas)"
)

:: --- 6. SQLFLUFF (MIGRAÇÕES SQL) ---
echo Executando SQLFluff (Linter de Migrações)...
set "SQLFLUFF_BIN=sqlfluff"
where sqlfluff >nul 2>nul
if %errorlevel% equ 0 goto run_sqlfluff
set "SQLFLUFF_FALLBACK_1=%USERPROFILE%\AppData\Roaming\Python\Python313\Scripts\sqlfluff.exe"
if exist "%SQLFLUFF_FALLBACK_1%" (
    set "SQLFLUFF_BIN=%SQLFLUFF_FALLBACK_1%"
    goto run_sqlfluff
)
for /d %%D in ("%USERPROFILE%\AppData\Roaming\Python\Python*") do (
    if exist "%%D\Scripts\sqlfluff.exe" (
        set "SQLFLUFF_BIN=%%D\Scripts\sqlfluff.exe"
        goto run_sqlfluff
    )
)
set "STATUS_SQLFLUFF=PULADO  (SQLFluff não instalado)"
goto end_sqlfluff

:run_sqlfluff
call "%SQLFLUFF_BIN%" lint supabase --dialect postgres
if %errorlevel% equ 0 (
    set "STATUS_SQLFLUFF=SUCESSO (SQL de migrações limpo)"
) else (
    set "STATUS_SQLFLUFF=FALHA   (Erros de estilo/sintaxe SQL)"
)
:end_sqlfluff

:: --- 7. NPM SECURITY AUDIT ---
echo Executando NPM Security Audit (Segurança)...
call npm audit
if %errorlevel% equ 0 (
    set "STATUS_NPMAUDIT=SUCESSO (Nenhuma vulnerabilidade crítica)"
) else (
    set "STATUS_NPMAUDIT=AVISO   (Vulnerabilidades detectadas)"
)

:: --- 8. SECRETLINT (CREDENCIAIS) ---
echo Executando Secretlint (Segurança de Segredos)...
call npx @secretlint/quick-start "**/*"
if %errorlevel% equ 0 (
    set "STATUS_SECRETLINT=SUCESSO (Nenhum segredo vazado)"
) else (
    set "STATUS_SECRETLINT=FALHA   (Segredos expostos no código!)"
)

:: --- 9. DEPENDENCY-CRUISER (GRAFO DE DEPENDÊNCIAS) ---
echo Executando Dependency-Cruiser (Arquitetura)...
if exist ".dependency-cruiser.js" (
    call npx depcruise src --config .dependency-cruiser.js
) else (
    call npx depcruise src
)
if %errorlevel% equ 0 (
    set "STATUS_DEPCRUISE=SUCESSO (Grafo de importações limpo)"
) else (
    set "STATUS_DEPCRUISE=FALHA   (Erros de acoplamento/circularidade)"
)

:: --- 10. SEMGREP (SAST SEGURANÇA) ---
echo Executando Semgrep (Análise de Vulnerabilidades)...
set "SEMGREP_BIN="
where semgrep >nul 2>nul
if %errorlevel% equ 0 (
    set "SEMGREP_BIN=semgrep"
) else (
    set "SEMGREP_FALLBACK_1=%USERPROFILE%\AppData\Roaming\Python\Python313\Scripts\semgrep.exe"
    if exist "%SEMGREP_FALLBACK_1%" (
        set "SEMGREP_BIN=%SEMGREP_FALLBACK_1%"
    ) else (
        for /d %%D in ("%USERPROFILE%\AppData\Roaming\Python\Python*") do (
            if exist "%%D\Scripts\semgrep.exe" (
                set "SEMGREP_BIN=%%D\Scripts\semgrep.exe"
            )
        )
    )
)
if "%SEMGREP_BIN%"=="" (
    set "STATUS_SEMGREP=PULADO  (Semgrep não instalado)"
) else (
    call "%SEMGREP_BIN%" --config=auto
    if %errorlevel% equ 0 (
        set "STATUS_SEMGREP=SUCESSO (Nenhuma falha SAST detectada)"
    ) else (
        set "STATUS_SEMGREP=AVISO   (Potenciais falhas de segurança)"
    )
)

:: --- 11. MARKDOWNLINT (ESTILO MD) ---
echo Executando Markdownlint (Estilo de Documentos)...
call npx markdownlint "**/*.md" --ignore "node_modules" --ignore "dist" --ignore "package-lock.json"
if %errorlevel% equ 0 (
    set "STATUS_MARKDOWNLINT=SUCESSO (Estilo Markdown validado)"
) else (
    set "STATUS_MARKDOWNLINT=AVISO   (Desvios de estilo markdown)"
)

:: --- PAINEL DE RESULTADOS CONSOLIDADO ---
echo.
echo ====================================================================
echo             PAINEL CONSOLIDADO DE QUALIDADE E LINTERS
echo ====================================================================
echo.
echo [1] TypeScript Typecheck:   %STATUS_TYPECHECK%
echo [2] ESLint Linter:          %STATUS_ESLINT%
echo [3] Knip Código Morto:      %STATUS_KNIP%
echo [4] Depcheck Dependências:  %STATUS_DEPCHECK%
echo [5] JSCPD Copia-Cola:       %STATUS_JSCPD%
echo [6] SQLFluff Migrações:     %STATUS_SQLFLUFF%
echo [7] NPM Security Audit:     %STATUS_NPMAUDIT%
echo [8] Secretlint (Segredos):  %STATUS_SECRETLINT%
echo [9] Dependency-Cruiser:     %STATUS_DEPCRUISE%
echo [10] Semgrep SAST:          %STATUS_SEMGREP%
echo [11] Markdownlint (Estilo): %STATUS_MARKDOWNLINT%
echo.
echo ====================================================================
