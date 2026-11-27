-- 199b-antes-a-loja-ja-suspensa-tambem-pausa-base-vigente: ANTES da 20261630000000. SO LEITURA, somente catalogo, rol fechado de 4 linhas (o mesmo da 199a).
-- A base vigente e' a marca da 20261600000000; aceita tambem o corpo desta para uma reaplicacao idempotente. Exige o gatilho e a tabela da 1600 (a 1630
-- so redefine a marca: sem a 1600 o pre-voo dela recusa).
WITH fn AS (
  SELECT md5(replace(p.prosrc, chr(13), '')) AS h,
         p.prosecdef AND p.proconfig = ARRAY['search_path=public, pg_temp']::text[]
           AND l.lanname = 'plpgsql' AND p.prokind = 'f' AND p.provolatile = 'v' AND NOT p.proretset
           AND pg_get_function_result(p.oid) = 'trigger'
           AND (SELECT count(*) FROM pg_catalog.pg_proc q
                WHERE q.pronamespace = 'public'::regnamespace AND q.proname = 'marcar_suspensa_desde') = 1
           AND NOT EXISTS (SELECT 1 FROM aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
                            WHERE a.grantee = 0 AND a.privilege_type = 'EXECUTE')
           AND NOT has_function_privilege('anon', p.oid, 'EXECUTE')
           AND NOT has_function_privilege('authenticated', p.oid, 'EXECUTE')
           AND NOT has_function_privilege('service_role', p.oid, 'EXECUTE') AS atributos
  FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_language l ON l.oid = p.prolang
  WHERE p.oid = to_regprocedure('public.marcar_suspensa_desde()')
), gat AS (
  SELECT count(*) = 1 AND bool_and(t.tgrelid = to_regclass('public.assinatura_da_loja')
           AND t.tgfoid = to_regprocedure('public.marcar_suspensa_desde()') AND t.tgtype = 21 AND t.tgenabled = 'O'
           AND (SELECT array_agg(a.attname::text ORDER BY a.attnum) FROM pg_catalog.pg_attribute a
                 WHERE a.attrelid = t.tgrelid AND a.attnum = ANY (t.tgattr)) = ARRAY['status']) AS certo
  FROM pg_catalog.pg_trigger t
  WHERE NOT t.tgisinternal AND t.tgname = 'tr_assinatura_marca_suspensa_desde'
), itens(item, esperado, vivo, ok) AS (
  SELECT 'marcar_suspensa_desde: corpo exato (md5)',
         '162120d86a79c72a8b3622d2777dfa8d ou 974c4efadc6876427ffe740312c7619b',
         COALESCE(fn.h, 'AUSENTE'),
         COALESCE(fn.h IN ('162120d86a79c72a8b3622d2777dfa8d', '974c4efadc6876427ffe740312c7619b'), false)
  FROM (VALUES (1)) AS controle(n) LEFT JOIN fn ON true
  UNION ALL
  SELECT 'marcar_suspensa_desde: uma so, plpgsql SECURITY DEFINER VOLATILE, retorno trigger, search_path fixo e EXECUTE de ninguem', 'sim',
         CASE WHEN fn.atributos THEN 'sim' ELSE 'nao' END,
         COALESCE(fn.atributos, false)
  FROM (VALUES (1)) AS controle(n) LEFT JOIN fn ON true
  UNION ALL
  SELECT 'tr_assinatura_marca_suspensa_desde: AFTER INSERT OR UPDATE OF status por linha em assinatura_da_loja, chama a marca, ligado', 'sim',
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
