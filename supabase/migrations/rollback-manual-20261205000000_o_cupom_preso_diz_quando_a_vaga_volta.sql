-- ============================================================================
-- Rollback manual -- o cupom preso diz quando a vaga volta (20261205000000)
-- ============================================================================
-- Derruba as DUAS funcoes que a migration criou: `public.vaga_do_cupom_presa(text)`
-- e `public.cupom__vaga_volta_em(...)`. Nenhuma linha de dado e' tocada, e a
-- varredura `devolver_cupons_de_pedidos_mortos()` nao e' alterada (a 20261205
-- nao a redefine).
--
-- O QUE VOLTA A VALER: a tela do checkout deixa de ter a RPC para explicar a
-- recusa por limite de uso (a chamada falha com PGRST202 e o front mostra a
-- frase de sempre: "Cupom atingiu o limite de uso.").
--
-- GUARDA DE ORDEM: so derruba se
--   (1) o corpo vivo de cada funcao for o desta migration (LF ou CRLF): outro
--       corpo e' de uma migration POSTERIOR que a redefiniu, e derrubar por baixo
--       apagaria a guarda dela em silencio;
--   (2) a varredura ainda for a da 20260970000000. A 20261206000000 a reescreve
--       para chamar o auxiliar: derrubar o auxiliar por baixo faria a varredura
--       falhar a cada ciclo (a vaga dos cupons pararia de voltar). Reverta a
--       20261206000000 ANTES.
-- Rollback repetido (as funcoes ja nao existem) e' idempotente: nao faz nada.
--
-- Executar via `psql -1 -f` (nunca pelo db-apply). Sem BEGIN/COMMIT de nivel
-- superior neste arquivo -- regra da casa.
-- ============================================================================

DO $guarda_rollback_20261205$
DECLARE
  v_hash text;
BEGIN
  SELECT encode(sha256(convert_to(prosrc, 'UTF8')), 'hex') INTO v_hash
    FROM pg_proc
   WHERE oid = to_regprocedure('public.cupom__vaga_volta_em(uuid, text, text, boolean, timestamptz, boolean, timestamptz, text, integer)');
  IF v_hash IS NOT NULL AND v_hash NOT IN (
    'e92200a0af3c3dfa4051e0076ae9ba184476678f9bc2484a369d317d745f534d',
    '865c4de58c2fbc272c41f5d0ab03deb1410b6a9d6ce8fd3762659e2c28e15a3d'
  ) THEN
    RAISE EXCEPTION 'corpo vivo de cupom__vaga_volta_em (hash %) nao e o da 20261205000000 -- uma migration posterior o redefiniu; reverta-a antes.', v_hash;
  END IF;

  SELECT encode(sha256(convert_to(prosrc, 'UTF8')), 'hex') INTO v_hash
    FROM pg_proc
   WHERE oid = to_regprocedure('public.vaga_do_cupom_presa(text)');
  IF v_hash IS NOT NULL AND v_hash NOT IN (
    'b49a93a797b99545b6fbbcd326e39873d9b82c398b3c7fed75ab4bcdbed0cc5a',
    '981ad73ca42caee38cf8d81cfadc04c8175234db02c42e56868323a90269d59d'
  ) THEN
    RAISE EXCEPTION 'corpo vivo de vaga_do_cupom_presa (hash %) nao e o da 20261205000000 -- uma migration posterior o redefiniu; reverta-a antes.', v_hash;
  END IF;

  SELECT encode(sha256(convert_to(prosrc, 'UTF8')), 'hex') INTO v_hash
    FROM pg_proc
   WHERE oid = to_regprocedure('public.devolver_cupons_de_pedidos_mortos()');
  IF v_hash IS NOT NULL AND v_hash NOT IN (
    '85a340abad3fb3f3cd913f50126bc610f584076295bbb61a8203fabcbd6c0633',
    'd0b285fdb3d939243e4399e69e04bbd1bead56ab231079199cac2ed56b3ea0ae'
  ) THEN
    RAISE EXCEPTION 'a varredura devolver_cupons_de_pedidos_mortos (hash %) nao e a da 20260970000000 -- uma migration posterior (a 20261206000000) a redefiniu e ela usa o auxiliar; reverta-a antes.', v_hash;
  END IF;
END $guarda_rollback_20261205$;

DROP FUNCTION IF EXISTS public.vaga_do_cupom_presa(text);
DROP FUNCTION IF EXISTS public.cupom__vaga_volta_em(uuid, text, text, boolean, timestamptz, boolean, timestamptz, text, integer);
