-- Só catálogo. Não lê cupons, não trava dados e não chama a RPC.
WITH alvo AS (
  SELECT to_regprocedure('public.validate_coupon_secure_v2(text,numeric)') AS oid
), estado AS (
  SELECT p.oid, md5(replace(p.prosrc, chr(13), '')) AS corpo,
         (length(p.prosrc) - length(replace(p.prosrc, 'IF v_discount <= 0 THEN', '')))
           / length('IF v_discount <= 0 THEN') AS marcas,
         ((SELECT count(*) FROM pg_proc q
            WHERE q.pronamespace = 'public'::regnamespace
              AND q.proname = 'validate_coupon_secure_v2') = 1
          AND p.prokind = 'f' AND p.prosecdef
          AND p.provolatile = 'v' AND NOT p.proisstrict AND NOT p.proretset
          AND l.lanname = 'plpgsql'
          AND p.prorettype = 'jsonb'::regtype
          AND p.proconfig = ARRAY['search_path=public']::text[]
          AND pg_get_function_arguments(p.oid) = 'p_code text, p_subtotal numeric'
          AND has_function_privilege('authenticated', p.oid, 'EXECUTE')
          AND NOT EXISTS (
            SELECT 1 FROM aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) a
             WHERE a.grantee = 0 AND a.privilege_type = 'EXECUTE'
          )) AS atributos
    FROM alvo
    LEFT JOIN pg_proc p ON p.oid = alvo.oid
    LEFT JOIN pg_language l ON l.oid = p.prolang
), itens(item, esperado, vivo) AS (
  SELECT 'controle: funcoes de public visiveis a este papel', 'sim',
         CASE WHEN EXISTS (SELECT 1 FROM pg_proc WHERE pronamespace = 'public'::regnamespace)
              THEN 'sim' ELSE 'nao' END
  UNION ALL
  SELECT 'validate_coupon_secure_v2: corpo exato (md5)', '61b90bb7f7c9729abeb94b5596914eb4',
         COALESCE(corpo, 'AUSENTE') FROM estado
  UNION ALL
  SELECT 'validate_coupon_secure_v2: guarda de desconto zero', '0',
         COALESCE(marcas::text, 'AUSENTE') FROM estado
  UNION ALL
  SELECT 'validate_coupon_secure_v2: assinatura e ACL esperadas', 'sim',
         CASE WHEN atributos IS TRUE THEN 'sim' ELSE 'nao' END FROM estado
)
SELECT item, esperado, vivo, vivo = esperado AS ok FROM itens ORDER BY ok, item;
