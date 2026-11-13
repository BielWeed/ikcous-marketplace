-- ============================================================================
-- Migration 20261399990000 -- o CRM nao duplica o comprador quando o WhatsApp vem com e sem o 55 (dado de cliente; so LEITURA; troca o corpo de UMA funcao)
-- ============================================================================
--
-- 1. O DEFEITO (achado de caca, lote 376)
--
-- public.crm__vendas(p_ate) e a fonte de TODA leitura de comprador do CRM (a aba Clientes, os segmentos RFM, os KPIs de clientes novos e
-- recorrentes do Inicio e do CRM). Ela da a cada venda paga uma CHAVE de cliente: a conta (user_id) ou, no balcao sem conta, 'wa:' + os digitos do
-- WhatsApp do pedido; e o WhatsApp que ja apareceu num pedido COM conta vira aquela conta (a fusao wa -> conta). Os digitos eram comparados CRUS:
-- o mesmo numero gravado uma vez com o codigo do pais ("+55 34 99999-0000", 5534999990000) e outra sem ("(34) 99999-0000", 34999990000) virava
-- DOIS compradores: dois cartoes na lista, o comprador contado duas vezes em "clientes", o ticket e a recorrencia partidos ao meio.
-- Acontece sempre que o balcao digita com o 55 e o checkout do app guarda sem (ou o contrario). As funcoes irmas (crm__pedidos_nao_pagos e
-- crm__nunca_comprou, desde a 20261183000000, item N4) ja comparam sem o 55; so a crm__vendas ficou para tras ("crm__vendas nao foi tocado").
--
-- 2. A REGRA NOVA (a MESMA expressao da 20261183000000, N4)
--
--   CASE WHEN length(wa) IN (12, 13) AND left(wa, 2) = '55' THEN substring(wa FROM 3) ELSE wa END
--
-- Com 12 ou 13 digitos comecando por 55 (o +55 do Brasil + 10 ou 11 digitos), o 55 sai ANTES de comparar. O valor EXIBIDO (a coluna whatsapp)
-- continua o digitado no pedido. A chave do balcao sem conta passa a ser 'wa:' + o numero SEM o 55, e a fusao wa -> conta compara pelo numero
-- sem o 55.
--
-- 3. O QUE ACONTECE EM CADA CASO
--
--   * "5534999990000" e "(34) 99999-0000" (balcao sem conta, as duas vendas) viram UM comprador, chave 'wa:34999990000', com as duas vendas;
--   * balcao com "+55 34 98888-0001" e conta cujo pedido pago tem "34988880001": o balcao entra na CONTA (a fusao ja existia, so nao via o 55);
--   * telefones DIFERENTES continuam diferentes (a regra so tira um 55 que sobra na frente, nunca junta numeros distintos);
--   * DDD 55 (Santa Maria/RS) com 11 digitos ("55999991234") NAO perde o 55: e o DDD, nao o pais; "5555999991234" (pais + DDD 55) e o mesmo
--     comprador de "55999991234";
--   * 12 digitos que NAO comecam por 55 nao se cortam;
--   * WhatsApp ausente, vazio ou so pontuacao: continua SEM chave de balcao (o pedido sem conta e sem numero segue fora do CRM) e nunca junta
--     dois compradores diferentes;
--   * pedido COM conta: a chave continua sendo a conta, como antes.
--
-- 4. O QUE MUDA NO CORPO (so isto; o resto nao muda um byte)
--
-- A CTE `base` (a venda que conta, o WhatsApp em digitos) fica IGUAL. Entra uma CTE nova, `base_chave`, que acrescenta `wa_chave` (o numero sem o
-- 55); `wa_da_conta` e a chave final passam a usar `wa_chave` no lugar de `wa`. A assinatura (p_ate timestamptz), o retorno TABLE (11 colunas, a
-- mesma ordem e os mesmos tipos), LANGUAGE sql, STABLE, SECURITY INVOKER, search_path = public, dono, OID e ACL NAO mudam. Nenhum GRANT e nenhum
-- REVOKE neste arquivo.
--
-- 5. QUEM LE A crm__vendas (alcance medido nas migrations e nos testes)
--
--   * crm__clientes_rfm, crm_visao, crm_clientes, painel_inicio e fin_resumo agrupam por `chave`: comprador duplicado vira UM (os numeros de
--     clientes caem para o certo; receita total e numero de pedidos NAO mudam, so ficam no cartao certo);
--   * crm__nunca_comprou le as chaves 'wa:' e ja corta o 55 antes de comparar (cortar de novo e inofensivo: o numero sem 55 tem 10 ou 11
--     digitos, nunca 12 ou 13); crm__pedidos_nao_pagos usa a coluna whatsapp (inalterada) para a fusao e as chaves para excluir quem ja comprou;
--   * a coluna `chave` so e usada como identificador de linha (o front a usa como `key` do React e nada a guarda em tabela).
--
-- 6. DADOS EXISTENTES
--
-- Nenhuma linha de pedido, conta, perfil ou historico e lida para escrita ou escrita ao aplicar: so o corpo de UMA funcao muda. Compradores que
-- hoje aparecem duplicados (um com o 55, outro sem) passam a aparecer UMA vez, somando as vendas; a chave de quem so comprou no balcao com o 55
-- passa de 'wa:55...' para 'wa:...' (sem o 55). O que ja era UM comprador continua UM, com os mesmos numeros.
--
-- 7. PRE-VOO (B1_BASELINE_DIVERGENT, ANTES de qualquer escrita)
--
-- Recusa se: a funcao nao existir ou tiver sobrecarga; o corpo vivo (md5 de replace(prosrc, E'\r', '')) nao for UM dos dois conhecidos (o da
-- 20261178000000, 8a802f6324c86cdc0be214b4d5ac69bb, ou o desta migration, bd683b55c36dff83eefa0282077d9a63); os atributos nao forem os de sempre (sql, STABLE, INVOKER,
-- search_path=public, retorno TABLE de 11 colunas); a ACL deixar PUBLIC, anon ou authenticated executarem; ou faltar uma coluna ou funcao que o
-- corpo usa. Fotografa OID, dono, ACL e TODOS os atributos (set_config local a transacao) para a conferencia final. Os hashes sao o md5 REAL dos
-- corpos, amarrados ao texto por tests/migration_o_crm_nao_duplica_o_comprador_com_e_sem_55_test.ts.
--
-- 8. TRANSACAO, IDEMPOTENCIA E REAPLICACAO
--
-- Sem BEGIN/COMMIT de nivel superior (regra da casa: com eles o ROLLBACK dos scripts de prova vira no-op e a mudanca fica gravada): quem abre a
-- transacao e o aplicador (psql -1 / db-apply, que mandam o arquivo como UM so lote); o pre-voo, a troca do corpo e a conferencia caem juntos ou
-- nao caem. Dois estados de entrada: corpo da 20261178000000 (aplica) ou corpo desta migration (reaplicar reescreve o MESMO texto, mesmo estado).
-- Qualquer outro estado ABORTA sem escrever. CREATE OR REPLACE (sem DROP) preserva OID, dono e ACL; a conferencia exige que todos os atributos
-- fiquem iguais aos da fotografia.
--
-- 9. ORDEM E ROLLBACK
--
-- Depois da 20261178000000 (o pre-voo recusa sem ela). Sem ordem em relacao ao front (nenhum front muda). ROLLBACK MANUAL:
-- rollback-manual-20261399990000_o_crm_nao_duplica_o_comprador_com_e_sem_55.sql devolve o corpo da 20261178000000 byte a byte; vem ANTES do rollback
-- da 20261178000000 (que so da DROP e derrubaria a funcao). Valem IKCOUS e Savy; lojas de teste ficam fora.
--
-- 10. FICHA DE VERIFICACAO
--
--   1. SELECT md5(replace(prosrc, E'\r', '')) FROM pg_proc WHERE oid = to_regprocedure('public.crm__vendas(timestamptz)');
--      -- esperado: bd683b55c36dff83eefa0282077d9a63.
--   2. proacl, prosecdef e proconfig iguais antes e depois (consulta 141a/141b).
--   3. Dashboard CRM > Clientes: o comprador que aparecia duas vezes (um cartao com o 55, outro sem) aparece UMA vez.
--   PROVA VIVA: tests/banco/o-crm-nao-duplica-o-comprador-com-e-sem-55-viva.cjs (rpc-ci); portao da release: consultas 141a e 141b.
-- ============================================================================

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

