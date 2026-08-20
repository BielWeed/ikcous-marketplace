-- O e-mail de confirmacao de pedido sai UMA vez por pedido (PEDIDO-070, #106).
--
-- POR QUE A TRAVA VEM DO BANCO, E NAO DO CODIGO QUE ENVIA
--   Quem dispara o envio e' o navegador do cliente, e navegador repete: dois
--   toques, recarregar a pagina, o StrictMode do React montando o componente
--   duas vezes, uma retentativa de rede que ja tinha dado certo. Qualquer
--   contador guardado na funcao que envia perde para isso, porque cada
--   invocacao e' um processo novo, sem memoria da anterior.
--
--   E o custo de errar nao e' cosmetico: a conta de Gmail da loja entrega ~100
--   mensagens por dia. Um laco de reenvio nao "manda e-mail repetido", ele
--   esgota a cota e derruba o codigo de verificacao de TODO mundo pelo resto
--   do dia — o mesmo raciocinio do freio da generate_order_otp_v2.
--
--   O UPDATE condicional abaixo e' atomico: de duas chamadas simultaneas, uma
--   encontra a coluna nula e grava, a outra espera o commit e ja encontra
--   preenchida. Nao existe janela entre "conferir" e "marcar", porque as duas
--   coisas sao a MESMA instrucao.
--
-- POR QUE MARCAR ANTES DE ENVIAR, E NAO DEPOIS
--   Marcar depois deixa a janela aberta exatamente onde ela e' mais provavel:
--   entre o envio e a marcacao — que e' onde mora a parte lenta (o SMTP levou
--   7,3 s no envio medido em 20/08/2026). Marcando antes, o pior caso e' um
--   e-mail que nao sai; marcando depois, o pior caso e' varios e-mails iguais
--   e a cota do dia queimada. A `liberar_email_de_confirmacao` existe para
--   desfazer a reserva quando o envio falha de verdade.

ALTER TABLE public.marketplace_orders
    ADD COLUMN IF NOT EXISTS confirmation_email_sent_at timestamptz;

COMMENT ON COLUMN public.marketplace_orders.confirmation_email_sent_at IS
'Quando o e-mail de confirmacao foi RESERVADO para envio (PEDIDO-070, #106). Preenchido pela reivindicar_email_de_confirmacao ANTES do envio, e devolvido a NULL pela liberar_email_de_confirmacao se o envio falhar. Nulo significa "ninguem enviou nem esta enviando"; nao e prova de entrega — prova de entrega o SMTP nao da.';

-- Reserva o envio. Devolve true so' para quem reservou; qualquer outra chamada
-- para o mesmo pedido devolve false e nao deve enviar nada.
CREATE OR REPLACE FUNCTION public.reivindicar_email_de_confirmacao(
    p_order_id uuid
) RETURNS boolean
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path TO 'public'
AS $$
DECLARE
    v_reservado boolean;
BEGIN
    UPDATE public.marketplace_orders
       SET confirmation_email_sent_at = NOW()
     WHERE id = p_order_id
       AND confirmation_email_sent_at IS NULL
    RETURNING true INTO v_reservado;

    -- Pedido inexistente e pedido ja reservado devolvem a MESMA resposta, de
    -- proposito: quem chama nao tem o que fazer de diferente nos dois casos, e
    -- distinguir contaria a quem estivesse adivinhando id se o pedido existe.
    RETURN coalesce(v_reservado, false);
END;
$$;

COMMENT ON FUNCTION public.reivindicar_email_de_confirmacao(uuid) IS
'Reserva o envio do e-mail de confirmacao de um pedido, de forma atomica. Devolve true apenas para a primeira chamada; as seguintes devolvem false e nao devem enviar. So service_role executa: quem chama e a edge function send-order-confirmation, nunca o navegador (PEDIDO-070, #106).';

-- Devolve a reserva quando o envio falhou, para que uma tentativa posterior
-- possa acontecer.
--
-- O QUE ELA ASSUME, DITO NA CARA: que o envio realmente nao aconteceu. Ela so'
-- e' chamada quando o SMTP RECUSOU a mensagem. Se um dia o servidor aceitar e a
-- resposta se perder na volta, liberar aqui permite um segundo e-mail igual —
-- e esse e o lado do erro que se escolheu, porque cliente sem confirmacao
-- nenhuma e pior que cliente com duas.
CREATE OR REPLACE FUNCTION public.liberar_email_de_confirmacao(
    p_order_id uuid
) RETURNS void
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path TO 'public'
AS $$
BEGIN
    UPDATE public.marketplace_orders
       SET confirmation_email_sent_at = NULL
     WHERE id = p_order_id;
END;
$$;

COMMENT ON FUNCTION public.liberar_email_de_confirmacao(uuid) IS
'Devolve a NULL a reserva feita pela reivindicar_email_de_confirmacao, para quando o SMTP recusou a mensagem. So service_role executa (PEDIDO-070, #106).';

-- O navegador nao chama nenhuma das duas: reivindicar deixaria qualquer
-- visitante queimar a reserva de um pedido alheio (o dono nunca receberia o
-- e-mail), e liberar deixaria qualquer visitante forcar reenvio ate esgotar a
-- cota diaria da loja.
REVOKE EXECUTE ON FUNCTION public.reivindicar_email_de_confirmacao(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.reivindicar_email_de_confirmacao(uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.reivindicar_email_de_confirmacao(uuid) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.reivindicar_email_de_confirmacao(uuid) TO service_role;

REVOKE EXECUTE ON FUNCTION public.liberar_email_de_confirmacao(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.liberar_email_de_confirmacao(uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.liberar_email_de_confirmacao(uuid) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.liberar_email_de_confirmacao(uuid) TO service_role;
