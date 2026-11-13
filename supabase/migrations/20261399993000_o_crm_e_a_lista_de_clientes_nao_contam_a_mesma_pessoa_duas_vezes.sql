-- ============================================================================
-- Migration 20261399993000 -- o CRM e a lista de clientes nao contam a mesma pessoa duas vezes (dado de cliente; so LEITURA; troca o corpo de DUAS funcoes)
-- ============================================================================
--
-- 1. OS DOIS DEFEITOS (achados de caca, lote 429; os dois reproduzidos em Postgres com os corpos reais)
--
-- D1) public.crm__nunca_comprou(p_ate): a pessoa que tem CONTA (profile) mas nenhum pedido ligado a conta, e que a lojista registrou como "Cliente
-- avulso" com o MESMO WhatsApp (venda anulada no mesmo dia, devolvida, ou pedido que ficou sem pagar), aparecia DUAS vezes no CRM > Clientes: uma
-- em "Pediu e nao pagou" (o pedido avulso, chave 'wa:<numero>', vem de crm__pedidos_nao_pagos) e outra em "Cadastrado, nunca comprou" (o perfil). A
-- crm__nunca_comprou so excluia o perfil que tem pedido ligado a conta ou cujo WhatsApp bate com o de uma venda PAGA ('wa:' de crm__vendas); nao
-- olhava o grupo "nao pagou". O mesmo vale para o numero do Inicio e do CRM (crm_visao, segmentos): a pessoa contava nos dois segmentos.
--
-- D2) public.get_admin_customers_paged(...): a lista de clientes (tela Clientes do painel, busca do balcao e do cupom exclusivo, e o ranking por
-- "Maior total comprado") juntava TODOS os enderecos `is_default` da conta ANTES de contar e somar os pedidos
-- (`LEFT JOIN public.user_addresses addr ON addr.user_id = p.id AND addr.is_default = true`). Nada impede dois enderecos principais na mesma conta: o
-- gatilho handle_default_address so desmarca as linhas que JA existem, e a conta sem endereco que abre o cadastro em dois aparelhos salva os dois
-- primeiros enderecos ao mesmo tempo (nenhuma das duas insercoes enxerga a outra antes de confirmar; nao ha indice unico parcial). Resultado, medido:
-- com os dois na mesma cidade, uma compra paga de R$ 100 virava 2 pedidos e R$ 200 na lista e no ranking; com cidades diferentes a cliente saia em
-- DUAS linhas (uma por cidade) e o total de clientes subia junto.
--
-- 2. AS REGRAS NOVAS
--
-- D1) crm__nunca_comprou ganha uma segunda exclusao: o perfil cujo WhatsApp (so digitos, e SEM o 55 do pais quando o numero tem 12 ou 13 digitos
-- comecando por 55 -- a MESMA expressao da 20261183000000, N4, e da 20261399990000) bate com o de um registro do grupo "Pediu e nao pagou" que nao
-- pertence a nenhuma conta (crm__pedidos_nao_pagos com user_id nulo, a chave 'wa:'). Quem decide o que e o grupo "nao pagou" continua sendo a
-- crm__pedidos_nao_pagos (qualquer status, cancelado ou devolvido incluidos, nenhum pedido pago valido): a nova exclusao a LE em vez de repetir
-- a regra dela, entao "esta no grupo" e "sai de nunca comprou" nunca divergem. A exclusao e dos dois lados com ou sem o 55.
--
-- D2) a lista toma UM endereco principal por cliente ANTES de juntar com os pedidos: o mais novo (created_at DESC, nulo por ultimo) e, no
-- empate, o de menor id. A juncao vira `LEFT JOIN LATERAL (... ORDER BY a.created_at DESC NULLS LAST, a.id LIMIT 1) addr ON true`: sem endereco
-- principal a cliente continua na lista (cidade e estado nulos, como antes); com um so, o resultado e o de antes; com varios, UM.
--
-- 3. O QUE ACONTECE EM CADA CASO
--
--   * perfil com WhatsApp e venda avulsa (anulada, devolvida ou sem pagar) com o MESMO numero, com ou sem o 55 de um lado ou do outro:
--     aparece UMA vez, em "Pediu e nao pagou"; sai de "nunca comprou";
--   * perfil que nunca pediu nada, perfil sem WhatsApp e perfil cujo numero e DIFERENTE do pedido avulso: continuam em "nunca comprou";
--   * DDD 55 de 11 digitos ("55999991234") NAO perde o 55 (nao casa com "999991234"); pais + DDD 55 (13 digitos) casa com o de 11;
--   * perfil com venda avulsa PAGA com o mesmo numero: ja saia de "nunca comprou" (wa_pagos) e continua assim;
--   * conta com dois enderecos principais: uma linha, um endereco (o mais novo), contagem e soma de pedidos certas;
--   * conta sem endereco e conta com um endereco principal: iguais a antes; cliente com so enderecos nao principais: sem cidade, como antes;
--   * busca por cidade ou estado: acha pelo endereco principal ESCOLHIDO (a busca pela cidade de um segundo endereco principal deixa de achar:
--     esse segundo endereco nao e mais o que a lista mostra).
--
-- 4. O QUE MUDA NO CORPO (so isto; o resto nao muda um byte)
--
-- crm__nunca_comprou: entra a CTE `wa_nao_pagos` depois de `wa_pagos` e um terceiro `AND NOT EXISTS (...)` no fim do WHERE.
-- get_admin_customers_paged: a linha do LEFT JOIN de user_addresses vira o LEFT JOIN LATERAL acima (o resto, inclusive o GROUP BY por
-- addr.city, addr.state, a busca, as estatisticas, o ORDER BY e o formato do JSON, nao muda). As assinaturas, o retorno, LANGUAGE, STABLE ou VOLATILE,
-- SECURITY DEFINER ou INVOKER, search_path, dono, OID e ACL das duas NAO mudam. Nenhum GRANT e nenhum REVOKE neste arquivo.
--
-- 5. QUEM LE
--
-- crm__nunca_comprou: crm_clientes e crm_visao (e o grupo "nunca comprou" da lista do CRM e o segmento do mesmo nome na grade). crm_clientes,
-- crm_visao, crm__vendas, crm__clientes_rfm e crm__pedidos_nao_pagos NAO mudam. get_admin_customers_paged: AdminCustomersView (tela Clientes),
-- useCoupons e ClienteDaVenda (balcao): o formato do JSON e o mesmo. Nenhum front e nenhuma edge function mudam. O Inicio (painel_inicio), o
-- ranking de lucro e os demais relatorios NAO leem user_addresses nem crm__nunca_comprou (medido nas migrations): o defeito D2 nao existe ali.
-- Custo: crm_clientes e crm_visao passam a avaliar crm__pedidos_nao_pagos duas vezes (a propria e a de dentro de crm__nunca_comprou); a
-- 20261183000000 (N5) ja aceitou esse tipo de varredura no volume atual da loja.
--
-- 6. DADOS EXISTENTES
--
-- Nenhuma linha de pedido, conta, perfil, endereco ou historico e lida para escrita ou escrita ao aplicar: so o corpo de DUAS funcoes muda.
-- NENHUM endereco e apagado nem desmarcado e nenhum indice unico e criado (mudar dado existente e decisao do dono): as contas que ja tem dois
-- enderecos principais continuam com os dois no banco; so a LEITURA toma um. Pessoas que hoje aparecem duas vezes no CRM passam a aparecer UMA.
--
-- 7. PRE-VOO (B1_BASELINE_DIVERGENT, ANTES de qualquer escrita)
--
-- Recusa se: alguma das duas funcoes nao existir ou tiver sobrecarga; o corpo vivo (md5 de replace(prosrc, E'\r', '')) nao for UM dos dois
-- conhecidos de cada uma (crm__nunca_comprou: o da 20261183000000, 9a83cf34789b8b67c245648c8d82fc42, ou o desta migration, 3aa94ac8dc4ce19db958e6d93cbea7a8;
-- get_admin_customers_paged: o da 20261392000000, 1c71829d75e3d8f17bf7fb01019c05ec, ou o desta, 35212d373895b2a9ede613198fc4c794); os atributos nao forem os de
-- sempre; a ACL nao for a de sempre (crm__nunca_comprou: PUBLIC, anon e authenticated sem EXECUTE; get_admin_customers_paged: PUBLIC e anon sem,
-- authenticated e service_role com); ou faltar uma coluna ou funcao que os corpos usam. Fotografa OID, dono, ACL e TODOS os atributos de cada
-- uma (set_config local a transacao) para a conferencia final. Os hashes sao o md5 REAL dos corpos, amarrados ao texto por
-- tests/migration_o_crm_e_a_lista_de_clientes_nao_contam_a_mesma_pessoa_duas_vezes_test.ts.
--
-- 8. TRANSACAO, IDEMPOTENCIA E REAPLICACAO
--
-- Sem BEGIN/COMMIT de nivel superior (regra da casa: com eles o ROLLBACK dos scripts de prova vira no-op e a mudanca fica gravada): quem abre a
-- transacao e o aplicador (psql -1 / db-apply, que mandam o arquivo como UM so lote); o pre-voo, as duas trocas de corpo e a conferencia caem
-- juntos ou nao caem. Dois estados de entrada por funcao: o corpo anterior (aplica) ou o desta migration (reaplicar reescreve o MESMO texto,
-- mesmo estado). Qualquer outro estado ABORTA sem escrever. CREATE OR REPLACE (sem DROP) preserva OID, dono e ACL; a conferencia exige que todos
-- os atributos fiquem iguais aos da fotografia. Rodar duas vezes deixa o mesmo estado.
--
-- 9. ORDEM E ROLLBACK
--
-- Depois da 20261183000000 e da 20261392000000 (o pre-voo recusa corpo diferente). Sem ordem em relacao ao front (nenhum front muda). ROLLBACK
-- MANUAL: rollback-manual-20261399993000_o_crm_e_a_lista_de_clientes_nao_contam_a_mesma_pessoa_duas_vezes.sql devolve os DOIS corpos anteriores
-- byte a byte; vem ANTES do rollback da 20261392000000 (que recusa com o corpo novo no ar) e da 20261183000000 (que so da DROP em
-- crm__nunca_comprou). A 8e, a 32a e tests/banco/sucessoras-da-99.cjs aceitam o corpo novo de get_admin_customers_paged como sucessor do da
-- 20261392000000. Valem IKCOUS e Savy; lojas de teste ficam fora.
--
-- 10. FICHA DE VERIFICACAO
--
--   1. SELECT md5(replace(prosrc, E'\r', '')) FROM pg_proc WHERE oid = to_regprocedure('public.crm__nunca_comprou(timestamptz)');
--      -- esperado: 3aa94ac8dc4ce19db958e6d93cbea7a8.
--   2. SELECT md5(replace(prosrc, E'\r', '')) FROM pg_proc
--       WHERE oid = to_regprocedure('public.get_admin_customers_paged(text,text,text,integer,integer)');
--      -- esperado: 35212d373895b2a9ede613198fc4c794.
--   3. proacl, prosecdef e proconfig iguais antes e depois (consultas 145a/145b).
--   4. Dashboard CRM > Clientes: a pessoa que aparecia em "Pediu e nao pagou" e em "Cadastrado, nunca comprou" aparece UMA vez; tela Clientes:
--      a conta com dois enderecos principais aparece em UMA linha, com o numero de pedidos e o total comprado certos.
--   PROVA VIVA: tests/banco/o-crm-e-a-lista-de-clientes-nao-contam-a-mesma-pessoa-duas-vezes-viva.cjs (rpc-ci); portao da release: consultas 145a e 145b.
-- ============================================================================

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

