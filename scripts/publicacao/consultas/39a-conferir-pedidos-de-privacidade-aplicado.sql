-- 39a — DEPOIS de aplicar a migration 20261238000000 (a cliente pede a exclusao da conta e a correcao do e-mail): confere,
-- POR OBJETO, que a tabela `public.pedidos_de_privacidade` nasceu INTEIRA e FECHADA: as colunas, as seis regras CHECK, a
-- chave estrangeira SEM cascata para auth.users, o indice unico parcial de UM pedido aberto por (cliente, tipo), a seguranca
-- por linha (RLS) ligada com as TRES politicas combinadas (e nenhuma de DELETE), os privilegios (a cliente le a tabela e so
-- escreve as tres colunas do pedido; o admin so decide `situacao` e `observacao`; ninguem apaga, nem o service_role), a
-- funcao do gatilho `pedidos_de_privacidade__carimbar()` (corpo por md5, atributos, sem EXECUTE para o visitante) e o gatilho
-- `tr_pedidos_de_privacidade_carimbar` (BEFORE UPDATE por linha, ligado). E' a consulta do lote em `provasDeObjetos` de
-- scripts/frota/canais-de-backend.json; a de ausencia e' a 39b. DADO DE CLIENTE (LGPD): a tabela e' registro legal da loja.
-- SO LEITURA, um unico SELECT, so catalogo (pg_class, pg_attribute, pg_attrdef, pg_constraint, pg_index, pg_policy,
-- pg_trigger, pg_proc, pg_namespace, pg_language, pg_roles, aclexplode): nenhuma linha de pedido de privacidade, de cliente
-- ou de login e' lida nem devolvida.
--
-- Saida: item | esperado | vivo | ok, com as linhas ok = false primeiro. Rol FECHADO de 19 linhas, as mesmas em qualquer
-- estado do banco (objeto ausente vira `AUSENTE` na propria linha, nunca some uma linha). Tudo `true` = a migration esta
-- inteira no banco; qualquer `false` = PARE e leia a linha. Antes do apply (ou depois do rollback-manual) reprova em quase
-- todas, de proposito: a consulta de ausencia e' a 39b.
--
-- O QUE CADA GRUPO DE LINHAS PROVA
--   * colunas     -- nome:tipo:NOT NULL:default, na ordem, das 9 colunas (situacao nasce 'aberto').
--   * constraints -- os NOMES das 8 (pkey, fkey e as seis CHECK) e, a parte, a REGRA de cada CHECK (lida do texto da
--                    definicao, sem espaco nem parentese, em minusculas: a forma que o Postgres imprime varia de versao, a
--                    condicao nao). Uma CHECK trocada por outra de mesmo nome reprova SO a linha das regras.
--   * a chave     -- user_id -> auth.users(id), ON DELETE e ON UPDATE NO ACTION: apagar o login NAO apaga o pedido (nem e'
--                    permitido enquanto houver pedido). Cascata reprova aqui.
--   * os indices  -- o unico PARCIAL (user_id, tipo) WHERE situacao = 'aberto' (sem ele a cliente enfileira pedido em dobro)
--                    e o da lista do painel (situacao, criado_em).
--   * RLS e politicas -- RLS ligada; exatamente tres politicas (nome:comando:papel) e NENHUMA de DELETE nem ALL; a expressao
--                    de cada uma tem as marcas de sempre (a cliente so o dela e o admin de AGORA, rls_admin_atual()).
--   * privilegios -- PUBLIC e anon: nenhum, de tabela nem de coluna. authenticated: SELECT de tabela e mais nada; colunas
--                    escritas: INSERT em (email_novo, tipo, user_id) e UPDATE em (observacao, situacao). service_role:
--                    INSERT, SELECT e UPDATE, sem DELETE, TRUNCATE nem REFERENCES. PUBLIC e' medido por
--                    aclexplode(coalesce(relacl, acldefault('r', dono))), porque has_table_privilege nao tem o pseudo-papel PUBLIC.
--   * a funcao    -- UMA sobrecarga so; corpo (md5 do prosrc sem CR, LF ou CRLF) igual ao do arquivo da migration;
--                    plpgsql VOLATILE SECURITY INVOKER search_path=public, retorna trigger; PUBLIC, anon e authenticated SEM
--                    EXECUTE. O service_role NAO e' medido: a migration nao mexe nele (o Supabase concede EXECUTE a ele por
--                    padrao e o gatilho nao precisa dessa permissao); medir fixaria o que a plataforma decide.
--   * o gatilho   -- o UNICO gatilho da tabela, BEFORE UPDATE por linha (tgtype 19), habilitado, sem lista de colunas nem
--                    WHEN, executando a funcao acima.
--
-- md5 recalculado do ARQUIVO da migration por tests/ci_conferir_banco_privacidade_test.ts; tests/banco/
-- pedidos-de-privacidade-portao-viva.cjs roda esta consulta num Postgres real (positiva depois do apply, negativa depois do
-- rollback, um negativo por linha). LIMITES: nao prova o COMPORTAMENTO (isso e' de tests/banco/pedidos-de-privacidade-viva.cjs),
-- nao le dado, e evidencia LOCAL nao prova a IKCOUS nem a Savy: so o run desta consulta contra o ref de cada loja.
WITH tab AS (
  SELECT to_regclass('public.pedidos_de_privacidade') AS t,
         to_regclass('auth.users') AS usuarios
), col AS (
  SELECT string_agg(a.attname || ':' || format_type(a.atttypid, a.atttypmod) || ':' || a.attnotnull::text
                    || ':' || COALESCE(pg_get_expr(d.adbin, d.adrelid), ''), ',' ORDER BY a.attnum) AS forma
    FROM pg_attribute a
    JOIN tab ON a.attrelid = tab.t
    LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
   WHERE a.attnum > 0 AND NOT a.attisdropped
), cons AS (
  SELECT string_agg(c.conname::text || ':' || c.contype::text, ', ' ORDER BY c.conname) AS nomes
    FROM pg_constraint c
    JOIN tab ON c.conrelid = tab.t
   WHERE c.contype <> 'n'
), chk AS (
  -- O texto da definicao sem espaco nem parentese, em minusculas, e com um `|` no fim (para ancorar o final da regra).
  SELECT c.conname::text AS nome,
         lower(regexp_replace(pg_get_constraintdef(c.oid), '[()[:space:]]', '', 'g')) || '|' AS n
    FROM pg_constraint c
    JOIN tab ON c.conrelid = tab.t
   WHERE c.contype = 'c'
), regras(nome, marcas, literais) AS (
  -- `literais` = quantos textos entre aspas a regra tem (a lista de valores aceitos e' EXATA: um valor a mais reprova).
  VALUES ('pedidos_de_privacidade_tipo_check',
          ARRAY['''excluir_conta''', '''corrigir_email'''], 2),
         ('pedidos_de_privacidade_situacao_check',
          ARRAY['''aberto''', '''atendido''', '''recusado'''], 3),
         ('pedidos_de_privacidade_email_do_tipo_check',
          ARRAY['tipo=''corrigir_email''', 'email_novoisnotnull|'], 1),
         ('pedidos_de_privacidade_email_formato_check',
          ARRAY['email_novoisnullorchar_lengthemail_novo<=254and', '''^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$''::text|'], 1),
         ('pedidos_de_privacidade_carimbo_check',
          ARRAY['situacao=''aberto''::textandatendido_emisnullandatendido_porisnull',
                'orsituacao<>''aberto''::textandatendido_emisnotnull|'], 2),
         ('pedidos_de_privacidade_observacao_check',
          ARRAY['observacaoisnullorchar_lengthobservacao<=1000|'], 0)
), regras_ok AS (
  SELECT r.nome,
         EXISTS (SELECT 1 FROM chk k
                  WHERE k.nome = r.nome
                    AND (length(k.n) - length(replace(k.n, '''', ''))) / 2 = r.literais
                    AND NOT EXISTS (SELECT 1 FROM unnest(r.marcas) AS m(x) WHERE position(m.x IN k.n) = 0)) AS ok
    FROM regras r
), fk AS (
  SELECT a.attname || ' -> ' || c.confrelid::regclass::text || '(' || ra.attname || '), ON DELETE '
         || CASE c.confdeltype WHEN 'c' THEN 'CASCADE' WHEN 'a' THEN 'NO ACTION' WHEN 'r' THEN 'RESTRICT'
                               WHEN 'n' THEN 'SET NULL' WHEN 'd' THEN 'SET DEFAULT' ELSE c.confdeltype::text END
         || ', ON UPDATE '
         || CASE c.confupdtype WHEN 'c' THEN 'CASCADE' WHEN 'a' THEN 'NO ACTION' WHEN 'r' THEN 'RESTRICT'
                               WHEN 'n' THEN 'SET NULL' WHEN 'd' THEN 'SET DEFAULT' ELSE c.confupdtype::text END AS forma
    FROM pg_constraint c
    JOIN tab ON c.conrelid = tab.t
    JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = c.conkey[1]
    JOIN pg_attribute ra ON ra.attrelid = c.confrelid AND ra.attnum = c.confkey[1]
   WHERE c.contype = 'f' AND cardinality(c.conkey) = 1 AND cardinality(c.confkey) = 1
), idx_uq AS (
  SELECT CASE WHEN i.indisunique THEN 'UNIQUE' ELSE 'comum' END
         || ' (' || (SELECT string_agg(a.attname::text, ',' ORDER BY k.ord)
                       FROM unnest(i.indkey::int2[]) WITH ORDINALITY AS k(num, ord)
                       JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = k.num) || ')'
         || CASE WHEN position('situacao=''aberto''' IN lower(regexp_replace(COALESCE(pg_get_expr(i.indpred, i.indrelid), ''), '[()[:space:]]', '', 'g'))) > 0
                 THEN ' WHERE situacao aberto' ELSE ' sem o filtro do aberto' END AS forma
    FROM pg_index i
    JOIN tab ON i.indrelid = tab.t
   WHERE i.indexrelid = to_regclass('public.uq_pedidos_de_privacidade_um_aberto')
), idx_lista AS (
  SELECT CASE WHEN i.indisunique THEN 'UNIQUE' ELSE 'comum' END
         || ' (' || (SELECT string_agg(a.attname::text, ',' ORDER BY k.ord)
                       FROM unnest(i.indkey::int2[]) WITH ORDINALITY AS k(num, ord)
                       JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = k.num) || ')'
         || CASE WHEN i.indpred IS NULL THEN '' ELSE ' parcial' END AS forma
    FROM pg_index i
    JOIN tab ON i.indrelid = tab.t
   WHERE i.indexrelid = to_regclass('public.idx_pedidos_de_privacidade_situacao_criado')
), rel AS (
  SELECT c.relrowsecurity
    FROM pg_class c
    JOIN tab ON c.oid = tab.t
), pol AS (
  SELECT p.polname::text AS nome, p.polcmd::text AS cmd,
         (SELECT string_agg(COALESCE(r.rolname::text, 'PUBLIC'), ',' ORDER BY COALESCE(r.rolname::text, 'PUBLIC'))
            FROM unnest(p.polroles) AS u(o) LEFT JOIN pg_roles r ON r.oid = u.o) AS papeis,
         lower(regexp_replace(COALESCE(pg_get_expr(p.polqual, p.polrelid), ''), '[()[:space:]]', '', 'g')) AS q,
         lower(regexp_replace(COALESCE(pg_get_expr(p.polwithcheck, p.polrelid), ''), '[()[:space:]]', '', 'g')) AS w
    FROM pg_policy p
    JOIN tab ON p.polrelid = tab.t
), pol_lista AS (
  SELECT string_agg(p.nome || ':' || p.cmd || ':' || COALESCE(p.papeis, '-'), '; ' ORDER BY p.nome) AS lista
    FROM pol p
), pol_marcas AS (
  SELECT (SELECT bool_and(position('user_id=' IN p.q) > 0 AND position('auth.uid' IN p.q) > 0
                          AND position('rls_admin_atual' IN p.q) > 0)
            FROM pol p WHERE p.nome = 'pedidos_de_privacidade_dono_ou_admin_select_policy') AS leitura,
         (SELECT bool_and(position('user_id=' IN p.w) > 0 AND position('auth.uid' IN p.w) > 0
                          AND position('situacao=''aberto''' IN p.w) > 0
                          AND position('atendido_emisnull' IN p.w) > 0
                          AND position('atendido_porisnull' IN p.w) > 0
                          AND position('observacaoisnull' IN p.w) > 0)
            FROM pol p WHERE p.nome = 'pedidos_de_privacidade_dono_insert_policy') AS insercao,
         (SELECT bool_and(position('rls_admin_atual' IN p.q) > 0 AND position('rls_admin_atual' IN p.w) > 0)
            FROM pol p WHERE p.nome = 'pedidos_de_privacidade_admin_update_policy') AS decisao
), priv AS (
  SELECT q.papel, string_agg(x.p, ',' ORDER BY x.p) AS lista
    FROM (VALUES ('PUBLIC'), ('anon'), ('authenticated'), ('service_role')) AS q(papel)
   CROSS JOIN unnest(ARRAY['DELETE', 'INSERT', 'REFERENCES', 'SELECT', 'TRIGGER', 'TRUNCATE', 'UPDATE']) AS x(p)
   CROSS JOIN tab
   WHERE tab.t IS NOT NULL
     AND CASE WHEN q.papel = 'PUBLIC'
              THEN EXISTS (SELECT 1 FROM pg_class c,
                                  aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) a
                            WHERE c.oid = tab.t AND a.grantee = 0 AND a.privilege_type = x.p)
                   OR EXISTS (SELECT 1 FROM pg_attribute pa,
                                     aclexplode(pa.attacl) a
                               WHERE pa.attrelid = tab.t AND pa.attacl IS NOT NULL
                                 AND a.grantee = 0 AND a.privilege_type = x.p)
              WHEN to_regrole(q.papel) IS NULL THEN false
              ELSE has_table_privilege(q.papel::name, tab.t, x.p)
                   OR CASE WHEN x.p IN ('INSERT', 'REFERENCES', 'SELECT', 'UPDATE')
                           THEN has_any_column_privilege(q.papel::name, tab.t, x.p)
                           ELSE false END
         END
   GROUP BY q.papel
), priv_tabela AS (
  SELECT string_agg(x.p, ',' ORDER BY x.p) AS lista
    FROM unnest(ARRAY['DELETE', 'INSERT', 'REFERENCES', 'SELECT', 'TRIGGER', 'TRUNCATE', 'UPDATE']) AS x(p)
   CROSS JOIN tab
   WHERE tab.t IS NOT NULL AND to_regrole('authenticated') IS NOT NULL
     AND has_table_privilege('authenticated'::name, tab.t, x.p)
), priv_colunas AS (
  SELECT string_agg(g.p || '(' || g.cols || ')', ' ' ORDER BY g.p) AS lista
    FROM (SELECT x.p, string_agg(a.attname::text, ', ' ORDER BY a.attname) AS cols
            FROM unnest(ARRAY['INSERT', 'REFERENCES', 'UPDATE']) AS x(p)
           CROSS JOIN tab
            JOIN pg_attribute a ON a.attrelid = tab.t AND a.attnum > 0 AND NOT a.attisdropped
           WHERE to_regrole('authenticated') IS NOT NULL
             AND has_column_privilege('authenticated'::name, tab.t, a.attnum, x.p)
           GROUP BY x.p) g
), fn AS (
  SELECT p.oid,
         (SELECT count(*) FROM pg_proc q JOIN pg_namespace n ON n.oid = q.pronamespace
           WHERE n.nspname = 'public' AND q.proname = 'pedidos_de_privacidade__carimbar') AS sobrecargas,
         md5(replace(p.prosrc, chr(13), '')) AS m,
         CASE WHEN NOT p.prosecdef AND l.lanname = 'plpgsql' AND p.provolatile = 'v' AND NOT p.proretset
                   AND p.proconfig = ARRAY['search_path=public']::text[]
                   AND pg_get_function_arguments(p.oid) = '' AND pg_get_function_result(p.oid) = 'trigger'
              THEN 'SECURITY INVOKER plpgsql VOLATILE search_path=public trigger'
              ELSE 'DIFERENTE' END AS atributos,
         'PUBLIC=' || CASE WHEN EXISTS (
                  SELECT 1 FROM aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
                   WHERE a.grantee = 0 AND a.privilege_type = 'EXECUTE') THEN 'sim' ELSE 'nao' END
              || ' anon=' || CASE WHEN to_regrole('anon') IS NULL THEN 'papel ausente'
                                  WHEN has_function_privilege('anon', p.oid, 'EXECUTE') THEN 'sim' ELSE 'nao' END
              || ' authenticated=' || CASE WHEN to_regrole('authenticated') IS NULL THEN 'papel ausente'
                                           WHEN has_function_privilege('authenticated', p.oid, 'EXECUTE') THEN 'sim' ELSE 'nao' END AS acl
    FROM pg_proc p
    JOIN pg_language l ON l.oid = p.prolang
   WHERE p.oid = to_regprocedure('public.pedidos_de_privacidade__carimbar()')
), gat AS (
  SELECT (SELECT count(*) FROM pg_trigger t WHERE t.tgrelid = tab.t AND NOT t.tgisinternal) AS gatilhos,
         EXISTS (SELECT 1 FROM pg_trigger t
                  WHERE t.tgrelid = tab.t AND t.tgname = 'tr_pedidos_de_privacidade_carimbar'
                    AND NOT t.tgisinternal AND t.tgtype = 19 AND t.tgenabled = 'O'
                    AND t.tgattr::text = ''
                    AND t.tgfoid = to_regprocedure('public.pedidos_de_privacidade__carimbar()')
                    AND position(' WHEN ' IN pg_get_triggerdef(t.oid)) = 0) AS certo
    FROM tab
   WHERE tab.t IS NOT NULL
), itens(item, esperado, vivo) AS (
  SELECT 'controle: funcoes de public visiveis a este papel', '>0',
         CASE WHEN (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                     WHERE n.nspname = 'public') > 0 THEN '>0' ELSE '0' END
  UNION ALL
  SELECT 'pedidos_de_privacidade: colunas (nome, tipo, NOT NULL, default)',
         'id:uuid:true:gen_random_uuid(),user_id:uuid:true:,tipo:text:true:,email_novo:text:false:,situacao:text:true:''aberto''::text,criado_em:timestamp with time zone:true:now(),atendido_em:timestamp with time zone:false:,atendido_por:uuid:false:,observacao:text:false:',
         COALESCE((SELECT c.forma FROM col c), 'AUSENTE')
  UNION ALL
  SELECT 'pedidos_de_privacidade: as 8 constraints pelo nome',
         'pedidos_de_privacidade_carimbo_check:c, pedidos_de_privacidade_email_do_tipo_check:c, pedidos_de_privacidade_email_formato_check:c, pedidos_de_privacidade_observacao_check:c, pedidos_de_privacidade_pkey:p, pedidos_de_privacidade_situacao_check:c, pedidos_de_privacidade_tipo_check:c, pedidos_de_privacidade_user_id_fkey:f',
         COALESCE((SELECT c.nomes FROM cons c), 'AUSENTE')
  UNION ALL
  SELECT 'pedidos_de_privacidade: a regra de cada CHECK (tipo, situacao, e-mail, carimbo, observacao)',
         'as 6 regras no lugar',
         CASE WHEN (SELECT t FROM tab) IS NULL THEN 'AUSENTE'
              WHEN (SELECT bool_and(r.ok) FROM regras_ok r)
              THEN 'as 6 regras no lugar'
              ELSE 'DIFERENTE ou ausente: ' || (SELECT string_agg(r.nome, ', ' ORDER BY r.nome) FROM regras_ok r WHERE NOT r.ok) END
  UNION ALL
  SELECT 'pedidos_de_privacidade: chave user_id -> auth.users, sem cascata',
         'user_id -> auth.users(id), ON DELETE NO ACTION, ON UPDATE NO ACTION',
         COALESCE((SELECT f.forma FROM fk f), 'AUSENTE')
  UNION ALL
  SELECT 'uq_pedidos_de_privacidade_um_aberto: unico parcial, um pedido aberto por cliente e tipo',
         'UNIQUE (user_id,tipo) WHERE situacao aberto',
         COALESCE((SELECT i.forma FROM idx_uq i), 'AUSENTE')
  UNION ALL
  SELECT 'idx_pedidos_de_privacidade_situacao_criado: a lista do painel',
         'comum (situacao,criado_em)',
         COALESCE((SELECT i.forma FROM idx_lista i), 'AUSENTE')
  UNION ALL
  SELECT 'pedidos_de_privacidade: seguranca por linha (RLS)',
         'ligada',
         COALESCE((SELECT CASE WHEN r.relrowsecurity THEN 'ligada' ELSE 'DESLIGADA' END FROM rel r), 'AUSENTE')
  UNION ALL
  SELECT 'pedidos_de_privacidade: as tres politicas (nome, comando, papel), nenhuma de DELETE',
         'pedidos_de_privacidade_admin_update_policy:w:authenticated; pedidos_de_privacidade_dono_insert_policy:a:authenticated; pedidos_de_privacidade_dono_ou_admin_select_policy:r:authenticated',
         CASE WHEN (SELECT t FROM tab) IS NULL THEN 'AUSENTE'
              ELSE COALESCE((SELECT l.lista FROM pol_lista l), 'nenhuma') END
  UNION ALL
  SELECT 'pedidos_de_privacidade: a expressao de cada politica (a cliente so o dela, o admin de agora)',
         'leitura, insercao e decisao com as marcas',
         CASE WHEN (SELECT t FROM tab) IS NULL THEN 'AUSENTE'
              WHEN COALESCE((SELECT m.leitura FROM pol_marcas m), false)
               AND COALESCE((SELECT m.insercao FROM pol_marcas m), false)
               AND COALESCE((SELECT m.decisao FROM pol_marcas m), false)
              THEN 'leitura, insercao e decisao com as marcas'
              ELSE 'DIFERENTE: leitura=' || COALESCE((SELECT m.leitura FROM pol_marcas m)::text, 'ausente')
                   || ' insercao=' || COALESCE((SELECT m.insercao FROM pol_marcas m)::text, 'ausente')
                   || ' decisao=' || COALESCE((SELECT m.decisao FROM pol_marcas m)::text, 'ausente') END
  UNION ALL
  SELECT 'pedidos_de_privacidade: PUBLIC e anon sem nenhum privilegio (tabela ou coluna)',
         'PUBLIC=nenhum anon=nenhum',
         CASE WHEN (SELECT t FROM tab) IS NULL THEN 'AUSENTE'
              ELSE 'PUBLIC=' || COALESCE((SELECT p.lista FROM priv p WHERE p.papel = 'PUBLIC'), 'nenhum')
                   || ' anon=' || COALESCE((SELECT p.lista FROM priv p WHERE p.papel = 'anon'), 'nenhum') END
  UNION ALL
  SELECT 'pedidos_de_privacidade: authenticated, privilegios de tabela',
         'SELECT',
         CASE WHEN (SELECT t FROM tab) IS NULL THEN 'AUSENTE'
              ELSE COALESCE((SELECT p.lista FROM priv_tabela p), 'nenhum') END
  UNION ALL
  SELECT 'pedidos_de_privacidade: authenticated, colunas que escreve',
         'INSERT(email_novo, tipo, user_id) UPDATE(observacao, situacao)',
         CASE WHEN (SELECT t FROM tab) IS NULL THEN 'AUSENTE'
              ELSE COALESCE((SELECT p.lista FROM priv_colunas p), 'nenhuma') END
  UNION ALL
  SELECT 'pedidos_de_privacidade: service_role le, grava e decide, e NAO apaga',
         'INSERT,SELECT,UPDATE',
         CASE WHEN (SELECT t FROM tab) IS NULL THEN 'AUSENTE'
              ELSE COALESCE((SELECT p.lista FROM priv p WHERE p.papel = 'service_role'), 'nenhum') END
  UNION ALL
  SELECT 'pedidos_de_privacidade__carimbar: sobrecargas', '1',
         (SELECT count(*)::text FROM pg_proc q JOIN pg_namespace n ON n.oid = q.pronamespace
           WHERE n.nspname = 'public' AND q.proname = 'pedidos_de_privacidade__carimbar')
  UNION ALL
  SELECT 'pedidos_de_privacidade__carimbar: corpo e o da 20261238000000 (md5)',
         'f0fedc7446dbc818697f132ae6ddd807',
         COALESCE((SELECT f.m FROM fn f), 'AUSENTE')
  UNION ALL
  SELECT 'pedidos_de_privacidade__carimbar: atributos (SECURITY INVOKER, VOLATILE, search_path=public, trigger)',
         'SECURITY INVOKER plpgsql VOLATILE search_path=public trigger',
         COALESCE((SELECT f.atributos FROM fn f), 'AUSENTE')
  UNION ALL
  SELECT 'pedidos_de_privacidade__carimbar: EXECUTE fechado ao visitante (PUBLIC, anon, authenticated)',
         'PUBLIC=nao anon=nao authenticated=nao',
         COALESCE((SELECT f.acl FROM fn f), 'AUSENTE')
  UNION ALL
  SELECT 'tr_pedidos_de_privacidade_carimbar: o unico gatilho, BEFORE UPDATE por linha, ligado',
         'BEFORE UPDATE por linha, ligado, o unico, sem WHEN',
         CASE WHEN (SELECT t FROM tab) IS NULL THEN 'AUSENTE'
              WHEN (SELECT g.certo AND g.gatilhos = 1 FROM gat g) THEN 'BEFORE UPDATE por linha, ligado, o unico, sem WHEN'
              ELSE 'DIFERENTE: ' || COALESCE((SELECT g.gatilhos::text FROM gat g), '0') || ' gatilho(s) na tabela' END
)
SELECT item, esperado, vivo, COALESCE(vivo = esperado, false) AS ok
  FROM itens
 ORDER BY ok, item;
