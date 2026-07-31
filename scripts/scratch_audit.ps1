$OutputEncoding = [System.Text.Encoding]::UTF8
$status_typecheck = "Pendente"
$status_eslint = "Pendente"
$status_knip = "Pendente"
$status_depcheck = "Pendente"
$status_jscpd = "Pendente"
$status_sqlfluff = "Pendente"
$status_npmaudit = "Pendente"
$status_secretlint = "Pendente"
$status_depcruise = "Pendente"
$status_semgrep = "Pendente"
$status_markdownlint = "Pendente"

Write-Host "======================================================="
Write-Host " Executando Suíte de Auditoria de Qualidade (PowerShell)"
Write-Host "======================================================="

# 1. TypeScript
Write-Host "`n[1/11] Executando TypeScript Typecheck..."
npx tsc --noEmit
if ($LASTEXITCODE -eq 0) {
    $status_typecheck = "SUCESSO (Sem erros de tipos)"
} else {
    $status_typecheck = "FALHA   (Erros encontrados)"
}

# 2. ESLint
Write-Host "`n[2/11] Executando ESLint..."
npx eslint .
if ($LASTEXITCODE -eq 0) {
    $status_eslint = "SUCESSO (Sem erros de linting)"
} else {
    $status_eslint = "FALHA   (Erros/Avisos encontrados)"
}

# 3. Knip
Write-Host "`n[3/11] Executando Knip..."
npx knip
if ($LASTEXITCODE -eq 0) {
    $status_knip = "SUCESSO (Sem código morto)"
} else {
    $status_knip = "FALHA   (Código morto encontrado)"
}

# 4. Depcheck
Write-Host "`n[4/11] Executando Depcheck..."
npx depcheck
if ($LASTEXITCODE -eq 0) {
    $status_depcheck = "SUCESSO (Sem problemas)"
} else {
    $status_depcheck = "AVISO   (Dependências obsoletas/não usadas)"
}

# 5. JSCPD
Write-Host "`n[5/11] Executando JSCPD..."
npx jscpd src --ignore "**/.vercel/**,**/node_modules/**,**/dist/**"
if ($LASTEXITCODE -eq 0) {
    $status_jscpd = "SUCESSO (Sem duplicidade)"
} else {
    $status_jscpd = "AVISO   (Duplicações encontradas)"
}

# 6. SQLFluff
Write-Host "`n[6/11] Executando SQLFluff..."
sqlfluff lint supabase --dialect postgres
if ($LASTEXITCODE -eq 0) {
    $status_sqlfluff = "SUCESSO (SQL de migrações limpo)"
} else {
    $status_sqlfluff = "FALHA   (Erros no SQL)"
}

# 7. NPM Audit
Write-Host "`n[7/11] Executando NPM Audit..."
npm audit
if ($LASTEXITCODE -eq 0) {
    $status_npmaudit = "SUCESSO (Sem vulnerabilidades críticas)"
} else {
    $status_npmaudit = "AVISO   (Vulnerabilidades encontradas)"
}

# 8. Secretlint
Write-Host "`n[8/11] Executando Secretlint..."
npx @secretlint/quick-start "**/*"
if ($LASTEXITCODE -eq 0) {
    $status_secretlint = "SUCESSO (Nenhum segredo vazado)"
} else {
    $status_secretlint = "FALHA   (Segredos expostos no código!)"
}

# 9. Dependency-Cruiser
Write-Host "`n[9/11] Executando Dependency-Cruiser..."
if (Test-Path ".dependency-cruiser.cjs") {
    npx depcruise src --config .dependency-cruiser.cjs
} else {
    npx depcruise src
}
if ($LASTEXITCODE -eq 0) {
    $status_depcruise = "SUCESSO (Grafo de importações limpo)"
} else {
    $status_depcruise = "FALHA   (Erros de acoplamento/circularidade)"
}

# 10. Semgrep
Write-Host "`n[10/11] Executando Semgrep..."
semgrep --config=auto
if ($LASTEXITCODE -eq 0) {
    $status_semgrep = "SUCESSO (Nenhuma falha SAST detectada)"
} else {
    $status_semgrep = "AVISO   (Potenciais falhas de segurança)"
}

# 11. Markdownlint
Write-Host "`n[11/11] Executando Markdownlint..."
npx markdownlint "**/*.md" --ignore "node_modules" --ignore "dist" --ignore "package-lock.json"
if ($LASTEXITCODE -eq 0) {
    $status_markdownlint = "SUCESSO (Estilo Markdown validado)"
} else {
    $status_markdownlint = "AVISO   (Desvios de estilo markdown)"
}

# Painel consolidado
Write-Host "`n===================================================================="
Write-Host "             PAINEL CONSOLIDADO DE QUALIDADE E LINTERS"
Write-Host "===================================================================="
Write-Host "[1] TypeScript Typecheck:   $status_typecheck"
Write-Host "[2] ESLint Linter:          $status_eslint"
Write-Host "[3] Knip Código Morto:      $status_knip"
Write-Host "[4] Depcheck Dependências:  $status_depcheck"
Write-Host "[5] JSCPD Copia-Cola:       $status_jscpd"
Write-Host "[6] SQLFluff Migrações:     $status_sqlfluff"
Write-Host "[7] NPM Security Audit:     $status_npmaudit"
Write-Host "[8] Secretlint (Segredos):  $status_secretlint"
Write-Host "[9] Dependency-Cruiser:     $status_depcruise"
Write-Host "[10] Semgrep SAST:          $status_semgrep"
Write-Host "[11] Markdownlint (Estilo): $status_markdownlint"
Write-Host "===================================================================="
