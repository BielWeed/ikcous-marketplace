-- A CLIENTE É AVISADA QUANDO A LOJA RESPONDE A PERGUNTA DELA (achado do caçador, 14/10/2026).
--
-- O DEFEITO (medido num banco montado só com as migrations do repositório, em 14/10/2026): a tela de perguntas do
-- painel diz "Notificar Cliente", mas `answer_question_atomic` só gravava a resposta e UMA linha em
-- `push_notifications_log` ("Sua pergunta foi respondida!", 0 aparelhos, status `sent`). Nenhum push saía (a única
-- função de borda que envia push, `send-push`, só é chamada pelo painel de campanhas e pelo painel de pedidos) e
-- NENHUM aviso nascia no sino da cliente (`notificacoes` ficava com 0 linhas): quem perguntou "tem no M?" nunca
-- soube que a loja respondeu. Efeito colateral para a lojista: cada resposta virava uma linha falsa no histórico de
-- campanhas (selo "Não confirmada") e, depois de ~20 respostas, empurrava as campanhas reais para fora da lista
-- de 20 do painel.
--
-- O QUE ESTA MIGRATION FAZ (só o corpo de DUAS funções muda; assinatura, SECURITY DEFINER, search_path e ACL ficam
-- como estão — o CREATE OR REPLACE os preserva):
--   * `answer_question_atomic(uuid, text)`        — o caminho que o app usa (useQuestions.ts);
--   * `answer_question_atomic(uuid, text, uuid)`  — a sobrecarga de 3 argumentos (sem chamador no app, mas viva
--                                                   no banco e com o MESMO defeito; a 20261064 já as tratou juntas).
--   Em ambas, o passo 3 troca "gravar a linha falsa em push_notifications_log" por "criar o aviso no sino da
--   cliente que PERGUNTOU": uma linha em `notificacoes` (a mesma tabela que o sino já lê, com a mesma assinatura
--   das mudanças de pedido da 20261026):
--       usuario_id = quem perguntou, tipo 'info', título "Sua pergunta foi respondida",
--       mensagem "A loja respondeu sua pergunta sobre <produto>.",
--       dados = {question_id, product_id}, acao = {url: '/product-detail?id=<produto>'} (o sino abre o produto).
--   NÃO envia push (isso exige a edge function e rede; fora do escopo). O sino acende sozinho pelo realtime que
--   o NotificationContext já escuta.
--
-- DECISÕES:
--   * UM aviso por pergunta. A resposta repetida ou EDITADA não cria outro aviso (a cliente abre o produto e vê
--     o texto atual): o INSERT só roda se NÃO existir aviso daquela cliente para aquela `question_id`. Se ela
--     dispensou o aviso e a loja edita a resposta de novo, nasce um aviso novo — é um aviso de correção, e é o que
--     a cliente quer receber.
--   * Pergunta antiga (respondida antes desta migration, sem aviso): se a loja editar a resposta, nasce o aviso
--     que ela nunca recebeu. Nada é criado em massa; nenhum dado existente é tocado.
--   * O aviso é best-effort, como o das mudanças de pedido (20261026): se o INSERT falhar por qualquer motivo, a
--     RESPOSTA da loja NUNCA é perdida — o aviso fica para trás, logado como WARNING no servidor.
--   * A linha falsa em `push_notifications_log` deixa de nascer. As linhas que já nasceram NÃO são apagadas aqui
--     (apagar dado existente é decisão do dono); o painel de campanhas as esconde do histórico (front).
--   * `reply_review_atomic` (a resposta à AVALIAÇÃO) tem o mesmo defeito e NÃO é tocada por esta migration: a
--     consulta de medição 27m (`scripts/publicacao/consultas/27m-medir-avaliacao-forjada.sql`) usa a linha do log
--     "Sua avaliação foi respondida!" como o rastro de que a resposta da loja é legítima, e parar de gravá-la
--     faria as respostas novas aparecerem como "SUSPEITA FORTE". Fica para uma migration própria, junto com o
--     ajuste dessa consulta.
--
-- PRÉ-VOO: recusa sem escrever se o corpo vivo de qualquer das duas funções não é o vigente (20261065 e 20261064)
-- nem o desta migration, se há sobrecarga extra, se os atributos mudaram ou se falta coluna que o corpo usa.
-- SEM BEGIN/COMMIT (regra da casa: o db-apply abre a transação).
--
-- HASHES (md5 do corpo sem CR): answer_question_atomic(uuid,text) antes 8cf000b6c9ed27f482906752469f08ff /
-- depois 1268df6cb364dfb46b5c535e007bb2d0; answer_question_atomic(uuid,text,uuid) antes ad99d54575ac95445103ea5b78e4a1e8 /
-- depois b62a4186ff8d58955973f53d6c0f302b. O corpo vivo de IKCOUS (cafkrminfnokvgjqtkle) e Savy (gnjsrucsmjkajijrakzr) foi medido em
-- 14/10/2026 e é igual ao "antes" nas duas lojas.
--
-- ROLLBACK MANUAL: versionado em
-- rollback-manual-20261240000000_a_cliente_e_avisada_quando_a_loja_responde_sua_pergunta.sql (recria os dois
-- corpos de antes, byte a byte, com pré-voo e conferência final próprios; os avisos já criados em `notificacoes`
-- ficam — são avisos verdadeiros).
-- PROVA VIVA: tests/banco/pergunta-respondida-avisa-viva.cjs.

