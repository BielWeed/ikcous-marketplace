-- ============================================================================
-- Migration 20261204000000 — a venda do balcão se anula no mesmo dia
-- (dinheiro + estoque + permissão; 08/10/2026)
-- ============================================================================
--
-- 1. O DEFEITO QUE ESTA MIGRATION FECHA
--
-- A venda do balcão nasce 'delivered' + 'recebido_na_entrega'
-- (registrar_venda_presencial, 20261162000000) e a ficha do pedido não oferece
-- Cancelar para entregue. Um engano no caixa (forma errada, item a mais,
-- cliente desistiu na hora) não tinha conserto: o estoque ficava baixado, o
-- Financeiro contava a entrada e o caixa esperava um dinheiro que voltou para
-- a mão do cliente. Decisão do dono (08/10/2026): "anular venda do balcão:
-- sim, só no mesmo dia e com motivo obrigatório".
--
-- 2. O QUE ESTA MIGRATION FAZ
--
-- Cria `public.anular_venda_presencial(p_order_id uuid, p_motivo text)
-- RETURNS jsonb`, SECURITY DEFINER, `search_path = public`. A função VALIDA
-- tudo e DEPOIS chama o cancelamento que o app já tem
-- (`public.pedido__mudar_status`, 20261198000000) — não escreve um laço próprio
-- de cancelar. Na ordem:
--   (1) só o ADMIN DE AGORA, três recusas 42501 antes de qualquer leitura:
--       `is_admin()` (a porta de sempre), `is_admin_atual()` (20261197000000:
--       o papel de AGORA em auth.users E profiles, nunca o do JWT — o
--       funcionário rebaixado com token velho para aqui, no padrão de
--       registrar_venda_presencial na 20261199000000) e sessão (auth.uid());
--   (2) motivo obrigatório (22023): vazio depois de tirar espaços, tabs e
--       quebras de linha é recusado; teto de 500 caracteres. Antes da trava;
--   (3) ORDEM GLOBAL DE TRAVAS (20261198000000): primeiro as linhas de
--       `order_refunds` do pedido (por id), depois o PEDIDO (FOR UPDATE).
--       Toda checagem de estado vem DEPOIS, sobre a linha travada;
--   (4) só `canal = 'presencial'` (pedido de entrega pago em dinheiro também
--       fica delivered + recebido_na_entrega + cash: só o canal separa);
--   (5) já anulada (cancelled + estornado) → devolve a MESMA resposta com
--       ja_anulada = true, sem escrever: o duplo toque não devolve estoque
--       duas vezes nem estorna duas vezes;
--   (6) venda recebida NA HORA e ainda inteira: status 'delivered',
--       payment_status 'recebido_na_entrega', payment_method cash/pix/card
--       (NULL recusa), pagamento_recebido_em preenchido, sem cobrança no
--       gateway (gateway_payment_id e metodo_online nulos), sem
--       `valor_estornado` e sem `estorno_manual_registrado_em`;
--   (7) só no MESMO DIA da loja: `fin__dia(pagamento_recebido_em) =
--       fin__hoje()` (20261177000000, America/Sao_Paulo — a mesma régua do
--       extrato, então venda e estorno caem no MESMO dia e o saldo fecha em
--       zero) E o pagamento nunca foi desfeito: `registrar_pagamento_recebido`
--       ZERA `pagamento_recebido_em` ao desfazer e carimba de novo ao
--       refazer, então uma venda de segunda "desfeita e refeita" na quarta
--       pareceria do dia. A marca de verdade é a linha 'desfeito' em
--       `marketplace_order_payment_history`: com ela, recusa;
--   (8) sem devolução viva (`devolucoes` fora de recusada/cancelada/
--       reprovada) e sem linha de `order_refunds` solicitada/em processamento/
--       concluída: quem cuida do dinheiro delas é a devolução e o ledger;
--   (9) chama `pedido__mudar_status(..., 'cancelled', ...)`, que para o balcão
--       entregue devolve o estoque (`devolver_estoque`, idempotente pelo
--       carimbo `stock_returned_at`, variação OU produto), NÃO abre linha em
--       order_refunds e grava o histórico do pedido com o motivo e quem fez;
--       depois marca payment_status = 'estornado' (+ o carimbo
--       `estorno_manual_registrado_em`) e grava o histórico do PAGAMENTO
--       ('desfeito', de recebido_na_entrega para estornado).
--   Nada é lido nem escrito em valor_estornado, pagamento_recebido_em ou total.
--
-- 3. POR QUE 'estornado' — E O QUE FAZ NO FINANCEIRO E NO CAIXA (sem dupla
--    contagem, sem perder dinheiro, sem mudar nenhuma função do Financeiro)
--
-- 'estornado' é o valor que já quer dizer "o dinheiro recebido voltou para o
-- cliente fora do gateway" (`registrar_estorno_manual`). `fin__movimentos`
-- mantém a ENTRADA da venda (o dinheiro entrou; `pagamento_recebido_em` NÃO é
-- apagado) e cria a SAÍDA 'estorno_externo' de (total − valor_estornado −
-- reembolso manual de devolução) = o total, datada de
-- `estorno_manual_registrado_em` — saldo zero no dia. `fin__caixa_calculo`
-- soma a venda em dinheiro recebida na sessão e desconta o estorno em dinheiro
-- da sessão: o `esperado` volta ao de antes da venda. Venda de total zero
-- (desconto igual ao subtotal) anula, devolve o estoque e não cria linha de
-- estorno (o filtro é "> 0"). Os KPIs do painel só contam pago/
-- pago_apos_expirar/recebido_na_entrega, e o alerta "dinheiro em pedido
-- cancelado" não acende, porque status e pagamento mudam na MESMA transação.
-- O gatilho `tr_marca_estorno_direto_do_pedido` (20261176000000) carimba a
-- mesma coluna nesta transição; o COALESCE daqui e o dele concordam. O motivo
-- fica em `marketplace_order_history`, que o dono do pedido (cliente
-- cadastrado) pode ler (RLS da 20261202000000): a tela avisa o balconista.
--
-- 4. O QUE NÃO MUDA (e fica de fora de propósito)
--
--   * nenhuma função existente é alterada; nenhuma linha é lida ou reescrita
--     ao aplicar; nenhuma venda antiga é tocada;
--   * venda cancelada antes por outro caminho (cancelled + recebido_na_entrega)
--     continua fora daqui: recusa com "Esta venda não pode ser anulada aqui.";
--   * o aviso ao cliente cadastrado ("Pedido cancelado") sai pelo gatilho de
--     sempre, só quando a venda tem `user_id`.
--
-- 5. DADOS EXISTENTES: nenhum é lido nem alterado ao aplicar. Só cria uma
--    função. Chamada, a função muda UMA venda por vez.
--
-- 6. IDEMPOTÊNCIA: `CREATE OR REPLACE`, REVOKE/GRANT e COMMENT repetíveis —
--    reaplicar produz o mesmo estado. O pré-voo recusa, com o NOME do que
--    falta ou diverge e SEM gravar nada: dependências ausentes
--    (`devolucoes`, `devolver_estoque`, `marketplace_order_payment_history`,
--    `fin__dia`, `fin__hoje`...), corpo vivo de `is_admin_atual()` e de
--    `pedido__mudar_status` diferente do esperado (md5 do corpo sem CR), ou
--    `anular_venda_presencial` já existente com OUTRO corpo. Os hashes são
--    amarrados ao texto por tests/migration_a_venda_do_balcao_se_anula_no_mesmo_dia_test.ts.
--
-- 7. TRANSAÇÃO: sem `BEGIN`/`COMMIT` de nível superior (regra da casa: com eles
--    o `ROLLBACK` da prova do workflow vira no-op). O workflow manda o arquivo
--    inteiro numa consulta só: pré-voo, função, grants e comentário caem
--    juntos ou não caem.
--
-- 8. ORDEM: depois da 20261203000000. Publicar o banco ANTES do front desta
--    release: a tela nova com o banco velho mostra "A anulação ainda não está
--    liberada neste servidor"; banco novo com front velho não muda nada para
--    ninguém.
--
-- 9. FICHA DE VERIFICAÇÃO (contra o banco vivo):
--   SELECT prosecdef, proconfig FROM pg_proc
--    WHERE oid = to_regprocedure('public.anular_venda_presencial(uuid, text)');
--   -- esperado: true, {search_path=public}
--   SELECT has_function_privilege('anon', 'public.anular_venda_presencial(uuid, text)', 'EXECUTE'),
--          has_function_privilege('authenticated', 'public.anular_venda_presencial(uuid, text)', 'EXECUTE'),
--          has_function_privilege('service_role', 'public.anular_venda_presencial(uuid, text)', 'EXECUTE');
--   -- esperado: false, true, false
--   Consulta de conferência do portão: scripts/publicacao/consultas/11a-conferir-anular-venda-presencial-aplicado.sql
--   Prova de comportamento: tests/banco/anular-venda-viva.cjs (rpc-ci.yml).
--
-- 10. ROLLBACK MANUAL: supabase/migrations/rollback-manual-20261204000000_a_venda_do_balcao_se_anula_no_mesmo_dia.sql
--    (só derruba a função; venda já anulada continua como fato).
-- ============================================================================

