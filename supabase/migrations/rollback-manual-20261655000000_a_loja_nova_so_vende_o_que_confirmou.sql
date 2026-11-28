-- Rollback manual da 20261655000000 (a loja nova so vende o que a lojista confirmou).
-- Devolve, byte a byte, o corpo de forma_de_pagamento_aceita da 20261174000000 (md5 4f90cbc8b1c98be2fd1c6d862468376c),
-- tira o gatilho tr_a_loja_so_entrega_o_confirmado e a funcao dele, e devolve a vitrine (v_store_config) as 48 colunas
-- da 20261310000000, com o dono e o ACL que ela tinha (fotografados antes do DROP e conferidos no fim).
-- O QUE SE PERDE: nada de dado (os dois booleanos da vitrine sao calculados das datas, que ficam). Volta o comportamento
-- de antes: a loja nova que ainda nao confirmou volta a aceitar pagar na entrega e a entrega na cidade de fabrica.
-- O front novo le os booleanos ausentes como liberado, entao a tela nao trava nada sem esta migration.
-- Pre-voo: recusa se o corpo vivo nao for o que a 20261655000000 deixou ou a vitrine nao tiver as 50 colunas desta
-- (nada a desfazer, ou uma sucessora no ar -- desfaca a sucessora antes). Idempotente no sentido da casa: rodar de novo
-- recusa no pre-voo sem escrever nada.
-- DROP VIEW + CREATE VIEW (nunca OR REPLACE): o Postgres RECUSA OR REPLACE que encolha a lista. O DROP leva o ACL junto;
-- por isso ele volta da FOTOGRAFIA (aclexplode), nao de um GRANT fixo, e o pos-voo compara com ela.
-- Executar pelo aplicar-migrations.yml: o ledger e removido na mesma transacao.
-- Sem BEGIN/COMMIT: a transacao pertence ao aplicador.
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

DO $preflight_rollback_20261655000000$
DECLARE
  v_hash text;
BEGIN
  SELECT md5(replace(prosrc, E'\r', '')) INTO v_hash
    FROM pg_proc WHERE oid = to_regprocedure('public.forma_de_pagamento_aceita(text)');
  IF v_hash IS DISTINCT FROM 'a38a13934096d55b10fcfdb1416a9c08' THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: corpo vivo de forma_de_pagamento_aceita (%) nao e o que a 20261655000000 deixou -- nada a desfazer, ou uma redefinicao posterior esta no ar; revise antes de reverter.',
      COALESCE(v_hash, 'ausente');
  END IF;
  IF md5(COALESCE((SELECT string_agg(a.attname, ',' ORDER BY a.attnum) FROM pg_attribute a
                    WHERE a.attrelid = to_regclass('public.v_store_config') AND a.attnum > 0 AND NOT a.attisdropped), ''))
       IS DISTINCT FROM '39fbabdd4cd002cb626ecaa7c5112cdb' THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: v_store_config nao tem as 50 colunas que a 20261655000000 deixou -- revise antes de reverter.';
  END IF;
  PERFORM set_config('ikcous.so_vende1655_rb_aceita',
    (SELECT to_jsonb(p) - 'prosrc' FROM pg_proc p WHERE p.oid = to_regprocedure('public.forma_de_pagamento_aceita(text)'))::text, true);
  PERFORM set_config('ikcous.so_vende1655_rb_vista',
    (SELECT jsonb_build_object('dono', c.relowner::regrole::text, 'acl', COALESCE(c.relacl, acldefault('r', c.relowner))::text[])
       FROM pg_class c WHERE c.oid = 'public.v_store_config'::regclass)::text, true);
END $preflight_rollback_20261655000000$;

