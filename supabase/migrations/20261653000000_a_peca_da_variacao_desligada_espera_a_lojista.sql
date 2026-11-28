-- ============================================================================
-- Migration 20261653000000 — a peça que volta para uma variação DESLIGADA espera a lojista (estoque; troca o corpo de DUAS funções,
-- ADITIVA: nenhuma tabela, coluna ou linha é criada, apagada ou reescrita ao aplicar)
-- ============================================================================
--
-- 1. O DEFEITO (caça confirmada, 27/11/2026)
--
-- A lojista não consegue apagar uma variação já vendida (o banco recusa: marketplace_order_items.variant_id é FK sem ON DELETE) e a tela
-- pede para DESLIGAR. Ela desliga o M. Depois o Pix do pedido do M vence, o pedido é cancelado, ou a devolução do M é concluída com "voltar
-- ao estoque": devolver_estoque (corpo da 20261642000000) e admin_devolucao_concluir (corpo da 20261642000000) somam +1 em
-- product_variants.stock_increment do M SEM conferir se ele está ligado. A compra só vende variação ligada
-- (create_marketplace_order_v24) e a vitrine só soma as ligadas: a peça some da venda, e o painel ainda diz "1 unidade voltou ao estoque".
-- A própria 20261642000000 já recusa esse destino na decisão da lojista (resolver_peca_sem_tamanho: "crédito em variação desligada não
-- volta a vender"); só as duas voltas automáticas não recusavam.
--
-- 2. A REGRA NOVA (o MESMO caminho da 20261642000000, nenhum destino novo)
--
-- Item COM variação que, NA HORA da volta, está desligada (active não é true) ou não existe mais passa a ser tratado como item SEM
-- variação, e cai no ramo que a 20261642000000 já criou:
--   - o produto ainda tem alguma variação LIGADA (o MESMO predicado da compra): cada unidade vira UMA linha em public.pecas_sem_tamanho,
--     com o pedido de origem (e o item da devolução, quando veio por ela), e NÃO é creditada; a lojista escolhe no painel em qual tamanho
--     ela entra (resolver_peca_sem_tamanho, que só aceita variação ligada) ou diz que não tem a peça;
--   - o produto NÃO tem nenhuma variação ligada: credita produtos.estoque, o pai (sem variação ligada a compra vende pelo estoque do pai, e
--     a vitrine mostra o do pai: estoque-das-ativas.ts);
--   - sem produto no item: o produto vem do pai da variação (a variação é FK do item, então ela existe).
-- O crédito vai para UM lugar só (a variação ligada, OU o cantinho, OU o pai), e o carimbo de cada volta (stock_returned_at do pedido,
-- reestocado_em do item da devolução) segue igual: repetir não credita de novo e o cancelamento depois de uma devolução (achado C) segue
-- descontando o que ela trouxe. Item com variação LIGADA, item sem variação e item sem produto: comportamento IDÊNTICO ao de hoje.
-- Retornos: devolver_estoque não conta a peça que espera (como na 20261642000000); admin_devolucao_concluir a conta em 'sem_tamanho' e
-- não em 'reestocados' (como na 20261642000000). Nada de dinheiro muda.
--
-- 3. O QUE MUDA NO CORPO DAS DUAS FUNÇÕES (só isto; o resto não muda um byte)
--
--   devolver_estoque (corpo da 20261642000000): um bloco marcado ">>> a peca da variacao desligada (20261653000000)" logo antes do
--   IF/ELSIF/ELSE do crédito: se a variação do item não está ligada, v_item.variant_id vira NULL (e v_item.product_id, se vazio, o pai
--   da variação); o IF/ELSIF/ELSE da 20261642000000 decide o destino.
--   admin_devolucao_concluir (corpo da 20261642000000): o mesmo bloco, com v_di, logo depois de "IF v_reestocar AND v_di.reestocado_em
--   IS NULL THEN".
--   Assinatura, SECURITY DEFINER, VOLATILE, search_path, retorno, comentário, OID, dono e ACL das duas NÃO mudam. As travas: a variação do
--   item e o pai dela JÁ são trancados (FOR NO KEY UPDATE, ordem global) antes do laço nas duas; o "está ligada?" é lido com a variação
--   trancada, então ligar ou desligar ao mesmo tempo espera esta transação.
--
-- 4. DADOS EXISTENTES
--
-- Nenhuma linha é lida para fora, reescrita ou apagada no apply (só CREATE OR REPLACE de duas funções). Créditos que já foram para uma
-- variação desligada ANTES desta migration ficam onde estão (o estoque do M desligado não é mexido; se a lojista religar o M, ele volta a
-- vender com o estoque que tem). Só as voltas DEPOIS do apply seguem a regra nova.
--
-- 5. PRÉ-VOO (B1_BASELINE_DIVERGENT, ANTES de qualquer escrita)
--
-- Recusa se: o corpo vivo de devolver_estoque ou de admin_devolucao_concluir não for o da 20261642000000 nem o desta; os atributos ou a
-- ACL de qualquer uma não forem os de sempre; faltar product_variants (id, product_id, active); a tabela public.pecas_sem_tamanho não
-- existir com a forma da 20261642000000; as RPCs pecas_sem_tamanho_pendentes(uuid) e resolver_peca_sem_tamanho(uuid, uuid) não estiverem
-- no ar com os corpos da 20261642000000 (sem elas a peça que espera não teria como sair do cantinho). Fotografa OID, dono, ACL e atributos
-- das duas funções que mudam para o pós-voo.
--
-- 6. IDEMPOTÊNCIA, TRANSAÇÃO E TRAVA
--
-- CREATE OR REPLACE: rodar duas vezes deixa o mesmo estado (o pré-voo aceita o que esta migration deixa). SEM BEGIN/COMMIT (regra da casa,
-- AGENTS.md: o aplicador dá a transação e o conferirCorpo do aplicar-migrations.yml RECUSA controle de transação no topo do arquivo);
-- pré-voo, troca e pós-voo caem juntos ou não caem. lock_timeout = 5s: CREATE OR REPLACE espera o catálogo; melhor falhar e reaplicar.
--
-- 7. ORDEM
--
-- DEPOIS da 20261642000000 (o pré-voo recusa sem ela). O front não depende desta: o painel já lê 'sem_tamanho' e a lista das peças que
-- esperam desde a 20261642000000; o texto novo do aviso vale para as duas origens.
--
-- 8. FICHA DE VERIFICAÇÃO: consultas 209a (depois) / 209b (antes).
--   PROVA VIVA: tests/banco/a-peca-da-variacao-desligada-viva.cjs (rpc-ci).
--
-- 9. ROLLBACK
--
-- rollback-manual-20261653000000_a_peca_da_variacao_desligada_espera_a_lojista.sql devolve os DOIS corpos da 20261642000000 byte a byte. Não apaga nada:
-- as peças que já foram para o cantinho por esta regra continuam lá, e a lojista as resolve pela mesma tela. Vem ANTES do rollback da
-- 20261642000000 (o pré-voo dele recusa o corpo desta).
-- ============================================================================

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

DO $preflight_20261653000000$
DECLARE
  v_dev oid := to_regprocedure('public.devolver_estoque(uuid)');
  v_concl oid := to_regprocedure('public.admin_devolucao_concluir(uuid,text,jsonb,numeric,text)');
  v_hash text;
  v_forma text;
BEGIN
  -- devolver_estoque: o corpo da 20261642000000 ou o desta; atributos e ACL de sempre (EXECUTE nunca de anon, authenticated nem PUBLIC).
  SELECT md5(replace(prosrc, E'\r', '')) INTO v_hash FROM pg_proc WHERE oid = v_dev;
  IF v_hash IS NULL OR v_hash NOT IN ('80b1a90baf10d1b4c59484772e4864c4', '2913f3178498938d0a79e3b47a1084d1') THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: public.devolver_estoque(uuid) (hash %) nao e o corpo da 20261642000000 nem o desta migration; revise antes de aplicar.', COALESCE(v_hash, 'ausente');
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_language l ON l.oid = p.prolang
     WHERE p.oid = v_dev
       AND p.prokind = 'f' AND p.prosecdef AND p.proconfig = ARRAY['search_path=public']::text[]
       AND p.provolatile = 'v' AND NOT p.proisstrict AND NOT p.proretset
       AND l.lanname = 'plpgsql' AND p.prorettype = 'integer'::regtype
       AND pg_get_function_arguments(p.oid) = 'p_order_id uuid'
       AND (SELECT count(*) FROM pg_proc q WHERE q.pronamespace = 'public'::regnamespace AND q.proname = 'devolver_estoque') = 1
       AND NOT has_function_privilege('anon', p.oid, 'EXECUTE')
       AND NOT has_function_privilege('authenticated', p.oid, 'EXECUTE')
       AND NOT EXISTS (SELECT 1 FROM aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) a
                        WHERE a.grantee = 0 AND a.privilege_type = 'EXECUTE')
  ) THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: devolver_estoque tem assinatura, atributos ou permissoes diferentes dos esperados; revise antes de aplicar.';
  END IF;

  -- admin_devolucao_concluir: o corpo da 20261642000000 ou o desta; atributos e ACL de sempre (authenticated e service_role sim; anon e PUBLIC nao).
  IF v_concl IS NULL
     OR (SELECT count(*) FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname = 'admin_devolucao_concluir') <> 1 THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: admin_devolucao_concluir ausente ou com sobrecarga em public; revise antes de aplicar.';
  END IF;
  SELECT md5(replace(prosrc, E'\r', '')) INTO v_hash FROM pg_proc WHERE oid = v_concl;
  -- anterior = o corpo da 20261642000000; desta = o que ESTA migration deixa (reaplicacao idempotente).
  IF v_hash IS NULL OR v_hash NOT IN (
       SELECT unnest(ARRAY[esperado.anterior, esperado.desta]) FROM (VALUES
         ('public.admin_devolucao_concluir(uuid,text,jsonb,numeric,text)', '1a548896acb8248f1b1771d765c92fcb', 'd146dc7aefb07a0bf580ed7265d9453e')
       ) esperado(assinatura, anterior, desta)) THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: admin_devolucao_concluir (hash %) nao e o corpo da 20261642000000 nem o desta migration; revise antes de aplicar.', COALESCE(v_hash, 'ausente');
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
     )
     OR EXISTS (SELECT 1 FROM pg_proc p
                  CROSS JOIN LATERAL aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) g
                 WHERE p.oid = v_concl AND g.privilege_type = 'EXECUTE' AND g.grantee = 0)
     OR has_function_privilege('anon', v_concl, 'EXECUTE')
     OR NOT has_function_privilege('authenticated', v_concl, 'EXECUTE')
     OR NOT has_function_privilege('service_role', v_concl, 'EXECUTE') THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: admin_devolucao_concluir tem atributos ou ACL diferentes dos conhecidos; revise antes de aplicar.';
  END IF;

  -- As colunas que o bloco novo le (a variacao do item, ligada ou nao, e o pai dela).
  IF (SELECT count(*) FROM pg_attribute a
       WHERE NOT a.attisdropped
         AND ((a.attrelid = to_regclass('public.product_variants') AND a.attname IN ('id', 'product_id') AND a.atttypid = 'uuid'::regtype)
           OR (a.attrelid = to_regclass('public.product_variants') AND a.attname = 'active' AND a.atttypid = 'boolean'::regtype))) <> 3 THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: product_variants (id, product_id, active) nao tem a forma esperada; nada foi alterado.';
  END IF;

  -- O destino da peca que espera: a tabela e as duas RPCs da 20261642000000, exatamente como ela as deixou.
  SELECT string_agg(a.attname || ':' || format_type(a.atttypid, a.atttypmod) || ':' || a.attnotnull::text, ',' ORDER BY a.attname)
    INTO v_forma
    FROM pg_attribute a
   WHERE a.attrelid = to_regclass('public.pecas_sem_tamanho') AND a.attnum > 0 AND NOT a.attisdropped;
  IF v_forma IS DISTINCT FROM 'criada_em:timestamp with time zone:true,devolucao_item_id:uuid:false,id:uuid:true,order_id:uuid:false,order_item_id:uuid:false,origem:text:true,produto_id:uuid:true,resolucao:text:false,resolvida_em:timestamp with time zone:false,resolvida_por:uuid:false,variant_id:uuid:false' THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: public.pecas_sem_tamanho ausente ou com outra forma (%); aplique a 20261642000000 antes.', COALESCE(v_forma, 'ausente');
  END IF;
  IF (SELECT md5(replace(prosrc, E'\r', '')) FROM pg_proc WHERE oid = to_regprocedure('public.pecas_sem_tamanho_pendentes(uuid)'))
       IS DISTINCT FROM 'd6a9047fe26305d0c1446c284033245d'
     OR (SELECT md5(replace(prosrc, E'\r', '')) FROM pg_proc WHERE oid = to_regprocedure('public.resolver_peca_sem_tamanho(uuid,uuid)'))
       IS DISTINCT FROM 'cac3d04d9be77c7d4004003bb70561c5' THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: pecas_sem_tamanho_pendentes ou resolver_peca_sem_tamanho ausente ou com outro corpo; aplique a 20261642000000 antes.';
  END IF;

  -- Fotografia: OID, dono, ACL e TODOS os atributos (o CREATE OR REPLACE so pode trocar o texto).
  PERFORM set_config('ikcous.var653_devolver', (SELECT to_jsonb(p) - 'prosrc' FROM pg_proc p WHERE p.oid = v_dev)::text, true);
  PERFORM set_config('ikcous.var653_concluir', (SELECT to_jsonb(p) - 'prosrc' FROM pg_proc p WHERE p.oid = v_concl)::text, true);
