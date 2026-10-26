-- 95b-antes-o-frete-tem-limite-de-cotacoes-ausente: ANTES da 20261389000000 (ou depois do rollback-manual dela). SO LEITURA, somente catalogo,
-- rol fechado de 3 linhas. Nao le nenhuma linha. A migration so cria objetos novos: a 95b prova que eles ainda NAO existem e que os tres
-- papeis de fabrica do Supabase, que o REVOKE/GRANT dela cita, existem.
WITH itens(item, esperado, vivo) AS (
  SELECT 'controle: catalogo publico visivel', 'sim', CASE WHEN EXISTS (SELECT 1 FROM pg_class WHERE relnamespace = 'public'::regnamespace) THEN 'sim' ELSE 'nao' END
  UNION ALL SELECT 'frete_cota_por_origem e frete_consumir_cota: ainda NAO existem', 'sim', CASE WHEN
    to_regclass('public.frete_cota_por_origem') IS NULL
    AND NOT EXISTS (SELECT 1 FROM pg_proc WHERE pronamespace = 'public'::regnamespace AND proname = 'frete_consumir_cota') THEN 'sim' ELSE 'nao' END
  UNION ALL SELECT 'os papeis anon, authenticated e service_role existem (o REVOKE e o GRANT da migration citam os tres)', 'sim', CASE WHEN
    (SELECT count(*) FROM pg_roles WHERE rolname IN ('anon', 'authenticated', 'service_role')) = 3 THEN 'sim' ELSE 'nao' END
)
SELECT item, esperado, vivo, COALESCE(vivo = esperado, false) AS ok FROM itens ORDER BY ok, item;
