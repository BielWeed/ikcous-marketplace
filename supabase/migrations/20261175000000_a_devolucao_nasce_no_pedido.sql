-- A DEVOLUÇÃO NASCE NO PEDIDO (26/09/2026 — plano
-- docs/superpowers/plans/2026-09-26-painel-cartao-e-devolucoes.md, tarefa 1;
-- spec docs/superpowers/specs/2026-09-26-devolucoes-design.md).
--
-- O QUE FALTAVA: "devolução" no app era só dinheiro (ledger order_refunds) e a
-- confirmação de que o produto voltou num pedido cancelado depois do envio.
-- O cliente não tinha como pedir para devolver um produto ENTREGUE — a própria
-- update_order_status_atomic diz "entregue nao — produto entregue e'
-- devolucao, que e' outro assunto". O CDC exige esse canal (art. 49:
-- arrependimento em 7 dias da compra fora da loja física; arts. 18 e 26:
-- defeito) e o Decreto 7.962/2013 exige que ele seja o mesmo canal da compra,
-- com confirmação imediata. A P3 do AGENTS.md pede que a política seja de cada
-- lojista, configurável no painel.
--
-- O QUE ESTA MIGRATION FAZ, NA ORDEM:
--   1. `politica_devolucao` (uma linha, id=1): prazos (arrependimento >= 7 e
--      vício >= 30 por CHECK — o painel não deixa o lojista ficar abaixo da
--      lei), troca/vale, fotos, métodos locais/nacionais, texto da política.
--      Leitura pública (é a política que a loja mostra); escrita só pela RPC
--      `salvar_politica_de_devolucao` (admin).
--   2. `devolucoes` + `devolucao_itens` + `devolucao_eventos`: o pedido de
--      devolução, os itens (com snapshot do preço pago e a inspeção por item)
--      e a trilha de cada mudança (art. 26 §2º I: a recusa precisa ser
--      explícita e registrada). RLS: dono lê o que é seu, admin lê tudo;
--      NINGUÉM escreve por PostgREST — só pelas RPCs abaixo (e o service role
--      da edge de etiqueta reversa).
--   3. Bucket PRIVADO `devolucoes` (fotos do cliente): o cliente só grava na
--      própria pasta `<uid>/...`; lê o dono e o admin.
--   4. RPCs do cliente: `devolucao_elegibilidade`, `solicitar_devolucao`,
--      `cancelar_devolucao`, `informar_envio_devolucao`, `devolucoes_do_pedido`,
--      `devolucao_detalhe`. O TIPO (arrependimento / vício / troca), o prazo,
--      o método aceito, os itens e o valor saem do SERVIDOR — o cliente só
--      escolhe itens, motivo, resolução e método dentro do que a política e a
--      lei permitem.
--   5. RPCs do lojista: `admin_devolucoes_listar`, `admin_devolucao_decidir`,
--      `admin_devolucao_registrar`, `admin_devolucao_concluir`,
--      `admin_devolucao_reprovar`. A máquina de estados é validada aqui, com
--      FOR UPDATE — nunca pelo status que o front manda.
--      `admin_devolucao_concluir` reestoca POR ITEM (só o que a inspeção
--      marcou), no máximo uma vez (`reestocado_em`), e, quando a resolução é
--      reembolso de pedido pago pelo app, abre a linha no ledger
--      `order_refunds` (mesma trava de saldo da `solicitar_estorno`) para a
--      edge `estornar-pagamento` executar — o mesmo caminho do estorno.
--      Pedido pago na entrega/balcão: reembolso manual registrado (o
--      Financeiro mostra a saída).
--   6. Gatilho `tr_devolucao_avisa_o_cliente`: cada mudança de status vira
--      aviso em `notificacoes` (best-effort, mesmo esqueleto do
--      tr_pedido_avisa_o_cliente).
--
-- DADOS EXISTENTES: nenhuma tabela existente é reescrita. A única linha
-- semeada é a política padrão (id=1, ON CONFLICT DO NOTHING).
--
-- IDEMPOTÊNCIA: CREATE TABLE IF NOT EXISTS, CREATE OR REPLACE FUNCTION,
-- DROP POLICY/TRIGGER IF EXISTS antes de criar, ON CONFLICT DO NOTHING no
-- bucket e na política.
--
-- FORA DO ESCOPO: criar o pedido de TROCA (a loja registra a nova venda pelo
-- balcão/pedido — a devolução guarda a resolução); o vale-troca como saldo
-- (a resolução fica registrada; o crédito em carteira é outra frente); a
-- compra da etiqueta reversa (edge melhor-envio-etiqueta, ação
-- gerar_devolucao_reversa, grava me_reverse_id/codigo_postagem pelo service
-- role).
--
-- COMO APLICAR: `node scripts/db-apply.cjs <este arquivo>` (sem BEGIN/COMMIT
-- de nível superior — regra da casa).
--
-- FICHA DE VERIFICAÇÃO pós-aplicação:
--   1. SELECT * FROM public.politica_devolucao;  -- 1 linha, prazos 7/30/90
--   2. SELECT relrowsecurity FROM pg_class WHERE relname IN
--        ('politica_devolucao','devolucoes','devolucao_itens','devolucao_eventos');
--      -- esperado: 4 x true
--   3. SELECT id, public FROM storage.buckets WHERE id='devolucoes';  -- false
--   4. SELECT proname, prosecdef FROM pg_proc WHERE proname LIKE '%devolucao%';
--
-- ROLLBACK MANUAL: rollback-manual-20261175000000_a_devolucao_nasce_no_pedido.sql
-- (dropa gatilho, RPCs, policies e as tabelas — APAGA as devoluções
-- registradas; o bucket fica, com os arquivos). Aplicar pelo psql, transação
-- única — nunca pelo db-apply.

