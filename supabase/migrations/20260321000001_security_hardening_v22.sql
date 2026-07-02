-- 20260321_security_hardening_v22.sql
-- Goal: Fix RLS vulnerabilities and clean legacy RPC surface (Solo-Ninja)

BEGIN;

-- 1. HARDENING: notificacoes (Spam Protection)
-- Prevents anyone from inserting notifications into other users' accounts.
DROP POLICY IF EXISTS "System and authenticated users can insert notifications" ON public.notificacoes;
CREATE POLICY "authenticated_insert_own_notifications" 
ON public.notificacoes FOR INSERT 
TO authenticated 
WITH CHECK (auth.uid() = usuario_id OR public.is_admin());

-- 2. HARDENING: answers (QA Hijacking Protection)
-- Prevents non-admins from answering product questions.
DROP POLICY IF EXISTS "Authenticated users can answer" ON public.answers;
CREATE POLICY "admin_only_insert_answers" 
ON public.answers FOR INSERT 
TO authenticated 
WITH CHECK (public.is_admin());

-- 3. HARDENING: push_subscriptions (Subscription Manipulation Protection)
-- Ensures only authenticated owners can manage their subscriptions.
DROP POLICY IF EXISTS "Users manage own subscriptions" ON public.push_subscriptions;
CREATE POLICY "users_manage_own_auth_subscriptions" 
ON public.push_subscriptions FOR ALL 
TO authenticated 
USING (auth.uid() = user_id OR public.is_admin())
WITH CHECK (auth.uid() = user_id OR public.is_admin());

-- 4. CLEANUP: Drop Legacy Order RPCs (Reducing Attack Surface)
-- We only keep v21 as it has the final BPI/BOLA protection.
DO $$ 
BEGIN
    FOR i IN 1..20 LOOP
        EXECUTE format('DROP FUNCTION IF EXISTS public.create_marketplace_order_v%s CASCADE', i);
    END LOOP;
END $$;

-- 5. VALIDATION: Ensure create_marketplace_order_v21 is active
COMMENT ON FUNCTION public.create_marketplace_order_v21 IS 'Solo-Ninja Hardened Order RPC (v22 Consolidation)';

COMMIT;
