-- Rollback manual da 20261349000000: devolve o corpo de pagamentos_a_reconciliar da 20261270000000 byte a byte
-- (md5 aed09ec910825168a3217b2e308824c5). Aplicar SOMENTE pelo aplicar-migrations.yml (o envelope abre a transacao e retira a versao do
-- ledger). Sem transacao propria, sem mudar dados, assinatura ou ACL. Depois dele o pedido entregue antes da confirmacao
-- do PIX deixa de entrar na fila de reconciliacao (o defeito antigo volta).
-- Recusa corpo ausente, ja desfeito ou alterado por migration posterior (B1_BASELINE_DIVERGENT), como a 20261270.

DO $preflight_rollback_20261349$
DECLARE
  v_oid oid := to_regprocedure('public.pagamentos_a_reconciliar()');
  v_hash text;
BEGIN
  IF v_oid IS NULL THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: public.pagamentos_a_reconciliar() ausente; nada a reverter.';
  END IF;
  SELECT md5(replace(prosrc, E'\r', '')) INTO v_hash FROM pg_proc WHERE oid = v_oid;
  IF v_hash IS DISTINCT FROM '350e732dbae6ba45bede77c08e0db6d8' THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: pagamentos_a_reconciliar (hash %) nao e o da 20261349000000; revise antes de reverter.', COALESCE(v_hash, 'ausente');
  END IF;
END $preflight_rollback_20261349$;

CREATE OR REPLACE FUNCTION public.pagamentos_a_reconciliar()
RETURNS TABLE (order_id uuid, gateway_payment_id text)
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public'
AS $candidatos$
    SELECT o.id, o.gateway_payment_id
      FROM public.marketplace_orders o
      LEFT JOIN public.reconciliacao_visitas v ON v.order_id = o.id
     WHERE o.gateway_payment_id IS NOT NULL
       AND o.paid_at IS NULL
       -- 24 h para todo mundo (passado isso o PIX não é mais pagável); 14
       -- dias para o cartão possivelmente vivo — análise manual do MP pode
       -- aprovar dias depois (D2, revisor financeiro: N = 14).
       AND (
             o.expires_at > now() - interval '24 hours'
          OR (
               o.expires_at > now() - interval '14 days'
               AND COALESCE(
                     o.gateway_payment_id LIKE 'verificando:%'
                     OR o.metodo_online IN ('credito', 'debito'),
                     false
                   )
             )
       )
       -- Cobrança que o MP já deu como terminal sai da fila; cobrança NOVA na
       -- vaga (outro id) volta na hora.
       AND (v.cobranca_terminal IS NULL OR v.cobranca_terminal <> o.gateway_payment_id)
       AND (
             -- morto por expiracao (20260808000100)
             o.payment_status = 'expirado'
             -- morto por cancelamento com a cobranca viva (20260812000000)
          OR (o.payment_status = 'aguardando' AND o.status = 'cancelled')
             -- VIVO, e ainda da' para salvar (20261010000000)
          OR (o.payment_status = 'aguardando' AND o.status IN ('pending', 'processing', 'shipping'))
       )
     -- Vivo primeiro; depois rodízio (nunca visitado / visitado há mais
     -- tempo); por fim o mais novo (D3: o LIMIT não monopoliza mais a fila).
     ORDER BY (o.status IN ('pending', 'processing', 'shipping')) DESC, v.visitado_em ASC NULLS FIRST, o.expires_at DESC
     LIMIT 100;
$candidatos$;

DO $posvoo_rollback_20261349$
DECLARE
  v_oid oid := to_regprocedure('public.pagamentos_a_reconciliar()');
  v_hash text;
  v_public boolean;
BEGIN
  SELECT md5(replace(prosrc, E'\r', '')) INTO v_hash FROM pg_proc WHERE oid = v_oid;
  IF v_hash IS DISTINCT FROM 'aed09ec910825168a3217b2e308824c5' THEN
    RAISE EXCEPTION 'POSVOO_ROLLBACK_20261349000000: pagamentos_a_reconciliar nao voltou ao corpo da 20261270000000 (hash %)', COALESCE(v_hash, 'ausente');
  END IF;

  -- Atributos e ACL de sempre: a ACL fica como esta (CREATE OR REPLACE a preserva; nenhum GRANT/REVOKE aqui).
  IF NOT EXISTS (
       SELECT 1 FROM pg_proc p JOIN pg_language l ON l.oid = p.prolang
        WHERE p.oid = v_oid
          AND l.lanname = 'sql'
          AND p.prosecdef
          AND p.provolatile = 'v'
          AND p.proretset
          AND NOT p.proisstrict
          AND p.pronargs = 0
          AND p.proconfig = ARRAY['search_path=public']::text[]
          AND pg_get_function_result(p.oid) = 'TABLE(order_id uuid, gateway_payment_id text)'
     ) THEN
    RAISE EXCEPTION 'POSVOO_ROLLBACK_20261349000000: atributos de public.pagamentos_a_reconciliar() (linguagem, SECURITY DEFINER, volatilidade, search_path ou tipo de retorno) nao sao os conhecidos — meca a loja e revise antes de seguir.';
  END IF;
  v_public := EXISTS (SELECT 1 FROM pg_proc p
                        CROSS JOIN LATERAL aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) g
                       WHERE p.oid = v_oid AND g.privilege_type = 'EXECUTE' AND g.grantee = 0);
  IF v_public
     OR has_function_privilege('anon', v_oid, 'EXECUTE')
     OR has_function_privilege('authenticated', v_oid, 'EXECUTE')
     OR NOT has_function_privilege('service_role', v_oid, 'EXECUTE') THEN
    RAISE EXCEPTION 'POSVOO_ROLLBACK_20261349000000: a ACL de public.pagamentos_a_reconciliar() nao e a de sempre (so o servidor executa) — meca a loja e revise antes de seguir.';
  END IF;
END $posvoo_rollback_20261349$;

NOTIFY pgrst, 'reload schema';
