-- ============================================================================
-- Rollback manual -- a vaga do cupom nunca cobrado volta em 1 h (20261206000000)
-- ============================================================================
-- Devolve as DUAS funcoes ao estado anterior, byte a byte:
--   * public.cupom__vaga_volta_em(...) -> o corpo e o comentario da 20261205000000;
--   * public.devolver_cupons_de_pedidos_mortos() -> o corpo da 20260970000000 e o
--     comentario da 20260901000000.
-- Nao toca dado (nenhuma linha, nenhum uso de cupom): a vaga que a varredura
-- ja devolveu pela pista rapida continua devolvida (coupon_usage_returned =
-- true). ACL e RPC vaga_do_cupom_presa nao mudam (a RPC le o auxiliar e volta a
-- prometer as 24 h).
--
-- O QUE VOLTA A VALER: pedido nunca cobrado volta a segurar a vaga por 24 h
-- depois de expires_at.
--
-- GUARDA DE ORDEM: so restaura se o corpo vivo de CADA funcao for o desta
-- migration (LF ou CRLF) ou o ja restaurado. Outro corpo e' de uma migration
-- POSTERIOR que a redefiniu: restaurar por cima apagaria a guarda dela em
-- silencio. Rollback repetido e' idempotente.
--
-- Executar via `psql -1 -f` (nunca pelo db-apply). Sem BEGIN/COMMIT de nivel
-- superior neste arquivo -- regra da casa.
-- ============================================================================

DO $guarda_rollback_20261206$
DECLARE
  v_hash text;
BEGIN
  SELECT encode(sha256(convert_to(prosrc, 'UTF8')), 'hex') INTO v_hash
    FROM pg_proc
   WHERE oid = to_regprocedure('public.cupom__vaga_volta_em(uuid, text, text, boolean, timestamptz, boolean, timestamptz, text, integer)');
  IF v_hash IS NOT NULL AND v_hash NOT IN (
    'aa8f0ef494f54dc952ed9f8fd7e95997a988086c278bfd0ebbdf0117f68c2363',
    '6fc3bb6775c34d5739516fa9841bbc4787ae2d3be87e647acca8d465c513f6b6',
    'e92200a0af3c3dfa4051e0076ae9ba184476678f9bc2484a369d317d745f534d',
    '865c4de58c2fbc272c41f5d0ab03deb1410b6a9d6ce8fd3762659e2c28e15a3d'
  ) THEN
    RAISE EXCEPTION 'corpo vivo de cupom__vaga_volta_em (hash %) nao e o da 20261206000000 nem o da 20261205000000 -- uma migration posterior o redefiniu; reverta-a antes.', v_hash;
  END IF;

  SELECT encode(sha256(convert_to(prosrc, 'UTF8')), 'hex') INTO v_hash
    FROM pg_proc
   WHERE oid = to_regprocedure('public.devolver_cupons_de_pedidos_mortos()');
  IF v_hash IS NOT NULL AND v_hash NOT IN (
    'f35db1e788fb8e0472dd6b8318c69be524c3f932d62c5f7b2856fe97d243eb4f',
    'c7e38a04defe6b286519f2325c6d4d8ec727f57c4b0edbb5bc5831d936fbe9b8',
    '85a340abad3fb3f3cd913f50126bc610f584076295bbb61a8203fabcbd6c0633',
    'd0b285fdb3d939243e4399e69e04bbd1bead56ab231079199cac2ed56b3ea0ae'
  ) THEN
    RAISE EXCEPTION 'a varredura devolver_cupons_de_pedidos_mortos (hash %) nao e a da 20261206000000 nem a da 20260970000000 -- uma migration posterior a redefiniu; reverta-a antes.', v_hash;
  END IF;
END $guarda_rollback_20261206$;

