-- 10a — DEPOIS de aplicar a migration 20261203000000 (cupons desligados pela loja
-- nao dao desconto, issue #645): confere, por OBJETO, que as duas pecas dela estao
-- de pe e que o corpo vivo e o corpo FINAL esperado. E' a prova de objetos do lote
-- `20261203000000` em scripts/frota/canais-de-backend.json: o portao
-- (scripts/frota/publicar-release.mjs) so libera a release com esta consulta
-- POSITIVA (ou, antes do apply, NEGATIVA com a 10b positiva).
-- SO LEITURA, um unico SELECT, so catalogo (pg_trigger, pg_proc, pg_index,
-- pg_class): nenhuma linha de pedido, cupom ou cliente e' lida nem devolvida.
--
-- Saida: item | esperado | vivo | ok, com as linhas ok = false primeiro. O rol e'
-- FECHADO: sempre as mesmas 21 linhas, em qualquer estado do banco (objeto ausente
-- vira `AUSENTE` na propria linha, nunca some uma linha). Tudo `true` = a migration
-- esta inteira no banco. Um `false` nomeia o objeto que ficou de fora ou divergiu.
--
-- O QUE CADA GRUPO DE LINHAS PROVA (cada item reprova na SUA linha)
--   * controle     -- o papel enxerga as funcoes de `public` (um catalogo vazio,
--                     por permissao, faria todo "AUSENTE" parecer erro e todo
--                     "nao" parecer acerto).
--   * gatilho      -- `tr_pedido_com_cupom_exige_a_chave_ligada` existe em
--                     `public.marketplace_orders`, e' BEFORE INSERT FOR EACH ROW
--                     (tgtype, nao tambem UPDATE), esta habilitado (tgenabled = 'O',
--                     o mesmo que o pos-voo da migration exige), tem
--                     `WHEN (new.coupon_id IS NOT NULL)` e executa a funcao
--                     `public.pedido_com_cupom_exige_a_chave_ligada()`. O WHEN e'
--                     lido de pg_get_triggerdef (pg_get_expr(tgqual) nao serve:
--                     a expressao tem NEW e OLD) e comparado sem espacos nem
--                     parenteses, em minusculas: a forma que o Postgres imprime
--                     varia de versao, a condicao nao.
--   * funcao do gatilho -- SECURITY DEFINER, `search_path=public`, plpgsql que
--                     devolve trigger, corpo (prosrc) com o sha256 do corpo desta
--                     migration (LF ou CRLF, a mesma conta do pre-voo dela), e SEM
--                     EXECUTE para PUBLIC, anon e authenticated (a migration faz
--                     REVOKE ALL ... FROM PUBLIC, anon, authenticated; o Postgres
--                     nao confere EXECUTE ao disparar um gatilho). PUBLIC e' medido
--                     por aclexplode(coalesce(proacl, acldefault('f', dono))),
--                     porque has_function_privilege nao tem o pseudo-papel PUBLIC
--                     (o mesmo metodo da 20261090500000).
--   * validate_coupon_secure_v2(text, numeric) -- uma sobrecarga so, corpo com o
--                     sha256 do corpo NOVO (LF ou CRLF), SECURITY DEFINER,
--                     `search_path=public`; ACL preservada pelo CREATE OR REPLACE:
--                     sem EXECUTE para PUBLIC (REVOKE da 20261090500000) e COM
--                     EXECUTE para authenticated (o checkout chama). A ACL de anon
--                     NAO e' conferida: a migration nao a toca e o baseline deixa
--                     anon como estiver.
--   * indice       -- `marketplace_orders_chave_da_compra_unica` existe e e' UNICO,
--                     valido, sobre (idempotency_key) apenas e parcial
--                     `WHERE idempotency_key IS NOT NULL`: o curto-circuito do
--                     gatilho (retentativa gemea de um pedido que ja existe) copia
--                     EXATAMENTE esse predicado; um indice por (user_id, chave) ou
--                     sem o parcial mudaria o que o gatilho recusa.
--
-- sha256 = encode(sha256(convert_to(prosrc, 'UTF8')), 'hex'), a mesma conta do
-- pre-voo e do pos-voo da migration. Cada hash final aparece abaixo uma vez em LF e
-- uma em CRLF; tests/ci_conferir_banco_test.ts recalcula os quatro a partir do
-- arquivo da migration desta arvore, e tests/banco/cupons-desligados-portao-viva.cjs
-- roda esta consulta num Postgres real (positivo depois do apply, e um negativo por
-- item, cada um reprovando na linha certa).
--
-- LIMITES: nao prova o COMPORTAMENTO (isso e' a prova viva da migration, em
-- tests/banco/cupons-desligados-viva.cjs); prova que o objeto vivo e' o desta
-- migration. Nao le a chave `enable_coupons` da loja. Evidencia LOCAL nao prova a
-- CAF nem a Savy: so o run desta consulta contra o ref de cada loja.
WITH tab AS (
  SELECT to_regclass('public.marketplace_orders') AS oid
), gat AS (
  SELECT t.tgtype::int AS tgtype,
         t.tgenabled::text AS tgenabled,
         t.tgfoid,
         pg_get_triggerdef(t.oid) AS def
    FROM pg_trigger t
    JOIN tab ON t.tgrelid = tab.oid
   WHERE t.tgname = 'tr_pedido_com_cupom_exige_a_chave_ligada'
     AND NOT t.tgisinternal
), gat_x AS (
  SELECT g.*,
         substring(g.def FROM ' WHEN \((.*)\) EXECUTE (?:FUNCTION|PROCEDURE) ') AS quando,
         (SELECT pn.nspname || '.' || p.proname || '(' || oidvectortypes(p.proargtypes) || ')'
            FROM pg_proc p JOIN pg_namespace pn ON pn.oid = p.pronamespace
           WHERE p.oid = g.tgfoid) AS funcao
    FROM gat g
), fg AS (
  SELECT p.prosecdef, p.proconfig, l.lanname, p.prorettype::regtype::text AS retorno,
         encode(sha256(convert_to(p.prosrc, 'UTF8')), 'hex') AS h,
         EXISTS (SELECT 1 FROM aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
                  WHERE a.grantee = 0 AND a.privilege_type = 'EXECUTE') AS exec_public,
         CASE WHEN to_regrole('anon') IS NULL THEN NULL
              ELSE has_function_privilege('anon', p.oid, 'EXECUTE') END AS exec_anon,
         CASE WHEN to_regrole('authenticated') IS NULL THEN NULL
              ELSE has_function_privilege('authenticated', p.oid, 'EXECUTE') END AS exec_auth
    FROM pg_proc p
    JOIN pg_language l ON l.oid = p.prolang
   WHERE p.oid = to_regprocedure('public.pedido_com_cupom_exige_a_chave_ligada()')
), va AS (
  SELECT p.prosecdef, p.proconfig,
         encode(sha256(convert_to(p.prosrc, 'UTF8')), 'hex') AS h,
         EXISTS (SELECT 1 FROM aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
                  WHERE a.grantee = 0 AND a.privilege_type = 'EXECUTE') AS exec_public,
         CASE WHEN to_regrole('authenticated') IS NULL THEN NULL
              ELSE has_function_privilege('authenticated', p.oid, 'EXECUTE') END AS exec_auth
    FROM pg_proc p
   WHERE p.oid = to_regprocedure('public.validate_coupon_secure_v2(text,numeric)')
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
  SELECT 'gatilho tr_pedido_com_cupom_exige_a_chave_ligada: existe em marketplace_orders', 'EXISTE',
         CASE WHEN EXISTS (SELECT 1 FROM gat) THEN 'EXISTE' ELSE 'AUSENTE' END
  UNION ALL
  SELECT 'gatilho tr_pedido_com_cupom_exige_a_chave_ligada: momento e evento',
         'BEFORE INSERT FOR EACH ROW',
         COALESCE((SELECT CASE WHEN g.tgtype & 2 = 2 THEN 'BEFORE'
                               WHEN g.tgtype & 64 = 64 THEN 'INSTEAD OF'
                               ELSE 'AFTER' END
                          || ' ' || concat_ws(' OR ',
                               CASE WHEN g.tgtype & 4 = 4 THEN 'INSERT' END,
                               CASE WHEN g.tgtype & 8 = 8 THEN 'DELETE' END,
                               CASE WHEN g.tgtype & 16 = 16 THEN 'UPDATE' END,
                               CASE WHEN g.tgtype & 32 = 32 THEN 'TRUNCATE' END)
                          || CASE WHEN g.tgtype & 1 = 1 THEN ' FOR EACH ROW' ELSE ' FOR EACH STATEMENT' END
                     FROM gat g), 'AUSENTE')
  UNION ALL
  SELECT 'gatilho tr_pedido_com_cupom_exige_a_chave_ligada: habilitado', 'O',
         COALESCE((SELECT g.tgenabled FROM gat g), 'AUSENTE')
  UNION ALL
  SELECT 'gatilho tr_pedido_com_cupom_exige_a_chave_ligada: condicao WHEN',
         'new.coupon_id IS NOT NULL',
         COALESCE((SELECT CASE WHEN g.quando IS NULL THEN 'sem WHEN'
                               WHEN regexp_replace(lower(g.quando), '[\s()]', '', 'g') = 'new.coupon_idisnotnull'
                                 THEN 'new.coupon_id IS NOT NULL'
                               ELSE g.quando END
                     FROM gat_x g), 'AUSENTE')
  UNION ALL
  SELECT 'gatilho tr_pedido_com_cupom_exige_a_chave_ligada: funcao executada',
         'public.pedido_com_cupom_exige_a_chave_ligada()',
         COALESCE((SELECT g.funcao FROM gat_x g), 'AUSENTE')
  UNION ALL
  SELECT 'funcao do gatilho: SECURITY DEFINER', 'true',
         COALESCE((SELECT f.prosecdef::text FROM fg f), 'AUSENTE')
  UNION ALL
  SELECT 'funcao do gatilho: search_path', 'search_path=public',
         COALESCE((SELECT COALESCE(array_to_string(f.proconfig, ','), 'sem search_path') FROM fg f), 'AUSENTE')
  UNION ALL
  SELECT 'funcao do gatilho: linguagem e retorno', 'plpgsql trigger',
         COALESCE((SELECT f.lanname || ' ' || f.retorno FROM fg f), 'AUSENTE')
  UNION ALL
  SELECT 'funcao do gatilho: corpo (sha256)',
         '35cd7a320dd1fe3673a4f0a0e3cd43dfb5bd608ff5f1636e5f94e5709b4a86e2',
         COALESCE((SELECT CASE WHEN f.h IN ('35cd7a320dd1fe3673a4f0a0e3cd43dfb5bd608ff5f1636e5f94e5709b4a86e2',
                                            '9060af97c05c2e80e0354f8ae8244ca3716d3ab225b2f3dbf3198d4cffe959fe')
                               THEN '35cd7a320dd1fe3673a4f0a0e3cd43dfb5bd608ff5f1636e5f94e5709b4a86e2'
                               ELSE f.h END
                     FROM fg f), 'AUSENTE')
  UNION ALL
  SELECT 'funcao do gatilho: EXECUTE para PUBLIC', 'nao',
         COALESCE((SELECT CASE WHEN f.exec_public THEN 'sim' ELSE 'nao' END FROM fg f), 'AUSENTE')
  UNION ALL
  SELECT 'funcao do gatilho: EXECUTE para anon', 'nao',
         COALESCE((SELECT CASE WHEN f.exec_anon IS NULL THEN 'papel anon ausente'
                               WHEN f.exec_anon THEN 'sim' ELSE 'nao' END FROM fg f), 'AUSENTE')
  UNION ALL
  SELECT 'funcao do gatilho: EXECUTE para authenticated', 'nao',
         COALESCE((SELECT CASE WHEN f.exec_auth IS NULL THEN 'papel authenticated ausente'
                               WHEN f.exec_auth THEN 'sim' ELSE 'nao' END FROM fg f), 'AUSENTE')
  UNION ALL
  SELECT 'validate_coupon_secure_v2: sobrecargas', '1',
         (SELECT count(*)::text FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
           WHERE n.nspname = 'public' AND p.proname = 'validate_coupon_secure_v2')
  UNION ALL
  SELECT 'validate_coupon_secure_v2: corpo (sha256)',
         '489c0cd19b3529ef2d9cf341096ee9b0048e5787ff0a2d0a918df4db580e82f3',
         COALESCE((SELECT CASE WHEN v.h IN ('489c0cd19b3529ef2d9cf341096ee9b0048e5787ff0a2d0a918df4db580e82f3',
                                            '4b096e67be79665d70e86ff5e94953ecf5842cd64abca882abac0f6cbe328279')
                               THEN '489c0cd19b3529ef2d9cf341096ee9b0048e5787ff0a2d0a918df4db580e82f3'
                               ELSE v.h END
                     FROM va v), 'AUSENTE')
  UNION ALL
  SELECT 'validate_coupon_secure_v2: SECURITY DEFINER', 'true',
         COALESCE((SELECT v.prosecdef::text FROM va v), 'AUSENTE')
  UNION ALL
  SELECT 'validate_coupon_secure_v2: search_path', 'search_path=public',
         COALESCE((SELECT COALESCE(array_to_string(v.proconfig, ','), 'sem search_path') FROM va v), 'AUSENTE')
  UNION ALL
  SELECT 'validate_coupon_secure_v2: EXECUTE para PUBLIC', 'nao',
         COALESCE((SELECT CASE WHEN v.exec_public THEN 'sim' ELSE 'nao' END FROM va v), 'AUSENTE')
  UNION ALL
  SELECT 'validate_coupon_secure_v2: EXECUTE para authenticated', 'sim',
         COALESCE((SELECT CASE WHEN v.exec_auth IS NULL THEN 'papel authenticated ausente'
                               WHEN v.exec_auth THEN 'sim' ELSE 'nao' END FROM va v), 'AUSENTE')
  UNION ALL
  SELECT 'indice marketplace_orders_chave_da_compra_unica: existe', 'EXISTE',
         CASE WHEN EXISTS (SELECT 1 FROM idx) THEN 'EXISTE' ELSE 'AUSENTE' END
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
)
SELECT item, esperado, vivo, COALESCE(vivo = esperado, false) AS ok
  FROM itens
 ORDER BY ok, item;