-- ---------------------------------------------------------------------------
-- 1. Política da loja
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.politica_devolucao (
  id smallint PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  prazo_arrependimento_dias integer NOT NULL DEFAULT 7
    CHECK (prazo_arrependimento_dias BETWEEN 7 AND 90),
  prazo_troca_dias integer NOT NULL DEFAULT 30
    CHECK (prazo_troca_dias BETWEEN 0 AND 365),
  prazo_vicio_dias integer NOT NULL DEFAULT 90
    CHECK (prazo_vicio_dias BETWEEN 30 AND 365),
  aceita_troca boolean NOT NULL DEFAULT true,
  aceita_vale boolean NOT NULL DEFAULT true,
  exige_fotos_vicio boolean NOT NULL DEFAULT true,
  metodos_locais text[] NOT NULL DEFAULT ARRAY['entrega_na_loja', 'coleta']
    CHECK (metodos_locais <@ ARRAY['entrega_na_loja', 'coleta']),
  metodos_nacionais text[] NOT NULL DEFAULT ARRAY['etiqueta_reversa', 'envio_proprio']
    CHECK (metodos_nacionais <@ ARRAY['etiqueta_reversa', 'envio_proprio']),
  reembolso_momento text NOT NULL DEFAULT 'ao_receber'
    CHECK (reembolso_momento IN ('ao_receber', 'apos_inspecao')),
  frete_troca_pago_por text NOT NULL DEFAULT 'cliente'
    CHECK (frete_troca_pago_por IN ('loja', 'cliente')),
  categorias_sem_troca text[] NOT NULL DEFAULT '{}',
  texto_politica text CHECK (texto_politica IS NULL OR char_length(texto_politica) <= 4000),
  endereco_devolucao text CHECK (endereco_devolucao IS NULL OR char_length(endereco_devolucao) <= 300),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid
);

COMMENT ON TABLE public.politica_devolucao IS
  'Política de trocas e devoluções da loja (uma linha, id=1). Prazos mínimos '
  'legais por CHECK: arrependimento >= 7 dias (CDC art. 49), vício >= 30 '
  '(art. 26). Leitura pública; escrita só por salvar_politica_de_devolucao.';

ALTER TABLE public.politica_devolucao ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.politica_devolucao FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.politica_devolucao TO anon, authenticated;
GRANT ALL ON public.politica_devolucao TO service_role;

DROP POLICY IF EXISTS politica_devolucao_publica_select_policy ON public.politica_devolucao;
CREATE POLICY politica_devolucao_publica_select_policy ON public.politica_devolucao
  FOR SELECT TO anon, authenticated USING (true);

INSERT INTO public.politica_devolucao (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 2. Devoluções, itens e trilha
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.devolucoes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  protocolo text NOT NULL UNIQUE,
  order_id uuid NOT NULL REFERENCES public.marketplace_orders (id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  tipo text NOT NULL CHECK (tipo IN ('arrependimento', 'vicio', 'troca')),
  motivo text NOT NULL CHECK (motivo IN (
    'tamanho_pequeno', 'tamanho_grande', 'nao_gostei', 'desisti', 'cor_diferente',
    'defeito', 'avariado_no_transporte', 'produto_errado', 'faltando_peca',
    'diferente_do_anuncio', 'outro'
  )),
  detalhe text CHECK (detalhe IS NULL OR char_length(detalhe) <= 1000),
  resolucao_desejada text NOT NULL CHECK (resolucao_desejada IN ('reembolso', 'troca', 'vale')),
  resolucao_final text CHECK (resolucao_final IS NULL OR resolucao_final IN ('reembolso', 'troca', 'vale')),
  modalidade text NOT NULL CHECK (modalidade IN ('local', 'nacional')),
  metodo_retorno text NOT NULL CHECK (metodo_retorno IN (
    'entrega_na_loja', 'coleta', 'etiqueta_reversa', 'envio_proprio'
  )),
  status text NOT NULL DEFAULT 'solicitada' CHECK (status IN (
    'solicitada', 'aprovada', 'recusada', 'cancelada', 'em_transito',
    'recebida', 'concluida', 'reprovada'
  )),
  valor_itens numeric(12, 2) NOT NULL CHECK (valor_itens >= 0),
  valor_frete_ida numeric(12, 2) NOT NULL DEFAULT 0 CHECK (valor_frete_ida >= 0),
  valor_reembolso numeric(12, 2) CHECK (valor_reembolso IS NULL OR valor_reembolso >= 0),
  refund_id uuid REFERENCES public.order_refunds (id),
  reembolso_manual boolean NOT NULL DEFAULT false,
  fotos text[] NOT NULL DEFAULT '{}' CHECK (cardinality(fotos) <= 6),
  codigo_rastreio text CHECK (codigo_rastreio IS NULL OR char_length(codigo_rastreio) <= 60),
  codigo_postagem text,
  etiqueta_url text,
  me_reverse_id text,
  coleta_em timestamptz,
  mensagem_loja text CHECK (mensagem_loja IS NULL OR char_length(mensagem_loja) <= 1000),
  observacao_inspecao text CHECK (observacao_inspecao IS NULL OR char_length(observacao_inspecao) <= 1000),
  entregue_em timestamptz,
  prazo_ate date NOT NULL,
  politica jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  aprovada_em timestamptz,
  postada_em timestamptz,
  recebida_em timestamptz,
  concluida_em timestamptz,
  encerrada_em timestamptz
);

COMMENT ON TABLE public.devolucoes IS
  'Pedido de devolução/troca de produto ENTREGUE. Tipo, prazo, métodos e '
  'valores decididos no servidor (solicitar_devolucao). Estados: solicitada '
  '-> aprovada|recusada|cancelada; aprovada -> em_transito|recebida|cancelada; '
  'em_transito -> recebida; recebida -> concluida|reprovada.';

CREATE INDEX IF NOT EXISTS idx_devolucoes_order_id ON public.devolucoes (order_id);
CREATE INDEX IF NOT EXISTS idx_devolucoes_user_id ON public.devolucoes (user_id);
CREATE INDEX IF NOT EXISTS idx_devolucoes_status_created ON public.devolucoes (status, created_at DESC);
-- Uma devolução ABERTA por pedido: evita duas esteiras disputando o mesmo item.
CREATE UNIQUE INDEX IF NOT EXISTS uq_devolucoes_uma_aberta_por_pedido
  ON public.devolucoes (order_id)
  WHERE status IN ('solicitada', 'aprovada', 'em_transito', 'recebida');

CREATE TABLE IF NOT EXISTS public.devolucao_itens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  devolucao_id uuid NOT NULL REFERENCES public.devolucoes (id) ON DELETE CASCADE,
  order_item_id uuid NOT NULL REFERENCES public.marketplace_order_items (id),
  product_id uuid,
  variant_id uuid,
  product_name text,
  image_url text,
  quantidade integer NOT NULL CHECK (quantidade > 0),
  valor_unitario numeric(10, 2) NOT NULL CHECK (valor_unitario >= 0),
  condicao text CHECK (condicao IS NULL OR condicao IN ('nova', 'usada', 'danificada', 'ausente')),
  reestocar boolean,
  reestocado_em timestamptz,
  UNIQUE (devolucao_id, order_item_id)
);

