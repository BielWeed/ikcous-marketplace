-- Voltar o front primeiro. Restaura a rotina da 20261405600000 byte a byte
-- e retira somente as portas novas, sem modificar pedido, estoque ou estorno.

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

DO $preflight_rb_5700$
DECLARE
  v_base boolean;
  v_novo boolean;
  v_foto text;
BEGIN
  WITH esperadas(nome, assinatura, autenticado, argumentos, anterior, corpo) AS (
  VALUES
    ('pedido__mudar_status', 'public.pedido__mudar_status(uuid,text,text,uuid,boolean,boolean)', false, 'p_order_id uuid, p_new_status text, p_notes text, p_ator uuid, p_ator_admin boolean, p_pela_edge boolean', 'fea4db42491c2e229a5ac8ee9484d909', '1c44358ad6c8d68b643a42b2ccdb6e96'),
    ('pedido__mudar_status_com_etapa', 'public.pedido__mudar_status_com_etapa(uuid,text,text,uuid,boolean,boolean,text)', false, 'p_order_id uuid, p_new_status text, p_notes text, p_ator uuid, p_ator_admin boolean, p_pela_edge boolean, p_status_esperado text', NULL, '85468e44910e8ebda435577587256f1f'),
    ('cancelar_pedido_do_painel', 'public.cancelar_pedido_do_painel(uuid,text,text)', true, 'p_order_id uuid, p_status_esperado text, p_notes text DEFAULT NULL::text', NULL, 'da2f542b28b878c41ed22de015310fa8')
), estado AS (
  SELECT e.nome, e.anterior, e.corpo, md5(replace(p.prosrc, chr(13), '')) AS vivo, p.oid,
         p.proowner, p.proacl,
         (SELECT count(*) FROM pg_proc q WHERE q.pronamespace = 'public'::regnamespace
           AND q.proname = e.nome) AS quantas,
         (l.lanname = 'plpgsql' AND p.prokind = 'f' AND p.prosecdef
          AND p.provolatile = 'v' AND NOT p.proisstrict AND NOT p.proretset
          AND p.prorettype = 'jsonb'::regtype
          AND p.proconfig = ARRAY['search_path=public']::text[]
          AND pg_get_function_arguments(p.oid) = e.argumentos
          AND has_function_privilege('authenticated', p.oid, 'EXECUTE') = e.autenticado
          AND NOT has_function_privilege('anon', p.oid, 'EXECUTE')
          AND NOT has_function_privilege('service_role', p.oid, 'EXECUTE')
          AND NOT EXISTS (
            SELECT 1 FROM aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) a
             WHERE a.grantee = 0 AND a.privilege_type = 'EXECUTE'
          )) AS atributos
    FROM esperadas e
    LEFT JOIN pg_proc p ON p.oid = to_regprocedure(e.assinatura)
    LEFT JOIN pg_language l ON l.oid = p.prolang
)
  SELECT COALESCE(bool_and(
           CASE WHEN nome = 'pedido__mudar_status'
             THEN (vivo = anterior AND atributos IS TRUE AND quantas = 1) IS TRUE
             ELSE quantas = 0 END
         ), false),
         COALESCE(bool_and((vivo = corpo AND atributos IS TRUE AND quantas = 1) IS TRUE), false),
         max(CASE WHEN nome = 'pedido__mudar_status'
             THEN jsonb_build_array(oid, proowner, proacl)::text END)
    INTO v_base, v_novo, v_foto
    FROM estado;

  IF NOT (v_base OR v_novo) THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: corpos, atributos ou ACL do cancelamento do painel divergentes.';
  END IF;
  PERFORM set_config('ikcous.foto_20261405700000', v_foto, true);
END $preflight_rb_5700$;

