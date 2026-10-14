-- ============================================================================
-- Migration 20261225000000 — o reembolso da devolução só é "liberado" quando o dinheiro sai
-- (dinheiro; decisão do dono, Gabriel, 14/10/2026: "aprovo, pode consertar o reembolso")
-- ============================================================================
--
-- 1. O QUE ESTA MIGRATION CORRIGE
--
-- Quando o lojista conclui uma devolução com reembolso pelo Mercado Pago, o banco abre uma
-- linha em `order_refunds` ('solicitado') e, NA MESMA hora, avisa a cliente:
-- "O reembolso da devolução X foi liberado." (gatilho `tr_devolucao_avisa_o_cliente`,
-- 20261175000000). O dinheiro ainda NÃO saiu: quem o move é a edge `estornar-pagamento` ou
-- o cron `reconciliar-pagamentos`, depois. Se o Mercado Pago recusa de vez (a linha vira
-- `falhou`), a cliente continuava lendo "liberado" e o dinheiro nunca chegava; o lojista não
-- via nada (devolução concluída não tem ação no painel) e o "Tentar de novo" do pedido
-- recusava com "Cancele o pedido antes de devolver o dinheiro" (`solicitar_estorno`).
--
-- 2. O QUE MUDA (duas coisas, todas ADITIVAS: nenhuma tabela, coluna, linha ou aviso existente
--    é tocado, apagado ou reescrito)
--
-- (a) O aviso da conclusão passa a dizer o estado REAL do reembolso
--     (`devolucao_avisa_o_cliente`, CREATE OR REPLACE do mesmo gatilho, mesma ACL):
--       reembolso 'concluido'                    -> "foi liberado pelo Mercado Pago"
--       'solicitado' / 'em_processamento'        -> "está em processamento ... você recebe um
--                                                    novo aviso quando for liberado"
--       'falhou' / 'recusado' / sem linha        -> "ainda não foi liberado; a loja está
--                                                    resolvendo" (nenhuma promessa)
--       reembolso manual ("combinado com a loja")-> "foi combinado com a loja"
--     Os demais status (aprovada, recusada, recebida, reprovada) e as resoluções troca/vale
--     seguem com o texto de sempre.
-- (b) O aviso "liberado" nasce quando o dinheiro SAI: um gatilho novo em `order_refunds`
--     (`tr_order_refunds_avisa_reembolso_liberado`, AFTER UPDATE OF status, só na virada para
--     'concluido') avisa a cliente da devolução que aponta para a linha. É o ÚNICO ponto por
--     onde passam os caminhos que concluem (edge do clique, cron, webhook): todos chamam
--     `concluir_estorno`. UMA vez por devolução e por tipo de aviso:
--     `devolucao__avisar_reembolso` (auxiliar interna) trava com advisory lock e confere
--     `notificacoes` antes de inserir. Best-effort (EXCEPTION WHEN OTHERS -> WARNING): um
--     aviso que falha NUNCA desfaz a conclusão do dinheiro (o gatilho roda DENTRO de
--     concluir_estorno).
-- (c) FORA desta migration, de propósito: a reemissão segura ("Tentar de novo" sobre reembolso
--     'falhou'). Ela exige colunas de diagnóstico e uma consulta ao Mercado Pago antes de cada
--     chave nova (senão a cliente pode receber duas vezes) e vem em migration e PR próprios.
--
-- 3. DADOS EXISTENTES
--
-- Nada é lido-e-reescrito. Avisos "liberado" que já foram enviados para devoluções cujo
-- reembolso 'falhou' ficam como estão (a cliente já leu); quando o dinheiro de fato sair,
-- ela recebe o aviso verdadeiro (o tipo de aviso novo é outro:
-- `dados->>'evento' = 'reembolso_liberado'`; os antigos não têm `evento`). Lista das
-- devoluções afetadas (somente leitura, para o lojista agir):
--     SELECT d.protocolo, d.valor_reembolso, r.status, r.ultimo_erro
--       FROM devolucoes d JOIN order_refunds r ON r.id = d.refund_id
--      WHERE d.status = 'concluida' AND d.resolucao_final = 'reembolso'
--        AND NOT d.reembolso_manual AND r.status IN ('falhou', 'recusado');
-- Nenhuma linha de devolucoes, order_refunds ou marketplace_orders muda no apply.
--
-- 4. QUEM QUEBRA
--
-- Ninguém: nenhuma assinatura existente muda e nenhum chamador existente é afetado.
-- `devolucao_avisa_o_cliente` é função de gatilho (ninguém a chama) e as duas funções novas
-- só são chamadas por gatilho. Nenhum código de aplicação muda neste lote.
--
-- 5. PRÉ-VOO (B1_BASELINE_DIVERGENT, ANTES de qualquer escrita)
--
-- Recusa se: faltar tabela ou coluna que as funções leem (devolucoes, order_refunds,
-- notificacoes); o corpo vivo
-- de `devolucao_avisa_o_cliente` (md5 de replace(prosrc, E'\r', '')) não for UM dos dois
-- conhecidos — o da 20261175000000 ou o desta migration — ou os atributos não forem os de
-- sempre; o gatilho `tr_devolucao_avisa_o_cliente` não existir ou estiver desligado; uma das
-- funções novas já existir com corpo diferente do desta migration, ou com sobrecarga.
--
-- 6. IDEMPOTÊNCIA E TRANSAÇÃO
--
-- Dois estados de entrada por função (corpo conhecido de antes, ou corpo desta migration):
-- reaplicar reescreve o MESMO texto. Qualquer outro estado ABORTA. O gatilho novo é apagado
-- e recriado (DROP TRIGGER IF EXISTS só do PRÓPRIO, nascido aqui). Sem BEGIN/COMMIT de nível
-- superior (regra da casa; quem abre a transação é o aplicador): pré-voo, criações e
-- conferência final caem juntos ou não caem.
--
-- 7. ROLLBACK MANUAL
--
-- rollback-manual-20261225000000_o_reembolso_da_devolucao_so_e_liberado_quando_o_dinheiro_sai.sql
-- recria `devolucao_avisa_o_cliente` com o corpo ANTIGO (byte a byte, mesmo md5) e apaga o
-- gatilho e as duas funções novas. Depois dele a cliente volta a ler "liberado" na
-- conclusão.
--
-- PROVA VIVA: tests/banco/reembolso-da-devolucao-viva.cjs (comportamento por papel e por
-- estado do reembolso, corrida de duas conexões, idempotência, rollback, pré-voo, conferência) e
-- tests/banco/reembolso-da-devolucao-portao-viva.cjs (consultas 28a e 28b).
-- ============================================================================

