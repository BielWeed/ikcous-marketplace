-- Migration: Add CPF to handle_new_user Trigger
-- Date: 2026-07-11

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (id, full_name, whatsapp, cpf, role)
  VALUES (
    new.id,
    COALESCE(new.raw_user_meta_data->>'full_name', new.raw_user_meta_data->>'name', 'Usuário'),
    new.raw_user_meta_data->>'phone',
    new.raw_user_meta_data->>'cpf',
    'customer'
  )
  ON CONFLICT (id) DO UPDATE
  SET
    full_name = EXCLUDED.full_name,
    whatsapp = COALESCE(EXCLUDED.whatsapp, profiles.whatsapp),
    cpf = COALESCE(EXCLUDED.cpf, profiles.cpf);
  RETURN new;
END;
$$;
