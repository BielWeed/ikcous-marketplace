-- O VOTO ÚTIL GANHA MEMÓRIA NO SERVIDOR (laudo ofensiva+mobile do molde,
-- 31/08/2026, achado N2, conserto autorizado pelo Gabriel com "siga").
--
-- O DEFEITO PROVADO AO VIVO: `increment_helpful` somava
-- `helpful = helpful + 1` sem registrar QUEM votou — nenhuma tabela de votos.
-- Duas chamadas do MESMO usuário levaram uma avaliação de 4 para 6 (HTTP 204
-- nas duas). O conserto antigo do "voto útil" era só o botão travar na tela;
-- pela API, qualquer cliente logado infla qualquer avaliação (inclusive a
-- própria) quantas vezes quiser. Não existe desvoto: o `-1` do front
-- (useReviews.ts:294) é só o revert de erro.
--
-- A CURA: o voto vira REGISTRO antes de virar número.
--   1. Tabela `review_votes` com UNIQUE (review_id, user_id) — a deduplicação
--      inteira mora na constraint.
--   2. A RPC insere o voto com ON CONFLICT DO NOTHING: se o usuário já votou,
--      FOUND = false e a função retorna SEM tocar no contador — no-op
--      idempotente, com o MESMO contrato de chamada e retorno de antes
--      (nome, assinatura e `void` intactos; o front não muda).
--   3. Avaliação inexistente continua sendo no-op silencioso (contrato do
--      corpo antigo: o UPDATE sem linha não fazia nada) — a guarda de
--      EXISTS preserva isso e evita a FK violar onde antes não violava.
--
-- O CONTADOR HISTÓRICO fica como está: os `helpful` acumulados até aqui não
-- têm eleitor conhecido e não existe forma honesta de reconstruí-los. A
-- deduplicação vale para todo voto dado DEPOIS desta migration.
--
-- RLS da tabela: o cliente nunca precisa ler votos alheios (a policy de
-- SELECT devolve só os próprios; INSERT só amarrado a si mesmo). A RPC é
-- SECURITY DEFINER e roda como dona da tabela — o caminho do voto não
-- depende de policy; as policies existem para o acesso direto.
--
-- `CREATE OR REPLACE FUNCTION` preserva GRANT/dono (lição 448 do _REGRAS);
-- assinatura repetida idêntica para não criar sobrecarga silenciosa.
-- SEM BEGIN/COMMIT (regra da casa: com eles o ROLLBACK da prova vira no-op).
--
-- FICHA DE VERIFICAÇÃO pos-aplicação (banco do molde; uma avaliação real;
-- transação com ROLLBACK — nada fica gravado):
--   BEGIN;
--     SET LOCAL role authenticated;
--     SET LOCAL request.jwt.claims = '{"sub":"<uuid-do-usuario-de-teste>","role":"authenticated"}';
--     SELECT helpful FROM public.reviews WHERE id = '<uuid-de-review-real>';
--     SELECT public.increment_helpful('<uuid-de-review-real>');
--     SELECT public.increment_helpful('<uuid-de-review-real>');
--     SELECT helpful FROM public.reviews WHERE id = '<uuid-de-review-real>';
--     -> espera +1 UMA única vez (antes: +2)
--     SELECT count(*) FROM public.review_votes
--       WHERE review_id = '<uuid>' AND user_id = '<uuid-do-usuario>';
--     -> espera exatamente 1 linha
--   ROLLBACK;

CREATE TABLE IF NOT EXISTS public.review_votes (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    review_id uuid NOT NULL REFERENCES public.reviews (id) ON DELETE CASCADE,
    user_id uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
    created_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT review_votes_um_voto_por_usuario UNIQUE (review_id, user_id)
);

ALTER TABLE public.review_votes ENABLE ROW LEVEL SECURITY;

CREATE POLICY review_votes_select_policy
    ON public.review_votes FOR SELECT
    TO authenticated
    USING (user_id = (SELECT auth.uid()));

CREATE POLICY review_votes_insert_policy
    ON public.review_votes FOR INSERT
    TO authenticated
    WITH CHECK (user_id = (SELECT auth.uid()));

CREATE OR REPLACE FUNCTION public.increment_helpful(review_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
    -- A assinatura precisa continuar se chamando `review_id` (o PostgREST
    -- chama a RPC por NOME de argumento). Dentro do corpo, o v_ carrega o
    -- valor: na INSERT, o nome `review_id` é coluna da tabela-alvo e do
    -- parâmetro ao mesmo tempo — sem o v_, o PL/pgSQL trava com
    -- "column reference is ambiguous".
    v_review_id uuid := review_id;
BEGIN
    IF auth.uid() IS NULL THEN
        RAISE EXCEPTION 'Acesso negado: usuário não autenticado.';
    END IF;

    -- Avaliação inexistente: no-op silencioso, o MESMO contrato do corpo
    -- antigo (o UPDATE sem linha não fazia nada) — não deixa a FK violar
    -- onde antes não violava.
    IF NOT EXISTS (
        SELECT 1 FROM public.reviews WHERE id = v_review_id
    ) THEN
        RETURN;
    END IF;

    -- O voto vira REGISTRO antes de virar número: a UNIQUE (review_id,
    -- user_id) é a deduplicação inteira. Segunda chamada do mesmo usuário
    -- insere zero linhas (FOUND = false) e o contador NÃO anda.
    -- A inferência é PELO NOME DA CONSTRAINT, não pelas colunas: o parâmetro
    -- da função se chama `review_id` (o PostgREST chama a RPC por nome de
    -- argumento e o nome não pode mudar), e `ON CONFLICT (review_id, ...)`
    -- colidiria com ele — PL/pgSQL trava com "column reference is
    -- ambiguous". O nome da constraint não colide com nada.
    INSERT INTO public.review_votes (review_id, user_id)
    VALUES (v_review_id, auth.uid())
    ON CONFLICT ON CONSTRAINT review_votes_um_voto_por_usuario DO NOTHING;

    IF NOT FOUND THEN
        RETURN;
    END IF;

    UPDATE public.reviews
       SET helpful = COALESCE(helpful, 0) + 1
     WHERE id = v_review_id;
END;
$function$;
