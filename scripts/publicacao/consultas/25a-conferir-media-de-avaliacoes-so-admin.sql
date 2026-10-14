-- 25a — DEPOIS de aplicar a migration 20261222000000 (a media de avaliacoes, `get_reviews_metrics`, so
-- responde ao administrador: o corpo passa a exigir `public.is_admin()`): confirma, POR OBJETO, que o
-- corpo vivo e' o NOVO (o antigo mais a guarda de admin na primeira instrucao, md5), que a funcao
-- mantem os atributos de sempre (SECURITY DEFINER, plpgsql, VOLATILE, `search_path=public`: a lista L8
-- reprova se o tipo ou o SECURITY DEFINER mudarem) e que a ACL segue FECHADA ao visitante (PUBLIC e anon
-- sem EXECUTE; authenticated e service_role com). E' a consulta do lote em `provasDeObjetos` de
-- scripts/frota/canais-de-backend.json; a de ausencia e' a 25b.
-- SO LEITURA, um unico SELECT, so catalogo (pg_proc, pg_namespace, pg_language, aclexplode): nenhuma linha
-- de avaliacao e' lida nem devolvida.
--
-- Saida: item | esperado | vivo | ok, com as linhas ok = false primeiro. Rol FECHADO de 5 linhas, as
-- mesmas em qualquer estado do banco (funcao ausente vira `AUSENTE` na propria linha, nunca some uma
-- linha). Tudo `true` = o corte esta aplicado; qualquer `false` = PARE e leia a linha. Depois do
-- rollback-manual (o corpo antigo de volta) reprovam SO as duas linhas do corpo (md5 e guarda).
--
--   * corpo   -- md5(replace(prosrc, chr(13), '')) do corpo vivo (LF ou CRLF): o da 20261222000000.
--   * guarda  -- 'sim' se `IF NOT public.is_admin() THEN` aparece no corpo ANTES da primeira leitura de
--                avaliacoes (`IF p_search IS NOT NULL`): leitura humana do mesmo fato do md5.
--   * atributos -- SECURITY DEFINER + plpgsql + VOLATILE + proconfig = {search_path=public}.
--   * EXECUTE -- PUBLIC e' medido por aclexplode(coalesce(proacl, acldefault('f', dono))), porque
--                has_function_privilege nao tem o pseudo-papel PUBLIC; anon, authenticated e
--                service_role por has_function_privilege. (A ACL e' o que a 24a, do lote anterior,
--                tambem mede; aqui ela confirma que o corpo novo nao a mexeu.)
--
-- md5 recalculado dos ARQUIVOS das migrations por tests/ci_conferir_banco_test.ts, e
-- tests/banco/media-de-avaliacoes-so-admin-portao-viva.cjs roda esta consulta num Postgres real
-- (positiva depois do apply, negativa depois do rollback, um negativo por linha). LIMITES: nao prova o
-- COMPORTAMENTO (isso e' de tests/banco/media-de-avaliacoes-so-admin-viva.cjs). Evidencia LOCAL nao prova
-- a IKCOUS nem a Savy: so o run desta consulta contra o ref de cada loja.
WITH alvo(assinatura) AS (
  VALUES ('public.get_reviews_metrics(text,integer)')
), fn AS (
  SELECT p.oid,
         md5(replace(p.prosrc, chr(13), '')) AS m,
         CASE WHEN position('IF NOT public.is_admin() THEN' IN p.prosrc) > 0
                   AND position('IF NOT public.is_admin() THEN' IN p.prosrc) < position('IF p_search IS NOT NULL' IN p.prosrc)
              THEN 'sim' ELSE 'nao' END AS guarda,
         CASE WHEN p.prosecdef AND l.lanname = 'plpgsql' AND p.provolatile = 'v'
                   AND p.proconfig = ARRAY['search_path=public']::text[]
              THEN 'SECURITY DEFINER plpgsql VOLATILE search_path=public' ELSE 'DIFERENTE' END AS atributos,
         'PUBLIC=' || CASE WHEN EXISTS (
                  SELECT 1 FROM aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
                   WHERE a.grantee = 0 AND a.privilege_type = 'EXECUTE') THEN 'sim' ELSE 'nao' END
              || ' anon=' || CASE WHEN to_regrole('anon') IS NULL THEN 'papel ausente'
                                  WHEN has_function_privilege('anon', p.oid, 'EXECUTE') THEN 'sim' ELSE 'nao' END
              || ' authenticated=' || CASE WHEN to_regrole('authenticated') IS NULL THEN 'papel ausente'
                                           WHEN has_function_privilege('authenticated', p.oid, 'EXECUTE') THEN 'sim' ELSE 'nao' END
              || ' service_role=' || CASE WHEN to_regrole('service_role') IS NULL THEN 'papel ausente'
                                          WHEN has_function_privilege('service_role', p.oid, 'EXECUTE') THEN 'sim' ELSE 'nao' END AS acl
    FROM alvo t
    JOIN pg_proc p ON p.oid = to_regprocedure(t.assinatura)
    JOIN pg_language l ON l.oid = p.prolang
), itens(item, esperado, vivo) AS (
  SELECT 'controle: funcoes de public visiveis a este papel', '>0',
         CASE WHEN (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                     WHERE n.nspname = 'public') > 0 THEN '>0' ELSE '0' END
  UNION ALL
  SELECT 'get_reviews_metrics: corpo e o da 20261222000000, com a guarda de admin (md5)',
         'cb41947ab5a8075cea87ab123913b10d',
         COALESCE((SELECT f.m FROM fn f), 'AUSENTE')
  UNION ALL
  SELECT 'get_reviews_metrics: o corpo exige is_admin() antes de ler as avaliacoes',
         'sim',
         COALESCE((SELECT f.guarda FROM fn f), 'AUSENTE')
  UNION ALL
  SELECT 'get_reviews_metrics: atributos de sempre (SECURITY DEFINER, VOLATILE, search_path=public)',
         'SECURITY DEFINER plpgsql VOLATILE search_path=public',
         COALESCE((SELECT f.atributos FROM fn f), 'AUSENTE')
  UNION ALL
  SELECT 'get_reviews_metrics: EXECUTE fechado para anon (authenticated e service_role sim)',
         'PUBLIC=nao anon=nao authenticated=sim service_role=sim',
         COALESCE((SELECT f.acl FROM fn f), 'AUSENTE')
)
SELECT item, esperado, vivo, COALESCE(vivo = esperado, false) AS ok
  FROM itens
 ORDER BY ok, item;
