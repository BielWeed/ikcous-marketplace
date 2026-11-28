-- ============================================================================
-- Migration 20261659000000 — a peça de produto EXCLUÍDO fica fora do estoque, e o vale-troca não é dinheiro no ranking de lucro
-- (decisões do sócio, 28/11/2026; estoque e leitura do lucro; troca o corpo de QUATRO funções; ADITIVA: nenhuma tabela, coluna ou
-- linha é criada, apagada ou reescrita ao aplicar)
-- ============================================================================
--
-- 1. OS DEFEITOS
--
-- (a) Peça de produto EXCLUÍDO. A lojista exclui um produto (produtos.deleted_at preenchido: ele some do painel e da vitrine). Depois o
--     Pix de um pedido dele vence, o pedido é cancelado, ou a devolução de uma peça dele é concluída com "voltar ao estoque":
--     devolver_estoque (corpo da 20261657000000) e admin_devolucao_concluir (corpo da 20261657000000) somam +1 no estoque do produto
--     excluído (ou da variação dele), ou põem a peça em pecas_sem_tamanho esperando a lojista escolher um tamanho de um produto que ela
--     não vê. O painel diz "voltou ao estoque", mas a peça não volta a vender nunca. resolver_peca_sem_tamanho (corpo da
--     20261642000000) ainda aceita pôr a peça num tamanho do produto excluído.
-- (b) Ranking "Produtos que mais dão lucro" com vale-troca. get_admin_analytics_v2 (corpo da 20261399995000) desconta o valor das peças
--     do vale como se fosse dinheiro devolvido. O Financeiro (fin_dre) não: o vale é crédito na loja, nenhum dinheiro saiu. R$ 100
--     entraram, a blusa voltou por vale e a calça (custo R$ 50) saiu paga com o cupom do vale: o Financeiro dá +R$ 50 e o ranking dava
--     -R$ 50.
--
-- 2. A REGRA NOVA (decisões do sócio, 28/11/2026)
--
-- (a) A peça de produto excluído (o produto do item, ou o pai da variação, com deleted_at preenchido NA HORA da volta) NÃO volta ao
--     estoque e NÃO entra em pecas_sem_tamanho:
--       - devolver_estoque (cancelamento / Pix vencido): pula o item sem creditar e sem contar no retorno; o carimbo stock_returned_at
--         do pedido segue igual (repetir não credita).
--       - admin_devolucao_concluir: a marca "a peça voltou para a loja" (devolucao_itens.reestocado_em) CONTINUA gravada (a peça está
--         fisicamente com a lojista: os relatórios contam o custo recuperado, igual ao Financeiro no cancelamento, e o cancelamento
--         depois a desconta, achado C, sem contar duas vezes); a quantidade vai num campo NOVO da resposta, 'fora_do_estoque', e
--         'reestocados' passa a contar só o que voltou à venda.
--       - resolver_peca_sem_tamanho: recusa (22023) pôr a peça num tamanho de produto excluído; "não tenho essa peça" segue aceito
--         (é por ele que a peça que já esperava sai da lista).
-- (b) get_admin_analytics_v2: na devolução concluída por vale, o dinheiro devolvido é 0 (só o dinheiro que de fato saiu). As peças do
--     vale continuam na quantidade devolvida e no custo que volta (reestocadas). As DUAS cópias da conta mudam juntas (o ranking e o
--     lucro do gráfico diário).
--
-- 3. O QUE MUDA EM CADA CORPO (só isto; o resto não muda um byte)
--
--   devolver_estoque (corpo da 20261657000000): um bloco ">>> a peca de produto excluido (20261659000000)" logo ANTES do bloco da
--   variação desligada da 20261653000000 (com o sub-bloco do produto todo desligado da 20261657000000 dentro dele) (CONTINUE).
--   admin_devolucao_concluir (corpo da 20261657000000): a variável v_fora_do_estoque; o mesmo bloco logo depois de "IF v_reestocar AND
--   v_di.reestocado_em IS NULL THEN" (conta e zera produto e variação locais, então nenhum ramo de crédito roda e o carimbo segue); a
--   resposta ganha 'fora_do_estoque' e 'reestocados' desconta essas unidades.
--   resolver_peca_sem_tamanho (corpo da 20261642000000): a recusa, dentro de "IF p_variant_id IS NOT NULL", antes da do tamanho desligado.
--   get_admin_analytics_v2 (corpo da 20261399995000): nas DUAS cópias do CTE devs, "CASE WHEN dv.resolucao_final = 'vale' THEN 0" antes
--   do reembolso, e o comentário do vale.
--   Assinatura, SECURITY DEFINER, VOLATILE, search_path, retorno, comentário, OID, dono e ACL das quatro NÃO mudam (CREATE OR REPLACE; o
--   pós-voo compara com a fotografia do pré-voo). As travas: o produto de cada item e o pai de cada variação já são trancados (FOR NO KEY
--   UPDATE, ordem global) antes do laço em devolver_estoque e admin_devolucao_concluir, e o produto da peça em resolver_peca_sem_tamanho;
--   o "está excluído?" é lido com o produto trancado, então excluir ao mesmo tempo espera esta transação.
--
-- 4. DADOS EXISTENTES
--
-- Nenhuma linha é lida para reescrita, reescrita ou apagada no apply (só CREATE OR REPLACE de quatro funções). O estoque que já foi
-- creditado num produto excluído ANTES desta migration fica onde está (se a lojista restaurar o produto, ele volta a vender com o estoque
-- que tem). As peças de produto excluído que já estão em pecas_sem_tamanho continuam lá: a lojista as tira com "não tenho essa peça".
-- Só as voltas DEPOIS do apply seguem a regra nova. O lucro MOSTRADO no ranking e no gráfico muda também no passado para as devoluções
-- concluídas por vale (nada se grava; o rollback devolve o número de antes).
--
-- 5. PRÉ-VOO (B1_BASELINE_DIVERGENT, ANTES de qualquer escrita)
--
-- Recusa se: alguma das quatro faltar ou tiver sobrecarga; o corpo vivo de alguma não for o vigente (20261657000000 para as duas do
-- estoque, 20261642000000 para a decisão da peça, 20261399995000 para o painel) nem o desta; atributos ou ACL diferentes dos de sempre;
-- faltar produtos.deleted_at ou product_variants (id, product_id). Fotografa OID, dono, ACL e atributos das quatro para o pós-voo.
--
-- 6. IDEMPOTÊNCIA, TRANSAÇÃO E TRAVA
--
-- CREATE OR REPLACE: rodar duas vezes deixa o mesmo estado (o pré-voo aceita o que esta migration deixa). SEM BEGIN/COMMIT (regra da casa,
-- AGENTS.md: o aplicador dá a transação e o conferirCorpo do aplicar-migrations.yml RECUSA controle de transação no topo do arquivo);
-- pré-voo, troca e pós-voo caem juntos ou não caem. lock_timeout = 5s: CREATE OR REPLACE espera o
-- catálogo; melhor falhar e reaplicar.
--
-- 7. ORDEM
--
-- DEPOIS da 20261657000000 e da 20261399995000 (o pré-voo recusa sem elas). Banco antes do front: o painel lê 'fora_do_estoque' como
-- ausente = 0 (loja sem esta segue mostrando o que mostrava).
--
-- 8. FICHA DE VERIFICAÇÃO: consultas 215a (depois) / 215b (antes).
--   PROVA VIVA: tests/banco/a-peca-de-produto-excluido-viva.cjs (rpc-ci).
--
-- 9. ROLLBACK
--
-- rollback-manual-20261659000000_a_peca_de_produto_excluido_fica_fora_e_o_vale_nao_e_dinheiro.sql devolve os QUATRO corpos anteriores byte a byte (os da 20261657000000, da 20261642000000 e da 20261399995000). Não
-- apaga nenhuma linha. Vem ANTES do rollback da 20261657000000 e do da 20261399995000 (o pré-voo deles recusa o corpo desta).
-- ============================================================================

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

DO $preflight_20261659000000$
DECLARE
  v_dev oid := to_regprocedure('public.devolver_estoque(uuid)');
  v_concl oid := to_regprocedure('public.admin_devolucao_concluir(uuid,text,jsonb,numeric,text)');
  v_res oid := to_regprocedure('public.resolver_peca_sem_tamanho(uuid,uuid)');
  v_ana oid := to_regprocedure('public.get_admin_analytics_v2(integer)');
  v_hash text;
  r record;
