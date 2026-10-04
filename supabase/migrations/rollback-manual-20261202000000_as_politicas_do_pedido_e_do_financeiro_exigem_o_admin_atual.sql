-- ============================================================================
-- Rollback manual — as políticas do pedido, da devolução e do financeiro
-- exigem o admin de agora (20261202000000)
-- ============================================================================
-- Devolve as 14 políticas à expressão exata de antes (`is_admin()`, a porta do
-- JWT): marketplace_order_items e marketplace_order_history da baseline
-- 20260806000000; order_shipping_events da 20261080000000;
-- mkt_order_payment_history_select da 20261020000000; devolucoes,
-- devolucao_itens e devolucao_eventos da 20261175000000; fin_contas,
-- fin_categorias, fin_caixa_sessoes e fin_lancamentos da 20261177000000.
-- `ALTER POLICY` só troca a expressão: nome, comando e papéis não são tocados;
-- nada além das 14 expressões muda (nenhuma função, GRANT ou outra política).
-- NÃO apaga rls_admin_atual() nem is_admin_atual() — são da 20261197000000.
--
-- Depois do rollback o defeito volta: um admin rebaixado com JWT ainda válido
-- (até ~1 h) volta a LER e ESCREVER direto nestas tabelas. Reverter só faz
-- sentido se a porta estiver recusando um admin legítimo.
-- ORDEM: este rollback vem ANTES do da 20261197000000 (que apaga
-- rls_admin_atual(), de que estas 14 políticas dependem).
--
-- DADOS: a migration não gravou nada em linha nenhuma (só escondeu e recusou),
-- então não há dado a desfazer.
--
-- PRÉ-VOO: o `DO $preflight_rollback_20261202$` recusa com
-- `B1_BASELINE_DIVERGENT` — ANTES de qualquer escrita — se alguma das 14
-- políticas (ou rls_admin_atual() / is_admin_atual()) não estiver exatamente no
-- estado que a 20261202000000 deixou: desfazer por cima de uma redefinição
-- POSTERIOR apagaria a dela em silêncio, e desfazer duas vezes não tem o que
-- desfazer. Mesma transação do restante: recusa = nada gravado.
--
-- Executar via `psql -1 -f` (nunca pelo db-apply, que registraria este rollback
-- no ledger de migrations como se fosse uma migration nova). Sem BEGIN/COMMIT
-- de nível superior neste arquivo — regra da casa.
-- ============================================================================

DO $preflight_rollback_20261202$
DECLARE
  r record;
  v_hash text;
  v_caminho text;
  v_qual text;
  v_check text;
  v_cmd text;
  v_perm boolean;
  v_roles text;
