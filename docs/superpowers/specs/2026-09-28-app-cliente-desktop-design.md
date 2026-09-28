# App do cliente com cara de site no computador (28/09/2026)

## 0. Pedido e escopo

O Gabriel abriu a loja num PC a 1920px e viu layout de celular esticado:
- a barra de baixo (Início/Favoritos/Carrinho/Perfil) flutua no meio da tela;
- o banner vai de ponta a ponta;
- cards e fotos ficam enormes (Favoritos: duas colunas com fotos de ~930px);
- o checkout é uma coluna de 448px no meio;
- Perfil e Configurações ficam numa coluna estreita com o resto vazio.

Ele pediu "site profissional de qualidade alta" no computador (e em tudo que abra "igual um desktop"). O celular deve ficar **exatamente** como está.

- **Quem sente:** o cliente da loja que compra pelo computador. Está no escopo (é o app, não é clonagem nem cobrança).
- **Só layout.** Não muda banco, RPC, edge function, regra de negócio, painel admin, service worker, `vercel.json`, `scripts/portaoDividido.ts`, `tailwind.config.js` nem `vite.config.ts`.
- **Nenhuma tela nova.** Só telas que já existem e as peças de casca de site: cabeçalho de site, rodapé e menu lateral da conta.

## 1. Inventário do app do cliente (código em f2e907bf)

**Como a casca funciona hoje** (`src/App.tsx`):
- O `<Header>` fica fora da área de rolagem (preso no topo).
- A rolagem acontece dentro de `<main id="conteudo">` para as telas secundárias.
- As quatro abas principais (home, favorites, cart/orders, profile) ficam montadas lado a lado. Cada uma é um `TabWrapper` com posição absoluta e rolagem própria (`overflow-y-auto`, classe `gpu-accelerated`, que cria um `transform`).

Consequências:
- Um `sticky` dentro de uma página gruda no topo do **painel**, logo abaixo do cabeçalho. Nunca é relativo à janela.
- Um `fixed` dentro de um painel com `transform` é relativo ao painel. Por isso as barras fixas são portadas para o `document.body`.

**Uso das telas de 1024px para cima (`lg:` e acima) no código de hoje:**
- Classes `lg:` só em `CartView` (duas colunas), `CartFooterSummary` (`lg:hidden`), `ProductView` (galeria e relacionados), `ProductList`, `SearchView`, `OrderList` e no `ImageAdjuster` do admin.
- Classes `md:` (768px) espalhadas pela casca e pelas barras (ver §2).
- `src/App.css` (com um `.container-desktop` de 480px) **não é importado por ninguém**. É código morto.

### 1.1 Telas (rotas em `src/config/rotas.ts`)

