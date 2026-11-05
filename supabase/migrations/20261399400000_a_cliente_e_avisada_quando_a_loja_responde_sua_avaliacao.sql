-- A CLIENTE É AVISADA QUANDO A LOJA RESPONDE A AVALIAÇÃO DELA (achado da rodada 9, 05/11/2026).
--
-- O DEFEITO: a loja responde a avaliação (a tela de avaliações do painel tem até a resposta pronta "Dar suporte", que
-- promete contato pelo WhatsApp), mas reply_review_atomic só gravava a resposta e UMA linha em push_notifications_log
-- ("Sua avaliação foi respondida!", 0 aparelhos). O user_id da avaliação era lido (RETURNING ... INTO v_user_id) e NUNCA
-- usado: nenhum aviso nascia no sino da cliente (notificacoes) e nenhum push saía. Quem reclamou numa avaliação e
-- recebeu a resposta nunca ficava sabendo e achava que tinha sido ignorada. A 20261240000000 consertou só a PERGUNTA
-- (answer_question_atomic) e deixou a AVALIAÇÃO "para uma migration própria": é esta.
--
-- O QUE ESTA MIGRATION FAZ (só o corpo de DUAS funções muda; assinatura, SECURITY DEFINER, search_path e ACL ficam
-- como estão — o CREATE OR REPLACE os preserva):
--   * reply_review_atomic(uuid, text)        — o caminho que o app usa (useReviews.ts, addMerchantReply);
--   * reply_review_atomic(uuid, text, uuid)  — a sobrecarga de 3 argumentos (sem chamador no app, mas viva no banco e com
--                                              o MESMO defeito; a 20261064 já as tratou juntas).
--   Em ambas, DEPOIS do que o corpo vigente (o da 20261360000000) já faz, entra o passo 3: criar o aviso no sino da
--   cliente que ESCREVEU a avaliação, uma linha em notificacoes com a mesma forma do aviso da pergunta (20261240000000):
--       usuario_id = quem avaliou, tipo 'info', título "Sua avaliação foi respondida",
--       mensagem "A loja respondeu sua avaliação sobre <produto>.",
--       dados = {review_id, product_id}, acao = {url: '/product-detail?id=<produto>'} (o sino abre o produto).
--   NÃO envia push (isso exige a edge function e rede; fora do escopo). O sino acende sozinho pelo realtime que o
--   NotificationContext já escuta.
--
-- O QUE NÃO MUDA (de propósito):
--   * A linha de push_notifications_log CONTINUA sendo gravada, igual a hoje. Ao contrário da pergunta (onde a linha
--     falsa deixou de nascer), aqui ela é o rastro que a consulta de medição 27m
--     (scripts/publicacao/consultas/27m-medir-avaliacao-forjada.sql) usa para saber que uma resposta da loja é legítima:
--     parar de gravá-la faria as respostas novas aparecerem como "SUSPEITA FORTE". O painel de campanhas já esconde essa
--     linha do histórico (src/lib/historico-de-campanhas.ts). Por isso a 27m e as fichas que a citam seguem valendo.
--   * A guarda de admin (is_admin_atual, da 20261360000000), o UPDATE da resposta e tudo o mais do corpo vigente ficam
--     idênticos, caractere a caractere: o corpo novo é o vigente MAIS o passo 3.
--   * Aprovar e excluir avaliação NÃO avisam ninguém: é decisão de produto e fica de fora desta migration.
--
-- DECISÕES:
--   * UM aviso por avaliação. A resposta repetida ou EDITADA não cria outro aviso (a cliente abre o produto e vê o texto
--     atual): o INSERT só roda se NÃO existir aviso daquela cliente para aquela review_id. Se ela dispensou o aviso e a
--     loja edita a resposta de novo, nasce um aviso novo — é um aviso de correção, e é o que a cliente quer receber (a
--     mesma decisão da pergunta). Duas lojistas respondendo a MESMA avaliação juntas: o UPDATE da avaliação trava a linha
--     até o fim da transação e a segunda enxerga o aviso da primeira (leitura nova a cada comando): um aviso só.
--   * Avaliação antiga (respondida antes desta migration, sem aviso): se a loja editar a resposta, nasce o aviso que ela
--     nunca recebeu. Nada é criado em massa; nenhum dado existente é tocado.
--   * O aviso é best-effort, como o das mudanças de pedido (20261026) e o da pergunta (20261240): se o INSERT falhar por
--     qualquer motivo, a RESPOSTA da loja NUNCA é perdida — o aviso fica para trás, logado como WARNING no servidor (o
--     bloco BEGIN ... EXCEPTION desfaz só o INSERT do aviso). A linha do log de push, que já era gravada fora desse
--     bloco, mantém o comportamento de hoje.
--   * Sem filtro de status: a loja pode responder uma avaliação ainda em análise e a autora é avisada do mesmo jeito. Se
--     a avaliação não existir, o UPDATE não acha linha e nada é criado.
--
-- PRÉ-VOO: recusa sem escrever se o corpo vivo de qualquer das duas funções não é o vigente (20261360000000) nem o desta
-- migration, se há sobrecarga extra, se os atributos mudaram ou se falta função/coluna que o corpo usa.
-- SEM BEGIN/COMMIT (regra da casa: o db-apply abre a transação).
--
-- HASHES (md5 do corpo sem CR): reply_review_atomic(uuid,text) antes 0e58549366e4b4be17ae070a8fc622dc / depois f617966c37037537410c3c78d85b8785;
-- reply_review_atomic(uuid,text,uuid) antes 64b337eb3ec5dd1431e0dbf9d12a49ac / depois 08569f17f477dea9ff87709ca3edd218.
--
-- ROLLBACK MANUAL: versionado em rollback-manual-20261399400000_a_cliente_e_avisada_quando_a_loja_responde_sua_avaliacao.sql
-- (recria os dois corpos de antes, byte a byte, com pré-voo e conferência final próprios; os avisos já criados em
-- notificacoes ficam — são avisos verdadeiros).
-- PROVA VIVA: tests/banco/a-cliente-e-avisada-quando-a-loja-responde-a-avaliacao-viva.cjs.