DO $preflight_20261240$
DECLARE
  r record;
  v_hash text;
  v_falta text;
BEGIN
  -- Exatamente as duas sobrecargas conhecidas de answer_question_atomic em public.
  IF (SELECT count(*) FROM pg_proc p
       WHERE p.pronamespace = 'public'::regnamespace AND p.proname = 'answer_question_atomic') <> 2 THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: answer_question_atomic não tem exatamente as duas sobrecargas conhecidas em public — meça a loja e revise antes de aplicar.';
  END IF;

  -- Corpo identificado pelo CONTEÚDO: o vigente (aplica) ou o desta migration (reaplicar é no-op).
  FOR r IN
    SELECT *
      FROM (VALUES
        ('public.answer_question_atomic(uuid,text)',      '8cf000b6c9ed27f482906752469f08ff', '1268df6cb364dfb46b5c535e007bb2d0'),
        ('public.answer_question_atomic(uuid,text,uuid)', 'ad99d54575ac95445103ea5b78e4a1e8', 'b62a4186ff8d58955973f53d6c0f302b')
      ) AS esperado(assinatura, hash_vigente, hash_desta)
  LOOP
    SELECT md5(replace(p.prosrc, E'\r', '')) INTO v_hash
      FROM pg_proc p
     WHERE p.oid = to_regprocedure(r.assinatura);

    IF v_hash IS NULL OR v_hash NOT IN (r.hash_vigente, r.hash_desta) THEN
      RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: corpo vivo de % (hash %) não é o vigente (20261064/20261065) nem o que esta migration deixa — capture o corpo vivo e revise antes de aplicar.', r.assinatura, COALESCE(v_hash, 'ausente');
    END IF;

    -- Atributos que o CREATE OR REPLACE reescreve: têm de ser os de sempre.
    IF NOT EXISTS (
         SELECT 1 FROM pg_proc p JOIN pg_language l ON l.oid = p.prolang
          WHERE p.oid = to_regprocedure(r.assinatura)
            AND l.lanname = 'plpgsql'
            AND p.prosecdef
            AND p.provolatile = 'v'
            AND NOT p.proretset
            AND p.proconfig = ARRAY['search_path=public']::text[]
            AND pg_get_function_result(p.oid) = 'void'
       ) THEN
      RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: atributos de % (linguagem, SECURITY DEFINER, volatilidade, search_path ou retorno) não são os conhecidos — meça a loja e revise antes de aplicar.', r.assinatura;
    END IF;
  END LOOP;

  -- O PL/pgSQL só acusa coluna ausente na hora de EXECUTAR, não ao criar: confere antes.
  SELECT string_agg(d.tabela || '.' || d.coluna, ', ' ORDER BY d.tabela, d.coluna) INTO v_falta
    FROM (VALUES
            ('answers', 'question_id'), ('answers', 'user_id'), ('answers', 'answer'), ('answers', 'created_at'),
            ('questions', 'id'), ('questions', 'user_id'), ('questions', 'product_id'),
            ('produtos', 'id'), ('produtos', 'nome'),
            ('profiles', 'id'), ('profiles', 'role'),
            ('notificacoes', 'usuario_id'), ('notificacoes', 'tipo'), ('notificacoes', 'titulo'),
            ('notificacoes', 'mensagem'), ('notificacoes', 'dados'), ('notificacoes', 'acao')
         ) AS d(tabela, coluna)
   WHERE NOT EXISTS (SELECT 1 FROM pg_attribute a
                      WHERE a.attrelid = to_regclass('public.' || d.tabela)
                        AND a.attname = d.coluna AND NOT a.attisdropped AND a.attnum > 0);
  IF v_falta IS NOT NULL THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: colunas que o corpo lê ou grava não existem: % — aplique as migrations anteriores antes.', v_falta;
  END IF;

  -- O upsert da resposta (ON CONFLICT (question_id)) precisa do índice único da 20260812030000.
  IF NOT EXISTS (
       SELECT 1 FROM pg_index i
        WHERE i.indrelid = 'public.answers'::regclass AND i.indisunique AND i.indisvalid
          AND i.indnatts = 1
          AND i.indkey::text = (SELECT a.attnum::text FROM pg_attribute a
                                 WHERE a.attrelid = 'public.answers'::regclass
                                   AND a.attname = 'question_id' AND NOT a.attisdropped)
     ) THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: falta o índice único de answers(question_id) que o upsert da resposta usa.';
  END IF;
