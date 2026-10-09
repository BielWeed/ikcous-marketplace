-- ============================================================================
-- Migration 20261212000000 — o Início conta estoque baixo pela regra da loja
-- (painel simples, onda I, item I1; 09/10/2026)
-- ============================================================================
--
-- 1. O DEFEITO QUE ESTA MIGRATION FECHA
--
-- O cartão "Estoque baixo" do Início (`painel_inicio()->'pendencias'->>
-- 'estoque_baixo'`) contava por uma régua só dele: limiar fixo 3 quando o
-- produto não tem `estoque_minimo`, e, em produto com variações, bastava UMA
-- variação ativa no limiar para o produto inteiro contar (20261199000000:
-- 1588-1596). Todo o resto do painel usa outra régua — a da loja:
-- `get_admin_analytics_v2` ("inventoryAlerts", 20261199000000:1735-1759), o
-- cartão do produto e o sino (`precisaDeReposicao`,
-- src/utils/avisos-do-lojista.ts:70-75; `mapProductFromDB`,
-- src/lib/mappers.ts). Resultado: o Início dizia um número e a tela de
-- Produtos outro, para o mesmo estoque.
--
-- 2. A REGRA (ÚNICA, a mesma em todo o painel)
--
-- Produto ativo (`ativo = true`) e não apagado (`deleted_at IS NULL`) está com
-- estoque baixo quando o ESTOQUE EFETIVO <= COALESCE(estoque_minimo, 5).
-- Estoque efetivo = soma de `stock_increment` das variações ATIVAS quando há
-- pelo menos uma; senão a coluna `produtos.estoque`. Produto com variações
-- alerta pela SOMA. O que muda é SÓ o trecho do `estoque_baixo`; o resto do
-- corpo é o vigente da 20261199000000 byte a byte (guarda do admin atual
-- inclusa). Assinatura, RETURNS, STABLE, SECURITY DEFINER e search_path iguais;
-- `CREATE OR REPLACE` preserva dono e ACL — nenhum GRANT/REVOKE aqui, e
-- `database.types.ts` não muda. Resíduo declarado: `estoque`/`ativo` NULL não
-- contam aqui (o front os trata como 0/ativo); o app nunca grava NULL.
--
-- 3. DADOS EXISTENTES
--
-- Nenhuma linha é lida para decidir nem reescrita ao aplicar — só o corpo de
-- uma função muda. O número do cartão muda na próxima leitura do Início.
--
-- 4. PRÉ-VOO (B1_BASELINE_DIVERGENT, ANTES de qualquer escrita)
--
-- Recusa se o corpo vivo de `public.painel_inicio()`, por
-- `md5(replace(prosrc, E'\r', ''))`, não for o vigente (o da 20261199000000)
-- nem o que esta migration deixa: corpo diferente é redefinição que este
-- arquivo não conhece, e substituí-lo apagaria o trabalho dela. Os hashes são
-- o md5 REAL dos corpos, amarrados ao texto por
-- tests/migration_o_inicio_conta_estoque_baixo_pela_regra_da_loja_test.ts.
--
-- 5. IDEMPOTÊNCIA
--
-- O pré-voo aceita o corpo desta migration; `CREATE OR REPLACE` com o mesmo
-- texto deixa o mesmo estado. Reaplicar é o mesmo que aplicar uma vez.
--
-- 6. TRANSAÇÃO
--
-- Sem BEGIN/COMMIT de nível superior (regra da casa, AGENTS.md). O workflow
-- `aplicar-migrations.yml` manda o arquivo inteiro numa consulta só: o
-- pré-voo e o corpo caem juntos ou não caem. Num banco local, `psql -1`.
--
-- 7. ORDEM E ROLLBACK
--
-- Depois da 20261199000000 (o pré-voo recusa sem ela). Independe da
-- 20261213000000 e da 20261214000000 (funções diferentes). ROLLBACK MANUAL:
-- rollback-manual-20261212000000_o_inicio_conta_estoque_baixo_pela_regra_da_loja.sql
-- devolve o corpo da 20261199000000 byte a byte.
-- Este rollback vem ANTES do rollback da 20261199000000: o da 99 recusa
-- enquanto houver redefinição posterior no ar
-- (rollback-manual-20261199000000…:93) — é o comportamento certo.
--
-- 8. FICHA DE VERIFICAÇÃO
--
--   1. SELECT md5(replace(prosrc, E'\r', '')) FROM pg_proc
--       WHERE oid = to_regprocedure('public.painel_inicio()');
--      -- esperado: f11d22d076c59ab54d1beb280954dd15.
--   2. Como admin: `painel_inicio()->'pendencias'->>'estoque_baixo'` igual a
--      `get_admin_analytics_v2(90)->>'inventoryAlerts'`.
--   3. `proacl`, `prosecdef` e `proconfig` iguais antes e depois.
--   PROVA VIVA: tests/banco/estoque-baixo-uma-regra-viva.cjs (rpc-ci).
-- ============================================================================

DO $preflight_20261212$
DECLARE
  r record;
  v_hash text;
BEGIN
  FOR r IN
    SELECT *
      FROM (VALUES
        ('public.painel_inicio()', 'ebcafff0ad5efbb70391a2cc93a14247', 'f11d22d076c59ab54d1beb280954dd15')
      ) AS esperado(assinatura, hash_vigente, hash_desta)
  LOOP
    SELECT md5(replace(prosrc, E'\r', '')) INTO v_hash
      FROM pg_proc
     WHERE oid = to_regprocedure(r.assinatura);

    IF v_hash IS NULL OR v_hash NOT IN (r.hash_vigente, r.hash_desta) THEN
      RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: corpo vivo de % (hash %) não é o vigente antes desta migration nem o que ela deixa — capture o corpo vivo e revise antes de aplicar.', r.assinatura, COALESCE(v_hash, 'ausente');
    END IF;
  END LOOP;
