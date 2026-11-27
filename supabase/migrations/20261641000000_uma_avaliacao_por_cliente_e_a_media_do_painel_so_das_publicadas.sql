-- ============================================================================
-- Migration 20261641000000 — uma avaliação por cliente e produto, e a média do painel só das publicadas
-- (achados de leitura do código no topo 0391390ed, 27/11/2026)
-- ============================================================================
--
-- 1. OS DEFEITOS MEDIDOS
--
--   (a) A mesma cliente avalia o mesmo produto quantas vezes quiser. `public.reviews` não tem trava de
--       (user_id, product_id): só a chave primária em `id`. A política de INSERT `reviews_insert_policy`
--       (20261031000000) confere autora, `verified = false`, `status = 'pendente'` e `enable_reviews`, nunca a
--       repetição. Só a tela confere (`src/hooks/useReviews.ts`, `addReview`): se a conferência falha por rede a
--       tela grava mesmo assim, e dois aparelhos que enviam juntos passam os dois pela conferência.
--   (b) O topo do painel de avaliações ("Média global / nota dos compradores", "Total" e "Compras verificadas")
--       soma as avaliações PENDENTES: o bloco de métricas globais de `get_admin_reviews_paged` (20261399996000) lê
--       a tabela inteira. O painel podia mostrar 3,7 com a vitrine mostrando 5,0. `get_reviews_metrics`
--       (20261381000000, a média avulsa do mesmo painel) faz a mesma soma.
--
-- 2. O QUE ESTA MIGRATION FAZ, NA ORDEM
--
--   0. Pré-voo (B1_BASELINE_DIVERGENT, antes de qualquer escrita; ver 5).
--   1. Função NOVA `public.avaliacao_uma_por_cliente_e_produto()` (RETURNS trigger, SECURITY DEFINER,
--      `search_path = public`, ACL fechada: REVOKE de PUBLIC, anon, authenticated e service_role) e gatilho NOVO
--      `tr_avaliacao_uma_por_cliente_e_produto`, BEFORE INSERT, FOR EACH ROW, em `public.reviews`. Ele recusa a
--      avaliação NOVA quando já existe QUALQUER avaliação da mesma conta para o mesmo produto (publicada ou
--      pendente), com ERRCODE 23505, a frase "Você já avaliou este produto." e DETAIL `avaliacao_repetida`
--      (o app já traduz 23505 para essa frase). Antes de contar, toma `pg_advisory_xact_lock` pelo par
--      conta+produto: dois aparelhos que enviam juntos esperam um ao outro e o segundo é recusado.
--      Fora da trava (mesmo critério das 20261224000000 e 20261396000000): a sessão DIRETA no banco (`role` = 'none':
--      migration, seed, script de prova; o PostgREST sempre faz SET ROLE). E o cliente gravando em nome de OUTRA
--      conta sai sem contar nada: a política de INSERT recusa com 42501 logo depois, e responder "já avaliou"
--      contaria a ele que aquela conta tem avaliação (mesmo em análise) daquele produto. service_role e o
--      administrador NÃO ficam de fora: nenhum deles tem motivo para gravar a segunda avaliação da mesma cliente.
--   2. `get_admin_reviews_paged` (MESMA assinatura de 5 argumentos): o bloco de métricas GLOBAIS ganha
--      `WHERE r.status = 'publicada'` (global_total_count, global_average_rating, global_total_verified e
--      global_total_replied). A lista, o `total_count` (o paginador) e as métricas filtradas seguem com todas, como
--      antes. Corpo = o VIVO da 20261399996000 (md5 75f5c48de4eb4005a2516e54b3d33135) com duas edições (o WHERE e três linhas de
--      comentário); corpo novo md5 21ba271d66edd776cab2443d32800db7.
--   3. `get_reviews_metrics` (MESMA assinatura): `r.status = 'publicada'` no WHERE. Corpo = o VIVO da 20261381000000
--      (md5 71a40c86c6c1b23fbf991d653c746091) com duas edições (o predicado e o comentário da guarda); corpo novo md5
--      971268999fce410628356d65b99fbca5.
--   4. Conferência no fim (aborta a migration inteira se algo não ficou como desenhado) e `NOTIFY pgrst`.
--
-- POR QUE GATILHO E NÃO ÍNDICE ÚNICO: as lojas podem JÁ TER repetidas, e apagar dado é proibido.
--   * UNIQUE (user_id, product_id) inteiro não constrói enquanto houver uma repetida.
--   * Índice único PARCIAL que exclui as antigas (por data de corte ou por id) não barra o caso mais comum: a cliente
--     que avaliou ANTES do corte avaliar de novo DEPOIS (a antiga está fora do índice, a nova entra sozinha nele).
--     E `created_at` é gravável pela sessão direta, então o predicado nem separa "antiga" de "nova" com segurança.
--   * Uma coluna marcando as antigas exigiria UPDATE em todas as linhas existentes (mudar dado existente).
--   O gatilho barra TODA avaliação nova repetida, inclusive contra as antigas, sem ler nem reescrever nenhuma
--   linha existente. A corrida de dois aparelhos fica com a trava consultiva por conta+produto.
--
-- 3. DADOS EXISTENTES
--
-- NENHUMA linha de `reviews` é lida para reescrita, reescrita ou apagada pelo apply. As repetidas que já existem
-- ficam como estão (todas continuam no painel e, se publicadas, na vitrine); a cliente que já tem duas só não
-- grava a terceira. As métricas do topo do painel passam a contar só as publicadas (as pendentes já aparecem à
-- parte no próprio painel: "N para aprovar"). Medição só leitura, em CADA loja, antes:
--   SELECT count(*) AS pares_repetidos, COALESCE(sum(n - 1), 0) AS avaliacoes_a_mais
--     FROM (SELECT user_id, product_id, count(*) AS n FROM public.reviews GROUP BY 1, 2 HAVING count(*) > 1) d;
--
-- 4. IDEMPOTÊNCIA, TRANSAÇÃO E TRAVA
--
-- `CREATE OR REPLACE` nas três funções e no gatilho (nenhum DROP): reaplicar deixa o mesmo estado (o pré-voo aceita
-- os corpos de antes OU os desta migration). Sem BEGIN/COMMIT de nível superior neste arquivo (regra da casa,
-- AGENTS.md): quem abre a transação é o aplicador (`aplicar-migrations.yml` / `node scripts/db-apply.cjs <arquivo>`);
-- pré-voo, criação e conferência caem juntos ou não caem (a fotografia das RPCs é `set_config` local). CREATE
-- TRIGGER pega `SHARE ROW EXCLUSIVE` em `reviews`: com `lock_timeout = 5s` uma loja em uso falha limpo em vez de
-- travar quem avalia; repetir depois. Isolamento: a trava consultiva protege a corrida em READ COMMITTED (o padrão
-- do PostgREST: a consulta depois da trava enxerga a linha que a outra transação gravou). Em REPEATABLE READ a
-- segunda transação não enxergaria a primeira; nenhum caminho do app grava avaliação assim.
--
-- 5. PRÉ-VOO
--
-- Recusa se: `reviews` sem user_id/product_id (uuid) ou status (text); `is_admin_atual()` ou `auth.uid()` ausente;
-- `get_admin_reviews_paged` com zero ou mais de uma assinatura, outros argumentos ou corpo que não seja o da
-- 20261399996000 nem o desta; `get_reviews_metrics` idem com a 20261381000000; atributos, dono ou ACL das duas
-- diferentes dos de hoje; função de gatilho de mesmo nome com corpo desconhecido ou sobrecarga; gatilho de mesmo
-- nome diferente do desenhado. A conferência final exige os três corpos novos, o OID/dono/ACL/atributos das duas
-- RPCs IGUAIS aos da fotografia, a função do gatilho fechada e o gatilho BEFORE INSERT por linha ligado.
--
-- 6. FORA DO ESCOPO
--
--   * Exigir COMPRA para avaliar (quem nunca comprou ainda consegue enviar pela API; entra pendente e sem selo):
--     decisão de produto em aberto. O painel passa a avisar, ao aprovar uma sem selo, que a pessoa não tem compra
--     registrada do produto (só tela).
--   * Juntar ou apagar as repetidas que já existem.
--   * UPDATE que troque `user_id`/`product_id` de uma avaliação (só administrador e sessão direta fazem UPDATE).
--
-- 7. ORDEM E QUEM QUEBRA
--
-- Depois da 20261399996000 e da 20261381000000. Banco antes ou depois do front dá no mesmo: o front já traduz 23505
-- e lê as mesmas chaves do JSON. Quem passa a ser recusado: só a segunda avaliação da mesma conta para o mesmo
-- produto (pela API).
--
-- 8. FICHA DE VERIFICAÇÃO (só leitura, depois do apply)
--
--   -- 1. Corpos (esperado: 21ba271d66edd776cab2443d32800db7 | 971268999fce410628356d65b99fbca5 | a84f4bc295a088c75ad926f43e16c39d):
--   SELECT md5(replace(prosrc, E'\r', '')) FROM pg_proc WHERE oid IN (
--     to_regprocedure('public.get_admin_reviews_paged(text,text,integer,integer,text)'),
--     to_regprocedure('public.get_reviews_metrics(text,integer)'),
--     to_regprocedure('public.avaliacao_uma_por_cliente_e_produto()'));
--   -- 2. O gatilho (esperado: 1 linha, tgtype 7, tgenabled O):
--   SELECT tgname, tgtype, tgenabled FROM pg_trigger WHERE tgname = 'tr_avaliacao_uma_por_cliente_e_produto';
--   -- 3. A medição de repetidas do item 3 dá o MESMO número de antes (nada foi apagado).
--   Consultas oficiais: 201a (depois) / 201b (antes), em scripts/publicacao/consultas/.
--
-- 9. ROLLBACK
--
-- rollback-manual-20261641000000_uma_avaliacao_por_cliente_e_a_media_do_painel_so_das_publicadas.sql: tira o gatilho e a função dele (os dois são novos) e devolve os corpos da 20261399996000
-- e da 20261381000000 byte a byte. Nenhuma linha é tocada; avaliações gravadas enquanto a trava existiu ficam.
--
-- PROVA VIVA: tests/banco/uma-avaliacao-por-cliente-e-a-media-so-das-publicadas-viva.cjs (rpc-ci, Postgres efêmero).
-- ============================================================================

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

