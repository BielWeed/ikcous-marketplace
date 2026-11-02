-- 117b-antes-as-visitas-da-loja-contam-pelo-porteiro-ausente: ANTES da 20261399000000 (ou depois do rollback-manual-destrutivo dela). SO LEITURA,
-- somente catalogo, rol fechado de 4 linhas. Nao le nenhuma linha. O rollback-manual COMUM mantem a tabela (e a contagem): depois dele a linha dos
-- objetos novos fica "nao" de proposito e so o destrutivo apaga a tabela.
WITH itens(item, esperado, vivo) AS (
  SELECT 'controle: catalogo publico visivel', 'sim', CASE WHEN EXISTS (SELECT 1 FROM pg_class WHERE relnamespace = 'public'::regnamespace) THEN 'sim' ELSE 'nao' END
  UNION ALL SELECT 'visitas_por_dia, contar_entrada e crm_visitas: ainda NAO existem', 'sim', CASE WHEN
    to_regclass('public.visitas_por_dia') IS NULL
    AND NOT EXISTS (SELECT 1 FROM pg_proc WHERE pronamespace = 'public'::regnamespace AND proname IN ('contar_entrada', 'crm_visitas')) THEN 'sim' ELSE 'nao' END
  UNION ALL SELECT 'fin__hoje() devolve date e is_admin() e is_admin_atual() devolvem boolean', 'sim', CASE WHEN
    (SELECT count(*) FROM pg_proc p
      WHERE p.oid IN (to_regprocedure('public.fin__hoje()'), to_regprocedure('public.is_admin()'), to_regprocedure('public.is_admin_atual()'))
        AND ((p.proname = 'fin__hoje' AND p.prorettype = 'date'::regtype)
          OR (p.proname IN ('is_admin', 'is_admin_atual') AND p.prorettype = 'boolean'::regtype))) = 3 THEN 'sim' ELSE 'nao' END
  UNION ALL SELECT 'os papeis anon, authenticated e service_role existem', 'sim', CASE WHEN
    (SELECT count(*) FROM pg_roles WHERE rolname IN ('anon', 'authenticated', 'service_role')) = 3 THEN 'sim' ELSE 'nao' END
)
SELECT item, esperado, vivo, COALESCE(vivo = esperado, false) AS ok FROM itens ORDER BY ok, item;
