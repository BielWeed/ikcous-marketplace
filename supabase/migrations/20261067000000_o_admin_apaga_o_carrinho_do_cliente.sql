-- O ADMIN APAGA O CARRINHO DO CLIENTE (laudo varredura 01/09, achado A-2).
--
-- O DEFEITO: a policy `cart_items_delete_policy` (baseline
-- 20260806000000:5410, nenhuma migration viva a altera) é
-- `FOR DELETE USING (auth.uid() = user_id)` — SEM ramo de admin. Os botões
-- "remover item do carrinho"/"limpar carrinho" da ficha de outro usuário
-- (`AdminUserDetailView.tsx`) nunca funcionam: o Postgres pula as linhas
-- (0 afetadas), o PostgREST devolve "sucesso", e a tela responde "Nada foi
-- removido… o app não tem permissão". A assimetria é visível na MESMA
-- tabela: a `cart_items_select_policy` JÁ deixa o admin ver o carrinho do
-- cliente — só apagar ele não podia.
--
-- O QUE ESTA MIGRATION FAZ:
--   DROP + recria `cart_items_delete_policy` com o ramo de admin, na MESMA
--   forma em que as policies escritas à mão daqui chamam a função
--   (`(SELECT is_admin())`, como na 20261052000000) e na MESMA semântica do
--   ramo original (o dono continua apagando o próprio carrinho).
--
-- SEM BEGIN/COMMIT (regra da casa: o db-apply abre a transação).
--
-- FICHA DE VERIFICAÇÃO pos-aplicação: scripts/db-prove-cart-items-admin-apaga.cjs
-- (transação descartável com ROLLBACK: aplica a policy NOVA inline e prova
-- (a) admin apaga item de outro usuário; (b) usuário comum NÃO apaga item de
-- outro; (c) usuário comum apaga o PRÓPRIO item; controle negativo com a
-- policy VELHA inline mostrando o admin barrado). Pos-aplicação no banco,
-- conferir também:
--   SELECT indexname, indexdef FROM pg_indexes
--    WHERE tablename = 'cart_items';  -- (informativo)
--   SELECT policyname, cmd, qual FROM pg_policies
--    WHERE tablename = 'cart_items' AND policyname = 'cart_items_delete_policy';
--   -> qual = "((auth.uid() = user_id) OR (SELECT is_admin()))"
--
-- ROLLBACK MANUAL: versionado em
-- rollback-manual-20261067000000_o_admin_apaga_o_carrinho_do_cliente.sql
-- (recria a policy ORIGINAL do baseline, sem ramo de admin).

DROP POLICY IF EXISTS cart_items_delete_policy ON public.cart_items;

CREATE POLICY cart_items_delete_policy
    ON public.cart_items FOR DELETE
    TO authenticated
    USING ((SELECT auth.uid()) = user_id OR (SELECT is_admin()));
