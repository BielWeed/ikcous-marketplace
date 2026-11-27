-- ============================================================================
-- Migration 20261642000000 — a peça que volta sem tamanho espera a lojista (estoque; troca o corpo de DUAS funções e CRIA uma tabela e duas RPCs)
-- ============================================================================
--
-- 1. O DEFEITO (caça confirmada, 27/11/2026)
--
-- Produto sem tamanhos vende 1 peça. Depois a lojista cria a grade P/M/G (a 1a variação herda o estoque do pai, AdminProductFormView).
-- Quando o pedido antigo (item SEM variação) volta — Pix vencido, cancelamento ou anulação (devolver_estoque, corpo da 20261389100000)
-- ou devolução concluída com "voltar ao estoque" (admin_devolucao_concluir, corpo da 20261395200000) — o banco credita produtos.estoque,
-- o estoque do PAI. Só que o pai não vende mais: a compra exige variação quando o produto tem alguma ligada (create_marketplace_order_v24,
-- "Escolha uma variação") e a vitrine soma as variações. A peça some do que está à venda, sem aviso para ninguém.
--
-- 2. A REGRA NOVA (decisão do sócio, aprovada: o "cantinho a endereçar")
--
-- Item SEM variação de um produto que, NA HORA da volta, tem pelo menos uma variação LIGADA (o MESMO predicado da compra:
-- product_variants.product_id = produto AND active = true): cada unidade vira UMA linha em public.pecas_sem_tamanho, com o pedido de
-- origem, e NÃO é creditada no pai. A lojista escolhe no painel em qual tamanho ela entra (resolver_peca_sem_tamanho, que credita a
-- variação) ou diz que não tem a peça (a linha fecha como 'descartada', nada é creditado).
-- Item sem variação de produto SEM variação ligada (ou sem produto): comportamento IDÊNTICO ao de hoje (credita o pai; produto nulo
-- continua sem crédito). Item COM variação: idêntico (credita a variação). Nada de dinheiro muda.
-- As unidades que esperam NÃO entram no retorno "creditadas" de devolver_estoque nem em 'reestocados' de admin_devolucao_concluir (não
-- estão à venda); a conclusão da devolução devolve a chave nova 'sem_tamanho' com quantas foram para o cantinho. O carimbo de reestoque
-- do item da devolução (devolucao_itens.reestocado_em) é gravado do mesmo jeito: a peça VOLTOU para a loja, e o cancelamento posterior do
-- mesmo pedido (achado C, devolver_estoque) continua descontando-a, sem dobrar.
--
-- 3. O QUE MUDA NO CORPO DAS DUAS FUNÇÕES (só isto; o resto não muda um byte)
--
--   devolver_estoque (corpo da 20261389100000): um ramo ELSIF entre o da variação e o do pai, marcado ">>> a peca que volta sem tamanho
--   (20261642000000)". Ele insere as unidades e faz CONTINUE (não soma em v_unidades).
--   admin_devolucao_concluir (corpo da 20261395200000): uma variável (v_sem_tamanho), um ramo ELSIF igual (com devolucao_item_id e
--   origem 'devolucao') e o retorno: 'reestocados' passa a descontar v_sem_tamanho e ganha 'sem_tamanho'.
--   Assinatura, SECURITY DEFINER, VOLATILE, search_path, retorno, comentário, OID, dono e ACL das duas NÃO mudam.
--
-- 4. O QUE CRIA
--
--   (a) TABELA public.pecas_sem_tamanho (uma linha por PEÇA): produto, pedido e item de origem, item da devolução (quando veio por ela),
--       origem ('pedido_desfeito' | 'devolucao'), criada_em e, ao resolver, resolvida_em, resolucao ('reposta' | 'descartada'),
--       variant_id (só em 'reposta') e resolvida_por. RLS ligada SEM política e NENHUM privilégio para PUBLIC, anon, authenticated nem
--       service_role: só as funções SECURITY DEFINER abaixo leem e escrevem. Índice parcial das pendentes por produto.
--   (b) RPC public.pecas_sem_tamanho_pendentes(p_produto_id uuid DEFAULT NULL): as peças que esperam (de um produto, ou de todos com
--       NULL), da mais antiga para a mais nova. Só o admin de AGORA (is_admin() e is_admin_atual(), as portas do painel da
--       20261199000000); EXECUTE só do authenticated.
--   (c) RPC public.resolver_peca_sem_tamanho(p_peca_id uuid, p_variant_id uuid): p_variant_id = o tamanho em que a peça entra (variação
--       LIGADA do MESMO produto; credita +1 em stock_increment) ou NULL = "não tenho essa peça" (fecha como 'descartada'). Trava na ordem
--       global do estoque (variação -> produto -> a linha da peça) e é IDEMPOTENTE: a peça já resolvida devolve a resolução que já
--       existe (ja_resolvida: true) sem creditar nada — dois toques não creditam duas vezes. Mesmas portas e EXECUTE de (b).
--       O crédito na variação dispara o gatilho sync_produto_ultima_atualizacao: a versão do produto avança, e o Salvar de uma tela
--       aberta antes (conferência de versão de salvar_produto_com_grade / updateProduct) recusa em vez de sobrescrever o estoque novo.
--
-- 5. DADOS EXISTENTES
--
-- Nenhuma linha existente é lida para fora, reescrita ou apagada no apply. A tabela nasce VAZIA. Pedidos e devoluções que já voltaram
-- antes desta migration ficam como estão (o crédito que já foi para o pai não é mexido). Só as voltas DEPOIS do apply seguem a regra nova.
--
-- 6. PRÉ-VOO (B1_BASELINE_DIVERGENT, ANTES de qualquer escrita)
--
-- Recusa se: o corpo vivo de devolver_estoque não for o da 20261389100000 nem o desta; o de admin_devolucao_concluir não for o da
-- 20261395200000 nem o desta; os atributos ou a ACL de qualquer uma não forem os de sempre; faltar coluna que os corpos leem;
-- is_admin()/is_admin_atual() não existirem; a tabela já existir com outra forma; uma RPC nova já existir com outro corpo ou sobrecarga.
-- Fotografa OID, dono, ACL e atributos das duas funções que mudam para o pós-voo.
--
-- 7. IDEMPOTÊNCIA, TRANSAÇÃO E TRAVA
--
-- CREATE TABLE/INDEX IF NOT EXISTS, CREATE OR REPLACE, REVOKE/GRANT explícitos: rodar duas vezes deixa o mesmo estado (o pré-voo aceita
-- o que esta migration deixa). SEM BEGIN/COMMIT (regra da casa, AGENTS.md: o aplicador dá a transação e o conferirCorpo do
-- aplicar-migrations.yml RECUSA controle de transação no topo do arquivo); pré-voo, criações e pós-voo caem juntos ou não caem.
-- lock_timeout = 5s: CREATE OR REPLACE espera o catálogo e o FK de produtos/pedidos pede trava curta; melhor falhar e reaplicar.
--
-- 8. ORDEM
--
-- DEPOIS da 20261389100000 e da 20261395200000 (o pré-voo recusa sem elas) e da 20261197000000 (is_admin_atual). BANCO ANTES DO FRONT em
-- CADA loja: o painel novo chama as duas RPCs; sem elas o aviso não aparece (a leitura falha e o painel segue sem o aviso).
--
-- 9. FICHA DE VERIFICAÇÃO: consultas 201a (depois) / 201b (antes).
--   PROVA VIVA: tests/banco/a-peca-que-volta-sem-tamanho-viva.cjs (rpc-ci).
--
-- 10. ROLLBACK
--
-- rollback-manual-20261642000000_a_peca_que_volta_sem_tamanho_espera_a_lojista.sql devolve os DOIS corpos byte a byte (o da 20261389100000
-- e o da 20261395200000), apaga as duas RPCs e MANTÉM a tabela com as linhas (apagar dado é decisão do dono). Vem ANTES do rollback da
-- 20261395200000 e do da 20261389100000 (os pré-voos deles recusam o corpo desta). Desfazer o FRONT antes.
-- ============================================================================

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

