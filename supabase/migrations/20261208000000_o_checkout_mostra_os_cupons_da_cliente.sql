-- ============================================================================
-- Migration 20261208000000 -- o checkout mostra os cupons da cliente
-- (dinheiro + dado de cliente; Frente B do PR #669 refeita sobre o principal;
-- 09/10/2026)
-- ============================================================================
--
-- 1. O QUE MUDA PARA QUEM USA
--
-- Checkout: alem do campo de digitar o codigo, a cliente passa a VER os cupons
-- que ELA pode usar (desconto, validade, "Faltam R$ X") e aplica com um toque.
-- Painel: cada cupom ganha "Quem pode usar": quem tiver o codigo (secreto, o
-- padrao -- todo cupom que ja existe fica assim), todos os clientes (aparece no
-- checkout de todos) ou clientes escolhidos (so as contas da lista veem E usam).
--
-- 2. O QUE ESTA MIGRATION FAZ (nesta ordem; um arquivo so)
--
--   0. PRE-VOO (primeiro comando, escreve NADA): recusa, com o nome do que falta
--      ou diverge, o banco que nao e o que esta migration espera -- corpo vivo da
--      validacao fora dos 4 hashes aceitos, gatilho da 20261203 ausente, indice
--      unico da chave de compra ausente, funcoes do admin atual ausentes, forma
--      diferente de `alcance`/`cupom_clientes`/das funcoes novas. Trava as tabelas
--      (lock_timeout de 5 s) ANTES de ler o que decide.
--   1. `coupons.alcance text NOT NULL DEFAULT 'codigo'` + CHECK dos 3 valores
--      ('codigo' = secreto, so quem digita; 'vitrine' = todos os clientes;
--      'exclusivo' = so a lista).
--   2. `cupom_clientes` (quem pode usar cada exclusivo): RLS ligada, ninguem
--      escreve por PostgREST, leitura so do admin ATUAL (`rls_admin_atual()`).
--   3. Duas funcoes do painel, ambas com `IF NOT (public.is_admin() AND
--      public.is_admin_atual())` (is_admin() sozinho confia no JWT por ~1 h: um
--      ex-admin leria nome e e-mail de clientes):
--        admin_cupom_definir_clientes(uuid, uuid[])  -- troca a lista, atomica;
--        admin_cupom_clientes(uuid)                  -- le a lista (nunca CPF).
--   4. GATILHO `tr_pedido_com_cupom_so_nasce_para_a_lista` (BEFORE INSERT em
--      marketplace_orders, so com cupom): exclusivo so nasce no pedido de quem
--      esta na lista. O nome roda DEPOIS de `tr_pedido_com_cupom_exige_a_chave_
--      ligada` (os gatilhos do mesmo tipo disparam em ordem de nome). Recusa com
--      a MESMA frase do "nao existe" da v24 e nao gasta a vaga do cupom.
--      ATALHO DE RETENTATIVA IDENTICO ao da 20261203 (linhas 206-208 dela):
--      se este INSERT vai colidir pela chave de compra com um pedido que ja
--      existe, nao e pedido NOVO -- e a retentativa gemea de um pedido que
--      nasceu quando a cliente ainda estava na lista. O RETURN NEW deixa o
--      indice unico agir e a v23/v24 devolve o pedido existente (so ao dono).
--      Sem o atalho, a lojista que tira a cliente da lista no meio de uma
--      compra repetida faz a tela oferecer "Tirar o cupom", girar a chave e
--      nascer um SEGUNDO pedido (cobranca e estoque em dobro).
--   5. `validate_coupon_secure_v2`: parte do corpo VIVO da 20261203 (o conserto
--      dos cupons desligados, #777) e so ACRESCENTA o bloco do exclusivo (exclusivo
--      de OUTRA conta responde 'Cupom invalido ou expirado.' ANTES de qualquer
--      outro motivo), o corte de validade `<=` (o cupom morre NO instante, como a
--      v24) e a frase 'Faltam R$ ... em produtos ...' no lugar de 'Valor minimo
--      nao atingido.'. A frase 'Cupom atingiu o limite de uso.' NAO muda um
--      caractere (o front e o cupom preso a leem). Mesma assinatura, mesmo JSON,
--      mesmos grants (CREATE OR REPLACE preserva a ACL).
--   6. `cupons_do_checkout(numeric)` -- a lista do checkout: so ativos, validos,
--      nao esgotados, com a chave de cupons ligada, e so 'vitrine' ou o exclusivo
--      DA PROPRIA conta (`auth.uid()`). Nunca devolve id, contador, limite nem dado
--      de pessoa. LIMIT 20. Visitante sem conta ve so 'vitrine'.
--   7. POS-VOO: a migration so termina se o corpo novo, o gatilho (e a ordem dele),
--      as permissoes e o default de `alcance` estao de pe.
--
-- 3. DADOS QUE JA EXISTEM
--
-- Nenhuma linha de cupom, de pedido nem de cliente e lida ou reescrita:
-- `ADD COLUMN ... DEFAULT 'codigo'` e constante (sem reescrita da tabela) e todo
-- cupom que ja existe passa a valer 'codigo' -- exatamente como era (so quem tem
-- o codigo). Pedidos antigos, contadores de uso e a chave de cupons ficam como
-- estao; o gatilho so olha INSERTs novos. Duas diferencas visiveis num cupom
-- ANTIGO, ambas so de texto/instante: a recusa por minimo agora diz quanto falta
-- (antes: 'Valor minimo nao atingido.') e o cupom vence NO instante de
-- `valid_until` (antes: um instante depois).
--
-- 4. ORDEM, TRAVAS E CONCORRENCIA
--
-- O pre-voo trava, nesta ordem, `coupons` (ACCESS EXCLUSIVE: `ADD COLUMN` pede esse
-- nivel de qualquer jeito), `profiles` (SHARE ROW EXCLUSIVE: a chave estrangeira de
-- `cupom_clientes` pede) e `marketplace_orders` (SHARE ROW EXCLUSIVE: o CREATE
-- TRIGGER pede), com `lock_timeout` de 5 s: quem ja segura uma dessas tabelas por mais
-- que isso (um pedido que pegou a linha do cupom e demora) faz a migration FALHAR
-- (55P03) sem gravar nada, em vez de enfileirar o checkout atras dela; e so repetir.
-- Um pedido que ja segura `coupons` com ROW SHARE (o FOR UPDATE do cupom) passa na
-- frente da trava exclusiva e termina; quem chega depois espera ate o COMMIT (alguns
-- milissegundos). RISCO RESIDUAL ACEITO E ESCRITO: pedido e cancelamento pegam
-- `coupons` e `marketplace_orders` em ORDEM OPOSTA; se um cancelamento em andamento
-- cruzar com a trava, o Postgres desfaz UM dos dois (40P01) -- ou a migration (e
-- basta repetir) ou o cancelamento (a tela pede para tentar de novo). Aplicar FORA
-- DO HORARIO DE PICO.
-- Esta migration so le o catalogo e escreve estrutura nova; o corpo vivo da
-- validacao e conferido DEPOIS da trava. O apply e serializado pelo workflow
-- (um de cada vez): outra migration que troque a validacao ao mesmo tempo faria o
-- `CREATE OR REPLACE` falhar por tupla concorrente, nunca sobrescrever calada.
--
-- 5. IDEMPOTENCIA
--
-- Rodar duas vezes e o mesmo que rodar uma: o pre-voo aceita o corpo da 20261203 OU o
-- que esta migration deixa (LF ou CRLF); `ADD COLUMN IF NOT EXISTS`, `CREATE TABLE IF
-- NOT EXISTS`, `CREATE OR REPLACE`, `CREATE OR REPLACE TRIGGER` e REVOKE/GRANT
-- reaplicam sem efeito colateral; a politica de `cupom_clientes` (objeto desta
-- migration) e recriada igual. ADITIVA: nenhuma coluna, tabela nem dado de OUTRA
-- migration e apagado; o unico DROP e o da politica propria, recriada na hora.
--
-- 6. FRONT ANTIGO COM ESTE BANCO
--
-- Continua igual: todo cupom existente nasce 'codigo'; a RPC de validacao mantem
-- assinatura e JSON; o painel antigo nao manda `alcance` (o DEFAULT cobre o INSERT).
-- PUBLICAR O FRONT NOVO ANTES de marcar um cupom como "Clientes escolhidos" no
-- painel: o painel antigo nao mostra nem preserva a lista.
--
-- 7. FORA DO ESCOPO
--
-- Limite de uso POR CLIENTE (issue #30): exclusivo sem limite vale em todas as
-- compras da cliente da lista -- o formulario novo avisa. Nao redefine
-- create_marketplace_order_v23/v24 nem devolver_uso_cupom (outras migrations
-- conferem o hash do corpo delas).
--
-- 8. SEM BEGIN/COMMIT (regra da casa: quem abre a transacao e quem aplica; com eles
-- o ROLLBACK da prova do workflow vira no-op). O arquivo roda numa unica consulta: o
-- pre-voo, as pecas e o pos-voo caem juntos ou nao caem.
--
-- 9. ROLLBACK: rollback-manual-20261208000000_o_checkout_mostra_os_cupons_da_cliente.sql
--    -- ATENCAO: APAGA a lista de clientes e a coluna `alcance` e DESATIVA os cupons
--    exclusivos (volta a validacao ao corpo da 20261203, byte a byte). Decisao do dono.
--
-- 10. FICHA DE VERIFICACAO pos-apply (somente leitura):
--   SELECT column_default FROM information_schema.columns
--    WHERE table_schema = 'public' AND table_name = 'coupons' AND column_name = 'alcance'; -- 'codigo'::text
--   SELECT tgname, tgenabled FROM pg_trigger
--    WHERE tgrelid = 'public.marketplace_orders'::regclass AND NOT tgisinternal
--      AND tgname LIKE 'tr_pedido_com_cupom_%' ORDER BY tgname;  -- 2 linhas, 'O'
--   SELECT encode(sha256(convert_to(prosrc, 'UTF8')), 'hex') FROM pg_proc
--    WHERE oid = to_regprocedure('public.validate_coupon_secure_v2(text, numeric)');
--     -- c33e930ca389b3568bd256f9363ace8fd3935f0ac73851441e0684a374b11037 (LF) ou fdfacc20cc3bc2a691ad8961c525e5cb77071b7d5e9e590a7470e45690a2df3a (CRLF)
-- ============================================================================

DO $preflight_20261208$
DECLARE
  v_hash text;
  v_n integer;
  v_forma text;
  v_def text;
  v_item text;
BEGIN
  PERFORM set_config('lock_timeout', '5s', true);

  IF to_regclass('public.coupons') IS NULL
     OR to_regclass('public.profiles') IS NULL
     OR to_regclass('public.marketplace_orders') IS NULL
     OR to_regclass('public.store_config') IS NULL THEN
    RAISE EXCEPTION 'PREFLIGHT_20261208: falta public.coupons, public.profiles, public.marketplace_orders ou public.store_config -- aplique as migrations anteriores antes desta.';
  END IF;

  -- A trava vem ANTES de qualquer leitura que decida: o que for conferido abaixo
  -- continua verdadeiro ate o COMMIT. Ordem: coupons, profiles, marketplace_orders.
  LOCK TABLE public.coupons IN ACCESS EXCLUSIVE MODE;
  LOCK TABLE public.profiles IN SHARE ROW EXCLUSIVE MODE;
  LOCK TABLE public.marketplace_orders IN SHARE ROW EXCLUSIVE MODE;

  -- Colunas de que os corpos desta migration dependem.
  FOREACH v_item IN ARRAY ARRAY[
    'coupons.id', 'coupons.code', 'coupons.type', 'coupons.value', 'coupons.min_purchase',
    'coupons.usage_limit', 'coupons.usage_count', 'coupons.valid_until', 'coupons.active',
    'profiles.id', 'profiles.full_name',
    'marketplace_orders.user_id', 'marketplace_orders.coupon_id',
    'marketplace_orders.coupon_code', 'marketplace_orders.idempotency_key',
    'store_config.enable_coupons'
  ] LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_attribute a
       WHERE a.attrelid = to_regclass('public.' || split_part(v_item, '.', 1))
         AND a.attname = split_part(v_item, '.', 2)
         AND a.attnum > 0 AND NOT a.attisdropped
    ) THEN
      RAISE EXCEPTION 'PREFLIGHT_20261208: coluna % ausente -- este banco nao e o que a 20261208000000 espera.', v_item;
    END IF;
  END LOOP;

  -- Funcoes do admin ATUAL (20261197000000) e a porta antiga (is_admin).
  IF to_regprocedure('public.is_admin()') IS NULL
     OR to_regprocedure('public.is_admin_atual()') IS NULL
     OR to_regprocedure('public.rls_admin_atual()') IS NULL THEN
    RAISE EXCEPTION 'PREFLIGHT_20261208: public.is_admin(), public.is_admin_atual() ou public.rls_admin_atual() ausente -- aplique a 20261197000000 antes desta.';
  END IF;

  -- A validacao: exatamente um overload e o corpo vivo e o da 20261203 ou o desta.
  IF (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
       WHERE n.nspname = 'public' AND p.proname = 'validate_coupon_secure_v2') <> 1 THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: esperava exatamente um overload de validate_coupon_secure_v2 -- inventarie antes de aplicar (nunca DROP para arrumar).';
  END IF;

  SELECT encode(sha256(convert_to(prosrc, 'UTF8')), 'hex') INTO v_hash
    FROM pg_proc
   WHERE oid = to_regprocedure('public.validate_coupon_secure_v2(text, numeric)');

  -- Corpo da 20261203000000 (LF | CRLF) ou o que ESTA migration deixa (LF | CRLF --
  -- reaplicacao idempotente). Qualquer outro e de uma migration POSTERIOR ou de uma
  -- mao: reescrever por cima apagaria a guarda dela em silencio.
  IF v_hash IS NULL OR v_hash NOT IN (
    '489c0cd19b3529ef2d9cf341096ee9b0048e5787ff0a2d0a918df4db580e82f3',
    '4b096e67be79665d70e86ff5e94953ecf5842cd64abca882abac0f6cbe328279',
    'c33e930ca389b3568bd256f9363ace8fd3935f0ac73851441e0684a374b11037',
    'fdfacc20cc3bc2a691ad8961c525e5cb77071b7d5e9e590a7470e45690a2df3a'
  ) THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: corpo vivo da validate_coupon_secure_v2 difere do da 20261203000000 (hash %) -- capture o corpo vivo e revise antes de aplicar', COALESCE(v_hash, 'ausente');
  END IF;

  -- O conserto dos cupons desligados (20261203000000) tem de estar de pe: o
  -- gatilho novo roda DEPOIS dele e parte da mesma disciplina.
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
     WHERE tgrelid = 'public.marketplace_orders'::regclass
       AND tgname = 'tr_pedido_com_cupom_exige_a_chave_ligada'
       AND tgenabled = 'O' AND NOT tgisinternal
  ) THEN
    RAISE EXCEPTION 'PREFLIGHT_20261208: o gatilho tr_pedido_com_cupom_exige_a_chave_ligada (20261203000000) nao esta ativo em marketplace_orders -- aplique-a antes desta.';
  END IF;

  -- O atalho de retentativa do gatilho novo deixa o INDICE UNICO agir: sem ele o
  -- atalho deixaria nascer o pedido (cupom exclusivo para quem esta fora da lista).
  IF NOT EXISTS (
    SELECT 1 FROM pg_index i
     WHERE i.indexrelid = to_regclass('public.marketplace_orders_chave_da_compra_unica')
       AND i.indrelid = 'public.marketplace_orders'::regclass
       AND i.indisunique AND i.indisvalid AND i.indisready
       AND i.indnatts = 1
       AND (SELECT a.attname FROM pg_attribute a
             WHERE a.attrelid = i.indrelid AND a.attnum = i.indkey[0]) = 'idempotency_key'
       AND regexp_replace(lower(COALESCE(pg_get_expr(i.indpred, i.indrelid), '')), '[\s()]', '', 'g') = 'idempotency_keyisnotnull'
  ) THEN
    RAISE EXCEPTION 'PREFLIGHT_20261208: o indice unico marketplace_orders_chave_da_compra_unica (idempotency_key, parcial) nao existe ou tem outra forma -- o atalho de retentativa do gatilho novo depende dele.';
  END IF;

  -- `alcance`: ausente, ou EXATAMENTE como esta migration o deixa.
  SELECT format_type(a.atttypid, a.atttypmod) || '|' || a.attnotnull::text || '|'
         || COALESCE(pg_get_expr(d.adbin, d.adrelid), 'sem default')
    INTO v_forma
    FROM pg_attribute a
    LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
   WHERE a.attrelid = 'public.coupons'::regclass
     AND a.attname = 'alcance' AND a.attnum > 0 AND NOT a.attisdropped;
  IF v_forma IS NOT NULL AND v_forma <> 'text|true|''codigo''::text' THEN
    RAISE EXCEPTION 'PREFLIGHT_20261208: coupons.alcance ja existe com outra forma (%) -- esperava text NOT NULL DEFAULT ''codigo''.', v_forma;
  END IF;

  SELECT pg_get_constraintdef(c.oid) INTO v_def
    FROM pg_constraint c
   WHERE c.conrelid = 'public.coupons'::regclass AND c.conname = 'coupons_alcance_check';
  IF v_def IS NOT NULL
     AND v_def <> 'CHECK ((alcance = ANY (ARRAY[''codigo''::text, ''vitrine''::text, ''exclusivo''::text])))' THEN
    RAISE EXCEPTION 'PREFLIGHT_20261208: coupons_alcance_check ja existe com outra definicao (%).', v_def;
  END IF;

  -- `cupom_clientes`: ausente, ou com as 3 colunas e os tipos que esta migration cria.
  IF to_regclass('public.cupom_clientes') IS NOT NULL THEN
    SELECT string_agg(a.attname || ':' || format_type(a.atttypid, a.atttypmod) || ':' || a.attnotnull::text,
                      ',' ORDER BY a.attnum)
      INTO v_forma
      FROM pg_attribute a
     WHERE a.attrelid = 'public.cupom_clientes'::regclass AND a.attnum > 0 AND NOT a.attisdropped;
    IF v_forma IS DISTINCT FROM 'coupon_id:uuid:true,user_id:uuid:true,criado_em:timestamp with time zone:true' THEN
      RAISE EXCEPTION 'PREFLIGHT_20261208: public.cupom_clientes ja existe com outra forma (%).', v_forma;
    END IF;
  END IF;

  -- As funcoes novas: nenhuma sobrecarga alheia (o PostgREST responderia "function
  -- is not unique") e, se ja existem, so com a assinatura que esta migration cria.
  FOR v_item, v_forma IN
    SELECT * FROM (VALUES
      ('cupons_do_checkout', 'p_subtotal numeric'),
      ('admin_cupom_clientes', 'p_coupon_id uuid'),
      ('admin_cupom_definir_clientes', 'p_coupon_id uuid, p_clientes uuid[]'),
      ('pedido_com_cupom_so_nasce_para_a_lista', '')
    ) AS t(nome, args)
  LOOP
    SELECT count(*) INTO v_n
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.proname = v_item
       AND pg_get_function_identity_arguments(p.oid) IS DISTINCT FROM v_forma;
    IF v_n > 0 THEN
      RAISE EXCEPTION 'PREFLIGHT_20261208: ja existe public.% com outra assinatura (esperava (%)) -- inventarie antes de aplicar.', v_item, v_forma;
    END IF;
  END LOOP;
END $preflight_20261208$;

-- 1. Alcance do cupom ---------------------------------------------------------
ALTER TABLE public.coupons
  ADD COLUMN IF NOT EXISTS alcance text NOT NULL DEFAULT 'codigo';

DO $alcance_20261208$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'public.coupons'::regclass AND conname = 'coupons_alcance_check'
  ) THEN
    ALTER TABLE public.coupons
      ADD CONSTRAINT coupons_alcance_check
      CHECK (alcance IN ('codigo', 'vitrine', 'exclusivo'));
  END IF;