| Tela / view | Arquivos | Compartilhados que usa | Estados | Hoje em ≥1024 |
|---|---|---|---|---|
| **Início** (`home`; `recently-viewed` aponta para a HomeView mas renderiza vazio — defeito existente, fora do escopo) | `views/customer/HomeView.tsx` | BannerCarousel, InfoBlockCarousel+FreeShippingBlock, ProductCarousel, PremiumOffers, CategoryFilter, ProductList → ProductCard, ProductCardSkeleton, Skeleton; CartReminder (App) | carregando (esqueletos de banner, seções e grade; memória da última visita decide a reserva); com/sem banner; categoria filtrada; resultado de busca do topo; catálogo vazio ("Nenhum produto agora"); menu Ordenar aberto; bloco de horário | Banner 4:1 de ponta a ponta (1920×480). Prateleiras com cards de 260px rolando na horizontal, **sem setas e sem barra de rolagem** (mouse não rola). Ofertas: um herói na largura toda. Catálogo com 4 colunas na largura toda (~460px por card, foto ~575px de altura). Barra de filtro sticky na largura toda. |
| **Produto** (`product-detail`) | `views/customer/ProductView.tsx` | ProductCard (relacionados), ReviewCard, ProductQA, StarRating, QuantitySelector, MarkdownRenderer, ProductCardSkeleton | com/sem variações; esgotado; com/sem avaliações (flag `enableReviews`); WhatsApp só com número; barra de compra dockada ao rolar; abas sticky | Galeria `lg:aspect-square` na largura toda (**1920×1920**) com a foto limitada a `lg:h-[70vh]`. Informações em coluna de largura total (`px-5`). Relacionados em 4 colunas. Barra dockada vira pílula de 448px acima da pílula da navegação (`md:bottom-[88px]`). |
| **Busca** (`search`; só por URL `/search`, nada navega para ela) | `views/customer/SearchView.tsx` | ProductCard, Sheet (filtros) | vazio sem termo; resultados; sem resultado + sugestões; filtros abertos | Contida em `max-w-7xl` com grade de 4 colunas (ok). A folha de filtros é de baixo e ocupa **1920px** de largura. |
| **Favoritos** (`favorites`) | `views/customer/FavoritesView.tsx` | ProductCard, ProductCardSkeleton | carregando; erro; vazio (herói + 4 sugestões); lista + CTA flutuante "Descobrir Mais" | Grade **sempre de 2 colunas** (cards de ~930px). O vazio fica numa coluna de 448px. O CTA é uma pílula centrada acima da navegação. |
| **Carrinho** (`cart`) | `views/customer/CartView.tsx` | CartItemsList, ShippingCalculator, ShippingProgress, EmptyCart, CartFooterSummary, AddressList, Sheet ("Entregar em"), QuantitySelector | vazio; com itens; convidado ou logado; seletor de endereço (logado com endereços); frete grátis | **Já tem 2 colunas** (`max-w-7xl`, resumo de 380px sticky `top-24`, "Finalizar Compra"). A barra de rodapé já some (`lg:hidden`). O segmentado Carrinho \| Meus pedidos ocupa a largura toda. |
| **Meus pedidos** (`orders`, aba do CartView) | CartView + `OrderList.tsx`, `OrderSearch.tsx` | CustomerPaymentBadge | convidado (busca por dados + OTP); logado sem ou com pedidos; sub-abas Em andamento/Histórico | Grade de 3 colunas na largura toda (`px-6`, sem limite). Sub-abas em 448px. |
| **Checkout** (`checkout`) | `views/customer/CheckoutView.tsx` (5346 linhas; subtelas `AddressSelectionView`, `SuccessView`, `PagamentoConfirmadoView`, `PagamentoForaDoPrazoView`, `GatilhoDoResumoDoPedido`) | CouponInput, AddressForm, AddressList, SaidaDaRecusa, IconesDePagamento, `checkout/PagamentoOnline` + `PagamentoComCartao` (Brick) | auth carregando; convidado (P6: pagamento online bloqueado, vira "Entrar"); logado; endereço novo/editar; painel "Resumo do pedido" aberto (portado para baixo do header); erros de validação; recusa; etapa de pagamento (PIX com QR / cartão); sucesso; pago; fora do prazo | **Coluna de 448px no meio** (`mx-auto max-w-md`). O gatilho do resumo fica portado no centro do header (`HEADER_CENTER_SLOT_ID`). A barra do total é fixa em pílula de 448px (`md:bottom-[104px]`). Espaçador de 200px. |
| **Pedido feito** (`order-success`) | `views/customer/OrderSuccessView.tsx` | — | único | Coluna de 320px centrada. |
| **Detalhe do pedido** (`order-details`) | `views/customer/OrderDetailsView.tsx` | OrderTimeline? (não), CustomerPaymentBadge, ReviewForm, `devolucao/DevolucaoDoPedidoCard`, `devolucao/SolicitarDevolucaoSheet` | status (novo, pago, enviado, entregue, cancelado); rastreio; avaliar item (modal próprio em portal, bottom sheet); devolução elegível ou em andamento; ações (comprovante, cancelar, WhatsApp) | Cabeçalho na largura toda (`px-6`). Cartões em `max-w-2xl` (672px). Modal de avaliação é um bottom sheet de 448px. **A folha de devolução já vira diálogo central a partir de `sm`** (nada a fazer). |
| **Perfil** (`profile`; sem sessão, redireciona para `auth`) | `views/customer/ProfileView.tsx` | AddressList, OrderTimeline, IconeWhatsapp, Dialog (avatar e capa), Button | logado; admin (cartão "Modo Admin" → painel); endereços recolhíveis; pedidos em andamento; menu (Configurações, Sobre a loja); Encerrar sessão | Capa `h-48` de ponta a ponta. Conteúdo em `max-w-md` (448px) centrado. |
| **Configurações da conta** (`account-settings`) | `views/customer/AccountSettingsView.tsx` | Dialog (avatar e capa), inputs | abas Perfil/Segurança; troca de senha (senha comprometida) | `max-w-md` centrado. |
| **Endereço** (`address-form`) | `views/customer/AddressFormView.tsx` | AddressForm (`md:grid-cols-2` já existe) | novo/editar | `max-w-md`. |
| **Perfil público** (`user-profile`, a partir de ReviewCard/ProductQA; exige login) | `views/customer/UserProfileView.tsx` | StarRating | carregando; erro; não encontrado; avaliações e perguntas | Capa de ponta a ponta + `max-w-md`. |
| **Sobre a loja** (`about-store`) | `views/customer/AboutStoreView.tsx` | IconeWhatsapp, DOMPurify, mapa (iframe do Google) | blocos só existem com dado; botão flutuante do WhatsApp só com número | `max-w-md`. Botão flutuante em `right-4`, `bottom: calc(--nav-height + 20px)` (estilo inline). |
| **Notificações** (`notifications`) | `views/customer/NotificationsView.tsx` | Button | carregando; vazio; lista com filtros; marcar todas lidas | **Largura toda sem limite** (itens de 1920px). |
| **Login/cadastro** (`auth`, `login`) | `views/shared/AuthView.tsx` | — | login, signup, forgot, reset-prompt, new-password, confirmação por e-mail | Cartão de 440px centrado (estilos `sm:` já existem). |
| **Manutenção** | `App.tsx` (`MaintenanceView`) | — | — | Centrado (ok). |

### 1.2 O que aparece por cima (casca e overlays)

