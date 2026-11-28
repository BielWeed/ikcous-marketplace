-- O REEMBOLSO POR FORA NÃO CONTA DUAS VEZES (caça de 28/11/2026, base ceb424da2; dinheiro, lote 220).
--
-- O DEFEITO. O Financeiro (public.fin__movimentos, corpo vivo da 20261391200000) podia descontar o MESMO reembolso duas
-- vezes:
--   1. o reembolso da devolução pelo app (Mercado Pago) falha ou é recusado;
--   2. a lojista devolve os R$ 30 direto no painel do Mercado Pago;
--   3. ela marca "resolvido por fora do app" (admin_devolucao_reembolso_por_fora, 20261241000000): a devolução fica com
--      refund_id NULL e reembolso_manual = true, e o Financeiro passa a mostrar a linha 'devolucao' de R$ 30;
--   4. o aviso do MP chega a registrar_estorno_externo_do_mp (20261196000000), que grava a SUA linha 'sistema'
--      concluída de R$ 30 (o saldo que ela confere não olha reembolso manual — e não deve: ela é o registro do que o MP
--      fez, e esta migration não a toca);
--   5. o Financeiro lista as duas (a linha 'estorno' e a linha 'devolucao'), e fin_dre (20261405900000) desconta as
--      duas. Venda de R$ 100 com custo R$ 40 e R$ 30 devolvidos: lucro bruto R$ 0 em vez de R$ 30. O ranking de lucro
--      (get_admin_analytics_v2, 20261659000000) já não contava duas vezes: o Financeiro e o ranking discordavam.
--
-- A REGRA (a mesma do ranking, "já devolvi por fora"). Por pedido: por_fora = soma de valor_reembolso das devoluções
-- concluídas com resolução 'reembolso', valor > 0, refund_id NULL e reembolso_manual; desde = a primeira conclusão delas
-- (COALESCE(concluida_em, updated_at)). Cada linha 'sistema' concluída (concluido_em preenchido), fora de contestação
-- (mp_chargeback_id NULL) e nascida em created_at >= desde, em ordem de chegada (created_at, id), conta só o que o
-- reembolso por fora ainda NÃO contou: a soma do que se tira por pedido é LEAST(por_fora, soma dessas linhas), igual ao
-- ranking. A linha 'estorno' sai com o resto (some se o resto é zero) e a saída 'estorno_externo' (pedido 'estornado')
-- desconta o reembolso por fora MENOS o que já foi contado pela linha 'sistema' (valor_estornado já a soma), senão o
-- "Já estornei" do resto ficaria pequeno demais. Casos:
--   * por fora R$ 30 + linha do MP R$ 30 depois: sai R$ 30 uma vez (o defeito);
--   * dois reembolsos diferentes (devolução de R$ 30 pelo app + R$ 70 pelo painel do MP; ou linha do MP ANTES da
--     conclusão da devolução por fora): os dois saem;
--   * só por fora, ou só pelo MP: sai o valor, como antes.
-- O LIMITE DA REGRA (o mesmo do ranking, aceito de propósito): uma linha 'sistema' nascida depois da conclusão de um
-- reembolso por fora é tratada como o mesmo dinheiro até o valor dele; o banco não guarda qual refund do MP pagou a
-- devolução por fora.
--
-- O QUE NÃO MUDA. Linhas de venda, de lançamento manual, de devolução, de estorno do app (lojista/cliente) e de
-- contestação, datas, contas, categorias, descrições, status e ids; assinatura, retorno, LANGUAGE sql STABLE, SECURITY
-- INVOKER, search_path, dono, OID e ACL (nenhum GRANT nem REVOKE). Os dois marcadores que a consulta 1b confere para a
-- 20261177000000 e os do db-apply para a 20261391200000 seguem UMA vez cada. registrar_estorno_externo_do_mp e
-- pedido__saldo_a_estornar não mudam.
--
-- DADOS EXISTENTES. Nenhuma linha é lida para reescrita nem apagada: só o corpo de UMA função de LEITURA muda (CREATE OR
-- REPLACE). O extrato é derivado na hora da leitura, então pedidos antigos com o reembolso contado duas vezes passam a
-- mostrar o valor uma vez só (e o resultado dos meses passados muda junto, para o certo).
--
-- IDEMPOTÊNCIA. O pré-voo aceita o corpo vigente (o da 20261391200000) OU o desta migration (hash do prosrc sem CR) e
-- confere sobrecarga, atributos, ACL e as colunas que o corpo lê; reaplicar deixa o mesmo estado. Corpo desconhecido
-- recusa com B1_BASELINE_DIVERGENT antes de escrever. A conferência final exige o hash desta e OID, dono, ACL e todos os
-- atributos iguais aos fotografados no pré-voo.
--
-- COMO APLICAR. Pelo aplicar-migrations.yml (ou node scripts/db-apply.cjs <este arquivo>). Sem BEGIN/COMMIT de nível
-- superior neste arquivo, regra da casa (AGENTS.md): o aplicador fornece a transação inteira, e uma falha no meio não
-- grava metade. lock_timeout de 5s: com o Financeiro em uso, falha limpa em vez de travar a loja; repetir depois. ORDEM:
-- depois da 20261391200000 (o pré-voo recusa o corpo anterior a ela). Front não muda.
-- FICHA DE VERIFICAÇÃO (só leitura, só catálogo): consultas 220a (depois) e 220b (antes) em scripts/publicacao/consultas/;
-- comportamento em tests/banco/o-reembolso-por-fora-nao-conta-duas-vezes-viva.cjs (somente Postgres efêmero do CI).
-- ROLLBACK MANUAL: rollback-manual-20261664000000_o_reembolso_por_fora_nao_conta_duas_vezes.sql devolve o corpo da 20261391200000 byte a byte
-- (LF); recusa corpo desconhecido e segundo rollback. Reabre o defeito. Nenhuma linha é removida ou reescrita.
--
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

