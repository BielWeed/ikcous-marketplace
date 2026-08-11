-- Migration: Secure OTP Verification Flow and Edge Function Trigger
-- Date: 2026-07-08
-- Version: 20260708190000

BEGIN;

-- 1. Redefine generate_order_otp_v1 to return BOOLEAN and NOT leak v_otp code
CREATE OR REPLACE FUNCTION public.generate_order_otp_v1(
    p_email text, p_whatsapp text, p_order_fragment text
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
    v_otp TEXT;
    v_exists BOOLEAN;
BEGIN
    -- [CLEANUP] Exclude expired OTP records
    DELETE FROM public.otp_verifications WHERE expires_at < NOW();

    -- Validate if a matching order exists
    -- p_order_fragment should match the END of an order ID for this email/whatsapp
    -- Using ILIKE for case-insensitive and matching the end
    SELECT EXISTS (
        SELECT 1 FROM public.marketplace_orders o
        LEFT JOIN auth.users u ON u.id = o.user_id
        WHERE (
            -- WhatsApp comparison immune to formatting (extracting only digits)
            (p_whatsapp IS NOT NULL AND p_whatsapp <> '' AND 
             regexp_replace(coalesce(o.customer_phone, o.customer_data->>'whatsapp', ''), '[^0-9]', '', 'g') = regexp_replace(p_whatsapp, '[^0-9]', '', 'g'))
            OR
            -- Email comparison (either on customer_data or logged-in user email)
            (p_email IS NOT NULL AND p_email <> '' AND 
             (LOWER(coalesce(o.customer_data->>'email', '')) = LOWER(p_email) 
              OR LOWER(coalesce(u.email, '')) = LOWER(p_email)))
        )
        AND o.id::text ILIKE '%' || p_order_fragment
    ) INTO v_exists;

    IF NOT v_exists THEN
        RAISE EXCEPTION 'Dados do pedido não encontrados.';
    END IF;

    -- Generate a 6-digit OTP
    v_otp := LPAD(FLOOR(RANDOM() * 1000000)::TEXT, 6, '0');

    -- Insert into verifications table
    INSERT INTO public.otp_verifications (email, whatsapp, otp_code, expires_at)
    VALUES (p_email, p_whatsapp, v_otp, NOW() + INTERVAL '15 minutes');

    RETURN TRUE;
END;
$function$;

-- 2. Revoke and Re-Grant permissions for generate_order_otp_v1
REVOKE EXECUTE ON FUNCTION public.generate_order_otp_v1(
    text, text, text
) FROM public;
GRANT EXECUTE ON FUNCTION public.generate_order_otp_v1(
    text, text, text
) TO anon,
authenticated,
service_role;

-- 3. Create Trigger Function to invoke the send-otp-email Edge Function
CREATE OR REPLACE FUNCTION public.handle_new_otp_verification()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_apikey text;
BEGIN
  -- 1. Try to get service_role API key from app_settings first
  SELECT value INTO v_apikey FROM public.app_settings WHERE key = 'supabase_service_role_key';
  
  -- 2. Fallback to headers if settings placeholder is present or missing
  IF v_apikey IS NULL OR v_apikey = 'YOUR_SERVICE_ROLE_KEY_HERE' THEN
    BEGIN
      v_apikey := (current_setting('request.headers', true)::jsonb)->>'apikey';
    EXCEPTION WHEN OTHERS THEN
      v_apikey := NULL;
    END;
  END IF;

  -- 3. Trigger HTTP request to our send-otp-email Edge Function
  PERFORM
    net.http_post(
      url := 'https://cafkrminfnokvgjqtkle.functions.supabase.co/send-otp-email',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || COALESCE(v_apikey, '')
      ),
      body := jsonb_build_object(
        'type', 'INSERT',
        'table', 'otp_verifications',
        'record', row_to_json(NEW)::jsonb
      )
    );
  RETURN NEW;
END;
$$;

-- 4. Apply trigger to otp_verifications table
DROP TRIGGER IF EXISTS on_otp_created_send_email ON public.otp_verifications;
CREATE TRIGGER on_otp_created_send_email
AFTER INSERT ON public.otp_verifications
FOR EACH ROW EXECUTE FUNCTION public.handle_new_otp_verification();

COMMIT;
