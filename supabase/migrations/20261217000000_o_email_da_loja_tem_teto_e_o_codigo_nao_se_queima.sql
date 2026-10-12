-- ============================================================================
-- Migration 20261217000000 — o e-mail da loja tem teto e o código do convidado
-- não se queima (auditoria de segurança de 12/10/2026, lote L1: R1, R2, R3)
-- ============================================================================
--
-- 1. O QUE ESTA MIGRATION CORRIGE
--
-- A conta de e-mail da loja manda um número limitado de mensagens por dia. Os
-- dois e-mails que um visitante sem conta consegue disparar — o código de
-- verificação do rastreio e o comprovante do pedido — não tinham teto diário:
-- só uma janela de 60 s por pedido (código) e uma mensagem por pedido
-- (comprovante). Quando a cota da conta acaba, o código de verificação para
-- de chegar para todo cliente pelo resto do dia.
--
-- E a verificação do código passa a exigir os mesmos dados do pedido que o
-- envio já exige: a tentativa só conta para o código do pedido que confere, e
-- a resposta não diz mais nada sobre o código de outro pedido.
--
-- 2. O QUE MUDA (só no banco; nenhuma edge function muda)
--
--   a. Tabela `email_da_loja_contadores` (chave, hora, n): um balde por HORA
--      para cada contador; o teto vale para a soma das últimas 24 h (janela
--      que anda, não dia de calendário). A chave do destinatário é o sha256 do
--      e-mail NORMALIZADO (minúsculas, sem espaço, sem o `+apelido`, e no
--      Gmail sem pontos e com googlemail = gmail) — o e-mail em claro nunca
--      é gravado. RLS ligada, nenhum privilégio para anon/authenticated.
--   b. `chave_do_destinatario(text)` e `reservar_vaga_de_email(text, integer)`:
--      só o servidor executa. A reserva é atômica
--      (`INSERT … ON CONFLICT DO UPDATE … WHERE n + anteriores < teto`).
--   c. `generate_order_otp_v2`: depois de conferir o trio e a janela de 60 s
--      (inalterados), reserva vaga no teto do PEDIDO, do DESTINATÁRIO e da
--      LOJA, nessa ordem; sem vaga, ou se o contador falhar, levanta erro
--      genérico (a edge `send-otp-email` já responde 502 `envio_falhou`, e a
--      tela diz "tente de novo em alguns minutos"). Pedido que não confere não
--      gasta teto nenhum.
--   d. `reivindicar_email_de_confirmacao` (mesma assinatura): antes de marcar
--      o pedido, reserva vaga no teto do DESTINATÁRIO (o mesmo do código) e no
--      contador SÓ do comprovante. Sem vaga: devolve false, que todo chamador
--      já trata como "não envia" — o pedido nunca falha. Pedido pago passa
--      sempre (conta, mas não é recusado). Falha do contador aqui não bloqueia
--      o comprovante (só registra no log do banco).
--   e. `get_orders_by_otp_v1`: o mesmo corpo, sem o campo `restantes`.
--   f. `get_orders_by_otp_v2(e-mail, WhatsApp, fragmento, código)`, NOVA: a
--      verificação só olha o código do pedido que confere com o trio (as
--      mesmas regras da `generate_order_otp_v2`), e só conta tentativa
--      errada quando o trio confere. É a porta do convidado (anon e
--      authenticated executam), que o front passa a chamar neste lote.
--
-- 3. OS NÚMEROS (constantes no topo de cada função, para ajuste fácil)
--
--   código, por pedido ........................ 5 em 24 h
--   código + comprovante, por destinatário ..... 10 em 24 h (somados)
--   código, da loja inteira .................... 40 em 24 h (contador próprio)
--   comprovante, da loja inteira ............... 40 em 24 h (contador próprio)
--   O comprovante nunca consome a vaga do código (contadores separados).
--   Por que 40 + 40: a cota real da conta de Gmail da loja é desconhecida e
--   pode ser ~100 por dia; 80 fica abaixo de 100 e deixa folga para o
--   comprovante de pedido PAGO, que fura o teto (só conta). Para subir os
--   números depois, uma migration nova.
--
-- 4. DADOS EXISTENTES
--
-- Nenhuma linha existente é lida para decidir nem reescrita ao aplicar. Os
-- contadores nascem vazios: o que foi enviado antes do apply não conta (as
-- primeiras 24 h depois do apply têm a cota inteira). Códigos já gravados em
-- `otp_verifications` continuam valendo pelas duas portas.
--
-- 5. PRÉ-VOO (B1_BASELINE_DIVERGENT, ANTES de qualquer escrita)
--
-- Recusa se o corpo vivo (md5 de `replace(prosrc, E'\r', '')`) de cada
-- função trocada não for o vigente nem o desta migration, e se uma função
-- nova já existir com outro corpo.
--
-- 6. IDEMPOTÊNCIA E TRANSAÇÃO
--
-- `CREATE TABLE/INDEX IF NOT EXISTS`, `CREATE OR REPLACE FUNCTION`, GRANT e
-- REVOKE: reaplicar deixa o mesmo estado. Sem BEGIN/COMMIT de nível superior
-- (regra da casa): quem abre a transação é o aplicador; o pré-voo, os corpos e
-- a conferência final caem juntos ou não caem.
--
-- 7. ORDEM E ROLLBACK
--
-- Banco primeiro, front depois: o front deste lote chama a
-- `get_orders_by_otp_v2`, que só existe depois desta migration. Nenhuma edge
-- function muda. ROLLBACK MANUAL:
-- rollback-manual-20261217000000_o_email_da_loja_tem_teto_e_o_codigo_nao_se_queima.sql
-- devolve byte a byte os três corpos vigentes; a tabela, as duas funções de
-- apoio e a `get_orders_by_otp_v2` ficam (inertes, e a v2 é a porta que o front
-- novo usa).
--
-- ETAPA 2 (outra migration, depois do front novo no ar): tirar a
-- `get_orders_by_otp_v1` do visitante.
--
-- PROVA VIVA: tests/banco/teto-de-email-viva.cjs e
-- tests/banco/teto-de-email-portao-viva.cjs (rpc-ci).
-- ============================================================================

