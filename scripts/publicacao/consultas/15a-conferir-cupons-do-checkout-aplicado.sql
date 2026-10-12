-- 15a — DEPOIS de aplicar a migration 20261208000000 (o checkout mostra os cupons da cliente):
-- confere, por OBJETO, que as pecas dela estao de pe e que os corpos vivos sao os corpos
-- FINAIS esperados. E' a prova de objetos do lote `20261208000000` em
-- scripts/frota/canais-de-backend.json: o portao (scripts/frota/publicar-release.mjs) so
-- libera a release com esta consulta POSITIVA (ou, antes do apply, NEGATIVA com a 15b
-- positiva).
-- SO LEITURA, um unico SELECT, so catalogo (pg_attribute, pg_attrdef, pg_constraint,
-- pg_class, pg_policies, pg_trigger, pg_proc, pg_language, pg_index): nenhuma linha de
-- pedido, cupom ou cliente e' lida nem devolvida.
--
-- Saida: item | esperado | vivo | ok, com as linhas ok = false primeiro. O rol e' FECHADO:
-- sempre as mesmas 37 linhas, em qualquer estado do banco (objeto ausente vira `AUSENTE`
-- na propria linha, nunca some uma linha). Tudo `true` = a migration esta inteira no
-- banco. Um `false` nomeia o objeto que ficou de fora ou divergiu.
--
-- O QUE CADA GRUPO DE LINHAS PROVA (cada item reprova na SUA linha)
--   * controle      -- o papel enxerga as funcoes de `public` (um catalogo vazio, por
--                      permissao, faria todo "AUSENTE" parecer erro e todo "nao" parecer
--                      acerto).
--   * coupons.alcance -- a coluna e' `text NOT NULL DEFAULT 'codigo'` (o default e' quem
--                      faz todo cupom que ja existia continuar SECRETO) e o CHECK
--                      `coupons_alcance_check` aceita exatamente 'codigo', 'vitrine' e
--                      'exclusivo' e esta validado.
--   * cupom_clientes -- tres colunas e tipos da migration; a seguranca por linha (RLS)
--                      LIGADA; UMA politica so (`cupom_clientes_admin_select_policy`,
--                      SELECT, para authenticated), com a regra `(SELECT
--                      public.rls_admin_atual())` (o admin ATUAL, nunca o JWT velho: um
--                      `is_admin()` ali deixaria um ex-admin ler a lista de clientes de
--                      cada cupom); e os privilegios da tabela: authenticated SO le (uma
--                      escrita direta contornaria a RPC do painel e o limite de 500),
--                      anon e PUBLIC nao tem nenhum. O privilegio e' medido por tabela E
--                      por coluna (has_any_column_privilege).
--   * 4 funcoes novas -- `cupons_do_checkout(numeric)`, `admin_cupom_clientes(uuid)`,
--                      `admin_cupom_definir_clientes(uuid, uuid[])` e a do gatilho
--                      `pedido_com_cupom_so_nasce_para_a_lista()`: UMA sobrecarga, forma
--                      (linguagem, volatilidade, SECURITY DEFINER, search_path=public,
--                      tipo de retorno), corpo (prosrc) com o sha256 do corpo desta
--                      migration (LF ou CRLF, a mesma conta do pre-voo dela) e EXECUTE
--                      para PUBLIC, anon e authenticated. A lista do checkout e' do
--                      publico (anon e authenticated); as do painel so do usuario logado
--                      (a propria funcao recusa quem nao e' o admin atual); a do gatilho
--                      de ninguem. PUBLIC e' medido por aclexplode(coalesce(proacl,
--                      acldefault('f', dono))), porque has_function_privilege nao tem o
--                      pseudo-papel PUBLIC (o mesmo metodo da 10a).
--   * validate_coupon_secure_v2(text, numeric) -- uma sobrecarga so, forma e corpo com o
--                      sha256 do corpo NOVO (LF ou CRLF); ACL preservada pelo CREATE OR
--                      REPLACE: sem EXECUTE para PUBLIC (REVOKE da 20261090500000) e COM
--                      EXECUTE para authenticated (o checkout chama). A ACL de anon NAO e'
--                      conferida: a migration nao a toca e o baseline deixa anon como
--                      estiver (mesma decisao da 10a). SO O CORPO DA 20261208000000 vale
--                      aqui: uma migration FUTURA que redefina a validacao por um bom
--                      motivo tem de, no mesmo PR, trocar este hash (a 10a aceita este
--                      corpo como sucessora da 203, e esta aceita so ele).
--   * gatilho       -- `tr_pedido_com_cupom_so_nasce_para_a_lista` existe em
--                      `public.marketplace_orders`, e' BEFORE INSERT FOR EACH ROW
--                      (tgtype, nao tambem UPDATE), esta habilitado (tgenabled = 'O', o
--                      mesmo que o pos-voo da migration exige), tem `WHEN (new.coupon_id IS
--                      NOT NULL)` e executa a funcao
--                      `public.pedido_com_cupom_so_nasce_para_a_lista()`. O WHEN e' lido de
--                      pg_get_triggerdef e comparado sem espacos nem parenteses, em
--                      minusculas: a forma que o Postgres imprime varia de versao, a
--                      condicao nao. A ORDEM: os gatilhos BEFORE INSERT do mesmo pedido
--                      disparam em ordem de nome, e o novo tem de rodar DEPOIS de
--                      `tr_pedido_com_cupom_exige_a_chave_ligada` (a 20261203000000): a
--                      linha lista os dois nomes na ordem em que disparam.
--   * indice        -- `marketplace_orders_chave_da_compra_unica` existe e e' UNICO, valido,
--                      sobre (idempotency_key) apenas e parcial `WHERE idempotency_key IS
--                      NOT NULL`: o atalho de retentativa do gatilho novo (a mesma disciplina
--                      da 203) copia EXATAMENTE esse predicado; sem ele, a lojista que tira a
--                      cliente da lista no meio de uma compra repetida faria nascer um
--                      pedido em dobro.
--
-- sha256 = encode(sha256(convert_to(prosrc, 'UTF8')), 'hex'), a mesma conta do pre-voo e
-- do pos-voo da migration. Cada hash final aparece abaixo uma vez em LF e uma em CRLF;
-- tests/ci_conferir_banco_test.ts recalcula os dez a partir do arquivo da migration desta
-- arvore, e tests/banco/cupons-do-checkout-portao-viva.cjs roda esta consulta num Postgres
-- real (positivo depois do apply, e um negativo por item, cada um reprovando na linha
-- certa).
--
-- LIMITES: nao prova o COMPORTAMENTO (isso e' a prova viva da migration, em
-- tests/banco/cupons-do-checkout-viva.cjs); prova que o objeto vivo e' o desta migration.
-- NAO le dado: nao diz se um cupom antigo ficou secreto (o DEFAULT NOT NULL garante, e a
-- migration le o catalogo, nunca a tabela) nem se ha clientes na lista. Evidencia LOCAL
-- nao prova a IKCOUS nem a Savy: so o run desta consulta contra o ref de cada loja.
WITH tab AS (
  SELECT to_regclass('public.coupons') AS cupons,
         to_regclass('public.cupom_clientes') AS cc,
         to_regclass('public.marketplace_orders') AS pedidos
), alc AS (
  SELECT format_type(a.atttypid, a.atttypmod)
         || CASE WHEN a.attnotnull THEN ' NOT NULL' ELSE ' aceita NULL' END
         || ' DEFAULT ' || COALESCE(pg_get_expr(d.adbin, d.adrelid), 'sem default') AS forma
    FROM pg_attribute a
    JOIN tab ON a.attrelid = tab.cupons
    LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
   WHERE a.attname = 'alcance' AND a.attnum > 0 AND NOT a.attisdropped
), ck AS (
  SELECT c.convalidated,
         pg_get_constraintdef(c.oid) AS def,
         regexp_replace(lower(pg_get_constraintdef(c.oid)), '[\s()]|::text', '', 'g') AS norma
    FROM pg_constraint c
    JOIN tab ON c.conrelid = tab.cupons
   WHERE c.conname = 'coupons_alcance_check'
), ccol AS (
  SELECT string_agg(a.attname || ':' || format_type(a.atttypid, a.atttypmod) || ':' || a.attnotnull::text,
                    ',' ORDER BY a.attnum) AS forma
    FROM pg_attribute a
    JOIN tab ON a.attrelid = tab.cc
   WHERE a.attnum > 0 AND NOT a.attisdropped
), crel AS (
  SELECT c.relrowsecurity, COALESCE(c.relacl, acldefault('r', c.relowner)) AS acl
    FROM pg_class c
    JOIN tab ON c.oid = tab.cc
), pol AS (
  SELECT string_agg(p.policyname || ' ' || p.cmd || ' ' || p.roles::text || ' ' || p.permissive,
                    '; ' ORDER BY p.policyname) AS lista
    FROM pg_policies p
   WHERE p.schemaname = 'public' AND p.tablename = 'cupom_clientes'
), regra AS (
  SELECT p.qual, p.with_check,
         regexp_replace(regexp_replace(lower(COALESCE(p.qual, '')), '[\s()]|public\.', '', 'g'),
                        'asrls_admin_atual$', '') AS norma
    FROM pg_policies p
   WHERE p.schemaname = 'public' AND p.tablename = 'cupom_clientes'
     AND p.policyname = 'cupom_clientes_admin_select_policy'
), priv AS (
  SELECT CASE WHEN to_regrole('authenticated') IS NULL THEN NULL
              ELSE COALESCE((SELECT string_agg(x.p, ',' ORDER BY x.p)
                               FROM unnest(ARRAY['DELETE', 'INSERT', 'REFERENCES', 'SELECT', 'TRIGGER', 'TRUNCATE', 'UPDATE']) AS x(p)
                              WHERE has_table_privilege('authenticated', tab.cc, x.p)
                                 OR CASE WHEN x.p IN ('INSERT', 'REFERENCES', 'SELECT', 'UPDATE')
                                         THEN has_any_column_privilege('authenticated', tab.cc, x.p)
                                         ELSE false END), 'nenhum') END AS auth,
         CASE WHEN to_regrole('anon') IS NULL THEN NULL
              ELSE COALESCE((SELECT string_agg(x.p, ',' ORDER BY x.p)
                               FROM unnest(ARRAY['DELETE', 'INSERT', 'REFERENCES', 'SELECT', 'TRIGGER', 'TRUNCATE', 'UPDATE']) AS x(p)
                              WHERE has_table_privilege('anon', tab.cc, x.p)
                                 OR CASE WHEN x.p IN ('INSERT', 'REFERENCES', 'SELECT', 'UPDATE')
                                         THEN has_any_column_privilege('anon', tab.cc, x.p)
                                         ELSE false END), 'nenhum') END AS anon,
         COALESCE((SELECT string_agg(DISTINCT a.privilege_type, ',' ORDER BY a.privilege_type)
                     FROM crel c, aclexplode(c.acl) AS a
                    WHERE a.grantee = 0), 'nenhum') AS pub
    FROM tab
   WHERE tab.cc IS NOT NULL
), alvo(nome, assinatura) AS (
  VALUES ('cupons_do_checkout', 'public.cupons_do_checkout(numeric)'),
         ('admin_cupom_clientes', 'public.admin_cupom_clientes(uuid)'),
         ('admin_cupom_definir_clientes', 'public.admin_cupom_definir_clientes(uuid,uuid[])'),
         ('pedido_com_cupom_so_nasce_para_a_lista', 'public.pedido_com_cupom_so_nasce_para_a_lista()'),
         ('validate_coupon_secure_v2', 'public.validate_coupon_secure_v2(text,numeric)')
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
), gat AS (
  SELECT t.tgtype::int AS tgtype,
         t.tgenabled::text AS tgenabled,
         t.tgfoid,
         pg_get_triggerdef(t.oid) AS def
    FROM pg_trigger t
    JOIN tab ON t.tgrelid = tab.pedidos
   WHERE t.tgname = 'tr_pedido_com_cupom_so_nasce_para_a_lista'
     AND NOT t.tgisinternal
), gat_x AS (
  SELECT g.*,
         substring(g.def FROM ' WHEN \((.*)\) EXECUTE (?:FUNCTION|PROCEDURE) ') AS quando,
         (SELECT pn.nspname || '.' || p.proname || '(' || oidvectortypes(p.proargtypes) || ')'
            FROM pg_proc p JOIN pg_namespace pn ON pn.oid = p.pronamespace
           WHERE p.oid = g.tgfoid) AS funcao
    FROM gat g
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
  SELECT 'coupons.alcance: coluna (tipo, NOT NULL, default)', 'text NOT NULL DEFAULT ''codigo''::text',
         COALESCE((SELECT a.forma FROM alc a), 'AUSENTE')
  UNION ALL
  SELECT 'coupons.alcance: CHECK coupons_alcance_check', 'alcance IN (codigo, vitrine, exclusivo), validado',
         COALESCE((SELECT CASE WHEN k.norma = 'checkalcance=anyarray[''codigo'',''vitrine'',''exclusivo'']'
                               THEN 'alcance IN (codigo, vitrine, exclusivo)'
                               ELSE k.def END
                          || CASE WHEN k.convalidated THEN ', validado' ELSE ', NAO VALIDADO' END
                     FROM ck k), 'AUSENTE')
  UNION ALL
  SELECT 'cupom_clientes: colunas', 'coupon_id:uuid:true,user_id:uuid:true,criado_em:timestamp with time zone:true',
         COALESCE((SELECT c.forma FROM ccol c), 'AUSENTE')
  UNION ALL
  SELECT 'cupom_clientes: seguranca por linha (RLS) ligada', 'sim',
         COALESCE((SELECT CASE WHEN c.relrowsecurity THEN 'sim' ELSE 'nao' END FROM crel c), 'AUSENTE')
  UNION ALL
  SELECT 'cupom_clientes: politicas (nome, comando, papeis)',
         'cupom_clientes_admin_select_policy SELECT {authenticated} PERMISSIVE',
         CASE WHEN (SELECT cc FROM tab) IS NULL THEN 'AUSENTE'
              ELSE COALESCE((SELECT p.lista FROM pol p), 'nenhuma') END
  UNION ALL
  SELECT 'cupom_clientes: regra da politica de leitura', '(SELECT rls_admin_atual())',
         COALESCE((SELECT CASE WHEN r.with_check IS NOT NULL THEN 'com WITH CHECK: ' || r.with_check
                               WHEN r.norma = 'selectrls_admin_atual' THEN '(SELECT rls_admin_atual())'
                               ELSE COALESCE(r.qual, 'sem regra') END
                     FROM regra r), 'AUSENTE')
  UNION ALL
  SELECT 'cupom_clientes: privilegios de authenticated', 'SELECT',
         COALESCE((SELECT COALESCE(p.auth, 'papel authenticated ausente') FROM priv p), 'AUSENTE')
  UNION ALL
  SELECT 'cupom_clientes: privilegios de anon', 'nenhum',
         COALESCE((SELECT COALESCE(p.anon, 'papel anon ausente') FROM priv p), 'AUSENTE')
  UNION ALL
  SELECT 'cupom_clientes: privilegios de PUBLIC', 'nenhum',
         COALESCE((SELECT p.pub FROM priv p), 'AUSENTE')
  UNION ALL
  SELECT 'cupons_do_checkout: sobrecargas', '1',
         (SELECT f.sobrecargas::text FROM fn f WHERE f.nome = 'cupons_do_checkout')
  UNION ALL
  SELECT 'cupons_do_checkout: forma', 'sql STABLE SECURITY DEFINER search_path=public -> record',
         COALESCE((SELECT f.forma FROM fn f WHERE f.nome = 'cupons_do_checkout'), 'AUSENTE')
  UNION ALL
  SELECT 'cupons_do_checkout: corpo (sha256)',
         '416e031935202e095bea7e3863e7f36c96c1dd8624cfd81f584aae3896999e3f',
         COALESCE((SELECT CASE WHEN f.h IN ('416e031935202e095bea7e3863e7f36c96c1dd8624cfd81f584aae3896999e3f',
                                            '15bfde89d886b2f008ded0b8b40033642d3e2dcd9ea896db8f328767ef47a849')
                               THEN '416e031935202e095bea7e3863e7f36c96c1dd8624cfd81f584aae3896999e3f'
                               ELSE f.h END
                     FROM fn f WHERE f.nome = 'cupons_do_checkout'), 'AUSENTE')
  UNION ALL
  SELECT 'cupons_do_checkout: EXECUTE', 'PUBLIC=nao anon=sim authenticated=sim',
         COALESCE((SELECT CASE WHEN NOT f.existe THEN NULL
                               ELSE 'PUBLIC=' || CASE WHEN f.exec_public THEN 'sim' ELSE 'nao' END
                                    || ' anon=' || COALESCE(CASE WHEN f.exec_anon THEN 'sim' ELSE 'nao' END, 'papel ausente')
                                    || ' authenticated=' || COALESCE(CASE WHEN f.exec_auth THEN 'sim' ELSE 'nao' END, 'papel ausente') END
                     FROM fn f WHERE f.nome = 'cupons_do_checkout'), 'AUSENTE')
  UNION ALL
  SELECT 'admin_cupom_clientes: sobrecargas', '1',
         (SELECT f.sobrecargas::text FROM fn f WHERE f.nome = 'admin_cupom_clientes')
  UNION ALL
  SELECT 'admin_cupom_clientes: forma', 'plpgsql STABLE SECURITY DEFINER search_path=public -> record',
         COALESCE((SELECT f.forma FROM fn f WHERE f.nome = 'admin_cupom_clientes'), 'AUSENTE')
  UNION ALL
  SELECT 'admin_cupom_clientes: corpo (sha256)',
         '2139687e9de53a8666c9cfbe8211a36b5140405f1217f4e31927b45d9ddacecf',
         COALESCE((SELECT CASE WHEN f.h IN ('2139687e9de53a8666c9cfbe8211a36b5140405f1217f4e31927b45d9ddacecf',
                                            '54b09fbf6362510785e9a2a4536f91719b69c63ecfdd75c286b8fe6368c59366')
                               THEN '2139687e9de53a8666c9cfbe8211a36b5140405f1217f4e31927b45d9ddacecf'
                               ELSE f.h END
                     FROM fn f WHERE f.nome = 'admin_cupom_clientes'), 'AUSENTE')
  UNION ALL
  SELECT 'admin_cupom_clientes: EXECUTE', 'PUBLIC=nao anon=nao authenticated=sim',
         COALESCE((SELECT CASE WHEN NOT f.existe THEN NULL
                               ELSE 'PUBLIC=' || CASE WHEN f.exec_public THEN 'sim' ELSE 'nao' END
                                    || ' anon=' || COALESCE(CASE WHEN f.exec_anon THEN 'sim' ELSE 'nao' END, 'papel ausente')
                                    || ' authenticated=' || COALESCE(CASE WHEN f.exec_auth THEN 'sim' ELSE 'nao' END, 'papel ausente') END
                     FROM fn f WHERE f.nome = 'admin_cupom_clientes'), 'AUSENTE')
  UNION ALL
  SELECT 'admin_cupom_definir_clientes: sobrecargas', '1',
         (SELECT f.sobrecargas::text FROM fn f WHERE f.nome = 'admin_cupom_definir_clientes')
  UNION ALL
  SELECT 'admin_cupom_definir_clientes: forma', 'plpgsql VOLATILE SECURITY DEFINER search_path=public -> integer',
         COALESCE((SELECT f.forma FROM fn f WHERE f.nome = 'admin_cupom_definir_clientes'), 'AUSENTE')
  UNION ALL
  SELECT 'admin_cupom_definir_clientes: corpo (sha256)',
         '9fb80821bdffc0b82728a490b7d78cc8fbc04c4597b8c99cc43c418141c2beb1',
         COALESCE((SELECT CASE WHEN f.h IN ('9fb80821bdffc0b82728a490b7d78cc8fbc04c4597b8c99cc43c418141c2beb1',
                                            '48de3adb0adeeafa4f3f19e35bf9024381548a037a3e668c955668e9496203df')
                               THEN '9fb80821bdffc0b82728a490b7d78cc8fbc04c4597b8c99cc43c418141c2beb1'
                               ELSE f.h END
                     FROM fn f WHERE f.nome = 'admin_cupom_definir_clientes'), 'AUSENTE')
  UNION ALL
  SELECT 'admin_cupom_definir_clientes: EXECUTE', 'PUBLIC=nao anon=nao authenticated=sim',
         COALESCE((SELECT CASE WHEN NOT f.existe THEN NULL
                               ELSE 'PUBLIC=' || CASE WHEN f.exec_public THEN 'sim' ELSE 'nao' END
                                    || ' anon=' || COALESCE(CASE WHEN f.exec_anon THEN 'sim' ELSE 'nao' END, 'papel ausente')
                                    || ' authenticated=' || COALESCE(CASE WHEN f.exec_auth THEN 'sim' ELSE 'nao' END, 'papel ausente') END
                     FROM fn f WHERE f.nome = 'admin_cupom_definir_clientes'), 'AUSENTE')
  UNION ALL
  SELECT 'pedido_com_cupom_so_nasce_para_a_lista: sobrecargas', '1',
         (SELECT f.sobrecargas::text FROM fn f WHERE f.nome = 'pedido_com_cupom_so_nasce_para_a_lista')
  UNION ALL
  SELECT 'pedido_com_cupom_so_nasce_para_a_lista: forma', 'plpgsql VOLATILE SECURITY DEFINER search_path=public -> trigger',
         COALESCE((SELECT f.forma FROM fn f WHERE f.nome = 'pedido_com_cupom_so_nasce_para_a_lista'), 'AUSENTE')
  UNION ALL
  SELECT 'pedido_com_cupom_so_nasce_para_a_lista: corpo (sha256)',
         'ea521c2ed6b78cf54dbea2c79c9718834e05ae7cc203db6946b766f3329a34b0',
         COALESCE((SELECT CASE WHEN f.h IN ('ea521c2ed6b78cf54dbea2c79c9718834e05ae7cc203db6946b766f3329a34b0',
                                            '30d8815ff9abadaa13333d1d1044084494e4150e682386be648670221344d90a')
                               THEN 'ea521c2ed6b78cf54dbea2c79c9718834e05ae7cc203db6946b766f3329a34b0'
                               ELSE f.h END
                     FROM fn f WHERE f.nome = 'pedido_com_cupom_so_nasce_para_a_lista'), 'AUSENTE')
  UNION ALL
  SELECT 'pedido_com_cupom_so_nasce_para_a_lista: EXECUTE', 'PUBLIC=nao anon=nao authenticated=nao',
         COALESCE((SELECT CASE WHEN NOT f.existe THEN NULL
                               ELSE 'PUBLIC=' || CASE WHEN f.exec_public THEN 'sim' ELSE 'nao' END
                                    || ' anon=' || COALESCE(CASE WHEN f.exec_anon THEN 'sim' ELSE 'nao' END, 'papel ausente')
                                    || ' authenticated=' || COALESCE(CASE WHEN f.exec_auth THEN 'sim' ELSE 'nao' END, 'papel ausente') END
                     FROM fn f WHERE f.nome = 'pedido_com_cupom_so_nasce_para_a_lista'), 'AUSENTE')
  UNION ALL
  SELECT 'validate_coupon_secure_v2: sobrecargas', '1',
         (SELECT f.sobrecargas::text FROM fn f WHERE f.nome = 'validate_coupon_secure_v2')
  UNION ALL
  SELECT 'validate_coupon_secure_v2: forma', 'plpgsql VOLATILE SECURITY DEFINER search_path=public -> jsonb',
         COALESCE((SELECT f.forma FROM fn f WHERE f.nome = 'validate_coupon_secure_v2'), 'AUSENTE')
  UNION ALL
  SELECT 'validate_coupon_secure_v2: corpo (sha256)',
         'c33e930ca389b3568bd256f9363ace8fd3935f0ac73851441e0684a374b11037',
         COALESCE((SELECT CASE WHEN f.h IN ('c33e930ca389b3568bd256f9363ace8fd3935f0ac73851441e0684a374b11037',
                                            'fdfacc20cc3bc2a691ad8961c525e5cb77071b7d5e9e590a7470e45690a2df3a')
                               THEN 'c33e930ca389b3568bd256f9363ace8fd3935f0ac73851441e0684a374b11037'
                               ELSE f.h END
                     FROM fn f WHERE f.nome = 'validate_coupon_secure_v2'), 'AUSENTE')
  UNION ALL
  SELECT 'validate_coupon_secure_v2: EXECUTE', 'PUBLIC=nao authenticated=sim',
         COALESCE((SELECT CASE WHEN NOT f.existe THEN NULL
                               ELSE 'PUBLIC=' || CASE WHEN f.exec_public THEN 'sim' ELSE 'nao' END
                                    || ' authenticated=' || COALESCE(CASE WHEN f.exec_auth THEN 'sim' ELSE 'nao' END, 'papel ausente') END
                     FROM fn f WHERE f.nome = 'validate_coupon_secure_v2'), 'AUSENTE')
  UNION ALL
  SELECT 'gatilho tr_pedido_com_cupom_so_nasce_para_a_lista: existe em marketplace_orders', 'EXISTE',
         CASE WHEN EXISTS (SELECT 1 FROM gat) THEN 'EXISTE' ELSE 'AUSENTE' END
  UNION ALL
  SELECT 'gatilho tr_pedido_com_cupom_so_nasce_para_a_lista: momento e evento',
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
  SELECT 'gatilho tr_pedido_com_cupom_so_nasce_para_a_lista: habilitado', 'O',
         COALESCE((SELECT g.tgenabled FROM gat g), 'AUSENTE')
  UNION ALL
  SELECT 'gatilho tr_pedido_com_cupom_so_nasce_para_a_lista: condicao WHEN',
         'new.coupon_id IS NOT NULL',
         COALESCE((SELECT CASE WHEN g.quando IS NULL THEN 'sem WHEN'
                               WHEN regexp_replace(lower(g.quando), '[\s()]', '', 'g') = 'new.coupon_idisnotnull'
                                 THEN 'new.coupon_id IS NOT NULL'
                               ELSE g.quando END
                     FROM gat_x g), 'AUSENTE')
  UNION ALL
  SELECT 'gatilho tr_pedido_com_cupom_so_nasce_para_a_lista: funcao executada',
         'public.pedido_com_cupom_so_nasce_para_a_lista()',
         COALESCE((SELECT g.funcao FROM gat_x g), 'AUSENTE')
  UNION ALL
  SELECT 'gatilhos de cupom no pedido: ordem de disparo',
         'tr_pedido_com_cupom_exige_a_chave_ligada < tr_pedido_com_cupom_so_nasce_para_a_lista',
         COALESCE((SELECT string_agg(t.tgname::text, ' < ' ORDER BY t.tgname COLLATE "C")
                     FROM pg_trigger t
                     JOIN tab ON t.tgrelid = tab.pedidos
                    WHERE NOT t.tgisinternal
                      AND (t.tgtype & 2) = 2 AND (t.tgtype & 4) = 4
                      AND t.tgname IN ('tr_pedido_com_cupom_exige_a_chave_ligada',
                                       'tr_pedido_com_cupom_so_nasce_para_a_lista')), 'AUSENTE')
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
