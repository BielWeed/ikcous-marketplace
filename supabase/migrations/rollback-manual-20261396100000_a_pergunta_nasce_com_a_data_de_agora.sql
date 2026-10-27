-- ============================================================================
-- Rollback manual — a pergunta do produto nasce com a data de agora (20261396100000)
-- ============================================================================
-- Remove o gatilho `tr_pergunta_nasce_com_a_data_de_agora` (em public.questions) e a função
-- `public.pergunta_nasce_com_a_data_de_agora()`: os DOIS objetos eram NOVOS na migration, então desfazer é
-- apagá-los; não há corpo anterior a restaurar. Nenhum outro objeto é tocado (as políticas de `questions`, o CHECK
-- de 500 caracteres da 20261391000000 e a `rls_admin_atual` ficam como estão).
--
-- COM ELE VOLTA O DEFEITO: uma conta logada volta a gravar a própria pergunta com `created_at` no futuro e a
-- fixá-la no topo da página do produto, por chamada direta à API.
--
-- DADOS: nenhuma linha de `questions` é lida ou reescrita. As perguntas criadas enquanto o gatilho existiu ficam
-- como foram gravadas (com a data do servidor).
--
-- PRÉ-VOO: recusa (`B1_BASELINE_DIVERGENT`) antes de apagar qualquer coisa se: o gatilho existir mas NÃO for o
-- desenhado (outra tabela, outra função, outro momento/evento, WHEN, UPDATE OF, argumentos); a função existir com
-- corpo diferente do da migration (alguém a redefiniu: apagar levaria junto uma redefinição que ninguém revisou)
-- ou com sobrecarga; ou outra função/gatilho passar a usá-la. Estados aceitos: os dois objetos como desenhados,
-- só a função (o gatilho já foi tirado), ou nenhum (rodar de novo é no-op). Conferência final: nenhum dos dois existe.
--
-- Executar pelo aplicar-migrations.yml (apaga o registro do ledger na mesma transação). Sem BEGIN/COMMIT de nível
-- superior neste arquivo — regra da casa. Rodar duas vezes deixa o mesmo estado.
-- ============================================================================

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

DO $preflight_rollback_20261396100000$
DECLARE
  v_oid oid := to_regprocedure('public.pergunta_nasce_com_a_data_de_agora()');
  v_hash text;
  v_gat record;
BEGIN
  IF (SELECT count(*) FROM pg_proc p
       WHERE p.pronamespace = 'public'::regnamespace AND p.proname = 'pergunta_nasce_com_a_data_de_agora') > 1 THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: pergunta_nasce_com_a_data_de_agora tem sobrecarga em public — revise antes de apagar.';
  END IF;
  IF v_oid IS NOT NULL THEN
    SELECT md5(replace(prosrc, E'\r', '')) INTO v_hash FROM pg_proc WHERE oid = v_oid;
    IF v_hash IS DISTINCT FROM '1cbc49981db4f1d76e4cf1048914c088' THEN
      RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: corpo vivo de public.pergunta_nasce_com_a_data_de_agora() (hash %) não é o da 20261396100000 — uma redefinição posterior está no ar; revise antes de apagar.', COALESCE(v_hash, 'ausente');
    END IF;
  ELSIF EXISTS (SELECT 1 FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname = 'pergunta_nasce_com_a_data_de_agora') THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: pergunta_nasce_com_a_data_de_agora existe em public com outra assinatura — revise antes de apagar.';
  END IF;

  FOR v_gat IN
    SELECT t.tgrelid, t.tgfoid, t.tgtype, t.tgqual IS NOT NULL AS tem_when, t.tgnargs, t.tgattr::text AS attr, t.tgisinternal
      FROM pg_trigger t
     WHERE t.tgname = 'tr_pergunta_nasce_com_a_data_de_agora'
  LOOP
    IF v_gat.tgrelid IS DISTINCT FROM to_regclass('public.questions')
       OR v_gat.tgfoid IS DISTINCT FROM v_oid
       OR v_gat.tgtype <> 7
       OR v_gat.tem_when OR v_gat.tgnargs <> 0 OR v_gat.attr <> '' OR v_gat.tgisinternal THEN
      RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: já existe um gatilho chamado tr_pergunta_nasce_com_a_data_de_agora que NÃO é o desenhado pela 20261396100000 — revise antes de apagar.';
    END IF;
  END LOOP;

  -- Ninguém mais pode depender da função (apagá-la quebraria o outro gatilho).
  IF v_oid IS NOT NULL AND EXISTS (
       SELECT 1 FROM pg_trigger t
        WHERE t.tgfoid = v_oid AND t.tgname <> 'tr_pergunta_nasce_com_a_data_de_agora' AND NOT t.tgisinternal
     ) THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: outro gatilho passou a usar pergunta_nasce_com_a_data_de_agora — revise antes de apagar.';
  END IF;
END $preflight_rollback_20261396100000$;

DROP TRIGGER IF EXISTS tr_pergunta_nasce_com_a_data_de_agora ON public.questions;

DROP FUNCTION IF EXISTS public.pergunta_nasce_com_a_data_de_agora();

DO $conferencia_rollback_20261396100000$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_trigger t WHERE t.tgname = 'tr_pergunta_nasce_com_a_data_de_agora') THEN
    RAISE EXCEPTION 'conferencia rollback 20261396100000: o gatilho ainda existe';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname = 'pergunta_nasce_com_a_data_de_agora') THEN
    RAISE EXCEPTION 'conferencia rollback 20261396100000: a função ainda existe';
  END IF;
END $conferencia_rollback_20261396100000$;
