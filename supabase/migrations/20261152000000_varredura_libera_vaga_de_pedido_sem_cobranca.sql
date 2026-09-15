-- PEÇA 12 (Fase 2, D-janela) — a vaga do cupom do pedido NUNCA-COBRO
-- libera na mesma sessão de compra, não no dia seguinte.
--
-- O DEFEITO (GAP 1, sub-caso): cliente cria pedido PIX (v24) e desiste
-- ANTES de gerar o QR — gateway_payment_id fica NULL para sempre. Se ele
-- cancela, a vaga do cupom fica presa por ~24,5h (expires_at + 24h + ciclo
-- do cron) por uma cobrança que NINGUÉM pode pagar de jeito nenhum:
-- podeCobrar recusa criar cobrança para pedido fora do prazo. O cupom de
-- uso único fica inutilizável por um dia inteiro por um desista (#210).
--
-- O CONCERTO: UMA cláusula a mais no WHERE de devolver_cupons_de_pedidos_mortos().
-- O corpo é o da 20260970000000 CARACTERE A CARACTERE (as sete cláusulas
-- vivas, o FOR UPDATE SKIP LOCKED, o laço e o fato gravado), com o parêntese
-- do prazo ampliado EXATAMENTE por:
--
--   OR (gateway_payment_id IS NULL AND expires_at < now() - interval '15 minutes')
--
-- Pedido cancelado, sem cobrança registrada e com o prazo vencido HÁ MAIS
-- DE 15 MINUTOS libera a vaga no próximo ciclo do cron (*/15): na prática,
-- ≤60 min em vez de ~24,5h.
--
-- PROVA DE SEGURANÇA (B1 do crítico da peça 12 — por que NÃO reabre o duplo
-- uso que matou as Rodadas 1-3):
--
-- 1. A cláusula só dispara com expires_at NO PASSADO há ≥15 min. A única
--    porta que gera cobrança nova, podeCobrar (criar-pagamento), recusa
--    pedido fora do prazo — cobrança nova para este pedido é impossível
--    DEPOIS dele. E a mesma peça 12 lacrou a porta no outro lado: podeCobrar
--    recusa pedido com status fora de 'pending', e o UPDATE que grava
--    gateway_payment_id ganhou `.eq("status","pending")` na guarda.
-- 2. A CARÊNCIA DE 15 MINUTOS é o que fecha a CORRIDA varredura ×
--    criar-pagamento: a edge decide CRIAR numa LEITURA do pedido e grava
--    gateway_payment_id SEGUNDOS depois de criar a cobrança no MP — uma
--    gravação EM VOO (leitura antes do prazo, gravação depois dele) aterrissa
--    DENTRO da carência, o pedido volta ao ramo das 24h (gateway NOT NULL) e
--    a varredura nunca o alcança no ramo novo. Latência de rede de minutos
--    não cruza uma carência de quinze; a casa já usa margem de 5 min para a
--    latência do MP (MARGEM_LATENCIA_MINUTOS_PIX).
-- 3. gateway_payment_id NUNCA volta a NULL: o único escritor grava uma vez,
--    com guarda `IS NULL` — NULL significa "NUNCA gravou". Os dois jeitos de
--    "parece nunca-cobrado mas não é" são a gravação em voo (item 2) e o
--    QR órfão por crash da edge (abaixo).
-- 4. Pedido COM cobrança (gateway_payment_id NOT NULL) NÃO é afetado: segue
--    o ramo das 24h, como sempre. O caso "cancelou com o QR na mão" continua
--    impossível de duplicar — e continua na recompra imediata recusado COM
--    EXPLICAÇÃO (migration 20261151000000); o resto dele é a peça 12-b (cron
--    cancela a cobrança no MP).
-- 5. A 7ª cláusula (cancelled_after_shipping = false OR
--    returned_to_seller_at IS NOT NULL) continua valendo para TODOS os
--    ramos, inclusive o novo — cancelado-após-envio segue preso até o
--    lojista confirmar o retorno do produto.
-- 6. ENVELOPE RESIDUAL HONESTO: cobrança criada no MP ANTES do prazo cuja
--    gravação morreu no meio (edge caiu entre criar e gravar) = QR órfão —
--    impagável na prática (o cliente não tem o QR) e, se um webhook tardio
--    o aprovar, confirmar_pagamento grava 'pago_apos_expirar'. É EXATAMENTE
--    o envelope de risco que o ESTOQUE já aceita desde a 20260807000000
--    (expirar_pedidos_vencidos devolve estoque no expires_at, cron */5). A
--    cláusula não cria classe de risco nova; estende um envelope aceito ao
--    cupom, SÓ para pedido sem cobrança registrada e SÓ depois do prazo +
--    carência.
--
-- OS TRÊS NÚMEROS (lição #53 — regra escrita em dois lugares diverge): as
-- 24 HORAS da mensagem da 20261151000000, as 24 HORAS do ramo antigo desta
-- varredura e a CARÊNCIA de 15 MINUTOS do ramo novo estão cravados JUNTOS no
-- teste tests/migration_cupom_mensagem_de_vaga_presa_test.ts. Mudar um sem
-- os outros reprova.
--
-- Sem BEGIN/COMMIT (regra da casa). NADA DESTRUTIVO: CREATE OR REPLACE +
-- REVOKE (idempotente) + COMMENT.
--
-- GRANTS: mesmo estado da Rodada 4 — a varredura é chamada SÓ pelo pg_cron
-- (dono do banco); anon e authenticated não têm EXECUTE (REVOKE ALL,
-- 20260901000000 l.677-678).
--
-- ROLLBACK: o corpo anterior está EMBUTIDO no arquivo
-- rollback-manual-20261152000000_varredura_libera_vaga_de_pedido_sem_cobranca.sql.
-- RE-APLICAR A 20260970000000 INTEIRA NÃO É CAMINHO: ela também recria
-- update_order_status_atomic e confirmar_retorno_do_produto de uma era
-- anterior à 2026110000000 (o estorno no ledger).
--
-- FICHA DE VERIFICAÇÃO pos-aplicação (rodar contra o banco; nao rodada por
-- este agente):
--
--   -- 1. O corpo vivo tem a cláusula nova E as sete cláusulas antigas:
--   SELECT (pg_get_functiondef('public.devolver_cupons_de_pedidos_mortos()'::regprocedure)
--           LIKE '%gateway_payment_id IS NULL AND expires_at < now() - interval ''15 minutes''%') AS tem_carencia,
--          (pg_get_functiondef('public.devolver_cupons_de_pedidos_mortos()'::regprocedure)
--           LIKE '%AND (expires_at IS NULL OR expires_at < now() - interval ''24 hours''%') AS tem_24h,
--          (pg_get_functiondef('public.devolver_cupons_de_pedidos_mortos()'::regprocedure)
--           LIKE '%cancelled_after_shipping = false OR returned_to_seller_at IS NOT NULL%') AS tem_setima,
--          (pg_get_functiondef('public.devolver_cupons_de_pedidos_mortos()'::regprocedure)
--           LIKE '%FOR UPDATE SKIP LOCKED%') AS tem_skip_locked;
--   -- esperado: 1 linha com as quatro colunas = true.
--
--   -- 2. Privilégio: só o dono do banco chama (pg_cron); papéis web sem
--   --    EXECUTE:
--   SELECT has_function_privilege('anon',
--          'public.devolver_cupons_de_pedidos_mortos()', 'EXECUTE') AS anon_tem,
--          has_function_privilege('authenticated',
--          'public.devolver_cupons_de_pedidos_mortos()', 'EXECUTE') AS auth_tem;
--   -- esperado: 1 linha com as duas colunas = false.
--
--   -- 3. A prova transacional completa (nunca-cobrado vencido devolve;
--   --    dentro da carência não; futuro não; cobrança existente segue nas
--   --    24h; corrida B1; piso em zero; varredura 2×; 7ª cláusula) é o
--   --    scripts/db-prove-devolucao-de-uso-de-cupom.cjs estendido, contra
--   --    banco de DESENVOLVIMENTO, pelo fluxo da casa.

CREATE OR REPLACE FUNCTION public.devolver_cupons_de_pedidos_mortos()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $devolver_cupons_mortos$
DECLARE
    v_pedido     RECORD;
    v_devolvidos integer := 0;
BEGIN
    -- FOR UPDATE SKIP LOCKED: mesma protecao de expirar_pedidos_vencidos --
    -- se dois ciclos deste cron se sobrepuserem, ou se confirmar_pagamento
    -- estiver processando o MESMO pedido neste instante (por exemplo, um
    -- pagamento tardio que acabou de chegar), quem perder a corrida pela
    -- linha pula e tenta de novo no proximo ciclo -- nunca decrementa duas
    -- vezes, nunca decrementa um pedido que acabou de ser pago.
    --
    -- coupon_id IS NOT NULL: so' pedido com cupom entra na varredura.
    --
    -- status = 'cancelled' AND payment_status IS DISTINCT FROM 'pago' AND
    -- payment_status IS DISTINCT FROM 'pago_apos_expirar': exatamente o
    -- conjunto dos quatro pontos de desfazimento que ANTES desta migration
    -- devolviam (ou reconsumiam) o uso do cupom -- ver o cabecalho desta
    -- migration para a prova de que este WHERE reproduz aquele conjunto sem
    -- deduzir nada alem do que confirmar_pagamento ja registra.
    --
    -- coupon_usage_returned = FALSE: o FATO registrado, nunca deduzido --
    -- e' isto que torna a operacao idempotente por construcao. Pedido
    -- pre-existente (criado antes desta migration) nasce FALSE pelo
    -- DEFAULT da coluna, e entra na varredura normalmente -- correto,
    -- porque nenhuma versao anterior desta migration jamais rodou em
    -- producao.
    --
    -- expires_at IS NULL OR expires_at < now() - interval '24 hours': o
    -- numero da casa (pagamentos_a_reconciliar, 20260808000100), a decisao
    -- do Gabriel de que "a vaga fica reservada enquanto o PIX estiver
    -- aberto". expires_at IS NULL NAO e' so residuo historico -- e' o
    -- caminho CORRENTE de todo pedido "na entrega" criado por
    -- create_marketplace_order_v23 (a via PADRAO do app, useOrders.ts:
    -- 1059-1061; a v24 so' entra com pagamento online): v23 nunca grava
    -- expires_at nem payment_status, entao NULL aqui significa "nunca
    -- houve PIX por este caminho" -- sem janela nenhuma para proteger.
    --
    -- cancelled_after_shipping = false OR returned_to_seller_at IS NOT
    -- NULL: acrescentada por 20260970000000 -- pedido cancelado-apos-envio
    -- so' entra quando o lojista ja registrou o retorno
    -- (confirmar_retorno_do_produto). Continua valendo para TODOS os
    -- ramos do WHERE, inclusive o novo.
    --
    -- PECA 12: o parêntese do prazo ganhou o ramo do pedido nunca-cobrado
    -- (gateway_payment_id IS NULL, prazo vencido ha mais de 15 minutos) --
    -- ver a PROVA DE SEGURANÇA (B1) no cabecalho deste arquivo. Sem vaga
    -- presa nenhuma muda de dono: a clausula so' alcanca pedido cancelado
    -- cuja cobranca NUNCA chegou a ser gravada.
    FOR v_pedido IN
        SELECT id
        FROM public.marketplace_orders
        WHERE coupon_id IS NOT NULL
          AND status = 'cancelled'
          AND payment_status IS DISTINCT FROM 'pago'
          AND payment_status IS DISTINCT FROM 'pago_apos_expirar'
          AND coupon_usage_returned = FALSE
          AND (expires_at IS NULL OR expires_at < now() - interval '24 hours'
               OR (gateway_payment_id IS NULL AND expires_at < now() - interval '15 minutes'))
          AND (cancelled_after_shipping = false OR returned_to_seller_at IS NOT NULL)
        FOR UPDATE SKIP LOCKED
    LOOP
        PERFORM public.devolver_uso_cupom(v_pedido.id);

        UPDATE public.marketplace_orders
           SET coupon_usage_returned = TRUE
         WHERE id = v_pedido.id;

        v_devolvidos := v_devolvidos + 1;
    END LOOP;

    RETURN v_devolvidos;
END;
$devolver_cupons_mortos$;

REVOKE ALL ON FUNCTION public.devolver_cupons_de_pedidos_mortos()
  FROM PUBLIC, anon, authenticated;

COMMENT ON FUNCTION public.devolver_cupons_de_pedidos_mortos() IS
  'Unico lugar onde a vaga de um cupom volta depois que um pedido que o '
  'usou e desfeito. So age sobre pedido definitivamente morto: PIX que ja '
  'nao pode mais ser pago (expires_at + 24h, o criterio de '
  'pagamentos_a_reconciliar) ou pedido nunca-cobrado com o prazo vencido '
  'ha mais de 15 minutos (peca 12; a carencia fecha a corrida com a '
  'criar-pagamento) -- e nunca deduz "ja devolvido" do estado: le e grava '
  'o fato na coluna coupon_usage_returned. Agendada via pg_cron a cada 15 '
  'minutos.';
