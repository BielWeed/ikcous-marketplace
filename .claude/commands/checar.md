---
description: Gate de qualidade do repo — ordem correta, escopado, com leitura do baseline
argument-hint: [arquivos que você alterou]
---

# Checagem antes de encerrar a tarefa

## O que existe de verdade (medido em 15/09/2026)
- **Suíte automatizada real existe e é grande**: `test:edge` (Deno, `supabase/functions/`,
  540 casos), `test:unit` (Deno, `tests/`, 380 casos) e `test:front` (Vitest,
  `tests/front/`, 511 arquivos / 4072 testes, ~5 min). `npm test` roda as três em
  sequência. Não negue teste automatizado neste repo — prometa rodar o que cobre o
  que você mudou.
- **`npm run typecheck` É o gate real de tipos**: é `tsc -b --force` (ver
  `package.json`), não o `tsc --noEmit` contra `tsconfig.json` (que tem
  `"files": []` e checa zero arquivo — esse defeito já foi corrigido, INFRA-020).
  Pode usar `npm run typecheck` sem medo.
- **CI real existe** em `.github/workflows/ci.yml`: jobs `typecheck`, `test-deno`,
  `test-front-a`/`test-front-b` (a suíte front dividida em 2 shards), `build`
  (build + `size-limit`), `secrets` (secretlint no diff), `lint` (catraca contra
  `.lint-baseline.json`: eslint com 0 erro tolerado e teto de warnings; biome
  também tem teto de erros/warnings), `docs` (`lint:links`) e `objetos` (código x
  catálogo do banco).
- **`lefthook.yml` está ativo**, não comentado: `pre-commit` roda guarda-de-branch
  + secretlint + eslint (só erro, nos arquivos staged); `commit-msg` roda
  commitlint; `pre-push` roda guarda-de-branch + `typecheck`. "Instalado" não é
  "funcionando" — quem prova que a trava está de pé é `npm run hooks:prova`.
- Nunca `--no-verify` no pre-commit: o secretlint é a única trava contra
  credencial vazada (o histórico deste repo já teve uma).

## Regras de leitura
- Exit code sozinho não decide nada: eslint e biome carregam dívida antiga
  tolerada até o teto de `.lint-baseline.json` — **esse arquivo é a fonte**, não
  este texto. O critério é *nenhum problema novo nos arquivos que você tocou*.
- **Warning novo reprova mesmo com o total abaixo do teto**: a catraca
  (`scripts/lint-ratchet.mjs`) compara a contagem TOTAL do repo com o teto, não
  arquivo por arquivo. Um warning seu pode "caber" na folga que outro arquivo
  deixou e ainda assim ser dívida nova — a catraca só protege o total, não o seu
  arquivo. Trate warning novo como erro.
- `tsconfig.app.json` liga `noUnusedLocals`/`noUnusedParameters` como **erro**,
  enquanto eslint e biome só dão warning para isso. Variável não usada passa nos
  linters e quebra `npm run build`. Por isso `tsc -b` é obrigatório, não opcional.

## Gate rápido escopado (nesta ordem)
```
npx biome check $ARGUMENTS
npx tsc -b
npx eslint $ARGUMENTS --quiet
```
- `biome check` nos arquivos tocados — lint + formatação + ordem de imports.
- `npx tsc -b` sem `--force` usa o cache incremental e é mais rápido no dia a
  dia (medido: ~1min30 do zero sobre o repo inteiro — não dá para escopar por
  arquivo, é o preço do gate real). Antes de PR rode `npm run typecheck`
  (`tsc -b --force`), que é exatamente o comando que o job `typecheck` do CI
  roda.
- `eslint` escopado com `--quiet`: sem ele, os warnings pré-existentes (teto
  vivo em `.lint-baseline.json`) escondem o erro novo no meio da saída.

## Teste escopado
Rode o que cobre o que você mudou, não a suíte inteira:
```
npx vitest run tests/front/<arquivo>.test.tsx
deno test --allow-all --no-check supabase/functions/<funcao>/
deno test --allow-all --no-check --sloppy-imports tests/<arquivo>_test.ts
```
A suíte inteira (`npm test`) leva ~5 min, quase todo o tempo em `test:front` —
deixe para antes de PR/deploy.

## Condicionais
- Mexeu em CSS: `npx stylelint "src/**/*.css" --fix` — os erros pré-existentes
  (13, medidos em 15/09/2026) são todos auto-fixáveis.
- Mexeu em SQL/migrations: `npm run sqlfluff:lint` (roda
  `sqlfluff lint supabase --dialect postgres`). Precisa do binário `sqlfluff`
  instalado à parte — não vem com `npm ci`. Medido em 15/09/2026 sem o binário:
  `sqlfluff: not found`. Confira no seu ambiente antes de afirmar que o script
  está quebrado ou que está funcionando; não generalize a partir de uma máquina
  só.
- Mexeu em `src/sw/sw.ts` ou em qualquer coisa de PWA: `npm run dev` **não**
  registra service worker (`devOptions.enabled: false` em `vite.config.ts`). A
  única forma de testar é `npm run build && npm run preview` em
  http://localhost:4173.
- Vai commitar: o lefthook já roda secretlint + eslint (erro) + guarda-de-branch
  no pre-commit e commitlint na mensagem — não precisa repetir à mão, só não
  pule com `--no-verify`. **Não rode `npx biome check --write .` no repo
  inteiro**: o disco está em CRLF e o Biome formata em LF, então ele reescreveria
  arquivo que não é seu e geraria conflito. Formate só os arquivos que você
  tocou.

## Antes de PR/deploy (mais pesado)
```
npm run typecheck
npm test                 # test:edge + test:unit + test:front, ~5 min
npm run build
npx size-limit            # logo após o build — lê dist/assets/*.js e *.css do
                           # disco; teto 800 kB JS / 100 kB CSS, cada extensão
                           # somada, não por arquivo isolado
npm run lint:ratchet      # compara com .lint-baseline.json; reprova só o que subiu
npm run lint:links        # obrigatório para .md: 0 link quebrado
```
- `npx knip` (opcional, ~15s): acha view registrada pela metade / export órfão.

## Como reportar
Diga quantos problemas existiam antes e depois **nos arquivos alterados**, não
"passou/não passou". Cole a saída real dos comandos. Se um erro do baseline
aparecer no seu arquivo mas não for seu, diga que é pré-existente — mas se o SEU
commit acrescentou um warning novo, ele reprova mesmo abaixo do teto de
`.lint-baseline.json` (a catraca protege o total do repo, não o seu arquivo).
