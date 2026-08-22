# Reauditoria da auditoria de julho — estado medido em 22/08/2026

**Este documento carrega o ESTADO, medido no código de hoje. Ele não carrega a ordem do
trabalho nem a receita do conserto.**

Medido contra `HEAD = 10830e6`, branch `fix/caca-defeitos-lote-1`, com a árvore limpa exceto o
trabalho em curso da frente `noturno-mensagens-cruas`.

## Por que esta reauditoria existe

Três documentos do projeto afirmam **"66 achados ainda abertos"**. Esse número é de
**29-30/07/2026** e **não era verificável**: nem `AUDITORIA_2026-07-29.md`, nem
`docs/backlog/BACKLOG.md` (111 tarefas, 11 campos), nem `docs/backlog/backlog.csv` (13 colunas)
têm campo de estado. São retratos congelados, e **mais de 200 commits** caíram no projeto desde
então (`git rev-list --count --no-merges 98f675f..10830e6` dá 202; contagens com merge ou por
data variam, e nenhuma bate exatamente em 277 — o número exato não importa para o argumento, só
a ordem de grandeza).

Prova de que apodreceu: `PEDIDO-010` continua listado como **P0** no backlog — *"trocar `!=` por
`IS DISTINCT FROM` na checagem de dono de `update_order_status_atomic`"* — e está corrigido desde
`supabase/migrations/20260804010000_fix_order_owner_check_null_safety.sql:99`, de **04/08**.

### De onde vem o número 85, e por que ele não bate com 76

A aritmética estava escondida em dois blocos do mesmo arquivo:

- **76** achados numerados (`### 1.` a `### 76.`)
- **9** achados de runtime (`### R1.` a `### R9.`), que o auditor verificou pessoalmente fora do
  fluxo dos agentes

**76 + 9 = 85.** A frase da fonte — `docs/onboarding/PROMPTS-ONBOARDING-DEV.md` — é *"85 achados,
18 já corrigidos, 66 abertos e 1 que não se aplicava"*, e `18 + 66 + 1 = 85`. Fecha.

Vale saber ao citar: essa fonte é uma **mensagem de correção endereçada a um dev novo**, não um
documento de estado do projeto.

## Placar

| Faixa | Fechado | Aberto | Não se aplica | Indeterminado | Estado |
|---|---|---|---|---|---|
| 1 a 25 | 14 | **10** | 1 | 0 | medida |
| 26 a 50 | 15 | **10** | 0 | 0 | medida |
| 51 a 76 | 11 | **15** | 0 | 0 | medida |
| **os 76 numerados** | **40** | **35** | **1** | **0** | **completa** |
| R1 a R9 (runtime) | 5 | **3** | 0 | 1 | completa |
| **TOTAL — os 85** | **45** | **38** | **1** | **1** | **completa** |

**Eram 66 abertos em 30/07. São 38 hoje** — mais 1 não se aplica (`#22`, revertido para
NÃO SE APLICA nesta correção — ver a faixa 1-25) e 1 indeterminado (`R4`, que exige medir com o
app no ar). Os 85 são os 76 numerados **mais** os 9 de runtime; `45 + 38 + 1 + 1 = 85` fecha.

O placar de julho era `18 corrigidos + 66 abertos + 1 não se aplicava`. **27 achados foram
fechados entre 30/07 e 22/08**, e 4 dos 5 fechamentos de runtime saíram de um único commit
(`9542f04`), no dia seguinte à auditoria. O único "não se aplica" de julho (`#22`) segue não se
aplicando — esta correção reverteu uma versão anterior deste documento que o tinha reaberto por
engano (ver "Quanto confiar neste placar", abaixo).

**Nada aqui é conclusão sobre o total até as quatro faixas fecharem.** Faixa sem cobertura é
PENDENTE, nunca "fechada".

## Quanto confiar neste placar

Uma revisão de contexto limpo amostrou **8 dos 85 achados** desta versão do documento. **2
estavam errados e 1 tinha evidência falsa** — 3 de 8, quase 40%:

