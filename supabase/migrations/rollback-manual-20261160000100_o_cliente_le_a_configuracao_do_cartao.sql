-- ============================================================================
-- Rollback manual — o cliente lê a configuração do cartão (20261160000100)
-- ============================================================================
-- Tira a policy de leitura da linha 'pagamentos_cartao'. O cliente volta a
-- não ler nada de `app_settings`. ATENÇÃO: negação por RLS não é erro — a
-- leitura devolve "nenhuma linha", e a tela trata isso como o PADRÃO (crédito
-- e débito ligados, sem limite do app). Se o lojista tiver desligado algum
-- cartão, o Brick volta a oferecê-lo e o servidor recusa na hora de pagar
-- ("Esta loja não aceita…"): seguro para o dinheiro, ruim para o cliente.
-- Despublicar o cartão ANTES deste rollback evita isso.
--
-- Os GRANTs de tabela NÃO são revogados: esta migration não prova que eles
-- não existiam antes (o baseline saiu sem privilégios), e revogar poderia
-- tirar do painel do lojista um acesso que ele já tinha.
--
-- SEM BEGIN/COMMIT: quem abre a transação é quem aplica.

DROP POLICY IF EXISTS app_settings_config_cartao_select_policy ON public.app_settings;
