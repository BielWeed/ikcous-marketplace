-- Fase 3: quem o webhook perdeu.
-- SEM BEGIN/COMMIT: o db-apply.cjs abre a transacao.

-- 1. So SELECIONA candidatos. Nao decide nada -------------------------
-- A decisao mora inteira na confirmar_pagamento. Se esta funcao decidisse,
-- existiriam DOIS codigos movendo estoque a partir de status de pagamento, e
-- eles divergiriam em tres meses — como a regra de frete gratis, que chegou a
-- estar escrita em sete lugares (#53).
CREATE OR REPLACE FUNCTION public.pagamentos_a_reconciliar()
RETURNS TABLE (order_id uuid, gateway_payment_id text)
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public'
AS $candidatos$
    SELECT id, gateway_payment_id
      FROM public.marketplace_orders
     WHERE payment_status = 'expirado'
       AND gateway_payment_id IS NOT NULL
       AND paid_at IS NULL
       -- 24 h: depois disso o PIX ja nao e' pagavel e a janela vira varredura
       -- do historico inteiro a cada 10 minutos.
       AND expires_at > now() - interval '24 hours'
     ORDER BY expires_at
     LIMIT 100;
$candidatos$;

REVOKE ALL ON FUNCTION public.pagamentos_a_reconciliar()
  FROM PUBLIC, anon, authenticated;

-- 2. pg_net + agendamento ---------------------------------------------
-- Medido em 09/08/2026, antes de aplicar: NENHUMA extensao e' nova aqui.
-- pg_cron ja veio da 20260807000001_agenda_expiracao.sql, e o pg_net JA
-- ESTAVA instalado (0.19.5, no namespace `extensions`, funcoes no schema
-- `net`) — a linha abaixo e' no-op.
--
-- Fica escrita mesmo assim, para a migration ser auto-suficiente em um banco
-- que ainda nao tenha o pg_net. Mas o registro honesto e' este: aplicar isto
-- em producao NAO ligou extensao nenhuma. Se alguem for avaliar o risco desta
-- migration depois, o risco esta no agendamento abaixo, nao aqui.
CREATE EXTENSION IF NOT EXISTS pg_net;

-- Remove agendamento anterior de mesmo nome, para a migration ser
-- reaplicavel — mesmo padrao da 20260807000001_agenda_expiracao.sql.
SELECT cron.unschedule('reconciliar-pagamentos')
WHERE EXISTS (
  SELECT 1 FROM cron.job WHERE jobname = 'reconciliar-pagamentos'
);

-- O segredo NAO fica em texto aqui: sai do Vault na hora da chamada. E nao e'
-- a service_role — e' um RECONCILIACAO_SECRET dedicado, cujo pior caso ao
-- vazar e' alguem disparar uma reconciliacao, que so pergunta ao MP e chama a
-- confirmar_pagamento (idempotente). Os dois segredos
-- (reconciliacao_url e reconciliacao_secret) sao criados FORA desta
-- migration, com vault.create_secret — nao existem em texto neste arquivo.
--
-- net.http_post(url text, body jsonb, params jsonb, headers jsonb,
-- timeout_milliseconds int) — assinatura confirmada na documentacao do
-- pg_net (Passo 1 do brief); os nomes dos parametros usados abaixo (url,
-- headers, body) e vault.decrypted_secrets batem com o que a documentacao
-- devolveu, sem divergencia em relacao ao rascunho do brief.
SELECT cron.schedule(
    'reconciliar-pagamentos',
    '*/10 * * * *',
    $cron$
    SELECT net.http_post(
        url     := (SELECT decrypted_secret FROM vault.decrypted_secrets
                     WHERE name = 'reconciliacao_url'),
        headers := jsonb_build_object(
            'Content-Type', 'application/json',
            'x-reconciliacao-secret',
            (SELECT decrypted_secret FROM vault.decrypted_secrets
              WHERE name = 'reconciliacao_secret')
        ),
        body    := '{}'::jsonb
    ) AS request_id;
    $cron$
);

-- Botao de desligar, se o job se comportar mal (comentario, nao instrucao
-- executavel):
-- SELECT cron.unschedule('reconciliar-pagamentos');