- **#22** afirmava que o "Salvar" do admin grava banner truncado por cima do que já existia.
  Isso é impossível: `banners` tem 8 colunas no banco, nenhuma delas `subtitle`, `title_color`
  ou `start_date`, e `06-ESTADO-ATUAL.md:148` já tinha refutado exatamente essa premissa antes
  desta reauditoria existir. A versão anterior deste documento reabriu o achado sem citar a
  refutação — corrigido abaixo, de volta a NÃO SE APLICA.
- **R8** citava um vazamento de nome completo do cliente no console que já tinha sido fechado
  3 minutos antes desta linha ser escrita (`a4863e4`, ancestral do commit que a escreveu), e
  contava 5 guardas `DEV` onde há 6.
- **#37** tinha evidência falsa: dizia "zero ocorrências de `idempotency` no projeto" quando o
  termo aparece em várias partes do código, inclusive uma chave de idempotência que já
  funciona no pagamento (`mercadopago.ts:401,666`). O achado em si segue correto e ABERTO — só
  a frase da evidência mentia sobre o que foi medido.

**Essa proporção não autoriza tratar os outros 77 achados como corretos só por não terem sido
sorteados.** O que se pode afirmar com confiança é que os 8 amostrados — e só eles — foram
reconferidos agora. **Antes de tratar `45 fechados / 38 abertos / 1 não se aplica / 1
indeterminado` como número final, uma segunda amostragem — sorteada por um gerador aleatório,
não escolhida a dedo pelo mesmo revisor — está recomendada.** Um documento cuja tese central é
que número não verificado apodrece não pode se isentar da própria regra.

## Faixa 1 a 25 — medida

### Os 14 fechados

| # | Título curto | Onde o conserto está |
|---|---|---|
| 1 | Frete grátis diverge front×banco | `src/contexts/CartContext.tsx:752-755` + `20260951000000_*.sql:401-404` (`9542f04`) |
| 2 | OTP de rastreio acessa pedido de terceiro | `20260805010000_bind_guest_otp_to_single_order.sql:90-118` (`99dab33`) |
| 3 | Salvar config isolada reseta `store_config` | `20260940000000_home_sections_em_store_config.sql:112+` (`9542f04`, `3999aca`) |
| 4 | `minAppVersion !==` causa loop de purge | `src/hooks/useUpdateCheck.ts:24,269` (`9542f04`) — **ver ressalva abaixo** |
| 5 | Máscara divide preço por 100 na edição | `src/components/admin/LocalBufferedInput.tsx:55,100-101` (`9542f04`) |
| 6 | Edge de frete cai no fallback de R$ 15 | `supabase/functions/calculate-shipping/index.ts:153` (`b9319fd`) |
| 7 | `upsert_store_config` zera payload parcial | mesmo conserto do #3 |
| 8 | Duplicata do #4 | idem #4 |
| 10 | Zod apaga `variantNames` na reidratação | `src/contexts/CartContext.tsx:26` (`88db3ba`) |
| 12 | Checkout de convidado quebra no frete grátis | mesmo conserto do #1 |
| 13 | Reconexão realtime zera lista do admin | `src/hooks/useOrders.ts:183-200,876,931,948` (`9981820`) |
| 14 | Loop infinito em `OrderDetailsView` | `src/views/customer/OrderDetailsView.tsx:217-232` (`1bf6b47`) |
| 19 | `send-push` responde `success:true` sempre | `supabase/functions/send-push/index.ts:22-23,146-153` (`c7f0480`) |
| 25 | Desativar promoção não limpa "De:" no banco | `src/views/admin/AdminProductFormView.tsx:1118-1122,1131` (`1203734`) |

