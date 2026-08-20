# Auditoria do painel do lojista — Pedidos e Produtos

**Data:** 20/08/2026 · **Escopo:** só as telas **Pedidos** e **Produtos** do painel admin,
mais a ficha de pedido e o formulário de produto que saem delas
· **Natureza da AUDITORIA:** somente leitura — nenhum destes 16 achados foi corrigido enquanto
ela era escrita, e nada foi alterado no banco até aqui.

> ## ⚠️ Este relatório não é mais só um retrato — leia isto antes de agir sobre ele
>
> **Depois da auditoria, o Gabriel mandou corrigir os achados de ALTO RISCO, e os cinco foram
> corrigidos** (itens 1 a 5), revisados por contexto limpo e commitados em `e6f0864`. **As duas
> migrations foram aplicadas** no Supabase de desenvolvimento, com autorização explícita dele.
>
> | Item | O que era | Como está hoje |
> |---|---|---|
> | 1 · pedido com situação nula, invisível a todo contador | coluna aceitava nulo | `NOT NULL` + `DEFAULT 'pending'` — **fechado** |
> | 2 · a ficha não dizia se foi pago, e avançava sem trava | nada na tela | pagamento em 2 pontos + confirmação antes de avançar — **fechado** |
> | 3 · "Receita Hoje" contava PIX nunca pago | 9 agregados sem filtro | regra única de dinheiro reconhecido — **fechado** |
> | 4 · "Total Concluído" mostrava 6 e não contava concluído | `month.count` | `deliveredTotal`, hoje **3** — **fechado** |
> | 5 · dinheiro em pedido cancelado sem fila | nenhum contador | `paidOnCancelled` + aviso fixo — **fechado** |
>
> **Os 11 achados de risco médio e baixo (itens 6 a 16) continuam abertos** — não foram pedidos.
>
> Os números e as evidências do corpo deste documento são os **medidos durante a auditoria**, e
> foram deixados como estavam de propósito: eles precisam continuar batendo com o que as telas
> mostravam naquela hora, senão a evidência perde o valor. Onde um item foi corrigido depois,
> há uma nota dentro dele dizendo isso.
>
> Estado do trabalho e o que falta: [PASSAGEM-2026-08-20.md](PASSAGEM-2026-08-20.md).

**Como foi medido.** O app foi aberto no navegador com sessão de admin e cada tela foi usada
de verdade; o que apareceu na tela foi conferido contra o banco de desenvolvimento por
consulta direta (só `SELECT`). Onde o número da tela e o do banco divergem, os dois estão
escritos abaixo. Achado que eu não consegui reproduzir não entrou — o que ficou de fora está
em *Pendências minhas*, no fim.

**Estado do banco no momento da medição:** 84 pedidos (72 cancelados), 19 produtos ativos.

> **Depois da auditoria, em 20/08/2026:** a pedido do Gabriel, o pedido de teste do item 1
> (`#214B11`, R$ 105,00, "TESTE COMPROVANTE - apagar") foi apagado do banco, junto com seus 2
> itens. O banco tem agora **83 pedidos** e **nenhum** pedido com situação nula. Os números
> deste relatório são os medidos **antes** dessa exclusão — foram deixados como estavam para
> continuarem batendo com o que as telas mostravam na hora. O achado do item 1 **continua
> valendo**: o que foi removido foi a linha, não o comportamento.

---

## Resumo — ordenado por quanto dói

| # | O que a pessoa vê | O que é verdade | Quem sente | Quanto dói |
|---|---|---|---|---|
| 1 ✅ | Um pedido de **R$ 105,00** no topo da lista, marcado "Novo Pedido" | Ele não existe para nenhum contador do painel, some do próprio filtro "Novo Pedido", e nunca vai expirar | quem compra e quem vende | **Alto** |
| 2 ✅ | A ficha do pedido, com o botão "Avançar: Em Separação" | A ficha **não diz em lugar nenhum** se o pedido foi pago. Dá para mandar separar e enviar um pedido não pago sem nenhum aviso | quem vende | **Alto** |
| 3 ✅ | "Receita Hoje R$ X" | Soma PIX que só foi **gerado**, nunca pago. Em 11/08 mostraria **R$ 214,40** num dia de receita **R$ 0,00** | quem vende | **Alto** |
| 4 ✅ | "Total Concluído: 6" | São todos os pedidos dos últimos 30 dias que não foram cancelados. Entregues de verdade nesses 30 dias: **1** | quem vende | **Alto** |
| 5 ✅ | Um pedido cancelado com a etiqueta "Pago fora do fluxo" | Dinheiro do cliente entrou e o pedido está cancelado. Nenhuma fila, contador ou alerta aponta para ele | quem compra e quem vende | **Alto** |
| 6 | Botão "Todos Ativos" ligado por padrão | Traz **tudo**, inclusive cancelado: **72 dos 84** pedidos são cancelados | quem vende | **Médio-alto** |
| 7 ✅ | "Capital Alocado", "Lucro Potencial" e "ROI" na tela de Produtos | Congelam depois de excluir, duplicar ou editar um produto — seguem contando o produto que saiu | quem vende | **Médio-alto** |
| 8 ✅ | Um produto com "Margem de Lucro **100,0%**" | É um produto **sem custo cadastrado**. E a etiqueta "Custo Suspeito" pula justamente o custo zero | quem vende | **Médio** |
| 9 | 6 produtos com a etiqueta verde "Em Operação" | Estão com estoque **zero**; na loja o botão deles é "Esgotado" | quem compra e quem vende | **Médio** |
| 10 | "Ações Pendentes: 7" e, ao lado, o crachá "6" na navegação | Dois contadores da mesma coisa, na mesma tela, discordando | quem vende | **Médio** |
| 11 | Ao abrir Produtos: "Nenhum produto cadastrado / 0 itens" | Há 19 produtos. É o texto que a tela mostra durante o carregamento | quem vende | **Médio-baixo** |
| 12 | Filtro "Status de Pagamento" | Filtra só os 12 pedidos da página aberta, não os 84 | quem vende | **Médio-baixo** |
| 13 ✅ | Card, formulário e variante dizem 10 unidades; o KPI precifica 11 | Duas contas do mesmo estoque que se soltaram uma da outra | quem vende | **Baixo** |
| 14 | "Potencial: + R$ 37,2" | Dinheiro escrito com uma casa decimal | quem vende | **Baixo** |
| 15 | "ID: #" na ficha do pedido, sem nada depois | Campo vazio renderizado como se estivesse quebrado | quem vende | **Baixo** |
| 16 | Dois avisos de "produto removido" ao excluir um produto | Um só foi removido | quem vende | **Baixo** |

