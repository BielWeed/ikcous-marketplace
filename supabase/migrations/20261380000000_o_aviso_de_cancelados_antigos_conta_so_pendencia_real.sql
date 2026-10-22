-- O AVISO DE CANCELADOS ANTIGOS CONTA SO PENDENCIA REAL (rascunho para revisao; 22/10/2026).
--
-- DEFEITO (o que a lojista ve): o botao de alerta da tela Pedidos mostra "44 cancelamentos
-- anteriores a janela de 90 dias" mesmo quando esses 44 pedidos nao tem nada a fazer (nunca foram
-- pagos nem enviados, ou ja foram devolvidos e o produto voltou). O numero vem de fora_da_janela,
-- que get_admin_orders_cancelados_recentes (20261164, refeita na 20261175 e na 20261199) calcula
-- como TODO pedido cancelado com cancelamento anterior a janela, sem olhar se existe pendencia.
--
-- DECISAO DE PRODUTO (proposta do socio; so vale depois da aprovacao do dono): fora_da_janela
-- passa a contar SO o pedido antigo que ainda tem pendencia real, pela MESMA regra que o painel
-- ja usa nos dois baldes (src/views/admin/AdminOrdersView.tsx: baldeDeEstorno e
-- precisaConfirmarRetornoDoProduto; src/lib/valor-devolver-agora.ts):
--   (a) DINHEIRO a devolver: payment_status em pago, pago_apos_expirar ou recebido_na_entrega e
--       total - reembolso manual de devolucao concluida - valor_estornado > 0;
--   (b) MERCADORIA a voltar: cancelled_after_shipping verdadeiro e returned_to_seller_at nulo
--       (vale pago ou nao).
-- Regra conservadora: a contagem pode sobrar em relacao ao painel, nunca faltar. O estorno "em
-- andamento" (order_refunds solicitado/em_processamento) NAO e descontado, porque o painel tambem
-- mantem esse pedido na lista. O canal da venda nao entra na regra (balcao e online contam igual).
--
-- O QUE MUDA, SO ISTO: o bloco que calcula v_fora_da_janela. Assinatura, retorno (data,
-- total_count, fora_da_janela), SECURITY DEFINER, search_path, os dois gates (is_admin e
-- is_admin_atual), dono, OID e GRANTs ficam iguais; total_count e data nao mudam. O resto do
-- corpo e o da 20261199000000, byte a byte. p_dias NULL continua dando fora_da_janela = 0.
--
-- RELACAO COM paid_on_cancelled (20261251, get_admin_analytics_v2): aquele contador soma o dinheiro
-- preso de TODO o historico de cancelados pagos (sem janela, sem descontar estorno) e alimenta o
-- aviso fixo "N pedidos receberam pagamento e estao cancelados". Esta migration NAO o toca e nao
-- depende dele. Os dois avisos continuam separados na tela; o numero do botao e o MAIOR entre eles
-- e as listas (nunca a soma), entao um pedido antigo pago e nao estornado aparece nos dois blocos
-- sem ser contado duas vezes no botao. O dia em que paid_on_cancelled passar a descontar o que ja
-- foi devolvido, os dois ficam coerentes; hoje ele pode ser maior que este.
--
-- DADOS EXISTENTES: nenhuma linha de pedido, devolucao ou historico e escrita ou lida fora do
-- SELECT da propria funcao. Muda so o catalogo (o corpo de UMA funcao).
--
-- ATOMICIDADE E REAPLICACAO: sem BEGIN/COMMIT de nivel superior: o aplicador fornece a transacao
-- inteira. O PRE-VOO aceita o corpo vigente (md5 99a9e4cb232aef020bf297ddcd1901f0) OU o desta migration (md5
-- 9567454f17698f3f0624cca0b06458cd); outro corpo, atributo ou permissao diferente recusa com B1_BASELINE_DIVERGENT. Rodar
-- duas vezes deixa o mesmo estado. O POS-VOO confere o corpo novo e que OID, dono, ACL e todos os
-- atributos da funcao ficaram iguais (so o prosrc muda).
--
-- ORDEM: depois da 20261199000000 (o pre-voo recusa corpo anterior). BANCO ANTES DO FRONT em cada
-- loja: o front novo escreve "N pedidos cancelados ha mais de 90 dias ainda estao pendentes" com o
-- numero que o banco devolve; contra o banco antigo esse numero seria o total de cancelados
-- antigos e a frase mentiria. Front antigo contra banco novo so mostra um numero menor/correto.
-- Valem IKCOUS e Savy; lojas de teste ficam fora.
--
-- PROVAS: catalogo, consultas 85b (antes) e 85a (depois), so leitura. Comportamento (pedido antigo
-- sem pagamento e sem envio nao conta; pago e nao estornado conta; enviado e nao devolvido conta;
-- pago e ja estornado nao conta; recente nunca entra; p_dias NULL = 0): tests/banco/
-- o-aviso-de-cancelados-antigos-viva.cjs, SO no Postgres efemero do CI.
--
-- FICHA DE VERIFICACAO pos-aplicacao (como admin, em cada loja):
--   1. SELECT get_admin_orders_cancelados_recentes(90, 0, 1)->>'fora_da_janela';
--      -- esperado: <= SELECT count(*) FROM marketplace_orders WHERE status = 'cancelled' menos
--      -- os cancelados dos ultimos 90 dias (o numero antigo); e igual ao numero de pedidos
--      -- antigos que aparecem nas listas "Devolver agora" ou "produto a voltar" depois de
--      -- "Mostrar esses pedidos".
--   2. SELECT get_admin_orders_cancelados_recentes(NULL, 0, 1)->>'fora_da_janela';
--      -- esperado: 0.
--   3. SELECT get_admin_orders_cancelados_recentes(90, 0, 1)->>'total_count' antes e depois:
--      -- igual (a janela de dentro nao mudou).
--   4. consulta 85a: todas as linhas ok = true.
--
-- ROLLBACK: rollback-manual-20261380000000_o_aviso_de_cancelados_antigos_conta_so_pendencia_real.sql
-- devolve o corpo da 20261199000000 byte a byte (LF), mantendo OID, dono, atributos e ACL; recusa
-- corpo desconhecido e segundo rollback. Nenhum dado e apagado. Depois dele o aviso volta a
-- contar todo cancelado antigo (o defeito de origem) e o front novo mente: reverter o front antes.
--
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

