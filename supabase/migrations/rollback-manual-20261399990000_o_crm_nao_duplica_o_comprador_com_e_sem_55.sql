-- Desfaz a 20261399990000: devolve o corpo da 20261178000000 BYTE A BYTE (o CRM volta a tratar o WhatsApp com 55 e o sem 55 como dois compradores).
-- Nenhum dado e tocado: so a LEITURA muda. Desfazer esta ANTES do rollback da 20261178000000 (que so da DROP e derrubaria a funcao).
-- Pre-voo fechado: so aceita o corpo desta migration ou o da 20261178000000 (reaplicar o rollback e inofensivo); qualquer outro corpo, atributo ou ACL recusa SEM escrever.
-- Sem BEGIN/COMMIT: a transacao pertence ao aplicador.

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

DO $preflight_rb_20261399990000$
DECLARE
  v_fn CONSTANT text := 'public.crm__vendas(timestamptz)';
  v_oid oid := to_regprocedure('public.crm__vendas(timestamptz)');
  v_hash text;
  v_atributos jsonb;
BEGIN
  IF v_oid IS NULL THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: % não existe.', v_fn;
  END IF;
  IF (SELECT count(*) FROM pg_proc p
       WHERE p.pronamespace = 'public'::regnamespace AND p.proname = 'crm__vendas') <> 1 THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: crm__vendas tem sobrecarga em public.';
  END IF;

  SELECT md5(replace(prosrc, E'\r', '')) INTO v_hash FROM pg_proc WHERE oid = v_oid;
  IF v_hash IS NULL OR v_hash NOT IN ('8a802f6324c86cdc0be214b4d5ac69bb', 'bd683b55c36dff83eefa0282077d9a63') THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: corpo vivo de % (hash %) não é o desta migration nem o da 20261178000000; recusa corpo desconhecido.', v_fn, COALESCE(v_hash, 'ausente');
  END IF;

  IF NOT EXISTS (
       SELECT 1 FROM pg_proc p JOIN pg_language l ON l.oid = p.prolang
        WHERE p.oid = v_oid
          AND p.prokind = 'f'
          AND l.lanname = 'sql'
          AND NOT p.prosecdef
          AND p.provolatile = 's'
          AND NOT p.proisstrict
          AND p.proretset
          AND p.proconfig = ARRAY['search_path=public']::text[]
          AND p.pronargs = 1
          AND pg_get_function_arguments(p.oid) = 'p_ate timestamp with time zone'
          AND pg_get_function_result(p.oid) = 'TABLE(order_id uuid, total numeric, canal text, forma text, pago_em timestamp with time zone, dia date, chave text, user_id uuid, nome text, whatsapp text, email text)'
     ) THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: atributos de % não são os conhecidos.', v_fn;
  END IF;

  IF has_function_privilege('anon', v_oid, 'EXECUTE')
     OR has_function_privilege('authenticated', v_oid, 'EXECUTE')
     OR EXISTS (SELECT 1 FROM pg_proc p
                  CROSS JOIN LATERAL aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) g
                 WHERE p.oid = v_oid AND g.privilege_type = 'EXECUTE' AND g.grantee = 0) THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: ACL de % não é a conhecida (PUBLIC, anon e authenticated sem EXECUTE).', v_fn;
  END IF;

  -- Fotografia de OID, dono, ACL e TODOS os atributos: o CREATE OR REPLACE so pode trocar prosrc.
  SELECT to_jsonb(p) - 'prosrc' INTO v_atributos FROM pg_proc p WHERE p.oid = v_oid;
  PERFORM set_config('ikcous.crm3999_rb_atributos', v_atributos::text, true);
END $preflight_rb_20261399990000$;

-- crm__vendas: o corpo da 20261178000000, copiado do arquivo original (o hash do pos-voo prova que e byte a byte).
CREATE OR REPLACE FUNCTION public.crm__vendas(p_ate timestamptz)
RETURNS TABLE (
  order_id uuid, total numeric, canal text, forma text, pago_em timestamptz, dia date,
  chave text, user_id uuid, nome text, whatsapp text, email text
)
LANGUAGE sql STABLE SET search_path = public
AS $$
  WITH base AS (
    SELECT o.id, o.total::numeric AS total, o.canal, o.user_id, o.customer_name,
           public.fin__forma_do_pedido(o.payment_method, o.metodo_online) AS forma,
           COALESCE(o.pagamento_recebido_em, o.paid_at) AS pago_em,
           NULLIF(regexp_replace(COALESCE(o.customer_data ->> 'whatsapp', ''), '\D', '', 'g'), '') AS wa,
           NULLIF(btrim(COALESCE(o.customer_data ->> 'email', '')), '') AS email
      FROM public.marketplace_orders o
     WHERE o.payment_status IN ('pago', 'pago_apos_expirar', 'recebido_na_entrega')
       AND o.status NOT IN ('cancelled', 'returned')
       AND COALESCE(o.pagamento_recebido_em, o.paid_at) IS NOT NULL
       AND COALESCE(o.pagamento_recebido_em, o.paid_at) <= p_ate
  ), wa_da_conta AS (
    SELECT DISTINCT ON (b.wa) b.wa, b.user_id
      FROM base b
     WHERE b.wa IS NOT NULL AND b.user_id IS NOT NULL
     ORDER BY b.wa, b.pago_em DESC
  )
  SELECT b.id, b.total, b.canal, b.forma, b.pago_em, public.fin__dia(b.pago_em),
         COALESCE(b.user_id::text, w.user_id::text, CASE WHEN b.wa IS NOT NULL THEN 'wa:' || b.wa END),
         COALESCE(b.user_id, w.user_id),
         NULLIF(btrim(b.customer_name), ''), b.wa, b.email
    FROM base b
    LEFT JOIN wa_da_conta w ON w.wa = b.wa AND b.user_id IS NULL
$$;

-- Pos-voo: o corpo e o da 20261178000000, e OID, dono, ACL e atributos sao os da fotografia do pre-voo.
DO $conferencia_rb_20261399990000$
DECLARE
  v_fn CONSTANT text := 'public.crm__vendas(timestamptz)';
  v_oid oid := to_regprocedure('public.crm__vendas(timestamptz)');
  v_hash text;
BEGIN
  IF v_oid IS NULL THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: % sumiu depois do CREATE OR REPLACE.', v_fn;
  END IF;
  SELECT md5(replace(prosrc, E'\r', '')) INTO v_hash FROM pg_proc WHERE oid = v_oid;
  IF v_hash IS DISTINCT FROM '8a802f6324c86cdc0be214b4d5ac69bb' THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: corpo depois do rollback de % tem hash %; esperado 8a802f6324c86cdc0be214b4d5ac69bb (o da 20261178000000).', v_fn, COALESCE(v_hash, 'ausente');
  END IF;
  IF (SELECT count(*) FROM pg_proc p
       WHERE p.pronamespace = 'public'::regnamespace AND p.proname = 'crm__vendas') <> 1 THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: crm__vendas ficou com sobrecarga.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_proc p
                  WHERE p.oid = v_oid
                    AND (to_jsonb(p) - 'prosrc') = current_setting('ikcous.crm3999_rb_atributos')::jsonb) THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: conferencia final do rollback de % falhou (OID, dono, ACL ou atributo mudou).', v_fn;
  END IF;
END $conferencia_rb_20261399990000$;

NOTIFY pgrst, 'reload schema';