-- O auxiliar da 20261205000000, copiado caractere a caractere de
-- supabase/migrations/20261205000000_o_cupom_preso_diz_quando_a_vaga_volta.sql.
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
    SELECT CASE
        WHEN p_coupon_id IS NULL THEN 'infinity'::timestamptz
        WHEN p_status IS DISTINCT FROM 'cancelled' THEN 'infinity'::timestamptz
        WHEN p_payment_status IN ('pago', 'pago_apos_expirar') THEN 'infinity'::timestamptz
        WHEN p_coupon_usage_returned IS DISTINCT FROM false THEN 'infinity'::timestamptz
        WHEN (p_cancelled_after_shipping = false OR p_returned_to_seller_at IS NOT NULL) IS NOT TRUE THEN 'infinity'::timestamptz
        WHEN p_expires_at IS NULL THEN '-infinity'::timestamptz
        ELSE p_expires_at + interval '24 hours'
    END
$function$;

COMMENT ON FUNCTION public.cupom__vaga_volta_em(uuid, text, text, boolean, timestamptz, boolean, timestamptz, text, integer) IS 'Cupom preso (20261205000000): QUANDO a varredura devolver_cupons_de_pedidos_mortos() devolve a vaga do cupom de um pedido. -infinity = ja; infinity = nunca (nem vai); senao a hora. Espelha o WHERE da varredura da 20260970000000. Parametros simples de proposito (o PostgREST nao a exporia como coluna calculada). Sem EXECUTE para ninguem alem do dono e das funcoes SECURITY DEFINER que a chamam.';

-- A varredura da 20260970000000, copiada caractere a caractere de
-- supabase/migrations/20260970000000_cancelamento_respeita_o_envio.sql (l.232-302).
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
    FOR v_pedido IN
        SELECT id
        FROM public.marketplace_orders
        WHERE coupon_id IS NOT NULL
          AND status = 'cancelled'
          AND payment_status IS DISTINCT FROM 'pago'
          AND payment_status IS DISTINCT FROM 'pago_apos_expirar'
          AND coupon_usage_returned = FALSE
          AND (expires_at IS NULL OR expires_at < now() - interval '24 hours')
          AND (cancelled_after_shipping = false OR returned_to_seller_at IS NOT NULL)
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

COMMENT ON FUNCTION public.devolver_cupons_de_pedidos_mortos() IS
  E'Unico lugar onde a vaga de um cupom volta depois que um pedido que o usou e desfeito. S\u00f3 age sobre pedido definitivamente morto -- PIX que ja nao pode mais ser pago, pelo mesmo criterio de pagamentos_a_reconciliar (expires_at + 24h) -- e nunca deduz "ja devolvido" do estado: le e grava o fato na coluna coupon_usage_returned. Agendada via pg_cron a cada 15 minutos, ver abaixo.';

DO $verifica_rollback_20261206$
DECLARE
  r record;
  v_hash text;
BEGIN
  FOR r IN
    SELECT *
      FROM (VALUES
        ('public.cupom__vaga_volta_em(uuid, text, text, boolean, timestamptz, boolean, timestamptz, text, integer)', 'e92200a0af3c3dfa4051e0076ae9ba184476678f9bc2484a369d317d745f534d', '865c4de58c2fbc272c41f5d0ab03deb1410b6a9d6ce8fd3762659e2c28e15a3d'),
        ('public.devolver_cupons_de_pedidos_mortos()', '85a340abad3fb3f3cd913f50126bc610f584076295bbb61a8203fabcbd6c0633', 'd0b285fdb3d939243e4399e69e04bbd1bead56ab231079199cac2ed56b3ea0ae')
      ) AS e(assinatura, hash_lf, hash_crlf)
  LOOP
    SELECT encode(sha256(convert_to(prosrc, 'UTF8')), 'hex') INTO v_hash
      FROM pg_proc
     WHERE oid = to_regprocedure(r.assinatura);
    IF v_hash IS NULL OR v_hash NOT IN (r.hash_lf, r.hash_crlf) THEN
      RAISE EXCEPTION 'ROLLBACK_20261206: % nao voltou ao corpo anterior (hash %) -- nada foi mantido.', r.assinatura, COALESCE(v_hash, 'ausente');
    END IF;
  END LOOP;
END
$verifica_rollback_20261206$;
