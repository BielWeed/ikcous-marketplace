-- 127b-antes-o-sino-do-pedido-vencido-fala-do-vencimento-base-vigente: ANTES da 20261399920000 (o vigente, o da 20261233000000, md5 fc8fd54a2fa1533f0d926744aab8ff58).
-- SO LEITURA, so catalogo; rol fechado de 4 linhas. Nao le nenhuma linha de pedido, de cliente ou de notificacao e nao dispara a trigger.
WITH fn AS (
  SELECT p.oid, md5(replace(p.prosrc, chr(13), '')) AS h,
    (l.lanname = 'plpgsql'
     AND p.prosecdef
     AND p.provolatile = 'v'
     AND NOT p.proretset
     AND p.proconfig = ARRAY['search_path=public']::text[]
     AND pg_get_function_arguments(p.oid) = ''
     AND pg_get_function_result(p.oid) = 'trigger'
     AND (SELECT count(*) FROM pg_proc q WHERE q.pronamespace = 'public'::regnamespace
          AND q.proname = 'notifica_cliente_de_mudanca_de_status') = 1
     AND EXISTS (SELECT 1 FROM pg_trigger t
                  WHERE t.tgname = 'tr_pedido_avisa_o_cliente'
                    AND t.tgrelid = to_regclass('public.marketplace_orders')
                    AND t.tgfoid = p.oid AND NOT t.tgisinternal AND t.tgtype = 17
                    AND t.tgattr::text = (SELECT a.attnum::text FROM pg_attribute a
                                           WHERE a.attrelid = to_regclass('public.marketplace_orders')
                                             AND a.attname = 'status' AND NOT a.attisdropped))) AS atributos,
    (length(p.prosrc) - length(replace(p.prosrc, '20261399920000: o pedido que a varredura cancelou', '')))
      / length('20261399920000: o pedido que a varredura cancelou') AS n_marca
    FROM pg_proc p JOIN pg_language l ON l.oid = p.prolang
   WHERE p.pronamespace = 'public'::regnamespace AND p.proname = 'notifica_cliente_de_mudanca_de_status'
), itens(item, esperado, vivo) AS (
  SELECT 'controle: funcoes de public visiveis a este papel', 'sim',
         CASE WHEN COALESCE((SELECT count(*) > 0 FROM pg_proc WHERE pronamespace = 'public'::regnamespace), false) THEN 'sim' ELSE 'nao' END
  UNION ALL
  SELECT 'notifica_cliente_de_mudanca_de_status: corpo exato (md5)', 'fc8fd54a2fa1533f0d926744aab8ff58',
         COALESCE((SELECT h FROM fn LIMIT 1), 'AUSENTE')
  UNION ALL
  SELECT 'notifica_cliente_de_mudanca_de_status: o corpo traz o aviso do pedido vencido (uma vez)', 'nao',
         CASE WHEN NOT EXISTS (SELECT 1 FROM fn) THEN 'AUSENTE'
              WHEN (SELECT n_marca FROM fn LIMIT 1) = 1 THEN 'sim'
              WHEN (SELECT n_marca FROM fn LIMIT 1) = 0 THEN 'nao'
              ELSE 'DIFERENTE' END
  UNION ALL
  SELECT 'notifica_cliente_de_mudanca_de_status: uma assinatura so, atributos, trigger e EXECUTE de sempre (SECURITY DEFINER, search_path=public, plpgsql, VOLATILE, retorno trigger; tr_pedido_avisa_o_cliente AFTER UPDATE OF status por linha; EXECUTE aberto por heranca do PUBLIC)', 'sim',
         CASE WHEN NOT EXISTS (SELECT 1 FROM fn) THEN 'AUSENTE'
              WHEN (SELECT atributos FROM fn LIMIT 1)
                   AND EXISTS (SELECT 1 FROM fn f2, aclexplode(coalesce((SELECT proacl FROM pg_proc WHERE oid = f2.oid), acldefault('f', (SELECT proowner FROM pg_proc WHERE oid = f2.oid)))) g
                                WHERE g.privilege_type = 'EXECUTE' AND g.grantee = 0) THEN 'sim'
              ELSE 'nao' END
)
SELECT item, esperado, vivo, vivo = esperado AS ok FROM itens ORDER BY (vivo = esperado), item;
