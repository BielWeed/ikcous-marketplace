-- 34m — MEDICAO, so leitura, de QUANTOS pedidos de retirada na loja a loja tem e de quantos avisos o sino ja mandou
-- com o texto errado ("Pedido a caminho" / "Pedido entregue" num pedido que a cliente busca na loja). Molde da
-- 32m/18a/22m/27m: UM SELECT de ROL ABERTO, sem coluna `ok`; nunca e prova do portao da release. Quem decide e a
-- pessoa que le a tabela. Rodar nas duas lojas assinantes (IKCOUS e Savy), ANTES do apply, so para saber o tamanho
-- do que a correcao muda daqui para a frente; o apply NAO reescreve nenhuma notificacao (os avisos antigos ficam
-- como estao: sao historico da cliente) nem muda nenhuma linha de pedido.
--
-- Saida: tipo | objeto | detalhe (detalhe = `chave=valor`, separado por `|`). Tipos, na ordem:
--   controle   quem leu (superusuario?, BYPASSRLS?) e se a RLS VALE para quem leu em marketplace_orders: com a RLS
--              valendo, toda contagem abaixo sai baixa e o numero nao e o da loja.
--   contagem   pedidos (total), pedidos de retirada (id da opcao de entrega = 'store-pickup', o contrato novo), os
--              de retirada com conta (so esses recebem sino), os de retirada hoje em shipping/delivered, as DUAS
--              marcas da retirada (id e endereco da loja) fora de acordo (o esperado e 0 nas duas: a RPC grava as
--              duas juntas) e os avisos de sino JA gravados de pedido de retirada com o texto da entrega.
-- NENHUM DADO PESSOAL: so contagens; nenhum nome, nenhum numero, nenhum id. O log do run e legivel por quem le o
-- repositorio: o que sai daqui e so agregado.
-- tests/ci_conferir_banco_test.ts prende essas regras no texto desta consulta.
WITH o AS (
  SELECT m.id, m.user_id, m.status,
         COALESCE(m.customer_data ->> 'shipping_option_id', '') = 'store-pickup' AS por_id,
         COALESCE(m.customer_data ->> 'pickup_address', '') <> '' AS por_endereco
    FROM public.marketplace_orders m
)
SELECT 'controle' AS tipo, 'quem leu' AS objeto,
       'superusuario=' || (SELECT rolsuper FROM pg_roles WHERE rolname = current_user)::text
       || '|bypassrls=' || (SELECT rolbypassrls FROM pg_roles WHERE rolname = current_user)::text
       || '|rls_vale_em_marketplace_orders=' || (SELECT (c.relrowsecurity AND NOT COALESCE(r.rolbypassrls, false) AND NOT COALESCE(r.rolsuper, false))::text
                                                    FROM pg_class c, pg_roles r
                                                   WHERE c.oid = 'public.marketplace_orders'::regclass AND r.rolname = current_user) AS detalhe
UNION ALL
SELECT 'contagem', 'pedidos', 'total=' || count(*)::text FROM o
UNION ALL
SELECT 'contagem', 'pedidos de retirada (id store-pickup)', 'total=' || count(*) FILTER (WHERE por_id)::text FROM o
UNION ALL
SELECT 'contagem', 'pedidos de retirada com conta (recebem sino)', 'total=' || count(*) FILTER (WHERE por_id AND user_id IS NOT NULL)::text FROM o
UNION ALL
SELECT 'contagem', 'pedidos de retirada hoje em shipping (pronto para retirar)', 'total=' || count(*) FILTER (WHERE por_id AND status = 'shipping')::text FROM o
UNION ALL
SELECT 'contagem', 'pedidos de retirada hoje em delivered (retirado)', 'total=' || count(*) FILTER (WHERE por_id AND status = 'delivered')::text FROM o
UNION ALL
SELECT 'contagem', 'id store-pickup SEM o endereco da loja (esperado 0)', 'total=' || count(*) FILTER (WHERE por_id AND NOT por_endereco)::text FROM o
UNION ALL
SELECT 'contagem', 'endereco da loja SEM o id store-pickup (esperado 0)', 'total=' || count(*) FILTER (WHERE por_endereco AND NOT por_id)::text FROM o
UNION ALL
SELECT 'contagem', 'avisos do sino de pedido de retirada com o texto da entrega (ficam como estao)',
       'total=' || (SELECT count(*) FROM public.notificacoes n
                      JOIN o ON o.id::text = n.dados ->> 'order_id'
                     WHERE o.por_id AND n.titulo IN ('Pedido a caminho', 'Pedido entregue'))::text;
