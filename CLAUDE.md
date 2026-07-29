# CLAUDE.md — core_app_mkt (IKCOUS Marketplace PWA)

PWA Vite + React 19 + TS + Supabase, vendido por assinatura. Este diretório é o **Core**; cada cliente é um **fork físico** dele (Supabase próprio, Vercel próprio, marca própria), sincronizado pelo `manager-claude`. Tudo que você escreve aqui vai para todos os clientes.

## Comandos do dia a dia

```bash
npm run dev              # Vite (porta 5173, strictPort). SEM service worker (devOptions.enabled=false).
npx biome check .        # ~2s, 211 arquivos. Sempre o primeiro: lint + format + ordem de imports.
npx tsc -b               # ~16s. O typecheck REAL.
npx eslint <arquivos-que-voce-mudou> --quiet   # ~5s escopado. a11y + react-hooks/React Compiler.
npm run build            # ~37s. Roda `npx tsc -b` + vite build + PWA. Gate definitivo.
npm run preview          # http://localhost:4173 — único jeito de testar service worker.
```

Situacionais:
- CSS: `npx stylelint "src/**/*.css" --fix`
- SQL/migrations: `python -m sqlfluff lint supabase --dialect postgres`
- Bundle (só depois de `npm run build`): `npx size-limit` (teto 800 kB JS / 100 kB CSS; hoje 614.52 / 26.93)
- Código morto / view registrada pela metade: `npx knip`
- Backend completo: `powershell -NoProfile -ExecutionPolicy Bypass -File .\supabase\setup\Verificar_Completo.ps1`
- Schema alterado: gerar tipos pelo **Supabase MCP** → `src/types/database.types.ts` (não existe `gen:types` no npm).

**Nunca use `npm run typecheck`** — `tsconfig.json` é solution-style (`"files": []`), então `tsc --noEmit` compila **zero** arquivos e sempre passa. **Nunca use `npm run sqlfluff:lint`** — o binário não está no PATH. As suítes `.bat` de `Ferramentas para projetos/` terminam em `pause`: rode **sempre** com stdin redirecionado (`< /dev/null`), senão travam a sessão. Ver *Suíte de qualidade externa* abaixo.

## Antes de dar a tarefa por concluída

1. `npx biome check .` → 2. `npx tsc -b` → 3. `npx eslint <seus arquivos> --quiet`. (~25s, pega ~90% do que quebra.)
4. Mexeu em CSS / SQL / dependência? rode o check situacional correspondente.
5. Antes de PR ou deploy: `npm run build`, depois `npx size-limit`, `npx eslint . --quiet`, `npx knip`.

**O baseline do repo já é vermelho** (7 erros + 534 warnings de eslint, 17 de biome, 13 de stylelint, 63 de cspell). Exit code 0 não é critério — compare a *contagem* antes/depois, ou rode só nos arquivos que você tocou. **O build é mais estrito que os linters**: `noUnusedLocals`/`noUnusedParameters` são erro em `tsconfig.app.json`, mas só warning no eslint e no biome — por isso `tsc -b` é obrigatório.

**Não existe teste automatizado.** Zero `*.test.*`/`*.spec.*`, sem vitest, sem playwright, sem script `test`, sem CI (`.github/` só tem copilot-instructions.md), `lefthook.yml` 100% comentado. Qualquer instrução do tipo "rode os testes" é inexequível aqui.

## Suíte de qualidade externa

Fora do repositório, em `C:\Users\Gabriel\Documents\Ferramentas para projetos`, existe uma suíte própria com 6 módulos, cada um com guia
específico do ikcous em `<módulo>/projetos/ikcous/`: Código e Linter · Frontend e PWA ·
Acessibilidade e SEO · Debug e Otimizações · Verificação do Backend · Segurança.

```bash
# Modo rápido — linters velozes dos 6 módulos, antes de commit
cmd //c "C:\Users\Gabriel\Documents\Ferramentas para projetos\Executar_Todas_Suites_Modo_Rapido.bat" < /dev/null

# Modo completo — Deno/pgTAP, build real, auditoria de RLS, Gitleaks/Semgrep/TruffleHog/Snyk
cmd //c "C:\Users\Gabriel\Documents\Ferramentas para projetos\Executar_Todas_Suites_Modo_Completo.bat" < /dev/null
```