CREATE INDEX IF NOT EXISTS idx_devolucao_itens_order_item ON public.devolucao_itens (order_item_id);

CREATE TABLE IF NOT EXISTS public.devolucao_eventos (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  devolucao_id uuid NOT NULL REFERENCES public.devolucoes (id) ON DELETE CASCADE,
  de_status text,
  para_status text NOT NULL,
  ator text NOT NULL CHECK (ator IN ('cliente', 'loja', 'sistema')),
  nota text CHECK (nota IS NULL OR char_length(nota) <= 1000),
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_devolucao_eventos_devolucao ON public.devolucao_eventos (devolucao_id, created_at);

ALTER TABLE public.devolucoes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.devolucao_itens ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.devolucao_eventos ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.devolucoes, public.devolucao_itens, public.devolucao_eventos
  FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.devolucoes, public.devolucao_itens, public.devolucao_eventos TO authenticated;
GRANT ALL ON public.devolucoes, public.devolucao_itens, public.devolucao_eventos TO service_role;

DROP POLICY IF EXISTS devolucoes_dono_ou_admin_select_policy ON public.devolucoes;
CREATE POLICY devolucoes_dono_ou_admin_select_policy ON public.devolucoes
  FOR SELECT TO authenticated
  USING (user_id = (SELECT auth.uid()) OR (SELECT public.is_admin()));

DROP POLICY IF EXISTS devolucao_itens_dono_ou_admin_select_policy ON public.devolucao_itens;
CREATE POLICY devolucao_itens_dono_ou_admin_select_policy ON public.devolucao_itens
  FOR SELECT TO authenticated
  USING (
    (SELECT public.is_admin())
    OR devolucao_id IN (SELECT d.id FROM public.devolucoes d WHERE d.user_id = (SELECT auth.uid()))
  );

DROP POLICY IF EXISTS devolucao_eventos_dono_ou_admin_select_policy ON public.devolucao_eventos;
CREATE POLICY devolucao_eventos_dono_ou_admin_select_policy ON public.devolucao_eventos
  FOR SELECT TO authenticated
  USING (
    (SELECT public.is_admin())
    OR devolucao_id IN (SELECT d.id FROM public.devolucoes d WHERE d.user_id = (SELECT auth.uid()))
  );

-- ---------------------------------------------------------------------------
-- 3. Fotos: bucket privado
-- ---------------------------------------------------------------------------
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('devolucoes', 'devolucoes', false, 5242880, ARRAY['image/jpeg', 'image/png', 'image/webp'])
ON CONFLICT (id) DO NOTHING;

-- split_part(name,'/',1) em vez de storage.foldername(): mesma primeira pasta,
-- sem depender de função do serviço de storage.
DROP POLICY IF EXISTS devolucoes_cliente_insert_policy ON storage.objects;
CREATE POLICY devolucoes_cliente_insert_policy ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'devolucoes' AND split_part(name, '/', 1) = (SELECT auth.uid())::text);

DROP POLICY IF EXISTS devolucoes_dono_ou_admin_select_policy ON storage.objects;
CREATE POLICY devolucoes_dono_ou_admin_select_policy ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'devolucoes'
    AND (split_part(name, '/', 1) = (SELECT auth.uid())::text OR (SELECT public.is_admin()))
  );

-- ---------------------------------------------------------------------------
-- 4. Ajudantes internos (sem EXECUTE para ninguém além do dono)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.devolucao__hoje()
RETURNS date
LANGUAGE sql
STABLE
SET search_path = public
AS $$ SELECT (now() AT TIME ZONE 'America/Sao_Paulo')::date $$;

CREATE OR REPLACE FUNCTION public.devolucao__entregue_em(p_order_id uuid)
RETURNS timestamptz
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT COALESCE(
    (SELECT max(h.created_at) FROM public.marketplace_order_history h
      WHERE h.order_id = p_order_id AND h.new_status = 'delivered'),
    (SELECT o.updated_at FROM public.marketplace_orders o
      WHERE o.id = p_order_id AND o.status = 'delivered')
  )
$$;

