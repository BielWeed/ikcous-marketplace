-- ============================================================================
-- Migration 20261656000000 — a visitante deixa o e-mail DEPOIS da compra (checkout; cria DUAS funções novas; ADITIVA: nenhuma tabela,
-- coluna, função existente ou linha é criada, apagada ou reescrita ao aplicar)
-- ============================================================================
--
-- 1. O DEFEITO
--
-- Quem compra sem conta (a visitante) nunca recebe comprovante por e-mail: o formulário da compra não pede e-mail e
-- customer_data.email nasce vazio. Pior: o "Acompanhar pedido" (generate_order_otp_v2 / get_orders_by_otp_v2) só acha o pedido pelo
-- e-mail gravado nele — para a visitante era um beco sem saída (CheckoutView, comentário CheckoutView-3301).
--
-- 2. O DESENHO (decisão de produto do sócio, 28/11/2026)
--
-- O e-mail NÃO entra na compra: a gravação do pedido e a cobrança não mudam. Ele é pedido UMA vez, na tela "Pedido recebido!" da
-- visitante, e gravado por esta porta nova; depois o comprovante sai pela edge send-order-confirmation, que lê o destinatário do
-- banco.
--
--   informar_email_da_visitante(p_order_id uuid, p_email text) -> jsonb (NOVA; anon e authenticated)
--     Grava customer_data.email SÓ se TODAS valerem, com a linha do pedido trancada (FOR UPDATE: duas chamadas ao mesmo tempo se
--     enfileiram e a segunda já enxerga o e-mail da primeira):
--       a. o e-mail tem formato válido (até 254 caracteres; letras, números e . _ % + - antes do @; domínio com ponto). Conferido
--          ANTES de ler o pedido: e-mail inválido não diz nada sobre o pedido;
--       b. o pedido é de VISITANTE: user_id NULO (create_marketplace_order_v24 grava auth.uid(), nulo só sem sessão), canal 'online'
--          (a venda do balcão também nasce sem user_id, e não é de visitante) e forma diferente de 'online' (a v24 recusa
--          pagamento pelo app sem sessão; é a tela "Pedido recebido!" que pergunta). Assim o webhook do pagamento, cujo comprovante
--          de pedido PAGO fura o teto, nunca encontra um e-mail que entrou por esta porta;
--       c. o pedido ainda NÃO tem e-mail (customer_data.email vazio). O e-mail é gravado uma vez e nunca sobrescrito; repetir com o
--          MESMO e-mail (resposta perdida na rede) responde ok sem escrever nada;
--       d. o pedido foi criado há MENOS de 15 minutos.
--     Respostas: {ok: true, motivo: 'gravado' | 'ja_gravado'}; {ok: false, motivo: 'email_invalido' | 'fora_do_prazo' |
--     'nao_aceita'}. Pedido que não existe, que não é de visitante, que já tem OUTRO e-mail ou cujo customer_data não é objeto: a
--     MESMA resposta 'nao_aceita' (não diz qual metade bateu). O id completo do pedido só existe no navegador de quem comprou: para
--     fora sai só "#" + 6 letras.
--
--   reivindicar_comprovante_da_visitante(p_order_id uuid) -> boolean (NOVA; só service_role)
--     A reserva do comprovante da visitante, para a edge send-order-confirmation. É a reivindicar_email_de_confirmacao
--     (20261217000000) SEM a passagem do pedido pago: os MESMOS dois contadores e os MESMOS tetos (destinatário 10 e comprovante da
--     loja 40 nas últimas 24 h), e o pedido PAGO também respeita o teto — o e-mail novo nunca come a cota do código de login.
--     Só pedido de visitante (user_id nulo e canal 'online'), com e-mail, ainda não avisado. Sem vaga: false e nada é marcado (o
--     e-mail continua gravado para o "Acompanhar pedido"). Falha do CONTADOR (não do teto): o erro sobe, a edge responde
--     envio_falhou e nada é marcado (aqui não há "o comprovante segue mesmo assim": sem contador não se sabe se a cota aguenta).
--
-- 3. DADOS EXISTENTES
--
-- Nenhuma linha é lida para decidir nem reescrita ao aplicar (só CREATE OR REPLACE de duas funções novas e os privilégios delas).
-- Pedidos de visitante criados ANTES do apply ficam como estão: a janela de 15 minutos faz a porta valer só para a compra que acabou
-- de acontecer. O teto da 20261217000000 e os contadores não mudam.
--
-- 4. PRÉ-VOO (B1_BASELINE_DIVERGENT, ANTES de qualquer escrita)
--
-- Recusa se: faltar em marketplace_orders alguma coluna que as funções leem, com o tipo esperado; reservar_vaga_de_email ou
-- chave_do_destinatario não tiverem o corpo da 20261217000000; faltar liberar_email_de_confirmacao(uuid) (a edge devolve a reserva
-- por ela quando o envio falha); alguma das duas funções novas já existir com outro corpo ou com sobrecarga.
--
-- 5. IDEMPOTÊNCIA, TRANSAÇÃO E TRAVA
--
-- CREATE OR REPLACE + REVOKE/GRANT: rodar duas vezes deixa o mesmo estado (o pré-voo aceita o que esta migration deixa). SEM
-- BEGIN/COMMIT (regra da casa, AGENTS.md: o aplicador dá a transação e o conferirCorpo do aplicar-migrations.yml RECUSA controle de
-- transação no topo do arquivo); pré-voo, funções, privilégios e pós-voo caem juntos ou não caem. lock_timeout = 5s.
--
-- 6. ORDEM
--
-- Banco ANTES do front e da edge: a tela nova chama informar_email_da_visitante e a edge nova chama
-- reivindicar_comprovante_da_visitante. Com o front novo e o banco velho, a RPC não existe (PGRST202/42883) e a tela diz que não deu
-- para guardar o e-mail; nada mais muda. Com o banco novo e o front velho, ninguém chama as duas.
--
-- 7. FICHA DE VERIFICAÇÃO: consultas 212a (depois) / 212b (antes).
--   PROVA VIVA: tests/banco/a-visitante-deixa-o-email-viva.cjs (rpc-ci).
--
-- 8. ROLLBACK
--
-- rollback-manual-20261656000000_a_visitante_deixa_o_email_depois_da_compra.sql tira as DUAS funções que esta criou (DROP FUNCTION só
-- delas). NÃO apaga nenhuma linha: os e-mails que as visitantes já deixaram continuam em customer_data.email (são o que a pessoa
-- digitou, e o "Acompanhar pedido" segue achando o pedido por eles).
-- ============================================================================

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

