-- ============================================================================
-- Rollback manual — o frete de ida só volta com reembolso (20261658000000)
-- ============================================================================
-- Recria public.devolucao_elegibilidade(uuid) e public.solicitar_devolucao(uuid, jsonb, text, text, text, text, text[]) com os corpos VIGENTES de antes,
-- byte a byte (o md5 de replace(prosrc, E'\r', '') volta a ser bedd211bba45261dfbf962241ca3c9dd, o da 20261399992000, e 94ecd75ba32dd0a8ce7d433f4b6f7961, o da 20261405400000).
-- Assinaturas, SECURITY DEFINER, volatilidade, search_path, retorno jsonb e ACL são os mesmos; OID e dono não mudam (CREATE OR REPLACE).
-- Nenhum GRANT nem REVOKE neste arquivo.
--
-- COM ELE VOLTA O DEFEITO descrito no cabeçalho da migration 20261658000000: a devolução concluída como troca ou vale-troca volta a contar para o frete de ida
-- (A trocado + B reembolsado grava o frete de ida no B), e a elegibilidade deixa de mandar 'ja_reembolsada' (a tela nova cai em 'ja_devolvida', a regra antiga).
-- Devoluções NOVAS feitas enquanto a migration valeu ficam com o valor_frete_ida que gravaram. DADOS: nenhuma linha foi reescrita pela migration nem é tocada aqui.
--
-- PRÉ-VOO: recusa (B1_BASELINE_DIVERGENT) se alguma das duas não existir ou tiver sobrecarga; se o corpo vivo de QUALQUER uma não for o DESTA migration (rodar de
-- novo, já desfeito, recusa; estado misto recusa sem escrever); se os atributos não forem os de sempre; ou se a ACL não for a conhecida. O pós-voo recusa se os
-- corpos não voltaram aos vigentes ou se OID, dono, ACL ou atributos mudaram.
--
-- ORDEM: este vem ANTES de qualquer rollback da 20261405400000 e da 20261399992000 (cada uma só aceita o próprio corpo). Executar pelo aplicar-migrations.yml
-- (apaga o registro do ledger na mesma transação). Sem BEGIN/COMMIT de nível superior neste arquivo — regra da casa.
-- ============================================================================

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

DO $preflight_rollback_20261658000000$
DECLARE
  r record;
  v_oid oid;
  v_hash text;
  v_public boolean;
  v_foto jsonb := '{}'::jsonb;
