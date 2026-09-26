-- A TRANSPORTADORA EXIGE PAGAMENTO ANTECIPADO (regra do dono, 21/09/2026).
--
-- DEFEITO: o checkout deixava escolher PIX/cartão/dinheiro NA ENTREGA com
-- frete de TRANSPORTADORA (Melhor Envio/Frenet) para outra cidade — o
-- p_payment_method ia DIRETO ao INSERT da v23/v24 sem validação nenhuma
-- contra a modalidade do frete. A transportadora não é a loja saindo com o
-- troco: envio por transportadora EXIGE pagamento antecipado (método
-- "online", PIX pago no app). Entrega local (id "local-delivery") preserva
-- as modalidades que a loja permite na entrega.
--
-- CONTRATO DA MODALIDADE (mesmo do front, src/lib/guarda-de-frete.ts): o
-- ID decide, nunca o preço nem o texto — "local-delivery" (provider
-- "local", incluindo a grátis com price 0) é entrega local; QUALQUER outro
-- id resolvível ("melhor-envio-*", "frenet-*" e o gratuito externo
-- "free-shipping-promo" que a edge calculate-shipping devolve no caminho
-- de transportadora) é transportadora. Grátis de transportadora
-- CONTINUA transportadora.
--
-- O QUE MUDA (bloco novo "2-ter" nas DUAS funções, inserido logo após o
-- portão de entrega 2-bis e ANTES do loop de validação 3 e do bloco 4):
--   NULL/vazio (NULLIF(btrim(...)), em QUALQUER CEP) e 'flat-fee-%' são
--     RECUSADOS ANTES do ramo do frete grátis do bloco 4 — o preset
--     gratuito (v_shipping_validated := 0) zera o preço SEM validar o id,
--     e era por esse buraco que um 'local-delivery' forjado (ou um pedido
--     de transportadora "na entrega") nascia com frete R$ 0.
--   v23 (RPC "na entrega"): transportadora é RECUSADA SEMPRE — inclusive
--     com p_payment_method='online' — porque a v23 não gera cobrança nem
--     grava 'aguardando'/expires_at; transporte passa pela v24 + online.
--   v24 (RPC online): RECUSA cash/card/pix quando a modalidade é
--     transportadora (só 'online' passa).
--   NAS DUAS: 'local-delivery' com CEP de entrega FORA da área local é
--     RECUSADO ANTES do ramo do frete grátis. A localidade é provada com o
--     CEP DE ENTREGA verificado no servidor (v_cep_de_entrega) contra
--     origin_cep/local_cep_range da store_config — o mesmo
--     public.is_local_cep do ELSIF do bloco 4, que continua lá.
--   NAS DUAS: id de entrega AUSENTE (NULL/'', com ou sem espaços) é
--     RECUSADO em QUALQUER CEP, ANTES do ramo do frete grátis do bloco 4 —
--     o preset gratuito não substitui a escolha, com ou sem antecipado.
-- REVISÃO APLICADA NESTA RODADA (parecer Opus — A1/A2/B4, nada além):
--   • B4 — NORMALIZAÇÃO DO ID: v_opcao := NULLIF(btrim(
--     p_shipping_option_id), '') no DECLARE, e TODAS as comparações do
--     2-ter (NULL, flat-fee, local-delivery) leem v_opcao. ' local-
--     delivery' e ' flat-fee-1' (espaços de sobra) caem na regra CERTA;
--     'LOCAL-DELIVERY' em maiúsculas NÃO casa e cai no ramo transportadora
--     — fail-closed (recusa em vez de aceitar), aceitável e documentado
--     no comentário do bloco. O bloco 4 permanece VERBATIM lendo o
--     parâmetro cru (fora do escopo).
--   • A1 — FAIL-CLOSED da localidade no 2-ter (NAS DUAS funções). CONTRATO
--     FONTE de public.is_local_cep (evidência da supervisão, conferida na
--     baseline 20260806000000_baseline_do_schema_vivo.sql:3128-3206):
--     LANGUAGE plpgsql IMMUTABLE e NÃO STRICT — faz COALESCE interno de
--     origem/destino (vazio em QUALQUER ponta devolve false, nunca NULL) e
--     faixa NULL/vazia é SEMÂNTICA VÁLIDA: compara left(origem,5) =
--     left(destino,5). Não existe — nem deve existir — bloqueio para faixa
--     NULL. A forma negada (IF ... IS NULL OR NOT is_local_cep(...)) não é
--     fail-open HOJE (o corpo vivo nunca devolve NULL), mas aposta o portão
--     na função continuar não-STRICT para sempre: um ALTER FUNCTION ...
--     STRICT ou uma reescrita que devolva NULL a reabriria. Aqui: origem
--     AUSENTE é recusada ANTES do teste com a frase JÁ CLASSIFICADA pelo
--     front ('A loja ainda está configurando a entrega. Fale com a loja.'),
--     e o predicado é a forma fail-closed COALESCE(public.is_local_cep(...),
--     false) = false junto com v_cep_de_entrega IS NULL — defesa em
--     profundidade, não correção de um NULL que o corpo vivo não devolve.
--     A comparação LIVE do corpo dela (o que o banco tem vs. a baseline)
--     fica como GATE PENDENTE de verificação. O 2-bis pré-existente NÃO
--     foi expandido (gate de verificação separado, fora do escopo).
--   • A2 — DETAIL do RAISE de local-delivery: COALESCE(local_cep_range
--     ::text, '') com cast EXPLÍCITO (nas duas funções). Sem ele, se a
--     coluna fosse numérica, o '' da COALESCE resolveria para numeric e o
--     erro de cast só apareceria NO DIA da recusa (o DETAIL só é avaliado
--     quando o RAISE dispara), nunca na criação da função.
-- Todo o resto do corpo é VERBATIM do estado vivo (ver fonte abaixo):
-- idempotência, portão de convidado, cobertura local, loop de validação,
-- cupom, proteção de preço, INSERTs e devidos COMMENTs internos intocados.
--
-- 🔴 FONTE — ESTADO VIVO, NÃO O ARQUIVO: os corpos base foram capturados
-- de pg_get_functiondef() no banco de DESENVOLVIMENTO (não produção) em
-- 21/09/2026 (leitura read-only, padrão scripts/db-inspect-*.cjs) e
-- conferidos byte a byte contra a 20261081000000 aplicada — ÚNICA
-- diferença: a serialização canônica "DEFAULT NULL::uuid" do catálogo,
-- aqui mantida como "DEFAULT NULL" (o estilo do arquivo). Grants vivos na
-- data: EXECUTE para anon, authenticated, postgres e service_role (PUBLIC
-- revogado pelas 20261090500000/20261091000000). SEM DROP FUNCTION aqui de
-- propósito: a assinatura NÃO muda (13 args) e CREATE OR REPLACE preserva
-- os grants e o dono — um DROP+CREATE os derrubaria e reabriria o execute
-- para PUBLIC.
--
-- 🔴 NÃO APLICADA — PLANO DE APLICAÇÃO (quem aplica é o DONO; SÓ ESTA
-- migration — não está autorizado aplicar a fila inteira):
--   1. Conferir o saldo do ledger: `supabase migration list` (a fila casa
--      1:1 com supabase/migrations/) — para SABER onde esta file entra,
--      não para aplicar o que veio antes dela.
--   1-bis. INVENTÁRIO DE OVERLOADS ANTES do apply (mesma consulta DEPOIS,
--      no passo 4):
--        SELECT p.oid::regprocedure
--          FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
--         WHERE n.nspname = 'public'
--           AND p.proname IN ('create_marketplace_order_v23',
--                             'create_marketplace_order_v24');
--      Esperado: EXATAMENTE duas linhas, ambas com 13 argumentos. Qualquer
--      divergência (terceiro overload, aridade diferente) BLOQUEIA a
--      aplicação — sobe para o dono resolver; NUNCA DROP FUNCTION para
--      "arrumar" (derrubaria grants e reabriria execute para PUBLIC).
--   2. SEM `supabase db push` (regra da casa, ADR 0002). Aplicar SOMENTE
--      ESTE arquivo, pelo caminho auditado que aplica arquivo por arquivo:
--        node scripts/db-apply.cjs \
--          supabase/migrations/20261168000000_a_transportadora_exige_pagamento_antecipado.sql
--      em janela sem tráfico de checkout, com o rollback ao lado.
--   3. Ordem com o front — BANCO ANTES (ou os dois no MESMO deploy; nunca
--      banco depois): o front NOVO já roteia 'online' para a v24 — o
--      CheckoutView chama createOrder(orderData, { comPagamentoOnline:
--      ehOnline }) (src/views/customer/CheckoutView.tsx:1887-1889, com
--      paymentMethod 'online'/'entrega' na mesma chave) e o useOrders
--      escolhe a RPC por essa flag (src/hooks/useOrders.ts:3121-3123:
--      comPagamentoOnline ? "create_marketplace_order_v24" :
--      "create_marketplace_order_v23"). Prova nos testes
--      tests/front/checkout-view-flag-on.test.tsx (+ o par flag-off) e
--      tests/front/checkout-transportadora-exige-antecipado.test.tsx.
--      A regra nova recusa payloads que o front VELHO ainda manda
--      (transportadora + pix na entrega, por estado stale): banco novo com
--      front velho é janela de recusa HONESTA (o cliente é orientado a
--      pagar o PIX no app e refaz); front novo com banco VELHO reabre o
--      furo (o front NÃO refaz no cliente a regra que o servidor deve
--      recusar). Banco primeiro, portanto. Comportamento local/online
--      PRÉ-EXISTENTE preservado: v23 aceitar 'online' com local-delivery
--      é anterior a esta migration e fica exatamente como está (fora do
--      escopo).
--   4. Conferir pós-apply: o inventário do 1-bis DE NOVO (EXATAMENTE duas
--      linhas, ambas com 13 argumentos — CREATE OR REPLACE não cria
--      overload, mas é a prova de que nenhum apareceu), as duas funções
--      continuam SECURITY DEFINER,
--      SET search_path TO 'public', e `information_schema.routine_privileges`
--      segue com EXECUTE só para anon/authenticated/service_role.
--
-- FICHA DE VERIFICAÇÃO pós-aplicação (produto ativo R$ 50, SEM variação;
-- loja origem 38500-000; MESMO molde da 20261081000000). NÃO cria pedido
-- nem pagamento de verdade: tudo dentro de BEGIN ... ROLLBACK.
--
-- 🔴 MODO DE EXECUÇÃO — UMA conexão, UMA transação externa: a ficha
-- INTEIRA roda numa única conexão psql, dentro de UMA transação externa
-- (BEGIN ... ROLLBACK). NÃO existe alternativa de "colar os casos um a um
-- no SQL Editor": statement isolado commita os positivos de verdade —
-- pedido nascido, estoque baixado, store_config alterada sem restauração.
-- Nenhum COMMIT no meio (nenhuma janela com positivo gravado). Rodar em
-- janela SEM tráfego de checkout — os casos POSITIVOS (5, 6-bis, 9, 11)
-- baixam estoque e TRAVAM as linhas de produto (FOR NO KEY UPDATE) até o
-- ROLLBACK final. Rodar em psql com ON_ERROR_STOP DESLIGADO (o padrão),
-- porque cada RECUSA esperada É um erro — e é o ROLLBACK TO SAVEPOINT de
-- cada caso que devolve o controle à transação (sem ele, a 1ª exceção
-- aborta a transação e o resto devolve 25P02, in failed sql transaction).
-- FALHA INESPERADA ABORTA A PROVA: qualquer erro que não seja uma das
-- recusas esperadas (ou um positivo/plantio que falhe) → ROLLBACK geral e
-- reporte da falha — NUNCA continuar os casos seguintes reportando
-- sucesso. Os plantios e os positivos têm SAVEPOINT próprio justamente
-- para esse aborto ser limpo: ROLLBACK TO SAVEPOINT devolve o controle
-- sem cascade 25P02, e o ROLLBACK geral fecha a prova.
-- Ordem dos argumentos = a assinatura:
-- (p_items, p_total_amount, p_shipping_cost, p_payment_method,
-- p_address_id, p_coupon_code, p_customer_name, p_customer_phone,
-- p_observation, p_address_data, p_destination_cep, p_shipping_option_id
-- [, p_idempotency_key]) — o MÉTODO é o 4º argumento, nunca o último.
--
-- POSITIVOS determinísticos: cada caso positivo captura o UUID RETORNADO
-- pela RPC (\gset do psql) e consulta POR ID (total/shipping/
-- payment_status/status/expires_at) — nunca customer_name + ORDER BY
-- created_at (now() é CONSTANTE dentro da transação: empata e esconde
-- regressão). Nome de cliente distinto por caso ('Prova 5', 'Prova 6bis',
-- 'Prova 9', 'Prova 11').
--
-- ANTES DE TUDO, o JWT: a conexão psql direta NÃO sobe com
-- request.jwt.claims (a sessão não tem JWT, auth.uid() volta NULL e o
-- portão de convidado do 2-bis recusa o CEP externo ANTES das regras
-- desta migration). Finja o JWT DENTRO da transação e confira — o
-- <uuid-de-teste> tem de ser um usuário REAL de auth.users
-- (marketplace_orders.user_id tem FK para auth.users(id); uuid inventado
-- derruba os casos POSITIVOS na FK, não na regra):
--   BEGIN;
--     SELECT set_config('request.jwt.claims',
--       '{"sub":"<uuid-de-teste>","role":"authenticated"}', true);
--     SELECT auth.uid();  -- conferência: tem de devolver <uuid-de-teste>
--
--     -- 0. PRECONDIÇÕES REAIS (ler e ASSERTAR — os casos dependem delas;
--     --    divergência ABORTA a prova aqui, com ROLLBACK). Guarda a config
--     --    INTEGRAL primeiro (a ficha mexe em free_shipping_min e pode
--     --    mexer em shipping_coverage; o restore do FIM devolve TUDO — e
--     --    se alguém COMMITAR por engano, a loja acorda com a estratégia
--     --    DELA, não com a da ficha):
--     CREATE TEMP TABLE ficha_store_config ON COMMIT DROP AS
--       SELECT origin_cep, local_cep_range, shipping_coverage,
--              free_shipping_min
--         FROM public.store_config WHERE id = 1;
--
--     -- Cobertura da loja: os casos de CEP externo exigem cobertura
--     -- NÃO-local (com 'local', o 2-bis recusa por outra regra antes da
--     -- desta migration). O CHECK da coluna só admite 'local'|'national'
--     -- (baseline :4241) — 'national' é o ÚNICO valor não-'local' que
--     -- existe no domínio; se a loja já está em 'national', o UPDATE não
--     -- toca em nada. O FIM da ficha restaura o valor original.
--     UPDATE public.store_config SET shipping_coverage = 'national'
--      WHERE id = 1 AND shipping_coverage <> 'national';
--
--     -- As asserções (depois do UPDATE, para conferir o efeito dele).
--     -- A conferência da is_local_cep também prova o contrato NÃO-STRICT
--     -- in loco: com faixa NULL ela devolve BOOLEANO (prefixo de 5
--     -- dígitos); se fosse STRICT, devolveria NULL e a precondição
--     -- abortaria (baseline :3128-3206).
--     DO $precondicoes$
--     DECLARE
--       v_origin text; v_range text; v_cov text;
--     BEGIN
--       SELECT origin_cep, local_cep_range, shipping_coverage
--         INTO v_origin, v_range, v_cov
--         FROM public.store_config WHERE id = 1;
--       IF v_origin IS DISTINCT FROM '38500-000' THEN
--         RAISE EXCEPTION 'PRECONDIÇÃO da ficha: origin_cep=%, esperado 38500-000', v_origin;
--       END IF;
--       IF v_cov = 'local' THEN
--         RAISE EXCEPTION 'PRECONDIÇÃO da ficha: shipping_coverage=%, esperado não-local', v_cov;
--       END IF;
--       IF public.is_local_cep('38500-000', '38500-000', v_range) IS DISTINCT FROM true THEN
--         RAISE EXCEPTION 'PRECONDIÇÃO: 38500-000 devia ser LOCAL (faixa %)', v_range;
--       END IF;
--       IF public.is_local_cep('38500-000', '01000-000', v_range) IS DISTINCT FROM false THEN
--         RAISE EXCEPTION 'PRECONDIÇÃO: 01000-000 devia ser EXTERNO (faixa %)', v_range;
--       END IF;
--     END $precondicoes$;
--
--     -- 1. v23 RECUSA transportadora (mesmo 'online' forjado no método):
--     SAVEPOINT caso_1;
--     SELECT public.create_marketplace_order_v23(
--       '[{"product_id":"<uuid>","variant_id":null,"quantity":1}]'::jsonb,
--       70, 20, 'online', NULL, NULL, 'Prova', '5531999999999', NULL,
--       '{"cep":"01000-000"}'::jsonb, '01000-000', 'melhor-envio-CorreiosSedex');
--     -- espera EXCEPTION 'Envio por transportadora exige pagamento
--     -- antecipado...' (antes: nascia pedido prometendo na entrega).
--     ROLLBACK TO SAVEPOINT caso_1;
--
--     -- 2. v23 RECUSA 'local-delivery' com CEP EXTERNO mesmo no gratuito:
--     UPDATE store_config SET free_shipping_min = 0.01 WHERE id = 1;
--     SAVEPOINT caso_2;
--     SELECT public.create_marketplace_order_v23(
--       '[{"product_id":"<uuid>","variant_id":null,"quantity":1}]'::jsonb,
--       50, 0, 'pix', NULL, NULL, 'Prova', '5531999999999', NULL,
--       '{"cep":"01000-000"}'::jsonb, '01000-000', 'local-delivery');
--     -- espera EXCEPTION 'Entrega local não disponível...' (antes: o ramo
--     -- do gratuito pulava a validação e o pedido nascia R$ 0).
--     ROLLBACK TO SAVEPOINT caso_2;
--
--     -- 3. v23 RECUSA id AUSENTE com CEP de entrega EXTERNO — mesmo com o
--     --    gratuito ligado (o preset não substitui a escolha):
--     SAVEPOINT caso_3;
--     SELECT public.create_marketplace_order_v23(
--       '[{"product_id":"<uuid>","variant_id":null,"quantity":1}]'::jsonb,
--       50, 0, 'online', NULL, NULL, 'Prova', '5531999999999', NULL,
--       '{"cep":"01000-000"}'::jsonb, '01000-000', NULL);
--     -- espera EXCEPTION 'Escolha uma opção de entrega antes de finalizar
--     -- o pedido.' ANTES do ramo do gratuito (antes: o preset zerava e o
--     -- pedido de fora da cidade nascia R$ 0 sem entrega nenhuma).
--     ROLLBACK TO SAVEPOINT caso_3;
--
--     -- 4. v23 RECUSA id AUSENTE em QUALQUER CEP — inclusive CEP LOCAL com
--     --    o gratuito ligado (o preset não substitui a escolha):
--     SAVEPOINT caso_4;
--     SELECT public.create_marketplace_order_v23(
--       '[{"product_id":"<uuid>","variant_id":null,"quantity":1}]'::jsonb,
--       50, 0, 'pix', NULL, NULL, 'Prova', '5531999999999', NULL,
--       '{"cep":"38500-000"}'::jsonb, '38500-000', NULL);
--     -- espera EXCEPTION 'Escolha uma opção de entrega antes de finalizar
--     -- o pedido.'
--     ROLLBACK TO SAVEPOINT caso_4;
--
--     -- 5. v23 ACEITA 'local-delivery' com CEP LOCAL e gratuito ligado —
--     --    o positivo explícito da entrega local grátis COM a escolha
--     --    (price 0). SAVEPOINT em volta do positivo: falha inesperada
--     --    aborta a prova sem cascade 25P02 no que vem depois.
--     SAVEPOINT positivo_5;
--     SELECT public.create_marketplace_order_v23(
--       '[{"product_id":"<uuid>","variant_id":null,"quantity":1}]'::jsonb,
--       50, 0, 'pix', NULL, NULL, 'Prova 5', '5531999999999', NULL,
--       '{"cep":"38500-000"}'::jsonb, '38500-000', 'local-delivery'
--     ) AS pedido_5 \gset
--     SELECT total, shipping, status, payment_status, expires_at
--       FROM public.marketplace_orders WHERE id = :'pedido_5';
--     -- espera: total 50, shipping 0, status 'pending'; payment_status e
--     -- expires_at NULL (a v23 não grava cobrança — colunas da
--     -- 20260807000000, sem default).
--     RELEASE SAVEPOINT positivo_5;
--
--     -- 6. v24 RECUSA transportadora com 'pix' (método no 4º argumento):
--     UPDATE store_config SET free_shipping_min = 0 WHERE id = 1;
--     SAVEPOINT caso_6;
--     SELECT public.create_marketplace_order_v24(
--       '[{"product_id":"<uuid>","variant_id":null,"quantity":1}]'::jsonb,
--       70, 20, 'pix', NULL, NULL, 'Prova', '5531999999999', NULL,
--       '{"cep":"01000-000"}'::jsonb, '01000-000', 'melhor-envio-CorreiosSedex');
--     -- espera EXCEPTION 'Envio por transportadora exige pagamento
--     -- antecipado...'.
--     ROLLBACK TO SAVEPOINT caso_6;
--
--     -- 6-bis. v24 + transportadora + 'online': o POSITIVO da regra.
--     --    PRECONDIÇÃO (bloco 4): cotação < 24h em shipping_quotes_cache
--     --    do MESMO carrinho/origem/destino — a ficha PLANTA a linha
--     --    dentro da transação, com created_at EXPLÍCITO (não depende do
--     --    DEFAULT da coluna) e SAVEPOINT em volta do plantio E do
--     --    positivo. O ON CONFLICT renova caso já exista a da UNIQUE
--     --    (origin_cep, destination_cep, cart_hash). O cart_hash
--     --    '<uuid>::1' é o formato exato da edge getCartHash
--     --    (calculate-shipping/index.ts:492-506:
--     --    `${productId}:${variantId || ''}:${quantity || 1}`) para o
--     --    carrinho de 1 item sem variante desta ficha:
--     SAVEPOINT plantio_6bis;
--     INSERT INTO public.shipping_quotes_cache
--       (origin_cep, destination_cep, cart_hash, options, created_at)
--     VALUES ('38500-000', '01000-000', '<uuid>::1',
--       '[{"id":"melhor-envio-CorreiosSedex","price":20,"provider":"melhor-envio"}]'::jsonb,
--       now())
--     ON CONFLICT (origin_cep, destination_cep, cart_hash)
--       DO UPDATE SET options = EXCLUDED.options,
--                     created_at = EXCLUDED.created_at;
--     SELECT public.create_marketplace_order_v24(
--       '[{"product_id":"<uuid>","variant_id":null,"quantity":1}]'::jsonb,
--       70, 20, 'online', NULL, NULL, 'Prova 6bis', '5531999999999', NULL,
--       '{"cep":"01000-000"}'::jsonb, '01000-000', 'melhor-envio-CorreiosSedex'
--     ) AS pedido_6bis \gset
--     SELECT total, shipping, payment_status, status, expires_at
--       FROM public.marketplace_orders WHERE id = :'pedido_6bis';
--     -- espera: TOTAL = subtotal + frete COTADO (produto 50 + frete 20
--     -- => total 70 — o p_total_amount também é 70, a trava dos 5
--     -- centavos confere), payment_status 'aguardando', status 'pending',
--     -- expires_at ~ now() + 30 min (NOT NULL) — POR ID, nunca por nome.
--     RELEASE SAVEPOINT plantio_6bis;
--
--     -- 7. free-shipping-promo (grátis EXTERNO, price 0, provider free)
--     --    continua TRANSPORTADORA — v23 recusa SEMPRE:
--     SAVEPOINT caso_7;
--     SELECT public.create_marketplace_order_v23(
--       '[{"product_id":"<uuid>","variant_id":null,"quantity":1}]'::jsonb,
--       50, 0, 'pix', NULL, NULL, 'Prova', '5531999999999', NULL,
--       '{"cep":"01000-000"}'::jsonb, '01000-000', 'free-shipping-promo');
--     -- espera EXCEPTION 'Envio por transportadora exige pagamento
--     -- antecipado...' — GRÁTIS de transportadora é transportadora.
--     ROLLBACK TO SAVEPOINT caso_7;
--
--     -- 8. v24 + free-shipping-promo + 'pix': RECUSA (a mesma regra,
--     --    independente do preço da opção):
--     SAVEPOINT caso_8;
--     SELECT public.create_marketplace_order_v24(
--       '[{"product_id":"<uuid>","variant_id":null,"quantity":1}]'::jsonb,
--       50, 0, 'pix', NULL, NULL, 'Prova', '5531999999999', NULL,
--       '{"cep":"01000-000"}'::jsonb, '01000-000', 'free-shipping-promo');
--     -- espera EXCEPTION 'Envio por transportadora exige pagamento
--     -- antecipado...'.
--     ROLLBACK TO SAVEPOINT caso_8;
--
--     -- 9. v24 + free-shipping-promo + 'online': NASCE com frete 0 —
--     --    transportadora grátis + antecipado é caminho legítimo. Mesma
--     --    precondição do 6-bis, com a cotação GRATUITA plantada (price
--     --    0, provider free — o formato que a edge devolve), created_at
--     --    EXPLÍCITO e SAVEPOINT em volta do plantio E do positivo:
--     SAVEPOINT plantio_9;
--     INSERT INTO public.shipping_quotes_cache
--       (origin_cep, destination_cep, cart_hash, options, created_at)
--     VALUES ('38500-000', '01000-000', '<uuid>::1',
--       '[{"id":"free-shipping-promo","price":0,"provider":"free"}]'::jsonb,
--       now())
--     ON CONFLICT (origin_cep, destination_cep, cart_hash)
--       DO UPDATE SET options = EXCLUDED.options,
--                     created_at = EXCLUDED.created_at;
--     SELECT public.create_marketplace_order_v24(
--       '[{"product_id":"<uuid>","variant_id":null,"quantity":1}]'::jsonb,
--       50, 0, 'online', NULL, NULL, 'Prova 9', '5531999999999', NULL,
--       '{"cep":"01000-000"}'::jsonb, '01000-000', 'free-shipping-promo'
--     ) AS pedido_9 \gset
--     SELECT total, shipping, payment_status, status, expires_at
--       FROM public.marketplace_orders WHERE id = :'pedido_9';
--     -- espera: 'aguardando' com shipping = 0 e total = 50 (o price 0 vem
--     -- da COTAÇÃO, não do preset — o free_shipping_min está desligado
--     -- desde o caso 6), status 'pending', expires_at NOT NULL.
--     RELEASE SAVEPOINT plantio_9;
--
--     -- 10. v24 RECUSA 'local-delivery' com CEP EXTERNO — a regra nova
--     --     vale também na RPC do antecipado (o 2-ter vem ANTES do
--     --     gratuito, ligado ou não):
--     SAVEPOINT caso_10;
--     SELECT public.create_marketplace_order_v24(
--       '[{"product_id":"<uuid>","variant_id":null,"quantity":1}]'::jsonb,
--       50, 0, 'online', NULL, NULL, 'Prova 10', '5531999999999', NULL,
--       '{"cep":"01000-000"}'::jsonb, '01000-000', 'local-delivery');
--     -- espera EXCEPTION 'Entrega local não disponível para o CEP
--     -- informado.' (a MESMA frase do 2-ter da v23).
--     ROLLBACK TO SAVEPOINT caso_10;
--
--     -- 11. v24 ACEITA 'local-delivery' com CEP LOCAL — o positivo da
--     --     entrega local na RPC do antecipado. Grátis LIGADO de novo
--     --     para DETERMINISMO: com o preset, frete 0 e total 50; com ele
--     --     desligado o frete seria o local_delivery_fee VIVO da loja,
--     --     valor que a ficha não controla.
--     UPDATE store_config SET free_shipping_min = 0.01 WHERE id = 1;
--     SAVEPOINT positivo_11;
--     SELECT public.create_marketplace_order_v24(
--       '[{"product_id":"<uuid>","variant_id":null,"quantity":1}]'::jsonb,
--       50, 0, 'online', NULL, NULL, 'Prova 11', '5531999999999', NULL,
--       '{"cep":"38500-000"}'::jsonb, '38500-000', 'local-delivery'
--     ) AS pedido_11 \gset
--     SELECT total, shipping, payment_status, status, expires_at
--       FROM public.marketplace_orders WHERE id = :'pedido_11';
--     -- espera: total 50, shipping 0, payment_status 'aguardando', status
--     -- 'pending', expires_at NOT NULL (a v24 grava a reserva de 30 min
--     -- mesmo em entrega local: o expires é do fluxo online dela).
--     RELEASE SAVEPOINT positivo_11;
--
--     -- 12. TRIM: ' local-delivery' (espaço de sobra) com CEP EXTERNO — o
--     --     btrim do 2-ter (revisão B4) derruba o espaço e o id cai no
--     --     ramo LOCAL; sem o trim, cairia no ramo transportadora e a
--     --     frase seria a do caso 1:
--     SAVEPOINT caso_12;
--     SELECT public.create_marketplace_order_v23(
--       '[{"product_id":"<uuid>","variant_id":null,"quantity":1}]'::jsonb,
--       50, 0, 'pix', NULL, NULL, 'Prova 12', '5531999999999', NULL,
--       '{"cep":"01000-000"}'::jsonb, '01000-000', ' local-delivery');
--     -- espera EXCEPTION 'Entrega local não disponível para o CEP
--     -- informado.' — prova que o trim levou ao ramo local-delivery.
--     ROLLBACK TO SAVEPOINT caso_12;
--
--     -- 13. CAIXA: 'LOCAL-DELIVERY' NÃO casa 'local-delivery' — cai no
--     --     ramo transportadora, fail-closed RECUSANDO (documentado na
--     --     revisão B4; não existe lower() implícito):
--     SAVEPOINT caso_13;
--     SELECT public.create_marketplace_order_v23(
--       '[{"product_id":"<uuid>","variant_id":null,"quantity":1}]'::jsonb,
--       50, 0, 'pix', NULL, NULL, 'Prova 13', '5531999999999', NULL,
--       '{"cep":"01000-000"}'::jsonb, '01000-000', 'LOCAL-DELIVERY');
--     -- espera EXCEPTION 'Envio por transportadora exige pagamento
--     -- antecipado...'.
--     ROLLBACK TO SAVEPOINT caso_13;
--
--     -- 14. TRIM no flat-fee: ' flat-fee-1' (espaço de sobra) — o btrim
--     --     leva ao LIKE 'flat-fee-%' do 2-ter; sem o trim, o id não
--     --     casaria NADA em 'flat-fee-%' e cairia no transportadora:
--     SAVEPOINT caso_14;
--     SELECT public.create_marketplace_order_v23(
--       '[{"product_id":"<uuid>","variant_id":null,"quantity":1}]'::jsonb,
--       50, 0, 'pix', NULL, NULL, 'Prova 14', '5531999999999', NULL,
--       '{"cep":"01000-000"}'::jsonb, '01000-000', ' flat-fee-1');
--     -- espera EXCEPTION 'Opção de entrega inválida. Volte ao carrinho e
--     -- escolha uma entrega válida.'
--     ROLLBACK TO SAVEPOINT caso_14;
--
--     -- 15. v24 + transportadora + 'cash': RECUSA (dinheiro na porta do
--     --     correio não existe). O 2-ter dispara ANTES da cotação — não
--     --     precisa de plantio. Até aqui só 'pix' (caso 6) estava
--     --     provado na v24; 'cash' e 'card' (caso 16) fecham a tríade:
--     SAVEPOINT caso_15;
--     SELECT public.create_marketplace_order_v24(
--       '[{"product_id":"<uuid>","variant_id":null,"quantity":1}]'::jsonb,
--       50, 0, 'cash', NULL, NULL, 'Prova 15', '5531999999999', NULL,
--       '{"cep":"01000-000"}'::jsonb, '01000-000', 'melhor-envio-CorreiosSedex');
--     -- espera EXCEPTION 'Envio por transportadora exige pagamento
--     -- antecipado...'.
--     ROLLBACK TO SAVEPOINT caso_15;
--
--     -- 16. v24 + transportadora + 'card': RECUSA (cartão é código morto
--     --     "Fase 3.5" — e ainda assim: com transportadora, só 'online'):
--     SAVEPOINT caso_16;
--     SELECT public.create_marketplace_order_v24(
--       '[{"product_id":"<uuid>","variant_id":null,"quantity":1}]'::jsonb,
--       50, 0, 'card', NULL, NULL, 'Prova 16', '5531999999999', NULL,
--       '{"cep":"01000-000"}'::jsonb, '01000-000', 'melhor-envio-CorreiosSedex');
--     -- espera EXCEPTION 'Envio por transportadora exige pagamento
--     -- antecipado...'.
--     ROLLBACK TO SAVEPOINT caso_16;
--
--     -- FIM: restaura a config INTEGRAL (origin_cep, local_cep_range,
--     -- shipping_coverage, free_shipping_min — não só o free_shipping_min)
--     -- e desfaz TUDO (pedidos, baixas de estoque, cotações plantadas; o
--     -- ROLLBACK leva a TEMP TABLE junto):
--     UPDATE public.store_config s SET
--       origin_cep        = f.origin_cep,
--       local_cep_range   = f.local_cep_range,
--       shipping_coverage = f.shipping_coverage,
--       free_shipping_min = f.free_shipping_min
--       FROM ficha_store_config f
--      WHERE s.id = 1;
--   ROLLBACK;
--
-- SEM BEGIN/COMMIT (regra da casa: migration não leva transação explícita
-- — com eles, o ROLLBACK do script de prova viraria no-op e a mudança
-- ficava gravada). A ATOMICIDADE dos dois CREATE OR REPLACE vem do RUNNER:
-- scripts/db-apply.cjs, passo 2 (linhas 2422-2446 do script), aplica cada
-- migration numa ÚNICA transação — BEGIN → client.query(arquivo inteiro) →
-- registro no ledger → COMMIT, com ROLLBACK + exit(1) se QUALQUER comando
-- falhar. Não existe janela com a v23 nova e a v24 velha no ar. E a FICHA
-- acima roda em OUTRA sessão, DEPOIS do apply: o BEGIN...ROLLBACK dela não
-- alcança — nem precisa alcançar — a migration (uma versão anterior deste
-- comentário dizia o contrário; estava errado).
--
-- ROLLBACK MANUAL: versionado em
-- rollback-manual-20261168000000_a_transportadora_exige_pagamento_antecipado.sql
-- (reaplica os corpos VERBATIM do estado vivo capturado em 21/09/2026 — a
-- saber, o corpo executável da 20261081000000. SEM bloco de GRANTs: CREATE
-- OR REPLACE preserva a ACL existente). Aplicar PELO PSQL, transação
-- externa ÚNICA: psql "$DATABASE_URL" -1 -f
-- rollback-manual-20261168000000_a_transportadora_exige_pagamento_antecipado.sql
-- — NUNCA pelo scripts/db-apply.cjs (o runner registraria a file no ledger
-- de migrations, gravando uma version "rollback-manual-…" e desalinhando a
-- fila do `supabase migration list`).

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
