-- O visitante anônimo passa a ler avaliações e perguntas por uma VITRINE
-- pública, sem a coluna do autor (I-3/I-4, brief hub-0809-g 08/09/2026:
-- equipe/entregas/20260908-brief-i3-i4-anon-nao-le-autor-nem-grava-analytics.md).
--
-- O DEFEITO (medido em 08/09/2026, na bancada, contra `origin/develop` =
-- ba741b1): `questions_select_policy` é `USING (true)` — QUALQUER visitante,
-- sem login, lê `questions.user_id` de toda pergunta pública
-- (baseline:5815). `reviews_select_policy` (20261031000000) já filtra por
-- `status = 'publicada'`, mas devolve a LINHA INTEIRA das publicadas —
-- `user_id` incluído. O front confirma o alcance: `useReviews.ts` e
-- `useQuestions.ts` chamam `.from("reviews"|"questions").select("*, ...")`
-- SEM checar login (`getReviewsByProduct`/`getQuestionsByProduct`, ambos
-- chamados incondicionalmente por `ProductView`/`ProductQA`, a página do
-- produto) — o `user_id` de quem escreveu cada avaliação/pergunta pública
-- vai para QUALQUER requisição com a chave anônima.
--
-- ESTA MIGRATION É ADITIVA (só cria; nada é removido nem restringido) —
-- pode ser aplicada pela carta branca de 07/09, mas só DEPOIS da revisão
-- Opus. Ela sozinha NÃO fecha o furo: as duas migrations irmãs
-- (20261111000000 e 20261112000000, NÃO aditivas) é que retiram o `anon`
-- das policies — e essas exigem o SQL mostrado ao Gabriel antes de aplicar
-- (carta branca não cobre NÃO aditiva). "Banco novo + tela velha liga o
-- defeito" (memoria/aplicar-no-banco-sem-conferir-o-que-esta-no-ar.md): a
-- ordem certa é 1) esta migration, 2) o front (mesmo PR) passar a ler das
-- views, 3) só então as duas NÃO aditivas.
--
-- O QUE ESTA MIGRATION FAZ:
--   1. `vw_reviews_public` — as mesmas colunas públicas de `reviews`
--      (produto, nota, comentário, data, `helpful`, `verified`, resposta da
--      loja), SEM `user_id`, só as avaliações `status = 'publicada'`
--      (pendente nunca aparece a quem não é o autor nem admin — mesmo
--      critério de `reviews_select_policy`). O "nome do autor" que a tela
--      mostra hoje (`ReviewCard`) vem de um JOIN em `public_profiles`
--      (`user:public_profiles(full_name, avatar_url)`, medido em
--      `useReviews.ts`) — a view devolve só `author_name`/
--      `author_avatar_url`, nunca o id.
--   2. `vw_questions_public` — colunas públicas de `questions` (produto,
--      pergunta, data), com `author_name`/`author_avatar_url` pelo mesmo
--      JOIN, e SEM `user_id`. `answers` (a resposta da loja) NÃO faz parte
--      desta view: a tabela já é 100% pública (`answers_select_policy USING
--      (true)`, `roles={-}` isto é PUBLIC, `anon` com GRANT SELECT — mas
--      COM coluna sensível: `answers.user_id uuid NOT NULL` existe desde o
--      baseline. Não é o autor da pergunta que vaza ali — é o id de quem
--      RESPONDEU, e só admin responde (`answers_admin_insert_policy`); é um
--      furo pré-existente, fora do escopo desta frente, registrado em
--      `20261111000000` (achado D1 do laudo Opus PR#484, 08/09/2026) — e não
--      muda nesta frente; o front busca a resposta à parte, com uma segunda
--      consulta em `answers` filtrada por `question_id`.
--   2b. `is_verified_buyer` NÃO entra nesta view (correção B2 do laudo Opus
--      PR#484, 08/09/2026 — a versão anterior desta migration tinha essa
--      coluna e foi REPROVADA). A view não é `security_invoker`: um `EXISTS`
--      sobre `marketplace_orders`/`marketplace_order_items` dentro dela
--      rodaria com o crachá do dono, atravessando a RLS de pedidos
--      (`marketplace_orders_select_policy`/`order_items_all_policy`, ambas
--      `TO authenticated`, sem policy nenhuma para `anon`). O selo
--      "Comprador" NÃO é visível ao visitante anônimo HOJE — medido ao vivo:
--      a consulta que o front hoje faz para calculá-lo
--      (`useQuestions.ts`, `.from("marketplace_orders")...`) devolve ZERO
--      linhas para quem não tem sessão, porque a RLS nega `anon` nas duas
--      tabelas. Colocar o cálculo dentro da view teria ENTREGUE ao visitante
--      um fato que a RLS de hoje já nega — "pessoa nomeada comprou e
--      recebeu o produto X" — exatamente a classe de vazamento que este PR
--      existe para fechar. O selo do visitante sem sessão fica sempre
--      `false` (`isVerified: false` no ramo anônimo de `useQuestions.ts`) —
--      reproduz o comportamento de hoje, é o "nada visível" que o brief
--      pediu, e não é decisão de produto nova.
--
-- POR QUE AS DUAS VIEWS NÃO SÃO `security_invoker` (a exceção documentada
-- na skill `nova-migration`, mesmo molde de `vw_produtos_public` —
-- `20260806000000:4377`, sem `security_invoker`): a migration IRMÃ
-- 20261111000000 restringe `reviews_select_policy`/`questions_select_policy`
-- para `TO authenticated` — depois dela, o `anon` não tem NENHUMA policy
-- permissiva em `reviews`/`questions`, e uma view `security_invoker` herdaria
-- essa RLS do chamador e devolveria SEMPRE zero linhas para o visitante,
-- inclusive as avaliações publicadas que deveriam aparecer. A view roda com
-- o crachá do dono (bypassa RLS de propósito, como a `vw_produtos_public` já
-- faz por causa do mesmo tipo de restrição) e o próprio `WHERE` dela
-- (`status = 'publicada'` em reviews) é quem decide o que é público — a
-- MESMA garantia que a policy dava, agora dentro da view.
--
-- RISCO: BAIXO por si (só cria; GRANT SELECT é o que os visitantes já
-- tinham antes por outro caminho) — mas serve de base para o RISCO ALTO das
-- duas migrations seguintes, que dependem do front já ler daqui.
--
-- SEM BEGIN/COMMIT (regra da casa: com eles, o ROLLBACK do script de prova
-- vira no-op e a mudança fica gravada).
--
-- FICHA DE VERIFICAÇÃO pós-aplicação (rodar contra o banco; não rodada por
-- este agente — as duas views AINDA não têm nenhum `anon` lendo por elas
-- até o front deste mesmo PR ser publicado):
--
--   -- 1. As views existem e têm as colunas certas (sem user_id):
--   SELECT column_name FROM information_schema.columns
--   WHERE table_schema = 'public' AND table_name = 'vw_reviews_public'
--   ORDER BY ordinal_position;
--   -- esperado: id, product_id, rating, comment, created_at, helpful,
--   -- verified, merchant_reply, merchant_reply_at, author_name,
--   -- author_avatar_url — SEM user_id, SEM status.
--
--   SELECT column_name FROM information_schema.columns
--   WHERE table_schema = 'public' AND table_name = 'vw_questions_public'
--   ORDER BY ordinal_position;
--   -- esperado: id, product_id, question, created_at, author_name,
--   -- author_avatar_url — SEM user_id, SEM is_verified_buyer (B2: a coluna
--   -- atravessava a RLS de pedidos e vazava ao anônimo um fato que ela hoje
--   -- nega; ver o item 2b acima).
--
--   -- 2. `anon` alcança as views (SET ROLE anon; SELECT * FROM
--   --    vw_reviews_public LIMIT 1; SELECT * FROM vw_questions_public
--   --    LIMIT 1;) sem erro de permissão.
--
--   -- 3. Uma avaliação PENDENTE de teste não aparece na view (mesmo filtro
--   --    da policy):
--   --    UPDATE reviews SET status = 'pendente' WHERE id = '<teste>';
--   --    SET ROLE anon; SELECT * FROM vw_reviews_public WHERE id = '<teste>';
--   --    -> zero linhas. UPDATE de volta para 'publicada' e apagar depois.
--
-- ROLLBACK: rollback-manual-20261110000000_*.sql versionado junto (DROP das
-- duas views — nenhum dado é apagado, só o objeto de leitura).

CREATE VIEW public.vw_reviews_public AS
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

CREATE VIEW public.vw_questions_public AS
SELECT
  q.id,
  q.product_id,
  q.question,
  q.created_at,
  pp.full_name AS author_name,
  pp.avatar_url AS author_avatar_url
FROM public.questions q
LEFT JOIN public.public_profiles pp ON pp.id = q.user_id;

-- GRANT explícito (documentação viva — o padrão de privilégio default do
-- banco já concede isto a objeto novo em `public`; o REVOKE abaixo é que
-- muda o estado real, tirando da view o pacote de escrita/manutenção que o
-- default também concede e que uma vitrine só-leitura não deveria ter —
-- mesma disciplina da 20261090000000 para `vw_produtos_public`):
GRANT SELECT ON public.vw_reviews_public TO anon, authenticated, service_role;
GRANT SELECT ON public.vw_questions_public TO anon, authenticated, service_role;

REVOKE INSERT, UPDATE, DELETE, TRUNCATE, TRIGGER, MAINTAIN
  ON public.vw_reviews_public FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, TRIGGER, MAINTAIN
  ON public.vw_questions_public FROM anon, authenticated;
