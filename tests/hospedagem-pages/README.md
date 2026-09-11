# Ensaio local do adaptador de hospedagem Cloudflare Pages — A7c

Opt-in, fora do CI. Não roda sozinho: exige duas variáveis de ambiente e um
`dist-test` real já gerado por `scripts/buildStore.mjs` (o build que chama
`gerarHospedagem`, Tasks 1-5 desta branch). Sem elas, o comando abaixo sai
com `HOSPEDAGEM_PAGES_SKIPPED` e código 0 — esse é o estado padrão de
qualquer verificação normal do projeto.

```powershell
node tests/hospedagem-pages/run.mjs
```

Para rodar de verdade:

```powershell
$env:IKCOUS_PAGES_DIST = "C:/caminho/para/dist-test"
$env:IKCOUS_PAGES_RUNTIME = "C:/caminho/para/o/runtime/congelado"
node tests/hospedagem-pages/run.mjs
```

`IKCOUS_PAGES_DIST` é a pasta de saída do build (contém `index.html`,
`_redirects`, `_routes.json`, `_headers`, `404.html`, `_worker.js`,
`assets/`, `store-identity/`). `IKCOUS_PAGES_RUNTIME` é a pasta do runtime
Wrangler **congelado** do A7a2 (`node_modules/wrangler` em 4.130.0,
Miniflare/workerd na mesma vintage já provada pelo A7a3) — nenhuma
ferramenta Cloudflare entra neste repositório; o runner só consome essa
pasta, somente leitura. O binário Node usado para subir o Wrangler é o
mesmo que o A7a3 usou
(`.../codex-runtimes/codex-primary-runtime/dependencies/node/bin/node.exe`,
24.19.0); se não existir na máquina, o runner cai para o Node que está
executando o próprio script e registra isso em `ambiente.json` — nunca
silenciosamente.

## O que o ensaio prova

Sobe `wrangler pages dev` diretamente sobre o `dist-test` (sem `--cwd`, sem
`wrangler.jsonc`: o próprio `dist-test` já é a pasta pública), com o mesmo
molde de ambiente de lista permitida do A7a3 (perfil, config, cache e temp
isolados dentro da pasta de evidência da execução; `WRANGLER_SEND_METRICS`,
`DO_NOT_TRACK` e `CI` fixos; sem token; sem flag de rede além de `--ip
127.0.0.1`). Espera o `READY` (200 na raiz) e então roda, via `fetch` local:

- as 108 formas de entrada de `_redirects` (lidas do `dist-test` real, nunca
  reescritas à mão) mais a raiz `/` — 109 caminhos, GET e HEAD — respondendo
  200, sem cabeçalho `Location` (é reescrita, não redirecionamento: a URL do
  navegador não muda);
- 5 classes de query (id com barra codificada, forma com barra final,
  `+` codificado, alias `/admin/x/`, raiz com query) continuam em 200 sem
  `Location` — a prova de preservação aqui é justamente a ausência de
  redirecionamento na mesma requisição que carrega a query, não um eco de
  cabeçalho de diagnóstico (o worker real não expõe isso; o A7a3 tinha um
  worker sintético que ecoava a query recebida para provar esse ponto num
  nível mais fino — ver "O que NÃO prova");
- `/missing.js`, `/assets/missing.js` e
  `/store-identity/v1/inexistente/logo.svg` → 404 com `Cache-Control:
  no-store`;
- `/catalogo/rota-profunda` e `/product-detail-extra` (fora de
  `_routes.json` e sem arquivo estático correspondente) → 404 com o mesmo
  documento da loja (`404.html`, que `gerarHospedagem` grava como cópia
  literal de `index.html` — o ensaio confere essa igualdade antes de rodar
  a matriz);
- a função (`_worker.js`, compilado de `src/hospedagem/compartilhamento.ts`
  pelo `scripts/hospedagem.mjs`) FOI invocada em `/product-detail` e
  `/product-detail/` — medido pelo cabeçalho `x-ikcous-og`, que o worker
  real emite nessas duas formas. A NÃO-invocação nas demais rotas
  (estáticas, ausentes, desconhecidas, raiz) NÃO é medida por este ensaio
  (ver "O que NÃO prova"): ela está medida no ensaio A7a3, com uma
  testemunha que carimba TODA invocação
  (`recuperacao-ikcous/20260909-ecossistema/controle/pages-rotas-explicitas-20260909-a7a3-36f2/`,
  fixture `witness`: 307 respostas em 119 caminhos, carimbo em 13, só nas
  duas formas de produto), sob um `_routes.json` byte a byte igual ao que
  `routes()` gera hoje;
