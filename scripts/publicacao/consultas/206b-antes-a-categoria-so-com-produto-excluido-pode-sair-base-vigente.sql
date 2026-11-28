-- 206b-antes-a-categoria-so-com-produto-excluido-pode-sair-base-vigente: ANTES da 20261650000000. SO LEITURA, somente catalogo,
-- rol fechado de 3 linhas (o mesmo da 206a). A base vigente e' apagar_categoria_vazia com o corpo da 20261237000000 (md5
-- 942449150bb5e6fadfa7cf003f3fa49e); aceita tambem o desta migration (reaplicacao idempotente, o que o pre-voo dela aceita). Atributos, ACL
-- (EXECUTE so de authenticated e service_role) e o corpo de categoria__usos sao os que o pre-voo exige. NAO le nenhuma categoria
-- nem produto. Qualquer false = a loja tem outro estado: PARE, meca e revise antes de aplicar.
WITH fn AS (
  SELECT md5(replace(p.prosrc, chr(13), '')) AS h,
         p.prosecdef AND p.proconfig = ARRAY['search_path=public']::text[]
           AND l.lanname = 'plpgsql' AND p.prokind = 'f' AND p.provolatile = 'v' AND NOT p.proretset
           AND pg_get_function_result(p.oid) = 'jsonb' AND p.pronargs = 1
           AND (SELECT count(*) FROM pg_catalog.pg_proc q
                WHERE q.pronamespace = 'public'::regnamespace AND q.proname = 'apagar_categoria_vazia') = 1
           AND NOT EXISTS (SELECT 1 FROM aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
                            WHERE a.grantee = 0 AND a.privilege_type = 'EXECUTE')
           AND NOT has_function_privilege('anon', p.oid, 'EXECUTE')
           AND has_function_privilege('authenticated', p.oid, 'EXECUTE')
           AND has_function_privilege('service_role', p.oid, 'EXECUTE') AS atributos
  FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_language l ON l.oid = p.prolang
  WHERE p.oid = to_regprocedure('public.apagar_categoria_vazia(uuid)')
), usos AS (
  SELECT md5(replace(p.prosrc, chr(13), '')) AS h
  FROM pg_catalog.pg_proc p
  WHERE p.oid = to_regprocedure('public.categoria__usos(uuid)')
), itens(item, esperado, vivo, ok) AS (
  SELECT 'apagar_categoria_vazia: corpo exato (md5), a categoria so com produto excluido pode sair',
         '942449150bb5e6fadfa7cf003f3fa49e ou f1526e7727709356677c83fdea745491',
         COALESCE((SELECT h FROM fn), 'AUSENTE'),
         COALESCE((SELECT h FROM fn) IN ('942449150bb5e6fadfa7cf003f3fa49e', 'f1526e7727709356677c83fdea745491'), false)
  UNION ALL
  SELECT 'apagar_categoria_vazia: uma so, plpgsql SECURITY DEFINER VOLATILE, retorno jsonb, search_path=public, EXECUTE so de authenticated e service_role',
         'sim',
         COALESCE((SELECT CASE WHEN atributos THEN 'sim' ELSE 'nao' END FROM fn), 'AUSENTE'),
         COALESCE((SELECT atributos FROM fn), false)
  UNION ALL
  SELECT 'categoria__usos: corpo da 20261237000000 (md5), conta os produtos com os excluidos a parte',
         'de71936e57268db232630d37e88fe6cd',
         COALESCE((SELECT h FROM usos), 'AUSENTE'),
         COALESCE((SELECT h FROM usos) = 'de71936e57268db232630d37e88fe6cd', false)
)
SELECT item, esperado, vivo, ok FROM itens ORDER BY ok, item;
