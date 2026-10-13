# PR #712 (mapa vetorial) — onda 2: portão de tamanho e CSP

Base: onda 1 integrada (`7e37d8b`): o worker do MapLibre agora é publicado (`?worker&url`) e o chunk do
mapa/worker saiu do precache do SW. Medido no build REAL (`IKCOUS_IDENTITY_MODE=fixture npm run build`,
brotli q11, mesmo método do size-limit): `assets/maplibre-gl-C3P6mhBu.js` 1.051.513 B cru / **228,07 kB**;
`assets/maplibre-gl-worker-B1y4ppZi.js` 500.176 B cru / **116,32 kB**. O `npm run size` falha FECHADO:
`PORTAO_TAMANHO: classificação desatualizada frente ao disco — só no disco: ["assets/maplibre-gl-worker-B1y4ppZi.js"]`
porque o Vite emite o worker como `asset` do Rollup (`emitFile({type:"asset"})`) e o `portaoDividido.ts` só
classifica `type === "chunk"`.

DECISÕES DO DONO (12/10/2026, registradas): (1) o worker ganha ORÇAMENTO PRÓPRIO de ≤ 130 kB (brotli), como o
leitor zxing tem o dele; o teto do grupo `opcional` (chunk do mapa) continua **250 kB** — NENHUM teto existente
sobe; (2) remover `https://tile.openstreetmap.org` do `img-src` (sem consumidor).

## Frente `portao-worker` — MAPA DE RISCO (fronteira do que a cliente baixa) → revisor-risco
Posse: `scripts/portaoDividido.ts`, `scripts/validarPortaoDeTamanho.cjs`, `scripts/validarPortaoDeTamanho.d.cts`,
`.size-limit.cjs`, `tests/front/portao-dividido-classificacao.test.ts`,
`tests/front/portao-de-tamanho-mede-por-arquivo.test.ts`, `tests/front/portao-e-precache-concordam.test.ts` (novo).
Tarefas:
1. O `generateBundle` do `portaoDividido` passa a classificar também os ASSETS `.js` emitidos (worker) — hoje só
   `type === "chunk"`. O worker entra num grupo novo (`workerDoMapa`), NUNCA em `cliente`/`painel`/`opcional`.
   Allowlist estreita e ancorada para o worker (`^assets/maplibre-gl-worker-[A-Za-z0-9_-]+\.js$`); o `.mjs` não existe no build.
2. Esquema do JSON `.portao-tamanho/<dist|dist-test>.json` sobe para a versão 3 (novo grupo); o
   `validarPortaoDeTamanho.cjs` segue FAIL-CLOSED (versão errada, grupo ausente ou não-lista, sobreposição entre
   grupos, diferença contra os `assets/*.js` do disco nos dois sentidos) e a `.d.cts` acompanha o esquema v3
   (hoje ficou no v1). A união cliente∪painel∪opcional∪workerDoMapa tem de bater com o disco.
3. `.size-limit.cjs`: novo grupo "worker do mapa" ≤ **130 kB**; manter 550 (cliente), 450 (painel), **250**
   (opcional), 100 (CSS), 400 (leitor zxing). Falhar FECHADO se o grupo `workerDoMapa` vier vazio quando o build
   tem o chunk do mapa (e vice-versa), como já se faz com `opcional`.
4. ALCANÇABILIDADE, não só nome (achado MAIOR da revisão, `portaoDividido.ts:162`): um chunk só pode ir para
   `opcional` se for alcançável SOMENTE por `import()` dinâmico a partir do cliente. Se `maplibre-gl` (ou qualquer
   chunk com o prefixo) for importado ESTATICAMENTE por uma entrada/chunk do cliente, ele PERMANECE em `cliente`
   (e o teto de 550 reprova alto) — hoje a allowlist por nome o esconderia. Teste com grafo sintético.
5. Teste cruzado novo `tests/front/portao-e-precache-concordam.test.ts`: todo padrão de nome opcional/worker do
   portão está coberto pelo `globIgnores` do `vite.config.ts` (LEIA o arquivo; é da onda 1, não edite) — para que
   renomear o chunk num lado só reprove (achado A3 do revisor-risco do SW).
6. Os testes que FIXAM tetos (portao-de-tamanho-mede-por-arquivo.test.ts ~linhas 67-74) passam a travar também o
   130 do worker e continuam travando 550/450/250/100/400; nenhum teto sobe.
Verificação: os 3 arquivos de teste de portão; `npx tsc -b`; `npx eslint` nos arquivos tocados; e, para provar o
real, `IKCOUS_IDENTITY_MODE=fixture NODE_ENV=production npm run build` seguido de `IKCOUS_IDENTITY_MODE=fixture npm run size`
no SEU worktree (cole a saída: todos os grupos, com o worker ≈ 116,3 kB ≤ 130 e o opcional ≈ 228,07 ≤ 250).
A `node_modules` resolve do repositório pai; se um teste lê `node_modules/` relativo ao cwd e falha por isso, diga.

## Frente `csp-sem-osm` — MAPA DE RISCO (`vercel.json`) → revisor-risco
Posse: `vercel.json` (liberado a esta frente no manifesto), `tests/front/hospedagem-headers.test.ts`.
Tarefas: remover SÓ `https://tile.openstreetmap.org` do `img-src` do CSP global do `vercel.json` (preservar byte a byte
todo o resto: demais diretivas, headers e rewrites; o JSON tem de continuar válido) e ajustar, na MESMA mudança, a
asserção `toEqual([...])` de `hostsDeImagem` e o comentário do teste de `img-src` (linhas ~160-166 do teste) para
refletir a remoção. Não mexer em `frame-src` (maps.google.com continua em uso por "Sobre a loja").
Verificação: `npx vitest run tests/front/hospedagem-headers.test.ts` e os `tests/front/vercel-headers-*.test.ts`
(só leitura); prove por diff que a ÚNICA diferença no `vercel.json` é a origem removida (compare as diretivas uma a uma);
`python3 -c "import json;json.load(open('vercel.json'))"`.

## Não é frente (integrador)
`AGENTS.md` (portão com 4 grupos; Photon e OpenFreeMap nas integrações) e a descrição da PR: aplicados pelo
integrador depois das frentes, com o número medido real.
