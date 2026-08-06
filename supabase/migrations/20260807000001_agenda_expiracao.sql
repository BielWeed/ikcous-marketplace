-- Agendamento da expiracao (CHECKOUT-010 #109). SEM BEGIN/COMMIT.
CREATE EXTENSION IF NOT EXISTS pg_cron;

-- Remove agendamento anterior de mesmo nome, para a migration ser reaplicavel.
SELECT cron.unschedule('expirar-pedidos-vencidos')
WHERE EXISTS (
  SELECT 1 FROM cron.job WHERE jobname = 'expirar-pedidos-vencidos'
);

SELECT cron.schedule(
  'expirar-pedidos-vencidos',
  '*/5 * * * *',
  $cron$ SELECT public.expirar_pedidos_vencidos(); $cron$
);

-- Botao de desligar, se a varredura se comportar mal (comentario, nao
-- instrucao executavel):
-- SELECT cron.unschedule('expirar-pedidos-vencidos');
