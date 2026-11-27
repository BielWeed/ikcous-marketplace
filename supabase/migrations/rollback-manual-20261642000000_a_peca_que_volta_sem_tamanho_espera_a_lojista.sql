-- ============================================================================
-- Rollback manual — a peça que volta sem tamanho espera a lojista (20261642000000)
-- ============================================================================
-- Devolve public.devolver_estoque(uuid) ao corpo da 20261389100000 (md5 943b226906e91013e7cccf4992617e35) e
-- public.admin_devolucao_concluir(uuid, text, jsonb, numeric, text) ao corpo da 20261395200000 (md5 a152c8dcd7cf6d1e05e5aff128d6c45e),
-- byte a byte (LF), mantendo OID, dono, atributos, comentário e ACL (CREATE OR REPLACE; nenhum GRANT nem REVOKE nelas). Apaga as duas
-- RPCs novas (pecas_sem_tamanho_pendentes e resolver_peca_sem_tamanho).
--
-- MANTÉM a tabela public.pecas_sem_tamanho COM as linhas: apagar dado é decisão do dono. As peças que ainda esperavam ficam lá, fora
-- da venda e sem tela que as mostre, até a migration ser reaplicada (o pré-voo dela aceita a tabela como está e as peças voltam a
-- aparecer no painel). O NOTICE do fim diz quantas ficaram esperando.
--
-- COM ELE VOLTA O DEFEITO descrito no cabeçalho da migration 20261642000000 (a peça sem tamanho volta para o estoque do pai, que não vende).
--
-- PRÉ-VOO: recusa (B1_BASELINE_DIVERGENT) se algum dos dois corpos vivos não for o desta migration nem o de antes (repetir o rollback é
-- no-op) ou se os atributos não forem os de sempre. O pós-voo recusa se os corpos não voltaram ou se OID, dono, ACL ou atributos mudaram.
--
-- ORDEM: este vem ANTES do rollback da 20261395200000 e do da 20261389100000 (os pré-voos deles recusam o corpo desta). Desfazer o FRONT
-- antes (sem as RPCs, o aviso da peça sem tamanho não carrega). Executar pelo aplicar-migrations.yml (apaga o registro do ledger na
-- mesma transação). Sem BEGIN/COMMIT de nível superior neste arquivo — regra da casa.
-- ============================================================================

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

DO $preflight_rollback_20261642000000$
DECLARE
  v_dev oid := to_regprocedure('public.devolver_estoque(uuid)');
  v_concl oid := to_regprocedure('public.admin_devolucao_concluir(uuid,text,jsonb,numeric,text)');
  v_hash text;
