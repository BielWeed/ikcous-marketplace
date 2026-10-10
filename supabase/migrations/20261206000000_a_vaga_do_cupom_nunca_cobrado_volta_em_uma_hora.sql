-- ============================================================================
-- Migration 20261206000000 -- a vaga do cupom de pedido nunca cobrado volta em 1 h
-- (cupom + dado de cliente; issues #210 e #116; 09/10/2026)
-- ============================================================================
--
-- 1. O DEFEITO
--
-- Pedido cancelado (ou PIX que venceu) que NUNCA teve cobranca ainda segura a
-- vaga do cupom por 24 h depois de expires_at -- a espera que protege o PIX
-- pago tarde. Para quem nunca gerou cobranca essa espera nao protege nada: o
-- cliente fica um dia sem poder usar de novo um cupom de uso unico.
--
-- 2. O QUE ESTA MIGRATION FAZ (a 2a peca; a 1a e a 20261205000000)
--
--   (a) `cupom__vaga_volta_em` (CREATE OR REPLACE, mesma assinatura): a pista
--       RAPIDA. Pedido sem id de cobranca gravado E com ZERO tentativas de
--       pagamento devolve a vaga 45 min depois de expires_at (o PIX vive ate
--       30 min). Todo o resto segue como antes: 24 h, ou na hora quando o
--       pedido nasceu sem expires_at, e nunca para pedido pago, pago_apos_expirar,
--       ja devolvido, sem cupom, nao cancelado ou cancelado depois do envio sem
--       retorno do produto.
--   (b) `devolver_cupons_de_pedidos_mortos` (CREATE OR REPLACE, mesmo
--       cabecalho): o corpo da 20260970000000 INTEIRO, mudando so o WHERE --
--       os filtros que o indice serve (coupon_id, status, coupon_usage_returned)
--       ficam e o resto vira `cupom__vaga_volta_em(...) < now()`. Mantem o FOR
--       UPDATE SKIP LOCKED e a UNICA chamada a devolver_uso_cupom. Comentario
--       da funcao atualizado.
--   Nao ha mudanca em validate_coupon_secure_v2, create_marketplace_order_v23/_v24,
--   devolver_uso_cupom nem em edge function. A RPC vaga_do_cupom_presa
--   (20261205000000) passa a prometer o prazo novo sem mudar: ela le o auxiliar.
--
-- 3. POR QUE A PISTA RAPIDA E SEGURA (e o que NAO e o motivo)
--
-- O relogio de 45 min NAO e o que impede o cupom de valer duas vezes: um PIX
-- pago perto do fim pode ter o webhook entregue depois dos 45 min se a nossa
-- edge estiver fora. O que garante: com a vaga de cobranca VAZIA (gateway_payment_id
-- NULL) nenhum pagamento se liga ao pedido -- confirmar_pagamento devolve
-- 'divergente' (guarda da 20261195000000, logo depois do FOR UPDATE) e
-- payment_status continua 'aguardando'. Sustentam isso, e a prova viva
-- (tests/banco/cupom-preso-viva.cjs, cenario "pagamento fantasma") confere o
-- lado do banco: (a) so liberar_cobranca_do_pedido (20261176000000) esvazia a
-- vaga, sempre somando 1 em tentativas_de_pagamento (por isso a pista exige zero
-- tentativas); (b) o cartao nunca vai ao Mercado Pago sem ocupar a vaga antes
-- (edge criar-pagamento); (c) o webhook so ADOTA cobranca para cartao (edge
-- webhook-mercadopago). (b) e (c) sao codigo de edge function e NAO sao provados
-- pelo banco: se um dia surgir adocao de PIX pelo webhook, esta pista precisa
-- ser revista.
--
-- 4. DADOS EXISTENTES: nenhum e lido nem alterado ao aplicar. So troca duas
--    funcoes. A varredura seguinte (ate 15 min depois) devolve as vagas dos
--    pedidos nunca cobrados que ja passaram de 45 min: e' o efeito pretendido.
--    Pedido que teve cobranca, tentativa ou envio nao muda.
--
-- 5. IDEMPOTENCIA: CREATE OR REPLACE e COMMENT repetiveis. O pre-voo recusa,
--    com o NOME do que diverge e SEM gravar: a 20261205000000 nao aplicada,
--    mais de uma versao da varredura, corpo vivo da varredura que nao e o da
--    20260970000000 nem o desta migration, corpo do auxiliar que nao e o da
--    20261205000000 nem o desta, colunas ausentes. O pos-voo confere de novo,
--    depois de criar, os dois corpos. Hashes (sha256, LF ou CRLF) amarrados ao
--    texto por tests/migration_a_vaga_do_cupom_nunca_cobrado_volta_test.ts.
--
-- 6. TRANSACAO: sem BEGIN/COMMIT de nivel superior (regra da casa: com eles o
--    ROLLBACK da prova do workflow vira no-op). O arquivo inteiro roda numa
--    consulta so: pre-voo, funcoes, comentarios e pos-voo caem juntos ou nao caem.
--
-- 7. ORDEM: depois da 20261205000000 (o pre-voo exige). Seguro em qualquer ordem
--    de publicacao do front: so encurta a espera.
--
-- 8. ROLLBACK MANUAL: supabase/migrations/rollback-manual-20261206000000_a_vaga_do_cupom_nunca_cobrado_volta_em_uma_hora.sql
--    (devolve o auxiliar da 20261205000000 e a varredura da 20260970000000 byte
--    a byte, com o comentario original; nao toca dado).
-- ============================================================================

DO $preflight_20261206$
DECLARE
  v_item text;
  v_hash text;
  r record;
BEGIN
  -- (1) A varredura: UMA versao so, com o corpo da 20260970000000 (ou o desta, se reaplicando).
  IF (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
       WHERE n.nspname = 'public' AND p.proname = 'devolver_cupons_de_pedidos_mortos') <> 1 THEN
    RAISE EXCEPTION 'PREFLIGHT_20261206: esperava exatamente uma versao de devolver_cupons_de_pedidos_mortos() -- inventarie antes de aplicar (nunca DROP para arrumar).';
  END IF;

  SELECT encode(sha256(convert_to(prosrc, 'UTF8')), 'hex') INTO v_hash
    FROM pg_proc
   WHERE oid = to_regprocedure('public.devolver_cupons_de_pedidos_mortos()');
  IF v_hash IS NULL OR v_hash NOT IN (
    '85a340abad3fb3f3cd913f50126bc610f584076295bbb61a8203fabcbd6c0633',
    'd0b285fdb3d939243e4399e69e04bbd1bead56ab231079199cac2ed56b3ea0ae',
    'f35db1e788fb8e0472dd6b8318c69be524c3f932d62c5f7b2856fe97d243eb4f',
    'c7e38a04defe6b286519f2325c6d4d8ec727f57c4b0edbb5bc5831d936fbe9b8'
  ) THEN
    RAISE EXCEPTION 'PREFLIGHT_20261206: corpo vivo de devolver_cupons_de_pedidos_mortos() (hash %) nao e o da 20260970000000 nem o desta migration -- uma migration posterior o redefiniu; revise antes de aplicar.', COALESCE(v_hash, 'ausente');
  END IF;

  -- (2) A 20261205000000 (auxiliar e RPC) e a funcao que a varredura chama.
  FOREACH v_item IN ARRAY ARRAY[
    'public.cupom__vaga_volta_em(uuid, text, text, boolean, timestamptz, boolean, timestamptz, text, integer)',
    'public.vaga_do_cupom_presa(text)',
    'public.devolver_uso_cupom(uuid)'
  ] LOOP
    IF to_regprocedure(v_item) IS NULL THEN
      RAISE EXCEPTION 'PREFLIGHT_20261206: falta a funcao % -- aplique antes a migration 20261205000000 (auxiliar e RPC) e a 20260901000000 (devolver_uso_cupom).', v_item;
    END IF;
  END LOOP;

  SELECT encode(sha256(convert_to(prosrc, 'UTF8')), 'hex') INTO v_hash
    FROM pg_proc
   WHERE oid = to_regprocedure('public.cupom__vaga_volta_em(uuid, text, text, boolean, timestamptz, boolean, timestamptz, text, integer)');
  IF v_hash NOT IN (
    'e92200a0af3c3dfa4051e0076ae9ba184476678f9bc2484a369d317d745f534d',
    '865c4de58c2fbc272c41f5d0ab03deb1410b6a9d6ce8fd3762659e2c28e15a3d',
    'aa8f0ef494f54dc952ed9f8fd7e95997a988086c278bfd0ebbdf0117f68c2363',
    '6fc3bb6775c34d5739516fa9841bbc4787ae2d3be87e647acca8d465c513f6b6'
  ) THEN
    RAISE EXCEPTION 'PREFLIGHT_20261206: corpo vivo de cupom__vaga_volta_em (hash %) nao e o da 20261205000000 nem o desta migration -- uma migration posterior o redefiniu; revise antes de aplicar.', v_hash;
  END IF;

  -- (3) Colunas que o auxiliar e a varredura leem.
  FOR r IN
    SELECT *
      FROM (VALUES
        ('id'), ('user_id'), ('coupon_id'), ('status'), ('payment_status'),
        ('coupon_usage_returned'), ('expires_at'), ('cancelled_after_shipping'),
        ('returned_to_seller_at'), ('gateway_payment_id'), ('tentativas_de_pagamento')
      ) AS c(coluna)
  LOOP
    IF NOT EXISTS (
      SELECT 1
        FROM pg_attribute a
       WHERE a.attrelid = to_regclass('public.marketplace_orders')
         AND a.attname = r.coluna
         AND a.attnum > 0
         AND NOT a.attisdropped
    ) THEN
      RAISE EXCEPTION 'PREFLIGHT_20261206: falta a coluna public.marketplace_orders.% -- aplique as migrations anteriores antes desta (20260970000000 e 20261176000000).', r.coluna;
    END IF;
  END LOOP;
END
$preflight_20261206$;

CREATE OR REPLACE FUNCTION public.cupom__vaga_volta_em(
    p_coupon_id uuid,
    p_status text,
    p_payment_status text,
    p_coupon_usage_returned boolean,
    p_expires_at timestamptz,
    p_cancelled_after_shipping boolean,
    p_returned_to_seller_at timestamptz,
    p_gateway_payment_id text,
    p_tentativas integer
)
 RETURNS timestamptz
 LANGUAGE sql
 STABLE
 SET search_path = public
AS $function$
    -- Cupom preso (20261206000000). Mesmo contrato da 20261205000000, com UMA
    -- pista nova: o pedido NUNCA COBRADO (sem id de cobranca gravado e zero
    -- tentativas de pagamento) devolve a vaga 45 min depois de expires_at, e nao
    -- 24 h depois. 45 min porque o PIX vive ate 30 min e a espera cobre o atraso
    -- do ciclo que expira o pedido.
    --
    -- O QUE GARANTE QUE O CUPOM NAO VALE DUAS VEZES NESSA PISTA nao e o relogio:
    -- um PIX pago perto do fim pode ter o webhook entregue depois dos 45 min se a
    -- nossa edge estiver fora. E' que, com a vaga de cobranca VAZIA (sem id de
    -- gateway gravado), nenhum pagamento se liga ao pedido: confirmar_pagamento
    -- devolve 'divergente' (guarda da 20261195000000) e payment_status segue
    -- 'aguardando'. Tres fatos sustentam isso; se um deles mudar, esta pista
    -- precisa ser revista:
    --   (a) so liberar_cobranca_do_pedido (20261176000000) esvazia a vaga, e
    --       sempre soma 1 em tentativas_de_pagamento (por isso zero tentativas);
    --   (b) o cartao nunca vai ao Mercado Pago sem ocupar a vaga antes (edge
    --       criar-pagamento);
    --   (c) o webhook so ADOTA cobranca para cartao (edge webhook-mercadopago).
    -- Se um dia surgir adocao de PIX pelo webhook, esta pista rapida precisa ser
    -- revista.
    SELECT CASE
        WHEN p_coupon_id IS NULL THEN 'infinity'::timestamptz
        WHEN p_status IS DISTINCT FROM 'cancelled' THEN 'infinity'::timestamptz
        WHEN p_payment_status IN ('pago', 'pago_apos_expirar') THEN 'infinity'::timestamptz
        WHEN p_coupon_usage_returned IS DISTINCT FROM false THEN 'infinity'::timestamptz
        WHEN (p_cancelled_after_shipping = false OR p_returned_to_seller_at IS NOT NULL) IS NOT TRUE THEN 'infinity'::timestamptz
        WHEN p_expires_at IS NULL THEN '-infinity'::timestamptz
        WHEN p_gateway_payment_id IS NULL AND p_tentativas = 0 THEN p_expires_at + interval '45 minutes'
        ELSE p_expires_at + interval '24 hours'
    END
