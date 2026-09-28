-- O CHECKOUT MOSTRA OS CUPONS DA CLIENTE (frente B, 28/09/2026 — pedido do
-- dono: "detectar os cupons que estão liberados para uso, inclusive os
-- exclusivos"). Investigação: docs/superpowers/specs/
-- 2026-09-28-cupons-checkout-investigacao.md; plano:
-- docs/superpowers/plans/2026-09-28-cupons-checkout.md.
--
-- COMO ERA: cupom "exclusivo" não existia — a 20261052000000 só fechou a
-- leitura pública da tabela (exclusivo = "quem tem o código"). Nenhum cupom
-- tinha dono nem visibilidade; o checkout só tinha o campo de digitar.
--
-- O QUE NASCE AQUI (um arquivo só — o workflow aplica cada arquivo numa
-- transação implícita: a prova é `BEGIN; <arquivo>; ROLLBACK;` e o apply é o
-- mesmo texto numa chamada só, então as peças abaixo sobem juntas ou não
-- sobem):
--   1. `coupons.alcance` — 'codigo' (secreto: só quem digita; DEFAULT, todo
--      cupom que já existe continua exatamente como está), 'vitrine' (o
--      checkout mostra para todo mundo) e 'exclusivo' (só as contas
--      escolhidas veem E só elas usam).
--   2. `cupom_clientes` — quem pode usar cada cupom exclusivo. RLS: só o
--      admin lê; ninguém escreve por PostgREST (sem grant de escrita) — só
--      pela RPC `admin_cupom_definir_clientes` (gate is_admin(), atômica).
--      Exclusivo sem ninguém na lista vale para NINGUÉM (falha fechada).
--   3. Gatilho `tr_cupom_do_pedido_vale_para_quem_compra` (BEFORE INSERT em
--      marketplace_orders, só com cupom): a garantia final do exclusivo mora
--      no INSERT do pedido — vale para a v23, a v24 e qualquer RPC futura
--      sem reescrever as ~900 linhas de cada uma. Recusa com a MESMA frase
--      do "não existe" da v24 (o classificador do front,
--      src/lib/recusaDoPedido.ts, já leva ao "remover cupom"; a frase não
--      revela que o código existe para outra pessoa). De quebra (decisão D7
--      da investigação), loja com cupons DESLIGADOS no painel
--      (`store_config.enable_coupons = false`) não dá desconto nem por
--      pedido montado à mão — antes o servidor ignorava a chave.
--   4. `validate_coupon_secure_v2` conhece o dono e a chave da loja (mesma
--      assinatura, mesmo JSON, mesmos grants — CREATE OR REPLACE preserva a
--      ACL). Também: o corte de validade vira `<=` (igual à v24: o cupom
--      morre NO instante de `valid_until`) e a recusa por mínimo diz quanto
--      falta.
--   5. `cupons_do_checkout(p_subtotal)` — a lista que o checkout mostra:
--      só ativos, válidos, não esgotados, e só 'vitrine' ou 'exclusivo' DA
--      PRÓPRIA conta (`auth.uid()`). Nunca devolve id, contadores, limite
--      nem dado de pessoa. Anon vê só a vitrine.
--   6. `admin_cupom_clientes(p_coupon_id)` — o painel lê a lista de um
--      cupom (nome e e-mail; nunca CPF).
--
-- DINHEIRO: nada muda na conta do desconto — a v23/v24 continuam as únicas
-- que gravam `discount`, com a mesma fórmula; o gatilho só RECUSA.
--
-- FRONT ANTIGO COM ESTE BANCO: continua igual (todo cupom existente nasce
-- 'codigo'; a RPC de validação mantém assinatura e JSON; o painel antigo não
-- manda `alcance`, o DEFAULT cobre o INSERT).
--
-- SEM BEGIN/COMMIT (regra da casa). Rollback:
-- rollback-manual-20261187000000_o_checkout_mostra_os_cupons_da_cliente.sql

-- 1. Alcance do cupom ---------------------------------------------------------
ALTER TABLE public.coupons
  ADD COLUMN IF NOT EXISTS alcance text NOT NULL DEFAULT 'codigo';

ALTER TABLE public.coupons DROP CONSTRAINT IF EXISTS coupons_alcance_check;
ALTER TABLE public.coupons
  ADD CONSTRAINT coupons_alcance_check
  CHECK (alcance IN ('codigo', 'vitrine', 'exclusivo'));

COMMENT ON COLUMN public.coupons.alcance IS
  'Quem vê e quem usa: codigo = só quem digita o código (secreto, padrão); '
  'vitrine = o checkout mostra para todo mundo; exclusivo = só as contas de '
  'cupom_clientes veem e usam (lista vazia = ninguém).';

-- 2. Quem pode usar cada cupom exclusivo -------------------------------------
CREATE TABLE IF NOT EXISTS public.cupom_clientes (
  coupon_id uuid NOT NULL REFERENCES public.coupons (id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES public.profiles (id) ON DELETE CASCADE,
  criado_em timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (coupon_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_cupom_clientes_user_id
  ON public.cupom_clientes (user_id);

ALTER TABLE public.cupom_clientes ENABLE ROW LEVEL SECURITY;

-- Default privileges do Supabase dão ALL a anon/authenticated em tabela nova:
-- tira tudo e devolve só a leitura (que a RLS abaixo restringe ao admin).
REVOKE ALL ON TABLE public.cupom_clientes FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.cupom_clientes TO authenticated;
GRANT ALL ON TABLE public.cupom_clientes TO service_role;

DROP POLICY IF EXISTS cupom_clientes_select_admin ON public.cupom_clientes;
CREATE POLICY cupom_clientes_select_admin
  ON public.cupom_clientes FOR SELECT
  TO authenticated
  USING ((SELECT public.is_admin()));

COMMENT ON TABLE public.cupom_clientes IS
  'Contas que podem ver e usar um cupom de alcance exclusivo. Escrita só pela '
  'RPC admin_cupom_definir_clientes; leitura só do admin.';

-- 3. O painel grava a lista (troca inteira, atômica) -------------------------
CREATE OR REPLACE FUNCTION public.admin_cupom_definir_clientes(
  p_coupon_id uuid,
  p_clientes uuid[]
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $definir$
DECLARE
  v_lista uuid[];
  v_desconhecidos integer;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Não autorizado' USING ERRCODE = '42501';
  END IF;

  IF p_coupon_id IS NULL THEN
    RAISE EXCEPTION 'Cupom não informado.';
  END IF;

  -- Trava o cupom: duas abas do painel salvando listas diferentes terminam
  -- numa das duas, nunca na mistura.
  PERFORM 1 FROM public.coupons WHERE id = p_coupon_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Cupom não encontrado.';
  END IF;

  SELECT COALESCE(array_agg(DISTINCT x), '{}'::uuid[])
    INTO v_lista
    FROM unnest(COALESCE(p_clientes, '{}'::uuid[])) AS x
   WHERE x IS NOT NULL;

  IF cardinality(v_lista) > 500 THEN
    RAISE EXCEPTION 'No máximo 500 clientes por cupom.';
  END IF;

  SELECT count(*)::integer
    INTO v_desconhecidos
    FROM unnest(v_lista) AS x
   WHERE NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = x);

  IF v_desconhecidos > 0 THEN
    RAISE EXCEPTION 'Cliente não encontrado (% de %).', v_desconhecidos, cardinality(v_lista);
  END IF;

  DELETE FROM public.cupom_clientes
   WHERE coupon_id = p_coupon_id
     AND NOT (user_id = ANY (v_lista));

  INSERT INTO public.cupom_clientes (coupon_id, user_id)
  SELECT p_coupon_id, x FROM unnest(v_lista) AS x
  ON CONFLICT (coupon_id, user_id) DO NOTHING;

  RETURN cardinality(v_lista);
END;
$definir$;

REVOKE ALL ON FUNCTION public.admin_cupom_definir_clientes(uuid, uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_cupom_definir_clientes(uuid, uuid[]) TO authenticated, service_role;

-- 4. O painel lê a lista (sem CPF) --------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_cupom_clientes(p_coupon_id uuid)
RETURNS TABLE (user_id uuid, nome text, email text)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $ler$
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Não autorizado' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT cc.user_id, p.full_name, u.email::text
    FROM public.cupom_clientes cc
    JOIN public.profiles p ON p.id = cc.user_id
    LEFT JOIN auth.users u ON u.id = cc.user_id
   WHERE cc.coupon_id = p_coupon_id
   ORDER BY p.full_name NULLS LAST, cc.user_id;
END;
$ler$;

REVOKE ALL ON FUNCTION public.admin_cupom_clientes(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_cupom_clientes(uuid) TO authenticated, service_role;

-- 5. A garantia final: o INSERT do pedido ------------------------------------
CREATE OR REPLACE FUNCTION public.cupom_do_pedido_vale_para_quem_compra()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $gatilho$
DECLARE
  v_alcance text;
  v_ligados boolean;
BEGIN
  IF NEW.coupon_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT enable_coupons INTO v_ligados FROM public.store_config WHERE id = 1;
  IF v_ligados IS FALSE THEN
    RAISE EXCEPTION 'O cupom % está desativado pela loja.', NEW.coupon_code;
  END IF;

  SELECT alcance INTO v_alcance FROM public.coupons WHERE id = NEW.coupon_id;
  IF v_alcance = 'exclusivo' AND (
       NEW.user_id IS NULL
       OR NOT EXISTS (
         SELECT 1 FROM public.cupom_clientes cc
          WHERE cc.coupon_id = NEW.coupon_id
            AND cc.user_id = NEW.user_id
       )
     ) THEN
    RAISE EXCEPTION 'O cupom % não existe. Confira o código.', NEW.coupon_code;
  END IF;

  RETURN NEW;
END;
$gatilho$;

REVOKE ALL ON FUNCTION public.cupom_do_pedido_vale_para_quem_compra() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS tr_cupom_do_pedido_vale_para_quem_compra ON public.marketplace_orders;
CREATE TRIGGER tr_cupom_do_pedido_vale_para_quem_compra
  BEFORE INSERT ON public.marketplace_orders
  FOR EACH ROW
  WHEN (NEW.coupon_id IS NOT NULL)
  EXECUTE FUNCTION public.cupom_do_pedido_vale_para_quem_compra();

-- 6. A validação antecipada conhece o dono e a chave da loja -----------------
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
    v_ligados BOOLEAN;
    v_uid uuid := auth.uid();
BEGIN
    SELECT enable_coupons INTO v_ligados FROM public.store_config WHERE id = 1;

    SELECT * INTO v_coupon FROM public.coupons
    WHERE UPPER(code) = UPPER(p_code) AND active = true;

    IF v_ligados IS FALSE THEN
        v_error := 'Esta loja não está aceitando cupons no momento.';
    -- Exclusivo de OUTRA conta responde igual a "não existe", ANTES de
    -- qualquer outro motivo: nem "expirou" nem "mínimo" revelam o código.
    ELSIF v_coupon.id IS NULL
       OR (v_coupon.alcance = 'exclusivo' AND (
             v_uid IS NULL
             OR NOT EXISTS (
               SELECT 1 FROM public.cupom_clientes cc
                WHERE cc.coupon_id = v_coupon.id AND cc.user_id = v_uid
             )
          )) THEN
        v_error := 'Cupom inválido ou expirado.';
    ELSIF v_coupon.valid_until IS NOT NULL AND v_coupon.valid_until <= NOW() THEN
        v_error := 'Este cupom expirou.';
    ELSIF (v_coupon.usage_limit IS NOT NULL AND v_coupon.usage_limit > 0) AND v_coupon.usage_count >= v_coupon.usage_limit THEN
        v_error := 'Cupom atingiu o limite de uso.';
    ELSIF v_coupon.min_purchase IS NOT NULL AND p_subtotal < v_coupon.min_purchase THEN
        v_error := 'Faltam R$ '
          || translate(to_char(v_coupon.min_purchase - p_subtotal, 'FM999999999990.00'), '.', ',')
          || ' em produtos para usar este cupom (mínimo de R$ '
          || translate(to_char(v_coupon.min_purchase, 'FM999999999990.00'), '.', ',')
          || ').';
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

-- 7. A lista do checkout ------------------------------------------------------
CREATE OR REPLACE FUNCTION public.cupons_do_checkout(p_subtotal numeric)
RETURNS TABLE (
  codigo text,
  tipo text,
  valor numeric,
  minimo numeric,
  valido_ate timestamptz,
  exclusivo boolean,
  aplica boolean,
  falta numeric,
  desconto numeric
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $lista$
  WITH entrada AS (
    SELECT GREATEST(COALESCE(p_subtotal, 0), 0) AS subtotal,
           auth.uid() AS uid
  ),
  loja AS (
    SELECT COALESCE(
             (SELECT enable_coupons FROM public.store_config WHERE id = 1),
             true
           ) AS ligados
  ),
  elegiveis AS (
    SELECT c.code,
           c.type,
           c.value,
           COALESCE(c.min_purchase, 0) AS minimo,
           c.valid_until,
           (c.alcance = 'exclusivo') AS exclusivo,
           (COALESCE(c.min_purchase, 0) <= e.subtotal) AS aplica,
           e.subtotal
      FROM public.coupons c
     CROSS JOIN entrada e
     CROSS JOIN loja l
     WHERE l.ligados
       AND c.active = true
       AND c.value > 0
       AND (c.valid_until IS NULL OR c.valid_until > now())
       AND NOT (c.usage_limit IS NOT NULL AND c.usage_limit > 0
                AND COALESCE(c.usage_count, 0) >= c.usage_limit)
       AND (
             c.alcance = 'vitrine'
             OR (c.alcance = 'exclusivo'
                 AND e.uid IS NOT NULL
                 AND EXISTS (SELECT 1 FROM public.cupom_clientes cc
                              WHERE cc.coupon_id = c.id AND cc.user_id = e.uid))
           )
  ),
  calculados AS (
    SELECT code, type, value, minimo, valid_until, exclusivo, aplica,
           CASE WHEN aplica THEN 0::numeric
                ELSE round(minimo - subtotal, 2) END AS falta,
           CASE WHEN NOT aplica THEN 0::numeric
                WHEN type = 'percentage' THEN round(LEAST(subtotal * value / 100, subtotal), 2)
                ELSE round(LEAST(value, subtotal), 2) END AS desconto
      FROM elegiveis
  )
  SELECT code, type, value, minimo, valid_until, exclusivo, aplica, falta, desconto
    FROM calculados
   ORDER BY aplica DESC, desconto DESC, falta ASC, valid_until ASC NULLS LAST, code
   LIMIT 20;
$lista$;

REVOKE ALL ON FUNCTION public.cupons_do_checkout(numeric) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.cupons_do_checkout(numeric) TO anon, authenticated, service_role;

-- 8. Autoverificação (o arquivo explode se a peça não ficou de pé) ----------
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
     WHERE tgname = 'tr_cupom_do_pedido_vale_para_quem_compra'
       AND tgrelid = 'public.marketplace_orders'::regclass
       AND NOT tgisinternal
  ) THEN
    RAISE EXCEPTION 'autoverificação: gatilho do cupom exclusivo ausente';
  END IF;

  IF NOT has_function_privilege('anon', 'public.cupons_do_checkout(numeric)', 'EXECUTE')
     OR NOT has_function_privilege('authenticated', 'public.cupons_do_checkout(numeric)', 'EXECUTE') THEN
    RAISE EXCEPTION 'autoverificação: cupons_do_checkout sem EXECUTE para anon/authenticated';
  END IF;

  IF has_function_privilege('anon', 'public.admin_cupom_definir_clientes(uuid, uuid[])', 'EXECUTE')
     OR has_function_privilege('anon', 'public.admin_cupom_clientes(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'autoverificação: RPC de admin do cupom alcançável por anon';
  END IF;

  IF has_table_privilege('authenticated', 'public.cupom_clientes', 'INSERT')
     OR has_table_privilege('authenticated', 'public.cupom_clientes', 'UPDATE')
     OR has_table_privilege('authenticated', 'public.cupom_clientes', 'DELETE')
     OR has_table_privilege('anon', 'public.cupom_clientes', 'SELECT') THEN
    RAISE EXCEPTION 'autoverificação: cupom_clientes com grant além da leitura do admin';
  END IF;

  -- Todo cupom que já existe nasce SECRETO (D1): o default é quem garante.
  IF (SELECT column_default FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'coupons'
         AND column_name = 'alcance') IS DISTINCT FROM '''codigo''::text' THEN
    RAISE EXCEPTION 'autoverificação: coupons.alcance não nasce ''codigo''';
  END IF;
END
$$;
