-- A LOJA GRANDE NAO TRAVA O BALCAO NEM OS AVISOS (26/11/2026; plano PLANO-LOJA-GRANDE-BANCO, T2 + T3; permissao + dado de cliente)
-- ADITIVA pelos criterios da carta branca: nao apaga tabela, coluna nem dado, nao muda dado existente e nao redefine nada que ja
-- existe. Cria 3 objetos novos: 2 indices e 1 funcao. A get_admin_customers_paged (tela Clientes, cupom exclusivo) fica INTACTA.
--
-- O DEFEITO: o balcao (AdminPdvView) acha o cliente pela get_admin_customers_paged(termo, 'created_at', 'desc', 0, 8). A cada pausa
-- de digitacao ela recalcula crm__vendas(now()) (MATERIALIZED, so para o global_ltv que o balcao nao usa) e junta TODOS os perfis
-- com TODOS os pedidos ANTES de filtrar: numa loja com 20 mil clientes e 50 mil pedidos sao centenas de milhares de linhas lidas
-- para mostrar 8 nomes. E o historico do pedido (sino do lojista e aviso de cancelamento do cron) e a lista de produtos (vitrine,
-- painel) ordenam por colunas sem indice.
--
-- O QUE ENTRA (3 objetos novos):
--   (1) idx_produtos_data_cadastro_id ON public.produtos (data_cadastro DESC, id): a ordem da vitrine (StoreContext, paginas de
--       200 por .range), do painel (useProducts) e da get_admin_products_paged. O .range vira OFFSET, que continua pulando as
--       linhas das paginas anteriores: o ganho na vitrine e o que a prova viva MEDE e imprime (pagina 1 e pagina 50, antes e depois),
--       nada alem disso se promete aqui.
--   (2) idx_order_history_status_criado ON public.marketplace_order_history (new_status, created_at DESC): o sino do lojista
--       (useAvisosDoLojista) e o aviso de cancelamento do cron (aviso-de-cancelamento-do-cliente.ts) leem new_status = 'cancelled'
--       das ultimas horas, do mais novo para o mais velho.
--   (3) public.buscar_clientes_do_balcao(p_search text, p_limite integer) RETURNS jsonb: a porta LEVE do balcao. As guardas
--       (is_admin() e is_admin_atual(), 20261412000000:84-90), o preparo do termo (:93-100), o endereco principal (LATERAL, :151-157)
--       e o FILTRO (:160-175) sao copias LETRA POR LETRA da get_admin_customers_paged: acha exatamente os clientes que ela acharia,
--       na mesma ordem (created_at DESC, id). ZERO leitura de pedidos: so profiles, auth.users (LEFT JOIN: perfil sem linha em
--       auth.users nao some) e user_addresses. p_limite tem teto 1..50 (NULL vale 8, a pagina do balcao). Resposta:
--       {data: [{id, full_name, phone, email}], total_count} (phone = COALESCE(p.whatsapp, u.phone), a mesma chave da antiga).
--       plpgsql, STABLE (so le), SECURITY DEFINER, search_path public, extensions (unaccent). EXECUTE so do authenticated: o REVOKE
--       tira PUBLIC, anon, authenticated e service_role e o GRANT devolve so ao authenticated (o service_role nao precisa: ninguem
--       chama pela chave de servico).
--
-- ORDEM E TRAVAS: tudo roda na transacao do aplicador (aplicar-migrations.yml / db-apply.cjs abrem BEGIN, aplicam o arquivo e fazem
-- COMMIT; qualquer erro, inclusive o pre-voo e o pos-voo daqui, desfaz o arquivo inteiro). Sem CONCURRENTLY (nao roda dentro de
-- transacao): cada CREATE INDEX pega SHARE na tabela ate o COMMIT, que deixa ler e faz quem GRAVA esperar a construcao.
-- PRIMEIRO produtos, DEPOIS o historico: e a ordem em que quem grava pega as duas tabelas (a venda do balcao faz UPDATE em produtos,
-- 20261280000000:797, e depois INSERT no historico, :834; o cancelamento devolve o estoque, 20261405700000:262, e depois grava o
-- historico, :276). Na ordem inversa a migration e uma venda podiam esperar uma pela outra (deadlock). O lock_timeout de 5 s faz a
-- migration FALHAR (e ser reaplicada) em vez de enfileirar as vendas atras de uma transacao longa; o statement_timeout de 30 s
-- corta uma construcao que nao termina. A funcao nao trava tabela nenhuma.
-- IDEMPOTENTE: IF NOT EXISTS nos indices (o pre-voo e o pos-voo conferem a DEFINICAO, porque o IF NOT EXISTS casa so pelo nome) e
-- CREATE OR REPLACE na funcao (o pre-voo so aceita a funcao ausente ou com o corpo desta migration). Rodar duas vezes, inclusive em
-- CRLF, nao muda nada.
--
-- DADOS EXISTENTES: nenhuma linha e lida para fora, escrita ou apagada. Os indices so passam a existir; a funcao so le.
--
-- PRE-VOO fail-closed (B1_BASELINE_DIVERGENT): recusa sem escrever se faltar alguma tabela/coluna que a porta le, is_admin(),
-- is_admin_atual() ou extensions.unaccent(text); se ja existir relacao com o nome de um dos indices que nao seja ESTE indice (outra
-- tabela, outras colunas, outra ordem, unico, parcial, invalido); ou se ja existir public.buscar_clientes_do_balcao com outra
-- assinatura ou outro corpo.
-- POS-VOO (B2_POSVOO_DIVERGENTE): confere os 2 indices validos com a definicao exata e a funcao com o corpo (md5), os atributos e o
-- EXECUTE so do authenticated.
--
-- ROLLBACK: rollback-manual-20261530000000_a_loja_grande_nao_trava_o_balcao_nem_os_avisos.sql derruba os 3 objetos (e so eles).
-- O front que chama a porta nova tem de sair ANTES do rollback (sem atalho para a porta antiga: o balcao mostraria a falha da busca).
-- PUBLICACAO: 190b antes, apply, 190a depois, em TODAS as lojas; so entao o front. PROVA VIVA:
-- tests/banco/a-loja-grande-nao-trava-o-balcao-viva.cjs (rpc-ci). TIPOS: src/types/database.types.ts ganha a porta.
-- Sem BEGIN/COMMIT: o aplicador controla a transacao (com eles o ROLLBACK da prova viraria no-op e a mudanca ficaria gravada).

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

