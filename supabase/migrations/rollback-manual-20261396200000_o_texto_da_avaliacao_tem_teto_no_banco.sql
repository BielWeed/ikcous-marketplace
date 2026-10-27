-- ============================================================================
-- Rollback manual — o texto da avaliação tem teto no banco (20261396200000)
-- ============================================================================
-- Tira o CHECK `reviews_comment_ate_1000_caracteres` de public.reviews, o ÚNICO objeto que a 20261396200000 criou
-- (não há estado anterior a restaurar). Nenhuma linha de `reviews` é lida ou reescrita; as avaliações gravadas
-- enquanto o CHECK existia ficam como foram.
--
-- COM ELE VOLTA O DEFEITO: uma conta logada volta a gravar avaliação de qualquer tamanho pela API direta.
-- Também é o conserto, se uma loja tinha avaliação antiga com mais de 1000 caracteres e o CHECK passou a barrar
-- o UPDATE dela (moderar, voto útil, resposta da loja): sem o CHECK esses UPDATEs voltam a funcionar.
--
-- PRÉ-VOO: recusa (`B1_BASELINE_DIVERGENT`) antes de apagar se o CHECK existir mas NÃO for o desta migration
-- (alguém o redefiniu: apagar levaria junto uma regra que ninguém revisou). Estados aceitos: o CHECK como desenhado
-- (NOT VALID ou já validado) ou nenhum (rodar de novo é no-op). Conferência final: o CHECK não existe.
--
-- Executar pelo aplicar-migrations.yml (apaga o registro do ledger na mesma transação). Sem BEGIN/COMMIT de nível
-- superior neste arquivo — regra da casa. Rodar duas vezes deixa o mesmo estado.
-- ============================================================================

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

DO $preflight_rollback_20261396200000$
DECLARE
  v_def text;
BEGIN
  SELECT pg_get_constraintdef(c.oid) INTO v_def
    FROM pg_constraint c
   WHERE c.conrelid = 'public.reviews'::regclass AND c.conname = 'reviews_comment_ate_1000_caracteres';
  IF FOUND AND v_def NOT IN ('CHECK ((char_length(comment) <= 1000)) NOT VALID',
                             'CHECK ((char_length(comment) <= 1000))') THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: o CHECK reviews_comment_ate_1000_caracteres (%) não é o da 20261396200000 — revise antes de apagar.', v_def;
  END IF;
END $preflight_rollback_20261396200000$;

ALTER TABLE public.reviews DROP CONSTRAINT IF EXISTS reviews_comment_ate_1000_caracteres;

DO $conferencia_rollback_20261396200000$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint c
              WHERE c.conrelid = 'public.reviews'::regclass AND c.conname = 'reviews_comment_ate_1000_caracteres') THEN
    RAISE EXCEPTION 'conferencia rollback 20261396200000: o CHECK de 1000 caracteres de reviews continua lá';
  END IF;
END $conferencia_rollback_20261396200000$;
