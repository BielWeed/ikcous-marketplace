-- ROLLBACK MANUAL de 20261169000000_a_retirada_na_loja_nasce_no_servidor.sql
-- (retirada na loja — release 1.5.3, 22/09/2026).
--
-- Devolve create_marketplace_order_v23 e _v24 ao corpo que a
-- 20261168000000 deixou — os dois statements abaixo são a CÓPIA LITERAL
-- dos da 20261168000000 (o teste tests/migration_retirada_na_loja_test.ts
-- prova byte a byte contra o arquivo dela). SEM bloco de GRANTs e SEM DROP:
-- CREATE OR REPLACE preserva dono e ACL.
--
-- FIM DE LINHA (medido 22/09/2026): nos bancos das lojas o corpo vivo da
-- 20261168 está gravado com CRLF (prosrc v23 sha256 2d99adfd…, v24
-- b728cea3…) — a aplicação saiu de uma cópia Windows. Este arquivo é LF
-- (.gitattributes eol=lf). Depois deste rollback o corpo fica IGUAL ao da
-- 20261168 caractere a caractere, exceto o CR de cada fim de linha (prosrc
-- v23 0f94d41b6f070fe8a09ba1b30d99d8facfdc99cb6d435e6f7c0eeb06f568f160, v24 60bf51b8b85a109789fcb2c4cbe5fd6a7ec13e9d966eceb219270fb03ea4c0b3). Semântica idêntica: nenhum literal de
-- texto do corpo atravessa quebra de linha. O scripts/db-prove-rollback.cjs
-- já classifica divergência só de fim de linha como FORMATAÇÃO, não
-- conteúdo; e a 20261169 aceita os dois fins de linha no preflight, então
-- reaplicá-la depois deste rollback funciona.
--
-- 🔴 MODO DE APLICAÇÃO — psql, UMA transação externa ÚNICA:
--   psql "$DATABASE_URL" -1 -f rollback-manual-20261169000000_a_retirada_na_loja_nasce_no_servidor.sql
-- As duas funções voltam JUNTAS ou nenhuma volta. SEM BEGIN/COMMIT dentro
-- do arquivo (regra da casa). NUNCA pelo scripts/db-apply.cjs (gravaria o
-- rollback no ledger de migrations).
--
-- 🔴 ORDEM PARA DESFAZER (o inverso da implantação):
--   1. DESLIGAR a retirada em cada loja que a ligou (Admin → Frete →
--      "Permitir retirada na loja" desligado, ou tirar a chave
--      'store-pickup' de store_config.enabled_shipping_methods). Sem isso,
--      a edge VELHA (passo 2) leria a chave como transportadora e, num
--      array só com ela, desligaria todas as transportadoras.
--   2. Voltar o front e as functions à versão anterior.
--   3. Só então este arquivo.
--   Banco velho com front/edge novos no ar = a cliente escolhe a retirada e
--   o pedido é RECUSADO no último clique (v23: "transportadora exige
--   antecipado"; v24: cotação ausente) — recusa honesta, nunca pedido com
--   frete errado, mas venda perdida. Por isso o banco volta por último.
--
-- DADOS: nada é apagado nem reescrito. Pedidos já criados com
-- 'store-pickup' guardam shipping_option_id e pickup_address no
-- customer_data (o front continua sabendo exibi-los enquanto estiver na
-- versão nova). A chave 'store-pickup' em enabled_shipping_methods NÃO é
-- tirada por este arquivo — é o passo 1, decisão da loja.
--
-- Preflight: o banco tem de estar com o corpo da 20261169 (LF ou CRLF) —
-- ou já com o da 20261168 (LF ou CRLF: rollback repetido é no-op). Qualquer
-- outro corpo para tudo antes de mexer em qualquer coisa.
DO $preflight$
DECLARE
  v_hash_v23 text;
  v_hash_v24 text;
BEGIN
  SELECT encode(sha256(convert_to(prosrc, 'UTF8')), 'hex') INTO v_hash_v23
    FROM pg_proc
   WHERE oid = to_regprocedure('public.create_marketplace_order_v23(jsonb, numeric, numeric, text, uuid, text, text, text, text, jsonb, text, text, uuid)');
  SELECT encode(sha256(convert_to(prosrc, 'UTF8')), 'hex') INTO v_hash_v24
    FROM pg_proc
   WHERE oid = to_regprocedure('public.create_marketplace_order_v24(jsonb, numeric, numeric, text, uuid, text, text, text, text, jsonb, text, text, uuid)');

  IF v_hash_v23 IS NULL OR v_hash_v23 NOT IN (
    '5c52deac71558be252c5e8c1d382c2c072085aa47611213185935086863f2300',
    'b2e3c27e1dfdb2855df2fe86c45442564bfb903b424a323e7855f45855d00c61',
    '0f94d41b6f070fe8a09ba1b30d99d8facfdc99cb6d435e6f7c0eeb06f568f160',
    '2d99adfd1028e60fcb02de34e6818ace4d8c55d1202f172fd603786604d6d28c'
  ) THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: corpo vivo da create_marketplace_order_v23 não é o da 20261169000000 nem o da 20261168000000 (hash %) — capture e revise antes de reverter', COALESCE(v_hash_v23, 'ausente');
  END IF;
  IF v_hash_v24 IS NULL OR v_hash_v24 NOT IN (
    'e3789fb458a53bf687c8351ecd5d513664e47b09618825eec99bb6330e316117',
    'd692cb8a5ccd0c8a0c4d29815e04ad146985888f0bf188315eafe55fce4a73ec',
    '60bf51b8b85a109789fcb2c4cbe5fd6a7ec13e9d966eceb219270fb03ea4c0b3',
    'b728cea3264227075578946beaa9c2fa0d2f1b400c207d839609bfa5e14b4682'
  ) THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: corpo vivo da create_marketplace_order_v24 não é o da 20261169000000 nem o da 20261168000000 (hash %) — capture e revise antes de reverter', COALESCE(v_hash_v24, 'ausente');
  END IF;
END $preflight$;

CREATE OR REPLACE FUNCTION public.create_marketplace_order_v23(p_items jsonb, p_total_amount numeric, p_shipping_cost numeric, p_payment_method text, p_address_id uuid, p_coupon_code text, p_customer_name text, p_customer_phone text, p_observation text, p_address_data jsonb, p_destination_cep text, p_shipping_option_id text, p_idempotency_key uuid DEFAULT NULL)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
    v_user_id uuid := auth.uid();
    v_order_id uuid;
    v_item jsonb;
    v_product_id uuid;
    v_variant_id uuid;
    v_quantity integer;
    v_item_name text;
    v_rows_affected integer;

    v_db_price numeric;
    v_db_stock integer;
    v_calculated_subtotal numeric := 0;
    v_calculated_total numeric := 0;
    v_discount_amount numeric := 0;
    v_coupon_id uuid;

    v_store_config RECORD;
    v_shipping_validated numeric;
    v_frete_gratis boolean;
    v_has_free_shipping_item boolean := false;
    v_free_shipping_min numeric;
    v_dest_cep text;

    v_coupon_type text;
    v_cupom_recusado RECORD;
    v_coupon_val numeric;

    -- O PORTÃO DE ENTREGA (20261039000000): onde se cotou × onde se entrega.
    v_cep_de_cotacao text;
    v_cep_de_entrega text;

    -- 2-ter (20261168000000, revisão B4): o id da opção de entrega
    -- NORMALIZADO uma única vez — NULLIF(btrim(...)) — lido por TODAS as
    -- comparações do bloco 2-ter (NULL, flat-fee, local-delivery). O
    -- bloco 4 segue lendo o parâmetro cru, VERBATIM (fora do escopo).
    v_opcao text := NULLIF(btrim(p_shipping_option_id), '');
BEGIN

    -- 0. IDEMPOTÊNCIA DA CRIAÇÃO (laudo caça-bugs do molde, 31/08/2026, A1):
    -- a rede pode cair DEPOIS do commit deste pedido. A retentativa honesta
    -- (mesmo clique repetido, F5, mesmo navegador) REPETE a chave da compra
    -- e tem de receber o pedido que JÁ NASCEU — não criar um gêmeo com
    -- estoque e cupom debitados em dobro. Convidado não tem user_id para
    -- amarrar: a chave uuid aleatória É o segredo da compra. Quem está
    -- logado só recupera pedido próprio.
    IF p_idempotency_key IS NOT NULL THEN
        SELECT id INTO v_order_id
          FROM public.marketplace_orders
         WHERE idempotency_key = p_idempotency_key
           AND (v_user_id IS NULL OR user_id IS NOT DISTINCT FROM v_user_id);
        IF v_order_id IS NOT NULL THEN
            RETURN v_order_id;
        END IF;
    END IF;

    -- 1. Address Ownership Check (Only if user is logged in)
    IF p_address_id IS NOT NULL AND v_user_id IS NOT NULL THEN
        IF NOT EXISTS (SELECT 1 FROM user_addresses WHERE id = p_address_id AND user_id = v_user_id) THEN
            RAISE EXCEPTION 'Endereço inválido ou não pertence ao usuário.';
        END IF;
    END IF;

    -- 2. Store Config
    SELECT * INTO v_store_config FROM public.store_config WHERE id = 1;

    -- 2-bis. O PORTÃO DE ENTREGA MORA AQUI (laudo caça-bugs do molde,
    -- 31/08/2026, A2 + item E). Até hoje a regra do convidado (só entrega
    -- local, decisão do Gabriel de 30/08) e a cobertura da loja
    -- (store_config.shipping_coverage) existiam SÓ na tela: chamando esta
    -- RPC direto, QUALQUER CEP passava — e o caminho flat-fee-* nem olhava
    -- CEP. O comentário do cep-local.ts ("a decisão final é do servidor")
    -- era aspiração; a partir daqui é verdade.
    --
    -- CEP DE ENTREGA verdadeiro, na ordem de confiança: o CEP digitado do
    -- convidado (address_data.cep — é para ONDE a mercadoria vai), o CEP do
    -- endereço do logado (linha própria, dono provado no passo 1), e só por
    -- último o CEP da cotação. O CEP DE COTAÇÃO é o que o frete cobrado
    -- promete — os dois sendo iguais é o que a reconciliação cobra.
    v_cep_de_cotacao := NULLIF(regexp_replace(COALESCE(p_destination_cep, ''), '\D', '', 'g'), '');
    v_cep_de_entrega := NULLIF(regexp_replace(COALESCE(p_address_data->>'cep', ''), '\D', '', 'g'), '');
    IF v_cep_de_entrega IS NULL AND v_user_id IS NOT NULL AND p_address_id IS NOT NULL THEN
        SELECT NULLIF(regexp_replace(cep, '\D', '', 'g'), '') INTO v_cep_de_entrega
          FROM public.user_addresses
         WHERE id = p_address_id AND user_id = v_user_id;
    END IF;
    IF v_cep_de_entrega IS NULL THEN
        v_cep_de_entrega := v_cep_de_cotacao;
    END IF;

    -- RECONCILIAÇÃO (item E do laudo): frete cotado para A não pode cobrar
    -- entrega em B. Cotação AUSENTE não contradiz destino nenhum — frete
    -- grátis e taxa fixa sem passagem pela calculadora chegam aqui sem ela,
    -- e o portão de baixo é quem policia esses caminhos.
    IF v_cep_de_cotacao IS NOT NULL AND v_cep_de_entrega IS NOT NULL
       AND v_cep_de_cotacao <> v_cep_de_entrega THEN
        RAISE EXCEPTION 'O frete foi cotado para outro CEP. Volte ao carrinho, calcule o frete para o CEP de entrega e finalize de novo.'
            USING DETAIL = format('Cotação para o CEP %s, entrega para o CEP %s.', v_cep_de_cotacao, v_cep_de_entrega);
    END IF;

    -- CONVIDADO SÓ ENTREGA LOCAL (decisão do Gabriel, 30/08/2026): fora da
    -- área local exige conta — sem cadastro não existe rastreio honesto do
    -- pedido. Sem origem configurada, o aviso é o certo: a loja ainda nem
    -- consegue cotar entrega (B1 do laudo).
    IF v_user_id IS NULL THEN
        IF v_cep_de_entrega IS NULL THEN
            RAISE EXCEPTION 'Informe o CEP de entrega.'
                USING DETAIL = 'Pedido de convidado sem CEP de entrega nenhum.';
        END IF;
        IF COALESCE(v_store_config.origin_cep, '') = '' THEN
            RAISE EXCEPTION 'A loja ainda está configurando a entrega. Fale com a loja.'
                USING DETAIL = 'Convidado exige entrega local, mas a loja não tem CEP de origem.';
        END IF;
        IF NOT public.is_local_cep(v_store_config.origin_cep, v_cep_de_entrega, v_store_config.local_cep_range) THEN
            RAISE EXCEPTION 'Compra sem conta é só com entrega na cidade da loja. Entre na sua conta para receber em outro endereço.'
                USING DETAIL = format('CEP %s fora da faixa local (origem %s).', v_cep_de_entrega, v_store_config.origin_cep);
        END IF;
    END IF;

    -- COBERTURA LOCAL (shipping_coverage = 'local') VALE PARA TODOS: loja
    -- que só entrega na cidade não aceita pedido para fora — nem de cliente
    -- logado, nem de frete grátis passando por cima do portão. Com entrega
    -- desconhecida (nem endereço, nem cotação), falha fechada.
    IF v_store_config.shipping_coverage = 'local' THEN
        IF COALESCE(v_store_config.origin_cep, '') = '' THEN
            RAISE EXCEPTION 'A loja ainda está configurando a entrega. Fale com a loja.'
                USING DETAIL = 'Cobertura local exige CEP de origem configurado.';
        END IF;
        IF v_cep_de_entrega IS NULL THEN
            RAISE EXCEPTION 'Informe o CEP de entrega.'
                USING DETAIL = 'Pedido com cobertura local e sem CEP de entrega nenhum.';
        END IF;
        IF NOT public.is_local_cep(v_store_config.origin_cep, v_cep_de_entrega, v_store_config.local_cep_range) THEN
            RAISE EXCEPTION 'Esta loja só faz entrega na cidade dela. Confira o CEP de entrega.'
                USING DETAIL = format('CEP %s fora da faixa local com cobertura local.', v_cep_de_entrega);
        END IF;
    END IF;

    -- 2-ter. A MODALIDADE DO FRETE MANDA NO MEIO DE PAGAMENTO (regra do
    -- dono, 21/09/2026): envio por TRANSPORTADORA — qualquer id que não
    -- seja "local-delivery" (melhor-envio-*, frenet-*, o gratuito externo
    -- "free-shipping-promo" que a edge calculate-shipping devolve no
    -- caminho de transportadora; INDEPENDENTE DO PREÇO) — exige pagamento
    -- ANTECIPADO. Tudo aqui é provado ANTES do ramo do frete grátis do
    -- bloco 4: o preset gratuito zera o preço SEM validar o id da opção,
    -- e era por esse buraco que um 'local-delivery' forjado (ou um pedido
    -- de transportadora "na entrega", ou um pedido de fora da cidade SEM
    -- escolha nenhuma) nascia com frete R$ 0.
    -- SEM ESCOLHA (EMENDA desta migration): opção ausente NÃO nasce, em
    -- QUALQUER CEP — com ou sem frete grátis, o preset gratuito do bloco 4
    -- não substitui a escolha. Mesma frase do ELSIF do bloco 4: o
    -- classificador do front (src/lib/recusaDoPedido.ts) casa por ela —
    -- leva de volta ao carrinho, onde a calculadora está.
    -- NORMALIZAÇÃO (revisão B4 do parecer): TODAS as comparações daqui
    -- leem v_opcao (o id com btrim/NULLIF aplicados UMA vez, no DECLARE) —
    -- ' local-delivery' e ' flat-fee-1' (espaços de sobra) caem na regra
    -- CERTA. 'LOCAL-DELIVERY' em maiúsculas NÃO casa 'local-delivery' e
    -- cai no ramo transportadora: fail-closed (recusa em vez de aceitar),
    -- aceitável e documentado. O bloco 4 abaixo continua VERBATIM lendo o
    -- parâmetro cru — fora do escopo desta migration.
    IF v_opcao IS NULL THEN
        RAISE EXCEPTION 'Escolha uma opção de entrega antes de finalizar o pedido.'
            USING DETAIL = 'Pedido sem opção de entrega: o servidor não inventa frete nem cobra taxa da loja.';
    ELSIF v_opcao LIKE 'flat-fee-%' THEN
        -- Mesma frase do ELSIF antigo do bloco 4, agora provada ANTES do
        -- gratuito: taxa fixa não existe mais (payload velho ou forjado).
        RAISE EXCEPTION 'Opção de entrega inválida. Volte ao carrinho e escolha uma entrega válida.'
            USING DETAIL = format('O id %s é de taxa fixa, que não existe mais; o servidor não cobra shipping_fee da loja.', v_opcao);
    ELSIF v_opcao = 'local-delivery' THEN
        -- Localidade com o CEP DE ENTREGA verificado no servidor
        -- (v_cep_de_entrega: endereço de dono provado no passo 1, o
        -- CEP digitado do convidado, ou a cotação como último recurso)
        -- contra origin_cep/local_cep_range da store_config — o mesmo
        -- public.is_local_cep do ELSIF do bloco 4 (que continua lá),
        -- só que ANTES do gratuito. FAIL-CLOSED nas duas pontas (revisão
        -- A1 do parecer): origem AUSENTE é recusada ANTES do teste — o
        -- SELECT INTO do passo 2 não reclama linha ausente. CONTRATO FONTE
        -- da is_local_cep (baseline
        -- 20260806000000_baseline_do_schema_vivo.sql:3128): IMMUTABLE e
        -- NÃO STRICT — origem/destino vazio devolve FALSE (nunca NULL) e
        -- faixa NULL é SEMÂNTICA VÁLIDA (compara os 5 primeiros dígitos de
        -- origem e destino; NÃO há, nem deve haver, bloqueio de faixa
        -- NULL). Aqui o predicado é a forma fail-closed —
        -- COALESCE(..., false) = false — defesa em profundidade: se a
        -- função um dia virar STRICT ou devolver NULL, NULL vira false,
        -- que RECUSA em vez de passar.
        -- A frase da origem ausente é a MESMA JÁ CLASSIFICADA do 2-bis
        -- (entrar_na_conta no front). O 2-bis pré-existente acima não foi
        -- expandido (gate de verificação separado, fora do escopo).
        -- Sem CEP de entrega nenhum: falha fechada. Mesma frase do ELSIF:
        -- o classificador do front (src/lib/recusaDoPedido.ts) casa por
        -- ela. O DETAIL faz local_cep_range::text EXPLÍCITO (revisão A2):
        -- sem o cast, coluna numérica faria o '' da COALESCE resolver
        -- para numeric e o erro de cast só apareceria NO DIA da recusa.
        IF COALESCE(v_store_config.origin_cep, '') = '' THEN
            RAISE EXCEPTION 'A loja ainda está configurando a entrega. Fale com a loja.'
                USING DETAIL = 'Entrega local exige CEP de origem configurado.';
        END IF;
        IF v_cep_de_entrega IS NULL
           OR COALESCE(public.is_local_cep(v_store_config.origin_cep, v_cep_de_entrega, v_store_config.local_cep_range), false) = false THEN
            RAISE EXCEPTION 'Entrega local não disponível para o CEP informado.'
                USING DETAIL = format('id local-delivery com CEP de entrega %s fora da área local (origem %s, faixa %s) — provado antes do ramo do frete grátis.',
                    COALESCE(v_cep_de_entrega, 'ausente'), COALESCE(v_store_config.origin_cep, ''), COALESCE(v_store_config.local_cep_range::text, ''));
        END IF;
    ELSE
        -- A v23 é a RPC do pagamento NA ENTREGA: não gera cobrança
        -- nem grava 'aguardando'/expires_at — transporte só combina
        -- com a v24 + online (PIX pago no app). Transportadora é
        -- RECUSADA SEMPRE aqui, inclusive com p_payment_method
        -- = 'online': quem paga antecipado entra pela v24.
        RAISE EXCEPTION 'Envio por transportadora exige pagamento antecipado. Pague com PIX no app para finalizar este envio.'
            USING DETAIL = format('A RPC do pagamento na entrega (v23) não aceita envio por transportadora; opção recebida: %s.', v_opcao);
    END IF;

    -- 3. Validation Loop (Price, Stock Lock, Subtotal Calculation)
    FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
    LOOP
        v_product_id := (v_item->>'product_id')::uuid;
        v_variant_id := (v_item->>'variant_id')::uuid;
        v_quantity := (v_item->>'quantity')::integer;

        IF v_quantity <= 0 THEN RAISE EXCEPTION 'Quantidade inválida para um dos itens.'; END IF;

        IF v_variant_id IS NOT NULL THEN
            SELECT COALESCE(v.price_override, p.preco_venda), v.stock_increment, p.nome, p.frete_gratis
            INTO v_db_price, v_db_stock, v_item_name, v_frete_gratis
            FROM public.produtos p
            JOIN public.product_variants v ON v.product_id = p.id
            WHERE v.id = v_variant_id AND p.id = v_product_id
              AND v.active = true AND p.ativo = true
            FOR NO KEY UPDATE OF v;
        ELSE
            -- A trava de linha vem PRIMEIRO: o SELECT abaixo ja exige
            -- `ativo = true` e trava a linha com `FOR NO KEY UPDATE`, entao a
            -- guarda que vem depois nao tem janela de corrida contra um
            -- UPDATE concorrente em `produtos.ativo`. Com a guarda ANTES (a
            -- forma anterior, com EXISTS + JOIN em `produtos`), ela e o
            -- SELECT tomavam SNAPSHOTS DIFERENTES sob READ COMMITTED: se a
            -- lojista republicasse o produto e commitasse ENTRE os dois
            -- comandos, a guarda nao disparava (produto estava inativo no
            -- primeiro snapshot) e o SELECT achava o produto ativo no
            -- segundo -- o item era vendido pelo preco/estoque do produto
            -- base mesmo tendo variacao ativa. Nesta ordem nao ha segundo
            -- snapshot: os dois leem a MESMA linha, ja travada.
            SELECT preco_venda, estoque, nome, frete_gratis
            INTO v_db_price, v_db_stock, v_item_name, v_frete_gratis
            FROM public.produtos
            WHERE id = v_product_id AND ativo = true
            FOR NO KEY UPDATE;

            -- 🔴 A GUARDA QUE FALTAVA. Sem ela, `variant_id: null` num produto
            -- QUE TEM variacao caia aqui e era aceito: preco de `preco_venda`
            -- em vez de `price_override`, e baixa no `estoque` agregado em vez
            -- do `stock_increment` da variacao escolhida. O pedido nascia sem
            -- tamanho, a lojista nao tinha o que separar, e o estoque daquele
            -- tamanho nunca descia -- vendendo de novo o que ja acabou.
            --
            -- Ate hoje quem segurava isso eram QUATRO copias de um `if` no
            -- cliente. Cada tela nova reabre o buraco, e nenhuma delas alcanca
            -- quem chama a RPC direto.
            --
            -- `v_db_price IS NOT NULL` e o teste de "produto ativo" -- substitui
            -- o JOIN com `produtos` que a guarda tinha antes de mudar de lugar.
            -- Se o SELECT acima nao achou linha (produto inativo), v_db_price
            -- fica NULL, a guarda nem dispara (curto-circuito do AND), e quem
            -- recusa e o `IF v_db_price IS NULL` logo abaixo, com "Produto %
            -- nao disponivel" -- a mensagem certa para um produto fora da
            -- vitrine, nao "Escolha uma variacao" (instrucao impossivel de
            -- seguir para quem nao pode comprar aquele produto de jeito
            -- nenhum). `v.active = true` sozinho, sem JOIN em `produtos`, e o
            -- mesmo predicado que o ramo de cima usa para ACEITAR uma
            -- variacao -- produto cujas variacoes foram TODAS desativadas
            -- continua vendavel pelo produto base.
            IF v_db_price IS NOT NULL AND EXISTS (
                SELECT 1
                FROM public.product_variants v
                WHERE v.product_id = v_product_id
                  AND v.active = true
            ) THEN
                RAISE EXCEPTION 'Escolha uma variação para o produto %.',
                    COALESCE((SELECT nome FROM public.produtos WHERE id = v_product_id), 'selecionado')
                    USING DETAIL = 'variant_id ausente em produto com variacao ativa; o item foi recusado no servidor.';
            END IF;
        END IF;

        IF v_db_price IS NULL THEN RAISE EXCEPTION 'Produto % não disponível.', COALESCE(v_item_name, 'não encontrado'); END IF;
        IF v_db_stock < v_quantity THEN
            RAISE EXCEPTION 'Estoque insuficiente para o produto % (Disponível: %, Solicitado: %)', v_item_name, v_db_stock, v_quantity;
        END IF;

        v_calculated_subtotal := v_calculated_subtotal + (v_db_price * v_quantity);
        IF v_frete_gratis = true THEN
            v_has_free_shipping_item := true;
        END IF;
    END LOOP;

    -- 4. Shipping Calculation
    -- FRETE V2 (20261081000000): a regra de frete grátis passa a ser a MESMA
    -- dos presets do front (src/lib/presets-de-frete-gratis.ts) — modelo
    -- EXCLUSIVO: a estratégia gravada em free_shipping_min é a única que
    -- vale. A marcação de item grátis vem do BANCO (produtos.frete_gratis,
    -- lida no loop de validação pelo product_id — nunca do payload).
    -- Sentinelas (mesmas do front):
    --   < 0    -> por_produto: só item marcado zera o frete
    --   = 0.01 -> sempre: todo pedido é grátis
    --   > 0    -> acima_de_valor: subtotal atinge o limiar (SEM trava de
    --             login — a trava v_user_id IS NOT NULL morreu: convidado
    --             tem o mesmo direito; a entrega dele é local e o portão
    --             de CEP continua nos ELSIFs abaixo)
    --   0/NULL -> desligado: nada é grátis aqui (cai nos ELSIFs)
    v_free_shipping_min := COALESCE(v_store_config.free_shipping_min, 0);

    IF (v_free_shipping_min < 0 AND v_has_free_shipping_item = true)
       OR v_free_shipping_min = 0.01
       OR (v_free_shipping_min > 0 AND v_calculated_subtotal >= v_free_shipping_min)
    THEN
        v_shipping_validated := 0;

    -- FRETE V2 EMENDA (03/09, ordem do dono "entrega fixa não faz sentido
    -- existir"): pedido SEM opção de entrega escolhida NÃO NASCE — o
    -- COALESCE(shipping_fee, 0) daqui cobrava preço inventado ou zero.
    ELSIF p_shipping_option_id IS NULL OR p_shipping_option_id = '' THEN
        RAISE EXCEPTION 'Escolha uma opção de entrega antes de finalizar o pedido.'
            USING DETAIL = 'Pedido sem opção de entrega: o servidor não inventa frete nem cobra taxa da loja.';

    -- FRETE V2 EMENDA (03/09): o id `flat-fee-%` deixou de ser escolha válida
    -- — a taxa fixa morreu na edge (calculate-shipping) e aqui no servidor.
    -- Recebê-lo é payload velho ou forjado: falha fechada, NUNCA o
    -- shipping_fee da loja.
    ELSIF p_shipping_option_id LIKE 'flat-fee-%' THEN
        RAISE EXCEPTION 'Opção de entrega inválida. Volte ao carrinho e escolha uma entrega válida.'
            USING DETAIL = format('O id %s é de taxa fixa, que não existe mais; o servidor não cobra shipping_fee da loja.', p_shipping_option_id);

    ELSIF p_shipping_option_id = 'local-delivery' THEN
        v_dest_cep := regexp_replace(COALESCE(p_destination_cep, ''), '\D', '', 'g');
        IF public.is_local_cep(v_store_config.origin_cep, v_dest_cep, v_store_config.local_cep_range) THEN
            v_shipping_validated := COALESCE(v_store_config.local_delivery_fee, 0);
        ELSE
            RAISE EXCEPTION 'Entrega local não disponível para o CEP informado.'
                USING DETAIL = format('CEP %s fora da faixa local configurada.', v_dest_cep);
        END IF;

    ELSIF p_destination_cep IS NOT NULL THEN
        v_dest_cep := regexp_replace(p_destination_cep, '\D', '', 'g');

        -- Cotação de transportadora: o preço sai do que o SERVIDOR gravou,
        -- nunca do que o cliente enviou.
        SELECT (opt->>'price')::numeric
          INTO v_shipping_validated
          FROM public.shipping_quotes_cache q,
               LATERAL jsonb_array_elements(q.options) AS opt
         WHERE regexp_replace(q.destination_cep, '\D', '', 'g') = v_dest_cep
           AND regexp_replace(COALESCE(q.origin_cep, ''), '\D', '', 'g')
               = regexp_replace(COALESCE(v_store_config.origin_cep, ''), '\D', '', 'g')
           AND q.created_at > now() - interval '24 hours'
           AND opt->>'id' = p_shipping_option_id
           -- 🔴 A COTACAO TEM DE SER DO CARRINHO QUE ESTA SENDO COMPRADO.
           -- Sem esta condicao dava para cotar o frete com um carrinho pequeno,
           -- encher o carrinho e fechar o pedido pagando o frete do pequeno --
           -- a diferenca saindo do bolso da lojista.
           --
           -- Comparo CONJUNTO contra CONJUNTO, nao texto contra texto. O
           -- `cart_hash` e serializado pela edge function em JavaScript
           -- (getCartHash, calculate-shipping/index.ts): ordenacao por
           -- localeCompare, variante vazia como '', quantidade ausente como 1.
           -- Recompor esse texto aqui obrigaria o banco a reproduzir cada um
           -- desses detalhes, e CADA UM e uma chance de recusar pedido HONESTO
           -- no ultimo clique. Desmontando os dois lados em (produto, variante,
           -- quantidade) e ordenando AQUI, a ordem do JavaScript deixa de
           -- importar. (Medido em 22/08/2026: neste banco localeCompare e o
           -- ORDER BY do Postgres CONCORDAM, en_US.UTF-8 -- mas isso e
           -- propriedade da collation, nao do desenho, e este app e um molde
           -- que nasce em bancos novos.)
           --
           -- Usa `=`, nao IS NOT DISTINCT FROM: com entrada estragada o
           -- resultado e NULL, a linha nao casa, e o pedido e RECUSADO. Falha
           -- fechado, como o resto do caminho do dinheiro.
           AND (SELECT array_agg(x ORDER BY x) FROM (
                  SELECT split_part(t, ':', 1) || ':' ||
                         split_part(t, ':', 2) || ':' ||
                         split_part(t, ':', 3) AS x
                    FROM unnest(string_to_array(q.cart_hash, ',')) AS t
                ) itens_da_cotacao)
             = (SELECT array_agg(x ORDER BY x) FROM (
                  SELECT COALESCE(i->>'product_id', '') || ':' ||
                         COALESCE(i->>'variant_id', '') || ':' ||
                         COALESCE(i->>'quantity', '1') AS x
                    FROM jsonb_array_elements(p_items) AS i
                ) itens_do_pedido)
         ORDER BY q.created_at DESC
         LIMIT 1;

        IF v_shipping_validated IS NULL THEN
            RAISE EXCEPTION 'A cotação de frete expirou. Calcule o frete novamente e refaça o pedido.'
                USING DETAIL = format(
                    'Sem cotação válida nas últimas 24h para cep=%s, opção=%s -- ou a cotação encontrada era de OUTRO carrinho.',
                    v_dest_cep, p_shipping_option_id
                );
        END IF;

    ELSE
        -- FRETE V2 EMENDA (03/09): id não reconhecido — não é entrega local,
        -- não é cotação de transportadora, e sem CEP não há onde reconciliar.
        -- Antes caía em COALESCE(shipping_fee, 0): preço inventado ou zero.
        -- Falha fechada, como o resto do caminho do dinheiro.
        RAISE EXCEPTION 'Opção de entrega não reconhecida. Volte ao carrinho, calcule o frete e finalize de novo.'
            USING DETAIL = format('O id %s não é entrega local nem cotação gravada, e não há CEP de cotação para reconciliar.', p_shipping_option_id);
    END IF;

    -- 5. Coupon Validation
    IF p_coupon_code IS NOT NULL AND p_coupon_code != '' THEN
        SELECT id, value, type INTO v_coupon_id, v_coupon_val, v_coupon_type
        FROM public.coupons
        WHERE UPPER(code) = UPPER(p_coupon_code)
          AND active = true
          AND (valid_until IS NULL OR valid_until > now())
          AND (usage_limit IS NULL OR usage_limit <= 0 OR usage_count < usage_limit)
          AND (min_purchase IS NULL OR v_calculated_subtotal >= min_purchase)
          FOR UPDATE;

        IF v_coupon_id IS NULL THEN
            -- Achado 16 do laudo (29/08): o WHERE acima junta TODAS as
            -- condições (ativa, validade, limite, mínimo) e um único RAISE
            -- respondia por todas: o cliente recusado por mínimo de carrinho
            -- lia "inválido ou expirado" e nunca soube o motivo. Descobre o
            -- PORQUÊ real e diz; a frase antiga fica só para a corrida
            -- residual (cupom mudou entre as duas consultas).
            SELECT active, valid_until, usage_limit, usage_count, min_purchase
            INTO v_cupom_recusado
            FROM public.coupons
            WHERE UPPER(code) = UPPER(p_coupon_code)
            FOR SHARE;

            IF NOT FOUND THEN
                RAISE EXCEPTION 'O cupom % não existe. Confira o código.', p_coupon_code;
            ELSIF NOT v_cupom_recusado.active THEN
                RAISE EXCEPTION 'O cupom % está desativado pela loja.', p_coupon_code;
            ELSIF v_cupom_recusado.valid_until IS NOT NULL AND v_cupom_recusado.valid_until <= now() THEN
                RAISE EXCEPTION 'O cupom % expirou em %.', p_coupon_code, to_char(v_cupom_recusado.valid_until, 'DD/MM/YYYY HH24:MI');
            ELSIF v_cupom_recusado.usage_limit IS NOT NULL AND v_cupom_recusado.usage_limit > 0 AND v_cupom_recusado.usage_count >= v_cupom_recusado.usage_limit THEN
                RAISE EXCEPTION 'O cupom % já atingiu o limite de usos.', p_coupon_code;
            ELSIF v_cupom_recusado.min_purchase IS NOT NULL AND v_cupom_recusado.min_purchase > v_calculated_subtotal THEN
                RAISE EXCEPTION 'O cupom % exige uma compra mínima de R$ %.', p_coupon_code, translate(to_char(v_cupom_recusado.min_purchase, 'FM999999999990.00'), '.', ',');
            ELSE
                RAISE EXCEPTION 'Cupom % inválido ou expirado.', p_coupon_code;
            END IF;
        END IF;

        IF v_coupon_type = 'percentage' THEN
            v_discount_amount := (v_calculated_subtotal * v_coupon_val) / 100;
        ELSE
            v_discount_amount := v_coupon_val;
        END IF;

        IF v_discount_amount > v_calculated_subtotal THEN
            v_discount_amount := v_calculated_subtotal;
        END IF;
    END IF;

    v_calculated_total := GREATEST(0, v_calculated_subtotal + v_shipping_validated - v_discount_amount);

    -- 6. Price Tampering Protection
    IF ABS(v_calculated_total - p_total_amount) > 0.05 THEN
        RAISE EXCEPTION 'Os valores do pedido mudaram. Atualize o carrinho e tente novamente.'
            USING DETAIL = format(
                'Divergência de total. Calculado: %s (subtotal %s + frete %s - desconto %s), Fornecido: %s. Autenticado: %s. Opção de frete: %s.',
                v_calculated_total, v_calculated_subtotal, v_shipping_validated,
                v_discount_amount, p_total_amount, (v_user_id IS NOT NULL),
                COALESCE(p_shipping_option_id, 'padrão')
            );
    END IF;

    -- 7. Create Order Header
    BEGIN
        INSERT INTO public.marketplace_orders (
        user_id, total, shipping, payment_method, address_id,
        coupon_id, status, notes, customer_name, customer_data,
        subtotal, discount, coupon_code,
        idempotency_key
    ) VALUES (
        v_user_id, v_calculated_total, v_shipping_validated, p_payment_method, p_address_id,
        v_coupon_id, 'pending', p_observation, p_customer_name,
        jsonb_build_object(
            'whatsapp', p_customer_phone,
            'address_id', p_address_id,
            'address', p_address_data,
            'shipping_option_id', p_shipping_option_id,
            'destination_cep', v_dest_cep
        ),
        v_calculated_subtotal, v_discount_amount, p_coupon_code,
        p_idempotency_key
    ) RETURNING id INTO v_order_id;

    EXCEPTION
        WHEN unique_violation THEN
            -- A corrida PERDEU: a requisição gêmea com a MESMA chave
            -- commitou primeiro. Devolvo o pedido dela. Se a chave casar
            -- sem dono legítimo (compartilhamento de sessão entre contas),
            -- falho fechado: nenhum pedido nasce daqui.
            SELECT id INTO v_order_id
              FROM public.marketplace_orders
             WHERE idempotency_key = p_idempotency_key
               AND (v_user_id IS NULL OR user_id IS NOT DISTINCT FROM v_user_id);
            IF v_order_id IS NULL THEN
                RAISE EXCEPTION 'Não foi possível criar o pedido. Atualize a página e tente de novo.';
            END IF;
            RETURN v_order_id;
    END;

    -- 8. Atomic Inventory Update and Order Items Insertion
    FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
    LOOP
        v_product_id := (v_item->>'product_id')::uuid;
        v_variant_id := (v_item->>'variant_id')::uuid;
        v_quantity := (v_item->>'quantity')::integer;

        IF v_variant_id IS NOT NULL THEN
            UPDATE public.product_variants
            SET stock_increment = stock_increment - v_quantity
            WHERE id = v_variant_id AND stock_increment >= v_quantity;

            GET DIAGNOSTICS v_rows_affected = ROW_COUNT;
            IF v_rows_affected = 0 THEN
                SELECT p.nome INTO v_item_name FROM public.produtos p JOIN public.product_variants v ON v.product_id = p.id WHERE v.id = v_variant_id;
                RAISE EXCEPTION 'Estoque insuficiente para o produto %', v_item_name;
            END IF;

            SELECT COALESCE(v.price_override, p.preco_venda), p.nome
            INTO v_db_price, v_item_name
            FROM public.produtos p
            JOIN public.product_variants v ON v.product_id = p.id
            WHERE v.id = v_variant_id;
        ELSE
            UPDATE public.produtos
            SET estoque = estoque - v_quantity
            WHERE id = v_product_id AND estoque >= v_quantity;

            GET DIAGNOSTICS v_rows_affected = ROW_COUNT;
            IF v_rows_affected = 0 THEN
                SELECT nome INTO v_item_name FROM public.produtos WHERE id = v_product_id;
                RAISE EXCEPTION 'Estoque insuficiente para o produto %', v_item_name;
            END IF;

            SELECT preco_venda, nome INTO v_db_price, v_item_name FROM public.produtos WHERE id = v_product_id;
        END IF;

        INSERT INTO public.marketplace_order_items (
            order_id, product_id, variant_id, quantity, price, product_name
        ) VALUES (
            v_order_id, v_product_id, v_variant_id, v_quantity, v_db_price, v_item_name
        );
    END LOOP;

    -- 9. Coupon Usage Update
    IF v_coupon_id IS NOT NULL THEN
        UPDATE public.coupons SET usage_count = usage_count + 1 WHERE id = v_coupon_id;
    END IF;

    RETURN v_order_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.create_marketplace_order_v24(p_items jsonb, p_total_amount numeric, p_shipping_cost numeric, p_payment_method text, p_address_id uuid, p_coupon_code text, p_customer_name text, p_customer_phone text, p_observation text, p_address_data jsonb, p_destination_cep text, p_shipping_option_id text, p_idempotency_key uuid DEFAULT NULL)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
    v_user_id uuid := auth.uid();
    v_order_id uuid;
    v_item jsonb;
    v_product_id uuid;
    v_variant_id uuid;
    v_quantity integer;
    v_item_name text;
    v_rows_affected integer;

    v_db_price numeric;
    v_db_stock integer;
    v_calculated_subtotal numeric := 0;
    v_calculated_total numeric := 0;
    v_discount_amount numeric := 0;
    v_coupon_id uuid;

    v_store_config RECORD;
    v_shipping_validated numeric;
    v_frete_gratis boolean;
    v_has_free_shipping_item boolean := false;
    v_free_shipping_min numeric;
    v_dest_cep text;

    v_coupon_type text;
    v_cupom_recusado RECORD;
    v_coupon_val numeric;

    -- O PORTÃO DE ENTREGA (20261039000000): onde se cotou × onde se entrega.
    v_cep_de_cotacao text;
    v_cep_de_entrega text;

    -- 2-ter (20261168000000, revisão B4): o id da opção de entrega
    -- NORMALIZADO uma única vez — NULLIF(btrim(...)) — lido por TODAS as
    -- comparações do bloco 2-ter (NULL, flat-fee, local-delivery). O
    -- bloco 4 segue lendo o parâmetro cru, VERBATIM (fora do escopo).
    v_opcao text := NULLIF(btrim(p_shipping_option_id), '');
BEGIN

    -- 0. IDEMPOTÊNCIA DA CRIAÇÃO (laudo caça-bugs do molde, 31/08/2026, A1):
    -- a rede pode cair DEPOIS do commit deste pedido. A retentativa honesta
    -- (mesmo clique repetido, F5, mesmo navegador) REPETE a chave da compra
    -- e tem de receber o pedido que JÁ NASCEU — não criar um gêmeo com
    -- estoque e cupom debitados em dobro. Convidado não tem user_id para
    -- amarrar: a chave uuid aleatória É o segredo da compra. Quem está
    -- logado só recupera pedido próprio.
    IF p_idempotency_key IS NOT NULL THEN
        SELECT id INTO v_order_id
          FROM public.marketplace_orders
         WHERE idempotency_key = p_idempotency_key
           AND (v_user_id IS NULL OR user_id IS NOT DISTINCT FROM v_user_id);
        IF v_order_id IS NOT NULL THEN
            RETURN v_order_id;
        END IF;
    END IF;

    -- 1. Address Ownership Check (Only if user is logged in)
    IF p_address_id IS NOT NULL AND v_user_id IS NOT NULL THEN
        IF NOT EXISTS (SELECT 1 FROM user_addresses WHERE id = p_address_id AND user_id = v_user_id) THEN
            RAISE EXCEPTION 'Endereço inválido ou não pertence ao usuário.';
        END IF;
    END IF;

    -- 2. Store Config
    SELECT * INTO v_store_config FROM public.store_config WHERE id = 1;

    -- 2-bis. O PORTÃO DE ENTREGA MORA AQUI (laudo caça-bugs do molde,
    -- 31/08/2026, A2 + item E). Até hoje a regra do convidado (só entrega
    -- local, decisão do Gabriel de 30/08) e a cobertura da loja
    -- (store_config.shipping_coverage) existiam SÓ na tela: chamando esta
    -- RPC direto, QUALQUER CEP passava — e o caminho flat-fee-* nem olhava
    -- CEP. O comentário do cep-local.ts ("a decisão final é do servidor")
    -- era aspiração; a partir daqui é verdade.
    --
    -- CEP DE ENTREGA verdadeiro, na ordem de confiança: o CEP digitado do
    -- convidado (address_data.cep — é para ONDE a mercadoria vai), o CEP do
    -- endereço do logado (linha própria, dono provado no passo 1), e só por
    -- último o CEP da cotação. O CEP DE COTAÇÃO é o que o frete cobrado
    -- promete — os dois sendo iguais é o que a reconciliação cobra.
    v_cep_de_cotacao := NULLIF(regexp_replace(COALESCE(p_destination_cep, ''), '\D', '', 'g'), '');
    v_cep_de_entrega := NULLIF(regexp_replace(COALESCE(p_address_data->>'cep', ''), '\D', '', 'g'), '');
    IF v_cep_de_entrega IS NULL AND v_user_id IS NOT NULL AND p_address_id IS NOT NULL THEN
        SELECT NULLIF(regexp_replace(cep, '\D', '', 'g'), '') INTO v_cep_de_entrega
          FROM public.user_addresses
         WHERE id = p_address_id AND user_id = v_user_id;
    END IF;
    IF v_cep_de_entrega IS NULL THEN
        v_cep_de_entrega := v_cep_de_cotacao;
    END IF;

    -- RECONCILIAÇÃO (item E do laudo): frete cotado para A não pode cobrar
    -- entrega em B. Cotação AUSENTE não contradiz destino nenhum — frete
    -- grátis e taxa fixa sem passagem pela calculadora chegam aqui sem ela,
    -- e o portão de baixo é quem policia esses caminhos.
    IF v_cep_de_cotacao IS NOT NULL AND v_cep_de_entrega IS NOT NULL
       AND v_cep_de_cotacao <> v_cep_de_entrega THEN
        RAISE EXCEPTION 'O frete foi cotado para outro CEP. Volte ao carrinho, calcule o frete para o CEP de entrega e finalize de novo.'
            USING DETAIL = format('Cotação para o CEP %s, entrega para o CEP %s.', v_cep_de_cotacao, v_cep_de_entrega);
    END IF;

    -- CONVIDADO SÓ ENTREGA LOCAL (decisão do Gabriel, 30/08/2026): fora da
    -- área local exige conta — sem cadastro não existe rastreio honesto do
    -- pedido. Sem origem configurada, o aviso é o certo: a loja ainda nem
    -- consegue cotar entrega (B1 do laudo).
    IF v_user_id IS NULL THEN
        IF v_cep_de_entrega IS NULL THEN
            RAISE EXCEPTION 'Informe o CEP de entrega.'
                USING DETAIL = 'Pedido de convidado sem CEP de entrega nenhum.';
        END IF;
        IF COALESCE(v_store_config.origin_cep, '') = '' THEN
            RAISE EXCEPTION 'A loja ainda está configurando a entrega. Fale com a loja.'
                USING DETAIL = 'Convidado exige entrega local, mas a loja não tem CEP de origem.';
        END IF;
        IF NOT public.is_local_cep(v_store_config.origin_cep, v_cep_de_entrega, v_store_config.local_cep_range) THEN
            RAISE EXCEPTION 'Compra sem conta é só com entrega na cidade da loja. Entre na sua conta para receber em outro endereço.'
                USING DETAIL = format('CEP %s fora da faixa local (origem %s).', v_cep_de_entrega, v_store_config.origin_cep);
        END IF;
    END IF;

    -- COBERTURA LOCAL (shipping_coverage = 'local') VALE PARA TODOS: loja
    -- que só entrega na cidade não aceita pedido para fora — nem de cliente
    -- logado, nem de frete grátis passando por cima do portão. Com entrega
    -- desconhecida (nem endereço, nem cotação), falha fechada.
    IF v_store_config.shipping_coverage = 'local' THEN
        IF COALESCE(v_store_config.origin_cep, '') = '' THEN
            RAISE EXCEPTION 'A loja ainda está configurando a entrega. Fale com a loja.'
                USING DETAIL = 'Cobertura local exige CEP de origem configurado.';
        END IF;
        IF v_cep_de_entrega IS NULL THEN
            RAISE EXCEPTION 'Informe o CEP de entrega.'
                USING DETAIL = 'Pedido com cobertura local e sem CEP de entrega nenhum.';
        END IF;
        IF NOT public.is_local_cep(v_store_config.origin_cep, v_cep_de_entrega, v_store_config.local_cep_range) THEN
            RAISE EXCEPTION 'Esta loja só faz entrega na cidade dela. Confira o CEP de entrega.'
                USING DETAIL = format('CEP %s fora da faixa local com cobertura local.', v_cep_de_entrega);
        END IF;
    END IF;

    -- 2-ter. A MODALIDADE DO FRETE MANDA NO MEIO DE PAGAMENTO (regra do
    -- dono, 21/09/2026): envio por TRANSPORTADORA — qualquer id que não
    -- seja "local-delivery" (melhor-envio-*, frenet-*, o gratuito externo
    -- "free-shipping-promo" que a edge calculate-shipping devolve no
    -- caminho de transportadora; INDEPENDENTE DO PREÇO) — exige pagamento
    -- ANTECIPADO. Tudo aqui é provado ANTES do ramo do frete grátis do
    -- bloco 4: o preset gratuito zera o preço SEM validar o id da opção,
    -- e era por esse buraco que um 'local-delivery' forjado (ou um pedido
    -- de transportadora "na entrega", ou um pedido de fora da cidade SEM
    -- escolha nenhuma) nascia com frete R$ 0.
    -- SEM ESCOLHA (EMENDA desta migration): opção ausente NÃO nasce, em
    -- QUALQUER CEP — com ou sem frete grátis, o preset gratuito do bloco 4
    -- não substitui a escolha. Mesma frase do ELSIF do bloco 4: o
    -- classificador do front (src/lib/recusaDoPedido.ts) casa por ela —
    -- leva de volta ao carrinho, onde a calculadora está.
    -- NORMALIZAÇÃO (revisão B4 do parecer): TODAS as comparações daqui
    -- leem v_opcao (o id com btrim/NULLIF aplicados UMA vez, no DECLARE) —
    -- ' local-delivery' e ' flat-fee-1' (espaços de sobra) caem na regra
    -- CERTA. 'LOCAL-DELIVERY' em maiúsculas NÃO casa 'local-delivery' e
    -- cai no ramo transportadora: fail-closed (recusa em vez de aceitar),
    -- aceitável e documentado. O bloco 4 abaixo continua VERBATIM lendo o
    -- parâmetro cru — fora do escopo desta migration.
    IF v_opcao IS NULL THEN
        RAISE EXCEPTION 'Escolha uma opção de entrega antes de finalizar o pedido.'
            USING DETAIL = 'Pedido sem opção de entrega: o servidor não inventa frete nem cobra taxa da loja.';
    ELSIF v_opcao LIKE 'flat-fee-%' THEN
        -- Mesma frase do ELSIF antigo do bloco 4, agora provada ANTES do
        -- gratuito: taxa fixa não existe mais (payload velho ou forjado).
        RAISE EXCEPTION 'Opção de entrega inválida. Volte ao carrinho e escolha uma entrega válida.'
            USING DETAIL = format('O id %s é de taxa fixa, que não existe mais; o servidor não cobra shipping_fee da loja.', v_opcao);
    ELSIF v_opcao = 'local-delivery' THEN
        -- Localidade com o CEP DE ENTREGA verificado no servidor
        -- (v_cep_de_entrega: endereço de dono provado no passo 1, o
        -- CEP digitado do convidado, ou a cotação como último recurso)
        -- contra origin_cep/local_cep_range da store_config — o mesmo
        -- public.is_local_cep do ELSIF do bloco 4 (que continua lá),
        -- só que ANTES do gratuito. FAIL-CLOSED nas duas pontas (revisão
        -- A1 do parecer): origem AUSENTE é recusada ANTES do teste — o
        -- SELECT INTO do passo 2 não reclama linha ausente. CONTRATO FONTE
        -- da is_local_cep (baseline
        -- 20260806000000_baseline_do_schema_vivo.sql:3128): IMMUTABLE e
        -- NÃO STRICT — origem/destino vazio devolve FALSE (nunca NULL) e
        -- faixa NULL é SEMÂNTICA VÁLIDA (compara os 5 primeiros dígitos de
        -- origem e destino; NÃO há, nem deve haver, bloqueio de faixa
        -- NULL). Aqui o predicado é a forma fail-closed —
        -- COALESCE(..., false) = false — defesa em profundidade: se a
        -- função um dia virar STRICT ou devolver NULL, NULL vira false,
        -- que RECUSA em vez de passar.
        -- A frase da origem ausente é a MESMA JÁ CLASSIFICADA do 2-bis
        -- (entrar_na_conta no front). O 2-bis pré-existente acima não foi
        -- expandido (gate de verificação separado, fora do escopo).
        -- Sem CEP de entrega nenhum: falha fechada. Mesma frase do ELSIF:
        -- o classificador do front (src/lib/recusaDoPedido.ts) casa por
        -- ela. O DETAIL faz local_cep_range::text EXPLÍCITO (revisão A2):
        -- sem o cast, coluna numérica faria o '' da COALESCE resolver
        -- para numeric e o erro de cast só apareceria NO DIA da recusa.
        IF COALESCE(v_store_config.origin_cep, '') = '' THEN
            RAISE EXCEPTION 'A loja ainda está configurando a entrega. Fale com a loja.'
                USING DETAIL = 'Entrega local exige CEP de origem configurado.';
        END IF;
        IF v_cep_de_entrega IS NULL
           OR COALESCE(public.is_local_cep(v_store_config.origin_cep, v_cep_de_entrega, v_store_config.local_cep_range), false) = false THEN
            RAISE EXCEPTION 'Entrega local não disponível para o CEP informado.'
                USING DETAIL = format('id local-delivery com CEP de entrega %s fora da área local (origem %s, faixa %s) — provado antes do ramo do frete grátis.',
                    COALESCE(v_cep_de_entrega, 'ausente'), COALESCE(v_store_config.origin_cep, ''), COALESCE(v_store_config.local_cep_range::text, ''));
        END IF;
    ELSE
        -- A v24 é a RPC do pagamento ANTECIPADO: transportadora
        -- combina com 'online' (PIX pago no app; pagamento online
        -- exige conta, P6) e com MAIS NINGUÉM — pix/card/cash
        -- prometem dinheiro na porta de um correio de outra cidade.
        IF p_payment_method IS DISTINCT FROM 'online' THEN
            RAISE EXCEPTION 'Envio por transportadora exige pagamento antecipado. Pague com PIX no app para finalizar este envio.'
                USING DETAIL = format('Opção de frete %s com meio de pagamento %s: com transportadora, só online passa.', v_opcao, COALESCE(p_payment_method, 'ausente'));
        END IF;
    END IF;

    -- 3. Validation Loop (Price, Stock Lock, Subtotal Calculation)
    FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
    LOOP
        v_product_id := (v_item->>'product_id')::uuid;
        v_variant_id := (v_item->>'variant_id')::uuid;
        v_quantity := (v_item->>'quantity')::integer;

        IF v_quantity <= 0 THEN RAISE EXCEPTION 'Quantidade inválida para um dos itens.'; END IF;

        IF v_variant_id IS NOT NULL THEN
            SELECT COALESCE(v.price_override, p.preco_venda), v.stock_increment, p.nome, p.frete_gratis
            INTO v_db_price, v_db_stock, v_item_name, v_frete_gratis
            FROM public.produtos p
            JOIN public.product_variants v ON v.product_id = p.id
            WHERE v.id = v_variant_id AND p.id = v_product_id
              AND v.active = true AND p.ativo = true
            FOR NO KEY UPDATE OF v;
        ELSE
            -- A trava de linha vem PRIMEIRO: o SELECT abaixo ja exige
            -- `ativo = true` e trava a linha com `FOR NO KEY UPDATE`, entao a
            -- guarda que vem depois nao tem janela de corrida contra um
            -- UPDATE concorrente em `produtos.ativo`. Com a guarda ANTES (a
            -- forma anterior, com EXISTS + JOIN em `produtos`), ela e o
            -- SELECT tomavam SNAPSHOTS DIFERENTES sob READ COMMITTED: se a
            -- lojista republicasse o produto e commitasse ENTRE os dois
            -- comandos, a guarda nao disparava (produto estava inativo no
            -- primeiro snapshot) e o SELECT achava o produto ativo no
            -- segundo -- o item era vendido pelo preco/estoque do produto
            -- base mesmo tendo variacao ativa. Nesta ordem nao ha segundo
            -- snapshot: os dois leem a MESMA linha, ja travada.
            SELECT preco_venda, estoque, nome, frete_gratis
            INTO v_db_price, v_db_stock, v_item_name, v_frete_gratis
            FROM public.produtos
            WHERE id = v_product_id AND ativo = true
            FOR NO KEY UPDATE;

            -- 🔴 A GUARDA QUE FALTAVA. Sem ela, `variant_id: null` num produto
            -- QUE TEM variacao caia aqui e era aceito: preco de `preco_venda`
            -- em vez de `price_override`, e baixa no `estoque` agregado em vez
            -- do `stock_increment` da variacao escolhida. O pedido nascia sem
            -- tamanho, a lojista nao tinha o que separar, e o estoque daquele
            -- tamanho nunca descia -- vendendo de novo o que ja acabou.
            --
            -- Ate hoje quem segurava isso eram QUATRO copias de um `if` no
            -- cliente. Cada tela nova reabre o buraco, e nenhuma delas alcanca
            -- quem chama a RPC direto.
            --
            -- `v_db_price IS NOT NULL` e o teste de "produto ativo" -- substitui
            -- o JOIN com `produtos` que a guarda tinha antes de mudar de lugar.
            -- Se o SELECT acima nao achou linha (produto inativo), v_db_price
            -- fica NULL, a guarda nem dispara (curto-circuito do AND), e quem
            -- recusa e o `IF v_db_price IS NULL` logo abaixo, com "Produto %
            -- nao disponivel" -- a mensagem certa para um produto fora da
            -- vitrine, nao "Escolha uma variacao" (instrucao impossivel de
            -- seguir para quem nao pode comprar aquele produto de jeito
            -- nenhum). `v.active = true` sozinho, sem JOIN em `produtos`, e o
            -- mesmo predicado que o ramo de cima usa para ACEITAR uma
            -- variacao -- produto cujas variacoes foram TODAS desativadas
            -- continua vendavel pelo produto base.
            IF v_db_price IS NOT NULL AND EXISTS (
                SELECT 1
                FROM public.product_variants v
                WHERE v.product_id = v_product_id
                  AND v.active = true
            ) THEN
                RAISE EXCEPTION 'Escolha uma variação para o produto %.',
                    COALESCE((SELECT nome FROM public.produtos WHERE id = v_product_id), 'selecionado')
                    USING DETAIL = 'variant_id ausente em produto com variacao ativa; o item foi recusado no servidor.';
            END IF;
        END IF;

        IF v_db_price IS NULL THEN RAISE EXCEPTION 'Produto % não disponível.', COALESCE(v_item_name, 'não encontrado'); END IF;
        IF v_db_stock < v_quantity THEN
            RAISE EXCEPTION 'Estoque insuficiente para o produto % (Disponível: %, Solicitado: %)', v_item_name, v_db_stock, v_quantity;
        END IF;

        v_calculated_subtotal := v_calculated_subtotal + (v_db_price * v_quantity);
        IF v_frete_gratis = true THEN
            v_has_free_shipping_item := true;
        END IF;
    END LOOP;

    -- 4. Shipping Calculation
    -- FRETE V2 (20261081000000): a regra de frete grátis passa a ser a MESMA
    -- dos presets do front (src/lib/presets-de-frete-gratis.ts) — modelo
    -- EXCLUSIVO: a estratégia gravada em free_shipping_min é a única que
    -- vale. A marcação de item grátis vem do BANCO (produtos.frete_gratis,
    -- lida no loop de validação pelo product_id — nunca do payload).
    -- Sentinelas (mesmas do front):
    --   < 0    -> por_produto: só item marcado zera o frete
    --   = 0.01 -> sempre: todo pedido é grátis
    --   > 0    -> acima_de_valor: subtotal atinge o limiar (SEM trava de
    --             login — a trava v_user_id IS NOT NULL morreu: convidado
    --             tem o mesmo direito; a entrega dele é local e o portão
    --             de CEP continua nos ELSIFs abaixo)
    --   0/NULL -> desligado: nada é grátis aqui (cai nos ELSIFs)
    v_free_shipping_min := COALESCE(v_store_config.free_shipping_min, 0);

    IF (v_free_shipping_min < 0 AND v_has_free_shipping_item = true)
       OR v_free_shipping_min = 0.01
       OR (v_free_shipping_min > 0 AND v_calculated_subtotal >= v_free_shipping_min)
    THEN
        v_shipping_validated := 0;

    -- FRETE V2 EMENDA (03/09, ordem do dono "entrega fixa não faz sentido
    -- existir"): pedido SEM opção de entrega escolhida NÃO NASCE — o
    -- COALESCE(shipping_fee, 0) daqui cobrava preço inventado ou zero.
    ELSIF p_shipping_option_id IS NULL OR p_shipping_option_id = '' THEN
        RAISE EXCEPTION 'Escolha uma opção de entrega antes de finalizar o pedido.'
            USING DETAIL = 'Pedido sem opção de entrega: o servidor não inventa frete nem cobra taxa da loja.';

    -- FRETE V2 EMENDA (03/09): o id `flat-fee-%` deixou de ser escolha válida
    -- — a taxa fixa morreu na edge (calculate-shipping) e aqui no servidor.
    -- Recebê-lo é payload velho ou forjado: falha fechada, NUNCA o
    -- shipping_fee da loja.
    ELSIF p_shipping_option_id LIKE 'flat-fee-%' THEN
        RAISE EXCEPTION 'Opção de entrega inválida. Volte ao carrinho e escolha uma entrega válida.'
            USING DETAIL = format('O id %s é de taxa fixa, que não existe mais; o servidor não cobra shipping_fee da loja.', p_shipping_option_id);

    ELSIF p_shipping_option_id = 'local-delivery' THEN
        v_dest_cep := regexp_replace(COALESCE(p_destination_cep, ''), '\D', '', 'g');
        IF public.is_local_cep(v_store_config.origin_cep, v_dest_cep, v_store_config.local_cep_range) THEN
            v_shipping_validated := COALESCE(v_store_config.local_delivery_fee, 0);
        ELSE
            RAISE EXCEPTION 'Entrega local não disponível para o CEP informado.'
                USING DETAIL = format('CEP %s fora da faixa local configurada.', v_dest_cep);
        END IF;

    ELSIF p_destination_cep IS NOT NULL THEN
        v_dest_cep := regexp_replace(p_destination_cep, '\D', '', 'g');

        -- Cotação de transportadora: o preço sai do que o SERVIDOR gravou,
        -- nunca do que o cliente enviou.
        SELECT (opt->>'price')::numeric
          INTO v_shipping_validated
          FROM public.shipping_quotes_cache q,
               LATERAL jsonb_array_elements(q.options) AS opt
         WHERE regexp_replace(q.destination_cep, '\D', '', 'g') = v_dest_cep
           AND regexp_replace(COALESCE(q.origin_cep, ''), '\D', '', 'g')
               = regexp_replace(COALESCE(v_store_config.origin_cep, ''), '\D', '', 'g')
           AND q.created_at > now() - interval '24 hours'
           AND opt->>'id' = p_shipping_option_id
           -- 🔴 A COTACAO TEM DE SER DO CARRINHO QUE ESTA SENDO COMPRADO.
           -- Sem esta condicao dava para cotar o frete com um carrinho pequeno,
           -- encher o carrinho e fechar o pedido pagando o frete do pequeno --
           -- a diferenca saindo do bolso da lojista.
           --
           -- Comparo CONJUNTO contra CONJUNTO, nao texto contra texto. O
           -- `cart_hash` e serializado pela edge function em JavaScript
           -- (getCartHash, calculate-shipping/index.ts): ordenacao por
           -- localeCompare, variante vazia como '', quantidade ausente como 1.
           -- Recompor esse texto aqui obrigaria o banco a reproduzir cada um
           -- desses detalhes, e CADA UM e uma chance de recusar pedido HONESTO
           -- no ultimo clique. Desmontando os dois lados em (produto, variante,
           -- quantidade) e ordenando AQUI, a ordem do JavaScript deixa de
           -- importar. (Medido em 22/08/2026: neste banco localeCompare e o
           -- ORDER BY do Postgres CONCORDAM, en_US.UTF-8 -- mas isso e
           -- propriedade da collation, nao do desenho, e este app e um molde
           -- que nasce em bancos novos.)
           --
           -- Usa `=`, nao IS NOT DISTINCT FROM: com entrada estragada o
           -- resultado e NULL, a linha nao casa, e o pedido e RECUSADO. Falha
           -- fechado, como o resto do caminho do dinheiro.
           AND (SELECT array_agg(x ORDER BY x) FROM (
                  SELECT split_part(t, ':', 1) || ':' ||
                         split_part(t, ':', 2) || ':' ||
                         split_part(t, ':', 3) AS x
                    FROM unnest(string_to_array(q.cart_hash, ',')) AS t
                ) itens_da_cotacao)
             = (SELECT array_agg(x ORDER BY x) FROM (
                  SELECT COALESCE(i->>'product_id', '') || ':' ||
                         COALESCE(i->>'variant_id', '') || ':' ||
                         COALESCE(i->>'quantity', '1') AS x
                    FROM jsonb_array_elements(p_items) AS i
                ) itens_do_pedido)
         ORDER BY q.created_at DESC
         LIMIT 1;

        IF v_shipping_validated IS NULL THEN
            RAISE EXCEPTION 'A cotação de frete expirou. Calcule o frete novamente e refaça o pedido.'
                USING DETAIL = format(
                    'Sem cotação válida nas últimas 24h para cep=%s, opção=%s -- ou a cotação encontrada era de OUTRO carrinho.',
                    v_dest_cep, p_shipping_option_id
                );
        END IF;

    ELSE
        -- FRETE V2 EMENDA (03/09): id não reconhecido — não é entrega local,
        -- não é cotação de transportadora, e sem CEP não há onde reconciliar.
        -- Antes caía em COALESCE(shipping_fee, 0): preço inventado ou zero.
        -- Falha fechada, como o resto do caminho do dinheiro.
        RAISE EXCEPTION 'Opção de entrega não reconhecida. Volte ao carrinho, calcule o frete e finalize de novo.'
            USING DETAIL = format('O id %s não é entrega local nem cotação gravada, e não há CEP de cotação para reconciliar.', p_shipping_option_id);
    END IF;

    -- 5. Coupon Validation
    IF p_coupon_code IS NOT NULL AND p_coupon_code != '' THEN
        SELECT id, value, type INTO v_coupon_id, v_coupon_val, v_coupon_type
        FROM public.coupons
        WHERE UPPER(code) = UPPER(p_coupon_code)
          AND active = true
          AND (valid_until IS NULL OR valid_until > now())
          AND (usage_limit IS NULL OR usage_limit <= 0 OR usage_count < usage_limit)
          AND (min_purchase IS NULL OR v_calculated_subtotal >= min_purchase)
          FOR UPDATE;

        IF v_coupon_id IS NULL THEN
            -- Achado 16 do laudo (29/08): o WHERE acima junta TODAS as
            -- condições (ativa, validade, limite, mínimo) e um único RAISE
            -- respondia por todas: o cliente recusado por mínimo de carrinho
            -- lia "inválido ou expirado" e nunca soube o motivo. Descobre o
            -- PORQUÊ real e diz; a frase antiga fica só para a corrida
            -- residual (cupom mudou entre as duas consultas).
            SELECT active, valid_until, usage_limit, usage_count, min_purchase
            INTO v_cupom_recusado
            FROM public.coupons
            WHERE UPPER(code) = UPPER(p_coupon_code)
            FOR SHARE;

            IF NOT FOUND THEN
                RAISE EXCEPTION 'O cupom % não existe. Confira o código.', p_coupon_code;
            ELSIF NOT v_cupom_recusado.active THEN
                RAISE EXCEPTION 'O cupom % está desativado pela loja.', p_coupon_code;
            ELSIF v_cupom_recusado.valid_until IS NOT NULL AND v_cupom_recusado.valid_until <= now() THEN
                RAISE EXCEPTION 'O cupom % expirou em %.', p_coupon_code, to_char(v_cupom_recusado.valid_until, 'DD/MM/YYYY HH24:MI');
            ELSIF v_cupom_recusado.usage_limit IS NOT NULL AND v_cupom_recusado.usage_limit > 0 AND v_cupom_recusado.usage_count >= v_cupom_recusado.usage_limit THEN
                RAISE EXCEPTION 'O cupom % já atingiu o limite de usos.', p_coupon_code;
            ELSIF v_cupom_recusado.min_purchase IS NOT NULL AND v_cupom_recusado.min_purchase > v_calculated_subtotal THEN
                RAISE EXCEPTION 'O cupom % exige uma compra mínima de R$ %.', p_coupon_code, translate(to_char(v_cupom_recusado.min_purchase, 'FM999999999990.00'), '.', ',');
            ELSE
                RAISE EXCEPTION 'Cupom % inválido ou expirado.', p_coupon_code;
            END IF;
        END IF;

        IF v_coupon_type = 'percentage' THEN
            v_discount_amount := (v_calculated_subtotal * v_coupon_val) / 100;
        ELSE
            v_discount_amount := v_coupon_val;
        END IF;

        IF v_discount_amount > v_calculated_subtotal THEN
            v_discount_amount := v_calculated_subtotal;
        END IF;
    END IF;

    v_calculated_total := GREATEST(0, v_calculated_subtotal + v_shipping_validated - v_discount_amount);

    -- 6. Price Tampering Protection
    IF ABS(v_calculated_total - p_total_amount) > 0.05 THEN
        RAISE EXCEPTION 'Os valores do pedido mudaram. Atualize o carrinho e tente novamente.'
            USING DETAIL = format(
                'Divergência de total. Calculado: %s (subtotal %s + frete %s - desconto %s), Fornecido: %s. Autenticado: %s. Opção de frete: %s.',
                v_calculated_total, v_calculated_subtotal, v_shipping_validated,
                v_discount_amount, p_total_amount, (v_user_id IS NOT NULL),
                COALESCE(p_shipping_option_id, 'padrão')
            );
    END IF;

    -- 7. Create Order Header
    BEGIN
        INSERT INTO public.marketplace_orders (
        user_id, total, shipping, payment_method, address_id,
        coupon_id, status, notes, customer_name, customer_data,
        subtotal, discount, coupon_code,
        payment_status, expires_at,
        idempotency_key
    ) VALUES (
        v_user_id, v_calculated_total, v_shipping_validated, p_payment_method, p_address_id,
        v_coupon_id, 'pending', p_observation, p_customer_name,
        jsonb_build_object(
            'whatsapp', p_customer_phone,
            'address_id', p_address_id,
            'address', p_address_data,
            'shipping_option_id', p_shipping_option_id,
            'destination_cep', v_dest_cep
        ),
        v_calculated_subtotal, v_discount_amount, p_coupon_code,
        'aguardando', now() + interval '30 minutes',
        p_idempotency_key
    ) RETURNING id INTO v_order_id;

    EXCEPTION
        WHEN unique_violation THEN
            -- A corrida PERDEU: a requisição gêmea com a MESMA chave
            -- commitou primeiro. Devolvo o pedido dela. Se a chave casar
            -- sem dono legítimo (compartilhamento de sessão entre contas),
            -- falho fechado: nenhum pedido nasce daqui.
            SELECT id INTO v_order_id
              FROM public.marketplace_orders
             WHERE idempotency_key = p_idempotency_key
               AND (v_user_id IS NULL OR user_id IS NOT DISTINCT FROM v_user_id);
            IF v_order_id IS NULL THEN
                RAISE EXCEPTION 'Não foi possível criar o pedido. Atualize a página e tente de novo.';
            END IF;
            RETURN v_order_id;
    END;

    -- 8. Atomic Inventory Update and Order Items Insertion
    FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
    LOOP
        v_product_id := (v_item->>'product_id')::uuid;
        v_variant_id := (v_item->>'variant_id')::uuid;
        v_quantity := (v_item->>'quantity')::integer;

        IF v_variant_id IS NOT NULL THEN
            UPDATE public.product_variants
            SET stock_increment = stock_increment - v_quantity
            WHERE id = v_variant_id AND stock_increment >= v_quantity;

            GET DIAGNOSTICS v_rows_affected = ROW_COUNT;
            IF v_rows_affected = 0 THEN
                SELECT p.nome INTO v_item_name FROM public.produtos p JOIN public.product_variants v ON v.product_id = p.id WHERE v.id = v_variant_id;
                RAISE EXCEPTION 'Estoque insuficiente para o produto %', v_item_name;
            END IF;

            SELECT COALESCE(v.price_override, p.preco_venda), p.nome
            INTO v_db_price, v_item_name
            FROM public.produtos p
            JOIN public.product_variants v ON v.product_id = p.id
            WHERE v.id = v_variant_id;
        ELSE
            UPDATE public.produtos
            SET estoque = estoque - v_quantity
            WHERE id = v_product_id AND estoque >= v_quantity;

            GET DIAGNOSTICS v_rows_affected = ROW_COUNT;
            IF v_rows_affected = 0 THEN
                SELECT nome INTO v_item_name FROM public.produtos WHERE id = v_product_id;
                RAISE EXCEPTION 'Estoque insuficiente para o produto %', v_item_name;
            END IF;

            SELECT preco_venda, nome INTO v_db_price, v_item_name FROM public.produtos WHERE id = v_product_id;
        END IF;

        INSERT INTO public.marketplace_order_items (
            order_id, product_id, variant_id, quantity, price, product_name
        ) VALUES (
            v_order_id, v_product_id, v_variant_id, v_quantity, v_db_price, v_item_name
        );
    END LOOP;

    -- 9. Coupon Usage Update
    IF v_coupon_id IS NOT NULL THEN
        UPDATE public.coupons SET usage_count = usage_count + 1 WHERE id = v_coupon_id;
    END IF;

    RETURN v_order_id;
END;
$function$;
