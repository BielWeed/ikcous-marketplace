-- O ESTORNO NASCE NO LEDGER — Task 1 da frente "estorno de dinheiro pelo
-- app" (plano 20260907).
--
-- REGRA DO GABRIEL (24/08/2026, nao se reinterpreta): pedido pago SEM envio
-- -> o cliente cancela e o estorno e' AUTOMATICO; pago JA enviado -> o
-- cliente cancela, o estorno e' MANUAL do lojista e so' DEPOIS de o produto
-- voltar a mao dele.
--
-- O QUE ESTA MIGRATION FAZ (e o que ela NAO faz):
--   1. Cria a tabela order_refunds — o LEDGER da devolucao. O pedido de
--      estorno nasce como LINHA, escrita por quem sabe: a RPC de
--      cancelamento (pago sem envio, NA MESMA TRANSACAO) ou a RPC
--      solicitar_estorno (o botao do lojista, com o produto ja de volta).
--      Quem move o dinheiro e' UM executor unico (edge estornar-pagamento +
--      cron reconciliar-pagamentos, Tasks 2-4) — NADA de dinheiro se move
--      aqui. Esta migration e' so' o nascimento do pedido.
--   2. Acrescenta marketplace_orders.valor_estornado — o ACUMULADO
--      confirmado (default 0). Quem soma e' concluir_estorno (Task 3),
--      JAMAIS esta migration: valor_estornado so' anda com confirmacao do
--      Mercado Pago.
--   3. Recria update_order_status_atomic INTEIRA com o bloco do estorno:
--      cancelamento de pedido pago NAO ENVIADO grava a linha de devolucao
--      na MESMA TRANSACAO do cancelamento. E' isso que torna impossivel
--      "cancelou e ninguem pediu o dinheiro de volta": ou as duas coisas
--      acontecem juntas, ou nenhuma (ROLLBACK). Pedido SHIPPING cancelado
--      NAO gera linha (estorno manual, depois do retorno — a regra de 24/08
--      do lado do enviado, e solicitar_estorno e' quem exige o retorno).
--
-- POR QUE O CORPO COPIADO E' O DE 20261060000000 (e nao o da 20260970000000
-- citado na redacao original do plano): a funcao viva e' SEMPRE a da
-- migration mais recente que a redefiniu — e essa e' a 20261060000000 (o
-- estoque volta uma vez so), que acrescentou a leitura de
-- cancelled_after_shipping no SELECT e a guarda NOT v_cancelled_after_shipping
-- no credito de estoque. Copiar o corpo da 20260970000000 REGREDIRIA o
-- banco (reabriria a porta do estoque fantasma que a A8 fechou).
--
-- SEM BEGIN/COMMIT (regra da casa: com eles o ROLLBACK do script de prova
-- vira no-op e a mudanca fica gravada).
--
-- PROVA (transacao com ROLLBACK, vermelho primeiro):
--   node scripts/db-prove-estorno-ledger.cjs
-- ROLLBACK MANUAL: rollback-manual-2026110000000_o_estorno_nasce_no_ledger.sql
-- (versionado junto; a foto de antes/depois e' conferida por
-- scripts/db-prove-rollback.cjs).
--
-- NAO APLICADA NO BANCO VIVO: aplicacao e' pendencia do dono, com este SQL
-- mostrado inteiro no PR. NUNCA supabase db push.

-- ============================================================================
-- 1. O ledger: tabela order_refunds
-- ============================================================================

CREATE TABLE public.order_refunds (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    order_id uuid NOT NULL REFERENCES public.marketplace_orders(id),
    amount numeric(12,2) NOT NULL CHECK (amount > 0),
    motivo text,
    solicitado_por text NOT NULL CHECK (solicitado_por IN ('cliente','lojista','sistema')),
    status text NOT NULL DEFAULT 'solicitado'
        CHECK (status IN ('solicitado','em_processamento','concluido','falhou','recusado')),
    mp_refund_id text,
    mp_status text,
    mp_status_detail text,
    tentativas integer NOT NULL DEFAULT 0,
    ultimo_erro text,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    concluido_em timestamptz
);

COMMENT ON TABLE public.order_refunds IS
  'Ledger da devolucao de dinheiro: cada linha e UM pedido de estorno, nascido por quem sabe (a RPC de cancelamento para pago-sem-envio, na mesma transacao; solicitar_estorno para o lojista; o webhook para o feito fora do app — Task 5). Nada e apagado nunca: falhou e recusado sao ESTADO, com ultimo_erro. Quem move o dinheiro e o executor unico das Tasks 2-4.';

