# Início do painel, Dashboard CRM e Financeiro — design

> 26/09/2026. Pedido do dono: trocar a tela inicial do painel por um **perfil do lojista** com
> os números financeiros que importam e a **assinatura**; levar o dashboard de métricas atual
> para trás de um botão que abre um **Dashboard CRM** profissional (celular e computador) para
> gerir o app e a loja física; e um botão **Financeiro** que funcione como o "banco da loja"
> (físico + app). Pesquisa de referência na seção "Fontes".

## 1. Três telas

| Tela | Rota | O que é |
| --- | --- | --- |
| **Início** | `admin-dashboard` (mesma rota, conteúdo novo) | perfil da loja, "Hoje", 4 números do mês, pendências, plano, dois botões grandes |
| **Dashboard CRM** | `admin-crm` | o dashboard de métricas que existia (aba *Visão geral*) + Clientes (RFM), Canais, Pedidos, Estoque |
| **Financeiro** | `admin-financeiro` | Visão, Extrato, A pagar/receber, Caixa, DRE, Contas e categorias |

A rota `admin-dashboard` continua sendo a porta do painel (deep links, `getParentView`,
atalhos antigos) — só o conteúdo muda. O dashboard antigo inteiro vira a aba *Visão geral*
do CRM, sem perder nada.

## 2. Regra de ouro do dinheiro

**O dinheiro mora na fonte.** Venda online, venda de balcão e estorno já têm dono no banco
(`marketplace_orders`, `order_refunds`); o Financeiro **lê** essas fontes — não copia. O que
não tem fonte (aluguel, fornecedor, sangria, conta a pagar) nasce em `fin_lancamentos`.

- Dinheiro reconhecido = `payment_status IN ('pago','pago_apos_expirar','recebido_na_entrega')`
  (mesma régua das migrations "receita conta só dinheiro que entrou") — mais os pedidos que
  entraram e depois viraram `estornado` (a entrada aconteceu; o estorno sai como saída).
- Data da entrada = `COALESCE(pagamento_recebido_em, paid_at)` no fuso `America/Sao_Paulo`.
- Conta de destino automática por forma: `online` → conta *Mercado Pago*; `cash` → *Caixa da
  loja*; `pix`/`card` na entrega ou no balcão → *Conta bancária*.
- Estorno concluído (`order_refunds`) → saída na mesma conta da venda, grupo *Deduções*.
- Nada disso passa por gatilho no caminho do dinheiro: `confirmar_pagamento` e
  `registrar_venda_presencial` ficam intocados.

## 3. Banco (uma migration)

- `fin_contas` (caixa · banco · mercado_pago · outro; saldo inicial + data) — 3 contas de
  sistema semeadas de forma idempotente.
- `fin_categorias` (receita/despesa + grupo da DRE: receita · deducao · custo_variavel ·
  despesa_fixa · financeiro · fora_dre) — semente com as categorias de loja pequena.
- `fin_lancamentos` (entrada · saída · transferência; previsto · realizado · cancelado;
  competência, vencimento, realização; parcelas; origem manual/sangria/suprimento/ajuste).
  Realizado não se edita: cancela e lança de novo (trilha de auditoria).
- `fin_caixa_sessoes` (abertura, sangria/suprimento, fechamento com contado × esperado;
  diferença vira lançamento de *Quebra* ou *Sobra* de caixa). Uma sessão aberta por conta.
- RLS ligada em tudo; leitura só `is_admin()`; **nenhuma escrita direta** — só RPCs
  `SECURITY DEFINER` com o gate dentro.
- RPCs de leitura: `fin_resumo`, `fin_extrato`, `fin_dre`, `fin_contas_com_saldo`,
  `fin_caixa_atual`; de escrita: `fin_conta_salvar`, `fin_categoria_salvar`,
  `fin_lancamento_salvar`, `fin_lancamento_baixar`, `fin_lancamento_cancelar`,
  `fin_caixa_abrir`, `fin_caixa_movimentar`, `fin_caixa_fechar`.

## 4. DRE simplificada (competência)

Receita bruta (online | balcão) − Deduções (estornos + devoluções + lançamentos de dedução) =
Receita líquida − CMV (Σ quantidade × `produtos.custo` atual — **estimado**, a tela diz) =
Lucro bruto − Custos variáveis (taxas, frete pago pela loja, embalagem) = Margem de
contribuição − Despesas fixas = Resultado operacional ± Financeiro = **Lucro líquido**.
Transferências, compra de mercadoria e aporte/retirada do dono ficam fora da DRE.

## 5. CRM

- **Visão geral** = o dashboard antigo, intacto.
- **Clientes** — RFM híbrido para loja pequena (quintil puro vira ruído abaixo de ~500
  clientes): R por faixas fixas (≤30 · 31–60 · 61–120 · 121–240 · >240 dias), F por faixas
  fixas (1 · 2 · 3 · 4–5 · ≥6 pedidos), M por quintil (`percent_rank`), FM = ⌊(F+M)/2⌋, e os
  segmentos do Shopify (Campeões, Leais, Ativos, Novos, Promissores, Precisam de atenção,
  Quase dormindo, Em risco, Não pode perder, Hibernando). Identidade do cliente: conta
  (`user_id`) ou, no balcão, WhatsApp. Ação de um toque: WhatsApp com texto pronto.
- **Canais** — online × balcão: receita, pedidos, ticket, mix de pagamento.
- **Pedidos** — funil por status com a idade do pedido parado.
- **Estoque** — o que já existia de saúde de estoque.

## 6. Assinatura

Cobrança de mensalidade é de **outro projeto** (AGENTS.md, escopo). O app só **mostra**: a
tabela `assinatura_da_loja` (uma linha, leitura só do admin, **sem escrita para o app** —
quem grava é o projeto de cobrança com a chave de serviço). Sem linha, o card diz a verdade:
"plano ainda não sincronizado".

## 7. Layout

Celular primeiro: coluna única, KPIs em grade 2×2, listas em cartões, abas roláveis no topo,
valores com `tabular-nums`, entradas `+R$` verdes e saídas `−R$` vermelhas com sinal (a cor
nunca é a única pista), previsto em tom mais claro com etiqueta. Computador (≥1024 px):
grade de 4 KPIs, duas colunas, tabelas de verdade. Toque ≥ 44 px.

## Fontes

- Shopify — grupos RFM e relatórios de clientes: <https://help.shopify.com/en/manual/reports-and-analytics/shopify-reports/report-types/default-reports/customers-reports>
- Shopify POS — sessões de caixa: <https://help.shopify.com/en/manual/sell-in-person/shopify-pos/cash-register-management/register-sessions-in-shopify-pos>
- Conta Azul — fluxo de caixa: <https://ajuda.contaazul.com/hc/pt-br/articles/7322635478157>
- Bling — abertura e fechamento de caixa: <https://ajuda.bling.com.br/hc/pt-br/articles/360035626574>
- Square Books — livro-razão imutável: <https://developer.squareup.com/blog/books-an-immutable-double-entry-accounting-database-service/>
- NN/g — dashboards e bottom sheets: <https://www.nngroup.com/articles/dashboards-preattentive/> · <https://www.nngroup.com/articles/bottom-sheet/>
- Material 3 — breakpoints: <https://m3.material.io/foundations/layout/breakpoints/overview>
