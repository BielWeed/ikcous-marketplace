-- ============================================================================
-- Migration 20261349000000 — o pedido entregue antes da confirmação do PIX entra na reconciliação
-- (DINHEIRO; ADITIVA: um CREATE OR REPLACE de função, nenhum dado lido nem reescrito)
-- ============================================================================
--
-- 1. O QUE ESTAVA ERRADO
--
-- pagamentos_a_reconciliar() é a fila que o cron reconciliar-pagamentos (a cada 10 min) reconsulta no Mercado Pago. Ela
-- trazia o pedido "aguardando" só se o status do pedido fosse pending, processing ou shipping (e o cancelado/expirado).
-- O lojista pode marcar o pedido como ENTREGUE (retirada na loja) antes de a notificação do PIX chegar: o servidor deixa
-- o admin mudar o status sem exigir pagamento (20261198000000). Esse pedido ('delivered' + 'aguardando' + cobrança
-- gravada) NUNCA entrava na fila: ficava "aguardando pagamento" para sempre e o dinheiro, mesmo recebido, não entrava
-- no Financeiro.
--
-- 2. O QUE MUDA
--
-- 'delivered' entra nas DUAS listas de status do corpo: o filtro "vivo, e ainda dá para salvar" e a ordenação "vivo
-- primeiro". O resto do corpo (a janela de 24 h, os 14 dias do cartão, a cobrança terminal, o rodízio, o LIMIT 100) é
-- BYTE A BYTE o da 20261270000000, a menos de duas linhas de comentário. Assinatura, SECURITY DEFINER, search_path e ACL
-- ficam iguais (CREATE OR REPLACE preserva dono e privilégios; nenhum GRANT nem REVOKE aqui).
--
-- confirmar_pagamento já trata o pedido entregue: 'pago' grava payment_status e paid_at sem mudar o status nem o estoque,
-- 'recusado' e 'estornado' só marcam (prova 10 de tests/banco/pagamentos-rpc-viva.cjs). O que mudava era só a fila.
--
-- 3. DADOS EXISTENTES E REAPLICAÇÃO
--
-- Nenhuma linha é lida, comparada ou reescrita. Pedido entregue que JÁ estava preso como "aguardando" volta à fila no
-- próximo ciclo do cron, se ainda estiver dentro da janela de 24 h depois do expires_at (ou de 14 dias, se cartão); fora
-- dela continua como está (o PIX já não é pagável). Rodar duas vezes reescreve o MESMO texto (o pré-voo aceita o corpo da
-- 20261270000000 OU o desta migration).
--
-- 4. PRÉ-VOO E PÓS-VOO
--
-- Antes de escrever, recusa (B1_BASELINE_DIVERGENT) se a função não existe, tem sobrecarga, tem corpo que não seja UM de
-- dois conhecidos (md5 de replace(prosrc, E'\r', '')), ou atributos/ACL diferentes dos de sempre. Depois da troca confere o
-- hash novo, os atributos e a ACL; se algo divergir, a exceção desfaz a migration inteira (uma transação por arquivo, aberta
-- pelo aplicador; sem BEGIN/COMMIT aqui). Termina com NOTIFY pgrst.
--
-- 5. ORDEM
--
-- DEPOIS da 20261270000000 (o pré-voo recusa corpo anterior). Só banco: nenhuma edge muda. Valem IKCOUS e Savy; lojas de
-- teste ficam fora.
--
-- 6. ROLLBACK
--
-- rollback-manual-20261349000000_o_pedido_entregue_antes_da_confirmacao_entra_na_reconciliacao.sql devolve o corpo da
-- 20261270000000 byte a byte (md5 aed09ec910825168a3217b2e308824c5); recusa corpo ausente ou alterado por migration posterior. O pedido
-- entregue deixa de entrar na fila de novo (o defeito volta).
--
-- Hashes: corpo da 20261270000000 = aed09ec910825168a3217b2e308824c5; corpo desta migration = 350e732dbae6ba45bede77c08e0db6d8.
-- ============================================================================