DO $preflight_20261656000000$
DECLARE
  r record;
  v_hash text;
BEGIN
  -- As colunas de marketplace_orders que as duas funções leem ou escrevem, com o tipo de hoje.
  FOR r IN
    SELECT *
      FROM (VALUES
        ('id', 'uuid'),
        ('user_id', 'uuid'),
        ('canal', 'text'),
        ('payment_method', 'text'),
        ('created_at', 'timestamp with time zone'),
        ('customer_data', 'jsonb'),
        ('confirmation_email_sent_at', 'timestamp with time zone')
      ) AS esperado(coluna, tipo)
  LOOP
    IF NOT EXISTS (
         SELECT 1 FROM pg_attribute a
          WHERE a.attrelid = to_regclass('public.marketplace_orders')
            AND a.attname = r.coluna AND a.attnum > 0 AND NOT a.attisdropped
            AND format_type(a.atttypid, a.atttypmod) = r.tipo) THEN
      RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: marketplace_orders.% ausente ou sem o tipo %; revise antes de aplicar.', r.coluna, r.tipo;
    END IF;
  END LOOP;

  -- O teto de e-mails da 20261217000000: a reserva e a chave do destinatário com os corpos dela.
  FOR r IN
    SELECT *
      FROM (VALUES
        ('public.reservar_vaga_de_email(text,integer)', '373815e668edf9480d2dce94fb59d467'),
        ('public.chave_do_destinatario(text)', 'b5a9a0f8bb405c082cdb8cb7ee662d1e')
      ) AS esperado(assinatura, hash_1217)
  LOOP
    SELECT md5(replace(prosrc, E'\r', '')) INTO v_hash FROM pg_proc WHERE oid = to_regprocedure(r.assinatura);
    IF v_hash IS DISTINCT FROM r.hash_1217 THEN
      RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: % (hash %) nao e o corpo da 20261217000000; revise antes de aplicar.', r.assinatura, COALESCE(v_hash, 'ausente');
    END IF;
  END LOOP;

  IF to_regprocedure('public.liberar_email_de_confirmacao(uuid)') IS NULL THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: liberar_email_de_confirmacao(uuid) ausente (a edge devolve a reserva por ela); revise antes de aplicar.';
  END IF;

  -- As duas novas: ausentes (primeiro apply) ou uma só, com o corpo desta (reaplicação).
  FOR r IN
    SELECT *
      FROM (VALUES
        ('informar_email_da_visitante', 'public.informar_email_da_visitante(uuid,text)', '4ab021c0ff86fbecf36e4c4702a04398'),
        ('reivindicar_comprovante_da_visitante', 'public.reivindicar_comprovante_da_visitante(uuid)', '37c9cd2bd0d16c466bb824d0f3a2887c')
      ) AS esperado(nome, assinatura, hash_desta)
  LOOP
    IF (SELECT count(*) FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname = r.nome) > 1
       OR (SELECT count(*) FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname = r.nome) = 1
          AND to_regprocedure(r.assinatura) IS NULL THEN
      RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: % ja existe com outra assinatura ou com sobrecarga; revise antes de aplicar.', r.nome;
    END IF;
    SELECT md5(replace(prosrc, E'\r', '')) INTO v_hash FROM pg_proc WHERE oid = to_regprocedure(r.assinatura);
    IF v_hash IS NOT NULL AND v_hash IS DISTINCT FROM r.hash_desta THEN
      RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: % ja existe com outro corpo (hash %); revise antes de aplicar.', r.assinatura, v_hash;
    END IF;
  END LOOP;
