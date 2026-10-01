# Plano — app do cliente no computador (28/09/2026)

> **Decisões adotadas pela coordenação (28/09, recomendações do plano; o dono pode mudar):**
> D1 corte em 1024px; D2 carrinho no topo no computador (um só visível); D3 rodapé sem ícones de
> pagamento na 1ª versão; D4 checkout em duas colunas com "Finalizar Pedido" na coluna do resumo;
> D5 itens P2 depois do P1; tablet em retrato (768–1023) fica exatamente como hoje.
>
> **Ajustes de dono de arquivo (coordenação):**
> - `src/components/ui/custom/CouponInput.tsx` e os componentes novos de cupom são da **frente B**
>   (cupons, [investigação](../specs/2026-09-28-cupons-checkout-investigacao.md)). F6 só posiciona
>   a seção de cupom no layout de computador; não edita o conteúdo dela.
> - `src/views/customer/AboutStoreView.tsx` (pin do mapa) e `src/components/ui/custom/AddressList.tsx`
>   (mapa dos endereços) recebem, antes, a correção dos mapas feita pela coordenação; F8 e F7
>   trabalham por cima dela (faça `git fetch` e parta da `proxima/base` mais nova).
> - As sessões na nuvem são as frentes D1–D8 do
>   [roteiro](2026-09-28-sessoes-paralelas.md): **D1 = F1, D2 = F2, …, D8 = F8** desta tabela.
> - A Onda 0 (F1.1–F1.5, contrato) é feita pela coordenação e já está na `proxima/base` quando as
>   frentes abrem; a sessão D1 faz o resto da F1.


Spec: `docs/superpowers/specs/2026-09-28-app-cliente-desktop-design.md`. Base: f2e907bf.

## A. Mapa de dono (8 frentes)

Cada arquivo tem **um** dono de escrita. Quem precisar mudar arquivo de outra frente pede ao dono. Arquivo congelado não se toca.

| Frente | Dono de escrita |
|---|---|
| **F1 Casca** (contrato + integração) | `src/App.tsx`, `src/index.css`, `src/components/ui/custom/{Header,BottomNav,BarraSuperiorCliente,SearchBar,CartReminder}.tsx`, `src/components/pwa/PushNotificationBanner.tsx`, `src/components/layouts/AppMotionFallbacks.tsx` (só P2), `src/utils/cartAnimation.ts`, **novos** `src/hooks/useTelaDeComputador.ts`, `src/components/desktop/{medidas.ts,NavegacaoDoTopo.tsx,MenuDaContaDoTopo.tsx,RodapeDaLoja.tsx,MenuDeCategorias.tsx}`, `tests/front/classes-do-celular.ts`, `tests/front/carrinho-um-so-na-barra-de-baixo.test.tsx`, nova jornada `tests/e2e/jornada-desktop-1440.spec.ts` |
| **F2 Vitrine** (Início + card) | `src/views/customer/HomeView.tsx`, `src/components/ui/custom/{ProductCard,ProductCardSkeleton,ProductList,ProductCarousel,PremiumOffers,BannerCarousel,CategoryFilter,InfoBlockCarousel,FreeShippingBlock}.tsx`, `tests/front/home-nao-pula-contrato.test.tsx` (só se inevitável) |
| **F3 Produto** | `src/views/customer/ProductView.tsx`, `src/components/ui/custom/{ReviewCard,ProductQA,MarkdownRenderer}.tsx` |
| **F4 Busca e Favoritos** | `src/views/customer/{SearchView,FavoritesView}.tsx` |
| **F5 Carrinho e Meus pedidos** | `src/views/customer/CartView.tsx`, `src/components/ui/custom/{CartItemsList,CartFooterSummary,ShippingCalculator,ShippingProgress,EmptyCart,OrderList,OrderSearch}.tsx` |
| **F6 Checkout e Sucesso** (RISCO) | `src/views/customer/{CheckoutView,OrderSuccessView}.tsx`, `src/components/ui/custom/{CouponInput,SaidaDaRecusa}.tsx`, novo `src/components/checkout/ConteudoDoResumoDoPedido.tsx` |
| **F7 Minha conta** | `src/views/customer/{ProfileView,AccountSettingsView,AddressFormView,UserProfileView}.tsx`, `src/components/ui/custom/OrderTimeline.tsx`, novo `src/components/desktop/MenuDaConta.tsx` |
| **F8 Pedido, Notificações, Sobre, Login** | `src/views/customer/{OrderDetailsView,NotificationsView,AboutStoreView}.tsx`, `src/views/shared/AuthView.tsx`, `src/components/ui/custom/ReviewForm.tsx`, `src/components/devolucao/*` (sem tarefa prevista: a folha já é diálogo desde `sm`) |

**Congelados (ninguém escreve):**
- `src/components/ui/*` (sheet, dialog, button, dropdown-menu…);
- `AddressForm`, `AddressList`, `QuantitySelector`, `StarRating`, `LazyImage`, `CustomerPaymentBadge`;
- `src/components/checkout/{PagamentoOnline,PagamentoComCartao,sdk-mercado-pago}.*`, `src/components/icons/*`;
- `src/contexts/*`, `src/hooks/*` (menos o gancho novo), `src/lib/*`, `src/types/*`;
- `tailwind.config.js`, `vite.config.ts`, `src/sw/*`, `vercel.json`, `scripts/portaoDividido.ts`, `.size-limit.cjs`;
- `.lint-baseline.json` (só a integração abaixa teto);
- testes-contrato multi-arquivo (`tests/front/acess-*-contrato.test.tsx`, `acess-b6-*`, `perf-entrada-sem-animacao-no-1o-paint.test.ts`, `tests/app_react_lazy_depois_do_import_test.ts`). A regra "acrescente, não edite" mantém esses testes verdes; se algum quebrar, conserte o fonte, não o teste.