BEGIN
  -- Uma so de cada nome em public (sem sobrecarga), e as quatro presentes.
  IF v_dev IS NULL OR v_concl IS NULL OR v_res IS NULL OR v_ana IS NULL
     OR (SELECT count(*) FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace
           AND p.proname IN ('devolver_estoque', 'admin_devolucao_concluir', 'resolver_peca_sem_tamanho', 'get_admin_analytics_v2')) <> 4 THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: devolver_estoque, admin_devolucao_concluir, resolver_peca_sem_tamanho ou get_admin_analytics_v2 ausente ou com sobrecarga em public; revise antes de aplicar.';
  END IF;

  -- Corpo vivo: o vigente (a) ou o desta (b, reaplicacao idempotente). Recusa tambem redefinicao posterior.
  FOR r IN
    SELECT * FROM (VALUES
      ('public.devolver_estoque(uuid)', 'c98a1d49d63e0174f4bdd95dcffc54f4', 'e42582a472fd79ba987c11f161ad9a7a'),
      ('public.admin_devolucao_concluir(uuid,text,jsonb,numeric,text)', 'b55bf2488a1d5165afddaa4d103d3e18', '9ec7a021b965b7abdc77bc4b2b900c35'),
      ('public.resolver_peca_sem_tamanho(uuid,uuid)', 'cac3d04d9be77c7d4004003bb70561c5', '115378a67cd4f89b73129aeec4c46a7f'),
      ('public.get_admin_analytics_v2(integer)', '4f8fb94f6cb0018e10d0ef71541f1cbf', '1624212a7096b6f49a80370b30191a15')
    ) AS esperado(assinatura, hash_a, hash_b)
  LOOP
    SELECT md5(replace(prosrc, E'\r', '')) INTO v_hash FROM pg_proc WHERE oid = to_regprocedure(r.assinatura);
    IF v_hash IS NULL OR v_hash NOT IN (r.hash_a, r.hash_b) THEN
      RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: corpo vivo de % (hash %) nao e o vigente nem o desta migration; revise antes de aplicar.', r.assinatura, COALESCE(v_hash, 'ausente');
    END IF;
  END LOOP;

  -- Atributos de sempre das quatro: plpgsql, SECURITY DEFINER, VOLATILE, nao STRICT, search_path=public, a assinatura e o retorno.
  IF NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_language l ON l.oid = p.prolang
                  WHERE p.oid = v_dev AND p.prokind = 'f' AND l.lanname = 'plpgsql' AND p.prosecdef AND p.provolatile = 'v'
                    AND NOT p.proisstrict AND NOT p.proretset AND p.proconfig = ARRAY['search_path=public']::text[]
                    AND p.prorettype = 'integer'::regtype AND pg_get_function_arguments(p.oid) = 'p_order_id uuid')
     OR NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_language l ON l.oid = p.prolang
                  WHERE p.oid = v_concl AND p.prokind = 'f' AND l.lanname = 'plpgsql' AND p.prosecdef AND p.provolatile = 'v'
                    AND NOT p.proisstrict AND NOT p.proretset AND p.proconfig = ARRAY['search_path=public']::text[]
                    AND pg_get_function_result(p.oid) = 'jsonb'
                    AND pg_get_function_arguments(p.oid) = 'p_id uuid, p_resolucao text, p_itens jsonb, p_valor_reembolso numeric DEFAULT NULL::numeric, p_observacao text DEFAULT NULL::text')
     OR NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_language l ON l.oid = p.prolang
                  WHERE p.oid = v_res AND p.prokind = 'f' AND l.lanname = 'plpgsql' AND p.prosecdef AND p.provolatile = 'v'
                    AND NOT p.proisstrict AND NOT p.proretset AND p.proconfig = ARRAY['search_path=public']::text[]
                    AND pg_get_function_result(p.oid) = 'jsonb' AND pg_get_function_arguments(p.oid) = 'p_peca_id uuid, p_variant_id uuid')
     OR NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_language l ON l.oid = p.prolang
                  WHERE p.oid = v_ana AND p.prokind = 'f' AND l.lanname = 'plpgsql' AND p.prosecdef AND p.provolatile = 'v'
                    AND NOT p.proisstrict AND NOT p.proretset AND p.proconfig = ARRAY['search_path=public']::text[]
                    AND pg_get_function_result(p.oid) = 'json' AND pg_get_function_arguments(p.oid) = 'p_limit_days integer DEFAULT 90') THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: assinatura ou atributos de uma das quatro funcoes nao sao os conhecidos; revise antes de aplicar.';
  END IF;

  -- ACL de sempre: EXECUTE nunca de PUBLIC nem de anon; devolver_estoque so do dono (nem authenticated); a conclusao e o painel
  -- (analytics) tambem do service_role; a decisao da peca so do authenticated.
  IF EXISTS (SELECT 1 FROM pg_proc p CROSS JOIN LATERAL aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) g
              WHERE p.oid IN (v_dev, v_concl, v_res, v_ana) AND g.privilege_type = 'EXECUTE' AND g.grantee = 0)
     OR has_function_privilege('anon', v_dev, 'EXECUTE') OR has_function_privilege('authenticated', v_dev, 'EXECUTE')
     OR has_function_privilege('anon', v_concl, 'EXECUTE') OR NOT has_function_privilege('authenticated', v_concl, 'EXECUTE')
     OR NOT has_function_privilege('service_role', v_concl, 'EXECUTE')
     OR has_function_privilege('anon', v_res, 'EXECUTE') OR NOT has_function_privilege('authenticated', v_res, 'EXECUTE')
     OR has_function_privilege('service_role', v_res, 'EXECUTE')
     OR has_function_privilege('anon', v_ana, 'EXECUTE') OR NOT has_function_privilege('authenticated', v_ana, 'EXECUTE')
     OR NOT has_function_privilege('service_role', v_ana, 'EXECUTE') THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: o EXECUTE de uma das quatro funcoes nao e o conhecido; revise antes de aplicar.';
  END IF;

  -- As colunas que os blocos novos leem: o produto excluido e o pai da variacao.
  IF (SELECT count(*) FROM pg_attribute a
       WHERE NOT a.attisdropped AND a.attnum > 0
         AND ((a.attrelid = to_regclass('public.produtos') AND a.attname IN ('id', 'deleted_at'))
           OR (a.attrelid = to_regclass('public.product_variants') AND a.attname IN ('id', 'product_id')))) <> 4 THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: produtos (id, deleted_at) ou product_variants (id, product_id) nao tem a forma esperada; nada foi alterado.';
  END IF;

  -- Fotografia: OID, dono, ACL e TODOS os atributos (o CREATE OR REPLACE so pode trocar o texto).
  PERFORM set_config('ikcous.excl659_dev', (SELECT to_jsonb(p) - 'prosrc' FROM pg_proc p WHERE p.oid = v_dev)::text, true);
  PERFORM set_config('ikcous.excl659_concl', (SELECT to_jsonb(p) - 'prosrc' FROM pg_proc p WHERE p.oid = v_concl)::text, true);
  PERFORM set_config('ikcous.excl659_res', (SELECT to_jsonb(p) - 'prosrc' FROM pg_proc p WHERE p.oid = v_res)::text, true);
  PERFORM set_config('ikcous.excl659_ana', (SELECT to_jsonb(p) - 'prosrc' FROM pg_proc p WHERE p.oid = v_ana)::text, true);
END $preflight_20261659000000$;

