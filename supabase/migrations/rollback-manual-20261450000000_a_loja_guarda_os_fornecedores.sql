-- Rollback manual da 20261450000000 (a loja guarda os fornecedores).
-- Tira o gatilho, a funcao do gatilho, as QUATRO politicas (fornecedores_admin_{select,insert,update,delete}_policy) e TODOS os
-- privilegios da tabela public.fornecedores. NADA e' redefinido: a migration so criou objetos novos, entao nao ha corpo anterior
-- para devolver byte a byte; rls_admin_atual(), is_admin_atual(), produtos.fornecedor_id e todas as politicas e grants
-- existentes nunca foram tocados.
-- DADOS: a tabela public.fornecedores (os contatos e as observacoes da lojista) FICA, com as linhas, SELADA (RLS ligada, nenhuma
-- politica e nenhum privilegio: ninguem de aplicacao le, nem o admin). Apagar a tabela e' o
-- rollback-manual-destrutivo-20261450000000 (so com o dono, depois deste).
-- EFEITO NO PRODUTO: a tela "Meus fornecedores" mostra o estado de erro (a leitura e' recusada); nada mais depende da tabela.
-- Para voltar: reaplicar a migration (a tabela e as linhas sobrevivem ao rollback e o pre-voo a aceita no estado selado).
-- Ordem: este vem ANTES do rollback da 20261197 (as politicas citam rls_admin_atual()). Repetir e' no-op.
-- Sem BEGIN/COMMIT de nivel superior: transacao do aplicador.

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

DO $rollback_20261450000000$
BEGIN
  -- Recusa estado desconhecido: so aceita o que ESTA migration deixa (ou nada).
  IF to_regprocedure('public.fornecedores_carimba_atualizado_em()') IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM pg_proc WHERE oid = to_regprocedure('public.fornecedores_carimba_atualizado_em()')
                       AND md5(replace(prosrc, chr(13), '')) = 'e05593617f77fa8e7caf14479400b6b1') THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: fornecedores_carimba_atualizado_em desconhecida (sucessora no ar?); nada foi apagado.';
  END IF;
END $rollback_20261450000000$;

DO $rollback_objetos_20261450000000$
BEGIN
  IF to_regclass('public.fornecedores') IS NOT NULL THEN
    -- O gatilho antes da funcao que ele chama (sem CASCADE: dependente que escapou faz o Postgres recusar).
    DROP TRIGGER IF EXISTS fornecedores_carimba_atualizado_em ON public.fornecedores;
    DROP POLICY IF EXISTS fornecedores_admin_select_policy ON public.fornecedores;
    DROP POLICY IF EXISTS fornecedores_admin_insert_policy ON public.fornecedores;
    DROP POLICY IF EXISTS fornecedores_admin_update_policy ON public.fornecedores;
    DROP POLICY IF EXISTS fornecedores_admin_delete_policy ON public.fornecedores;
    REVOKE ALL ON TABLE public.fornecedores FROM PUBLIC, anon, authenticated, service_role;
  END IF;
END $rollback_objetos_20261450000000$;

DROP FUNCTION IF EXISTS public.fornecedores_carimba_atualizado_em();

NOTIFY pgrst, 'reload schema';
