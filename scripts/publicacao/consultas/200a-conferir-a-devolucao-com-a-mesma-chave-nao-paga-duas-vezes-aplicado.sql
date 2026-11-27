-- 200a-conferir-a-devolucao-com-a-mesma-chave-nao-paga-duas-vezes-aplicado: DEPOIS da 20261640000000 (a funcao solicitar_estorno_com_chave(uuid, numeric, text, uuid),
-- md5 do corpo 2021a69d46d49d227e4f1f206eb8df02, a coluna order_refunds.chave_da_solicitacao e o indice unico parcial dela). SO LEITURA, somente catalogo; rol fechado
-- de 5 linhas. Nao le nenhuma devolucao nem pedido e nao chama a funcao. Antes do apply responde "AUSENTE" ou "nao" nas linhas da migration (a 200a negativa e' esperada),
-- nunca erro.
WITH fn AS (
  SELECT p.oid, md5(replace(p.prosrc, chr(13), '')) AS h,
    (l.lanname = 'plpgsql'
     AND p.prokind = 'f'
     AND p.prosecdef
     AND p.provolatile = 'v'
     AND NOT p.proisstrict
     AND NOT p.proretset
     AND p.pronargs = 4
     AND p.pronargdefaults = 0
     AND p.prorettype = 'jsonb'::regtype
     AND p.proconfig = ARRAY['search_path=public']::text[]
     AND (SELECT count(*) FROM pg_proc q WHERE q.pronamespace = 'public'::regnamespace
          AND q.proname = 'solicitar_estorno_com_chave') = 1) AS atributos
    FROM pg_proc p JOIN pg_language l ON l.oid = p.prolang
   WHERE p.pronamespace = 'public'::regnamespace AND p.proname = 'solicitar_estorno_com_chave'
), col AS (
  SELECT format_type(a.atttypid, a.atttypmod) || ' notnull=' || CASE WHEN a.attnotnull THEN 'sim' ELSE 'nao' END
         || ' padrao=' || CASE WHEN a.atthasdef THEN 'sim' ELSE 'nao' END AS forma
    FROM pg_attribute a
   WHERE a.attrelid = to_regclass('public.order_refunds') AND a.attname = 'chave_da_solicitacao' AND NOT a.attisdropped
), idx AS (
  SELECT pg_get_indexdef(i.indexrelid) AS def, i.indisvalid AND i.indisready AS valido
    FROM pg_index i
   WHERE i.indexrelid = to_regclass('public.uq_order_refunds_chave_da_solicitacao')
), itens(item, esperado, vivo) AS (
  SELECT 'controle: funcoes de public visiveis a este papel', 'sim',
         CASE WHEN COALESCE((SELECT count(*) > 0 FROM pg_proc WHERE pronamespace = 'public'::regnamespace), false) THEN 'sim' ELSE 'nao' END
  UNION ALL
  SELECT 'solicitar_estorno_com_chave: corpo exato (md5)', '2021a69d46d49d227e4f1f206eb8df02',
         COALESCE((SELECT h FROM fn LIMIT 1), 'AUSENTE')
  UNION ALL
  SELECT 'solicitar_estorno_com_chave: uma so, atributos conhecidos (SECURITY DEFINER, plpgsql, VOLATILE, retorno jsonb, 4 argumentos sem padrao, search_path=public) e EXECUTE so do authenticated (nem PUBLIC, anon ou service_role)', 'sim',
         CASE WHEN NOT EXISTS (SELECT 1 FROM fn) THEN 'AUSENTE'
              WHEN (SELECT atributos FROM fn LIMIT 1)
                   AND NOT EXISTS (SELECT 1 FROM fn f2, aclexplode(coalesce((SELECT proacl FROM pg_proc WHERE oid = f2.oid), acldefault('f', (SELECT proowner FROM pg_proc WHERE oid = f2.oid)))) g
                                    WHERE g.privilege_type = 'EXECUTE' AND g.grantee = 0)
                   AND NOT has_function_privilege('anon', (SELECT oid FROM fn LIMIT 1), 'EXECUTE')
                   AND NOT has_function_privilege('service_role', (SELECT oid FROM fn LIMIT 1), 'EXECUTE')
                   AND has_function_privilege('authenticated', (SELECT oid FROM fn LIMIT 1), 'EXECUTE') THEN 'sim'
              ELSE 'nao' END
  UNION ALL
  SELECT 'order_refunds.chave_da_solicitacao: uuid, anulavel e sem padrao', 'uuid notnull=nao padrao=nao',
         COALESCE((SELECT forma FROM col), 'AUSENTE')
  UNION ALL
  SELECT 'uq_order_refunds_chave_da_solicitacao: indice unico parcial (so chave preenchida) e valido',
         'CREATE UNIQUE INDEX uq_order_refunds_chave_da_solicitacao ON public.order_refunds USING btree (chave_da_solicitacao) WHERE (chave_da_solicitacao IS NOT NULL) valido=sim',
         COALESCE((SELECT def || ' valido=' || CASE WHEN valido THEN 'sim' ELSE 'nao' END FROM idx), 'AUSENTE')
)
SELECT item, esperado, vivo, vivo = esperado AS ok FROM itens ORDER BY (vivo = esperado), item;
