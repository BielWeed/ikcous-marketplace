-- O PAINEL DE AVALIACOES FILTRA O QUE ESTA EM MODERACAO (lote 123; 05/11/2026).
-- Em Clientes > Avaliacoes o topo diz "N para aprovar", mas a lista so tinha filtro por NOTA e ordena por data
-- (a mais nova primeiro). Com mais de 10 avaliacoes, uma pendente antiga afunda para a pagina 3, 4... e a lojista tem
-- de paginar procurando o selo "Em moderacao"; a busca por texto tambem nao olha o status. get_admin_reviews_paged
-- ganha o parametro p_status text DEFAULT 'todas': 'pendente' mostra SO as avaliacoes em moderacao, na lista E no
-- total_count (o paginador); qualquer outro valor (NULL, 'todas', texto desconhecido) e' o comportamento de antes -
-- nunca erro e o texto nunca entra em SQL montado (so e' comparado com 'pendente'). Os contadores GLOBAIS
-- (global_total_count, global_average_rating, global_total_verified, global_total_replied) continuam SEM filtro de status.
-- A aba "Pendentes" da tela de Perguntas e' o modelo de uso; o front passa p_status so quando o filtro esta ligado.
--
-- ASSINATURA NOVA: um parametro a mais muda a assinatura, e uma sobrecarga velha ao lado da nova faria o PostgREST
-- recusar a chamada com os 4 parametros nomeados (PGRST203, a mesma licao da 20261034000000 e da 20261163000000).
-- Por isso esta migration (1) faz DROP FUNCTION IF EXISTS da assinatura de 4 argumentos - SO dessa funcao, recriada
-- logo abaixo, nada mais e' apagado - e (2) cria a de 5. Quem chama com os 4 nomeados (o Inicio do painel, o prefetch,
-- o hook de 20 por pagina) resolve na nova pelo DEFAULT, com o mesmo resultado de antes.
-- Corpo: o VIVO da 20261381000000 (md5 8571a56a9b21e90ebdcf941d762870ac, ja com is_admin_atual()) com QUATRO edicoes: a variavel
-- v_so_pendentes, a linha que a calcula, e o predicado AND (NOT v_so_pendentes OR r.status = 'pendente') na CONTAGEM e
-- na CONSULTA PAGINADA (nos dois: filtrar so a pagina faria o total mentir). Atributos, SECURITY DEFINER, search_path,
-- dono e ACL ficam como os da funcao viva: DROP derruba a ACL e a funcao nova nasceria com EXECUTE para PUBLIC e anon,
-- entao a migration refaz REVOKE/GRANT (authenticated e service_role, sem PUBLIC nem anon) e o pos-voo confere que a
-- ACL e todos os atributos sao IGUAIS aos da fotografia tirada antes, e aborta tudo se nao forem.
-- DADO EXISTENTE: nenhuma linha de reviews, produtos ou profiles e' lida ou escrita ao aplicar; so o catalogo de
-- funcoes muda. Ninguem perde acesso nem ganha: o corpo, o gate (is_admin_atual) e a ACL sao os de antes.
--
-- PRE-VOO: exatamente UMA assinatura de get_admin_reviews_paged no schema public; se e' a de 4 argumentos, o corpo e os
-- argumentos tem de ser os da 381 (md5 8571a56a9b21e90ebdcf941d762870ac); se e' a de 5 (reaplicar), os desta migration (md5 af5d21345d167ca44dd327a93f949ea6).
-- Atributos, dono (o de is_admin_atual) e ACL conferidos nos dois casos; zero ou duas assinaturas, corpo estranho,
-- anon ou PUBLIC com EXECUTE recusam com B1_BASELINE_DIVERGENT antes de escrever. POS-VOO: a assinatura antiga nao existe,
-- a nova existe sozinha com o corpo desta migration, e atributos e ACL batem com a fotografia do pre-voo.
-- Idempotente: reaplicar deixa o mesmo estado (DROP IF EXISTS, CREATE OR REPLACE, REVOKE e GRANT sao declarativos).
-- Sem BEGIN/COMMIT de nivel superior: o aplicador fornece a transacao inteira (AGENTS.md), e e' ela que faz DROP, CREATE,
-- REVOKE, GRANT e as conferencias valerem juntos ou nao valerem (a fotografia do pre-voo e' set_config local da transacao).
-- ORDEM: depois da 20261399600000. COMPORTAMENTO: tests/banco/o-painel-de-avaliacoes-filtra-o-que-esta-em-moderacao-viva.cjs (so CI efemero).
-- ROLLBACK MANUAL: rollback-manual-20261399700000_o_painel_de_avaliacoes_filtra_o_que_esta_em_moderacao.sql devolve a
-- assinatura de 4 argumentos e o corpo vivo da 381 byte a byte (LF, sem CR), refaz a ACL e remove a de 5; recusa corpo
-- desconhecido e segundo rollback.
--
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

DO $preflight_20261399700000$
DECLARE
  v_antiga oid := to_regprocedure('public.get_admin_reviews_paged(text,text,integer,integer)');
  v_nova oid := to_regprocedure('public.get_admin_reviews_paged(text,text,integer,integer,text)');
  v_oid oid;
  v_hash text;
  v_args text;
BEGIN
  IF (v_antiga IS NULL) = (v_nova IS NULL)
     OR (SELECT count(*) FROM pg_proc q WHERE q.pronamespace = 'public'::regnamespace AND q.proname = 'get_admin_reviews_paged') <> 1 THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: get_admin_reviews_paged precisa existir com UMA assinatura so (a de 4 argumentos ou a de 5), e ha zero ou duas; revise antes de aplicar.';
  END IF;
  v_oid := COALESCE(v_antiga, v_nova);
  SELECT md5(replace(p.prosrc, E'\r', '')), pg_get_function_arguments(p.oid)
    INTO v_hash, v_args FROM pg_proc p WHERE p.oid = v_oid;
  IF v_antiga IS NOT NULL THEN
    IF v_hash <> '8571a56a9b21e90ebdcf941d762870ac' OR v_args <> 'p_search text DEFAULT ''''::text, p_rating text DEFAULT ''all''::text, p_page integer DEFAULT 0, p_page_size integer DEFAULT 10' THEN
      RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: public.get_admin_reviews_paged(text,text,integer,integer) (hash %) nao e o corpo vigente (20261381000000); revise antes de aplicar.', v_hash;
    END IF;
  ELSE
    IF v_hash <> 'af5d21345d167ca44dd327a93f949ea6' OR v_args <> 'p_search text DEFAULT ''''::text, p_rating text DEFAULT ''all''::text, p_page integer DEFAULT 0, p_page_size integer DEFAULT 10, p_status text DEFAULT ''todas''::text' THEN
      RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: public.get_admin_reviews_paged(text,text,integer,integer,text) (hash %) nao e o corpo desta migration; revise antes de aplicar.', v_hash;
    END IF;
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
  -- Fotografar atributos e ACL: a funcao nova so pode trocar oid, argumentos e corpo.
  PERFORM set_config('ikcous.avaliacoes3997_atributos', (SELECT to_jsonb(p) - ARRAY['oid','pronargs','pronargdefaults','proargtypes','proargnames','proargdefaults','proallargtypes','proargmodes','prosrc','proacl'] FROM pg_proc p WHERE p.oid = v_oid)::text, true);
  PERFORM set_config('ikcous.avaliacoes3997_acl', (SELECT COALESCE(jsonb_agg(s.x ORDER BY s.x), '[]'::jsonb) FROM (
           SELECT (CASE WHEN a.grantee = 0 THEN 'PUBLIC' ELSE a.grantee::regrole::text END) || ':' || a.privilege_type || ':' || a.is_grantable AS x
             FROM pg_proc p CROSS JOIN LATERAL aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) a
            WHERE p.oid = v_oid) s)::text, true);
