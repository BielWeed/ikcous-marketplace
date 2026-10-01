-- SQL AVULSO de correção de produção — NÃO é migration (não vai para supabase/migrations;
-- por isso pode ter BEGIN/COMMIT). Alvo: loja PRINCIPAL do IKCOUS (dekxabvqdsuukijblazl).
-- O que as migrations pretendem (e a Savy já tem): estas 6 funções fechadas para anon e
-- authenticated. A principal divergiu na troca de banco de 28/09/2026.
-- Estado exato medido em 01/10/2026 nas 6: proacl = {postgres=X/postgres,anon=X/postgres,
-- authenticated=X/postgres,service_role=X/postgres}; proacl NÃO nulo (acldefault não se
-- aplica); nenhuma entrada PUBLIC; dono postgres; SECURITY DEFINER.
-- service_role (edges) e postgres (pg_cron) não mudam. As duas revogações de emergência
-- (confirmar_pagamento, devolver_uso_cupom; 16:28:45Z) seguem fechadas.
-- Servidor: NÃO se exige "service_role executa tudo" — medido em 01/10 a principal tem 0 ausências
-- e a Savy 5 intencionais (das migrations). O pacote fotografa o conjunto de ausências no início e
-- exige o MESMO conjunto no fim; e exige o servidor nas 8 funções de dinheiro. Nada é concedido.
BEGIN;

CREATE TEMP TABLE _sr_ausente_antes ON COMMIT DROP AS
  SELECT p.oid FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND NOT has_function_privilege('service_role', p.oid, 'EXECUTE');

-- anon/authenticated: fotografia (papel, função) em vez de contagem fixa — a régua não envelhece
-- quando uma migration nova cria função (ex.: 20261184/85 do PIX do balcão).
CREATE TEMP TABLE _au_antes ON COMMIT DROP AS
  SELECT r.papel, p.oid FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   CROSS JOIN (VALUES ('anon'), ('authenticated')) AS r(papel)
   WHERE n.nspname = 'public' AND has_function_privilege(r.papel, p.oid, 'EXECUTE');

DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure::text AS fn, p.proacl::text AS acl
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.proname IN ('pagamentos_a_reconciliar','liberar_cobranca_do_pedido',
       'concluir_estorno','devolver_estoque','expirar_pedidos_vencidos','devolver_cupons_de_pedidos_mortos')
  LOOP
    IF r.acl IS DISTINCT FROM '{postgres=X/postgres,anon=X/postgres,authenticated=X/postgres,service_role=X/postgres}' THEN
      RAISE EXCEPTION 'pré-condição: % tem proacl % (diferente do medido)', r.fn, r.acl; END IF;
  END LOOP;
  IF (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
       WHERE n.nspname = 'public' AND p.proname IN ('pagamentos_a_reconciliar','liberar_cobranca_do_pedido',
         'concluir_estorno','devolver_estoque','expirar_pedidos_vencidos','devolver_cupons_de_pedidos_mortos')) <> 6 THEN
    RAISE EXCEPTION 'pré-condição: esperava exatamente 6 funções (sobrecarga?)'; END IF;
  IF (SELECT p.proacl::text FROM pg_proc p WHERE p.oid = 'public.confirmar_pagamento(uuid,text,text)'::regprocedure)
       IS DISTINCT FROM '{postgres=X/postgres,service_role=X/postgres}'
     OR (SELECT p.proacl::text FROM pg_proc p WHERE p.oid = 'public.devolver_uso_cupom(uuid)'::regprocedure)
       IS DISTINCT FROM '{postgres=X/postgres,service_role=X/postgres}' THEN
    RAISE EXCEPTION 'pré-condição: revogação de emergência não está como medida'; END IF;
END $$;

REVOKE EXECUTE ON FUNCTION public.pagamentos_a_reconciliar() FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.liberar_cobranca_do_pedido(uuid, text) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.concluir_estorno(uuid, text, text, text) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.devolver_estoque(uuid) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.expirar_pedidos_vencidos() FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.devolver_cupons_de_pedidos_mortos() FROM anon, authenticated;

DO $$
DECLARE
  r record;
  n int;
