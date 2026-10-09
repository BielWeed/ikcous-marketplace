-- ============================================================================
-- Rollback manual -- a venda do balcao se anula no mesmo dia (20261204000000)
-- ============================================================================
-- Derruba a funcao `public.anular_venda_presencial(uuid, text)` -- o unico
-- objeto que a migration criou. Nenhuma linha de dado e' tocada: a venda que
-- ja foi anulada continua como FATO (status cancelled, payment_status
-- estornado, estoque devolvido, historicos e a entrada/saida do Financeiro);
-- o que deixa de existir e' so o botao "Anular venda".
--
-- O QUE VOLTA A VALER: a venda do balcao registrada errada volta a nao ter
-- conserto pelo app (a tela mostra "A anulacao ainda nao esta liberada neste
-- servidor").
--
-- GUARDA DE ORDEM: so derruba se o corpo vivo for o desta migration (LF ou
-- CRLF). Qualquer outro corpo e' de uma migration POSTERIOR que a redefiniu:
-- derrubar por baixo apagaria a guarda dela em silencio. Rollback repetido (a
-- funcao ja nao existe) e' idempotente: nao faz nada.
--
-- Executar via `psql -1 -f` (nunca pelo db-apply). Sem BEGIN/COMMIT de nivel
-- superior neste arquivo -- regra da casa.
-- ============================================================================

DO $guarda_rollback_20261204$
DECLARE
  v_hash text;
BEGIN
  SELECT encode(sha256(convert_to(prosrc, 'UTF8')), 'hex') INTO v_hash
    FROM pg_proc
   WHERE oid = to_regprocedure('public.anular_venda_presencial(uuid, text)');
  IF v_hash IS NOT NULL AND v_hash NOT IN (
    'f7d50fc4e53536209d265b9b8acb7bc5df327b131523a015bb7a29549b577701',
    'c6a471f446010427d0f43fd8a3976b8005c3d8da054b59876bf68679f3182cdc'
  ) THEN
    RAISE EXCEPTION 'corpo vivo de anular_venda_presencial (hash %) nao e o da 20261204000000 -- uma migration posterior o redefiniu; reverta-a antes.', v_hash;
  END IF;
END $guarda_rollback_20261204$;

DROP FUNCTION IF EXISTS public.anular_venda_presencial(uuid, text);
