-- ============================================================================
-- Rollback manual — o Financeiro descreve a venda do balcão como o app mostra (20261391200000)
-- ============================================================================
-- Devolve, byte a byte, o corpo de public.fin__movimentos(date, date) que a
-- 20261177000000_o_financeiro_da_loja_nasce.sql deixou (md5 ec01f5e2eff4f132aaf075951484ea8a): o
-- extrato volta a mostrar o número com os 8 PRIMEIROS caracteres do id, a venda do balcão sem cliente
-- volta a repetir "Venda no balcão" e a venda anulada pelo app volta a aparecer como "Estorno registrado
-- fora do app". Nenhum valor, data ou linha muda (a migration só trocou texto). Mesma assinatura, mesmo
-- LANGUAGE sql STABLE, mesmo search_path, mesma ACL (CREATE OR REPLACE preserva a vigente).
--
-- DADOS: a migration não gravou nada em linha nenhuma; não há dado a desfazer.
--
-- PRÉ-VOO: o bloco DO $preflight_rollback_20261391200000$ recusa com B1_BASELINE_DIVERGENT — ANTES de
-- qualquer escrita — se o corpo VIVO não for exatamente o que a 20261391200000 deixou (md5
-- 26473edd94ad6547d95de43433088304): segundo rollback ou sucessora desconhecida recusa. Atributos e ACL
-- também são conferidos, e o registro inteiro de pg_proc (menos o texto) é fotografado.
--
-- Executar via psql -1 -f (nunca pelo db-apply, que registraria este rollback no ledger como migration
-- nova). Sem BEGIN/COMMIT de nível superior neste arquivo.
-- ============================================================================

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

DO $preflight_rollback_20261391200000$
DECLARE
  v_fn CONSTANT text := 'public.fin__movimentos(date,date)';
  v_oid oid := to_regprocedure('public.fin__movimentos(date,date)');
  v_hash text;
  v_atributos jsonb;
  v_falta text;