END $preflight_20261653000000$;

-- ---------------------------------------------------------------------------
-- 1. devolver_estoque: o corpo da 20261642000000 + o bloco da variacao desligada
-- ---------------------------------------------------------------------------
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

        -- >>> a peca da variacao desligada (20261653000000)
        -- Item COM variacao que, NA HORA da volta, esta DESLIGADA (ou nao existe mais): a compra so vende variacao ligada, entao o
        -- credito nela deixava a peca fora da venda. O item segue daqui como peca SEM tamanho, pelo caminho da 20261642000000 logo
        -- abaixo: se o produto ainda tem variacao ligada, a peca espera a lojista em pecas_sem_tamanho (e nao conta como creditada);
        -- se nao tem, credita o pai (sem variacao ligada a compra vende pelo estoque do pai). Nunca os dois. O produto vem do item
        -- e, so se ele estiver vazio, do pai da variacao. A variacao e o pai dela ja estao trancados pela ordem global acima.
        IF v_item.variant_id IS NOT NULL
           AND NOT EXISTS (SELECT 1 FROM public.product_variants v
                            WHERE v.id = v_item.variant_id AND v.active = true) THEN
            v_item.product_id := COALESCE(v_item.product_id,
                                          (SELECT v.product_id FROM public.product_variants v WHERE v.id = v_item.variant_id));
            v_item.variant_id := NULL;
        END IF;
        -- <<< a peca da variacao desligada (20261653000000)
        -- IF/ELSE, não dois IF: a v23 debita XOR (variante OU produto, nunca os
        -- dois), e o front manda product_id preenchido junto com variant_id. Com
        -- dois IF, todo pedido de variante que expirasse creditaria o produto pai
        -- também, inflando o catalogo para sempre. Mesma forma do restore que ja
        -- existe em update_order_status_atomic.
        IF v_item.variant_id IS NOT NULL THEN
            UPDATE public.product_variants
               SET stock_increment = stock_increment + v_credito
             WHERE id = v_item.variant_id;
        -- >>> a peca que volta sem tamanho (20261642000000)
        -- Item SEM variacao de um produto que HOJE tem variacao ligada (vendido antes da grade): a compra exige variacao e a
        -- vitrine soma as variacoes, entao o estoque do pai nao vende mais. Cada unidade espera a lojista em pecas_sem_tamanho
        -- (ela escolhe o tamanho no painel) e NAO conta como creditada. Mesmo predicado da compra (variacao com active = true).
        -- O produto ja esta trancado pelo bloco da ordem global acima.
        ELSIF EXISTS (SELECT 1 FROM public.product_variants v
                       WHERE v.product_id = v_item.product_id AND v.active = true) THEN
            INSERT INTO public.pecas_sem_tamanho (produto_id, order_id, order_item_id, origem)
            SELECT v_item.product_id, p_order_id, v_item.id, 'pedido_desfeito'
              FROM generate_series(1, v_credito);
            CONTINUE;
        -- <<< a peca que volta sem tamanho (20261642000000)
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

