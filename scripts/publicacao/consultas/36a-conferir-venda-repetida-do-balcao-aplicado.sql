-- 36a — DEPOIS de aplicar a migration 20261235000000 (a venda repetida do balcao devolve a venda feita: a RPC do PDV
-- `registrar_venda_presencial` toma uma trava consultiva pela chave de idempotencia ANTES de conferir a chave, e a
-- repeticao que chega antes de a primeira commitar espera a primeira e devolve `ja_existia` com o MESMO pedido, em vez de
-- "Estoque insuficiente" quando a primeira levou a ultima unidade): confirma, POR OBJETO, que o corpo vivo de
-- `registrar_venda_presencial(jsonb,text,uuid,text,text,numeric,text,uuid)` e o NOVO (md5), que traz a trava pela chave,
-- que mantem os atributos de sempre (SECURITY DEFINER, plpgsql, VOLATILE, nao STRICT, 8 argumentos,
-- search_path=pg_catalog, pg_temp, retorno jsonb) e que a ACL segue a de sempre (EXECUTE so para authenticated; PUBLIC, anon
-- e service_role sem). E' a consulta do lote em `provasDeObjetos` de scripts/frota/canais-de-backend.json; a de
-- ausencia e' a 36b.
-- SO LEITURA, um unico SELECT, so catalogo (pg_proc, pg_namespace, pg_language, aclexplode): nenhuma linha de
-- venda, de pedido, de produto ou de cliente e' lida nem devolvida.
--
-- Saida: item | esperado | vivo | ok, com as linhas ok = false primeiro. Rol FECHADO de 6 linhas, as mesmas
-- em qualquer estado do banco (funcao ausente vira `AUSENTE` na propria linha, nunca some uma linha). Tudo
-- `true` = a trava pela chave esta aplicada; qualquer `false` = PARE e leia a linha. Depois do rollback-manual
-- reprovam SO as duas linhas do corpo (md5 e marcador).
--
--   * sobrecargas -- UMA funcao com esse nome em `public`.
--   * corpo   -- md5(replace(prosrc, chr(13), '')): o da 20261235000000 OU a sucessora EXATA 20261249000000.
--                A sucessora preserva a trava; seu hash aceito mostra o esperado da 235. Corpo estranho reprova.
--   * marcador -- 'sim' se o corpo traz a trava pela chave
--                (`hashtextextended('venda_presencial:' || p_idempotency_key::text, 0)`). Leitura humana do mesmo fato
--                do md5.
--   * atributos -- SECURITY DEFINER + plpgsql + VOLATILE + nao STRICT + 8 argumentos + `search_path=pg_catalog, pg_temp`
--                + retorno jsonb.
--   * EXECUTE -- PUBLIC e' medido por aclexplode(coalesce(proacl, acldefault('f', dono))), porque
--                has_function_privilege nao tem o pseudo-papel PUBLIC; anon, authenticated e service_role por
--                has_function_privilege. Os mesmos quatro fatos que o pre-voo e a conferencia final da migration
--                exigem.
--
-- CADEIA: o corpo desta consulta e' o SUCESSOR da 20261199000000 (portas do painel exigem o admin atual): nao ha
-- redefinicao entre as duas. Depois a 249 sucede a 235 sem perder a trava: a 8e (lote 92-202) guarda os corpos
-- da 99, da 235 e da 249; a 9a (lote 60-66) fixa SO o final da 249, nao o intermediario da 235.
-- A 36a prova a trava da 235, inclusive com a 249 no ar; a 52a prova o motivo privado da 249.
--
-- md5 recalculado dos ARQUIVOS das migrations por tests/ci_conferir_banco_test.ts e por tests/migration_a_venda_repetida_do_balcao_devolve_a_venda_feita_test.ts;
-- tests/banco/venda-balcao-mesma-chave-portao-viva.cjs roda esta consulta num Postgres real (positiva depois do apply,
-- negativa depois do rollback, um negativo por linha).
-- LIMITES: nao prova o COMPORTAMENTO (a espera pela primeira, o ja_existia com o mesmo pedido: isso e' de
-- tests/banco/venda-balcao-mesma-chave-viva.cjs, com duas conexoes reais). Evidencia LOCAL nao prova a IKCOUS nem a Savy:
-- so o run desta consulta contra o ref de cada loja.
WITH alvo(assinatura) AS (
  VALUES ('public.registrar_venda_presencial(jsonb,text,uuid,text,text,numeric,text,uuid)')
), fn AS (
  SELECT p.oid,
         (SELECT count(*) FROM pg_proc q JOIN pg_namespace n ON n.oid = q.pronamespace
           WHERE n.nspname = 'public' AND q.proname = 'registrar_venda_presencial') AS sobrecargas,
         md5(replace(p.prosrc, chr(13), '')) AS m,
         CASE WHEN position('hashtextextended(''venda_presencial:'' || p_idempotency_key::text, 0)' IN p.prosrc) > 0
              THEN 'sim' ELSE 'nao' END AS marcador,
         CASE WHEN p.prosecdef AND l.lanname = 'plpgsql' AND p.provolatile = 'v'
                   AND NOT p.proisstrict AND NOT p.proretset AND p.pronargs = 8
                   AND p.proconfig = ARRAY['search_path=pg_catalog, pg_temp']::text[]
                   AND p.prorettype = 'jsonb'::regtype
              THEN 'SECURITY DEFINER plpgsql VOLATILE search_path=pg_catalog, pg_temp -> jsonb'
              ELSE 'DIFERENTE' END AS atributos,
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
  SELECT 'registrar_venda_presencial: sobrecargas', '1',
         COALESCE((SELECT f.sobrecargas::text FROM fn f), 'AUSENTE')
  UNION ALL
  SELECT 'registrar_venda_presencial: corpo e o da 20261235000000, com a trava pela chave (md5)',
         '996caf02505ac16a8bded73bcf8900aa',
         COALESCE((SELECT CASE WHEN f.m = '796e0aaeb00b6f5133a54ce12f2df396'
                               THEN '996caf02505ac16a8bded73bcf8900aa' ELSE f.m END FROM fn f), 'AUSENTE')
  UNION ALL
  SELECT 'registrar_venda_presencial: o corpo toma a trava consultiva pela chave de idempotencia',
         'sim',
         COALESCE((SELECT f.marcador FROM fn f), 'AUSENTE')
  UNION ALL
  SELECT 'registrar_venda_presencial: atributos de sempre (SECURITY DEFINER, VOLATILE, search_path=pg_catalog, pg_temp)',
         'SECURITY DEFINER plpgsql VOLATILE search_path=pg_catalog, pg_temp -> jsonb',
         COALESCE((SELECT f.atributos FROM fn f), 'AUSENTE')
  UNION ALL
  SELECT 'registrar_venda_presencial: EXECUTE so para authenticated (PUBLIC, anon e service_role sem)',
         'PUBLIC=nao anon=nao authenticated=sim service_role=nao',
         COALESCE((SELECT f.acl FROM fn f), 'AUSENTE')
)
SELECT item, esperado, vivo, COALESCE(vivo = esperado, false) AS ok
  FROM itens
 ORDER BY ok, item;
