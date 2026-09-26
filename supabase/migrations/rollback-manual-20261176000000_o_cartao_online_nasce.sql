-- ============================================================================
-- Rollback manual — o cartão online nasce (20261176000000)
-- ============================================================================
-- Reverter PRIMEIRO as edges (criar-pagamento aceitando cartão, webhook e
-- reconciliação chamando liberar_cobranca_do_pedido) e o front (opção de
-- cartão no checkout, interruptores no painel); só depois executar este
-- arquivo. Com as edges novas no ar e este rollback aplicado, a recusa de
-- cartão cairia num RPC inexistente. psql -1 -f — nunca pelo db-apply.
--
-- Remove as RPCs, a tabela de configuração e as CHECKs das colunas novas.
-- As COLUNAS `tentativas_de_pagamento`, `metodo_online`, `parcelas` e
-- `estorno_manual_registrado_em` (achado F da revisão de 26/09/2026) FICAM:
-- guardam como cada pedido foi pago (mesma régua da rollback-manual-
-- 20261174000000, que não derruba a configuração que o lojista já salvou).
-- `IF EXISTS` em tudo: repetir não dá erro.
--
-- GUARDA DE ORDEM (achado R): reverta 78 -> 77 antes desta (76). O
-- Financeiro (fin__forma_do_pedido) e o CRM (crm__vendas) leem
-- marketplace_orders.metodo_online, que fica — mas registrar_estorno_manual
-- volta ao corpo de 20261072000000 aqui embaixo, e o Financeiro (77) datava
-- o estorno externo por estorno_manual_registrado_em: revertendo 76 antes
-- de 77, o próximo estorno manual não grava mais o carimbo e 77 cai de
-- volta para o updated_at (degradação silenciosa, não erro) — documentado,
-- não bloqueado, porque nada quebra com 42P01/42883.
-- ============================================================================

DO $$
BEGIN
  IF to_regprocedure('public.painel_inicio()') IS NOT NULL
     OR to_regprocedure('public.crm_visao(date, date)') IS NOT NULL THEN
    RAISE EXCEPTION 'reverta 78 (o_crm_e_o_inicio_leem_a_loja) antes de reverter esta migration (76).';
  END IF;
  IF to_regprocedure('public.fin_dre(date, date)') IS NOT NULL THEN
    RAISE EXCEPTION 'reverta 77 (o_financeiro_da_loja_nasce) antes de reverter esta migration (76).';
  END IF;
END
$$;

DROP FUNCTION IF EXISTS public.liberar_cobranca_do_pedido(uuid, text);
DROP FUNCTION IF EXISTS public.salvar_config_pagamento_cartao(boolean, boolean, integer);
DROP TABLE IF EXISTS public.config_pagamento_cartao;

ALTER TABLE public.marketplace_orders DROP CONSTRAINT IF EXISTS marketplace_orders_tentativas_de_pagamento_check;
ALTER TABLE public.marketplace_orders DROP CONSTRAINT IF EXISTS marketplace_orders_metodo_online_check;
ALTER TABLE public.marketplace_orders DROP CONSTRAINT IF EXISTS marketplace_orders_parcelas_check;

-- registrar_estorno_manual: corpo ORIGINAL de 20261072000000, VERBATIM (sem
-- o carimbo de estorno_manual_registrado_em que 20261176000000 acrescentou).
CREATE OR REPLACE FUNCTION public.registrar_estorno_manual(p_order_id uuid)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_existe boolean;
    v_ja_estornado boolean;
BEGIN
    IF NOT public.is_admin() THEN
        RAISE EXCEPTION 'somente a loja registra o estorno'
            USING ERRCODE = '42501';
    END IF;

    SELECT EXISTS (
        SELECT 1 FROM public.marketplace_orders WHERE id = p_order_id
    ),
    EXISTS (
        SELECT 1 FROM public.marketplace_orders
         WHERE id = p_order_id AND payment_status = 'estornado'
    )
    INTO v_existe, v_ja_estornado;

    IF NOT v_existe THEN
        RAISE EXCEPTION 'pedido nao encontrado' USING ERRCODE = 'P0002';
    END IF;

    IF NOT v_ja_estornado THEN
        UPDATE public.marketplace_orders
           SET payment_status = 'estornado'
         WHERE id = p_order_id;
    END IF;

    RETURN json_build_object('ok'::text, true, 'payment_status'::text, 'estornado');
END;
$$;
