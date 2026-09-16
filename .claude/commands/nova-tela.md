---
description: Registra uma tela nova em TODOS os pontos do roteador manual
argument-hint: <nome-da-view> [customer|admin]
---

# Nova tela: $ARGUMENTS

Este projeto **não usa react-router**. Uma tela só existe de verdade quando o nome está registrado em todos os pontos abaixo. Registrar em menos lugares é o bug clássico daqui: a tela abre pela navegação em memória (`onNavigate`) mas cai em `home` no F5 ou em `/`, porque o leitor de endereço (`src/config/rotas.ts`) não a reconhece — ou o botão Voltar do admin leva ao lugar errado, porque `src/utils/pai-da-tela-do-admin.ts` não tem `case` pra ela e cai no `default` (`"profile"`).

Exemplo de ponta a ponta usado no checklist abaixo: registrar `admin-pdv` como **sub-view** do admin (dentro de `AdminArea`, sem virar uma 6ª tab principal) — é o desenho recomendado para uma tela nova que não precisa de aba própria.

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
  - se for tab principal (sempre montada), receber `active`/`isActive` e **gatear fetch, timers, subscriptions e diálogos** nessa prop (ver `src/views/admin/AdminProductsView.tsx`, âncora: `rg -n "\\bactive\\b" src/views/admin/AdminProductsView.tsx`);
  - se editar dados no admin, receber e chamar `onSetDirty(true|false)` — sem isso o usuário perde dados sem aviso;
  - se tiver modal/overlay que precisa capturar o Voltar do celular, usar `onSetBackOverride(fn)`.
- Formulário: cliente = react-hook-form + zod (modelo: `src/views/customer/CheckoutView.tsx`); admin = `useState` + `src/components/admin/LocalBufferedInput.tsx` (nunca react-hook-form no admin).
- Componente novo: primitivo shadcn → `src/components/ui/`; negócio compartilhado → `src/components/ui/custom/`; exclusivo do admin → `src/components/admin/`.

## 3. Checklist de registro da rota (todos obrigatórios)

As linhas abaixo são uma fotografia de hoje — confira com o `rg` sugerido antes de confiar nelas, porque outras tarefas mexem nestes mesmos arquivos.

1. Union `View` — `src/types/index.ts` (hoje linhas 310-350; âncora: `rg -n "^export type View" src/types/index.ts`). Adicione `"admin-pdv"` ao union.
2. `TELAS_DE_ENTRADA` — `src/config/rotas.ts` (hoje linhas 9-47; âncora: `rg -n "TELAS_DE_ENTRADA"` no arquivo). **Sem isso F5 e deep-link caem em `home`** — é esta lista, não mais um array dentro de `syncWithUrl`, que valida o path. Junto:
   - espelhe a mesma entrada, na mesma posição, em `scripts/hospedagem.mjs` (`export const telasDeEntrada`, hoje linhas 16-54; âncora: `rg -n "telasDeEntrada = Object.freeze"`) — `tests/front/hospedagem-rotas.test.ts` compara os dois lados e falha se divergirem;
   - atualize as contagens fixas em `tests/front/rotas-de-entrada.test.ts` (hoje: 37 nomes → 38, 18 admin → 19) e em `tests/front/hospedagem-rotas.test.ts` (hoje: 55 formas → 57, porque toda `admin-x` ganha o alias `/admin/x`; 110 linhas de `_redirects` → 114).
