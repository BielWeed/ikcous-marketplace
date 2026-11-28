-- Rollback manual da 1664. Restaura os cinco corpos vigentes, byte a byte (LF).
-- Não descarta uma conferência ou o vínculo que já tenha sido gravado. Nesse caso,
-- use correção aditiva revisada; não apague registros para liberar o rollback.
-- A transação e o registro no ledger são do aplicador, não deste arquivo.
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

DO $preflight_rollback_1664$
DECLARE
  r record;
  v_oid oid;
  v_atributos jsonb;
BEGIN
  FOR r IN SELECT * FROM (VALUES
    ('public.fin__movimentos(date,date)', '17127ad84b6eb71e8cd1714d47855a68'),
    ('public.pedido__saldo_a_estornar(uuid)', '7f0c83c80b5f26df9cbc19e92384453d'),
    ('public.admin_devolucao_reembolso_por_fora_apos_espera(uuid,uuid,text)', '32c2bc1d99162e0450a11431fa8ae411'),
    ('public.pedido_reembolsos_e_saldo(uuid)', '801b199196120f82c4b57ab7abbc9c11'),
    ('public.get_admin_analytics_v2(integer)', '3853f60efad86f22deb368ed791d76cb')
  ) AS esperado(fn, h)
  LOOP
    v_oid := to_regprocedure(r.fn);
    SELECT to_jsonb(p) - 'prosrc' INTO v_atributos FROM pg_proc p
     WHERE p.oid = v_oid AND md5(replace(p.prosrc, chr(13), '')) = r.h;
    IF NOT FOUND OR (SELECT count(*) FROM pg_proc WHERE pronamespace = 'public'::regnamespace
                       AND proname::text = split_part(split_part(r.fn, '(', 1), '.', 2)) <> 1 THEN
      RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: rollback da 1664 exige o corpo e a assinatura instalados por ela: %.', r.fn;
    END IF;
    PERFORM set_config('ikcous.conciliacao1664_' || v_oid, v_atributos::text, true);
  END LOOP;
  IF EXISTS (
    SELECT 1 FROM (VALUES
      ('public.order_refund__valor_coberto_por_fora(uuid)', 'b02ca216bd69262ba5f5ca4034d6db4a'),
      ('public.order_refund__suspeitas_do_pedido(uuid)', 'ecf3eb8ffbe6926ef78678f51ca3f24f'),
      ('public.admin_devolucao_confirmar_mesmo_dinheiro(uuid,uuid)', 'a17c0572552eaef549ff3b0dfab76622'),
      ('public.admin_devolucao_confirmar_dois_reembolsos(uuid,uuid)', '7d8a4faa9bd8954cf9cb9851bf8dfde5')
    ) AS esperado(fn, h)
    WHERE NOT EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid = to_regprocedure(esperado.fn)
                       AND md5(replace(p.prosrc, chr(13), '')) = esperado.h)
  ) THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: uma função nova da 1664 não tem o corpo esperado.';
  END IF;

  LOCK TABLE public.order_refunds, public.order_refund_prova IN ACCESS EXCLUSIVE MODE;
  IF EXISTS (SELECT 1 FROM public.order_refunds WHERE cobre_devolucao_id IS NOT NULL OR dobro_conferido_em IS NOT NULL)
     OR EXISTS (SELECT 1 FROM public.order_refund_prova WHERE devolucao_id IS NOT NULL) THEN
    RAISE EXCEPTION 'CONFERENCIA_DE_REEMBOLSO_NAO_SE_APAGA: já existem vínculos ou conferências desta migration.';
  END IF;
END $preflight_rollback_1664$;

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
           -- O número é o que o app mostra: os 6 ÚLTIMOS caracteres do id, em maiúsculas
           -- (src/lib/numero-do-pedido.ts). A venda do balcão sem cliente nasce com
           -- customer_name = 'Venda no balcão' e não repete o nome (20261391200000).
           CASE WHEN v.canal = 'presencial'
                THEN 'Venda no balcão #' || upper(right(v.id::text, 6))
                     || COALESCE(' · ' || NULLIF(NULLIF(btrim(v.customer_name), ''), 'Venda no balcão'), '')
                ELSE 'Pedido #' || upper(right(v.id::text, 6))
                     || COALESCE(' · ' || NULLIF(btrim(v.customer_name), ''), '') END,
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
           'Estorno do pedido #' || upper(right(o.id::text, 6)) || COALESCE(' · ' || NULLIF(btrim(r.motivo), ''), ''),
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
           -- A venda do balcão anulada PELO APP (anular_venda_presencial, 20261204000000) deixa
           -- no histórico do pagamento a marca 'desfeito' de recebido_na_entrega para estornado:
           -- não é estorno feito fora do app. Só o texto muda (20261391200000).
           CASE WHEN v.canal = 'presencial' AND EXISTS (
                  SELECT 1 FROM public.marketplace_order_payment_history h
                   WHERE h.order_id = v.id AND h.acao = 'desfeito'
                     AND h.payment_status_antes = 'recebido_na_entrega'
                     AND h.payment_status_depois = 'estornado')
                THEN 'Venda do balcão anulada · #' || upper(right(v.id::text, 6))
                ELSE 'Estorno registrado fora do app · pedido #' || upper(right(v.id::text, 6)) END,
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

CREATE OR REPLACE FUNCTION public.pedido__saldo_a_estornar(p_order_id uuid)
RETURNS numeric
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $saldo$
  -- total pago − já confirmado (valor_estornado) − em voo (solicitado/em_processamento, e a concluída
  -- AINDA NÃO SOMADA: status 'concluido' com concluido_em NULL) − EM DÚVIDA (20261241000000: linha
  -- falhou/recusado cujo dinheiro PODE ter saído no Mercado Pago, order_refund__pode_ter_saido, e que
  -- NÃO foi substituída por reembolso manual nem liberada por fora) − reembolso manual de devolução
  -- concluída − POR FORA PARCIAL do pedido cancelado (linha com por_fora_liberado_em SEM a marca de
  -- substituída: a saída dos 7 dias que cobriu só parte do saldo; o dinheiro saiu por fora e não está
  -- em nenhuma outra conta — conta em QUALQUER status da linha, senão voltaria ao saldo quando o robô
  -- fechasse a linha).
  -- Pode dar zero ou negativo: quem chama decide.
  SELECT o.total
         - COALESCE(o.valor_estornado, 0)
         - COALESCE((SELECT sum(r.amount)
                       FROM public.order_refunds r
                      WHERE r.order_id = o.id
                        AND (r.status IN ('solicitado', 'em_processamento')
                             OR (r.status = 'concluido' AND r.concluido_em IS NULL))), 0)
         - COALESCE((SELECT sum(r.amount)
                       FROM public.order_refunds r
                      WHERE r.order_id = o.id
                        AND r.status IN ('falhou', 'recusado')
                        AND NOT EXISTS (SELECT 1
                                          FROM public.order_refund_prova pv
                                         WHERE pv.refund_id = r.id
                                           AND pv.substituida_por_manual_em IS NOT NULL)
                        AND NOT EXISTS (SELECT 1
                                          FROM public.order_refund_prova pf
                                         WHERE pf.refund_id = r.id
                                           AND pf.por_fora_liberado_em IS NOT NULL)
                        AND public.order_refund__pode_ter_saido(r.id)), 0)
         - COALESCE((SELECT sum(d.valor_reembolso)
                       FROM public.devolucoes d
                      WHERE d.order_id = o.id
                        AND d.status = 'concluida'
                        AND d.reembolso_manual), 0)
         - COALESCE((SELECT sum(r.amount)
                       FROM public.order_refunds r
                       JOIN public.order_refund_prova pf ON pf.refund_id = r.id
                      WHERE r.order_id = o.id
                        AND pf.por_fora_liberado_em IS NOT NULL
                        AND pf.substituida_por_manual_em IS NULL), 0)
    FROM public.marketplace_orders o
   WHERE o.id = p_order_id;
