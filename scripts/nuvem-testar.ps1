<#
.SYNOPSIS
  Roda uma suite de testes na maquina do GitHub (workflow "Rodar na nuvem") e
  traz o resultado de volta para este terminal.

.DESCRIPTION
  1. Descobre o SHA (padrao: HEAD). Se ele ainda nao esta em nenhuma branch do
     GitHub, empurra para uma branch temporaria claude/nuvem-<sha12> (apagada no fim; os hooks de
     git rodam normalmente; nada de --no-verify).
  2. Dispara .github/workflows/rodar-na-nuvem.yml com `gh workflow run`.
  3. Acha a execucao pela etiqueta unica (-f marca=...) e acompanha com
     `gh run watch`.
  4. Imprime maquina (nome do runner) e tempo; se falhou, imprime as linhas
     que falharam (`gh run view --log-failed`).

  So o que esta COMMITADO vai para a nuvem; mudanca nao commitada fica de fora
  (o script avisa). Repositorio publico = minutos de Actions gratuitos.

  Requisitos: git e gh no PATH, e `gh auth login` ja feito (a credencial e do
  dono; este script nunca pede nem le senha ou token).

.PARAMETER Suite
  front   = npx vitest run (suite inteira de tests/front)
  unit    = npm run test:unit (Deno, tests/)
  edge    = npm run test:edge (Deno, supabase/functions/)
  arquivo = vitest de UM caminho em tests/front/ (use com -Arquivo)

.PARAMETER Arquivo
  Caminho em tests/front/ (so para -Suite arquivo).

.PARAMETER Sha
  Commit a testar. Padrao: HEAD.

.PARAMETER WorkflowRef
  Branch de onde sai a definicao do workflow (o arquivo precisa JA existir na
  branch padrao: o GitHub nao dispara workflow que so existe em outra branch).
  Serve para testar uma edicao do workflow numa branch. Padrao: branch padrao do
  repositorio.

.EXAMPLE
  powershell -File scripts\nuvem-testar.ps1 -Suite front

.EXAMPLE
  powershell -File scripts\nuvem-testar.ps1 -Suite arquivo -Arquivo tests/front/mappers.test.ts
#>
param(
    [Parameter(Mandatory = $true)]
    [ValidateSet('front', 'unit', 'edge', 'arquivo')]
    [string]$Suite,
    [string]$Arquivo = '',
    [string]$Sha = 'HEAD',
    [string]$WorkflowRef = '',
    [string]$Repo = 'BielWeed/ikcous-marketplace'
)

# Continue (nao Stop): no PowerShell 5.1 o stderr de programa nativo vira erro
# fatal com Stop. Os codigos de saida sao conferidos um a um.
$ErrorActionPreference = 'Continue'
$arquivoWorkflow = 'rodar-na-nuvem.yml'

function Falha([string]$mensagem) {
    Write-Host "ERRO: $mensagem" -ForegroundColor Red
    exit 1
}

if (-not (Get-Command git -ErrorAction SilentlyContinue)) { Falha 'git nao encontrado no PATH.' }
if (-not (Get-Command gh -ErrorAction SilentlyContinue)) { Falha 'gh (GitHub CLI) nao encontrado no PATH.' }

if ($Suite -eq 'arquivo') {
    if ($Arquivo -cnotmatch '^tests/front/[A-Za-z0-9_./-]+$' -or $Arquivo -match '\.\.') {
        Falha 'com -Suite arquivo, passe -Arquivo dentro de tests/front/ (so letras, numeros, ponto, barra, hifen, underscore; maiusculas e minusculas contam).'
    }
}
elseif ($Arquivo -ne '') {
    Falha '-Arquivo so vale com -Suite arquivo.'
}

$shaCompleto = (& git rev-parse --verify "$Sha^{commit}" 2>$null)
if ($LASTEXITCODE -ne 0 -or -not $shaCompleto) { Falha "commit nao encontrado: $Sha" }
$shaCompleto = $shaCompleto.Trim()
$sha12 = $shaCompleto.Substring(0, 12)

$sujo = (& git status --porcelain)
if ($sujo) {
    Write-Host "AVISO: ha mudancas nao commitadas; elas NAO vao para a nuvem (so o commit $sha12)." -ForegroundColor Yellow
}

if (-not $WorkflowRef) {
    $WorkflowRef = (& gh repo view $Repo --json defaultBranchRef -q .defaultBranchRef.name)
    if ($LASTEXITCODE -ne 0 -or -not $WorkflowRef) { Falha 'nao consegui ler a branch padrao (gh auth login feito?).' }
    $WorkflowRef = $WorkflowRef.Trim()
}