BEGIN
  FOR r IN SELECT * FROM (VALUES
    ('devolucao_elegibilidade', 'public.devolucao_elegibilidade(uuid)', '4776618e9ccd401f7c7eb9518ceaa62d'),
    ('solicitar_devolucao', 'public.solicitar_devolucao(uuid,jsonb,text,text,text,text,text[])', 'e3f83a07f0a4909fb879ac653c115871')
  ) AS esperado(nome, assinatura, desta)
  LOOP
    v_oid := to_regprocedure(r.assinatura);
    IF v_oid IS NULL THEN
      RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: % ausente; nada a reverter.', r.assinatura;
    END IF;
    IF (SELECT count(*) FROM pg_proc p
         WHERE p.pronamespace = 'public'::regnamespace AND p.proname = r.nome) <> 1 THEN
      RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: % tem sobrecarga em public — meça a loja e revise antes de seguir.', r.nome;
    END IF;
    SELECT md5(replace(prosrc, E'\r', '')) INTO v_hash FROM pg_proc WHERE oid = v_oid;
    IF v_hash IS DISTINCT FROM r.desta THEN
      RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: % (hash %) não é o da 20261658000000; revise antes de reverter.', r.assinatura, COALESCE(v_hash, 'ausente');
    END IF;
    IF NOT EXISTS (
         SELECT 1 FROM pg_proc p JOIN pg_language l ON l.oid = p.prolang
          WHERE p.oid = v_oid
            AND l.lanname = 'plpgsql'
            AND p.prokind = 'f'
            AND p.prosecdef
            AND p.provolatile::text = CASE r.nome WHEN 'solicitar_devolucao' THEN 'v' ELSE 's' END
            AND NOT p.proisstrict
            AND p.pronargs = CASE r.nome WHEN 'solicitar_devolucao' THEN 7 ELSE 1 END
            AND p.proconfig = ARRAY['search_path=public']::text[]
            AND pg_get_function_result(p.oid) = 'jsonb'
       ) THEN
      RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: atributos de % não são os conhecidos — revise antes de sobrescrever.', r.assinatura;
    END IF;
    v_public := EXISTS (SELECT 1 FROM pg_proc p
                          CROSS JOIN LATERAL aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) g
                         WHERE p.oid = v_oid AND g.privilege_type = 'EXECUTE' AND g.grantee = 0);
    IF v_public
       OR has_function_privilege('anon', v_oid, 'EXECUTE')
       OR NOT has_function_privilege('authenticated', v_oid, 'EXECUTE') THEN
      RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: ACL de % não é a conhecida (authenticated sim; anon e PUBLIC não) — revise antes de sobrescrever.', r.assinatura;
    END IF;
    v_foto := v_foto || jsonb_build_object(r.nome, (SELECT to_jsonb(p) - 'prosrc' FROM pg_proc p WHERE p.oid = v_oid));
  END LOOP;
  PERFORM set_config('ikcous.freteida_rb_atributos', v_foto::text, true);
END $preflight_rollback_20261658000000$;