O `< /dev/null` é obrigatório: os dois orquestradores terminam em `pause`. O modo completo é longo —
use antes de deploy, não a cada tarefa. O gate rápido do repositório (biome → tsc -b → eslint)
continua sendo o de uso diário.

## Arquitetura

- **Roteamento manual, sem react-router.** `src/App.tsx` (2.713 linhas) guarda `currentView` e sincroniza com a URL via `history.pushState` + `popstate` (`syncWithUrl`). Toda navegação é `onNavigate(view, id?)` passado como prop.
- **Firewall admin duplo**: `React.lazy` em App.tsx:54 cuja factory chama `supabase.rpc("is_admin")` antes de importar `@/components/layouts/AdminArea`, e render só se `isAdmin`. Admin tem roteador interno (switch em `AdminArea.tsx`) e chrome próprio (`AdminLayout.tsx`).
- **Estado global = context puro** (sem Redux/Zustand/react-query). Ordem obrigatória: `main.tsx` → GlobalErrorBoundary > AuthProvider > NotificationProvider > HelmetProvider; `App.tsx` → StoreProvider > CartProvider > FavoritesProvider (Cart e Favorites consomem `useStore()`/`useAuth()`).
- **Dados offline-first em 3 andares**: singleton `src/lib/supabase.ts` → `DataVault` (IndexedDB `ikcous-datavault` v2, 7 stores) → `RealtimeSyncEngine` (um canal, 6 tabelas, só na aba líder via `useLeaderElection`, replicado às outras por BroadcastChannel). Todo hook faz stale-while-revalidate: lê o vault → setState → rede → mapeia → `replaceAll` + `setLastSync`.
- **PWA**: `injectManifest` + SW manual em `src/sw/sw.ts`, `registerType: "prompt"`. `useUpdateCheck.ts` é o cérebro do update.
- **Banco**: Postgres/Supabase, 134 migrations quase todas aditivas/hardening. RLS em tudo; escrita de pedido só via RPC `create_marketplace_order`.

## Convenções

### Rotas e UI
- **Criar uma tela = editar 5 lugares em sincronia**: (1) union `View` em `src/types/index.ts:245`; (2) `VIEW_COMPONENTS` em App.tsx (~147); (3) array `validViews` dentro de `syncWithUrl` (~1397) — sem isso deep-link e F5 quebram; (4) `VIEW_PREFETCH_MAP` em `src/hooks/usePrefetchOnHover.ts`; (5) o switch de render (`renderCustomerSecondaryView` ou o de `AdminArea`). Tela admin exige ainda `adminViews`/`privateViews` (~2099), `adminViewIndices` em `getNavigationDirection` e `getParentView()` do AdminLayout.
- Nunca chame `history.pushState`, `location.href` ou `<a href>` para telas internas — o App faz o pushState e aplica os guards.
- O 2º parâmetro de `handleNavigate` é o `selectedProductId`, **id genérico** reusado como productId/couponId/userId/selectedOrderId. Não crie state de id novo.
- View = **export nomeado** (`export function HomeView`), montada por `lazyWithPreload(() => import(...).then(m => ({default: m.HomeView})))` dentro de `<LocalErrorBoundary>` + `<PreloadedOrLazy>`. Export default quebra o padrão.
- Views não renderizam header/nav próprios: `<Header>`/`<BottomNav>` são do App; no admin quem desenha é o `AdminLayout`.
- Onde colocar componente: primitivo shadcn puro → `src/components/ui/` (CLI shadcn, style new-york, `cva` + `data-slot` + `cn()`); componente de negócio → `src/components/ui/custom/`; exclusivo do admin → `src/components/admin/`.
- Stack fixa: `cn()` de `@/lib/utils`, ícones `lucide-react`, toasts `sonner` (pt-BR), animações `framer-motion`. Não introduza outra lib — CSP e manualChunks estão calibrados para essas.
- Tabs principais (home/favorites/cart/profile; admin dashboard/orders/products/customers/settings) ficam **permanentemente montadas**. Toda view de tab recebe `active`/`isActive` e **deve** gatear fetch, timers, subscriptions e diálogos nessa prop.
- Formulário **cliente** = react-hook-form + zod (`zodResolver`, schema no topo, `z.infer`) — ver `CheckoutView.tsx`. Formulário **admin** = `useState` + `<LocalBufferedInput onFlush mask validate>`; `<input onChange={setState}>` num form admin re-renderiza a árvore inteira.
- Toda view admin que edita dados **deve** chamar `onSetDirty(true/false)` — é o que alimenta o AlertDialog "Alterações Não Salvas". Modais que capturam o Voltar do celular usam `onSetBackOverride(fn)`.
- Consumo de estado sempre por hook: `useAuth()`, `useStore()`, `useCartState()`/`useCartActions()`, `useFavorites()`, `useNotificationCenter()`. **Não use `useCart()`** (wrapper legacy, re-renderiza a cada mudança do carrinho) em componente de lista.

