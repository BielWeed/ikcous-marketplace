-- ROLLBACK MANUAL de 20261052000000_o_cupom_exclusivo_vira_exclusivo.sql
-- (laudo ofensiva 3108, achado N3 — cupom exclusivo de verdade).
--
-- O QUE ESTE ROLLBACK DESFAZ: restaura `coupons_select_policy` para o corpo
-- ANTERIOR VERBATIM — anon volta a ler todo cupom ativo (o estado do
-- achado N3). Só usar se estiver reverting a decisão de propósito.
--
-- SEM BEGIN/COMMIT (regra da casa).

DROP POLICY IF EXISTS coupons_select_policy ON public.coupons;

CREATE POLICY coupons_select_policy
    ON public.coupons FOR SELECT
    USING ((active = true) OR ((( SELECT auth.role() AS role) = 'authenticated'::text) AND ( SELECT is_admin() AS is_admin)));
