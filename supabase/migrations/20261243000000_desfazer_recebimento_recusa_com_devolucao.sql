-- ============================================================================
-- Migration 20261243000000 — desfazer o recebimento recusa pedido com devolução
-- (dinheiro; 15/10/2026; só troca o corpo de UMA função)
-- ============================================================================
--
-- 1. O QUE ESTA MIGRATION CORRIGE
--
-- public.registrar_pagamento_recebido(p_order_id, p_recebido) é o "Recebi" / "Desfazer
-- recebimento" do painel (pedido pago na mão: dinheiro, PIX na chave, maquininha). O ramo
-- de DESFAZER voltava o pagamento a vazio e apagava a data do recebimento sem olhar a
-- devolução do pedido. Efeito medido no código:
--   * o Financeiro (fin__movimentos) só conta a venda com pagamento marcado E data, então a
--     venda SOME do extrato, mas a saída do reembolso da devolução fica: prejuízo falso;
--   * uma devolução aberta fica travada ("Este pedido não tem pagamento registrado para
--     devolver"): o lojista não consegue concluí-la nem reemitir o reembolso.
--
-- 2. A CORREÇÃO (UM bloco, nada além)
--
-- No ramo de desfazer, DEPOIS de confirmar que o pagamento está mesmo como
-- 'recebido_na_entrega' e ANTES de qualquer escrita, a função recusa quando o pedido tem
-- devolução viva, com a frase:
--   'Este pedido tem devolução: conclua, recuse ou cancele a devolução antes de desfazer o recebimento'
-- Devolução viva = a mesma regra da anulação da venda do balcão (20261204000000, item 8) e
-- de solicitar_devolucao (20261175000000): qualquer status que NÃO seja 'recusada',
-- 'cancelada' nem 'reprovada' (solicitada, aprovada, em_transito, recebida e concluida
-- recusam; as três que encerram sem dinheiro liberam). 'reprovada' entra na lista de quem
-- libera porque é o produto recebido e reprovado na inspeção: a devolução se encerra sem
-- reembolso (admin_devolucao_reprovar), então não há saída a proteger.
--
-- 3. A CORRIDA (a trava do pedido)
--
-- A função já fazia SELECT ... FOR UPDATE do pedido antes de decidir. A checagem vem DEPOIS
-- dessa trava e lê devolucoes em comando novo (READ COMMITTED enxerga o que commitou
-- enquanto esperava). solicitar_devolucao trava o MESMO pedido (FOR UPDATE) antes de
-- inserir a devolução: ou a devolução já está commitada quando esta função olha (recusa),
-- ou espera esta transação terminar e então lê o pagamento já vazio ("Este pedido não tem
-- pagamento a devolver"). Não há janela com devolução viva E pagamento desfeito. Ordem de
-- travas: esta função só trava o pedido (nunca linhas de order_refunds), e devolucoes só é
-- LIDA, sem trava — não nasce ciclo de espera com admin_devolucao_concluir (devolução ->
-- ledger -> pedido) nem com a ordem global da 20261198000000.
--
-- 4. O QUE NÃO MUDA
--
--   * "Recebi" (p_recebido = true) e o desfazer de pedido SEM devolução viva: iguais.
--   * Desfazer quando o pagamento já NÃO está 'recebido_na_entrega' continua devolvendo
--     ja_estava = true sem escrever (a checagem fica dentro do ramo que escreve).
--   * Todas as outras recusas, na mesma ordem e com as mesmas frases (não autorizado, admin
--     atual, NULL = 22004, pedido inexistente, cancelado, online, pagamento por cima).
--   * Assinatura, RETURNS, SECURITY DEFINER, search_path = public, dono, ACL e comentário:
--     CREATE OR REPLACE preserva tudo isso e este arquivo NÃO tem GRANT, REVOKE nem COMMENT.
--   * O front (src/hooks/useOrders.ts) já mostra a mensagem do servidor no aviso de erro:
--     nenhuma tela muda. A recusa é um RAISE EXCEPTION simples (P0001), como as demais
--     recusas de negócio desta função.
--
-- 5. DADOS EXISTENTES
--
-- Nenhuma linha é lida nem escrita ao aplicar: só o corpo de UMA função muda. Pedido que JÁ
-- teve o recebimento desfeito com devolução aberta (o defeito de antes) fica como está —
-- a migration só vale para o próximo clique; quem tem esse caso refaz o "Recebi" (que
-- continua permitido) e depois resolve a devolução.
--
-- 6. PRÉ-VOO (B1_BASELINE_DIVERGENT, ANTES de qualquer escrita)
--
-- Recusa se: a função não existir ou tiver sobrecarga; o corpo vivo (md5 de
-- replace(prosrc, E'\r', '')) não for UM dos dois conhecidos (o da 20261197000000 —
-- 6584d62da7815a913b1e0cb86c108b0f — ou o desta migration — 7f448f9d84e86f0664e60cb61562716d); os atributos não forem os de sempre
-- (plpgsql, SECURITY DEFINER, VOLATILE, não STRICT, search_path = public, retorna jsonb,
-- 2 argumentos); a ACL não for a de hoje (EXECUTE para authenticated e service_role; PUBLIC e
-- anon sem); ou faltarem as tabelas/colunas de que o corpo depende. Os hashes são o md5 REAL
-- dos corpos, amarrados ao texto por tests/migration_desfazer_recebimento_recusa_com_devolucao_test.ts
-- e à prova viva tests/banco/desfazer-recebimento-viva.cjs. Um pós-voo, no fim do arquivo,
-- confere que o corpo gravado é o esperado e que atributos e ACL continuam os mesmos.
--
-- 7. IDEMPOTÊNCIA E TRANSAÇÃO
--
-- Dois estados de entrada aceitos: corpo da 20261197000000 (aplica) ou corpo desta migration
-- (reaplicar reescreve o MESMO texto). Qualquer outro estado ABORTA sem gravar. Sem
-- BEGIN/COMMIT de nível superior (regra da casa, AGENTS.md: com eles o ROLLBACK da prova do
-- workflow vira no-op, e o aplicar-migrations.yml recusa controle de transação no corpo): o
-- workflow manda o arquivo inteiro numa consulta só, e o pré-voo, a troca do corpo e o
-- pós-voo caem juntos ou não caem.
--
-- 8. ORDEM E ROLLBACK
--
-- Depois da 20261197000000 (o pré-voo recusa sem o corpo dela). Não depende de nenhuma
-- migration nova, nem de front. ROLLBACK MANUAL:
-- rollback-manual-20261243000000_desfazer_recebimento_recusa_com_devolucao.sql devolve o
-- corpo da 20261197000000 byte a byte. Com a 43 no ar, o rollback-manual da 20261197000000
-- (e o da 20261195000000) RECUSA por hash — correto: desfaz-se a 43 primeiro.
--
-- 9. FICHA DE VERIFICAÇÃO (contra o banco vivo)
--
--   1. SELECT md5(replace(prosrc, E'\r', '')) FROM pg_proc
--       WHERE oid = to_regprocedure('public.registrar_pagamento_recebido(uuid, boolean)');
--      -- esperado: 7f448f9d84e86f0664e60cb61562716d
--   2. proacl, prosecdef e proconfig iguais antes e depois (esperado hoje:
--      {postgres=X/postgres,authenticated=X/postgres,service_role=X/postgres}, true,
--      {search_path=public}).
--   PROVA VIVA: tests/banco/desfazer-recebimento-viva.cjs (rpc-ci).
-- ============================================================================

DO $preflight_20261243$
DECLARE
  v_fn CONSTANT text := 'public.registrar_pagamento_recebido(uuid, boolean)';
  v_oid oid := to_regprocedure('public.registrar_pagamento_recebido(uuid, boolean)');
  v_hash text;
  v_item text;
  r record;
BEGIN
  IF v_oid IS NULL THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: % não existe.', v_fn;
  END IF;
  IF (SELECT count(*) FROM pg_proc p
       WHERE p.pronamespace = 'public'::regnamespace AND p.proname = 'registrar_pagamento_recebido') <> 1 THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: registrar_pagamento_recebido tem sobrecarga em public — revise antes de aplicar.';
  END IF;

  -- Corpo identificado pelo CONTEÚDO: o vigente (o da 20261197000000, aplica) ou o desta migration (reaplicar é no-op).
  FOR r IN
    SELECT *
      FROM (VALUES
        ('public.registrar_pagamento_recebido(uuid, boolean)', '6584d62da7815a913b1e0cb86c108b0f', '7f448f9d84e86f0664e60cb61562716d')
      ) AS esperado(assinatura, hash_vigente, hash_desta)
  LOOP
    SELECT md5(replace(prosrc, E'\r', '')) INTO v_hash
      FROM pg_proc
     WHERE oid = to_regprocedure(r.assinatura);

    IF v_hash IS NULL OR v_hash NOT IN (r.hash_vigente, r.hash_desta) THEN
      RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: corpo vivo de % (hash %) não é o vigente (20261197000000) nem o que esta migration deixa — capture o corpo vivo e revise antes de aplicar.', r.assinatura, COALESCE(v_hash, 'ausente');
    END IF;
  END LOOP;

  -- Atributos que o CREATE OR REPLACE reescreve: têm de ser os de sempre.
  IF NOT EXISTS (
       SELECT 1 FROM pg_proc p JOIN pg_language l ON l.oid = p.prolang
        WHERE p.oid = v_oid
          AND l.lanname = 'plpgsql'
          AND p.prosecdef
          AND p.provolatile = 'v'
          AND NOT p.proisstrict
          AND NOT p.proretset
          AND p.proconfig = ARRAY['search_path=public']::text[]
          AND pg_get_function_result(p.oid) = 'jsonb'
          AND p.pronargs = 2
     ) THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: atributos de % (linguagem, SECURITY DEFINER, volatilidade, STRICT, search_path, retorno ou argumentos) não são os conhecidos — revise antes de aplicar.', v_fn;
  END IF;

  -- ACL exatamente a de hoje: EXECUTE para authenticated e service_role; PUBLIC (grantee = 0) e anon sem.
  IF NOT has_function_privilege('authenticated', v_oid, 'EXECUTE')
     OR NOT has_function_privilege('service_role', v_oid, 'EXECUTE')
     OR has_function_privilege('anon', v_oid, 'EXECUTE')
     OR EXISTS (SELECT 1 FROM pg_proc p
                  CROSS JOIN LATERAL aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) g
                 WHERE p.oid = v_oid AND g.privilege_type = 'EXECUTE' AND g.grantee = 0) THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: ACL de % não é a conhecida (EXECUTE só para authenticated e service_role) — revise antes de aplicar.', v_fn;
  END IF;

  -- O que o corpo lê.
  FOREACH v_item IN ARRAY ARRAY[
    'public.is_admin()',
    'public.is_admin_atual()'
  ] LOOP
    IF to_regprocedure(v_item) IS NULL THEN
      RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: falta a função % — aplique antes a migration 20261197000000.', v_item;
    END IF;
  END LOOP;
  FOREACH v_item IN ARRAY ARRAY[
    'public.marketplace_orders',
    'public.marketplace_order_payment_history',
    'public.devolucoes'
  ] LOOP
    IF to_regclass(v_item) IS NULL THEN
      RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: falta a tabela % — aplique as migrations anteriores (20261175000000 devolucoes, 20261020000000 histórico de pagamento).', v_item;
    END IF;
  END LOOP;
  FOR r IN
    SELECT *
      FROM (VALUES
        ('marketplace_orders', 'payment_status'),
        ('marketplace_orders', 'payment_method'),
        ('marketplace_orders', 'pagamento_recebido_em'),
        ('marketplace_orders', 'pagamento_recebido_por'),
        ('devolucoes', 'order_id'),
        ('devolucoes', 'status')
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
      RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: falta a coluna public.%.% — aplique as migrations anteriores antes desta.', r.tabela, r.coluna;
    END IF;
  END LOOP;
END $preflight_20261243$;

CREATE OR REPLACE FUNCTION public.registrar_pagamento_recebido(
    p_order_id uuid,
    p_recebido boolean
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_status          TEXT;
    v_payment_status  TEXT;
    v_payment_method  TEXT;
    v_caller          UUID := auth.uid();
    v_antes           TEXT;
    v_depois          TEXT;
    v_ja_estava       BOOLEAN := FALSE;
    v_recebido_em     TIMESTAMPTZ;
    v_recebido_por    UUID;
BEGIN
    IF NOT public.is_admin() THEN
        RAISE EXCEPTION 'Não autorizado: só a loja registra pagamento recebido.';
    END IF;

    -- Papel ATUAL (auth.users E profiles), não o do JWT: admin rebaixado para aqui (20261197000000).
    IF NOT public.is_admin_atual() THEN
        RAISE EXCEPTION 'Não autorizado: só a loja registra pagamento recebido.';
    END IF;

    -- NULL nao e nem "recebi" nem "desfiz": sem esta recusa o ELSE de
    -- `IF p_recebido` o tratava como DESFAZER (20261195000000). Vem DEPOIS da
    -- autorizacao (quem nao e admin nao aprende nada) e ANTES do SELECT ... FOR
    -- UPDATE, para recusar sem esperar a linha de quem esta gravando.
    IF p_recebido IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = '22004',
            MESSAGE = 'Informe se o pagamento foi recebido (true) ou desfeito (false).';
    END IF;

    SELECT status, payment_status, payment_method,
           pagamento_recebido_em, pagamento_recebido_por
      INTO v_status, v_payment_status, v_payment_method,
           v_recebido_em, v_recebido_por
      FROM public.marketplace_orders
     WHERE id = p_order_id
     FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Pedido não encontrado.';
    END IF;

    IF v_status = 'cancelled' THEN
        RAISE EXCEPTION 'Pedido cancelado não recebe pagamento.';
    END IF;

    IF v_payment_method = 'online' THEN
        RAISE EXCEPTION 'Este pedido é pago pelo site: quem confirma o pagamento é o gateway, não a loja.';
    END IF;

    v_antes := v_payment_status;

    IF p_recebido THEN
        IF v_payment_status = 'recebido_na_entrega' THEN
            v_ja_estava := TRUE;
            v_depois := v_payment_status;
        ELSIF v_payment_status IS NOT NULL THEN
            RAISE EXCEPTION 'Este pedido já tem pagamento registrado como "%": não dá para marcar recebimento na entrega por cima.', v_payment_status;
        ELSE
            v_depois := 'recebido_na_entrega';
            UPDATE public.marketplace_orders
               SET payment_status = v_depois,
                   pagamento_recebido_em = now(),
                   pagamento_recebido_por = v_caller,
                   updated_at = now()
             WHERE id = p_order_id
             RETURNING pagamento_recebido_em, pagamento_recebido_por
                  INTO v_recebido_em, v_recebido_por;
        END IF;
    ELSE
        IF v_payment_status IS DISTINCT FROM 'recebido_na_entrega' THEN
            v_ja_estava := TRUE;
            v_depois := v_payment_status;
        ELSE
            -- Devolução viva (20261243000000): desfazer o recebimento apagaria a venda do
            -- Financeiro (pagamento + data) mas deixaria a saída do reembolso, e a devolução
            -- aberta ficaria sem pagamento para devolver. O critério é o da anulação do balcão
            -- (20261204000000, item 8) e o de solicitar_devolucao: tudo que NÃO é recusada,
            -- cancelada nem reprovada. O pedido já está travado (FOR UPDATE acima) e
            -- solicitar_devolucao trava o MESMO pedido antes de inserir: a devolução nova ou
            -- já está commitada e aparece aqui, ou espera esta transação e vê o pagamento vazio.
            IF EXISTS (
                SELECT 1 FROM public.devolucoes d
                 WHERE d.order_id = p_order_id
                   AND d.status NOT IN ('recusada', 'cancelada', 'reprovada')
            ) THEN
                RAISE EXCEPTION 'Este pedido tem devolução: conclua, recuse ou cancele a devolução antes de desfazer o recebimento';
            END IF;

            v_depois := NULL;
            UPDATE public.marketplace_orders
               SET payment_status = NULL,
                   pagamento_recebido_em = NULL,
                   pagamento_recebido_por = NULL,
                   updated_at = now()
             WHERE id = p_order_id;
            v_recebido_em := NULL;
            v_recebido_por := NULL;
        END IF;
    END IF;

    IF NOT v_ja_estava THEN
        INSERT INTO public.marketplace_order_payment_history
            (order_id, acao, payment_status_antes, payment_status_depois, created_by)
        VALUES
            (p_order_id,
             CASE WHEN p_recebido THEN 'recebido' ELSE 'desfeito' END,
             v_antes, v_depois, v_caller);
    END IF;

    RETURN jsonb_build_object(
        'order_id', p_order_id,
        'payment_status', v_depois,
        'pagamento_recebido_em', v_recebido_em,
        'pagamento_recebido_por', v_recebido_por,
        'ja_estava', v_ja_estava
    );
END;
$$;

-- Pós-voo: o corpo que ficou é o desta migration (md5 sem CR); senão a transação inteira cai.
DO $posvoo_20261243$
DECLARE
  v_fn CONSTANT text := 'public.registrar_pagamento_recebido(uuid, boolean)';
  v_oid oid := to_regprocedure('public.registrar_pagamento_recebido(uuid, boolean)');
  v_hash text;
BEGIN
  SELECT md5(replace(prosrc, E'\r', '')) INTO v_hash
    FROM pg_proc
   WHERE oid = to_regprocedure('public.registrar_pagamento_recebido(uuid, boolean)');

  IF v_hash IS DISTINCT FROM '7f448f9d84e86f0664e60cb61562716d' THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: depois do CREATE OR REPLACE o corpo vivo de public.registrar_pagamento_recebido(uuid, boolean) tem hash % e devia ter 7f448f9d84e86f0664e60cb61562716d — a migration não vale.', COALESCE(v_hash, 'ausente');
  END IF;

  IF v_oid IS NULL OR NOT EXISTS (
       SELECT 1 FROM pg_proc p JOIN pg_language l ON l.oid = p.prolang
        WHERE p.oid = v_oid
          AND l.lanname = 'plpgsql'
          AND p.prosecdef
          AND p.provolatile = 'v'
          AND NOT p.proisstrict
          AND NOT p.proretset
          AND p.proconfig = ARRAY['search_path=public']::text[]
          AND pg_get_function_result(p.oid) = 'jsonb'
          AND p.pronargs = 2
     ) THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: depois do CREATE OR REPLACE os atributos de % mudaram — a migração não vale.', v_fn;
  END IF;

  -- ACL exatamente a de hoje: EXECUTE para authenticated e service_role; PUBLIC (grantee = 0) e anon sem.
  IF NOT has_function_privilege('authenticated', v_oid, 'EXECUTE')
     OR NOT has_function_privilege('service_role', v_oid, 'EXECUTE')
     OR has_function_privilege('anon', v_oid, 'EXECUTE')
     OR EXISTS (SELECT 1 FROM pg_proc p
                  CROSS JOIN LATERAL aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) g
                 WHERE p.oid = v_oid AND g.privilege_type = 'EXECUTE' AND g.grantee = 0) THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: ACL de % não é a conhecida (EXECUTE só para authenticated e service_role) — a migração não vale.', v_fn;
  END IF;
END $posvoo_20261243$;
