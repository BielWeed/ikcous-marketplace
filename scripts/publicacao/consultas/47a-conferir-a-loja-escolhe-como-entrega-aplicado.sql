-- 47a — DEPOIS de aplicar a migration 20261244000000 (a loja escolhe como entrega na cidade dela e em quantos dias):
-- confirma, POR OBJETO, que os corpos vivos de `create_marketplace_order_v23`, `create_marketplace_order_v24` e
-- `upsert_store_config` sao os desta migration (md5), que os atributos e o EXECUTE de cada uma sao os de sempre (a migration
-- NAO mexe em ACL, so a confere: PUBLIC nunca; authenticated e service_role sim; anon sim nas duas RPCs de compra e NAO na
-- upsert), que as duas colunas novas de `store_config` existem com tipo, NOT NULL e DEFAULT exatos e a CHECK do prazo (0 a 30)
-- esta validada, que a trigger `store_config_so_retirada_exige_retirada` esta ligada (BEFORE INSERT OR UPDATE por linha) com o
-- corpo desta migration e a funcao dela sem EXECUTE para ninguem, e que `v_store_config` tem as 47 colunas na ordem e e legivel
-- por anon, authenticated e service_role. E' a consulta do lote em `provasDeObjetos` de scripts/frota/canais-de-backend.json;
-- a de ausencia e' a 47b.
-- SO LEITURA, um unico SELECT, so catalogo (pg_proc, pg_namespace, pg_language, pg_attribute, pg_attrdef, pg_constraint,
-- pg_trigger, pg_class, aclexplode): nenhuma linha de store_config, de pedido ou de cliente e' lida nem devolvida.
--
-- Saida: item | esperado | vivo | ok, com as linhas ok = false primeiro. Rol FECHADO de 9 linhas, as mesmas em qualquer
-- estado do banco (objeto ausente vira `AUSENTE` na propria linha, nunca some uma linha). Tudo `true` = o lote esta
-- aplicado; qualquer `false` = PARE e leia a linha. Depois do rollback-manual comum reprovam os tres corpos, a trigger e a
-- view; a linha das colunas segue verdadeira, porque esse rollback DEIXA as colunas e a CHECK (so o destrutivo as apaga).
--
--   * corpo      -- md5(replace(prosrc, chr(13), '')) do corpo vivo (LF ou CRLF): o da 20261244000000.
--   * atributos  -- SECURITY DEFINER + `search_path=public` + plpgsql, VOLATILE, nao-STRICT, o numero de argumentos e o tipo de
--                   retorno de cada uma (uuid, uuid, jsonb), e UMA assinatura so por nome.
--   * EXECUTE    -- PUBLIC e' medido por aclexplode(coalesce(proacl, acldefault('f', dono))), porque
--                   has_function_privilege nao tem o pseudo-papel PUBLIC; anon, authenticated e service_role por
--                   has_function_privilege (papel ausente conta como sem EXECUTE).
--   * colunas    -- local_delivery_enabled boolean NOT NULL DEFAULT true e local_delivery_days integer NOT NULL DEFAULT 1, por
--                   pg_attribute + pg_attrdef; a CHECK `store_config_local_delivery_days_check` (0 a 30), validada.
--   * trigger    -- tgtype = 23 (ROW + BEFORE + INSERT + UPDATE), habilitada, apontando para a funcao certa, cujo corpo e'
--                   o desta migration (md5) e que ninguem (PUBLIC, anon, authenticated, service_role) executa.
--   * view       -- md5 da lista de colunas na ordem (as 45 da 20261239000000 + as 2 novas no FIM) e SELECT por papel.
--
-- CADEIA: v23 e v24 desta consulta aceitam tambem o corpo da SUCESSORA 20261350000000 (a compra online trava o preco e espera a mesma
-- chave: o mesmo corpo com duas edicoes; a 81a e' a consulta dela). Os tres corpos desta consulta sao os SUCESSORES da 20261229000000 (v23), da 20261236000000 (v24) e da
-- 20261239000000 (upsert). Depois desta migration a 8e (lote 92-202), a 9a, a 31a, a 37a e a 40a continuam POSITIVAS: elas
-- aceitam o corpo desta migration ao lado do anterior.
--
-- md5 recalculado dos ARQUIVOS das migrations por tests/migration_a_loja_escolhe_como_entrega_na_cidade_test.ts;
-- tests/banco/a-loja-escolhe-como-entrega-portao-viva.cjs roda esta consulta num Postgres real (positiva depois do apply,
-- negativa depois do rollback, um negativo por linha). LIMITES: nao prova o COMPORTAMENTO (isso e' de
-- tests/banco/a-loja-escolhe-como-entrega-viva.cjs). Evidencia LOCAL nao prova a IKCOUS nem a Savy: so o run desta consulta
-- contra o ref de cada loja.
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
), trg AS (
  SELECT t.tgfoid
    FROM pg_trigger t
   WHERE t.tgrelid = to_regclass('public.store_config')
     AND t.tgname = 'store_config_so_retirada_exige_retirada'
     AND NOT t.tgisinternal AND t.tgenabled = 'O' AND t.tgtype = 23
     AND t.tgfoid = to_regprocedure('public.store_config_so_retirada_exige_retirada()')
), colunas AS (
  SELECT count(*) AS n
    FROM pg_attribute a
    LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
   WHERE a.attrelid = to_regclass('public.store_config')
     AND a.attnum > 0 AND NOT a.attisdropped AND a.attnotnull
     AND ((a.attname = 'local_delivery_enabled' AND a.atttypid = 'boolean'::regtype AND pg_get_expr(d.adbin, d.adrelid) = 'true')
       OR (a.attname = 'local_delivery_days' AND a.atttypid = 'integer'::regtype AND pg_get_expr(d.adbin, d.adrelid) = '1'))
), checagem AS (
  SELECT count(*) AS n
    FROM pg_constraint c
   WHERE c.conrelid = to_regclass('public.store_config')
     AND c.conname = 'store_config_local_delivery_days_check'
     AND c.contype = 'c' AND c.convalidated
     AND pg_get_constraintdef(c.oid) = 'CHECK (((local_delivery_days >= 0) AND (local_delivery_days <= 30)))'
), visao AS (
  SELECT md5(string_agg(a.attname, ',' ORDER BY a.attnum)) AS m, count(*) AS n
    FROM pg_attribute a
   WHERE a.attrelid = to_regclass('public.v_store_config') AND a.attnum > 0 AND NOT a.attisdropped
), itens(item, esperado, vivo) AS (
  SELECT 'controle: funcoes de public visiveis a este papel', '>0',
         CASE WHEN (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                     WHERE n.nspname = 'public') > 0 THEN '>0' ELSE '0' END
  UNION ALL
  SELECT 'create_marketplace_order_v23: corpo e o da 20261244000000, com o So retiro e a retirada livre (md5)',
         '79445d64a87843be2d42bf601c7090ec',
         -- 2 hashes aceitos: o corpo da 20261244000000 OU o da SUCESSORA dele, a 20261350000000 (a compra online trava o preco
         -- e espera a mesma chave: o mesmo corpo com duas edicoes). O `vivo` mostra o esperado.
         COALESCE((SELECT CASE WHEN f.m = '6b71cb823967518955407b532904ae91' THEN '79445d64a87843be2d42bf601c7090ec' ELSE f.m END FROM fns f WHERE f.nome = 'create_marketplace_order_v23'), 'AUSENTE')
  UNION ALL
  SELECT 'create_marketplace_order_v24: corpo e o da 20261244000000, com o So retiro e a retirada livre (md5)',
         '85c37af4baa2f5ce1375bdd9e943c746',
         -- 2 hashes aceitos (idem v23): o da 20261244000000 OU o da sucessora 20261350000000.
         COALESCE((SELECT CASE WHEN f.m = 'e3c124d25632aaa9bcf1995153bc5a7e' THEN '85c37af4baa2f5ce1375bdd9e943c746' ELSE f.m END FROM fns f WHERE f.nome = 'create_marketplace_order_v24'), 'AUSENTE')
  UNION ALL
  SELECT 'upsert_store_config: corpo e o da 20261244000000, que grava as duas chaves novas (md5)',
         '391e8e1064400df5aea579f3472b203c',
         COALESCE((SELECT CASE WHEN f.m = 'aa4ed730ac6ad3d3c2644b4285ff39a9' THEN '391e8e1064400df5aea579f3472b203c' ELSE f.m END FROM fns f WHERE f.nome = 'upsert_store_config'), 'AUSENTE')
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
  SELECT 'store_config: local_delivery_enabled boolean NOT NULL DEFAULT true, local_delivery_days integer NOT NULL DEFAULT 1 e a CHECK do prazo de 0 a 30',
         'colunas e CHECK como o desenho diz',
         CASE WHEN to_regclass('public.store_config') IS NULL THEN 'AUSENTE'
              WHEN (SELECT n FROM colunas) = 2 AND (SELECT n FROM checagem) = 1 THEN 'colunas e CHECK como o desenho diz'
              ELSE 'DIFERENTE' END
  UNION ALL
  SELECT 'store_config_so_retirada_exige_retirada: trigger ligada (BEFORE INSERT OR UPDATE por linha), corpo da migration (md5) e a funcao dela sem EXECUTE para ninguem',
         'trigger e funcao como o desenho diz',
         CASE WHEN to_regprocedure('public.store_config_so_retirada_exige_retirada()') IS NULL THEN 'AUSENTE'
              WHEN NOT EXISTS (SELECT 1 FROM trg) THEN 'DIFERENTE'
              WHEN (SELECT md5(replace(p.prosrc, chr(13), '')) = '979fe4cc3287c6ae254223bc1c28759e'
                           AND p.prosecdef
                           AND p.proconfig = ARRAY['search_path=public, pg_temp']::text[]
                           AND NOT EXISTS (SELECT 1 FROM aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
                                            WHERE a.grantee = 0 AND a.privilege_type = 'EXECUTE')
                           AND NOT CASE WHEN to_regrole('anon') IS NULL THEN false ELSE has_function_privilege('anon', p.oid, 'EXECUTE') END
                           AND NOT CASE WHEN to_regrole('authenticated') IS NULL THEN false ELSE has_function_privilege('authenticated', p.oid, 'EXECUTE') END
                           AND NOT CASE WHEN to_regrole('service_role') IS NULL THEN false ELSE has_function_privilege('service_role', p.oid, 'EXECUTE') END
                      FROM pg_proc p
                     WHERE p.oid = to_regprocedure('public.store_config_so_retirada_exige_retirada()'))
              THEN 'trigger e funcao como o desenho diz' ELSE 'DIFERENTE' END
  UNION ALL
  SELECT 'v_store_config: as 47 colunas na ordem (as 45 de antes + local_delivery_enabled e local_delivery_days no fim), legivel por anon, authenticated e service_role',
         'e27d843e36ba4197f400d010aefe930e SELECT=anon,authenticated,service_role',
         CASE WHEN to_regclass('public.v_store_config') IS NULL THEN 'AUSENTE'
              ELSE (SELECT CASE WHEN v.m = 'b7ee2c31d91549a168a502de0ac4c5d2' THEN 'e27d843e36ba4197f400d010aefe930e' ELSE v.m END FROM visao v)
                   || ' SELECT=' || CASE WHEN to_regrole('anon') IS NOT NULL AND has_table_privilege('anon', 'public.v_store_config', 'SELECT')
                                          AND to_regrole('authenticated') IS NOT NULL AND has_table_privilege('authenticated', 'public.v_store_config', 'SELECT')
                                          AND to_regrole('service_role') IS NOT NULL AND has_table_privilege('service_role', 'public.v_store_config', 'SELECT')
                                         THEN 'anon,authenticated,service_role' ELSE 'FALTA PAPEL' END
         END
)
SELECT item, esperado, vivo, COALESCE(vivo = esperado, false) AS ok
  FROM itens
 ORDER BY ok, item;
