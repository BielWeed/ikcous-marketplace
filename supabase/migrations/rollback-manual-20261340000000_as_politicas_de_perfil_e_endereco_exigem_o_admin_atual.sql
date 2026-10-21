-- Rollback manual da 20261340000000 (as politicas de perfil, endereco, carrinho e notificacao exigem o admin de agora).
-- Devolve, nas 13 politicas, a porta `(SELECT public.is_admin())` de antes; o ramo do proprio dono, o comando, os papeis
-- e o nome ficam como estao. Nenhuma linha e lida ou reescrita; nenhum GRANT/REVOKE.
-- ORDEM: este rollback vem ANTES do rollback da 20261202000000 e do da 20261197000000 — o da 97 recusa enquanto qualquer
-- politica fora da 97 ainda usar rls_admin_atual(), e e' ESTE arquivo que tira as 13 daqui.
-- Sem controle de transacao: o aplicador abre a transacao. O pre-voo recusa SEM escrever quando alguma politica nao esta
-- como a 20261340000000 a deixa (inclusive um segundo rollback seguido).

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

DO $preflight_rollback_20261340$
DECLARE
  r record;
  v_caminho text;
  v_qual text;
  v_check text;
  v_cmd text;
  v_perm boolean;
  v_roles text;
BEGIN
  -- Cada uma das 13 politicas tem de estar EXATAMENTE como a 20261340000000 a deixa: se ja voltou, ou se alguem
  -- mexeu depois, recusa sem escrever nada (um segundo rollback cai aqui).
  v_caminho := current_setting('search_path');
  PERFORM set_config('search_path', 'pg_catalog', true);
  FOR r IN
    SELECT *
      FROM (VALUES
        ('public.profiles', 'profiles_select_policy', 'r', '((( SELECT auth.uid() AS uid) = id) OR ( SELECT public.rls_admin_atual() AS rls_admin_atual))', NULL::text),
        ('public.profiles', 'profiles_update_policy', 'w', '((( SELECT auth.uid() AS uid) = id) OR ( SELECT public.rls_admin_atual() AS rls_admin_atual))', '((( SELECT auth.uid() AS uid) = id) OR ( SELECT public.rls_admin_atual() AS rls_admin_atual))'),
        ('public.user_addresses', 'user_addresses_all_policy', '*', '((( SELECT auth.uid() AS uid) = user_id) OR ( SELECT public.rls_admin_atual() AS rls_admin_atual))', '((( SELECT auth.uid() AS uid) = user_id) OR ( SELECT public.rls_admin_atual() AS rls_admin_atual))'),
        ('public.push_subscriptions', 'push_subscriptions_all_policy', '*', '((( SELECT auth.uid() AS uid) = user_id) OR ( SELECT public.rls_admin_atual() AS rls_admin_atual))', '((( SELECT auth.uid() AS uid) = user_id) OR ( SELECT public.rls_admin_atual() AS rls_admin_atual))'),
        ('public.cart_items', 'cart_items_select_policy', 'r', '((( SELECT auth.uid() AS uid) = user_id) OR ( SELECT public.rls_admin_atual() AS rls_admin_atual))', NULL::text),
        ('public.cart_items', 'cart_items_delete_policy', 'd', '((( SELECT auth.uid() AS uid) = user_id) OR ( SELECT public.rls_admin_atual() AS rls_admin_atual))', NULL::text),
        ('public.notificacoes', 'notificacoes_select_policy', 'r', '((( SELECT auth.uid() AS uid) = usuario_id) OR (usuario_id IS NULL) OR ( SELECT public.rls_admin_atual() AS rls_admin_atual))', NULL::text),
        ('public.notificacoes', 'notificacoes_insert_policy', 'a', NULL::text, '((( SELECT auth.uid() AS uid) = usuario_id) OR ( SELECT public.rls_admin_atual() AS rls_admin_atual))'),
        ('public.notificacoes', 'notificacoes_update_policy', 'w', '((( SELECT auth.uid() AS uid) = usuario_id) OR ( SELECT public.rls_admin_atual() AS rls_admin_atual))', '((( SELECT auth.uid() AS uid) = usuario_id) OR ( SELECT public.rls_admin_atual() AS rls_admin_atual))'),
        ('public.notificacoes', 'notificacoes_delete_policy', 'd', '((( SELECT auth.uid() AS uid) = usuario_id) OR ( SELECT public.rls_admin_atual() AS rls_admin_atual))', NULL::text),
        ('public.push_notifications_log', 'push_notifications_log_admin_all_policy', '*', '( SELECT public.rls_admin_atual() AS rls_admin_atual)', '( SELECT public.rls_admin_atual() AS rls_admin_atual)'),
        ('public.analytics_events', 'analytics_events_select_policy', 'r', '( SELECT public.rls_admin_atual() AS rls_admin_atual)', NULL::text),
        ('public.store_shipping_credentials', 'Admins have full access to shipping credentials', '*', '( SELECT public.rls_admin_atual() AS rls_admin_atual)', '( SELECT public.rls_admin_atual() AS rls_admin_atual)')
      ) AS esperado(tabela, politica, comando, qual_desta, check_desta)
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
       OR v_roles IS DISTINCT FROM 'authenticated'
       OR v_qual IS DISTINCT FROM r.qual_desta
       OR v_check IS DISTINCT FROM r.check_desta THEN
      RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: politica % em % (comando %, papeis %, USING %, WITH CHECK %) nao e a que a 20261340000000 deixou — nada a desfazer, ou alteracao posterior; revise antes de reverter.', r.politica, r.tabela, COALESCE(v_cmd, '-'), COALESCE(v_roles, '-'), COALESCE(v_qual, 'nulo'), COALESCE(v_check, 'nulo');
    END IF;
  END LOOP;
  PERFORM set_config('search_path', v_caminho, true);