BEGIN
  IF v_oid IS NULL THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: % não existe.', v_fn;
  END IF;
  IF (SELECT count(*) FROM pg_proc p
       WHERE p.pronamespace = 'public'::regnamespace AND p.proname = 'fin__movimentos') <> 1 THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: fin__movimentos tem sobrecarga em public — meça a loja e revise.';
  END IF;

  -- Corpo identificado pelo CONTEÚDO (md5 sem CR).
  SELECT md5(replace(p.prosrc, E'\r', '')), to_jsonb(p) - 'prosrc'
    INTO v_hash, v_atributos
    FROM pg_proc p WHERE p.oid = v_oid;
  IF v_hash IS DISTINCT FROM '26473edd94ad6547d95de43433088304' THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: corpo vivo de % (hash %) não é o que a 20261391200000 deixou — nada a desfazer, ou uma redefinição posterior está no ar; revise antes de reverter.', v_fn, COALESCE(v_hash, 'ausente');
  END IF;

  -- Atributos que o CREATE OR REPLACE reescreve: têm de ser os de sempre (os da 20261177000000).
  IF NOT EXISTS (
       SELECT 1 FROM pg_proc p JOIN pg_language l ON l.oid = p.prolang
        WHERE p.oid = v_oid
          AND l.lanname = 'sql'
          AND p.prokind = 'f'
          AND NOT p.prosecdef
          AND p.provolatile = 's'
          AND p.proretset
          AND p.proconfig = ARRAY['search_path=public']::text[]
          AND pg_get_function_arguments(p.oid) = 'p_inicio date, p_fim date'
          AND pg_get_function_result(p.oid) = 'TABLE(id text, origem text, tipo text, status text, valor numeric, data date, conta_id uuid, conta_destino_id uuid, categoria_id uuid, descricao text, forma_pagamento text, pedido_id uuid, vencimento date, data_competencia date, editavel boolean, canal text, caixa_sessao_id uuid, parcela smallint, parcelas smallint)'
     ) THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: atributos de % (linguagem, SECURITY INVOKER, volatilidade, search_path, argumentos ou retorno) não são os conhecidos — meça a loja e revise.', v_fn;
  END IF;

  -- Ninguém de fora chama direto: só as RPCs fin_* (SECURITY DEFINER) e o service_role.
  IF EXISTS (SELECT 1 FROM pg_proc p
               CROSS JOIN LATERAL aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) g
              WHERE p.oid = v_oid AND g.privilege_type = 'EXECUTE' AND g.grantee = 0)
     OR has_function_privilege('anon', v_oid, 'EXECUTE')
     OR has_function_privilege('authenticated', v_oid, 'EXECUTE') THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: ACL de % não é a conhecida (PUBLIC, anon ou authenticated executam) — meça a loja e revise.', v_fn;
  END IF;

  -- Uma função LANGUAGE sql é validada ao ser criada: o que o corpo lê tem de existir.
  SELECT string_agg(d.item, ', ' ORDER BY d.item) INTO v_falta
    FROM (
      SELECT f AS item FROM unnest(ARRAY['public.fin__dia(timestamptz)', 'public.fin__conta_da_forma(text)',
                                         'public.fin__forma_do_pedido(text,text)']) AS f
       WHERE to_regprocedure(f) IS NULL
      UNION ALL
      SELECT t FROM unnest(ARRAY['public.marketplace_orders', 'public.order_refunds', 'public.devolucoes',
                                 'public.fin_lancamentos', 'public.fin_caixa_sessoes',
                                 'public.marketplace_order_payment_history']) AS t
       WHERE to_regclass(t) IS NULL
      UNION ALL
      SELECT 'marketplace_order_payment_history.' || c
        FROM unnest(ARRAY['order_id', 'acao', 'payment_status_antes', 'payment_status_depois']) AS c
       WHERE to_regclass('public.marketplace_order_payment_history') IS NOT NULL
         AND NOT EXISTS (SELECT 1 FROM pg_attribute a
                          WHERE a.attrelid = to_regclass('public.marketplace_order_payment_history')
                            AND a.attname = c AND NOT a.attisdropped)
    ) d;
  IF v_falta IS NOT NULL THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: o corpo lê o que não existe: % — aplique as migrations anteriores antes.', v_falta;
  END IF;

  -- Fotografia de OID, dono, ACL e TODOS os atributos: o CREATE OR REPLACE só pode trocar prosrc.
  PERFORM set_config('ikcous.fin391_atributos', v_atributos::text, true);
END $preflight_rollback_20261391200000$;

