-- ============================================================================
-- Rollback manual — o PIX pago no último minuto não perde o pedido (20261393000000)
-- ============================================================================
-- Recria public.expirar_pedidos_vencidos() com o corpo VIGENTE de antes (o da
-- 20261186000000, byte a byte: o md5 de replace(prosrc, E'\r', '') volta a ser
-- 4e6b4c105ee2eaaecd9c2e19a5c535af, e a prova viva confere). Assinatura, SECURITY DEFINER, search_path e retorno são os
-- mesmos da migration.
--
-- A ACL NÃO é tocada: CREATE OR REPLACE preserva dono e privilégios, e este arquivo não tem
-- nenhum GRANT nem REVOKE — nunca devolve EXECUTE a anon, authenticated ou PUBLIC.
--
-- COM ELE VOLTA O DEFEITO: o PIX pago nos últimos segundos do prazo volta a poder ser
-- cancelado pela varredura antes de o aviso do Mercado Pago chegar (vira 'pago_apos_expirar' e
-- a mercadoria pode ser vendida a outra pessoa).
--
-- DADOS: nenhuma linha foi reescrita pela migration nem é tocada aqui.
--
-- PRÉ-VOO: recusa (B1_BASELINE_DIVERGENT) se a função não existir ou tiver sobrecarga; se o
-- corpo vivo não for um dos dois conhecidos (o desta migration, ou o vigente — e então rodar de
-- novo reescreve o mesmo texto) — reescrever por cima de um corpo desconhecido apagaria uma
-- redefinição que ninguém revisou; se os atributos não forem os de sempre; ou se a função
-- estiver aberta a PUBLIC, anon ou authenticated. A conferência final recusa se o corpo não
-- voltou ao vigente, se algum atributo mudou ou se a função ficou aberta.
--
-- ORDEM: este vem ANTES do rollback da 20261186000000, se os dois forem rodados.
--
-- Executar pelo aplicar-migrations.yml (apaga o registro do ledger na mesma transação). Sem
-- BEGIN/COMMIT de nível superior neste arquivo — regra da casa. Rodar duas vezes deixa o mesmo
-- estado.
-- ============================================================================

DO $preflight_rollback_20261393000000$
DECLARE
  v_fn CONSTANT text := 'public.expirar_pedidos_vencidos()';
  v_oid oid := to_regprocedure('public.expirar_pedidos_vencidos()');
  v_hash text;
BEGIN
  IF v_oid IS NULL THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: % não existe — nada a devolver.', v_fn;
  END IF;
  IF (SELECT count(*) FROM pg_proc p
       WHERE p.pronamespace = 'public'::regnamespace AND p.proname = 'expirar_pedidos_vencidos') <> 1 THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: expirar_pedidos_vencidos tem sobrecarga em public — revise antes de devolver o corpo vigente.';
  END IF;

  -- O corpo vivo tem de ser o desta migration (desfaz) ou o vigente (já desfeito: reescreve o mesmo texto).
  SELECT md5(replace(prosrc, E'\r', '')) INTO v_hash FROM pg_proc WHERE oid = v_oid;
  IF v_hash IS NULL OR v_hash NOT IN (
       '4e6b4c105ee2eaaecd9c2e19a5c535af', -- corpo da 20261186000000 (o que este rollback devolve)
       '463086667b8d20b327c37faac9a9b16f'  -- corpo desta migration (o que este rollback desfaz)
     ) THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: corpo vivo de % (hash %) não é o desta migration nem o vigente — uma redefinição posterior está no ar; revise antes de sobrescrever.', v_fn, COALESCE(v_hash, 'ausente');
  END IF;

  IF NOT EXISTS (
       SELECT 1 FROM pg_proc p JOIN pg_language l ON l.oid = p.prolang
        WHERE p.oid = v_oid
          AND l.lanname = 'plpgsql'
          AND p.prosecdef
          AND p.provolatile = 'v'
          AND NOT p.proretset
          AND p.proconfig = ARRAY['search_path=public']::text[]
          AND pg_get_function_arguments(p.oid) = ''
          AND pg_get_function_result(p.oid) = 'integer'
     ) THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: atributos de % não são os conhecidos — revise antes de sobrescrever.', v_fn;
  END IF;

  IF EXISTS (SELECT 1 FROM pg_proc p
               CROSS JOIN LATERAL aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) g
              WHERE p.oid = v_oid AND g.privilege_type = 'EXECUTE' AND g.grantee = 0)
     OR has_function_privilege('anon', v_oid, 'EXECUTE')
     OR has_function_privilege('authenticated', v_oid, 'EXECUTE') THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: % está aberta (PUBLIC, anon ou authenticated) — o estado de antes nunca teve isso; revise a ACL antes.', v_fn;
  END IF;
END $preflight_rollback_20261393000000$;

CREATE OR REPLACE FUNCTION public.expirar_pedidos_vencidos()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $expirar$
DECLARE
    v_pedido   RECORD;
    v_expirados integer := 0;
