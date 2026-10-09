-- ============================================================================
-- Migration 20261205000000 -- o cupom preso diz quando a vaga volta
-- (cupom + dado de cliente; issues #210 e #116; 09/10/2026)
-- ============================================================================
--
-- 1. O DEFEITO QUE ESTA MIGRATION COMECA A FECHAR
--
-- O cliente aplica um cupom de uso limitado, o pedido nasce e SEGURA uma vaga
-- (usage_count + 1). Se o pedido e cancelado (ou o PIX vence), a vaga NAO volta
-- na hora: so a varredura `devolver_cupons_de_pedidos_mortos()` (pg_cron, a cada
-- 15 min) a devolve, e so depois que o pedido nao pode mais ser pago (hoje:
-- `expires_at + 24 h`, ou na hora quando o pedido nasceu sem `expires_at`). Nesse
-- intervalo o checkout recusa o cupom com "Cupom atingiu o limite de uso." --
-- frase que nao diz que a vaga e do PROPRIO cliente nem quando ela volta, e o
-- cliente conclui que o cupom acabou.
--
-- 2. O QUE ESTA MIGRATION FAZ (a 1a das duas pecas; a 2a e a 20261206000000)
--
-- Cria DUAS funcoes novas, SOMENTE LEITURA, e nao redefine nenhuma existente:
--
--   (a) `public.cupom__vaga_volta_em(...) RETURNS timestamptz` -- o auxiliar.
--       Recebe PARAMETROS SIMPLES (nunca a linha da tabela: uma funcao que
--       recebe `marketplace_orders` o PostgREST exporia como coluna calculada
--       da tabela) e devolve QUANDO a varredura devolve a vaga daquele pedido:
--         * '-infinity' -- a varredura devolve ja (pedido sem expires_at);
--         * expires_at + 24 h -- a espera de hoje;
--         * 'infinity' -- a varredura NAO devolve (nem vai devolver): pedido sem
--           cupom, nao cancelado, pago, pago_apos_expirar, ja devolvido, ou
--           cancelado depois do envio sem o retorno do produto registrado.
--       Espelha EXATAMENTE o WHERE da varredura 20260970000000 (a prova viva
--       exige "volta antes de agora" se e somente se a varredura devolve o
--       pedido, caso a caso). Ja declara `p_gateway_payment_id` e
--       `p_tentativas` e nao os usa: a 20261206000000 passa a usa-los sem
--       mudar a assinatura. STABLE (usa now()). Sem EXECUTE para ninguem alem do
--       dono e das funcoes SECURITY DEFINER que a chamam.
--
--   (b) `public.vaga_do_cupom_presa(p_code text) RETURNS jsonb` -- a RPC do
--       checkout. SECURITY DEFINER, search_path = public, EXECUTE so para
--       `authenticated`. Responde {presa, volta_em_minutos}: `presa` e true SO
--       quando o USUARIO DA SESSAO tem um pedido DELE com esse cupom que a
--       varredura vai devolver um dia; `volta_em_minutos` e a espera ate a hora
--       da devolucao (arredondada para CIMA) mais os 15 min do ciclo do
--       agendamento -- a promessa e um TETO, nunca um chute para baixo.
--       Aplica GREATEST(hora, now()) ANTES de subtrair: a aritmetica com
--       infinito difere entre PG15 e PG17, e '-infinity' (pedido sem
--       expires_at) so vira "0 min de espera" depois do GREATEST.
--       NUNCA diz nada de pedido de outro usuario, de outro codigo ou de cupom
--       inativo: cupom inexistente, inativo, nao preso, pedido de convidado
--       (user_id NULL) e chamada sem sessao devolvem a MESMA resposta
--       `{presa:false, volta_em_minutos:null}`, byte a byte -- a RPC nao pode
--       virar sonda de "este codigo existe". O dono e sempre `auth.uid()` da
--       sessao, nunca parametro. Nao escreve em nada.
--
-- 3. POR QUE NAO REDEFINIR A VALIDACAO NEM O CRIAR-PEDIDO
--
-- `validate_coupon_secure_v2` tem o corpo travado por hash na 20261203000000 e
-- em duas provas vivas; `create_marketplace_order_v23/_v24` tem ~950 linhas cada e
-- varios escritores. Esta peca so AJUDA a tela a explicar a recusa que ja
-- existe: o front chama a RPC quando a validacao recusa por limite de uso. O
-- calculo do desconto e a devolucao da vaga ficam como estao.
--
-- 4. DADOS EXISTENTES: nenhum e lido nem alterado ao aplicar. So cria duas
--    funcoes. Chamada, a RPC le os pedidos do PROPRIO usuario da sessao.
--
-- 5. IDEMPOTENCIA: `CREATE OR REPLACE`, REVOKE/GRANT e COMMENT repetiveis --
--    reaplicar produz o mesmo estado. O pre-voo recusa, com o NOME do que falta
--    ou diverge e SEM gravar nada: dependencias ausentes, mais de uma versao da
--    varredura, corpo vivo da varredura diferente do da 20260970000000 (sha256,
--    LF ou CRLF -- o auxiliar so e correto para ESSE corpo; uma migration
--    posterior que o mude exige revisao antes), colunas ausentes, e as duas
--    funcoes ja existentes com OUTRO corpo. O pos-voo confere de novo, depois de
--    criar, que as duas saem com o corpo previsto e a varredura continua
--    intacta; se nao, a migration inteira cai. Os hashes sao amarrados ao texto
--    por tests/migration_o_cupom_preso_diz_quando_a_vaga_volta_test.ts.
--
-- 6. TRANSACAO: sem `BEGIN`/`COMMIT` de nivel superior (regra da casa: com eles
--    o `ROLLBACK` da prova do workflow vira no-op). O workflow manda o arquivo
--    inteiro numa consulta so: pre-voo, funcoes, grants, comentarios e pos-voo
--    caem juntos ou nao caem.
--
-- 7. ORDEM: depois da 20261204000000. Seguro em qualquer ordem de publicacao:
--    banco novo + front velho nao muda nada para ninguem; front novo + banco
--    velho: a chamada da RPC falha (PGRST202) e o front mostra a frase antiga.
--
-- 8. FICHA DE VERIFICACAO (contra o banco vivo):
--   SELECT prosecdef, proconfig FROM pg_proc
--    WHERE oid = to_regprocedure('public.vaga_do_cupom_presa(text)');
--   -- esperado: true, {search_path=public}
--   SELECT has_function_privilege('anon', 'public.vaga_do_cupom_presa(text)', 'EXECUTE'),
--          has_function_privilege('authenticated', 'public.vaga_do_cupom_presa(text)', 'EXECUTE'),
--          has_function_privilege('service_role', 'public.vaga_do_cupom_presa(text)', 'EXECUTE');
--   -- esperado: false, true, false
--   Prova de comportamento: tests/banco/cupom-preso-viva.cjs (rpc-ci.yml).
--
-- 9. ROLLBACK MANUAL: supabase/migrations/rollback-manual-20261205000000_o_cupom_preso_diz_quando_a_vaga_volta.sql
--    (so derruba as duas funcoes; recusa se a varredura ja nao for a da
--    20260970000000 -- a 20261206000000 a faz depender do auxiliar).
-- ============================================================================

DO $preflight_20261205$
DECLARE
  v_item text;
  v_hash text;
  v_hash_varredura text;
  r record;
BEGIN
  -- (1) A varredura: UMA versao so, com o corpo da 20260970000000 (LF ou CRLF).
  IF (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
       WHERE n.nspname = 'public' AND p.proname = 'devolver_cupons_de_pedidos_mortos') <> 1 THEN
    RAISE EXCEPTION 'PREFLIGHT_20261205: esperava exatamente uma versao de devolver_cupons_de_pedidos_mortos() -- inventarie antes de aplicar (nunca DROP para arrumar).';
  END IF;

  SELECT encode(sha256(convert_to(prosrc, 'UTF8')), 'hex') INTO v_hash_varredura
    FROM pg_proc
   WHERE oid = to_regprocedure('public.devolver_cupons_de_pedidos_mortos()');
  IF v_hash_varredura IS NULL OR v_hash_varredura NOT IN (
    '85a340abad3fb3f3cd913f50126bc610f584076295bbb61a8203fabcbd6c0633',
    'd0b285fdb3d939243e4399e69e04bbd1bead56ab231079199cac2ed56b3ea0ae'
  ) THEN
    RAISE EXCEPTION 'PREFLIGHT_20261205: corpo vivo de devolver_cupons_de_pedidos_mortos() (hash %) difere do da 20260970000000 -- o auxiliar cupom__vaga_volta_em so espelha esse corpo; revise antes de aplicar.', COALESCE(v_hash_varredura, 'ausente');
  END IF;

  -- (2) Dependencias.
  FOREACH v_item IN ARRAY ARRAY[
    'public.devolver_uso_cupom(uuid)',
    'auth.uid()'
  ] LOOP
    IF to_regprocedure(v_item) IS NULL THEN
      RAISE EXCEPTION 'PREFLIGHT_20261205: falta a funcao % -- aplique antes as migrations 20260901000000 (devolver_uso_cupom) e o esquema auth do Supabase.', v_item;
    END IF;
  END LOOP;

  FOREACH v_item IN ARRAY ARRAY[
    'public.marketplace_orders',
    'public.coupons'
  ] LOOP
    IF to_regclass(v_item) IS NULL THEN
      RAISE EXCEPTION 'PREFLIGHT_20261205: falta a tabela % -- aplique as migrations anteriores antes desta.', v_item;
    END IF;
  END LOOP;

  FOR r IN
    SELECT *
      FROM (VALUES
        ('marketplace_orders', 'id'),
        ('marketplace_orders', 'user_id'),
        ('marketplace_orders', 'coupon_id'),
        ('marketplace_orders', 'status'),
        ('marketplace_orders', 'payment_status'),
        ('marketplace_orders', 'coupon_usage_returned'),
        ('marketplace_orders', 'expires_at'),
        ('marketplace_orders', 'cancelled_after_shipping'),
        ('marketplace_orders', 'returned_to_seller_at'),
        ('marketplace_orders', 'gateway_payment_id'),
        ('marketplace_orders', 'tentativas_de_pagamento'),
        ('coupons', 'id'),
        ('coupons', 'code'),
        ('coupons', 'active')
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
      RAISE EXCEPTION 'PREFLIGHT_20261205: falta a coluna public.%.% -- aplique as migrations anteriores antes desta (20260970000000 e 20261176000000).', r.tabela, r.coluna;
    END IF;
  END LOOP;

  -- (3) Reaplicar e' permitido; sobrescrever OUTRO corpo, nao.
  SELECT encode(sha256(convert_to(prosrc, 'UTF8')), 'hex') INTO v_hash
    FROM pg_proc
   WHERE oid = to_regprocedure('public.cupom__vaga_volta_em(uuid, text, text, boolean, timestamptz, boolean, timestamptz, text, integer)');
  IF v_hash IS NOT NULL AND v_hash NOT IN (
    'e92200a0af3c3dfa4051e0076ae9ba184476678f9bc2484a369d317d745f534d',
    '865c4de58c2fbc272c41f5d0ab03deb1410b6a9d6ce8fd3762659e2c28e15a3d'
  ) THEN
    RAISE EXCEPTION 'PREFLIGHT_20261205: public.cupom__vaga_volta_em ja existe com outro corpo (hash %) -- revise antes de aplicar.', v_hash;
  END IF;

  SELECT encode(sha256(convert_to(prosrc, 'UTF8')), 'hex') INTO v_hash
    FROM pg_proc
   WHERE oid = to_regprocedure('public.vaga_do_cupom_presa(text)');
  IF v_hash IS NOT NULL AND v_hash NOT IN (
    'b49a93a797b99545b6fbbcd326e39873d9b82c398b3c7fed75ab4bcdbed0cc5a',
    '981ad73ca42caee38cf8d81cfadc04c8175234db02c42e56868323a90269d59d'
  ) THEN
    RAISE EXCEPTION 'PREFLIGHT_20261205: public.vaga_do_cupom_presa ja existe com outro corpo (hash %) -- revise antes de aplicar.', v_hash;
  END IF;
END
$preflight_20261205$;

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

REVOKE ALL ON FUNCTION public.cupom__vaga_volta_em(uuid, text, text, boolean, timestamptz, boolean, timestamptz, text, integer) FROM PUBLIC, anon, authenticated, service_role;

COMMENT ON FUNCTION public.cupom__vaga_volta_em(uuid, text, text, boolean, timestamptz, boolean, timestamptz, text, integer) IS 'Cupom preso (20261205000000): QUANDO a varredura devolver_cupons_de_pedidos_mortos() devolve a vaga do cupom de um pedido. -infinity = ja; infinity = nunca (nem vai); senao a hora. Espelha o WHERE da varredura da 20260970000000. Parametros simples de proposito (o PostgREST nao a exporia como coluna calculada). Sem EXECUTE para ninguem alem do dono e das funcoes SECURITY DEFINER que a chamam.';

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
    -- o auxiliar (a mesma regra da varredura): 'infinity' = nunca. Sem sessao
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
            WHERE UPPER(c.code) = UPPER(p_code) AND c.active = true);

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

REVOKE ALL ON FUNCTION public.vaga_do_cupom_presa(text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.vaga_do_cupom_presa(text) TO authenticated;

COMMENT ON FUNCTION public.vaga_do_cupom_presa(text) IS 'Cupom preso (20261205000000): so LEITURA. Diz ao checkout se a vaga do cupom p_code esta presa num pedido cancelado do PROPRIO usuario da sessao e em quantos minutos a varredura a devolve (teto: espera ate a hora, arredondada para cima, mais 15 min do ciclo). Pedido de outro usuario, de convidado, outro codigo, cupom inexistente ou inativo, pedido que a varredura nao devolve e chamada sem sessao: a MESMA resposta presa = false (nao vira sonda de codigo).';

DO $posvoo_20261205$
DECLARE
  r record;
  v_hash text;
BEGIN
  FOR r IN
    SELECT *
      FROM (VALUES
        ('public.cupom__vaga_volta_em(uuid, text, text, boolean, timestamptz, boolean, timestamptz, text, integer)', 'e92200a0af3c3dfa4051e0076ae9ba184476678f9bc2484a369d317d745f534d', '865c4de58c2fbc272c41f5d0ab03deb1410b6a9d6ce8fd3762659e2c28e15a3d'),
        ('public.vaga_do_cupom_presa(text)', 'b49a93a797b99545b6fbbcd326e39873d9b82c398b3c7fed75ab4bcdbed0cc5a', '981ad73ca42caee38cf8d81cfadc04c8175234db02c42e56868323a90269d59d'),
        ('public.devolver_cupons_de_pedidos_mortos()', '85a340abad3fb3f3cd913f50126bc610f584076295bbb61a8203fabcbd6c0633', 'd0b285fdb3d939243e4399e69e04bbd1bead56ab231079199cac2ed56b3ea0ae')
      ) AS e(assinatura, hash_lf, hash_crlf)
  LOOP
    SELECT encode(sha256(convert_to(prosrc, 'UTF8')), 'hex') INTO v_hash
      FROM pg_proc
     WHERE oid = to_regprocedure(r.assinatura);
    IF v_hash IS NULL OR v_hash NOT IN (r.hash_lf, r.hash_crlf) THEN
      RAISE EXCEPTION 'POSVOO_20261205: % saiu da migration com o corpo (hash %) e nao com o esperado -- nada foi mantido.', r.assinatura, COALESCE(v_hash, 'ausente');
    END IF;
  END LOOP;
END
$posvoo_20261205$;