---

## 1. Um pedido de R$ 105,00 que o painel mostra e nenhum número enxerga

**O que a pessoa vê.** No topo da lista de Pedidos, com o filtro padrão ligado:
`#214B11 · 20 de ago. · **Novo Pedido** · Aguardando pagamento · TESTE COMPROVANTE - apagar ·
Blusa de teste e mais 1 · R$ 105,00`. Um pedido comum, do dia, esperando pagamento.

**O que é verdade.** Esse pedido está com a coluna `status` **nula** no banco — não é
"pending", não é nada. E como praticamente toda conta do painel filtra por `status`, e em SQL
qualquer comparação com nulo dá "não sei" em vez de "sim", ele é descartado de todas elas ao
mesmo tempo:

| Onde | O que acontece com ele |
|---|---|
| "Receita Hoje" | Fora. O cartão marca **R$ 0,00** num dia com R$ 105,00 na lista |
| "Ações Pendentes" | Fora. Marca 7, sem contar este |
| "Ticket Médio" e "Total Concluído" | Fora |
| Crachá de pedidos na navegação | Fora. Marca 6 |
| Filtro **"Novo Pedido"** | **Fora** — some da lista, apesar de o painel escrever "Novo Pedido" nele |
| Varredura que expira PIX não pago | Fora. **Nunca vai expirar**, nem devolver estoque |
| Lista "Todos Ativos" | **Aparece**, porque essa é a única consulta sem filtro de status |

E na ficha dele o painel oferece o botão "Avançar: Em Separação", como se fosse um pedido
novo normal — porque, quando o status não existe, o painel assume "Novo Pedido".

**De onde veio esse pedido, e por que isso importa.** Ele foi inserido à mão para testar o
e-mail de comprovante (nome do cliente "TESTE COMPROVANTE - apagar", itens sem produto
vinculado, sem prazo de expiração). **O checkout do app não consegue criar um pedido assim** —
ele grava `status = 'pending'` fixo. Então isto **não** é um defeito do seu checkout, e não
há motivo para achar que pedidos de cliente estão sumindo.

O que sobra, e que é defeito de verdade, é o **modo de falhar**: a coluna `status` aceita nulo
e não tem valor padrão, e quando um pedido chega nesse estado o painel escolhe o pior
comportamento possível — **mostra o pedido como normal e não conta ele em lugar nenhum**, sem
uma única pista de que algo está errado. Vale para qualquer origem: teste, importação,
migração futura, integração. Um pedido invisível para todos os contadores é pior que um
pedido que não aparece, porque ninguém vai procurar o que a tela diz que está lá.

**Evidência.**

- Banco: `status IS NULL` em 1 pedido de R$ 105,00 (`bce47b20…214b11`, criado 20/08/2026
  05:10 UTC), com `expires_at` nulo e `payment_status = 'aguardando'`.
