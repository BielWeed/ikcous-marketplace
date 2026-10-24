-- 88c-conferir-o-dono-cadastrado: DEPOIS da 20261383000000 e DEPOIS do INSERT manual do dono (roteiro: docs/runbooks/definir-o-dono-da-loja.md).
-- SO LEITURA, um unico SELECT, rol fechado de 9 linhas. A 88a prova que os OBJETOS existem. Esta prova que o DONO existe:
-- a tabela public.dono_da_loja tem exatamente uma linha e essa pessoa e administradora de verdade nas DUAS fontes do papel
-- (profiles.role e auth.users.raw_app_meta_data), a mesma conta que is_admin_atual() e definir_cargo() fazem.
-- SEM a migration aplicada NAO da erro: a tabela e lida por SQL dinamico (query_to_xml) so quando to_regclass a encontra, e
-- as linhas dependentes devolvem "nao". Isso e o estado esperado ANTES do apply (a 88b prova a ausencia).
-- NENHUM identificador sai daqui: nem user_id, nem e-mail, nem nome. So contagem e sim/nao.
-- Limite: se o papel que le nao pula a RLS, dono_da_loja pode parecer vazia. A linha de controle do papel reprova nesse caso e
-- as linhas do dono dizem "nao" por falta de visao e NAO por falta de dono: rode com um papel que enxerga tudo (superusuario,
-- BYPASSRLS ou dono das tabelas).
WITH tab AS (
  -- A tabela existe (to_regclass) e tem a coluna user_id: so entao o SQL dinamico abaixo pode rodar.
  SELECT to_regclass('public.dono_da_loja') IS NOT NULL AS existe,
         EXISTS (SELECT 1 FROM pg_attribute a
                  WHERE a.attrelid = to_regclass('public.dono_da_loja') AND a.attname = 'user_id'
                    AND a.attnum > 0 AND NOT a.attisdropped) AS legivel
), x AS (
  -- Uma unica linha de contagens, calculada so quando a tabela pode ser lida. Sem a tabela, x fica NULL.
  SELECT CASE WHEN t.existe AND t.legivel
              THEN query_to_xml(
                     'SELECT count(*) AS linhas,
                             count(u.id) AS em_auth,
                             count(*) FILTER (WHERE p.role = ''admin'') AS admin_perfil,
                             count(*) FILTER (WHERE (u.raw_app_meta_data ->> ''role'') = ''admin'') AS admin_auth
                        FROM public.dono_da_loja d
                        LEFT JOIN auth.users u ON u.id = d.user_id
                        LEFT JOIN public.profiles p ON p.id = d.user_id',
                     false, true, ''
                   )
         END AS v
    FROM tab t
), c AS (
  SELECT (xpath('/row/linhas/text()', x.v))[1]::text::bigint AS linhas,
         (xpath('/row/em_auth/text()', x.v))[1]::text::bigint AS em_auth,
         (xpath('/row/admin_perfil/text()', x.v))[1]::text::bigint AS admin_perfil,
         (xpath('/row/admin_auth/text()', x.v))[1]::text::bigint AS admin_auth
    FROM x
), itens(item, esperado, vivo) AS (
  SELECT 'controle: catalogo publico visivel', 'sim', CASE WHEN EXISTS (SELECT 1 FROM pg_class WHERE relnamespace = 'public'::regnamespace) THEN 'sim' ELSE 'nao' END
  UNION ALL SELECT 'controle: o papel que leu enxerga usuarios em auth.users e perfis em public.profiles (sem isso as linhas do dono nao valem)', 'sim',
    CASE WHEN EXISTS (SELECT 1 FROM auth.users) AND EXISTS (SELECT 1 FROM public.profiles) THEN 'sim' ELSE 'nao' END
  UNION ALL SELECT 'controle: o papel que leu pula a RLS (superusuario, BYPASSRLS ou dono das tabelas): sem isso um "nao" pode ser so a RLS escondendo a linha', 'sim',
    CASE WHEN COALESCE((SELECT r.rolsuper OR r.rolbypassrls FROM pg_roles r WHERE r.rolname = current_user), false)
           OR (to_regclass('public.dono_da_loja') IS NOT NULL
               AND pg_has_role(current_user, (SELECT relowner FROM pg_class WHERE oid = to_regclass('public.dono_da_loja')), 'MEMBER')
               AND pg_has_role(current_user, (SELECT relowner FROM pg_class WHERE oid = to_regclass('public.profiles')), 'MEMBER')) THEN 'sim' ELSE 'nao' END
  UNION ALL SELECT 'a tabela public.dono_da_loja existe (migration 20261383000000 aplicada)', 'sim', CASE WHEN (SELECT existe FROM tab) THEN 'sim' ELSE 'nao' END
  UNION ALL SELECT 'a funcao public.definir_cargo(uuid, text) existe', 'sim', CASE WHEN to_regprocedure('public.definir_cargo(uuid,text)') IS NOT NULL THEN 'sim' ELSE 'nao' END
  UNION ALL SELECT 'dono_da_loja tem exatamente uma linha (um dono cadastrado)', 'sim', CASE WHEN COALESCE((SELECT linhas = 1 FROM c), false) THEN 'sim' ELSE 'nao' END
  UNION ALL SELECT 'o dono cadastrado existe em auth.users', 'sim', CASE WHEN COALESCE((SELECT linhas = 1 AND em_auth = 1 FROM c), false) THEN 'sim' ELSE 'nao' END
  UNION ALL SELECT 'o dono cadastrado e admin em profiles.role', 'sim', CASE WHEN COALESCE((SELECT linhas = 1 AND admin_perfil = 1 FROM c), false) THEN 'sim' ELSE 'nao' END
  UNION ALL SELECT 'o dono cadastrado e admin em auth.users.raw_app_meta_data (role)', 'sim', CASE WHEN COALESCE((SELECT linhas = 1 AND admin_auth = 1 FROM c), false) THEN 'sim' ELSE 'nao' END
)
SELECT item, esperado, vivo, COALESCE(vivo = esperado, false) AS ok FROM itens ORDER BY ok, item;
