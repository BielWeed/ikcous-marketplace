-- ============================================================================
-- Rollback manual — o reembolso da devolução só é "liberado" quando o dinheiro sai
-- (20261225000000)
-- ============================================================================
-- Devolve `devolucao_avisa_o_cliente()` ao corpo ANTIGO (o da 20261175000000, byte a byte: o md5 de
-- `replace(prosrc, E'\r', '')` volta a ser `0bf0bf168c1c0db817220329c47b64ef`, e a prova viva confere) e APAGA
-- o que a migration criou: o gatilho `tr_order_refunds_avisa_reembolso_liberado` (em order_refunds) e as
-- duas funções novas (`devolucao_avisa_reembolso_liberado`,
-- `devolucao__avisar_reembolso`). Só objetos que ESTA migration criou são apagados; nenhuma tabela, coluna ou
-- linha é tocada.
--
-- COM ELE VOLTA O DEFEITO: a cliente lê "o reembolso foi liberado" no instante em que a devolução é
-- concluída, mesmo que o dinheiro nunca saia.
--
-- DADOS: o que a migration gravou FICA (os avisos de `notificacoes` com `dados->>'evento'`): são fatos,
-- não são desfeitos aqui.
--
-- ORDEM: o gatilho de order_refunds cai ANTES da função que ele chama, e a função de gatilho antiga volta
-- ANTES de a auxiliar cair (o corpo antigo não a chama).
--
-- PRÉ-VOO: recusa (`B1_BASELINE_DIVERGENT`) se `devolucao_avisa_o_cliente` não existir, tiver sobrecarga ou o
-- corpo vivo não for um dos dois conhecidos (o novo, ou o antigo — rodar de novo reescreve o mesmo texto);
-- ou se alguma função nova existir com um corpo que não é o da migration (uma redefinição posterior que
-- ninguém revisou não se apaga). A conferência final recusa se o corpo não voltou ao antigo, se algum
-- objeto novo ainda existe ou se o gatilho de devolucoes não está ligado.
--
-- Executar pelo aplicar-migrations.yml (apaga o registro do ledger na mesma transação). Sem BEGIN/COMMIT
-- de nível superior neste arquivo — regra da casa. Rodar duas vezes deixa o mesmo estado.
-- ============================================================================

DO $preflight_rollback_20261225$
DECLARE
  v_oid oid := to_regprocedure('public.devolucao_avisa_o_cliente()');
  v_hash text;
  v_fn text;
BEGIN
  IF v_oid IS NULL THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: public.devolucao_avisa_o_cliente() não existe — nada a devolver.';
  END IF;
  IF (SELECT count(*) FROM pg_proc p
       WHERE p.pronamespace = 'public'::regnamespace AND p.proname = 'devolucao_avisa_o_cliente') <> 1 THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: devolucao_avisa_o_cliente tem sobrecarga em public — revise antes de devolver o corpo antigo.';
  END IF;
  SELECT md5(replace(prosrc, E'\r', '')) INTO v_hash FROM pg_proc WHERE oid = v_oid;
  IF v_hash IS DISTINCT FROM '0bf0bf168c1c0db817220329c47b64ef' AND v_hash IS DISTINCT FROM '2cd21f47021cafc15cae4ccd0c8c67e5' THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: corpo vivo de devolucao_avisa_o_cliente (hash %) não é o novo nem o antigo — uma redefinição posterior está no ar; revise antes de sobrescrever.', COALESCE(v_hash, 'ausente');
  END IF;
  IF NOT EXISTS (
       SELECT 1 FROM pg_proc p JOIN pg_language l ON l.oid = p.prolang
        WHERE p.oid = v_oid
          AND l.lanname = 'plpgsql'
          AND p.prosecdef
          AND p.provolatile = 'v'
          AND p.proconfig = ARRAY['search_path=public']::text[]
          AND pg_get_function_result(p.oid) = 'trigger'
     ) THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: atributos de devolucao_avisa_o_cliente não são os conhecidos — revise antes de sobrescrever.';
  END IF;
  FOR v_fn, v_hash IN
    VALUES ('devolucao__avisar_reembolso', '769267b826e4629b91da056c28b393da'),
           ('devolucao_avisa_reembolso_liberado', '7cf7ae165c229b9bc2b402fd09d7ac3f')
  LOOP
    IF EXISTS (SELECT 1 FROM pg_proc p
                WHERE p.pronamespace = 'public'::regnamespace AND p.proname = v_fn
                  AND md5(replace(p.prosrc, E'\r', '')) <> v_hash) THEN
      RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: public.% existe com um corpo que não é o da 20261225000000 — uma redefinição posterior está no ar; revise antes de apagar.', v_fn;
    END IF;
  END LOOP;
