-- 22b — ANTES de aplicar o lote 20261218000000 + 20261218000100 + 20261219000000 (a foto do perfil
-- tem teto; a contagem do push e a view de produtos do painel deixam de atender o visitante sem
-- login; configuracoes e codigos so pelo servidor; a lista de perfis publicos so para quem esta
-- logado): confirma que a loja esta no estado VIGENTE de antes, medido nas duas lojas em 12/10/2026,
-- e que o que o lote le EXISTE. E' a consulta de AUSENCIA do lote (`ausenciaConfirmadaPor` em
-- scripts/frota/canais-de-backend.json): so com a 22a NEGATIVA e esta POSITIVA (da mesma janela ou
-- mais nova) o portao (scripts/frota/publicar-release.mjs) imprime o apply dos tres arquivos.
-- SO LEITURA, um unico SELECT, so catalogo (pg_proc, pg_namespace, pg_class, pg_attribute,
-- pg_policy, pg_trigger, aclexplode): nenhuma linha de dado e' lida nem devolvida.
--
-- POR OBJETO, nunca por `schema_migrations`: o registro do ledger nao prova o que esta no banco.
--
-- Saida: item | esperado | vivo | ok, com as linhas ok = false primeiro. Rol FECHADO de 11 linhas,
-- as mesmas em qualquer estado do banco. Tudo `true` = a loja esta na base de antes e o lote pode ser
-- aplicado; qualquer `false` = PARE e leia a linha (aplicado assim, o lote abortaria num pre-voo
-- `B1_BASELINE_DIVERGENT` -- aqui a gente descobre ANTES, por leitura). Uma loja que ja tem o lote
-- reprova aqui de proposito. Depois dos tres rollback-manual esta consulta volta a ser POSITIVA.
--
-- SEM linha de configuracoes e codigos (20261218000100): numa loja que ja estava fechada antes do
-- lote, o "antes" dessas tabelas ja e' o "depois", e uma linha aqui travaria o portao para sempre.
-- O que essa migration exige (as tabelas com RLS) a propria migration recusa no pre-voo.
--
-- md5 = md5 do corpo sem `\r`; tests/ci_conferir_banco_test.ts recalcula os valores dos ARQUIVOS das
-- migrations desta arvore. Evidencia LOCAL nao prova a IKCOUS nem a Savy: so o run desta consulta
-- contra o ref de cada loja.
WITH fn AS (
  SELECT t.nome,
         p.oid,
         md5(replace(p.prosrc, chr(13), '')) AS m,
         CASE WHEN p.oid IS NULL THEN NULL
              ELSE 'PUBLIC=' || CASE WHEN EXISTS (
                       SELECT 1 FROM aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
                        WHERE a.grantee = 0 AND a.privilege_type = 'EXECUTE') THEN 'sim' ELSE 'nao' END
                   || ' anon=' || CASE WHEN to_regrole('anon') IS NULL THEN 'papel ausente'
                                       WHEN has_function_privilege('anon', p.oid, 'EXECUTE') THEN 'sim' ELSE 'nao' END
                   || ' authenticated=' || CASE WHEN to_regrole('authenticated') IS NULL THEN 'papel ausente'
                                                WHEN has_function_privilege('authenticated', p.oid, 'EXECUTE') THEN 'sim' ELSE 'nao' END
                   || ' service_role=' || CASE WHEN to_regrole('service_role') IS NULL THEN 'papel ausente'
                                               WHEN has_function_privilege('service_role', p.oid, 'EXECUTE') THEN 'sim' ELSE 'nao' END
         END AS acl
    FROM (VALUES ('gatilho', 'public.perfil_recusa_imagem_grande()'),
                 ('push', 'public.get_segmented_push_count(text,numeric,integer)'),
                 ('admin', 'public.rls_admin_atual()')) AS t(nome, assinatura)
    LEFT JOIN pg_proc p ON p.oid = to_regprocedure(t.assinatura)
), pol AS (
  SELECT count(*) AS total,
         string_agg(p.polname || ' ' || CASE p.polcmd WHEN 'r' THEN 'SELECT' WHEN 'a' THEN 'INSERT'
                                             WHEN 'w' THEN 'UPDATE' WHEN 'd' THEN 'DELETE' ELSE 'ALL' END
                    || ' ' || CASE WHEN p.polpermissive THEN 'permissiva' ELSE 'restritiva' END
                    || ' ' || array_to_string(ARRAY(SELECT CASE WHEN x = 0 THEN 'public' ELSE x::regrole::text END
                                                      FROM unnest(p.polroles) AS x ORDER BY 1), ','),
                    '; ' ORDER BY p.polname) AS resumo,
         max(CASE WHEN pg_get_expr(p.polqual, p.polrelid) = 'true' THEN 'true'
                  ELSE 'outra (md5 ' || md5(replace(replace(pg_get_expr(p.polqual, p.polrelid), 'public.', ''), 'auth.', '')) || ')' END)
           FILTER (WHERE p.polname = 'public_profiles_select_policy') AS qual,
         bool_or(p.polwithcheck IS NOT NULL) AS tem_check
    FROM pg_policy p
   WHERE p.polrelid = to_regclass('public.public_profiles')
), faltam AS (
  SELECT v.item AS coluna
    FROM unnest(ARRAY[
           'public.profiles.avatar_url', 'public.profiles.cover_url', 'public.public_profiles.id',
           'public.questions.user_id', 'public.reviews.status', 'public.reviews.user_id'
         ]) AS v(item)
   WHERE NOT EXISTS (
           SELECT 1 FROM pg_attribute a
            WHERE a.attrelid = to_regclass(split_part(v.item, '.', 1) || '.' || split_part(v.item, '.', 2))
              AND a.attname = split_part(v.item, '.', 3)
              AND a.attnum > 0 AND NOT a.attisdropped)
), itens(item, esperado, vivo) AS (
  SELECT 'controle: funcoes de public visiveis a este papel', '>0',
         CASE WHEN (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                     WHERE n.nspname = 'public') > 0 THEN '>0' ELSE '0' END
  UNION ALL
  SELECT 'public_profiles: politicas', 'public_profiles_select_policy SELECT permissiva public',
         COALESCE((SELECT CASE WHEN p.total = 0 THEN 'nenhuma' ELSE p.resumo END FROM pol p), 'AUSENTE')
  UNION ALL
  SELECT 'public_profiles: condicao da politica e a do baseline', 'true',
         COALESCE((SELECT CASE WHEN p.tem_check THEN 'com WITH CHECK' ELSE p.qual END FROM pol p), 'AUSENTE')
  UNION ALL
  SELECT 'public_profiles: RLS ligada', 'sim',
         COALESCE((SELECT CASE WHEN c.relrowsecurity THEN 'sim' ELSE 'nao' END
                     FROM pg_class c WHERE c.oid = to_regclass('public.public_profiles')), 'AUSENTE')
  UNION ALL
  SELECT 'profiles: gatilho do teto da imagem', 'AUSENTE',
         COALESCE((SELECT 'presente' FROM pg_trigger tg
                    WHERE tg.tgrelid = to_regclass('public.profiles')
                      AND tg.tgname = 'tr_perfil_recusa_imagem_grande' AND NOT tg.tgisinternal), 'AUSENTE')
  UNION ALL
  SELECT 'perfil_recusa_imagem_grande: funcao', 'AUSENTE',
         COALESCE((SELECT 'presente' FROM fn f WHERE f.nome = 'gatilho' AND f.oid IS NOT NULL), 'AUSENTE')
  UNION ALL
  SELECT 'get_segmented_push_count: corpo e o da 20261199000000 (md5)', 'e5f6b76afd6ec75df32f168d9942e209',
         COALESCE((SELECT f.m FROM fn f WHERE f.nome = 'push' AND f.oid IS NOT NULL), 'AUSENTE')
  UNION ALL
  SELECT 'get_segmented_push_count: EXECUTE', 'PUBLIC=sim anon=sim authenticated=sim service_role=sim',
         COALESCE((SELECT f.acl FROM fn f WHERE f.nome = 'push' AND f.oid IS NOT NULL), 'AUSENTE')
  UNION ALL
  SELECT 'vw_produtos_admin: anon le', 'sim',
         COALESCE((SELECT CASE WHEN to_regrole('anon') IS NULL THEN 'papel ausente'
                               WHEN has_table_privilege('anon', c.oid, 'SELECT') THEN 'sim' ELSE 'nao' END
                     FROM pg_class c WHERE c.oid = to_regclass('public.vw_produtos_admin')), 'AUSENTE')
  UNION ALL
  SELECT 'rls_admin_atual: corpo da 20261197000000 (md5) e EXECUTE',
         'ccb7a56e835b8181795fffb7bee97305 PUBLIC=nao anon=nao authenticated=sim service_role=sim',
         COALESCE((SELECT f.m || ' ' || f.acl FROM fn f WHERE f.nome = 'admin' AND f.oid IS NOT NULL), 'AUSENTE')
  UNION ALL
  SELECT 'perfis, avaliacoes e perguntas: colunas que o lote le', 'EXISTEM',
         COALESCE((SELECT 'AUSENTES: ' || string_agg(f.coluna, ', ' ORDER BY f.coluna) FROM faltam f),
                  'EXISTEM')
)
SELECT item, esperado, vivo, COALESCE(vivo = esperado, false) AS ok
  FROM itens
 ORDER BY ok, item;
