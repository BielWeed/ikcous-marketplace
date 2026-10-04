-- A CONTESTAÇÃO DECIDE SOB A TRAVA DO PEDIDO (dinheiro: ledger de estorno;
-- Lote A, 04/10/2026, bloqueios 1/3/5/6 e 2 da revisão).
--
-- O DEFEITO: o webhook decidia a contestação (chargeback) em TypeScript,
-- sobre um retrato do ledger lido no começo da entrega, e gravava linha a
-- linha (INSERT, UPDATE, concluir_estorno) sem trava nenhuma no pedido:
--   1. ESTIMATIVA virava ESTORNO CONFIRMADO: sem o valor do caso em reais, o
--      total pago era usado como base e CONCLUÍDO (somado em
--      valor_estornado) — inclusive sem reserva prévia.
--   3. MULTICASO com retrato velho: a liberação do CBK1 não mudava o retrato
--      local, e o CBK2 do mesmo pedido era pulado ("sem saldo").
--   5. CORRIDA 23505: a entrega B (caso final 30) esbarrava na reserva
--      ESTIMADA de 100 da entrega A (mesmo CBK) e concluía os 100.
--   6. SALDO AGREGADO sem trava: pedido de 100, dois casos de 60 em
--      entregas paralelas -> 120 reservados (o índice único por CBK não
--      protege a SOMA).
--   2. Um refund REGULAR (REF..., POST /v1/orders/{id}/refund) numa order
--      contestada era ignorado por suspeita de ser o débito da contestação
--      — dedup inventado: nenhum contrato do MP liga REF a CBK.
--
-- O QUE MUDA (aditivo):
--   * `order_refunds.mp_chargeback_case_id` (text, NULL): o case_id do MP
--     ligado ao CBK da linha. Mesmo CBK com outro case_id = divergência.
--   * `order_refunds.mp_chargeback_valor_do_caso` (numeric(12,2), NULL,
--     > 0): o valor do CASO em reais, quando o MP o confirmou. NULL = a
--     linha nasceu de ESTIMATIVA (total pago). É o que separa "reserva
--     estimada" de "valor confirmado" — estimativa só RESERVA, nunca conclui.
--   * `public.contestacoes_decisao_final` (tabela nova): a decisão FINAL do
--     caso (a favor / contra a loja), com identidade (pedido + CBK + case_id),
--     valor do caso e procedência (`origem`, `decidido_em`) — gravada MESMO
--     quando não existe reserva a liberar. Sem ela, um GET final "a favor da
--     loja" que chegava antes de qualquer reserva não deixava rastro, e uma
--     notificação PENDENTE atrasada (o MP entrega fora de ordem) criava a
--     reserva depois de o caso já estar ganho. Pendente depois da final:
--     'ja_decidido', nada reservado. Final que vira (a favor -> contra, sem
--     linha): 'revertido', aviso, nada mexido. Uma linha por (pedido, CBK);
--     nada é apagado nem reescrito (ON CONFLICT DO NOTHING). Fora do alcance
--     do cliente: RLS ligada sem política e REVOKE de anon/authenticated —
--     só as funções (SECURITY DEFINER) a leem e escrevem.
--   * `registrar_contestacao_no_ledger(...)`: calcula, reserva, adota linha
--     antiga, ajusta, conclui e libera numa transação só, com o pedido
--     travado (`SELECT ... FOR UPDATE` em marketplace_orders — a MESMA trava
--     da solicitar_estorno e das RPCs de devolução; ver ORDEM GLOBAL DAS
--     TRAVAS abaixo), e devolve o estado CANÔNICO (valor_estornado, em voo,
--     disponível, a linha do caso).
--   * `registrar_estorno_externo_do_mp(...)`: TODO refund que o MP já
--     processou e nenhuma linha reivindicou (REF..., feito no painel ou
--     regular numa order contestada), sob a mesma trava: entra INTEIRO e
--     concluído se cabe no dinheiro real (total - estornado - reserva de
--     contestação em voo), senão NÃO entra, NÃO consome a identidade (a
--     reentrega tenta de novo) e o webhook avisa o admin — nunca recorta
--     para caber. A linha do APP ainda sem confirmação do MP (solicitado /
--     em_processamento de cliente/lojista) é INTENÇÃO e não reduz o que o MP
--     já devolveu de fato: antes, pedido 100 com REF 20 concluído, APP 20
--     solicitado e um REF novo de 70 gravava 60 (o clamp descontava o APP) e
--     a reentrega pulava o REF já "reivindicado" — os 10 nunca voltavam. O
--     APP não é liberado aqui: o executor dele o recusa antes de qualquer
--     POST (guardaAntesDeChamar: valor > total - valor_estornado).
--
-- REGRAS DE DINHEIRO (todas dentro da trava, contra o estado relido):
--   disponível = total - valor_estornado - soma(solicitado/em_processamento
--   das OUTRAS linhas) — a fórmula da solicitar_estorno (2026110000000).
--   em_analise      -> reserva (em_processamento) do valor do caso, ou da
--                      estimativa; limitada ao disponível (aviso 'saldo' se
--                      não coube inteira). Linha existente: o valor do caso
--                      confirmado ajusta a reserva (desce ao caso; sobe só
--                      até o disponível).
--   contra_a_loja   -> CONCLUI só com o valor do CASO (BRL, positivo) e só
--                      se ele cabe no disponível; a linha passa a ter
--                      exatamente o valor do caso (parcial confirma só o
--                      parcial). Sem valor do caso: reserva a estimativa
--                      (sem linha) ou conserva a reserva, e avisa — nunca
--                      conclui. Não cabe: conserva / reserva o que sobra
--                      (bloqueia novas devoluções) e avisa.
--   a_favor_da_loja -> libera a reserva (recusado), nunca soma.
--   Divergência de vínculo (case_id ou valor confirmado diferente do
--   gravado), pedido não pago, linha antiga ambígua, decisão revertida:
--   nada muda, aviso.
--
-- ORDEM GLOBAL DAS TRAVAS (decisão de 04/10/2026, deadlock 94 x 96):
--   LINHAS de order_refunds do pedido (ORDER BY id, FOR UPDATE) -> PEDIDO
--   (marketplace_orders FOR UPDATE) -> cálculo do saldo. É a ordem que a
--   concluir_estorno (2026110000100) impõe — ela trava a LINHA (UPDATE) e só
--   depois o PEDIDO (UPDATE) e não pode ser invertida — e que a
--   registrar_estorno_manual (89/94) já segue. As duas funções daqui travam
--   primeiro as linhas que podem ESCREVER, em ordem de id, e só então o
--   pedido; linha nascida DEPOIS da trava das linhas não precisa de trava
--   prévia: a trava do pedido continua serializando o saldo agregado.
--   Quais linhas: as do SISTEMA (contestação e refund externo — as únicas
--   que estas funções alteram ou concluem) e, na do refund externo, a linha
--   que já carrega o MESMO mp_refund_id. As linhas do app (cliente/lojista)
--   só são LIDAS (soma em voo) e não entram na trava: assim a
--   admin_devolucao_reemitir_reembolso (que trava pedido -> linha 'lojista'
--   recusada) não ganha um ciclo novo com estas funções.
--   Mapa das funções vivas que travam pedido e order_refunds juntos (medido
--   no texto das migrations em 04/10/2026):
--     concluir_estorno ............ linha -> pedido                (referência)
--     registrar_estorno_manual (94) linhas vivas -> pedido -> relê/trava
--                                   linhas vivas nascidas na espera (este
--                                   3o passo é linha DEPOIS do pedido)
--     registrar_contestacao_no_ledger,
--     registrar_estorno_externo_do_mp (esta) linhas sistema -> pedido
--     solicitar_estorno (75) ...... pedido -> INSERT linha        (não trava
--                                   linha existente: sem ciclo)
--     update_order_status_atomic (80), admin_devolucao_concluir (75)
--                                   pedido -> INSERT linha        (idem)
--     admin_devolucao_reemitir_reembolso (75) pedido -> linha FOR UPDATE
--                                   (DIVERGE: pedido antes da linha; a linha
--                                   é a 'lojista' recusada da devolução —
--                                   ciclo só com quem trave essa mesma linha
--                                   antes do pedido, o que nenhuma função
--                                   daqui faz)
--     confirmar_pagamento / registrar_pagamento_recebido (95): só o pedido.
--   Janela residual (aceita, documentada): uma linha do sistema que nasce
--   entre a trava das linhas e a trava do pedido (outra entrega já
--   commitada) não foi travada antes; se uma concluir_estorno dela estiver
--   esperando o pedido enquanto esta função a altera, o Postgres desfaz uma
--   das duas com 40P01 — erro alto, nada gravado pela metade; o webhook
--   devolve 500 e o MP reentrega. O mesmo vale para o 3o passo da 94.
--
-- DADOS EXISTENTES: nada é reescrito. As duas colunas novas nascem NULL em
-- todas as linhas (sem default, sem backfill); a tabela da decisão final nasce
-- VAZIA (casos já decididos antes desta migration não têm registro — para
-- eles vale só o estado das linhas, como antes). Reserva antiga de contestação
-- (sem CBK, de antes da 20261192000000) é ADOTADA pela função na próxima
-- notificação do caso, só quando ela é a única e a order tem um caso só —
-- senão aviso. Linhas concluídas antes NÃO são reabertas.
--
-- PRIVILÉGIOS: as duas funções são SECURITY DEFINER e só a service_role
-- executa (REVOKE de PUBLIC/anon/authenticated + GRANT explícito à
-- service_role) — régua da concluir_estorno (2026110000100).
--
-- IDEMPOTÊNCIA: ADD COLUMN IF NOT EXISTS depois de o preflight provar o
-- tipo; DROP FUNCTION IF EXISTS + CREATE das duas funções novas (não
-- existiam antes desta migration); REVOKE/GRANT reaplicáveis. Reaplicar não
-- muda nada.
--
-- DEPENDE DE: 20261192000000 (coluna mp_chargeback_id e o índice único
-- uq_order_refunds_pedido_contestacao) — o preflight RECUSA sem elas.
--
-- PRÉ-VOO / B1_BASELINE_DIVERGENT — o `DO $preflight_20261196$` abaixo é o
-- PRIMEIRO comando e roda na MESMA transação do restante (recusa = nada
-- gravado).
--
-- ORDEM DE PUBLICAÇÃO: esta migration ANTES da edge `webhook-mercadopago`
-- nova (que chama as duas funções). Edge antiga com a migration no ar: as
-- funções ficam sem chamador, nada muda. Edge nova sem a migration: a
-- chamada falha (500) e o MP reenvia — nada é gravado pela metade.
--
-- COMO APLICAR: pelo workflow `aplicar-migrations.yml`, `migracoes =
-- 20261196000000_a_contestacao_decide_sob_a_trava_do_pedido.sql`. Sem
-- `BEGIN`/`COMMIT` de nível superior (regra da casa: com eles o ROLLBACK da
-- prova vira no-op); o apply é uma transação implícita.
--
-- PROVA VIVA (Postgres efêmero, duas conexões): tests/banco/contestacao-viva.cjs.
--
-- ROLLBACK MANUAL:
-- rollback-manual-20261196000000_a_contestacao_decide_sob_a_trava_do_pedido.sql
-- (apaga as duas funções; as colunas e a tabela da decisão final FICAM —
-- apagá-las perderia o vínculo e o histórico de casos já decididos, e isso é
-- decisão do dono).

