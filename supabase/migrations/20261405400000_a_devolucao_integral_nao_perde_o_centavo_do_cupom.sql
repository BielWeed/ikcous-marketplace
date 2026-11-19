-- ============================================================================
-- Migration 20261405400000 — a devolução integral com cupom não perde o centavo (DINHEIRO: troca o corpo de UMA função, a que grava o valor dos itens; a que devolve o dinheiro não muda)
-- ============================================================================
--
-- 1. O DEFEITO (medido no Postgres, 18/11/2026)
--
-- public.solicitar_devolucao grava em devolucoes.valor_itens o que a devolução vale. Com cupom, ela arredondava o preço de UMA unidade (round(preço x fração do cupom, 2)) e multiplicava
-- pela quantidade: o centavo que o arredondamento perde por unidade se multiplica. Compra de 3 x R$ 50,00 (subtotal 150,00) com cupom de R$ 2,00 e frete 0: a cliente paga R$ 148,00; a fração
-- é 148/150; round(50 x 148/150, 2) = 49,33; devolver 1, 2 e 3 unidades dava R$ 49,33 / 98,66 / 147,99. A devolução INTEGRAL ficava R$ 0,01 abaixo do pago, o painel sugeria e enviava 147,99
-- ao Mercado Pago (estorno parcial), o pedido seguia 'pago' e sobrava R$ 0,01 para sempre. A trava LEAST do corpo só corta o excesso (20261175000000, achado A): nunca repõe o centavo.
-- Quem sente: a lojista (o pedido devolvido inteiro nunca fecha) e a cliente (recebe um centavo a menos do que pagou).
--
-- 2. A REGRA NOVA (e o que NÃO muda)
--
-- O valor de uma LINHA devolvida é o valor proporcional ACUMULADO depois da devolução menos o de antes, cada um arredondado uma vez:
--
--     parte = round(preço x (subtotal - desconto) / subtotal x (já + agora), 2) - round(preço x (subtotal - desconto) / subtotal x já, 2)
--
-- onde "já" são as unidades da MESMA linha que as outras devoluções que valem já levaram (a mesma conta de v_ja: fora a recusada, a cancelada, a reprovada e o item que "Não veio") e "agora" é a
-- quantidade desta. A soma de todas as devoluções de uma linha, juntas ou em partes, fecha EXATAMENTE o total da linha com o cupom. Os números do defeito: 49,33 / 98,67 / 148,00 de uma vez;
-- três devoluções de 1 unidade valem 49,33 + 49,34 + 49,33 = 148,00. A fração entra como numerador e denominador exatos (uma divisão só, depois da multiplicação), nos mesmos limites de antes: o
-- desconto nunca amplia o preço (limite 1) nem o torna negativo (limite 0), e subtotal 0 ou negativo (dado legado) não rateia nada.
--
-- NÃO MUDA: sem cupom (fração 1) a conta dá preço x quantidade, igual a antes; o valor por unidade gravado em cada item (devolucao_itens.valor_unitario, round(preço x fração, 2)) fica como está,
-- porque a ficha do cliente, o ranking de lucro e a tela da conclusão o leem; a trava de arredondamento (a soma desta devolução nunca passa do que o pedido cobrou pelos itens); o frete de ida
-- (só volta quando as devoluções que valem cobrem todas as unidades do pedido); a elegibilidade, o prazo e a regra do item "Não veio" (20261399992000); a conclusão e o reembolso
-- (admin_devolucao_concluir fica byte a byte, e o reembolso segue limitado ao saldo do pedido, pedido__saldo_a_estornar). A tela do painel LÊ valor_itens do servidor: a correção é aqui.
--
-- LIMITES CONHECIDOS (não são o defeito desta migration): o rateio é por LINHA, não pelo pedido inteiro. Num pedido de três ou mais linhas, cada uma arredondada sozinha, a soma das linhas pode
-- diferir do total dos itens em um centavo (para baixo: a integral do pedido ficaria um centavo abaixo; para cima: a trava LEAST corta). Se k unidades foram devolvidas pelo corpo antigo e o restante
-- pelo novo, a diferença no total da linha pode chegar a cerca de k/2 centavos, mas não supera o erro do corpo antigo sozinho. O saldo do pedido segue sendo o teto do reembolso.
--
-- 3. O QUE MUDA NO CORPO (só isto; o resto da função não muda um byte)
--
-- solicitar_devolucao (vigente: 20261399992000, md5 52e5c30c06f9767a97e98f3a393b8496):
--   a) duas variáveis novas, v_cupom_num e v_cupom_den (numeric, valor 1 por padrão);
--   b) dentro do IF v_o.subtotal > 0 que já calculava v_fator_desconto, duas linhas: o numerador (subtotal - desconto, preso entre 0 e o subtotal) e o denominador (o subtotal);
--   c) a linha "v_valor := v_valor + round(v_qtd * v_valor_unit, 2)" vira a diferença dos dois proporcionais acumulados, usando v_ja (já calculado no laço, antes).
-- Assinatura, SECURITY DEFINER, volatilidade, search_path, retorno jsonb e ACL NÃO mudam (CREATE OR REPLACE: OID e dono ficam).
--
-- 4. DADOS EXISTENTES
--
-- Nenhuma linha é lida nem reescrita ao aplicar: só o corpo de uma função muda. As devoluções JÁ gravadas ficam com o valor_itens que tinham (inclusive as que perderam o centavo); só as
-- devoluções NOVAS usam a regra. Aplicar duas vezes deixa o mesmo estado (o pré-voo aceita o corpo vigente OU o desta migration).
--
-- 5. PRÉ-VOO (B1_BASELINE_DIVERGENT, ANTES de qualquer escrita)
--
-- Recusa se: a função não existir ou tiver sobrecarga; o corpo vivo (md5 de replace(prosrc, E'\r', '')) não for UM dos dois conhecidos; os atributos não forem os de sempre; ou a ACL não for a conhecida
-- (authenticated sim; anon e PUBLIC não). Fotografa OID, dono, ACL e atributos para o pós-voo. O pós-voo confere o md5 novo, que a troca aparece uma vez cada e a antiga não aparece, e que a fotografia não mudou.
--
-- 6. TRANSAÇÃO
--
-- Sem BEGIN/COMMIT de nível superior (regra da casa, AGENTS.md): quem abre a transação é o aplicador (aplicar-migrations.yml / db-apply), que grava a versão no ledger na mesma transação. Um pré-voo ou
-- pós-voo que recusa desfaz o arquivo inteiro: a função muda ou nada muda.
--
-- 7. ORDEM E ROLLBACK
--
-- Depois da 20261399992000 (o pré-voo recusa sem ela). Nenhuma mudança de front é exigida para a regra valer; a tela da conclusão desconta o item "Não veio" proporcionalmente ao valor_itens do servidor (o
-- front novo funciona com o corpo antigo e com o novo). ROLLBACK MANUAL: rollback-manual-20261405400000_a_devolucao_integral_nao_perde_o_centavo_do_cupom.sql devolve o corpo vigente de antes byte a byte; com
-- ele volta o defeito descrito acima. Ele vem ANTES de qualquer rollback da 20261399992000 (o dela só aceita o corpo da 20261399992000 em solicitar_devolucao).
--
-- 8. FICHA DE VERIFICAÇÃO
--
--   SELECT md5(replace(prosrc, E'\r', '')) FROM pg_proc WHERE oid = to_regprocedure('public.solicitar_devolucao(uuid,jsonb,text,text,text,text,text[])');
--   -- esperado: 94ecd75ba32dd0a8ce7d433f4b6f7961 (antes: 52e5c30c06f9767a97e98f3a393b8496). proacl, prosecdef e proconfig iguais antes e depois.
-- ============================================================================

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