DO $preflight_20261399993000$
DECLARE
  v_oid_nunca oid := to_regprocedure('public.crm__nunca_comprou(timestamptz)');
  v_oid_clientes oid := to_regprocedure('public.get_admin_customers_paged(text,text,text,integer,integer)');
  v_hash text;
  v_atributos jsonb;
  r record;
BEGIN
  -- ---- existem, uma so de cada nome ----
  IF v_oid_nunca IS NULL THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: public.crm__nunca_comprou(timestamptz) não existe (aplique antes a 20261183000000).';
  END IF;
  IF (SELECT count(*) FROM pg_proc p
       WHERE p.pronamespace = 'public'::regnamespace AND p.proname = 'crm__nunca_comprou') <> 1 THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: crm__nunca_comprou tem sobrecarga em public.';
  END IF;
  IF v_oid_clientes IS NULL THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: public.get_admin_customers_paged(text,text,text,integer,integer) não existe.';
  END IF;
  IF (SELECT count(*) FROM pg_proc p
       WHERE p.pronamespace = 'public'::regnamespace AND p.proname = 'get_admin_customers_paged') <> 1 THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: get_admin_customers_paged tem sobrecarga em public — meça a loja e revise antes de aplicar.';
  END IF;

  -- ---- corpo identificado pelo CONTEUDO: o vigente (aplica) ou o desta migration (reaplicar e no-op) ----
  FOR r IN
    SELECT *
      FROM (VALUES
        ('public.crm__nunca_comprou(timestamptz)', '9a83cf34789b8b67c245648c8d82fc42', '3aa94ac8dc4ce19db958e6d93cbea7a8'),
        ('public.get_admin_customers_paged(text,text,text,integer,integer)', '1c71829d75e3d8f17bf7fb01019c05ec', '35212d373895b2a9ede613198fc4c794')
      ) AS esperado(assinatura, hash_vigente, hash_desta)
  LOOP
    SELECT md5(replace(prosrc, E'\r', '')) INTO v_hash
      FROM pg_proc
     WHERE oid = to_regprocedure(r.assinatura);

    IF v_hash IS NULL OR v_hash NOT IN (r.hash_vigente, r.hash_desta) THEN
      RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: corpo vivo de % (hash %) não é o vigente nem o que esta migration deixa — capture o corpo vivo e revise antes de aplicar.', r.assinatura, COALESCE(v_hash, 'ausente');
    END IF;
  END LOOP;

  -- ---- crm__nunca_comprou: atributos, ACL, o que o corpo novo chama ----
  IF NOT EXISTS (
       SELECT 1 FROM pg_proc p JOIN pg_language l ON l.oid = p.prolang
        WHERE p.oid = v_oid_nunca
          AND p.prokind = 'f'
          AND l.lanname = 'sql'
          AND NOT p.prosecdef
          AND p.provolatile = 's'
          AND NOT p.proisstrict
          AND p.proretset
          AND p.proconfig = ARRAY['search_path=public']::text[]
          AND p.pronargs = 1
          AND pg_get_function_arguments(p.oid) = 'p_ate timestamp with time zone'
          AND pg_get_function_result(p.oid) = 'TABLE(chave text, user_id uuid, nome text, whatsapp text, email text, cadastrado_em timestamp with time zone)'
     ) THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: atributos de public.crm__nunca_comprou(timestamptz) não são os conhecidos.';
  END IF;
  -- Funcao interna do CRM: PUBLIC, anon e authenticated NAO executam (quem a chama sao as RPCs SECURITY DEFINER com gate de admin).
  IF has_function_privilege('anon', v_oid_nunca, 'EXECUTE')
     OR has_function_privilege('authenticated', v_oid_nunca, 'EXECUTE')
     OR EXISTS (SELECT 1 FROM pg_proc p
                  CROSS JOIN LATERAL aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) g
                 WHERE p.oid = v_oid_nunca AND g.privilege_type = 'EXECUTE' AND g.grantee = 0) THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: ACL de public.crm__nunca_comprou(timestamptz) não é a conhecida (PUBLIC, anon e authenticated sem EXECUTE).';
  END IF;
  -- O que o corpo novo chama: a funcao do grupo "nao pagou" e a das vendas (que ela mesma chama).
  IF to_regprocedure('public.crm__pedidos_nao_pagos(timestamptz)') IS NULL
     OR to_regprocedure('public.crm__vendas(timestamptz)') IS NULL THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: falta crm__pedidos_nao_pagos ou crm__vendas que a crm__nunca_comprou chama.';
  END IF;
  FOR r IN
    SELECT * FROM (VALUES
      ('profiles', 'id'),
      ('profiles', 'role'),
      ('profiles', 'full_name'),
      ('profiles', 'whatsapp'),
      ('profiles', 'created_at'),
      ('marketplace_orders', 'user_id'),
      ('marketplace_orders', 'created_at'),
      ('user_addresses', 'id'),
      ('user_addresses', 'user_id'),
      ('user_addresses', 'is_default'),
      ('user_addresses', 'created_at'),
      ('user_addresses', 'city'),
      ('user_addresses', 'state')
    ) AS coluna(tabela, nome)
  LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_attribute a
                    WHERE a.attrelid = to_regclass('public.' || r.tabela)
                      AND a.attname = r.nome AND a.attnum > 0 AND NOT a.attisdropped) THEN
      RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: falta a coluna public.%.% que o corpo novo lê.', r.tabela, r.nome;
    END IF;
  END LOOP;
  -- Fotografia de OID, dono, ACL e TODOS os atributos: o CREATE OR REPLACE so pode trocar prosrc.
  SELECT to_jsonb(p) - 'prosrc' INTO v_atributos FROM pg_proc p WHERE p.oid = v_oid_nunca;
  PERFORM set_config('ikcous.crm3993_atributos_nunca', v_atributos::text, true);

  -- ---- get_admin_customers_paged: atributos e ACL ----
  IF NOT EXISTS (
       SELECT 1 FROM pg_proc p JOIN pg_language l ON l.oid = p.prolang
        WHERE p.oid = v_oid_clientes
          AND l.lanname = 'plpgsql'
          AND p.prosecdef
          AND p.provolatile = 'v'
          AND NOT p.proretset
          AND p.proconfig = ARRAY['search_path=public, extensions']::text[]
          AND pg_get_function_arguments(p.oid) = 'p_search text DEFAULT ''''::text, p_sort_field text DEFAULT ''created_at''::text, p_sort_direction text DEFAULT ''desc''::text, p_page integer DEFAULT 0, p_page_size integer DEFAULT 10'
          AND pg_get_function_result(p.oid) = 'jsonb'
     ) THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: atributos de public.get_admin_customers_paged (linguagem, SECURITY DEFINER, volatilidade, search_path, argumentos ou retorno) não são os conhecidos — meça a loja e revise antes de aplicar.';
  END IF;
  -- ACL exatamente a de hoje (PUBLIC medido por aclexplode, grantee = 0): o CREATE OR REPLACE a preserva.
  IF EXISTS (SELECT 1 FROM pg_proc p
               CROSS JOIN LATERAL aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) g
              WHERE p.oid = v_oid_clientes AND g.privilege_type = 'EXECUTE' AND g.grantee = 0)
     OR has_function_privilege('anon', v_oid_clientes, 'EXECUTE')
     OR NOT has_function_privilege('authenticated', v_oid_clientes, 'EXECUTE')
     OR NOT has_function_privilege('service_role', v_oid_clientes, 'EXECUTE') THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: ACL de public.get_admin_customers_paged não é a conhecida (PUBLIC e anon sem EXECUTE; authenticated e service_role com) — meça a loja e revise.';
  END IF;
  SELECT to_jsonb(p) - 'prosrc' INTO v_atributos FROM pg_proc p WHERE p.oid = v_oid_clientes;
  PERFORM set_config('ikcous.crm3993_atributos_clientes', v_atributos::text, true);
END $preflight_20261399993000$;

-- crm__nunca_comprou: o corpo vivo da 20261183000000 + a segunda exclusao (a troca declarada no cabecalho, item 4).
CREATE OR REPLACE FUNCTION public.crm__nunca_comprou(p_ate timestamptz)
RETURNS TABLE (
  chave text, user_id uuid, nome text, whatsapp text, email text, cadastrado_em timestamptz
)
LANGUAGE sql STABLE SET search_path = public
AS $$
  WITH wa_pagos AS (
    -- Achado 6 (revisão de risco): o MESMO WhatsApp que já é uma venda paga
    -- de balcão ('wa:...', crm__vendas) não pode voltar como um SEGUNDO
    -- cliente aqui só porque a pessoa depois criou conta — é a MESMA
    -- identidade, já contada como compradora.
    -- N4 (re-revisão de risco): a chave de comparação sai SEM o "55" quando
    -- o número tem DDI (12-13 dígitos) — a MESMA régua de
    -- crm__pedidos_nao_pagos, para o perfil sem DDI e a venda de balcão com
    -- DDI (ou vice-versa) baterem como a mesma pessoa.
    SELECT DISTINCT
           CASE WHEN length(d) IN (12, 13) AND left(d, 2) = '55'
                THEN substring(d FROM 3) ELSE d END AS wa_chave
      FROM (
        SELECT substring(v.chave FROM 4) AS d
          FROM public.crm__vendas(p_ate) v
         WHERE v.chave LIKE 'wa:%'
      ) x
  ), wa_nao_pagos AS (
    -- Venda avulsa anulada, devolvida ou sem pagar (20261399993000): quem tem
    -- CONTA e nenhum pedido ligado a ela, e a lojista registrou "Cliente
    -- avulso" com o MESMO WhatsApp, já aparece em "Pediu e não pagou"
    -- (crm__pedidos_nao_pagos, chave 'wa:', user_id nulo). Sem esta exclusão o
    -- perfil voltava aqui como um SEGUNDO registro da mesma pessoa. LÊ a
    -- função do grupo (não repete a regra dela): "está lá" e "sai daqui" não
    -- divergem. Mesma régua do 55 de wa_pagos.
    SELECT DISTINCT
           CASE WHEN length(d) IN (12, 13) AND left(d, 2) = '55'
                THEN substring(d FROM 3) ELSE d END AS wa_chave
      FROM (
        SELECT np.whatsapp AS d
          FROM public.crm__pedidos_nao_pagos(p_ate) np
         WHERE np.user_id IS NULL AND np.whatsapp IS NOT NULL
      ) x
  )
  SELECT p.id::text, p.id, NULLIF(btrim(COALESCE(p.full_name, '')), ''),
         -- WhatsApp normalizado a dígitos, mesma régua do resto do CRM (era
         -- devolvido cru — achado 6). Exibido no formato ORIGINAL captado
         -- (só a comparação abaixo ignora o "55").
         pw.wa,
         u.email::text, p.created_at
    FROM public.profiles p
    LEFT JOIN auth.users u ON u.id = p.id
    CROSS JOIN LATERAL (
      SELECT NULLIF(regexp_replace(COALESCE(p.whatsapp, ''), '\D', '', 'g'), '') AS wa
    ) pw
   WHERE COALESCE(p.role, 'customer') = 'customer'
     -- Achado 8: a checagem que is_admin() de fato lê (app_metadata), não só
     -- profiles.role — defesa em profundidade mesmo com o gatilho que hoje
     -- mantém os dois sincronizados (handle_profile_role_sync_to_auth).
     AND COALESCE(u.raw_app_meta_data ->> 'role', 'customer') NOT IN ('admin', 'gerente', 'vendedor')
     AND p.created_at <= p_ate
     AND NOT EXISTS (
       SELECT 1 FROM public.marketplace_orders o
        WHERE o.user_id = p.id AND o.created_at <= p_ate
     )
     AND NOT EXISTS (
       SELECT 1 FROM wa_pagos wp
        WHERE wp.wa_chave = (
          CASE WHEN length(pw.wa) IN (12, 13) AND left(pw.wa, 2) = '55'
               THEN substring(pw.wa FROM 3) ELSE pw.wa END
        )
     )
     AND NOT EXISTS (
       SELECT 1 FROM wa_nao_pagos wn
        WHERE wn.wa_chave = (
          CASE WHEN length(pw.wa) IN (12, 13) AND left(pw.wa, 2) = '55'
               THEN substring(pw.wa FROM 3) ELSE pw.wa END
        )
     )
$$;

-- get_admin_customers_paged: corpo vigente da 20261392000000_a_lista_de_clientes_nao_repete_nem_esconde_ninguem_entre_as_paginas.sql, com UM
-- endereco principal por cliente antes de juntar os pedidos (a troca declarada no cabecalho, item 4).
CREATE OR REPLACE FUNCTION public.get_admin_customers_paged(p_search text DEFAULT ''::text, p_sort_field text DEFAULT 'created_at'::text, p_sort_direction text DEFAULT 'desc'::text, p_page integer DEFAULT 0, p_page_size integer DEFAULT 10)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $$
DECLARE
    v_total_count BIGINT;
    v_data JSONB;
    v_offset INTEGER;

    -- Global stats variables
    v_global_total_customers BIGINT;
    v_global_new_customers_30d BIGINT;
    v_global_ltv NUMERIC;
    v_global_orders BIGINT;
    v_stats JSONB;
    v_clean_search TEXT;
    v_search_digitos TEXT;
BEGIN
    -- Authorization check
    IF NOT public.is_admin() THEN
        RAISE EXCEPTION 'Acesso negado: privilégios de administrador necessários.';
    END IF;
    -- Papel ATUAL (auth.users E profiles), não o do JWT: admin rebaixado para aqui (20261199000000).
    IF NOT public.is_admin_atual() THEN
        RAISE EXCEPTION 'Acesso negado: privilégios de administrador necessários.';
    END IF;

    v_offset := p_page * p_page_size;
    v_clean_search := TRIM(p_search);
    -- So os digitos do que a pessoa digitou (o WhatsApp e' gravado MASCARADO, "(34) 99999-1234", e a
    -- comparacao crua de texto nunca casava quem digitava so os numeros). Com 12 ou 13 digitos que
    -- comecam por 55 (o +55 do Brasil colado do WhatsApp), o 55 sai: o cadastro nao o guarda.
    v_search_digitos := regexp_replace(COALESCE(v_clean_search, ''), '[^0-9]', '', 'g');
    IF length(v_search_digitos) IN (12, 13) AND left(v_search_digitos, 2) = '55' THEN
        v_search_digitos := substr(v_search_digitos, 3);
    END IF;

    -- Calculate global stats (not filtered by search for global dashboard consistency)
    SELECT COUNT(id) INTO v_global_total_customers
    FROM public.profiles;

    SELECT COUNT(id) INTO v_global_new_customers_30d
    FROM public.profiles
    WHERE created_at >= NOW() - INTERVAL '30 days';

    SELECT COUNT(id) INTO v_global_orders
    FROM public.marketplace_orders
    WHERE status NOT IN ('cancelled', 'returned');

    -- LTV global: mesma correção do achado 17, dinheiro reconhecido só.
    SELECT COALESCE(SUM(total::numeric), 0) INTO v_global_ltv
    FROM public.marketplace_orders
    WHERE status NOT IN ('cancelled', 'returned')
    AND (payment_status IN ('pago', 'pago_apos_expirar', 'recebido_na_entrega'));

    v_stats := JSONB_BUILD_OBJECT(
        'total_customers', v_global_total_customers,
        'new_customers_30d', v_global_new_customers_30d,
        'global_ltv', v_global_ltv,
        'global_orders', v_global_orders
    );

    -- CTE to gather aggregated stats per customer with unaccent filtering and pagination count
    WITH customer_stats AS (
        SELECT
            p.id,
            u.email,
            p.full_name,
            COALESCE(p.whatsapp, u.phone) as phone,
            p.role,
            p.created_at,
            p.avatar_url,
            addr.city,
            addr.state,
            EXISTS (
                SELECT 1
                FROM public.push_subscriptions
                WHERE user_id = p.id
            ) as is_push_subscribed,
            COUNT(o.id) as orders_count,
            -- LTV por cliente: só dinheiro reconhecido (achado 17). O CASE
            -- fica dentro do SUM, e não na condição do JOIN, de propósito:
            -- orders_count e last_order_date continuam contando qualquer
            -- pedido não cancelado/devolvido, a mesma regra da coluna
            -- "Pedidos" e da ficha do cliente (achado 5).
            COALESCE(SUM(
                CASE
                    WHEN o.payment_status IN ('pago', 'pago_apos_expirar', 'recebido_na_entrega')
                    THEN o.total::numeric
                    ELSE 0
                END
            ), 0) as total_spent,
            MAX(o.created_at) as last_order_date
        FROM public.profiles p
        LEFT JOIN auth.users u ON u.id = p.id
        -- UM endereco principal por cliente (o mais novo; no empate, o de menor id) ANTES de juntar os pedidos: dois
        -- enderecos is_default na mesma conta (dois aparelhos salvando o primeiro endereco ao mesmo tempo) dobravam a
        -- contagem e a soma dos pedidos, ou repetiam a cliente uma vez por cidade (20261399993000).
        LEFT JOIN LATERAL (
            SELECT a.city, a.state
            FROM public.user_addresses a
            WHERE a.user_id = p.id AND a.is_default = true
            ORDER BY a.created_at DESC NULLS LAST, a.id
            LIMIT 1
        ) addr ON true
        LEFT JOIN public.marketplace_orders o ON o.user_id = p.id AND o.status NOT IN ('cancelled', 'returned')
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
        GROUP BY p.id, u.email, u.phone, p.whatsapp, addr.city, addr.state
    ),
    sorted_data AS (
        SELECT *, COUNT(*) OVER() as full_count FROM customer_stats
        ORDER BY
            CASE WHEN p_sort_direction = 'asc' THEN
                CASE
                    WHEN p_sort_field = 'full_name' THEN full_name
                    WHEN p_sort_field = 'email' THEN email
                    WHEN p_sort_field = 'role' THEN role
                    WHEN p_sort_field = 'city' THEN city
                    ELSE NULL
                END
            END ASC,
            CASE WHEN p_sort_direction = 'desc' THEN
                CASE
                    WHEN p_sort_field = 'full_name' THEN full_name
                    WHEN p_sort_field = 'email' THEN email
                    WHEN p_sort_field = 'role' THEN role
                    WHEN p_sort_field = 'city' THEN city
                    ELSE NULL
                END
            END DESC,
            -- Numeric ordering
            CASE WHEN p_sort_direction = 'asc' THEN
                CASE
                    WHEN p_sort_field = 'total_spent' THEN total_spent
                    WHEN p_sort_field = 'orders_count' THEN orders_count::NUMERIC
                    ELSE NULL
                END
            END ASC,
            CASE WHEN p_sort_direction = 'desc' THEN
                CASE
                    WHEN p_sort_field = 'total_spent' THEN total_spent
                    WHEN p_sort_field = 'orders_count' THEN orders_count::NUMERIC
                    ELSE NULL
                END
            END DESC,
            -- Temporal ordering
            CASE WHEN p_sort_direction = 'asc' THEN
                CASE
                    WHEN p_sort_field = 'created_at' THEN created_at
                    WHEN p_sort_field = 'last_order_date' THEN last_order_date
                    ELSE NULL
                END
            END ASC,
            CASE WHEN p_sort_direction = 'desc' THEN
                CASE
                    WHEN p_sort_field = 'created_at' THEN created_at
                    WHEN p_sort_field = 'last_order_date' THEN last_order_date
                    ELSE NULL
                END
            END DESC,
            -- Desempate pelo id (unico): sem ele, quem empata no criterio escolhido (toda conta nova
            -- tem total 0) sai numa ordem que pode mudar de uma chamada para outra, e a paginacao por
            -- OFFSET repete a mesma cliente em duas paginas e esconde outra (20261392000000).
            id
    ),
    paginated_data AS (
        SELECT *
        FROM sorted_data
        LIMIT p_page_size
        OFFSET v_offset
    )
    SELECT
        COALESCE((SELECT full_count FROM sorted_data LIMIT 1), 0),
        COALESCE(jsonb_agg(pd), '[]'::JSONB)
    INTO v_total_count, v_data
    FROM paginated_data pd;

    RETURN jsonb_build_object(
        'data', v_data,
        'total_count', v_total_count,
        'stats', v_stats
    );
END;
$$;

-- Pos-voo: corpos, atributos, ACL e fotografia do pre-voo das duas funcoes; qualquer divergencia aborta a transacao do aplicador.
DO $conferencia_20261399993000$
DECLARE
  v_oid_nunca oid := to_regprocedure('public.crm__nunca_comprou(timestamptz)');
  v_oid_clientes oid := to_regprocedure('public.get_admin_customers_paged(text,text,text,integer,integer)');
  v_hash text;
BEGIN
  IF v_oid_nunca IS NULL OR v_oid_clientes IS NULL THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: crm__nunca_comprou ou get_admin_customers_paged sumiu depois do CREATE OR REPLACE.';
  END IF;

  -- ---- crm__nunca_comprou ----
  SELECT md5(replace(prosrc, E'\r', '')) INTO v_hash FROM pg_proc WHERE oid = v_oid_nunca;
  IF v_hash IS DISTINCT FROM '3aa94ac8dc4ce19db958e6d93cbea7a8' THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: corpo depois do CREATE OR REPLACE de crm__nunca_comprou tem hash %; esperado 3aa94ac8dc4ce19db958e6d93cbea7a8.', COALESCE(v_hash, 'ausente');
  END IF;
  IF (SELECT count(*) FROM pg_proc p
       WHERE p.pronamespace = 'public'::regnamespace AND p.proname = 'crm__nunca_comprou') <> 1 THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: crm__nunca_comprou ficou com sobrecarga.';
  END IF;
  IF NOT EXISTS (
       SELECT 1 FROM pg_proc p JOIN pg_language l ON l.oid = p.prolang
        WHERE p.oid = v_oid_nunca
          AND p.prokind = 'f'
          AND l.lanname = 'sql'
          AND NOT p.prosecdef
          AND p.provolatile = 's'
          AND NOT p.proisstrict
          AND p.proretset
          AND p.proconfig = ARRAY['search_path=public']::text[]
          AND p.pronargs = 1
          AND pg_get_function_arguments(p.oid) = 'p_ate timestamp with time zone'
          AND pg_get_function_result(p.oid) = 'TABLE(chave text, user_id uuid, nome text, whatsapp text, email text, cadastrado_em timestamp with time zone)'
     ) THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: atributos de public.crm__nunca_comprou(timestamptz) não são os conhecidos.';
  END IF;
  IF has_function_privilege('anon', v_oid_nunca, 'EXECUTE')
     OR has_function_privilege('authenticated', v_oid_nunca, 'EXECUTE')
     OR EXISTS (SELECT 1 FROM pg_proc p
                  CROSS JOIN LATERAL aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) g
                 WHERE p.oid = v_oid_nunca AND g.privilege_type = 'EXECUTE' AND g.grantee = 0) THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: ACL de public.crm__nunca_comprou(timestamptz) não é a conhecida (PUBLIC, anon e authenticated sem EXECUTE).';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_proc p
                  WHERE p.oid = v_oid_nunca
                    AND (to_jsonb(p) - 'prosrc') = current_setting('ikcous.crm3993_atributos_nunca')::jsonb) THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: conferencia final de crm__nunca_comprou falhou (OID, dono, ACL ou atributo mudou).';
  END IF;

  -- ---- get_admin_customers_paged ----
  SELECT md5(replace(prosrc, E'\r', '')) INTO v_hash FROM pg_proc WHERE oid = v_oid_clientes;
  IF v_hash IS DISTINCT FROM '35212d373895b2a9ede613198fc4c794' THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: corpo depois do CREATE OR REPLACE de get_admin_customers_paged tem hash %; esperado 35212d373895b2a9ede613198fc4c794.', COALESCE(v_hash, 'ausente');
  END IF;
  IF (SELECT count(*) FROM pg_proc p
       WHERE p.pronamespace = 'public'::regnamespace AND p.proname = 'get_admin_customers_paged') <> 1 THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: get_admin_customers_paged ficou com sobrecarga.';
  END IF;
  IF NOT EXISTS (
       SELECT 1 FROM pg_proc p JOIN pg_language l ON l.oid = p.prolang
        WHERE p.oid = v_oid_clientes
          AND l.lanname = 'plpgsql'
          AND p.prosecdef
          AND p.provolatile = 'v'
          AND NOT p.proretset
          AND p.proconfig = ARRAY['search_path=public, extensions']::text[]
          AND pg_get_function_arguments(p.oid) = 'p_search text DEFAULT ''''::text, p_sort_field text DEFAULT ''created_at''::text, p_sort_direction text DEFAULT ''desc''::text, p_page integer DEFAULT 0, p_page_size integer DEFAULT 10'
          AND pg_get_function_result(p.oid) = 'jsonb'
     ) THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: atributos de public.get_admin_customers_paged mudaram.';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_proc p
               CROSS JOIN LATERAL aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) g
              WHERE p.oid = v_oid_clientes AND g.privilege_type = 'EXECUTE' AND g.grantee = 0)
     OR has_function_privilege('anon', v_oid_clientes, 'EXECUTE')
     OR NOT has_function_privilege('authenticated', v_oid_clientes, 'EXECUTE')
     OR NOT has_function_privilege('service_role', v_oid_clientes, 'EXECUTE') THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: ACL de public.get_admin_customers_paged não é a conhecida (PUBLIC e anon sem EXECUTE; authenticated e service_role com).';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_proc p
                  WHERE p.oid = v_oid_clientes
                    AND (to_jsonb(p) - 'prosrc') = current_setting('ikcous.crm3993_atributos_clientes')::jsonb) THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: conferencia final de get_admin_customers_paged falhou (OID, dono, ACL ou atributo mudou).';
  END IF;
END $conferencia_20261399993000$;

NOTIFY pgrst, 'reload schema';
