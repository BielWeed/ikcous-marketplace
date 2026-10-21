-- Rollback comum 20261252000000: remove SÓ as RPCs novas do caixa
-- (fin_caixa_fechar_sessao e fin_caixa_movimentar_com_chave). Retirar ANTES o
-- consumidor novo: sem elas o retry volta a ter o risco CX1/CX2 das antigas.
-- PRESERVA fin_caixa_movimento_tentativas e todas as linhas (nenhum dado apagado).
-- As RPCs antigas não são tocadas: pré e pós-voo medem o corpo delas.
-- Sem BEGIN/COMMIT próprios; aplicar 2x é idêntico (DROP ... IF EXISTS).
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

DO $preflight_rollback_20261252$
BEGIN
  IF (SELECT md5(replace(prosrc, E'\r', '')) FROM pg_proc WHERE oid = to_regprocedure('public.fin_caixa_fechar(numeric,text)'))
       IS DISTINCT FROM '69a9dd8988cdc05392f500deb64f349f'
     OR (SELECT md5(replace(prosrc, E'\r', '')) FROM pg_proc WHERE oid = to_regprocedure('public.fin_caixa_movimentar(text,numeric,text,uuid)'))
       IS DISTINCT FROM 'd7e8dfeec40f89dff51f4cb3ccf14b9a' THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: corpo vivo das RPCs antigas do caixa desconhecido.';
  END IF;
  IF (SELECT count(*) FROM pg_proc WHERE pronamespace = 'public'::regnamespace AND proname = 'fin_caixa_fechar_sessao')
       <> (to_regprocedure('public.fin_caixa_fechar_sessao(uuid,numeric,text)') IS NOT NULL)::int
     OR (SELECT count(*) FROM pg_proc WHERE pronamespace = 'public'::regnamespace AND proname = 'fin_caixa_movimentar_com_chave')
       <> (to_regprocedure('public.fin_caixa_movimentar_com_chave(uuid,uuid,text,numeric,text,uuid)') IS NOT NULL)::int
     OR COALESCE((SELECT md5(replace(prosrc, E'\r', '')) FROM pg_proc
                   WHERE oid = to_regprocedure('public.fin_caixa_fechar_sessao(uuid,numeric,text)')), 'f10208ba223450fd25af3c9e11dca073')
          <> 'f10208ba223450fd25af3c9e11dca073'
     OR COALESCE((SELECT md5(replace(prosrc, E'\r', '')) FROM pg_proc
                   WHERE oid = to_regprocedure('public.fin_caixa_movimentar_com_chave(uuid,uuid,text,numeric,text,uuid)')), '134bd5b7c5872bf30041601725fc37ba')
          <> '134bd5b7c5872bf30041601725fc37ba' THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: RPCs novas do caixa com corpo ou sobrecarga desconhecidos; nada removido.';
  END IF;
END $preflight_rollback_20261252$;

DROP FUNCTION IF EXISTS public.fin_caixa_movimentar_com_chave(uuid, uuid, text, numeric, text, uuid);
DROP FUNCTION IF EXISTS public.fin_caixa_fechar_sessao(uuid, numeric, text);

DO $conferencia_rollback_20261252$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_proc WHERE pronamespace = 'public'::regnamespace
              AND proname IN ('fin_caixa_fechar_sessao', 'fin_caixa_movimentar_com_chave')) THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: RPCs novas do caixa continuam presentes.';
  END IF;
  IF (SELECT md5(replace(prosrc, E'\r', '')) FROM pg_proc WHERE oid = to_regprocedure('public.fin_caixa_fechar(numeric,text)'))
       IS DISTINCT FROM '69a9dd8988cdc05392f500deb64f349f'
     OR (SELECT md5(replace(prosrc, E'\r', '')) FROM pg_proc WHERE oid = to_regprocedure('public.fin_caixa_movimentar(text,numeric,text,uuid)'))
       IS DISTINCT FROM 'd7e8dfeec40f89dff51f4cb3ccf14b9a' THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: o rollback mexeu no corpo das RPCs antigas do caixa.';
  END IF;
END $conferencia_rollback_20261252$;