| Peça | Arquivo | Hoje em ≥1024 |
|---|---|---|
| Cabeçalho (logo, busca, sino, voltar, cápsula de aviso "ilha") | `components/ui/custom/Header.tsx`, `BarraSuperiorCliente.tsx`, `utils/headerToast.ts` | `md:grid-cols-[180px,1fr,auto]`: logo no canto esquerdo, busca de 512px, sino no canto direito. Altura `--header-height` = 52px. |
| Dropdown da busca + véu | `components/ui/custom/SearchBar.tsx` | `fixed`, centrado na **janela**, largura máxima 512px, `top: header + 6px`. |
| Barra de navegação de baixo | `components/ui/custom/BottomNav.tsx` (+ fallback copiado em `App.tsx` ~l.2976) | Pílula flutuante de 448px, `bottom-6`, centrada. É o alvo do "voo" do carrinho (`#bottom-nav-cart`, `utils/cartAnimation.ts`). |
| Folha de opções do card | `ProductCard.tsx` (Sheet `side="bottom"`, `sm:max-w-md`) | Folha de 448px colada embaixo. |
| Folha "Entregar em" | `CartView.tsx` | Idem. |
| Folha de filtros da busca | `SearchView.tsx` | Folha na largura toda. |
| Folha de devolução | `devolucao/SolicitarDevolucaoSheet.tsx` | Já é diálogo central desde `sm`. |
| Modal de avaliação | `OrderDetailsView.tsx` (portal) | Bottom sheet de 448px. |
| Diálogos de avatar/capa | `ProfileView.tsx`, `AccountSettingsView.tsx` (Radix Dialog) | Centrados (ok). |
| Painel "Resumo do pedido" do checkout | `CheckoutView.tsx` (portal abaixo do header) | 448px. |
| Lembrete do carrinho (só na home) | `components/ui/custom/CartReminder.tsx` | Centrado, `md:bottom-24`. |
| Convite de push | `components/pwa/PushNotificationBanner.tsx` | Centrado, `md:bottom-6` (em cima da pílula). |
| Aviso de atualização do PWA | `components/pwa/PWAUpdateGate.tsx`, `UpdateNotification.tsx` | Modal central (ok). |
| Toasts | `components/ui/sonner.tsx` + `index.css` (sonner escondido até 640px; `top` fixo em 64px) | Topo centrado, a 64px. |
| Link "Pular para o conteúdo" | `App.tsx` | ok. |
| Erro global / erro local | `GlobalErrorBoundary.tsx`, `LocalErrorBoundary.tsx` | Centrados (ok). |
| **Não existem** | — | banner de cookies, prompt de "instalar app", página de departamento/categoria, páginas de termos e privacidade. **Não inventar.** |

## 2. Decisão de breakpoint

**Proposta confirmada: abaixo de `lg` (1024px) tudo idêntico ao de hoje. De 1024px para cima, layout de site.**

O que o código mostra:
1. **Existe um "tablet híbrido" de 768 a 1023px (`md:`), e ele fica como está.** Nessa faixa:
   - o header vira grade;
   - a barra de baixo vira pílula flutuante;
   - carrinho, produto, checkout e favoritos ganham barras flutuantes de 448px acima da pílula;
   - o banner vai para 4:1;
   - o catálogo tem 3 colunas;
   - Ofertas mostra o herói em linha;
   - OrderList tem 2 colunas;
   - o AddressForm fica em 2 colunas;
   - `--customer-pb` vale 112px (`index.css`).

   O diff visual cobre também 768 e 1023.
2. **Toda regra `md:` vale também de 1024 para cima.** O desenho de desktop precisa **anular explicitamente** as que não quer, com `lg:`. Lista: pílula da BottomNav, barras com `md:bottom-[104px]`/`[88px]`, `CartReminder md:bottom-24`, `PushNotificationBanner md:bottom-6`, grade do Header, `--customer-pb` de 112px.
3. **As regras `lg:` de hoje são o "desktop atual"** (carrinho em 2 colunas, galeria, grades). Só pintam de 1024 para cima, então a frente dona pode mudá-las livremente.
4. **Classe sem prefixo em elemento que é `hidden` abaixo de `lg`** (ex.: o resumo lateral do carrinho, `sticky top-24 hidden … lg:block`) não pinta no celular. Mesmo assim, prefira acrescentar com prefixo.
5. **1024 já é o corte do resto do app:**
   - `useTelaLarga()` em `src/hooks/useFinanceiro.ts`;
   - `AdminDevolucoesView` (`matchMedia("(min-width: 1024px)")`);
   - `--admin-tab-pb` em `index.css`.

**Implicações:**
- Nenhum celular chega a 1024 CSS px: retrato no máximo ~430, deitado no máximo ~932.
- Chegam: iPad Pro 12.9 em retrato (1024), tablets deitados (≥1024), notebooks e janela de PWA instalado no PC. Tudo isso vira desktop, que é o que o dono pediu ("outra coisa que for abrir assim, igual um desktop").
- Há toque em ≥1024 (iPad), então **nada pode depender de hover.** O projeto já usa `future.hoverOnlyWhenSupported` e a variante `hover-hover`.

## 3. Direção de design desktop

### 3.1 Princípios
1. **Mesma identidade.**
   - cor da loja em `--primary` (vem do banco);
   - neutros zinc, esmeralda para positivo, âmbar para destaque;
   - Inter 400–900;
   - `--radius` 1.5rem e cartões `rounded-3xl`/`rounded-[2rem]`;
   - o tom de sempre: títulos `font-black tracking-tighter`, rótulos em caixa alta com tracking largo;
   - blocos escuros de destaque (frete grátis, modo admin, resumo de avaliações).
2. **Menos "app", mais "site":**
   - nada flutuando no meio da tela;
   - nenhuma barra de baixo;
   - conteúdo em container com margens;
   - duas colunas onde há leitura mais ação;
   - coluna de ação grudada (sticky);
   - rodapé com os dados da loja.
