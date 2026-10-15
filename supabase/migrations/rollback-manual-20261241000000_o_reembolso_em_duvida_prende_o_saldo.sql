-- ROLLBACK MANUAL de 20261241000000_o_reembolso_em_duvida_prende_o_saldo.sql
--
-- Recria, BYTE A BYTE, os sete corpos de antes (copiados dos arquivos das migrations que os deixaram):
--   pedido__saldo_a_estornar            (20261198000000)  md5 9579d2b56b57cf948659936a928dd7dc
--   solicitar_estorno                   (20261197000000)  md5 069c3d12a470cc4708099d909c57ca02
--   admin_devolucao_concluir            (20261197000000)  md5 26080db4aeb82bdfb9fcd0c6f7169ebb
--   autorizar_post_do_estorno           (20261196000000)  md5 e128f7ad54ebc82c97b97af4aa7baa08
--   reemitir_reembolso_da_devolucao     (20261226000000)  md5 872fcb1d2bac9816e2d2b1c7c2e868c0
--   admin_devolucao_reembolso_por_fora  (20261226000000)  md5 0a7e06d7004c3fb70897e87c4dfa8cf9
--   devolucao_avisa_o_cliente           (20261225000000)  md5 2cd21f47021cafc15cae4ccd0c8c67e5
-- apaga as cinco funções novas (order_refund__pode_ter_saido, order_refund__liberavel_apos_espera,
-- pedido_reembolsos_e_saldo, admin_devolucao_reembolso_por_fora_apos_espera,
-- registrar_estorno_manual_apos_espera), devolve o EXECUTE do
-- authenticated a admin_devolucao_reemitir_reembolso e apaga a tabela order_refund_prova.
-- Isso VOLTA o defeito: o saldo deixa de descontar a linha que pode ter saído no Mercado Pago, e a linha presa
-- volta a não ter saída. Dono, ACL e atributos das sete funções não são tocados (CREATE OR REPLACE os preserva).
-- SEM BEGIN/COMMIT (aplicar pelo mesmo caminho da migration: o db-apply abre a transação).
--
-- PRÉ-VOO: recusa (B1_BASELINE_DIVERGENT) se o corpo vivo de qualquer das sete não for o desta migration nem o de
-- antes (uma redefinição posterior está no ar: desfazer por cima a apagaria em silêncio), ou se uma função nova
-- existir com corpo estranho. RECUSA também (MARCA_DE_REEMBOLSO_NAO_SE_APAGA_SEM_QUERER) se order_refund_prova
-- tiver QUALQUER linha: apagar a marca "por fora" de uma linha deixaria o robô reenviar ao Mercado Pago um
-- reembolso que a loja já pagou à mão. Apagar essas marcas é decisão do dono, com o SQL mostrado, ANTES deste
-- arquivo. A conferência final recusa se algum corpo não voltou ao de antes ou se sobrou objeto novo.
--
-- ORDEM: se o front desta release já está no ar, desfaça o front ANTES (a tela chama pedido_reembolsos_e_saldo
-- e as saídas dos 7 dias, que este arquivo apaga). Passo a passo no item 43 de docs/runbooks/producao-unica-fonte.md.

DO $preflight_rollback_20261241$
DECLARE
  r record;
  v_hash text;
  v_marcas bigint;
BEGIN
  IF to_regclass('public.order_refund_prova') IS NOT NULL THEN
    EXECUTE 'SELECT count(*) FROM public.order_refund_prova' INTO v_marcas;
    IF v_marcas > 0 THEN
      RAISE EXCEPTION 'MARCA_DE_REEMBOLSO_NAO_SE_APAGA_SEM_QUERER: order_refund_prova tem % linha(s) — uma marca "por fora" apagada deixaria o robô reenviar um reembolso que a loja já pagou à mão. Decisão do dono antes de desfazer.', v_marcas;
    END IF;
  END IF;

  FOR r IN
    SELECT * FROM (VALUES
      ('public.pedido__saldo_a_estornar(uuid)', '9579d2b56b57cf948659936a928dd7dc', 'ee7f8e6e7eb18d5a383f5634c61aa0c4'),
      ('public.solicitar_estorno(uuid,numeric,text)', '069c3d12a470cc4708099d909c57ca02', '840de50f44958fe43b55f5222691df9b'),
      ('public.admin_devolucao_concluir(uuid,text,jsonb,numeric,text)', '26080db4aeb82bdfb9fcd0c6f7169ebb', 'ebb901efff59a53082836a13e053cd1a'),
      ('public.autorizar_post_do_estorno(uuid,numeric)', 'e128f7ad54ebc82c97b97af4aa7baa08', 'c73e48294c08f34240abc3843aa7d1f1'),
      ('public.reemitir_reembolso_da_devolucao(uuid,uuid,uuid,jsonb)', '872fcb1d2bac9816e2d2b1c7c2e868c0', 'fd5d79042efa68f9a17298fff1e950bd'),
      ('public.admin_devolucao_reembolso_por_fora(uuid,uuid)', '0a7e06d7004c3fb70897e87c4dfa8cf9', '76eaffb4f9438f7fe557961e1bdaad81'),
      ('public.devolucao_avisa_o_cliente()', '2cd21f47021cafc15cae4ccd0c8c67e5', '56502b960dcf3e136c1d0d5c41091c20')
    ) AS esperado(assinatura, hash_antes, hash_desta)
  LOOP
    SELECT md5(replace(p.prosrc, E'\r', '')) INTO v_hash
      FROM pg_proc p WHERE p.oid = to_regprocedure(r.assinatura);
    IF v_hash IS NULL OR v_hash NOT IN (r.hash_desta, r.hash_antes) THEN
      RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: corpo vivo de % (hash %) não é o desta migration nem o de antes — uma redefinição posterior está no ar; revise antes de sobrescrever.', r.assinatura, COALESCE(v_hash, 'ausente');
    END IF;
  END LOOP;

  FOR r IN
    SELECT * FROM (VALUES
      ('order_refund__pode_ter_saido', 'bdbb28b3d91588c8b10283d57bfb73d6'),
      ('order_refund__liberavel_apos_espera', 'cb37f24646fda24e1a51c8f01983e083'),
      ('pedido_reembolsos_e_saldo', '64cf09844a36503dcf9d355be1a452b8'),
      ('admin_devolucao_reembolso_por_fora_apos_espera', '92dd1608d02ef5e9fd9fe34e0bd7c49f'),
      ('registrar_estorno_manual_apos_espera', 'e1cc84a9471590abd34ce9368dd444e7')
    ) AS esperado(nome, hash_desta)
  LOOP
    IF EXISTS (SELECT 1 FROM pg_proc p
                WHERE p.pronamespace = 'public'::regnamespace AND p.proname = r.nome
                  AND md5(replace(p.prosrc, E'\r', '')) <> r.hash_desta) THEN
      RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: public.% existe com um corpo que não é o desta migration — revise antes de apagar.', r.nome;
    END IF;
  END LOOP;

  IF to_regprocedure('public.admin_devolucao_reemitir_reembolso(uuid,boolean)') IS NULL THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: admin_devolucao_reemitir_reembolso(uuid, boolean) ausente — não há EXECUTE para devolver.';
  END IF;
