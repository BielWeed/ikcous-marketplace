-- Enable Realtime replication for all monitored/subscribed tables in the application
DO $$
DECLARE
    t TEXT;
    tables_to_add TEXT[] := ARRAY['produtos', 'categorias', 'banners', 'store_config', 'coupons', 'product_variants', 'questions', 'answers'];
BEGIN
    FOREACH t IN ARRAY tables_to_add LOOP
        IF NOT EXISTS (
            SELECT 1 
            FROM pg_publication_tables 
            WHERE pubname = 'supabase_realtime' 
              AND schemaname = 'public' 
              AND tablename = t
        ) THEN
            EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I', t);
        END IF;
    END LOOP;
END $$;
