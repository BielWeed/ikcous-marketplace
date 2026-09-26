-- O FINANCEIRO DA LOJA NASCE (26/09/2026 — plano
-- docs/superpowers/plans/2026-09-26-painel-cartao-e-devolucoes.md, tarefa 3;
-- spec docs/superpowers/specs/2026-09-26-inicio-crm-e-financeiro-do-painel-design.md).
--
-- O QUE FALTAVA: o lojista não tinha onde ver nem controlar o dinheiro da loja
-- inteira — vendas do app, vendas do balcão, estornos, despesas, contas a
-- pagar e o caixa da loja física. O painel só mostrava receita analítica.
--
-- REGRA DE OURO: O DINHEIRO MORA NA FONTE. Venda online, venda de balcão,
-- estorno e reembolso de devolução JÁ TÊM dono no banco (marketplace_orders,
-- order_refunds, devolucoes). O Financeiro LÊ essas fontes (fin__movimentos) —
-- não copia, não usa gatilho no caminho do dinheiro: confirmar_pagamento,
-- registrar_venda_presencial e concluir_estorno ficam intocadas. O que não tem
-- fonte (aluguel, fornecedor, sangria, conta a pagar) nasce em fin_lancamentos.
--
-- O QUE ESTA MIGRATION FAZ, NA ORDEM:
--   1. fin_contas (caixa · banco · mercado_pago · outro), com 3 contas de
--      sistema de UUID fixo — Caixa da loja (…0001), Conta bancária (…0002),
--      Mercado Pago (…0003). Venda derivada cai por forma: online → Mercado
--      Pago; dinheiro → Caixa; pix/cartão na entrega ou no balcão → Conta
--      bancária. Saldo = saldo inicial (com data) + movimentos realizados
--      desde essa data.
--   2. fin_categorias com grupo da DRE (receita · deducao · custo_variavel ·
--      despesa_fixa · financeiro · fora_dre) e a semente de loja pequena.
--   3. fin_lancamentos: entrada · saída · transferência; previsto · realizado ·
--      cancelado; competência, vencimento, realização; parcelas. Realizado não
--      se edita — cancela (com motivo, trilha) e lança de novo.
--   4. fin_caixa_sessoes: abertura (a diferença para o saldo do sistema vira
--      ajuste), sangria/suprimento (transferências ligadas à sessão),
--      fechamento com contado × esperado (a diferença vira Quebra/Sobra de
--      caixa). Uma sessão aberta por conta.
--   5. assinatura_da_loja: o card de plano do Início só LÊ. Cobrança de
--      mensalidade é de outro projeto (AGENTS.md, escopo) — ele grava esta
--      linha com a chave de serviço; o app não tem escrita nenhuma aqui.
--   6. RPCs (todas SECURITY DEFINER, search_path fixo, gate is_admin()
--      dentro): fin_resumo, fin_extrato, fin_previstos, fin_dre,
--      fin_contas_listar, fin_categorias_listar, fin_conta_salvar,
--      fin_categoria_salvar, fin_lancamento_salvar, fin_lancamento_baixar,
--      fin_lancamento_cancelar, fin_caixa_atual, fin_caixa_abrir,
--      fin_caixa_movimentar, fin_caixa_fechar, fin_caixa_historico,
--      assinatura_da_loja_ler.
--
-- DADOS EXISTENTES: nenhuma tabela existente é reescrita. Sementes: 3 contas e
-- as categorias de sistema (ON CONFLICT DO NOTHING — não sobrescrevem o que o
-- lojista renomeou).
--
-- IDEMPOTÊNCIA: CREATE TABLE IF NOT EXISTS, CREATE OR REPLACE FUNCTION,
-- DROP POLICY IF EXISTS, ON CONFLICT DO NOTHING.
--
-- FORA DO ESCOPO: taxa do Mercado Pago por venda (o app não guarda a taxa de
-- cada cobrança — o lojista lança "Taxas de cartão e Mercado Pago" como custo
-- variável); conciliação automática com extrato bancário/relatório de
-- liberação do MP; custo histórico do produto (o CMV usa o custo ATUAL do
-- produto e a DRE diz que é estimado).
--
-- COMO APLICAR: `node scripts/db-apply.cjs <este arquivo>` (sem BEGIN/COMMIT).
--
-- FICHA DE VERIFICAÇÃO:
--   1. SELECT id, nome, tipo FROM public.fin_contas ORDER BY ordem;  -- 3 linhas
--   2. SELECT count(*) FROM public.fin_categorias WHERE sistema;     -- 20
--   3. SELECT relrowsecurity FROM pg_class WHERE relname LIKE 'fin\_%'
--        OR relname = 'assinatura_da_loja';                          -- todos true
--
-- ROLLBACK MANUAL: rollback-manual-20261177000000_o_financeiro_da_loja_nasce.sql
-- (APAGA lançamentos, contas, categorias e sessões de caixa do lojista).
-- psql -1 -f — nunca pelo db-apply.

-- ---------------------------------------------------------------------------
-- 1. Tabelas
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.fin_contas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nome text NOT NULL CHECK (char_length(btrim(nome)) BETWEEN 1 AND 60),
  tipo text NOT NULL CHECK (tipo IN ('caixa', 'banco', 'mercado_pago', 'outro')),
  saldo_inicial numeric(12, 2) NOT NULL DEFAULT 0,
  saldo_inicial_em date NOT NULL DEFAULT (now() AT TIME ZONE 'America/Sao_Paulo')::date,
  ativa boolean NOT NULL DEFAULT true,
  ordem integer NOT NULL DEFAULT 0,
  sistema boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.fin_contas IS
  'Contas do Financeiro (onde o dinheiro da loja está). Saldo = saldo_inicial + '
  'movimentos realizados desde saldo_inicial_em. As 3 de sistema (UUID fixo '
  'f1000000-…-00000000000{1,2,3}) recebem as vendas derivadas por forma.';

CREATE TABLE IF NOT EXISTS public.fin_categorias (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nome text NOT NULL CHECK (char_length(btrim(nome)) BETWEEN 1 AND 60),
  natureza text NOT NULL CHECK (natureza IN ('receita', 'despesa')),
  grupo_dre text NOT NULL CHECK (grupo_dre IN (
    'receita', 'deducao', 'custo_variavel', 'despesa_fixa', 'financeiro', 'fora_dre'
  )),
  ativa boolean NOT NULL DEFAULT true,
  ordem integer NOT NULL DEFAULT 0,
  sistema boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.fin_caixa_sessoes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conta_id uuid NOT NULL REFERENCES public.fin_contas (id),
  status text NOT NULL DEFAULT 'aberto' CHECK (status IN ('aberto', 'fechado')),
  aberto_em timestamptz NOT NULL DEFAULT now(),
  aberto_por uuid,
  valor_abertura numeric(12, 2) NOT NULL CHECK (valor_abertura >= 0),
  fechado_em timestamptz,
  fechado_por uuid,
  valor_contado numeric(12, 2) CHECK (valor_contado IS NULL OR valor_contado >= 0),
  valor_esperado numeric(12, 2),
  diferenca numeric(12, 2),
  observacao text CHECK (observacao IS NULL OR char_length(observacao) <= 500),
  CHECK ((status = 'fechado') = (fechado_em IS NOT NULL))
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_fin_caixa_uma_aberta_por_conta
  ON public.fin_caixa_sessoes (conta_id) WHERE status = 'aberto';

CREATE TABLE IF NOT EXISTS public.fin_lancamentos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tipo text NOT NULL CHECK (tipo IN ('entrada', 'saida', 'transferencia')),
  status text NOT NULL CHECK (status IN ('previsto', 'realizado', 'cancelado')),
  valor numeric(12, 2) NOT NULL CHECK (valor > 0),
  conta_id uuid NOT NULL REFERENCES public.fin_contas (id),
  conta_destino_id uuid REFERENCES public.fin_contas (id),
  categoria_id uuid REFERENCES public.fin_categorias (id),
  descricao text NOT NULL CHECK (char_length(btrim(descricao)) BETWEEN 1 AND 140),
  forma_pagamento text CHECK (forma_pagamento IS NULL OR forma_pagamento IN (
    'pix', 'credito', 'debito', 'cartao', 'dinheiro', 'boleto', 'transferencia', 'outro'
  )),
  data_competencia date NOT NULL,
  data_vencimento date,
  data_realizacao date,
  grupo_parcelas uuid,
  parcela smallint,
  parcelas smallint,
  origem text NOT NULL DEFAULT 'manual' CHECK (origem IN ('manual', 'sangria', 'suprimento', 'ajuste_caixa')),
  caixa_sessao_id uuid REFERENCES public.fin_caixa_sessoes (id),
  observacao text CHECK (observacao IS NULL OR char_length(observacao) <= 500),
  criado_por uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  cancelado_em timestamptz,
  cancelado_por uuid,
  motivo_cancelamento text,
  CHECK ((tipo = 'transferencia') = (conta_destino_id IS NOT NULL)),
  CHECK (conta_destino_id IS NULL OR conta_destino_id <> conta_id),
  CHECK (tipo = 'transferencia' OR categoria_id IS NOT NULL),
  CHECK (status <> 'realizado' OR data_realizacao IS NOT NULL),
  CHECK (status <> 'previsto' OR data_realizacao IS NULL),
  CHECK (parcela IS NULL OR (parcela >= 1 AND parcela <= parcelas AND parcelas <= 48))
);

