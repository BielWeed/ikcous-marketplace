-- CANCELAR PEDIDO ANULA A COBRANÇA PRIMEIRO (dinheiro; 04/10/2026, achado S1 +
-- R11 + estoque do entregue) — o cancelamento de pedido ONLINE com cobrança
-- aberta no Mercado Pago deixa de ser só uma mudança no banco.
--
-- O DEFEITO (S1): as três telas que cancelam (o pedido do cliente, a retomada
-- do pagamento no checkout e a ficha do painel) chamavam
-- `update_order_status_atomic` direto. Ela só muda o BANCO: o PIX aberto (ou,
-- no painel, até o cartão vivo) continuava PAGÁVEL no Mercado Pago. Pago
-- depois do cancelamento, a 20260901/20261195 grava `pago_apos_expirar`
-- (Política P1, honrar) — dinheiro fora do fluxo, sem estorno automático, com
-- o estoque já devolvido e vendido a outro cliente.
--
-- O DESENHO (decidido no plano, não reaberto aqui):
--   1. Quem cancela pedido online com cobrança na vaga é a edge
--      `criar-pagamento` (ação `cancelar`): ela PRIMEIRO anula a order no MP
--      e SÓ com a resposta que prova "order cancelada" chama a RPC nova
--      `public.cancelar_pedido_com_cobranca` (service role), que cancela no
--      banco por CAS: a vaga (`gateway_payment_id`) e o `payment_status` que
--      a edge viu têm de ser os que ainda estão no pedido, sob FOR UPDATE.
--      Mudou → não cancela; devolve o pedido relido.
--   2. O BYPASS fecha: `update_order_status_atomic` (a porta do front) passa
--      a RECUSAR 'cancelled' para pedido `aguardando` com a vaga ocupada —
--      para cliente E admin. Sem vaga (pedido não online, ou online sem
--      cobrança) e pedido já pago seguem exatamente como antes. A recusa diz
--      "não pode ser cancelado" de propósito: é a frase que a fila offline do
--      painel (`erroDeSincronizacaoEhTerminal`, src/hooks/useOrders.ts) já
--      reconhece como terminal — um cancelamento enfileirado antes desta
--      migration é descartado com aviso, nunca reenviado para sempre.
--   3. R11 — o estorno automático do cancelamento de pedido PAGO devolve o
--      REMANESCENTE: total − já confirmado (`valor_estornado`) − em voo
--      (`order_refunds` solicitado/em_processamento) − reembolso manual de
--      devolução concluída. É a conta de `solicitar_estorno` (20261175, seção
--      10), agora numa função só (`pedido__saldo_a_estornar`). Antes: a
--      linha só nascia se NÃO existisse estorno nenhum, e então pelo total —
--      pago 100 com 30 já devolvidos não abria os 70 restantes.
--   4. Estoque: entregue → cancelado NÃO devolve estoque (a mercadoria não
--      voltou). Antes, `v_old_status <> 'shipping'` deixava o 'delivered'
--      passar e `devolver_estoque` creditava a peça que está com o cliente.
--      O cancelamento de entregue também CARIMBA `cancelled_after_shipping`
--      (o fato histórico "a mercadoria saiu", que nada apaga): sem isso,
--      reativar e cancelar de novo creditava o estoque e abria o estorno no
--      2º cancelamento. O estoque volta só pelo retorno físico explícito
--      (`confirmar_retorno_do_produto`, idempotente). Fora: a venda de
--      BALCÃO (`canal = 'presencial'`), que NASCE 'delivered' e cujo
--      cancelamento sempre devolveu o estoque (invariante provada em
--      tests/banco/invariantes-dinheiro.cjs (d)(j)) — mantida, sem carimbo.
--   5. `payment_status` NULL com a vaga ocupada é TRANSITÓRIO: a recusa do
--      item 2 vale também para ele (exige a prova da edge).
--   6. ADMIN ATUAL na porta do front: `update_order_status_atomic` deixa de
--      usar `is_admin()` (que aceita o `app_metadata` do JWT — admin
--      rebaixado com token velho seguia mudando pedido de OUTRO cliente,
--      com estorno e estoque) e passa a exigir o papel admin AGORA em
--      `auth.users` E `profiles` (contradição nega). A sessão de servidor
--      (role postgres/service_role) segue aceita, como em is_admin().
--
-- COMO A REGRA CONTINUA NUM LUGAR SÓ: o código de `update_order_status_atomic`
-- (o da 20261180000000, copiado verbatim com as mudanças acima) muda para
-- `public.pedido__mudar_status(...)`, que recebe QUEM age (`p_ator`, se é
-- admin, e se a chamada veio da edge que já anulou a cobrança).
-- `update_order_status_atomic` vira a casca que passa `auth.uid()`, o ADMIN
-- ATUAL (item 6 abaixo; antes: `is_admin()`, que confia no JWT) e
-- `p_pela_edge = false`. `cancelar_pedido_com_cobranca` passa
-- o ator que a edge autenticou e `p_pela_edge = true`. Nenhuma das duas copia
-- a regra de cancelamento (estoque, estorno, histórico).
--
-- ADMIN ATUAL (item 5 do plano): as duas portas não confiam no papel do JWT — leem o
-- papel de AGORA nas duas fontes que a `is_admin_atual()` da 20261197000000
-- (outra frente, ainda não aplicada) lê: `auth.users.raw_app_meta_data` E
-- `profiles.role`. Não depende dela; o TODO no corpo aponta a troca.
--
-- O QUE NÃO MUDA:
--   - assinatura, `SECURITY DEFINER`, `search_path` e ACL de
--     `update_order_status_atomic` (CREATE OR REPLACE preserva a ACL; nenhum
--     GRANT/REVOKE dela aqui);
--   - a guarda da 80 (cliente com cartão vivo) — mesma condição, mesmo texto,
--     só não vale quando a edge já PROVOU a cobrança anulada;
--   - cliente com pedido PAGO cancela pending/processing/shipping como antes
--     (o dinheiro segue pelo ledger do estorno, item 3);
--   - confirmar_pagamento, liberar_cobranca_do_pedido, expirar_pedidos_
--     vencidos, solicitar_estorno — nenhum é redefinido (a 20261197000000 de
--     outra frente redefine `solicitar_estorno`; redefini-la aqui faria os
--     dois preflights se recusarem um ao outro).
--
-- DADOS EXISTENTES: nenhuma linha é lida ou reescrita ao aplicar — troca o
-- corpo de uma função e cria três. Pedido cancelado ANTES desta migration com
-- PIX ainda aberto continua como está (a migration não anula nada no MP); o
-- que muda é só o próximo cancelamento.
--
-- ORDEM GLOBAL DE TRAVAS (decisão do integrador, 04/10/2026): toda função
-- que trava o pedido E linhas de estorno juntos trava PRIMEIRO as linhas de
-- `order_refunds` do pedido (`... WHERE order_id = p ORDER BY id FOR UPDATE`)
-- e DEPOIS o pedido (`marketplace_orders ... FOR UPDATE`) — a ordem de
-- concluir_estorno (2026110000100) e registrar_estorno_manual (89/94/97).
-- Aqui: `cancelar_pedido_com_cobranca` sempre, e `pedido__mudar_status`
-- quando o destino é 'cancelled' (o único que lê/escreve o ledger). Ordem
-- invertida contra essas duas = deadlock (40P01); a prova (j) de
-- tests/banco/cancelar-pedido-viva.cjs mede as duas ordens.
--
-- IDEMPOTÊNCIA: `CREATE OR REPLACE` em tudo; REVOKE/GRANT repetidos dão o
-- mesmo ACL. O preflight aceita o estado de antes E o que esta migration
-- deixa.
--
-- PRÉ-VOO / B1_BASELINE_DIVERGENT: `DO $preflight_20261198$`, ANTES de
-- qualquer CREATE, recusa se (a) faltar `valor_estornado`, `metodo_online`,
-- `order_refunds` ou `devolucoes`; (b) o corpo VIVO de
-- `update_order_status_atomic`, por `md5(replace(prosrc, E'\r', ''))`, não for
-- o da 20261180000000 (`ed2f7fd3e0177c027720049b2fe55d3b`) nem o que esta
-- migration deixa (`e2a821a1fb498740bc4356e3f22bf022`); (c) qualquer das três
-- funções novas já existir com um corpo que não é o desta migration. Os
-- hashes estão amarrados ao texto por
-- tests/migration_cancelar_pedido_anula_a_cobranca_test.ts. O DO roda na
-- MESMA transação do resto: recusa = nada gravado.
--
-- ORDEM DE APLICAÇÃO: depois da 20261180000000 (o corpo que esta copia) e
-- ANTES de publicar a edge `criar-pagamento` com a ação `cancelar` e o front
-- que a chama. Independente da 20261197000000. ATENÇÃO: com esta migration
-- no ar e o front ANTIGO, cancelar pedido online com cobrança na vaga passa a
-- ser recusado com a mensagem clara do item 2 (nenhum dinheiro em risco; o
-- cancelamento espera o front novo).
--
-- COMO APLICAR: workflow `aplicar-migrations.yml`, `migracoes =
-- 20261198000000_cancelar_pedido_anula_a_cobranca.sql` (prova `BEGIN;
-- <arquivo>; ROLLBACK;` antes do apply). Sem `BEGIN`/`COMMIT` de nível
-- superior neste arquivo (regra da casa).
--
-- FICHA DE VERIFICAÇÃO:
--   1. `md5(replace(prosrc, E'\r', ''))` de update_order_status_atomic =
--      e2a821a1fb498740bc4356e3f22bf022; as três funções novas existem.
--   2. Cliente dono de pedido 'pending'/'aguardando' com PIX na vaga:
--      `update_order_status_atomic(<id>, 'cancelled')` — RAISE "não pode ser
--      cancelado por aqui"; admin, a mesma recusa.
--   3. `has_function_privilege('authenticated',
--      'public.cancelar_pedido_com_cobranca(uuid,uuid,text,text,text)',
--      'EXECUTE')` = false; service_role = true.
--   4. Prova viva completa: tests/banco/cancelar-pedido-viva.cjs.
--
-- ROLLBACK MANUAL:
-- rollback-manual-20261198000000_cancelar_pedido_anula_a_cobranca.sql
-- restaura, byte a byte, o corpo da 20261180000000 e apaga as três funções
-- novas. Aplicar com `psql -1 -f`.

