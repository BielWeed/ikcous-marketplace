-- Enable Realtime replication for favorites table
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 
        FROM pg_publication_tables 
        WHERE pubname = 'supabase_realtime' 
          AND schemaname = 'public' 
          AND tablename = 'favorites'
    ) THEN
        ALTER PUBLICATION supabase_realtime ADD TABLE public.favorites;
    END IF;
END $$;