DO $preflight_20261664000000$
DECLARE
  v_fn CONSTANT text := 'public.fin__movimentos(date,date)';
  v_oid oid := to_regprocedure('public.fin__movimentos(date,date)');
  r record;
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

  FOR r IN SELECT * FROM (VALUES
    ('fin__movimentos', '26473edd94ad6547d95de43433088304', '04fc43fd9e3e7f4b44cb9e4c2a866ae3')
  ) AS esperado(nome, hash_vigente, hash_desta)
  LOOP
    SELECT md5(replace(p.prosrc, E'\r', '')), to_jsonb(p) - 'prosrc'
      INTO v_hash, v_atributos
      FROM pg_proc p WHERE p.oid = v_oid;
    IF v_hash IS NULL OR v_hash NOT IN (r.hash_vigente, r.hash_desta) THEN
      RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: corpo vivo de % (hash %) não é o vigente (o da 20261391200000) nem o desta migration — capture o corpo vivo e revise antes de aplicar.', v_fn, COALESCE(v_hash, 'ausente');
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

  -- Uma função LANGUAGE sql é validada ao ser criada: o que o corpo lê tem de existir (inclusive o que esta lê de novo).
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
      SELECT x.tabela || '.' || x.coluna
        FROM (VALUES ('devolucoes', 'resolucao_final'), ('devolucoes', 'refund_id'),
                     ('devolucoes', 'reembolso_manual'), ('devolucoes', 'valor_reembolso'),
                     ('devolucoes', 'concluida_em'), ('devolucoes', 'updated_at'),
                     ('order_refunds', 'solicitado_por'), ('order_refunds', 'mp_chargeback_id'),
                     ('order_refunds', 'created_at'), ('order_refunds', 'concluido_em'),
                     ('marketplace_order_payment_history', 'order_id'),
                     ('marketplace_order_payment_history', 'acao'),
                     ('marketplace_order_payment_history', 'payment_status_antes'),
                     ('marketplace_order_payment_history', 'payment_status_depois')) AS x(tabela, coluna)
       WHERE to_regclass('public.' || x.tabela) IS NOT NULL
         AND NOT EXISTS (SELECT 1 FROM pg_attribute a
                          WHERE a.attrelid = to_regclass('public.' || x.tabela)
                            AND a.attname = x.coluna AND NOT a.attisdropped)
    ) d;
  IF v_falta IS NOT NULL THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: o corpo lê o que não existe: % — aplique as migrations anteriores antes.', v_falta;
  END IF;

  -- Fotografia de OID, dono, ACL e TODOS os atributos: o CREATE OR REPLACE só pode trocar prosrc.
  PERFORM set_config('ikcous.porfora1664_atributos', v_atributos::text, true);
END $preflight_20261664000000$;