> **Ressalva registrada no #4, corrigida nesta rodada:** a causa raiz foi corrigida (`!==` virou
> `isOlderThan`). A rede de segurança **existe, com outro nome** — o grep zero era pelo nome
> antigo (`pwa_mandatory_reload_timestamp`), que nunca existiu com esse literal; a busca errou o
> alvo, não a conclusão. `src/hooks/useUpdateCheck.ts:38-39` declara
> `MANDATORY_PURGE_GUARD_KEY = "pwa_mandatory_purge_guard"` e `MAX_MANDATORY_PURGES = 2`; o
> abort ao bater o teto está em `:275-280` e o reset da trava, quando a versão volta a bater,
> em `:306-308`. Com semver correto e o purge capado em 2 tentativas, um `min_app_version`
> legitimamente maior que o build servido ainda dispara purge — mas só duas vezes, nunca em
> loop.

### Os 10 abertos, por custo de deixar quieto

| Ordem | # | O que acontece com quem usa | Onde | Classe |
|---|---|---|---|---|
| 1 | **17** | **Cobra o preço errado.** A tela mostra um valor, o servidor cobra o de outra variação, e o estoque das demais nunca baixa. Duas pessoas pagam preços diferentes pelo mesmo produto só pela **ordem do clique** | `src/views/customer/ProductView.tsx:550-553,602` | front, mas **toca preço cobrado** |
| 2 | **23** | **Apaga arquivo, sem volta.** Duplicar um banner e cancelar apaga do bucket a imagem do banner **que está no ar**. A Home fica com um buraco | `src/views/admin/AdminBannersView.tsx:651,1243-1246,1395` | front |
| 3 | **9** | Venda perdida: o preço mudou depois que o item entrou no carrinho, a RPC recusa com "Divergência de valores" e o cliente não descobre que precisa remover e re-adicionar | `src/contexts/CartContext.tsx:322-324` (ramo vazio) | front |
| 4 | **15** | Queda de rede durante a revalidação **apaga o catálogo inteiro da tela**, inclusive o que já estava no IndexedDB — o oposto do que um PWA offline deve fazer | `src/contexts/StoreContext.tsx:573,602` | front (~6 linhas) |
| 5 | **21** | Depois de um deploy, o cliente pode ficar preso num spinner **sem botão nenhum**, até fechar o app na unha | `src/components/ui/custom/GlobalErrorBoundary.tsx:45-55,104-109` | front |
| 6 | **20** | Visitante deslogado aceita notificações, o navegador cria a assinatura, o banco não recebe nada, e o banner **nunca mais aparece**. Aquele cliente fica invisível para a loja para sempre | `src/hooks/usePushNotifications.ts` | front |
| 7 | **16** | Navegar de produto para produto pela seção "você também pode gostar" deixa foto em branco, quantidade e variação do produto anterior — e o item vai ao carrinho com `variantNames` errado | `src/App.tsx:2066-2079` (falta `key`) | front, **1 linha** |
| 8 | **24** | O admin perde a imagem que acabou de subir, e o editor exibe um arquivo que já não existe | `src/views/admin/AdminBannersView.tsx:853-860` | front |
| 9 | **18** | Hoje inofensivo. A partir do **201º produto**, os mais antigos somem da loja, da busca e dos favoritos sem aviso | `src/contexts/StoreContext.tsx:559,570` | **decisão de arquitetura** |
| 10 | **11** | Cliente monta o carrinho no celular e abre no desktop: a variação escolhida some, e o pedido chega ao lojista sem dizer qual cor/tamanho separar | `sync_cart_atomic`, em `20260806000000_baseline_do_schema_vivo.sql` | **migration** |

> **Ressalva nos achados #17 e #18 — mesma classe do #44 (abaixo): não verificado contra o banco
> vivo.** `docs/onboarding/06-ESTADO-ATUAL.md:214` e `:215` registram os dois como "Rebaixado"
> em ~30/07, medido contra a produção daquele dia (`product_variants` com 2 linhas, ambas do
> mesmo grupo; 18 produtos ativos, longe do teto de 200). Essa medição tem quase um mês e **não
> foi revalidada aqui** — a reauditoria é somente leitura, sem credencial de banco. **Não
> rebaixamos os dois nesta reauditoria**: o código que causa o defeito segue no repositório tal
> como descrito, e usar um dado de produção de 3 semanas atrás para baixar a prioridade seria
> exatamente a aposta que este documento existe para não fazer.

