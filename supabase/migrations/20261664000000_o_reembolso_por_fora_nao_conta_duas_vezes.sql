-- O reembolso por fora só conta uma vez depois de a loja confirmar que foi o mesmo dinheiro.
-- A: o MP registra outra linha 'sistema' depois da devolução manual. B: o MP conclui a própria linha
-- substituída pela saída após espera. Até a confirmação, contam as duas saídas; "foram dois" só encerra
-- o aviso. Uma devolução pode cobrir apenas uma linha. A diferença de valores continua sendo uma saída.
--
-- A prova da saída após espera conserva o id da devolução daqui em diante. O evento antigo não conserva
-- o id do refund e o livro de registro tem retenção limitada: não se tenta deduzir o vínculo antigo.
-- A linha B antiga continua visível no pedido. Nenhuma operação chama o gateway ou reescreve os dados antigos.
--
-- Saldo real, extrato e lucro divergem se cada um deduz sozinho. Só a sobreposição confirmada sai do
-- cálculo; valor_estornado continua sendo o registro bruto do MP. O cálculo restante não muda.
-- Corpos de partida: 20261391200000, 20261241000000 e 20261659000000. 220a/220b conferem o catálogo;
-- rollback manual restaura os corpos e recusa descartar prova ou conferência já gravada.
-- Sem BEGIN/COMMIT de nível superior: o aplicador controla a transação.


SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

DO $preflight_20261664000000$
DECLARE
  r record;
  v_oid oid;
  v_atributos jsonb;
  v_hash text;
  v_antes integer := 0;