### Dados
- Um único cliente: `import { supabase } from "@/lib/supabase"`. Nunca `createClient` de novo.
- Leitura pública **sempre por view** (`vw_produtos_public`, `v_store_config`); admin lê tabela base/view admin ou RPC paginada. **Escrita nunca vai na view.**
- Schema é snake_case e mistura PT/EN (`produtos.nome/preco_venda/estoque`, mas `product_variants.stock_increment`, `banners.image_url`). Confira o nome real em `database.types.ts`.
- Toda mutação monta `dbUpdates` campo a campo (`if (updates.x !== undefined) dbUpdates.snake = updates.x`). Nunca spread do objeto de domínio no `.update()`.
- Toda linha do banco passa por mapper antes de virar estado. Nenhum componente recebe row cru.
- Store nova no vault = 3 passos: union `StoreName` (dataVault.ts:19) + **`MIGRATIONS[3]` nova** (nunca editar `MIGRATIONS[1]`, já rodou na máquina dos usuários) + incrementar `DATA_VAULT_VERSION`.
- Tabela nova com realtime exige migration `ALTER PUBLICATION supabase_realtime ADD TABLE ...` no padrão idempotente de `20260708020000`.
- Operação admin pesada vai por RPC (`get_admin_products_paged`, `get_admin_orders_paged`, `upsert_store_config`, ...), embrulhada em `callRpcWithRetry`. Delete de produto é **soft** (`deleted_at` + `ativo:false`); toda query admin precisa de `.is("deleted_at", null)`.

### Banco / migrations
- Nome: `<YYYYMMDDHHMMSS>_<descricao_snake_case>.sql` — na prática `<YYYYMMDD>000000/000001/...` como contador do dia. Cabeçalho de 3 comentários (`-- Migration:` / `-- Date:` / `-- Version:`), corpo entre `BEGIN;`/`COMMIT;`.
- Policy: `<tabela>_<escopo>_<acao>_policy`, **separada por ação** (não `FOR ALL`), precedida de uma bateria de `DROP POLICY IF EXISTS` com todos os nomes históricos.
- **Obrigatório**: toda chamada em USING/WITH CHECK em subselect — `(SELECT public.is_admin())`, `(SELECT auth.uid())`. Sem isso o linter acusa `auth_rls_initplan`.
- Admin é sempre `public.is_admin()` (lê `auth.users.raw_app_meta_data`, sincronizado pelo trigger `tr_sync_profile_role_to_auth`). Nunca `EXISTS (SELECT ... FROM profiles ...)` dentro de policy — causa recursão.
- **Obrigatório**: toda função `SECURITY DEFINER` declara `SET search_path` explícito. RPC de admin faz o gate *dentro* (`IF NOT public.is_admin() THEN RAISE EXCEPTION`), não pelo GRANT. Funções de trigger levam `REVOKE EXECUTE ... FROM PUBLIC, ANON, AUTHENTICATED`.
- Referência para copiar: `20260708230000_optimize_is_admin_rls.sql` (policies) e `20260420000000_standardize_orders.sql` (RPC).