### Não se aplica

| # | Achado original | Por que não se aplica |
|---|---|---|
| 22 | "Apaga dado, sem volta": o sync grava banner truncado e o "Salvar" do admin grava `subtitle=''`, `title_color=''`, `start_date=null` por cima do que já existia | **Premissa impossível.** `public.banners` tem 8 colunas no banco (`id, image_url, title, link, position, active, order, created_at` — `20260806000000_baseline_do_schema_vivo.sql`, `CREATE TABLE public.banners`); nenhuma migration posterior adiciona coluna. `subtitle`, `title_color` e `start_date` não existem — o PostgREST rejeita a escrita, não a aceita truncada. `mapRecord` em `src/lib/realtimeSyncEngine.ts:78-88` mapeia exatamente as 7 colunas reais além do `id`, sem truncar nada. **Já tinha sido refutado**: `docs/onboarding/06-ESTADO-ATUAL.md:148` marca #22 como ⚪ desde antes desta reauditoria; uma versão anterior deste documento reabriu o achado sem citar essa refutação, e esta correção reverte isso. **A descrição errada escondia um defeito real, de natureza oposta**: `src/hooks/useBanners.ts:309-321` (`addBanner`) e `:415-443` (`updateBanner`) escrevem `subtitle`, `title_color`, `subtitle_color` e outras colunas que não existem no banco — como o PostgREST rejeita, o modo "completo" do formulário de banners **não salva**, em vez de gravar por cima. Esse defeito novo não tem número próprio nesta reauditoria; achado #22, como descrito originalmente, segue não se aplicando. |

## Faixa 26 a 50 — medida

### Os 15 fechados

| # | Título curto | Onde o conserto está |
|---|---|---|
| 27 | `free_shipping_min = 0` quebra todo checkout | `20260951000000_*.sql:126` — `COALESCE(NULLIF(…, 0), 999999)` (`9542f04`) |
| 28 | Convidado acima do limite não fecha pedido | `20260951000000_*.sql:128` + `CartContext.tsx:751-756` (`18cb878`) |
| 29 | Ninguém chamava o cálculo de frete | `CartView.tsx:26,396-403` + `CheckoutView.tsx:886-888` (`9542f04`) |
| 30 | Faixa de CEPs locais nunca casa | `calculate-shipping/index.ts:271-306` — parser novo |
| 31 | Editar resposta cria duplicata | `20260812030000_upsert_answer_question_atomic.sql:198-203,240-245` (`3f57caa`) |
| 32 | OTP nunca envia e-mail | `20260820000100_otp_sem_fila_nem_gatilho.sql:32-34` + `send-otp-email/index.ts:125` (`2a6c444`) |
| 33 | RPC ignora `p_shipping_cost` e derruba checkout | `20260951000000_*.sql:148-200` — **`p_shipping_cost` segue ignorado, agora de propósito**: valor vindo do cliente não decide preço |
| 34 | `!=` NULL-inseguro em `update_order_status_atomic` | `20260901000000_*.sql:299,316` (`306f3b6`, origem `20260804010000`) |
| 35 | `get_orders_by_otp_v1` força bruta + PII | `20260950000000_*.sql:75-88,135` (`1141305`) |
| 38 | `checkingLock` aplica admin do usuário anterior | `AuthContext.tsx:91,226-232` (`81e5cf8`) |
| 39 | `check_user_confirmation_status` exposta a `anon` | `20260812010000_revoke_*.sql:21-22` + `AuthContext.tsx:825` (`81e5cf8`) |
| 40 | Logout falha em silêncio offline | `AuthContext.tsx:723-769` |
| 41 | Limpeza de logout usa chave inexistente | `AuthContext.tsx:106-130` |
| 42 | Push enviado antes de confirmar no banco | `AdminOrdersView.tsx:546-547,572-574,588` (`5bea11b`) |
| 46 | Busca não normaliza acentuação | `src/lib/utils.ts:58-61` + 6 pontos de uso (`21a14d4`) |

