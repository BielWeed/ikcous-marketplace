-- ============================================================================
-- Migration 20261640000000 — a devolução com a mesma chave não paga duas vezes
-- (DINHEIRO; achado do revisor Opus em 27/11/2026, no lote do prazo de 20 s da ficha do pedido)
-- ============================================================================
--
-- 1. O DEFEITO
--
-- Pedido online de R$ 200, cancelado. A lojista devolve R$ 50 pela ficha. `solicitar_estorno(pedido, 50, texto)` espera a
-- trava `FOR UPDATE` do pedido (outra transação está com ele) e a TELA desiste em 20 s (`useEstornosDoPedido`,
-- PRAZO_DAS_ACOES_DO_PEDIDO_MS), mas o SERVIDOR continua esperando e grava a linha depois. As releituras da tela, feitas
-- enquanto o servidor ainda espera, mostram R$ 200 disponíveis; ela toca "Devolver" de novo com R$ 50. A segunda
-- chamada é uma linha NOVA (a função não sabe que é a mesma intenção), a conta de saldo (200 − 50 = 150) deixa passar e
-- o Mercado Pago (MP) recebe DOIS pedidos de R$ 50 com chaves de idempotência diferentes (a chave do MP é o id da linha,
-- `_shared/estorno.ts`): o cliente recebe R$ 100. A trava de saldo só protege a devolução TOTAL; a trava do navegador
-- (`enviandoRef`) só o mesmo toque.
--
-- 2. O QUE ESTA MIGRATION FAZ (só coisas NOVAS; nenhum corpo existente muda, nenhum dado existente muda)
--
--   (a) COLUNA NOVA `order_refunds.chave_da_solicitacao uuid`, ANULÁVEL e SEM padrão: a chave que o painel gera UMA vez
--       por intenção de devolução e repete em toda retentativa da mesma intenção. Sem padrão de propósito: as linhas
--       que já existem ficam NULL (nada é reescrito) e as que outras portas criam (cancelamento, devolução de produto,
--       repetição da falhada, webhook) seguem NULL.
--   (b) ÍNDICE ÚNICO PARCIAL `uq_order_refunds_chave_da_solicitacao` (chave_da_solicitacao) WHERE NOT NULL: a mesma
--       chave nunca gera duas linhas, nem em corrida entre conexões. Parcial porque as linhas sem chave (todas as de
--       hoje e as das outras portas) não entram nele. Global (não por pedido): a chave é um UUID aleatório, e a mesma
--       chave em pedido diferente é defeito de quem chamou, recusado com frase.
--   (c) FUNÇÃO NOVA `public.solicitar_estorno_com_chave(p_order_id uuid, p_amount numeric, p_motivo text, p_chave uuid)
--       RETURNS jsonb` (SECURITY DEFINER, `search_path = public`, EXECUTE só do authenticated): as MESMAS portas e a
--       MESMA ordem de `solicitar_estorno` da 20261241000000 (is_admin(), is_admin_atual(), trava do pedido, pago,
--       cancelado, produto de volta, valor > 0, saldo pela conta única `pedido__saldo_a_estornar`), mais:
--         * a chave é obrigatória (sem ela, P0001);
--         * DEPOIS da trava do pedido, procura a linha da MESMA chave. Achou e é a mesma intenção (mesmo pedido, mesmo
--           valor em centavos): NÃO cria nada e devolve a linha que já existe (`refund_id`, `amount` e
--           `ja_registrada: true`), sem erro e sem rodar as recusas de novo (o pedido pode ter mudado depois da
--           primeira: a resposta ainda é a da primeira). Achou com outro pedido ou outro valor: recusa (P0001), porque
--           chave repetida com outro conteúdo é defeito de quem chamou;
--         * a linha nasce com a chave (`INSERT … ON CONFLICT (chave_da_solicitacao) WHERE … DO NOTHING`): duas chamadas
--           com a mesma chave no MESMO pedido já se enfileiram na trava do pedido (a segunda lê a linha da primeira
--           depois que ela grava); em pedidos DIFERENTES, o índice único faz a segunda esperar a primeira e não gravar,
--           e ela recusa com a mesma frase da chave repetida.
--       A resposta nova leva `ja_registrada: false`; as chaves `refund_id` e `amount` são as de `solicitar_estorno`.
--
-- 3. POR QUE UMA FUNÇÃO NOVA, E NÃO UM PARÂMETRO A MAIS EM `solicitar_estorno`
--
-- Duas `solicitar_estorno` (3 e 4 argumentos, o 4º com padrão) deixariam o PostgREST sem saber qual chamar com os 3
-- argumentos nomeados do front antigo (PGRST203): a ficha de quem ainda tem o app velho em cache pararia de devolver.
-- Trocar a assinatura (DROP da de 3 + CREATE da de 4) muda um objeto que a ficha 43a, a 8e, as portas permitidas e as
-- provas vivas da 20261241000000 fixam pela assinatura de 3 argumentos. A função nova não mexe em nada disso e é o
-- mesmo desenho da 20261399991000 (`solicitar_estorno_repetindo`, a função irmã para o "Tentar de novo", que JÁ é
-- idempotente pela marca da linha falhada e não precisa de chave). `solicitar_estorno` fica como está para o front
-- antigo: ele segue sujeito ao defeito até atualizar.
--
-- 4. DADOS EXISTENTES
--
-- Nenhuma linha de order_refunds, marketplace_orders ou devolucoes é lida ou escrita no apply. A coluna nasce NULL em
-- todas as linhas que já existem (ADD COLUMN sem padrão não reescreve a tabela) e o índice parcial nasce VAZIO.
--
-- 5. PRÉ-VOO (B1_BASELINE_DIVERGENT, ANTES de qualquer escrita)
--
-- Recusa se: faltar coluna que o corpo lê; `is_admin()`/`is_admin_atual()` não existirem; `pedido__saldo_a_estornar`
-- tiver corpo diferente do da 20261241000000 (md5); a coluna nova existir com outro tipo, NOT NULL ou padrão; o índice
-- existir com outra definição ou outro índice/restrição já usar a coluna; a função nova existir com corpo diferente ou
-- com sobrecarga. Estados aceitos: nada do que esta migration cria existe (aplica), tudo existe como desenhado
-- (reaplicar é no-op), ou só a coluna e o índice (depois do rollback comum: volta a função).
--
-- 6. IDEMPOTÊNCIA, TRANSAÇÃO E TRAVA
--
-- `ADD COLUMN IF NOT EXISTS` + `CREATE UNIQUE INDEX IF NOT EXISTS` + `CREATE OR REPLACE FUNCTION`: rodar duas vezes deixa
-- o mesmo estado. SEM BEGIN/COMMIT (regra da casa): o aplicador dá a transação; pré-voo, criações e conferência final
-- caem juntos ou não caem. `lock_timeout = 5s`: o ADD COLUMN pede a trava exclusiva de order_refunds por um instante
-- (só catálogo) e o índice trava a escrita da tabela enquanto lê as linhas que já existem (poucas: uma por devolução);
-- se alguém segurar a tabela, a migration desiste em 5 s em vez de enfileirar a loja atrás dela.
--
-- 7. FORA DO ESCOPO
--
-- Aplicar em loja; tirar o EXECUTE de `solicitar_estorno` (o front antigo ainda a chama); dar chave às outras portas que
-- criam linha (cancelamento, devolução de produto, repetição da falhada, webhook): nenhuma delas tem a corrida da tela.
--
-- 8. COMO APLICAR E ORDEM
--
-- Pelo aplicar-migrations.yml (ou `node scripts/db-apply.cjs <arquivo>`), sem BEGIN/COMMIT de nível superior neste
-- arquivo (regra da casa). DEPOIS da 20261241000000 (o pré-voo recusa sem ela). BANCO ANTES DO FRONT em CADA loja: o
-- front novo chama a função nova e, sem ela, o botão "Devolver" falha com função inexistente.
--
-- 9. FICHA DE VERIFICAÇÃO: consultas 200a (depois) / 200b (antes).
--   PROVA VIVA: tests/banco/a-devolucao-com-a-mesma-chave-nao-paga-duas-vezes-viva.cjs (rpc-ci).
--
-- 10. ROLLBACK
--
-- rollback-manual-20261640000000_a_devolucao_com_a_mesma_chave_nao_paga_duas_vezes.sql apaga SÓ a função (objeto novo:
-- não há corpo anterior a restaurar) e MANTÉM a coluna e o índice com as chaves já gravadas (reaplicar volta ao mesmo
-- estado). Quem apaga a coluna e o índice é o rollback-manual-destrutivo-20261640000000_…, só com o dono e só depois do
-- comum. Desfazer o FRONT antes (sem a função, o botão "Devolver" do front novo falha).
-- ============================================================================

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

