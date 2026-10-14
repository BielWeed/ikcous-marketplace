-- ============================================================================
-- Rollback manual — a consulta antiga de pedido por código de verificação
-- fecha para o visitante e para a conta logada (20261220000000)
-- ============================================================================
-- Devolve o EXECUTE da `get_orders_by_otp_v1(text, text)` a anon e
-- authenticated, com um GRANT: a ACL volta idêntica à de antes da migration
-- (PUBLIC sem nada; anon, authenticated, service_role e o dono com EXECUTE,
-- grantor postgres). Nenhum corpo é trocado e nenhuma função é recriada: a
-- migration nunca apagou nem alterou a função, só tirou o EXECUTE.
--
-- COM ELE VOLTA O ACHADO A-1: quem sabe só o e-mail de outra pessoa gasta as 5
-- tentativas do código dela pela v1. Use só para devolver o rastreio a um app
-- antigo que ainda chame a v1 enquanto o app novo não chega.
--
-- DADOS: nenhuma linha foi reescrita pela migration nem é tocada aqui.
--
-- PRÉ-VOO: recusa (`B1_BASELINE_DIVERGENT`) se a v1 não existir ou se o corpo
-- vivo (md5 de `replace(prosrc, E'\r', '')`) não for o que a 20261217000000
-- deixou — reabrir a porta por cima de um corpo desconhecido abriria uma função
-- que ninguém revisou. Rodar duas vezes deixa o mesmo estado (GRANT).
--
-- Executar pelo aplicar-migrations.yml (apaga o registro do ledger na mesma
-- transação). Sem BEGIN/COMMIT de nível superior neste arquivo — regra da casa.
-- ============================================================================

DO $preflight_rollback_20261220$
DECLARE
  v_hash text;
BEGIN
  IF to_regprocedure('public.get_orders_by_otp_v1(text,text)') IS NULL THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: public.get_orders_by_otp_v1(text,text) não existe — nada a devolver.';
  END IF;

  SELECT md5(replace(prosrc, E'\r', '')) INTO v_hash
    FROM pg_proc
   WHERE oid = to_regprocedure('public.get_orders_by_otp_v1(text,text)');
  IF v_hash IS DISTINCT FROM '277776acaf395fa864cc3e2cb0638237' THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: corpo vivo de public.get_orders_by_otp_v1(text,text) (hash %) não é o que a 20261217000000 deixou — uma redefinição posterior está no ar; revise antes de reabrir a porta.', COALESCE(v_hash, 'ausente');
  END IF;
END $preflight_rollback_20261220$;

GRANT EXECUTE ON FUNCTION public.get_orders_by_otp_v1(text, text) TO anon;
GRANT EXECUTE ON FUNCTION public.get_orders_by_otp_v1(text, text) TO authenticated;

DO $conferencia_rollback_20261220$
DECLARE
  v_v1 CONSTANT text := 'public.get_orders_by_otp_v1(text,text)';
BEGIN
  IF NOT has_function_privilege('anon', v_v1, 'EXECUTE')
     OR NOT has_function_privilege('authenticated', v_v1, 'EXECUTE') THEN
    RAISE EXCEPTION 'conferencia rollback 20261220: anon ou authenticated sem EXECUTE em %', v_v1;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_proc p
               CROSS JOIN LATERAL aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) g
              WHERE p.oid = to_regprocedure(v_v1) AND g.privilege_type = 'EXECUTE' AND g.grantee = 0) THEN
    RAISE EXCEPTION 'conferencia rollback 20261220: % aberta para PUBLIC — o estado de antes não tinha PUBLIC', v_v1;
  END IF;
  IF NOT has_function_privilege('service_role', v_v1, 'EXECUTE') THEN
    RAISE EXCEPTION 'conferencia rollback 20261220: service_role sem EXECUTE em %', v_v1;
  END IF;
END $conferencia_rollback_20261220$;