## B. Contratos entre frentes

- **C1 — Gancho de largura.** `src/hooks/useTelaDeComputador.ts`:
  - `export const CONSULTA_TELA_DE_COMPUTADOR = "(min-width: 1024px)"`;
  - `export function ehTelaDeComputador(): boolean` (para código fora de React);
  - `export function useTelaDeComputador(): boolean`, com `useSyncExternalStore` e snapshot de servidor `false`.

  Sem `matchMedia` = `false`. Stub sem `addEventListener` não quebra.
- **C2 — Medidas** (`src/components/desktop/medidas.ts`; todo token começa por `lg:`/`xl:`/`2xl:`):
  - `CONTAINER_DO_COMPUTADOR = "lg:mx-auto lg:w-full lg:max-w-[1280px] lg:px-8 2xl:max-w-[1440px]"`
  - `GRADE_DE_PRODUTOS_NO_COMPUTADOR = "lg:grid-cols-4 lg:gap-5 xl:grid-cols-5"`
  - `COLUNA_FIXA_NO_COMPUTADOR = "lg:sticky lg:top-6 lg:self-start lg:max-h-[calc(100dvh-var(--header-height)-48px)] lg:overflow-y-auto"`
  - `GAVETA_NO_COMPUTADOR = "lg:w-full lg:max-w-[440px] lg:gap-0 lg:rounded-l-3xl lg:p-0"`
  - `TITULO_DE_PAGINA_NO_COMPUTADOR = "lg:text-4xl lg:leading-none lg:tracking-tighter"`
  - `ROTULO_NO_COMPUTADOR = "lg:text-[11px] lg:text-zinc-500"`
- **C3 — CSS da casca ≥1024** (`index.css`, só dentro de media query): `--header-height: 72px`; `--customer-pb: 64px`; `--customer-pb-summary: 64px`; toast em `top: safe-area + --header-height + 12px`.
- **C4 — Sticky** dentro de página: `lg:top-6`. O cabeçalho está fora da área de rolagem.
- **C5 — Sem barra de baixo ≥1024.** A `BottomNav` continua montada com `lg:hidden`. Nenhuma página reserva espaço para ela. Barras dockadas somem ou entram no fluxo.
- **C6 — Rodapé.** O App (F1) renderiza depois de toda tela da cliente, menos `checkout` e `address-form`. Tela não renderiza rodapé próprio. O bloco de horário da home some no `lg` (F2), porque o rodapé mostra.
- **C7 — Nav do topo:** `<nav aria-label="Navegação principal">` com os mesmos nomes acessíveis da BottomNav ("Favoritos", "Carrinho" / "Carrinho, N itens"), `#header-cart`. O voo mira `#header-cart` quando `ehTelaDeComputador()`.
- **C8 — ProductCard:** API congelada (nenhuma prop nova); o card preenche a célula; só F2 edita. Donos de grade usam `GRADE_DE_PRODUTOS_NO_COMPUTADOR`.
- **C9 — Folhas no desktop:** `side={computador ? "right" : "bottom"}` e `className={computador ? cn(GAVETA…) : "<literal de hoje>"}`. Mantém `data-testid`, alça e CTA. Folha do card **nunca** vira diálogo central.
- **C10 — Slot do checkout:** `HEADER_CENTER_SLOT_ID` continua (F1). F6 esconde o gatilho no `lg`. F1 põe "Compra segura" **ao lado** do slot, nunca dentro.
- **C11 — `MenuDaConta`** (F7), API `({ atual: View; onNavigate: (v: View, id?: string) => void })`, usado só por F7.
- **C12 — Invariantes das jornadas a 1280** (Desktop Chrome):
  - um nav visível "Navegação principal" com botão /Carrinho/;
  - botões "Selecionar categoria X" (um visível por categoria: os chips da home);
  - `product-card-options-sheet`, `product-card-options-add` e `product-card-options-handle` (a alça fecha) e `[data-slot="sheet-content"]`;
  - clique em (50%, 20%) da janela cai fora da folha;
  - `.cart-flyer-container` aparece;
  - `#bottom-nav-cart` contém o número;
  - "Adicionar ao Carrinho", "M (5 un.)", "Finalizar Compra" visíveis;
  - no checkout, "Endereço de Entrega" e "Na entrega" visíveis.
- **C13 — Helper de teste** `tests/front/classes-do-celular.ts`: `classesDoCelular(className)` remove tokens cujo primeiro variante é `lg`/`xl`/`2xl` e normaliza espaços.

## C. Ordem

1. **Onda 0 (F1, serial, ~30 min):** tarefas F1.1–F1.5. Vira o commit de contrato do qual as 8 frentes partem.
2. **Onda 1 (paralela):** F1 (resto) ∥ F2 ∥ F3 ∥ F4 ∥ F5 ∥ F6 ∥ F7 ∥ F8.
   - Um worktree por frente (`.claude/worktrees/desktop-fN-<nome>`); tarefas em série dentro da frente.
   - Travas do AGENTS: sem stash/checkout/restore/clean/reset; `git commit -- <caminhos>`.
3. **Onda 2 (F1, serial):** merge nesta ordem: F1 → F2 → F3 → F4 → F5 → F7 → F8 → **F6 por último**. Os arquivos são disjuntos, então não se espera conflito. Depois: V3, harness completo, capturas para o Gabriel, versão só com aprovação.

## D. Verificação padrão
- **V1 (toda tarefa):**
  - `npx tsc -b`
  - `npm run test:front -- <teste da tarefa>`
  - `npx eslint <arquivos tocados>` e `npx biome check <arquivos tocados>`: zero warning novo por arquivo, comparando com `git show f2e907bf:<arquivo>`.