DO $preflight_20261399400$
DECLARE
  r record;
  v_hash text;
  v_falta text;
BEGIN
  -- Exatamente as duas sobrecargas conhecidas de reply_review_atomic em public.
  IF (SELECT count(*) FROM pg_proc p
       WHERE p.pronamespace = 'public'::regnamespace AND p.proname = 'reply_review_atomic') <> 2 THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: reply_review_atomic não tem exatamente as duas sobrecargas conhecidas em public — meça a loja e revise antes de aplicar.';
  END IF;

  -- Corpo identificado pelo CONTEÚDO: o vigente (aplica) ou o desta migration (reaplicar é no-op).
  FOR r IN
    SELECT *
      FROM (VALUES
        ('public.reply_review_atomic(uuid,text)',      '0e58549366e4b4be17ae070a8fc622dc', 'f617966c37037537410c3c78d85b8785'),
        ('public.reply_review_atomic(uuid,text,uuid)', '64b337eb3ec5dd1431e0dbf9d12a49ac', '08569f17f477dea9ff87709ca3edd218')
      ) AS esperado(assinatura, hash_vigente, hash_desta)
  LOOP
    SELECT md5(replace(p.prosrc, E'\r', '')) INTO v_hash
      FROM pg_proc p
     WHERE p.oid = to_regprocedure(r.assinatura);

    IF v_hash IS NULL OR v_hash NOT IN (r.hash_vigente, r.hash_desta) THEN
      RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: corpo vivo de % (hash %) não é o vigente (20261360) nem o que esta migration deixa — capture o corpo vivo e revise antes de aplicar.', r.assinatura, COALESCE(v_hash, 'ausente');
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

  -- A guarda de admin do corpo (nas duas sobrecargas) chama esta função.
  IF to_regprocedure('public.is_admin_atual()') IS NULL THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: public.is_admin_atual() não existe — aplique a 20261197000000 antes.';
  END IF;

  -- O PL/pgSQL só acusa coluna ausente na hora de EXECUTAR, não ao criar: confere antes.
  SELECT string_agg(d.tabela || '.' || d.coluna, ', ' ORDER BY d.tabela, d.coluna) INTO v_falta
    FROM (VALUES
            ('reviews', 'id'), ('reviews', 'user_id'), ('reviews', 'product_id'),
            ('reviews', 'merchant_reply'), ('reviews', 'merchant_reply_at'),
            ('produtos', 'id'), ('produtos', 'nome'),
            ('push_notifications_log', 'title'), ('push_notifications_log', 'body'), ('push_notifications_log', 'url'),
            ('push_notifications_log', 'recipient_count'), ('push_notifications_log', 'created_by'),
            ('notificacoes', 'usuario_id'), ('notificacoes', 'tipo'), ('notificacoes', 'titulo'),
            ('notificacoes', 'mensagem'), ('notificacoes', 'dados'), ('notificacoes', 'acao')
         ) AS d(tabela, coluna)
   WHERE NOT EXISTS (SELECT 1 FROM pg_attribute a
                      WHERE a.attrelid = to_regclass('public.' || d.tabela)
                        AND a.attname = d.coluna AND NOT a.attisdropped AND a.attnum > 0);
  IF v_falta IS NOT NULL THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: colunas que o corpo lê ou grava não existem: % — aplique as migrations anteriores antes.', v_falta;
  END IF;