3. **Proporção:** cards de produto de ~225–260px (o card foi desenhado para 170–260px). Foto nunca maior que a altura útil da tela.
4. **Nada de dado inventado.** O rodapé e os painéis só mostram o que a loja preencheu (mesma régua do "Sobre a loja").

### 3.2 Casca

**Cabeçalho (≥1024):**
- Altura de **72px**: `--header-height: 72px` só em `@media (min-width:1024px)`.
- Fundo branco, borda inferior zinc-100, sombra ao rolar (como hoje).
- Linha interna no container (§3.3), em grade **simétrica** `[minmax(0,1fr)_minmax(0,640px)_minmax(0,1fr)]`, gap 24px. Assim a busca fica exatamente centrada na janela e o dropdown (que é `fixed` e centrado na janela) alinha com o campo.
- **Esquerda:** [Voltar, quando existir] + logo (h-10, até 200px; clique vai para o Início). P2: botão "Categorias ▾" com um menu que leva à home filtrada.
- **Centro:** busca (h-11, até 640px). O dropdown usa a mesma largura e `top = header + 6px` (78px).
- **Centro em checkout e endereço (`hideSearch`):** o slot `HEADER_CENTER_SLOT_ID` continua, e o gatilho do resumo some no desktop (a frente F6 cuida disso). Ao lado aparece o selo "🔒 Compra segura".
- **Direita:** `<nav aria-label="Navegação principal">` com, nesta ordem:
  - Favoritos (♡ + contador);
  - Conta ("Entrar" deslogado; primeiro nome e menu ▾ logado: Minha conta, Meus pedidos, Configurações da conta, Sobre a loja, [Painel da loja — só admin], Sair);
  - sino de notificações;
  - **Carrinho** (🛒 + contador, `id="header-cart"`).

  Para admin há ainda um botão escuro "Painel da loja" (equivalente ao cartão "Modo Admin" do Perfil).
- A cápsula de aviso (toast da "ilha") aparece **à esquerda** do nav. **O carrinho nunca some durante o aviso**, porque é o alvo do voo.

**Barra de baixo (≥1024):** `lg:hidden`. Ela **continua montada**, porque a jornada e2e a 1280 lê `#bottom-nav-cart`.
- Regra de 24/08 mantida: um carrinho visível por vez. Abaixo de 1024 é o de baixo; de 1024 para cima, o do topo.
- O voo (`cartAnimation.ts`) mira o do topo quando a tela é de computador.

**Rodapé (≥1024, novo, `<footer>`):**
- Fundo `zinc-950`, texto `zinc-400` (7,6:1), títulos brancos.
- Aparece depois do conteúdo de toda tela da cliente, **menos checkout, endereço e login** (modo foco). O login (`auth`, e `login`, alias da mesma tela, com cadastro e recuperação de senha dentro dela) entra desde 28/09: é passagem do checkout e do endereço para quem está deslogada. O login do painel (`admin-login`) não entra.
- Container, quatro colunas. **Cada bloco só existe com dado.**
  1. Marca: logo ou inicial, nome (`nomeDaLoja`), cidade/UF.
  2. "Navegue": Início, Favoritos, Carrinho, Meus pedidos.
  3. "Sua conta": Minha conta/Entrar, Configurações, Sobre a loja.
  4. "Atendimento": WhatsApp (`lojaTemWhatsapp`), horário (`businessHours`), endereço (`storeAddress`).
- Linha final: "© {ano} {nome}".
- **Sem formas de pagamento na 1ª versão.** O cartão nasce desligado em `config_pagamento_cartao`, e o rodapé mentiria (decisão D3).

**Overlays (≥1024):**
- Convite de push e lembrete do carrinho: canto inferior direito (`right-8 bottom-8`, 400px).
- Toasts: `top: safe-area + --header-height + 12px`.
- Aviso de atualização e diálogos: sem mudança.
- Folhas de baixo: viram **gaveta à direita de 440px** (`side="right"`), como a `FolhaFinanceira`. Nunca diálogo central na folha do card: a jornada `jornada-folha-clique-fora` clica em (50%, 20%) da janela e precisa cair no véu.

### 3.3 Container e grade

- **Container:** `max-w-[1280px]` com `px-8`; de 1536px para cima (`2xl`), `max-w-[1440px]`.
- **Ritmo vertical:**
  - topo da página: `pt-8`;
  - entre seções: `py-10`/`space-y-12`;
  - colunas: gap 32–48px.
- **Sticky dentro da página:** `lg:top-6` (24px abaixo do cabeçalho). Nunca `top-[var(--header-height)]`, porque o cabeçalho está fora da área de rolagem.
- **Coluna grudada:** `max-h-[calc(100dvh-var(--header-height)-48px)]` com rolagem interna. Notebook de 1366×657 úteis não pode cortar o botão.

| Largura da janela | Largura útil | Grade de produtos (gap 20) | Card |
|---|---|---|---|
| 1024 | 960 | 4 colunas | ~225px |
| 1280 | 1216 | 5 colunas | ~227px |
| 1440 | 1216 (container 1280, margens 80) | 5 colunas | ~227px |
| 1920 | 1376 (container 1440, margens 240) | 5 colunas | ~259px |

Prateleiras (carrosséis) mostram o mesmo número de cards por vista que a grade (4 no `lg`, 5 no `xl`), alinhados a ela.

### 3.4 Escala tipográfica (≥1024; o celular fica como está)