DO $preflight_20261642000000$
DECLARE
  v_dev oid := to_regprocedure('public.devolver_estoque(uuid)');
  v_concl oid := to_regprocedure('public.admin_devolucao_concluir(uuid,text,jsonb,numeric,text)');
  v_hash text;
  v_forma text;
  v_fn text;
BEGIN
  -- devolver_estoque: o corpo da 20261389100000 ou o desta; atributos e ACL de sempre (EXECUTE nunca de anon, authenticated nem PUBLIC).
  SELECT md5(replace(prosrc, E'\r', '')) INTO v_hash FROM pg_proc WHERE oid = v_dev;
  IF v_hash IS NULL OR v_hash NOT IN ('943b226906e91013e7cccf4992617e35', '80b1a90baf10d1b4c59484772e4864c4') THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: public.devolver_estoque(uuid) (hash %) nao e o corpo da 20261389100000 nem o desta migration; revise antes de aplicar.', COALESCE(v_hash, 'ausente');
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_language l ON l.oid = p.prolang
     WHERE p.oid = v_dev
       AND p.prokind = 'f' AND p.prosecdef AND p.proconfig = ARRAY['search_path=public']::text[]
       AND p.provolatile = 'v' AND NOT p.proisstrict AND NOT p.proretset
       AND l.lanname = 'plpgsql' AND p.prorettype = 'integer'::regtype
       AND pg_get_function_arguments(p.oid) = 'p_order_id uuid'
       AND (SELECT count(*) FROM pg_proc q WHERE q.pronamespace = 'public'::regnamespace AND q.proname = 'devolver_estoque') = 1
       AND NOT has_function_privilege('anon', p.oid, 'EXECUTE')
       AND NOT has_function_privilege('authenticated', p.oid, 'EXECUTE')
       AND NOT EXISTS (SELECT 1 FROM aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) a
                        WHERE a.grantee = 0 AND a.privilege_type = 'EXECUTE')
  ) THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: devolver_estoque tem assinatura, atributos ou permissoes diferentes dos esperados; revise antes de aplicar.';
  END IF;

  -- admin_devolucao_concluir: o corpo da 20261395200000 ou o desta; atributos e ACL de sempre (authenticated e service_role sim; anon e PUBLIC nao).
  IF v_concl IS NULL
     OR (SELECT count(*) FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname = 'admin_devolucao_concluir') <> 1 THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: admin_devolucao_concluir ausente ou com sobrecarga em public; revise antes de aplicar.';
  END IF;
  SELECT md5(replace(prosrc, E'\r', '')) INTO v_hash FROM pg_proc WHERE oid = v_concl;
  -- anterior = o corpo da 20261395200000; desta = o que ESTA migration deixa (reaplicacao idempotente).
  IF v_hash IS NULL OR v_hash NOT IN (
       SELECT unnest(ARRAY[esperado.anterior, esperado.desta]) FROM (VALUES
         ('public.admin_devolucao_concluir(uuid,text,jsonb,numeric,text)', 'a152c8dcd7cf6d1e05e5aff128d6c45e', '1a548896acb8248f1b1771d765c92fcb')
       ) esperado(assinatura, anterior, desta)) THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: admin_devolucao_concluir (hash %) nao e o corpo da 20261395200000 nem o desta migration; revise antes de aplicar.', COALESCE(v_hash, 'ausente');
  END IF;
  IF NOT EXISTS (
       SELECT 1 FROM pg_proc p JOIN pg_language l ON l.oid = p.prolang
        WHERE p.oid = v_concl
          AND l.lanname = 'plpgsql'
          AND p.prokind = 'f'
          AND p.prosecdef
          AND p.provolatile = 'v'
          AND NOT p.proisstrict
          AND p.pronargs = 5
          AND p.proconfig = ARRAY['search_path=public']::text[]
          AND pg_get_function_arguments(p.oid) = 'p_id uuid, p_resolucao text, p_itens jsonb, p_valor_reembolso numeric DEFAULT NULL::numeric, p_observacao text DEFAULT NULL::text'
          AND pg_get_function_result(p.oid) = 'jsonb'
     )
     OR EXISTS (SELECT 1 FROM pg_proc p
                  CROSS JOIN LATERAL aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) g
                 WHERE p.oid = v_concl AND g.privilege_type = 'EXECUTE' AND g.grantee = 0)
     OR has_function_privilege('anon', v_concl, 'EXECUTE')
     OR NOT has_function_privilege('authenticated', v_concl, 'EXECUTE')
     OR NOT has_function_privilege('service_role', v_concl, 'EXECUTE') THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: admin_devolucao_concluir tem atributos ou ACL diferentes dos conhecidos; revise antes de aplicar.';
  END IF;

  -- As portas do painel (20261197000000) e as colunas que os corpos leem e escrevem.
  IF to_regprocedure('public.is_admin()') IS NULL OR to_regprocedure('public.is_admin_atual()') IS NULL THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: public.is_admin() ou public.is_admin_atual() nao existe; aplique a 20261197000000 antes.';
  END IF;
  IF (SELECT count(*) FROM pg_attribute a
       WHERE NOT a.attisdropped
         AND ((a.attrelid = to_regclass('public.produtos') AND a.attname = 'id' AND a.atttypid = 'uuid'::regtype)
           OR (a.attrelid = to_regclass('public.marketplace_orders') AND a.attname = 'id' AND a.atttypid = 'uuid'::regtype)
           OR (a.attrelid = to_regclass('public.product_variants') AND a.attname IN ('id', 'product_id') AND a.atttypid = 'uuid'::regtype)
           OR (a.attrelid = to_regclass('public.product_variants') AND a.attname = 'active' AND a.atttypid = 'boolean'::regtype)
           OR (a.attrelid = to_regclass('public.product_variants') AND a.attname = 'stock_increment' AND a.atttypid = 'integer'::regtype)
           OR (a.attrelid = to_regclass('public.devolucao_itens') AND a.attname IN ('id', 'order_item_id', 'product_id') AND a.atttypid = 'uuid'::regtype)
           OR (a.attrelid = to_regclass('public.devolucao_itens') AND a.attname = 'quantidade' AND a.atttypid = 'integer'::regtype))) <> 10 THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: produtos, marketplace_orders, product_variants (id, product_id, active, stock_increment) ou devolucao_itens (id, order_item_id, product_id, quantidade) nao tem a forma esperada; nada foi alterado.';
  END IF;

  -- A tabela nova: ausente, ou exatamente a desta migration (colunas, tipos e NOT NULL, por nome).
  IF to_regclass('public.pecas_sem_tamanho') IS NOT NULL THEN
    SELECT string_agg(a.attname || ':' || format_type(a.atttypid, a.atttypmod) || ':' || a.attnotnull::text, ',' ORDER BY a.attname)
      INTO v_forma
      FROM pg_attribute a
     WHERE a.attrelid = to_regclass('public.pecas_sem_tamanho') AND a.attnum > 0 AND NOT a.attisdropped;
    IF v_forma IS DISTINCT FROM 'criada_em:timestamp with time zone:true,devolucao_item_id:uuid:false,id:uuid:true,order_id:uuid:false,order_item_id:uuid:false,origem:text:true,produto_id:uuid:true,resolucao:text:false,resolvida_em:timestamp with time zone:false,resolvida_por:uuid:false,variant_id:uuid:false' THEN
      RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: public.pecas_sem_tamanho ja existe com outra forma (%); revise antes de aplicar.', v_forma;
    END IF;
  END IF;

  -- As RPCs novas: ausentes, ou exatamente as desta migration (sem sobrecarga).
  FOREACH v_fn IN ARRAY ARRAY['pecas_sem_tamanho_pendentes', 'resolver_peca_sem_tamanho'] LOOP
    IF (SELECT count(*) FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname = v_fn) > 1 THEN
      RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: % tem sobrecarga em public; revise antes de aplicar.', v_fn;
    END IF;
  END LOOP;
  IF EXISTS (SELECT 1 FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname = 'pecas_sem_tamanho_pendentes')
     AND (SELECT md5(replace(prosrc, E'\r', '')) FROM pg_proc WHERE oid = to_regprocedure('public.pecas_sem_tamanho_pendentes(uuid)'))
         IS DISTINCT FROM 'd6a9047fe26305d0c1446c284033245d' THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: pecas_sem_tamanho_pendentes ja existe com outra assinatura ou corpo; revise antes de aplicar.';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname = 'resolver_peca_sem_tamanho')
     AND (SELECT md5(replace(prosrc, E'\r', '')) FROM pg_proc WHERE oid = to_regprocedure('public.resolver_peca_sem_tamanho(uuid,uuid)'))
         IS DISTINCT FROM 'cac3d04d9be77c7d4004003bb70561c5' THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: resolver_peca_sem_tamanho ja existe com outra assinatura ou corpo; revise antes de aplicar.';
  END IF;

  -- Fotografia: OID, dono, ACL e TODOS os atributos (o CREATE OR REPLACE so pode trocar o texto).
  PERFORM set_config('ikcous.peca642_devolver', (SELECT to_jsonb(p) - 'prosrc' FROM pg_proc p WHERE p.oid = v_dev)::text, true);
  PERFORM set_config('ikcous.peca642_concluir', (SELECT to_jsonb(p) - 'prosrc' FROM pg_proc p WHERE p.oid = v_concl)::text, true);