-- ---------------------------------------------------------------------------
-- 1. devolver_estoque: o corpo da 20261657000000 + o bloco do produto excluido
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

        -- >>> a peca de produto excluido (20261659000000)
        -- O produto do item, ou o pai da variacao, foi EXCLUIDO (deleted_at preenchido): a lojista nao ve nem vende mais esse
        -- produto, entao a peca NAO volta ao estoque dele e NAO espera a lojista em pecas_sem_tamanho. Pula o item sem creditar e sem
        -- contar no retorno; o carimbo stock_returned_at do pedido (acima) segue igual, entao repetir nao credita depois. O produto do
        -- item e o pai da variacao ja estao trancados pela ordem global acima: excluir ao mesmo tempo espera esta transacao.
        IF EXISTS (SELECT 1 FROM public.produtos p
                    WHERE p.deleted_at IS NOT NULL
                      AND (p.id = v_item.product_id
                           OR p.id = (SELECT v.product_id FROM public.product_variants v WHERE v.id = v_item.variant_id))) THEN
            CONTINUE;
        END IF;
        -- <<< a peca de produto excluido (20261659000000)
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
            -- >>> o produto todo desligado (20261657000000)
            -- So vira peca SEM tamanho se o produto ainda tem variacao LIGADA (o MESMO predicado do ELSIF da 642 logo abaixo): ai
            -- ela espera a lojista no cantinho. Com TODAS desligadas o ELSE creditava o PAI, e produto sem variacao ligada a compra
            -- vende pelo pai: a peca voltava a venda sozinha, sem tamanho e pelo preco do pai. Ela fica na propria variacao
            -- desligada (como antes da 20261653000000): o produto segue esgotado e a peca espera a lojista religar o tamanho. O
            -- produto sem variacao nenhuma nao passa por aqui (variant_id nulo) e segue creditando o pai.
            IF EXISTS (SELECT 1 FROM public.product_variants v
                        WHERE v.product_id = v_item.product_id AND v.active = true) THEN
                v_item.variant_id := NULL;
            END IF;
            -- <<< o produto todo desligado (20261657000000)
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
-- 2. admin_devolucao_concluir: o corpo da 20261657000000 + o bloco do produto excluido e 'fora_do_estoque'
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
  -- 20261659000000: unidades de produto EXCLUIDO (voltaram para a loja, mas nao para o estoque nem para o cantinho).
  v_fora_do_estoque integer := 0;
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
      -- >>> a peca de produto excluido (20261659000000)
      -- O produto do item, ou o pai da variacao, foi EXCLUIDO (deleted_at preenchido): a peca voltou para a loja (o carimbo
      -- reestocado_em abaixo e' gravado do mesmo jeito: o custo volta nos relatorios e o cancelamento depois a desconta, achado C), mas
      -- NAO volta ao estoque do produto excluido nem espera a lojista em pecas_sem_tamanho. Conta em 'fora_do_estoque', nunca em
      -- 'reestocados'. Sem produto e sem variacao, nenhum ramo de credito abaixo roda. O produto e o pai ja estao trancados acima.
      IF EXISTS (SELECT 1 FROM public.produtos p
                  WHERE p.deleted_at IS NOT NULL
                    AND (p.id = v_di.product_id
                         OR p.id = (SELECT v.product_id FROM public.product_variants v WHERE v.id = v_di.variant_id))) THEN
        v_fora_do_estoque := v_fora_do_estoque + v_di.quantidade;
        v_di.product_id := NULL;
        v_di.variant_id := NULL;
      END IF;
      -- <<< a peca de produto excluido (20261659000000)
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
        -- >>> o produto todo desligado (20261657000000)
        -- So vira peca SEM tamanho se o produto ainda tem variacao LIGADA (o MESMO predicado do ELSIF da 642 logo abaixo): ai ela
        -- espera a lojista no cantinho e conta em 'sem_tamanho'. Com TODAS desligadas o ELSIF do pai creditava produtos.estoque, e
        -- produto sem variacao ligada a compra vende pelo pai: a peca voltava a venda sozinha, sem tamanho. Ela fica na propria
        -- variacao desligada (como antes da 20261653000000) e espera a lojista religar o tamanho. O item sem variacao nenhuma nao
        -- passa por aqui e segue creditando o pai.
        IF EXISTS (SELECT 1 FROM public.product_variants v
                    WHERE v.product_id = v_di.product_id AND v.active = true) THEN
          v_di.variant_id := NULL;
        END IF;
        -- <<< o produto todo desligado (20261657000000)
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
    -- 20261659000000: as de produto excluido vao em 'fora_do_estoque' (voltaram para a loja, nao para a venda).
    'reestocados', v_reestocados - v_sem_tamanho - v_fora_do_estoque, 'sem_tamanho', v_sem_tamanho,
    'fora_do_estoque', v_fora_do_estoque
  );
END;
$$;

