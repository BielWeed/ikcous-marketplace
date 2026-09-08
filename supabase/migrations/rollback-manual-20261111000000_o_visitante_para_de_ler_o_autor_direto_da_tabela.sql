-- ROLLBACK MANUAL da 20261111000000_o_visitante_para_de_ler_o_autor_direto_da_tabela.sql
--
-- Corpo VIVO byte a byte, medido em 08/09/2026 com `pg_get_expr(polqual,
-- polrelid)` + `polroles::regrole[]` contra os DOIS bancos (principal e o
-- clone Savy — expressão e papéis IDÊNTICOS nos dois; nenhuma divergência
-- de ACL nestas duas policies, ao contrário do que ocorre com GRANTs de
-- função em outras frentes):
--
--   reviews_select_policy   roles={-} (PUBLIC, sem TO)
--     USING: ((status = 'publicada'::text) OR (user_id = auth.uid()) OR is_admin())
--   questions_select_policy roles={-} (PUBLIC, sem TO)
--     USING: true
--
-- ⚠️ EFEITO COLATERAL HONESTO: este rollback REABRE o furo do I-3 — `anon`
-- volta a ler `user_id` de toda avaliação publicada e de toda pergunta,
-- direto da tabela. Só executar se a migration estiver causando dano
-- comprovado (ex.: a leitura anônima quebrou porque o front/as views do
-- passo 20261110000000 não foram publicados antes desta).

DROP POLICY IF EXISTS reviews_select_policy ON public.reviews;

CREATE POLICY reviews_select_policy ON public.reviews
  FOR SELECT
  USING (
    status = 'publicada'
    OR user_id = auth.uid()
    OR is_admin()
  );

DROP POLICY IF EXISTS questions_select_policy ON public.questions;

CREATE POLICY questions_select_policy ON public.questions
  FOR SELECT USING (true);
