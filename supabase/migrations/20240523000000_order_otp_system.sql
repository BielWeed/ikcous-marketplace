-- Create OTP verifications table
CREATE TABLE IF NOT EXISTS public.otp_verifications (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email TEXT NOT NULL,
    whatsapp TEXT NOT NULL,
    otp_code TEXT NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    verified BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index for faster cleanup and lookup
CREATE INDEX IF NOT EXISTS idx_otp_email ON public.otp_verifications(email);

-- Function to generate OTP
CREATE OR REPLACE FUNCTION public.generate_order_otp_v1(
    p_email TEXT,
    p_whatsapp TEXT,
    p_order_fragment TEXT -- Last 4 digits of order ID
) RETURNS TEXT AS $$
DECLARE
    v_otp TEXT;
    v_exists BOOLEAN;
BEGIN
    -- Validate if a matching order exists
    -- p_order_fragment should match the END of an order ID for this email/whatsapp
    -- Using ILIKE for case-insensitive and matching the end
    SELECT EXISTS (
        SELECT 1 FROM public.orders 
        WHERE (customer->>'email' = p_email OR customer->>'whatsapp' = p_whatsapp)
        AND id::text ILIKE '%' || p_order_fragment
    ) INTO v_exists;

    IF NOT v_exists THEN
        RAISE EXCEPTION 'Dados do pedido não encontrados.';
    END IF;

    -- Generate a 6-digit OTP
    v_otp := LPAD(FLOOR(RANDOM() * 1000000)::TEXT, 6, '0');

    -- Insert into verifications table
    INSERT INTO public.otp_verifications (email, whatsapp, otp_code, expires_at)
    VALUES (p_email, p_whatsapp, v_otp, NOW() + INTERVAL '15 minutes');

    RETURN v_otp;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to get orders by OTP
CREATE OR REPLACE FUNCTION public.get_orders_by_otp_v1(
    p_email TEXT,
    p_otp TEXT
) RETURNS JSONB AS $$
DECLARE
    v_valid_record RECORD;
BEGIN
    -- Check if OTP is valid and not expired
    SELECT whatsapp, verified INTO v_valid_record
    FROM public.otp_verifications
    WHERE email = p_email 
    AND otp_code = p_otp 
    AND expires_at > NOW()
    ORDER BY created_at DESC
    LIMIT 1;

    IF v_valid_record.whatsapp IS NULL THEN
        RAISE EXCEPTION 'Código inválido ou expirado.';
    END IF;

    IF v_valid_record.verified THEN
        RAISE EXCEPTION 'Código já utilizado.';
    END IF;

    -- Mark as verified
    UPDATE public.otp_verifications 
    SET verified = TRUE 
    WHERE email = p_email AND otp_code = p_otp;

    -- Return orders associated with this email or whatsapp
    RETURN (
        SELECT jsonb_agg(o.*)
        FROM public.orders o
        WHERE o.customer->>'email' = p_email 
        OR o.customer->>'whatsapp' = v_valid_record.whatsapp
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