- `_headers` em vigor: `/assets/*` com `immutable` e `max-age=31536000`,
  `/version.json` com `no-store` (medidos num arquivo `.js` e no
  `version.json` reais do `dist-test`, não em fixture);
- um robô (`User-Agent` com `whatsapp`) pedindo `/product-detail?id=<uuid
  válido>` recebe `x-ikcous-og: sem-produto` e o documento da loja — porque
  a `conexao` deste fixture é `{"kind":"none"}`: o próprio código de
  `criarWorker` faz o curto-circuito ANTES de chamar `consultarProduto`
  quando `config.conexao.kind !== "database"`, então nenhuma tentativa de
  rede a um banco chega a existir (confirmado por leitura de
  `src/hospedagem/compartilhamento.ts`, não só pela resposta observada).

Cada requisição e cada conferência viram uma linha em `responses.json` e
`checks.json`, gravadas incrementalmente (sobrevivem a uma falha no meio da
matriz). Reprovação de qualquer conferência é `exit 1` com a lista de
`checks` cujo `erros` não está vazio — o runner nunca afrouxa uma
conferência para fechar verde.

## O que NÃO prova

A não-invocação da função fora de `/product-detail` e `/product-detail/`:
o ramo de passagem do worker (`src/hospedagem/compartilhamento.ts`,
`if (!CAMINHOS_DE_PRODUTO.has(url.pathname)) return env.ASSETS.fetch(request)`)
devolve a resposta SEM carimbo, então "invocada e passou" e "nunca
invocada" produzem a mesma resposta — a ausência de `x-ikcous-og` numa
rota não prova que a função não rodou. Quem prova isso é a testemunha do
A7a3 citada acima; este ensaio só prova a invocação nas duas formas de
produto e o comportamento observável das demais rotas.

Nada aqui fala com CDN, conta Cloudflare, banco de dados real ou o
processo de atualização do PWA já instalado no aparelho de alguém. O
worker roda em cima de um fixture com `conexao.kind: "none"`: qualquer
lógica que dependesse de uma consulta real ao Supabase (a construção da
prévia de produto com `montarHtml`, por exemplo) nunca é exercitada por
este ensaio — só o caminho `sem-produto`. A preservação exata de query
string na barra de endereço do navegador (o que o A7a3 mediu com um worker
sintético que ecoava `location.search`) não é reconferida aqui byte a
byte: este ensaio confirma que a plataforma aceita e responde 200 sem
redirecionar a mesma requisição com query, o que já é a evidência que
importa para o worker real (que não expõe diagnóstico de query).

## Onde a evidência fica

Cada execução grava numa pasta nova, nunca reaproveitada:

```
C:/Users/Gabriel/equipe/entregas/20260909-codex-investigacao-ikcous/controle/tarefa-A7c-<runId>/
  ambiente.json     # env resolvido, node usado e sua versão, runtime e dist usados
  responses.json    # toda requisição feita, com corpo em sha256
  checks.json       # toda conferência, com a lista de erros (vazia = passou)
  processes.json    # PID, portas, saída do taskkill, confirmação de porta fechada
  result.json       # resumo final: checks, rejections, processo encerrado
  logs/wrangler.{stdout,stderr}
  state/            # --persist-to do Wrangler (KV/D1 locais, se algum dia usados)
```

Nada é escrito no `dist-test`, na worktree ou no runtime congelado — só
dentro dessa pasta e nas subpastas de perfil/config/cache/temp que o
próprio runner cria ali dentro para isolar o Wrangler.

## Verificação

```powershell
node --check tests/hospedagem-pages/run.mjs
npx eslint tests/hospedagem-pages/run.mjs
npx biome check tests/hospedagem-pages/run.mjs tests/hospedagem-pages/README.md
npx secretlint tests/hospedagem-pages/run.mjs tests/hospedagem-pages/README.md
```

Depois de qualquer execução real, confira que nenhum processo do runner
ficou vivo:

```powershell
Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -match 'workerd|wrangler' } |
  Select-Object ProcessId, ParentProcessId, CommandLine
```

Deve voltar vazio para o `runId` da execução — `processes.json` já registra
o PID, o código de saída do `taskkill` e se a porta HTTP e a do inspector
fecharam.