DO $preflight_20261380000000$
DECLARE
  r record;
  v_hash text;
  v_atributos jsonb;
BEGIN
  FOR r IN SELECT * FROM (VALUES
    ('public.get_admin_orders_cancelados_recentes(integer,integer,integer)', '99a9e4cb232aef020bf297ddcd1901f0', '9567454f17698f3f0624cca0b06458cd')
  ) AS esperado(assinatura, hash_vigente, hash_desta)
  LOOP
    SELECT md5(replace(p.prosrc, E'\r', '')), to_jsonb(p) - 'prosrc'
      INTO v_hash, v_atributos FROM pg_proc p
     WHERE p.oid = to_regprocedure(r.assinatura);
    IF v_hash IS NULL OR v_hash NOT IN (r.hash_vigente, r.hash_desta) THEN
      RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: % (hash %) nao e o corpo vigente nem o desta migration; revise antes de aplicar.', r.assinatura, COALESCE(v_hash, 'ausente');
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM pg_proc p JOIN pg_language l ON l.oid = p.prolang
       WHERE p.oid = to_regprocedure(r.assinatura)
         AND p.prosecdef AND p.proconfig = ARRAY['search_path=public, extensions']::text[]
         AND p.provolatile = 'v' AND NOT p.proisstrict AND NOT p.proretset
         AND l.lanname = 'plpgsql' AND p.prorettype = 'jsonb'::regtype
         AND pg_get_function_identity_arguments(p.oid) = 'p_dias integer, p_page integer, p_page_size integer'
         AND (SELECT count(*) FROM pg_proc q WHERE q.pronamespace = 'public'::regnamespace AND q.proname = 'get_admin_orders_cancelados_recentes') = 1
         AND has_function_privilege('authenticated', p.oid, 'EXECUTE')
         AND has_function_privilege('service_role', p.oid, 'EXECUTE')
         AND NOT has_function_privilege('anon', p.oid, 'EXECUTE')
         AND NOT EXISTS (SELECT 1 FROM aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) a
                         WHERE a.grantee = 0 AND a.privilege_type = 'EXECUTE')
    ) THEN
      RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: get_admin_orders_cancelados_recentes tem assinatura, atributos ou permissoes diferentes dos esperados.';
    END IF;
    -- Fotografar OID, dono, ACL e TODOS os atributos: o CREATE OR REPLACE so pode trocar prosrc.
    PERFORM set_config('ikcous.cancelados1380_atributos', v_atributos::text, true);
  END LOOP;