CREATE INDEX IF NOT EXISTS idx_fin_lancamentos_realizacao ON public.fin_lancamentos (data_realizacao) WHERE status = 'realizado';
CREATE INDEX IF NOT EXISTS idx_fin_lancamentos_previstos ON public.fin_lancamentos (data_vencimento) WHERE status = 'previsto';
CREATE INDEX IF NOT EXISTS idx_fin_lancamentos_competencia ON public.fin_lancamentos (data_competencia);
CREATE INDEX IF NOT EXISTS idx_fin_lancamentos_sessao ON public.fin_lancamentos (caixa_sessao_id);

CREATE TABLE IF NOT EXISTS public.assinatura_da_loja (
  id smallint PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  plano text NOT NULL CHECK (char_length(btrim(plano)) BETWEEN 1 AND 60),
  status text NOT NULL CHECK (status IN ('ativa', 'teste', 'pendente', 'atrasada', 'suspensa', 'cancelada')),
  valor_mensal numeric(10, 2) CHECK (valor_mensal IS NULL OR valor_mensal >= 0),
  ciclo text NOT NULL DEFAULT 'mensal' CHECK (ciclo IN ('mensal', 'trimestral', 'semestral', 'anual')),
  inicio_em date,
  proxima_cobranca_em date,
  teste_ate date,
  recursos text[] NOT NULL DEFAULT '{}',
  gerenciar_url text CHECK (gerenciar_url IS NULL OR gerenciar_url ~ '^https://'),
  suporte_whatsapp text CHECK (suporte_whatsapp IS NULL OR suporte_whatsapp ~ '^[0-9]{10,15}$'),
  observacao text CHECK (observacao IS NULL OR char_length(observacao) <= 500),
  atualizado_em timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.assinatura_da_loja IS
  'Plano/assinatura da loja, SÓ LEITURA para o app (card do Início). Quem grava '
  'é o projeto de cobrança, com a chave de serviço — cobrança de mensalidade '
  'não é do app (AGENTS.md, escopo).';

-- RLS: tudo só para o admin; nenhuma escrita direta (só RPC / service role).
ALTER TABLE public.fin_contas ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.fin_categorias ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.fin_caixa_sessoes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.fin_lancamentos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.assinatura_da_loja ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.fin_contas, public.fin_categorias, public.fin_caixa_sessoes,
  public.fin_lancamentos, public.assinatura_da_loja FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.fin_contas, public.fin_categorias, public.fin_caixa_sessoes,
  public.fin_lancamentos, public.assinatura_da_loja TO authenticated;
GRANT ALL ON public.fin_contas, public.fin_categorias, public.fin_caixa_sessoes,
  public.fin_lancamentos, public.assinatura_da_loja TO service_role;

DROP POLICY IF EXISTS fin_contas_admin_select_policy ON public.fin_contas;
CREATE POLICY fin_contas_admin_select_policy ON public.fin_contas
  FOR SELECT TO authenticated USING ((SELECT public.is_admin()));
DROP POLICY IF EXISTS fin_categorias_admin_select_policy ON public.fin_categorias;
CREATE POLICY fin_categorias_admin_select_policy ON public.fin_categorias
  FOR SELECT TO authenticated USING ((SELECT public.is_admin()));
DROP POLICY IF EXISTS fin_caixa_sessoes_admin_select_policy ON public.fin_caixa_sessoes;
CREATE POLICY fin_caixa_sessoes_admin_select_policy ON public.fin_caixa_sessoes
  FOR SELECT TO authenticated USING ((SELECT public.is_admin()));
DROP POLICY IF EXISTS fin_lancamentos_admin_select_policy ON public.fin_lancamentos;
CREATE POLICY fin_lancamentos_admin_select_policy ON public.fin_lancamentos
  FOR SELECT TO authenticated USING ((SELECT public.is_admin()));
DROP POLICY IF EXISTS assinatura_da_loja_admin_select_policy ON public.assinatura_da_loja;
CREATE POLICY assinatura_da_loja_admin_select_policy ON public.assinatura_da_loja
  FOR SELECT TO authenticated USING ((SELECT public.is_admin()));

-- ---------------------------------------------------------------------------
-- 2. Sementes (UUID fixo, não sobrescrevem o que o lojista mudou)
-- ---------------------------------------------------------------------------
INSERT INTO public.fin_contas (id, nome, tipo, ordem, sistema) VALUES
  ('f1000000-0000-4000-8000-000000000001', 'Caixa da loja', 'caixa', 1, true),
  ('f1000000-0000-4000-8000-000000000002', 'Conta bancária', 'banco', 2, true),
  ('f1000000-0000-4000-8000-000000000003', 'Mercado Pago', 'mercado_pago', 3, true)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.fin_categorias (id, nome, natureza, grupo_dre, ordem, sistema) VALUES
  ('f2000000-0000-4000-8000-000000000001', 'Vendas', 'receita', 'receita', 1, true),
  ('f2000000-0000-4000-8000-000000000002', 'Outras receitas', 'receita', 'receita', 2, true),
  ('f2000000-0000-4000-8000-000000000003', 'Rendimentos e juros recebidos', 'receita', 'financeiro', 3, true),
  ('f2000000-0000-4000-8000-000000000004', 'Aporte do dono', 'receita', 'fora_dre', 4, true),
  ('f2000000-0000-4000-8000-000000000005', 'Sobra de caixa', 'receita', 'financeiro', 5, true),
  ('f2000000-0000-4000-8000-000000000010', 'Devoluções e estornos', 'despesa', 'deducao', 10, true),
  ('f2000000-0000-4000-8000-000000000011', 'Impostos sobre vendas (DAS/Simples)', 'despesa', 'deducao', 11, true),
  ('f2000000-0000-4000-8000-000000000012', 'Taxas de cartão e Mercado Pago', 'despesa', 'custo_variavel', 12, true),
  ('f2000000-0000-4000-8000-000000000013', 'Frete pago pela loja', 'despesa', 'custo_variavel', 13, true),
  ('f2000000-0000-4000-8000-000000000014', 'Embalagens', 'despesa', 'custo_variavel', 14, true),
  ('f2000000-0000-4000-8000-000000000015', 'Comissões', 'despesa', 'custo_variavel', 15, true),
  ('f2000000-0000-4000-8000-000000000020', 'Aluguel e condomínio', 'despesa', 'despesa_fixa', 20, true),
  ('f2000000-0000-4000-8000-000000000021', 'Salários e pró-labore', 'despesa', 'despesa_fixa', 21, true),
  ('f2000000-0000-4000-8000-000000000022', 'Energia, água e internet', 'despesa', 'despesa_fixa', 22, true),
  ('f2000000-0000-4000-8000-000000000023', 'Marketing e anúncios', 'despesa', 'despesa_fixa', 23, true),
  ('f2000000-0000-4000-8000-000000000024', 'Sistemas e assinaturas', 'despesa', 'despesa_fixa', 24, true),
  ('f2000000-0000-4000-8000-000000000025', 'Outras despesas', 'despesa', 'despesa_fixa', 25, true),
  ('f2000000-0000-4000-8000-000000000030', 'Tarifas bancárias e juros pagos', 'despesa', 'financeiro', 30, true),
  ('f2000000-0000-4000-8000-000000000031', 'Quebra de caixa', 'despesa', 'financeiro', 31, true),
  ('f2000000-0000-4000-8000-000000000040', 'Compra de mercadoria', 'despesa', 'fora_dre', 40, true),
  ('f2000000-0000-4000-8000-000000000041', 'Retirada do dono', 'despesa', 'fora_dre', 41, true)
ON CONFLICT (id) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 3. Ajudantes internos (sem EXECUTE para ninguém além do dono)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fin__hoje()
RETURNS date LANGUAGE sql STABLE SET search_path = public
AS $$ SELECT (now() AT TIME ZONE 'America/Sao_Paulo')::date $$;

CREATE OR REPLACE FUNCTION public.fin__dia(p_instante timestamptz)
RETURNS date LANGUAGE sql STABLE SET search_path = public
AS $$ SELECT (p_instante AT TIME ZONE 'America/Sao_Paulo')::date $$;

CREATE OR REPLACE FUNCTION public.fin__conta_da_forma(p_payment_method text)
RETURNS uuid LANGUAGE sql IMMUTABLE SET search_path = public
AS $$
  SELECT CASE p_payment_method
    WHEN 'online' THEN 'f1000000-0000-4000-8000-000000000003'::uuid
    WHEN 'cash' THEN 'f1000000-0000-4000-8000-000000000001'::uuid
    ELSE 'f1000000-0000-4000-8000-000000000002'::uuid
  END
$$;

CREATE OR REPLACE FUNCTION public.fin__forma_do_pedido(p_payment_method text, p_metodo_online text)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path = public
AS $$
  SELECT CASE p_payment_method
    WHEN 'online' THEN COALESCE(p_metodo_online, 'pix')
    WHEN 'cash' THEN 'dinheiro'
    WHEN 'pix' THEN 'pix'
    WHEN 'card' THEN 'cartao'
    ELSE 'outro'
  END
$$;

-- Todo movimento do dinheiro da loja numa forma só: derivados das fontes
-- (vendas, estornos, reembolsos manuais de devolução) + manuais. Datas no fuso
-- da loja; p_inicio/p_fim NULL = sem limite.
CREATE OR REPLACE FUNCTION public.fin__movimentos(p_inicio date, p_fim date)
RETURNS TABLE (
  id text, origem text, tipo text, status text, valor numeric, data date,
  conta_id uuid, conta_destino_id uuid, categoria_id uuid, descricao text,
  forma_pagamento text, pedido_id uuid, vencimento date, data_competencia date,
  editavel boolean, canal text, caixa_sessao_id uuid, parcela smallint, parcelas smallint
)
LANGUAGE sql STABLE SET search_path = public
AS $$
  WITH vendas AS (
    SELECT o.*, public.fin__dia(COALESCE(o.pagamento_recebido_em, o.paid_at)) AS dia
      FROM public.marketplace_orders o
     WHERE COALESCE(o.pagamento_recebido_em, o.paid_at) IS NOT NULL
       AND o.payment_status IN ('pago', 'pago_apos_expirar', 'recebido_na_entrega', 'estornado')
  ), manuais AS (
    SELECT l.*,
           CASE WHEN l.status = 'realizado' THEN l.data_realizacao
                ELSE COALESCE(l.data_vencimento, l.data_competencia) END AS dia
      FROM public.fin_lancamentos l
     WHERE l.status <> 'cancelado'
  )
  SELECT * FROM (
    SELECT 'pedido:' || v.id::text,
           CASE WHEN v.canal = 'presencial' THEN 'venda_balcao'
                WHEN v.payment_method = 'online' THEN 'venda_online'
                ELSE 'venda_entrega' END,
           'entrada', 'realizado', v.total::numeric, v.dia,
           public.fin__conta_da_forma(v.payment_method), NULL::uuid,
           'f2000000-0000-4000-8000-000000000001'::uuid,
           CASE WHEN v.canal = 'presencial' THEN 'Venda no balcão' ELSE 'Pedido' END
             || ' #' || upper(left(v.id::text, 8)) || COALESCE(' · ' || NULLIF(btrim(v.customer_name), ''), ''),
           public.fin__forma_do_pedido(v.payment_method, v.metodo_online),
           v.id, NULL::date, v.dia, false, v.canal, NULL::uuid, NULL::smallint, NULL::smallint
      FROM vendas v
    UNION ALL
    SELECT 'estorno:' || r.id::text, 'estorno', 'saida',
           CASE WHEN r.status = 'concluido' THEN 'realizado' ELSE 'previsto' END,
           r.amount::numeric,
           CASE WHEN r.status = 'concluido' THEN public.fin__dia(r.concluido_em) ELSE public.fin__dia(r.created_at) END,
           public.fin__conta_da_forma(o.payment_method), NULL::uuid,
           'f2000000-0000-4000-8000-000000000010'::uuid,
           'Estorno do pedido #' || upper(left(o.id::text, 8)) || COALESCE(' · ' || NULLIF(btrim(r.motivo), ''), ''),
           public.fin__forma_do_pedido(o.payment_method, o.metodo_online),
           o.id,
           CASE WHEN r.status = 'concluido' THEN NULL ELSE public.fin__dia(r.created_at) END,
           CASE WHEN r.status = 'concluido' THEN public.fin__dia(r.concluido_em) ELSE public.fin__dia(r.created_at) END,
           false, o.canal, NULL::uuid, NULL::smallint, NULL::smallint
      FROM public.order_refunds r
      JOIN public.marketplace_orders o ON o.id = r.order_id
     WHERE (r.status = 'concluido' AND r.concluido_em IS NOT NULL)
        OR r.status IN ('solicitado', 'em_processamento')
    UNION ALL
    -- Estornado fora do app (registrar_estorno_manual / MP direto): o que o
    -- ledger não cobriu saiu por fora.
    SELECT 'estorno_externo:' || v.id::text, 'estorno_externo', 'saida', 'realizado',
           (v.total - COALESCE(v.valor_estornado, 0))::numeric, public.fin__dia(v.updated_at),
           public.fin__conta_da_forma(v.payment_method), NULL::uuid,
           'f2000000-0000-4000-8000-000000000010'::uuid,
           'Estorno registrado fora do app · pedido #' || upper(left(v.id::text, 8)),
           public.fin__forma_do_pedido(v.payment_method, v.metodo_online),
           v.id, NULL::date, public.fin__dia(v.updated_at), false, v.canal, NULL::uuid, NULL::smallint, NULL::smallint
      FROM vendas v
     WHERE v.payment_status = 'estornado' AND v.total - COALESCE(v.valor_estornado, 0) > 0
    UNION ALL
    SELECT 'devolucao:' || d.id::text, 'devolucao', 'saida', 'realizado', d.valor_reembolso::numeric,
           public.fin__dia(d.concluida_em),
           public.fin__conta_da_forma(o.payment_method), NULL::uuid,
           'f2000000-0000-4000-8000-000000000010'::uuid,
           'Reembolso da devolução ' || d.protocolo,
           public.fin__forma_do_pedido(o.payment_method, o.metodo_online),
           o.id, NULL::date, public.fin__dia(d.concluida_em), false, o.canal, NULL::uuid, NULL::smallint, NULL::smallint
      FROM public.devolucoes d
      JOIN public.marketplace_orders o ON o.id = d.order_id
     WHERE d.status = 'concluida' AND d.reembolso_manual AND d.valor_reembolso > 0
    UNION ALL
    SELECT m.id::text, m.origem, m.tipo, m.status, m.valor::numeric, m.dia,
           m.conta_id, m.conta_destino_id, m.categoria_id, m.descricao, m.forma_pagamento,
           NULL::uuid, m.data_vencimento, m.data_competencia,
           (m.caixa_sessao_id IS NULL OR EXISTS (
              SELECT 1 FROM public.fin_caixa_sessoes s WHERE s.id = m.caixa_sessao_id AND s.status = 'aberto')),
           NULL::text, m.caixa_sessao_id, m.parcela, m.parcelas
      FROM manuais m
  ) t (id, origem, tipo, status, valor, data, conta_id, conta_destino_id, categoria_id, descricao,
       forma_pagamento, pedido_id, vencimento, data_competencia, editavel, canal, caixa_sessao_id, parcela, parcelas)
  WHERE (p_inicio IS NULL OR t.data >= p_inicio)
    AND (p_fim IS NULL OR t.data <= p_fim)
$$;

-- Saldo realizado de cada conta: saldo inicial + movimentos realizados desde a
-- data do saldo inicial.
CREATE OR REPLACE FUNCTION public.fin__saldos()
RETURNS TABLE (conta_id uuid, saldo numeric)
LANGUAGE sql STABLE SET search_path = public
AS $$
  WITH mov AS (
    SELECT * FROM public.fin__movimentos(NULL, public.fin__hoje()) WHERE status = 'realizado'
  )
  SELECT c.id,
         c.saldo_inicial
         + COALESCE((SELECT sum(CASE
               WHEN m.tipo = 'entrada' AND m.conta_id = c.id THEN m.valor
               WHEN m.tipo = 'saida' AND m.conta_id = c.id THEN -m.valor
               WHEN m.tipo = 'transferencia' AND m.conta_id = c.id THEN -m.valor
               WHEN m.tipo = 'transferencia' AND m.conta_destino_id = c.id THEN m.valor
               ELSE 0 END)
             FROM mov m
            WHERE (m.conta_id = c.id OR m.conta_destino_id = c.id)
              AND m.data >= c.saldo_inicial_em), 0)
    FROM public.fin_contas c
$$;

-- Esperado da sessão de caixa aberta (ou fechada, até o fechamento).
CREATE OR REPLACE FUNCTION public.fin__caixa_calculo(p_sessao_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SET search_path = public
AS $$
DECLARE
  v_s public.fin_caixa_sessoes%ROWTYPE;
  v_fim timestamptz;
  v_vendas numeric := 0;
  v_devolucoes numeric := 0;
  v_entradas numeric := 0;
  v_saidas numeric := 0;
BEGIN
  SELECT * INTO v_s FROM public.fin_caixa_sessoes WHERE id = p_sessao_id;
  IF NOT FOUND THEN RETURN NULL; END IF;
  v_fim := COALESCE(v_s.fechado_em, now());

  -- Só a conta de sistema recebe as vendas em dinheiro derivadas.
  IF v_s.conta_id = 'f1000000-0000-4000-8000-000000000001'::uuid THEN
    SELECT COALESCE(sum(o.total), 0) INTO v_vendas
      FROM public.marketplace_orders o
     WHERE o.payment_method = 'cash'
       AND o.payment_status IN ('recebido_na_entrega', 'estornado')
       AND o.pagamento_recebido_em >= v_s.aberto_em AND o.pagamento_recebido_em <= v_fim;
    SELECT COALESCE(sum(d.valor_reembolso), 0) INTO v_devolucoes
      FROM public.devolucoes d JOIN public.marketplace_orders o ON o.id = d.order_id
     WHERE d.status = 'concluida' AND d.reembolso_manual AND o.payment_method = 'cash'
       AND d.concluida_em >= v_s.aberto_em AND d.concluida_em <= v_fim;
  END IF;

  SELECT COALESCE(sum(CASE
           WHEN l.tipo = 'entrada' AND l.conta_id = v_s.conta_id THEN l.valor
           WHEN l.tipo = 'transferencia' AND l.conta_destino_id = v_s.conta_id THEN l.valor
           ELSE 0 END), 0),
         COALESCE(sum(CASE
           WHEN l.tipo = 'saida' AND l.conta_id = v_s.conta_id THEN l.valor
           WHEN l.tipo = 'transferencia' AND l.conta_id = v_s.conta_id THEN l.valor
           ELSE 0 END), 0)
    INTO v_entradas, v_saidas
    FROM public.fin_lancamentos l
   WHERE l.caixa_sessao_id = v_s.id AND l.status = 'realizado' AND l.origem <> 'ajuste_caixa';

  RETURN jsonb_build_object(
    'vendas_dinheiro', v_vendas,
    'devolucoes_dinheiro', v_devolucoes,
    'entradas_manuais', v_entradas,
    'saidas_manuais', v_saidas,
    'esperado', v_s.valor_abertura + v_vendas - v_devolucoes + v_entradas - v_saidas
  );
END;
$$;

REVOKE ALL ON FUNCTION public.fin__hoje() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fin__dia(timestamptz) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fin__conta_da_forma(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fin__forma_do_pedido(text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fin__movimentos(date, date) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fin__saldos() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fin__caixa_calculo(uuid) FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4. Leitura
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fin_contas_listar()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Acesso negado.' USING ERRCODE = '42501';
  END IF;
  RETURN COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
      'id', c.id, 'nome', c.nome, 'tipo', c.tipo, 'saldo_inicial', c.saldo_inicial,
      'saldo_inicial_em', c.saldo_inicial_em, 'ativa', c.ativa, 'ordem', c.ordem,
      'sistema', c.sistema, 'saldo', round(s.saldo, 2)
    ) ORDER BY c.ordem, c.nome)
    FROM public.fin_contas c JOIN public.fin__saldos() s ON s.conta_id = c.id
  ), '[]'::jsonb);
