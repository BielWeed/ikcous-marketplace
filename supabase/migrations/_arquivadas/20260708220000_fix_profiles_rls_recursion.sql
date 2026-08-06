-- Migration: Fix Profiles RLS Recursion by Syncing Roles to auth.users Metadata
-- Date: 2026-07-08
-- Version: 20260708220000

BEGIN;

-- 1. Sincronizar roles existentes de profiles para auth.users
UPDATE auth.users u
SET
    raw_app_meta_data
    = coalesce(raw_app_meta_data, '{}'::jsonb)
    || jsonb_build_object('role', p.role)
FROM public.profiles AS p
WHERE u.id = p.id;

-- 2. Função de trigger para sincronização contínua de papel
CREATE OR REPLACE FUNCTION public.handle_profile_role_sync_to_auth()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
BEGIN
    UPDATE auth.users
    SET raw_app_meta_data = coalesce(raw_app_meta_data, '{}'::jsonb) || jsonb_build_object('role', NEW.role)
    WHERE id = NEW.id;
    RETURN NEW;
END;
$$;

-- 3. Trigger na tabela profiles
DROP TRIGGER IF EXISTS tr_sync_profile_role_to_auth ON public.profiles;
CREATE TRIGGER tr_sync_profile_role_to_auth
AFTER INSERT OR UPDATE OF role ON public.profiles
FOR EACH ROW
EXECUTE FUNCTION public.handle_profile_role_sync_to_auth();

-- 4. Redefinir a função is_admin() para usar os metadados do auth.users / JWT claims (sem tocar na tabela profiles)
CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
STABLE
AS $$
DECLARE
  v_role text;
BEGIN
  -- Se executado na sessão como postgres/service_role diretamente, autorizar
  IF current_setting('role', true) IN ('postgres', 'service_role') THEN
    RETURN true;
  END IF;

  -- 1º tentar ler dos claims do JWT (mais rápido)
  IF (current_setting('request.jwt.claims', true) IS NOT NULL AND current_setting('request.jwt.claims', true) <> '') THEN
    v_role := (current_setting('request.jwt.claims', true)::jsonb -> 'app_metadata' ->> 'role');
    IF v_role = 'admin' THEN
      RETURN true;
    END IF;
  END IF;

  -- 2º Fallback: consultar a tabela auth.users diretamente (sem RLS)
  RETURN EXISTS (
    SELECT 1 FROM auth.users
    WHERE id = (SELECT auth.uid())
    AND (raw_app_meta_data ->> 'role') = 'admin'
  );
END;
$$;

COMMIT;