DO $preflight_20261196$
DECLARE
  v_tipo text;
  v_def text;
BEGIN
  SELECT format_type(a.atttypid, a.atttypmod)
    INTO v_tipo
    FROM pg_attribute a
   WHERE a.attrelid = 'public.order_refunds'::regclass
     AND a.attname = 'mp_chargeback_id'
     AND NOT a.attisdropped;
  IF v_tipo IS DISTINCT FROM 'text' THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: public.order_refunds.mp_chargeback_id ausente ou com tipo % (esperado text) — aplique a 20261192000000 antes.', v_tipo;
  END IF;

  SELECT pg_get_indexdef(to_regclass('public.uq_order_refunds_pedido_contestacao')) INTO v_def;
  IF v_def IS DISTINCT FROM 'CREATE UNIQUE INDEX uq_order_refunds_pedido_contestacao ON public.order_refunds USING btree (order_id, mp_chargeback_id) WHERE (mp_chargeback_id IS NOT NULL)' THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: public.uq_order_refunds_pedido_contestacao ausente ou com outra definição (%) — aplique a 20261192000000 antes.', v_def;
  END IF;

  SELECT format_type(a.atttypid, a.atttypmod) || CASE WHEN a.attnotnull THEN ' NOT NULL' ELSE '' END
    INTO v_tipo
    FROM pg_attribute a
   WHERE a.attrelid = 'public.order_refunds'::regclass
     AND a.attname = 'mp_chargeback_case_id'
     AND NOT a.attisdropped;
  IF v_tipo IS NOT NULL AND v_tipo IS DISTINCT FROM 'text' THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: public.order_refunds.mp_chargeback_case_id já existe como % (esperado text, aceitando NULL) — revise antes de aplicar.', v_tipo;
  END IF;

  SELECT format_type(a.atttypid, a.atttypmod) || CASE WHEN a.attnotnull THEN ' NOT NULL' ELSE '' END
    INTO v_tipo
    FROM pg_attribute a
   WHERE a.attrelid = 'public.order_refunds'::regclass
     AND a.attname = 'mp_chargeback_valor_do_caso'
     AND NOT a.attisdropped;
  IF v_tipo IS NOT NULL AND v_tipo IS DISTINCT FROM 'numeric(12,2)' THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: public.order_refunds.mp_chargeback_valor_do_caso já existe como % (esperado numeric(12,2), aceitando NULL) — revise antes de aplicar.', v_tipo;
  END IF;

  IF to_regclass('public.contestacoes_decisao_final') IS NOT NULL THEN
    SELECT string_agg(a.attname || ' ' || format_type(a.atttypid, a.atttypmod)
                      || CASE WHEN a.attnotnull THEN ' NOT NULL' ELSE '' END, ', ' ORDER BY a.attnum)
      INTO v_tipo
      FROM pg_attribute a
     WHERE a.attrelid = 'public.contestacoes_decisao_final'::regclass
       AND a.attnum > 0 AND NOT a.attisdropped;
    IF v_tipo IS DISTINCT FROM 'order_id uuid NOT NULL, mp_chargeback_id text NOT NULL, mp_chargeback_case_id text NOT NULL, decisao text NOT NULL, valor_do_caso numeric(12,2), origem text NOT NULL, decidido_em timestamp with time zone NOT NULL' THEN
      RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: public.contestacoes_decisao_final já existe com outra forma (%) — revise antes de aplicar.', v_tipo;
    END IF;
  END IF;
