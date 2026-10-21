-- Migration 20261260000000 — o motivo da recusa fica na tentativa de cartao.
-- Aditiva: so tabela privada; nenhuma RPC, politica de cliente ou dado reescrito.
-- Aplicar antes das edges. Falha do diagnostico nao altera a decisao financeira.
-- Sem BEGIN/COMMIT: a transacao pertence ao aplicador.
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

DO $preflight$
BEGIN
  IF to_regclass('public.tentativas_cartao_diagnostico') IS NOT NULL THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: tentativas_cartao_diagnostico ja existe; conferir antes de aplicar.';
  END IF;
  IF to_regclass('public.marketplace_orders') IS NULL THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: marketplace_orders ausente.';
  END IF;
END $preflight$;

CREATE TABLE public.tentativas_cartao_diagnostico (
  pedido_id uuid NOT NULL REFERENCES public.marketplace_orders(id),
  mp_order_id text NOT NULL CHECK (mp_order_id ~ '^[A-Za-z0-9_-]{1,100}$'),
  mp_payment_id text NOT NULL CHECK (mp_payment_id ~ '^[A-Za-z0-9_-]{1,100}$'),
  status text NOT NULL CHECK (status IN ('failed', 'rejected', 'processing', 'in_process', 'pending', 'action_required')),
  status_detail text CHECK (status_detail ~ '^[a-z][a-z0-9_]{0,119}$'),
  parcelas smallint CHECK (parcelas BETWEEN 1 AND 12),
  valor numeric(10,2) NOT NULL CHECK (valor > 0),
  registrado_em timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT tentativas_cartao_diagnostico_order_payment_key UNIQUE (mp_order_id, mp_payment_id)
);
COMMENT ON TABLE public.tentativas_cartao_diagnostico IS 'cartao_diagnostico_20261260000000';
CREATE INDEX tentativas_cartao_diagnostico_pedido_idx
  ON public.tentativas_cartao_diagnostico (pedido_id, registrado_em DESC);

ALTER TABLE public.tentativas_cartao_diagnostico ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.tentativas_cartao_diagnostico FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.tentativas_cartao_diagnostico FROM service_role;
GRANT SELECT, INSERT, UPDATE ON TABLE public.tentativas_cartao_diagnostico TO service_role;

DO $postflight$
DECLARE
  v_tabela oid := 'public.tentativas_cartao_diagnostico'::regclass;
BEGIN
  IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = v_tabela)
     OR EXISTS (SELECT 1 FROM pg_policy WHERE polrelid = v_tabela)
     OR EXISTS (
       SELECT 1 FROM pg_class c
       CROSS JOIN LATERAL aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) a
       WHERE c.oid = v_tabela AND a.grantee = 0
     )
     OR has_table_privilege('anon', v_tabela, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
     OR has_table_privilege('authenticated', v_tabela, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
     OR NOT has_table_privilege('service_role', v_tabela, 'SELECT')
     OR NOT has_table_privilege('service_role', v_tabela, 'INSERT')
     OR NOT has_table_privilege('service_role', v_tabela, 'UPDATE') THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: diagnostico do cartao nao ficou exclusivo do servidor.';
  END IF;
END $postflight$;
