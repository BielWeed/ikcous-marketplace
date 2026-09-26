# Plano — Início/CRM/Financeiro do painel, cartão online e devoluções

> 26/09/2026 · base `claude/app-major-upgrade-wmc8x2` · specs:
> [`inicio-crm-e-financeiro`](../specs/2026-09-26-inicio-crm-e-financeiro-do-painel-design.md),
> [`cartao-online`](../specs/2026-09-26-cartao-online-design.md),
> [`devolucoes`](../specs/2026-09-26-devolucoes-design.md).
> Ciclo: [`ARQUITETURA-AGENTICA.md`](../../processo/ARQUITETURA-AGENTICA.md).

Este arquivo é o **contrato** entre banco, edge e front. Quem implementa uma parte lê a sua
seção e a seção "Contratos". Mudou contrato → muda aqui primeiro.

## Contratos

### Migrations (ordem de aplicação — uma por arquivo, sem BEGIN/COMMIT, com rollback irmão)

| Arquivo | Conteúdo |
| --- | --- |
| `20261175000000_a_devolucao_nasce_no_pedido.sql` | `politica_devolucao`, `devolucoes`, `devolucao_itens`, `devolucao_eventos`, bucket `devolucoes`, RPCs de devolução, aviso ao cliente |
| `20261176000000_o_cartao_online_nasce.sql` | `config_pagamento_cartao`, colunas `tentativas_de_pagamento`/`metodo_online`/`parcelas` em `marketplace_orders`, `liberar_cobranca_do_pedido`, `salvar_config_pagamento_cartao` |
| `20261177000000_o_financeiro_da_loja_nasce.sql` | `fin_contas`, `fin_categorias`, `fin_lancamentos`, `fin_caixa_sessoes`, `assinatura_da_loja`, RPCs `fin_*` |
| `20261178000000_o_crm_e_o_inicio_leem_a_loja.sql` | `crm_visao`, `crm_clientes`, `painel_inicio` |

Toda RPC de admin: `SECURITY DEFINER SET search_path = public`, gate `is_admin()` dentro
(ERRCODE `42501`), `REVOKE ALL ... FROM PUBLIC, anon` + `GRANT EXECUTE ... TO authenticated`.
Toda RPC devolve `jsonb` (o front valida a forma). Valores em reais com 2 casas (`numeric`),
datas `YYYY-MM-DD` no fuso `America/Sao_Paulo`, instantes em ISO.

### Devoluções (20261175000000)

Tabela pública de leitura `politica_devolucao` (linha `id = 1`):
`prazo_arrependimento_dias int (7..90, padrão 7)`, `prazo_troca_dias int (0..365, padrão 30; 0 = não aceita troca)`,
`prazo_vicio_dias int (30..365, padrão 90)`, `aceita_troca bool (true)`, `aceita_vale bool (true)`,
`exige_fotos_vicio bool (true)`, `metodos_locais text[] ⊂ {entrega_na_loja, coleta}`,
`metodos_nacionais text[] ⊂ {etiqueta_reversa, envio_proprio}`, `reembolso_momento ∈ {ao_receber, apos_inspecao}`,
`frete_troca_pago_por ∈ {loja, cliente}`, `categorias_sem_troca text[]`, `texto_politica text`,
`endereco_devolucao text`, `updated_at`.

Status: `solicitada → aprovada | recusada | cancelada`; `aprovada → em_transito | recebida | cancelada`;
`em_transito → recebida`; `recebida → concluida | reprovada`. Terminais: `recusada, cancelada,
concluida, reprovada`. Tipos: `arrependimento` (compra online, até N dias da entrega),
`vicio` (motivo de defeito, até N dias), `troca` (política da loja; só troca ou vale).
Motivos: `tamanho_pequeno, tamanho_grande, nao_gostei, desisti, cor_diferente` (comuns) ·
`defeito, avariado_no_transporte, produto_errado, faltando_peca, diferente_do_anuncio` (vício) · `outro`.
Resoluções: `reembolso, troca, vale`. Métodos: `entrega_na_loja, coleta` (local) ·
`etiqueta_reversa, envio_proprio` (nacional).

