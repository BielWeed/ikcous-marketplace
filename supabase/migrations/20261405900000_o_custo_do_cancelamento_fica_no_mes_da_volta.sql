-- O custo do pedido cancelado volta no período do retorno ao estoque.
-- Corpo anterior: fin_dre(date,date) da 20261399600000, MD5 sem CR: eafc6a2c4663e33f5459791c6601b848.
-- Corpo novo (MD5 sem CR): a27c9649621b3ac1502f458576120259.
-- A venda continua no período do pagamento e o estorno no da efetiva saída do dinheiro.
-- Só muda o custo: devoluções parciais conservam a data própria e o cancelamento
-- credita apenas o restante, na data do retorno ao estoque, com o custo da venda.
-- A função, a assinatura, o dono e os privilégios permanecem; nenhum dado é alterado.
-- O aplicador controla a transação e o ledger.

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

DO $preflight_20261405900000$
DECLARE
  r record;
  v_hash text;
  v_atributos jsonb;
BEGIN
  FOR r IN SELECT * FROM (VALUES
    ('public.fin_dre(date,date)', 'eafc6a2c4663e33f5459791c6601b848', 'a27c9649621b3ac1502f458576120259')
  ) AS esperado(assinatura, hash_vigente, hash_desta)
  LOOP
    SELECT md5(replace(p.prosrc, E'\r', '')), to_jsonb(p) - 'prosrc'
      INTO v_hash, v_atributos FROM pg_proc p
     WHERE p.oid = to_regprocedure(r.assinatura);
    IF v_hash IS NULL OR v_hash NOT IN (r.hash_vigente, r.hash_desta) THEN
      RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: % (hash %) nao e o corpo vigente nem o desta migration; revise antes de aplicar.', r.assinatura, COALESCE(v_hash, 'ausente');
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM pg_proc p JOIN pg_language l ON l.oid = p.prolang
       WHERE p.oid = to_regprocedure(r.assinatura)
         AND p.prosecdef AND p.proconfig = ARRAY['search_path=public']::text[]
         AND p.provolatile = 's' AND NOT p.proisstrict AND NOT p.proretset
         AND l.lanname = 'plpgsql' AND p.prorettype = 'jsonb'::regtype
         AND pg_get_function_arguments(p.oid) = 'p_inicio date, p_fim date'
         AND (SELECT count(*) FROM pg_proc q WHERE q.pronamespace = 'public'::regnamespace AND q.proname = 'fin_dre') = 1
         AND has_function_privilege('authenticated', p.oid, 'EXECUTE')
         AND NOT has_function_privilege('anon', p.oid, 'EXECUTE')
         AND NOT EXISTS (SELECT 1 FROM aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) a
                         WHERE a.grantee = 0 AND a.privilege_type = 'EXECUTE')
    ) THEN
      RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: fin_dre tem assinatura, atributos ou permissoes diferentes dos esperados.';
    END IF;
    -- Fotografar OID, dono, ACL e TODOS os atributos: o CREATE OR REPLACE so pode trocar prosrc.
    PERFORM set_config('ikcous.dre4059_atributos', v_atributos::text, true);
  END LOOP;
END $preflight_20261405900000$;

