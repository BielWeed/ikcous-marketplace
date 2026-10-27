-- ============================================================================
-- Migration 20261396200000 — o texto da avaliação tem teto no banco
-- (abuso de tamanho por quem só tem a chave pública + uma conta; caçada de segurança de 27/10/2026,
-- relatório 11-B, achado 5 — a irmã que faltou na 20261391000000)
-- ============================================================================
--
-- 1. O DEFEITO
--
-- A tela de avaliar limita o texto a 1000 caracteres (`src/components/ui/custom/ReviewForm.tsx`,
-- `maxLength={1000}`), mas `public.reviews.comment` é só `text` e nada no banco olha o tamanho: a
-- `reviews_insert_policy` confere autora, `verified = false`, `status = 'pendente'` e `enable_reviews`, e o gatilho
-- da 20261224000000 só limpa a resposta da loja, os úteis e a data. Pela API direta uma conta grava avaliação de
-- megabytes, que entra no painel de moderação (`get_admin_reviews_paged`), na consulta do `AdminLayout` e, se
-- aprovada, na vitrine pública.
--
-- 2. O QUE MUDA (só objeto NOVO; nenhuma linha lida ou reescrita)
--
-- CHECK `reviews_comment_ate_1000_caracteres` (`char_length(comment) <= 1000`, o mesmo teto da tela) em
-- `public.reviews`, criado NOT VALID: vale para TODA avaliação nova e para todo UPDATE a partir daqui, e NÃO reprova
-- as linhas antigas. `char_length` conta caracteres (pontos de código); o `maxLength` do HTML conta unidades UTF-16,
-- que são sempre ≥ — nada que a tela aceita é recusado aqui (provado com 1000 emojis). `comment` nulo passa (CHECK
-- com NULL não reprova): o app aceita avaliação só com estrelas. O texto da PERGUNTA já tem o mesmo desenho
-- (`questions_question_ate_500_caracteres`, 20261391000000; a tela limita a 500) e não é tocado aqui.
--
-- QUEM GRAVA `reviews.comment` HOJE (conferido no código): só `useReviews.addReview` (PostgREST, `.insert` com a
-- nota e o texto aparado de `ReviewForm`, já limitado a 1000). Nenhuma RPC nem edge function insere ou reescreve o
-- texto (`reply_review_atomic`, `increment_helpful`, a moderação e o gatilho do selo atualizam OUTRAS colunas); o
-- painel não edita o texto. Nada legítimo estoura 1000.
--
-- 3. ⚠️ A GUARDA: A MIGRATION SE RECUSA A APLICAR SE JÁ HOUVER AVALIAÇÃO ACIMA DE 1000 (leia antes de aplicar)
--
-- NOT VALID só dispensa a conferência das linhas existentes NO MOMENTO do ADD. O Postgres confere o CHECK em TODO
-- INSERT e em TODO UPDATE da linha, mesmo que a coluna `comment` não mude. Logo, uma avaliação antiga com mais de
-- 1000 caracteres (só nasce por chamada direta à API, já que a tela barra) travaria qualquer alteração dela: a
-- moderação (aprovar/recusar), o voto de "útil" (`increment_helpful`), a resposta da loja (`reply_review_atomic`) E,
-- pior, o gatilho `tr_compra_verifica_avaliacoes` (20261030000000, AFTER UPDATE OF payment_status em
-- `marketplace_orders`), que atualiza as avaliações da compradora quando o pedido é marcado como pago: com uma
-- avaliação antiga acima de 1000, o pagamento do pedido dela FALHARIA (23514) e NÃO seria registrado (provado em
-- Postgres 17 pela revisão).
--
-- Por isso a migration TEM UMA GUARDA: logo depois do ADD CONSTRAINT (a tabela já está trancada, então nenhuma
-- avaliação nova entra entre a conferência e o fim), ela procura avaliação com mais de 1000 caracteres e, se achar,
-- ABORTA com `B1_BASELINE_DIVERGENT` — a transação inteira desfaz, o CHECK não fica e nada muda. Nesse caso NÃO
-- aplicar nessa loja sem decidir o que fazer com essas linhas (encurtar à mão ou apagar são decisões da lojista;
-- esta migration não faz nenhuma das duas). Medição prévia, só leitura, em cada loja (esperado 0):
--
--   SELECT count(*) AS acima_de_1000, max(char_length(comment)) AS maior
--     FROM public.reviews WHERE char_length(comment) > 1000;
--
-- Custo da guarda: uma varredura de `reviews` com a tabela trancada, dentro do `statement_timeout` de 30 s (a tabela
-- é pequena numa loja). O `VALIDATE CONSTRAINT` fica de fora de propósito: esta migration não o roda.
--
-- 4. PRÉ-VOO (B1_BASELINE_DIVERGENT, ANTES de qualquer escrita)
--
-- `reviews.comment` tem de existir como text; o CHECK, se já existir, tem de ser exatamente este (NOT VALID ou já
-- validado). Estados aceitos: o CHECK não existe (aplica) ou existe como desenhado (reaplicar é no-op).
--
-- 5. IDEMPOTÊNCIA, TRANSAÇÃO E TRAVA
--
-- O CHECK só é criado se ainda não existe: rodar duas vezes deixa o mesmo estado. Sem BEGIN/COMMIT de nível
-- superior (regra da casa): o aplicador dá a transação; pré-voo, criação e conferência caem juntos ou não caem.
-- `ADD CONSTRAINT … CHECK` tranca `reviews` por um instante (ACCESS EXCLUSIVE): com `lock_timeout = 5s`, loja em uso
-- falha limpo em vez de travar quem avalia — repetir depois. Nenhum GRANT/REVOKE; nenhuma função nova.
--
-- 6. ORDEM E ROLLBACK
--
-- Nenhuma dependência de outra migration além da tabela `reviews`. Nenhum front e nenhuma edge function mudam: banco
-- antes ou depois do front dá no mesmo. ROLLBACK MANUAL: rollback-manual-20261396200000_o_texto_da_avaliacao_tem_teto_no_banco.sql
-- tira o CHECK (único objeto criado aqui). Nenhuma linha muda.
--
-- 7. FICHA DE VERIFICAÇÃO: consultas 114a (depois) / 114b (antes).
--   PROVA VIVA: tests/banco/o-texto-da-avaliacao-tem-teto-no-banco-viva.cjs (rpc-ci).
-- ============================================================================

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

