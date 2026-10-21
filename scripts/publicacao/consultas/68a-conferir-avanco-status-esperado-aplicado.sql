-- Somente catalogo, rol fechado de quatro linhas. Nenhum dado de pedido.
WITH f AS (
 SELECT p.*,l.lanname FROM pg_proc p JOIN pg_language l ON l.oid=p.prolang
 WHERE p.oid=to_regprocedure('public.avancar_status_do_pedido(uuid,text,text,text)')
), itens(item,esperado,vivo) AS (
 SELECT 'avancar_status_do_pedido: unica assinatura conhecida','sim',
   CASE WHEN (SELECT count(*) FROM pg_proc WHERE pronamespace='public'::regnamespace
     AND proname='avancar_status_do_pedido')=1 AND EXISTS(SELECT 1 FROM f) THEN 'sim' ELSE 'nao' END
 UNION ALL
 SELECT 'avancar_status_do_pedido: corpo exato (md5)','fa38bcea0cc69ffff200d8e2c81bd0d3',
   COALESCE((SELECT md5(replace(prosrc,chr(13),'')) FROM f),'AUSENTE')
 UNION ALL
 SELECT 'avancar_status_do_pedido: atributos conhecidos','sim',
   CASE WHEN COALESCE((SELECT prosecdef AND prorettype='jsonb'::regtype AND NOT proretset
     AND lanname='plpgsql' AND provolatile='v' AND proconfig=ARRAY['search_path=public'] FROM f),false)
     THEN 'sim' ELSE 'nao' END
 UNION ALL
 SELECT 'avancar_status_do_pedido: EXECUTE somente authenticated','sim',
   CASE WHEN COALESCE((SELECT has_function_privilege('authenticated',oid,'EXECUTE')
     AND NOT has_function_privilege('anon',oid,'EXECUTE') AND NOT has_function_privilege('service_role',oid,'EXECUTE')
     AND NOT EXISTS(SELECT 1 FROM aclexplode(COALESCE(proacl,acldefault('f',proowner))) a
       WHERE a.grantee=0 AND a.privilege_type='EXECUTE') FROM f),false) THEN 'sim' ELSE 'nao' END
)
SELECT item,esperado,vivo,vivo=esperado AS ok FROM itens ORDER BY ok,item;