CREATE OR REPLACE FUNCTION public.forma_de_pagamento_aceita(p_metodo text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_config RECORD;
BEGIN
  SELECT pagamento_online, formas_pagamento_entrega INTO v_config
    FROM public.store_config WHERE id = 1;
  IF NOT FOUND THEN
    RETURN false;
  END IF;
  RETURN CASE p_metodo
    WHEN 'online' THEN v_config.pagamento_online
    WHEN 'pix' THEN 'pix' = ANY(v_config.formas_pagamento_entrega)
    WHEN 'card' THEN 'card' = ANY(v_config.formas_pagamento_entrega)
    WHEN 'cash' THEN 'cash' = ANY(v_config.formas_pagamento_entrega)
    ELSE false
  END;
END;
$function$;

DROP TRIGGER IF EXISTS tr_a_loja_so_entrega_o_confirmado ON public.marketplace_orders;
DROP FUNCTION IF EXISTS public.a_loja_so_entrega_na_cidade_o_que_confirmou();

DROP VIEW public.v_store_config;
CREATE VIEW public.v_store_config WITH (security_invoker=on) AS
 SELECT id,
    free_shipping_min,
    shipping_fee,
    whatsapp_number,
    share_text,
    business_hours,
    enable_reviews,
    enable_coupons,
    primary_color,
    theme_mode,
    logo_url,
    real_time_sales_alerts,
    push_marketing_enabled,
    min_app_version,
    origin_cep,
    shipping_provider,
    enabled_shipping_methods,
    shipping_coverage,
    local_delivery_fee,
    local_cep_range,
    created_at,
    updated_at,
    store_name,
    store_city,
    store_state,
    home_sections,
    secondary_color,
    accent_color,
    branding_assets,
    dominio_publico,
    mp_public_key,
    vapid_public_key,
    pagamento_online,
    manutencao,
    store_address,
    store_description,
    national_shipping_strategy,
    national_shipping_min,
    national_discount_type,
    national_discount_value,
    national_benefit_scope,
    formas_pagamento_entrega,
    store_legal_name,
    store_legal_document,
    store_support_email,
    local_delivery_enabled,
    local_delivery_days,
    free_shipping_card_style
   FROM store_config
  WHERE id = 1;

-- O dono e o ACL da fotografia: tira o que o CREATE VIEW deu sozinho (privilegios padrao do esquema) e devolve
-- exatamente o que havia, papel por papel, com GRANT OPTION onde havia.
DO $acl_rollback_20261655000000$
DECLARE
  v_foto jsonb := current_setting('ikcous.so_vende1655_rb_vista')::jsonb;
  r record;
BEGIN
  IF (SELECT c.relowner::regrole::text FROM pg_class c WHERE c.oid = 'public.v_store_config'::regclass) <> v_foto->>'dono' THEN
    EXECUTE format('ALTER VIEW public.v_store_config OWNER TO %I', v_foto->>'dono');
  END IF;
  FOR r IN
    SELECT DISTINCT g.grantee
      FROM pg_class c CROSS JOIN LATERAL aclexplode(COALESCE(c.relacl, acldefault('r', c.relowner))) g
     WHERE c.oid = 'public.v_store_config'::regclass AND g.grantee <> c.relowner
  LOOP
    EXECUTE format('REVOKE ALL ON TABLE public.v_store_config FROM %s',
      CASE WHEN r.grantee = 0 THEN 'PUBLIC' ELSE quote_ident(r.grantee::regrole::text) END);
  END LOOP;
  FOR r IN
    SELECT g.grantee, g.privilege_type, g.is_grantable
      FROM aclexplode(ARRAY(SELECT jsonb_array_elements_text(v_foto->'acl'))::aclitem[]) g
     WHERE g.grantee <> (v_foto->>'dono')::regrole
  LOOP
    EXECUTE format('GRANT %s ON TABLE public.v_store_config TO %s%s', r.privilege_type,
      CASE WHEN r.grantee = 0 THEN 'PUBLIC' ELSE quote_ident(r.grantee::regrole::text) END,
      CASE WHEN r.is_grantable THEN ' WITH GRANT OPTION' ELSE '' END);
  END LOOP;
END $acl_rollback_20261655000000$;

DO $posvoo_rollback_20261655000000$
DECLARE
  v_foto jsonb := current_setting('ikcous.so_vende1655_rb_vista')::jsonb;
BEGIN
  IF (SELECT md5(replace(prosrc, E'\r', '')) FROM pg_proc WHERE oid = to_regprocedure('public.forma_de_pagamento_aceita(text)'))
       IS DISTINCT FROM '4f90cbc8b1c98be2fd1c6d862468376c'
     OR (SELECT to_jsonb(p) - 'prosrc' FROM pg_proc p WHERE p.oid = to_regprocedure('public.forma_de_pagamento_aceita(text)'))
       IS DISTINCT FROM current_setting('ikcous.so_vende1655_rb_aceita')::jsonb THEN
    RAISE EXCEPTION 'POSVOO_ROLLBACK_20261655000000: forma_de_pagamento_aceita nao voltou ao corpo da 20261174000000 com o mesmo catalogo.';
  END IF;
  IF to_regprocedure('public.a_loja_so_entrega_na_cidade_o_que_confirmou()') IS NOT NULL
     OR EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'tr_a_loja_so_entrega_o_confirmado') THEN
    RAISE EXCEPTION 'POSVOO_ROLLBACK_20261655000000: o gatilho ou a funcao dele ficaram.';
  END IF;
  IF md5((SELECT string_agg(a.attname, ',' ORDER BY a.attnum) FROM pg_attribute a
           WHERE a.attrelid = 'public.v_store_config'::regclass AND a.attnum > 0 AND NOT a.attisdropped))
       IS DISTINCT FROM 'b7ee2c31d91549a168a502de0ac4c5d2'
     OR NOT EXISTS (SELECT 1 FROM pg_class c WHERE c.oid = 'public.v_store_config'::regclass AND 'security_invoker=on' = ANY(c.reloptions))
     OR (SELECT c.relowner::regrole::text FROM pg_class c WHERE c.oid = 'public.v_store_config'::regclass) IS DISTINCT FROM v_foto->>'dono'
     OR (SELECT array_agg(x ORDER BY x) FROM unnest((SELECT COALESCE(c.relacl, acldefault('r', c.relowner))::text[]
                                                     FROM pg_class c WHERE c.oid = 'public.v_store_config'::regclass)) x)
        IS DISTINCT FROM (SELECT array_agg(x ORDER BY x) FROM jsonb_array_elements_text(v_foto->'acl') x) THEN
    RAISE EXCEPTION 'POSVOO_ROLLBACK_20261655000000: a vitrine nao voltou as 48 colunas com security_invoker, dono e ACL de antes.';
  END IF;
END $posvoo_rollback_20261655000000$;

NOTIFY pgrst, 'reload schema';