BEGIN
  SELECT md5(replace(prosrc, E'\r', '')) INTO v_hash FROM pg_proc WHERE oid = v_dev;
  IF v_hash IS NULL OR v_hash NOT IN ('80b1a90baf10d1b4c59484772e4864c4', '943b226906e91013e7cccf4992617e35') THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: public.devolver_estoque(uuid) (hash %) nao e o corpo da 20261642000000 nem o da 20261389100000; revise antes de desfazer.', COALESCE(v_hash, 'ausente');
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_language l ON l.oid = p.prolang
     WHERE p.oid = v_dev
       AND p.prokind = 'f' AND p.prosecdef AND p.proconfig = ARRAY['search_path=public']::text[]
       AND p.provolatile = 'v' AND NOT p.proisstrict AND NOT p.proretset
       AND l.lanname = 'plpgsql' AND p.prorettype = 'integer'::regtype
       AND pg_get_function_arguments(p.oid) = 'p_order_id uuid'
       AND (SELECT count(*) FROM pg_proc q WHERE q.pronamespace = 'public'::regnamespace AND q.proname = 'devolver_estoque') = 1
  ) THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: devolver_estoque tem assinatura ou atributos diferentes dos esperados; revise antes de desfazer.';
  END IF;

  IF v_concl IS NULL
     OR (SELECT count(*) FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname = 'admin_devolucao_concluir') <> 1 THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: admin_devolucao_concluir ausente ou com sobrecarga em public; revise antes de desfazer.';
  END IF;
  SELECT md5(replace(prosrc, E'\r', '')) INTO v_hash FROM pg_proc WHERE oid = v_concl;
  -- desfeito = o corpo da 20261395200000 (rollback reaplicado); desta = o que a 20261642000000 deixou.
  IF v_hash IS NULL OR v_hash NOT IN (
       SELECT unnest(ARRAY[esperado.desfeito, esperado.desta]) FROM (VALUES
         ('public.admin_devolucao_concluir(uuid,text,jsonb,numeric,text)', 'a152c8dcd7cf6d1e05e5aff128d6c45e', '1a548896acb8248f1b1771d765c92fcb')
       ) esperado(assinatura, desfeito, desta)) THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: admin_devolucao_concluir (hash %) nao e o corpo da 20261642000000 nem o da 20261395200000; revise antes de desfazer.', COALESCE(v_hash, 'ausente');
  END IF;
  IF NOT EXISTS (
       SELECT 1 FROM pg_proc p JOIN pg_language l ON l.oid = p.prolang
        WHERE p.oid = v_concl
          AND l.lanname = 'plpgsql'
          AND p.prokind = 'f'
          AND p.prosecdef
          AND p.provolatile = 'v'
          AND NOT p.proisstrict
          AND p.pronargs = 5
          AND p.proconfig = ARRAY['search_path=public']::text[]
          AND pg_get_function_arguments(p.oid) = 'p_id uuid, p_resolucao text, p_itens jsonb, p_valor_reembolso numeric DEFAULT NULL::numeric, p_observacao text DEFAULT NULL::text'
          AND pg_get_function_result(p.oid) = 'jsonb'
     ) THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: atributos de admin_devolucao_concluir nao sao os conhecidos; revise antes de desfazer.';
  END IF;

  -- Fotografia: OID, dono, ACL e TODOS os atributos (o CREATE OR REPLACE so pode trocar o texto).
  PERFORM set_config('ikcous.peca642_rb_devolver', (SELECT to_jsonb(p) - 'prosrc' FROM pg_proc p WHERE p.oid = v_dev)::text, true);
  PERFORM set_config('ikcous.peca642_rb_concluir', (SELECT to_jsonb(p) - 'prosrc' FROM pg_proc p WHERE p.oid = v_concl)::text, true);
END $preflight_rollback_20261642000000$;

-- As RPCs novas saem primeiro (nada mais as chama no banco).
DROP FUNCTION IF EXISTS public.resolver_peca_sem_tamanho(uuid, uuid);
DROP FUNCTION IF EXISTS public.pecas_sem_tamanho_pendentes(uuid);