| Papel | Hoje (celular) | Desktop |
|---|---|---|
| Título de página (h1) | text-xl a 3xl, black | `lg:text-4xl` black tracking-tighter |
| Título de seção (h2) | text-3xl (prateleira) / text-xl | `lg:text-3xl` |
| Título de cartão | 13–16px | `lg:text-base` semibold/black |
| Corpo | text-xs (12px) | `lg:text-sm` (14px); descrição do produto `lg:text-base` com `max-w-prose` |
| Rótulo em caixa alta | 9–10px, zinc-400 | `lg:text-[11px]` e **`lg:text-zinc-500`** (zinc-400 sobre branco dá 2,6:1 e reprova AA) |
| Preço no card / no produto | 15px / text-2xl | `lg:text-lg` / `lg:text-4xl` |
| Botão | 10–11px caixa alta, h-11 | `lg:text-xs`, `lg:h-12` |

### 3.5 Mouse, teclado e foco
- **Cursor:** todo clicável tem cursor de mão (`button` já tem pela base; `div` clicável precisa de `cursor-pointer`).
- **Hover:** troca de cor ou fundo em 150ms; card sobe (já existe); zoom leve na foto (já existe).
- **Controles revelados por hover** (ex.: favoritar do card, setas da galeria) **também aparecem com foco de teclado** (`lg:hover-hover:group-focus-within:opacity-100`) e ficam visíveis sem hover em tablet de toque ≥1024.
- **Foco:**
  - vale o anel global `:focus-visible` (`index.css`);
  - peça nova usa `focus-visible:ring-2 focus-visible:ring-zinc-900/50`;
  - proibido `focus-visible:outline-none` sem anel (teste `acess-onda3`).
- **Teclado:**
  - ordem logo → busca → nav;
  - menus e gavetas pelo Radix (setas, Esc, devolução do foco);
  - setas das prateleiras são `<button>` com `aria-controls`;
  - link "Pular para o conteúdo" mantido.
- **Marcos de acessibilidade:** `header` (banner), `nav` "Navegação principal", `main#conteudo`, `aside` ("Resumo do pedido", "Minha conta"), `footer` (contentinfo), `aria-current="page"` no nav. Alvo mínimo de 24×24 (WCAG 2.5.8).

### 3.6 Cada tela no desktop

**Início**
- Banner do topo dentro do container, `rounded-3xl`, **mantém 4:1**. É o recorte "Desktop (4:1)" que o `ImageAdjuster` do painel já gera: 1216×304 a 1280; 1376×344 a 1920. O bloco de frete grátis vem logo abaixo, na mesma largura.
- Prateleiras: título à esquerda + setas ‹ › à direita (só no desktop). 4 ou 5 por vista, rolagem por página, vinhetas atuais.
- Ofertas: dois cartões-herói por vista (`flex-[0_0_50%]`), cada um no layout `md` que já existe (foto 2/5 + conteúdo).
- Banners do meio e do fim: contidos, `rounded-3xl`.
- Catálogo:
  - barra sticky com "Catálogo" (`lg:text-3xl`);
  - chips de categoria **quebrando linha** (sem rolagem horizontal);
  - "Ordenar" com rótulo, abrindo o mesmo menu, ancorado à direita;
  - grade 4/5.
- O bloco de horário sai no desktop (vai para o rodapé).
- Vazio: cartão centrado de 560px.

**Produto**
- Container, grade `[minmax(0,1fr)_420px]` (xl: 440px), gap 48px, `pt-8`.
- **Esquerda:**
  - galeria: caixa quadrada `rounded-3xl` fundo #F8F9FA, altura até `100dvh − header − 96px`, foto `object-contain`, setas sempre visíveis, favoritar e compartilhar no canto;
  - **miniaturas** de 72px em linha abaixo (os pontos somem no desktop);
  - abaixo: abas Detalhes / Avaliações / Perguntas (sticky no topo do painel, alinhadas à esquerda), descrição em `max-w-prose`, resumo escuro de avaliações em linha (já existe no `md`), lista, perguntas;
  - "Você também pode gostar" em 3 colunas.
- **Direita:** caixa de compra **sticky** (`top-6`, com rolagem interna se for alta). Contém: breadcrumb, título `lg:text-3xl`, nota e estoque, preço `lg:text-4xl` e selos, variações, quantidade + WhatsApp + "Adicionar ao Carrinho" (h-12). **Nenhum botão novo** ("Comprar agora" não existe na tela hoje).
- Barra de compra dockada e espaçador do fim: somem.

**Busca (/search)**
- Container; cabeçalho sticky com campo e chips.
- Filtros viram gaveta à direita.
- Grade 4/5 nos resultados e nas sugestões.

**Favoritos**
- Container.
- Cabeçalho "Favoritos · N itens" + botão "Continuar comprando →" (só no desktop).
- Grade 4/5; o CTA flutuante some.
- Vazio: herói central + 4 sugestões em uma linha (`max-w-5xl`).

**Carrinho**
- O `h1` que hoje é `sr-only` fica visível no desktop (`lg:not-sr-only`), sem mudar o DOM.
- Segmentado Carrinho | Meus pedidos com 360px, à esquerda, no container.
- Duas colunas (já existem): itens em **linhas largas** (foto 96px, nome/variação, quantidade, preço, remover) + frete; resumo de 380px sticky `top-6` com "Finalizar Compra".
- "Entregar em": gaveta à direita. Vazio: centrado.

**Meus pedidos**
- Container; sub-abas; grade 2 (lg) / 3 (xl).
- Convidado: cartão central de 560px com o formulário. O espaçador de 80px some.

