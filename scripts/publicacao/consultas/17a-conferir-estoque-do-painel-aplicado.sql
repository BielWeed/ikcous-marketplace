-- 17a — DEPOIS de aplicar as migrations 20261212000000, 20261213000000 e 20261214000000 (o
-- estoque do painel segue UMA regra): confere, por OBJETO, que cada uma das tres funcoes que o
-- lote troca esta com o corpo FINAL esperado, a mesma forma e a mesma ACL de antes:
--   * da 20261212000000: `painel_inicio()` (o Inicio conta estoque baixo pela regra da loja);
--   * da 20261213000000: `get_admin_products_paged(text,text,text,text,integer,integer)` (o
--     filtro de estoque baixo do admin segue a regra);
--   * da 20261214000000: `get_admin_analytics_v2(integer)` (o lucro do estoque so conta
--     produto com custo).
-- E' a prova de objetos do lote `20261212000000` + `20261213000000` + `20261214000000` em
-- scripts/frota/canais-de-backend.json: o portao (scripts/frota/publicar-release.mjs) so libera
-- a release com esta consulta POSITIVA (ou, antes do apply, NEGATIVA com a 17b positiva).
-- SO LEITURA, um unico SELECT, so catalogo (pg_proc, pg_namespace, pg_language, pg_attribute,
-- aclexplode): nenhuma linha de produto, variacao, pedido, cliente ou dinheiro e' lida nem
-- devolvida.
--
-- Saida: item | esperado | vivo | ok, com as linhas ok = false primeiro. O rol e' FECHADO:
-- sempre as mesmas 14 linhas, em qualquer estado do banco (funcao ausente vira `AUSENTE` na
-- propria linha, nunca some uma linha). Tudo `true` = as tres migrations estao inteiras no
-- banco. Um `false` nomeia a funcao (e o aspecto) que ficou de fora ou divergiu. As tres sao
-- INDEPENDENTES: uma loja com so parte do lote aplicado reprova SO nas linhas de corpo das que
-- faltam.
--
-- O QUE CADA LINHA PROVA (cada item reprova na SUA linha)
--   * controle      -- o papel enxerga as funcoes de `public` (catalogo vazio, por permissao,
--                      faria todo "AUSENTE" parecer erro).
--   * colunas       -- as 10 colunas de `produtos` e `product_variants` que as linhas novas dos
--                      tres corpos leem existem (a linha lista as que faltam).
--   * por funcao (get_admin_analytics_v2, get_admin_products_paged, painel_inicio):
--       - sobrecargas -- UMA funcao com esse nome em `public`.
--       - forma       -- linguagem, volatilidade, SECURITY DEFINER, search_path e retorno, os do
--                        cabecalho da migration (o lote nao muda nenhum deles).
--       - corpo       -- o sha256 do corpo vivo e' o da migration do lote (LF ou CRLF).
--       - EXECUTE     -- `PUBLIC=nao anon=nao authenticated=sim` (o CREATE OR REPLACE preserva a
--                        ACL da 20261178000000 e da 20261090500000). PUBLIC e' medido por
--                        aclexplode(coalesce(proacl, acldefault('f', dono))), porque
--                        has_function_privilege nao tem o pseudo-papel PUBLIC; papel que nao
--                        existe no banco aparece como `papel ausente`.
--
-- ESTA CONSULTA SO ACEITA O ESTADO DE DEPOIS DO LOTE. O estado de antes (os corpos da
-- 20261199000000 e da baseline) reprova de proposito (e e' o que a 17b confirma). A 8e (lote
-- 92-202) JA aceita, funcao por funcao, o corpo da 20261199000000 OU o da sucessora
-- (20261212000000 e 20261214000000): a mesma loja nunca fica com a 8e vermelha por este lote.
--
-- CADEIA FUTURA (importante): esta consulta fixa o corpo FINAL de cada funcao do lote. A proxima
-- migration que redefinir uma dessas tres funcoes atualiza a 17a (e decide o que fazer com a
-- loja parada no corpo deste lote), como o item 14 do runbook e o aviso do CTE `sucessoras` da 8e
-- -- senao, depois do apply dela, esta consulta fica NEGATIVA e o portao PARA (falha fechada).
--
-- sha256 = encode(sha256(convert_to(prosrc, 'UTF8')), 'hex'). Cada hash aparece aqui uma vez em
-- LF e uma em CRLF; tests/ci_conferir_banco_test.ts os recalcula dos ARQUIVOS das migrations
-- desta arvore (e confere que o md5 do LF e' o `hash_desta` do pre-voo de cada migration e do
-- rollback-manual dela, e o do CTE `sucessoras` da 8e), e
-- tests/banco/estoque-do-painel-portao-viva.cjs roda esta consulta num Postgres real (positiva
-- depois do apply, e um negativo por linha).
--
-- LIMITES: nao prova o COMPORTAMENTO (isso e' a prova viva das migrations); prova que o objeto
-- vivo e' o das migrations. NAO le dado: nao diz quantos produtos estao com estoque baixo. Nao
-- confere o DONO das funcoes (o lote nao o muda) nem o EXECUTE de service_role (nenhuma
-- migration o fixa). O texto de `proconfig` de `get_admin_products_paged`
-- (`search_path=public, extensions`) e' o que o Postgres imprime para `SET search_path TO
-- 'public', 'extensions'`; a prova viva o mede. Evidencia LOCAL nao prova a IKCOUS nem a Savy:
-- so o run desta consulta contra o ref de cada loja.
WITH alvo(nome, assinatura) AS (
  VALUES ('get_admin_analytics_v2', 'public.get_admin_analytics_v2(integer)'),
         ('get_admin_products_paged', 'public.get_admin_products_paged(text,text,text,text,integer,integer)'),
         ('painel_inicio', 'public.painel_inicio()')
), fn AS (
  SELECT t.nome,
         (SELECT count(*) FROM pg_proc q JOIN pg_namespace n ON n.oid = q.pronamespace
           WHERE n.nspname = 'public' AND q.proname = t.nome) AS sobrecargas,
         l.lanname
           || CASE p.provolatile WHEN 'i' THEN ' IMMUTABLE' WHEN 's' THEN ' STABLE' ELSE ' VOLATILE' END
           || CASE WHEN p.prosecdef THEN ' SECURITY DEFINER' ELSE ' SECURITY INVOKER' END
           || ' ' || COALESCE(array_to_string(p.proconfig, ','), 'sem search_path')
           || ' -> ' || p.prorettype::regtype::text AS forma,
         encode(sha256(convert_to(p.prosrc, 'UTF8')), 'hex') AS h,
         p.oid IS NOT NULL AS existe,
         EXISTS (SELECT 1 FROM aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
                  WHERE a.grantee = 0 AND a.privilege_type = 'EXECUTE') AS exec_public,
         CASE WHEN to_regrole('anon') IS NULL THEN NULL
              ELSE has_function_privilege('anon', p.oid, 'EXECUTE') END AS exec_anon,
         CASE WHEN to_regrole('authenticated') IS NULL THEN NULL
              ELSE has_function_privilege('authenticated', p.oid, 'EXECUTE') END AS exec_auth
    FROM alvo t
    LEFT JOIN pg_proc p ON p.oid = to_regprocedure(t.assinatura)
    LEFT JOIN pg_language l ON l.oid = p.prolang
), faltam AS (
  SELECT v.item AS coluna
    FROM unnest(ARRAY[
           'product_variants.active', 'product_variants.product_id', 'product_variants.stock_increment',
           'produtos.ativo', 'produtos.custo', 'produtos.deleted_at', 'produtos.estoque',
           'produtos.estoque_minimo', 'produtos.id', 'produtos.preco_venda'
         ]) AS v(item)
   WHERE NOT EXISTS (
           SELECT 1 FROM pg_attribute a
            WHERE a.attrelid = to_regclass('public.' || split_part(v.item, '.', 1))
              AND a.attname = split_part(v.item, '.', 2)
              AND a.attnum > 0 AND NOT a.attisdropped)
), itens(item, esperado, vivo) AS (
  SELECT 'controle: funcoes de public visiveis a este papel', '>0',
         CASE WHEN (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                     WHERE n.nspname = 'public') > 0 THEN '>0' ELSE '0' END
  UNION ALL
  SELECT 'produtos e product_variants: colunas que os corpos novos leem', 'EXISTEM',
         COALESCE((SELECT 'AUSENTES: ' || string_agg(f.coluna, ', ' ORDER BY f.coluna) FROM faltam f),
                  'EXISTEM')
  -- get_admin_analytics_v2 (o corpo da 20261214000000)
  UNION ALL
  SELECT 'get_admin_analytics_v2: sobrecargas', '1',
         (SELECT f.sobrecargas::text FROM fn f WHERE f.nome = 'get_admin_analytics_v2')
  UNION ALL
  SELECT 'get_admin_analytics_v2: forma', 'plpgsql VOLATILE SECURITY DEFINER search_path=public -> json',
         COALESCE((SELECT f.forma FROM fn f WHERE f.nome = 'get_admin_analytics_v2'), 'AUSENTE')
  UNION ALL
  SELECT 'get_admin_analytics_v2: corpo e o da 20261214000000 (sha256)',
         '297e4f2919cfdd3c2a3f66ebaa7109ced7e9602b435f67f07087a1da259558dc',
         COALESCE((SELECT CASE WHEN f.h IN ('297e4f2919cfdd3c2a3f66ebaa7109ced7e9602b435f67f07087a1da259558dc',
                                            'b87b17e30345c7764ed4e78f9faf0336d7de02313b3b471e975dab26a5b0ee4f')
                               THEN '297e4f2919cfdd3c2a3f66ebaa7109ced7e9602b435f67f07087a1da259558dc'
                               ELSE f.h END
                     FROM fn f WHERE f.nome = 'get_admin_analytics_v2'), 'AUSENTE')
  UNION ALL
  SELECT 'get_admin_analytics_v2: EXECUTE', 'PUBLIC=nao anon=nao authenticated=sim',
         COALESCE((SELECT CASE WHEN NOT f.existe THEN NULL
                               ELSE 'PUBLIC=' || CASE WHEN f.exec_public THEN 'sim' ELSE 'nao' END
                                    || ' anon=' || CASE WHEN f.exec_anon IS NULL THEN 'papel ausente'
                                                        WHEN f.exec_anon THEN 'sim' ELSE 'nao' END
                                    || ' authenticated=' || CASE WHEN f.exec_auth IS NULL THEN 'papel ausente'
                                                                 WHEN f.exec_auth THEN 'sim' ELSE 'nao' END END
                     FROM fn f WHERE f.nome = 'get_admin_analytics_v2'), 'AUSENTE')
  -- get_admin_products_paged (o corpo da 20261213000000)
  UNION ALL
  SELECT 'get_admin_products_paged: sobrecargas', '1',
         (SELECT f.sobrecargas::text FROM fn f WHERE f.nome = 'get_admin_products_paged')
  UNION ALL
  SELECT 'get_admin_products_paged: forma', 'plpgsql VOLATILE SECURITY DEFINER search_path=public, extensions -> jsonb',
         COALESCE((SELECT f.forma FROM fn f WHERE f.nome = 'get_admin_products_paged'), 'AUSENTE')
  UNION ALL
  SELECT 'get_admin_products_paged: corpo e o da 20261213000000 (sha256)',
         'ce2d99a8fc28deece0e72a2c678bb92ab0ea50073631e2307c0d053b70e98501',
         COALESCE((SELECT CASE WHEN f.h IN ('ce2d99a8fc28deece0e72a2c678bb92ab0ea50073631e2307c0d053b70e98501',
                                            '0924946faa9dc2c66de1622a9ddc60fabf7abb96147aeba2584ca44d7025ca81')
                               THEN 'ce2d99a8fc28deece0e72a2c678bb92ab0ea50073631e2307c0d053b70e98501'
                               ELSE f.h END
                     FROM fn f WHERE f.nome = 'get_admin_products_paged'), 'AUSENTE')
  UNION ALL
  SELECT 'get_admin_products_paged: EXECUTE', 'PUBLIC=nao anon=nao authenticated=sim',
         COALESCE((SELECT CASE WHEN NOT f.existe THEN NULL
                               ELSE 'PUBLIC=' || CASE WHEN f.exec_public THEN 'sim' ELSE 'nao' END
                                    || ' anon=' || CASE WHEN f.exec_anon IS NULL THEN 'papel ausente'
                                                        WHEN f.exec_anon THEN 'sim' ELSE 'nao' END
                                    || ' authenticated=' || CASE WHEN f.exec_auth IS NULL THEN 'papel ausente'
                                                                 WHEN f.exec_auth THEN 'sim' ELSE 'nao' END END
                     FROM fn f WHERE f.nome = 'get_admin_products_paged'), 'AUSENTE')
  -- painel_inicio (o corpo da 20261212000000)
  UNION ALL
  SELECT 'painel_inicio: sobrecargas', '1',
         (SELECT f.sobrecargas::text FROM fn f WHERE f.nome = 'painel_inicio')
  UNION ALL
  SELECT 'painel_inicio: forma', 'plpgsql STABLE SECURITY DEFINER search_path=public -> jsonb',
         COALESCE((SELECT f.forma FROM fn f WHERE f.nome = 'painel_inicio'), 'AUSENTE')
  UNION ALL
  SELECT 'painel_inicio: corpo e o da 20261212000000 (sha256)',
         '5b26c34030a7de32033b53894f8da19d850bf116b31208bb5b1195dcec0925db',
         COALESCE((SELECT CASE WHEN f.h IN ('5b26c34030a7de32033b53894f8da19d850bf116b31208bb5b1195dcec0925db',
                                            '77cc91fbe8e03fbd89ee163046101804abf6dbf7fc1c2b4bc9ee5a1d97df64cf')
                               THEN '5b26c34030a7de32033b53894f8da19d850bf116b31208bb5b1195dcec0925db'
                               ELSE f.h END
                     FROM fn f WHERE f.nome = 'painel_inicio'), 'AUSENTE')
  UNION ALL
  SELECT 'painel_inicio: EXECUTE', 'PUBLIC=nao anon=nao authenticated=sim',
         COALESCE((SELECT CASE WHEN NOT f.existe THEN NULL
                               ELSE 'PUBLIC=' || CASE WHEN f.exec_public THEN 'sim' ELSE 'nao' END
                                    || ' anon=' || CASE WHEN f.exec_anon IS NULL THEN 'papel ausente'
                                                        WHEN f.exec_anon THEN 'sim' ELSE 'nao' END
                                    || ' authenticated=' || CASE WHEN f.exec_auth IS NULL THEN 'papel ausente'
                                                                 WHEN f.exec_auth THEN 'sim' ELSE 'nao' END END
                     FROM fn f WHERE f.nome = 'painel_inicio'), 'AUSENTE')
)
SELECT item, esperado, vivo, COALESCE(vivo = esperado, false) AS ok
  FROM itens
 ORDER BY ok, item;
