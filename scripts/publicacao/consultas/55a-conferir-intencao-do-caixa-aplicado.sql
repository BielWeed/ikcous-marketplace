-- 55a-conferir-intencao-do-caixa-aplicado: somente catalogo, 8 linhas fixas; nenhuma linha financeira e lida.
-- Exige as RPCs novas da 20261252 com o hash, a ACL e os atributos dela, as antigas intactas e a tabela privada.
WITH novas AS (
  SELECT p.oid, p.proname, md5(replace(p.prosrc, chr(13), '')) AS h,
    (p.prosecdef AND p.prokind = 'f' AND l.lanname = 'plpgsql'
      AND p.provolatile = 'v' AND NOT p.proisstrict AND NOT p.proretset
      AND p.proconfig = ARRAY['search_path=public']::text[]
      AND pg_get_function_result(p.oid) = 'jsonb' AND p.pronargdefaults = 1) AS atributos,
    (has_function_privilege('authenticated', p.oid, 'EXECUTE')
      AND has_function_privilege('service_role', p.oid, 'EXECUTE')
      AND NOT has_function_privilege('anon', p.oid, 'EXECUTE')
      AND NOT EXISTS (SELECT 1 FROM aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) g
                       WHERE g.grantee = 0 OR (g.grantee <> p.proowner AND
                         (g.grantee NOT IN ('authenticated'::regrole, 'service_role'::regrole) OR g.is_grantable)))) AS acl
  FROM pg_proc p JOIN pg_language l ON l.oid = p.prolang
  WHERE p.oid IN (to_regprocedure('public.fin_caixa_fechar_sessao(uuid,numeric,text)'),
                  to_regprocedure('public.fin_caixa_movimentar_com_chave(uuid,uuid,text,numeric,text,uuid)'))
), antigas AS (
  SELECT p.proname, md5(replace(p.prosrc, chr(13), '')) AS h, p.proowner
  FROM pg_proc p
  WHERE p.oid IN (to_regprocedure('public.fin_caixa_fechar(numeric,text)'),
                  to_regprocedure('public.fin_caixa_movimentar(text,numeric,text,uuid)'))
), tb AS (
  SELECT c.oid,
    (c.relkind = 'r'
     AND (SELECT string_agg(a.attname || ':' || format_type(a.atttypid, a.atttypmod) || ':' || a.attnotnull::text, ',' ORDER BY a.attnum)
            FROM pg_attribute a WHERE a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped)
         = 'chave:uuid:true,sessao_id:uuid:true,autor:uuid:false,tipo:text:true,valor:numeric(12,2):true,descricao:text:true,contrapartida_id:uuid:true,lancamento_id:uuid:true,criado_em:timestamp with time zone:true'
     AND (SELECT count(*) FROM pg_constraint WHERE conrelid = c.oid) = 4
     AND EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = c.oid AND contype = 'p' AND pg_get_constraintdef(oid) = 'PRIMARY KEY (chave)')
     AND (SELECT count(*) FROM pg_constraint k JOIN pg_attribute a ON a.attrelid = k.conrelid AND a.attnum = k.conkey[1]
           WHERE k.conrelid = c.oid AND k.contype = 'f' AND cardinality(k.conkey) = 1 AND (
                 (a.attname = 'sessao_id' AND k.confrelid = 'public.fin_caixa_sessoes'::regclass AND NOT k.condeferrable)
              OR (a.attname = 'contrapartida_id' AND k.confrelid = 'public.fin_contas'::regclass AND k.condeferrable AND k.condeferred)
              OR (a.attname = 'lancamento_id' AND k.confrelid = 'public.fin_lancamentos'::regclass AND k.condeferrable AND k.condeferred))) = 3
     AND (SELECT count(*) FROM pg_attrdef WHERE adrelid = c.oid) = 1
     AND EXISTS (SELECT 1 FROM pg_attrdef d JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
                  WHERE d.adrelid = c.oid AND a.attname = 'criado_em' AND pg_get_expr(d.adbin, d.adrelid) = 'now()')) AS forma,
    (c.relrowsecurity AND NOT c.relforcerowsecurity
     AND c.relowner = (SELECT proowner FROM antigas WHERE proname = 'fin_caixa_fechar')
     AND NOT EXISTS (SELECT 1 FROM pg_policy WHERE polrelid = c.oid)
     AND NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = c.oid AND NOT tgisinternal)
     AND NOT EXISTS (SELECT 1 FROM aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) g WHERE g.grantee <> c.relowner)
     AND NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = c.oid AND attacl IS NOT NULL)
     AND NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE schemaname = 'public' AND tablename = 'fin_caixa_movimento_tentativas')) AS privada
  FROM pg_class c WHERE c.oid = to_regclass('public.fin_caixa_movimento_tentativas')
), itens(item, esperado, vivo) AS (
  SELECT 'controle: funcoes de public visiveis a este papel', 'sim', CASE WHEN COALESCE(((SELECT count(*) > 0 FROM pg_proc WHERE pronamespace = 'public'::regnamespace)), false) THEN 'sim' ELSE 'nao' END
  UNION ALL
  SELECT 'fin_caixa_fechar_sessao: corpo conhecido (md5)', 'sim', CASE WHEN COALESCE(((SELECT h = 'f10208ba223450fd25af3c9e11dca073' FROM novas WHERE proname = 'fin_caixa_fechar_sessao')), false) THEN 'sim' ELSE 'nao' END
  UNION ALL
  SELECT 'fin_caixa_movimentar_com_chave: corpo conhecido (md5)', 'sim', CASE WHEN COALESCE(((SELECT h = '134bd5b7c5872bf30041601725fc37ba' FROM novas WHERE proname = 'fin_caixa_movimentar_com_chave')), false) THEN 'sim' ELSE 'nao' END
  UNION ALL
  SELECT 'rpcs novas do caixa: atributos e dependencias de sempre', 'sim', CASE WHEN COALESCE((
    (SELECT count(*) = 2 AND bool_and(atributos) FROM novas)
    AND (SELECT count(*) FROM pg_proc WHERE pronamespace = 'public'::regnamespace
          AND proname IN ('fin_caixa_fechar_sessao', 'fin_caixa_movimentar_com_chave')) = 2
    AND to_regprocedure('public.is_admin()') IS NOT NULL
    AND to_regprocedure('public.is_admin_atual()') IS NOT NULL
    AND to_regprocedure('public.fin__caixa_calculo(uuid)') IS NOT NULL), false) THEN 'sim' ELSE 'nao' END
  UNION ALL
  SELECT 'rpcs novas do caixa: EXECUTE de authenticated e service_role, PUBLIC e anon sem', 'sim', CASE WHEN COALESCE(((SELECT count(*) = 2 AND bool_and(acl) FROM novas)), false) THEN 'sim' ELSE 'nao' END
  UNION ALL
  SELECT 'rpcs antigas do caixa: corpo de sempre (md5)', 'sim', CASE WHEN COALESCE((
    (SELECT count(*) = 2 AND bool_and((proname = 'fin_caixa_fechar' AND h = '69a9dd8988cdc05392f500deb64f349f')
                                   OR (proname = 'fin_caixa_movimentar' AND h = 'd7e8dfeec40f89dff51f4cb3ccf14b9a')) FROM antigas)
    AND (SELECT count(*) FROM pg_proc WHERE pronamespace = 'public'::regnamespace
          AND proname IN ('fin_caixa_fechar', 'fin_caixa_movimentar')) = 2), false) THEN 'sim' ELSE 'nao' END
  UNION ALL
  SELECT 'fin_caixa_movimento_tentativas: forma conhecida', 'sim', CASE WHEN COALESCE(((SELECT forma FROM tb)), false) THEN 'sim' ELSE 'nao' END
  UNION ALL
  SELECT 'fin_caixa_movimento_tentativas: so servidor, RLS e nenhuma politica', 'sim', CASE WHEN COALESCE(((SELECT privada FROM tb)), false) THEN 'sim' ELSE 'nao' END
)
SELECT item, esperado, vivo, vivo = esperado AS ok FROM itens ORDER BY ok, item;