END $alcance_20261208$;

COMMENT ON COLUMN public.coupons.alcance IS
  'Quem ve e quem usa: codigo = so quem digita o codigo (secreto, padrao); vitrine = o checkout mostra para todo mundo; exclusivo = so as contas de cupom_clientes veem e usam (lista vazia = ninguem).';

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

-- Os default privileges do Supabase dao ALL a anon/authenticated em tabela nova:
-- tira tudo e devolve so a leitura (que a politica abaixo restringe ao admin ATUAL).
REVOKE ALL ON TABLE public.cupom_clientes FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.cupom_clientes TO authenticated;
GRANT ALL ON TABLE public.cupom_clientes TO service_role;

DROP POLICY IF EXISTS cupom_clientes_admin_select_policy ON public.cupom_clientes;
CREATE POLICY cupom_clientes_admin_select_policy
  ON public.cupom_clientes FOR SELECT
  TO authenticated
  USING ((SELECT public.rls_admin_atual()));

COMMENT ON TABLE public.cupom_clientes IS
  'Contas que podem ver e usar um cupom de alcance exclusivo. Escrita so pela RPC admin_cupom_definir_clientes; leitura so do admin atual.';

-- 3. O painel grava a lista (troca inteira, atomica) -------------------------
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
  IF NOT (public.is_admin() AND public.is_admin_atual()) THEN
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

