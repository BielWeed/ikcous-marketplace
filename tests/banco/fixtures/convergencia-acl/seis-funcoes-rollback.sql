-- SQL AVULSO (não é migration). Desfaz SÓ seis-funcoes.sql e recompõe o proacl EXATO medido
-- em 01/10/2026 nas 6: {postgres=X/postgres,anon=X/postgres,authenticated=X/postgres,
-- service_role=X/postgres} — mesma ordem de entradas. Para isso, dentro da MESMA transação, a
-- entrada do servidor sai e volta depois de anon/authenticated (o efeito líquido para o
-- servidor é zero, e nenhum outro comando enxerga o meio da transação). Nenhuma das 6 tinha
-- PUBLIC, então não há PUBLIC a devolver. As duas revogações de emergência seguem fechadas.
-- Servidor: o conjunto de funções que ele NÃO executa é fotografado no início e tem de ser o MESMO
-- no fim (sem exigir "zero": a Savy tem 5 ausências intencionais); e ele executa as 8 de dinheiro.
BEGIN;

CREATE TEMP TABLE _sr_ausente_antes ON COMMIT DROP AS
  SELECT p.oid FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND NOT has_function_privilege('service_role', p.oid, 'EXECUTE');

-- anon/authenticated: fotografia (papel, função) em vez de contagem fixa — o desfazer continua
-- funcionando depois de migrations que criam funções novas.
CREATE TEMP TABLE _au_antes ON COMMIT DROP AS
  SELECT pp.papel, p.oid FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   CROSS JOIN (VALUES ('anon'), ('authenticated')) AS pp(papel)
   WHERE n.nspname = 'public' AND has_function_privilege(pp.papel, p.oid, 'EXECUTE');

DO $$
DECLARE r record;
BEGIN
  -- pré-condição: estado deixado por seis-funcoes.sql
  FOR r IN
    SELECT p.oid::regprocedure::text AS fn, p.proacl::text AS acl
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.proname IN ('pagamentos_a_reconciliar','liberar_cobranca_do_pedido',
       'concluir_estorno','devolver_estoque','expirar_pedidos_vencidos','devolver_cupons_de_pedidos_mortos')
  LOOP
    IF r.acl IS DISTINCT FROM '{postgres=X/postgres,service_role=X/postgres}' THEN
      RAISE EXCEPTION 'pré-condição do desfazer: % tem proacl %', r.fn, r.acl; END IF;
  END LOOP;
END $$;

REVOKE EXECUTE ON FUNCTION public.pagamentos_a_reconciliar() FROM service_role;
REVOKE EXECUTE ON FUNCTION public.liberar_cobranca_do_pedido(uuid, text) FROM service_role;
REVOKE EXECUTE ON FUNCTION public.concluir_estorno(uuid, text, text, text) FROM service_role;
REVOKE EXECUTE ON FUNCTION public.devolver_estoque(uuid) FROM service_role;
REVOKE EXECUTE ON FUNCTION public.expirar_pedidos_vencidos() FROM service_role;
REVOKE EXECUTE ON FUNCTION public.devolver_cupons_de_pedidos_mortos() FROM service_role;

GRANT EXECUTE ON FUNCTION public.pagamentos_a_reconciliar() TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.liberar_cobranca_do_pedido(uuid, text) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.concluir_estorno(uuid, text, text, text) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.devolver_estoque(uuid) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.expirar_pedidos_vencidos() TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.devolver_cupons_de_pedidos_mortos() TO anon, authenticated, service_role;