DO $preflight_20261640000000$
DECLARE
  v_fn CONSTANT text := 'public.solicitar_estorno_com_chave(uuid,numeric,text,uuid)';
  v_oid oid := to_regprocedure('public.solicitar_estorno_com_chave(uuid,numeric,text,uuid)');
  v_hash text;
  v_coluna text;
  v_def text;
BEGIN
  -- O que o corpo lê e escreve.
  IF (SELECT count(*) FROM pg_attribute a
       WHERE a.attrelid = to_regclass('public.order_refunds') AND NOT a.attisdropped
         AND ((a.attname = 'id' AND a.atttypid = 'uuid'::regtype)
           OR (a.attname = 'order_id' AND a.atttypid = 'uuid'::regtype)
           OR (a.attname = 'amount' AND a.atttypid = 'numeric'::regtype)
           OR (a.attname = 'motivo' AND a.atttypid = 'text'::regtype)
           OR (a.attname = 'solicitado_por' AND a.atttypid = 'text'::regtype))) <> 5 THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: public.order_refunds não tem id, order_id (uuid), amount (numeric), motivo e solicitado_por (text) — meça a loja e revise antes de aplicar.';
  END IF;
  IF (SELECT count(*) FROM pg_attribute a
       WHERE a.attrelid = to_regclass('public.marketplace_orders') AND NOT a.attisdropped
         AND ((a.attname = 'status' AND a.atttypid = 'text'::regtype)
           OR (a.attname = 'payment_status' AND a.atttypid = 'text'::regtype)
           OR (a.attname = 'cancelled_after_shipping' AND a.atttypid = 'boolean'::regtype)
           OR (a.attname = 'returned_to_seller_at' AND a.atttypid = 'timestamp with time zone'::regtype))) <> 4 THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: public.marketplace_orders não tem status, payment_status (text), cancelled_after_shipping (boolean) e returned_to_seller_at (timestamptz) — meça a loja e revise antes de aplicar.';
  END IF;

  -- As portas de admin (20261197000000) e a conta única do saldo, com o corpo da 20261241000000.
  IF to_regprocedure('public.is_admin()') IS NULL OR to_regprocedure('public.is_admin_atual()') IS NULL THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: public.is_admin() ou public.is_admin_atual() não existe — aplique a 20261197000000 antes.';
  END IF;
  SELECT md5(replace(prosrc, E'\r', '')) INTO v_hash
    FROM pg_proc WHERE oid = to_regprocedure('public.pedido__saldo_a_estornar(uuid)');
  IF v_hash IS DISTINCT FROM '99741b4cdbf1e8d8340f80440e6da094' THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: pedido__saldo_a_estornar(uuid) com corpo desconhecido (hash %) — aplique a 20261241000000 ou revise antes de aplicar.', COALESCE(v_hash, 'ausente');
  END IF;

  -- A coluna nova: ausente, ou exatamente a desta migration (uuid, anulável, sem padrão).
  SELECT format_type(a.atttypid, a.atttypmod) || ':' || a.attnotnull::text || ':' || a.atthasdef::text INTO v_coluna
    FROM pg_attribute a
   WHERE a.attrelid = to_regclass('public.order_refunds') AND a.attname = 'chave_da_solicitacao' AND NOT a.attisdropped;
  IF v_coluna IS NOT NULL AND v_coluna <> 'uuid:false:false' THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: order_refunds.chave_da_solicitacao já existe com outra forma (%) — revise antes de aplicar.', v_coluna;
  END IF;

  -- O índice novo: ausente, ou exatamente o desta migration; e nenhum OUTRO índice (ou restrição) usando a coluna.
  IF to_regclass('public.uq_order_refunds_chave_da_solicitacao') IS NOT NULL THEN
    SELECT pg_get_indexdef(to_regclass('public.uq_order_refunds_chave_da_solicitacao')) INTO v_def;
    IF v_def IS DISTINCT FROM 'CREATE UNIQUE INDEX uq_order_refunds_chave_da_solicitacao ON public.order_refunds USING btree (chave_da_solicitacao) WHERE (chave_da_solicitacao IS NOT NULL)' THEN
      RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: public.uq_order_refunds_chave_da_solicitacao já existe com outra definição (%) — revise antes de aplicar.', v_def;
    END IF;
  END IF;
  IF v_coluna IS NOT NULL AND EXISTS (
       SELECT 1 FROM pg_index i
        WHERE i.indrelid = to_regclass('public.order_refunds')
          AND i.indexrelid IS DISTINCT FROM to_regclass('public.uq_order_refunds_chave_da_solicitacao')
          AND (SELECT a.attnum FROM pg_attribute a
                WHERE a.attrelid = i.indrelid AND a.attname = 'chave_da_solicitacao') = ANY (i.indkey)
     ) THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: outro índice de order_refunds já usa chave_da_solicitacao — revise antes de aplicar.';
  END IF;

  -- A função nova: ausente, ou exatamente a desta migration.
  IF (SELECT count(*) FROM pg_proc p
       WHERE p.pronamespace = 'public'::regnamespace AND p.proname = 'solicitar_estorno_com_chave') > 1 THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: solicitar_estorno_com_chave tem sobrecarga em public — meça a loja e revise antes de aplicar.';
  END IF;
  IF v_oid IS NOT NULL THEN
    SELECT md5(replace(prosrc, E'\r', '')) INTO v_hash FROM pg_proc WHERE oid = v_oid;
    IF v_hash IS DISTINCT FROM '2021a69d46d49d227e4f1f206eb8df02' THEN
      RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: % já existe com corpo desconhecido (hash %) — ninguém revisou essa redefinição; capture o corpo vivo e revise antes de aplicar.', v_fn, COALESCE(v_hash, 'ausente');
    END IF;
  ELSIF EXISTS (SELECT 1 FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname = 'solicitar_estorno_com_chave') THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: solicitar_estorno_com_chave existe em public com outra assinatura — revise antes de aplicar.';
  END IF;