**Checkout** (RISCO)
- Container de 1120px, grade `[minmax(0,1fr)_380px]`, gap 32px.
- Esquerda: o formulário de hoje, sem mudar ordem nem regra.
- Direita: `aside` "Resumo do pedido" sticky com itens (miniatura, nome, variação, qtd × preço), Subtotal, Entrega, Desconto, Total **+ a mesma barra "Finalizar Pedido" com as mesmas mensagens de validação e de recusa**.
  - É a mesma instância: o portal troca de alvo de `document.body` para o `aside` quando a tela é de computador.
  - A coluna de totais da barra some no desktop, para não repetir.
- Gatilho do topo, painel do resumo e espaçadores de 196/200px: somem no desktop.
- **Etapa de pagamento:** coluna central de 560px. No computador o QR do PIX é o caminho (a pessoa lê com o celular). `PagamentoOnline` e `PagamentoComCartao` **não mudam**: Brick e 3DS são iframes do Mercado Pago, com CSP própria.
- Sucesso, pago e fora do prazo: cartão central de 560px.

**Pedido feito:** cartão central de 560px.

**Minha conta (Perfil, Configurações, Endereço)**
- Container, grade `[280px_minmax(0,1fr)]`, gap 32px.
- Esquerda: **menu da conta** sticky (avatar, nome, e-mail, links com `aria-current`, "Painel da loja" para admin).
- Perfil: capa `rounded-3xl` h-56 dentro do conteúdo + avatar sobreposto + nome; cartões Endereços \| Pedidos em andamento lado a lado; Modo Admin; Encerrar sessão. O cartão-menu (Configurações e Sobre a loja) some no desktop, porque o menu lateral tem.
- Configurações: conteúdo `max-w-3xl`, abas Perfil/Segurança, campos em 2 colunas.
- Endereço: cartão `max-w-2xl` (o `AddressForm` já tem 2 colunas).

**Perfil público:** container `max-w-5xl`; capa arredondada; esquerda identidade e números (sticky), direita avaliações e perguntas.

**Detalhe do pedido** (RISCO)
- Container de 1120px + cabeçalho.
- Grade `[minmax(0,1fr)_360px]`:
  - esquerda: status + linha do tempo + rastreio, "O que achou", devolução, itens;
  - direita: resumo, destino e pagamento, ações — sticky.
- Modal de avaliação central (`max-w-lg`, cantos todos arredondados).

**Notificações:** coluna de 768px centrada; cabeçalho e filtros; lista.

**Sobre a loja:** container `max-w-5xl`, duas colunas: identidade + descrição \| horário, endereço + mapa, contato. Botão do WhatsApp no canto inferior direito a 32px (`lg:!bottom-8`, por causa do estilo inline).

**Login/cadastro** (RISCO)
- Cartão de 440px centrado na vertical.
- P2: painel de marca à esquerda com logo, nome e o subtítulo que já existe (`subtituloBoasVindas`). Nada de texto novo de promessa.

## 4. Estratégia "celular intacto"

### 4.1 Regras (valem para todo agente)
- **R1 — Só prefixo de desktop.** Todo token novo **começa** por `lg:`, `xl:` ou `2xl:`, inclusive quando empilhado (`lg:hover-hover:…`). Não editar, remover nem reordenar token sem prefixo, nem `xs:`, `sm:` ou `md:`.
- **R2 — Acrescente, não edite.** A classe de desktop entra num **literal separado**: `cn("<literal de hoje, byte a byte>", "lg:…")` ou uma constante de `src/components/desktop/medidas.ts`. Os testes-contrato leem o fonte e procuram o literal inteiro (`home-nao-pula-contrato`, `acess-onda1/2/3-contrato`, `acess-onda1-0509-contrato`, `acess-b6-skip-link-contrato`).
- **R3 — Peça nova só de desktop é montada por `useTelaDeComputador()`.** Assim ela não existe no DOM do celular nem no jsdom dos testes. `hidden lg:flex` só vale para enfeite sem texto, sem `id`/`data-testid`, sem handler e sem hook que busque dado.
- **R4 — Estilo inline não perde para `lg:`.** Use `lg:!…` ou mova o valor para o ramo de computador.
- **R5 — Wrappers.** Pode criar wrapper sem nenhuma classe sem prefixo. Receitas em §4.3.
- **R6 — Ordem do DOM nunca muda.** Tab, leitor de tela e pintura do celular dependem dela. No desktop, reposicione com grid ou `order` só com `lg:`, mantendo a ordem visual coerente com a do DOM (WCAG 1.3.2 e 2.4.3).
- **R7 — Nada duplicado ao mesmo tempo no DOM:** `id`, `data-testid`, `aria-label` ou texto. O que duplicaria vai pelo gancho.
- **R8 — Um só leitor de largura:** nenhum `useMediaQuery`/`matchMedia` de largura fora do gancho. O `useMediaQuery` de hoje começa `false` e troca num efeito, o que gera flash e salto de layout no desktop.
- **R9 — Sem `eslint --fix` no arquivo inteiro.** Ele reordena literal antigo (regra `tailwindcss/classnames-order`) e quebra teste-contrato. Ajuste à mão só o literal novo. Zero warning novo (tetos: eslint 453 e 0 erro; biome 15).
- **R10 — CSS global só dentro de `@media (min-width: 1024px)`.** Dono: F1.
- **R11 — Barra fixa ou dockada no desktop:** some (`lg:hidden`) ou vira parte do layout. Nada fica "flutuando acima da navegação que não existe".
- **R12 — Arquivo congelado não se toca** (lista no plano).

