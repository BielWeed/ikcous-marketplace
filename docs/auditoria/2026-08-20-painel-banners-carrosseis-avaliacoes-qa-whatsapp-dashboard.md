# Auditoria — Banners, Carrosséis, Avaliações, Perguntas, WhatsApp e Dashboard

**Frente:** CACA-PAINEL · **Data:** 20/08/2026 · **Natureza:** somente leitura. Nenhum arquivo do
repositório foi tocado, nada foi gravado no banco (toda consulta em `BEGIN READ ONLY` + `ROLLBACK`),
nenhum POST/PATCH foi enviado ao PostgREST.

**Como foi medido.** Leitura do código das 6 telas e dos hooks/RPCs que elas usam; conferência de
cada número contra o Supabase de desenvolvimento por `SELECT` direto; e, para o achado 1, pergunta
ao próprio PostgREST com controle positivo. Não consegui abrir o painel logado como admin nesta
sessão (o navegador desta frente está deslogado e credencial é do Gabriel), então **não há print de
tela neste laudo** — a evidência é arquivo:linha + consulta ao banco + resposta da API.

**Estado do banco na medição:** 4 banners (todos criados em fev/2026), 1 avaliação, 6 perguntas
(2 sem resposta), 84 pedidos (72 cancelados), 11 pedidos que contam como dinheiro reconhecido
somando R$ 450,50.

---

## ALTO

### 1. Nenhum banner pode ser criado, e nenhum banner pode ser editado pelo formulário

**O que a pessoa vê:** abre Banners → "Novo Banner" → escolhe imagem, título, subtítulo, cor,
botão, selo, modelo, agendamento → Salvar → **"Erro ao salvar as configurações do banner."**
(dois avisos de erro, um em cima do outro). O mesmo em qualquer edição feita pelo formulário.
O rascunho que a tela guardava some junto.

**O que está errado por trás:** a tabela `banners` tem **8 colunas**. O app grava **23**.

- Banco (`information_schema`, e igual no baseline `20260806000000_baseline_do_schema_vivo.sql:3835`):
  `id, image_url, title, link, position, active, order, created_at`
- O que o app manda ([useBanners.ts:299-324](../../src/hooks/useBanners.ts) no insert e
  [:407-443](../../src/hooks/useBanners.ts) no update), além dessas: `subtitle, title_color,
  subtitle_color, button_text, button_bg_color, button_text_color, font_family, overlay_color,
  overlay_opacity, badge_text, template_type, product_id, start_date, end_date, show_text_overlay`
  — **15 colunas que não existem**.
- `src/types/supabase.ts:145-215` declara as 23. O tipo gerado e o banco divergem, então o
  TypeScript não acusa nada.
- [AdminBannersView.tsx:1433](../../src/views/admin/AdminBannersView.tsx) monta `dataToSubmit` com
  `{...formData}` inteiro, então **toda** gravação carrega as 15 colunas mortas — não só as que a
  pessoa mexeu.

**Evidência direta (leitura pura, com controle positivo):**

```
GET /rest/v1/banners?select=subtitle&limit=1
  HTTP 400 {"code":"42703","message":"column banners.subtitle does not exist"}
GET /rest/v1/banners?select=title&limit=1        <- controle positivo
  HTTP 200 [{"title":""}]
```

Corrobora: os 4 banners do banco foram criados em **18 e 22/02/2026** — nenhum depois disso.

**O que ainda funciona:** listar (o `select("*")` traz as 8 colunas), o interruptor rápido de
ativar/desativar ([AdminBannersView.tsx:1508](../../src/views/admin/AdminBannersView.tsx) manda só
`active`) e reordenar (RPC `swap_banner_order`, que existe e está viva).

**O detalhe que dobra o custo:** a loja já sabe desenhar tudo isso.
`src/components/ui/custom/BannerCarousel.tsx:129-215` implementa subtítulo, selo, botão, overlay,
cor de título e os modelos `split_center/split_right/split_left/glassmorphic/neon_glow`. As duas
pontas estão prontas; falta o meio — uma migration.

**Agravantes na mesma tela:**
- [AdminBannersView.tsx:1454-1455](../../src/views/admin/AdminBannersView.tsx) apaga
  `admin_banner_form_draft` **antes** do `await`. A gravação falha e o rascunho já foi.
- Saem dois avisos de erro: um de `updateBanner` ("Erro ao atualizar banner.") e outro do
  `catch` do `handleSubmit` ("Erro ao salvar as configurações do banner.").
