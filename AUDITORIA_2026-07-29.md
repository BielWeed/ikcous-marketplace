# Auditoria profunda — IKCOUS Marketplace

**Data:** 29/07/2026 · **Commit base:** `ef7b099` (branch `main`, árvore limpa) · **Escopo:** 174 arquivos TS/TSX (~72.600 linhas) + 38 migrations SQL + 3 edge functions

> ⚠️ **Este documento NÃO carrega estado, e nunca carregou.** Ele é o retrato de 29/07/2026.
> Desde então caíram **277 commits**, e boa parte destes achados já foi corrigida — mas nada
> aqui diz qual.
>
> **O estado medido está em [`docs/auditoria/2026-08-22-reauditoria-de-julho.md`](docs/auditoria/2026-08-22-reauditoria-de-julho.md)**,
> conferido no código de 22/08/2026 (`HEAD = 10830e6`). Ele cobre os 76 achados numerados **e**
> os 9 de runtime (`R1`-`R9`), que somam os 85 citados no onboarding.
>
> **Não use o número "66 abertos" para planejar.** Ele é de 30/07 e não foi medido desde então.

## Como esta auditoria foi feita

| Etapa | O que foi feito |
|---|---|
| Baseline estático | `tsc --noEmit` (0 erros) e `eslint` (7 erros, 534 warnings) |
| Investigação | 13 auditores paralelos, um por domínio funcional, lendo o código real |
| Verificação | Cada achado passou por um cético adversarial independente, com instrução de **refutar**, que reabriu o arquivo e checou se a evidência batia, se o caminho era alcançável e se algo já neutralizava o problema |
| Runtime | App rodando em `localhost:5173` (dev) e build de produção em `localhost:4173`: console, rede, DOM, storage, Service Worker e composição do bundle |

**Resultado:** 154 achados brutos → 78 verificados (os 6 mais severos de cada domínio) → **76 confirmados, 2 refutados**.

### Ressalvas honestas sobre este relatório

- **A taxa de refutação foi baixa (2 de 78).** Isso sugere que os verificadores foram mais confirmatórios do que o ideal. Trate a lista como *forte indício com evidência de código*, não como sentença — valide antes de mexer em fluxo de dinheiro.
- **76 achados não corrigidos por 76 arquivos.** Há sobreposição: os 8 críticos concentram-se em ~5 causas-raiz (ver abaixo).
- **Cobertura incompleta por desenho.** Os 6 achados de menor severidade de cada domínio (≈76 itens) **não** foram verificados e não estão aqui.
- **Nada foi alterado no código.** Este relatório é só diagnóstico.

---

## Sumário

| Severidade | Qtd |
|---|---|
| 🔴 Crítica | 8 |
| 🟠 Alta | 27 |
| 🟡 Média | 39 |
| ⚪ Baixa | 2 |

| Categoria | Qtd |
|---|---|
| bug | 50 |
| malfuncionamento | 12 |
| segurança | 8 |
| performance | 3 |
| ux | 3 |

---

## Causas-raiz: os 8 críticos são ~5 problemas

Corrigir estes cinco pontos derruba 8 achados críticos e ~6 altos de uma vez.

### A. `free_shipping_min` — a mesma regra escrita de três jeitos diferentes

Envolve os achados críticos #1, #7 e os altos #4, #19, #20, #25.

O front zera o frete só se houver **usuário logado** (`CartContext.tsx:729` — `config.freeShippingMin > 0 && cartTotal >= config.freeShippingMin && user`). A RPC `create_marketplace_order_v22` zera o frete **sem olhar autenticação** e trata `0` como "sempre grátis" (`COALESCE(free_shipping_min, 999999)` — o `COALESCE` só pega `NULL`, não `0`). E a RPC ainda **rejeita o pedido** se o total recalculado divergir mais de R$ 0,05 do enviado.

Consequências, todas de parada de vendas:
1. **Convidado que atinge o mínimo nunca fecha pedido** — front manda `subtotal + frete`, banco calcula `subtotal`, divergência → exceção.
2. **Desligar o frete grátis no admin derruba 100% dos checkouts** — o switch grava `freeShippingMin = 0`; o front entende "regra desligada" e cobra frete, o banco entende "grátis para todos" e recusa todo pedido com frete > 0.
3. `p_shipping_cost` é recebido pela RPC e **nunca usado** — o front não tem como informar o frete que cobrou.

### B. `upsert_store_config` regrava a linha inteira

Achados críticos #3 e #7.

Qualquer `updateConfig({umCampoSó})` faz a RPC reescrever `store_config` completo com os defaults dela. Desligar o toggle de cupons pode zerar logo, cor primária, WhatsApp e limite de frete grátis de uma vez.

### C. Update obrigatório em loop de purge + reload

Achados críticos #4 e #8 (mesmo bug, encontrado por dois domínios).

`useUpdateCheck.ts:221` compara `minAppVersion !== __APP_VERSION__` com igualdade estrita. Como a versão do build carrega sufixo (`1.0.0-sha.ef7b099`), gravar `min_app_version = '1.0.0'` faz a comparação nunca convergir: purge → reload → purge → reload, infinito, para todos os clientes.

### D. Máscara de moeda divide preços por 100 ao abrir o formulário

Achado crítico #5. Um produto de R$ 100,00 abre como R$ 1,00 no formulário de edição. Salvar sem perceber corrompe o preço.

### E. Frete por CEP: configurado, mas desconectado

Achados altos #21, #22 e crítico #6. Toda a configuração de provider/faixa de CEP existe no admin, mas **nenhum componente do cliente chama o cálculo de frete**; e a edge function cai sempre no fallback de R$ 15 por usar `.catch()` num query builder do Supabase (que não é Promise até ser awaited).

---

## Achados de runtime (verificados por mim, fora do fluxo dos agentes)

Estes eu confirmei executando o app, não lendo código.

### R1. 🔴 O build de produção não sobe — tela branca

`.env.production.local` (gerado por `vercel env pull`) contém `VITE_SUPABASE_URL=""` e `VITE_SUPABASE_ANON_KEY=""`. No Vite, `.env.production.local` **tem precedência** sobre `.env.production`, então o bundle sai sem as chaves.

Com as chaves vazias, [`src/lib/supabase.ts:13`](src/lib/supabase.ts:13) faz `throw` na avaliação do módulo. Como imports ES são hoisted, isso acontece **antes** do corpo de [`src/main.tsx`](src/main.tsx:70) — o que torna a tela vermelha "🚨 ERRO DE AMBIENTE" ali dentro **código morto inalcançável**.

Observado em `localhost:4173`: spinner por 20 s, `[SilentGuardian] React failed to unblock UI. Nuclear fallback triggered`, `document.body.innerText.length === 0`, zero chamadas à API. O usuário vê página em branco, sem nenhuma mensagem.

**Correção:** mover a validação de env para o topo de `main.tsx` **antes** de qualquer import que toque no Supabase (ou fazer `supabase.ts` exportar um cliente nulo e validar no boot), e limpar/regenerar `.env.production.local`.

### R2. 🟠 `react-helmet-async` não funciona com React 19 — todo o SEO é código morto

`react-helmet-async@2.0.5` declara `peerDependencies: react ^16.6 || ^17 || ^18`. O projeto roda **React 19.2**.

Medido no DOM, tanto na Home quanto na página de produto: `document.querySelectorAll('[data-rh]').length === 0` e `script[type="application/ld+json"].length === 0`.

Ou seja: os blocos `<Helmet>` de [`HomeView.tsx:216`](src/views/customer/HomeView.tsx:216), [`ProductView.tsx:685`](src/views/customer/ProductView.tsx:685) e [`AdminLayout.tsx:526`](src/components/layouts/AdminLayout.tsx:526) **não injetam nada**. Perde-se: título por produto, `og:title`/`og:image` por produto (link de produto no WhatsApp mostra sempre a marca genérica) e o JSON-LD de `Product` com preço e nota — que é o que gera rich results no Google.

O título que aparece hoje vem do `transformIndexHtml` do [`vite.config.ts:169`](vite.config.ts:169), não do Helmet.

**Correção:** React 19 hoista `<title>` e `<meta>` nativamente. Remover `react-helmet-async` e renderizar as tags direto no JSX das views.

### R3. 🟠 Service Worker faz precache de 6,6 MB — ~5 MB inúteis

Build de produção limpo: `precache 107 entries (6.748 KiB)`. Composição:

| Item | Tamanho | Observação |
|---|---|---|
| `public/images/demo/*.png` (6 arquivos) | **3.164 kB** | **Zero referências no código.** São fotos de roupas femininas (um template antigo); o catálogo real é brinquedo/utilidade/auto cuidado |
| `og-image.png` | **673 kB** | Uma imagem OG deveria ficar abaixo de ~200 kB |
| Chunks só de admin (22 arquivos) | **1.159 kB** | `vendor-charts` 411 kB, `AdminBannersView` 122 kB, etc. — cliente nunca usa |

Todo visitante — inclusive no 4G — baixa isso no primeiro acesso.

**Correção:** apagar `public/images/demo/`, recomprimir o `og-image.png`, e restringir o `globPatterns` do `injectManifest` para excluir `Admin*`/`vendor-charts` (deixando-os como runtime cache sob demanda).

### R4. 🟠 Requisições duplicadas no boot

Contado via Resource Timing na Home (dev, com StrictMode dobrando — mas 4× e 5× vão muito além de 2×):

| Endpoint | Chamadas |
|---|---|
| `notificacoes?...limit=50` | **5×** |
| `vw_produtos_public?select=*,product_variants(*)&limit=200` | **4×** |
| `store_config?select=*` | **4×** |
| `favorites?select=product_id` | **4×** |
| `categorias?select=*` | **3×** |
| `banners?select=*` | 2× |
| `rpc/get_my_complete_profile` | 2× |

A latência degrada com a contenção: a mesma query de produtos vai de 746 ms na 1ª para 1.687 ms na 2ª. Somando, o boot dispara **29 requisições REST**.

### R5. 🟠 Imagens servidas em resolução original

`0` URLs de imagem usam parâmetros de transformação do Supabase Storage. Amostras medidas:

| Imagem | Resolução baixada | Renderizada em | Desperdício |
|---|---|---|---|
| Banner | 1584×672 | 375×200 | ~14× em pixels |
| Card de produto | 1200×1200 | 168×209 | ~41× em pixels |

**Correção:** usar as transformações do Supabase (`?width=…&quality=…`) + `srcset`/`sizes`. É provavelmente o maior ganho isolado de LCP em 4G.

### R6. 🟡 Acessibilidade medida no DOM da Home

- **64 elementos interativos abaixo de 44×44 px** (mínimo WCAG 2.5.5). Os pontinhos do carrossel têm **8×6 px**; botões de favorito/notificação, 36×36.
- **4 banners com `alt` ausente**.
- 1 botão sem nome acessível.
- Some-se o achado #38 da lista: `* { outline: none !important }` em [`index.css:138`](src/index.css:138) elimina qualquer indicador de foco de teclado no app inteiro.

### R7. 🟡 `npm run build` gera bundle de desenvolvimento se `NODE_ENV=development` estiver no shell

[`vite.config.ts:143`](vite.config.ts:143) usa `process.env.NODE_ENV === "development"` em vez do `mode` do Vite (que o próprio arquivo já calcula como `isDev`, linha 38). Nesta máquina `NODE_ENV=development` está setado no ambiente, e o resultado do `npm run build` foi:

| | com `NODE_ENV` herdado | com `NODE_ENV=production` |
|---|---|---|
| `jsxDEV` no bundle | **7.327 ocorrências** | 0 |
| `vendor-react` | 386 kB | **189 kB** |
| `HomeView` | 92 kB | **35 kB** |
| Precache | 8.767 KiB | 6.748 KiB |

Na Vercel o `NODE_ENV` é `production`, então o deploy real provavelmente está correto — mas qualquer build local ou pipeline alternativo produz silenciosamente um artefato 2× maior e muito mais lento.

**Correção:** trocar por `isDev` (o `mode` do Vite) na linha 143.

### R8. 🟡 512 `console.*` vão para produção

Não há `drop_console`/`pure_funcs` no `vite.config.ts`. Entre os logs que vazam: `[Auth] Profile fetched: João Gabriel Vieira de Oliveira` e IDs de usuário. Além disso [`main.tsx:6`](src/main.tsx:6) sobrescreve `console.warn` globalmente com um filtro amplo (`args[0].includes("width") && includes("height") && includes("chart")`) que também suprime avisos legítimos em produção.

### R9. 🟡 Não existe rota 404

Em [`App.tsx:1677`](src/App.tsx:1677), o `else` para caminho desconhecido só faz `isTransitioningRef.current = false`. Verificado: abrir `/produto/<uuid>` renderiza a Home mantendo a URL inválida na barra de endereço. Sem 404, sem redirect.

---


## Índice dos 76 achados confirmados

| # | Sev | Cat | Achado | Local |
|---|---|---|---|---|
| 1 | 🔴 critica | bug | Regra de frete gratis diverge entre front e banco: checkout de convidado e bloqueado | `CartContext.tsx:729` |
| 2 | 🔴 critica | seguranca | OTP de rastreio permite acessar pedidos de terceiros com o e-mail do atacante | `20260708190000_secure_otp_flow.sql:33` |
| 3 | 🔴 critica | bug | Salvar qualquer configuracao isolada reseta toda a store_config para os defaults do RPC | `StoreContext.tsx:490` |
| 4 | 🔴 critica | bug | minAppVersion diferente da versao do build causa loop infinito de purge + reload no app inteiro | `useUpdateCheck.ts:221` |
| 5 | 🔴 critica | bug | Máscara de moeda divide por 100 preços inteiros ao abrir o formulário de edição | `LocalBufferedInput.tsx:72` |
| 6 | 🔴 critica | bug | Edge function de frete sempre cai no fallback de R$ 15 por usar .catch() em query builder | `index.ts:432` |
| 7 | 🔴 critica | bug | upsert_store_config zera todas as configuracoes que o frontend nao enviar no payload parcial | `20260712230000_add_local_shipping_config.sql:80` |
| 8 | 🔴 critica | bug | Update obrigatório entra em loop infinito de purge + reload (compara versão com !==) | `useUpdateCheck.ts:221` |
| 9 | 🟠 alta | bug | Carrinho guarda snapshot congelado do produto: preco/estoque desatualizados e checkout travado | `CartContext.tsx:313` |
| 10 | 🟠 alta | bug | Zod remove `variantNames` ao reidratar o carrinho: pedido perde a variacao escolhida | `CartContext.tsx:19` |
| 11 | 🟠 alta | bug | sync_cart_atomic descarta `variant_names`, apagando a variacao ao sincronizar entre dispositivos | `20260606000000_fix_sync_cart_atomic_updated_at.sql:28` |
| 12 | 🟠 alta | bug | Checkout de convidado quebra quando o carrinho atinge o frete gratis (divergencia de total) | `CartContext.tsx:729` |
| 13 | 🟠 alta | bug | Reconexao do realtime apaga a lista de pedidos do admin (chama fetchUserOrders no modo admin) | `useOrders.ts:536` |
| 14 | 🟠 alta | performance | OrderDetailsView entra em loop infinito de requisicoes quando o usuario nao tem pedidos | `OrderDetailsView.tsx:145` |
| 15 | 🟠 alta | bug | Falha na consulta pública de produtos zera o catálogo inteiro em silêncio | `StoreContext.tsx:405` |
| 16 | 🟠 alta | bug | ProductView é reaproveitada entre produtos diferentes e mantém estado obsoleto (imagem, variação, quantidade) | `App.tsx:1945` |
| 17 | 🟠 alta | bug | Com dois ou mais grupos de variação, o preço cobrado depende da ordem em que o usuário clicou | `ProductView.tsx:585` |
| 18 | 🟠 alta | malfuncionamento | Catálogo do cliente está travado em 200 produtos, sem paginação | `StoreContext.tsx:401` |
| 19 | 🟠 alta | malfuncionamento | send-push responde success:true mesmo quando todos os envios falham; admin ve 'Notificacao enviada' | `index.ts:128` |
| 20 | 🟠 alta | bug | Assinatura push e criada no navegador mas nunca salva no banco quando o visitante nao esta logado | `usePushNotifications.ts:70` |
| 21 | 🟠 alta | bug | ErrorBoundary de chunk trava o app numa tela de spinner 'Atualizando o Aplicativo' sem saida | `GlobalErrorBoundary.tsx:104` |
| 22 | 🟠 alta | bug | Sync realtime grava banners truncados (perde cores, textos, agendamento) no DataVault | `realtimeSyncEngine.ts:77` |
| 23 | 🟠 alta | bug | Duplicar um banner e cancelar apaga do storage a imagem do banner ORIGINAL | `AdminBannersView.tsx:1243` |
| 24 | 🟠 alta | bug | Esc dentro do editor de imagem fecha o formulario e apaga a imagem recem-enviada | `AdminBannersView.tsx:854` |
| 25 | 🟠 alta | bug | Desativar promoção não remove o preço "De:" no banco (campos undefined são ignorados no update) | `AdminProductFormView.tsx:1069` |
| 26 | 🟠 alta | bug | Validade do cupom gravada como meia-noite UTC: expira ~21h do dia anterior e a listagem mostra um dia a menos | `AdminCouponFormView.tsx:468` |
| 27 | 🟠 alta | bug | Desativar frete gratis no admin (limite = 0) quebra TODOS os checkouts com 'Divergencia de valores' | `20260526000000_coupon_percentage_fixes.sql:150` |
| 28 | 🟠 alta | bug | Convidado com carrinho acima do limite de frete gratis nao consegue finalizar o pedido | `CartContext.tsx:729` |
| 29 | 🟠 alta | malfuncionamento | Toda a configuracao de frete por CEP e inutil: nenhum componente chama o calculo de frete | `CartContext.tsx:736` |
| 30 | 🟠 alta | bug | Faixa de CEPs locais nunca casa no formato ensinado pelo proprio placeholder do admin | `index.ts:58` |
| 31 | 🟠 alta | bug | Editar uma resposta de pergunta cria uma segunda resposta duplicada em vez de atualizar | `AdminQAView.tsx:216` |
| 32 | 🟠 alta | malfuncionamento | OTP de rastreio de convidado nunca envia e-mail: chave service_role foi apagada do app_settings | `20260708190000_secure_otp_flow.sql:78` |
| 33 | 🟠 alta | bug | create_marketplace_order_v22 ignora p_shipping_cost e derruba o checkout com 'Divergencia de valores' | `20260526000000_coupon_percentage_fixes.sql:150` |
| 34 | 🟠 alta | seguranca | Comparacao NULL-insegura em update_order_status_atomic permite cancelar pedido de convidado alheio | `20260707000000_fix_update_order_status_atomic.sql:48` |
| 35 | 🟠 alta | seguranca | get_orders_by_otp_v1 permite forca bruta do codigo de 6 digitos e devolve PII completa | `20260625000000_fix_guest_tracking_items.sql:17` |
| 36 | 🟡 media | bug | Checkout nao valida carrinho vazio e envia pedido sem itens | `CheckoutView.tsx:412` |
| 37 | 🟡 media | bug | Sem guarda de reentrancia/idempotencia no envio do pedido: risco de pedido duplicado | `CheckoutView.tsx:377` |
| 38 | 🟡 media | bug | Semaforo global checkingLock aplica o resultado de admin do usuario anterior | `AuthContext.tsx:151` |
| 39 | 🟡 media | seguranca | RPC check_user_confirmation_status exposta a anon permite enumerar e-mails cadastrados | `20260628100000_add_user_confirmation_check.sql:30` |
| 40 | 🟡 media | seguranca | Logout falha silenciosamente offline e o usuario continua autenticado no dispositivo | `AuthContext.tsx:531` |
| 41 | 🟡 media | seguranca | Limpeza de logout usa chave inexistente e deixa PII do usuario anterior no localStorage | `AuthContext.tsx:460` |
| 42 | 🟡 media | bug | Push de 'status atualizado' e enviado antes de confirmar a alteracao no banco | `AdminOrdersView.tsx:442` |
| 43 | 🟡 media | bug | Fila offline de status e processada por varias instancias do hook e trava com erro permanente | `useOrders.ts:993` |
| 44 | 🟡 media | malfuncionamento | marketplace_orders nao e adicionada a publicacao supabase_realtime em nenhuma migration | `20260708020000_enable_realtime_for_monitored_tables.sql:5` |
| 45 | 🟡 media | bug | Scroll infinito da Home volta para 12 itens a cada sincronização em tempo real | `ProductList.tsx:38` |
| 46 | 🟡 media | ux | Busca não normaliza acentuação: produtos com acento não são encontrados | `useSearch.ts:26` |
| 47 | 🟡 media | bug | RealtimeSyncEngine pode nunca iniciar porque o efeito depende de um ref (vaultRef.current) | `StoreContext.tsx:527` |
| 48 | 🟡 media | bug | catchUp apaga produtos locais e faz o refetch em lote ignorando erro e sem dividir o .in() | `realtimeSyncEngine.ts:805` |
| 49 | 🟡 media | bug | Produto excluido (soft delete) ou desativado volta para o cache atraves do evento UPDATE | `realtimeSyncEngine.ts:433` |
| 50 | 🟡 media | bug | Conexao do DataVault fechada por onversionchange continua sendo usada e leituras passam a devolver lista vazia | `dataVault.ts:129` |
| 51 | 🟡 media | malfuncionamento | Listeners de sync ignoram resultado vazio: excluir o ultimo item nunca some da tela | `StoreContext.tsx:573` |
| 52 | 🟡 media | performance | SW cacheia cada /version.json?t=<timestamp> como entrada nova: cache cresce sem limite | `sw.ts:180` |
| 53 | 🟡 media | bug | Nuclear purge apaga SW, caches e IndexedDB sem checar conexao e deixa o app inutilizavel offline | `useUpdateCheck.ts:157` |
| 54 | 🟡 media | malfuncionamento | globalBannersCache nunca e atualizado apos criar/editar/excluir: Home exibe lista antiga | `useBanners.ts:64` |
| 55 | 🟡 media | bug | reorderBanners muta objetos do state React e o rollback previousBanners nao restaura nada | `useBanners.ts:518` |
| 56 | 🟡 media | malfuncionamento | Vitrines mostram "salvas com sucesso" mesmo quando o updateConfig falhou | `AdminCarouselsView.tsx:118` |
| 57 | 🟡 media | bug | Duplo clique em "Publicar" cadastra o produto duas vezes | `AdminProductFormView.tsx:1139` |
| 58 | 🟡 media | bug | Exclusão de produto move as imagens para backup antes do UPDATE; falha deixa imagens quebradas | `useProducts.ts:742` |
| 59 | 🟡 media | bug | Rascunho de edição é apagado ~1s após abrir o produto, antes de o usuário poder restaurá-lo | `AdminProductFormView.tsx:781` |
| 60 | 🟡 media | bug | Remover a data de validade de um cupom nunca é gravado no banco, mas a UI confirma "Cupom atualizado" | `useCoupons.ts:163` |
| 61 | 🟡 media | seguranca | RPC get_category_analytics é SECURITY DEFINER sem checagem de admin e está liberada para qualquer usuário logado | `20260704170000_reconcile_category_analytics_frete.sql:15` |
| 62 | 🟡 media | malfuncionamento | Falha ao carregar a análise por categoria é engolida e o dashboard exibe "Sem Dados Registrados" como se a loja não tivesse vendas | `useAnalytics.ts:408` |
| 63 | 🟡 media | bug | Home anuncia meta de frete gratis de R$ 100 mesmo com a regra desativada pelo admin | `FreeShippingBlock.tsx:17` |
| 64 | 🟡 media | bug | Notificações globais (usuario_id NULL) nunca ficam lidas nem podem ser excluídas | `NotificationContext.tsx:79` |
| 65 | 🟡 media | malfuncionamento | Resposta da loja a uma avaliação (merchant_reply) nunca aparece para o cliente | `useReviews.ts:93` |
| 66 | 🟡 media | malfuncionamento | Chave "Avaliações dos Clientes" (enableReviews) não desliga nada no app do cliente | `AdminReviewsView.tsx:99` |
| 67 | 🟡 media | bug | Favoritos de usuário logado somem da lista quando o produto está fora dos 200 mais recentes ou inativo | `FavoritesContext.tsx:188` |
| 68 | 🟡 media | bug | Contador "Útil" incrementa 2 por clique e o voto pode ser repetido infinitamente | `ReviewCard.tsx:153` |
| 69 | 🟡 media | bug | Cancelamento devolve estoque mas nunca devolve o uso do cupom | `20260707000000_fix_update_order_status_atomic.sql:63` |
| 70 | 🟡 media | malfuncionamento | Painel admin perde o tema escuro quando o StoreContext reaplica config (classe 'dark' removida) | `App.tsx:543` |
| 71 | 🟡 media | bug | Tela de produto fica em branco quando o produto não está entre os 200 carregados | `App.tsx:1939` |
| 72 | 🟡 media | ux | Filtro de categoria da Home é zerado toda vez que o usuário troca de aba | `App.tsx:1541` |
| 73 | 🟡 media | ux | `* { outline: none !important }` anula todo indicador de foco do teclado no app inteiro | `index.css:138` |
| 74 | 🟡 media | performance | Prefetch preditivo/Markov roda a cada render: 2 gravações em localStorage por render e previsão sempre inútil | `useBehavioralPrefetch.ts:57` |
| 75 | ⚪ baixa | seguranca | Guard de admin confia em app_metadata lido do localStorage, permitindo bypass no cliente | `AuthContext.tsx:86` |
| 76 | ⚪ baixa | bug | "Volume Total" do KPI e o total do donut de categorias nunca batem quando há cupom de desconto | `20260704170000_reconcile_category_analytics_frete.sql:23` |

---

## Achados em detalhe

### 1. 🔴 Regra de frete gratis diverge entre front e banco: checkout de convidado e bloqueado

`src/contexts/CartContext.tsx:729` · **critica** · bug · _Carrinho, cupons e checkout_

**Problema.** O calculo de frete no front so zera o frete quando existe usuario logado (`&& user`). Ja a RPC `create_marketplace_order_v22` zera o frete apenas com base no subtotal, sem olhar autenticacao: `IF v_has_free_shipping_item = true OR v_calculated_subtotal >= COALESCE(v_store_config.free_shipping_min, 999999) THEN v_shipping_validated := 0;`. Como a RPC compara o total recalculado com o `p_total_amount` enviado (`IF ABS(v_calculated_total - p_total_amount) > 0.05 THEN RAISE EXCEPTION 'Divergencia de valores detectada.'`), qualquer convidado que atinja o minimo de frete gratis manda um total com frete embutido e a transacao e recusada. O mesmo acontece se o admin zerar `free_shipping_min` (front trata 0 como 'regra desligada' e cobra frete; o banco entende 0 como 'sempre gratis').

**Reproduzir.** Loja com free_shipping_min = 350 e shipping_fee = 15. Visitante NAO logado monta um carrinho de R$ 400, escolhe 'Continuar como Convidado', preenche o endereco e toca em 'Finalizar Pedido'. Front envia totalAmount = 415 (400 + 15); banco calcula 400 (frete zerado por atingir o minimo); |400-415| = 15 > 0.05 -> excecao. O usuario ve o toast 'Falha no Pedido: Divergencia de valores detectada. Calculado: 400, Fornecido: 415' e nunca consegue comprar, independente de quantas vezes tentar.

```
if (
      config.freeShippingMin > 0 &&
      cartTotal >= config.freeShippingMin &&
      user
    )
      return 0;
```

**Correção.**

Unificar a regra nos dois lados. A intencao de produto hoje e ambigua (a copy em `src/views/customer/CartView.tsx:431-438` diz "Faça login para ... ativar o frete grátis", mas `StoreContext.calculateShipping` nao exige login), entao escolha UM dos dois caminhos e aplique inteiro:

CAMINHO A (recomendado — frete gratis para todos, front espelha o banco):
1. `src/contexts/CartContext.tsx:729-734`: remover `&& user` da condicao, deixando `if (config.freeShippingMin > 0 && cartTotal >= config.freeShippingMin) return 0;` e retirar `user` do array de dependencias (linha 747). Isso tambem elimina a divergencia com `StoreContext.tsx:597`.
2. `src/views/customer/CartView.tsx:253`: trocar `const isRuleActive = (config.freeShippingMin || 0) > 0 && !!user;` por `const isRuleActive = (config.freeShippingMin || 0) > 0;` e remover `user` das deps (linha 280); ajustar a copy das linhas 431-438 para nao prometer frete gratis condicionado a login.

CAMINHO B (frete gratis so para logados — exige mudar o banco):
Numa nova migration que recria `create_marketplace_order_v22`, trocar a linha 150 por:
`IF v_has_free_shipping_item = true OR (v_user_id IS NOT NULL AND v_calculated_subtotal >= COALESCE(NULLIF(v_store_config.free_shipping_min, 0), 999999)) THEN` (a variavel `v_user_id uuid := auth.uid()` ja existe na linha 76). Manter o `&& user` no front e replicar a mesma condicao em `StoreContext.calculateShipping` (linha 597).

OBRIGATORIO NOS DOIS CAMINHOS — corrigir o `free_shipping_min = 0`:
Na mesma migration, trocar `COALESCE(v_store_config.free_shipping_min, 999999)` por `COALESCE(NULLIF(v_store_config.free_shipping_min, 0), 999999)` na linha 150, para que 0 signifique "regra desligada" no banco tal como ja significa no front (`config.freeShippingMin > 0`). Sem isso, desligar frete gratis pelo toggle do admin (`AdminShippingView.tsx:427`) derruba todos os checkouts.

MELHORIA DEFENSIVA (opcional, mas barata): a RPC recebe `p_shipping_cost` e o ignora. Ou passar a valida-lo explicitamente (`IF ABS(v_shipping_validated - p_shipping_cost) > 0.05 THEN RAISE EXCEPTION 'Frete divergente...'`, dando erro especifico em vez do generico de total), ou remover o parametro para nao dar falsa impressao de que o front controla o frete. Alem disso, mapear a mensagem 'Divergência de valores detectada' em `src/hooks/useOrders.ts:868-871` para um texto acionavel ao cliente (hoje o usuario ve os numeros crus 'Calculado: 400, Fornecido: 415').

---

### 2. 🔴 OTP de rastreio permite acessar pedidos de terceiros com o e-mail do atacante

`supabase/migrations/20260708190000_secure_otp_flow.sql:33` · **critica** · seguranca · _Autenticacao, sessao e controle de acesso_

**Problema.** Em generate_order_otp_v1 a validacao do pedido usa OR entre WhatsApp e e-mail, e o p_order_fragment e opcional (a UI diz "ID DO PEDIDO (OPCIONAL)"), o que faz o filtro virar `ILIKE '%'` e casar com qualquer pedido. O codigo OTP e gravado em otp_verifications com o e-mail que o chamador enviou (p_email) e o trigger on_otp_created_send_email dispara o e-mail para esse endereco. Depois, get_orders_by_otp_v1 devolve pedidos que casem por e-mail OU pelo whatsapp gravado na linha do OTP. Resultado: quem informa o WhatsApp da vitima e o proprio e-mail recebe o codigo na caixa dele e le todos os pedidos da vitima. Ambas as funcoes tem GRANT para anon.

**Reproduzir.** 1) Atacante anonimo abre a tela de rastreio > aba "Rastrear sem Conta". 2) Preenche e-mail = atacante@evil.com, WhatsApp = numero da vitima, deixa o campo ID DO PEDIDO vazio. 3) O EXISTS passa porque a condicao de whatsapp e satisfeita (OR) e `o.id::text ILIKE '%'` casa com tudo. 4) O OTP e enviado para atacante@evil.com. 5) Atacante digita o codigo; get_orders_by_otp_v1 retorna todos os pedidos cujo customer_phone bate com o numero da vitima, incluindo customer_data (nome, e-mail, whatsapp), itens, totais e o endereco completo vindo de user_addresses.

```
WHERE (
            -- WhatsApp comparison immune to formatting (extracting only digits)
            (p_whatsapp IS NOT NULL AND p_whatsapp <> '' AND 
             regexp_replace(coalesce(o.customer_phone, o.customer_data->>'whatsapp', ''), '[^0-9]', '', 'g') = regexp_replace(p_whatsapp, '[^0-9]', '', 'g'))
            OR
            -- Email comparison (either on customer_data or logged-in user email)
            (p_email IS NOT NULL AND p_email <> '' AND 
             (LOWER(coalesce(o.customer_data->>'email', '')) = LOWER(p_email) 
              OR LOWER(coalesce(u.email, '')) = LOWER(p_email)))
        )
        AND o.id::text ILIKE '%' || p_order_fragment
```

**Correção.**

Criar uma nova migration (ex.: supabase/migrations/20260729000000_fix_otp_ownership.sql) que corrija as DUAS funcoes, porque so mexer em generate_order_otp_v1 nao fecha o buraco.

A) Amarrar o OTP a um pedido concreto. Guardar o pedido na linha do OTP:
   ALTER TABLE public.otp_verifications ADD COLUMN IF NOT EXISTS order_id uuid REFERENCES public.marketplace_orders(id) ON DELETE CASCADE;
   ALTER TABLE public.otp_verifications ADD COLUMN IF NOT EXISTS attempts int NOT NULL DEFAULT 0;

B) Reescrever generate_order_otp_v1 (substituindo as linhas 20-53 de 20260708190000_secure_otp_flow.sql):
   - Mover o `DELETE FROM public.otp_verifications WHERE expires_at < NOW()` para DEPOIS da validacao (hoje esta na linha 21, antes de tudo).
   - Tornar o fragmento obrigatorio, no mesmo padrao ja usado em get_orders_by_whatsapp_v3 (20260625000000:118):
     IF coalesce(p_order_fragment, '') = '' OR LENGTH(p_order_fragment) < 4 THEN
       RAISE EXCEPTION 'Informe pelo menos os 4 ultimos digitos do pedido.';
     END IF;
     IF coalesce(p_email,'') = '' OR coalesce(p_whatsapp,'') = '' THEN
       RAISE EXCEPTION 'E-mail e WhatsApp sao obrigatorios.';
     END IF;
   - Trocar o `OR` da linha 33 por `AND` e capturar o id do pedido em vez de so um EXISTS:
     SELECT o.id INTO v_order_id
     FROM public.marketplace_orders o
     LEFT JOIN auth.users u ON u.id = o.user_id
     WHERE regexp_replace(coalesce(o.customer_phone, o.customer_data->>'whatsapp', ''), '[^0-9]', '', 'g')
           = regexp_replace(p_whatsapp, '[^0-9]', '', 'g')
       AND (LOWER(coalesce(o.customer_data->>'email','')) = LOWER(p_email)
            OR LOWER(coalesce(u.email,'')) = LOWER(p_email))
       AND o.id::text ILIKE '%' || p_order_fragment
     ORDER BY o.created_at DESC LIMIT 1;
     IF v_order_id IS NULL THEN RAISE EXCEPTION 'Dados do pedido nao encontrados.'; END IF;
   - Rate limit antes de gerar (evita spam de e-mail e enumeracao):
     IF (SELECT count(*) FROM public.otp_verifications
         WHERE (email = LOWER(p_email) OR whatsapp = p_whatsapp)
           AND created_at > NOW() - INTERVAL '15 minutes') >= 3 THEN
       RAISE EXCEPTION 'Muitas tentativas. Aguarde alguns minutos.';
     END IF;
   - INSERT gravando tambem o order_id: INSERT INTO public.otp_verifications (email, whatsapp, otp_code, expires_at, order_id) VALUES (LOWER(p_email), p_whatsapp, v_otp, NOW() + INTERVAL '15 minutes', v_order_id);

C) Reescrever get_orders_by_otp_v1 (arquivo 20260625000000_fix_guest_tracking_items.sql, linhas 17 e 88-97):
   - Ler tambem order_id: SELECT whatsapp, verified, order_id INTO […]

---

### 3. 🔴 Salvar qualquer configuracao isolada reseta toda a store_config para os defaults do RPC

`src/contexts/StoreContext.tsx:490` · **critica** · bug · _Realtime, cache offline e sincronizacao_

**Problema.** updateConfig monta dbUpdates apenas com as chaves alteradas e chama o RPC upsert_store_config. O RPC (supabase/migrations/20260712230000_add_local_shipping_config.sql, linhas 73-122) faz INSERT ... ON CONFLICT DO UPDATE SET <todas as colunas> = EXCLUDED, e cada EXCLUDED vem de um COALESCE com valor default hardcoded (free_shipping_min 100, whatsapp_number '5534999999999', primary_color '#000000', theme_mode 'light', logo_url NULL, origin_cep '38500-000', etc). Como as chamadas reais sao parciais (AdminCouponsView: {enableCoupons}, AdminPushView: {realTimeSalesAlerts}, AdminCarouselsView: {homeSections}), toda configuracao nao enviada e sobrescrita pelo default. Pior: home_sections nem sequer e lida pelo RPC nem existe na view publica v_store_config, entao a curadoria de vitrines nunca e salva nem chega ao cliente. O UPDATE resultante ainda e replicado por realtime (produtos/store_config estao na publicacao supabase_realtime) e o RealtimeSyncEngine grava o registro zerado no DataVault de TODOS os clientes conectados.

**Reproduzir.** Admin abre Cupons e desliga o toggle 'habilitar cupons' -> updateConfig({enableCoupons:false}) -> RPC regrava a linha inteira: logo da loja vira NULL, cor primaria volta para #000000, WhatsApp vira 5534999999999, frete gratis acima de R$100. O evento UPDATE em store_config e propagado via realtime e o _applyChangeAndNotify grava o registro zerado no IndexedDB de todos os clientes; a loja inteira perde marca e configuracao de frete em segundos, e a UI do admin ainda exibe 'Configuracoes salvas'.

```
const { error } = await (supabase.rpc as any)("upsert_store_config", {
          config_json: dbUpdates,
        });
```

**Correção.**

Correcao em tres frentes, na ordem de aplicacao:

1) BACKEND (obrigatoria — resolve a causa raiz). Nova migration reescrevendo `public.upsert_store_config` para tocar apenas as chaves presentes no jsonb. Usar `config_json ? 'coluna'` (operador de existencia) e nao COALESCE, para que colunas nullable (`logo_url`, `min_app_version`, `local_cep_range`) possam receber NULL explicitamente sem serem apagadas quando ausentes:

```sql
CREATE OR REPLACE FUNCTION public.upsert_store_config(config_json jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE result jsonb;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Não autorizado: Apenas admins podem configurar a loja.';
  END IF;

  INSERT INTO public.store_config (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

  UPDATE public.store_config sc SET
    free_shipping_min = COALESCE((config_json->>'free_shipping_min')::numeric, sc.free_shipping_min),
    shipping_fee      = COALESCE((config_json->>'shipping_fee')::numeric, sc.shipping_fee),
    whatsapp_number   = COALESCE(config_json->>'whatsapp_number', sc.whatsapp_number),
    share_text        = COALESCE(config_json->>'share_text', sc.share_text),
    business_hours    = COALESCE(config_json->>'business_hours', sc.business_hours),
    enable_reviews    = COALESCE((config_json->>'enable_reviews')::boolean, sc.enable_reviews),
    enable_coupons    = COALESCE((config_json->>'enable_coupons')::boolean, sc.enable_coupons),
    primary_color     = COALESCE(config_json->>'primary_color', sc.primary_color),
    theme_mode        = COALESCE(config_json->>'theme_mode', sc.theme_mode),
    real_time_sales_alerts   = COALESCE((config_json->>'real_time_sales_alerts')::boolean, sc.real_time_sales_alerts),
    push_marketing_enabled   = COALESCE((config_json->>'push_marketing_enabled')::boolean, sc.push_marketing_enabled),
    origin_cep        = COALESCE(config_json->>'origin_cep', sc.origin_cep),
    shipping_provider = COALESCE(config_json->>'shipping_provider', sc.shipping_provider),
    shipping_coverage = COALESCE(config_json->>'shipping_coverage', sc.shipping_coverage),
    local_delivery_fee = COALESCE((config_json->>'local_delivery_fee')::numeric, sc.local_delivery_fee),
    -- nullable: só altera se a chave veio no payload
    logo_url        = CASE WHEN config_json ? 'logo_url'        THEN config_json->>'logo_url'        ELSE sc.logo_url END,
    min_app_version = CASE WHEN config_json ? 'min_app_version' THEN config_json->>'min_app_version' ELSE sc.min_app_version END,
    local_cep_range = CASE WHEN config_json ? […]

---

### 4. 🔴 minAppVersion diferente da versao do build causa loop infinito de purge + reload no app inteiro

`src/hooks/useUpdateCheck.ts:221` · **critica** · bug · _PWA, service worker, atualizacao e push_

**Problema.** checkMandatoryUpdate compara a versao local com config.minAppVersion usando igualdade estrita (!==) e, em caso de diferenca, chama performNuclearPurge(true) imediatamente, que apaga caches, desregistra o SW, deleta o IndexedDB e faz hard reload. Como a versao do build e gerada como `1.0.0-sha.<7 chars>` ou `1.0.0-build.<5 digitos>` (vite.config.ts:42-46), ela muda a cada deploy e praticamente nunca sera igual ao valor digitado em min_app_version no banco. Nao existe contador de tentativas nem guarda de tempo: apos o reload o efeito roda de novo, detecta o mesmo mismatch e purga de novo. O guard isTimestampVersion nunca ajuda porque Number("1.0.0-sha.abc1234") e NaN.

**Reproduzir.** 1) Admin (ou uma migration) grava min_app_version = '1.0.0' em store_config. 2) Cliente abre o PWA com __APP_VERSION__ = '1.0.0-sha.ef7b099'. 3) checkMandatoryUpdate detecta '1.0.0' !== '1.0.0-sha.ef7b099' e dispara performNuclearPurge(true). 4) Caches, SW e IndexedDB sao apagados e a pagina recarrega em /?forceUpdate=... 5) O config volta a carregar com o mesmo min_app_version e o ciclo recomeca -> app pisca/recarrega infinitamente, sem nunca abrir, para 100% dos clientes.

```
if (
      config.minAppVersion &&
      config.minAppVersion !== SAFE_APP_VERSION &&
      !isTimestampVersion
    ) {
      console.log("[Update] 🚨 Mandatory version mismatch detected!");
      ...
      performNuclearPurge(true);
      return true;
    }
```

**Correção.**

Correcao em `src/hooks/useUpdateCheck.ts`, em tres camadas (a 1 e a 2 sao obrigatorias; a 3 evita que a falha fique silenciosa):

1) ACAO IMEDIATA DE MITIGACAO (fora do codigo): verificar `select min_app_version from store_config` em producao. Se estiver `'1.0.0'` (ou qualquer valor sem o sufixo `-sha.`/`-build.`), o loop ja esta armado no deploy atual. Setar para NULL ate o patch subir.

2) COMPARACAO SEMVER EM VEZ DE IGUALDADE ESTRITA. Substituir a condicao das linhas 217-225. Comparar apenas o nucleo `MAJOR.MINOR.PATCH` de ambos os lados e so purgar quando o local for ESTRITAMENTE MENOR que o minimo — assim `1.0.0-sha.ef7b099` satisfaz um minimo de `1.0.0` e o sufixo de build deixa de causar mismatch:
```ts
const parseCore = (v?: string | null): [number, number, number] | null => {
  const m = /^(\d+)\.(\d+)\.(\d+)/.exec((v ?? "").trim());
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
};
const isBelow = (local: string, min: string) => {
  const a = parseCore(local);
  const b = parseCore(min);
  if (!a || !b) return false; // formato irreconhecivel => NUNCA purga (fail-safe)
  for (let i = 0; i < 3; i++) {
    if (a[i] < b[i]) return true;
    if (a[i] > b[i]) return false;
  }
  return false; // iguais => em dia
};
```
O `return false` quando o parse falha e essencial: hoje qualquer string invalida digitada no banco derruba o app.

3) RESTAURAR O RELOAD LOOP GUARD REMOVIDO PELO COMMIT `77f32d6` (defesa em profundidade — mesmo com semver correto, um valor `2.0.0` legitimamente maior faria loop, ja que a purga nao atualiza o bundle se o servidor ainda serve o antigo). Reintroduzir a chave `pwa_mandatory_reload_timestamp` em `sessionStorage`, gravando ANTES de chamar `performNuclearPurge(true)` e abortando a purga se houver registro recente (sugiro 60s em vez dos 15s originais, pois a purga + rebuild do SW pode passar de 15s em rede lenta):
```ts
if (config.minAppVersion && isBelow(SAFE_APP_VERSION, config.minAppVersion)) {
  const last = sessionStorage.getItem("pwa_mandatory_reload_timestamp");
  const now = Date.now();
  if (last && now - Number.parseInt(last, 10) < 60000) {
    console.warn("[Update] 🛡️ Mandatory Update Reload Guard Active. Loop blocked.");
    setIsMandatory(true);
    toast.error("Atualização necessária", {
      description: `Seu aplicativo precisa ser atualizado para a versão ${config.minAppVersion}. Se o problema persistir, limpe o cache do navegador.`,
      duration: 10000,
    });
    return true;
  }
  setIsMandatory(true);
  localStorage.setItem("pwa_update_log", `Version Mismatch: ${SAFE_APP_VERSION} -> […]

---

### 5. 🔴 Máscara de moeda divide por 100 preços inteiros ao abrir o formulário de edição

`src/components/admin/LocalBufferedInput.tsx:72` · **critica** · bug · _Admin: cadastro/edicao de produtos e listagem_

**Problema.** O `formatValue` do LocalBufferedInput só trata o valor como reais quando a string contém um ponto decimal. O formulário alimenta o campo com `product.price.toString()` (AdminProductFormView.tsx:496), e `Number(100.00).toString()` devolve "100" (sem ponto). Nesse caso cai no `return formatCurrency(str)`, que interpreta a string como CENTAVOS e exibe R$ 1,00. Todo produto com preço/custo/preço original em valor redondo (R$ 100, R$ 50, R$ 20) aparece com o valor dividido por 100 na tela de edição. Pior: ao focar e sair do campo, o `handleBlur` chama `parseCurrencyToFloatString("1,00")` e faz o flush de "1.00" para o `formData`, gravando o preço errado no banco no próximo salvamento.

**Reproduzir.** 1) Cadastre/tenha um produto com preço R$ 100,00 (preco_venda = 100.00). 2) Admin > Produtos > Editar Produto. 3) O campo "Preço de Venda" mostra R$ 1,00 (e "Preço de Custo" R$ 0,50 se o custo for 50). 4) O admin clica no campo para conferir e clica fora (blur). 5) O onFlush grava formData.price = "1.00". 6) Ao clicar em Salvar, o produto passa a custar R$ 1,00 na loja. O mesmo ocorre no campo "Sobrescrever R$" das variantes (AdminProductFormView.tsx:1569-1582, alimentado por `v.priceOverride?.toString()`).

```
if (mask === "currency") {
        if (str.includes(".")) {
          const floatVal = Number.parseFloat(str);
          if (!Number.isNaN(floatVal)) {
            const cents = Math.round(floatVal * 100).toString();
            return formatCurrency(cents);
          }
        }
        return formatCurrency(str);
      }
```

**Correção.**

Corrigir no componente (correcao primaria, resolve todos os 4 campos de uma vez). Em src/components/admin/LocalBufferedInput.tsx, substituir o bloco das linhas 64-73 dentro de `formatValue`:

DE:
      if (mask === "currency") {
        if (str.includes(".")) {
          const floatVal = Number.parseFloat(str);
          if (!Number.isNaN(floatVal)) {
            const cents = Math.round(floatVal * 100).toString();
            return formatCurrency(cents);
          }
        }
        return formatCurrency(str);
      }

PARA:
      if (mask === "currency") {
        const floatVal = Number.parseFloat(str.replace(",", "."));
        if (Number.isNaN(floatVal)) return "";
        return formatCurrency(Math.round(floatVal * 100).toString());
      }

Isso passa a tratar o valor da prop SEMPRE como reais, nunca como centavos. Verificacao dos casos: "" -> NaN -> "" (mantem placeholder); "100" -> 10000 -> "100,00"; "99.9" -> 9990 -> "99,90"; "1.00" -> 100 -> "1,00"; "0" -> "0,00". Nao ha regressao no fluxo de digitacao, porque `handleChange` (linhas 112-137) continua formatando o input cru em modo centavos e `setLocalVal` sozinho — o efeito de :89-102 nao sobrescreve enquanto `isFocusedRef.current` for true, e apos o blur o valor gravado ja e "100.00" (com ponto), que a nova formula reexibe como "100,00", identico ao que estava na tela. Sem estado oscilante.

Corrigir tambem o bug irmao latente no mesmo arquivo, linhas 96-98, que aplica a mesma escala errada ao valor da prop antes de chamar `validate`:

DE:
        } else if (mask === "currency") {
          rawVal = parseCurrencyToFloatString(rawVal);
        }

PARA:
        } else if (mask === "currency") {
          const f = Number.parseFloat(rawVal.replace(",", "."));
          rawVal = Number.isNaN(f) ? "" : f.toFixed(2);
        }

Endurecimento opcional na origem (defesa em profundidade, NAO substitui a correcao acima — sozinho deixaria o componente quebrado para consumidores futuros): em src/views/admin/AdminProductFormView.tsx trocar `.toString()` por `.toFixed(2)` nas linhas 496, 497, 498 e 969, ex.: `price: product.price.toFixed(2)`.

Validacao pos-correcao: abrir Admin > Produtos > Editar em um produto com preco_venda = 100.00 e conferir que "Preco de Venda" exibe R$ 100,00; depois clicar no campo e clicar fora sem digitar, e confirmar que formData.price permanece "100.00" (o painel de margem, que ja lia 100 via `priceVal` em :1244, passa a bater com o campo).

---

### 6. 🔴 Edge function de frete sempre cai no fallback de R$ 15 por usar .catch() em query builder

`supabase/functions/calculate-shipping/index.ts:432` · **critica** · bug · _Frete, CEP e enderecos_

**Problema.** O builder do supabase-js (PostgrestBuilder) implementa apenas `then()` — nao existe metodo `catch()` (verificado em node_modules/@supabase/postgrest-js/dist/index.mjs: as unicas ocorrencias de 'catch' sao try/catch e um .catch em Promise nativa dentro do then). Como o arquivo esta com `// @ts-nocheck`, o TypeScript nao acusa. Toda chamada `supabaseClient.from(...).insert({...}).catch(...)` lanca `TypeError: ... .catch is not a function` de forma sincrona, e a excecao sobe ate o try/catch de topo (linha 695), que devolve a opcao 'flat-fee-fallback' de R$ 15 fixo. Consequencias: (1) cotacoes reais de Melhor Envio/Frenet ja calculadas sao descartadas; (2) o cache `shipping_quotes_cache` nunca e gravado; (3) `shipping_calculation_logs` fica sempre vazia — o painel 'Historico de Cotacoes & Audit Logs' do admin exibe permanentemente 'Nenhuma cotacao registrada recentemente'. Alem disso, como o builder so dispara a request no `then()`, nem o insert chega a ser executado.

**Reproduzir.** Loja com provider 'melhor_envio' e token valido. Cliente informa CEP 01310-100 -> a funcao consulta a API, monta shippingOptions com SEDEX/PAC reais -> entra no ramo `else` (linha 671) e executa `supabaseClient.from('shipping_quotes_cache').insert({...}).catch(...)` -> TypeError -> catch de topo -> resposta final = [{id:'flat-fee-fallback', price:15}]. O cliente sempre ve 'Entrega Padrao (Contingencia) R$ 15,00', nunca a cotacao real, e o admin ve o historico de cotacoes vazio.

```
supabaseClient.from('shipping_calculation_logs').insert({
                origin_cep: originCep,
                destination_cep: cleanCep,
                provider: `${provider} (Cache)`,
                cart_items: cart,
                response_time_ms: 0,
                status: 'success'
            }).catch((err) => console.error('Failed to log cache hit:', err))
```

**Correção.**

Editar `supabase/functions/calculate-shipping/index.ts` nos 4 pontos (425-432, 661-669, 672-677, 680-687), trocando `.catch(cb)` por `await` dentro de `try/catch`. Como o Edge Runtime pode encerrar o isolate assim que a `Response` é retornada, o padrão fire-and-forget é doblemente inseguro aqui — o `await` também garante que a gravação realmente ocorra.

Linha 425-432 (hit de cache), antes do `return` da linha 434:
```ts
try {
    const { error: logErr } = await supabaseClient.from('shipping_calculation_logs').insert({
        origin_cep: originCep,
        destination_cep: cleanCep,
        provider: `${provider} (Cache)`,
        cart_items: cart,
        response_time_ms: 0,
        status: 'success'
    })
    if (logErr) console.error('Failed to log cache hit:', logErr)
} catch (e) { console.error('Failed to log cache hit:', e) }
```

Linha 661-669 (contingência): mesmo padrão, `const { error: logErr } = await supabaseClient.from('shipping_calculation_logs').insert({ ... status: 'contingency', error_message: apiError || 'Nenhum método de envio retornado.' })` envolto em try/catch.

Linhas 672-677 e 680-687 (cache + log de sucesso): unificar num único bloco protegido, por exemplo
```ts
try {
    const [cacheRes, logRes] = await Promise.all([
        supabaseClient.from('shipping_quotes_cache').insert({ origin_cep: originCep, destination_cep: cleanCep, cart_hash: cartHash, options: shippingOptions }),
        supabaseClient.from('shipping_calculation_logs').insert({ origin_cep: originCep, destination_cep: cleanCep, provider, cart_items: cart, response_time_ms: latency, status: 'success' })
    ])
    if (cacheRes.error) console.error('Failed to cache shipping options:', cacheRes.error)
    if (logRes.error) console.error('Failed to log success:', logRes.error)
} catch (e) { console.error('Falha ao persistir cache/log de frete:', e) }
```

Reforços recomendados:
1. Remover o `// @ts-nocheck` da linha 1 (ou trocar por `@ts-expect-error` pontuais). Ele é a causa raiz de o compilador não ter acusado `Property 'catch' does not exist on type 'PostgrestFilterBuilder'`.
2. Tornar o fallback de topo (linhas 699-712) não-silencioso para o preço: usar `calculateSmartFallback(originCep, cleanCep, flatFee)` em vez do literal `price: 15`, para que uma exceção inesperada não continue subcobrando frete de região remota. Hoje `originCep`/`cleanCep` não estão em escopo nesse catch — declarar essas variáveis fora do try (antes da linha 141) resolve.
3. Adicionar um teste em `supabase/functions/calculate-shipping/index_test.ts` que faça stub do client e verifique que o […]

---

### 7. 🔴 upsert_store_config zera todas as configuracoes que o frontend nao enviar no payload parcial

`supabase/migrations/20260712230000_add_local_shipping_config.sql:80` · **critica** · bug · _Supabase: RLS, RPCs, migrations e edge functions_

**Problema.** upsert_store_config faz um INSERT ... ON CONFLICT (id) DO UPDATE SET reescrevendo TODAS as colunas, sempre a partir de COALESCE(config_json->>'campo', <default hardcoded>). Mas StoreContext.updateConfig (src/contexts/StoreContext.tsx:441-490) monta dbUpdates apenas com os campos alterados. Toda coluna ausente do JSON volta para o default: free_shipping_min=100, shipping_fee=15, whatsapp_number='5534999999999', share_text='Confira os produtos!', primary_color='#000000', theme_mode='light', origin_cep='38500-000', shipping_provider='flat_fee', enabled_shipping_methods='{sedex, pac}', shipping_coverage='national', local_delivery_fee=10, e logo_url/min_app_version/local_cep_range viram NULL (nem tem COALESCE).

**Reproduzir.** Loja configurada com frete gratis acima de R$350, WhatsApp real, logo carregada e provider 'melhor_envio'. O admin abre Configuracoes e apenas desliga 'Habilitar avaliacoes'. updateConfig envia config_json = { enable_reviews: false }. O ON CONFLICT DO UPDATE grava free_shipping_min=100, shipping_fee=15, whatsapp_number='5534999999999', logo_url=NULL, shipping_provider='flat_fee'. A loja perde a logo, o WhatsApp de atendimento, a integracao de frete e a regra de frete gratis de uma vez, e a UI ainda mostra 'Configuracoes salvas'.

```
VALUES (
    1,
    COALESCE((config_json->>'free_shipping_min')::numeric, 100),
    COALESCE((config_json->>'shipping_fee')::numeric, 15),
    COALESCE(config_json->>'whatsapp_number', '5534999999999'),
...
  ON CONFLICT (id) DO UPDATE SET
    free_shipping_min = EXCLUDED.free_shipping_min,
    shipping_fee = EXCLUDED.shipping_fee,
    whatsapp_number = EXCLUDED.whatsapp_number,
```

**Correção.**

Corrigir na migration (nova migration, ex. supabase/migrations/2026XXXXXXXXXX_fix_upsert_store_config_partial.sql) substituindo o INSERT ... ON CONFLICT por: (1) um `INSERT INTO public.store_config (id) VALUES (1) ON CONFLICT (id) DO NOTHING;` para garantir a linha usando os DEFAULTs da tabela, e (2) um UPDATE que usa a propria linha como fallback.

CREATE OR REPLACE FUNCTION public.upsert_store_config(config_json jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE result jsonb;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Não autorizado: Apenas admins podem configurar a loja.';
  END IF;

  INSERT INTO public.store_config (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

  UPDATE public.store_config SET
    free_shipping_min = COALESCE((config_json->>'free_shipping_min')::numeric, free_shipping_min),
    shipping_fee = COALESCE((config_json->>'shipping_fee')::numeric, shipping_fee),
    whatsapp_number = COALESCE(config_json->>'whatsapp_number', whatsapp_number),
    share_text = COALESCE(config_json->>'share_text', share_text),
    business_hours = COALESCE(config_json->>'business_hours', business_hours),
    enable_reviews = COALESCE((config_json->>'enable_reviews')::boolean, enable_reviews),
    enable_coupons = COALESCE((config_json->>'enable_coupons')::boolean, enable_coupons),
    primary_color = COALESCE(config_json->>'primary_color', primary_color),
    theme_mode = COALESCE(config_json->>'theme_mode', theme_mode),
    real_time_sales_alerts = COALESCE((config_json->>'real_time_sales_alerts')::boolean, real_time_sales_alerts),
    push_marketing_enabled = COALESCE((config_json->>'push_marketing_enabled')::boolean, push_marketing_enabled),
    origin_cep = COALESCE(config_json->>'origin_cep', origin_cep),
    shipping_provider = COALESCE(config_json->>'shipping_provider', shipping_provider),
    shipping_coverage = COALESCE(config_json->>'shipping_coverage', shipping_coverage),
    local_delivery_fee = COALESCE((config_json->>'local_delivery_fee')::numeric, local_delivery_fee),
    -- campos anulaveis: so limpa se a chave vier explicitamente no JSON
    logo_url        = CASE WHEN config_json ? 'logo_url'        THEN config_json->>'logo_url'        ELSE logo_url END,
    min_app_version = CASE WHEN config_json ? 'min_app_version' THEN config_json->>'min_app_version' ELSE min_app_version END,
    local_cep_range = CASE WHEN config_json ? 'local_cep_range' THEN config_json->>'local_cep_range' ELSE local_cep_range END,
    -- array: so reescreve se vier um array de verdade […]

---

### 8. 🔴 Update obrigatório entra em loop infinito de purge + reload (compara versão com !==)

`src/hooks/useUpdateCheck.ts:221` · **critica** · bug · _App shell, roteamento, performance e acessibilidade_

**Problema.** checkMandatoryUpdate dispara performNuclearPurge(true) sempre que config.minAppVersion for diferente (!==) de SAFE_APP_VERSION. Não há comparação semântica de versão ("menor que") nem guarda de reload. Como o vite.config gera appVersion com sufixo volátil (`${packageJson.version}-sha.${gitSha.slice(0,7)}` ou `-build.${Date.now().toString().slice(-5)}`), qualquer valor não-nulo de min_app_version no banco será, na prática, sempre diferente do build atual. O purge apaga caches, deleta o IndexedDB ikcous-datavault e faz window.location.href para a origem, o que reinicia o app na mesma versão e dispara o mesmo efeito de novo.

**Reproduzir.** Admin (ou uma migration/seed) grava store_config.min_app_version = '1.4.0'. O build publicado é '1.4.0-sha.a1b2c3d'. Ao abrir o app: config carrega -> minAppVersion !== SAFE_APP_VERSION -> performNuclearPurge(true) -> apaga caches + DataVault -> window.location.href='/?forceUpdate=...' -> recarrega -> mesma versão -> purge de novo. O usuário fica preso em uma tela que recarrega infinitamente, perde todo o cache offline e nunca consegue usar o app. O isTimestampVersion não protege, pois Number('1.4.0-sha.a1b2c3d') é NaN.

```
if (
      config.minAppVersion &&
      config.minAppVersion !== SAFE_APP_VERSION &&
      !isTimestampVersion
    ) {
      console.log("[Update] 🚨 Mandatory version mismatch detected!");
      ...
      performNuclearPurge(true);
      return true;
    }
```

**Correção.**

Duas correções em src/hooks/useUpdateCheck.ts, ambas dentro de checkMandatoryUpdate (linhas 212-242). A #1 é a causa raiz; a #2 é a rede de segurança que foi removida no commit 77f32d6 e precisa voltar.

1) Trocar igualdade por comparação semântica "menor que", normalizando o sufixo de build. Adicionar acima do hook:

const normalizeVersion = (v: string) => v.split("-")[0];
const isOlderThan = (local: string, min: string) => {
  const a = normalizeVersion(local).split(".").map(Number);
  const b = normalizeVersion(min).split(".").map(Number);
  if (a.some(Number.isNaN) || b.some(Number.isNaN)) return false; // valor malformado no banco nunca purga
  for (let i = 0; i < 3; i++) {
    const x = a[i] ?? 0;
    const y = b[i] ?? 0;
    if (x !== y) return x < y;
  }
  return false;
};

e substituir a condição das linhas 221-225 por:

if (config.minAppVersion && isOlderThan(SAFE_APP_VERSION, config.minAppVersion)) {

Remover junto as linhas 217-218 (isTimestampVersion), que são código morto desde que vite.config.ts:42-46 passou a gerar versões com sufixo — Number("1.0.0-sha.a1b2c3d") é NaN e a checagem nunca dispara. O fail-safe do `a.some(Number.isNaN)` é importante: se o admin digitar "v1.2" ou "latest" no banco, o app deve seguir funcionando em vez de se auto-destruir.

2) Restaurar a guarda anti-loop, no mesmo padrão da guarda de ChunkLoadError (linhas 290-302), gravando o timestamp ANTES de chamar performNuclearPurge(true) — que faz redirect e não retorna:

const lastPurge = sessionStorage.getItem("pwa_mandatory_reload_timestamp");
const now = Date.now();
if (lastPurge && now - Number.parseInt(lastPurge) < 60000) {
  console.warn("[Update] 🛡️ Mandatory Update Reload Guard Active. Loop blocked.");
  setIsMandatory(true);
  toast.error("Atualização necessária", {
    description: `Atualize para a versão ${config.minAppVersion}. Se o problema persistir, limpe o cache do navegador.`,
    duration: 10000,
  });
  return true;
}
sessionStorage.setItem("pwa_mandatory_reload_timestamp", now.toString());
// ... só então: performNuclearPurge(true);

Detalhe que torna a guarda confiável (verificado no código): ela sobrevive ao purge. doPurge não toca em sessionStorage, e o whitelist de localStorage das linhas 131-139 já preserva o prefixo "pwa_". A janela de 60s é melhor que os 15s originais, porque um boot frio com rede lenta pode passar de 15s entre o reload e a chegada do config.

Observação sobre ordem de prioridade: a guarda sozinha NÃO resolve o problema, só troca o loop infinito por um purge desnecessário a cada nova aba/sessão (destruindo o cache offline […]

---

### 9. 🟠 Carrinho guarda snapshot congelado do produto: preco/estoque desatualizados e checkout travado

`src/contexts/CartContext.tsx:313` · **alta** · bug · _Carrinho, cupons e checkout_

**Problema.** O item do carrinho armazena o objeto `product` inteiro (preco, estoque, freeShipping) no momento do addToCart e persiste isso em localStorage. Nada nunca reidrata esse snapshot: para convidado `syncFromDB` retorna cedo ('No user detected. Preserving local cart.') e, para logado, o merge Last-Write-Wins descarta o item remoto sempre que o timestamp local for maior ou igual (ramo vazio `if (localTs >= remoteTs) { // Local is newer }`), justamente o caso normal, ja que o `updated_at` gravado no banco vem do proprio cliente. Resultado: precos, promocoes e estoque exibidos no carrinho podem ficar meses defasados, e o checkout passa a falhar porque a RPC recalcula tudo pelos precos reais do banco.

**Reproduzir.** Cliente adiciona o produto X por R$ 100 e deixa no carrinho. Admin reajusta X para R$ 120. No dia seguinte o cliente abre o app: carrinho ainda mostra R$ 100 e total R$ 100. Ao finalizar, a RPC calcula 120 e dispara 'Divergencia de valores detectada. Calculado: 120, Fornecido: 100'. O pedido fica impossivel de fechar ate o cliente adivinhar que precisa remover e re-adicionar o item.

```
if (mergedMap.has(key)) {
                const local = mergedMap.get(key)!;
                const localTs = local.lastModifiedAt || 0;

                if (localTs >= remoteTs) {
                  // Local is newer
                } else {
```

**Correção.**

Separar identidade (product_id/variant_id/quantity/lastModifiedAt) de dados derivados (preco, estoque, imagem, freeShipping). Tres mudancas concretas:

1) src/contexts/CartContext.tsx, merge do syncFromDB (linhas 309-321): o LWW deve arbitrar apenas quantidade/variantNames, nunca o payload do produto. Substituir o ramo vazio por uma reescrita explicita com o produto fresco vindo de `reconstructedCart` (que ja foi montado com `mapProductFromDB` sobre `vw_produtos_public` + `product_variants`, linhas 218-266):

   if (localTs >= remoteTs) {
     // Local vence na quantidade, mas o produto deve vir sempre da fonte fresca
     mergedMap.set(key, { ...local, product: remoteItem.product });
   } else {
     mergedMap.set(key, { ...remoteItem, lastModifiedAt: remoteTs });
   }

   Aproveitar para reclampar a quantidade ao estoque fresco (`Math.min(local.quantity, availableStock, MAX_ITEM_QUANTITY)`), usando a mesma regra ja aplicada em addToCart:539-546.

2) Itens que so existem localmente (nunca chegaram ao banco) e o carrinho de CONVIDADO continuam sem revalidacao, porque `syncFromDB` retorna cedo em CartContext.tsx:180-186. Criar um `revalidateCartProducts()` no CartProvider que, ao montar e ao entrar em CheckoutView, faca o mesmo par de queries ja usadas nas linhas 218-237 (`vw_produtos_public` + `product_variants` filtrando por `cart.map(i => i.product.id)`), reescreva cada `item.product` com `mapProductFromDB`, remova itens cujo produto sumiu ou esta inativo e clampe a quantidade. Executar isso tambem para `userId == null`, antes do early-return.

3) Avisar o usuario em vez de deixar a falha aparecer so na RPC: ao detectar diferenca entre o preco do snapshot e o preco fresco, emitir um toast do tipo "O preco de {nome} mudou de R$ X para R$ Y" e atualizar o total antes do submit. Complementarmente, em src/hooks/useOrders.ts:867-870, tratar a mensagem 'Divergencia de valores detectada' do catch disparando `revalidateCartProducts()` e pedindo nova confirmacao, em vez de repassar o texto tecnico do Postgres direto no toast.

---

### 10. 🟠 Zod remove `variantNames` ao reidratar o carrinho: pedido perde a variacao escolhida

`src/contexts/CartContext.tsx:19` · **alta** · bug · _Carrinho, cupons e checkout_

**Problema.** O `cartItemSchema` usado para validar o carrinho salvo em localStorage nao declara o campo `variantNames`. Como `z.object().safeParse()` remove chaves nao declaradas por padrao e o codigo usa `result.data` como fonte do estado, o texto da variacao (ex.: 'Cor: Azul, Tamanho: M') e apagado em toda reidratacao. O CheckoutView depende exatamente desse campo para escrever a observacao do pedido (`.filter((item) => item.variantNames).map((item) => `${item.product.name}: ${item.variantNames}`)`), entao a informacao que o lojista precisa para separar o produto simplesmente some.

**Reproduzir.** Cliente escolhe 'Cor: Azul / Tamanho: M' na pagina do produto e adiciona ao carrinho (variantNames preenchido). Recarrega a pagina ou volta ao app depois de fechar o navegador. O estado e reconstruido pelo safeParse sem `variantNames`. Ao finalizar, `variantNotes` fica vazio e o pedido chega ao admin sem nenhuma indicacao da variacao escolhida; o lojista envia o item errado.

```
const cartItemSchema = z.object({
  product: z.any(),
  quantity: z.number().int().positive().max(MAX_ITEM_QUANTITY),
  variantId: z.string().optional().nullable(),
  lastModifiedAt: z.number().optional(),
});
```

**Correção.**

1) Correcao minima e suficiente para o bug relatado — src/contexts/CartContext.tsx, linhas 19-24, declarar o campo no schema:

const cartItemSchema = z.object({
  product: z.any(),
  quantity: z.number().int().positive().max(MAX_ITEM_QUANTITY),
  variantId: z.string().optional().nullable(),
  variantNames: z.string().optional(),
  lastModifiedAt: z.number().optional(),
});

Use `.optional()` sem `.nullable()`: CartItem (src/types/index.ts:59) declara `variantNames?: string`, e o `as unknown as CartItem` da linha 119 esconderia um `null` divergente do tipo. Nao use `.passthrough()`/`z.looseObject()` — isso reintroduziria o lixo que o parse existe para filtrar.

2) Complemento obrigatorio se quiser que a variacao sobreviva a troca de dispositivo/limpeza de cache: hoje o campo NAO e persistido no servidor. Nenhuma migration cria `cart_items.variant_names` e `public.sync_cart_atomic` (supabase/migrations/20260606000000_fix_sync_cart_atomic_updated_at.sql) insere so `(user_id, product_id, variant_id, quantity, updated_at)`. Enquanto isso nao mudar, CartContext.tsx:467 envia um campo que o banco ignora e CartContext.tsx:262-263 e codigo morto. Corrigir com uma migration nova que (a) faca `ALTER TABLE public.cart_items ADD COLUMN IF NOT EXISTS variant_names text;` e (b) recrie sync_cart_atomic incluindo a coluna, por exemplo:

INSERT INTO public.cart_items (user_id, product_id, variant_id, quantity, variant_names, updated_at)
SELECT v_user_id,
       (item->>'product_id')::text,
       COALESCE(item->>'variant_id', '')::text,
       SUM((item->>'quantity')::integer),
       MAX(item->>'variant_names'),
       COALESCE(MAX((item->>'updated_at')::timestamptz), NOW())
FROM jsonb_array_elements(p_cart_items) AS item
GROUP BY 1, 2, 3;

Se optar por NAO persistir no banco, entao remova as linhas 262-263 e o `variant_names` da linha 467 para nao manter codigo que aparenta funcionar e nao funciona.

3) Defesa contra regressao futura (baixo custo): a combinacao `z.object` + `as unknown as CartItem` faz qualquer campo novo de CartItem sumir em silencio sem erro de tsc. Trocar o cast por um schema tipado (`z.ZodType<CartItem>`) ou adicionar um teste que faz round-trip de um CartItem completo pelo `cartItemSchema` e compara as chaves impede que o proximo campo tenha o mesmo destino.

4) Reforco de UX independente do fix: como ProductView.tsx:585 envia apenas `selectedVariantObjects[0]?.id`, em produtos com mais de um grupo de variacao o `variant_id` gravado no pedido nao representa a combinacao escolhida. Depois do item 1, considere exibir `variantNames` tambem no […]

---

### 11. 🟠 sync_cart_atomic descarta `variant_names`, apagando a variacao ao sincronizar entre dispositivos

`supabase/migrations/20260606000000_fix_sync_cart_atomic_updated_at.sql:28` · **alta** · bug · _Carrinho, cupons e checkout_

**Problema.** O cliente envia `variant_names` no payload de sincronizacao (`variant_names: item.variantNames || null` em CartContext.tsx:467) e le esse campo de volta em `syncFromDB` (`if ((dbItem as any).variant_names) item.variantNames = ...`). Porem a RPC `sync_cart_atomic` faz DELETE + INSERT listando apenas (user_id, product_id, variant_id, quantity, updated_at). A coluna `variant_names` existe nos tipos gerados (src/types/database.types.ts:254) mas nunca e gravada, entao ela e sempre NULL. Qualquer caminho em que o carrinho remoto seja adotado (login em outro aparelho, primeiro acesso com carrinho local vazio) perde a variacao.

**Reproduzir.** Cliente monta o carrinho no celular escolhendo variacoes e faz login. Depois abre a loja no desktop (carrinho local vazio, sem tombstones) -> `syncFromDB` adota o carrinho remoto. Como `variant_names` esta NULL no banco, os itens voltam sem `variantNames`. Ele finaliza a compra pelo desktop e o pedido chega sem nenhuma observacao de variacao.

```
INSERT INTO public.cart_items (user_id, product_id, variant_id, quantity, updated_at)
    SELECT 
        v_user_id,
        (item->>'product_id')::text,
        COALESCE(item->>'variant_id', '')::text,
        SUM((item->>'quantity')::integer),
        COALESCE(MAX((item->>'updated_at')::timestamptz), NOW())
    FROM jsonb_array_elements(p_cart_items) AS item
    GROUP BY 1, 2, 3;
```

**Correção.**

Duas correcoes complementares — as duas sao necessarias, corrigir so a RPC nao resolve.

1) Persistir a coluna na RPC. Criar nova migration (ex.: `supabase/migrations/20260715000000_sync_cart_atomic_persist_variant_names.sql`) com o corpo de `20260606000000` acrescido de `variant_names`. Como o `GROUP BY 1, 2, 3` referencia as tres primeiras expressoes do SELECT (v_user_id, product_id, variant_id), basta entrar com agregado na 5a posicao:

    INSERT INTO public.cart_items (user_id, product_id, variant_id, quantity, variant_names, updated_at)
    SELECT
        v_user_id,
        (item->>'product_id')::text,
        COALESCE(item->>'variant_id', '')::text,
        SUM((item->>'quantity')::integer),
        MAX(item->>'variant_names'),
        COALESCE(MAX((item->>'updated_at')::timestamptz), NOW())
    FROM jsonb_array_elements(p_cart_items) AS item
    GROUP BY 1, 2, 3;

Manter `SECURITY DEFINER`, `SET search_path = public` e a checagem `IF v_user_id IS NULL THEN RAISE EXCEPTION 'Not authenticated'` iguais ao original. Reaplicar `GRANT EXECUTE ON FUNCTION public.sync_cart_atomic(jsonb) TO authenticated;` se o replace derrubar as permissoes (a coluna ja existe no banco, entao nao e preciso ALTER TABLE).

2) Parar de descartar o campo no cliente. Em `src/contexts/CartContext.tsx:19-24`, incluir o campo no schema, senao o zod v4 continua removendo `variantNames` em toda rehidratacao do localStorage:

    const cartItemSchema = z.object({
      product: z.any(),
      quantity: z.number().int().positive().max(MAX_ITEM_QUANTITY),
      variantId: z.string().optional().nullable(),
      variantNames: z.string().optional().nullable(),
      lastModifiedAt: z.number().optional(),
    });

3) (Robustez, opcional porem recomendada) Enviar `variant_names` tambem no payload de `createOrder` em `src/views/customer/CheckoutView.tsx:414-418` e grava-lo em coluna propria de `marketplace_order_items`, em vez de depender do texto livre montado em `variantNotes` (`:399-402`) dentro de `notes`. Assim o dado de expedicao deixa de depender de string concatenada e passa a ser exibivel em `OrderDetail.tsx` ao lado do SKU.

---

### 12. 🟠 Checkout de convidado quebra quando o carrinho atinge o frete gratis (divergencia de total)

`src/contexts/CartContext.tsx:729` · **alta** · bug · _Pedidos: criacao, status, historico e admin_

**Problema.** O frontend so zera o frete pelo valor minimo quando existe usuario logado (`&& user`). O backend (`create_marketplace_order_v22`) zera o frete apenas comparando o subtotal com `free_shipping_min`, sem olhar para o usuario. Para um convidado com subtotal acima do minimo, o app envia `p_total_amount = subtotal + frete` e o banco calcula `subtotal`, estourando o checksum de +-0,05 e abortando o pedido. O parametro `p_shipping_cost` enviado pelo app e simplesmente ignorado pela RPC.

**Reproduzir.** Loja com free_shipping_min = 350 e shipping_fee = 15. Visitante NAO logado adiciona R$ 400 em produtos (nenhum com frete_gratis), preenche CEP/endereco e clica em Finalizar. Frontend calcula total = 415 (nao zera o frete porque `user` e null) e envia p_total_amount = 415. A RPC calcula 400 + 0 = 400, cai em `ABS(400-415) > 0.05` e levanta excecao. O cliente ve o toast 'Falha no Pedido: Divergencia de valores detectada. Calculado: 400, Fornecido: 415' e nunca consegue comprar sem criar conta.

```
if (
      config.freeShippingMin > 0 &&
      cartTotal >= config.freeShippingMin &&
      user
    )
      return 0;
```

**Correção.**

Correcao minima e imediata (destrava o checkout de convidado): remover `&& user` do memo `shippingFee` em `src/contexts/CartContext.tsx:729-733`, deixando a condicao identica a que ja existe em `src/contexts/StoreContext.tsx:597` (`config.freeShippingMin > 0 && cartTotal >= config.freeShippingMin`) e tirar `user` do array de dependencias (linha 747). Junto disso, alinhar a UI para nao prometer regra inexistente: `src/views/customer/CartView.tsx:253` (`isRuleActive` deve perder o `&& !!user`) e o texto "Faça login para ganhar frete grátis em suas compras." em `src/components/ui/custom/FreeShippingBlock.tsx:69,88`. Se a regra de "frete gratis so para logado" for realmente desejada pelo negocio, a correcao tem de ser feita no lado oposto: em `supabase/migrations/.../create_marketplace_order_v22` (bloco de linhas 149-154 da migration 20260526000000) condicionar o `v_shipping_validated := 0` a `v_user_id IS NOT NULL`, em nova migration.

Correcao estrutural (recomendada, cobre tambem o caso do frete cotado): a RPC hoje declara `p_shipping_cost` e nunca o usa — ou o parametro e removido/validado, ou o servidor passa a ser a unica fonte de verdade do frete. O ideal e expor uma RPC de calculo (por exemplo `calculate_order_totals(p_items, p_coupon_code, p_shipping_option)`) que devolva subtotal, frete e desconto usando exatamente a mesma logica de `create_marketplace_order_v22`, e o CheckoutView usar esse retorno em `totalAmount` antes de confirmar. Enquanto o front tiver formula propria, qualquer divergencia (frete gratis, cotacao de transportadora em `selectedShippingOption`, cupom percentual) vira falha de checksum. Em paralelo, tratar o erro em `src/hooks/useOrders.ts:868-871` para nao vazar "Divergência de valores detectada. Calculado: X, Fornecido: Y" ao cliente final: mapear para uma mensagem amigavel e forcar recalculo do carrinho.

---

### 13. 🟠 Reconexao do realtime apaga a lista de pedidos do admin (chama fetchUserOrders no modo admin)

`src/hooks/useOrders.ts:536` · **alta** · bug · _Pedidos: criacao, status, historico e admin_

**Problema.** `handleReconnect`, `handleVisibilityChange` e `handleOnline` sempre chamam `fetchUserOrdersRef.current()`, inclusive quando o hook esta em modo admin (`isAdmin = true`). `fetchUserOrders` consulta `marketplace_orders` filtrando por `.eq("user_id", user.id)` e faz `setOrders(mappedOrders)`, substituindo a lista paginada do admin pelos pedidos pessoais do proprio administrador (normalmente nenhum). Como `totalOrders` nao e alterado, a paginacao continua indicando varias paginas com a tela vazia.

**Reproduzir.** Admin abre a aba Pedidos com 12 pedidos listados. O socket do realtime cai (status CHANNEL_ERROR/TIMED_OUT, comum em 4G ou ao voltar do background). Apos o backoff, `handleReconnect` executa `fetchUserOrdersRef.current()`, que busca os pedidos cujo user_id e o do admin (zero) e faz setOrders([]). A tela passa a exibir 'Ainda nao tem nenhum pedido' com a paginacao ainda mostrando '1 / 5', e so volta ao normal se o admin trocar de filtro/pagina ou remontar a view.

```
reconnectTimeout = setTimeout(
        async () => {
          if (isUnmounting) return;
          try {
            await fetchUserOrdersRef.current();
            if (!isUnmounting) setupRealtime();
```

**Correção.**

Corrigir em `src/hooks/useOrders.ts`, direcionando a recarga pós-reconexão para a função certa conforme o modo.

Correção recomendada (preserva o refresh do admin, que é o objetivo original do código):

1. Guardar os últimos parâmetros da consulta paginada. Dentro de `loadOrders` (linha 226), logo após `if (!enabled) return { orders: [], total: 0 };`, adicionar:
```ts
lastAdminQueryRef.current = { page, pageSize, statusFilter, searchQuery, startDate, endDate };
```
declarando junto aos demais refs (perto da linha 115):
```ts
const lastAdminQueryRef = useRef({ page: 0, pageSize: 20, statusFilter: "all" as string | undefined, searchQuery: "" as string | undefined, startDate: undefined as string | undefined, endDate: undefined as string | undefined });
```

2. Criar um ref de "recarregar no modo correto" e mantê-lo atualizado no mesmo `useEffect` que já sincroniza os refs (linhas 379-385):
```ts
const refreshOrdersRef = useRef<() => Promise<unknown>>(async () => []);
// dentro do useEffect existente:
refreshOrdersRef.current = isAdmin
  ? () => {
      const q = lastAdminQueryRef.current;
      return loadOrders(q.page, q.pageSize, q.statusFilter, q.searchQuery, q.startDate, q.endDate, true); // silent = true, não pisca o skeleton
    }
  : fetchUserOrders;
```

3. Trocar as três chamadas de reconexão:
- linha 536: `await fetchUserOrdersRef.current();` -> `await refreshOrdersRef.current();`
- linha 591: `fetchUserOrdersRef.current().then(() => {` -> `refreshOrdersRef.current().then(() => {`
- linha 608: idem.

Correção mínima alternativa (se não quiser tocar em `loadOrders`), apenas impedir o dano — o admin deixa de recarregar na reconexão, mas nunca mais fica com a tela zerada:
```ts
if (!isAdmin) await fetchUserOrdersRef.current();
```
(e o equivalente com `if (!isAdmin)` envolvendo as chamadas das linhas 591 e 608).

Correção complementar, recomendada no mesmo patch: em `handleReconnect`, remover a entrada morta do canal antes de reassinar, senão `setupRealtime()` (linha 537) faz early-return em `existing` (linhas 438-442) e nunca reconecta de verdade:
```ts
const stale = globalOrderSubscriptions.get(channelId);
if (stale) {
  globalOrderSubscriptions.delete(channelId);
  supabase.removeChannel(stale.channel).catch(() => {});
}
```
antes de chamar `setupRealtime()`.

---

### 14. 🟠 OrderDetailsView entra em loop infinito de requisicoes quando o usuario nao tem pedidos

`src/views/customer/OrderDetailsView.tsx:145` · **alta** · performance · _Pedidos: criacao, status, historico e admin_

**Problema.** `loadOrder` declara `orders` como dependencia do `useCallback` e o `useEffect` depende de `loadOrder`. Quando `orders.length === 0`, o efeito chama `fetchUserOrders()`, que executa `setOrders(mappedOrders)` com um array novo mesmo quando o resultado e vazio. A nova referencia recria `loadOrder`, que dispara o efeito de novo, gerando um ciclo infinito de chamadas ao Supabase. O mesmo `if (orders.length === 0)` produz o problema oposto quando ha cache: com a lista ja preenchida, a tela nunca revalida os dados no servidor.

**Reproduzir.** Usuario recem-logado (sem pedidos proprios, cache local vazio) abre /order-details de um pedido feito como convidado, ou chega ali por uma notificacao push. `orders` fica sempre em [] porque a consulta retorna vazio, e o par useCallback/useEffect dispara `fetchUserOrders` indefinidamente: a aba passa a fazer dezenas de requests por minuto ao Supabase, com o spinner 'Sincronizando Dados' travado, ate a tela ser fechada.

```
setOrder(found || null);
    setLoading(false);
  }, [orderId, fetchUserOrders, orders]);

  useEffect(() => {
    loadOrder();
  }, [loadOrder]);
```

**Correção.**

Duas correcoes complementares — a primeira e obrigatoria, a segunda blinda outros consumidores.

1) Em `src/views/customer/OrderDetailsView.tsx`: tirar `orders` das deps do `useCallback` (ler por ref) e limitar o fetch a uma tentativa por `orderId`.

```tsx
import { useCallback, useEffect, useRef, useState } from "react";

const ordersRef = useRef(orders);
useEffect(() => {
  ordersRef.current = orders;
}, [orders]);
const fetchedForOrderIdRef = useRef<string | null>(null);

const loadOrder = useCallback(async () => {
  let currentOrders = ordersRef.current;
  if (currentOrders.length === 0 && fetchedForOrderIdRef.current !== orderId) {
    fetchedForOrderIdRef.current = orderId;
    currentOrders = await fetchUserOrders();
  }
  let found = currentOrders.find((o) => o.id === orderId);

  if (!found) {
    try {
      const guestCached = sessionStorage.getItem("guest_tracked_orders");
      if (guestCached) {
        const parsed = JSON.parse(guestCached);
        if (Array.isArray(parsed)) {
          found = parsed.find((o) => o.id === orderId);
        }
      }
    } catch (e) {
      console.error("Error loading guest orders from sessionStorage:", e);
    }
  }

  setOrder(found || null);
  setLoading(false);
}, [orderId, fetchUserOrders]);
```
Com isso o efeito passa a depender so de `orderId` e `fetchUserOrders` (ambos estaveis) e o loop morre.

Para resolver tambem a falta de revalidacao (item c da justificativa), trocar o `if (currentOrders.length === 0 ...)` por uma revalidacao unica por montagem/`orderId`, usando o cache apenas para pintar a tela rapido:
```tsx
if (fetchedForOrderIdRef.current !== orderId) {
  fetchedForOrderIdRef.current = orderId;
  const fresh = await fetchUserOrders();
  if (fresh.length > 0) currentOrders = fresh;
}
```
(mostra o cache imediatamente e ainda assim busca o estado atual do servidor uma unica vez).

2) Em `src/hooks/useOrders.ts`, linha 204, eliminar a troca de referencia inutil na origem, protegendo qualquer outro consumidor que caia no mesmo padrao:
```ts
setOrders((prev) =>
  prev.length === 0 && mappedOrders.length === 0 ? prev : mappedOrders,
);
```
Observacao: isso sozinho NAO basta, porque o primeiro `setOrders` apos o cache de `localStorage` ainda pode trocar a referencia; a correcao (1) e a que fecha o buraco.

3) Opcional, mas recomendado para o caso do admin: `AdminUserDetailView` navega para a view de cliente `order-details`, que so consulta `marketplace_orders` do proprio usuario logado. Vale adicionar um fallback de busca direta por `orderId` (respeitando RLS/admin) quando o pedido nao estiver […]

---

### 15. 🟠 Falha na consulta pública de produtos zera o catálogo inteiro em silêncio

`src/contexts/StoreContext.tsx:405` · **alta** · bug · _Catalogo, produto, busca e comparacao_

**Problema.** No fallback para a view pública, o erro só é propagado quando existe TAMBÉM um erro anterior da consulta admin (`publicRes.error && error`). Para um cliente comum (não-admin) a variável `error` é sempre null, então qualquer falha na consulta de `vw_produtos_public` (offline, timeout, PostgREST fora do ar, falha do embed `product_variants(*)`) não lança, não loga e não avisa. O fluxo cai no `else` final e substitui a lista de produtos por um array vazio, descartando o catálogo que já tinha sido carregado do IndexedDB (DataVault).

**Reproduzir.** 1) Usuário abre o PWA já com catálogo em cache no IndexedDB; a Home pinta os produtos instantaneamente. 2) O celular perde a rede (ou o Supabase devolve erro) durante o `fetchProducts` de revalidação. 3) `publicRes.error` existe mas `error` é null, então nada é lançado. 4) `data` continua null e o código executa `setProducts(prev => prev.length === 0 ? prev : [])`. 5) A tela pisca e mostra 'Nenhum produto agora' com o catálogo inteiro sumindo, mesmo tendo dados offline válidos salvos - exatamente o oposto do que um PWA offline-first deve fazer.

```
if (publicRes.error && error) {
          throw error;
        } else if (publicRes.data) {
          data = publicRes.data;
          error = null;
        }
      }

      if (error) throw error;

      if (data && data.length > 0) {
        ...
      } else {
        setProducts((prev) => (prev.length === 0 ? prev : []));
      }
```

**Correção.**

Em `src/contexts/StoreContext.tsx`, dentro de `fetchProducts` (linhas 398-433), tratar o erro da consulta pública de forma independente e nunca esvaziar a lista sem resposta bem-sucedida:

1) Substituir o bloco das linhas 405-410 por:
```ts
if (publicRes.error) {
  throw publicRes.error;   // cai no catch (434) que preserva o estado atual
}
data = publicRes.data;
error = null;
```
Isso é seguro nos três caminhos: quando o admin já obteve dados o bloco de fallback nem é executado (`if (!isAdmin || loading || error)`, 398); quando a query admin falhou, propagar `publicRes.error` é equivalente e mais informativo; e para não-admin/`loading` passa a propagar o erro que hoje some.

2) Endurecer o `else` da linha 431 para só limpar quando o servidor realmente respondeu com zero linhas:
```ts
} else if (Array.isArray(data)) {
  setProducts((prev) => (prev.length === 0 ? prev : []));
}
```
Assim `data === null` (qualquer falha) nunca zera o catálogo.

3) No `catch` (434-436), além do `console.error` já existente, sinalizar ao usuário em vez de silenciar — por exemplo `if (products.length > 0) toast.info("Exibindo catálogo offline")` (o `toast` do `sonner` já está importado na linha 18 e é usado em `updateConfig`), e só mostrar erro bloqueante quando não houver nada em cache. Opcionalmente expor um flag `isStale` no `contextValue` (621-642) para que `HomeView` diferencie "loja sem produtos" de "não consegui atualizar", evitando o texto enganoso "Nenhum produto agora" (HomeView.tsx:490).

---

### 16. 🟠 ProductView é reaproveitada entre produtos diferentes e mantém estado obsoleto (imagem, variação, quantidade)

`src/App.tsx:1945` · **alta** · bug · _Catalogo, produto, busca e comparacao_

**Problema.** A tela de detalhe é renderizada sem `key` atrelada ao id do produto (diferente de CartView/ProfileView/FavoritesView, que passam `key`). Como o container das views secundárias usa `key={currentView}`, navegar de um produto para outro (via 'Você também pode gostar') mantém `currentView === 'product-detail'` e o React reconcilia a MESMA instância de ProductView. Os estados `currentImageIndex`, `selectedVariants`, `quantity`, `activeTab` e `cartStatus` não são resetados por nenhum efeito com dependência de `product.id`.

**Reproduzir.** 1) Usuário abre o Produto A (5 fotos), desliza até a 5ª foto (currentImageIndex = 4) e seleciona 'Tamanho: M'. 2) Rola até as recomendações e clica no Produto B, que tem só 1 foto e nenhuma variação. 3) ProductView não remonta: `product.images?.[4]` é undefined, então a `<motion.img>` recebe `src=""` e a galeria principal do Produto B aparece em branco/quebrada. 4) O `selectedVariants` continua `{Tamanho: 'M'}`; se o Produto B tiver um grupo chamado 'Tamanho' com outros valores, a validação `missingVariations` passa como se já estivesse selecionado e o item vai para o carrinho com `variantNames` do produto anterior e `variantId` undefined. 5) A quantidade escolhida no Produto A (ex.: 4) permanece mesmo que o Produto B tenha 1 unidade.

```
return (
          <PreloadedOrLazy
            component={ProductView}
            props={{
              product: product,
              isFavorite: favorites.some((f) => f.id === product.id),
```

**Correção.**

Correção primária (1 linha, segue o padrão já existente no próprio arquivo): em src/App.tsx, no case "product-detail" (linhas 1945-1959), adicionar a key dentro do objeto `props`, exatamente como já é feito em checkout/user-profile/profile:

```tsx
<PreloadedOrLazy
  component={ProductView}
  props={{
    key: `product-detail-${product.id}`,
    product: product,
    isFavorite: favorites.some((f) => f.id === product.id),
    ...
  }}
/>
```

Isso funciona porque PreloadedOrLazy repassa o objeto para `React.createElement(Loaded, props)` (src/utils/lazyWithPreload.ts:56/63), que extrai `key` do config. Não há custo de tipagem: o parâmetro é `props: React.ComponentProps<T>` com `component: any`, então T resolve para any — é o mesmo motivo de os outros cases já compilarem com `key`. Efeito colateral aceitável: a remontagem reexecuta `useDeferredRender(220)`, exibindo skeleton por ~220ms; o cache de recomendações é de módulo (getRecsCache/updateRecsCache), então não se perde.

Correção alternativa (se quiser evitar a remontagem e o skeleton): em src/views/customer/ProductView.tsx, adicionar um useLayoutEffect — e NÃO useEffect — logo após as declarações de estado (após a linha 255), para que o reset ocorra antes da pintura e não haja um frame com `src=""`:

```tsx
useLayoutEffect(() => {
  setCurrentImageIndex(0);
  setSelectedVariants({});
  setQuantity(1);
  setCartStatus("idle");
}, [product.id]);
```

Independentemente da opção escolhida, vale endurecer dois pontos como defesa em profundidade:
1. ProductView.tsx:738 — trocar `product.images?.[currentImageIndex]` por um índice clampado, ex.: `const safeImageIndex = Math.min(currentImageIndex, Math.max((product.images?.length ?? 1) - 1, 0));` e usar `variantImage || product.images?.[safeImageIndex] || product.images?.[0] || ""` (evita src="" mesmo em outros cenários).
2. ProductView.tsx:562-564 e 620-622 — a validação `missingVariations` deve exigir que o valor selecionado EXISTA no produto atual, não apenas ser truthy: filtrar por `(groupName) => !variantGroups[groupName]?.some((v) => v.value === selectedVariants[groupName])`. Assim, mesmo que um estado antigo vaze por qualquer caminho, o item nunca vai para o carrinho com `variantNames` inexistente e `variantId` undefined (que hoje é persistido em `variant_names` no banco via CartContext.tsx:467).

---

### 17. 🟠 Com dois ou mais grupos de variação, o preço cobrado depende da ordem em que o usuário clicou

`src/views/customer/ProductView.tsx:585` · **alta** · bug · _Catalogo, produto, busca e comparacao_

**Problema.** O preço exibido é calculado com um `reduce` que fica com o ÚLTIMO `priceOverride` não nulo (na ordem de inserção das chaves de `selectedVariants`, ou seja, a ordem de clique). Já o carrinho recebe apenas `selectedVariantObjects[0]?.id`, isto é, a variação do PRIMEIRO grupo clicado. O servidor cobra `COALESCE(v.price_override, p.preco_venda)` desse único variant id e dá baixa apenas nele (`UPDATE product_variants SET stock_increment = stock_increment - v_quantity`). Resultado: preço mostrado e preço cobrado divergem, e o estoque das demais variações escolhidas nunca é decrementado.

**Reproduzir.** Produto de R$ 100 com grupo 'Tamanho' (M, sem priceOverride) e grupo 'Cor' (Azul, priceOverride = 150). Cliente A clica primeiro em 'Tamanho: M' e depois em 'Cor: Azul': a tela mostra R$ 150,00, mas `selectedVariantObjects[0]` é a variação M (sem override) e o pedido é criado por R$ 100 - a loja perde R$ 50 e só dá baixa no estoque de 'M'. Cliente B clica na ordem inversa e paga os R$ 150. Mesmo produto, mesmas opções, preços diferentes só por causa da ordem de clique.

```
const currentPrice = selectedVariantObjects.reduce(
    (acc, v) => v?.priceOverride || acc,
    product.price,
  );
...
    onAddToCart(quantity, selectedVariantObjects[0]?.id, variantNames);
```

**Correção.**

Unificar a regra de precificação e de identificação da variação, usando a MESMA fonte para o preço exibido e para o id enviado ao carrinho.

1) Em `src/views/customer/ProductView.tsx`, trocar a ordem de clique por uma ordem determinística (a dos grupos renderizados) e eleger explicitamente uma "variação de precificação":

```ts
// ordem estável = ordem dos grupos em variantGroups, não a de clique
const orderedSelected = Object.keys(variantGroups)
  .map((groupName) =>
    product.variants?.find(
      (v) => v.name === groupName && v.value === selectedVariants[groupName],
    ),
  )
  .filter(Boolean) as ProductVariant[];

const overridden = orderedSelected.filter(
  (v) => typeof v.priceOverride === "number",
);
// regra única: a variação que define o preço é a mesma enviada ao carrinho
const pricingVariant = overridden[0] ?? orderedSelected[0];
const currentPrice = pricingVariant?.priceOverride ?? product.price;
```

e na linha 585 enviar exatamente essa variação:
```ts
onAddToCart(quantity, pricingVariant?.id, variantNames);
```
Assim o que a tela mostra é literalmente `COALESCE(v.price_override, p.preco_venda)` do id que o RPC vai usar — display, carrinho e servidor passam a coincidir sempre. Usar `??` em vez de `||` também corrige o caso de `priceOverride = 0`, que hoje é ignorado pelo `||` embora o admin permita salvá-lo (`AdminProductFormView.tsx:917-920` faz `Math.max(0, parsedPriceOverride)`).

2) Bloquear a ambiguidade em vez de escondê-la: se `overridden.length > 1` com valores distintos, barrar o "Adicionar ao carrinho" com um `toast.error` claro (a combinação escolhida tem preços conflitantes) e registrar um aviso no admin, já que o modelo atual não tem SKU por combinação. Alternativa, se a regra de negócio preferir: usar sempre o maior override (`Math.max`) — mas então o mesmo `pricingVariant` precisa ser o enviado ao carrinho.

3) Alinhar o limite de quantidade: `CartContext.addToCart` (`src/contexts/CartContext.tsx:536-541`) deve considerar o menor `stockIncrement` entre todas as variações escolhidas, e não só o da variação enviada, para não permitir carrinho acima do estoque real da combinação.

4) Correção estrutural (backend), para a baixa de estoque cobrir todas as variações escolhidas: estender `p_items` de `create_marketplace_order_v22` para aceitar `variant_ids uuid[]` (mantendo `variant_id` por compatibilidade), decrementar `stock_increment` de cada id do array no loop das linhas 203-244 de `supabase/migrations/20260526000000_coupon_percentage_fixes.sql`, e definir no SQL a mesma regra de preço do front (ex.: primeiro override na […]

---

### 18. 🟠 Catálogo do cliente está travado em 200 produtos, sem paginação

`src/contexts/StoreContext.tsx:401` · **alta** · malfuncionamento · _Catalogo, produto, busca e comparacao_

**Problema.** Tanto a consulta admin quanto a pública usam `.limit(200)` ordenando por `data_cadastro` decrescente, e esse array é a ÚNICA fonte de dados da Home, da SearchView, do SearchBar, dos carrosséis e das seções de ofertas/destaques. Não existe paginação nem carregamento incremental no lado cliente. A partir do 201º produto cadastrado, os mais antigos simplesmente deixam de existir para o cliente.

**Reproduzir.** Loja cadastra o 201º produto. O produto mais antigo cai fora do `.limit(200)`: ele some do Catálogo, some do filtro de categoria, não é encontrado em nenhuma busca (a busca filtra o array local em `useSearch`/`SearchBar`), e não aparece nos favoritos que dependem do catálogo. O produto continua ativo no banco e vendável por link direto, mas está invisível na loja - e nada na UI indica que a lista foi truncada.

```
const publicRes = await supabase
          .from("vw_produtos_public")
          .select("*, product_variants(*)")
          .limit(200)
          .order("data_cadastro", { ascending: false });
```

**Correção.**

Corrigir em duas camadas, porque so trocar o `limit` nao basta.

1) `src/contexts/StoreContext.tsx`, funcao `fetchProducts` (linhas 377-439): substituir os dois `.limit(200)` (linhas 391 e 402) por busca paginada completa com `.range()`, acumulando as paginas antes de tocar no state e no vault. Algo como: laco `while` com `page` e `PAGE_SIZE = 500`, `.select("*, product_variants(*)", { count: "exact" }).order("data_cadastro", { ascending: false }).range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1)`, parando quando `acumulado.length >= count` ou a pagina vier vazia. Isso e obrigatorio antes do `vaultRef.current?.replaceAll("products", mapped)` da linha 424, pois `replaceAll` com um lote parcial destruiria o cache offline; so chame `replaceAll` com o conjunto completo. Aplicar identicamente ao ramo `vw_produtos_admin` (linhas 387-392), preservando o `.is("deleted_at", null)`.

2) Se carregar o catalogo inteiro no cliente for inaceitavel por volume, a alternativa correta e mover busca e filtro de categoria para o servidor em vez de manter o array unico: `src/hooks/useSearch.ts` (filtro local em `products.filter(...)`, linhas 19-42), `src/views/customer/HomeView.tsx:117-166` e `src/components/ui/custom/SearchBar.tsx:33` passariam a consultar `vw_produtos_public` com `.ilike("nome", "%termo%")` / `.eq("categoria", cat)` + `.range()` — exatamente o padrao ja implementado no ramo nao-admin de `useProducts.loadProducts` (linhas 314-353), que pode ser reaproveitado. Nesse caso e preciso tambem paginar o Catalogo da Home (scroll infinito ou botao "carregar mais") e resolver favoritos por consulta `.in("id", dbFavoriteIds)` em vez do `allProducts.filter(...)` de `FavoritesContext.tsx:188`.

3) Independente da opcao escolhida, blindar a rota de detalhe em `src/App.tsx:1939-1943`: quando `getProductById(products, selectedProductId)` retornar `undefined`, nao renderizar `null`. Buscar o produto na rede via `fetchProduct(selectedProductId)` (ja existe em `src/hooks/useProducts.ts:219-273` e faz o `select` completo + variantes), exibindo um estado de carregamento enquanto isso e caindo para tela de "produto nao encontrado" apenas se a consulta falhar. Sem esse ajuste, qualquer produto ausente do array em memoria continua produzindo tela branca silenciosa mesmo com a paginacao corrigida.

---

### 19. 🟠 send-push responde success:true mesmo quando todos os envios falham; admin ve 'Notificacao enviada'

`supabase/functions/send-push/index.ts:128` · **alta** · malfuncionamento · _PWA, service worker, atualizacao e push_

**Problema.** A edge function usa Promise.allSettled e empilha os resultados em `results`, mas retorna sempre `{ success: true, total: subscriptions.length }` com HTTP 200, sem contar quantos foram 'fulfilled' e quantos 'rejected'. No cliente (AdminPushView.tsx:391) so o `pushError` do invoke e verificado, entao qualquer falha de entrega (VAPID invalido, endpoint expirado, erro da lib webpush) e reportada como sucesso. O log em push_notifications_log ja foi inserido antes do disparo com recipient_count = total de alvos, e o historico da tela imprime 'Enviada' fixo (AdminPushView.tsx:1109-1111).

**Reproduzir.** 1) VAPID_PRIVATE_KEY esta ausente/rotacionada ou os endpoints estao expirados. 2) Admin escreve a campanha e clica em 'Enviar Notificacao Agora (120 clientes)'. 3) Todas as 120 chamadas de webpush rejeitam e caem em allSettled como 'rejected'. 4) A funcao retorna 200 com success:true. 5) O admin ve o toast 'Notificacao enviada para 120 dispositivos!' e o historico marca 'Enviada', enquanto nenhum cliente recebeu nada — e nao ha nenhum sinal de erro em lugar nenhum.

```
return new Response(
            JSON.stringify({ success: true, total: subscriptions.length, results }),
            { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
```

**Correção.**

1) Edge function supabase/functions/send-push/index.ts — substituir o bloco das linhas 127-130 por uma resposta que contabiliza os resultados (mantendo HTTP 200 para que o supabase-js entregue o corpo ao cliente):

const sent = results.filter((r) => r.status === 'fulfilled').length;
const failed = results.length - sent;
const errors = results
    .filter((r: any) => r.status === 'rejected')
    .slice(0, 20)
    .map((r: any) => String(r.reason?.message ?? r.reason));

return new Response(
    JSON.stringify({ success: failed === 0, sent, failed, total: subscriptions.length, errors }),
    { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
)

(opcional, para nao inflar o payload: parar de devolver o array `results` cru, que hoje carrega objetos de erro inteiros.)

2) src/views/admin/AdminPushView.tsx — em handleSend:
a) Trocar a insercao "cega" das linhas 324-334 por uma insercao que devolva o id, para poder corrigir o registro depois do disparo:
   const { data: logRow, error: logError } = await supabase
     .from("push_notifications_log")
     .insert({ title: notification.title, body: notification.body, url: notification.url, recipient_count: finalRecipientCount, status: "sending", created_by: user?.id })
     .select("id")
     .single();
b) Na linha 376, capturar tambem o `data`:
   const { data: pushResult, error: pushError } = await supabase.functions.invoke("send-push", { ... });
c) Substituir o `if (pushError) { ... } else { ... }` das linhas 391-410 por uma decisao baseada em sent/failed:
   const sent = pushResult?.sent ?? 0;
   const failed = pushResult?.failed ?? (pushError ? finalRecipientCount : 0);
   await supabase.from("push_notifications_log")
     .update({ recipient_count: sent, status: failed === 0 ? "sent" : (sent === 0 ? "failed" : "partial") })
     .eq("id", logRow.id);
   if (pushError || sent === 0) {
     toast.error(`Falha no envio: nenhum dos ${finalRecipientCount} dispositivos recebeu o push (o aviso no app foi salvo).`);
     console.error("send-push falhou:", pushError, pushResult?.errors);
   } else if (failed > 0) {
     toast.warning(`Enviada para ${sent} de ${finalRecipientCount} dispositivos (${failed} falharam).`);
   } else {
     toast.success(`Notificação enviada para ${sent} dispositivos!`);
   }
   E so chamar recordAction("PUSH_DISPATCH", ...) com status "success" quando failed === 0, usando `sent` em vez de `finalRecipientCount` em recipient_count.
d) Chamar tambem fetchSubscribers() apos o disparo, ja que a edge function apaga assinaturas 410/404 (index.ts:117) e o contador subCount fica […]

---

### 20. 🟠 Assinatura push e criada no navegador mas nunca salva no banco quando o visitante nao esta logado

`src/hooks/usePushNotifications.ts:70` · **alta** · bug · _PWA, service worker, atualizacao e push_

**Problema.** O subscribe() pede permissao e chama pushManager.subscribe() ANTES de verificar se existe usuario autenticado; se `user` for null, ele apenas faz console.warn e retorna, deixando uma PushSubscription ativa no navegador sem nenhuma linha em push_subscriptions. Como a RLS de push_subscriptions so permite `authenticated` com auth.uid() = user_id (migration 20260708230000, policy push_subscriptions_all_policy), visitante anonimo nunca conseguiria gravar mesmo se tentasse. Pior: no proximo carregamento `getSubscription()` retorna a assinatura orfa, o banner some para sempre (PushNotificationBanner.tsx:35) e o usuario acredita estar inscrito.

**Reproduzir.** 1) Cliente deslogado abre a loja e o PushNotificationBanner aparece apos 2,5s. 2) Clica em 'Quero Receber!' e concede a permissao no navegador. 3) `if (!user) return;` interrompe antes do upsert — nenhum toast de erro, nenhum registro no banco. 4) O banner nunca mais aparece (permission = granted + getSubscription != null) e o cliente nunca recebe nenhuma notificacao da loja, sem forma de descobrir o motivo.

```
// ZENITH v21.7: Rely on AuthContext's verified user
      if (!user) {
        console.warn("[Push] No user session for subscription.");
        return;
      }
```

**Correção.**

Em `src/hooks/usePushNotifications.ts`:

1) Mover a checagem de sessao para o topo de `subscribe`, antes de `Notification.requestPermission()` (linha 44) e de `pushManager.subscribe()` (linha 64), e falhar de forma visivel em vez de `return` mudo:
```ts
const subscribe = useCallback(async () => {
  if (!isSupported) return;
  if (!user) {
    toast.error("Entre na sua conta para receber as notificacoes.");
    throw new Error("AUTH_REQUIRED");
  }
  ...
```
Assim nenhuma PushSubscription orfa e criada e a permissao do navegador nao e queimada.

2) Blindar o caminho de erro apos a criacao da assinatura: se o upsert retornar `error` (linha 88), chamar `await newSubscription.unsubscribe()` antes de propagar, para nao deixar assinatura ativa no navegador sem registro no banco. Hoje o `throw error` deixa a assinatura viva e o `permission` ja em `granted`, reproduzindo o mesmo estado morto.

3) Adicionar reconciliacao para os usuarios ja queimados (assinaturas orfas criadas pela versao atual). Um efeito que reage a `user` e a `subscription`: quando existir sessao e existir assinatura local, refazer o upsert por `endpoint` (o `onConflict: "endpoint"` ja e idempotente):
```ts
useEffect(() => {
  if (!user || !subscription) return;
  const sync = async () => {
    const j = subscription.toJSON();
    await (supabase.from("push_subscriptions" as any) as any).upsert(
      { endpoint: j.endpoint, p256dh: j.keys?.p256dh, auth: j.keys?.auth, user_id: user.id },
      { onConflict: "endpoint" },
    );
  };
  sync().catch((e) => console.error("[Push] sync falhou:", e));
}, [user, subscription]);
```
Sem esse passo, quem ja aceitou deslogado permanece invisivel para a loja para sempre.

4) Em `src/components/pwa/PushNotificationBanner.tsx`: consumir `user` (via `useAuth`) e, quando nao houver sessao, trocar o `handleSubscribe` por navegacao para a tela `auth` (o botao "Quero Receber!" vira "Entrar para receber"), ou simplesmente nao exibir o banner enquanto `user` for `null`. Tratar o erro `AUTH_REQUIRED` no `catch` (linhas 76-78) sem esconder o banner.

5) Limpar a redundancia da linha 83 (`user_id: user?.id || null` -> `user_id: user.id`), ja que apos o guard `user` e garantido e a RLS rejeita `user_id` nulo.

---

### 21. 🟠 ErrorBoundary de chunk trava o app numa tela de spinner 'Atualizando o Aplicativo' sem saida

`src/components/ui/custom/GlobalErrorBoundary.tsx:104` · **alta** · bug · _PWA, service worker, atualizacao e push_

**Problema.** Quando um erro de chunk ocorre, componentDidCatch so recarrega se passaram mais de 10s desde o ultimo reload (chave `pwa_chunk_reload_time`); se a guarda bloquear, nada mais acontece, mas o render() continua devolvendo a tela de spinner infinito, que nao tem botao nem timeout. Alem disso existe um segundo mecanismo concorrente em useUpdateCheck.ts:290-312 com outra chave (`pwa_chunk_error_reload`, 15s) e outra estrategia (nuclear purge), de modo que os dois se atropelam e nenhuma das guardas conhece a outra.

**Reproduzir.** 1) Deploy novo entra no ar enquanto o cliente esta com a aba aberta; um import dinamico falha (chunk antigo removido). 2) O boundary recarrega a pagina e grava pwa_chunk_reload_time. 3) Logo apos o reload o mesmo chunk falha de novo (cache do SW ainda serve o index/asset antigo). 4) Agora `now - lastReload < 10000`, o reload nao acontece, mas render() devolve a tela 'Atualizando o Aplicativo' com spinner. 5) O usuario fica preso nessa tela indefinidamente, sem botao de recarregar, ate fechar o app manualmente.

```
if (isChunkError) {
        return (
          <div className="flex size-full flex-col items-center justify-center bg-[#09090b] p-6 text-center antialiased">
            <div className="size-10 animate-spin rounded-full border-3 border-white/10 border-t-admin-gold" />
            <h1 className="mt-6 text-sm font-black uppercase tracking-[0.2em] text-white">
              Atualizando o Aplicativo
            </h1>
```

**Correção.**

Aplicar em `src/components/ui/custom/GlobalErrorBoundary.tsx`:

1. Adicionar ao `State` um flag `recoveryBlocked: boolean` (default false) e um `retryTimer` como campo de instancia.

2. Em `componentDidCatch`, trocar a guarda temporal por um contador de tentativas em sessionStorage e escalonar a acao, sempre garantindo saida visivel:
```ts
const KEY = "pwa_chunk_retry_count";
const attempt = Number(sessionStorage.getItem(KEY) || "0") + 1;
sessionStorage.setItem(KEY, String(attempt));
localStorage.setItem("pwa_reload_reason", `Chunk error (tentativa ${attempt})`);

if (attempt === 1) {
  window.location.reload();
  return;
}
if (attempt === 2) {
  // reload puro nao resolve: o SW de src/sw/sw.ts serve assets por
  // stale-while-revalidate e devolve o mesmo chunk quebrado do cache
  void (async () => {
    try {
      if ("caches" in window) {
        const keys = await caches.keys();
        await Promise.all(keys.map((k) => caches.delete(k)));
      }
    } catch (e) { console.error("[GEB] cache purge falhou", e); }
    window.location.href = `${window.location.origin}/?chunkRecover=${Date.now()}`;
  })();
  return;
}
// 3a falha em diante: para de tentar e entrega controle ao usuario
this.setState({ recoveryBlocked: true });
```

3. Adicionar rede de seguranca contra spinner eterno mesmo no caminho "feliz": logo apos entrar no ramo de chunk, agendar `this.retryTimer = window.setTimeout(() => this.setState({ recoveryBlocked: true }), 8000)` e limpar em `componentWillUnmount`. Assim, se o reload nao acontecer por qualquer motivo (sessionStorage lancando excecao em modo privativo — hoje o `catch` das linhas 63-65 apenas loga e cai no spinner —, reload bloqueado, aba suspensa), a tela vira acionavel em 8s.

4. Em `render()`, no ramo `isChunkError`, so mostrar o spinner quando `!this.state.recoveryBlocked`. Quando `recoveryBlocked` for true, renderizar tela com titulo "Nao foi possivel atualizar o app" e dois botoes reais:
   - "Recarregar agora": `sessionStorage.removeItem("pwa_chunk_retry_count"); window.location.reload();`
   - "Limpar dados do app": versao endurecida do `handleReset` atual (linhas 93-98), que hoje so faz `localStorage.clear()` + `sessionStorage.clear()` + reload e por isso nao resolve chunk quebrado — acrescentar antes do reload `await caches.keys().then(ks => Promise.all(ks.map(k => caches.delete(k))))` e `navigator.serviceWorker.getRegistrations().then(rs => Promise.all(rs.map(r => r.unregister())))`.

5. Zerar `pwa_chunk_retry_count` quando o boot completar com sucesso (por exemplo em `src/main.tsx` apos o […]

---

### 22. 🟠 Sync realtime grava banners truncados (perde cores, textos, agendamento) no DataVault

`src/lib/realtimeSyncEngine.ts:77` · **alta** · bug · _Admin: banners, carrosseis/vitrines e editor de imagem_

**Problema.** O mapRecord da tabela 'banners' no RealtimeSyncEngine mapeia apenas 7 dos 22 campos do tipo Banner. Ele descarta subtitle, titleColor, subtitleColor, buttonText, buttonBgColor, buttonTextColor, fontFamily, overlayColor, overlayOpacity, badgeText, templateType, productId, startDate, endDate e showTextOverlay. Esse objeto truncado e gravado no DataVault via vault.put (INSERT/UPDATE individual) e via vault.replaceAll (catchUp, que roda em TODA conexao/reconexao do canal realtime). Em seguida o useBanners le o vault pelo useSyncListener e substitui o estado React inteiro pela versao mutilada.

**Reproduzir.** 1) Admin cria um banner completo com badge, titulo, botao, overlay e data de expiracao. 2) O realtime dispara INSERT/UPDATE (ou o catchUp roda ao reconectar o socket). 3) O registro no IndexedDB passa a ter so id/imageUrl/title/link/position/active/order. 4) O useSyncListener chama setBanners(fresh) e a Home passa a exibir o banner sem badge, sem subtitulo, sem botao e sem overlay; banners ja expirados voltam a aparecer porque endDate virou undefined em getBannersByPosition. 5) Pior: o admin abre esse banner para editar, o formData e montado a partir do objeto truncado (subtitle '', titleColor '', startDate null) e ao salvar o updateBanner grava dbUpdates.subtitle = '', title_color = '', start_date = null no Postgres, apagando os dados de vez.

```
{
    table: "banners",
    store: "banners",
    mapRecord: (raw: any) => ({
      id: raw.id,
      imageUrl: raw.image_url || raw.imagem_url,
      title: raw.title || "",
      link: raw.link || undefined,
      position: raw.position,
      active: raw.active ?? raw.ativo ?? true,
      order: raw.order || 0,
    }),
  },
```

**Correção.**

Criar um mapeador unico e usa-lo em TODOS os pontos que escrevem no store "banners" do DataVault.

1) Em src/lib/mappers.ts, adicionar `export function mapBannerFromDB(b: any): Banner` replicando exatamente o mapeamento que hoje existe em src/hooks/useBanners.ts:176-205 (imageUrl: b.image_url || b.imagem_url; title/subtitle/cores com `|| ""`; overlayOpacity com Number() so quando nao for null/undefined; templateType `|| "default"`; productId `|| undefined`; startDate/endDate `|| null`; showTextOverlay `?? true`; active `?? b.ativo ?? true`).

2) src/lib/realtimeSyncEngine.ts linhas 77-85: trocar o objeto literal por `mapRecord: (raw: any) => mapBannerFromDB(raw)` (mesmo padrao ja usado para produtos na linha 60). Isso corrige de uma vez o INSERT/UPDATE individual (_applyChangeAndNotify -> vault.put), o catchUp (linhas 698-703) e as abas secundarias (linhas 315-318).

3) src/hooks/useDataVault.ts linhas 112-122 (hydrateAllStores) e src/utils/admin_cache.ts linhas 124-134 (prefetchBannersData): substituir os dois mapeamentos de 7 campos por `.map(mapBannerFromDB)`, senao o vault continua nascendo truncado no primeiro boot/prefetch.

4) src/hooks/useBanners.ts:174-205 e o bloco de addBanner (331-357): passar a usar o mesmo mapBannerFromDB, para que fetch, insert, vault e catchUp produzam sempre a mesma forma de registro.

5) Defesa em profundidade (recomendado, nao substitui o item 2): em useBanners.updateBanner (linhas 407-443), so enviar campos de texto/cor quando `updates.X !== undefined` E o valor nao for uma string vazia oriunda de um registro incompleto — ou, mais simples, garantir que o dialog de edicao em AdminBannersView so abra a partir de um banner recem-buscado da rede quando o registro local nao tiver as chaves opcionais (ex.: se `!("subtitle" in banner)`, chamar refreshBanners antes de montar o formData). Isso evita a gravacao destrutiva caso algum outro caminho volte a persistir registro parcial.

---

### 23. 🟠 Duplicar um banner e cancelar apaga do storage a imagem do banner ORIGINAL

`src/views/admin/AdminBannersView.tsx:1243` · **alta** · bug · _Admin: banners, carrosseis/vitrines e editor de imagem_

**Problema.** handleDuplicateBanner copia banner.imageUrl para o formData e zera editingBanner (setEditingBanner(null)). Ao fechar o formulario sem salvar, handleOpenChange compara formData.imageUrl com editingBanner?.imageUrl, que agora e undefined, e portanto sempre entra no ramo de limpeza, chamando deleteStorageFile na URL da imagem do banner original. O erro e engolido com .catch(() => {}), entao nada aparece na UI.

**Reproduzir.** 1) Admin clica em 'Duplicar' num banner que esta ativo na Home. 2) Olha o formulario, desiste e clica em 'Cancelar' (ou aperta Esc, ou usa o botao voltar). 3) handleOpenChange executa deleteStorageFile(formData.imageUrl) sobre a URL do banner ORIGINAL. 4) O arquivo e removido do bucket 'banners'. 5) O banner original continua existindo na tabela apontando para uma URL 404 e a Home passa a exibir um espaco vazio/imagem quebrada, sem nenhuma mensagem de erro. O mesmo vale se a copia for salva: os dois banners compartilham o mesmo arquivo e excluir qualquer um deles quebra o outro.

```
const handleOpenChange = (open: boolean) => {
    if (!open) {
      setProductSearch("");
      setSelectedCouponCode("");
      if (!isSavedRef.current) {
        if (
          formData.imageUrl &&
          formData.imageUrl !== editingBanner?.imageUrl
        ) {
          deleteStorageFile(formData.imageUrl).catch(() => {});
        }
      }
    }
    setIsDialogOpen(open);
  };
```

**Correção.**

Correção em duas camadas.

CAMADA 1 - só apagar do storage o que foi enviado NESTA sessão do formulário (src/views/admin/AdminBannersView.tsx).

a) Criar um ref ao lado de isSavedRef (linha 355):
   const sessionUploadsRef = useRef<Set<string>>(new Set());

b) Alimentar o set logo após cada upload bem-sucedido, nos dois pontos onde já existe `const url = await uploadBannerImage(file);`:
   - handleAdjustConfirm, linha 650
   - handleFileUpload, linha 1394
   Adicionar imediatamente após: sessionUploadsRef.current.add(url);

c) Substituir a condição de limpeza nos TRÊS pontos (linhas 651, 1243-1245 e 1395) por uma checagem baseada no set, em vez da comparação com editingBanner:
   if (formData.imageUrl && sessionUploadsRef.current.has(formData.imageUrl)) {
     deleteStorageFile(formData.imageUrl).catch(() => {});
     sessionUploadsRef.current.delete(formData.imageUrl);
   }
   Isso preserva o comportamento desejado (descartar arquivos órfãos que o admin subiu e abandonou) e elimina o falso positivo, porque a URL herdada por duplicação nunca entra no set.

d) Limpar o set ao abrir o formulário, junto de `isSavedRef.current = false;`, em handleOpenDialog (linha 1100) e em handleDuplicateBanner (linha 1194):
   sessionUploadsRef.current.clear();

e) Em handleSubmit, junto de `isSavedRef.current = true;` (linha 1455), remover do set a URL efetivamente persistida para que ela nunca seja candidata a exclusão:
   sessionUploadsRef.current.delete(formData.imageUrl);

CAMADA 2 - impedir que dois banners compartilhando o mesmo arquivo se quebrem mutuamente (src/hooks/useBanners.ts).

Antes de chamar deleteStorageFileByUrl, verificar se algum outro banner ainda referencia a mesma URL:
   - em deleteBanner, linha 585-587, trocar
       if (imageUrl) { deleteStorageFileByUrl(imageUrl).catch(() => {}); }
     por
       const stillReferenced = banners.some((b) => b.id !== id && b.imageUrl === imageUrl);
       if (imageUrl && !stillReferenced) { deleteStorageFileByUrl(imageUrl).catch(() => {}); }
   - em updateBanner, linha 453-459, aplicar a mesma guarda sobre oldBanner.imageUrl, ignorando o próprio registro (b.id !== id).

Opcional, mas recomendado para eliminar o compartilhamento na origem: em handleDuplicateBanner, copiar o objeto no storage para uma nova chave (supabase.storage.from("banners").copy(chaveOrigem, novaChave)) e usar a URL da cópia no formData, de modo que a duplicata seja independente desde o início. Se isso for feito, a URL copiada DEVE entrar em sessionUploadsRef para continuar sendo limpa caso o admin cancele.

---

### 24. 🟠 Esc dentro do editor de imagem fecha o formulario e apaga a imagem recem-enviada

`src/views/admin/AdminBannersView.tsx:854` · **alta** · bug · _Admin: banners, carrosseis/vitrines e editor de imagem_

**Problema.** O handler global de Escape testa isDialogOpen antes de isAdjusterOpen. Como o ImageAdjuster e aberto de dentro do formulario (isDialogOpen continua true) e e renderizado via createPortal fora do bloco {isDialogOpen && ...}, sem nenhum handler proprio de teclado, o Esc pressionado dentro do editor cai no primeiro ramo e chama handleOpenChange(false).

**Reproduzir.** 1) Admin envia uma imagem nova no formulario (upload gera URL no storage). 2) Clica em 'Ajustar' e entra no ImageAdjuster. 3) Aperta Esc querendo cancelar o recorte. 4) O ramo isDialogOpen vence: o formulario inteiro e fechado e, como isSavedRef.current e false e a URL nova difere da do editingBanner, deleteStorageFile apaga o arquivo recem-enviado. 5) O ImageAdjuster continua aberto em cima (o estado isAdjusterOpen nao mudou) exibindo uma imagem que ja nao existe mais no bucket; se o admin confirmar o recorte, handleCrop tenta rebaixar corsImageUrl e falha com 'Erro ao recortar a imagem'.

```
const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (isDialogOpen) {
          handleOpenChange(false);
        } else if (showHelpModal) {
          setShowHelpModal(false);
        } else if (isAdjusterOpen) {
          setIsAdjusterOpen(false);
        }
      }
    };
```

**Correção.**

Duas correções, a primeira é obrigatória e a segunda é a que fecha o buraco de verdade (porque cobre também o botão voltar).

(A) Inverter a precedência do Escape para respeitar a pilha visual — `src/views/admin/AdminBannersView.tsx`, linhas 851-865:

```ts
useEffect(() => {
  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key !== "Escape") return;
    if (isAdjusterOpen) {
      setIsAdjusterOpen(false);
    } else if (showHelpModal) {
      setShowHelpModal(false);
    } else if (bannerToDelete) {
      setBannerToDelete(null);
    } else if (isDialogOpen) {
      handleOpenChange(false);
    }
  };
  window.addEventListener("keydown", handleKeyDown);
  return () => window.removeEventListener("keydown", handleKeyDown);
}, [isDialogOpen, showHelpModal, isAdjusterOpen, bannerToDelete]);
```
(O ramo `bannerToDelete` é defensivo: o `AlertDialog` da linha 5356 é Radix e já trata Esc sozinho, mas sem ele o ramo `isDialogOpen` poderia disparar junto.)

(B) Blindar o próprio `handleOpenChange` (linhas 1237-1251), que é o ponto por onde passam TANTO o Esc quanto o back override da linha 888. Sem isso, o gesto de voltar em mobile continua apagando o arquivo:

```ts
const handleOpenChange = (open: boolean) => {
  if (!open) {
    // Se o editor de imagem está por cima, "fechar" deve fechar só ele.
    if (isAdjusterOpen) {
      setIsAdjusterOpen(false);
      setAdjustingImgUrl("");
      return;
    }
    setProductSearch("");
    setSelectedCouponCode("");
    if (!isSavedRef.current) {
      if (formData.imageUrl && formData.imageUrl !== editingBanner?.imageUrl) {
        deleteStorageFile(formData.imageUrl).catch(() => {});
      }
    }
  }
  setIsDialogOpen(open);
};
```

Observação sobre a sugestão original de "mover o listener para dentro do ImageAdjuster com stopPropagation": isso NÃO funcionaria sozinho. Os dois listeners ficariam registrados no mesmo alvo (`window`, fase de bubbling), e `stopPropagation` não impede outros listeners do mesmo alvo — seria preciso `stopImmediatePropagation` e ainda dependeria da ordem de registro. Se quiser mesmo dar autonomia de teclado ao ImageAdjuster, registre em fase de captura no `document` ao lado do efeito de `body.style.overflow` (ImageAdjuster.tsx linha 1041):

```ts
useEffect(() => {
  if (!isOpen) return;
  const onKey = (e: KeyboardEvent) => {
    if (e.key === "Escape") {
      e.stopPropagation();
      if (!isSubmitting) onClose();
    }
  };
  document.addEventListener("keydown", onKey, true);
  return () => document.removeEventListener("keydown", onKey, true);
}, [isOpen, isSubmitting, […]

---

### 25. 🟠 Desativar promoção não remove o preço "De:" no banco (campos undefined são ignorados no update)

`src/views/admin/AdminProductFormView.tsx:1069` · **alta** · bug · _Admin: cadastro/edicao de produtos e listagem_

**Problema.** Quando o admin desmarca "Produto em Promoção", o formulário monta `originalPrice: undefined`. No `updateProduct` do hook, todo campo é aplicado apenas com a guarda `if (updates.X !== undefined)`, então `preco_original` simplesmente não entra no UPDATE e permanece no banco. A promoção continua ativa para o cliente. Ao reabrir o formulário, `setIsPromoActive(!!product.originalPrice)` volta a marcar a promoção, dando a impressão de que a desativação "não foi salva". O mesmo padrão impede limpar o SKU (`sku: sanitizedSku || undefined`), o preço de custo e, quando a loja está em modo `shippingCoverage === "local"`, as dimensões/peso já cadastrados.

**Reproduzir.** 1) Produto com preco_original = 199,90 e preco_venda = 149,90. 2) Admin abre o produto, desmarca "Produto em Promoção" e clica em Salvar. 3) Toast diz "Produto atualizado!". 4) Na vitrine do cliente o preço riscado R$ 199,90 e a etiqueta "25% OFF" continuam aparecendo. 5) Reabrindo o formulário, o checkbox de promoção volta marcado com o valor antigo.

```
originalPrice:
        isPromoActive && pOriginal !== undefined
          ? Math.max(0, pOriginal)
          : undefined,
```

**Correção.**

Trocar `undefined` por `null` nos campos que o usuário pode limpar. `Product.originalPrice` já é `number | null` (src/types/index.ts:9) e `useProducts.updateProduct` já trata `null` corretamente (`!== undefined` passa e grava `preco_original = null`), então a mudança principal é de UMA linha.

1) src/views/admin/AdminProductFormView.tsx:1069-1072 — trocar o fallback:
      originalPrice:
        isPromoActive && pOriginal !== undefined
          ? Math.max(0, pOriginal)
          : null,

2) src/views/admin/AdminProductFormView.tsx:1081 — permitir limpar o SKU:
      sku: sanitizedSku ?? null,
   e alargar o tipo em src/types/index.ts:26 para `sku?: string | null;`. useProducts.ts:658 (`dbUpdates.codigo = updates.sku || null`) já converte corretamente.

3) src/views/admin/AdminProductFormView.tsx:1068 — permitir limpar o custo:
      costPrice: pCost !== undefined ? Math.max(0, pCost) : null,
   e alargar src/types/index.ts:8 para `costPrice?: number | null;`. useProducts.ts:637 grava direto, e TruthGate já protege contra `null` (truth_gate.ts:51-52 e 58-59).

4) Verificar addProduct em src/hooks/useProducts.ts:489 (`preco_original: productData.originalPrice`) — passar `null` na criação é aceito pela coluna (`preco_original: number | null`, database.types.ts:765); nenhum ajuste necessário, apenas confirmar que `costPrice`/`sku` também aceitam `null` no INSERT.

5) Corrigir também o caminho offline: em useProducts.ts a fila é gravada com `JSON.stringify` (linhas 604-607), que descarta chaves `undefined`. Usando `null` o valor sobrevive à serialização e `syncOfflineUpdates` (linhas 86-87) passa a aplicar a limpeza ao reconectar. Sem isso, desativar promoção offline continuaria silenciosamente sem efeito.

NÃO alterar as linhas 1084-1103 (peso/dimensões com `isLocalShipping`): ali o `undefined` é proposital e correto, pois evita apagar dimensões já cadastradas quando a loja está temporariamente em modo de entrega local.

---

### 26. 🟠 Validade do cupom gravada como meia-noite UTC: expira ~21h do dia anterior e a listagem mostra um dia a menos

`src/views/admin/AdminCouponFormView.tsx:468` · **alta** · bug · _Admin: dashboard, analytics, clientes e cupons_

**Problema.** O input type="date" devolve 'AAAA-MM-DD'; `new Date("2026-08-15")` é interpretado pelo JS como 2026-08-15T00:00:00Z (UTC), e o toISOString() grava exatamente esse instante. No banco, validate_coupon_secure_v2 compara `v_coupon.valid_until < NOW()` com NOW() em UTC (nenhuma migration define timezone; o padrão do Supabase é UTC). Resultado: um cupom "válido até 15/08" para de funcionar às 21:00 de 14/08 no horário de Brasília. Pior, a própria listagem renderiza `new Date(coupon.validUntil).toLocaleDateString("pt-BR")`, que converte de volta para o fuso local e imprime 14/08 — ou seja, o formulário mostra 15/08 e o card mostra 14/08 para o mesmo cupom.

**Reproduzir.** 1) Admin cria o cupom BLACK20 e escolhe Validade = 15/08/2026. 2) Salva; o banco grava valid_until = '2026-08-15T00:00:00.000Z'. 3) Volta para a lista de Cupons: o card exibe 'Expira em: 14/08/2026'. 4) Um cliente tenta aplicar BLACK20 às 22h de 14/08 (horário de Brasília) e recebe 'Este cupom expirou', apesar de o admin ter configurado validade até o dia 15. 5) Se o admin reabrir o formulário, o campo volta a mostrar 15/08, reforçando a confusão.

```
onChange={(e) => {
                    if (!e.target.value) {
                      setFormData({ ...formData, validUntil: undefined });
                      return;
                    }
                    const d = new Date(e.target.value);
                    if (!Number.isNaN(d.getTime())) {
                      setFormData({
                        ...formData,
                        validUntil: d.toISOString(),
                      });
                    }
                  }}
```

**Correção.**

A correção precisa tocar DOIS pontos do mesmo arquivo — corrigir só o `onChange` quebra o `value` e o input passaria a mostrar o dia seguinte.

1) `src/views/admin/AdminCouponFormView.tsx`, `onChange` (linhas 459-471): parar de usar `new Date('AAAA-MM-DD')` e montar o fim do dia no fuso local a partir dos componentes:

onChange={(e) => {
  const raw = e.target.value; // "AAAA-MM-DD"
  if (!raw) {
    setFormData((prev) => ({ ...prev, validUntil: undefined }));
    return;
  }
  const [y, m, day] = raw.split("-").map(Number);
  if (!y || !m || !day) return;
  const end = new Date(y, m - 1, day, 23, 59, 59, 999); // fim do dia no fuso local
  if (Number.isNaN(end.getTime())) return;
  setFormData((prev) => ({ ...prev, validUntil: end.toISOString() }));
}}

(De quebra, usar a forma funcional do `setFormData` alinha com o resto do arquivo — linhas 397 e 423 já usam `(prev) => ...` — e evita sobrescrever edições concorrentes de outros campos.)

2) `src/views/admin/AdminCouponFormView.tsx`, `value` (linhas 451-457): trocar `toISOString()` por formatação a partir dos componentes LOCAIS (atenção: aqui o auditor original errou ao propor formatar "em UTC" — com o item 1 gravando fim de dia local, o instante armazenado cai no dia seguinte em UTC e o UTC voltaria a mostrar a data errada):

value={(() => {
  if (!formData.validUntil) return "";
  const d = new Date(formData.validUntil);
  if (Number.isNaN(d.getTime())) return "";
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
})()}

3) `src/views/admin/AdminCouponsView.tsx:613-615` NÃO precisa mudar: `new Date(coupon.validUntil).toLocaleDateString("pt-BR")` já usa o fuso local e passará a imprimir 15/08 assim que 1+2 estiverem no lugar. Mas os cupons já gravados com o código antigo continuarão um dia atrasados — vale um backfill único, e ele deve ser escrito conforme o tipo real da coluna (confirmar antes com `select data_type from information_schema.columns where table_name='coupons' and column_name='valid_until'`). Se for `timestamptz`: `UPDATE public.coupons SET valid_until = (valid_until AT TIME ZONE 'UTC')::date + time '23:59:59' AT TIME ZONE 'America/Sao_Paulo' WHERE valid_until IS NOT NULL;`

4) Secundário, no `handleSubmit` (linhas 87-151, que hoje valida código, valor, minPurchase e usageLimit mas ignora a data): adicionar `min={/* hoje em AAAA-MM-DD local */}` ao Input e, no submit, bloquear apenas a criação com data passada — na edição de um cupom antigo a data no passado é legítima, então ali cabe no máximo um aviso, não um […]

---

### 27. 🟠 Desativar frete gratis no admin (limite = 0) quebra TODOS os checkouts com 'Divergencia de valores'

`supabase/migrations/20260526000000_coupon_percentage_fixes.sql:150` · **alta** · bug · _Frete, CEP e enderecos_

**Problema.** O RPC create_marketplace_order_v22 usa `COALESCE(v_store_config.free_shipping_min, 999999)`, que so protege contra NULL. Quando o admin desliga o switch 'Frete Gratis' (AdminShippingView.tsx:427 grava `freeShippingMin: 0`), o banco passa a avaliar `subtotal >= 0`, que e sempre verdadeiro, e zera o frete de qualquer pedido. O frontend faz o oposto: CartContext exige `config.freeShippingMin > 0` para zerar, entao continua cobrando `config.shippingFee`. Os dois totais divergem e a checagem anti-adulteracao (`ABS(v_calculated_total - p_total_amount) > 0.05`) aborta o pedido.

**Reproduzir.** Admin abre Logistica & Frete, desliga o switch 'Frete Gratis' (freeShippingMin vira 0) e mantem 'Taxa Padrao de Entrega' em R$ 15. Qualquer cliente (logado ou convidado) com carrinho de R$ 80 ve Subtotal 80 + Frete 15 = Total 95 e clica em 'Finalizar Pedido'. O banco calcula shipping 0 e total 80, a diferenca de 15 estoura o limite de 0,05 e o RPC lanca excecao. O cliente recebe o toast 'Falha no Pedido: Divergencia de valores detectada. Calculado: 80, Fornecido: 95' e nenhum pedido consegue ser criado ate o admin religar o frete gratis.

```
IF v_has_free_shipping_item = true OR v_calculated_subtotal >= COALESCE(v_store_config.free_shipping_min, 999999) THEN
        v_shipping_validated := 0;
    ELSE
        v_shipping_validated := COALESCE(v_store_config.shipping_fee, 0);
    END IF;
```

**Correção.**

Duas correcoes, ambas necessarias para alinhar front e banco:

1) BANCO (obrigatorio) — tratar 0 como "regra desativada". Nao editar 20260526000000_coupon_percentage_fixes.sql (ja aplicada); criar uma NOVA migration (ex.: supabase/migrations/20260730000000_fix_free_shipping_zero.sql) que faz CREATE OR REPLACE FUNCTION public.create_marketplace_order_v22 com o corpo identico ao atual, trocando apenas o bloco da linha 150 por:

    IF v_has_free_shipping_item = true
       OR (COALESCE(v_store_config.free_shipping_min, 0) > 0
           AND v_calculated_subtotal >= v_store_config.free_shipping_min) THEN
        v_shipping_validated := 0;
    ELSE
        v_shipping_validated := COALESCE(v_store_config.shipping_fee, 0);
    END IF;

Repetir os GRANTs ao final (GRANT EXECUTE ... TO anon, authenticated, service_role), como em 20260526000000:258-259, porque CREATE OR REPLACE preserva os grants mas um DROP/CREATE nao.

2) FRONTEND (obrigatorio para o caminho de convidado) — remover a condicao "&& user" de src/contexts/CartContext.tsx:729-734, deixando a regra igual a do banco e a de StoreContext.calculateShipping (linha 597, que ja nao exige user):

    if (config.freeShippingMin > 0 && cartTotal >= config.freeShippingMin) return 0;

Se a intencao de negocio for mesmo restringir frete gratis a usuarios logados, entao a regra tem de ser replicada no RPC (o RPC ja sabe se e convidado: v_user_id := auth.uid() na linha 76), e nao apenas no cliente.

3) Endurecimento opcional (defesa em profundidade), em upsert_store_config (20260712230000_add_local_shipping_config.sql:82): normalizar 0 para NULL, gravando NULLIF((config_json->>'free_shipping_min')::numeric, 0) — assim "desativado" fica representado por NULL e o COALESCE(..., 999999) original volta a funcionar como pretendido. Aplicar somente junto com o item 1, nunca no lugar dele.

---

### 28. 🟠 Convidado com carrinho acima do limite de frete gratis nao consegue finalizar o pedido

`src/contexts/CartContext.tsx:729` · **alta** · bug · _Frete, CEP e enderecos_

**Problema.** O calculo de frete do frontend condiciona o frete gratis por valor a estar logado (`&& user`), mas o RPC create_marketplace_order_v22 zera o frete apenas com base no subtotal, sem olhar user_id (o checkout de convidado e explicitamente suportado: 'Auth Check (REMOVED for Guest Checkout)'). Para convidados acima do limite os dois lados divergem exatamente no valor da taxa fixa, e o guard `ABS(v_calculated_total - p_total_amount) > 0.05` derruba o pedido. O mesmo desalinhamento existe em StoreContext.calculateShipping (linha 597), que nao exige user, tornando as tres regras de frete do projeto inconsistentes entre si.

**Reproduzir.** Loja com freeShippingMin = 100 e shippingFee = 15. Visitante nao logado monta carrinho de R$ 150, escolhe 'Continuar como Convidado', preenche nome/WhatsApp/endereco e clica em 'Finalizar Pedido'. A barra inferior mostra Total R$ 165 (frete cobrado porque `user` e null); o banco calcula 150 + 0 de frete = 150 e lanca 'Divergencia de valores detectada'. Todo convidado com carrinho acima do limite fica travado; abaixo do limite funciona normalmente, o que torna o bug intermitente e dificil de perceber.

```
if (
      config.freeShippingMin > 0 &&
      cartTotal >= config.freeShippingMin &&
      user
    )
      return 0;
```

**Correção.**

Escolher um dos dois lados e alinhar; hoje o frontend e o SQL divergem por design nao sincronizado.

Opcao A (recomendada — manter a intencao de negocio de "frete gratis so para logado"): criar nova migration que redefine `public.create_marketplace_order_v22` alterando o bloco de calculo de frete que hoje esta em supabase/migrations/20260526000000_coupon_percentage_fixes.sql:150 de
`IF v_has_free_shipping_item = true OR v_calculated_subtotal >= COALESCE(v_store_config.free_shipping_min, 999999) THEN`
para
`IF v_has_free_shipping_item = true OR (v_user_id IS NOT NULL AND v_calculated_subtotal >= COALESCE(v_store_config.free_shipping_min, 999999)) THEN`
Nao editar a migration antiga (ja aplicada) — publicar um novo arquivo em supabase/migrations/ com o CREATE OR REPLACE completo.

Opcao B (se a regra deve valer para todos): remover `&& user` de src/contexts/CartContext.tsx:729-733, deixando
`if (config.freeShippingMin > 0 && cartTotal >= config.freeShippingMin) return 0;`
e retirar `user` do array de dependencias (linha 747). Nesse caso ajustar tambem src/views/customer/CartView.tsx:253 (`const isRuleActive = (config.freeShippingMin || 0) > 0 && !!user;` -> sem o `&& !!user`) e o texto de CartView.tsx:434-438 que promete o frete gratis apenas apos login, senao a barra de progresso continua escondida para quem ja tem direito ao beneficio.

Em qualquer das opcoes, extrair a regra para uma unica funcao pura (ex.: `src/lib/shipping.ts` com `computeShippingFee({ cart, subtotal, config, isAuthenticated, selectedOption })`) e consumi-la em CartContext.shippingFee e em StoreContext.calculateShipping (hoje codigo morto — ou remover a segunda), mantendo o SQL como espelho documentado dessa funcao.

Complemento util: hoje `p_shipping_cost` chega na RPC e e ignorado, e a unica sinalizacao de divergencia e a excecao generica. Vale (i) comparar `p_shipping_cost` com `v_shipping_validated` e levantar mensagem especifica de frete, ou (ii) tratar o erro em src/views/customer/CheckoutView.tsx:455-464 detectando a string 'Divergência de valores' para forcar um refresh da store_config e do carrinho antes de reexibir o total, em vez de mostrar o texto cru do Postgres ao cliente.

---

### 29. 🟠 Toda a configuracao de frete por CEP e inutil: nenhum componente chama o calculo de frete

`src/contexts/CartContext.tsx:736` · **alta** · malfuncionamento · _Frete, CEP e enderecos_

**Problema.** `ShippingCalculator` e o unico componente do app que invoca a edge function calculate-shipping e o unico que chamaria `onSelectOption`, mas ele nao e importado/renderizado em lugar nenhum (busca por 'ShippingCalculator' em todo o repo retorna apenas a propria definicao). Consequentemente `setSelectedShippingOption` nunca e chamado e `selectedShippingOption` e sempre null, entao o frete cobrado e sempre `config.shippingFee`. Tudo o que o admin configura em Logistica & Frete — provedor Melhor Envio/Frenet, tokens, servicos habilitados, CEP de origem, abrangencia 'Apenas Local', taxa local e faixa de CEPs locais — nao influencia um centavo do valor cobrado. Em CheckoutView, `shippingNotes` (linha 403) tambem e sempre undefined, entao o pedido nunca registra o servico de entrega escolhido.

**Reproduzir.** Admin configura provider 'melhor_envio', valida o token com sucesso, habilita SEDEX/PAC e define taxa local R$ 5 para a faixa de CEP da cidade. Cliente de outro estado adiciona itens e vai ao carrinho/checkout: nao existe campo de CEP para cotar frete, e o resumo mostra sempre a 'Taxa Padrao de Entrega' fixa. Um cliente da mesma cidade paga a mesma taxa nacional em vez da taxa local configurada.

```
if (selectedShippingOption) {
      return selectedShippingOption.price;
    }

    return config.shippingFee;
```

**Correção.**

Correção em duas camadas — a de frontend sozinha QUEBRA o checkout, então as duas precisam ir juntas.

1) Frontend — montar o calculador. Em `src/views/customer/CartView.tsx` (ideal: acima do bloco de resumo, junto de onde `ctxShippingFee` já é consumido na linha 260), importar `ShippingCalculator` de `@/components/ui/custom/ShippingCalculator` e renderizar com as props que a interface já declara (`ShippingCalculator.tsx:10-17`):
```
<ShippingCalculator
  cart={cart}
  subtotal={subtotal}
  freeShippingMin={config.freeShippingMin}
  selectedOption={selectedShippingOption}
  onSelectOption={setSelectedShippingOption}
/>
```
`selectedShippingOption` vem de `useCartState()` e `setSelectedShippingOption` de `useCartActions()` (ambos já expostos em `CartContext.tsx:768` e `:788`). Bônus já implementado no componente: ele grava `ikcous_last_shipping_cep` no localStorage (linhas 80 e 109), que `CheckoutView.tsx:181` e `:198` já leem como default do formulário de endereço — o CEP flui sozinho para o checkout.

2) Backend — sem isso o pedido falha. `create_marketplace_order_v22` hoje descarta `p_shipping_cost` e recalcula o flat fee (`v_shipping_validated := COALESCE(v_store_config.shipping_fee, 0)`, linha 153 de `20260526000000_coupon_percentage_fixes.sql`), disparando `RAISE EXCEPTION 'Divergência de valores detectada'` (linha 187) para qualquer frete de transportadora. Criar nova migration que:
   - adiciona um parâmetro de CEP de destino (ex.: `p_dest_cep text`) ao RPC;
   - replica no SQL a mesma regra da edge function: se `shipping_coverage = 'local'`, aplicar `local_delivery_fee` quando o CEP cair em `local_cep_range` (porte do `isLocalCep` de `supabase/functions/calculate-shipping/index.ts:48-60`), senão manter `shipping_fee`;
   - para provedores externos (`melhor_envio`/`frenet`), NÃO confiar em `p_shipping_cost` cru: persistir a cotação retornada pela edge function numa tabela (ex.: `shipping_quotes` com `id`, `cep`, `hash do carrinho`, `price`, `expires_at`) e passar ao RPC apenas o `quote_id`, que o RPC valida e usa como `v_shipping_validated`;
   - manter o checksum `ABS(v_calculated_total - p_total_amount) > 0.05` calculado sobre esse frete validado.

3) Ajuste de coerência a fazer no mesmo passe: `CartContext.tsx:729-734` só zera o frete grátis se `user` for verdadeiro (`&& user`), enquanto o RPC (linha 150) zera para qualquer pedido que atinja `free_shipping_min`. Com frete cotado no jogo essa divergência passa a produzir "Divergência de valores" para convidados que atingem o mínimo — alinhar as duas regras junto da correção.

4) Se a decisão […]

---

### 30. 🟠 Faixa de CEPs locais nunca casa no formato ensinado pelo proprio placeholder do admin

`supabase/functions/calculate-shipping/index.ts:58` · **alta** · bug · _Frete, CEP e enderecos_

**Problema.** Em `isLocalCep`, a virgula separa entradas e o hifen separa inicio/fim da faixa. Mas o placeholder do admin sugere 'Ex: 38500-000, 38500-999', que e interpretado como DUAS entradas com hifen: '38500-000' vira start=38500/end=0 (o `replace(/\D/g,'')` transforma '000' em '000' -> Number 0) e '38500-999' vira start=38500/end=999. Nenhum CEP de 8 digitos (>= 10000000) cabe nesses intervalos, entao a funcao sempre retorna false. E como `localCepRange` nao esta vazio, o fallback de comparar os 5 primeiros digitos nem chega a rodar.

**Reproduzir.** Admin define abrangencia 'Apenas Local', taxa local R$ 5 e preenche 'Faixa de CEPs Locais' exatamente como o placeholder sugere: '38500-000, 38500-999'. Cliente do CEP 38500-123 (mesma cidade da loja) pede cotacao -> isLocalCep retorna false -> a funcao responde 400 com 'Esta loja realiza apenas entregas locais na sua regiao' e o cliente da propria cidade e barrado. Com abrangencia nacional, o mesmo cliente deixa de receber a opcao 'Entrega Local' e paga a tarifa nacional.

```
if (r.includes('-')) {
                const parts = r.split('-').map(p => p.replace(/\D/g, '')).filter(Boolean)
                if (parts.length === 2) {
                    const start = Number(parts[0])
                    const end = Number(parts[1])
                    const destVal = Number(cleanDest)
```

**Correção.**

Atencao: nao basta endurecer o parser. Como a virgula significa OR (linha 55), a string '38500-000, 38500-999' NUNCA pode significar uma faixa — sao duas entradas independentes. Logo o placeholder precisa mudar obrigatoriamente. Correcao em quatro frentes:

1. Corrigir o placeholder (causa raiz da inducao ao erro) — src/views/admin/AdminShippingView.tsx:876:
   trocar `placeholder="Ex: 38500-000, 38500-999"` por algo que o parser realmente suporte, ex.: `placeholder="Ex: 38500, 38510 ou 38500000-38505000"`, e adicionar um texto de ajuda abaixo do input explicando as duas sintaxes aceitas: (a) prefixos separados por virgula; (b) faixa completa com inicio e fim de 8 digitos separados por hifen.

2. Tornar o parser tolerante a mascara — supabase/functions/calculate-shipping/index.ts, substituir o corpo do laco das linhas 56-73 por uma normalizacao que decide o ramo DEPOIS de limpar, e nao pela mera presenca de '-':
   `for (const r of ranges) {
        const digits = r.replace(/\D/g, '')
        if (!digits) continue
        if (digits.length === 16) {                      // faixa: dois CEPs de 8 digitos
            const start = Number(digits.slice(0, 8))
            const end = Number(digits.slice(8, 16))
            const destVal = Number(cleanDest)
            if (destVal >= Math.min(start, end) && destVal <= Math.max(start, end)) return true
        } else if (digits.length <= 8) {                 // prefixo (ou CEP exato de 8 digitos)
            if (cleanDest.startsWith(digits)) return true
        }
    }`
   Isso elimina o caso absurdo start=38500/end=0, aceita '38500000-38505000' e tambem a versao mascarada '38500-000 - 38505-000' (16 digitos apos limpeza), e o `Math.min/Math.max` protege contra inversao de inicio/fim.

3. Rede de seguranca em vez de falha silenciosa — index.ts:74: hoje um valor malformado mata a entrega local sem aviso. Trocar o `return false` por um fallback explicito quando NENHUMA entrada foi parseavel (contar entradas validas; se zero, cair no `cleanOrigin.slice(0,5) === cleanDest.slice(0,5)` da linha 78) e logar `console.warn` com o valor recebido, para o problema aparecer nos logs da funcao.

4. Validar no salvamento — src/views/admin/AdminShippingView.tsx, dentro de handleSave antes da linha 301: normalizar/validar cada entrada de `formData.localCepRange` (apos `replace(/\D/g,'')` cada item deve ter 5..8 ou exatamente 16 digitos); se alguma nao casar, abortar com `toast.error` explicando o formato aceito, em vez de gravar lixo em `local_cep_range`.

5. Cobertura de teste — […]

---

### 31. 🟠 Editar uma resposta de pergunta cria uma segunda resposta duplicada em vez de atualizar

`src/views/admin/AdminQAView.tsx:216` · **alta** · bug · _Avaliacoes, perguntas, favoritos, perfil e notificacoes_

**Problema.** O modal do AdminQAView pré-preenche o textarea com a resposta já existente (`selectedQuestion.answers[0].answer`) e guarda esse valor em `initialAnswerRef` para calcular estado "dirty" e avisar sobre "alterações não salvas" — ou seja, a UI se comporta como um editor. Só que o envio chama `addAnswer`, que executa a RPC `answer_question_atomic`, e essa função sempre faz `INSERT INTO answers (question_id, user_id, answer)`. Não existe caminho de UPDATE. Toda "edição" gera uma nova linha em `answers`, e tanto o ProductQA quanto o UserProfileView renderizam `q.answers.map(...)`, mostrando as duas respostas empilhadas para o cliente.

**Reproduzir.** Admin responde uma dúvida -> percebe um erro de digitação -> reabre a mesma pergunta em Perguntas & Respostas (o texto antigo já vem preenchido), corrige e clica em enviar -> toast "Resposta enviada com sucesso!" -> o cliente abre a página do produto e vê duas bolhas "Resposta da Equipe": a errada e a corrigida, uma embaixo da outra. Não há UI de exclusão de resposta, então a duplicata fica permanente.

```
const isAnswered =
        selectedQuestion.answers && selectedQuestion.answers.length > 0;
      const val = isAnswered ? selectedQuestion.answers[0].answer : "";
      setAnswer(val);
      initialAnswerRef.current = val;
```

**Correção.**

Correção no banco (fonte real do bug), em nova migração que recria a sobrecarga de 2 argumentos usada pelo app — sem `updated_at`, que não existe na tabela, e sem filtrar por admin:

```sql
CREATE OR REPLACE FUNCTION public.answer_question_atomic(p_question_id uuid, p_answer text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
    v_user_id uuid; v_product_name text; v_product_id uuid;
    v_admin_id uuid; v_existing_id uuid;
BEGIN
    v_admin_id := auth.uid();
    IF NOT EXISTS (SELECT 1 FROM profiles WHERE id = v_admin_id AND role = 'admin') THEN
        RAISE EXCEPTION 'Unauthorized: Only admins can answer questions.';
    END IF;

    SELECT id INTO v_existing_id
    FROM answers WHERE question_id = p_question_id
    ORDER BY created_at ASC LIMIT 1;

    IF v_existing_id IS NOT NULL THEN
        -- Edicao: atualiza a resposta existente e NAO re-notifica o cliente
        UPDATE answers SET answer = p_answer, user_id = v_admin_id WHERE id = v_existing_id;
        RETURN;
    END IF;

    INSERT INTO answers (question_id, user_id, answer)
    VALUES (p_question_id, v_admin_id, p_answer);

    SELECT user_id, product_id INTO v_user_id, v_product_id FROM questions WHERE id = p_question_id;
    IF v_product_id IS NOT NULL THEN
        SELECT nome INTO v_product_name FROM produtos WHERE id = v_product_id;
        INSERT INTO push_notifications_log (title, body, url, recipient_count, created_by)
        VALUES ('Sua pergunta foi respondida!',
                'A loja respondeu à sua pergunta sobre o produto ' || COALESCE(v_product_name, 'selecionado') || '.',
                '/product/' || v_product_id, 1, v_admin_id);
    END IF;
END;
$function$;
```
Aplicar a mesma lógica (ou fazer DROP) na sobrecarga `answer_question_atomic(uuid, text, uuid)` da mesma migração, que hoje também só insere.

Reforço opcional no schema, se a regra for de fato "uma resposta por pergunta": `CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS answers_question_id_key ON public.answers (question_id);` — mas antes é preciso deduplicar as linhas já criadas por esse bug, e note que `ProductQA.tsx:269` e `UserProfileView.tsx:549` renderizam listas, então o índice fecha a porta para múltiplas respostas no futuro.

Correção complementar no front (`src/views/admin/AdminQAView.tsx`), independente do banco:
- Linhas 909-918 (lista detalhada): o `setAnswer(ans.answer)` do botão "Editar" é imediatamente sobrescrito pelo efeito das linhas 212-223, que força `answers[0].answer`. Guardar o id da resposta em edição num state (`editingAnswerId`) e […]

---

### 32. 🟠 OTP de rastreio de convidado nunca envia e-mail: chave service_role foi apagada do app_settings

`supabase/migrations/20260708190000_secure_otp_flow.sql:78` · **alta** · malfuncionamento · _Supabase: RLS, RPCs, migrations e edge functions_

**Problema.** O trigger handle_new_otp_verification busca a chave de autorizacao em public.app_settings com key='supabase_service_role_key'. Porem a migration 20260630140000_enable_ninja_migrations_rls_and_cleanup.sql (aplicada 8 dias ANTES) executa 'DELETE FROM public.app_settings WHERE key = ''supabase_service_role_key'';' e nenhuma migration posterior reinsere a linha. Com v_apikey NULL o codigo cai no fallback que le o header 'apikey' da requisicao, que para um visitante anonimo e a chave ANON. A edge function send-otp-email (index.ts linha 31) so aceita 'Bearer ${SUPABASE_SERVICE_ROLE_KEY}' e devolve 401. Como net.http_post e fire-and-forget e o retorno e ignorado, o erro some.

**Reproduzir.** 1) Visitante abre o rastreio de pedidos (OrderSearch.tsx), informa e-mail + WhatsApp + fragmento do pedido. 2) generate_order_otp_v1 valida, insere em otp_verifications e retorna TRUE. 3) OrderSearch.tsx:81 mostra 'Codigo de verificacao enviado para seu e-mail!' e avanca para a tela de digitar o codigo. 4) O trigger chama send-otp-email com a chave anon, recebe 401 e ninguem registra nada. 5) O e-mail nunca chega. O convidado fica preso na tela de OTP sem nenhuma mensagem de erro e o rastreio de pedidos de convidado esta 100% quebrado em producao.

```
-- 1. Try to get service_role API key from app_settings first
  SELECT value INTO v_apikey FROM public.app_settings WHERE key = 'supabase_service_role_key';
  
  -- 2. Fallback to headers if settings placeholder is present or missing
  IF v_apikey IS NULL OR v_apikey = 'YOUR_SERVICE_ROLE_KEY_HERE' THEN
    BEGIN
      v_apikey := (current_setting('request.headers', true)::jsonb)->>'apikey';
```

**Correção.**

Correcao em tres camadas, aplicavel ao codigo que li.

1) PARAR DE DEPENDER DE `app_settings` (causa raiz). Duas opcoes, ambas sem guardar a service_role key numa tabela publica:
   a) Preferida — trocar a autenticacao da edge function por um segredo dedicado. Criar um secret proprio (ex.: `OTP_TRIGGER_SECRET`) nas Function Secrets do Supabase, guardar o mesmo valor no Supabase Vault e ler no trigger com `SELECT decrypted_secret INTO v_secret FROM vault.decrypted_secrets WHERE name = 'otp_trigger_secret';`, enviando-o num header proprio (`x-otp-trigger-secret`). Em `supabase/functions/send-otp-email/index.ts:29-37`, substituir a comparacao `authHeader !== \`Bearer ${serviceRoleKey}\`` por comparacao com `Deno.env.get('OTP_TRIGGER_SECRET')` lendo esse header.
   b) Alternativa — apagar o trigger `on_otp_created_send_email` e configurar um Database Webhook do Supabase em `otp_verifications` (INSERT), que ja injeta a autorizacao correta e nao exige segredo no banco. O payload que a edge function espera (`{ type, table, record }`, lido em `index.ts:43-54`) ja e exatamente o formato de webhook, entao o codigo da function nao muda.

2) REMOVER O FALLBACK QUE MASCARA A FALHA. Nas linhas 80-87 de `20260708190000_secure_otp_flow.sql`, o fallback para `(current_setting('request.headers', true)::jsonb)->>'apikey'` so pode produzir a chave anon num fluxo de visitante — nunca a service_role. Ele deve ser eliminado e substituido por `RAISE EXCEPTION 'OTP dispatch secret nao configurado'` quando o segredo estiver ausente, para o erro aparecer em vez de virar 401 invisivel.

3) FECHAR O CIRCUITO PARA A UI PARAR DE MENTIR. Trocar o `PERFORM net.http_post(...)` (linha 90) por captura do id: `SELECT net.http_post(...) INTO v_request_id;` e gravar `v_request_id` numa tabela `public.otp_dispatch_log (request_id bigint, otp_id, created_at, checked_at, status_code)`. Uma rotina periodica (pg_cron) le `net._http_response` por `request_id` e grava o `status_code`; qualquer status diferente de 2xx vira alerta. Como `net.http_post` e assincrono, `generate_order_otp_v1` nao consegue saber o resultado a tempo — entao, em `src/components/ui/custom/OrderSearch.tsx:82`, trocar o texto categorico "Codigo de verificacao enviado para seu e-mail!" por algo que nao afirme entrega (ex.: "Se os dados conferirem, o codigo chegara em instantes") e adicionar na tela de verificacao um botao "Nao recebi / reenviar codigo".

4) VERIFICAR O PG_NET ANTES DE QUALQUER DEPLOY. Rodar `SELECT extnamespace::regnamespace FROM pg_extension WHERE extname = 'pg_net';`. Se o resultado nao for `net`, a chamada […]

---

### 33. 🟠 create_marketplace_order_v22 ignora p_shipping_cost e derruba o checkout com 'Divergencia de valores'

`supabase/migrations/20260526000000_coupon_percentage_fixes.sql:150` · **alta** · bug · _Supabase: RLS, RPCs, migrations e edge functions_

**Problema.** O RPC recebe p_shipping_cost mas nunca usa: recalcula o frete apenas com store_config.shipping_fee/free_shipping_min e depois compara o total com p_total_amount tolerando 5 centavos. O frontend, porem, usa selectedShippingOption.price (cotacao real da edge function calculate-shipping: Melhor Envio, Frenet, Entrega Local, contingencia) e so aplica frete gratis quando 'user' existe (src/contexts/CartContext.tsx:729-733). Qualquer cenario em que o frete do front difere de store_config.shipping_fee quebra o pedido.

**Reproduzir.** Cenario A (loja com transportadora): shipping_provider='melhor_envio', shipping_fee=15. O cliente calcula o frete, escolhe 'PAC (Melhor Envio)' por R$ 27,40. O front envia p_total_amount = subtotal + 27,40; o RPC calcula subtotal + 15,00; ABS(diferenca)=12,40 > 0,05 -> RAISE 'Divergencia de valores detectada'. Nenhum pedido pode ser fechado.
Cenario B (convidado): free_shipping_min=350, carrinho de R$ 400 sem login. O front nao zera o frete (exige 'user') e envia subtotal+15; o RPC zera o frete e calcula subtotal. Diferenca de R$ 15 -> mesma excecao. Todo checkout de convidado acima do minimo de frete gratis falha.

```
-- 4. Shipping Calculation
    IF v_has_free_shipping_item = true OR v_calculated_subtotal >= COALESCE(v_store_config.free_shipping_min, 999999) THEN
        v_shipping_validated := 0;
    ELSE
        v_shipping_validated := COALESCE(v_store_config.shipping_fee, 0);
    END IF;
...
    -- 6. Price Tamping Protection
    IF ABS(v_calculated_total - p_total_amount) > 0.05 THEN
        RAISE EXCEPTION 'Divergência de valores detectada. Calculado: %, Fornecido: %', v_calculated_total, p_total_amount;
```

**Correção.**

O problema real e a assimetria da regra de FRETE GRATIS entre front e RPC (nao a cotacao de transportadora). Corrigir em tres pontos:

1) Backend - nova migration redefinindo public.create_marketplace_order_v22 (copiar o corpo de supabase/migrations/20260526000000_coupon_percentage_fixes.sql e trocar apenas o bloco 4), tratando free_shipping_min = 0 como "regra desativada", como o front ja faz:
   IF v_has_free_shipping_item = true
      OR v_calculated_subtotal >= COALESCE(NULLIF(v_store_config.free_shipping_min, 0), 999999) THEN
       v_shipping_validated := 0;
   ELSE
       v_shipping_validated := COALESCE(v_store_config.shipping_fee, 0);
   END IF;

2) Frontend - src/contexts/CartContext.tsx, no useMemo shippingFee (linhas ~729-733): remover o "&& user" da condicao, porque o backend concede frete gratis independentemente de login e o RPC aceita convidado (user_id NULL):
   if (config.freeShippingMin > 0 && cartTotal >= config.freeShippingMin) return 0;
   e remover "user" do array de dependencias do useMemo (linhas ~739-747).

3) Consistencia visual - src/views/customer/CartView.tsx:253: "const isRuleActive = (config.freeShippingMin || 0) > 0 && !!user;" -> remover "&& !!user" (e "user" das deps do useMemo, linha ~279), senao a barra de progresso de frete gratis some para o convidado enquanto o desconto e aplicado.

4) Defesa em profundidade (opcional, mas evita o mesmo apagao no futuro): em vez de RAISE EXCEPTION generica, o RPC deveria retornar erro tipado ou o front deveria reconsultar o total. E, ANTES de religar a calculadora de frete (src/components/ui/custom/ShippingCalculator.tsx hoje nao e renderizada por ninguem), passar a validar p_shipping_cost - atualmente morto na assinatura, linha 61 - contra public.shipping_quotes_cache (origin_cep/destination_cep/cart_hash recentes), caso contrario o bug do Cenario A vira real no dia em que o componente for montado.

---

### 34. 🟠 Comparacao NULL-insegura em update_order_status_atomic permite cancelar pedido de convidado alheio

`supabase/migrations/20260707000000_fix_update_order_status_atomic.sql:48` · **alta** · seguranca · _Supabase: RLS, RPCs, migrations e edge functions_

**Problema.** A checagem de propriedade usa '!=' em vez de 'IS DISTINCT FROM'. Pedidos de convidado sao gravados com user_id NULL (create_marketplace_order_v22 insere v_user_id := auth.uid(), que e NULL no checkout de convidado). Para esses pedidos, 'NULL != <uuid>' avalia para NULL, o IF nao dispara e a excecao de autorizacao nunca acontece. O restante da funcao so exige que o status novo seja 'cancelled' e o antigo 'pending'.

**Reproduzir.** 1) Um convidado fecha um pedido; o pedido fica com user_id NULL e status 'pending'. 2) O id do pedido circula (aparece na tela de sucesso, no rastreio por OTP, em print/URL). 3) Qualquer usuario logado comum chama supabase.rpc('update_order_status_atomic', { p_order_id: '<uuid do pedido alheio>', p_new_status: 'cancelled' }). 4) v_user_id (NULL) != v_caller_id (uuid) => NULL, a excecao 'Nao autorizado' nao e levantada, o pedido de outra pessoa e cancelado, o estoque e devolvido e uma linha e gravada em marketplace_order_history.

```
-- Security checks
    IF v_user_id != v_caller_id AND NOT v_is_admin THEN
        RAISE EXCEPTION 'Não autorizado: Você não tem permissão para alterar este pedido.';
    END IF;
```

**Correção.**

NAO editar a migration 20260707000000 (ja aplicada). Criar uma nova migration, por exemplo supabase\migrations\20260730000000_fix_null_safe_ownership_update_order_status.sql, com CREATE OR REPLACE mantendo a MESMA assinatura (uuid, text, text, boolean) para nao gerar sobrecarga/conflito no PostgREST.

Substituir o bloco das linhas 47-50 por (mantendo o resto do corpo identico ao arquivo atual):

    -- Bloqueia chamador sem sessao (defesa em profundidade; anon ja perdeu EXECUTE em 20260708130000)
    IF v_caller_id IS NULL THEN
        RAISE EXCEPTION 'Não autenticado.';
    END IF;

    -- Security checks NULL-safe: pedido de convidado (user_id NULL) nunca "pertence" a um chamador.
    -- IS DISTINCT FROM devolve TRUE quando v_user_id e NULL, entao a excecao passa a ser levantada.
    IF NOT v_is_admin AND v_user_id IS DISTINCT FROM v_caller_id THEN
        RAISE EXCEPTION 'Não autorizado: Você não tem permissão para alterar este pedido.';
    END IF;

Observacoes de aplicacao:
- Reordenar para "NOT v_is_admin AND ..." (em vez de "... AND NOT v_is_admin") tambem evita avaliar a comparacao para admins, mas o ganho principal e o IS DISTINCT FROM.
- A guarda explicita "IF v_user_id IS NULL THEN RAISE EXCEPTION ..." proposta pelo achado original vira redundante: com v_caller_id garantidamente NOT NULL, "NULL IS DISTINCT FROM <uuid>" ja e TRUE e bloqueia todo pedido de convidado para nao-admin. Manter as duas so se quiser a mensagem de erro separada.
- Nao ha perda de funcionalidade legitima: pedidos de convidado hoje ja nao podem ser cancelados pelo proprio convidado (anon nao tem EXECUTE desde 20260708130000_revoke_anon_rpc_permissions.sql:83-86), entao o unico fluxo que a correcao elimina e o abusivo. Se no futuro quiserem permitir o cancelamento pelo convidado, isso tem que passar por verificacao de OTP, nao por auth.uid().
- Nao esquecer de repetir os GRANT/REVOKE apos o CREATE OR REPLACE (REVOKE EXECUTE ... FROM anon, public; GRANT EXECUTE ... TO authenticated, service_role), para nao reintroduzir o acesso anon que as migrations 20260708120000/20260708130000 fecharam.
- Tratar em separado (achado proprio, mas urgente) o vazamento em generate_order_otp_v1 / get_orders_by_otp_v1: o OTP e enviado para um email escolhido pelo chamador enquanto o casamento de pedidos usa o telefone da vitima, o que entrega os ids dos pedidos de convidado alheios.

---

### 35. 🟠 get_orders_by_otp_v1 permite forca bruta do codigo de 6 digitos e devolve PII completa

`supabase/migrations/20260625000000_fix_guest_tracking_items.sql:17` · **alta** · seguranca · _Supabase: RLS, RPCs, migrations e edge functions_

**Problema.** A funcao e SECURITY DEFINER, esta concedida a anon (GRANT ... TO anon, authenticated na linha 180) e valida apenas email + otp_code + expires_at. Nao existe contador de tentativas, bloqueio por IP/e-mail nem invalidacao apos N erros. O codigo tem apenas 6 digitos (1.000.000 de combinacoes) e vale 15 minutos. Em caso de acerto, o retorno traz nome, telefone, customer_data completo e o endereco inteiro (to_jsonb(addr.*)) de todos os pedidos associados ao e-mail e ao WhatsApp.

**Reproduzir.** 1) Um atacante que conheca o e-mail da vitima e o final de um pedido chama generate_order_otp_v1 (a vitima recebe o e-mail, o atacante nao). 2) O atacante roda um loop chamando o endpoint REST /rest/v1/rpc/get_orders_by_otp_v1 com p_email fixo e p_otp de 000000 a 999999 usando a chave anon publica. 3) Sem rate limit no banco, ele acerta o codigo dentro da janela de 15 minutos. 4) Recebe historico completo de pedidos com nome, WhatsApp, CEP, rua, numero e complemento da vitima.

```
-- Check if OTP is valid and not expired
    SELECT whatsapp, verified INTO v_valid_record
    FROM public.otp_verifications
    WHERE email = p_email 
    AND otp_code = p_otp 
    AND expires_at > NOW()
    ORDER BY created_at DESC
    LIMIT 1;
```

**Correção.**

Correcao precisa, ancorada no codigo lido. ATENCAO a uma armadilha que a proposta original nao considerou: no PostgREST cada RPC roda em UMA transacao, entao "incrementar attempts e depois RAISE EXCEPTION" NAO funciona — o RAISE aborta a transacao e o incremento e revertido, deixando o contador sempre em zero. O contador so persiste se o caminho de falha RETORNAR em vez de levantar excecao.

1) Migration nova (ex.: supabase/migrations/2026XXXX_otp_bruteforce_protection.sql):
   ALTER TABLE public.otp_verifications ADD COLUMN IF NOT EXISTS attempts INT NOT NULL DEFAULT 0;
   CREATE INDEX IF NOT EXISTS idx_otp_email_code ON public.otp_verifications (email, otp_code);

2) Reescrever public.get_orders_by_otp_v1(text, text) (definicao atual em supabase/migrations/20260625000000_fix_guest_tracking_items.sql:7-100), trocando o bloco das linhas 16-31 por:
   - UPDATE public.otp_verifications SET attempts = attempts + 1 WHERE email = p_email AND expires_at > NOW() AND verified = FALSE;  (incrementa ANTES de validar)
   - SELECT ... INTO v_valid_record WHERE email = p_email AND otp_code = p_otp AND expires_at > NOW() AND attempts <= 5 ORDER BY created_at DESC LIMIT 1;
   - se v_valid_record.whatsapp IS NULL OU se ja houver linha com attempts > 5 para o e-mail: DELETE FROM public.otp_verifications WHERE email = p_email; e RETURN jsonb_build_object('error','invalid_or_locked') — RETURN, nunca RAISE, senao o UPDATE de attempts e revertido.
   - Ajustar src\hooks\useOrders.ts:902-919 (fetchOrdersByOtp) para tratar o objeto {error: ...} retornado, ja que hoje ele so trata o caminho de excecao lancada.

3) Em public.generate_order_otp_v1(text,text,text) (definicao atual em supabase/migrations/20260708190000_secure_otp_flow.sql:8-55) — aqui RAISE e seguro porque nao ha estado a preservar:
   a) Adicionar no inicio, espelhando get_orders_by_whatsapp_v3: IF p_order_fragment IS NULL OR LENGTH(p_order_fragment) < 4 THEN RAISE EXCEPTION 'Informe pelo menos 4 digitos do pedido.'; END IF;  (hoje a linha 39 "o.id::text ILIKE '%' || p_order_fragment" aceita fragmento vazio e casa com todos os pedidos).
   b) Trocar o OR das linhas 29-38 por AND: exigir que o pedido case com o e-mail E com o whatsapp informados. E, antes do INSERT, gravar o telefone lido do proprio pedido (o.customer_phone) em vez do p_whatsapp cru — isso fecha o vetor de vincular um telefone arbitrario a um e-mail controlado pelo atacante.
   c) Antes do INSERT da linha 50: DELETE FROM public.otp_verifications WHERE email = p_email AND verified = FALSE; (mantem no maximo UM codigo valido por e-mail, matando a […]

---

### 36. 🟡 Checkout nao valida carrinho vazio e envia pedido sem itens

`src/views/customer/CheckoutView.tsx:412` · **media** · bug · _Carrinho, cupons e checkout_

**Problema.** `handleSubmitEvent` valida o formulario e o endereco, mas nunca checa `cart.length`. A rota `checkout` e um deep link valido (listada em `validViews` em App.tsx:1401), entao a tela abre com carrinho vazio. Com `cart = []`, `p_items` vai como array vazio, a RPC entra no loop zero vezes e calcula subtotal 0 — mas ainda soma `shipping_fee` (porque 0 nunca atinge `free_shipping_min`), enquanto o front manda total 0 (o memo `shippingFee` retorna 0 quando `cart.length === 0`). O usuario recebe uma mensagem de divergencia sem sentido; e se `shipping_fee` for 0, um pedido totalmente vazio e criado no banco.

**Reproduzir.** Usuario finaliza uma compra, o carrinho e limpo e ele fica na tela de sucesso. Ele da F5 (URL ainda e /checkout). A tela remonta com carrinho vazio, o formulario ja vem preenchido com nome/whatsapp do perfil (portanto `isValid` = true) e o botao 'Finalizar Pedido' fica habilitado. Ao tocar, ele recebe 'Falha no Pedido: Divergencia de valores detectada. Calculado: 15, Fornecido: 0' — ou, com frete zero, cria um pedido fantasma de R$ 0,00 que aparece no painel do admin.

```
const orderData: any = {
      customer: customerInfo,
      items: cart.map((item) => ({
        product_id: item.product.id, // Fixed key name for RPC
        quantity: item.quantity,
        variant_id: item.variantId, // Fixed key name for RPC
      })),
```

**Correção.**

Tres camadas (todas verificadas contra o codigo lido):

1) Front — guarda no submit. Em src/views/customer/CheckoutView.tsx, no inicio de `handleSubmitEvent` (linha 377), ANTES de `setIsSubmitting(true)` (linha 388):
```ts
const handleSubmitEvent = async () => {
  if (cart.length === 0) {
    toast.error("Seu carrinho está vazio.");
    onNavigate("cart");
    return;
  }
  const isFormValid = await form.trigger();
  ...
```

2) Front — botao. Substituir a condicao duplicada nas linhas 1022 e 1025 por uma variavel unica, calculada junto de `const isValid = form.formState.isValid;` (linha 326):
```ts
const isSubmitDisabled = !isValid || isSubmitting || cart.length === 0;
```
e usar `disabled={isSubmitDisabled}` (1022) e `isSubmitDisabled ? "bg-zinc-100 ..." : "bg-[#5C061E] ..."` (1025). Opcionalmente, com `cart.length === 0`, trocar o rotulo do botao para "Carrinho vazio" para nao deixar o usuario preso sem explicacao.

3) Backend — nova migration recriando `public.create_marketplace_order_v22` a partir do corpo atual (supabase/migrations/20260526000000_coupon_percentage_fixes.sql:58-253) com DOIS ajustes:
   a) logo apos o `BEGIN` (linha 99), antes do check de endereco:
```sql
IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array' OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'Pedido sem itens.';
END IF;
```
   b) corrigir a linha 150, que hoje trata `free_shipping_min = 0` (estado "frete gratis desativado" gravado por AdminShippingView.tsx:427) como "frete gratis sempre", divergindo da regra do front (`config.freeShippingMin > 0 && ...` em CartContext.tsx:729-734):
```sql
IF v_has_free_shipping_item = true
   OR v_calculated_subtotal >= COALESCE(NULLIF(v_store_config.free_shipping_min, 0), 999999) THEN
```
O item (3a) e o que realmente fecha o buraco, porque a RPC tem GRANT para `anon` (supabase/migrations/20260708120000_db_security_rls_and_rpc_hardening.sql:463-467) e hoje aceita `p_items = []` vindo de qualquer chamador, nao so da tela.

---

### 37. 🟡 Sem guarda de reentrancia/idempotencia no envio do pedido: risco de pedido duplicado

`src/views/customer/CheckoutView.tsx:377` · **media** · bug · _Carrinho, cupons e checkout_

**Problema.** A unica protecao contra envio duplicado e o atributo `disabled` do botao, e o `setIsSubmitting(true)` so acontece depois do `await form.trigger()` — ou seja, fora do tick sincrono do clique. Nao existe nenhum `if (isSubmitting) return;` no topo da funcao nem chave de idempotencia na RPC. Pior: quando `createOrder` rejeita, o carrinho NAO e limpo e o botao volta a ficar ativo, sem forma de saber se o pedido chegou a ser gravado no banco.

**Reproduzir.** Cliente toca em 'Finalizar Pedido' em conexao ruim. A RPC executa e comita o pedido (estoque decrementado, usage_count do cupom incrementado), mas a resposta HTTP estoura por timeout. O front cai no catch, mostra 'Falha no Pedido: ...' e mantem o carrinho intacto. O cliente toca de novo -> segundo pedido identico criado, estoque debitado duas vezes e o cupom de uso unico consumido duas vezes.

```
const handleSubmitEvent = async () => {
    const isFormValid = await form.trigger();
    if (!isFormValid) {
      toast.error(
        "Por favor, preencha todos os campos obrigatórios corretamente.",
      );
      return;
    }

    const data = form.getValues();

    setIsSubmitting(true);
```

**Correção.**

Duas camadas, ambas necessárias (o lock sozinho não cobre o retry pós-timeout, que é o risco dominante).

CAMADA 1 — lock síncrono no front (`src/views/customer/CheckoutView.tsx`)
Declarar junto dos demais refs (perto da linha 228): `const submitLockRef = useRef(false);`
Reescrever o topo de `handleSubmitEvent` (linha 377) para travar ANTES de qualquer `await`, liberando em todos os early-returns:
```
const handleSubmitEvent = async () => {
  if (submitLockRef.current) return;
  submitLockRef.current = true;
  setIsSubmitting(true);

  const isFormValid = await form.trigger();
  if (!isFormValid) {
    toast.error("Por favor, preencha todos os campos obrigatórios corretamente.");
    setIsSubmitting(false);
    submitLockRef.current = false;
    return;
  }
  ...
  if (user && !selectedAddressId) {   // linha 390 atual
    toast.error("Por favor, adicione ou selecione um endereço de entrega.");
    setIsSubmitting(false);
    submitLockRef.current = false;
    return;
  }
```
E no `finally` (linhas 465-467) liberar o lock apenas no caminho de erro — no sucesso o componente troca para `SuccessView` (linha 470), então manter `submitLockRef.current = true` após sucesso evita reenvio residual. Prático: `submitLockRef.current = false;` dentro do `catch`, e `setIsSubmitting(false)` segue no `finally`.

CAMADA 2 — idempotência de verdade (é o que resolve o cenário real)
a) Nova migration adicionando a coluna e o índice:
```
ALTER TABLE public.marketplace_orders ADD COLUMN IF NOT EXISTS idempotency_key uuid;
CREATE UNIQUE INDEX IF NOT EXISTS marketplace_orders_idempotency_key_uidx
  ON public.marketplace_orders (idempotency_key) WHERE idempotency_key IS NOT NULL;
```
b) Recriar `create_marketplace_order_v22` (base: `supabase/migrations/20260526000000_coupon_percentage_fixes.sql:58`) com o parâmetro extra `p_idempotency_key uuid DEFAULT NULL` e, logo após o `BEGIN` (linha 99), o short-circuit:
```
IF p_idempotency_key IS NOT NULL THEN
    SELECT id INTO v_order_id FROM public.marketplace_orders
     WHERE idempotency_key = p_idempotency_key;
    IF v_order_id IS NOT NULL THEN
        RETURN v_order_id;   -- devolve o pedido já gravado, não cria outro
    END IF;
END IF;
```
gravando `idempotency_key` no INSERT do cabeçalho (linhas 191-200). Atenção: a assinatura muda, então é obrigatório atualizar os `REVOKE`/`GRANT` que enumeram os tipos em `supabase/migrations/20260708120000_db_security_rls_and_rpc_hardening.sql:423-425` e `:463-467` (`jsonb, numeric, numeric, text, uuid, text, text, text, text, jsonb` → acrescentar `, uuid`), senão o guest checkout (anon) […]

---

### 38. 🟡 Semaforo global checkingLock aplica o resultado de admin do usuario anterior

`src/contexts/AuthContext.tsx:151` · **media** · bug · _Autenticacao, sessao e controle de acesso_

**Problema.** checkingLock e initPromise sao variaveis de modulo compartilhadas por todas as chamadas de checkAdmin. Quando uma segunda verificacao comeca enquanto outra esta em voo, ela apenas aguarda o lock e faz `return` sem nunca calcular nem aplicar o resultado do SEU usuario. A closure dentro do lock captura o userId e o cacheKey do PRIMEIRO chamador, entao quem manda em setIsAdmin e no localStorage e sempre o usuario antigo.

**Reproduzir.** 1) Admin A esta logado e uma verificacao de rede (RPC is_admin) esta em andamento (ate 3s). 2) A clica em "Encerrar Sessao" e, na mesma aba, o usuario B (cliente comum) faz login antes da RPC responder. 3) O SIGNED_IN de B chama checkAdmin(B); como o JWT de B nao tem role e o cache foi apagado no SIGNED_OUT, cai em networkCheck. 4) checkingLock ainda esta pendente (de A) -> `await checkingLock; return;`. 5) A closure de A resolve com data=true e executa setIsAdmin(true) e localStorage.setItem('ikcous_is_admin_<A>','true'). 6) B fica com isAdmin=true, ve o menu/rota admin liberados e recebe erros de permissao em todas as telas.

```
async function networkCheck() {
      if (checkingLock) {
        try {
          await checkingLock;
        } catch {
          // Ignore concurrent check errors
        }
        return;
      }
```

**Correção.**

Aplicar em src/contexts/AuthContext.tsx. A raiz e que o resultado da verificacao e aplicado por efeito colateral de dentro do lock, sem checar de quem e o resultado.

1) Trocar o semaforo global por lock por usuario e fazer a promise RESOLVER o booleano (linhas 58-59):
   let adminChecks = new Map<string, Promise<boolean>>();
   let initPromise: Promise<any> | null = null;

2) Reescrever `networkCheck` (linhas 150-198) para so calcular, nunca aplicar:
   async function runAdminQuery(uid: string): Promise<boolean> {
     const { data, error } = await supabase.rpc("is_admin");
     if (!error && typeof data === "boolean") return data;
     const { data: p, error: pErr } = await supabase
       .from("profiles").select("role").eq("id", uid).single();
     return !pErr && p?.role === "admin";
   }

3) Em `checkAdmin`, coalescer por `userId` e aplicar o resultado apenas se o usuario ainda for o ativo:
   let pending = adminChecks.get(userId);
   if (!pending) {
     pending = Promise.race([
       runAdminQuery(userId),
       new Promise<boolean>((_, rej) =>
         setTimeout(() => rej(new Error("Admin check timeout")), 3000)),
     ]).finally(() => { adminChecks.delete(userId); });
     adminChecks.set(userId, pending);
   }
   try {
     const result = await pending;
     localStorage.setItem(cacheKey, result ? "true" : "false"); // seguro: chaveado por userId
     if (activeUserIdRef.current === userId) setIsAdmin(result);  // GUARDA DE IDENTIDADE
   } catch (err) {
     console.error("[Auth] Error/Timeout checking admin status:", err);
     if (activeUserIdRef.current === userId) setIsAdmin(false);   // idem na linha 194
   }
   Isso corrige de uma vez os dois defeitos: o waiter passa a aplicar o proprio resultado, e a `queryPromise` orfa que sobrevive ao timeout de 3s (linha 187) deixa de conseguir escrever `setIsAdmin` para um usuario que ja saiu.

4) `checkAdmin` precisa enxergar `activeUserIdRef`. Ela ja e declarada na linha 251, DEPOIS de `checkAdmin` (linha 121) — mover a declaracao de `activeUserIdRef` (e das outras refs do bloco 248-253) para antes de `checkAdmin`, ou converter `checkAdmin` em `useCallback` declarada apos as refs. Como o efeito da linha 255 tem deps `[fetchProfile]` e captura a `checkAdmin` do primeiro render, use `useCallback(..., [])` para manter a identidade estavel.

5) No handler de SIGNED_OUT (dentro do bloco das linhas 459-471), limpar tambem o estado de modulo, junto com a remocao das chaves `ikcous_is_admin_*`:
   adminChecks.clear();
   initPromise = null;
   Sem isso, um remount do AuthProvider reaproveita o […]

---

### 39. 🟡 RPC check_user_confirmation_status exposta a anon permite enumerar e-mails cadastrados

`supabase/migrations/20260628100000_add_user_confirmation_check.sql:30` · **media** · seguranca · _Autenticacao, sessao e controle de acesso_

**Problema.** check_user_confirmation_status e SECURITY DEFINER, consulta auth.users por e-mail e tem GRANT EXECUTE para anon, sem qualquer rate limit. A tela de recuperacao de senha ainda expoe o resultado literalmente para o usuario, transformando o app em um oraculo de "este e-mail tem conta / nao tem / nao esta confirmado".

**Reproduzir.** 1) Qualquer pessoa sem login chama a RPC direto no endpoint REST (ou usa a tela "Recuperar") com uma lista de e-mails. 2) Para cada e-mail cadastrado recebe {exists:true, confirmed:true|false}; para os demais {exists:false}. 3) A UI confirma na tela: para e-mail inexistente aparece "Este e-mail nao esta cadastrado. Verifique o endereco ou crie uma conta." e para e-mail existente sem confirmacao um aviso diferente. Resultado: enumeracao completa da base de clientes em massa.

```
GRANT EXECUTE ON FUNCTION public.check_user_confirmation_status(text) TO anon,
authenticated;
```

**Correção.**

Correcao em tres partes; as duas primeiras sao obrigatorias e precisam ir juntas no mesmo deploy.

1) NOVA migration (ex.: supabase/migrations/20260730000000_revoke_user_confirmation_oracle.sql) — nao basta editar a linha 30 da 20260628100000, porque a 20260708120000:486-488 e reproduzida depois e restauraria o GRANT:

REVOKE EXECUTE ON FUNCTION public.check_user_confirmation_status(text) FROM anon, authenticated, PUBLIC;

Repare que "authenticated" tambem precisa entrar: com o GRANT atual, qualquer pessoa que crie uma conta gratuita continua com o oraculo. Manter apenas service_role (ja concedido em 20260708120000:488). Se o fluxo do item 3 nao for implementado, o mais simples e DROP FUNCTION public.check_user_confirmation_status(text) e remover as entradas correspondentes de src/types/supabase.ts:1654-1657 e src/types/database.types.ts:1654-1657.

2) src/contexts/AuthContext.tsx, resetPassword (linhas 562-653): remover por completo a chamada supabase.rpc("check_user_confirmation_status", ...) (linhas 566-590) e os dois early-returns discriminantes (592-599 "not_found" e 601-625 "unconfirmed"). Chamar supabase.auth.resetPasswordForEmail(email, { redirectTo: ... }) direto (o codigo ja existe nas linhas 628-632) e retornar SEMPRE a mesma resposta neutra, inclusive quando o proprio resetPasswordForEmail falhar por e-mail inexistente:

return { success: true, status: "success", message: "Se este e-mail estiver cadastrado, enviamos as instrucoes de recuperacao." };

Consequencias a ajustar no mesmo commit: o union type ResetPasswordResult["status"] em AuthContext.tsx:16 perde "unconfirmed" e "not_found"; e os branches em src/views/shared/AuthView.tsx:181-184 colapsam num unico toast neutro (mantendo a transicao para setViewMode("reset-prompt") da linha 179 em todos os casos, para nao criar um novo oraculo por diferenca de navegacao).

3) OPCIONAL, so se o produto exigir mesmo o comportamento "reenviar confirmacao em vez de link de recuperacao": mover essa decisao para uma Edge Function nova em supabase/functions/ (mesmo padrao ja usado por supabase/functions/send-otp-email), rodando com SERVICE_ROLE_KEY. Ela consulta o status internamente, escolhe entre auth.resend({type:"signup"}) e resetPasswordForEmail, aplica rate limit por IP e por e-mail (ex.: 5 tentativas / 15 min, persistidas em tabela), e devolve ao browser SEMPRE o mesmo corpo neutro — nunca os campos exists/confirmed. Isso tambem fecha o gatilho de envio de e-mail para endereco arbitrario que hoje existe em AuthContext.tsx:603-609.

---

### 40. 🟡 Logout falha silenciosamente offline e o usuario continua autenticado no dispositivo

`src/contexts/AuthContext.tsx:531` · **media** · seguranca · _Autenticacao, sessao e controle de acesso_

**Problema.** logout() so limpa o estado local quando supabase.auth.signOut() retorna sem erro. Em falha de rede o supabase-js retorna { error } ANTES de remover a sessao do storage, entao nem o SDK nem o app limpam nada: mostra-se apenas um toast e o usuario permanece logado, com o token intacto no localStorage. Alem disso, mesmo no caminho de sucesso o logout local nao chama setProfile(null) (depende do listener) nem limpa caches de PII.

**Reproduzir.** 1) Usuario esta em um celular/PC compartilhado, sem rede ou com a rede instavel (cenario comum neste PWA, que se anuncia offline-first). 2) Vai em Perfil > "Encerrar Sessao". 3) signOut() falha com AuthRetryableFetchError; aparece o toast "Erro ao sair: Failed to fetch" e nada mais acontece. 4) A tela continua mostrando nome, avatar, pedidos e endereco do usuario, e o token continua no localStorage para a proxima pessoa que abrir o app.

```
const logout = useCallback(async () => {
    const { error } = await supabase.auth.signOut();
    if (error) {
      toast.error(`Erro ao sair: ${error.message}`);
    } else {
      setSession(null);
      setUser(null);
      setIsAdmin(false);
      setIsPasswordRecovery(false);
    }
  }, []);
```

**Correção.**

Sempre encerrar a sessão localmente, com fallback que NÃO dependa de rede.

1. Extrair para uma função `clearLocalUserData()` a limpeza que hoje só existe dentro do listener em `AuthContext.tsx:456-471` (setProfile(null), setIsAdmin(false), remoção de `app.favorites`, `marketplace_cart_v1`, `ikcous_recently_viewed`, `ikcous_compare`, `ikcous_is_admin` e todas as chaves `ikcous_is_admin_*`), e chamá-la nos dois lugares — isso é obrigatório porque, no caminho de erro, o evento SIGNED_OUT nunca é emitido e o listener não roda.

2. Não usar `signOut({ scope: 'local' })` como fallback (em auth-js 2.110.1 ele também faz request de rede e falha igual). O fallback correto é remover manualmente as chaves de sessão do storage, reaproveitando o mesmo padrão de `getCachedSession` (linha 68):

```ts
const logout = useCallback(async () => {
  const { error } = await supabase.auth.signOut();

  if (error) {
    // Fallback offline: o SDK retorna antes de _removeSession(), então limpamos o storage na mão
    try {
      for (let i = localStorage.length - 1; i >= 0; i--) {
        const key = localStorage.key(i);
        if (key?.includes("-auth-token") || key?.endsWith("-code-verifier")) {
          localStorage.removeItem(key);
        }
      }
    } catch (e) {
      console.error("[Auth] Falha ao limpar sessão local:", e);
    }
    toast.warning(
      "Sessão encerrada neste dispositivo. A desconexão nos outros aparelhos será concluída quando houver conexão.",
    );
  }

  // Sempre executado, com ou sem erro
  clearLocalUserData();          // setProfile(null) + caches de PII (linhas 456-471)
  setSession(null);
  setUser(null);
  setIsAdmin(false);
  setIsPasswordRecovery(false);
  activeUserIdRef.current = null;
}, []);
```

3. Opcional, para não perder a revogação no servidor: gravar uma flag do tipo `ikcous_pending_signout` e reenviar o `signOut` global quando a conectividade voltar (o app já tem infraestrutura offline em `src/lib/realtimeSyncEngine.ts`).

4. Recomendável ainda: na verificação de boot (`AuthContext.tsx:310-315`), o critério `isDefinitivelyInvalid` deixa passar erro de rede, o que faz uma sessão órfã sobreviver a reinícios — vale tratar 401 além de 403 e considerar expirar a hidratação otimista de `getCachedSession` após N tentativas de verificação sem sucesso.

---

### 41. 🟡 Limpeza de logout usa chave inexistente e deixa PII do usuario anterior no localStorage

`src/contexts/AuthContext.tsx:460` · **media** · seguranca · _Autenticacao, sessao e controle de acesso_

**Problema.** O handler de SIGNED_OUT remove "app.favorites", chave que nao existe em lugar nenhum do codigo (FavoritesContext usa FAVORITES_KEY = "ikcous_favorites"). Pior: os caches que realmente contem dados pessoais nao sao removidos. useOrders grava `ikcous_orders_cache_${user.id}` com o historico completo de pedidos e useAddresses grava `ikcous_addresses_cache_${user.id}` com CEP, rua, numero, bairro e nome do destinatario. Nada disso e apagado no logout; so as chaves com prefixo ikcous_is_admin_ sao varridas.

**Reproduzir.** 1) Cliente faz um pedido em um tablet compartilhado da loja: useOrders e useAddresses gravam ikcous_orders_cache_<uid> e ikcous_addresses_cache_<uid>. 2) Ele faz logout corretamente. 3) A proxima pessoa abre o DevTools (ou o proprio app em modo debug) e le no Application > Local Storage o endereco completo, telefone e historico de compras do cliente anterior, indefinidamente. 4) Em paralelo, favoritos locais de convidado gravados em "ikcous_favorites" tambem sobrevivem ao logout, porque a chave apagada e a errada.

```
localStorage.removeItem("app.favorites");
          localStorage.removeItem("marketplace_cart_v1");
          localStorage.removeItem("ikcous_recently_viewed");
          localStorage.removeItem("ikcous_compare");
          localStorage.removeItem("ikcous_is_admin");
          for (let i = localStorage.length - 1; i >= 0; i--) {
            const key = localStorage.key(i);
            if (key?.startsWith("ikcous_is_admin_")) {
              localStorage.removeItem(key);
            }
          }
```

**Correção.**

Reescrever o bloco AuthContext.tsx:459-471 para varrer prefixos reais em vez de chaves mortas. O `previousUserId` ja esta em escopo no mesmo callback (usado na linha 389), mas a varredura por prefixo e mais segura porque cobre tambem residuos de sessoes anteriores:

```ts
if (event === "SIGNED_OUT" && typeof window !== "undefined") {
  const PREFIXOS = [
    "ikcous_orders_cache_",     // useOrders.ts:205 (historico + endereco + whatsapp)
    "ikcous_addresses_cache_",  // useAddresses.ts:88 (CEP, rua, numero, bairro, destinatario)
    "ikcous_is_admin_",         // AuthContext.tsx:128
    "ikcous_recs_cache_",       // ProductView.tsx:37
  ];
  const CHAVES_FIXAS = [
    "ikcous_favorites",                 // FavoritesContext.tsx:10
    "marketplace_cart_v1",              // CartContext.tsx:60
    "marketplace_cart_tombstones_v1",   // CartContext.tsx:61
    "ikcous_last_shipping_cep",         // ShippingCalculator.tsx:29/108, CheckoutView.tsx:181
    "orders_offline_updates_queue",     // useOrders.ts:41
  ];
  try {
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const key = localStorage.key(i);
      if (key && PREFIXOS.some((p) => key.startsWith(p))) {
        localStorage.removeItem(key);
      }
    }
    CHAVES_FIXAS.forEach((k) => localStorage.removeItem(k));
    sessionStorage.removeItem("guest_tracked_orders"); // OrderSearch.tsx:110
  } catch (e) {
    console.error("[Auth] Falha ao limpar storage no logout:", e);
  }
}
```

Remover as quatro chaves mortas atuais ("app.favorites", "ikcous_recently_viewed", "ikcous_compare", "ikcous_is_admin") — nenhum writer no repo.

Dois cuidados verificados no codigo:
1) `marketplace_cart_v1` pode ser reescrito logo depois pelo efeito de persistencia em CartContext.tsx:161-166 (`localStorage.setItem(CART_STORAGE_KEY, JSON.stringify(cart))` dispara em qualquer mudanca de `cart` quando `!syncLocked.current && !isInitialLoad.current`). O `removeItem` no AuthContext so e definitivo se o estado `cart` do CartContext tambem for zerado no logout — hoje isso ja acontece parcialmente via CartContext.tsx:356/698. Vale garantir que o reset em memoria ocorra, senao a limpeza da chave do carrinho vira placebo.
2) Os caches de PII (`ikcous_orders_cache_`/`ikcous_addresses_cache_`) nao correm esse risco: useOrders.ts:162-163 e useAddresses.ts:47-48 fazem early-return quando `!user`, entao nada reescreve apos o SIGNED_OUT.

Complemento recomendado: centralizar essas chaves em um modulo unico (ex.: `src/lib/storageKeys.ts`) exportando `STORAGE_PREFIXES` e `STORAGE_KEYS`, e importa-las em AuthContext, […]

---

### 42. 🟡 Push de 'status atualizado' e enviado antes de confirmar a alteracao no banco

`src/views/admin/AdminOrdersView.tsx:442` · **media** · bug · _Pedidos: criacao, status, historico e admin_

**Problema.** `handleStatusChange` dispara a Edge Function `send-push` antes de chamar `updateOrderStatus`. Se a RPC falhar (sem permissao, erro de rede, pedido ja cancelado), o cliente ja recebeu a notificacao dizendo que o status mudou, mas o pedido continua no status anterior. Alem disso, o push depende de `orders.find(...)`: quando o admin abre um pedido por deep link ou de outra pagina (pedido nao esta em `orders`), `order` fica undefined e nenhuma notificacao e enviada, sem qualquer aviso.

**Reproduzir.** Admin abre um pedido e clica em 'Avancar: Em Transito'. O push 'Seu pedido #A1B2C3 agora esta: Em Transito' e entregue ao cliente. Em seguida `updateOrderStatus` falha (ex.: sessao expirada / erro 401) e a UI mostra 'Erro ao atualizar status do pedido' com rollback otimista. Resultado: o cliente foi notificado de um envio que nunca aconteceu e o pedido segue em 'Em Separacao'.

```
const order = orders?.find((o) => o.id === orderId);

    if (order?.userId && !silent && !isOffline) {
      try {
        const title = "Status do Pedido Atualizado";
```

**Correção.**

Em src/views/admin/AdminOrdersView.tsx, dentro de `handleStatusChange` (linhas 435-489):

1) Mover todo o bloco do push (linhas 442-468) para DEPOIS do `await updateOrderStatus(orderId, newStatus, undefined, silent)` (linha 471) ter retornado sem lancar, ou seja, para logo apos `loadStats()` dentro do `try`. Isso elimina a notificacao falsa e tambem remove o round-trip da Edge Function do caminho critico do update otimista.

2) Resolver o `userId` sem depender da lista paginada, capturando o alvo ANTES do await (a lista `orders` pode ser reescrita pelo realtime durante a chamada):
   const targetUserId = (selectedOrder?.id === orderId ? selectedOrder.userId : undefined) ?? orders?.find((o) => o.id === orderId)?.userId;
   `selectedOrder` cobre o caso de deep link, porque vem do fetch de `marketplace_orders` com `select("*")` (linhas 293-305) e `mapOrderFromDB` popula `userId` (src/lib/mappers.ts:188).

3) Nao enviar push quando a alteracao foi apenas enfileirada offline. Hoje `updateOrderStatus` (src/hooks/useOrders.ts:706-732) retorna com sucesso apos gravar em `orders_offline_updates_queue`, sem tocar no banco. O guard `!isOffline` cobre a maioria dos casos, mas ele usa o estado do hook `useOnlineStatus` enquanto a fila usa `navigator.onLine`. Correcao precisa: fazer `updateOrderStatus` retornar um resultado explicito (ex.: `return { queuedOffline: true }` na linha 731 e `return { queuedOffline: false, data }` apos a RPC, aproveitando o `data` que hoje e descartado em `const { error } = await (supabase.rpc as any)("update_order_status_atomic", ...)` na linha 734) e so disparar o push quando `queuedOffline === false`.

4) Opcional, mas robusto: usar o jsonb retornado pela RPC (a funcao SQL ja faz `RETURNING to_jsonb(public.marketplace_orders.*) INTO v_result`) como fonte autoritativa de `user_id`, eliminando de vez a dependencia de `orders`/`selectedOrder`.

5) Se o push falhar apos o update bem-sucedido, hoje o erro e apenas logado (linha 466). Manter o log, mas avisar o admin com um toast discreto (ex.: "Status atualizado, mas nao foi possivel notificar o cliente"), para que a ausencia de notificacao deixe de ser silenciosa.

---

### 43. 🟡 Fila offline de status e processada por varias instancias do hook e trava com erro permanente

`src/hooks/useOrders.ts:993` · **media** · bug · _Pedidos: criacao, status, historico e admin_

**Problema.** O efeito de sincronizacao offline nao tem guarda de instancia unica (nem leader election) e roda em toda montagem de `useOrders`, inclusive quando `enabled` e false. Como CartView e o OrderSearch renderizado dentro dela instanciam o hook ao mesmo tempo, duas execucoes concorrentes leem a MESMA fila em localStorage e disparam a mesma RPC. A segunda chamada falha (o pedido ja nao esta mais 'pending'), o item volta para `remainingQueue` e passa a falhar em todo reconexao futura.

**Reproduzir.** Cliente offline cancela o pedido pela tela de detalhes: o item vai para 'orders_offline_updates_queue'. Ao voltar a conexao, CartView e OrderSearch chamam `syncOfflineOrderUpdates()` quase simultaneamente. A primeira cancela com sucesso; a segunda recebe 'Apenas pedidos pendentes podem ser cancelados pelo usuario', empurra o item de volta ao localStorage e exibe 'Falha ao sincronizar 1 alteracoes de pedidos'. A partir dai, toda vez que o app volta a ficar online o cliente ve o mesmo erro, para um cancelamento que ja foi concluido.

```
} catch (err) {
        console.error(
          "[Offline Sync] Failed to sync order status %s:",
          orderId,
          err,
        );
        remainingQueue.push(item);
      }
```

**Correção.**

Tres mudancas em `src/hooks/useOrders.ts`, nesta ordem de prioridade:

1) Serializar por promessa em escopo de modulo (resolve a duplicacao intra-aba, que o `isLeader` NAO resolve porque `TAB_ID` em `useLeaderElection.ts:5` e por aba, nao por instancia). Antes da linha 39:
```ts
let offlineOrdersSyncInFlight: Promise<boolean> | null = null;

async function syncOfflineOrderUpdates(): Promise<boolean> {
  if (offlineOrdersSyncInFlight) return offlineOrdersSyncInFlight;
  offlineOrdersSyncInFlight = runOfflineOrderSync().finally(() => {
    offlineOrdersSyncInFlight = null;
  });
  return offlineOrdersSyncInFlight;
}
```
renomeando o corpo atual (linhas 39-102) para `runOfflineOrderSync`. Assim as 3 instancias montadas (CartView.tsx:66, ProfileView.tsx:95, OrderDetailsView.tsx:89) compartilham a mesma execucao e o mesmo toast.

2) Descartar erros terminais em vez de reenfileirar. Substituir o catch das linhas 67-74 por uma classificacao baseada nas mensagens exatas levantadas por `supabase/migrations/20260707000000_fix_update_order_status_atomic.sql`:
```ts
} catch (err: any) {
  const msg = String(err?.message || "");
  const isTerminal =
    msg.includes("Apenas pedidos pendentes podem ser cancelados") ||
    msg.includes("Operação não permitida") ||
    msg.includes("Não autorizado") ||
    msg.includes("Pedido não encontrado");
  console.error("[Offline Sync] Failed to sync order status %s:", orderId, err);
  if (!isTerminal) remainingQueue.push(item);
  else discardedCount++;
}
```
e usar `discardedCount` para mudar a mensagem final (linhas 84-87) para algo como "Cancelamento ja aplicado no servidor" em vez de "Falha ao sincronizar". Complementarmente, descartar itens com `item.timestamp` mais antigo que ~7 dias, para que nenhum erro inesperado envenene a fila para sempre.

3) Reduzir o numero de instancias que registram o listener: no efeito da linha 993 adicionar `if (!enabled) return;` logo apos o guard de `window` — hoje `AdminLayout.tsx:56` (`useOrders(false, true)`) e `CheckoutView.tsx:88` (`useOrders(false, true)`) rodam o sync mesmo desabilitados, e no ramo `synced` chamam `loadOrders`/`fetchUserOrders` que retornam vazio por causa do proprio `enabled`. Opcionalmente somar `if (!isLeader) return;` para evitar tambem a corrida entre abas — mas isso e complementar, nao substitui o item 1.

Observacao: `src/hooks/useProducts.ts:71-128` tem o mesmo padrao de reenfileiramento incondicional e merece o mesmo tratamento.

---

### 44. 🟡 marketplace_orders nao e adicionada a publicacao supabase_realtime em nenhuma migration

`supabase/migrations/20260708020000_enable_realtime_for_monitored_tables.sql:5` · **media** · malfuncionamento · _Pedidos: criacao, status, historico e admin_

**Problema.** Todo o dominio de pedidos depende de `postgres_changes` na tabela `marketplace_orders` (canal do useOrders, badge de pendentes do AdminLayout, toasts de novo pedido, highlight de INSERT/UPDATE nos cards). Porem a unica migration que registra tabelas na publicacao lista produtos, categorias, banners, store_config, coupons, product_variants, questions e answers - e as migrations avulsas cobrem reviews, cart_items e favorites. Nenhuma inclui marketplace_orders, ou seja, o realtime de pedidos so funciona se alguem tiver habilitado manualmente pelo dashboard.

**Reproduzir.** Ao recriar o banco a partir das migrations (ambiente novo, staging ou reset), o canal 'admin_order_updates' assina com sucesso (status SUBSCRIBED) mas nunca recebe eventos. O admin fica com o selo 'Operacoes ao Vivo' verde, nao recebe o toast 'Novo pedido recebido!', o badge de pedidos pendentes na sidebar nao incrementa e o cliente na tela de detalhes nunca ve a mudanca de status - sem nenhum erro em log.

```
tables_to_add TEXT[] := ARRAY['produtos', 'categorias', 'banners', 'store_config', 'coupons', 'product_variants', 'questions', 'answers'];
```

**Correção.**

Criar supabase/migrations/20260715000000_enable_realtime_for_orders.sql seguindo exatamente o mesmo padrao de guard das migrations irmas (ver 20260708030000_enable_realtime_for_reviews.sql):

-- Enable Realtime replication for orders (and notifications) tables
DO $$
DECLARE
    t TEXT;
    tables_to_add TEXT[] := ARRAY['marketplace_orders', 'notificacoes'];
BEGIN
    FOREACH t IN ARRAY tables_to_add LOOP
        IF NOT EXISTS (
            SELECT 1
            FROM pg_publication_tables
            WHERE pubname = 'supabase_realtime'
              AND schemaname = 'public'
              AND tablename = t
        ) THEN
            EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I', t);
        END IF;
    END LOOP;
END $$;

Sobre REPLICA IDENTITY FULL, a proposta original esta exagerada e deve ser ajustada: NAO e necessaria para o codigo como esta escrito. O unico consumidor de DELETE e handleRealtimeDelete (useOrders.ts:357-371), acionado em useOrders.ts:426-428 com `const oldId = (payload.old as any)?.id` — e o `id` (PK) ja vem no `old` com a replica identity DEFAULT. FULL so passa a ser necessaria se DELETE precisar chegar aos assinantes NAO-admin, porque esses canais usam `filter: user_id=eq.${user.id}` (useOrders.ts:457 e :946) e o Realtime nao consegue avaliar filtro/RLS sobre user_id num DELETE que so traz a PK. Como isso tem custo (aumenta volume de WAL e coloca a linha antiga inteira do pedido, com PII, no payload) e pedidos praticamente nao sao deletados neste app, a recomendacao e: aplicar apenas o ALTER PUBLICATION acima e deixar REPLICA IDENTITY FULL de fora, ou aplica-la somente se surgir requisito real de propagar DELETE para o cliente.

Complementos que tornam a correcao durvel:
1. Como o schema base nao esta versionado (scratch/ esta no .gitignore), incluir a chamada de habilitacao de realtime tambem no script de provisionamento scratch/apply_ddl_and_migrations.py, ou promover o DDL base para supabase/migrations/ para que o repo passe a ser fonte unica de verdade.
2. Adicionar uma assercao em supabase/tests/database_verification_test.sql conferindo que marketplace_orders, notificacoes, produtos, categorias, banners, store_config, coupons, product_variants, questions, answers, reviews, cart_items e favorites estao todas em pg_publication_tables para pubname='supabase_realtime' — a falha hoje e silenciosa (o canal vai a SUBSCRIBED e simplesmente nunca recebe evento), entao so um teste explicito a detecta.

---

### 45. 🟡 Scroll infinito da Home volta para 12 itens a cada sincronização em tempo real

`src/components/ui/custom/ProductList.tsx:38` · **media** · bug · _Catalogo, produto, busca e comparacao_

**Problema.** O `visibleCount` é resetado sempre que a REFERÊNCIA do array `products` muda, não apenas quando o filtro muda. O array chega da Home via `useMemo` que depende de `products` do StoreContext, e o StoreContext troca a referência a cada evento do RealtimeSyncEngine (`useSyncListener(['products'])` faz `setProducts(freshProducts)` com um array novo lido do IndexedDB, sem comparação). Qualquer alteração de qualquer produto na loja (uma venda que decrementa estoque, um ajuste do admin) reinicia a paginação de quem está navegando.

**Reproduzir.** 1) Cliente rola a Home e carrega 60 produtos via scroll infinito. 2) Outro cliente finaliza uma compra e o estoque de um produto qualquer muda; o RealtimeSyncEngine dispara o evento 'products'. 3) StoreContext chama `setProducts` com novo array; a Home recalcula `filteredProducts` (nova referência). 4) O efeito dispara `setVisibleCount(12)`: a grade encolhe de 60 para 12 cards, o conteúdo abaixo do usuário some e a página dá um salto brusco de scroll. O cliente precisa rolar tudo de novo.

```
useEffect(() => {
    setVisibleCount(12);
  }, [products]);
```

**Correção.**

Manter o reset de paginação apenas quando os CRITÉRIOS de listagem mudarem, e não a cada nova referência de array.

1) Em src/components/ui/custom/ProductList.tsx, adicionar uma prop opcional `resetKey` na interface `ProductListProps` (linhas 10-19) e trocar o efeito das linhas 36-38 por:

   useEffect(() => {
     setVisibleCount(12);
   }, [resetKey]);

   Como HomeView.tsx:497 é hoje o ÚNICO consumidor de ProductList (confirmado por grep em src/), a mudança é de baixo risco. Para não regredir caso a prop não seja passada, use um fallback estável em vez da referência, por exemplo `const listSignature = resetKey ?? `${products.length}:${products[0]?.id ?? ""}`;` e dependa de `listSignature`. Evite usar `length + primeiro id` como solução principal, pois duas categorias podem coincidir em tamanho e primeiro item.

2) Em src/views/customer/HomeView.tsx:497-506, passar o critério real de filtragem, que já está em escopo (é a própria dependência do useMemo da linha 166):

   <ProductList
     products={filteredProducts}
     resetKey={`${selectedCategory}|${searchQuery}|${sortBy}`}
     ...
   />

3) Correção complementar (reduz re-renders inúteis em toda a árvore, não só a paginação): aplicar no listener de realtime do StoreContext (src/contexts/StoreContext.tsx:566-578) a mesma guarda de igualdade já usada em `fetchProducts` (linha 421), preservando a referência anterior quando o conteúdo não mudou:

   setProducts((prev) =>
     JSON.stringify(prev) === JSON.stringify(freshProducts) ? prev : freshProducts,
   );

   Isso sozinho NÃO resolve o bug (uma venda real muda o estoque e o conteúdo de fato difere), por isso o item 1 é obrigatório; o item 3 apenas elimina os resets causados por eventos sem mudança efetiva, como os do catchUp em `visibilitychange`.

4) Opcional, para o caso de mudança legítima de conteúdo: além de não resetar, clampar o valor para não exceder a lista atual, com `setVisibleCount((prev) => Math.min(prev, Math.max(12, products.length)))` quando `products.length` diminuir, mantendo assim a posição de rolagem do usuário.

---

### 46. 🟡 Busca não normaliza acentuação: produtos com acento não são encontrados

`src/hooks/useSearch.ts:26` · **media** · ux · _Catalogo, produto, busca e comparacao_

**Problema.** Toda a stack de busca (useSearch, SearchBar e o filtro da HomeView) usa `includes`/`startsWith` apenas com `toLowerCase()`, sem remover diacríticos. Em um catálogo brasileiro (Aliança, Coração, Colar de Berílio, Anéis) o cliente que digita sem acento - o comportamento padrão em teclado de celular com pressa - não encontra nada. O próprio projeto já tem a técnica de normalização em `useCategories.generateSlug` (`normalize('NFD').replace(/[̀-ͯ]/g, '')`), mas ela não foi aplicada na busca.

**Reproduzir.** 1) Loja tem o produto 'Aliança Luxo Coração'. 2) Cliente digita 'alianca' na barra de busca. 3) `'aliança luxo coração'.includes('alianca')` é falso, `startsWith` também. 4) O dropdown mostra 'Nenhum produto encontrado para "alianca"' e a SearchView mostra o estado vazio, mesmo com o produto ativo e em estoque.

```
const matchesQuery =
          productName.includes(searchQuery) ||
          productDesc.includes(searchQuery);
```

**Correção.**

Criar um helper compartilhado e aplica-lo nos dois lados da comparacao (termo e campo), em todos os pontos da stack de busca do cliente.

1. Em `src/lib/utils.ts` (onde ja vivem `cn`, `formatCurrency`, `getAvatarGradient`), adicionar:
```ts
export const normalizeText = (value: string | null | undefined) =>
  (value ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .trim();
```
(mesma tecnica ja usada em `src/hooks/useCategories.ts:118-125`).

2. `src/hooks/useSearch.ts` linhas 22-32: trocar por
```ts
const productName = normalizeText(product.name);
const productDesc = normalizeText(product.description);
const searchQuery = normalizeText(debouncedQuery);
const matchesQuery =
  !searchQuery ||
  productName.includes(searchQuery) ||
  productDesc.includes(searchQuery);
const matchesCategory =
  category === "Todas" ||
  normalizeText(product.category) === normalizeText(category);
```
O `!searchQuery` evita que espaco em branco puro vire filtro, e o `trim()` embutido corrige o caso "anel " que hoje zera resultados.

3. `src/components/ui/custom/SearchBar.tsx`: aplicar `normalizeText` nos tres memos, comparando normalizado contra normalizado mas preservando o texto original para exibicao/sugestao:
- `predictedTerms` (linha 108): `const query = normalizeText(deferredLocalValue);`; linha 121 vira `normalizeText(clean).startsWith(query)`; linha 131 vira `normalizeText(p.category).startsWith(query)`; linha 137 vira `normalizeText(t).startsWith(query)`. Importante: continuar inserindo no `termSet` o texto ORIGINAL com acento (`clean`, `p.category`, `t`), para a sugestao clicada preencher o campo corretamente.
- `matchingCategories` (linhas 148/153): `const query = normalizeText(deferredLocalValue);` e `normalizeText(p.category).includes(query)`.
- `searchResults` (linhas 163-195): `const query = normalizeText(deferredLocalValue);` e trocar `name`/`description`/`category`/`tags` por versoes normalizadas (`normalizeText(product.name)`, `normalizeText(product.description)`, `normalizeText(product.category)`, `(product.tags || []).map(normalizeText)`). Note que `product.description.toLowerCase()` na linha 171 hoje quebra se `description` vier null — `normalizeText` ja cobre isso com o `?? ""`.

4. `src/views/customer/HomeView.tsx` linhas 129-137:
```ts
const query = normalizeText(searchQuery);
if (query) {
  result = result.filter(
    (p) =>
      normalizeText(p.name).includes(query) ||
      normalizeText(p.description).includes(query) ||
      normalizeText(p.category).includes(query),
  );
}
```

5. Opcional, para coerencia com o […]

---

### 47. 🟡 RealtimeSyncEngine pode nunca iniciar porque o efeito depende de um ref (vaultRef.current)

`src/contexts/StoreContext.tsx:527` · **media** · bug · _Realtime, cache offline e sincronizacao_

**Problema.** O efeito que sobe o engine tem guarda 'if (!isLoaded || !vaultRef.current) return;' mas suas dependencias sao [isLoaded, isLeader, isAdmin]. vaultRef e um ref: atribui-lo depois nao re-dispara o efeito. isLoaded tambem e setado no finally de fetchConfig (linha 373), que corre em paralelo com o DataVault.init(). Se a abertura do IndexedDB demorar (retry com backoff de 250/500/1000ms, banco 'blocked' por outra aba) ou falhar, isLoaded vira true com vaultRef.current ainda null, o efeito sai pelo return e nunca mais roda numa aba secundaria (isLeader fica false para sempre e isAdmin nao muda). Alem disso, o bloco catch (linhas 114-144) trata a falha do vault mas nunca atribui vaultRef.current, entao todos os '?.put/replaceAll' viram no-op silencioso e o engine nunca sobe.

**Reproduzir.** Usuario abre uma segunda aba da loja enquanto a primeira ainda segura a conexao IDB. Na aba 2, DataVault.init() cai em onblocked e faz retry; a resposta de v_store_config chega antes e seta isLoaded=true. O efeito de realtime roda uma unica vez com vaultRef.current=null e desiste. Essa aba fica sem canal realtime e sem listener de BroadcastChannel pelo resto da sessao: preco alterado pelo admin nunca aparece, produto esgotado continua comprando.

```
useEffect(() => {
    if (!isLoaded || !vaultRef.current) return;
```

**Correção.**

Duas correções em src/contexts/StoreContext.tsx (mantendo o ref, que é usado dentro de updaters de setState nas linhas 342, 363, 423, 499 e no useSyncListener da linha 570):

1) Adicionar um flag de estado que entre nas dependências do efeito:
   const vaultRef = useRef<DataVault | null>(null);
   const [vaultReady, setVaultReady] = useState(false);

   No efeito de montagem (linha 77-78):
     const vault = await DataVault.init();
     vaultRef.current = vault;
     if (!cancelled) setVaultReady(true);

   E no efeito do engine (linha 526-541):
     useEffect(() => {
       if (!isLoaded || !vaultReady || !vaultRef.current) return;
       const cleanup = RealtimeSyncEngine.start(vaultRef.current, isLeader, isAdmin);
       return () => { cleanup(); };
     }, [isLoaded, vaultReady, isLeader, isAdmin]);

2) No bloco catch (linhas 119-134), guardar a instância recuperada — hoje ela é descartada:
     const vault = vaultRef.current || (await DataVault.init());
     if (vault) {
       vaultRef.current = vault;          // <— faltando hoje
       if (!cancelled) setVaultReady(true);
       const stores: StoreName[] = [...];
       await Promise.all(stores.map((s) => vault.clear(s).catch(() => {})));
     }

Observação: o item 2 é o que realmente elimina o modo de falha permanente (no-op silencioso de todos os puts no IndexedDB). O item 1 fecha a janela de corrida entre o finally de fetchConfig (linha 373) e o término do DataVault.init(). Para o caso em que o IndexedDB é definitivamente indisponível (modo privado), nenhum dos dois resolve — ali seria preciso um vault em memória, já que RealtimeSyncEngine.start exige uma instância de DataVault; se não quiser esse fallback, ao menos registre um aviso explícito de que o app ficará sem Realtime.

---

### 48. 🟡 catchUp apaga produtos locais e faz o refetch em lote ignorando erro e sem dividir o .in()

`src/lib/realtimeSyncEngine.ts:805` · **media** · bug · _Realtime, cache offline e sincronizacao_

**Problema.** Na reconciliacao, o engine primeiro deleta do IndexedDB todos os produtos que nao aparecem no summary (linhas 759-776) e so depois busca os desatualizados com .in('id', outOfDateIds). Essa chamada nao tem chunking (o array pode ter centenas de UUIDs, estourando o limite de tamanho da URL/header do PostgREST) e o resultado e desestruturado como 'const { data: rawProducts }' sem checar error. Qualquer falha (414 URI too long, timeout, RLS) deixa rawProducts null e a funcao segue como se tivesse dado certo, imprimindo 'CatchUp complete'. Como o StoreContext so cacheia 200 produtos (fetchProducts usa .limit(200) + replaceAll) enquanto o summary do catchUp nao tem limite, em catalogos maiores praticamente todos os produtos entram em outOfDateIds a cada catchUp.

**Reproduzir.** Loja com 400 produtos. Usuario volta para a aba (visibilitychange dispara catchUp). O summary traz 400 ids, o cache local tem 200, outOfDateIds fica com ~200 UUIDs (~7,5 KB de query string). O PostgREST rejeita a requisicao, o erro e descartado, e o IndexedDB fica so com os produtos que sobreviveram a etapa de delete. O cliente offline em seguida ve o catalogo incompleto sem nenhuma mensagem de erro.

```
if (outOfDateIds.length > 0) {
          const { data: rawProducts } = await supabase
            .from(isAdmin ? "produtos" : ("vw_produtos_public" as any))
            .select("*, product_variants(*)")
            .in("id", outOfDateIds);
```

**Correção.**

Em src/lib/realtimeSyncEngine.ts, no bloco das linhas 804-850 (mantendo as deleções das linhas 756-780 intactas, pois estão corretas):

1. Fatiar `outOfDateIds` em blocos e checar o erro de cada bloco, seguindo o padrão de log já usado nas linhas 612-641:

```ts
if (outOfDateIds.length > 0) {
  const CHUNK = 50;
  const rawProducts: any[] = [];
  let refetchFailed = false;

  for (let i = 0; i < outOfDateIds.length; i += CHUNK) {
    const slice = outOfDateIds.slice(i, i + CHUNK);
    const { data, error } = await supabase
      .from(isAdmin ? "produtos" : ("vw_produtos_public" as any))
      .select("*, product_variants(*)")
      .in("id", slice);

    if (error) {
      refetchFailed = true;
      console.warn(
        "[RealtimeSyncEngine] product refetch chunk failed:",
        { offset: i, size: slice.length },
        error,
      );
      continue; // os demais blocos ainda valem a pena
    }
    if (data) rawProducts.push(...data);
  }

  if (rawProducts.length > 0) {
    // ...bloco existente das linhas 811-848 (mapProductFromDB, putMany,
    // setLastSync, variants, bc?.postMessage, _listeners) sem alteração...
  }

  if (refetchFailed) {
    console.warn(
      "[RealtimeSyncEngine] ⚠️ CatchUp incompleto: cache de produtos pode estar desatualizado.",
    );
  }
}
```

2. Trocar a linha 852 por um log condicional, para não anunciar "✅ CatchUp complete." quando houve falha (usar uma flag acumulada no escopo do `try`).

3. Alinhar os limites, que é a causa raiz da lista inflada. Escolher uma das duas:
   - preferível: elevar/remover o `.limit(200)` em src/contexts/StoreContext.tsx linhas 391 e 402, alinhando com o `.limit(500)` já usado em src/hooks/useDataVault.ts:61 (hydrateAllStores), para o `replaceAll` da linha 424 não truncar o cache a cada recarga; ou
   - aplicar o mesmo `.limit(500)` na query de summary do catchUp (linhas 581-583) e adotar paginação explícita, para que summary e cache falem do mesmo conjunto.

4. Endurecer a guarda da linha 750 para impedir que um summary vazio limpe o cache inteiro:
```ts
if (Array.isArray(serverProductsSummary) && serverProductsSummary.length > 0) {
```
(ou, no mínimo, só executar o loop de deleção das linhas 759-776 quando `serverSummary.length > 0`).

---

### 49. 🟡 Produto excluido (soft delete) ou desativado volta para o cache atraves do evento UPDATE

`src/lib/realtimeSyncEngine.ts:433` · **media** · bug · _Realtime, cache offline e sincronizacao_

**Problema.** A exclusao de produto em useProducts e um soft delete: UPDATE em produtos com deleted_at e ativo=false (src/hooks/useProducts.ts:764-772). O handler de INSERT/UPDATE do engine grava qualquer linha recebida no store 'products' sem olhar deleted_at nem ativo, e em seguida notifica os listeners; o useSyncListener do StoreContext rele todo o store e joga o produto de volta em products. So o proximo catchUp (que filtra .is('deleted_at', null)) remove o registro.

**Reproduzir.** Admin clica em excluir um produto na area administrativa. A lista some por causa do update otimista, mas o evento realtime do proprio UPDATE chega logo depois, o engine faz vault.put('products', produtoExcluido) e o StoreContext rele o vault: o produto reaparece na home e nos carrosseis (com estoque e preco), e continua clicavel ate o proximo catchUp ou reload.

```
if (raw?.id) {
            const mapped = config.mapRecord ? config.mapRecord(raw) : raw;
            await vault.put(config.store, mapped);
            await vault.setLastSync(config.store);
```

**Correção.**

Corrigir em src/lib/realtimeSyncEngine.ts, dentro de _applyChangeAndNotify, no case "INSERT"/"UPDATE", ANTES do vault.put da linha 435 — e chavear apenas por deleted_at, nao por ativo:

case "INSERT":
case "UPDATE": {
  if (raw?.id) {
    // Soft delete chega como UPDATE: tratar como remocao logica
    if (config.store === "products" && raw.deleted_at != null) {
      await vault.deleteById("products", raw.id);
      const productVariants = await vault.getByIndex<any>(
        "product_variants", "by_product_id", raw.id,
      );
      for (const v of productVariants) {
        await vault.deleteById("product_variants", v.id);
      }
      await vault.setLastSync("products");
      await vault.setLastSync("product_variants");
      const delEvent: SyncEvent = {
        table: config.table, store: "products",
        eventType: "DELETE", oldRecord: { id: raw.id },
      };
      for (const cb of _listeners) {
        try { cb(delEvent); } catch (e) { console.error("[RealtimeSyncEngine] Listener error:", e); }
      }
      return; // nao cair no notify padrao das linhas 551-565
    }
    const mapped = config.mapRecord ? config.mapRecord(raw) : raw;
    ...
  }
}

Pontos importantes que divergem da correcao originalmente proposta:

1. NAO usar 'raw.ativo === false' como criterio de delecao. Por causa da RLS (produtos_select_policy: ativo = true OR is_admin), o unico cliente que recebe um evento com ativo=false e o admin — e para o admin o produto pausado deve continuar no cache: vw_produtos_admin nao filtra ativo e a AdminProductsView depende disso para exibir os estados "Pausar Produto"/"Offline" (AdminProductsView.tsx:1396-1448). Excluir do vault por ativo=false quebraria o fluxo de pausar produto. O gatilho correto e apenas deleted_at != null.

2. A cascata de variantes precisa ser explicita (espelhando o catchUp, realtimeSyncEngine.ts:762-769), porque o case "DELETE" atual (linha 496) so faz vault.deleteById do proprio registro e nao remove as variantes do produto.

3. O 'return' antecipado e necessario: sem ele, o bloco de notificacao das linhas 551-565 emitiria um SyncEvent com eventType "UPDATE" e newRecord: raw (o registro excluido), o que confundiria listeners que leem event.newRecord.

4. Defesa em profundidade recomendada no consumidor: em StoreContext.tsx:566-578 o listener faz getAll e setProducts sem filtro. Como as views de cliente nao filtram isActive (HomeView.tsx:115-201), vale filtrar ali quando !isAdmin, por exemplo setProducts(isAdmin ? freshProducts : freshProducts.filter(p => p.isActive)). Isso tambem cobre o caso vizinho de […]

---

### 50. 🟡 Conexao do DataVault fechada por onversionchange continua sendo usada e leituras passam a devolver lista vazia

`src/lib/dataVault.ts:129` · **media** · bug · _Realtime, cache offline e sincronizacao_

**Problema.** Quando outra aba sobe a versao do IndexedDB, o handler fecha o db e zera o singleton, mas todas as referencias ja distribuidas (vaultRef do StoreContext, useBanners, useCategories e o vault capturado pelo RealtimeSyncEngine) continuam apontando para a MESMA instancia com a conexao fechada. A partir dai this.db.transaction(...) lanca InvalidStateError; em getAll/getById/getByIndex/count o erro e engolido no catch e a promise resolve com [] / undefined (linhas 231-235), ou seja, a UI passa a ver 'nao ha dados' em vez de um erro. Nas escritas (putMany/replaceAll) a promise rejeita e os call sites usam .catch(() => {}), entao nada mais e persistido.

**Reproduzir.** Usuario tem a loja aberta em duas abas e um deploy sobe DATA_VAULT_VERSION. A aba nova roda a migracao, a aba antiga recebe onversionchange e fecha a conexao. Na aba antiga, o proximo evento realtime dispara o listener que faz getAll('products') -> catch -> resolve([]) -> setProducts nao atualiza (guarda length>0) mas useBanners/useCategories tambem param de receber dados e nada mais e gravado offline. Nenhum aviso e mostrado; o app segue exibindo dados congelados ate um reload manual.

```
db.onversionchange = () => {
            db.close();
            _instance = null;
            _initPromise = null;
```

**Correção.**

Corrigir em src/lib/dataVault.ts, tornando a instancia auto-curavel em vez de morta:

1) Marcar e reabrir sob demanda. Hoje `db.onversionchange` (linha 129) e registrado ANTES de `_instance = new DataVault(db)` (linha 151), entao nao ha como marcar a instancia. Inverter a ordem: criar a instancia primeiro e so depois registrar o handler, setando um flag nela:

   const instance = new DataVault(db);
   db.onversionchange = () => { db.close(); instance.markClosed(); _instance = null; _initPromise = null; console.warn(...); };
   _instance = instance;

2) Adicionar `private closed = false`, `markClosed() { this.closed = true; }` e um `private async ensureDb(): Promise<void>` que, quando `this.closed`, chama `DataVault.init()` e faz `this.db = <nova conexao>; this.closed = false`. Prefixar TODOS os metodos de CRUD (getAll, getById, getByIndex, putMany, deleteById, clear, replaceAll, count) com `await this.ensureDb()` antes do `this.db.transaction(...)`. Isso cura de uma vez as referencias ja distribuidas em StoreContext.tsx:78, useBanners.ts:121, useCategories.ts:36, useDataVault.ts:212 e a capturada por RealtimeSyncEngine.start.

3) Parar de mascarar falha como "sem dados". Nos catch de getAll (231-235), getById (254-262), getByIndex (287-295) e count (431-434), so aplicar o default vazio quando o erro for realmente store inexistente (`err instanceof DOMException && err.name === "NotFoundError"`); para `InvalidStateError` e demais erros, chamar `reject(err)` para o chamador distinguir "vault indisponivel" de "lista vazia".

4) Tornar as falhas de escrita observaveis: trocar os `.catch(() => {})` de StoreContext.tsx:428 e :501, useBanners.ts:75 e useCategories.ts:27 por um catch que ao menos logue (`console.error("[<hook>] Falha ao persistir no DataVault:", err)`), para que a parada de persistencia offline nao seja invisivel.

5) Opcional, para o caso do purge multi-aba: no handler de versionchange, alem do close, avisar o usuario da aba secundaria (toast "App atualizado em outra aba — recarregue") ja que o caminho de origem e `indexedDB.deleteDatabase` em useUpdateCheck.ts:120, e apos ele o banco foi apagado — reabrir devolve stores vazias e a aba precisa re-hidratar do Supabase de qualquer forma.

---

### 51. 🟡 Listeners de sync ignoram resultado vazio: excluir o ultimo item nunca some da tela

`src/contexts/StoreContext.tsx:573` · **media** · malfuncionamento · _Realtime, cache offline e sincronizacao_

**Problema.** Os tres consumidores do useSyncListener releem o DataVault e so aplicam o resultado quando ele nao esta vazio: StoreContext (products, linha 573), useBanners (linha 611: 'if (fresh.length > 0)') e useCategories (linha 283: 'if (fresh.length > 0)'). Quando a delecao esvazia o store, o estado antigo permanece na tela. Como o proprio engine ja fez o delete no IndexedDB, o app fica exibindo dados que nao existem mais nem no servidor nem no cache.

**Reproduzir.** Loja tem um unico banner ativo. Admin exclui esse banner em outra aba (ou o proprio engine processa o DELETE). O vault fica com 0 banners, o listener rele, fresh.length === 0, o if barra o setBanners e o carrossel continua exibindo o banner apagado ate o usuario recarregar a pagina. O mesmo vale para a ultima categoria e para o ultimo produto do catalogo.

```
const freshProducts =
          await vaultRef.current.getAll<Product>("products");
        if (freshProducts.length > 0) {
          setProducts(freshProducts);
        }
```

**Correção.**

Correcao em tres partes (a proposta original, de "aplicar sempre", esta incompleta porque getAll resolve [] tambem em falha, e porque ignora os caches de modulo).

1) Desambiguar leitura vazia de leitura falha na fonte — src/lib/dataVault.ts:231-235. Trocar o "resolve([])" do catch por "reject(err)", para que [] passe a significar exclusivamente "store vazio":
   } catch (err) {
     console.error("[DataVault] getAll('%s') failed:", store, err);
     reject(err instanceof Error ? err : new Error(`getAll('${store}') failed`));
   }

2) Nos tres listeners, aplicar sempre o resultado e so ignorar quando a leitura lancar. Em src/contexts/StoreContext.tsx:568-577:
   useSyncListener(
     ["products"],
     useCallback(async () => {
       if (!vaultRef.current) return;
       try {
         const freshProducts = await vaultRef.current.getAll<Product>("products");
         setProducts(freshProducts);
       } catch (err) {
         console.error("[StoreContext] Falha ao reler products do vault:", err);
       }
     }, []),
   );
   Aplicar o mesmo padrao em src/hooks/useBanners.ts:606-616 (setBanners(fresh)) e src/hooks/useCategories.ts:278-288 (setCategories(fresh)).

3) Sincronizar os caches de modulo junto com o state, senao uma remontagem dentro do FETCH_THROTTLE de 60s traz o item excluido de volta. Em useBanners.ts, dentro do listener e tambem em deleteBanner (que hoje atualiza so o state na linha 596): "globalBannersCache = fresh;" (e "globalBannersCache = updated;" no delete). Em useCategories.ts, "globalCategoriesCache = fresh;" no listener e nas mutacoes otimistas.

Opcional, mais robusto: como o SyncEvent ja carrega eventType e oldRecord, os listeners poderiam aplicar o delta direto (remover event.oldRecord.id do state no DELETE, fazer upsert de event.newRecord no INSERT/UPDATE) em vez de reler o vault inteiro — elimina de vez a ambiguidade do array vazio e evita um getAll a cada evento.

---

### 52. 🟡 SW cacheia cada /version.json?t=<timestamp> como entrada nova: cache cresce sem limite

`src/sw/sw.ts:180` · **media** · performance · _PWA, service worker, atualizacao e push_

**Problema.** O ramo stale-while-revalidate grava no cache `app-cache-<versao>` qualquer resposta 200 de mesma origem, e o cache de app nao tem nenhuma politica de limite (so o de imagens tem MAX_IMAGE_ENTRIES). O useUpdateCheck busca a versao do servidor com URL unica: `fetch(`/version.json?t=${Date.now()}`)` (useUpdateCheck.ts:24), a cada 3 minutos e a cada visibilitychange. Cada chamada cria uma chave distinta no Cache Storage que nunca sera reutilizada nem removida ate a proxima troca de versao do SW.

**Reproduzir.** 1) Cliente deixa o PWA aberto/alternando de aba durante o dia. 2) A cada 3 min (e a cada volta de foco) o app busca /version.json?t=1770000000123. 3) O SW guarda cada uma dessas URLs unicas no cache. 4) Em poucos dias sao milhares de entradas inuteis; quando a quota do dispositivo estoura, os `cache.put` passam a falhar silenciosamente e assets legitimos deixam de ser cacheados — o app passa a abrir lento e para de funcionar offline.

```
if (networkResponse?.status === 200) {
            try {
              // Robust cache update: only cache valid, successful responses
              const responseToCache = networkResponse.clone();
              if (
                responseToCache?.status === 200 &&
                (responseToCache.type === "basic" ||
                  responseToCache.type === "cors")
              ) {
                caches.open(CACHE_NAME).then((cache) => {
                  cache.put(event.request, responseToCache);
                });
```

**Correção.**

Ordem de aplicação importa: o guard no Service Worker é OBRIGATÓRIO e deve vir primeiro. Aplicar apenas a mudança do cliente introduz bug pior (leitura de versão obsoleta).

1) src/sw/sw.ts — logo após o check de método GET (linha 81), antes de qualquer ramo de resposta, adicionar early-return para o metadado de controle de versão. Um `return` puro (sem `respondWith`) deixa o browser fazer o fetch nativo, sem passar pelo Cache Storage:

  if (event.request.method !== "GET") return;

  // Metadado de controle de versão: URL única por chamada (?t=timestamp).
  // Nunca deve entrar no Cache Storage — jamais é reutilizada e cresce sem limite.
  if (url.pathname === "/version.json") return;

2) src/sw/sw.ts — defesa em profundidade no ramo SWR. Dentro do `if (responseToCache?.status === 200 && (type basic|cors))` (linhas 176-183), impedir a gravação de qualquer GET de mesma origem que carregue query string, já que os assets do Vite são versionados por hash no nome do arquivo e nunca dependem de `?`:

  if (
    responseToCache?.status === 200 &&
    (responseToCache.type === "basic" || responseToCache.type === "cors") &&
    !(responseToCache.type === "basic" && url.search)
  ) {
    caches.open(CACHE_NAME).then((cache) => {
      cache.put(event.request, responseToCache).catch((err) =>
        console.warn("[SW] cache.put failed (quota?):", event.request.url, err),
      );
    });
  }

Observe que o `.catch()` no `cache.put` também corrige um problema secundário real: hoje (sw.ts:180-182) a promise não tem tratamento, então um QuotaExceededError vira unhandled rejection dentro do SW.

3) src/hooks/useUpdateCheck.ts:24 — só DEPOIS do passo 1, remover o cache-busting por query e usar a diretiva HTTP correta, que agora é suficiente porque o SW não intercepta mais essa rota:

  const response = await fetch("/version.json", { cache: "no-store" });

4) index.html:62 — o bloco `speculationrules` faz prefetch eager de `["/version.json"]`. Com o código atual esse prefetch é inútil (o app só pede `/version.json?t=...`, nunca a URL nua). Após o passo 3 ele volta a fazer sentido, mas como o objetivo é justamente obter a versão FRESCA do servidor, o prefetch especulativo entra em conflito com o `no-store`; o mais coerente é remover `/version.json` da lista de prefetch e manter apenas `/?source=pwa`.

5) Higiene opcional, mas recomendada dado o histórico: o cache de app não tem NENHUM teto (só imagens têm MAX_IMAGE_ENTRIES, sw.ts:19). Vale adicionar no handler `activate` uma poda do CACHE_NAME atual removendo entradas cujo `key.url` contenha query string, para limpar o […]

---

### 53. 🟡 Nuclear purge apaga SW, caches e IndexedDB sem checar conexao e deixa o app inutilizavel offline

`src/hooks/useUpdateCheck.ts:157` · **media** · bug · _PWA, service worker, atualizacao e push_

**Problema.** performNuclearPurge desregistra todos os service workers, apaga todos os caches, deleta o banco ikcous-datavault e forca `window.location.href` para uma URL nova. Nao ha nenhuma verificacao de navigator.onLine antes de destruir tudo, e ele e disparado automaticamente pelo handler de ChunkLoadError (linha 312), que costuma ser acionado justamente em rede instavel. Depois da purga nao existe mais SW nem cache para servir a aplicacao offline.

**Reproduzir.** 1) Cliente esta no metro/area com sinal ruim e um chunk falha ao carregar. 2) O handler de erro detecta ChunkLoadError e chama performNuclearPurge(true). 3) SW desregistrado, todos os caches apagados, DataVault deletado. 4) O `window.location.href` para /?forceUpdate=... nao consegue baixar nada porque nao ha rede. 5) O cliente fica com a tela de 'sem conexao' do navegador e perdeu tambem todo o conteudo offline que tinha (produtos, banners), ate voltar a ter internet.

```
// 5. Hard reload
      window.location.href = `${window.location.origin}/?forceUpdate=${Date.now()}`;
```

**Correção.**

Corrigir em `src/hooks/useUpdateCheck.ts` (o problema é a purga sem guarda; o caminho a blindar prioritariamente é `checkMandatoryUpdate` → linha 238, não o handler de chunk):

1. Guarda de conectividade dentro de `performNuclearPurge`, antes de `doPurge` (linha 91): se `typeof navigator !== "undefined" && !navigator.onLine`, NÃO purgar. Em vez disso: `localStorage.setItem("pwa_pending_purge", "1")`, `toast.error("Sem conexão", { description: "A atualização será aplicada quando a internet voltar." })` e registrar um listener one-shot `window.addEventListener("online", retry, { once: true })` que reexecuta a purga. Como `navigator.onLine` só indica interface de rede, reforçar com uma verificação real reaproveitando o helper já existente no arquivo: `const ver = await fetchServerVersion(); if (!ver) return;` — se `/version.json` não responde, abortar a purga (hoje `fetchServerVersion` já retorna `null` em falha, linhas 21-33).

2. No boot, se `localStorage.getItem("pwa_pending_purge") === "1"` e houver rede, disparar a purga e limpar a flag.

3. Adicionar guarda de loop ao caminho obrigatório, que hoje não tem nenhuma (o handler de chunk tem, linhas 290-300): antes do `performNuclearPurge(true)` da linha 238, checar `sessionStorage.getItem("pwa_mandatory_purge_at")` e abortar se a última purga foi há menos de ~60s, exibindo toast de erro persistente em vez de purgar de novo.

4. Trocar a comparação `config.minAppVersion !== SAFE_APP_VERSION` (linha 223) por comparação ordenada de versão (purgar apenas quando o build local for MENOR que `minAppVersion`), evitando purgar clientes que já estão numa versão mais nova que a mínima registrada no banco.

5. Preservar o IndexedDB na purga por erro de chunk (linha 312) e, quando de fato for necessário apagá-lo na purga obrigatória, fazer direito: fechar antes a conexão do DataVault (`vaultRef` em `src/contexts/StoreContext.tsx:77-78` precisa expor um `close()`), envolver `indexedDB.deleteDatabase("ikcous-datavault")` numa Promise com `onsuccess`/`onerror`/`onblocked` e `await`-la antes da linha 157 — hoje a navegação acontece antes e o delete costuma ficar bloqueado.

6. Usar `window.location.replace(...)` em vez de `window.location.href = ...` na linha 157, para não empilhar entradas `?forceUpdate=` no histórico caso a purga se repita.

---

### 54. 🟡 globalBannersCache nunca e atualizado apos criar/editar/excluir: Home exibe lista antiga

`src/hooks/useBanners.ts:64` · **media** · malfuncionamento · _Admin: banners, carrosseis/vitrines e editor de imagem_

**Problema.** O cache de modulo globalBannersCache so e escrito dentro de fetchBanners. addBanner, updateBanner, deleteBanner e reorderBanners atualizam apenas o state local e o DataVault. Como toda nova instancia do hook inicializa o state com globalBannersCache e marca isLoaded=true, e o efeito de mount so le o vault quando !globalBannersCache, uma tela recem-montada recebe a lista desatualizada e nem consulta o IndexedDB, que tem o dado correto. O refetch de rede so acontece se passaram mais de 60s (FETCH_THROTTLE).

**Reproduzir.** 1) Admin abre o app (fetchBanners popula globalBannersCache e lastBannersFetchTime). 2) Cria um banner novo em AdminBannersView; a lista do admin atualiza (state local) e o DataVault e gravado, mas globalBannersCache continua com a lista antiga. 3) Menos de 60 segundos depois o admin navega para a Home do cliente; HomeView monta useBanners(), que inicializa com globalBannersCache (lista antiga) e isLoaded=true, e o efeito cai no ramo do throttle sem refazer o fetch. 4) O banner recem-criado nao aparece na Home; o mesmo vale ao contrario para um banner excluido, que continua sendo exibido.

```
const [banners, setBanners] = useState<Banner[]>(globalBannersCache || []);
  const [isLoaded, setIsLoaded] = useState(!!globalBannersCache);

  // ... (linhas 122-123, no efeito de mount)
        if (!globalBannersCache) {
          const cached = await vault.getAll<Banner>("banners");
```

**Correção.**

Fazer o cache de modulo acompanhar toda mudanca de lista, e nao so o fetch de rede. Correcao minima e cirurgica em src/hooks/useBanners.ts:

1) Escrever o cache dentro do helper que ja e chamado por TODAS as mutacoes (linhas 69-76), de forma sincrona antes da gravacao assincrona no IndexedDB:
   const persistToVault = useCallback((items: Banner[]) => {
     globalBannersCache = items;            // <— novo
     vaultRef.current?.replaceAll("banners", items).then(() => { vaultRef.current?.setLastSync("banners"); }).catch(() => {});
   }, []);
   Isso cobre addBanner (:363), updateBanner (:403 e o rollback :478), reorderBanners (:554 e o rollback :566) e deleteBanner (:595) sem tocar em cada uma.

2) Atualizar o cache tambem no callback do useSyncListener (:608-615), que hoje so chama setBanners:
     const fresh = await vaultRef.current.getAll<Banner>("banners");
     if (fresh.length > 0) { globalBannersCache = fresh; setBanners(fresh); }

3) Invalidar o throttle apos mutacao local para que a proxima instancia revalide contra o servidor: adicionar "lastBannersFetchTime = 0;" junto do passo 1 (ou apenas em addBanner/deleteBanner/updateBanner), fazendo o ramo :236 disparar fetchBanners no proximo mount.

4) Recomendado (tira a classe inteira do bug): tornar o efeito de mount tolerante a cache defasado — no lugar de "if (!globalBannersCache)" (:122), ler sempre o vault e adotar o resultado quando ele for nao-vazio e diferente do cache, ou trocar o par (globalBannersCache + useState) por um store compartilhado com useSyncExternalStore/subscribe, de modo que todas as instancias de useBanners leiam a mesma fonte.

Atencao ao rollback de updateBanner/reorderBanners: como o passo 1 grava o cache tambem no caminho de erro (previousBanners), o cache volta ao estado correto pre-otimista — comportamento desejado.

---

### 55. 🟡 reorderBanners muta objetos do state React e o rollback previousBanners nao restaura nada

`src/hooks/useBanners.ts:518` · **media** · bug · _Admin: banners, carrosseis/vitrines e editor de imagem_

**Problema.** Na normalizacao de colisao de ordem, o codigo faz b.order = idx + 1 diretamente sobre os objetos retornados por banners.filter(), que sao as MESMAS referencias guardadas no state. Isso muta o state fora do React (sem re-render) e, como previousBanners = [...banners] e uma copia rasa, o snapshot de rollback aponta para os objetos ja mutados. Alem disso, o erro do Promise.all e apenas logado no console, deixando a UI sem sinal de que a normalizacao falhou.

**Reproduzir.** 1) Uma posicao (ex. home_top) tem banners com valores de 'order' duplicados. 2) Admin clica na seta de subir/descer; hasOrderCollision e true e o bloco de normalizacao muta b.order de todos os banners daquela posicao no proprio state. 3) A chamada supabase.rpc('swap_banner_order') falha (offline intermitente, RLS, timeout). 4) O catch executa setBanners(previousBanners), mas previousBanners contem exatamente os mesmos objetos ja mutados, entao a ordem exibida NAO volta ao estado anterior. 5) O admin ve uma ordem no painel que nao corresponde ao banco, e o mesmo desalinhamento e persistido no DataVault via persistToVault(previousBanners).

```
const updates = sorted.map((b, idx) => {
          b.order = idx + 1;
          return supabase
            .from("banners")
            .update({ order: idx + 1 })
            .eq("id", b.id);
        });
        await Promise.all(updates);
      } catch (err) {
        console.error("[Banners] Collision normalization failed:", err);
      }
```

**Correção.**

Em src/hooks/useBanners.ts, dentro de reorderBanners:

1) Mover o snapshot para ANTES do bloco de colisao e clonar os itens, para o rollback nao depender de objetos que possam ser alterados: trocar `const previousBanners = [...banners];` (linha 531) por `const previousBanners = banners.map((b) => ({ ...b }));` posicionado logo apos a checagem `if (!activeBanner || !overBanner) return;` (linha 497).

2) Nunca mutar o state. Remover `b.order = idx + 1;` (linha 518) e montar as promessas apenas com o update remoto:
   const targets = sorted.map((b, idx) => ({ id: b.id, order: idx + 1 }));
   const results = await Promise.all(
     targets.map((t) => supabase.from("banners").update({ order: t.order }).eq("id", t.id))
   );

3) Checar de fato o erro (o `try/catch` atual nao pega nada, porque o supabase-js resolve com `{ error }` em vez de rejeitar):
   const failed = results.find((r) => r.error);
   if (failed) {
     console.error("[Banners] Collision normalization failed:", failed.error);
     toast.error("Nao foi possivel normalizar a ordem dos banners. Tente novamente.");
     return; // aborta o swap em vez de seguir com estado divergente
   }

4) So depois do sucesso confirmado, aplicar a nova ordem de forma imutavel e re-renderizar, mantendo state, vault e banco alinhados:
   const orderMap = new Map(targets.map((t) => [t.id, t.order]));
   const normalized = banners.map((b) => (orderMap.has(b.id) ? { ...b, order: orderMap.get(b.id)! } : b));
   persistToVault(normalized);
   setBanners(normalized);
   e seguir o swap usando `normalized` (em vez de `banners`) para calcular activeIndex/overIndex e os clones.

Alternativa mais enxuta: reaproveitar a helper `normalizeBannersOrder(activePosition)` ja existente no modulo (linhas 23-59), fazer `await` nela (adicionando checagem de `.error` la tambem) e, em seguida, `await fetchBanners(false, true)` para ressincronizar o estado a partir do banco, eliminando por completo a normalizacao local mutante.

5) Correcao complementar (mesma regiao): usar o mesmo criterio de desempate nos dois lados — em AdminBannersView.tsx:1527 trocar `.sort((a, b) => (a.order ?? 0) - (b.order ?? 0))` por `.sort((a, b) => (a.order ?? 0) - (b.order ?? 0) || a.id.localeCompare(b.id))`, igual ao usado em useBanners.ts:512-516, para que o vizinho escolhido pela seta continue sendo o vizinho apos a normalizacao.

---

### 56. 🟡 Vitrines mostram "salvas com sucesso" mesmo quando o updateConfig falhou

`src/views/admin/AdminCarouselsView.tsx:118` · **media** · malfuncionamento · _Admin: banners, carrosseis/vitrines e editor de imagem_

**Problema.** handleUpdateHomeSections faz await updateConfig(...) dentro de um try/catch, mas updateConfig no StoreContext ja captura qualquer erro internamente (console.error + toast.error) e retorna normalmente, sem re-lancar. Logo o catch de AdminCarouselsView e codigo morto: em caso de falha o fluxo segue para onSetDirty?.(false) e para o toast.success.

**Reproduzir.** 1) Admin clica em '+ Nova Vitrine', digita o titulo e confirma (handleAddCustomVitrine chama handleUpdateHomeSections(updated, true)). 2) A RPC upsert_store_config falha (RLS, rede caindo, sessao expirada). 3) StoreContext mostra 'Erro ao salvar as configuracoes' e retorna sem lancar. 4) AdminCarouselsView mostra logo em seguida 'Vitrines salvas com sucesso!', marca o formulario como nao-sujo, limpa o titulo digitado e fecha o modal. 5) Como setConfig so roda em caso de sucesso, a lista volta ao estado anterior e a vitrine simplesmente some, com o admin tendo acabado de ver uma mensagem de sucesso.

```
const handleUpdateHomeSections = async (
    updated: typeof homeSections,
    showToast = false,
  ) => {
    try {
      await updateConfig({ homeSections: updated });
      onSetDirty?.(false);
      if (showToast) {
        toast.success("Vitrines salvas com sucesso!");
      }
    } catch (error) {
      console.error("Erro ao atualizar as vitrines:", error);
      toast.error("Erro ao salvar ordem das vitrines.");
    }
  };
```

**Correção.**

Fazer o updateConfig sinalizar sucesso e a view respeitar esse sinal.

1) Em src/contexts/StoreContext.tsx:
   - Trocar a assinatura da linha 50 para `updateConfig: (updates: Partial<StoreConfig>, options?: { silent?: boolean }) => Promise<boolean>;`
   - No early-return de nao-admin (linhas 444-447), retornar `false` apos o `toast.error("Acesso negado")`.
   - Apos o bloco de sucesso (depois do `setConfig`/`applyBranding`, linha 505), condicionar o toast generico e retornar `true`: `if (!options?.silent) toast.success("Configuracoes salvas"); return true;`
   - No catch (linhas 506-509), manter o console.error e o toast.error e retornar `false`.
   Alternativa equivalente: manter `Promise<void>` e re-lancar o erro (`throw err`) no catch, mas nesse caso o early-return de `!isAdmin` tambem precisa lancar, senao o caminho "Acesso negado" continua se passando por sucesso. Se optar por re-lancar, e obrigatorio revisar TODOS os chamadores, porque hoje varios dependem de a promise nunca rejeitar.

2) Em src/views/admin/AdminCarouselsView.tsx, linhas 113-127, trocar o try/catch morto por checagem do retorno e propagar o resultado:
   const handleUpdateHomeSections = async (
     updated: typeof homeSections,
     showToast = false,
   ): Promise<boolean> => {
     const ok = await updateConfig({ homeSections: updated }, { silent: true });
     if (!ok) {
       toast.error("Nao foi possivel salvar as vitrines. Tente novamente.");
       return false;
     }
     onSetDirty?.(false);
     if (showToast) toast.success("Vitrines salvas com sucesso!");
     return true;
   };

3) Em handleAddCustomVitrine (linhas 184-208), so limpar o formulario e fechar o modal quando salvou:
   const ok = await handleUpdateHomeSections(updated, true);
   if (!ok) return; // mantem o modal aberto e o titulo digitado
   setNewVitrineTitle("");
   setShowAddVitrineModal(false);

4) Aplicar a mesma checagem de retorno nos outros chamadores que hoje tem catch morto: AdminShippingView.tsx:293 (o bloco 291-332 nao pode cair no `onSetDirty?.(false)` + toast de sucesso se o updateConfig falhou), AdminPushView.tsx:68, AdminReviewsView.tsx:99, AdminCouponsView.tsx:83 e AdminWhatsAppConfigView.tsx:582.

---

### 57. 🟡 Duplo clique em "Publicar" cadastra o produto duas vezes

`src/views/admin/AdminProductFormView.tsx:1139` · **media** · bug · _Admin: cadastro/edicao de produtos e listagem_

**Problema.** Após o sucesso, `setIsSubmitting(false)` é executado ANTES do `setTimeout` de 1500ms que faz a navegação. Nesse intervalo o botão volta a ficar habilitado (`disabled={!isValid || isSubmitting || isOffline || isImageUploading}` — todos falsos), exibindo apenas o rótulo "Salvo". Um segundo clique reentra em `handleSubmit`, que só se protege com `if (isSubmitting) return`, e chama `addProduct` de novo, criando um produto duplicado (ou, na edição, um segundo `upsertVariants`). Além disso o `setTimeout` não é cancelado no unmount, então uma navegação por outro caminho dentro dos 1,5s é sobreposta por um `onNavigate("admin-products")` tardio.

**Reproduzir.** 1) Preencher um produto novo e clicar em "Publicar". 2) O salvamento leva ~300ms; o botão muda para "Salvo" mas continua clicável por mais 1,2s. 3) O admin, achando que o primeiro clique não pegou (a tela ainda não navegou), clica de novo. 4) `addProduct` é chamado uma segunda vez e dois produtos idênticos aparecem no catálogo, ambos com o mesmo SKU.

```
setIsSubmitting(false);
      setShowSuccess(true);
      if (!productId) {
        localStorage.removeItem("ikcous_product_form_draft");
      } else {
        localStorage.removeItem(`ikcous_product_form_draft_edit_${productId}`);
      }

      setTimeout(() => {
        onSetDirty?.(false);
        onNavigate("admin-products", undefined, true);
      }, 1500);
```

**Correção.**

Tres alteracoes pontuais em `src/views/admin/AdminProductFormView.tsx` (`useRef` ja esta importado na linha 56):

1) Guarda de reentrada (linha 990) — incluir o estado de sucesso:
```ts
if (isSubmitting || showSuccess) return;
```

2) Botao (linha 1742-1744) — manter desabilitado durante a janela de 1,5s, preservando o feedback "Salvo" (o ternario da linha 1752-1758 ja renderiza "Salvo" quando `isSubmitting=false` e `showSuccess=true`):
```tsx
disabled={
  !isValid || isSubmitting || showSuccess || isOffline || isImageUploading
}
```
(Nao remova o `setIsSubmitting(false)` da linha 1139: se remover, o botao volta a mostrar o spinner em vez de "Salvo", porque `isSubmitting` tem precedencia no ternario.)

3) Timer com cleanup — declarar a ref junto dos demais estados (proximo da linha 341) e limpar no unmount:
```ts
const successTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

useEffect(
  () => () => {
    if (successTimerRef.current) clearTimeout(successTimerRef.current);
  },
  [],
);
```
e trocar a linha 1147 por:
```ts
successTimerRef.current = setTimeout(() => {
  onSetDirty?.(false);
  onNavigate("admin-products", undefined, true);
}, 1500);
```

Reforco recomendado (defesa em profundidade, ja que nao ha idempotencia no backend): apos o sucesso em modo edicao, recarregar as variantes com os IDs reais retornados (ou limpar `deletedVariantIds` e substituir os ids `temp-`), para que qualquer novo submit nao reinsira variantes via `upsertVariants` (src/hooks/useProducts.ts:1317, que omite `id` quando ele comeca com `temp-`).

---

### 58. 🟡 Exclusão de produto move as imagens para backup antes do UPDATE; falha deixa imagens quebradas

`src/hooks/useProducts.ts:742` · **media** · bug · _Admin: cadastro/edicao de produtos e listagem_

**Problema.** Em `deleteProduct`, os arquivos do Storage são movidos para a pasta `backup/` (operação irreversível do ponto de vista da URL pública) ANTES do soft-delete no banco. Se o UPDATE em `produtos` falhar (RLS, rede, timeout), o `catch` restaura o estado local e o cache em memória, mas os arquivos já foram movidos: as URLs gravadas em `imagem_urls` apontam para caminhos que não existem mais. O produto volta a aparecer na listagem e na vitrine sem nenhuma imagem carregando, e o toast diz apenas "Erro ao excluir produto", sem indicar que a mídia foi perdida. O laço também é um N+1 sequencial (um `await` de `storage.move` por imagem e mais um por variante).

**Reproduzir.** 1) Produto com 6 imagens. 2) Admin clica em Excluir Produto e confirma. 3) As 6 imagens são movidas para `backup/...` com sucesso. 4) O UPDATE em `produtos` falha (ex.: sessão expirada/JWT). 5) O rollback recoloca o produto na lista, mas todas as fotos ficam quebradas para o admin e para os clientes, porque `imagem_urls` no banco ainda referencia os caminhos antigos.

```
// Move product images to backup
        const backedUpImages: string[] = [];
        if (product.images && product.images.length > 0) {
          for (const img of product.images) {
            const newUrl = await backupStorageFile(img);
            backedUpImages.push(newUrl || img);
          }
        }
```

**Correção.**

Em src/hooks/useProducts.ts, dentro de `deleteProduct` (bloco 735-787), inverter as fases para que nada irreversível aconteça antes da confirmação do banco:

FASE 1 - soft-delete primeiro, só com os campos de estado:
```ts
const { error } = await supabase
  .from("produtos")
  .update({ deleted_at: new Date().toISOString(), ativo: false })
  .eq("id", id);
if (error) throw error;
```
Se falhar aqui, o `catch` existente (780-787) faz um rollback 100% limpo: nenhum arquivo foi movido, nenhuma URL ficou órfã.

FASE 2 - só depois do UPDATE confirmado, mover a mídia, em paralelo, e gravar as novas URLs num segundo UPDATE. Envolver esta fase num try/catch PRÓPRIO, que não desfaz a exclusão já efetivada (o produto já está invisível; no pior caso a linha fica com as URLs antigas, o que é inofensivo porque o produto não aparece mais em `vw_produtos_public`):
```ts
try {
  const backedUpImages = await Promise.all(
    (product.images ?? []).map(async (img) => (await backupStorageFile(img)) || img),
  );

  await Promise.all(
    (product.variants ?? [])
      .filter((v) => v.imageUrl)
      .map(async (v) => {
        const newUrl = await backupStorageFile(v.imageUrl!);
        if (!newUrl || newUrl === v.imageUrl) return;
        const { error: vErr } = await supabase
          .from("product_variants")
          .update({ image_url: newUrl } as any)
          .eq("id", v.id);
        if (vErr) console.error("[useProducts] variant image_url update falhou", v.id, vErr);
      }),
  );

  if (backedUpImages.length > 0) {
    const { error: imgErr } = await supabase
      .from("produtos")
      .update({ imagem_urls: backedUpImages, imagem_url: backedUpImages[0] || null })
      .eq("id", id);
    if (imgErr) console.error("[useProducts] backup URLs não persistidas", id, imgErr);
  }
} catch (mediaErr) {
  console.error("[useProducts] backup de mídia pós-delete falhou", id, mediaErr);
}
```
Observações adicionais que fazem parte da correção:
- Note que hoje o `if (backedUpImages.length > 0)` não existe: quando `product.images` está vazio, o código atual grava `imagem_urls: []` e `imagem_url: null`, apagando um eventual `imagem_url` legado (o mapper em src/lib/mappers.ts:19 usa `row.imagem_urls || row.images || (row.imagem_url ? [row.imagem_url] : [])`, então `images` pode vir vazio para linhas antigas). O guard acima evita esse apagamento.
- O `error` do update de `product_variants` (hoje linhas 756-759) é silenciosamente descartado; passar a logá-lo como acima.
- `Promise.all` elimina o N+1 sequencial (N moves de imagem + M moves/updates de variante, todos com […]

---

### 59. 🟡 Rascunho de edição é apagado ~1s após abrir o produto, antes de o usuário poder restaurá-lo

`src/views/admin/AdminProductFormView.tsx:781` · **media** · bug · _Admin: cadastro/edicao de produtos e listagem_

**Problema.** O efeito de auto-save do rascunho remove a chave do localStorage sempre que `formData` é igual a `initialData`. Logo após o carregamento do produto, os dois são idênticos e `draftChecked` já está `true`, então 1 segundo depois o rascunho é destruído. Isso acontece enquanto o toast "Rascunho não salvo encontrado para este produto" ainda está na tela prometendo restauração por 10 segundos (duration: 10000). O botão "Restaurar" continua funcionando porque `draftFields` está capturado no closure, mas se o admin não clicar naquele instante (ou recarregar a página, ou o navegador fechar), o rascunho está permanentemente perdido — exatamente o cenário que o recurso deveria proteger.

**Reproduzir.** 1) Admin edita um produto, faz várias alterações e fecha a aba sem salvar (o rascunho fica em `ikcous_product_form_draft_edit_<id>`). 2) Reabre o produto: o toast "Rascunho não salvo encontrado" aparece com botão "Restaurar" por 10s. 3) O admin sai para atender o telefone e volta 30s depois; o toast sumiu. 4) Ele recarrega a página esperando o toast de novo — o rascunho já foi apagado no segundo 1 e todas as alterações se perderam.

```
const timer = setTimeout(() => {
      const isDirty = isProductFormDirty(formData, initialData);
      const draftKey = !productId
        ? "ikcous_product_form_draft"
        : `ikcous_product_form_draft_edit_${productId}`;
      if (isDirty) {
        localStorage.setItem(draftKey, JSON.stringify(formData));
      } else {
        localStorage.removeItem(draftKey);
      }
    }, 1000);
```

**Correção.**

Transformar a remoção automática em algo condicionado a uma decisão explícita do usuário, usando um ref que começa `false` e só é liberado quando o rascunho foi "resolvido".

1) Declarar junto aos demais estados (perto da linha 288, onde está `const [draftChecked, setDraftChecked] = useState(false);`):
```ts
const draftResolvedRef = useRef(false);
```

2) No efeito de auto-save (linhas 774-784), tornar o `else` um no-op enquanto o rascunho não foi resolvido:
```ts
if (isDirty) {
  localStorage.setItem(draftKey, JSON.stringify(formData));
} else if (draftResolvedRef.current) {
  localStorage.removeItem(draftKey);
}
```

3) Marcar `draftResolvedRef.current = true` nos pontos em que a decisão realmente ocorre:
- No efeito de edição (604-674): dentro do `onClick` de "Restaurar" (linha 653-657), logo após `setFormData(draftFields)`; e também no branch `else` da linha 661-664 (rascunho idêntico ao BD — ali já é seguro limpar); e quando `savedDraft` é `null` (não há rascunho, nada a proteger).
- No efeito de produto novo (528-601): dentro do `onClick` de "Descartar" (564-591), junto ao `localStorage.removeItem`; e quando `savedDraft` é `null`.

4) Ainda no efeito de edição, adicionar uma segunda ação ao toast da linha 648 para o usuário poder descartar conscientemente (sonner aceita `cancel` além de `action`), setando `draftResolvedRef.current = true` e chamando `localStorage.removeItem(draftKey)`. Sem isso, um rascunho que o admin ignorou permanece indefinidamente — o que é aceitável, pois a linha 663 já o limpa no próximo mount caso ele coincida com o estado do banco.

5) Para o fluxo de produto novo, considerar não chamar `setInitialData(draftFields)` na linha 556 (mantendo `initialData` vazio), de modo que o rascunho recuperado permaneça "dirty" e continue sendo regravado pelo auto-save. Se essa mudança for indesejada por afetar o indicador de alterações não salvas (`onSetDirty`, linhas 677-684) e o `beforeunload` de src/App.tsx:531-541, a guarda do item (2) já resolve sozinha o vazamento.

A limpeza pós-salvamento bem-sucedido (linhas 1141-1145) permanece inalterada e continua sendo o caminho correto de remoção.

---

### 60. 🟡 Remover a data de validade de um cupom nunca é gravado no banco, mas a UI confirma "Cupom atualizado"

`src/hooks/useCoupons.ts:163` · **media** · bug · _Admin: dashboard, analytics, clientes e cupons_

**Problema.** Quando o admin limpa o campo Validade, o formulário faz `setFormData({ ...formData, validUntil: undefined })` (AdminCouponFormView.tsx:461). O payload do update então leva `valid_until: undefined`, e o supabase-js serializa o corpo com JSON.stringify, que remove chaves undefined — ou seja, o PATCH sai sem a coluna valid_until e o Postgres mantém o valor antigo. Como updateCoupon faz update otimista com `{ ...c, ...updates }` e dispara toast de sucesso, o admin vê o cupom "sem validade" e acredita que a alteração foi aplicada. O mesmo vale para qualquer campo que o admin queira zerar para NULL.

**Reproduzir.** 1) Cupom VERAO10 tem validade 31/08/2026. 2) Admin abre Editar Cupom, apaga a data no campo Validade e clica em Salvar Cupom. 3) Aparece o toast 'Cupom atualizado' e a tela volta para a lista sem o selo 'Expira em'. 4) O fetchCoupons subsequente recarrega do banco e o selo 'Expira em: 31/08/2026' reaparece (ou reaparece no próximo acesso). 5) Depois de 31/08 o cupom para de funcionar no checkout, porque validate_coupon_secure_v2 continua vendo valid_until preenchido, mesmo o admin tendo 'removido' a validade.

```
const { error } = await supabase
        .from("coupons")
        .update({
          code: updates.code,
          type: updates.type,
          value: updates.value,
          min_purchase: updates.minPurchase,
          usage_limit: updates.usageLimit,
          valid_until: updates.validUntil,
          active: updates.active,
        })
        .eq("id", id);
```

**Correção.**

Montar o payload apenas com as chaves realmente PRESENTES em `updates`, convertendo `undefined` em `null` só nesses casos. Isso conserta a remoção da validade sem quebrar o update parcial do toggle em AdminCouponsView.tsx:561.

Em src/hooks/useCoupons.ts, substituir o objeto literal das linhas 157-165 por:

```ts
const payload: Record<string, unknown> = {};
if ("code" in updates) payload.code = updates.code;
if ("type" in updates) payload.type = updates.type;
if ("value" in updates) payload.value = updates.value;
if ("minPurchase" in updates) payload.min_purchase = updates.minPurchase ?? null;
if ("usageLimit" in updates) payload.usage_limit = updates.usageLimit ?? null;
if ("validUntil" in updates) payload.valid_until = updates.validUntil ?? null;
if ("active" in updates) payload.active = updates.active;

const { error } = await supabase
  .from("coupons")
  .update(payload as any)
  .eq("id", id);
```

Por que `in` e não `?? null` direto: o toggle envia `{ active: checked }`, então nenhuma outra chave existe no objeto e nada mais é tocado. Já o formulário sempre espalha `formData`, que carrega a chave `validUntil` mesmo quando o valor é `undefined` (efeito de `{ ...formData, validUntil: undefined }`), então a limpeza vira `valid_until: null` e é gravada de verdade.

Complementos recomendados:
1. Em src/types/index.ts:168, trocar `validUntil?: string;` por `validUntil?: string | null;` e, em AdminCouponFormView.tsx:461, usar `validUntil: null` no lugar de `undefined` — assim a intenção "remover validade" fica explícita no tipo, e não dependente do detalhe de que a chave sobrevive ao spread.
2. Em useCoupons.ts:43, aceitar o null vindo do banco continua funcionando (`c.valid_until ?? undefined`); se adotar o item 1, simplificar para `validUntil: c.valid_until ?? null` para manter consistência entre leitura e escrita.
3. Opcional, para o update otimista não divergir: guardar o retorno real com `.select().single()` e aplicar o registro devolvido pelo banco no lugar de `{ ...c, ...updates }`, eliminando a janela em que a UI mostra um estado que o banco recusou.

---

### 61. 🟡 RPC get_category_analytics é SECURITY DEFINER sem checagem de admin e está liberada para qualquer usuário logado

`supabase/migrations/20260704170000_reconcile_category_analytics_frete.sql:15` · **media** · seguranca · _Admin: dashboard, analytics, clientes e cupons_

**Problema.** A função roda com SECURITY DEFINER (ignorando RLS de marketplace_orders/marketplace_order_items/produtos) e o corpo vai direto para RETURN QUERY, sem o guarda `IF NOT public.is_admin() THEN RAISE EXCEPTION` presente nas outras RPCs administrativas (get_admin_analytics_v2, get_admin_customers_paged, get_admin_user_detail todas têm). O GRANT em 20260708120000_db_security_rls_and_rpc_hardening.sql concede EXECUTE a `authenticated`, e não só a admins. Qualquer cliente cadastrado consegue chamar a RPC pelo mesmo cliente supabase da loja e extrair o faturamento consolidado da loja por categoria, o número de pedidos e o ticket médio de cada categoria, além do total arrecadado em frete.

**Reproduzir.** 1) Um cliente comum faz login na loja. 2) No console do navegador executa `await supabase.rpc('get_category_analytics', { start_date: '2020-01-01T00:00:00Z', end_date: new Date().toISOString() })`. 3) Recebe 200 com a lista completa {name, value, orders, avg_ticket} de todas as categorias mais a linha 'Frete' — dados financeiros que só deveriam existir no painel admin. Nenhum erro é levantado e nada é registrado.

```
CREATE OR REPLACE FUNCTION public.get_category_analytics(
    start_date timestamp with time zone, end_date timestamp with time zone
)
RETURNS TABLE (name text, value numeric, orders bigint, avg_ticket numeric)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    RETURN QUERY
```

**Correção.**

Criar uma nova migração (ex.: supabase/migrations/20260715000000_harden_get_category_analytics.sql) que recria a função com o guarda de admin, mantendo o corpo idêntico ao atual (não editar retroativamente 20260704170000, que já foi aplicado):

BEGIN;

CREATE OR REPLACE FUNCTION public.get_category_analytics(
    start_date timestamp with time zone, end_date timestamp with time zone
)
RETURNS TABLE (name text, value numeric, orders bigint, avg_ticket numeric)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    -- 0. Security Check (mesmo padrão de get_admin_analytics_v2)
    IF NOT public.is_admin() THEN
        RAISE EXCEPTION 'Acesso negado: privilégios de administrador necessários.';
    END IF;

    RETURN QUERY
    WITH category_sums AS (
        -- ... corpo idêntico às linhas 20-52 de 20260704170000_reconcile_category_analytics_frete.sql ...
    )
    SELECT cs.name, cs.value, cs.orders, cs.avg_ticket
    FROM category_sums cs
    ORDER BY cs.value DESC;
END;
$$;

-- Reafirma as permissões (CREATE OR REPLACE preserva o ACL, mas deixa explícito)
REVOKE EXECUTE ON FUNCTION public.get_category_analytics(
    timestamp with time zone, timestamp with time zone
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_category_analytics(
    timestamp with time zone, timestamp with time zone
) TO authenticated, service_role;

COMMIT;

Detalhes que verifiquei e que tornam a correção segura de aplicar:
- NÃO usar DROP FUNCTION aqui: CREATE OR REPLACE basta porque a assinatura e o tipo de retorno não mudam; o DROP obrigaria a refazer todos os GRANTs.
- public.is_admin() está disponível dentro da função: tem EXECUTE concedido a authenticated e service_role (20260708120000_db_security_rls_and_rpc_hardening.sql:395) e revogado de PUBLIC/anon (20260709000000_final_rpc_permissions_hardening.sql:76); além disso, dentro de um SECURITY DEFINER ela roda no contexto do dono.
- Manter o GRANT para authenticated é correto: o admin também é authenticated; a autorização passa a ser feita dentro do corpo.
- Nenhuma mudança é necessária em src/hooks/useAnalytics.ts: o erro 400 resultante é tratado no catch das linhas 407-409 e não dispara retry (a condição de backoff exige status >= 500 ou 408, linhas 31-36).

---

### 62. 🟡 Falha ao carregar a análise por categoria é engolida e o dashboard exibe "Sem Dados Registrados" como se a loja não tivesse vendas

`src/hooks/useAnalytics.ts:408` · **media** · malfuncionamento · _Admin: dashboard, analytics, clientes e cupons_

**Problema.** fetchCategoryAnalytics captura o erro, apenas escreve no console e retorna null — nunca chama setError. O estado `error` exposto pelo hook só é alimentado por fetchExecutiveSummary. Assim, quando a RPC get_category_analytics falha (RLS, timeout, 500), o AdminDashboardView não mostra o banner vermelho 'Falha ao carregar dados' nem o botão 'Tentar', e o StrategicIntelligenceBlocks cai no ramo de estado vazio, exibindo 'Sem Dados Registrados / Nenhuma categoria registrou faturamento no período selecionado'. O admin conclui que não houve vendas quando na verdade a chamada quebrou. Como o loadDashboardData também engole o erro no seu próprio catch, o isLoading vira false e a tela fica visualmente 'ok'.

**Reproduzir.** 1) A RPC get_category_analytics passa a falhar (por exemplo após um deploy que renomeia/derruba a função, ou por revogação de permissão). 2) Admin abre o Dashboard: os KPIs de topo carregam normalmente (get_admin_analytics_v2 continua ok). 3) O bloco 'Divisão de Faturamento' exibe 'Sem Dados Registrados — Nenhuma categoria registrou faturamento no período selecionado'. 4) Nenhum banner de erro aparece e o botão 'Sincronizar' repete o mesmo comportamento silencioso. O admin acredita que o mês não teve faturamento por categoria.

```
} catch (err) {
        console.error("Error fetching category analytics:", err);
        return null;
      } finally {
        setCategoryLoading(false);
      }
```

**Correção.**

Aplicar em src\hooks\useAnalytics.ts e nos dois consumidores:

1) Expor um estado de erro proprio para categorias (nao reaproveitar `error`, senao um retry do summary limpa o erro de categoria na linha 263):
- Adicionar junto da linha 135: `const [categoryError, setCategoryError] = useState<string | null>(null);`
- No bloco try de `fetchCategoryAnalytics` (junto do `setCategoryLoading(true)` da linha 383): `setCategoryError(null);`
- No catch das linhas 407-410, trocar por:
```ts
} catch (err: any) {
  console.error("Error fetching category analytics:", err);
  setCategoryError(err?.message || "Erro ao carregar análise por categoria");
  return null;
}
```
- Na revalidacao em background (linha 353), passar a desestruturar o erro e propaga-lo, pois hoje ele e descartado:
```ts
const { data, error: err } = await callRpcWithRetry<any>(() =>
  (supabase as any).rpc("get_category_analytics", { start_date: start, end_date: end }),
);
if (err) {
  console.error("Background fetch category failed:", err);
  setCategoryError(err.message || "Erro ao revalidar análise por categoria");
  return;
}
if (data) { /* ...bloco atual... */ }
```
(e no catch da linha 375-377 fazer o mesmo `setCategoryError`).
- Incluir `categoryError` no objeto retornado pelo hook (linhas 417-425).

2) Em src\views\admin\AdminDashboardView.tsx:
- Consumir `categoryError` no destructuring das linhas 50-56.
- Trocar a condicao da linha 283 para `{(analyticsError || categoryError) && !isLoading && (` e exibir a(s) mensagem(ns) — assim o banner "Falha ao carregar dados" e o botao "Tentar" (que ja chama `loadDashboardData(true)`) voltam a funcionar para falhas de categoria.
- Passar o erro adiante: `<StrategicIntelligenceBlocks categoryData={mappedCategoryData} error={categoryError} loading={isLoading && !categoryData} active={active} />` — note as DUAS mudancas: nova prop `error` e troca de `!stats` por `!categoryData` na linha 317, que corrige o flash de "Sem Dados Registrados" durante a carga normal.

3) Em src\components\admin\dashboard\StrategicIntelligenceBlocks.tsx:
- Adicionar `error?: string | null` na interface `StrategicIntelligenceBlocksProps` (linha 36) e no destructuring da linha 133.
- ANTES do empty state da linha 316, inserir um ramo de erro para nao confundir falha com ausencia de vendas:
```tsx
if (!loading && error) {
  return (
    <div className="flex flex-col items-center justify-center space-y-4 rounded-[3rem] border border-red-500/20 bg-red-500/5 p-12 text-center">
      <AlertCircle className="text-red-400" size={24} />
      <h3 className="text-lg font-black […]

---

### 63. 🟡 Home anuncia meta de frete gratis de R$ 100 mesmo com a regra desativada pelo admin

`src/components/ui/custom/FreeShippingBlock.tsx:17` · **media** · bug · _Frete, CEP e enderecos_

**Problema.** O componente aplica `config.freeShippingMin || 100`, entao o valor 0 (regra desligada no admin) vira 100. O bloco passa a exibir barra de progresso, 'Adicione mais R$ X para garantir o frete gratis' e, ao passar de R$ 100, 'Oba! Frete Gratis Liberado! / Meta Atingida / Liberado'. Nada disso e verdade: CartContext continua cobrando `config.shippingFee` e (pelo achado do RPC) o pedido nem sera aceito. O mesmo fallback aparece durante o carregamento inicial, quando defaultStoreConfig usa freeShippingMin 350.

**Reproduzir.** Admin desliga o switch 'Frete Gratis' (freeShippingMin = 0). Cliente logado com carrinho de R$ 120 abre a home: o card mostra 'Frete Gratis Liberado! Sua sacola ja ganhou entrega gratis!' com selo 'Liberado'. Ao abrir o carrinho, o resumo cobra a taxa de entrega normalmente — promessa quebrada na cara do cliente.

```
const minShipping = config.freeShippingMin || 100;
  const totalCartValue = cartTotal || 0;
  const remaining = Math.max(0, minShipping - totalCartValue);
  const isGoalReached = totalCartValue >= minShipping && minShipping > 0;
```

**Correção.**

Em src/components/ui/custom/FreeShippingBlock.tsx:

1) Trocar o fallback truthy por coalescencia nula, para nao converter 0 em 100:
   `const minShipping = Number(config.freeShippingMin ?? 0);`
   (usar `Number.isFinite(minShipping) ? minShipping : 0` se quiser blindar tambem contra NaN vindo de `Number(freeMin)` em StoreContext.tsx:206).

2) Adicionar early-return antes do bloco logado (e tambem antes do card de `!user` da linha 73, que hoje promete "Faca login para ganhar frete gratis em suas compras" mesmo com a regra desligada):
   `if (minShipping <= 0) return null;`
   Assim o componente some do InfoBlockCarousel quando a regra esta desativada, ficando alinhado com o comportamento ja adotado em CartView.tsx:253 (`isRuleActive`) e nos cards de produto (`config.freeShippingMin > 0`).

3) Como o pai (src/views/customer/HomeView.tsx:283-285) renderiza `<InfoBlockCarousel>` incondicionalmente, verificar se o carrossel nao fica com moldura/altura vazia quando o unico filho retorna null; se ficar, condicionar o proprio `<InfoBlockCarousel>` a `config.freeShippingMin > 0` em HomeView.

4) Opcional, para o estado de carregamento: expor/consumir o `isLoaded` do StoreContext e nao renderizar o bloco enquanto for false, evitando exibir a meta default de R$ 350 (defaultStoreConfig em StoreContext.tsx:21) antes dos dados reais chegarem.

Observacao colateral (fora do escopo deste achado, mas do mesmo dominio): src/components/ui/custom/CartReminder.tsx:25-27 usa `config.freeShippingMin` sem nenhuma guarda `> 0`, gerando `isFree = totalAmount >= 0` sempre true e `progress = Infinity` (divisao por zero) quando a regra esta desligada.

---

### 64. 🟡 Notificações globais (usuario_id NULL) nunca ficam lidas nem podem ser excluídas

`src/contexts/NotificationContext.tsx:79` · **media** · bug · _Avaliacoes, perguntas, favoritos, perfil e notificacoes_

**Problema.** O fetch traz notificações do usuário E as globais (`usuario_id.is.null`), mas `markAllAsRead` só faz UPDATE em `.eq("usuario_id", user.id)` e ainda assim marca TODAS como lidas no estado local. `markAsRead` e `deleteNotification` filtram só por `id`, e a política RLS `notificacoes_update_policy`/`notificacoes_delete_policy` exige `auth.uid() = usuario_id`, então nas linhas globais o UPDATE/DELETE casa com 0 linhas e o PostgREST devolve sucesso sem erro. A UI atualiza otimisticamente, nada é persistido e ninguém é avisado. Como o AdminPushView cria exatamente esse tipo de linha (`usuario_id: null`) sempre que o segmento é "all", toda campanha em massa gera uma notificação que o cliente nunca consegue eliminar.

**Reproduzir.** Admin envia push para o segmento "all" -> AdminPushView.tsx:346 insere em `notificacoes` com `usuario_id: null` -> cliente abre a central, clica em "Marcar todas como lidas" (ou no X para excluir) -> item some/fica cinza e o badge zera -> cliente fecha e reabre o app -> a notificação volta como não lida e o badge volta a mostrar 1. Repetível infinitamente.

```
const markAllAsRead = useCallback(async () => {
    if (!user) return;
    try {
      const { error } = await supabase
        .from("notificacoes")
        .update({ lida: true })
        .eq("usuario_id", user.id)
        .eq("lida", false);

      if (error) throw error;
      setNotifications((prev) => prev.map((n) => ({ ...n, read: true })));
```

**Correção.**

Correção em três camadas, da mais barata à definitiva.

A) Parar de mentir para o usuário (mudança local, imediata, em `src/contexts/NotificationContext.tsx`):
- `markAsRead` (:63) — trocar por `.update({ lida: true }).eq("id", id).select("id")` e só aplicar `setNotifications(... read: true)` se `data && data.length > 0`; caso contrário, não mutar o estado (evita o "some e volta").
- `deleteNotification` (:95) — trocar por `.delete().eq("id", id).select("id")` e só remover do estado se `data?.length`; se vier 0, manter o item e exibir um toast do tipo "esta notificação não pode ser excluída".
- `markAllAsRead` (:79) — hoje o UPDATE já filtra `.eq("usuario_id", user.id)`, mas o `map` marca TODAS. Adicionar `.select("id")` no update e aplicar `read: true` só aos ids retornados, algo como `const ids = new Set((data ?? []).map(r => r.id)); setNotifications(prev => prev.map(n => ids.has(n.id) ? { ...n, read: true } : n))`.
- O mapper de `:41-51` descarta `item.usuario_id`; passar a propagá-lo (ex.: `is_global: item.usuario_id === null`) para que a `NotificationsView` possa esconder o botão X em notificações globais (`src/views/customer/NotificationsView.tsx:398-407`) enquanto a camada C não existir.

B) Eliminar a linha global na origem (corrige o caso real mais comum): em `src/views/admin/AdminPushView.tsx:345-352`, deixar de inserir `usuario_id: null` para `segment === "all"` e fazer fan-out, como o próprio código já faz no ramo `else` (:354-370). Atenção: `get_segmented_push_targets` devolve apenas alvos com push subscription (endpoint/p256dh/auth), então o fan-out a partir de `targetList` alcançaria menos gente do que hoje. O caminho correto é uma RPC SECURITY DEFINER (ex.: `broadcast_notificacao(p_titulo, p_mensagem, p_tipo, p_dados)`) que, validando `public.is_admin()`, faça `INSERT INTO public.notificacoes (usuario_id, ...) SELECT id, ... FROM public.profiles` — uma linha por usuário, que aí sim casa com as policies de UPDATE/DELETE existentes.

C) Solução definitiva se as globais forem mantidas (obrigatória, porque `lida` é coluna única compartilhada — marcar a global como lida por um admin marcaria para todo mundo): criar `public.notificacao_leituras (usuario_id uuid references auth.users, notificacao_id uuid references public.notificacoes on delete cascade, lida_em timestamptz default now(), primary key (usuario_id, notificacao_id))`, com RLS `auth.uid() = usuario_id` em SELECT/INSERT/DELETE, e expor uma RPC `marcar_notificacao_lida(p_id uuid)` (upsert na tabela de leituras). No cliente, calcular `read` como `!!item.lida || existeLeitura(item.id)` […]

---

### 65. 🟡 Resposta da loja a uma avaliação (merchant_reply) nunca aparece para o cliente

`src/hooks/useReviews.ts:93` · **media** · malfuncionamento · _Avaliacoes, perguntas, favoritos, perfil e notificacoes_

**Problema.** `ReviewCard` renderiza um bloco "Resposta da Loja" quando `review.merchantReply` existe, e o admin consegue responder via `addMerchantReply` -> RPC `reply_review_atomic` (que grava `merchant_reply` na tabela). Porém o mapeamento usado na página do produto (`getReviewsByProduct`) não copia `item.merchant_reply` para o objeto `Review` — só o caminho administrativo (`getAllReviews`, linha 273/400) faz isso. Resultado: `merchantReply` chega sempre `undefined` no cliente e o bloco nunca é renderizado. A query já traz o campo (usa `select('*')`), é apenas o mapper que o descarta.

**Reproduzir.** Admin abre Avaliações, responde a review de um cliente e vê "Resposta enviada com sucesso!" -> a coluna `merchant_reply` é preenchida no banco -> qualquer cliente abre a página do produto e rola até a avaliação -> o bloco "Resposta da Loja" não aparece em nenhum momento, mesmo com hard refresh. O trabalho de atendimento fica invisível para quem deveria vê-lo.

```
const formattedReviews: Review[] = data.map((item: any) => ({
        id: item.id,
        productId: item.product_id,
        userId: item.user_id,
        customerName: item.user?.full_name || "Usuário Anônimo",
        customerAvatar: item.user?.avatar_url || undefined,
        rating: item.rating,
        comment: item.comment,
        verified: item.verified,
        helpful: item.helpful,
        createdAt: item.created_at,
      }));
```

**Correção.**

Em `src/hooks/useReviews.ts`, dentro de `getReviewsByProduct`, incluir o campo no objeto montado (linhas 93-104), logo após `helpful: item.helpful,`:

```ts
const formattedReviews: Review[] = data.map((item: any) => ({
  id: item.id,
  productId: item.product_id,
  userId: item.user_id,
  customerName: item.user?.full_name || "Usuário Anônimo",
  customerAvatar: item.user?.avatar_url || undefined,
  rating: item.rating,
  comment: item.comment,
  verified: item.verified,
  helpful: item.helpful,
  merchantReply: item.merchant_reply || undefined,
  createdAt: item.created_at,
}));
```

`Review` já declara `merchantReply?: string` (src/types/index.ts:156), então isso compila sem tocar em tipos. O `|| undefined` normaliza o `null` que vem do Postgres, evitando que a guarda `{review.merchantReply && ...}` (ReviewCard.tsx:156) receba `null` e para manter consistência com o restante do mapper.

NÃO é necessário versionar/limpar `ikcous_reviews_cache_*`: o cache é sobrescrito por `updateReviewsCache` na linha 109 a cada fetch bem-sucedido, então entradas antigas sem o campo somem sozinhas após o primeiro carregamento. Se ainda assim quiser evitar o flash inicial sem resposta, basta bumpar a constante da linha 15 para `"ikcous_reviews_cache_v2_"` — é opcional, não parte do bug.

Opcional (fora do escopo mínimo): se quiser exibir a data da resposta, é preciso primeiro adicionar `merchantReplyAt?: string;` à interface `Review` em src/types/index.ts (ela não existe hoje) antes de mapear `item.merchant_reply_at`; sem isso o TypeScript rejeita a propriedade extra no literal tipado como `Review[]`.

Nota de consistência (mesmo defeito, mesma origem): considere que a superfície secundária `src/views/customer/UserProfileView.tsx` já mostra a resposta usando o campo cru `merchant_reply`, o que evidencia a divergência de contrato entre os dois caminhos — após a correção, os dois passam a exibir o mesmo conteúdo.

---

### 66. 🟡 Chave "Avaliações dos Clientes" (enableReviews) não desliga nada no app do cliente

`src/views/admin/AdminReviewsView.tsx:99` · **media** · malfuncionamento · _Avaliacoes, perguntas, favoritos, perfil e notificacoes_

**Problema.** O painel admin tem um Switch com rótulo "Exibir notas e comentários nas páginas dos produtos", pill de status "Ativo/Inativo" e toast "Sistema de avaliações habilitado/desabilitado". Mas um grep por `enableReviews` mostra que o flag só é lido dentro do próprio AdminReviewsView (linhas 620, 630, 646, 649, 674) e nos mappers de config (useDataVault/realtimeSyncEngine). Nenhuma view do cliente consulta o valor: ProductView sempre renderiza a seção `#reviews-section` e OrderDetailsView sempre oferece o `ReviewForm` após entrega. O admin desliga achando que escondeu as avaliações e nada muda na loja.

**Reproduzir.** Admin recebe uma avaliação negativa, entra em Avaliações e desliga o Switch "Avaliações dos Clientes" -> vê o pill virar "Inativo" e o toast "Sistema de avaliações desabilitado" -> abre a loja em uma aba anônima e a página do produto continua mostrando a nota média, o gráfico de distribuição e todos os comentários; o cliente também continua conseguindo publicar novas avaliações pela tela do pedido entregue.

```
await updateConfig({ enableReviews: checked });
      toast.success(
        checked
          ? "Sistema de avaliações habilitado"
          : "Sistema de avaliações desabilitado",
      );
```

**Correção.**

Ligar `config.enableReviews` nas superfícies do cliente e, opcionalmente, no banco.

1) src/views/customer/ProductView.tsx (`config` já disponível na linha 257, nenhum import novo necessário):
   - Linha 847: trocar `{reviewCount > 0 && (` por `{config.enableReviews && reviewCount > 0 && (` para esconder a linha de estrelas do cabeçalho.
   - Linha 1089: remover a entrada `{ id: "reviews", label: \`Avaliações (${reviewCount})\` }` do array de abas quando o flag estiver desligado (montar a lista condicionalmente, ex.: `...(config.enableReviews ? [{ id: "reviews", label: ... }] : [])`), senão a aba aponta para uma âncora inexistente.
   - Linhas 1159-1162: envolver todo o bloco `<div id="reviews-section" ref={reviewsSectionRef} ...>` em `{config.enableReviews && ( ... )}`.
   - Linhas 674-678: no objeto JSON-LD, condicionar o spread do `aggregateRating` também ao flag, ex.: `...(config.enableReviews && reviewCount > 0 && { aggregateRating: { ... } })` — caso contrário o dado estruturado continua publicando nota e contagem para os buscadores.
   - Recomendado: pular a chamada de `useReviews()` (destructuring na linha 264) quando desligado, para não disparar fetch inútil de avaliações que não serão exibidas.

2) src/views/customer/OrderDetailsView.tsx (`config` já destructurado na linha 90):
   - Linhas 408-410: incluir o flag na condição do botão "Avaliar": `{config.enableReviews && user && order.status === "delivered" && (reviewedProductIds.has(item.productId) ? ... : ...)}`.
   - Linha 585: garantir que o portal com `<ReviewForm ... />` não abra com o flag desligado (o gate acima já impede o clique, mas convém somar `config.enableReviews &&` na condição de renderização do portal, já que `reviewingItem` pode ficar setado em estado restaurado).

3) Backend (opcional, mas necessário para não ser só cosmético): a policy atual é `CREATE POLICY reviews_insert_policy ON public.reviews FOR INSERT TO authenticated WITH CHECK (((SELECT auth.uid()) = user_id));` em supabase/migrations/20260709001500_cleanup_legacy_rls_policies.sql:76-77. Criar nova migração adicionando ao WITH CHECK uma verificação do tipo `AND COALESCE((SELECT sc.enable_reviews FROM public.store_config sc LIMIT 1), true)`, ou um trigger BEFORE INSERT em public.reviews que levante exceção quando `enable_reviews = false`. Sem isso, um cliente com a página em cache/aba antiga ainda consegue inserir avaliação.

Observação de consistência: usar exatamente o mesmo padrão já aplicado a `enableCoupons` em src/views/customer/CheckoutView.tsx:837 (`{config.enableCoupons && (`).

---

### 67. 🟡 Favoritos de usuário logado somem da lista quando o produto está fora dos 200 mais recentes ou inativo

`src/contexts/FavoritesContext.tsx:188` · **media** · bug · _Avaliacoes, perguntas, favoritos, perfil e notificacoes_

**Problema.** Para o usuário logado a lista de favoritos é derivada por interseção: `allProducts.filter(p => dbFavoriteIds.includes(p.id))`. Mas `allProducts` vem de `StoreContext.fetchProducts`, que aplica `.limit(200)` ordenando por `data_cadastro` desc, sobre a view `vw_produtos_public` que já filtra `ativo = true AND deleted_at IS NULL`. Qualquer favorito que seja o 201º produto mais novo, ou que esteja momentaneamente inativo, simplesmente desaparece da tela de Favoritos — sem mensagem alguma — mesmo continuando salvo na tabela `favorites`. Pior: `isFavorite()` usa `dbFavoriteIds` e continua retornando true, então o coração fica preenchido no card/página do produto enquanto a aba Favoritos jura que o item não existe, e o contador do cabeçalho (`{favorites.length} itens`) mostra um número menor que o real.

**Reproduzir.** Catálogo com 250 produtos ativos. Cliente logado favorita um produto cadastrado há muito tempo (fora dos 200 mais recentes) -> aparece o toast "Adicionado aos favoritos" e o coração fica preenchido -> cliente vai para a aba Favoritos -> o produto não está na grade e o contador não conta ele; se aquele era o único favorito, a tela mostra o estado vazio "Sua lista de desejos tá tão vazia". O mesmo acontece quando o admin desativa temporariamente um produto favoritado.

```
const favorites = React.useMemo(() => {
    return user
      ? allProducts.filter((p) => dbFavoriteIds.includes(p.id))
      : localFavorites;
  }, [user, allProducts, dbFavoriteIds, localFavorites]);
```

**Correção.**

Parar de derivar a lista do catálogo em memória e hidratar os favoritos por id, reaproveitando o padrão que já existe em src/contexts/CartContext.tsx:218-232.

1) Em src/contexts/FavoritesContext.tsx, dentro de `fetchDbFavorites` (linhas 36-53), depois de obter `newIds`, buscar os produtos diretamente:
   - `import { mapProductFromDB } from "@/lib/mappers";`
   - novo estado `const [dbFavoriteProducts, setDbFavoriteProducts] = useState<Product[]>([]);` (manter `dbFavoriteIds`, que `isFavorite` e `toggleFavorite` usam nas linhas 249 e 262).
   - fatiar `newIds` em lotes de ~100 (limite de tamanho de URL do PostgREST) e para cada lote:
     `await supabase.from("vw_produtos_public").select("*, product_variants(*)").in("id", batch)`
     concatenar os resultados e aplicar `mapProductFromDB` em cada item, exatamente como StoreContext.tsx:416-418 faz.
   - trocar o memo da linha 186-190 por: `user ? dbFavoriteProducts : localFavorites` (remove `allProducts` e a dependência de `useProducts`, eliminando também o re-cálculo a cada refetch do catálogo).

2) Cobrir o carregamento de verdade: envolver essa hidratação com o mesmo `setLoading` do bloco de sync (linhas 63-93) e nos disparos de realtime (linhas 128 e 166), para que `loading` passado em App.tsx:2350 (`loading: favoritesLoading`) só fique false quando os cards já existirem. Isso mata o flash de "Sua lista de desejos tá tão vazia" sem precisar acoplar `productsLoading`.

3) Não sumir em silêncio com o que ficou inativo: calcular `const missingIds = dbFavoriteIds.filter(id => !dbFavoriteProducts.some(p => p.id === id))` e expor no contexto. Em src/views/customer/FavoritesView.tsx renderizar, abaixo da grade (após o bloco das linhas 291-320), um aviso do tipo "N item(ns) indisponível(is) no momento" com botão de remover que chame `removeFromFavorites(id)` — e usar `dbFavoriteIds.length` (não `favorites.length`) no contador da linha 283 ou somar os indisponíveis, para o número bater com o que está salvo.

4) Consequência colateral desejada: o `if (favorites.length === 0)` da linha 82 deixa de disparar quando o usuário tem favoritos apenas indisponíveis, porque a tela passa a ter conteúdo a exibir.

---

### 68. 🟡 Contador "Útil" incrementa 2 por clique e o voto pode ser repetido infinitamente

`src/components/ui/custom/ReviewCard.tsx:153` · **media** · bug · _Avaliacoes, perguntas, favoritos, perfil e notificacoes_

**Problema.** Há dois incrementos otimistas concorrentes para o mesmo clique: `useReviews.markHelpful` já atualiza o estado global somando +1 em `review.helpful` (linhas 184-196), e o ReviewCard soma mais +1 na renderização via `hasMarkedHelpful`. O usuário vê o número pular de N para N+2 enquanto o banco só foi incrementado em 1 — a divergência se corrige sozinha no próximo fetch, o que faz o número "cair" depois. Além disso, `hasMarkedHelpful` é só estado local do componente e a RPC `increment_helpful` faz `UPDATE reviews SET helpful = COALESCE(helpful,0) + 1` sem qualquer registro de quem votou, então basta recarregar a página para votar de novo, sem limite.

**Reproduzir.** Avaliação com 3 votos úteis. Cliente clica em "Útil (3)" -> o botão passa a exibir "Útil (5)" imediatamente (3 do banco +1 do markHelpful +1 do hasMarkedHelpful), mas o banco tem 4 -> ao trocar de aba e voltar (ou quando o realtime dispara o refetch), o contador "volta" para 4. Recarregando a página o botão fica habilitado de novo e o mesmo usuário pode inflar o contador indefinidamente.

```
<span>Útil ({review.helpful + (hasMarkedHelpful ? 1 : 0)})</span>
```

**Correção.**

FRONTEND - src/components/ui/custom/ReviewCard.tsx:
1. Linha 153: trocar por `<span>Útil ({review.helpful ?? 0})</span>`. Remover o `+ (hasMarkedHelpful ? 1 : 0)`, porque markHelpful ja aplica o +1 otimista (useReviews.ts:187-191) e ja reverte em caso de erro (useReviews.ts:207-211). Manter hasMarkedHelpful apenas para o `disabled` (linha 143) e para o estilo/fill do icone (linhas 145-151).
2. Linhas 10 e 17-22: mudar a prop para `onHelpful?: (reviewId: string) => Promise<boolean>` e so travar o botao apos sucesso real:
   `const handleHelpful = async () => { if (hasMarkedHelpful || !onHelpful) return; const ok = await onHelpful(review.id); if (ok) setHasMarkedHelpful(true); };`
   Isso corrige o caso convidado (hoje o botao trava com +1 falso mesmo com markHelpful abortando em useReviews.ts:177-180) e o caso de erro da RPC (hoje o contador reverte mas o botao fica travado).

FRONTEND - src/hooks/useReviews.ts:
3. markHelpful (linha 173) deve virar `Promise<boolean>`: `return false` no early-return de `!user` (linha 179) e no `catch` (linha 219-222); `return true` apos a RPC bem-sucedida.
4. Linha 102: trocar `helpful: item.helpful` por `helpful: item.helpful ?? 0`, alinhando com o caminho admin (linhas 271 e 398) e com `number | null` de src/types/supabase.ts:1038.

BACKEND - nova migration em supabase/migrations/ (idempotencia do voto):
5. Criar a tabela de votos:
   `CREATE TABLE public.review_helpful_votes (review_id uuid NOT NULL REFERENCES public.reviews(id) ON DELETE CASCADE, user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE, created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY (review_id, user_id));`
   Habilitar RLS com policy de SELECT restrita a `user_id = auth.uid()` (o INSERT fica so pela RPC SECURITY DEFINER).
6. Substituir public.increment_helpful (definicao vigente em supabase/migrations/20260612000000_security_definer_and_otp_fix.sql:993-1008) por uma versao idempotente que retorna o total novo:
   manter o `IF auth.uid() IS NULL THEN RAISE EXCEPTION` existente; depois
   `INSERT INTO public.review_helpful_votes (review_id, user_id) VALUES (review_id, auth.uid()) ON CONFLICT DO NOTHING;`
   `GET DIAGNOSTICS v_inserted = ROW_COUNT;`
   `IF v_inserted = 1 THEN UPDATE public.reviews SET helpful = COALESCE(helpful,0) + 1 WHERE id = review_id RETURNING helpful INTO v_total; ELSE SELECT COALESCE(helpful,0) INTO v_total FROM public.reviews WHERE id = review_id; END IF; RETURN v_total;`
   Alterar a assinatura para `RETURNS integer`, manter SECURITY DEFINER + `SET search_path TO 'public'`, e repetir os GRANTs no padrao de […]

---

### 69. 🟡 Cancelamento devolve estoque mas nunca devolve o uso do cupom

`supabase/migrations/20260707000000_fix_update_order_status_atomic.sql:63` · **media** · bug · _Supabase: RLS, RPCs, migrations e edge functions_

**Problema.** create_marketplace_order_v22 incrementa coupons.usage_count a cada pedido criado (UPDATE public.coupons SET usage_count = usage_count + 1). update_order_status_atomic, ao cancelar, so restaura estoque de produtos e variantes; nao ha nenhum decremento de usage_count nem consulta ao coupon_id do pedido. O contador so cresce.

**Reproduzir.** Cupom 'BLACK50' com usage_limit = 100. Cinquenta clientes aplicam o cupom, fecham o pedido e cancelam em seguida (ou o admin cancela por falta de pagamento). usage_count fica em 100 mesmo com zero vendas concluidas. O 101o cliente legitimo recebe 'Cupom atingiu o limite de uso.' em validate_coupon_secure_v2 e a campanha morre sem ter vendido nada. O mesmo vale para qualquer taxa normal de cancelamento: o limite do cupom se esgota antes da meta de vendas.

```
-- STOCK RESTORATION LOGIC
    -- If transitioning to 'cancelled' from a non-cancelled status
    IF p_new_status = 'cancelled' AND v_old_status != 'cancelled' THEN
        FOR v_item IN SELECT product_id, variant_id, quantity FROM public.marketplace_order_items WHERE order_id = p_order_id
        LOOP
```

**Correção.**

Criar uma NOVA migration (a 20260707000000 ja foi aplicada) que recria public.update_order_status_atomic(uuid, text, text, boolean) com o corpo atual mais tres mudancas cirurgicas:

1. No bloco DECLARE (hoje linhas 29-35), adicionar: v_coupon_id UUID;

2. Trocar o SELECT com lock da linha 38 por:
   SELECT status, user_id, coupon_id INTO v_old_status, v_user_id, v_coupon_id
   FROM public.marketplace_orders
   WHERE id = p_order_id
   FOR UPDATE;
   (a coluna coupon_id existe: foi adicionada em 20260326000000_fix_order_schema_and_rpc.sql:14 - ALTER TABLE public.marketplace_orders ADD COLUMN coupon_id UUID REFERENCES public.coupons(id) - e e preenchida por create_marketplace_order_v22 na linha 197.)

3. Dentro do MESMO bloco de cancelamento, logo apos o END LOOP da restauracao de estoque (hoje linha 75) e antes do END IF da linha 76, inserir:
   IF v_coupon_id IS NOT NULL THEN
       UPDATE public.coupons
       SET usage_count = GREATEST(0, COALESCE(usage_count, 0) - 1)
       WHERE id = v_coupon_id;
   END IF;

Detalhes que importam: (a) COALESCE e necessario porque coupons.usage_count e nullable (src\types\supabase.ts:313 - "usage_count: number | null"); (b) GREATEST(0, ...) protege contra contador negativo em bases que ja tenham divergencia historica; (c) a guarda existente "AND v_old_status != 'cancelled'" ja impede duplo decremento em cancelamentos repetidos, entao nao e preciso flag extra; (d) tudo roda dentro da mesma transacao serializada pelo FOR UPDATE do pedido, sem lock novo alem da linha do cupom.

Fica registrada uma assimetria conhecida e aceita (mesma que ja existe para estoque, comentada em 20260328000001_fix_stock_restoration_on_cancel.sql:66): a transicao inversa (cancelled -> pending) nao volta a incrementar o usage_count nem a debitar estoque. Se isso for indesejado, tratar no mesmo bloco com "IF p_new_status != 'cancelled' AND v_old_status = 'cancelled'", reincrementando o cupom e revalidando estoque.

Correcao dos dados ja corrompidos (executar uma vez na mesma migration): reconciliar o contador a partir dos pedidos nao cancelados -
UPDATE public.coupons c
SET usage_count = sub.cnt
FROM (
  SELECT coupon_id, COUNT(*)::int AS cnt
  FROM public.marketplace_orders
  WHERE coupon_id IS NOT NULL AND status <> 'cancelled'
  GROUP BY coupon_id
) sub
WHERE c.id = sub.coupon_id AND COALESCE(c.usage_count, 0) <> sub.cnt;
(e zerar os cupons sem nenhum pedido valido remanescente).

---

### 70. 🟡 Painel admin perde o tema escuro quando o StoreContext reaplica config (classe 'dark' removida)

`src/App.tsx:543` · **media** · malfuncionamento · _App shell, roteamento, performance e acessibilidade_

**Problema.** Dois efeitos disputam a classe 'dark' em documentElement. O App adiciona 'dark' quando currentView começa com 'admin', mas o StoreContext, sempre que config.primaryColor ou config.themeMode mudam (e também logo após carregar o cache do DataVault), executa root.classList.remove('dark') quando themeMode é 'light'. O efeito do App não re-executa porque suas dependências ([currentView, config?.themeMode]) não mudaram, então a classe fica removida. O efeito do App também não tem um bloco else para remover 'dark' ao sair do admin quando config.themeMode é falsy, deixando a área do cliente presa em dark.

**Reproduzir.** 1) Admin abre /admin-settings (root ganha 'dark'). 2) Altera a cor primária da loja e salva. 3) updateConfig -> setConfig -> muda config.primaryColor -> efeito do StoreContext roda -> themeMode é 'light' -> root.classList.remove('dark') -> todo o painel admin (desenhado para fundo zinc-950) vira tema claro no meio da sessão, com textos brancos sobre fundo branco, até o admin navegar para outra view. O mesmo ocorre ao abrir /admin-dashboard direto pela URL: o App adiciona 'dark' no mount e, alguns ms depois, o loadFromVault do StoreContext remove.

```
useEffect(() => {
    const root = document.documentElement;
    if (currentView.startsWith("admin")) {
      root.classList.add("dark");
      delete root.dataset.themeMode;
    } else if (config?.themeMode) {
```

**Correção.**

Centralizar a posse da classe 'dark' exclusivamente no efeito de src/App.tsx:543-560 e remover as escritas de tema do StoreContext (que nao conhece a view atual).

1) Em src/contexts/StoreContext.tsx, apagar o bloco de tema do `loadFromVault` (linhas 97-105), mantendo apenas a aplicacao do `--primary` das linhas 91-96:

   // REMOVER:
   if (merged.themeMode === "dark" || merged.themeMode === "glass") {
     document.documentElement.classList.add("dark");
     if (merged.themeMode === "glass") {
       document.documentElement.setAttribute("data-theme-mode", "glass");
     }
   } else {
     document.documentElement.classList.remove("dark");
     document.documentElement.removeAttribute("data-theme-mode");
   }

2) No mesmo arquivo, reduzir o efeito das linhas 161-180 a apenas branding, eliminando o bloco "Sync theme mode with DOM" (linhas 166-179):

   useEffect(() => {
     if (config.primaryColor) {
       applyBranding(config.primaryColor);
     }
   }, [config.primaryColor, applyBranding]);

3) Em src/App.tsx:543-560, tornar o efeito exaustivo (todo caminho grava um estado definido), acrescentando o `else` que hoje falta:

   useEffect(() => {
     const root = document.documentElement;
     if (currentView.startsWith("admin")) {
       root.classList.add("dark");
       delete root.dataset.themeMode;
       return;
     }
     const mode = config?.themeMode ?? "light";
     if (mode === "dark") {
       root.classList.add("dark");
       delete root.dataset.themeMode;
     } else if (mode === "glass") {
       root.classList.add("dark");
       root.dataset.themeMode = "glass";
     } else {
       root.classList.remove("dark");
       delete root.dataset.themeMode;
     }
   }, [currentView, config?.themeMode]);

Por que basta: as deps `[currentView, config?.themeMode]` ja cobrem os dois unicos eventos que devem alterar o tema (troca de view e troca de themeMode). Quando o config real chega do vault ou da rede com themeMode diferente do default "light", a dep muda e o efeito reexecuta; quando so `primaryColor` muda, o tema corretamente nao e tocado. O `?? "light"` fecha o caso de `themeMode` nulo (possivel via src/hooks/useDataVault.ts:151 e src/lib/realtimeSyncEngine.ts:107, que gravam `raw.theme_mode` cru no vault), garantindo que sair do admin sempre limpe a classe.

Alternativa minima, se nao quiser mexer no StoreContext: guardar as duas remocoes (StoreContext.tsx:103 e :176) com `if (!document.documentElement.classList.contains("admin-mode"))`. A classe `admin-mode` ja existe e e gerenciada em src/components/layouts/AdminLayout.tsx:59-64. […]

---

### 71. 🟡 Tela de produto fica em branco quando o produto não está entre os 200 carregados

`src/App.tsx:1939` · **media** · bug · _App shell, roteamento, performance e acessibilidade_

**Problema.** renderCustomerSecondaryView retorna null quando o produto não é achado no array local `products`. Esse array vem do StoreContext, que faz .limit(200) em vw_produtos_public. O efeito de verificação (verifyProduct) consulta o banco e, se o produto EXISTE, apenas loga 'avoiding redirect' e não faz nada — nem busca o produto, nem mostra erro. O resultado é uma página permanentemente vazia sob o header, sem loading, sem mensagem e sem redirect.

**Reproduzir.** Loja com mais de 200 produtos. Usuário abre um link compartilhado /product-detail?id=<id de um produto antigo, fora dos 200 mais recentes>. syncWithUrl seta currentView='product-detail' e selectedProductId. getProductById(products, id) retorna undefined -> `if (!product) return null`. verifyProduct confirma no banco que o produto existe e não redireciona. O usuário vê header + BottomNav com o miolo totalmente branco, para sempre. O mesmo acontece em navegação offline com o DataVault parcialmente populado.

```
case "product-detail": {
        const product = selectedProductId
          ? getProductById(products, selectedProductId)
          : null;
        if (!product) return null;
```

**Correção.**

Reaproveitar o `fetchProduct` que JA existe em src/hooks/useProducts.ts:219-273 (faz `.from("vw_produtos_public").select("*").eq("id", id).single()` + variantes de product_variants e retorna `mapProductFromDB`), em vez de escrever uma query nova.

1. Em src/App.tsx:493 passar a extrair tambem a funcao: `const { products, loading: productsLoading, fetchProduct } = useProducts();`.
2. Criar estado local no AppContent: `const [fallbackProduct, setFallbackProduct] = useState<Product | null>(null);` e `const [productFetchState, setProductFetchState] = useState<"idle" | "loading" | "error">("idle");`.
3. No efeito de src/App.tsx:1807-1866, no ramo `if (!product)`: antes do await, `setProductFetchState("loading")`. Trocar a query de verificacao por `const remote = await fetchProduct(selectedProductId);`.
   - Se `remote && active`: `setFallbackProduct(remote); setProductFetchState("idle");` (mantendo o comportamento de NAO redirecionar).
   - Se `!remote && active`: se `navigator.onLine === false`, `setProductFetchState("error")` (nao redirecionar offline, para nao jogar o usuario para a home por falha de rede); caso contrario manter o redirect atual para "home" com o `history.replaceState`.
   - Cuidado: `fetchProduct` chama `setLoading` interno do hook, mas como App usa autoFetch=true o `loading` retornado e o do contexto (useProducts.ts:163), entao nao ha efeito colateral em `productsLoading`.
4. Limpar o cache ao trocar de produto, para nao exibir item errado: no inicio do mesmo efeito, `if (fallbackProduct && fallbackProduct.id !== selectedProductId) setFallbackProduct(null);` (ou um efeito separado com dependencia [selectedProductId]).
5. Em src/App.tsx:1939-1943 substituir por:
   const product = selectedProductId
     ? (getProductById(products, selectedProductId) ??
        (fallbackProduct?.id === selectedProductId ? fallbackProduct : null))
     : null;
   if (!product) {
     if (productFetchState === "error") return <estado de erro com botao "Voltar ao inicio" chamando handleNavigate("home")>;
     return <ViewLoadingFallback />;  // componente ja existente, usado na linha 2612
   }
6. Opcional (reduz a causa raiz): o mesmo tratamento vale para o `product-detail` sem `id` — hoje tambem cai em `return null` silencioso.

---

### 72. 🟡 Filtro de categoria da Home é zerado toda vez que o usuário troca de aba

`src/App.tsx:1541` · **media** · ux · _App shell, roteamento, performance e acessibilidade_

**Problema.** syncWithUrl lê o parâmetro ?category da URL e chama setSelectedCategory a cada execução, ANTES do early-return de 'mesmo destino'. Como o efeito que contém syncWithUrl tem currentView e selectedProductId nas dependências, ele roda a cada navegação. As URLs geradas por performTransition (`/${targetView}`) não carregam o parâmetro category, então qualquer navegação para fora da home reseta o filtro para 'Todas'. A HomeView permanece montada (DeferredTabContent), mas recebe selectedCategory='Todas' e volta a mostrar todos os produtos.

**Reproduzir.** 1) Usuário na Home seleciona a categoria 'Eletrônicos' (handleCategoryChange grava ?category=Eletrônicos via replaceState). 2) Toca em 'Carrinho' no BottomNav -> pushState('/cart') -> efeito roda -> syncWithUrl lê location.search de '/cart' (sem category) -> setSelectedCategory('Todas'). 3) Usuário toca em 'Início' -> a Home reaparece já sem o filtro, mostrando o catálogo inteiro. O usuário precisa reselecionar a categoria a cada ida e volta entre abas.

```
const urlParams = new URLSearchParams(globalThis.location.search);
        const categoryParam = urlParams.get("category") || "Todas";
        setSelectedCategory(categoryParam);
```

**Correção.**

Aplicar a categoria vinda da URL apenas quando houver uma mudança real de URL (popstate/carga inicial), nunca nas re-execuções programáticas do efeito.

1) Em src/App.tsx, transformar `syncWithUrl` em `const syncWithUrl = (fromPopState = false) => {` (linha 1383) e, em 1541-1543, manter a criação de `urlParams` (ela ainda é usada em 1544 para `queryId`) mas condicionar só o setter:

    const urlParams = new URLSearchParams(globalThis.location.search);
    if (fromPopState) {
      setSelectedCategory(urlParams.get("category") || "Todas");
    }

2) Nos call sites: manter `syncWithUrl();` na linha 1682 (a montagem inicial já é coberta pelo initializer do useState em 597-603, que lê `?category` da URL) e trocar a chamada dentro de `handlePopState` na linha 1774 por `syncWithUrl(true);` — assim voltar/avançar no histórico continua reconciliando o filtro corretamente, inclusive limpando-o quando a entrada de histórico não tem o parâmetro.

3) Complemento para manter a URL coerente com o filtro visível (evita que uma atualização de página na home perca o filtro): em `performTransition` (linha 865) montar o path da home preservando a categoria ativa, e fazer o mesmo no trap da home (1669-1675), usando `globalThis.location.search` ou reconstruindo a partir de `selectedCategory`:

    let path = targetView === "home"
      ? (selectedCategory && selectedCategory !== "Todas"
          ? `/?category=${encodeURIComponent(selectedCategory)}`
          : "/")
      : `/${targetView}`;

   (adicionar `selectedCategory` às deps do useCallback de `handleNavigate`, ou ler de um `selectedCategoryRef` para não recriar o handler a cada troca de filtro).

Alternativa de menor superfície, se não quiser mexer no roteamento: mover `selectedCategory`/`sortBy` para dentro de `HomeView` (que permanece montada via `DeferredTabContent`), deixando o App apenas semear o valor inicial a partir da URL.

---

### 73. 🟡 `* { outline: none !important }` anula todo indicador de foco do teclado no app inteiro

`src/index.css:138` · **media** · ux · _App shell, roteamento, performance e acessibilidade_

**Problema.** A regra universal dentro de @layer base declara outline: none com !important em todos os elementos. Como declarações !important sempre vencem declarações normais na mesma origem, a regra de acessibilidade definida no próprio arquivo (`:focus-visible { outline: 2px solid black; outline-offset: 2px; }`) nunca é aplicada — é código morto. Componentes shadcn sobrevivem porque usam focus-visible:ring (box-shadow), mas todos os <button> customizados do app shell (Voltar, logo, sino de notificações, carrinho do Header, chips de categoria, cards de produto) ficam sem qualquer indicação visual de foco.

**Reproduzir.** Usuário que navega por teclado (ou com switch/teclado externo em tablet) pressiona Tab a partir do topo da página. O foco percorre o botão 'Voltar', o logo, o sino de notificações e o botão do carrinho do Header sem NENHUMA mudança visual — não há outline, borda nem ring nesses botões. O usuário não tem como saber onde está e não consegue operar a navegação principal sem o mouse. Falha WCAG 2.4.7 (Focus Visible).

```
@layer base {
  * {
    @apply border-border;

    /* Hide scrollbars globally */
    -ms-overflow-style: none; /* IE and Edge */
    scrollbar-width: none; /* Firefox */
    outline: none !important;
    -webkit-tap-highlight-color: rgb(0 0 0 / 0%) !important;
  }
```

**Correção.**

Correcao em duas partes (a segunda e obrigatoria, foi omitida na proposta original).

PARTE 1 - src/index.css: remover o !important do seletor universal e reposicionar a regra de foco.

Em src/index.css:132-140, apagar apenas a linha `outline: none !important;` do bloco `*` (manter `@apply border-border`, os dois esconde-scrollbar e o `-webkit-tap-highlight-color`), e logo abaixo, ainda dentro do mesmo `@layer base`, acrescentar:

  /* Mata o anel nativo so quando o foco NAO e por teclado */
  *:focus:not(:focus-visible) {
    outline: none;
  }

  :focus-visible {
    outline: 2px solid hsl(var(--ring));
    outline-offset: 2px;
  }

Depois, remover o bloco duplicado e agora obsoleto de src/index.css:422-426 (`/* Focus visible styles */ :focus-visible { outline: 2px solid black; ... }`).

Usar `hsl(var(--ring))` em vez de `black` ou `currentColor` dispensa o override `.dark` sugerido: o token `--ring` ja e redefinido em `.dark` (240 4.9% 83.9%, linha 96) e em cada paleta `[data-theme=...]` (linhas 103, 109, 115, 121), entao o painel admin em fundo escuro ganha contraste automaticamente.

Manter intactos os "Recharts strict focus killers" de src/index.css:221-227 - sao escopados e continuam validos.

PARTE 2 - remover as classes `outline-none` que anulariam a Parte 1.

Como `outline-none` do Tailwind 3 gera `outline: 2px solid transparent; outline-offset: 2px` (especificidade 0,1,0, camada utilities, portanto vence `:focus-visible` por ordem de fonte), apagar a classe `outline-none` de:
  - src/components/ui/custom/Header.tsx:179 (botao do logo)
  - src/components/ui/custom/CategoryFilter.tsx:57 (chip de categoria)
Nao e preciso mexer em src/components/ui/custom/BottomNav.tsx:94: ele tambem tem `outline-none`, mas ja fornece `focus-visible:ring-2 focus-visible:ring-zinc-900/50`, que e box-shadow e permanece visivel.

VERIFICACAO: apos a mudanca, dar Tab a partir do topo e conferir anel visivel em Header.tsx:165 (Voltar), :178 (logo), :337 (carrinho), :354 (sino), nos chips de CategoryFilter.tsx:57 e no card focavel de ProductCard.tsx:129-130.

---

### 74. 🟡 Prefetch preditivo/Markov roda a cada render: 2 gravações em localStorage por render e previsão sempre inútil

`src/hooks/useBehavioralPrefetch.ts:57` · **media** · performance · _App shell, roteamento, performance e acessibilidade_

**Problema.** useNetworkAdaptive retorna um objeto novo com uma função isSlow nova a cada render. Isso invalida o useCallback de prefetchView em usePrefetchOnHover ([isSlow]), que por sua vez invalida as dependências deste efeito ([currentPath, updateMarkovChain, getPrediction, prefetchCallback]). Resultado: updateMarkovChain(currentPath) executa em TODO render do AppContent, fazendo JSON.parse + JSON.stringify + 2 gravações síncronas em localStorage. Pior: como currentPath é sempre igual ao passo anterior, a cadeia grava transições de um estado para ele mesmo (markov_home = {home: N}), que dominam a ordenação e fazem getPrediction sempre devolver o próprio currentPath — bloqueado logo depois pelo guard `prediction !== currentPath`. A funcionalidade de prefetch preditivo, portanto, nunca prevê nada.

**Reproduzir.** Usuário rola a Home: o IntersectionObserver muda scrollProgress, o carrinho muda cartCount, etc. Cada um desses renders do AppContent dispara este efeito -> 2 leituras + 2 escritas síncronas em localStorage na main thread (bloqueantes) e 'pwa_nav_history' vira ['home','home','home',...]. Em paralelo, usePredictiveNavigation (linhas 45-50) tem [currentView, prefetchView] como deps: seu setTimeout de 2000ms é cancelado e recriado a cada render, então em telas que re-renderizam com frequência o prefetch preditivo nunca chega a disparar. O mesmo vale para o prefetchAll do App.tsx (linha 1898-1905), cujo timer de 800ms é reiniciado a cada render.

```
useEffect(() => {
    updateMarkovChain(currentPath);

    const prediction = getPrediction();
    if (prediction && prediction !== currentPath) {
```

**Correção.**

Tres partes. A parte 1 sozinha ja mata as duas falhas principais deste achado; as partes 2 e 3 sao necessarias para os efeitos em cascata e para os usuarios que ja tem localStorage envenenado.

PARTE 1 (obrigatoria, em src/hooks/useBehavioralPrefetch.ts) — guard de path por ref. Torna o efeito idempotente por navegacao, independentemente de quantas vezes AppContent re-renderizar, e elimina de vez as auto-transicoes:

  import { useCallback, useEffect, useRef } from "react";
  ...
  const lastPathRef = useRef<string | null>(null);

  useEffect(() => {
    if (lastPathRef.current === currentPath) return;
    lastPathRef.current = currentPath;

    updateMarkovChain(currentPath);

    const prediction = getPrediction();
    if (prediction && prediction !== currentPath) {
      if (prefetchCallback) prefetchCallback(prediction);
    }
  }, [currentPath, updateMarkovChain, getPrediction, prefetchCallback]);

Recomendo tambem trocar o console.log das linhas 62-64 por algo guardado em `import.meta.env.DEV`, pois hoje ele iria para o console de producao a cada previsao.

PARTE 2 (em src/hooks/useNetworkAdaptive.ts) — estabilizar o retorno, corrigindo tambem usePredictiveNavigation (timer de 2000ms) e o prefetchAll do App.tsx (timer de 800ms), que hoje sao reiniciados a cada render.

ATENCAO A UMA ARMADILHA que a correcao original nao previu: ja existe uma funcao de modulo chamada `getQuality()` na linha 12, usada dentro do useEffect nas linhas 68, 74 e 75 (`notifySW(getQuality())`). Se voce criar um `const getQuality` no escopo do hook, essas chamadas passam a resolver para o getter memoizado (que so le `qualityRef.current`) em vez do detector real, e a deteccao de rede quebra silenciosamente. Use nome diferente:

  import { useCallback, useEffect, useMemo, useRef } from "react";
  ...
  const readQuality = useCallback(() => qualityRef.current, []);
  const isSlow = useCallback(
    () => qualityRef.current === "slow" || qualityRef.current === "offline",
    [],
  );
  return useMemo(
    () => ({ getQuality: readQuality, isSlow }),
    [readQuality, isSlow],
  );

O contrato publico `{ getQuality, isSlow }` fica identico, entao os consumidores (usePrefetchOnHover.ts:56 e App.tsx:983) nao mudam. Como `qualityRef` e um ref, as deps vazias sao corretas — nao ha stale closure.

PARTE 3 (migracao unica, senao a Parte 1 nao restaura a previsao para quem ja usa o app) — as chaves `markov_*` ja gravadas em producao contem auto-transicoes com contagem altissima que continuarao dominando o sort da linha 45 para sempre. Rode uma limpeza no mount de useBehavioralPrefetch, […]

---

### 75. ⚪ Guard de admin confia em app_metadata lido do localStorage, permitindo bypass no cliente

`src/contexts/AuthContext.tsx:86` · **baixa** · seguranca · _Autenticacao, sessao e controle de acesso_

**Problema.** O estado inicial de isAdmin vem de getCachedSession(), que faz JSON.parse de um item do localStorage, e de cachedSession.user.app_metadata?.role. O supabase-js nao verifica assinatura do JWT no cliente: session.user e apenas o JSON armazenado. A mesma leitura e usada no "Fast Path 1" de checkAdmin, que retorna cedo e nunca dispara a verificacao de rede, contradizendo o comentario do proprio arquivo ("Await the network check to prevent privilege bypass on client spoofing").

**Reproduzir.** 1) Usuario comum loga normalmente. 2) Abre o DevTools, edita a chave `sb-<ref>-auth-token` no localStorage e insere `"app_metadata":{"role":"admin"}` no objeto user. 3) Recarrega a pagina: cachedIsAdmin vira true, App.tsx renderiza <AdminArea/> em vez de <AdminAccessDenied/>, e checkAdmin retorna no Fast Path 1 gravando ikcous_is_admin_<uid>=true. 4) Todo o bundle e a navegacao administrativa ficam acessiveis (dados sao barrados pelo RLS, mas a superficie admin inteira e exposta e qualquer endpoint sem is_admin() no servidor fica alcancavel).

```
const cachedIsAdmin = (() => {
    if (!cachedSession?.user) return false;
    return cachedSession.user.app_metadata?.role === "admin";
  })();
```

**Correção.**

Tratar o Fast Path 1 como confiável apenas quando o objeto `User` veio de uma fonte verificada pelo servidor, e tratar o cache do localStorage como hint puramente cosmético.

1. Em `src/contexts/AuthContext.tsx`, mudar a assinatura para `const checkAdmin = async (u: User | null | undefined, verified = false)` e condicionar o atalho:
```ts
const jwtRole = u.app_metadata?.role;
if (verified && jwtRole === "admin") {
  setIsAdmin(true);
  localStorage.setItem(cacheKey, "true");
  return;
}
```
Passar `true` apenas na chamada da linha 335, que usa `verifiedUser` vindo de `supabase.auth.getUser()`. As chamadas do listener `onAuthStateChange` (linhas 421 e 449) recebem `session.user`, que em `INITIAL_SESSION` e no `SIGNED_IN` emitido por `_recoverAndRefresh` vem cru do localStorage — devem ficar com `verified = false` e, portanto, sempre chegar ao `networkCheck()`.

2. Fechar o ramo degradado: no early-return do timeout de `getSession` (linhas 277-282) e no `catch` da linha 342, chamar `setIsAdmin(false)` antes de sair, para que uma falha de verificação nunca deixe um `isAdmin` herdado do cache de pé.

3. Não semear `isAdmin` com `cachedIsAdmin` (linha 97). Iniciar `useState<boolean>(false)` e, se quiser evitar flash de tela para admins legítimos, usar `cachedIsAdmin` só para escolher o skeleton (`AdminRouteLoading`) enquanto `loading` é true, nunca para renderizar `<AdminArea/>` em `src/App.tsx:2595`.

4. Registrar no comentário da linha 130 que `app_metadata` só é "criptograficamente seguro" quando lido de uma resposta do servidor — no objeto de sessão em cache ele é texto editável — e ajustar/remover o comentário enganoso da linha 200.

Observação importante para priorização: nada disso é um controle de segurança (quem edita localStorage também edita estado React). O controle real já está no servidor via `public.is_admin()` sobre claims de JWT assinado + RLS, e permanece íntegro. Trate como correção de invariante e de UX (evita render do shell admin com dados vazios/erros de RLS), não como fechamento de escalonamento de privilégio.

---

### 76. ⚪ "Volume Total" do KPI e o total do donut de categorias nunca batem quando há cupom de desconto

`supabase/migrations/20260704170000_reconcile_category_analytics_frete.sql:23` · **baixa** · bug · _Admin: dashboard, analytics, clientes e cupons_

**Problema.** Os dois números aparecem na mesma tela mas são calculados com bases diferentes. O KPI 'Volume Total' usa executive.totalRevenue = SUM(marketplace_orders.total), que já é subtotal + frete − desconto (o create_marketplace_order_v22 grava total = GREATEST(0, subtotal + frete − desconto)). Já o donut soma as linhas devolvidas por get_category_analytics, que é SUM(oi.price * oi.quantity) por categoria + uma linha 'Frete' com SUM(o.shipping), sem subtrair desconto nenhum. Além disso o INNER JOIN com produtos descarta itens cujo produto foi removido de verdade da tabela. O centro do donut mostra formatCurrency(totalRevenue) com essa soma inflada.

**Reproduzir.** 1) A loja tem R$ 10.000 de itens vendidos, R$ 500 de frete e concedeu R$ 800 em cupons. 2) O card 'Volume Total' exibe R$ 9.700 (SUM(total)). 3) O centro do gráfico 'Divisão de Faturamento' exibe R$ 10.500 na mesma tela. 4) O admin não consegue conciliar os dois valores e não há nenhuma legenda explicando a diferença; ao esconder categorias, o percentual também é calculado sobre essa base diferente.

```
COALESCE(p.categoria, 'Geral')::text as name,
            SUM(oi.price * oi.quantity)::numeric as value,
            COUNT(DISTINCT o.id)::bigint as orders,
...
            'Frete'::text as name,
            SUM(o.shipping)::numeric as value,
```

**Correção.**

Corrigir na origem, no SQL, criando uma nova migração que redefine `public.get_category_analytics` ratear o desconto do pedido proporcionalmente ao subtotal de cada categoria — assim a soma das fatias passa a fechar com `SUM(marketplace_orders.total)` do KPI "Volume Total".

Esqueleto aplicável (substitui o CTE `category_sums` da migração 20260704170000, mantendo a linha 'Frete' intacta):

```sql
WITH order_cat AS (
    SELECT o.id AS order_id,
           COALESCE(p.categoria, 'Geral')::text AS cat,
           SUM(oi.price * oi.quantity)::numeric AS cat_subtotal
    FROM public.marketplace_order_items oi
    JOIN public.produtos p ON oi.product_id = p.id
    JOIN public.marketplace_orders o ON oi.order_id = o.id
    WHERE o.created_at >= start_date AND o.created_at <= end_date
      AND o.status NOT IN ('cancelled', 'returned')
    GROUP BY o.id, COALESCE(p.categoria, 'Geral')
),
order_base AS (
    SELECT order_id, SUM(cat_subtotal) AS order_subtotal
    FROM order_cat GROUP BY order_id
),
order_cat_net AS (
    SELECT oc.cat,
           oc.order_id,
           oc.cat_subtotal
             - (COALESCE(o.discount, 0) * oc.cat_subtotal
                / NULLIF(ob.order_subtotal, 0)) AS net_value
    FROM order_cat oc
    JOIN order_base ob ON ob.order_id = oc.order_id
    JOIN public.marketplace_orders o ON o.id = oc.order_id
),
category_sums AS (
    SELECT oc.cat AS name,
           ROUND(SUM(oc.net_value)::numeric, 2) AS value,
           COUNT(DISTINCT oc.order_id)::bigint AS orders,
           CASE WHEN COUNT(DISTINCT oc.order_id) > 0
                THEN ROUND((SUM(oc.net_value) / COUNT(DISTINCT oc.order_id))::numeric, 2)
                ELSE 0 END AS avg_ticket
    FROM order_cat_net oc
    GROUP BY oc.cat
    UNION ALL
    -- manter o bloco 'Frete' exatamente como está hoje (linhas 39-51 da migração atual)
    ...
)
```

Observações que validei e que tornam o rateio seguro:
- `create_marketplace_order_v22` limita o desconto ao subtotal (`IF v_discount_amount > v_calculated_subtotal THEN v_discount_amount := v_calculated_subtotal;`, linhas 178-180), então `net_value` nunca fica negativo e nenhuma fatia negativa chega ao Recharts.
- Como `discount <= subtotal` e `shipping >= 0`, o `GREATEST(0, ...)` da linha 183 nunca é acionado, logo `subtotal - discount + shipping` reproduz exatamente `SUM(total)`.
- `NULLIF(ob.order_subtotal, 0)` evita divisão por zero em pedidos sem itens vinculáveis.

Complemento no front-end (`src/components/admin/dashboard/StrategicIntelligenceBlocks.tsx`), independente do SQL:
- O rótulo `"Total"` da linha 81 é ambíguo; com […]

---
