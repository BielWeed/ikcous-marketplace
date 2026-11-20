-- As credenciais de frete só circulam pelo servidor: nem o admin do navegador
-- pode consultar ou alterar a tabela diretamente.
-- Preserva os dados e não muda os privilégios do papel de serviço.
--
-- O estado anterior esperado é o padrão do Supabase para tabelas em public.
-- Confira os GRANTs do banco vivo antes de aplicar; se o estado divergir,
-- o comando abaixo pode não reproduzir as permissões anteriores.
-- Rollback do estado padrão:
-- GRANT ALL ON TABLE public.store_shipping_credentials TO anon, authenticated;

REVOKE ALL ON TABLE public.store_shipping_credentials FROM anon, authenticated;
