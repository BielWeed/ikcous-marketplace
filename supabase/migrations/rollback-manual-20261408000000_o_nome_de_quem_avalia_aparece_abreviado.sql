-- ROLLBACK MANUAL de 20261408000000_o_nome_de_quem_avalia_aparece_abreviado.sql
-- Reverter primeiro o site que consulta nome_publico. Depois, devolver os dois
-- SELECTs exatos da 20261110000000 (grants e dono ficam) e remover só os objetos novos.
-- O aplicador abre e fecha a transação. O nome completo volta a aparecer na vitrine.

CREATE OR REPLACE VIEW public.vw_reviews_public AS
SELECT
  r.id,
  r.product_id,
  r.rating,
  r.comment,
  r.created_at,
  r.helpful,
  r.verified,
  r.merchant_reply,
  r.merchant_reply_at,
  pp.full_name AS author_name,
  pp.avatar_url AS author_avatar_url
FROM public.reviews r
LEFT JOIN public.public_profiles pp ON pp.id = r.user_id
WHERE r.status = 'publicada';

CREATE OR REPLACE VIEW public.vw_questions_public AS
SELECT
  q.id,
  q.product_id,
  q.question,
  q.created_at,
  pp.full_name AS author_name,
  pp.avatar_url AS author_avatar_url
FROM public.questions q
LEFT JOIN public.public_profiles pp ON pp.id = q.user_id;

ALTER TABLE public.public_profiles DROP COLUMN nome_publico;
DROP FUNCTION public.nome_publico_de(text);