### Os 10 abertos, por custo de deixar quieto

| Ordem | # | O que acontece com quem usa | Onde | Classe |
|---|---|---|---|---|
| 1 | **37** | **Pedido duplicado.** A RPC comita, o HTTP estoura, o cliente reenvia: **estoque debitado duas vezes e cupom de uso único consumido duas vezes**. A trava do duplo toque já foi feita (`CheckoutView.tsx:846`); falta chave de idempotência | `create_marketplace_order_v23`/`v24` (`20260951000000_*.sql:42,321`) têm 12 parâmetros cada, nenhum de idempotência. O padrão já existe no projeto — `supabase/functions/_shared/mercadopago.ts:401,666` usa `X-Idempotency-Key` de verdade nas chamadas ao Mercado Pago — só não chegou na RPC que cria o pedido | **migration** (coluna, índice único, parâmetro novo nas RPCs) |
| 2 | **36** | Checkout com **carrinho vazio**: ou o cliente leva "os valores mudaram" sem entender, ou nasce um **pedido fantasma de R$ 0,00** no painel | `CheckoutView.tsx:779,830,2080`; no banco, zero `jsonb_array_length(p_items)` | **misto** — o front sai hoje, mas quem fecha é a guarda no banco (a RPC tem `GRANT` para `anon`) |
| 3 | **26** | **Cupom expira ~21h antes do dia configurado**, e o card mostra um dia a menos que o formulário. Promoção que morre cedo é dinheiro | `AdminCouponFormView.tsx:456,467-472`; `AdminCouponsView.tsx:643-646` | front; o **backfill** dos cupons já gravados é migration |
| 4 | **48** | `catchUp` deleta e refaz **sem fatiar nem checar erro** — e `serverProductsSummary` vazio é *truthy*, então limpa o cache inteiro. O log ainda diz "CatchUp complete" | `realtimeSyncEngine.ts:761,770-786,815-819,863` | front |
| 5 | **49** | **Produto excluído reaparece na Home**, com preço e estoque, e o cliente clica | `realtimeSyncEngine.ts:442-447` | front |
| 6 | **50** | Depois de um deploy, a aba antiga congela: o DataVault devolve `[]` em silêncio e nada mais é gravado offline | `dataVault.ts:129-136,231-234,287-294` | front |
| 7 | **47** | O sync realtime pode **nunca subir naquela aba**: preço alterado não aparece, produto esgotado continua comprável | `StoreContext.tsx:300,749,763` | front |
| 8 | **44** | Ambiente novo, staging ou reset **nasce com o realtime de pedidos morto**, sem erro. Nenhuma migration ativa põe `marketplace_orders` na publicação | as 4 antigas estão em `_arquivadas/`; baseline é schema-only | **migration** — ver ressalva |
| 9 | **43** | Fila offline envenenada: o cancelamento já aplicado **volta a falhar em toda reconexão**, e o cliente vê o mesmo erro para sempre | `useOrders.ts:38-45,65-74,1629-1652` (9 call sites) | front |
| 10 | **45** | O scroll da Home volta para 12 itens a cada venda de qualquer produto | `ProductList.tsx:36-38` + `StoreContext.tsx:796` | front |

> **Ressalva no #44 — é o único achado em que repositório e produção provavelmente discordam.**
> `docs/onboarding/06-ESTADO-ATUAL.md:216` afirma que a produção **hoje** tem a tabela na
> publicação, habilitada à mão fora das migrations. Isso **não foi verificado contra o banco
> vivo** (a reauditoria é somente leitura, sem credencial). O defeito real não é a loja de hoje:
> é que o repositório não sabe reproduzir a configuração que ela tem.

## Faixa 51 a 76 — medida

### Os 11 fechados

