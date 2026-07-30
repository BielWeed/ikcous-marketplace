# Glossário — IKCOUS Marketplace

Este projeto tem muitos nomes inventados, e vários deles mentem sobre o que fazem. Este
documento existe porque a leitura do código sozinha te levaria a conclusões erradas.

Levantado em 30/07/2026 por 8 agentes lendo o código, com um passe adversarial que refutou 22
afirmações. Onde algo não pôde ser confirmado, está escrito.

---

## Antes de tudo: os quatro nomes que enganam

Estes quatro causam mais confusão que todo o resto somado. Leia antes de abrir qualquer arquivo.

### 1. `DataVault` não é cofre nem criptografia

É um wrapper de ~500 linhas escrito à mão em cima do IndexedDB — [`src/lib/dataVault.ts`](../../src/lib/dataVault.ts).
Banco `ikcous-datavault`, 7 object stores, migrations versionadas. Nada é cifrado. O nome sugere
segurança; a função é cache offline.

### 2. `Silent Guardian` e `PWA Sentinel` são coisas diferentes

Nomes quase idênticos, arquivos e propósitos sem nenhuma relação:

| | O que é |
| --- | --- |
| **Silent Guardian** | O loader de boot em HTML/JS puro, pré-React — [`public/silent-guardian.js`](../../public/silent-guardian.js), `index.html:55-97` |
| **PWA Sentinel** | Watchdog de ping/ACK entre a página e o Service Worker — [`src/pwa-sentinel.ts:1-11`](../../src/pwa-sentinel.ts), `src/sw/sw.ts:206-216` |

### 3. `Nuclear Purge` significa duas coisas no mesmo arquivo

Isto é bug de nomenclatura, não sutileza:

- **Internamente** (`src/hooks/useUpdateCheck.ts:136`): limpeza total — desregistra o SW, apaga
  todos os Caches, deleta o IndexedDB, limpa parte do localStorage e faz hard reload com
  `?forceUpdate`.
- **Como valor exportado do hook** (`:426`): só troca de SW e reload.

Quem chama `nuclearPurge` de fora **não** está fazendo a limpeza total. Confira qual dos dois
você tem em mão antes de raciocinar sobre o efeito.

### 4. A barra de 85% não mede carregamento

`public/silent-guardian.js:72-73` tem um teto codificado: `if (progress > 85) progress = 85`. A
barra sobe por passos aleatórios até 85 e para. Os 100% só existem quando o React chama
`removeSilentGuardianLoader` (`src/main.tsx:81-82`).

**Travado em 85% significa exatamente uma coisa: a árvore React nunca montou.** Não é lentidão
de rede, não é build pesado. É crash antes do primeiro render.

---

## Parte 1 — Termos do negócio

| Termo | O que significa no negócio | Onde vive no código | Onde vive no banco |
| --- | --- | --- | --- |
| **Vitrine** | Carrossel da Home (novidades, ofertas, mais vendidos, ou curadoria manual) | `homeSections` em `StoreContext.tsx:38-42`; consumo em `HomeView.tsx:277-341`; admin em `AdminCarouselsView.tsx` | `store_config.home_sections` |
| **Variação** | Cor, tamanho etc. de um produto, cada uma com preço e estoque próprios | `ProductView.tsx:516-546` | `product_variants` |
| **Frete grátis** | Regra "acima de X reais o frete zera" — **exige usuário logado** | `CartContext.tsx:729`; `StoreContext.tsx:596-604` | `store_config.free_shipping_min` (hoje `100.00`) |
| **Entrega local** | Taxa fixa para CEP dentro da faixa da loja | `calculate-shipping/index.ts` | `store_config.local_delivery_fee`, `local_cep_range` (hoje `NULL`) |
| **Contingência** | Frete inventado quando a transportadora falha. Três variantes com ids distintos | `calculate-shipping/index.ts:697, 712, 758` | `shipping_calculation_logs.status` |
| **Cupom** | Desconto aplicado no checkout, validado no servidor | `useOrders.ts` | `coupons` |
| **OTP de rastreio** | Código de 6 dígitos para convidado ver o próprio pedido sem conta | `OrderSearch.tsx` | `otp_verifications`, RPC `generate_order_otp_v1` |
| **Convidado** | Cliente que fecha pedido sem conta. "Estar logado" para ele é a chave `guest_tracked_orders` no sessionStorage | `OrderSearch.tsx:110` | — |
| **Q&A** | Perguntas e respostas na página do produto | `AdminQAView.tsx` | tabelas de perguntas/respostas |
| **Avaliação** | Nota e comentário do cliente, com resposta opcional da loja (`merchant_reply`) | `AdminReviewsView.tsx` | tabela de avaliações |
| **Capital Alocado** | KPI inventado: soma de `custo × estoque` | `AdminProductsView.tsx:272-315` | via RPC de analytics |
| **Lucro Potencial** | KPI inventado: valor de venda do estoque menos o custo dele | idem | idem |
| **ROI do Portfólio** | KPI inventado: Lucro Potencial ÷ Capital Alocado | idem; explicado ao lojista em `AdminDashboardView.tsx:364-412` | idem |

