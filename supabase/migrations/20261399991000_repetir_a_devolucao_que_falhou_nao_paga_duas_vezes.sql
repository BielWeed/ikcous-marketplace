-- ============================================================================
-- Migration 20261399991000 — repetir a devolução que falhou não paga duas vezes
-- (DINHEIRO; achado de leitura estática de 13/11/2026, confirmado no código: "Tentar de novo" em duas abas)
-- ============================================================================
--
-- 1. O DEFEITO
--
-- Pedido online de R$ 100, cancelado, produto de volta. Uma devolução de R$ 30 FALHOU e o Mercado Pago (MP)
-- garantiu que nada saiu (ex.: `insufficient_money_for_refund`), então a linha não conta no saldo. A lojista abre
-- a ficha em duas abas (ou duas pessoas da loja abrem) e toca "Tentar de novo" na MESMA linha falhada nas duas.
-- Hoje o botão chama `solicitar_estorno(pedido, 30, texto)`, que NÃO sabe qual linha está sendo repetida: cada
-- chamada cria uma linha NOVA. A segunda espera a primeira pelo `FOR UPDATE` do pedido, enxerga 100 − 30 reservados
-- = 70 de saldo e também passa; as duas viram `solicitado` com ids diferentes e a chave de idempotência do MP é o
-- id da linha (`_shared/estorno.ts`, X-Idempotency-Key = linha.id), então o MP recebe DOIS pedidos de R$ 30: saem
-- R$ 60 quando a intenção era repetir só R$ 30. Nada no banco diz "esta linha já foi repetida": a trava de saldo
-- protege só o total, e a trava do navegador (`enviandoRef`) só a aba em que o clique aconteceu.
--
-- 2. O QUE ESTA MIGRATION FAZ (só objetos NOVOS; nenhum corpo existente muda, nenhum dado existente muda)
--
--   (a) TABELA NOVA `public.order_refund_repeticao` (refund_id PK, nova_refund_id UNIQUE, created_at), só do
--       servidor (RLS ligada, nenhuma policy, nenhum privilégio para ninguém de aplicação), como a
--       `order_refund_prova` da 20261241000000. Uma linha diz "a linha `refund_id` (falhada) foi repetida pela linha
--       `nova_refund_id`". A PK impede DUAS repetições da mesma falhada; a UNIQUE impede a mesma nova linha de
--       repetir duas falhadas. Isto é o que o banco passa a saber e antes não sabia. (Tabela nova em vez de coluna
--       em `order_refund_prova`: a ficha 43a fixa as TRÊS colunas dela, e uma quarta a deixaria vermelha.)
--   (b) FUNÇÃO NOVA `public.solicitar_estorno_repetindo(p_refund_id uuid, p_motivo text) RETURNS jsonb`
--       (SECURITY DEFINER, `search_path = public`, EXECUTE só do authenticated): repete UMA linha falhada. O VALOR
--       sai da linha, nunca do chamador. Mesmas portas de `solicitar_estorno` (`is_admin()` e `is_admin_atual()`,
--       pedido pago, cancelado, produto de volta, saldo da conta única `pedido__saldo_a_estornar`), mais:
--         * a linha tem de ser `falhou`/`recusado`, de loja ou de cliente (nunca `sistema`), sem devolução de
--           produto ligada (essa repete pela tela de Devoluções, `reemitir_reembolso_da_devolucao`);
--         * `NOT order_refund__pode_ter_saido(linha)` (a regra única: se o dinheiro PODE ter saído, nunca ganha
--           chave nova) e sem as marcas de `order_refund_prova` (substituída por reembolso manual, liberada
--           "por fora");
--         * se a linha JÁ foi repetida (duas abas, dois lojistas, tela velha, botão que sobrou depois do sucesso),
--           NÃO cria nada: devolve `ja_repetida: true` com o id da repetição que já existe. É a porta que fecha
--           o defeito: a segunda chamada vira no-op e o MP recebe um pedido só.
--       Ordem de travas = a ORDEM GLOBAL da casa (20261196000000): as LINHAS do pedido por id, depois o PEDIDO.
--       A checagem "já foi repetida" vem DEPOIS das travas, então a segunda chamada só a lê quando a primeira
--       já gravou a repetição.
--
-- 3. DADOS EXISTENTES
--
-- Nenhuma linha de order_refunds, order_refund_prova, devolucoes ou marketplace_orders é lida ou escrita no apply:
-- nasce uma tabela VAZIA e uma função. Linha falhada que já existe e já foi repetida ANTES desta migration (pelo
-- caminho antigo) não tem marca: ela pode ser repetida UMA vez de novo pela função nova, e a conta de saldo
-- (que já inclui a repetição antiga em voo ou concluída) é quem recusa o excesso. Medido ANTES (consulta 42m,
-- 15/10/2026, IKCOUS e Savy): ZERO linhas falhou/recusado nas duas lojas.
--
-- 4. QUEM QUEBRA
--
-- Ninguém: `solicitar_estorno` e as demais funções NÃO mudam (assinatura, corpo, ACL). Uma aba com o front antigo
-- (PWA em cache) segue chamando `solicitar_estorno` e segue sujeita ao defeito até atualizar; depois do front novo
-- o botão "Tentar de novo" só passa pela função nova.
--
-- 5. PRÉ-VOO (B1_BASELINE_DIVERGENT, ANTES de qualquer escrita)
--
-- Recusa se: faltar tabela/coluna que o corpo lê; `is_admin()`/`is_admin_atual()` não existirem; as funções que o
-- corpo chama (`order_refund__pode_ter_saido`, `pedido__saldo_a_estornar`) tiverem corpo diferente do da
-- 20261241000000 (md5); a tabela nova existir com colunas diferentes; a função nova existir com corpo diferente
-- ou com sobrecarga. Estados aceitos: nada do que esta migration cria existe (aplica) ou tudo existe como
-- desenhado (reaplicar é no-op).
--
-- 6. IDEMPOTÊNCIA, TRANSAÇÃO E TRAVA
--
-- `CREATE TABLE IF NOT EXISTS` + `CREATE OR REPLACE FUNCTION`: rodar duas vezes deixa o mesmo estado. SEM
-- BEGIN/COMMIT (regra da casa): o aplicador dá a transação; pré-voo, criações e conferência final caem juntos ou
-- não caem. `lock_timeout = 5s`: tabela nova não trava ninguém; a função nova também não.
--
-- 7. ORDEM E ROLLBACK
--
-- Depois da 20261241000000 (o pré-voo recusa sem ela). Banco ANTES do front (o front novo chama a função nova;
-- sem ela o botão "Tentar de novo" falha com erro de função inexistente). ROLLBACK MANUAL:
-- rollback-manual-20261399991000_repetir_a_devolucao_que_falhou_nao_paga_duas_vezes.sql apaga a função e a
-- tabela (os dois objetos são NOVOS: não há corpo anterior a restaurar) e RECUSA se a tabela já tiver qualquer
-- marca (apagar a marca reabriria a repetição de uma linha que já foi repetida). Desfazer o FRONT antes.
--
-- 8. FICHA DE VERIFICAÇÃO: consultas 143a (depois) / 143b (antes).
--   PROVA VIVA: tests/banco/repetir-a-devolucao-que-falhou-nao-paga-duas-vezes-viva.cjs (rpc-ci).
-- ============================================================================

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

