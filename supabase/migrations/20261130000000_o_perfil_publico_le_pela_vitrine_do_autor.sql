-- ============================================================================
-- Migration 20261130000000 — o perfil público lê avaliações e perguntas
-- pela vitrine do autor (brief
-- equipe/entregas/20260911-brief-perfil-publico-pela-vitrine-do-autor.md,
-- 11/09/2026)
-- ============================================================================
--
-- O DEFEITO: a migration 20261111000000 (já escrita, ainda NÃO aplicada)
-- tira o `anon` das policies de SELECT de `reviews`/`questions` — depois
-- dela, o visitante sem sessão só lê essas tabelas pelas views
-- `vw_reviews_public`/`vw_questions_public`, que NÃO têm `user_id` e por
-- isso não servem para filtrar por AUTOR. A tela `UserProfileView.tsx`
-- (perfil público, navegável por QUALQUER visitante sem login — regra de
-- produto do Gabriel, 11/09/2026: "perfil público NÃO exige login") lê
-- `reviews`/`questions` DIRETO DA TABELA filtrando por `user_id = <autor>`.
-- Aplicar a 20261111 sem este conserto faz o visitante sem sessão ver
-- "0 avaliações"/"0 perguntas" na vitrine de QUALQUER autor, mesmo quem
-- tem publicadas.
--
-- O QUE ESTA MIGRATION FAZ: duas RPCs `SECURITY DEFINER`, cada uma
-- recebendo só o `uuid` do autor — a tela já o conhece pela navegação/URL.
-- Nenhuma das duas devolve `user_id`, review pendente ou o uuid de um
-- produto não público: é isso que a RPC fecha, não um "alcance" emprestado
-- de `public_profiles` (que, aliás, é listável por qualquer visitante —
-- `public_profiles_select_policy USING (true)` — então "o mesmo alcance"
-- seria uma comparação errada de qualquer forma; o ganho real aqui é
-- devolver só o que já é público — review publicada, pergunta — sem
-- `user_id` e sem produto não público, não esconder quem existe):
--   - `perfil_publico_avaliacoes(p_autor)`: avaliações PUBLICADAS
--     (`status = 'publicada'`) daquele autor, com o produto (id/nome/imagem)
--     trazido por LEFT JOIN em `produtos` — as condições `ativo = true AND
--     deleted_at IS NULL` vivem no ON do JOIN, nunca num WHERE depois (um
--     WHERE ali viraria um INNER JOIN de fato e esconderia a avaliação
--     inteira quando o produto foi desativado ou apagado). Produto inativo,
--     apagado (soft delete via `deleted_at`) ou inexistente devolve NULL em
--     `product_id`, `produto_nome` e `produto_imagem_url` — a tela mostra
--     placeholder, nunca erro, e o uuid do produto não sai no JSON quando
--     ele não é público. A pendente do próprio autor NUNCA aparece aqui:
--     este caminho é só para quem não tem sessão.
--   - `perfil_publico_perguntas(p_autor)`: perguntas daquele autor, mesmo
--     LEFT JOIN de produto (mesmo NULL de `product_id`/nome/imagem quando o
--     produto não é público), com as respostas agregadas num `jsonb_agg`
--     (`{id, answer, created_at}`, ordenadas por `created_at ASC` — ordem
--     de quem respondeu primeiro), `COALESCE`ado para `'[]'` quando não há
--     resposta nenhuma.
-- Nenhuma das duas devolve `user_id` — nem o de quem perguntou/avaliou
-- (o próprio autor, que quem chama já conhece), nem o de quem RESPONDEU
-- (`answers.user_id` é de admin — furo pré-existente, documentado na
-- 20261111000000, fora do escopo desta migration e por isso deliberadamente
-- fora do jsonb agregado abaixo).
--
-- RISCO: SECURITY DEFINER que ignora RLS por dentro — mapa de risco ALTO
-- por definição. A superfície nova é exatamente o `RETURNS TABLE` de cada
-- função, nada além disso: nenhuma delas monta SQL dinâmico, nenhuma faz
-- `SELECT *`, e o único parâmetro é um `uuid` (sem como injetar). `REVOKE
-- EXECUTE ... FROM PUBLIC` roda antes do `GRANT` — só `anon`,
-- `authenticated` e `service_role` chamam.
--
-- DADOS EXISTENTES: aplicar este arquivo não lê nem escreve uma linha —
-- cria só as duas funções e os respectivos grants. Nenhuma tabela, coluna,
-- policy ou view muda.
--
-- IDEMPOTÊNCIA: `CREATE OR REPLACE FUNCTION` e os `REVOKE`/`GRANT` deixam
-- o mesmo estado se este arquivo for reaplicado. As duas funções são só
-- leitura (`STABLE`) — chamá-las qualquer número de vezes não tem efeito
-- colateral nenhum para "repetir" ou descolar.
--
-- FORA DO ESCOPO: o front que troca a leitura direta da tabela pela RPC
-- (peça separada da mesma bancada — arquivo `UserProfileView.tsx` não é
-- tocado aqui); a própria 20261111000000 (RLS do visitante, não aplicada
-- por este arquivo); o furo pré-existente de `answers.user_id` (quem
-- respondeu, não quem perguntou — documentado na 20261111, não corrigido
-- aqui).
--
-- COMO APLICAR: exclusivamente em transação externa, via
-- node scripts/db-apply.cjs (uma transação por arquivo) ou psql -1. O
-- corpo das duas funções é `LANGUAGE sql`, sem bloco PL/pgSQL — não há
-- `BEGIN`/`END` de função aqui, e nenhum controle de transação de nível
-- superior neste arquivo (regra da casa).
--
-- FICHA DE VERIFICAÇÃO pós-aplicação (rodar contra o banco; não rodada por
-- este agente):
--
--   1. SELECT proname FROM pg_proc WHERE proname IN
--      ('perfil_publico_avaliacoes','perfil_publico_perguntas');
--      -- esperado: 2 linhas.
--
--   2. SET ROLE anon;
--      SELECT * FROM public.perfil_publico_avaliacoes('<uuid de um autor
--      com avaliação publicada>');
--      -- esperado: a(s) linha(s) publicada(s), sem coluna user_id,
--      -- product_id/produto_nome/produto_imagem_url preenchidos quando o
--      -- produto está ativo e não apagado; NULL nos três quando não está.
--
--   3. SET ROLE anon;
--      SELECT * FROM public.perfil_publico_perguntas('<uuid do mesmo
--      autor>');
--      -- esperado: a(s) linha(s) de pergunta, com "answers" como array
--      -- json (vazio quando a pergunta não tem resposta).
--
--   4. SELECT has_function_privilege('anon',
--      'public.perfil_publico_avaliacoes(uuid)', 'EXECUTE'),
--      has_function_privilege('authenticated',
--      'public.perfil_publico_avaliacoes(uuid)', 'EXECUTE');
--      -- esperado: true, true (idem para perfil_publico_perguntas).
--
--   5. SELECT 1 FROM information_schema.role_routine_grants
--      WHERE routine_schema='public'
--        AND routine_name='perfil_publico_avaliacoes' AND grantee='PUBLIC';
--      -- esperado: 0 linhas (idem para perfil_publico_perguntas).
--
--   6. Prova completa: node scripts/db-prove-perfil-publico.cjs
--      (roda dentro de transação, ROLLBACK no fim — nada gravado).
--
-- ROLLBACK: rollback-manual-20261130000000_*.sql versionado junto — dois
-- `DROP FUNCTION IF EXISTS` pela assinatura `(uuid)`. Reverter PRIMEIRO o
-- front que chama estas RPCs; removê-las antes disso faz o visitante sem
-- sessão voltar a ver "—" na vitrine do autor na hora.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.perfil_publico_avaliacoes(p_autor uuid)
RETURNS TABLE (
  id uuid,
  product_id uuid,
  rating integer,
  comment text,
  created_at timestamptz,
  helpful integer,
  verified boolean,
  merchant_reply text,
  merchant_reply_at timestamptz,
  produto_nome text,
  produto_imagem_url text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    r.id,
    p.id AS product_id,
    r.rating,
    r.comment,
    r.created_at,
    r.helpful,
    r.verified,
    r.merchant_reply,
    r.merchant_reply_at,
    p.nome AS produto_nome,
    p.imagem_url AS produto_imagem_url
  FROM public.reviews r
  LEFT JOIN public.produtos p ON p.id = r.product_id AND p.ativo = true AND p.deleted_at IS NULL
  WHERE r.status = 'publicada' AND r.user_id = p_autor
  ORDER BY r.created_at DESC;
$$;

REVOKE EXECUTE ON FUNCTION public.perfil_publico_avaliacoes(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.perfil_publico_avaliacoes(uuid) TO anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.perfil_publico_perguntas(p_autor uuid)
RETURNS TABLE (
  id uuid,
  product_id uuid,
  question text,
  created_at timestamptz,
  produto_nome text,
  produto_imagem_url text,
  answers jsonb
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    q.id,
    p.id AS product_id,
    q.question,
    q.created_at,
    p.nome AS produto_nome,
    p.imagem_url AS produto_imagem_url,
    COALESCE(a.answers, '[]'::jsonb) AS answers
  FROM public.questions q
  LEFT JOIN public.produtos p ON p.id = q.product_id AND p.ativo = true AND p.deleted_at IS NULL
  LEFT JOIN LATERAL (
    SELECT jsonb_agg(
             jsonb_build_object(
               'id', an.id,
               'answer', an.answer,
               'created_at', an.created_at
             )
             ORDER BY an.created_at ASC
           ) AS answers
    FROM public.answers an
    WHERE an.question_id = q.id
  ) a ON true
  WHERE q.user_id = p_autor
  ORDER BY q.created_at DESC;
$$;

REVOKE EXECUTE ON FUNCTION public.perfil_publico_perguntas(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.perfil_publico_perguntas(uuid) TO anon, authenticated, service_role;
