-- Desfaz 20260820000000_otp_v2_devolve_o_codigo.sql
--
-- A migration e' puramente aditiva: cria UMA funcao nova e define os grants
-- dela. Nao toca na tabela otp_verifications, nao toca na v1, nao toca em
-- gatilho nenhum. Por isso o desfazer e' um DROP so'.
--
-- ATENCAO AO ALCANCE: se a edge function send-otp-email ja estiver publicada
-- na versao nova quando isto rodar, ela passa a receber erro da RPC ausente e
-- devolve `envio_falhou` para a tela. Reverter de verdade e' apagar esta funcao
-- E republicar a versao anterior da function.

DROP FUNCTION IF EXISTS public.generate_order_otp_v2(text, text, text);
