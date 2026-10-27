-- ============================================================================
-- Migration 20261395200000 — a conclusão da devolução tranca o estoque na mesma ordem da compra (dinheiro e estoque; troca o corpo de UMA função)
-- ============================================================================
--
-- 1. O DEFEITO (caça 9, 26/10/2026; reconfirmado no corpo vivo e provado em duas conexões reais)
--
-- public.admin_devolucao_concluir(p_id, p_resolucao, p_itens, p_valor_reembolso, p_observacao) reestoca os itens recebidos. Ela
-- percorria p_itens NA ORDEM EM QUE O PAINEL MANDOU e, a cada item, fazia UPDATE na variação (e, pelo gatilho
-- sync_produto_ultima_atualizacao, o produto-pai logo depois) ou no produto. Já a compra (create_marketplace_order_v23/v24) e o estoque
-- que volta (devolver_estoque, 20261389100000) travam numa ordem global: primeiro TODAS as variações por id, depois TODOS os produtos
-- por id. Uma conclusão de devolução aberta ao mesmo tempo que uma compra com as mesmas variações, em ordem contrária, cruzava travas:
-- cada lado segurava o que o outro esperava e o banco derrubava um com 40P01 (deadlock detected). Quem sente: a lojista que conclui
-- (a falha chega como erro e ela repete) ou a cliente que fecha a compra ("tente de novo"). Raro (só em pico, com as mesmas peças), sem
-- perda de dinheiro nem de estoque (o banco desfaz o lado derrubado), mas evitável.
--
-- 2. A REGRA NOVA
--
-- Depois das checagens do pedido e ANTES do laço dos itens, a função tranca, na ordem global da compra, as variações dos itens da
-- devolução por id e depois os produtos (os dos itens e os pais das variações) por id, cada grupo num único
-- SELECT ... ORDER BY id FOR NO KEY UPDATE (a mesma força que o UPDATE do crédito tomaria). Só se tranca quando pode haver crédito: pedido
-- com stock_returned_at presente nunca recredita, e item com reestocado_em presente também não. O laço que credita é o da
-- 20261343000000 SEM mexer numa linha: mesma regra, mesmo valor, mesmo retorno. NENHUM cálculo de dinheiro nem de estoque muda; só
-- QUANDO as travas são tomadas. A diferença de trava é só para MAIS (itens que acabam sem crédito, por condição "danificada" ou "ausente",
-- trancam as linhas por instantes — como a compra já faz com todos os itens do carrinho).
--
-- ORDEM GLOBAL DAS TRAVAS DO ESTOQUE (documentada aqui para as próximas migrations): pedido (marketplace_orders) -> variações
-- (product_variants) por id -> produtos (produtos) por id. Quem tranca estoque na casa segue isto: create_marketplace_order_v23/v24
-- (20261350000000/20261384000000), devolver_estoque (20261389100000), salvar_produto_com_grade (20261352000000) e, agora, esta função.
-- RESÍDUO ASSUMIDO (não é desta migration): registrar_venda_presencial (balcão) tranca na ordem do carrinho (pendência já registrada
-- na 20261350000000) e expirar_pedidos_vencidos percorre vários pedidos numa transação só.
--
-- 3. O QUE MUDA NO CORPO (só isto; o resto não muda um byte)
--
-- (a) duas variáveis uuid[] na DECLARE, com 1 linha de comentário; (b) o bloco "ordem global das travas" entre a checagem de pagamento do
-- pedido e o laço dos itens. Assinatura, SECURITY DEFINER, VOLATILE, search_path, retorno jsonb e ACL (authenticated e service_role)
-- NÃO mudam.
--
-- 4. DADOS EXISTENTES
--
-- Nenhuma linha é lida nem reescrita ao aplicar: só o corpo de UMA função muda. Devoluções já concluídas ficam como estão. Aplicar duas
-- vezes deixa o mesmo estado (o pré-voo aceita o corpo vigente OU o desta migration).
--
-- 5. PRÉ-VOO (B1_BASELINE_DIVERGENT, ANTES de qualquer escrita)
--
-- Recusa se: a função não existir ou tiver sobrecarga; o corpo vivo (md5 de replace(prosrc, E'\r', '')) não for UM dos dois conhecidos
-- (o da 20261343000000, ea651d52157521c0fe7ffccc948b4b1a, ou o desta migration, a152c8dcd7cf6d1e05e5aff128d6c45e); os atributos não forem os de sempre; ou a ACL
-- não for EXATAMENTE a de hoje. Fotografa OID, dono, ACL e atributos para o pós-voo.
--
-- 6. TRANSAÇÃO
--
-- Sem BEGIN/COMMIT de nível superior (regra da casa): quem abre a transação é o aplicador.
--
-- 7. ORDEM E ROLLBACK
--
-- Depois da 20261343000000 (o pré-voo recusa sem ela). ROLLBACK MANUAL: rollback-manual-20261395200000_a_conclusao_da_devolucao_tranca_na_mesma_ordem_da_compra.sql devolve o corpo
-- da 20261343000000 byte a byte; vem ANTES do rollback da 20261343000000. As consultas 43a, 67a e 8e aceitam o corpo desta como
-- sucessor.
--
-- 8. FICHA DE VERIFICAÇÃO
--
--   1. SELECT md5(replace(prosrc, E'\r', '')) FROM pg_proc WHERE oid = to_regprocedure('public.admin_devolucao_concluir(uuid,text,jsonb,numeric,text)');
--      -- esperado: a152c8dcd7cf6d1e05e5aff128d6c45e.
--   2. proacl, prosecdef e proconfig iguais antes e depois.
--   PROVA VIVA: tests/banco/a-conclusao-da-devolucao-tranca-na-mesma-ordem-da-compra-viva.cjs (rpc-ci); portão da release: consultas 110a e 110b.
-- ============================================================================

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

