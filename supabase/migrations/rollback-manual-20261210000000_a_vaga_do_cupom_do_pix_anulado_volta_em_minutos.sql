-- ============================================================================
-- Rollback manual -- a vaga do cupom do PIX anulado volta em minutos (20261210000000)
-- ============================================================================
-- Devolve as TRES funcoes ao estado anterior, byte a byte, com os comentarios:
--   * public.devolver_cupons_de_pedidos_mortos() -> o corpo e o comentario da 20261206000000;
--   * public.vaga_do_cupom_presa(text) -> o corpo e o comentario da 20261205000000;
--   * public.cupom__vaga_volta_em -> volta aos 9 PARAMETROS: apaga a versao de 13 e recria a de 9
--     com o corpo, o comentario e a ACL (sem EXECUTE para ninguem) da 20261206000000.
-- Nao toca dado (nenhuma linha de pedido, cupom ou foto): o cupom que a varredura ja devolveu pela
-- pista do PIX anulado continua devolvido (coupon_usage_returned = true). A tabela da foto e o
-- gatilho (20261209000000) nao mudam.
--
-- O QUE VOLTA A VALER: o cupom de pedido cancelado com o PIX gerado volta so 24 h depois do prazo
-- do PIX, como antes.
--
-- GUARDA: so restaura se o corpo vivo de CADA funcao for o desta migration (LF ou CRLF) ou o ja
-- restaurado; ha uma versao so de cada funcao. Outro corpo e' de uma migration POSTERIOR que a
-- redefiniu: restaurar por cima apagaria a guarda dela em silencio. Rollback repetido e' idempotente.
--
-- ORDEM DE DESFAZER: 20261210000000 (este) -> 20261209000000 -> 20261206000000 -> 20261205000000.
-- O rollback da 20261209000000 recusa enquanto as funcoes desta migration citarem a tabela da foto.
--
-- Nenhuma trava de tabela: so funcoes. COMO DESFAZER: pelo WORKFLOW `aplicar-migrations.yml`, com
-- este arquivo (`rollback-manual-<versao>`), que APAGA a linha 20261210000000 do ledger na MESMA
-- transacao. NUNCA por `psql` direto. Sem BEGIN/COMMIT de nivel superior -- regra da casa.
-- ============================================================================

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

DO $guarda_rollback_20261210$
DECLARE
  v_hash text;
  v_n integer;
BEGIN
  SELECT count(*) INTO v_n FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'cupom__vaga_volta_em';
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'ROLLBACK_20261210: esperava exatamente uma versao de cupom__vaga_volta_em e ha % -- inventarie antes de desfazer; nada foi alterado.', v_n;
  END IF;
  IF to_regprocedure('public.cupom__vaga_volta_em(uuid, text, text, boolean, timestamptz, boolean, timestamptz, text, integer, text, integer, text, text)') IS NOT NULL THEN
    SELECT encode(sha256(convert_to(prosrc, 'UTF8')), 'hex') INTO v_hash
      FROM pg_proc WHERE oid = to_regprocedure('public.cupom__vaga_volta_em(uuid, text, text, boolean, timestamptz, boolean, timestamptz, text, integer, text, integer, text, text)');
    IF v_hash NOT IN ('0790c1962b526725c377344208392bfb7f15b1de20b0056e5bbb3002e40aa020', '8a8be76b9afd31e4e2c41f7bf559c472fbf33891cc1a771ff9116452b18afd5a') THEN
      RAISE EXCEPTION 'ROLLBACK_20261210: corpo vivo de cupom__vaga_volta_em de 13 parametros (hash %) nao e o da 20261210000000 -- uma migration posterior o redefiniu; reverta-a antes; nada foi alterado.', v_hash;
    END IF;
  ELSE
    SELECT encode(sha256(convert_to(prosrc, 'UTF8')), 'hex') INTO v_hash
      FROM pg_proc WHERE oid = to_regprocedure('public.cupom__vaga_volta_em(uuid, text, text, boolean, timestamptz, boolean, timestamptz, text, integer)');
    IF v_hash IS NULL OR v_hash NOT IN ('aa8f0ef494f54dc952ed9f8fd7e95997a988086c278bfd0ebbdf0117f68c2363', '6fc3bb6775c34d5739516fa9841bbc4787ae2d3be87e647acca8d465c513f6b6') THEN
      RAISE EXCEPTION 'ROLLBACK_20261210: corpo vivo de cupom__vaga_volta_em de 9 parametros (hash %) nao e o da 20261206000000 -- nada a desfazer aqui; nada foi alterado.', COALESCE(v_hash, 'ausente');
    END IF;
  END IF;

  SELECT encode(sha256(convert_to(prosrc, 'UTF8')), 'hex') INTO v_hash
    FROM pg_proc WHERE oid = to_regprocedure('public.vaga_do_cupom_presa(text)');
  IF v_hash IS NULL OR v_hash NOT IN ('d752391f13d27a741c3401b20a375ef7a7952bda3dfb2f6c257b96f6128cc84d', '9c659b8c1b18a808719c908076e9ce8948c384dae788aa396c4059512b5c1001', 'a7db9046f7dbb296c0d92ada3b097ef79c68d3e76a76df2c9542ec11b2d76b47', '49e0b6befb684756ed4f1fada1e30ed7162763dc903816f49f2f76ce61820593') THEN
    RAISE EXCEPTION 'ROLLBACK_20261210: corpo vivo de vaga_do_cupom_presa (hash %) nao e o da 20261210000000 nem o da 20261205000000 -- uma migration posterior o redefiniu; reverta-a antes; nada foi alterado.', COALESCE(v_hash, 'ausente');
  END IF;

  SELECT encode(sha256(convert_to(prosrc, 'UTF8')), 'hex') INTO v_hash
    FROM pg_proc WHERE oid = to_regprocedure('public.devolver_cupons_de_pedidos_mortos()');
  IF v_hash IS NULL OR v_hash NOT IN ('0e3fffedbd871c372ad000393b9f3c1abcda64a5703735a00cd5173f98bb35ae', 'a0c8175ce56857e24fb7ebab37d18e45386f3711506f3906013ed73036c7f6ad', 'f35db1e788fb8e0472dd6b8318c69be524c3f932d62c5f7b2856fe97d243eb4f', 'c7e38a04defe6b286519f2325c6d4d8ec727f57c4b0edbb5bc5831d936fbe9b8') THEN
    RAISE EXCEPTION 'ROLLBACK_20261210: corpo vivo de devolver_cupons_de_pedidos_mortos() (hash %) nao e o da 20261210000000 nem o da 20261206000000 -- uma migration posterior o redefiniu; reverta-a antes; nada foi alterado.', COALESCE(v_hash, 'ausente');
  END IF;