DO $preflight_20261399990000$
DECLARE
  v_fn CONSTANT text := 'public.crm__vendas(timestamptz)';
  v_oid oid := to_regprocedure('public.crm__vendas(timestamptz)');
  v_hash text;
  v_atributos jsonb;
  r record;
BEGIN
  IF v_oid IS NULL THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: % não existe (aplique antes a 20261178000000).', v_fn;
  END IF;
  IF (SELECT count(*) FROM pg_proc p
       WHERE p.pronamespace = 'public'::regnamespace AND p.proname = 'crm__vendas') <> 1 THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: crm__vendas tem sobrecarga em public.';
  END IF;

  SELECT md5(replace(prosrc, E'\r', '')) INTO v_hash FROM pg_proc WHERE oid = v_oid;
  IF v_hash IS NULL OR v_hash NOT IN ('8a802f6324c86cdc0be214b4d5ac69bb', 'bd683b55c36dff83eefa0282077d9a63') THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: corpo vivo de % (hash %) não é o vigente (20261178000000) nem o desta migration; revise antes de aplicar.', v_fn, COALESCE(v_hash, 'ausente');
  END IF;

  IF NOT EXISTS (
       SELECT 1 FROM pg_proc p JOIN pg_language l ON l.oid = p.prolang
        WHERE p.oid = v_oid
          AND p.prokind = 'f'
          AND l.lanname = 'sql'
          AND NOT p.prosecdef
          AND p.provolatile = 's'
          AND NOT p.proisstrict
          AND p.proretset
          AND p.proconfig = ARRAY['search_path=public']::text[]
          AND p.pronargs = 1
          AND pg_get_function_arguments(p.oid) = 'p_ate timestamp with time zone'
          AND pg_get_function_result(p.oid) = 'TABLE(order_id uuid, total numeric, canal text, forma text, pago_em timestamp with time zone, dia date, chave text, user_id uuid, nome text, whatsapp text, email text)'
     ) THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: atributos de % não são os conhecidos.', v_fn;
  END IF;

  -- Funcao interna do CRM: PUBLIC, anon e authenticated NAO executam (quem a chama sao as RPCs SECURITY DEFINER com gate de admin).
  IF has_function_privilege('anon', v_oid, 'EXECUTE')
     OR has_function_privilege('authenticated', v_oid, 'EXECUTE')
     OR EXISTS (SELECT 1 FROM pg_proc p
                  CROSS JOIN LATERAL aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) g
                 WHERE p.oid = v_oid AND g.privilege_type = 'EXECUTE' AND g.grantee = 0) THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: ACL de % não é a conhecida (PUBLIC, anon e authenticated sem EXECUTE).', v_fn;
  END IF;

  -- As colunas e as funcoes que o corpo usa continuam obrigatorias.
  FOR r IN
    SELECT * FROM (VALUES
      ('marketplace_orders', 'id'),
      ('marketplace_orders', 'total'),
      ('marketplace_orders', 'canal'),
      ('marketplace_orders', 'user_id'),
      ('marketplace_orders', 'customer_name'),
      ('marketplace_orders', 'customer_data'),
      ('marketplace_orders', 'payment_method'),
      ('marketplace_orders', 'metodo_online'),
      ('marketplace_orders', 'payment_status'),
      ('marketplace_orders', 'status'),
      ('marketplace_orders', 'pagamento_recebido_em'),
      ('marketplace_orders', 'paid_at')
    ) AS coluna(tabela, nome)
  LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_attribute a
                    WHERE a.attrelid = to_regclass('public.' || r.tabela)
                      AND a.attname = r.nome AND a.attnum > 0 AND NOT a.attisdropped) THEN
      RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: falta a coluna public.%.% que o CRM le.', r.tabela, r.nome;
    END IF;
  END LOOP;
  IF to_regprocedure('public.fin__dia(timestamptz)') IS NULL
     OR to_regprocedure('public.fin__forma_do_pedido(text,text)') IS NULL THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: falta fin__dia ou fin__forma_do_pedido que a crm__vendas chama.';
  END IF;

  -- Fotografia de OID, dono, ACL e TODOS os atributos: o CREATE OR REPLACE so pode trocar prosrc.
  SELECT to_jsonb(p) - 'prosrc' INTO v_atributos FROM pg_proc p WHERE p.oid = v_oid;
  PERFORM set_config('ikcous.crm3999_atributos', v_atributos::text, true);
