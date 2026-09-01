-- ROLLBACK MANUAL de 20261067000000_o_admin_apaga_o_carrinho_do_cliente.sql
-- (laudo varredura 01/09, achado A-2).
--
-- Restaura a policy `cart_items_delete_policy` EXATAMENTE como está no
-- baseline 20260806000000_do_schema_vivo.sql:5410 (pg_dump da árvore viva):
-- só o dono apaga, sem ramo de admin — o defeito A-2 volta com ela.
--
-- SEM BEGIN/COMMIT (regra da casa). Aplicar à mão, pelo painel do Supabase
-- ou pelo db-apply, nunca por `supabase db push`.

DROP POLICY IF EXISTS cart_items_delete_policy ON public.cart_items;

CREATE POLICY cart_items_delete_policy ON public.cart_items FOR DELETE TO "authenticated" USING ((( SELECT "auth"."uid"() AS "uid") = "user_id"));