$saldo$;

CREATE OR REPLACE FUNCTION public.admin_devolucao_reembolso_por_fora_apos_espera(
  p_devolucao_id uuid,
  p_refund_esperado uuid,
  p_confirmacao text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $por_fora_apos_espera$
DECLARE
  v_d public.devolucoes%ROWTYPE;
  v_r public.order_refunds%ROWTYPE;
  v_desde timestamptz;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Acesso negado.' USING ERRCODE = '42501';
  END IF;
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Acesso negado.' USING ERRCODE = '42501';
  END IF;
  -- Papel ATUAL (auth.users E profiles), não o do JWT: admin rebaixado para aqui.
  IF NOT public.is_admin_atual() THEN
    RAISE EXCEPTION 'Acesso negado.' USING ERRCODE = '42501';
  END IF;
  IF p_refund_esperado IS NULL THEN
    RAISE EXCEPTION 'Informe a linha de reembolso que a tela mostrava (p_refund_esperado).' USING ERRCODE = '22023';
  END IF;
  IF upper(btrim(COALESCE(p_confirmacao, ''))) <> 'DEVOLVI POR FORA' THEN
    RAISE EXCEPTION 'Para confirmar, digite DEVOLVI POR FORA.' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_d FROM public.devolucoes WHERE id = p_devolucao_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Devolução não encontrada.' USING ERRCODE = 'P0002';
  END IF;
  IF v_d.status <> 'concluida' OR v_d.resolucao_final IS DISTINCT FROM 'reembolso' THEN
    RAISE EXCEPTION 'Só uma devolução concluída com reembolso pode ser resolvida por fora.' USING ERRCODE = '22023';
  END IF;
  IF v_d.valor_reembolso IS NULL OR v_d.valor_reembolso <= 0 THEN
    RAISE EXCEPTION 'Esta devolução não tem valor de reembolso.' USING ERRCODE = '22023';
  END IF;
  IF v_d.reembolso_manual THEN
    RETURN jsonb_build_object('resultado', 'ja_concluido', 'detalhe', 'por_fora');
  END IF;
  IF v_d.refund_id IS NULL THEN
    RAISE EXCEPTION 'Esta devolução não tem um reembolso para resolver por fora.' USING ERRCODE = '22023';
  END IF;

  PERFORM 1
     FROM public.order_refunds r
    WHERE r.order_id = v_d.order_id
    ORDER BY r.id
      FOR UPDATE;
  PERFORM 1 FROM public.marketplace_orders o WHERE o.id = v_d.order_id FOR UPDATE;

  IF v_d.refund_id IS DISTINCT FROM p_refund_esperado THEN
    RETURN jsonb_build_object('resultado', 'reembolso_mudou', 'detalhe', 'outra_linha',
                              'refund_id', v_d.refund_id);
  END IF;
  -- Lida DEPOIS da trava da linha: um POST autorizado no meio já está carimbado aqui.
  SELECT * INTO v_r FROM public.order_refunds WHERE id = v_d.refund_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'A linha de reembolso desta devolução não existe mais.' USING ERRCODE = 'P0002';
  END IF;
  IF v_r.status = 'concluido' THEN
    RETURN jsonb_build_object('resultado', 'ja_concluido', 'detalhe', 'dinheiro_ja_saiu', 'refund_id', v_r.id);
  END IF;
  IF v_r.status = 'solicitado' THEN
    RETURN jsonb_build_object('resultado', 'em_andamento', 'detalhe', 'solicitado', 'refund_id', v_r.id);
  END IF;
  IF v_r.status = 'recusado'
     OR (v_r.status = 'falhou' AND NOT public.order_refund__pode_ter_saido(v_r.id)) THEN
    -- Nada saiu desta linha: não precisa esperar — é o "Já devolvi por fora" de sempre.
    RETURN jsonb_build_object('resultado', 'sem_espera', 'detalhe', 'use_por_fora', 'refund_id', v_r.id);
  END IF;

  -- A linha já foi resolvida por fora (marca posta): a saída não se usa duas vezes.
  IF EXISTS (SELECT 1 FROM public.order_refund_prova pv
              WHERE pv.refund_id = v_r.id
                AND (pv.substituida_por_manual_em IS NOT NULL OR pv.por_fora_liberado_em IS NOT NULL)) THEN
    RETURN jsonb_build_object('resultado', 'ja_concluido', 'detalhe', 'ja_resolvido_por_fora', 'refund_id', v_r.id);
  END IF;
  -- em_processamento, ou falhou que pode ter saído: só depois de 7 dias do último envio (relógio do banco).
  -- A espera é a MESMA regra que o painel mostra (order_refund__liberavel_apos_espera).
  v_desde := COALESCE(v_r.post_autorizado_em, v_r.created_at);
  IF NOT public.order_refund__liberavel_apos_espera(v_r.id) THEN
    RETURN jsonb_build_object('resultado', 'aguarde', 'detalhe', 'antes_de_7_dias', 'refund_id', v_r.id,
                              'liberado_a_partir_de', v_desde + interval '7 days');
  END IF;

  -- A3 + A4: nenhum POST desta linha sai mais, e ela sai da conta "em dúvida" (o manual a substitui).
  INSERT INTO public.order_refund_prova AS pv (refund_id, substituida_por_manual_em, por_fora_liberado_em)
  VALUES (v_r.id, now(), now())
  ON CONFLICT (refund_id) DO UPDATE
     SET substituida_por_manual_em = COALESCE(pv.substituida_por_manual_em, EXCLUDED.substituida_por_manual_em),
         por_fora_liberado_em = COALESCE(pv.por_fora_liberado_em, EXCLUDED.por_fora_liberado_em);

  UPDATE public.devolucoes
     SET refund_id = NULL, reembolso_manual = true, updated_at = now()
   WHERE id = p_devolucao_id;

  PERFORM public.devolucao__registrar_evento(p_devolucao_id, 'concluida', 'concluida', 'loja',
    'Reembolso resolvido manualmente (fora do app) depois de 7 dias sem resposta do Mercado Pago.');
  PERFORM public.devolucao__avisar_reembolso(p_devolucao_id, 'reembolso_combinado', 'success',
    'Devolução concluída',
    'O reembolso da devolução ' || v_d.protocolo || ' foi combinado com a loja (em mãos ou por PIX). Se tiver dúvida, fale com a loja.');

  RETURN jsonb_build_object('resultado', 'combinado', 'detalhe', 'apos_espera',
                            'risco_de_dobro', true, 'refund_id', v_r.id);
END;
$por_fora_apos_espera$;

CREATE OR REPLACE FUNCTION public.pedido_reembolsos_e_saldo(p_order_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $reembolsos_e_saldo$
DECLARE
  v_o public.marketplace_orders%ROWTYPE;
  v_eh_pix boolean;
  v_em_voo numeric;
  v_em_duvida numeric;
  v_manual numeric;
  v_reservado numeric;
  v_linhas jsonb;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_admin_atual() THEN
    RAISE EXCEPTION 'Acesso negado.' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_o FROM public.marketplace_orders WHERE id = p_order_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Pedido não encontrado.' USING ERRCODE = 'P0002';
  END IF;
  v_eh_pix := v_o.metodo_online IS NULL OR v_o.metodo_online NOT IN ('credito', 'debito');

  -- Os MESMOS filtros de pedido__saldo_a_estornar, parcela por parcela.
  SELECT COALESCE(sum(r.amount), 0) INTO v_em_voo
    FROM public.order_refunds r
   WHERE r.order_id = p_order_id
     AND (r.status IN ('solicitado', 'em_processamento')
          OR (r.status = 'concluido' AND r.concluido_em IS NULL));

  SELECT COALESCE(sum(r.amount), 0) INTO v_em_duvida
    FROM public.order_refunds r
   WHERE r.order_id = p_order_id
     AND r.status IN ('falhou', 'recusado')
     AND NOT EXISTS (SELECT 1
                       FROM public.order_refund_prova pv
                      WHERE pv.refund_id = r.id
                        AND pv.substituida_por_manual_em IS NOT NULL)
     AND NOT EXISTS (SELECT 1
                       FROM public.order_refund_prova pf
                      WHERE pf.refund_id = r.id
                        AND pf.por_fora_liberado_em IS NOT NULL)
     AND public.order_refund__pode_ter_saido(r.id);

  SELECT COALESCE(sum(d.valor_reembolso), 0) INTO v_manual
    FROM public.devolucoes d
   WHERE d.order_id = p_order_id
     AND d.status = 'concluida'
     AND d.reembolso_manual;
  v_manual := v_manual + COALESCE((SELECT sum(r.amount)
                                     FROM public.order_refunds r
                                     JOIN public.order_refund_prova pf ON pf.refund_id = r.id
                                    WHERE r.order_id = p_order_id
                                      AND pf.por_fora_liberado_em IS NOT NULL
                                      AND pf.substituida_por_manual_em IS NULL), 0);

  -- RESERVADO por fora: linha já resolvida por fora (por_fora_liberado_em) que ainda está viva no MP (os mesmos
  -- status de em_voo). O valor dela conta em em_voo E no que saiu por fora até o MP responder: é o lado seguro
  -- (decisão do plano), e a tela diz isso à lojista em vez de "tudo devolvido".
  SELECT COALESCE(sum(r.amount), 0) INTO v_reservado
    FROM public.order_refunds r
    JOIN public.order_refund_prova pr ON pr.refund_id = r.id
   WHERE r.order_id = p_order_id
     AND pr.por_fora_liberado_em IS NOT NULL
     AND (r.status IN ('solicitado', 'em_processamento')
          OR (r.status = 'concluido' AND r.concluido_em IS NULL));

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'id', r.id,
           'status', r.status,
           'amount', r.amount,
           'pode_ter_saido', public.order_refund__pode_ter_saido(r.id),
           'por_fora_liberado_em', pv.por_fora_liberado_em,
           'por_fora_apos_espera_liberado', public.order_refund__liberavel_apos_espera(r.id),
           'substituida_por_manual', pv.substituida_por_manual_em IS NOT NULL,
           'eh_pix', v_eh_pix
         ) ORDER BY r.created_at, r.id), '[]'::jsonb)
    INTO v_linhas
    FROM public.order_refunds r
    LEFT JOIN public.order_refund_prova pv ON pv.refund_id = r.id
   WHERE r.order_id = p_order_id;

  RETURN jsonb_build_object(
    'total', v_o.total,
    'valor_estornado', COALESCE(v_o.valor_estornado, 0),
    'em_voo', v_em_voo,
    'em_duvida', v_em_duvida,
    'manual', v_manual,
    'disponivel', GREATEST(public.pedido__saldo_a_estornar(p_order_id), 0),
    'reservado_por_fora', v_reservado,
    'linhas', v_linhas
  );