- **V2 (fim da frente):**
  - `npm run test:front` (inteira)
  - `npm run lint:ratchet` (eslint ≤453 warnings e 0 erro; biome ≤15)
  - `IKCOUS_IDENTITY_MODE=fixture npm run build && IKCOUS_IDENTITY_MODE=fixture npm run size` (cliente ≤550 kB, hoje ~476; CSS ≤100 kB)
  - harness com diff de celular = 0 nas telas da frente
  - quando a frente toca a jornada: `npm install --no-save @playwright/test@1.63.0 && npx playwright install chromium && npx playwright test --config tests/e2e/playwright.jornadas.config.ts`
- **V3 (integração):** `npm ci && npm run typecheck && npm test && IKCOUS_IDENTITY_MODE=fixture npm run build && npm run lint:links && npm run lint:ratchet && IKCOUS_IDENTITY_MODE=fixture npm run size` + jornadas (1280 e 390) + harness completo + saída colada.

**Padrões de teste:**
- **A (classe acrescentada):** render sem `matchMedia`; para cada elemento-alvo, `classesDoCelular(el.className)` igual ao literal de hoje **e** `el.className` contém os tokens de desktop. Falha antes porque os tokens não existem.
- **B (peça só de desktop):** com stub `matchMedia(q) → { matches: q === CONSULTA_TELA_DE_COMPUTADOR }` a peça aparece com o nome acessível esperado; sem o stub, `queryBy…` devolve `null`. Falha antes porque a peça não existe.
- **C (fonte):** leitura `?raw` via `import.meta.glob`, o padrão da pasta, para `index.css` e `App.tsx`.

## E. Tarefas

### F1 — Casca

**Onda 0 (contrato)**

1. **F1.1 Gancho de largura.**
   - Arquivos: `src/hooks/useTelaDeComputador.ts`; `tests/front/desktop-gancho-tela-de-computador.test.tsx`.
   - Teste (falha primeiro):
     - sem `matchMedia` → `false` e não lança;
     - com stub `matches:true` → `true` **já no primeiro render**;
     - disparar `change` re-renderiza;
     - a consulta é exatamente `(min-width: 1024px)`;
     - `ehTelaDeComputador()` concorda com o gancho;
     - stub sem `addEventListener` não quebra.
   - Implementação: `useSyncExternalStore(assinar, ler, () => false)`. Sem framer-motion (o App importa este arquivo estaticamente).
   - Verificação: V1. **ROTINA.** Depende: —.
2. **F1.2 Medidas.**
   - Arquivos: `src/components/desktop/medidas.ts`; `tests/front/desktop-medidas.test.ts`.
   - Teste: todo token de toda constante começa por `lg:`, `xl:` ou `2xl:`; os valores batem com C2.
   - V1. **ROTINA.** Depende: —.
3. **F1.3 Helper `classesDoCelular`.**
   - Arquivos: `tests/front/classes-do-celular.ts`; `tests/front/desktop-helper-classes-do-celular.test.ts`.
   - Teste: `"px-4 lg:px-8 lg:hover:bg-x md:w-1"` vira `"px-4 md:w-1"`; espaços normalizados.
   - V1. **ROTINA.** Depende: —.
4. **F1.4 Guarda "um só leitor de largura".**
   - Arquivo: `tests/front/desktop-um-so-leitor-de-largura.test.ts`.
   - Teste de guarda (passa hoje, protege o contrato): em `src/views/customer/**`, `src/views/shared/**`, `src/components/ui/custom/**`, `src/components/desktop/**`, `src/components/pwa/**` e `src/App.tsx`, nenhum `useMediaQuery(` e nenhum `matchMedia(` com `min-width`/`max-width`. `prefers-reduced-motion` e `display-mode` são permitidos.
   - V1. **ROTINA.** Depende: F1.1.
5. **F1.5 Variáveis da casca ≥1024.**
   - Arquivos: `src/index.css`; `tests/front/desktop-variaveis-da-casca.test.ts` (padrão C).
   - Teste: existe um bloco `@media (min-width: 1024px)` com os valores de C3; os valores de base (52px e o resto) seguem idênticos; a regra do toast dentro do media usa `--header-height`.
   - V1. **ROTINA.** Depende: —.

**Onda 1**

6. **F1.6 Barra de baixo some no desktop.**
   - Arquivos: `BottomNav.tsx`; `src/App.tsx` (fallback l.~2976); `tests/front/desktop-barra-de-baixo-some.test.tsx`.
   - Teste: padrão A no `<nav>` (+ `lg:hidden`); padrão C no fallback do App.
   - Continua montada (C5/C12).
   - V1. **ROTINA.** Depende: onda 0.
7. **F1.7 Linha do cabeçalho no desktop.**
   - Arquivos: `Header.tsx`; `tests/front/desktop-cabecalho-grade.test.tsx`.
   - Teste: padrão A na linha, nas colunas esquerda/direita e no wrapper da busca.
   - Implementação: container (C2), grade simétrica `[minmax(0,1fr)_minmax(0,640px)_minmax(0,1fr)]`, logo `lg:h-10 lg:max-w-[200px]`, busca `lg:max-w-[640px]`.
   - V1. **ROTINA.** Depende: F1.5.
8. **F1.8 Nav do topo (componente).**
   - Arquivos: `src/components/desktop/NavegacaoDoTopo.tsx`; `tests/front/desktop-navegacao-do-topo.test.tsx`.
   - Teste com mocks de carrinho, favoritos e auth:
     - Favoritos e Carrinho com contador e `aria-label` no padrão da BottomNav;
     - `#header-cart`; `aria-current` na view atual;
     - "Entrar" deslogado, nome logado;
     - "Painel da loja" só admin;
     - clique chama `onNavigate` com a view certa.
   - V1. **ROTINA.** Depende: onda 0.
