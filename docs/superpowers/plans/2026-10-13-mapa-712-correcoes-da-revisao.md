# Correções da revisão independente da PR #712 (mapa vetorial) — onda 1

Origem: revisão paralela (7 lentes + 2 céticos por achado) sobre o merge `01bd06c`. Cada item abaixo
foi CONFIRMADO por verificação adversarial; evidência colada no comentário da PR. Escopo: só o mapa do
cartão de endereço (AGENTS.md: escopo do app). Fora daqui: portão de tamanho, `vercel.json`, AGENTS.md
e descrição da PR (onda 2 — dependem de decisão do dono e de medição real).

## Frente `mapa-worker` — BLOQUEADOR (risco: rotina; efeito no portão tratado na onda 2)
Posse: `src/components/ui/custom/AddressCardMap.tsx`, `tests/front/perfil-enderecos-mapa-por-cartao.test.tsx`,
`tests/front/mapa-worker-empacotado.test.ts`.

Problema: o MapLibre 6.10 resolve o worker em runtime por `new URL('./maplibre-gl-worker.mjs', import.meta.url)`;
o build não emite esse arquivo (nem o `maplibre-gl-shared.mjs` que ele importa) e ninguém chama `setWorkerUrl`.
No Vercel o rewrite `/(.*) -> /index.html` entrega HTML no lugar do worker: o mapa nunca carrega (só o timeout
de 12 s rescata) — também no `vite dev`. O mock `vi.mock("maplibre-gl")` do teste existente esconde isso.

Tarefas:
1. No caminho preguiçoso (junto do `import("maplibre-gl")`), importar a URL empacotada pelo Vite:
   `import workerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url"` e chamar
   `maplibregl.setWorkerUrl(workerUrl)` UMA vez, antes do primeiro `new Map`. A URL deve vir por import
   DINÂMICO também (não pode entrar no bundle do cliente: o JS inicial não cresce). Nome com hash em
   `/assets/` (o `vercel.json` dá `immutable` a `/assets/(.*)`; nunca nome fixo).
   Validado só em harness (Vite 7.3.6): `?worker&url` funciona; `?url` sozinho NÃO (falta o shared).
2. Atualizar o mock do teste existente para expor `setWorkerUrl` e provar: chamado uma vez, com a URL do
   worker, ANTES do primeiro `new Map`, e nunca quando o mapa não monta (offline/estilo 500/geocode vazio).
3. Teste de contrato sem mock do componente (`tests/front/mapa-worker-empacotado.test.ts`): o fonte importa
   o worker por `?worker&url` de forma dinâmica e chama `setWorkerUrl` antes de `new maplibregl.Map`.
4. Corrigir no mesmo arquivo de teste: a asserção "sem import do maplibre antes de expandir" (linha ~998) é
   um contador morto que não pode falhar; o apelido da consulta não é verificado (linha ~354).
5. A11y no componente: o MapLibre sobrescreve o `aria-label` pt-BR do contêiner com "Map" — garanta o
   rótulo em português na região do mapa depois de construído (sem mudar o comportamento).
6. (se couber, sem decisão de produto) cache de geocode em nível de módulo por consulta (menos envio do
   endereço ao Photon a cada expandir/recolher); falha não fica em cache; teste.
Verificação: `npx vitest run tests/front/perfil-enderecos-mapa-por-cartao.test.tsx tests/front/mapa-worker-empacotado.test.ts`,
`npx tsc -b`, `npx eslint` nos arquivos tocados.

## Frente `mapa-precache` — MAIOR (risco: SERVICE WORKER → revisor-risco)
Posse: `vite.config.ts`, `tests/front/mapa-precache-sem-maplibre.test.ts`.
Problema: `vite.config.ts:71` — o chunk `maplibre-gl-*.js` (1.051.513 B cru / 228 kB brotli) entra no precache
do SW (`cache.addAll`); todo visitante com PWA o baixa, contra o "sob demanda" que justifica a categoria
opcional do portão. O worker empacotado (`maplibre-gl-worker-*.js`, ~507 kB cru) cairia no mesmo glob.
Tarefas: excluir `assets/maplibre-gl*` (chunk e worker) do precache do `injectManifest` (globIgnores), SEM
mexer no `src/sw/sw.ts` e sem perder o resto do precache; teste que lê a configuração e prova a exclusão e
que os demais assets seguem cobertos. Nada de runtime caching novo (decisão de risco → relatar como pedido).
Verificação: o novo teste, os testes de PWA/SW já existentes (`grep -l precache tests/front`), `npx tsc -b`.

## Frente `mapa-css` (risco: rotina)
Posse: `src/components/ui/custom/address-card-map.css`, `tests/front/mapa-css-contrato.test.ts`.
Tarefas: (a) texto de status com contraste 4,40:1 → ≥ 4,5:1 (AA) sem mudar o resto do visual; (b) a linha de
créditos (`nowrap` + `ellipsis`) CORTA a atribuição exigida (OpenMapTiles/OSM) em telas estreitas → deve
quebrar linha (a atribuição nunca pode ficar oculta); (c) o estado "consultando/indisponível" ocupa ~60 px
de um contêiner de 160 px deixando ~100 px de vazio branco → preencher/centralizar a altura do contêiner;
(d) remover a regra morta `.address-map` ou corrigir o comentário. Teste de contrato lendo o CSS (padrão do
`mapa-pino-sem-transform-no-marcador.test.ts`; não quebrar esse teste). Verificação: os 2 testes de CSS do mapa.

## Frente `mapa-cabecalhos-e-comentarios` (risco: rotina)
Posse: `tests/front/hospedagem-headers.test.ts`, `src/components/ui/custom/AddressList.tsx`.
Tarefas: (a) fixar `https://photon.komoot.io` e `https://tiles.openfreemap.org` no `connect-src` (hoje nenhum
teste os trava e o único conflito do merge foi nessa linha); (b) corrigir o comentário do teste que cita um
mapa Leaflet que não existe aqui (NÃO remover a asserção de `tile.openstreetmap.org`: a remoção da origem é
decisão do dono, onda 2); (c) comentários do `AddressList.tsx` ainda descrevem o iframe do Google removido.
Verificação: `npx vitest run tests/front/hospedagem-headers.test.ts` + os testes do `AddressList`.

## Onda 2 (depois da onda 1 e da medição real do build; NÃO despachar agora)
Portão de tamanho (alcançabilidade em vez de nome; `.d.cts` v2; teto do grupo opcional com o worker),
`vercel.json` (`img-src tile.openstreetmap.org` sem consumidor), `AGENTS.md` (portão com 3 grupos; Photon e
OpenFreeMap nas integrações), descrição da PR, política de privacidade/LGPD — tudo decisão do dono.
