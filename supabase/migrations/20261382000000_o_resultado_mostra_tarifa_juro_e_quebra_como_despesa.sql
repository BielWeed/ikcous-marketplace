-- A DEMONSTRACAO DO RESULTADO MOSTRA TARIFA, JURO E QUEBRA COMO DESPESA (lote F5; 23/10/2026).
-- Na aba Resultado do Financeiro, o grupo "financeiro" (tarifa bancaria e juros pagos, quebra de
-- caixa, rendimento, sobra de caixa) abre por baixo da linha "Resultado financeiro". O TOTAL
-- (resultado_financeiro e lucro_liquido) ja e entrada menos saida e sempre esteve certo; so o
-- DETALHE saia sem sinal: fin_dre devolvia a soma dos valores sem olhar se era entrada ou saida,
-- e a tela, que mostra esse detalhe como veio, exibia tarifa e quebra como GANHO. Aqui a linha
-- de cada categoria do grupo financeiro passa a ser entrada menos saida (a mesma conta do total):
-- a soma das linhas fecha com o Resultado financeiro. A tela nao compensa o sinal em lugar
-- nenhum (src/lib/financeiro.ts mostra o valor como veio no grupo financeiro): sem ajuste no front.
--
-- So muda o 'valor' das linhas do grupo financeiro, e so o sinal quando ha saida. Assinatura,
-- retorno, STABLE, SECURITY DEFINER, search_path, dono, OID e GRANTs ficam iguais; os totais, os
-- outros grupos, a ordem das linhas e o resto do resultado nao mudam. Corpo vigente: o da
-- 20261242000000 (md5 afc3e13805ce37819cfdcd094043087c) com UMA edicao na ultima agregacao.
-- Nenhum dado existente e tocado: e so a leitura que muda.
--
-- PRE-VOO: hash do corpo esperado (sem CR), atributos e ACL; aceita tambem o corpo desta
-- migration, entao reaplicar e inofensivo. POS-VOO confere o hash e todos os atributos (a
-- fotografia tirada antes tem de ser igual a de depois, exceto o texto).
-- Sem BEGIN/COMMIT de nivel superior: o aplicador fornece a transacao inteira (AGENTS.md).
-- ORDEM: depois da 20261242000000. COMPORTAMENTO: tests/banco/fin-dre-sinal-viva.cjs (so CI efemero).
-- ROLLBACK MANUAL: rollback-manual-20261382000000_o_resultado_mostra_tarifa_juro_e_quebra_como_despesa.sql
-- devolve o corpo anterior byte a byte (LF, sem CR); recusa corpo desconhecido e segundo rollback.
--
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

DO $preflight_20261382$
DECLARE
  r record;
  v_hash text;
  v_atributos jsonb;
