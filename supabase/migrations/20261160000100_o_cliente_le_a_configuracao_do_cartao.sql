-- ============================================================================
-- Migration 20261160000100 — o cliente lê a configuração do cartão
-- (plano docs/superpowers/plans/2026-09-30-cartao-de-credito-e-debito.md, T4)
-- ============================================================================
--
-- O QUE PRECISA EXISTIR: o lojista escolhe no painel quais cartões aceita
-- (crédito, débito) e até quantas parcelas. Isso mora em `app_settings`,
-- linha `key = 'pagamentos_cartao'`, `value` em JSON
-- (`{"credito":true,"debito":true,"parcelas_max":null}` — o formato é do
-- parser único `supabase/functions/_shared/configuracao-cartao.ts`). A tela de
-- pagamento do CLIENTE precisa ler essa linha para o Payment Brick oferecer
-- só o que a loja aceita.
--
-- O QUE HOJE IMPEDE: a única policy de `app_settings` é
-- "Admins legacy access on app_settings" (TO authenticated, is_admin()) —
-- cliente não lê linha nenhuma.
--
-- O QUE ESTA MIGRATION FAZ: UMA policy de SELECT para `authenticated`
-- restrita a ESSA linha (`key = 'pagamentos_cartao'`). Nenhuma outra linha
-- de `app_settings` fica visível — em especial a `pagamentos_mercado_pago`,
-- que guarda o Access Token cifrado, continua só-admin. `anon` não entra:
-- pagar pelo app exige conta (política P6 do dono), e o Brick só monta para
-- sessão autenticada.
--
-- POR QUE O VALOR PODE SER LIDO PELO CLIENTE: não é segredo. Diz o que o
-- Brick já mostra na tela a qualquer cliente logado (quais cartões e
-- quantas parcelas). A trava de verdade é do servidor: `criar-pagamento`
-- relê a MESMA linha com service role e recusa o que não cabe.
--
-- GRANTS: o baseline (20260806000000) saiu sem privilégios de tabela, então
-- o repositório não prova que `authenticated` tem SELECT/INSERT/UPDATE em
-- `app_settings` (o painel do lojista grava esta linha pela policy de admin
-- que já existe). Os GRANTs abaixo são idempotentes e não abrem nada por si:
-- com RLS ligada, quem decide cada linha é a policy — leitura só desta
-- chave para cliente, escrita só para admin.
--
-- SEM BEGIN/COMMIT: quem abre a transação é quem aplica (AGENTS.md).
-- Rollback: rollback-manual-20261160000100_o_cliente_le_a_configuracao_do_cartao.sql

GRANT SELECT, INSERT, UPDATE ON public.app_settings TO authenticated;

DROP POLICY IF EXISTS app_settings_config_cartao_select_policy ON public.app_settings;

CREATE POLICY app_settings_config_cartao_select_policy
    ON public.app_settings
    FOR SELECT
    TO authenticated
    USING (key = 'pagamentos_cartao');

COMMENT ON POLICY app_settings_config_cartao_select_policy ON public.app_settings IS
    'Cliente logado lê SÓ a configuração do cartão (quais cartões e até quantas parcelas) — o Payment Brick oferece o que a loja aceita. Não é segredo; criar-pagamento relê com service role e é quem trava. Migration 20261160000100.';