END $preflight_20261380000000$;

CREATE OR REPLACE FUNCTION public.get_admin_orders_cancelados_recentes(p_dias integer DEFAULT 90, p_page integer DEFAULT 0, p_page_size integer DEFAULT 200)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $$
DECLARE
    v_total_count BIGINT;
    v_fora_da_janela BIGINT;
    v_data JSONB;
    v_offset INTEGER;
BEGIN
    -- Authorization check (mesmo gate da get_admin_orders_paged).
    IF NOT public.is_admin() THEN
        RAISE EXCEPTION 'Acesso negado: privilégios de administrador necessários.';
    END IF;
    -- Papel ATUAL (auth.users E profiles), não o do JWT: admin rebaixado para aqui (20261199000000).
    IF NOT public.is_admin_atual() THEN
        RAISE EXCEPTION 'Acesso negado: privilégios de administrador necessários.';
    END IF;

    v_offset := p_page * p_page_size;

    -- Contagem, numa passada só: dentro da janela (é o total que o laço do
    -- front persegue) e fora dela (o número que impede o recorte de
    -- mentir). p_dias NULL = sem janela: dentro = todos, fora = 0.
    --
    -- "Fora" conta SÓ o cancelado antigo que ainda tem PENDÊNCIA REAL, pela
    -- mesma regra dos dois baldes do painel (AdminOrdersView.tsx):
    --   (a) DINHEIRO a devolver: o pagamento ENTROU (pago, pago_apos_expirar
    --       ou recebido_na_entrega) e ainda sobra valor depois de descontar o
    --       reembolso manual de devolução concluída e o estorno já confirmado
    --       (a mesma conta de valorDevolverAgora, em src/lib);
    --   (b) MERCADORIA a voltar: o pedido foi enviado e cancelado depois de
    --       sair, e o produto ainda não foi confirmado de volta.
    -- Cancelado antigo sem pagamento e sem envio, ou já devolvido e com o
    -- produto de volta, não tem o que fazer e não entra. A conta pode sobrar
    -- (nunca faltar): nada é descontado pelo estorno "em andamento", que o
    -- painel também mantém na lista. O total de DENTRO da janela não muda.
    SELECT
        COUNT(*) FILTER (
          WHERE p_dias IS NULL
             OR cancelado_em >= now() - make_interval(days => p_dias)
        ),
        COUNT(*) FILTER (
          WHERE p_dias IS NOT NULL
            AND cancelado_em < now() - make_interval(days => p_dias)
            AND pendente
        )
      INTO v_total_count, v_fora_da_janela
      FROM (
        SELECT o.id,
               COALESCE(h.cancelado_em, o.updated_at) AS cancelado_em,
               COALESCE(
                 (o.cancelled_after_shipping IS TRUE AND o.returned_to_seller_at IS NULL)
                 OR CASE
                      WHEN o.payment_status IN ('pago', 'pago_apos_expirar', 'recebido_na_entrega')
                        THEN o.total
                             - COALESCE((SELECT sum(d.valor_reembolso)
                                           FROM public.devolucoes d
                                          WHERE d.order_id = o.id
                                            AND d.status = 'concluida'
                                            AND d.reembolso_manual), 0)
                             - COALESCE(o.valor_estornado, 0) > 0
                      ELSE FALSE
                    END,
                 FALSE) AS pendente
          FROM public.marketplace_orders o
          LEFT JOIN LATERAL (
            SELECT MAX(hi.created_at) AS cancelado_em
              FROM public.marketplace_order_history hi
             WHERE hi.order_id = o.id
               AND hi.new_status = 'cancelled'
          ) h ON TRUE
         WHERE o.status = 'cancelled'
      ) c;

    -- Linhas enxutas: as 23 colunas que o mapper e o painel leem, mais a
    -- coluna nova do achado 1 (rodada 2), na ordem de atenção do
    -- cancelamento (mais recente primeiro). Nenhum item, nenhum endereço.
    SELECT COALESCE(
        jsonb_agg(t),
        '[]'::JSONB
    ) INTO v_data
    FROM (
        SELECT jsonb_build_object(
            'id', c.id,
            'user_id', c.user_id,
            'customer_name', c.customer_name,
            'customer_data', c.customer_data,
            'total', c.total,
            'subtotal', c.subtotal,
            'shipping', c.shipping,
            'discount', c.discount,
            'payment_method', c.payment_method,
            'payment_status', c.payment_status,
            'status', c.status,
            'notes', c.notes,
            'coupon_code', c.coupon_code,
            'tracking_code', c.tracking_code,
            'cancelled_after_shipping', c.cancelled_after_shipping,
            'returned_to_seller_at', c.returned_to_seller_at,
            'pagamento_recebido_em', c.pagamento_recebido_em,
            'pagamento_recebido_por', c.pagamento_recebido_por,
            'canal', c.canal,
            'vendedor_id', c.vendedor_id,
            'created_at', c.created_at,
            'updated_at', c.updated_at,
            'cancelado_em', c.cancelado_em,
            'valor_devolvido_por_devolucao', c.valor_devolvido_por_devolucao,
            'valor_estornado', c.valor_estornado
        ) AS t
        FROM (
            SELECT o.id,
                   o.user_id,
                   o.customer_name,
                   o.customer_data,
                   o.total,
                   o.subtotal,
                   o.shipping,
                   o.discount,
                   o.payment_method,
                   o.payment_status,
                   o.status,
                   o.notes,
                   o.coupon_code,
                   o.tracking_code,
                   o.cancelled_after_shipping,
                   o.returned_to_seller_at,
                   o.pagamento_recebido_em,
                   o.pagamento_recebido_por,
                   o.canal,
                   o.vendedor_id,
                   o.created_at,
                   o.updated_at,
                   COALESCE(h.cancelado_em, o.updated_at) AS cancelado_em,
                   COALESCE((SELECT sum(d.valor_reembolso) FROM public.devolucoes d
                              WHERE d.order_id = o.id AND d.status = 'concluida' AND d.reembolso_manual), 0)
                     AS valor_devolvido_por_devolucao,
                   -- Achado A4 (revisão 26/09/2026, rodada 3): o "Devolver
                   -- agora" também precisa saber o que já saiu pelo ledger
                   -- CONFIRMADO (order_refunds concluído, coluna somada só em
                   -- concluir_estorno) — sem isto, um estorno parcial já
                   -- pago pelo MP não descontava do valor que falta.
                   o.valor_estornado
              FROM public.marketplace_orders o
              LEFT JOIN LATERAL (
                SELECT MAX(hi.created_at) AS cancelado_em
                  FROM public.marketplace_order_history hi
                 WHERE hi.order_id = o.id
                   AND hi.new_status = 'cancelled'
              ) h ON TRUE
             WHERE o.status = 'cancelled'
               AND (p_dias IS NULL OR COALESCE(h.cancelado_em, o.updated_at) >= now() - make_interval(days => p_dias))
             ORDER BY COALESCE(h.cancelado_em, o.updated_at) DESC, o.created_at DESC
             LIMIT p_page_size
            OFFSET v_offset
        ) c
    ) t;

    RETURN jsonb_build_object(
        'data', v_data,
        'total_count', v_total_count,
        'fora_da_janela', v_fora_da_janela
    );
END;
$$;

DO $conferencia_20261380000000$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p WHERE p.oid = to_regprocedure('public.get_admin_orders_cancelados_recentes(integer,integer,integer)')
      AND md5(replace(p.prosrc, E'\r', '')) = '9567454f17698f3f0624cca0b06458cd'
      AND (to_jsonb(p) - 'prosrc') = current_setting('ikcous.cancelados1380_atributos')::jsonb
  ) THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: conferencia 20261380 falhou (corpo ou atributos alterados).';
  END IF;
END $conferencia_20261380000000$;

NOTIFY pgrst, 'reload schema';
