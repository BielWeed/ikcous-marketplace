-- ============================================================================
-- Rollback manual — o aviso do vale-troca diz que a loja combina (20261645000000)
-- ============================================================================
-- Devolve `public.devolucao_avisa_o_cliente()` ao corpo da 20261241000000, BYTE A BYTE (LF, sem CR; md5
-- 56502b960dcf3e136c1d0d5c41091c20 — copiado do arquivo da 20261241000000, a última migration que a definiu antes desta).
-- CREATE OR REPLACE: OID, dono, ACL e atributos ficam (a conferência compara com a fotografia do pré-voo).
--
-- COM ELE VOLTA O DEFEITO: a cliente que tem devolução concluída com vale-troca volta a ler no sino "O vale-troca da
-- devolução <protocolo> foi emitido." — e o app não emite vale nenhum.
--
-- DADOS: nenhuma linha é lida para reescrita, reescrita ou apagada. Os avisos gravados com o texto novo enquanto a
-- 20261645000000 esteve no ar ficam como foram gravados.
--
-- PRÉ-VOO: recusa (B1_BASELINE_DIVERGENT) antes de escrever se o corpo vivo não for o desta migration nem o da
-- 20261241000000 (uma redefinição posterior desconhecida está no ar: desfazer por cima a apagaria em silêncio), se a
-- função tiver sobrecarga ou atributos diferentes, ou se o gatilho não estiver ligado a ela. Estados aceitos: a
-- 20261645000000 no ar, ou já desfeita (rodar duas vezes deixa o mesmo estado).
--
-- Executar pelo aplicar-migrations.yml (apaga o registro do ledger na mesma transação). Sem BEGIN/COMMIT de nível
-- superior neste arquivo — regra da casa.
-- ============================================================================

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

DO $preflight_rollback_20261645000000$
DECLARE
  v_fn oid := to_regprocedure('public.devolucao_avisa_o_cliente()');
  v_hash text;
BEGIN
  IF (SELECT count(*) FROM pg_proc p
       WHERE p.pronamespace = 'public'::regnamespace AND p.proname = 'devolucao_avisa_o_cliente') <> 1
     OR v_fn IS NULL THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: public.devolucao_avisa_o_cliente() ausente, com outra assinatura ou com sobrecarga — revise antes de desfazer.';
  END IF;
  SELECT md5(replace(p.prosrc, E'\r', '')) INTO v_hash FROM pg_proc p WHERE p.oid = v_fn;
  IF v_hash IS NULL OR v_hash NOT IN ('68792e520aa47e6e62330718430d82a8', '56502b960dcf3e136c1d0d5c41091c20') THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: corpo vivo de devolucao_avisa_o_cliente (hash %) não é o desta migration nem o da 20261241000000 — uma redefinição posterior está no ar; revise antes de sobrescrever.', COALESCE(v_hash, 'ausente');
  END IF;
  IF NOT EXISTS (
       SELECT 1 FROM pg_proc p JOIN pg_language l ON l.oid = p.prolang
        WHERE p.oid = v_fn
          AND p.prokind = 'f' AND l.lanname = 'plpgsql' AND p.prosecdef AND p.provolatile = 'v'
          AND NOT p.proretset AND p.prorettype = 'trigger'::regtype AND p.pronargs = 0
          AND p.proconfig = ARRAY['search_path=public']::text[]
     ) THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: atributos de devolucao_avisa_o_cliente (linguagem, SECURITY DEFINER, volatilidade, retorno, argumentos ou search_path) não são os conhecidos.';
  END IF;
  IF NOT EXISTS (
       SELECT 1 FROM pg_trigger t
        WHERE t.tgrelid = to_regclass('public.devolucoes')
          AND t.tgname = 'tr_devolucao_avisa_o_cliente'
          AND NOT t.tgisinternal
          AND t.tgenabled = 'O'
          AND t.tgfoid = v_fn
     ) THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: o gatilho tr_devolucao_avisa_o_cliente não existe, está desligado ou aponta para outra função.';
  END IF;
  PERFORM set_config('ikcous.vale_troca_1645_rb', (SELECT to_jsonb(p) - 'prosrc' FROM pg_proc p WHERE p.oid = v_fn)::text, true);
END $preflight_rollback_20261645000000$;

-- O corpo da 20261241000000, byte a byte.
CREATE OR REPLACE FUNCTION public.devolucao_avisa_o_cliente()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $avisa_o_cliente$
DECLARE
  v_titulo text;
  v_msg text;
  v_tipo text := 'info';
  v_evento text;
  v_estado text;
