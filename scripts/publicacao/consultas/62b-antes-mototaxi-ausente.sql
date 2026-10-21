-- Somente catalogo. Rol fechado: 3 linhas; exige objetos novos AUSENTES.
-- Rollback conserva tabela, entao nao equivale a ausencia nem autoriza apply automatico.
WITH itens(item, esperado, vivo) AS (
  SELECT 'controle: catalogo publico visivel', 'sim', CASE WHEN EXISTS (SELECT 1 FROM pg_class WHERE relnamespace = 'public'::regnamespace) THEN 'sim' ELSE 'nao' END
  UNION ALL SELECT 'mototaxi: tabela e RPC ausentes', 'sim', CASE WHEN
    to_regclass('public.config_mototaxi') IS NULL
    AND NOT EXISTS (SELECT 1 FROM pg_proc WHERE pronamespace = 'public'::regnamespace AND proname = 'salvar_config_mototaxi')
    THEN 'sim' ELSE 'nao' END
  UNION ALL SELECT 'contato privado: fora da configuracao publica', 'sim', CASE WHEN
    to_regclass('public.v_store_config') IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid IN (to_regclass('public.v_store_config'), to_regclass('public.store_config'))
      AND attname ILIKE '%mototaxi%' AND NOT attisdropped)
    THEN 'sim' ELSE 'nao' END
)
SELECT item, esperado, vivo, COALESCE(vivo = esperado, false) AS ok FROM itens ORDER BY ok, item;