-- ---------------------------------------------------------------------------
-- 2. admin_devolucao_concluir: o corpo da 20261642000000 + o bloco da variacao desligada
-- ---------------------------------------------------------------------------
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
  -- 20261642000000: unidades que foram para o cantinho das pecas sem tamanho (nao creditadas).
  v_sem_tamanho integer := 0;
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
      -- >>> a peca da variacao desligada (20261653000000)
      -- Item COM variacao que, NA HORA da conclusao, esta DESLIGADA (ou nao existe mais): o credito nela deixava a peca fora da
      -- venda. O item segue como peca SEM tamanho pelo caminho da 20261642000000 logo abaixo (variacao ligada no produto: espera a
      -- lojista em pecas_sem_tamanho e conta em 'sem_tamanho'; nenhuma ligada: credita o pai). O carimbo reestocado_em segue igual.
      -- O produto vem do item e, so se ele estiver vazio, do pai da variacao. A variacao e o pai ja estao trancados acima.
      IF v_di.variant_id IS NOT NULL
         AND NOT EXISTS (SELECT 1 FROM public.product_variants v
                          WHERE v.id = v_di.variant_id AND v.active = true) THEN
        v_di.product_id := COALESCE(v_di.product_id,
                                    (SELECT v.product_id FROM public.product_variants v WHERE v.id = v_di.variant_id));
        v_di.variant_id := NULL;
      END IF;
      -- <<< a peca da variacao desligada (20261653000000)
      IF v_di.variant_id IS NOT NULL THEN
        UPDATE public.product_variants SET stock_increment = stock_increment + v_di.quantidade
         WHERE id = v_di.variant_id;
      -- >>> a peca que volta sem tamanho (20261642000000)
      -- Item SEM variacao de um produto que HOJE tem variacao ligada: o estoque do pai nao vende mais. Cada unidade espera a
      -- lojista em pecas_sem_tamanho; o carimbo reestocado_em abaixo e' gravado do mesmo jeito (a peca VOLTOU, e o cancelamento
      -- posterior do pedido a desconta, achado C). O produto ja esta trancado pelo bloco da ordem global acima.
      ELSIF v_di.product_id IS NOT NULL
            AND EXISTS (SELECT 1 FROM public.product_variants v
                         WHERE v.product_id = v_di.product_id AND v.active = true) THEN
        INSERT INTO public.pecas_sem_tamanho (produto_id, order_id, order_item_id, devolucao_item_id, origem)
        SELECT v_di.product_id, v_d.order_id, v_di.order_item_id, v_di.id, 'devolucao'
          FROM generate_series(1, v_di.quantidade);
        v_sem_tamanho := v_sem_tamanho + v_di.quantidade;
      -- <<< a peca que volta sem tamanho (20261642000000)
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
    'refund_id', v_refund_id, 'reembolso_manual', v_manual,
    -- 20261642000000: 'reestocados' conta so o que voltou A VENDA; as do cantinho vao em 'sem_tamanho'.
    'reestocados', v_reestocados - v_sem_tamanho, 'sem_tamanho', v_sem_tamanho
  );