END $preflight_rollback_20261241$;

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
                        AND (r.status IN ('solicitado', 'em_processamento')
                             OR (r.status = 'concluido' AND r.concluido_em IS NULL))), 0)
         - COALESCE((SELECT sum(d.valor_reembolso)
                       FROM public.devolucoes d
                      WHERE d.order_id = o.id
                        AND d.status = 'concluida'
                        AND d.reembolso_manual), 0)
    FROM public.marketplace_orders o
   WHERE o.id = p_order_id;
$$;

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
    v_ja_manual NUMERIC;
    v_saldo NUMERIC;
    v_refund_id UUID;
BEGIN
    -- So' a loja pede devolucao pelo painel. ERRCODE 42501 para o front
    -- distinguir "nao e' a loja" de qualquer outro erro.
    IF NOT public.is_admin() THEN
        RAISE EXCEPTION 'Somente a loja pede a devolução pelo painel.'
            USING ERRCODE = '42501';
    END IF;

    -- Papel ATUAL (auth.users E profiles), não o do JWT: admin rebaixado para aqui (20261197000000).
    IF NOT public.is_admin_atual() THEN
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
    -- pendencias em andamento (solicitado/em_processamento) - reembolso
    -- manual de devolução já concluída do mesmo pedido (achado 3, rodada 2).
    -- Linhas falhou/recusado NAO reservam saldo: sao pedidos mortos.
    SELECT COALESCE(SUM(amount), 0) INTO v_em_curso
      FROM public.order_refunds
     WHERE order_id = p_order_id
       AND status IN ('solicitado', 'em_processamento');

    SELECT COALESCE(sum(d.valor_reembolso), 0) INTO v_ja_manual
      FROM public.devolucoes d
     WHERE d.order_id = p_order_id AND d.status = 'concluida' AND d.reembolso_manual;

    v_saldo := v_total - v_valor_estornado - v_em_curso - v_ja_manual;

    IF p_amount IS NULL OR p_amount <= 0 THEN
        RAISE EXCEPTION 'O valor a devolver tem de ser maior que zero.';
    END IF;

    IF p_amount > v_saldo THEN
        RAISE EXCEPTION 'O valor pedido (R$ %) é maior que o valor disponível para devolver (R$ %).',
            to_char(p_amount, 'FM999G999D00'), to_char(v_saldo, 'FM999G999D00')
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