### 4.2 CSS (`hidden lg:flex`) × JS (`useTelaDeComputador`)

| | CSS com prefixo `lg:` | JS: `useSyncExternalStore` + `matchMedia("(min-width: 1024px)")` |
|---|---|---|
| Flash | nenhum | nenhum, **se** a leitura for síncrona no primeiro render (o `useMediaQuery` atual não é) |
| DOM do celular | a peça existe escondida (custo de render, `id`/texto duplicados, hooks de dado rodando no celular) | **idêntico ao de hoje** |
| Testes jsdom (~712 arquivos, sem CSS) | veem a peça escondida: `getByText`/`getByRole` passam a achar duplicata | `matchMedia` ausente ou `false` (todo stub atual devolve `false`) → caminho do celular → nada quebra |
| Redimensionar cruzando 1024 | instantâneo | remonta só a peça (perde estado local dela) |
| SSR / hidratação | n/a (SPA; o "porteiro" só injeta a ficha no HTML) | snapshot de servidor `false`; n/a |
| PWA | igual | igual; janela instalada no PC é ≥1024 e vira desktop |
| Pacote | o código vai de qualquer jeito | igual. Lazy ajuda só a tirar do caminho do 1º paint; o SW pré-carrega tudo menos `assets/Admin*.js` |

**Decisão:**
- **Elemento existente** ganha classes `lg:` (CSS).
- **Elemento novo** é montado pelo gancho.
- **Peça grande abaixo da dobra** (rodapé, menu da conta, miniaturas, `aside` do checkout) vai em `React.lazy` com fallback `null`, sem nome começando por "Admin" (o nome viraria exclusão do precache).
- **O nav do cabeçalho** entra estático no chunk do Header, que já é lazy. Assim não há flash no topo; custo estimado de ~3 kB brotli.

O gancho segue o contrato do `useTelaLarga()` que já existe (mesma consulta; sem `matchMedia` = celular; leitura já no 1º render). Mora em arquivo próprio, `src/hooks/useTelaDeComputador.ts`. Importar de `useFinanceiro.ts` arrastaria um módulo do painel para o lado cliente do portão de tamanho.

### 4.3 Receitas de estrutura (o que quebra o celular sem ninguém ver)
- **Pai com `space-y-*`/`divide-*`** (seletor de filho direto): envolver filhos tira a margem deles.
  - Receita **blocos contíguos**: só agrupar cartões vizinhos, e o wrapper recebe o **mesmo** `space-y-*` do pai. No `lg`, o pai ganha `lg:grid lg:space-y-0`.
  - Usar em OrderDetails (esquerda = status…itens; direita = resumo…ações) e no Perfil.
- **Pai flex/grid com `gap`:** o wrapper vira `contents lg:<display>`. Com `display: contents`, ele some do layout no celular e o gap continua igual.
- **Sticky:** não mudar a cadeia de ancestrais de elemento sticky abaixo de `lg`.
  - Exemplo: no Produto, as abas sticky continuam dentro do mesmo bloco que contém também relacionados e espaçador.
  - Por isso os relacionados ficam na coluna esquerda no desktop.
- **Colapso de margem:** wrapper de bloco sem padding e sem borda é transparente. `contents` é mais seguro ainda.
- **`group`/`peer`, `first:`/`last:`/`odd:`:** wrapper novo muda o parentesco. Conferir antes.
- **framer-motion:** wrapper entre `AnimatePresence`/`layout` e o filho muda saída e animação de layout. Variantes com `staggerChildren` seguem a ordem de montagem.
- **Portal e `fixed` dentro de `gpu-accelerated`:** mover para dentro ou para fora de ancestral com `transform` muda o que `fixed` significa.

### 4.4 Como provar (e o que o harness visual precisa cobrir)

**Camadas de prova:**
1. Teste unitário por tarefa: `classesDoCelular(el.className) === literal de hoje` e os tokens de desktop presentes. Peça nova: aparece com `matchMedia` verdadeiro e some sem ele.
2. **Harness visual** (outro agente): diff pixel a pixel = 0 de base × candidato em 360/375/390/414, e também 768 e 1023.
3. Snapshot de acessibilidade (`locator.ariaSnapshot()`) do celular igual. Pega mudança de ordem do DOM ou peça "escondida" vazando para a árvore de acessibilidade.
4. Jornadas e2e nos dois tamanhos: Pixel 5/390 e Desktop Chrome/1280.
5. O Gabriel confere no celular dele pelo preview.