9. **F1.9 Header monta o nav no desktop.**
   - Arquivos: `Header.tsx`; `tests/front/desktop-cabecalho-monta-nav.test.tsx`.
   - Teste (padrão B):
     - com desktop, `nav[aria-label="Navegação principal"]` dentro do header;
     - com aviso ativo (cápsula), o carrinho **continua** presente;
     - sem desktop, nada (o `carrinho-um-so-na-barra-de-baixo` segue verde).
   - Implementação: o nav fica fora do `AnimatePresence` da cápsula.
   - V1. **ROTINA.** Depende: F1.7, F1.8.
10. **F1.10 Voo do carrinho mira o visível** (decisão D2).
    - Arquivos: `src/utils/cartAnimation.ts`; `tests/front/carrinho-um-so-na-barra-de-baixo.test.tsx` (reescrito para o contrato novo).
    - Teste:
      - sem `matchMedia` (jsdom), o pop cai no `#bottom-nav-cart` e nunca no `#header-cart`, em 1440/1280/768/375 (casos atuais mantidos);
      - com stub de desktop, cai no `#header-cart`;
      - sem nenhum alvo, avisa e não quebra.
    - Implementação: `alvo = ehTelaDeComputador() && #header-cart ? #header-cart : #bottom-nav-cart`.
    - V1. **ROTINA** (teste com decisão do dono). Depende: F1.1.
11. **F1.11 Menu da conta no topo.**
    - Arquivos: `src/components/desktop/MenuDaContaDoTopo.tsx`, `NavegacaoDoTopo.tsx`; `tests/front/desktop-menu-da-conta-do-topo.test.tsx`.
    - Teste: logado, abre com Minha conta / Meus pedidos / Configurações da conta / Sobre a loja / [Painel da loja] / Sair; "Sair" chama o **mesmo** `useAuth().logout` do Perfil (sem lógica nova de auth); Esc fecha.
    - Implementação: `@/components/ui/dropdown-menu` (Radix; já vai no `vendor-radix` que a cliente baixa, então custo ~0).
    - V1. **RISCO** (auth). Depende: F1.8.
12. **F1.12 Dropdown da busca alinhado.**
    - Arquivos: `SearchBar.tsx`; `tests/front/desktop-dropdown-da-busca.test.tsx`.
    - Teste (padrão A): painel com `lg:max-w-[640px]`; véu sem mudança no celular.
    - V1. **ROTINA.** Depende: F1.7.
13. **F1.13 Selo "Compra segura" no checkout (desktop).**
    - Arquivos: `Header.tsx`; `tests/front/desktop-compra-segura.test.tsx`.
    - Teste (padrão B): com `hideSearch` + desktop, "Compra segura" visível ao lado do slot; o slot `#checkout-header-center-slot` continua existindo.
    - V1. **ROTINA.** Depende: F1.9.
14. **F1.14 Rodapé (componente).**
    - Arquivos: `src/components/desktop/RodapeDaLoja.tsx`; `tests/front/desktop-rodape-da-loja.test.tsx`.
    - Teste:
      - `config` completo → quatro blocos, "© {ano} {nome}";
      - `config` mínimo (sem WhatsApp, horário e endereço) → sem título órfão, sem "undefined", sem bloco vazio;
      - links chamam `onNavigate`;
      - `<footer>`.
    - V1. **ROTINA.** Depende: onda 0.