-- devolver_estoque: o corpo da 20261389100000, byte a byte.
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
    v_credito  integer;
    -- 20261389100000: ids a trancar de uma vez, na ordem global (bloco abaixo).
    v_trava_variantes uuid[];
    v_trava_produtos  uuid[];
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

    -- >>> ordem global das travas (20261389100000)
    -- A MESMA ordem da compra (20261350000000): primeiro TODAS as variacoes do pedido, por id; depois TODOS
    -- os produtos, por id, cada grupo num unico SELECT ... ORDER BY id FOR NO KEY UPDATE. Sem isto o laco
    -- abaixo trancava na ORDEM DOS ITENS (produto ou variacao de cada item, e o gatilho
    -- sync_produto_ultima_atualizacao ainda tranca o produto-pai de cada variacao logo depois dela): um
    -- pedido que expira ou cancela com os itens em ordem contraria a de uma compra que acontece ao mesmo
    -- tempo cruzava travas com ela e o banco derrubava um dos dois com 40P01. So muda QUANDO as travas sao
    -- tomadas, nunca quais linhas se alteram nem quanto se credita: o laco seguinte acha tudo ja trancado.
    -- Os produtos a trancar sao os dos itens e os pais das variacoes (e' o que o gatilho tocaria).
    SELECT COALESCE(array_agg(DISTINCT oi.variant_id) FILTER (WHERE oi.variant_id IS NOT NULL), ARRAY[]::uuid[])
      INTO v_trava_variantes
      FROM public.marketplace_order_items oi
     WHERE oi.order_id = p_order_id;

    IF cardinality(v_trava_variantes) > 0 THEN
        PERFORM 1
          FROM public.product_variants v
         WHERE v.id = ANY(v_trava_variantes)
         ORDER BY v.id
           FOR NO KEY UPDATE;
    END IF;

    SELECT COALESCE(array_agg(DISTINCT x.product_id) FILTER (WHERE x.product_id IS NOT NULL), ARRAY[]::uuid[])
      INTO v_trava_produtos
      FROM (
            SELECT oi.product_id
              FROM public.marketplace_order_items oi
             WHERE oi.order_id = p_order_id
            UNION
            SELECT v.product_id
              FROM public.product_variants v
             WHERE v.id = ANY(v_trava_variantes)
           ) x;

    IF cardinality(v_trava_produtos) > 0 THEN
        PERFORM 1
          FROM public.produtos p
         WHERE p.id = ANY(v_trava_produtos)
         ORDER BY p.id
           FOR NO KEY UPDATE;
    END IF;
    -- <<< ordem global das travas (20261389100000)

    FOR v_item IN
        SELECT oi.id, oi.product_id, oi.variant_id, oi.quantity,
               -- Achado C: o que uma devolução já concluída reestocou deste
               -- MESMO item de pedido não credita de novo aqui.
               COALESCE((SELECT sum(di.quantidade) FROM public.devolucao_itens di
                           WHERE di.order_item_id = oi.id AND di.reestocado_em IS NOT NULL), 0) AS ja_reestocado
        FROM public.marketplace_order_items oi
        WHERE oi.order_id = p_order_id
    LOOP
        v_credito := GREATEST(v_item.quantity - v_item.ja_reestocado, 0);
        IF v_credito = 0 THEN
            CONTINUE;
        END IF;

        -- IF/ELSE, não dois IF: a v23 debita XOR (variante OU produto, nunca os
        -- dois), e o front manda product_id preenchido junto com variant_id. Com
        -- dois IF, todo pedido de variante que expirasse creditaria o produto pai
        -- também, inflando o catalogo para sempre. Mesma forma do restore que ja
        -- existe em update_order_status_atomic.
        IF v_item.variant_id IS NOT NULL THEN
            UPDATE public.product_variants
               SET stock_increment = stock_increment + v_credito
             WHERE id = v_item.variant_id;
        ELSE
            UPDATE public.produtos
               SET estoque = estoque + v_credito
             WHERE id = v_item.product_id;
        END IF;

        v_unidades := v_unidades + v_credito;
    END LOOP;

    RETURN v_unidades;
END;
$devolver$;

-- admin_devolucao_concluir: o corpo da 20261395200000, byte a byte.
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
  v_pago_pelo_app boolean;
  v_refund_id uuid;
  v_manual boolean := false;
  -- 20261395200000: ids a trancar de uma vez, na ordem global (bloco abaixo).
  v_trava_variantes uuid[];
  v_trava_produtos uuid[];
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

  -- >>> ordem global das travas (20261395200000)
  -- A MESMA ordem da compra (create_marketplace_order_v23/v24) e do estoque que volta (devolver_estoque, 20261389100000): primeiro
  -- TODAS as variacoes, por id, depois TODOS os produtos, por id, cada grupo num unico SELECT ... ORDER BY id FOR NO KEY UPDATE.
  -- O laco abaixo trancava na ORDEM EM QUE O PAINEL MANDOU os itens (a variacao de cada item e, pelo gatilho
  -- sync_produto_ultima_atualizacao, o produto-pai logo depois): uma compra aberta ao mesmo tempo, com as mesmas variacoes, cruzava
  -- travas com esta conclusao e o banco derrubava uma das duas com 40P01. So muda QUANDO as travas sao tomadas, nunca quais linhas
  -- se alteram nem quanto se credita: o laco seguinte acha tudo ja trancado. So se tranca o que o laco PODE creditar: pedido com o
  -- carimbo stock_returned_at nunca recredita (v_reestocar sai falso) e item ja reestocado tambem nao.
  IF v_o.stock_returned_at IS NULL THEN
    SELECT COALESCE(array_agg(DISTINCT di.variant_id) FILTER (WHERE di.variant_id IS NOT NULL), ARRAY[]::uuid[])
      INTO v_trava_variantes
      FROM public.devolucao_itens di
     WHERE di.devolucao_id = p_id AND di.reestocado_em IS NULL;
    IF cardinality(v_trava_variantes) > 0 THEN
      PERFORM 1
        FROM public.product_variants v
       WHERE v.id = ANY(v_trava_variantes)
       ORDER BY v.id
         FOR NO KEY UPDATE;
    END IF;
    SELECT COALESCE(array_agg(DISTINCT x.product_id) FILTER (WHERE x.product_id IS NOT NULL), ARRAY[]::uuid[])
      INTO v_trava_produtos
      FROM (
            SELECT di.product_id
              FROM public.devolucao_itens di
             WHERE di.devolucao_id = p_id AND di.reestocado_em IS NULL
            UNION
            SELECT v.product_id
              FROM public.product_variants v
             WHERE v.id = ANY(v_trava_variantes)
           ) x;
    IF cardinality(v_trava_produtos) > 0 THEN
      PERFORM 1
        FROM public.produtos p
       WHERE p.id = ANY(v_trava_produtos)
       ORDER BY p.id
         FOR NO KEY UPDATE;
    END IF;
  END IF;
  -- <<< ordem global das travas (20261395200000)

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

    -- Mesma reserva nos dois caminhos, inclusive contestacao em processamento.
    -- Passar de 180 dias muda quem devolve, nunca o saldo ainda disponivel.
    v_disponivel := public.pedido__saldo_a_estornar(v_o.id);
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
          RAISE EXCEPTION 'O reembolso (R$ %) passa do que ainda pode ser devolvido deste pedido (R$ %).',
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

DO $posvoo_rollback_20261642000000$
DECLARE
  v_dev oid := to_regprocedure('public.devolver_estoque(uuid)');
  v_concl oid := to_regprocedure('public.admin_devolucao_concluir(uuid,text,jsonb,numeric,text)');
  v_esperando bigint;
BEGIN
  IF (SELECT md5(replace(prosrc, E'\r', '')) FROM pg_proc WHERE oid = v_dev) IS DISTINCT FROM '943b226906e91013e7cccf4992617e35'
     OR (SELECT to_jsonb(p) - 'prosrc' FROM pg_proc p WHERE p.oid = v_dev) IS DISTINCT FROM current_setting('ikcous.peca642_rb_devolver')::jsonb THEN
    RAISE EXCEPTION 'B2_POSTFLIGHT_FAILED: devolver_estoque nao voltou ao corpo da 20261389100000 ou mudou OID, dono, ACL ou atributos.';
  END IF;
  IF (SELECT md5(replace(prosrc, E'\r', '')) FROM pg_proc WHERE oid = v_concl) IS DISTINCT FROM 'a152c8dcd7cf6d1e05e5aff128d6c45e'
     OR (SELECT to_jsonb(p) - 'prosrc' FROM pg_proc p WHERE p.oid = v_concl) IS DISTINCT FROM current_setting('ikcous.peca642_rb_concluir')::jsonb THEN
    RAISE EXCEPTION 'B2_POSTFLIGHT_FAILED: admin_devolucao_concluir nao voltou ao corpo da 20261395200000 ou mudou OID, dono, ACL ou atributos.';
  END IF;
  IF to_regprocedure('public.pecas_sem_tamanho_pendentes(uuid)') IS NOT NULL
     OR to_regprocedure('public.resolver_peca_sem_tamanho(uuid,uuid)') IS NOT NULL THEN
    RAISE EXCEPTION 'B2_POSTFLIGHT_FAILED: as RPCs da 20261642000000 continuam no banco.';
  END IF;
  IF to_regclass('public.pecas_sem_tamanho') IS NOT NULL THEN
    EXECUTE 'SELECT count(*) FROM public.pecas_sem_tamanho WHERE resolvida_em IS NULL' INTO v_esperando;
    RAISE NOTICE 'rollback 20261642000000: % peca(s) sem tamanho ainda esperando a lojista ficam em public.pecas_sem_tamanho (fora da venda) ate reaplicar a migration.', v_esperando;
  END IF;
END $posvoo_rollback_20261642000000$;

NOTIFY pgrst, 'reload schema';
