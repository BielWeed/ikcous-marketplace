-- Migration: Update handle_new_user to include whatsapp from metadata
-- Date: 2024-03-23

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (id, full_name, whatsapp, role)
  VALUES (
    new.id,
    COALESCE(new.raw_user_meta_data->>'full_name', new.raw_user_meta_data->>'name', 'Usuário'),
    new.raw_user_meta_data->>'phone',
    'customer'
  );
  RETURN new;
END;
$$;
