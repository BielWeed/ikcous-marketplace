-- ============================================================================
-- Rollback manual — a "Observação da inspeção" da devolução é só da loja (20261404000000)
-- ============================================================================
-- Recria public.devolucao_detalhe(uuid) com o corpo VIGENTE de antes, byte a byte (o md5 de replace(prosrc, E'\r', '') volta a ser a439e320641d553e3a21883c6606c6f2, o da
-- 20261399992000), e devolve a authenticated o GRANT SELECT na TABELA INTEIRA public.devolucoes (o estado de antes: relacl com authenticated=r, nenhum grant de coluna).
-- Assinatura, SECURITY DEFINER, volatilidade, search_path, retorno jsonb e ACL da função são os mesmos; OID e dono não mudam (CREATE OR REPLACE).
--
-- COM ELE VOLTAM AS DUAS PORTAS descritas no cabeçalho da migration 20261404000000: devolucao_detalhe devolve a linha inteira (com observacao_inspecao) à cliente dona
-- e a cliente dona volta a ler a coluna direto pelo PostgREST. DADOS: nenhuma linha foi reescrita pela migration nem é tocada aqui; as observações gravadas seguem gravadas.
--
-- PRÉ-VOO: recusa (B1_BASELINE_DIVERGENT) se devolucao_detalhe não existir ou tiver sobrecarga; se o corpo vivo não for o DESTA migration (rodar de novo, já desfeito,
-- recusa); se os atributos ou a ACL da função não forem os de sempre; ou se public.devolucoes não existir. O pós-voo recusa se o corpo não voltou ao vigente, se OID, dono,
-- ACL ou atributos da função mudaram, se authenticated não voltou a ler a tabela inteira (nem a observação), ou se sobrou grant de coluna de authenticated.
--
-- ORDEM: este vem ANTES do rollback da 20261399992000 (o dela só aceita o corpo da 20261399992000 em devolucao_detalhe). Executar pelo aplicar-migrations.yml (apaga o registro
-- do ledger na mesma transação). Sem BEGIN/COMMIT de nível superior neste arquivo — regra da casa.
-- ============================================================================

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

DO $preflight_rollback_20261404000000$
DECLARE
  v_oid oid := to_regprocedure('public.devolucao_detalhe(uuid)');
  v_hash text;
  v_public boolean;
BEGIN
  IF v_oid IS NULL THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: public.devolucao_detalhe(uuid) ausente; nada a reverter.';
  END IF;
  IF (SELECT count(*) FROM pg_proc p
       WHERE p.pronamespace = 'public'::regnamespace AND p.proname = 'devolucao_detalhe') <> 1 THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: devolucao_detalhe tem sobrecarga em public — meça a loja e revise antes de reverter.';
  END IF;
  SELECT md5(replace(prosrc, E'\r', '')) INTO v_hash FROM pg_proc WHERE oid = v_oid;
  IF v_hash IS DISTINCT FROM 'b4eb7a928f8a6ff04c34e93f4f56188c' THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: corpo vivo de public.devolucao_detalhe(uuid) (hash %) não é o da 20261404000000 — já foi desfeito, ou foi redefinido depois; capture o corpo vivo e revise.', COALESCE(v_hash, 'ausente');
  END IF;
  IF NOT EXISTS (
       SELECT 1 FROM pg_proc p JOIN pg_language l ON l.oid = p.prolang
        WHERE p.oid = v_oid
          AND l.lanname = 'plpgsql'
          AND p.prokind = 'f'
          AND p.prosecdef
          AND p.provolatile = 's'
          AND NOT p.proisstrict
          AND p.pronargs = 1
          AND p.proconfig = ARRAY['search_path=public']::text[]
          AND pg_get_function_result(p.oid) = 'jsonb'
     ) THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: atributos de public.devolucao_detalhe (linguagem, SECURITY DEFINER, volatilidade, search_path, argumento ou retorno) não são os conhecidos — meça a loja e revise.';
  END IF;
  v_public := EXISTS (SELECT 1 FROM pg_proc p
                        CROSS JOIN LATERAL aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) g
                       WHERE p.oid = v_oid AND g.privilege_type = 'EXECUTE' AND g.grantee = 0);
  IF v_public
     OR has_function_privilege('anon', v_oid, 'EXECUTE')
     OR NOT has_function_privilege('authenticated', v_oid, 'EXECUTE') THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: ACL de public.devolucao_detalhe não é a conhecida (authenticated sim; anon e PUBLIC não) — meça a loja e revise.';
  END IF;
  IF to_regclass('public.devolucoes') IS NULL THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: public.devolucoes ausente; nada a reverter.';
  END IF;
  PERFORM set_config('ikcous.obsinsp_rollback_atributos',
                     (SELECT to_jsonb(p) - 'prosrc' FROM pg_proc p WHERE p.oid = v_oid)::text, true);
END $preflight_rollback_20261404000000$;