END;
$$;

CREATE OR REPLACE FUNCTION public.fin_categorias_listar()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Acesso negado.' USING ERRCODE = '42501';
  END IF;
  RETURN COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
      'id', c.id, 'nome', c.nome, 'natureza', c.natureza, 'grupo_dre', c.grupo_dre,
      'ativa', c.ativa, 'sistema', c.sistema
    ) ORDER BY c.natureza DESC, c.ordem, c.nome)
    FROM public.fin_categorias c
  ), '[]'::jsonb);
END;
$$;

CREATE OR REPLACE FUNCTION public.fin_extrato(p_inicio date, p_fim date, p_conta_id uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Acesso negado.' USING ERRCODE = '42501';
  END IF;
  IF p_inicio IS NULL OR p_fim IS NULL OR p_fim < p_inicio OR p_fim - p_inicio > 400 THEN
    RAISE EXCEPTION 'Período inválido (até 400 dias).' USING ERRCODE = '22023';
  END IF;
  RETURN COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
      'id', m.id, 'origem', m.origem, 'tipo', m.tipo, 'status', m.status, 'valor', m.valor,
      'data', m.data, 'conta_id', m.conta_id, 'conta_nome', c.nome,
      'conta_destino_id', m.conta_destino_id, 'conta_destino_nome', cd.nome,
      'categoria_id', m.categoria_id, 'categoria_nome', cat.nome,
      'descricao', m.descricao, 'forma_pagamento', m.forma_pagamento,
      'pedido_id', m.pedido_id, 'vencimento', m.vencimento, 'editavel', m.editavel
    ) ORDER BY m.data DESC, m.status, m.id DESC)
    FROM public.fin__movimentos(p_inicio, p_fim) m
    LEFT JOIN public.fin_contas c ON c.id = m.conta_id
    LEFT JOIN public.fin_contas cd ON cd.id = m.conta_destino_id
    LEFT JOIN public.fin_categorias cat ON cat.id = m.categoria_id
   WHERE p_conta_id IS NULL OR m.conta_id = p_conta_id OR m.conta_destino_id = p_conta_id
  ), '[]'::jsonb);