END $preflight_20261212$;

-- painel_inicio: corpo vigente da 20261199000000_portas_do_painel_exigem_admin_atual.sql,
-- com o trecho do 'estoque_baixo' trocado pela regra da loja.
CREATE OR REPLACE FUNCTION public.painel_inicio()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $$
DECLARE
  v_hoje date := public.fin__hoje();
  v_mes_inicio date := date_trunc('month', public.fin__hoje())::date;
  v_mes_ant_inicio date := (date_trunc('month', public.fin__hoje()) - interval '1 month')::date;
  v_mes_ant_fim date;
  v_lucro numeric;
  v_res jsonb;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Acesso negado.' USING ERRCODE = '42501';
  END IF;
  -- Papel ATUAL (auth.users E profiles), não o do JWT: admin rebaixado para aqui (20261199000000).
  IF NOT public.is_admin_atual() THEN
    RAISE EXCEPTION 'Acesso negado.' USING ERRCODE = '42501';
  END IF;
  -- Mesmos dias do mês anterior (dia 1 até o mesmo dia do mês, ou o fim dele).
  v_mes_ant_fim := LEAST(v_mes_ant_inicio + (v_hoje - v_mes_inicio), v_mes_inicio - 1);
  v_lucro := (public.fin_dre(v_mes_inicio, v_hoje) ->> 'lucro_liquido')::numeric;

  WITH v AS (
    SELECT * FROM public.crm__vendas(now()) WHERE dia >= v_mes_ant_inicio - 14
  ), prev AS (
    SELECT m.*, COALESCE(m.vencimento, m.data) AS venc
      FROM public.fin__movimentos(NULL, NULL) m WHERE m.status = 'previsto'
  )
  SELECT jsonb_build_object(
    'hoje', jsonb_build_object(
      'receita', (SELECT COALESCE(sum(total), 0) FROM v WHERE dia = v_hoje),
      'online', (SELECT COALESCE(sum(total), 0) FROM v WHERE dia = v_hoje AND canal = 'online'),
      'presencial', (SELECT COALESCE(sum(total), 0) FROM v WHERE dia = v_hoje AND canal = 'presencial'),
      'pedidos', (SELECT count(*) FROM v WHERE dia = v_hoje),
      'receita_semana_passada', (SELECT COALESCE(sum(total), 0) FROM v WHERE dia = v_hoje - 7)
    ),
    'mes', jsonb_build_object(
      'receita', (SELECT COALESCE(sum(total), 0) FROM v WHERE dia BETWEEN v_mes_inicio AND v_hoje),
      'receita_mes_anterior', (SELECT COALESCE(sum(total), 0) FROM v WHERE dia BETWEEN v_mes_ant_inicio AND v_mes_ant_fim),
      'pedidos', (SELECT count(*) FROM v WHERE dia BETWEEN v_mes_inicio AND v_hoje),
      'ticket_medio', (SELECT COALESCE(round(avg(total), 2), 0) FROM v WHERE dia BETWEEN v_mes_inicio AND v_hoje),
      'lucro_estimado', v_lucro
    ),
    'saldo_total', (SELECT COALESCE(round(sum(s.saldo), 2), 0)
                      FROM public.fin__saldos() s JOIN public.fin_contas c ON c.id = s.conta_id WHERE c.ativa),
    'a_receber_7d', (SELECT COALESCE(sum(valor), 0) FROM prev WHERE tipo = 'entrada' AND venc <= v_hoje + 7),
    'a_pagar_7d', (SELECT COALESCE(sum(valor), 0) FROM prev WHERE tipo = 'saida' AND venc <= v_hoje + 7),
    'contas_vencidas', (SELECT count(*) FROM prev WHERE tipo = 'saida' AND venc < v_hoje),
    'pendencias', jsonb_build_object(
      'pedidos_para_preparar', (SELECT count(*) FROM public.marketplace_orders o
                                 WHERE o.status IN ('new', 'pending', 'processing')
                                   AND COALESCE(o.payment_status, '') NOT IN ('aguardando', 'expirado', 'recusado', 'estornado')),
      'devolucoes_abertas', (SELECT count(*) FROM public.devolucoes d
                              WHERE d.status IN ('solicitada', 'aprovada', 'em_transito', 'recebida')),
      'caixa_aberto', EXISTS (SELECT 1 FROM public.fin_caixa_sessoes s WHERE s.status = 'aberto'),
      'estoque_baixo', (SELECT count(*)
                          FROM public.produtos p
                          LEFT JOIN LATERAL (
                            SELECT count(*) FILTER (WHERE pv.active) AS qtd_ativas,
                                   sum(COALESCE(pv.stock_increment, 0)) FILTER (WHERE pv.active) AS soma_ativas
                              FROM public.product_variants pv
                             WHERE pv.product_id = p.id
                          ) v ON true
                         WHERE p.deleted_at IS NULL AND p.ativo = true
                           AND CASE WHEN COALESCE(v.qtd_ativas, 0) > 0 THEN COALESCE(v.soma_ativas, 0)
                                    ELSE p.estoque END
                               <= COALESCE(p.estoque_minimo, 5))
    ),
    'serie_14d', (SELECT jsonb_agg(jsonb_build_object(
                     'dia', d.dia::date,
                     'receita', COALESCE((SELECT sum(total) FROM v WHERE v.dia = d.dia::date), 0)
                   ) ORDER BY d.dia)
                    FROM generate_series((v_hoje - 13)::timestamp, v_hoje::timestamp, interval '1 day') AS d(dia))
  ) INTO v_res;
  RETURN v_res;
END;
$$;
