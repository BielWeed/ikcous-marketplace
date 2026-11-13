-- O PAINEL DE AVALIACOES FILTRA O QUE ESTA SEM RESPOSTA (lote 148; 13/11/2026).
-- O aviso "avaliacao sem resposta" (o sino do painel) abria Clientes > Avaliacoes em "Todas": 10 por pagina, as mais novas
-- primeiro. Se chegassem mais de 10 avaliacoes depois da do aviso, ela ficava na pagina 2 ou 3 e o aviso mentia. A migration
-- 20261399700000 ja deu a get_admin_reviews_paged o parametro p_status ('pendente' = so as em moderacao, 'todas' = sem filtro);
-- esta acrescenta o terceiro valor: 'sem_resposta' mostra SO as avaliacoes sem resposta da loja, na lista E no total_count
-- (o paginador). Qualquer outro valor (NULL, 'todas', 'pendente', texto desconhecido) segue como antes - nunca erro, e o
-- texto nunca entra em SQL montado (so e comparado com literais). Os contadores GLOBAIS continuam SEM filtro de status.
--
-- REGRA DE "SEM RESPOSTA" = a do sino (src/lib/avaliacoes-para-atender.ts, a metade "responder" de merchant_reply.is.null,status.eq.pendente):
-- merchant_reply IS NULL. Resposta em branco ('' ou so espacos) NAO conta como sem resposta, igual ao sino (o app nunca grava uma:
-- as duas telas de resposta barram texto sem conteudo antes da RPC, e a tela desenha a em branco como respondida). Nao ha filtro de
-- status: uma avaliacao em moderacao que ainda nao tem resposta tambem entra (ela tambem espera uma resposta, e o sino a conta).
-- Observacao (preexistente, fora desta migration): o contador global_total_replied descarta a resposta so com espacos (TRIM <> ''),
-- e esta regra NAO - os dois so divergem numa linha com resposta em branco, que o app nao produz.
--
-- ASSINATURA: NAO muda (os mesmos 5 argumentos da 20261399700000), entao nao ha DROP nem sobrecarga nova: CREATE OR REPLACE
-- preserva OID, dono, atributos e ACL, e o pos-voo confere isso contra a fotografia do pre-voo.
-- Corpo: o VIVO da 20261399700000 (md5 af5d21345d167ca44dd327a93f949ea6) com TRES edicoes: a variavel v_so_sem_resposta, a linha que a calcula e o
-- predicado AND (NOT v_so_sem_resposta OR r.merchant_reply IS NULL) na CONTAGEM e na CONSULTA PAGINADA (nos dois: filtrar so a
-- pagina faria o total mentir). O gate (is_admin_atual), a ordem e o filtro de moderacao ficam como estao.
-- DADO EXISTENTE: nenhuma linha de reviews, produtos ou profiles e' lida ou escrita ao aplicar; so o corpo de UMA funcao muda.
-- Ninguem perde acesso nem ganha: o gate e a ACL sao os de antes. Quem chama sem p_status (o Inicio, o prefetch, o hook) recebe o JSON de antes.
--
-- PRE-VOO: exatamente UMA assinatura de get_admin_reviews_paged em public, a de 5 argumentos, com o corpo da 20261399700000
-- (md5 af5d21345d167ca44dd327a93f949ea6) ou o desta migration (md5 75f5c48de4eb4005a2516e54b3d33135, reaplicar); atributos, dono (o de is_admin_atual) e ACL conferidos;
-- zero ou duas assinaturas (inclusive a loja que ainda nao recebeu a 20261399700000), corpo estranho, anon ou PUBLIC com EXECUTE
-- recusam com B1_BASELINE_DIVERGENT antes de escrever. POS-VOO: a mesma assinatura sozinha, com o corpo desta migration, e o resto
-- do catalogo da funcao (OID, dono, ACL, atributos) IGUAL ao da fotografia do pre-voo; aborta tudo se divergir.
-- Idempotente: reaplicar troca o corpo pelo mesmo corpo. Sem BEGIN/COMMIT de nivel superior: o aplicador fornece a transacao
-- inteira (AGENTS.md), e e' ela que faz o CREATE e as conferencias valerem juntos ou nao valerem (a fotografia e' set_config local).
-- ORDEM: depois da 20261399700000 e ANTES do front que manda p_status = 'sem_resposta' (numa loja sem esta migration o texto
-- 'sem_resposta' vale 'todas': o filtro mostraria todas as avaliacoes, sem erro). COMPORTAMENTO:
-- tests/banco/o-painel-de-avaliacoes-filtra-o-que-esta-sem-resposta-viva.cjs (so CI efemero).
-- ROLLBACK MANUAL: rollback-manual-20261399996000_o_painel_de_avaliacoes_filtra_o_que_esta_sem_resposta.sql devolve o corpo da 20261399700000
-- byte a byte (LF, sem CR); recusa corpo desconhecido e segundo rollback.
--
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