DO $preflight_20261217$
DECLARE
  r record;
  v_hash text;
BEGIN
  FOR r IN
    SELECT *
      FROM (VALUES
        ('public.generate_order_otp_v2(text,text,text)', '8fab5091db4a380bf07592f7dc896856', '92fdc055f2c9868c7a4592ede3dab3b9'),
        ('public.reivindicar_email_de_confirmacao(uuid)', '45be19bf714f266f8234f11df820b76b', '74e559c6ba26ebc01d6357b9dd87f1dd'),
        ('public.get_orders_by_otp_v1(text,text)', 'b472f00d6b36002522b25bf04113a035', '277776acaf395fa864cc3e2cb0638237'),
        ('public.get_orders_by_otp_v2(text,text,text,text)', NULL, '53b5e632657b82206daa6aa992a50c0d'),
        ('public.reservar_vaga_de_email(text,integer)', NULL, '373815e668edf9480d2dce94fb59d467'),
        ('public.chave_do_destinatario(text)', NULL, 'b5a9a0f8bb405c082cdb8cb7ee662d1e')
      ) AS esperado(assinatura, hash_vigente, hash_desta)
  LOOP
    SELECT md5(replace(prosrc, E'\r', '')) INTO v_hash
      FROM pg_proc
     WHERE oid = to_regprocedure(r.assinatura);

    IF (v_hash IS NULL AND r.hash_vigente IS NOT NULL)
       OR (v_hash IS NOT NULL AND v_hash IS DISTINCT FROM r.hash_vigente AND v_hash <> r.hash_desta) THEN
      RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: corpo vivo de % (hash %) não é o vigente antes desta migration nem o que ela deixa — capture o corpo vivo e revise antes de aplicar.', r.assinatura, COALESCE(v_hash, 'ausente');
    END IF;
  END LOOP;
END $preflight_20261217$;

-- a. Os contadores: um balde por hora e por chave; o teto vale para a soma das
-- últimas 24 h. Nenhuma coluna guarda e-mail em claro.
CREATE TABLE IF NOT EXISTS public.email_da_loja_contadores (
    chave text NOT NULL,
    hora timestamptz NOT NULL,
    n integer NOT NULL DEFAULT 0 CHECK (n >= 0),
    PRIMARY KEY (chave, hora)
);

CREATE INDEX IF NOT EXISTS idx_email_da_loja_contadores_hora
    ON public.email_da_loja_contadores (hora);

COMMENT ON TABLE public.email_da_loja_contadores IS
'Contadores dos e-mails que a loja manda (codigo de verificacao e comprovante), um balde por hora e por chave; o teto vale para a soma das ultimas 24 h (migration 20261217000000). A chave do destinatario e o sha256 do e-mail normalizado, nunca o e-mail. So as funcoes do servidor leem e escrevem.';

