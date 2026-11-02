-- ============================================================================
-- Rollback manual — o nome do perfil (e o WhatsApp) têm teto no banco (20261399100000)
-- ============================================================================
-- Tira os três CHECKs que a 20261399100000 criou, os ÚNICOS objetos dela (não há estado anterior a restaurar):
-- `profiles_full_name_ate_120_caracteres` e `profiles_whatsapp_ate_20_caracteres` em public.profiles e
-- `public_profiles_full_name_ate_120_caracteres` em public.public_profiles. Nenhuma linha é lida ou reescrita; o nome e o
-- WhatsApp gravados enquanto os CHECKs existiam ficam como foram. O esquema volta byte a byte ao de antes da migration.
--
-- COM ELE VOLTA O DEFEITO: uma conta logada volta a gravar nome de qualquer tamanho (que a vitrine entrega a todo visitante
-- como `author_name`). Também é o conserto, se uma loja tinha perfil antigo acima do teto e o CHECK passou a barrar o UPDATE
-- dele (foto, CPF, cargo): sem os CHECKs esses UPDATEs voltam a funcionar.
--
-- PRÉ-VOO: recusa (`B1_BASELINE_DIVERGENT`) antes de apagar qualquer coisa se algum dos três CHECKs existir mas NÃO for o desta
-- migration (alguém o redefiniu: apagar levaria junto uma regra que ninguém revisou). Estados aceitos por CHECK: como
-- desenhado (NOT VALID ou já validado) ou nenhum (rodar de novo é no-op). Conferência final: nenhum dos três existe.
--
-- Executar pelo aplicar-migrations.yml (apaga o registro do ledger na mesma transação). Sem BEGIN/COMMIT de nível
-- superior neste arquivo — regra da casa. Rodar duas vezes deixa o mesmo estado.
-- ============================================================================

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

DO $preflight_rollback_20261399100000$
DECLARE
  v_item record;
  v_def text;
BEGIN
  FOR v_item IN
    SELECT * FROM (VALUES
      ('profiles', 'profiles_full_name_ate_120_caracteres', 'CHECK ((char_length(full_name) <= 120))'),
      ('public_profiles', 'public_profiles_full_name_ate_120_caracteres', 'CHECK ((char_length(full_name) <= 120))'),
      ('profiles', 'profiles_whatsapp_ate_20_caracteres', 'CHECK ((char_length(whatsapp) <= 20))')
    ) AS t(tabela, nome, definicao)
  LOOP
    SELECT pg_get_constraintdef(c.oid) INTO v_def
      FROM pg_constraint c
     WHERE c.conrelid = to_regclass('public.' || v_item.tabela) AND c.conname = v_item.nome;
    IF FOUND AND v_def NOT IN (v_item.definicao || ' NOT VALID', v_item.definicao) THEN
      RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: o CHECK % (%) não é o da 20261399100000 — revise antes de apagar.', v_item.nome, v_def;
    END IF;
  END LOOP;
END $preflight_rollback_20261399100000$;

ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_full_name_ate_120_caracteres;
ALTER TABLE public.public_profiles DROP CONSTRAINT IF EXISTS public_profiles_full_name_ate_120_caracteres;
ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_whatsapp_ate_20_caracteres;

DO $conferencia_rollback_20261399100000$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint c
              WHERE (c.conrelid = 'public.profiles'::regclass
                     AND c.conname IN ('profiles_full_name_ate_120_caracteres', 'profiles_whatsapp_ate_20_caracteres'))
                 OR (c.conrelid = 'public.public_profiles'::regclass
                     AND c.conname = 'public_profiles_full_name_ate_120_caracteres')) THEN
    RAISE EXCEPTION 'conferencia rollback 20261399100000: algum CHECK de tamanho do perfil continua lá';
  END IF;
END $conferencia_rollback_20261399100000$;
