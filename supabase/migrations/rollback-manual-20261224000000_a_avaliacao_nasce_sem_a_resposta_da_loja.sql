-- ============================================================================
-- Rollback manual — a avaliação nasce sem a resposta da loja (20261224000000)
-- ============================================================================
-- Remove o gatilho `tr_avaliacao_nasce_sem_a_resposta_da_loja` (em public.reviews) e a função
-- `public.avaliacao_nasce_sem_a_resposta_da_loja()`: os DOIS objetos eram NOVOS na migration, então desfazer
-- é apagá-los; não há corpo antigo a restaurar. Nenhum outro objeto é tocado (o gatilho irmão
-- `tr_avaliacao_nasce_verificada`, as policies de `reviews` e `reply_review_atomic` ficam como estão).
--
-- COM ELE VOLTA O DEFEITO: uma cliente logada volta a criar a própria avaliação já com `merchant_reply`,
-- `merchant_reply_at`, `helpful` e `created_at` forjados, por chamada direta à API.
--
-- DADOS: nenhuma linha de `reviews` é lida ou reescrita. As avaliações criadas enquanto o gatilho existiu
-- ficam como foram gravadas (já limpas); as forjadas antes da migration continuam como estavam.
--
-- PRÉ-VOO: recusa (`B1_BASELINE_DIVERGENT`) antes de apagar qualquer coisa se: o gatilho existir mas NÃO for o
-- desenhado (outra tabela, outra função, outro momento/evento, WHEN, UPDATE OF, argumentos); a função existir
-- com corpo diferente do da migration (alguém a redefiniu: apagar levaria junto uma redefinição que ninguém
-- revisou) ou com sobrecarga. Estados aceitos: os dois objetos como desenhados, só a função (o gatilho já foi
-- tirado), ou nenhum (rodar de novo é no-op). Conferência final: nenhum dos dois existe.
--
-- Executar pelo aplicar-migrations.yml (apaga o registro do ledger na mesma transação). Sem BEGIN/COMMIT de
-- nível superior neste arquivo — regra da casa. Rodar duas vezes deixa o mesmo estado.
-- ============================================================================

DO $preflight_rollback_20261224$
DECLARE
  v_oid oid := to_regprocedure('public.avaliacao_nasce_sem_a_resposta_da_loja()');
  v_hash text;
  v_gat record;
BEGIN
  IF (SELECT count(*) FROM pg_proc p
       WHERE p.pronamespace = 'public'::regnamespace AND p.proname = 'avaliacao_nasce_sem_a_resposta_da_loja') > 1 THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: avaliacao_nasce_sem_a_resposta_da_loja tem sobrecarga em public — revise antes de apagar.';
  END IF;
  IF v_oid IS NOT NULL THEN
    SELECT md5(replace(prosrc, E'\r', '')) INTO v_hash FROM pg_proc WHERE oid = v_oid;
    IF v_hash IS DISTINCT FROM '2c2d607c4009de72d10d1a7d154a642f' THEN
      RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: corpo vivo de public.avaliacao_nasce_sem_a_resposta_da_loja() (hash %) não é o da 20261224000000 — uma redefinição posterior está no ar; revise antes de apagar.', COALESCE(v_hash, 'ausente');
    END IF;
  ELSIF EXISTS (SELECT 1 FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname = 'avaliacao_nasce_sem_a_resposta_da_loja') THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: avaliacao_nasce_sem_a_resposta_da_loja existe em public com outra assinatura — revise antes de apagar.';
  END IF;

  FOR v_gat IN
    SELECT t.tgrelid, t.tgfoid, t.tgtype, t.tgqual IS NOT NULL AS tem_when, t.tgnargs, t.tgattr::text AS attr, t.tgisinternal
      FROM pg_trigger t
     WHERE t.tgname = 'tr_avaliacao_nasce_sem_a_resposta_da_loja'
  LOOP
    IF v_gat.tgrelid IS DISTINCT FROM to_regclass('public.reviews')
       OR v_gat.tgfoid IS DISTINCT FROM v_oid
       OR v_gat.tgtype <> 7
       OR v_gat.tem_when OR v_gat.tgnargs <> 0 OR v_gat.attr <> '' OR v_gat.tgisinternal THEN
      RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: já existe um gatilho chamado tr_avaliacao_nasce_sem_a_resposta_da_loja que NÃO é o desenhado pela 20261224000000 — revise antes de apagar.';
    END IF;
  END LOOP;
END $preflight_rollback_20261224$;

DROP TRIGGER IF EXISTS tr_avaliacao_nasce_sem_a_resposta_da_loja ON public.reviews;

DROP FUNCTION IF EXISTS public.avaliacao_nasce_sem_a_resposta_da_loja();

DO $conferencia_rollback_20261224$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_trigger t WHERE t.tgname = 'tr_avaliacao_nasce_sem_a_resposta_da_loja') THEN
    RAISE EXCEPTION 'conferencia rollback 20261224: o gatilho ainda existe';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname = 'avaliacao_nasce_sem_a_resposta_da_loja') THEN
    RAISE EXCEPTION 'conferencia rollback 20261224: a função ainda existe';
  END IF;
  -- o gatilho irmão do selo segue de pé
  IF NOT EXISTS (
       SELECT 1 FROM pg_trigger t
        WHERE t.tgrelid = to_regclass('public.reviews') AND t.tgname = 'tr_avaliacao_nasce_verificada' AND NOT t.tgisinternal
     ) THEN
    RAISE EXCEPTION 'conferencia rollback 20261224: o gatilho tr_avaliacao_nasce_verificada sumiu';
  END IF;
END $conferencia_rollback_20261224$;