ALTER TABLE public.email_da_loja_contadores ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.email_da_loja_contadores FROM PUBLIC;
REVOKE ALL ON TABLE public.email_da_loja_contadores FROM anon;
REVOKE ALL ON TABLE public.email_da_loja_contadores FROM authenticated;

-- b. A chave do destinatário: o mesmo endereço escrito de jeitos diferentes cai
-- no mesmo balde (maiúsculas, espaços, `+apelido`, e no Gmail os pontos e o
-- domínio googlemail).
CREATE OR REPLACE FUNCTION public.chave_do_destinatario(p_email text)
 RETURNS text
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO 'public'
AS $$
DECLARE
    v_email text := lower(trim(coalesce(p_email, '')));
    v_local text;
    v_dominio text;
BEGIN
    IF position('@' IN v_email) > 0 THEN
        v_local := substring(v_email FROM '^(.*)@[^@]*$');
        v_dominio := substring(v_email FROM '@([^@]*)$');
        v_local := split_part(v_local, '+', 1);
        IF v_dominio IN ('gmail.com', 'googlemail.com') THEN
            v_local := replace(v_local, '.', '');
            v_dominio := 'gmail.com';
        END IF;
        v_email := v_local || '@' || v_dominio;
    END IF;
    RETURN encode(sha256(convert_to(v_email, 'UTF8')), 'hex');
END;
$$;

COMMENT ON FUNCTION public.chave_do_destinatario(text) IS
'sha256 do e-mail normalizado (minusculas, sem espaco, sem +apelido; no Gmail sem pontos e googlemail = gmail). E a chave do teto por destinatario dos e-mails da loja (migration 20261217000000). So o servidor executa.';

-- Reserva UMA vaga num contador. Devolve true se reservou; false se o teto das
-- últimas 24 h já foi atingido. `p_teto` nulo conta sem recusar (pedido pago).
CREATE OR REPLACE FUNCTION public.reservar_vaga_de_email(p_chave text, p_teto integer)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $$
DECLARE
    v_hora timestamptz := date_trunc('hour', NOW());
    v_anteriores integer;
    v_n integer;
BEGIN
    IF coalesce(p_chave, '') = '' THEN
        RAISE EXCEPTION 'reservar_vaga_de_email: chave vazia';
    END IF;

    -- Limpeza barata: nada com mais de dois dias serve para conta nenhuma.
    DELETE FROM public.email_da_loja_contadores WHERE hora < v_hora - INTERVAL '2 days';

    -- As horas anteriores da janela não mudam mais; só o balde desta hora cresce.
    SELECT coalesce(sum(c.n), 0)::integer INTO v_anteriores
      FROM public.email_da_loja_contadores c
     WHERE c.chave = p_chave
       AND c.hora > v_hora - INTERVAL '24 hours'
       AND c.hora < v_hora;

    IF p_teto IS NOT NULL AND v_anteriores >= p_teto THEN
        RETURN false;
    END IF;

    -- Atômico: duas reservas ao mesmo tempo no mesmo balde se enfileiram na
    -- linha, e a segunda reavalia o WHERE com o valor que a primeira gravou.
    INSERT INTO public.email_da_loja_contadores AS c (chave, hora, n)
    VALUES (p_chave, v_hora, 1)
    ON CONFLICT (chave, hora) DO UPDATE
       SET n = c.n + 1
     WHERE p_teto IS NULL OR c.n + v_anteriores < p_teto
    RETURNING c.n INTO v_n;

    RETURN v_n IS NOT NULL;
END;
$$;

COMMENT ON FUNCTION public.reservar_vaga_de_email(text, integer) IS
'Reserva uma vaga no contador de e-mails da loja (janela de 24 h que anda, baldes por hora). true = reservou; false = teto atingido; p_teto nulo conta sem recusar. So o servidor executa (migration 20261217000000).';

-- c. generate_order_otp_v2: corpo vigente da 20260820000000, com os tetos
-- entre a janela de 60 s e a geração do código.
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