CREATE OR REPLACE FUNCTION public.fin_dre(p_inicio date, p_fim date)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $$
DECLARE
  v_online numeric;
  v_balcao numeric;
  v_outras_receitas numeric;
  v_ded_derivadas numeric;
  v_ded_manuais numeric;
  v_deducoes numeric;
  v_cmv numeric;
  v_cmv_volta numeric;
  v_cmv_estimado boolean;
  v_variaveis numeric;
  v_fixas numeric;
  v_financeiro numeric;
  v_bruta numeric;
  v_liquida numeric;
  v_lucro_bruto numeric;
  v_margem numeric;
  v_operacional numeric;
  v_linhas_manuais jsonb;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Acesso negado.' USING ERRCODE = '42501';
  END IF;
  -- Papel ATUAL (auth.users E profiles), não o do JWT: admin rebaixado para aqui (20261199000000).
  IF NOT public.is_admin_atual() THEN
    RAISE EXCEPTION 'Acesso negado.' USING ERRCODE = '42501';
  END IF;
  IF p_inicio IS NULL OR p_fim IS NULL OR p_fim < p_inicio OR p_fim - p_inicio > 400 THEN
    RAISE EXCEPTION 'Período inválido (até 400 dias).' USING ERRCODE = '22023';
  END IF;

  -- Competência: derivados pela data do dinheiro; manuais pela competência,
  -- previstos inclusive (a despesa do mês pesa no mês, paga ou não). Estorno
  -- pendente ainda não é dedução. Uma consulta só (sem tabela temporária: a
  -- função roda também em transação só-leitura).
  WITH mov AS (
    SELECT * FROM public.fin__movimentos(NULL, NULL) m
     WHERE m.data_competencia BETWEEN p_inicio AND p_fim
       AND (m.status = 'realizado' OR (m.status = 'previsto' AND m.origem <> 'estorno'))
  ), manuais AS (
    SELECT m.tipo, m.valor, c.grupo_dre, c.nome
      FROM mov m JOIN public.fin_categorias c ON c.id = m.categoria_id
     WHERE m.origem IN ('manual', 'ajuste_caixa') AND m.tipo <> 'transferencia'
  ), vendas_cmv AS (
    -- Mesmo dia (ou estoque devolvido antes do pagamento tardio): custo líquido zero.
    -- Se voltou em outro dia, a venda conserva seu custo; o crédito tem data própria.
    SELECT oi.quantity * COALESCE(oic.custo, p.custo, 0) AS valor,
           oic.item_id IS NULL AS estimado
      FROM mov m
      JOIN public.marketplace_orders o ON o.id = m.pedido_id
      JOIN public.marketplace_order_items oi ON oi.order_id = o.id
      LEFT JOIN public.produtos p ON p.id = oi.product_id
      LEFT JOIN public.marketplace_order_item_custo oic ON oic.item_id = oi.id
     WHERE m.origem IN ('venda_online', 'venda_balcao', 'venda_entrega')
       AND NOT (o.status = 'cancelled' AND o.stock_returned_at IS NOT NULL
                AND public.fin__dia(o.stock_returned_at) <= m.data_competencia)
  ), creditos_cmv AS (
    -- A parcela que já voltou por devolução continua creditada no dia em que voltou.
    SELECT di.quantidade * COALESCE(oic.custo, p.custo, 0) AS valor,
           oic.item_id IS NULL AS estimado
      FROM public.devolucao_itens di
      JOIN public.devolucoes d ON d.id = di.devolucao_id
      JOIN public.marketplace_orders o ON o.id = d.order_id
      LEFT JOIN public.produtos p ON p.id = di.product_id
      LEFT JOIN public.marketplace_order_item_custo oic ON oic.item_id = di.order_item_id
     WHERE public.fin__dia(di.reestocado_em) BETWEEN p_inicio AND p_fim
       AND (NOT (o.status = 'cancelled' AND o.stock_returned_at IS NOT NULL)
            OR (o.payment_status IN ('pago', 'pago_apos_expirar', 'recebido_na_entrega', 'estornado')
                AND public.fin__dia(COALESCE(o.pagamento_recebido_em, o.paid_at)) < public.fin__dia(o.stock_returned_at)
                AND di.reestocado_em <= o.stock_returned_at))
    UNION ALL
    -- Cancelamento: devolver_estoque só repõe as unidades ainda não reestocadas.
    -- O custo dessas unidades volta na data do estoque, não na data do estorno.
    SELECT restante.quantidade * COALESCE(oic.custo, p.custo, 0),
           oic.item_id IS NULL
      FROM public.marketplace_orders o
      JOIN public.marketplace_order_items oi ON oi.order_id = o.id
      LEFT JOIN public.produtos p ON p.id = oi.product_id
      LEFT JOIN public.marketplace_order_item_custo oic ON oic.item_id = oi.id
      CROSS JOIN LATERAL (
        SELECT oi.quantity - COALESCE(sum(di.quantidade), 0) AS quantidade
          FROM public.devolucao_itens di
         WHERE di.order_item_id = oi.id AND di.reestocado_em <= o.stock_returned_at
      ) restante
     WHERE o.status = 'cancelled'
       AND public.fin__dia(o.stock_returned_at) BETWEEN p_inicio AND p_fim
       AND o.payment_status IN ('pago', 'pago_apos_expirar', 'recebido_na_entrega', 'estornado')
       AND public.fin__dia(COALESCE(o.pagamento_recebido_em, o.paid_at)) < public.fin__dia(o.stock_returned_at)
       AND restante.quantidade > 0
  )
  SELECT
    (SELECT COALESCE(sum(valor), 0) FROM mov WHERE origem IN ('venda_online', 'venda_entrega')),
    (SELECT COALESCE(sum(valor), 0) FROM mov WHERE origem = 'venda_balcao'),
    (SELECT COALESCE(sum(valor), 0) FROM mov WHERE origem IN ('estorno', 'estorno_externo', 'devolucao')),
    (SELECT COALESCE(sum(valor), 0) FROM manuais WHERE tipo = 'entrada' AND grupo_dre = 'receita'),
    (SELECT COALESCE(sum(valor), 0) FROM manuais WHERE tipo = 'saida' AND grupo_dre = 'deducao'),
    (SELECT COALESCE(sum(valor), 0) FROM manuais WHERE tipo = 'saida' AND grupo_dre = 'custo_variavel'),
    (SELECT COALESCE(sum(valor), 0) FROM manuais WHERE tipo = 'saida' AND grupo_dre = 'despesa_fixa'),
    (SELECT COALESCE(sum(CASE WHEN tipo = 'entrada' THEN valor ELSE -valor END), 0)
       FROM manuais WHERE grupo_dre = 'financeiro'),
    (SELECT COALESCE(sum(valor), 0) FROM vendas_cmv),
    (SELECT COALESCE(sum(valor), 0) FROM creditos_cmv),
    (EXISTS (SELECT 1 FROM vendas_cmv WHERE estimado)
      OR EXISTS (SELECT 1 FROM creditos_cmv WHERE estimado)),
    -- As categorias do grupo 'financeiro' abrem por baixo de "(+/-) Resultado financeiro", que e
    -- ENTRADA menos SAIDA (v_financeiro, acima). Por isso a linha de cada categoria sai com o mesmo
    -- sinal: tarifa, juros pagos e quebra de caixa (saida) negativos; rendimento e sobra (entrada)
    -- positivos, e a soma das linhas fecha com resultado_financeiro. Antes, 'valor' era sempre a
    -- soma sem sinal e a tela mostrava a tarifa como ganho (20261382000000). Os outros grupos nao
    -- mudam: ali o sinal e do grupo (a tela subtrai) e a categoria so combina com um tipo.
    -- 'total' (sem sinal) continua mandando na ordem das linhas, como antes.
    (SELECT COALESCE(jsonb_agg(jsonb_build_object('grupo', g.grupo_dre, 'categoria', g.nome, 'valor', g.valor_dre)
                               ORDER BY g.ordem, g.total DESC), '[]'::jsonb)
       FROM (SELECT grupo_dre, nome, sum(valor) AS total,
                    CASE WHEN grupo_dre = 'financeiro'
                         THEN sum(CASE WHEN tipo = 'entrada' THEN valor ELSE -valor END)
                         ELSE sum(valor) END AS valor_dre,
                    CASE grupo_dre WHEN 'receita' THEN 1 WHEN 'deducao' THEN 2 WHEN 'custo_variavel' THEN 4
                                   WHEN 'despesa_fixa' THEN 5 ELSE 6 END AS ordem
               FROM manuais WHERE grupo_dre <> 'fora_dre'
              GROUP BY grupo_dre, nome) g)
    INTO v_online, v_balcao, v_ded_derivadas, v_outras_receitas, v_ded_manuais,
         v_variaveis, v_fixas, v_financeiro, v_cmv, v_cmv_volta, v_cmv_estimado, v_linhas_manuais;

  -- CMV do periodo = custo das vendas MENOS o custo que voltou por devolucao no periodo, SEM piso (20261399600000).
  -- Pode dar NEGATIVO: vendeu em outubro, devolveu em novembro, e o custo que volta em novembro e' maior que o das
  -- vendas de novembro. E' um CREDITO de custo, no mesmo mes em que a receita devolvida sai como deducao ("Estornos e
  -- devolucoes"). Antes, GREATEST(..., 0) cortava o credito em zero: o lucro desse mes saia menor que o real e a soma
  -- dos meses nao fechava com o periodo inteiro. A tela ja mostra o CMV negativo como credito (src/lib/financeiro.ts).
  v_cmv := v_cmv - v_cmv_volta;
  v_deducoes := v_ded_derivadas + v_ded_manuais;
  v_bruta := v_online + v_balcao + v_outras_receitas;
  v_liquida := v_bruta - v_deducoes;
  v_lucro_bruto := v_liquida - v_cmv;
  v_margem := v_lucro_bruto - v_variaveis;
  v_operacional := v_margem - v_fixas;

  RETURN jsonb_build_object(
    'receita_bruta', v_bruta,
    'receita_online', v_online,
    'receita_balcao', v_balcao,
    'deducoes', v_deducoes,
    'receita_liquida', v_liquida,
    'cmv', v_cmv,
    'cmv_estimado', v_cmv_estimado,
    'lucro_bruto', v_lucro_bruto,
    'custos_variaveis', v_variaveis,
    'margem_contribuicao', v_margem,
    'despesas_fixas', v_fixas,
    'resultado_operacional', v_operacional,
    'resultado_financeiro', v_financeiro,
    'lucro_liquido', v_operacional + v_financeiro,
    'linhas',
      (SELECT COALESCE(jsonb_agg(l - 'ordem' ORDER BY (l ->> 'ordem')::int), '[]'::jsonb) FROM (
         SELECT jsonb_build_object('grupo', 'receita', 'categoria', 'Vendas pelo app', 'valor', v_online, 'ordem', 1) AS l
          WHERE v_online > 0
         UNION ALL SELECT jsonb_build_object('grupo', 'receita', 'categoria', 'Vendas na loja física', 'valor', v_balcao, 'ordem', 1)
          WHERE v_balcao > 0
         UNION ALL SELECT jsonb_build_object('grupo', 'deducao', 'categoria', 'Estornos e devoluções', 'valor', v_ded_derivadas, 'ordem', 2)
          WHERE v_ded_derivadas > 0
         UNION ALL SELECT jsonb_build_object('grupo', 'cmv', 'categoria', 'Custo das mercadorias vendidas', 'valor', v_cmv, 'ordem', 3)
          WHERE v_cmv <> 0
       ) x) || v_linhas_manuais
  );
END;
$$;

DO $conferencia_20261405900000$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p WHERE p.oid = to_regprocedure('public.fin_dre(date,date)')
      AND md5(replace(p.prosrc, E'\r', '')) = 'a27c9649621b3ac1502f458576120259'
      AND (to_jsonb(p) - 'prosrc') = current_setting('ikcous.dre4059_atributos')::jsonb
  ) THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: conferencia 20261405900000 falhou (corpo ou atributos alterados).';
  END IF;
END $conferencia_20261405900000$;

NOTIFY pgrst, 'reload schema';