DO $preflight_20261405400000$
DECLARE
  r record;
  v_oid oid;
  v_hash text;
  v_public boolean;
  v_foto jsonb := '{}'::jsonb;
BEGIN
  FOR r IN SELECT * FROM (VALUES
    ('solicitar_devolucao', 'public.solicitar_devolucao(uuid,jsonb,text,text,text,text,text[])', '52e5c30c06f9767a97e98f3a393b8496', '94ecd75ba32dd0a8ce7d433f4b6f7961')
  ) AS esperado(nome, assinatura, anterior, desta)
  LOOP
    v_oid := to_regprocedure(r.assinatura);
    IF v_oid IS NULL THEN
      RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: % não existe.', r.assinatura;
    END IF;
    IF (SELECT count(*) FROM pg_proc p
         WHERE p.pronamespace = 'public'::regnamespace AND p.proname = r.nome) <> 1 THEN
      RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: % tem sobrecarga em public — meça a loja e revise antes de aplicar.', r.nome;
    END IF;
    SELECT md5(replace(prosrc, E'\r', '')) INTO v_hash FROM pg_proc WHERE oid = v_oid;
    IF v_hash IS NULL OR v_hash NOT IN (r.anterior, r.desta) THEN
      RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: corpo vivo de % (hash %) não é o vigente nem o que esta migration deixa — capture o corpo vivo e revise antes de aplicar.', r.assinatura, COALESCE(v_hash, 'ausente');
    END IF;
    IF NOT EXISTS (
         SELECT 1 FROM pg_proc p JOIN pg_language l ON l.oid = p.prolang
          WHERE p.oid = v_oid
            AND l.lanname = 'plpgsql'
            AND p.prokind = 'f'
            AND p.prosecdef
            AND p.provolatile::text = 'v'
            AND NOT p.proisstrict
            AND p.pronargs = 7
            AND p.proconfig = ARRAY['search_path=public']::text[]
            AND pg_get_function_result(p.oid) = 'jsonb'
       ) THEN
      RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: atributos de % (linguagem, SECURITY DEFINER, volatilidade, search_path, argumentos ou retorno) não são os conhecidos — meça a loja e revise antes de aplicar.', r.assinatura;
    END IF;
    v_public := EXISTS (SELECT 1 FROM pg_proc p
                          CROSS JOIN LATERAL aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) g
                         WHERE p.oid = v_oid AND g.privilege_type = 'EXECUTE' AND g.grantee = 0);
    IF v_public
       OR has_function_privilege('anon', v_oid, 'EXECUTE')
       OR NOT has_function_privilege('authenticated', v_oid, 'EXECUTE') THEN
      RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: ACL de % não é a conhecida (authenticated sim; anon e PUBLIC não) — meça a loja e revise.', r.assinatura;
    END IF;
    -- Fotografia: OID, dono, ACL e TODOS os atributos (o CREATE OR REPLACE só pode trocar o texto).
    v_foto := v_foto || jsonb_build_object(r.nome, (SELECT to_jsonb(p) - 'prosrc' FROM pg_proc p WHERE p.oid = v_oid));
  END LOOP;
  PERFORM set_config('ikcous.devcupom_atributos', v_foto::text, true);