END $preflight_20261656000000$;

-- ---------------------------------------------------------------------------
-- A porta da visitante: grava o e-mail uma vez, no pedido de visitante recém-criado
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.informar_email_da_visitante(p_order_id uuid, p_email text)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path TO 'public'
AS $informar$
DECLARE
  -- A porta vale só para a compra que acabou de acontecer (a tela "Pedido recebido!").
  v_janela CONSTANT interval := interval '15 minutes';
  v_email text := trim(coalesce(p_email, ''));
  v_pedido record;
BEGIN
  -- a. Formato, ANTES de ler o pedido: e-mail inválido não diz nada sobre o pedido. Sem espaço, vírgula nem quebra de linha (o
  -- endereço vai para o cabeçalho "Para" do comprovante).
  IF length(v_email) > 254
     OR v_email !~ '^[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}$' THEN
    RETURN jsonb_build_object('ok', false, 'motivo', 'email_invalido');
  END IF;

  -- A linha trancada: duas chamadas ao mesmo tempo se enfileiram aqui, e a segunda lê o e-mail que a primeira gravou.
  SELECT o.user_id, o.canal, o.payment_method, o.created_at,
         jsonb_typeof(o.customer_data) AS forma,
         trim(coalesce(o.customer_data ->> 'email', '')) AS email
    INTO v_pedido
    FROM public.marketplace_orders o
   WHERE o.id = p_order_id
     FOR UPDATE;

  -- b. Só pedido de VISITANTE: sem conta (user_id nulo), da loja online (o balcão também nasce sem conta) e pago na entrega ou na
  -- retirada (a v24 recusa pagamento pelo app sem sessão). Pedido que não existe e pedido de outra pessoa: a MESMA resposta.
  IF NOT FOUND
     OR v_pedido.user_id IS NOT NULL
     OR v_pedido.canal IS DISTINCT FROM 'online'
     OR v_pedido.payment_method IS NOT DISTINCT FROM 'online'
     OR v_pedido.forma IS DISTINCT FROM 'object' THEN
    RETURN jsonb_build_object('ok', false, 'motivo', 'nao_aceita');
  END IF;

  -- c. Uma vez só, sem sobrescrever. O MESMO e-mail de novo (a resposta da primeira se perdeu na rede) é ok, sem escrever.
  IF v_pedido.email <> '' THEN
    IF lower(v_pedido.email) = lower(v_email) THEN
      RETURN jsonb_build_object('ok', true, 'motivo', 'ja_gravado');
    END IF;
    RETURN jsonb_build_object('ok', false, 'motivo', 'nao_aceita');
  END IF;

  -- d. Só nos primeiros 15 minutos do pedido.
  IF v_pedido.created_at <= now() - v_janela THEN
    RETURN jsonb_build_object('ok', false, 'motivo', 'fora_do_prazo');
  END IF;

  UPDATE public.marketplace_orders
     SET customer_data = customer_data || jsonb_build_object('email', v_email)
   WHERE id = p_order_id;

  RETURN jsonb_build_object('ok', true, 'motivo', 'gravado');
