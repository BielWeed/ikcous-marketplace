-- Rastreio por codigo passa a mostrar o pagamento.
--
-- O DEFEITO, em uma frase: quem acompanha o pedido pelo codigo enviado por
-- e-mail (sem criar conta) ve todo pedido como se nao houvesse cobranca
-- nenhuma -- inclusive um que ja foi pago.
--
-- POR QUE: get_orders_by_otp_v1 monta o pedido campo a campo com
-- jsonb_build_object e nao inclui payment_status. A chave nao vem no JSON, o
-- mapeador do front (src/lib/mappers.ts:246, row.payment_status) le undefined,
-- e a tela trata isso como "sem cobranca". Quatro comportamentos do app
-- dependem desse campo e ficam desligados EM SILENCIO nesse caminho:
--   1. o selo de pagamento (CustomerPaymentBadge);
--   2. o texto do pedido em aberto (pendingDescription);
--   3. o texto do pedido cancelado (cancelledDescription);
--   4. o aviso de dinheiro no cancelamento.
-- Pelo caminho de quem TEM conta nada disso acontece: la o pedido vem da
-- tabela, com todas as colunas.
--
-- POR QUE NINGUEM PERCEBEU: a funcao e mais VELHA que a coluna, por um dia.
-- A definicao viva e a do baseline 20260806000000 (linhas 2269-2353), e a
-- coluna payment_status entrou no dia seguinte, em
-- 20260807000000_reserva_com_expiracao.sql. Ninguem voltou para expor o campo.
--
-- 🔴 DE ONDE ESTE CORPO FOI COPIADO, e por que isso importa: CINCO migrations
-- ativas definem get_orders_by_otp_v1 (20240523000000, 20260612000000,
-- 20260625000000, 20260805010000 e o baseline 20260806000000). So a ULTIMA
-- vale. Este arquivo copia o corpo do baseline byte a byte e acrescenta UMA
-- linha. Quem for editar de novo: confira qual e a definicao viva ANTES,
-- porque abrir a migration errada faz voce reescrever a funcao com uma versao
-- morta.
--
-- 🔴 CREATE OR REPLACE E SUBSTITUICAO: atributo que nao for repetido por
-- extenso SOME EM SILENCIO. Por isso RETURNS "jsonb", LANGUAGE plpgsql,
-- SECURITY DEFINER e SET search_path TO 'public' estao escritos aqui de novo,
-- iguais aos da versao viva. Se SECURITY DEFINER cair, a funcao que le pedido
-- de terceiro passa a rodar com a permissao de QUEM CHAMA -- o navegador de
-- quem digitou o codigo. A assinatura tambem tem de ficar identica
-- (("p_email" "text", "p_otp" "text")): parametro a mais nao substitui, cria
-- uma SEGUNDA funcao, e ja ha uma quebrada neste banco por isso.
--
-- ⚠️ NAO HA PERDA DE DINHEIRO AQUI -- E ISSO E SORTE, NAO DESENHO.
-- A tela mostra o texto errado, mas o botao de cancelar exige login e a funcao
-- do banco recusa quem nao e dono do pedido, entao a acao falha com erro. Quem
-- for mexer NA GUARDA DE LOGIN ou na checagem de dono precisa saber que a
-- protecao contra "cancelar pedido pago" mora LA, e nao aqui: mexer no lugar
-- errado remove a protecao sem que nada nesta tela mude.
--
-- SEM BEGIN/COMMIT: o db-apply.cjs abre a transacao. Com eles, o ROLLBACK do
-- script de prova vira no-op e a mudanca fica gravada mesmo assim.
--
-- Prova: scripts/db-prove-otp-mostra-pagamento.cjs

CREATE OR REPLACE FUNCTION public.get_orders_by_otp_v1("p_email" "text", "p_otp" "text") RETURNS "jsonb"
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
    v_rec RECORD;
    v_max_tentativas CONSTANT integer := 5;
BEGIN
    -- Busca pelo e-mail, NÃO por e-mail + código: com o código errado não
    -- haveria linha para incrementar, e o contador nunca sairia do lugar.
    SELECT * INTO v_rec
      FROM public.otp_verifications
     WHERE email = trim(p_email)
       AND expires_at > NOW()
       AND verified = false
     ORDER BY created_at DESC
     LIMIT 1;

    IF NOT FOUND THEN
        RETURN jsonb_build_object('ok', false, 'error', 'Código inválido ou expirado.');
    END IF;

    IF v_rec.attempts >= v_max_tentativas THEN
        RETURN jsonb_build_object('ok', false, 'error', 'Código bloqueado por excesso de tentativas. Peça um novo.');
    END IF;

    IF v_rec.otp_code IS DISTINCT FROM p_otp THEN
        UPDATE public.otp_verifications
           SET attempts = attempts + 1
         WHERE id = v_rec.id;
        RETURN jsonb_build_object(
            'ok', false,
            'error', 'Código inválido ou expirado.',
            'restantes', v_max_tentativas - (v_rec.attempts + 1)
        );
    END IF;

    UPDATE public.otp_verifications SET verified = TRUE WHERE id = v_rec.id;

    -- Um pedido, o que o código comprou. Nunca a lista por e-mail ou WhatsApp.
    RETURN jsonb_build_object(
        'ok', true,
        'orders', (
            SELECT COALESCE(jsonb_agg(jsonb_build_object(
                'id', o.id,
                'user_id', o.user_id,
                'total', o.total,
                'subtotal', o.subtotal,
                'shipping', o.shipping,
                'discount', o.discount,
                'payment_method', o.payment_method,
                'status', o.status,
                'payment_status', o.payment_status,
                'notes', o.notes,
                'coupon_code', o.coupon_code,
                'tracking_code', o.tracking_code,
                'created_at', o.created_at,
                'updated_at', o.updated_at,
                'customer_name', o.customer_name,
                'customer_data', o.customer_data,
                'items', (
                    SELECT COALESCE(jsonb_agg(jsonb_build_object(
                        'id', oi.id,
                        'order_id', oi.order_id,
                        'product_id', oi.product_id,
                        'variant_id', oi.variant_id,
                        'quantity', oi.quantity,
                        'price', oi.price,
                        'product_name', oi.product_name,
                        'image_url', oi.image_url
                    )), '[]'::jsonb)
                      FROM public.marketplace_order_items oi
                     WHERE oi.order_id = o.id
                ),
                'address', (
                    SELECT to_jsonb(addr.*)
                      FROM public.user_addresses addr
                     WHERE addr.id = o.address_id
                )
            )), '[]'::jsonb)
              FROM public.marketplace_orders o
             WHERE o.id = v_rec.order_id
        )
    );
END;
$$;
