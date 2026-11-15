-- Rollback manual da 20261399998000 (a loja recebe o plano por uma porta unica).
-- Tira as DUAS funcoes que a migration criou, public.assinatura_da_loja_gravar(text, jsonb, boolean) e public.assinatura_da_loja_definir_chave(text, boolean), e a tabela
-- public.assinatura_da_loja_chave. SO o que a migration criou: NADA e' redefinido (a migration so criou objetos novos, entao nao ha corpo anterior para devolver) e
-- public.assinatura_da_loja, public.assinatura_da_loja_ler() e store_config nao sao tocadas.
-- DADOS: a CHAVE guardada (o hash SHA-256 da chave da loja) SE PERDE com a tabela. Nao e' dado de negocio e nao se reconstroi daqui: depois de reaplicar a 20261399998000,
-- o app de gestao tem de mandar o hash de novo (assinatura_da_loja_definir_chave). O cartao da assinatura (assinatura_da_loja) fica exatamente como esta.
-- COM ELE: o hub que ainda chamar assinatura_da_loja_gravar recebe 404 (funcao ausente) e volta ao upsert direto com a chave de servico, que esta migration nunca fechou.
-- PRE-VOO: recusa (B1_BASELINE_DIVERGENT) antes de apagar qualquer coisa se alguma das funcoes existir com corpo diferente do da migration (alguem a redefiniu: apagar levaria
-- junto uma redefinicao que ninguem revisou), com sobrecarga ou com outra assinatura, ou se a tabela da chave tiver forma diferente da desta migration. Estados aceitos: tudo
-- como desenhado, parte dos objetos, ou nenhum (rodar de novo e' no-op). Conferencia final: nenhum dos tres existe.
-- Executar pelo aplicar-migrations.yml (apaga o registro do ledger na mesma transacao). Sem BEGIN/COMMIT de nivel superior neste arquivo - regra da casa.
-- Rodar duas vezes deixa o mesmo estado.

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

DO $preflight_rollback_20261399998000$
DECLARE
  v_f record;
  v_oid oid;
  v_hash text;
  v_forma text;
BEGIN
  FOR v_f IN
    SELECT * FROM (VALUES
      ('assinatura_da_loja_definir_chave', 'public.assinatura_da_loja_definir_chave(text, boolean)', 'ee89c0e70e378fe0be0fc3c805567d56'),
      ('assinatura_da_loja_gravar', 'public.assinatura_da_loja_gravar(text, jsonb, boolean)', '565f82cb9a65ed96e4702db9d97bf0d6')
    ) AS t(nome, assinatura, hash)
  LOOP
    IF (SELECT count(*) FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname = v_f.nome) > 1 THEN
      RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: % tem sobrecarga em public - revise antes de apagar.', v_f.nome;
    END IF;
    v_oid := to_regprocedure(v_f.assinatura);
    IF v_oid IS NOT NULL THEN
      SELECT md5(replace(prosrc, E'\r', '')) INTO v_hash FROM pg_proc WHERE oid = v_oid;
      IF v_hash IS DISTINCT FROM v_f.hash THEN
        RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: corpo vivo de % (hash %) nao e o da 20261399998000 - uma redefinicao posterior esta no ar; revise antes de apagar.', v_f.assinatura, COALESCE(v_hash, 'ausente');
      END IF;
    ELSIF EXISTS (SELECT 1 FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname = v_f.nome) THEN
      RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: % existe em public com outra assinatura - revise antes de apagar.', v_f.nome;
    END IF;
  END LOOP;
  IF to_regclass('public.assinatura_da_loja_chave') IS NOT NULL THEN
    SELECT string_agg(a.attname || ':' || format_type(a.atttypid, a.atttypmod) || ':' || a.attnotnull::text, ',' ORDER BY a.attname)
      INTO v_forma
      FROM pg_attribute a
     WHERE a.attrelid = to_regclass('public.assinatura_da_loja_chave') AND a.attnum > 0 AND NOT a.attisdropped;
    IF NOT EXISTS (SELECT 1 FROM pg_class WHERE oid = to_regclass('public.assinatura_da_loja_chave') AND relkind = 'r')
       OR v_forma IS DISTINCT FROM 'chave_hash:text:true,criada_em:timestamp with time zone:true,id:smallint:true' THEN
      RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: public.assinatura_da_loja_chave nao tem a forma da 20261399998000 (%) - revise antes de apagar.', v_forma;
    END IF;
  END IF;
END $preflight_rollback_20261399998000$;

-- A porta primeiro (usa a tabela). Sem CASCADE: dependente que escapou faz o Postgres recusar em vez de apagar o objeto junto.
DROP FUNCTION IF EXISTS public.assinatura_da_loja_gravar(text, jsonb, boolean);
DROP FUNCTION IF EXISTS public.assinatura_da_loja_definir_chave(text, boolean);
DROP TABLE IF EXISTS public.assinatura_da_loja_chave;

DO $conferencia_rollback_20261399998000$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname IN ('assinatura_da_loja_gravar', 'assinatura_da_loja_definir_chave')) THEN
    RAISE EXCEPTION 'conferencia rollback 20261399998000: assinatura_da_loja_gravar ou assinatura_da_loja_definir_chave ainda existe';
  END IF;
  IF to_regclass('public.assinatura_da_loja_chave') IS NOT NULL THEN
    RAISE EXCEPTION 'conferencia rollback 20261399998000: a tabela assinatura_da_loja_chave ainda existe';
  END IF;
END $conferencia_rollback_20261399998000$;

NOTIFY pgrst, 'reload schema';
