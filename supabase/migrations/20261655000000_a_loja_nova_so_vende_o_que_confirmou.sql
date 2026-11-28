-- ============================================================================
-- Migration 20261655000000 — a loja nova so vende o que a lojista confirmou
-- (decisao de produto do socio, 28/11/2026; ADITIVA: um corpo trocado, uma funcao e um gatilho novos e duas colunas
-- calculadas no FIM da leitura publica; nenhuma linha e lida para reescrita e nenhum INSERT/UPDATE/DELETE roda)
-- ============================================================================
--
-- 1. O DEFEITO
--
--   A 20261652000000 criou store_config.entrega_confirmada_em e pagamento_confirmado_em ("Esta certo" do cartao "Loja
--   pronta"), mas a confirmacao nao chegava a vitrine nem ao servidor: a loja NOVA vendia com a entrega na cidade de
--   fabrica (R$ 10, 1 dia) e aceitava Pix, cartao e dinheiro NA ENTREGA sem a lojista ter escolhido nada.
--
-- 2. A REGRA (decisao do socio)
--
--   - entrega_confirmada_em NULL   -> a loja NAO oferece a entrega na cidade (opcao 'local-delivery').
--   - pagamento_confirmado_em NULL -> a loja NAO aceita pagar NA ENTREGA ('pix', 'card', 'cash').
--   - Pagamento pelo app ('online') e transportadora NUNCA sao travados por isto; a retirada na loja tambem nao.
--   - Cada parte destrava sozinha quando a lojista confirma (a coluna ganha data pela upsert_store_config da 1652).
--   - O balcao (canal 'presencial') nunca passa por aqui: a lojista vende em pessoa como quiser.
--
-- 3. O QUE ESTA MIGRATION FAZ, NA ORDEM
--
--   0. Pre-voo (B1_BASELINE_DIVERGENT, so leitura de catalogo) e fotografias (catalogo de forma_de_pagamento_aceita,
--      ACL e dono da vitrine).
--   1. LOCK de marketplace_orders (SHARE ROW EXCLUSIVE, o mesmo que o CREATE TRIGGER pegaria) e a TRAVA DAS LOJAS EM
--      OPERACAO (TRAVA_LOJA_EM_OPERACAO_SEM_CONFIRMACAO, ver 5), antes de qualquer escrita.
--   2. `CREATE OR REPLACE` de public.forma_de_pagamento_aceita(text): o corpo VIVO da 20261174000000 (a unica que a
--      definiu) e SO isto a mais: le pagamento_confirmado_em e devolve false para 'pix'/'card'/'cash' enquanto ela for
--      NULL. As create_marketplace_order_v23/_v24 ja chamam esta funcao DEPOIS da idempotencia e ANTES de reservar
--      qualquer coisa, com a frase que o app ja classifica ('Esta forma de pagamento não está disponível nesta loja.
--      Escolha outra.'). Mesma assinatura, atributos, dono e ACL (o pos-voo compara com a fotografia).
--   3. public.a_loja_so_entrega_na_cidade_o_que_confirmou() + gatilho tr_a_loja_so_entrega_o_confirmado (BEFORE
--      INSERT em marketplace_orders, WHEN canal <> 'presencial', o mesmo molde do tr_a_loja_aceita_pedido_novo da
--      20261600000000): pedido NOVO com a opcao 'local-delivery' e a entrega da loja ainda nao confirmada recusa com
--      P0001 'Esta loja ainda está se preparando para entregar. Escolha outra entrega ou fale com a loja.' e DETAIL
--      'entrega_local_nao_confirmada' (o codigo proprio). O gemeo de idempotencia (chave ja gravada) passa para o
--      indice unico agir, como na 1600. Na TABELA (nao em cada funcao que cria pedido): vale para a v23, a v24 e toda
--      versao futura sem redefinir os corpos de 2.500 linhas. EXECUTE de ninguem.
--   4. `CREATE OR REPLACE VIEW public.v_store_config`: as 48 colunas da 20261310000000 NA MESMA ORDEM e, no fim, so dois
--      booleanos (nunca as datas): entrega_local_liberada e pagamento_na_entrega_liberado. OR REPLACE que so acrescenta
--      no fim preserva dono, ACL e opcoes (security_invoker=on), conferidos no pos-voo.
--   5. Conferencia no fim (B2_POSVOO_DIVERGENTE aborta a migration inteira).
--
-- 4. DADOS EXISTENTES
--
--   Nenhuma linha e escrita. A loja que ja existia quando a 1652 foi aplicada tem as duas datas (o DEFAULT now() do
--   ADD COLUMN dela): para ela nada muda, a vitrine le os dois booleanos `true`. A loja NOVA (instalador com a marca em
--   curso, ou a ficha nascida depois da 1652) tem NULL: a vitrine le `false` e o servidor recusa o que ela nao confirmou.
--
-- 5. A TRAVA DAS LOJAS EM OPERACAO (o que garante que IKCOUS e Savy nunca param de vender)
--
--   No PRIMEIRO apply (o corpo vivo de forma_de_pagamento_aceita ainda e o da 1174), se a ficha id = 1 tiver QUALQUER
--   confirmacao NULL e a loja tiver QUALQUER pedido em marketplace_orders (de qualquer canal, de qualquer data), a
--   migration RECUSA inteira: TRAVA_LOJA_EM_OPERACAO_SEM_CONFIRMACAO, nada aplicado. A loja que ja vende nunca passa a
--   recusar pedido por causa desta migration; quem desfaz e a lojista (confirmar no painel) ou o operador, depois de
--   conferir a loja. O LOCK de 1 vem antes: nenhum pedido entra entre a conferencia e o fim da transacao. Ao REAPLICAR
--   (o corpo desta ja no ar) a trava nao roda: a loja ja esta sob esta regra e nada muda.
--
-- 6. IDEMPOTENCIA, TRANSACAO E TRAVAS DE TEMPO
--
--   Reaplicar deixa o mesmo estado (mesmo corpo, mesmo gatilho, mesma vitrine; o pre-voo aceita o desta). Sem
--   BEGIN/COMMIT de nivel superior (regra da casa, AGENTS.md): quem abre a transacao e o aplicador
--   (`aplicar-migrations.yml` / `node scripts/db-apply.cjs <arquivo>` / o instalador); tudo cai junto ou nao cai.
--   lock_timeout de 5 s: um pedido em voo faz o arquivo FALHAR LIMPO (55P03) em vez de enfileirar o checkout.
--
-- 7. ORDEM E QUEM QUEBRA
--
--   Depois da 20261652000000 (as colunas) e da 20261310000000 (a vitrine). Banco ANTES da tela: o front novo le os
--   booleanos AUSENTES como liberado (o comportamento de hoje), entao a tela nova num banco velho nao trava nada; a tela
--   velha num banco novo mostra a opcao que o servidor recusa (com a frase classificada). A vitrine passa a DEPENDER
--   das duas colunas da 1652: o rollback da 1652 recusa enquanto esta estiver no ar (desfaca esta antes). As provas da
--   1652 tiram esta antes: tests/banco/a-loja-nova-so-vende-posterior.cjs. As consultas que travam a lista da vitrine
--   (60a, 60b, 47a, 40a) aceitam as 50 colunas desta como sucessora.
--
-- 8. FICHA DE VERIFICACAO (so leitura): consultas oficiais 211a (depois) / 211b (antes), em scripts/publicacao/consultas/.
--
-- 9. ROLLBACK
--
--   rollback-manual-20261655000000_a_loja_nova_so_vende_o_que_confirmou.sql devolve o corpo da 1174 byte a byte, tira
--   o gatilho e a funcao nova e devolve a vitrine as 48 colunas (DROP VIEW + CREATE VIEW, com o ACL e o dono da
--   fotografia). Nenhum dado se perde (os dois booleanos sao calculados).
--
-- PROVA VIVA: tests/banco/a-loja-nova-so-vende-o-que-confirmou-viva.cjs (rpc-ci, Postgres efemero).
-- ============================================================================

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

DO $preflight_20261655000000$
DECLARE
  v_oid oid;
  v_hash text;
  v_lista text;
BEGIN
  IF (SELECT count(*) FROM pg_roles WHERE rolname IN ('anon', 'authenticated', 'service_role')) <> 3 THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: faltam os papeis anon, authenticated ou service_role.';
  END IF;
  IF to_regclass('public.store_config') IS NULL OR to_regclass('public.marketplace_orders') IS NULL THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: public.store_config ou public.marketplace_orders ausente.';
  END IF;

  -- As colunas da 20261652000000: as DUAS, timestamptz, anulaveis e sem default.
  IF (SELECT count(*) FROM pg_attribute a
       WHERE a.attrelid = 'public.store_config'::regclass AND a.attnum > 0 AND NOT a.attisdropped
         AND a.attname IN ('entrega_confirmada_em', 'pagamento_confirmado_em')
         AND a.atttypid = 'timestamptz'::regtype AND NOT a.attnotnull AND NOT a.atthasdef) <> 2 THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: store_config sem entrega_confirmada_em/pagamento_confirmado_em na forma da 20261652000000 -- aplique a 20261652000000 antes.';
  END IF;

  -- marketplace_orders: canal (text NOT NULL), idempotency_key (uuid) e customer_data (jsonb), que o gatilho le.
  IF NOT EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid = 'public.marketplace_orders'::regclass AND a.attname = 'canal'
                    AND a.atttypid = 'text'::regtype AND a.attnotnull AND a.attnum > 0 AND NOT a.attisdropped)
     OR NOT EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid = 'public.marketplace_orders'::regclass AND a.attname = 'idempotency_key'
                    AND a.atttypid = 'uuid'::regtype AND a.attnum > 0 AND NOT a.attisdropped)
     OR NOT EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid = 'public.marketplace_orders'::regclass AND a.attname = 'customer_data'
                    AND a.atttypid = 'jsonb'::regtype AND a.attnum > 0 AND NOT a.attisdropped) THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: marketplace_orders sem canal (text NOT NULL), idempotency_key (uuid) ou customer_data (jsonb).';
  END IF;

  -- forma_de_pagamento_aceita: sem sobrecarga, corpo da 20261174000000 ou o desta, atributos de sempre.
  v_oid := to_regprocedure('public.forma_de_pagamento_aceita(text)');
  IF v_oid IS NULL
     OR (SELECT count(*) FROM pg_proc q WHERE q.pronamespace = 'public'::regnamespace AND q.proname = 'forma_de_pagamento_aceita') <> 1 THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: public.forma_de_pagamento_aceita(text) ausente ou com sobrecarga -- meca a loja (consulta 211b) e revise antes de aplicar.';
  END IF;
  SELECT md5(replace(prosrc, E'\r', '')) INTO v_hash FROM pg_proc WHERE oid = v_oid;
  IF v_hash IS NULL OR v_hash NOT IN ('4f90cbc8b1c98be2fd1c6d862468376c', 'a38a13934096d55b10fcfdb1416a9c08') THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: corpo vivo de forma_de_pagamento_aceita desconhecido (%) -- nao e o da 20261174000000 nem o desta.', COALESCE(v_hash, 'ausente');
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_language l ON l.oid = p.prolang
     WHERE p.oid = v_oid
       AND p.prokind = 'f' AND p.prosecdef AND l.lanname = 'plpgsql' AND p.provolatile = 's'
       AND p.proconfig = ARRAY['search_path=public, pg_temp']::text[]
       AND pg_get_function_result(p.oid) = 'boolean' AND NOT p.proretset
  ) THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: forma_de_pagamento_aceita nao e SECURITY DEFINER plpgsql STABLE com search_path=public, pg_temp e retorno boolean -- revise antes de aplicar.';
  END IF;

  -- A funcao e o gatilho novos: ausentes, ou EXATAMENTE os desta (reaplicar).
  IF EXISTS (SELECT 1 FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace
                AND p.proname = 'a_loja_so_entrega_na_cidade_o_que_confirmou'
                AND p.oid IS DISTINCT FROM to_regprocedure('public.a_loja_so_entrega_na_cidade_o_que_confirmou()')) THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: public.a_loja_so_entrega_na_cidade_o_que_confirmou ja existe com outra assinatura -- revise antes de aplicar.';
  END IF;
  SELECT md5(replace(prosrc, E'\r', '')) INTO v_hash
    FROM pg_proc WHERE oid = to_regprocedure('public.a_loja_so_entrega_na_cidade_o_que_confirmou()');
  IF v_hash IS NOT NULL AND v_hash <> 'cdfc71d233e8fe18fc9ad65f531697bf' THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: a_loja_so_entrega_na_cidade_o_que_confirmou() ja existe com corpo desconhecido (%) -- revise antes de aplicar.', v_hash;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_trigger t WHERE NOT t.tgisinternal AND t.tgname = 'tr_a_loja_so_entrega_o_confirmado'
                AND (t.tgrelid IS DISTINCT FROM 'public.marketplace_orders'::regclass
                     OR t.tgfoid IS DISTINCT FROM to_regprocedure('public.a_loja_so_entrega_na_cidade_o_que_confirmou()'))) THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: ja existe gatilho tr_a_loja_so_entrega_o_confirmado apontando para outra funcao ou tabela -- revise antes de aplicar.';
  END IF;

  -- A vitrine: view, security_invoker=on, as 48 colunas da 20261310000000 (ou as 50 desta) na ordem.
  SELECT string_agg(a.attname, ',' ORDER BY a.attnum) INTO v_lista
    FROM pg_attribute a WHERE a.attrelid = to_regclass('public.v_store_config') AND a.attnum > 0 AND NOT a.attisdropped;
  IF NOT EXISTS (SELECT 1 FROM pg_class c WHERE c.oid = to_regclass('public.v_store_config') AND c.relkind = 'v'
                    AND 'security_invoker=on' = ANY(c.reloptions))
     OR md5(COALESCE(v_lista, '')) NOT IN ('b7ee2c31d91549a168a502de0ac4c5d2', '39fbabdd4cd002cb626ecaa7c5112cdb') THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: v_store_config nao e a view security_invoker com as 48 colunas da 20261310000000 (nem as 50 desta) -- meca a loja e revise antes de aplicar.';
  END IF;

  -- Fotografias: o CREATE OR REPLACE so pode trocar o corpo; a vitrine so pode ganhar as duas colunas.
  PERFORM set_config('ikcous.so_vende1655_aceita',
    (SELECT to_jsonb(p) - 'prosrc' FROM pg_proc p WHERE p.oid = v_oid)::text, true);
  PERFORM set_config('ikcous.so_vende1655_vista',
    (SELECT jsonb_build_object('dono', c.relowner::regrole::text, 'acl', COALESCE(c.relacl, acldefault('r', c.relowner))::text[])
       FROM pg_class c WHERE c.oid = to_regclass('public.v_store_config'))::text, true);