**O harness precisa:**
- **Dois builds** no mesmo run, mesma máquina e mesmo Chromium: base f2e907bf e candidato. Ambos com `IKCOUS_IDENTITY_MODE=fixture` e `npm run preview` (como o `e2e-jornadas.yml`). Nunca comparar imagens de máquinas diferentes (antialiasing muda).
- **Dados fixos** pelo kit `tests/e2e/kit-jornadas.ts` (`page.route`, sem rede). Trocar o PNG 1×1 das fotos de produto por **uma imagem com padrão** (xadrez 800×1000): com 1×1, mudança de recorte ou proporção passa despercebida.
- **Sessões sintéticas** de cliente e de lojista (admin), interceptando `/auth/v1/*` e as leituras (perfil, `is_admin`, endereços, pedidos, notificações, avaliações). Sem isso Perfil, Configurações, Pedidos e Checkout logado ficam sem prova.
- **Estabilização idêntica nos dois lados:**
  - `emulateMedia({ reducedMotion: "reduce" })`;
  - screenshot com `animations: "disabled"` e `caret: "hide"`;
  - relógio congelado (`page.clock.install`), para o prazo de 30 min do PIX e as datas relativas;
  - `sessionStorage.splash_shown = "1"` (sem splash);
  - `localStorage` preparado (memória da home, carrinho);
  - `document.fonts.ready` e imagens carregadas;
  - carrossel com autoplay pausado. Máscara só com justificativa escrita.
- **Rolagem interna:** o app não rola o documento. Rola `main#conteudo` e o `.active-scroll-container` das abas. `fullPage` **não serve**: é preciso fotografar a viewport em cada posição (passo = altura da janela) e **no fim da rolagem**, que é onde aparecem barras dockadas, espaçadores e abas sticky.
- **Viewports e densidade:**
  - 360×800, 375×667, 375×812, 390×844, 414×896 e 768×1024, 1023×768, com DPR 2;
  - fronteira 1024×768 (primeiro quadro de desktop);
  - desktop 1024, 1280×800, 1440×900 e 1920×1080: guardadas como artefato para o Gabriel, **não** comparadas com a base.
- **Critério:** `maxDiffPixels: 0` e `threshold: 0` em todo quadro abaixo de 1024. Saída com base, candidato e diff em PNG + JSON. Código de saída diferente de 0 se algum quadro de celular diferir.
- **Estados a fotografar:**
  - Início: carregando; com banner; sem banner; categoria; busca do topo; vazio; menu Ordenar aberto; lembrete do carrinho.
  - Produto: simples; com variação; esgotado; com avaliações; rolado (barra dockada e abas sticky); folha do card aberta.
  - Busca: sem termo; resultados; sem resultado; filtros abertos.
  - Favoritos: vazio; com itens; erro.
  - Carrinho: vazio; com itens como convidado; com itens logado; folha "Entregar em".
  - Pedidos: convidado; logado com pedidos (as duas sub-abas).
  - Checkout: convidado; logado; painel do resumo aberto; erro de validação; recusa; pagamento PIX; sucesso; pago; fora do prazo; endereço novo.
  - Pedido feito.
  - Detalhe do pedido: pago; entregue com devolução; cancelado; modal de avaliação; folha de devolução.
  - Perfil (cliente e admin), Configurações (duas abas e diálogos), Endereço, Perfil público, Sobre a loja (completo e mínimo), Notificações (vazia e lista), Login/cadastro/recuperar, Manutenção.
  - Overlays: dropdown da busca, convite de push, aviso de atualização, cápsula de aviso, link "Pular" com foco.
- **Comando** documentado (sugestão `npm run visual:celular -- --base f2e907bf`). O nome final é do harness.

## 5. Fora do escopo
- Banco, RPC, edge, regras de frete, cupom e pagamento.
- Internos de `PagamentoOnline`/`PagamentoComCartao` (Brick e 3DS; CSP em `vercel.json`).
- Painel admin.
- Tablet em retrato (768–1023) fica como está.
- Tema escuro/vidro da loja: não é redesenhado, mas as peças novas usam os mesmos tokens das vizinhas.
- Páginas novas (departamento, termos, privacidade).
- Mudar `IMAGEM_DO_BANNER` (o preload depende dele).
- Defeito da rota `recently-viewed` vazia.
- Portão de tamanho e tetos.

## 6. Decisões que sobem ao Gabriel (com a conta feita)

**D1 — Corte em 1024px.**
- Melhora: notebooks (inclusive 1280 com zoom de 125%) e tablets deitados viram site.
- Piora: o iPad Pro em retrato (1024) também vira site com toque. Mitigado: nada depende de hover.
- Alternativa 1280: deixaria notebooks de 1024–1279 com o layout de celular esticado de hoje.
- **Recomendo 1024.**

**D2 — Carrinho no topo a partir de 1024 (revisita a decisão de 24/08).**
- O problema de 24/08 era ter dois carrinhos visíveis ao mesmo tempo. Continua sendo um só: embaixo no celular, no topo no computador, onde a barra de baixo some.
- Melhora: padrão de site; some a pílula flutuante que ele reclamou.
- Custo: reescrever o teste `carrinho-um-so-na-barra-de-baixo` para o contrato novo, sem afrouxar.
- **Recomendo sim.**

**D3 — Rodapé sem ícones de pagamento na 1ª versão.**
- O cartão nasce desligado e só o painel liga. Ícone de cartão no rodapé seria promessa falsa em loja sem cartão.
- Ligar depois exige ler da mesma fonte que o checkout.
- **Recomendo começar sem.**

**D4 — Checkout em duas colunas com "Finalizar Pedido" na coluna do resumo** (só no computador).
- Melhora: padrão de loja.
- Risco: toca o caminho do dinheiro, por isso a revisão é cara e esta frente é mergeada por último.
- **Recomendo sim.**

**D5 — P2 (podem sair do lote se apertar prazo ou pacote):** menu "Categorias ▾" no topo; troca de tela com fade curto no desktop em vez de deslizar; barra de rolagem visível com mouse; painel de marca no login. **Recomendo fazer, depois do P1.**

