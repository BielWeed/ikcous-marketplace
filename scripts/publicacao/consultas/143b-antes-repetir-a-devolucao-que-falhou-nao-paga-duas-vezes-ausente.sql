-- 143b-antes-repetir-a-devolucao-que-falhou-nao-paga-duas-vezes-ausente: ANTES da 20261399991000 (ou depois do rollback-manual dela). SO LEITURA, somente catalogo,
-- rol fechado de 4 linhas. Nao le nenhuma devolucao, pedido ou marca. Antes do apply tudo "sim"; depois do apply a linha dos objetos novos fica "nao" de proposito.
WITH itens(item, esperado, vivo) AS (
  SELECT 'controle: catalogo publico visivel', 'sim', CASE WHEN EXISTS (SELECT 1 FROM pg_class WHERE relnamespace = 'public'::regnamespace) THEN 'sim' ELSE 'nao' END
  UNION ALL SELECT 'solicitar_estorno_repetindo e order_refund_repeticao: ainda NAO existem', 'sim', CASE WHEN
    NOT EXISTS (SELECT 1 FROM pg_proc WHERE pronamespace = 'public'::regnamespace AND proname = 'solicitar_estorno_repetindo')
    AND to_regclass('public.order_refund_repeticao') IS NULL THEN 'sim' ELSE 'nao' END
  UNION ALL SELECT 'order_refund__pode_ter_saido e pedido__saldo_a_estornar: corpo da 20261241000000 (md5), o que a funcao nova chama', 'sim', CASE WHEN
    COALESCE((SELECT md5(replace(prosrc, chr(13), '')) FROM pg_proc WHERE oid = to_regprocedure('public.order_refund__pode_ter_saido(uuid)')), '') = 'bdbb28b3d91588c8b10283d57bfb73d6'
    AND COALESCE((SELECT md5(replace(prosrc, chr(13), '')) FROM pg_proc WHERE oid = to_regprocedure('public.pedido__saldo_a_estornar(uuid)')), '') = '99741b4cdbf1e8d8340f80440e6da094' THEN 'sim' ELSE 'nao' END
  UNION ALL SELECT 'is_admin() e is_admin_atual() existem; order_refund_prova existe e devolucoes tem refund_id (uuid)', 'sim', CASE WHEN
    to_regprocedure('public.is_admin()') IS NOT NULL AND to_regprocedure('public.is_admin_atual()') IS NOT NULL
    AND to_regclass('public.order_refund_prova') IS NOT NULL
    AND EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = to_regclass('public.devolucoes') AND attname = 'refund_id' AND atttypid = 'uuid'::regtype AND NOT attisdropped) THEN 'sim' ELSE 'nao' END
)
SELECT item, esperado, vivo, COALESCE(vivo = esperado, false) AS ok FROM itens ORDER BY ok, item;