-- devolucao_detalhe: o corpo vigente da 20261399992000, byte a byte.
CREATE OR REPLACE FUNCTION public.devolucao_detalhe(p_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $$
DECLARE
  v_d public.devolucoes%ROWTYPE;
  v_o public.marketplace_orders%ROWTYPE;
BEGIN
  SELECT * INTO v_d FROM public.devolucoes WHERE id = p_id;
  IF NOT FOUND OR (v_d.user_id IS DISTINCT FROM auth.uid() AND NOT public.is_admin()) THEN
    RAISE EXCEPTION 'Devolução não encontrada.' USING ERRCODE = 'P0002';
  END IF;
  -- Papel ATUAL (auth.users E profiles), não o do JWT: admin rebaixado para aqui (20261199000000).
  IF NOT FOUND OR (v_d.user_id IS DISTINCT FROM auth.uid() AND NOT public.is_admin_atual()) THEN
    RAISE EXCEPTION 'Devolução não encontrada.' USING ERRCODE = 'P0002';
  END IF;
  SELECT * INTO v_o FROM public.marketplace_orders WHERE id = v_d.order_id;
  RETURN to_jsonb(v_d) || jsonb_build_object(
    -- 20261399992000: 'ja_pedido_e_nao_veio' = uma devolução ANTERIOR e CONCLUÍDA deste mesmo item do pedido o marcou "Não veio".
    'itens', COALESCE((SELECT jsonb_agg(to_jsonb(i) || jsonb_build_object('ja_pedido_e_nao_veio', EXISTS (
                           SELECT 1 FROM public.devolucao_itens a
                             JOIN public.devolucoes da ON da.id = a.devolucao_id
                            WHERE a.order_item_id = i.order_item_id
                              AND a.condicao = 'ausente'
                              AND da.status = 'concluida'
                              AND da.created_at < v_d.created_at)) ORDER BY i.product_name, i.id)
                         FROM public.devolucao_itens i WHERE i.devolucao_id = v_d.id), '[]'::jsonb),
    'eventos', COALESCE((SELECT jsonb_agg(to_jsonb(e) ORDER BY e.created_at, e.id)
                           FROM public.devolucao_eventos e WHERE e.devolucao_id = v_d.id), '[]'::jsonb),
    'pedido', jsonb_build_object(
      'id', v_o.id, 'total', v_o.total, 'shipping', v_o.shipping,
      'payment_method', v_o.payment_method, 'payment_status', v_o.payment_status,
      'canal', v_o.canal, 'customer_name', v_o.customer_name,
      'whatsapp', v_o.customer_data ->> 'whatsapp',
      'shipping_label_id', v_o.shipping_label_id,
      'shipping_option_id', v_o.customer_data ->> 'shipping_option_id'
    )
  );
END;
$$;

-- O estado de antes da tabela: SELECT na tabela INTEIRA para authenticated, sem grant de coluna. O REVOKE de tabela leva junto os 34 grants de coluna.
REVOKE SELECT ON public.devolucoes FROM authenticated;
GRANT SELECT ON public.devolucoes TO authenticated;

DO $posvoo_rollback_20261404000000$
DECLARE
  v_oid oid := to_regprocedure('public.devolucao_detalhe(uuid)');
  v_hash text;
BEGIN
  IF v_oid IS NULL THEN
    RAISE EXCEPTION 'POSVOO_ROLLBACK_20261404000000: public.devolucao_detalhe(uuid) sumiu';
  END IF;
  SELECT md5(replace(prosrc, E'\r', '')) INTO v_hash FROM pg_proc WHERE oid = v_oid;
  IF v_hash IS DISTINCT FROM 'a439e320641d553e3a21883c6606c6f2' THEN
    RAISE EXCEPTION 'POSVOO_ROLLBACK_20261404000000: corpo vivo de devolucao_detalhe (hash %) não voltou ao vigente', COALESCE(v_hash, 'ausente');
  END IF;
  IF (SELECT to_jsonb(p) - 'prosrc' FROM pg_proc p WHERE p.oid = v_oid)
       IS DISTINCT FROM current_setting('ikcous.obsinsp_rollback_atributos')::jsonb THEN
    RAISE EXCEPTION 'POSVOO_ROLLBACK_20261404000000: atributos, dono, OID ou ACL de devolucao_detalhe mudaram';
  END IF;
  IF NOT has_table_privilege('authenticated', 'public.devolucoes', 'SELECT')
     OR NOT has_column_privilege('authenticated', 'public.devolucoes', 'observacao_inspecao', 'SELECT') THEN
    RAISE EXCEPTION 'POSVOO_ROLLBACK_20261404000000: authenticated não voltou a ler public.devolucoes inteira';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_attribute a
              CROSS JOIN LATERAL aclexplode(a.attacl) g
             WHERE a.attrelid = 'public.devolucoes'::regclass AND a.attacl IS NOT NULL
               AND g.grantee = (SELECT oid FROM pg_roles WHERE rolname = 'authenticated')) THEN
    RAISE EXCEPTION 'POSVOO_ROLLBACK_20261404000000: sobrou grant de coluna de authenticated em public.devolucoes';
  END IF;
END $posvoo_rollback_20261404000000$;

-- devolucao_detalhe é RPC chamada pelo PostgREST: recarrega o schema cache. Idempotente.
NOTIFY pgrst, 'reload schema';