END;
$informar$;

COMMENT ON FUNCTION public.informar_email_da_visitante(uuid, text) IS
  'A visitante (pedido sem conta, da loja online, pago na entrega ou na retirada) deixa o e-mail na tela "Pedido recebido!": grava customer_data.email uma vez, sem sobrescrever, so nos primeiros 15 minutos do pedido e com formato valido (20261656000000). Linha trancada (FOR UPDATE). anon e authenticated executam.';

REVOKE ALL ON FUNCTION public.informar_email_da_visitante(uuid, text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.informar_email_da_visitante(uuid, text) TO anon, authenticated;

-- ---------------------------------------------------------------------------
-- A reserva do comprovante da visitante: o teto vale MESMO com o pedido pago
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.reivindicar_comprovante_da_visitante(p_order_id uuid)
RETURNS boolean
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path TO 'public'
AS $reivindicar_visitante$
DECLARE
  -- Os MESMOS tetos e contadores de reivindicar_email_de_confirmacao (20261217000000): o de destinatario e' o mesmo do codigo de
  -- login (generate_order_otp_v2), o da loja e' so do comprovante. Aqui SEM a passagem do pedido pago: o e-mail que a visitante
  -- deixou depois da compra nunca fura o teto.
  v_teto_por_destinatario CONSTANT integer := 10;
  v_teto_do_comprovante_na_loja CONSTANT integer := 40;
  v_email text;
  v_reservado boolean;
BEGIN
  SELECT trim(coalesce(o.customer_data ->> 'email', ''))
    INTO v_email
    FROM public.marketplace_orders o
   WHERE o.id = p_order_id
     AND o.user_id IS NULL
     AND o.canal = 'online'
     AND o.confirmation_email_sent_at IS NULL
     FOR UPDATE;

  -- Pedido que nao e' de visitante, ja avisado ou sem e-mail: nada a reservar.
  IF NOT FOUND OR v_email = '' THEN
    RETURN false;
  END IF;

  BEGIN
    IF NOT public.reservar_vaga_de_email(
      'destinatario:' || public.chave_do_destinatario(v_email),
      v_teto_por_destinatario
    ) THEN
      RAISE EXCEPTION USING ERRCODE = 'IKE01';
    END IF;
    IF NOT public.reservar_vaga_de_email('comprovante:loja', v_teto_do_comprovante_na_loja) THEN
      RAISE EXCEPTION USING ERRCODE = 'IKE01';
    END IF;
  EXCEPTION
    WHEN SQLSTATE 'IKE01' THEN
      -- o bloco desfaz a vaga que ja tinha sido reservada no outro contador
      RETURN false;
  END;

  UPDATE public.marketplace_orders
     SET confirmation_email_sent_at = now()
   WHERE id = p_order_id
     AND confirmation_email_sent_at IS NULL
  RETURNING true INTO v_reservado;

  RETURN coalesce(v_reservado, false);
END;
$reivindicar_visitante$;

COMMENT ON FUNCTION public.reivindicar_comprovante_da_visitante(uuid) IS
  'Reserva o comprovante do pedido de visitante (user_id nulo, canal online) para a edge send-order-confirmation: os mesmos contadores e tetos da reivindicar_email_de_confirmacao, SEM a passagem do pedido pago (20261656000000). true = reservou e marcou; false = sem vaga, ja avisado ou nao e de visitante. So o servidor executa.';

REVOKE ALL ON FUNCTION public.reivindicar_comprovante_da_visitante(uuid) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.reivindicar_comprovante_da_visitante(uuid) TO service_role;

-- ---------------------------------------------------------------------------
-- PÓS-VOO (B2_POSTFLIGHT_FAILED): uma só de cada, o corpo desta, os atributos e a ACL desenhados
-- ---------------------------------------------------------------------------
DO $posvoo_20261656000000$
DECLARE
  v_inf oid := to_regprocedure('public.informar_email_da_visitante(uuid,text)');
  v_rei oid := to_regprocedure('public.reivindicar_comprovante_da_visitante(uuid)');
BEGIN
  IF v_inf IS NULL
     OR (SELECT md5(replace(prosrc, E'\r', '')) FROM pg_proc WHERE oid = v_inf) IS DISTINCT FROM '4ab021c0ff86fbecf36e4c4702a04398'
     OR (SELECT count(*) FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname = 'informar_email_da_visitante') <> 1
     OR NOT EXISTS (
          SELECT 1 FROM pg_proc p JOIN pg_language l ON l.oid = p.prolang
           WHERE p.oid = v_inf
             AND l.lanname = 'plpgsql' AND p.prokind = 'f' AND p.prosecdef AND p.provolatile = 'v'
             AND NOT p.proisstrict AND NOT p.proretset
             AND p.proconfig = ARRAY['search_path=public']::text[]
             AND pg_get_function_arguments(p.oid) = 'p_order_id uuid, p_email text'
             AND pg_get_function_result(p.oid) = 'jsonb') THEN
    RAISE EXCEPTION 'B2_POSTFLIGHT_FAILED: informar_email_da_visitante nao ficou com o corpo, a assinatura ou os atributos desta migration.';
  END IF;
  -- EXECUTE de anon e authenticated; nem PUBLIC nem service_role.
  IF EXISTS (SELECT 1 FROM pg_proc p
               CROSS JOIN LATERAL aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) g
              WHERE p.oid = v_inf AND g.privilege_type = 'EXECUTE' AND g.grantee = 0)
     OR NOT has_function_privilege('anon', v_inf, 'EXECUTE')
     OR NOT has_function_privilege('authenticated', v_inf, 'EXECUTE')
     OR has_function_privilege('service_role', v_inf, 'EXECUTE') THEN
    RAISE EXCEPTION 'B2_POSTFLIGHT_FAILED: o EXECUTE de informar_email_da_visitante deve ser so de anon e authenticated.';
  END IF;

  IF v_rei IS NULL
     OR (SELECT md5(replace(prosrc, E'\r', '')) FROM pg_proc WHERE oid = v_rei) IS DISTINCT FROM '37c9cd2bd0d16c466bb824d0f3a2887c'
     OR (SELECT count(*) FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname = 'reivindicar_comprovante_da_visitante') <> 1
     OR NOT EXISTS (
          SELECT 1 FROM pg_proc p JOIN pg_language l ON l.oid = p.prolang
           WHERE p.oid = v_rei
             AND l.lanname = 'plpgsql' AND p.prokind = 'f' AND p.prosecdef AND p.provolatile = 'v'
             AND NOT p.proisstrict AND NOT p.proretset
             AND p.proconfig = ARRAY['search_path=public']::text[]
             AND pg_get_function_arguments(p.oid) = 'p_order_id uuid'
             AND pg_get_function_result(p.oid) = 'boolean') THEN
    RAISE EXCEPTION 'B2_POSTFLIGHT_FAILED: reivindicar_comprovante_da_visitante nao ficou com o corpo, a assinatura ou os atributos desta migration.';
  END IF;
  -- EXECUTE so do service_role: nem PUBLIC, nem anon, nem authenticated.
  IF EXISTS (SELECT 1 FROM pg_proc p
               CROSS JOIN LATERAL aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) g
              WHERE p.oid = v_rei AND g.privilege_type = 'EXECUTE' AND g.grantee = 0)
     OR has_function_privilege('anon', v_rei, 'EXECUTE')
     OR has_function_privilege('authenticated', v_rei, 'EXECUTE')
     OR NOT has_function_privilege('service_role', v_rei, 'EXECUTE') THEN
    RAISE EXCEPTION 'B2_POSTFLIGHT_FAILED: o EXECUTE de reivindicar_comprovante_da_visitante deve ser so do service_role.';
  END IF;
END $posvoo_20261656000000$;

-- As duas são chamadas por RPC (a tela da visitante e a edge): recarrega o schema cache. Idempotente.
NOTIFY pgrst, 'reload schema';