### PWA
- Cache novo precisa entrar no allowlist do `activate` (sw.ts:57-58) ou é apagado no próximo deploy. Nunca remova `self.__WB_MANIFEST` (o build `injectManifest` falha). Nunca devolva Response sintético no catch de asset — vira ChunkLoadError; deixe o throw propagar.
- Nomes de mensagem são contrato e não podem ser renomeados: `SKIP_WAITING`, `HEARTBEAT_PING`/`HEARTBEAT_ACK`, `SET_NETWORK_QUALITY`, `WARM_CACHE`.
- Versão nunca é escrita à mão: vem de `__APP_VERSION__` (vite.config.ts). Bump é feito pelo manager.
- **`store_config.min_app_version` só aceita o valor exato de `__APP_VERSION__`** (ex.: `1.0.0-sha.abc1234`). Gravar semver puro (`1.0.1`) coloca **todo cliente** em `performNuclearPurge(true)` a cada boot — loop infinito de purga. Ver `useUpdateCheck.ts:222`.
- Mudança em `sw.ts` só é testável com `npm run build && npm run preview` — não há SW em `npm run dev`.

## Multi-tenant: o que NUNCA pode vazar do Core para um cliente

Não há multi-tenancy em código (sem `store_id`, sem resolução por domínio). O isolamento é infraestrutura + as listas de exclusão de `manager-claude/src/config.py`. Regras:

- **Nada de credencial, URL de Supabase ou domínio de produção em código-fonte.** Tudo por `import.meta.env.VITE_*` ou `branding.json`.
- **Texto visível nunca contém "IKCOUS" ou "Monte Carmelo" literal** — use `branding.appName`/`companyName` ou `config.*` do StoreContext. Prefixos internos (`ikcous_*` em localStorage, IndexedDB `ikcous-datavault`) podem ficar: são per-origin.
- Marca em arquivo vive **só** em `src/config/branding.json` + `public/branding/`. Campo novo → JSON + type `Branding` em `branding.ts` + o leitor por `fs` do `vite.config.ts`. Nunca importe o JSON direto num componente.
- **Toda env var nova entra em `.env.example` no mesmo commit** — é literalmente o arquivo que vira o `.env` do próximo cliente.
- Schema muda só por **arquivo novo** em `supabase/migrations/` (essa pasta é propagada). Nunca edite migration existente, nunca dependa de dados/IDs seedados só no banco do Core.
- **Antes de qualquer sync Core→cliente, rode o diff** a partir de `manager-claude/`:
  `python -c "import sys; sys.path.insert(0,'.'); from src.core.sync_engine import compare_directories; from src.config import CORE_DIR; print(compare_directories(CORE_DIR, r'<caminho_do_cliente>'))"`
- **Furos conhecidos do isolamento** (trate manualmente, não confie no sync): `public/branding/logo.svg` e `public/favicon.svg` **não** estão protegidos e diferem entre Core e cliente — um sync sobrescreve a logo do cliente (Header.tsx:64 usa `logo.svg` como primeira opção). Também desprotegidos: `public/icons/*`, `apple-touch-icon.png`, `og-image.png`, `sitemap.xml` (aponta para o domínio do IKCOUS), `google8e0e5366e254e024.html`, e `middleware.ts` (tem `IKCOUS` e `ickous-marketplace.vercel.app` hardcoded). `vercel.json` é *excluído* do clone e do sync: correção de CSP no Core **nunca** chega ao cliente — replique à mão.

## Armadilhas concretas