END;
$$;

CREATE OR REPLACE FUNCTION public.fin_previstos(p_tipo text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_hoje date := public.fin__hoje();
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Acesso negado.' USING ERRCODE = '42501';
  END IF;
  IF p_tipo IS NULL OR p_tipo NOT IN ('entrada', 'saida') THEN
    RAISE EXCEPTION 'Tipo inválido: use entrada (a receber) ou saida (a pagar).' USING ERRCODE = '22023';
  END IF;
  RETURN COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
      'id', m.id, 'descricao', m.descricao, 'valor', m.valor,
      'vencimento', COALESCE(m.vencimento, m.data),
      'vencido', COALESCE(m.vencimento, m.data) < v_hoje,
      'conta_id', m.conta_id, 'conta_nome', c.nome,
      'categoria_id', m.categoria_id, 'categoria_nome', cat.nome,
      'parcela', m.parcela, 'parcelas', m.parcelas, 'origem', m.origem,
      'pedido_id', m.pedido_id, 'editavel', m.editavel
    ) ORDER BY COALESCE(m.vencimento, m.data), m.descricao)
    FROM public.fin__movimentos(NULL, NULL) m
    LEFT JOIN public.fin_contas c ON c.id = m.conta_id
    LEFT JOIN public.fin_categorias cat ON cat.id = m.categoria_id
   WHERE m.status = 'previsto' AND m.tipo = p_tipo
  ), '[]'::jsonb);
END;
$$;

CREATE OR REPLACE FUNCTION public.fin_resumo(p_inicio date, p_fim date)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_hoje date := public.fin__hoje();
  v_res jsonb;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Acesso negado.' USING ERRCODE = '42501';
  END IF;
  IF p_inicio IS NULL OR p_fim IS NULL OR p_fim < p_inicio OR p_fim - p_inicio > 400 THEN
    RAISE EXCEPTION 'Período inválido (até 400 dias).' USING ERRCODE = '22023';
  END IF;

  WITH periodo AS (
    SELECT * FROM public.fin__movimentos(p_inicio, p_fim) WHERE status = 'realizado'
  ), previstos AS (
    SELECT m.*, COALESCE(m.vencimento, m.data) AS venc
      FROM public.fin__movimentos(NULL, NULL) m WHERE m.status = 'previsto'
  ), saldos AS (
    SELECT c.id, c.nome, c.tipo, c.ativa, c.ordem, round(s.saldo, 2) AS saldo
      FROM public.fin_contas c JOIN public.fin__saldos() s ON s.conta_id = c.id
  )
  SELECT jsonb_build_object(
    'periodo', jsonb_build_object('inicio', p_inicio, 'fim', p_fim),
    'saldo_total', COALESCE((SELECT sum(saldo) FROM saldos WHERE ativa), 0),
    'contas', COALESCE((SELECT jsonb_agg(jsonb_build_object('id', id, 'nome', nome, 'tipo', tipo, 'saldo', saldo)
                          ORDER BY ordem, nome) FROM saldos WHERE ativa), '[]'::jsonb),
    'entradas', COALESCE((SELECT sum(valor) FROM periodo WHERE tipo = 'entrada'), 0),
    'saidas', COALESCE((SELECT sum(valor) FROM periodo WHERE tipo = 'saida'), 0),
    'resultado', COALESCE((SELECT sum(CASE WHEN tipo = 'entrada' THEN valor WHEN tipo = 'saida' THEN -valor ELSE 0 END)
                           FROM periodo), 0),
    'a_receber', jsonb_build_object(
      'total', COALESCE((SELECT sum(valor) FROM previstos WHERE tipo = 'entrada'), 0),
      'vencido', COALESCE((SELECT sum(valor) FROM previstos WHERE tipo = 'entrada' AND venc < v_hoje), 0),
      'proximos_7_dias', COALESCE((SELECT sum(valor) FROM previstos
                                    WHERE tipo = 'entrada' AND venc BETWEEN v_hoje AND v_hoje + 7), 0)),
    'a_pagar', jsonb_build_object(
      'total', COALESCE((SELECT sum(valor) FROM previstos WHERE tipo = 'saida'), 0),
      'vencido', COALESCE((SELECT sum(valor) FROM previstos WHERE tipo = 'saida' AND venc < v_hoje), 0),
      'proximos_7_dias', COALESCE((SELECT sum(valor) FROM previstos
                                    WHERE tipo = 'saida' AND venc BETWEEN v_hoje AND v_hoje + 7), 0)),
    'por_forma', COALESCE((SELECT jsonb_agg(jsonb_build_object('forma', forma, 'valor', total) ORDER BY total DESC)
                             FROM (SELECT forma_pagamento AS forma, sum(valor) AS total FROM periodo
                                    WHERE origem IN ('venda_online', 'venda_balcao', 'venda_entrega')
                                    GROUP BY forma_pagamento) f), '[]'::jsonb),
    'por_canal', jsonb_build_object(
      'online', COALESCE((SELECT sum(valor) FROM periodo WHERE origem IN ('venda_online', 'venda_entrega')), 0),
      'presencial', COALESCE((SELECT sum(valor) FROM periodo WHERE origem = 'venda_balcao'), 0)),
    'serie', COALESCE((SELECT jsonb_agg(jsonb_build_object(
                 'dia', d.dia::date,
                 'entradas', COALESCE((SELECT sum(valor) FROM periodo p WHERE p.data = d.dia::date AND p.tipo = 'entrada'), 0),
                 'saidas', COALESCE((SELECT sum(valor) FROM periodo p WHERE p.data = d.dia::date AND p.tipo = 'saida'), 0)
               ) ORDER BY d.dia)
               FROM generate_series(p_inicio::timestamp, p_fim::timestamp, interval '1 day') AS d(dia)), '[]'::jsonb),
    'caixa_aberto', (SELECT jsonb_build_object('id', s.id, 'conta_id', s.conta_id,
                                               'aberto_em', s.aberto_em, 'valor_abertura', s.valor_abertura)
                       FROM public.fin_caixa_sessoes s WHERE s.status = 'aberto'
                      ORDER BY s.aberto_em DESC LIMIT 1)
  ) INTO v_res;
  RETURN v_res;
