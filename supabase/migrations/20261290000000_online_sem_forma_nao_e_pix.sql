-- Online sem metodo identificado nao pode entrar na soma de PIX.
-- So muda o rotulo derivado; nenhuma linha de pedido e reescrita.
-- Ultima definicao: 20261177000000_o_financeiro_da_loja_nasce.sql.
-- Assinatura, IMMUTABLE, search_path e ACL permanecem iguais.
--
-- ROLLBACK: execute o bloco abaixo (definicao anterior, byte a byte).
/*
CREATE OR REPLACE FUNCTION public.fin__forma_do_pedido(p_payment_method text, p_metodo_online text)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path = public
AS $$
  SELECT CASE p_payment_method
    WHEN 'online' THEN COALESCE(p_metodo_online, 'pix')
    WHEN 'cash' THEN 'dinheiro'
    WHEN 'pix' THEN 'pix'
    WHEN 'card' THEN 'cartao'
    ELSE 'outro'
  END
$$;
REVOKE ALL ON FUNCTION public.fin__forma_do_pedido(text, text) FROM PUBLIC, anon, authenticated;
*/

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
