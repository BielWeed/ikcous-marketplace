# Verificar_Completo.ps1
# Setup de diagnostico e verificacao do backend IKCOUS (Portatil)

$scriptDir = $PSScriptRoot
if ([string]::IsNullOrEmpty($scriptDir)) {
    $scriptDir = Get-Location
}
$workspacePath = (Resolve-Path (Join-Path $scriptDir "..\..")).Path
$reportPath = Join-Path $scriptDir "relatorio_verificacao.md"
$logDate = Get-Date -Format "yyyy-MM-dd HH:mm:ss"

# Header
Write-Host "==========================================================" -ForegroundColor Cyan
Write-Host "  DIAGNOSTICO COMPLETO DO BACKEND - IKCOUS MARKETPLACE   " -ForegroundColor Cyan
Write-Host "==========================================================" -ForegroundColor Cyan
Write-Host "Iniciando verificacao em: $logDate`n" -ForegroundColor Gray

$reportContent = "# Relatorio de Verificacao do Backend (IKCOUS)" + "`n"
$reportContent += "**Data/Hora:** $logDate" + "`n`n"
$reportContent += "## Diagnostico do Ambiente" + "`n"

# 1. Verificar Versoes das Ferramentas
Write-Host "[*] Verificando ferramentas..." -ForegroundColor Yellow

$nodeVer = try { (node -v 2>&1).Trim() } catch { "Não instalado" }
$denoVer = try { (deno --version 2>&1 | Select-Object -First 1).Trim() } catch { "Não instalado" }
$supabaseVer = try { (supabase --version 2>&1).Trim() } catch { "Não instalado" }

# Docker running check
$dockerRunning = $false
try {
    $null = docker ps 2>&1
    if ($LASTEXITCODE -eq 0) {
        $dockerRunning = $true
    }
} catch {}

$dockerStatus = if ($dockerRunning) { "Em execucao" } else { "Inativo (Docker Desktop nao iniciado)" }

$reportContent += "- **Node.js:** $nodeVer" + "`n"
$reportContent += "- **Deno:** $denoVer" + "`n"
$reportContent += "- **Supabase CLI:** $supabaseVer" + "`n"
$reportContent += "- **Docker:** $dockerStatus" + "`n"

# 2. Executar Static Analysis (ESLint & TypeScript Typecheck)
Write-Host "[*] Executando analise estatica do frontend..." -ForegroundColor Yellow
$eslintStatus = "Sucesso"
$typecheckStatus = "Sucesso"

Push-Location $workspacePath

# ESLint
$eslintOut = try {
    npx eslint . --max-warnings=0 2>&1
} catch {
    $_
}
if ($LASTEXITCODE -ne 0) {
    $eslintStatus = "Falhou"
    Write-Host "[X] ESLint encontrou erros!" -ForegroundColor Red
} else {
    Write-Host "[OK] ESLint passou com sucesso." -ForegroundColor Green
}

# Typecheck
$typecheckOut = try {
    npx tsc --noEmit 2>&1
} catch {
    $_
}
if ($LASTEXITCODE -ne 0) {
    $typecheckStatus = "Falhou"
    Write-Host "[X] Typecheck encontrou erros!" -ForegroundColor Red
} else {
    Write-Host "[OK] Typecheck passou com sucesso." -ForegroundColor Green
}

# 3. Deno Lint
Write-Host "[*] Executando Deno Lint nas Edge Functions..." -ForegroundColor Yellow
$denoLintStatus = "Sucesso"
$denoLintOut = try {
    deno lint supabase/functions 2>&1
} catch {
    $_
}
if ($LASTEXITCODE -ne 0) {
    $denoLintStatus = "Avisos/Erros Encontrados (Veja detalhes no console)"
    Write-Host "[X] Deno Lint encontrou problemas." -ForegroundColor Yellow
} else {
    Write-Host "[OK] Deno Lint sem problemas." -ForegroundColor Green
}

# 4. Deno Test
Write-Host "[*] Executando testes unitarios do Deno..." -ForegroundColor Yellow
$denoTestStatus = "Sucesso"
$denoTestOut = try {
    deno test --allow-all supabase/functions/calculate-shipping/index_test.ts 2>&1
} catch {
    $_
}
if ($LASTEXITCODE -ne 0) {
    $denoTestStatus = "Falhou"
    Write-Host "[X] Testes unitarios do Deno falharam!" -ForegroundColor Red
} else {
    Write-Host "[OK] Testes unitarios do Deno passaram com sucesso." -ForegroundColor Green
}

