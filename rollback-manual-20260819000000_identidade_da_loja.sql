-- Desfaz 20260819000000_identidade_da_loja.sql

ALTER TABLE public.store_config
  DROP COLUMN IF EXISTS store_name,
  DROP COLUMN IF EXISTS store_city,
  DROP COLUMN IF EXISTS store_state;

ALTER TABLE public.store_config
  ALTER COLUMN origin_cep SET DEFAULT '38500-000'::text;
