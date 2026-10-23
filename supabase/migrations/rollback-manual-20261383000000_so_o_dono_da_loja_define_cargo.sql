-- Rollback manual da 20261383000000 (so o dono da loja define cargo).
-- Tira o gatilho tr_papel_so_pelo_definir_cargo, as duas funcoes (papel_so_pelo_definir_cargo e definir_cargo) e as
-- duas politicas de leitura (dono_da_loja_select_policy, cargo_log_select_policy). NADA e' redefinido: a migration so
-- criou objetos novos, entao nao ha corpo anterior para devolver byte a byte; ensure_role_protection, prevent_role_change
-- e handle_profile_role_sync_to_auth nunca foram tocados.
-- DADOS: as tabelas public.dono_da_loja (quem e' o dono) e public.cargo_log (historico de cargos) FICAM, com as linhas,
-- seladas (RLS ligada e nenhuma politica: ninguem de aplicacao le). Apaga-las e' o rollback-manual-destrutivo-20261383000000
-- (so com o dono, depois deste). Tirar as politicas e' o que destrava o rollback da 20261197 (que recusa enquanto qualquer
-- politica fora dela ainda cita rls_admin_atual()).
-- EFEITO NO PRODUTO: volta a porta de antes (qualquer admin atual muda profiles.role de qualquer pessoa por PATCH).
-- Cadastro do dono, para quem reaplicar a migration em banco que ja a tinha (a tabela e as linhas sobrevivem ao rollback):
--   INSERT INTO public.dono_da_loja (user_id) VALUES ('<uuid-do-dono-em-auth.users>');   -- so se a tabela estiver vazia
-- Descadastrar: DELETE FROM public.dono_da_loja;
-- Ordem: este vem ANTES do rollback da 20261197. Repetir e' no-op. Sem BEGIN/COMMIT: transacao do aplicador.

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

DO $rollback_20261383000000$
BEGIN
  -- Recusa estado desconhecido: so aceita o que ESTA migration deixa (ou nada).
  IF EXISTS (SELECT 1 FROM pg_proc WHERE pronamespace = 'public'::regnamespace AND proname = 'definir_cargo'
       AND (oid <> COALESCE(to_regprocedure('public.definir_cargo(uuid,text)'), 0)
            OR md5(replace(prosrc, chr(13), '')) <> '69258350cbaf598b1e0b8e0bf2f20211')) THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: definir_cargo desconhecida (sucessora no ar?); nada foi apagado.';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_proc WHERE pronamespace = 'public'::regnamespace AND proname = 'papel_so_pelo_definir_cargo'
       AND (oid <> COALESCE(to_regprocedure('public.papel_so_pelo_definir_cargo()'), 0)
            OR md5(replace(prosrc, chr(13), '')) <> '4db62affedb4d07d5ea9e26393fb938c')) THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: papel_so_pelo_definir_cargo desconhecida (sucessora no ar?); nada foi apagado.';
  END IF;
  -- Gatilho com outro nome do mesmo proposito ou apontando para outra funcao: nao e' desta migration.
  IF EXISTS (SELECT 1 FROM pg_trigger t
       WHERE t.tgrelid = to_regclass('public.profiles') AND t.tgname = 'tr_papel_so_pelo_definir_cargo' AND NOT t.tgisinternal
         AND t.tgfoid <> COALESCE(to_regprocedure('public.papel_so_pelo_definir_cargo()'), 0)) THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: tr_papel_so_pelo_definir_cargo aponta para outra funcao; nada foi apagado.';
  END IF;
END $rollback_20261383000000$;

-- Primeiro o gatilho (depende da funcao dele), depois as funcoes. Sem CASCADE: dependente que escapou faz o Postgres
-- recusar em vez de apagar o objeto junto.
DROP TRIGGER IF EXISTS tr_papel_so_pelo_definir_cargo ON public.profiles;
DROP FUNCTION IF EXISTS public.papel_so_pelo_definir_cargo();
DROP FUNCTION IF EXISTS public.definir_cargo(uuid, text);

DO $rollback_politicas_20261383000000$
BEGIN
  IF to_regclass('public.dono_da_loja') IS NOT NULL THEN
    DROP POLICY IF EXISTS dono_da_loja_select_policy ON public.dono_da_loja;
  END IF;
  IF to_regclass('public.cargo_log') IS NOT NULL THEN
    DROP POLICY IF EXISTS cargo_log_select_policy ON public.cargo_log;
  END IF;
END $rollback_politicas_20261383000000$;

NOTIFY pgrst, 'reload schema';
