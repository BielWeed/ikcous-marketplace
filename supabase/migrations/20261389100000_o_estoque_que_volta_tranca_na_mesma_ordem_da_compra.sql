-- O ESTOQUE QUE VOLTA TRANCA NA MESMA ORDEM DA COMPRA (frente E / E2; estoque + concorrencia; 26/10/2026)
-- RASCUNHO PARA REVISAO OPUS. Nada foi aplicado em banco algum.
-- ADITIVA pelos criterios da carta branca: um CREATE OR REPLACE de UMA funcao (so ela), mesma assinatura, mesmos atributos, mesmo
-- dono, mesmo OID e mesma ACL; nenhuma tabela, coluna, dado, politica ou grant e criado, alterado ou apagado.
--
-- DEFEITO: devolver_estoque(p_order_id) credita o estoque de um pedido que expira, e' cancelado ou e' estornado. Ela percorria os
-- itens do pedido SEM ordem e a cada item tranca uma linha: a da VARIACAO (e, pelo gatilho sync_produto_ultima_atualizacao, o
-- produto-pai logo depois) ou a do PRODUTO. Ja a compra (create_marketplace_order_v23/v24, 20261350000000/20261384000000) tranca,
-- numa ordem global, primeiro TODAS as variacoes do carrinho por id e depois TODOS os produtos por id. Um pedido que expira ou cancela
-- ao mesmo tempo de uma compra que mexe nas mesmas linhas, com os itens na ordem contraria, cruza travas: cada lado segura o que o
-- outro espera e o banco derruba um com 40P01 (deadlock detected). Quem sente: a cliente que fecha a compra (a falha chega como
-- "tente de novo") ou o cancelamento/expiracao que aborta e e' refeito pelo agendador. Raro (so em picos com os mesmos itens), sem
-- perda de dinheiro nem de estoque (o banco desfaz o lado derrubado), mas evitavel. Provado em duas conexoes reais na prova viva
-- tests/banco/o-estoque-que-volta-tranca-na-mesma-ordem-viva.cjs: o corpo da 20261175000000 DA 40P01 num cenario deterministico (duas
-- formas: variacao x variacao e produto x variacao); o corpo desta migration, no MESMO cenario, nao.
--
-- O QUE MUDA, SO ISTO: depois de reclamar o carimbo stock_returned_at e ANTES do laco que credita, a funcao tranca as linhas do pedido
-- na ordem global da compra: as variacoes do pedido por id, depois os produtos (os dos itens e os pais das variacoes) por id, cada
-- grupo num unico SELECT ... ORDER BY id FOR NO KEY UPDATE (a mesma forca que o UPDATE do credito tomaria). O laco que credita e' o
-- da 20261175000000 SEM mexer numa linha: mesma regra de IF/ELSE (variacao OU produto, nunca os dois), mesmo desconto do que a
-- devolucao ja repos (achado C), mesmo retorno, mesmo carimbo. O credito de estoque e' IDENTICO; so QUANDO as travas sao tomadas muda.
-- A diferenca de trava e' so para MAIS: itens cujo credito e' zero (a devolucao ja repos tudo) agora tambem trancam suas linhas por
-- instantes, como a compra ja faz com todos os itens. Pedido ja devolvido (carimbo presente) sai antes, sem trancar nada, como antes.
--
-- RESIDUO ASSUMIDO (nao e' desta migration): expirar_pedidos_vencidos percorre VARIOS pedidos numa transacao so e chama esta funcao
-- para cada um; as travas de um pedido nao se soltam antes de o proximo comecar. A ordem global vale DENTRO de cada pedido, nao entre
-- pedidos do mesmo lote. Um lote que segura os itens do pedido 1 e espera os do pedido 2, contra uma compra que segura os do 2 e quer
-- os do 1, ainda pode cruzar. Fechar isso e' tocar a varredura (varrer pedido por pedido em transacoes proprias), outra migration.
-- A venda do balcao (registrar_venda_presencial) tambem segue trancando na ordem do carrinho (pendencia ja registrada na 20261350000000).
--
-- DADOS EXISTENTES E REAPLICACAO: nenhuma linha e' lida para fora nem escrita pela migration; o estoque, os carimbos e os pedidos ficam
-- como estao. Rodar duas vezes reescreve o MESMO texto (o pre-voo aceita o corpo da 20261175000000 OU o desta). Um pedido que ja foi
-- devolvido continua devolvido uma vez so (a guarda stock_returned_at nao mudou).
--
-- CORPO VIGENTE: o da 20261175000000 (md5 05f6f7e6ac7a2fa7793298110cf17e96) com DUAS edicoes, marcadas no proprio corpo: as duas variaveis uuid[] na DECLARE
-- e o bloco "ordem global das travas" entre o retorno antecipado e o laco. O corpo desta migration tem md5 943b226906e91013e7cccf4992617e35.
-- PRE-VOO fail-closed (B1_BASELINE_DIVERGENT): aceita SO o corpo da 20261175000000 ou o desta, mais atributos (SECURITY DEFINER,
-- search_path=public, plpgsql, VOLATILE, retorna integer, uma assinatura so), ACL (anon, authenticated e PUBLIC sem EXECUTE; o que a loja
-- deu a service_role fica como esta) e as tabelas e colunas que o bloco novo le. Loja que ainda nao recebeu a 20261175000000 e recusada de
-- proposito: aplicar na ordem. POS-VOO: hash novo e fotografia de TODOS os atributos (inclusive OID, dono e ACL) tirada antes igual a de
-- depois. Sem BEGIN/COMMIT de nivel superior: o aplicador fornece a transacao inteira (AGENTS.md); se qualquer verificacao falhar, nada
-- fica gravado. lock_timeout de 5 s: CREATE OR REPLACE FUNCTION nao trava tabela, mas espera o catalogo; melhor falhar e reaplicar.
-- ORDEM: DEPOIS da 20261175000000 (e das que a citam); independe das demais. Banco de CADA loja; valem IKCOUS e Savy, lojas de teste fora.
-- ROLLBACK MANUAL: rollback-manual-20261389100000_o_estoque_que_volta_tranca_na_mesma_ordem_da_compra.sql devolve o corpo (e o COMENTARIO)
-- da 20261175000000 byte a byte, com pre-voo que recusa corpo desconhecido; repetir e' no-op. ATENCAO: o rollback-manual da 20261175000000
-- troca o corpo por um mais velho SEM olhar o atual (nao tem pre-voo para esta funcao): desfazer esta ANTES de desfazer a 175.
-- TIPOS: src/types/database.types.ts nao muda (mesma assinatura).

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

DO $preflight_20261389100000$
DECLARE
  v_hash text;
  v_atributos jsonb;
BEGIN
  SELECT md5(replace(p.prosrc, E'\r', '')), to_jsonb(p) - 'prosrc'
    INTO v_hash, v_atributos FROM pg_proc p
   WHERE p.oid = to_regprocedure('public.devolver_estoque(uuid)');
  IF v_hash IS NULL OR v_hash NOT IN ('05f6f7e6ac7a2fa7793298110cf17e96', '943b226906e91013e7cccf4992617e35') THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: public.devolver_estoque(uuid) (hash %) nao e o corpo vigente (20261175000000) nem o desta migration; revise antes de aplicar.', COALESCE(v_hash, 'ausente');
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_language l ON l.oid = p.prolang
     WHERE p.oid = to_regprocedure('public.devolver_estoque(uuid)')
       AND p.prokind = 'f' AND p.prosecdef AND p.proconfig = ARRAY['search_path=public']::text[]
       AND p.provolatile = 'v' AND NOT p.proisstrict AND NOT p.proleakproof AND NOT p.proretset
       AND p.proparallel = 'u' AND p.procost = 100
       AND l.lanname = 'plpgsql' AND p.prorettype = 'integer'::regtype
       AND pg_get_function_arguments(p.oid) = 'p_order_id uuid'
       AND (SELECT count(*) FROM pg_proc q WHERE q.pronamespace = 'public'::regnamespace AND q.proname = 'devolver_estoque') = 1
       AND NOT has_function_privilege('anon', p.oid, 'EXECUTE')
       AND NOT has_function_privilege('authenticated', p.oid, 'EXECUTE')
       AND NOT EXISTS (SELECT 1 FROM aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) a
                        WHERE a.grantee = 0 AND a.privilege_type = 'EXECUTE')
  ) THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: devolver_estoque tem assinatura, atributos ou permissoes diferentes dos esperados (EXECUTE so de quem a loja ja deu; nunca anon, authenticated nem PUBLIC).';
  END IF;
  -- plpgsql NAO valida tabela nem coluna ao criar a funcao: sem esta guarda, uma loja sem elas aceitaria o CREATE e a
  -- expiracao/cancelamento de pedido passaria a falhar em TODA chamada.
  IF (SELECT count(*) FROM pg_attribute a
       WHERE NOT a.attisdropped AND a.atttypid = 'uuid'::regtype
         AND ((a.attrelid = to_regclass('public.marketplace_order_items') AND a.attname IN ('order_id', 'product_id', 'variant_id'))
           OR (a.attrelid = to_regclass('public.product_variants') AND a.attname IN ('id', 'product_id'))
           OR (a.attrelid = to_regclass('public.produtos') AND a.attname = 'id'))) <> 6 THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: marketplace_order_items (order_id, product_id, variant_id), product_variants (id, product_id) e produtos (id) precisam existir como uuid; nada foi alterado.';
  END IF;
  -- Fotografia de OID, dono, ACL e TODOS os atributos: o CREATE OR REPLACE so pode trocar o texto (prosrc).
  PERFORM set_config('ikcous.devolver_estoque_atributos', v_atributos::text, true);