# 5. Database Checks
$dbLintStatus = "Ignorado"
$dbTestStatus = "Ignorado"

if ($dockerRunning) {
    Write-Host "[*] Docker ativo. Executando testes de banco..." -ForegroundColor Yellow
    # DB Lint
    $dbLintOut = try {
        supabase db lint 2>&1
    } catch {
        $_
    }
    if ($LASTEXITCODE -ne 0) {
        $dbLintStatus = "Falhou"
        Write-Host "[X] supabase db lint encontrou problemas!" -ForegroundColor Red
    } else {
        $dbLintStatus = "Sucesso"
        Write-Host "[OK] supabase db lint passou com sucesso." -ForegroundColor Green
    }

    # DB Test
    $dbTestOut = try {
        supabase test db 2>&1
    } catch {
        $_
    }
    if ($LASTEXITCODE -ne 0) {
        $dbTestStatus = "Falhou"
        Write-Host "[X] Testes pgTAP falharam!" -ForegroundColor Red
    } else {
        $dbTestStatus = "Sucesso"
        Write-Host "[OK] Testes pgTAP passaram com sucesso." -ForegroundColor Green
    }
} else {
    Write-Host "[!] Docker inativo. Pulando testes locais de banco de dados." -ForegroundColor Yellow
}

Pop-Location

# Build Report Markdown
$reportContent += "`n## Resumo dos Testes e Validacoes" + "`n`n"
$reportContent += "| Etapa | Status | Observacao |" + "`n"
$reportContent += "| :--- | :--- | :--- |" + "`n"
$reportContent += "| **ESLint (Frontend)** | $eslintStatus | Analise estatica do projeto React |" + "`n"
$reportContent += "| **Typecheck (TypeScript)** | $typecheckStatus | Validacao de tipos estaticos |" + "`n"
$reportContent += "| **Deno Lint (Edge Functions)** | $denoLintStatus | Analise estatica do codigo TypeScript Deno |" + "`n"
$reportContent += "| **Deno Test (Edge Functions)** | $denoTestStatus | Testes unitarios de frete/regras de negocio |" + "`n"
$reportContent += "| **Supabase DB Lint** | $dbLintStatus | Validacao de integridade de esquema Postgres |" + "`n"
$reportContent += "| **Supabase pgTAP Tests** | $dbTestStatus | Testes unitarios de banco de dados e politicas RLS |" + "`n"

$reportContent += "`n## Detalhes das Execucoes" + "`n`n"

$reportContent += "### ESLint Output (Primeiras 30 linhas se houver erro)" + "`n"
$reportContent += '```text' + "`n"
$reportContent += "$($eslintOut | Select-Object -First 30 | Out-String)" + "`n"
$reportContent += '```' + "`n`n"

$reportContent += "### Typecheck Output (Primeiras 30 linhas se houver erro)" + "`n"
$reportContent += '```text' + "`n"
$reportContent += "$($typecheckOut | Select-Object -First 30 | Out-String)" + "`n"
$reportContent += '```' + "`n`n"

$reportContent += "### Deno Lint Output" + "`n"
$reportContent += '```text' + "`n"
$reportContent += "$($denoLintOut | Select-Object -First 20 | Out-String)" + "`n"
$reportContent += '```' + "`n`n"

$reportContent += "### Deno Test Output" + "`n"
$reportContent += '```text' + "`n"
$reportContent += "$($denoTestOut | Out-String)" + "`n"
$reportContent += '```' + "`n"

if ($dockerRunning) {
    $reportContent += "`n### Supabase DB Lint Output" + "`n"
    $reportContent += '```text' + "`n"
    $reportContent += "$($dbLintOut | Out-String)" + "`n"
    $reportContent += '```' + "`n`n"

    $reportContent += "### Supabase pgTAP Output" + "`n"
    $reportContent += '```text' + "`n"
    $reportContent += "$($dbTestOut | Out-String)" + "`n"
    $reportContent += '```' + "`n"
} else {
    $reportContent += "`n> [!WARNING]" + "`n"
    $reportContent += "> O Docker Desktop nao estava em execucao. As validacoes dinamicas de banco de dados foram puladas." + "`n"
}

# Save Report
$reportContent | Out-File -FilePath $reportPath -Encoding utf8

Write-Host "`n==========================================================" -ForegroundColor Cyan
Write-Host "  Verificacao concluida!" -ForegroundColor Green
Write-Host "  Relatorio salvo em: $reportPath" -ForegroundColor Green
Write-Host "==========================================================" -ForegroundColor Cyan
