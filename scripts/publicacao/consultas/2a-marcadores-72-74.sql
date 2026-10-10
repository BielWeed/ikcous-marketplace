WITH m(migration, funcao, marcador, vezes) AS (VALUES
  ('20261172000000', 'create_marketplace_order_v23', $marcador$v_address_data_sem_cpf jsonb := CASE
        WHEN p_address_data IS NULL THEN NULL
        WHEN jsonb_typeof(p_address_data) <> 'object' THEN p_address_data
        WHEN (p_address_data - 'cpf') = '{}'::jsonb THEN NULL
        ELSE (p_address_data - 'cpf')
    END;$marcador$, 1),
  ('20261172000000', 'create_marketplace_order_v23', $marcador$'address', v_address_data_sem_cpf,$marcador$, 1),
  ('20261172000000', 'create_marketplace_order_v24', $marcador$v_customer_cpf_digits text := NULLIF(regexp_replace(COALESCE(p_address_data->>'cpf', ''), '\D', '', 'g'), '');$marcador$, 1),
  ('20261172000000', 'create_marketplace_order_v24', $marcador$IF v_opcao NOT IN ('local-delivery', 'store-pickup') AND v_customer_cpf_digits IS NOT NULL THEN
        IF length(v_customer_cpf_digits) <> 11$marcador$, 1),
  ('20261172000000', 'create_marketplace_order_v24', $marcador$SELECT array_agg(substr(v_customer_cpf_digits, gs, 1)::int ORDER BY gs)
          INTO v_cpf_digitos
          FROM generate_series(1, 11) AS gs;$marcador$, 1),
  ('20261172000000', 'create_marketplace_order_v24', $marcador$CASE WHEN v_opcao NOT IN ('local-delivery', 'store-pickup') AND v_customer_cpf_digits IS NOT NULL
                THEN jsonb_build_object('cpf', v_customer_cpf_digits)$marcador$, 1),
  ('20261172000000', 'create_marketplace_order_v24', $marcador$'address', v_address_data_sem_cpf,$marcador$, 1),
  ('20261174000000', 'create_marketplace_order_v23', $marcador$IF NOT public.forma_de_pagamento_aceita(p_payment_method) THEN
        RAISE EXCEPTION 'Esta forma de pagamento não está disponível nesta loja. Escolha outra.';$marcador$, 1),
  ('20261174000000', 'create_marketplace_order_v24', $marcador$IF NOT public.forma_de_pagamento_aceita(p_payment_method) THEN
        RAISE EXCEPTION 'Esta forma de pagamento não está disponível nesta loja. Escolha outra.';$marcador$, 1),
  ('20261174000000', 'upsert_store_config', $marcador$v_has_formas_pagamento := config_json ? 'formas_pagamento_entrega'
    AND config_json->'formas_pagamento_entrega' IS NOT NULL
    AND jsonb_typeof(config_json->'formas_pagamento_entrega') = 'array';$marcador$, 1),
  ('20261174000000', 'upsert_store_config', $marcador$IF v_has_formas_pagamento THEN
    SELECT COALESCE(array_agg(x), '{}'::text[]) INTO v_formas_pagamento
    FROM jsonb_array_elements_text(config_json->'formas_pagamento_entrega') x;
  ELSE
    SELECT formas_pagamento_entrega INTO v_formas_pagamento
      FROM public.store_config WHERE id = 1;
    v_formas_pagamento := COALESCE(v_formas_pagamento, ARRAY['pix','card','cash']::text[]);
  END IF;$marcador$, 1),
  ('20261174000000', 'upsert_store_config', $marcador$formas_pagamento_entrega = CASE WHEN v_has_formas_pagamento
      THEN v_formas_pagamento
      ELSE store_config.formas_pagamento_entrega END,$marcador$, 1)
), d AS (
  SELECT m.*, (SELECT replace(string_agg(pg_get_functiondef(p.oid), E'\n'), E'\r', '') FROM pg_proc p
                WHERE p.pronamespace = 'public'::regnamespace AND p.proname = m.funcao) AS def
    FROM m
)
SELECT migration, funcao, vezes AS esperado,
       (length(def) - length(replace(def, marcador, ''))) / length(marcador) AS achado,
       COALESCE((length(def) - length(replace(def, marcador, ''))) / length(marcador) = vezes, false) AS ok
  FROM d ORDER BY ok, migration, funcao;
