-- 35m — MEDICAO, so leitura, de QUANTO do lucro do CRM > Visao geral era margem inventada: a venda de produto SEM
-- custo cadastrado (`produtos.custo IS NULL`) que o corpo antigo de `get_admin_analytics_v2` somava como lucro =
-- preco inteiro e que a migration 20261234000000 tira do lucro e do "Top 5 produtos mais lucrativos".
-- Molde da 18a/22m/32m: UM SELECT de ROL ABERTO, sem coluna `ok`; nunca e prova do portao da release. Quem decide
-- e a pessoa que le a tabela. Rodar nas duas lojas assinantes (IKCOUS e Savy), ANTES do apply, so para saber o
-- tamanho do que a correcao muda na tela; o apply nao muda nenhuma linha de produto, de pedido ou de cliente.
--
-- Saida: tipo | objeto | detalhe (detalhe = `chave=valor`, separado por `|`). Tipos, na ordem:
--   controle   quem leu (superusuario?, BYPASSRLS?) e se a RLS VALE para quem leu em marketplace_orders: com a RLS
--              valendo, toda contagem abaixo sai baixa e o numero nao e o da loja.
--   contagem   produtos nao apagados (total, com custo maior que zero, com custo ZERO medido, SEM custo) e, nas
--              vendas reconhecidas (pedido nao cancelado nem devolvido, cobranca paga ou recebida na entrega):
--              quantos produtos diferentes sem custo foram vendidos (o que o campo novo `productsWithoutCost`
--              devolve), as unidades e o valor dessas vendas (a margem que o corpo antigo inventava), e o lucro
--              real das vendas de produto com custo (o que o grafico passa a mostrar).
-- NENHUM DADO PESSOAL: so contagens e somas; nenhum nome de produto, nenhum id, nenhum cliente. O log do run e
-- legivel por quem le o repositorio: o que sai daqui e so agregado.
-- tests/ci_conferir_banco_test.ts prende essas regras no texto desta consulta.
WITH prod AS (
  SELECT p.custo
    FROM public.produtos p
   WHERE p.deleted_at IS NULL
), venda AS (
  SELECT p.id AS produto, p.custo, oi.quantity, oi.price
    FROM public.marketplace_order_items oi
    JOIN public.marketplace_orders o ON o.id = oi.order_id
    JOIN public.produtos p ON p.id = oi.product_id
   WHERE o.status NOT IN ('cancelled', 'returned')
     AND o.payment_status IN ('pago', 'pago_apos_expirar', 'recebido_na_entrega')
     AND p.deleted_at IS NULL
)
SELECT 'controle' AS tipo, 'quem leu' AS objeto,
       'superusuario=' || (SELECT rolsuper FROM pg_roles WHERE rolname = current_user)::text
       || '|bypassrls=' || (SELECT rolbypassrls FROM pg_roles WHERE rolname = current_user)::text
       || '|rls_vale_em_marketplace_orders=' || (SELECT (c.relrowsecurity AND NOT COALESCE(r.rolbypassrls, false) AND NOT COALESCE(r.rolsuper, false))::text
                                                  FROM pg_class c, pg_roles r
                                                 WHERE c.oid = 'public.marketplace_orders'::regclass AND r.rolname = current_user) AS detalhe
UNION ALL
SELECT 'contagem', 'produtos nao apagados', 'total=' || count(*)::text FROM prod
UNION ALL
SELECT 'contagem', 'produtos com custo maior que zero', 'total=' || count(*) FILTER (WHERE custo > 0)::text FROM prod
UNION ALL
SELECT 'contagem', 'produtos com custo ZERO medido (o brinde: conta como lucro)', 'total=' || count(*) FILTER (WHERE custo = 0)::text FROM prod
UNION ALL
SELECT 'contagem', 'produtos SEM custo (ausente: ficam fora do lucro e do ranking)', 'total=' || count(*) FILTER (WHERE custo IS NULL)::text FROM prod
UNION ALL
SELECT 'contagem', 'produtos sem custo com venda reconhecida (o campo productsWithoutCost)',
       'total=' || count(DISTINCT produto) FILTER (WHERE custo IS NULL)::text FROM venda
UNION ALL
SELECT 'contagem', 'unidades vendidas de produto sem custo',
       'total=' || COALESCE(sum(quantity) FILTER (WHERE custo IS NULL), 0)::text FROM venda
UNION ALL
SELECT 'contagem', 'valor vendido de produto sem custo (a margem inventada que sai do lucro)',
       'total=' || COALESCE(sum(quantity * price) FILTER (WHERE custo IS NULL), 0)::text FROM venda
UNION ALL
SELECT 'contagem', 'lucro das vendas de produto com custo (o que o grafico passa a mostrar)',
       'total=' || COALESCE(sum(quantity * (price - custo)) FILTER (WHERE custo IS NOT NULL), 0)::text FROM venda;
