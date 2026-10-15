-- 44m — MEDICAO, so leitura, de quanto os numeros do painel ficam enganosos por causa de pedido de R$ 0,00 (cupom
-- que zera a compra) e de DESCONTO em geral. Pergunta do coordenador (15/10/2026): vale corrigir? Nenhuma migration
-- nasce desta consulta sem a tabela lida antes.
-- Molde da 18a/22m/27m/32m/35m/42m: UM SELECT de ROL ABERTO, sem coluna `ok`; nunca e prova do portao da release.
-- Quem decide e a pessoa que le a tabela. Rodar nas duas lojas assinantes (IKCOUS e Savy), uma loja por run, por
-- conferir-banco-da-loja.yml (papel `supabase_read_only_user`).
--
-- REGRA DO PAINEL (texto IDENTICO ao de `get_admin_analytics_v2`, corpo vigente da 20261234000000, linhas 359-366;
-- tests/ci_conferir_banco_test.ts prende os dois textos):
--   pedido no painel = o.status NOT IN ('cancelled', 'returned')
--                      AND (o.payment_status IN ('pago', 'pago_apos_expirar', 'recebido_na_entrega'));
--   lucro do painel  = SUM(oi.quantity * (oi.price - p.custo)) FILTER (WHERE p.custo IS NOT NULL), itens ligados por
--                      JOIN em produtos (sem filtro de produto apagado, como o grafico); o desconto do pedido NAO e
--                      rateado: o lucro e calculado no preco de lista do item.
-- SUPERESTIMACAO = o desconto que o pedido concedeu (LEAST(discount, subtotal), o mesmo teto da
-- create_marketplace_order_v24), somado nos pedidos do painel com desconto > 0, sobre o lucro do painel. Sai em duas
-- leituras: o desconto INTEIRO (teto) e o desconto RATEADO so aos itens com custo (o que de fato sai do lucro, porque
-- item sem custo ja esta fora do lucro). Janela por created_at, como o grafico: 30 dias, 90 dias e total.
-- REGRA DE CLIENTE (texto IDENTICO a `crm__vendas`, 20261178000000:52-75): venda reconhecida = payment_status
-- reconhecido, status fora de cancelled/returned e COALESCE(pagamento_recebido_em, paid_at) preenchido; a chave da
-- cliente = conta, senao a conta dona do mesmo WhatsApp, senao 'wa:' + digitos do WhatsApp. Venda sem chave fica fora
-- do CRM (a linha `c_sem_chave` conta quantas de R$ 0 ficam assim).
--
-- Saida: tipo | objeto | detalhe (detalhe = `chave=valor`, separado por `|`). Tipos, na ordem:
--   controle    quem leu (superusuario?, BYPASSRLS?) e se a RLS VALE para quem leu nas 3 tabelas lidas (com a RLS
--               valendo, tudo sai baixo e o numero nao e o da loja); a coerencia do desconto gravado
--               (subtotal + frete - desconto contra o total) e quantos pedidos tem desconto maior que o subtotal.
--   a_zero      por janela (90 dias, total): pedidos nascidos, quantos de R$ 0, quantos de R$ 0 entregues,
--               cancelados, no painel.
--   a_pagto     pedidos de R$ 0 por janela x payment_status (lista fechada da CHECK + nulo + outro): nascidos e
--               entregues.
--   a_canal     pedidos de R$ 0 por janela x canal (online, presencial, outro): nascidos e entregues.
--   a_cliente   clientes do CRM cuja UNICA compra reconhecida e de R$ 0, e cujas compras sao TODAS de R$ 0.
--   b_desconto  por janela (30 dias, 90 dias, total): pedidos no painel, com desconto, soma do desconto concedido,
--               lucro do painel desses pedidos e de todos, o desconto rateado aos itens com custo, a superestimacao
--               em porcento (desconto / lucro de todos), e os pedidos de R$ 0 no painel com o lucro que mostram.
--   c_novo      clientes do CRM cujo PRIMEIRO pedido reconhecido e de R$ 0: total e com a primeira compra nos
--               ultimos 30 e 90 dias, ao lado dos clientes novos do mesmo periodo (o denominador).
--   c_sem_chave vendas reconhecidas de R$ 0 sem chave de cliente (fora do CRM).
--   d_nulo      pedidos de R$ 0 ENTREGUES com payment_status nulo (fora de todo numero do painel e no sino de
--               recebimentos por marcar), por janela.
-- NENHUM DADO PESSOAL: so contagens, somas e porcentagens; nenhum id de pedido, de conta ou de produto, nenhum nome,
-- e-mail, telefone ou WhatsApp sai no log. A conta e o WhatsApp so entram no bloco `base` para montar a chave da
-- cliente, que so aparece dentro de count(). O log do run e legivel por quem le o repositorio.
-- tests/ci_conferir_banco_test.ts prende essas regras no texto desta consulta.
WITH janelas AS (
  SELECT j, i, n FROM (VALUES ('30 dias', interval '30 days', 1),
                              ('90 dias', interval '90 days', 2),
                              ('total', NULL::interval, 3)) v(j, i, n)
), ped AS (
  SELECT o.id AS pedido,
         o.created_at,
         o.status,
         CASE WHEN o.payment_status IS NULL THEN 'nulo'
              WHEN o.payment_status IN ('aguardando', 'pago', 'recusado', 'expirado', 'estornado', 'pago_apos_expirar', 'recebido_na_entrega') THEN o.payment_status
              ELSE 'outro' END AS pagto,
         CASE WHEN o.canal IN ('online', 'presencial') THEN o.canal ELSE 'outro' END AS canal,
         (o.total = 0) AS zero
    FROM public.marketplace_orders o
), item AS (
  SELECT oi.order_id AS pedido,
         COALESCE(SUM(oi.quantity * (oi.price - p.custo)) FILTER (WHERE p.custo IS NOT NULL), 0) AS lucro_painel,
         COALESCE(SUM(oi.quantity * oi.price) FILTER (WHERE p.custo IS NOT NULL), 0) AS venda_com_custo,
         COALESCE(SUM(oi.quantity * oi.price), 0) AS venda_itens
    FROM public.marketplace_order_items oi
    JOIN public.produtos p ON oi.product_id = p.id
   GROUP BY oi.order_id
), painel AS (
  SELECT o.id AS pedido,
         o.created_at,
         (o.total = 0) AS zero,
         LEAST(GREATEST(COALESCE(o.discount, 0), 0), GREATEST(o.subtotal, 0)) AS desconto_concedido,
         COALESCE(i.lucro_painel, 0) AS lucro_painel,
         CASE WHEN COALESCE(i.venda_itens, 0) > 0
              THEN LEAST(GREATEST(COALESCE(o.discount, 0), 0), GREATEST(o.subtotal, 0)) * i.venda_com_custo / i.venda_itens
              ELSE 0 END AS desconto_rateado
    FROM public.marketplace_orders o
    LEFT JOIN item i ON i.pedido = o.id
   WHERE o.status NOT IN ('cancelled', 'returned')
     AND (o.payment_status IN ('pago', 'pago_apos_expirar', 'recebido_na_entrega'))
), base AS (
  SELECT o.id AS pedido,
         o.total,
         o.user_id AS conta,
         COALESCE(o.pagamento_recebido_em, o.paid_at) AS pago_em,
         NULLIF(regexp_replace(COALESCE(o.customer_data ->> 'whatsapp', ''), '\D', '', 'g'), '') AS wa
    FROM public.marketplace_orders o
   WHERE o.payment_status IN ('pago', 'pago_apos_expirar', 'recebido_na_entrega')
     AND o.status NOT IN ('cancelled', 'returned')
     AND COALESCE(o.pagamento_recebido_em, o.paid_at) IS NOT NULL
     AND COALESCE(o.pagamento_recebido_em, o.paid_at) <= now()
), wa_da_conta AS (
  SELECT DISTINCT ON (b.wa) b.wa, b.conta
    FROM base b
   WHERE b.wa IS NOT NULL AND b.conta IS NOT NULL
   ORDER BY b.wa, b.pago_em DESC
), crm AS (
  SELECT b.pedido,
         b.total,
         b.pago_em,
         COALESCE(b.conta::text, w.conta::text, CASE WHEN b.wa IS NOT NULL THEN 'wa:' || b.wa END) AS chave
    FROM base b
    LEFT JOIN wa_da_conta w ON w.wa = b.wa AND b.conta IS NULL
), cliente AS (
  SELECT c.chave,
         count(*) AS compras,
         count(*) FILTER (WHERE c.total = 0) AS compras_zero,
         min(c.pago_em) AS primeira,
         (array_agg(c.total ORDER BY c.pago_em, c.pedido))[1] AS total_da_primeira
    FROM crm c
   WHERE c.chave IS NOT NULL
   GROUP BY c.chave
), pagtos AS (
  SELECT s FROM (VALUES ('aguardando'), ('pago'), ('recusado'), ('expirado'), ('estornado'), ('pago_apos_expirar'),
                        ('recebido_na_entrega'), ('nulo'), ('outro')) v(s)
), canais AS (
  SELECT c FROM (VALUES ('online'), ('presencial'), ('outro')) v(c)
), r AS (
  SELECT 0 AS ordem, 'controle' AS tipo, 'quem leu' AS objeto,
         'superusuario=' || (SELECT rolsuper FROM pg_roles WHERE rolname = current_user)::text
         || '|bypassrls=' || (SELECT rolbypassrls FROM pg_roles WHERE rolname = current_user)::text
         || '|rls_vale_em_marketplace_orders=' || (SELECT (c.relrowsecurity AND NOT COALESCE(a.rolbypassrls, false) AND NOT COALESCE(a.rolsuper, false))::text
                                                    FROM pg_class c, pg_roles a
                                                   WHERE c.oid = 'public.marketplace_orders'::regclass AND a.rolname = current_user)
         || '|rls_vale_em_marketplace_order_items=' || (SELECT (c.relrowsecurity AND NOT COALESCE(a.rolbypassrls, false) AND NOT COALESCE(a.rolsuper, false))::text
                                                         FROM pg_class c, pg_roles a
                                                        WHERE c.oid = 'public.marketplace_order_items'::regclass AND a.rolname = current_user)
         || '|rls_vale_em_produtos=' || (SELECT (c.relrowsecurity AND NOT COALESCE(a.rolbypassrls, false) AND NOT COALESCE(a.rolsuper, false))::text
                                          FROM pg_class c, pg_roles a
                                         WHERE c.oid = 'public.produtos'::regclass AND a.rolname = current_user) AS detalhe
  UNION ALL
  SELECT 0, 'controle', 'coerencia do desconto gravado (pedidos com desconto > 0)',
         'pedidos_com_desconto=' || count(*) FILTER (WHERE COALESCE(o.discount, 0) > 0)::text
         || '|total_bate_com_subtotal_mais_frete_menos_desconto=' || count(*) FILTER (WHERE COALESCE(o.discount, 0) > 0
                AND abs(GREATEST(0, o.subtotal + COALESCE(o.shipping, 0) - o.discount) - o.total) <= 0.05)::text
         || '|desconto_maior_que_o_subtotal=' || count(*) FILTER (WHERE COALESCE(o.discount, 0) > o.subtotal)::text
         || '|total_zero_sem_desconto=' || count(*) FILTER (WHERE o.total = 0 AND COALESCE(o.discount, 0) <= 0)::text
    FROM public.marketplace_orders o
  UNION ALL
  SELECT 1, 'a_zero', j.j,
         'pedidos_nascidos=' || count(p.pedido)::text
         || '|de_zero=' || count(p.pedido) FILTER (WHERE p.zero)::text
         || '|de_zero_entregues=' || count(p.pedido) FILTER (WHERE p.zero AND p.status = 'delivered')::text
         || '|de_zero_cancelados=' || count(p.pedido) FILTER (WHERE p.zero AND p.status = 'cancelled')::text
         || '|de_zero_no_painel=' || count(p.pedido) FILTER (WHERE p.zero AND p.status NOT IN ('cancelled', 'returned')
                                                              AND p.pagto IN ('pago', 'pago_apos_expirar', 'recebido_na_entrega'))::text
    FROM janelas j
    LEFT JOIN ped p ON (j.i IS NULL OR p.created_at >= now() - j.i)
   WHERE j.n >= 2
   GROUP BY j.j, j.n
  UNION ALL
  SELECT 2, 'a_pagto', j.j || ' | ' || s.s,
         'de_zero=' || count(p.pedido)::text
         || '|de_zero_entregues=' || count(p.pedido) FILTER (WHERE p.status = 'delivered')::text
    FROM janelas j
    CROSS JOIN pagtos s
    LEFT JOIN ped p ON p.zero AND p.pagto = s.s AND (j.i IS NULL OR p.created_at >= now() - j.i)
   WHERE j.n >= 2
   GROUP BY j.j, s.s
  UNION ALL
  SELECT 3, 'a_canal', j.j || ' | ' || k.c,
         'de_zero=' || count(p.pedido)::text
         || '|de_zero_entregues=' || count(p.pedido) FILTER (WHERE p.status = 'delivered')::text
    FROM janelas j
    CROSS JOIN canais k
    LEFT JOIN ped p ON p.zero AND p.canal = k.c AND (j.i IS NULL OR p.created_at >= now() - j.i)
   WHERE j.n >= 2
   GROUP BY j.j, k.c
  UNION ALL
  SELECT 4, 'a_cliente', 'clientes do CRM',
         'clientes=' || count(*)::text
         || '|unica_compra_e_de_zero=' || count(*) FILTER (WHERE compras = 1 AND compras_zero = 1)::text
         || '|todas_as_compras_de_zero=' || count(*) FILTER (WHERE compras = compras_zero)::text
    FROM cliente
  UNION ALL
  SELECT 5, 'b_desconto', j.j,
         'pedidos_no_painel=' || count(pn.pedido)::text
         || '|com_desconto=' || count(pn.pedido) FILTER (WHERE pn.desconto_concedido > 0)::text
         || '|soma_desconto_concedido=' || COALESCE(sum(pn.desconto_concedido) FILTER (WHERE pn.desconto_concedido > 0), 0)::text
         || '|soma_desconto_rateado_aos_itens_com_custo=' || round(COALESCE(sum(pn.desconto_rateado) FILTER (WHERE pn.desconto_concedido > 0), 0), 2)::text
         || '|lucro_painel_dos_com_desconto=' || COALESCE(sum(pn.lucro_painel) FILTER (WHERE pn.desconto_concedido > 0), 0)::text
         || '|lucro_painel_de_todos=' || COALESCE(sum(pn.lucro_painel), 0)::text
         || '|superestimacao_pct_desconto_inteiro=' || COALESCE(round(100 * sum(pn.desconto_concedido) FILTER (WHERE pn.desconto_concedido > 0)
                                                                        / NULLIF(sum(pn.lucro_painel), 0), 1)::text, 'sem_lucro')
         || '|superestimacao_pct_desconto_rateado=' || COALESCE(round(100 * sum(pn.desconto_rateado) FILTER (WHERE pn.desconto_concedido > 0)
                                                                        / NULLIF(sum(pn.lucro_painel), 0), 1)::text, 'sem_lucro')
         || '|pedidos_de_zero_no_painel=' || count(pn.pedido) FILTER (WHERE pn.zero)::text
         || '|lucro_painel_dos_pedidos_de_zero=' || COALESCE(sum(pn.lucro_painel) FILTER (WHERE pn.zero), 0)::text
    FROM janelas j
    LEFT JOIN painel pn ON (j.i IS NULL OR pn.created_at >= now() - j.i)
   GROUP BY j.j, j.n
  UNION ALL
  SELECT 6, 'c_novo', j.j,
         'clientes_novos=' || count(cl.chave)::text
         || '|primeiro_pedido_de_zero=' || count(cl.chave) FILTER (WHERE cl.total_da_primeira = 0)::text
    FROM janelas j
    LEFT JOIN cliente cl ON (j.i IS NULL OR cl.primeira >= now() - j.i)
   GROUP BY j.j, j.n
  UNION ALL
  SELECT 7, 'c_sem_chave', 'vendas reconhecidas de zero reais sem chave de cliente',
         'vendas=' || count(*) FILTER (WHERE c.total = 0 AND c.chave IS NULL)::text
         || '|vendas_de_zero=' || count(*) FILTER (WHERE c.total = 0)::text
    FROM crm c
  UNION ALL
  SELECT 8, 'd_nulo', j.j,
         'de_zero_entregues=' || count(p.pedido) FILTER (WHERE p.zero AND p.status = 'delivered')::text
         || '|desses_com_payment_status_nulo=' || count(p.pedido) FILTER (WHERE p.zero AND p.status = 'delivered' AND p.pagto = 'nulo')::text
         || '|entregues_com_payment_status_nulo_qualquer_valor=' || count(p.pedido) FILTER (WHERE p.status = 'delivered' AND p.pagto = 'nulo')::text
    FROM janelas j
    LEFT JOIN ped p ON (j.i IS NULL OR p.created_at >= now() - j.i)
   WHERE j.n >= 2
   GROUP BY j.j, j.n
)
SELECT tipo, objeto, detalhe
  FROM r
 ORDER BY ordem, objeto, detalhe;
