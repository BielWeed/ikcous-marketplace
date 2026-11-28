-- Reenvia o mesmo código da consulta do pedido, com as mesmas tentativas e
-- validade. A porta de emissão, a de consulta e seus privilégios não mudam.
-- Sem controle de transação externo: o aplicador abre a transação.

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

DO $preflight$
BEGIN
  IF (SELECT md5(replace(prosrc, chr(13), '')) FROM pg_catalog.pg_proc
       WHERE oid = to_regprocedure('public.generate_order_otp_v2(text,text,text)')) = '413d262f2644ae8f9509d8d82dda3d69'
     AND (SELECT md5(replace(prosrc, chr(13), '')) FROM pg_catalog.pg_proc
       WHERE oid = to_regprocedure('public.get_orders_by_otp_v2(text,text,text,text)')) = '95d6957283869602683047a97d608074' THEN
    RETURN;
  END IF;
  IF (SELECT md5(replace(prosrc, chr(13), '')) FROM pg_catalog.pg_proc
       WHERE oid = to_regprocedure('public.generate_order_otp_v2(text,text,text)')) IS DISTINCT FROM '92fdc055f2c9868c7a4592ede3dab3b9'
     OR (SELECT md5(replace(prosrc, chr(13), '')) FROM pg_catalog.pg_proc
       WHERE oid = to_regprocedure('public.get_orders_by_otp_v2(text,text,text,text)')) IS DISTINCT FROM '96f080db2a488d8887a2dfd959bd9862' THEN
    RAISE EXCEPTION '20261665000000: corpos de OTP anteriores desconhecidos.';
  END IF;
END $preflight$;

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
    -- Tetos dos e-mails de codigo (janela de 24 h que anda; ajuste aqui).
    -- O de destinatario e' o MESMO contador do comprovante
    -- (reivindicar_email_de_confirmacao) e precisa do mesmo numero la.
    -- O da loja: a cota real da conta de Gmail e desconhecida (pode ser ~100
    -- por dia); 40 do codigo + 40 do comprovante = 80 < 100, com folga para o
    -- comprovante de pedido PAGO, que fura o teto e so conta. Subir = migration nova.
    v_teto_por_pedido CONSTANT integer := 5;
    v_teto_por_destinatario CONSTANT integer := 10;
    v_teto_do_codigo_na_loja CONSTANT integer := 40;
    v_otp text;
    v_expira timestamptz;
    v_order_id uuid;
    v_candidato uuid;
    v_rec public.otp_verifications%ROWTYPE;
    v_agora timestamptz;
    v_recusa CONSTANT jsonb := jsonb_build_object('ok', false, 'motivo', 'nao_confere');
    v_fragmento text := trim(coalesce(p_order_fragment, ''));
