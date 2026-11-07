-- ============================================================================
-- Rollback manual — o cadastro cria o perfil em TODA loja (20261399930000)
-- ============================================================================
-- Tira o gatilho `on_auth_user_created` de `auth.users` — o ÚNICO objeto da 20261399930000. O esquema volta ao de antes da migration
-- NUMA loja onde ELA criou o gatilho (a Savy).
--
-- ⚠️ O QUE ESTE ROLLBACK NÃO DESFAZ (é dado legítimo e fica): as linhas de `public.profiles` (e a cópia em `public.public_profiles`)
-- criadas pelo reparo da migration, e o `role = customer` que o gatilho de papel gravou em `auth.users.raw_app_meta_data` desses
-- usuários. Apagar perfil de cliente seria perder dado; não é papel deste arquivo.
--
-- ⚠️ NUNCA RODAR NA IKCOUS: lá o gatilho já existia ANTES da 20261399930000 (a migration foi no-op), então este DROP tiraria o gatilho da
-- loja principal e o cadastro voltaria a entrar sem perfil. Só vale para a loja em que a migration o criou.
--
-- COM ELE VOLTA O DEFEITO: quem se cadastra volta a entrar sem perfil (Perfil sem dados, CPF do cadastro sem gravar).
--
-- PRÉ-VOO: recusa (`B1_BASELINE_DIVERGENT`) antes de apagar qualquer coisa se existir um `on_auth_user_created` que NÃO seja o desta
-- migration (outra função, momento ou condição: alguém o redefiniu e apagar levaria junto uma regra que ninguém revisou). Estados
-- aceitos: o gatilho como desenhado ou nenhum (rodar de novo é no-op). Conferência final: o gatilho não existe.
--
-- Executar pelo aplicar-migrations.yml (apaga o registro do ledger na mesma transação). Sem BEGIN/COMMIT de nível superior neste
-- arquivo — regra da casa. Rodar duas vezes deixa o mesmo estado.
-- ============================================================================

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

DO $preflight_rollback_20261399930000$
DECLARE
  v_gatilho record;
BEGIN
  SELECT t.tgfoid, t.tgtype, t.tgnargs, t.tgqual IS NOT NULL AS tem_quando, cardinality(t.tgattr::int2[]) AS n_colunas
    INTO v_gatilho
    FROM pg_trigger t
   WHERE t.tgrelid = 'auth.users'::regclass AND t.tgname = 'on_auth_user_created' AND NOT t.tgisinternal;
  IF FOUND AND (v_gatilho.tgfoid IS DISTINCT FROM to_regprocedure('public.handle_new_user()')::oid
                OR v_gatilho.tgtype <> 5
                OR v_gatilho.tgnargs <> 0
                OR v_gatilho.tem_quando
                OR v_gatilho.n_colunas <> 0) THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: o gatilho on_auth_user_created de auth.users não é o da 20261399930000 — revise antes de apagar.';
  END IF;
END $preflight_rollback_20261399930000$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;

DO $conferencia_rollback_20261399930000$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_trigger t
              WHERE t.tgrelid = 'auth.users'::regclass AND t.tgname = 'on_auth_user_created' AND NOT t.tgisinternal) THEN
    RAISE EXCEPTION 'conferencia rollback 20261399930000: o gatilho on_auth_user_created continua lá';
  END IF;
END $conferencia_rollback_20261399930000$;
