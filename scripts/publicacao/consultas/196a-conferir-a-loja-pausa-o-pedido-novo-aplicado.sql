-- 196a-conferir-a-loja-pausa-o-pedido-novo-aplicado: DEPOIS da 20261600000000. SO LEITURA, somente catalogo, rol fechado de 10 linhas.
-- NAO le nenhuma linha (nem pedido, nem o cartao, nem a pausa) e NAO chama nenhuma funcao da migration. Prova a tabela pausa_de_vendas fechada (linha unica,
-- RLS ligada sem politica, nenhum privilegio para anon, authenticated nem service_role), as 5 funcoes com o corpo desta migration (md5), os atributos e o
-- EXECUTE por papel (so a leitura do painel e' do authenticated), e os 2 gatilhos (o do pedido novo com o WHEN do balcao; o da marca em UPDATE OF status),
-- ligados. Antes do apply (ou depois do rollback comum) esta consulta responde "nao" (a 196a negativa e' esperada), nunca erro.
-- SUCESSORA: a 20261630000000 (a loja ja suspensa tambem pausa) redefine SO a marca; a linha da marca aceita o corpo dela tambem (a 199a confere qual).
WITH fn AS (
  SELECT p.oid, p.proname, md5(replace(p.prosrc, chr(13), '')) AS h, l.lanname, p.prosecdef, p.provolatile, p.proconfig,
         pg_get_function_result(p.oid) AS resultado,
         EXISTS (SELECT 1 FROM aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a WHERE a.grantee = 0 AND a.privilege_type = 'EXECUTE') AS publico,
         has_function_privilege('anon', p.oid, 'EXECUTE') AS anon,
         has_function_privilege('authenticated', p.oid, 'EXECUTE') AS logado,
         has_function_privilege('service_role', p.oid, 'EXECUTE') AS servico
  FROM pg_proc p JOIN pg_language l ON l.oid = p.prolang
  WHERE p.pronamespace = 'public'::regnamespace
    AND p.proname IN ('data_da_pausa_de_vendas', 'marcar_suspensa_desde', 'motivo_da_loja_nao_aceitar_pedido', 'a_loja_aceita_pedido_novo', 'situacao_das_vendas_da_loja')
), alvo AS (
  SELECT f.*, e.esperado_h, COALESCE(e.sucessor_h, e.esperado_h) AS sucessor_h, e.esperado_lingua, e.esperado_definer, e.esperado_vol, e.esperado_retorno, e.esperado_logado
  FROM (VALUES
    ('data_da_pausa_de_vendas', 'ce4f41a99d7cdce593f07cfd42ee18ec', NULL, 'sql', false, 'i', 'date', false),
    ('marcar_suspensa_desde', '162120d86a79c72a8b3622d2777dfa8d', '974c4efadc6876427ffe740312c7619b', 'plpgsql', true, 'v', 'trigger', false),
    ('motivo_da_loja_nao_aceitar_pedido', 'bfe365fb64ad8d2bb9c06efca304375c', NULL, 'plpgsql', true, 's', 'text', false),
    ('a_loja_aceita_pedido_novo', 'b53378b9838954977af9bad3af6ccbc0', NULL, 'plpgsql', true, 'v', 'trigger', false),
    ('situacao_das_vendas_da_loja', '3757e68d6bf74e5f4428eae612e60749', NULL, 'plpgsql', true, 's', 'jsonb', true)
  ) AS e(nome, esperado_h, sucessor_h, esperado_lingua, esperado_definer, esperado_vol, esperado_retorno, esperado_logado)
  LEFT JOIN fn f ON f.proname = e.nome
), certa AS (
  SELECT a.proname AS nome,
         (SELECT count(*) FROM fn x WHERE x.proname = a.proname) = 1
         AND a.h IN (a.esperado_h, a.sucessor_h) AND a.lanname = a.esperado_lingua AND a.prosecdef = a.esperado_definer AND a.provolatile = a.esperado_vol
         AND a.resultado = a.esperado_retorno AND a.proconfig = ARRAY['search_path=public, pg_temp']::text[]
         AND NOT a.publico AND NOT a.anon AND NOT a.servico AND a.logado = a.esperado_logado AS ok
  FROM alvo a WHERE a.proname IS NOT NULL
), gat AS (
  SELECT t.tgname, t.tgrelid, t.tgfoid, t.tgtype, t.tgenabled, pg_get_triggerdef(t.oid) AS def,
         (SELECT array_agg(a.attname::text ORDER BY a.attnum) FROM pg_attribute a WHERE a.attrelid = t.tgrelid AND a.attnum = ANY (t.tgattr)) AS colunas
  FROM pg_trigger t
  WHERE NOT t.tgisinternal AND t.tgname IN ('tr_a_loja_aceita_pedido_novo', 'tr_assinatura_marca_suspensa_desde')
), itens(item, esperado, vivo) AS (
  SELECT 'controle: catalogo publico visivel', 'sim', CASE WHEN EXISTS (SELECT 1 FROM pg_class WHERE relnamespace = 'public'::regnamespace) THEN 'sim' ELSE 'nao' END
  UNION ALL SELECT 'pausa_de_vendas: tabela de linha unica com as 4 colunas, RLS ligada e nenhuma politica', 'sim', CASE WHEN
    EXISTS (SELECT 1 FROM pg_class c WHERE c.oid = to_regclass('public.pausa_de_vendas') AND c.relkind = 'r' AND c.relrowsecurity)
    AND (SELECT string_agg(a.attname || ':' || format_type(a.atttypid, a.atttypmod) || ':' || a.attnotnull::text, ',' ORDER BY a.attname)
           FROM pg_attribute a WHERE a.attrelid = to_regclass('public.pausa_de_vendas') AND a.attnum > 0 AND NOT a.attisdropped)
        = 'id:smallint:true,ligada_em:timestamp with time zone:false,suspensa_desde:date:false,vale_pela_assinatura:boolean:true'
    AND EXISTS (SELECT 1 FROM pg_constraint c WHERE c.conrelid = to_regclass('public.pausa_de_vendas') AND c.conname = 'pausa_de_vendas_linha_unica' AND c.contype = 'c')
    AND NOT EXISTS (SELECT 1 FROM pg_policy p WHERE p.polrelid = to_regclass('public.pausa_de_vendas')) THEN 'sim' ELSE 'nao' END
  UNION ALL SELECT 'pausa_de_vendas: nenhum privilegio (tabela ou coluna) para anon, authenticated nem service_role', 'sim', CASE WHEN
    to_regclass('public.pausa_de_vendas') IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM unnest(ARRAY['anon', 'authenticated', 'service_role']) AS r(papel)
                     WHERE has_table_privilege(r.papel, to_regclass('public.pausa_de_vendas'), 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
                        OR has_any_column_privilege(r.papel, to_regclass('public.pausa_de_vendas'), 'SELECT,INSERT,UPDATE,REFERENCES')) THEN 'sim' ELSE 'nao' END
  UNION ALL SELECT 'data_da_pausa_de_vendas: uma so, corpo da 20261600000000 (md5), SQL IMMUTABLE com search_path fixo, EXECUTE de ninguem', 'sim',
    CASE WHEN COALESCE((SELECT bool_and(ok) FROM certa WHERE nome = 'data_da_pausa_de_vendas'), false) THEN 'sim' ELSE 'nao' END
  UNION ALL SELECT 'marcar_suspensa_desde: uma so, corpo da 20261600000000 ou da sucessora 20261630000000 (md5), SECURITY DEFINER com search_path fixo, EXECUTE de ninguem', 'sim',
    CASE WHEN COALESCE((SELECT bool_and(ok) FROM certa WHERE nome = 'marcar_suspensa_desde'), false) THEN 'sim' ELSE 'nao' END
  UNION ALL SELECT 'motivo_da_loja_nao_aceitar_pedido: uma so, corpo da 20261600000000 (md5), STABLE SECURITY DEFINER com search_path fixo, EXECUTE de ninguem', 'sim',
    CASE WHEN COALESCE((SELECT bool_and(ok) FROM certa WHERE nome = 'motivo_da_loja_nao_aceitar_pedido'), false) THEN 'sim' ELSE 'nao' END
  UNION ALL SELECT 'a_loja_aceita_pedido_novo: uma so, corpo da 20261600000000 (md5), SECURITY DEFINER com search_path fixo, EXECUTE de ninguem', 'sim',
    CASE WHEN COALESCE((SELECT bool_and(ok) FROM certa WHERE nome = 'a_loja_aceita_pedido_novo'), false) THEN 'sim' ELSE 'nao' END
  UNION ALL SELECT 'situacao_das_vendas_da_loja: uma so, corpo da 20261600000000 (md5), STABLE SECURITY DEFINER com search_path fixo, EXECUTE so de authenticated', 'sim',
    CASE WHEN COALESCE((SELECT bool_and(ok) FROM certa WHERE nome = 'situacao_das_vendas_da_loja'), false) THEN 'sim' ELSE 'nao' END
  UNION ALL SELECT 'tr_a_loja_aceita_pedido_novo: BEFORE INSERT por linha em marketplace_orders, com o WHEN do balcao, ligado', 'sim', CASE WHEN
    (SELECT count(*) FROM gat WHERE tgname = 'tr_a_loja_aceita_pedido_novo') = 1
    AND EXISTS (SELECT 1 FROM gat g WHERE g.tgname = 'tr_a_loja_aceita_pedido_novo' AND g.tgrelid = to_regclass('public.marketplace_orders')
                  AND g.tgfoid = to_regprocedure('public.a_loja_aceita_pedido_novo()') AND g.tgtype = 7 AND g.tgenabled = 'O'
                  AND position('WHEN ((new.canal IS DISTINCT FROM ''presencial''::text))' IN g.def) > 0) THEN 'sim' ELSE 'nao' END
  UNION ALL SELECT 'tr_assinatura_marca_suspensa_desde: AFTER INSERT OR UPDATE OF status por linha em assinatura_da_loja, ligado', 'sim', CASE WHEN
    (SELECT count(*) FROM gat WHERE tgname = 'tr_assinatura_marca_suspensa_desde') = 1
    AND EXISTS (SELECT 1 FROM gat g WHERE g.tgname = 'tr_assinatura_marca_suspensa_desde' AND g.tgrelid = to_regclass('public.assinatura_da_loja')
                  AND g.tgfoid = to_regprocedure('public.marcar_suspensa_desde()') AND g.tgtype = 21 AND g.tgenabled = 'O'
                  AND g.colunas = ARRAY['status']) THEN 'sim' ELSE 'nao' END
)
SELECT item, esperado, vivo, COALESCE(vivo = esperado, false) AS ok FROM itens ORDER BY ok, item;