COMMENT ON COLUMN public.order_refunds.id IS
  'Chave primaria e, ao mesmo tempo, a X-Idempotency-Key enviada ao Mercado Pago (plano: idempotencia = order_refunds.id, sempre). O executor NUNCA cria chave nova para o mesmo dinheiro.';

COMMENT ON COLUMN public.order_refunds.order_id IS
  'O pedido cujo dinheiro se devolve. FK para marketplace_orders. O cliente so ve linhas dos proprios pedidos (policy de SELECT).';

COMMENT ON COLUMN public.order_refunds.amount IS
  'Valor pedido ao Mercado Pago, em BRL. CHECK amount > 0: nao existe estorno de zero. O total devolvido do pedido nunca passa do total pago — a guarda vive em solicitar_estorno (saldo) e no executor (Task 2).';

COMMENT ON COLUMN public.order_refunds.motivo IS
  'Porque esta linha existe, em texto leigo (sem id do MP, sem jargao). Cancelamento antes do envio grava ''cancelamento antes do envio''; o botao do lojista grava o que ele digitou.';

COMMENT ON COLUMN public.order_refunds.solicitado_por IS
  'QUEM sabe desta devolucao: cliente (cancelou pago-sem-envio), lojista (botao do painel), sistema (webhook de estorno feito fora do app — Task 5). So essas tres fontes existem.';

COMMENT ON COLUMN public.order_refunds.status IS
  'Maquina de estados do plano: solicitado (linha nasceu, ninguem chamou o MP ainda) -> em_processamento (marca de "ja pedi ao MP com ESTA chave" — o cron consulta e repete o POST com a MESMA chave, nunca cria chave nova) -> concluido (MP confirmou na resposta ou na consulta). falhou = erro definitivo; recusado = guarda recusou antes de chamar. Nada e apagado.';

COMMENT ON COLUMN public.order_refunds.mp_refund_id IS
  'Id do refund no Mercado Pago, gravado so quando existe de verdade (resposta/consulta). NUNCA aparece em texto de tela.';

COMMENT ON COLUMN public.order_refunds.mp_status IS
  'Status cru devolvido pelo MP para este refund (ex.: refunded, in_process, charged_back). Diagnostico, nao regra: quem decide e o executor (Task 2).';

COMMENT ON COLUMN public.order_refunds.mp_status_detail IS
  'Detalhe do status do MP (ex.: partially_refunded). Diagnostico, nao regra.';

COMMENT ON COLUMN public.order_refunds.tentativas IS
  'Quantas vezes o executor chamou (ou tentou chamar) o MP por esta linha. Teto de 5 no cron (Task 4); e o freio da fila, nunca do usuario.';

COMMENT ON COLUMN public.order_refunds.ultimo_erro IS
  'Texto do ultimo erro, para o lojista ler na tela com traducao leiga (Task 6). Guardado inclusive em falhou/recusado — estado sem explicacao e estado inutil.';

COMMENT ON COLUMN public.order_refunds.created_at IS
  'Quando a linha nasceu (o pedido de estorno, nao a confirmacao).';

COMMENT ON COLUMN public.order_refunds.updated_at IS
  'Ultima mudanca de status/tentativas. E a coluna da janela de 2 min do cron (Task 4) — atualizada ha menos de 2 min, o cron nao pega (evita disputar com o clique do lojista na edge).';

COMMENT ON COLUMN public.order_refunds.concluido_em IS
  'Quando o Mercado Pago confirmou (status = concluido). NULL enquanto o dinheiro nao voltou.';

-- Indice por pedido: a tela do pedido lista as linhas dele.
CREATE INDEX idx_order_refunds_order_id ON public.order_refunds (order_id);

-- Indice parcial da FILA: so as linhas que o executor ainda deve processar.
CREATE INDEX idx_order_refunds_pendentes ON public.order_refunds (status)
  WHERE status IN ('solicitado', 'em_processamento');

COMMENT ON INDEX public.idx_order_refunds_pendentes IS
  'Fila do executor (edge do clique + cron): so conta quem esta em solicitado/em_processamento. concluido/falhou/recusado nao custam varredura nenhuma.';

-- ============================================================================
-- 2. RLS: admin tudo, cliente le' as linhas dos proprios pedidos, anon nada
-- ============================================================================

ALTER TABLE public.order_refunds ENABLE ROW LEVEL SECURITY;

CREATE POLICY order_refunds_admin_all ON public.order_refunds
  FOR ALL TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