BEGIN
    -- FOR UPDATE SKIP LOCKED protege contra OUTRA varredura: se dois ciclos do
    -- pg_cron se sobrepuserem, o segundo pula a linha travada em vez de creditar
    -- estoque duas vezes. NAO resolve a corrida com o webhook da Fase 3: se a
    -- varredura pegar a trava primeiro, o UPDATE do webhook espera, reavalia o
    -- WHERE por id (que continua valendo) e sobrescreve — sai pedido 'pago' com
    -- status 'cancelled' e estoque ja devolvido. Tratar esse estado e' obrigacao
    -- de quem escrever o webhook; a CHECK ja reserva 'pago_apos_expirar' para
    -- ele. Este comentario e' o que a Fase 3 vai ler: nao prometa aqui garantia
    -- que o codigo nao da.
    --
    -- status = 'pending' e' o filtro que impede credito em dobro: quando o
    -- cliente cancela pelo app, a update_order_status_atomic JA devolve o
    -- estoque e NAO escreve payment_status. Sem este AND, o pedido cancelado as
    -- 10:05 seria varrido as 10:30 e creditado uma segunda vez. Vale tambem para
    -- o pedido que o admin adiantou para 'processing' dentro dos 30 minutos:
    -- venda fechada por fora nao pode ser cancelada por varredura.
    FOR v_pedido IN
        SELECT id
        FROM public.marketplace_orders
        WHERE payment_status = 'aguardando'
          AND status = 'pending'
          AND expires_at IS NOT NULL
          AND expires_at < now()
          -- Cartao possivelmente vivo NAO expira enquanto a reconciliacao ainda
          -- o enxerga (mesma janela de 24 h de pagamentos_a_reconciliar,
          -- 20261010000000): um cartao em analise antifraude nao estende
          -- expires_at, e cancelar aqui devolveria o estoque de um pedido que o
          -- banco ainda pode aprovar. O COALESCE embrulha o teste inteiro: com
          -- metodo_online NULL, NOT (NULL) seria NULL e a linha sumiria da
          -- varredura. PIX, sem vaga e vaga liberada nunca sao "cartao vivo".
          AND (
                expires_at <= now() - interval '24 hours'
                OR NOT COALESCE(
                     gateway_payment_id LIKE 'verificando:%'
                     OR (
                          gateway_payment_id IS NOT NULL
                          AND metodo_online IN ('credito', 'debito')
                        ),
                     false
                   )
              )
        FOR UPDATE SKIP LOCKED
    LOOP
        PERFORM public.devolver_estoque(v_pedido.id);

        UPDATE public.marketplace_orders
           SET payment_status = 'expirado',
               status         = 'cancelled',
               updated_at     = now()
         WHERE id = v_pedido.id;

        v_expirados := v_expirados + 1;
    END LOOP;

    RETURN v_expirados;
END;
$expirar$;

-- CONFERÊNCIA: o corpo voltou ao vigente (o da 20261186000000), atributos e ACL de sempre.
DO $conferencia_rollback_20261393000000$
DECLARE
  v_fn CONSTANT text := 'public.expirar_pedidos_vencidos()';
  v_oid oid := to_regprocedure('public.expirar_pedidos_vencidos()');
  v_hash text;
BEGIN
  SELECT md5(replace(prosrc, E'\r', '')) INTO v_hash FROM pg_proc WHERE oid = v_oid;
  IF v_hash IS DISTINCT FROM '4e6b4c105ee2eaaecd9c2e19a5c535af' THEN
    RAISE EXCEPTION 'conferencia rollback 20261393000000: corpo vivo de % (hash %) não voltou ao vigente', v_fn, COALESCE(v_hash, 'ausente');
  END IF;
  IF NOT EXISTS (
       SELECT 1 FROM pg_proc p JOIN pg_language l ON l.oid = p.prolang
        WHERE p.oid = v_oid
          AND l.lanname = 'plpgsql'
          AND p.prosecdef
          AND p.provolatile = 'v'
          AND NOT p.proretset
          AND p.proconfig = ARRAY['search_path=public']::text[]
          AND pg_get_function_arguments(p.oid) = ''
          AND pg_get_function_result(p.oid) = 'integer'
     ) THEN
    RAISE EXCEPTION 'conferencia rollback 20261393000000: atributos de % mudaram', v_fn;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_proc p
               CROSS JOIN LATERAL aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) g
              WHERE p.oid = v_oid AND g.privilege_type = 'EXECUTE' AND g.grantee = 0)
     OR has_function_privilege('anon', v_oid, 'EXECUTE')
     OR has_function_privilege('authenticated', v_oid, 'EXECUTE') THEN
    RAISE EXCEPTION 'conferencia rollback 20261393000000: ACL de % mudou', v_fn;
  END IF;
END $conferencia_rollback_20261393000000$;