END $preflight_20261399700000$;

DROP FUNCTION IF EXISTS public.get_admin_reviews_paged(text, text, integer, integer);

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

REVOKE ALL ON FUNCTION public.get_admin_reviews_paged(text,text,integer,integer,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_admin_reviews_paged(text,text,integer,integer,text) TO authenticated, service_role;

DO $conferencia_20261399700000$
DECLARE
  v_nova oid := to_regprocedure('public.get_admin_reviews_paged(text,text,integer,integer,text)');
BEGIN
  IF to_regprocedure('public.get_admin_reviews_paged(text,text,integer,integer)') IS NOT NULL OR v_nova IS NULL
     OR (SELECT count(*) FROM pg_proc q WHERE q.pronamespace = 'public'::regnamespace AND q.proname = 'get_admin_reviews_paged') <> 1 THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: conferencia 20261399700000 falhou (a assinatura antiga ainda existe, ou a nova nao).';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p WHERE p.oid = v_nova
      AND md5(replace(p.prosrc, E'\r', '')) = 'af5d21345d167ca44dd327a93f949ea6'
      AND pg_get_function_arguments(p.oid) = 'p_search text DEFAULT ''''::text, p_rating text DEFAULT ''all''::text, p_page integer DEFAULT 0, p_page_size integer DEFAULT 10, p_status text DEFAULT ''todas''::text'
  ) THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: conferencia 20261399700000 falhou (corpo ou argumentos alterados).';
  END IF;
  IF (SELECT to_jsonb(p) - ARRAY['oid','pronargs','pronargdefaults','proargtypes','proargnames','proargdefaults','proallargtypes','proargmodes','prosrc','proacl'] FROM pg_proc p WHERE p.oid = v_nova) IS DISTINCT FROM current_setting('ikcous.avaliacoes3997_atributos')::jsonb THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: conferencia 20261399700000 falhou (atributos ou dono diferentes da funcao de antes).';
  END IF;
  IF (SELECT COALESCE(jsonb_agg(s.x ORDER BY s.x), '[]'::jsonb) FROM (
           SELECT (CASE WHEN a.grantee = 0 THEN 'PUBLIC' ELSE a.grantee::regrole::text END) || ':' || a.privilege_type || ':' || a.is_grantable AS x
             FROM pg_proc p CROSS JOIN LATERAL aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) a
            WHERE p.oid = v_nova) s) IS DISTINCT FROM current_setting('ikcous.avaliacoes3997_acl')::jsonb THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: conferencia 20261399700000 falhou (a ACL da funcao nova nao e a da funcao de antes).';
  END IF;
END $conferencia_20261399700000$;

NOTIFY pgrst, 'reload schema';
