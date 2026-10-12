-- 16a — DEPOIS de aplicar as migrations 20261209000000 e 20261210000000 (o cupom preso depois
-- de "cancelou com o PIX gerado" volta em minutos, nao em 24 h): confere, por OBJETO, que as
-- pecas das duas estao de pe e que os corpos vivos sao os corpos FINAIS esperados:
--   * da 20261209000000: a tabela fechada `pedido_cobranca_ao_cancelar` (a foto da cobranca
--     no instante do cancelamento), a funcao `pedido__foto_da_cobranca_ao_cancelar()` e o
--     gatilho `tr_pedido_foto_da_cobranca_ao_cancelar` em `marketplace_orders`;
--   * da 20261210000000: o auxiliar `cupom__vaga_volta_em` (agora de 13 parametros, o de 9
--     deixa de existir), a RPC `vaga_do_cupom_presa(text)` e a varredura
--     `devolver_cupons_de_pedidos_mortos()`.
-- E' a prova de objetos do lote `20261209000000` + `20261210000000` em
-- scripts/frota/canais-de-backend.json: o portao (scripts/frota/publicar-release.mjs) so libera
-- a release com esta consulta POSITIVA (ou, antes do apply, NEGATIVA com a 16b positiva).
-- SO LEITURA, um unico SELECT, so catalogo (pg_attribute, pg_attrdef, pg_constraint, pg_class,
-- pg_policy, pg_trigger, pg_proc, pg_language, pg_namespace) e o agendador (cron.job: so
-- jobname, schedule e active): nenhuma linha de pedido, cupom, foto da cobranca, cliente ou
-- dinheiro e' lida nem devolvida.
--
-- Saida: item | esperado | vivo | ok, com as linhas ok = false primeiro. O rol e' FECHADO:
-- sempre as mesmas 32 linhas, em qualquer estado do banco (objeto ausente vira `AUSENTE` na
-- propria linha, nunca some uma linha). Tudo `true` = as duas migrations estao inteiras no
-- banco. Um `false` nomeia o objeto que ficou de fora ou divergiu.
--
-- O QUE CADA GRUPO DE LINHAS PROVA (cada item reprova na SUA linha)
--   * controle      -- o papel enxerga as funcoes de `public` (um catalogo vazio, por
--                      permissao, faria todo "AUSENTE" parecer erro e todo "nenhum" parecer
--                      acerto).
--   * a tabela      -- as seis colunas da migration (nome, tipo, NOT NULL e default, na ordem);
--                      a chave primaria em `order_id` (uma foto por pedido: sem ela o JOIN da
--                      varredura devolveria o mesmo cupom duas vezes); a chave estrangeira
--                      para `marketplace_orders` com ON DELETE CASCADE; a seguranca por linha
--                      (RLS) LIGADA e NENHUMA politica (a tabela e' fechada de proposito: so o
--                      dono e as funcoes SECURITY DEFINER dele leem); e NENHUM privilegio,
--                      de tabela ou de coluna, para PUBLIC, anon, authenticated nem
--                      service_role (o Supabase concede por padrao a tabela nova a tres deles).
--   * a funcao da foto -- `pedido__foto_da_cobranca_ao_cancelar()`: UMA sobrecarga, forma
--                      (linguagem, volatilidade, SECURITY DEFINER, search_path=public, retorno
--                      trigger), corpo com o sha256 da 20261209000000 (LF ou CRLF) e SEM EXECUTE
--                      para PUBLIC, anon, authenticated nem service_role (o gatilho dispara sem
--                      esse privilegio).
--   * o gatilho     -- `tr_pedido_foto_da_cobranca_ao_cancelar` existe em
--                      `public.marketplace_orders`, e' AFTER UPDATE OF status FOR EACH ROW
--                      (tgtype e a coluna de tgattr: um UPDATE que nao mexe em `status` nao o
--                      dispara), esta habilitado (tgenabled = 'O'), tem o WHEN `new.status =
--                      'cancelled' AND old.status IS DISTINCT FROM 'cancelled'` (lido de
--                      pg_get_triggerdef e comparado sem espacos nem parenteses, em minusculas: a
--                      forma que o Postgres imprime varia de versao, a condicao nao; sem o WHEN a
--                      foto seria regravada em todo UPDATE de status de um pedido ja cancelado) e
--                      executa a funcao da foto.
--   * o auxiliar    -- `cupom__vaga_volta_em`: UMA sobrecarga so, e e' a de 13 PARAMETROS (a de 9
--                      da 20261206000000 sumiu: o DROP e o CREATE da migration caem juntos),
--                      forma `sql STABLE SECURITY INVOKER search_path=public`, corpo com o sha256
--                      da 20261210000000 (LF ou CRLF) e SEM EXECUTE para PUBLIC, anon,
--                      authenticated nem service_role (so o dono e as funcoes SECURITY DEFINER
--                      que o chamam).
--   * a RPC         -- `vaga_do_cupom_presa(text)`: UMA sobrecarga, forma, corpo com o sha256 da
--                      20261210000000 e EXECUTE SO para authenticated.
--   * a varredura   -- `devolver_cupons_de_pedidos_mortos()`: UMA sobrecarga, forma, corpo com o
--                      sha256 da 20261210000000 e SEM EXECUTE para PUBLIC, anon nem authenticated.
--                      PUBLIC e' medido por aclexplode(coalesce(proacl, acldefault('f', dono))),
--                      porque has_function_privilege nao tem o pseudo-papel PUBLIC (o mesmo
--                      metodo da 12a).
--   * os donos      -- o DONO da varredura e o DONO da RPC tem EXECUTE no auxiliar. As duas sao
--                      SECURITY DEFINER e chamam o auxiliar COM O PAPEL DO DONO: se o dono de
--                      uma delas divergir do dono do auxiliar e nao tiver EXECUTE, a varredura
--                      falha em TODO ciclo (e as vagas deixam de voltar, sem erro visivel).
--   * a dependencia -- `devolver_uso_cupom(uuid)` (a varredura a chama) existe.
--   * o agendamento -- o job `devolver-cupons-de-pedidos-mortos` esta agendado a cada 15 minutos
--                      e ATIVO (a varredura so devolve a vaga se roda).
--
-- ESTA CONSULTA SO ACEITA O ESTADO DE DEPOIS DA 20261210000000. A 12a (lote 20261205+06) aceita os
-- DOIS estados (as tres funcoes de 20261205/06, ou as tres de 20261210): a mesma loja nunca fica
-- com a 12a vermelha depois deste lote. Aqui o estado de antes reprova de proposito (e e' o que
-- a 16b confirma).
--
-- VISIBILIDADE DO JOB (importante): `cron.job` tem RLS no pg_cron ("so quem criou o job ve o job"),
-- e um papel que SOFRE essa RLS pode ver ZERO jobs mesmo com o job rodando (a mesma ressalva da
-- 12a e da 8g-cron-reconciliar). Quem decide se o papel e' cego e' row_security_active('cron.job'):
-- `true` = a RLS vale para ele. A linha do agendamento so NAO conclui nada quando as DUAS coisas
-- valem: a RLS e' ativa para o papel E ele ve zero jobs; ai diz `NAO VERIFICAVEL` nas duas colunas,
-- com o motivo, e fica ok = true so para nao travar o portao por uma coisa que o papel nao enxerga
-- (o job se confere no painel do Supabase, Database -> Cron, ou pela 8g). Um papel que ATRAVESSA a
-- RLS (BYPASSRLS, como o supabase_read_only_user) tem `false` e a linha e' ESTRITA mesmo com zero
-- jobs: job ausente reprova. Tambem e' estrita quando o papel ve algum job: ausente, inativo ou com
-- outro horario reprova. Se o papel nao tem sequer USAGE no schema cron, a consulta ERRA (SQLSTATE
-- 42501) e o portao fica SEM EVIDENCIA, nunca positivo.
--
-- sha256 = encode(sha256(convert_to(prosrc, 'UTF8')), 'hex'), a mesma conta dos pos-voos das
-- migrations. Cada hash aparece aqui uma vez em LF e uma em CRLF; tests/ci_conferir_banco_test.ts
-- recalcula os oito a partir dos arquivos das migrations desta arvore, e
-- tests/banco/cupom-pix-anulado-portao-viva.cjs roda esta consulta num Postgres real (positivo
-- depois do apply, e um negativo por linha).
--
-- LIMITES: nao prova o COMPORTAMENTO (isso e' a prova viva das migrations, em
-- tests/banco/cupom-pix-anulado-viva.cjs); prova que o objeto vivo e' o das migrations. NAO le dado:
-- nao diz se ha foto gravada nem se algum cupom ja voltou. Nao prova o codigo das edge functions de
-- que a pista depende (criar-pagamento e webhook-mercadopago: so a versao delas no ar, medida por
-- loja). Evidencia LOCAL nao prova a IKCOUS nem a Savy: so o run desta consulta contra o ref de
-- cada loja.
WITH tab AS (
  SELECT to_regclass('public.pedido_cobranca_ao_cancelar') AS foto,
         to_regclass('public.marketplace_orders') AS pedidos
), col AS (
  SELECT string_agg(a.attname || ':' || format_type(a.atttypid, a.atttypmod) || ':' || a.attnotnull::text
                    || ':' || COALESCE(pg_get_expr(d.adbin, d.adrelid), ''), ',' ORDER BY a.attnum) AS forma
    FROM pg_attribute a
    JOIN tab ON a.attrelid = tab.foto
    LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
   WHERE a.attnum > 0 AND NOT a.attisdropped
), pk AS (
  SELECT (SELECT string_agg(a.attname::text, ',' ORDER BY k.ord)
            FROM unnest(c.conkey) WITH ORDINALITY AS k(num, ord)
            JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = k.num) AS colunas
    FROM pg_constraint c
    JOIN tab ON c.conrelid = tab.foto
   WHERE c.contype = 'p'
), fk AS (
  SELECT 'order_id -> marketplace_orders, ON DELETE '
         || CASE c.confdeltype WHEN 'c' THEN 'CASCADE' WHEN 'a' THEN 'NO ACTION' WHEN 'r' THEN 'RESTRICT'
                               WHEN 'n' THEN 'SET NULL' WHEN 'd' THEN 'SET DEFAULT' ELSE c.confdeltype::text END AS forma
    FROM pg_constraint c
    JOIN tab ON c.conrelid = tab.foto
   WHERE c.contype = 'f'
     AND c.confrelid = tab.pedidos
     AND c.conkey = ARRAY[(SELECT a.attnum FROM pg_attribute a
                            WHERE a.attrelid = tab.foto AND a.attname = 'order_id' AND NOT a.attisdropped)]
), rel AS (
  SELECT c.relrowsecurity
    FROM pg_class c
    JOIN tab ON c.oid = tab.foto
), pol AS (
  SELECT string_agg(p.polname::text, ', ' ORDER BY p.polname) AS lista
    FROM pg_policy p
    JOIN tab ON p.polrelid = tab.foto
), priv AS (
  SELECT q.papel, string_agg(x.p, ',' ORDER BY x.p) AS lista
    FROM (VALUES ('PUBLIC'), ('anon'), ('authenticated'), ('service_role')) AS q(papel)
   CROSS JOIN unnest(ARRAY['DELETE', 'INSERT', 'REFERENCES', 'SELECT', 'TRIGGER', 'TRUNCATE', 'UPDATE']) AS x(p)
   CROSS JOIN tab
   WHERE tab.foto IS NOT NULL
     AND CASE WHEN q.papel = 'PUBLIC'
              THEN EXISTS (SELECT 1 FROM pg_class c,
                                  aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) a
                            WHERE c.oid = tab.foto AND a.grantee = 0 AND a.privilege_type = x.p)
                   OR EXISTS (SELECT 1 FROM pg_attribute pa,
                                     aclexplode(pa.attacl) a
                               WHERE pa.attrelid = tab.foto AND pa.attacl IS NOT NULL
                                 AND a.grantee = 0 AND a.privilege_type = x.p)
              WHEN to_regrole(q.papel) IS NULL THEN false
              ELSE has_table_privilege(q.papel::name, tab.foto, x.p)
                   OR CASE WHEN x.p IN ('INSERT', 'REFERENCES', 'SELECT', 'UPDATE')
                           THEN has_any_column_privilege(q.papel::name, tab.foto, x.p)
                           ELSE false END
         END
   GROUP BY q.papel
), alvo(nome, assinatura) AS (
  VALUES ('pedido__foto_da_cobranca_ao_cancelar', 'public.pedido__foto_da_cobranca_ao_cancelar()'),
         ('cupom__vaga_volta_em', 'public.cupom__vaga_volta_em(uuid,text,text,boolean,timestamptz,boolean,timestamptz,text,integer,text,integer,text,text)'),
         ('vaga_do_cupom_presa', 'public.vaga_do_cupom_presa(text)'),
         ('devolver_cupons_de_pedidos_mortos', 'public.devolver_cupons_de_pedidos_mortos()')
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
         p.oid AS fn_oid,
         p.proowner AS dono,
         EXISTS (SELECT 1 FROM aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
                  WHERE a.grantee = 0 AND a.privilege_type = 'EXECUTE') AS exec_public,
         CASE WHEN to_regrole('anon') IS NULL THEN NULL
              ELSE has_function_privilege('anon', p.oid, 'EXECUTE') END AS exec_anon,
         CASE WHEN to_regrole('authenticated') IS NULL THEN NULL
              ELSE has_function_privilege('authenticated', p.oid, 'EXECUTE') END AS exec_auth,
         CASE WHEN to_regrole('service_role') IS NULL THEN NULL
              ELSE has_function_privilege('service_role', p.oid, 'EXECUTE') END AS exec_service
    FROM alvo t
    LEFT JOIN pg_proc p ON p.oid = to_regprocedure(t.assinatura)
    LEFT JOIN pg_language l ON l.oid = p.prolang
), gat AS (
  SELECT t.tgrelid,
         t.tgtype::int AS tgtype,
         t.tgenabled::text AS tgenabled,
         t.tgfoid,
         t.tgattr,
         pg_get_triggerdef(t.oid) AS def
    FROM pg_trigger t
    JOIN tab ON t.tgrelid = tab.pedidos
   WHERE t.tgname = 'tr_pedido_foto_da_cobranca_ao_cancelar'
     AND NOT t.tgisinternal
), gat_x AS (
  SELECT g.*,
         substring(g.def FROM ' WHEN \((.*)\) EXECUTE (?:FUNCTION|PROCEDURE) ') AS quando,
         (SELECT string_agg(a.attname::text, ',' ORDER BY k.ord)
            FROM unnest(g.tgattr::int2[]) WITH ORDINALITY AS k(num, ord)
            JOIN pg_attribute a ON a.attrelid = g.tgrelid AND a.attnum = k.num) AS colunas,
         (SELECT pn.nspname || '.' || p.proname || '(' || oidvectortypes(p.proargtypes) || ')'
            FROM pg_proc p JOIN pg_namespace pn ON pn.oid = p.pronamespace
           WHERE p.oid = g.tgfoid) AS funcao
    FROM gat g
), vis AS (
  SELECT count(*) AS n FROM cron.job
), rls AS (
  SELECT row_security_active('cron.job') AS ativa
), agendado AS (
  SELECT j.schedule, j.active
    FROM cron.job j
   WHERE j.jobname = 'devolver-cupons-de-pedidos-mortos'
), itens(item, esperado, vivo) AS (
  SELECT 'controle: funcoes de public visiveis a este papel', '>0',
         CASE WHEN (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                     WHERE n.nspname = 'public') > 0 THEN '>0' ELSE '0' END
  -- a tabela da foto
  UNION ALL
  SELECT 'pedido_cobranca_ao_cancelar: colunas (nome, tipo, NOT NULL, default)',
         'order_id:uuid:true:,gateway_payment_id:text:false:,tentativas:integer:true:,metodo_online:text:false:,payment_status:text:false:,cancelado_em:timestamp with time zone:true:now()',
         CASE WHEN (SELECT foto FROM tab) IS NULL THEN 'AUSENTE'
              ELSE COALESCE((SELECT c.forma FROM col c), 'AUSENTE') END
  UNION ALL
  SELECT 'pedido_cobranca_ao_cancelar: chave primaria', 'order_id',
         CASE WHEN (SELECT foto FROM tab) IS NULL THEN 'AUSENTE'
              ELSE COALESCE((SELECT k.colunas FROM pk k), 'sem chave primaria') END
  UNION ALL
  SELECT 'pedido_cobranca_ao_cancelar: chave estrangeira', 'order_id -> marketplace_orders, ON DELETE CASCADE',
         CASE WHEN (SELECT foto FROM tab) IS NULL THEN 'AUSENTE'
              ELSE COALESCE((SELECT f.forma FROM fk f LIMIT 1), 'sem a chave estrangeira para marketplace_orders') END
  UNION ALL
  SELECT 'pedido_cobranca_ao_cancelar: seguranca por linha (RLS) ligada', 'sim',
         COALESCE((SELECT CASE WHEN r.relrowsecurity THEN 'sim' ELSE 'nao' END FROM rel r), 'AUSENTE')
  UNION ALL
  SELECT 'pedido_cobranca_ao_cancelar: politicas', 'nenhuma',
         CASE WHEN (SELECT foto FROM tab) IS NULL THEN 'AUSENTE'
              ELSE COALESCE((SELECT p.lista FROM pol p), 'nenhuma') END
  UNION ALL
  SELECT 'pedido_cobranca_ao_cancelar: privilegios de PUBLIC, anon, authenticated e service_role', 'nenhum',
         CASE WHEN (SELECT foto FROM tab) IS NULL THEN 'AUSENTE'
              ELSE COALESCE((SELECT string_agg(p.papel || '=' || p.lista, '; ' ORDER BY p.papel) FROM priv p), 'nenhum') END
  -- a funcao do gatilho
  UNION ALL
  SELECT 'pedido__foto_da_cobranca_ao_cancelar: sobrecargas', '1',
         (SELECT f.sobrecargas::text FROM fn f WHERE f.nome = 'pedido__foto_da_cobranca_ao_cancelar')
  UNION ALL
  SELECT 'pedido__foto_da_cobranca_ao_cancelar: forma', 'plpgsql VOLATILE SECURITY DEFINER search_path=public -> trigger',
         COALESCE((SELECT f.forma FROM fn f WHERE f.nome = 'pedido__foto_da_cobranca_ao_cancelar'), 'AUSENTE')
  UNION ALL
  SELECT 'pedido__foto_da_cobranca_ao_cancelar: corpo (sha256)',
         '026044748667e241a86479c4e7a9a7d7fb99a677df5ef15a939335ff8403acf4',
         COALESCE((SELECT CASE WHEN f.h IN ('026044748667e241a86479c4e7a9a7d7fb99a677df5ef15a939335ff8403acf4',
                                            '269a863b65e3db29f14dc22fec553d8ce624a5ba070e6b7fe9cad72c12a6bcb7')
                               THEN '026044748667e241a86479c4e7a9a7d7fb99a677df5ef15a939335ff8403acf4'
                               ELSE f.h END
                     FROM fn f WHERE f.nome = 'pedido__foto_da_cobranca_ao_cancelar'), 'AUSENTE')
  UNION ALL
  SELECT 'pedido__foto_da_cobranca_ao_cancelar: EXECUTE para PUBLIC, anon, authenticated e service_role', 'nenhum',
         COALESCE((SELECT CASE WHEN NOT f.existe THEN NULL
                               ELSE COALESCE(NULLIF(concat_ws(',',
                                      CASE WHEN f.exec_public THEN 'PUBLIC' END,
                                      CASE WHEN COALESCE(f.exec_anon, false) THEN 'anon' END,
                                      CASE WHEN COALESCE(f.exec_auth, false) THEN 'authenticated' END,
                                      CASE WHEN COALESCE(f.exec_service, false) THEN 'service_role' END), ''), 'nenhum') END
                     FROM fn f WHERE f.nome = 'pedido__foto_da_cobranca_ao_cancelar'), 'AUSENTE')
  -- o gatilho
  UNION ALL
  SELECT 'gatilho tr_pedido_foto_da_cobranca_ao_cancelar: existe em marketplace_orders', 'EXISTE',
         CASE WHEN EXISTS (SELECT 1 FROM gat) THEN 'EXISTE' ELSE 'AUSENTE' END
  UNION ALL
  SELECT 'gatilho tr_pedido_foto_da_cobranca_ao_cancelar: momento e evento',
         'AFTER UPDATE OF status FOR EACH ROW',
         COALESCE((SELECT CASE WHEN g.tgtype & 2 = 2 THEN 'BEFORE'
                               WHEN g.tgtype & 64 = 64 THEN 'INSTEAD OF'
                               ELSE 'AFTER' END
                          || ' ' || concat_ws(' OR ',
                               CASE WHEN g.tgtype & 4 = 4 THEN 'INSERT' END,
                               CASE WHEN g.tgtype & 8 = 8 THEN 'DELETE' END,
                               CASE WHEN g.tgtype & 16 = 16 THEN 'UPDATE' END,
                               CASE WHEN g.tgtype & 32 = 32 THEN 'TRUNCATE' END)
                          || CASE WHEN g.tgtype & 16 = 16 AND g.colunas IS NOT NULL
                                  THEN ' OF ' || g.colunas ELSE '' END
                          || CASE WHEN g.tgtype & 1 = 1 THEN ' FOR EACH ROW' ELSE ' FOR EACH STATEMENT' END
                     FROM gat_x g), 'AUSENTE')
  UNION ALL
  SELECT 'gatilho tr_pedido_foto_da_cobranca_ao_cancelar: habilitado', 'O',
         COALESCE((SELECT g.tgenabled FROM gat g), 'AUSENTE')
  UNION ALL
  SELECT 'gatilho tr_pedido_foto_da_cobranca_ao_cancelar: condicao WHEN',
         'new.status = ''cancelled'' AND old.status IS DISTINCT FROM ''cancelled''',
         COALESCE((SELECT CASE WHEN g.quando IS NULL THEN 'sem WHEN'
                               WHEN regexp_replace(lower(g.quando), '[()[:space:]]', '', 'g')
                                    = 'new.status=''cancelled''::textandold.statusisdistinctfrom''cancelled''::text'
                                 THEN 'new.status = ''cancelled'' AND old.status IS DISTINCT FROM ''cancelled'''
                               ELSE g.quando END
                     FROM gat_x g), 'AUSENTE')
  UNION ALL
  SELECT 'gatilho tr_pedido_foto_da_cobranca_ao_cancelar: funcao executada',
         'public.pedido__foto_da_cobranca_ao_cancelar()',
         COALESCE((SELECT g.funcao FROM gat_x g), 'AUSENTE')
  -- o auxiliar
  UNION ALL
  SELECT 'cupom__vaga_volta_em: sobrecargas', '1',
         (SELECT f.sobrecargas::text FROM fn f WHERE f.nome = 'cupom__vaga_volta_em')
  UNION ALL
  SELECT 'cupom__vaga_volta_em: assinatura', 'so a de 13 parametros',
         CASE WHEN to_regprocedure('public.cupom__vaga_volta_em(uuid,text,text,boolean,timestamptz,boolean,timestamptz,text,integer,text,integer,text,text)') IS NULL
              THEN CASE WHEN to_regprocedure('public.cupom__vaga_volta_em(uuid,text,text,boolean,timestamptz,boolean,timestamptz,text,integer)') IS NOT NULL
                        THEN 'so a de 9 parametros (a 20261210000000 nao foi aplicada)'
                        ELSE 'AUSENTE' END
              WHEN to_regprocedure('public.cupom__vaga_volta_em(uuid,text,text,boolean,timestamptz,boolean,timestamptz,text,integer)') IS NOT NULL
              THEN 'a de 13 e tambem a de 9 parametros'
              ELSE 'so a de 13 parametros' END
  UNION ALL
  SELECT 'cupom__vaga_volta_em: forma', 'sql STABLE SECURITY INVOKER search_path=public -> timestamp with time zone',
         COALESCE((SELECT f.forma FROM fn f WHERE f.nome = 'cupom__vaga_volta_em'), 'AUSENTE')
  UNION ALL
  SELECT 'cupom__vaga_volta_em: corpo (sha256)',
         '0790c1962b526725c377344208392bfb7f15b1de20b0056e5bbb3002e40aa020',
         COALESCE((SELECT CASE WHEN f.h IN ('0790c1962b526725c377344208392bfb7f15b1de20b0056e5bbb3002e40aa020',
                                            '8a8be76b9afd31e4e2c41f7bf559c472fbf33891cc1a771ff9116452b18afd5a')
                               THEN '0790c1962b526725c377344208392bfb7f15b1de20b0056e5bbb3002e40aa020'
                               ELSE f.h END
                     FROM fn f WHERE f.nome = 'cupom__vaga_volta_em'), 'AUSENTE')
  UNION ALL
  SELECT 'cupom__vaga_volta_em: EXECUTE para PUBLIC, anon, authenticated e service_role', 'nenhum',
         COALESCE((SELECT CASE WHEN NOT f.existe THEN NULL
                               ELSE COALESCE(NULLIF(concat_ws(',',
                                      CASE WHEN f.exec_public THEN 'PUBLIC' END,
                                      CASE WHEN COALESCE(f.exec_anon, false) THEN 'anon' END,
                                      CASE WHEN COALESCE(f.exec_auth, false) THEN 'authenticated' END,
                                      CASE WHEN COALESCE(f.exec_service, false) THEN 'service_role' END), ''), 'nenhum') END
                     FROM fn f WHERE f.nome = 'cupom__vaga_volta_em'), 'AUSENTE')
  -- a RPC
  UNION ALL
  SELECT 'vaga_do_cupom_presa: sobrecargas', '1',
         (SELECT f.sobrecargas::text FROM fn f WHERE f.nome = 'vaga_do_cupom_presa')
  UNION ALL
  SELECT 'vaga_do_cupom_presa: forma', 'plpgsql VOLATILE SECURITY DEFINER search_path=public -> jsonb',
         COALESCE((SELECT f.forma FROM fn f WHERE f.nome = 'vaga_do_cupom_presa'), 'AUSENTE')
  UNION ALL
  SELECT 'vaga_do_cupom_presa: corpo (sha256)',
         'd752391f13d27a741c3401b20a375ef7a7952bda3dfb2f6c257b96f6128cc84d',
         COALESCE((SELECT CASE WHEN f.h IN ('d752391f13d27a741c3401b20a375ef7a7952bda3dfb2f6c257b96f6128cc84d',
                                            '9c659b8c1b18a808719c908076e9ce8948c384dae788aa396c4059512b5c1001')
                               THEN 'd752391f13d27a741c3401b20a375ef7a7952bda3dfb2f6c257b96f6128cc84d'
                               ELSE f.h END
                     FROM fn f WHERE f.nome = 'vaga_do_cupom_presa'), 'AUSENTE')
  UNION ALL
  SELECT 'vaga_do_cupom_presa: EXECUTE', 'PUBLIC=nao anon=nao authenticated=sim service_role=nao',
         COALESCE((SELECT CASE WHEN NOT f.existe THEN NULL
                               ELSE 'PUBLIC=' || CASE WHEN f.exec_public THEN 'sim' ELSE 'nao' END
                                    || ' anon=' || COALESCE(CASE WHEN f.exec_anon THEN 'sim' ELSE 'nao' END, 'papel ausente')
                                    || ' authenticated=' || COALESCE(CASE WHEN f.exec_auth THEN 'sim' ELSE 'nao' END, 'papel ausente')
                                    || ' service_role=' || COALESCE(CASE WHEN f.exec_service THEN 'sim' ELSE 'nao' END, 'papel ausente') END
                     FROM fn f WHERE f.nome = 'vaga_do_cupom_presa'), 'AUSENTE')
  -- a varredura
  UNION ALL
  SELECT 'devolver_cupons_de_pedidos_mortos: sobrecargas', '1',
         (SELECT f.sobrecargas::text FROM fn f WHERE f.nome = 'devolver_cupons_de_pedidos_mortos')
  UNION ALL
  SELECT 'devolver_cupons_de_pedidos_mortos: forma', 'plpgsql VOLATILE SECURITY DEFINER search_path=public -> integer',
         COALESCE((SELECT f.forma FROM fn f WHERE f.nome = 'devolver_cupons_de_pedidos_mortos'), 'AUSENTE')
  UNION ALL
  SELECT 'devolver_cupons_de_pedidos_mortos: corpo (sha256)',
         '0e3fffedbd871c372ad000393b9f3c1abcda64a5703735a00cd5173f98bb35ae',
         COALESCE((SELECT CASE WHEN f.h IN ('0e3fffedbd871c372ad000393b9f3c1abcda64a5703735a00cd5173f98bb35ae',
                                            'a0c8175ce56857e24fb7ebab37d18e45386f3711506f3906013ed73036c7f6ad')
                               THEN '0e3fffedbd871c372ad000393b9f3c1abcda64a5703735a00cd5173f98bb35ae'
                               ELSE f.h END
                     FROM fn f WHERE f.nome = 'devolver_cupons_de_pedidos_mortos'), 'AUSENTE')
  UNION ALL
  SELECT 'devolver_cupons_de_pedidos_mortos: EXECUTE', 'PUBLIC=nao anon=nao authenticated=nao',
         COALESCE((SELECT CASE WHEN NOT f.existe THEN NULL
                               ELSE 'PUBLIC=' || CASE WHEN f.exec_public THEN 'sim' ELSE 'nao' END
                                    || ' anon=' || COALESCE(CASE WHEN f.exec_anon THEN 'sim' ELSE 'nao' END, 'papel ausente')
                                    || ' authenticated=' || COALESCE(CASE WHEN f.exec_auth THEN 'sim' ELSE 'nao' END, 'papel ausente') END
                     FROM fn f WHERE f.nome = 'devolver_cupons_de_pedidos_mortos'), 'AUSENTE')
  -- os donos da varredura e da RPC chamam o auxiliar com o proprio papel
  UNION ALL
  SELECT 'donos da varredura e da RPC: EXECUTE no auxiliar', 'sim',
         CASE WHEN (SELECT count(*) FROM fn f
                     WHERE f.existe AND f.nome IN ('cupom__vaga_volta_em', 'vaga_do_cupom_presa',
                                                   'devolver_cupons_de_pedidos_mortos')) <> 3 THEN 'AUSENTE'
              WHEN (SELECT bool_and(has_function_privilege(d.dono, a.fn_oid, 'EXECUTE'))
                      FROM fn d, fn a
                     WHERE d.nome IN ('vaga_do_cupom_presa', 'devolver_cupons_de_pedidos_mortos')
                       AND a.nome = 'cupom__vaga_volta_em')
              THEN 'sim' ELSE 'nao' END
  -- a dependencia
  UNION ALL
  SELECT 'dependencia devolver_uso_cupom(uuid): existe', 'EXISTE',
         CASE WHEN to_regprocedure('public.devolver_uso_cupom(uuid)') IS NOT NULL THEN 'EXISTE' ELSE 'AUSENTE' END
  -- o agendamento
  UNION ALL
  SELECT 'job devolver-cupons-de-pedidos-mortos: agendado a cada 15 min e ativo',
         CASE WHEN (SELECT n FROM vis) = 0 AND (SELECT ativa FROM rls)
              THEN 'NAO VERIFICAVEL: este papel nao ve nenhum job do cron'
              ELSE 'ativo */15 * * * *' END,
         CASE WHEN (SELECT n FROM vis) = 0 AND (SELECT ativa FROM rls)
              THEN 'NAO VERIFICAVEL: este papel nao ve nenhum job do cron'
              WHEN NOT EXISTS (SELECT 1 FROM agendado) THEN 'AUSENTE'
              ELSE (SELECT string_agg(CASE WHEN g.active THEN 'ativo ' ELSE 'inativo ' END || g.schedule,
                                      '; ' ORDER BY g.schedule, g.active)
                      FROM agendado g) END
)
SELECT item, esperado, vivo, COALESCE(vivo = esperado, false) AS ok
  FROM itens
 ORDER BY ok, item;