15. **F1.15 App monta o rodapé.**
    - Arquivos: `src/App.tsx`; `tests/front/desktop-rodape-no-app.test.tsx`.
    - Teste (padrão B com os mocks dos testes de App já existentes): com desktop, o rodapé aparece depois da home e do produto; em `checkout` não; sem desktop, nunca.
    - Implementação: `React.lazy` **depois** do último import (o teste Deno #515); dentro do `TabWrapper` e depois de `renderCustomerSecondaryView()` nos dois ramos (View Transition e motion). Não trazer framer-motion para o grafo estático.
    - V1 + `npm run test:unit -- tests/app_react_lazy_depois_do_import_test.ts`. **ROTINA** (arquivo compartilhado, serial). Depende: F1.14, F1.6.
16. **F1.16 Overlays no desktop.**
    - Arquivos: `CartReminder.tsx`, `PushNotificationBanner.tsx`; `tests/front/desktop-overlays.test.tsx`.
    - Teste (padrão A): no `lg`, canto inferior direito (`lg:bottom-8 lg:right-8 lg:left-auto lg:mx-0 lg:w-[400px]` / `lg:justify-end lg:px-8`).
    - V1. **ROTINA.** Depende: onda 0.
17. **F1.17 (P2) Troca de tela com fade no desktop.**
    - Arquivos: `src/index.css`, `AppMotionFallbacks.tsx`; teste padrão C/B.
    - Implementação: dentro do media, `::view-transition-old/new(root)` com fade de 150ms; no fallback motion, x=0 quando for computador.
    - V1. **ROTINA.** Depende: F1.5.
18. **F1.18 (P2) Barra de rolagem visível com mouse.**
    - Arquivos: `src/index.css`; teste padrão C.
    - Implementação: `@media (min-width:1024px) and (pointer:fine)` para `#conteudo` e `.active-scroll-container`, com especificidade de ID e `!important` para vencer o `*::-webkit-scrollbar` global.
    - V1. **ROTINA.** Depende: F1.5.
19. **F1.19 (P2) Menu "Categorias ▾".**
    - Arquivos: `src/components/desktop/MenuDeCategorias.tsx`, `Header.tsx`, `src/App.tsx`; `tests/front/desktop-menu-de-categorias.test.tsx`.
    - Teste: itens vêm do `useCategories`, ficam **escondidos até abrir** (não duplicam os chips visíveis, C12); escolher chama `onCategoryChange` + `onNavigate("home")`.
    - V1. **ROTINA.** Depende: F1.9.
20. **F1.20 Jornada de desktop.**
    - Arquivo: `tests/e2e/jornada-desktop-1440.spec.ts`.
    - Afirma a 1440×900:
      - nav do topo visível e barra de baixo invisível;
      - rodapé no fim da home;
      - produto com caixa de compra visível ao rolar;
      - adicionar faz o voo cair no `#header-cart`;
      - checkout com "Finalizar Pedido" dentro do `aside`.
    - Verificação: jornadas. **ROTINA.** Depende: integração com F3 e F6.

### F2 — Vitrine
1. **F2.1 Grade do catálogo.**
   - Arquivos: `ProductList.tsx`; `tests/front/desktop-grade-do-catalogo.test.tsx`.
   - Padrão A nas duas grades (carregando e carregada), com `GRADE_DE_PRODUTOS_NO_COMPUTADOR`.
   - V1. **ROTINA.** Depende: onda 0.
2. **F2.2 Card no desktop.**
   - Arquivos: `ProductCard.tsx`; `tests/front/desktop-card-do-produto.test.tsx`.
   - Padrão A: nome, preço e botão com os tamanhos da §3.4. `sizes` passa a `"(min-width: 1024px) 260px, (min-width: 640px) 280px, 50vw"`: o celular continua caindo em `50vw`, a mesma imagem.
   - Favoritar aparece com foco (`lg:hover-hover:group-focus-within:*`).
   - V1. **ROTINA.** Depende: onda 0.
3. **F2.3 Folha do card vira gaveta à direita.**
   - Arquivos: `ProductCard.tsx`; `tests/front/desktop-folha-do-card-gaveta.test.tsx`.
   - Padrão B: com desktop, `SheetContent` com `slide-in-from-right` e as classes de `GAVETA_NO_COMPUTADOR`; testids, alça e CTA iguais; sem desktop, o literal de hoje (`product-card-escolhe-opcoes-na-folha` e `sheet-fica-acima-da-navegacao-fixa` seguem verdes).
   - V1 + jornadas a 1280 (`folha-adicionar`, `folha-clique-fora`, `carrinho-ate-endereco`). **ROTINA.** Depende: F2.2.
4. **F2.4 Home no container: banner, frete e banners do meio e do fim.**
   - Arquivos: `HomeView.tsx`, `BannerCarousel.tsx`, `InfoBlockCarousel.tsx`; `tests/front/desktop-home-container.test.tsx`.
   - Padrão A. Mantém `aspect-[2/1]`, `md:aspect-[4/1]` e `minHeight: "200px"` (`home-nao-pula-contrato`). Acrescenta `lg:rounded-3xl` e o container.
   - O esqueleto do banner espelha as mesmas classes `lg:` (sem salto de layout no desktop).
   - V1. **ROTINA.** Depende: onda 0.
5. **F2.5 Prateleiras: 4/5 por vista + setas.**
   - Arquivos: `ProductCarousel.tsx`, `HomeView.tsx` (espelho `SecaoCarrosselEsqueleto`); `tests/front/desktop-prateleira-setas.test.tsx`.
   - Padrão B: setas "Ver anteriores" e "Ver próximos" só no desktop; clique chama `scrollBy` com a largura visível; sem desktop, nenhuma seta.
   - Padding inline das faixas: `lg:!px-0`.
   - V1. **ROTINA.** Depende: F2.2.
6. **F2.6 Ofertas: duas por vista.**
   - Arquivos: `PremiumOffers.tsx`, `HomeView.tsx` (espelho `SecaoOfertasEsqueleto`); `tests/front/desktop-ofertas-duas-por-vista.test.tsx`.
   - Padrão A: slide `lg:flex-[0_0_50%]`; o esqueleto espelha.
   - V1 + `premium-offers-gate-avaliacoes`. **ROTINA.** Depende: onda 0.
7. **F2.7 Barra do catálogo.**
   - Arquivos: `HomeView.tsx`, `CategoryFilter.tsx`; `tests/front/desktop-barra-do-catalogo.test.tsx`.
   - Padrão A: chips `lg:flex-wrap lg:overflow-visible`; título `lg:text-4xl`.
   - Padrão B: rótulo "Ordenar: <opção>" montado no desktop (não muda o nome acessível no jsdom). Os `aria-label` "Selecionar categoria X" ficam iguais (C12).
   - V1 + jornada `voltar-preserva-categoria`. **ROTINA.** Depende: onda 0.
8. **F2.8 Horário vai para o rodapé.**
   - Arquivos: `HomeView.tsx`; teste padrão A (`lg:hidden` no bloco de horário).
   - V1. **ROTINA.** Depende: F1.14 (contrato C6).

### F3 — Produto
1. **F3.1 Estrutura em duas colunas.**
   - Arquivos: `ProductView.tsx`; `tests/front/desktop-produto-duas-colunas.test.tsx`.
   - Teste:
     - sem desktop, a sequência de textos da tela (breadcrumb → título → preço → botão → abas → seções → relacionados) é idêntica à de hoje;
     - os wrappers novos só têm tokens `lg:`;
     - `classesDoCelular` dos elementos existentes igual ao literal de hoje.
   - Receita:
     - wrapper A em volta de galeria + bloco `px-5 py-4`, com container e grade;
     - o bloco `px-5 py-4` ganha `lg:contents`;
     - wrapper B = breadcrumb…botão (`COLUNA_FIXA_NO_COMPUTADOR`, col 2, `row-span-2`);
     - wrapper C = sentinela…espaçador, com abas, seções e relacionados **dentro** (a cadeia sticky das abas fica igual no celular).
   - V1 + harness do produto rolado até o fim. **ROTINA.** Depende: onda 0.
2. **F3.2 Galeria.**
   - Arquivos: `ProductView.tsx`; teste padrão A.
   - Caixa `lg:rounded-3xl`, altura até `100dvh − header − 96px`, sem o `lg:h-[70vh]` atual; pontos `lg:hidden`; setas visíveis; `sizes` `"(min-width: 1024px) 720px, 100vw"`.
   - V1. **ROTINA.** Depende: F3.1.
3. **F3.3 Miniaturas.**
   - Arquivos: `ProductView.tsx`; `tests/front/desktop-produto-miniaturas.test.tsx`.
   - Padrão B: com mais de uma foto, botões "Ver foto N de M" (nome diferente dos pontos "Foto N de M"); clique troca a foto; com variação de imagem, somem (mesma regra das setas).
   - V1. **ROTINA.** Depende: F3.2.
4. **F3.4 Caixa de compra.**
   - Arquivos: `ProductView.tsx`; teste padrão A.
   - Cartão com borda, `lg:p-8`, título, preço e botão na escala §3.4. "Adicionar ao Carrinho" e "M (5 un.)" iguais (C12).
   - V1 + jornadas `compra-ate-carrinho` e `voltar-preserva-categoria`. **ROTINA.** Depende: F3.1.
5. **F3.5 Barra dockada e espaçador somem.**
   - Arquivos: `ProductView.tsx`; teste padrão A (`lg:hidden` nos dois).
   - V1. **ROTINA.** Depende: F3.1.
6. **F3.6 Seções.**
   - Arquivos: `ProductView.tsx`, `ReviewCard.tsx`, `ProductQA.tsx`, `MarkdownRenderer.tsx`; teste padrão A.
   - Abas alinhadas à esquerda (`lg:mx-0`), descrição `lg:max-w-prose lg:text-base`, textos `lg:text-sm`.
   - V1. **ROTINA.** Depende: F3.1.
7. **F3.7 Relacionados em três colunas.**
   - Arquivos: `ProductView.tsx`; teste padrão A (`lg:grid-cols-3`, substituindo o `lg:grid-cols-4` de hoje, que é só desktop).
   - V1. **ROTINA.** Depende: F3.1.

### F4 — Busca e Favoritos
1. **F4.1 Favoritos: container, cabeçalho, grade e esqueleto.**
   - Arquivos: `FavoritesView.tsx`; `tests/front/desktop-favoritos-grade.test.tsx`.
   - Padrão A.
   - V1. **ROTINA.** Depende: onda 0.
2. **F4.2 CTA flutuante some; "Continuar comprando" no cabeçalho.**
   - Arquivos: `FavoritesView.tsx`; teste padrão A (`lg:hidden` no portal) + B (botão novo → `onNavigate("home")`).
   - V1. **ROTINA.** Depende: F4.1.
3. **F4.3 Vazio no desktop.**
   - Arquivos: `FavoritesView.tsx`; teste padrão A (`lg:max-w-5xl`, sugestões `lg:grid-cols-4`).
   - V1. **ROTINA.** Depende: F4.1.
4. **F4.4 Busca: container e grades.**
   - Arquivos: `SearchView.tsx`; teste padrão A nas duas grades e no cabeçalho sticky.
   - V1 + `acess-onda1-0509-contrato` (o `aria-label="Voltar"` fica).
   - **ROTINA.** Depende: onda 0.
5. **F4.5 Filtros viram gaveta.**
   - Arquivos: `SearchView.tsx`; teste padrão B (`side` e classes).
   - V1. **ROTINA.** Depende: F4.4.

### F5 — Carrinho e Meus pedidos
Todas **ROTINA**, com regra: diff só de classe e wrapper. Qualquer linha de estado, efeito, handler ou cálculo reclassifica para **RISCO**.

1. **F5.1 Cabeçalho das abas.**
   - Arquivos: `CartView.tsx`; `tests/front/desktop-carrinho-cabecalho.test.tsx`.
   - Padrão A: `h1` `sr-only lg:not-sr-only`; segmentado `lg:max-w-[360px]`; container.
   - V1 + `acess-onda3-invisivel-contrato` (tablist/tab/tabpanel iguais). Depende: onda 0.
2. **F5.2 Duas colunas refinadas + vazio.**
   - Arquivos: `CartView.tsx`, `EmptyCart.tsx`; teste padrão A.
   - Container no lugar de `max-w-7xl` (acrescentar, não trocar); resumo `lg:top-6`; "Finalizar Compra" igual.
   - V1 + jornadas `compra-ate-carrinho` e `carrinho-ate-endereco`. Depende: F5.1.
3. **F5.3 Itens em linhas largas.**
   - Arquivos: `CartItemsList.tsx`; teste padrão A (foto `lg:size-24`, colunas).
   - V1. Depende: F5.2.
4. **F5.4 "Entregar em" vira gaveta.**
   - Arquivos: `CartView.tsx`; teste padrão B.
   - O teste de devolução de foco (`onCloseAutoFocus`) segue verde. A jornada `trocar-endereco-carrinho` é a 390, sem mudança.
   - V1. Depende: F5.2.
5. **F5.5 Meus pedidos.**
   - Arquivos: `CartView.tsx`, `OrderList.tsx`, `OrderSearch.tsx`; teste padrão A.
   - Grade `lg:grid-cols-2 xl:grid-cols-3`; espaçador de 80px `lg:hidden` (estilo inline → envolver ou `lg:!h-0`); `OrderSearch` `lg:mx-auto lg:max-w-xl`.
   - V1. Depende: F5.1.

### F6 — Checkout e Sucesso (todas RISCO: revisor + revisor-risco)
1. **F6.1 Extrair o conteúdo do resumo.**
   - Arquivos: `src/components/checkout/ConteudoDoResumoDoPedido.tsx` (novo), `CheckoutView.tsx`; `tests/front/checkout-conteudo-do-resumo-extraido.test.tsx`.
   - Teste: dado carrinho, frete, desconto e total, renderiza itens, Subtotal, Entrega ("a calcular" sem cotação; riscado + Grátis com economia), Desconto e Total, com as mesmas regras de hoje.
   - Os testes atuais do painel do resumo seguem verdes sem edição.
   - Refatoração pura: mesmo DOM no painel.
   - V1 + `npm run test:front -- tests/front/checkout` (os ~68 que citam CheckoutView). Depende: onda 0.
2. **F6.2 Grade de desktop + `aside` do resumo.**
   - Arquivos: `CheckoutView.tsx`; `tests/front/desktop-checkout-aside.test.tsx`.
   - Padrão B: com desktop, `aside[aria-label="Resumo do pedido"]` com o `ConteudoDoResumoDoPedido`; sem desktop, nada (DOM de hoje).
   - Padrão A no container do formulário (`lg:max-w-[1120px]`, grade).
   - V1. Depende: F6.1.
3. **F6.3 Barra "Finalizar Pedido" portada para o `aside`.**
   - Arquivos: `CheckoutView.tsx`; `tests/front/desktop-checkout-finalizar-no-aside.test.tsx`.
   - Teste:
     - com desktop, o botão "Finalizar Pedido" e as mensagens de validação e recusa estão **dentro** do `aside` (uma única instância);
     - sem desktop, no portal do `body` como hoje;
     - a coluna de totais da barra tem `lg:hidden`.
   - Implementação: `createPortal(barra, computador && asideEl ? asideEl : document.body)`; classes `lg:static lg:inset-auto lg:translate-x-0 lg:max-w-none`; sem animação de entrada em `y` no desktop.
   - V1 + jornada `carrinho-ate-endereco` a 1280. Depende: F6.2.
4. **F6.4 Gatilho do topo e espaçadores somem no desktop.**
   - Arquivos: `CheckoutView.tsx`; teste padrão A (`lg:hidden` no botão do gatilho e nos dois espaçadores).
   - O painel não abre no desktop, porque não há gatilho visível.
   - V1 + `checkout-seta-voltar-so-fecha-painel-primeiro-toque`. Depende: F6.3.
5. **F6.5 Pagamento e telas finais.**
   - Arquivos: `CheckoutView.tsx`; teste padrão A.
   - Coluna de pagamento `lg:max-w-[560px] lg:pt-10`; `SuccessView`, `PagamentoConfirmadoView`, `PagamentoForaDoPrazoView` e `AddressSelectionView` como cartão central.
   - **Sem tocar** `PagamentoOnline`/`PagamentoComCartao`.
   - V1. Depende: onda 0.
6. **F6.6 Pedido feito.**
   - Arquivos: `OrderSuccessView.tsx`; teste padrão A.
   - V1. **ROTINA.** Depende: onda 0.

### F7 — Minha conta
1. **F7.1 Menu da conta.**
   - Arquivos: `src/components/desktop/MenuDaConta.tsx`; `tests/front/desktop-menu-da-conta.test.tsx`.
   - Teste: avatar, nome, e-mail; links (Minha conta → `profile`, Meus pedidos → `orders`, Configurações → `account-settings`, Sobre a loja → `about-store`); "Painel da loja" só admin; `aria-current` no atual; `<aside aria-label="Minha conta">`.
   - **Sem "Sair"** (fica no cartão do Perfil), por isso ROTINA.
   - V1. **ROTINA.** Depende: onda 0.
2. **F7.2 Perfil.**
   - Arquivos: `ProfileView.tsx`; `tests/front/desktop-perfil.test.tsx`.
   - Padrão B (menu montado) + padrão A.
   - Grade `[280px_1fr]`; capa `lg:rounded-3xl lg:h-56` no conteúdo; Endereços \| Pedidos pela receita de blocos contíguos; cartão-menu `lg:hidden`.
   - V1. **ROTINA.** Depende: F7.1.
3. **F7.3 Configurações.**
   - Arquivos: `AccountSettingsView.tsx`; teste padrão A/B.
   - Menu, `lg:max-w-3xl`, campos em 2 colunas.
   - V1 + `acess-onda1-0509-contrato`. **RISCO** (arquivo da troca de senha; diff só de layout). Depende: F7.1.
4. **F7.4 Endereço.**
   - Arquivos: `AddressFormView.tsx`; teste padrão A/B.
   - V1. **ROTINA.** Depende: F7.1.
5. **F7.5 Perfil público.**
   - Arquivos: `UserProfileView.tsx`; teste padrão A.
   - V1 + `user-profile-view-gate-avaliacoes*`. **ROTINA.** Depende: onda 0.

### F8 — Pedido, Notificações, Sobre, Login
1. **F8.1 Detalhe do pedido em duas colunas.**
   - Arquivos: `OrderDetailsView.tsx`; `tests/front/desktop-pedido-duas-colunas.test.tsx`.
   - Teste: sem desktop, a ordem dos cartões é idêntica; os wrappers E (status…itens) e D (resumo…ações) têm o **mesmo** `space-y-4` do pai; no `lg`, `lg:grid lg:space-y-0`, D com `COLUNA_FIXA_NO_COMPUTADOR`.
   - V1 + testes de `OrderDetailsView` (~22). **RISCO** (tela com cancelar, estorno e devolução). Depende: onda 0.
2. **F8.2 Modal de avaliação central.**
   - Arquivos: `OrderDetailsView.tsx`; teste padrão A (`lg:items-center`, `lg:rounded-[2.5rem]`).
   - O `aria-label="Fechar avaliação"` fica (contrato).
   - V1. **RISCO.** Depende: F8.1.
3. **F8.3 Notificações.**
   - Arquivos: `NotificationsView.tsx`; teste padrão A (`lg:max-w-3xl lg:mx-auto`).
   - V1. **ROTINA.** Depende: onda 0.
4. **F8.4 Sobre a loja.**
   - Arquivos: `AboutStoreView.tsx`; teste padrão A.
   - Duas colunas `lg:max-w-5xl`; FAB `lg:!bottom-8 lg:right-8`.
   - V1 + `bottom-nav-perfil-ativo-na-rota-about-store`. **ROTINA.** Depende: onda 0.
5. **F8.5 Login e cadastro.**
   - Arquivos: `AuthView.tsx`; teste padrão A.
   - Cartão centrado na vertical; P2: painel de marca montado pelo gancho, só com logo, nome e o subtítulo existente.
   - V1 + testes de `AuthView` (~13) + `destino-pos-login-volta-com-id`. **RISCO** (auth). Depende: onda 0.

### Integração (F1, Onda 2)
- **I.1** Merge das frentes na ordem de §C + V3 com a saída colada. **ROTINA.**
- **I.2** Harness completo: celular = 0 em todas as telas e estados de §4.4 da spec + capturas de desktop (1024, 1280, 1440, 1920) para o Gabriel aprovar. **ROTINA.**
- **I.3** Se o CI medir warnings abaixo do teto, abaixar o `.lint-baseline.json` com o número do CI (a regra do arquivo). **ROTINA.**
- **I.4** Versão de release (+1 no patch no `package.json` e nas duas raízes do lock) **só depois** da aprovação do Gabriel no preview. **ROTINA.**

## F. Riscos
1. **Pacote:**
   - estimativa de +10 a 15 kB brotli de JS da cliente (nav, menu, rodapé, miniaturas, setas, `aside`) e +3 a 6 kB de CSS;
   - folga de ~74 kB até 550 e de ~73 kB até 100 no CSS;
   - nenhuma dependência nova (o dropdown do Radix já está no `vendor-radix` da cliente);
   - cada frente mede no V2.
2. **Testes que dependem de classe ou estrutura:**
   - testes-contrato procuram literais inteiros (regra R2);
   - testes de App mockam Header e BottomNav;
   - ~200 arquivos citam as telas da cliente;
   - nenhum stub atual devolve `matches: true`, então todo teste antigo segue no caminho do celular.
3. **Jornadas e2e a 1280 viram jornadas de desktop:** invariantes C12. A folha do card como diálogo central quebraria `folha-clique-fora`. Desmontar a BottomNav quebraria `folha-adicionar-carrinho`.
4. **PWA / service worker:**
   - sem mudança de SW;
   - chunks novos entram no precache sozinhos (não usar nome começando por "Admin");
   - a atualização segue o aviso com consentimento;
   - versão só em release.
5. **Checkout:** mover a barra de "Finalizar" é o maior risco. É uma instância só (troca de alvo do portal), fica no caminho do dinheiro, tem revisão cara e entra por último. O Brick, o 3DS e a CSP não são tocados.
6. **Acessibilidade AA:**
   - contraste de rótulo (zinc-400 → zinc-500 no desktop);
   - foco revelando controles escondidos por hover;
   - marcos e nomes únicos;
   - ordem visual igual à do DOM;
   - alvo de 24px.
7. **Português (pt-BR):** todo texto novo em pt-BR com acento (lista: Entrar, Minha conta, Meus pedidos, Configurações da conta, Sobre a loja, Painel da loja, Sair, Compra segura, Ver anteriores, Ver próximos, Ver foto N de M, Continuar comprando, Ordenar, Resumo do pedido, Navegue, Sua conta, Atendimento). Moeda por `formatCurrency` (Intl pt-BR). O `cspell` com pt-BR já existe.
8. **Estrutura invisível:** receitas de §4.3 da spec. O harness só pega o que fotografar, daí a exigência de fotografar no fim da rolagem.
9. **Cápsula de aviso × nav do topo:** o carrinho não pode sumir durante o aviso (teste em F1.9).
10. **Altura curta** (notebook de 657px úteis): colunas grudadas com `max-h` e rolagem interna.
11. **Toque em ≥1024** (iPad): nada depende de hover.
12. **Tema escuro/vidro da loja:** as peças novas usam os tokens das vizinhas. O harness fotografa uma loja fixture com `themeMode` escuro, se a ficha permitir.

## G. Perguntas ao dono
1. **D1** — Corte em 1024px (tablet deitado e notebook viram site; iPad Pro em retrato também). Recomendo sim.
2. **D2** — No computador o carrinho sai da barra de baixo e vai para o topo, sempre um só visível. Revisita a decisão de 24/08. Recomendo sim.
3. **D3** — Rodapé sem ícones de pagamento na 1ª versão, para não prometer cartão desligado. Recomendo sim.
4. **D4** — Checkout em duas colunas no computador, com "Finalizar Pedido" na coluna do resumo. Recomendo sim.
5. **D5** — Os itens P2 (menu Categorias, fade na troca de tela, barra de rolagem visível, painel de marca no login) entram agora ou depois? Recomendo depois do P1 aprovado.
6. Tablet em retrato (768–1023) fica exatamente como hoje nesta entrega (a pílula flutuante continua ali). Confirma?

## H. Suposições
- O inventário vem do código em f2e907bf. Nenhuma tela nova foi criada. Banner de cookies, prompt de instalação e página de departamento não existem e não entram.
- Container de 1280/1440, grade 4/5, cabeçalho de 72px, coluna de compra de 420/440px, checkout 1120/380, conta 280 + conteúdo: escolha minha, dentro da identidade atual. O Gabriel pode vetar.
- O harness paralelo aceita o kit `tests/e2e/kit-jornadas.ts` como base e cria as sessões sintéticas de cliente e de admin. Sem elas, Perfil, Pedidos e Checkout logado ficam sem prova visual.
- O App é SPA, sem SSR. O "porteiro" (`src/hospedagem`) só injeta a ficha no HTML.
- Nesta sessão Linux o mural do Windows não existe. O equivalente é um worktree por frente, com as travas do AGENTS.
- Ferramentas: não usei `serena` nem `skill-router` (não estão disponíveis para mim); os chamadores foram achados com Grep. Não consultei `context7` porque não há API nova: os usos de `useSyncExternalStore` e `matchMedia` são da plataforma e do React 19 já presentes no repo.
