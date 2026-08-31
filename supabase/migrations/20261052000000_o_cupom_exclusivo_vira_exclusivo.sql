-- O CUPOM EXCLUSIVO VIRA EXCLUSIVO DE VERDADE (laudo ofensiva+mobile do
-- molde, 31/08/2026, achado N3; decisão delegada pelo Gabriel em 31/08
-- "faça você, siga" sobre a ordem de conserto — opção SEGURA implementada,
-- reversível pelo rollback-manual).
--
-- O DEFEITO PROVADO AO VIVO: `coupons_select_policy` entregava a QUALQUER
-- visitante (roles = public) a leitura de todo cupom ativo — código, valor,
-- tipo, mínimo e limite. Com a chave anônima (que viaja no bundle):
--   GET /rest/v1/coupons?active=eq.true → HTTP 200 com CUPOM10 e TESTE20.
-- Cupom "exclusivo para cliente" não tinha segredo nenhum.
--
-- A DECISÃO (entre as duas do laudo): FECHAR. A promessa do cupom exclusivo
-- vale mais que a conveniência de listar. Quem valida cupom no checkout é a
-- RPC `validate_coupon_secure_v2` (SECURITY DEFINER, lê a tabela por dentro
-- — nada muda para o cliente que tem um cupom válido na mão). Quem lê a
-- tabela direto é só o painel (AdminCouponsView/realtime/admin_cache) — e
-- `is_admin()` continua deixando o admin ver tudo.
--
-- O que muda: a policy de SELECT passa a ser SÓ para `authenticated` com
-- `is_admin()`. Anon e cliente comum deixam de ler qualquer linha (ativa ou
-- não). INSERT/UPDATE/DELETE já eram admin-only e não mudam.
--
-- REVERSÍVEL: o rollback-manual restaura a policy anterior VERBATIM.
--
-- SEM BEGIN/COMMIT (regra da casa).
--
-- FICHA DE VERIFICAÇÃO pos-aplicação (com a chave anônima e um cupom ativo
-- no banco):
--   GET {SUPABASE_URL}/rest/v1/coupons?active=eq.true
--     com headers apikey/Authorization da chave ANON
--   -> espera HTTP 200 com ARRAY VAZIO (antes: lista com todos os cupons)
--   E, com sessão ADMIN: -> espera continuar listando (o painel não quebra)

DROP POLICY IF EXISTS coupons_select_policy ON public.coupons;

CREATE POLICY coupons_select_policy
    ON public.coupons FOR SELECT
    TO authenticated
    USING ((SELECT is_admin()));
