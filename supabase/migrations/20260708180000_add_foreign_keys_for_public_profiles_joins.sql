-- Migration: Add foreign keys for public_profiles joins
-- Description: Adds foreign key constraints to reviews, questions, and answers pointing to public_profiles(id) so PostgREST can resolve joins when fetching names and avatars.

-- 1. reviews
ALTER TABLE public.reviews
DROP CONSTRAINT IF EXISTS fk_reviews_user_public_profiles,
ADD CONSTRAINT fk_reviews_user_public_profiles
FOREIGN KEY (user_id) REFERENCES public.public_profiles (id)
ON DELETE SET NULL;

-- 2. questions
ALTER TABLE public.questions
DROP CONSTRAINT IF EXISTS fk_questions_user_public_profiles,
ADD CONSTRAINT fk_questions_user_public_profiles
FOREIGN KEY (user_id) REFERENCES public.public_profiles (id)
ON DELETE SET NULL;

-- 3. answers
ALTER TABLE public.answers
DROP CONSTRAINT IF EXISTS fk_answers_user_public_profiles,
ADD CONSTRAINT fk_answers_user_public_profiles
FOREIGN KEY (user_id) REFERENCES public.public_profiles (id)
ON DELETE SET NULL;
