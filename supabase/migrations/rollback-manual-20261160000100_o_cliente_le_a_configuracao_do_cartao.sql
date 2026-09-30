-- ============================================================================
-- Rollback manual — o cliente lê a configuração do cartão (20261160000100)
-- ============================================================================
-- Tira a policy de leitura da linha 'pagamentos_cartao'. O cliente volta a
-- não ler nada de `app_settings`; a tela de pagamento, sem conseguir ler a
-- configuração, oferece só PIX (falha fechada para cartão — o servidor já
-- recusaria de qualquer jeito o que não coubesse).
--
-- Os GRANTs de tabela NÃO são revogados: esta migration não prova que eles
-- não existiam antes (o baseline saiu sem privilégios), e revogar poderia
-- tirar do painel do lojista um acesso que ele já tinha.
--
-- SEM BEGIN/COMMIT: quem abre a transação é quem aplica.

DROP POLICY IF EXISTS app_settings_config_cartao_select_policy ON public.app_settings;