3. `VIEW_COMPONENTS` — `src/App.tsx` (âncora: `rg -n "^const VIEW_COMPONENTS"`), com `"admin-pdv": AdminArea` (sub-view do admin sempre aponta para `AdminArea`, quem escolhe o conteúdo é o switch interno dela — passo 9).
4. `adminViews` dentro de `renderCustomerContent` — `src/App.tsx` (âncora: `rg -n "const adminViews: View\[\]"`). Lista as views privadas que mostram o spinner de `authLoading`.
5. `subAdminViews` + o `if`/`else if` de reroute do popstate logo abaixo, dentro de `syncWithUrl` — `src/App.tsx` (âncora: `rg -n "const subAdminViews"`). É o pai que o botão Voltar do navegador usa ao sair de uma sub-view; **use o mesmo pai do passo 11** (`paiDaTelaDoAdmin`) — hoje já existem casos que divergem (ex.: `admin-push`/`admin-banners` caem aqui em `admin-dashboard`), não introduza mais um.
6. `adminViewIndices` dentro de `getNavigationDirection` — `src/App.tsx` (âncora: `rg -n "const getNavigationDirection"`). É o peso que decide a direção da animação (forward/back). Sem entrada, a direção vira sempre `"forward"` — não quebra, só fica menos correto.
7. As **quatro** listas de views que ganham `?id=` na URL — `src/App.tsx` (âncora: `rg -n '"admin-push",' src/App.tsx`, que aponta as quatro junto de outras ocorrências vizinhas: três são arrays `[...].includes(view)`, uma é uma cadeia de `targetView !== "..."`). Só adicione `"admin-pdv"` às quatro se a sub-view puder receber um id existente (ex.: retomar uma venda) — reaproveite o state `selectedProductId` (nome genérico, já usado para produto/pedido/usuário/cupom/endereço), não crie state de id novo.
8. `VIEW_PREFETCH_MAP` — `src/hooks/usePrefetchOnHover.ts` (âncora: `rg -n "const VIEW_PREFETCH_MAP"`). Opcional: sem entrada, `prefetchViewPromise` resolve vazio e o preload de `VIEW_COMPONENTS` ainda espera o chunk normalmente — só perde o aquecimento no hover. Atenção: entrar aqui também entra em `prefetchAll` (chamado no idle da rede), que baixa o chunk pra **todo** cliente, não só quem usa a tela — pese o tamanho do chunk antes de adicionar uma view rara.
9. `src/components/layouts/AdminArea.tsx` (âncora: `rg -n "lazyWithPreload"` e `rg -n 'case "admin-'`): declare `const AdminPdv = lazyWithPreload(() => import("@/views/admin/AdminPdvView").then(m => ({ default: m.AdminPdvView })))` e o `case "admin-pdv":` no switch de sub-views, retornando `<LocalErrorBoundary key="admin-pdv"><PreloadedOrLazy component={AdminPdv} props={{ onNavigate, active: currentView === "admin-pdv", onSetDirty }} /></LocalErrorBoundary>`. Como sub-view, **não mexa** nos dois ramos de tabs principais (View Transitions e fallback) nem em `isMainTab`/`activeTabIdx`.
10. `AdminViewLoadingFallback` — mesmo arquivo (âncora: `rg -n "AdminViewLoadingFallback"`): acrescente `else if (view === "admin-pdv") title = "PDV";` — sem isso o skeleton mostra "Painel".
11. `paiDaTelaDoAdmin` — `src/utils/pai-da-tela-do-admin.ts` (âncora: `rg -n "case \"admin-"`): `case "admin-pdv": return "admin-dashboard";` (ou uma regra sensível à origem, como a de `admin-push` no mesmo arquivo). **Sem isso o `default` devolve `"profile"`**: o botão do `AdminLayout` passa a dizer "Perfil" e o Voltar sai do painel inteiro. `AdminLayout.tsx` só chama essa função (`getParentView`); a lógica real mora aqui. Adicione o caso em `tests/front/pai-da-tela-do-admin.test.ts`.
12. Só se a tela virar uma **tab principal** (não é o caso de `admin-pdv` no exemplo): `navItems` em `src/components/layouts/AdminLayout.tsx` (âncora: `rg -n "const navItems = \["`) e, junto, `ADMIN_TABS_SET` (`src/App.tsx`, âncora: `rg -n "const ADMIN_TABS_SET"`), `isMainTabNav` (âncora: `rg -n "const isMainTabNav"`), o atalho `Ctrl+Alt+<letra>` (âncora: `rg -n "handleKeyDown"`) e, em `AdminArea.tsx`, um `TabWrapper` novo nos dois ramos de tabs (View Transitions e fallback) com `index` coerente com a posição em `navItems`, mais `isMainTab`/`activeTabIdx`.

Não é preciso mexer em `AdminAreaGate` nem no ponto do `App.tsx` que decide montar a área admin (qualquer view `admin*` ≠ `admin-login` já monta) — nenhum dos dois olha o nome da view.

Se a tela for do **cliente** (não admin), o equivalente aos passos 5/9/10/11/12 é o switch em `renderCustomerSecondaryView` (`src/App.tsx`) e os dois ramos (View Transitions/fallback `motion.div`) do render do cliente — **altere os dois**, senão o bug só aparece em Safari/Firefox (ou só em Chrome).

Outros pontos, sempre:
- Monte via `<PreloadedOrLazy component={X} props={{...}}/>` dentro de `<LocalErrorBoundary>`, como as vizinhas.
- Não crie `overflow-y-auto` próprio na view: o scroll restaurado é o do `<main>` (cliente) e o do `.active-scroll-container` (admin).

## 4. Verificar o registro antes de dar por pronto
```
rg -n "<nome-da-view>" src/ scripts/hospedagem.mjs
```
Deve aparecer, no mínimo, em: `src/types/index.ts`, `src/config/rotas.ts`, `scripts/hospedagem.mjs`, `src/App.tsx` (várias ocorrências) e no switch de render (`AdminArea.tsx` ou `renderCustomerSecondaryView`). Se for sub-view do admin, também em `src/utils/pai-da-tela-do-admin.ts`. Conte as ocorrências — se der bem menos que isso, algum passo do item 3 ficou faltando.

## 5. Gate
```
npx biome check <arquivos-alterados>
npx tsc -b
npx eslint <arquivos-alterados> --quiet
npx vitest run tests/front/rotas-de-entrada.test.ts tests/front/hospedagem-rotas.test.ts tests/front/pai-da-tela-do-admin.test.ts
```
`npm run typecheck` (= `tsc -b --force`) é válido aqui — pode usar como prova, apesar do `tsconfig.json` raiz ter `files: []` (o `-b` builda os projetos referenciados, não o raiz). Rode a suíte inteira (`npm test`) antes de considerar a tarefa pronta, não só os três arquivos acima.

## 6. Teste manual do deep-link
`npm run dev` → navegue até a tela → **F5 na URL `/<nome-da-view>`** → volte pelo histórico do navegador. Se cair em `home`, faltou o passo 2 (`TELAS_DE_ENTRADA`). Se o Voltar levar a lugar errado, faltou o passo 11 (`paiDaTelaDoAdmin`) ou ele diverge do passo 5 (reroute do popstate).

> Se a navegação programática "sumir" logo depois de outra: `handleNavigate` tem throttle (400ms / safety 800ms) e descarta destinos que não sejam tab principal nem `auth|login|home|profile|admin`, com um `console.warn`.
