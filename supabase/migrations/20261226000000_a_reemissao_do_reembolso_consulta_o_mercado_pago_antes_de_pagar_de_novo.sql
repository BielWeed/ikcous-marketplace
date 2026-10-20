-- ============================================================================
-- Migration 20261226000000 — a reemissão do reembolso consulta o Mercado Pago antes de pagar de novo
-- (dinheiro; decisão do dono, Gabriel, 14/10/2026: "aprovo, pode consertar o reembolso")
-- ============================================================================
--
-- 1. O QUE ESTA MIGRATION CORRIGE
--
-- Quando o Mercado Pago (MP) recusa de vez o reembolso de uma devolução, a linha de
-- `order_refunds` vira `falhou`. Hoje o lojista não tem saída: `solicitar_estorno` recusa
-- ("cancele o pedido antes") e `admin_devolucao_reemitir_reembolso` só aceita `recusado`.
-- Aceitar `falhou` sem cuidado paga DUAS vezes: uma linha vira `falhou` mesmo quando o
-- dinheiro dela saiu (POST que estourou o tempo mas o MP processou; devolução feita pelo
-- painel do MP). Esta migration entrega a reemissão SEGURA, só pelo servidor:
--
--   (a) `order_refund_diagnostico` — o POR QUÊ de a linha ter falhado (código do MP, carimbo
--       de "o POST pode ter chegado ao MP", contador de falhas transitórias). Tabela SEPARADA
--       e só do servidor, de propósito: a cliente lê a linha inteira de `order_refunds`
--       (RLS `order_refunds_cliente_le`), e um motivo interno ("sem saldo na conta do
--       lojista") nunca pode ir numa coluna que ela lê.
--   (b) `registrar_diagnostico_do_estorno(...)` — grava/atualiza essa linha, atômica (um
--       UPSERT com incremento: duas conexões não perdem contagem). Só servidor.
--   (c) `reemitir_reembolso_da_devolucao(devolução, ator, linha esperada, consulta)` — UMA
--       função que ou ADOTA o reembolso que o MP já fez ("ja_existia": marca a linha paga) ou
--       CRIA a tentativa nova ("reemitido"), nunca as duas, sob as travas. Só servidor.
--   (d) `admin_devolucao_reembolso_por_fora(devolução, linha esperada)` — "Já devolvi por
--       fora" como função PRÓPRIA do lojista logado (não move dinheiro no MP; aceita `falhou`
--       e `recusado`; não exige pedido entregue; avisa a cliente).
--
-- 2. A REGRA (o que decide criar, adotar ou parar)
--
-- A consulta ao MP é feita pela edge ANTES (tri-estado: `achou` / `nao_achou` / indeterminado;
-- indeterminado nem chega aqui). Esta função confere o estado da linha SOB TRAVA:
--   * linha `recusado` (nenhum POST saiu) OU `falhou` em que o MP PROVOU que nada saiu
--     (código `insufficient_money_for_refund` ou `order_payment_not_yet_enabled_for_refund`,
--     sem carimbo de incerteza, sem id do MP):
--         consulta `nao_achou` -> cria tentativa nova (linha `solicitado`);
--         consulta `achou`     -> `indeterminado` (há reembolso do pedido sem dono: não cria,
--                                 não adota — nunca se adota para linha que nunca teve POST).
--   * qualquer outra `falhou` (sem diagnóstico = legado, com carimbo, código fora da lista,
--     `confirmacao_insuficiente`, `http_*`): o POST pode ter chegado ao MP.
--         consulta `achou`     -> ADOTA (conclui a linha pelo `concluir_estorno`, que soma o
--                                 pedido e dispara o aviso "liberado" 1 vez);
--         consulta `nao_achou` -> `use_por_fora` (nunca ganha chave nova sem prova).
--   * Antes de CRIAR: o pedido tem de ser elegível ao MP (entregue, pago pelo app, <= 180
--     dias), NÃO pode haver devolução do MP registrada depois da conclusão desta devolução
--     (linha `sistema` concluída, sem contestação: o lojista devolveu pelo painel do MP ->
--     `use_por_fora`) e o saldo (a MESMA função `pedido__saldo_a_estornar`, fonte única)
--     tem de cobrir o valor (senão `sem_saldo_para_reemitir`).
--   * Antes de ADOTAR: valor do reembolso achado = valor da linha, o id do MP não pode ser
--     de outra linha do pedido e nenhuma outra linha pendente do MESMO valor pode estar sem
--     id (duas devoluções de R$ 50: o reembolso achado pode ser da outra -> `indeterminado`).
--   * Duplo clique / dois lojistas: a trava da devolução enfileira; quem chega depois com a
--     linha esperada velha recebe `reembolso_mudou`. Linha em andamento = `em_andamento`;
--     linha já paga = `ja_concluido`.
--
-- 3. DADOS EXISTENTES
--
-- Nenhuma linha de `devolucoes`, `order_refunds`, `marketplace_orders` ou `notificacoes`
-- muda no apply: só nascem uma tabela vazia e três funções. Linhas `falhou` que já existem
-- NÃO têm diagnóstico (a tabela nasce vazia): são tratadas como INCERTAS e só podem ser
-- adotadas (o MP já pagou) ou resolvidas "por fora" — nunca recebem chave nova. É o lado
-- seguro: o custo é o lojista resolver à mão, nunca a cliente receber duas vezes.
--
-- 4. QUEM QUEBRA
--
-- Ninguém: nenhuma assinatura existente muda e nenhum corpo existente é reescrito
-- (`admin_devolucao_reemitir_reembolso`, `solicitar_estorno` e `concluir_estorno` ficam como
-- estão). A função antiga continua aceitando `recusado`; fechá-la é migration própria,
-- depois de a tela passar a usar a edge.
--
-- 5. PRÉ-VOO (B1_BASELINE_DIVERGENT, ANTES de qualquer escrita)
--
-- Recusa se: faltar tabela/coluna que as funções leem; as funções que esta migration CHAMA
-- (`concluir_estorno`, `pedido__saldo_a_estornar`, `devolucao__registrar_evento`,
-- `devolucao__avisar_reembolso` da 20261225, `is_admin`, `is_admin_atual`) não existirem ou
-- tiverem corpo diferente do conhecido; uma das funções novas existir com corpo diferente
-- (ou com sobrecarga); a tabela nova existir com colunas diferentes.
--
-- 6. IDEMPOTÊNCIA E TRANSAÇÃO
--
-- `CREATE TABLE IF NOT EXISTS`, `CREATE OR REPLACE FUNCTION`: reaplicar deixa o MESMO estado
-- (e a tabela, com os dados que tiver). Qualquer estado de entrada fora dos conhecidos
-- ABORTA. Sem BEGIN/COMMIT de nível superior (regra da casa): pré-voo, criações e conferência
-- final caem juntos ou não caem.
--
-- 7. ROLLBACK MANUAL
--
-- rollback-manual-20261226000000_...sql apaga as três funções e a tabela (a tabela só tem
-- diagnóstico: apagá-la volta toda linha `falhou` a "sem diagnóstico" = incerta, o lado
-- seguro).
--
-- PROVA VIVA: tests/banco/reemissao-do-reembolso-viva.cjs e
-- tests/banco/reemissao-do-reembolso-portao-viva.cjs (consultas 29a e 29b).
-- ============================================================================

