-- ============================================================================
-- Rollback manual — a devolução nasce no pedido (20261175000000)
-- ============================================================================
-- Reverter PRIMEIRO o front (botão "Solicitar devolução" do pedido, tela
-- admin-devolucoes, card no pedido do painel, seção de política nos Ajustes)
-- e a ação `gerar_devolucao_reversa` da edge melhor-envio-etiqueta; só depois
-- executar este arquivo. Executar sob transação externa (psql -1 -f) — nunca
-- pelo db-apply (registraria o rollback no ledger de migrations).
--
-- Remove, na ordem inversa, só o que a migration criou: o gatilho de aviso, as
-- RPCs, os ajudantes internos, as policies do bucket e as quatro tabelas.
-- `IF EXISTS` em tudo: repetir este rollback não dá erro.
--
-- DADOS: APAGA as devoluções registradas, os itens, a trilha e a política
-- configurada pelo lojista. As linhas de estorno que uma devolução concluída
-- abriu em `order_refunds` FICAM (são dinheiro — o ledger não se apaga). O
-- bucket `devolucoes` e os arquivos dele FICAM (apagar foto de cliente é
-- decisão do dono, fora de rollback de schema).
--
-- GUARDA DE ORDEM (achado R): reverta 78 -> 77 -> 76 antes desta (75). O
-- Financeiro (fin__movimentos/fin_dre) e o CRM/Início (crm_visao,
-- painel_inicio) leem a tabela `devolucoes` direto — revertendo esta
-- migration primeiro, as duas quebram com 42P01 (relation does not exist).
-- ============================================================================

DO $$
BEGIN
  IF to_regprocedure('public.painel_inicio()') IS NOT NULL
     OR to_regprocedure('public.crm_visao(date, date)') IS NOT NULL THEN
    RAISE EXCEPTION 'reverta 78 (o_crm_e_o_inicio_leem_a_loja) antes de reverter esta migration (75).';
  END IF;
  IF to_regprocedure('public.fin_dre(date, date)') IS NOT NULL THEN
    RAISE EXCEPTION 'reverta 77 (o_financeiro_da_loja_nasce) antes de reverter esta migration (75).';
  END IF;
  IF to_regclass('public.config_pagamento_cartao') IS NOT NULL THEN
    RAISE EXCEPTION 'reverta 76 (o_cartao_online_nasce) antes de reverter esta migration (75).';
  END IF;
END
$$;

