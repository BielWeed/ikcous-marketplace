-- ROLLBACK DESTRUTIVO 20261500000000 - SO COM O DONO.
-- Apaga public.saude_da_reconciliacao (o batimento da reconciliacao de pagamentos: a ultima rodada, a ultima saudavel e o contador de rodadas degradadas). O rollback
-- comum preserva a tabela.
-- O que se perde: so o ULTIMO batimento (nao e' dinheiro nem dado de cliente). Depois de reaplicar a 20261500000000, a proxima rodada da reconciliacao recria a linha;
-- o historico de "desde quando esta degradada" (ultima_saudavel_em e o contador) recomeca do zero.
-- So depois do rollback comum (rollback-manual-20261500000000_a_loja_registra_a_saude_da_reconciliacao.sql), numa transacao do caller, com confirmacao explicita:
--   SET app.confirmo_apagar_saude_da_reconciliacao = 'APAGAR';
-- Recusa (sem apagar nada) se a tabela existir com outra forma: ela nao seria a desta migration. Rodar duas vezes deixa o mesmo estado.
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

DO $destrutivo_20261500000000$
BEGIN
  IF COALESCE(current_setting('app.confirmo_apagar_saude_da_reconciliacao', true), '') <> 'APAGAR' THEN
    RAISE EXCEPTION 'SAUDE_DA_RECONCILIACAO_SO_COM_O_DONO: confirme antes de apagar saude_da_reconciliacao.';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname IN ('saude_da_loja', 'saude_da_reconciliacao_registrar')) THEN
    RAISE EXCEPTION 'SAUDE_DA_RECONCILIACAO_ROLLBACK_COMUM_PRIMEIRO: tire as funcoes (rollback comum) antes de apagar a tabela.';
  END IF;
  IF to_regclass('public.saude_da_reconciliacao') IS NOT NULL
     AND (NOT EXISTS (SELECT 1 FROM pg_class WHERE oid = to_regclass('public.saude_da_reconciliacao') AND relkind = 'r')
          OR (SELECT string_agg(a.attname || ':' || format_type(a.atttypid, a.atttypmod) || ':' || a.attnotnull::text, ',' ORDER BY a.attname)
                FROM pg_attribute a
               WHERE a.attrelid = to_regclass('public.saude_da_reconciliacao') AND a.attnum > 0 AND NOT a.attisdropped)
             IS DISTINCT FROM 'degradado:boolean:true,etapas_com_falha:text[]:true,id:smallint:true,rodadas_degradadas_seguidas:integer:true,ultima_rodada_em:timestamp with time zone:true,ultima_saudavel_em:timestamp with time zone:false') THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: public.saude_da_reconciliacao nao tem a forma da 20261500000000 - revise antes de apagar.';
  END IF;
END $destrutivo_20261500000000$;

-- Sem CASCADE: dependente que escapou faz o Postgres recusar em vez de apagar o objeto junto.
DROP TABLE IF EXISTS public.saude_da_reconciliacao;

NOTIFY pgrst, 'reload schema';