BEGIN
  IF OLD.status IS NOT DISTINCT FROM NEW.status THEN
    RETURN NEW;
  END IF;
  CASE NEW.status
    WHEN 'aprovada' THEN
      v_titulo := 'Devolução aprovada';
      v_msg := 'A loja aprovou a devolução ' || NEW.protocolo || '. Veja as instruções no pedido.';
    WHEN 'recusada' THEN
      v_tipo := 'warning';
      v_titulo := 'Devolução não aprovada';
      v_msg := 'A loja respondeu a devolução ' || NEW.protocolo || '. Veja o motivo no pedido.';
    WHEN 'recebida' THEN
      v_titulo := 'Produto recebido pela loja';
      v_msg := 'A loja recebeu o produto da devolução ' || NEW.protocolo || '.';
    WHEN 'concluida' THEN
      v_tipo := 'success';
      v_titulo := 'Devolução concluída';
      IF NEW.resolucao_final = 'reembolso' THEN
        -- O estado REAL do dinheiro, lido AGORA: nunca "liberado" por antecipação. O
        -- "liberado" de verdade nasce no gatilho de order_refunds, quando o MP confirma.
        IF NEW.reembolso_manual THEN
          v_estado := 'manual';
        ELSE
          SELECT r.status INTO v_estado FROM public.order_refunds r WHERE r.id = NEW.refund_id;
        END IF;
        CASE COALESCE(v_estado, 'sem_linha')
          WHEN 'manual' THEN
            v_evento := 'reembolso_combinado';
            v_msg := 'O reembolso da devolução ' || NEW.protocolo || ' foi combinado com a loja (em mãos ou por PIX). Se tiver dúvida, fale com a loja.';
          WHEN 'concluido' THEN
            v_evento := 'reembolso_liberado';
            v_msg := 'O reembolso da devolução ' || NEW.protocolo || ' foi liberado pelo Mercado Pago.';
          WHEN 'solicitado', 'em_processamento' THEN
            v_evento := 'reembolso_em_processamento';
            v_tipo := 'info';
            v_msg := 'Devolução ' || NEW.protocolo || ' concluída. A loja está confirmando sua devolução com o Mercado Pago.';
          ELSE
            v_evento := 'reembolso_nao_liberado';
            v_tipo := 'warning';
            v_msg := 'A loja concluiu a devolução ' || NEW.protocolo || ', mas o reembolso ainda não foi liberado. A loja está resolvendo e vai falar com você.';
        END CASE;
      ELSE
        v_msg := CASE NEW.resolucao_final
          WHEN 'troca' THEN 'A troca da devolução ' || NEW.protocolo || ' foi confirmada.'
          ELSE 'O vale-troca da devolução ' || NEW.protocolo || ' foi emitido.'
        END;
      END IF;
    WHEN 'reprovada' THEN
      v_tipo := 'warning';
      v_titulo := 'Produto não aceito na inspeção';
      v_msg := 'Veja no pedido o retorno da loja sobre a devolução ' || NEW.protocolo || '.';
    ELSE
      RETURN NEW;
  END CASE;

  IF v_evento IS NOT NULL THEN
    PERFORM public.devolucao__avisar_reembolso(NEW.id, v_evento, v_tipo, v_titulo, v_msg);
    RETURN NEW;
  END IF;

  BEGIN
    INSERT INTO public.notificacoes (usuario_id, tipo, titulo, mensagem, dados)
    VALUES (NEW.user_id, v_tipo, v_titulo, v_msg,
            jsonb_build_object('order_id', NEW.order_id, 'devolucao_id', NEW.id));
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'devolucao_avisa_o_cliente: aviso da devolução % não nasceu (%).', NEW.id, SQLERRM;
  END;
  RETURN NEW;
END;
$avisa_o_cliente$;

DO $conferencia_rollback_20261645000000$
DECLARE
  v_fn oid := to_regprocedure('public.devolucao_avisa_o_cliente()');
BEGIN
  IF v_fn IS NULL
     OR (SELECT md5(replace(prosrc, E'\r', '')) FROM pg_proc WHERE oid = v_fn) IS DISTINCT FROM '56502b960dcf3e136c1d0d5c41091c20' THEN
    RAISE EXCEPTION 'conferencia rollback 20261645000000: o corpo de devolucao_avisa_o_cliente não voltou ao da 20261241000000';
  END IF;
  IF (SELECT to_jsonb(p) - 'prosrc' FROM pg_proc p WHERE p.oid = v_fn)
       IS DISTINCT FROM current_setting('ikcous.vale_troca_1645_rb')::jsonb THEN
    RAISE EXCEPTION 'conferencia rollback 20261645000000: OID, dono, ACL ou atributo de devolucao_avisa_o_cliente mudou';
  END IF;
END $conferencia_rollback_20261645000000$;
