-- O visitante anônimo para de alcançar `user_id` de reviews/questions PELA
-- TABELA (I-3, brief hub-0809-g 08/09/2026:
-- equipe/entregas/20260908-brief-i3-i4-anon-nao-le-autor-nem-grava-analytics.md).
--
-- NÃO ADITIVA — RESTRINGE PERMISSÃO (RLS, mapa de risco ALTO). NÃO aplicar
-- em banco nenhum sem o SQL abaixo MOSTRADO ao Gabriel e ele dizer "pode
-- aplicar" (a carta branca de 07/09 cobre só migration ADITIVA). PRÉ-
-- REQUISITO: a 20261110000000 (as duas views públicas) e o front deste
-- mesmo PR (lendo delas para o visitante) já têm de estar no ar — "banco
-- novo + tela velha liga o defeito"
-- (memoria/aplicar-no-banco-sem-conferir-o-que-esta-no-ar.md): aplicar esta
-- migration ANTES do front novo publicado quebra a leitura anônima de
-- avaliações/perguntas na hora (o front velho ainda lê `reviews`/
-- `questions` direto, e o `anon` perde a policy que sustentava isso).
--
-- O DEFEITO, PROVADO NO ESTADO VIVO (medido em 08/09/2026, pg_policy do
-- banco PRINCIPAL e do clone Savy — as duas idênticas neste ponto):
--   reviews_select_policy   USING (status = 'publicada' OR user_id = auth.uid() OR is_admin()) — SEM `TO`, ou seja PUBLIC: `anon` casa no primeiro ramo e recebe a linha INTEIRA (`user_id` incluído) de toda avaliação publicada.
--   questions_select_policy USING (true) — SEM `TO`: `anon` recebe QUALQUER pergunta, `user_id` incluído.
--
-- O QUE ESTA MIGRATION FAZ: as duas policies passam a valer só para
-- `authenticated` — a MESMA regra de negócio de hoje, só com
-- `auth.uid()`/`is_admin()` reescritos como subselect (C2 do laudo Opus
-- PR#484, ver comentário junto do `CREATE POLICY` abaixo; nada muda no que
-- cada papel enxerga: quem está logado continua vendo o que via; o autor
-- continua vendo a própria pendente; o admin continua vendo tudo). O
-- visitante sem sessão
-- (`anon`) deixa de ter QUALQUER policy permissiva nas duas tabelas — com
-- RLS ligado e nenhuma policy aplicável ao seu papel, o Postgres nega por
-- padrão: `SELECT` direto em `reviews`/`questions` como anon devolve ZERO
-- linhas (não erro; é o mesmo comportamento que `analytics_events_select_policy`
-- já usa hoje para o `anon`, `TO authenticated`). O visitante lê pela
-- `vw_reviews_public`/`vw_questions_public` (20261110000000), que bypassa
-- esta RLS de propósito e nunca teve `user_id` para vazar.
--
-- RESIDUAL CONHECIDO, REGISTRADO SEM CONSERTO (fora do escopo desta frente):
-- `vw_questions_with_answers_count` (baseline:4412, `security_invoker='on'`)
-- é OUTRO caminho que hoje devolve `questions.user_id` a quem a consultar
-- — mas ela herda a RLS do CHAMADOR (`security_invoker`), então esta MESMA
-- migration a fecha de graça para `anon`: sem policy permissiva, o
-- `anon` que consultar essa view também passa a receber zero linhas. Não
-- precisa de migration própria; só registrado para quem for auditar depois.
--
-- ANON NÃO ALCANÇA `user_id` POR NENHUM CAMINHO DEPOIS DESTA MIGRATION:
-- tabela (RLS fecha), `vw_questions_with_answers_count` (RLS fecha, efeito
-- colateral acima), `vw_reviews_public`/`vw_questions_public` (nunca
-- expuseram a coluna). Não há RPC `SECURITY DEFINER` que devolva
-- `reviews`/`questions` inteiras a `anon` (grep -rn "FROM public.reviews\|FROM public.questions" supabase/migrations/*.sql — só a própria tabela e as duas views desta frente).
--
-- C1 (laudo Opus PR#484, 08/09/2026) — O REALTIME DO VISITANTE ANÔNIMO
-- MORRE COM ESTA MIGRATION, E NÃO É PARA SER CONSERTADO AQUI: `ProductView.
-- tsx:472` assina `postgres_changes` em `reviews`; `ProductQA.tsx:37` assina
-- em `questions` (`useReviews.ts:674`/`useQuestions.ts:719`). O Realtime do
-- Supabase aplica a RLS de quem está inscrito no canal — sem policy
-- permissiva para `anon` nas duas tabelas, os eventos deixam de ser
-- entregues a partir do instante em que esta migration for aplicada.
-- GATILHO: o instante da aplicação. EFEITO: a página de produto do
-- visitante sem sessão para de atualizar sozinha quando uma avaliação é
-- publicada ou uma pergunta é feita — só volta ao recarregar a página. A
-- resposta da loja continua acordando a tela, porque `answers` segue
-- pública, sem policy tocada nesta frente. Não é regressão de segurança —
-- é comportamento visível que muda para quem usa; registrado aqui e na
-- ficha de verificação abaixo. O front NÃO muda por causa disto nesta
-- frente (fora do escopo dos arquivos permitidos).
--
-- ACHADO FORA DO ESCOPO DESTA FRENTE (arquivo proibido, não corrigido aqui —
-- só registrado para o dono decidir): `src/views/customer/UserProfileView.tsx`
-- (linhas ~124-165) é uma tela de "perfil público" navegável por QUALQUER
-- visitante sem login (`case "user-profile"` em `src/App.tsx:2145`, sem o
-- gate de auth que `handleNavigate` aplica só a `profile`/`account-settings`/
-- `address-form`) e lê `reviews`/`questions` DIRETO DA TABELA, filtrando por
-- `user_id` — não pelo hook desta frente. Depois desta migration, um
-- visitante que abrir o perfil público de outra pessoa (o link nasce do
-- clique no autor de uma avaliação/pergunta — hoje só para quem está
-- logado, porque o front deste PR tira o `userId` do visitante) passa a ver
-- "0 avaliações"/"0 perguntas" mesmo que a pessoa tenha publicadas — o
-- brief presumia esta tela como "logado, o próprio"
-- (equipe/entregas/20260908-brief-i3-i4-...md:13), e a medição desta frente
-- mostra que ela também é pública. `UserProfileView.tsx` NÃO está nos
-- arquivos permitidos desta frente — precisa de PR próprio (ler pelas
-- mesmas views) antes ou junto da aplicação desta migration em produção.
--
-- SEM BEGIN/COMMIT (regra da casa).
--
-- FICHA DE VERIFICAÇÃO pós-aplicação (rodar contra o banco; não rodada por
-- este agente):
--
--   -- 1. As policies exigem `authenticated`:
--   SELECT polname, polroles::regrole[]
--   FROM pg_policy WHERE polname IN ('reviews_select_policy','questions_select_policy');
--   -- esperado: {authenticated} nas duas (hoje: {-}, ou seja PUBLIC).
--
--   -- 2. anon não lê a tabela (SET ROLE anon):
--   SELECT * FROM public.reviews LIMIT 1;   -- zero linhas
--   SELECT * FROM public.questions LIMIT 1; -- zero linhas
--
--   -- 3. anon continua lendo pelas views (SET ROLE anon):
--   SELECT * FROM public.vw_reviews_public LIMIT 1;   -- linhas, sem user_id
--   SELECT * FROM public.vw_questions_public LIMIT 1; -- linhas, sem user_id
--
--   -- 4. Os três papéis de sempre continuam intactos (SET ROLE
--   --    authenticated + request.jwt.claims do usuário de teste): autor vê
--   --    a própria avaliação pendente; outro authenticated não vê a
--   --    pendente alheia; admin vê tudo — mesma prova da 20261031000000.
--
--   -- 5. C1 — o visitante anônimo perde o realtime de reviews/questions:
--   --    inscreva um canal `postgres_changes` como `anon` nas duas tabelas
--   --    antes e depois de aplicar; depois, nenhum INSERT/UPDATE chega ao
--   --    canal (a página exige recarregar para ver avaliação/pergunta
--   --    nova). Não é falha desta migration — é o efeito esperado; a ficha
--   --    serve para confirmar que ninguém trate isso como bug depois.
--
-- ROLLBACK: rollback-manual-20261111000000_*.sql versionado junto, com o
-- corpo VIVO byte a byte (medido em pg_get_expr contra os DOIS bancos,
-- principal e Savy — idênticos neste ponto). O rollback NÃO leva o
-- subselect abaixo: ele reproduz o corpo que está vivo HOJE (sem `TO`, sem
-- subselect), não o desenho novo desta migration.

DROP POLICY IF EXISTS reviews_select_policy ON public.reviews;

-- C2 (laudo Opus PR#484, 08/09/2026): `(SELECT auth.uid())` e
-- `(SELECT public.is_admin())` em vez da chamada direta — sem o subselect o
-- linter do Supabase acusa `auth_rls_initplan` e a função é reavaliada por
-- LINHA em vez de uma vez por consulta (mesmo molde de
-- `analytics_events_insert_policy` na 20261112000000 deste PR). Expressão
-- funcionalmente idêntica à que estava viva antes desta migration.
CREATE POLICY reviews_select_policy ON public.reviews
  FOR SELECT TO authenticated
  USING (
    status = 'publicada'
    OR user_id = (SELECT auth.uid())
    OR (SELECT public.is_admin())
  );

DROP POLICY IF EXISTS questions_select_policy ON public.questions;

CREATE POLICY questions_select_policy ON public.questions
  FOR SELECT TO authenticated
  USING (true);