CREATE POLICY order_refunds_cliente_le ON public.order_refunds
  FOR SELECT TO authenticated
  USING (
    order_id IN (SELECT id FROM public.marketplace_orders WHERE user_id = auth.uid())
  );

-- Escrita por PostgREST NAO EXISTE nesta tabela: o painel pede estorno pela
-- RPC solicitar_estorno (SECURITY DEFINER) e as edges escrevem com
-- service_role. O default privilege do Supabase nasce dando ALL para
-- authenticated em tabela nova — por isso o REVOKE o nomeia (o mesmo
-- padrao medido na 20260970000000 para funcoes: REVOKE FROM PUBLIC sozinho
-- nao alcanc,a os default privileges). authenticated fica so' com SELECT;
-- anon/PUBLIC nao recebem nada.
REVOKE ALL ON TABLE public.order_refunds FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.order_refunds TO authenticated;

-- ============================================================================
-- 3. O acumulado confirmado no proprio pedido
-- ============================================================================

ALTER TABLE public.marketplace_orders
  ADD COLUMN IF NOT EXISTS valor_estornado numeric(12,2) NOT NULL DEFAULT 0;

COMMENT ON COLUMN public.marketplace_orders.valor_estornado IS
  'Total CONFIRMADO devolvido deste pedido (BRL). So sobe em concluir_estorno (Task 3), depois de o Mercado Pago dizer refunded/approved — jamais no nascimento da linha (linha solicitada NAO e dinheiro devolvido). payment_status so vira ''estornado'' quando valor_estornado alcanca o total pago.';

-- ============================================================================
-- 4. solicitar_estorno: o botao do lojista (regra 24/08, lado do enviado)
-- ============================================================================