END $preflight_20261655000000$;

-- ---------------------------------------------------------------------------
-- 1. A trava das lojas em operacao, com os pedidos novos parados ate o fim da transacao.
-- ---------------------------------------------------------------------------
LOCK TABLE public.marketplace_orders IN SHARE ROW EXCLUSIVE MODE;

DO $trava_20261655000000$
BEGIN
  -- So no PRIMEIRO apply: com o corpo desta ja no ar a loja ja vive sob esta regra (reaplicar nao muda nada).
  IF (SELECT md5(replace(prosrc, E'\r', '')) FROM pg_proc
       WHERE oid = to_regprocedure('public.forma_de_pagamento_aceita(text)')) = '4f90cbc8b1c98be2fd1c6d862468376c'
     AND EXISTS (SELECT 1 FROM public.store_config s
                  WHERE s.id = 1 AND (s.entrega_confirmada_em IS NULL OR s.pagamento_confirmado_em IS NULL))
     AND EXISTS (SELECT 1 FROM public.marketplace_orders) THEN
    RAISE EXCEPTION 'TRAVA_LOJA_EM_OPERACAO_SEM_CONFIRMACAO: esta loja ja tem pedidos e a entrega ou o pagamento ainda nao foram confirmados -- aplicar faria a loja parar de oferecer o que ja vende. Nada aplicado. Confirme no painel (Loja pronta) ou confira a loja antes.';
  END IF;