DO $preflight_20261349$
DECLARE
  v_oid oid;
  v_hash text;
  v_public boolean;
BEGIN
  v_oid := to_regprocedure('public.pagamentos_a_reconciliar()');
  IF v_oid IS NULL THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: public.pagamentos_a_reconciliar() nao existe.';
  END IF;
  IF (SELECT count(*) FROM pg_proc p
       WHERE p.pronamespace = 'public'::regnamespace AND p.proname = 'pagamentos_a_reconciliar') <> 1 THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: public.pagamentos_a_reconciliar tem sobrecarga — meca a loja e revise antes de aplicar.';
  END IF;

  SELECT md5(replace(prosrc, E'\r', '')) INTO v_hash FROM pg_proc WHERE oid = v_oid;
  IF v_hash IS DISTINCT FROM 'aed09ec910825168a3217b2e308824c5' AND v_hash IS DISTINCT FROM '350e732dbae6ba45bede77c08e0db6d8' THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: o corpo vivo de pagamentos_a_reconciliar (hash %) nao e o da 20261270000000 nem o desta migration — aplique a 20261270000000 antes ou capture o corpo vivo e revise.', COALESCE(v_hash, 'ausente');
  END IF;

  -- Atributos e ACL de sempre: a ACL fica como esta (CREATE OR REPLACE a preserva; nenhum GRANT/REVOKE aqui).
  IF NOT EXISTS (
       SELECT 1 FROM pg_proc p JOIN pg_language l ON l.oid = p.prolang
        WHERE p.oid = v_oid
          AND l.lanname = 'sql'
          AND p.prosecdef
          AND p.provolatile = 'v'
          AND p.proretset
          AND NOT p.proisstrict
          AND p.pronargs = 0
          AND p.proconfig = ARRAY['search_path=public']::text[]
          AND pg_get_function_result(p.oid) = 'TABLE(order_id uuid, gateway_payment_id text)'
     ) THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: atributos de public.pagamentos_a_reconciliar() (linguagem, SECURITY DEFINER, volatilidade, search_path ou tipo de retorno) nao sao os conhecidos — meca a loja e revise antes de seguir.';
  END IF;
  v_public := EXISTS (SELECT 1 FROM pg_proc p
                        CROSS JOIN LATERAL aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) g
                       WHERE p.oid = v_oid AND g.privilege_type = 'EXECUTE' AND g.grantee = 0);
  IF v_public
     OR has_function_privilege('anon', v_oid, 'EXECUTE')
     OR has_function_privilege('authenticated', v_oid, 'EXECUTE')
     OR NOT has_function_privilege('service_role', v_oid, 'EXECUTE') THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: a ACL de public.pagamentos_a_reconciliar() nao e a de sempre (so o servidor executa) — meca a loja e revise antes de seguir.';
  END IF;
END $preflight_20261349$;

CREATE OR REPLACE FUNCTION public.pagamentos_a_reconciliar()
RETURNS TABLE (order_id uuid, gateway_payment_id text)
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public'
AS $candidatos$
    SELECT o.id, o.gateway_payment_id
      FROM public.marketplace_orders o
      LEFT JOIN public.reconciliacao_visitas v ON v.order_id = o.id
     WHERE o.gateway_payment_id IS NOT NULL
       AND o.paid_at IS NULL
       -- 24 h para todo mundo (passado isso o PIX não é mais pagável); 14
       -- dias para o cartão possivelmente vivo — análise manual do MP pode
       -- aprovar dias depois (D2, revisor financeiro: N = 14).
       AND (
             o.expires_at > now() - interval '24 hours'
          OR (
               o.expires_at > now() - interval '14 days'
               AND COALESCE(
                     o.gateway_payment_id LIKE 'verificando:%'
                     OR o.metodo_online IN ('credito', 'debito'),
                     false
                   )
             )
       )
       -- Cobrança que o MP já deu como terminal sai da fila; cobrança NOVA na
       -- vaga (outro id) volta na hora.
       AND (v.cobranca_terminal IS NULL OR v.cobranca_terminal <> o.gateway_payment_id)
       AND (
             -- morto por expiracao (20260808000100)
             o.payment_status = 'expirado'
             -- morto por cancelamento com a cobranca viva (20260812000000)
          OR (o.payment_status = 'aguardando' AND o.status = 'cancelled')
             -- VIVO, e ainda da' para salvar (20261010000000)
             -- O lojista pode ter fechado a entrega (retirada na loja) antes de a notificacao do
             -- PIX chegar: o status delivered tambem fica aguardando ate o MP confirmar (20261349000000).
          OR (o.payment_status = 'aguardando' AND o.status IN ('pending', 'processing', 'shipping', 'delivered'))
       )
     -- Vivo primeiro; depois rodízio (nunca visitado / visitado há mais
     -- tempo); por fim o mais novo (D3: o LIMIT não monopoliza mais a fila).
     ORDER BY (o.status IN ('pending', 'processing', 'shipping', 'delivered')) DESC, v.visitado_em ASC NULLS FIRST, o.expires_at DESC
     LIMIT 100;
