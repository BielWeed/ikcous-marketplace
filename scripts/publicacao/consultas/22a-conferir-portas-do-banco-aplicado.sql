-- 22a — DEPOIS de aplicar o lote 20261218000000 + 20261218000100 + 20261219000000 (a foto do perfil
-- tem teto; a contagem do push e a view de produtos do painel deixam de atender o visitante sem
-- login; configuracoes da loja e codigos de verificacao so pelo servidor; a lista de perfis publicos
-- so para quem esta logado e so com quem escreveu): confirma, POR OBJETO, o estado que o lote deixa.
-- E' a consulta do lote em `provasDeObjetos` de scripts/frota/canais-de-backend.json; a de ausencia
-- e' a 22b.
-- SO LEITURA, um unico SELECT, so catalogo (pg_proc, pg_namespace, pg_class, pg_attribute,
-- pg_policy, pg_trigger, pg_roles, aclexplode): nenhuma linha de perfil, avaliacao, configuracao ou
-- codigo e' lida nem devolvida.
--
-- Saida: item | esperado | vivo | ok, com as linhas ok = false primeiro. Rol FECHADO de 15 linhas,
-- as mesmas em qualquer estado do banco (objeto ausente vira `AUSENTE` na propria linha, nunca some
-- uma linha). Tudo `true` = o lote esta aplicado; qualquer `false` = PARE e leia a linha.
--
--   * politica -- a condicao da politica de public_profiles e' comparada pelo md5 do texto
--                 deparseado SEM os prefixos `public.` e `auth.` (o mesmo md5 com qualquer
--                 search_path de quem le); papeis e comando vem do catalogo.
--   * gatilho  -- a definicao (sem `public.`) e o estado ligado (`O`), e o corpo da funcao por sha256
--                 (LF ou CRLF).
--   * EXECUTE  -- PUBLIC e' medido por aclexplode(coalesce(proacl, acldefault('f', dono))), porque
--                 has_function_privilege nao tem o pseudo-papel PUBLIC.
--   * tabelas  -- has_table_privilege/has_any_column_privilege por papel, mais PUBLIC na ACL e a
--                 participacao de anon/authenticated em pg_read_all_data/pg_write_all_data (rota que
--                 nao aparece na ACL).
--
-- As linhas de configuracoes e codigos (20261218000100) ja saem `true` numa loja que estava fechada
-- antes do lote; por isso elas NAO estao na 22b. O md5 e o sha256 sao recalculados dos ARQUIVOS da
-- migration por tests/ci_conferir_banco_test.ts, e tests/banco/portas-do-banco-portao-viva.cjs roda
-- esta consulta num Postgres real (positiva depois do apply, negativa depois do rollback, um negativo
-- por linha). LIMITES: nao prova o COMPORTAMENTO (isso e' de tests/banco/portas-do-banco-viva.cjs).
-- Evidencia LOCAL nao prova a IKCOUS nem a Savy: so o run desta consulta contra o ref de cada loja.
WITH fn AS (
  SELECT t.nome,
         p.oid,
         p.prosecdef,
         encode(sha256(convert_to(p.prosrc, 'UTF8')), 'hex') AS h,
         md5(replace(p.prosrc, chr(13), '')) AS m,
         CASE WHEN p.oid IS NULL THEN NULL
              ELSE 'PUBLIC=' || CASE WHEN EXISTS (
                       SELECT 1 FROM aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
                        WHERE a.grantee = 0 AND a.privilege_type = 'EXECUTE') THEN 'sim' ELSE 'nao' END
                   || ' anon=' || CASE WHEN to_regrole('anon') IS NULL THEN 'papel ausente'
                                       WHEN has_function_privilege('anon', p.oid, 'EXECUTE') THEN 'sim' ELSE 'nao' END
                   || ' authenticated=' || CASE WHEN to_regrole('authenticated') IS NULL THEN 'papel ausente'
                                                WHEN has_function_privilege('authenticated', p.oid, 'EXECUTE') THEN 'sim' ELSE 'nao' END
         END AS acl,
         CASE WHEN p.oid IS NULL OR to_regrole('service_role') IS NULL THEN 'papel ausente'
              WHEN has_function_privilege('service_role', p.oid, 'EXECUTE') THEN 'sim' ELSE 'nao' END AS servico
    FROM (VALUES ('gatilho', 'public.perfil_recusa_imagem_grande()'),
                 ('push', 'public.get_segmented_push_count(text,numeric,integer)')) AS t(nome, assinatura)
    LEFT JOIN pg_proc p ON p.oid = to_regprocedure(t.assinatura)
), pol AS (
  SELECT count(*) AS total,
         string_agg(p.polname || ' ' || CASE p.polcmd WHEN 'r' THEN 'SELECT' WHEN 'a' THEN 'INSERT'
                                             WHEN 'w' THEN 'UPDATE' WHEN 'd' THEN 'DELETE' ELSE 'ALL' END
                    || ' ' || CASE WHEN p.polpermissive THEN 'permissiva' ELSE 'restritiva' END
                    || ' ' || array_to_string(ARRAY(SELECT CASE WHEN x = 0 THEN 'public' ELSE x::regrole::text END
                                                      FROM unnest(p.polroles) AS x ORDER BY 1), ','),
                    '; ' ORDER BY p.polname) AS resumo,
         max(md5(replace(replace(pg_get_expr(p.polqual, p.polrelid), 'public.', ''), 'auth.', '')))
           FILTER (WHERE p.polname = 'public_profiles_select_policy') AS qual_md5,
         bool_or(p.polwithcheck IS NOT NULL) AS tem_check
    FROM pg_policy p
   WHERE p.polrelid = to_regclass('public.public_profiles')
), tab AS (
  SELECT t.nome, c.oid, c.relrowsecurity AS rls
    FROM (VALUES ('app_settings', 'public.app_settings'),
                 ('otp_verifications', 'public.otp_verifications'),
                 ('vw_produtos_admin', 'public.vw_produtos_admin'),
                 ('public_profiles', 'public.public_profiles')) AS t(nome, rel)
    LEFT JOIN pg_class c ON c.oid = to_regclass(t.rel)
), fechada AS (
  -- a tabela nao tem nada para PUBLIC (tabela ou coluna) nem para os papeis listados
  SELECT t.nome,
         CASE WHEN t.oid IS NULL THEN NULL
              WHEN to_regrole('anon') IS NULL OR to_regrole('authenticated') IS NULL THEN 'papel ausente'
              WHEN EXISTS (SELECT 1 FROM pg_class c
                             CROSS JOIN LATERAL aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) a
                            WHERE c.oid = t.oid AND a.grantee = 0)
                OR EXISTS (SELECT 1 FROM pg_attribute at
                             CROSS JOIN LATERAL aclexplode(at.attacl) a
                            WHERE at.attrelid = t.oid AND at.attacl IS NOT NULL AND at.attnum > 0
                              AND NOT at.attisdropped AND a.grantee = 0) THEN 'PUBLIC alcanca'
              WHEN has_table_privilege('anon', t.oid, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER,MAINTAIN')
                OR has_any_column_privilege('anon', t.oid, 'SELECT,INSERT,UPDATE,REFERENCES') THEN 'anon alcanca'
              WHEN t.nome IN ('app_settings', 'otp_verifications')
               AND (has_table_privilege('authenticated', t.oid, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER,MAINTAIN')
                    OR has_any_column_privilege('authenticated', t.oid, 'SELECT,INSERT,UPDATE,REFERENCES')) THEN 'authenticated alcanca'
              WHEN t.nome IN ('app_settings', 'otp_verifications') AND NOT t.rls THEN 'RLS desligada'
              ELSE 'sim' END AS vivo
    FROM tab t
   WHERE t.nome IN ('app_settings', 'otp_verifications', 'vw_produtos_admin')
), itens(item, esperado, vivo) AS (
  SELECT 'controle: funcoes de public visiveis a este papel', '>0',
         CASE WHEN (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                     WHERE n.nspname = 'public') > 0 THEN '>0' ELSE '0' END
  UNION ALL
  SELECT 'public_profiles: politicas', 'public_profiles_select_policy SELECT permissiva authenticated',
         COALESCE((SELECT CASE WHEN p.total = 0 THEN 'nenhuma' ELSE p.resumo END FROM pol p), 'AUSENTE')
  UNION ALL
  SELECT 'public_profiles: condicao da politica e a da 20261219000000 (md5)',
         '2170d7dbe678ec1f1079d3ec8a1ec90b',
         COALESCE((SELECT CASE WHEN p.tem_check THEN 'com WITH CHECK' ELSE p.qual_md5 END FROM pol p), 'AUSENTE')
  UNION ALL
  SELECT 'public_profiles: RLS ligada', 'sim',
         COALESCE((SELECT CASE WHEN t.rls THEN 'sim' ELSE 'nao' END FROM tab t
                    WHERE t.nome = 'public_profiles' AND t.oid IS NOT NULL), 'AUSENTE')
  UNION ALL
  SELECT 'profiles: gatilho do teto da imagem ligado e com a definicao da 20261218000000', 'sim',
         COALESCE((SELECT CASE WHEN tg.tgenabled = 'O'
                                    AND replace(pg_get_triggerdef(tg.oid), 'public.', '') =
                                        'CREATE TRIGGER tr_perfil_recusa_imagem_grande BEFORE INSERT OR UPDATE OF avatar_url, cover_url ON profiles FOR EACH ROW EXECUTE FUNCTION perfil_recusa_imagem_grande()'
                               THEN 'sim' ELSE 'diferente ou desligado' END
                     FROM pg_trigger tg
                    WHERE tg.tgrelid = to_regclass('public.profiles')
                      AND tg.tgname = 'tr_perfil_recusa_imagem_grande' AND NOT tg.tgisinternal), 'AUSENTE')
  UNION ALL
  SELECT 'perfil_recusa_imagem_grande: corpo e o da 20261218000000 (sha256)',
         '9fe22a1b326724a180d3121e7d7032291e03052e3487331be4d041e2439f3195',
         COALESCE((SELECT CASE WHEN f.h IN ('9fe22a1b326724a180d3121e7d7032291e03052e3487331be4d041e2439f3195',
                                            'c8838aa28b8ad4590685797a543adf8970500eb033615e8ebfe7c0ceab788114')
                               THEN '9fe22a1b326724a180d3121e7d7032291e03052e3487331be4d041e2439f3195'
                               ELSE f.h END
                     FROM fn f WHERE f.nome = 'gatilho' AND f.oid IS NOT NULL), 'AUSENTE')
  UNION ALL
  SELECT 'perfil_recusa_imagem_grande: EXECUTE fechado e sem SECURITY DEFINER',
         'PUBLIC=nao anon=nao authenticated=nao definer=nao',
         COALESCE((SELECT f.acl || ' definer=' || CASE WHEN f.prosecdef THEN 'sim' ELSE 'nao' END
                     FROM fn f WHERE f.nome = 'gatilho' AND f.oid IS NOT NULL), 'AUSENTE')
  UNION ALL
  SELECT 'get_segmented_push_count: EXECUTE', 'PUBLIC=nao anon=nao authenticated=sim service_role=sim',
         COALESCE((SELECT f.acl || ' service_role=' || f.servico
                     FROM fn f WHERE f.nome = 'push' AND f.oid IS NOT NULL), 'AUSENTE')
  UNION ALL
  SELECT 'get_segmented_push_count: corpo e o vigente (md5)', 'e5f6b76afd6ec75df32f168d9942e209',
         COALESCE((SELECT f.m FROM fn f WHERE f.nome = 'push' AND f.oid IS NOT NULL), 'AUSENTE')
  UNION ALL
  SELECT 'vw_produtos_admin: nada para PUBLIC/anon', 'sim',
         COALESCE((SELECT f.vivo FROM fechada f WHERE f.nome = 'vw_produtos_admin'), 'AUSENTE')
  UNION ALL
  SELECT 'vw_produtos_admin: authenticated le e grava', 'sim',
         COALESCE((SELECT CASE WHEN to_regrole('authenticated') IS NULL THEN 'papel ausente'
                               WHEN has_table_privilege('authenticated', t.oid, 'SELECT')
                                    AND has_table_privilege('authenticated', t.oid, 'INSERT')
                                    AND has_table_privilege('authenticated', t.oid, 'UPDATE')
                                    AND has_table_privilege('authenticated', t.oid, 'DELETE') THEN 'sim'
                               ELSE 'nao' END
                     FROM tab t WHERE t.nome = 'vw_produtos_admin' AND t.oid IS NOT NULL), 'AUSENTE')
  UNION ALL
  SELECT 'app_settings: RLS ligada e nada para PUBLIC/anon/authenticated', 'sim',
         COALESCE((SELECT f.vivo FROM fechada f WHERE f.nome = 'app_settings'), 'AUSENTE')
  UNION ALL
  SELECT 'otp_verifications: RLS ligada e nada para PUBLIC/anon/authenticated', 'sim',
         COALESCE((SELECT f.vivo FROM fechada f WHERE f.nome = 'otp_verifications'), 'AUSENTE')
  UNION ALL
  SELECT 'app_settings e otp_verifications: service_role le e grava', 'sim',
         CASE WHEN to_regrole('service_role') IS NULL THEN 'papel ausente'
              WHEN (SELECT count(*) FROM tab t WHERE t.nome IN ('app_settings', 'otp_verifications') AND t.oid IS NOT NULL) <> 2
                THEN 'AUSENTE'
              WHEN (SELECT bool_and(has_table_privilege('service_role', t.oid, 'SELECT')
                                    AND has_table_privilege('service_role', t.oid, 'INSERT')
                                    AND has_table_privilege('service_role', t.oid, 'UPDATE')
                                    AND has_table_privilege('service_role', t.oid, 'DELETE'))
                      FROM tab t WHERE t.nome IN ('app_settings', 'otp_verifications')) THEN 'sim'
              ELSE 'nao' END
  UNION ALL
  SELECT 'anon e authenticated: fora de pg_read_all_data e pg_write_all_data', 'sim',
         CASE WHEN to_regrole('anon') IS NULL OR to_regrole('authenticated') IS NULL THEN 'papel ausente'
              WHEN EXISTS (SELECT 1 FROM pg_roles ro
                            WHERE ro.rolname IN ('anon', 'authenticated')
                              AND (pg_has_role(ro.oid, 'pg_read_all_data', 'MEMBER')
                                   OR pg_has_role(ro.oid, 'pg_write_all_data', 'MEMBER'))) THEN 'nao'
              ELSE 'sim' END
)
SELECT item, esperado, vivo, COALESCE(vivo = esperado, false) AS ok
  FROM itens
 ORDER BY ok, item;