DO $preflight_20261226$
DECLARE
  v_fn text;
  v_hash text;
  v_esperado text;
BEGIN
  IF to_regclass('public.devolucoes') IS NULL
     OR to_regclass('public.order_refunds') IS NULL
     OR to_regclass('public.marketplace_orders') IS NULL
     OR to_regclass('auth.users') IS NULL
     OR to_regclass('public.profiles') IS NULL THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: falta devolucoes/order_refunds/marketplace_orders/auth.users/profiles — aplique as migrations anteriores antes da 20261226000000.';
  END IF;
  IF (SELECT count(*) FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'devolucoes'
         AND column_name IN ('id', 'protocolo', 'order_id', 'user_id', 'status', 'resolucao_final',
                             'refund_id', 'reembolso_manual', 'valor_reembolso', 'concluida_em', 'updated_at')) <> 11
     OR (SELECT count(*) FROM information_schema.columns
          WHERE table_schema = 'public' AND table_name = 'order_refunds'
            AND column_name IN ('id', 'order_id', 'amount', 'status', 'mp_refund_id', 'solicitado_por',
                                'motivo', 'mp_chargeback_id', 'post_autorizado_em', 'concluido_em', 'created_at')) <> 11
     OR (SELECT count(*) FROM information_schema.columns
          WHERE table_schema = 'public' AND table_name = 'marketplace_orders'
            AND column_name IN ('id', 'status', 'payment_status', 'payment_method', 'gateway_payment_id',
                                'paid_at', 'total', 'valor_estornado')) <> 8 THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: falta alguma coluna que as funções desta migration leem — meça a loja e revise antes de aplicar.';
  END IF;

  -- As funções que esta migration CHAMA: existem, sem sobrecarga, com o corpo conhecido.
  FOR v_fn, v_esperado IN
    VALUES ('concluir_estorno', '662daf0dfc065a820231e9d30f4f6275'),
           ('pedido__saldo_a_estornar', '9579d2b56b57cf948659936a928dd7dc'),
           ('devolucao__avisar_reembolso', '769267b826e4629b91da056c28b393da')
  LOOP
    IF (SELECT count(*) FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname = v_fn) <> 1 THEN
      RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: % ausente ou com sobrecarga em public — aplique as migrations anteriores (20261225 para a auxiliar de aviso) antes da 20261226000000.', v_fn;
    END IF;
    SELECT md5(replace(p.prosrc, E'\r', '')) INTO v_hash
      FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname = v_fn;
    IF v_hash IS DISTINCT FROM v_esperado THEN
      RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: corpo vivo de % (hash %) não é o conhecido — capture o corpo vivo e revise antes de aplicar.', v_fn, v_hash;
    END IF;
  END LOOP;
  IF to_regprocedure('public.devolucao__registrar_evento(uuid,text,text,text,text)') IS NULL
     OR to_regprocedure('public.is_admin()') IS NULL
     OR to_regprocedure('public.is_admin_atual()') IS NULL
     OR to_regprocedure('public.concluir_estorno(uuid,text,text,text)') IS NULL
     OR to_regprocedure('public.pedido__saldo_a_estornar(uuid)') IS NULL
     OR to_regprocedure('public.devolucao__avisar_reembolso(uuid,text,text,text,text)') IS NULL THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: falta uma função que esta migration chama (devolucao__registrar_evento, is_admin, is_admin_atual, concluir_estorno, pedido__saldo_a_estornar ou devolucao__avisar_reembolso) com a assinatura conhecida.';
  END IF;

  -- As três funções novas: ausentes, ou já com o corpo desta migration (reaplicação). Sem sobrecarga.
  FOR v_fn, v_esperado IN
    VALUES ('registrar_diagnostico_do_estorno', 'b8e4e28fbcd23a32dac0d18823b8aefe'),
           ('reemitir_reembolso_da_devolucao', '872fcb1d2bac9816e2d2b1c7c2e868c0'),
           ('admin_devolucao_reembolso_por_fora', '0a7e06d7004c3fb70897e87c4dfa8cf9')
  LOOP
    IF (SELECT count(*) FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname = v_fn) > 1 THEN
      RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: % tem sobrecarga em public — meça a loja e revise antes de aplicar.', v_fn;
    END IF;
    IF EXISTS (SELECT 1 FROM pg_proc p
                WHERE p.pronamespace = 'public'::regnamespace AND p.proname = v_fn
                  AND md5(replace(p.prosrc, E'\r', '')) <> v_esperado) THEN
      RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: public.% já existe com um corpo que não é o desta migration — revise antes de aplicar.', v_fn;
    END IF;
  END LOOP;

  -- A tabela nova: ausente, ou com exatamente as colunas desta migration.
  IF to_regclass('public.order_refund_diagnostico') IS NOT NULL THEN
    IF (SELECT string_agg(c.column_name || ':' || c.data_type, ',' ORDER BY c.column_name)
          FROM information_schema.columns c
         WHERE c.table_schema = 'public' AND c.table_name = 'order_refund_diagnostico')
       IS DISTINCT FROM 'atualizado_em:timestamp with time zone,criado_em:timestamp with time zone,mp_codigo:text,post_incerto_em:timestamp with time zone,refund_id:uuid,transitorios:integer' THEN
      RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: public.order_refund_diagnostico já existe com colunas diferentes das desta migration — revise antes de aplicar.';
    END IF;
  END IF;