# 1. O commit precisa existir no GitHub.
$temporaria = $null
$emRemoto = (& git branch -r --contains $shaCompleto 2>$null)
if (-not $emRemoto) {
    # Prefixo claude/ de proposito: a Vercel nao faz previa de claude/** (o
    # vercel.json desliga) e nenhum workflow escuta push nessa familia.
    $temporaria = "claude/nuvem-$sha12"
    Write-Host "Empurrando $sha12 para a branch temporaria $temporaria ..."
    & git push origin "${shaCompleto}:refs/heads/$temporaria" --force
    if ($LASTEXITCODE -ne 0) { Falha 'git push falhou (veja a mensagem acima; hooks de git rodam e nao devem ser pulados).' }
}
else {
    Write-Host "Commit $sha12 ja esta no GitHub; sem push."
}

# 2. Dispara.
$marca = 'n' + (Get-Date -Format 'yyyyMMddHHmmss') + (Get-Random -Maximum 999)
$inicio = Get-Date
Write-Host "Disparando '$Suite' (definicao do workflow: $WorkflowRef, etiqueta: $marca) ..."
$argsDisparo = @('workflow', 'run', $arquivoWorkflow, '-R', $Repo, '--ref', $WorkflowRef,
    '-f', "ref=$shaCompleto", '-f', "suite=$Suite", '-f', "marca=$marca")
if ($Suite -eq 'arquivo') { $argsDisparo += @('-f', "arquivo=$Arquivo") }
& gh @argsDisparo
if ($LASTEXITCODE -ne 0) {
    Falha "gh workflow run falhou. O GitHub so aceita disparar um workflow que ja existe na branch padrao do repositorio; se este arquivo ainda nao foi juntado la, junte o PR primeiro."
}

# 3. Acha a execucao pela etiqueta (o titulo da execucao leva [marca]).
$idExecucao = $null
for ($i = 0; $i -lt 30 -and -not $idExecucao; $i++) {
    Start-Sleep -Seconds 4
    $json = (& gh run list -R $Repo --workflow $arquivoWorkflow --event workflow_dispatch -L 20 --json databaseId,displayTitle)
    if ($LASTEXITCODE -eq 0 -and $json) {
        $achada = ($json | ConvertFrom-Json) | Where-Object { $_.displayTitle -like "*[[]$marca]*" } | Select-Object -First 1
        if ($achada) { $idExecucao = $achada.databaseId }
    }
}
if (-not $idExecucao) { Falha 'a execucao nao apareceu em 2 minutos; veja: gh run list --workflow rodar-na-nuvem.yml' }
Write-Host "Execucao: https://github.com/$Repo/actions/runs/$idExecucao"

# 4. Acompanha ate terminar.
& gh run watch $idExecucao -R $Repo --exit-status --interval 10
$codigo = $LASTEXITCODE

# 5. Resumo: maquina e tempo (vem da API de jobs).
$jobs = (& gh api "repos/$Repo/actions/runs/$idExecucao/jobs" | ConvertFrom-Json).jobs
$terminou = $true
foreach ($job in $jobs) {
    Write-Host ''
    Write-Host "Job:       $($job.name)"
    Write-Host "Resultado: $($job.conclusion)"
    Write-Host "Maquina:   $($job.runner_name) (grupo: $($job.runner_group_name))"
    if ($job.completed_at -and $job.started_at) {
        $segundos = [int](([datetime]$job.completed_at) - ([datetime]$job.started_at)).TotalSeconds
        Write-Host "Tempo job: $segundos s"
    }
    else {
        $terminou = $false
        Write-Host 'Tempo job: ainda em andamento'
    }
}
if (-not $terminou) {
    Write-Host "A execucao ainda nao terminou (o acompanhamento caiu?). Retome com: gh run watch $idExecucao -R $Repo" -ForegroundColor Yellow
    exit 2
}
# A branch temporaria ja cumpriu o papel (a execucao guarda o commit). Apaga
# pela API, sem passar pelo hook de pre-push (que rodaria o typecheck de novo).
if ($temporaria) {
    & gh api -X DELETE "repos/$Repo/git/refs/heads/$temporaria" 2>$null | Out-Null
    if ($LASTEXITCODE -eq 0) { Write-Host "Branch temporaria $temporaria apagada." }
}
$total = [int]((Get-Date) - $inicio).TotalSeconds
Write-Host "Tempo desde o disparo (inclui fila): $total s"

if ($codigo -ne 0) {
    Write-Host ''
    Write-Host '--- linhas que falharam ---' -ForegroundColor Red
    & gh run view $idExecucao -R $Repo --log-failed
    exit $codigo
}
Write-Host 'VERDE na nuvem.' -ForegroundColor Green
exit 0