DO $preflight_20261204$
DECLARE
  v_item text;
  v_hash text;
  r record;
BEGIN
  FOREACH v_item IN ARRAY ARRAY[
    'public.is_admin()',
    'public.is_admin_atual()',
    'public.devolver_estoque(uuid)',
    'public.pedido__mudar_status(uuid, text, text, uuid, boolean, boolean)',
    'public.fin__dia(timestamptz)',
    'public.fin__hoje()'
  ] LOOP
    IF to_regprocedure(v_item) IS NULL THEN
      RAISE EXCEPTION 'PREFLIGHT_20261204: falta a funcao % -- aplique antes as migrations 20261197000000 (is_admin_atual), 20261198000000 (pedido__mudar_status), 20261175000000 (devolver_estoque) e 20261177000000 (fin__dia, fin__hoje).', v_item;
    END IF;
  END LOOP;

  FOREACH v_item IN ARRAY ARRAY[
    'public.marketplace_orders',
    'public.marketplace_order_history',
    'public.marketplace_order_payment_history',
    'public.devolucoes',
    'public.order_refunds'
  ] LOOP
    IF to_regclass(v_item) IS NULL THEN
      RAISE EXCEPTION 'PREFLIGHT_20261204: falta a tabela % -- aplique as migrations anteriores (20261175000000 devolucoes, 2026110000000 order_refunds, 20261020000000 historico de pagamento).', v_item;
    END IF;
  END LOOP;

  FOR r IN
    SELECT *
      FROM (VALUES
        ('marketplace_orders', 'canal'),
        ('marketplace_orders', 'status'),
        ('marketplace_orders', 'payment_status'),
        ('marketplace_orders', 'payment_method'),
        ('marketplace_orders', 'pagamento_recebido_em'),
        ('marketplace_orders', 'estorno_manual_registrado_em'),
        ('marketplace_orders', 'gateway_payment_id'),
        ('marketplace_orders', 'metodo_online'),
        ('marketplace_orders', 'valor_estornado'),
        ('marketplace_order_payment_history', 'acao'),
        ('marketplace_order_payment_history', 'payment_status_antes'),
        ('marketplace_order_payment_history', 'payment_status_depois'),
        ('devolucoes', 'order_id'),
        ('devolucoes', 'status'),
        ('order_refunds', 'order_id'),
        ('order_refunds', 'status')
      ) AS c(tabela, coluna)
  LOOP
    IF NOT EXISTS (
      SELECT 1
        FROM pg_attribute a
       WHERE a.attrelid = to_regclass('public.' || r.tabela)
         AND a.attname = r.coluna
         AND a.attnum > 0
         AND NOT a.attisdropped
    ) THEN
      RAISE EXCEPTION 'PREFLIGHT_20261204: falta a coluna public.%.% -- aplique as migrations anteriores antes desta.', r.tabela, r.coluna;
    END IF;
  END LOOP;

  -- As duas peças em que esta função se apoia têm de ter o corpo que ela
  -- assume (md5 do prosrc sem CR): a guarda do admin atual e o cancelamento.
  FOR r IN
    SELECT *
      FROM (VALUES
        ('public.is_admin_atual()', '519842163e48cc377ac1337ffb9db936'),
        ('public.pedido__mudar_status(uuid, text, text, uuid, boolean, boolean)', '4623b27a07468553d6ac00a888e04db4')
      ) AS e(assinatura, hash_esperado)
  LOOP
    SELECT md5(replace(prosrc, E'\r', '')) INTO v_hash
      FROM pg_proc
     WHERE oid = to_regprocedure(r.assinatura);
    IF v_hash IS DISTINCT FROM r.hash_esperado THEN
      RAISE EXCEPTION 'PREFLIGHT_20261204: corpo vivo de % (hash %) nao e o que esta migration assume (%) -- uma migration posterior o redefiniu; revise antes de aplicar.', r.assinatura, COALESCE(v_hash, 'ausente'), r.hash_esperado;
    END IF;
  END LOOP;

  -- Reaplicar e' permitido; sobrescrever OUTRO corpo, nao.
  SELECT md5(replace(prosrc, E'\r', '')) INTO v_hash
    FROM pg_proc
   WHERE oid = to_regprocedure('public.anular_venda_presencial(uuid, text)');
  IF v_hash IS NOT NULL AND v_hash <> 'b7407906f0f422f55afd5cdd490ebeed' THEN
    RAISE EXCEPTION 'PREFLIGHT_20261204: public.anular_venda_presencial ja existe com outro corpo (hash %) -- revise antes de aplicar.', v_hash;
  END IF;