DO $preflight_20261198$
DECLARE
  v_hash text;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'marketplace_orders'
       AND column_name = 'valor_estornado'
  ) OR NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'marketplace_orders'
       AND column_name = 'metodo_online'
  ) OR to_regclass('public.order_refunds') IS NULL
    OR to_regclass('public.devolucoes') IS NULL THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: falta valor_estornado/metodo_online/order_refunds/devolucoes — aplique 2026110000000, 20261175000000 e 20261176000000 antes da 20261198000000.';
  END IF;

  SELECT md5(replace(prosrc, E'\r', '')) INTO v_hash
    FROM pg_proc
   WHERE oid = to_regprocedure('public.update_order_status_atomic(uuid,text,text,boolean)');
  IF v_hash IS NULL OR v_hash NOT IN (
    'ed2f7fd3e0177c027720049b2fe55d3b', -- corpo que a 20261180000000 deixa (vigente até aqui)
    'e2a821a1fb498740bc4356e3f22bf022'  -- corpo que ESTA migration deixa — reaplicação idempotente
  ) THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: corpo vivo de update_order_status_atomic (hash %) não é o da 20261180000000 nem o desta migration — capture o corpo vivo e revise antes de aplicar.', COALESCE(v_hash, 'ausente');
  END IF;

  SELECT md5(replace(prosrc, E'\r', '')) INTO v_hash
    FROM pg_proc
   WHERE oid = to_regprocedure('public.pedido__saldo_a_estornar(uuid)');
  IF v_hash IS NOT NULL AND v_hash <> 'ff8f3f2ecbd16982157b17fc8e4d3d20' THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: public.pedido__saldo_a_estornar já existe com outro corpo (hash %).', v_hash;
  END IF;

  SELECT md5(replace(prosrc, E'\r', '')) INTO v_hash
    FROM pg_proc
   WHERE oid = to_regprocedure('public.pedido__mudar_status(uuid,text,text,uuid,boolean,boolean)');
  IF v_hash IS NOT NULL AND v_hash <> '4623b27a07468553d6ac00a888e04db4' THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: public.pedido__mudar_status já existe com outro corpo (hash %).', v_hash;
  END IF;

  SELECT md5(replace(prosrc, E'\r', '')) INTO v_hash
    FROM pg_proc
   WHERE oid = to_regprocedure('public.cancelar_pedido_com_cobranca(uuid,uuid,text,text,text)');
  IF v_hash IS NOT NULL AND v_hash <> '794ea92e745cdafec5d87dcd2fb69fb7' THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: public.cancelar_pedido_com_cobranca já existe com outro corpo (hash %).', v_hash;
  END IF;