| # | Título curto | Onde o conserto está |
|---|---|---|
| 56 | Vitrine diz "salvo" e falha | `StoreContext.tsx:63` (vira `Promise<boolean>`) + `AdminCarouselsView.tsx:126-133` (`53f14e8`) |
| 57 | Duplo clique duplica produto | `AdminProductFormView.tsx:1028,1229,1821` (`3f57caa`) |
| 58 | Imagens movidas antes do UPDATE | `useProducts.ts:918-942` — soft-delete primeiro, mídia depois |
| 59 | Rascunho apagado em ~1s | `AdminProductFormView.tsx:806-820,663` — descarte virou botão |
| 60 | Validade de cupom não grava | `useCoupons.ts:175-186` (`1203734`) |
| 61 | `get_category_analytics` sem guarda | `20260806000000_baseline_do_schema_vivo.sql:2057-2065` (`b1ee9d5`) |
| 62 | Erro de categoria engolido | `useAnalytics.ts:208,493-499` + `StrategicIntelligenceBlocks.tsx:332` |
| 63 | Frete grátis de R$ 100 fantasma | `FreeShippingBlock.tsx:17-20` (`9542f04`) |
| 66 | `enableReviews` não desliga nada | `ProductView.tsx:694,858,1109,1187` + `20260812020000_*.sql:56-67` |
| 69 | Cancelamento não devolve cupom | `20260901000000_*.sql:200-203,653-671` (`1cdc888`) — **ver ressalva** |
| 75 | Admin decidido por `app_metadata` do localStorage | `AuthContext.tsx:167-171,238-241,314-323` |

> **Ressalva no #69, corrigida nesta rodada:** o código está certo, e a devolução roda via
> `cron.schedule` **dentro da própria migration** (`20260901000000_*.sql:705`, a cada 15
> minutos, desenho comentado em `:686-704`) — não é um job agendado à parte, fora do
> repositório. O desconhecido real é outro: **essa migration foi aplicada no banco de
> produção?** `pg_cron` só executa o que está registrado no banco vivo, e a reauditoria não
> teve credencial para conferir. Fechado no código, **não confirmado em produção**.

### Os 15 abertos, por custo de deixar quieto

| Ordem | # | O que acontece com quem usa | Onde | Classe |
|---|---|---|---|---|
| 1 | **76** | **Os dois números de dinheiro do painel não batem** — e **piorou** desde julho: agora divergem por DOIS motivos (falta rateio de desconto, e o KPI ganhou filtro de `payment_status` que o donut não tem). Correção que só rateie o desconto **não resolve mais** | `baseline:2069-2101` + `20260822000100:289` | **migration** |
| 2 | **68** | O voto "Útil" conta **+2 por clique** e pode ser repetido para sempre | `ReviewCard.tsx:153`, `useReviews.ts:262-266`, `baseline:3075-3088` | **parte front, parte migration** |
| 3 | **64** | O cliente marca a notificação como lida, ela some, e **volta ao reabrir o app** | `NotificationContext.tsx:63-102`; RLS em `baseline:5606,5627` não cobre `usuario_id IS NULL` | **migration (RLS)** |
| 4 | **71** | Clicar num produto antigo abre **tela em branco**. Venda perdida em silêncio | `App.tsx:2060-2064,1949-1963` | front |
| 5 | **52** | O cache do app **cresce sem limite** e degrada sozinho ao longo de dias até parar de funcionar offline | `useUpdateCheck.ts:69`, `sw.ts:81,188-194` | front |
| 6 | **67** | Favoritos **somem da lista** | `FavoritesContext.tsx:186-190` + `StoreContext.tsx:559,570` | front |
| 7 | **53** | Falha de rede durante a purga pode **zerar o app do cliente** | `useUpdateCheck.ts:202` — falta `navigator.onLine` e retomada | front |
| 8 | **51** | Apagar o último item **não some da tela** | `StoreContext.tsx:795`, `useBanners.ts:611`, `useCategories.ts:283`, `dataVault.ts:234` | front |
| 9 | **65** | A resposta da loja à avaliação **não aparece para o cliente** | `useReviews.ts:168-178` — **uma linha** no mapeador | front |
| 10 | **73** | Quem usa teclado **não enxerga onde está** na tela | `index.css:138` (`outline: none !important` global), `:423` é código morto | front |
| 11 | **55** | Reordenar banner corrompe a tela do admin | `useBanners.ts:518,526,531` | front |
| 12 | **54** | Banner novo **não aparece na Home por 60s** | `useBanners.ts:68-75,122` | front |
| 13 | **70** | A loja pode ficar **presa no tema escuro** | `App.tsx:554-571` — falta o `else` final | front |
| 14 | **72** | O filtro de categoria **zera ao trocar de aba** | `App.tsx:903,1663` | front |
| 15 | **74** | O prefetch grava no disco **a cada render** | `useBehavioralPrefetch.ts:56-68`, `useNetworkAdaptive.ts` | front |

