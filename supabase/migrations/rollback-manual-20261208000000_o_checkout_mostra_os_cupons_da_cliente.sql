-- ============================================================================
-- Rollback manual -- o checkout mostra os cupons da cliente (20261208000000)
-- ============================================================================
-- Desfaz na ordem inversa da criacao: desativa os exclusivos, derruba as funcoes
-- (lista do checkout e painel), o gatilho do pedido e a funcao dele, devolve a
-- `validate_coupon_secure_v2` ao corpo da 20261203000000 BYTE A BYTE (o conserto
-- dos cupons desligados, #777, fica intacto) e so entao apaga a tabela
-- `cupom_clientes` e a coluna `coupons.alcance`. O gatilho da chave desligada
-- (20261203000000) NAO e' tocado. ACL da validacao intocada (CREATE OR REPLACE
-- preserva).
--
-- ATENCAO -- DECISAO DO DONO ANTES DE RODAR. Este rollback APAGA dado da lojista:
-- a lista de clientes de cada cupom exclusivo (tabela `cupom_clientes`) e a coluna
-- `alcance` (quem escolheu "todos os clientes" ou "clientes escolhidos" perde a
-- escolha; todo cupom volta a ser so de codigo). E DESATIVA (active = false) todo
-- cupom exclusivo ANTES de apagar a coluna: a volta nunca abre um exclusivo para
-- quem tiver o codigo em silencio. Reativar um deles depois (mesmo com a 20261208
-- reaplicada, que o devolve como 'codigo', sem ninguem na lista) o torna publico
-- para quem tiver o codigo -- so reative o que pode ser publico. Cupons de
-- "todos os clientes" voltam a ser secretos (somem do checkout; o codigo continua
-- valendo). Pedidos e contadores de uso nao sao tocados.
--
-- GUARDA DE ORDEM: so executa se o corpo vivo da validacao for o desta migration
-- (LF | CRLF) ou ja o da 20261203000000 (LF | CRLF) -- rollback repetido e'
-- idempotente. Qualquer outro corpo e' de uma migration POSTERIOR: restaurar por
-- baixo apagaria a guarda dela em silencio. O pre-voo trava as tabelas (lock_timeout
-- de 5 s) antes de decidir e nao escreve nada.
--
-- Executar pelo workflow `aplicar-migrations.yml` (arquivo rollback-manual-*; ninguem tem psql
-- direto nas lojas) ou, em banco proprio, via `psql -1 -f`. Sem BEGIN/COMMIT de nivel
-- superior neste arquivo -- regra da casa.
-- ============================================================================

DO $guarda_rollback_20261208$
DECLARE
  v_hash text;
BEGIN
  PERFORM set_config('lock_timeout', '5s', true);

  IF to_regclass('public.coupons') IS NULL OR to_regclass('public.marketplace_orders') IS NULL THEN
    RAISE EXCEPTION 'GUARDA_ROLLBACK_20261208: falta public.coupons ou public.marketplace_orders.';
  END IF;

  LOCK TABLE public.coupons IN ACCESS EXCLUSIVE MODE;
  LOCK TABLE public.marketplace_orders IN SHARE ROW EXCLUSIVE MODE;

  SELECT encode(sha256(convert_to(prosrc, 'UTF8')), 'hex') INTO v_hash
    FROM pg_proc
   WHERE oid = to_regprocedure('public.validate_coupon_secure_v2(text, numeric)');
  IF v_hash IS NULL OR v_hash NOT IN (
    'c33e930ca389b3568bd256f9363ace8fd3935f0ac73851441e0684a374b11037',
    'fdfacc20cc3bc2a691ad8961c525e5cb77071b7d5e9e590a7470e45690a2df3a',
    '489c0cd19b3529ef2d9cf341096ee9b0048e5787ff0a2d0a918df4db580e82f3',
    '4b096e67be79665d70e86ff5e94953ecf5842cd64abca882abac0f6cbe328279'
  ) THEN
    RAISE EXCEPTION 'GUARDA_ROLLBACK_20261208: corpo vivo de validate_coupon_secure_v2 (hash %) nao e o da 20261208000000 nem o da 20261203000000 -- uma migration posterior o redefiniu; reverta-a antes.', COALESCE(v_hash, 'ausente');
  END IF;
END $guarda_rollback_20261208$;

-- 1. Exclusivo nunca vira publico na volta (dinamico: a coluna pode ja nao existir
--    num rollback repetido, e o SQL estatico falharia ao ser planejado).
DO $desativa_20261208$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_attribute
     WHERE attrelid = 'public.coupons'::regclass
       AND attname = 'alcance' AND attnum > 0 AND NOT attisdropped
  ) THEN
    EXECUTE 'UPDATE public.coupons SET active = false WHERE alcance = ''exclusivo''';
  END IF;
END $desativa_20261208$;

-- 2. A lista do checkout e as funcoes do painel.
DROP FUNCTION IF EXISTS public.cupons_do_checkout(numeric);
DROP FUNCTION IF EXISTS public.admin_cupom_clientes(uuid);
DROP FUNCTION IF EXISTS public.admin_cupom_definir_clientes(uuid, uuid[]);

-- 3. O gatilho do exclusivo e a funcao dele.
DROP TRIGGER IF EXISTS tr_pedido_com_cupom_so_nasce_para_a_lista ON public.marketplace_orders;
DROP FUNCTION IF EXISTS public.pedido_com_cupom_so_nasce_para_a_lista();

-- 4. A validacao volta ao corpo da 20261203000000, BYTE A BYTE.
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

-- 5. A lista de clientes e a coluna (sem CASCADE: dependente que escapou faz o
--    Postgres recusar em vez de apagar o objeto junto).
DROP TABLE IF EXISTS public.cupom_clientes;
ALTER TABLE public.coupons DROP CONSTRAINT IF EXISTS coupons_alcance_check;
ALTER TABLE public.coupons DROP COLUMN IF EXISTS alcance;
