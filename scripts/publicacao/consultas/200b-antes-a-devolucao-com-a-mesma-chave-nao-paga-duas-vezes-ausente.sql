-- 200b-antes-a-devolucao-com-a-mesma-chave-nao-paga-duas-vezes-ausente: ANTES da 20261640000000. SO LEITURA, somente catalogo, rol fechado de 4 linhas. Nao le nenhuma
-- devolucao nem pedido. Antes do apply tudo "sim"; depois do apply (ou do rollback COMUM, que mantem a coluna e o indice) a linha dos objetos novos fica "nao" de proposito.
WITH itens(item, esperado, vivo) AS (
  SELECT 'controle: catalogo publico visivel', 'sim', CASE WHEN EXISTS (SELECT 1 FROM pg_class WHERE relnamespace = 'public'::regnamespace) THEN 'sim' ELSE 'nao' END
  UNION ALL SELECT 'solicitar_estorno_com_chave, order_refunds.chave_da_solicitacao e uq_order_refunds_chave_da_solicitacao: ainda NAO existem', 'sim', CASE WHEN
    NOT EXISTS (SELECT 1 FROM pg_proc WHERE pronamespace = 'public'::regnamespace AND proname = 'solicitar_estorno_com_chave')
    AND NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = to_regclass('public.order_refunds') AND attname = 'chave_da_solicitacao' AND NOT attisdropped)
    AND to_regclass('public.uq_order_refunds_chave_da_solicitacao') IS NULL THEN 'sim' ELSE 'nao' END
  UNION ALL SELECT 'pedido__saldo_a_estornar: corpo da 20261241000000 (md5), a conta que a funcao nova chama', 'sim', CASE WHEN
    COALESCE((SELECT md5(replace(prosrc, chr(13), '')) FROM pg_proc WHERE oid = to_regprocedure('public.pedido__saldo_a_estornar(uuid)')), '') = '99741b4cdbf1e8d8340f80440e6da094' THEN 'sim' ELSE 'nao' END
  UNION ALL SELECT 'is_admin() e is_admin_atual() existem; order_refunds e marketplace_orders tem as colunas que a funcao nova le', 'sim', CASE WHEN
    to_regprocedure('public.is_admin()') IS NOT NULL AND to_regprocedure('public.is_admin_atual()') IS NOT NULL
    AND (SELECT count(*) FROM pg_attribute a WHERE a.attrelid = to_regclass('public.order_refunds') AND NOT a.attisdropped
          AND ((a.attname = 'id' AND a.atttypid = 'uuid'::regtype) OR (a.attname = 'order_id' AND a.atttypid = 'uuid'::regtype)
            OR (a.attname = 'amount' AND a.atttypid = 'numeric'::regtype) OR (a.attname = 'motivo' AND a.atttypid = 'text'::regtype)
            OR (a.attname = 'solicitado_por' AND a.atttypid = 'text'::regtype))) = 5
    AND (SELECT count(*) FROM pg_attribute a WHERE a.attrelid = to_regclass('public.marketplace_orders') AND NOT a.attisdropped
          AND ((a.attname = 'status' AND a.atttypid = 'text'::regtype) OR (a.attname = 'payment_status' AND a.atttypid = 'text'::regtype)
            OR (a.attname = 'cancelled_after_shipping' AND a.atttypid = 'boolean'::regtype)
            OR (a.attname = 'returned_to_seller_at' AND a.atttypid = 'timestamp with time zone'::regtype))) = 4 THEN 'sim' ELSE 'nao' END
)
SELECT item, esperado, vivo, COALESCE(vivo = esperado, false) AS ok FROM itens ORDER BY ok, item;
