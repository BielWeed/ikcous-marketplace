-- 17b — ANTES de aplicar as migrations 20261212000000, 20261213000000 e 20261214000000 (o
-- estoque do painel segue UMA regra: o Inicio conta estoque baixo pela regra da loja, o filtro
-- de estoque baixo do admin segue a mesma regra e o lucro do estoque so conta produto com
-- custo): confirma que as tres funcoes que o lote troca estao com o corpo VIGENTE de antes
-- (`get_admin_analytics_v2` e `painel_inicio` como a 20261199000000 as deixa,
-- `get_admin_products_paged` como a baseline 20260806000000 a deixa), com UMA sobrecarga cada,
-- com o EXECUTE que o painel usa (so authenticated) e que as colunas que os trechos novos leem
-- EXISTEM. E' a consulta de AUSENCIA do lote (`ausenciaConfirmadaPor` em
-- scripts/frota/canais-de-backend.json): so com a 17a NEGATIVA e esta POSITIVA (da mesma janela
-- ou mais nova) o portao (scripts/frota/publicar-release.mjs) imprime o apply dos TRES arquivos.
-- SO LEITURA, um unico SELECT, so catalogo (pg_proc, pg_namespace, pg_attribute, aclexplode):
-- nenhuma linha de produto, variacao, pedido, cliente ou dinheiro e' lida nem devolvida.
--
-- POR OBJETO, nunca por `schema_migrations`: o registro do ledger nao prova o que esta no
-- banco (o dono aplica a mao, o ledger pode estar vazio ou adiantado).
--
-- Saida: item | esperado | vivo | ok, com as linhas ok = false primeiro. Rol FECHADO de 11
-- linhas, as mesmas em qualquer estado do banco (funcao ausente vira `AUSENTE` na propria
-- linha, nunca some uma linha). Tudo `true` = a loja esta na base de antes das tres migrations
-- e elas podem ser aplicadas; qualquer `false` = PARE e leia a linha (a migration, se aplicada
-- assim, abortaria no pre-voo `B1_BASELINE_DIVERGENT` -- aqui a gente descobre ANTES, por
-- leitura). Uma loja com UMA das tres ja aplicada reprova aqui de proposito, na linha do corpo
-- daquela funcao: esta consulta e' "antes".
--
-- O QUE CADA LINHA PROVA (as mesmas condicoes dos pre-voos, mais a ACL e as colunas)
--   * controle      -- o papel enxerga as funcoes de `public` (catalogo vazio, por permissao,
--                      faria todo "AUSENTE" parecer prova de ausencia).
--   * colunas       -- as 10 colunas de `produtos` e `product_variants` que as linhas novas dos
--                      tres corpos leem existem (a linha lista as que faltam). plpgsql so
--                      resolve coluna ao EXECUTAR: uma coluna renomeada nao barra o apply, quebra
--                      o painel depois.
--   * por funcao (get_admin_analytics_v2, get_admin_products_paged, painel_inicio):
--       - sobrecargas -- UMA funcao com esse nome em `public` (uma sobrecarga alheia reprova:
--                        o CREATE OR REPLACE do lote so troca a da assinatura do pre-voo).
--       - corpo       -- o sha256 do corpo vivo e' o do ANTES (LF ou CRLF): o da 20261199000000
--                        (analytics e painel_inicio) ou o da baseline (products_paged). Outro
--                        corpo (a migration do lote ja aplicada, ou uma redefinicao que o lote
--                        nao conhece) reprova aqui, antes de qualquer apply.
--       - EXECUTE     -- `PUBLIC=nao anon=nao authenticated=sim`, a ACL que a 20261178000000
--                        (painel_inicio) e a 20261090500000 (analytics e products_paged) deixam.
--                        O CREATE OR REPLACE PRESERVA a ACL: uma loja fora disto continua fora
--                        depois do apply, entao o portao PARA antes de escrever. PUBLIC e' medido
--                        por aclexplode(coalesce(proacl, acldefault('f', dono))), porque
--                        has_function_privilege nao tem o pseudo-papel PUBLIC; papel que nao
--                        existe no banco aparece como `papel ausente`.
--
-- sha256 = encode(sha256(convert_to(prosrc, 'UTF8')), 'hex'). Cada hash aparece aqui uma vez em
-- LF e uma em CRLF; tests/ci_conferir_banco_test.ts os recalcula dos ARQUIVOS das migrations
-- desta arvore (e confere que o md5 do LF e' o `hash_vigente` do pre-voo de cada migration do
-- lote e que cada rollback-manual devolve este mesmo corpo), e
-- tests/banco/estoque-do-painel-portao-viva.cjs roda esta consulta num Postgres real
-- (positiva antes do apply e depois dos rollbacks, e um negativo por linha).
--
-- LIMITES: nao prova o COMPORTAMENTO (isso e' a prova viva das migrations). Nao le dado
-- nenhum: nao diz quantos produtos estao com estoque baixo. Nao confere o DONO das funcoes
-- (o lote nao o muda) nem o EXECUTE de service_role (nenhuma migration o fixa). Evidencia LOCAL
-- nao prova a IKCOUS nem a Savy: so o run desta consulta contra o ref de cada loja.
WITH alvo(nome, assinatura) AS (
  VALUES ('get_admin_analytics_v2', 'public.get_admin_analytics_v2(integer)'),
         ('get_admin_products_paged', 'public.get_admin_products_paged(text,text,text,text,integer,integer)'),
         ('painel_inicio', 'public.painel_inicio()')
), fn AS (
  SELECT t.nome,
         (SELECT count(*) FROM pg_proc q JOIN pg_namespace n ON n.oid = q.pronamespace
           WHERE n.nspname = 'public' AND q.proname = t.nome) AS sobrecargas,
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
  -- get_admin_analytics_v2 (a 20261214000000 troca o corpo da 20261199000000)
  UNION ALL
  SELECT 'get_admin_analytics_v2: sobrecargas', '1',
         (SELECT f.sobrecargas::text FROM fn f WHERE f.nome = 'get_admin_analytics_v2')
  UNION ALL
  SELECT 'get_admin_analytics_v2: corpo e o da 20261199000000 (sha256)',
         'a7fe2040a1fe81a0ae3bac40ab7f0b66453be63848aeb8022dff8fcdeea331ab',
         COALESCE((SELECT CASE WHEN f.h IN ('a7fe2040a1fe81a0ae3bac40ab7f0b66453be63848aeb8022dff8fcdeea331ab',
                                            '310d5767b47e7c11f50a944f7b0382f7b8060a385e9a25f69ca3fd28186dd372')
                               THEN 'a7fe2040a1fe81a0ae3bac40ab7f0b66453be63848aeb8022dff8fcdeea331ab'
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
  -- get_admin_products_paged (a 20261213000000 troca o corpo da baseline 20260806000000)
  UNION ALL
  SELECT 'get_admin_products_paged: sobrecargas', '1',
         (SELECT f.sobrecargas::text FROM fn f WHERE f.nome = 'get_admin_products_paged')
  UNION ALL
  SELECT 'get_admin_products_paged: corpo e o da 20260806000000 (sha256)',
         '68704382b1f9259e8e969cbec4ab531ddc5259b987a6b84ed9d17631844f9ea5',
         COALESCE((SELECT CASE WHEN f.h IN ('68704382b1f9259e8e969cbec4ab531ddc5259b987a6b84ed9d17631844f9ea5',
                                            '5ae297a1b62f9530ff3a161a6aa4a2a67fef2ac9a4bd2de346618b58ffd3745f')
                               THEN '68704382b1f9259e8e969cbec4ab531ddc5259b987a6b84ed9d17631844f9ea5'
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
  -- painel_inicio (a 20261212000000 troca o corpo da 20261199000000)
  UNION ALL
  SELECT 'painel_inicio: sobrecargas', '1',
         (SELECT f.sobrecargas::text FROM fn f WHERE f.nome = 'painel_inicio')
  UNION ALL
  SELECT 'painel_inicio: corpo e o da 20261199000000 (sha256)',
         'b23b0bc953969078b13c7187ec6415ccf8d13b0bf9a08bb6f4ba5f659e7557c2',
         COALESCE((SELECT CASE WHEN f.h IN ('b23b0bc953969078b13c7187ec6415ccf8d13b0bf9a08bb6f4ba5f659e7557c2',
                                            'e84b73ee8f422f9b2fb75bcf8cb6f6cd3310989c55759af4e82e05345c99c3df')
                               THEN 'b23b0bc953969078b13c7187ec6415ccf8d13b0bf9a08bb6f4ba5f659e7557c2'
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