CREATE OR REPLACE FUNCTION public.devolucao__modalidade(p_canal text, p_opcao text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT CASE
    WHEN p_canal = 'presencial' OR p_opcao IN ('local-delivery', 'store-pickup') THEN 'local'
    ELSE 'nacional'
  END
$$;

CREATE OR REPLACE FUNCTION public.devolucao__metodos(
  p_modalidade text, p_opcao text, p_tem_etiqueta boolean,
  p_locais text[], p_nacionais text[]
)
RETURNS text[]
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public
AS $$
DECLARE
  v text[] := '{}';
BEGIN
  IF p_modalidade = 'local' THEN
    IF 'entrega_na_loja' = ANY (p_locais) THEN v := array_append(v, 'entrega_na_loja'); END IF;
    -- Coleta só onde há endereço de entrega (pedido com entrega local).
    IF 'coleta' = ANY (p_locais) AND p_opcao = 'local-delivery' THEN v := array_append(v, 'coleta'); END IF;
    IF cardinality(v) = 0 THEN v := ARRAY['entrega_na_loja']; END IF;
  ELSE
    -- Reversa só quando a ida saiu por etiqueta do Melhor Envio.
    IF 'etiqueta_reversa' = ANY (p_nacionais) AND p_tem_etiqueta
       AND COALESCE(p_opcao, '') LIKE 'melhor-envio-%' THEN
      v := array_append(v, 'etiqueta_reversa');
    END IF;
    IF 'envio_proprio' = ANY (p_nacionais) THEN v := array_append(v, 'envio_proprio'); END IF;
    -- O direito do cliente não some porque a loja desligou tudo.
    IF cardinality(v) = 0 THEN v := ARRAY['envio_proprio']; END IF;
  END IF;
  RETURN v;
END;
$$;

CREATE OR REPLACE FUNCTION public.devolucao__registrar_evento(
  p_devolucao_id uuid, p_de text, p_para text, p_ator text, p_nota text
)
RETURNS void
LANGUAGE sql
VOLATILE
SET search_path = public
AS $$
  INSERT INTO public.devolucao_eventos (devolucao_id, de_status, para_status, ator, nota, created_by)
  VALUES (p_devolucao_id, p_de, p_para, p_ator, NULLIF(btrim(COALESCE(p_nota, '')), ''), auth.uid())
$$;

REVOKE ALL ON FUNCTION public.devolucao__hoje() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.devolucao__entregue_em(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.devolucao__modalidade(text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.devolucao__metodos(text, text, boolean, text[], text[]) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.devolucao__registrar_evento(uuid, text, text, text, text) FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 5. Cliente
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.devolucao_elegibilidade(p_order_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
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
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Entre na sua conta para pedir uma devolução.' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_o FROM public.marketplace_orders WHERE id = p_order_id;
  IF NOT FOUND OR (v_o.user_id IS DISTINCT FROM v_uid AND NOT public.is_admin()) THEN
    RAISE EXCEPTION 'Pedido não encontrado.' USING ERRCODE = 'P0002';
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
           'valor_unitario', x.price
         ) ORDER BY x.created_at, x.id), '[]'::jsonb),
         COALESCE(sum(GREATEST(x.quantity - x.ja, 0)), 0)
    INTO v_itens, v_disp_total
    FROM (
      SELECT oi.id, oi.product_id, oi.product_name, oi.image_url, oi.quantity, oi.price, oi.created_at,
             COALESCE((SELECT sum(di.quantidade) FROM public.devolucao_itens di
                         JOIN public.devolucoes d ON d.id = di.devolucao_id
                        WHERE di.order_item_id = oi.id
                          AND d.status NOT IN ('recusada', 'cancelada', 'reprovada')), 0)::integer AS ja
        FROM public.marketplace_order_items oi
       WHERE oi.order_id = v_o.id
    ) x;

  v_bloqueio := CASE
    WHEN v_o.status IS DISTINCT FROM 'delivered' THEN 'A devolução fica disponível depois que o pedido for entregue.'
    WHEN v_o.payment_status IN ('aguardando', 'recusado', 'expirado', 'estornado') THEN 'Este pedido não tem pagamento a devolver.'
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
  IF v_o.payment_status IN ('aguardando', 'recusado', 'expirado', 'estornado') THEN
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
       AND d.status NOT IN ('recusada', 'cancelada', 'reprovada');
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

    INSERT INTO public.devolucao_itens (
      devolucao_id, order_item_id, product_id, variant_id, product_name, image_url, quantidade, valor_unitario
    ) VALUES (
      v_id, v_oi.id, v_oi.product_id, v_oi.variant_id, v_oi.product_name, v_oi.image_url, v_qtd, v_oi.price
    );
    v_valor := v_valor + round(v_qtd * v_oi.price, 2);
  END LOOP;

  -- Arrependimento/defeito devolvem também o frete de ida quando o pedido
  -- volta inteiro (CDC art. 49, parágrafo único: "a qualquer título").
  IF v_tipo IN ('arrependimento', 'vicio') THEN
    SELECT COALESCE(sum(oi.quantity), 0) INTO v_total_pedido
      FROM public.marketplace_order_items oi WHERE oi.order_id = v_o.id;
    SELECT COALESCE(sum(di.quantidade), 0) INTO v_total_coberto
      FROM public.devolucao_itens di JOIN public.devolucoes d ON d.id = di.devolucao_id
     WHERE d.order_id = v_o.id AND d.status NOT IN ('recusada', 'cancelada', 'reprovada');
    IF v_total_coberto >= v_total_pedido THEN
      v_frete := COALESCE(v_o.shipping, 0);
    END IF;
  END IF;

  UPDATE public.devolucoes SET valor_itens = v_valor, valor_frete_ida = v_frete WHERE id = v_id;
  PERFORM public.devolucao__registrar_evento(v_id, NULL, 'solicitada', 'cliente', NULL);

  RETURN jsonb_build_object('id', v_id, 'protocolo', v_protocolo, 'tipo', v_tipo, 'status', 'solicitada');
END;
$$;

CREATE OR REPLACE FUNCTION public.cancelar_devolucao(p_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_d public.devolucoes%ROWTYPE;
BEGIN
  SELECT * INTO v_d FROM public.devolucoes WHERE id = p_id FOR UPDATE;
  IF NOT FOUND OR v_d.user_id IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'Devolução não encontrada.' USING ERRCODE = 'P0002';
  END IF;
  IF v_d.status NOT IN ('solicitada', 'aprovada') THEN
    RAISE EXCEPTION 'Esta devolução não pode mais ser cancelada.' USING ERRCODE = '22023';
  END IF;
  UPDATE public.devolucoes SET status = 'cancelada', encerrada_em = now(), updated_at = now() WHERE id = p_id;
  PERFORM public.devolucao__registrar_evento(p_id, v_d.status, 'cancelada', 'cliente', NULL);
  RETURN jsonb_build_object('id', p_id, 'status', 'cancelada');
END;
$$;

CREATE OR REPLACE FUNCTION public.informar_envio_devolucao(p_id uuid, p_codigo_rastreio text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_d public.devolucoes%ROWTYPE;
  v_codigo text := upper(btrim(COALESCE(p_codigo_rastreio, '')));
BEGIN
  SELECT * INTO v_d FROM public.devolucoes WHERE id = p_id FOR UPDATE;
  IF NOT FOUND OR v_d.user_id IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'Devolução não encontrada.' USING ERRCODE = 'P0002';
  END IF;
  IF v_d.status <> 'aprovada' OR v_d.metodo_retorno NOT IN ('envio_proprio', 'etiqueta_reversa') THEN
    RAISE EXCEPTION 'O código de envio só é informado depois da aprovação, em devolução pelos Correios ou transportadora.'
      USING ERRCODE = '22023';
  END IF;
  IF v_codigo !~ '^[A-Z0-9-]{5,40}$' THEN
    RAISE EXCEPTION 'Código de rastreio inválido.' USING ERRCODE = '22023';
  END IF;
  UPDATE public.devolucoes
     SET status = 'em_transito', codigo_rastreio = v_codigo, postada_em = now(), updated_at = now()
   WHERE id = p_id;
  PERFORM public.devolucao__registrar_evento(p_id, 'aprovada', 'em_transito', 'cliente', 'Rastreio: ' || v_codigo);
  RETURN jsonb_build_object('id', p_id, 'status', 'em_transito');
END;
$$;

CREATE OR REPLACE FUNCTION public.devolucoes_do_pedido(p_order_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Acesso negado.' USING ERRCODE = '42501';
  END IF;
  IF NOT public.is_admin() AND NOT EXISTS (
    SELECT 1 FROM public.marketplace_orders o WHERE o.id = p_order_id AND o.user_id = auth.uid()
  ) THEN
    RETURN '[]'::jsonb;
  END IF;
  RETURN COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
      'id', d.id, 'protocolo', d.protocolo, 'status', d.status, 'tipo', d.tipo,
      'resolucao_desejada', d.resolucao_desejada, 'metodo_retorno', d.metodo_retorno,
      'valor_itens', d.valor_itens, 'created_at', d.created_at
    ) ORDER BY d.created_at DESC)
    FROM public.devolucoes d WHERE d.order_id = p_order_id
  ), '[]'::jsonb);