REVOKE ALL ON FUNCTION public.admin_cupom_definir_clientes(uuid, uuid[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_cupom_definir_clientes(uuid, uuid[]) TO authenticated, service_role;

-- 3b. O painel le a lista (nome e e-mail; nunca CPF) --------------------------
CREATE OR REPLACE FUNCTION public.admin_cupom_clientes(p_coupon_id uuid)
RETURNS TABLE (user_id uuid, nome text, email text)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $ler$
BEGIN
  IF NOT (public.is_admin() AND public.is_admin_atual()) THEN
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

REVOKE ALL ON FUNCTION public.admin_cupom_clientes(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_cupom_clientes(uuid) TO authenticated, service_role;

-- 4. A garantia final: o INSERT do pedido ------------------------------------
CREATE OR REPLACE FUNCTION public.pedido_com_cupom_so_nasce_para_a_lista()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $gatilho$
DECLARE
  v_alcance text;
BEGIN
  IF NEW.coupon_id IS NULL THEN
    RETURN NEW;
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
    -- ATALHO DA RETENTATIVA (identico ao do gatilho da chave, 20261203000000):
    -- se este INSERT vai COLIDIR com um pedido que ja existe pela chave de
    -- compra, nao e' um pedido NOVO -- e' a retentativa gemea de um pedido que
    -- nasceu quando a cliente ainda estava na lista. O RETURN NEW deixa o indice
    -- unico agir: o unique_violation cai no tratamento da v23/v24, que devolve o
    -- pedido existente (so ao dono, ou ao convidado). Recusar aqui trocaria esse
    -- retorno por "Tirar o cupom", e a tela giraria a chave e criaria um SEGUNDO
    -- pedido (cobranca e estoque em dobro). O predicado e' o do indice unico
    -- marketplace_orders_chave_da_compra_unica (so a coluna da chave, parcial):
    -- sem chave (NULL) o `=` nunca casa e a recusa vale. Chave de OUTRO cliente
    -- colide no indice, e a v23/v24 so devolve pedido do proprio dono -- nenhum
    -- pedido nasce. SECURITY DEFINER: enxerga a linha que o outro commit acabou
    -- de gravar, sem depender de RLS.
    IF NEW.idempotency_key IS NOT NULL
       AND EXISTS (SELECT 1 FROM public.marketplace_orders WHERE idempotency_key = NEW.idempotency_key) THEN
      RETURN NEW;
    END IF;
    -- A MESMA frase do "nao existe" da v24: o classificador do front
    -- (src/lib/recusaDoPedido.ts) ja leva ao "remover cupom", e a frase nao
    -- revela que o codigo existe para outra pessoa.
    RAISE EXCEPTION 'O cupom % não existe. Confira o código.', NEW.coupon_code;
  END IF;

  RETURN NEW;
END;
$gatilho$;

REVOKE ALL ON FUNCTION public.pedido_com_cupom_so_nasce_para_a_lista() FROM PUBLIC, anon, authenticated;

-- O nome decide a ordem: roda DEPOIS de tr_pedido_com_cupom_exige_a_chave_ligada.
CREATE OR REPLACE TRIGGER tr_pedido_com_cupom_so_nasce_para_a_lista
  BEFORE INSERT ON public.marketplace_orders
  FOR EACH ROW
  WHEN (NEW.coupon_id IS NOT NULL)
  EXECUTE FUNCTION public.pedido_com_cupom_so_nasce_para_a_lista();

COMMENT ON FUNCTION public.pedido_com_cupom_so_nasce_para_a_lista() IS
  'Cupom exclusivo so nasce no pedido de quem esta em cupom_clientes (recusa a frase do nao existe da v24). Com colisao pela chave de compra devolve NEW e deixa o indice unico agir (retentativa gemea). Nao le enable_coupons: isso e do gatilho da 20261203000000, que roda antes.';

-- 5. A validacao antecipada conhece o dono (parte do corpo da 20261203) -------
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
    v_uid uuid := auth.uid();
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

    -- CUPOM EXCLUSIVO (20261208000000): o exclusivo de OUTRA conta (ou de quem nao
    -- tem conta) responde exatamente como "nao existe", ANTES de qualquer outro
    -- motivo -- nem "expirou" nem "faltam R$" revelam que o codigo existe para outra
    -- pessoa. Exclusivo com a lista vazia vale para ninguem (falha fechada).
    IF v_coupon.id IS NULL
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

-- 6. A lista do checkout ------------------------------------------------------
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

REVOKE ALL ON FUNCTION public.cupons_do_checkout(numeric) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cupons_do_checkout(numeric) TO anon, authenticated, service_role;

-- 7. Pos-voo: a migration so termina se as pecas estao de pe -----------------
DO $posvoo_20261208$
DECLARE
  v_hash text;
  v_gatilhos text;
BEGIN
  SELECT encode(sha256(convert_to(prosrc, 'UTF8')), 'hex') INTO v_hash
    FROM pg_proc
   WHERE oid = to_regprocedure('public.validate_coupon_secure_v2(text, numeric)');
  IF v_hash IS NULL OR v_hash NOT IN (
    'c33e930ca389b3568bd256f9363ace8fd3935f0ac73851441e0684a374b11037',
    'fdfacc20cc3bc2a691ad8961c525e5cb77071b7d5e9e590a7470e45690a2df3a'
  ) THEN
    RAISE EXCEPTION 'POSVOO_20261208: validate_coupon_secure_v2 nao ficou com o corpo desta migration (hash %).', COALESCE(v_hash, 'ausente');
  END IF;

  -- O gatilho novo existe, e' BEFORE INSERT FOR EACH ROW, esta ativo, e roda
  -- DEPOIS do gatilho da chave (os gatilhos do mesmo tipo disparam em ordem de nome).
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
     WHERE tgrelid = 'public.marketplace_orders'::regclass
       AND tgname = 'tr_pedido_com_cupom_so_nasce_para_a_lista'
       AND tgenabled = 'O' AND NOT tgisinternal
       AND (tgtype & 1) = 1 AND (tgtype & 2) = 2 AND (tgtype & 4) = 4
  ) THEN
    RAISE EXCEPTION 'POSVOO_20261208: o gatilho tr_pedido_com_cupom_so_nasce_para_a_lista nao esta ativo (BEFORE INSERT FOR EACH ROW) em marketplace_orders.';
  END IF;
  SELECT string_agg(tgname, ' < ' ORDER BY tgname COLLATE "C") INTO v_gatilhos
    FROM pg_trigger
   WHERE tgrelid = 'public.marketplace_orders'::regclass AND NOT tgisinternal
     AND (tgtype & 2) = 2 AND (tgtype & 4) = 4
     AND tgname IN ('tr_pedido_com_cupom_exige_a_chave_ligada', 'tr_pedido_com_cupom_so_nasce_para_a_lista');
  IF v_gatilhos IS DISTINCT FROM 'tr_pedido_com_cupom_exige_a_chave_ligada < tr_pedido_com_cupom_so_nasce_para_a_lista' THEN
    RAISE EXCEPTION 'POSVOO_20261208: a ordem dos gatilhos de cupom nao e a esperada (%).', v_gatilhos;
  END IF;

  -- Permissoes: a lista e' do publico; o painel so do usuario logado; o gatilho de ninguem.
  IF NOT has_function_privilege('anon', 'public.cupons_do_checkout(numeric)', 'EXECUTE')
     OR NOT has_function_privilege('authenticated', 'public.cupons_do_checkout(numeric)', 'EXECUTE') THEN
    RAISE EXCEPTION 'POSVOO_20261208: cupons_do_checkout sem EXECUTE para anon/authenticated.';
  END IF;
  IF has_function_privilege('anon', 'public.admin_cupom_definir_clientes(uuid, uuid[])', 'EXECUTE')
     OR has_function_privilege('anon', 'public.admin_cupom_clientes(uuid)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.pedido_com_cupom_so_nasce_para_a_lista()', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.pedido_com_cupom_so_nasce_para_a_lista()', 'EXECUTE') THEN
    RAISE EXCEPTION 'POSVOO_20261208: funcao do painel ou do gatilho alcancavel por anon/authenticated.';
  END IF;
  IF EXISTS (
    SELECT 1
      FROM pg_proc p
      CROSS JOIN LATERAL aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) a
     WHERE p.oid IN (
             to_regprocedure('public.admin_cupom_definir_clientes(uuid, uuid[])'),
             to_regprocedure('public.admin_cupom_clientes(uuid)'),
             to_regprocedure('public.pedido_com_cupom_so_nasce_para_a_lista()'),
             to_regprocedure('public.cupons_do_checkout(numeric)')
           )
       AND a.grantee = 0 AND a.privilege_type = 'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'POSVOO_20261208: alguma funcao nova ficou com EXECUTE para PUBLIC.';
  END IF;
  IF has_table_privilege('authenticated', 'public.cupom_clientes', 'INSERT')
     OR has_table_privilege('authenticated', 'public.cupom_clientes', 'UPDATE')
     OR has_table_privilege('authenticated', 'public.cupom_clientes', 'DELETE')
     OR has_table_privilege('anon', 'public.cupom_clientes', 'SELECT')
     OR NOT EXISTS (SELECT 1 FROM pg_class WHERE oid = 'public.cupom_clientes'::regclass AND relrowsecurity) THEN
    RAISE EXCEPTION 'POSVOO_20261208: cupom_clientes com grant alem da leitura do admin, ou sem RLS.';
  END IF;

  -- Todo cupom que ja existe nasce SECRETO: o default e' quem garante.
  IF (SELECT column_default FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'coupons'
         AND column_name = 'alcance') IS DISTINCT FROM '''codigo''::text' THEN
    RAISE EXCEPTION 'POSVOO_20261208: coupons.alcance nao nasce ''codigo''.';
  END IF;
END $posvoo_20261208$;
