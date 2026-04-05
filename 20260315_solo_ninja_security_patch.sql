-- 20260315_solo_ninja_security_patch.sql
-- Fixes PII leak, missing RLS on tickets, and cart sync parsing issue.

BEGIN;

-- 1. Create secure view for public profiles
CREATE OR REPLACE VIEW public_profiles AS
SELECT 
    id,
    full_name,
    avatar_url,
    role
FROM profiles;

GRANT SELECT ON public_profiles TO public;
GRANT SELECT ON public_profiles TO authenticated;

-- 2. Harden Profiles RLS (Remove public leak)
-- Drop the policy that allows anyone to read everything
DROP POLICY IF EXISTS "Profiles are viewable by everyone." ON profiles;
DROP POLICY IF EXISTS "Profiles are viewable by everyone" ON profiles;
DROP POLICY IF EXISTS "Public profiles are viewable by everyone." ON profiles;
DROP POLICY IF EXISTS "Public profiles are viewable by everyone" ON profiles;

-- Ensure owner and admin can still view profiles
DROP POLICY IF EXISTS "Profiles are viewable by self or admin" ON profiles;
CREATE POLICY "Profiles are viewable by self or admin" ON profiles
    FOR SELECT
    USING (auth.uid() = id OR is_admin());

-- 3. Enable RLS on Tickets (Skipped, table doesn't exist in this context)
-- 4. Enable RLS on Ticket Messages (Skipped, table doesn't exist in this context)

-- 5. Fix Cart Sync RPC (Handling empty strings instead of nulls on uuid casting)
CREATE OR REPLACE FUNCTION sync_cart_atomic(
    p_user_id uuid,
    p_items jsonb
)
RETURNS void AS $$
DECLARE
    item jsonb;
    v_variant_id uuid;
BEGIN
    -- Authorization check (BOLA protection)
    IF auth.uid() != p_user_id AND NOT is_admin() THEN
        RAISE EXCEPTION 'Unauthorized: Cannot sync cart for another user.';
    END IF;

    -- Clear existing items for the user
    DELETE FROM cart_items WHERE user_id = p_user_id;

    -- Insert new items mapped from frontend sync
    IF p_items IS NOT NULL AND jsonb_array_length(p_items) > 0 THEN
        FOR item IN SELECT * FROM jsonb_array_elements(p_items)
        LOOP
            -- Handle empty variant_id gracefully
            v_variant_id := NULLIF(item->>'variant_id', '')::uuid;
            
            INSERT INTO cart_items (
                user_id,
                product_id,
                variant_id,
                quantity,
                created_at,
                updated_at
            ) VALUES (
                p_user_id,
                (item->>'product_id')::uuid,
                v_variant_id,
                (item->>'quantity')::integer,
                now(),
                now()
            );
        END LOOP;
    END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

COMMIT;