END;
$reembolsos_e_saldo$;

CREATE OR REPLACE FUNCTION public.get_admin_analytics_v2(p_limit_days integer DEFAULT 90)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $$
DECLARE
    result json;
    active_users_count int;
    low_stock_count int;

    -- Today stats
    today_revenue numeric;
    today_count bigint;
    today_pending bigint;
    yesterday_revenue numeric;
    yesterday_count bigint;
    today_rev_trend numeric;
    today_count_trend numeric;

    -- month stats (rolling 30 days)
    month_revenue numeric;
    month_count bigint;
    prev_month_revenue numeric;
    prev_month_count bigint;
    month_rev_trend numeric;
    month_count_trend numeric;

    -- executive stats (all-time)
    total_rev numeric;
    total_ord bigint;

    -- avg ticket (all-time)
    avg_ticket numeric;

    -- active customers (all-time)
    active_customers bigint;

    -- inventory values
    inv_cost_total numeric;
    inv_value_total numeric;
    inv_revenue_total numeric;
    inv_revenue_without_cost numeric;
    inv_products_without_cost bigint;
    inv_products_with_cost bigint;

    -- lists
    rev_history json;
    top_prods json;

    -- dinheiro reconhecido: pedido concluído e cobrança paga fora do prazo,
    -- mesmo com o pedido cancelado (achados 2 e 3, 22/08/2026)
    delivered_total bigint;
    paid_on_cancelled bigint;

    -- produtos vendidos SEM custo cadastrado: ficam fora do lucro e do top 5 (20261234000000)
    products_without_cost bigint;
