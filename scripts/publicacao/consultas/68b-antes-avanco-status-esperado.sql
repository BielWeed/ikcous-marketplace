-- ANTES da 345 ou apos rollback. Somente catalogo, rol fechado de quatro linhas.
WITH itens(item,esperado,vivo) AS (
 SELECT 'controle: catalogo de funcoes public visivel','sim',
   CASE WHEN EXISTS(SELECT 1 FROM pg_proc WHERE pronamespace=to_regnamespace('public')) THEN 'sim' ELSE 'nao' END
 UNION ALL
 SELECT 'avancar_status_do_pedido: nenhuma assinatura existente','sim',
   CASE WHEN NOT EXISTS(SELECT 1 FROM pg_proc WHERE pronamespace=to_regnamespace('public')
     AND proname='avancar_status_do_pedido') THEN 'sim' ELSE 'nao' END
 UNION ALL
 SELECT 'marketplace_orders.id: uuid','sim',
   CASE WHEN EXISTS(SELECT 1 FROM pg_attribute WHERE attrelid=to_regclass('public.marketplace_orders')
     AND attname='id' AND atttypid='uuid'::regtype AND NOT attisdropped) THEN 'sim' ELSE 'nao' END
 UNION ALL
 SELECT 'dependencias: admin atual e rotina de status presentes','sim',
   CASE WHEN to_regprocedure('public.is_admin_atual()') IS NOT NULL
     AND to_regprocedure('public.pedido__mudar_status(uuid,text,text,uuid,boolean,boolean)') IS NOT NULL
     AND to_regprocedure('public.update_order_status_atomic(uuid,text,text,boolean)') IS NOT NULL
     THEN 'sim' ELSE 'nao' END
)
SELECT item,esperado,vivo,vivo=esperado AS ok FROM itens ORDER BY ok,item;
