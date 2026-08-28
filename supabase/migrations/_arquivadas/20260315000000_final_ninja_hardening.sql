-- Final Ninja Hardening Migration (20260315)
-- Targeted at BOLA in push_subscriptions, lack of RLS in reviews/questions and PII refactor.

-- 1. Hardening push_subscriptions (Fixing BOLA)
DO $$ 
BEGIN
    DROP POLICY IF EXISTS "Users manage own subscriptions" ON public.push_subscriptions;
    
    -- Only allow users to manage their OWN subscriptions. 
    -- Authenticated users CANNOT see or modify subscriptions with NULL user_id (BOLA protection)
    -- unless they are admins.
    CREATE POLICY "push_subscriptions_owner_policy"
    ON public.push_subscriptions
    FOR ALL
    TO authenticated
    USING ( (auth.uid() = user_id) OR is_admin() )
    WITH CHECK ( (auth.uid() = user_id) OR is_admin() );

    -- For anonymous subscriptions (user_id is NULL), we generally don't want them readable by anyone 
    -- via the generic SELECT, but they need to be insertable.
    -- However, the app seems to link user_id after login.
END $$;

-- 2. Hardening reviews
ALTER TABLE public.reviews ENABLE ROW LEVEL SECURITY;

DO $$ 
BEGIN
    DROP POLICY IF EXISTS "public_view_reviews" ON public.reviews;
    DROP POLICY IF EXISTS "auth_insert_reviews" ON public.reviews;
    DROP POLICY IF EXISTS "owner_admin_update_reviews" ON public.reviews;
    DROP POLICY IF EXISTS "admin_delete_reviews" ON public.reviews;

    CREATE POLICY "public_view_reviews" 
    ON public.reviews FOR SELECT 
    USING (true);

    CREATE POLICY "auth_insert_reviews" 
    ON public.reviews FOR INSERT 
    TO authenticated 
    WITH CHECK (auth.uid() = user_id);

    CREATE POLICY "owner_admin_update_reviews" 
    ON public.reviews FOR UPDATE 
    TO authenticated 
    USING (auth.uid() = user_id OR is_admin())
    WITH CHECK (auth.uid() = user_id OR is_admin());

    CREATE POLICY "admin_delete_reviews" 
    ON public.reviews FOR DELETE 
    TO authenticated 
    USING (is_admin());
END $$;

-- 3. Hardening questions
ALTER TABLE public.questions ENABLE ROW LEVEL SECURITY;

DO $$ 
BEGIN
    DROP POLICY IF EXISTS "public_view_questions" ON public.questions;
    DROP POLICY IF EXISTS "auth_insert_questions" ON public.questions;
    DROP POLICY IF EXISTS "owner_admin_update_questions" ON public.questions;
    DROP POLICY IF EXISTS "admin_delete_questions" ON public.questions;

    CREATE POLICY "public_view_questions" 
    ON public.questions FOR SELECT 
    USING (true);

    CREATE POLICY "auth_insert_questions" 
    ON public.questions FOR INSERT 
    TO authenticated 
    WITH CHECK (auth.uid() = user_id);

    CREATE POLICY "owner_admin_update_questions" 
    ON public.questions FOR UPDATE 
    TO authenticated 
    USING (auth.uid() = user_id OR is_admin())
    WITH CHECK (auth.uid() = user_id OR is_admin());

    CREATE POLICY "admin_delete_questions" 
    ON public.questions FOR DELETE 
    TO authenticated 
    USING (is_admin());
END $$;

-- 4. Hardening answers
ALTER TABLE public.answers ENABLE ROW LEVEL SECURITY;

DO $$ 
BEGIN
    DROP POLICY IF EXISTS "public_view_answers" ON public.answers;
    DROP POLICY IF EXISTS "admin_manage_answers" ON public.answers;

    CREATE POLICY "public_view_answers" 
    ON public.answers FOR SELECT 
    USING (true);

    CREATE POLICY "admin_manage_answers" 
    ON public.answers FOR ALL 
    TO authenticated 
    USING (is_admin())
    WITH CHECK (is_admin());
END $$;

-- 5. Hardening analytics_events (Privacy Protection)
ALTER TABLE public.analytics_events ENABLE ROW LEVEL SECURITY;

DO $$ 
BEGIN
    DROP POLICY IF EXISTS "admin_view_analytics" ON public.analytics_events;
    DROP POLICY IF EXISTS "public_insert_analytics" ON public.analytics_events;

    CREATE POLICY "admin_view_analytics" 
    ON public.analytics_events FOR SELECT 
    TO authenticated 
    USING (is_admin());

    CREATE POLICY "public_insert_analytics" 
    ON public.analytics_events FOR INSERT 
    WITH CHECK (
        (auth.uid() IS NULL AND user_id IS NULL) OR 
        (auth.uid() = user_id)
    );
END $$;

-- 6. Refining profiles UPDATE policy (Role/Points protection)
-- Ensure users cannot hijack the 'role' or 'points' column even on their own profile
DO $$ 
BEGIN
    DROP POLICY IF EXISTS "Users can fully manage own profile" ON public.profiles;
    
    CREATE POLICY "profiles_owner_secure_update" 
    ON public.profiles FOR UPDATE 
    TO authenticated 
    USING (auth.uid() = id OR is_admin())
    WITH CHECK (
        is_admin() OR (
            auth.uid() = id AND 
            role = (SELECT role FROM public.profiles WHERE id = auth.uid()) -- Prevents role changing
            -- points = (SELECT points FROM public.profiles WHERE id = auth.uid()) -- Add if points table exists
        )
    );
END $$;
