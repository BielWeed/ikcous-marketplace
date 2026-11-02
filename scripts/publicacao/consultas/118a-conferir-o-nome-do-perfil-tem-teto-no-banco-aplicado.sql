-- 118a-conferir-o-nome-do-perfil-tem-teto-no-banco-aplicado: DEPOIS da 20261399100000 (os tres CHECKs de tamanho: profiles.full_name e public_profiles.full_name ate 120, profiles.whatsapp ate 20).
-- SO LEITURA, somente catalogo, rol fechado de 5 linhas. Nao le nenhum perfil. Antes do apply responde "nao" nas linhas dos CHECKs (a 118a negativa
-- e' esperada), nunca erro. Cada linha de CHECK aceita NOT VALID ou ja validado. A contagem de perfis antigos acima do teto NAO mora aqui (esta
-- consulta nao le dado): ela esta no cabecalho da migration, para rodar a mao em cada loja ANTES do apply.
WITH itens(item, esperado, vivo) AS (
  SELECT 'controle: catalogo publico visivel', 'sim', CASE WHEN EXISTS (SELECT 1 FROM pg_class WHERE relnamespace = 'public'::regnamespace) THEN 'sim' ELSE 'nao' END
  UNION ALL SELECT 'profiles: CHECK profiles_full_name_ate_120_caracteres (char_length(full_name) <= 120) existe', 'sim', CASE WHEN EXISTS (
    SELECT 1 FROM pg_constraint c WHERE c.conrelid = to_regclass('public.profiles') AND c.conname = 'profiles_full_name_ate_120_caracteres' AND c.contype = 'c'
       AND pg_get_constraintdef(c.oid) IN ('CHECK ((char_length(full_name) <= 120)) NOT VALID', 'CHECK ((char_length(full_name) <= 120))')) THEN 'sim' ELSE 'nao' END
  UNION ALL SELECT 'public_profiles: CHECK public_profiles_full_name_ate_120_caracteres (char_length(full_name) <= 120) existe', 'sim', CASE WHEN EXISTS (
    SELECT 1 FROM pg_constraint c WHERE c.conrelid = to_regclass('public.public_profiles') AND c.conname = 'public_profiles_full_name_ate_120_caracteres' AND c.contype = 'c'
       AND pg_get_constraintdef(c.oid) IN ('CHECK ((char_length(full_name) <= 120)) NOT VALID', 'CHECK ((char_length(full_name) <= 120))')) THEN 'sim' ELSE 'nao' END
  UNION ALL SELECT 'profiles: CHECK profiles_whatsapp_ate_20_caracteres (char_length(whatsapp) <= 20) existe', 'sim', CASE WHEN EXISTS (
    SELECT 1 FROM pg_constraint c WHERE c.conrelid = to_regclass('public.profiles') AND c.conname = 'profiles_whatsapp_ate_20_caracteres' AND c.contype = 'c'
       AND pg_get_constraintdef(c.oid) IN ('CHECK ((char_length(whatsapp) <= 20)) NOT VALID', 'CHECK ((char_length(whatsapp) <= 20))')) THEN 'sim' ELSE 'nao' END
  UNION ALL SELECT 'so existe UM CHECK sobre cada coluna (full_name em profiles e em public_profiles, whatsapp em profiles): nenhum teto concorrente', 'sim', CASE WHEN
    (SELECT count(*) FROM pg_constraint c WHERE c.conrelid = to_regclass('public.profiles') AND c.contype = 'c'
        AND position('full_name' IN pg_get_constraintdef(c.oid)) > 0) = 1
    AND (SELECT count(*) FROM pg_constraint c WHERE c.conrelid = to_regclass('public.public_profiles') AND c.contype = 'c'
        AND position('full_name' IN pg_get_constraintdef(c.oid)) > 0) = 1
    AND (SELECT count(*) FROM pg_constraint c WHERE c.conrelid = to_regclass('public.profiles') AND c.contype = 'c'
        AND position('whatsapp' IN pg_get_constraintdef(c.oid)) > 0) = 1 THEN 'sim' ELSE 'nao' END
)
SELECT item, esperado, vivo, COALESCE(vivo = esperado, false) AS ok FROM itens ORDER BY ok, item;
