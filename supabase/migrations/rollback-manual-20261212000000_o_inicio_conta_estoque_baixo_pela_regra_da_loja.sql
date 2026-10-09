-- ============================================================================
-- Rollback manual — o Início conta estoque baixo pela regra da loja (20261212000000)
-- ============================================================================
-- Devolve, byte a byte, o corpo de `public.painel_inicio()` que a
-- 20261199000000_portas_do_painel_exigem_admin_atual.sql deixou (md5
-- ebcafff0ad5efbb70391a2cc93a14247): o cartão "Estoque baixo" do Início volta
-- a contar por variação, com limiar fixo 3 quando o produto não tem mínimo —
-- e volta a divergir da tela de Produtos. Mesma assinatura, mesmo STABLE
-- SECURITY DEFINER, mesmo search_path, mesma ACL (CREATE OR REPLACE preserva a
-- vigente); nada é apagado.
--
-- ORDEM: este rollback vem ANTES do rollback da 20261199000000 (o dela recusa
-- enquanto uma redefinição posterior de painel_inicio estiver no ar).
--
-- DADOS: a migration não gravou nada em linha nenhuma; não há dado a desfazer.
--
-- PRÉ-VOO: o `DO $preflight_rollback_20261212$` recusa com
-- `B1_BASELINE_DIVERGENT` — ANTES de qualquer escrita — se o corpo VIVO (md5
-- de `replace(prosrc, E'\r', '')`) não for exatamente o que a 20261212000000
-- deixou: desfazer por cima de uma redefinição POSTERIOR apagaria a dela em
-- silêncio, e desfazer duas vezes não tem o que desfazer.
--
-- Executar via `psql -1 -f` (nunca pelo db-apply, que registraria este
-- rollback no ledger como migration nova). Sem BEGIN/COMMIT de nível superior
-- neste arquivo — regra da casa.
-- ============================================================================

DO $preflight_rollback_20261212$
DECLARE
  r record;
  v_hash text;
BEGIN
  FOR r IN
    SELECT *
      FROM (VALUES
        ('public.painel_inicio()', 'f11d22d076c59ab54d1beb280954dd15')
      ) AS esperado(assinatura, hash_desta)
  LOOP
    SELECT md5(replace(prosrc, E'\r', '')) INTO v_hash
      FROM pg_proc
     WHERE oid = to_regprocedure(r.assinatura);

    IF v_hash IS DISTINCT FROM r.hash_desta THEN
      RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: corpo vivo de % (hash %) não é o que a 20261212000000 deixou — nada a desfazer, ou uma redefinição posterior está no ar; revise antes de reverter.', r.assinatura, COALESCE(v_hash, 'ausente');
    END IF;
  END LOOP;
END $preflight_rollback_20261212$;

-- painel_inicio: corpo vigente da 20261199000000_portas_do_painel_exigem_admin_atual.sql.
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
      'estoque_baixo', (SELECT count(*) FROM public.produtos p
                         WHERE p.deleted_at IS NULL AND COALESCE(p.ativo, true)
                           AND (
                             (NOT EXISTS (SELECT 1 FROM public.product_variants pv WHERE pv.product_id = p.id AND pv.active)
                              AND COALESCE(p.estoque, 0) <= COALESCE(p.estoque_minimo, 3))
                             OR EXISTS (SELECT 1 FROM public.product_variants pv
                                         WHERE pv.product_id = p.id AND pv.active
                                           AND COALESCE(pv.stock_increment, 0) <= COALESCE(p.estoque_minimo, 3))
                           ))
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