- A "Programação Temporal" ("Define uma data e hora para início e fim da exibição deste banner
  automaticamente", [:4927](../../src/views/admin/AdminBannersView.tsx)) nunca teve onde ser gravada.
  O filtro que a leria existe e funciona (`useBanners.ts:251-258`) — só nunca recebe data.

**Quem sente:** o lojista, hoje, na primeira tentativa. E como este repositório é o molde que se
clona, cada loja nasce com a tela de banners quebrada do mesmo jeito.

---

### 2. "Top 5 produtos mais lucrativos" ordena por faturamento e nunca calcula lucro

**O que a pessoa vê:** no Dashboard, o bloco **"top 5 produtos mais lucrativos"**
([TopProductsList.tsx:46](../../src/components/admin/dashboard/TopProductsList.tsx)), com um valor em
reais ao lado de cada produto.

**O que está errado por trás:** a RPC `get_admin_analytics_v2` monta esse ranking com
`SUM(oi.quantity * oi.price)` e `ORDER BY total DESC`. Isso é **faturamento**. O custo
(`produtos.custo`) não entra em lugar nenhum desse bloco — e a mesma RPC sabe calcular lucro
(usa `oi.price - p.custo` no histórico, algumas linhas acima).

**Medido no banco, hoje:**

| Posição na tela | Produto | Valor exibido (faturamento) | Lucro de verdade | Margem |
|---|---|---|---|---|
| 1º | livro de colorir stitch | R$ 111,60 | R$ 49,60 | 44% |
| **2º** | **maleta canetas 120** | **R$ 89,90** | **R$ 27,82** | **31%** |
| **3º** | **Bobbie Goods** | **R$ 51,60** | **R$ 47,60** | **92%** |

O 2º e o 3º estão **trocados**. A tela diz que a maleta é mais lucrativa que o Bobbie Goods; ela
dá quase **20 reais a menos** de lucro.

**Quem sente:** o lojista decide o que repor e o que anunciar por esse ranking, e ele aponta para
o produto de pior margem.

---

### 3. Os 30 modelos de mensagem do WhatsApp usam marcadores que o app nunca substitui

**O que a pessoa vê:** na tela de WhatsApp, 30 modelos prontos, todos escritos com `[nome]`,
`[preco]` e `[link]` — por exemplo *"🔥 Oportunidade Única! Adquira o [nome] por apenas [preco] na
nossa loja. Clique no link para comprar agora: [link] 🛍️"*
([AdminWhatsAppConfigView.tsx:30-175](../../src/views/admin/AdminWhatsAppConfigView.tsx)). Ao lado, um
preview de conversa de WhatsApp mostra a mensagem **já preenchida** com o nome, o preço e o link do
primeiro produto do catálogo.

**O que está errado por trás:** quem preenche os marcadores é
`getProcessedPreviewText` ([:227-256](../../src/views/admin/AdminWhatsAppConfigView.tsx)), e essa função
**só existe dentro da tela de configuração**. O compartilhamento de verdade é
[ProductView.tsx:616](../../src/views/customer/ProductView.tsx):

```js
text: `${config.shareText} ${product.name} por R$${product.price.toFixed(2)}`
```

Nenhuma substituição. E ainda concatena o nome e o preço no fim. Com o modelo acima escolhido, o
cliente compartilha literalmente:

> 🔥 Oportunidade Única! Adquira o [nome] por apenas [preco] na nossa loja. Clique no link para
> comprar agora: [link] 🛍️ Bobbie Goods por R$12.90

(De quebra, `R$12.90` sai com ponto, não com vírgula, e o preview mostra `R$ 12,90`.)

**Quem sente:** o comprador recebe uma mensagem quebrada, e o lojista nunca fica sabendo — ele viu
o preview certo.

---

## MÉDIO

### 4. O botão "Tudo" do gráfico do Dashboard mostra 90 dias

**O que a pessoa vê:** no gráfico "Performance", três botões — `30D`, `90D`, **`Tudo`**
([OperationalPerformanceChart.tsx:156-167](../../src/components/admin/dashboard/OperationalPerformanceChart.tsx)).

**O que está errado por trás:** `get_admin_analytics_v2(p_limit_days integer DEFAULT 90)` e o app
chama `supabase.rpc("get_admin_analytics_v2")` **sem argumento nenhum**
([useAnalytics.ts:251](../../src/hooks/useAnalytics.ts)). O histórico que chega ao navegador tem 90 dias.
`Tudo` só deixa de fatiar um array que já veio cortado.

**Medido:** dos 11 pedidos que contam como dinheiro reconhecido, **2 são mais antigos que 90 dias**,
somando **R$ 78,60** de **R$ 450,50** — 17,4% do faturamento. O pedido mais antigo é de 15/03/2026.
O card "Volume Total", logo acima, mostra os R$ 450,50 completos: **dois números da mesma tela
discordam**, e o de baixo é o que se diz "Tudo".

---

### 5. Os KPIs de Avaliações dizem "Global" e "no total", e são do filtro

**O que a pessoa vê:** quatro cartões — "Média **Global**", "**Total** Recebido", "Taxa de
Resposta" com rodapé "X respondidas **no total**", "Compras Verificadas" com "X verificadas **no
total**". Ao filtrar por estrelas ou digitar na busca, os quatro mudam.

**O que está errado por trás:** a RPC `get_admin_reviews_paged` calcula `total_count`,
`average_rating`, `total_verified` e `total_replied` **dentro do mesmo `WHERE`** que filtra a
listagem (rating + busca). A tela repassa `rating: ratingFilter, search: searchQuery`
([AdminReviewsView.tsx:163-172](../../src/views/admin/AdminReviewsView.tsx)) e guarda o resultado em
variáveis chamadas `globalVerifiedCount` / `globalRepliedCount`.

**Consequência mais feia:** com o filtro devolvendo zero linhas,
[AdminReviewsView.tsx:245-248](../../src/views/admin/AdminReviewsView.tsx) faz
`verifiedRate = totalReviews > 0 ? ... : 100`. A tela mostra **"Compras Verificadas: 100%"** com o
rodapé **"0 verificadas no total"**, na mesma caixa.

**O contraste que fecha o argumento:** a tela irmã de Perguntas faz certo — `getQAStats`
([useQuestions.ts:674](../../src/hooks/useQuestions.ts)) busca os totais numa consulta própria, sem
filtro, e há até um comentário no código dizendo que é de propósito.

---

### 6. O Dashboard não acorda quando o catálogo muda: ele escuta uma tabela que não existe

**O que a pessoa vê:** muda o custo, o preço ou o estoque de um produto e volta ao Dashboard; os
números de estoque continuam os de antes até clicar em "Sincronizar".

**O que está errado por trás:**
[AdminDashboardView.tsx:150](../../src/views/admin/AdminDashboardView.tsx) assina
`{ event: "*", schema: "public", table: "products" }`. **Não existe `products`** — a tabela é
`produtos`:

```
information_schema.tables where table_name in ('products','produtos')
  -> public | produtos | BASE TABLE      (uma linha só)
pg_publication_tables (supabase_realtime)
  -> ... produtos ...   (produtos está publicada; products não aparece)
```

Os outros três canais da mesma tela (`marketplace_orders`, `reviews`, `questions`/`answers`) estão
com o nome certo e publicados — funcionam. É só o do catálogo que está morto. Ocorrência única no
repositório inteiro.

---

### 7. "Horário de Funcionamento" não chega a cliente nenhum

**O que a pessoa vê:** na tela de WhatsApp, o campo "Horário de Funcionamento" com a explicação
**"Informa aos clientes no PWA o expediente de suporte."**
([AdminWhatsAppConfigView.tsx:741](../../src/views/admin/AdminWhatsAppConfigView.tsx)). Salva sem erro.

**O que está errado por trás:** `businessHours` é lido, mapeado e gravado
(`StoreContext.tsx:221`, `:459`, `realtimeSyncEngine.ts:105`) e **não tem um único consumidor** em
`src/views/customer/`. Varredura por `businessHours` e `business_hours` no `src/` inteiro: só
contexto, mapeamento e a própria tela de configuração.

Está gravado no banco agora: `business_hours = "Seg-Sex: 8h as 19h"`. Nenhum comprador jamais viu.

Para comparar, os outros dois campos da mesma tela funcionam: `shareText` é usado em
`ProductView.tsx:617`, e a promessa *"O código 55 é adicionado automaticamente"* é cumprida nos
quatro lugares que abrem o WhatsApp (Checkout, Ficha do pedido, Produto e Perfil).

---

### 8. "Max: 8" e "Max: 10" nas vitrines automáticas não passam de 6 na loja

**O que a pessoa vê:** em Vitrines & Carrosséis, cada vitrine tem um seletor "Max:" com 4, 6, 8 e
10 ([AdminCarouselsView.tsx:552](../../src/views/admin/AdminCarouselsView.tsx)), e o preview da própria
tela mostra a quantidade escolhida.

**O que está errado por trás:** na loja, `newArrivals` já sai cortado em 6 **antes** de o `maxItems`
ser aplicado ([HomeView.tsx:170-181](../../src/views/customer/HomeView.tsx), `.slice(0, 6)`), e depois
`secProducts = newArrivals.slice(0, max)` ([:327](../../src/views/customer/HomeView.tsx)) não tem como
recuperar o 7º. Isso atinge **"Últimos Lançamentos"** e **toda vitrine personalizada em modo
automático** (elas caem no mesmo `else`). Para `offers` e `bestsellers` o teto interno é 10, então
ali as quatro opções funcionam. Vitrine com curadoria manual não passa por esses tetos.

**De quebra, o preview da tela admin não é o que a loja mostra nem em 6:** o admin ordena
`new_arrivals` só por data de criação ([AdminCarouselsView.tsx:268-271](../../src/views/admin/AdminCarouselsView.tsx)),
e a loja põe produto sem estoque no fim antes de cortar. Com mais de 6 produtos, o conjunto exibido
pode ser outro.

---

### 9. "Frete" aparece como categoria de produto, e é a 3ª maior

**O que a pessoa vê:** no bloco "Inteligência Estratégica", a divisão de faturamento por categoria.
A ajuda da tela promete *"Divisão proporcional de faturamento, volume de vendas e ticket médio por
**categoria de produto**"* ([AdminDashboardView.tsx:430-434](../../src/views/admin/AdminDashboardView.tsx)).

**O que está errado por trás:** `get_category_analytics` faz `UNION ALL` de uma linha sintética
`'Frete'` com `SUM(o.shipping)`. Ela entra na rosca, na legenda e no percentual como se fosse
categoria.

**Medido, o que a tela mostra hoje:**

| Categoria | Valor | % |
|---|---|---|
| brinquedo | R$ 253,10 | 56,2% |
| Utilidade | R$ 82,60 | 18,3% |
| **Frete** | **R$ 68,00** | **15,1%** |
| Auto Cuidado | R$ 46,80 | 10,4% |

Junto disso: o "Faturamento Total" desse bloco é a soma das categorias **visíveis**, e o lojista
pode esconder categoria com um clique ([StrategicIntelligenceBlocks.tsx:233-238](../../src/components/admin/dashboard/StrategicIntelligenceBlocks.tsx)).
Escondeu uma, o "Faturamento Total" encolhe e passa a discordar do "Volume Total" do topo da mesma
tela.

---

### 10. O selo "Verificado" que o comprador vê é um interruptor manual, sem checagem nenhuma

**O que a pessoa vê:** na tela de Avaliações, um interruptor por avaliação e o KPI "Compras
Verificadas". Na loja, a avaliação ganha um selo verde **"Verificado"**
([ReviewCard.tsx:99-104](../../src/components/ui/custom/ReviewCard.tsx)) e, no perfil público,
**"Compra verificada"** ([UserProfileView.tsx:455](../../src/views/customer/UserProfileView.tsx)).

**O que está errado por trás:** `toggleVerified` ([useReviews.ts:441-453](../../src/hooks/useReviews.ts))
faz `update({ verified: !currentVerified })` e nada mais. A tabela `reviews` não tem coluna de
pedido, e em lugar nenhum do caminho se pergunta se essa pessoa comprou esse produto.

**O contraste, de novo na tela irmã:** em Perguntas, o mesmo conceito é derivado de verdade — a RPC
`get_admin_questions_paged` calcula `is_verified` com `EXISTS (... marketplace_orders o ... WHERE
o.status = 'delivered' AND oi.product_id = q.product_id)`. Uma tela confere, a outra confia no
clique — e é a que não confere que mostra o selo ao comprador.

---

## BAIXO

### 11. "Conversão Comercial: Impacto Alto" é texto fixo
[AdminQAView.tsx:428-430](../../src/views/admin/AdminQAView.tsx): `value: "Impacto Alto"`, cravado. Fica
como quarto cartão ao lado de três números medidos, com o mesmo desenho e a mesma bolinha pulsando.
Mesmo padrão dos achados 6/7/12 da auditoria de Push.

### 12. "Moderação Ativa" sem fila de moderação
[AdminReviewsView.tsx:348-352](../../src/views/admin/AdminReviewsView.tsx) mostra uma bolinha verde
pulsando com o texto "Moderação Ativa". A tabela `reviews` não tem coluna de aprovação
(`id, product_id, user_id, rating, comment, created_at, helpful, verified, merchant_reply,
merchant_reply_at`): toda avaliação vai ao ar na hora, e a única ferramenta é apagar depois.

### 13. A ajuda do Dashboard documenta KPIs que estão em outra tela
O modal "Central de Inteligência & KPIs" descreve como "Principais Indicadores (KPIs)" desta tela:
**Capital Alocado**, **Lucro Potencial**, **Faturamento** e **Ticket Médio**
([AdminDashboardView.tsx:367-415](../../src/views/admin/AdminDashboardView.tsx)). Os cartões que a tela
realmente tem são **Volume Total**, **Total de Pedidos**, **Ticket Médio** e **Clientes Únicos**
([KpiSummaryCards.tsx:30-63](../../src/components/admin/dashboard/KpiSummaryCards.tsx)). "Capital
Alocado" e "Lucro Potencial" existem, mas na tela de **Produtos**
(`AdminProductsView.tsx:312`, `:320`). Só um dos quatro nomes bate.

### 14. Latente: o bloco de categorias não usa a regra de dinheiro reconhecido
`get_admin_analytics_v2` filtra `payment_status IS NULL OR IN ('pago','pago_apos_expirar')`;
`get_category_analytics` filtra só `status NOT IN ('cancelled','returned')`. **Hoje os dois dão o
mesmo total (R$ 450,50)** porque todo pedido não cancelado do banco está com pagamento nulo ou
`pago` — então isto **não é um defeito observável agora**. Um único pedido com pagamento `expirado`
que ainda não tenha sido cancelado já separa os dois números na mesma tela. Parece ser a sobra da
correção do achado 3 da auditoria de Pedidos, que passou por `get_admin_analytics_v2` e não por
esta.

### 15. Latente: erro na consulta de estatísticas de Perguntas vira "Fila Limpa"
`getQAStats` ([useQuestions.ts:685-686](../../src/hooks/useQuestions.ts)) faz `totalRes.count || 0` e
**nunca olha `.error`** — o supabase-js não lança, devolve `{count: null, error}`. Uma falha vira
`total = 0`, `pending = 0`, e o cartão passa a dizer **"Fila Limpa"** e "Taxa de Resposta 0%" para
uma loja com perguntas esperando. `fetchStats` só faz `console.error`. Não observei isso acontecer
hoje (anon lê a view normalmente: `Content-Range: 0-5/6`); o defeito é o zero que quer dizer
"não sei".

---

## O que eu conferi e estava certo

- As três posições de banner (`home_top`, `home_middle`, `home_bottom`) são renderizadas pela loja,
  e batem com a `CHECK` da tabela. Sem defeito.
- `swap_banner_order`, `get_category_analytics` e `get_retention_rate` existem e estão vivas.
- "O código 55 é adicionado automaticamente": cumprido nos 4 pontos que abrem o WhatsApp.
- `shareText` é consumido de verdade (é a substituição dos marcadores que falta, achado 3).
- A loja respeita `active`, ordem, título e curadoria manual das vitrines.
- Os KPIs de Perguntas são globais de propósito e não são contaminados pelo filtro.
- `get_admin_questions_paged` está limpa.
- O `BannerCarousel` da loja implementa todos os campos visuais — o buraco é só o banco.

## Pendências minhas

- **Sem print de tela.** O navegador desta frente está deslogado e credencial é do Gabriel. Todos
  os achados acima estão sustentados por arquivo:linha, consulta ao banco ou resposta da API — mas
  quem tiver sessão de admin aberta consegue fotografar o achado 1 (erro ao salvar banner) e o 5
  (100% com zero) em menos de um minuto cada.
- **Achado 1, a metade que não medi diretamente:** provei por leitura que as 15 colunas não existem
  (400 do PostgREST, com controle positivo em `title`). Não disparei um `INSERT` para ver o
  `PGRST204`, porque esta frente declarou que não escreve no banco. O mecanismo é o mesmo cache de
  schema nos dois sentidos, e os 4 banners parados em fevereiro corroboram — mas quem for consertar
  deve reproduzir o erro na tela antes de escrever a migration.
- Não abri os ~3.000 finais das 5.385 linhas de `AdminBannersView.tsx` linha a linha; varri por
  chamada de banco, número exibido e frase de promessa.

---

# ADENDO — degraus, tela de Login e fronteiras (pedido da CENTRAL, 22:4xZ)

A CENTRAL pediu duas coisas que faltavam: o **degrau de 1 a 4** de cada achado (régua de
`docs/auditoria/2026-08-20-fila-unica-de-dor.md`) e a varredura de **tudo** que sobrou em
`src/views/admin/`, não só as 6 telas da minha fatia.

## Degraus atribuídos

| # | Achado | Degrau |
|---|---|---|
| 2 | "Top 5 mais lucrativos" ordena por faturamento | 1 |
| 4 | Botão "Tudo" mostra 90 dias | 1 |
| 5 | KPIs de Avaliações "Global" são do filtro (+ 100% com zero) | 1 |
| 6 | Realtime em `table: "products"`, que não existe | 1 |
| 9 | "Frete" como categoria de produto | 1 |
| 11 | "Conversão Comercial: Impacto Alto" cravado | 1 |
| 1 | Nenhum banner pode ser criado nem editado | 2 (topo) |
| 3 | 30 modelos com marcadores que ninguém substitui | 2 |
| 7 | "Horário de Funcionamento" não chega a cliente | 2 |
| 8 | "Max: 8/10" não passa de 6 na loja | 2 |
| 10 | Selo "Verificado" é interruptor manual | 2 |
| 12 | "Moderação Ativa" sem fila de moderação | 2 |
| 13 | Ajuda do Dashboard documenta KPIs de outra tela | 3 |
| **16** | **Login do painel: dois avisos, e o 429 culpa a senha** | **3** |
| 14 | `get_category_analytics` sem a regra de dinheiro | latente → 1 |
| 15 | `getQAStats` cai em 0 silencioso | latente → 1 |

## 16. Achado novo — a tela de Login do painel dá dois avisos, e um culpa a senha certa

`src/views/admin/AdminLoginView.tsx` **não estava em auditoria nenhuma** nem na minha fatia
original. Auditei porque a CENTRAL pediu "o que sobrou em `src/views/admin/`".

**O que a pessoa vê:** senha errada no painel → a caixa vermelha *"Email ou senha administrativos
incorretos."* (`AdminLoginView.tsx:34`) **e**, junto, um toast com a mensagem crua do Supabase
(`AuthContext.tsx:616`, `` toast.error(`Erro ao entrar: ${error.message}`) ``).

**O que está errado por trás:** a tela de login do **cliente** trata isso direito —
`AuthView.tsx:165-180` traduz por caso, inclusive `error.status === 429` → *"Muitas tentativas.
Tente novamente em alguns minutos."*. A tela do **admin** não tem esse ramo: num bloqueio por
excesso de tentativas ela afirma "senha incorreta" com a senha certa, e o lojista continua
tentando — o que estende o bloqueio.

**Degrau 3, com um aviso para quem consertar:** hoje quem salva é o toast cru, que ao menos mostra
a causa real. **Apagar só o toast "para limpar a duplicação" PROMOVE isto a degrau 1**, porque
sobra apenas a frase que culpa a senha. O conserto certo é o do `AuthView`: traduzir por caso e
mostrar UMA mensagem.

## O que eu tentei derrubar na tela de Login e NÃO virou achado

**A guarda de acesso ao painel está correta e já endurecida.** Testei a hipótese de um cliente
comum entrar no painel com a senha certa dele:

- `handleNavigate` bloqueia (`App.tsx:770-781`) e `syncWithUrl` também (`:1598-1611`).
- O espelho `adminStatusRef` usa **`useLayoutEffect`** (`App.tsx:618-620`), então **não existe** a
  corrida de espelho-de-estado que derrubaria a guarda no instante do login.
- `adminStatus` nasce `"unknown"` de propósito e só a RPC promove (`AuthContext.tsx:148-154`), com
  o porquê escrito no código — e a guarda ignora `"unknown"` justamente para não expulsar admin de
  verdade.
- Para um não-admin o estado vai de `not-admin` para `not-admin`: a guarda nunca abre.

Ninguém precisa olhar isso de novo.

## Varredura completa de `src/views/admin/` — 17 arquivos

| Arquivo | Situação |
|---|---|
| `AdminOrdersView` · `AdminProductsView` · `AdminProductFormView` | auditado em *Pedidos e Produtos* — não refiz |
| `AdminCustomersView` · `AdminUserDetailView` · `AdminSettingsView` · `AdminShippingView` · `AdminCouponsView` · `AdminCouponFormView` · `AdminPushView` | auditado em *Clientes, Ajustes, Cupons, Frete e Push* — não refiz |
| `AdminBannersView` · `AdminCarouselsView` · `AdminReviewsView` · `AdminQAView` · `AdminWhatsAppConfigView` · `AdminDashboardView` | minha fatia — achados 1 a 15 |
| `AdminLoginView` | **lacuna real: nenhuma auditoria e nenhuma fatia. Achado 16 + a guarda conferida acima.** |

Nenhuma tela do painel ficou sem dono.

## Incidente de árvore compartilhada (não é achado de auditoria)

`ls -1 src/views/admin/` devolveu **18** arquivos, incluindo
`AdminProductsView.original-teste-vermelho.tsx`. Poucos comandos depois: **17**, e `find` não acha
resto nenhum. Medido: `git log --all -- <caminho>` **vazio** (nunca esteve em commit) e
`git check-ignore` **exit 1** (não era ignorado) — era conteúdo não rastreado do working tree, e
sumiu do disco na janela em que a árvore foi de `80a528e` para `3479eb3`.

Fast-forward não apaga arquivo não rastreado. Foi faxina deliberada de alguém (legítimo) **ou** um
`git clean` (trava proibida). Não sei qual e não acuso. Reportado à CONSERTO e à CENTRAL porque o
`git status --short` de agora tem **10 arquivos `??` que são testes novos da CONSERTO** — se foi
`git clean`, a próxima rodada leva os 10 sem erro nenhum na tela.

## Verificação do achado que a CACA-LOJA me mandou (Push — fora da minha superfície)

Reproduzi antes de devolver, como o mural manda. `pg_policy` sobre `public.notificacoes`, vivo:

```
SELECT : (auth.uid() = usuario_id) OR (usuario_id IS NULL) OR is_admin()
UPDATE : (auth.uid() = usuario_id) OR is_admin()      <- sem o OR usuario_id IS NULL
DELETE : (auth.uid() = usuario_id) OR is_admin()      <- idem
INSERT : (auth.uid() = usuario_id) OR is_admin()
```

Confirmado — **e ela tinha achado só metade**: o `DELETE` tem a mesma assimetria, então o cliente
também não consegue **dispensar** o aviso, não só marcá-lo como lido. Contagens: `notificacoes` =
**0 linhas** (0 broadcast), `push_notifications_log` = 5, `push_subscriptions` = 8 — ou seja, o
defeito é certo pela policy e **nunca disparou neste banco**. Devolvido à CACA-LOJA para ela
reportar: Push já foi auditada e não é minha superfície, e quem oferece um trabalho não o pega
sem recusa explícita.

---

# ACHADO 17 — a tela de Vitrines & Carrosséis nunca salvou nada, e diz que salvou

Encontrado em 20/08/2026 numa varredura pedida pela CENTRAL depois do achado 1: *quais outras
telas do painel gravam em colunas que não existem no banco?*

## O que a pessoa vê

Abre **Vitrines & Carrosséis**, renomeia uma vitrine, reordena, escolhe produtos a dedo, cria
vitrine nova. A tela responde **"Vitrines salvas com sucesso!"**. Recarrega a página e **continua
tudo lá**. Nada denuncia problema nenhum.

## O que está errado por trás

`store_config.home_sections` **não existe no banco**. Prova, com controle positivo:

```
GET /rest/v1/store_config?select=home_sections
  HTTP 400 {"code":"42703","message":"column store_config.home_sections does not exist"}
GET /rest/v1/store_config?select=share_text        <- controle positivo
  HTTP 200 [{"share_text":"Olha esse produto na Ikous:"}]
```

`information_schema`: `store_config` tem 25 colunas, e `home_sections` não é uma delas.

**Por que não aparece erro — e é isto que põe este achado acima do de Banners.** A gravação não é
PostgREST direto: `StoreContext.tsx:497` chama a RPC `upsert_store_config(config_json jsonb)`. O
corpo vivo tem uma **lista fixa de 23 colunas** no `INSERT … ON CONFLICT DO UPDATE`, e
`home_sections` não está nela. A RPC recebe a chave, **ignora**, atualiza `updated_at = now()` e
**devolve sucesso**.

- `updateConfig` recebe `error = null` → devolve `true` → toast "Configurações salvas".
- `AdminCarouselsView.handleUpdateHomeSections` vê `salvou === true` → "Vitrines salvas com sucesso!".
- **A trava do #94/ADMIN-010 foi derrotada por baixo.** Aquele conserto — só declarar sucesso se
  gravou — está certo e continua no código, mas confia no retorno da RPC, e a RPC mente. O
  comentário no código diz *"a vitrine sumia da lista no próximo carregamento"*: metade do
  sintoma foi tratada, a causa nunca foi.

**Por que a ilusão dura:** o `setConfig` otimista grava o arranjo no DataVault (IndexedDB) em
camelCase, e a hidratação (`StoreContext.tsx:94-101`) faz `{...defaultStoreConfig, ...configData}`.
O navegador do próprio lojista relê o arranjo dele do cache local.

## Quem sente

**O comprador, sempre.** `config.homeSections` vem de `getVal("home_sections", …)` sobre um
`select("*")` que não tem a coluna. **Corrigido em 21/08/2026 — a versão anterior desta frase dizia
que o valor vira `undefined`, e está errado:** `getVal` (`StoreContext.tsx:186-190`) devolve o
**terceiro argumento** quando a chave falta, então `config.homeSections` é o **array padrão**
(`defaultStoreConfig.homeSections`, `StoreContext.tsx:40-44`), nunca `undefined`. A conclusão não
muda — a loja cai nas 3 vitrines padrão, com títulos padrão, ordem padrão e **nenhuma curadoria
manual**, e todo o trabalho do lojista é invisível para quem compra, desde sempre. O caminho é que
é outro.

**Por que a precisão importa aqui, e não é preciosismo** (reparo da frente CACA-LOJA, 21/08/2026):
o `?? []` de `HomeView.tsx:302` **nunca dispara** — nem hoje, nem depois do conserto. Quem for
conferir a persistência olhando para ele vai encontrá-lo inerte e pode concluir que o conserto não
funcionou. **O sinal certo é `section.maxItems` deixar de ser `undefined`.**

**E a peça que explica por que ninguém nunca viu nada errado:** as 3 seções de
`defaultStoreConfig.homeSections` **não trazem `maxItems`**. Então `section.maxItems ?? 6`
(`HomeView.tsx:313`) resolve para **6, sempre** — e 6 é **exatamente** o corte prévio de
`newArrivals` (`.slice(0, 6)`, `HomeView.tsx:180`). Os dois números coincidem por acidente. O
defeito não é invisível por não existir: é invisível porque **o valor que o exporia nunca chega ao
código**.

**E o lojista, no momento em que a ilusão cai** — este trecho é leitura de código, não observação:
`realtimeSyncEngine.ts:123` mapeia `homeSections: raw.home_sections` (sempre `undefined`) e `:446`
faz `vault.put(config.store, mapped)`, que **substitui** o registro. `store_config` está publicada
no realtime e qualquer save de Ajustes/Frete dispara `updated_at = now()`, então o próximo evento
sobrescreve o cache com `homeSections: undefined`. Sintoma: *"mexi no frete e minhas vitrines
voltaram ao padrão sozinhas"*.

## Degrau 1, no topo dele

Não é só número errado sem denúncia: é **confirmação positiva de sucesso** em cima de uma gravação
que não aconteceu.

## ⚠️ Correção do achado 8 deste mesmo laudo

O achado 8 ("Max: 8/10 vira 6 na loja", `HomeView.tsx:170-181`) **está mascarado por este**. Como
`home_sections` nunca persiste, o `maxItems` não chega a lugar nenhum: o cliente recebe 6 por cair
no padrão, antes de o corte do `HomeView` importar. Consertar o 8 sozinho não muda nada para o
comprador — ele só vira defeito observável **depois** que o 17 for consertado.

## Achado 18 — o app não consegue criar a própria configuração do zero

`StoreContext.tsx:303-322`: com `store_config` vazia (`PGRST116`), o app tenta criar a linha com
`supabase.from("store_config").insert([dbInsert])`, e `dbInsert` inclui **`home_sections`**
(linha 321). Insert por PostgREST nomeando coluna inexistente é rejeitado. O app roda para sempre
em cima de `defaultStoreConfig`, sem nada persistido. Não dói hoje (a linha existe), mas é a
rotina de nascimento do app e está quebrada.

---

# A VARREDURA DO CONFERIDOR — números, método e o que ficou fora

**Conferidor:** `src/types/database.types.ts` (2.170 linhas), o canônico —
`createClient<Database>` em `src/lib/supabase.ts:1`.

| Medida | Valor |
|---|---|
| **N** — tabelas + views no conferidor | **35** (30 `Tables`, 5 `Views`) |
| blocos conferidos (`Row`+`Insert`+`Update`) | **101** |
| duplas (tabela, coluna) conferidas | **371** |
| **M** — com campo fora de ordem alfabética | **1** (só `banners`) |
| **K** — com coluna que o banco não tem | **4 tabelas / 17 duplas** |

| Tabela | Fantasmas | Código vivo usa? |
|---|---|---|
| `banners` | 15 | **SIM** — achado 1 |
| `store_config` | 1 (`home_sections`) | **SIM** — achado 17 |
| `v_store_config` | 1 (`home_sections`) | leitura do cliente |
| `produtos_custo` | 2 — a **tabela inteira** não existe | **NÃO**, inerte |

**Direção inversa:** **12 colunas existem no banco e faltam no conferidor** —
`marketplace_orders.paid_at`, `.confirmation_email_sent_at`, `.coupon_usage_returned`,
`otp_verifications.attempts`, `.order_id`, **`produtos.custo`**, e `store_name`/`store_city`/
`store_state` em `store_config` e `v_store_config`.

## Por que a heurística da ordem alfabética, sozinha, dá a resposta errada

A hipótese que originou a varredura era: *campo fora de ordem = escrito à mão = candidato*. Ela
acha `banners` — mas **`banners` tem 15 colunas fantasma e só UMA está fora de ordem**. As outras
14 foram inseridas em ordem alfabética perfeita. E `store_config.home_sections`, o achado novo,
está **em ordem correta**: pela régua da ordenação ele é invisível.

Por isso a ordenação entrou como **pista**, e o veredito veio do **diff exaustivo** das 371 duplas
contra o `information_schema`. Filtro que pode não acender não serve de denominador.

**E o reenquadramento que os 17 + 12 impõem:** não é "alguém editou o arquivo à mão uma vez". O
conferidor **deriva nos dois sentidos** e não é regerado há muito tempo. O `produtos_custo` é o
fóssil que prova — os tipos declaram uma *tabela* `produtos_custo` e desconhecem a *coluna*
`produtos.custo`, que é onde vive toda a conta de margem do painel.

## O que ficou fora, dito de propósito

- Cobri `Row`, `Insert` e `Update` dos 35. **Não** cobri `Relationships` (só nomes de FK, não
  gravam nada) nem as seções `Functions`, `Enums` e `CompositeTypes`.
- **Não varri `src/types/supabase.ts`**, o segundo arquivo de tipos (2.160 linhas, quase gêmeo),
  importado por um único consumidor (`src/hooks/useCoupons.ts:4`). Dois conferidores divergentes é
  problema por si só; não medi a divergência entre eles.
- Comparação contra o banco de **desenvolvimento**. Schema diferente em produção muda os números.
- Nenhuma escrita: `SELECT` em `BEGIN READ ONLY` + `ROLLBACK` e `GET` no PostgREST, sempre com
  controle positivo ao lado. Sem print — segue sem sessão de admin.

---

# ACHADO 19 — buscar produto em Vitrines e em Banners não acha nada com acento

Origem: a frente CACA-LOJA achou o defeito pelo lado da loja (`useProducts.ts:356`, `ilike` sem
`unaccent`) e me avisou. As duas telas abaixo são minhas e ela não podia vê-las; reproduzi a
medição por conta própria antes de assumir.

**O que a pessoa vê:** o lojista abre a curadoria de uma vitrine, ou o seletor de produto de
destino de um banner, digita **"eletrica"** para achar a escova elétrica, e a lista volta
**vazia** — com os produtos ali embaixo. Teclado de celular não acentua sozinho: este é o caminho
normal, não o excêntrico.

**Onde:**
- `src/views/admin/AdminCarouselsView.tsx:348-353` — `p.name.toLowerCase().includes(q) || p.category?.toLowerCase().includes(q)`
- `src/views/admin/AdminBannersView.tsx:673` — `p.name.toLowerCase().includes(productSearch.toLowerCase())`

Nenhuma normaliza acento, e **o projeto já tem a função pronta**: `normalizeText` em
`src/lib/utils.ts`, usada por `SearchBar`, `useSearch` e `HomeView`.

**Medido no catálogo real, com os dois controles na mesma rodada:**

| termo | como a tela faz | se normalizasse |
|---|---|---|
| eletrica · oleo · sabao · agua · loucas | **0** cada | 2 · 1 · 1 · 1 · 1 |
| **elétrica** (controle POSITIVO, com acento) | **2** | 2 |
| **escova** (controle NEGATIVO, sem acento nenhum) | **3** | 3 |

Os dois controles acenderam — não é instrumento cego. **7 de 19 produtos ativos têm acento no
nome: 36,8% do catálogo.**

**A assimetria dentro do próprio painel:** as outras duas telas de busca desta auditoria fazem
**certo**, no servidor — `get_admin_reviews_paged` e `get_admin_questions_paged` usam
`unaccent(…) ILIKE unaccent(…)` nos dois lados. Buscar avaliação e pergunta ignora acento; buscar
produto não.

**Agravante só do Banners:** o seletor mostra `filteredProducts.slice(0, 5)` — 5 resultados no
máximo. Produto acentuado fica duplamente inalcançável: some da busca, e sem busca só entram 5
de 19.

**Degrau 3.** A pessoa percebe que não achou e contorna. Custa tempo, não custa decisão errada.

**Conserto:** trocar duas expressões por `normalizeText`. O filtro já é client-side sobre lista em
memória — não passa por SQL.

**Fora do meu alcance, e não peguei:** o `useProducts.ts:356` original é SQL e seus três
chamadores (`AdminProductsView.tsx:230`, `AdminPushView.tsx:147`, `AdminLayout.tsx:289`) são telas
já auditadas ou arquivos que outra frente está editando. Fato útil para quem pegar: a extensão
`unaccent` **já está instalada** neste Postgres — não precisa de migration para instalar nada.

---

# EMENDA AO ACHADO 8 — o alcance, medido pela CACA-LOJA

Ela mediu o `HomeView` e o corte prévio é **diferente por seção**. O corpo do achado 8 já dizia
que `offers`/`bestsellers` têm teto 10 e por isso não sofrem, mas a frase curta que eu usei em
mensagem — *"Max: 8 e Max: 10 não têm efeito nenhum na loja"* — era **larga demais**. A medição
dela:

| Seção | corte prévio | produtos hoje | Max 8 / Max 10 |
|---|---|---|---|
| **Novidades** | `.slice(0,6)` (linha 180) | 19 | ✘ dá 6 |
| Ofertas | `.slice(0,10)` (linha 191) | 4 | ✔ |
| Mais Vendidos | `.slice(0,10)` (linha 203) | **0** — a seção nem renderiza | — |
| Lista manual (`productIds`) | nenhum | — | ✔ |

**A ironia que vale escrever:** o defeito acerta exatamente a única seção com produtos suficientes
para 8 e 10 quererem dizer alguma coisa. Ofertas tem 4 itens; "Max: 10" ali seria inócuo mesmo sem
bug nenhum.

**O que a tabela dela não cobre, e importa depois:** vitrine **personalizada em modo automático**
também cai no `else` do `HomeView:327`, ou seja, em `newArrivals` — cortado em 6. Hoje isso é
inalcançável porque o achado 17 impede qualquer vitrine personalizada de existir; **quando o 17
for consertado, o alcance do 8 aumenta** e passa a incluir toda vitrine personalizada automática.

**Dependência de ordem, que continua valendo:** o achado 8 está mascarado pelo 17 e só vira
defeito observável depois dele.
