-- ============================================================================
-- Rollback manual — o e-mail da loja tem teto e o código do convidado não se
-- queima (20261217000000)
-- ============================================================================
-- Devolve, byte a byte, os três corpos vigentes antes da migration:
--   * `generate_order_otp_v2` da 20260820000000 (md5 8fab5091db4a380bf07592f7dc896856) — sem
--     os tetos diários do código;
--   * `reivindicar_email_de_confirmacao` da 20260821000000 (md5
--     45be19bf714f266f8234f11df820b76b) — sem o teto do comprovante;
--   * `get_orders_by_otp_v1` da 20261181000000 (md5 b472f00d6b36002522b25bf04113a035) — com o
--     campo `restantes` de volta.
-- Mesmas assinaturas, mesmo SECURITY DEFINER e search_path, mesma ACL
-- (CREATE OR REPLACE preserva a vigente).
--
-- O QUE FICA: a tabela `email_da_loja_contadores`, as funções
-- `chave_do_destinatario` e `reservar_vaga_de_email` (só o servidor executa;
-- ninguém mais as chama depois deste rollback) e a `get_orders_by_otp_v2`, que
-- é a porta que o front novo usa para o rastreio do convidado — apagá-la
-- derrubaria o rastreio. Nenhuma tabela é apagada (o envelope do
-- aplicar-migrations recusa DROP TABLE).
--
-- DADOS: os contadores ficam como estão e deixam de ser lidos; nenhuma linha de
-- pedido ou de código foi reescrita pela migration.
--
-- PRÉ-VOO: o `DO $preflight_rollback_20261217$` recusa com
-- `B1_BASELINE_DIVERGENT` — ANTES de qualquer escrita — se algum dos três
-- corpos vivos não for exatamente o que a 20261217000000 deixou: desfazer por
-- cima de uma redefinição POSTERIOR apagaria a dela em silêncio, e desfazer
-- duas vezes não tem o que desfazer.
--
-- ORDEM: se a 20261220000000 (a consulta antiga de pedido por código fecha para o visitante) já está
-- aplicada, o pré-voo RECUSA este rollback (v1 sem EXECUTE para anon ou authenticated): rode antes o
-- rollback-manual-20261220000000_a_consulta_antiga_de_pedido_por_codigo_fecha_para_o_visitante.sql.
-- Com a 20261217000000 sendo a última (v1 aberta), nada muda aqui.
--
-- Executar pelo aplicar-migrations.yml (apaga o registro do ledger na mesma
-- transação). Sem BEGIN/COMMIT de nível superior neste arquivo — regra da casa.
-- ============================================================================

DO $preflight_rollback_20261217$
DECLARE
  r record;
  v_hash text;
BEGIN
  FOR r IN
    SELECT *
      FROM (VALUES
        ('public.generate_order_otp_v2(text,text,text)', '92fdc055f2c9868c7a4592ede3dab3b9'),
        ('public.reivindicar_email_de_confirmacao(uuid)', '74e559c6ba26ebc01d6357b9dd87f1dd'),
        ('public.get_orders_by_otp_v1(text,text)', '277776acaf395fa864cc3e2cb0638237')
      ) AS esperado(assinatura, hash_desta)
  LOOP
    SELECT md5(replace(prosrc, E'\r', '')) INTO v_hash
      FROM pg_proc
     WHERE oid = to_regprocedure(r.assinatura);

    IF v_hash IS DISTINCT FROM r.hash_desta THEN
      RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: corpo vivo de % (hash %) não é o que a 20261217000000 deixou — nada a desfazer, ou uma redefinição posterior está no ar; revise antes de reverter.', r.assinatura, COALESCE(v_hash, 'ausente');
    END IF;
  END LOOP;

  -- Ordem de desfazer: com a 20261220000000 (a v1 fechada para o visitante) aplicada, este rollback
  -- deixaria a v1 com o corpo antigo e FECHADA, e nem o rollback da 20261220 (que exige o corpo da
  -- 20261217) nem a reaplicação da 20261217 (cuja conferência exige a v1 aberta) voltariam a passar.
  IF NOT has_function_privilege('anon', 'public.get_orders_by_otp_v1(text,text)', 'EXECUTE')
     OR NOT has_function_privilege('authenticated', 'public.get_orders_by_otp_v1(text,text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: public.get_orders_by_otp_v1(text,text) está fechada para anon ou authenticated (a 20261220000000 está aplicada) — rode o rollback-manual-20261220000000_a_consulta_antiga_de_pedido_por_codigo_fecha_para_o_visitante.sql ANTES deste.';
  END IF;
END $preflight_rollback_20261217$;

-- generate_order_otp_v2: corpo vigente da 20260820000000_otp_v2_devolve_o_codigo.sql.
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

-- reivindicar_email_de_confirmacao: corpo vigente da 20260821000000_confirmacao_de_pedido_uma_vez.sql.
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

-- get_orders_by_otp_v1: corpo vigente da 20261181000000_pedido_por_whatsapp_fecha_para_anon.sql.
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