DO $preflight_20261396200000$
DECLARE
  v_def text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid = to_regclass('public.reviews')
                    AND a.attname = 'comment' AND a.atttypid = 'text'::regtype AND NOT a.attisdropped) THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: public.reviews.comment (text) não existe — meça a loja e revise antes de aplicar.';
  END IF;
  SELECT pg_get_constraintdef(c.oid) INTO v_def
    FROM pg_constraint c
   WHERE c.conrelid = 'public.reviews'::regclass AND c.conname = 'reviews_comment_ate_1000_caracteres';
  IF FOUND AND v_def NOT IN ('CHECK ((char_length(comment) <= 1000)) NOT VALID',
                             'CHECK ((char_length(comment) <= 1000))') THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: reviews_comment_ate_1000_caracteres já existe com outra regra (%) — revise antes de aplicar.', v_def;
  END IF;
END $preflight_20261396200000$;

-- O teto do texto da avaliação: o mesmo da tela. NOT VALID — as linhas antigas não são reprovadas no ADD.
DO $teto_da_avaliacao_20261396200000$
DECLARE
  v_acima bigint;
  v_maior integer;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint c
                  WHERE c.conrelid = 'public.reviews'::regclass
                    AND c.conname = 'reviews_comment_ate_1000_caracteres') THEN
    ALTER TABLE public.reviews
      ADD CONSTRAINT reviews_comment_ate_1000_caracteres CHECK (char_length(comment) <= 1000) NOT VALID;

    -- A GUARDA (cabeçalho, seção 3): com o CHECK ativo, avaliação antiga acima de 1000 trava qualquer alteração dela,
    -- inclusive o gatilho do pagamento do pedido (tr_compra_verifica_avaliacoes). A tabela já está trancada pelo ADD.
    SELECT count(*), max(char_length(comment)) INTO v_acima, v_maior
      FROM public.reviews WHERE char_length(comment) > 1000;
    IF v_acima > 0 THEN
      RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: há % avaliação(ões) com mais de 1000 caracteres em public.reviews (a maior tem %) — a migration NÃO foi aplicada (a transação desfaz tudo e o CHECK não fica). Com o CHECK ativo essas linhas travariam qualquer alteração delas, inclusive o registro do pagamento do pedido da compradora (tr_compra_verifica_avaliacoes). Decida o que fazer com essas avaliações (encurtar ou apagar é decisão da lojista) e aplique de novo.', v_acima, v_maior;
    END IF;
  END IF;
END $teto_da_avaliacao_20261396200000$;

-- CONFERÊNCIA no instante do apply.
DO $conferencia_20261396200000$
BEGIN
  IF NOT EXISTS (
       SELECT 1 FROM pg_constraint c
        WHERE c.conrelid = 'public.reviews'::regclass AND c.conname = 'reviews_comment_ate_1000_caracteres'
          AND c.contype = 'c'
          AND pg_get_constraintdef(c.oid) IN ('CHECK ((char_length(comment) <= 1000)) NOT VALID',
                                              'CHECK ((char_length(comment) <= 1000))')
     ) THEN
    RAISE EXCEPTION 'conferencia 20261396200000: o CHECK de 1000 caracteres de reviews não ficou';
  END IF;
END $conferencia_20261396200000$;
