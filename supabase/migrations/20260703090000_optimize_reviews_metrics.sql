-- Migration: Optimize Reviews Metrics Query
-- Description: Creates a secure RPC function to aggregate review stats on database side.

CREATE OR REPLACE FUNCTION public.get_reviews_metrics(
  p_search text DEFAULT NULL,
  p_rating integer DEFAULT NULL
)
RETURNS TABLE (
  average_rating numeric,
  total_verified bigint,
  total_replied bigint
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_search_pattern text;
  v_profile_ids uuid[];
  v_product_ids uuid[];
BEGIN
  IF p_search IS NOT NULL AND p_search <> '' THEN
    v_search_pattern := '%' || p_search || '%';
    
    SELECT COALESCE(array_agg(id), '{}') INTO v_profile_ids 
    FROM public_profiles 
    WHERE full_name ILIKE v_search_pattern;
    
    SELECT COALESCE(array_agg(id), '{}') INTO v_product_ids 
    FROM produtos 
    WHERE nome ILIKE v_search_pattern;
  END IF;

  RETURN QUERY
  SELECT 
    COALESCE(AVG(r.rating), 0.0)::numeric as average_rating,
    COUNT(CASE WHEN r.verified = true THEN 1 END)::bigint as total_verified,
    COUNT(CASE WHEN r.merchant_reply IS NOT NULL AND TRIM(r.merchant_reply) <> '' THEN 1 END)::bigint as total_replied
  FROM reviews r
  WHERE 
    (p_rating IS NULL OR r.rating = p_rating)
    AND (
      p_search IS NULL OR p_search = '' 
      OR r.comment ILIKE v_search_pattern
      OR (v_profile_ids IS NOT NULL AND r.user_id = ANY(v_profile_ids))
      OR (v_product_ids IS NOT NULL AND r.product_id = ANY(v_product_ids))
    );
END;
$$;

-- Grant permissions to authenticated and anon users to run this
GRANT EXECUTE ON FUNCTION public.get_reviews_metrics(text, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_reviews_metrics(text, integer) TO anon;
