# Harness visual da vitrine (app do cliente)

Prova, por print pixel a pixel, que um redesenho **só-desktop** não muda
**nada** no celular. Sobe o app do cliente de um `worktree` qualquer, com
backend 100% falso (nenhuma requisição sai para a internet — nem para o
Supabase de produção), tira print de cada tela em várias larguras e compara
dois conjuntos de prints byte a byte.

Frente `desktop/harness` — irmão do harness que roda hoje fora do
repositório (scratchpad de outra sessão); este mora **dentro** do repo para
que agentes rodando em outras máquinas (sessões na nuvem, Codex) também
consigam usá-lo.

## Pré-requisitos

1. **Node e as dependências do próprio projeto**: `npm ci` no worktree que
   você vai fotografar (o script recusa rodar sem `node_modules` ali).
2. **Playwright**: se `node_modules/playwright` não existir em lugar nenhum
   visível pelo Node, rode:
   ```bash
   npm install --no-save playwright
   ```
   (mesma receita do `.github/workflows/e2e-jornadas.yml` — não altera
   `package.json`/`package-lock.json`.)
3. **Chromium**: o script primeiro procura em
   `PLAYWRIGHT_BROWSERS_PATH`/`/opt/pw-browsers` (ambiente de algumas
   sessões); se não achar, deixa o Playwright resolver o dele. Se o
   `launch()` falhar mesmo assim, rode:
   ```bash
   npx playwright install chromium
   ```
4. **`pngjs`** (só para `comparar.mjs`) — já é dependência transitiva
   travada no `package-lock.json` (via `png-to-ico`, usado por
   `scripts/generate-app-icons.mjs`); nada a instalar à parte.

Nada disto entra em `dependencies`/`devDependencies` do projeto: são
ferramentas de quem redesenha, não do app em produção.

## Como rodar

Sem `pastaDeSaida`, os prints vão para `<repo>/.visual/vitrine` (ignorado
pelo git — nunca commite prints nem baselines).

```bash
# Gera o baseline a partir de um commit específico (um worktree próprio):
git worktree add -b redesenho/base .claude/worktrees/redesenho-base <commit-ou-branch>
cd .claude/worktrees/redesenho-base && npm ci && cd -
node scripts/visual/vitrine/rodar.mjs .claude/worktrees/redesenho-base .visual/baseline

# Depois de redesenhar (no working tree atual, ou noutro worktree/branch):
node scripts/visual/vitrine/rodar.mjs . .visual/candidato

# Compara — falha (exit 1) se QUALQUER pixel mudar nas larguras de celular:
node scripts/visual/vitrine/comparar.mjs .visual/baseline .visual/candidato
```

Flags de `rodar.mjs`:

| Flag | Efeito |
|---|---|
| `--larguras 360,375,390,414,1024,1280,1440,1920` | Larguras fotografadas (default: as oito acima — quatro de celular, quatro de desktop). |
| `--telas a,b,c` | Só estas telas (ver lista abaixo pelos ids). Útil para iterar rápido. |
| `--pular-build` | Reaproveita o `dist-test/` já existente (não roda `npm run build` de novo) — só para iteração local; a prova oficial sempre builda. |

Flags de `comparar.mjs`:

| Flag | Efeito |
|---|---|
| `--larguras 360,375,390,414` | Quais larguras contam como "celular" para o exit code (default as quatro citadas). Larguras fora desta lista também são comparadas e aparecem no relatório, mas diff nelas não reprova. |

## O que roda por baixo

1. **Build**: `NODE_ENV=production IKCOUS_IDENTITY_MODE=fixture npm run
   build` — o MESMO comando de `.github/workflows/e2e-jornadas.yml`. Sai em
   `dist-test/`. O plugin de identidade (`scripts/identityBuildConfig.ts`)
   recusa esse build se qualquer `VITE_SUPABASE_*`/`SUPABASE_*`/`VERCEL*`
   estiver no ambiente — falha fechada contra vazar config real.
2. **Servidor estático próprio** (não é `vite preview`): serve `dist-test/`
   com fallback de SPA (qualquer caminho sem arquivo correspondente devolve
   `index.html` — é o que faz `goto("/product-detail?id=...")` funcionar
   como link direto).
3. **Chromium via Playwright**, lançado com
   `--host-resolver-rules="MAP * 127.0.0.1"` — TODO hostname resolve para a
   máquina local; nenhum DNS de verdade sai daqui, mesmo que uma rota
   escape do interceptador.
4. **`page.route("**/*")`** (`rede.mjs`) intercepta tudo: injeta a "ficha da
   loja" fixture no HTML (mesma técnica de `tests/e2e/kit-jornadas.ts` — o
   porteiro/`middleware.ts` faria isso em produção), responde
   `/rest/v1/<tabela>`, `/rest/v1/rpc/<nome>`, `/auth/v1/*` e
   `/functions/v1/calculate-shipping` com dados fixos (`fixtures.mjs`), e
   BLOQUEIA (`route.abort()`, registrado no relatório) qualquer request para
   fora do host fixture. WebSocket (realtime) é fechado via
   `page.routeWebSocket` quando a versão do Playwright suporta.
