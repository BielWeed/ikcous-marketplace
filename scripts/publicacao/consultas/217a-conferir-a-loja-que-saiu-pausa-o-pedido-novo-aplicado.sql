-- 217a-conferir-a-loja-que-saiu-pausa-o-pedido-novo-aplicado: DEPOIS da 20261661000000. SO LEITURA, somente catalogo, rol fechado de 5 linhas.
-- NAO le nenhuma linha (nem o cartao, nem a pausa) e NAO chama o motivo. Prova o motivo motivo_da_loja_nao_aceitar_pedido com o corpo DESTA migration (md5),
-- os atributos e o EXECUTE de ninguem, a fechadura e o gatilho do pedido da 20261600000000 (quem transforma 'vendas_pausadas' em recusa) e a tabela
-- pausa_de_vendas. Antes do apply (ou depois do rollback) a linha do corpo responde 'nao' (a 217a negativa e' esperada), nunca erro.
WITH fn AS (
  SELECT md5(replace(p.prosrc, chr(13), '')) AS h,
         p.prosecdef AND p.proconfig = ARRAY['search_path=public, pg_temp']::text[]
           AND l.lanname = 'plpgsql' AND p.prokind = 'f' AND p.provolatile = 's' AND NOT p.proretset
           AND pg_get_function_result(p.oid) = 'text'
           AND (SELECT count(*) FROM pg_catalog.pg_proc q
                WHERE q.pronamespace = 'public'::regnamespace AND q.proname = 'motivo_da_loja_nao_aceitar_pedido') = 1
           AND NOT EXISTS (SELECT 1 FROM aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
                            WHERE a.grantee = 0 AND a.privilege_type = 'EXECUTE')
           AND NOT has_function_privilege('anon', p.oid, 'EXECUTE')
           AND NOT has_function_privilege('authenticated', p.oid, 'EXECUTE')
           AND NOT has_function_privilege('service_role', p.oid, 'EXECUTE') AS atributos
  FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_language l ON l.oid = p.prolang
  WHERE p.oid = to_regprocedure('public.motivo_da_loja_nao_aceitar_pedido()')
), fechadura AS (
  SELECT md5(replace(p.prosrc, chr(13), '')) AS h
  FROM pg_catalog.pg_proc p
  WHERE p.oid = to_regprocedure('public.a_loja_aceita_pedido_novo()')
), gat AS (
  SELECT count(*) = 1 AND bool_and(t.tgrelid = to_regclass('public.marketplace_orders')
           AND t.tgfoid = to_regprocedure('public.a_loja_aceita_pedido_novo()') AND t.tgtype = 7 AND t.tgenabled = 'O'
           AND t.tgqual IS NOT NULL) AS certo
  FROM pg_catalog.pg_trigger t
  WHERE NOT t.tgisinternal AND t.tgname = 'tr_a_loja_aceita_pedido_novo'
), itens(item, esperado, vivo, ok) AS (
  SELECT 'motivo_da_loja_nao_aceitar_pedido: corpo exato (md5)',
         'f2404f96cd8a589f2821eb5c20a85aa2',
         COALESCE(fn.h, 'AUSENTE'),
         COALESCE(fn.h = 'f2404f96cd8a589f2821eb5c20a85aa2', false)
  FROM (VALUES (1)) AS controle(n) LEFT JOIN fn ON true
  UNION ALL
  SELECT 'motivo_da_loja_nao_aceitar_pedido: uma so, plpgsql SECURITY DEFINER STABLE, retorno text, search_path fixo e EXECUTE de ninguem', 'sim',
         CASE WHEN fn.atributos THEN 'sim' ELSE 'nao' END,
         COALESCE(fn.atributos, false)
  FROM (VALUES (1)) AS controle(n) LEFT JOIN fn ON true
  UNION ALL
  SELECT 'a_loja_aceita_pedido_novo: a fechadura da 20261600000000 (md5), que recusa vendas_pausadas',
         'b53378b9838954977af9bad3af6ccbc0',
         COALESCE(fechadura.h, 'AUSENTE'),
         COALESCE(fechadura.h = 'b53378b9838954977af9bad3af6ccbc0', false)
  FROM (VALUES (1)) AS controle(n) LEFT JOIN fechadura ON true
  UNION ALL
  SELECT 'tr_a_loja_aceita_pedido_novo: BEFORE INSERT por linha em marketplace_orders com o WHEN do balcao, chama a fechadura, ligado', 'sim',
         CASE WHEN gat.certo THEN 'sim' ELSE 'nao' END,
         COALESCE(gat.certo, false)
  FROM gat
  UNION ALL
  SELECT 'pausa_de_vendas: a tabela de linha unica da 20261600000000 (4 colunas)', 'sim',
         CASE WHEN x.certa THEN 'sim' ELSE 'nao' END,
         x.certa
  FROM (SELECT EXISTS (SELECT 1 FROM pg_catalog.pg_class c WHERE c.oid = to_regclass('public.pausa_de_vendas') AND c.relkind = 'r')
               AND COALESCE((SELECT string_agg(a.attname || ':' || format_type(a.atttypid, a.atttypmod) || ':' || a.attnotnull::text, ',' ORDER BY a.attname)
                               FROM pg_catalog.pg_attribute a
                              WHERE a.attrelid = to_regclass('public.pausa_de_vendas') AND a.attnum > 0 AND NOT a.attisdropped)
                             = 'id:smallint:true,ligada_em:timestamp with time zone:false,suspensa_desde:date:false,vale_pela_assinatura:boolean:true', false) AS certa) AS x
)
SELECT item, esperado, vivo, ok FROM itens ORDER BY ok, item;
