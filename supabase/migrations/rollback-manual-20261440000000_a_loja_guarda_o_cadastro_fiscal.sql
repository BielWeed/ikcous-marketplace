-- Rollback manual da 20261440000000 (a loja guarda o cadastro fiscal).
-- Tira a funcao fiscal_cadastro_salvar e as duas politicas de leitura (fiscal_cadastro_select_policy e
-- fiscal_cadastro_log_select_policy). NADA e' redefinido: a migration so criou objetos novos, entao nao ha corpo anterior para
-- devolver byte a byte; fin_dre, is_admin_atual, rls_admin_atual, dono_da_loja e definir_cargo nunca foram tocados.
-- DADOS: as tabelas public.fiscal_cadastro (o regime e a atividade da loja) e public.fiscal_cadastro_log (a trilha de quem
-- mudou o que) FICAM, com as linhas, seladas (RLS ligada e nenhuma politica: ninguem de aplicacao le, nem o admin). Apagar as
-- tabelas e' o rollback-manual-destrutivo-20261440000000 (so com o dono, depois deste).
-- EFEITO NO PRODUTO: ninguem grava nem le o cadastro fiscal pelo app (a aba Impostos mostra o estado de erro/sem cadastro);
-- as guias lancadas no Financeiro continuam la, sao lancamentos normais. Para voltar: reaplicar a migration (as tabelas e as
-- linhas sobrevivem ao rollback e a migration as aceita como estao).
-- Ordem: este vem ANTES do rollback da 20261197 e da 20261383 (a politica cita rls_admin_atual(); a funcao citava
-- dono_da_loja). Repetir e' no-op. Sem BEGIN/COMMIT: transacao do aplicador.

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

DO $rollback_20261440000000$
BEGIN
  -- Recusa estado desconhecido: so aceita o que ESTA migration deixa (ou nada).
  IF EXISTS (SELECT 1 FROM pg_proc WHERE pronamespace = 'public'::regnamespace AND proname = 'fiscal_cadastro_salvar'
       AND (oid <> COALESCE(to_regprocedure('public.fiscal_cadastro_salvar(jsonb)'), 0)
            OR md5(replace(prosrc, chr(13), '')) <> '0e76c24e09699b4aba53600bf4061c67')) THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: fiscal_cadastro_salvar desconhecida (sucessora no ar?); nada foi apagado.';
  END IF;
END $rollback_20261440000000$;

-- Sem CASCADE: dependente que escapou faz o Postgres recusar em vez de apagar o objeto junto.
DROP FUNCTION IF EXISTS public.fiscal_cadastro_salvar(jsonb);

DO $rollback_politicas_20261440000000$
BEGIN
  IF to_regclass('public.fiscal_cadastro') IS NOT NULL THEN
    DROP POLICY IF EXISTS fiscal_cadastro_select_policy ON public.fiscal_cadastro;
  END IF;
  IF to_regclass('public.fiscal_cadastro_log') IS NOT NULL THEN
    DROP POLICY IF EXISTS fiscal_cadastro_log_select_policy ON public.fiscal_cadastro_log;
  END IF;
END $rollback_politicas_20261440000000$;

NOTIFY pgrst, 'reload schema';