> **Ressalva nos achados #67 e #76 — mesma classe do #44 (faixa anterior): não verificado
> contra o banco vivo.** `docs/onboarding/06-ESTADO-ATUAL.md:217` e `:221` registram os dois
> como "Rebaixado" em ~30/07 (0 favoritos apontando para fora do catálogo truncado; 0 pedidos
> com desconto gravado). Dado com quase um mês, não revalidado aqui — mesma ressalva do #44,
> **não rebaixamos** os dois nesta reauditoria.

## Achados de runtime (R1 a R9) — medidos

### Os 5 fechados

| R# | Título curto | Onde o conserto está |
|---|---|---|
| R1 | Build de produção não sobe, tela branca | `src/lib/env.ts:29-87` (validação virou módulo, pinta a tela antes do `throw`) + `src/lib/supabase.ts:6` (`9542f04`) |
| R2 | `react-helmet-async` morto sob React 19 | Pacote **sumiu do `package.json` e do lock**; substituto em `src/hooks/useDocumentMeta.ts:48-94`, usado nas 3 views. React confirmado `19.2.0` (`9542f04`) |
| R3 | Precache de 6,6 MB no Service Worker | `vite.config.ts:379-389` (`globIgnores`); `public/images/demo/` não existe mais; `og-image.png` caiu de 673 kB para **30.175 bytes** (`78e7d3c`) |
| R5 | Imagens em resolução original | `src/lib/imageUrl.ts:45,49` (transform + `srcSet`), consumido em 4 componentes (`9542f04`) |
| R7 | `NODE_ENV` do shell degrada o build | `vite.config.ts:45-47,152` (`df4c187`, 05/08) |

### Os 3 abertos e 1 indeterminado

| Ordem | R# | O que acontece | Onde | Classe |
|---|---|---|---|---|
| 1 | **R8** | **533 `console.*` reais em produção** (eram 512 em julho — piorou), em 73 arquivos, **6** sob guarda `DEV`. **O vazamento do nome completo do cliente já foi fechado, em `a4863e4`** (3 minutos antes desta linha ter sido escrita pela primeira vez): `AuthContext.tsx:366` hoje é `console.log("[Auth] Profile fetched")`, sem dado nenhum, dentro de `if (profileData && import.meta.env.DEV)`. A classe do achado segue aberta — os 533 continuam entregando nome de tabela, fluxo e ID a quem abrir o console | `src/main.tsx:5-17` (filtro global de logs); nenhum `drop_console` em config nenhuma | front — sem PII conhecido hoje, mas **exposição de estrutura interna** |
| 2 | **R9** | **Não existe rota 404.** Link quebrado (produto excluído, URL antiga no WhatsApp) cai na Home sem explicação, e o Google indexa como "soft 404", sujando o índice da loja | `App.tsx:1500,1796-1798`; `vercel.json` reescreve `/(.*)` | front |
| 3 | **R6** | Pontinhos do carrossel de **8×6 px** (difícil de acertar no dedo, não só para quem tem deficiência) e foco de teclado invisível | `BannerCarousel.tsx:257-266`, `Header.tsx:170,342,359`, `index.css:138` | front |
| — | **R4** | Requisições duplicadas no boot (5×, 4×, 29 no total, medido em julho) | — | **INDETERMINADO** |