| RPC (cliente logado, dono do pedido) | Retorno |
| --- | --- |
| `devolucao_elegibilidade(p_order_id uuid)` | `{pode, motivo_bloqueio, entregue_em, dias_desde_entrega, modalidade, metodos[], prazos:{arrependimento_ate, troca_ate, vicio_ate}, janelas:{arrependimento, troca, vicio}, itens:[{order_item_id, product_id, product_name, image_url, quantidade, ja_devolvida, disponivel, valor_unitario}], politica:{...linha inteira}}` |
| `solicitar_devolucao(p_order_id uuid, p_itens jsonb, p_motivo text, p_detalhe text, p_resolucao text, p_metodo text, p_fotos text[])` — `p_itens = [{order_item_id, quantidade}]`, fotos = caminhos no bucket `devolucoes` começando com `<auth.uid()>/` | `{id, protocolo, tipo, status}` |
| `cancelar_devolucao(p_id uuid)` | `{id, status}` |
| `informar_envio_devolucao(p_id uuid, p_codigo_rastreio text)` | `{id, status}` |
| `devolucoes_do_pedido(p_order_id uuid)` (dono ou admin) | `[{id, protocolo, status, tipo, resolucao_desejada, metodo_retorno, valor_itens, created_at}]` |
| `devolucao_detalhe(p_id uuid)` (dono ou admin) | `{...linha de devolucoes, itens:[...linhas], eventos:[...linhas], pedido:{id, total, shipping, payment_method, payment_status, canal, customer_name, whatsapp, shipping_label_id, shipping_option_id}}` |

| RPC (admin) | Retorno |
| --- | --- |
| `admin_devolucoes_listar(p_status text DEFAULT NULL, p_busca text DEFAULT NULL, p_limite int DEFAULT 50, p_offset int DEFAULT 0)` | `{total, contagem:{solicitada, aprovada, em_transito, recebida, concluida, recusada, cancelada, reprovada}, itens:[{id, protocolo, order_id, cliente_nome, cliente_whatsapp, tipo, motivo, status, resolucao_desejada, metodo_retorno, modalidade, valor_itens, prazo_ate, created_at}]}` |
| `admin_devolucao_decidir(p_id uuid, p_aprovar boolean, p_mensagem text DEFAULT NULL, p_coleta_em timestamptz DEFAULT NULL)` | `{id, status}` — recusar exige mensagem |
| `admin_devolucao_registrar(p_id uuid, p_evento text, p_codigo text DEFAULT NULL, p_nota text DEFAULT NULL)` — `p_evento ∈ {em_transito, recebida}` | `{id, status}` |
| `admin_devolucao_concluir(p_id uuid, p_resolucao text, p_itens jsonb, p_valor_reembolso numeric DEFAULT NULL, p_observacao text DEFAULT NULL)` — `p_itens = [{item_id, condicao ∈ {nova, usada, danificada, ausente}, reestocar bool}]` | `{id, status, resolucao, valor_reembolso, refund_id, reembolso_manual, reestocados}` — com `refund_id` o front chama a edge `estornar-pagamento` (`{refund_id}`), igual ao `EstornoCard` |
| `admin_devolucao_reprovar(p_id uuid, p_motivo text)` | `{id, status}` |
| `salvar_politica_de_devolucao(p jsonb)` | a linha salva |

Fotos: bucket privado `devolucoes` (5 MB, jpeg/png/webp); o cliente grava em
`<uid>/<order_id>/<uuid>.<ext>`; lê o dono e o admin (URL assinada).

### Cartão online (20261176000000)

- `config_pagamento_cartao` (linha `id = 1`, leitura pública): `credito bool (false)`,
  `debito bool (false)`, `parcelas_max smallint (1..12, padrão 1)`, `updated_at`.
- `salvar_config_pagamento_cartao(p_credito boolean, p_debito boolean, p_parcelas_max integer)` (admin) → a linha.
- `marketplace_orders`: `tentativas_de_pagamento int NOT NULL DEFAULT 0`,
  `metodo_online text NULL ∈ {pix, credito, debito}`, `parcelas smallint NULL (1..12)`.
- `liberar_cobranca_do_pedido(p_order_id uuid, p_gateway_payment_id text DEFAULT NULL)` →
  `boolean` (só service role): com id, solta a cobrança recusada (`gateway_payment_id = NULL`,
  `tentativas_de_pagamento + 1`) se ainda for a gravada e o pedido estiver `aguardando`; sem id,
  só conta a tentativa (recusa imediata que nunca ocupou a vaga).

Edge `criar-pagamento`, corpo do cartão:
`{orderId, metodo:"cartao", token, paymentMethodId, paymentTypeId:"credit_card"|"debit_card", parcelas, documento:{type:"CPF"|"CNPJ", number}, email?}`.
Resposta 200: `{paymentId, statusPagamento: "pago"|"aguardando"|"recusado", expiraEm, desafio3ds?: {url}, motivoRecusa?: string, podeTentarDeNovo?: boolean}`.
Cartão recusado **não cancela o pedido**: a vaga é liberada e o cliente tenta outro cartão ou PIX
dentro da mesma reserva de 30 min. Confirmação continua só por webhook/reconciliação →
`confirmar_pagamento` (intocada).