END $preflight_20261640000000$;

-- ---------------------------------------------------------------------------
-- 1. A chave da intenção, guardada na linha
-- ---------------------------------------------------------------------------
ALTER TABLE public.order_refunds
  ADD COLUMN IF NOT EXISTS chave_da_solicitacao uuid;

COMMENT ON COLUMN public.order_refunds.chave_da_solicitacao IS
  'Chave que o painel gera UMA vez por intenção de devolução da lojista e repete em toda retentativa dela (tela que desistiu de esperar, reenvio depois do "não dá para saber"). A mesma chave nunca gera duas linhas (uq_order_refunds_chave_da_solicitacao): solicitar_estorno_com_chave devolve a linha que já existe. NULL nas linhas de antes da 20261640000000 e nas das outras portas (cancelamento, devolução de produto, repetição, webhook). Não é a chave do Mercado Pago (essa é o id da linha).';

-- ---------------------------------------------------------------------------
-- 2. A mesma chave, uma linha só
-- ---------------------------------------------------------------------------
CREATE UNIQUE INDEX IF NOT EXISTS uq_order_refunds_chave_da_solicitacao
  ON public.order_refunds (chave_da_solicitacao)
  WHERE chave_da_solicitacao IS NOT NULL;

COMMENT ON INDEX public.uq_order_refunds_chave_da_solicitacao IS
  'A mesma chave de intenção (solicitar_estorno_com_chave) nunca gera duas linhas de devolução, nem em corrida entre conexões. Parcial: as linhas sem chave (todas as de antes da 20261640000000 e as das outras portas) ficam fora.';