END $preflight_20261198$;

-- ---------------------------------------------------------------------------
-- 1. O saldo a estornar de um pedido — a conta de solicitar_estorno (20261175,
--    seção 10), num lugar só.
-- ---------------------------------------------------------------------------
-- total pago − já confirmado (valor_estornado) − em voo (order_refunds
-- solicitado/em_processamento) − reembolso manual de devolução concluída.
-- Linhas falhou/recusado NÃO reservam saldo (pedidos mortos, retry legítimo).
-- Pode dar zero ou negativo: quem chama decide (o cancelamento só abre linha
-- com saldo > 0). TODO(20261197000000 aplicada): redefinir solicitar_estorno
-- para chamar esta função em vez da cópia inline — não feito aqui porque a 97
-- (outra frente) redefine solicitar_estorno e os preflights se recusariam.
CREATE OR REPLACE FUNCTION public.pedido__saldo_a_estornar(p_order_id uuid)
RETURNS numeric
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT o.total
         - COALESCE(o.valor_estornado, 0)
         - COALESCE((SELECT sum(r.amount)
                       FROM public.order_refunds r
                      WHERE r.order_id = o.id
                        AND r.status IN ('solicitado', 'em_processamento')), 0)
         - COALESCE((SELECT sum(d.valor_reembolso)
                       FROM public.devolucoes d
                      WHERE d.order_id = o.id
                        AND d.status = 'concluida'
                        AND d.reembolso_manual), 0)
    FROM public.marketplace_orders o
   WHERE o.id = p_order_id;