END $preflight_20261196$;

ALTER TABLE public.order_refunds
  ADD COLUMN IF NOT EXISTS mp_chargeback_case_id text;

COMMENT ON COLUMN public.order_refunds.mp_chargeback_case_id IS
  'case_id do Mercado Pago ligado ao CBK da linha (transactions.chargebacks[].case_id; '
  '20261196000000). Gravado por registrar_contestacao_no_ledger; o mesmo CBK chegando '
  'com outro case_id é divergência (nada muda, aviso). NULL nas demais linhas.';

ALTER TABLE public.order_refunds
  ADD COLUMN IF NOT EXISTS mp_chargeback_valor_do_caso numeric(12,2)
    CHECK (mp_chargeback_valor_do_caso IS NULL OR mp_chargeback_valor_do_caso > 0);

COMMENT ON COLUMN public.order_refunds.mp_chargeback_valor_do_caso IS
  'Valor do CASO da contestação em reais, confirmado pelo Mercado Pago (GET '
  '/v1/chargebacks/{case_id}, currency BRL; 20261196000000). NULL = a linha nasceu de '
  'ESTIMATIVA (total pago) e só pode RESERVAR, nunca concluir.';

CREATE TABLE IF NOT EXISTS public.contestacoes_decisao_final (
  order_id uuid NOT NULL REFERENCES public.marketplace_orders(id),
  mp_chargeback_id text NOT NULL,
  mp_chargeback_case_id text NOT NULL,
  decisao text NOT NULL CHECK (decisao IN ('a_favor_da_loja', 'contra_a_loja')),
  valor_do_caso numeric(12,2) CHECK (valor_do_caso IS NULL OR valor_do_caso > 0),
  origem text NOT NULL,
  decidido_em timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (order_id, mp_chargeback_id)
);

