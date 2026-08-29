---
description: Gate de qualidade do repo — ordem correta, escopado, com leitura do baseline
argument-hint: [arquivos que você alterou]
---

# Checagem antes de encerrar a tarefa

## Regras de leitura (importantes)
- **Nunca use `npm run typecheck`**: ele roda `tsc --noEmit` contra `tsconfig.json`, que tem `"files": []` + só `references`. Checa ZERO arquivos e termina verde em 2s. O typecheck real é `npx tsc -b`.
- **Exit code não é critério**: o baseline de `main` já é vermelho (eslint: 7 erros + 534 warnings; biome: 17 erros; stylelint: 13 erros; cspell: 63 issues). O critério é: *nenhum problema novo nos arquivos que eu toquei*.
- **O build é mais estrito que os linters**: `tsconfig.app.json` liga `noUnusedLocals`/`noUnusedParameters` como **erro**, enquanto eslint e biome só dão warning. Variável não usada passa nos linters e quebra `npm run build`. Por isso `tsc -b` é obrigatório, não opcional.
- Não existe teste automatizado neste repo (0 arquivos `*.test.*`/`*.spec.*`, sem vitest/playwright, sem script `test`). Não prometa "rodar os testes".
- Não invoque as suítes `.bat` de `C:/Users/Gabriel/Documents/Ferramentas para projetos/` citadas no AGENTS.md: elas terminam em `pause` e travam a sessão.

## Gate mínimo (~25s, nesta ordem)
```
npx biome check .
npx tsc -b
npx eslint $ARGUMENTS --quiet
```
- `biome check` (~2s) — lint + formatação + ordem de imports, feedback mais rápido.
- `tsc -b` (~16s) — typecheck real + unused locals/params.
- `eslint` escopado (~5s) com `--quiet`: sem o `--quiet` são 534 warnings de `tailwindcss/classnames-order` e `security/detect-object-injection` escondendo os erros reais. Rodar `npx eslint .` inteiro leva ~36s — deixe para antes de deploy.

## Condicionais
- Mexeu em CSS: `npx stylelint "src/**/*.css" --fix` (~3s; os 13 erros do baseline são todos auto-fixáveis).
- Mexeu em SQL/migrations: `python -m sqlfluff lint supabase --dialect postgres` (o script `npm run sqlfluff:lint` está quebrado).
- Mexeu em `src/sw/sw.ts` ou em qualquer coisa de PWA: `npm run dev` **não** registra service worker (`devOptions.enabled: false`). A única forma de testar é `npm run build && npm run preview` em http://localhost:4173.
- Vai commitar: `npx biome check --write .` para auto-formatar, mas **revise o diff** — ele reordena imports em arquivos que você não tocou. Mensagem em Conventional Commits, validada à mão com `npx commitlint --edit` (não há hook: `lefthook.yml` está 100% comentado e não há CI).

## Antes de PR/deploy (mais pesado)
```
npm run build          # ~37s — gate definitivo (tsc -b + vite + PWA)
npx size-limit         # ~31s — SEMPRE logo após o build (lê dist/ do disco); limites 800kB JS / 100kB CSS
npx eslint . --quiet   # ~36s
npx knip               # ~7.5s — acha view registrada pela metade / export órfão
```

## Como reportar
Diga quantos problemas existiam antes e depois **nos arquivos alterados**, não "passou/não passou". Se um erro do baseline aparecer no seu arquivo mas não for seu, diga que é pré-existente.
