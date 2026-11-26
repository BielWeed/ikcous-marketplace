-- 188a-conferir-o-livro-de-registro-aplicado: DEPOIS da 20261510000000. SO LEITURA, um unico SELECT, somente catalogo e o agendador
-- (cron.job: so jobname, schedule e active), rol fechado de 10 linhas. Nao le NENHUMA linha do livro (versoes antigas de pedidos,
-- devolucoes e caixa: dado de cliente e de dinheiro) nem das 17 tabelas que ele vigia, nem o comando dos jobs.
-- Confere o ESTADO NOVO inteiro: as duas funcoes (corpo pelo md5, sem o \r de um apply em CRLF), os atributos e o EXECUTE de ninguem,
-- as 3 tabelas seladas (RLS sem politica, nada para PUBLIC, anon, authenticated e service_role, nem na sequencia do id, fora do
-- realtime), a forma das colunas, os 34 gatilhos por comando nas 17 tabelas e o job diario da limpeza.
-- NAO exige a chave LIGADA, de proposito: desligar o livro (UPDATE na chave, sem deploy) e' a alavanca de emergencia, e um portao que
-- reprovasse a loja por isso empurraria a pessoa a religar sem querer. Ligado ou desligado se le no painel, nao aqui (e ler a chave
-- seria ler linha de tabela).
-- VISIBILIDADE DO JOB: cron.job tem RLS no pg_cron real ("so quem criou ve o job"). Se a RLS vale para o papel (row_security_active)
-- E ele nao ve job nenhum, a linha do job nao conclui nada e fica 'sim' (mesma regra da 16a e da 12a; o job se confere no painel,
-- Database -> Cron). Papel que atravessa a RLS (o supabase_read_only_user tem BYPASSRLS) ou que ve algum job: linha ESTRITA. Sem USAGE
-- no schema cron a consulta ERRA (42501) e o portao fica sem evidencia, nunca positivo.
WITH anotar AS (
  SELECT p.oid, md5(replace(p.prosrc, chr(13), '')) AS h, l.lanname, p.prosecdef, p.proconfig, pg_get_function_result(p.oid) AS resultado,
         p.proacl, p.proowner
  FROM pg_proc p JOIN pg_language l ON l.oid = p.prolang
  WHERE p.pronamespace = 'public'::regnamespace AND p.proname = 'livro_de_registro_anotar'
), limpar AS (
  SELECT p.oid, md5(replace(p.prosrc, chr(13), '')) AS h, l.lanname, p.prosecdef, p.proconfig, pg_get_function_result(p.oid) AS resultado,
         p.proacl, p.proowner
  FROM pg_proc p JOIN pg_language l ON l.oid = p.prolang
  WHERE p.pronamespace = 'public'::regnamespace AND p.proname = 'livro_de_registro_limpar'
), livros AS (
  SELECT x.nome, c.oid, c.relkind, c.relrowsecurity, c.relacl, c.relowner,
         (SELECT string_agg(a.attname || ':' || format_type(a.atttypid, a.atttypmod) || ':' || a.attnotnull::text, ',' ORDER BY a.attnum)
            FROM pg_attribute a WHERE a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped) AS forma
  FROM unnest(ARRAY['livro_de_registro', 'livro_de_registro_chave', 'livro_de_registro_falhas']) AS x(nome)
  LEFT JOIN pg_class c ON c.oid = to_regclass('public.' || x.nome)
), seq AS (
  SELECT c.oid, c.relacl, c.relowner FROM pg_class c WHERE c.oid = to_regclass('public.livro_de_registro_id_seq') AND c.relkind = 'S'
), esperados AS (
  SELECT e.tabela, e.origem, g.nome, g.tipo, g.novos
  FROM (VALUES ('marketplace_orders', 'user_id'), ('marketplace_order_items', 'order_id'), ('order_refunds', 'order_id'),
               ('marketplace_order_payment_history', 'order_id'), ('devolucoes', 'user_id'), ('devolucao_itens', 'devolucao_id'),
               ('produtos', ''), ('product_variants', ''), ('categorias', ''), ('coupons', ''), ('fornecedores', ''),
               ('fin_lancamentos', ''), ('fin_contas', ''), ('fin_categorias', ''), ('store_config', ''),
               ('config_pagamento_cartao', ''), ('politica_devolucao', '')) AS e(tabela, origem)
  CROSS JOIN (VALUES ('tr_livro_alteracao', 16, 'novos'), ('tr_livro_exclusao', 8, NULL)) AS g(nome, tipo, novos)
), vis AS (
  SELECT count(*) AS n FROM cron.job
), rls AS (
  SELECT row_security_active('cron.job') AS ativa
), agendado AS (
  SELECT j.schedule, j.active FROM cron.job j WHERE j.jobname = 'limpar-livro-de-registro'
), itens(item, esperado, vivo) AS (
  SELECT 'controle: catalogo publico visivel', 'sim', CASE WHEN EXISTS (SELECT 1 FROM pg_class WHERE relnamespace = 'public'::regnamespace) THEN 'sim' ELSE 'nao' END
  UNION ALL SELECT 'livro_de_registro_anotar: uma so, com o corpo da 20261510000000 (md5)', 'sim', CASE WHEN
    (SELECT count(*) FROM anotar) = 1 AND EXISTS (SELECT 1 FROM anotar WHERE h = '80db6ca427538fb22a3cc1b04f7f7f61') THEN 'sim' ELSE 'nao' END
  UNION ALL SELECT 'livro_de_registro_anotar: plpgsql, trigger, SECURITY DEFINER, search_path pg_catalog e pg_temp, lock_timeout 200ms, e EXECUTE para ninguem de aplicacao', 'sim', CASE WHEN COALESCE(
    (SELECT bool_and(f.lanname = 'plpgsql' AND f.prosecdef AND f.resultado = 'trigger'
        AND f.proconfig = ARRAY['search_path=pg_catalog, pg_temp', 'lock_timeout=200ms']::text[]
        AND NOT has_function_privilege('anon', f.oid, 'EXECUTE')
        AND NOT has_function_privilege('authenticated', f.oid, 'EXECUTE')
        AND NOT has_function_privilege('service_role', f.oid, 'EXECUTE')
        AND NOT EXISTS (SELECT 1 FROM aclexplode(coalesce(f.proacl, acldefault('f', f.proowner))) a WHERE a.grantee = 0))
       FROM anotar f), false) THEN 'sim' ELSE 'nao' END
  UNION ALL SELECT 'livro_de_registro_limpar: uma so, com o corpo da 20261510000000 (md5)', 'sim', CASE WHEN
    (SELECT count(*) FROM limpar) = 1 AND EXISTS (SELECT 1 FROM limpar WHERE h = '9edc91145381d6e041fce128f220d654') THEN 'sim' ELSE 'nao' END
  UNION ALL SELECT 'livro_de_registro_limpar: plpgsql, jsonb, SECURITY DEFINER, search_path pg_catalog e pg_temp, statement_timeout 60s, e EXECUTE para ninguem de aplicacao', 'sim', CASE WHEN COALESCE(
    (SELECT bool_and(f.lanname = 'plpgsql' AND f.prosecdef AND f.resultado = 'jsonb'
        AND f.proconfig = ARRAY['search_path=pg_catalog, pg_temp', 'statement_timeout=60s']::text[]
        AND NOT has_function_privilege('anon', f.oid, 'EXECUTE')
        AND NOT has_function_privilege('authenticated', f.oid, 'EXECUTE')
        AND NOT has_function_privilege('service_role', f.oid, 'EXECUTE')
        AND NOT EXISTS (SELECT 1 FROM aclexplode(coalesce(f.proacl, acldefault('f', f.proowner))) a WHERE a.grantee = 0))
       FROM limpar f), false) THEN 'sim' ELSE 'nao' END
  UNION ALL SELECT 'livro_de_registro, livro_de_registro_chave e livro_de_registro_falhas: tabelas comuns, RLS ligada, nenhuma politica, fora do realtime, nada para PUBLIC, anon, authenticated e service_role (tabela e colunas)', 'sim', CASE WHEN COALESCE(
    (SELECT count(*) = 3 AND bool_and(t.relkind = 'r' AND t.relrowsecurity
        AND NOT EXISTS (SELECT 1 FROM pg_policy p WHERE p.polrelid = t.oid)
        AND NOT EXISTS (SELECT 1 FROM pg_publication_tables pt WHERE pt.schemaname = 'public' AND pt.tablename = t.nome)
        AND NOT EXISTS (SELECT 1 FROM aclexplode(coalesce(t.relacl, acldefault('r', t.relowner))) a WHERE a.grantee = 0)
        AND NOT EXISTS (SELECT 1 FROM pg_attribute a, aclexplode(a.attacl) g WHERE a.attrelid = t.oid AND a.attacl IS NOT NULL AND g.grantee = 0)
        AND NOT has_table_privilege('anon', t.oid, 'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER')
        AND NOT has_table_privilege('authenticated', t.oid, 'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER')
        AND NOT has_table_privilege('service_role', t.oid, 'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER')
        AND NOT has_any_column_privilege('anon', t.oid, 'SELECT, INSERT, UPDATE, REFERENCES')
        AND NOT has_any_column_privilege('authenticated', t.oid, 'SELECT, INSERT, UPDATE, REFERENCES')
        AND NOT has_any_column_privilege('service_role', t.oid, 'SELECT, INSERT, UPDATE, REFERENCES'))
       FROM livros t WHERE t.oid IS NOT NULL), false) THEN 'sim' ELSE 'nao' END
  UNION ALL SELECT 'livro_de_registro_id_seq: a sequencia do id existe e nada para PUBLIC, anon, authenticated e service_role', 'sim', CASE WHEN COALESCE(
    (SELECT NOT EXISTS (SELECT 1 FROM aclexplode(coalesce(s.relacl, acldefault('s', s.relowner))) a WHERE a.grantee = 0)
        AND NOT has_sequence_privilege('anon', s.oid, 'USAGE, SELECT, UPDATE')
        AND NOT has_sequence_privilege('authenticated', s.oid, 'USAGE, SELECT, UPDATE')
        AND NOT has_sequence_privilege('service_role', s.oid, 'USAGE, SELECT, UPDATE')
       FROM seq s), false) THEN 'sim' ELSE 'nao' END
  UNION ALL SELECT 'as 3 tabelas do livro: colunas com o tipo e a nulidade da migration (livro, chave e falhas)', 'sim', CASE WHEN
    (SELECT string_agg(t.nome || '=' || COALESCE(t.forma, 'AUSENTE'), ' | ' ORDER BY t.nome) FROM livros t)
      = 'livro_de_registro=id:bigint:true,tabela:text:true,linha_id:text:true,titular:uuid:false,operacao:text:true,antes:jsonb:true,quem:uuid:false,papel:text:false,transacao:bigint:false,quando:timestamp with time zone:true'
        || ' | livro_de_registro_chave=id:smallint:true,ligado:boolean:true,teto_linhas:integer:true,teto_banco_mb:integer:true,motivo:text:false,mudado_em:timestamp with time zone:true'
        || ' | livro_de_registro_falhas=dia:date:true,tabela:text:true,sqlstate:text:true,vezes:bigint:true,ultima:timestamp with time zone:true' THEN 'sim' ELSE 'nao' END
  UNION ALL SELECT 'as 17 tabelas: os 34 gatilhos do livro (alteracao e exclusao) por comando, habilitados, com as transicoes e o argumento do titular, e nenhum outro gatilho usando livro_de_registro_anotar', 'sim', CASE WHEN
    (SELECT count(*) FROM esperados e
      WHERE EXISTS (SELECT 1 FROM pg_trigger t JOIN anotar f ON f.oid = t.tgfoid
                     WHERE t.tgrelid = to_regclass('public.' || e.tabela) AND t.tgname = e.nome AND NOT t.tgisinternal
                       AND t.tgenabled = 'O' AND t.tgtype = e.tipo
                       AND t.tgoldtable = 'antigos' AND t.tgnewtable IS NOT DISTINCT FROM e.novos
                       AND t.tgnargs = CASE WHEN e.origem = '' THEN 0 ELSE 1 END
                       AND replace(encode(t.tgargs, 'escape'), '\000', '') = e.origem)) = 34
    AND (SELECT count(*) FROM pg_trigger t JOIN anotar f ON f.oid = t.tgfoid) = 34 THEN 'sim' ELSE 'nao' END
  UNION ALL SELECT 'o job limpar-livro-de-registro: agendado as 06:17 UTC todo dia e ativo', 'sim', CASE
    WHEN (SELECT n FROM vis) = 0 AND (SELECT ativa FROM rls) THEN 'sim'
    WHEN (SELECT count(*) FROM agendado) = 1 AND EXISTS (SELECT 1 FROM agendado WHERE schedule = '17 6 * * *' AND active) THEN 'sim'
    ELSE 'nao' END
)
SELECT item, esperado, vivo, COALESCE(vivo = esperado, false) AS ok FROM itens ORDER BY ok, item;