-- devolucao_elegibilidade: o corpo vigente da 20261399992000, byte a byte.
CREATE OR REPLACE FUNCTION public.devolucao_elegibilidade(p_order_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_o public.marketplace_orders%ROWTYPE;
  v_pol public.politica_devolucao%ROWTYPE;
  v_entregue timestamptz;
  v_dias integer;
  v_hoje date := public.devolucao__hoje();
  v_opcao text;
  v_modalidade text;
  v_metodos text[];
  v_j_arrep boolean := false;
  v_j_troca boolean := false;
  v_j_vicio boolean := false;
  v_itens jsonb;
  v_disp_total integer;
  v_bloqueio text;
  -- Achado 6 (revisão 26/09/2026, rodada 2): mesmo rateio do cupom que
  -- solicitar_devolucao aplica no snapshot — sem isto a ficha do cliente
  -- prometia o preço cheio (100) e o reembolso de verdade saía pela metade
  -- (50), porque só o valor_unitario GRAVADO era rateado.
  v_fator_desconto numeric := 1;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Entre na sua conta para pedir uma devolução.' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_o FROM public.marketplace_orders WHERE id = p_order_id;
  IF NOT FOUND OR (v_o.user_id IS DISTINCT FROM v_uid AND NOT public.is_admin()) THEN
    RAISE EXCEPTION 'Pedido não encontrado.' USING ERRCODE = 'P0002';
  END IF;
  -- Papel ATUAL (auth.users E profiles), não o do JWT: admin rebaixado para aqui (20261199000000).
  IF NOT FOUND OR (v_o.user_id IS DISTINCT FROM v_uid AND NOT public.is_admin_atual()) THEN
    RAISE EXCEPTION 'Pedido não encontrado.' USING ERRCODE = 'P0002';
  END IF;
  IF v_o.subtotal > 0 THEN
    v_fator_desconto := GREATEST(LEAST((v_o.subtotal - COALESCE(v_o.discount, 0)) / v_o.subtotal, 1), 0);
  END IF;

  SELECT * INTO v_pol FROM public.politica_devolucao WHERE id = 1;
  v_opcao := v_o.customer_data ->> 'shipping_option_id';
  v_modalidade := public.devolucao__modalidade(v_o.canal, v_opcao);
  v_metodos := public.devolucao__metodos(v_modalidade, v_opcao, v_o.shipping_label_id IS NOT NULL,
                                          v_pol.metodos_locais, v_pol.metodos_nacionais);
  v_entregue := public.devolucao__entregue_em(v_o.id);

  IF v_entregue IS NOT NULL THEN
    v_dias := v_hoje - (v_entregue AT TIME ZONE 'America/Sao_Paulo')::date;
    v_j_arrep := v_o.canal = 'online' AND v_dias <= v_pol.prazo_arrependimento_dias;
    v_j_troca := v_pol.aceita_troca AND v_pol.prazo_troca_dias > 0 AND v_dias <= v_pol.prazo_troca_dias;
    v_j_vicio := v_dias <= v_pol.prazo_vicio_dias;
  END IF;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'order_item_id', x.id,
           'product_id', x.product_id,
           'product_name', x.product_name,
           'image_url', x.image_url,
           'quantidade', x.quantity,
           'ja_devolvida', x.ja,
           'disponivel', GREATEST(x.quantity - x.ja, 0),
           'valor_unitario', round(x.price * v_fator_desconto, 2)
         ) ORDER BY x.created_at, x.id), '[]'::jsonb),
         COALESCE(sum(GREATEST(x.quantity - x.ja, 0)), 0)
    INTO v_itens, v_disp_total
    FROM (
      SELECT oi.id, oi.product_id, oi.product_name, oi.image_url, oi.quantity, oi.price, oi.created_at,
             COALESCE((SELECT sum(di.quantidade) FROM public.devolucao_itens di
                         JOIN public.devolucoes d ON d.id = di.devolucao_id
                        WHERE di.order_item_id = oi.id
                          AND d.status NOT IN ('recusada', 'cancelada', 'reprovada')
                          -- 20261399992000: o item que a lojista marcou "Não veio" não saiu do pedido; pode ser pedido de novo.
                          AND di.condicao IS DISTINCT FROM 'ausente'), 0)::integer AS ja
        FROM public.marketplace_order_items oi
       WHERE oi.order_id = v_o.id
    ) x;

  v_bloqueio := CASE
    WHEN v_o.status IS DISTINCT FROM 'delivered' THEN 'A devolução fica disponível depois que o pedido for entregue.'
    -- Achado B (revisão de 26/09/2026): lista de PERMISSÃO, não de bloqueio —
    -- `payment_status IN (...)` com NULL dá NULL (nem bloqueia nem libera). O
    -- "Ainda não" do admin deixa payment_status NULL num pedido 'delivered'
    -- (pago na entrega nunca confirmado): sem isto a devolução seguia normal.
    WHEN v_o.payment_status IS NULL
      OR v_o.payment_status NOT IN ('pago', 'pago_apos_expirar', 'recebido_na_entrega')
      THEN 'Este pedido não tem pagamento a devolver.'
    WHEN EXISTS (SELECT 1 FROM public.devolucoes d WHERE d.order_id = v_o.id
                  AND d.status IN ('solicitada', 'aprovada', 'em_transito', 'recebida'))
      THEN 'Já existe uma devolução em andamento para este pedido.'
    WHEN v_entregue IS NULL THEN 'Não encontramos a data de entrega deste pedido. Fale com a loja.'
    WHEN NOT (v_j_arrep OR v_j_troca OR v_j_vicio) THEN 'O prazo para devolução ou troca deste pedido terminou.'
    WHEN v_disp_total <= 0 THEN 'Todos os itens deste pedido já foram devolvidos.'
    ELSE NULL
  END;

  RETURN jsonb_build_object(
    'pode', v_bloqueio IS NULL,
    'motivo_bloqueio', v_bloqueio,
    'entregue_em', v_entregue,
    'dias_desde_entrega', v_dias,
    'modalidade', v_modalidade,
    'metodos', to_jsonb(v_metodos),
    'prazos', jsonb_build_object(
      'arrependimento_ate', CASE WHEN v_entregue IS NOT NULL AND v_o.canal = 'online'
        THEN (v_entregue AT TIME ZONE 'America/Sao_Paulo')::date + v_pol.prazo_arrependimento_dias END,
      'troca_ate', CASE WHEN v_entregue IS NOT NULL AND v_pol.aceita_troca AND v_pol.prazo_troca_dias > 0
        THEN (v_entregue AT TIME ZONE 'America/Sao_Paulo')::date + v_pol.prazo_troca_dias END,
      'vicio_ate', CASE WHEN v_entregue IS NOT NULL
        THEN (v_entregue AT TIME ZONE 'America/Sao_Paulo')::date + v_pol.prazo_vicio_dias END
    ),
    'janelas', jsonb_build_object('arrependimento', v_j_arrep, 'troca', v_j_troca, 'vicio', v_j_vicio),
    'itens', v_itens,
    'politica', to_jsonb(v_pol) - 'updated_by'
  );
