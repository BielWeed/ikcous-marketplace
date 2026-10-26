-- Rollback manual da 20261389100000 (o estoque que volta tranca na mesma ordem da compra).
-- Devolve public.devolver_estoque(uuid) ao corpo da 20261175000000 (md5 05f6f7e6ac7a2fa7793298110cf17e96) byte a byte (LF), e o comentario da funcao ao dela,
-- mantendo OID, dono, atributos e ACL; nao toca em dados.
-- ATENCAO: reabre o defeito (um pedido que expira ou cancela pode cruzar travas com uma compra simultanea e receber 40P01). Nenhum
-- estoque, pedido ou carimbo e' alterado por este arquivo.
-- O pre-voo exige o corpo desta migration (md5 943b226906e91013e7cccf4992617e35) ou o da 175 (repetir o rollback e' no-op); qualquer outro corpo recusa.
-- Sem controle de transacao: o aplicador fornece a transacao inteira.

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

DO $preflight_rollback_20261389100000$
DECLARE
  v_hash text;
  v_atributos jsonb;
BEGIN
  SELECT md5(replace(p.prosrc, E'\r', '')), to_jsonb(p) - 'prosrc'
    INTO v_hash, v_atributos FROM pg_proc p
   WHERE p.oid = to_regprocedure('public.devolver_estoque(uuid)');
  IF v_hash IS NULL OR v_hash NOT IN ('05f6f7e6ac7a2fa7793298110cf17e96', '943b226906e91013e7cccf4992617e35') THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: public.devolver_estoque(uuid) (hash %) nao e o corpo desta migration (20261389100000) nem o da 20261175000000; revise antes de desfazer.', COALESCE(v_hash, 'ausente');
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
  -- Fotografia de OID, dono, ACL e TODOS os atributos: o CREATE OR REPLACE so pode trocar o texto (prosrc).
  PERFORM set_config('ikcous.devolver_estoque_atributos', v_atributos::text, true);
END $preflight_rollback_20261389100000$;

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
  'estoque. REVOKE de EXECUTE mantido (sao os donos das RPCs quem chamam).';

DO $conferencia_rollback_20261389100000$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p WHERE p.oid = to_regprocedure('public.devolver_estoque(uuid)')
      AND md5(replace(p.prosrc, E'\r', '')) = '05f6f7e6ac7a2fa7793298110cf17e96'
      AND (to_jsonb(p) - 'prosrc') = current_setting('ikcous.devolver_estoque_atributos')::jsonb
  ) THEN
    RAISE EXCEPTION 'B2_POSVOO_DIVERGENTE: conferencia rollback_20261389100000 falhou (corpo ou atributos alterados).';
  END IF;
END $conferencia_rollback_20261389100000$;

NOTIFY pgrst, 'reload schema';