-- devolver_estoque: corpo ORIGINAL de 20261060000000, VERBATIM — 75
-- redefiniu a função (achado C) para descontar o que devolucao_itens já
-- reestocou; restaurado ANTES de apagar as tabelas de devolução, para a
-- função nunca ficar, nem por um instante, apontando para uma tabela que
-- este mesmo arquivo vai derrubar.
CREATE OR REPLACE FUNCTION public.devolver_estoque(p_order_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $devolver$
DECLARE
    v_item     RECORD;
    v_unidades integer := 0;
    v_ganhou   boolean;
BEGIN
    -- Reclama o carimbo ANTES de creditar. Quem perder a corrida (ou quem
    -- chegar de novo — a oscilação de status, o reenvio do webhook, o duplo
    -- clique do lojista) recebe 0 sem tocar na prateleira. Dentro da mesma
    -- transação do chamador: se o chamador abortar depois, o carimbo volta
    -- junto (ROLLBACK), e a próxima tentativa honesta ainda credita.
    UPDATE public.marketplace_orders
       SET stock_returned_at = now()
     WHERE id = p_order_id
       AND stock_returned_at IS NULL
    RETURNING true INTO v_ganhou;

    IF v_ganhou IS NOT TRUE THEN
        RETURN 0;
    END IF;

    FOR v_item IN
        SELECT product_id, variant_id, quantity
        FROM public.marketplace_order_items
        WHERE order_id = p_order_id
    LOOP
        -- IF/ELSE, não dois IF: a v23 debita XOR (variante OU produto, nunca os
        -- dois), e o front manda product_id preenchido junto com variant_id. Com
        -- dois IF, todo pedido de variante que expirasse creditaria o produto pai
        -- também, inflando o catalogo para sempre. Mesma forma do restore que ja
        -- existe em update_order_status_atomic.
        IF v_item.variant_id IS NOT NULL THEN
            UPDATE public.product_variants
               SET stock_increment = stock_increment + v_item.quantity
             WHERE id = v_item.variant_id;
        ELSE
            UPDATE public.produtos
               SET estoque = estoque + v_item.quantity
             WHERE id = v_item.product_id;
        END IF;

        v_unidades := v_unidades + v_item.quantity;
    END LOOP;

    RETURN v_unidades;
END;
$devolver$;

COMMENT ON FUNCTION public.devolver_estoque(uuid) IS
  'Idempotente desde 20261060000000 (laudo 0109, A8): credita o estoque do '
  'pedido NO MAXIMO uma vez na vida dele, guardado pela coluna-fato '
  'stock_returned_at (o estoque foi debitado uma vez so, na criacao — '
  'segundo credito e peça fantasma). Devolve 0 sem tocar na prateleira '
  'quando o carimbo ja existe. Antes desta migration o contrato era "nao e '
  'idempotente, o chamador garante chamada unica" (20260807000000) — a '
  'unica porta que nao garantia era a oscilacao cancelled -> processing -> '
  'cancelled, alcancavel inclusive por PostgREST direto de admin '
  '(baseline:5585). REVOKE de EXECUTE mantido (sao os donos das RPCs quem '
  'chamam).';

DROP TRIGGER IF EXISTS tr_devolucao_avisa_o_cliente ON public.devolucoes;
DROP FUNCTION IF EXISTS public.devolucao_avisa_o_cliente();

DROP FUNCTION IF EXISTS public.salvar_politica_de_devolucao(jsonb);
DROP FUNCTION IF EXISTS public.admin_devolucao_reprovar(uuid, text);
DROP FUNCTION IF EXISTS public.admin_devolucao_reemitir_reembolso(uuid, boolean);
DROP FUNCTION IF EXISTS public.admin_devolucao_concluir(uuid, text, jsonb, numeric, text);
DROP FUNCTION IF EXISTS public.admin_devolucao_registrar(uuid, text, text, text);
DROP FUNCTION IF EXISTS public.admin_devolucao_decidir(uuid, boolean, text, timestamptz);
DROP FUNCTION IF EXISTS public.admin_devolucoes_listar(text, text, integer, integer);
DROP FUNCTION IF EXISTS public.devolucao_detalhe(uuid);
DROP FUNCTION IF EXISTS public.devolucoes_do_pedido(uuid);
DROP FUNCTION IF EXISTS public.informar_envio_devolucao(uuid, text);
DROP FUNCTION IF EXISTS public.cancelar_devolucao(uuid);
DROP FUNCTION IF EXISTS public.solicitar_devolucao(uuid, jsonb, text, text, text, text, text[]);
DROP FUNCTION IF EXISTS public.devolucao_elegibilidade(uuid);

DROP FUNCTION IF EXISTS public.devolucao__registrar_evento(uuid, text, text, text, text);
DROP FUNCTION IF EXISTS public.devolucao__metodos(text, text, boolean, text[], text[]);
DROP FUNCTION IF EXISTS public.devolucao__modalidade(text, text);
DROP FUNCTION IF EXISTS public.devolucao__entregue_em(uuid);
DROP FUNCTION IF EXISTS public.devolucao__hoje();

DROP POLICY IF EXISTS devolucoes_cliente_insert_policy ON storage.objects;
DROP POLICY IF EXISTS devolucoes_dono_ou_admin_select_policy ON storage.objects;

DROP TABLE IF EXISTS public.devolucao_eventos;
DROP TABLE IF EXISTS public.devolucao_itens;
DROP TABLE IF EXISTS public.devolucoes;
DROP TABLE IF EXISTS public.politica_devolucao;
