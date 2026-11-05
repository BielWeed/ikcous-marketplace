-- ============================================================================
-- Rollback manual — as estrelas do produto aparecem na vitrine (20261399500000)
-- ============================================================================
-- Remove o gatilho `tr_avaliacao_atualiza_a_nota_do_produto` (em public.reviews) e a função
-- `public.avaliacao_atualiza_a_nota_do_produto()`: os DOIS objetos eram NOVOS na migration, então desfazer é
-- apagá-los; não há corpo antigo a restaurar. Nenhum outro objeto é tocado (os gatilhos de `reviews`
-- `tr_avaliacao_nasce_verificada` e `tr_avaliacao_nasce_sem_a_resposta_da_loja`, as policies e as RPCs ficam como estão).
--
-- COM ELE VOLTA O DEFEITO: as colunas `produtos.rating` e `produtos.review_count` deixam de acompanhar as avaliações,
-- e o cartão de produto volta a não mostrar estrela alguma para produto que receber avaliação nova.
--
-- DADOS: nenhuma linha de `reviews` nem de `produtos` é lida ou reescrita. As notas que o gatilho já gravou em
-- `produtos.rating`/`review_count` FICAM como estão (são dado, e estavam certas no último evento); a partir daqui
-- elas só deixam de se mexer. Quem quiser zerar isso, decide por fora, com SQL próprio (não é desta reversão).
--
-- PRÉ-VOO: recusa (`B1_BASELINE_DIVERGENT`) antes de apagar qualquer coisa se: o gatilho existir mas NÃO for o
-- desenhado (outra tabela, outra função, outro momento/evento, outras colunas, WHEN, argumentos); a função existir
-- com corpo diferente do da migration (alguém a redefiniu: apagar levaria junto uma redefinição que ninguém
-- revisou) ou com sobrecarga. Estados aceitos: os dois objetos como desenhados, só a função (o gatilho já foi
-- tirado), ou nenhum (rodar de novo é no-op). Conferência final: nenhum dos dois existe.
--
-- Executar pelo aplicar-migrations.yml (apaga o registro do ledger na mesma transação). Sem BEGIN/COMMIT de
-- nível superior neste arquivo — regra da casa. Rodar duas vezes deixa o mesmo estado.
-- ============================================================================

SET LOCAL lock_timeout = '5s';

DO $preflight_rollback_20261399500000$
DECLARE
  v_oid oid := to_regprocedure('public.avaliacao_atualiza_a_nota_do_produto()');
  v_hash text;
  v_gat record;
BEGIN
  IF (SELECT count(*) FROM pg_proc p
       WHERE p.pronamespace = 'public'::regnamespace AND p.proname = 'avaliacao_atualiza_a_nota_do_produto') > 1 THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: avaliacao_atualiza_a_nota_do_produto tem sobrecarga em public — revise antes de apagar.';
  END IF;
  IF v_oid IS NOT NULL THEN
    SELECT md5(replace(prosrc, E'\r', '')) INTO v_hash FROM pg_proc WHERE oid = v_oid;
    IF v_hash IS DISTINCT FROM '469676dde2cf265cbf7b2af1df0df8ee' THEN
      RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: corpo vivo de public.avaliacao_atualiza_a_nota_do_produto() (hash %) não é o da 20261399500000 — uma redefinição posterior está no ar; revise antes de apagar.', COALESCE(v_hash, 'ausente');
    END IF;
  ELSIF EXISTS (SELECT 1 FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname = 'avaliacao_atualiza_a_nota_do_produto') THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: avaliacao_atualiza_a_nota_do_produto existe em public com outra assinatura — revise antes de apagar.';
  END IF;

  FOR v_gat IN
    SELECT t.tgrelid, t.tgfoid, t.tgtype, t.tgqual IS NOT NULL AS tem_when, t.tgnargs, t.tgisinternal,
           (SELECT array_agg(c ORDER BY c) FROM unnest(t.tgattr::int2[]) c) AS colunas,
           (SELECT array_agg(a.attnum ORDER BY a.attnum) FROM pg_attribute a
             WHERE a.attrelid = to_regclass('public.reviews') AND NOT a.attisdropped
               AND a.attname IN ('status', 'rating', 'product_id')) AS esperadas
      FROM pg_trigger t
     WHERE t.tgname = 'tr_avaliacao_atualiza_a_nota_do_produto'
  LOOP
    IF v_gat.tgrelid IS DISTINCT FROM to_regclass('public.reviews')
       OR v_gat.tgfoid IS DISTINCT FROM v_oid
       OR v_gat.tgtype <> 29
       OR v_gat.tem_when OR v_gat.tgnargs <> 0 OR v_gat.tgisinternal
       OR v_gat.colunas IS DISTINCT FROM v_gat.esperadas THEN
      RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: já existe um gatilho chamado tr_avaliacao_atualiza_a_nota_do_produto que NÃO é o desenhado pela 20261399500000 — revise antes de apagar.';
    END IF;
  END LOOP;
END $preflight_rollback_20261399500000$;

DROP TRIGGER IF EXISTS tr_avaliacao_atualiza_a_nota_do_produto ON public.reviews;

DROP FUNCTION IF EXISTS public.avaliacao_atualiza_a_nota_do_produto();

DO $conferencia_rollback_20261399500000$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_trigger t WHERE t.tgname = 'tr_avaliacao_atualiza_a_nota_do_produto') THEN
    RAISE EXCEPTION 'conferencia rollback 20261399500000: o gatilho ainda existe';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname = 'avaliacao_atualiza_a_nota_do_produto') THEN
    RAISE EXCEPTION 'conferencia rollback 20261399500000: a função ainda existe';
  END IF;
  -- os gatilhos irmãos de reviews seguem de pé
  IF NOT EXISTS (
       SELECT 1 FROM pg_trigger t
        WHERE t.tgrelid = to_regclass('public.reviews') AND t.tgname = 'tr_avaliacao_nasce_verificada' AND NOT t.tgisinternal
     ) THEN
    RAISE EXCEPTION 'conferencia rollback 20261399500000: o gatilho tr_avaliacao_nasce_verificada sumiu';
  END IF;
END $conferencia_rollback_20261399500000$;
