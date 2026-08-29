---
description: Prepara e valida um release do Core (bump, build, PWA, CSP, autorização)
argument-hint: [patch|minor|major]
---

# Release do Core — parte: ${ARGUMENTS:-patch}

## 1. Gate completo (antes de qualquer bump)
```
npx biome check .
npx tsc -b
npx eslint . --quiet
npm run build
npx size-limit
npx knip
```
- `npm run build` (~37s) é o gate definitivo: roda `npx tsc -b` + vite + PWA.
- `npx size-limit` **só vale logo após o build** — ele lê `dist/assets/*.js` do disco e reporta número falso se o dist for antigo. Limites: 800 kB JS / 100 kB CSS (hoje ~614 kB / ~27 kB).
- `npx knip` pega view registrada pela metade / export órfão.
- Compare com o baseline vermelho conhecido (eslint 7 erros + 534 warnings, biome 17 erros): o critério é não ter piorado.

## 2. Checagens específicas desta base
- **Origem externa nova** (fonte, CDN, imagem, endpoint): precisa estar no CSP de `vercel.json` (`connect-src`/`img-src`/`font-src`...). Funciona em `npm run dev` e **falha silenciosamente em produção** se faltar. Lembre que `vercel.json` **não** é clonado nem sincronizado — cada cliente precisa da correção à mão.
- **Variável de ambiente nova**: adicionar ao `.env.example` no mesmo commit (é o arquivo que vira o `.env` do próximo clone) e às env vars da Vercel.
- **Texto visível novo**: nada de "IKCOUS"/"Monte Carmelo" literal — use `branding.appName`/`branding.companyName` ou `config.*` do StoreContext.
- **Mexeu em `src/sw/sw.ts` ou no PWA**: teste em build de produção, nunca em dev (`devOptions.enabled: false`):
  ```
  npm run build && npm run preview      # http://localhost:4173
  ```
  No console do preview: `await caches.keys()` deve sobrar apenas `app-cache-<versão>` e `supabase-images-cache`. Cache novo tem que entrar no allowlist do `activate` (`src/sw/sw.ts:57-58`) ou é apagado no próximo deploy.
- **Mexeu em schema**: `src/types/database.types.ts` regerado via Supabase MCP e `npx tsc -b` limpo.

## 3. Bump de versão — pelo manager, nunca à mão
De dentro de `manager-claude/`:
```
python cli.py bump Original --part ${ARGUMENTS:-patch}
```
Isso escreve `package.json`; a versão de runtime (`__APP_VERSION__`) é derivada no build em `vite.config.ts:42-46` no formato `<pkg.version>-sha.<7>` ou `-build.<5>`. Não edite constante de versão no código, nem `public/version.json` (é fóssil: quem vale é o `dist/version.json` gerado pelo `pwaVersionPlugin`).

**ARMADILHA CRÍTICA — `store_config.min_app_version`**: a comparação em `src/hooks/useUpdateCheck.ts:222-224` é igualdade estrita contra `__APP_VERSION__`, que em produção é `1.0.1-sha.abc1234`. Se alguém gravar semver puro (`1.0.1`) nesse campo, **todo cliente entra em purga nuclear a cada boot** (apaga IndexedDB + reload infinito, sem guard). Só preencha esse campo com o valor exato de `__APP_VERSION__` do build publicado — ou deixe-o intocado.

## 4. Deploy e verificação
- Deploy pela Vercel (projeto do Core).
- Após publicar, confira em produção: `dist/version.json` novo, `sw.js` mudou de bytes (se não mudar, o modal de update não aparece para ninguém, por mais broadcast que se dispare), e uma navegação com F5 em rota profunda (o rewrite SPA de `vercel.json`).

## 5. Registrar a autorização
Rode `/autorizacao` para gerar `projects/authorizations/auth_<data>_<slug>.md` descrevendo o que mudou e os passos manuais que o sync não faz (migration, CSP, env var, npm install).

## 6. Propagar aos clientes (opcional, um por vez)
De `manager-claude/`:
```
python cli.py diff "SR Tudo10"
python cli.py sync "SR Tudo10" --dry-run
```
Revise o diff arquivo a arquivo antes de aplicar. **Vigie especialmente** `public/branding/logo.svg`, `public/favicon.svg`, `public/icons/*`, `public/apple-touch-icon.png`, `public/og-image.png`, `public/sitemap.xml` e `public/google*.html`: eles são específicos do cliente mas **não estão** na lista de proteção do sync — sincronizar sem revisar sobrescreve a marca do cliente pela do Core. `middleware.ts` também tem "IKCOUS" hardcoded e é propagado.
