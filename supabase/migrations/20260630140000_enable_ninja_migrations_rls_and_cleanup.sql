-- Migration to enable RLS on _ninja_migrations and clean up obsolete service_role key
BEGIN;

-- 1. Ativar RLS na tabela _ninja_migrations
ALTER TABLE public._ninja_migrations ENABLE ROW LEVEL SECURITY;

-- 2. Limpar a chave service_role obsoleta da tabela app_settings
DELETE FROM public.app_settings
WHERE key = 'supabase_service_role_key';

COMMIT;