BEGIN
    -- 0. Security Check
    IF NOT public.is_admin() THEN
        RAISE EXCEPTION 'Acesso negado: privilégios de administrador necessários.';
    END IF;
    -- Papel ATUAL (auth.users E profiles), não o do JWT: admin rebaixado para aqui (20261199000000).
    IF NOT public.is_admin_atual() THEN
        RAISE EXCEPTION 'Acesso negado: privilégios de administrador necessários.';
    END IF;

    -- 1. Today vs Yesterday (Same period)
    SELECT COALESCE(SUM(total), 0), COUNT(*)
    INTO today_revenue, today_count
    FROM public.marketplace_orders
    WHERE created_at >= date_trunc('day', now() AT TIME ZONE 'America/Sao_Paulo') AT TIME ZONE 'America/Sao_Paulo'
    AND status NOT IN ('cancelled', 'returned')
    AND (payment_status IN ('pago', 'pago_apos_expirar', 'recebido_na_entrega'));

    SELECT COALESCE(SUM(total), 0), COUNT(*)
    INTO yesterday_revenue, yesterday_count
    FROM public.marketplace_orders
    WHERE created_at >= date_trunc('day', (now() - interval '1 day') AT TIME ZONE 'America/Sao_Paulo') AT TIME ZONE 'America/Sao_Paulo'
    AND created_at < now() - interval '1 day'
    AND status NOT IN ('cancelled', 'returned')
    AND (payment_status IN ('pago', 'pago_apos_expirar', 'recebido_na_entrega'));

    today_rev_trend := CASE WHEN yesterday_revenue > 0 THEN ((today_revenue - yesterday_revenue) / yesterday_revenue) * 100 ELSE (CASE WHEN today_revenue > 0 THEN 100 ELSE 0 END) END;
    today_count_trend := CASE WHEN yesterday_count > 0 THEN ((today_count::numeric - yesterday_count::numeric) / yesterday_count::numeric) * 100 ELSE (CASE WHEN today_count > 0 THEN 100 ELSE 0 END) END;

    SELECT COUNT(*) INTO today_pending
    FROM public.marketplace_orders
    WHERE status in ('pending', 'new', 'processing');

    -- 2. month vs Previous Month (Rolling 30 Days)
    SELECT COALESCE(SUM(total), 0), COUNT(*)
    INTO month_revenue, month_count
    FROM public.marketplace_orders
    WHERE created_at >= now() - interval '30 days'
    AND status NOT IN ('cancelled', 'returned')
    AND (payment_status IN ('pago', 'pago_apos_expirar', 'recebido_na_entrega'));

    SELECT COALESCE(SUM(total), 0), COUNT(*)
    INTO prev_month_revenue, prev_month_count
    FROM public.marketplace_orders
    WHERE created_at >= now() - interval '60 days'
    AND created_at < now() - interval '30 days'
    AND status NOT IN ('cancelled', 'returned')
    AND (payment_status IN ('pago', 'pago_apos_expirar', 'recebido_na_entrega'));

    month_rev_trend := CASE WHEN prev_month_revenue > 0 THEN ((month_revenue - prev_month_revenue) / prev_month_revenue) * 100 ELSE (CASE WHEN month_revenue > 0 THEN 100 ELSE 0 END) END;
    month_count_trend := CASE WHEN prev_month_count > 0 THEN ((month_count::numeric - prev_month_count::numeric) / prev_month_count::numeric) * 100 ELSE (CASE WHEN month_count > 0 THEN 100 ELSE 0 END) END;

    -- 3. Executive Metrics (All-time total metrics)
    SELECT COALESCE(SUM(total), 0), COUNT(*)
    INTO total_rev, total_ord
    FROM public.marketplace_orders
    WHERE status NOT IN ('cancelled', 'returned')
    AND (payment_status IN ('pago', 'pago_apos_expirar', 'recebido_na_entrega'));

    avg_ticket := CASE WHEN total_ord > 0 THEN total_rev / total_ord ELSE 0 END;

    SELECT COUNT(DISTINCT COALESCE(user_id::text, customer_data->>'email', customer_data->>'whatsapp'))
    INTO active_customers
    FROM public.marketplace_orders
    WHERE status NOT IN ('cancelled', 'returned')
    AND (payment_status IN ('pago', 'pago_apos_expirar', 'recebido_na_entrega'));

    SELECT COUNT(*) INTO active_users_count FROM public.profiles;

    -- Estoque efetivo: soma dos `stock_increment` das variantes ATIVAS
    -- quando existe ao menos uma variante ativa; senão a coluna
    -- `produtos.estoque` crua. É a MESMA regra de src/lib/mappers.ts:98-107
    -- (mapProductFromDB), que o cartão do produto, o formulário e a loja já
    -- usam — antes esta função lia a coluna crua e divergia (achado 13,
    -- 20/08/2026). Calculada uma única vez e usada nos dois agregados
    -- abaixo (estoque baixo, custo/valor de estoque).
    WITH estoque_efetivo AS (
        SELECT
            p.custo,
            p.preco_venda,
            p.estoque_minimo,
            CASE
                WHEN COALESCE(v.qtd_ativas, 0) > 0 THEN COALESCE(v.soma_ativas, 0)
                ELSE p.estoque
            END AS estoque,
            CASE
                WHEN COALESCE(v.qtd_ativas, 0) > 0 THEN COALESCE(v.soma_venda, 0)
                ELSE p.preco_venda * p.estoque
            END AS faturamento
        FROM public.produtos p
        LEFT JOIN LATERAL (
            SELECT
                COUNT(*) FILTER (WHERE pv.active) AS qtd_ativas,
                SUM(COALESCE(pv.stock_increment, 0)) FILTER (WHERE pv.active) AS soma_ativas,
                SUM(COALESCE(pv.price_override, p.preco_venda) * COALESCE(pv.stock_increment, 0)) FILTER (WHERE pv.active) AS soma_venda
            FROM public.product_variants pv
            WHERE pv.product_id = p.id
        ) v ON true
        WHERE p.deleted_at IS NULL AND p.ativo = true
    )
    SELECT
        COUNT(*) FILTER (WHERE estoque <= COALESCE(estoque_minimo, 5)),
        COALESCE(SUM(custo * estoque), 0),
        -- Só produto COM custo: sem custo, a venda inteira contava como lucro em "Lucro se vender tudo" (20261214000000).
        COALESCE(SUM(faturamento) FILTER (WHERE custo IS NOT NULL), 0),
        COALESCE(SUM(faturamento), 0),
        COALESCE(SUM(faturamento) FILTER (WHERE custo IS NULL), 0),
        COUNT(*) FILTER (WHERE custo IS NULL AND estoque > 0),
        COUNT(*) FILTER (WHERE custo IS NOT NULL AND estoque > 0)
    INTO low_stock_count, inv_cost_total, inv_value_total, inv_revenue_total, inv_revenue_without_cost, inv_products_without_cost, inv_products_with_cost
    FROM estoque_efetivo;

    -- 4. Revenue, Orders, Profit & Cost History (Filtered by p_limit_days for performance)
    -- This scans only within the required range using the created_at index or created_at::date expression index
    SELECT json_agg(h)
    INTO rev_history
    FROM (
        WITH days AS (
            SELECT generate_series(
                ((now() AT TIME ZONE 'America/Sao_Paulo')
                - (p_limit_days || ' days')::interval)::date,
                (now() AT TIME ZONE 'America/Sao_Paulo')::date,
                interval '1 day'
            )::date AS day
        ),
        daily_orders AS (
            SELECT
                (o.created_at AT TIME ZONE 'America/Sao_Paulo')::date AS day,
                COALESCE(SUM(o.total), 0) AS revenue,
                COUNT(o.id)::int as orders
            FROM public.marketplace_orders o
            WHERE o.created_at >= now() - (p_limit_days || ' days')::interval - interval '1 day'
              AND o.status NOT IN ('cancelled', 'returned')
              AND (o.payment_status IN ('pago', 'pago_apos_expirar', 'recebido_na_entrega'))
            GROUP BY ((o.created_at AT TIME ZONE 'America/Sao_Paulo')::date)
        ),
        devs AS MATERIALIZED (
            -- DINHEIRO de cada devolucao CONCLUIDA com reembolso ou vale (troca NAO conta: a peca sai de novo), em reais de PRODUTO (sem o frete de ida) (20261399995000).
            -- vv = valor das pecas que voltaram (toda condicao menos 'ausente'); va = valor das pecas 'Nao veio' (ficaram com a cliente).
            -- pm = o dinheiro devolvido: reembolso = valor_reembolso menos o frete de ida (devolucao de reembolso SEM valor gravado = o das pecas que voltaram, como era antes);
            -- vale = 0 (20261659000000): o vale-troca e' credito na loja, nao dinheiro que saiu; como no Financeiro, a venda da peca fica no lucro
            -- e as pecas do vale seguem na quantidade devolvida e no custo que volta (reestocadas). Antes era o valor das pecas que voltaram.
            -- fv / fa = a fracao do valor de cada peca que esse dinheiro cobriu: primeiro as pecas que voltaram, so depois as 'Nao veio'.
            -- excesso = o que passou do valor de todas as pecas da devolucao: vai para o rateio do pedido (como o estorno sem devolucao).
            SELECT dv.id AS devolucao_id,
                   dv.order_id,
                   CASE WHEN x.vv > 0 THEN LEAST(m.pm, x.vv) / x.vv ELSE 0 END AS fv,
                   CASE WHEN x.va > 0 THEN LEAST(GREATEST(m.pm - x.vv, 0), x.va) / x.va ELSE 0 END AS fa,
                   GREATEST(0, m.pm - x.vv - x.va) AS excesso
              FROM public.devolucoes dv
              CROSS JOIN LATERAL (SELECT COALESCE(SUM(dx.quantidade * dx.valor_unitario) FILTER (WHERE dx.condicao IS DISTINCT FROM 'ausente'), 0) AS vv,
                                         COALESCE(SUM(dx.quantidade * dx.valor_unitario) FILTER (WHERE dx.condicao = 'ausente'), 0) AS va
                                    FROM public.devolucao_itens dx
                                   WHERE dx.devolucao_id = dv.id) x
              CROSS JOIN LATERAL (SELECT CASE WHEN dv.resolucao_final = 'vale' THEN 0
                                              WHEN dv.resolucao_final = 'reembolso' AND dv.valor_reembolso IS NOT NULL
                                              THEN GREATEST(0, dv.valor_reembolso - COALESCE(dv.valor_frete_ida, 0))
                                              ELSE x.vv END AS pm) m
             WHERE dv.status = 'concluida'
               AND dv.resolucao_final IN ('reembolso', 'vale')
               AND EXISTS (SELECT 1 FROM public.marketplace_orders dj
                            WHERE dj.id = dv.order_id
                              AND dj.created_at >= now() - (p_limit_days || ' days')::interval - interval '1 day')
        ),
        dev_item AS (
            -- O que as devolucoes concluidas fizeram com CADA item vendido, numa passada so (agrupado por item):
            -- pecas devolvidas que voltaram (sem as 'Nao veio'), as que voltaram a PRATELEIRA (reestocado_em preenchido: so o custo delas e' devolvido ao lucro)
            -- e o dinheiro que as devolucoes devolveram POR este item (fv/fa de cada devolucao).
            SELECT di.order_item_id,
                   COALESCE(SUM(di.quantidade) FILTER (WHERE di.condicao IS DISTINCT FROM 'ausente'), 0) AS devolvidas,
                   COALESCE(SUM(di.quantidade) FILTER (WHERE di.reestocado_em IS NOT NULL AND di.condicao IS DISTINCT FROM 'ausente'), 0) AS reestocadas,
                   COALESCE(SUM(di.quantidade * di.valor_unitario * CASE WHEN di.condicao = 'ausente' THEN d.fa ELSE d.fv END), 0) AS dinheiro
              FROM public.devolucao_itens di
              JOIN devs d ON d.devolucao_id = di.devolucao_id
             GROUP BY di.order_item_id
        ),
        pecas AS MATERIALIZED (
            -- Uma linha por item vendido: pago = o que a cliente pagou por UMA peca (preco menos o rateio do cupom);
            -- dinheiro_dev = o dinheiro devolvido por este item pelas devolucoes, nunca acima do que o item pagou.
            -- A consulta de baixo sai DAQUI (produto, dia e status do pedido vem junto): juntar de novo pelo item_id deixava o planejador sem estatistica da CTE e ele refazia a conta por linha.
            SELECT oi.id AS item_id,
                   oi.order_id,
                   oi.product_id,
                   o.created_at AS criado_em,
                   o.payment_status AS pst,
                   oi.quantity AS q,
                   pg.pago,
                   LEAST(oi.quantity, COALESCE(dv.devolvidas, 0))::int AS devolvidas,
                   LEAST(oi.quantity, COALESCE(dv.reestocadas, 0))::int AS reestocadas,
                   LEAST(oi.quantity * pg.pago, COALESCE(dv.dinheiro, 0)) AS dinheiro_dev
              FROM public.marketplace_order_items oi
              JOIN public.marketplace_orders o ON o.id = oi.order_id
              CROSS JOIN LATERAL (SELECT oi.price - CASE
                        WHEN COALESCE(o.discount, 0) <= 0 THEN 0
                        ELSE oi.price * LEAST(1, GREATEST(0, COALESCE(o.discount, 0)) / NULLIF(
                            (SELECT SUM(desconto_item.quantity * desconto_item.price)
                               FROM public.marketplace_order_items desconto_item
                              WHERE desconto_item.order_id = o.id), 0))
                    END AS pago) pg
              LEFT JOIN dev_item dv ON dv.order_item_id = oi.id
             WHERE o.status NOT IN ('cancelled', 'returned')
               AND (o.payment_status IN ('pago', 'pago_apos_expirar', 'recebido_na_entrega', 'estornado'))
               AND o.created_at >= now() - (p_limit_days || ' days')::interval - interval '1 day'
        ),
        sobra AS MATERIALIZED (
            -- Dinheiro devolvido que NAO tem peca por tras, por pedido, e quanto dele cai em cada item (taxa de 0 a 1 do que o item ainda pagou).
            -- residual = ESTORNO SEM devolucao ("cortesia"): o que o Mercado Pago confirmou devolvido (valor_estornado) menos o que foi devolvido POR uma devolucao
            -- concluida (a linha de order_refunds ligada em devolucoes.refund_id: esse dinheiro ja entra pelo dinheiro_dev). Nunca abaixo de zero.
            -- excesso = o que uma devolucao devolveu alem do valor das pecas dela. folga = o que os itens do pedido ainda pagaram depois do dinheiro das devolucoes:
            -- e' entre eles que o residual e o excesso se repartem (proporcional), sem passar do que cada um pagou. Dinheiro que sobrar sem item para receber nao e' lucro de produto
            -- (o frete devolvido, por exemplo). Pedido 'estornado' (devolvido por inteiro) fica com a folga toda: o Financeiro o conta como pago e devolvido.
            SELECT t.order_id,
                   CASE WHEN t.estornado THEN 1
                        ELSE LEAST(1, COALESCE((t.residual + t.excesso) / NULLIF(t.folga, 0), 0)) END AS taxa
              FROM (
            SELECT so.id AS order_id,
                   so.payment_status = 'estornado' AS estornado,
                   GREATEST(0, COALESCE(so.valor_estornado, 0) - COALESCE((
                       SELECT SUM(rf.amount)
                         FROM public.order_refunds rf
                        WHERE rf.order_id = so.id
                          AND rf.status = 'concluido'
                          AND EXISTS (SELECT 1 FROM public.devolucoes dv_lig
                                       WHERE dv_lig.refund_id = rf.id
                                         AND dv_lig.order_id = so.id)), 0)
                       -- Devolvido pelo painel do Mercado Pago: a linha ligada a devolucao falhou/foi recusada (ou a lojista marcou
                       -- "ja devolvi por fora", que solta o refund_id) e o webhook gravou OUTRA linha 'sistema' concluida depois da
                       -- conclusao (o mesmo criterio de reemitir_reembolso_da_devolucao). valor_estornado ja soma essa linha, mas o dinheiro
                       -- saiu POR uma devolucao: sai do lucro pelas pecas devolvidas, nao de novo como cortesia. Limitado ao que o painel
                       -- de fato devolveu (soma das linhas 'sistema'); sem essa linha, nada se desconta (ligada 'solicitado' continua cortesia).
                       - COALESCE((
                       SELECT LEAST(g.valor, COALESCE((
                                  SELECT SUM(sp.amount)
                                    FROM public.order_refunds sp
                                   WHERE sp.order_id = so.id
                                     AND sp.solicitado_por = 'sistema'
                                     AND sp.status = 'concluido'
                                     AND sp.mp_chargeback_id IS NULL
                                     AND sp.created_at >= g.desde), 0))
                         FROM (SELECT SUM(dvp.valor_reembolso) AS valor,
                                      MIN(COALESCE(dvp.concluida_em, dvp.updated_at)) AS desde
                                 FROM public.devolucoes dvp
                                 LEFT JOIN public.order_refunds rlp ON rlp.id = dvp.refund_id
                                WHERE dvp.order_id = so.id
                                  AND dvp.status = 'concluida'
                                  AND dvp.resolucao_final = 'reembolso'
                                  AND dvp.valor_reembolso > 0
                                  AND ((dvp.refund_id IS NULL AND dvp.reembolso_manual)
                                       OR rlp.status IN ('falhou', 'recusado'))) g
                        WHERE g.valor IS NOT NULL), 0)) AS residual,
                   COALESCE(ex.excesso, 0) AS excesso,
                   COALESCE(pf.folga, 0) AS folga
              FROM public.marketplace_orders so
              LEFT JOIN (SELECT dd.order_id, SUM(dd.excesso) AS excesso FROM devs dd GROUP BY dd.order_id) ex ON ex.order_id = so.id
              LEFT JOIN (SELECT px.order_id, SUM(px.q * px.pago - px.dinheiro_dev) AS folga FROM pecas px GROUP BY px.order_id) pf ON pf.order_id = so.id
             WHERE (COALESCE(so.valor_estornado, 0) > 0
                    OR so.payment_status = 'estornado'
                    OR ex.order_id IS NOT NULL)
               AND so.status NOT IN ('cancelled', 'returned')
               AND (so.payment_status IN ('pago', 'pago_apos_expirar', 'recebido_na_entrega', 'estornado'))
                   AND so.created_at >= now() - (p_limit_days || ' days')::interval - interval '1 day') t
        ),
        daily_items AS (
            SELECT
                (pc.criado_em AT TIME ZONE 'America/Sao_Paulo')::date AS day,
                -- Lucro só dos itens com custo conhecido (custo IS NOT NULL; custo 0 é zero medido e conta): sem custo, a venda inteira virava lucro (20261234000000).
                -- O custo de cada item é o do DIA da venda (marketplace_order_item_custo, 20261242000000); venda sem registro usa o custo de hoje do produto.
                -- Lucro do produto no dia da VENDA, a mesma conta do ranking "Produtos que mais dão lucro" e do Financeiro, pedido a pedido (20261399995000):
                -- o que a cliente pagou pela peça (já com o cupom) - TODO o dinheiro devolvido (devolução, estorno ou Mercado Pago) - o custo das peças que saíram e NÃO voltaram à prateleira. Sem frete.
                -- Pedido 'estornado' (devolvido por inteiro) entra com -custo das peças que não voltaram; só o cancelado continua fora. A linha de faturamento, os pedidos e o custo vendido seguem como eram.
                COALESCE(SUM(pc.q * (pc.pago - COALESCE(oic.custo, p.custo)) + COALESCE(oic.custo, p.custo) * pc.reestocadas - pc.dinheiro_dev
                    - (pc.q * pc.pago - pc.dinheiro_dev) * COALESCE(s.taxa, 0)) FILTER (WHERE COALESCE(oic.custo, p.custo) IS NOT NULL), 0) AS profit,
                COALESCE(SUM(pc.q * COALESCE(oic.custo, p.custo, 0)) FILTER (WHERE pc.pst <> 'estornado'), 0) AS cost_sold
            FROM pecas pc
            JOIN public.produtos p ON pc.product_id = p.id
            LEFT JOIN public.marketplace_order_item_custo oic ON oic.item_id = pc.item_id
            LEFT JOIN sobra s ON s.order_id = pc.order_id
            GROUP BY ((pc.criado_em AT TIME ZONE 'America/Sao_Paulo')::date)
        )
        SELECT
            TO_CHAR(d.day, 'YYYY-MM-DD') AS date,
            TO_CHAR(d.day, 'DD/MM') AS full_date,
            COALESCE(dor.revenue, 0) AS revenue,
            COALESCE(dor.orders, 0) AS orders,
            COALESCE(dit.profit, 0) AS profit,
            COALESCE(dit.cost_sold, 0) AS cost_sold
        FROM days d
        LEFT JOIN daily_orders dor ON d.day = dor.day
        LEFT JOIN daily_items dit ON d.day = dit.day
        ORDER BY d.day ASC
    ) h;

    -- 5. Top Products (All time)
    -- Lucro do produto, pedido a pedido como o Financeiro (20261399995000): o que a cliente pagou pela peça (já com o cupom) - TODO o dinheiro devolvido
    -- (devolução, estorno ou Mercado Pago, só de produto, sem frete) - o custo das peças que saíram e NÃO voltaram à prateleira. A quantidade do ranking é vendidas - devolvidas.
    -- Pedido 'estornado' (devolvido por inteiro) entra; só o cancelado (sem a venda) continua fora.
    SELECT json_agg(p)
    INTO top_prods
    FROM (
        WITH
        devs AS MATERIALIZED (
            -- DINHEIRO de cada devolucao CONCLUIDA com reembolso ou vale (troca NAO conta: a peca sai de novo), em reais de PRODUTO (sem o frete de ida) (20261399995000).
            -- vv = valor das pecas que voltaram (toda condicao menos 'ausente'); va = valor das pecas 'Nao veio' (ficaram com a cliente).
            -- pm = o dinheiro devolvido: reembolso = valor_reembolso menos o frete de ida (devolucao de reembolso SEM valor gravado = o das pecas que voltaram, como era antes);
            -- vale = 0 (20261659000000): o vale-troca e' credito na loja, nao dinheiro que saiu; como no Financeiro, a venda da peca fica no lucro
            -- e as pecas do vale seguem na quantidade devolvida e no custo que volta (reestocadas). Antes era o valor das pecas que voltaram.
            -- fv / fa = a fracao do valor de cada peca que esse dinheiro cobriu: primeiro as pecas que voltaram, so depois as 'Nao veio'.
            -- excesso = o que passou do valor de todas as pecas da devolucao: vai para o rateio do pedido (como o estorno sem devolucao).
            SELECT dv.id AS devolucao_id,
                   dv.order_id,
                   CASE WHEN x.vv > 0 THEN LEAST(m.pm, x.vv) / x.vv ELSE 0 END AS fv,
                   CASE WHEN x.va > 0 THEN LEAST(GREATEST(m.pm - x.vv, 0), x.va) / x.va ELSE 0 END AS fa,
                   GREATEST(0, m.pm - x.vv - x.va) AS excesso
              FROM public.devolucoes dv
              CROSS JOIN LATERAL (SELECT COALESCE(SUM(dx.quantidade * dx.valor_unitario) FILTER (WHERE dx.condicao IS DISTINCT FROM 'ausente'), 0) AS vv,
                                         COALESCE(SUM(dx.quantidade * dx.valor_unitario) FILTER (WHERE dx.condicao = 'ausente'), 0) AS va
                                    FROM public.devolucao_itens dx
                                   WHERE dx.devolucao_id = dv.id) x
              CROSS JOIN LATERAL (SELECT CASE WHEN dv.resolucao_final = 'vale' THEN 0
                                              WHEN dv.resolucao_final = 'reembolso' AND dv.valor_reembolso IS NOT NULL
                                              THEN GREATEST(0, dv.valor_reembolso - COALESCE(dv.valor_frete_ida, 0))
                                              ELSE x.vv END AS pm) m
             WHERE dv.status = 'concluida'
               AND dv.resolucao_final IN ('reembolso', 'vale')
        ),
        dev_item AS (
            -- O que as devolucoes concluidas fizeram com CADA item vendido, numa passada so (agrupado por item):
            -- pecas devolvidas que voltaram (sem as 'Nao veio'), as que voltaram a PRATELEIRA (reestocado_em preenchido: so o custo delas e' devolvido ao lucro)
            -- e o dinheiro que as devolucoes devolveram POR este item (fv/fa de cada devolucao).
            SELECT di.order_item_id,
                   COALESCE(SUM(di.quantidade) FILTER (WHERE di.condicao IS DISTINCT FROM 'ausente'), 0) AS devolvidas,
                   COALESCE(SUM(di.quantidade) FILTER (WHERE di.reestocado_em IS NOT NULL AND di.condicao IS DISTINCT FROM 'ausente'), 0) AS reestocadas,
                   COALESCE(SUM(di.quantidade * di.valor_unitario * CASE WHEN di.condicao = 'ausente' THEN d.fa ELSE d.fv END), 0) AS dinheiro
              FROM public.devolucao_itens di
              JOIN devs d ON d.devolucao_id = di.devolucao_id
             GROUP BY di.order_item_id
        ),
        pecas AS MATERIALIZED (
            -- Uma linha por item vendido: pago = o que a cliente pagou por UMA peca (preco menos o rateio do cupom);
            -- dinheiro_dev = o dinheiro devolvido por este item pelas devolucoes, nunca acima do que o item pagou.
            -- A consulta de baixo sai DAQUI (produto, dia e status do pedido vem junto): juntar de novo pelo item_id deixava o planejador sem estatistica da CTE e ele refazia a conta por linha.
            SELECT oi.id AS item_id,
                   oi.order_id,
                   oi.product_id,
                   o.created_at AS criado_em,
                   o.payment_status AS pst,
                   oi.quantity AS q,
                   pg.pago,
                   LEAST(oi.quantity, COALESCE(dv.devolvidas, 0))::int AS devolvidas,
                   LEAST(oi.quantity, COALESCE(dv.reestocadas, 0))::int AS reestocadas,
                   LEAST(oi.quantity * pg.pago, COALESCE(dv.dinheiro, 0)) AS dinheiro_dev
              FROM public.marketplace_order_items oi
              JOIN public.marketplace_orders o ON o.id = oi.order_id
              CROSS JOIN LATERAL (SELECT oi.price - CASE
                        WHEN COALESCE(o.discount, 0) <= 0 THEN 0
                        ELSE oi.price * LEAST(1, GREATEST(0, COALESCE(o.discount, 0)) / NULLIF(
                            (SELECT SUM(desconto_item.quantity * desconto_item.price)
                               FROM public.marketplace_order_items desconto_item
                              WHERE desconto_item.order_id = o.id), 0))
                    END AS pago) pg
              LEFT JOIN dev_item dv ON dv.order_item_id = oi.id
             WHERE o.status NOT IN ('cancelled', 'returned')
               AND (o.payment_status IN ('pago', 'pago_apos_expirar', 'recebido_na_entrega', 'estornado'))
        ),
        sobra AS MATERIALIZED (
            -- Dinheiro devolvido que NAO tem peca por tras, por pedido, e quanto dele cai em cada item (taxa de 0 a 1 do que o item ainda pagou).
            -- residual = ESTORNO SEM devolucao ("cortesia"): o que o Mercado Pago confirmou devolvido (valor_estornado) menos o que foi devolvido POR uma devolucao
            -- concluida (a linha de order_refunds ligada em devolucoes.refund_id: esse dinheiro ja entra pelo dinheiro_dev). Nunca abaixo de zero.
            -- excesso = o que uma devolucao devolveu alem do valor das pecas dela. folga = o que os itens do pedido ainda pagaram depois do dinheiro das devolucoes:
            -- e' entre eles que o residual e o excesso se repartem (proporcional), sem passar do que cada um pagou. Dinheiro que sobrar sem item para receber nao e' lucro de produto
            -- (o frete devolvido, por exemplo). Pedido 'estornado' (devolvido por inteiro) fica com a folga toda: o Financeiro o conta como pago e devolvido.
            SELECT t.order_id,
                   CASE WHEN t.estornado THEN 1
                        ELSE LEAST(1, COALESCE((t.residual + t.excesso) / NULLIF(t.folga, 0), 0)) END AS taxa
              FROM (
            SELECT so.id AS order_id,
                   so.payment_status = 'estornado' AS estornado,
                   GREATEST(0, COALESCE(so.valor_estornado, 0) - COALESCE((
                       SELECT SUM(rf.amount)
                         FROM public.order_refunds rf
                        WHERE rf.order_id = so.id
                          AND rf.status = 'concluido'
                          AND EXISTS (SELECT 1 FROM public.devolucoes dv_lig
                                       WHERE dv_lig.refund_id = rf.id
                                         AND dv_lig.order_id = so.id)), 0)
                       -- Devolvido pelo painel do Mercado Pago: a linha ligada a devolucao falhou/foi recusada (ou a lojista marcou
                       -- "ja devolvi por fora", que solta o refund_id) e o webhook gravou OUTRA linha 'sistema' concluida depois da
                       -- conclusao (o mesmo criterio de reemitir_reembolso_da_devolucao). valor_estornado ja soma essa linha, mas o dinheiro
                       -- saiu POR uma devolucao: sai do lucro pelas pecas devolvidas, nao de novo como cortesia. Limitado ao que o painel
                       -- de fato devolveu (soma das linhas 'sistema'); sem essa linha, nada se desconta (ligada 'solicitado' continua cortesia).
                       - COALESCE((
                       SELECT LEAST(g.valor, COALESCE((
                                  SELECT SUM(sp.amount)
                                    FROM public.order_refunds sp
                                   WHERE sp.order_id = so.id
                                     AND sp.solicitado_por = 'sistema'
                                     AND sp.status = 'concluido'
                                     AND sp.mp_chargeback_id IS NULL
                                     AND sp.created_at >= g.desde), 0))
                         FROM (SELECT SUM(dvp.valor_reembolso) AS valor,
                                      MIN(COALESCE(dvp.concluida_em, dvp.updated_at)) AS desde
                                 FROM public.devolucoes dvp
                                 LEFT JOIN public.order_refunds rlp ON rlp.id = dvp.refund_id
                                WHERE dvp.order_id = so.id
                                  AND dvp.status = 'concluida'
                                  AND dvp.resolucao_final = 'reembolso'
                                  AND dvp.valor_reembolso > 0
                                  AND ((dvp.refund_id IS NULL AND dvp.reembolso_manual)
                                       OR rlp.status IN ('falhou', 'recusado'))) g
                        WHERE g.valor IS NOT NULL), 0)) AS residual,
                   COALESCE(ex.excesso, 0) AS excesso,
                   COALESCE(pf.folga, 0) AS folga
              FROM public.marketplace_orders so
              LEFT JOIN (SELECT dd.order_id, SUM(dd.excesso) AS excesso FROM devs dd GROUP BY dd.order_id) ex ON ex.order_id = so.id
              LEFT JOIN (SELECT px.order_id, SUM(px.q * px.pago - px.dinheiro_dev) AS folga FROM pecas px GROUP BY px.order_id) pf ON pf.order_id = so.id
             WHERE (COALESCE(so.valor_estornado, 0) > 0
                    OR so.payment_status = 'estornado'
                    OR ex.order_id IS NOT NULL)
               AND so.status NOT IN ('cancelled', 'returned')
               AND (so.payment_status IN ('pago', 'pago_apos_expirar', 'recebido_na_entrega', 'estornado'))) t
        )
        SELECT
            p.id as id,
            p.nome AS name,
            SUM(pc.q - pc.devolvidas)::int as quantity,
            SUM(pc.q * (pc.pago - COALESCE(oic.custo, p.custo)) + COALESCE(oic.custo, p.custo) * pc.reestocadas - pc.dinheiro_dev
                    - (pc.q * pc.pago - pc.dinheiro_dev) * COALESCE(s.taxa, 0)) as total,
            COALESCE(p.imagem_url, '') as image
        FROM pecas pc
        JOIN public.produtos p ON p.id = pc.product_id
        LEFT JOIN public.marketplace_order_item_custo oic ON oic.item_id = pc.item_id
        LEFT JOIN sobra s ON s.order_id = pc.order_id
        WHERE p.deleted_at IS NULL
        -- Só item com custo conhecido (o do dia da venda, ou o de hoje do produto): sem custo o ranking de LUCRO empatava com a receita (20261234000000, 20261242000000).
        AND COALESCE(oic.custo, p.custo) IS NOT NULL
        GROUP BY p.id, p.nome, p.imagem_url
        ORDER BY total DESC
        LIMIT 5
    ) p;

    -- 5b. Produtos vendidos (mesma regra de venda do top 5) que ficaram FORA do lucro por não terem custo (20261234000000): venda sem custo do dia e produto sem custo hoje (20261242000000).
    SELECT COUNT(DISTINCT p.id)
    INTO products_without_cost
    FROM public.produtos p
    JOIN public.marketplace_order_items oi ON p.id = oi.product_id
    JOIN public.marketplace_orders o ON oi.order_id = o.id
    LEFT JOIN public.marketplace_order_item_custo oic ON oic.item_id = oi.id
    WHERE o.status NOT IN ('cancelled', 'returned')
    AND (o.payment_status IN ('pago', 'pago_apos_expirar', 'recebido_na_entrega'))
    AND p.deleted_at IS NULL
    AND COALESCE(oic.custo, p.custo) IS NULL;

    -- 6. Dinheiro reconhecido fora da regra de status (achados 2 e 3)
    SELECT COUNT(*) INTO delivered_total
    FROM public.marketplace_orders
    WHERE status = 'delivered';

    SELECT COUNT(*) INTO paid_on_cancelled
    FROM public.marketplace_orders
    WHERE payment_status IN ('pago', 'pago_apos_expirar', 'recebido_na_entrega') AND status = 'cancelled';

    -- BUILD FINAL OBJECT (Matching DashboardStats interface 100%)
    result := json_build_object(
        'today', json_build_object(
            'revenue', today_revenue,
            'count', today_count,
            'pending', today_pending,
            'revenueTrend', round(today_rev_trend, 1),
            'countTrend', round(today_count_trend, 1)
        ),
        'month', json_build_object(
            'revenue', month_revenue,
            'count', month_count,
            'revenueTrend', round(month_rev_trend, 1),
            'countTrend', round(month_count_trend, 1)
        ),
        'executive', json_build_object(
            'totalRevenue', total_rev,
            'totalOrders', total_ord,
            'revenueTrend', 0,
            'ordersTrend', 0,
            'avgTicket', round(avg_ticket, 2),
            'avgTicketTrend', 0,
            'activeCustomers', active_customers,
            'activeCustomersTrend', 0
        ),
        'revenueHistory', COALESCE(rev_history, '[]'::json),
        'topProducts', COALESCE(top_prods, '[]'::json),
        'inventoryAlerts', low_stock_count,
        'growth', round(month_rev_trend, 1),
        'inventory', json_build_object(
            'totalCost', inv_cost_total,
            'totalValue', inv_value_total,
            'totalRevenue', inv_revenue_total,
            'revenueWithoutCost', inv_revenue_without_cost,
            'productsWithoutCost', inv_products_without_cost,
            'productsWithCost', inv_products_with_cost
        ),
        'averageTicket', round(avg_ticket, 2),
        'deliveredTotal', delivered_total,
        'paidOnCancelled', paid_on_cancelled,
        'productsWithoutCost', products_without_cost
    );

    RETURN result;
END;
$$;

DROP FUNCTION public.admin_devolucao_confirmar_dois_reembolsos(uuid,uuid);
DROP FUNCTION public.admin_devolucao_confirmar_mesmo_dinheiro(uuid,uuid);
DROP FUNCTION public.order_refund__suspeitas_do_pedido(uuid);
DROP FUNCTION public.order_refund__valor_coberto_por_fora(uuid);
ALTER TABLE public.order_refund_prova DROP COLUMN devolucao_id;
ALTER TABLE public.order_refunds DROP COLUMN cobre_devolucao_id, DROP COLUMN dobro_conferido_em;

DO $conferencia_rollback_1664$
DECLARE
  r record;
  v_oid oid;
BEGIN
  FOR r IN SELECT * FROM (VALUES
    ('public.fin__movimentos(date,date)', '26473edd94ad6547d95de43433088304'),
    ('public.pedido__saldo_a_estornar(uuid)', '99741b4cdbf1e8d8340f80440e6da094'),
    ('public.admin_devolucao_reembolso_por_fora_apos_espera(uuid,uuid,text)', '92dd1608d02ef5e9fd9fe34e0bd7c49f'),
    ('public.pedido_reembolsos_e_saldo(uuid)', '86dd0eaaaa571a4d5e85622e90442bc0'),
    ('public.get_admin_analytics_v2(integer)', '1624212a7096b6f49a80370b30191a15')
  ) AS esperado(fn, h)
  LOOP
    v_oid := to_regprocedure(r.fn);
    IF NOT EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid = v_oid
         AND md5(replace(p.prosrc, chr(13), '')) = r.h
         AND (to_jsonb(p) - 'prosrc') = current_setting('ikcous.conciliacao1664_' || v_oid)::jsonb) THEN
      RAISE EXCEPTION 'B2_POSTFLIGHT_FAILED: o rollback não restaurou % sem alterar atributos.', r.fn;
    END IF;
  END LOOP;
END $conferencia_rollback_1664$;

NOTIFY pgrst, 'reload schema';
