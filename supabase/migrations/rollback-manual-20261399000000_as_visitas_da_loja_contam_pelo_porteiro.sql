-- Rollback manual da 20261399000000 (as visitas da loja passam a ser contadas pelo porteiro).
-- PARA a conta e a leitura: derruba as DUAS funcoes que a migration criou, public.contar_entrada(text) e public.crm_visitas(date, date).
-- NADA e' redefinido: a migration so criou objetos novos, entao nao ha corpo anterior para devolver (crm_visao nunca foi tocada).
-- DADOS: a tabela public.visitas_por_dia FICA, com as linhas, selada (RLS ligada, sem politica e sem privilegio algum para ninguem
-- de aplicacao). A contagem ja feita nao e' perdida por este arquivo. Apagar a tabela e' o rollback-manual-destrutivo-20261399000000
-- (so depois deste, com confirmacao, e com copia antes: nao ha PITR e a contagem nao se reconstroi).
-- COM ELE: o porteiro que ainda chamar contar_entrada recebe 404 (funcao ausente) e silencia a contagem por alguns minutos sem
-- atrasar nem quebrar nenhuma pagina; o painel que ainda chamar crm_visitas trata a ausencia como "indisponivel". Reaplicar a
-- 20261399000000 depois deste rollback e' seguro: a tabela e as linhas sobrevivem e voltam a ser somadas.
-- PRE-VOO: recusa (B1_BASELINE_DIVERGENT) antes de apagar qualquer coisa se alguma das funcoes existir com corpo diferente do da
-- migration (alguem a redefiniu: apagar levaria junto uma redefinicao que ninguem revisou) ou com sobrecarga. Estados aceitos: as duas
-- como desenhadas, so uma delas, ou nenhuma (rodar de novo e' no-op). Conferencia final: nenhuma das duas existe e a tabela ficou como estava.
-- Executar pelo aplicar-migrations.yml (apaga o registro do ledger na mesma transacao). Sem BEGIN/COMMIT de nivel superior neste
-- arquivo - regra da casa. Rodar duas vezes deixa o mesmo estado.

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

DO $preflight_rollback_20261399000000$
DECLARE
  v_f record;
  v_oid oid;
  v_hash text;
BEGIN
  FOR v_f IN
    SELECT * FROM (VALUES
      ('contar_entrada', 'public.contar_entrada(text)', 'e31b3fd92a739ff7b5c206ef0ece1c22'),
      ('crm_visitas', 'public.crm_visitas(date, date)', '025c19ac6d1ce86617dba41b5ba8b73c')
    ) AS t(nome, assinatura, hash)
  LOOP
    IF (SELECT count(*) FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname = v_f.nome) > 1 THEN
      RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: % tem sobrecarga em public - revise antes de apagar.', v_f.nome;
    END IF;
    v_oid := to_regprocedure(v_f.assinatura);
    IF v_oid IS NOT NULL THEN
      SELECT md5(replace(prosrc, E'\r', '')) INTO v_hash FROM pg_proc WHERE oid = v_oid;
      IF v_hash IS DISTINCT FROM v_f.hash THEN
        RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: corpo vivo de % (hash %) nao e o da 20261399000000 - uma redefinicao posterior esta no ar; revise antes de apagar.', v_f.assinatura, COALESCE(v_hash, 'ausente');
      END IF;
    ELSIF EXISTS (SELECT 1 FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname = v_f.nome) THEN
      RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: % existe em public com outra assinatura - revise antes de apagar.', v_f.nome;
    END IF;
  END LOOP;
  -- Lembra, so nesta transacao, se a tabela existia: a conferencia final prova que ela ficou como estava.
  PERFORM set_config('visitas.tinha_tabela', (to_regclass('public.visitas_por_dia') IS NOT NULL)::text, true);
END $preflight_rollback_20261399000000$;

-- Sem CASCADE: dependente que escapou faz o Postgres recusar em vez de apagar o objeto junto.
DROP FUNCTION IF EXISTS public.contar_entrada(text);
DROP FUNCTION IF EXISTS public.crm_visitas(date, date);

DO $conferencia_rollback_20261399000000$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname IN ('contar_entrada', 'crm_visitas')) THEN
    RAISE EXCEPTION 'conferencia rollback 20261399000000: contar_entrada ou crm_visitas ainda existe';
  END IF;
  IF current_setting('visitas.tinha_tabela', true) = 'true' AND to_regclass('public.visitas_por_dia') IS NULL THEN
    RAISE EXCEPTION 'conferencia rollback 20261399000000: a tabela visitas_por_dia sumiu - o rollback comum nao a apaga';
  END IF;
END $conferencia_rollback_20261399000000$;

NOTIFY pgrst, 'reload schema';