BEGIN
  FOR r IN SELECT * FROM (VALUES
    ('public.fin_dre(date,date)', 'afc3e13805ce37819cfdcd094043087c', '2d191bc8120a9b188c04eeaaa0263110')
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
    PERFORM set_config('ikcous.dre382_atributos', v_atributos::text, true);
  END LOOP;
END $preflight_20261382$;

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
    -- CMV pelo custo do DIA da venda (marketplace_order_item_custo,
    -- 20261242000000); a venda de antes dela, sem registro, segue estimada pelo
    -- custo ATUAL do produto. Menos o que voltou para a prateleira por
    -- devolução no período. Achado K, refinado pelo achado 4 (rodada 2): a exclusão não é
    -- "stock_returned_at preenchido" sozinho — a política P1 (pago após
    -- expirar, HONRAR) deixa esse carimbo em pedido que foi reativado e
    -- ENTREGUE de verdade (não é mais cancelamento nenhum, e o produto SAIU
    -- da loja outra vez, com custo real). Só CANCELADO com estoque já de
    -- volta é que não custou nada; por isso a condição junta as duas coisas.
    (SELECT COALESCE(sum(oi.quantity * COALESCE(oic.custo, p.custo, 0)), 0)
       FROM mov m
       JOIN public.marketplace_orders o2 ON o2.id = m.pedido_id
       JOIN public.marketplace_order_items oi ON oi.order_id = m.pedido_id
       LEFT JOIN public.produtos p ON p.id = oi.product_id
       LEFT JOIN public.marketplace_order_item_custo oic ON oic.item_id = oi.id
      WHERE m.origem IN ('venda_online', 'venda_balcao', 'venda_entrega')
        AND NOT (o2.status = 'cancelled' AND o2.stock_returned_at IS NOT NULL)),
    -- Achado 5 (rodada 2): o desconto de devolução PARCIAL não pode contar de
    -- novo o item de um pedido que a linha acima JÁ excluiu inteiro (cancelado
    -- + estoque de volta) — sem este filtro, o mesmo item saía do CMV duas
    -- vezes (uma pela exclusão do pedido inteiro, outra por este desconto) e
    -- comia o custo de OUTRAS vendas do período.
    -- A devolução volta pelo MESMO custo com que a venda saiu (o do dia, se
    -- houver registro do item vendido; senão o de hoje do produto).
    (SELECT COALESCE(sum(di.quantidade * COALESCE(oic.custo, p.custo, 0)), 0)
       FROM public.devolucao_itens di
       JOIN public.devolucoes d3 ON d3.id = di.devolucao_id
       JOIN public.marketplace_orders o3 ON o3.id = d3.order_id
       LEFT JOIN public.produtos p ON p.id = di.product_id
       LEFT JOIN public.marketplace_order_item_custo oic ON oic.item_id = di.order_item_id
      WHERE di.reestocado_em IS NOT NULL
        AND public.fin__dia(di.reestocado_em) BETWEEN p_inicio AND p_fim
        AND NOT (o3.status = 'cancelled' AND o3.stock_returned_at IS NOT NULL)),
    -- 'cmv_estimado': true so se algum item que entrou na conta acima (venda ou devolucao do periodo) NAO tem o
    -- custo do dia gravado e usou o custo de HOJE do produto (20261242000000); antes era sempre true.
    (SELECT EXISTS (SELECT 1
                      FROM mov m
                      JOIN public.marketplace_orders o2 ON o2.id = m.pedido_id
                      JOIN public.marketplace_order_items oi ON oi.order_id = m.pedido_id
                      LEFT JOIN public.marketplace_order_item_custo oic ON oic.item_id = oi.id
                     WHERE m.origem IN ('venda_online', 'venda_balcao', 'venda_entrega')
                       AND NOT (o2.status = 'cancelled' AND o2.stock_returned_at IS NOT NULL)
                       AND oic.item_id IS NULL)
         OR EXISTS (SELECT 1
                      FROM public.devolucao_itens di
                      JOIN public.devolucoes d3 ON d3.id = di.devolucao_id
                      JOIN public.marketplace_orders o3 ON o3.id = d3.order_id
                      LEFT JOIN public.marketplace_order_item_custo oic ON oic.item_id = di.order_item_id
                     WHERE di.reestocado_em IS NOT NULL
                       AND public.fin__dia(di.reestocado_em) BETWEEN p_inicio AND p_fim
                       AND NOT (o3.status = 'cancelled' AND o3.stock_returned_at IS NOT NULL)
                       AND oic.item_id IS NULL)),
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

  v_cmv := GREATEST(v_cmv - v_cmv_volta, 0);
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
          WHERE v_cmv > 0
       ) x) || v_linhas_manuais
  );
END;
$$;

DO $conferencia_20261382$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p WHERE p.oid = to_regprocedure('public.fin_dre(date,date)')
      AND md5(replace(p.prosrc, E'\r', '')) = '2d191bc8120a9b188c04eeaaa0263110'
      AND (to_jsonb(p) - 'prosrc') = current_setting('ikcous.dre382_atributos')::jsonb
  ) THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: conferencia 20261382 falhou (corpo ou atributos alterados).';
  END IF;
END $conferencia_20261382$;

NOTIFY pgrst, 'reload schema';