5. **Determinismo**: `Date`/`Math.random` congelados via `addInitScript`
   (mesmo instante para toda fixture e toda tela), CSS forçando
   `animation-duration/transition-duration: 0`, contexto com
   `reducedMotion: "reduce"` (o carrossel de banners já obedece essa media
   query para nunca trocar de slide sozinho — `BannerCarousel.tsx`) e
   `serviceWorkers: "block"` (nada de cache/atualização de PWA interferindo).
6. **Altura real do print**: este app rola dentro de
   `.active-scroll-container` (`mainRef` em `App.tsx`), não no
   `<html>/<body>` — `page.screenshot({fullPage:true})` mediria só a altura
   da viewport. O harness mede o `scrollHeight` de verdade (varrendo por
   `overflow:auto|scroll`), redimensiona a viewport para ele e só então
   fotografa.

## Telas e estados cobertos (22)

| id | cenário | rota | o que mostra |
|---|---|---|---|
| `inicio` | convidado | `/` | banners, categorias, catálogo (12 produtos) |
| `busca-resultados` | convidado | `/search` + digitar "Vestido" | busca com resultado |
| `busca-vazia` | convidado | `/search` + termo inexistente | busca vazia |
| `produto-simples` | convidado | `/product-detail` | produto sem variação, sem promoção |
| `produto-variacao` | convidado | `/product-detail` | produto com variação (P/M/G) |
| `produto-promocao` | convidado | `/product-detail` | produto com variação E promoção (De/Por, badge %) |
| `folha-adicionar-carrinho` | convidado | `/` + abrir a folha de opções | sheet de variação aberta, tamanho escolhido |
| `favoritos-vazio` | convidado | `/favorites` | lista vazia |
| `favoritos-com-itens` | cliente | `/favorites` | 3 favoritos |
| `carrinho-vazio` | convidado | `/cart` | carrinho vazio |
| `carrinho-com-itens` | cliente | `/cart` | 3 itens, frete grátis liberado |
| `checkout-endereco-pagamento` | cliente | `/checkout` | endereço padrão + PIX/cartão/dinheiro na entrega |
| `pedido-sucesso` | cliente | `/order-success` | tela de sucesso pós-pedido |
| `login-cadastro` | convidado | `/auth` | `AuthView` |
| `perfil-cliente` | cliente | `/profile` | perfil de cliente comum |
| `perfil-admin` | admin | `/profile` | perfil com "Modo Admin" |
| `configuracoes-conta` | cliente | `/account-settings` | dados pessoais |
| `endereco-formulario` | cliente | `/address-form` | formulário de endereço novo |
| `pedido-detalhe` | cliente | `/order-details` | pedido em preparo (2 itens) |
| `pedido-detalhe-entregue` | cliente | `/order-details` | pedido entregue + "Solicitar devolução ou troca" |
| `notificacoes` | cliente | `/notifications` | avisos próprios + campanha |
| `sobre-loja` | convidado | `/about-store` | perfil público da loja |

Reviews, Q&A e cupons ficam de fora de propósito: a loja fixture nasce com
`enable_reviews`/`enable_coupons` desligados — reduz a superfície do
harness sem esconder nada que o dono pediu.

## Tempo medido (ambiente de referência: sandbox Linux desta sessão)

- Build: ~90–200s (varia com cache do `node_modules`/disco).
- Prints das 22 telas × 8 larguras: ~8–9 min.
- Uma rodada completa (`rodar.mjs` com build): **~10–12 min**.
- `comparar.mjs` de dois conjuntos de 176 PNGs: alguns segundos.

## Limitações conhecidas

- **Sem fonte Inter**: `fonts.googleapis.com` é bloqueado de propósito
  (rede externa) — o navegador cai na fonte padrão do sistema. Isso vale
  IGUAL para baseline e candidato (não quebra o diff de 0 px), mas os
  prints de desktop não mostram a tipografia final da loja.
- **Mapa da página "Sobre a loja"**: o embed do Google Maps é bloqueado
  (rede externa); aparece como um retângulo cinza com ícone de imagem
  quebrada — determinístico, mas não é o mapa de verdade.
- **Imagens de produto/banner são um PNG 1×1 esticado** (cor sólida): o
  que importa para o diff de pixel é a geometria do layout, não a textura
  da foto — usar imagens de verdade exigiria rede.
- **`user-profile`** (perfil público de OUTRO usuário/avaliador) não está
  coberto: não foi pedido explicitamente e exige RPCs adicionais
  (`public_profiles` + duas RPCs) fora do escopo desta rodada.
