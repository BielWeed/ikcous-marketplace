-- O CARTÃO ONLINE NASCE (26/09/2026 — plano
-- docs/superpowers/plans/2026-09-26-painel-cartao-e-devolucoes.md, tarefa 2;
-- spec docs/superpowers/specs/2026-09-26-cartao-online-design.md). Religa a
-- "Fase 3.5" que a fase 3 do gateway deixou planejada.
--
-- O QUE FALTAVA: o app só cobrava PIX pelo app. As três heranças da fase 3
-- impediam o cartão: (#2) depois da PRIMEIRA recusa o pedido ficava impagável
-- — a cobrança recusada ocupava a única vaga (`gateway_payment_id`) e a chave
-- de idempotência era fixa (`<pedido>`), então tentar de novo devolvia a mesma
-- recusa; e `confirmar_pagamento('recusado')` CANCELA o pedido e devolve o
-- estoque — um cartão recusado matava a compra que o PIX ainda salvaria.
--
-- O QUE ESTA MIGRATION FAZ, NA ORDEM:
--   1. `config_pagamento_cartao` (uma linha, id=1): crédito e débito
--      DESLIGADOS por padrão e o teto de parcelas (1..12). Leitura pública (o
--      checkout decide se mostra a opção); escrita só pela RPC
--      `salvar_config_pagamento_cartao` (admin). Nasce desligado de propósito:
--      o app envia COEP credentialless e o Brick de cartão monta iframes do
--      Mercado Pago que o lojista precisa ver funcionando num pedido de teste
--      antes de oferecer ao cliente (spec, decisão 7).
--   2. `marketplace_orders`: `tentativas_de_pagamento` (conta cada cobrança
--      que morreu; entra na chave de idempotência da próxima), `metodo_online`
--      (pix | credito | debito — o que o cliente usou de fato) e `parcelas`.
--      ADITIVAS: toda linha existente fica com 0 / NULL / NULL — comportamento
--      de hoje. Nenhuma ganha grant de escrita para authenticated (só o
--      service role da edge grava).
--   3. `liberar_cobranca_do_pedido(p_order_id, p_gateway_payment_id)` (só
--      service role): com id, solta a cobrança recusada SE ela ainda é a
--      gravada e o pedido segue aguardando e sem pagamento; sem id, só conta a
--      tentativa (recusa imediata que nunca ocupou a vaga). O pedido continua
--      com a reserva de 30 min — o cliente tenta outro cartão ou PIX.
--
-- O QUE NÃO MUDA: `confirmar_pagamento` (a ÚNICA escrita de pagamento) e o
-- fluxo do PIX. A edge decide chamar `liberar_...` no lugar de
-- `confirmar_pagamento('recusado')` só quando a cobrança recusada é de CARTÃO.
--
-- DADOS EXISTENTES: nenhuma linha reescrita; defaults preenchem as colunas.
--
-- IDEMPOTÊNCIA: IF NOT EXISTS nas colunas e na tabela, DO $$ para as CHECKs,
-- CREATE OR REPLACE nas funções, DROP POLICY IF EXISTS, ON CONFLICT DO NOTHING.
--
-- COMO APLICAR: `node scripts/db-apply.cjs <este arquivo>` (sem BEGIN/COMMIT).
--
-- FICHA DE VERIFICAÇÃO:
--   1. SELECT * FROM public.config_pagamento_cartao;  -- 1 linha, false/false/1
--   2. SELECT column_name, column_default FROM information_schema.columns
--       WHERE table_name='marketplace_orders' AND column_name IN
--       ('tentativas_de_pagamento','metodo_online','parcelas');
--   3. SELECT has_function_privilege('authenticated',
--        'public.liberar_cobranca_do_pedido(uuid,text)','EXECUTE');  -- false
--
-- ROLLBACK MANUAL: rollback-manual-20261176000000_o_cartao_online_nasce.sql
-- (dropa as RPCs, a tabela e as CHECKs; NÃO dropa as colunas do pedido — elas
-- guardam o histórico de como cada pedido foi pago). psql -1 -f, nunca db-apply.

-- ---------------------------------------------------------------------------
-- 1. Configuração do cartão
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.config_pagamento_cartao (
  id smallint PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  credito boolean NOT NULL DEFAULT false,
  debito boolean NOT NULL DEFAULT false,
  parcelas_max smallint NOT NULL DEFAULT 1 CHECK (parcelas_max BETWEEN 1 AND 12),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid
);

COMMENT ON TABLE public.config_pagamento_cartao IS
  'Cartão pelo app (Orders API do Mercado Pago): crédito/débito ligados e teto '
  'de parcelas. Uma linha (id=1). Nasce desligado. Leitura pública; escrita '
  'só por salvar_config_pagamento_cartao (admin).';

ALTER TABLE public.config_pagamento_cartao ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.config_pagamento_cartao FROM PUBLIC, anon, authenticated;
-- Achado L (revisão de 26/09/2026): SELECT na tabela inteira vazava
-- updated_by (o uuid do admin que mexeu por último) para anon/authenticated.
-- Checado ANTES de restringir: o checkout (src/lib/config-do-cartao.ts) e a
-- edge criar-pagamento leem só `credito,debito,parcelas_max` — nunca `*` —
-- então a concessão por coluna não quebra ninguém.
GRANT SELECT (id, credito, debito, parcelas_max, updated_at) ON public.config_pagamento_cartao TO anon, authenticated;
GRANT ALL ON public.config_pagamento_cartao TO service_role;

DROP POLICY IF EXISTS config_pagamento_cartao_publica_select_policy ON public.config_pagamento_cartao;
CREATE POLICY config_pagamento_cartao_publica_select_policy ON public.config_pagamento_cartao
  FOR SELECT TO anon, authenticated USING (true);

INSERT INTO public.config_pagamento_cartao (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

CREATE OR REPLACE FUNCTION public.salvar_config_pagamento_cartao(
  p_credito boolean,
  p_debito boolean,
  p_parcelas_max integer
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v public.config_pagamento_cartao%ROWTYPE;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Acesso negado.' USING ERRCODE = '42501';
  END IF;
  IF p_credito IS NULL OR p_debito IS NULL THEN
    RAISE EXCEPTION 'Informe se crédito e débito ficam ligados.' USING ERRCODE = '22023';
  END IF;
  IF p_parcelas_max IS NULL OR p_parcelas_max NOT BETWEEN 1 AND 12 THEN
    RAISE EXCEPTION 'O parcelamento vai de 1 a 12 vezes.' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.config_pagamento_cartao (id, credito, debito, parcelas_max, updated_at, updated_by)
  VALUES (1, p_credito, p_debito, p_parcelas_max::smallint, now(), auth.uid())
  ON CONFLICT (id) DO UPDATE
     SET credito = EXCLUDED.credito,
         debito = EXCLUDED.debito,
         parcelas_max = EXCLUDED.parcelas_max,
         updated_at = EXCLUDED.updated_at,
         updated_by = EXCLUDED.updated_by
  RETURNING * INTO v;

  RETURN to_jsonb(v) - 'updated_by';
END;
$$;

REVOKE ALL ON FUNCTION public.salvar_config_pagamento_cartao(boolean, boolean, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.salvar_config_pagamento_cartao(boolean, boolean, integer) TO authenticated;

-- ---------------------------------------------------------------------------
-- 2. Colunas do pedido
-- ---------------------------------------------------------------------------
ALTER TABLE public.marketplace_orders
  ADD COLUMN IF NOT EXISTS tentativas_de_pagamento integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS metodo_online text,
  ADD COLUMN IF NOT EXISTS parcelas smallint;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'marketplace_orders_tentativas_de_pagamento_check') THEN
    ALTER TABLE public.marketplace_orders
      ADD CONSTRAINT marketplace_orders_tentativas_de_pagamento_check CHECK (tentativas_de_pagamento >= 0);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'marketplace_orders_metodo_online_check') THEN
    ALTER TABLE public.marketplace_orders
      ADD CONSTRAINT marketplace_orders_metodo_online_check
      CHECK (metodo_online IS NULL OR metodo_online IN ('pix', 'credito', 'debito'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'marketplace_orders_parcelas_check') THEN
    ALTER TABLE public.marketplace_orders
      ADD CONSTRAINT marketplace_orders_parcelas_check CHECK (parcelas IS NULL OR parcelas BETWEEN 1 AND 12);
  END IF;
END
$$;

COMMENT ON COLUMN public.marketplace_orders.tentativas_de_pagamento IS
  'Cobranças que morreram neste pedido (cartão recusado, PIX trocado por cartão). '
  'Entra na chave de idempotência da próxima cobrança. Só o service role grava.';
COMMENT ON COLUMN public.marketplace_orders.metodo_online IS
  'Como o pedido online foi cobrado de fato: pix | credito | debito. Só o service role grava.';
COMMENT ON COLUMN public.marketplace_orders.parcelas IS
  'Parcelas do cartão de crédito (1..12). Só o service role grava.';

-- ---------------------------------------------------------------------------
-- 3. Liberar a vaga da cobrança recusada
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.liberar_cobranca_do_pedido(
  p_order_id uuid,
  p_gateway_payment_id text DEFAULT NULL
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_ok boolean;
BEGIN
  IF p_gateway_payment_id IS NULL THEN
    -- Recusa imediata: a cobrança nunca ocupou a vaga; só conta a tentativa
    -- para a próxima chave de idempotência sair diferente.
    UPDATE public.marketplace_orders
       SET tentativas_de_pagamento = tentativas_de_pagamento + 1,
           updated_at = now()
     WHERE id = p_order_id
       AND payment_status = 'aguardando'
       AND gateway_payment_id IS NULL
       AND paid_at IS NULL
    RETURNING true INTO v_ok;
  ELSE
    -- Só solta a cobrança que AINDA é a gravada: uma resposta atrasada de uma
    -- cobrança antiga nunca derruba a cobrança nova do pedido.
    UPDATE public.marketplace_orders
       SET gateway_payment_id = NULL,
           metodo_online = NULL,
           parcelas = NULL,
           tentativas_de_pagamento = tentativas_de_pagamento + 1,
           updated_at = now()
     WHERE id = p_order_id
       AND gateway_payment_id = p_gateway_payment_id
       AND payment_status = 'aguardando'
       AND paid_at IS NULL
    RETURNING true INTO v_ok;
  END IF;
  RETURN COALESCE(v_ok, false);
END;
$$;

COMMENT ON FUNCTION public.liberar_cobranca_do_pedido(uuid, text) IS
  'Cartão recusado não mata o pedido: solta a vaga da cobrança (se ainda for a '
  'gravada, com o pedido aguardando e sem pagamento) e conta a tentativa. Sem '
  'id, só conta. Só o service role (edges criar-pagamento, webhook e '
  'reconciliação) executa.';

REVOKE ALL ON FUNCTION public.liberar_cobranca_do_pedido(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.liberar_cobranca_do_pedido(uuid, text) TO service_role;

-- ---------------------------------------------------------------------------
-- 4. Estorno manual ganha uma data real (achado F da revisão de 26/09/2026)
-- ---------------------------------------------------------------------------
-- O Financeiro (20261177000000) precisa datar o "estorno registrado fora do
-- app" pelo momento em que a loja apertou o botão — hoje usa
-- marketplace_orders.updated_at, que QUALQUER update posterior do pedido
-- (reabrir, editar nota, o próprio confirmar_pagamento de outra tentativa)
-- empurra para a frente. registrar_estorno_manual (20261072000000) não
-- grava nenhum carimbo próprio, e não existe hoje outra fonte confiável
-- desse instante (marketplace_order_payment_history é sobre "recebido/
-- desfeito" na entrega, natureza diferente) — daí a coluna mínima abaixo, no
-- lugar que já mexe em colunas do pedido (não pode ir na migration do
-- Financeiro: ela só LÊ marketplace_orders, nunca escreve).
ALTER TABLE public.marketplace_orders
  ADD COLUMN IF NOT EXISTS estorno_manual_registrado_em timestamptz;

COMMENT ON COLUMN public.marketplace_orders.estorno_manual_registrado_em IS
  'Quando registrar_estorno_manual marcou payment_status = ''estornado'' '
  '(achado F, 26/09/2026). NULL em pedido estornado manualmente ANTES desta '
  'migration — o Financeiro cai para updated_at nesse caso legado.';

-- CREATE OR REPLACE de uma função nascida em 20261072000000: mesmo padrão de
-- devolver_estoque (20261060000000) — a versão viva é sempre a da migration
-- mais recente que a redefine. Corpo idêntico ao original, só grava o
-- carimbo na PRIMEIRA vez (guarda IS NULL, idempotente por construção).
-- Achado 1 (revisão de 26/09/2026, rodada 2): "Já devolvi" olhava só
-- payment_status — o balde "Devolver agora" do front (AdminOrdersView)
-- também olhava só isso, então um pedido cuja devolução JÁ concluiu com
-- reembolso manual (dinheiro que já saiu por aquele caminho) continuava
-- aparecendo pelo total CHEIO, e clicar aqui registrava uma SEGUNDA saída do
-- mesmo dinheiro (drawer negativo, DRE com dedução em dobro). Refuse quando
-- não sobra nada — o mesmo cálculo que o Financeiro (77) e a conclusão da
-- devolução (75) usam.
CREATE OR REPLACE FUNCTION public.registrar_estorno_manual(p_order_id uuid)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_existe boolean;
    v_ja_estornado boolean;
    v_total numeric;
    v_valor_estornado numeric;
    v_ja_manual numeric;
BEGIN
    IF NOT public.is_admin() THEN
        RAISE EXCEPTION 'somente a loja registra o estorno'
            USING ERRCODE = '42501';
    END IF;

    SELECT EXISTS (
        SELECT 1 FROM public.marketplace_orders WHERE id = p_order_id
    ),
    EXISTS (
        SELECT 1 FROM public.marketplace_orders
         WHERE id = p_order_id AND payment_status = 'estornado'
    )
    INTO v_existe, v_ja_estornado;

    IF NOT v_existe THEN
        RAISE EXCEPTION 'pedido nao encontrado' USING ERRCODE = 'P0002';
    END IF;

    IF NOT v_ja_estornado THEN
        SELECT total, COALESCE(valor_estornado, 0) INTO v_total, v_valor_estornado
          FROM public.marketplace_orders WHERE id = p_order_id;
        SELECT COALESCE(sum(d.valor_reembolso), 0) INTO v_ja_manual
          FROM public.devolucoes d
         WHERE d.order_id = p_order_id AND d.status = 'concluida' AND d.reembolso_manual;

        IF v_total - v_valor_estornado - v_ja_manual <= 0 THEN
            RAISE EXCEPTION 'Este pedido não tem mais nada a devolver: o valor já saiu por outro caminho (devolução ou estorno).'
                USING ERRCODE = '22023';
        END IF;

        UPDATE public.marketplace_orders
           SET payment_status = 'estornado',
               estorno_manual_registrado_em = COALESCE(estorno_manual_registrado_em, now())
         WHERE id = p_order_id;
    END IF;

    RETURN json_build_object('ok'::text, true, 'payment_status'::text, 'estornado');
END;
$$;

-- ---------------------------------------------------------------------------
-- 5. O carimbo do achado F cobre TODO caminho para 'estornado', não só o
--    manual (achado 7 da revisão de 26/09/2026, rodada 2)
-- ---------------------------------------------------------------------------
-- A coluna da Seção 4 só nascia carimbada por registrar_estorno_manual — mas
-- payment_status também vira 'estornado' DIRETO por confirmar_pagamento
-- (20260901000000, ramo p_status = 'estornado', o Mercado Pago avisando por
-- fora do ledger de order_refunds), sem passar por nenhuma RPC desta
-- migration. Sem um carimbo confiável TAMBÉM nesse caminho, o MESMO buraco
-- do achado F reaparece por outra porta: fin__movimentos cai no updated_at,
-- que qualquer edição futura do pedido empurra para a frente.
--
-- Por que gatilho, e não mais uma RPC alterada: confirmar_pagamento tem TRÊS
-- cópias vivas (20260808000000, 20260810000000, 20260901000000 — a última é
-- que vale, CREATE OR REPLACE sucessivo) e reescrevê-la aqui só para acender
-- um carimbo duplicaria o corpo inteiro de uma função que não é desta
-- frente. O gatilho fica ESTREITO de propósito: só a COLUNA payment_status
-- (`UPDATE OF`), só a TRANSIÇÃO para 'estornado' (WHEN), e só quando ninguém
-- carimbou antes (COALESCE em cima do valor que a própria instrução já
-- atribuiu a NEW — a mesma UPDATE de registrar_estorno_manual que grava as
-- duas colunas juntas não é pisada por ele: o BEFORE vê o valor que o SET já
-- decidiu, e o COALESCE mantém).
CREATE OR REPLACE FUNCTION public.marca_estorno_direto_do_pedido()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.estorno_manual_registrado_em := COALESCE(NEW.estorno_manual_registrado_em, now());
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tr_marca_estorno_direto_do_pedido ON public.marketplace_orders;
CREATE TRIGGER tr_marca_estorno_direto_do_pedido
  BEFORE UPDATE OF payment_status ON public.marketplace_orders
  FOR EACH ROW
  WHEN (NEW.payment_status = 'estornado' AND OLD.payment_status IS DISTINCT FROM 'estornado')
  EXECUTE FUNCTION public.marca_estorno_direto_do_pedido();

COMMENT ON FUNCTION public.marca_estorno_direto_do_pedido() IS
  'Achado 7 (26/09/2026, rodada 2): estende o carimbo do achado F a QUALQUER '
  'caminho que vire payment_status=''estornado'' — não só '
  'registrar_estorno_manual. Sem SECURITY DEFINER: só escreve em NEW, não lê '
  'nada além do próprio pedido, e roda sempre dentro de um UPDATE que quem '
  'chamou já tinha permissão de fazer.';