BEGIN
  FOR r IN SELECT * FROM (VALUES
    ('public.fin__movimentos(date,date)', '26473edd94ad6547d95de43433088304', '17127ad84b6eb71e8cd1714d47855a68'),
    ('public.pedido__saldo_a_estornar(uuid)', '99741b4cdbf1e8d8340f80440e6da094', '7f0c83c80b5f26df9cbc19e92384453d'),
    ('public.admin_devolucao_reembolso_por_fora_apos_espera(uuid,uuid,text)', '92dd1608d02ef5e9fd9fe34e0bd7c49f', '32c2bc1d99162e0450a11431fa8ae411'),
    ('public.pedido_reembolsos_e_saldo(uuid)', '86dd0eaaaa571a4d5e85622e90442bc0', '801b199196120f82c4b57ab7abbc9c11'),
    ('public.get_admin_analytics_v2(integer)', '1624212a7096b6f49a80370b30191a15', '3853f60efad86f22deb368ed791d76cb')
  ) AS esperado(fn, hash_antes, hash_depois)
  JOIN (VALUES
    ('public.fin__movimentos(date,date)', 'sql', 's', false),
    ('public.pedido__saldo_a_estornar(uuid)', 'sql', 's', true),
    ('public.admin_devolucao_reembolso_por_fora_apos_espera(uuid,uuid,text)', 'plpgsql', 'v', true),
    ('public.pedido_reembolsos_e_saldo(uuid)', 'plpgsql', 's', true),
    ('public.get_admin_analytics_v2(integer)', 'plpgsql', 'v', true)
  ) AS regua(fn, lingua, volatilidade, definer) USING (fn)
  LOOP
    v_oid := to_regprocedure(r.fn);
    SELECT md5(replace(p.prosrc, chr(13), '')), to_jsonb(p) - 'prosrc'
      INTO v_hash, v_atributos
      FROM pg_proc p JOIN pg_language l ON l.oid = p.prolang
     WHERE p.oid = v_oid AND p.prokind = 'f' AND p.prosecdef = r.definer
       AND p.provolatile::text = r.volatilidade AND l.lanname::text = r.lingua
       AND p.proconfig = ARRAY['search_path=public']::text[];
    IF NOT FOUND OR v_hash NOT IN (r.hash_antes, r.hash_depois)
       OR (SELECT count(*) FROM pg_proc WHERE pronamespace = 'public'::regnamespace
             AND proname::text = split_part(split_part(r.fn, '(', 1), '.', 2)) <> 1
       OR has_function_privilege('anon', v_oid, 'EXECUTE')
       OR EXISTS (SELECT 1 FROM pg_proc p, aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) a
                   WHERE p.oid = v_oid AND a.grantee = 0 AND a.privilege_type = 'EXECUTE')
       OR has_function_privilege('authenticated', v_oid, 'EXECUTE') IS DISTINCT FROM
            (r.fn NOT IN ('public.fin__movimentos(date,date)', 'public.pedido__saldo_a_estornar(uuid)')) THEN
      RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: % tem corpo (md5 %), atributos ou ACL desconhecidos.', r.fn, COALESCE(v_hash, 'ausente');
    END IF;
    IF v_hash = r.hash_antes THEN v_antes := v_antes + 1; END IF;
    PERFORM set_config('ikcous.conciliacao1664_' || v_oid, v_atributos::text, true);
  END LOOP;
  IF v_antes NOT IN (0, 5) THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: 1664 parcialmente instalada.';
  END IF;
  IF to_regclass('public.order_refund_prova') IS NULL OR to_regprocedure('public.is_admin_atual()') IS NULL THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: faltam a prova de reembolso ou a guarda de admin atual.';
  END IF;
  IF v_antes > 0 AND (
    EXISTS (SELECT 1 FROM pg_proc WHERE pronamespace = 'public'::regnamespace AND proname IN
      ('admin_devolucao_confirmar_mesmo_dinheiro', 'admin_devolucao_confirmar_dois_reembolsos',
       'order_refund__valor_coberto_por_fora', 'order_refund__suspeitas_do_pedido'))
    OR EXISTS (SELECT 1 FROM pg_attribute a WHERE NOT a.attisdropped AND a.attnum > 0
        AND ((a.attrelid = 'public.order_refunds'::regclass AND a.attname IN ('cobre_devolucao_id', 'dobro_conferido_em'))
          OR (a.attrelid = 'public.order_refund_prova'::regclass AND a.attname = 'devolucao_id')))
    OR to_regclass('public.uq_order_refunds_cobre_devolucao') IS NOT NULL
    OR to_regclass('public.idx_order_refund_prova_devolucao') IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: objetos da 1664 já existem na base anterior.';
  END IF;
END $preflight_20261664000000$;

ALTER TABLE public.order_refunds
  ADD COLUMN IF NOT EXISTS cobre_devolucao_id uuid
    CONSTRAINT order_refunds_cobre_devolucao_id_fkey REFERENCES public.devolucoes(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS dobro_conferido_em timestamptz;
ALTER TABLE public.order_refund_prova
  ADD COLUMN IF NOT EXISTS devolucao_id uuid
    CONSTRAINT order_refund_prova_devolucao_id_fkey REFERENCES public.devolucoes(id) ON DELETE SET NULL;

-- Uma devolução representa uma saída: não pode abater duas linhas do MP.
CREATE UNIQUE INDEX IF NOT EXISTS uq_order_refunds_cobre_devolucao
  ON public.order_refunds (cobre_devolucao_id) WHERE cobre_devolucao_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_order_refund_prova_devolucao
  ON public.order_refund_prova (devolucao_id) WHERE devolucao_id IS NOT NULL;

DO $exclusividade$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                   WHERE conrelid = 'public.order_refunds'::regclass AND conname = 'order_refunds_conferencia_exclusiva') THEN
    ALTER TABLE public.order_refunds ADD CONSTRAINT order_refunds_conferencia_exclusiva
      CHECK (cobre_devolucao_id IS NULL OR dobro_conferido_em IS NULL);
  END IF;
END $exclusividade$;

-- Valor em comum, só após decisão. Se um valor inclui o outro, a diferença continua a sair.
CREATE OR REPLACE FUNCTION public.order_refund__valor_coberto_por_fora(p_order_id uuid)
RETURNS numeric
LANGUAGE sql STABLE SET search_path = public
AS $coberto$
  SELECT COALESCE(sum(LEAST(r.amount, d.valor_reembolso)), 0)
    FROM public.order_refunds r
    JOIN public.devolucoes d ON d.id = r.cobre_devolucao_id AND d.order_id = r.order_id
   WHERE r.order_id = p_order_id
     AND r.status = 'concluido' AND r.concluido_em IS NOT NULL
     AND d.status = 'concluida' AND d.reembolso_manual
     AND d.resolucao_final = 'reembolso' AND d.refund_id IS NULL AND d.valor_reembolso > 0
$coberto$;
REVOKE ALL ON FUNCTION public.order_refund__valor_coberto_por_fora(uuid) FROM PUBLIC, anon, authenticated, service_role;

-- Mesma régua nos avisos e na gravação. Não deduz vínculo antigo pelo valor ou pela data.
CREATE OR REPLACE FUNCTION public.order_refund__suspeitas_do_pedido(p_order_id uuid)
RETURNS TABLE (refund_id uuid, caminho text, valor_mp numeric, por_fora_em timestamptz, candidatos jsonb)
LANGUAGE sql STABLE SET search_path = public
AS $suspeitas$
  WITH manuais AS (
    SELECT d.id, d.protocolo, d.valor_reembolso,
           COALESCE((
             SELECT max(e.created_at)
               FROM public.devolucao_eventos e
              WHERE e.devolucao_id = d.id AND e.ator = 'loja'
                AND e.de_status = 'concluida' AND e.para_status = 'concluida'
                AND e.nota LIKE 'Reembolso resolvido manualmente (fora do app) %'
           ), d.concluida_em, d.updated_at) AS registrado_em
      FROM public.devolucoes d
     WHERE d.order_id = p_order_id AND d.status = 'concluida' AND d.resolucao_final = 'reembolso'
       AND d.reembolso_manual AND d.refund_id IS NULL AND d.valor_reembolso > 0
       AND NOT EXISTS (SELECT 1 FROM public.order_refunds c WHERE c.cobre_devolucao_id = d.id)
  ), linhas AS (
    SELECT r.id, r.amount, r.created_at, pv.devolucao_id, pv.por_fora_liberado_em,
           CASE WHEN r.solicitado_por = 'sistema' THEN 'A'
                WHEN r.solicitado_por IN ('lojista', 'cliente')
                 AND pv.substituida_por_manual_em IS NOT NULL AND pv.por_fora_liberado_em IS NOT NULL
                 AND r.concluido_em > pv.por_fora_liberado_em THEN 'B' END AS caminho
      FROM public.order_refunds r
      LEFT JOIN public.order_refund_prova pv ON pv.refund_id = r.id
     WHERE r.order_id = p_order_id AND r.status = 'concluido' AND r.concluido_em IS NOT NULL
       AND r.mp_chargeback_id IS NULL AND r.cobre_devolucao_id IS NULL AND r.dobro_conferido_em IS NULL
  )
  SELECT r.id, r.caminho, r.amount, r.por_fora_liberado_em, COALESCE(c.opcoes, '[]'::jsonb)
    FROM linhas r
    CROSS JOIN LATERAL (
      SELECT jsonb_agg(jsonb_build_object(
               'id', d.id, 'protocolo', d.protocolo, 'valor', d.valor_reembolso,
               'registrado_em', CASE WHEN r.caminho = 'B' THEN r.por_fora_liberado_em ELSE d.registrado_em END
             ) ORDER BY d.registrado_em, d.id) AS opcoes
        FROM manuais d
       WHERE (r.caminho = 'A' AND r.created_at > d.registrado_em)
          OR (r.caminho = 'B' AND r.devolucao_id = d.id)
    ) c
   WHERE r.caminho = 'B' OR (r.caminho = 'A' AND c.opcoes IS NOT NULL)
$suspeitas$;
REVOKE ALL ON FUNCTION public.order_refund__suspeitas_do_pedido(uuid) FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.admin_devolucao_confirmar_mesmo_dinheiro(p_devolucao_id uuid, p_refund_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $mesmo$
DECLARE
  v_d public.devolucoes%ROWTYPE;
  v_r public.order_refunds%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Acesso negado.' USING ERRCODE = '42501';
  END IF;
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Acesso negado.' USING ERRCODE = '42501';
  END IF;
  IF NOT public.is_admin_atual() THEN
    RAISE EXCEPTION 'Acesso negado.' USING ERRCODE = '42501';
  END IF;

  -- Devolução antes da linha, como na saída após a espera. A trava e o índice único
  -- impedem que duas conferências usem a mesma devolução. A linha serializa as duas respostas.
  SELECT * INTO v_d FROM public.devolucoes WHERE id = p_devolucao_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Devolução não encontrada.' USING ERRCODE = 'P0002';
  END IF;
  SELECT * INTO v_r FROM public.order_refunds WHERE id = p_refund_id FOR UPDATE;
  IF NOT FOUND OR v_r.order_id IS DISTINCT FROM v_d.order_id THEN
    RAISE EXCEPTION 'A linha de reembolso não pertence a esta devolução.' USING ERRCODE = '22023';
  END IF;
  IF v_r.cobre_devolucao_id = v_d.id THEN
    RETURN jsonb_build_object('resultado', 'confirmado');
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.order_refund__suspeitas_do_pedido(v_d.order_id) s
     WHERE s.refund_id = v_r.id AND s.candidatos @> jsonb_build_array(jsonb_build_object('id', v_d.id))
  ) THEN
    RAISE EXCEPTION 'Não dá para confirmar essa ligação. Confira o reembolso na ficha.' USING ERRCODE = '22023';
  END IF;

  UPDATE public.order_refunds SET cobre_devolucao_id = v_d.id WHERE id = v_r.id;
  RETURN jsonb_build_object('resultado', 'confirmado');
END;
$mesmo$;
REVOKE ALL ON FUNCTION public.admin_devolucao_confirmar_mesmo_dinheiro(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_devolucao_confirmar_mesmo_dinheiro(uuid, uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_devolucao_confirmar_dois_reembolsos(p_order_id uuid, p_refund_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $dois$
DECLARE
  v_r public.order_refunds%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Acesso negado.' USING ERRCODE = '42501';
  END IF;
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Acesso negado.' USING ERRCODE = '42501';
  END IF;
  IF NOT public.is_admin_atual() THEN
    RAISE EXCEPTION 'Acesso negado.' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_r FROM public.order_refunds WHERE id = p_refund_id FOR UPDATE;
  IF NOT FOUND OR v_r.order_id IS DISTINCT FROM p_order_id THEN
    RAISE EXCEPTION 'A linha de reembolso não pertence a este pedido.' USING ERRCODE = '22023';
  END IF;
  IF v_r.dobro_conferido_em IS NOT NULL THEN
    RETURN jsonb_build_object('resultado', 'confirmado');
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.order_refund__suspeitas_do_pedido(p_order_id) s WHERE s.refund_id = v_r.id
  ) THEN
    RAISE EXCEPTION 'Não dá para confirmar essa conferência. Confira o reembolso na ficha.' USING ERRCODE = '22023';
  END IF;

  UPDATE public.order_refunds SET dobro_conferido_em = now() WHERE id = v_r.id;
  RETURN jsonb_build_object('resultado', 'confirmado');
END;
$dois$;
REVOKE ALL ON FUNCTION public.admin_devolucao_confirmar_dois_reembolsos(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_devolucao_confirmar_dois_reembolsos(uuid, uuid) TO authenticated;

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
  ), ja_coberto AS (
    SELECT r.id, r.order_id, LEAST(r.amount, d.valor_reembolso) AS valor
      FROM public.order_refunds r
      JOIN public.devolucoes d ON d.id = r.cobre_devolucao_id AND d.order_id = r.order_id
     WHERE r.status = 'concluido' AND r.concluido_em IS NOT NULL
       AND d.status = 'concluida' AND d.reembolso_manual
       AND d.resolucao_final = 'reembolso' AND d.refund_id IS NULL AND d.valor_reembolso > 0
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
           -- Só o que a loja NÃO confirmou ser o mesmo dinheiro (20261664000000).
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
        -- O valor_estornado já inclui a linha confirmada como o mesmo dinheiro.
        -- O ajuste evita subtrair a sobreposição do restante de um estorno externo.
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
         + public.order_refund__valor_coberto_por_fora(o.id)
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
  INSERT INTO public.order_refund_prova AS pv (refund_id, substituida_por_manual_em, por_fora_liberado_em, devolucao_id)
  VALUES (v_r.id, now(), now(), v_d.id)
  ON CONFLICT (refund_id) DO UPDATE
     SET substituida_por_manual_em = COALESCE(pv.substituida_por_manual_em, EXCLUDED.substituida_por_manual_em),
         por_fora_liberado_em = COALESCE(pv.por_fora_liberado_em, EXCLUDED.por_fora_liberado_em),
         devolucao_id = COALESCE(pv.devolucao_id, EXCLUDED.devolucao_id);

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
    'manual', v_manual - public.order_refund__valor_coberto_por_fora(p_order_id),
    'disponivel', GREATEST(public.pedido__saldo_a_estornar(p_order_id), 0),
    'reservado_por_fora', v_reservado,
    'possivel_dobro', COALESCE((SELECT jsonb_agg(to_jsonb(s) ORDER BY s.caminho, s.refund_id)
      FROM public.order_refund__suspeitas_do_pedido(p_order_id) s), '[]'::jsonb),
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
                       -- Depois de "ja devolvi por fora", so o vinculo que a loja confirmou deduplica (20261664000000).
                       -- A regra da linha ainda ligada que falhou/foi recusada permanece a mesma.
                       - public.order_refund__valor_coberto_por_fora(so.id)
                       - COALESCE((
                       SELECT LEAST(g.valor, COALESCE((
                                  SELECT SUM(sp.amount)
                                    FROM public.order_refunds sp
                                   WHERE sp.order_id = so.id
                                     AND sp.solicitado_por = 'sistema'
                                     AND sp.status = 'concluido'
                                     AND sp.mp_chargeback_id IS NULL
                                     AND sp.cobre_devolucao_id IS NULL
                                     AND sp.created_at >= g.desde), 0))
                         FROM (SELECT SUM(dvp.valor_reembolso) AS valor,
                                      MIN(COALESCE(dvp.concluida_em, dvp.updated_at)) AS desde
                                 FROM public.devolucoes dvp
                                 LEFT JOIN public.order_refunds rlp ON rlp.id = dvp.refund_id
                                WHERE dvp.order_id = so.id
                                  AND dvp.status = 'concluida'
                                  AND dvp.resolucao_final = 'reembolso'
                                  AND dvp.valor_reembolso > 0
                                  AND rlp.status IN ('falhou', 'recusado')) g
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
                       -- Depois de "ja devolvi por fora", so o vinculo que a loja confirmou deduplica (20261664000000).
                       -- A regra da linha ainda ligada que falhou/foi recusada permanece a mesma.
                       - public.order_refund__valor_coberto_por_fora(so.id)
                       - COALESCE((
                       SELECT LEAST(g.valor, COALESCE((
                                  SELECT SUM(sp.amount)
                                    FROM public.order_refunds sp
                                   WHERE sp.order_id = so.id
                                     AND sp.solicitado_por = 'sistema'
                                     AND sp.status = 'concluido'
                                     AND sp.mp_chargeback_id IS NULL
                                     AND sp.cobre_devolucao_id IS NULL
                                     AND sp.created_at >= g.desde), 0))
                         FROM (SELECT SUM(dvp.valor_reembolso) AS valor,
                                      MIN(COALESCE(dvp.concluida_em, dvp.updated_at)) AS desde
                                 FROM public.devolucoes dvp
                                 LEFT JOIN public.order_refunds rlp ON rlp.id = dvp.refund_id
                                WHERE dvp.order_id = so.id
                                  AND dvp.status = 'concluida'
                                  AND dvp.resolucao_final = 'reembolso'
                                  AND dvp.valor_reembolso > 0
                                  AND rlp.status IN ('falhou', 'recusado')) g
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

DO $conferencia_20261664000000$
DECLARE
  r record;
  v_oid oid;
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
    IF NOT EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid = v_oid
         AND md5(replace(p.prosrc, chr(13), '')) = r.h
         AND (to_jsonb(p) - 'prosrc') = current_setting('ikcous.conciliacao1664_' || v_oid)::jsonb) THEN
      RAISE EXCEPTION 'B2_POSTFLIGHT_FAILED: corpo, dono, ACL ou atributos diferentes em %.', r.fn;
    END IF;
  END LOOP;
  FOR r IN SELECT * FROM (VALUES
    ('public.order_refund__valor_coberto_por_fora(uuid)', 'b02ca216bd69262ba5f5ca4034d6db4a', false),
    ('public.order_refund__suspeitas_do_pedido(uuid)', 'ecf3eb8ffbe6926ef78678f51ca3f24f', false),
    ('public.admin_devolucao_confirmar_mesmo_dinheiro(uuid,uuid)', 'a17c0572552eaef549ff3b0dfab76622', true),
    ('public.admin_devolucao_confirmar_dois_reembolsos(uuid,uuid)', '7d8a4faa9bd8954cf9cb9851bf8dfde5', true)
  ) AS esperado(fn, h, admin)
  LOOP
    v_oid := to_regprocedure(r.fn);
    IF NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_language l ON l.oid = p.prolang WHERE p.oid = v_oid
        AND p.proconfig = ARRAY['search_path=public']::text[]
        AND p.prokind = 'f' AND p.prosecdef = r.admin
        AND p.provolatile::text = CASE WHEN r.admin THEN 'v' ELSE 's' END
        AND l.lanname::text = CASE WHEN r.admin THEN 'plpgsql' ELSE 'sql' END
        AND md5(replace(p.prosrc, chr(13), '')) = r.h)
       OR (SELECT count(*) FROM pg_proc WHERE pronamespace = 'public'::regnamespace
             AND proname::text = split_part(split_part(r.fn, '(', 1), '.', 2)) <> 1
       OR has_function_privilege('anon', v_oid, 'EXECUTE')
       OR EXISTS (SELECT 1 FROM pg_proc p, aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) a
                   WHERE p.oid = v_oid AND a.grantee = 0 AND a.privilege_type = 'EXECUTE')
       OR has_function_privilege('authenticated', v_oid, 'EXECUTE') IS DISTINCT FROM r.admin
       OR (NOT r.admin AND has_function_privilege('service_role', v_oid, 'EXECUTE')) THEN
      RAISE EXCEPTION 'B2_POSTFLIGHT_FAILED: corpo, atributos ou ACL incorretos em %.', r.fn;
    END IF;
  END LOOP;
END $conferencia_20261664000000$;

NOTIFY pgrst, 'reload schema';
