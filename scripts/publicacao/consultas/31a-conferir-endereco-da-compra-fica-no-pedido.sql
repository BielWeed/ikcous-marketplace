-- 31a — DEPOIS de aplicar a migration 20261229000000 (o endereco da compra fica no pedido: `create_marketplace_order_v23`
-- e `create_marketplace_order_v24` passam a copiar o endereco da conta para `customer_data.address` no instante da
-- compra): confirma, POR OBJETO, que o corpo vivo de cada uma e' o NOVO (o da 20261174000000 mais o bloco 6-bis, md5),
-- que o corpo copia o endereco ANTES de gravar o pedido, que as funcoes mantem os atributos de sempre (SECURITY
-- DEFINER, plpgsql, VOLATILE, `search_path=public`) e que a ACL segue a de sempre (PUBLIC sem EXECUTE; anon,
-- authenticated e service_role com: o checkout da convidada usa anon). E' a consulta do lote em `provasDeObjetos` de
-- scripts/frota/canais-de-backend.json; a de ausencia e' a 31b.
-- SO LEITURA, um unico SELECT, so catalogo (pg_proc, pg_namespace, pg_language, aclexplode): nenhuma linha de pedido,
-- de endereco ou de cliente e' lida nem devolvida.
--
-- Saida: item | esperado | vivo | ok, com as linhas ok = false primeiro. Rol FECHADO de 9 linhas, as mesmas em qualquer
-- estado do banco (funcao ausente vira `AUSENTE` na propria linha, nunca some uma linha). Tudo `true` = o corte esta
-- aplicado; qualquer `false` = PARE e leia a linha. Depois do rollback-manual (os corpos antigos de volta) reprovam SO as
-- quatro linhas dos corpos (md5 e copia, das duas funcoes).
--
--   * corpo   -- md5(replace(prosrc, chr(13), '')) do corpo vivo (LF ou CRLF): o da 20261229000000.
--   * copia   -- 'sim' se `FROM public.user_addresses ua` aparece no corpo ANTES do `INSERT INTO public.marketplace_orders`
--                (o pedido): leitura humana do mesmo fato do md5.
--   * atributos -- SECURITY DEFINER + plpgsql + VOLATILE + proconfig = {search_path=public}.
--   * EXECUTE -- PUBLIC e' medido por aclexplode(coalesce(proacl, acldefault('f', dono))), porque has_function_privilege
--                nao tem o pseudo-papel PUBLIC; anon, authenticated e service_role por has_function_privilege.
--
-- JA DECIDIDO PARA `create_marketplace_order_v24` (14/10/2026): a 20261236000000 (a compra que da R$ 0,00 nao se paga
-- pelo app) a redefine depois deste lote, em cima do corpo da 20261229000000 (o mesmo corpo mais o bloco 6-ter, que o
-- `copia` abaixo continua enxergando: a copia do endereco vem antes do INSERT do pedido). A linha
-- `create_marketplace_order_v24: corpo e o da 20261229000000` aceita o corpo da 20261229000000 OU o da 20261236000000 (o rol e os rotulos do rol
-- nao mudam): uma loja que ja recebeu a 20261236000000 nao deixa o portao vermelho no lote da 31a. Os dois hashes aceitos valem so para a
-- v24; a `create_marketplace_order_v23` segue exata.
--
-- md5 recalculado dos ARQUIVOS das migrations por tests/ci_conferir_banco_test.ts, e
-- tests/banco/endereco-no-pedido-portao-viva.cjs roda esta consulta num Postgres real (positiva depois do apply,
-- negativa depois do rollback, um negativo por linha). LIMITES: nao prova o COMPORTAMENTO (isso e' de
-- tests/banco/endereco-no-pedido-viva.cjs). Evidencia LOCAL nao prova a IKCOUS nem a Savy: so o run desta consulta
-- contra o ref de cada loja.
WITH alvo(nome, assinatura) AS (
  VALUES ('create_marketplace_order_v23', 'public.create_marketplace_order_v23(jsonb, numeric, numeric, text, uuid, text, text, text, text, jsonb, text, text, uuid)'),
         ('create_marketplace_order_v24', 'public.create_marketplace_order_v24(jsonb, numeric, numeric, text, uuid, text, text, text, text, jsonb, text, text, uuid)')
), fn AS (
  SELECT t.nome,
         md5(replace(p.prosrc, chr(13), '')) AS m,
         CASE WHEN position('FROM public.user_addresses ua' IN p.prosrc) > 0
                   AND position('FROM public.user_addresses ua' IN p.prosrc) < position('INSERT INTO public.marketplace_orders' IN p.prosrc)
              THEN 'sim' ELSE 'nao' END AS copia,
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
  SELECT 'create_marketplace_order_v23: corpo e o da 20261229000000, com a copia do endereco (md5)',
         '6cb5a00cfa290f00dc9de053fee40759',
         -- 3 hashes aceitos: o corpo da 20261229000000 OU o da SUCESSORA dele, a 20261244000000 (a loja escolhe como
         -- entrega na cidade: o mesmo corpo mais o So retiro) OU o da sucessora desta, a 20261350000000 (a compra online
         -- trava o preco e espera a mesma chave). O `vivo` mostra o esperado.
         COALESCE((SELECT CASE WHEN f.m IN ('6cb5a00cfa290f00dc9de053fee40759', '79445d64a87843be2d42bf601c7090ec', '415eae034b8e995c2bd2db0bbbc49391')
                               THEN '6cb5a00cfa290f00dc9de053fee40759'
                               ELSE f.m END
                     FROM fn f WHERE f.nome = 'create_marketplace_order_v23'), 'AUSENTE')
  UNION ALL
  SELECT 'create_marketplace_order_v24: corpo e o da 20261229000000, com a copia do endereco (md5)',
         'b1ee9337105f442511c13a75977911b7',
         -- 4 hashes aceitos: o corpo da 20261229000000 OU o da SUCESSORA dele, a 20261236000000 (a compra que da
         -- R$ 0,00 nao se paga pelo app: o mesmo corpo mais o bloco 6-ter) OU o da sucessora desta, a 20261244000000
         -- (a loja escolhe como entrega na cidade) OU o da sucessora dela, a 20261350000000 (a compra online trava o
         -- preco e espera a mesma chave). O `vivo` mostra o esperado.
         COALESCE((SELECT CASE WHEN f.m IN ('b1ee9337105f442511c13a75977911b7', '6002fc8db6c1d402bc704f018a0c2621', '85c37af4baa2f5ce1375bdd9e943c746', 'e847583c98401789449275cac51ef85c')
                               THEN 'b1ee9337105f442511c13a75977911b7'
                               ELSE f.m END
                     FROM fn f WHERE f.nome = 'create_marketplace_order_v24'), 'AUSENTE')
  UNION ALL
  SELECT 'create_marketplace_order_v23: o corpo copia o endereco da conta antes de gravar o pedido',
         'sim',
         COALESCE((SELECT f.copia FROM fn f WHERE f.nome = 'create_marketplace_order_v23'), 'AUSENTE')
  UNION ALL
  SELECT 'create_marketplace_order_v24: o corpo copia o endereco da conta antes de gravar o pedido',
         'sim',
         COALESCE((SELECT f.copia FROM fn f WHERE f.nome = 'create_marketplace_order_v24'), 'AUSENTE')
  UNION ALL
  SELECT 'create_marketplace_order_v23: atributos de sempre (SECURITY DEFINER, VOLATILE, search_path=public)',
         'SECURITY DEFINER plpgsql VOLATILE search_path=public',
         COALESCE((SELECT f.atributos FROM fn f WHERE f.nome = 'create_marketplace_order_v23'), 'AUSENTE')
  UNION ALL
  SELECT 'create_marketplace_order_v24: atributos de sempre (SECURITY DEFINER, VOLATILE, search_path=public)',
         'SECURITY DEFINER plpgsql VOLATILE search_path=public',
         COALESCE((SELECT f.atributos FROM fn f WHERE f.nome = 'create_marketplace_order_v24'), 'AUSENTE')
  UNION ALL
  SELECT 'create_marketplace_order_v23: EXECUTE de sempre (anon, authenticated e service_role sim; PUBLIC nao)',
         'PUBLIC=nao anon=sim authenticated=sim service_role=sim',
         COALESCE((SELECT f.acl FROM fn f WHERE f.nome = 'create_marketplace_order_v23'), 'AUSENTE')
  UNION ALL
  SELECT 'create_marketplace_order_v24: EXECUTE de sempre (anon, authenticated e service_role sim; PUBLIC nao)',
         'PUBLIC=nao anon=sim authenticated=sim service_role=sim',
         COALESCE((SELECT f.acl FROM fn f WHERE f.nome = 'create_marketplace_order_v24'), 'AUSENTE')
)
SELECT item, esperado, vivo, COALESCE(vivo = esperado, false) AS ok
  FROM itens
 ORDER BY ok, item;
