# Producao - fonte unica de deploy (29/09/2026, corrigido 30/09/2026)

## Como funciona

- A branch `production` e a UNICA fonte de deploy publico. Mas SO a loja PRINCIPAL
  a segue: apenas `ickous-marketplace.vercel.app` acompanha os deployments da branch
  `production` (Branch Domain da Vercel).
- As 4 lojas clientes (`almeidastore`, `savycollection`, `brandmeliz` e
  `spacelojadoskit`, todas `.vercel.app`) NAO seguem a branch: servem o target
  Production do proprio projeto e recebem o front por `npx vercel --prod`, de uma
  worktree limpa no SHA publicado (secao "Front das lojas clientes").
- Correcao de 30/09/2026: ate esta data este arquivo dizia que `brandmeliz.vercel.app`
  tambem seguia a branch. Nao segue. Por que importa: deployment PREVIEW nao tem as
  variaveis `IKCOUS_FROTA_*` (elas so existem em Production), a caderneta fica
  `ausente` e o dominio cliente passa a mostrar a loja PRINCIPAL - foi o que aconteceu
  com a Brand Meliz de 29/09 08:21Z ate 30/09.
- Ruleset `producao-unica-fonte`: todo cambio entra por PR com checks
  obrigatorios (Build e tamanho, Catraca de lint, Testes front 1/2 e 2/2,
  Testes Deno, Tipos). Sem push direto, sem force-push, sem delete.
- Builds disparados por push na `main` sao PULADOS (Ignored Build Step) -
  a linha 1.35.0 nao pode mais sobrescrever a producao.

## Release

1. PR de `claude/app-major-upgrade-wmc8x2` (ou fix pontual) para `production`.
2. Checks verdes + checklist da release.
3. Merge: a Vercel constroi e `ickous-marketplace.vercel.app` aponta para o novo
   deployment. As lojas clientes NAO se movem sozinhas: cada uma recebe o front pelo
   passo da secao abaixo, e so depois das functions e migrations dela.

## Front das lojas clientes

Para cada loja cliente (almeidastore, savycollection, brandmeliz, spacelojadoskit):

1. Worktree limpa no SHA publicado (o mesmo `<sha40>` que foi para `production`), sem
   arquivo solto, dentro do projeto Vercel DAQUELA loja.
2. Publicar no target Production, informando o SHA duas vezes ao build:

```powershell
npx vercel --prod --build-env IKCOUS_CODE_SHA=<sha40> --build-env VERCEL_GIT_COMMIT_SHA=<sha40>
```

3. Conferir `https://<dominio-da-loja>/version.json`: o `codeSha` tem de ser o
   `<sha40>` publicado, e a tela tem de mostrar a PROPRIA loja, nunca a principal.
   Caderneta `ausente` ou loja principal aparecendo no dominio cliente = o deploy
   saiu como Preview, sem as `IKCOUS_FROTA_*`. Refazer com `--prod`.

`vercel` sem `--prod` cria Preview: nunca usar nas lojas clientes.

## Edge functions por loja

| Loja | Como publica as functions |
|---|---|
| Principal (`ickous-marketplace`) | Workflow `publicar-functions.yml`, `projeto=loja` |
| Savy | Workflow, `projeto=savy` (token proprio `SUPABASE_ACCESS_TOKEN_SAVY`) |
| Almeida | Workflow, `projeto=almeida` (mesmo `SUPABASE_ACCESS_TOKEN` da loja) |
| Brand Meliz | Sem rota: o projeto Supabase esta em conta que o token nao alcanca |
| Space Loja do Kit | Sem rota: idem |

Savy e Almeida (lojas clientes no workflow) aceitam SO as cinco functions financeiras
(`cobranca`) e exigem `expected_sha` completo, igual ao SHA do run. Detalhes em
`DEPLOYMENT.md` secao 5.3.2.

## Rollback

- Principal: reverter o PR na `production`, ou promover o deployment anterior na Vercel.
- Lojas clientes: rodar de novo o `npx vercel --prod` da secao acima com o SHA anterior,
  ou promover o deployment Production anterior no projeto da loja.

## Rollback integral da configuracao

- Dominio da principal: `gitBranch = null` (volta a seguir deployments de producao).
- Ignore step: `commandForIgnoringBuildStep = null`.
- Ruleset: remover `producao-unica-fonte` (id 24166103).
