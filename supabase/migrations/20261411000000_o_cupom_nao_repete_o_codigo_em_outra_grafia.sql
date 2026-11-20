-- Validacao do cupom e criacao do pedido comparam upper(code). Uma so linha
-- pode representar cada codigo, inclusive quando o cupom estiver inativo.
-- Preserva a UNIQUE(code), as linhas existentes e os corpos das funcoes.
-- O aplicador abre a transacao; SHARE bloqueia escritas durante a checagem
-- e a criacao do indice, mas permite leituras dos cupons.
SET LOCAL lock_timeout = '5s';

DO $preflight$
BEGIN
  LOCK TABLE public.coupons IN SHARE MODE;

  IF row_security_active('public.coupons'::regclass) THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: papel sem visibilidade de todos os cupons.';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.coupons
    GROUP BY pg_catalog.upper(code)
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: trate as colisoes de codigos de cupom antes de aplicar a migration.';
  END IF;

  CREATE UNIQUE INDEX IF NOT EXISTS coupons_code_upper_uidx
    ON public.coupons (pg_catalog.upper(code));

  -- IF NOT EXISTS casa pelo nome, nao pela definicao.
  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_index i
    JOIN pg_catalog.pg_class idx ON idx.oid = i.indexrelid
    JOIN pg_catalog.pg_am am ON am.oid = idx.relam
    JOIN pg_catalog.pg_attribute col ON col.attrelid = i.indrelid
      AND col.attname = 'code' AND col.attnum > 0 AND NOT col.attisdropped
    JOIN pg_catalog.pg_opclass op ON op.oid = i.indclass[0]
    WHERE i.indexrelid = to_regclass('public.coupons_code_upper_uidx')
      AND i.indrelid = to_regclass('public.coupons')
      AND i.indisunique AND i.indisvalid AND i.indisready AND i.indislive
      AND i.indnatts = 1 AND i.indnkeyatts = 1 AND i.indpred IS NULL
      AND pg_get_expr(i.indexprs, i.indrelid) = 'upper(code)'
      AND am.amname = 'btree' AND i.indcollation[0] = col.attcollation
      AND op.opcnamespace = 'pg_catalog'::regnamespace AND op.opcname = 'text_ops'
  ) THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: indice de codigo do cupom tem definicao inesperada.';
  END IF;
EXCEPTION WHEN unique_violation THEN
  -- No workflow aplicar-migrations.yml (REPEATABLE READ), uma escrita entre
  -- a foto da transacao e o LOCK pode escapar da consulta, mas nao do indice.
  -- No db-apply.cjs (READ COMMITTED), a consulta ja ve as escritas confirmadas
  -- antes de obter o LOCK. Nao devolva o codigo no erro.
  RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: trate as colisoes de codigos de cupom antes de aplicar a migration.';
END;
$preflight$;