DO $$
DECLARE
  r record;
  n int;
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure::text AS fn, p.proacl::text AS acl
      FROM pg_proc p JOIN pg_namespace ns ON ns.oid = p.pronamespace
     WHERE ns.nspname = 'public' AND p.proname IN ('pagamentos_a_reconciliar','liberar_cobranca_do_pedido',
       'concluir_estorno','devolver_estoque','expirar_pedidos_vencidos','devolver_cupons_de_pedidos_mortos')
  LOOP
    IF r.acl IS DISTINCT FROM '{postgres=X/postgres,anon=X/postgres,authenticated=X/postgres,service_role=X/postgres}' THEN
      RAISE EXCEPTION 'desfazer: % ficou com proacl % (diferente do medido)', r.fn, r.acl; END IF;
  END LOOP;
  IF (SELECT p.proacl::text FROM pg_proc p WHERE p.oid = 'public.confirmar_pagamento(uuid,text,text)'::regprocedure)
       IS DISTINCT FROM '{postgres=X/postgres,service_role=X/postgres}'
     OR (SELECT p.proacl::text FROM pg_proc p WHERE p.oid = 'public.devolver_uso_cupom(uuid)'::regprocedure)
       IS DISTINCT FROM '{postgres=X/postgres,service_role=X/postgres}' THEN
    RAISE EXCEPTION 'desfazer reabriria a emergência'; END IF;
  -- o que anon/authenticated executam agora = o de antes MAIS exatamente as 6 (12 pares)
  WITH seis AS (
    SELECT unnest(ARRAY['public.pagamentos_a_reconciliar()','public.liberar_cobranca_do_pedido(uuid,text)',
      'public.concluir_estorno(uuid,text,text,text)','public.devolver_estoque(uuid)',
      'public.expirar_pedidos_vencidos()','public.devolver_cupons_de_pedidos_mortos()']::regprocedure[])::oid AS oid),
  esperado AS (SELECT papel, oid FROM _au_antes
               UNION SELECT pp.papel, s.oid FROM seis s CROSS JOIN (VALUES ('anon'), ('authenticated')) AS pp(papel)),
  atual AS (
    SELECT pp.papel, p.oid FROM pg_proc p JOIN pg_namespace ns ON ns.oid = p.pronamespace
     CROSS JOIN (VALUES ('anon'), ('authenticated')) AS pp(papel)
     WHERE ns.nspname = 'public' AND has_function_privilege(pp.papel, p.oid, 'EXECUTE'))
  SELECT count(*) INTO n FROM ((SELECT * FROM atual EXCEPT SELECT * FROM esperado)
                     UNION ALL (SELECT * FROM esperado EXCEPT SELECT * FROM atual)) d;
  IF n <> 0 THEN RAISE EXCEPTION 'desfazer: anon/authenticated mudaram além das 6 (% pares papel×função)', n; END IF;
  -- as 6 estavam MESMO fechadas antes do desfazer
  SELECT count(*) INTO n FROM _au_antes WHERE oid IN (SELECT unnest(ARRAY['public.pagamentos_a_reconciliar()',
      'public.liberar_cobranca_do_pedido(uuid,text)','public.concluir_estorno(uuid,text,text,text)',
      'public.devolver_estoque(uuid)','public.expirar_pedidos_vencidos()',
      'public.devolver_cupons_de_pedidos_mortos()']::regprocedure[])::oid);
  IF n <> 0 THEN RAISE EXCEPTION 'desfazer: as 6 já tinham % pares abertos antes', n; END IF;
  SELECT count(*) INTO n FROM (
    (SELECT p.oid FROM pg_proc p JOIN pg_namespace ns ON ns.oid = p.pronamespace
      WHERE ns.nspname = 'public' AND NOT has_function_privilege('service_role', p.oid, 'EXECUTE')
     EXCEPT SELECT oid FROM _sr_ausente_antes)
    UNION ALL
    (SELECT oid FROM _sr_ausente_antes
     EXCEPT SELECT p.oid FROM pg_proc p JOIN pg_namespace ns ON ns.oid = p.pronamespace
      WHERE ns.nspname = 'public' AND NOT has_function_privilege('service_role', p.oid, 'EXECUTE'))
  ) d;
  IF n <> 0 THEN RAISE EXCEPTION 'desfazer: conjunto de ausências do servidor mudou em % funções', n; END IF;
  FOR r IN SELECT unnest(ARRAY['public.pagamentos_a_reconciliar()','public.liberar_cobranca_do_pedido(uuid,text)',
      'public.concluir_estorno(uuid,text,text,text)','public.devolver_estoque(uuid)','public.expirar_pedidos_vencidos()',
      'public.devolver_cupons_de_pedidos_mortos()','public.confirmar_pagamento(uuid,text,text)',
      'public.devolver_uso_cupom(uuid)']) AS fn
  LOOP
    IF NOT has_function_privilege('service_role', r.fn::regprocedure, 'EXECUTE') THEN
      RAISE EXCEPTION 'desfazer: servidor sem EXECUTE em %', r.fn; END IF;
  END LOOP;
END $$;

COMMIT;
