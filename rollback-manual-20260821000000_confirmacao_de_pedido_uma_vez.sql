-- Desfaz 20260821000000_confirmacao_de_pedido_uma_vez.sql
--
-- A migration e' aditiva: cria UMA coluna e DUAS funcoes novas. Nao altera
-- funcao existente, nao mexe em gatilho, nao toca em linha de pedido nenhuma.
--
-- ⚠️ A ORDEM IMPORTA. Se a edge function send-order-confirmation ja estiver
--    publicada quando isto rodar, ela passa a receber erro da RPC ausente e
--    devolve `envio_falhou` — o cliente para de receber confirmacao, e o
--    pedido continua sendo criado normalmente (o disparo e fire-and-forget).
--    Reverter de verdade e: despublicar ou reverter a function ANTES de rodar
--    este arquivo.
--
-- ⚠️ APAGAR A COLUNA PERDE INFORMACAO. `confirmation_email_sent_at` e' o unico
--    registro de quais pedidos ja tiveram e-mail reservado. Depois do DROP, uma
--    reaplicacao da migration comeca com todos nulos — ou seja, todo pedido
--    antigo vira candidato a receber e-mail de novo se algo o disparar. Por
--    isso o DROP da coluna esta COMENTADO: derrube as funcoes primeiro, veja se
--    resolve, e so' apague a coluna se tiver certeza.

DROP FUNCTION IF EXISTS public.reivindicar_email_de_confirmacao(uuid);
DROP FUNCTION IF EXISTS public.liberar_email_de_confirmacao(uuid);

-- ALTER TABLE public.marketplace_orders DROP COLUMN IF EXISTS confirmation_email_sent_at;
