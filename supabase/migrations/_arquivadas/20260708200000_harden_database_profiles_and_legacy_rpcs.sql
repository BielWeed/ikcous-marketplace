-- Migration: Harden Database Profiles and Drop Legacy WhatsApp RPCs
-- Date: 2026-07-08
-- Version: 20260708200000

BEGIN;

-- 1. Restabelecer a função de proteção de privilégios para a tabela profiles
CREATE OR REPLACE FUNCTION public.ensure_role_protection()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    -- Só aplicar a validação se a alteração for feita por uma sessão de cliente (auth.uid() não nulo e role diferente de service_role)
    IF (auth.uid() IS NOT NULL) AND (auth.role() <> 'service_role') AND (OLD.role IS DISTINCT FROM NEW.role) THEN
        -- Se o executor da mudança não for um administrador confirmado
        IF NOT EXISTS (
            SELECT 1 FROM public.profiles
            WHERE id = auth.uid()
            AND role = 'admin'
        ) THEN
            -- Reverter a alteração da coluna role para o valor anterior
            NEW.role := OLD.role;
        END IF;
    END IF;
    RETURN NEW;
END;
$$;

-- 2. Aplicar o trigger BEFORE UPDATE na tabela profiles
DROP TRIGGER IF EXISTS tr_ensure_role_protection ON public.profiles;
CREATE TRIGGER tr_ensure_role_protection
BEFORE UPDATE ON public.profiles
FOR EACH ROW
EXECUTE FUNCTION public.ensure_role_protection();

-- 3. Remover RPCs legadas e inseguras para reduzir a superfície de ataque
DROP FUNCTION IF EXISTS public.get_orders_by_whatsapp(TEXT, TEXT);
DROP FUNCTION IF EXISTS public.get_orders_by_whatsapp_v2(TEXT, TEXT, TEXT);

COMMIT;