$function$;

REVOKE ALL ON FUNCTION public.cupom__vaga_volta_em(uuid, text, text, boolean, timestamptz, boolean, timestamptz, text, integer) FROM PUBLIC, anon, authenticated, service_role;

COMMENT ON FUNCTION public.cupom__vaga_volta_em(uuid, text, text, boolean, timestamptz, boolean, timestamptz, text, integer) IS 'Cupom preso (20261205000000, pista rapida em 20261206000000): QUANDO a varredura devolver_cupons_de_pedidos_mortos() devolve a vaga do cupom de um pedido. -infinity = ja; infinity = nunca (nem vai); senao a hora. Pedido NUNCA cobrado (sem id de cobranca gravado e zero tentativas de pagamento) devolve 45 min depois de expires_at; o resto, 24 h. A pista rapida e segura porque, com a vaga de cobranca vazia, confirmar_pagamento devolve divergente e nenhum pagamento se liga ao pedido; isso depende de (a) so liberar_cobranca_do_pedido esvaziar a vaga, sempre com tentativas + 1, (b) o cartao nunca ir ao Mercado Pago sem ocupar a vaga (criar-pagamento), (c) o webhook so adotar cobranca para cartao. Se um dia surgir adocao de PIX pelo webhook, esta pista precisa ser revista. Parametros simples de proposito; sem EXECUTE para ninguem alem do dono e das funcoes SECURITY DEFINER que a chamam.';