- `admin-carousels` está **quebrado como rota**: navegável em memória, mas ausente de `VIEW_COMPONENTS`/`validViews`/`adminViews`/`adminViewIndices` — F5 em `/admin-carousels` cai em `home`. É o exemplo vivo da regra dos 5 lugares.
- O union `View` tem entradas mortas (`product` — a real é `product-detail` —, `referral`, `admin-sros`). TS aceita, a navegação não acontece.
- `VIEW_COMPONENTS` **não é mapa de renderização**: mapeia toda view admin para `AdminArea`, `orders`→`CartView`, `recently-viewed`→`HomeView`. Serve só ao `.preload()`.
- Existem **dois `AdminArea`**: o `React.lazy` de App.tsx:54 (gate de segurança) e o componente real. Importar `@/components/layouts/AdminArea` direto fura o gate.
- `handleNavigate` tem throttle: navegação programática logo após outra (ex.: dentro de `onSuccess`) pode ser **descartada com console.warn**. Desbloqueio em 400ms / safety em 800ms.
- App.tsx e AdminLayout definem **pais diferentes** para as mesmas sub-views (`admin-banners`/`admin-push` → dashboard no popstate, → settings no botão Voltar). Adicione nos dois.
- `AdminArea.tsx` e `renderCustomerContent` **duplicam a árvore inteira das tabs** (ramo View Transitions + ramo framer-motion). Alterar prop em só um ramo cria bug que só aparece em um navegador.
- **Mapper triplicado** — erro nº1 ao adicionar entidade: a tradução DB→domínio existe em `TABLE_CONFIGS[].mapRecord`, em `hydrateAllStores` e no mapper do hook. O de banner do hook produz 20 campos, o do sync engine 6 — um UPDATE realtime grava banner mutilado no IndexedDB e a tela perde texto/cores sozinha.
- **Payload realtime de `produtos` não traz variantes**: `vault.put()` substitui o registro inteiro, então editar um produto com variantes apaga variantes e estoque agregado do cache até o `catchUp`.
- `useDataVault()` (o hook) é **código morto** — nunca é chamado; só `useSyncListener` é importado dele. Quem sobe o vault e a engine é o `StoreContext`.
- `src/types/supabase.ts` é byte-a-byte idêntico a `database.types.ts` e **ninguém importa**. Regenerar o arquivo errado não dá erro nenhum.
- `mapProductFromDB` **nunca lança**: coluna renomeada vira card "Erro ao carregar". Procure `[Mapper] Critical error mapping product` no console. Há hacks hardcoded dentro dele ('Aliança Luxo', 'boobie goods') — não replique.
- **Loop infinito latente**: `min_app_version` é comparado por igualdade estrita contra `__APP_VERSION__` (`1.0.0-sha.abc1234`). Gravar semver puro em `store_config.min_app_version` põe todo cliente em `performNuclearPurge(true)` a cada boot, sem guard de reload.
- **Nome enganoso**: o `performNuclearPurge` exportado por `useUpdateCheck` é `handleUpdate` — só faz `updateServiceWorker(true)` + reload. O purge real (unregister + delete de caches + `deleteDatabase`) roda só no caminho compulsório e no auto-recovery de ChunkLoadError.
- `activate` faz `clients.claim()` **e** purga o cache versionado antigo: abas do build anterior perdem chunks lazy → ChunkLoadError. Mexer num lado sem entender o outro gera reload em cascata.
- O sentinel (`pwa-sentinel.ts`) desregistra todos os SWs após 5 min sem `HEARTBEAT_ACK`. Uma exceção antes do bloco de heartbeat no listener do SW derruba o PWA de todos os clientes.
- **A CSP de `vercel.json` bloqueia origem nova** (`connect-src`/`img-src`/`font-src` listam supabase, fonts.g*, unsplash, placehold.co). CDN, fonte ou endpoint novo funciona em `npm run dev` e falha **silenciosamente** em produção.
- Migrations: dois arquivos sem prefixo de timestamp (`add_user_id_to_orders.sql`, `favorites_migration.sql`) ordenam errado; há **prefixo duplicado** em `20260708020000_*` (dois arquivos). `vw_produtos_public` **não pode** ter `security_invoker` (foi removido de propósito); `v_store_config` mantém. Qualquer `REVOKE` em `is_admin()` de anon reintroduz a quebra das queries anônimas.
- `marketplace_orders` tem colunas duplicadas legadas (`total` vs `total_amount`, `shipping` vs `shipping_cost`, ...). O RPC grava em `total_amount`/`shipping_cost` mas a view `sales_overview` soma `total` — escrever só num par zera a analytics.
- `src/components/profile/`, `src/components/seo/` e `src/data/` estão **vazios**: não são pontos de extensão. SEO é `<Helmet>` dentro da própria view.
- Restauração de scroll depende de containers específicos (`<main ref={mainRef}>` no cliente, `.active-scroll-container` no admin). View nova com `overflow-y-auto` próprio faz o scroll salvar sempre 0.
- `components.json` aponta `tailwind.config` para `postcss.config.js` (errado): ao adicionar primitivo shadcn, confira os tokens à mão em `tailwind.config.js`.
