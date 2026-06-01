BEGIN;

-- 1. Remover trigger
DROP TRIGGER IF EXISTS on_order_created_whatsapp ON public.marketplace_orders;

-- 2. Remover função de trigger
DROP FUNCTION IF EXISTS public.handle_new_order_whatsapp();

-- 3. Remover colunas obsoletas da store_config
ALTER TABLE public.store_config DROP COLUMN IF EXISTS whatsapp_api_url;
ALTER TABLE public.store_config DROP COLUMN IF EXISTS whatsapp_api_key;
ALTER TABLE public.store_config DROP COLUMN IF EXISTS whatsapp_api_instance;

COMMIT;