CREATE OR REPLACE FUNCTION public.solicitar_estorno(
    p_order_id uuid,
    p_amount numeric,
    p_motivo text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_status TEXT;
    v_payment_status TEXT;
    v_paid_at TIMESTAMPTZ;
    v_total NUMERIC;
    v_cancelled_after_shipping BOOLEAN;
    v_returned_at TIMESTAMPTZ;
    v_valor_estornado NUMERIC;
    v_em_curso NUMERIC;
    v_saldo NUMERIC;
    v_refund_id UUID;
BEGIN
    -- So' a loja pede devolucao pelo painel. ERRCODE 42501 para o front
    -- distinguir "nao e' a loja" de qualquer outro erro.
    IF NOT public.is_admin() THEN
        RAISE EXCEPTION 'Somente a loja pede a devolução pelo painel.'
            USING ERRCODE = '42501';
    END IF;

    SELECT status, payment_status, paid_at, total,
           cancelled_after_shipping, returned_to_seller_at, valor_estornado
      INTO v_status, v_payment_status, v_paid_at, v_total,
           v_cancelled_after_shipping, v_returned_at, v_valor_estornado
      FROM public.marketplace_orders
     WHERE id = p_order_id
       FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Pedido não encontrado.';
    END IF;

    -- Dinheiro que nao entrou nao se devolve. IS NULL explicito porque
    -- `NULL NOT IN (...)` avaliaria para NULL e o IF nao dispararia.
    IF v_payment_status IS NULL
       OR v_payment_status NOT IN ('pago', 'pago_apos_expirar') THEN
        RAISE EXCEPTION 'Este pedido não está pago: não há dinheiro do Mercado Pago para devolver.'
            USING ERRCODE = 'P0001';
    END IF;

    -- Regra 24/08: o estorno manual so' existe para pedido CANCELADO. Pedir
    -- devolucao de pedido vivo e' trocar o dinheiro sem desfazer a venda.
    IF v_status IS DISTINCT FROM 'cancelled' THEN
        RAISE EXCEPTION 'Cancele o pedido antes de devolver o dinheiro.';
    END IF;

    -- Regra 24/08, lado do enviado: produto que SAIU so' gera devolucao
    -- depois de VOLTAR a mao do lojista. O FATO vem de returned_to_seller_at
    -- (gravado por confirmar_retorno_do_produto), nunca deduzido de status.
    IF v_cancelled_after_shipping AND v_returned_at IS NULL THEN
        RAISE EXCEPTION 'A devolução espera o produto: ele ainda não voltou para a loja.'
            USING ERRCODE = 'P0001';
    END IF;

    -- Saldo disponivel = total pago - ja confirmado (valor_estornado) -
    -- pendencias em andamento (solicitado/em_processamento). Linhas falhou/
    -- recusado NAO reservam saldo: sao pedidos mortos.
    SELECT COALESCE(SUM(amount), 0) INTO v_em_curso
      FROM public.order_refunds
     WHERE order_id = p_order_id
       AND status IN ('solicitado', 'em_processamento');

    v_saldo := v_total - v_valor_estornado - v_em_curso;

    IF p_amount IS NULL OR p_amount <= 0 THEN
        RAISE EXCEPTION 'O valor a devolver tem de ser maior que zero.';
    END IF;

    IF p_amount > v_saldo THEN
        RAISE EXCEPTION 'O valor pedido (%) é maior que o valor disponível para devolver (%).', p_amount, v_saldo
            USING ERRCODE = 'P0001';
    END IF;

    -- A linha nasce AQUI, pedida pela loja. status default 'solicitado':
    -- quem executa e' a edge do clique (Task 3) ou o cron (Task 4).
    INSERT INTO public.order_refunds (order_id, amount, motivo, solicitado_por)
    VALUES (p_order_id, p_amount, NULLIF(trim(COALESCE(p_motivo, '')), ''), 'lojista')
    RETURNING id INTO v_refund_id;

    RETURN jsonb_build_object('refund_id', v_refund_id, 'amount', p_amount);
END;
$$;

COMMENT ON FUNCTION public.solicitar_estorno(uuid, numeric, text) IS
  'O botao "Devolver dinheiro" do lojista (Task 6 chama; Tasks 3-4 executam). Guardas: so is_admin; pedido pago; pedido cancelado; se saiu, produto de volta (returned_to_seller_at); valor dentro do saldo (total pago - confirmado - em andamento). Devolve {refund_id, amount} e NAO move dinheiro nem soma valor_estornado — a linha e o pedido, a confirmacao e do MP.';

-- Padrao da casa (REVOKE nomeia anon/authenticated porque o REVOKE FROM
-- PUBLIC nao alcanc,a os default privileges do Supabase — medido na
-- 20260970000000): EXECUTE so' para authenticated.
REVOKE ALL ON FUNCTION public.solicitar_estorno(uuid, numeric, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.solicitar_estorno(uuid, numeric, text) TO authenticated;

-- ============================================================================
-- 5. update_order_status_atomic RECREADA INTEIRA: o cancelamento pago sem
--    envio grava o pedido de estorno NA MESMA TRANSACAO
-- ============================================================================
-- Corpo base: o VIVO de 20261060000000 (o estoque volta uma vez so') —
-- ver o cabecalho desta migration para o porquê de nao copiar da
-- 20260970000000. Mudas: (a) o SELECT do topo le' tambem payment_status,
-- paid_at e total; (b) o bloco do LEDGER logo apos o bloco
-- cancelled_after_shipping. Mais NADA.
--
-- DROP antes + GRANTs explicitos depois (regra da casa: recriacao de
-- funcao recasa os grants — nunca confiar no default).

DROP FUNCTION IF EXISTS public.update_order_status_atomic(uuid, text, text, boolean);

CREATE OR REPLACE FUNCTION public.update_order_status_atomic(
    p_order_id uuid,
    p_new_status text,
    p_notes text DEFAULT NULL,
    p_silent boolean DEFAULT FALSE
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_old_status TEXT;
    v_user_id UUID;
    v_caller_id UUID := auth.uid();
    v_is_admin BOOLEAN := public.is_admin();
    v_cancelled_after_shipping BOOLEAN;
    v_payment_status TEXT;
    v_paid_at TIMESTAMPTZ;
    v_total NUMERIC;
    v_item RECORD;
    v_result jsonb;
BEGIN
    -- Antes de qualquer leitura: sem sessão, nem existência de pedido se revela.
    IF v_caller_id IS NULL THEN
        RAISE EXCEPTION 'Não autorizado: é preciso estar autenticado para alterar um pedido.';
    END IF;

    -- Get current status and lock row
    SELECT status, user_id, cancelled_after_shipping, payment_status, paid_at, total
      INTO v_old_status, v_user_id, v_cancelled_after_shipping, v_payment_status, v_paid_at, v_total
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
    END IF;

    -- Grava o que o app hoje ESQUECE ao cancelar: se o produto ja tinha saido.
    -- Sem isto, depois do cancelamento nao ha como saber se o estorno espera a
    -- mercadoria voltar. Nao existe tabela de historico de status neste banco.
    -- (v_old_status = 'shipping' e p_new_status = 'cancelled' ja garantem que
    -- os dois sao distintos -- sem clausula extra sobre isso.)
    IF p_new_status = 'cancelled'
       AND v_old_status = 'shipping' THEN
        UPDATE public.marketplace_orders
           SET cancelled_after_shipping = true
         WHERE id = p_order_id;
    END IF;

    -- LEDGER DO ESTORNO (2026110000000, regra do Gabriel 24/08/2026):
    -- pedido PAGO cancelado SEM ter saido -> o pedido de devolucao NASCE
    -- AQUI, na MESMA transacao do cancelamento. E' isto que torna impossivel
    -- "cancelou e ninguem pediu o dinheiro de volta": ou as duas coisas
    -- acontecem juntas, ou nenhuma (ROLLBACK).
    --   v_old_status IN ('pending','processing'): pedido que NAO saiu.
    --     Shipping fica FORA — estorno manual do lojista, depois do retorno
    --     (solicitar_estorno e' a porta; a regra de 24/08 do lado do enviado).
    --   payment_status IN ('pago','pago_apos_expirar') AND paid_at IS NOT
    --     NULL: as DUAS condicoes (o plano exigiu as duas — dado legado pode
    --     ter payment_status='pago' sem paid_at, e esse nao gera linha).
    --   NOT EXISTS (... solicitado/em_processamento/concluido): o pedido
    --     pago-sem-envio ganha UMA linha de cancelamento na vida — cobre o
    --     ciclo reativar->cancelar de novo. Linhas falhou/recusado NAO
    --     bloqueiam: sao pedidos mortos, o retry e' legitimo.
    --   amount = v_total: o cancelamento devolve TUDO que foi pago (coluna
    --     total — o valor pelo qual o pedido fechou).
    --   solicitado_por: quem cancelou — lojista pelo painel, cliente no app.
    IF p_new_status = 'cancelled'
       AND v_old_status IN ('pending', 'processing')
       AND v_payment_status IN ('pago', 'pago_apos_expirar')
       AND v_paid_at IS NOT NULL
       AND NOT EXISTS (
            SELECT 1 FROM public.order_refunds
             WHERE order_id = p_order_id
               AND status IN ('solicitado', 'em_processamento', 'concluido'))
    THEN
        INSERT INTO public.order_refunds (order_id, amount, motivo, solicitado_por)
        VALUES (p_order_id, v_total, 'cancelamento antes do envio',
                CASE WHEN v_is_admin THEN 'lojista' ELSE 'cliente' END);
    END IF;

    -- STOCK RESTORATION LOGIC
    -- `v_old_status <> 'shipping'`: produto que ja saiu esta FISICAMENTE com o
    -- cliente. Devolver a prateleira aqui faria a loja vender uma peca que nao
    -- tem. O estoque desse caso volta em confirmar_retorno_do_produto.
    --
    -- `NOT v_cancelled_after_shipping` (laudo 0109, A8): pedido cancelado
    -- apos o envio que a loja REATIVA e re-cancela a partir de 'processing'
    -- e' o mesmo envio — a peca continua com o cliente, e creditar aqui era
    -- phantom. O credito desse pedido so existe em
    -- confirmar_retorno_do_produto (que agora carimba stock_returned_at, e
    -- por isso tambem so acontece uma vez).
    -- If transitioning to 'cancelled' from a non-cancelled status
    IF p_new_status = 'cancelled'
       AND v_old_status IS DISTINCT FROM 'cancelled'
       AND v_old_status IS DISTINCT FROM 'shipping'
       AND NOT v_cancelled_after_shipping THEN
        -- Mesmo laco de public.devolver_estoque(uuid) — reusa a funcao em vez
        -- de manter uma terceira copia do mesmo invariante (IF/ELSE variante
        -- XOR produto). Desde 20261060000000 a funcao e idempotente pelo fato
        -- (stock_returned_at): a oscilacao cancelled -> processing ->
        -- cancelled credita UMA vez, na primeira.
        PERFORM public.devolver_estoque(p_order_id);

        -- A vaga do cupom NAO volta aqui (Rodada 4): ela so' volta na
        -- varredura devolver_cupons_de_pedidos_mortos(), depois que o PIX
        -- ja nao pode mais ser pago (expires_at + 24h). Devolver no momento
        -- do cancelamento e' exatamente o que abriu a janela das Rodadas 2 e
        -- 3 -- ver o cabecalho da migration 20260901000000.
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

-- Grants re-casados (o DROP acima os derrubou): EXECUTE so' para
-- authenticated — o mesmo estado de antes da migration (conferido ao vivo:
-- postgres, authenticated, service_role).
REVOKE ALL ON FUNCTION public.update_order_status_atomic(uuid, text, text, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.update_order_status_atomic(uuid, text, text, boolean) TO authenticated;
