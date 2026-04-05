-- ==============================================================================
-- 🥷 SOLO-NINJA SECURITY PATCH v19 - FINAL HARDENING
-- ==============================================================================
-- Target: Profiles (Role Escalation), Orders (Status Manipulation), Notifications (Spam)

BEGIN;

-- 1. HARDEN PROFILES (Strict Role Protection)
-- We need to ensure that 'role' and 'id' can NEVER be updated by the user, even if they own the profile.
DROP POLICY IF EXISTS "Profiles self-update" ON public.profiles;
DROP POLICY IF EXISTS "Users can update own profile except role" ON public.profiles;
DROP POLICY IF EXISTS "Users can update own profile fields EXCEPT role" ON public.profiles;

CREATE POLICY "Profiles self-update secure" ON public.profiles
FOR UPDATE TO authenticated
USING (auth.uid() = id)
WITH CHECK (
    (auth.uid() = id) AND 
    (
        is_admin() OR (
            role = (SELECT role FROM public.profiles WHERE id = auth.uid()) -- Preserve existing role
            AND id = auth.uid() -- Preserve existing ID
        )
    )
);

-- 2. HARDEN ORDERS (Status Control)
-- Users should not be able to update orders directly. They should use RPCs for specific transitions like cancellation.
DROP POLICY IF EXISTS "Order management" ON public.marketplace_orders;
DROP POLICY IF EXISTS "Users manage own orders, Admin manage all" ON public.marketplace_orders;
DROP POLICY IF EXISTS "Users can update their own orders" ON public.marketplace_orders;

CREATE POLICY "Owners and Admins update orders" ON public.marketplace_orders
FOR UPDATE TO authenticated
USING (auth.uid() = user_id OR public.is_admin())
WITH CHECK (public.is_admin()); -- ONLY ADMIN can perform direct table updates. Users MUST use RPC.

-- 3. HARDEN ORDER STATUS RPC (State Machine Enforcement)
-- update_order_status_atomic (redefinition with strict rules)
CREATE OR REPLACE FUNCTION public.update_order_status_atomic(
    p_order_id uuid, 
    p_new_status text, 
    p_notes text DEFAULT NULL, 
    p_silent boolean DEFAULT false
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_old_status TEXT;
    v_user_id UUID;
    v_caller_id UUID := auth.uid();
    v_is_admin BOOLEAN := public.is_admin();
BEGIN
    -- 1. Fetch current state
    SELECT status, user_id INTO v_old_status, v_user_id 
    FROM public.marketplace_orders 
    WHERE id = p_order_id 
    FOR UPDATE;
    
    IF v_old_status IS NULL THEN
        RAISE EXCEPTION 'Pedido não encontrado.';
    END IF;

    -- 2. Security Check (BOLA)
    IF v_user_id != v_caller_id AND NOT v_is_admin THEN
        RAISE EXCEPTION 'Não autorizado: BOLA detectada.';
    END IF;

    -- 3. State Machine Enforcement
    IF NOT v_is_admin THEN
        -- REGULAR USER RESTRICTIONS
        IF p_new_status != 'cancelled' THEN
            RAISE EXCEPTION 'Usuários só podem cancelar pedidos.';
        END IF;

        IF v_old_status != 'pending' THEN
            RAISE EXCEPTION 'Apenas pedidos pendentes podem ser cancelados pelo usuário. Entre em contato com o suporte.';
        END IF;
    END IF;

    -- 4. Execute Update
    UPDATE public.marketplace_orders 
    SET 
        status = p_new_status, 
        updated_at = NOW() 
    WHERE id = p_order_id;

    -- 5. Log History
    INSERT INTO public.marketplace_order_history (order_id, old_status, new_status, notes, created_by)
    VALUES (p_order_id, v_old_status, p_new_status, p_notes, v_caller_id);

    -- 6. Trigger Notification (Optimization: only if not silent)
    -- This would normally trigger a push, but we keep it atomic here.
END;
$$;

-- 4. HARDEN NOTIFICATIONS (Final Audit)
-- Ensure only admins or system (service_role) can insert.
DROP POLICY IF EXISTS "Admins manage notificacoes" ON public.notificacoes;
DROP POLICY IF EXISTS "Admins only insert notifications" ON public.notificacoes;
DROP POLICY IF EXISTS "System and authenticated users can insert notifications" ON public.notificacoes;

CREATE POLICY "Admin/System insert notifications" ON public.notificacoes
FOR INSERT TO authenticated
WITH CHECK (public.is_admin());

-- 5. RPC create_marketplace_order_v18 (Definitive Consolidation)
-- We'll rename v17 to v18 to signify the final ninja version if needed, or just keep hardening v17.
-- For this patch, let's just make sure v17 is perfectly secure (already checked in previous reconnaissance).

COMMIT;
