-- 125a-conferir-a-busca-de-pedidos-acha-o-telefone-colado-com-o-55-aplicado: DEPOIS da 20261399900000 (o corpo desta migration, md5 bf08545275eaa451a65e15feceb0ed8d).
-- SO LEITURA, so catalogo; rol fechado de 4 linhas. Nao le nenhuma linha de pedido e nao chama a get_admin_orders_paged (ela exige admin logado).
-- O comportamento da busca (+55 colado do WhatsApp) NAO sai daqui: ver a ficha da migration e a prova viva.
WITH fn AS (
  SELECT p.oid, md5(replace(p.prosrc, chr(13), '')) AS h,
    (p.prokind = 'f' AND p.prosecdef AND p.proconfig = ARRAY['search_path=public, extensions']::text[]
     AND l.lanname = 'plpgsql' AND p.provolatile = 'v'
     AND NOT p.proisstrict AND NOT p.proretset AND p.prorettype = 'jsonb'::regtype
     AND pg_get_function_identity_arguments(p.oid) = 'p_search text, p_status text, p_start_date text, p_end_date text, p_page integer, p_page_size integer, p_payment_status text, p_canal text'
     AND (SELECT count(*) FROM pg_proc q WHERE q.pronamespace = 'public'::regnamespace
          AND q.proname = 'get_admin_orders_paged') = 1) AS atributos,
    (has_function_privilege('authenticated', p.oid, 'EXECUTE')
     AND has_function_privilege('service_role', p.oid, 'EXECUTE')
     AND NOT has_function_privilege('anon', p.oid, 'EXECUTE')
     AND NOT EXISTS (SELECT 1 FROM aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) a
                     WHERE a.grantee = 0 AND a.privilege_type = 'EXECUTE')) AS acl,
    (length(p.prosrc) - length(replace(p.prosrc, 'IF length(v_search_digitos) IN (12, 13) AND left(v_search_digitos, 2) = ''55'' THEN', '')))
      / length('IF length(v_search_digitos) IN (12, 13) AND left(v_search_digitos, 2) = ''55'' THEN') AS n_corte
  FROM pg_proc p JOIN pg_language l ON l.oid = p.prolang
  WHERE p.oid = to_regprocedure('public.get_admin_orders_paged(text,text,text,text,integer,integer,text,text)')
), itens(item, esperado, vivo) AS (
  SELECT 'controle: funcoes de public visiveis a este papel', 'sim',
    CASE WHEN (SELECT count(*) FROM pg_proc WHERE pronamespace = 'public'::regnamespace) > 0 THEN 'sim' ELSE 'nao' END
  UNION ALL
  SELECT 'get_admin_orders_paged: corpo exato (md5)', 'bf08545275eaa451a65e15feceb0ed8d',
    COALESCE((SELECT h FROM fn), 'AUSENTE')
  UNION ALL
  SELECT 'get_admin_orders_paged: o corpo corta o 55 do telefone colado (uma vez)', 'sim',
    CASE WHEN NOT EXISTS (SELECT 1 FROM fn) THEN 'AUSENTE'
         WHEN (SELECT n_corte FROM fn) = 1 THEN 'sim'
         WHEN (SELECT n_corte FROM fn) = 0 THEN 'nao'
         ELSE 'DIFERENTE' END
  UNION ALL
  SELECT 'get_admin_orders_paged: uma assinatura so, atributos e EXECUTE de sempre (SECURITY DEFINER, search_path=public, extensions, plpgsql, VOLATILE, retorno jsonb; authenticated e service_role, sem anon e sem PUBLIC)', 'sim',
    CASE WHEN NOT EXISTS (SELECT 1 FROM fn) THEN 'AUSENTE'
         WHEN COALESCE((SELECT atributos FROM fn), false) AND COALESCE((SELECT acl FROM fn), false) THEN 'sim'
         ELSE 'nao' END
)
SELECT item, esperado, vivo, vivo = esperado AS ok FROM itens ORDER BY ok, item;
