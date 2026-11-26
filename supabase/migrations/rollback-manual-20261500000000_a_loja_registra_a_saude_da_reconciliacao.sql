-- Rollback manual da 20261500000000 (a loja registra a saude da reconciliacao).
-- Tira as DUAS funcoes que a migration criou, public.saude_da_loja() e public.saude_da_reconciliacao_registrar(boolean, text[]). SO o que a migration criou: NADA e'
-- redefinido (a migration so criou objetos novos, entao nao ha corpo anterior para devolver).
-- DADOS: a tabela public.saude_da_reconciliacao e a linha do ultimo batimento FICAM (apagar a tabela e' o rollback-manual-destrutivo, so depois deste e com o dono).
-- COM ELE: a edge reconciliar-pagamentos que ainda chamar a porta recebe 404 (PGRST202), so loga o nome do erro e responde EXATAMENTE como antes; o app de gestao passa a
-- ver a loja como "sem medidor" (saude_da_loja ausente). Reaplicar a 20261500000000 devolve as duas funcoes e a linha guardada volta a ser lida.
-- PRE-VOO: recusa (B1_BASELINE_DIVERGENT) antes de apagar qualquer coisa se alguma das funcoes existir com corpo diferente do da migration (alguem a redefiniu: apagar
-- levaria junto uma redefinicao que ninguem revisou), com sobrecarga ou com outra assinatura. Estados aceitos: as duas como desenhadas, so uma, ou nenhuma (rodar de novo
-- e' no-op). Conferencia final: nenhuma das duas existe.
-- Executar pelo aplicar-migrations.yml (apaga o registro do ledger na mesma transacao). Sem BEGIN/COMMIT de nivel superior neste arquivo - regra da casa.
-- Rodar duas vezes deixa o mesmo estado.

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

DO $preflight_rollback_20261500000000$
DECLARE
  v_f record;
  v_oid oid;
  v_hash text;
BEGIN
  FOR v_f IN
    SELECT * FROM (VALUES
      ('saude_da_reconciliacao_registrar', 'public.saude_da_reconciliacao_registrar(boolean, text[])', '06c25460eb479a7a98fc1abd4f384dfd'),
      ('saude_da_loja', 'public.saude_da_loja()', 'c06bfddb10d28733f7a93e30783fbd91')
    ) AS t(nome, assinatura, hash)
  LOOP
    IF (SELECT count(*) FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname = v_f.nome) > 1 THEN
      RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: % tem sobrecarga em public - revise antes de apagar.', v_f.nome;
    END IF;
    v_oid := to_regprocedure(v_f.assinatura);
    IF v_oid IS NOT NULL THEN
      SELECT md5(replace(prosrc, E'\r', '')) INTO v_hash FROM pg_proc WHERE oid = v_oid;
      IF v_hash IS DISTINCT FROM v_f.hash THEN
        RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: corpo vivo de % (hash %) nao e o da 20261500000000 - uma redefinicao posterior esta no ar; revise antes de apagar.', v_f.assinatura, COALESCE(v_hash, 'ausente');
      END IF;
    ELSIF EXISTS (SELECT 1 FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname = v_f.nome) THEN
      RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: % existe em public com outra assinatura - revise antes de apagar.', v_f.nome;
    END IF;
  END LOOP;
END $preflight_rollback_20261500000000$;

-- Sem CASCADE: dependente que escapou faz o Postgres recusar em vez de apagar o objeto junto.
DROP FUNCTION IF EXISTS public.saude_da_loja();
DROP FUNCTION IF EXISTS public.saude_da_reconciliacao_registrar(boolean, text[]);

DO $conferencia_rollback_20261500000000$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname IN ('saude_da_loja', 'saude_da_reconciliacao_registrar')) THEN
    RAISE EXCEPTION 'conferencia rollback 20261500000000: saude_da_loja ou saude_da_reconciliacao_registrar ainda existe';
  END IF;
END $conferencia_rollback_20261500000000$;

NOTIFY pgrst, 'reload schema';