> **Ressalva no R8, corrigida nesta rodada:** a linha acima já reflete o estado certo. A versão
> anterior deste documento citava `AuthContext.tsx:361` como o log de PII e contava 5 guardas
> `DEV` — os dois números datavam de antes de `a4863e4` (`fix(auth): o nome do cliente para de
> aparecer no console do navegador`), commit ancestral do que escreveu essa linha. A parte de
> PII do R8 está fechada desde então; o resto da classe (533 chamadas sem `drop_console`,
> estrutura interna exposta) segue aberto.

> **R4 não é "aberto", é não medido.** O número original veio de Resource Timing com o app
> rodando, e ninguém rodou o app aqui. O que **se pode** afirmar: em mais de 200 commits **nada
> atacou a causa** — não entrou camada de dedupe (sem `react-query`/`swr` no `package.json`), o
> único *in-flight* do projeto é o do admin-check, e o throttle de 10 s do
> `NotificationContext` já existia quando a auditoria mediu 5×. Fechar ou reabrir isso custa uma
> sessão com o servidor de desenvolvimento no ar.

> **R6 e o achado #73 se sobrepõem:** os dois querem mexer em `src/index.css:138`
> (`outline: none !important` no seletor `*`, que por ser `!important` anula o `:focus-visible`
> de `:421-424`). **É um conserto só, não dois** — quem pegar um precisa fechar o outro junto.

## 🔴 Três achados, uma causa só — e é aqui que está o desenho errado

Isto **não aparece** olhando faixa por faixa, e é o achado mais importante desta reauditoria:

**`.limit(200)` em `src/contexts/StoreContext.tsx:559` e `:570` produz três defeitos diferentes**,
porque o resto do app trata esse recorte de 200 como se fosse o catálogo inteiro:

| # | Sintoma na tela |
|---|---|
| **18** | A partir do 201º produto, os mais antigos somem da loja e da busca |
| **67** | Favoritos somem da lista (interseção com uma lista truncada) |
| **71** | Clicar num produto antigo abre tela em branco |

**Consertar os três separadamente é consertar o sintoma três vezes.** A decisão real é uma só —
paginar no cliente ou mover a busca para o servidor — e é **decisão de arquitetura, do Gabriel**,
não escolha de implementação.

**Outro par com causa comum:** **51** e **54** saem os dois do cache de módulo dos banners
(`globalBannersCache`). Corrigir um sem o outro deixa o defeito vivo.

## O que isto muda na fila de trabalho

- **Reversível, dá para consertar sem acordar ninguém:** 17, 23, 9, 15, 21, 20, 16, 24. (O 22
  saiu desta lista — não se aplica; ver "Não se aplica" na faixa 1-25.) O **16 é uma linha**
  (`key` no `ProductView`). O **17 é front, mas mexe no preço cobrado** — pela regra da casa,
  vai com revisão de contexto limpo em Opus antes de qualquer coisa sair.
- **Espera decisão do Gabriel:** o **18** (paginar no cliente × mover a busca para o servidor é
  escolha de arquitetura, não de implementação) e o **11** (exige migration nova redefinindo
  `sync_cart_atomic`).

## Armadilhas medidas, para quem for consertar

- **A pasta `_arquivadas/` engana.** Quatro arquivos citados pela auditoria de julho foram para
  lá (entre eles `20260708190000_secure_otp_flow.sql` e
  `20260712230000_add_local_shipping_config.sql`). A definição viva está no baseline
  `20260806000000_baseline_do_schema_vivo.sql` ou em migration posterior.
- **A RPC do pedido mudou de endereço.** `create_marketplace_order_v22` ainda existe, mas o front
  chama `v23`/`v24` (`src/hooks/useOrders.ts:1251-1252`), definidas em
  `20260951000000_frete_do_pedido_e_do_proprio_carrinho.sql`. **Conferir o achado na v22 dá
  resposta errada.**
- **Migration mais recente vence.** Há precedente no projeto de várias migrations definindo a
  mesma função, onde só a última vale. Conferir sempre a definição viva, não a primeira que
  aparecer na busca.
