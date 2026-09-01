-- A pergunta do Q&A nasce assinada pelo próprio autor (laudo caça-bugs do
-- molde, 30-31/08/2026, achado A5).
--
-- CAUSA RAIZ PROVADA: `questions_insert_policy` (baseline:5808) só exige
-- `auth.uid() IS NOT NULL` — NÃO amarra `questions.user_id` ao chamador.
-- Qualquer usuário logado insere pergunta pública assinada com o user_id de
-- OUTRA pessoa (fábrica de identidade no Q&A). É a mesma classe dos
-- fabricáveis já fechados na casa: `reviews.verified` (20261030000000,
-- WITH CHECK verified = false) e `reviews.status` (20261031000000, WITH
-- CHECK status = 'pendente') — `questions` ficou para trás.
--
-- O que muda aqui:
--   1. A policy de INSERT passa a exigir `user_id = (SELECT auth.uid())`:
--      a pergunta nasce com a identidade de quem chamou, sem exceção.
--      O front já grava o próprio user_id (comportamento atual inalterado).
--
-- ANOTADO SEM CONSERTO (residual aceito, não é brecha nova): a
-- `questions_select_policy` continua `USING (true)` e a linha expõe o
-- user_id de quem perguntou a qualquer visitante — igual antes. Mudar a
-- SELECT sem saber quem consome o campo na renderização do Q&A pode quebrar
-- a tela; se um dia o Q&A parar de precisar do user_id no cliente, a
-- exposição merece migration própria.
--
-- `answers` NÃO precisa do mesmo conserto: as policies dela (baseline:5333-
-- 5350) são admin-only nas três operações de escrita.
--
-- SEM BEGIN/COMMIT (regra da casa: com eles o ROLLBACK da prova vira no-op).
--
-- FICHA DE VERIFICAÇÃO pos-aplicação (com DOIS usuários de teste reais,
-- em transação com ROLLBACK):
--   BEGIN;
--     SET LOCAL role authenticated;
--     SET LOCAL request.jwt.claims = '{"sub":"<uuid-do-usuario-A>","role":"authenticated"}';
--     -- 1. Autor insere a própria pergunta (controle positivo):
--     INSERT INTO public.questions (product_id, user_id, question)
--       VALUES ('<uuid-de-produto-real>', '<uuid-do-usuario-A>', 'teste A');
--     -> espera INSERT 0 1
--     -- 2. Autor tenta assinar com o user_id de OUTRO (o buraco de antes):
--     INSERT INTO public.questions (product_id, user_id, question)
--       VALUES ('<uuid-de-produto-real>', '<uuid-do-usuario-B>', 'teste B');
--     -> espera ERRO 42501 (violacao de policy) — antes: INSERT 0 1
--   ROLLBACK;
--
-- ROLLBACK MANUAL: versionado em
-- rollback-manual-20261036000000_pergunta_nasce_com_o_autor.sql

DROP POLICY IF EXISTS questions_insert_policy ON public.questions;

CREATE POLICY questions_insert_policy ON public.questions
  FOR INSERT TO authenticated
  WITH CHECK (
    (SELECT auth.uid()) IS NOT NULL
    AND user_id = (SELECT auth.uid())
  );
