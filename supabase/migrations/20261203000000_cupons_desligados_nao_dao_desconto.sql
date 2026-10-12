-- OS CUPONS DESLIGADOS NAO DAO DESCONTO (dinheiro; issue #645, 08/10/2026).
--
-- O DEFEITO (medido na base 36f5a56, 24/09/2026): a chave
-- `store_config.enable_coupons` em FALSO so escondia o campo de cupom no
-- checkout. `validate_coupon_secure_v2` continuava devolvendo is_valid=true e
-- `create_marketplace_order_v23/v24` continuavam aplicando o desconto: quem
-- tinha aplicado o cupom antes de o lojista desligar a chave (ou chamava a RPC
-- direto) ainda pagava menos e queimava uso do cupom.
--
-- A DECISAO DO DONO (Gabriel, 08/10/2026): com a chave desligada o desconto
-- SOME -- mesmo que o cliente tenha aplicado o cupom antes. Nada de "vale ate
-- o fim da compra". Nao ha pedido historico alterado.
--
-- O CONSERTO, em duas pecas (nenhuma redefine create_marketplace_order_v23/
-- v24: outras migrations -- 20261174 e 20261182 -- conferem o hash do corpo
-- delas, e reescrever 2 x ~950 linhas para somar 3 seria o risco errado):
--
--   1. GATILHO `tr_pedido_com_cupom_exige_a_chave_ligada` (BEFORE INSERT em
--      `public.marketplace_orders`, so quando NEW.coupon_id IS NOT NULL): com a
--      chave em FALSO levanta `Os cupons estão desativados nesta loja.`
--      (ERRCODE padrao P0001 -- o mesmo padrao do bloco de cupom das RPCs, que o
--      front repassa como texto). E' a porta UNICA por onde um pedido com cupom
--      nasce, entao fecha v23, v24 e qualquer caminho futuro de uma vez. O
--      INSERT das RPCs vem DEPOIS do atalho de idempotencia (retry de pedido
--      criado ANTES de desligar a chave continua devolvendo o mesmo pedido) e
--      ANTES da baixa de estoque e do usage_count; como e' a mesma transacao
--      e o unico tratamento de excecao em volta do INSERT e' `WHEN
--      unique_violation`, o P0001 sobe e desfaz tudo.
--      A CORRIDA QUE O CURTO-CIRCUITO FECHA (revisao Opus, 08/10/2026, com 2
--      conexoes reais): A cria o pedido com cupom e chave K e ainda nao
--      commitou; a lojista desliga a chave; B (a retentativa gemea, mesma K)
--      espera a trava do cupom; A commita; B chega ao INSERT e o gatilho,
--      sem o curto-circuito, recusava com P0001 em vez de deixar o indice unico
--      cair no unique_violation que devolve o pedido de A. A tela entao
--      oferecia "Tirar o cupom", girava a chave e nascia um SEGUNDO pedido
--      (cobranca e estoque em dobro). Agora o gatilho, com a chave desligada,
--      faz RETURN NEW quando ja existe pedido com a MESMA idempotency_key
--      (predicado do indice marketplace_orders_chave_da_compra_unica, so a
--      coluna da chave) e deixa o indice agir. Chave NULL, chave nova ou chave
--      de outro cliente NAO escapam: sem colisao a recusa vale, e com colisao
--      o tratamento da v23/v24 so devolve pedido do proprio dono.
--   2. `public.validate_coupon_secure_v2(text, numeric)` -- corpo VIVO (o do
--      baseline 20260806000000; nenhuma migration a redefiniu depois) byte a
--      byte, com UM bloco a mais no inicio: chave em FALSO devolve
--      `{is_valid:false, discount_value:0, error_message:'Os cupons estão
--      desativados nesta loja.'}` -- o MESMO formato jsonb que
--      src/hooks/useCoupons.ts consome.
--
-- SO `IS FALSE` RECUSA (nunca `IS NOT TRUE` nem `NOT COALESCE(..., false)`): a
-- coluna aceita NULL (DEFAULT true), `upsert_store_config` pode grava-lo e a
-- linha id=1 pode nao existir; nesses casos o cupom CONTINUA aceito -- o mesmo
-- que o front faz (`getVal` trata NULL como true).
--
-- O QUE ACONTECE COM O QUE JA EXISTE: nada e' lido nem gravado em linha
-- nenhuma. Pedidos antigos (com ou sem cupom), cupons e contadores ficam como
-- estao; o gatilho so olha INSERTs novos. A chave desligada hoje comeca a
-- recusar cupom em pedido NOVO a partir do apply.
--
-- ORDEM / REAPLICACAO: ordem de execucao irrelevante entre as duas pecas (cada
-- uma e' autocontida). IDEMPOTENTE: o pre-voo aceita o corpo antigo OU o novo
-- (LF ou CRLF); CREATE OR REPLACE FUNCTION e CREATE OR REPLACE TRIGGER
-- reaplicam sem efeito colateral. ADITIVA: nenhum DROP, nenhuma coluna,
-- nenhuma linha tocada. ACL: CREATE OR REPLACE preserva os GRANT/REVOKE de
-- validate_coupon_secure_v2; o gatilho nao muda grant de tabela.
--
-- PUBLICAR JUNTO COM O FRONT: a mensagem nova precisa da regra
-- `remover_cupom` em src/lib/recusaDoPedido.ts; uma aba antiga que receba a
-- recusa sem ela cai em `conferir_antes` ("Ver meus pedidos") mesmo sem pedido
-- criado -- o pedido NUNCA nasce, so o botao e' pior.
--
-- SEM BEGIN/COMMIT (regra da casa: quem abre a transacao e' o script de
-- apply). ROLLBACK: rollback-manual-20261203000000_cupons_desligados_nao_dao_desconto.sql
-- (corpo antigo byte a byte + DROP TRIGGER + DROP FUNCTION do gatilho).
--
-- FICHA DE VERIFICACAO pos-apply (somente leitura):
--   SELECT tgname, tgenabled FROM pg_trigger
--    WHERE tgrelid = 'public.marketplace_orders'::regclass
--      AND tgname = 'tr_pedido_com_cupom_exige_a_chave_ligada';   -- 1 linha, 'O'
--   SELECT prosrc LIKE '%enable_coupons IS FALSE%' FROM pg_proc
--    WHERE oid = to_regprocedure('public.validate_coupon_secure_v2(text, numeric)'); -- true

DO $preflight_20261203000000$
DECLARE
  v_hash text;
BEGIN
  IF (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
       WHERE n.nspname = 'public' AND p.proname = 'validate_coupon_secure_v2') <> 1 THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: esperava exatamente um overload de validate_coupon_secure_v2 -- inventarie antes de aplicar (nunca DROP para arrumar).';
  END IF;
  IF to_regclass('public.marketplace_orders') IS NULL
     OR NOT EXISTS (SELECT 1 FROM information_schema.columns
                     WHERE table_schema = 'public' AND table_name = 'marketplace_orders' AND column_name = 'coupon_id')
     OR NOT EXISTS (SELECT 1 FROM information_schema.columns
                     WHERE table_schema = 'public' AND table_name = 'store_config' AND column_name = 'enable_coupons') THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: marketplace_orders.coupon_id ou store_config.enable_coupons ausente -- este banco nao e o que a 20261203000000 espera.';
  END IF;

  SELECT encode(sha256(convert_to(prosrc, 'UTF8')), 'hex') INTO v_hash
    FROM pg_proc
   WHERE oid = to_regprocedure('public.validate_coupon_secure_v2(text, numeric)');

  -- Corpo do baseline 20260806000000 (LF | CRLF) ou o que ESTA migration deixa
  -- (LF | CRLF -- reaplicacao idempotente).
  IF v_hash IS NULL OR v_hash NOT IN (
    '5fefbbe6648d44e9f6837b2a6f24d8a5223060f55b8a67fa68c223a15ab742d7',
    'b325866f6648a0f97d13d894c823a89e1ff2a6682d49db3d25816cef358eaddc',
    '489c0cd19b3529ef2d9cf341096ee9b0048e5787ff0a2d0a918df4db580e82f3',
    '4b096e67be79665d70e86ff5e94953ecf5842cd64abca882abac0f6cbe328279'
  ) THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: corpo vivo da validate_coupon_secure_v2 difere do baseline 20260806000000 (hash %) -- capture o corpo vivo e revise antes de aplicar', COALESCE(v_hash, 'ausente');
  END IF;
END $preflight_20261203000000$;

-- (1) validate_coupon_secure_v2: corpo VIVO + o bloco "chave desligada".
CREATE OR REPLACE FUNCTION public.validate_coupon_secure_v2(p_code text, p_subtotal numeric)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $$
DECLARE
    v_coupon RECORD;
    v_discount NUMERIC := 0;
    v_is_valid BOOLEAN := FALSE;
    v_error TEXT := '';
BEGIN
    -- CUPONS DESLIGADOS (issue #645, decisao do dono em 08/10/2026): com a
    -- chave store_config.enable_coupons em FALSO a validacao recusa antes de
    -- olhar o cupom -- nenhum codigo vale, nem o de quem aplicou antes de o
    -- lojista desligar. So `IS FALSE` recusa: linha ausente ou NULL = default
    -- da coluna (true), o cupom continua valendo como sempre.
    IF EXISTS (SELECT 1 FROM public.store_config WHERE id = 1 AND enable_coupons IS FALSE) THEN
        RETURN jsonb_build_object(
            'is_valid', FALSE,
            'discount_value', 0,
            'error_message', 'Os cupons estão desativados nesta loja.'
        );
    END IF;

    -- Fix: Standardize case-insensitive matching
    SELECT * INTO v_coupon FROM public.coupons 
    WHERE UPPER(code) = UPPER(p_code) AND active = true;

    IF v_coupon.id IS NULL THEN
        v_error := 'Cupom inválido ou expirado.';
    ELSIF v_coupon.valid_until IS NOT NULL AND v_coupon.valid_until < NOW() THEN
        v_error := 'Este cupom expirou.';
    ELSIF (v_coupon.usage_limit IS NOT NULL AND v_coupon.usage_limit > 0) AND v_coupon.usage_count >= v_coupon.usage_limit THEN
        v_error := 'Cupom atingiu o limite de uso.';
    ELSIF v_coupon.min_purchase IS NOT NULL AND p_subtotal < v_coupon.min_purchase THEN
        v_error := 'Valor mínimo não atingido.';
    ELSE
        v_is_valid := TRUE;
        IF v_coupon.type = 'percentage' THEN
            v_discount := (p_subtotal * v_coupon.value) / 100;
        ELSE
            v_discount := v_coupon.value;
        END IF;
        
        -- Cap discount at subtotal
        IF v_discount > p_subtotal THEN v_discount := p_subtotal; END IF;
    END IF;

    RETURN jsonb_build_object(
        'is_valid', v_is_valid,
        'discount_value', v_discount,
        'error_message', v_error
    );
END;
$$;

-- (2) O gatilho: a porta unica por onde um pedido com cupom nasce.
-- SECURITY DEFINER porque o INSERT pode vir de um papel sem SELECT em
-- store_config (a chave e' lida do banco, nunca do payload). Mesma disciplina
-- de tr_marca_estorno_direto_do_pedido: sem EXECUTE para ninguem alem do
-- mecanismo de gatilho (o PostgreSQL nao confere EXECUTE ao disparar).
CREATE OR REPLACE FUNCTION public.pedido_com_cupom_exige_a_chave_ligada()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
BEGIN
  -- IS FALSE, nunca IS NOT TRUE: NULL e linha ausente = default (true).
  IF NEW.coupon_id IS NOT NULL
     AND EXISTS (SELECT 1 FROM public.store_config WHERE id = 1 AND enable_coupons IS FALSE) THEN
    -- CURTO-CIRCUITO DA IDEMPOTENCIA (achado da revisao Opus, 08/10/2026):
    -- se este INSERT vai COLIDIR com um pedido que ja existe pela chave de
    -- compra, nao e' um pedido NOVO -- e' a retentativa gemea de um pedido que
    -- nasceu quando a chave estava ligada. O RETURN NEW deixa o indice unico
    -- agir: o unique_violation cai no tratamento da v23/v24, que devolve o
    -- pedido existente (so ao dono, ou ao convidado). Recusar aqui trocaria
    -- esse retorno por "Tirar o cupom", e a tela giraria a chave e criaria um
    -- SEGUNDO pedido (cobranca e estoque em dobro).
    -- O predicado e' EXATAMENTE o do indice unico
    -- marketplace_orders_chave_da_compra_unica (20261038000000): so a coluna
    -- idempotency_key, parcial WHERE idempotency_key IS NOT NULL -- sem
    -- chave (NULL) o `=` nunca casa e a recusa vale. Chave que NAO colide
    -- (nova, ou de outro cliente que nao existe) tambem recusa. Se a linha
    -- sumisse entre esta leitura e o indice, o INSERT nasceria; pedido nao
    -- e' apagado por nenhum caminho do app, e o indice e' a trava final.
    -- Chave de OUTRO cliente: colide no indice, e o tratamento da v23/v24 so
    -- devolve pedido do proprio dono -- sem dono, "Nao foi possivel criar o
    -- pedido" (nenhum pedido nasce). SECURITY DEFINER: precisa enxergar a
    -- linha que o outro commit acabou de gravar, sem depender de RLS.
    IF NEW.idempotency_key IS NOT NULL
       AND EXISTS (SELECT 1 FROM public.marketplace_orders WHERE idempotency_key = NEW.idempotency_key) THEN
      RETURN NEW;
    END IF;
    RAISE EXCEPTION 'Os cupons estão desativados nesta loja.';
  END IF;
  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.pedido_com_cupom_exige_a_chave_ligada() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE TRIGGER tr_pedido_com_cupom_exige_a_chave_ligada
  BEFORE INSERT ON public.marketplace_orders
  FOR EACH ROW
  WHEN (NEW.coupon_id IS NOT NULL)
  EXECUTE FUNCTION public.pedido_com_cupom_exige_a_chave_ligada();

COMMENT ON FUNCTION public.pedido_com_cupom_exige_a_chave_ligada() IS
  'Issue #645 (08/10/2026): com store_config.enable_coupons IS FALSE nenhum pedido novo nasce com cupom (recusa P0001 "Os cupons estão desativados nesta loja."). Só IS FALSE recusa; NULL ou linha ausente = ligado.';

-- (3) Pos-voo: a migration so termina se as duas pecas estao de pe.
DO $posvoo_20261203000000$
DECLARE
  v_hash text;
BEGIN
  SELECT encode(sha256(convert_to(prosrc, 'UTF8')), 'hex') INTO v_hash
    FROM pg_proc
   WHERE oid = to_regprocedure('public.validate_coupon_secure_v2(text, numeric)');
  IF v_hash IS NULL OR v_hash NOT IN (
    '489c0cd19b3529ef2d9cf341096ee9b0048e5787ff0a2d0a918df4db580e82f3',
    '4b096e67be79665d70e86ff5e94953ecf5842cd64abca882abac0f6cbe328279'
  ) THEN
    RAISE EXCEPTION 'POSVOO_20261203000000: validate_coupon_secure_v2 nao ficou com o corpo desta migration (hash %).', COALESCE(v_hash, 'ausente');
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
     WHERE tgrelid = 'public.marketplace_orders'::regclass
       AND tgname = 'tr_pedido_com_cupom_exige_a_chave_ligada'
       AND tgenabled = 'O'
  ) THEN
    RAISE EXCEPTION 'POSVOO_20261203000000: o gatilho tr_pedido_com_cupom_exige_a_chave_ligada nao esta ativo em marketplace_orders.';
  END IF;
END $posvoo_20261203000000$;