DO $preflight_20261399991000$
DECLARE
  v_fn CONSTANT text := 'public.solicitar_estorno_repetindo(uuid,text)';
  v_oid oid := to_regprocedure('public.solicitar_estorno_repetindo(uuid,text)');
  v_hash text;
  v_colunas text;
BEGIN
  -- O que o corpo lê.
  IF (SELECT count(*) FROM pg_attribute a
       WHERE a.attrelid = to_regclass('public.order_refunds') AND NOT a.attisdropped
         AND ((a.attname = 'id' AND a.atttypid = 'uuid'::regtype)
           OR (a.attname = 'order_id' AND a.atttypid = 'uuid'::regtype)
           OR (a.attname = 'amount' AND a.atttypid = 'numeric'::regtype)
           OR (a.attname = 'motivo' AND a.atttypid = 'text'::regtype)
           OR (a.attname = 'solicitado_por' AND a.atttypid = 'text'::regtype)
           OR (a.attname = 'status' AND a.atttypid = 'text'::regtype))) <> 6 THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: public.order_refunds não tem id, order_id (uuid), amount (numeric), motivo, solicitado_por e status (text) — meça a loja e revise antes de aplicar.';
  END IF;
  IF (SELECT count(*) FROM pg_attribute a
       WHERE a.attrelid = to_regclass('public.marketplace_orders') AND NOT a.attisdropped
         AND ((a.attname = 'status' AND a.atttypid = 'text'::regtype)
           OR (a.attname = 'payment_status' AND a.atttypid = 'text'::regtype)
           OR (a.attname = 'cancelled_after_shipping' AND a.atttypid = 'boolean'::regtype)
           OR (a.attname = 'returned_to_seller_at' AND a.atttypid = 'timestamp with time zone'::regtype))) <> 4 THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: public.marketplace_orders não tem status, payment_status (text), cancelled_after_shipping (boolean) e returned_to_seller_at (timestamptz) — meça a loja e revise antes de aplicar.';
  END IF;
  IF (SELECT count(*) FROM pg_attribute a
       WHERE a.attrelid = to_regclass('public.devolucoes') AND NOT a.attisdropped
         AND a.attname = 'refund_id' AND a.atttypid = 'uuid'::regtype) <> 1 THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: public.devolucoes não tem refund_id (uuid) — meça a loja e revise antes de aplicar.';
  END IF;
  IF to_regclass('public.order_refund_prova') IS NULL THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: public.order_refund_prova não existe — aplique a 20261241000000 antes.';
  END IF;

  -- As portas de admin (20261197000000) e as funções que o corpo chama, com o corpo da 20261241000000.
  IF to_regprocedure('public.is_admin()') IS NULL OR to_regprocedure('public.is_admin_atual()') IS NULL THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: public.is_admin() ou public.is_admin_atual() não existe — aplique a 20261197000000 antes.';
  END IF;
  SELECT md5(replace(prosrc, E'\r', '')) INTO v_hash
    FROM pg_proc WHERE oid = to_regprocedure('public.order_refund__pode_ter_saido(uuid)');
  IF v_hash IS DISTINCT FROM 'bdbb28b3d91588c8b10283d57bfb73d6' THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: order_refund__pode_ter_saido(uuid) com corpo desconhecido (hash %) — aplique a 20261241000000 ou revise antes de aplicar.', COALESCE(v_hash, 'ausente');
  END IF;
  SELECT md5(replace(prosrc, E'\r', '')) INTO v_hash
    FROM pg_proc WHERE oid = to_regprocedure('public.pedido__saldo_a_estornar(uuid)');
  IF v_hash IS DISTINCT FROM '99741b4cdbf1e8d8340f80440e6da094' THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: pedido__saldo_a_estornar(uuid) com corpo desconhecido (hash %) — aplique a 20261241000000 ou revise antes de aplicar.', COALESCE(v_hash, 'ausente');
  END IF;

  -- A tabela nova: ausente, ou exatamente as colunas desta migration.
  IF to_regclass('public.order_refund_repeticao') IS NOT NULL THEN
    SELECT string_agg(a.attname || ':' || format_type(a.atttypid, a.atttypmod), ',' ORDER BY a.attname) INTO v_colunas
      FROM pg_attribute a
     WHERE a.attrelid = to_regclass('public.order_refund_repeticao') AND a.attnum > 0 AND NOT a.attisdropped;
    IF v_colunas IS DISTINCT FROM 'created_at:timestamp with time zone,nova_refund_id:uuid,refund_id:uuid' THEN
      RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: public.order_refund_repeticao já existe com colunas diferentes (%) — revise antes de aplicar.', COALESCE(v_colunas, 'ausente');
    END IF;
  END IF;

  -- A função nova: ausente, ou exatamente a desta migration.
  IF (SELECT count(*) FROM pg_proc p
       WHERE p.pronamespace = 'public'::regnamespace AND p.proname = 'solicitar_estorno_repetindo') > 1 THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: solicitar_estorno_repetindo tem sobrecarga em public — meça a loja e revise antes de aplicar.';
  END IF;
  IF v_oid IS NOT NULL THEN
    SELECT md5(replace(prosrc, E'\r', '')) INTO v_hash FROM pg_proc WHERE oid = v_oid;
    IF v_hash IS DISTINCT FROM '018d9480bacfc4776b6f3424d303a3ee' THEN
      RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: % já existe com corpo desconhecido (hash %) — ninguém revisou essa redefinição; capture o corpo vivo e revise antes de aplicar.', v_fn, COALESCE(v_hash, 'ausente');
    END IF;
  ELSIF EXISTS (SELECT 1 FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname = 'solicitar_estorno_repetindo') THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: solicitar_estorno_repetindo existe em public com outra assinatura — revise antes de aplicar.';
  END IF;