$candidatos$;

DO $posvoo_20261349$
DECLARE
  v_oid oid := to_regprocedure('public.pagamentos_a_reconciliar()');
  v_hash text;
  v_public boolean;
BEGIN
  SELECT md5(replace(prosrc, E'\r', '')) INTO v_hash FROM pg_proc WHERE oid = v_oid;
  IF v_hash IS DISTINCT FROM '350e732dbae6ba45bede77c08e0db6d8' THEN
    RAISE EXCEPTION 'POSVOO_20261349000000: pagamentos_a_reconciliar nao ficou com o corpo desta migration (hash %)', COALESCE(v_hash, 'ausente');
  END IF;
  IF (SELECT count(*) FROM regexp_matches((SELECT prosrc FROM pg_proc WHERE oid = v_oid), '''delivered''', 'g')) <> 2 THEN
    RAISE EXCEPTION 'POSVOO_20261349000000: esperava ''delivered'' nas duas listas de status do corpo';
  END IF;

  -- Atributos e ACL de sempre: a ACL fica como esta (CREATE OR REPLACE a preserva; nenhum GRANT/REVOKE aqui).
  IF NOT EXISTS (
       SELECT 1 FROM pg_proc p JOIN pg_language l ON l.oid = p.prolang
        WHERE p.oid = v_oid
          AND l.lanname = 'sql'
          AND p.prosecdef
          AND p.provolatile = 'v'
          AND p.proretset
          AND NOT p.proisstrict
          AND p.pronargs = 0
          AND p.proconfig = ARRAY['search_path=public']::text[]
          AND pg_get_function_result(p.oid) = 'TABLE(order_id uuid, gateway_payment_id text)'
     ) THEN
    RAISE EXCEPTION 'POSVOO_20261349000000: atributos de public.pagamentos_a_reconciliar() (linguagem, SECURITY DEFINER, volatilidade, search_path ou tipo de retorno) nao sao os conhecidos — meca a loja e revise antes de seguir.';
  END IF;
  v_public := EXISTS (SELECT 1 FROM pg_proc p
                        CROSS JOIN LATERAL aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) g
                       WHERE p.oid = v_oid AND g.privilege_type = 'EXECUTE' AND g.grantee = 0);
  IF v_public
     OR has_function_privilege('anon', v_oid, 'EXECUTE')
     OR has_function_privilege('authenticated', v_oid, 'EXECUTE')
     OR NOT has_function_privilege('service_role', v_oid, 'EXECUTE') THEN
    RAISE EXCEPTION 'POSVOO_20261349000000: a ACL de public.pagamentos_a_reconciliar() nao e a de sempre (so o servidor executa) — meca a loja e revise antes de seguir.';
  END IF;
END $posvoo_20261349$;

-- A função é chamada pela edge reconciliar-pagamentos via PostgREST: recarrega o schema cache. Idempotente.
NOTIFY pgrst, 'reload schema';