END $preflight_20261240$;

-- answer_question_atomic(uuid, text): corpo vigente da 20261065000000, com o passo 3 trocado (linha falsa do log
-- de push -> aviso no sino da cliente que perguntou).
CREATE OR REPLACE FUNCTION public.answer_question_atomic(p_question_id uuid, p_answer text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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

    -- 1. Upsert Answer (idx_answers_question_id_unique, criado pela
    -- migration 20260812030000, e' quem permite o ON CONFLICT inferir o
    -- alvo)
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

        -- 3. Aviso no sino da cliente que perguntou (20261240000000). Um por
        --    pergunta: resposta repetida ou editada nao cria outro. Best-effort:
        --    a falha do aviso nunca perde a resposta da loja.
        BEGIN
            INSERT INTO notificacoes (usuario_id, tipo, titulo, mensagem, dados, acao)
            SELECT v_user_id, 'info', 'Sua pergunta foi respondida',
                   'A loja respondeu sua pergunta sobre ' || COALESCE(v_product_name, 'um produto') || '.',
                   jsonb_build_object('question_id', p_question_id, 'product_id', v_product_id),
                   jsonb_build_object('url', '/product-detail?id=' || v_product_id)
             WHERE v_user_id IS NOT NULL
               AND NOT EXISTS (SELECT 1 FROM notificacoes n
                                WHERE n.usuario_id = v_user_id
                                  AND n.dados ->> 'question_id' = p_question_id::text);
        EXCEPTION WHEN OTHERS THEN
            RAISE WARNING 'answer_question_atomic: aviso da pergunta % nao nasceu (%).', p_question_id, SQLERRM;
        END;
    END IF;
END;
$function$;

-- answer_question_atomic(uuid, text, uuid): corpo vigente da 20261064000000, com o mesmo passo 3.
CREATE OR REPLACE FUNCTION public.answer_question_atomic(p_question_id uuid, p_answer text, p_admin_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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

        -- 3. Aviso no sino da cliente que perguntou (20261240000000). Um por
        --    pergunta: resposta repetida ou editada nao cria outro. Best-effort:
        --    a falha do aviso nunca perde a resposta da loja.
        BEGIN
            INSERT INTO public.notificacoes (usuario_id, tipo, titulo, mensagem, dados, acao)
            SELECT v_user_id, 'info', 'Sua pergunta foi respondida',
                   'A loja respondeu sua pergunta sobre ' || COALESCE(v_product_name, 'um produto') || '.',
                   jsonb_build_object('question_id', p_question_id, 'product_id', v_product_id),
                   jsonb_build_object('url', '/product-detail?id=' || v_product_id)
             WHERE v_user_id IS NOT NULL
               AND NOT EXISTS (SELECT 1 FROM public.notificacoes n
                                WHERE n.usuario_id = v_user_id
                                  AND n.dados ->> 'question_id' = p_question_id::text);
        EXCEPTION WHEN OTHERS THEN
            RAISE WARNING 'answer_question_atomic: aviso da pergunta % nao nasceu (%).', p_question_id, SQLERRM;
        END;
    END IF;
END;
$function$;

-- CONFERÊNCIA FINAL: só compara o HASH do corpo das duas sobrecargas com o desta migration. ACL e atributos não são
-- comparados aqui: o CREATE OR REPLACE os preserva, e a consulta 41a (e a 41b, antes do apply) os mede.
DO $posvoo_20261240$
DECLARE
  r record;
  v_hash text;
BEGIN
  FOR r IN
    SELECT * FROM (VALUES
      ('public.answer_question_atomic(uuid,text)',      '1268df6cb364dfb46b5c535e007bb2d0'),
      ('public.answer_question_atomic(uuid,text,uuid)', 'b62a4186ff8d58955973f53d6c0f302b')
    ) AS esperado(assinatura, hash_desta)
  LOOP
    SELECT md5(replace(p.prosrc, E'\r', '')) INTO v_hash
      FROM pg_proc p WHERE p.oid = to_regprocedure(r.assinatura);
    IF v_hash IS DISTINCT FROM r.hash_desta THEN
      RAISE EXCEPTION 'POSVOO_20261240: o corpo de % ficou com hash % (esperado %).', r.assinatura, COALESCE(v_hash, 'ausente'), r.hash_desta;
    END IF;
  END LOOP;
END $posvoo_20261240$;