END $preflight_20261405400000$;

-- solicitar_devolucao: o corpo vigente da 20261399992000 + a troca declarada no cabeçalho (item 3).
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

DO $posvoo_20261405400000$
DECLARE
  r record;
  v_oid oid;
  v_src text;
  v_hash text;
  v_foto jsonb := '{}'::jsonb;
  v_public boolean;
BEGIN
  v_oid := to_regprocedure('public.solicitar_devolucao(uuid,jsonb,text,text,text,text,text[])');
  IF v_oid IS NULL THEN
    RAISE EXCEPTION 'POSVOO_20261405400000: public.solicitar_devolucao sumiu';
  END IF;
  SELECT md5(replace(prosrc, E'\r', '')), prosrc INTO v_hash, v_src FROM pg_proc WHERE oid = v_oid;
  IF v_hash IS DISTINCT FROM '94ecd75ba32dd0a8ce7d433f4b6f7961' THEN
    RAISE EXCEPTION 'POSVOO_20261405400000: corpo vivo de solicitar_devolucao (hash %) não é o desta migration', COALESCE(v_hash, 'ausente');
  END IF;
  -- A troca declarada aparece o número certo de vezes (a conta nova uma vez de cada lado; a antiga nenhuma).
  FOR r IN SELECT * FROM (VALUES
    ('round(v_oi.price * v_cupom_num * (v_ja + v_qtd) / v_cupom_den, 2)', 1),
    ('round(v_oi.price * v_cupom_num * v_ja / v_cupom_den, 2)', 1),
    ('v_cupom_den := v_o.subtotal;', 1),
    ('round(v_qtd * v_valor_unit, 2)', 0)
  ) AS marca(texto, vezes)
  LOOP
    IF (length(v_src) - length(replace(v_src, r.texto, ''))) / length(r.texto) <> r.vezes THEN
      RAISE EXCEPTION 'POSVOO_20261405400000: o trecho "%" deveria aparecer % vez(es) em solicitar_devolucao', r.texto, r.vezes;
    END IF;
  END LOOP;
  IF (SELECT count(*) FROM pg_proc p
       WHERE p.pronamespace = 'public'::regnamespace AND p.proname = 'solicitar_devolucao') <> 1 THEN
    RAISE EXCEPTION 'POSVOO_20261405400000: solicitar_devolucao ficou com sobrecarga';
  END IF;
  v_public := EXISTS (SELECT 1 FROM pg_proc p
                        CROSS JOIN LATERAL aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) g
                       WHERE p.oid = v_oid AND g.privilege_type = 'EXECUTE' AND g.grantee = 0);
  IF v_public
     OR has_function_privilege('anon', v_oid, 'EXECUTE')
     OR NOT has_function_privilege('authenticated', v_oid, 'EXECUTE') THEN
    RAISE EXCEPTION 'POSVOO_20261405400000: ACL de solicitar_devolucao não é a de sempre';
  END IF;
  v_foto := jsonb_build_object('solicitar_devolucao', (SELECT to_jsonb(p) - 'prosrc' FROM pg_proc p WHERE p.oid = v_oid));
  IF v_foto IS DISTINCT FROM current_setting('ikcous.devcupom_atributos')::jsonb THEN
    RAISE EXCEPTION 'POSVOO_20261405400000: atributos, dono, OID ou ACL de solicitar_devolucao mudaram';
  END IF;
END $posvoo_20261405400000$;