-- d. reivindicar_email_de_confirmacao: corpo vigente da 20260821000000, com o
-- teto do comprovante antes da marcação.
CREATE OR REPLACE FUNCTION public.reivindicar_email_de_confirmacao(
    p_order_id uuid
) RETURNS boolean
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path TO 'public'
AS $$
DECLARE
    -- Tetos do comprovante (janela de 24 h que anda; ajuste aqui). O de
    -- destinatario e' o MESMO contador do codigo (generate_order_otp_v2) e
    -- precisa do mesmo numero la; o da loja e' SO do comprovante, entao o
    -- comprovante nunca gasta a vaga do codigo. A cota real da conta de Gmail e
    -- desconhecida (pode ser ~100 por dia): 40 do comprovante + 40 do codigo =
    -- 80 < 100; o pedido PAGO fura este teto e so conta. Subir = migration nova.
    v_teto_por_destinatario CONSTANT integer := 10;
    v_teto_do_comprovante_na_loja CONSTANT integer := 40;
    v_reservado boolean;
    v_dados jsonb;
    v_user_id uuid;
    v_pago boolean;
BEGIN
    -- Teto diario (20261217000000), so para pedido que ainda nao foi avisado:
    -- repetir a chamada de um pedido ja reservado nao gasta vaga. Pedido pago
    -- conta mas nunca e' recusado (so a passagem para pago dispara o
    -- comprovante, uma vez). Sem vaga: false, como "ja enviado" -- quem chama
    -- nao envia e o pedido segue normal. Falha do CONTADOR (nao do teto) nao
    -- segura o comprovante: fica so no log do banco.
    SELECT o.customer_data, o.user_id,
           coalesce(o.payment_status, '') IN ('pago', 'pago_apos_expirar', 'recebido_na_entrega')
      INTO v_dados, v_user_id, v_pago
      FROM public.marketplace_orders o
     WHERE o.id = p_order_id
       AND o.confirmation_email_sent_at IS NULL
       FOR UPDATE;

    IF FOUND THEN
        BEGIN
            IF NOT public.reservar_vaga_de_email(
                'destinatario:' || public.chave_do_destinatario(coalesce(
                    nullif(trim(v_dados ->> 'email'), ''),
                    (SELECT trim(u.email) FROM auth.users u WHERE u.id = v_user_id),
                    ''
                )),
                CASE WHEN v_pago THEN NULL ELSE v_teto_por_destinatario END
            ) THEN
                RAISE EXCEPTION USING ERRCODE = 'IKE01';
            END IF;
            IF NOT public.reservar_vaga_de_email(
                'comprovante:loja',
                CASE WHEN v_pago THEN NULL ELSE v_teto_do_comprovante_na_loja END
            ) THEN
                RAISE EXCEPTION USING ERRCODE = 'IKE01';
            END IF;
        EXCEPTION
            WHEN SQLSTATE 'IKE01' THEN
                -- o bloco desfaz a vaga que ja tinha sido reservada no outro contador
                RAISE LOG 'reivindicar_email_de_confirmacao: teto diario atingido, comprovante nao enviado';
                RETURN false;
            WHEN OTHERS THEN
                RAISE LOG 'reivindicar_email_de_confirmacao: contador indisponivel (%), o comprovante segue', SQLSTATE;
        END;
    END IF;

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

-- e. get_orders_by_otp_v1: corpo vigente da 20261181000000, sem `restantes`.
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
            'error', 'Código inválido ou expirado.'
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

-- f. get_orders_by_otp_v2: a verificação amarrada ao trio do pedido.
CREATE OR REPLACE FUNCTION public.get_orders_by_otp_v2("p_email" "text", "p_whatsapp" "text", "p_fragmento" "text", "p_otp" "text") RETURNS "jsonb"
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
    v_rec RECORD;
    v_max_tentativas CONSTANT integer := 5;
    v_fragmento text := trim(coalesce(p_fragmento, ''));
BEGIN
    -- O trio, com as MESMAS regras da generate_order_otp_v2 (20260820000000):
    -- os dois canais obrigatorios e o fragmento so com o alfabeto de um UUID.
    IF coalesce(trim(p_email), '') = '' OR coalesce(trim(p_whatsapp), '') = ''
       OR v_fragmento !~ '^[0-9a-fA-F-]{6,}$' THEN
        RETURN jsonb_build_object('ok', false, 'error', 'Código inválido ou expirado.');
    END IF;

    -- So o codigo do pedido que confere com o trio. Quem sabe so o e-mail nao
    -- alcanca codigo nenhum, logo nao gasta tentativa de ninguem nem descobre
    -- se ha codigo ativo: sem trio, a resposta e' a mesma de "nao ha codigo".
    SELECT v.* INTO v_rec
      FROM public.otp_verifications v
      JOIN public.marketplace_orders o ON o.id = v.order_id
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
       AND v.expires_at > NOW()
       AND v.verified = false
     ORDER BY v.created_at DESC
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

