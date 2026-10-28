-- 115a-conferir-o-desconto-do-cupom-e-arredondado-ao-centavo-aplicado: DEPOIS da 20261397000000 (o desconto do cupom de porcentagem e' arredondado ao centavo).
-- SO LEITURA, so catalogo; rol fechado de 13 linhas. Nao le pedido, cupom nem dado de cliente e nao chama nenhuma das tres funcoes.
-- Hash = md5(replace(prosrc, chr(13), '')); corpo desconhecido ou ausente reprova. Reprova ANTES do apply (corpos vigentes: v23 da 20261394200000, v24 da
-- 20261394000000, validate da 20261208000000, sem o round); aprova depois, e reaplicar aprova de novo.
WITH alvo(nome, assinatura, nargs, argumentos, retorno, marca) AS (
  VALUES ('create_marketplace_order_v23', 'public.create_marketplace_order_v23(jsonb, numeric, numeric, text, uuid, text, text, text, text, jsonb, text, text, uuid)', 13, 'p_items jsonb, p_total_amount numeric, p_shipping_cost numeric, p_payment_method text, p_address_id uuid, p_coupon_code text, p_customer_name text, p_customer_phone text, p_observation text, p_address_data jsonb, p_destination_cep text, p_shipping_option_id text, p_idempotency_key uuid DEFAULT NULL::uuid', 'uuid', 'round((v_calculated_subtotal * v_coupon_val) / 100, 2)'),
         ('create_marketplace_order_v24', 'public.create_marketplace_order_v24(jsonb, numeric, numeric, text, uuid, text, text, text, text, jsonb, text, text, uuid)', 13, 'p_items jsonb, p_total_amount numeric, p_shipping_cost numeric, p_payment_method text, p_address_id uuid, p_coupon_code text, p_customer_name text, p_customer_phone text, p_observation text, p_address_data jsonb, p_destination_cep text, p_shipping_option_id text, p_idempotency_key uuid DEFAULT NULL::uuid', 'uuid', 'round((v_calculated_subtotal * v_coupon_val) / 100, 2)'),
         ('validate_coupon_secure_v2', 'public.validate_coupon_secure_v2(text, numeric)', 2, 'p_code text, p_subtotal numeric', 'jsonb', 'round((p_subtotal * v_coupon.value) / 100, 2)')
), fn AS (
  SELECT t.nome, p.oid, md5(replace(p.prosrc, chr(13), '')) AS m,
         (length(p.prosrc) - length(replace(p.prosrc, t.marca, ''))) / length(t.marca) AS n_round,
         COALESCE(p.prosecdef AND l.lanname = 'plpgsql' AND p.provolatile = 'v' AND NOT p.proretset AND NOT p.proisstrict
           AND p.pronargs = t.nargs
           AND p.proconfig = ARRAY['search_path=public']::text[]
           AND pg_get_function_arguments(p.oid) = t.argumentos
           AND pg_get_function_result(p.oid) = t.retorno
           AND (SELECT count(*) FROM pg_proc q
                 WHERE q.pronamespace = 'public'::regnamespace AND q.proname = t.nome) = 1, false) AS atributos_ok,
         EXISTS (SELECT 1 FROM aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
                  WHERE a.grantee = 0 AND a.privilege_type = 'EXECUTE') AS public_exec,
         CASE WHEN to_regrole('anon') IS NULL THEN false ELSE has_function_privilege('anon', p.oid, 'EXECUTE') END AS anon_exec,
         CASE WHEN to_regrole('authenticated') IS NULL THEN false ELSE has_function_privilege('authenticated', p.oid, 'EXECUTE') END AS auth_exec,
         CASE WHEN to_regrole('service_role') IS NULL THEN false ELSE has_function_privilege('service_role', p.oid, 'EXECUTE') END AS svc_exec
    FROM alvo t JOIN pg_proc p ON p.oid = to_regprocedure(t.assinatura)
    JOIN pg_language l ON l.oid = p.prolang
), itens(item, esperado, vivo) AS (
  SELECT 'controle: funcoes de public visiveis a este papel', 'sim',
         CASE WHEN COALESCE((SELECT count(*) > 0 FROM pg_proc WHERE pronamespace = 'public'::regnamespace), false) THEN 'sim' ELSE 'nao' END
  UNION ALL
  SELECT 'create_marketplace_order_v23: corpo exato (md5)', '54b591dc09d67f1abbc9ab3ba5f62f5e',
         COALESCE((SELECT m FROM fn WHERE nome = 'create_marketplace_order_v23'), 'AUSENTE')
  UNION ALL
  SELECT 'create_marketplace_order_v23: o corpo traz o desconto de porcentagem arredondado ao centavo (uma vez)', 'sim',
         CASE WHEN NOT EXISTS (SELECT 1 FROM fn WHERE nome = 'create_marketplace_order_v23') THEN 'AUSENTE'
              WHEN (SELECT n_round FROM fn WHERE nome = 'create_marketplace_order_v23') = 1 THEN 'sim'
              WHEN (SELECT n_round FROM fn WHERE nome = 'create_marketplace_order_v23') = 0 THEN 'nao'
              ELSE 'DIFERENTE' END
  UNION ALL
  SELECT 'create_marketplace_order_v23: uma assinatura so e atributos de sempre (SECURITY DEFINER, search_path=public, plpgsql, VOLATILE, retorno uuid)', 'sim',
         CASE WHEN NOT EXISTS (SELECT 1 FROM fn WHERE nome = 'create_marketplace_order_v23') THEN 'AUSENTE'
              WHEN (SELECT atributos_ok FROM fn WHERE nome = 'create_marketplace_order_v23') THEN 'sim' ELSE 'nao' END
  UNION ALL
  SELECT 'create_marketplace_order_v23: EXECUTE para anon, authenticated e service_role, sem PUBLIC', 'sim',
         CASE WHEN NOT EXISTS (SELECT 1 FROM fn WHERE nome = 'create_marketplace_order_v23') THEN 'AUSENTE'
              WHEN (SELECT NOT public_exec AND anon_exec AND auth_exec AND svc_exec FROM fn WHERE nome = 'create_marketplace_order_v23') THEN 'sim' ELSE 'nao' END
  UNION ALL
  SELECT 'create_marketplace_order_v24: corpo exato (md5)', '541a210e52ea22fe67e35f2bdd9ef444',
         COALESCE((SELECT m FROM fn WHERE nome = 'create_marketplace_order_v24'), 'AUSENTE')
  UNION ALL
  SELECT 'create_marketplace_order_v24: o corpo traz o desconto de porcentagem arredondado ao centavo (uma vez)', 'sim',
         CASE WHEN NOT EXISTS (SELECT 1 FROM fn WHERE nome = 'create_marketplace_order_v24') THEN 'AUSENTE'
              WHEN (SELECT n_round FROM fn WHERE nome = 'create_marketplace_order_v24') = 1 THEN 'sim'
              WHEN (SELECT n_round FROM fn WHERE nome = 'create_marketplace_order_v24') = 0 THEN 'nao'
              ELSE 'DIFERENTE' END
  UNION ALL
  SELECT 'create_marketplace_order_v24: uma assinatura so e atributos de sempre (SECURITY DEFINER, search_path=public, plpgsql, VOLATILE, retorno uuid)', 'sim',
         CASE WHEN NOT EXISTS (SELECT 1 FROM fn WHERE nome = 'create_marketplace_order_v24') THEN 'AUSENTE'
              WHEN (SELECT atributos_ok FROM fn WHERE nome = 'create_marketplace_order_v24') THEN 'sim' ELSE 'nao' END
  UNION ALL
  SELECT 'create_marketplace_order_v24: EXECUTE para anon, authenticated e service_role, sem PUBLIC', 'sim',
         CASE WHEN NOT EXISTS (SELECT 1 FROM fn WHERE nome = 'create_marketplace_order_v24') THEN 'AUSENTE'
              WHEN (SELECT NOT public_exec AND anon_exec AND auth_exec AND svc_exec FROM fn WHERE nome = 'create_marketplace_order_v24') THEN 'sim' ELSE 'nao' END
  UNION ALL
  SELECT 'validate_coupon_secure_v2: corpo exato (md5)', '61b90bb7f7c9729abeb94b5596914eb4',
         COALESCE((SELECT m FROM fn WHERE nome = 'validate_coupon_secure_v2'), 'AUSENTE')
  UNION ALL
  SELECT 'validate_coupon_secure_v2: o corpo traz o desconto de porcentagem arredondado ao centavo (uma vez)', 'sim',
         CASE WHEN NOT EXISTS (SELECT 1 FROM fn WHERE nome = 'validate_coupon_secure_v2') THEN 'AUSENTE'
              WHEN (SELECT n_round FROM fn WHERE nome = 'validate_coupon_secure_v2') = 1 THEN 'sim'
              WHEN (SELECT n_round FROM fn WHERE nome = 'validate_coupon_secure_v2') = 0 THEN 'nao'
              ELSE 'DIFERENTE' END
  UNION ALL
  SELECT 'validate_coupon_secure_v2: uma assinatura so e atributos de sempre (SECURITY DEFINER, search_path=public, plpgsql, VOLATILE, retorno jsonb)', 'sim',
         CASE WHEN NOT EXISTS (SELECT 1 FROM fn WHERE nome = 'validate_coupon_secure_v2') THEN 'AUSENTE'
              WHEN (SELECT atributos_ok FROM fn WHERE nome = 'validate_coupon_secure_v2') THEN 'sim' ELSE 'nao' END
  UNION ALL
  SELECT 'validate_coupon_secure_v2: EXECUTE para authenticated, sem PUBLIC', 'sim',
         CASE WHEN NOT EXISTS (SELECT 1 FROM fn WHERE nome = 'validate_coupon_secure_v2') THEN 'AUSENTE'
              WHEN (SELECT NOT public_exec AND auth_exec FROM fn WHERE nome = 'validate_coupon_secure_v2') THEN 'sim' ELSE 'nao' END
)
SELECT item, esperado, vivo, vivo = esperado AS ok FROM itens ORDER BY ok, item;
