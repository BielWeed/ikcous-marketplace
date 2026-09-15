-- PEÇA 12 (Fase 2, D-mensagens) — o cupom preso diz QUE a vaga dele volta.
--
-- O DEFEITO (GAP 2/GAP 3 do desenho da peça 12): a Rodada 4
-- (20260901000000) devolve a vaga do cupom sozinha quando o pedido está
-- definitivamente morto — mas TODAS as recusas por limite de uso dizem a
-- mesma frase seca ("já atingiu o limite de usos." / "Cupom atingiu o limite
-- de uso."), sem dizer a diferença entre "cupom esgotado de verdade" e "a
-- SUA vaga está presa num pedido cancelado e volta sozinha". O cliente lê
-- "limite", conclui que perdeu o cupom e não volta (#210).
--
-- O CONCERTO: quando a recusa é por limite E existe vaga presa deste cupom
-- (pedido `status='cancelled' AND coupon_usage_returned = FALSE`), a frase
-- nova — CANÔNICA, idêntica nas TRÊS funções (lição #53: o classificador do
-- front, src/lib/recusaDoPedido.ts, casa um texto só):
--
--   O cupom % está no limite de usos. A vaga dele volta sozinha quando o
--   pagamento de um pedido cancelado deixar de ser possível (em até 24
--   horas).
--
-- Caso SEM vaga presa: as frases atuais de limite permanecem, e a residual
-- "Cupom % inválido ou expirado." permanece para a corrida entre as duas
-- consultas.
--
-- COMO: CREATE OR REPLACE de validate_coupon_secure_v2 (corpo do baseline
-- 20260806000000, l.3714-3754 — nenhuma migration o recriou desde então,
-- conferido por grep) e de create_marketplace_order_v23/v24. ATENÇÃO À
-- FONTE DAS v23/v24: o corpo VIVO delas NÃO é o da 20261025000000 — a
-- 20261038000000 (chave de idempotência, 13º argumento), a 20261039000000
-- (porta da entrega), a 20261040000000 e a 20261081000000 (ÚLTIMO escritor:
-- frete grátis no servidor) as recriaram, e a convenção da casa desde a
-- 20261040000000 é DROP IF EXISTS da assinatura VELHA de 12 argumentos
-- antes do CREATE. Recriar pela fonte velha criaria um OVERLOAD-sombra de
-- 12 args SEM a guarda de idempotência (pedido em dobro), sem o portão de
-- entrega e sem a regra de frete grátis — e as frases novas jamais seriam
-- chamadas, porque o app manda a chave e resolve a função viva de 13 args.
-- Então: corpo da 20261081000000 CARACTERE A CARACTERE, com SÓ o bloco da
-- recusa ampliado (o SELECT do diagnóstico ganha o `id` e o ramo-limite
-- ganha a subconsulta de vaga presa) + os DROP IF EXISTS da assinatura
-- velha. O bloco de CÁLCULO de desconto é INVOLUTO — guarda-chuva da peça:
-- nenhuma regra de cálculo muda aqui, e o teste
-- tests/migration_cupom_mensagem_de_vaga_presa_test.ts compara as fatias
-- fora do bloco da recusa contra a fonte.
--
-- A subconsulta casa com o índice parcial
-- idx_marketplace_orders_cupom_a_devolver (20260901000000, l.175-179), que é
-- pequeno por construção (só vaga presa) — barato no caminho da RECUSA, que
-- nunca é o caminho feliz.
--
-- SEM BEGIN/COMMIT (regra da casa: com eles o ROLLBACK da prova transacional
-- vira no-op). NADA DESTRUTIVO: CREATE OR REPLACE + grants explícitos.
--
-- GRANTS: CREATE OR REPLACE preserva ACL, mas a convenção da casa nas
-- recriações recentes é REVOKE + GRANT explícito nomeando os papéis
-- (padrão 20260970000000:203-209; histórico #115 — GRANT esquecido derrubou
-- o cancelamento). Estado vivo preservado, medido na
-- 20261090500000: as três funções têm EXECUTE revogado de PUBLIC e mantêm
-- anon + authenticated (o convidado aplica cupom e fecha pedido "na
-- entrega" como anon).
--
-- ROLLBACK: v23/v24 — re-aplicar a
-- 20261081000000_a_regra_do_frete_gratis_mora_no_servidor.sql (o arquivo
-- inteiro dela toca SÓ as duas funções: DROP IF EXISTS do overload de 12
-- args + CREATE OR REPLACE idempotente, traz o corpo anterior inteiro de
-- volta — com a assinatura viva de 13 argumentos);
-- validate_coupon_secure_v2 — o corpo anterior está EMBUTIDO no arquivo
-- rollback-manual-20261151000000_cupom_preso_diz_que_a_vaga_volta.sql
-- (a fonte dele é o baseline, e re-processar o baseline inteiro não é
-- caminho). Detalhe no rollback-manual.
--
-- FICHA DE VERIFICAÇÃO pos-aplicação (rodar contra o banco; nao rodada por
-- este agente):
--
--   -- 1. As TRÊS funções dizem a frase nova E preservam a de limite antiga:
--   SELECT proname,
--          (corpo LIKE '%está no limite de usos. A vaga dele volta sozinha%') AS tem_vaga_presa,
--          (corpo LIKE '%já atingiu o limite de usos%')                        AS tem_limite_antigo,
--          (corpo LIKE '%Cupom atingiu o limite de uso.%')                     AS tem_limite_antigo_validate,
--          (corpo LIKE '%Cupom % inválido ou expirado.%')                      AS tem_residual
--   FROM (
--     SELECT proname, pg_get_functiondef(oid) AS corpo
--     FROM pg_proc
--     WHERE proname IN ('validate_coupon_secure_v2',
--                       'create_marketplace_order_v23',
--                       'create_marketplace_order_v24')
--       AND pronamespace = 'public'::regnamespace
--   ) f;
--   -- esperado: 3 linhas; tem_vaga_presa = true nas três;
--   -- tem_limite_antigo = true nas v23/v24; tem_limite_antigo_validate =
--   -- true no validate; tem_residual = true nas v23/v24.
--
--   -- 2. Privilégio (N3): anon e authenticated alcançam as três (convidado
--   --    aplica cupom e fecha pedido "na entrega"); PUBLIC não:
--   SELECT has_function_privilege('anon',
--          'public.validate_coupon_secure_v2(text,numeric)', 'EXECUTE') AS anon_validate,
--          has_function_privilege('authenticated',
--          'public.validate_coupon_secure_v2(text,numeric)', 'EXECUTE') AS auth_validate,
--          has_function_privilege('anon',
--          'public.create_marketplace_order_v23(jsonb,numeric,numeric,text,uuid,text,text,text,text,jsonb,text,text,uuid)', 'EXECUTE') AS anon_v23,
--          has_function_privilege('authenticated',
--          'public.create_marketplace_order_v24(jsonb,numeric,numeric,text,uuid,text,text,text,text,jsonb,text,text,uuid)', 'EXECUTE') AS auth_v24;
--   -- esperado: 1 linha com as quatro colunas = true (e PUBLIC revogado,
--   -- conferível por aclexplode como na 20261090500000).
--
--   -- 3. Prova funcional da frase nova (cupom de prova, APAGAR depois):
--   INSERT INTO public.coupons (code, type, value, usage_limit, usage_count, active)
--   VALUES ('__PROVA_VAGA__', 'fixed', 5, 1, 1, true)
--   ON CONFLICT DO NOTHING RETURNING id;
--   -- com um pedido cancelado (coupon_id do cupom de prova,
--   -- coupon_usage_returned = false): chamar validate_coupon_secure_v2
--   -- ('__PROVA_VAGA__', 100) — esperado is_valid=false e error_message
--   -- "O cupom __PROVA_VAGA__ está no limite de usos. A vaga dele volta
--   -- sozinha quando o pagamento de um pedido cancelado deixar de ser
--   -- possível (em até 24 horas)."
--   DELETE FROM public.coupons WHERE code = '__PROVA_VAGA__';

-- ============================================================
-- validate_coupon_secure_v2 — corpo do baseline (20260806000000,
-- l.3714-3754) com SÓ o ramo-limite ampliado pela subconsulta de vaga presa
-- e pela frase canônica.
-- ============================================================

CREATE OR REPLACE FUNCTION public.validate_coupon_secure_v2(p_code text, p_subtotal numeric) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
    v_coupon RECORD;
    v_discount NUMERIC := 0;
    v_is_valid BOOLEAN := FALSE;
    v_error TEXT := '';
BEGIN
    -- Fix: Standardize case-insensitive matching
    SELECT * INTO v_coupon FROM public.coupons
    WHERE UPPER(code) = UPPER(p_code) AND active = true;

    IF v_coupon.id IS NULL THEN
        v_error := 'Cupom inválido ou expirado.';
    ELSIF v_coupon.valid_until IS NOT NULL AND v_coupon.valid_until < NOW() THEN
        v_error := 'Este cupom expirou.';
    ELSIF (v_coupon.usage_limit IS NOT NULL AND v_coupon.usage_limit > 0) AND v_coupon.usage_count >= v_coupon.usage_limit THEN
        -- PEÇA 12 (Fase 2): MESMA frase canônica das v23/v24 (fonte única,
        -- lição #53 — o classificador do front casa um texto só) quando
        -- existe vaga presa deste cupom: pedido cancelado que ainda não
        -- devolveu o uso. Sem vaga presa (cupom esgotado de verdade), a
        -- frase antiga permanece.
        IF EXISTS (
            SELECT 1
            FROM public.marketplace_orders o
            WHERE o.coupon_id = v_coupon.id
              AND o.status = 'cancelled'
              AND o.coupon_usage_returned = FALSE
        ) THEN
            v_error := 'O cupom ' || p_code || ' está no limite de usos. A vaga dele volta sozinha quando o pagamento de um pedido cancelado deixar de ser possível (em até 24 horas).';
        ELSE
            v_error := 'Cupom atingiu o limite de uso.';
        END IF;
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

-- ============================================================
-- create_marketplace_order_v23 — corpo da 20261081000000 (o ÚLTIMO escritor
-- vivo das duas: a chave de idempotência, o portão de entrega e a regra de
-- frete grátis moram neles) caractere a caractere, com SÓ o bloco da recusa
-- ampliado. Os DOIS DROP IF EXISTS abaixo (assinatura VELHA de 12
-- argumentos, dropada do banco vivo desde a 20261040000000/20261081000000)
-- seguem a convenção da casa daquela virada: recriar com a assinatura errada
-- criaria um OVERLOAD-sombra sem as proteções vivas — e as frases novas
-- jamais seriam chamadas, porque o app manda a chave e resolve a função
-- viva de 13 argumentos.
-- ============================================================

DROP FUNCTION IF EXISTS public.create_marketplace_order_v23(jsonb, numeric, numeric, text, uuid, text, text, text, text, jsonb, text, text);
DROP FUNCTION IF EXISTS public.create_marketplace_order_v24(jsonb, numeric, numeric, text, uuid, text, text, text, text, jsonb, text, text);

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
            -- PEÇA 12 (Fase 2): o diagnóstico ganha o `id` do cupom e o
            -- ramo-limite ganha a subconsulta de vaga presa (pedido
            -- cancelado que ainda não devolveu o uso) — a frase nova diz
            -- QUANDO a vaga volta. Sem vaga presa, a frase antiga permanece.
            -- Mesma frase canônica das três funções (lição #53).
            SELECT id, active, valid_until, usage_limit, usage_count, min_purchase
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
                IF EXISTS (
                    SELECT 1
                    FROM public.marketplace_orders o
                    WHERE o.coupon_id = v_cupom_recusado.id
                      AND o.status = 'cancelled'
                      AND o.coupon_usage_returned = FALSE
                ) THEN
                    RAISE EXCEPTION 'O cupom % está no limite de usos. A vaga dele volta sozinha quando o pagamento de um pedido cancelado deixar de ser possível (em até 24 horas).', p_coupon_code;
                ELSE
                    RAISE EXCEPTION 'O cupom % já atingiu o limite de usos.', p_coupon_code;
                END IF;
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


-- ============================================================
-- create_marketplace_order_v24 — corpo da 20261081000000 caractere a
-- caractere, com SÓ o bloco da recusa ampliado (o mesmo bloco da v23,
-- acima).
-- ============================================================

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
            -- PEÇA 12 (Fase 2): o diagnóstico ganha o `id` do cupom e o
            -- ramo-limite ganha a subconsulta de vaga presa (pedido
            -- cancelado que ainda não devolveu o uso) — a frase nova diz
            -- QUANDO a vaga volta. Sem vaga presa, a frase antiga permanece.
            -- Mesma frase canônica das três funções (lição #53).
            SELECT id, active, valid_until, usage_limit, usage_count, min_purchase
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
                IF EXISTS (
                    SELECT 1
                    FROM public.marketplace_orders o
                    WHERE o.coupon_id = v_cupom_recusado.id
                      AND o.status = 'cancelled'
                      AND o.coupon_usage_returned = FALSE
                ) THEN
                    RAISE EXCEPTION 'O cupom % está no limite de usos. A vaga dele volta sozinha quando o pagamento de um pedido cancelado deixar de ser possível (em até 24 horas).', p_coupon_code;
                ELSE
                    RAISE EXCEPTION 'O cupom % já atingiu o limite de usos.', p_coupon_code;
                END IF;
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


-- Grants explícitos: estado vivo PRESERVADO, medido na 20261090500000
-- (as três funções tinham EXECUTE revogado de PUBLIC e mantinham anon +
-- authenticated — o convidado aplica cupom e fecha pedido "na entrega"
-- como anon). CREATE OR REPLACE preserva ACL; a re-escrita explícita é a
-- convenção da casa (padrão 20260970000000:203-209; histórico #115).
REVOKE EXECUTE ON FUNCTION public.validate_coupon_secure_v2(text,numeric) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.validate_coupon_secure_v2(text,numeric) TO anon, authenticated;

REVOKE EXECUTE ON FUNCTION public.create_marketplace_order_v23(jsonb,numeric,numeric,text,uuid,text,text,text,text,jsonb,text,text,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_marketplace_order_v23(jsonb,numeric,numeric,text,uuid,text,text,text,text,jsonb,text,text,uuid) TO anon, authenticated;

REVOKE EXECUTE ON FUNCTION public.create_marketplace_order_v24(jsonb,numeric,numeric,text,uuid,text,text,text,text,jsonb,text,text,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_marketplace_order_v24(jsonb,numeric,numeric,text,uuid,text,text,text,text,jsonb,text,text,uuid) TO anon, authenticated;