CREATE OR REPLACE FUNCTION public.admin_devolucao_concluir(
  p_id uuid,
  p_resolucao text,
  p_itens jsonb,
  p_valor_reembolso numeric DEFAULT NULL,
  p_observacao text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_d public.devolucoes%ROWTYPE;
  v_o public.marketplace_orders%ROWTYPE;
  v_item jsonb;
  v_di public.devolucao_itens%ROWTYPE;
  v_condicao text;
  v_reestocar boolean;
  v_reestocados integer := 0;
  v_valor numeric(12, 2);
  v_disponivel numeric(12, 2);
  v_em_voo numeric(12, 2);
  v_ja_manual numeric(12, 2);
  v_pago_pelo_app boolean;
  v_refund_id uuid;
  v_manual boolean := false;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Acesso negado.' USING ERRCODE = '42501';
  END IF;
  -- Papel ATUAL (auth.users E profiles), não o do JWT: admin rebaixado para aqui (20261197000000).
  IF NOT public.is_admin_atual() THEN
    RAISE EXCEPTION 'Acesso negado.' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_d FROM public.devolucoes WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Devolução não encontrada.' USING ERRCODE = 'P0002';
  END IF;
  IF v_d.status <> 'recebida' THEN
    RAISE EXCEPTION 'Conclua a devolução depois de receber o produto.' USING ERRCODE = '22023';
  END IF;
  IF p_resolucao IS NULL OR p_resolucao NOT IN ('reembolso', 'troca', 'vale') THEN
    RAISE EXCEPTION 'Escolha a resolução: reembolso, troca ou vale-troca.' USING ERRCODE = '22023';
  END IF;
  IF p_resolucao = 'reembolso' AND v_d.tipo = 'troca' THEN
    RAISE EXCEPTION 'Devolução por troca de política não gera reembolso. Use troca ou vale-troca.' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_o FROM public.marketplace_orders WHERE id = v_d.order_id FOR UPDATE;

  -- Achado H (revisão de 26/09/2026): o lock não bastava — a devolução podia
  -- concluir mesmo depois de o PEDIDO ter mudado de vida por outro caminho
  -- (admin cancela + registrar_estorno_manual enquanto a devolução está
  -- 'recebida', ou o estoque já voltou pelo cancelamento). Sem isto: venda de
  -- balcão de R$100, devolução concluída com reembolso, pedido cancelado e
  -- estornado por fora → 200 saem por uma venda de 100, e o estoque credita
  -- de novo (achado C, ver devolver_estoque logo abaixo).
  IF v_o.status <> 'delivered' THEN
    RAISE EXCEPTION 'O pedido desta devolução não está mais entregue (status atual: %). Fale com o financeiro antes de concluir.',
      v_o.status USING ERRCODE = '22023';
  END IF;
  IF v_o.payment_status IS NULL
     OR v_o.payment_status NOT IN ('pago', 'pago_apos_expirar', 'recebido_na_entrega') THEN
    RAISE EXCEPTION 'Este pedido não tem pagamento registrado para devolver.' USING ERRCODE = '22023';
  END IF;
  -- Achado 4 (revisão 26/09/2026, rodada 2): stock_returned_at NÃO É só
  -- "cancelou depois da devolução" — a política P1 (pago após expirar,
  -- HONRAR) reativa pedido expirado (devolver_estoque já carimbou) até
  -- 'delivered' de verdade, e esse carimbo nunca some. Recusar a conclusão
  -- inteira aqui prendia esses pedidos para sempre, sem devolução possível.
  -- A trava certa é só no REESTOQUE (abaixo, força reestocar=false) — a
  -- resolução (reembolso/troca/vale) segue normal.

  -- Inspeção e reestoque por item (uma vez só por item).
  FOR v_item IN SELECT * FROM jsonb_array_elements(COALESCE(p_itens, '[]'::jsonb)) LOOP
    SELECT * INTO v_di FROM public.devolucao_itens
     WHERE id = NULLIF(v_item ->> 'item_id', '')::uuid AND devolucao_id = p_id FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Item não pertence a esta devolução.' USING ERRCODE = '22023';
    END IF;
    v_condicao := v_item ->> 'condicao';
    IF v_condicao IS NULL OR v_condicao NOT IN ('nova', 'usada', 'danificada', 'ausente') THEN
      RAISE EXCEPTION 'Informe a condição de cada item recebido.' USING ERRCODE = '22023';
    END IF;
    v_reestocar := COALESCE((v_item ->> 'reestocar')::boolean, false) AND v_condicao <> 'ausente'
                   AND v_o.stock_returned_at IS NULL;

    UPDATE public.devolucao_itens SET condicao = v_condicao, reestocar = v_reestocar WHERE id = v_di.id;

    IF v_reestocar AND v_di.reestocado_em IS NULL THEN
      IF v_di.variant_id IS NOT NULL THEN
        UPDATE public.product_variants SET stock_increment = stock_increment + v_di.quantidade
         WHERE id = v_di.variant_id;
      ELSIF v_di.product_id IS NOT NULL THEN
        UPDATE public.produtos SET estoque = estoque + v_di.quantidade WHERE id = v_di.product_id;
      END IF;
      UPDATE public.devolucao_itens SET reestocado_em = now() WHERE id = v_di.id;
      v_reestocados := v_reestocados + v_di.quantidade;
    END IF;
  END LOOP;

  IF EXISTS (SELECT 1 FROM public.devolucao_itens WHERE devolucao_id = p_id AND condicao IS NULL) THEN
    RAISE EXCEPTION 'Informe a condição de cada item recebido.' USING ERRCODE = '22023';
  END IF;

  IF p_resolucao = 'reembolso' THEN
    -- Achado G: pagamento online com mais de 180 dias — o executor
    -- (supabase/functions/_shared/estorno.ts, guardaAntesDeChamar) RECUSA
    -- antes de chamar o Mercado Pago (prazo_vicio_dias aceita até 365, o MP
    -- só até 180). Abrir a linha em order_refunds ali só criaria um
    -- 'recusado' e a devolução concluiria sem dinheiro sair e sem caminho de
    -- refazer. Vai direto pelo caminho manual (a loja resolve fora do app).
    v_pago_pelo_app := v_o.payment_method = 'online'
                       AND v_o.payment_status IN ('pago', 'pago_apos_expirar')
                       AND v_o.gateway_payment_id IS NOT NULL
                       AND v_o.paid_at IS NOT NULL
                       AND now() - v_o.paid_at <= interval '180 days';

    -- Achado 3 (revisão 26/09/2026, rodada 2): reembolso manual JÁ CONCLUÍDO
    -- de uma OUTRA devolução do mesmo pedido é dinheiro que já saiu — sem
    -- descontar, uma segunda devolução online (ou reemitida) reabria o
    -- saldo cheio e pagava duas vezes a mesma fatia.
    SELECT COALESCE(sum(d.valor_reembolso), 0) INTO v_ja_manual
      FROM public.devolucoes d
     WHERE d.order_id = v_o.id AND d.status = 'concluida' AND d.reembolso_manual AND d.id <> v_d.id;

    IF v_pago_pelo_app THEN
      -- Mesma trava de saldo da solicitar_estorno: total − já devolvido − em voo.
      SELECT COALESCE(sum(r.amount), 0) INTO v_em_voo FROM public.order_refunds r
       WHERE r.order_id = v_o.id AND r.status IN ('solicitado', 'em_processamento');
      v_disponivel := v_o.total - COALESCE(v_o.valor_estornado, 0) - v_em_voo - v_ja_manual;
    ELSE
      SELECT v_o.total - COALESCE(v_o.valor_estornado, 0) - COALESCE(sum(d.valor_reembolso), 0)
        INTO v_disponivel
        FROM public.devolucoes d
       WHERE d.order_id = v_o.id AND d.status = 'concluida' AND d.reembolso_manual;
    END IF;
    v_disponivel := GREATEST(COALESCE(v_disponivel, 0), 0);

    -- Achado A: valor explícito do lojista continua recusado se passar do
    -- disponível (erro dele, ele corrige); o DEFAULT (valor dos itens + frete
    -- de ida) é CAPADO no disponível em vez de recusar a conclusão — era isto
    -- que fazia uma devolução integral com cupom (itens no preço cheio,
    -- 220 > 120 pagos) travar para sempre.
    IF p_valor_reembolso IS NOT NULL THEN
      v_valor := round(p_valor_reembolso, 2);
      IF v_valor <= 0 THEN
        RAISE EXCEPTION 'Informe o valor do reembolso.' USING ERRCODE = '22023';
      END IF;
      IF v_pago_pelo_app THEN
        IF v_valor > v_disponivel THEN
          RAISE EXCEPTION 'O reembolso (R$ %) passa do que ainda pode ser devolvido deste pedido (R$ %).',
            v_valor, v_disponivel USING ERRCODE = '22023';
        END IF;
      ELSE
        IF v_valor > v_disponivel THEN
          RAISE EXCEPTION 'O reembolso (R$ %) passa do valor pago no pedido (R$ %).',
            v_valor, v_disponivel USING ERRCODE = '22023';
        END IF;
      END IF;
    ELSE
      v_valor := LEAST(round(v_d.valor_itens + v_d.valor_frete_ida, 2), v_disponivel);
      IF v_valor <= 0 THEN
        RAISE EXCEPTION 'Não há valor disponível para reembolso deste pedido.' USING ERRCODE = '22023';
      END IF;
    END IF;

    IF v_pago_pelo_app THEN
      INSERT INTO public.order_refunds (order_id, amount, motivo, solicitado_por, status)
      VALUES (v_o.id, v_valor, 'Devolução ' || v_d.protocolo, 'lojista', 'solicitado')
      RETURNING id INTO v_refund_id;
    ELSE
      v_manual := true;
    END IF;
  END IF;

  UPDATE public.devolucoes
     SET status = 'concluida', resolucao_final = p_resolucao,
         valor_reembolso = CASE WHEN p_resolucao = 'reembolso' THEN v_valor END,
         refund_id = v_refund_id, reembolso_manual = v_manual,
         observacao_inspecao = NULLIF(btrim(COALESCE(p_observacao, '')), ''),
         concluida_em = now(), updated_at = now()
   WHERE id = p_id;

  PERFORM public.devolucao__registrar_evento(p_id, 'recebida', 'concluida', 'loja',
    CASE p_resolucao
      WHEN 'reembolso' THEN 'Reembolso de R$ ' || to_char(v_valor, 'FM999G999G990D00')
        || CASE WHEN v_manual THEN ' (devolvido pela loja fora do app)' ELSE ' pelo Mercado Pago' END
      WHEN 'troca' THEN 'Troca combinada com a loja'
      ELSE 'Vale-troca emitido'
    END);

  RETURN jsonb_build_object(
    'id', p_id, 'status', 'concluida', 'resolucao', p_resolucao,
    'valor_reembolso', CASE WHEN p_resolucao = 'reembolso' THEN v_valor END,
    'refund_id', v_refund_id, 'reembolso_manual', v_manual, 'reestocados', v_reestocados
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.autorizar_post_do_estorno(
  p_refund_id uuid,
  p_valor numeric
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_linha public.order_refunds%ROWTYPE;
  v_total numeric(12,2);
  v_estornado numeric(12,2);
  v_payment_status text;
  v_paid_at timestamptz;
  v_status text;
  v_gateway text;
  v_em_voo_outras numeric(12,2);
  v_disponivel numeric(12,2);
BEGIN
  IF p_refund_id IS NULL OR p_valor IS NULL OR p_valor <= 0 THEN
    RAISE EXCEPTION 'autorizar_post_entrada_invalida: linha e valor positivo são obrigatórios.';
  END IF;

  -- ORDEM GLOBAL (cabeçalho): a LINHA, depois o PEDIDO.
  SELECT * INTO v_linha
    FROM public.order_refunds
   WHERE id = p_refund_id
     FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('decisao', 'linha_mudou', 'status', NULL);
  END IF;

  SELECT total, COALESCE(valor_estornado, 0), payment_status, paid_at, status, gateway_payment_id
    INTO v_total, v_estornado, v_payment_status, v_paid_at, v_status, v_gateway
    FROM public.marketplace_orders
   WHERE id = v_linha.order_id
     FOR UPDATE;

  IF v_linha.solicitado_por = 'sistema'
     OR v_linha.status <> 'em_processamento'
     OR v_linha.amount <> p_valor THEN
    RETURN jsonb_build_object('decisao', 'linha_mudou', 'status', v_linha.status);
  END IF;

  SELECT COALESCE(sum(amount), 0) INTO v_em_voo_outras
    FROM public.order_refunds
   WHERE order_id = v_linha.order_id
     AND id <> v_linha.id
     AND status IN ('solicitado', 'em_processamento');
  v_disponivel := v_total - v_estornado - v_em_voo_outras;

  IF p_valor > v_disponivel THEN
    RETURN jsonb_build_object('decisao', 'nao_cabe', 'disponivel', v_disponivel);
  END IF;

  -- O carimbo do POST autorizado (R1 da revisão Opus de 14d77a5b): daqui
  -- em diante a linha é INCERTA — ver o cabeçalho.
  UPDATE public.order_refunds
     SET updated_at = now(),
         post_autorizado_em = now()
   WHERE id = v_linha.id;

  RETURN jsonb_build_object(
    'decisao', 'autorizado',
    'disponivel', v_disponivel,
    'pedido', jsonb_build_object(
      'id', v_linha.order_id,
      'gateway_payment_id', v_gateway,
      'total', v_total,
      'valor_estornado', v_estornado,
      'payment_status', v_payment_status,
      'paid_at', v_paid_at,
      'status', v_status
    )
  );
END;
$fn$;

CREATE OR REPLACE FUNCTION public.reemitir_reembolso_da_devolucao(
  p_devolucao_id uuid,
  p_ator uuid,
  p_refund_esperado uuid,
  p_consulta jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $reemitir$
DECLARE
  v_d public.devolucoes%ROWTYPE;
  v_o public.marketplace_orders%ROWTYPE;
  v_r public.order_refunds%ROWTYPE;
  v_diag public.order_refund_diagnostico%ROWTYPE;
  v_consulta text;
  v_sem_post boolean;
  v_mp_refund text;
  v_mp_status text;
  v_valor numeric(12, 2);
  v_saldo numeric(12, 2);
  v_novo uuid;
BEGIN
  IF COALESCE(current_setting('role', true), '') NOT IN ('postgres', 'service_role') THEN
    RAISE EXCEPTION 'Não autorizado: a reemissão do reembolso só acontece pelo servidor.'
      USING ERRCODE = '42501';
  END IF;
  IF p_ator IS NULL THEN
    RAISE EXCEPTION 'Acesso negado.' USING ERRCODE = '42501';
  END IF;
  -- Admin ATUAL do ATOR, nas duas fontes (auth.users e profiles), nunca do JWT nem da sessão:
  -- is_admin()/is_admin_atual() devolvem TRUE para service_role e aqui não conferiam nada.
  IF NOT (
       EXISTS (SELECT 1 FROM auth.users u
                WHERE u.id = p_ator AND (u.raw_app_meta_data ->> 'role') = 'admin')
       AND EXISTS (SELECT 1 FROM public.profiles pr
                    WHERE pr.id = p_ator AND pr.role = 'admin')
     ) THEN
    RAISE EXCEPTION 'Acesso negado.' USING ERRCODE = '42501';
  END IF;
  IF p_refund_esperado IS NULL THEN
    RAISE EXCEPTION 'Informe a linha de reembolso que a tela mostrava (p_refund_esperado).' USING ERRCODE = '22023';
  END IF;
  v_consulta := p_consulta ->> 'resultado';
  IF v_consulta IS NULL OR v_consulta NOT IN ('achou', 'nao_achou') THEN
    RAISE EXCEPTION 'A consulta ao Mercado Pago precisa dizer "achou" ou "nao_achou"; indeterminado não reemite.'
      USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_d FROM public.devolucoes WHERE id = p_devolucao_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Devolução não encontrada.' USING ERRCODE = 'P0002';
  END IF;
  IF v_d.status <> 'concluida' OR v_d.resolucao_final IS DISTINCT FROM 'reembolso' THEN
    RAISE EXCEPTION 'Só uma devolução concluída com reembolso pode reemitir o reembolso.' USING ERRCODE = '22023';
  END IF;
  IF v_d.valor_reembolso IS NULL OR v_d.valor_reembolso <= 0 THEN
    RAISE EXCEPTION 'Esta devolução não tem valor de reembolso.' USING ERRCODE = '22023';
  END IF;
  IF v_d.reembolso_manual THEN
    RETURN jsonb_build_object('resultado', 'ja_concluido', 'detalhe', 'por_fora');
  END IF;
  IF v_d.refund_id IS NULL THEN
    RAISE EXCEPTION 'Esta devolução não tem um reembolso para reemitir.' USING ERRCODE = '22023';
  END IF;

  -- As linhas do pedido, por id, ANTES do pedido (a ordem de concluir_estorno e do cancelamento).
  PERFORM 1
     FROM public.order_refunds r
    WHERE r.order_id = v_d.order_id
    ORDER BY r.id
      FOR UPDATE;
  SELECT * INTO v_o FROM public.marketplace_orders WHERE id = v_d.order_id FOR UPDATE;

  -- Duplo clique / dois lojistas / tela velha: a devolução já aponta para outra linha.
  IF v_d.refund_id IS DISTINCT FROM p_refund_esperado THEN
    RETURN jsonb_build_object('resultado', 'reembolso_mudou', 'detalhe', 'outra_linha',
                              'refund_id', v_d.refund_id);
  END IF;
  SELECT * INTO v_r FROM public.order_refunds WHERE id = v_d.refund_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'A linha de reembolso desta devolução não existe mais.' USING ERRCODE = 'P0002';
  END IF;
  IF v_r.status = 'concluido' THEN
    RETURN jsonb_build_object('resultado', 'ja_concluido', 'detalhe', 'dinheiro_ja_saiu', 'refund_id', v_r.id);
  END IF;
  IF v_r.status IN ('solicitado', 'em_processamento') THEN
    RETURN jsonb_build_object('resultado', 'em_andamento', 'detalhe', v_r.status, 'refund_id', v_r.id);
  END IF;

  -- A linha é `falhou` ou `recusado`. NUNCA teve POST? (o MP provou que nada saiu, ou nunca houve POST)
  SELECT * INTO v_diag FROM public.order_refund_diagnostico WHERE refund_id = v_r.id;
  v_sem_post := v_r.mp_refund_id IS NULL
    AND (
      (v_r.status = 'recusado' AND v_r.post_autorizado_em IS NULL)
      OR (v_r.status = 'falhou'
          AND v_diag.refund_id IS NOT NULL
          AND v_diag.post_incerto_em IS NULL
          AND v_diag.mp_codigo IN ('insufficient_money_for_refund', 'order_payment_not_yet_enabled_for_refund'))
    );

  IF v_sem_post THEN
    -- Nada saiu desta linha. Um reembolso do pedido sem dono no MP é dinheiro NÃO explicado: não
    -- cria (pagaria de novo) e não adota (nunca se adota para linha que nunca teve POST).
    IF v_consulta = 'achou' THEN
      RETURN jsonb_build_object('resultado', 'indeterminado', 'detalhe', 'reembolso_do_mp_sem_dono');
    END IF;
  ELSE
    -- Incerta: o POST pode ter chegado ao MP. Sem reembolso achado, nunca ganha chave nova.
    IF v_consulta = 'nao_achou' THEN
      RETURN jsonb_build_object('resultado', 'use_por_fora', 'detalhe', 'sem_prova_de_que_nao_saiu',
                                'refund_id', v_r.id);
    END IF;

    -- ADOTAR: o MP já fez este reembolso.
    v_mp_refund := NULLIF(btrim(p_consulta ->> 'mp_refund_id'), '');
    v_mp_status := p_consulta ->> 'mp_status';
    BEGIN
      v_valor := (p_consulta ->> 'valor')::numeric;
    EXCEPTION WHEN invalid_text_representation THEN
      RAISE EXCEPTION 'O valor da consulta ao Mercado Pago não é um número.' USING ERRCODE = '22023';
    END;
    IF v_mp_refund IS NULL OR v_mp_status IS NULL OR v_mp_status NOT IN ('processed', 'approved') OR v_valor IS NULL THEN
      RAISE EXCEPTION 'A consulta "achou" precisa de mp_refund_id, mp_status (processed/approved) e valor.' USING ERRCODE = '22023';
    END IF;
    IF v_valor <> v_r.amount THEN
      RETURN jsonb_build_object('resultado', 'indeterminado', 'detalhe', 'valor_diferente');
    END IF;
    IF EXISTS (SELECT 1 FROM public.order_refunds x
                WHERE x.order_id = v_r.order_id AND x.id <> v_r.id AND x.mp_refund_id = v_mp_refund) THEN
      RETURN jsonb_build_object('resultado', 'indeterminado', 'detalhe', 'reembolso_ja_registrado_em_outra_linha');
    END IF;
    IF EXISTS (SELECT 1 FROM public.order_refunds x
                WHERE x.order_id = v_r.order_id AND x.id <> v_r.id
                  AND x.solicitado_por <> 'sistema'
                  AND x.mp_refund_id IS NULL
                  AND x.amount = v_r.amount
                  AND x.status IN ('solicitado', 'em_processamento', 'falhou')) THEN
      RETURN jsonb_build_object('resultado', 'indeterminado', 'detalhe', 'outra_linha_do_mesmo_valor');
    END IF;

    BEGIN
      PERFORM public.concluir_estorno(v_r.id, v_mp_refund, v_mp_status, NULL);
    EXCEPTION
      WHEN unique_violation THEN
        RETURN jsonb_build_object('resultado', 'indeterminado', 'detalhe', 'reembolso_ja_registrado_em_outra_linha');
      WHEN raise_exception THEN
        IF SQLERRM LIKE 'estorno_acima_do_total%' THEN
          RETURN jsonb_build_object('resultado', 'indeterminado', 'detalhe', 'passaria_do_total_do_pedido');
        END IF;
        RAISE;
    END;
    PERFORM public.devolucao__registrar_evento(p_devolucao_id, 'concluida', 'concluida', 'loja',
      'O reembolso desta devolução já tinha sido feito pelo Mercado Pago; a loja confirmou.');
    RETURN jsonb_build_object('resultado', 'ja_existia', 'detalhe', 'adotado',
                              'refund_id', v_r.id, 'mp_refund_id', v_mp_refund);
  END IF;

  -- CRIAR a tentativa nova (a linha nunca teve POST e o MP não tem reembolso sem dono).
  IF v_o.status <> 'delivered' THEN
    RETURN jsonb_build_object('resultado', 'use_por_fora', 'detalhe', 'pedido_nao_entregue');
  END IF;
  IF v_o.payment_status IS NULL OR v_o.payment_status NOT IN ('pago', 'pago_apos_expirar') THEN
    RETURN jsonb_build_object('resultado', 'use_por_fora', 'detalhe', 'sem_pagamento_pelo_app');
  END IF;
  IF NOT (v_o.payment_method = 'online'
          AND v_o.gateway_payment_id IS NOT NULL
          AND v_o.paid_at IS NOT NULL
          AND now() - v_o.paid_at <= interval '180 days') THEN
    RETURN jsonb_build_object('resultado', 'use_por_fora', 'detalhe', 'fora_do_prazo_ou_da_forma');
  END IF;
  -- Devolução pelo painel do MP depois da conclusão: o webhook a registra como linha `sistema`
  -- (sem contestação). Reemitir pagaria a cliente de novo.
  IF EXISTS (SELECT 1 FROM public.order_refunds s
              WHERE s.order_id = v_o.id
                AND s.solicitado_por = 'sistema'
                AND s.status = 'concluido'
                AND s.mp_chargeback_id IS NULL
                AND s.created_at >= COALESCE(v_d.concluida_em, v_d.updated_at)) THEN
    RETURN jsonb_build_object('resultado', 'use_por_fora', 'detalhe', 'devolvido_pelo_painel_do_mp');
  END IF;

  v_saldo := public.pedido__saldo_a_estornar(v_o.id);
  IF v_saldo IS NULL OR v_saldo < v_d.valor_reembolso THEN
    RETURN jsonb_build_object('resultado', 'sem_saldo_para_reemitir', 'detalhe', 'saldo_menor_que_o_valor',
                              'saldo', GREATEST(COALESCE(v_saldo, 0), 0), 'valor', v_d.valor_reembolso);
  END IF;

  INSERT INTO public.order_refunds (order_id, amount, motivo, solicitado_por, status)
  VALUES (v_o.id, v_d.valor_reembolso, 'Reemissão da devolução ' || v_d.protocolo, 'lojista', 'solicitado')
  RETURNING id INTO v_novo;

  UPDATE public.devolucoes
     SET refund_id = v_novo, reembolso_manual = false, updated_at = now()
   WHERE id = p_devolucao_id;

  PERFORM public.devolucao__registrar_evento(p_devolucao_id, 'concluida', 'concluida', 'loja',
    'Reembolso reemitido pelo Mercado Pago após a falha anterior.');

  RETURN jsonb_build_object('resultado', 'reemitido', 'detalhe', 'tentativa_nova',
                            'refund_id', v_novo, 'refund_anterior', v_r.id);
END;
$reemitir$;

CREATE OR REPLACE FUNCTION public.admin_devolucao_reembolso_por_fora(
  p_devolucao_id uuid,
  p_refund_esperado uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $por_fora$
DECLARE
  v_d public.devolucoes%ROWTYPE;
  v_r public.order_refunds%ROWTYPE;
  v_diag public.order_refund_diagnostico%ROWTYPE;
  v_risco boolean;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Acesso negado.' USING ERRCODE = '42501';
  END IF;
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Acesso negado.' USING ERRCODE = '42501';
  END IF;
  -- Papel ATUAL (auth.users E profiles), não o do JWT: admin rebaixado para aqui.
  IF NOT public.is_admin_atual() THEN
    RAISE EXCEPTION 'Acesso negado.' USING ERRCODE = '42501';
  END IF;
  IF p_refund_esperado IS NULL THEN
    RAISE EXCEPTION 'Informe a linha de reembolso que a tela mostrava (p_refund_esperado).' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_d FROM public.devolucoes WHERE id = p_devolucao_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Devolução não encontrada.' USING ERRCODE = 'P0002';
  END IF;
  IF v_d.status <> 'concluida' OR v_d.resolucao_final IS DISTINCT FROM 'reembolso' THEN
    RAISE EXCEPTION 'Só uma devolução concluída com reembolso pode ser resolvida por fora.' USING ERRCODE = '22023';
  END IF;
  IF v_d.valor_reembolso IS NULL OR v_d.valor_reembolso <= 0 THEN
    RAISE EXCEPTION 'Esta devolução não tem valor de reembolso.' USING ERRCODE = '22023';
  END IF;
  IF v_d.reembolso_manual THEN
    RETURN jsonb_build_object('resultado', 'ja_concluido', 'detalhe', 'por_fora');
  END IF;
  IF v_d.refund_id IS NULL THEN
    RAISE EXCEPTION 'Esta devolução não tem um reembolso para resolver por fora.' USING ERRCODE = '22023';
  END IF;

  PERFORM 1
     FROM public.order_refunds r
    WHERE r.order_id = v_d.order_id
    ORDER BY r.id
      FOR UPDATE;
  PERFORM 1 FROM public.marketplace_orders o WHERE o.id = v_d.order_id FOR UPDATE;

  IF v_d.refund_id IS DISTINCT FROM p_refund_esperado THEN
    RETURN jsonb_build_object('resultado', 'reembolso_mudou', 'detalhe', 'outra_linha',
                              'refund_id', v_d.refund_id);
  END IF;
  SELECT * INTO v_r FROM public.order_refunds WHERE id = v_d.refund_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'A linha de reembolso desta devolução não existe mais.' USING ERRCODE = 'P0002';
  END IF;
  IF v_r.status = 'concluido' THEN
    RETURN jsonb_build_object('resultado', 'ja_concluido', 'detalhe', 'dinheiro_ja_saiu', 'refund_id', v_r.id);
  END IF;
  IF v_r.status IN ('solicitado', 'em_processamento') THEN
    RETURN jsonb_build_object('resultado', 'em_andamento', 'detalhe', v_r.status, 'refund_id', v_r.id);
  END IF;

  SELECT * INTO v_diag FROM public.order_refund_diagnostico WHERE refund_id = v_r.id;
  v_risco := NOT (
    v_r.mp_refund_id IS NULL
    AND (
      (v_r.status = 'recusado' AND v_r.post_autorizado_em IS NULL)
      OR (v_r.status = 'falhou'
          AND v_diag.refund_id IS NOT NULL
          AND v_diag.post_incerto_em IS NULL
          AND v_diag.mp_codigo IN ('insufficient_money_for_refund', 'order_payment_not_yet_enabled_for_refund'))
    )
  );

  UPDATE public.devolucoes
     SET refund_id = NULL, reembolso_manual = true, updated_at = now()
   WHERE id = p_devolucao_id;

  PERFORM public.devolucao__registrar_evento(p_devolucao_id, 'concluida', 'concluida', 'loja',
    'Reembolso resolvido manualmente (fora do app) após a falha pelo Mercado Pago.');
  PERFORM public.devolucao__avisar_reembolso(p_devolucao_id, 'reembolso_combinado', 'success',
    'Devolução concluída',
    'O reembolso da devolução ' || v_d.protocolo || ' foi combinado com a loja (em mãos ou por PIX). Se tiver dúvida, fale com a loja.');

  RETURN jsonb_build_object('resultado', 'combinado',
                            'detalhe', CASE WHEN v_risco THEN 'pode_ter_saido_no_mp' ELSE 'ok' END,
                            'risco_de_dobro', v_risco);
END;
$por_fora$;

CREATE OR REPLACE FUNCTION public.devolucao_avisa_o_cliente()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $avisa_o_cliente$
DECLARE
  v_titulo text;
  v_msg text;
  v_tipo text := 'info';
  v_evento text;
  v_estado text;
BEGIN
  IF OLD.status IS NOT DISTINCT FROM NEW.status THEN
    RETURN NEW;
  END IF;
  CASE NEW.status
    WHEN 'aprovada' THEN
      v_titulo := 'Devolução aprovada';
      v_msg := 'A loja aprovou a devolução ' || NEW.protocolo || '. Veja as instruções no pedido.';
    WHEN 'recusada' THEN
      v_tipo := 'warning';
      v_titulo := 'Devolução não aprovada';
      v_msg := 'A loja respondeu a devolução ' || NEW.protocolo || '. Veja o motivo no pedido.';
    WHEN 'recebida' THEN
      v_titulo := 'Produto recebido pela loja';
      v_msg := 'A loja recebeu o produto da devolução ' || NEW.protocolo || '.';
    WHEN 'concluida' THEN
      v_tipo := 'success';
      v_titulo := 'Devolução concluída';
      IF NEW.resolucao_final = 'reembolso' THEN
        -- O estado REAL do dinheiro, lido AGORA: nunca "liberado" por antecipação. O
        -- "liberado" de verdade nasce no gatilho de order_refunds, quando o MP confirma.
        IF NEW.reembolso_manual THEN
          v_estado := 'manual';
        ELSE
          SELECT r.status INTO v_estado FROM public.order_refunds r WHERE r.id = NEW.refund_id;
        END IF;
        CASE COALESCE(v_estado, 'sem_linha')
          WHEN 'manual' THEN
            v_evento := 'reembolso_combinado';
            v_msg := 'O reembolso da devolução ' || NEW.protocolo || ' foi combinado com a loja (em mãos ou por PIX). Se tiver dúvida, fale com a loja.';
          WHEN 'concluido' THEN
            v_evento := 'reembolso_liberado';
            v_msg := 'O reembolso da devolução ' || NEW.protocolo || ' foi liberado pelo Mercado Pago.';
          WHEN 'solicitado', 'em_processamento' THEN
            v_evento := 'reembolso_em_processamento';
            v_tipo := 'info';
            v_msg := 'A loja concluiu a devolução ' || NEW.protocolo || '. O reembolso está em processamento no Mercado Pago; você recebe um novo aviso quando ele for liberado.';
          ELSE
            v_evento := 'reembolso_nao_liberado';
            v_tipo := 'warning';
            v_msg := 'A loja concluiu a devolução ' || NEW.protocolo || ', mas o reembolso ainda não foi liberado. A loja está resolvendo e vai falar com você.';
        END CASE;
      ELSE
        v_msg := CASE NEW.resolucao_final
          WHEN 'troca' THEN 'A troca da devolução ' || NEW.protocolo || ' foi confirmada.'
          ELSE 'O vale-troca da devolução ' || NEW.protocolo || ' foi emitido.'
        END;
      END IF;
    WHEN 'reprovada' THEN
      v_tipo := 'warning';
      v_titulo := 'Produto não aceito na inspeção';
      v_msg := 'Veja no pedido o retorno da loja sobre a devolução ' || NEW.protocolo || '.';
    ELSE
      RETURN NEW;
  END CASE;

  IF v_evento IS NOT NULL THEN
    PERFORM public.devolucao__avisar_reembolso(NEW.id, v_evento, v_tipo, v_titulo, v_msg);
    RETURN NEW;
  END IF;

  BEGIN
    INSERT INTO public.notificacoes (usuario_id, tipo, titulo, mensagem, dados)
    VALUES (NEW.user_id, v_tipo, v_titulo, v_msg,
            jsonb_build_object('order_id', NEW.order_id, 'devolucao_id', NEW.id));
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'devolucao_avisa_o_cliente: aviso da devolução % não nasceu (%).', NEW.id, SQLERRM;
  END;
  RETURN NEW;
END;
$avisa_o_cliente$;

DROP FUNCTION IF EXISTS public.pedido_reembolsos_e_saldo(uuid);
DROP FUNCTION IF EXISTS public.registrar_estorno_manual_apos_espera(uuid, uuid, text);
DROP FUNCTION IF EXISTS public.admin_devolucao_reembolso_por_fora_apos_espera(uuid, uuid, text);
DROP FUNCTION IF EXISTS public.order_refund__liberavel_apos_espera(uuid);
DROP FUNCTION IF EXISTS public.order_refund__pode_ter_saido(uuid);

GRANT EXECUTE ON FUNCTION public.admin_devolucao_reemitir_reembolso(uuid, boolean) TO authenticated;

DROP TABLE IF EXISTS public.order_refund_prova;

-- CONFERÊNCIA FINAL: os sete corpos voltaram ao de antes, byte a byte (hash); nada novo sobrou; a função antiga
-- voltou a ser do logado.
DO $conferencia_rollback_20261241$
DECLARE
  r record;
  v_hash text;
BEGIN
  FOR r IN
    SELECT * FROM (VALUES
      ('public.pedido__saldo_a_estornar(uuid)', '9579d2b56b57cf948659936a928dd7dc'),
      ('public.solicitar_estorno(uuid,numeric,text)', '069c3d12a470cc4708099d909c57ca02'),
      ('public.admin_devolucao_concluir(uuid,text,jsonb,numeric,text)', '26080db4aeb82bdfb9fcd0c6f7169ebb'),
      ('public.autorizar_post_do_estorno(uuid,numeric)', 'e128f7ad54ebc82c97b97af4aa7baa08'),
      ('public.reemitir_reembolso_da_devolucao(uuid,uuid,uuid,jsonb)', '872fcb1d2bac9816e2d2b1c7c2e868c0'),
      ('public.admin_devolucao_reembolso_por_fora(uuid,uuid)', '0a7e06d7004c3fb70897e87c4dfa8cf9'),
      ('public.devolucao_avisa_o_cliente()', '2cd21f47021cafc15cae4ccd0c8c67e5')
    ) AS esperado(assinatura, hash_antes)
  LOOP
    SELECT md5(replace(p.prosrc, E'\r', '')) INTO v_hash
      FROM pg_proc p WHERE p.oid = to_regprocedure(r.assinatura);
    IF v_hash IS DISTINCT FROM r.hash_antes THEN
      RAISE EXCEPTION 'conferencia rollback 20261241: corpo vivo de % (hash %) não voltou ao de antes (esperado %)', r.assinatura, COALESCE(v_hash, 'ausente'), r.hash_antes;
    END IF;
  END LOOP;

  IF EXISTS (SELECT 1 FROM pg_proc p
              WHERE p.pronamespace = 'public'::regnamespace
                AND p.proname IN ('order_refund__pode_ter_saido', 'order_refund__liberavel_apos_espera',
                                  'pedido_reembolsos_e_saldo',
                                  'admin_devolucao_reembolso_por_fora_apos_espera',
                                  'registrar_estorno_manual_apos_espera'))
     OR to_regclass('public.order_refund_prova') IS NOT NULL THEN
    RAISE EXCEPTION 'conferencia rollback 20261241: sobrou função nova ou a tabela order_refund_prova.';
  END IF;

  IF NOT has_function_privilege('authenticated', 'public.admin_devolucao_reemitir_reembolso(uuid,boolean)', 'EXECUTE') THEN
    RAISE EXCEPTION 'conferencia rollback 20261241: admin_devolucao_reemitir_reembolso não voltou a ser do authenticated.';
  END IF;
END $conferencia_rollback_20261241$;