END $preflight_rollback_20261340$;

ALTER POLICY profiles_select_policy ON public.profiles
  USING ((((SELECT auth.uid()) = id) OR (SELECT public.is_admin())));

ALTER POLICY profiles_update_policy ON public.profiles
  USING ((((SELECT auth.uid()) = id) OR (SELECT public.is_admin())))
  WITH CHECK ((((SELECT auth.uid()) = id) OR (SELECT public.is_admin())));

ALTER POLICY user_addresses_all_policy ON public.user_addresses
  USING ((((SELECT auth.uid()) = user_id) OR (SELECT public.is_admin())))
  WITH CHECK ((((SELECT auth.uid()) = user_id) OR (SELECT public.is_admin())));

ALTER POLICY push_subscriptions_all_policy ON public.push_subscriptions
  USING ((((SELECT auth.uid()) = user_id) OR (SELECT public.is_admin())))
  WITH CHECK ((((SELECT auth.uid()) = user_id) OR (SELECT public.is_admin())));

ALTER POLICY cart_items_select_policy ON public.cart_items
  USING ((((SELECT auth.uid()) = user_id) OR (SELECT public.is_admin())));

ALTER POLICY cart_items_delete_policy ON public.cart_items
  USING ((((SELECT auth.uid()) = user_id) OR (SELECT public.is_admin())));

ALTER POLICY notificacoes_select_policy ON public.notificacoes
  USING ((((SELECT auth.uid()) = usuario_id) OR (usuario_id IS NULL) OR (SELECT public.is_admin())));

ALTER POLICY notificacoes_insert_policy ON public.notificacoes
  WITH CHECK ((((SELECT auth.uid()) = usuario_id) OR (SELECT public.is_admin())));

ALTER POLICY notificacoes_update_policy ON public.notificacoes
  USING ((((SELECT auth.uid()) = usuario_id) OR (SELECT public.is_admin())))
  WITH CHECK ((((SELECT auth.uid()) = usuario_id) OR (SELECT public.is_admin())));

ALTER POLICY notificacoes_delete_policy ON public.notificacoes
  USING ((((SELECT auth.uid()) = usuario_id) OR (SELECT public.is_admin())));

ALTER POLICY push_notifications_log_admin_all_policy ON public.push_notifications_log
  USING (((SELECT public.is_admin())))
  WITH CHECK (((SELECT public.is_admin())));

ALTER POLICY analytics_events_select_policy ON public.analytics_events
  USING (((SELECT public.is_admin())));

ALTER POLICY "Admins have full access to shipping credentials" ON public.store_shipping_credentials
  USING (((SELECT public.is_admin())))
  WITH CHECK (((SELECT public.is_admin())));