---

## Parte 2 — Jargão interno do código

### Camada de dados

| Termo | O que é |
| --- | --- |
| **`catchUp`** | Reconciliação delta contra o Supabase depois de reconexão, volta de foco ou volta de rede — `realtimeSyncEngine.ts:571`. **Não** é o fetch inicial e **não** é `catch` de erro. Tem estratégia por tabela e apaga do vault o que não existe mais no servidor. |
| **`vault`** | Instância do DataVault passada por parâmetro em vez de importada. Todo método do `RealtimeSyncEngine` recebe `vault: DataVault` — `realtimeSyncEngine.ts:170`. |
| **`store`** | **Dois sentidos no mesmo código.** Em `store_config` = a loja. Nos demais = object store do IndexedDB (`dataVault.ts:19-26`). Convivem na mesma assinatura de função. |
| **`singleton`** | String literal usada como chave da linha única de configuração no IndexedDB — `StoreContext.tsx:83`. No Postgres a mesma linha é `id = 1`. |
| **líder / `isLeader`** | A única aba autorizada a abrir o socket do Supabase. As outras recebem deltas por `BroadcastChannel` — `useLeaderElection.ts`. Aba escondida perde a liderança, então **trocar de aba muda qual aba fala com o banco**. |
| **`vw_produtos_public` / `vw_produtos_admin`** | As duas views de produto. A pública não expõe `custo`; a admin expõe `custo` e `deleted_at` — e é usada até para `INSERT`/`UPDATE` (`useProducts.ts:483, 669`). |
| **`public_profiles`** | Apesar do nome, é **tabela física**, não view. Espelhada de `profiles` por trigger, só com campos publicáveis, legível por `anon`. `public.profiles` nunca é lida pelo cliente sem RPC. |

### PWA e Service Worker

| Termo | O que é |
| --- | --- |
| **Ghost Purge** | Limpeza one-shot por `RESET_KEY` dentro do silent-guardian — `public/silent-guardian.js:7-41`. Alavanca manual: muda-se a string e toda a base instalada limpa uma vez. |
| **Nuclear Fallback** | Nada de nuclear. É o `setTimeout` de 20s que só faz o loader desaparecer se o React não o removeu — `silent-guardian.js:43-55`. |
| **`networkQuality`** | Variável em memória do SW (`fast`/`medium`/`slow`/`offline`) alimentada por `postMessage`. Em `slow`/`offline` o SW para de revalidar e serve só cache — `sw.ts:71, 157-166`. |
| **warm cache** | Pré-aquecer no idle as imagens dos banners e dos 15 primeiros produtos — `useCacheWarmer.ts:39`, `sw.ts:235-282`. |
| **`pwa_forensics`** | Caixa-preta do PWA. **Existe em duas implementações concorrentes**: array de 20 itens no localStorage (`useCacheWarmer.ts:67`) e IndexedDB de 500 itens (`src/lib/forensicsDB.ts`). |
| **`pwa_reload_reason`** | Bilhete no localStorage antes de um reload forçado, consumido no boot seguinte para virar toast "Sistema Atualizado". **Escrito por 4 lugares diferentes.** |
| **deploy-ping** | Broadcast no canal `pwa-system-signals` avisando os clientes que saiu deploy — `useRealtimeUpdate.ts:50-54`. |
| **Build sync point** | Comentário marcando a linha com o literal numérico que o `pwaVersionPlugin` substitui no build — `silent-guardian.js:58`, `vite.config.ts:86`. **Sem esse literal exato, o replace falha em silêncio.** |