$$;

REVOKE ALL ON FUNCTION public.pedido__saldo_a_estornar(uuid) FROM PUBLIC, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 2. A regra de mudar o status do pedido, com QUEM age explícito. CÓDIGO da
--    20261180000000 copiado verbatim (comentários resumidos), com as mudanças
--    marcadas "20261198": o ator por parâmetro, `p_pela_edge` na guarda da 80,
--    a recusa do bypass, o saldo remanescente (R11) e o 'delivered' fora do
--    estoque. A prova de que é SÓ isso: tests/migration_cancelar_pedido_
--    anula_a_cobranca_test.ts.
-- ---------------------------------------------------------------------------
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
           metodo_online, gateway_payment_id, canal
      INTO v_old_status, v_user_id, v_cancelled_after_shipping, v_payment_status, v_paid_at, v_total,
           v_metodo_online, v_gateway_payment_id, v_canal
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
            v_old_status = 'shipping'
            OR (v_old_status = 'delivered' AND v_canal IS DISTINCT FROM 'presencial')
       ) THEN
        UPDATE public.marketplace_orders
           SET cancelled_after_shipping = true
         WHERE id = p_order_id;
    END IF;

    -- LEDGER DO ESTORNO (2026110000000, regra do Gabriel 24/08/2026):
    -- pedido PAGO cancelado SEM ter saido -> o pedido de devolucao NASCE
    -- AQUI, na MESMA transacao do cancelamento. Ou as duas coisas acontecem
    -- juntas, ou nenhuma (ROLLBACK). Shipping fica FORA (estorno manual do
    -- lojista depois do retorno); NOT v_cancelled_after_shipping (laudo C2
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
       AND v_old_status IN ('pending', 'processing')
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
    -- `v_old_status <> 'shipping'`: produto que ja saiu esta FISICAMENTE com o
    -- cliente. Devolver a prateleira aqui faria a loja vender uma peca que nao
    -- tem. O estoque desse caso volta em confirmar_retorno_do_produto.
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
       AND v_old_status IS DISTINCT FROM 'shipping'
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

REVOKE ALL ON FUNCTION public.pedido__mudar_status(uuid, text, text, uuid, boolean, boolean) FROM PUBLIC, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 3. update_order_status_atomic vira a casca do front: mesma assinatura, mesmo
--    SECURITY DEFINER/search_path, ACL herdada (sem GRANT/REVOKE aqui).
-- ---------------------------------------------------------------------------
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
    v_ator UUID := auth.uid();
    v_admin_atual BOOLEAN;
BEGIN
    -- 20261198000000: a regra inteira (inclusive a guarda do cartão vivo da
    -- 20261180000000 — `verificando:` — e a recusa do cancelamento com
    -- cobrança na vaga) mora em public.pedido__mudar_status. Esta porta é a
    -- do front: o ator é a sessão (auth.uid()) e nunca é a edge
    -- (`p_pela_edge` false).
    --
    -- ADMIN ATUAL, não o do JWT: `public.is_admin()` aceita o `app_metadata`
    -- do token — um admin rebaixado com o JWT de antes (válido até expirar)
    -- seguiria cancelando pedido pago/offline de OUTRO cliente (com estorno e
    -- devolução de estoque). Aqui o papel `admin` tem de estar AGORA nas duas
    -- fontes: `auth.users.raw_app_meta_data` E `profiles.role`; contradição
    -- = não é admin (o dono continua pelo caminho dele: `user_id`). A sessão
    -- de servidor (role postgres/service_role) segue como em is_admin().
    -- TODO(20261197000000): trocar estas leituras pela is_admin_atual()
    -- quando ela estiver no ar em todas as lojas — a mesma regra.
    v_admin_atual :=
        COALESCE(current_setting('role', true), '') IN ('postgres', 'service_role')
        OR (
            EXISTS (
                SELECT 1 FROM auth.users u
                 WHERE u.id = v_ator
                   AND (u.raw_app_meta_data ->> 'role') = 'admin'
            )
            AND EXISTS (
                SELECT 1 FROM public.profiles p
                 WHERE p.id = v_ator
                   AND p.role = 'admin'
            )
        );
    RETURN public.pedido__mudar_status(
        p_order_id, p_new_status, p_notes, v_ator, v_admin_atual, false
    );
END;
$$;

-- ---------------------------------------------------------------------------
-- 4. O cancelamento que a edge faz DEPOIS de anular a cobrança no MP.
-- ---------------------------------------------------------------------------
-- Só service role (a edge `criar-pagamento`, ação `cancelar`). `p_ator` é o
-- usuário que a edge autenticou; a posse/papel é conferida DE NOVO aqui, sob
-- o lock. CAS: `p_vaga_esperada` e `p_pagamento_esperado` são o que a edge
-- leu ANTES de decidir (e, com cobrança, o id que ela anulou). Se o pedido
-- não tem mais exatamente isso — o webhook confirmou o pagamento, liberou a
-- vaga, outra aba gravou outra cobrança — NÃO cancela e devolve o pedido
-- relido. Respostas (jsonb):
--   {cancelado: true,  ja_estava: false, pedido}  cancelou agora
--   {cancelado: true,  ja_estava: true,  pedido}  já estava cancelado
--   {cancelado: false, motivo: 'cobranca_mudou',     pedido}
--   {cancelado: false, motivo: 'cobranca_em_criacao', pedido}  sentinela de
--      cartão com menos de 2 min: o POST do cartão pode estar no ar (o teto
--      dele é 15 s, TEMPO_LIMITE_MS); cancelar agora deixaria a order recém-
--      criada sem dono. Depois disso, o admin decide com o aviso da edge.
-- Recusas (RAISE): chamador não é service role (42501); pedido inexistente;
-- ator nem dono nem admin atual; cliente com sentinela (só o admin passa).
CREATE OR REPLACE FUNCTION public.cancelar_pedido_com_cobranca(
    p_order_id uuid,
    p_ator uuid,
    p_vaga_esperada text,
    p_pagamento_esperado text,
    p_notes text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_pedido RECORD;
    v_ator_admin BOOLEAN;
    v_result jsonb;
BEGIN
    -- Mesma detecção de automação de confiança de public.is_admin().
    IF COALESCE(current_setting('role', true), '') NOT IN ('postgres', 'service_role') THEN
        RAISE EXCEPTION 'Não autorizado: o cancelamento com cobrança só acontece pelo servidor.'
            USING ERRCODE = '42501';
    END IF;

    IF p_ator IS NULL THEN
        RAISE EXCEPTION 'Não autorizado: é preciso estar autenticado para alterar um pedido.';
    END IF;

    -- ORDEM GLOBAL DE TRAVAS: as linhas de order_refunds do pedido ANTES do
    -- pedido (pedido__mudar_status, chamada lá embaixo, repete a trava das
    -- linhas — já são desta transação, não espera).
    PERFORM 1
       FROM public.order_refunds r
      WHERE r.order_id = p_order_id
      ORDER BY r.id
        FOR UPDATE;

    SELECT id, status, user_id, payment_status, gateway_payment_id, updated_at
      INTO v_pedido
      FROM public.marketplace_orders
     WHERE id = p_order_id
       FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Pedido não encontrado.';
    END IF;

    -- TODO(20261197000000): trocar por public.is_admin_atual() quando ela
    -- aceitar o ator por parâmetro (hoje ela lê auth.uid(), que aqui é a
    -- chave de serviço). Mesmas duas fontes que ela lê, nunca o JWT.
    v_ator_admin := EXISTS (
            SELECT 1 FROM auth.users u
             WHERE u.id = p_ator
               AND (u.raw_app_meta_data ->> 'role') = 'admin'
        )
        AND EXISTS (
            SELECT 1 FROM public.profiles p
             WHERE p.id = p_ator
               AND p.role = 'admin'
        );

    IF v_pedido.user_id IS DISTINCT FROM p_ator AND NOT v_ator_admin THEN
        RAISE EXCEPTION 'Não autorizado: Você não tem permissão para alterar este pedido.';
    END IF;

    IF v_pedido.status = 'cancelled' THEN
        RETURN jsonb_build_object(
            'cancelado', true, 'ja_estava', true,
            'pedido', (SELECT to_jsonb(o) FROM public.marketplace_orders o WHERE o.id = p_order_id));
    END IF;

    -- Cliente nunca cancela sobre o sentinela: não há como provar que a
    -- cobrança ambígua morreu (plano, item 1). A edge já recusa antes; isto
    -- é a mesma regra sob o lock.
    IF NOT v_ator_admin AND p_vaga_esperada LIKE 'verificando:%' THEN
        RAISE EXCEPTION 'Este pedido tem uma cobrança no cartão em confirmação com o banco. Aguarde a confirmação ou fale com a loja antes de cancelar.';
    END IF;

    IF v_pedido.gateway_payment_id IS DISTINCT FROM p_vaga_esperada
       OR v_pedido.payment_status IS DISTINCT FROM p_pagamento_esperado THEN
        RETURN jsonb_build_object(
            'cancelado', false, 'motivo', 'cobranca_mudou',
            'pedido', (SELECT to_jsonb(o) FROM public.marketplace_orders o WHERE o.id = p_order_id));
    END IF;

    IF p_vaga_esperada LIKE 'verificando:%'
       AND v_pedido.updated_at > now() - interval '2 minutes' THEN
        RETURN jsonb_build_object(
            'cancelado', false, 'motivo', 'cobranca_em_criacao',
            'pedido', (SELECT to_jsonb(o) FROM public.marketplace_orders o WHERE o.id = p_order_id));
    END IF;

    v_result := public.pedido__mudar_status(
        p_order_id, 'cancelled', p_notes, p_ator, v_ator_admin, true
    );

    RETURN jsonb_build_object('cancelado', true, 'ja_estava', false, 'pedido', v_result);
END;
$$;

REVOKE ALL ON FUNCTION public.cancelar_pedido_com_cobranca(uuid, uuid, text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cancelar_pedido_com_cobranca(uuid, uuid, text, text, text) TO service_role;