-- ---------------------------------------------------------------------------
-- 3. A função: pedir a devolução com a chave da intenção
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.solicitar_estorno_com_chave(
    p_order_id uuid,
    p_amount numeric,
    p_motivo text,
    p_chave uuid
)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
    v_status TEXT;
    v_payment_status TEXT;
    v_cancelled_after_shipping BOOLEAN;
    v_returned_at TIMESTAMPTZ;
    v_saldo NUMERIC;
    v_refund_id UUID;
    v_existente public.order_refunds%ROWTYPE;
BEGIN
    -- So' a loja pede devolucao pelo painel (as mesmas duas portas de solicitar_estorno): 42501 para o front
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

    -- Sem a chave nao ha como reconhecer a mesma intencao: quem nao tem chave usa solicitar_estorno.
    IF p_chave IS NULL THEN
        RAISE EXCEPTION 'Informe a chave desta devolução.'
            USING ERRCODE = 'P0001';
    END IF;

    SELECT status, payment_status, cancelled_after_shipping, returned_to_seller_at
      INTO v_status, v_payment_status, v_cancelled_after_shipping, v_returned_at
      FROM public.marketplace_orders
     WHERE id = p_order_id
       FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Pedido não encontrado.';
    END IF;

    -- A MESMA INTENCAO DE NOVO (a tela desistiu de esperar e a lojista tocou de novo, ou o reenvio depois do "nao da
    -- para saber"). Lida DEPOIS da trava do pedido: a segunda chamada so' chega aqui quando a primeira ja gravou.
    -- Nao cria nada e nao roda as recusas de novo: devolve a linha que ja existe.
    SELECT * INTO v_existente
      FROM public.order_refunds
     WHERE chave_da_solicitacao = p_chave;
    IF FOUND THEN
        IF v_existente.order_id IS DISTINCT FROM p_order_id
           OR v_existente.amount IS DISTINCT FROM round(p_amount, 2) THEN
            RAISE EXCEPTION 'Esta chave já foi usada em outra devolução. Peça a devolução de novo.'
                USING ERRCODE = 'P0001';
        END IF;
        RETURN jsonb_build_object(
            'refund_id', v_existente.id,
            'amount', v_existente.amount,
            'ja_registrada', true
        );
    END IF;

    -- As mesmas portas de solicitar_estorno (20261241000000), na mesma ordem.
    IF v_payment_status IS NULL
       OR v_payment_status NOT IN ('pago', 'pago_apos_expirar') THEN
        RAISE EXCEPTION 'Este pedido não está pago: não há dinheiro do Mercado Pago para devolver.'
            USING ERRCODE = 'P0001';
    END IF;

    IF v_status IS DISTINCT FROM 'cancelled' THEN
        RAISE EXCEPTION 'Cancele o pedido antes de devolver o dinheiro.';
    END IF;

    IF v_cancelled_after_shipping AND v_returned_at IS NULL THEN
        RAISE EXCEPTION 'A devolução espera o produto: ele ainda não voltou para a loja.'
            USING ERRCODE = 'P0001';
    END IF;

    -- A conta UNICA do saldo (20261241000000).
    v_saldo := public.pedido__saldo_a_estornar(p_order_id);

    IF p_amount IS NULL OR p_amount <= 0 THEN
        RAISE EXCEPTION 'O valor a devolver tem de ser maior que zero.';
    END IF;

    IF p_amount > v_saldo THEN
        RAISE EXCEPTION 'O valor pedido (R$ %) é maior que o valor disponível para devolver (R$ %).',
            to_char(p_amount, 'FM999G999D00'), to_char(v_saldo, 'FM999G999D00')
            USING ERRCODE = 'P0001';
    END IF;

    -- A linha nasce COM a chave. No mesmo pedido a trava acima ja enfileirou a mesma chave; em pedido DIFERENTE, o
    -- indice unico faz esta esperar a outra e nao gravar (ON CONFLICT DO NOTHING devolve nada).
    INSERT INTO public.order_refunds (order_id, amount, motivo, solicitado_por, chave_da_solicitacao)
    VALUES (p_order_id, p_amount, NULLIF(trim(COALESCE(p_motivo, '')), ''), 'lojista', p_chave)
    ON CONFLICT (chave_da_solicitacao) WHERE chave_da_solicitacao IS NOT NULL DO NOTHING
    RETURNING id INTO v_refund_id;

    IF v_refund_id IS NULL THEN
        RAISE EXCEPTION 'Esta chave já foi usada em outra devolução. Peça a devolução de novo.'
            USING ERRCODE = 'P0001';
    END IF;

    RETURN jsonb_build_object(
        'refund_id', v_refund_id,
        'amount', p_amount,
        'ja_registrada', false
    );
END;
$function$;

COMMENT ON FUNCTION public.solicitar_estorno_com_chave(uuid, numeric, text, uuid) IS
  'O botão "Devolver" do painel (20261640000000): as portas de solicitar_estorno (admin de agora, pedido pago e cancelado, produto de volta, saldo da conta única) com a chave da intenção da lojista. A mesma chave devolve a linha que já existe (ja_registrada: true) em vez de criar outra; chave repetida com outro pedido ou outro valor é recusada.';

REVOKE ALL ON FUNCTION public.solicitar_estorno_com_chave(uuid, numeric, text, uuid) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.solicitar_estorno_com_chave(uuid, numeric, text, uuid) TO authenticated;

-- CONFERÊNCIA no instante do apply: aborta se a coluna, o índice ou a função não ficaram como desenhados.
DO $conferencia_20261640000000$
DECLARE
  v_fn CONSTANT text := 'public.solicitar_estorno_com_chave(uuid,numeric,text,uuid)';
  v_oid oid := to_regprocedure('public.solicitar_estorno_com_chave(uuid,numeric,text,uuid)');
  v_hash text;
  v_coluna text;
BEGIN
  SELECT format_type(a.atttypid, a.atttypmod) || ':' || a.attnotnull::text || ':' || a.atthasdef::text INTO v_coluna
    FROM pg_attribute a
   WHERE a.attrelid = to_regclass('public.order_refunds') AND a.attname = 'chave_da_solicitacao' AND NOT a.attisdropped;
  IF v_coluna IS DISTINCT FROM 'uuid:false:false' THEN
    RAISE EXCEPTION 'conferencia 20261640000000: order_refunds.chave_da_solicitacao não ficou uuid, anulável e sem padrão (%)', COALESCE(v_coluna, 'ausente');
  END IF;
  IF pg_get_indexdef(to_regclass('public.uq_order_refunds_chave_da_solicitacao'))
       IS DISTINCT FROM 'CREATE UNIQUE INDEX uq_order_refunds_chave_da_solicitacao ON public.order_refunds USING btree (chave_da_solicitacao) WHERE (chave_da_solicitacao IS NOT NULL)'
     OR NOT EXISTS (SELECT 1 FROM pg_index i
                     WHERE i.indexrelid = to_regclass('public.uq_order_refunds_chave_da_solicitacao')
                       AND i.indisvalid AND i.indisready) THEN
    RAISE EXCEPTION 'conferencia 20261640000000: o índice único parcial de chave_da_solicitacao não ficou como desenhado (ou não está válido)';
  END IF;

  IF v_oid IS NULL THEN
    RAISE EXCEPTION 'conferencia 20261640000000: % sumiu', v_fn;
  END IF;
  IF (SELECT count(*) FROM pg_proc p
       WHERE p.pronamespace = 'public'::regnamespace AND p.proname = 'solicitar_estorno_com_chave') <> 1 THEN
    RAISE EXCEPTION 'conferencia 20261640000000: solicitar_estorno_com_chave ficou com sobrecarga';
  END IF;
  SELECT md5(replace(prosrc, E'\r', '')) INTO v_hash FROM pg_proc WHERE oid = v_oid;
  IF v_hash IS DISTINCT FROM '2021a69d46d49d227e4f1f206eb8df02' THEN
    RAISE EXCEPTION 'conferencia 20261640000000: corpo vivo de % (hash %) não é o desta migration', v_fn, COALESCE(v_hash, 'ausente');
  END IF;
  IF NOT EXISTS (
       SELECT 1 FROM pg_proc p JOIN pg_language l ON l.oid = p.prolang
        WHERE p.oid = v_oid
          AND l.lanname = 'plpgsql'
          AND p.prosecdef
          AND p.provolatile = 'v'
          AND NOT p.proisstrict
          AND NOT p.proretset
          AND p.prorettype = 'jsonb'::regtype
          AND p.pronargs = 4
          AND p.pronargdefaults = 0
          AND p.proconfig = ARRAY['search_path=public']::text[]
     ) THEN
    RAISE EXCEPTION 'conferencia 20261640000000: atributos de % mudaram (SECURITY DEFINER, volatilidade, search_path, retorno ou argumentos)', v_fn;
  END IF;
  -- EXECUTE só do authenticated: nem PUBLIC, nem anon, nem service_role.
  IF EXISTS (SELECT 1 FROM pg_proc p
               CROSS JOIN LATERAL aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) g
              WHERE p.oid = v_oid AND g.privilege_type = 'EXECUTE' AND g.grantee = 0) THEN
    RAISE EXCEPTION 'conferencia 20261640000000: % alcancavel por PUBLIC', v_fn;
  END IF;
  IF has_function_privilege('anon', v_oid, 'EXECUTE')
     OR has_function_privilege('service_role', v_oid, 'EXECUTE')
     OR NOT has_function_privilege('authenticated', v_oid, 'EXECUTE') THEN
    RAISE EXCEPTION 'conferencia 20261640000000: o EXECUTE de % deve ser só do authenticated', v_fn;
  END IF;
END $conferencia_20261640000000$;
