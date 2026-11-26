-- Rollback manual da 20261540000000 (a loja nova nasce com a ficha).
-- Tira SO a marca que a migration deixou no catalogo: o comentario de public.store_config volta a NULL (era NULL antes; o pre-voo da migration so
-- aplica sobre NULL ou sobre a propria marca). Com isso a 191a volta a reprovar e a 191b volta a passar, como antes do apply.
-- A FICHA FICA: a linha id = 1 de public.store_config NUNCA e' apagada aqui, de proposito. Apagar a ficha derruba a loja: o porteiro responde 503
-- "em manutencao" em todas as rotas, forma_de_pagamento_aceita recusa todo pedido, calculate-shipping quebra, credenciais-mercado-pago devolve
-- FICHA_NAO_EXISTE e read/save_store_identity levantam IDENTITY_MISSING. Alem disso, na loja que ja vende, a linha e' anterior a migration
-- (o INSERT nao fez nada ali) e guarda o que a lojista configurou; na loja nova ela pode ja ter sido preenchida pelo painel. Nao ha como saber,
-- pelo banco, qual linha "nasceu" desta migration, entao apagar seria apagar dado real. Por isso o rollback nao tem DELETE, UPDATE nem DROP.
-- PRE-VOO: recusa (B1_BASELINE_DIVERGENT) sem escrever se a tabela nao existe ou se o comentario for OUTRO texto que nao a marca (alguem comentou
-- a tabela depois: apagar levaria junto um comentario que nao e' desta migration). Estados aceitos: a marca (sai) ou NULL (rodar de novo e' no-op).
-- Conferencia final: o comentario e' NULL.
-- Executar pelo aplicar-migrations.yml (apaga o registro do ledger na mesma transacao). Sem BEGIN/COMMIT de nivel superior neste arquivo - regra
-- da casa. Rodar duas vezes deixa o mesmo estado.

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

DO $preflight_rollback_20261540000000$
BEGIN
  IF to_regclass('public.store_config') IS NULL THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: public.store_config ausente.';
  END IF;
  IF obj_description('public.store_config'::regclass, 'pg_class') IS NOT NULL
     AND obj_description('public.store_config'::regclass, 'pg_class') IS DISTINCT FROM 'ficha_da_loja_20261540000000' THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: o comentario de public.store_config nao e a marca da 20261540000000 (%); revise antes de apagar.',
      obj_description('public.store_config'::regclass, 'pg_class');
  END IF;
END $preflight_rollback_20261540000000$;

COMMENT ON TABLE public.store_config IS NULL;

DO $conferencia_rollback_20261540000000$
BEGIN
  IF obj_description('public.store_config'::regclass, 'pg_class') IS NOT NULL THEN
    RAISE EXCEPTION 'conferencia rollback 20261540000000: o comentario de public.store_config ainda existe';
  END IF;
END $conferencia_rollback_20261540000000$;