CREATE OR REPLACE FUNCTION public.pedido__mudar_status(
    p_order_id uuid,
    p_new_status text,
    p_notes text,
    p_ator uuid,
    p_ator_admin boolean,
    p_pela_edge boolean
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_old_status TEXT;
    v_user_id UUID;
    -- 20261198: quem age chega por parâmetro (a casca update_order_status_
    -- atomic passa auth.uid() e o admin ATUAL; a RPC da edge, o ator
    -- autenticado — as duas leem o papel em auth.users E profiles).
    v_caller_id UUID := p_ator;
    v_is_admin BOOLEAN := COALESCE(p_ator_admin, false);
    v_cancelled_after_shipping BOOLEAN;
    v_retirada BOOLEAN;
    v_payment_status TEXT;
    v_paid_at TIMESTAMPTZ;
    v_metodo_online TEXT;
    v_gateway_payment_id TEXT;
    v_canal TEXT;
    v_total NUMERIC;
    v_saldo NUMERIC;
    v_item RECORD;
    v_result jsonb;
BEGIN
    -- Antes de qualquer leitura: sem sessão, nem existência de pedido se revela.
    IF v_caller_id IS NULL THEN
        RAISE EXCEPTION 'Não autorizado: é preciso estar autenticado para alterar um pedido.';
    END IF;

    -- 20261198: ORDEM GLOBAL DE TRAVAS (ver o cabeçalho) — o cancelamento lê
    -- e escreve o ledger do estorno, então trava PRIMEIRO as linhas de
    -- order_refunds do pedido (por id) e SÓ DEPOIS o pedido, como
    -- concluir_estorno e registrar_estorno_manual. Os outros status não
    -- tocam no ledger e não pegam esta trava.
    IF p_new_status = 'cancelled' THEN
        PERFORM 1
           FROM public.order_refunds r
          WHERE r.order_id = p_order_id
          ORDER BY r.id
            FOR UPDATE;
    END IF;

    -- Get current status and lock row
    SELECT status, user_id, cancelled_after_shipping, payment_status, paid_at, total,
           metodo_online, gateway_payment_id, canal,
           COALESCE(customer_data ->> 'shipping_option_id', '') = 'store-pickup'
      INTO v_old_status, v_user_id, v_cancelled_after_shipping, v_payment_status, v_paid_at, v_total,
           v_metodo_online, v_gateway_payment_id, v_canal, v_retirada
    FROM public.marketplace_orders
    WHERE id = p_order_id
    FOR UPDATE;

    IF v_old_status IS NULL THEN
        RAISE EXCEPTION 'Pedido não encontrado.';
    END IF;

    -- Security checks
    -- IS DISTINCT FROM, não `!=`: pedido de convidado tem user_id NULL, e
    -- `NULL != <uuid>` avalia para NULL — o IF não dispararia.
    IF v_user_id IS DISTINCT FROM v_caller_id AND NOT v_is_admin THEN
        RAISE EXCEPTION 'Não autorizado: Você não tem permissão para alterar este pedido.';
    END IF;

    IF NOT v_is_admin THEN
        IF p_new_status IS DISTINCT FROM 'cancelled' THEN
            RAISE EXCEPTION 'Operação não permitida: Usuários só podem cancelar seus próprios pedidos.';
        END IF;
        -- Regra do Gabriel (24/08/2026): o divisor e' se o produto SAIU, nao
        -- foi pago. Nao enviado e enviado podem ser cancelados; entregue nao —
        -- produto entregue e' devolucao, que e' outro assunto e outra decisao.
        IF v_old_status NOT IN ('pending', 'processing', 'shipping') THEN
            RAISE EXCEPTION 'Este pedido não pode mais ser cancelado por você.';
        END IF;

        -- Guarda da 20261180000000 (cliente com cartão vivo), mesma condição
        -- e mesmo texto. 20261198: não vale quando a edge já PROVOU, no
        -- Mercado Pago, que a cobrança da vaga foi anulada (`p_pela_edge`) —
        -- aí não há mais cartão que o banco possa aprovar.
        IF v_payment_status = 'aguardando'
           AND (
                v_metodo_online IN ('credito', 'debito')
                OR v_gateway_payment_id LIKE 'verificando:%'
           )
           AND NOT p_pela_edge
        THEN
            RAISE EXCEPTION 'Este pedido tem uma cobrança no cartão em confirmação com o banco. Aguarde a confirmação ou fale com a loja antes de cancelar.';
        END IF;
    END IF;

    -- 20261198 (S1, o BYPASS): pedido aguardando pagamento com a vaga ocupada
    -- (PIX aberto, cartão, ou o sentinela `verificando:`) só se cancela pela
    -- edge, que anula a cobrança no MP ANTES. Vale para cliente E admin.
    -- `payment_status` NULL com a vaga ocupada é TRANSITÓRIO (a cobrança
    -- existe e ninguém gravou o desfecho ainda) — mesmo tratamento de
    -- 'aguardando': exige a prova da edge (o princípio que a 20261195 aplicou
    -- ao recusado com NULL). Pedido sem vaga (não online, ou online sem
    -- cobrança) e pedido com desfecho gravado (pago etc.) não caem aqui.
    -- Re-cancelar um pedido já cancelado também não (não há efeito novo:
    -- estoque e estorno são idempotentes). "não pode ser cancelado": a frase
    -- que a fila offline do painel trata como terminal.
    IF p_new_status = 'cancelled'
       AND v_old_status IS DISTINCT FROM 'cancelled'
       AND (v_payment_status IS NULL OR v_payment_status = 'aguardando')
       AND v_gateway_payment_id IS NOT NULL
       AND NOT p_pela_edge
    THEN
        RAISE EXCEPTION 'Este pedido tem uma cobrança aberta no Mercado Pago e não pode ser cancelado por aqui. Use o botão Cancelar do pedido: ele anula a cobrança antes de cancelar.';
    END IF;

    -- Grava o que o app hoje ESQUECE ao cancelar: se o produto ja tinha saido.
    -- Sem isto, depois do cancelamento nao ha como saber se o estorno espera a
    -- mercadoria voltar. Nao existe tabela de historico de status neste banco.
    -- (v_old_status = 'shipping' e p_new_status = 'cancelled' ja garantem que
    -- os dois sao distintos -- sem clausula extra sobre isso.)
    -- 20261198: ENTREGUE também é "o produto saiu" — e com mais certeza. O
    -- carimbo é o FATO HISTÓRICO e nada o apaga (reativar não mexe nele): sem
    -- ele, entregue -> cancelar -> reativar (processing) -> cancelar perdia a
    -- memória da entrega e o 2º cancelamento creditava o estoque e abria o
    -- estorno sem a peça voltar. Com ele, o estoque só volta pelo retorno
    -- físico explícito (confirmar_retorno_do_produto, idempotente) e o
    -- estorno espera o lojista, como no 'shipping'. Fora: a venda de BALCÃO
    -- (`canal = 'presencial'`), que NASCE 'delivered' e cujo cancelamento
    -- devolve o estoque na hora (ver o bloco do estoque abaixo).
    IF p_new_status = 'cancelled'
       AND (
            (v_old_status = 'shipping' AND NOT (v_retirada AND v_is_admin))
            OR (v_old_status = 'delivered' AND v_canal IS DISTINCT FROM 'presencial')
       ) THEN
        UPDATE public.marketplace_orders
           SET cancelled_after_shipping = true
         WHERE id = p_order_id;
    END IF;

    -- LEDGER DO ESTORNO (2026110000000, regra do Gabriel 24/08/2026):
    -- pedido PAGO cancelado SEM ter saido -> o pedido de devolucao NASCE
    -- AQUI, na MESMA transacao do cancelamento. Ou as duas coisas acontecem
    -- juntas, ou nenhuma (ROLLBACK). Shipping só entra para retirada cancelada
    -- pelo admin; o cliente pode já ter levado a peça. NOT v_cancelled_after_shipping (laudo C2
    -- do PR #436); payment_status pago E paid_at (dado legado sem paid_at
    -- não gera linha).
    -- 20261198 (R11): o valor é o REMANESCENTE (`pedido__saldo_a_estornar`,
    -- a conta de solicitar_estorno): total − já confirmado − em voo −
    -- reembolso manual de devolução. Substitui o "NOT EXISTS (solicitado/
    -- em_processamento/concluido)" + "total − manual": aquela regra não abria
    -- os 70 restantes de um pago 100 com 30 já devolvidos. O ciclo
    -- reativar->cancelar continua abrindo UMA linha só: a primeira reserva o
    -- saldo inteiro (em voo) e a segunda vê saldo zero.
    --   solicitado_por: quem cancelou — lojista pelo painel, cliente no app.
    IF p_new_status = 'cancelled'
       AND (v_old_status IN ('pending', 'processing') OR (v_old_status = 'shipping' AND v_retirada AND v_is_admin))
       AND v_payment_status IN ('pago', 'pago_apos_expirar')
       AND v_paid_at IS NOT NULL
       AND NOT v_cancelled_after_shipping
    THEN
        v_saldo := public.pedido__saldo_a_estornar(p_order_id);

        IF v_saldo > 0 THEN
            INSERT INTO public.order_refunds (order_id, amount, motivo, solicitado_por)
            VALUES (p_order_id, v_saldo, 'cancelamento antes do envio',
                    CASE WHEN v_is_admin THEN 'lojista' ELSE 'cliente' END);
        END IF;
    END IF;

    -- STOCK RESTORATION LOGIC
    -- Em 'shipping', só o admin pode liberar estoque de retirada de imediato.
    -- Para o cliente permanece o retorno físico confirmado pela loja.
    -- 20261198: `delivered` é o mesmo caso, com mais certeza ainda — a peça
    -- foi ENTREGUE. Cancelar não a traz de volta; o estoque só volta pelo
    -- fluxo de devolução. EXCEÇÃO: a venda de BALCÃO (`canal =
    -- 'presencial'`) nasce 'delivered' e o cancelamento dela sempre devolveu
    -- o estoque (invariante (d)(j) de tests/banco/invariantes-dinheiro.cjs:
    -- "entra no MESMO caminho de cancelamento do resto do app") — fica como
    -- estava; o plano S1 não decidiu sobre ela.
    --
    -- `NOT v_cancelled_after_shipping` (laudo 0109, A8): pedido cancelado
    -- apos o envio que a loja REATIVA e re-cancela a partir de 'processing'
    -- e' o mesmo envio — a peca continua com o cliente, e creditar aqui era
    -- phantom.
    IF p_new_status = 'cancelled'
       AND v_old_status IS DISTINCT FROM 'cancelled'
       AND (v_old_status IS DISTINCT FROM 'shipping' OR (v_retirada AND v_is_admin))
       AND (v_old_status IS DISTINCT FROM 'delivered' OR v_canal = 'presencial')
       AND NOT v_cancelled_after_shipping THEN
        -- Mesmo laco de public.devolver_estoque(uuid); idempotente pelo fato
        -- (stock_returned_at): a oscilacao cancelled -> processing ->
        -- cancelled credita UMA vez, na primeira.
        PERFORM public.devolver_estoque(p_order_id);

        -- A vaga do cupom NAO volta aqui (Rodada 4): so' na varredura
        -- devolver_cupons_de_pedidos_mortos(), depois que o PIX ja nao pode
        -- mais ser pago.
    END IF;

    -- Update status
    UPDATE public.marketplace_orders
    SET status = p_new_status, updated_at = NOW()
    WHERE id = p_order_id
    RETURNING to_jsonb(public.marketplace_orders.*) INTO v_result;

    -- Log history
    INSERT INTO public.marketplace_order_history (order_id, old_status, new_status, notes, created_by)
    VALUES (p_order_id, v_old_status, p_new_status, p_notes, v_caller_id);

    RETURN v_result;