END $trava_20261655000000$;

-- ---------------------------------------------------------------------------
-- 2. forma_de_pagamento_aceita: corpo da 20261174000000 com a trava do pagamento na entrega
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.forma_de_pagamento_aceita(p_metodo text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_config RECORD;
BEGIN
  SELECT pagamento_online, formas_pagamento_entrega, pagamento_confirmado_em INTO v_config
    FROM public.store_config WHERE id = 1;
  IF NOT FOUND THEN
    RETURN false;
  END IF;
  -- 20261655000000: a loja nova so aceita pagar NA ENTREGA depois que a lojista confirma as formas
  -- (pagamento_confirmado_em, "Esta certo" da Loja pronta, 20261652000000). O pagamento pelo app
  -- ('online') nunca e travado por isto.
  IF p_metodo IN ('pix', 'card', 'cash') AND v_config.pagamento_confirmado_em IS NULL THEN
    RETURN false;
  END IF;
  RETURN CASE p_metodo
    WHEN 'online' THEN v_config.pagamento_online
    WHEN 'pix' THEN 'pix' = ANY(v_config.formas_pagamento_entrega)
    WHEN 'card' THEN 'card' = ANY(v_config.formas_pagamento_entrega)
    WHEN 'cash' THEN 'cash' = ANY(v_config.formas_pagamento_entrega)
    ELSE false
  END;
END;
$function$;

-- ---------------------------------------------------------------------------
-- 3. O gatilho da entrega na cidade nao confirmada (na tabela: vale para toda funcao que cria pedido)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.a_loja_so_entrega_na_cidade_o_que_confirmou()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path = public, pg_temp
AS $function$
BEGIN
  -- So a entrega propria da cidade. Retirada, transportadora e pedido sem opcao seguem as regras de sempre.
  IF btrim(COALESCE(NEW.customer_data->>'shipping_option_id', '')) = 'local-delivery' THEN
    -- ATALHO DA RETENTATIVA (o mesmo da 20261600000000): este INSERT vai COLIDIR com um pedido que ja existe pela
    -- chave de compra, entao nao e pedido NOVO. O RETURN NEW deixa o indice unico agir e a v23/v24 devolver o pedido
    -- que ja nasceu (mesmo que a regra tenha mudado depois dele).
    IF NEW.idempotency_key IS NOT NULL
       AND EXISTS (SELECT 1 FROM public.marketplace_orders WHERE idempotency_key = NEW.idempotency_key) THEN
      RETURN NEW;
    END IF;
    -- A loja nova que ainda nao confirmou a entrega na cidade (20261652000000) nao a oferece. Sem a ficha, nada a
    -- recusar aqui (a v23/v24 ja recusam a loja sem CEP de origem).
    IF EXISTS (SELECT 1 FROM public.store_config s WHERE s.id = 1 AND s.entrega_confirmada_em IS NULL) THEN
      RAISE EXCEPTION 'Esta loja ainda está se preparando para entregar. Escolha outra entrega ou fale com a loja.'
        USING ERRCODE = 'P0001', DETAIL = 'entrega_local_nao_confirmada';
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.a_loja_so_entrega_na_cidade_o_que_confirmou() FROM PUBLIC, anon, authenticated, service_role;
COMMENT ON FUNCTION public.a_loja_so_entrega_na_cidade_o_que_confirmou() IS
  'Gatilho BEFORE INSERT de marketplace_orders (so canal online): pedido NOVO com a entrega na cidade (local-delivery) numa loja que ainda nao confirmou a entrega (store_config.entrega_confirmada_em NULL) recusa com P0001 e DETAIL entrega_local_nao_confirmada. Retentativa com a chave de um pedido que ja existe passa (o indice unico age).';

-- O nome decide a ordem: tr_a_loja_aceita_pedido_novo (manutencao, pausa) roda antes; os do cupom (tr_pedido_*) depois.
CREATE OR REPLACE TRIGGER tr_a_loja_so_entrega_o_confirmado
  BEFORE INSERT ON public.marketplace_orders
  FOR EACH ROW
  WHEN (NEW.canal IS DISTINCT FROM 'presencial')
  EXECUTE FUNCTION public.a_loja_so_entrega_na_cidade_o_que_confirmou();

-- ---------------------------------------------------------------------------
-- 4. A vitrine: as 48 colunas de sempre, na ordem, e os dois booleanos no fim (nunca as datas)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW public.v_store_config WITH (security_invoker=on) AS
 SELECT id,
    free_shipping_min,
    shipping_fee,
    whatsapp_number,
    share_text,
    business_hours,
    enable_reviews,
    enable_coupons,
    primary_color,
    theme_mode,
    logo_url,
    real_time_sales_alerts,
    push_marketing_enabled,
    min_app_version,
    origin_cep,
    shipping_provider,
    enabled_shipping_methods,
    shipping_coverage,
    local_delivery_fee,
    local_cep_range,
    created_at,
    updated_at,
    store_name,
    store_city,
    store_state,
    home_sections,
    secondary_color,
    accent_color,
    branding_assets,
    dominio_publico,
    mp_public_key,
    vapid_public_key,
    pagamento_online,
    manutencao,
    store_address,
    store_description,
    national_shipping_strategy,
    national_shipping_min,
    national_discount_type,
    national_discount_value,
    national_benefit_scope,
    formas_pagamento_entrega,
    store_legal_name,
    store_legal_document,
    store_support_email,
    local_delivery_enabled,
    local_delivery_days,
    free_shipping_card_style,
    (entrega_confirmada_em IS NOT NULL) AS entrega_local_liberada,
    (pagamento_confirmado_em IS NOT NULL) AS pagamento_na_entrega_liberado
   FROM store_config
  WHERE id = 1;

-- ---------------------------------------------------------------------------
-- 5. CONFERENCIA no instante do apply: aborta a migration inteira se algo nao ficou como desenhado.
-- ---------------------------------------------------------------------------
DO $conferencia_20261655000000$
DECLARE
  v_oid oid := to_regprocedure('public.forma_de_pagamento_aceita(text)');
  v_gatilho oid := to_regprocedure('public.a_loja_so_entrega_na_cidade_o_que_confirmou()');
BEGIN
  IF (SELECT md5(replace(prosrc, E'\r', '')) FROM pg_proc WHERE oid = v_oid) IS DISTINCT FROM 'a38a13934096d55b10fcfdb1416a9c08' THEN
    RAISE EXCEPTION 'B2_POSVOO_DIVERGENTE: 20261655000000 -- o corpo vivo de forma_de_pagamento_aceita nao e o desta migration.';
  END IF;
  IF (SELECT to_jsonb(p) - 'prosrc' FROM pg_proc p WHERE p.oid = v_oid)
       IS DISTINCT FROM current_setting('ikcous.so_vende1655_aceita')::jsonb THEN
    RAISE EXCEPTION 'B2_POSVOO_DIVERGENTE: 20261655000000 -- OID, dono, ACL ou atributo de forma_de_pagamento_aceita mudou.';
  END IF;
  IF v_gatilho IS NULL
     OR (SELECT md5(replace(prosrc, E'\r', '')) FROM pg_proc WHERE oid = v_gatilho) IS DISTINCT FROM 'cdfc71d233e8fe18fc9ad65f531697bf'
     OR NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_language l ON l.oid = p.prolang
                     WHERE p.oid = v_gatilho AND p.prosecdef AND l.lanname = 'plpgsql' AND p.provolatile = 'v'
                       AND p.proconfig = ARRAY['search_path=public, pg_temp']::text[]
                       AND pg_get_function_result(p.oid) = 'trigger')
     OR EXISTS (SELECT 1 FROM pg_proc p CROSS JOIN LATERAL aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) g
                 WHERE p.oid = v_gatilho AND g.privilege_type = 'EXECUTE' AND g.grantee <> p.proowner) THEN
    RAISE EXCEPTION 'B2_POSVOO_DIVERGENTE: 20261655000000 -- a funcao do gatilho nao ficou como desenhada (corpo, atributos ou EXECUTE so do dono).';
  END IF;
  IF (SELECT count(*) FROM pg_trigger t
       WHERE NOT t.tgisinternal AND t.tgenabled = 'O' AND t.tgname = 'tr_a_loja_so_entrega_o_confirmado'
         AND pg_get_triggerdef(t.oid) = 'CREATE TRIGGER tr_a_loja_so_entrega_o_confirmado BEFORE INSERT ON public.marketplace_orders FOR EACH ROW WHEN ((new.canal IS DISTINCT FROM ''presencial''::text)) EXECUTE FUNCTION a_loja_so_entrega_na_cidade_o_que_confirmou()') <> 1 THEN
    RAISE EXCEPTION 'B2_POSVOO_DIVERGENTE: 20261655000000 -- o gatilho tr_a_loja_so_entrega_o_confirmado nao ficou ligado com a definicao exata.';
  END IF;
  IF md5((SELECT string_agg(a.attname, ',' ORDER BY a.attnum) FROM pg_attribute a
           WHERE a.attrelid = 'public.v_store_config'::regclass AND a.attnum > 0 AND NOT a.attisdropped))
       IS DISTINCT FROM '39fbabdd4cd002cb626ecaa7c5112cdb'
     OR NOT EXISTS (SELECT 1 FROM pg_class c WHERE c.oid = 'public.v_store_config'::regclass AND 'security_invoker=on' = ANY(c.reloptions))
     OR (SELECT jsonb_build_object('dono', c.relowner::regrole::text, 'acl', COALESCE(c.relacl, acldefault('r', c.relowner))::text[])
           FROM pg_class c WHERE c.oid = 'public.v_store_config'::regclass)
          IS DISTINCT FROM current_setting('ikcous.so_vende1655_vista')::jsonb THEN
    RAISE EXCEPTION 'B2_POSVOO_DIVERGENTE: 20261655000000 -- a vitrine nao ficou com as 50 colunas, security_invoker, dono e ACL de antes.';
  END IF;
END $conferencia_20261655000000$;

NOTIFY pgrst, 'reload schema';
