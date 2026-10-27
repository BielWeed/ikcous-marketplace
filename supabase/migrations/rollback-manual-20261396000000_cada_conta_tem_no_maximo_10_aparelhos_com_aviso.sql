-- ============================================================================
-- Rollback manual — cada conta tem no máximo 10 aparelhos com aviso ligado (20261396000000)
-- ============================================================================
-- Remove o gatilho `tr_push_inscricoes_limite_por_conta` (em public.push_subscriptions) e a função
-- `public.push_inscricoes_limite_por_conta()`: os DOIS objetos eram NOVOS na migration, então desfazer é
-- apagá-los; não há corpo anterior a restaurar. Nenhum outro objeto é tocado (a política
-- `push_subscriptions_all_policy`, o UNIQUE de endpoint e a `rls_admin_atual` ficam como estão).
--
-- COM ELE VOLTA O DEFEITO: uma conta logada volta a cadastrar quantos "aparelhos" quiser, e endereços mudos
-- voltam a gastar o orçamento de 50 s da campanha de avisos.
--
-- DADOS: nenhuma linha de `push_subscriptions` é lida ou reescrita. As inscrições gravadas enquanto o gatilho
-- existiu ficam como foram gravadas.
--
-- PRÉ-VOO: recusa (`B1_BASELINE_DIVERGENT`) antes de apagar qualquer coisa se: o gatilho existir mas NÃO for o
-- desenhado (outra tabela, outra função, outro momento/evento, WHEN, UPDATE OF, argumentos); a função existir com
-- corpo diferente do da migration (alguém a redefiniu: apagar levaria junto uma redefinição que ninguém revisou)
-- ou com sobrecarga; ou outro gatilho passar a usá-la. Estados aceitos: os dois objetos como desenhados, só a
-- função (o gatilho já foi tirado), ou nenhum (rodar de novo é no-op). Conferência final: nenhum dos dois existe.
--
-- Executar pelo aplicar-migrations.yml (apaga o registro do ledger na mesma transação). Sem BEGIN/COMMIT de nível
-- superior neste arquivo — regra da casa. Rodar duas vezes deixa o mesmo estado.
-- ============================================================================

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

DO $preflight_rollback_20261396000000$
DECLARE
  v_oid oid := to_regprocedure('public.push_inscricoes_limite_por_conta()');
  v_hash text;
  v_gat record;
BEGIN
  IF (SELECT count(*) FROM pg_proc p
       WHERE p.pronamespace = 'public'::regnamespace AND p.proname = 'push_inscricoes_limite_por_conta') > 1 THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: push_inscricoes_limite_por_conta tem sobrecarga em public — revise antes de apagar.';
  END IF;
  IF v_oid IS NOT NULL THEN
    SELECT md5(replace(prosrc, E'\r', '')) INTO v_hash FROM pg_proc WHERE oid = v_oid;
    IF v_hash IS DISTINCT FROM '4c716de5f5ccb38f93db187dcf64bf00' THEN
      RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: corpo vivo de public.push_inscricoes_limite_por_conta() (hash %) não é o da 20261396000000 — uma redefinição posterior está no ar; revise antes de apagar.', COALESCE(v_hash, 'ausente');
    END IF;
  ELSIF EXISTS (SELECT 1 FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname = 'push_inscricoes_limite_por_conta') THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: push_inscricoes_limite_por_conta existe em public com outra assinatura — revise antes de apagar.';
  END IF;

  FOR v_gat IN
    SELECT t.tgrelid, t.tgfoid, t.tgtype, t.tgqual IS NOT NULL AS tem_when, t.tgnargs, t.tgattr::text AS attr, t.tgisinternal
      FROM pg_trigger t
     WHERE t.tgname = 'tr_push_inscricoes_limite_por_conta'
  LOOP
    IF v_gat.tgrelid IS DISTINCT FROM to_regclass('public.push_subscriptions')
       OR v_gat.tgfoid IS DISTINCT FROM v_oid
       OR v_gat.tgtype <> 7
       OR v_gat.tem_when OR v_gat.tgnargs <> 0 OR v_gat.attr <> '' OR v_gat.tgisinternal THEN
      RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: já existe um gatilho chamado tr_push_inscricoes_limite_por_conta que NÃO é o desenhado pela 20261396000000 — revise antes de apagar.';
    END IF;
  END LOOP;

  -- Ninguém mais pode depender da função (apagá-la quebraria o outro gatilho).
  IF v_oid IS NOT NULL AND EXISTS (
       SELECT 1 FROM pg_trigger t
        WHERE t.tgfoid = v_oid AND t.tgname <> 'tr_push_inscricoes_limite_por_conta' AND NOT t.tgisinternal
     ) THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: outro gatilho passou a usar push_inscricoes_limite_por_conta — revise antes de apagar.';
  END IF;
END $preflight_rollback_20261396000000$;

DROP TRIGGER IF EXISTS tr_push_inscricoes_limite_por_conta ON public.push_subscriptions;

DROP FUNCTION IF EXISTS public.push_inscricoes_limite_por_conta();

DO $conferencia_rollback_20261396000000$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_trigger t WHERE t.tgname = 'tr_push_inscricoes_limite_por_conta') THEN
    RAISE EXCEPTION 'conferencia rollback 20261396000000: o gatilho ainda existe';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname = 'push_inscricoes_limite_por_conta') THEN
    RAISE EXCEPTION 'conferencia rollback 20261396000000: a função ainda existe';
  END IF;
END $conferencia_rollback_20261396000000$;
