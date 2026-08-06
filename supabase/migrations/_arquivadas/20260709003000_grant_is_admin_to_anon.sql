-- Grant execute permission on is_admin() and check_is_admin() to anon and authenticated roles
-- This is required because these functions are used in RLS policies for public tables (like banners, products, coupons)
-- that anonymous users need to query. Without these grants, anonymous queries throw "permission denied for function is_admin" errors.

GRANT EXECUTE ON FUNCTION public.is_admin() TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.check_is_admin() TO anon, authenticated;
