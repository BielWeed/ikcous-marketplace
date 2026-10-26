-- ============================================================================
-- Rollback manual — a foto da devolução e a pergunta do produto têm teto (20261391000000)
-- ============================================================================
-- A) Devolve a condição de `devolucoes_cliente_insert_policy` em storage.objects à da
--    20261175000000_a_devolucao_nasce_no_pedido.sql, byte a byte no catálogo:
--      bucket_id = 'devolucoes' AND split_part(name, '/', 1) = (SELECT auth.uid())::text
--    (ALTER POLICY: nome, comando, PERMISSIVE e papel ficam como estão) e tira a função
--    public.devolucao__fotos_soltas_da_conta(uuid, integer), que a 20261391000000 CRIOU (ninguém mais a usa:
--    o pré-voo confere que nenhuma outra política a cita).
-- B) Tira o CHECK `questions_question_ate_500_caracteres` de public.questions.
--
-- ⚠️ EFEITO: reabre os dois abusos da caçada de 26/10/2026 — qualquer conta logada volta a gravar
-- fotos sem limite no bucket `devolucoes` e pergunta de qualquer tamanho em `questions`. Só executar
-- se a migration estiver causando dano comprovado (ex.: cliente legítima barrada no envio de foto).
--
-- DADOS: nenhum. A migration não gravou, não apagou e não reescreveu linha nem objeto; este rollback
-- também não.
--
-- PRÉ-VOO: recusa com B1_BASELINE_DIVERGENT, ANTES de qualquer escrita, se a condição viva da política
-- não for EXATAMENTE a que a 20261391000000 deixou (segundo rollback ou sucessora desconhecida recusa),
-- se a função não for a desta migration ou outra política a citar, ou se o CHECK não for o desta.
--
-- Executar via psql -1 -f (nunca pelo db-apply, que registraria este rollback no ledger como migration
-- nova). Sem BEGIN/COMMIT de nível superior neste arquivo.
-- ============================================================================

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

DO $preflight_rollback_20261391000000$
DECLARE
  v_desta CONSTANT text := '((bucket_id=''devolucoes''::text)AND(split_part(name,''/''::text,1)=((SELECTauth.uid()ASuid))::text)AND((SELECTdevolucao__fotos_soltas_da_conta((SELECTauth.uid()ASuid),30)ASdevolucao__fotos_soltas_da_conta)<30))';
  v_fn oid := to_regprocedure('public.devolucao__fotos_soltas_da_conta(uuid, integer)');
BEGIN
  IF NOT EXISTS (
       SELECT 1 FROM pg_policy p
        WHERE p.polrelid = 'storage.objects'::regclass AND p.polname = 'devolucoes_cliente_insert_policy'
          AND p.polcmd = 'a' AND p.polpermissive AND p.polroles = ARRAY['authenticated'::regrole::oid]
          AND p.polqual IS NULL
          AND regexp_replace(replace(pg_get_expr(p.polwithcheck, p.polrelid), 'public.', ''), '[[:space:]]', '', 'g') = v_desta
     ) THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: devolucoes_cliente_insert_policy não está com a condição que a 20261391000000 deixou — nada a desfazer, ou uma redefinição posterior está no ar; revise antes de reverter.';
  END IF;
  IF v_fn IS NULL OR NOT EXISTS (
       SELECT 1 FROM pg_proc p WHERE p.oid = v_fn
          AND md5(replace(p.prosrc, E'\r', '')) = '0becd6ad09d4fad564a6622654cf0bc6') THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: devolucao__fotos_soltas_da_conta(uuid, integer) não é a que a 20261391000000 criou — revise antes de reverter.';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_policy p
              WHERE p.polname <> 'devolucoes_cliente_insert_policy'
                AND (position('devolucao__fotos_soltas_da_conta' IN COALESCE(pg_get_expr(p.polqual, p.polrelid), '')) > 0
                  OR position('devolucao__fotos_soltas_da_conta' IN COALESCE(pg_get_expr(p.polwithcheck, p.polrelid), '')) > 0))
     OR EXISTS (SELECT 1 FROM pg_proc p
                 WHERE p.oid <> v_fn AND position('devolucao__fotos_soltas_da_conta' IN p.prosrc) > 0) THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: outra política ou função passou a usar devolucao__fotos_soltas_da_conta — revise antes de reverter.';
  END IF;
  IF NOT EXISTS (
       SELECT 1 FROM pg_constraint c
        WHERE c.conrelid = 'public.questions'::regclass AND c.conname = 'questions_question_ate_500_caracteres'
          AND c.contype = 'c'
          AND pg_get_constraintdef(c.oid) IN ('CHECK ((char_length(question) <= 500)) NOT VALID',
                                              'CHECK ((char_length(question) <= 500))')
     ) THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: o CHECK questions_question_ate_500_caracteres não é o da 20261391000000 — revise antes de reverter.';
  END IF;
END $preflight_rollback_20261391000000$;

-- A) A condição da 20261175000000, como ela a escreveu; depois, a função que só esta política usava.
ALTER POLICY devolucoes_cliente_insert_policy ON storage.objects
  WITH CHECK (bucket_id = 'devolucoes' AND split_part(name, '/', 1) = (SELECT auth.uid())::text);

DROP FUNCTION public.devolucao__fotos_soltas_da_conta(uuid, integer);

-- B) Sem o teto de tamanho da pergunta.
ALTER TABLE public.questions DROP CONSTRAINT questions_question_ate_500_caracteres;

DO $conferencia_rollback_20261391000000$
DECLARE
  v_antes CONSTANT text := '((bucket_id=''devolucoes''::text)AND(split_part(name,''/''::text,1)=((SELECTauth.uid()ASuid))::text))';
BEGIN
  IF NOT EXISTS (
       SELECT 1 FROM pg_policy p
        WHERE p.polrelid = 'storage.objects'::regclass AND p.polname = 'devolucoes_cliente_insert_policy'
          AND p.polcmd = 'a' AND p.polpermissive AND p.polroles = ARRAY['authenticated'::regrole::oid]
          AND p.polqual IS NULL
          AND regexp_replace(replace(pg_get_expr(p.polwithcheck, p.polrelid), 'public.', ''), '[[:space:]]', '', 'g') = v_antes
     ) THEN
    RAISE EXCEPTION 'conferencia do rollback 20261391000000: devolucoes_cliente_insert_policy não voltou à condição da 20261175000000';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace
               AND p.proname = 'devolucao__fotos_soltas_da_conta') THEN
    RAISE EXCEPTION 'conferencia do rollback 20261391000000: devolucao__fotos_soltas_da_conta continua lá';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_constraint c
              WHERE c.conrelid = 'public.questions'::regclass AND c.conname = 'questions_question_ate_500_caracteres') THEN
    RAISE EXCEPTION 'conferencia do rollback 20261391000000: o CHECK de 500 caracteres de questions continua lá';
  END IF;
END $conferencia_rollback_20261391000000$;
