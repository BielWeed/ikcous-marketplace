-- Rollback manual da 20261664000000 (o reembolso por fora não conta duas vezes). Devolve, byte a byte (LF), mantendo
-- OID, dono, atributos e ACL:
--   fin__movimentos -> corpo da 20261391200000
-- Não toca em dados: nenhuma linha foi escrita pela 20261664000000 (ela só muda uma função de leitura), então não há o
-- que desfazer nelas.
-- ATENÇÃO: reabre o defeito (o reembolso resolvido por fora e a linha do Mercado Pago do mesmo dinheiro voltam a sair
-- duas vezes no Financeiro e no resultado).
-- O pré-voo exige o corpo da 20261664000000: segundo rollback ou sucessora desconhecida recusa.
-- Sem controle de transação: o aplicador fornece a transação inteira.

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

DO $preflight_rollback_20261664000000$
DECLARE
  v_fn CONSTANT text := 'public.fin__movimentos(date,date)';
  v_oid oid := to_regprocedure('public.fin__movimentos(date,date)');
  r record;
  v_hash text;
  v_atributos jsonb;
BEGIN
  IF v_oid IS NULL THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: % não existe.', v_fn;
  END IF;
  IF (SELECT count(*) FROM pg_proc p
       WHERE p.pronamespace = 'public'::regnamespace AND p.proname = 'fin__movimentos') <> 1 THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: fin__movimentos tem sobrecarga em public — meça a loja e revise.';
  END IF;

  FOR r IN SELECT * FROM (VALUES
    ('fin__movimentos', '26473edd94ad6547d95de43433088304', '04fc43fd9e3e7f4b44cb9e4c2a866ae3')
  ) AS esperado(nome, hash_vigente, hash_desta)
  LOOP
    SELECT md5(replace(p.prosrc, E'\r', '')), to_jsonb(p) - 'prosrc'
      INTO v_hash, v_atributos
      FROM pg_proc p WHERE p.oid = v_oid;
    IF v_hash IS DISTINCT FROM r.hash_desta THEN
      RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: corpo vivo de % (hash %) não é o da 20261664000000; revise antes de desfazer.', v_fn, COALESCE(v_hash, 'ausente');
    END IF;
  END LOOP;

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
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: atributos de % (linguagem, SECURITY INVOKER, volatilidade, search_path, argumentos ou retorno) não são os conhecidos — revise antes de desfazer.', v_fn;
  END IF;

  -- Ninguém de fora chama direto: só as RPCs fin_* (SECURITY DEFINER) e o service_role.
  IF EXISTS (SELECT 1 FROM pg_proc p
               CROSS JOIN LATERAL aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) g
              WHERE p.oid = v_oid AND g.privilege_type = 'EXECUTE' AND g.grantee = 0)
     OR has_function_privilege('anon', v_oid, 'EXECUTE')
     OR has_function_privilege('authenticated', v_oid, 'EXECUTE') THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: ACL de % não é a conhecida (PUBLIC, anon ou authenticated executam) — revise antes de desfazer.', v_fn;
  END IF;

  -- Fotografia de OID, dono, ACL e TODOS os atributos: o CREATE OR REPLACE só pode trocar prosrc.
  PERFORM set_config('ikcous.porfora1664rb_atributos', v_atributos::text, true);
END $preflight_rollback_20261664000000$;

-- fin__movimentos: o corpo da 20261391200000, byte a byte.
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

DO $conferencia_rollback_20261664000000$
DECLARE
  v_fn CONSTANT text := 'public.fin__movimentos(date,date)';
  v_oid oid := to_regprocedure('public.fin__movimentos(date,date)');
  v_hash text;
BEGIN
  IF v_oid IS NULL THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: conferencia do rollback 20261664000000: % sumiu', v_fn;
  END IF;
  IF (SELECT count(*) FROM pg_proc p
       WHERE p.pronamespace = 'public'::regnamespace AND p.proname = 'fin__movimentos') <> 1 THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: conferencia do rollback 20261664000000: fin__movimentos ficou com sobrecarga';
  END IF;
  SELECT md5(replace(prosrc, E'\r', '')) INTO v_hash FROM pg_proc WHERE oid = v_oid;
  IF v_hash IS DISTINCT FROM '26473edd94ad6547d95de43433088304' THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: conferencia do rollback 20261664000000: corpo vivo de % (hash %) não é o esperado', v_fn, COALESCE(v_hash, 'ausente');
  END IF;
  IF NOT EXISTS (
       SELECT 1 FROM pg_proc p
        WHERE p.oid = v_oid
          AND (to_jsonb(p) - 'prosrc') = current_setting('ikcous.porfora1664rb_atributos')::jsonb
     ) THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: conferencia do rollback 20261664000000: atributos, dono ou ACL de % mudaram (só o corpo podia mudar)', v_fn;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_proc p
               CROSS JOIN LATERAL aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) g
              WHERE p.oid = v_oid AND g.privilege_type = 'EXECUTE' AND g.grantee = 0)
     OR has_function_privilege('anon', v_oid, 'EXECUTE')
     OR has_function_privilege('authenticated', v_oid, 'EXECUTE') THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: conferencia do rollback 20261664000000: % ficou alcançável por PUBLIC, anon ou authenticated', v_fn;
  END IF;
END $conferencia_rollback_20261664000000$;

NOTIFY pgrst, 'reload schema';