END $preflight_20261399990000$;

-- crm__vendas: o corpo vivo da 20261178000000 + o numero sem o 55 na chave e na fusao (a troca declarada no cabecalho, item 4).
CREATE OR REPLACE FUNCTION public.crm__vendas(p_ate timestamptz)
RETURNS TABLE (
  order_id uuid, total numeric, canal text, forma text, pago_em timestamptz, dia date,
  chave text, user_id uuid, nome text, whatsapp text, email text
)
LANGUAGE sql STABLE SET search_path = public
AS $$
  WITH base AS (
    SELECT o.id, o.total::numeric AS total, o.canal, o.user_id, o.customer_name,
           public.fin__forma_do_pedido(o.payment_method, o.metodo_online) AS forma,
           COALESCE(o.pagamento_recebido_em, o.paid_at) AS pago_em,
           NULLIF(regexp_replace(COALESCE(o.customer_data ->> 'whatsapp', ''), '\D', '', 'g'), '') AS wa,
           NULLIF(btrim(COALESCE(o.customer_data ->> 'email', '')), '') AS email
      FROM public.marketplace_orders o
     WHERE o.payment_status IN ('pago', 'pago_apos_expirar', 'recebido_na_entrega')
       AND o.status NOT IN ('cancelled', 'returned')
       AND COALESCE(o.pagamento_recebido_em, o.paid_at) IS NOT NULL
       AND COALESCE(o.pagamento_recebido_em, o.paid_at) <= p_ate
  ), base_chave AS (
    -- O MESMO WhatsApp gravado uma vez com o 55 (balcao, "+55...") e outra sem (conta, "(34)...") e UM comprador: a chave e a fusao comparam o
    -- numero SEM o 55 quando ele tem DDI (12 ou 13 digitos comecando por 55), a mesma expressao de crm__pedidos_nao_pagos e crm__nunca_comprou
    -- (20261183000000, N4). O DDD 55 com 11 digitos nao perde o 55. `wa` (o que se exibe) continua o numero original do pedido.
    SELECT b.*,
           CASE WHEN length(b.wa) IN (12, 13) AND left(b.wa, 2) = '55'
                THEN substring(b.wa FROM 3) ELSE b.wa END AS wa_chave
      FROM base b
  ), wa_da_conta AS (
    SELECT DISTINCT ON (b.wa_chave) b.wa_chave, b.user_id
      FROM base_chave b
     WHERE b.wa_chave IS NOT NULL AND b.user_id IS NOT NULL
     ORDER BY b.wa_chave, b.pago_em DESC
  )
  SELECT b.id, b.total, b.canal, b.forma, b.pago_em, public.fin__dia(b.pago_em),
         COALESCE(b.user_id::text, w.user_id::text, CASE WHEN b.wa_chave IS NOT NULL THEN 'wa:' || b.wa_chave END),
         COALESCE(b.user_id, w.user_id),
         NULLIF(btrim(b.customer_name), ''), b.wa, b.email
    FROM base_chave b
    LEFT JOIN wa_da_conta w ON w.wa_chave = b.wa_chave AND b.user_id IS NULL