END
$preflight_20261204$;

CREATE OR REPLACE FUNCTION public.anular_venda_presencial(p_order_id uuid, p_motivo text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path = public
AS $function$
DECLARE
    v_usuario uuid;
    v_motivo text;
    v_pedido record;
BEGIN
    -- (1) A PORTA ANTES DE QUALQUER LEITURA: quem não é da loja não descobre
    -- nem se a venda existe. is_admin() é a porta de sempre; is_admin_atual()
    -- é o papel de AGORA (auth.users E profiles), não o do JWT — o admin
    -- rebaixado com token velho para aqui (padrão da 20261197/20261199).
    IF public.is_admin() IS DISTINCT FROM true THEN
        RAISE EXCEPTION USING ERRCODE='42501', MESSAGE='Acesso negado: só a loja anula venda do balcão.';
    END IF;
    IF public.is_admin_atual() IS DISTINCT FROM true THEN
        RAISE EXCEPTION USING ERRCODE='42501', MESSAGE='Acesso negado: só a loja anula venda do balcão.';
    END IF;

    v_usuario := auth.uid();
    IF v_usuario IS NULL THEN
        RAISE EXCEPTION USING ERRCODE='42501', MESSAGE='Não autorizado: é preciso estar autenticado para anular a venda.';
    END IF;

    -- (2) Sem motivo escrito, dinheiro que volta some sem rastro. Espaço, tab
    -- e quebra de linha não contam como texto.
    v_motivo := NULLIF(btrim(COALESCE(p_motivo, ''), E' \t\r\n\f\x0b\u00a0'), '');
    IF v_motivo IS NULL THEN
        RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='Informe o motivo para anular a venda.';
    END IF;
    IF char_length(v_motivo) > 500 THEN
        RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='Motivo longo demais (até 500 caracteres).';
    END IF;

    -- (3) ORDEM GLOBAL DE TRAVAS (20261198000000): as linhas de order_refunds
    -- do pedido (por id) ANTES do pedido. Duas anulações ao mesmo tempo
    -- esperam uma pela outra no pedido; contra o estorno e o cancelamento a
    -- ordem é a mesma, então nunca há deadlock.
    PERFORM 1
       FROM public.order_refunds r
      WHERE r.order_id = p_order_id
      ORDER BY r.id
        FOR UPDATE;

    SELECT o.id, o.canal, o.status, o.payment_status, o.payment_method,
           o.pagamento_recebido_em, o.valor_estornado, o.gateway_payment_id,
           o.metodo_online, o.estorno_manual_registrado_em
      INTO v_pedido
      FROM public.marketplace_orders o
     WHERE o.id = p_order_id
       FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='Venda não encontrada.';
    END IF;

    -- (4) Só venda do BALCÃO. Pedido do site volta pelo estorno, pela
    -- devolução ou pelo cancelamento — nunca por aqui.
    IF v_pedido.canal IS DISTINCT FROM 'presencial' THEN
        RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='Só venda do balcão se anula aqui.';
    END IF;

    -- (5) Duplo toque / retentativa: a mesma resposta, nada de novo (nem
    -- estoque, nem estorno, nem histórico). Vem ANTES da regra do dia: quem
    -- clicou duas vezes, uma delas depois da meia-noite, não vê erro.
    IF v_pedido.status = 'cancelled' AND v_pedido.payment_status = 'estornado' THEN
        RETURN jsonb_build_object('order_id', v_pedido.id, 'ja_anulada', true,
                                  'status', v_pedido.status, 'payment_status', v_pedido.payment_status);
    END IF;

    -- (6) Só venda recebida NA HORA e ainda inteira.
    IF v_pedido.status IS DISTINCT FROM 'delivered'
       OR v_pedido.payment_status IS DISTINCT FROM 'recebido_na_entrega'
       OR COALESCE(v_pedido.payment_method, '') NOT IN ('cash', 'pix', 'card')
       OR v_pedido.pagamento_recebido_em IS NULL
       OR v_pedido.gateway_payment_id IS NOT NULL
       OR v_pedido.metodo_online IS NOT NULL
       OR COALESCE(v_pedido.valor_estornado, 0) <> 0
       OR v_pedido.estorno_manual_registrado_em IS NOT NULL THEN
        RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='Esta venda não pode ser anulada aqui.';
    END IF;

    -- (7) Mesmo dia da loja (a régua do Financeiro: fin__dia/fin__hoje,
    -- America/Sao_Paulo — não é o dia UTC nem o fuso da sessão). Pagamento
    -- desfeito e refeito não vale: pagamento_recebido_em foi re-carimbado.
    IF public.fin__dia(v_pedido.pagamento_recebido_em) IS DISTINCT FROM public.fin__hoje()
       OR EXISTS (
            SELECT 1 FROM public.marketplace_order_payment_history h
             WHERE h.order_id = p_order_id AND h.acao = 'desfeito'
          ) THEN
        RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='Só dá para anular no mesmo dia da venda. Para outro dia, registre uma devolução.';
    END IF;

    -- (8) Dinheiro que já está sendo tratado por outro caminho: a devolução
    -- e o ledger de estornos do app. Anular por cima contaria a mesma saída
    -- duas vezes no Financeiro.
    IF EXISTS (
        SELECT 1 FROM public.devolucoes d
         WHERE d.order_id = p_order_id
           AND d.status NOT IN ('recusada', 'cancelada', 'reprovada')
    ) THEN
        RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='Esta venda tem devolução registrada; resolva pela devolução.';
    END IF;
    IF EXISTS (
        SELECT 1 FROM public.order_refunds r
         WHERE r.order_id = p_order_id
           AND r.status IN ('solicitado', 'em_processamento', 'concluido')
    ) THEN
        RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='Esta venda já tem dinheiro devolvido pelo app; não dá para anular por cima.';
    END IF;

    -- (9) O cancelamento que o app já tem: para o balcão entregue devolve o
    -- estoque (devolver_estoque, idempotente), não abre estorno e grava o
    -- histórico do pedido com o motivo e quem fez. Depois, o dinheiro: o
    -- Financeiro e o caixa tratam 'estornado' como "devolvido fora do app".
    -- Tudo na mesma transação — nenhuma janela com cancelado + recebido.
    PERFORM public.pedido__mudar_status(
        p_order_id, 'cancelled', 'Venda do balcão anulada: ' || v_motivo,
        v_usuario, public.is_admin_atual(), false
    );

    UPDATE public.marketplace_orders
       SET payment_status = 'estornado',
           estorno_manual_registrado_em = COALESCE(estorno_manual_registrado_em, now()),
           updated_at = now()
     WHERE id = p_order_id;

    INSERT INTO public.marketplace_order_payment_history (order_id, acao, payment_status_antes, payment_status_depois, created_by)
    VALUES (p_order_id, 'desfeito', 'recebido_na_entrega', 'estornado', v_usuario);

    RETURN jsonb_build_object('order_id', p_order_id, 'ja_anulada', false,
                              'status', 'cancelled', 'payment_status', 'estornado');
END;
$function$;

REVOKE ALL ON FUNCTION public.anular_venda_presencial(uuid, text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.anular_venda_presencial(uuid, text) TO authenticated;

COMMENT ON FUNCTION public.anular_venda_presencial(uuid, text) IS 'PDV/balcão (20261204000000): anula NO MESMO DIA (America/Sao_Paulo, fin__dia = fin__hoje) uma venda do balcão recebida na hora (dinheiro, PIX na chave, maquininha), com motivo obrigatório. Só o admin de AGORA (is_admin + is_admin_atual). Valida e chama pedido__mudar_status (devolve o estoque uma vez, histórico do pedido), vira cancelled + estornado (o Financeiro e o caixa já descontam como estorno registrado fora do app: entrada e saída de mesmo valor) e grava o histórico do pagamento. Duplo toque devolve ja_anulada=true. Recusa venda com devolução, estorno do app, cobrança no gateway ou pagamento desfeito e refeito.';