-- fin__movimentos: o corpo da 20261177000000_o_financeiro_da_loja_nasce.sql, BYTE A BYTE.
CREATE OR REPLACE FUNCTION public.fin__movimentos(p_inicio date, p_fim date)
RETURNS TABLE (
  id text, origem text, tipo text, status text, valor numeric, data date,
  conta_id uuid, conta_destino_id uuid, categoria_id uuid, descricao text,
  forma_pagamento text, pedido_id uuid, vencimento date, data_competencia date,
  editavel boolean, canal text, caixa_sessao_id uuid, parcela smallint, parcelas smallint
)
LANGUAGE sql STABLE SET search_path = public
AS $$
  WITH vendas AS (
    SELECT o.*, public.fin__dia(COALESCE(o.pagamento_recebido_em, o.paid_at)) AS dia
      FROM public.marketplace_orders o
     WHERE COALESCE(o.pagamento_recebido_em, o.paid_at) IS NOT NULL
       AND o.payment_status IN ('pago', 'pago_apos_expirar', 'recebido_na_entrega', 'estornado')
  ), manuais AS (
    SELECT l.*,
           CASE WHEN l.status = 'realizado' THEN l.data_realizacao
                ELSE COALESCE(l.data_vencimento, l.data_competencia) END AS dia
      FROM public.fin_lancamentos l
     WHERE l.status <> 'cancelado'
  )
  SELECT * FROM (
    SELECT 'pedido:' || v.id::text,
           CASE WHEN v.canal = 'presencial' THEN 'venda_balcao'
                WHEN v.payment_method = 'online' THEN 'venda_online'
                ELSE 'venda_entrega' END,
           'entrada', 'realizado', v.total::numeric, v.dia,
           public.fin__conta_da_forma(v.payment_method), NULL::uuid,
           'f2000000-0000-4000-8000-000000000001'::uuid,
           CASE WHEN v.canal = 'presencial' THEN 'Venda no balcão' ELSE 'Pedido' END
             || ' #' || upper(left(v.id::text, 8)) || COALESCE(' · ' || NULLIF(btrim(v.customer_name), ''), ''),
           public.fin__forma_do_pedido(v.payment_method, v.metodo_online),
           v.id, NULL::date, v.dia, false, v.canal, NULL::uuid, NULL::smallint, NULL::smallint
      FROM vendas v
    UNION ALL
    SELECT 'estorno:' || r.id::text, 'estorno', 'saida',
           CASE WHEN r.status = 'concluido' THEN 'realizado' ELSE 'previsto' END,
           r.amount::numeric,
           CASE WHEN r.status = 'concluido' THEN public.fin__dia(r.concluido_em) ELSE public.fin__dia(r.created_at) END,
           public.fin__conta_da_forma(o.payment_method), NULL::uuid,
           'f2000000-0000-4000-8000-000000000010'::uuid,
           'Estorno do pedido #' || upper(left(o.id::text, 8)) || COALESCE(' · ' || NULLIF(btrim(r.motivo), ''), ''),
           public.fin__forma_do_pedido(o.payment_method, o.metodo_online),
           o.id,
           CASE WHEN r.status = 'concluido' THEN NULL ELSE public.fin__dia(r.created_at) END,
           CASE WHEN r.status = 'concluido' THEN public.fin__dia(r.concluido_em) ELSE public.fin__dia(r.created_at) END,
           false, o.canal, NULL::uuid, NULL::smallint, NULL::smallint
      FROM public.order_refunds r
      JOIN public.marketplace_orders o ON o.id = r.order_id
     WHERE (r.status = 'concluido' AND r.concluido_em IS NOT NULL)
        OR r.status IN ('solicitado', 'em_processamento')
    UNION ALL
    -- Estornado fora do app (registrar_estorno_manual / MP direto): o que o
    -- ledger não cobriu saiu por fora. Achado F: NÃO usa updated_at — QUALQUER
    -- update posterior do pedido empurraria a data do estorno para a frente.
    -- estorno_manual_registrado_em (20261176000000) é o carimbo do instante
    -- real; pedido estornado manualmente ANTES daquela migration cai para o
    -- updated_at (degradação documentada, sem fonte melhor disponível).
    -- Achado 1 (revisão 26/09/2026, rodada 2): desconta o que uma devolução
    -- CONCLUÍDA com reembolso manual do MESMO pedido já tirou da loja — sem
    -- isto, "devolução concluída (100) + cancela + Já devolvi" contava 100
    -- de saída duas vezes (uma pela devolução, outra pelo estorno externo).
    SELECT 'estorno_externo:' || v.id::text, 'estorno_externo', 'saida', 'realizado',
           (v.total - COALESCE(v.valor_estornado, 0) - COALESCE(dm.valor, 0))::numeric,
           public.fin__dia(COALESCE(v.estorno_manual_registrado_em, v.updated_at)),
           public.fin__conta_da_forma(v.payment_method), NULL::uuid,
           'f2000000-0000-4000-8000-000000000010'::uuid,
           'Estorno registrado fora do app · pedido #' || upper(left(v.id::text, 8)),
           public.fin__forma_do_pedido(v.payment_method, v.metodo_online),
           v.id, NULL::date, public.fin__dia(COALESCE(v.estorno_manual_registrado_em, v.updated_at)),
           false, v.canal, NULL::uuid, NULL::smallint, NULL::smallint
      FROM vendas v
      LEFT JOIN LATERAL (
        SELECT sum(d.valor_reembolso) AS valor FROM public.devolucoes d
         WHERE d.order_id = v.id AND d.status = 'concluida' AND d.reembolso_manual
      ) dm ON true
     WHERE v.payment_status = 'estornado'
       AND v.total - COALESCE(v.valor_estornado, 0) - COALESCE(dm.valor, 0) > 0
    UNION ALL
    SELECT 'devolucao:' || d.id::text, 'devolucao', 'saida', 'realizado', d.valor_reembolso::numeric,
           public.fin__dia(d.concluida_em),
           public.fin__conta_da_forma(o.payment_method), NULL::uuid,
           'f2000000-0000-4000-8000-000000000010'::uuid,
           'Reembolso da devolução ' || d.protocolo,
           public.fin__forma_do_pedido(o.payment_method, o.metodo_online),
           o.id, NULL::date, public.fin__dia(d.concluida_em), false, o.canal, NULL::uuid, NULL::smallint, NULL::smallint
      FROM public.devolucoes d
      JOIN public.marketplace_orders o ON o.id = d.order_id
     WHERE d.status = 'concluida' AND d.reembolso_manual AND d.valor_reembolso > 0
    UNION ALL
    SELECT m.id::text, m.origem, m.tipo, m.status, m.valor::numeric, m.dia,
           m.conta_id, m.conta_destino_id, m.categoria_id, m.descricao, m.forma_pagamento,
           NULL::uuid, m.data_vencimento, m.data_competencia,
           (m.caixa_sessao_id IS NULL OR EXISTS (
              SELECT 1 FROM public.fin_caixa_sessoes s WHERE s.id = m.caixa_sessao_id AND s.status = 'aberto')),
           NULL::text, m.caixa_sessao_id, m.parcela, m.parcelas
      FROM manuais m
  ) t (id, origem, tipo, status, valor, data, conta_id, conta_destino_id, categoria_id, descricao,
       forma_pagamento, pedido_id, vencimento, data_competencia, editavel, canal, caixa_sessao_id, parcela, parcelas)
  WHERE (p_inicio IS NULL OR t.data >= p_inicio)
    AND (p_fim IS NULL OR t.data <= p_fim)
