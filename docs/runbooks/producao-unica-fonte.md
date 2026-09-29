# Producao - fonte unica de deploy (29/09/2026)

## Como funciona

- A branch `production` e a UNICA fonte de deploy publico: os dominios
  `ickous-marketplace.vercel.app` e `brandmeliz.vercel.app` seguem os
  deployments da branch `production` (Branch Domains da Vercel).
- Ruleset `producao-unica-fonte`: todo cambio entra por PR com checks
  obrigatorios (Build e tamanho, Catraca de lint, Testes front 1/2 e 2/2,
  Testes Deno, Tipos). Sem push direto, sem force-push, sem delete.
- Builds disparados por push na `main` sao PULADOS (Ignored Build Step) -
  a linha 1.35.0 nao pode mais sobrescrever a producao.

## Release

1. PR de `claude/app-major-upgrade-wmc8x2` (ou fix pontual) para `production`.
2. Checks verdes + checklist da release.
3. Merge: a Vercel constroi e os dominios apontam para o novo deployment.

## Rollback

- Reverter o PR na `production`, ou promover o deployment anterior na Vercel.

## Rollback integral da configuracao

- Dominios: `gitBranch = null` (voltam a seguir deployments de producao).
- Ignore step: `commandForIgnoringBuildStep = null`.
- Ruleset: remover `producao-unica-fonte` (id 24166103).
