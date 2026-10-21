-- Rollback manual da 20261290000000.
-- Restaura a definicao e o REVOKE da 20261177000000, byte a byte.
-- Volta a classificar online sem metodo como PIX; nenhum pedido e reescrito.
-- Pre-voo: recusa corpo ausente, posterior ou ja revertido.
-- Executar pelo aplicar-migrations.yml: o ledger e removido na mesma transacao.
-- Sem BEGIN/COMMIT: a transacao pertence ao aplicador.
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

DO $preflight_rollback_20261290$
DECLARE
  v_hash text;
BEGIN
  SELECT md5(replace(prosrc, E'\r', '')) INTO v_hash
    FROM pg_proc
   WHERE oid = to_regprocedure('public.fin__forma_do_pedido(text,text)');

  IF v_hash IS DISTINCT FROM 'c147541bc85f640161025e4c9ca8c8c3' THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: corpo vivo de fin__forma_do_pedido (hash %) nao e o que a 20261290000000 deixou -- nada a desfazer, ou uma redefinicao posterior esta no ar; revise antes de reverter.', COALESCE(v_hash, 'ausente');
  END IF;
END $preflight_rollback_20261290$;

CREATE OR REPLACE FUNCTION public.fin__forma_do_pedido(p_payment_method text, p_metodo_online text)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path = public
AS $$
  SELECT CASE p_payment_method
    WHEN 'online' THEN COALESCE(p_metodo_online, 'pix')
    WHEN 'cash' THEN 'dinheiro'
    WHEN 'pix' THEN 'pix'
    WHEN 'card' THEN 'cartao'
    ELSE 'outro'
  END
$$;
REVOKE ALL ON FUNCTION public.fin__forma_do_pedido(text, text) FROM PUBLIC, anon, authenticated;
