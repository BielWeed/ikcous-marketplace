-- Online sem metodo identificado nao pode entrar na soma de PIX.
-- So muda o rotulo derivado; nenhuma linha de pedido e reescrita.
-- Ultima definicao: 20261177000000_o_financeiro_da_loja_nasce.sql.
-- Assinatura, IMMUTABLE, search_path e ACL permanecem iguais.
--
-- ROLLBACK: rollback-manual-20261290000000_online_sem_forma_nao_e_pix.sql
-- Executar pelo aplicar-migrations.yml (corpo e ledger na mesma transacao).
-- A guarda de hash recusa desfazer por cima de uma redefinicao posterior.

CREATE OR REPLACE FUNCTION public.fin__forma_do_pedido(p_payment_method text, p_metodo_online text)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path = public
AS $$
  SELECT CASE p_payment_method
    WHEN 'online' THEN COALESCE(p_metodo_online, 'online_desconhecido')
    WHEN 'cash' THEN 'dinheiro'
    WHEN 'pix' THEN 'pix'
    WHEN 'card' THEN 'cartao'
    ELSE 'outro'
  END
$$;
REVOKE ALL ON FUNCTION public.fin__forma_do_pedido(text, text) FROM PUBLIC, anon, authenticated;
