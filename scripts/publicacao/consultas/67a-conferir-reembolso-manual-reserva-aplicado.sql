-- Somente catalogo, rol fechado de quatro linhas. Nenhum pedido ou dado de cliente.
WITH f AS (
  SELECT p.*, l.lanname FROM pg_proc p JOIN pg_language l ON l.oid=p.prolang
  WHERE p.oid=to_regprocedure('public.admin_devolucao_concluir(uuid,text,jsonb,numeric,text)')
), itens(item, esperado, vivo) AS (
  SELECT 'admin_devolucao_concluir: unica assinatura conhecida', 'sim',
    CASE WHEN (SELECT count(*) FROM pg_proc WHERE pronamespace='public'::regnamespace
      AND proname='admin_devolucao_concluir')=1 AND EXISTS(SELECT 1 FROM f) THEN 'sim' ELSE 'nao' END
  UNION ALL
  SELECT 'admin_devolucao_concluir: corpo exato (md5)', 'ea651d52157521c0fe7ffccc948b4b1a',
    COALESCE((SELECT md5(replace(prosrc,chr(13),'')) FROM f),'AUSENTE')
  UNION ALL
  SELECT 'admin_devolucao_concluir: atributos preservados', 'sim',
    CASE WHEN COALESCE((SELECT prosecdef AND prorettype='jsonb'::regtype AND NOT proretset
      AND lanname='plpgsql' AND provolatile='v' AND proconfig=ARRAY['search_path=public'] FROM f),false)
      THEN 'sim' ELSE 'nao' END
  UNION ALL
  SELECT 'admin_devolucao_concluir: authenticated permitido, PUBLIC e anon sem', 'sim',
    CASE WHEN COALESCE((SELECT has_function_privilege('authenticated',oid,'EXECUTE')
      AND NOT has_function_privilege('anon',oid,'EXECUTE') AND NOT EXISTS (
        SELECT 1 FROM aclexplode(COALESCE(proacl,acldefault('f',proowner))) a
        WHERE a.grantee=0 AND a.privilege_type='EXECUTE') FROM f),false)
      THEN 'sim' ELSE 'nao' END
)
SELECT item, esperado, vivo, vivo=esperado AS ok FROM itens ORDER BY ok,item;