-- ---------------------------------------------------------------------------
-- 3. resolver_peca_sem_tamanho: o corpo da 20261642000000 + a recusa do produto excluido
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.resolver_peca_sem_tamanho(p_peca_id uuid, p_variant_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $resolver$
DECLARE
  v_produto uuid;
  v_variante public.product_variants%ROWTYPE;
  v_peca public.pecas_sem_tamanho%ROWTYPE;
  v_estoque integer;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Acesso negado.' USING ERRCODE = '42501';
  END IF;
  -- Papel ATUAL (auth.users E profiles), não o do JWT: admin rebaixado para aqui (20261197000000).
  IF NOT public.is_admin_atual() THEN
    RAISE EXCEPTION 'Acesso negado.' USING ERRCODE = '42501';
  END IF;
  IF p_peca_id IS NULL THEN
    RAISE EXCEPTION 'Informe a peça.' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_peca FROM public.pecas_sem_tamanho WHERE id = p_peca_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Peça não encontrada.' USING ERRCODE = 'P0002';
  END IF;
  v_produto := v_peca.produto_id;

  -- Ordem global das travas do estoque (20261395200000): variação -> produto; a linha da peça por último. Peça já resolvida
  -- (nunca volta a pendente) não tranca nada: cai direto na resposta abaixo, mesmo que o tamanho escolhido tenha sumido depois.
  IF v_peca.resolvida_em IS NULL THEN
    IF p_variant_id IS NOT NULL THEN
      SELECT * INTO v_variante FROM public.product_variants WHERE id = p_variant_id FOR NO KEY UPDATE;
      IF NOT FOUND OR v_variante.product_id IS DISTINCT FROM v_produto THEN
        RAISE EXCEPTION 'Esse tamanho não é deste produto.' USING ERRCODE = '22023';
      END IF;
    END IF;
    PERFORM 1 FROM public.produtos WHERE id = v_produto FOR NO KEY UPDATE;
    SELECT * INTO v_peca FROM public.pecas_sem_tamanho WHERE id = p_peca_id FOR UPDATE;
  END IF;

  -- Dois toques (ou duas abas): a segunda chamada chega aqui depois que a primeira gravou (esperou a trava da variação ou da
  -- peça) e devolve a decisão que já existe, sem creditar.
  IF v_peca.resolvida_em IS NOT NULL THEN
    RETURN jsonb_build_object(
      'id', v_peca.id, 'resolucao', v_peca.resolucao, 'variant_id', v_peca.variant_id,
      'ja_resolvida', true,
      'pendentes', (SELECT count(*) FROM public.pecas_sem_tamanho
                     WHERE produto_id = v_produto AND resolvida_em IS NULL)
    );
  END IF;

  IF p_variant_id IS NOT NULL THEN
    -- >>> a peca de produto excluido (20261659000000)
    -- Produto EXCLUIDO (deleted_at preenchido): a lojista nao vende mais esse produto, entao a peca nao entra em tamanho nenhum dele.
    -- "Nao tenho essa peca" (p_variant_id NULL) continua aceito: e' por ele que a peca sai da lista. O produto ja esta trancado acima.
    IF EXISTS (SELECT 1 FROM public.produtos p WHERE p.id = v_produto AND p.deleted_at IS NOT NULL) THEN
      RAISE EXCEPTION 'Esse produto foi excluído, então a peça não volta ao estoque. Marque que você não tem a peça.' USING ERRCODE = '22023';
    END IF;
    -- <<< a peca de produto excluido (20261659000000)
    -- A compra só aceita variação ligada: crédito em variação desligada não volta a vender.
    IF v_variante.active IS NOT TRUE THEN
      RAISE EXCEPTION 'Esse tamanho está desligado. Ligue o tamanho ou escolha outro.' USING ERRCODE = '22023';
    END IF;
    -- Estoque vazio (NULL, linha antiga) conta como 0: NULL + 1 deixaria a peca marcada como reposta sem somar nada.
    UPDATE public.product_variants SET stock_increment = COALESCE(stock_increment, 0) + 1
     WHERE id = p_variant_id
    RETURNING stock_increment INTO v_estoque;
    UPDATE public.pecas_sem_tamanho
       SET resolvida_em = now(), resolucao = 'reposta', variant_id = p_variant_id, resolvida_por = auth.uid()
     WHERE id = p_peca_id;
  ELSE
    UPDATE public.pecas_sem_tamanho
       SET resolvida_em = now(), resolucao = 'descartada', resolvida_por = auth.uid()
     WHERE id = p_peca_id;
  END IF;

  RETURN jsonb_build_object(
    'id', p_peca_id,
    'resolucao', CASE WHEN p_variant_id IS NULL THEN 'descartada' ELSE 'reposta' END,
    'variant_id', p_variant_id,
    'ja_resolvida', false,
    'estoque_da_variacao', v_estoque,
    'pendentes', (SELECT count(*) FROM public.pecas_sem_tamanho
                   WHERE produto_id = v_produto AND resolvida_em IS NULL)
  );
END;
$resolver$;

-- ---------------------------------------------------------------------------
-- 4. get_admin_analytics_v2: o corpo da 20261399995000 com o vale fora do dinheiro devolvido (as duas copias)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_admin_analytics_v2(p_limit_days integer DEFAULT 90)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $$
DECLARE
    result json;
    active_users_count int;
    low_stock_count int;

    -- Today stats
    today_revenue numeric;
    today_count bigint;
    today_pending bigint;
    yesterday_revenue numeric;
    yesterday_count bigint;
    today_rev_trend numeric;
    today_count_trend numeric;

    -- month stats (rolling 30 days)
    month_revenue numeric;
    month_count bigint;
    prev_month_revenue numeric;
    prev_month_count bigint;
    month_rev_trend numeric;
    month_count_trend numeric;

    -- executive stats (all-time)
    total_rev numeric;
    total_ord bigint;

    -- avg ticket (all-time)
    avg_ticket numeric;

    -- active customers (all-time)
    active_customers bigint;

    -- inventory values
    inv_cost_total numeric;
    inv_value_total numeric;
    inv_revenue_total numeric;
    inv_revenue_without_cost numeric;
    inv_products_without_cost bigint;
    inv_products_with_cost bigint;

    -- lists
    rev_history json;
    top_prods json;

    -- dinheiro reconhecido: pedido concluído e cobrança paga fora do prazo,
    -- mesmo com o pedido cancelado (achados 2 e 3, 22/08/2026)
    delivered_total bigint;
    paid_on_cancelled bigint;

    -- produtos vendidos SEM custo cadastrado: ficam fora do lucro e do top 5 (20261234000000)
    products_without_cost bigint;
BEGIN
    -- 0. Security Check
    IF NOT public.is_admin() THEN
        RAISE EXCEPTION 'Acesso negado: privilégios de administrador necessários.';
    END IF;
    -- Papel ATUAL (auth.users E profiles), não o do JWT: admin rebaixado para aqui (20261199000000).
    IF NOT public.is_admin_atual() THEN
        RAISE EXCEPTION 'Acesso negado: privilégios de administrador necessários.';
    END IF;

    -- 1. Today vs Yesterday (Same period)
    SELECT COALESCE(SUM(total), 0), COUNT(*)
    INTO today_revenue, today_count
    FROM public.marketplace_orders
    WHERE created_at >= date_trunc('day', now() AT TIME ZONE 'America/Sao_Paulo') AT TIME ZONE 'America/Sao_Paulo'
    AND status NOT IN ('cancelled', 'returned')
    AND (payment_status IN ('pago', 'pago_apos_expirar', 'recebido_na_entrega'));

    SELECT COALESCE(SUM(total), 0), COUNT(*)
    INTO yesterday_revenue, yesterday_count
    FROM public.marketplace_orders
    WHERE created_at >= date_trunc('day', (now() - interval '1 day') AT TIME ZONE 'America/Sao_Paulo') AT TIME ZONE 'America/Sao_Paulo'
    AND created_at < now() - interval '1 day'
    AND status NOT IN ('cancelled', 'returned')
    AND (payment_status IN ('pago', 'pago_apos_expirar', 'recebido_na_entrega'));

    today_rev_trend := CASE WHEN yesterday_revenue > 0 THEN ((today_revenue - yesterday_revenue) / yesterday_revenue) * 100 ELSE (CASE WHEN today_revenue > 0 THEN 100 ELSE 0 END) END;
    today_count_trend := CASE WHEN yesterday_count > 0 THEN ((today_count::numeric - yesterday_count::numeric) / yesterday_count::numeric) * 100 ELSE (CASE WHEN today_count > 0 THEN 100 ELSE 0 END) END;

    SELECT COUNT(*) INTO today_pending
    FROM public.marketplace_orders
    WHERE status in ('pending', 'new', 'processing');

    -- 2. month vs Previous Month (Rolling 30 Days)
    SELECT COALESCE(SUM(total), 0), COUNT(*)
    INTO month_revenue, month_count
    FROM public.marketplace_orders
    WHERE created_at >= now() - interval '30 days'
    AND status NOT IN ('cancelled', 'returned')
    AND (payment_status IN ('pago', 'pago_apos_expirar', 'recebido_na_entrega'));

    SELECT COALESCE(SUM(total), 0), COUNT(*)
    INTO prev_month_revenue, prev_month_count
    FROM public.marketplace_orders
    WHERE created_at >= now() - interval '60 days'
    AND created_at < now() - interval '30 days'
    AND status NOT IN ('cancelled', 'returned')
    AND (payment_status IN ('pago', 'pago_apos_expirar', 'recebido_na_entrega'));

    month_rev_trend := CASE WHEN prev_month_revenue > 0 THEN ((month_revenue - prev_month_revenue) / prev_month_revenue) * 100 ELSE (CASE WHEN month_revenue > 0 THEN 100 ELSE 0 END) END;
    month_count_trend := CASE WHEN prev_month_count > 0 THEN ((month_count::numeric - prev_month_count::numeric) / prev_month_count::numeric) * 100 ELSE (CASE WHEN month_count > 0 THEN 100 ELSE 0 END) END;

    -- 3. Executive Metrics (All-time total metrics)
    SELECT COALESCE(SUM(total), 0), COUNT(*)
    INTO total_rev, total_ord
    FROM public.marketplace_orders
    WHERE status NOT IN ('cancelled', 'returned')
    AND (payment_status IN ('pago', 'pago_apos_expirar', 'recebido_na_entrega'));

    avg_ticket := CASE WHEN total_ord > 0 THEN total_rev / total_ord ELSE 0 END;

    SELECT COUNT(DISTINCT COALESCE(user_id::text, customer_data->>'email', customer_data->>'whatsapp'))
    INTO active_customers
    FROM public.marketplace_orders
    WHERE status NOT IN ('cancelled', 'returned')
    AND (payment_status IN ('pago', 'pago_apos_expirar', 'recebido_na_entrega'));

    SELECT COUNT(*) INTO active_users_count FROM public.profiles;

    -- Estoque efetivo: soma dos `stock_increment` das variantes ATIVAS
    -- quando existe ao menos uma variante ativa; senão a coluna
    -- `produtos.estoque` crua. É a MESMA regra de src/lib/mappers.ts:98-107
    -- (mapProductFromDB), que o cartão do produto, o formulário e a loja já
    -- usam — antes esta função lia a coluna crua e divergia (achado 13,
    -- 20/08/2026). Calculada uma única vez e usada nos dois agregados
    -- abaixo (estoque baixo, custo/valor de estoque).
    WITH estoque_efetivo AS (
        SELECT
            p.custo,
            p.preco_venda,
            p.estoque_minimo,
            CASE
                WHEN COALESCE(v.qtd_ativas, 0) > 0 THEN COALESCE(v.soma_ativas, 0)
                ELSE p.estoque
            END AS estoque,
            CASE
                WHEN COALESCE(v.qtd_ativas, 0) > 0 THEN COALESCE(v.soma_venda, 0)
                ELSE p.preco_venda * p.estoque
            END AS faturamento
        FROM public.produtos p
        LEFT JOIN LATERAL (
            SELECT
                COUNT(*) FILTER (WHERE pv.active) AS qtd_ativas,
                SUM(COALESCE(pv.stock_increment, 0)) FILTER (WHERE pv.active) AS soma_ativas,
                SUM(COALESCE(pv.price_override, p.preco_venda) * COALESCE(pv.stock_increment, 0)) FILTER (WHERE pv.active) AS soma_venda
            FROM public.product_variants pv
            WHERE pv.product_id = p.id
        ) v ON true
        WHERE p.deleted_at IS NULL AND p.ativo = true
    )
    SELECT
        COUNT(*) FILTER (WHERE estoque <= COALESCE(estoque_minimo, 5)),
        COALESCE(SUM(custo * estoque), 0),
        -- Só produto COM custo: sem custo, a venda inteira contava como lucro em "Lucro se vender tudo" (20261214000000).
        COALESCE(SUM(faturamento) FILTER (WHERE custo IS NOT NULL), 0),
        COALESCE(SUM(faturamento), 0),
        COALESCE(SUM(faturamento) FILTER (WHERE custo IS NULL), 0),
        COUNT(*) FILTER (WHERE custo IS NULL AND estoque > 0),
        COUNT(*) FILTER (WHERE custo IS NOT NULL AND estoque > 0)
    INTO low_stock_count, inv_cost_total, inv_value_total, inv_revenue_total, inv_revenue_without_cost, inv_products_without_cost, inv_products_with_cost
    FROM estoque_efetivo;

    -- 4. Revenue, Orders, Profit & Cost History (Filtered by p_limit_days for performance)
    -- This scans only within the required range using the created_at index or created_at::date expression index
    SELECT json_agg(h)
    INTO rev_history
    FROM (
        WITH days AS (
            SELECT generate_series(
                ((now() AT TIME ZONE 'America/Sao_Paulo')
                - (p_limit_days || ' days')::interval)::date,
                (now() AT TIME ZONE 'America/Sao_Paulo')::date,
                interval '1 day'
            )::date AS day
        ),
        daily_orders AS (
            SELECT
                (o.created_at AT TIME ZONE 'America/Sao_Paulo')::date AS day,
                COALESCE(SUM(o.total), 0) AS revenue,
                COUNT(o.id)::int as orders
            FROM public.marketplace_orders o
            WHERE o.created_at >= now() - (p_limit_days || ' days')::interval - interval '1 day'
              AND o.status NOT IN ('cancelled', 'returned')
              AND (o.payment_status IN ('pago', 'pago_apos_expirar', 'recebido_na_entrega'))
            GROUP BY ((o.created_at AT TIME ZONE 'America/Sao_Paulo')::date)
        ),
        devs AS MATERIALIZED (
            -- DINHEIRO de cada devolucao CONCLUIDA com reembolso ou vale (troca NAO conta: a peca sai de novo), em reais de PRODUTO (sem o frete de ida) (20261399995000).
            -- vv = valor das pecas que voltaram (toda condicao menos 'ausente'); va = valor das pecas 'Nao veio' (ficaram com a cliente).
            -- pm = o dinheiro devolvido: reembolso = valor_reembolso menos o frete de ida (devolucao de reembolso SEM valor gravado = o das pecas que voltaram, como era antes);
            -- vale = 0 (20261659000000): o vale-troca e' credito na loja, nao dinheiro que saiu; como no Financeiro, a venda da peca fica no lucro
            -- e as pecas do vale seguem na quantidade devolvida e no custo que volta (reestocadas). Antes era o valor das pecas que voltaram.
            -- fv / fa = a fracao do valor de cada peca que esse dinheiro cobriu: primeiro as pecas que voltaram, so depois as 'Nao veio'.
            -- excesso = o que passou do valor de todas as pecas da devolucao: vai para o rateio do pedido (como o estorno sem devolucao).
            SELECT dv.id AS devolucao_id,
                   dv.order_id,
                   CASE WHEN x.vv > 0 THEN LEAST(m.pm, x.vv) / x.vv ELSE 0 END AS fv,
                   CASE WHEN x.va > 0 THEN LEAST(GREATEST(m.pm - x.vv, 0), x.va) / x.va ELSE 0 END AS fa,
                   GREATEST(0, m.pm - x.vv - x.va) AS excesso
              FROM public.devolucoes dv
              CROSS JOIN LATERAL (SELECT COALESCE(SUM(dx.quantidade * dx.valor_unitario) FILTER (WHERE dx.condicao IS DISTINCT FROM 'ausente'), 0) AS vv,
                                         COALESCE(SUM(dx.quantidade * dx.valor_unitario) FILTER (WHERE dx.condicao = 'ausente'), 0) AS va
                                    FROM public.devolucao_itens dx
                                   WHERE dx.devolucao_id = dv.id) x
              CROSS JOIN LATERAL (SELECT CASE WHEN dv.resolucao_final = 'vale' THEN 0
                                              WHEN dv.resolucao_final = 'reembolso' AND dv.valor_reembolso IS NOT NULL
                                              THEN GREATEST(0, dv.valor_reembolso - COALESCE(dv.valor_frete_ida, 0))
                                              ELSE x.vv END AS pm) m
             WHERE dv.status = 'concluida'
               AND dv.resolucao_final IN ('reembolso', 'vale')
               AND EXISTS (SELECT 1 FROM public.marketplace_orders dj
                            WHERE dj.id = dv.order_id
                              AND dj.created_at >= now() - (p_limit_days || ' days')::interval - interval '1 day')
        ),
        dev_item AS (
            -- O que as devolucoes concluidas fizeram com CADA item vendido, numa passada so (agrupado por item):
            -- pecas devolvidas que voltaram (sem as 'Nao veio'), as que voltaram a PRATELEIRA (reestocado_em preenchido: so o custo delas e' devolvido ao lucro)
            -- e o dinheiro que as devolucoes devolveram POR este item (fv/fa de cada devolucao).
            SELECT di.order_item_id,
                   COALESCE(SUM(di.quantidade) FILTER (WHERE di.condicao IS DISTINCT FROM 'ausente'), 0) AS devolvidas,
                   COALESCE(SUM(di.quantidade) FILTER (WHERE di.reestocado_em IS NOT NULL AND di.condicao IS DISTINCT FROM 'ausente'), 0) AS reestocadas,
                   COALESCE(SUM(di.quantidade * di.valor_unitario * CASE WHEN di.condicao = 'ausente' THEN d.fa ELSE d.fv END), 0) AS dinheiro
              FROM public.devolucao_itens di
              JOIN devs d ON d.devolucao_id = di.devolucao_id
             GROUP BY di.order_item_id
        ),
        pecas AS MATERIALIZED (
            -- Uma linha por item vendido: pago = o que a cliente pagou por UMA peca (preco menos o rateio do cupom);
            -- dinheiro_dev = o dinheiro devolvido por este item pelas devolucoes, nunca acima do que o item pagou.
            -- A consulta de baixo sai DAQUI (produto, dia e status do pedido vem junto): juntar de novo pelo item_id deixava o planejador sem estatistica da CTE e ele refazia a conta por linha.
            SELECT oi.id AS item_id,
                   oi.order_id,
                   oi.product_id,
                   o.created_at AS criado_em,
                   o.payment_status AS pst,
                   oi.quantity AS q,
                   pg.pago,
                   LEAST(oi.quantity, COALESCE(dv.devolvidas, 0))::int AS devolvidas,
                   LEAST(oi.quantity, COALESCE(dv.reestocadas, 0))::int AS reestocadas,
                   LEAST(oi.quantity * pg.pago, COALESCE(dv.dinheiro, 0)) AS dinheiro_dev
              FROM public.marketplace_order_items oi
              JOIN public.marketplace_orders o ON o.id = oi.order_id
              CROSS JOIN LATERAL (SELECT oi.price - CASE
                        WHEN COALESCE(o.discount, 0) <= 0 THEN 0
                        ELSE oi.price * LEAST(1, GREATEST(0, COALESCE(o.discount, 0)) / NULLIF(
                            (SELECT SUM(desconto_item.quantity * desconto_item.price)
                               FROM public.marketplace_order_items desconto_item
                              WHERE desconto_item.order_id = o.id), 0))
                    END AS pago) pg
              LEFT JOIN dev_item dv ON dv.order_item_id = oi.id
             WHERE o.status NOT IN ('cancelled', 'returned')
               AND (o.payment_status IN ('pago', 'pago_apos_expirar', 'recebido_na_entrega', 'estornado'))
               AND o.created_at >= now() - (p_limit_days || ' days')::interval - interval '1 day'
        ),
        sobra AS MATERIALIZED (
            -- Dinheiro devolvido que NAO tem peca por tras, por pedido, e quanto dele cai em cada item (taxa de 0 a 1 do que o item ainda pagou).
            -- residual = ESTORNO SEM devolucao ("cortesia"): o que o Mercado Pago confirmou devolvido (valor_estornado) menos o que foi devolvido POR uma devolucao
            -- concluida (a linha de order_refunds ligada em devolucoes.refund_id: esse dinheiro ja entra pelo dinheiro_dev). Nunca abaixo de zero.
            -- excesso = o que uma devolucao devolveu alem do valor das pecas dela. folga = o que os itens do pedido ainda pagaram depois do dinheiro das devolucoes:
            -- e' entre eles que o residual e o excesso se repartem (proporcional), sem passar do que cada um pagou. Dinheiro que sobrar sem item para receber nao e' lucro de produto
            -- (o frete devolvido, por exemplo). Pedido 'estornado' (devolvido por inteiro) fica com a folga toda: o Financeiro o conta como pago e devolvido.
            SELECT t.order_id,
                   CASE WHEN t.estornado THEN 1
                        ELSE LEAST(1, COALESCE((t.residual + t.excesso) / NULLIF(t.folga, 0), 0)) END AS taxa
              FROM (
            SELECT so.id AS order_id,
                   so.payment_status = 'estornado' AS estornado,
                   GREATEST(0, COALESCE(so.valor_estornado, 0) - COALESCE((
                       SELECT SUM(rf.amount)
                         FROM public.order_refunds rf
                        WHERE rf.order_id = so.id
                          AND rf.status = 'concluido'
                          AND EXISTS (SELECT 1 FROM public.devolucoes dv_lig
                                       WHERE dv_lig.refund_id = rf.id
                                         AND dv_lig.order_id = so.id)), 0)
                       -- Devolvido pelo painel do Mercado Pago: a linha ligada a devolucao falhou/foi recusada (ou a lojista marcou
                       -- "ja devolvi por fora", que solta o refund_id) e o webhook gravou OUTRA linha 'sistema' concluida depois da
                       -- conclusao (o mesmo criterio de reemitir_reembolso_da_devolucao). valor_estornado ja soma essa linha, mas o dinheiro
                       -- saiu POR uma devolucao: sai do lucro pelas pecas devolvidas, nao de novo como cortesia. Limitado ao que o painel
                       -- de fato devolveu (soma das linhas 'sistema'); sem essa linha, nada se desconta (ligada 'solicitado' continua cortesia).
                       - COALESCE((
                       SELECT LEAST(g.valor, COALESCE((
                                  SELECT SUM(sp.amount)
                                    FROM public.order_refunds sp
                                   WHERE sp.order_id = so.id
                                     AND sp.solicitado_por = 'sistema'
                                     AND sp.status = 'concluido'
                                     AND sp.mp_chargeback_id IS NULL
                                     AND sp.created_at >= g.desde), 0))
                         FROM (SELECT SUM(dvp.valor_reembolso) AS valor,
                                      MIN(COALESCE(dvp.concluida_em, dvp.updated_at)) AS desde
                                 FROM public.devolucoes dvp
                                 LEFT JOIN public.order_refunds rlp ON rlp.id = dvp.refund_id
                                WHERE dvp.order_id = so.id
                                  AND dvp.status = 'concluida'
                                  AND dvp.resolucao_final = 'reembolso'
                                  AND dvp.valor_reembolso > 0
                                  AND ((dvp.refund_id IS NULL AND dvp.reembolso_manual)
                                       OR rlp.status IN ('falhou', 'recusado'))) g
                        WHERE g.valor IS NOT NULL), 0)) AS residual,
                   COALESCE(ex.excesso, 0) AS excesso,
                   COALESCE(pf.folga, 0) AS folga
              FROM public.marketplace_orders so
              LEFT JOIN (SELECT dd.order_id, SUM(dd.excesso) AS excesso FROM devs dd GROUP BY dd.order_id) ex ON ex.order_id = so.id
              LEFT JOIN (SELECT px.order_id, SUM(px.q * px.pago - px.dinheiro_dev) AS folga FROM pecas px GROUP BY px.order_id) pf ON pf.order_id = so.id
             WHERE (COALESCE(so.valor_estornado, 0) > 0
                    OR so.payment_status = 'estornado'
                    OR ex.order_id IS NOT NULL)
               AND so.status NOT IN ('cancelled', 'returned')
               AND (so.payment_status IN ('pago', 'pago_apos_expirar', 'recebido_na_entrega', 'estornado'))
                   AND so.created_at >= now() - (p_limit_days || ' days')::interval - interval '1 day') t
        ),
        daily_items AS (
            SELECT
                (pc.criado_em AT TIME ZONE 'America/Sao_Paulo')::date AS day,
                -- Lucro só dos itens com custo conhecido (custo IS NOT NULL; custo 0 é zero medido e conta): sem custo, a venda inteira virava lucro (20261234000000).
                -- O custo de cada item é o do DIA da venda (marketplace_order_item_custo, 20261242000000); venda sem registro usa o custo de hoje do produto.
                -- Lucro do produto no dia da VENDA, a mesma conta do ranking "Produtos que mais dão lucro" e do Financeiro, pedido a pedido (20261399995000):
                -- o que a cliente pagou pela peça (já com o cupom) - TODO o dinheiro devolvido (devolução, estorno ou Mercado Pago) - o custo das peças que saíram e NÃO voltaram à prateleira. Sem frete.
                -- Pedido 'estornado' (devolvido por inteiro) entra com -custo das peças que não voltaram; só o cancelado continua fora. A linha de faturamento, os pedidos e o custo vendido seguem como eram.
                COALESCE(SUM(pc.q * (pc.pago - COALESCE(oic.custo, p.custo)) + COALESCE(oic.custo, p.custo) * pc.reestocadas - pc.dinheiro_dev
                    - (pc.q * pc.pago - pc.dinheiro_dev) * COALESCE(s.taxa, 0)) FILTER (WHERE COALESCE(oic.custo, p.custo) IS NOT NULL), 0) AS profit,
                COALESCE(SUM(pc.q * COALESCE(oic.custo, p.custo, 0)) FILTER (WHERE pc.pst <> 'estornado'), 0) AS cost_sold
            FROM pecas pc
            JOIN public.produtos p ON pc.product_id = p.id
            LEFT JOIN public.marketplace_order_item_custo oic ON oic.item_id = pc.item_id
            LEFT JOIN sobra s ON s.order_id = pc.order_id
            GROUP BY ((pc.criado_em AT TIME ZONE 'America/Sao_Paulo')::date)
        )
        SELECT
            TO_CHAR(d.day, 'YYYY-MM-DD') AS date,
            TO_CHAR(d.day, 'DD/MM') AS full_date,
            COALESCE(dor.revenue, 0) AS revenue,
            COALESCE(dor.orders, 0) AS orders,
            COALESCE(dit.profit, 0) AS profit,
            COALESCE(dit.cost_sold, 0) AS cost_sold
        FROM days d
        LEFT JOIN daily_orders dor ON d.day = dor.day
        LEFT JOIN daily_items dit ON d.day = dit.day
        ORDER BY d.day ASC
    ) h;

    -- 5. Top Products (All time)
    -- Lucro do produto, pedido a pedido como o Financeiro (20261399995000): o que a cliente pagou pela peça (já com o cupom) - TODO o dinheiro devolvido
    -- (devolução, estorno ou Mercado Pago, só de produto, sem frete) - o custo das peças que saíram e NÃO voltaram à prateleira. A quantidade do ranking é vendidas - devolvidas.
    -- Pedido 'estornado' (devolvido por inteiro) entra; só o cancelado (sem a venda) continua fora.
    SELECT json_agg(p)
    INTO top_prods
    FROM (
        WITH
        devs AS MATERIALIZED (
            -- DINHEIRO de cada devolucao CONCLUIDA com reembolso ou vale (troca NAO conta: a peca sai de novo), em reais de PRODUTO (sem o frete de ida) (20261399995000).
            -- vv = valor das pecas que voltaram (toda condicao menos 'ausente'); va = valor das pecas 'Nao veio' (ficaram com a cliente).
            -- pm = o dinheiro devolvido: reembolso = valor_reembolso menos o frete de ida (devolucao de reembolso SEM valor gravado = o das pecas que voltaram, como era antes);
            -- vale = 0 (20261659000000): o vale-troca e' credito na loja, nao dinheiro que saiu; como no Financeiro, a venda da peca fica no lucro
            -- e as pecas do vale seguem na quantidade devolvida e no custo que volta (reestocadas). Antes era o valor das pecas que voltaram.
            -- fv / fa = a fracao do valor de cada peca que esse dinheiro cobriu: primeiro as pecas que voltaram, so depois as 'Nao veio'.
            -- excesso = o que passou do valor de todas as pecas da devolucao: vai para o rateio do pedido (como o estorno sem devolucao).
            SELECT dv.id AS devolucao_id,
                   dv.order_id,
                   CASE WHEN x.vv > 0 THEN LEAST(m.pm, x.vv) / x.vv ELSE 0 END AS fv,
                   CASE WHEN x.va > 0 THEN LEAST(GREATEST(m.pm - x.vv, 0), x.va) / x.va ELSE 0 END AS fa,
                   GREATEST(0, m.pm - x.vv - x.va) AS excesso
              FROM public.devolucoes dv
              CROSS JOIN LATERAL (SELECT COALESCE(SUM(dx.quantidade * dx.valor_unitario) FILTER (WHERE dx.condicao IS DISTINCT FROM 'ausente'), 0) AS vv,
                                         COALESCE(SUM(dx.quantidade * dx.valor_unitario) FILTER (WHERE dx.condicao = 'ausente'), 0) AS va
                                    FROM public.devolucao_itens dx
                                   WHERE dx.devolucao_id = dv.id) x
              CROSS JOIN LATERAL (SELECT CASE WHEN dv.resolucao_final = 'vale' THEN 0
                                              WHEN dv.resolucao_final = 'reembolso' AND dv.valor_reembolso IS NOT NULL
                                              THEN GREATEST(0, dv.valor_reembolso - COALESCE(dv.valor_frete_ida, 0))
                                              ELSE x.vv END AS pm) m
             WHERE dv.status = 'concluida'
               AND dv.resolucao_final IN ('reembolso', 'vale')
        ),
        dev_item AS (
            -- O que as devolucoes concluidas fizeram com CADA item vendido, numa passada so (agrupado por item):
            -- pecas devolvidas que voltaram (sem as 'Nao veio'), as que voltaram a PRATELEIRA (reestocado_em preenchido: so o custo delas e' devolvido ao lucro)
            -- e o dinheiro que as devolucoes devolveram POR este item (fv/fa de cada devolucao).
            SELECT di.order_item_id,
                   COALESCE(SUM(di.quantidade) FILTER (WHERE di.condicao IS DISTINCT FROM 'ausente'), 0) AS devolvidas,
                   COALESCE(SUM(di.quantidade) FILTER (WHERE di.reestocado_em IS NOT NULL AND di.condicao IS DISTINCT FROM 'ausente'), 0) AS reestocadas,
                   COALESCE(SUM(di.quantidade * di.valor_unitario * CASE WHEN di.condicao = 'ausente' THEN d.fa ELSE d.fv END), 0) AS dinheiro
              FROM public.devolucao_itens di
              JOIN devs d ON d.devolucao_id = di.devolucao_id
             GROUP BY di.order_item_id
        ),
        pecas AS MATERIALIZED (
            -- Uma linha por item vendido: pago = o que a cliente pagou por UMA peca (preco menos o rateio do cupom);
            -- dinheiro_dev = o dinheiro devolvido por este item pelas devolucoes, nunca acima do que o item pagou.
            -- A consulta de baixo sai DAQUI (produto, dia e status do pedido vem junto): juntar de novo pelo item_id deixava o planejador sem estatistica da CTE e ele refazia a conta por linha.
            SELECT oi.id AS item_id,
                   oi.order_id,
                   oi.product_id,
                   o.created_at AS criado_em,
                   o.payment_status AS pst,
                   oi.quantity AS q,
                   pg.pago,
                   LEAST(oi.quantity, COALESCE(dv.devolvidas, 0))::int AS devolvidas,
                   LEAST(oi.quantity, COALESCE(dv.reestocadas, 0))::int AS reestocadas,
                   LEAST(oi.quantity * pg.pago, COALESCE(dv.dinheiro, 0)) AS dinheiro_dev
              FROM public.marketplace_order_items oi
              JOIN public.marketplace_orders o ON o.id = oi.order_id
              CROSS JOIN LATERAL (SELECT oi.price - CASE
                        WHEN COALESCE(o.discount, 0) <= 0 THEN 0
                        ELSE oi.price * LEAST(1, GREATEST(0, COALESCE(o.discount, 0)) / NULLIF(
                            (SELECT SUM(desconto_item.quantity * desconto_item.price)
                               FROM public.marketplace_order_items desconto_item
                              WHERE desconto_item.order_id = o.id), 0))
                    END AS pago) pg
              LEFT JOIN dev_item dv ON dv.order_item_id = oi.id
             WHERE o.status NOT IN ('cancelled', 'returned')
               AND (o.payment_status IN ('pago', 'pago_apos_expirar', 'recebido_na_entrega', 'estornado'))
        ),
        sobra AS MATERIALIZED (
            -- Dinheiro devolvido que NAO tem peca por tras, por pedido, e quanto dele cai em cada item (taxa de 0 a 1 do que o item ainda pagou).
            -- residual = ESTORNO SEM devolucao ("cortesia"): o que o Mercado Pago confirmou devolvido (valor_estornado) menos o que foi devolvido POR uma devolucao
            -- concluida (a linha de order_refunds ligada em devolucoes.refund_id: esse dinheiro ja entra pelo dinheiro_dev). Nunca abaixo de zero.
            -- excesso = o que uma devolucao devolveu alem do valor das pecas dela. folga = o que os itens do pedido ainda pagaram depois do dinheiro das devolucoes:
            -- e' entre eles que o residual e o excesso se repartem (proporcional), sem passar do que cada um pagou. Dinheiro que sobrar sem item para receber nao e' lucro de produto
            -- (o frete devolvido, por exemplo). Pedido 'estornado' (devolvido por inteiro) fica com a folga toda: o Financeiro o conta como pago e devolvido.
            SELECT t.order_id,
                   CASE WHEN t.estornado THEN 1
                        ELSE LEAST(1, COALESCE((t.residual + t.excesso) / NULLIF(t.folga, 0), 0)) END AS taxa
              FROM (
            SELECT so.id AS order_id,
                   so.payment_status = 'estornado' AS estornado,
                   GREATEST(0, COALESCE(so.valor_estornado, 0) - COALESCE((
                       SELECT SUM(rf.amount)
                         FROM public.order_refunds rf
                        WHERE rf.order_id = so.id
                          AND rf.status = 'concluido'
                          AND EXISTS (SELECT 1 FROM public.devolucoes dv_lig
                                       WHERE dv_lig.refund_id = rf.id
                                         AND dv_lig.order_id = so.id)), 0)
                       -- Devolvido pelo painel do Mercado Pago: a linha ligada a devolucao falhou/foi recusada (ou a lojista marcou
                       -- "ja devolvi por fora", que solta o refund_id) e o webhook gravou OUTRA linha 'sistema' concluida depois da
                       -- conclusao (o mesmo criterio de reemitir_reembolso_da_devolucao). valor_estornado ja soma essa linha, mas o dinheiro
                       -- saiu POR uma devolucao: sai do lucro pelas pecas devolvidas, nao de novo como cortesia. Limitado ao que o painel
                       -- de fato devolveu (soma das linhas 'sistema'); sem essa linha, nada se desconta (ligada 'solicitado' continua cortesia).
                       - COALESCE((
                       SELECT LEAST(g.valor, COALESCE((
                                  SELECT SUM(sp.amount)
                                    FROM public.order_refunds sp
                                   WHERE sp.order_id = so.id
                                     AND sp.solicitado_por = 'sistema'
                                     AND sp.status = 'concluido'
                                     AND sp.mp_chargeback_id IS NULL
                                     AND sp.created_at >= g.desde), 0))
                         FROM (SELECT SUM(dvp.valor_reembolso) AS valor,
                                      MIN(COALESCE(dvp.concluida_em, dvp.updated_at)) AS desde
                                 FROM public.devolucoes dvp
                                 LEFT JOIN public.order_refunds rlp ON rlp.id = dvp.refund_id
                                WHERE dvp.order_id = so.id
                                  AND dvp.status = 'concluida'
                                  AND dvp.resolucao_final = 'reembolso'
                                  AND dvp.valor_reembolso > 0
                                  AND ((dvp.refund_id IS NULL AND dvp.reembolso_manual)
                                       OR rlp.status IN ('falhou', 'recusado'))) g
                        WHERE g.valor IS NOT NULL), 0)) AS residual,
                   COALESCE(ex.excesso, 0) AS excesso,
                   COALESCE(pf.folga, 0) AS folga
              FROM public.marketplace_orders so
              LEFT JOIN (SELECT dd.order_id, SUM(dd.excesso) AS excesso FROM devs dd GROUP BY dd.order_id) ex ON ex.order_id = so.id
              LEFT JOIN (SELECT px.order_id, SUM(px.q * px.pago - px.dinheiro_dev) AS folga FROM pecas px GROUP BY px.order_id) pf ON pf.order_id = so.id
             WHERE (COALESCE(so.valor_estornado, 0) > 0
                    OR so.payment_status = 'estornado'
                    OR ex.order_id IS NOT NULL)
               AND so.status NOT IN ('cancelled', 'returned')
               AND (so.payment_status IN ('pago', 'pago_apos_expirar', 'recebido_na_entrega', 'estornado'))) t
        )
        SELECT
            p.id as id,
            p.nome AS name,
            SUM(pc.q - pc.devolvidas)::int as quantity,
            SUM(pc.q * (pc.pago - COALESCE(oic.custo, p.custo)) + COALESCE(oic.custo, p.custo) * pc.reestocadas - pc.dinheiro_dev
                    - (pc.q * pc.pago - pc.dinheiro_dev) * COALESCE(s.taxa, 0)) as total,
            COALESCE(p.imagem_url, '') as image
        FROM pecas pc
        JOIN public.produtos p ON p.id = pc.product_id
        LEFT JOIN public.marketplace_order_item_custo oic ON oic.item_id = pc.item_id
        LEFT JOIN sobra s ON s.order_id = pc.order_id
        WHERE p.deleted_at IS NULL
        -- Só item com custo conhecido (o do dia da venda, ou o de hoje do produto): sem custo o ranking de LUCRO empatava com a receita (20261234000000, 20261242000000).
        AND COALESCE(oic.custo, p.custo) IS NOT NULL
        GROUP BY p.id, p.nome, p.imagem_url
        ORDER BY total DESC
        LIMIT 5
    ) p;

    -- 5b. Produtos vendidos (mesma regra de venda do top 5) que ficaram FORA do lucro por não terem custo (20261234000000): venda sem custo do dia e produto sem custo hoje (20261242000000).
    SELECT COUNT(DISTINCT p.id)
    INTO products_without_cost
    FROM public.produtos p
    JOIN public.marketplace_order_items oi ON p.id = oi.product_id
    JOIN public.marketplace_orders o ON oi.order_id = o.id
    LEFT JOIN public.marketplace_order_item_custo oic ON oic.item_id = oi.id
    WHERE o.status NOT IN ('cancelled', 'returned')
    AND (o.payment_status IN ('pago', 'pago_apos_expirar', 'recebido_na_entrega'))
    AND p.deleted_at IS NULL
    AND COALESCE(oic.custo, p.custo) IS NULL;

    -- 6. Dinheiro reconhecido fora da regra de status (achados 2 e 3)
    SELECT COUNT(*) INTO delivered_total
    FROM public.marketplace_orders
    WHERE status = 'delivered';

    SELECT COUNT(*) INTO paid_on_cancelled
    FROM public.marketplace_orders
    WHERE payment_status IN ('pago', 'pago_apos_expirar', 'recebido_na_entrega') AND status = 'cancelled';

    -- BUILD FINAL OBJECT (Matching DashboardStats interface 100%)
    result := json_build_object(
        'today', json_build_object(
            'revenue', today_revenue,
            'count', today_count,
            'pending', today_pending,
            'revenueTrend', round(today_rev_trend, 1),
            'countTrend', round(today_count_trend, 1)
        ),
        'month', json_build_object(
            'revenue', month_revenue,
            'count', month_count,
            'revenueTrend', round(month_rev_trend, 1),
            'countTrend', round(month_count_trend, 1)
        ),
        'executive', json_build_object(
            'totalRevenue', total_rev,
            'totalOrders', total_ord,
            'revenueTrend', 0,
            'ordersTrend', 0,
            'avgTicket', round(avg_ticket, 2),
            'avgTicketTrend', 0,
            'activeCustomers', active_customers,
            'activeCustomersTrend', 0
        ),
        'revenueHistory', COALESCE(rev_history, '[]'::json),
        'topProducts', COALESCE(top_prods, '[]'::json),
        'inventoryAlerts', low_stock_count,
        'growth', round(month_rev_trend, 1),
        'inventory', json_build_object(
            'totalCost', inv_cost_total,
            'totalValue', inv_value_total,
            'totalRevenue', inv_revenue_total,
            'revenueWithoutCost', inv_revenue_without_cost,
            'productsWithoutCost', inv_products_without_cost,
            'productsWithCost', inv_products_with_cost
        ),
        'averageTicket', round(avg_ticket, 2),
        'deliveredTotal', delivered_total,
        'paidOnCancelled', paid_on_cancelled,
        'productsWithoutCost', products_without_cost
    );

    RETURN result;
END;
$$;

-- ---------------------------------------------------------------------------
-- PÓS-VOO (B2_POSTFLIGHT_FAILED): os quatro corpos desta, com OID, dono, ACL e atributos de antes
-- ---------------------------------------------------------------------------
DO $posvoo_20261659000000$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT * FROM (VALUES
      ('public.devolver_estoque(uuid)', 'e42582a472fd79ba987c11f161ad9a7a', 'excl659_dev'),
      ('public.admin_devolucao_concluir(uuid,text,jsonb,numeric,text)', '9ec7a021b965b7abdc77bc4b2b900c35', 'excl659_concl'),
      ('public.resolver_peca_sem_tamanho(uuid,uuid)', '115378a67cd4f89b73129aeec4c46a7f', 'excl659_res'),
      ('public.get_admin_analytics_v2(integer)', '1624212a7096b6f49a80370b30191a15', 'excl659_ana')
    ) AS esperado(assinatura, hash, fotografia)
  LOOP
    IF (SELECT md5(replace(prosrc, E'\r', '')) FROM pg_proc WHERE oid = to_regprocedure(r.assinatura)) IS DISTINCT FROM r.hash
       OR (SELECT to_jsonb(p) - 'prosrc' FROM pg_proc p WHERE p.oid = to_regprocedure(r.assinatura))
            IS DISTINCT FROM current_setting('ikcous.' || r.fotografia)::jsonb THEN
      RAISE EXCEPTION 'B2_POSTFLIGHT_FAILED: % nao ficou com o corpo desta migration ou mudou OID, dono, ACL ou atributos.', r.assinatura;
    END IF;
  END LOOP;
  IF (SELECT count(*) FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace
        AND p.proname IN ('devolver_estoque', 'admin_devolucao_concluir', 'resolver_peca_sem_tamanho', 'get_admin_analytics_v2')) <> 4 THEN
    RAISE EXCEPTION 'B2_POSTFLIGHT_FAILED: uma das quatro funcoes ficou com sobrecarga.';
  END IF;
END $posvoo_20261659000000$;

-- As funções são chamadas por RPC (a conclusão, a decisão da peça e o painel) e por outras funções: recarrega o schema cache. Idempotente.
NOTIFY pgrst, 'reload schema';