END;
$$;

-- ---------------------------------------------------------------------------
-- PÓS-VOO (B2_POSTFLIGHT_FAILED): os dois corpos desta, com OID, dono, ACL e atributos de antes
-- ---------------------------------------------------------------------------
DO $posvoo_20261653000000$
DECLARE
  v_dev oid := to_regprocedure('public.devolver_estoque(uuid)');
  v_concl oid := to_regprocedure('public.admin_devolucao_concluir(uuid,text,jsonb,numeric,text)');
BEGIN
  IF (SELECT md5(replace(prosrc, E'\r', '')) FROM pg_proc WHERE oid = v_dev) IS DISTINCT FROM '2913f3178498938d0a79e3b47a1084d1'
     OR (SELECT to_jsonb(p) - 'prosrc' FROM pg_proc p WHERE p.oid = v_dev) IS DISTINCT FROM current_setting('ikcous.var653_devolver')::jsonb THEN
    RAISE EXCEPTION 'B2_POSTFLIGHT_FAILED: devolver_estoque nao ficou com o corpo desta migration ou mudou OID, dono, ACL ou atributos.';
  END IF;
  IF (SELECT md5(replace(prosrc, E'\r', '')) FROM pg_proc WHERE oid = v_concl) IS DISTINCT FROM 'd146dc7aefb07a0bf580ed7265d9453e'
     OR (SELECT to_jsonb(p) - 'prosrc' FROM pg_proc p WHERE p.oid = v_concl) IS DISTINCT FROM current_setting('ikcous.var653_concluir')::jsonb THEN
    RAISE EXCEPTION 'B2_POSTFLIGHT_FAILED: admin_devolucao_concluir nao ficou com o corpo desta migration ou mudou OID, dono, ACL ou atributos.';
  END IF;
END $posvoo_20261653000000$;

-- As funções são chamadas por RPC (a conclusão) e por outras funções: recarrega o schema cache. Idempotente.
NOTIFY pgrst, 'reload schema';
