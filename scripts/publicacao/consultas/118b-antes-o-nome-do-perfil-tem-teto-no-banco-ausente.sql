-- 118b-antes-o-nome-do-perfil-tem-teto-no-banco-ausente: ANTES da 20261399100000 (ou depois do rollback-manual dela). SO LEITURA, somente catalogo,
-- rol fechado de 3 linhas. Nao le nenhum perfil. Antes do apply tudo "sim"; depois do apply a linha dos CHECKs fica "nao" de proposito.
WITH itens(item, esperado, vivo) AS (
  SELECT 'controle: catalogo publico visivel', 'sim', CASE WHEN EXISTS (SELECT 1 FROM pg_class WHERE relnamespace = 'public'::regnamespace) THEN 'sim' ELSE 'nao' END
  UNION ALL SELECT 'profiles.full_name, profiles.whatsapp e public_profiles.full_name sao text e nenhum dos tres CHECKs de tamanho existe ainda', 'sim', CASE WHEN
    (SELECT count(*) FROM pg_attribute WHERE attrelid = to_regclass('public.profiles') AND attname IN ('full_name', 'whatsapp') AND atttypid = 'text'::regtype AND NOT attisdropped) = 2
    AND EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = to_regclass('public.public_profiles') AND attname = 'full_name' AND atttypid = 'text'::regtype AND NOT attisdropped)
    AND NOT EXISTS (SELECT 1 FROM pg_constraint c WHERE c.conname IN ('profiles_full_name_ate_120_caracteres', 'public_profiles_full_name_ate_120_caracteres', 'profiles_whatsapp_ate_20_caracteres')) THEN 'sim' ELSE 'nao' END
  UNION ALL SELECT 'nenhum outro CHECK limita full_name ou whatsapp hoje (o teto de 120 e o de 20 ainda nao estao no banco)', 'sim', CASE WHEN
    NOT EXISTS (SELECT 1 FROM pg_constraint c WHERE c.conrelid IN (to_regclass('public.profiles'), to_regclass('public.public_profiles')) AND c.contype = 'c'
        AND (position('full_name' IN pg_get_constraintdef(c.oid)) > 0 OR position('whatsapp' IN pg_get_constraintdef(c.oid)) > 0)) THEN 'sim' ELSE 'nao' END
)
SELECT item, esperado, vivo, COALESCE(vivo = esperado, false) AS ok FROM itens ORDER BY ok, item;