BEGIN
    -- Os dois canais sao obrigatorios. Era um OR aqui que deixava o WhatsApp
    -- sozinho abrir o fluxo com o e-mail de quem estivesse pedindo (AUTH-010,
    -- #118). Copiado da v1 de proposito: a v2 nao afrouxa nada.
    IF coalesce(trim(p_email), '') = '' OR coalesce(trim(p_whatsapp), '') = '' THEN
        RETURN v_recusa;
    END IF;

    -- Fragmento com no minimo 6 caracteres e so' o alfabeto de um UUID. O
    -- comprimento tira o `ILIKE '%'`; a restricao de alfabeto impede que um `%`
    -- ou `_` digitado no campo volte a funcionar como curinga.
    IF v_fragmento !~ '^[0-9a-fA-F-]{6,}$' THEN
        RETURN v_recusa;
    END IF;

    -- A mesma trava e a mesma identidade na emissão e na verificação. Só o
    -- pedido é travado, não a linha de auth.users. Um trio ambíguo não serve.
    FOR v_candidato IN
        SELECT o.id
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
           AND o.id::text ILIKE '%' || v_fragmento
         ORDER BY o.id
         LIMIT 2
         FOR NO KEY UPDATE OF o
    LOOP
        IF v_order_id IS NOT NULL THEN
            RETURN v_recusa;
        END IF;
        v_order_id := v_candidato;
    END LOOP;
    IF v_order_id IS NULL THEN
        RETURN v_recusa;
    END IF;

    -- Não cair para um código anterior se o mais recente já venceu ou foi usado.
    SELECT v.* INTO v_rec
      FROM public.otp_verifications v
     WHERE v.order_id = v_order_id
     ORDER BY v.created_at DESC NULLS LAST, v.id DESC
     LIMIT 1
     FOR UPDATE;
    v_agora := clock_timestamp();

    -- created_at registra o último envio para manter o mesmo freio de 60 s,
    -- mesmo se o código expirar logo depois do reenvio.
    IF v_rec.created_at > v_agora - INTERVAL '60 seconds' THEN
        RETURN jsonb_build_object(
            'ok', false,
            'motivo', 'muito_recente',
            'espere_segundos',
            CEIL(EXTRACT(EPOCH FROM (v_rec.created_at + INTERVAL '60 seconds' - v_agora)))::int
        );
    END IF;

    -- Tetos diarios de envio (20261217000000). So depois de o trio conferir:
    -- pedido que nao confere nao gasta vaga nenhuma. Sem vaga, ou se o
    -- contador falhar, ERRO generico -- a edge responde "envio_falhou" (a tela
    -- manda tentar de novo mais tarde) e nada desta chamada fica gravado.
    -- Nunca um motivo novo: a edge trocaria motivo desconhecido por
    -- "nao_confere". A mensagem nao leva e-mail nem pedido.
    IF NOT public.reservar_vaga_de_email('codigo:pedido:' || v_order_id::text, v_teto_por_pedido) THEN
        RAISE EXCEPTION 'teto de envio de codigo atingido (pedido)';
    END IF;
    IF NOT public.reservar_vaga_de_email('destinatario:' || public.chave_do_destinatario(p_email), v_teto_por_destinatario) THEN
        RAISE EXCEPTION 'teto de envio de codigo atingido (destinatario)';
    END IF;
    IF NOT public.reservar_vaga_de_email('codigo:loja', v_teto_do_codigo_na_loja) THEN
        RAISE EXCEPTION 'teto de envio de codigo atingido (loja)';
    END IF;

    IF v_rec.verified = false AND v_rec.expires_at > v_agora THEN
        -- Reenviar não cria outra chance de acertar, não zera tentativas e
        -- não estende a validade, mesmo quando o primeiro SMTP falhou.
        v_otp := v_rec.otp_code;
        v_expira := v_rec.expires_at;
        UPDATE public.otp_verifications SET created_at = v_agora WHERE id = v_rec.id;
    ELSE
        v_otp := LPAD(FLOOR(RANDOM() * 1000000)::text, 6, '0');
        v_expira := v_agora + INTERVAL '15 minutes';
        INSERT INTO public.otp_verifications
            (email, whatsapp, otp_code, expires_at, order_id, created_at)
        VALUES (trim(p_email), p_whatsapp, v_otp, v_expira, v_order_id, v_agora);
    END IF;

    -- Faxina por último: pula linhas travadas por outro pedido e nunca apaga
    -- um envio que ainda conta para o intervalo de 60 s.
    WITH vencidos AS (
        SELECT id
          FROM public.otp_verifications
         WHERE expires_at < v_agora
           AND (created_at IS NULL OR created_at <= v_agora - INTERVAL '60 seconds')
         FOR UPDATE SKIP LOCKED
    )
    DELETE FROM public.otp_verifications v USING vencidos
     WHERE v.id = vencidos.id;

    RETURN jsonb_build_object(
        'ok', true,
        'email', trim(p_email),
        'otp_code', v_otp,
        'expira_em', v_expira::text
    );
END;
$$;

CREATE OR REPLACE FUNCTION public.get_orders_by_otp_v2("p_email" "text", "p_whatsapp" "text", "p_fragmento" "text", "p_otp" "text") RETURNS "jsonb"
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
    v_rec public.otp_verifications%ROWTYPE;
    v_order_id uuid;
    v_candidato uuid;
    v_agora timestamptz;
    v_max_tentativas CONSTANT integer := 5;
    v_recusa CONSTANT jsonb := jsonb_build_object('ok', false, 'error', 'Código inválido ou expirado.');
    v_bloqueado CONSTANT jsonb := jsonb_build_object(
        'ok', false,
        'motivo', 'bloqueado_ate_expirar',
        'error', 'Código bloqueado por excesso de tentativas. Aguarde o código vencer antes de pedir outro.'
    );
    v_fragmento text := trim(coalesce(p_fragmento, ''));
BEGIN
    -- O trio, com as MESMAS regras da generate_order_otp_v2 (20260820000000):
    -- os dois canais obrigatorios e o fragmento so com o alfabeto de um UUID.
    IF coalesce(trim(p_email), '') = '' OR coalesce(trim(p_whatsapp), '') = ''
       OR v_fragmento !~ '^[0-9a-fA-F-]{6,}$' THEN
        RETURN v_recusa;
    END IF;

    -- A mesma trava e a mesma identidade na emissão e na verificação. Só o
    -- pedido é travado, não a linha de auth.users. Um trio ambíguo não serve.
    FOR v_candidato IN
        SELECT o.id
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
           AND o.id::text ILIKE '%' || v_fragmento
         ORDER BY o.id
         LIMIT 2
         FOR NO KEY UPDATE OF o
    LOOP
        IF v_order_id IS NOT NULL THEN
            RETURN v_recusa;
        END IF;
        v_order_id := v_candidato;
    END LOOP;
    IF v_order_id IS NULL THEN
        RETURN v_recusa;
    END IF;

    -- Não cair para um código anterior se o mais recente já venceu ou foi usado.
    SELECT v.* INTO v_rec
      FROM public.otp_verifications v
     WHERE v.order_id = v_order_id
     ORDER BY v.created_at DESC NULLS LAST, v.id DESC
     LIMIT 1
     FOR UPDATE;
    v_agora := clock_timestamp();

    IF v_rec.verified IS DISTINCT FROM false OR v_rec.expires_at <= v_agora THEN
        RETURN v_recusa;
    END IF;

    IF v_rec.attempts >= v_max_tentativas THEN
        RETURN v_bloqueado;
    END IF;

    IF v_rec.otp_code IS DISTINCT FROM p_otp THEN
        UPDATE public.otp_verifications
           SET attempts = attempts + 1
         WHERE id = v_rec.id;
        IF v_rec.attempts + 1 = v_max_tentativas THEN
            RETURN v_bloqueado || jsonb_build_object('restantes', 0);
        END IF;
        RETURN v_recusa || jsonb_build_object('restantes', v_max_tentativas - (v_rec.attempts + 1));
    END IF;

    -- Consome o código uma única vez e invalida também qualquer registro
    -- pendente legado que tenha sobrado antes desta migration.
    UPDATE public.otp_verifications SET verified = TRUE
     WHERE order_id = v_order_id AND verified = false AND expires_at > v_agora;

    -- 20261342: a coluna notes NAO sai mais daqui. Ela guarda a observacao da cliente MISTURADA com a
    -- anotacao interna que a loja gravava ali antes de 17/10/2026 (20261247); a tela do convidado nao a usa.
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
                'coupon_code', o.coupon_code,
                'tracking_code', o.tracking_code,
                'created_at', o.created_at,
                'updated_at', o.updated_at,
                'customer_name', o.customer_name,
                'customer_data', (
                    -- LGPD (migration 20261181000000, achado alto): o CPF do
                    -- destinatário nunca sai desta RPC — nem em
                    -- `customer_data.cpf` (migration 20261172) nem dentro de
                    -- `customer_data.address` (janela 23-26/09, antes de o
                    -- INSERT do pedido aprender a tirar a chave do endereço).
                    -- Quem chega até aqui só provou o OTP do PRÓPRIO pedido —
                    -- não precisa do CPF para nada nesta tela: o front já
                    -- descarta a chave antes de guardar o pedido no cache do
                    -- localStorage (src/lib/mappers.ts, semCpf()), e é o
                    -- servidor (melhor-envio-etiqueta) quem usa o CPF para
                    -- emitir a etiqueta, nunca o navegador de quem digitou o
                    -- código.
                    --
                    -- RODADA 2 (revisão de risco):
                    --   * achado 4 — `customer_data` ESCALAR (não objeto) não
                    --     tem chave para `jsonb - text` tirar; sem este
                    --     primeiro WHEN, `o.customer_data - 'cpf'` explode com
                    --     "cannot delete from scalar" e derruba a verificação
                    --     de OTP inteira para aquele pedido. Devolve o valor
                    --     cru: não há CPF para vazar dentro de um escalar.
                    --   * achado 5 — quando `address` era só `{"cpf":"..."}`,
                    --     tirar a chave deixava `{}` (TRUTHY em JS, vencia
                    --     `row.address` — o endereço de verdade do JOIN — na
                    --     cadeia `||` de `src/lib/mappers.ts`). Vira JSON
                    --     `null` (mesma régua da `20261172`,
                    --     `v_address_data_sem_cpf`): `null` também é
                    --     `typeof === "object"` em JS, mas é FALSY, então a
                    --     cadeia cai para a próxima fonte.
                    --   * achado 6 (informativo, sem código) — `address` como
                    --     ARRAY não entra no segundo WHEN (`jsonb_typeof` diz
                    --     'array', não 'object') e mantém qualquer `cpf`
                    --     aninhado. O front nunca manda array em `address`
                    --     (só objeto ou string); se um dia mandar, este
                    --     ponto precisa ser revisto.
                    CASE
                        WHEN jsonb_typeof(o.customer_data) <> 'object' THEN o.customer_data
                        WHEN jsonb_typeof(o.customer_data -> 'address') = 'object' THEN
                            (o.customer_data - 'cpf')
                                || jsonb_build_object(
                                     'address',
                                     CASE
                                         WHEN ((o.customer_data -> 'address') - 'cpf') = '{}'::jsonb THEN NULL
                                         ELSE (o.customer_data -> 'address') - 'cpf'
                                     END
                                   )
                        ELSE
                            o.customer_data - 'cpf'
                    END
                ),
                'items', (
                    SELECT COALESCE(jsonb_agg(jsonb_build_object(
                        'id', oi.id,
                        'order_id', oi.order_id,
                        'product_id', oi.product_id,
                        'variant_id', oi.variant_id,
                        'variacao_nome_na_compra', oi.variacao_nome_na_compra,
                        'variacao_valor_na_compra', oi.variacao_valor_na_compra,
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

DO $conferencia$
BEGIN
  IF (SELECT md5(replace(prosrc, chr(13), '')) FROM pg_catalog.pg_proc
       WHERE oid = to_regprocedure('public.generate_order_otp_v2(text,text,text)')) IS DISTINCT FROM '413d262f2644ae8f9509d8d82dda3d69'
     OR (SELECT md5(replace(prosrc, chr(13), '')) FROM pg_catalog.pg_proc
       WHERE oid = to_regprocedure('public.get_orders_by_otp_v2(text,text,text,text)')) IS DISTINCT FROM '95d6957283869602683047a97d608074' THEN
    RAISE EXCEPTION '20261665000000: corpos de OTP inesperados após apply.';
  END IF;
END $conferencia$;
