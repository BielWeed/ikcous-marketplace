-- 190b-antes-a-loja-grande-nao-trava-o-balcao-ausente: ANTES da 20261530000000 (ou depois do rollback-manual dela). SO LEITURA, somente
-- catalogo, rol fechado de 5 linhas. Nao le nenhuma linha e nao chama porta nenhuma. As linhas 2 e 3 sao o estado de antes (a porta e os
-- indices ausentes; um nome ja ocupado por OUTRO objeto faz o pre-voo recusar). A linha 4 e o que o pre-voo da migration exige do banco:
-- se vier "nao", o apply recusaria com B1_BASELINE_DIVERGENT e nada seria escrito. A linha 5 e a porta antiga com o corpo de onde o
-- filtro da nova foi copiado (a 190a exige o mesmo corpo depois: a migration nao a toca).
-- auth.users e lida pelo catalogo (pg_class + pg_namespace), nunca por to_regclass: quem roda pode nao ter USAGE no schema auth.
WITH fn AS (
  SELECT p.proname, md5(replace(p.prosrc, chr(13), '')) AS h
  FROM pg_proc p
  WHERE p.pronamespace = 'public'::regnamespace AND p.proname IN ('buscar_clientes_do_balcao', 'get_admin_customers_paged')
), col AS (
  SELECT v.esquema, v.tabela, v.coluna, v.tipo,
         EXISTS (SELECT 1 FROM pg_attribute a JOIN pg_class c ON c.oid = a.attrelid JOIN pg_namespace n ON n.oid = c.relnamespace
                  WHERE n.nspname = v.esquema AND c.relname = v.tabela AND c.relkind = 'r' AND a.attname = v.coluna
                    AND a.attnum > 0 AND NOT a.attisdropped
                    AND CASE WHEN v.tipo IS NULL THEN a.atttypid IN ('text'::regtype, 'character varying'::regtype)
                             ELSE format_type(a.atttypid, a.atttypmod) = v.tipo END) AS existe
  FROM (VALUES
    ('public', 'produtos', 'id', 'uuid'), ('public', 'produtos', 'data_cadastro', 'timestamp with time zone'),
    ('public', 'marketplace_order_history', 'new_status', 'text'),
    ('public', 'marketplace_order_history', 'created_at', 'timestamp with time zone'),
    ('public', 'profiles', 'id', 'uuid'), ('public', 'profiles', 'full_name', 'text'), ('public', 'profiles', 'whatsapp', 'text'),
    ('public', 'profiles', 'created_at', 'timestamp with time zone'),
    ('auth', 'users', 'id', 'uuid'), ('auth', 'users', 'email', NULL), ('auth', 'users', 'phone', NULL),
    ('public', 'user_addresses', 'id', 'uuid'), ('public', 'user_addresses', 'user_id', 'uuid'), ('public', 'user_addresses', 'city', 'text'),
    ('public', 'user_addresses', 'state', 'text'), ('public', 'user_addresses', 'is_default', 'boolean'),
    ('public', 'user_addresses', 'created_at', 'timestamp with time zone')
  ) AS v(esquema, tabela, coluna, tipo)
), itens(item, esperado, vivo) AS (
  SELECT 'controle: catalogo publico visivel', 'sim', CASE WHEN EXISTS (SELECT 1 FROM pg_class WHERE relnamespace = 'public'::regnamespace) THEN 'sim' ELSE 'nao' END
  UNION ALL SELECT 'buscar_clientes_do_balcao ainda NAO existe (nenhuma sobrecarga)', 'sim', CASE WHEN
    NOT EXISTS (SELECT 1 FROM fn WHERE proname = 'buscar_clientes_do_balcao') THEN 'sim' ELSE 'nao' END
  UNION ALL SELECT 'idx_produtos_data_cadastro_id e idx_order_history_status_criado ainda NAO existem (nenhuma relacao com esses nomes em public)', 'sim', CASE WHEN
    NOT EXISTS (SELECT 1 FROM pg_class c WHERE c.relnamespace = 'public'::regnamespace
                  AND c.relname IN ('idx_produtos_data_cadastro_id', 'idx_order_history_status_criado')) THEN 'sim' ELSE 'nao' END
  UNION ALL SELECT 'a base que o pre-voo exige: produtos, marketplace_order_history, profiles, user_addresses e auth.users com as colunas lidas, is_admin(), is_admin_atual() e extensions.unaccent(text)', 'sim', CASE WHEN
    (SELECT bool_and(existe) FROM col)
    AND EXISTS (SELECT 1 FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname = 'is_admin'
                  AND pg_get_function_identity_arguments(p.oid) = '')
    AND EXISTS (SELECT 1 FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname = 'is_admin_atual'
                  AND pg_get_function_identity_arguments(p.oid) = '')
    -- pelo catalogo (e nao por to_regprocedure): quem roda esta consulta pode nao ter USAGE no schema extensions.
    AND EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                 WHERE n.nspname = 'extensions' AND p.proname = 'unaccent' AND pg_get_function_identity_arguments(p.oid) = 'text') THEN 'sim' ELSE 'nao' END
  UNION ALL SELECT 'get_admin_customers_paged: uma so, com o corpo da 20261412000000 (md5), de onde o filtro da porta nova foi copiado', 'sim', CASE WHEN
    (SELECT count(*) FROM fn WHERE proname = 'get_admin_customers_paged') = 1
    AND (SELECT h FROM fn WHERE proname = 'get_admin_customers_paged') = 'bdac47c59600f44cf59ac6c74e44a55e' THEN 'sim' ELSE 'nao' END
)
SELECT item, esperado, vivo, COALESCE(vivo = esperado, false) AS ok FROM itens ORDER BY ok, item;
