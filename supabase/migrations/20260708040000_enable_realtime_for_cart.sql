-- Enable Realtime replication for cart_items table
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 
        FROM pg_publication_tables 
        WHERE pubname = 'supabase_realtime' 
          AND schemaname = 'public' 
          AND tablename = 'cart_items'
    ) THEN
        ALTER PUBLICATION supabase_realtime ADD TABLE public.cart_items;
    END IF;
END $$;
