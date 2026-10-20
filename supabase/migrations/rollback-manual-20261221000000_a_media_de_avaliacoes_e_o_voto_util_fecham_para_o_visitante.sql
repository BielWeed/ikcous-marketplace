-- ============================================================================
-- Rollback manual — a média de avaliações e o voto "útil" fecham para o
-- visitante sem login (20261221000000)
-- ============================================================================
-- Devolve o EXECUTE de `get_reviews_metrics(text, integer)` e de
-- `increment_helpful(uuid)` ao visitante (anon), com um GRANT por função: a ACL
-- volta ao conjunto de antes da migration (PUBLIC sem nada; anon, authenticated,
-- service_role e o dono com EXECUTE, grantor postgres). `authenticated` e
-- `service_role` não mudam (a migration nunca os tirou); nada vai para PUBLIC.
-- Nenhum corpo é trocado e nenhuma função é recriada: a migration nunca apagou nem
-- alterou função, só tirou EXECUTE de PUBLIC e de anon.
--
-- COM ELE VOLTA A PORTA ABERTA AO VISITANTE (a lista L8 volta a precisar da
-- situação `tolerada` e de `executa: ["anon", "authenticated"]` para as duas).
--
-- DADOS: nenhuma linha foi reescrita pela migration nem é tocada aqui.
--
-- PRÉ-VOO: recusa (`B1_BASELINE_DIVERGENT`) se alguma das duas funções não
-- existir. Rodar duas vezes deixa o mesmo estado (GRANT é idempotente). A
-- conferência final recusa se anon não ficou com EXECUTE, se PUBLIC ficou com
-- EXECUTE (o estado de antes não tinha PUBLIC) ou se service_role não executa.
--
-- ATENÇÃO — NÃO RODE depois deste arquivo o
-- `rollback-manual-20261090500000_a_loja_clonada_nasce_com_os_mesmos_grants.sql`:
-- ele faz `GRANT EXECUTE ... TO PUBLIC` nestas duas funções (linhas
-- `get_reviews_metrics` e `increment_helpful`) e, rodado DEPOIS da migration
-- 20261221000000, reabre as duas para TODOS, inclusive o visitante.
--
-- Executar pelo aplicar-migrations.yml (apaga o registro do ledger na mesma
-- transação). Sem BEGIN/COMMIT de nível superior neste arquivo — regra da casa.
-- ============================================================================

DO $preflight_rollback_20261221$
DECLARE
  v_fn text;
BEGIN
  FOREACH v_fn IN ARRAY ARRAY[
    'public.get_reviews_metrics(text,integer)',
    'public.increment_helpful(uuid)'
  ] LOOP
    IF to_regprocedure(v_fn) IS NULL THEN
      RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: % não existe — nada a devolver.', v_fn;
    END IF;
  END LOOP;
END $preflight_rollback_20261221$;

GRANT EXECUTE ON FUNCTION public.get_reviews_metrics(text, integer) TO anon;
GRANT EXECUTE ON FUNCTION public.increment_helpful(uuid) TO anon;

DO $conferencia_rollback_20261221$
DECLARE
  v_fn text;
BEGIN
  FOREACH v_fn IN ARRAY ARRAY[
    'public.get_reviews_metrics(text,integer)',
    'public.increment_helpful(uuid)'
  ] LOOP
    IF NOT has_function_privilege('anon', v_fn, 'EXECUTE') THEN
      RAISE EXCEPTION 'conferencia rollback 20261221: anon sem EXECUTE em %', v_fn;
    END IF;
    IF EXISTS (SELECT 1 FROM pg_proc p
                 CROSS JOIN LATERAL aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) g
                WHERE p.oid = to_regprocedure(v_fn) AND g.privilege_type = 'EXECUTE' AND g.grantee = 0) THEN
      RAISE EXCEPTION 'conferencia rollback 20261221: % aberta para PUBLIC — o estado de antes não tinha PUBLIC', v_fn;
    END IF;
    IF NOT has_function_privilege('service_role', v_fn, 'EXECUTE') THEN
      RAISE EXCEPTION 'conferencia rollback 20261221: service_role sem EXECUTE em %', v_fn;
    END IF;
  END LOOP;
END $conferencia_rollback_20261221$;
