-- A "Moderação Ativa" vira moderação REAL (laudo "o que falta" 29/08, item
-- 8, degrau 2 — promete o que não cumpre).
--
-- O defeito: o painel exibia o rótulo "Moderação Ativa" (pulsando, como um
-- indicador vivo) e NÃO HAVIA moderação: toda avaliação ia ao ar na hora —
-- o insert é direto do front (RLS só exige ser o autor) — e a única
-- ferramenta era APAGAR depois.
--
-- O que esta migration faz:
--   1. coluna nova `reviews.status` ('publicada' | 'pendente'), DEFAULT
--      'publicada' — as avaliações EXISTENTES já foram ao ar e continuam
--      no ar (nada de histórico escondido);
--   2. a policy de SELECT para de entregar tudo a todo mundo: o público só
--      vê 'publicada'; o AUTOR continua vendo a própria avaliação pendente
--      ("sua avaliação está em análise" fica visível para quem escreveu);
--      o admin vê tudo. anon: auth.uid() é NULL e a igualdade NULL nunca é
--      verdadeira — só 'publicada' vaza para visitante.
--
-- O front (mesmo PR): toda avaliação NOVA nasce 'pendente' (addReview) e o
-- painel ganha a fila de aprovação (badge "Em moderação" + botão Aprovar; a
-- recusa continua sendo o apagar de sempre). O KPI do painel passa a mostrar
-- a fila de verdade.
--
-- RISCO ALTO (RLS): mexer em policy de SELECT muda quem vê o quê. A ficha
-- abaixo prova os três papéis.
--
-- SEM BEGIN/COMMIT (regra da casa). NÃO aplicar sem prova e sem o Gabriel
-- autorizar NESTA sessão.
--
-- FICHA DE VERIFICAÇÃO pos-aplicação (rodar contra o banco; nao rodada por
-- este agente):
--
--   -- 1. A coluna existe com o default certo:
--   SELECT column_default, is_nullable
--   FROM information_schema.columns
--   WHERE table_schema='public' AND table_name='reviews'
--     AND column_name='status';
--   -- esperado: 'publicada' | NO
--
--   -- 2. A policy SELECT filtra pendente (e mantém o resto):
--   SELECT pg_get_expr(qual, polrelid) AS usando
--   FROM pg_policy WHERE polname = 'reviews_select_policy';
--   -- esperado: expressão contendo 'status' e 'publicada'
--
--   -- 2b. A policy INSERT só aceita avaliação PENDENTE (a fila não é
--   --     contornável pela API — mesmo furo que o #350 fechou para o selo):
--   SELECT pg_get_expr(qual, polrelid) AS com_check
--   FROM pg_policy WHERE polname = 'reviews_insert_policy';
--   -- esperado: expressão contendo "status = 'pendente'" e 'verified = false'
--
--   -- 3. Prova funcional dos TRÊS papéis (com uma avaliação pendente de
--   --    teste; APAGAR depois):
--   --    UPDATE reviews SET status = 'pendente' WHERE id = '<avaliação de teste>';
--   --    a) anon (set role anon): SELECT não retorna a linha;
--   --    b) o AUTOR (set role para ele): SELECT retorna a própria linha;
--   --    c) admin: SELECT retorna a linha.
--   --    Depois: UPDATE status = 'publicada' volta ao estado anterior
--   --    (e DELETE da avaliação de teste).

ALTER TABLE public.reviews
  ADD COLUMN status text NOT NULL DEFAULT 'publicada';

ALTER TABLE public.reviews
  ADD CONSTRAINT reviews_status_check
  CHECK (status IN ('publicada', 'pendente'));

DROP POLICY IF EXISTS reviews_select_policy ON public.reviews;

CREATE POLICY reviews_select_policy ON public.reviews
  FOR SELECT
  USING (
    status = 'publicada'
    OR user_id = auth.uid()
    OR public.is_admin()
  );

-- ============================================================
-- Fecha o MESMO furo que o #350 fechou para o `verified`, agora para o
-- `status`: sem esta trava na WITH CHECK, qualquer authenticated postava a
-- avaliação DIRETO na API com status = 'publicada' — nascendo no ar, fora
-- da fila, e o painel voltava a prometer uma moderação que o banco não
-- garante. Com `status = 'pendente'` na WITH CHECK, TODO insert novo entra
-- na fila; o admin nunca insere avaliação pelo app (só aprova/apaga/
-- responde), então ninguém perde função.
-- ============================================================

DROP POLICY IF EXISTS reviews_insert_policy ON public.reviews;

CREATE POLICY reviews_insert_policy ON public.reviews
  FOR INSERT TO authenticated
  WITH CHECK (
    (SELECT auth.uid()) = user_id
    AND verified = false
    AND status = 'pendente'
    AND COALESCE(
      (SELECT sc.enable_reviews FROM public.store_config sc WHERE sc.id = 1),
      true
    )
  );