BEGIN
  -- ACL exata depois: só o dono e o servidor, sem PUBLIC
  FOR r IN
    SELECT p.oid::regprocedure::text AS fn, p.proacl::text AS acl
      FROM pg_proc p JOIN pg_namespace ns ON ns.oid = p.pronamespace
     WHERE ns.nspname = 'public' AND p.proname IN ('pagamentos_a_reconciliar','liberar_cobranca_do_pedido',
       'concluir_estorno','devolver_estoque','expirar_pedidos_vencidos','devolver_cupons_de_pedidos_mortos',
       'confirmar_pagamento','devolver_uso_cupom')
  LOOP
    IF r.acl IS DISTINCT FROM '{postgres=X/postgres,service_role=X/postgres}' THEN
      RAISE EXCEPTION 'depois: % ficou com proacl %', r.fn, r.acl; END IF;
  END LOOP;
  -- nada além das 6 mudou: o que anon/authenticated executam agora = o de antes MENOS exatamente as 6
  WITH seis AS (
    SELECT unnest(ARRAY['public.pagamentos_a_reconciliar()','public.liberar_cobranca_do_pedido(uuid,text)',
      'public.concluir_estorno(uuid,text,text,text)','public.devolver_estoque(uuid)',
      'public.expirar_pedidos_vencidos()','public.devolver_cupons_de_pedidos_mortos()']::regprocedure[])::oid AS oid),
  esperado AS (SELECT papel, oid FROM _au_antes WHERE oid NOT IN (SELECT oid FROM seis)),
  atual AS (
    SELECT r.papel, p.oid FROM pg_proc p JOIN pg_namespace ns ON ns.oid = p.pronamespace
     CROSS JOIN (VALUES ('anon'), ('authenticated')) AS r(papel)
     WHERE ns.nspname = 'public' AND has_function_privilege(r.papel, p.oid, 'EXECUTE'))
  SELECT count(*) INTO n FROM ((SELECT * FROM atual EXCEPT SELECT * FROM esperado)
                     UNION ALL (SELECT * FROM esperado EXCEPT SELECT * FROM atual)) d;
  IF n <> 0 THEN RAISE EXCEPTION 'anon/authenticated mudaram além das 6 (% pares papel×função)', n; END IF;
  -- e as 6 estavam MESMO abertas antes (12 pares saíram, não zero)
  SELECT count(*) INTO n FROM _au_antes WHERE oid IN (SELECT unnest(ARRAY['public.pagamentos_a_reconciliar()',
      'public.liberar_cobranca_do_pedido(uuid,text)','public.concluir_estorno(uuid,text,text,text)',
      'public.devolver_estoque(uuid)','public.expirar_pedidos_vencidos()',
      'public.devolver_cupons_de_pedidos_mortos()']::regprocedure[])::oid);
  IF n <> 12 THEN RAISE EXCEPTION 'esperava 12 pares abertos nas 6 antes, havia %', n; END IF;
  -- servidor: o conjunto de funções que ele NÃO executa é exatamente o de antes (nas duas direções)
  SELECT count(*) INTO n FROM (
    (SELECT p.oid FROM pg_proc p JOIN pg_namespace ns ON ns.oid = p.pronamespace
      WHERE ns.nspname = 'public' AND NOT has_function_privilege('service_role', p.oid, 'EXECUTE')
     EXCEPT SELECT oid FROM _sr_ausente_antes)
    UNION ALL
    (SELECT oid FROM _sr_ausente_antes
     EXCEPT SELECT p.oid FROM pg_proc p JOIN pg_namespace ns ON ns.oid = p.pronamespace
      WHERE ns.nspname = 'public' AND NOT has_function_privilege('service_role', p.oid, 'EXECUTE'))
  ) d;
  IF n <> 0 THEN RAISE EXCEPTION 'conjunto de ausências do servidor mudou em % funções', n; END IF;
  -- servidor executa as 8 de dinheiro
  FOR r IN SELECT unnest(ARRAY['public.pagamentos_a_reconciliar()','public.liberar_cobranca_do_pedido(uuid,text)',
      'public.concluir_estorno(uuid,text,text,text)','public.devolver_estoque(uuid)','public.expirar_pedidos_vencidos()',
      'public.devolver_cupons_de_pedidos_mortos()','public.confirmar_pagamento(uuid,text,text)',
      'public.devolver_uso_cupom(uuid)']) AS fn
  LOOP
    IF NOT has_function_privilege('service_role', r.fn::regprocedure, 'EXECUTE') THEN
      RAISE EXCEPTION 'servidor sem EXECUTE em %', r.fn; END IF;
  END LOOP;
END $$;

COMMIT;