$$;

-- Pos-voo: corpo, atributos, ACL e fotografia do pre-voo; qualquer divergencia aborta a transacao do aplicador.
DO $conferencia_20261399990000$
DECLARE
  v_fn CONSTANT text := 'public.crm__vendas(timestamptz)';
  v_oid oid := to_regprocedure('public.crm__vendas(timestamptz)');
  v_hash text;
BEGIN
  IF v_oid IS NULL THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: % sumiu depois do CREATE OR REPLACE.', v_fn;
  END IF;
  SELECT md5(replace(prosrc, E'\r', '')) INTO v_hash FROM pg_proc WHERE oid = v_oid;
  IF v_hash IS DISTINCT FROM 'bd683b55c36dff83eefa0282077d9a63' THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: corpo depois do CREATE OR REPLACE de % tem hash %; esperado bd683b55c36dff83eefa0282077d9a63.', v_fn, COALESCE(v_hash, 'ausente');
  END IF;
  IF (SELECT count(*) FROM pg_proc p
       WHERE p.pronamespace = 'public'::regnamespace AND p.proname = 'crm__vendas') <> 1 THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: crm__vendas ficou com sobrecarga.';
  END IF;
  IF NOT EXISTS (
       SELECT 1 FROM pg_proc p JOIN pg_language l ON l.oid = p.prolang
        WHERE p.oid = v_oid
          AND p.prokind = 'f'
          AND l.lanname = 'sql'
          AND NOT p.prosecdef
          AND p.provolatile = 's'
          AND NOT p.proisstrict
          AND p.proretset
          AND p.proconfig = ARRAY['search_path=public']::text[]
          AND p.pronargs = 1
          AND pg_get_function_arguments(p.oid) = 'p_ate timestamp with time zone'
          AND pg_get_function_result(p.oid) = 'TABLE(order_id uuid, total numeric, canal text, forma text, pago_em timestamp with time zone, dia date, chave text, user_id uuid, nome text, whatsapp text, email text)'
     ) THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: atributos de % não são os conhecidos.', v_fn;
  END IF;
  IF has_function_privilege('anon', v_oid, 'EXECUTE')
     OR has_function_privilege('authenticated', v_oid, 'EXECUTE')
     OR EXISTS (SELECT 1 FROM pg_proc p
                  CROSS JOIN LATERAL aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) g
                 WHERE p.oid = v_oid AND g.privilege_type = 'EXECUTE' AND g.grantee = 0) THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: ACL de % não é a conhecida (PUBLIC, anon e authenticated sem EXECUTE).', v_fn;
  END IF;
  -- OID, dono, ACL e todos os atributos iguais aos da fotografia do pre-voo: so o texto do corpo mudou.
  IF NOT EXISTS (SELECT 1 FROM pg_proc p
                  WHERE p.oid = v_oid
                    AND (to_jsonb(p) - 'prosrc') = current_setting('ikcous.crm3999_atributos')::jsonb) THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: conferencia final de % falhou (OID, dono, ACL ou atributo mudou).', v_fn;
  END IF;
END $conferencia_20261399990000$;

NOTIFY pgrst, 'reload schema';