END $preflight_20261399991000$;

-- ---------------------------------------------------------------------------
-- 1. A marca "esta linha falhada já foi repetida por esta outra" — só do servidor
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.order_refund_repeticao (
  refund_id uuid PRIMARY KEY REFERENCES public.order_refunds (id) ON DELETE CASCADE,
  nova_refund_id uuid NOT NULL UNIQUE REFERENCES public.order_refunds (id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT order_refund_repeticao_linhas_diferentes CHECK (refund_id <> nova_refund_id)
);

COMMENT ON TABLE public.order_refund_repeticao IS
  'Marca do servidor: a linha falhada refund_id já foi repetida pela linha nova_refund_id (solicitar_estorno_repetindo). A PK impede duas repetições da mesma falhada; a UNIQUE impede a mesma nova linha de repetir duas. Só o servidor lê (a cliente lê order_refunds inteira; marca interna não vai para lá). 20261399991000.';

ALTER TABLE public.order_refund_repeticao ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.order_refund_repeticao FROM PUBLIC, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 2. A função: repetir UMA linha falhada, uma vez só
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.solicitar_estorno_repetindo(
    p_refund_id uuid,
    p_motivo text
)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
    v_order_id UUID;
    v_r public.order_refunds%ROWTYPE;
    v_status TEXT;
    v_payment_status TEXT;
    v_total NUMERIC;
    v_cancelled_after_shipping BOOLEAN;
    v_returned_at TIMESTAMPTZ;
    v_saldo NUMERIC;
    v_nova UUID;
    v_status_da_nova TEXT;
BEGIN
    -- So' a loja repete devolucao pelo painel (as mesmas duas portas de solicitar_estorno): 42501 para o front
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

    IF p_refund_id IS NULL THEN
        RAISE EXCEPTION 'Informe qual devolução repetir.'
            USING ERRCODE = 'P0001';
    END IF;

    -- O pedido da linha, lido SEM trava só para saber quais linhas travar (a ordem global começa pelas linhas).
    SELECT order_id INTO v_order_id
      FROM public.order_refunds
     WHERE id = p_refund_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Devolução não encontrada.'
            USING ERRCODE = 'P0001';
    END IF;

    -- ORDEM GLOBAL DAS TRAVAS (20261196000000): as LINHAS do pedido por id, depois o PEDIDO. Duas abas que repetem
    -- a MESMA linha esperam aqui uma pela outra; a segunda só lê "já foi repetida" depois que a primeira gravou.
    PERFORM 1
       FROM public.order_refunds r
      WHERE r.order_id = v_order_id
      ORDER BY r.id
        FOR UPDATE;

    SELECT status, payment_status, total, cancelled_after_shipping, returned_to_seller_at
      INTO v_status, v_payment_status, v_total, v_cancelled_after_shipping, v_returned_at
      FROM public.marketplace_orders
     WHERE id = v_order_id
       FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Pedido não encontrado.'
            USING ERRCODE = 'P0001';
    END IF;

    -- Relê a linha DEPOIS das travas (o status pode ter mudado enquanto esperava).
    SELECT * INTO v_r FROM public.order_refunds WHERE id = p_refund_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Devolução não encontrada.'
            USING ERRCODE = 'P0001';
    END IF;

    -- JA REPETIDA: duas abas, dois lojistas, tela velha ou o botão que sobrou depois do sucesso. Não cria nada:
    -- devolve a repetição que já existe, com o status dela.
    SELECT nova_refund_id INTO v_nova
      FROM public.order_refund_repeticao
     WHERE refund_id = p_refund_id;
    IF FOUND THEN
        SELECT status INTO v_status_da_nova FROM public.order_refunds WHERE id = v_nova;
        RETURN jsonb_build_object(
            'refund_id', v_nova,
            'amount', v_r.amount,
            'ja_repetida', true,
            'status', v_status_da_nova
        );
    END IF;

    -- Só a linha parada que NUNCA teve dinheiro saído se repete aqui.
    IF v_r.solicitado_por = 'sistema' THEN
        RAISE EXCEPTION 'Esta linha é só o registro de uma devolução feita fora do app: não dá para repetir.'
            USING ERRCODE = 'P0001';
    END IF;
    IF v_r.status = 'concluido' THEN
        RAISE EXCEPTION 'Esta devolução já foi concluída.'
            USING ERRCODE = 'P0001';
    END IF;
    IF v_r.status IN ('solicitado', 'em_processamento') THEN
        RAISE EXCEPTION 'Esta devolução ainda está em andamento no Mercado Pago: espere a resposta.'
            USING ERRCODE = 'P0001';
    END IF;
    IF EXISTS (SELECT 1 FROM public.devolucoes d WHERE d.refund_id = v_r.id) THEN
        RAISE EXCEPTION 'Esta devolução de dinheiro faz parte de uma devolução de produto: repita pela tela de Devoluções.'
            USING ERRCODE = 'P0001';
    END IF;
    IF EXISTS (SELECT 1
                 FROM public.order_refund_prova pv
                WHERE pv.refund_id = v_r.id
                  AND (pv.substituida_por_manual_em IS NOT NULL OR pv.por_fora_liberado_em IS NOT NULL)) THEN
        RAISE EXCEPTION 'Esta devolução já foi resolvida por fora: não repita.'
            USING ERRCODE = 'P0001';
    END IF;
    -- A regra ÚNICA (20261241000000): se o dinheiro PODE ter saído no Mercado Pago, nunca ganha chave nova.
    IF public.order_refund__pode_ter_saido(v_r.id) THEN
        RAISE EXCEPTION 'A loja está confirmando esta devolução com o Mercado Pago, não repita.'
            USING ERRCODE = 'P0001';
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

    -- A conta UNICA do saldo; o valor é o da linha falhada, nunca o do chamador.
    v_saldo := public.pedido__saldo_a_estornar(v_order_id);

    IF v_r.amount > v_saldo THEN
        RAISE EXCEPTION 'O valor desta devolução (R$ %) é maior que o valor disponível para devolver (R$ %).',
            to_char(v_r.amount, 'FM999G999D00'), to_char(v_saldo, 'FM999G999D00')
            USING ERRCODE = 'P0001';
    END IF;

    INSERT INTO public.order_refunds (order_id, amount, motivo, solicitado_por)
    VALUES (v_order_id, v_r.amount,
            COALESCE(NULLIF(trim(COALESCE(p_motivo, '')), ''), v_r.motivo),
            'lojista')
    RETURNING id INTO v_nova;

    INSERT INTO public.order_refund_repeticao (refund_id, nova_refund_id)
    VALUES (v_r.id, v_nova);

    RETURN jsonb_build_object(
        'refund_id', v_nova,
        'amount', v_r.amount,
        'ja_repetida', false,
        'refund_anterior', v_r.id
    );
END;
$function$;

REVOKE ALL ON FUNCTION public.solicitar_estorno_repetindo(uuid, text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.solicitar_estorno_repetindo(uuid, text) TO authenticated;

-- CONFERÊNCIA no instante do apply: aborta se a tabela ou a função não ficaram como desenhadas.
DO $conferencia_20261399991000$
DECLARE
  v_fn CONSTANT text := 'public.solicitar_estorno_repetindo(uuid,text)';
  v_oid oid := to_regprocedure('public.solicitar_estorno_repetindo(uuid,text)');
  v_hash text;
  v_colunas text;
BEGIN
  IF to_regclass('public.order_refund_repeticao') IS NULL THEN
    RAISE EXCEPTION 'conferencia 20261399991000: public.order_refund_repeticao sumiu';
  END IF;
  SELECT string_agg(a.attname || ':' || format_type(a.atttypid, a.atttypmod), ',' ORDER BY a.attname) INTO v_colunas
    FROM pg_attribute a
   WHERE a.attrelid = to_regclass('public.order_refund_repeticao') AND a.attnum > 0 AND NOT a.attisdropped;
  IF v_colunas IS DISTINCT FROM 'created_at:timestamp with time zone,nova_refund_id:uuid,refund_id:uuid' THEN
    RAISE EXCEPTION 'conferencia 20261399991000: colunas de order_refund_repeticao diferentes do desenho (%)', COALESCE(v_colunas, 'ausente');
  END IF;
  -- PK em refund_id e UNIQUE em nova_refund_id (é isto que fecha a repetição dupla mesmo sem a trava).
  IF NOT EXISTS (
       SELECT 1 FROM pg_index i
        WHERE i.indrelid = to_regclass('public.order_refund_repeticao') AND i.indisprimary
          AND (SELECT array_agg(a.attname::text) FROM pg_attribute a
                WHERE a.attrelid = i.indrelid AND a.attnum = ANY (i.indkey)) = ARRAY['refund_id']
     ) THEN
    RAISE EXCEPTION 'conferencia 20261399991000: a chave primária de order_refund_repeticao não é refund_id';
  END IF;
  IF NOT EXISTS (
       SELECT 1 FROM pg_index i
        WHERE i.indrelid = to_regclass('public.order_refund_repeticao') AND i.indisunique AND NOT i.indisprimary
          AND i.indpred IS NULL AND i.indnatts = 1
          AND (SELECT array_agg(a.attname::text) FROM pg_attribute a
                WHERE a.attrelid = i.indrelid AND a.attnum = ANY (i.indkey)) = ARRAY['nova_refund_id']
     ) THEN
    RAISE EXCEPTION 'conferencia 20261399991000: falta a UNIQUE de nova_refund_id em order_refund_repeticao';
  END IF;
  IF (SELECT count(*) FROM pg_constraint c
       WHERE c.conrelid = to_regclass('public.order_refund_repeticao') AND c.contype = 'f'
         AND c.confrelid = to_regclass('public.order_refunds') AND c.confdeltype = 'c') <> 2 THEN
    RAISE EXCEPTION 'conferencia 20261399991000: as duas chaves estrangeiras (refund_id, nova_refund_id -> order_refunds, ON DELETE CASCADE) não ficaram como desenhadas';
  END IF;
  -- Só do servidor: RLS ligada, nenhuma policy, nenhum privilégio para papel de aplicação.
  IF NOT EXISTS (SELECT 1 FROM pg_class WHERE oid = to_regclass('public.order_refund_repeticao') AND relrowsecurity) THEN
    RAISE EXCEPTION 'conferencia 20261399991000: order_refund_repeticao sem RLS';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_policy WHERE polrelid = to_regclass('public.order_refund_repeticao')) THEN
    RAISE EXCEPTION 'conferencia 20261399991000: order_refund_repeticao não pode ter policy';
  END IF;
  IF has_table_privilege('anon', 'public.order_refund_repeticao', 'SELECT, INSERT, UPDATE, DELETE')
     OR has_table_privilege('authenticated', 'public.order_refund_repeticao', 'SELECT, INSERT, UPDATE, DELETE')
     OR has_table_privilege('service_role', 'public.order_refund_repeticao', 'SELECT, INSERT, UPDATE, DELETE')
     OR EXISTS (SELECT 1 FROM pg_class c CROSS JOIN LATERAL aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) g
                 WHERE c.oid = to_regclass('public.order_refund_repeticao') AND g.grantee = 0) THEN
    RAISE EXCEPTION 'conferencia 20261399991000: order_refund_repeticao acessível a PUBLIC, anon, authenticated ou service_role';
  END IF;

  IF v_oid IS NULL THEN
    RAISE EXCEPTION 'conferencia 20261399991000: % sumiu', v_fn;
  END IF;
  IF (SELECT count(*) FROM pg_proc p
       WHERE p.pronamespace = 'public'::regnamespace AND p.proname = 'solicitar_estorno_repetindo') <> 1 THEN
    RAISE EXCEPTION 'conferencia 20261399991000: solicitar_estorno_repetindo ficou com sobrecarga';
  END IF;
  SELECT md5(replace(prosrc, E'\r', '')) INTO v_hash FROM pg_proc WHERE oid = v_oid;
  IF v_hash IS DISTINCT FROM '018d9480bacfc4776b6f3424d303a3ee' THEN
    RAISE EXCEPTION 'conferencia 20261399991000: corpo vivo de % (hash %) não é o desta migration', v_fn, COALESCE(v_hash, 'ausente');
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
          AND p.pronargs = 2
          AND p.proconfig = ARRAY['search_path=public']::text[]
     ) THEN
    RAISE EXCEPTION 'conferencia 20261399991000: atributos de % mudaram (SECURITY DEFINER, volatilidade, search_path, retorno ou argumentos)', v_fn;
  END IF;
  -- EXECUTE só do authenticated: nem PUBLIC, nem anon, nem service_role.
  IF EXISTS (SELECT 1 FROM pg_proc p
               CROSS JOIN LATERAL aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) g
              WHERE p.oid = v_oid AND g.privilege_type = 'EXECUTE' AND g.grantee = 0) THEN
    RAISE EXCEPTION 'conferencia 20261399991000: % alcancavel por PUBLIC', v_fn;
  END IF;
  IF has_function_privilege('anon', v_oid, 'EXECUTE')
     OR has_function_privilege('service_role', v_oid, 'EXECUTE')
     OR NOT has_function_privilege('authenticated', v_oid, 'EXECUTE') THEN
    RAISE EXCEPTION 'conferencia 20261399991000: o EXECUTE de % deve ser só do authenticated', v_fn;
  END IF;
END $conferencia_20261399991000$;