COMMENT ON TABLE public.contestacoes_decisao_final IS
  'Decisão FINAL de cada contestação (chargeback) do Mercado Pago, por pedido e CBK, com '
  'case_id, valor do caso e procedência (20261196000000). Gravada por '
  'registrar_contestacao_no_ledger mesmo quando não há reserva — impede que uma notificação '
  'PENDENTE atrasada reserve depois da decisão final. Nunca reescrita nem apagada. Fora do '
  'alcance do cliente (RLS sem política; só a função SECURITY DEFINER lê e escreve).';

ALTER TABLE public.contestacoes_decisao_final ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.contestacoes_decisao_final FROM PUBLIC, anon, authenticated;

DROP FUNCTION IF EXISTS public.registrar_contestacao_no_ledger(uuid, text, text, text, numeric, numeric, integer);

CREATE OR REPLACE FUNCTION public.registrar_contestacao_no_ledger(
  p_order_id uuid,
  p_mp_chargeback_id text,
  p_case_id text,
  p_decisao text,
  p_valor_caso numeric,
  p_valor_estimado numeric,
  p_casos_na_order integer
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_total numeric(12,2);
  v_estornado numeric(12,2);
  v_payment_status text;
  v_linha public.order_refunds%ROWTYPE;
  v_tem_linha boolean := false;
  v_legado integer;
  v_em_voo_outras numeric(12,2);
  v_disponivel numeric(12,2);
  v_base numeric(12,2);
  v_amount numeric(12,2);
  v_resultado text;
  v_aviso text := NULL;
  v_em_voo numeric(12,2);
  v_linha_id uuid;
  v_linha_amount numeric(12,2);
  v_linha_status text;
  v_final public.contestacoes_decisao_final%ROWTYPE;
  v_tem_final boolean := false;
BEGIN
  -- Entrada é contrato com o webhook (que já validou): violar é erro de
  -- PROGRAMAÇÃO, falha alto (500, o MP reenvia) — nunca um palpite.
  IF p_order_id IS NULL OR p_mp_chargeback_id IS NULL OR btrim(p_mp_chargeback_id) = ''
     OR p_case_id IS NULL OR btrim(p_case_id) = '' THEN
    RAISE EXCEPTION 'contestacao_entrada_invalida: pedido, CBK e case_id são obrigatórios.';
  END IF;
  IF p_decisao IS NULL OR p_decisao NOT IN ('em_analise', 'contra_a_loja', 'a_favor_da_loja') THEN
    RAISE EXCEPTION 'contestacao_entrada_invalida: decisão % fora do vocabulário.', p_decisao;
  END IF;
  IF (p_valor_caso IS NOT NULL AND p_valor_caso <= 0)
     OR (p_valor_estimado IS NOT NULL AND p_valor_estimado <= 0) THEN
    RAISE EXCEPTION 'contestacao_entrada_invalida: valor não positivo.';
  END IF;
  IF p_casos_na_order IS NULL OR p_casos_na_order < 1 THEN
    RAISE EXCEPTION 'contestacao_entrada_invalida: casos na order tem de ser >= 1.';
  END IF;

  -- ORDEM GLOBAL (cabeçalho): primeiro as LINHAS do sistema deste pedido, em
  -- ordem de id — as únicas que esta função altera ou conclui —, depois o
  -- PEDIDO. É a ordem da concluir_estorno (linha -> pedido) e da
  -- registrar_estorno_manual; pedido primeiro dava deadlock com as duas.
  PERFORM 1
     FROM public.order_refunds linha_do_sistema
    WHERE linha_do_sistema.order_id = p_order_id
      AND linha_do_sistema.solicitado_por = 'sistema'
    ORDER BY linha_do_sistema.id
      FOR UPDATE OF linha_do_sistema;

  -- A TRAVA: tudo abaixo vê o pedido e o ledger depois de qualquer outra
  -- entrega (ou solicitar_estorno) que segurava o mesmo pedido.
  SELECT total, COALESCE(valor_estornado, 0), payment_status
    INTO v_total, v_estornado, v_payment_status
    FROM public.marketplace_orders
   WHERE id = p_order_id
     FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('resultado', 'pedido_inexistente', 'aviso', NULL);
  END IF;

  <<decidir>>
  BEGIN
    IF v_payment_status IS NULL OR v_payment_status NOT IN ('pago', 'pago_apos_expirar', 'estornado') THEN
      v_resultado := 'pedido_nao_pago';
      v_aviso := 'conferir';
      EXIT decidir;
    END IF;

    -- A decisão FINAL já gravada para este caso manda sobre notificação
    -- atrasada (o MP entrega fora de ordem): pendente depois dela não
    -- reserva; final no sentido OPOSTO é virada (aviso, nada mexido).
    SELECT * INTO v_final
      FROM public.contestacoes_decisao_final
     WHERE order_id = p_order_id AND mp_chargeback_id = p_mp_chargeback_id;
    v_tem_final := FOUND;
    IF v_tem_final THEN
      IF v_final.mp_chargeback_case_id <> p_case_id THEN
        v_resultado := 'vinculo_divergente';
        v_aviso := 'conferir';
        EXIT decidir;
      END IF;
      IF p_decisao = 'em_analise' THEN
        v_resultado := 'ja_decidido';
        EXIT decidir;
      END IF;
      IF p_decisao <> v_final.decisao THEN
        v_resultado := 'revertido';
        v_aviso := 'revertida';
        EXIT decidir;
      END IF;
    END IF;

    SELECT * INTO v_linha
      FROM public.order_refunds
     WHERE order_id = p_order_id AND mp_chargeback_id = p_mp_chargeback_id
       FOR UPDATE;
    v_tem_linha := FOUND;

    IF NOT v_tem_linha THEN
      -- Reserva ANTIGA (nascida sem CBK, antes da 20261192000000): adotada
      -- só se for a única e a order tiver um caso só.
      SELECT count(*) INTO v_legado
        FROM public.order_refunds
       WHERE order_id = p_order_id AND solicitado_por = 'sistema'
         AND mp_status = 'charged_back' AND status = 'em_processamento'
         AND mp_chargeback_id IS NULL;
      IF v_legado > 0 THEN
        IF v_legado > 1 OR p_casos_na_order > 1 THEN
          v_resultado := 'legado_ambiguo';
          v_aviso := 'conferir';
          EXIT decidir;
        END IF;
        UPDATE public.order_refunds
           SET mp_chargeback_id = p_mp_chargeback_id, updated_at = now()
         WHERE order_id = p_order_id AND solicitado_por = 'sistema'
           AND mp_status = 'charged_back' AND status = 'em_processamento'
           AND mp_chargeback_id IS NULL
        RETURNING * INTO v_linha;
        v_tem_linha := FOUND;
      END IF;
    END IF;

    IF v_tem_linha THEN
      IF v_linha.mp_chargeback_case_id IS NOT NULL AND v_linha.mp_chargeback_case_id <> p_case_id THEN
        v_resultado := 'vinculo_divergente';
        v_aviso := 'conferir';
        EXIT decidir;
      END IF;
      IF v_linha.mp_chargeback_valor_do_caso IS NOT NULL AND p_valor_caso IS NOT NULL
         AND v_linha.mp_chargeback_valor_do_caso <> p_valor_caso THEN
        v_resultado := 'valor_divergente';
        v_aviso := 'conferir';
        EXIT decidir;
      END IF;
      IF v_linha.mp_chargeback_case_id IS NULL THEN
        UPDATE public.order_refunds
           SET mp_chargeback_case_id = p_case_id, updated_at = now()
         WHERE id = v_linha.id
        RETURNING * INTO v_linha;
      END IF;
    END IF;

    -- Saldo contra o estado RELIDO sob a trava; a própria linha não compete.
    SELECT COALESCE(sum(amount), 0) INTO v_em_voo_outras
      FROM public.order_refunds
     WHERE order_id = p_order_id
       AND status IN ('solicitado', 'em_processamento')
       AND (NOT v_tem_linha OR id <> v_linha.id);
    v_disponivel := v_total - v_estornado - v_em_voo_outras;

    IF p_decisao = 'em_analise' THEN
      IF v_tem_linha THEN
        IF v_linha.status <> 'em_processamento' THEN
          v_resultado := 'ja_decidido';
          EXIT decidir;
        END IF;
        IF p_valor_caso IS NULL OR (p_valor_caso = v_linha.amount AND v_linha.mp_chargeback_valor_do_caso IS NOT NULL) THEN
          v_resultado := 'ja_reservado';
          EXIT decidir;
        END IF;
        -- Valor do caso confirmado: desce até ele; sobe só até o disponível.
        v_amount := CASE
          WHEN p_valor_caso <= v_linha.amount THEN p_valor_caso
          ELSE LEAST(p_valor_caso, GREATEST(v_disponivel, v_linha.amount))
        END;
        UPDATE public.order_refunds
           SET amount = v_amount,
               mp_chargeback_valor_do_caso = p_valor_caso,
               motivo = 'contestação (chargeback) em análise no Mercado Pago',
               updated_at = now()
         WHERE id = v_linha.id
        RETURNING * INTO v_linha;
        v_resultado := 'reserva_ajustada';
        IF v_amount < p_valor_caso THEN v_aviso := 'saldo'; END IF;
        EXIT decidir;
      END IF;

      v_base := COALESCE(p_valor_caso, p_valor_estimado);
      IF v_base IS NULL THEN
        v_resultado := 'sem_valor';
        v_aviso := 'conferir';
        EXIT decidir;
      END IF;
      IF v_disponivel <= 0 THEN
        v_resultado := 'sem_saldo';
        v_aviso := 'saldo';
        EXIT decidir;
      END IF;
      v_amount := LEAST(v_base, v_disponivel);
      INSERT INTO public.order_refunds
        (order_id, amount, solicitado_por, status, motivo, mp_status, mp_status_detail,
         mp_chargeback_id, mp_chargeback_case_id, mp_chargeback_valor_do_caso)
      VALUES
        (p_order_id, v_amount, 'sistema', 'em_processamento',
         'contestação (chargeback) em análise no Mercado Pago'
           || CASE WHEN p_valor_caso IS NULL
                   THEN ' — valor ESTIMADO pelo total pago (o caso do Mercado Pago não informou o valor em reais)'
                   ELSE '' END,
         'charged_back', 'in_process', p_mp_chargeback_id, p_case_id, p_valor_caso)
      RETURNING * INTO v_linha;
      v_tem_linha := true;
      v_resultado := 'reservado';
      IF v_amount < v_base THEN v_aviso := 'saldo'; END IF;
      EXIT decidir;
    END IF;

    IF p_decisao = 'contra_a_loja' THEN
      IF v_tem_linha THEN
        IF v_linha.status = 'recusado' THEN
          v_resultado := 'revertido';
          v_aviso := 'revertida';
          EXIT decidir;
        END IF;
        IF v_linha.status = 'concluido' AND v_linha.concluido_em IS NOT NULL THEN
          v_resultado := 'ja_concluido';
          EXIT decidir;
        END IF;
        IF v_linha.status NOT IN ('em_processamento', 'concluido') THEN
          v_resultado := 'status_inesperado';
          v_aviso := 'conferir';
          EXIT decidir;
        END IF;
      END IF;

      -- Bloqueio 1: sem o valor do CASO confirmado, nada se conclui.
      IF p_valor_caso IS NULL THEN
        IF v_tem_linha THEN
          v_resultado := 'conservado_sem_valor_do_caso';
          v_aviso := 'conferir';
          EXIT decidir;
        END IF;
        IF p_valor_estimado IS NULL THEN
          v_resultado := 'sem_valor';
          v_aviso := 'conferir';
          EXIT decidir;
        END IF;
        IF v_disponivel <= 0 THEN
          v_resultado := 'sem_saldo';
          v_aviso := 'saldo';
          EXIT decidir;
        END IF;
        INSERT INTO public.order_refunds
          (order_id, amount, solicitado_por, status, motivo, mp_status, mp_status_detail,
           mp_chargeback_id, mp_chargeback_case_id, mp_chargeback_valor_do_caso)
        VALUES
          (p_order_id, LEAST(p_valor_estimado, v_disponivel), 'sistema', 'em_processamento',
           'contestação (chargeback) decidida contra a loja, valor ainda não confirmado — reserva ESTIMADA pelo total pago',
           'charged_back', 'settled', p_mp_chargeback_id, p_case_id, NULL)
        RETURNING * INTO v_linha;
        v_tem_linha := true;
        v_resultado := 'reservado_sem_valor_do_caso';
        v_aviso := 'conferir';
        EXIT decidir;
      END IF;

      -- Valor do caso confirmado: conclui EXATAMENTE ele, se couber.
      IF p_valor_caso > v_disponivel THEN
        IF NOT v_tem_linha AND v_disponivel > 0 THEN
          -- Não cabe (sobreposição com outra devolução): bloqueia o que
          -- sobra como reserva, sem concluir; o admin reconcilia.
          INSERT INTO public.order_refunds
            (order_id, amount, solicitado_por, status, motivo, mp_status, mp_status_detail,
             mp_chargeback_id, mp_chargeback_case_id, mp_chargeback_valor_do_caso)
          VALUES
            (p_order_id, v_disponivel, 'sistema', 'em_processamento',
             'contestação (chargeback) decidida contra a loja maior que o saldo do pedido — reserva o que sobra até a conferência',
             'charged_back', 'settled', p_mp_chargeback_id, p_case_id, p_valor_caso)
          RETURNING * INTO v_linha;
          v_tem_linha := true;
        END IF;
        v_resultado := 'saldo_incoerente';
        v_aviso := 'saldo';
        EXIT decidir;
      END IF;

      IF v_tem_linha THEN
        UPDATE public.order_refunds
           SET amount = p_valor_caso,
               mp_chargeback_valor_do_caso = p_valor_caso,
               mp_status_detail = 'settled',
               motivo = 'contestação (chargeback) decidida a favor do comprador no Mercado Pago',
               updated_at = now()
         WHERE id = v_linha.id
        RETURNING * INTO v_linha;
      ELSE
        INSERT INTO public.order_refunds
          (order_id, amount, solicitado_por, status, motivo, mp_status, mp_status_detail,
           mp_chargeback_id, mp_chargeback_case_id, mp_chargeback_valor_do_caso)
        VALUES
          (p_order_id, p_valor_caso, 'sistema', 'concluido',
           'contestação (chargeback) decidida a favor do comprador no Mercado Pago',
           'charged_back', 'settled', p_mp_chargeback_id, p_case_id, p_valor_caso)
        RETURNING * INTO v_linha;
        v_tem_linha := true;
      END IF;
      -- A soma passa pelo ÚNICO ponto que soma (2026110000100), na MESMA
      -- transação e com o pedido já travado por esta função.
      PERFORM public.concluir_estorno(v_linha.id, NULL, 'charged_back', 'settled');
      v_resultado := 'concluido';
      EXIT decidir;
    END IF;

    -- a_favor_da_loja
    IF NOT v_tem_linha THEN
      v_resultado := 'nada_a_liberar';
      EXIT decidir;
    END IF;
    IF v_linha.status = 'em_processamento' THEN
      UPDATE public.order_refunds
         SET status = 'recusado',
             mp_status_detail = 'reimbursed',
             ultimo_erro = 'o Mercado Pago decidiu a contestação a favor da loja: o valor foi creditado a você',
             updated_at = now()
       WHERE id = v_linha.id
      RETURNING * INTO v_linha;
      v_resultado := 'liberado';
    ELSIF v_linha.status = 'concluido' THEN
      v_resultado := 'revertido';
      v_aviso := 'revertida';
    ELSIF v_linha.status = 'recusado' THEN
      v_resultado := 'ja_liberado';
    ELSE
      v_resultado := 'status_inesperado';
      v_aviso := 'conferir';
    END IF;
  END decidir;

  -- Decisão FINAL registrada (com procedência) sempre que foi ACEITA — com
  -- ou sem linha. Recusas por identidade/estado não gravam: nada foi
  -- decidido sobre elas. Uma linha por caso; nunca reescrita.
  IF p_decisao IN ('a_favor_da_loja', 'contra_a_loja')
     AND v_resultado NOT IN ('pedido_nao_pago', 'legado_ambiguo', 'vinculo_divergente',
                             'valor_divergente', 'status_inesperado', 'revertido') THEN
    INSERT INTO public.contestacoes_decisao_final
      (order_id, mp_chargeback_id, mp_chargeback_case_id, decisao, valor_do_caso, origem)
    VALUES
      (p_order_id, p_mp_chargeback_id, p_case_id, p_decisao, p_valor_caso,
       'webhook-mercadopago: GET /v1/chargebacks/{case_id} coverage_applied, corroborado pelo pagamento contestado')
    ON CONFLICT (order_id, mp_chargeback_id) DO NOTHING;
  END IF;

  -- Estado CANÔNICO depois desta decisão (bloqueio 3: quem chama nunca
  -- decide o próximo caso com um retrato velho).
  SELECT COALESCE(valor_estornado, 0), payment_status
    INTO v_estornado, v_payment_status
    FROM public.marketplace_orders WHERE id = p_order_id;
  SELECT COALESCE(sum(amount), 0) INTO v_em_voo
    FROM public.order_refunds
   WHERE order_id = p_order_id AND status IN ('solicitado', 'em_processamento');
  IF v_tem_linha THEN
    SELECT id, amount, status INTO v_linha_id, v_linha_amount, v_linha_status
      FROM public.order_refunds WHERE id = v_linha.id;
  END IF;

  RETURN jsonb_build_object(
    'resultado', v_resultado,
    'aviso', v_aviso,
    'linha_id', v_linha_id,
    'linha_amount', v_linha_amount,
    'linha_status', v_linha_status,
    'valor_estornado', v_estornado,
    'em_voo', v_em_voo,
    'disponivel', v_total - v_estornado - v_em_voo,
    'payment_status', v_payment_status
  );
END;
$fn$;

COMMENT ON FUNCTION public.registrar_contestacao_no_ledger(uuid, text, text, text, numeric, numeric, integer) IS
  'Contestação (chargeback) do Mercado Pago no ledger, com as linhas do sistema e depois o '
  'pedido TRAVADOS (FOR UPDATE, ordem linha -> pedido da concluir_estorno): '
  'reserva, adota linha antiga, ajusta, conclui (só com o valor do CASO em BRL e só se couber '
  'no saldo) e libera, numa transação; devolve o estado canônico. Estimativa só reserva. '
  'Só a service_role executa (webhook-mercadopago). 20261196000000.';

REVOKE ALL ON FUNCTION public.registrar_contestacao_no_ledger(uuid, text, text, text, numeric, numeric, integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.registrar_contestacao_no_ledger(uuid, text, text, text, numeric, numeric, integer)
  TO service_role;

DROP FUNCTION IF EXISTS public.registrar_estorno_externo_do_mp(uuid, text, numeric, text, text);

CREATE OR REPLACE FUNCTION public.registrar_estorno_externo_do_mp(
  p_order_id uuid,
  p_mp_refund_id text,
  p_valor numeric,
  p_mp_status text,
  p_mp_status_detail text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_total numeric(12,2);
  v_estornado numeric(12,2);
  v_payment_status text;
  v_existente public.order_refunds%ROWTYPE;
  v_em_voo numeric(12,2);
  v_disponivel numeric(12,2);
  v_id uuid;
  v_resultado text;
  v_aviso text := NULL;
BEGIN
  IF p_order_id IS NULL OR p_mp_refund_id IS NULL OR btrim(p_mp_refund_id) = '' THEN
    RAISE EXCEPTION 'estorno_externo_entrada_invalida: pedido e id do refund são obrigatórios.';
  END IF;
  IF p_valor IS NULL OR p_valor <= 0 THEN
    RAISE EXCEPTION 'estorno_externo_entrada_invalida: valor não positivo.';
  END IF;

  -- ORDEM GLOBAL (cabeçalho): LINHAS antes do PEDIDO — as do sistema (esta
  -- função conclui a órfã) e a que já carrega este refund (relida abaixo).
  PERFORM 1
     FROM public.order_refunds linha_tocada
    WHERE linha_tocada.order_id = p_order_id
      AND (linha_tocada.solicitado_por = 'sistema' OR linha_tocada.mp_refund_id = p_mp_refund_id)
    ORDER BY linha_tocada.id
      FOR UPDATE OF linha_tocada;

  SELECT total, COALESCE(valor_estornado, 0), payment_status
    INTO v_total, v_estornado, v_payment_status
    FROM public.marketplace_orders
   WHERE id = p_order_id
     FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('resultado', 'pedido_inexistente', 'aviso', NULL);
  END IF;

  <<decidir>>
  BEGIN
    SELECT * INTO v_existente
      FROM public.order_refunds
     WHERE order_id = p_order_id AND mp_refund_id = p_mp_refund_id
       FOR UPDATE;
    IF FOUND THEN
      -- Já é de uma linha (do app ou de outra entrega): um refund credita UMA
      -- linha. Linha sistema órfã da janela de falha: conclui ela.
      IF v_existente.solicitado_por = 'sistema' AND v_existente.status = 'concluido'
         AND v_existente.concluido_em IS NULL THEN
        PERFORM public.concluir_estorno(v_existente.id, NULL, NULL, NULL);
      END IF;
      v_resultado := 'ja_registrado';
      EXIT decidir;
    END IF;

    -- Dinheiro REAL: o que já saiu (valor_estornado) e a reserva de
    -- contestação em voo (linhas 'sistema' — o valor que o MP segura na
    -- disputa). A linha do APP ainda sem confirmação do MP é intenção: não
    -- reduz um refund que o MP já processou (o executor dela recusa sozinho
    -- quando o saldo acabar, antes de qualquer POST).
    SELECT COALESCE(sum(amount), 0) INTO v_em_voo
      FROM public.order_refunds
     WHERE order_id = p_order_id AND status IN ('solicitado', 'em_processamento')
       AND solicitado_por = 'sistema';
    v_disponivel := v_total - v_estornado - v_em_voo;
    IF p_valor > v_disponivel THEN
      -- O MP diz que devolveu mais do que o ledger explica (sobreposição com
      -- a contestação, ou ledger divergente): não registra, não recorta, não
      -- consome a identidade — o admin reconcilia.
      v_resultado := 'nao_cabe';
      v_aviso := 'saldo';
      EXIT decidir;
    END IF;

    INSERT INTO public.order_refunds
      (order_id, amount, solicitado_por, status, motivo, mp_refund_id, mp_status, mp_status_detail)
    VALUES
      (p_order_id, p_valor, 'sistema', 'concluido', 'estorno feito fora do app (Mercado Pago)',
       p_mp_refund_id, p_mp_status, p_mp_status_detail)
    RETURNING id INTO v_id;
    PERFORM public.concluir_estorno(v_id, p_mp_refund_id, p_mp_status, p_mp_status_detail);
    v_resultado := 'inserido';
  END decidir;

  SELECT COALESCE(valor_estornado, 0), payment_status
    INTO v_estornado, v_payment_status
    FROM public.marketplace_orders WHERE id = p_order_id;
  SELECT COALESCE(sum(amount), 0) INTO v_em_voo
    FROM public.order_refunds
   WHERE order_id = p_order_id AND status IN ('solicitado', 'em_processamento');

  RETURN jsonb_build_object(
    'resultado', v_resultado,
    'aviso', v_aviso,
    'valor_estornado', v_estornado,
    'em_voo', v_em_voo,
    'disponivel', v_total - v_estornado - v_em_voo,
    'payment_status', v_payment_status
  );
END;
$fn$;

COMMENT ON FUNCTION public.registrar_estorno_externo_do_mp(uuid, text, numeric, text, text) IS
  'Refund do Mercado Pago que nenhuma linha reivindicou (feito no painel, ou regular numa '
  'order contestada), com as linhas tocadas e depois o pedido TRAVADOS (linha -> pedido): '
  'entra inteiro e concluído se couber no dinheiro '
  'real (total - estornado - reserva de contestação em voo; a linha do app sem confirmação não '
  'reduz); senão não entra nem consome a identidade (nao_cabe, aviso) — nunca recorta. Um refund '
  'credita uma linha. Só a service_role. 20261196000000.';

REVOKE ALL ON FUNCTION public.registrar_estorno_externo_do_mp(uuid, text, numeric, text, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.registrar_estorno_externo_do_mp(uuid, text, numeric, text, text)
  TO service_role;
