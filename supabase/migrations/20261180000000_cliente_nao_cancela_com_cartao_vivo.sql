-- O CLIENTE NÃO CANCELA COM CARTÃO VIVO (achado independente de risco,
-- dinheiro; 26/09/2026) — redefine `update_order_status_atomic` para recusar
-- o cancelamento PELO CLIENTE quando o pedido ainda tem uma cobrança de
-- cartão que pode ser aprovada pelo banco a qualquer momento.
--
-- O DEFEITO MEDIDO: o botão "Cancelar Pedido" (OrderDetailsView.tsx:1327)
-- aparece para todo pedido 'pending'/'processing'/'shipping' com sessão
-- (regra do Gabriel, 24/08/2026 — o divisor é se o produto SAIU, não se foi
-- pago), com o texto de confirmação "não pago" enquanto `payment_status`
-- segue 'aguardando'. Essa é a MESMA descrição que vale para um PIX nunca
-- pago — mas também vale para um pedido de CARTÃO em análise: a caixa âmbar
-- do checkout ("cartão em análise"/502 ambíguo da Orders API) guarda a flag
-- "esta cobrança pode estar viva" só no `useState` da tela de pagamento do
-- checkout. Sair para "Meus pedidos", ou só recarregar, perde a flag — nada
-- no banco lembrava que aquele pedido tinha uma cobrança em jogo.
-- CENÁRIO: cliente cai na caixa âmbar → vai para "Meus pedidos" → o pedido
-- está 'pending', o botão aparece, o texto diz "não pago" → cliente cancela
-- → `update_order_status_atomic` devolve o estoque → minutos depois o banco
-- aprova a cobrança → o webhook grava `payment_status = 'pago_apos_expirar'`
-- (Política P1, HONRAR) → dinheiro fora do fluxo, mercadoria já vendida a
-- outro cliente.
--
-- O QUE ESTA MIGRATION FAZ: redefine `public.update_order_status_atomic`
-- (CORPO ATUAL vindo de `20261175000000_a_devolucao_nasce_no_pedido.sql`,
-- Seção 11 — copiado VERBATIM) e acrescenta UMA guarda nova, só dentro do
-- ramo `IF NOT v_is_admin`, logo depois da checagem de status que já
-- existia: quando o pedido segue `payment_status = 'aguardando'` E a vaga do
-- pagamento online (`gateway_payment_id`) está ocupada por uma cobrança de
-- cartão que ainda pode virar aprovada —
-- `metodo_online IN ('credito','debito')` (a cobrança foi gravada de
-- verdade, `criar-pagamento/index.ts`, "Fase 3.5: metodo_online e parcelas
-- entram na MESMA gravação atômica da vaga") OU a vaga guarda o SENTINELA
-- `verificando:` (`PREFIXO_VAGA_EM_VERIFICACAO`,
-- `supabase/functions/_shared/mercadopago.ts`) — a RPC recusa com uma
-- mensagem clara, em vez de deixar o cliente cancelar. Um cartão já RECUSADO
-- não cai aqui: `liberar_cobranca_do_pedido` já limpou `gateway_payment_id`
-- e `metodo_online` de volta a NULL antes de soltar a vaga para a próxima
-- tentativa (`20261176000000_o_cartao_online_nasce.sql`).
--
-- O QUE NÃO MUDA:
--   - PIX 'aguardando' continua cancelável pelo cliente exatamente como
--     hoje: `metodo_online = 'pix'` nunca cai na condição nova (só
--     'credito'/'debito' entram no IN), e um PIX nunca ocupa a vaga com o
--     sentinela — confirmado em `criar-pagamento/index.ts`:
--     `respostaCartaoEmVerificacao` só é alcançada pelo ramo de cartão.
--   - Admin continua cancelando qualquer pedido, pago ou com cartão vivo — a
--     guarda nova mora DENTRO do `IF NOT v_is_admin`, e a reconciliação
--     manual pelo painel depende disso.
--   - Pedido já PAGO: o comportamento de hoje (ledger do estorno automático,
--     Seção 11 da 175) não muda — a guarda nova só olha
--     `payment_status = 'aguardando'`, o estado oposto.
--   - `SECURITY DEFINER`, `SET search_path = public`, a assinatura
--     (`p_order_id uuid, p_new_status text, p_notes text DEFAULT NULL,
--     p_silent boolean DEFAULT FALSE`) e o GRANT/REVOKE da função. Esta
--     função não é chamada por nenhuma edge function (varredura em
--     `supabase/functions/`: 0 ocorrência de `.rpc("update_order_status_
--     atomic"`) — só pelo front, com o JWT do usuário logado (cliente ou
--     admin); não existe caminho de `service_role` para ela hoje.
--     `CREATE OR REPLACE FUNCTION` preserva ACL — nenhuma das redefinições
--     anteriores desta mesma função (20260901000000, 20261060000000,
--     20261175000000) repete GRANT/REVOKE, e esta segue a mesma convenção
--     (o ACL vivo vem de `2026110000000`: REVOKE ALL FROM PUBLIC, anon,
--     authenticated + GRANT EXECUTE TO authenticated; reafirmado em
--     `20261090500000`: REVOKE EXECUTE FROM PUBLIC, anon).
--   - O ERRCODE da recusa nova: `RAISE EXCEPTION` sem `USING ERRCODE` sai
--     com o SQLSTATE padrão do plpgsql (P0001) — o MESMO de toda outra
--     exceção desta função. É o único código que
--     `mensagemAmigavelErroAtualizacaoStatus` (src/hooks/useOrders.ts)
--     repassa ao cliente tal como veio do banco; um ERRCODE customizado
--     aqui faria o front cair na frase genérica ("Não foi possível
--     atualizar..."), escondendo exatamente a mensagem honesta que este
--     achado pede.
--
-- DADOS EXISTENTES: nenhuma linha é lida ou reescrita — a migration troca só
-- o corpo da função.
--
-- IDEMPOTÊNCIA: `CREATE OR REPLACE FUNCTION` — reaplicar o arquivo produz o
-- mesmo corpo, sempre.
--
-- FORA DO ESCOPO: mirror da guarda em OrderDetailsView.tsx. O `Order` que a
-- tela do cliente lê (mapOrderFromDB/useOrders.ts) não carrega
-- `metodo_online` nem `gateway_payment_id` hoje (varredura em `src/`: 0
-- ocorrência dos dois nomes fora de CheckoutView/PagamentoOnline, que são o
-- checkout — não a ficha do pedido) — esconder o botão pela MESMA condição
-- exigiria plumbing novo (tipo, mapper, query, DataVault) fora do escopo
-- deste achado. O botão continua visível; a RPC recusa e `updateOrderStatus`
-- (useOrders.ts) já toasta a mensagem do banco para QUALQUER erro P0001 —
-- sem mudança nenhuma no hook nem no componente.
--
-- ORDEM DE APLICAÇÃO: depois de 75–78 (20261175000000…20261178000000, já
-- aplicadas); independente da 79 — número já tomado por outra frente, não
-- reaplicar nem esperar por ela.
--
-- COMO APLICAR: `node scripts/db-apply.cjs
-- 20261180000000_cliente_nao_cancela_com_cartao_vivo.sql` (sem BEGIN/COMMIT
-- de nível superior neste arquivo — regra da casa).
--
-- FICHA DE VERIFICAÇÃO:
--   1. `SELECT pg_get_functiondef('public.update_order_status_atomic(uuid,text,text,boolean)'::regprocedure)`
--      contém `metodo_online` e `verificando:` depois de aplicar.
--   2. Como o CLIENTE dono de um pedido 'pending', `payment_status`
--      'aguardando', `metodo_online = 'credito'`, `gateway_payment_id`
--      preenchido: `SELECT public.update_order_status_atomic('<id>',
--      'cancelled')` — RAISE EXCEPTION, pedido continua 'pending'.
--   3. Mesmo pedido, mesma chamada como ADMIN (`is_admin()` = true): cancela
--      normalmente.
--   4. Pedido 'pending', `payment_status` 'aguardando', `metodo_online =
--      'pix'`: o cliente cancela normalmente (comportamento de hoje).
--
-- ROLLBACK MANUAL:
-- rollback-manual-20261180000000_cliente_nao_cancela_com_cartao_vivo.sql
-- restaura, byte a byte, o corpo que a 20261175000000 deixou (a guarda nova
-- sai; nada mais muda).

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
    v_metodo_online TEXT;
    v_gateway_payment_id TEXT;
    v_total NUMERIC;
    v_ja_manual NUMERIC;
    v_item RECORD;
    v_result jsonb;
BEGIN
    -- Antes de qualquer leitura: sem sessão, nem existência de pedido se revela.
    IF v_caller_id IS NULL THEN
        RAISE EXCEPTION 'Não autorizado: é preciso estar autenticado para alterar um pedido.';
    END IF;

    -- Get current status and lock row
    SELECT status, user_id, cancelled_after_shipping, payment_status, paid_at, total,
           metodo_online, gateway_payment_id
      INTO v_old_status, v_user_id, v_cancelled_after_shipping, v_payment_status, v_paid_at, v_total,
           v_metodo_online, v_gateway_payment_id
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

        -- NOVO (achado independente de risco, dinheiro, 26/09/2026):
        -- cobrança de CARTÃO ainda pode virar aprovada no banco. Ver o
        -- cabeçalho desta migration (20261180000000) para o cenário e a
        -- prova de que PIX continua cancelável. `v_payment_status =
        -- 'aguardando'` isola o caso: pedido já pago segue o ramo do ledger
        -- do estorno logo abaixo, sem mudança. Dentro de 'aguardando', a
        -- vaga (`gateway_payment_id`) tem uma cobrança de cartão em jogo
        -- quando:
        --   (a) `v_metodo_online IN ('credito','debito')` — a cobrança foi
        --       gravada de verdade na MESMA transação que ocupou a vaga
        --       (criar-pagamento/index.ts, "Fase 3.5") e pode ser aprovada
        --       pelo desafio 3DS ou pela análise antifraude a qualquer
        --       momento; ou
        --   (b) a vaga guarda o SENTINELA `verificando:` (prefixo
        --       PREFIXO_VAGA_EM_VERIFICACAO, supabase/functions/_shared/
        --       mercadopago.ts) — um 409 idempotency_key_already_used cuja
        --       cobrança da tentativa anterior PODE estar aprovada por
        --       baixo; só o webhook resolve a ambiguidade (adoção, em
        --       webhook-mercadopago.ts). O sentinela nunca grava
        --       `metodo_online` (só a adoção grava — achado S3 da
        --       20261176000000), por isso entra como condição própria, não
        --       coberta pelo IN acima.
        -- Um cartão RECUSADO não cai aqui: `liberar_cobranca_do_pedido`
        -- (20261176000000) já limpou os dois campos para NULL antes de
        -- soltar a vaga para a próxima tentativa. Sem `USING ERRCODE`: ver
        -- o cabeçalho desta migration — o padrão do plpgsql (P0001) é o
        -- único código que `mensagemAmigavelErroAtualizacaoStatus`
        -- repassa ao cliente tal como veio do banco.
        IF v_payment_status = 'aguardando'
           AND (
                v_metodo_online IN ('credito', 'debito')
                OR v_gateway_payment_id LIKE 'verificando:%'
           )
        THEN
            RAISE EXCEPTION 'Este pedido tem uma cobrança no cartão em confirmação com o banco. Aguarde a confirmação ou fale com a loja antes de cancelar.';
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
    --   NOT v_cancelled_after_shipping (laudo C2 do PR #436): "nao enviado"
    --     NAO e' so' o status antigo. Pedido enviado, cancelado e REATIVADO
    --     pela loja para processing tem v_old_status='processing' com o
    --     produto NA MAO DO CLIENTE — a coluna nunca volta a false. E' a
    --     MESMA guarda que o bloco de estoque la' embaixo ja' usa; sem ela,
    --     este ciclo nasceria linha automatica com returned_to_seller_at
    --     NULL (estorno com o produto fora da loja — exatamente o que
    --     solicitar_estorno recusa no lado manual da regra).
    --   payment_status IN ('pago','pago_apos_expirar') AND paid_at IS NOT
    --     NULL: as DUAS condicoes (o plano exigiu as duas — dado legado pode
    --     ter payment_status='pago' sem paid_at, e esse nao gera linha).
    --   NOT EXISTS (... solicitado/em_processamento/concluido): o pedido
    --     pago-sem-envio ganha UMA linha de cancelamento na vida — cobre o
    --     ciclo reativar->cancelar de novo. Linhas falhou/recusado NAO
    --     bloqueiam: sao pedidos mortos, o retry e' legitimo.
    --   amount = v_total: o cancelamento devolve TUDO que foi pago (coluna
    --     total — o valor pelo qual o pedido fechou), MENOS o que uma
    --     devolução deste pedido já devolveu manualmente (achado A2, rodada
    --     3) — sem isto, o pedido reativado e cancelado de novo devolvia o
    --     total CHEIO por cima do que a devolução já tinha pago por fora.
    --   solicitado_por: quem cancelou — lojista pelo painel, cliente no app.
    IF p_new_status = 'cancelled'
       AND v_old_status IN ('pending', 'processing')
       AND v_payment_status IN ('pago', 'pago_apos_expirar')
       AND v_paid_at IS NOT NULL
       AND NOT v_cancelled_after_shipping
       AND NOT EXISTS (
            SELECT 1 FROM public.order_refunds
             WHERE order_id = p_order_id
               AND status IN ('solicitado', 'em_processamento', 'concluido'))
    THEN
        SELECT COALESCE(sum(d.valor_reembolso), 0) INTO v_ja_manual
          FROM public.devolucoes d
         WHERE d.order_id = p_order_id AND d.status = 'concluida' AND d.reembolso_manual;

        IF v_total - v_ja_manual > 0 THEN
            INSERT INTO public.order_refunds (order_id, amount, motivo, solicitado_por)
            VALUES (p_order_id, v_total - v_ja_manual, 'cancelamento antes do envio',
                    CASE WHEN v_is_admin THEN 'lojista' ELSE 'cliente' END);
        END IF;
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