$$;

DO $conferencia_rollback_20261391200000$
DECLARE
  v_fn CONSTANT text := 'public.fin__movimentos(date,date)';
  v_oid oid := to_regprocedure('public.fin__movimentos(date,date)');
  v_hash text;
BEGIN
  IF v_oid IS NULL THEN
    RAISE EXCEPTION 'conferencia do rollback 20261391200000: % sumiu', v_fn;
  END IF;
  IF (SELECT count(*) FROM pg_proc p
       WHERE p.pronamespace = 'public'::regnamespace AND p.proname = 'fin__movimentos') <> 1 THEN
    RAISE EXCEPTION 'conferencia do rollback 20261391200000: fin__movimentos ficou com sobrecarga';
  END IF;
  SELECT md5(replace(prosrc, E'\r', '')) INTO v_hash FROM pg_proc WHERE oid = v_oid;
  IF v_hash IS DISTINCT FROM 'ec01f5e2eff4f132aaf075951484ea8a' THEN
    RAISE EXCEPTION 'conferencia do rollback 20261391200000: corpo vivo de % (hash %) não é o esperado', v_fn, COALESCE(v_hash, 'ausente');
  END IF;
  IF NOT EXISTS (
       SELECT 1 FROM pg_proc p
        WHERE p.oid = v_oid
          AND (to_jsonb(p) - 'prosrc') = current_setting('ikcous.fin391_atributos')::jsonb
     ) THEN
    RAISE EXCEPTION 'conferencia do rollback 20261391200000: atributos de % mudaram (só o texto podia mudar)', v_fn;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_proc p
               CROSS JOIN LATERAL aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) g
              WHERE p.oid = v_oid AND g.privilege_type = 'EXECUTE' AND g.grantee = 0)
     OR has_function_privilege('anon', v_oid, 'EXECUTE')
     OR has_function_privilege('authenticated', v_oid, 'EXECUTE') THEN
    RAISE EXCEPTION 'conferencia do rollback 20261391200000: % ficou alcançável por PUBLIC, anon ou authenticated', v_fn;
  END IF;
END $conferencia_rollback_20261391200000$;