END $guarda_rollback_20261210$;

-- A varredura da 20261206000000, copiada caractere a caractere de
-- supabase/migrations/20261206000000_a_vaga_do_cupom_nunca_cobrado_volta_em_uma_hora.sql.
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

COMMENT ON FUNCTION public.devolver_cupons_de_pedidos_mortos() IS
  'Unico lugar onde a vaga de um cupom volta depois que um pedido que o usou e desfeito (so a varredura devolve; o cancelamento nao). Quando a vaga volta quem decide e public.cupom__vaga_volta_em(): na hora para pedido sem expires_at, 45 min depois de expires_at para pedido NUNCA cobrado (sem id de cobranca e zero tentativas), 24 h para o resto, e nunca para pedido pago, pago_apos_expirar, ja devolvido ou cancelado depois do envio sem o produto de volta. Nunca deduz "ja devolvido" do estado: le e grava o fato na coluna coupon_usage_returned. FOR UPDATE SKIP LOCKED: dois ciclos nunca devolvem o mesmo pedido. Agendada via pg_cron a cada 15 minutos (20260901000000). Reescrita em 20261206000000.';

-- A RPC da 20261205000000, copiada caractere a caractere de
-- supabase/migrations/20261205000000_o_cupom_preso_diz_quando_a_vaga_volta.sql.
CREATE OR REPLACE FUNCTION public.vaga_do_cupom_presa(p_code text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path = public
AS $function$
DECLARE
    v_volta timestamptz;
    v_minutos integer;
BEGIN
    -- A hora mais proxima em que a varredura devolve uma vaga DESTE cupom, entre
    -- os pedidos do PROPRIO usuario da sessao. Quem decide se um pedido conta e
    -- o auxiliar (a mesma regra da varredura): 'infinity' = nunca. So conta o
    -- cupom que DEVOLVER UMA vaga destrava de verdade: com limite (a validacao
    -- trata NULL e 0 como ilimitado) e no limite exato (usage_count = usage_limit);
    -- limite rebaixado (usage_count > usage_limit) ou vaga ainda livre: nao presa.
    -- Sem sessao
    -- (auth.uid() NULL) e pedido de convidado (user_id NULL) `=` nunca casa: a
    -- resposta e a de "nao preso", igual a de cupom inexistente.
    SELECT min(public.cupom__vaga_volta_em(
               o.coupon_id, o.status, o.payment_status, o.coupon_usage_returned,
               o.expires_at, o.cancelled_after_shipping, o.returned_to_seller_at,
               o.gateway_payment_id, o.tentativas_de_pagamento))
      INTO v_volta
      FROM public.marketplace_orders o
     WHERE o.user_id = (SELECT auth.uid())
       AND o.coupon_id IN (
           SELECT c.id FROM public.coupons c
            WHERE UPPER(c.code) = UPPER(p_code) AND c.active = true
              AND c.usage_limit > 0 AND c.usage_count = c.usage_limit);

    IF v_volta IS NULL OR v_volta = 'infinity'::timestamptz THEN
        RETURN jsonb_build_object('presa', false, 'volta_em_minutos', NULL);
    END IF;

    -- GREATEST ANTES de subtrair: '-infinity' (pedido sem expires_at) e hora ja
    -- vencida viram "agora"; so entao a diferenca e finita em PG15 e em PG17.
    v_volta := GREATEST(v_volta, now());
    -- Para CIMA (nunca prometer menos que o real) + os 15 min do ciclo do
    -- agendamento da varredura.
    v_minutos := ceil(extract(epoch FROM (v_volta - now())) / 60.0)::integer + 15;

    RETURN jsonb_build_object('presa', true, 'volta_em_minutos', v_minutos);
END;
$function$;

COMMENT ON FUNCTION public.vaga_do_cupom_presa(text) IS 'Cupom preso (20261205000000): so LEITURA. Diz ao checkout se a vaga do cupom p_code esta presa num pedido cancelado do PROPRIO usuario da sessao e em quantos minutos a varredura a devolve (teto: espera ate a hora, arredondada para cima, mais 15 min do ciclo). Cupom ilimitado, com limite rebaixado (mais usos que o limite) ou com vaga livre tambem: presa = false (devolver uma vaga nao o destrava). Pedido de outro usuario, de convidado, outro codigo, cupom inexistente ou inativo, pedido que a varredura nao devolve e chamada sem sessao: a MESMA resposta presa = false (nao vira sonda de codigo).';

-- O auxiliar volta aos 9 parametros: apaga o de 13 (recriado por esta migration) e recria o da
-- 20261206000000, copiado caractere a caractere. Sem CASCADE de proposito.
DROP FUNCTION IF EXISTS public.cupom__vaga_volta_em(uuid, text, text, boolean, timestamptz, boolean, timestamptz, text, integer, text, integer, text, text);

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

DO $verifica_rollback_20261210$
DECLARE
  r record;
  v_hash text;
BEGIN
  FOR r IN
    SELECT *
      FROM (VALUES
        ('public.cupom__vaga_volta_em(uuid, text, text, boolean, timestamptz, boolean, timestamptz, text, integer)', 'aa8f0ef494f54dc952ed9f8fd7e95997a988086c278bfd0ebbdf0117f68c2363', '6fc3bb6775c34d5739516fa9841bbc4787ae2d3be87e647acca8d465c513f6b6'),
        ('public.vaga_do_cupom_presa(text)', 'a7db9046f7dbb296c0d92ada3b097ef79c68d3e76a76df2c9542ec11b2d76b47', '49e0b6befb684756ed4f1fada1e30ed7162763dc903816f49f2f76ce61820593'),
        ('public.devolver_cupons_de_pedidos_mortos()', 'f35db1e788fb8e0472dd6b8318c69be524c3f932d62c5f7b2856fe97d243eb4f', 'c7e38a04defe6b286519f2325c6d4d8ec727f57c4b0edbb5bc5831d936fbe9b8')
      ) AS e(assinatura, hash_lf, hash_crlf)
  LOOP
    SELECT encode(sha256(convert_to(prosrc, 'UTF8')), 'hex') INTO v_hash
      FROM pg_proc
     WHERE oid = to_regprocedure(r.assinatura);
    IF v_hash IS NULL OR v_hash NOT IN (r.hash_lf, r.hash_crlf) THEN
      RAISE EXCEPTION 'ROLLBACK_20261210: % nao voltou ao corpo anterior (hash %) -- nada foi mantido.', r.assinatura, COALESCE(v_hash, 'ausente');
    END IF;
  END LOOP;
  IF to_regprocedure('public.cupom__vaga_volta_em(uuid, text, text, boolean, timestamptz, boolean, timestamptz, text, integer, text, integer, text, text)') IS NOT NULL THEN
    RAISE EXCEPTION 'ROLLBACK_20261210: cupom__vaga_volta_em de 13 parametros ainda existe depois do rollback -- nada foi mantido.';
  END IF;
END
$verifica_rollback_20261210$;
