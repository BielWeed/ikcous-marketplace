-- ROLLBACK MANUAL de 20261004000000_policy_banners_respeita_janela.sql
--
-- Restaura a policy anterior VERBATIM (baseline:5398) - so "active" ou
-- admin, sem janela. CUSTO DECLARADO do rollback: reabre a exposicao que
-- esta file fecha - banner futuro (active + start_date adiante) volta a
-- ser legivel por anon. Reverter SEM reverter tambem a 20261000000000
-- (as colunas) mantem o furo aberto com dados nele; se o motivo do
-- rollback for o par banners inteiro, reverta a policy PRIMEIRO e as
-- colunas depois (a policy nova referencia as colunas; a antiga nao).
--
-- Ficha negativa pos-rollback: o SELECT anon do banner futuro volta a
-- devolver a linha - e a prova de que o rollback aconteceu.

-- RESTAURA: a banners_select_policy do baseline (so 'active' ou admin,
-- sem janela). NAO RESTAURA: nada alem - o rollback e so a policy
-- antiga; NENHUM dado e tocado. EFEITO DECLARADO: reabre a exposicao
-- de banner agendado a anon (custo ja declarado acima).
-- ALCANCE: so-policy. Sem DML. Sem view.

DROP POLICY IF EXISTS banners_select_policy ON public.banners;

CREATE POLICY banners_select_policy ON public.banners FOR SELECT USING ((("active" = true) OR ((( SELECT "auth"."role"() AS "role") = 'authenticated'::"text") AND ( SELECT "public"."is_admin"() AS "is_admin"))));
