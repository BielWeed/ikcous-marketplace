-- O caminho antigo do codigo de verificacao sai de cena.
--
-- ⚠️ ORDEM DE APLICACAO: esta migration so pode rodar DEPOIS de a edge function
--    nova e o front novo estarem no ar. Enquanto a producao rodar o front
--    antigo, e a v1 + o gatilho que atendem — aplicar antes derruba o codigo de
--    verificacao de convidado ate o deploy alcancar.
--
-- O QUE SAI, E POR QUE CADA PECA
--
--   on_otp_created_send_email / handle_new_otp_verification
--     O gatilho que enfileirava o e-mail com net.http_post. E' a peca que
--     tornava IMPOSSIVEL saber se o envio aconteceu (#86): a fila e' processada
--     depois do commit, e a RPC ja retornou. Nenhuma troca de provedor de
--     e-mail conserta isso — so' inverter quem chama. Sem o gatilho, quem envia
--     e' quem foi chamado, e responde.
--
--   EXECUTE de anon/authenticated na v1
--     O navegador nao chama mais a v1. Deixar o EXECUTE aberto manteria de pe
--     um caminho que GRAVA codigo e nao envia e-mail nenhum — o codigo ficaria
--     valido por 15 minutos na tabela, sem ninguem para entregar.
--
-- O QUE NAO SAI, E POR QUE
--
--   A funcao generate_order_otp_v1 continua existindo, sem grant para o
--   navegador. Apaga-la aqui deixaria a producao sem caminho nenhum se o deploy
--   do front precisasse ser revertido. Vira divida com issue propria.
--
--   O segredo otp_trigger_secret no Vault e o OTP_TRIGGER_SECRET nos segredos
--   da edge function tambem ficam, pelo mesmo motivo: sao a credencial que o
--   caminho antigo usa, e o caminho antigo tem de continuar reversivel ate a
--   proxima release fechar. Limpeza a parte.

DROP TRIGGER IF EXISTS "on_otp_created_send_email" ON public.otp_verifications;

DROP FUNCTION IF EXISTS public.handle_new_otp_verification();

REVOKE EXECUTE ON FUNCTION public.generate_order_otp_v1(text, text, text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.generate_order_otp_v1(text, text, text) FROM authenticated;

COMMENT ON FUNCTION public.generate_order_otp_v1(text, text, text) IS
'APOSENTADA em 19/08/2026 pela inversao do envio (#161 + #86). Continua existindo so como caminho de volta caso o deploy do front precise ser revertido; nenhum cliente a alcanca, porque anon e authenticated perderam o EXECUTE. Quem vale e a generate_order_otp_v2, que devolve o codigo para a edge function enviar. Apagar esta funcao e divida separada.';