- Esquema: `marketplace_orders.status` é `is_nullable = YES` e **`column_default = null`**.
- O painel chama de "Novo Pedido":
  [`src/components/admin/orders/OrderStatusBadge.tsx:68`](../../src/components/admin/orders/OrderStatusBadge.tsx#L68)
  — `statusConfig[status || "pending"]`.
- A lista o traz porque `get_admin_orders_paged` com `p_status='all'` não tem predicado de
  status; o filtro "Novo Pedido" manda `p_status='pending'` e `o.status = 'pending'` é nulo
  para essa linha.
- A varredura de expiração exige `status = 'pending' AND expires_at IS NOT NULL`
  (`expirar_pedidos_vencidos`) — ele não atende nenhuma das duas.
- **Reproduzido na tela em 20/08/2026:** com "Todos Ativos" ele é o 1º cartão; ao clicar em
  "Novo Pedido" a lista devolve 6 pedidos e **ele não está entre eles**.

**Quem sente.** Quem compra (pedido que ninguém vai processar nem cancelar) e quem vende.

**Quanto dói.** Alto — não pelo pedido de teste, mas porque o painel provou que sabe exibir
um pedido e ao mesmo tempo excluí-lo de todo número que você usa para decidir.

**Situação em 20/08/2026, depois da auditoria.** O Gabriel autorizou e a linha foi apagada
(1 pedido + 2 itens; nada mais dependia dela, e não havia estoque a devolver porque os itens
não tinham produto vinculado). O banco não tem mais nenhum pedido com situação nula.

**✅ CORRIGIDO em 20/08/2026, depois disto.** A frase que estava aqui — *"a porta continua
aberta: `marketplace_orders.status` segue aceitando nulo e sem valor padrão"* — **deixou de ser
verdade** e por isso saiu. A migration `20260822000000_status_do_pedido_nunca_nulo.sql` foi
aplicada com autorização do Gabriel, e o banco responde hoje `is_nullable = NO`,
`column_default = 'pending'::text`. A porta está fechada.

---

## 2. A ficha do pedido não diz se ele foi pago

**O que a pessoa vê.** Abre a ficha de um pedido e encontra: cliente, endereço, itens,
"Consolidado Financeiro" (subtotal, desconto, frete, montante final), "Liquidação: Rede PIX",
rastreio, notas — e o botão grande **"Avançar: Em Separação"**.

**O que é verdade.** Em nenhum lugar dessa ficha aparece se o dinheiro entrou. "Liquidação:
Rede PIX" é o *meio* de pagamento, não o estado dele. O aviso "Aguardando pagamento" existe
**só no cartão da lista** — some no instante em que você abre o pedido para trabalhar nele.

E o botão de avançar não tem nenhuma trava de pagamento: a única condição é o pedido não
estar cancelado. Dá para levar um pedido não pago para "Em Separação", "Em Trânsito" e
"Finalizado" sem que o painel diga uma palavra.

**Evidência.**

- Busca por `PaymentStatusBadge` e `paymentStatus` em
  [`src/components/admin/orders/OrderDetail.tsx`](../../src/components/admin/orders/OrderDetail.tsx)
  (1.106 linhas): **nenhuma ocorrência**. A única menção a pagamento é o rótulo "Liquidação"
  na linha 519, que mostra o meio.
- A trava do botão é só o cancelamento:
  [`src/components/admin/orders/OrderDetail.tsx:144-146`](../../src/components/admin/orders/OrderDetail.tsx#L144)
  — `{nextStatus && orderStatus !== "cancelled" && ( ... onStatusChange(orderId, nextStatus) )}`.
- **Observado na tela em 20/08/2026:** ficha do pedido `#214B11`, cujo cartão na lista diz
  "Aguardando pagamento". Na ficha: nada sobre pagamento, e "AVANÇAR : EM SEPARAÇÃO" no topo.

**Quem sente.** Quem vende.

**Quanto dói.** Alto. É o ponto exato onde a mercadoria sai do estoque. A informação que
decide se ela pode sair está na tela anterior e não nesta.

---

## 3. "Receita Hoje" conta PIX que nunca foi pago

**O que a pessoa vê.** O primeiro cartão da tela de Pedidos, "Receita Hoje", subtítulo
"Finanças". É o número que responde "quanto vendi hoje".

**O que é verdade.** Todo pedido nasce aguardando pagamento e tem 30 minutos para ser pago.
A conta da receita **não olha o pagamento** — soma todo pedido que ainda não foi cancelado.
O PIX entra na receita no instante em que é gerado e só sai meia hora depois, quando expira.

**Evidência.**

- A conta, no banco (`get_admin_analytics_v2`):
  `SELECT COALESCE(SUM(total),0) ... WHERE created_at >= date_trunc('day', now()) AND status NOT IN ('cancelled','returned')`.
  Não há cláusula sobre `payment_status` em nenhuma das somas de receita.
- Onde o pedido nasce "aguardando":
  [`supabase/migrations/20260807000000_reserva_com_expiracao.sql:323`](../../supabase/migrations/20260807000000_reserva_com_expiracao.sql#L323).
- Onde a tela exibe: [`src/views/admin/AdminOrdersView.tsx:236`](../../src/views/admin/AdminOrdersView.tsx#L236).
- O tamanho do erro, nos dias reais do banco:

  | Dia | O que "Receita Hoje" teria mostrado | Receita realmente paga | Pedidos que expiraram |
  |---|---|---|---|
  | 11/08/2026 | R$ 214,40 | **R$ 0,00** | 6 de 6 |
  | 14/08/2026 | R$ 137,40 | **R$ 0,00** | 5 de 6 |
  | 17/08/2026 | R$ 4,00 | R$ 1,00 | 3 de 4 |

**Quem sente.** Quem vende.

**Quanto dói.** Alto. É o número mais visível da tela, e ele infla justamente nos dias de
mais movimento — depois some sozinho, sem explicação nenhuma.

---

## 4. "Total Concluído" não conta pedido concluído

**O que a pessoa vê.** O quarto cartão: **"Total Concluído: 6"**, com ícone de visto e
subtítulo "Concluído".

**O que é verdade.** É a contagem de **todos os pedidos dos últimos 30 dias que não foram
cancelados** — inclusive os que estão em "Novo Pedido" e nunca foram separados. Entregues de
verdade: **1** nos últimos 30 dias, **3** em todo o banco. O filtro "Finalizado", dois
centímetros abaixo do cartão, devolve 3.

**Evidência.**

- [`src/views/admin/AdminOrdersView.tsx:228`](../../src/views/admin/AdminOrdersView.tsx#L228):
  `completed: analyticsStats.month?.count || 0`.
- [`src/views/admin/AdminOrdersView.tsx:257`](../../src/views/admin/AdminOrdersView.tsx#L257):
  esse `completed` é rotulado `label: "Total Concluído"`.
- No banco, `month_count` é
  `COUNT(*) ... WHERE created_at >= now() - interval '30 days' AND status NOT IN ('cancelled','returned')`.
  A palavra "concluído" não aparece na conta.
- Contagem em 20/08/2026: `month_count` = **6**; `delivered` nos últimos 30 dias = **1**;
  `delivered` em todo o banco = **3**.

**Quem sente.** Quem vende.

**Quanto dói.** Alto. Multiplica por 6 o trabalho realmente terminado e contradiz o filtro
que está na mesma tela.

---

## 5. Dinheiro entrou num pedido cancelado e nada no painel cobra ação

**O que a pessoa vê.** Um cartão com a etiqueta "Cancelado" e, ao lado, "Pago fora do fluxo —
precisa de atenção". Só isso.

**O que é verdade.** Esse pedido (16/08/2026, R$ 1,00) é um cliente que pagou o PIX depois do
prazo: o dinheiro caiu na conta do Mercado Pago e o pedido está cancelado. Ou a loja entrega,
ou devolve. O painel não ajuda a lembrar:

- "Ações Pendentes" não o inclui — só conta status `pending`/`new`/`processing`, e ele está
  `cancelled`;
- não há filtro de status que o isole (o que existe, "Cancelado", traz os 72);
- o filtro por pagamento existe, mas só olha a página aberta (item 12);
- não existe botão de estornar, reativar ou marcar como resolvido.

A etiqueta é a única sinalização, e ela desce na lista conforme chegam pedidos novos.

**Evidência.**

- Banco: 1 pedido com `payment_status = 'pago_apos_expirar'` e `status = 'cancelled'`.
- `today_pending`: `SELECT COUNT(*) ... WHERE status in ('pending','new','processing')`.
- `pago_apos_expirar` aparece no painel **apenas** em
  [`OrderStatusBadge.tsx:151`](../../src/components/admin/orders/OrderStatusBadge.tsx#L151)
  (a etiqueta) e em [`AdminOrdersView.tsx:90`](../../src/views/admin/AdminOrdersView.tsx#L90)
  (a lista de valores do filtro). Nenhuma ação, nenhum contador.
- **Observado na tela em 20/08/2026**, 8º cartão da primeira página.

**Quem sente.** Quem compra e quem vende.

**Quanto dói.** Alto. É o único ponto do painel com dinheiro de cliente parado esperando uma
decisão humana — e é justamente o que não tem fila.

---

## 6. "Todos Ativos" traz tudo, e 72 dos 84 pedidos estão cancelados

**O que a pessoa vê.** O primeiro botão de filtro, ligado por padrão, escrito **"Todos
Ativos"**. Na primeira página, com ele ligado, **7 dos 12** cartões dizem "Cancelado ·
Expirado".

**O que é verdade.** O filtro não filtra: manda `p_status = 'all'` e a consulta faz
`WHERE (p_status = 'all' OR o.status = p_status)`. Dos 84 pedidos, **72 estão cancelados** —
86%.

**Evidência.**

- Rótulo: [`src/views/admin/AdminOrdersView.tsx:912`](../../src/views/admin/AdminOrdersView.tsx#L912).
- O que é enviado: [`src/hooks/useOrders.ts:385`](../../src/hooks/useOrders.ts#L385).
- O que a consulta faz: `get_admin_orders_paged`, `WHERE (p_status = 'all' OR o.status = p_status)`.
- **Observado na tela em 20/08/2026**, filtro "Todos Ativos", página 1 de 7.

**Quem sente.** Quem vende.

**Quanto dói.** Médio-alto. Não perde dinheiro sozinho, mas é o atrito de todo dia: para
achar os pedidos pagos esperando separação, é preciso passar sete páginas ou descobrir o
filtro escondido atrás do funil.

---

## 7. Os KPIs financeiros de Produtos congelam depois de mexer no catálogo

**O que a pessoa vê.** Exclui um produto. "Produtos no Catálogo" cai de 19 para 18. "Capital
Alocado", "Lucro Potencial" e "ROI do Portfólio" não mudam, e seguem precificando o produto
que saiu.

**O que é verdade.** Os três cartões financeiros vêm de um resumo do servidor guardado em
memória. Ao excluir, o código limpa esse cache **mas não avisa a tela** e **não busca de
novo**. A tela só busca quando ainda não tem nada — e ela tem, o valor velho. Só volta ao
lugar quando o lojista passa o mouse na aba "Geral" ou recarrega o app.

**Evidência.**

- A exclusão chama `clearAnalyticsCache()` e mais nada:
  [`src/hooks/useProducts.ts:894`](../../src/hooks/useProducts.ts#L894).
- `clearAnalyticsCache()` zera só variáveis de módulo — não chama `setStats` nem dispara o
  evento `ikcous-admin-stats-updated`:
  [`src/hooks/useAnalytics.ts:123-128`](../../src/hooks/useAnalytics.ts#L123).
- A tela só rebusca se `stats` for nulo:
  [`src/views/admin/AdminProductsView.tsx:120-124`](../../src/views/admin/AdminProductsView.tsx#L120).
- `confirmDelete` ([`AdminProductsView.tsx:358-391`](../../src/views/admin/AdminProductsView.tsx#L358))
  não chama `fetchExecutiveSummary` em nenhum caminho.
- O único outro gatilho em todo o `src/` é o hover da aba "Geral":
  [`src/components/layouts/AdminLayout.tsx:261`](../../src/components/layouts/AdminLayout.tsx#L261).
- A tela não é desmontada ao trocar de aba (`DeferredTabContent` em
  [`AdminArea.tsx`](../../src/components/layouts/AdminArea.tsx)), então o valor velho
  sobrevive a ir e voltar.

**Quem sente.** Quem vende.

**Quanto dói.** Médio-alto. Vale para excluir, duplicar e para toda edição de custo, preço ou
estoque — os momentos em que o lojista está olhando exatamente para esses números.

**Não observei ao vivo**, e de propósito: seria preciso excluir ou editar um produto de
verdade, e esta auditoria é somente leitura. A cadeia acima é determinística, sem corrida:
não existe caminho no código que atualize esses três cartões depois de uma alteração de
produto.


> ### ✅ CORRIGIDO em 20/08/2026
>
> A tela de Produtos passou a **rebuscar o resumo executivo** depois de cada alteracao de
> catalogo, em vez de esperar que alguem passe o mouse na aba "Geral". Sao quatro caminhos, e a
> auditoria so tinha visto tres:
>
> | Caminho | Onde |
> |---|---|
> | excluir produto | `confirmDelete` |
> | duplicar produto | `confirmDuplicate` |
> | **editar** produto (o formulario e outra view, mas a lista **nao desmonta**) | efeito de transicao `active` |
> | **ativar/desativar pelo card** — achado NOVO, descoberto na revisao | `handleToggleStatus` |
>
> O quarto nao estava no relatorio e e o que mais aparece: acontece **sem sair da tela**, com os
> cartoes visiveis na mesma dobra, e a RPC de fato muda (`... WHERE deleted_at IS NULL AND ativo
> = true`, em `20260822000100`).
>
> **Duas tentativas foram descartadas antes desta, e o motivo importa.** A primeira corrigia na
> raiz: `clearAnalyticsCache()` avisaria todas as instancias e zeraria o `stats` delas. A revisao
> de contexto limpo bloqueou — como as telas de admin **nunca desmontam** (`DeferredTabContent`),
> o zeramento atingiria todas, e o Dashboard e a tela de Pedidos nao tem `stats` nas dependencias
> do efeito de rebusca: passariam a mostrar **`R$ 0,00` e "Sem Dados Registrados" como se fossem
> medicao real**, e o aviso de dinheiro em pedido cancelado sumiria sozinho — justamente o aviso
> que existe porque sumir em silencio foi o que escondeu aquele defeito antes. Trocar "numero
> velho, aproximadamente certo" por "numero falso, definitivamente errado" numa tela de dinheiro
> e piorar. A correcao ficou **local a tela que tem o defeito**, e `useAnalytics.ts` voltou byte a
> byte ao original.
>
> Provado por [tests/front/admin-products-kpi-apos-mexer-no-catalogo.test.tsx](../../tests/front/admin-products-kpi-apos-mexer-no-catalogo.test.tsx)
> — 7 casos, incluindo os limites (operacao que **falha** nao rebusca) e a guarda contra RPC em
> laco. Prova de mutacao: sabotando cada chamada, so o teste correspondente cai; e movendo a
> atualizacao do `wasActiveRef` para depois do `return`, o caso da edicao estoura.

---

## 17. A rebusca dos KPIs de Produtos nao tem debounce

**Achado NOVO, encontrado na revisao da correcao do 7 — nao estava na auditoria original.**

**O que a pessoa ve.** O lojista pausa tres produtos em sequencia rapida. Cada um dispara uma
rebusca forcada, que pula a janela de 30 s e chama a RPC direto. Com retentativa e espera
crescente (ate ~3,5 s no pior caso), a resposta do primeiro pode chegar **depois** da do
terceiro — e a ultima a chegar e a que fica. "Capital Alocado" pode mostrar o valor de uma
operacao atras, por ate 30 s, ate a proxima revalidacao.

**Quem sente.** Quem vende, e so em operacao em lote.

**Quanto doi.** Baixo, e a comparacao honesta e esta: **isso ja e melhor que o melhor caso de
hoje**, que e o numero congelado ate recarregar o app. Se autocorrige.

**A correcao, quando doer.** Debounce curto antes da rebusca. O padrao ja existe no
repositorio: `AdminOrdersView.tsx:430-436` espera 320 ms antes de recarregar.


## 8. Produto sem custo aparece como o mais lucrativo do catálogo

**O que a pessoa vê.** No cartão do "ZZ TESTE PIX 16-08": **"Margem de Lucro 100,0%"** em
verde e, ao lado, **"ROI de Rendimento 0,0%"** em vermelho. Embaixo: "Capital Alocado R$ 0,00"
e "Potencial + R$ 2".

**O que é verdade.** Esse produto está **sem custo cadastrado** (`custo = 0`). A conta da
margem usa `custo || 0`, então "sem custo" vira "custo zero", e custo zero dá margem de 100% —
o melhor número possível do painel — para o produto sobre o qual não se sabe nada. A conta do
ROI, na mesma tela e no mesmo cartão, protege-se da divisão por zero e devolve 0,0%. Os dois
números descrevem o mesmo produto e dizem coisas opostas.

Pior: o cartão **tem** uma etiqueta para isso, "Custo Suspeito" — e ela é acionada só quando
o custo está entre R$ 0,01 e R$ 0,10. Custo exatamente zero, que é o caso que mais merece o
aviso, é o único excluído.

**Evidência.**

- Margem e ROI: [`src/views/admin/AdminProductsView.tsx:1361-1370`](../../src/views/admin/AdminProductsView.tsx#L1361)
  — `margin = (price - (costPrice || 0)) / price * 100` e
  `roi = (costPrice || 0) > 0 ? ... : 0`.
- Etiqueta "Custo Suspeito": [`src/views/admin/AdminProductsView.tsx:1459-1466`](../../src/views/admin/AdminProductsView.tsx#L1459)
  — `costPrice > 0 && costPrice <= 0.1`. O `> 0` é o que exclui o custo zero.
- Banco: 1 produto ativo com `custo = 0`.
- **Observado na tela em 20/08/2026**, visualização detalhada, 1º cartão.

**Quem sente.** Quem vende.

**Quanto dói.** Médio. Uma margem de 100% num painel é um convite a comprar mais daquele
produto. Aqui ela significa o contrário: que ninguém sabe quanto ele custou.

> ### ✅ CORRIGIDO em 20/08/2026
>
> O cartao **parou de afirmar numero que ninguem mediu**. Sem custo cadastrado, "Margem de
> Lucro", "ROI de Rendimento", "Capital Alocado" e "Potencial" mostram **"—"** em vez de
> inventar 100%, 0% e R$ 0,00. E a etiqueta que existia para avisar isso e nunca avisava passou
> a cobrir o caso, com texto proprio: **"Sem Custo Cadastrado"** para custo ausente ou zero, e a
> **"Custo Suspeito"** de sempre para a faixa de R$ 0,01 a R$ 0,10 (suspeita de digitacao).
>
> **Com custo real, nada mudou** — a conta e a mesma expressao de antes, conferido operando por
> operando na revisao, inclusive o lucro total, que era a linha mais provavel de escorregar.
> Zero **medido** continua aparecendo: estoque zero com custo real mostra "R$ 0,00", nao "—".
>
> Um ganho que ninguem tinha pedido: custo que chega como `NaN` (texto sujo no campo) antes caia
> em `NaN || 0` e produzia margem de 100% igual; agora cai em "—".
>
> Provado por [tests/front/admin-products-margem-sem-custo.test.tsx](../../tests/front/admin-products-margem-sem-custo.test.tsx)
> — 6 casos, com asserção **positiva** de que o cartao esta na tela antes de qualquer negativa
> (senao o teste ficaria verde quando a tela nao renderiza). Prova de mutacao: tratando "sem
> custo" como custo zero de novo, **4 dos 6 caem** — `expected '100.0%' to be '—'` — e os 2 de
> regressao seguem verdes.
>
> **O modo compacto nunca teve este defeito** (nao mostra numero derivado de custo), e e ele o
> padrao da tela. Ou seja: a mentira so aparecia para quem trocava para a visualizacao detalhada
> — e o aviso novo tambem so aparece la.

---

## 18. O app nao consegue guardar "nao sei quanto custou"

**Achado NOVO, encontrado na revisao do 8 — e e a raiz dele.**

**O que e verdade.** `src/hooks/useProducts.ts:530` grava `custo: productData.costPrice || 0` ao
criar produto, e `AdminProductsView.tsx:489` faz o mesmo ao duplicar. O `null` que o formulario
monta e **achatado para `0` antes de chegar ao banco**. Depois disso, "custo zero de verdade" e
"nunca preenchi o custo" sao a mesma linha, e nenhuma tela consegue distinguir os dois.

**A consequencia que ja se paga.** A correcao do achado 8 teve de escolher um lado, e escolheu o
menos caro: trata zero como ausencia. O preco disso e que um **brinde de custo zero legitimo**
tambem aparece como "—" e ganha a etiqueta "Sem Custo Cadastrado", que afirma uma causa que nao
aconteceu. Nao ha regra de exibicao que acerte os dois casos enquanto a origem for ambigua — o
conserto e no caminho de escrita, nao na tela.

**Quem sente.** Quem vende, e so quem cadastra brinde ou amostra com custo zero de proposito.

**Quanto doi.** Baixo hoje. Sobe se a loja passar a usar produto de custo zero de verdade.

**Onde ja esta anotado no codigo.** O comentario em `AdminProductsView.tsx` (bloco do achado 8)
carrega o gatilho: no dia em que `useProducts.ts:530` parar de achatar `null` em `0`, o `hasCost`
tem de virar `costPrice != null` **na mesma mudanca**, senao o zero medido fica invisivel.


## 9. Seis produtos aparecem como "Em Operação" com estoque zero

**O que a pessoa vê.** No cartão do produto, a etiqueta verde **"Em Operação"** e, embaixo,
"Estoque 00". Na visualização padrão (compacta), **não há mais nada** — nenhuma palavra
dizendo que acabou.

**O que é verdade.** São seis produtos ativos com estoque zero. A loja já sabe: lá o botão
deles é "Esgotado" e eles vão para o fim da lista. O painel é que não tem esse estado.

Na visualização detalhada aparece uma etiqueta "Crítico" — mas ela dispara igual para estoque
0 e para estoque 5, então não distingue "acabou" de "está acabando". Na compacta, que é a
padrão, essa etiqueta **não existe**: o único sinal é o número "00" em vermelho ao lado de uma
etiqueta verde escrita "Em Operação".

Os seis: `copo De Alce Água Portátil 600ml Infantil`, `Umidificador Difusor de Óleo
Essencial`, `Tirar Bolinha Roupa Papa Bolinhas EléTrico`, `kit de adesivos 3d de microcenas`,
`Bolhas de Sabão com Pistola Lançadora`, `caderno adesivo 3d, 20 cenarios`.

**Evidência.**

- Banco: `SELECT count(*) FROM produtos WHERE deleted_at IS NULL AND ativo AND estoque = 0` → **6**.
- Etiqueta verde sem condição de estoque, cartão detalhado:
  [`AdminProductsView.tsx:1455-1458`](../../src/views/admin/AdminProductsView.tsx#L1455).
- Etiqueta verde no cartão compacto, e **nenhuma etiqueta "Crítico" ali**:
  [`AdminProductsView.tsx:1676-1682`](../../src/views/admin/AdminProductsView.tsx#L1676).
- "Crítico" com a mesma régua para 0 e 5 (só no detalhado):
  [`AdminProductsView.tsx:1468`](../../src/views/admin/AdminProductsView.tsx#L1468).
- A loja mostra "Esgotado": [`ProductCard.tsx:264`](../../src/components/ui/custom/ProductCard.tsx#L264)
  e [`PremiumOffers.tsx:489`](../../src/components/ui/custom/PremiumOffers.tsx#L489).
- E o próprio painel já usa a palavra certa em outro lugar — o simulador de celular embutido
  na tela de Produtos escreve "Esgotado":
  [`PhoneSimulator.tsx:243`](../../src/components/admin/PhoneSimulator.tsx#L243). A mesma tela
  diz "Em Operação" no cartão e "Esgotado" na prévia do celular.
- **Observado na tela em 20/08/2026:** "Umidificador Difusor de Óleo Essencial · EM OPERAÇÃO ·
  ESTOQUE 00", e o mesmo para "Bolhas de Sabão com Pistola Lançadora" e "copo De Alce".

**Quem sente.** Quem compra (acha o produto e não pode comprar) e quem vende.

**Quanto dói.** Médio. Não quebra nada, mas é a tela mentindo sobre o estado da loja
justamente onde o lojista decide o que repor.

---

## 10. Dois contadores da mesma coisa, na mesma tela, discordando

**O que a pessoa vê.** Na navegação da esquerda, ao lado de "Pedidos", um crachá vermelho com
**6**. No corpo da tela, o cartão "Ações Pendentes" com **7** e o subtítulo "Urgente".

**O que é verdade.** São duas contas diferentes de "pedidos que precisam de você", e nenhuma
das duas diz qual é qual:

- o crachá conta só `status = 'pending'` → **6**;
- o cartão conta `pending` + `new` + `processing` → **7**.

A diferença é um pedido em "Em Separação" parado desde **24/03/2026**. E o cartão diz
"Urgente" por causa dele — um "urgente" que está no ar há cinco meses. Nenhum dos dois inclui
o pedido do item 1 nem o do item 5.

**Evidência.**

- Crachá: [`src/components/layouts/AdminLayout.tsx:81-85`](../../src/components/layouts/AdminLayout.tsx#L81)
  — `.from("marketplace_orders").select("*", { count: "exact", head: true }).eq("status","pending")`.
- Cartão: `today_pending` na `get_admin_analytics_v2` —
  `WHERE status in ('pending','new','processing')`, sem recorte de data, apesar do nome.
- Rótulo e subtítulo: [`AdminOrdersView.tsx:244-249`](../../src/views/admin/AdminOrdersView.tsx#L244).
- Banco: `pending` = 6; `pending+new+processing` = 7; mais antigo dos sete: **2026-03-24**.
- **Observado na tela em 20/08/2026**, os dois números visíveis ao mesmo tempo.

**Quem sente.** Quem vende.

**Quanto dói.** Médio. Dois números que discordam ensinam a não confiar em nenhum — e um
"urgente" fixo há meses deixa de ser lido no dia em que significar alguma coisa.

---

## 11. A tela de Produtos abre dizendo que não há produto nenhum

**O que a pessoa vê.** Ao entrar em Produtos, por um instante: **"Nenhum produto cadastrado"**
no lugar da lista e **"Produtos no Catálogo: 0 itens"** — com "Capital Alocado R$ 1.331,88"
exibido logo acima, na mesma tela.

**O que é verdade.** Há 19 produtos. Esse é o texto que a tela mostra enquanto carrega. E não
é uma janela de milissegundos por acaso: a busca da lista só dispara **320 ms depois** de a
tela abrir, e nesse intervalo a condição do estado vazio já é verdadeira — a tela não está
"carregando" do ponto de vista dela, está com a lista vazia.

**Evidência.**

- Condição do estado vazio: [`AdminProductsView.tsx:789-796`](../../src/views/admin/AdminProductsView.tsx#L789)
  — `{!loading && products?.length === 0 && ( ... "Nenhum produto cadastrado" )}`.
- A busca só começa depois do atraso: [`AdminProductsView.tsx:218-224`](../../src/views/admin/AdminProductsView.tsx#L218)
  — `setTimeout(() => { loadData(currentPage); }, 320)`. `loading` só vira `true` dentro de
  `loadProducts`, ou seja, depois desses 320 ms.
- **Observado na tela em 20/08/2026**, na primeira leitura logo após a recarga.

**Quem sente.** Quem vende.

**Quanto dói.** Médio-baixo. Some sozinho. Mas "nenhum produto cadastrado" é uma frase de
susto para quem tem o catálogo inteiro numa loja — e ela aparece ao lado de mil e trezentos
reais de capital, o que torna a tela momentaneamente incoerente consigo mesma.

---

## 12. O filtro por status de pagamento só filtra a página aberta

**O que a pessoa vê.** No funil ao lado da busca, escolhe "Pago". A lista mostra 3 pedidos e
o rodapé continua dizendo "1 / 7". Na página 2, a tela fica vazia com o aviso "Nenhum pedido
desta página tem este status de pagamento".

**O que é verdade.** O filtro é aplicado no navegador, sobre os 12 pedidos que já vieram do
servidor. Não reduz o total nem o número de páginas. Para achar todos os pagos, é preciso
abrir as 7 páginas uma a uma.

**Evidência.**

- Aplicação só sobre a página carregada: [`AdminOrdersView.tsx:479-481`](../../src/views/admin/AdminOrdersView.tsx#L479).
- Total de páginas ignora o filtro: [`AdminOrdersView.tsx:478`](../../src/views/admin/AdminOrdersView.tsx#L478).
- A limitação está escrita no próprio código, como comentário:
  [`AdminOrdersView.tsx:169-173`](../../src/views/admin/AdminOrdersView.tsx#L169).
- **Reproduzido na tela em 20/08/2026:** filtro "Pago", página 1 → 3 pedidos; página 2 → aviso
  de página vazia, rodapé ainda em "2 / 7".

**Quem sente.** Quem vende.

**Quanto dói.** Médio-baixo — e é o único achado desta lista em que o app **avisa** que está
limitado em vez de fingir que está tudo certo. O texto do aviso é honesto e útil. O que custa
é o trabalho: sete páginas para responder "quem já me pagou".

---

## 13. Produto com variante: três telas dizem 10, o KPI precifica 11

**O que a pessoa vê.** Para o "Bobbie Goods", o painel diz **10** em três lugares — o cartão
do produto ("Estoque 10"), o formulário ("Estoque gerenciado pelas variantes ativas (10 un)")
e a própria variante ("Cor: Rosa · 10 und"). Os cartões de dinheiro no topo estão calculados
sobre **11**.

**O que é verdade.** O estoque está guardado em dois lugares — a coluna `estoque` do produto e
a soma das variantes ativas — e eles se soltaram. Cartão, formulário e loja leem a variante;
os três KPIs financeiros leem a coluna.

| Produto | Estoque usado pelo KPI | Estoque mostrado no resto do painel e na loja | Capital inflado | Lucro inflado |
|---|---|---|---|---|
| Bobbie Goods | 11 | 10 | R$ 1,00 | R$ 11,90 |
| livro de colorir capivara | 4 | 3 | R$ 14,29 | R$ 15,61 |

**Evidência.**

- Cartão, formulário e loja usam a variante: [`src/lib/mappers.ts:98-107`](../../src/lib/mappers.ts#L98).
- KPI usa a coluna do produto: `get_admin_analytics_v2` faz `SUM(custo * estoque)` e
  `SUM(preco_venda * estoque)` direto de `public.produtos`.
- Banco, 20/08/2026: `produtos.estoque` = 11 e 4; soma de `product_variants.stock_increment`
  ativas = 10 e 3.
- **Observado na tela em 20/08/2026:** cartão "Bobbie Goods · Estoque 10 · Capital Alocado
  R$ 10,00", com "Capital Alocado R$ 1.331,88" no topo (que embute R$ 11,00 desse produto).
- **Se conserta sozinho ao salvar:** o formulário sincroniza `stock` com a soma das variantes
  ([`AdminProductFormView.tsx:768-778`](../../src/views/admin/AdminProductFormView.tsx#L768))
  e grava esse valor. Ou seja, abrir e salvar o produto realinha os dois — mas só se o lojista
  fizer isso por acaso.

**Quem sente.** Quem vende.

**Quanto dói.** Baixo hoje — R$ 15,29 de capital e R$ 27,51 de lucro, com só dois produtos
usando variante. Cresce junto com o uso de variantes.

**Estado (2026-08-20).** Corrigido em
[`supabase/migrations/20260902000000_kpi_usa_o_mesmo_estoque_que_a_tela.sql`](../../supabase/migrations/20260902000000_kpi_usa_o_mesmo_estoque_que_a_tela.sql) —
`get_admin_analytics_v2` passa a calcular `low_stock_count`, `inventory.totalCost` e
`inventory.totalValue` sobre o mesmo estoque efetivo que `mappers.ts` já usa (soma das
variantes ativas quando existe ao menos uma; senão a coluna `estoque`), fechando também o
vizinho do KPI "Estoque Baixo" que tinha o mesmo defeito. Provado com
`node scripts/db-prove-estoque-efetivo-no-kpi.cjs` (com e sem a chave de mutação
`SEM_FIX_ESTOQUE`, transação com `ROLLBACK` — nada gravado). **A migration ainda não foi
aplicada** no banco; falta revisão e aplicação.

---

## 14. Dinheiro escrito com uma casa decimal

**O que a pessoa vê.** No canto do cartão do produto: **"Potencial: + R$ 37,2"**, "+ R$ 125,4",
"+ R$ 2", "+ R$ 119".

**O que é verdade.** É o único valor em dinheiro do cartão formatado sem casas decimais
obrigatórias — todos os outros ("Preço de Venda", "Capital Alocado") usam duas. O resultado é
"R$ 37,2", que não é um jeito válido de escrever dinheiro em português e se lê mal.

**Evidência.**

- [`AdminProductsView.tsx:1583-1588`](../../src/views/admin/AdminProductsView.tsx#L1583)
  — `totalProfit.toLocaleString("pt-BR", { minimumFractionDigits: 0 })`, contra
  `minimumFractionDigits: 2` em todos os vizinhos.
- **Observado na tela em 20/08/2026** em 6 cartões da primeira página.

**Quem sente.** Quem vende. **Quanto dói.** Baixo.

---

## 15. "ID: #" vazio na ficha do pedido

**O que a pessoa vê.** Na lista de itens da ficha, sob cada produto: **"ID: #"** — o cerquilha
e nada depois.

**O que é verdade.** É o identificador do produto, e ele fica vazio quando o item não tem
produto vinculado. Em vez de esconder o campo, a tela imprime o rótulo e o "#" sozinhos, o que
parece um campo quebrado.

**Evidência.**

- [`src/components/admin/orders/OrderDetail.tsx:84`](../../src/components/admin/orders/OrderDetail.tsx#L84)
  — `ID: #{productId ? productId.slice(-6) : ""}`.
- Banco: os dois itens do pedido `#214B11` têm `product_id` nulo.
- **Observado na tela em 20/08/2026**, ficha do pedido `#214B11`, nos dois itens.

**Quem sente.** Quem vende. **Quanto dói.** Baixo.

---

## 16. Excluir um produto mostra dois avisos de sucesso

**O que a pessoa vê.** Ao confirmar a exclusão, dois avisos empilhados: "Produto removido" e,
logo abaixo, "Produto Removido — O produto foi excluído com sucesso."

**O que é verdade.** Um produto só foi removido. São duas camadas emitindo o mesmo aviso.

**Evidência.**

- [`src/hooks/useProducts.ts:896`](../../src/hooks/useProducts.ts#L896) — `toast.success("Produto removido")`.
- [`AdminProductsView.tsx:379-381`](../../src/views/admin/AdminProductsView.tsx#L379)
  — `toast.success("Produto Removido", { description: "O produto foi excluído com sucesso." })`.
- O comentário em `AdminProductsView.tsx:369-375` registra que o caso de **falha** já foi
  corrigido (dois avisos contraditórios). O caso de **sucesso** ficou de fora.

**Quem sente.** Quem vende. **Quanto dói.** Baixo — mas aviso duplicado ensina a ignorar
avisos, e isso cobra caro num aviso que importa.

---

## O que eu tentei derrubar e não virou achado

Pareciam defeito e não são. Ficam registrados para ninguém gastar tempo de novo:

- **"O botão Pausar Produto passa o estado atual, então não pausa."** Não. `toggleProductStatus`
  recebe o estado atual e nega ([`useProducts.ts:1032-1053`](../../src/hooks/useProducts.ts#L1032)).
- **"A busca some quando `codigo` é nulo."** Não. Em `nome ILIKE ... OR codigo ILIKE ...`, um
  acerto no nome dá `TRUE OR NULL` = `TRUE`.
- **"'Lucro Potencial' usa o preço cheio e ignora a promoção."** Não. `preco_venda` já é o
  preço cobrado; o preço riscado mora em `preco_original`.
- **"O cartão compacto de pedido mostra só o primeiro produto."** Não. Escreve
  "<produto> e mais N" e põe um selo "+N" na miniatura
  ([`AdminOrdersView.tsx:1401-1435`](../../src/views/admin/AdminOrdersView.tsx#L1401)).
- **"O `silent-guardian` apaga a sessão do admin."** Não — ele parou de limpar o
  `localStorage` justamente para preservá-la
  ([`public/silent-guardian.js:30-31`](../../public/silent-guardian.js#L30)).
- **"O alerta de estoque baixo do painel (7) briga com a etiqueta 'Crítico' dos cartões (14)."**
  As réguas de fato diferem — `estoque <= COALESCE(estoque_minimo,5)` no servidor contra
  `stock <= 5` no cartão — mas o número 7 (`inventoryAlerts`) **não é exibido em lugar nenhum**
  do `src/`. Sem tela, sem achado.
- **"O painel não usa a largura da tela no desktop."** Não. Medi `main` com
  `getBoundingClientRect()`: 1280 px num navegador de 1280 px. O que parecia estreito era a
  captura de tela com dimensão velha.
- **"O checkout está criando pedidos sem status."** Não — ver o item 1. O checkout grava
  `status = 'pending'` fixo; a linha nula foi inserida à mão.

---

## Pendências minhas

- **Não testei nenhuma ação de escrita** — mudar status de pedido, salvar produto, excluir,
  duplicar. A auditoria foi declarada somente leitura, então tudo que grava ficou de fora. É
  por isso que o item 7 é o único achado provado só por código, e por isso não sei dizer o que
  acontece ao clicar "Avançar" no pedido do item 1 (o de status nulo).
- **O formulário de produto foi aberto, não percorrido.** São 3.317 linhas com abas de foto,
  variante, SEO, frete e promoção; eu confiro a precificação e o estoque, não o resto.
- **O pedido `#214B11` foi apagado em 20/08/2026**, com autorização do Gabriel — é a única
  escrita que esta auditoria fez no banco. Antes de apagar, o conteúdo das linhas foi copiado
  para um arquivo temporário da sessão, e a exclusão rodou dentro de uma transação que abortava
  sozinha se o alvo não fosse exatamente aquela linha marcada como teste. Conferido depois:
  0 pedidos com situação nula, 0 itens órfãos, 83 pedidos no total.
- ⚠️ **CORRIGIDO em 20/08/2026 — o que estava escrito aqui era falso.** A versao anterior dizia
  que a conexao do `DATABASE_URL` "abre as sessoes em modo somente leitura" e que isso "nao e
  problema". As duas afirmacoes estao erradas, e a segunda e a perigosa: ela ensina a tratar um
  sintoma real como caracteristica do ambiente. **Conexao limpa NAO abre em somente leitura.**

  O que acontece de verdade: o `DATABASE_URL` aponta para o **pooler** (porta 6543, Supavisor),
  que **reaproveita a mesma conexao entre programas diferentes**. Um
  `SET SESSION CHARACTERISTICS AS TRANSACTION READ ONLY` executado por um script de outra frente
  grudou na conexao e vazou para quem veio depois — inclusive para esta auditoria. Foi essa
  sujeira, e nao um padrao, que produziu o falso negativo registrado acima.

  **Como escrever script daqui em diante:** abrir com `RESET ALL`, e usar `BEGIN READ ONLY` ou
  `SET LOCAL` para limitar a transacao — **nunca `SET SESSION`**, que sobrevive ao seu programa e
  contamina o proximo. A mesma explicacao esta em
  [PASSAGEM-2026-08-20.md](PASSAGEM-2026-08-20.md).
