WITH m(migration, funcao, marcador, vezes) AS (VALUES
  ('20261175000000', 'solicitar_devolucao', $marcador$OR split_part(v_foto, '/', 1) <> v_uid::text$marcador$, 1),
  ('20261175000000', 'solicitar_devolucao', $marcador$RAISE EXCEPTION 'Fora do prazo de arrependimento a loja aceita troca ou vale-troca.' USING ERRCODE = '22023';$marcador$, 1),
  ('20261175000000', 'admin_devolucao_concluir', $marcador$IF v_reestocar AND v_di.reestocado_em IS NULL THEN$marcador$, 1),
  ('20261175000000', 'admin_devolucao_concluir', $marcador$v_disponivel := v_o.total - COALESCE(v_o.valor_estornado, 0) - v_em_voo - v_ja_manual;$marcador$, 1),
  ('20261175000000', 'admin_devolucao_concluir', $marcador$AND v_condicao <> 'ausente'
                   AND v_o.stock_returned_at IS NULL;$marcador$, 1),
  ('20261175000000', 'admin_devolucao_reemitir_reembolso', $marcador$IF v_d.reembolso_manual THEN
    RAISE EXCEPTION 'Esta devolução já foi resolvida manualmente (fora do app); não há reembolso para reemitir.'$marcador$, 1),
  ('20261175000000', 'admin_devolucao_reemitir_reembolso', $marcador$IF v_d.refund_id IS NULL THEN
    RAISE EXCEPTION 'Esta devolução não tem um reembolso recusado para reemitir.' USING ERRCODE = '22023';$marcador$, 1),
  ('20261175000000', 'admin_devolucao_reemitir_reembolso', $marcador$IF NOT v_pago_pelo_app THEN
    RAISE EXCEPTION 'Este pedido não é mais elegível para reembolso pelo Mercado Pago (prazo de 180 dias ou forma de pagamento). Reemita como manual (p_manual = true).'$marcador$, 1),
  ('20261175000000', 'admin_devolucao_reemitir_reembolso', $marcador$v_disponivel := GREATEST(v_o.total - COALESCE(v_o.valor_estornado, 0) - v_em_voo - v_ja_manual, 0);$marcador$, 1),
  ('20261175000000', 'get_admin_orders_cancelados_recentes', $marcador$'valor_devolvido_por_devolucao', c.valor_devolvido_por_devolucao$marcador$, 1),
  ('20261175000000', 'get_admin_orders_cancelados_recentes', $marcador$COALESCE((SELECT sum(d.valor_reembolso) FROM public.devolucoes d
                              WHERE d.order_id = o.id AND d.status = 'concluida' AND d.reembolso_manual), 0)
                     AS valor_devolvido_por_devolucao$marcador$, 1),
  ('20261175000000', 'get_admin_orders_cancelados_recentes', $marcador$'valor_estornado', c.valor_estornado$marcador$, 1),
  ('20261175000000', 'solicitar_estorno', $marcador$SELECT COALESCE(sum(d.valor_reembolso), 0) INTO v_ja_manual
      FROM public.devolucoes d
     WHERE d.order_id = p_order_id AND d.status = 'concluida' AND d.reembolso_manual;$marcador$, 1),
  ('20261175000000', 'solicitar_estorno', $marcador$v_saldo := v_total - v_valor_estornado - v_em_curso - v_ja_manual;$marcador$, 1),
  ('20261175000000', 'update_order_status_atomic', $marcador$SELECT COALESCE(sum(d.valor_reembolso), 0) INTO v_ja_manual
          FROM public.devolucoes d
         WHERE d.order_id = p_order_id AND d.status = 'concluida' AND d.reembolso_manual;$marcador$, 1),
  ('20261175000000', 'update_order_status_atomic', $marcador$IF v_total - v_ja_manual > 0 THEN
            INSERT INTO public.order_refunds (order_id, amount, motivo, solicitado_por)
            VALUES (p_order_id, v_total - v_ja_manual, 'cancelamento antes do envio',$marcador$, 1),
  ('20261176000000', 'liberar_cobranca_do_pedido', $marcador$AND gateway_payment_id = p_gateway_payment_id$marcador$, 1),
  ('20261176000000', 'liberar_cobranca_do_pedido', $marcador$tentativas_de_pagamento = tentativas_de_pagamento + 1,$marcador$, 2),
  ('20261176000000', 'registrar_estorno_manual', $marcador$SELECT COALESCE(sum(d.valor_reembolso), 0) INTO v_ja_manual
          FROM public.devolucoes d
         WHERE d.order_id = p_order_id AND d.status = 'concluida' AND d.reembolso_manual;$marcador$, 1),
  ('20261176000000', 'registrar_estorno_manual', $marcador$IF v_total - v_valor_estornado - v_ja_manual <= 0 THEN
            RAISE EXCEPTION 'Este pedido não tem mais nada a devolver: o valor já saiu por outro caminho (devolução ou estorno).'$marcador$, 1),
  ('20261176000000', 'marca_estorno_direto_do_pedido', $marcador$NEW.estorno_manual_registrado_em := COALESCE(NEW.estorno_manual_registrado_em, now());$marcador$, 1),
  ('20261177000000', 'fin__movimentos', $marcador$AND o.payment_status IN ('pago', 'pago_apos_expirar', 'recebido_na_entrega', 'estornado')$marcador$, 1),
  ('20261177000000', 'fin__movimentos', $marcador$(v.total - COALESCE(v.valor_estornado, 0) - COALESCE(dm.valor, 0))::numeric,$marcador$, 1),
  ('20261177000000', 'fin_lancamento_cancelar', $marcador$WHERE s.id = v_l.caixa_sessao_id AND s.status = 'fechado'$marcador$, 1),
  ('20261177000000', 'fin__caixa_calculo', $marcador$SELECT COALESCE(sum(o.total - COALESCE(o.valor_estornado, 0) - COALESCE(dm.valor, 0)), 0) INTO v_estornos_externos$marcador$, 1),
  ('20261177000000', 'fin__caixa_calculo', $marcador$AND o.pagamento_recebido_em IS NOT NULL$marcador$, 1),
  ('20261177000000', 'fin_dre', $marcador$AND NOT (o2.status = 'cancelled' AND o2.stock_returned_at IS NOT NULL)),$marcador$, 1),
  ('20261177000000', 'fin_dre', $marcador$AND NOT (o3.status = 'cancelled' AND o3.stock_returned_at IS NOT NULL)),$marcador$, 1),
  ('20261177000000', 'fin_caixa_abrir', $marcador$SELECT s.valor_contado INTO v_ultimo_contado$marcador$, 1),
  ('20261177000000', 'fin_caixa_abrir', $marcador$WHEN v_valor > COALESCE(v_saldo, 0)
        THEN 'f2000000-0000-4000-8000-000000000006'::uuid -- fora_dre: sobra/aporte$marcador$, 1),
  ('20261177000000', 'fin_caixa_abrir', $marcador$WHEN v_ultimo_contado IS NOT NULL
        THEN 'f2000000-0000-4000-8000-000000000031'::uuid -- Quebra de caixa (financeiro, na DRE)$marcador$, 1),
  ('20261178000000', 'crm__vendas', $marcador$AND o.status NOT IN ('cancelled', 'returned')$marcador$, 1)
), d AS (
  SELECT m.*, (SELECT string_agg(pg_get_functiondef(p.oid), E'\n') FROM pg_proc p
                WHERE p.pronamespace = 'public'::regnamespace AND p.proname = m.funcao) AS def
    FROM m
)
SELECT migration, funcao, vezes AS esperado,
       (length(def) - length(replace(def, marcador, ''))) / length(marcador) AS achado,
       COALESCE((length(def) - length(replace(def, marcador, ''))) / length(marcador) = vezes, false) AS ok
  FROM d ORDER BY ok, migration, funcao;