COMMENT ON FUNCTION public.get_orders_by_otp_v2(text, text, text, text) IS
'Verifica o codigo do rastreio do convidado SO para o pedido que confere com e-mail + WhatsApp + fragmento (as mesmas regras da generate_order_otp_v2); tentativa errada so conta quando o trio confere. Porta do convidado: anon e authenticated executam (migration 20261217000000).';

-- Privilégios. Função nova nasce aberta ao anon neste banco (default
-- privileges), por isso o REVOKE explícito nas duas de apoio.
REVOKE EXECUTE ON FUNCTION public.chave_do_destinatario(text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.chave_do_destinatario(text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.chave_do_destinatario(text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.chave_do_destinatario(text) TO service_role;

REVOKE EXECUTE ON FUNCTION public.reservar_vaga_de_email(text, integer) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.reservar_vaga_de_email(text, integer) FROM anon;
REVOKE EXECUTE ON FUNCTION public.reservar_vaga_de_email(text, integer) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.reservar_vaga_de_email(text, integer) TO service_role;

REVOKE EXECUTE ON FUNCTION public.get_orders_by_otp_v2(text, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_orders_by_otp_v2(text, text, text, text) TO anon;
GRANT EXECUTE ON FUNCTION public.get_orders_by_otp_v2(text, text, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_orders_by_otp_v2(text, text, text, text) TO service_role;

-- CONFERÊNCIA no instante do apply: aborta se o estado final de privilégio não
-- for o esperado (um REVOKE que só avisou deixaria a porta aberta).
DO $conferencia_20261217$
DECLARE
  v_fn text;
BEGIN
  IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.email_da_loja_contadores'::regclass) THEN
    RAISE EXCEPTION 'conferencia 20261217: RLS desligada em email_da_loja_contadores';
  END IF;
  IF has_table_privilege('anon', 'public.email_da_loja_contadores', 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
     OR has_table_privilege('authenticated', 'public.email_da_loja_contadores', 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') THEN
    RAISE EXCEPTION 'conferencia 20261217: anon ou authenticated tem privilegio em email_da_loja_contadores';
  END IF;

  FOREACH v_fn IN ARRAY ARRAY[
    'public.chave_do_destinatario(text)',
    'public.reservar_vaga_de_email(text,integer)',
    'public.generate_order_otp_v2(text,text,text)',
    'public.reivindicar_email_de_confirmacao(uuid)'
  ] LOOP
    IF EXISTS (SELECT 1 FROM pg_proc p
                 CROSS JOIN LATERAL aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) g
                WHERE p.oid = to_regprocedure(v_fn) AND g.privilege_type = 'EXECUTE' AND g.grantee = 0)
       OR has_function_privilege('anon', v_fn, 'EXECUTE')
       OR has_function_privilege('authenticated', v_fn, 'EXECUTE') THEN
      RAISE EXCEPTION 'conferencia 20261217: % alcancavel por PUBLIC, anon ou authenticated', v_fn;
    END IF;
    IF NOT has_function_privilege('service_role', v_fn, 'EXECUTE') THEN
      RAISE EXCEPTION 'conferencia 20261217: service_role sem EXECUTE em %', v_fn;
    END IF;
  END LOOP;

  FOREACH v_fn IN ARRAY ARRAY[
    'public.get_orders_by_otp_v1(text,text)',
    'public.get_orders_by_otp_v2(text,text,text,text)'
  ] LOOP
    IF EXISTS (SELECT 1 FROM pg_proc p
                 CROSS JOIN LATERAL aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) g
                WHERE p.oid = to_regprocedure(v_fn) AND g.privilege_type = 'EXECUTE' AND g.grantee = 0) THEN
      RAISE EXCEPTION 'conferencia 20261217: % aberta para PUBLIC', v_fn;
    END IF;
    IF NOT has_function_privilege('anon', v_fn, 'EXECUTE')
       OR NOT has_function_privilege('authenticated', v_fn, 'EXECUTE') THEN
      RAISE EXCEPTION 'conferencia 20261217: % sem EXECUTE de anon ou authenticated -- o convidado ficaria sem rastreio', v_fn;
    END IF;
  END LOOP;
END $conferencia_20261217$;