DO $preflight_20261225$
DECLARE
  v_hash text;
  v_oid oid;
  v_fn text;
BEGIN
  -- Tabelas e colunas que as funções leem ou gravam: sem elas a falha viria só na hora de EXECUTAR.
  IF to_regclass('public.devolucoes') IS NULL
     OR to_regclass('public.order_refunds') IS NULL
     OR to_regclass('public.notificacoes') IS NULL THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: falta devolucoes/order_refunds/notificacoes — aplique a 20261175000000 (e as anteriores) antes da 20261225000000.';
  END IF;
  IF (SELECT count(*) FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'devolucoes'
         AND column_name IN ('id', 'protocolo', 'order_id', 'user_id', 'status', 'resolucao_final',
                             'refund_id', 'reembolso_manual', 'created_at')) <> 9
     OR (SELECT count(*) FROM information_schema.columns
          WHERE table_schema = 'public' AND table_name = 'order_refunds'
            AND column_name IN ('id', 'status')) <> 2
     OR (SELECT count(*) FROM information_schema.columns
          WHERE table_schema = 'public' AND table_name = 'notificacoes'
            AND column_name IN ('usuario_id', 'tipo', 'titulo', 'mensagem', 'dados')) <> 5 THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: falta alguma coluna que as funções desta migration leem — meça a loja e revise antes de aplicar.';
  END IF;

  -- O gatilho de aviso da devolução: existe, ligado, e o corpo é um dos dois conhecidos.
  v_oid := to_regprocedure('public.devolucao_avisa_o_cliente()');
  IF v_oid IS NULL THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: public.devolucao_avisa_o_cliente() não existe — aplique a 20261175000000 antes.';
  END IF;
  IF (SELECT count(*) FROM pg_proc p
       WHERE p.pronamespace = 'public'::regnamespace AND p.proname = 'devolucao_avisa_o_cliente') <> 1 THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: devolucao_avisa_o_cliente tem sobrecarga em public.';
  END IF;
  SELECT md5(replace(prosrc, E'\r', '')) INTO v_hash FROM pg_proc WHERE oid = v_oid;
  IF v_hash IS DISTINCT FROM '0bf0bf168c1c0db817220329c47b64ef' AND v_hash IS DISTINCT FROM '2cd21f47021cafc15cae4ccd0c8c67e5' THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: corpo vivo de devolucao_avisa_o_cliente (hash %) não é nem o da 20261175000000 nem o desta migration — capture o corpo vivo e revise antes de aplicar.', COALESCE(v_hash, 'ausente');
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
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: atributos de devolucao_avisa_o_cliente (linguagem, SECURITY DEFINER, volatilidade, search_path ou retorno) não são os conhecidos.';
  END IF;
  IF NOT EXISTS (
       SELECT 1 FROM pg_trigger t
        WHERE t.tgrelid = 'public.devolucoes'::regclass
          AND t.tgname = 'tr_devolucao_avisa_o_cliente'
          AND NOT t.tgisinternal
          AND t.tgenabled = 'O'
          AND t.tgfoid = v_oid
     ) THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: o gatilho tr_devolucao_avisa_o_cliente não existe, está desligado ou aponta para outra função.';
  END IF;

  -- As duas funções novas: ausentes, ou já com o corpo desta migration (reaplicação). Sem sobrecarga.
  FOR v_fn, v_hash IN
    VALUES ('devolucao__avisar_reembolso', '769267b826e4629b91da056c28b393da'),
           ('devolucao_avisa_reembolso_liberado', '7cf7ae165c229b9bc2b402fd09d7ac3f')
  LOOP
    IF (SELECT count(*) FROM pg_proc p
         WHERE p.pronamespace = 'public'::regnamespace AND p.proname = v_fn) > 1 THEN
      RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: % tem sobrecarga em public — meça a loja e revise antes de aplicar.', v_fn;
    END IF;
    IF EXISTS (SELECT 1 FROM pg_proc p
                WHERE p.pronamespace = 'public'::regnamespace AND p.proname = v_fn
                  AND md5(replace(p.prosrc, E'\r', '')) <> v_hash) THEN
      RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: public.% já existe com um corpo que não é o desta migration — revise antes de aplicar.', v_fn;
    END IF;
  END LOOP;