END $preflight_rollback_20261225$;

-- 1. A função de gatilho de devolucoes volta ao corpo da 20261175000000 (ACL herdada; nenhum GRANT/REVOKE).
CREATE OR REPLACE FUNCTION public.devolucao_avisa_o_cliente()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $rollback_avisa$
DECLARE
  v_titulo text;
  v_msg text;
  v_tipo text := 'info';
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
      v_msg := CASE NEW.resolucao_final
        WHEN 'reembolso' THEN 'O reembolso da devolução ' || NEW.protocolo || ' foi liberado.'
        WHEN 'troca' THEN 'A troca da devolução ' || NEW.protocolo || ' foi confirmada.'
        ELSE 'O vale-troca da devolução ' || NEW.protocolo || ' foi emitido.'
      END;
    WHEN 'reprovada' THEN
      v_tipo := 'warning';
      v_titulo := 'Produto não aceito na inspeção';
      v_msg := 'Veja no pedido o retorno da loja sobre a devolução ' || NEW.protocolo || '.';
    ELSE
      RETURN NEW;
  END CASE;

  BEGIN
    INSERT INTO public.notificacoes (usuario_id, tipo, titulo, mensagem, dados)
    VALUES (NEW.user_id, v_tipo, v_titulo, v_msg,
            jsonb_build_object('order_id', NEW.order_id, 'devolucao_id', NEW.id));
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'devolucao_avisa_o_cliente: aviso da devolução % não nasceu (%).', NEW.id, SQLERRM;
  END;
  RETURN NEW;
END;
$rollback_avisa$;

-- 2. Cai o que a migration criou (gatilho primeiro, depois as funções).
DROP TRIGGER IF EXISTS tr_order_refunds_avisa_reembolso_liberado ON public.order_refunds;
DROP FUNCTION IF EXISTS public.devolucao_avisa_reembolso_liberado();
DROP FUNCTION IF EXISTS public.devolucao__avisar_reembolso(uuid, text, text, text, text);

DO $conferencia_rollback_20261225$
DECLARE
  v_oid oid := to_regprocedure('public.devolucao_avisa_o_cliente()');
  v_hash text;
BEGIN
  SELECT md5(replace(prosrc, E'\r', '')) INTO v_hash FROM pg_proc WHERE oid = v_oid;
  IF v_hash IS DISTINCT FROM '0bf0bf168c1c0db817220329c47b64ef' THEN
    RAISE EXCEPTION 'conferencia rollback 20261225: corpo vivo de devolucao_avisa_o_cliente (hash %) não voltou ao antigo', COALESCE(v_hash, 'ausente');
  END IF;
  IF EXISTS (SELECT 1 FROM pg_proc p
              WHERE p.pronamespace = 'public'::regnamespace
                AND p.proname IN ('devolucao_avisa_reembolso_liberado', 'devolucao__avisar_reembolso')) THEN
    RAISE EXCEPTION 'conferencia rollback 20261225: ainda existe alguma função criada pela migration';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_trigger t
              WHERE t.tgrelid = 'public.order_refunds'::regclass
                AND t.tgname = 'tr_order_refunds_avisa_reembolso_liberado') THEN
    RAISE EXCEPTION 'conferencia rollback 20261225: o gatilho de order_refunds ainda existe';
  END IF;
  IF NOT EXISTS (
       SELECT 1 FROM pg_trigger t
        WHERE t.tgrelid = 'public.devolucoes'::regclass
          AND t.tgname = 'tr_devolucao_avisa_o_cliente'
          AND NOT t.tgisinternal
          AND t.tgenabled = 'O'
          AND t.tgfoid = v_oid
     ) THEN
    RAISE EXCEPTION 'conferencia rollback 20261225: o gatilho tr_devolucao_avisa_o_cliente não está ligado';
  END IF;
  IF has_function_privilege('anon', v_oid, 'EXECUTE') OR has_function_privilege('authenticated', v_oid, 'EXECUTE') THEN
    RAISE EXCEPTION 'conferencia rollback 20261225: anon ou authenticated executa devolucao_avisa_o_cliente';
  END IF;
END $conferencia_rollback_20261225$;
