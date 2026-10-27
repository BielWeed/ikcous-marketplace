-- 103b-antes-o-pix-pago-no-ultimo-minuto-nao-perde-o-pedido-base-vigente: ANTES da 20261393000000 (o da 20261186000000, md5 4e6b4c105ee2eaaecd9c2e19a5c535af).
-- SO LEITURA, so catalogo; rol fechado de 4 linhas. Nao le nenhum pedido nem cliente e nao chama a expirar_pedidos_vencidos.
WITH fn AS (
  SELECT p.oid, md5(replace(p.prosrc, chr(13), '')) AS h,
    (p.prokind = 'f' AND p.prosecdef AND p.proconfig = ARRAY['search_path=public']::text[]
     AND l.lanname = 'plpgsql' AND p.provolatile = 'v' AND NOT p.proretset
     AND pg_get_function_arguments(p.oid) = ''
     AND pg_get_function_result(p.oid) = 'integer'
     AND (SELECT count(*) FROM pg_proc q WHERE q.pronamespace = 'public'::regnamespace
          AND q.proname = 'expirar_pedidos_vencidos') = 1) AS atributos,
    (NOT has_function_privilege('anon', p.oid, 'EXECUTE')
     AND NOT has_function_privilege('authenticated', p.oid, 'EXECUTE')
     AND NOT EXISTS (SELECT 1 FROM aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) a
                     WHERE a.grantee = 0 AND a.privilege_type = 'EXECUTE')) AS acl
  FROM pg_proc p JOIN pg_language l ON l.oid = p.prolang
  WHERE p.oid = to_regprocedure('public.expirar_pedidos_vencidos()')
), itens(item, esperado, vivo) AS (
  SELECT 'controle: funcoes de public visiveis a este papel', 'sim',
    CASE WHEN (SELECT count(*) FROM pg_proc WHERE pronamespace = 'public'::regnamespace) > 0 THEN 'sim' ELSE 'nao' END
  UNION ALL
  SELECT 'expirar_pedidos_vencidos: corpo exato (md5)', '4e6b4c105ee2eaaecd9c2e19a5c535af',
    COALESCE((SELECT h FROM fn), 'AUSENTE')
  UNION ALL
  SELECT 'expirar_pedidos_vencidos: assinatura e atributos conhecidos (plpgsql, SECURITY DEFINER, VOLATILE, search_path=public, uma so)', 'sim',
    CASE WHEN COALESCE((SELECT atributos FROM fn), false) THEN 'sim' ELSE 'nao' END
  UNION ALL
  SELECT 'expirar_pedidos_vencidos: sem EXECUTE para PUBLIC, anon nem authenticated', 'sim',
    CASE WHEN COALESCE((SELECT acl FROM fn), false) THEN 'sim' ELSE 'nao' END
)
SELECT item, esperado, vivo, vivo = esperado AS ok FROM itens ORDER BY ok, item;