END $preflight_20261389100000$;

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

COMMENT ON FUNCTION public.devolver_estoque(uuid) IS
  'Idempotente desde 20261060000000 (laudo 0109, A8): credita o estoque do '
  'pedido NO MAXIMO uma vez na vida dele, guardado pela coluna-fato '
  'stock_returned_at. Desde 20261175000000 (achado C da revisão): credita '
  'só o que ainda não voltou à prateleira POR ITEM — o que uma devolução já '
  'concluiu (devolucao_itens.reestocado_em) é descontado aqui, para o '
  'cancelamento de um pedido entregue com devolução concluída não dobrar o '
  'estoque. REVOKE de EXECUTE mantido (sao os donos das RPCs quem chamam). '
  'Desde 20261389100000: tranca as linhas do pedido na ORDEM GLOBAL da compra '
  '(variacoes por id, depois produtos por id) antes de creditar, para nao '
  'formar deadlock (40P01) com uma compra simultanea; o credito nao muda.';

DO $conferencia_20261389100000$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p WHERE p.oid = to_regprocedure('public.devolver_estoque(uuid)')
      AND md5(replace(p.prosrc, E'\r', '')) = '943b226906e91013e7cccf4992617e35'
      AND (to_jsonb(p) - 'prosrc') = current_setting('ikcous.devolver_estoque_atributos')::jsonb
  ) THEN
    RAISE EXCEPTION 'B2_POSVOO_DIVERGENTE: conferencia 20261389100000 falhou (corpo ou atributos alterados).';
  END IF;
END $conferencia_20261389100000$;

NOTIFY pgrst, 'reload schema';
