# Producao - como o front e as functions vao ao ar (29/09/2026, refeito 03/10/2026)

## Como funciona hoje (medido em 03/10/2026)

- As 5 lojas (`ickous-marketplace`, `savycollection`, `almeidastore`, `brandmeliz` e
  `spacelojadoskit`, todas `.vercel.app`) estao no MESMO projeto Vercel
  (`ickous-marketplace`) e TODAS servem o target Production. O porteiro escolhe a loja
  pelo host, via caderneta `frota_lojas`: em cada dominio o cabecalho
  `X-Ikcous-Caderneta` responde `hit`.
- O front vai ao ar para as 5 de uma vez por UM `npx vercel --prod` (secao "Publicar o
  front"). Juntar PR em qualquer branch NAO publica: o merge so gera deployment Preview.
- A branch `production` deixou de ser fonte de deploy. Os merges nela de 30/09
  (`d43a0198`, `9f942e2f`, `d031c53c`) geraram so Preview, e a 1.5.15 e a 1.5.16 foram
  ao ar pelo `vercel --prod`. Ela segue como REGISTRO do que esta no ar (secao
  "Depois de publicar").
- Ruleset `producao-unica-fonte` (id 24166103) continua na `production`: todo cambio
  entra por PR com checks obrigatorios (Build e tamanho, Catraca de lint, Testes front
  1/2 e 2/2, Testes Deno, Tipos). Sem push direto, sem force-push, sem delete.
- Builds disparados por push na `main` sao PULADOS (Ignored Build Step) - a linha
  1.35.0 nao pode sobrescrever a producao.
- Historico: de 29/09 a 02/10 a principal seguia a branch `production` (Branch Domain)
  e respondia `X-Ikcous-Caderneta: ausente`. Isso acabou: hoje `ausente` em QUALQUER
  dominio e defeito (deploy saiu como Preview, sem as `IKCOUS_FROTA_*`).

## Antes de publicar

1. As migrations que o codigo usa ja estao no banco de CADA loja que recebe o codigo
   (o job "Codigo x banco" do CI le o banco da principal; a Savy se confere a parte).
2. As functions que o codigo chama ja estao publicadas em cada loja (secao "Edge
   functions por loja").
3. O `codeSha` no ar (`https://<dominio>/version.json`) e ancestral do SHA a publicar
   (`git merge-base --is-ancestor <sha-no-ar> <sha40>`): publicar nao desfaz nada do ar.

## Publicar o front

1. Worktree limpa e destacada no SHA juntado (`<sha40>`), sem arquivo solto, com
   `.vercel/project.json` apontando para o projeto `ickous-marketplace`
   (`projectId` + `orgId` do time).
2. O DONO roda, dessa pasta, no PowerShell (~3 min; as permissoes do projeto negam o
   deploy pelo agente):

```powershell
npx vercel --prod --yes --build-env IKCOUS_CODE_SHA=<sha40> --build-env VERCEL_GIT_COMMIT_SHA=<sha40>
```

3. Conferir em CADA dominio: `version.json` com `codeSha` = `<sha40>`, cabecalho
   `X-Ikcous-Caderneta: hit` e o `<title>` da PROPRIA loja. Loja principal aparecendo
   num dominio cliente = o deploy saiu como Preview. Refazer com `--prod`.

`vercel` sem `--prod` cria Preview: nunca usar para publicar.

## Depois de publicar

PR de `claude/app-major-upgrade-wmc8x2` para `production`, com merge commit, para que a
`production` mostre o que esta no ar. Esse merge so gera Preview (nao muda loja nenhuma).
Se o topo do ramo principal ja andou alem do SHA publicado, o PR so pode levar commits
que nao mudam o front (CI, docs, testes): conferir com `git diff <sha40> <topo> --stat`.

## Edge functions por loja

| Loja | Banco | Como publica as functions |
|---|---|---|
| Principal (`ickous-marketplace`) | `cafkrminfnokvgjqtkle` | Workflow `publicar-functions.yml`, `projeto=ikcous-publicada` (token `SUPABASE_ACCESS_TOKEN_IKCOUS`) |
| Savy | `gnjsrucsmjkajijrakzr` | Workflow, `projeto=savy` (token proprio `SUPABASE_ACCESS_TOKEN_SAVY`) |
| Almeida | `cuemaffjmhkebhmghbap` | Loja de teste: banco e functions nao se mexem (decisao do dono, 03/10/2026) |
| Brand Meliz | conta sem acesso | Loja de teste: idem |
| Space Loja do Kit | conta sem acesso | Loja de teste: idem |

`ikcous-publicada`, `savy` e `almeida` aceitam SO as cinco functions financeiras
(`cobranca`) e exigem `expected_sha` completo, igual ao SHA do run. `ikcous-publicada` e o
padrao do workflow. O destino `loja` (`dekxabvqdsuukijblazl`) e o projeto antigo da
principal: nenhuma loja no ar chama as functions dele. Detalhes em `DEPLOYMENT.md`
secao 5.3.2.

## Rollback

- Front (as 5 lojas de uma vez): promover na Vercel o deployment Production anterior, ou
  rodar de novo o `npx vercel --prod` da secao acima com o SHA anterior.
- Functions: publicar de novo pelo workflow a partir do commit anterior.

## Rollback integral da configuracao

- Ignore step: `commandForIgnoringBuildStep = null`.
- Ruleset: remover `producao-unica-fonte` (id 24166103).