### Financeiro (20261177000000)

Contas de sistema (UUID fixo): Caixa da loja `f1000000-0000-4000-8000-000000000001` (caixa) ·
Conta bancária `…0002` (banco) · Mercado Pago `…0003` (mercado_pago). Venda derivada cai em:
`online` → Mercado Pago · `cash` → Caixa · `pix`/`card` (entrega/balcão) → Conta bancária.

| RPC (admin) | Retorno |
| --- | --- |
| `fin_resumo(p_inicio date, p_fim date)` | `{periodo:{inicio,fim}, saldo_total, contas:[{id,nome,tipo,saldo}], entradas, saidas, resultado, a_receber:{total,vencido,proximos_7_dias}, a_pagar:{total,vencido,proximos_7_dias}, por_forma:[{forma,valor}], por_canal:{online,presencial}, serie:[{dia,entradas,saidas}], caixa_aberto:{id,conta_id,aberto_em,valor_abertura}\|null}` |
| `fin_extrato(p_inicio date, p_fim date, p_conta_id uuid DEFAULT NULL)` | `[{id, origem, tipo, status, valor, data, conta_id, conta_nome, conta_destino_id, conta_destino_nome, categoria_id, categoria_nome, descricao, forma_pagamento, pedido_id, vencimento, editavel}]` — `origem ∈ {manual, sangria, suprimento, ajuste_caixa, venda_online, venda_balcao, venda_entrega, estorno, estorno_externo, devolucao}` |
| `fin_previstos(p_tipo text)` — `entrada` = a receber, `saida` = a pagar | `[{id, descricao, valor, vencimento, vencido, conta_id, conta_nome, categoria_id, categoria_nome, parcela, parcelas, origem, pedido_id}]` (inclui estorno pendente como saída prevista, não editável) |
| `fin_dre(p_inicio date, p_fim date)` | `{receita_bruta, receita_online, receita_balcao, deducoes, receita_liquida, cmv, cmv_estimado, lucro_bruto, custos_variaveis, margem_contribuicao, despesas_fixas, resultado_operacional, resultado_financeiro, lucro_liquido, linhas:[{grupo, categoria, valor}]}` |
| `fin_contas_listar()` | `[{id, nome, tipo, saldo_inicial, saldo_inicial_em, ativa, ordem, sistema, saldo}]` |
| `fin_categorias_listar()` | `[{id, nome, natureza, grupo_dre, ativa, sistema}]` |
| `fin_conta_salvar(p jsonb)` / `fin_categoria_salvar(p jsonb)` | `{id}` |
| `fin_lancamento_salvar(p jsonb)` — `{id?, tipo, valor, conta_id, conta_destino_id?, categoria_id?, descricao, forma_pagamento?, data_competencia, data_vencimento?, status: previsto\|realizado, data_realizacao?, parcelas?, observacao?}` | `{ids: uuid[]}` |
| `fin_lancamento_baixar(p_id uuid, p_data date DEFAULT NULL, p_conta_id uuid DEFAULT NULL)` / `fin_lancamento_cancelar(p_id uuid, p_motivo text)` | `{id, status}` |
| `fin_caixa_atual()` | `{id, conta_id, conta_nome, aberto_em, valor_abertura, vendas_dinheiro, devolucoes_dinheiro, entradas_manuais, saidas_manuais, esperado, movimentos:[...]}\|null` |
| `fin_caixa_abrir(p_valor_abertura numeric, p_conta_id uuid DEFAULT NULL)` | `{id}` |
| `fin_caixa_movimentar(p_tipo text, p_valor numeric, p_descricao text, p_conta_contrapartida uuid DEFAULT NULL)` — `sangria`/`suprimento` | `{id}` |
| `fin_caixa_fechar(p_valor_contado numeric, p_observacao text DEFAULT NULL)` | `{id, esperado, contado, diferenca}` |
| `fin_caixa_historico(p_limite int DEFAULT 30)` | `[{id, conta_nome, aberto_em, fechado_em, valor_abertura, esperado, contado, diferenca, status}]` |
| `assinatura_da_loja_ler()` | `{plano, status, valor_mensal, ciclo, inicio_em, proxima_cobranca_em, teste_ate, recursos[], gerenciar_url, suporte_whatsapp, atualizado_em}\|null` |

### CRM e Início (20261178000000)