END $preflight_20261225$;

-- ---------------------------------------------------------------------------
-- 1. Auxiliar INTERNA: um aviso de reembolso por devolução e por tipo, best-effort.
-- ---------------------------------------------------------------------------
-- Dedup: advisory lock por (devolução, evento) + conferência em `notificacoes`
-- (`dados->>'devolucao_id'` e `dados->>'evento'`). Devolve true só quando inseriu.
-- Nenhuma exceção sobe: um aviso que falha não pode desfazer a conclusão do dinheiro nem a
-- decisão do lojista (quem chama é gatilho ou função de dinheiro).
CREATE OR REPLACE FUNCTION public.devolucao__avisar_reembolso(
  p_devolucao_id uuid,
  p_evento text,
  p_tipo text,
  p_titulo text,
  p_mensagem text
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $avisar_reembolso$
DECLARE
  v_d public.devolucoes%ROWTYPE;
BEGIN
  BEGIN
    SELECT * INTO v_d FROM public.devolucoes WHERE id = p_devolucao_id;
    IF NOT FOUND THEN
      RETURN false;
    END IF;
    PERFORM pg_advisory_xact_lock(
      hashtextextended('devolucao_aviso:' || p_devolucao_id::text || ':' || p_evento, 0));
    IF EXISTS (
      SELECT 1 FROM public.notificacoes n
       WHERE n.usuario_id = v_d.user_id
         AND n.dados ->> 'devolucao_id' = p_devolucao_id::text
         AND n.dados ->> 'evento' = p_evento
    ) THEN
      RETURN false;
    END IF;
    INSERT INTO public.notificacoes (usuario_id, tipo, titulo, mensagem, dados)
    VALUES (v_d.user_id, p_tipo, p_titulo, p_mensagem,
            jsonb_build_object('order_id', v_d.order_id, 'devolucao_id', v_d.id, 'evento', p_evento));
    RETURN true;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'devolucao__avisar_reembolso: aviso % da devolução % não nasceu (%).', p_evento, p_devolucao_id, SQLERRM;
    RETURN false;
  END;
END;
$avisar_reembolso$;

REVOKE ALL ON FUNCTION public.devolucao__avisar_reembolso(uuid, text, text, text, text) FROM PUBLIC, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 2. O aviso da conclusão diz o estado REAL do reembolso (CREATE OR REPLACE do gatilho existente)
-- ---------------------------------------------------------------------------
-- Idêntico ao da 20261175000000 em tudo, menos o ramo 'concluida' + 'reembolso'. ACL herdada
-- (CREATE OR REPLACE): nenhum GRANT/REVOKE aqui.
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
            v_msg := 'A loja concluiu a devolução ' || NEW.protocolo || '. O reembolso está em processamento no Mercado Pago; você recebe um novo aviso quando ele for liberado.';
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

-- ---------------------------------------------------------------------------
-- 3. O aviso "liberado" nasce quando o dinheiro SAI (gatilho em order_refunds)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.devolucao_avisa_reembolso_liberado()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $avisa_liberado$
DECLARE
  v_d public.devolucoes%ROWTYPE;
BEGIN
  IF NEW.status IS DISTINCT FROM 'concluido' OR OLD.status IS NOT DISTINCT FROM NEW.status THEN
    RETURN NEW;
  END IF;
  -- Roda DENTRO de concluir_estorno (a linha e o pedido já estão travados por ela): leitura
  -- sem trava em `devolucoes` e best-effort — o que falhar aqui nunca desfaz o dinheiro.
  BEGIN
    SELECT * INTO v_d
      FROM public.devolucoes d
     WHERE d.refund_id = NEW.id
       AND d.status = 'concluida'
       AND d.resolucao_final = 'reembolso'
       AND NOT d.reembolso_manual
     ORDER BY d.created_at DESC
     LIMIT 1;
    IF FOUND THEN
      PERFORM public.devolucao__avisar_reembolso(
        v_d.id, 'reembolso_liberado', 'success', 'Reembolso liberado',
        'O reembolso da devolução ' || v_d.protocolo || ' foi liberado pelo Mercado Pago.');
    END IF;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'devolucao_avisa_reembolso_liberado: aviso da linha % não nasceu (%).', NEW.id, SQLERRM;
  END;
  RETURN NEW;
END;
$avisa_liberado$;

REVOKE ALL ON FUNCTION public.devolucao_avisa_reembolso_liberado() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS tr_order_refunds_avisa_reembolso_liberado ON public.order_refunds;
CREATE TRIGGER tr_order_refunds_avisa_reembolso_liberado
AFTER UPDATE OF status ON public.order_refunds
FOR EACH ROW
WHEN (OLD.status IS DISTINCT FROM NEW.status AND NEW.status = 'concluido')
EXECUTE FUNCTION public.devolucao_avisa_reembolso_liberado();

-- CONFERÊNCIA no instante do apply: aborta se algum corpo vivo não é o desta migration, se os
-- atributos mudaram, se a ACL não ficou como deve ou se o gatilho novo não está ligado.
DO $conferencia_20261225$
DECLARE
  v_fn text;
  v_hash_esperado text;
  v_oid oid;
BEGIN
  FOR v_fn, v_hash_esperado IN
    VALUES ('public.devolucao_avisa_o_cliente()', '2cd21f47021cafc15cae4ccd0c8c67e5'),
           ('public.devolucao__avisar_reembolso(uuid,text,text,text,text)', '769267b826e4629b91da056c28b393da'),
           ('public.devolucao_avisa_reembolso_liberado()', '7cf7ae165c229b9bc2b402fd09d7ac3f')
  LOOP
    v_oid := to_regprocedure(v_fn);
    IF v_oid IS NULL THEN
      RAISE EXCEPTION 'conferencia 20261225: % sumiu', v_fn;
    END IF;
    IF (SELECT md5(replace(prosrc, E'\r', '')) FROM pg_proc WHERE oid = v_oid) IS DISTINCT FROM v_hash_esperado THEN
      RAISE EXCEPTION 'conferencia 20261225: o corpo vivo de % não é o desta migration', v_fn;
    END IF;
    IF NOT EXISTS (
         SELECT 1 FROM pg_proc p JOIN pg_language l ON l.oid = p.prolang
          WHERE p.oid = v_oid AND l.lanname = 'plpgsql' AND p.prosecdef
            AND p.proconfig = ARRAY['search_path=public']::text[]
       ) THEN
      RAISE EXCEPTION 'conferencia 20261225: atributos de % mudaram (plpgsql, SECURITY DEFINER, search_path=public)', v_fn;
    END IF;
    IF EXISTS (SELECT 1 FROM pg_proc p
                 CROSS JOIN LATERAL aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) g
                WHERE p.oid = v_oid AND g.privilege_type = 'EXECUTE' AND g.grantee = 0) THEN
      RAISE EXCEPTION 'conferencia 20261225: % alcançável por PUBLIC', v_fn;
    END IF;
    IF has_function_privilege('anon', v_oid, 'EXECUTE') OR has_function_privilege('authenticated', v_oid, 'EXECUTE') THEN
      RAISE EXCEPTION 'conferencia 20261225: anon ou authenticated executa %', v_fn;
    END IF;
  END LOOP;

  -- A auxiliar é interna: nem service_role a executa.
  IF has_function_privilege('service_role', to_regprocedure('public.devolucao__avisar_reembolso(uuid,text,text,text,text)'), 'EXECUTE') THEN
    RAISE EXCEPTION 'conferencia 20261225: service_role executa a auxiliar interna devolucao__avisar_reembolso';
  END IF;

  IF NOT EXISTS (
       SELECT 1 FROM pg_trigger t
        WHERE t.tgrelid = 'public.order_refunds'::regclass
          AND t.tgname = 'tr_order_refunds_avisa_reembolso_liberado'
          AND NOT t.tgisinternal
          AND t.tgenabled = 'O'
          AND t.tgfoid = to_regprocedure('public.devolucao_avisa_reembolso_liberado()')
          AND pg_get_triggerdef(t.oid) LIKE '%AFTER UPDATE OF status%'
          AND pg_get_triggerdef(t.oid) LIKE '%WHEN%'
     ) THEN
    RAISE EXCEPTION 'conferencia 20261225: o gatilho tr_order_refunds_avisa_reembolso_liberado não está ligado como esperado';
  END IF;
  IF NOT EXISTS (
       SELECT 1 FROM pg_trigger t
        WHERE t.tgrelid = 'public.devolucoes'::regclass
          AND t.tgname = 'tr_devolucao_avisa_o_cliente'
          AND NOT t.tgisinternal
          AND t.tgenabled = 'O'
          AND t.tgfoid = to_regprocedure('public.devolucao_avisa_o_cliente()')
     ) THEN
    RAISE EXCEPTION 'conferencia 20261225: o gatilho tr_devolucao_avisa_o_cliente não está ligado';
  END IF;
END $conferencia_20261225$;
