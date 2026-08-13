-- ADMIN-080 (issue #100): o modal de Perguntas e Respostas do painel admin
-- (AdminQAView.tsx) e a caixa de resposta da página do produto (ProductQA.tsx)
-- se comportam como editor (vêm pré-preenchidos, avisam sobre alteração não
-- salva), mas as duas sobrecargas de answer_question_atomic sempre fizeram
-- `INSERT INTO answers (...) VALUES (...)` seco -- sem ON CONFLICT, sem
-- checar se já existia resposta. Cada "edição" criava uma segunda linha em
-- answers, empilhada na página do produto e no perfil do cliente, sem UI
-- para apagar. Essa é a origem real: nunca existiu aqui um caminho
-- `IF EXISTS THEN UPDATE ELSE INSERT` em produção -- o baseline
-- (20260806000000) tem o INSERT seco nas duas sobrecargas, e a revisão desta
-- migration mediu no banco vivo que nenhuma das duas tinha ON CONFLICT antes
-- de hoje.
--
-- Decisao (brief da trilha 3, nao a issue): a RPC passa a fazer upsert por
-- question_id. Sem criar um segundo caminho de update no front -- a
-- atomicidade continua so no banco.
--
-- ATUALIZACAO 12/08/2026 (mesmo dia, apos a sessao principal inspecionar a
-- duplicata medida acima): ficou provado que as duas linhas de
-- question_id=880b0fbb-c88e-4e3c-a7b4-256ff0d982ef sao o proprio bug desta
-- issue em acao -- a mesma resposta, "editada" 14 minutos depois, virou uma
-- segunda linha. Decisao (nao do implementador anterior, da sessao
-- principal): fica a resposta MAIS RECENTE. E' literalmente o criterio de
-- aceite da #100: "a pagina do produto mostra uma unica resposta, a mais
-- recente".
--
-- ATUALIZACAO 12/08/2026 (revisão da Trilha 3, contexto limpo): a revisão
-- BLOQUEOU a primeira versão deste arquivo por 6 motivos, todos endereçados
-- abaixo -- o achado que bloqueava de fato (ProductQA nascendo sempre vazio,
-- inclusive em pergunta já respondida) foi corrigido em
-- src/components/ui/custom/ProductQA.tsx, fora desta migration. Aqui:
--
--   1. Um DELETE que, para cada question_id com mais de uma linha em
--      answers, apaga todas menos a de created_at mais recente. Empate
--      exato de created_at desempata pelo maior id (uuid), para o resultado
--      nao depender da ordem fisica das linhas na tabela -- ver prova em
--      scripts/db-prove-admin-080.cjs. ESTE DELETE APAGA DADOS. Ele nunca
--      apaga a UNICA resposta de uma pergunta (uma pergunta com 1 resposta
--      tem row_number()=1 para essa linha, e so se apaga row_number()>1).
--      A query e' idempotente: rodar de novo depois que ja rodou uma vez
--      nao acha nada para apagar (nao ha mais question_id duplicado). Toda
--      linha apagada vai, na MESMA transação, para
--      answers_dedup_backup_20260812 -- a revisão apontou que uma duplicata
--      pode ser DUAS respostas independentes (a caixa da página do produto
--      também escrevia via addAnswer, então uma duplicata não é só um
--      rascunho superado) e o rollback deste `db-apply.cjs` não cobria
--      DELETE nenhum. Ver comentário na CREATE TABLE abaixo sobre por que
--      essa tabela não é legível pela API.
--   2. Um indice unico em answers(question_id) -- so consegue ser criado
--      porque o DELETE acima ja rodou e nao ha mais duplicata. Logo depois,
--      um bloco DO que CONSULTA pg_index/pg_class para confirmar que existe
--      de verdade um índice único sobre EXATAMENTE (question_id) -- não
--      basta o nome bater. `CREATE UNIQUE INDEX IF NOT EXISTS` casa por
--      NOME: numa loja que já tivesse um índice chamado
--      idx_answers_question_id_unique sem ser único nessa coluna, o passo
--      viraria no-op silencioso, as funções abaixo subiriam normalmente
--      (corpo de plpgsql não é planejado na criação) e a RPC só estouraria
--      em tempo de execução, com "there is no unique or exclusion
--      constraint matching the ON CONFLICT specification" -- derrubando o
--      ato de responder pergunta bem depois de a migration já ter sido
--      reportada como aplicada.
--   3. O índice idx_answers_question_id (baseline, mesma coluna e mesma
--      ordem do índice único novo) fica redundante -- removido nesta
--      migration.
--   4. As duas sobrecargas de answer_question_atomic, reescritas do INSERT
--      seco (ver correção de história no topo deste comentário) para
--      `INSERT ... ON CONFLICT (question_id) DO UPDATE`. E' o padrao
--      idiomatico do Postgres para upsert e, mais importante, fecha uma
--      corrida que o INSERT seco deixava aberta: duas chamadas concorrentes
--      da RPC para a mesma pergunta podiam ambas inserir -- reabrindo a
--      duplicata que o DELETE acima acabou de fechar. So funciona por causa
--      do indice do passo 2 (ON CONFLICT precisa de uma constraint/indice
--      unico para inferir o alvo do conflito).
--
-- SEM BEGIN/COMMIT: o db-apply.cjs abre a transacao.

-- Passo 1: deduplicar, guardando o que foi apagado. Ver comentario acima --
-- este DELETE apaga linhas de public.answers.
--
-- POR QUE UMA TABELA NOVA, E NAO GRAVAR NUM LOG JA EXISTENTE: o repositorio
-- nao tem um padrao de "tabela so-forense" para copiar -- push_notifications_log
-- e' a unica outra tabela de log interno do schema, e ela e' legivel pelo
-- admin via policy (`push_notifications_log_admin_all_policy`), porque um
-- notification log nao e' sensivel do jeito que uma resposta apagada e'.
-- Aqui o conteudo pertence a loja de um cliente e nao deve ser servido nem
-- pela API publica nem pelo painel -- so por quem tem acesso direto ao
-- banco (postgres/service_role, que ignoram RLS). Por isso: RLS habilitada
-- SEM NENHUMA policy (nega tudo por padrao para anon/authenticated) mais um
-- REVOKE ALL explicito, no mesmo espirito do REVOKE SELECT que
-- 20260323000001_fix_produtos_custo_leak.sql ja usa neste repositorio contra
-- o GRANT automatico que o Supabase aplica em tabela nova do schema public.
CREATE TABLE IF NOT EXISTS public.answers_dedup_backup_20260812 (
    id "uuid" NOT NULL,
    question_id "uuid" NOT NULL,
    user_id "uuid" NOT NULL,
    answer "text" NOT NULL,
    created_at timestamp with time zone NOT NULL,
    apagado_em timestamp with time zone DEFAULT "timezone"('utc'::"text", "now"()) NOT NULL,
    PRIMARY KEY (id)
);

ALTER TABLE public.answers_dedup_backup_20260812 ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.answers_dedup_backup_20260812 FROM "anon", "authenticated";

WITH ranked AS (
    SELECT id,
           row_number() OVER (
               PARTITION BY question_id
               ORDER BY created_at DESC, id DESC
           ) AS rn
      FROM public.answers
),
apagadas AS (
    DELETE FROM public.answers a
    USING ranked
    WHERE a.id = ranked.id
      AND ranked.rn > 1
    RETURNING a.id, a.question_id, a.user_id, a.answer, a.created_at
)
INSERT INTO public.answers_dedup_backup_20260812
    (id, question_id, user_id, answer, created_at)
SELECT id, question_id, user_id, answer, created_at FROM apagadas;

-- Passo 2: indice unico, pre-requisito do ON CONFLICT (question_id) abaixo.
CREATE UNIQUE INDEX IF NOT EXISTS idx_answers_question_id_unique
    ON public.answers (question_id);

-- Passo 2b: confirmar de VERDADE que existe um indice unico sobre
-- exatamente (question_id) -- ver motivo no comentario do topo (ponto 2).
-- `CREATE UNIQUE INDEX IF NOT EXISTS` casa por nome; isto consulta o
-- catalogo e falha alto (aborta a migration inteira, dentro da transacao do
-- db-apply.cjs) se o indice existente nao servir.
DO $$
DECLARE
    v_indisunique boolean;
    v_natts smallint;
    v_colname text;
BEGIN
    SELECT i.indisunique, i.indnatts
      INTO v_indisunique, v_natts
      FROM pg_index i
      JOIN pg_class c ON c.oid = i.indexrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public'
       AND c.relname = 'idx_answers_question_id_unique'
       AND i.indrelid = 'public.answers'::regclass;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'idx_answers_question_id_unique nao existe apos o CREATE UNIQUE INDEX -- ON CONFLICT (question_id) da RPC vai falhar em tempo de execucao.';
    END IF;

    IF NOT v_indisunique THEN
        RAISE EXCEPTION 'idx_answers_question_id_unique existe mas NAO e unico -- provavelmente colidiu com um indice homonimo pre-existente. ON CONFLICT (question_id) exige um indice/constraint unico de verdade.';
    END IF;

    IF v_natts <> 1 THEN
        RAISE EXCEPTION 'idx_answers_question_id_unique nao e um indice de uma unica coluna (tem % colunas). ON CONFLICT (question_id) exige exatamente essa coluna.', v_natts;
    END IF;

    SELECT a.attname
      INTO v_colname
      FROM pg_index i
      JOIN pg_class c ON c.oid = i.indexrelid
      JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = i.indkey[0]
     WHERE c.relname = 'idx_answers_question_id_unique'
       AND i.indrelid = 'public.answers'::regclass;

    IF v_colname IS DISTINCT FROM 'question_id' THEN
        RAISE EXCEPTION 'idx_answers_question_id_unique nao esta sobre question_id (esta sobre %). ON CONFLICT (question_id) vai falhar.', v_colname;
    END IF;
END $$;

-- Passo 3: idx_answers_question_id (baseline, mesma coluna e mesma ordem do
-- indice unico criado acima) fica redundante -- toda busca que ele atendia
-- o indice unico atende igual. Removido para nao pagar custo de escrita e
-- espaco em dobro em cada loja clonada.
DROP INDEX IF EXISTS public.idx_answers_question_id;

CREATE OR REPLACE FUNCTION public.answer_question_atomic("p_question_id" "uuid", "p_answer" "text") RETURNS "void"
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
    v_user_id uuid;
    v_product_name text;
    v_product_id uuid;
    v_admin_id uuid;
BEGIN
    -- SECURITY CHECK: Ensure the caller is an admin
    v_admin_id := auth.uid();
    IF NOT EXISTS (SELECT 1 FROM profiles WHERE id = v_admin_id AND role = 'admin') THEN
        RAISE EXCEPTION 'Unauthorized: Only admins can answer questions.';
    END IF;

    -- 1. Upsert Answer (idx_answers_question_id_unique, criado por esta
    -- migration, e' quem permite o ON CONFLICT inferir o alvo)
    INSERT INTO answers (question_id, user_id, answer)
    VALUES (p_question_id, v_admin_id, p_answer)
    ON CONFLICT (question_id) DO UPDATE
       SET answer     = EXCLUDED.answer,
           user_id    = EXCLUDED.user_id,
           created_at = timezone('utc', now());

    -- 2. Get Question Info
    SELECT user_id, product_id INTO v_user_id, v_product_id
    FROM questions WHERE id = p_question_id;

    IF v_product_id IS NOT NULL THEN
        SELECT nome INTO v_product_name FROM produtos WHERE id = v_product_id;

        -- 3. Log Notification
        INSERT INTO push_notifications_log (title, body, url, recipient_count, created_by)
        VALUES (
            'Sua pergunta foi respondida!',
            'A loja respondeu à sua pergunta sobre o produto ' || COALESCE(v_product_name, 'selecionado') || '.',
            '/product/' || v_product_id,
            1,
            v_admin_id
        );
    END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.answer_question_atomic("p_question_id" "uuid", "p_answer" "text", "p_admin_id" "uuid") RETURNS "void"
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
    v_user_id uuid;
    v_product_name text;
    v_product_id uuid;
BEGIN
    -- SECURITY CHECK: Reject any caller that is not an admin
    IF NOT public.is_admin() THEN
        RAISE EXCEPTION 'Unauthorized: Only admins can answer questions.';
    END IF;

    -- 1. Upsert Answer (mesmo caminho da sobrecarga de 2 args, ver acima)
    INSERT INTO public.answers (question_id, user_id, answer)
    VALUES (p_question_id, p_admin_id, p_answer)
    ON CONFLICT (question_id) DO UPDATE
       SET answer     = EXCLUDED.answer,
           user_id    = EXCLUDED.user_id,
           created_at = timezone('utc', now());

    -- 2. Get Question Info
    SELECT user_id, product_id INTO v_user_id, v_product_id
    FROM public.questions WHERE id = p_question_id;

    IF v_product_id IS NOT NULL THEN
        SELECT nome INTO v_product_name FROM public.produtos WHERE id = v_product_id;

        -- 3. Log Notification
        INSERT INTO public.push_notifications_log (title, body, url, recipient_count, created_by)
        VALUES (
            'Sua pergunta foi respondida!',
            'A loja respondeu a sua pergunta sobre o produto ' || COALESCE(v_product_name, 'selecionado') || '.',
            '/product/' || v_product_id,
            1,
            p_admin_id
        );
    END IF;
END;
$$;

COMMENT ON FUNCTION public.answer_question_atomic(uuid, text) IS
  'Upsert por question_id via ON CONFLICT (issue #100), amparado pelo indice '
  'unico idx_answers_question_id_unique e pelo DELETE de deduplicacao desta '
  'mesma migration -- ver comentario no topo de 20260812000000. Remover '
  'resposta pela UI continua fora do escopo desta migration.';

COMMENT ON FUNCTION public.answer_question_atomic(uuid, text, uuid) IS
  'Upsert por question_id (issue #100), mesma ressalva da sobrecarga de 2 args.';
