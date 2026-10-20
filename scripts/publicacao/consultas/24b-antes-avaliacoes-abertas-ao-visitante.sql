-- 24b — ANTES de aplicar a migration 20261221000000 (a media de avaliacoes, `get_reviews_metrics`, e o
-- voto "util", `increment_helpful`, fecham para o visitante sem login): confirma, POR OBJETO, a base de
-- antes: as duas funcoes existem e estao ABERTAS ao visitante (anon com EXECUTE, ao lado de
-- authenticated e service_role; PUBLIC nao, como a 20261090500000 deixou). E' a consulta de AUSENCIA
-- (`ausenciaConfirmadaPor`) do lote em `provasDeObjetos` de scripts/frota/canais-de-backend.json: a
-- 24a negativa so vira "aplique" se esta for positiva (a loja esta na base de antes, nao em um estado
-- que ninguem mediu).
-- SO LEITURA, um unico SELECT, so catalogo (pg_proc, pg_namespace, aclexplode): nenhuma linha de
-- avaliacao ou de voto e' lida nem devolvida.
--
-- Saida: item | esperado | vivo | ok, com as linhas ok = false primeiro. Rol FECHADO de 3 linhas, as
-- mesmas em qualquer estado do banco (funcao ausente vira `AUSENTE` na propria linha). Tudo `true` = a
-- loja esta na base de antes; uma loja que JA tem o corte reprova aqui de proposito, nas linhas de
-- EXECUTE.
--
--   * EXECUTE -- mesma medida da 24a: PUBLIC por aclexplode (grantee 0), anon, authenticated e
--                service_role por has_function_privilege.
--
-- tests/banco/avaliacoes-fechadas-ao-visitante-portao-viva.cjs roda esta consulta num Postgres real
-- (positiva depois do rollback, negativa depois do apply, um negativo por linha). LIMITE: evidencia
-- LOCAL nao prova a IKCOUS nem a Savy: so o run desta consulta contra o ref de cada loja.
WITH alvo(nome, assinatura) AS (
  VALUES ('get_reviews_metrics', 'public.get_reviews_metrics(text,integer)'),
         ('increment_helpful', 'public.increment_helpful(uuid)')
), fn AS (
  SELECT t.nome,
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
    FROM alvo t
    LEFT JOIN pg_proc p ON p.oid = to_regprocedure(t.assinatura)
), itens(item, esperado, vivo) AS (
  SELECT 'controle: funcoes de public visiveis a este papel', '>0',
         CASE WHEN (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                     WHERE n.nspname = 'public') > 0 THEN '>0' ELSE '0' END
  UNION ALL
  SELECT 'get_reviews_metrics: EXECUTE aberto para anon e authenticated',
         'PUBLIC=nao anon=sim authenticated=sim service_role=sim',
         COALESCE((SELECT f.acl FROM fn f WHERE f.nome = 'get_reviews_metrics'), 'AUSENTE')
  UNION ALL
  SELECT 'increment_helpful: EXECUTE aberto para anon e authenticated',
         'PUBLIC=nao anon=sim authenticated=sim service_role=sim',
         COALESCE((SELECT f.acl FROM fn f WHERE f.nome = 'increment_helpful'), 'AUSENTE')
)
SELECT item, esperado, vivo, COALESCE(vivo = esperado, false) AS ok
  FROM itens
 ORDER BY ok, item;
