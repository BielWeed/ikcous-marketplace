# Passagem de bastão — super atualização do app (17/09/2026, 07:30 UTC)

Esta pasta existe para UM leitor: o próximo agente (ou pessoa) que vai terminar a
"super atualização" do IKCOUS Marketplace a partir do ponto em que esta sessão parou,
por limite de cota do plano. Leia os arquivos na ordem dos números. Cada um trata de um
assunto só.

| Arquivo | O que tem |
| --- | --- |
| `00-LEIA-PRIMEIRO.md` | este: situação, regras, rotina de commit, lições, ordem de trabalho |
| `01-o-que-esta-pronto.md` | tudo que já está na branch, commit a commit, e o que está em produção |
| `02-em-andamento.md` | as cinco frentes interrompidas: arquivo por arquivo, o que falta e os achados de revisão pendentes |
| `03-fila-do-que-falta.md` | a fila do que ainda não começou, em ordem, com dependências e onde está a especificação |
| `04-decisoes-e-follow-ups.md` | decisões já tomadas com o dono (não reabrir) e todos os follow-ups anotados pelas revisões |
| `05-deploy-e-operacao.md` | Supabase (functions publicadas, migrations pendentes), Mercado Pago, workflow de publicação, preview |
| `frentes/*.json` | as especificações das frentes ainda abertas, no formato que o orquestrador usava |
| `orquestracao/` | o script de workflow (implementador + revisor por tarefa) e como usá-lo, ou como fazer à mão |
| `wip/` | o trabalho em andamento que NÃO passou por revisão, como patch + arquivos novos, e como aplicar |

## Situação

- Branch de trabalho: `claude/app-major-upgrade-wmc8x2` (base `develop`). PR **#624** (rascunho):
  <https://github.com/BielWeed/ikcous-marketplace/pull/624>. Último commit aprovado: `e3dd469`
  (77 commits sobre `develop`), CI verde nos 14 checks.
- `develop` já recebeu o PR #625 (workflow `publicar-functions`, deploy das edge functions pelo
  GitHub) e a branch já está mesclada com esse `develop` (9906cd7).
- O plano completo, com o diagnóstico das 14 áreas e as 12 decisões do dono, está em
  `docs/superpowers/plans/2026-09-15-super-atualizacao-do-app.md`. Esta pasta NÃO o repete: ela diz
  o que sobrou dele e em que estado.
- O dono é o Gabriel (BielWeed). Toda fala visível a ele é em português, curta e sem jargão.

## Regras que não se discutem (a fonte é `AGENTS.md`; isto é o resumo do que mais pegou)

1. Escopo: só o app. Migrations sem `BEGIN/COMMIT`, sempre com `rollback-manual-<nome>.sql` e teste
   estático em `tests/migration_*_test.ts`; tipos editados à mão em `src/types/database.types.ts`;
   NUNCA `supabase db push`.
2. Git: commit POR CAMINHO (`git commit -m "..." -- <arquivos>`; `git add` só para arquivo NOVO),
   nunca `git add -A`. PROIBIDO `git stash`, `git checkout -- <arquivo>`, `git restore`,
   `git reset`, `git clean` (dois incidentes reais nesta sessão apagaram trabalho alheio). Para
   comparar com o original: `git show HEAD:<caminho> > /tmp/x` e prove sobre a cópia. Nunca
   `--no-verify`. Nunca push para outra branch sem o dono autorizar por escrito.
3. Qualidade: catraca de lint (`.lint-baseline.json`): NENHUM warning novo de eslint, biome limpo nos
   arquivos tocados; teto só desce com número medido no CI. `npm run size` ≤ 800 kB. Lefthook roda
   secretlint + eslint no pre-commit, commitlint no commit-msg (header ≤ 100 chars, assunto em
   minúsculas, escopos de `.commitlintrc.json`, sem parênteses no assunto) e typecheck no pre-push.
4. Toda mudança entra com teste que falha antes, nomeado pelo comportamento, e passa por revisão em
   contexto limpo antes do commit. Veredito "nao passa" só com achado BLOQUEIA; "passa com ressalva"
   = ANTES DE CRESCER (o orquestrador corrige antes de commitar) ou ANOTADO (vira follow-up).

## Rotina de verificação e commit que funcionou

A árvore de trabalho fica suja com o WIP de várias frentes ao mesmo tempo; por isso tudo é provado
numa CÓPIA LIMPA antes de commitar:

```
S=<pasta de rascunho>; WT=$S/push-wt
git worktree add --detach $WT HEAD && ln -sfn $PWD/node_modules $WT/node_modules
# copie SÓ os arquivos da tarefa para $WT, e lá:
VITEST_MAX_WORKERS=1 npx vitest run <testes da tarefa + vizinhos>
npx eslint -f json <arquivos> | (conte errors/warnings)   # compare com a mesma medida em HEAD
npx eslint --max-warnings 0 <testes novos>
npx biome check <arquivos>
npx tsc -b
# edge: deno test --allow-all --no-check --no-lock <pasta da function> NA CÓPIA (import de arquivo
#       não commitado passa na árvore e quebra o CI)
# na árvore principal:
git add <arquivos novos> && git commit -q -m "<tipo>(<escopo>): <assunto minúsculo>" -- <caminhos>
# push de dentro do worktree limpo (o pre-push roda o typecheck sobre o que vai mesmo):
git worktree remove --force $WT && git worktree add --detach $WT HEAD && ln -sfn ... && \
  (cd $WT && git push origin HEAD:refs/heads/claude/app-major-upgrade-wmc8x2)
```

Antes de cada commit: `git status --short` INTEIRO (implementadores às vezes corrigem arquivos fora
da lista e não relatam). `deno.lock` modificado é ruído de agente: não commitar.

## Lições operacionais (cada uma custou tempo real)

- Máquina de 4 núcleos e 16 GB: no máximo **2 workflows** (um agente cada) ao mesmo tempo. Com 5,
  a carga passou de 80 e o container reiniciou duas vezes em 15 minutos (07:00 e 07:14 UTC).
  `VITEST_MAX_WORKERS=1` e `NODE_OPTIONS=--max-old-space-size=2048` no ambiente.
- Ao mexer em rotas/telas de entrada (`telasDeEntrada`, `rotas.ts`, `hospedagem.mjs`), rodar também
  `tests/front/identity-build-finalization.test.ts` (conta as linhas de `_redirects`).
- Em Bash, um heredoc por comando, delimitadores únicos, e encadear com `&&` (um patch falhou calado
  e o commit saiu sem ele).
- Header de commit com "(PDV):" quebra o parser de escopo do commitlint; assunto sem parênteses.
- Quando o CI da branch ficar vermelho: o próximo commit conserta ou explica; nunca se pula teste.
- Arquivos grandes compartilhados (`App.tsx`, `useOrders.ts`, `mappers.ts`, `database.types.ts`,
  `AdminLayout.tsx`, `types/index.ts`, `supabase/migrations/`, `AdminProductFormView.tsx`,
  `realtimeSyncEngine.ts`): um escritor por vez.

## Ordem de trabalho sugerida

1. Ler `02-em-andamento.md` e fechar as frentes interrompidas, começando pelo C5 (é o que falta
   para o PDV ser usável: cadastrar o código de barras no produto).
2. `03-fila-do-que-falta.md` na ordem dada.
3. Antes de tirar o PR do rascunho: a lista "Antes de sair do rascunho" no fim do `03`.