| RPC (admin) | Retorno |
| --- | --- |
| `crm_visao(p_inicio date, p_fim date)` | `{kpis:{receita, receita_anterior, pedidos, pedidos_anterior, ticket_medio, ticket_medio_anterior, clientes_compradores, clientes_novos, taxa_recompra, receita_recorrente_pct, ltv_medio, receita_em_risco, taxa_devolucao}, canais:[{canal, receita, pedidos, ticket_medio}], formas:[{forma, receita, pedidos}], funil:{visitas, produtos_vistos, carrinhos, pedidos_criados, pedidos_pagos}, pipeline:[{status, quantidade, mais_antigo_em}], segmentos:[{segmento, clientes, receita}]}` |
| `crm_clientes(p_segmento text DEFAULT NULL, p_busca text DEFAULT NULL, p_limite int DEFAULT 50, p_offset int DEFAULT 0)` | `{total, clientes:[{chave, user_id, nome, whatsapp, email, pedidos, receita, ticket_medio, primeira_compra, ultima_compra, dias_sem_comprar, r, f, m, segmento, canal_preferido}]}` |
| `painel_inicio()` | `{hoje:{receita, online, presencial, pedidos, receita_semana_passada}, mes:{receita, receita_mes_anterior, pedidos, ticket_medio, lucro_estimado}, saldo_total, a_receber_7d, a_pagar_7d, contas_vencidas, pendencias:{pedidos_para_preparar, devolucoes_abertas, caixa_aberto, estoque_baixo}, serie_14d:[{dia, receita}]}` |

Segmentos (`segmento`): `campeoes, leais, ativos, novos, promissores, precisam_atencao,
quase_dormindo, em_risco, nao_pode_perder, hibernando`. R: ≤30→5, ≤60→4, ≤120→3, ≤240→2, >240→1
dias. F: 1→1, 2→2, 3→3, 4–5→4, ≥6→5 pedidos. M: quintil por `percent_rank`. FM = ⌊(F+M)/2⌋.

## Tarefas

| # | Tarefa | Arquivos | Risco |
| --- | --- | --- | --- |
| 1 | Migration devoluções + rollback + teste estático + prova viva (`tests/banco/devolucoes-viva.cjs`) | `supabase/migrations/20261175…`, `tests/` | RISCO |
| 2 | Migration cartão + rollback + teste estático + prova viva | `supabase/migrations/20261176…`, `tests/` | RISCO |
| 3 | Migration financeiro + rollback + teste + prova viva | `supabase/migrations/20261177…`, `tests/` | RISCO |
| 4 | Migration CRM/Início + rollback + teste + prova viva | `supabase/migrations/20261178…`, `tests/` | RISCO |
| 5 | Tipos à mão (`database.types.ts`) + tipos de domínio | `src/types/` | ROTINA |
| 6 | Edge: cartão em `criar-pagamento`, recusa libera a vaga no `webhook-mercadopago` e em `reconciliar-pagamentos` | `supabase/functions/` | RISCO |
| 7 | Edge: etiqueta reversa em `melhor-envio-etiqueta` (`gerar_devolucao_reversa`) | `supabase/functions/melhor-envio-etiqueta/` | RISCO |
| 8 | Front: cartão no checkout (Card Payment Brick, 3DS, recusa, trocar para PIX), interruptores no painel, CSP | `src/components/checkout/`, `CheckoutView.tsx`, `FormasDePagamentoCard.tsx`, `vercel.json` | RISCO |
| 9 | Front: devolução do cliente (pedido) + painel (lista, card no pedido, política) | `src/views/customer/OrderDetailsView.tsx`, `src/components/devolucao/`, `src/views/admin/AdminDevolucoesView.tsx`, `src/components/admin/orders/`, `src/components/admin/settings/` | ROTINA |
| 10 | Front: Início, CRM (dashboard antigo vira a aba Visão geral), Financeiro | `src/views/admin/`, `src/components/admin/{inicio,crm,financeiro}/`, `src/hooks/` | ROTINA |
| 11 | Rotas `admin-crm`, `admin-financeiro`, `admin-devolucoes` em todos os pontos do roteador | `src/App.tsx`, `src/types/index.ts`, `src/config/rotas.ts`, `scripts/hospedagem.mjs`, `AdminArea.tsx`, `pai-da-tela-do-admin.ts`, `usePrefetchOnHover.ts`, testes de contagem | ROTINA (arquivo compartilhado — serial) |
| 12 | Verificação completa + revisão independente (`revisor` e `revisor-risco`) + PR | — | — |
