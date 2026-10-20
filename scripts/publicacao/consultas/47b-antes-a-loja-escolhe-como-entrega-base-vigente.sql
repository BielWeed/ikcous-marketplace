-- 47b — ANTES de aplicar a migration 20261244000000 (a loja escolhe como entrega na cidade dela e em quantos dias): confirma,
-- POR OBJETO, a base de antes: as tres funcoes (`create_marketplace_order_v23`, `create_marketplace_order_v24` e
-- `upsert_store_config`) existem (uma assinatura so cada) com os corpos VIGENTES (md5 da 20261229000000, da 20261236000000 e
-- da 20261239000000, os que NAO conhecem o So retiro) e com os atributos e o EXECUTE de sempre (PUBLIC nunca;
-- authenticated e service_role sim; anon sim nas duas compras e nao na upsert: o CREATE OR REPLACE o preserva e o pre-voo da
-- migration recusa o apply com a ACL diferente); as colunas novas, a CHECK, a trigger e a funcao dela NAO existem ainda;
-- `v_store_config` tem as 45 colunas de hoje; e as colunas e a funcao que os corpos novos leem existem
-- (`store_config.enabled_shipping_methods`, `store_config.store_address`, `store_config.origin_cep`, `is_local_cep(text, text, text)`).
-- E' a consulta de AUSENCIA (`ausenciaConfirmadaPor`) do lote em `provasDeObjetos` de scripts/frota/canais-de-backend.json:
-- a 47a negativa so vira "aplique" se esta for positiva (a loja esta na base de antes, nao em um corpo que ninguem mediu).
-- SO LEITURA, um unico SELECT, so catalogo (pg_proc, pg_namespace, pg_language, pg_attribute, pg_class, pg_constraint,
-- pg_trigger, aclexplode): nenhuma linha de store_config, de pedido ou de cliente e' lida nem devolvida.
--
-- Saida: item | esperado | vivo | ok, com as linhas ok = false primeiro. Rol FECHADO de 9 linhas, as mesmas em qualquer
-- estado do banco (objeto ausente vira `AUSENTE` na propria linha, nunca some uma linha). Tudo `true` = a loja esta na base
-- de antes; uma loja que JA tem a migration reprova aqui de proposito, nas linhas dos corpos, das colunas e da view.
--
--   * corpo      -- md5(replace(prosrc, chr(13), '')) do corpo vivo (LF ou CRLF).
--   * atributos  -- SECURITY DEFINER + `search_path=public` + plpgsql, VOLATILE, nao-STRICT, o numero de argumentos e o tipo de
--                   retorno de cada uma (uuid, uuid, jsonb), e UMA assinatura so por nome.
--   * EXECUTE    -- PUBLIC e' medido por aclexplode(coalesce(proacl, acldefault('f', dono))), porque
--                   has_function_privilege nao tem o pseudo-papel PUBLIC; anon, authenticated e service_role por
--                   has_function_privilege (papel ausente conta como sem EXECUTE).
--   * ausencia   -- as duas colunas, a CHECK, a trigger e a funcao dela contados em pg_attribute, pg_constraint, pg_trigger e
--                   pg_proc: todos zero.
--   * view       -- md5 da lista de colunas na ordem (as 45 da 20261239000000).
--
-- tests/banco/a-loja-escolhe-como-entrega-portao-viva.cjs roda esta consulta num Postgres real (positiva depois do rollback,
-- negativa depois do apply, um negativo por linha). Os md5 vem dos ARQUIVOS das migrations 20261229000000, 20261236000000 e
-- 20261239000000, nao de uma loja: o valor VIVO de cada loja so esta consulta mede. LIMITE: evidencia LOCAL nao prova a
-- IKCOUS nem a Savy: so o run desta consulta contra o ref de cada loja.
WITH fns AS (
  SELECT v.nome, v.anon_esperado, p.oid,
         md5(replace(p.prosrc, chr(13), '')) AS m,
         COALESCE(p.prosecdef AND l.lanname = 'plpgsql' AND p.provolatile = 'v' AND NOT p.proretset AND NOT p.proisstrict
            AND p.pronargs = v.nargs
            AND p.proconfig = ARRAY['search_path=public']::text[]
            AND pg_get_function_result(p.oid) = v.retorno
            AND (SELECT count(*) FROM pg_proc q
                  WHERE q.pronamespace = 'public'::regnamespace AND q.proname = v.nome) = 1, false) AS atributos_ok,
         EXISTS (SELECT 1 FROM aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
                  WHERE a.grantee = 0 AND a.privilege_type = 'EXECUTE') AS public_exec,
         CASE WHEN to_regrole('anon') IS NULL THEN false ELSE has_function_privilege('anon', p.oid, 'EXECUTE') END AS anon_exec,
         CASE WHEN to_regrole('authenticated') IS NULL THEN false ELSE has_function_privilege('authenticated', p.oid, 'EXECUTE') END AS auth_exec,
         CASE WHEN to_regrole('service_role') IS NULL THEN false ELSE has_function_privilege('service_role', p.oid, 'EXECUTE') END AS svc_exec
    FROM (VALUES
           ('create_marketplace_order_v23', 'public.create_marketplace_order_v23(jsonb, numeric, numeric, text, uuid, text, text, text, text, jsonb, text, text, uuid)', 13, 'uuid', true),
           ('create_marketplace_order_v24', 'public.create_marketplace_order_v24(jsonb, numeric, numeric, text, uuid, text, text, text, text, jsonb, text, text, uuid)', 13, 'uuid', true),
           ('upsert_store_config', 'public.upsert_store_config(jsonb)', 1, 'jsonb', false)
         ) AS v(nome, assinatura, nargs, retorno, anon_esperado)
    LEFT JOIN pg_proc p ON p.oid = to_regprocedure(v.assinatura)
    LEFT JOIN pg_language l ON l.oid = p.prolang
), presentes AS (
  SELECT (SELECT count(*) FROM pg_attribute a
           WHERE a.attrelid = to_regclass('public.store_config') AND a.attnum > 0 AND NOT a.attisdropped
             AND a.attname IN ('local_delivery_enabled', 'local_delivery_days'))
       + (SELECT count(*) FROM pg_constraint c
           WHERE c.conrelid = to_regclass('public.store_config') AND c.conname = 'store_config_local_delivery_days_check')
       + (SELECT count(*) FROM pg_trigger t
           WHERE t.tgrelid = to_regclass('public.store_config') AND t.tgname = 'store_config_so_retirada_exige_retirada' AND NOT t.tgisinternal)
       + (SELECT count(*) FROM pg_proc p
           WHERE p.pronamespace = 'public'::regnamespace AND p.proname = 'store_config_so_retirada_exige_retirada') AS n
), visao AS (
  SELECT md5(string_agg(a.attname, ',' ORDER BY a.attnum)) AS m, count(*) AS n
    FROM pg_attribute a
   WHERE a.attrelid = to_regclass('public.v_store_config') AND a.attnum > 0 AND NOT a.attisdropped
), lidas AS (
  SELECT count(*) AS n
    FROM pg_attribute a
   WHERE a.attrelid = to_regclass('public.store_config') AND a.attnum > 0 AND NOT a.attisdropped
     AND a.attname IN ('enabled_shipping_methods', 'store_address', 'origin_cep')
), itens(item, esperado, vivo) AS (
  SELECT 'controle: funcoes de public visiveis a este papel', '>0',
         CASE WHEN (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                     WHERE n.nspname = 'public') > 0 THEN '>0' ELSE '0' END
  UNION ALL
  SELECT 'create_marketplace_order_v23: corpo e o vigente da 20261229000000, sem o So retiro (md5)',
         '6cb5a00cfa290f00dc9de053fee40759',
         COALESCE((SELECT f.m FROM fns f WHERE f.nome = 'create_marketplace_order_v23'), 'AUSENTE')
  UNION ALL
  SELECT 'create_marketplace_order_v24: corpo e o vigente da 20261236000000, sem o So retiro (md5)',
         '6002fc8db6c1d402bc704f018a0c2621',
         COALESCE((SELECT f.m FROM fns f WHERE f.nome = 'create_marketplace_order_v24'), 'AUSENTE')
  UNION ALL
  SELECT 'upsert_store_config: corpo e o vigente da 20261239000000, sem as duas chaves novas (md5)',
         'b562669936df1cda31d4bdd4d075bff3',
         COALESCE((SELECT f.m FROM fns f WHERE f.nome = 'upsert_store_config'), 'AUSENTE')
  UNION ALL
  SELECT 'as tres funcoes: uma assinatura so cada e atributos de sempre (SECURITY DEFINER, search_path=public, plpgsql, VOLATILE, retorno)',
         'atributos de sempre',
         CASE WHEN (SELECT count(*) FROM fns f WHERE f.oid IS NOT NULL) < 3 THEN 'AUSENTE'
              WHEN (SELECT bool_and(f.atributos_ok) FROM fns f) THEN 'atributos de sempre'
              ELSE 'DIFERENTE' END
  UNION ALL
  SELECT 'as tres funcoes: EXECUTE como sempre (PUBLIC nunca; authenticated e service_role sim; anon sim nas duas compras e nao na upsert)',
         'v23: PUBLIC=nao anon=sim authenticated=sim service_role=sim | v24: PUBLIC=nao anon=sim authenticated=sim service_role=sim | upsert: PUBLIC=nao anon=nao authenticated=sim service_role=sim',
         CASE WHEN (SELECT count(*) FROM fns f WHERE f.oid IS NOT NULL) < 3 THEN 'AUSENTE'
              ELSE (SELECT string_agg(CASE f.nome WHEN 'create_marketplace_order_v23' THEN 'v23'
                                                  WHEN 'create_marketplace_order_v24' THEN 'v24'
                                                  ELSE 'upsert' END
                                      || ': PUBLIC=' || CASE WHEN f.public_exec THEN 'sim' ELSE 'nao' END
                                      || ' anon=' || CASE WHEN f.anon_exec THEN 'sim' ELSE 'nao' END
                                      || ' authenticated=' || CASE WHEN f.auth_exec THEN 'sim' ELSE 'nao' END
                                      || ' service_role=' || CASE WHEN f.svc_exec THEN 'sim' ELSE 'nao' END,
                                      ' | ' ORDER BY f.nome)
                      FROM fns f) END
  UNION ALL
  SELECT 'as duas colunas novas, a CHECK do prazo, a trigger do So retiro e a funcao dela ainda nao existem',
         'nenhum',
         CASE WHEN to_regclass('public.store_config') IS NULL THEN 'AUSENTE'
              WHEN (SELECT n FROM presentes) = 0 THEN 'nenhum'
              ELSE (SELECT n FROM presentes)::text || ' ja existem' END
  UNION ALL
  SELECT 'v_store_config: as 45 colunas de hoje, na ordem (md5 da lista), sem as duas novas',
         '050cb4a54b2cad11e7b2863262b1b4d1',
         COALESCE((SELECT v.m FROM visao v), 'AUSENTE')
  UNION ALL
  SELECT 'store_config.enabled_shipping_methods, store_config.store_address e store_config.origin_cep existem (os corpos novos as leem) e is_local_cep(text, text, text) tambem',
         'tres colunas e a funcao',
         CASE WHEN to_regclass('public.store_config') IS NULL THEN 'AUSENTE'
              WHEN (SELECT n FROM lidas) = 3 AND to_regprocedure('public.is_local_cep(text,text,text)') IS NOT NULL THEN 'tres colunas e a funcao'
              ELSE 'FALTA ALGUMA' END
)
SELECT item, esperado, vivo, COALESCE(vivo = esperado, false) AS ok
  FROM itens
 ORDER BY ok, item;