END;
$$;

CREATE OR REPLACE FUNCTION public.fin_dre(p_inicio date, p_fim date)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_online numeric;
  v_balcao numeric;
  v_outras_receitas numeric;
  v_ded_derivadas numeric;
  v_ded_manuais numeric;
  v_deducoes numeric;
  v_cmv numeric;
  v_cmv_volta numeric;
  v_variaveis numeric;
  v_fixas numeric;
  v_financeiro numeric;
  v_bruta numeric;
  v_liquida numeric;
  v_lucro_bruto numeric;
  v_margem numeric;
  v_operacional numeric;
  v_linhas_manuais jsonb;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Acesso negado.' USING ERRCODE = '42501';
  END IF;
  IF p_inicio IS NULL OR p_fim IS NULL OR p_fim < p_inicio OR p_fim - p_inicio > 400 THEN
    RAISE EXCEPTION 'Período inválido (até 400 dias).' USING ERRCODE = '22023';
  END IF;

  -- Competência: derivados pela data do dinheiro; manuais pela competência,
  -- previstos inclusive (a despesa do mês pesa no mês, paga ou não). Estorno
  -- pendente ainda não é dedução. Uma consulta só (sem tabela temporária: a
  -- função roda também em transação só-leitura).
  WITH mov AS (
    SELECT * FROM public.fin__movimentos(NULL, NULL) m
     WHERE m.data_competencia BETWEEN p_inicio AND p_fim
       AND (m.status = 'realizado' OR (m.status = 'previsto' AND m.origem <> 'estorno'))
  ), manuais AS (
    SELECT m.tipo, m.valor, c.grupo_dre, c.nome
      FROM mov m JOIN public.fin_categorias c ON c.id = m.categoria_id
     WHERE m.origem IN ('manual', 'ajuste_caixa') AND m.tipo <> 'transferencia'
  )
  SELECT
    (SELECT COALESCE(sum(valor), 0) FROM mov WHERE origem IN ('venda_online', 'venda_entrega')),
    (SELECT COALESCE(sum(valor), 0) FROM mov WHERE origem = 'venda_balcao'),
    (SELECT COALESCE(sum(valor), 0) FROM mov WHERE origem IN ('estorno', 'estorno_externo', 'devolucao')),
    (SELECT COALESCE(sum(valor), 0) FROM manuais WHERE tipo = 'entrada' AND grupo_dre = 'receita'),
    (SELECT COALESCE(sum(valor), 0) FROM manuais WHERE tipo = 'saida' AND grupo_dre = 'deducao'),
    (SELECT COALESCE(sum(valor), 0) FROM manuais WHERE tipo = 'saida' AND grupo_dre = 'custo_variavel'),
    (SELECT COALESCE(sum(valor), 0) FROM manuais WHERE tipo = 'saida' AND grupo_dre = 'despesa_fixa'),
    (SELECT COALESCE(sum(CASE WHEN tipo = 'entrada' THEN valor ELSE -valor END), 0)
       FROM manuais WHERE grupo_dre = 'financeiro'),
    -- CMV estimado pelo custo ATUAL do produto (o app não guarda custo
    -- histórico), menos o que voltou para a prateleira por devolução no período.
    (SELECT COALESCE(sum(oi.quantity * COALESCE(p.custo, 0)), 0)
       FROM mov m
       JOIN public.marketplace_order_items oi ON oi.order_id = m.pedido_id
       LEFT JOIN public.produtos p ON p.id = oi.product_id
      WHERE m.origem IN ('venda_online', 'venda_balcao', 'venda_entrega')),
    (SELECT COALESCE(sum(di.quantidade * COALESCE(p.custo, 0)), 0)
       FROM public.devolucao_itens di
       LEFT JOIN public.produtos p ON p.id = di.product_id
      WHERE di.reestocado_em IS NOT NULL
        AND public.fin__dia(di.reestocado_em) BETWEEN p_inicio AND p_fim),
    (SELECT COALESCE(jsonb_agg(jsonb_build_object('grupo', g.grupo_dre, 'categoria', g.nome, 'valor', g.total)
                               ORDER BY g.ordem, g.total DESC), '[]'::jsonb)
       FROM (SELECT grupo_dre, nome, sum(valor) AS total,
                    CASE grupo_dre WHEN 'receita' THEN 1 WHEN 'deducao' THEN 2 WHEN 'custo_variavel' THEN 4
                                   WHEN 'despesa_fixa' THEN 5 ELSE 6 END AS ordem
               FROM manuais WHERE grupo_dre <> 'fora_dre'
              GROUP BY grupo_dre, nome) g)
    INTO v_online, v_balcao, v_ded_derivadas, v_outras_receitas, v_ded_manuais,
         v_variaveis, v_fixas, v_financeiro, v_cmv, v_cmv_volta, v_linhas_manuais;

  v_cmv := GREATEST(v_cmv - v_cmv_volta, 0);
  v_deducoes := v_ded_derivadas + v_ded_manuais;
  v_bruta := v_online + v_balcao + v_outras_receitas;
  v_liquida := v_bruta - v_deducoes;
  v_lucro_bruto := v_liquida - v_cmv;
  v_margem := v_lucro_bruto - v_variaveis;
  v_operacional := v_margem - v_fixas;

  RETURN jsonb_build_object(
    'receita_bruta', v_bruta,
    'receita_online', v_online,
    'receita_balcao', v_balcao,
    'deducoes', v_deducoes,
    'receita_liquida', v_liquida,
    'cmv', v_cmv,
    'cmv_estimado', true,
    'lucro_bruto', v_lucro_bruto,
    'custos_variaveis', v_variaveis,
    'margem_contribuicao', v_margem,
    'despesas_fixas', v_fixas,
    'resultado_operacional', v_operacional,
    'resultado_financeiro', v_financeiro,
    'lucro_liquido', v_operacional + v_financeiro,
    'linhas',
      (SELECT COALESCE(jsonb_agg(l - 'ordem' ORDER BY (l ->> 'ordem')::int), '[]'::jsonb) FROM (
         SELECT jsonb_build_object('grupo', 'receita', 'categoria', 'Vendas pelo app', 'valor', v_online, 'ordem', 1) AS l
          WHERE v_online > 0
         UNION ALL SELECT jsonb_build_object('grupo', 'receita', 'categoria', 'Vendas na loja física', 'valor', v_balcao, 'ordem', 1)
          WHERE v_balcao > 0
         UNION ALL SELECT jsonb_build_object('grupo', 'deducao', 'categoria', 'Estornos e devoluções', 'valor', v_ded_derivadas, 'ordem', 2)
          WHERE v_ded_derivadas > 0
         UNION ALL SELECT jsonb_build_object('grupo', 'cmv', 'categoria', 'Custo das mercadorias vendidas', 'valor', v_cmv, 'ordem', 3)
          WHERE v_cmv > 0
       ) x) || v_linhas_manuais
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.assinatura_da_loja_ler()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Acesso negado.' USING ERRCODE = '42501';
  END IF;
  RETURN (SELECT to_jsonb(a) - 'id' - 'observacao' FROM public.assinatura_da_loja a WHERE a.id = 1);
END;
$$;

-- ---------------------------------------------------------------------------
-- 5. Escrita: contas, categorias, lançamentos
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fin_conta_salvar(p jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_id uuid := NULLIF(p ->> 'id', '')::uuid;
  v_atual public.fin_contas%ROWTYPE;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Acesso negado.' USING ERRCODE = '42501';
  END IF;
  IF v_id IS NULL THEN
    INSERT INTO public.fin_contas (nome, tipo, saldo_inicial, saldo_inicial_em, ativa, ordem)
    VALUES (btrim(p ->> 'nome'), p ->> 'tipo',
            COALESCE((p ->> 'saldo_inicial')::numeric, 0),
            COALESCE((p ->> 'saldo_inicial_em')::date, public.fin__hoje()),
            COALESCE((p ->> 'ativa')::boolean, true),
            COALESCE((p ->> 'ordem')::integer, 10))
    RETURNING id INTO v_id;
    RETURN jsonb_build_object('id', v_id);
  END IF;

  SELECT * INTO v_atual FROM public.fin_contas WHERE id = v_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Conta não encontrada.' USING ERRCODE = 'P0002';
  END IF;
  IF v_atual.sistema AND p ? 'tipo' AND p ->> 'tipo' IS DISTINCT FROM v_atual.tipo THEN
    RAISE EXCEPTION 'As contas da loja não mudam de tipo.' USING ERRCODE = '22023';
  END IF;
  IF v_atual.sistema AND p ? 'ativa' AND NOT (p ->> 'ativa')::boolean THEN
    RAISE EXCEPTION 'As contas da loja recebem as vendas e não podem ser desativadas.' USING ERRCODE = '22023';
  END IF;
  UPDATE public.fin_contas SET
    nome = CASE WHEN p ? 'nome' THEN btrim(p ->> 'nome') ELSE nome END,
    tipo = CASE WHEN p ? 'tipo' THEN p ->> 'tipo' ELSE tipo END,
    saldo_inicial = CASE WHEN p ? 'saldo_inicial' THEN (p ->> 'saldo_inicial')::numeric ELSE saldo_inicial END,
    saldo_inicial_em = CASE WHEN p ? 'saldo_inicial_em' THEN (p ->> 'saldo_inicial_em')::date ELSE saldo_inicial_em END,
    ativa = CASE WHEN p ? 'ativa' THEN (p ->> 'ativa')::boolean ELSE ativa END,
    ordem = CASE WHEN p ? 'ordem' THEN (p ->> 'ordem')::integer ELSE ordem END,
    updated_at = now()
  WHERE id = v_id;
  RETURN jsonb_build_object('id', v_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.fin_categoria_salvar(p jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_id uuid := NULLIF(p ->> 'id', '')::uuid;
  v_atual public.fin_categorias%ROWTYPE;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Acesso negado.' USING ERRCODE = '42501';
  END IF;
  IF v_id IS NULL THEN
    INSERT INTO public.fin_categorias (nome, natureza, grupo_dre, ativa, ordem)
    VALUES (btrim(p ->> 'nome'), p ->> 'natureza', p ->> 'grupo_dre',
            COALESCE((p ->> 'ativa')::boolean, true), COALESCE((p ->> 'ordem')::integer, 50))
    RETURNING id INTO v_id;
    RETURN jsonb_build_object('id', v_id);
  END IF;
  SELECT * INTO v_atual FROM public.fin_categorias WHERE id = v_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Categoria não encontrada.' USING ERRCODE = 'P0002';
  END IF;
  -- "Vendas" e "Devoluções e estornos" recebem os movimentos derivados.
  IF v_atual.id IN ('f2000000-0000-4000-8000-000000000001', 'f2000000-0000-4000-8000-000000000010')
     AND (p ? 'natureza' OR p ? 'grupo_dre' OR (p ? 'ativa' AND NOT (p ->> 'ativa')::boolean)) THEN
    RAISE EXCEPTION 'Esta categoria recebe as vendas e os estornos automaticamente: só o nome pode mudar.'
      USING ERRCODE = '22023';
  END IF;
  UPDATE public.fin_categorias SET
    nome = CASE WHEN p ? 'nome' THEN btrim(p ->> 'nome') ELSE nome END,
    natureza = CASE WHEN p ? 'natureza' THEN p ->> 'natureza' ELSE natureza END,
    grupo_dre = CASE WHEN p ? 'grupo_dre' THEN p ->> 'grupo_dre' ELSE grupo_dre END,
    ativa = CASE WHEN p ? 'ativa' THEN (p ->> 'ativa')::boolean ELSE ativa END,
    ordem = CASE WHEN p ? 'ordem' THEN (p ->> 'ordem')::integer ELSE ordem END
  WHERE id = v_id;
  RETURN jsonb_build_object('id', v_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.fin_lancamento_salvar(p jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_hoje date := public.fin__hoje();
  v_id uuid := NULLIF(p ->> 'id', '')::uuid;
  v_tipo text := p ->> 'tipo';
  v_status text := COALESCE(p ->> 'status', 'realizado');
  v_valor numeric(12, 2);
  v_conta public.fin_contas%ROWTYPE;
  v_destino public.fin_contas%ROWTYPE;
  v_cat public.fin_categorias%ROWTYPE;
  v_desc text := btrim(COALESCE(p ->> 'descricao', ''));
  v_forma text := NULLIF(p ->> 'forma_pagamento', '');
  v_comp date;
  v_venc date;
  v_real date;
  v_parcelas integer := COALESCE((p ->> 'parcelas')::integer, 1);
  v_grupo uuid;
  v_valor_parcela numeric(12, 2);
  v_ids uuid[] := '{}';
  v_novo uuid;
  v_sessao uuid;
  v_atual public.fin_lancamentos%ROWTYPE;
  i integer;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Acesso negado.' USING ERRCODE = '42501';
  END IF;
  IF p IS NULL OR jsonb_typeof(p) <> 'object' THEN
    RAISE EXCEPTION 'Lançamento inválido.' USING ERRCODE = '22023';
  END IF;
  IF v_tipo IS NULL OR v_tipo NOT IN ('entrada', 'saida', 'transferencia') THEN
    RAISE EXCEPTION 'Escolha: receita, despesa ou transferência.' USING ERRCODE = '22023';
  END IF;
  IF v_status NOT IN ('previsto', 'realizado') THEN
    RAISE EXCEPTION 'Status inválido.' USING ERRCODE = '22023';
  END IF;
  BEGIN
    v_valor := round((p ->> 'valor')::numeric, 2);
  EXCEPTION WHEN OTHERS THEN
    RAISE EXCEPTION 'Valor inválido.' USING ERRCODE = '22023';
  END;
  IF v_valor IS NULL OR v_valor <= 0 OR v_valor > 9999999999.99 THEN
    RAISE EXCEPTION 'Informe um valor maior que zero.' USING ERRCODE = '22023';
  END IF;
  IF char_length(v_desc) NOT BETWEEN 1 AND 140 THEN
    RAISE EXCEPTION 'Descreva o lançamento (até 140 caracteres).' USING ERRCODE = '22023';
  END IF;
  IF v_parcelas NOT BETWEEN 1 AND 48 THEN
    RAISE EXCEPTION 'Parcelas de 1 a 48.' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_conta FROM public.fin_contas WHERE id = NULLIF(p ->> 'conta_id', '')::uuid;
  IF NOT FOUND OR NOT v_conta.ativa THEN
    RAISE EXCEPTION 'Escolha uma conta ativa.' USING ERRCODE = '22023';
  END IF;
  IF v_tipo = 'transferencia' THEN
    SELECT * INTO v_destino FROM public.fin_contas WHERE id = NULLIF(p ->> 'conta_destino_id', '')::uuid;
    IF NOT FOUND OR NOT v_destino.ativa OR v_destino.id = v_conta.id THEN
      RAISE EXCEPTION 'Escolha a conta de destino (diferente da de origem).' USING ERRCODE = '22023';
    END IF;
  ELSE
    SELECT * INTO v_cat FROM public.fin_categorias WHERE id = NULLIF(p ->> 'categoria_id', '')::uuid;
    IF NOT FOUND OR NOT v_cat.ativa THEN
      RAISE EXCEPTION 'Escolha uma categoria.' USING ERRCODE = '22023';
    END IF;
    IF (v_tipo = 'entrada') <> (v_cat.natureza = 'receita') THEN
      RAISE EXCEPTION 'A categoria não combina com o tipo do lançamento.' USING ERRCODE = '22023';
    END IF;
  END IF;
  IF v_forma IS NOT NULL AND v_forma NOT IN ('pix', 'credito', 'debito', 'cartao', 'dinheiro', 'boleto', 'transferencia', 'outro') THEN
    RAISE EXCEPTION 'Forma de pagamento inválida.' USING ERRCODE = '22023';
  END IF;

  v_comp := COALESCE(NULLIF(p ->> 'data_competencia', '')::date, v_hoje);
  v_venc := COALESCE(NULLIF(p ->> 'data_vencimento', '')::date, v_comp);
  v_real := CASE WHEN v_status = 'realizado' THEN COALESCE(NULLIF(p ->> 'data_realizacao', '')::date, v_hoje) END;
  IF v_real IS NOT NULL AND v_real > v_hoje THEN
    RAISE EXCEPTION 'Lançamento já pago/recebido não pode ter data no futuro. Use "a pagar/a receber".'
      USING ERRCODE = '22023';
  END IF;

  -- Movimento de hoje na conta de um caixa aberto entra na conferência dele.
  IF v_status = 'realizado' AND v_real = v_hoje THEN
    SELECT s.id INTO v_sessao FROM public.fin_caixa_sessoes s
     WHERE s.status = 'aberto' AND (s.conta_id = v_conta.id OR (v_tipo = 'transferencia' AND s.conta_id = v_destino.id))
     ORDER BY s.aberto_em DESC LIMIT 1;
  END IF;

  IF v_id IS NOT NULL THEN
    -- Edição: só o previsto manual; realizado se cancela e lança de novo.
    SELECT * INTO v_atual FROM public.fin_lancamentos WHERE id = v_id FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Lançamento não encontrado.' USING ERRCODE = 'P0002';
    END IF;
    IF v_atual.status <> 'previsto' OR v_atual.origem <> 'manual' THEN
      RAISE EXCEPTION 'Só um lançamento a pagar/receber pode ser editado. Para corrigir um já realizado, cancele e lance de novo.'
        USING ERRCODE = '22023';
    END IF;
    UPDATE public.fin_lancamentos SET
      tipo = v_tipo, status = v_status, valor = v_valor, conta_id = v_conta.id,
      conta_destino_id = CASE WHEN v_tipo = 'transferencia' THEN v_destino.id END,
      categoria_id = CASE WHEN v_tipo = 'transferencia' THEN NULL ELSE v_cat.id END,
      descricao = v_desc, forma_pagamento = v_forma, data_competencia = v_comp,
      data_vencimento = v_venc, data_realizacao = v_real, caixa_sessao_id = v_sessao,
      observacao = NULLIF(btrim(COALESCE(p ->> 'observacao', '')), ''), updated_at = now()
    WHERE id = v_id;
    RETURN jsonb_build_object('ids', jsonb_build_array(v_id));
  END IF;

  v_grupo := CASE WHEN v_parcelas > 1 THEN gen_random_uuid() END;
  v_valor_parcela := trunc(v_valor / v_parcelas, 2);
  FOR i IN 1..v_parcelas LOOP
    INSERT INTO public.fin_lancamentos (
      tipo, status, valor, conta_id, conta_destino_id, categoria_id, descricao, forma_pagamento,
      data_competencia, data_vencimento, data_realizacao, grupo_parcelas, parcela, parcelas,
      caixa_sessao_id, observacao, criado_por
    ) VALUES (
      v_tipo,
      CASE WHEN i = 1 THEN v_status ELSE 'previsto' END,
      CASE WHEN i = v_parcelas THEN v_valor - v_valor_parcela * (v_parcelas - 1) ELSE v_valor_parcela END,
      v_conta.id,
      CASE WHEN v_tipo = 'transferencia' THEN v_destino.id END,
      CASE WHEN v_tipo = 'transferencia' THEN NULL ELSE v_cat.id END,
      CASE WHEN v_parcelas > 1 THEN left(v_desc, 128) || ' (' || i || '/' || v_parcelas || ')' ELSE v_desc END,
      v_forma,
      (v_comp + make_interval(months => i - 1))::date,
      (v_venc + make_interval(months => i - 1))::date,
      CASE WHEN i = 1 THEN v_real END,
      v_grupo,
      CASE WHEN v_parcelas > 1 THEN i END,
      CASE WHEN v_parcelas > 1 THEN v_parcelas END,
      CASE WHEN i = 1 THEN v_sessao END,
      NULLIF(btrim(COALESCE(p ->> 'observacao', '')), ''),
      auth.uid()
    ) RETURNING id INTO v_novo;
    v_ids := v_ids || v_novo;
  END LOOP;
  RETURN jsonb_build_object('ids', to_jsonb(v_ids));
END;
$$;

CREATE OR REPLACE FUNCTION public.fin_lancamento_baixar(p_id uuid, p_data date DEFAULT NULL, p_conta_id uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_l public.fin_lancamentos%ROWTYPE;
  v_data date := COALESCE(p_data, public.fin__hoje());
  v_conta uuid;
  v_sessao uuid;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Acesso negado.' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_l FROM public.fin_lancamentos WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Lançamento não encontrado.' USING ERRCODE = 'P0002';
  END IF;
  IF v_l.status <> 'previsto' THEN
    RAISE EXCEPTION 'Este lançamento já foi baixado ou cancelado.' USING ERRCODE = '22023';
  END IF;
  IF v_data > public.fin__hoje() THEN
    RAISE EXCEPTION 'A baixa não pode ter data no futuro.' USING ERRCODE = '22023';
  END IF;
  v_conta := COALESCE(p_conta_id, v_l.conta_id);
  IF NOT EXISTS (SELECT 1 FROM public.fin_contas c WHERE c.id = v_conta AND c.ativa) THEN
    RAISE EXCEPTION 'Escolha uma conta ativa.' USING ERRCODE = '22023';
  END IF;
  IF v_conta = v_l.conta_destino_id THEN
    RAISE EXCEPTION 'A conta de origem precisa ser diferente da de destino.' USING ERRCODE = '22023';
  END IF;
  IF v_data = public.fin__hoje() THEN
    SELECT s.id INTO v_sessao FROM public.fin_caixa_sessoes s
     WHERE s.status = 'aberto' AND (s.conta_id = v_conta OR s.conta_id = v_l.conta_destino_id)
     ORDER BY s.aberto_em DESC LIMIT 1;
  END IF;
  UPDATE public.fin_lancamentos
     SET status = 'realizado', data_realizacao = v_data, conta_id = v_conta,
         caixa_sessao_id = v_sessao, updated_at = now()
   WHERE id = p_id;
  RETURN jsonb_build_object('id', p_id, 'status', 'realizado');
END;
$$;

CREATE OR REPLACE FUNCTION public.fin_lancamento_cancelar(p_id uuid, p_motivo text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_l public.fin_lancamentos%ROWTYPE;
  v_motivo text := NULLIF(btrim(COALESCE(p_motivo, '')), '');
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Acesso negado.' USING ERRCODE = '42501';
  END IF;
  IF v_motivo IS NULL OR char_length(v_motivo) > 300 THEN
    RAISE EXCEPTION 'Diga por que o lançamento está sendo cancelado.' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v_l FROM public.fin_lancamentos WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Lançamento não encontrado.' USING ERRCODE = 'P0002';
  END IF;
  IF v_l.status = 'cancelado' THEN
    RAISE EXCEPTION 'Este lançamento já está cancelado.' USING ERRCODE = '22023';
  END IF;
  -- Caixa fechado é conferência encerrada: não se reescreve.
  IF v_l.caixa_sessao_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.fin_caixa_sessoes s WHERE s.id = v_l.caixa_sessao_id AND s.status = 'fechado'
  ) THEN
    RAISE EXCEPTION 'Este movimento faz parte de um caixa já fechado e não pode ser cancelado.' USING ERRCODE = '22023';
  END IF;
  UPDATE public.fin_lancamentos
     SET status = 'cancelado', cancelado_em = now(), cancelado_por = auth.uid(),
         motivo_cancelamento = v_motivo, updated_at = now()
   WHERE id = p_id;
  RETURN jsonb_build_object('id', p_id, 'status', 'cancelado');
END;
$$;

-- ---------------------------------------------------------------------------
-- 6. Caixa da loja física
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fin_caixa_atual()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_s public.fin_caixa_sessoes%ROWTYPE;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Acesso negado.' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_s FROM public.fin_caixa_sessoes WHERE status = 'aberto' ORDER BY aberto_em DESC LIMIT 1;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;
  RETURN jsonb_build_object(
    'id', v_s.id, 'conta_id', v_s.conta_id,
    'conta_nome', (SELECT nome FROM public.fin_contas WHERE id = v_s.conta_id),
    'aberto_em', v_s.aberto_em, 'valor_abertura', v_s.valor_abertura
  ) || public.fin__caixa_calculo(v_s.id) || jsonb_build_object(
    'movimentos', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', l.id, 'origem', l.origem, 'tipo', l.tipo, 'valor', l.valor, 'descricao', l.descricao,
        'entra', (l.tipo = 'entrada' OR l.conta_destino_id = v_s.conta_id), 'criado_em', l.created_at
      ) ORDER BY l.created_at DESC)
      FROM public.fin_lancamentos l
     WHERE l.caixa_sessao_id = v_s.id AND l.status = 'realizado'), '[]'::jsonb)
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.fin_caixa_abrir(p_valor_abertura numeric, p_conta_id uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_conta public.fin_contas%ROWTYPE;
  v_saldo numeric;
  v_valor numeric(12, 2) := round(p_valor_abertura, 2);
  v_id uuid;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Acesso negado.' USING ERRCODE = '42501';
  END IF;
  IF v_valor IS NULL OR v_valor < 0 THEN
    RAISE EXCEPTION 'Informe quanto dinheiro há no caixa (pode ser zero).' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v_conta FROM public.fin_contas
   WHERE id = COALESCE(p_conta_id, 'f1000000-0000-4000-8000-000000000001'::uuid) FOR UPDATE;
  IF NOT FOUND OR NOT v_conta.ativa OR v_conta.tipo <> 'caixa' THEN
    RAISE EXCEPTION 'Escolha uma conta do tipo caixa.' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (SELECT 1 FROM public.fin_caixa_sessoes WHERE conta_id = v_conta.id AND status = 'aberto') THEN
    RAISE EXCEPTION 'Este caixa já está aberto.' USING ERRCODE = '23505';
  END IF;

  -- O que foi contado manda: a diferença para o saldo do sistema vira ajuste,
  -- para a conta Caixa refletir a gaveta de verdade.
  SELECT s.saldo INTO v_saldo FROM public.fin__saldos() s WHERE s.conta_id = v_conta.id;
  IF round(v_valor - COALESCE(v_saldo, 0), 2) <> 0 THEN
    INSERT INTO public.fin_lancamentos (
      tipo, status, valor, conta_id, categoria_id, descricao, forma_pagamento,
      data_competencia, data_vencimento, data_realizacao, origem, criado_por
    ) VALUES (
      CASE WHEN v_valor > COALESCE(v_saldo, 0) THEN 'entrada' ELSE 'saida' END,
      'realizado', abs(round(v_valor - COALESCE(v_saldo, 0), 2)), v_conta.id,
      CASE WHEN v_valor > COALESCE(v_saldo, 0) THEN 'f2000000-0000-4000-8000-000000000005'::uuid
           ELSE 'f2000000-0000-4000-8000-000000000031'::uuid END,
      'Ajuste na abertura do caixa (contado x sistema)', 'dinheiro',
      public.fin__hoje(), public.fin__hoje(), public.fin__hoje(), 'ajuste_caixa', auth.uid()
    );
  END IF;

  INSERT INTO public.fin_caixa_sessoes (conta_id, valor_abertura, aberto_por)
  VALUES (v_conta.id, v_valor, auth.uid())
  RETURNING id INTO v_id;
  RETURN jsonb_build_object('id', v_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.fin_caixa_movimentar(
  p_tipo text, p_valor numeric, p_descricao text, p_conta_contrapartida uuid DEFAULT NULL
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_s public.fin_caixa_sessoes%ROWTYPE;
  v_contra public.fin_contas%ROWTYPE;
  v_valor numeric(12, 2) := round(p_valor, 2);
  v_esperado numeric;
  v_id uuid;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Acesso negado.' USING ERRCODE = '42501';
  END IF;
  IF p_tipo IS NULL OR p_tipo NOT IN ('sangria', 'suprimento') THEN
    RAISE EXCEPTION 'Use sangria (tirar do caixa) ou suprimento (colocar no caixa).' USING ERRCODE = '22023';
  END IF;
  IF v_valor IS NULL OR v_valor <= 0 THEN
    RAISE EXCEPTION 'Informe um valor maior que zero.' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v_s FROM public.fin_caixa_sessoes WHERE status = 'aberto' ORDER BY aberto_em DESC LIMIT 1 FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Abra o caixa antes de movimentar.' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v_contra FROM public.fin_contas
   WHERE id = COALESCE(p_conta_contrapartida, 'f1000000-0000-4000-8000-000000000002'::uuid);
  IF NOT FOUND OR NOT v_contra.ativa OR v_contra.id = v_s.conta_id THEN
    RAISE EXCEPTION 'Escolha para qual conta o dinheiro vai (ou de onde vem).' USING ERRCODE = '22023';
  END IF;
  IF p_tipo = 'sangria' THEN
    v_esperado := (public.fin__caixa_calculo(v_s.id) ->> 'esperado')::numeric;
    IF v_valor > v_esperado THEN
      RAISE EXCEPTION 'A sangria (R$ %) é maior que o dinheiro esperado no caixa (R$ %).', v_valor, v_esperado
        USING ERRCODE = '22023';
    END IF;
  END IF;
  INSERT INTO public.fin_lancamentos (
    tipo, status, valor, conta_id, conta_destino_id, descricao, forma_pagamento,
    data_competencia, data_vencimento, data_realizacao, origem, caixa_sessao_id, criado_por
  ) VALUES (
    'transferencia', 'realizado', v_valor,
    CASE WHEN p_tipo = 'sangria' THEN v_s.conta_id ELSE v_contra.id END,
    CASE WHEN p_tipo = 'sangria' THEN v_contra.id ELSE v_s.conta_id END,
    COALESCE(NULLIF(btrim(COALESCE(p_descricao, '')), ''),
             CASE WHEN p_tipo = 'sangria' THEN 'Sangria do caixa' ELSE 'Suprimento do caixa' END),
    'dinheiro', public.fin__hoje(), public.fin__hoje(), public.fin__hoje(), p_tipo, v_s.id, auth.uid()
  ) RETURNING id INTO v_id;
  RETURN jsonb_build_object('id', v_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.fin_caixa_fechar(p_valor_contado numeric, p_observacao text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_s public.fin_caixa_sessoes%ROWTYPE;
  v_contado numeric(12, 2) := round(p_valor_contado, 2);
  v_esperado numeric(12, 2);
  v_dif numeric(12, 2);
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Acesso negado.' USING ERRCODE = '42501';
  END IF;
  IF v_contado IS NULL OR v_contado < 0 THEN
    RAISE EXCEPTION 'Informe quanto dinheiro foi contado no caixa.' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v_s FROM public.fin_caixa_sessoes WHERE status = 'aberto' ORDER BY aberto_em DESC LIMIT 1 FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Não há caixa aberto.' USING ERRCODE = '22023';
  END IF;
  v_esperado := round((public.fin__caixa_calculo(v_s.id) ->> 'esperado')::numeric, 2);
  v_dif := v_contado - v_esperado;

  IF v_dif <> 0 THEN
    INSERT INTO public.fin_lancamentos (
      tipo, status, valor, conta_id, categoria_id, descricao, forma_pagamento,
      data_competencia, data_vencimento, data_realizacao, origem, caixa_sessao_id, criado_por
    ) VALUES (
      CASE WHEN v_dif > 0 THEN 'entrada' ELSE 'saida' END, 'realizado', abs(v_dif), v_s.conta_id,
      CASE WHEN v_dif > 0 THEN 'f2000000-0000-4000-8000-000000000005'::uuid
           ELSE 'f2000000-0000-4000-8000-000000000031'::uuid END,
      CASE WHEN v_dif > 0 THEN 'Sobra de caixa no fechamento' ELSE 'Quebra de caixa no fechamento' END,
      'dinheiro', public.fin__hoje(), public.fin__hoje(), public.fin__hoje(), 'ajuste_caixa', v_s.id, auth.uid()
    );
  END IF;

  UPDATE public.fin_caixa_sessoes
     SET status = 'fechado', fechado_em = now(), fechado_por = auth.uid(),
         valor_contado = v_contado, valor_esperado = v_esperado, diferenca = v_dif,
         observacao = NULLIF(btrim(COALESCE(p_observacao, '')), '')
   WHERE id = v_s.id;
  RETURN jsonb_build_object('id', v_s.id, 'esperado', v_esperado, 'contado', v_contado, 'diferenca', v_dif);
END;
$$;

CREATE OR REPLACE FUNCTION public.fin_caixa_historico(p_limite integer DEFAULT 30)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Acesso negado.' USING ERRCODE = '42501';
  END IF;
  RETURN COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
      'id', s.id, 'conta_nome', c.nome, 'aberto_em', s.aberto_em, 'fechado_em', s.fechado_em,
      'valor_abertura', s.valor_abertura, 'esperado', s.valor_esperado, 'contado', s.valor_contado,
      'diferenca', s.diferenca, 'status', s.status
    ) ORDER BY s.aberto_em DESC)
    FROM (SELECT * FROM public.fin_caixa_sessoes ORDER BY aberto_em DESC
           LIMIT LEAST(GREATEST(COALESCE(p_limite, 30), 1), 200)) s
    JOIN public.fin_contas c ON c.id = s.conta_id
  ), '[]'::jsonb);
END;
$$;

-- Grants: o gate de admin mora dentro de cada função.
DO $grants$
DECLARE
  v_sig text;
BEGIN
  FOREACH v_sig IN ARRAY ARRAY[
    'public.fin_contas_listar()',
    'public.fin_categorias_listar()',
    'public.fin_extrato(date, date, uuid)',
    'public.fin_previstos(text)',
    'public.fin_resumo(date, date)',
    'public.fin_dre(date, date)',
    'public.assinatura_da_loja_ler()',
    'public.fin_conta_salvar(jsonb)',
    'public.fin_categoria_salvar(jsonb)',
    'public.fin_lancamento_salvar(jsonb)',
    'public.fin_lancamento_baixar(uuid, date, uuid)',
    'public.fin_lancamento_cancelar(uuid, text)',
    'public.fin_caixa_atual()',
    'public.fin_caixa_abrir(numeric, uuid)',
    'public.fin_caixa_movimentar(text, numeric, text, uuid)',
    'public.fin_caixa_fechar(numeric, text)',
    'public.fin_caixa_historico(integer)'
  ] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon', v_sig);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated', v_sig);
  END LOOP;
END
$grants$;