-- ===== pre-voo =====

DO $preflight_20261530000000$
DECLARE
  v_coluna record;
  v_indice record;
  v_def text;
BEGIN
  FOR v_coluna IN
    SELECT * FROM (VALUES
      ('public.produtos', 'id', 'uuid'), ('public.produtos', 'data_cadastro', 'timestamp with time zone'),
      ('public.marketplace_order_history', 'new_status', 'text'),
      ('public.marketplace_order_history', 'created_at', 'timestamp with time zone'),
      ('public.profiles', 'id', 'uuid'), ('public.profiles', 'full_name', 'text'), ('public.profiles', 'whatsapp', 'text'),
      ('public.profiles', 'created_at', 'timestamp with time zone'),
      -- auth.users e da plataforma (email e character varying(255) no Supabase): ali so se exige a coluna, de texto.
      ('auth.users', 'id', 'uuid'), ('auth.users', 'email', NULL), ('auth.users', 'phone', NULL),
      ('public.user_addresses', 'id', 'uuid'), ('public.user_addresses', 'user_id', 'uuid'), ('public.user_addresses', 'city', 'text'),
      ('public.user_addresses', 'state', 'text'), ('public.user_addresses', 'is_default', 'boolean'),
      ('public.user_addresses', 'created_at', 'timestamp with time zone')
    ) AS t(tabela, coluna, tipo)
  LOOP
    IF to_regclass(v_coluna.tabela) IS NULL
       OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_attribute a
                       WHERE a.attrelid = to_regclass(v_coluna.tabela) AND a.attname = v_coluna.coluna
                         AND a.attnum > 0 AND NOT a.attisdropped
                         AND CASE WHEN v_coluna.tipo IS NULL
                                  THEN a.atttypid IN ('text'::regtype, 'character varying'::regtype)
                                  ELSE format_type(a.atttypid, a.atttypmod) = v_coluna.tipo END) THEN
      RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: falta %.% (%).', v_coluna.tabela, v_coluna.coluna, COALESCE(v_coluna.tipo, 'texto');
    END IF;
  END LOOP;
  IF to_regprocedure('public.is_admin()') IS NULL OR to_regprocedure('public.is_admin_atual()') IS NULL THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: faltam public.is_admin() ou public.is_admin_atual().';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
                  WHERE n.nspname = 'extensions' AND p.proname = 'unaccent'
                    AND pg_get_function_identity_arguments(p.oid) = 'text') THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: falta extensions.unaccent(text).';
  END IF;

  -- Um nome de indice ja ocupado so passa se for ESTE indice, inteiro e valido (o IF NOT EXISTS casa so pelo nome).
  FOR v_indice IN
    SELECT * FROM (VALUES
      ('public.idx_produtos_data_cadastro_id', 'public.produtos', 'btree (data_cadastro DESC, id)'),
      ('public.idx_order_history_status_criado', 'public.marketplace_order_history', 'btree (new_status, created_at DESC)')
    ) AS t(indice, tabela, definicao)
  LOOP
    IF to_regclass(v_indice.indice) IS NOT NULL THEN
      SELECT substr(pg_get_indexdef(i.indexrelid), strpos(pg_get_indexdef(i.indexrelid), ' USING ') + 7)
        INTO v_def
        FROM pg_catalog.pg_index i
       WHERE i.indexrelid = to_regclass(v_indice.indice)
         AND i.indrelid = to_regclass(v_indice.tabela)
         AND NOT i.indisunique AND i.indisvalid AND i.indisready AND i.indislive
         AND i.indnatts = 2 AND i.indnkeyatts = 2 AND i.indpred IS NULL AND i.indexprs IS NULL;
      IF v_def IS DISTINCT FROM v_indice.definicao THEN
        RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: % ja existe e nao e o indice desta migration (%).', v_indice.indice, COALESCE(v_def, 'outra tabela, outro tipo ou invalido');
      END IF;
    END IF;
  END LOOP;

  -- A porta: ausente, ou UMA so com a assinatura e o corpo desta migration (reaplicar).
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_proc p
              WHERE p.pronamespace = 'public'::regnamespace AND p.proname = 'buscar_clientes_do_balcao'
                AND (pg_get_function_identity_arguments(p.oid) <> 'p_search text, p_limite integer'
                     OR md5(replace(p.prosrc, chr(13), '')) <> '953a50af8e8e14e8a271d9124364bbc0')) THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: public.buscar_clientes_do_balcao ja existe com outra assinatura ou outro corpo.';
  END IF;
