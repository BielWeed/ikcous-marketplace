-- generate_order_otp_v2 — mesma validacao da v1, mas DEVOLVE o codigo.
--
-- POR QUE ELA EXISTE
--   A v1 devolve boolean e enfia o codigo numa tabela, e quem mandava o e-mail
--   era um gatilho lendo essa tabela por net.http_post. O net.http_post
--   ENFILEIRA e envia DEPOIS do commit: a RPC retorna antes de qualquer coisa
--   ter acontecido, e a tela dizia "codigo enviado" sem que ninguem jamais
--   tivesse sabido o resultado (#86). Nao era descuido — o banco era incapaz
--   de saber.
--
--   Sem o gatilho, quem envia precisa do codigo na mao. E quem envia e a edge
--   function send-otp-email, com service role — nunca o navegador: codigo no
--   navegador dispensaria o e-mail inteiro, que e justamente a prova de posse
--   da caixa postal.
--
-- POR QUE NAO ALTERAR A v1
--   A producao chama a v1 e espera boolean. Trocar o tipo de retorno de uma
--   funcao que a producao chama derruba a producao no instante do apply. A v2
--   nasce ao lado; o EXECUTE da v1 para o navegador so cai na migration de
--   corte, depois de o front novo estar no ar.

CREATE OR REPLACE FUNCTION public.generate_order_otp_v2(
    p_email text,
    p_whatsapp text,
    p_order_fragment text
) RETURNS jsonb
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path TO 'public'
AS $$
DECLARE
    v_otp text;
    v_order_id uuid;
    v_fragmento text := trim(coalesce(p_order_fragment, ''));
    v_recente timestamptz;
BEGIN
    DELETE FROM public.otp_verifications WHERE expires_at < NOW();

    -- Os dois canais sao obrigatorios. Era um OR aqui que deixava o WhatsApp
    -- sozinho abrir o fluxo com o e-mail de quem estivesse pedindo (AUTH-010,
    -- #118). Copiado da v1 de proposito: a v2 nao afrouxa nada.
    IF coalesce(trim(p_email), '') = '' OR coalesce(trim(p_whatsapp), '') = '' THEN
        RETURN jsonb_build_object('ok', false, 'motivo', 'nao_confere');
    END IF;

    -- Fragmento com no minimo 6 caracteres e so' o alfabeto de um UUID. O
    -- comprimento tira o `ILIKE '%'`; a restricao de alfabeto impede que um `%`
    -- ou `_` digitado no campo volte a funcionar como curinga.
    IF v_fragmento !~ '^[0-9a-fA-F-]{6,}$' THEN
        RETURN jsonb_build_object('ok', false, 'motivo', 'nao_confere');
    END IF;

    -- AND entre os canais, e o pedido tem de ser UM so'. Se o sufixo casar com
    -- mais de um, nao da' para saber a qual amarrar o codigo.
    SELECT o.id INTO v_order_id
      FROM public.marketplace_orders o
      LEFT JOIN auth.users u ON u.id = o.user_id
     WHERE regexp_replace(
               coalesce(o.customer_phone, o.customer_data->>'whatsapp', ''),
               '[^0-9]', '', 'g'
           ) = regexp_replace(p_whatsapp, '[^0-9]', '', 'g')
       AND (
             LOWER(coalesce(o.customer_data->>'email', '')) = LOWER(trim(p_email))
          OR LOWER(coalesce(u.email, ''))                   = LOWER(trim(p_email))
       )
       AND o.id::text ILIKE '%' || v_fragmento;

    -- Motivo unico de proposito: distinguir "pedido nao existe" de "e-mail nao
    -- bate" diria a quem esta' adivinhando qual metade ele ja' acertou.
    IF NOT FOUND OR v_order_id IS NULL THEN
        RETURN jsonb_build_object('ok', false, 'motivo', 'nao_confere');
    END IF;

    -- Freio de cota. A v2 fica atras de um endpoint que qualquer visitante
    -- alcanca, e cada sucesso gasta uma das ~100 mensagens diarias da conta de
    -- Gmail da loja. Sem esta janela, um laco esgota a cota e ai NENHUM cliente
    -- recebe codigo pelo resto do dia.
    --
    -- A janela e' por PEDIDO, e nao por e-mail: e' o pedido que identifica o
    -- alvo, e trocar o e-mail da requisicao nao pode reabrir a torneira.
    SELECT created_at INTO v_recente
      FROM public.otp_verifications
     WHERE order_id = v_order_id
       AND created_at > NOW() - INTERVAL '60 seconds'
     ORDER BY created_at DESC
     LIMIT 1;

    IF v_recente IS NOT NULL THEN
        RETURN jsonb_build_object(
            'ok', false,
            'motivo', 'muito_recente',
            'espere_segundos',
            CEIL(EXTRACT(EPOCH FROM (v_recente + INTERVAL '60 seconds' - NOW())))::int
        );
    END IF;

    v_otp := LPAD(FLOOR(RANDOM() * 1000000)::text, 6, '0');

    INSERT INTO public.otp_verifications (email, whatsapp, otp_code, expires_at, order_id)
    VALUES (trim(p_email), p_whatsapp, v_otp, NOW() + INTERVAL '15 minutes', v_order_id);

    RETURN jsonb_build_object(
        'ok', true,
        'email', trim(p_email),
        'otp_code', v_otp,
        'expira_em', (NOW() + INTERVAL '15 minutes')::text
    );
END;
$$;

COMMENT ON FUNCTION public.generate_order_otp_v2(text, text, text) IS
'Valida e-mail + WhatsApp + fragmento do pedido e DEVOLVE o codigo de verificacao. So service_role executa: quem chama e a edge function send-otp-email, nunca o navegador — codigo no navegador dispensaria o e-mail inteiro. Traz um freio de uma mensagem por pedido a cada 60s, porque a conta de Gmail da loja tem teto diario. Substitui o par v1 + gatilho on_otp_created_send_email (#161, #86).';

-- O navegador NAO pode chamar esta funcao: ela devolve o codigo em texto claro.
REVOKE EXECUTE ON FUNCTION public.generate_order_otp_v2(text, text, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.generate_order_otp_v2(text, text, text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.generate_order_otp_v2(text, text, text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.generate_order_otp_v2(text, text, text) TO service_role;