END;
$$;

-- solicitar_devolucao: o corpo vigente da 20261405400000, byte a byte.
CREATE OR REPLACE FUNCTION public.solicitar_devolucao(
  p_order_id uuid,
  p_itens jsonb,
  p_motivo text,
  p_detalhe text,
  p_resolucao text,
  p_metodo text,
  p_fotos text[] DEFAULT '{}'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_o public.marketplace_orders%ROWTYPE;
  v_pol public.politica_devolucao%ROWTYPE;
  v_hoje date := public.devolucao__hoje();
  v_entregue timestamptz;
  v_entregue_dia date;
  v_dias integer;
  v_opcao text;
  v_modalidade text;
  v_metodos text[];
  v_vicio boolean;
  v_tipo text;
  v_prazo date;
  v_fotos text[] := COALESCE(p_fotos, '{}');
  v_foto text;
  v_item jsonb;
  v_oi public.marketplace_order_items%ROWTYPE;
  v_qtd integer;
  v_ja integer;
  v_valor numeric(12, 2) := 0;
  v_frete numeric(12, 2) := 0;
  v_total_pedido integer;
  v_total_coberto integer;
  v_id uuid := gen_random_uuid();
  v_protocolo text;
  v_tentativa integer := 0;
  v_categoria text;
  -- Achado A: o cupom mora em marketplace_orders.discount, não no item — o
  -- snapshot precisa ratear o desconto, senão o reembolso default devolve o
  -- preço CHEIO de um item pago com desconto.
  v_fator_desconto numeric := 1;
  v_valor_unit numeric(12, 2);
  -- 20261405400000: o MESMO cupom como fração exata (numerador e denominador, nos mesmos limites de v_fator_desconto): o valor da LINHA
  -- sai de uma conta só, arredondada uma vez, e não do preço de uma unidade arredondado e multiplicado depois.
  v_cupom_num numeric := 1;
  v_cupom_den numeric := 1;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Entre na sua conta para pedir uma devolução.' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_o FROM public.marketplace_orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND OR v_o.user_id IS DISTINCT FROM v_uid THEN
    RAISE EXCEPTION 'Pedido não encontrado.' USING ERRCODE = 'P0002';
  END IF;
  IF v_o.status IS DISTINCT FROM 'delivered' THEN
    RAISE EXCEPTION 'A devolução fica disponível depois que o pedido for entregue.' USING ERRCODE = '22023';
  END IF;
  -- Achado B: mesma lista de PERMISSÃO da devolucao_elegibilidade (NULL IN
  -- (...) é NULL, nunca verdadeiro — bloqueio por lista negativa não pegava).
  IF v_o.payment_status IS NULL
     OR v_o.payment_status NOT IN ('pago', 'pago_apos_expirar', 'recebido_na_entrega') THEN
    RAISE EXCEPTION 'Este pedido não tem pagamento a devolver.' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (SELECT 1 FROM public.devolucoes d WHERE d.order_id = v_o.id
              AND d.status IN ('solicitada', 'aprovada', 'em_transito', 'recebida')) THEN
    RAISE EXCEPTION 'Já existe uma devolução em andamento para este pedido.' USING ERRCODE = '23505';
  END IF;

  SELECT * INTO v_pol FROM public.politica_devolucao WHERE id = 1;
  v_entregue := public.devolucao__entregue_em(v_o.id);
  IF v_entregue IS NULL THEN
    RAISE EXCEPTION 'Não encontramos a data de entrega deste pedido. Fale com a loja.' USING ERRCODE = '22023';
  END IF;
  -- Achado A: fração do que sobrou do preço depois do cupom (subtotal >
  -- discount, sempre — só protegendo contra subtotal 0/negativo de dado
  -- legado). GREATEST/LEAST prende em [0, 1]: nunca amplia o preço.
  IF v_o.subtotal > 0 THEN
    v_fator_desconto := GREATEST(LEAST((v_o.subtotal - COALESCE(v_o.discount, 0)) / v_o.subtotal, 1), 0);
    v_cupom_num := GREATEST(LEAST(v_o.subtotal - COALESCE(v_o.discount, 0), v_o.subtotal), 0);
    v_cupom_den := v_o.subtotal;
  END IF;
  v_entregue_dia := (v_entregue AT TIME ZONE 'America/Sao_Paulo')::date;
  v_dias := v_hoje - v_entregue_dia;

  -- Tipo decidido pelo motivo e pelo prazo — nunca pelo cliente.
  v_vicio := p_motivo IN ('defeito', 'avariado_no_transporte', 'produto_errado', 'faltando_peca', 'diferente_do_anuncio');
  IF p_motivo IS NULL OR p_motivo NOT IN (
    'tamanho_pequeno', 'tamanho_grande', 'nao_gostei', 'desisti', 'cor_diferente',
    'defeito', 'avariado_no_transporte', 'produto_errado', 'faltando_peca',
    'diferente_do_anuncio', 'outro'
  ) THEN
    RAISE EXCEPTION 'Escolha o motivo da devolução.' USING ERRCODE = '22023';
  END IF;

  IF v_vicio THEN
    IF v_dias > v_pol.prazo_vicio_dias THEN
      RAISE EXCEPTION 'O prazo para reclamar de problema no produto terminou (% dias após a entrega).',
        v_pol.prazo_vicio_dias USING ERRCODE = '22023';
    END IF;
    v_tipo := 'vicio';
    v_prazo := v_entregue_dia + v_pol.prazo_vicio_dias;
  ELSIF v_o.canal = 'online' AND v_dias <= v_pol.prazo_arrependimento_dias THEN
    v_tipo := 'arrependimento';
    v_prazo := v_entregue_dia + v_pol.prazo_arrependimento_dias;
  ELSIF v_pol.aceita_troca AND v_pol.prazo_troca_dias > 0 AND v_dias <= v_pol.prazo_troca_dias THEN
    v_tipo := 'troca';
    v_prazo := v_entregue_dia + v_pol.prazo_troca_dias;
  ELSE
    RAISE EXCEPTION 'O prazo para devolução ou troca deste pedido terminou.' USING ERRCODE = '22023';
  END IF;

  IF p_resolucao IS NULL OR p_resolucao NOT IN ('reembolso', 'troca', 'vale') THEN
    RAISE EXCEPTION 'Escolha como prefere resolver: reembolso, troca ou vale-troca.' USING ERRCODE = '22023';
  END IF;
  IF v_tipo = 'troca' AND p_resolucao = 'reembolso' THEN
    RAISE EXCEPTION 'Fora do prazo de arrependimento a loja aceita troca ou vale-troca.' USING ERRCODE = '22023';
  END IF;
  IF p_resolucao = 'vale' AND NOT v_pol.aceita_vale THEN
    RAISE EXCEPTION 'Esta loja não trabalha com vale-troca.' USING ERRCODE = '22023';
  END IF;
  -- Defeito dá direito à substituição (art. 18); fora dele, troca é política da loja.
  IF p_resolucao = 'troca' AND NOT v_vicio AND NOT v_pol.aceita_troca THEN
    RAISE EXCEPTION 'Esta loja não faz troca por tamanho ou gosto.' USING ERRCODE = '22023';
  END IF;

  v_opcao := v_o.customer_data ->> 'shipping_option_id';
  v_modalidade := public.devolucao__modalidade(v_o.canal, v_opcao);
  v_metodos := public.devolucao__metodos(v_modalidade, v_opcao, v_o.shipping_label_id IS NOT NULL,
                                          v_pol.metodos_locais, v_pol.metodos_nacionais);
  IF p_metodo IS NULL OR NOT (p_metodo = ANY (v_metodos)) THEN
    RAISE EXCEPTION 'Escolha uma forma de devolver o produto disponível para este pedido.' USING ERRCODE = '22023';
  END IF;

  -- Fotos: só da própria pasta do cliente no bucket privado.
  IF cardinality(v_fotos) > 6 THEN
    RAISE EXCEPTION 'Envie no máximo 6 fotos.' USING ERRCODE = '22023';
  END IF;
  FOREACH v_foto IN ARRAY v_fotos LOOP
    IF v_foto IS NULL
       OR split_part(v_foto, '/', 1) <> v_uid::text
       OR v_foto !~ '^[0-9a-f-]{36}/[A-Za-z0-9._/-]{1,200}$'
       OR v_foto LIKE '%..%' THEN
      RAISE EXCEPTION 'Foto inválida. Envie as fotos de novo.' USING ERRCODE = '22023';
    END IF;
  END LOOP;
  IF v_vicio AND v_pol.exige_fotos_vicio AND cardinality(v_fotos) = 0 THEN
    RAISE EXCEPTION 'Envie ao menos uma foto do problema no produto.' USING ERRCODE = '22023';
  END IF;

  IF p_itens IS NULL OR jsonb_typeof(p_itens) <> 'array' OR jsonb_array_length(p_itens) = 0 THEN
    RAISE EXCEPTION 'Escolha ao menos um item para devolver.' USING ERRCODE = '22023';
  END IF;
  IF (SELECT count(*) FROM jsonb_array_elements(p_itens) e) <>
     (SELECT count(DISTINCT e ->> 'order_item_id') FROM jsonb_array_elements(p_itens) e) THEN
    RAISE EXCEPTION 'Item repetido na devolução.' USING ERRCODE = '22023';
  END IF;

  LOOP
    v_protocolo := 'DV' || to_char(now() AT TIME ZONE 'America/Sao_Paulo', 'YYMMDD') || '-'
                   || upper(substr(md5(random()::text || clock_timestamp()::text), 1, 5));
    EXIT WHEN NOT EXISTS (SELECT 1 FROM public.devolucoes WHERE protocolo = v_protocolo);
    v_tentativa := v_tentativa + 1;
    IF v_tentativa > 8 THEN
      RAISE EXCEPTION 'Não foi possível gerar o protocolo. Tente de novo.' USING ERRCODE = '40001';
    END IF;
  END LOOP;

  INSERT INTO public.devolucoes (
    id, protocolo, order_id, user_id, tipo, motivo, detalhe, resolucao_desejada,
    modalidade, metodo_retorno, valor_itens, fotos, entregue_em, prazo_ate, politica
  ) VALUES (
    v_id, v_protocolo, v_o.id, v_uid, v_tipo, p_motivo, NULLIF(btrim(COALESCE(p_detalhe, '')), ''),
    p_resolucao, v_modalidade, p_metodo, 0, v_fotos, v_entregue, v_prazo,
    to_jsonb(v_pol) - 'updated_by'
  );

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_itens) LOOP
    BEGIN
      v_qtd := (v_item ->> 'quantidade')::integer;
    EXCEPTION WHEN OTHERS THEN
      RAISE EXCEPTION 'Quantidade inválida.' USING ERRCODE = '22023';
    END;
    SELECT * INTO v_oi FROM public.marketplace_order_items
     WHERE id = NULLIF(v_item ->> 'order_item_id', '')::uuid AND order_id = v_o.id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Item não pertence a este pedido.' USING ERRCODE = '22023';
    END IF;
    SELECT COALESCE(sum(di.quantidade), 0) INTO v_ja
      FROM public.devolucao_itens di JOIN public.devolucoes d ON d.id = di.devolucao_id
     WHERE di.order_item_id = v_oi.id AND d.id <> v_id
       AND d.status NOT IN ('recusada', 'cancelada', 'reprovada')
       -- 20261399992000: o item que a lojista marcou "Não veio" não conta como já devolvido.
       AND di.condicao IS DISTINCT FROM 'ausente';
    IF v_qtd IS NULL OR v_qtd < 1 OR v_qtd > v_oi.quantity - v_ja THEN
      RAISE EXCEPTION 'Quantidade indisponível para devolução do item %.', COALESCE(v_oi.product_name, '')
        USING ERRCODE = '22023';
    END IF;

    IF v_tipo = 'troca' AND cardinality(v_pol.categorias_sem_troca) > 0 THEN
      SELECT p.categoria INTO v_categoria FROM public.produtos p WHERE p.id = v_oi.product_id;
      IF v_categoria IS NOT NULL AND lower(v_categoria) = ANY (
           SELECT lower(c) FROM unnest(v_pol.categorias_sem_troca) c) THEN
        RAISE EXCEPTION 'O produto % não aceita troca pela política da loja.', COALESCE(v_oi.product_name, '')
          USING ERRCODE = '22023';
      END IF;
    END IF;

    -- Achado A: snapshot rateado pelo cupom, não o preço cheio do item.
    v_valor_unit := round(v_oi.price * v_fator_desconto, 2);
    INSERT INTO public.devolucao_itens (
      devolucao_id, order_item_id, product_id, variant_id, product_name, image_url, quantidade, valor_unitario
    ) VALUES (
      v_id, v_oi.id, v_oi.product_id, v_oi.variant_id, v_oi.product_name, v_oi.image_url, v_qtd, v_valor_unit
    );
    -- 20261405400000: o valor desta devolução para a linha é o proporcional ACUMULADO depois dela menos o de antes (v_ja = o que as outras
    -- devoluções que valem já levaram): a soma de todas as devoluções da linha, juntas ou separadas, fecha o total da linha com o cupom,
    -- sem perder o centavo que o arredondamento por unidade perdia. Sem cupom (fração 1/1) é preço x quantidade, igual a antes.
    v_valor := v_valor
      + round(v_oi.price * v_cupom_num * (v_ja + v_qtd) / v_cupom_den, 2)
      - round(v_oi.price * v_cupom_num * v_ja / v_cupom_den, 2);
  END LOOP;

  -- Trava de arredondamento (achado A): a soma dos itens desta devolução
  -- nunca passa do que o pedido cobrou pelos itens depois do cupom — mesmo
  -- que o rateio por unidade, arredondado, feche um centavo acima.
  v_valor := LEAST(v_valor, GREATEST(round(v_o.subtotal - COALESCE(v_o.discount, 0), 2), 0));

  -- Arrependimento/defeito devolvem também o frete de ida quando o pedido
  -- volta inteiro (CDC art. 49, parágrafo único: "a qualquer título").
  IF v_tipo IN ('arrependimento', 'vicio') THEN
    SELECT COALESCE(sum(oi.quantity), 0) INTO v_total_pedido
      FROM public.marketplace_order_items oi WHERE oi.order_id = v_o.id;
    SELECT COALESCE(sum(di.quantidade), 0) INTO v_total_coberto
      FROM public.devolucao_itens di JOIN public.devolucoes d ON d.id = di.devolucao_id
     WHERE d.order_id = v_o.id AND d.status NOT IN ('recusada', 'cancelada', 'reprovada')
       -- 20261399992000: o frete de ida só volta quando o pedido volta INTEIRO; o que "Não veio" não voltou.
       AND di.condicao IS DISTINCT FROM 'ausente';
    IF v_total_coberto >= v_total_pedido THEN
      v_frete := COALESCE(v_o.shipping, 0);
    END IF;
  END IF;

  UPDATE public.devolucoes SET valor_itens = v_valor, valor_frete_ida = v_frete WHERE id = v_id;
  PERFORM public.devolucao__registrar_evento(v_id, NULL, 'solicitada', 'cliente', NULL);

  RETURN jsonb_build_object('id', v_id, 'protocolo', v_protocolo, 'tipo', v_tipo, 'status', 'solicitada');