CREATE OR REPLACE FUNCTION public.devolver_cupons_de_pedidos_mortos()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $devolver_cupons_mortos$
DECLARE
    v_pedido     RECORD;
    v_devolvidos integer := 0;
BEGIN
    -- FOR UPDATE SKIP LOCKED: mesma protecao de expirar_pedidos_vencidos --
    -- se dois ciclos deste cron se sobrepuserem, ou se confirmar_pagamento
    -- estiver processando o MESMO pedido neste instante (por exemplo, um
    -- pagamento tardio que acabou de chegar), quem perder a corrida pela
    -- linha pula e tenta de novo no proximo ciclo -- nunca decrementa duas
    -- vezes, nunca decrementa um pedido que acabou de ser pago.
    --
    -- coupon_id IS NOT NULL: so' pedido com cupom entra na varredura.
    --
    -- status = 'cancelled' AND payment_status IS DISTINCT FROM 'pago' AND
    -- payment_status IS DISTINCT FROM 'pago_apos_expirar': exatamente o
    -- conjunto dos quatro pontos de desfazimento que ANTES desta migration
    -- devolviam (ou reconsumiam) o uso do cupom -- ver o cabecalho desta
    -- migration para a prova de que este WHERE reproduz aquele conjunto sem
    -- deduzir nada alem do que confirmar_pagamento ja registra.
    --
    -- coupon_usage_returned = FALSE: o FATO registrado, nunca deduzido --
    -- e' isto que torna a operacao idempotente por construcao. Pedido
    -- pre-existente (criado antes desta migration) nasce FALSE pelo
    -- DEFAULT da coluna, e entra na varredura normalmente -- correto,
    -- porque nenhuma versao anterior desta migration jamais rodou em
    -- producao.
    --
    -- expires_at IS NULL OR expires_at < now() - interval '24 hours': o
    -- numero da casa (pagamentos_a_reconciliar, 20260808000100), a decisao
    -- do Gabriel de que "a vaga fica reservada enquanto o PIX estiver
    -- aberto". expires_at IS NULL NAO e' so residuo historico -- e' o
    -- caminho CORRENTE de todo pedido "na entrega" criado por
    -- create_marketplace_order_v23 (a via PADRAO do app, useOrders.ts:
    -- 1059-1061; a v24 so' entra com pagamento online): v23 nunca grava
    -- expires_at nem payment_status, entao NULL aqui significa "nunca
    -- houve PIX por este caminho" -- sem janela nenhuma para proteger.
    --
    -- cancelled_after_shipping = false OR returned_to_seller_at IS NOT
    -- NULL: acrescentada por esta migration (20260970000000) -- ver o
    -- comentario acima do CREATE. Sem ela, pedido cancelado-apos-envio sem
    -- o produto de volta liberava a vaga do cupom antes da hora.
    -- 20261206000000: o WHERE abaixo mudou. As condicoes que os comentarios acima
    -- descrevem (payment_status, expires_at + 24 h, cancelado depois do envio)
    -- agora moram em public.cupom__vaga_volta_em(), a MESMA regra, com UMA pista
    -- nova: pedido NUNCA cobrado volta mais cedo (ver o comentario dela). Ficam
    -- aqui so os filtros que o indice serve (coupon_id, status,
    -- coupon_usage_returned); o resto o auxiliar decide linha a linha.
    FOR v_pedido IN
        SELECT id
        FROM public.marketplace_orders
        WHERE coupon_id IS NOT NULL
          AND status = 'cancelled'
          AND coupon_usage_returned = FALSE
          AND public.cupom__vaga_volta_em(
                coupon_id, status, payment_status, coupon_usage_returned, expires_at,
                cancelled_after_shipping, returned_to_seller_at,
                gateway_payment_id, tentativas_de_pagamento) < now()
        FOR UPDATE SKIP LOCKED
    LOOP
        PERFORM public.devolver_uso_cupom(v_pedido.id);

        UPDATE public.marketplace_orders
           SET coupon_usage_returned = TRUE
         WHERE id = v_pedido.id;

        v_devolvidos := v_devolvidos + 1;
    END LOOP;

    RETURN v_devolvidos;
END;
$devolver_cupons_mortos$;

REVOKE ALL ON FUNCTION public.devolver_cupons_de_pedidos_mortos()
  FROM PUBLIC, anon, authenticated;

COMMENT ON FUNCTION public.devolver_cupons_de_pedidos_mortos() IS
  'Unico lugar onde a vaga de um cupom volta depois que um pedido que o usou e desfeito (so a varredura devolve; o cancelamento nao). Quando a vaga volta quem decide e public.cupom__vaga_volta_em(): na hora para pedido sem expires_at, 45 min depois de expires_at para pedido NUNCA cobrado (sem id de cobranca e zero tentativas), 24 h para o resto, e nunca para pedido pago, pago_apos_expirar, ja devolvido ou cancelado depois do envio sem o produto de volta. Nunca deduz "ja devolvido" do estado: le e grava o fato na coluna coupon_usage_returned. FOR UPDATE SKIP LOCKED: dois ciclos nunca devolvem o mesmo pedido. Agendada via pg_cron a cada 15 minutos (20260901000000). Reescrita em 20261206000000.';

DO $posvoo_20261206$
DECLARE
  r record;
  v_hash text;
BEGIN
  FOR r IN
    SELECT *
      FROM (VALUES
        ('public.cupom__vaga_volta_em(uuid, text, text, boolean, timestamptz, boolean, timestamptz, text, integer)', 'aa8f0ef494f54dc952ed9f8fd7e95997a988086c278bfd0ebbdf0117f68c2363', '6fc3bb6775c34d5739516fa9841bbc4787ae2d3be87e647acca8d465c513f6b6'),
        ('public.devolver_cupons_de_pedidos_mortos()', 'f35db1e788fb8e0472dd6b8318c69be524c3f932d62c5f7b2856fe97d243eb4f', 'c7e38a04defe6b286519f2325c6d4d8ec727f57c4b0edbb5bc5831d936fbe9b8')
      ) AS e(assinatura, hash_lf, hash_crlf)
  LOOP
    SELECT encode(sha256(convert_to(prosrc, 'UTF8')), 'hex') INTO v_hash
      FROM pg_proc
     WHERE oid = to_regprocedure(r.assinatura);
    IF v_hash IS NULL OR v_hash NOT IN (r.hash_lf, r.hash_crlf) THEN
      RAISE EXCEPTION 'POSVOO_20261206: % saiu da migration com o corpo (hash %) e nao com o esperado -- nada foi mantido.', r.assinatura, COALESCE(v_hash, 'ausente');
    END IF;
  END LOOP;
END
$posvoo_20261206$;
