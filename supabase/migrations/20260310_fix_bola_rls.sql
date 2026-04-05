-- ==========================================
-- FINAL SECURITY HARDENING: FIX BOLA/IDOR
-- ==========================================
-- This migration addresses Massive BOLA vulnerabilities where multiple 
-- ERP tables and the notificacoes table were entirely open to any 
-- authenticated user, allowing data manipulation and exposure.
-- It also adds the missing DELETE policy for the reviews table.

BEGIN;

-- 1. Fix Missing DELETE Policy on 'reviews' Table
-- Users should be able to delete their own reviews, admins can delete any.
DROP POLICY IF EXISTS "Users can delete their own reviews" ON public.reviews;
DROP POLICY IF EXISTS "Admins can delete any review" ON public.reviews;

CREATE POLICY "Users can delete their own reviews" ON public.reviews
    FOR DELETE USING (
        auth.uid() = user_id
    );

CREATE POLICY "Admins can delete any review" ON public.reviews
    FOR DELETE USING (
        is_admin()
    );

-- 2. Fix BOLA on 'notificacoes' Table
-- Previous policies: 'Enable all access for authenticated users' and 'Enable insert for anon (market)'
-- New policies restrict users to their own notifications or global ones.

DROP POLICY IF EXISTS "Enable all access for authenticated users" ON public.notificacoes;
DROP POLICY IF EXISTS "Enable insert for anon (market)" ON public.notificacoes;

-- SELECT: Users can read their own notifications, global notifications (usuario_id IS NULL), or admins can read all.
CREATE POLICY "Users can read own or global notifications" ON public.notificacoes
    FOR SELECT USING (
        auth.uid() = usuario_id OR usuario_id IS NULL OR is_admin()
    );

-- UPDATE: Users can only update their own notifications (e.g. marking as read), admins can update any.
CREATE POLICY "Users can update own notifications" ON public.notificacoes
    FOR UPDATE USING (
        auth.uid() = usuario_id OR is_admin()
    );

-- DELETE: Users can delete their own notifications, admins can delete any.
CREATE POLICY "Users can delete own notifications" ON public.notificacoes
    FOR DELETE USING (
        auth.uid() = usuario_id OR is_admin()
    );

-- INSERT: Allow the system/users to insert notifications (needed for frontend notification generation, or system triggers).
CREATE POLICY "System and authenticated users can insert notifications" ON public.notificacoes
    FOR INSERT WITH CHECK (
        true
    );

-- 3. Fix Massive BOLA on ERP / Admin Tables
-- Several tables meant only for internal use had the "Enable all access for authenticated users" policy.
-- This block dynamically replaces that extremely open policy with an "is_admin()" check.

DO $$ 
DECLARE
    tbl text;
BEGIN
    FOR tbl IN SELECT unnest(ARRAY[
        'fornecedores', 
        'vendas', 
        'pedidos', 
        'pedido_itens', 
        'fluxo_caixa', 
        'retiradas', 
        'metas', 
        'historico_precos', 
        'kanban_cards', 
        'configuracoes', 
        'alertas'
    ]) LOOP
        -- Drop the overly permissive policy
        EXECUTE format('DROP POLICY IF EXISTS "Enable all access for authenticated users" ON public.%I', tbl);
        
        -- Clean up any multiple variations that might exist
        EXECUTE format('DROP POLICY IF EXISTS "Admins only access" ON public.%I', tbl);

        -- Create the new, secure admin-only policy
        EXECUTE format('CREATE POLICY "Admins only access" ON public.%I FOR ALL USING (is_admin())', tbl);
    END LOOP;
END $$;

COMMIT;