BEGIN
  FOR r IN
    SELECT *
      FROM (VALUES
        ('public.is_admin_atual()', '519842163e48cc377ac1337ffb9db936'),
        ('public.rls_admin_atual()', 'ccb7a56e835b8181795fffb7bee97305')
      ) AS esperado(assinatura, hash_da_97)
  LOOP
    SELECT md5(replace(prosrc, E'\r', '')) INTO v_hash
      FROM pg_proc
     WHERE oid = to_regprocedure(r.assinatura);

    IF v_hash IS DISTINCT FROM r.hash_da_97 THEN
      RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: % (hash %) não é a da 20261197000000 — nada a desfazer com segurança; revise antes de reverter.', r.assinatura, COALESCE(v_hash, 'ausente');
    END IF;
  END LOOP;

  v_caminho := current_setting('search_path');
  PERFORM set_config('search_path', 'pg_catalog', true);
  FOR r IN
    SELECT *
      FROM (VALUES
        ('public.marketplace_order_items', 'order_items_all_policy', '*', 'authenticated',
         E'(( SELECT public.rls_admin_atual() AS rls_admin_atual) OR (EXISTS ( SELECT 1\n   FROM public.marketplace_orders mo\n  WHERE ((mo.id = marketplace_order_items.order_id) AND (mo.user_id = ( SELECT auth.uid() AS uid))))))', E'(( SELECT public.rls_admin_atual() AS rls_admin_atual) OR (EXISTS ( SELECT 1\n   FROM public.marketplace_orders mo\n  WHERE ((mo.id = marketplace_order_items.order_id) AND (mo.user_id = ( SELECT auth.uid() AS uid))))))'),
        ('public.marketplace_order_history', 'order_history_all_policy', '*', 'authenticated',
         E'(( SELECT public.rls_admin_atual() AS rls_admin_atual) OR (EXISTS ( SELECT 1\n   FROM public.marketplace_orders mo\n  WHERE ((mo.id = marketplace_order_history.order_id) AND (mo.user_id = ( SELECT auth.uid() AS uid))))))', E'(( SELECT public.rls_admin_atual() AS rls_admin_atual) OR (EXISTS ( SELECT 1\n   FROM public.marketplace_orders mo\n  WHERE ((mo.id = marketplace_order_history.order_id) AND (mo.user_id = ( SELECT auth.uid() AS uid))))))'),
        ('public.order_shipping_events', 'order_shipping_events_select_policy', 'r', 'authenticated',
         E'(( SELECT public.rls_admin_atual() AS rls_admin_atual) OR (EXISTS ( SELECT 1\n   FROM public.marketplace_orders o\n  WHERE ((o.id = order_shipping_events.order_id) AND (o.user_id = ( SELECT auth.uid() AS uid))))))', NULL::text),
        ('public.order_shipping_events', 'order_shipping_events_admin_insert_policy', 'a', 'authenticated',
         NULL::text, E'( SELECT public.rls_admin_atual() AS rls_admin_atual)'),
        ('public.order_shipping_events', 'order_shipping_events_admin_update_policy', 'w', 'authenticated',
         E'( SELECT public.rls_admin_atual() AS rls_admin_atual)', E'( SELECT public.rls_admin_atual() AS rls_admin_atual)'),
        ('public.order_shipping_events', 'order_shipping_events_admin_delete_policy', 'd', 'authenticated',
         E'( SELECT public.rls_admin_atual() AS rls_admin_atual)', NULL::text),
        ('public.marketplace_order_payment_history', 'mkt_order_payment_history_select', 'r', 'public',
         E'( SELECT public.rls_admin_atual() AS rls_admin_atual)', NULL::text),
        ('public.devolucoes', 'devolucoes_dono_ou_admin_select_policy', 'r', 'authenticated',
         E'((user_id = ( SELECT auth.uid() AS uid)) OR ( SELECT public.rls_admin_atual() AS rls_admin_atual))', NULL::text),
        ('public.devolucao_itens', 'devolucao_itens_dono_ou_admin_select_policy', 'r', 'authenticated',
         E'(( SELECT public.rls_admin_atual() AS rls_admin_atual) OR (devolucao_id IN ( SELECT d.id\n   FROM public.devolucoes d\n  WHERE (d.user_id = ( SELECT auth.uid() AS uid)))))', NULL::text),
        ('public.devolucao_eventos', 'devolucao_eventos_dono_ou_admin_select_policy', 'r', 'authenticated',
         E'(( SELECT public.rls_admin_atual() AS rls_admin_atual) OR (devolucao_id IN ( SELECT d.id\n   FROM public.devolucoes d\n  WHERE (d.user_id = ( SELECT auth.uid() AS uid)))))', NULL::text),
        ('public.fin_contas', 'fin_contas_admin_select_policy', 'r', 'authenticated',
         E'( SELECT public.rls_admin_atual() AS rls_admin_atual)', NULL::text),
        ('public.fin_categorias', 'fin_categorias_admin_select_policy', 'r', 'authenticated',
         E'( SELECT public.rls_admin_atual() AS rls_admin_atual)', NULL::text),
        ('public.fin_caixa_sessoes', 'fin_caixa_sessoes_admin_select_policy', 'r', 'authenticated',
         E'( SELECT public.rls_admin_atual() AS rls_admin_atual)', NULL::text),
        ('public.fin_lancamentos', 'fin_lancamentos_admin_select_policy', 'r', 'authenticated',
         E'( SELECT public.rls_admin_atual() AS rls_admin_atual)', NULL::text)
      ) AS esperado(tabela, politica, comando, papeis, qual_desta, check_desta)
  LOOP
    SELECT pg_get_expr(p.polqual, p.polrelid), pg_get_expr(p.polwithcheck, p.polrelid),
           p.polcmd::text, p.polpermissive,
           array_to_string(ARRAY(SELECT CASE WHEN x = 0 THEN 'public' ELSE x::regrole::text END
                                   FROM unnest(p.polroles) AS x ORDER BY 1), ',')
      INTO v_qual, v_check, v_cmd, v_perm, v_roles
      FROM pg_policy p
     WHERE p.polrelid = to_regclass(r.tabela)
       AND p.polname = r.politica;

    IF NOT FOUND
       OR v_cmd IS DISTINCT FROM r.comando
       OR v_perm IS DISTINCT FROM true
       OR v_roles IS DISTINCT FROM r.papeis
       OR v_qual IS DISTINCT FROM r.qual_desta
       OR v_check IS DISTINCT FROM r.check_desta THEN
      RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: política % em % (comando %, papéis %, USING %, WITH CHECK %) não é a que a 20261202000000 deixou — nada a desfazer, ou uma redefinição posterior está no ar; revise antes de reverter.', r.politica, r.tabela, COALESCE(v_cmd, '-'), COALESCE(v_roles, '-'), COALESCE(v_qual, 'nulo'), COALESCE(v_check, 'nulo');
    END IF;
  END LOOP;
  PERFORM set_config('search_path', v_caminho, true);