### Carrinho e frete

| Termo | O que é |
| --- | --- |
| **tombstone** | Marca "este item foi apagado de propósito", com timestamp, para o merge com o banco não ressuscitar o item. TTL de 7 dias — `CartContext.tsx:67-100`. |
| **`assinaturaDoCarrinho`** | Fingerprint `productId:variantId:quantity` ordenado. Quando muda, a cotação de frete e o CEP são zerados — `CartContext.tsx:712-719`. |
| **checksum / zero-trust** | `p_total_amount` não é usado para cobrar: o banco recalcula tudo e usa o valor enviado só como conferência, com tolerância de R$ 0,05. Divergência acima disso derruba o pedido. |
| **cotação expirada** | Erro quando não há linha em `shipping_quotes_cache` para (CEP, id da opção) nas últimas 24h. **Não** é o mesmo cache de 2h da edge function. |
| **`cart_hash`** | Chave estável e independente de ordem do cache de cotação. Carrinho inválido vira a string `'empty'` — `calculate-shipping/index.ts:123-137`. ⚠️ A RPC de pedido **não** consulta o `cart_hash`. |
| **smart fallback** | Frete estimado pelo **primeiro dígito** do CEP — `calculate-shipping/index.ts:11-45`. Tem um bug de comentário: o grupo `['2','3']` está rotulado "Sudeste (RJ, ES, MG)", mas MG começa com 3, então CEP de MG para MG cai no ramo de mesma região. |
| **`fireAndForget`** | Helper local para disparar query do PostgREST sem esperar, contornando o fato de o `PostgrestBuilder` não ter `.catch()`. Invenção deste arquivo, não padrão do supabase-js. |
| **`guest_tracked_orders`** | Chave de sessionStorage com os pedidos que o convidado destravou via OTP. É a única "sessão" que convidado tem. |

#### IDs de opção de frete — leia com atenção

Os ids de frete **parcialmente** funcionam como instrução para o servidor. A distinção importa:

| ID | O servidor lê como instrução? |
| --- | --- |
| `flat-fee-*` | **Sim** — `LIKE 'flat-fee-%'` na RPC (`20260729000002...sql:238`) → usa `store_config.shipping_fee` |
| `local-delivery` | **Sim** — comparação exata (`:241`) → confere a faixa de CEP e usa `local_delivery_fee` |
| `melhor-envio-<id>`, `frenet-<code>` | Não são instrução: são **chave de busca** no cache de cotação |
| `free-shipping-promo` | **Não.** Rótulo só de UI. A RPC não tem ramo para ele — quando a edge function o emite, é porque todo item tem `frete_gratis`, e a RPC já zerou o frete antes de olhar qualquer id |

> Um agente afirmou que `free-shipping-promo` era instrução para o servidor. O cético refutou
> abrindo a RPC: só existem ramos para `flat-fee-%` e `local-delivery`.

### Autenticação