END $preflight_20261530000000$;

-- ===== (1) e (2) os indices: PRIMEIRO produtos, DEPOIS o historico (a ordem de trava de quem grava) =====

CREATE INDEX IF NOT EXISTS idx_produtos_data_cadastro_id
  ON public.produtos (data_cadastro DESC, id);

CREATE INDEX IF NOT EXISTS idx_order_history_status_criado
  ON public.marketplace_order_history (new_status, created_at DESC);

-- ===== (3) a porta leve do balcao =====

CREATE OR REPLACE FUNCTION public.buscar_clientes_do_balcao(p_search text, p_limite integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $$
DECLARE
    v_limite INTEGER;
    v_total_count BIGINT;
    v_data JSONB;
    v_clean_search TEXT;
    v_search_digitos TEXT;
BEGIN
    -- As MESMAS guardas da get_admin_customers_paged (20261412000000:84-90), letra por letra.
    IF NOT public.is_admin() THEN
        RAISE EXCEPTION 'Acesso negado: privilégios de administrador necessários.';
    END IF;
    -- Papel ATUAL (auth.users E profiles), não o do JWT: admin rebaixado para aqui (20261199000000).
    IF NOT public.is_admin_atual() THEN
        RAISE EXCEPTION 'Acesso negado: privilégios de administrador necessários.';
    END IF;

    -- Teto: de 1 a 50 linhas; NULL vale 8 (a pagina do balcao).
    v_limite := LEAST(GREATEST(COALESCE(p_limite, 8), 1), 50);
    -- O MESMO preparo do termo (20261412000000:93-100), letra por letra.
    v_clean_search := TRIM(p_search);
    -- So os digitos do que a pessoa digitou (o WhatsApp e' gravado MASCARADO, "(34) 99999-1234", e a
    -- comparacao crua de texto nunca casava quem digitava so os numeros). Com 12 ou 13 digitos que
    -- comecam por 55 (o +55 do Brasil colado do WhatsApp), o 55 sai: o cadastro nao o guarda.
    v_search_digitos := regexp_replace(COALESCE(v_clean_search, ''), '[^0-9]', '', 'g');
    IF length(v_search_digitos) IN (12, 13) AND left(v_search_digitos, 2) = '55' THEN
        v_search_digitos := substr(v_search_digitos, 3);
    END IF;

    -- So perfis, a conta (LEFT JOIN: perfil sem conta nao some) e o endereco principal. Nenhum pedido.
    WITH achados AS (
        SELECT
            p.id,
            p.full_name,
            COALESCE(p.whatsapp, u.phone) AS phone,
            u.email,
            COUNT(*) OVER () AS full_count,
            ROW_NUMBER() OVER (ORDER BY p.created_at DESC, p.id) AS ordem
        FROM public.profiles p
        LEFT JOIN auth.users u ON u.id = p.id
        -- UM endereco principal por cliente (o mais novo; no empate, o de menor id), o MESMO da get_admin_customers_paged
        -- (20261412000000:151-157): dois enderecos is_default na mesma conta nao repetem a cliente (20261399993000).
        LEFT JOIN LATERAL (
            SELECT a.city, a.state
            FROM public.user_addresses a
            WHERE a.user_id = p.id AND a.is_default = true
            ORDER BY a.created_at DESC NULLS LAST, a.id
            LIMIT 1
        ) addr ON true
        -- O FILTRO da get_admin_customers_paged (20261412000000:160-175), letra por letra.
        WHERE (
            v_clean_search = '' OR (
                unaccent(p.full_name) ILIKE unaccent('%' || v_clean_search || '%') OR
                unaccent(u.email) ILIKE unaccent('%' || v_clean_search || '%') OR
                unaccent(u.phone) ILIKE unaccent('%' || v_clean_search || '%') OR
                unaccent(p.whatsapp) ILIKE unaccent('%' || v_clean_search || '%') OR
                -- TELEFONE por DIGITOS, nos dois lados, so com 4 ou mais digitos (a mesma regra da
                -- busca de pedidos e do CRM: com menos, um digito solto casaria quase todo mundo).
                (length(v_search_digitos) >= 4 AND (
                    regexp_replace(COALESCE(p.whatsapp, ''), '[^0-9]', '', 'g') LIKE '%' || v_search_digitos || '%' OR
                    regexp_replace(COALESCE(u.phone, ''), '[^0-9]', '', 'g') LIKE '%' || v_search_digitos || '%'
                )) OR
                unaccent(addr.city) ILIKE unaccent('%' || v_clean_search || '%') OR
                unaccent(addr.state) ILIKE unaccent('%' || v_clean_search || '%')
            )
        )
        -- A ordem da antiga com 'created_at' 'desc': o mais novo primeiro, desempate pelo id.
        ORDER BY p.created_at DESC, p.id
        LIMIT v_limite
    )
    SELECT
        COALESCE(MAX(a.full_count), 0),
        COALESCE(jsonb_agg(jsonb_build_object('id', a.id, 'full_name', a.full_name, 'phone', a.phone, 'email', a.email) ORDER BY a.ordem), '[]'::JSONB)
    INTO v_total_count, v_data
    FROM achados a;

    RETURN jsonb_build_object(
        'data', v_data,
        'total_count', v_total_count
    );
END;
$$;

REVOKE ALL ON FUNCTION public.buscar_clientes_do_balcao(text, integer) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.buscar_clientes_do_balcao(text, integer) TO authenticated;
COMMENT ON FUNCTION public.buscar_clientes_do_balcao(text, integer) IS 'Busca de cliente do balcao: o filtro e as guardas da get_admin_customers_paged (20261412000000), sem ler pedidos. Teto 1..50 (NULL = 8). {data:[{id,full_name,phone,email}],total_count}.';

-- ===== pos-voo =====

DO $posvoo_20261530000000$
DECLARE
  v_indice record;
  v_def text;
BEGIN
  FOR v_indice IN
    SELECT * FROM (VALUES
      ('public.idx_produtos_data_cadastro_id', 'public.produtos', 'btree (data_cadastro DESC, id)'),
      ('public.idx_order_history_status_criado', 'public.marketplace_order_history', 'btree (new_status, created_at DESC)')
    ) AS t(indice, tabela, definicao)
  LOOP
    v_def := NULL;
    SELECT substr(pg_get_indexdef(i.indexrelid), strpos(pg_get_indexdef(i.indexrelid), ' USING ') + 7)
      INTO v_def
      FROM pg_catalog.pg_index i
     WHERE i.indexrelid = to_regclass(v_indice.indice)
       AND i.indrelid = to_regclass(v_indice.tabela)
       AND NOT i.indisunique AND i.indisvalid AND i.indisready AND i.indislive
       AND i.indnatts = 2 AND i.indnkeyatts = 2 AND i.indpred IS NULL AND i.indexprs IS NULL;
    IF v_def IS DISTINCT FROM v_indice.definicao THEN
      RAISE EXCEPTION 'B2_POSVOO_DIVERGENTE: % nao ficou com a definicao desta migration (%).', v_indice.indice, COALESCE(v_def, 'ausente ou invalido');
    END IF;
  END LOOP;

  IF (SELECT count(*) FROM pg_catalog.pg_proc p
       WHERE p.pronamespace = 'public'::regnamespace AND p.proname = 'buscar_clientes_do_balcao') <> 1
     OR NOT EXISTS (
       SELECT 1 FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_language l ON l.oid = p.prolang
        WHERE p.oid = to_regprocedure('public.buscar_clientes_do_balcao(text, integer)')
          AND md5(replace(p.prosrc, chr(13), '')) = '953a50af8e8e14e8a271d9124364bbc0'
          AND l.lanname = 'plpgsql' AND p.prosecdef AND p.provolatile = 's' AND NOT p.proretset AND NOT p.proisstrict
          AND p.proconfig = ARRAY['search_path=public, extensions']::text[]
          AND p.prorettype = 'jsonb'::regtype) THEN
    RAISE EXCEPTION 'B2_POSVOO_DIVERGENTE: public.buscar_clientes_do_balcao nao ficou com o corpo e os atributos desta migration.';
  END IF;
  IF NOT has_function_privilege('authenticated', 'public.buscar_clientes_do_balcao(text, integer)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.buscar_clientes_do_balcao(text, integer)', 'EXECUTE')
     OR has_function_privilege('service_role', 'public.buscar_clientes_do_balcao(text, integer)', 'EXECUTE')
     OR EXISTS (SELECT 1 FROM pg_catalog.pg_proc p, aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) g
                 WHERE p.oid = to_regprocedure('public.buscar_clientes_do_balcao(text, integer)')
                   AND g.grantee = 0 AND g.privilege_type = 'EXECUTE') THEN
    RAISE EXCEPTION 'B2_POSVOO_DIVERGENTE: o EXECUTE de public.buscar_clientes_do_balcao tem de ser so do authenticated.';
  END IF;
END $posvoo_20261530000000$;

NOTIFY pgrst, 'reload schema';
