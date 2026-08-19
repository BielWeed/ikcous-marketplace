-- Identidade da loja sai do código e passa a morar no banco.
--
-- Ate aqui, nome e cidade da loja viviam em src/config/branding.json (198 bytes,
-- editavel so por quem mexe no repositorio) e em 26 pontos de codigo com a string
-- "Monte Carmelo" cravada. Toda loja montada a partir deste molde herdava a cidade
-- errada, e o app preenchia o endereco do cliente com ela sem avisar.
--
-- As tres colunas nascem NULAS e SEM DEFAULT de proposito: nulo e o estado
-- "a loja ainda nao disse", e o app passa a exibir ausencia em vez de inventar.

ALTER TABLE public.store_config
  ADD COLUMN IF NOT EXISTS store_name  text,
  ADD COLUMN IF NOT EXISTS store_city  text,
  ADD COLUMN IF NOT EXISTS store_state text;

COMMENT ON COLUMN public.store_config.store_name  IS 'Nome da loja exibido ao cliente. NULO = a loja ainda nao configurou; a tela omite, nunca inventa.';
COMMENT ON COLUMN public.store_config.store_city  IS 'Cidade de onde a loja opera. NULO = nao configurado; a tela omite o trecho de localizacao.';
COMMENT ON COLUMN public.store_config.store_state IS 'UF de onde a loja opera. NULO = nao configurado.';

-- origin_cep tinha DEFAULT '38500-000': loja nova nascia dizendo que despacha de
-- Monte Carmelo sem ninguem ter informado isso, e o calculo de frete usava esse CEP
-- calado. Tirar o DEFAULT nao altera nenhuma linha existente.
ALTER TABLE public.store_config
  ALTER COLUMN origin_cep DROP DEFAULT;
