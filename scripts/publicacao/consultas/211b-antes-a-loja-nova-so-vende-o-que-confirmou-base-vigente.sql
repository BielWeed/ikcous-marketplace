-- 211b-antes-a-loja-nova-so-vende-o-que-confirmou-base-vigente: ANTES da 20261655000000; prova que a loja esta na base
-- que o pre-voo dela aceita: forma_de_pagamento_aceita com o corpo da 20261174000000 (ou o desta, reaplicacao) e os
-- atributos de sempre, as duas colunas de confirmacao da 20261652000000 presentes, a vitrine com as 48 colunas da
-- 20261310000000 (ou as 50 desta) e nenhum gatilho estranho com o nome do desta. Positiva antes e depois do apply;
-- depois do rollback-manual tambem.
-- NAO MEDE a trava das lojas em operacao (pedido existente com confirmacao vazia): isso le dado, e a propria migration
-- recusa sozinha (TRAVA_LOJA_EM_OPERACAO_SEM_CONFIRMACAO), sem aplicar nada.
-- SO LEITURA: apenas catalogo, rol fechado de 4 linhas; nenhum dado de loja, de pedido ou de cliente e lido.
WITH aceita AS (
  SELECT md5(replace(p.prosrc, chr(13), '')) AS m,
         p.prosecdef AND l.lanname = 'plpgsql' AND p.provolatile = 's' AND NOT p.proretset
           AND p.proconfig = ARRAY['search_path=public, pg_temp']::text[]
           AND pg_get_function_result(p.oid) = 'boolean'
           AND (SELECT count(*) FROM pg_proc q WHERE q.pronamespace = 'public'::regnamespace AND q.proname = p.proname) = 1 AS atributos_ok
    FROM pg_proc p JOIN pg_language l ON l.oid = p.prolang
   WHERE p.oid = to_regprocedure('public.forma_de_pagamento_aceita(text)')
), colunas AS (
  SELECT count(*) AS n FROM pg_attribute a
   WHERE a.attrelid = to_regclass('public.store_config') AND a.attnum > 0 AND NOT a.attisdropped
     AND a.attname IN ('entrega_confirmada_em', 'pagamento_confirmado_em')
     AND a.atttypid = 'timestamptz'::regtype AND NOT a.attnotnull AND NOT a.atthasdef
), vista AS (
  SELECT md5(string_agg(a.attname, ',' ORDER BY a.attnum)) AS m
    FROM pg_attribute a WHERE a.attrelid = to_regclass('public.v_store_config') AND a.attnum > 0 AND NOT a.attisdropped
), itens(item, esperado, vivo) AS (
  SELECT 'forma_de_pagamento_aceita: corpo da 20261174000000 ou desta (md5), atributos de sempre', '4f90cbc8b1c98be2fd1c6d862468376c sim',
         COALESCE((SELECT CASE WHEN m = 'a38a13934096d55b10fcfdb1416a9c08' THEN '4f90cbc8b1c98be2fd1c6d862468376c' ELSE m END
                          || ' ' || CASE WHEN atributos_ok THEN 'sim' ELSE 'nao' END
                     FROM aceita), 'AUSENTE')
  UNION ALL
  SELECT 'store_config: entrega_confirmada_em e pagamento_confirmado_em da 20261652000000 (timestamptz, anulaveis, sem default)', '2',
         (SELECT n::text FROM colunas)
  UNION ALL
  SELECT 'v_store_config: as 48 colunas da 20261310000000 (ou as 50 desta), security_invoker', 'sim',
         CASE WHEN (SELECT m FROM vista) IN ('b7ee2c31d91549a168a502de0ac4c5d2', '39fbabdd4cd002cb626ecaa7c5112cdb')
                AND 'security_invoker=on' = ANY((SELECT reloptions FROM pg_class WHERE oid = to_regclass('public.v_store_config'))::text[])
              THEN 'sim' ELSE 'nao' END
  UNION ALL
  SELECT 'tr_a_loja_so_entrega_o_confirmado: ausente, ou o desta (reaplicacao)', 'sim',
         CASE WHEN NOT EXISTS (SELECT 1 FROM pg_trigger t WHERE NOT t.tgisinternal AND t.tgname = 'tr_a_loja_so_entrega_o_confirmado'
                                 AND (t.tgrelid IS DISTINCT FROM to_regclass('public.marketplace_orders')
                                      OR t.tgfoid IS DISTINCT FROM to_regprocedure('public.a_loja_so_entrega_na_cidade_o_que_confirmou()')))
              THEN 'sim' ELSE 'nao' END
)
SELECT item, esperado, vivo, COALESCE(vivo = esperado, false) AS ok FROM itens ORDER BY ok, item;