END;
$$;

DROP FUNCTION IF EXISTS public.cancelar_pedido_do_painel(uuid,text,text);
DROP FUNCTION IF EXISTS public.pedido__mudar_status_com_etapa(uuid,text,text,uuid,boolean,boolean,text);

DO $conferencia_rb_5700$
DECLARE
  v_base boolean;
  v_novo boolean;
  v_foto text;
BEGIN
  WITH esperadas(nome, assinatura, autenticado, argumentos, anterior, corpo) AS (
  VALUES
    ('pedido__mudar_status', 'public.pedido__mudar_status(uuid,text,text,uuid,boolean,boolean)', false, 'p_order_id uuid, p_new_status text, p_notes text, p_ator uuid, p_ator_admin boolean, p_pela_edge boolean', 'fea4db42491c2e229a5ac8ee9484d909', '1c44358ad6c8d68b643a42b2ccdb6e96'),
    ('pedido__mudar_status_com_etapa', 'public.pedido__mudar_status_com_etapa(uuid,text,text,uuid,boolean,boolean,text)', false, 'p_order_id uuid, p_new_status text, p_notes text, p_ator uuid, p_ator_admin boolean, p_pela_edge boolean, p_status_esperado text', NULL, '85468e44910e8ebda435577587256f1f'),
    ('cancelar_pedido_do_painel', 'public.cancelar_pedido_do_painel(uuid,text,text)', true, 'p_order_id uuid, p_status_esperado text, p_notes text DEFAULT NULL::text', NULL, 'da2f542b28b878c41ed22de015310fa8')
), estado AS (
  SELECT e.nome, e.anterior, e.corpo, md5(replace(p.prosrc, chr(13), '')) AS vivo, p.oid,
         p.proowner, p.proacl,
         (SELECT count(*) FROM pg_proc q WHERE q.pronamespace = 'public'::regnamespace
           AND q.proname = e.nome) AS quantas,
         (l.lanname = 'plpgsql' AND p.prokind = 'f' AND p.prosecdef
          AND p.provolatile = 'v' AND NOT p.proisstrict AND NOT p.proretset
          AND p.prorettype = 'jsonb'::regtype
          AND p.proconfig = ARRAY['search_path=public']::text[]
          AND pg_get_function_arguments(p.oid) = e.argumentos
          AND has_function_privilege('authenticated', p.oid, 'EXECUTE') = e.autenticado
          AND NOT has_function_privilege('anon', p.oid, 'EXECUTE')
          AND NOT has_function_privilege('service_role', p.oid, 'EXECUTE')
          AND NOT EXISTS (
            SELECT 1 FROM aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) a
             WHERE a.grantee = 0 AND a.privilege_type = 'EXECUTE'
          )) AS atributos
    FROM esperadas e
    LEFT JOIN pg_proc p ON p.oid = to_regprocedure(e.assinatura)
    LEFT JOIN pg_language l ON l.oid = p.prolang
)
  SELECT COALESCE(bool_and(
           CASE WHEN nome = 'pedido__mudar_status'
             THEN (vivo = anterior AND atributos IS TRUE AND quantas = 1) IS TRUE
             ELSE quantas = 0 END
         ), false),
         COALESCE(bool_and((vivo = corpo AND atributos IS TRUE AND quantas = 1) IS TRUE), false),
         max(CASE WHEN nome = 'pedido__mudar_status'
             THEN jsonb_build_array(oid, proowner, proacl)::text END)
    INTO v_base, v_novo, v_foto
    FROM estado;

  IF NOT (v_base) THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: corpos, atributos ou ACL do cancelamento do painel divergentes.';
  END IF;
  IF current_setting('ikcous.foto_20261405700000', true) IS DISTINCT FROM v_foto THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: OID, dono ou ACL da rotina anterior mudou.';
  END IF;
END $conferencia_rb_5700$;

NOTIFY pgrst, 'reload schema';
