-- 5a — Antes de aplicar a 79 (20261179000000_cancelar_devolucao_barra_compra_
-- em_voo.sql, frente fix/devolucao-pos-revisao) e a 80
-- (supabase/migrations/20261180000000_cliente_nao_cancela_com_cartao_vivo.sql,
-- esta frente): confere se o banco está no estado que as duas migrations
-- esperam encontrar antes do primeiro CREATE.
--
-- Automatiza o runbook §7.0 daquela outra frente (o "cole no SQL Editor"
-- antes da 79 — arquivo fora desta árvore; só o valor final é usado aqui,
-- conferido contra o corpo de `cancelar_devolucao` que a 20261175000000
-- deixa nesta mesma árvore) e o `DO $preflight_20261180$` da 80
-- (supabase/migrations/20261180000000_cliente_nao_cancela_com_cartao_vivo.sql),
-- com as MESMAS checagens e os MESMOS hashes (md5(replace(prosrc, E'\r',
-- '')), pronamespace = 'public'::regnamespace).
--
-- Esperado ANTES de aplicar 79 e 80: todas as linhas com ok = true. As três
-- linhas "ainda não aplicada"/"aceito" ficam ok = false DE PROPÓSITO depois
-- que 79 ou 80 forem aplicadas — não é regressão, é o AVISO de que esta
-- consulta deixou de descrever o "antes" (rode a conferência específica de
-- cada migration nesse caso: o §7.x daquela outra frente para a 79, e
-- `pg_get_functiondef` direto para a 80).
SELECT
  'cancelar_devolucao: corpo é o baseline que a 79 espera (runbook §7.0 de fix/devolucao-pos-revisao)' AS checagem,
  COALESCE(
    (SELECT md5(replace(prosrc, E'\r', '')) FROM pg_proc
      WHERE pronamespace = 'public'::regnamespace AND proname = 'cancelar_devolucao'),
    '(função ausente)'
  ) AS valor,
  '45c56a39cc29f31ec5ff904f1929737e' AS esperado,
  COALESCE(
    (SELECT md5(replace(prosrc, E'\r', '')) FROM pg_proc
      WHERE pronamespace = 'public'::regnamespace AND proname = 'cancelar_devolucao')
      = '45c56a39cc29f31ec5ff904f1929737e',
    false
  ) AS ok
UNION ALL
SELECT
  '79 ainda não aplicada (admin_devolucao_liberar_vinculo_reverso ausente)',
  (NOT EXISTS (
    SELECT 1 FROM pg_proc
     WHERE pronamespace = 'public'::regnamespace
       AND proname = 'admin_devolucao_liberar_vinculo_reverso'
  ))::text,
  'true',
  NOT EXISTS (
    SELECT 1 FROM pg_proc
     WHERE pronamespace = 'public'::regnamespace
       AND proname = 'admin_devolucao_liberar_vinculo_reverso'
  )
UNION ALL
SELECT
  '80 pré-voo: marketplace_orders.metodo_online existe',
  (EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'marketplace_orders'
       AND column_name = 'metodo_online'
  ))::text,
  'true',
  EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'marketplace_orders'
       AND column_name = 'metodo_online'
  )
UNION ALL
SELECT
  '80 pré-voo: public.devolucoes existe',
  (to_regclass('public.devolucoes') IS NOT NULL)::text,
  'true',
  to_regclass('public.devolucoes') IS NOT NULL
UNION ALL
SELECT
  '80 pré-voo: corpo de update_order_status_atomic aceito (baseline da 75 ou o que a própria 80 deixa)',
  COALESCE(
    (SELECT md5(replace(prosrc, E'\r', '')) FROM pg_proc
      WHERE pronamespace = 'public'::regnamespace AND proname = 'update_order_status_atomic'),
    '(função ausente)'
  ),
  '8bda9131ed0a7929ef5aa13df84238e3 (75) ou ed2f7fd3e0177c027720049b2fe55d3b (80)',
  COALESCE(
    (SELECT md5(replace(prosrc, E'\r', '')) FROM pg_proc
      WHERE pronamespace = 'public'::regnamespace AND proname = 'update_order_status_atomic')
      IN ('8bda9131ed0a7929ef5aa13df84238e3', 'ed2f7fd3e0177c027720049b2fe55d3b'),
    false
  )
UNION ALL
SELECT
  '80 ainda não aplicada (corpo de update_order_status_atomic sem o marcador verificando: da guarda de cartão vivo)',
  COALESCE(
    (SELECT (pg_get_functiondef(oid) NOT LIKE '%verificando:%')::text FROM pg_proc
      WHERE pronamespace = 'public'::regnamespace AND proname = 'update_order_status_atomic'),
    '(função ausente)'
  ),
  'true',
  COALESCE(
    (SELECT pg_get_functiondef(oid) NOT LIKE '%verificando:%' FROM pg_proc
      WHERE pronamespace = 'public'::regnamespace AND proname = 'update_order_status_atomic'),
    false
  )
ORDER BY ok, checagem;
