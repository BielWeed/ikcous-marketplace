-- 33a — DEPOIS de aplicar a migration 20261232000000 (a grade do CRM mede a recencia do MESMO instante da lista: a
-- ancora do periodo passa a ser o menor entre a meia-noite de amanha e agora): confirma que o corpo vivo de
-- public.crm_visao e o NOVO (md5), que ele traz a ancora de agora, que mantem os atributos de sempre (SECURITY
-- DEFINER, plpgsql, STABLE, `search_path=public`) e que a ACL segue a de sempre (PUBLIC e anon sem EXECUTE;
-- authenticated e service_role com). E' a consulta do lote em `provasDeObjetos` de
-- scripts/frota/canais-de-backend.json; a de ausencia e' a 33b.
-- SO LEITURA, um unico SELECT, so catalogo (pg_proc, pg_namespace, pg_language, aclexplode): nenhuma linha de
-- pedido, de cliente ou de perfil e' lida nem devolvida.
--
-- ORDEM: a 20261232000000 so vale DEPOIS da 20261227000000 (o corpo novo e o da 27 com uma linha trocada). A 30a
-- (lote da 27) aceita os dois corpos; a 33b exige o da 27.
--
-- Saida: item | esperado | vivo | ok, com as linhas ok = false primeiro. Rol FECHADO de 5 linhas, as mesmas em
-- qualquer estado do banco (funcao ausente vira `AUSENTE` na propria linha, nunca some uma linha). Tudo `true` =
-- a grade esta aplicada; qualquer `false` = PARE e leia a linha. Depois do rollback-manual reprovam SO as duas
-- linhas do corpo (md5 e marcador).
--
--   * corpo   -- md5(replace(prosrc, chr(13), '')) do corpo vivo (LF ou CRLF): o da 20261232000000.
--   * marcador -- 'sim' se o corpo traz `LEAST(((p_fim + 1)::timestamp AT TIME ZONE 'America/Sao_Paulo'), now())`,
--                a ancora de agora (so o corpo novo a tem): leitura humana do mesmo fato do md5.
--   * atributos -- SECURITY DEFINER + plpgsql + STABLE + proconfig = {search_path=public}.
--   * EXECUTE -- PUBLIC e' medido por aclexplode(coalesce(proacl, acldefault('f', dono))), porque
--                has_function_privilege nao tem o pseudo-papel PUBLIC; anon, authenticated e
--                service_role por has_function_privilege. (A ACL ja e' a da funcao desde a 20261199000000; aqui
--                ela confirma que o corpo novo nao a mexeu.)
--
-- md5 recalculado do ARQUIVO da migration por tests/ci_conferir_banco_test.ts e pelo teste estatico
-- tests/migration_a_grade_do_crm_mede_a_recencia_do_mesmo_instante_da_lista_test.ts;
-- tests/banco/a-grade-do-crm-mede-a-recencia-portao-viva.cjs roda esta consulta num Postgres real (positiva
-- depois do apply, negativa depois do rollback, um negativo por linha). LIMITES: nao prova o COMPORTAMENTO (isso
-- e' de tests/banco/a-grade-do-crm-mede-a-recencia-viva.cjs). Evidencia LOCAL nao prova a IKCOUS nem a Savy: so o
-- run desta consulta contra o ref de cada loja.
WITH fn AS (
  SELECT p.oid,
         md5(replace(p.prosrc, chr(13), '')) AS m,
         CASE WHEN position('LEAST(((p_fim + 1)::timestamp AT TIME ZONE ''America/Sao_Paulo''), now())' IN p.prosrc) > 0
              THEN 'sim' ELSE 'nao' END AS marcador,
         CASE WHEN p.prosecdef AND l.lanname = 'plpgsql' AND p.provolatile = 's'
                   AND p.proconfig = ARRAY['search_path=public']::text[]
              THEN 'SECURITY DEFINER plpgsql STABLE search_path=public' ELSE 'DIFERENTE' END AS atributos,
         'PUBLIC=' || CASE WHEN EXISTS (
                  SELECT 1 FROM aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
                   WHERE a.grantee = 0 AND a.privilege_type = 'EXECUTE') THEN 'sim' ELSE 'nao' END
              || ' anon=' || CASE WHEN to_regrole('anon') IS NULL THEN 'papel ausente'
                                  WHEN has_function_privilege('anon', p.oid, 'EXECUTE') THEN 'sim' ELSE 'nao' END
              || ' authenticated=' || CASE WHEN to_regrole('authenticated') IS NULL THEN 'papel ausente'
                                           WHEN has_function_privilege('authenticated', p.oid, 'EXECUTE') THEN 'sim' ELSE 'nao' END
              || ' service_role=' || CASE WHEN to_regrole('service_role') IS NULL THEN 'papel ausente'
                                          WHEN has_function_privilege('service_role', p.oid, 'EXECUTE') THEN 'sim' ELSE 'nao' END AS acl
    FROM pg_proc p
    JOIN pg_language l ON l.oid = p.prolang
   WHERE p.oid = to_regprocedure('public.crm_visao(date,date)')
), itens(item, esperado, vivo) AS (
  SELECT 'controle: funcoes de public visiveis a este papel', '>0',
         CASE WHEN (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                     WHERE n.nspname = 'public') > 0 THEN '>0' ELSE '0' END
  UNION ALL
  SELECT 'crm_visao: corpo e o da 20261232000000, com a ancora de agora (md5)',
         '0dfda3ea5129c6f8aabfcf0052fd2936',
         COALESCE((SELECT f.m FROM fn f), 'AUSENTE')
  UNION ALL
  SELECT 'crm_visao: o corpo mede o periodo ate agora (LEAST da meia-noite de amanha com now())',
         'sim',
         COALESCE((SELECT f.marcador FROM fn f), 'AUSENTE')
  UNION ALL
  SELECT 'crm_visao: atributos de sempre (SECURITY DEFINER, STABLE, search_path=public)',
         'SECURITY DEFINER plpgsql STABLE search_path=public',
         COALESCE((SELECT f.atributos FROM fn f), 'AUSENTE')
  UNION ALL
  SELECT 'crm_visao: EXECUTE fechado para anon (authenticated e service_role sim)',
         'PUBLIC=nao anon=nao authenticated=sim service_role=sim',
         COALESCE((SELECT f.acl FROM fn f), 'AUSENTE')
)
SELECT item, esperado, vivo, COALESCE(vivo = esperado, false) AS ok
  FROM itens
 ORDER BY ok, item;