END;
$$;

DO $posvoo_rollback_20261658000000$
DECLARE
  r record;
  v_oid oid;
  v_hash text;
  v_public boolean;
  v_foto jsonb := '{}'::jsonb;
BEGIN
  FOR r IN SELECT * FROM (VALUES
    ('devolucao_elegibilidade', 'public.devolucao_elegibilidade(uuid)', 'bedd211bba45261dfbf962241ca3c9dd'),
    ('solicitar_devolucao', 'public.solicitar_devolucao(uuid,jsonb,text,text,text,text,text[])', '94ecd75ba32dd0a8ce7d433f4b6f7961')
  ) AS esperado(nome, assinatura, vigente)
  LOOP
    v_oid := to_regprocedure(r.assinatura);
    IF v_oid IS NULL THEN
      RAISE EXCEPTION 'POSVOO_ROLLBACK_20261658000000: % sumiu', r.assinatura;
    END IF;
    SELECT md5(replace(prosrc, E'\r', '')) INTO v_hash FROM pg_proc WHERE oid = v_oid;
    IF v_hash IS DISTINCT FROM r.vigente THEN
      RAISE EXCEPTION 'POSVOO_ROLLBACK_20261658000000: corpo vivo de % (hash %) não voltou ao vigente', r.nome, COALESCE(v_hash, 'ausente');
    END IF;
    IF (SELECT count(*) FROM pg_proc p
         WHERE p.pronamespace = 'public'::regnamespace AND p.proname = r.nome) <> 1 THEN
      RAISE EXCEPTION 'POSVOO_ROLLBACK_20261658000000: % ficou com sobrecarga', r.nome;
    END IF;
    v_public := EXISTS (SELECT 1 FROM pg_proc p
                          CROSS JOIN LATERAL aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) g
                         WHERE p.oid = v_oid AND g.privilege_type = 'EXECUTE' AND g.grantee = 0);
    IF v_public
       OR has_function_privilege('anon', v_oid, 'EXECUTE')
       OR NOT has_function_privilege('authenticated', v_oid, 'EXECUTE') THEN
      RAISE EXCEPTION 'POSVOO_ROLLBACK_20261658000000: ACL de % não é a de sempre', r.nome;
    END IF;
    v_foto := v_foto || jsonb_build_object(r.nome, (SELECT to_jsonb(p) - 'prosrc' FROM pg_proc p WHERE p.oid = v_oid));
  END LOOP;
  IF v_foto IS DISTINCT FROM current_setting('ikcous.freteida_rb_atributos')::jsonb THEN
    RAISE EXCEPTION 'POSVOO_ROLLBACK_20261658000000: atributos, dono, OID ou ACL de uma das duas funções mudaram';
  END IF;
END $posvoo_rollback_20261658000000$;
