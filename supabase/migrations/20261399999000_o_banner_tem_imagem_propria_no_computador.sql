-- Separação de arte por dispositivo; a imagem atual continua sendo a reserva.
-- Não altera linhas existentes, privilégios ou políticas.
ALTER TABLE public.banners
  ADD COLUMN desktop_image_url text;

COMMENT ON COLUMN public.banners.desktop_image_url IS
  'Imagem opcional para computador; NULL mantém image_url como reserva.';