END $preflight_rollback_20261202$;

ALTER POLICY order_items_all_policy ON public.marketplace_order_items
  USING (((SELECT public.is_admin())
    OR EXISTS (
      SELECT 1 FROM public.marketplace_orders mo
      WHERE mo.id = marketplace_order_items.order_id
        AND mo.user_id = (SELECT auth.uid())
    )))
  WITH CHECK (((SELECT public.is_admin())
    OR EXISTS (
      SELECT 1 FROM public.marketplace_orders mo
      WHERE mo.id = marketplace_order_items.order_id
        AND mo.user_id = (SELECT auth.uid())
    )));

ALTER POLICY order_history_all_policy ON public.marketplace_order_history
  USING (((SELECT public.is_admin())
    OR EXISTS (
      SELECT 1 FROM public.marketplace_orders mo
      WHERE mo.id = marketplace_order_history.order_id
        AND mo.user_id = (SELECT auth.uid())
    )))
  WITH CHECK (((SELECT public.is_admin())
    OR EXISTS (
      SELECT 1 FROM public.marketplace_orders mo
      WHERE mo.id = marketplace_order_history.order_id
        AND mo.user_id = (SELECT auth.uid())
    )));

ALTER POLICY order_shipping_events_select_policy ON public.order_shipping_events
  USING (((SELECT public.is_admin())
    OR EXISTS (
      SELECT 1 FROM public.marketplace_orders o
      WHERE o.id = order_shipping_events.order_id
        AND o.user_id = (SELECT auth.uid())
    )));

ALTER POLICY order_shipping_events_admin_insert_policy ON public.order_shipping_events
  WITH CHECK ((SELECT public.is_admin()));

ALTER POLICY order_shipping_events_admin_update_policy ON public.order_shipping_events
  USING ((SELECT public.is_admin()))
  WITH CHECK ((SELECT public.is_admin()));

ALTER POLICY order_shipping_events_admin_delete_policy ON public.order_shipping_events
  USING ((SELECT public.is_admin()));

ALTER POLICY mkt_order_payment_history_select ON public.marketplace_order_payment_history
  USING (public.is_admin());

ALTER POLICY devolucoes_dono_ou_admin_select_policy ON public.devolucoes
  USING ((user_id = (SELECT auth.uid()) OR (SELECT public.is_admin())));

ALTER POLICY devolucao_itens_dono_ou_admin_select_policy ON public.devolucao_itens
  USING (((SELECT public.is_admin())
    OR devolucao_id IN (SELECT d.id FROM public.devolucoes d WHERE d.user_id = (SELECT auth.uid()))));

ALTER POLICY devolucao_eventos_dono_ou_admin_select_policy ON public.devolucao_eventos
  USING (((SELECT public.is_admin())
    OR devolucao_id IN (SELECT d.id FROM public.devolucoes d WHERE d.user_id = (SELECT auth.uid()))));

ALTER POLICY fin_contas_admin_select_policy ON public.fin_contas
  USING ((SELECT public.is_admin()));

ALTER POLICY fin_categorias_admin_select_policy ON public.fin_categorias
  USING ((SELECT public.is_admin()));

ALTER POLICY fin_caixa_sessoes_admin_select_policy ON public.fin_caixa_sessoes
  USING ((SELECT public.is_admin()));

ALTER POLICY fin_lancamentos_admin_select_policy ON public.fin_lancamentos
  USING ((SELECT public.is_admin()));
