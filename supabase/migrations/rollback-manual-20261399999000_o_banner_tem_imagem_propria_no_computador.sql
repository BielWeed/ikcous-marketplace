-- Só voltar o esquema antes de haver arte configurada: nunca descartar dado real.
DO $$
BEGIN
  LOCK TABLE public.banners IN ACCESS EXCLUSIVE MODE;
  IF EXISTS (SELECT 1 FROM public.banners WHERE desktop_image_url IS NOT NULL) THEN
    RAISE EXCEPTION 'Há imagens de computador configuradas. Preserve os dados antes de reverter.';
  END IF;
  ALTER TABLE public.banners DROP COLUMN desktop_image_url;
END;
$$;
