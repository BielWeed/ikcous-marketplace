-- 111a-conferir-a-v23-recusa-o-pagamento-pelo-app-aplicado: DEPOIS da 20261394200000 (o corpo desta migration, md5 86a30fe3502bbafd1a507ce03189bc2d).
-- Rol fechado de 5 linhas. As quatro primeiras so leem catalogo (nao chamam a create_marketplace_order_v23). A quinta e' INFORMATIVA: so CONTA os
-- pedidos pelo app presos que o defeito antigo pode ter deixado (count(*), nenhuma linha de pedido e' lida) e repete o valor nas duas colunas (nunca reprova).
WITH fn AS (
  SELECT p.oid, md5(replace(p.prosrc, chr(13), '')) AS h,
    (l.lanname = 'plpgsql'
     AND p.prokind = 'f'
     AND p.prosecdef
     AND p.provolatile = 'v'
     AND NOT p.proretset
     AND NOT p.proisstrict
     AND p.pronargs = 13
     AND p.proconfig = ARRAY['search_path=public']::text[]
     AND pg_get_function_arguments(p.oid) = 'p_items jsonb, p_total_amount numeric, p_shipping_cost numeric, p_payment_method text, p_address_id uuid, p_coupon_code text, p_customer_name text, p_customer_phone text, p_observation text, p_address_data jsonb, p_destination_cep text, p_shipping_option_id text, p_idempotency_key uuid DEFAULT NULL::uuid'
     AND pg_get_function_result(p.oid) = 'uuid'
     AND (SELECT count(*) FROM pg_proc q WHERE q.pronamespace = 'public'::regnamespace
          AND q.proname = 'create_marketplace_order_v23') = 1) AS atributos,
    (length(p.prosrc) - length(replace(p.prosrc, 'USING DETAIL = ''pedido_online_so_na_v24:', '')))
      / length('USING DETAIL = ''pedido_online_so_na_v24:') AS n_marca
    FROM pg_proc p JOIN pg_language l ON l.oid = p.prolang
   WHERE p.pronamespace = 'public'::regnamespace AND p.proname = 'create_marketplace_order_v23'
), itens(item, esperado, vivo) AS (
  SELECT 'controle: funcoes de public visiveis a este papel', 'sim',
         CASE WHEN COALESCE((SELECT count(*) > 0 FROM pg_proc WHERE pronamespace = 'public'::regnamespace), false) THEN 'sim' ELSE 'nao' END
  UNION ALL
  SELECT 'create_marketplace_order_v23: corpo exato (md5)', '86a30fe3502bbafd1a507ce03189bc2d',
         -- A 20261397000000 (o desconto do cupom e' arredondado ao centavo: o mesmo corpo com UMA linha trocada) sucede a v23: aceita os dois
         -- corpos EXATOS; normaliza ao esperado desta migration. O `vivo` mostra o esperado.
         COALESCE((SELECT CASE WHEN h IN ('86a30fe3502bbafd1a507ce03189bc2d', '54b591dc09d67f1abbc9ab3ba5f62f5e') THEN '86a30fe3502bbafd1a507ce03189bc2d' ELSE h END
                     FROM fn LIMIT 1), 'AUSENTE')
  UNION ALL
  SELECT 'create_marketplace_order_v23: o corpo traz a recusa do pagamento pelo app (uma vez)', 'sim',
         CASE WHEN NOT EXISTS (SELECT 1 FROM fn) THEN 'AUSENTE'
              WHEN (SELECT n_marca FROM fn LIMIT 1) = 1 THEN 'sim'
              WHEN (SELECT n_marca FROM fn LIMIT 1) = 0 THEN 'nao'
              ELSE 'DIFERENTE' END
  UNION ALL
  SELECT 'create_marketplace_order_v23: uma assinatura so, atributos e EXECUTE de sempre (SECURITY DEFINER, search_path=public, plpgsql, VOLATILE, retorno uuid; anon, authenticated e service_role, sem PUBLIC)', 'sim',
         CASE WHEN NOT EXISTS (SELECT 1 FROM fn) THEN 'AUSENTE'
              WHEN (SELECT atributos FROM fn LIMIT 1)
                   AND NOT EXISTS (SELECT 1 FROM fn f2, aclexplode(coalesce((SELECT proacl FROM pg_proc WHERE oid = f2.oid), acldefault('f', (SELECT proowner FROM pg_proc WHERE oid = f2.oid)))) g
                                    WHERE g.privilege_type = 'EXECUTE' AND g.grantee = 0)
                   AND has_function_privilege('anon', (SELECT oid FROM fn LIMIT 1), 'EXECUTE')
                   AND has_function_privilege('authenticated', (SELECT oid FROM fn LIMIT 1), 'EXECUTE')
                   AND has_function_privilege('service_role', (SELECT oid FROM fn LIMIT 1), 'EXECUTE') THEN 'sim'
              ELSE 'nao' END
  UNION ALL
  -- INFORMATIVO: pedido pelo app preso que a v23 criava antes desta migration (payment_method 'online', pending, sem payment_status). A lojista os
  -- cancela pelo painel (o cancelamento devolve estoque e cupom). So a contagem; esperado = vivo, nunca reprova.
  SELECT 'informativo: pedidos pelo app presos (online, pending, sem payment_status)',
         (SELECT count(*) FROM public.marketplace_orders WHERE payment_method = 'online' AND payment_status IS NULL AND status = 'pending')::text,
         (SELECT count(*) FROM public.marketplace_orders WHERE payment_method = 'online' AND payment_status IS NULL AND status = 'pending')::text
)
SELECT item, esperado, vivo, vivo = esperado AS ok FROM itens ORDER BY (vivo = esperado), item;
