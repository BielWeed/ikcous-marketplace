-- 15b — ANTES de aplicar a migration 20261208000000 (o checkout mostra os cupons da
-- cliente: `coupons.alcance`, `cupom_clientes`, `cupons_do_checkout`, as duas funcoes do
-- painel, o gatilho do exclusivo e a nova `validate_coupon_secure_v2`) numa loja: nenhuma
-- peca nova existe ainda e o banco esta exatamente na base que o pre-voo da propria
-- migration exige. E' a consulta de AUSENCIA do lote `20261208000000` em
-- scripts/frota/canais-de-backend.json (`ausenciaConfirmadaPor`): so com ela POSITIVA,
-- depois de uma 15a NEGATIVA, o portao imprime o comando de apply.
-- SO LEITURA, um unico SELECT, so catalogo (pg_attribute, pg_constraint, pg_trigger,
-- pg_proc, pg_namespace, pg_index): nenhuma linha de pedido, cupom ou cliente e' lida
-- nem devolvida.
--
-- POR OBJETO, nunca por `schema_migrations`: o registro do ledger nao prova o que esta
-- no banco (o dono aplica a mao, o ledger pode estar vazio ou adiantado).
--
-- Saida: item | esperado | vivo | ok, com as linhas ok = false primeiro. O rol e' FECHADO:
-- sempre as mesmas 15 linhas, em qualquer estado do banco. Tudo `true` = a loja esta na
-- base de antes da migration e ela pode ser aplicada; qualquer `false` = PARE e leia a
-- linha (a migration, se aplicada assim, abortaria no pre-voo `PREFLIGHT_20261208` ou
-- `B1_BASELINE_DIVERGENT` -- aqui a gente descobre ANTES, por leitura). Uma loja com a
-- migration JA aplicada (inteira ou pela metade) reprova aqui de proposito: esta consulta
-- e' "antes".
--
-- O QUE CADA LINHA PROVA (as mesmas condicoes do pre-voo da migration, mais a AUSENCIA do
-- que ela cria)
--   * controle        -- o papel enxerga as funcoes de `public` (catalogo vazio, por
--                        permissao, faria todo "AUSENTE" parecer prova de ausencia).
--   * colunas         -- as 16 colunas que os corpos da migration leem existem (a linha
--                        lista as que faltam).
--   * admin atual     -- `is_admin()`, `is_admin_atual()` e `rls_admin_atual()` existem
--                        (20261197000000): as funcoes do painel e a regra de leitura de
--                        `cupom_clientes` dependem delas.
--   * gatilho da 203  -- `tr_pedido_com_cupom_exige_a_chave_ligada` ATIVO em
--                        `public.marketplace_orders` (a #777, 20261203000000): o gatilho
--                        novo roda DEPOIS dele. AQUI ele tem de EXISTIR, ao contrario da
--                        10b, que o quer ausente.
--   * indice          -- `marketplace_orders_chave_da_compra_unica` unico, valido, parcial
--                        sobre (idempotency_key): o atalho de retentativa do gatilho novo
--                        copia EXATAMENTE esse predicado.
--   * validate        -- exatamente UMA sobrecarga de `validate_coupon_secure_v2` em
--                        `public`, e o corpo (prosrc) dela tem o sha256 do corpo da
--                        20261203000000 (LF ou CRLF), que o pre-voo aceita. O corpo NOVO
--                        (o de depois da migration) reprova AQUI de proposito.
--   * ausencias       -- `coupons.alcance`, o CHECK `coupons_alcance_check`, a tabela
--                        `cupom_clientes`, as quatro funcoes novas (QUALQUER assinatura:
--                        uma sobrecarga alheia faria o PostgREST responder "function is not
--                        unique") e o gatilho `tr_pedido_com_cupom_so_nasce_para_a_lista`
--                        estao ausentes. Meia migration (so a coluna, so a funcao) reprova
--                        na linha do que ja existe.
--
-- sha256 = encode(sha256(convert_to(prosrc, 'UTF8')), 'hex'), a mesma conta do pre-voo da
-- migration. tests/ci_conferir_banco_test.ts confere os dois hashes (LF e CRLF) contra o
-- corpo da 20261203000000 desta arvore; tests/banco/cupons-do-checkout-portao-viva.cjs roda
-- esta consulta num Postgres real (positiva num banco montado SEM a migration, negativa
-- depois dela e a cada peca solta).
--
-- LIMITES: nao le dado nenhum (nao diz se ha cupom, pedido ou cliente) e evidencia LOCAL nao
-- prova a IKCOUS nem a Savy: so o run desta consulta contra o ref de cada loja.
WITH tab AS (
  SELECT to_regclass('public.marketplace_orders') AS pedidos,
         to_regclass('public.coupons') AS cupons
), va AS (
  SELECT encode(sha256(convert_to(p.prosrc, 'UTF8')), 'hex') AS h
    FROM pg_proc p
   WHERE p.oid = to_regprocedure('public.validate_coupon_secure_v2(text,numeric)')
), gat AS (
  SELECT t.tgenabled::text AS habilitado, t.tgtype::int AS tgtype
    FROM pg_trigger t
    JOIN tab ON t.tgrelid = tab.pedidos
   WHERE t.tgname = 'tr_pedido_com_cupom_exige_a_chave_ligada'
     AND NOT t.tgisinternal
), faltam AS (
  SELECT v.item
    FROM unnest(ARRAY[
           'coupons.id', 'coupons.code', 'coupons.type', 'coupons.value', 'coupons.min_purchase',
           'coupons.usage_limit', 'coupons.usage_count', 'coupons.valid_until', 'coupons.active',
           'profiles.id', 'profiles.full_name',
           'marketplace_orders.user_id', 'marketplace_orders.coupon_id',
           'marketplace_orders.coupon_code', 'marketplace_orders.idempotency_key',
           'store_config.enable_coupons'
         ]) AS v(item)
   WHERE NOT EXISTS (
           SELECT 1 FROM pg_attribute a
            WHERE a.attrelid = to_regclass('public.' || split_part(v.item, '.', 1))
              AND a.attname = split_part(v.item, '.', 2)
              AND a.attnum > 0 AND NOT a.attisdropped)
), admin_faltam AS (
  SELECT v.nome
    FROM unnest(ARRAY['is_admin()', 'is_admin_atual()', 'rls_admin_atual()']) AS v(nome)
   WHERE to_regprocedure('public.' || v.nome) IS NULL
), idx AS (
  SELECT i.indisunique, i.indisvalid, i.indisready, c.relname AS tabela,
         (SELECT string_agg(a.attname::text, ',' ORDER BY k.ord)
            FROM unnest(i.indkey::int2[]) WITH ORDINALITY AS k(num, ord)
            JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = k.num) AS colunas,
         pg_get_expr(i.indpred, i.indrelid) AS predicado
    FROM pg_index i
    JOIN pg_class c ON c.oid = i.indrelid
   WHERE i.indexrelid = to_regclass('public.marketplace_orders_chave_da_compra_unica')
), itens(item, esperado, vivo) AS (
  SELECT 'controle: funcoes de public visiveis a este papel', '>0',
         CASE WHEN (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                     WHERE n.nspname = 'public') > 0 THEN '>0' ELSE '0' END
  UNION ALL
  SELECT 'colunas que as pecas da migration leem: existem', 'EXISTEM',
         COALESCE((SELECT 'AUSENTES: ' || string_agg(f.item, ', ' ORDER BY f.item) FROM faltam f), 'EXISTEM')
  UNION ALL
  SELECT 'is_admin, is_admin_atual e rls_admin_atual: existem', 'EXISTEM',
         COALESCE((SELECT 'AUSENTES: ' || string_agg(a.nome, ', ' ORDER BY a.nome) FROM admin_faltam a), 'EXISTEM')
  UNION ALL
  SELECT 'gatilho tr_pedido_com_cupom_exige_a_chave_ligada: ativo (BEFORE INSERT)', 'ATIVO',
         COALESCE((SELECT CASE WHEN g.habilitado = 'O' AND g.tgtype & 2 = 2 AND g.tgtype & 4 = 4 THEN 'ATIVO'
                               ELSE 'EXISTE mas nao ativo (habilitado=' || g.habilitado || ', tgtype=' || g.tgtype || ')' END
                     FROM gat g), 'AUSENTE')
  UNION ALL
  SELECT 'indice marketplace_orders_chave_da_compra_unica: definicao',
         'UNIQUE marketplace_orders (idempotency_key) WHERE idempotency_key IS NOT NULL',
         COALESCE((SELECT CASE WHEN x.indisunique THEN 'UNIQUE' ELSE 'NAO UNICO' END
                          || ' ' || x.tabela || ' (' || COALESCE(x.colunas, '?') || ') WHERE '
                          || CASE WHEN x.predicado IS NULL THEN 'sem predicado'
                                  WHEN regexp_replace(lower(x.predicado), '[\s()]', '', 'g') = 'idempotency_keyisnotnull'
                                    THEN 'idempotency_key IS NOT NULL'
                                  ELSE x.predicado END
                          || CASE WHEN x.indisvalid AND x.indisready THEN '' ELSE ' [INVALIDO]' END
                     FROM idx x), 'AUSENTE')
  UNION ALL
  SELECT 'validate_coupon_secure_v2: sobrecargas', '1',
         (SELECT count(*)::text FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
           WHERE n.nspname = 'public' AND p.proname = 'validate_coupon_secure_v2')
  UNION ALL
  SELECT 'validate_coupon_secure_v2: corpo e o da 20261203000000 (sha256)',
         '489c0cd19b3529ef2d9cf341096ee9b0048e5787ff0a2d0a918df4db580e82f3',
         COALESCE((SELECT CASE WHEN v.h IN ('489c0cd19b3529ef2d9cf341096ee9b0048e5787ff0a2d0a918df4db580e82f3',
                                            '4b096e67be79665d70e86ff5e94953ecf5842cd64abca882abac0f6cbe328279')
                               THEN '489c0cd19b3529ef2d9cf341096ee9b0048e5787ff0a2d0a918df4db580e82f3'
                               ELSE v.h END
                     FROM va v), 'AUSENTE')
  UNION ALL
  SELECT 'coupons.alcance: coluna', 'AUSENTE',
         CASE WHEN EXISTS (SELECT 1 FROM pg_attribute a JOIN tab ON a.attrelid = tab.cupons
                            WHERE a.attname = 'alcance' AND a.attnum > 0 AND NOT a.attisdropped)
              THEN 'PRESENTE' ELSE 'AUSENTE' END
  UNION ALL
  SELECT 'coupons_alcance_check: constraint', 'AUSENTE',
         CASE WHEN EXISTS (SELECT 1 FROM pg_constraint c JOIN tab ON c.conrelid = tab.cupons
                            WHERE c.conname = 'coupons_alcance_check')
              THEN 'PRESENTE' ELSE 'AUSENTE' END
  UNION ALL
  SELECT 'cupom_clientes: tabela', 'AUSENTE',
         CASE WHEN to_regclass('public.cupom_clientes') IS NOT NULL THEN 'PRESENTE' ELSE 'AUSENTE' END
  UNION ALL
  SELECT 'cupons_do_checkout: funcao', 'AUSENTE',
         CASE WHEN EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                            WHERE n.nspname = 'public' AND p.proname = 'cupons_do_checkout')
              THEN 'PRESENTE' ELSE 'AUSENTE' END
  UNION ALL
  SELECT 'admin_cupom_clientes: funcao', 'AUSENTE',
         CASE WHEN EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                            WHERE n.nspname = 'public' AND p.proname = 'admin_cupom_clientes')
              THEN 'PRESENTE' ELSE 'AUSENTE' END
  UNION ALL
  SELECT 'admin_cupom_definir_clientes: funcao', 'AUSENTE',
         CASE WHEN EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                            WHERE n.nspname = 'public' AND p.proname = 'admin_cupom_definir_clientes')
              THEN 'PRESENTE' ELSE 'AUSENTE' END
  UNION ALL
  SELECT 'pedido_com_cupom_so_nasce_para_a_lista: funcao', 'AUSENTE',
         CASE WHEN EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                            WHERE n.nspname = 'public' AND p.proname = 'pedido_com_cupom_so_nasce_para_a_lista')
              THEN 'PRESENTE' ELSE 'AUSENTE' END
  UNION ALL
  SELECT 'gatilho tr_pedido_com_cupom_so_nasce_para_a_lista: ausente em marketplace_orders', 'AUSENTE',
         CASE WHEN EXISTS (SELECT 1 FROM pg_trigger t JOIN tab ON t.tgrelid = tab.pedidos
                            WHERE t.tgname = 'tr_pedido_com_cupom_so_nasce_para_a_lista')
              THEN 'EXISTE' ELSE 'AUSENTE' END
)
SELECT item, esperado, vivo, COALESCE(vivo = esperado, false) AS ok
  FROM itens
 ORDER BY ok, item;