END;
$$;

CREATE OR REPLACE FUNCTION public.devolucao_detalhe(p_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_d public.devolucoes%ROWTYPE;
  v_o public.marketplace_orders%ROWTYPE;
BEGIN
  SELECT * INTO v_d FROM public.devolucoes WHERE id = p_id;
  IF NOT FOUND OR (v_d.user_id IS DISTINCT FROM auth.uid() AND NOT public.is_admin()) THEN
    RAISE EXCEPTION 'Devolução não encontrada.' USING ERRCODE = 'P0002';
  END IF;
  SELECT * INTO v_o FROM public.marketplace_orders WHERE id = v_d.order_id;
  RETURN to_jsonb(v_d) || jsonb_build_object(
    'itens', COALESCE((SELECT jsonb_agg(to_jsonb(i) ORDER BY i.product_name, i.id)
                         FROM public.devolucao_itens i WHERE i.devolucao_id = v_d.id), '[]'::jsonb),
    'eventos', COALESCE((SELECT jsonb_agg(to_jsonb(e) ORDER BY e.created_at, e.id)
                           FROM public.devolucao_eventos e WHERE e.devolucao_id = v_d.id), '[]'::jsonb),
    'pedido', jsonb_build_object(
      'id', v_o.id, 'total', v_o.total, 'shipping', v_o.shipping,
      'payment_method', v_o.payment_method, 'payment_status', v_o.payment_status,
      'canal', v_o.canal, 'customer_name', v_o.customer_name,
      'whatsapp', v_o.customer_data ->> 'whatsapp',
      'shipping_label_id', v_o.shipping_label_id,
      'shipping_option_id', v_o.customer_data ->> 'shipping_option_id'
    )
  );
END;
$$;

-- ---------------------------------------------------------------------------
-- 6. Lojista
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_devolucoes_listar(
  p_status text DEFAULT NULL,
  p_busca text DEFAULT NULL,
  p_limite integer DEFAULT 50,
  p_offset integer DEFAULT 0
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_busca text := NULLIF(btrim(COALESCE(p_busca, '')), '');
  v_limite integer := LEAST(GREATEST(COALESCE(p_limite, 50), 1), 200);
  v_offset integer := GREATEST(COALESCE(p_offset, 0), 0);
  v_total integer;
  v_itens jsonb;
  v_contagem jsonb;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Acesso negado.' USING ERRCODE = '42501';
  END IF;

  SELECT jsonb_build_object(
    'solicitada', count(*) FILTER (WHERE status = 'solicitada'),
    'aprovada', count(*) FILTER (WHERE status = 'aprovada'),
    'em_transito', count(*) FILTER (WHERE status = 'em_transito'),
    'recebida', count(*) FILTER (WHERE status = 'recebida'),
    'concluida', count(*) FILTER (WHERE status = 'concluida'),
    'recusada', count(*) FILTER (WHERE status = 'recusada'),
    'cancelada', count(*) FILTER (WHERE status = 'cancelada'),
    'reprovada', count(*) FILTER (WHERE status = 'reprovada')
  ) INTO v_contagem FROM public.devolucoes;

  WITH base AS (
    SELECT d.*, o.customer_name AS cliente_nome, o.customer_data ->> 'whatsapp' AS cliente_whatsapp
      FROM public.devolucoes d
      JOIN public.marketplace_orders o ON o.id = d.order_id
     WHERE (p_status IS NULL OR d.status = p_status)
       AND (v_busca IS NULL
            OR d.protocolo ILIKE '%' || v_busca || '%'
            OR o.customer_name ILIKE '%' || v_busca || '%'
            OR d.order_id::text ILIKE v_busca || '%')
  )
  SELECT (SELECT count(*) FROM base),
         COALESCE((SELECT jsonb_agg(jsonb_build_object(
            'id', b.id, 'protocolo', b.protocolo, 'order_id', b.order_id,
            'cliente_nome', b.cliente_nome, 'cliente_whatsapp', b.cliente_whatsapp,
            'tipo', b.tipo, 'motivo', b.motivo, 'status', b.status,
            'resolucao_desejada', b.resolucao_desejada, 'metodo_retorno', b.metodo_retorno,
            'modalidade', b.modalidade, 'valor_itens', b.valor_itens,
            'prazo_ate', b.prazo_ate, 'created_at', b.created_at
          ) ORDER BY b.created_at DESC)
          FROM (SELECT * FROM base ORDER BY created_at DESC LIMIT v_limite OFFSET v_offset) b), '[]'::jsonb)
    INTO v_total, v_itens;

  RETURN jsonb_build_object('total', v_total, 'contagem', v_contagem, 'itens', v_itens);
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_devolucao_decidir(
  p_id uuid,
  p_aprovar boolean,
  p_mensagem text DEFAULT NULL,
  p_coleta_em timestamptz DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_d public.devolucoes%ROWTYPE;
  v_msg text := NULLIF(btrim(COALESCE(p_mensagem, '')), '');
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Acesso negado.' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_d FROM public.devolucoes WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Devolução não encontrada.' USING ERRCODE = 'P0002';
  END IF;
  IF v_d.status <> 'solicitada' THEN
    RAISE EXCEPTION 'Esta devolução já foi decidida.' USING ERRCODE = '22023';
  END IF;

  IF p_aprovar THEN
    UPDATE public.devolucoes
       SET status = 'aprovada', aprovada_em = now(), mensagem_loja = v_msg,
           coleta_em = CASE WHEN metodo_retorno = 'coleta' THEN p_coleta_em ELSE NULL END,
           updated_at = now()
     WHERE id = p_id;
    PERFORM public.devolucao__registrar_evento(p_id, 'solicitada', 'aprovada', 'loja', v_msg);
    RETURN jsonb_build_object('id', p_id, 'status', 'aprovada');
  END IF;

  -- Recusa sempre explícita e com motivo (CDC art. 26 §2º I).
  IF v_msg IS NULL THEN
    RAISE EXCEPTION 'Explique ao cliente o motivo da recusa.' USING ERRCODE = '22023';
  END IF;
  UPDATE public.devolucoes
     SET status = 'recusada', mensagem_loja = v_msg, encerrada_em = now(), updated_at = now()
   WHERE id = p_id;
  PERFORM public.devolucao__registrar_evento(p_id, 'solicitada', 'recusada', 'loja', v_msg);
  RETURN jsonb_build_object('id', p_id, 'status', 'recusada');
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_devolucao_registrar(
  p_id uuid,
  p_evento text,
  p_codigo text DEFAULT NULL,
  p_nota text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_d public.devolucoes%ROWTYPE;
  v_codigo text := NULLIF(upper(btrim(COALESCE(p_codigo, ''))), '');
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Acesso negado.' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_d FROM public.devolucoes WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Devolução não encontrada.' USING ERRCODE = 'P0002';
  END IF;

  IF p_evento = 'em_transito' THEN
    IF v_d.status <> 'aprovada' THEN
      RAISE EXCEPTION 'Só uma devolução aprovada pode ser marcada como enviada.' USING ERRCODE = '22023';
    END IF;
    IF v_codigo IS NOT NULL AND v_codigo !~ '^[A-Z0-9-]{5,40}$' THEN
      RAISE EXCEPTION 'Código de rastreio inválido.' USING ERRCODE = '22023';
    END IF;
    UPDATE public.devolucoes
       SET status = 'em_transito', postada_em = now(),
           codigo_rastreio = COALESCE(v_codigo, codigo_rastreio), updated_at = now()
     WHERE id = p_id;
  ELSIF p_evento = 'recebida' THEN
    IF v_d.status NOT IN ('aprovada', 'em_transito') THEN
      RAISE EXCEPTION 'Só uma devolução aprovada ou a caminho pode ser marcada como recebida.' USING ERRCODE = '22023';
    END IF;
    UPDATE public.devolucoes SET status = 'recebida', recebida_em = now(), updated_at = now() WHERE id = p_id;
  ELSE
    RAISE EXCEPTION 'Evento desconhecido.' USING ERRCODE = '22023';
  END IF;

  PERFORM public.devolucao__registrar_evento(p_id, v_d.status, p_evento, 'loja',
    concat_ws(' · ', CASE WHEN v_codigo IS NOT NULL THEN 'Rastreio: ' || v_codigo END, NULLIF(btrim(COALESCE(p_nota, '')), '')));
  RETURN jsonb_build_object('id', p_id, 'status', p_evento);
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_devolucao_concluir(
  p_id uuid,
  p_resolucao text,
  p_itens jsonb,
  p_valor_reembolso numeric DEFAULT NULL,
  p_observacao text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_d public.devolucoes%ROWTYPE;
  v_o public.marketplace_orders%ROWTYPE;
  v_item jsonb;
  v_di public.devolucao_itens%ROWTYPE;
  v_condicao text;
  v_reestocar boolean;
  v_reestocados integer := 0;
  v_valor numeric(12, 2);
  v_disponivel numeric(12, 2);
  v_em_voo numeric(12, 2);
  v_pago_pelo_app boolean;
  v_refund_id uuid;
  v_manual boolean := false;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Acesso negado.' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_d FROM public.devolucoes WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Devolução não encontrada.' USING ERRCODE = 'P0002';
  END IF;
  IF v_d.status <> 'recebida' THEN
    RAISE EXCEPTION 'Conclua a devolução depois de receber o produto.' USING ERRCODE = '22023';
  END IF;
  IF p_resolucao IS NULL OR p_resolucao NOT IN ('reembolso', 'troca', 'vale') THEN
    RAISE EXCEPTION 'Escolha a resolução: reembolso, troca ou vale-troca.' USING ERRCODE = '22023';
  END IF;
  IF p_resolucao = 'reembolso' AND v_d.tipo = 'troca' THEN
    RAISE EXCEPTION 'Devolução por troca de política não gera reembolso. Use troca ou vale-troca.' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_o FROM public.marketplace_orders WHERE id = v_d.order_id FOR UPDATE;

  -- Inspeção e reestoque por item (uma vez só por item).
  FOR v_item IN SELECT * FROM jsonb_array_elements(COALESCE(p_itens, '[]'::jsonb)) LOOP
    SELECT * INTO v_di FROM public.devolucao_itens
     WHERE id = NULLIF(v_item ->> 'item_id', '')::uuid AND devolucao_id = p_id FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Item não pertence a esta devolução.' USING ERRCODE = '22023';
    END IF;
    v_condicao := v_item ->> 'condicao';
    IF v_condicao IS NULL OR v_condicao NOT IN ('nova', 'usada', 'danificada', 'ausente') THEN
      RAISE EXCEPTION 'Informe a condição de cada item recebido.' USING ERRCODE = '22023';
    END IF;
    v_reestocar := COALESCE((v_item ->> 'reestocar')::boolean, false) AND v_condicao <> 'ausente';

    UPDATE public.devolucao_itens SET condicao = v_condicao, reestocar = v_reestocar WHERE id = v_di.id;

    IF v_reestocar AND v_di.reestocado_em IS NULL THEN
      IF v_di.variant_id IS NOT NULL THEN
        UPDATE public.product_variants SET stock_increment = stock_increment + v_di.quantidade
         WHERE id = v_di.variant_id;
      ELSIF v_di.product_id IS NOT NULL THEN
        UPDATE public.produtos SET estoque = estoque + v_di.quantidade WHERE id = v_di.product_id;
      END IF;
      UPDATE public.devolucao_itens SET reestocado_em = now() WHERE id = v_di.id;
      v_reestocados := v_reestocados + v_di.quantidade;
    END IF;
  END LOOP;

  IF EXISTS (SELECT 1 FROM public.devolucao_itens WHERE devolucao_id = p_id AND condicao IS NULL) THEN
    RAISE EXCEPTION 'Informe a condição de cada item recebido.' USING ERRCODE = '22023';
  END IF;

  IF p_resolucao = 'reembolso' THEN
    v_valor := round(COALESCE(p_valor_reembolso, v_d.valor_itens + v_d.valor_frete_ida), 2);
    IF v_valor <= 0 THEN
      RAISE EXCEPTION 'Informe o valor do reembolso.' USING ERRCODE = '22023';
    END IF;

    v_pago_pelo_app := v_o.payment_method = 'online'
                       AND v_o.payment_status IN ('pago', 'pago_apos_expirar')
                       AND v_o.gateway_payment_id IS NOT NULL;

    IF v_pago_pelo_app THEN
      -- Mesma trava de saldo da solicitar_estorno: total − já devolvido − em voo.
      SELECT COALESCE(sum(r.amount), 0) INTO v_em_voo FROM public.order_refunds r
       WHERE r.order_id = v_o.id AND r.status IN ('solicitado', 'em_processamento');
      v_disponivel := v_o.total - COALESCE(v_o.valor_estornado, 0) - v_em_voo;
      IF v_valor > v_disponivel THEN
        RAISE EXCEPTION 'O reembolso (R$ %) passa do que ainda pode ser devolvido deste pedido (R$ %).',
          v_valor, v_disponivel USING ERRCODE = '22023';
      END IF;
      INSERT INTO public.order_refunds (order_id, amount, motivo, solicitado_por, status)
      VALUES (v_o.id, v_valor, 'Devolução ' || v_d.protocolo, 'lojista', 'solicitado')
      RETURNING id INTO v_refund_id;
    ELSE
      SELECT v_o.total - COALESCE(v_o.valor_estornado, 0) - COALESCE(sum(d.valor_reembolso), 0)
        INTO v_disponivel
        FROM public.devolucoes d
       WHERE d.order_id = v_o.id AND d.status = 'concluida' AND d.reembolso_manual;
      IF v_valor > v_disponivel THEN
        RAISE EXCEPTION 'O reembolso (R$ %) passa do valor pago no pedido (R$ %).',
          v_valor, v_disponivel USING ERRCODE = '22023';
      END IF;
      v_manual := true;
    END IF;
  END IF;

  UPDATE public.devolucoes
     SET status = 'concluida', resolucao_final = p_resolucao,
         valor_reembolso = CASE WHEN p_resolucao = 'reembolso' THEN v_valor END,
         refund_id = v_refund_id, reembolso_manual = v_manual,
         observacao_inspecao = NULLIF(btrim(COALESCE(p_observacao, '')), ''),
         concluida_em = now(), updated_at = now()
   WHERE id = p_id;

  PERFORM public.devolucao__registrar_evento(p_id, 'recebida', 'concluida', 'loja',
    CASE p_resolucao
      WHEN 'reembolso' THEN 'Reembolso de R$ ' || to_char(v_valor, 'FM999G999G990D00')
        || CASE WHEN v_manual THEN ' (devolvido pela loja fora do app)' ELSE ' pelo Mercado Pago' END
      WHEN 'troca' THEN 'Troca combinada com a loja'
      ELSE 'Vale-troca emitido'
    END);

  RETURN jsonb_build_object(
    'id', p_id, 'status', 'concluida', 'resolucao', p_resolucao,
    'valor_reembolso', CASE WHEN p_resolucao = 'reembolso' THEN v_valor END,
    'refund_id', v_refund_id, 'reembolso_manual', v_manual, 'reestocados', v_reestocados
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_devolucao_reprovar(p_id uuid, p_motivo text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_d public.devolucoes%ROWTYPE;
  v_msg text := NULLIF(btrim(COALESCE(p_motivo, '')), '');
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Acesso negado.' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_d FROM public.devolucoes WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Devolução não encontrada.' USING ERRCODE = 'P0002';
  END IF;
  IF v_d.status <> 'recebida' THEN
    RAISE EXCEPTION 'Só um produto recebido pode ser reprovado na inspeção.' USING ERRCODE = '22023';
  END IF;
  IF v_msg IS NULL THEN
    RAISE EXCEPTION 'Explique ao cliente por que o produto não foi aceito.' USING ERRCODE = '22023';
  END IF;
  UPDATE public.devolucoes
     SET status = 'reprovada', mensagem_loja = v_msg, encerrada_em = now(), updated_at = now()
   WHERE id = p_id;
  PERFORM public.devolucao__registrar_evento(p_id, 'recebida', 'reprovada', 'loja', v_msg);
  RETURN jsonb_build_object('id', p_id, 'status', 'reprovada');
END;
$$;

CREATE OR REPLACE FUNCTION public.salvar_politica_de_devolucao(p jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v public.politica_devolucao%ROWTYPE;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Acesso negado.' USING ERRCODE = '42501';
  END IF;
  IF p IS NULL OR jsonb_typeof(p) <> 'object' THEN
    RAISE EXCEPTION 'Política inválida.' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.politica_devolucao (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

  -- Parcial: campo ausente fica como está. Os CHECKs da tabela recusam prazo
  -- abaixo da lei e método desconhecido.
  UPDATE public.politica_devolucao SET
    prazo_arrependimento_dias = CASE WHEN p ? 'prazo_arrependimento_dias'
      THEN (p ->> 'prazo_arrependimento_dias')::integer ELSE prazo_arrependimento_dias END,
    prazo_troca_dias = CASE WHEN p ? 'prazo_troca_dias'
      THEN (p ->> 'prazo_troca_dias')::integer ELSE prazo_troca_dias END,
    prazo_vicio_dias = CASE WHEN p ? 'prazo_vicio_dias'
      THEN (p ->> 'prazo_vicio_dias')::integer ELSE prazo_vicio_dias END,
    aceita_troca = CASE WHEN p ? 'aceita_troca' THEN (p ->> 'aceita_troca')::boolean ELSE aceita_troca END,
    aceita_vale = CASE WHEN p ? 'aceita_vale' THEN (p ->> 'aceita_vale')::boolean ELSE aceita_vale END,
    exige_fotos_vicio = CASE WHEN p ? 'exige_fotos_vicio'
      THEN (p ->> 'exige_fotos_vicio')::boolean ELSE exige_fotos_vicio END,
    metodos_locais = CASE WHEN p ? 'metodos_locais'
      THEN ARRAY(SELECT jsonb_array_elements_text(p -> 'metodos_locais')) ELSE metodos_locais END,
    metodos_nacionais = CASE WHEN p ? 'metodos_nacionais'
      THEN ARRAY(SELECT jsonb_array_elements_text(p -> 'metodos_nacionais')) ELSE metodos_nacionais END,
    reembolso_momento = CASE WHEN p ? 'reembolso_momento'
      THEN p ->> 'reembolso_momento' ELSE reembolso_momento END,
    frete_troca_pago_por = CASE WHEN p ? 'frete_troca_pago_por'
      THEN p ->> 'frete_troca_pago_por' ELSE frete_troca_pago_por END,
    categorias_sem_troca = CASE WHEN p ? 'categorias_sem_troca'
      THEN ARRAY(SELECT btrim(c) FROM jsonb_array_elements_text(p -> 'categorias_sem_troca') c
                  WHERE btrim(c) <> '') ELSE categorias_sem_troca END,
    texto_politica = CASE WHEN p ? 'texto_politica'
      THEN NULLIF(btrim(COALESCE(p ->> 'texto_politica', '')), '') ELSE texto_politica END,
    endereco_devolucao = CASE WHEN p ? 'endereco_devolucao'
      THEN NULLIF(btrim(COALESCE(p ->> 'endereco_devolucao', '')), '') ELSE endereco_devolucao END,
    updated_at = now(),
    updated_by = auth.uid()
  WHERE id = 1
  RETURNING * INTO v;

  RETURN to_jsonb(v) - 'updated_by';
END;
$$;

-- Grants: cliente e lojista chamam como authenticated; o gate mora dentro.
DO $grants$
DECLARE
  v_sig text;
BEGIN
  FOREACH v_sig IN ARRAY ARRAY[
    'public.devolucao_elegibilidade(uuid)',
    'public.solicitar_devolucao(uuid, jsonb, text, text, text, text, text[])',
    'public.cancelar_devolucao(uuid)',
    'public.informar_envio_devolucao(uuid, text)',
    'public.devolucoes_do_pedido(uuid)',
    'public.devolucao_detalhe(uuid)',
    'public.admin_devolucoes_listar(text, text, integer, integer)',
    'public.admin_devolucao_decidir(uuid, boolean, text, timestamptz)',
    'public.admin_devolucao_registrar(uuid, text, text, text)',
    'public.admin_devolucao_concluir(uuid, text, jsonb, numeric, text)',
    'public.admin_devolucao_reprovar(uuid, text)',
    'public.salvar_politica_de_devolucao(jsonb)'
  ] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon', v_sig);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated', v_sig);
  END LOOP;
END
$grants$;

-- ---------------------------------------------------------------------------
-- 7. Aviso ao cliente a cada mudança de status (best-effort)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.devolucao_avisa_o_cliente()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_titulo text;
  v_msg text;
  v_tipo text := 'info';
BEGIN
  IF OLD.status IS NOT DISTINCT FROM NEW.status THEN
    RETURN NEW;
  END IF;
  CASE NEW.status
    WHEN 'aprovada' THEN
      v_titulo := 'Devolução aprovada';
      v_msg := 'A loja aprovou a devolução ' || NEW.protocolo || '. Veja as instruções no pedido.';
    WHEN 'recusada' THEN
      v_tipo := 'warning';
      v_titulo := 'Devolução não aprovada';
      v_msg := 'A loja respondeu a devolução ' || NEW.protocolo || '. Veja o motivo no pedido.';
    WHEN 'recebida' THEN
      v_titulo := 'Produto recebido pela loja';
      v_msg := 'A loja recebeu o produto da devolução ' || NEW.protocolo || '.';
    WHEN 'concluida' THEN
      v_tipo := 'success';
      v_titulo := 'Devolução concluída';
      v_msg := CASE NEW.resolucao_final
        WHEN 'reembolso' THEN 'O reembolso da devolução ' || NEW.protocolo || ' foi liberado.'
        WHEN 'troca' THEN 'A troca da devolução ' || NEW.protocolo || ' foi confirmada.'
        ELSE 'O vale-troca da devolução ' || NEW.protocolo || ' foi emitido.'
      END;
    WHEN 'reprovada' THEN
      v_tipo := 'warning';
      v_titulo := 'Produto não aceito na inspeção';
      v_msg := 'Veja no pedido o retorno da loja sobre a devolução ' || NEW.protocolo || '.';
    ELSE
      RETURN NEW;
  END CASE;

  BEGIN
    INSERT INTO public.notificacoes (usuario_id, tipo, titulo, mensagem, dados)
    VALUES (NEW.user_id, v_tipo, v_titulo, v_msg,
            jsonb_build_object('order_id', NEW.order_id, 'devolucao_id', NEW.id));
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'devolucao_avisa_o_cliente: aviso da devolução % não nasceu (%).', NEW.id, SQLERRM;
  END;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.devolucao_avisa_o_cliente() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS tr_devolucao_avisa_o_cliente ON public.devolucoes;
CREATE TRIGGER tr_devolucao_avisa_o_cliente
AFTER UPDATE OF status ON public.devolucoes
FOR EACH ROW EXECUTE FUNCTION public.devolucao_avisa_o_cliente();
