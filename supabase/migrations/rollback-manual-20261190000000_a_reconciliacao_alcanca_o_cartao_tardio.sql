-- ============================================================================
-- Rollback manual — a reconciliação alcança o cartão tardio (20261190000000)
-- ============================================================================
-- Desfaz a 20261190000000 inteira, nesta ordem:
--   1. restaura, byte a byte, o corpo de `public.pagamentos_a_reconciliar`
--      que a 20261010000000 deixou (janela de 24 h para todos, sem rodízio,
--      sem marca terminal) — ANTES de apagar a tabela, porque o corpo novo lê
--      `reconciliacao_visitas`;
--   2. apaga `public.marcar_visitas_da_reconciliacao(uuid[], uuid[], text[])`;
--   3. apaga `public.reconciliacao_visitas` — SÓ metadado de visita (quando o
--      cron olhou cada pedido e qual cobrança o MP deu como terminal); nenhum
--      dado de dinheiro, de pedido ou de cliente se perde;
--   4. devolve o COMMENT de `liberar_cobranca_do_pedido` da 20261176000000.
-- ACL: a da fila e a de `liberar_cobranca_do_pedido` não são tocadas
-- (`CREATE OR REPLACE`/`COMMENT` preservam a ACL vigente).
--
-- Depois do rollback os defeitos voltam: cartão aprovado mais de 24 h depois
-- de `expires_at` com a notificação perdida não é mais encontrado (D2), e o
-- LIMIT 100 volta a poder deixar o candidato mais velho de fora (D3).
-- Se a edge `reconciliar-pagamentos` nova estiver publicada, ela passa a
-- logar o erro do carimbo a cada ciclo (não fatal) — reverta a edge junto.
--
-- PRÉ-VOO: o `DO $preflight_rollback_20261190$` recusa com
-- `B1_BASELINE_DIVERGENT` se o corpo VIVO da fila não for o que a
-- 20261190000000 deixou (`a8aae3c132cac141c27091a4e3648cf4`, md5 de `replace(prosrc, E'\r', '')`),
-- se a RPC de carimbo não for a dela (`072dca9dd2f0d0a2911b69f72fc8f5c0`), ou se o COMMENT de
-- `liberar_cobranca_do_pedido` não for o dela: desfazer por cima de uma
-- redefinição POSTERIOR apagaria a dela em silêncio, e desfazer duas vezes não
-- tem o que desfazer. Mesma transação do restante: recusa = nada gravado.
--
-- Executar via `psql -1 -f` (nunca pelo db-apply, que registraria este
-- rollback no ledger de migrations como se fosse uma migration nova). Sem
-- BEGIN/COMMIT de nível superior neste arquivo — regra da casa.
-- ============================================================================

DO $preflight_rollback_20261190$
DECLARE
  v_hash text;
BEGIN
  SELECT md5(replace(prosrc, E'\r', '')) INTO v_hash
    FROM pg_proc
   WHERE oid = to_regprocedure('public.pagamentos_a_reconciliar()');

  IF v_hash IS DISTINCT FROM 'a8aae3c132cac141c27091a4e3648cf4' THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: corpo vivo de pagamentos_a_reconciliar (hash %) não é o que a 20261190000000 deixou — nada a desfazer, ou uma redefinição posterior está no ar; revise antes de reverter.', COALESCE(v_hash, 'ausente');
  END IF;

  IF (SELECT md5(replace(prosrc, E'\r', ''))
        FROM pg_proc
       WHERE oid = to_regprocedure('public.marcar_visitas_da_reconciliacao(uuid[], uuid[], text[])'))
     IS DISTINCT FROM '072dca9dd2f0d0a2911b69f72fc8f5c0' THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: public.marcar_visitas_da_reconciliacao ausente ou não é a da 20261190000000 — revise antes de reverter.';
  END IF;

  IF obj_description(to_regprocedure('public.liberar_cobranca_do_pedido(uuid, text)'), 'pg_proc')
     IS DISTINCT FROM
    'Cartão recusado não mata o pedido: solta a vaga da cobrança (se ainda for a '
    'gravada, com o pedido aguardando e sem pagamento) e conta a tentativa. Sem '
    'id, só conta. Só o service role (edges criar-pagamento, webhook e '
    'reconciliação) executa. INVARIANTE: só esta RPC (liberar_cobranca_do_pedido) '
    'esvazia a vaga, e só por prova ou cancelamento confirmado — as adoções do '
    'webhook e da reconciliação TROCAM a vaga (UPDATE condicional pelo valor '
    'antigo), nunca a esvaziam.'
  THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: o COMMENT de liberar_cobranca_do_pedido não é o da 20261190000000 — revise antes de reverter.';
  END IF;
END $preflight_rollback_20261190$;

CREATE OR REPLACE FUNCTION public.pagamentos_a_reconciliar()
RETURNS TABLE (order_id uuid, gateway_payment_id text)
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public'
AS $candidatos$
    SELECT id, gateway_payment_id
      FROM public.marketplace_orders
     WHERE gateway_payment_id IS NOT NULL
       AND paid_at IS NULL
       -- 24 h: depois disso o PIX ja nao e' pagavel e a janela vira varredura
       -- do historico inteiro a cada 10 minutos. Vale para os TRES ramos do
       -- OR abaixo, pelo mesmo motivo.
       AND expires_at > now() - interval '24 hours'
       AND (
             -- morto por expiracao (20260808000100)
             payment_status = 'expirado'
             -- morto por cancelamento do cliente com o QR na mao (20260812000000)
          OR (payment_status = 'aguardando' AND status = 'cancelled')
             -- VIVO, e ainda da' para salvar (26/08/2026, achado PEDIDO-01).
             -- Este e' o unico ramo que PREVINE a perda em vez de registra-la.
          OR (payment_status = 'aguardando' AND status = 'pending')
       )
     ORDER BY expires_at DESC
     LIMIT 100;
$candidatos$;

DROP FUNCTION public.marcar_visitas_da_reconciliacao(uuid[], uuid[], text[]);

DROP TABLE public.reconciliacao_visitas;

COMMENT ON FUNCTION public.liberar_cobranca_do_pedido(uuid, text) IS
  'Cartão recusado não mata o pedido: solta a vaga da cobrança (se ainda for a '
  'gravada, com o pedido aguardando e sem pagamento) e conta a tentativa. Sem '
  'id, só conta. Só o service role (edges criar-pagamento, webhook e '
  'reconciliação) executa.';