DO $preflight_20261395200000$
DECLARE
  v_fn CONSTANT text := 'public.admin_devolucao_concluir(uuid, text, jsonb, numeric, text)';
  v_oid oid := to_regprocedure('public.admin_devolucao_concluir(uuid, text, jsonb, numeric, text)');
  v_hash text;
  v_vigente text;
  v_desta text;
  v_public boolean;
BEGIN
  IF v_oid IS NULL THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: % não existe.', v_fn;
  END IF;
  IF (SELECT count(*) FROM pg_proc p
       WHERE p.pronamespace = 'public'::regnamespace AND p.proname = 'admin_devolucao_concluir') <> 1 THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: admin_devolucao_concluir tem sobrecarga em public — meça a loja e revise antes de aplicar.';
  END IF;

  -- vigente = o corpo da 20261343000000 (até aqui); desta = o que ESTA migration deixa (reaplicação idempotente).
  SELECT anterior, desta INTO v_vigente, v_desta FROM (VALUES
    ('public.admin_devolucao_concluir(uuid,text,jsonb,numeric,text)', 'ea651d52157521c0fe7ffccc948b4b1a', 'a152c8dcd7cf6d1e05e5aff128d6c45e')
  ) esperado(assinatura, anterior, desta);
  SELECT md5(replace(prosrc, E'\r', '')) INTO v_hash FROM pg_proc WHERE oid = v_oid;
  IF v_hash IS NULL OR v_hash NOT IN (v_vigente, v_desta) THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: corpo vivo de % (hash %) não é o vigente (20261343000000) nem o que esta migration deixa — capture o corpo vivo e revise antes de aplicar.', v_fn, COALESCE(v_hash, 'ausente');
  END IF;

  IF NOT EXISTS (
       SELECT 1 FROM pg_proc p JOIN pg_language l ON l.oid = p.prolang
        WHERE p.oid = v_oid
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
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: atributos de % (linguagem, SECURITY DEFINER, volatilidade, search_path, argumentos ou retorno) não são os conhecidos — meça a loja e revise antes de aplicar.', v_fn;
  END IF;

  v_public := EXISTS (SELECT 1 FROM pg_proc p
                        CROSS JOIN LATERAL aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) g
                       WHERE p.oid = v_oid AND g.privilege_type = 'EXECUTE' AND g.grantee = 0);
  IF v_public
     OR has_function_privilege('anon', v_oid, 'EXECUTE')
     OR NOT has_function_privilege('authenticated', v_oid, 'EXECUTE')
     OR NOT has_function_privilege('service_role', v_oid, 'EXECUTE') THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: ACL de % não é a conhecida (authenticated e service_role sim; anon e PUBLIC não) — meça a loja e revise.', v_fn;
  END IF;

  -- Fotografia: OID, dono, ACL e TODOS os atributos (o CREATE OR REPLACE só pode trocar o texto).
  PERFORM set_config('ikcous.concl395_atributos', (SELECT to_jsonb(p) - 'prosrc' FROM pg_proc p WHERE p.oid = v_oid)::text, true);