| Termo | O que é |
| --- | --- |
| **`REMOVE`** | Sentinel de string, não palavra-chave. Em `avatar_url` ou `cover_url` significa "apague este campo", porque `NULL` na RPC significa "não mexer" (`COALESCE`). **4 call sites** no cliente: `ProfileView.tsx:188`, `ProfileView.tsx:268` (capa), `AccountSettingsView.tsx:135`, `AccountSettingsView.tsx:215`. Renomear e esquecer um deles grava a palavra literal na coluna, em silêncio. |
| **Fast Path 1 / 2** | Os dois atalhos de resolução de admin antes de ir à rede: 1 = claim do `app_metadata` no JWT (`AuthContext.tsx:130`), 2 = cache negativo no localStorage (`:138`). |
| **`checkingLock` / `initPromise`** | Variáveis no escopo do módulo, fora do React. `checkingLock` serializa checagens de admin; `initPromise` garante um único `getSession()`. Sobrevivem à remontagem do provider e `initPromise` nunca volta a `null`. |
| **`isCriticalTransition`** | "Esta troca de auth merece bloquear a UI". Só `SIGNED_IN`/`SIGNED_OUT`, não primeiro mount, e id do usuário mudou — `AuthContext.tsx:386-393`. Existe para `TOKEN_REFRESHED` não piscar loading. |
| **`isPasswordRecovery`** | Flag que sequestra o roteamento: força a view `auth` em modo `new-password` ignorando que o usuário já tem sessão — `AuthContext.tsx:98-119`. |
| **`viewMode`** | Máquina de 5 estados dentro do `AuthView` (`login`, `signup`, `forgot`, `reset-prompt`, `new-password`). `reset-prompt` é a tela de "e-mail enviado", não um formulário. |

### Admin

| Termo | O que é |
| --- | --- |
| **`admin-mode`** | Classe no `<html>` enquanto o painel está montado. Switch global de CSS — `AdminLayout.tsx:59-64`. |
| **`admin-gold`** | Cor de acento do painel (HSL 47 95% 50%). Token próprio, distinto do `--primary` da loja, que o lojista pode trocar. |
| **`pb-admin` / `--admin-tab-pb`** | Padding-bottom que lê variável CSS calculada em runtime a partir do `visualViewport`, do modo standalone e da safe-area — `AdminLayout.tsx:524-530`. |
| **`onFlush`** | Callback do `LocalBufferedInput` que recebe o valor **cru** (sem máscara) após debounce ou blur. Substitui `onChange` nos formulários admin. |
| **secondary view** | As 11 telas admin que não são abas principais. Montadas uma a uma e **não preservam estado ao sair** — `AdminArea.tsx:514-678`. |
| **`bypassDirtyCheck`** | Terceiro parâmetro de `onNavigate`. Quando `true`, pula o diálogo de "Alterações Não Salvas". |
| **`DeferredTabContent`** | As abas principais **montam sob demanda** na primeira ativação e a partir daí permanecem montadas, escondidas por CSS — `AdminArea.tsx:90-107`. Não é "todas montadas simultaneamente". |

### Validação e diagnóstico

| Termo | O que é |
| --- | --- |
| **TruthGate / VOR / "axioma" / G17** | Validador de produto chamado antes de escrever no banco — `src/utils/truth_gate.ts`, usado em `useProducts.ts:480, 622`. "VOR" = *Verified Observation Runtime*; "axioma" = uma regra `if`. Regras reais: preço ≥ 0, estoque ≤ 10000, nome não vazio, custo ≥ 0. **Só roda no caminho admin de escrita** — não valida nada na leitura do catálogo. O que "G17" significa não está documentado em lugar nenhum. |
| **`EnvGuard`** | Prefixo da mensagem de erro do portão de ambiente. Não existe classe nem função com esse nome — é só o rótulo do `throw` em `src/lib/env.ts:85`. Ver `[EnvGuard]` no console significa build sem chaves do Supabase. |
| **`vendor-*`** | Nomes de chunk escolhidos à mão no `manualChunks` — `vite.config.ts:398-466`. Funcionam como **contrato** com o `globIgnores` do PWA e com o `.size-limit.json`. Não são nomes gerados pelo Rollup. |
| **`test_credentials`** | Segunda rota da edge function `calculate-shipping`, selecionada por um campo `action` no body em vez de por path. Só admin — `calculate-shipping/index.ts:192-306`. |

---

## Parte 3 — Codinomes decorativos: ignore todos

O código está cheio de nomes de versão épicos que **não correspondem a nada**. Nenhum deles é
tag, release ou marco. `package.json` está em `1.0.0` e `__APP_VERSION__` é
`1.0.0-sha.<7>` ou `1.0.0-build.<5>`.

`PHOENIX v29` · `OMNIPOTENCE v23` · `ZENITH v21` · `OMNIVERSE v13.1` · `THE VOID v26.0` ·
`APOTHEOSIS v24.0` · `ANTI-ZOMBIE PROTOCOL` · `GHOST PURGE V11.5` · `NINJA NEXUS`

