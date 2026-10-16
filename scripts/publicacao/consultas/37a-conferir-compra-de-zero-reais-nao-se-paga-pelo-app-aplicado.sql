-- 37a — DEPOIS de aplicar a migration 20261236000000 (a compra que da R$ 0,00 nao se paga pelo app: a
-- `create_marketplace_order_v24` recusa, ANTES de gravar o pedido, de baixar o estoque e de gastar a vaga do cupom, o
-- pedido de pagamento pelo app (`p_payment_method = 'online'`) cujo total calculado pelo servidor, arredondado em 2 casas,
-- e' zero): confirma, POR OBJETO, que o corpo vivo de `create_marketplace_order_v24` e' o NOVO (o da 20261229000000 mais o
-- bloco 6-ter, md5), que o corpo traz a recusa, que a funcao mantem os atributos de sempre (SECURITY DEFINER, plpgsql,
-- VOLATILE, `search_path=public`, retorno uuid) e que a ACL segue a de sempre (PUBLIC sem EXECUTE; anon, authenticated e
-- service_role com: o checkout da convidada usa anon). E' a consulta do lote em `provasDeObjetos` de
-- scripts/frota/canais-de-backend.json; a de ausencia e' a 37b.
-- SO LEITURA, um unico SELECT, so catalogo (pg_proc, pg_namespace, pg_language, aclexplode): nenhuma linha de pedido, de
-- cupom, de produto ou de cliente e' lida nem devolvida.
--
-- Saida: item | esperado | vivo | ok, com as linhas ok = false primeiro. Rol FECHADO de 6 linhas, as mesmas em qualquer
-- estado do banco (funcao ausente vira `AUSENTE` na propria linha, nunca some uma linha). Tudo `true` = a recusa esta
-- aplicada; qualquer `false` = PARE e leia a linha. Depois do rollback-manual reprovam SO as duas linhas do corpo (md5 e
-- marcador).
--
--   * sobrecargas -- UMA funcao com esse nome em `public`.
--   * corpo   -- md5(replace(prosrc, chr(13), '')) do corpo vivo (LF ou CRLF): o da 20261236000000.
--   * marcador -- 'sim' se o corpo traz a condicao da recusa (`IF p_payment_method = 'online' AND round(v_calculated_total,
--                2) <= 0 THEN`) e o identificador estavel dela (`pedido_sem_valor_a_pagar_pelo_app`). Leitura humana do
--                mesmo fato do md5; a ORDEM (antes do pedido, do estoque e do cupom) e' do COMPORTAMENTO, que
--                tests/banco/a-compra-que-da-zero-reais-nao-se-paga-pelo-app-viva.cjs prova por uma sequencia movida por
--                gatilhos.
--   * atributos -- SECURITY DEFINER + plpgsql + VOLATILE + nao SETOF + `search_path=public` + retorno uuid.
--   * EXECUTE -- PUBLIC e' medido por aclexplode(coalesce(proacl, acldefault('f', dono))), porque has_function_privilege
--                nao tem o pseudo-papel PUBLIC; anon, authenticated e service_role por has_function_privilege.
--
-- CADEIA: o corpo desta consulta e' o SUCESSOR do da 20261229000000 (o endereco da compra fica no pedido, a 20261229000000): a
-- 31a (o lote da 20261229000000) aceita este corpo ao lado do da 20261229000000 em `create_marketplace_order_v24` e segue POSITIVA depois
-- deste lote. A `create_marketplace_order_v23` (compra na entrega) NAO e' tocada.
--
-- md5 recalculado dos ARQUIVOS das migrations por tests/ci_conferir_banco_test.ts e por tests/migration_a_compra_que_da_zero_reais_nao_se_paga_pelo_app_test.ts;
-- tests/banco/a-compra-que-da-zero-reais-nao-se-paga-pelo-app-portao-viva.cjs roda esta consulta num Postgres real
-- (positiva depois do apply, negativa depois do rollback, um negativo por linha). LIMITES: nao prova o COMPORTAMENTO (isso e'
-- de tests/banco/a-compra-que-da-zero-reais-nao-se-paga-pelo-app-viva.cjs). Evidencia LOCAL nao prova a IKCOUS nem a Savy:
-- so o run desta consulta contra o ref de cada loja.
WITH alvo(assinatura) AS (
  VALUES ('public.create_marketplace_order_v24(jsonb, numeric, numeric, text, uuid, text, text, text, text, jsonb, text, text, uuid)')
), fn AS (
  SELECT p.oid,
         (SELECT count(*) FROM pg_proc q JOIN pg_namespace n ON n.oid = q.pronamespace
           WHERE n.nspname = 'public' AND q.proname = 'create_marketplace_order_v24') AS sobrecargas,
         md5(replace(p.prosrc, chr(13), '')) AS m,
         CASE WHEN position('IF p_payment_method = ''online'' AND round(v_calculated_total, 2) <= 0 THEN' IN p.prosrc) > 0
                   AND position('pedido_sem_valor_a_pagar_pelo_app' IN p.prosrc) > 0
              THEN 'sim' ELSE 'nao' END AS marcador,
         CASE WHEN p.prosecdef AND l.lanname = 'plpgsql' AND p.provolatile = 'v' AND NOT p.proretset
                   AND p.proconfig = ARRAY['search_path=public']::text[]
                   AND p.prorettype = 'uuid'::regtype
              THEN 'SECURITY DEFINER plpgsql VOLATILE search_path=public -> uuid' ELSE 'DIFERENTE' END AS atributos,
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
  SELECT 'create_marketplace_order_v24: sobrecargas', '1',
         COALESCE((SELECT f.sobrecargas::text FROM fn f), 'AUSENTE')
  UNION ALL
  SELECT 'create_marketplace_order_v24: corpo e o da 20261236000000, com a recusa do total zero pelo app (md5)',
         '6002fc8db6c1d402bc704f018a0c2621',
         -- 2 hashes aceitos: o corpo da 20261236000000 OU o da SUCESSORA dele, a 20261244000000 (a loja escolhe como
         -- entrega na cidade: o mesmo corpo mais o So retiro, com a recusa do total zero intacta). O `vivo` mostra o esperado.
         COALESCE((SELECT CASE WHEN f.m IN ('6002fc8db6c1d402bc704f018a0c2621', '85c37af4baa2f5ce1375bdd9e943c746')
                               THEN '6002fc8db6c1d402bc704f018a0c2621'
                               ELSE f.m END
                     FROM fn f), 'AUSENTE')
  UNION ALL
  SELECT 'create_marketplace_order_v24: o corpo recusa o pedido pelo app cujo total do servidor e zero',
         'sim',
         COALESCE((SELECT f.marcador FROM fn f), 'AUSENTE')
  UNION ALL
  SELECT 'create_marketplace_order_v24: atributos de sempre (SECURITY DEFINER, VOLATILE, search_path=public)',
         'SECURITY DEFINER plpgsql VOLATILE search_path=public -> uuid',
         COALESCE((SELECT f.atributos FROM fn f), 'AUSENTE')
  UNION ALL
  SELECT 'create_marketplace_order_v24: EXECUTE de sempre (anon, authenticated e service_role sim; PUBLIC nao)',
         'PUBLIC=nao anon=sim authenticated=sim service_role=sim',
         COALESCE((SELECT f.acl FROM fn f), 'AUSENTE')
)
SELECT item, esperado, vivo, COALESCE(vivo = esperado, false) AS ok
  FROM itens
 ORDER BY ok, item;
