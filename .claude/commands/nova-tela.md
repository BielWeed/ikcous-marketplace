---
description: Registra uma tela nova em TODOS os pontos do roteador manual
argument-hint: <nome-da-view> [customer|admin]
---

# Nova tela: $ARGUMENTS

Este projeto **não usa react-router**. Uma tela só existe de verdade quando o nome está registrado em todos os pontos abaixo. Registrar em menos lugares é o bug clássico daqui — `admin-carousels` está assim hoje: abre na navegação em memória e cai em `home` no F5.

## 1. Definir o nome
- kebab-case, idêntico em todos os arquivos.
- Confirme que ainda não existe: `rg -n "'<nome-da-view>'" src/`
- Não reaproveite entradas mortas do union `View`: `product` (a real é `product-detail`), `referral` e `admin-sros` não existem em lugar nenhum e o TypeScript aceita sem erro.

## 2. Criar o arquivo da view
- Cliente: `src/views/customer/<Nome>View.tsx` · Admin: `src/views/admin/Admin<Nome>View.tsx`
- **Export nomeado** (`export function <Nome>View`). Export default quebra o padrão de import de todo mundo.
- A view **não** renderiza `<Header>`, `<BottomNav>` nem chrome do admin — quem desenha é o `App` (cliente) e o `AdminLayout` (admin). View admin renderiza só o conteúdo.
- Props obrigatórias conforme o caso:
  - navegação sempre por `onNavigate(view, id?)` — nunca `history.pushState`, `location.href` ou `<a href>` para telas internas;
  - se for tab principal (sempre montada), receber `active`/`isActive` e **gatear fetch, timers, subscriptions e diálogos** nessa prop (ver `src/views/admin/AdminProductsView.tsx` linhas 121/172/218);
  - se editar dados no admin, receber e chamar `onSetDirty(true|false)` — sem isso o usuário perde dados sem aviso;
  - se tiver modal/overlay que precisa capturar o Voltar do celular, usar `onSetBackOverride(fn)`.
- Formulário: cliente = react-hook-form + zod (modelo: `src/views/customer/CheckoutView.tsx`); admin = `useState` + `src/components/admin/LocalBufferedInput.tsx` (nunca react-hook-form no admin).
- Componente novo: primitivo shadcn → `src/components/ui/`; negócio compartilhado → `src/components/ui/custom/`; exclusivo do admin → `src/components/admin/`.

## 3. Checklist de registro da rota (todos obrigatórios)
1. Union `View` — `src/types/index.ts` (~linha 245)
2. `VIEW_COMPONENTS` — `src/App.tsx` (~linha 147), com `lazyWithPreload(() => import("@/views/...").then(m => ({ default: m.<Nome>View })))`
3. Array `validViews` dentro de `syncWithUrl` — `src/App.tsx` (~linha 1397). **Sem isso deep-link e F5 não funcionam.**
4. `VIEW_PREFETCH_MAP` — `src/hooks/usePrefetchOnHover.ts`
5. Switch de render: `renderCustomerSecondaryView` em `src/App.tsx` **ou** o switch de sub-views em `src/components/layouts/AdminArea.tsx`

Se for tela **admin**, também:

6. `adminViews` / `privateViews` — `src/App.tsx` (~linha 2099)
7. `adminViewIndices` em `getNavigationDirection` — `src/App.tsx`
8. `getParentView()` — `src/components/layouts/AdminLayout.tsx` (~linha 486)
9. Switch de reroute do popstate — `src/App.tsx` (~linhas 1439-1503). **Use o mesmo pai do passo 8** — hoje `admin-banners`/`admin-push` divergem (App manda para `admin-dashboard`, AdminLayout para `admin-settings`).

Outros pontos conforme o caso:
- Recebe `?id=`: use o state existente `selectedProductId` (id genérico usado para produto/pedido/usuário/cupom/endereço) e adicione a view nas **3** listas de views-que-aceitam-id do `App.tsx`. Não crie state de id novo.
- Tab principal ou sub-view do admin: `AdminArea.tsx` e `renderCustomerContent` duplicam a árvore inteira em dois ramos (View Transitions e fallback `motion.div`) — **altere os dois**, senão o bug só aparece em Safari/Firefox (ou só em Chrome).
- Monte via `<PreloadedOrLazy component={X} props={{...}}/>` dentro de `<LocalErrorBoundary>`, como as vizinhas.
- Não crie `overflow-y-auto` próprio na view: o scroll restaurado é o do `<main>` (cliente) e o do `.active-scroll-container` (admin).

## 4. Verificar o registro antes de dar por pronto
```
rg -n "<nome-da-view>" src/
```
Deve aparecer, no mínimo, em: `src/types/index.ts`, `src/App.tsx` (3+ ocorrências), `src/hooks/usePrefetchOnHover.ts` e no switch de render. Conte as ocorrências — se der menos que isso, algum passo do item 3 ficou faltando.

## 5. Gate
```
npx biome check .
npx tsc -b
npx eslint <arquivos-alterados> --quiet
```
`npm run typecheck` é no-op neste repo (tsconfig.json tem `files: []`) — não use como prova.

## 6. Teste manual do deep-link
`npm run dev` → navegue até a tela → **F5 na URL `/<nome-da-view>`** → volte pelo histórico do navegador. Se cair em `home`, faltou o passo 3.3. Se o Voltar levar a lugar errado, faltou alinhar 3.8 com 3.9.

> Se a navegação programática "sumir" logo depois de outra: `handleNavigate` tem throttle (400ms / safety 800ms) e descarta destinos que não sejam tab principal nem `auth|login|home|profile|admin`, com um `console.warn`.