DO $preflight_20261399996000$
DECLARE
  v_oid oid := to_regprocedure('public.get_admin_reviews_paged(text,text,integer,integer,text)');
  v_hash text;
  v_args text;
BEGIN
  IF v_oid IS NULL
     OR (SELECT count(*) FROM pg_proc q WHERE q.pronamespace = 'public'::regnamespace AND q.proname = 'get_admin_reviews_paged') <> 1 THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: get_admin_reviews_paged precisa existir com UMA assinatura so, a de 5 argumentos (a 20261399700000 aplicada), e ha zero ou duas; revise antes de aplicar.';
  END IF;
  SELECT md5(replace(p.prosrc, E'\r', '')), pg_get_function_arguments(p.oid)
    INTO v_hash, v_args FROM pg_proc p WHERE p.oid = v_oid;
  IF v_hash NOT IN ('af5d21345d167ca44dd327a93f949ea6', '75f5c48de4eb4005a2516e54b3d33135') OR v_args <> 'p_search text DEFAULT ''''::text, p_rating text DEFAULT ''all''::text, p_page integer DEFAULT 0, p_page_size integer DEFAULT 10, p_status text DEFAULT ''todas''::text' THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: public.get_admin_reviews_paged(text,text,integer,integer,text) (hash %) nao e o corpo vigente (20261399700000) nem o desta migration; revise antes de aplicar.', v_hash;
  END IF;
    IF NOT EXISTS (
      SELECT 1 FROM pg_proc p JOIN pg_language l ON l.oid = p.prolang
       WHERE p.oid = v_oid
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
  -- Fotografia de TUDO que a funcao e' no catalogo (OID, dono, ACL, atributos): o CREATE OR REPLACE so pode trocar o corpo.
  PERFORM set_config('ikcous.avaliacoes3996_estado', (SELECT to_jsonb(p) - 'prosrc' FROM pg_proc p WHERE p.oid = v_oid)::text, true);
END $preflight_20261399996000$;

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
    FROM public.reviews r;

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

DO $conferencia_20261399996000$
DECLARE
  v_oid oid := to_regprocedure('public.get_admin_reviews_paged(text,text,integer,integer,text)');
BEGIN
  IF v_oid IS NULL
     OR (SELECT count(*) FROM pg_proc q WHERE q.pronamespace = 'public'::regnamespace AND q.proname = 'get_admin_reviews_paged') <> 1 THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: conferencia 20261399996000 falhou (a assinatura de 5 argumentos nao existe sozinha).';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p WHERE p.oid = v_oid
      AND md5(replace(p.prosrc, E'\r', '')) = '75f5c48de4eb4005a2516e54b3d33135'
      AND pg_get_function_arguments(p.oid) = 'p_search text DEFAULT ''''::text, p_rating text DEFAULT ''all''::text, p_page integer DEFAULT 0, p_page_size integer DEFAULT 10, p_status text DEFAULT ''todas''::text'
  ) THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: conferencia 20261399996000 falhou (corpo ou argumentos alterados).';
  END IF;
  IF (SELECT to_jsonb(p) - 'prosrc' FROM pg_proc p WHERE p.oid = v_oid) IS DISTINCT FROM current_setting('ikcous.avaliacoes3996_estado')::jsonb THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: conferencia 20261399996000 falhou (OID, dono, ACL ou atributo mudou).';
  END IF;
END $conferencia_20261399996000$;

NOTIFY pgrst, 'reload schema';
