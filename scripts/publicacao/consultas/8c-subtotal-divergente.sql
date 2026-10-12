-- 8c — Pedidos cuja soma dos itens NÃO bate com o `subtotal` gravado (a
-- conferência O2 da 20261202: antes dela o dono do pedido podia INSERIR/ALTERAR
-- itens direto pela RLS; depois, só o admin de agora escreve neles).
-- SÓ LEITURA, um único SELECT, só agregados: nenhum id de pedido sai daqui.
--
-- A FÓRMULA E DE ONDE VEM (não foi inventada): quem GRAVA `subtotal` é a RPC de
-- criação do pedido — `v_calculated_subtotal := v_calculated_subtotal +
-- (v_db_price * v_quantity)` e, no mesmo laço, o item é inserido com
-- `price = v_db_price, quantity = v_quantity`
-- (supabase/migrations/20260951000000_frete_do_pedido_e_do_proprio_carrinho.sql
-- linhas 125 e 317; a mesma conta no baseline 20260806000000 e em
-- `registrar_venda_presencial`, 20261199000000 linha 2714). Logo, para um pedido
-- que nasceu por essas RPCs:
--     marketplace_orders.subtotal = SUM(quantity * price) dos seus itens,
-- sem frete e sem desconto (esses são colunas à parte). A 20261202 e a
-- "REVISAO" citada no pedido NÃO escrevem essa regra — só o código acima a
-- define; esta consulta é a transcrição dele. numeric(10,2) dos dois lados, a
-- comparação é exata.
--
-- LIMITE HONESTO: pedido criado por uma versão ANTIGA da RPC, por edição manual
-- no painel do Supabase ou por importação pode divergir sem ter havido
-- adulteração; a contagem diz QUANTOS divergem, não POR QUÊ — olhar cada caso é
-- decisão de quem lê.
--
-- Saída: item | esperado | vivo | ok (ok = false primeiro). Os controles de
-- visibilidade (pedidos e itens vistos por este papel) têm de ser > 0; um papel
-- que a RLS deixa cego veria 0 divergentes sem ter olhado nada.
WITH soma AS (
  SELECT o.id, o.subtotal,
         COALESCE(SUM(oi.quantity * oi.price), 0) AS soma_itens,
         count(oi.id) AS n_itens
    FROM public.marketplace_orders o
    LEFT JOIN public.marketplace_order_items oi ON oi.order_id = o.id
   GROUP BY o.id, o.subtotal
), r(item, esperado, vivo) AS (
  SELECT 'controle: pedidos visiveis', '>0',
         CASE WHEN count(*) > 0 THEN '>0' ELSE '0' END
    FROM soma
  UNION ALL
  SELECT 'controle: itens de pedido visiveis', '>0',
         CASE WHEN (SELECT count(*) FROM public.marketplace_order_items) > 0 THEN '>0' ELSE '0' END
  UNION ALL
  SELECT 'pedidos com soma dos itens diferente do subtotal', '0',
         (count(*) FILTER (WHERE subtotal IS DISTINCT FROM soma_itens))::text
    FROM soma
  UNION ALL
  SELECT '  dos quais sem nenhum item', '0',
         (count(*) FILTER (WHERE subtotal IS DISTINCT FROM soma_itens AND n_itens = 0))::text
    FROM soma
)
SELECT item, esperado, vivo, COALESCE(vivo = esperado, false) AS ok
  FROM r
 ORDER BY ok, item;