END $preflight_20261399400$;

-- reply_review_atomic(uuid, text): corpo vigente da 20261360000000, com o passo 3 (aviso no sino da cliente que avaliou).
CREATE OR REPLACE FUNCTION public.reply_review_atomic(p_review_id uuid, p_reply text)
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
    IF NOT public.is_admin_atual() THEN
        RAISE EXCEPTION 'Unauthorized: Only admins can reply to reviews.';
    END IF;

    -- 1. Update Review
    UPDATE reviews
    SET merchant_reply = p_reply, merchant_reply_at = NOW()
    WHERE id = p_review_id
    RETURNING user_id, product_id INTO v_user_id, v_product_id;

    IF v_product_id IS NOT NULL THEN
        SELECT nome INTO v_product_name FROM produtos WHERE id = v_product_id;

        -- 2. Log Notification for Admin Visibility — A10: log honesto,
        --    nasce com 0; só sobe quando o send-push CONFIRMAR entrega.
        INSERT INTO push_notifications_log (title, body, url, recipient_count, created_by)
        VALUES (
            'Sua avaliação foi respondida!',
            'A loja respondeu à sua avaliação no produto ' || COALESCE(v_product_name, 'comprado') || '.',
            '/product/' || v_product_id,
            0,
            v_admin_id
        );

        -- 3. Aviso no sino da cliente que escreveu a avaliacao (20261399400000). Um por
        --    avaliacao: resposta repetida ou editada nao cria outro. Best-effort:
        --    a falha do aviso nunca perde a resposta da loja.
        BEGIN
            INSERT INTO notificacoes (usuario_id, tipo, titulo, mensagem, dados, acao)
            SELECT v_user_id, 'info', 'Sua avaliação foi respondida',
                   'A loja respondeu sua avaliação sobre ' || COALESCE(v_product_name, 'um produto') || '.',
                   jsonb_build_object('review_id', p_review_id, 'product_id', v_product_id),
                   jsonb_build_object('url', '/product-detail?id=' || v_product_id)
             WHERE v_user_id IS NOT NULL
               AND NOT EXISTS (SELECT 1 FROM notificacoes n
                                WHERE n.usuario_id = v_user_id
                                  AND n.dados ->> 'review_id' = p_review_id::text);
        EXCEPTION WHEN OTHERS THEN
            RAISE WARNING 'reply_review_atomic: aviso da avaliacao % nao nasceu (%).', p_review_id, SQLERRM;
        END;
    END IF;