END $preflight_20261642000000$;

-- ---------------------------------------------------------------------------
-- 1. O cantinho: uma linha por peça que voltou sem tamanho
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.pecas_sem_tamanho (
  id uuid PRIMARY KEY DEFAULT extensions.uuid_generate_v4(),
  produto_id uuid NOT NULL REFERENCES public.produtos (id) ON DELETE CASCADE,
  order_id uuid REFERENCES public.marketplace_orders (id) ON DELETE SET NULL,
  order_item_id uuid,
  devolucao_item_id uuid,
  origem text NOT NULL CHECK (origem IN ('pedido_desfeito', 'devolucao')),
  criada_em timestamptz NOT NULL DEFAULT now(),
  resolvida_em timestamptz,
  resolucao text CHECK (resolucao IN ('reposta', 'descartada')),
  variant_id uuid,
  resolvida_por uuid,
  CONSTRAINT pecas_sem_tamanho_resolucao_coerente CHECK (
    (resolvida_em IS NULL AND resolucao IS NULL AND variant_id IS NULL)
    OR (resolvida_em IS NOT NULL AND resolucao = 'descartada' AND variant_id IS NULL)
    OR (resolvida_em IS NOT NULL AND resolucao = 'reposta' AND variant_id IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS idx_pecas_sem_tamanho_pendentes
  ON public.pecas_sem_tamanho (produto_id)
  WHERE resolvida_em IS NULL;

ALTER TABLE public.pecas_sem_tamanho ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.pecas_sem_tamanho FROM PUBLIC, anon, authenticated, service_role;

COMMENT ON TABLE public.pecas_sem_tamanho IS
  'Peças que voltaram (pedido desfeito ou devolução concluída com "voltar ao estoque") SEM variação, de um produto que na hora da volta já tinha variação ligada: o estoque do pai não vende mais, então cada unidade espera aqui a lojista escolher o tamanho (resolver_peca_sem_tamanho) ou dizer que não tem a peça (20261642000000). RLS sem política e nenhum privilégio de aplicação: só as funções SECURITY DEFINER leem e escrevem.';

-- ---------------------------------------------------------------------------
-- 2. devolver_estoque: o corpo da 20261389100000 + o ramo da peça sem tamanho
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.devolver_estoque(p_order_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $devolver$
DECLARE
    v_item     RECORD;
    v_unidades integer := 0;
    v_ganhou   boolean;
    v_credito  integer;
    -- 20261389100000: ids a trancar de uma vez, na ordem global (bloco abaixo).
    v_trava_variantes uuid[];
    v_trava_produtos  uuid[];
BEGIN
    -- Reclama o carimbo ANTES de creditar. Quem perder a corrida (ou quem
    -- chegar de novo — a oscilação de status, o reenvio do webhook, o duplo
    -- clique do lojista) recebe 0 sem tocar na prateleira. Dentro da mesma
    -- transação do chamador: se o chamador abortar depois, o carimbo volta
    -- junto (ROLLBACK), e a próxima tentativa honesta ainda credita.
    UPDATE public.marketplace_orders
       SET stock_returned_at = now()
     WHERE id = p_order_id
       AND stock_returned_at IS NULL
    RETURNING true INTO v_ganhou;

    IF v_ganhou IS NOT TRUE THEN
        RETURN 0;
    END IF;

    -- >>> ordem global das travas (20261389100000)
    -- A MESMA ordem da compra (20261350000000): primeiro TODAS as variacoes do pedido, por id; depois TODOS
    -- os produtos, por id, cada grupo num unico SELECT ... ORDER BY id FOR NO KEY UPDATE. Sem isto o laco
    -- abaixo trancava na ORDEM DOS ITENS (produto ou variacao de cada item, e o gatilho
    -- sync_produto_ultima_atualizacao ainda tranca o produto-pai de cada variacao logo depois dela): um
    -- pedido que expira ou cancela com os itens em ordem contraria a de uma compra que acontece ao mesmo
    -- tempo cruzava travas com ela e o banco derrubava um dos dois com 40P01. So muda QUANDO as travas sao
    -- tomadas, nunca quais linhas se alteram nem quanto se credita: o laco seguinte acha tudo ja trancado.
    -- Os produtos a trancar sao os dos itens e os pais das variacoes (e' o que o gatilho tocaria).
    SELECT COALESCE(array_agg(DISTINCT oi.variant_id) FILTER (WHERE oi.variant_id IS NOT NULL), ARRAY[]::uuid[])
      INTO v_trava_variantes
      FROM public.marketplace_order_items oi
     WHERE oi.order_id = p_order_id;

    IF cardinality(v_trava_variantes) > 0 THEN
        PERFORM 1
          FROM public.product_variants v
         WHERE v.id = ANY(v_trava_variantes)
         ORDER BY v.id
           FOR NO KEY UPDATE;
    END IF;

    SELECT COALESCE(array_agg(DISTINCT x.product_id) FILTER (WHERE x.product_id IS NOT NULL), ARRAY[]::uuid[])
      INTO v_trava_produtos
      FROM (
            SELECT oi.product_id
              FROM public.marketplace_order_items oi
             WHERE oi.order_id = p_order_id
            UNION
            SELECT v.product_id
              FROM public.product_variants v
             WHERE v.id = ANY(v_trava_variantes)
           ) x;

    IF cardinality(v_trava_produtos) > 0 THEN
        PERFORM 1
          FROM public.produtos p
         WHERE p.id = ANY(v_trava_produtos)
         ORDER BY p.id
           FOR NO KEY UPDATE;
    END IF;
    -- <<< ordem global das travas (20261389100000)

    FOR v_item IN
        SELECT oi.id, oi.product_id, oi.variant_id, oi.quantity,
               -- Achado C: o que uma devolução já concluída reestocou deste
               -- MESMO item de pedido não credita de novo aqui.
               COALESCE((SELECT sum(di.quantidade) FROM public.devolucao_itens di
                           WHERE di.order_item_id = oi.id AND di.reestocado_em IS NOT NULL), 0) AS ja_reestocado
        FROM public.marketplace_order_items oi
        WHERE oi.order_id = p_order_id
    LOOP
        v_credito := GREATEST(v_item.quantity - v_item.ja_reestocado, 0);
        IF v_credito = 0 THEN
            CONTINUE;
        END IF;

        -- IF/ELSE, não dois IF: a v23 debita XOR (variante OU produto, nunca os
        -- dois), e o front manda product_id preenchido junto com variant_id. Com
        -- dois IF, todo pedido de variante que expirasse creditaria o produto pai
        -- também, inflando o catalogo para sempre. Mesma forma do restore que ja
        -- existe em update_order_status_atomic.
        IF v_item.variant_id IS NOT NULL THEN
            UPDATE public.product_variants
               SET stock_increment = stock_increment + v_credito
             WHERE id = v_item.variant_id;
        -- >>> a peca que volta sem tamanho (20261642000000)
        -- Item SEM variacao de um produto que HOJE tem variacao ligada (vendido antes da grade): a compra exige variacao e a
        -- vitrine soma as variacoes, entao o estoque do pai nao vende mais. Cada unidade espera a lojista em pecas_sem_tamanho
        -- (ela escolhe o tamanho no painel) e NAO conta como creditada. Mesmo predicado da compra (variacao com active = true).
        -- O produto ja esta trancado pelo bloco da ordem global acima.
        ELSIF EXISTS (SELECT 1 FROM public.product_variants v
                       WHERE v.product_id = v_item.product_id AND v.active = true) THEN
            INSERT INTO public.pecas_sem_tamanho (produto_id, order_id, order_item_id, origem)
            SELECT v_item.product_id, p_order_id, v_item.id, 'pedido_desfeito'
              FROM generate_series(1, v_credito);
            CONTINUE;
        -- <<< a peca que volta sem tamanho (20261642000000)
        ELSE
            UPDATE public.produtos
               SET estoque = estoque + v_credito
             WHERE id = v_item.product_id;
        END IF;

        v_unidades := v_unidades + v_credito;
    END LOOP;

    RETURN v_unidades;
END;
$devolver$;

-- ---------------------------------------------------------------------------
-- 3. admin_devolucao_concluir: o corpo da 20261395200000 + o ramo da peça sem tamanho
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_devolucao_concluir(
  p_id uuid,
  p_resolucao text,
  p_itens jsonb,
  p_valor_reembolso numeric DEFAULT NULL,
  p_observacao text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_d public.devolucoes%ROWTYPE;
  v_o public.marketplace_orders%ROWTYPE;
  v_item jsonb;
  v_di public.devolucao_itens%ROWTYPE;
  v_condicao text;
  v_reestocar boolean;
  v_reestocados integer := 0;
  v_valor numeric(12, 2);
  v_disponivel numeric(12, 2);
  v_pago_pelo_app boolean;
  v_refund_id uuid;
  v_manual boolean := false;
  -- 20261395200000: ids a trancar de uma vez, na ordem global (bloco abaixo).
  v_trava_variantes uuid[];
  v_trava_produtos uuid[];
  -- 20261642000000: unidades que foram para o cantinho das pecas sem tamanho (nao creditadas).
  v_sem_tamanho integer := 0;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Acesso negado.' USING ERRCODE = '42501';
  END IF;
  -- Papel ATUAL (auth.users E profiles), não o do JWT: admin rebaixado para aqui (20261197000000).
  IF NOT public.is_admin_atual() THEN
    RAISE EXCEPTION 'Acesso negado.' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_d FROM public.devolucoes WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Devolução não encontrada.' USING ERRCODE = 'P0002';
  END IF;
  IF v_d.status <> 'recebida' THEN
    RAISE EXCEPTION 'Conclua a devolução depois de receber o produto.' USING ERRCODE = '22023';
  END IF;
  IF p_resolucao IS NULL OR p_resolucao NOT IN ('reembolso', 'troca', 'vale') THEN
    RAISE EXCEPTION 'Escolha a resolução: reembolso, troca ou vale-troca.' USING ERRCODE = '22023';
  END IF;
  IF p_resolucao = 'reembolso' AND v_d.tipo = 'troca' THEN
    RAISE EXCEPTION 'Devolução por troca de política não gera reembolso. Use troca ou vale-troca.' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_o FROM public.marketplace_orders WHERE id = v_d.order_id FOR UPDATE;

  -- Achado H (revisão de 26/09/2026): o lock não bastava — a devolução podia
  -- concluir mesmo depois de o PEDIDO ter mudado de vida por outro caminho
  -- (admin cancela + registrar_estorno_manual enquanto a devolução está
  -- 'recebida', ou o estoque já voltou pelo cancelamento). Sem isto: venda de
  -- balcão de R$100, devolução concluída com reembolso, pedido cancelado e
  -- estornado por fora → 200 saem por uma venda de 100, e o estoque credita
  -- de novo (achado C, ver devolver_estoque logo abaixo).
  IF v_o.status <> 'delivered' THEN
    RAISE EXCEPTION 'O pedido desta devolução não está mais entregue (status atual: %). Fale com o financeiro antes de concluir.',
      v_o.status USING ERRCODE = '22023';
  END IF;
  IF v_o.payment_status IS NULL
     OR v_o.payment_status NOT IN ('pago', 'pago_apos_expirar', 'recebido_na_entrega') THEN
    RAISE EXCEPTION 'Este pedido não tem pagamento registrado para devolver.' USING ERRCODE = '22023';
  END IF;
  -- Achado 4 (revisão 26/09/2026, rodada 2): stock_returned_at NÃO É só
  -- "cancelou depois da devolução" — a política P1 (pago após expirar,
  -- HONRAR) reativa pedido expirado (devolver_estoque já carimbou) até
  -- 'delivered' de verdade, e esse carimbo nunca some. Recusar a conclusão
  -- inteira aqui prendia esses pedidos para sempre, sem devolução possível.
  -- A trava certa é só no REESTOQUE (abaixo, força reestocar=false) — a
  -- resolução (reembolso/troca/vale) segue normal.

  -- >>> ordem global das travas (20261395200000)
  -- A MESMA ordem da compra (create_marketplace_order_v23/v24) e do estoque que volta (devolver_estoque, 20261389100000): primeiro
  -- TODAS as variacoes, por id, depois TODOS os produtos, por id, cada grupo num unico SELECT ... ORDER BY id FOR NO KEY UPDATE.
  -- O laco abaixo trancava na ORDEM EM QUE O PAINEL MANDOU os itens (a variacao de cada item e, pelo gatilho
  -- sync_produto_ultima_atualizacao, o produto-pai logo depois): uma compra aberta ao mesmo tempo, com as mesmas variacoes, cruzava
  -- travas com esta conclusao e o banco derrubava uma das duas com 40P01. So muda QUANDO as travas sao tomadas, nunca quais linhas
  -- se alteram nem quanto se credita: o laco seguinte acha tudo ja trancado. So se tranca o que o laco PODE creditar: pedido com o
  -- carimbo stock_returned_at nunca recredita (v_reestocar sai falso) e item ja reestocado tambem nao.
  IF v_o.stock_returned_at IS NULL THEN
    SELECT COALESCE(array_agg(DISTINCT di.variant_id) FILTER (WHERE di.variant_id IS NOT NULL), ARRAY[]::uuid[])
      INTO v_trava_variantes
      FROM public.devolucao_itens di
     WHERE di.devolucao_id = p_id AND di.reestocado_em IS NULL;
    IF cardinality(v_trava_variantes) > 0 THEN
      PERFORM 1
        FROM public.product_variants v
       WHERE v.id = ANY(v_trava_variantes)
       ORDER BY v.id
         FOR NO KEY UPDATE;
    END IF;
    SELECT COALESCE(array_agg(DISTINCT x.product_id) FILTER (WHERE x.product_id IS NOT NULL), ARRAY[]::uuid[])
      INTO v_trava_produtos
      FROM (
            SELECT di.product_id
              FROM public.devolucao_itens di
             WHERE di.devolucao_id = p_id AND di.reestocado_em IS NULL
            UNION
            SELECT v.product_id
              FROM public.product_variants v
             WHERE v.id = ANY(v_trava_variantes)
           ) x;
    IF cardinality(v_trava_produtos) > 0 THEN
      PERFORM 1
        FROM public.produtos p
       WHERE p.id = ANY(v_trava_produtos)
       ORDER BY p.id
         FOR NO KEY UPDATE;
    END IF;
  END IF;
  -- <<< ordem global das travas (20261395200000)

  -- Inspeção e reestoque por item (uma vez só por item).
  FOR v_item IN SELECT * FROM jsonb_array_elements(COALESCE(p_itens, '[]'::jsonb)) LOOP
    SELECT * INTO v_di FROM public.devolucao_itens
     WHERE id = NULLIF(v_item ->> 'item_id', '')::uuid AND devolucao_id = p_id FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Item não pertence a esta devolução.' USING ERRCODE = '22023';
    END IF;
    v_condicao := v_item ->> 'condicao';
    IF v_condicao IS NULL OR v_condicao NOT IN ('nova', 'usada', 'danificada', 'ausente') THEN
      RAISE EXCEPTION 'Informe a condição de cada item recebido.' USING ERRCODE = '22023';
    END IF;
    v_reestocar := COALESCE((v_item ->> 'reestocar')::boolean, false) AND v_condicao <> 'ausente'
                   AND v_o.stock_returned_at IS NULL;

    UPDATE public.devolucao_itens SET condicao = v_condicao, reestocar = v_reestocar WHERE id = v_di.id;

    IF v_reestocar AND v_di.reestocado_em IS NULL THEN
      IF v_di.variant_id IS NOT NULL THEN
        UPDATE public.product_variants SET stock_increment = stock_increment + v_di.quantidade
         WHERE id = v_di.variant_id;
      -- >>> a peca que volta sem tamanho (20261642000000)
      -- Item SEM variacao de um produto que HOJE tem variacao ligada: o estoque do pai nao vende mais. Cada unidade espera a
      -- lojista em pecas_sem_tamanho; o carimbo reestocado_em abaixo e' gravado do mesmo jeito (a peca VOLTOU, e o cancelamento
      -- posterior do pedido a desconta, achado C). O produto ja esta trancado pelo bloco da ordem global acima.
      ELSIF v_di.product_id IS NOT NULL
            AND EXISTS (SELECT 1 FROM public.product_variants v
                         WHERE v.product_id = v_di.product_id AND v.active = true) THEN
        INSERT INTO public.pecas_sem_tamanho (produto_id, order_id, order_item_id, devolucao_item_id, origem)
        SELECT v_di.product_id, v_d.order_id, v_di.order_item_id, v_di.id, 'devolucao'
          FROM generate_series(1, v_di.quantidade);
        v_sem_tamanho := v_sem_tamanho + v_di.quantidade;
      -- <<< a peca que volta sem tamanho (20261642000000)
      ELSIF v_di.product_id IS NOT NULL THEN
        UPDATE public.produtos SET estoque = estoque + v_di.quantidade WHERE id = v_di.product_id;
      END IF;
      UPDATE public.devolucao_itens SET reestocado_em = now() WHERE id = v_di.id;
      v_reestocados := v_reestocados + v_di.quantidade;
    END IF;
  END LOOP;

  IF EXISTS (SELECT 1 FROM public.devolucao_itens WHERE devolucao_id = p_id AND condicao IS NULL) THEN
    RAISE EXCEPTION 'Informe a condição de cada item recebido.' USING ERRCODE = '22023';
  END IF;

  IF p_resolucao = 'reembolso' THEN
    -- Achado G: pagamento online com mais de 180 dias — o executor
    -- (supabase/functions/_shared/estorno.ts, guardaAntesDeChamar) RECUSA
    -- antes de chamar o Mercado Pago (prazo_vicio_dias aceita até 365, o MP
    -- só até 180). Abrir a linha em order_refunds ali só criaria um
    -- 'recusado' e a devolução concluiria sem dinheiro sair e sem caminho de
    -- refazer. Vai direto pelo caminho manual (a loja resolve fora do app).
    v_pago_pelo_app := v_o.payment_method = 'online'
                       AND v_o.payment_status IN ('pago', 'pago_apos_expirar')
                       AND v_o.gateway_payment_id IS NOT NULL
                       AND v_o.paid_at IS NOT NULL
                       AND now() - v_o.paid_at <= interval '180 days';

    -- Mesma reserva nos dois caminhos, inclusive contestacao em processamento.
    -- Passar de 180 dias muda quem devolve, nunca o saldo ainda disponivel.
    v_disponivel := public.pedido__saldo_a_estornar(v_o.id);
    v_disponivel := GREATEST(COALESCE(v_disponivel, 0), 0);

    -- Achado A: valor explícito do lojista continua recusado se passar do
    -- disponível (erro dele, ele corrige); o DEFAULT (valor dos itens + frete
    -- de ida) é CAPADO no disponível em vez de recusar a conclusão — era isto
    -- que fazia uma devolução integral com cupom (itens no preço cheio,
    -- 220 > 120 pagos) travar para sempre.
    IF p_valor_reembolso IS NOT NULL THEN
      v_valor := round(p_valor_reembolso, 2);
      IF v_valor <= 0 THEN
        RAISE EXCEPTION 'Informe o valor do reembolso.' USING ERRCODE = '22023';
      END IF;
      IF v_pago_pelo_app THEN
        IF v_valor > v_disponivel THEN
          RAISE EXCEPTION 'O reembolso (R$ %) passa do que ainda pode ser devolvido deste pedido (R$ %).',
            v_valor, v_disponivel USING ERRCODE = '22023';
        END IF;
      ELSE
        IF v_valor > v_disponivel THEN
          RAISE EXCEPTION 'O reembolso (R$ %) passa do que ainda pode ser devolvido deste pedido (R$ %).',
            v_valor, v_disponivel USING ERRCODE = '22023';
        END IF;
      END IF;
    ELSE
      v_valor := LEAST(round(v_d.valor_itens + v_d.valor_frete_ida, 2), v_disponivel);
      IF v_valor <= 0 THEN
        RAISE EXCEPTION 'Não há valor disponível para reembolso deste pedido.' USING ERRCODE = '22023';
      END IF;
    END IF;

    IF v_pago_pelo_app THEN
      INSERT INTO public.order_refunds (order_id, amount, motivo, solicitado_por, status)
      VALUES (v_o.id, v_valor, 'Devolução ' || v_d.protocolo, 'lojista', 'solicitado')
      RETURNING id INTO v_refund_id;
    ELSE
      v_manual := true;
    END IF;
  END IF;

  UPDATE public.devolucoes
     SET status = 'concluida', resolucao_final = p_resolucao,
         valor_reembolso = CASE WHEN p_resolucao = 'reembolso' THEN v_valor END,
         refund_id = v_refund_id, reembolso_manual = v_manual,
         observacao_inspecao = NULLIF(btrim(COALESCE(p_observacao, '')), ''),
         concluida_em = now(), updated_at = now()
   WHERE id = p_id;

  PERFORM public.devolucao__registrar_evento(p_id, 'recebida', 'concluida', 'loja',
    CASE p_resolucao
      WHEN 'reembolso' THEN 'Reembolso de R$ ' || to_char(v_valor, 'FM999G999G990D00')
        || CASE WHEN v_manual THEN ' (devolvido pela loja fora do app)' ELSE ' pelo Mercado Pago' END
      WHEN 'troca' THEN 'Troca combinada com a loja'
      ELSE 'Vale-troca emitido'
    END);

  RETURN jsonb_build_object(
    'id', p_id, 'status', 'concluida', 'resolucao', p_resolucao,
    'valor_reembolso', CASE WHEN p_resolucao = 'reembolso' THEN v_valor END,
    'refund_id', v_refund_id, 'reembolso_manual', v_manual,
    -- 20261642000000: 'reestocados' conta so o que voltou A VENDA; as do cantinho vao em 'sem_tamanho'.
    'reestocados', v_reestocados - v_sem_tamanho, 'sem_tamanho', v_sem_tamanho
  );
END;
$$;

-- ---------------------------------------------------------------------------
-- 4. A lista das peças que esperam (só o admin de agora)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.pecas_sem_tamanho_pendentes(p_produto_id uuid DEFAULT NULL)
RETURNS TABLE (id uuid, produto_id uuid, order_id uuid, origem text, criada_em timestamptz)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $pendentes$
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Acesso negado.' USING ERRCODE = '42501';
  END IF;
  -- Papel ATUAL (auth.users E profiles), não o do JWT: admin rebaixado para aqui (20261197000000).
  IF NOT public.is_admin_atual() THEN
    RAISE EXCEPTION 'Acesso negado.' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
    SELECT p.id, p.produto_id, p.order_id, p.origem, p.criada_em
      FROM public.pecas_sem_tamanho p
     WHERE p.resolvida_em IS NULL
       AND (p_produto_id IS NULL OR p.produto_id = p_produto_id)
     ORDER BY p.criada_em, p.id;
END;
$pendentes$;

COMMENT ON FUNCTION public.pecas_sem_tamanho_pendentes(uuid) IS
  'As peças que voltaram sem tamanho e ainda esperam a lojista (20261642000000), de um produto ou de todos (NULL), da mais antiga para a mais nova. Só o admin de agora.';

REVOKE ALL ON FUNCTION public.pecas_sem_tamanho_pendentes(uuid) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.pecas_sem_tamanho_pendentes(uuid) TO authenticated;

-- ---------------------------------------------------------------------------
-- 5. A lojista decide: o tamanho em que a peça entra, ou "não tenho essa peça"
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.resolver_peca_sem_tamanho(p_peca_id uuid, p_variant_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $resolver$
DECLARE
  v_produto uuid;
  v_variante public.product_variants%ROWTYPE;
  v_peca public.pecas_sem_tamanho%ROWTYPE;
  v_estoque integer;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Acesso negado.' USING ERRCODE = '42501';
  END IF;
  -- Papel ATUAL (auth.users E profiles), não o do JWT: admin rebaixado para aqui (20261197000000).
  IF NOT public.is_admin_atual() THEN
    RAISE EXCEPTION 'Acesso negado.' USING ERRCODE = '42501';
  END IF;
  IF p_peca_id IS NULL THEN
    RAISE EXCEPTION 'Informe a peça.' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_peca FROM public.pecas_sem_tamanho WHERE id = p_peca_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Peça não encontrada.' USING ERRCODE = 'P0002';
  END IF;
  v_produto := v_peca.produto_id;

  -- Ordem global das travas do estoque (20261395200000): variação -> produto; a linha da peça por último. Peça já resolvida
  -- (nunca volta a pendente) não tranca nada: cai direto na resposta abaixo, mesmo que o tamanho escolhido tenha sumido depois.
  IF v_peca.resolvida_em IS NULL THEN
    IF p_variant_id IS NOT NULL THEN
      SELECT * INTO v_variante FROM public.product_variants WHERE id = p_variant_id FOR NO KEY UPDATE;
      IF NOT FOUND OR v_variante.product_id IS DISTINCT FROM v_produto THEN
        RAISE EXCEPTION 'Esse tamanho não é deste produto.' USING ERRCODE = '22023';
      END IF;
    END IF;
    PERFORM 1 FROM public.produtos WHERE id = v_produto FOR NO KEY UPDATE;
    SELECT * INTO v_peca FROM public.pecas_sem_tamanho WHERE id = p_peca_id FOR UPDATE;
  END IF;

  -- Dois toques (ou duas abas): a segunda chamada chega aqui depois que a primeira gravou (esperou a trava da variação ou da
  -- peça) e devolve a decisão que já existe, sem creditar.
  IF v_peca.resolvida_em IS NOT NULL THEN
    RETURN jsonb_build_object(
      'id', v_peca.id, 'resolucao', v_peca.resolucao, 'variant_id', v_peca.variant_id,
      'ja_resolvida', true,
      'pendentes', (SELECT count(*) FROM public.pecas_sem_tamanho
                     WHERE produto_id = v_produto AND resolvida_em IS NULL)
    );
  END IF;

  IF p_variant_id IS NOT NULL THEN
    -- A compra só aceita variação ligada: crédito em variação desligada não volta a vender.
    IF v_variante.active IS NOT TRUE THEN
      RAISE EXCEPTION 'Esse tamanho está desligado. Ligue o tamanho ou escolha outro.' USING ERRCODE = '22023';
    END IF;
    -- Estoque vazio (NULL, linha antiga) conta como 0: NULL + 1 deixaria a peca marcada como reposta sem somar nada.
    UPDATE public.product_variants SET stock_increment = COALESCE(stock_increment, 0) + 1
     WHERE id = p_variant_id
    RETURNING stock_increment INTO v_estoque;
    UPDATE public.pecas_sem_tamanho
       SET resolvida_em = now(), resolucao = 'reposta', variant_id = p_variant_id, resolvida_por = auth.uid()
     WHERE id = p_peca_id;
  ELSE
    UPDATE public.pecas_sem_tamanho
       SET resolvida_em = now(), resolucao = 'descartada', resolvida_por = auth.uid()
     WHERE id = p_peca_id;
  END IF;

  RETURN jsonb_build_object(
    'id', p_peca_id,
    'resolucao', CASE WHEN p_variant_id IS NULL THEN 'descartada' ELSE 'reposta' END,
    'variant_id', p_variant_id,
    'ja_resolvida', false,
    'estoque_da_variacao', v_estoque,
    'pendentes', (SELECT count(*) FROM public.pecas_sem_tamanho
                   WHERE produto_id = v_produto AND resolvida_em IS NULL)
  );
END;
$resolver$;

COMMENT ON FUNCTION public.resolver_peca_sem_tamanho(uuid, uuid) IS
  'A lojista decide a peça que voltou sem tamanho (20261642000000): p_variant_id = o tamanho em que ela entra (variação ligada do mesmo produto, +1 em stock_increment) ou NULL = "não tenho essa peça". Trava variação -> produto -> peça. Idempotente: peça já resolvida devolve a decisão que já existe (ja_resolvida) sem creditar. Só o admin de agora.';

REVOKE ALL ON FUNCTION public.resolver_peca_sem_tamanho(uuid, uuid) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.resolver_peca_sem_tamanho(uuid, uuid) TO authenticated;

-- ---------------------------------------------------------------------------
-- PÓS-VOO (B2_POSTFLIGHT_FAILED): corpos, atributos, ACL e a tabela fechada
-- ---------------------------------------------------------------------------
DO $posvoo_20261642000000$
DECLARE
  v_dev oid := to_regprocedure('public.devolver_estoque(uuid)');
  v_concl oid := to_regprocedure('public.admin_devolucao_concluir(uuid,text,jsonb,numeric,text)');
  v_pend oid := to_regprocedure('public.pecas_sem_tamanho_pendentes(uuid)');
  v_res oid := to_regprocedure('public.resolver_peca_sem_tamanho(uuid,uuid)');
  v_forma text;
BEGIN
  IF (SELECT md5(replace(prosrc, E'\r', '')) FROM pg_proc WHERE oid = v_dev) IS DISTINCT FROM '80b1a90baf10d1b4c59484772e4864c4'
     OR (SELECT to_jsonb(p) - 'prosrc' FROM pg_proc p WHERE p.oid = v_dev) IS DISTINCT FROM current_setting('ikcous.peca642_devolver')::jsonb THEN
    RAISE EXCEPTION 'B2_POSTFLIGHT_FAILED: devolver_estoque nao ficou com o corpo desta migration ou mudou OID, dono, ACL ou atributos.';
  END IF;
  IF (SELECT md5(replace(prosrc, E'\r', '')) FROM pg_proc WHERE oid = v_concl) IS DISTINCT FROM '1a548896acb8248f1b1771d765c92fcb'
     OR (SELECT to_jsonb(p) - 'prosrc' FROM pg_proc p WHERE p.oid = v_concl) IS DISTINCT FROM current_setting('ikcous.peca642_concluir')::jsonb THEN
    RAISE EXCEPTION 'B2_POSTFLIGHT_FAILED: admin_devolucao_concluir nao ficou com o corpo desta migration ou mudou OID, dono, ACL ou atributos.';
  END IF;

  IF v_pend IS NULL OR v_res IS NULL
     OR (SELECT md5(replace(prosrc, E'\r', '')) FROM pg_proc WHERE oid = v_pend) IS DISTINCT FROM 'd6a9047fe26305d0c1446c284033245d'
     OR (SELECT md5(replace(prosrc, E'\r', '')) FROM pg_proc WHERE oid = v_res) IS DISTINCT FROM 'cac3d04d9be77c7d4004003bb70561c5' THEN
    RAISE EXCEPTION 'B2_POSTFLIGHT_FAILED: as RPCs novas nao ficaram com o corpo desta migration.';
  END IF;
  IF (SELECT count(*) FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace
        AND p.proname IN ('pecas_sem_tamanho_pendentes', 'resolver_peca_sem_tamanho')) <> 2 THEN
    RAISE EXCEPTION 'B2_POSTFLIGHT_FAILED: as RPCs novas ficaram com sobrecarga.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid = v_pend AND p.prosecdef AND p.provolatile = 's'
                    AND p.proconfig = ARRAY['search_path=public']::text[])
     OR NOT EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid = v_res AND p.prosecdef AND p.provolatile = 'v'
                    AND p.proconfig = ARRAY['search_path=public']::text[] AND p.prorettype = 'jsonb'::regtype) THEN
    RAISE EXCEPTION 'B2_POSTFLIGHT_FAILED: atributos das RPCs novas (SECURITY DEFINER, volatilidade, search_path ou retorno) nao sao os desenhados.';
  END IF;
  -- EXECUTE das RPCs novas só do authenticated: nem PUBLIC, nem anon, nem service_role.
  IF EXISTS (SELECT 1 FROM pg_proc p
               CROSS JOIN LATERAL aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) g
              WHERE p.oid IN (v_pend, v_res) AND g.privilege_type = 'EXECUTE' AND g.grantee = 0)
     OR has_function_privilege('anon', v_pend, 'EXECUTE') OR has_function_privilege('anon', v_res, 'EXECUTE')
     OR has_function_privilege('service_role', v_pend, 'EXECUTE') OR has_function_privilege('service_role', v_res, 'EXECUTE')
     OR NOT has_function_privilege('authenticated', v_pend, 'EXECUTE')
     OR NOT has_function_privilege('authenticated', v_res, 'EXECUTE') THEN
    RAISE EXCEPTION 'B2_POSTFLIGHT_FAILED: o EXECUTE das RPCs novas deve ser so do authenticated.';
  END IF;

  -- A tabela: a forma desenhada, RLS ligada, nenhuma política e nenhum privilégio de aplicação.
  SELECT string_agg(a.attname || ':' || format_type(a.atttypid, a.atttypmod) || ':' || a.attnotnull::text, ',' ORDER BY a.attname)
    INTO v_forma
    FROM pg_attribute a
   WHERE a.attrelid = to_regclass('public.pecas_sem_tamanho') AND a.attnum > 0 AND NOT a.attisdropped;
  IF v_forma IS DISTINCT FROM 'criada_em:timestamp with time zone:true,devolucao_item_id:uuid:false,id:uuid:true,order_id:uuid:false,order_item_id:uuid:false,origem:text:true,produto_id:uuid:true,resolucao:text:false,resolvida_em:timestamp with time zone:false,resolvida_por:uuid:false,variant_id:uuid:false' THEN
    RAISE EXCEPTION 'B2_POSTFLIGHT_FAILED: public.pecas_sem_tamanho nao ficou com a forma desenhada (%).', v_forma;
  END IF;
  IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = to_regclass('public.pecas_sem_tamanho'))
     OR EXISTS (SELECT 1 FROM pg_policy WHERE polrelid = to_regclass('public.pecas_sem_tamanho'))
     OR has_table_privilege('anon', 'public.pecas_sem_tamanho', 'SELECT,INSERT,UPDATE,DELETE')
     OR has_table_privilege('authenticated', 'public.pecas_sem_tamanho', 'SELECT,INSERT,UPDATE,DELETE')
     OR has_table_privilege('service_role', 'public.pecas_sem_tamanho', 'SELECT,INSERT,UPDATE,DELETE') THEN
    RAISE EXCEPTION 'B2_POSTFLIGHT_FAILED: public.pecas_sem_tamanho nao ficou fechada (RLS ligada, sem politica, sem privilegio de aplicacao).';
  END IF;
END $posvoo_20261642000000$;

-- As funções são RPC chamadas pelo PostgREST: recarrega o schema cache. Idempotente.
NOTIFY pgrst, 'reload schema';