DO $preflight_20261641000000$
DECLARE
  v_paged oid := to_regprocedure('public.get_admin_reviews_paged(text,text,integer,integer,text)');
  v_metrics oid := to_regprocedure('public.get_reviews_metrics(text,integer)');
  v_gfn oid := to_regprocedure('public.avaliacao_uma_por_cliente_e_produto()');
  v_gat record;
BEGIN
  -- As colunas que o gatilho e as duas RPCs leem: com os tipos de sempre.
  IF (SELECT count(*) FROM pg_attribute a
       WHERE a.attrelid = to_regclass('public.reviews') AND NOT a.attisdropped
         AND ((a.attname = 'user_id' AND a.atttypid = 'uuid'::regtype)
           OR (a.attname = 'product_id' AND a.atttypid = 'uuid'::regtype)
           OR (a.attname = 'status' AND a.atttypid = 'text'::regtype))) <> 3 THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: public.reviews não tem user_id (uuid), product_id (uuid) e status (text) — meça a loja e revise antes de aplicar.';
  END IF;
  IF to_regprocedure('public.is_admin_atual()') IS NULL OR to_regprocedure('auth.uid()') IS NULL THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: public.is_admin_atual() ou auth.uid() não existe — aplique a 20261197000000 antes.';
  END IF;

  IF (SELECT count(*) FROM pg_proc q WHERE q.pronamespace = 'public'::regnamespace AND q.proname = 'get_admin_reviews_paged') <> 1 THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: get_admin_reviews_paged precisa existir com UMA assinatura so, e ha zero ou mais de uma; revise antes de aplicar.';
  END IF;
  IF v_paged IS NULL
     OR (SELECT md5(replace(p.prosrc, E'\r', '')) FROM pg_proc p WHERE p.oid = v_paged) NOT IN ('75f5c48de4eb4005a2516e54b3d33135', '21ba271d66edd776cab2443d32800db7')
     OR pg_get_function_arguments(v_paged) <> 'p_search text DEFAULT ''''::text, p_rating text DEFAULT ''all''::text, p_page integer DEFAULT 0, p_page_size integer DEFAULT 10, p_status text DEFAULT ''todas''::text' THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: get_admin_reviews_paged não é a de 5 argumentos com o corpo da 20261399996000 nem o desta migration; revise antes de aplicar.';
  END IF;
    IF NOT EXISTS (
      SELECT 1 FROM pg_proc p JOIN pg_language l ON l.oid = p.prolang
       WHERE p.oid = v_paged
         AND p.prokind = 'f' AND p.prosecdef AND l.lanname = 'plpgsql' AND p.provolatile = 'v'
         AND p.proconfig = ARRAY['search_path=public, extensions']::text[]
         AND pg_get_function_result(p.oid) = 'jsonb' AND NOT p.proretset
         AND NOT p.proisstrict AND NOT p.proleakproof AND p.proparallel = 'u' AND p.procost = 100
         AND p.proowner = (SELECT proowner FROM pg_proc WHERE oid = to_regprocedure('public.is_admin_atual()'))
         AND has_function_privilege('authenticated', p.oid, 'EXECUTE')
         AND has_function_privilege('service_role', p.oid, 'EXECUTE')
         AND NOT has_function_privilege('anon', p.oid, 'EXECUTE')
         AND NOT EXISTS (SELECT 1 FROM aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) a
                         WHERE a.grantee = 0 AND a.privilege_type = 'EXECUTE')
    ) THEN
      RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: get_admin_reviews_paged tem atributos, dono ou permissoes diferentes dos esperados.';
    END IF;

  IF (SELECT count(*) FROM pg_proc q WHERE q.pronamespace = 'public'::regnamespace AND q.proname = 'get_reviews_metrics') <> 1 THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: get_reviews_metrics precisa existir com UMA assinatura so, e ha zero ou mais de uma; revise antes de aplicar.';
  END IF;
  IF v_metrics IS NULL
     OR (SELECT md5(replace(p.prosrc, E'\r', '')) FROM pg_proc p WHERE p.oid = v_metrics) NOT IN ('71a40c86c6c1b23fbf991d653c746091', '971268999fce410628356d65b99fbca5')
     OR pg_get_function_arguments(v_metrics) <> 'p_search text DEFAULT NULL::text, p_rating integer DEFAULT NULL::integer' THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: get_reviews_metrics não tem o corpo da 20261381000000 nem o desta migration; revise antes de aplicar.';
  END IF;
    IF NOT EXISTS (
      SELECT 1 FROM pg_proc p JOIN pg_language l ON l.oid = p.prolang
       WHERE p.oid = v_metrics
         AND p.prokind = 'f' AND p.prosecdef AND l.lanname = 'plpgsql' AND p.provolatile = 'v'
         AND p.proconfig = ARRAY['search_path=public']::text[]
         AND pg_get_function_result(p.oid) = 'TABLE(average_rating numeric, total_verified bigint, total_replied bigint)' AND p.proretset
         AND NOT p.proisstrict AND NOT p.proleakproof AND p.proparallel = 'u' AND p.procost = 100
         AND p.proowner = (SELECT proowner FROM pg_proc WHERE oid = to_regprocedure('public.is_admin_atual()'))
         AND has_function_privilege('authenticated', p.oid, 'EXECUTE')
         AND has_function_privilege('service_role', p.oid, 'EXECUTE')
         AND NOT has_function_privilege('anon', p.oid, 'EXECUTE')
         AND NOT EXISTS (SELECT 1 FROM aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) a
                         WHERE a.grantee = 0 AND a.privilege_type = 'EXECUTE')
    ) THEN
      RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: get_reviews_metrics tem atributos, dono ou permissoes diferentes dos esperados.';
    END IF;

  IF (SELECT count(*) FROM pg_proc p
       WHERE p.pronamespace = 'public'::regnamespace AND p.proname = 'avaliacao_uma_por_cliente_e_produto') > 1 THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: avaliacao_uma_por_cliente_e_produto tem sobrecarga em public — revise antes de aplicar.';
  END IF;
  IF v_gfn IS NOT NULL THEN
    IF (SELECT md5(replace(prosrc, E'\r', '')) FROM pg_proc WHERE oid = v_gfn) IS DISTINCT FROM 'a84f4bc295a088c75ad926f43e16c39d' THEN
      RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: public.avaliacao_uma_por_cliente_e_produto() já existe com corpo desconhecido — ninguém revisou essa redefinição; revise antes de aplicar.';
    END IF;
  ELSIF EXISTS (SELECT 1 FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname = 'avaliacao_uma_por_cliente_e_produto') THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: avaliacao_uma_por_cliente_e_produto existe em public com outra assinatura — revise antes de aplicar.';
  END IF;

  FOR v_gat IN
    SELECT t.tgrelid, t.tgfoid, t.tgtype, t.tgqual IS NOT NULL AS tem_when, t.tgnargs, t.tgattr::text AS attr, t.tgisinternal
      FROM pg_trigger t
     WHERE t.tgname = 'tr_avaliacao_uma_por_cliente_e_produto'
  LOOP
    IF v_gat.tgrelid IS DISTINCT FROM to_regclass('public.reviews')
       OR v_gat.tgfoid IS DISTINCT FROM v_gfn
       OR v_gat.tgtype <> 7
       OR v_gat.tem_when OR v_gat.tgnargs <> 0 OR v_gat.attr <> '' OR v_gat.tgisinternal THEN
      RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: já existe um gatilho chamado tr_avaliacao_uma_por_cliente_e_produto que NÃO é o desenhado pela 20261641000000 (outra tabela, outra função, outro momento/evento, WHEN, UPDATE OF ou argumentos) — revise antes de aplicar.';
    END IF;
  END LOOP;
  -- Fotografia de TUDO que as duas RPCs são no catálogo (OID, dono, ACL, atributos): o CREATE OR REPLACE só pode trocar o corpo.
  PERFORM set_config('ikcous.avaliacoes3641_paged', (SELECT to_jsonb(p) - 'prosrc' FROM pg_proc p WHERE p.oid = v_paged)::text, true);
  PERFORM set_config('ikcous.avaliacoes3641_metrics', (SELECT to_jsonb(p) - 'prosrc' FROM pg_proc p WHERE p.oid = v_metrics)::text, true);
END $preflight_20261641000000$;

-- 1. A trava: uma avaliação por conta e produto (gatilho NOVO; nenhuma linha existente é lida para reescrever).
CREATE OR REPLACE FUNCTION public.avaliacao_uma_por_cliente_e_produto()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
    v_papel text := COALESCE(NULLIF(current_setting('role', true), ''), 'none');
BEGIN
    -- Sessao DIRETA no banco (migration, seed, script de prova): o `role` da sessao vale 'none' (o PostgREST sempre faz
    -- SET ROLE para anon/authenticated/service_role). Nao e cliente; a mesma excecao das 20261224000000 e 20261396000000.
    -- Linha sem conta ou sem produto: a coluna NOT NULL recusa logo depois; nao ha par a conferir.
    IF v_papel = 'none' OR NEW.user_id IS NULL OR NEW.product_id IS NULL THEN
        RETURN NEW;
    END IF;
    -- Cliente gravando em nome de OUTRA conta: a politica de INSERT recusa (42501) depois deste gatilho. Sem esta saida
    -- o gatilho (SECURITY DEFINER, enxerga as pendentes de todo mundo) responderia "ja avaliou" e contaria a quem pergunta
    -- que aquela conta tem avaliacao daquele produto, mesmo em analise.
    IF v_papel IN ('anon', 'authenticated') AND NEW.user_id IS DISTINCT FROM auth.uid() THEN
        RETURN NEW;
    END IF;
    -- Uma conta e um produto por vez: sem a trava, dois aparelhos que enviam juntos nao enxergam a gravacao um do outro.
    -- Com ela, o segundo espera o primeiro terminar e a consulta abaixo (snapshot novo, READ COMMITTED) ja ve a linha.
    PERFORM pg_advisory_xact_lock(hashtextextended(
        'reviews_uma_por_cliente_e_produto:' || NEW.user_id::text || ':' || NEW.product_id::text, 0));
    -- Qualquer avaliacao da mesma conta para o mesmo produto, publicada ou pendente, antiga ou nova, barra a nova.
    -- As repetidas que ja existiam antes desta migration NAO sao tocadas: o gatilho so age em INSERT novo.
    IF EXISTS (SELECT 1 FROM public.reviews r WHERE r.user_id = NEW.user_id AND r.product_id = NEW.product_id) THEN
        RAISE EXCEPTION 'Você já avaliou este produto.'
            USING ERRCODE = '23505', DETAIL = 'avaliacao_repetida';
    END IF;
    RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.avaliacao_uma_por_cliente_e_produto() FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE TRIGGER tr_avaliacao_uma_por_cliente_e_produto
BEFORE INSERT ON public.reviews
FOR EACH ROW EXECUTE FUNCTION public.avaliacao_uma_por_cliente_e_produto();

-- 2. O topo do painel conta só as publicadas (mesma assinatura: CREATE OR REPLACE preserva OID, dono e ACL).
CREATE OR REPLACE FUNCTION public.get_admin_reviews_paged(p_search text DEFAULT ''::text, p_rating text DEFAULT 'all'::text, p_page integer DEFAULT 0, p_page_size integer DEFAULT 10, p_status text DEFAULT 'todas'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
    v_total_count BIGINT;
    v_data JSONB;
    v_offset INTEGER;
    v_clean_search TEXT;
    v_rating_val INTEGER;
    v_so_pendentes BOOLEAN;
    v_so_sem_resposta BOOLEAN;
    
    -- Metrics
    v_average_rating NUMERIC;
    v_total_verified BIGINT;
    v_total_replied BIGINT;
    -- Globais de verdade (achado 5 da auditoria): mesmas metricas SEM o
    -- WHERE do filtro - os cartoes "Global/no total" param de seguir o filtro.
    v_global_total_count BIGINT;
    v_global_average_rating NUMERIC;
    v_global_total_verified BIGINT;
    v_global_total_replied BIGINT;
BEGIN
    -- Authorization check
    IF NOT public.is_admin_atual() THEN
        RAISE EXCEPTION 'Acesso negado: privilégios de administrador necessários.';
    END IF;

    v_offset := p_page * p_page_size;
    v_clean_search := TRIM(p_search);
    -- Filtro de moderacao (20261399700000): so o texto 'pendente' liga o filtro. NULL, 'todas' e qualquer
    -- outro texto valem 'todas' (o mesmo de antes): nunca erro, e o texto nunca entra em SQL montado.
    v_so_pendentes := COALESCE(p_status = 'pendente', false);
    -- Filtro de resposta (20261399996000): so o texto 'sem_resposta' liga este filtro, pela MESMA regra do sino do painel
    -- (src/lib/avaliacoes-para-atender.ts): sem resposta = merchant_reply IS NULL. Resposta em branco NAO conta como sem resposta.
    v_so_sem_resposta := COALESCE(p_status = 'sem_resposta', false);
    
    IF p_rating = 'all' THEN
        v_rating_val := NULL;
    ELSE
        v_rating_val := p_rating::INTEGER;
    END IF;

    -- Compute total count and metrics in a single query block
    SELECT 
        COUNT(r.id),
        COALESCE(AVG(r.rating), 0.0),
        COUNT(CASE WHEN r.verified = true THEN 1 END),
        COUNT(CASE WHEN r.merchant_reply IS NOT NULL AND TRIM(r.merchant_reply) <> '' THEN 1 END)
    INTO 
        v_total_count,
        v_average_rating,
        v_total_verified,
        v_total_replied
    FROM public.reviews r
    LEFT JOIN public.profiles p ON p.id = r.user_id
    LEFT JOIN public.produtos prod ON prod.id = r.product_id
    WHERE (v_rating_val IS NULL OR r.rating = v_rating_val)
      AND (NOT v_so_pendentes OR r.status = 'pendente')
      AND (NOT v_so_sem_resposta OR r.merchant_reply IS NULL)
      AND (
        v_clean_search = '' OR (
          unaccent(r.comment) ILIKE unaccent('%' || v_clean_search || '%') OR
          unaccent(p.full_name) ILIKE unaccent('%' || v_clean_search || '%') OR
          unaccent(prod.nome) ILIKE unaccent('%' || v_clean_search || '%')
        )
      );

    -- Metricas GLOBAIS (sem filtro) - irmas das filtradas acima
    -- So as PUBLICADAS (20261641000000): a media, o total e as taxas do topo do painel contam o mesmo que a vitrine
    -- mostra. As pendentes (a fila) o painel conta a parte. A lista e o total_count (o paginador) seguem com todas.
    SELECT
        COUNT(r.id),
        COALESCE(AVG(r.rating), 0.0),
        COUNT(CASE WHEN r.verified = true THEN 1 END),
        COUNT(CASE WHEN r.merchant_reply IS NOT NULL AND TRIM(r.merchant_reply) <> '' THEN 1 END)
    INTO
        v_global_total_count,
        v_global_average_rating,
        v_global_total_verified,
        v_global_total_replied
    FROM public.reviews r
    WHERE r.status = 'publicada';

    -- Fetch paginated data
    SELECT COALESCE(
        jsonb_agg(t),
        '[]'::JSONB
    ) INTO v_data
    FROM (
        SELECT 
            r.*,
            (
                SELECT jsonb_build_object('full_name', p.full_name)
                FROM public.profiles p
                WHERE p.id = r.user_id
            ) AS "user",
            (
                SELECT jsonb_build_object('nome', prod.nome)
                FROM public.produtos prod
                WHERE prod.id = r.product_id
            ) AS "product"
        FROM public.reviews r
        LEFT JOIN public.profiles p ON p.id = r.user_id
        LEFT JOIN public.produtos prod ON prod.id = r.product_id
        WHERE (v_rating_val IS NULL OR r.rating = v_rating_val)
          AND (NOT v_so_pendentes OR r.status = 'pendente')
          AND (NOT v_so_sem_resposta OR r.merchant_reply IS NULL)
          AND (
            v_clean_search = '' OR (
              unaccent(r.comment) ILIKE unaccent('%' || v_clean_search || '%') OR
              unaccent(p.full_name) ILIKE unaccent('%' || v_clean_search || '%') OR
              unaccent(prod.nome) ILIKE unaccent('%' || v_clean_search || '%')
            )
          )
        ORDER BY r.created_at DESC
        LIMIT p_page_size
        OFFSET v_offset
    ) t;

    RETURN jsonb_build_object(
        'data', v_data,
        'total_count', v_total_count,
        'average_rating', v_average_rating,
        'total_verified', v_total_verified,
        'total_replied', v_total_replied,
        'global_total_count', v_global_total_count,
        'global_average_rating', v_global_average_rating,
        'global_total_verified', v_global_total_verified,
        'global_total_replied', v_global_total_replied
    );
END;
$function$;

-- 3. A média avulsa do painel também (mesma assinatura).
CREATE OR REPLACE FUNCTION public.get_reviews_metrics(p_search text DEFAULT NULL::text, p_rating integer DEFAULT NULL::integer)
 RETURNS TABLE(average_rating numeric, total_verified bigint, total_replied bigint)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_search_pattern text;
  v_profile_ids uuid[];
  v_product_ids uuid[];
BEGIN
  -- Só o administrador lê a média e as contagens. Mesma guarda da irmã get_admin_reviews_paged.
  -- So as PUBLICADAS entram na conta (20261641000000), o mesmo que a vitrine mostra.
  IF NOT public.is_admin_atual() THEN
    RAISE EXCEPTION 'Acesso negado: privilégios de administrador necessários.';
  END IF;

  IF p_search IS NOT NULL AND p_search <> '' THEN
    v_search_pattern := '%' || p_search || '%';
    
    SELECT COALESCE(array_agg(id), '{}') INTO v_profile_ids 
    FROM public_profiles 
    WHERE full_name ILIKE v_search_pattern;
    
    SELECT COALESCE(array_agg(id), '{}') INTO v_product_ids 
    FROM produtos 
    WHERE nome ILIKE v_search_pattern;
  END IF;

  RETURN QUERY
  SELECT 
    COALESCE(AVG(r.rating), 0.0)::numeric as average_rating,
    COUNT(CASE WHEN r.verified = true THEN 1 END)::bigint as total_verified,
    COUNT(CASE WHEN r.merchant_reply IS NOT NULL AND TRIM(r.merchant_reply) <> '' THEN 1 END)::bigint as total_replied
  FROM reviews r
  WHERE 
    r.status = 'publicada'
    AND (p_rating IS NULL OR r.rating = p_rating)
    AND (
      p_search IS NULL OR p_search = '' 
      OR r.comment ILIKE v_search_pattern
      OR (v_profile_ids IS NOT NULL AND r.user_id = ANY(v_profile_ids))
      OR (v_product_ids IS NOT NULL AND r.product_id = ANY(v_product_ids))
    );
END;
$function$;

-- CONFERÊNCIA no instante do apply: aborta a migration inteira se algo não ficou como desenhado.
DO $conferencia_20261641000000$
DECLARE
  v_paged oid := to_regprocedure('public.get_admin_reviews_paged(text,text,integer,integer,text)');
  v_metrics oid := to_regprocedure('public.get_reviews_metrics(text,integer)');
  v_gfn oid := to_regprocedure('public.avaliacao_uma_por_cliente_e_produto()');
BEGIN
  IF v_paged IS NULL OR v_metrics IS NULL OR v_gfn IS NULL
     OR (SELECT count(*) FROM pg_proc q WHERE q.pronamespace = 'public'::regnamespace
          AND q.proname IN ('get_admin_reviews_paged', 'get_reviews_metrics', 'avaliacao_uma_por_cliente_e_produto')) <> 3 THEN
    RAISE EXCEPTION 'conferencia 20261641000000: uma das três funções sumiu ou ganhou sobrecarga';
  END IF;
  IF (SELECT md5(replace(prosrc, E'\r', '')) FROM pg_proc WHERE oid = v_paged) IS DISTINCT FROM '21ba271d66edd776cab2443d32800db7'
     OR (SELECT md5(replace(prosrc, E'\r', '')) FROM pg_proc WHERE oid = v_metrics) IS DISTINCT FROM '971268999fce410628356d65b99fbca5'
     OR (SELECT md5(replace(prosrc, E'\r', '')) FROM pg_proc WHERE oid = v_gfn) IS DISTINCT FROM 'a84f4bc295a088c75ad926f43e16c39d' THEN
    RAISE EXCEPTION 'conferencia 20261641000000: o corpo vivo de alguma das três funções não é o desta migration';
  END IF;
  IF (SELECT to_jsonb(p) - 'prosrc' FROM pg_proc p WHERE p.oid = v_paged) IS DISTINCT FROM current_setting('ikcous.avaliacoes3641_paged')::jsonb
     OR (SELECT to_jsonb(p) - 'prosrc' FROM pg_proc p WHERE p.oid = v_metrics) IS DISTINCT FROM current_setting('ikcous.avaliacoes3641_metrics')::jsonb THEN
    RAISE EXCEPTION 'conferencia 20261641000000: OID, dono, ACL ou atributo de get_admin_reviews_paged ou get_reviews_metrics mudou';
  END IF;
  IF NOT EXISTS (
       SELECT 1 FROM pg_proc p JOIN pg_language l ON l.oid = p.prolang
        WHERE p.oid = v_gfn
          AND l.lanname = 'plpgsql' AND p.prosecdef AND p.provolatile = 'v' AND NOT p.proretset
          AND p.prorettype = 'trigger'::regtype AND p.pronargs = 0
          AND p.proconfig = ARRAY['search_path=public']::text[]
     ) THEN
    RAISE EXCEPTION 'conferencia 20261641000000: atributos de avaliacao_uma_por_cliente_e_produto mudaram (SECURITY DEFINER, volatilidade, search_path, retorno ou argumentos)';
  END IF;
  -- Função de gatilho FECHADA a todos os papéis de fora (a lista L8 não ganha entrada).
  IF EXISTS (SELECT 1 FROM pg_proc p
               CROSS JOIN LATERAL aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) g
              WHERE p.oid = v_gfn AND g.privilege_type = 'EXECUTE' AND g.grantee = 0)
     OR has_function_privilege('anon', v_gfn, 'EXECUTE')
     OR has_function_privilege('authenticated', v_gfn, 'EXECUTE')
     OR has_function_privilege('service_role', v_gfn, 'EXECUTE') THEN
    RAISE EXCEPTION 'conferencia 20261641000000: avaliacao_uma_por_cliente_e_produto alcançável por PUBLIC, anon, authenticated ou service_role';
  END IF;
  -- O gatilho: um só, em public.reviews, BEFORE INSERT por linha, ligado (origin), apontando para a função.
  IF (SELECT count(*) FROM pg_trigger t WHERE t.tgname = 'tr_avaliacao_uma_por_cliente_e_produto') <> 1
     OR NOT EXISTS (
          SELECT 1 FROM pg_trigger t
           WHERE t.tgname = 'tr_avaliacao_uma_por_cliente_e_produto'
             AND t.tgrelid = to_regclass('public.reviews') AND t.tgfoid = v_gfn
             AND t.tgtype = 7 AND t.tgenabled = 'O' AND t.tgqual IS NULL
             AND t.tgnargs = 0 AND t.tgattr::text = '' AND NOT t.tgisinternal
        ) THEN
    RAISE EXCEPTION 'conferencia 20261641000000: o gatilho tr_avaliacao_uma_por_cliente_e_produto não ficou como desenhado (um só, em public.reviews, BEFORE INSERT por linha, ligado, sem WHEN)';
  END IF;
END $conferencia_20261641000000$;

NOTIFY pgrst, 'reload schema';