**Não use esses números para inferir cronologia.** Um arquivo marcado "v29" não é mais novo que
um marcado "v13". Onde aparecem: `sw.ts:2`, `pwa-sentinel.ts:3`, `useRealtimeUpdate.ts:8`,
`loading.css:1-2`, `useCacheWarmer.ts:9`, `shared-brain.ts:3`, `state-worker.ts:3`.

### `Solo-ninja` / `_ninja_migrations`

Este merece uma nota, porque é o único codinome com significado real.

**Não é assinatura de autor.** É o codinome de rodadas de *endurecimento de segurança*,
majoritariamente no banco. Nas migrations aparece sistematicamente como nome de protocolo:
"Solo-Ninja Security Protocol: IDOR/BOLA Fixes", "TOCTOU Fix for Coupons", "Final Consolidation
& RPC v12". São 11 arquivos de migration com `ninja` no nome, mais a tabela
`public._ninja_migrations` e a policy `SoloNinja Admin Full Access`.

> Um agente classificou como "assinatura do autor, sem significado técnico". O cético refutou:
> o token rotula consistentemente trabalho de segurança, o que contradiz "sem significado".

### `THE VOID` / `APOTHEOSIS` / "Camada 1" / "Camada 2"

Caso especial: são rótulos de uma arquitetura **que não foi implementada**. Aparecem nos
cabeçalhos de `src/shared-brain.ts` e `src/state-worker.ts` e não correspondem a nada que
exista no código rodando. No log do `shared-brain`, "cell" significa aba do navegador — termo
morto junto com o arquivo.

---

## Parte 4 — Comentários que não devem ser levados a sério

| Comentário | Onde | Realidade |
| --- | --- | --- |
| `"Nuclear deterrent against inflation"` | `CartContext.tsx:17` | Comentário-piada no teto de 500 unidades por linha (`MAX_ITEM_QUANTITY`). **Por que 500 não está documentado.** O 500 aparece dentro do mesmo `Math.min` que o clamp de estoque (`:557-561`, `:657-661`) — é um segundo teto de quantidade em série, não detector de loop. O schema Zod replica o teto (`:21`) e **descarta o item silenciosamente** na hidratação em vez de limitar (`:119-126`). |
| `"Precise filtering logic"` | `HomeView.tsx:116` | É um `filter` comum. |
| `"Same name usually"` | `mappers.ts:70` | Acompanha `row.is_bestseller ?? row.is_bestseller` — o mesmo campo nos dois lados. Funciona por acidente. |
| `"Non-admin authenticated users still see 0 rows"` | `20260323000001_fix_produtos_custo_leak.sql:17-18` | **Obsoleto e perigoso.** A política foi reescrita depois (`20260708230000_optimize_is_admin_rls.sql:106-110`) e hoje usuário logado não-admin consegue ler `custo` da tabela base. |

> Um agente leu o comentário-piada do `MAX_ITEM_QUANTITY`, declarou "motivo não documentado" e
> em seguida racionalizou que era circuit breaker contra loop de incremento. O cético refutou:
> nada no arquivo sustenta isso. A resposta correta era parar em "motivo não documentado".

---

## Não verificado

- **Se o Realtime do Supabase filtra colunas.** Importa porque `produtos` está na publicação
  realtime e a tabela tem `custo`. O Realtime aplica RLS por linha; se respeita privilégio de
  coluna depende da versão do serviço. Não testado.
- **Se `anon` recebe eventos realtime de `produtos`.** Os grants sugerem que não
  (`20260323000001:86` revoga de `anon` e só `authenticated` é reconcedido), o que faria o
  visitante não-logado depender só do `catchUp`. Inferência a partir de grants, não confirmada
  em runtime.
- **O que "G17" significa.** Não há comentário, migration, teste ou commit explicando.
- **Por que o teto é 200 produtos, por que o hard-code da "Aliança Luxo", por que o rename
  "Bobbie Goods"** (ver [`02-ARQUITETURA.md`](02-ARQUITETURA.md)). Nenhum dos três tem
  justificativa escrita em lugar nenhum. Não inferimos.
