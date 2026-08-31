-- ROLLBACK MANUAL de 20261036000000_pergunta_nasce_com_o_autor
-- (laudo caça-bugs do molde, 30-31/08/2026, achado A5).
--
-- Devolve a policy do baseline (20260806000000:5808) VERBATIM. ⚠️ O rollback
-- REABRE o buraco medido no laudo (usuário logado insere pergunta assinada
-- com o user_id de outro) — rodar só se a trava nova quebrar fluxo legítimo,
-- e consertar o conserto na sequência.
--
-- SEM BEGIN/COMMIT.

DROP POLICY IF EXISTS questions_insert_policy ON public.questions;

CREATE POLICY questions_insert_policy ON public.questions FOR INSERT TO "authenticated" WITH CHECK ((( SELECT "auth"."uid"() AS "uid") IS NOT NULL));
