-- 205b-antes-o-aviso-do-vale-troca-diz-que-a-loja-combina-base-vigente: ANTES da 20261645000000. SO LEITURA, somente catalogo, rol
-- fechado de 3 linhas (o mesmo da 205a). A base vigente e' devolucao_avisa_o_cliente com o corpo da 20261241000000 (md5
-- 56502b960dcf3e136c1d0d5c41091c20); aceita tambem o desta migration (reaplicacao idempotente, o que o pre-voo dela aceita). Atributos, ACL
-- (fechada a PUBLIC, anon e authenticated) e o gatilho ligado sao os que o pre-voo exige. NAO le nenhuma devolucao nem aviso.
-- Qualquer false = a loja tem outro estado: PARE, meca e revise antes de aplicar.
WITH fn AS (
  SELECT md5(replace(p.prosrc, chr(13), '')) AS h,
         p.prosecdef AND p.proconfig = ARRAY['search_path=public']::text[]
           AND l.lanname = 'plpgsql' AND p.prokind = 'f' AND p.provolatile = 'v' AND NOT p.proretset
           AND pg_get_function_result(p.oid) = 'trigger' AND p.pronargs = 0
           AND (SELECT count(*) FROM pg_catalog.pg_proc q
                WHERE q.pronamespace = 'public'::regnamespace AND q.proname = 'devolucao_avisa_o_cliente') = 1
           AND NOT EXISTS (SELECT 1 FROM aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
                            WHERE a.grantee = 0 AND a.privilege_type = 'EXECUTE')
           AND NOT has_function_privilege('anon', p.oid, 'EXECUTE')
           AND NOT has_function_privilege('authenticated', p.oid, 'EXECUTE') AS atributos
  FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_language l ON l.oid = p.prolang
  WHERE p.oid = to_regprocedure('public.devolucao_avisa_o_cliente()')
), gat AS (
  SELECT count(*) AS n,
         COALESCE(bool_and(t.tgrelid = to_regclass('public.devolucoes')
           AND t.tgfoid = to_regprocedure('public.devolucao_avisa_o_cliente()') AND t.tgenabled = 'O'), false) AS certo
  FROM pg_catalog.pg_trigger t
  WHERE NOT t.tgisinternal AND t.tgname = 'tr_devolucao_avisa_o_cliente'
), itens(item, esperado, vivo, ok) AS (
  SELECT 'devolucao_avisa_o_cliente: corpo exato (md5), o aviso do vale diz que a loja combina',
         '56502b960dcf3e136c1d0d5c41091c20 ou 68792e520aa47e6e62330718430d82a8',
         COALESCE((SELECT h FROM fn), 'AUSENTE'),
         COALESCE((SELECT h FROM fn) IN ('56502b960dcf3e136c1d0d5c41091c20', '68792e520aa47e6e62330718430d82a8'), false)
  UNION ALL
  SELECT 'devolucao_avisa_o_cliente: uma so, plpgsql SECURITY DEFINER VOLATILE, retorno trigger, search_path=public, sem EXECUTE de PUBLIC, anon nem authenticated',
         'sim',
         COALESCE((SELECT CASE WHEN atributos THEN 'sim' ELSE 'nao' END FROM fn), 'AUSENTE'),
         COALESCE((SELECT atributos FROM fn), false)
  UNION ALL
  SELECT 'tr_devolucao_avisa_o_cliente: em devolucoes, ligado, chama a funcao',
         'sim',
         CASE WHEN gat.n = 0 THEN 'ausente' WHEN gat.n = 1 AND gat.certo THEN 'sim' ELSE 'nao' END,
         gat.n = 1 AND gat.certo
  FROM gat
)
SELECT item, esperado, vivo, ok FROM itens ORDER BY ok, item;