END $preflight_20261395200000$;

-- admin_devolucao_concluir: o corpo vivo da 20261343000000 + a troca declarada no cabeçalho (item 3).
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

DO $posvoo_20261395200000$
DECLARE
  v_fn CONSTANT text := 'public.admin_devolucao_concluir(uuid, text, jsonb, numeric, text)';
  v_oid oid := to_regprocedure('public.admin_devolucao_concluir(uuid, text, jsonb, numeric, text)');
  v_hash text;
  v_src text;
  v_marca text := '>>> ordem global das travas (20261395200000)';
  v_public boolean;
BEGIN
  IF v_oid IS NULL THEN
    RAISE EXCEPTION 'POSVOO_20261395200000: % sumiu', v_fn;
  END IF;
  SELECT md5(replace(prosrc, E'\r', '')), prosrc INTO v_hash, v_src FROM pg_proc WHERE oid = v_oid;
  IF v_hash IS DISTINCT FROM 'a152c8dcd7cf6d1e05e5aff128d6c45e' THEN
    RAISE EXCEPTION 'POSVOO_20261395200000: corpo vivo (hash %) não é o desta migration', COALESCE(v_hash, 'ausente');
  END IF;
  IF (length(v_src) - length(replace(v_src, v_marca, ''))) / length(v_marca) <> 1 THEN
    RAISE EXCEPTION 'POSVOO_20261395200000: a troca desta migration não aparece exatamente uma vez';
  END IF;
  IF (SELECT count(*) FROM pg_proc p
       WHERE p.pronamespace = 'public'::regnamespace AND p.proname = 'admin_devolucao_concluir') <> 1 THEN
    RAISE EXCEPTION 'POSVOO_20261395200000: admin_devolucao_concluir ficou com sobrecarga';
  END IF;
  IF NOT EXISTS (
       SELECT 1 FROM pg_proc p JOIN pg_language l ON l.oid = p.prolang
        WHERE p.oid = v_oid
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
    RAISE EXCEPTION 'POSVOO_20261395200000: atributos de % mudaram', v_fn;
  END IF;
  v_public := EXISTS (SELECT 1 FROM pg_proc p
                        CROSS JOIN LATERAL aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) g
                       WHERE p.oid = v_oid AND g.privilege_type = 'EXECUTE' AND g.grantee = 0);
  IF v_public
     OR has_function_privilege('anon', v_oid, 'EXECUTE')
     OR NOT has_function_privilege('authenticated', v_oid, 'EXECUTE')
     OR NOT has_function_privilege('service_role', v_oid, 'EXECUTE') THEN
    RAISE EXCEPTION 'POSVOO_20261395200000: ACL de % não é a de sempre', v_fn;
  END IF;
  IF (SELECT to_jsonb(p) - 'prosrc' FROM pg_proc p WHERE p.oid = v_oid) IS DISTINCT FROM current_setting('ikcous.concl395_atributos')::jsonb THEN
    RAISE EXCEPTION 'POSVOO_20261395200000: atributos, dono, OID ou ACL de % mudaram', v_fn;
  END IF;
END $posvoo_20261395200000$;

-- A função é RPC chamada pelo PostgREST: recarrega o schema cache. Idempotente.
NOTIFY pgrst, 'reload schema';