-- fin__movimentos: corpo vigente da 20261391200000 com SÓ a regra "já devolvi por fora" (por_fora e ja_coberto) na linha
-- 'estorno' e no desconto da saída 'estorno_externo'.
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
  ), por_fora AS (
    -- O reembolso de devolução resolvido POR FORA do app (20261664000000): a linha 'devolucao' abaixo
    -- já tira esse dinheiro. Se a lojista o devolveu pelo painel do Mercado Pago, o aviso do MP grava
    -- DEPOIS da conclusão da devolução uma linha 'sistema' concluída (registrar_estorno_externo_do_mp)
    -- com o MESMO dinheiro. A régua é a do ranking de lucro (get_admin_analytics_v2, 20261659000000,
    -- "já devolvi por fora"): por pedido, a soma desses reembolsos e a primeira conclusão.
    SELECT dvp.order_id, sum(dvp.valor_reembolso) AS valor,
           min(COALESCE(dvp.concluida_em, dvp.updated_at)) AS desde
      FROM public.devolucoes dvp
     WHERE dvp.status = 'concluida'
       AND dvp.resolucao_final = 'reembolso'
       AND dvp.valor_reembolso > 0
       AND dvp.refund_id IS NULL AND dvp.reembolso_manual
     GROUP BY dvp.order_id
  ), ja_coberto AS (
    -- Quanto de CADA linha 'sistema' concluída (fora de contestação) nascida depois dessa conclusão o
    -- reembolso por fora já contou: em ordem de chegada, as linhas consomem o valor por fora até ele
    -- acabar. A soma por pedido é LEAST(por fora, linhas 'sistema'), a mesma do ranking.
    SELECT sp.id, sp.order_id,
           LEAST(sp.amount, GREATEST(0, pf.valor - COALESCE(sum(sp.amount) OVER (
             PARTITION BY sp.order_id ORDER BY sp.created_at, sp.id
             ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING), 0))) AS valor
      FROM public.order_refunds sp
      JOIN por_fora pf ON pf.order_id = sp.order_id
     WHERE sp.solicitado_por = 'sistema'
       AND sp.status = 'concluido' AND sp.concluido_em IS NOT NULL
       AND sp.mp_chargeback_id IS NULL
       AND sp.created_at >= pf.desde
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
           -- Só o que o reembolso por fora NÃO contou (ja_coberto, 20261664000000): o dinheiro sai uma vez.
           (r.amount - COALESCE(jc.valor, 0))::numeric,
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
      LEFT JOIN ja_coberto jc ON jc.id = r.id
     WHERE ((r.status = 'concluido' AND r.concluido_em IS NOT NULL)
        OR r.status IN ('solicitado', 'em_processamento'))
       AND r.amount > COALESCE(jc.valor, 0)
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
        -- Menos o que a linha 'sistema' já contou deste reembolso por fora (20261664000000): o
        -- valor_estornado já soma essa linha; descontar o reembolso inteiro de novo tiraria o mesmo
        -- dinheiro duas vezes da saída "estornado fora do app".
        SELECT sum(d.valor_reembolso)
               - COALESCE((SELECT sum(jc.valor) FROM ja_coberto jc WHERE jc.order_id = v.id), 0) AS valor
          FROM public.devolucoes d
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

-- CONFERÊNCIA no instante do apply: aborta se o corpo vivo não é o desta, se algum atributo, o dono ou a ACL mudou, ou se
-- a ACL abriu para PUBLIC, anon ou authenticated.
DO $conferencia_20261664000000$
DECLARE
  v_fn CONSTANT text := 'public.fin__movimentos(date,date)';
  v_oid oid := to_regprocedure('public.fin__movimentos(date,date)');
  v_hash text;
BEGIN
  IF v_oid IS NULL THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: conferencia 20261664000000: % sumiu', v_fn;
  END IF;
  IF (SELECT count(*) FROM pg_proc p
       WHERE p.pronamespace = 'public'::regnamespace AND p.proname = 'fin__movimentos') <> 1 THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: conferencia 20261664000000: fin__movimentos ficou com sobrecarga';
  END IF;
  SELECT md5(replace(prosrc, E'\r', '')) INTO v_hash FROM pg_proc WHERE oid = v_oid;
  IF v_hash IS DISTINCT FROM '04fc43fd9e3e7f4b44cb9e4c2a866ae3' THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: conferencia 20261664000000: corpo vivo de % (hash %) não é o esperado', v_fn, COALESCE(v_hash, 'ausente');
  END IF;
  IF NOT EXISTS (
       SELECT 1 FROM pg_proc p
        WHERE p.oid = v_oid
          AND (to_jsonb(p) - 'prosrc') = current_setting('ikcous.porfora1664_atributos')::jsonb
     ) THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: conferencia 20261664000000: atributos, dono ou ACL de % mudaram (só o corpo podia mudar)', v_fn;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_proc p
               CROSS JOIN LATERAL aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) g
              WHERE p.oid = v_oid AND g.privilege_type = 'EXECUTE' AND g.grantee = 0)
     OR has_function_privilege('anon', v_oid, 'EXECUTE')
     OR has_function_privilege('authenticated', v_oid, 'EXECUTE') THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: conferencia 20261664000000: % ficou alcançável por PUBLIC, anon ou authenticated', v_fn;
  END IF;
END $conferencia_20261664000000$;

NOTIFY pgrst, 'reload schema';