END $preflight_20261226$;

-- ---------------------------------------------------------------------------
-- 1. O diagnóstico do estorno: tabela SEPARADA, só do servidor
-- ---------------------------------------------------------------------------
-- A cliente lê a linha inteira de order_refunds (RLS); nada daqui pode ir para lá. RLS ligada
-- e NENHUMA policy: nem o lojista logado lê pela API; só as funções SECURITY DEFINER abaixo.
CREATE TABLE IF NOT EXISTS public.order_refund_diagnostico (
  refund_id uuid PRIMARY KEY REFERENCES public.order_refunds (id) ON DELETE CASCADE,
  mp_codigo text,
  post_incerto_em timestamptz,
  transitorios integer NOT NULL DEFAULT 0 CHECK (transitorios >= 0),
  criado_em timestamptz NOT NULL DEFAULT now(),
  atualizado_em timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.order_refund_diagnostico IS
  'Por que a linha de order_refunds falhou (só servidor; a cliente lê order_refunds, por isso o motivo interno mora aqui). mp_codigo = último código do MP; post_incerto_em = carimbo de "um POST desta linha pode ter chegado ao MP sem resposta reconhecida" (nunca se apaga: linha com carimbo nunca recebe chave nova); transitorios = falhas "nada saiu" repetidas (sem saldo, ainda não liberado). Sem linha aqui = legado = incerta.';

ALTER TABLE public.order_refund_diagnostico ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.order_refund_diagnostico FROM PUBLIC, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 2. registrar_diagnostico_do_estorno — grava o porquê, atômica, só servidor
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.registrar_diagnostico_do_estorno(
  p_refund_id uuid,
  p_mp_codigo text DEFAULT NULL,
  p_post_incerto boolean DEFAULT false,
  p_transitorio boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $registrar_diagnostico$
DECLARE
  v_transitorios integer;
  v_incerto timestamptz;
  v_codigo text;
BEGIN
  IF COALESCE(current_setting('role', true), '') NOT IN ('postgres', 'service_role') THEN
    RAISE EXCEPTION 'Não autorizado: o diagnóstico do estorno só é gravado pelo servidor.'
      USING ERRCODE = '42501';
  END IF;
  IF p_refund_id IS NULL OR NOT EXISTS (SELECT 1 FROM public.order_refunds WHERE id = p_refund_id) THEN
    RAISE EXCEPTION 'Linha de devolução não encontrada: %.', p_refund_id USING ERRCODE = 'P0002';
  END IF;

  -- UM comando: o incremento acontece no banco (duas conexões não perdem contagem) e o carimbo,
  -- uma vez posto, não sai (COALESCE com o antigo primeiro).
  INSERT INTO public.order_refund_diagnostico AS d (refund_id, mp_codigo, post_incerto_em, transitorios)
  VALUES (p_refund_id, NULLIF(btrim(p_mp_codigo), ''),
          CASE WHEN COALESCE(p_post_incerto, false) THEN now() END,
          CASE WHEN COALESCE(p_transitorio, false) THEN 1 ELSE 0 END)
  ON CONFLICT (refund_id) DO UPDATE
     SET mp_codigo = COALESCE(EXCLUDED.mp_codigo, d.mp_codigo),
         post_incerto_em = COALESCE(d.post_incerto_em, EXCLUDED.post_incerto_em),
         transitorios = d.transitorios + EXCLUDED.transitorios,
         atualizado_em = now()
  RETURNING d.transitorios, d.post_incerto_em, d.mp_codigo
       INTO v_transitorios, v_incerto, v_codigo;

  RETURN jsonb_build_object(
    'transitorios', v_transitorios,
    'post_incerto', v_incerto IS NOT NULL,
    'mp_codigo', v_codigo
  );
END;
$registrar_diagnostico$;

REVOKE ALL ON FUNCTION public.registrar_diagnostico_do_estorno(uuid, text, boolean, boolean)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.registrar_diagnostico_do_estorno(uuid, text, boolean, boolean) TO service_role;

-- ---------------------------------------------------------------------------
-- 3. reemitir_reembolso_da_devolucao — adotar OU criar, sob trava, só servidor
-- ---------------------------------------------------------------------------
-- p_consulta: {"resultado":"achou","mp_refund_id":"…","mp_status":"processed|approved","valor":50}
--          ou {"resultado":"nao_achou"}. Resultado: {"resultado": <vocabulário>, "detalhe": <chave>, …}.
-- Ordem de travas (a da casa): devolução -> linhas de order_refunds do pedido (por id) -> pedido.
CREATE OR REPLACE FUNCTION public.reemitir_reembolso_da_devolucao(
  p_devolucao_id uuid,
  p_ator uuid,
  p_refund_esperado uuid,
  p_consulta jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $reemitir$
DECLARE
  v_d public.devolucoes%ROWTYPE;
  v_o public.marketplace_orders%ROWTYPE;
  v_r public.order_refunds%ROWTYPE;
  v_diag public.order_refund_diagnostico%ROWTYPE;
  v_consulta text;
  v_sem_post boolean;
  v_mp_refund text;
  v_mp_status text;
  v_valor numeric(12, 2);
  v_saldo numeric(12, 2);
  v_novo uuid;
BEGIN
  IF COALESCE(current_setting('role', true), '') NOT IN ('postgres', 'service_role') THEN
    RAISE EXCEPTION 'Não autorizado: a reemissão do reembolso só acontece pelo servidor.'
      USING ERRCODE = '42501';
  END IF;
  IF p_ator IS NULL THEN
    RAISE EXCEPTION 'Acesso negado.' USING ERRCODE = '42501';
  END IF;
  -- Admin ATUAL do ATOR, nas duas fontes (auth.users e profiles), nunca do JWT nem da sessão:
  -- is_admin()/is_admin_atual() devolvem TRUE para service_role e aqui não conferiam nada.
  IF NOT (
       EXISTS (SELECT 1 FROM auth.users u
                WHERE u.id = p_ator AND (u.raw_app_meta_data ->> 'role') = 'admin')
       AND EXISTS (SELECT 1 FROM public.profiles pr
                    WHERE pr.id = p_ator AND pr.role = 'admin')
     ) THEN
    RAISE EXCEPTION 'Acesso negado.' USING ERRCODE = '42501';
  END IF;
  IF p_refund_esperado IS NULL THEN
    RAISE EXCEPTION 'Informe a linha de reembolso que a tela mostrava (p_refund_esperado).' USING ERRCODE = '22023';
  END IF;
  v_consulta := p_consulta ->> 'resultado';
  IF v_consulta IS NULL OR v_consulta NOT IN ('achou', 'nao_achou') THEN
    RAISE EXCEPTION 'A consulta ao Mercado Pago precisa dizer "achou" ou "nao_achou"; indeterminado não reemite.'
      USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_d FROM public.devolucoes WHERE id = p_devolucao_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Devolução não encontrada.' USING ERRCODE = 'P0002';
  END IF;
  IF v_d.status <> 'concluida' OR v_d.resolucao_final IS DISTINCT FROM 'reembolso' THEN
    RAISE EXCEPTION 'Só uma devolução concluída com reembolso pode reemitir o reembolso.' USING ERRCODE = '22023';
  END IF;
  IF v_d.valor_reembolso IS NULL OR v_d.valor_reembolso <= 0 THEN
    RAISE EXCEPTION 'Esta devolução não tem valor de reembolso.' USING ERRCODE = '22023';
  END IF;
  IF v_d.reembolso_manual THEN
    RETURN jsonb_build_object('resultado', 'ja_concluido', 'detalhe', 'por_fora');
  END IF;
  IF v_d.refund_id IS NULL THEN
    RAISE EXCEPTION 'Esta devolução não tem um reembolso para reemitir.' USING ERRCODE = '22023';
  END IF;

  -- As linhas do pedido, por id, ANTES do pedido (a ordem de concluir_estorno e do cancelamento).
  PERFORM 1
     FROM public.order_refunds r
    WHERE r.order_id = v_d.order_id
    ORDER BY r.id
      FOR UPDATE;
  SELECT * INTO v_o FROM public.marketplace_orders WHERE id = v_d.order_id FOR UPDATE;

  -- Duplo clique / dois lojistas / tela velha: a devolução já aponta para outra linha.
  IF v_d.refund_id IS DISTINCT FROM p_refund_esperado THEN
    RETURN jsonb_build_object('resultado', 'reembolso_mudou', 'detalhe', 'outra_linha',
                              'refund_id', v_d.refund_id);
  END IF;
  SELECT * INTO v_r FROM public.order_refunds WHERE id = v_d.refund_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'A linha de reembolso desta devolução não existe mais.' USING ERRCODE = 'P0002';
  END IF;
  IF v_r.status = 'concluido' THEN
    RETURN jsonb_build_object('resultado', 'ja_concluido', 'detalhe', 'dinheiro_ja_saiu', 'refund_id', v_r.id);
  END IF;
  IF v_r.status IN ('solicitado', 'em_processamento') THEN
    RETURN jsonb_build_object('resultado', 'em_andamento', 'detalhe', v_r.status, 'refund_id', v_r.id);
  END IF;

  -- A linha é `falhou` ou `recusado`. NUNCA teve POST? (o MP provou que nada saiu, ou nunca houve POST)
  SELECT * INTO v_diag FROM public.order_refund_diagnostico WHERE refund_id = v_r.id;
  v_sem_post := v_r.mp_refund_id IS NULL
    AND (
      (v_r.status = 'recusado' AND v_r.post_autorizado_em IS NULL)
      OR (v_r.status = 'falhou'
          AND v_diag.refund_id IS NOT NULL
          AND v_diag.post_incerto_em IS NULL
          AND v_diag.mp_codigo IN ('insufficient_money_for_refund', 'order_payment_not_yet_enabled_for_refund'))
    );

  IF v_sem_post THEN
    -- Nada saiu desta linha. Um reembolso do pedido sem dono no MP é dinheiro NÃO explicado: não
    -- cria (pagaria de novo) e não adota (nunca se adota para linha que nunca teve POST).
    IF v_consulta = 'achou' THEN
      RETURN jsonb_build_object('resultado', 'indeterminado', 'detalhe', 'reembolso_do_mp_sem_dono');
    END IF;
  ELSE
    -- Incerta: o POST pode ter chegado ao MP. Sem reembolso achado, nunca ganha chave nova.
    IF v_consulta = 'nao_achou' THEN
      RETURN jsonb_build_object('resultado', 'use_por_fora', 'detalhe', 'sem_prova_de_que_nao_saiu',
                                'refund_id', v_r.id);
    END IF;

    -- ADOTAR: o MP já fez este reembolso.
    v_mp_refund := NULLIF(btrim(p_consulta ->> 'mp_refund_id'), '');
    v_mp_status := p_consulta ->> 'mp_status';
    BEGIN
      v_valor := (p_consulta ->> 'valor')::numeric;
    EXCEPTION WHEN invalid_text_representation THEN
      RAISE EXCEPTION 'O valor da consulta ao Mercado Pago não é um número.' USING ERRCODE = '22023';
    END;
    IF v_mp_refund IS NULL OR v_mp_status IS NULL OR v_mp_status NOT IN ('processed', 'approved') OR v_valor IS NULL THEN
      RAISE EXCEPTION 'A consulta "achou" precisa de mp_refund_id, mp_status (processed/approved) e valor.' USING ERRCODE = '22023';
    END IF;
    IF v_valor <> v_r.amount THEN
      RETURN jsonb_build_object('resultado', 'indeterminado', 'detalhe', 'valor_diferente');
    END IF;
    IF EXISTS (SELECT 1 FROM public.order_refunds x
                WHERE x.order_id = v_r.order_id AND x.id <> v_r.id AND x.mp_refund_id = v_mp_refund) THEN
      RETURN jsonb_build_object('resultado', 'indeterminado', 'detalhe', 'reembolso_ja_registrado_em_outra_linha');
    END IF;
    IF EXISTS (SELECT 1 FROM public.order_refunds x
                WHERE x.order_id = v_r.order_id AND x.id <> v_r.id
                  AND x.solicitado_por <> 'sistema'
                  AND x.mp_refund_id IS NULL
                  AND x.amount = v_r.amount
                  AND x.status IN ('solicitado', 'em_processamento', 'falhou')) THEN
      RETURN jsonb_build_object('resultado', 'indeterminado', 'detalhe', 'outra_linha_do_mesmo_valor');
    END IF;

    BEGIN
      PERFORM public.concluir_estorno(v_r.id, v_mp_refund, v_mp_status, NULL);
    EXCEPTION
      WHEN unique_violation THEN
        RETURN jsonb_build_object('resultado', 'indeterminado', 'detalhe', 'reembolso_ja_registrado_em_outra_linha');
      WHEN raise_exception THEN
        IF SQLERRM LIKE 'estorno_acima_do_total%' THEN
          RETURN jsonb_build_object('resultado', 'indeterminado', 'detalhe', 'passaria_do_total_do_pedido');
        END IF;
        RAISE;
    END;
    PERFORM public.devolucao__registrar_evento(p_devolucao_id, 'concluida', 'concluida', 'loja',
      'O reembolso desta devolução já tinha sido feito pelo Mercado Pago; a loja confirmou.');
    RETURN jsonb_build_object('resultado', 'ja_existia', 'detalhe', 'adotado',
                              'refund_id', v_r.id, 'mp_refund_id', v_mp_refund);
  END IF;

  -- CRIAR a tentativa nova (a linha nunca teve POST e o MP não tem reembolso sem dono).
  IF v_o.status <> 'delivered' THEN
    RETURN jsonb_build_object('resultado', 'use_por_fora', 'detalhe', 'pedido_nao_entregue');
  END IF;
  IF v_o.payment_status IS NULL OR v_o.payment_status NOT IN ('pago', 'pago_apos_expirar') THEN
    RETURN jsonb_build_object('resultado', 'use_por_fora', 'detalhe', 'sem_pagamento_pelo_app');
  END IF;
  IF NOT (v_o.payment_method = 'online'
          AND v_o.gateway_payment_id IS NOT NULL
          AND v_o.paid_at IS NOT NULL
          AND now() - v_o.paid_at <= interval '180 days') THEN
    RETURN jsonb_build_object('resultado', 'use_por_fora', 'detalhe', 'fora_do_prazo_ou_da_forma');
  END IF;
  -- Devolução pelo painel do MP depois da conclusão: o webhook a registra como linha `sistema`
  -- (sem contestação). Reemitir pagaria a cliente de novo.
  IF EXISTS (SELECT 1 FROM public.order_refunds s
              WHERE s.order_id = v_o.id
                AND s.solicitado_por = 'sistema'
                AND s.status = 'concluido'
                AND s.mp_chargeback_id IS NULL
                AND s.created_at >= COALESCE(v_d.concluida_em, v_d.updated_at)) THEN
    RETURN jsonb_build_object('resultado', 'use_por_fora', 'detalhe', 'devolvido_pelo_painel_do_mp');
  END IF;

  v_saldo := public.pedido__saldo_a_estornar(v_o.id);
  IF v_saldo IS NULL OR v_saldo < v_d.valor_reembolso THEN
    RETURN jsonb_build_object('resultado', 'sem_saldo_para_reemitir', 'detalhe', 'saldo_menor_que_o_valor',
                              'saldo', GREATEST(COALESCE(v_saldo, 0), 0), 'valor', v_d.valor_reembolso);
  END IF;

  INSERT INTO public.order_refunds (order_id, amount, motivo, solicitado_por, status)
  VALUES (v_o.id, v_d.valor_reembolso, 'Reemissão da devolução ' || v_d.protocolo, 'lojista', 'solicitado')
  RETURNING id INTO v_novo;

  UPDATE public.devolucoes
     SET refund_id = v_novo, reembolso_manual = false, updated_at = now()
   WHERE id = p_devolucao_id;

  PERFORM public.devolucao__registrar_evento(p_devolucao_id, 'concluida', 'concluida', 'loja',
    'Reembolso reemitido pelo Mercado Pago após a falha anterior.');

  RETURN jsonb_build_object('resultado', 'reemitido', 'detalhe', 'tentativa_nova',
                            'refund_id', v_novo, 'refund_anterior', v_r.id);
END;
$reemitir$;

REVOKE ALL ON FUNCTION public.reemitir_reembolso_da_devolucao(uuid, uuid, uuid, jsonb)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reemitir_reembolso_da_devolucao(uuid, uuid, uuid, jsonb) TO service_role;

-- ---------------------------------------------------------------------------
-- 4. admin_devolucao_reembolso_por_fora — "Já devolvi por fora", função PRÓPRIA do lojista logado
-- ---------------------------------------------------------------------------
-- Não move dinheiro no MP. Aceita `falhou` e `recusado` (a antiga só aceitava `recusado`) e não
-- exige pedido entregue (pedido cancelado depois de entregue também tem saída). Avisa a cliente
-- ("combinado com a loja", 1 vez). `risco_de_dobro` = a linha `falhou` pode ter chegado ao MP:
-- se o reembolso tardio do MP chegar, o saldo desconta o valor duas vezes (falha para o lado
-- seguro: prende saldo, nunca paga de novo).
CREATE OR REPLACE FUNCTION public.admin_devolucao_reembolso_por_fora(
  p_devolucao_id uuid,
  p_refund_esperado uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $por_fora$
DECLARE
  v_d public.devolucoes%ROWTYPE;
  v_r public.order_refunds%ROWTYPE;
  v_diag public.order_refund_diagnostico%ROWTYPE;
  v_risco boolean;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Acesso negado.' USING ERRCODE = '42501';
  END IF;
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Acesso negado.' USING ERRCODE = '42501';
  END IF;
  -- Papel ATUAL (auth.users E profiles), não o do JWT: admin rebaixado para aqui.
  IF NOT public.is_admin_atual() THEN
    RAISE EXCEPTION 'Acesso negado.' USING ERRCODE = '42501';
  END IF;
  IF p_refund_esperado IS NULL THEN
    RAISE EXCEPTION 'Informe a linha de reembolso que a tela mostrava (p_refund_esperado).' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_d FROM public.devolucoes WHERE id = p_devolucao_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Devolução não encontrada.' USING ERRCODE = 'P0002';
  END IF;
  IF v_d.status <> 'concluida' OR v_d.resolucao_final IS DISTINCT FROM 'reembolso' THEN
    RAISE EXCEPTION 'Só uma devolução concluída com reembolso pode ser resolvida por fora.' USING ERRCODE = '22023';
  END IF;
  IF v_d.valor_reembolso IS NULL OR v_d.valor_reembolso <= 0 THEN
    RAISE EXCEPTION 'Esta devolução não tem valor de reembolso.' USING ERRCODE = '22023';
  END IF;
  IF v_d.reembolso_manual THEN
    RETURN jsonb_build_object('resultado', 'ja_concluido', 'detalhe', 'por_fora');
  END IF;
  IF v_d.refund_id IS NULL THEN
    RAISE EXCEPTION 'Esta devolução não tem um reembolso para resolver por fora.' USING ERRCODE = '22023';
  END IF;

  PERFORM 1
     FROM public.order_refunds r
    WHERE r.order_id = v_d.order_id
    ORDER BY r.id
      FOR UPDATE;
  PERFORM 1 FROM public.marketplace_orders o WHERE o.id = v_d.order_id FOR UPDATE;

  IF v_d.refund_id IS DISTINCT FROM p_refund_esperado THEN
    RETURN jsonb_build_object('resultado', 'reembolso_mudou', 'detalhe', 'outra_linha',
                              'refund_id', v_d.refund_id);
  END IF;
  SELECT * INTO v_r FROM public.order_refunds WHERE id = v_d.refund_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'A linha de reembolso desta devolução não existe mais.' USING ERRCODE = 'P0002';
  END IF;
  IF v_r.status = 'concluido' THEN
    RETURN jsonb_build_object('resultado', 'ja_concluido', 'detalhe', 'dinheiro_ja_saiu', 'refund_id', v_r.id);
  END IF;
  IF v_r.status IN ('solicitado', 'em_processamento') THEN
    RETURN jsonb_build_object('resultado', 'em_andamento', 'detalhe', v_r.status, 'refund_id', v_r.id);
  END IF;

  SELECT * INTO v_diag FROM public.order_refund_diagnostico WHERE refund_id = v_r.id;
  v_risco := NOT (
    v_r.mp_refund_id IS NULL
    AND (
      (v_r.status = 'recusado' AND v_r.post_autorizado_em IS NULL)
      OR (v_r.status = 'falhou'
          AND v_diag.refund_id IS NOT NULL
          AND v_diag.post_incerto_em IS NULL
          AND v_diag.mp_codigo IN ('insufficient_money_for_refund', 'order_payment_not_yet_enabled_for_refund'))
    )
  );

  UPDATE public.devolucoes
     SET refund_id = NULL, reembolso_manual = true, updated_at = now()
   WHERE id = p_devolucao_id;

  PERFORM public.devolucao__registrar_evento(p_devolucao_id, 'concluida', 'concluida', 'loja',
    'Reembolso resolvido manualmente (fora do app) após a falha pelo Mercado Pago.');
  PERFORM public.devolucao__avisar_reembolso(p_devolucao_id, 'reembolso_combinado', 'success',
    'Devolução concluída',
    'O reembolso da devolução ' || v_d.protocolo || ' foi combinado com a loja (em mãos ou por PIX). Se tiver dúvida, fale com a loja.');

  RETURN jsonb_build_object('resultado', 'combinado',
                            'detalhe', CASE WHEN v_risco THEN 'pode_ter_saido_no_mp' ELSE 'ok' END,
                            'risco_de_dobro', v_risco);
END;
$por_fora$;

REVOKE ALL ON FUNCTION public.admin_devolucao_reembolso_por_fora(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_devolucao_reembolso_por_fora(uuid, uuid) TO authenticated;

-- ---------------------------------------------------------------------------
-- 5. CONFERÊNCIA FINAL (cai a migration inteira se qualquer coisa estiver fora do esperado)
-- ---------------------------------------------------------------------------
DO $conferencia_20261226$
DECLARE
  v_fn text;
  v_hash text;
BEGIN
  FOR v_fn, v_hash IN
    VALUES ('registrar_diagnostico_do_estorno', 'b8e4e28fbcd23a32dac0d18823b8aefe'),
           ('reemitir_reembolso_da_devolucao', '872fcb1d2bac9816e2d2b1c7c2e868c0'),
           ('admin_devolucao_reembolso_por_fora', '0a7e06d7004c3fb70897e87c4dfa8cf9')
  LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_proc p
                    WHERE p.pronamespace = 'public'::regnamespace AND p.proname = v_fn
                      AND p.prosecdef
                      AND p.proconfig = ARRAY['search_path=public']::text[]
                      AND md5(replace(p.prosrc, E'\r', '')) = v_hash) THEN
      RAISE EXCEPTION 'CONFERENCIA_20261226: % não está com o corpo e os atributos desta migration.', v_fn;
    END IF;
  END LOOP;

  -- As duas de servidor: nem PUBLIC, nem anon, nem authenticated; service_role sim.
  IF has_function_privilege('anon', 'public.registrar_diagnostico_do_estorno(uuid,text,boolean,boolean)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.registrar_diagnostico_do_estorno(uuid,text,boolean,boolean)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.reemitir_reembolso_da_devolucao(uuid,uuid,uuid,jsonb)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.reemitir_reembolso_da_devolucao(uuid,uuid,uuid,jsonb)', 'EXECUTE')
     OR EXISTS (SELECT 1
                  FROM pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
                 WHERE p.oid IN (to_regprocedure('public.registrar_diagnostico_do_estorno(uuid,text,boolean,boolean)'),
                                 to_regprocedure('public.reemitir_reembolso_da_devolucao(uuid,uuid,uuid,jsonb)'),
                                 to_regprocedure('public.admin_devolucao_reembolso_por_fora(uuid,uuid)'))
                   AND a.grantee = 0 AND a.privilege_type = 'EXECUTE') THEN
    RAISE EXCEPTION 'CONFERENCIA_20261226: EXECUTE aberto onde devia estar fechado (PUBLIC/anon/authenticated nas funções de servidor, ou PUBLIC na do lojista).';
  END IF;
  IF has_function_privilege('anon', 'public.admin_devolucao_reembolso_por_fora(uuid,uuid)', 'EXECUTE')
     OR NOT has_function_privilege('authenticated', 'public.admin_devolucao_reembolso_por_fora(uuid,uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'CONFERENCIA_20261226: admin_devolucao_reembolso_por_fora tem de ser do authenticated e fechada ao anon.';
  END IF;

  -- A tabela: RLS ligada, nenhuma policy, nenhum acesso de papel de API.
  IF NOT EXISTS (SELECT 1 FROM pg_class c WHERE c.oid = 'public.order_refund_diagnostico'::regclass AND c.relrowsecurity)
     OR EXISTS (SELECT 1 FROM pg_policy WHERE polrelid = 'public.order_refund_diagnostico'::regclass)
     OR has_table_privilege('anon', 'public.order_refund_diagnostico', 'SELECT')
     OR has_table_privilege('authenticated', 'public.order_refund_diagnostico', 'SELECT')
     OR has_table_privilege('authenticated', 'public.order_refund_diagnostico', 'INSERT')
     OR has_table_privilege('authenticated', 'public.order_refund_diagnostico', 'UPDATE') THEN
    RAISE EXCEPTION 'CONFERENCIA_20261226: order_refund_diagnostico tem de ter RLS ligada, nenhuma policy e nenhum acesso de anon/authenticated.';
  END IF;
END $conferencia_20261226$;
