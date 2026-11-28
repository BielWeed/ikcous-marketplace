-- 211a-conferir-a-loja-nova-so-vende-o-que-confirmou-aplicado: DEPOIS da 20261655000000; exige o corpo novo de
-- forma_de_pagamento_aceita (trava o pagamento na entrega ate a confirmacao), com os atributos de sempre; a funcao do
-- gatilho da entrega na cidade com o corpo desta e EXECUTE so do dono; o gatilho ligado em marketplace_orders com a
-- definicao exata; e a vitrine (v_store_config) com as 50 colunas (as 48 de antes + os dois booleanos no fim),
-- security_invoker e leitura publica. Antes do apply responde o que esta vivo, nunca erro.
-- SO LEITURA: apenas catalogo, rol fechado de 5 linhas; nenhum dado de loja, de pedido ou de cliente e lido, nenhuma
-- funcao e chamada.
WITH aceita AS (
  SELECT md5(replace(p.prosrc, chr(13), '')) AS m,
         p.prosecdef AND l.lanname = 'plpgsql' AND p.provolatile = 's' AND NOT p.proretset
           AND p.proconfig = ARRAY['search_path=public, pg_temp']::text[]
           AND pg_get_function_result(p.oid) = 'boolean'
           AND (SELECT count(*) FROM pg_proc q WHERE q.pronamespace = 'public'::regnamespace AND q.proname = p.proname) = 1 AS atributos_ok
    FROM pg_proc p JOIN pg_language l ON l.oid = p.prolang
   WHERE p.oid = to_regprocedure('public.forma_de_pagamento_aceita(text)')
), gatilho_fn AS (
  SELECT md5(replace(p.prosrc, chr(13), '')) AS m,
         p.prosecdef AND l.lanname = 'plpgsql' AND p.provolatile = 'v'
           AND p.proconfig = ARRAY['search_path=public, pg_temp']::text[]
           AND pg_get_function_result(p.oid) = 'trigger'
           AND NOT EXISTS (SELECT 1 FROM aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
                            WHERE a.privilege_type = 'EXECUTE' AND a.grantee <> p.proowner) AS atributos_ok
    FROM pg_proc p JOIN pg_language l ON l.oid = p.prolang
   WHERE p.oid = to_regprocedure('public.a_loja_so_entrega_na_cidade_o_que_confirmou()')
), vista AS (
  SELECT md5(string_agg(a.attname, ',' ORDER BY a.attnum)) AS m
    FROM pg_attribute a WHERE a.attrelid = to_regclass('public.v_store_config') AND a.attnum > 0 AND NOT a.attisdropped
), itens(item, esperado, vivo) AS (
  SELECT 'controle: funcoes de public visiveis a este papel', 'sim',
         CASE WHEN EXISTS (SELECT 1 FROM pg_proc WHERE pronamespace = 'public'::regnamespace) THEN 'sim' ELSE 'nao' END
  UNION ALL
  SELECT 'forma_de_pagamento_aceita: corpo exato (md5), pagar na entrega so com a confirmacao, atributos de sempre',
         'a38a13934096d55b10fcfdb1416a9c08 sim',
         COALESCE((SELECT m || ' ' || CASE WHEN atributos_ok THEN 'sim' ELSE 'nao' END FROM aceita), 'AUSENTE')
  UNION ALL
  SELECT 'a_loja_so_entrega_na_cidade_o_que_confirmou: corpo exato (md5), SECURITY DEFINER, EXECUTE so do dono',
         'cdfc71d233e8fe18fc9ad65f531697bf sim',
         COALESCE((SELECT m || ' ' || CASE WHEN atributos_ok THEN 'sim' ELSE 'nao' END FROM gatilho_fn), 'AUSENTE')
  UNION ALL
  SELECT 'tr_a_loja_so_entrega_o_confirmado: ligado em marketplace_orders com a definicao exata', 'sim',
         CASE WHEN (SELECT count(*) FROM pg_trigger t
                     WHERE NOT t.tgisinternal AND t.tgenabled = 'O' AND t.tgname = 'tr_a_loja_so_entrega_o_confirmado'
                       AND pg_get_triggerdef(t.oid) = 'CREATE TRIGGER tr_a_loja_so_entrega_o_confirmado BEFORE INSERT ON public.marketplace_orders FOR EACH ROW WHEN ((new.canal IS DISTINCT FROM ''presencial''::text)) EXECUTE FUNCTION a_loja_so_entrega_na_cidade_o_que_confirmou()') = 1
              THEN 'sim' ELSE 'nao' END
  UNION ALL
  SELECT 'v_store_config: as 50 colunas (os dois booleanos no fim), security_invoker e leitura publica', 'sim',
    CASE WHEN (SELECT m FROM vista) = '39fbabdd4cd002cb626ecaa7c5112cdb'
      AND 'security_invoker=on' = ANY((SELECT reloptions FROM pg_class WHERE oid = to_regclass('public.v_store_config'))::text[])
      AND has_table_privilege('anon', 'public.v_store_config', 'SELECT')
      AND has_table_privilege('authenticated', 'public.v_store_config', 'SELECT')
      AND has_table_privilege('service_role', 'public.v_store_config', 'SELECT')
      THEN 'sim' ELSE 'nao' END
)
SELECT item, esperado, vivo, COALESCE(vivo = esperado, false) AS ok FROM itens ORDER BY ok, item;