END;
$function$;

-- reply_review_atomic(uuid, text, uuid): corpo vigente da 20261360000000, com o mesmo passo 3.
CREATE OR REPLACE FUNCTION public.reply_review_atomic(p_review_id uuid, p_reply text, p_admin_id uuid)
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
    IF NOT public.is_admin_atual() THEN
        RAISE EXCEPTION 'Unauthorized: Only admins can reply to reviews.';
    END IF;

    -- 1. Update Review
    UPDATE public.reviews
    SET merchant_reply = p_reply, merchant_reply_at = NOW()
    WHERE id = p_review_id
    RETURNING user_id, product_id INTO v_user_id, v_product_id;

    IF v_product_id IS NOT NULL THEN
        SELECT nome INTO v_product_name FROM public.produtos WHERE id = v_product_id;

        -- 2. Log Notification for Admin Visibility — A10: log honesto,
        --    nasce com 0; só sobe quando o send-push CONFIRMAR entrega.
        INSERT INTO public.push_notifications_log (title, body, url, recipient_count, created_by)
        VALUES (
            'Sua avaliacao foi respondida!',
            'A loja respondeu a sua avaliacao no produto ' || COALESCE(v_product_name, 'comprado') || '.',
            '/product/' || v_product_id,
            0,
            p_admin_id
        );

        -- 3. Aviso no sino da cliente que escreveu a avaliacao (20261399400000). Um por
        --    avaliacao: resposta repetida ou editada nao cria outro. Best-effort:
        --    a falha do aviso nunca perde a resposta da loja.
        BEGIN
            INSERT INTO public.notificacoes (usuario_id, tipo, titulo, mensagem, dados, acao)
            SELECT v_user_id, 'info', 'Sua avaliação foi respondida',
                   'A loja respondeu sua avaliação sobre ' || COALESCE(v_product_name, 'um produto') || '.',
                   jsonb_build_object('review_id', p_review_id, 'product_id', v_product_id),
                   jsonb_build_object('url', '/product-detail?id=' || v_product_id)
             WHERE v_user_id IS NOT NULL
               AND NOT EXISTS (SELECT 1 FROM public.notificacoes n
                                WHERE n.usuario_id = v_user_id
                                  AND n.dados ->> 'review_id' = p_review_id::text);
        EXCEPTION WHEN OTHERS THEN
            RAISE WARNING 'reply_review_atomic: aviso da avaliacao % nao nasceu (%).', p_review_id, SQLERRM;
        END;
    END IF;
END;
$function$;

-- CONFERÊNCIA FINAL: só compara o HASH do corpo das duas sobrecargas com o desta migration. ACL e atributos não são
-- comparados aqui: o CREATE OR REPLACE os preserva, e a consulta 120a (e a 120b, antes do apply) os mede.
DO $posvoo_20261399400$
DECLARE
  r record;
  v_hash text;
BEGIN
  FOR r IN
    SELECT * FROM (VALUES
      ('public.reply_review_atomic(uuid,text)',      'f617966c37037537410c3c78d85b8785'),
      ('public.reply_review_atomic(uuid,text,uuid)', '08569f17f477dea9ff87709ca3edd218')
    ) AS esperado(assinatura, hash_desta)
  LOOP
    SELECT md5(replace(p.prosrc, E'\r', '')) INTO v_hash
      FROM pg_proc p WHERE p.oid = to_regprocedure(r.assinatura);
    IF v_hash IS DISTINCT FROM r.hash_desta THEN
      RAISE EXCEPTION 'POSVOO_20261399400: o corpo de % ficou com hash % (esperado %).', r.assinatura, COALESCE(v_hash, 'ausente'), r.hash_desta;
    END IF;
  END LOOP;
END $posvoo_20261399400$;
