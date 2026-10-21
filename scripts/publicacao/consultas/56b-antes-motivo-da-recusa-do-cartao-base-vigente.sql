-- 56b-antes-motivo-da-recusa-do-cartao-base-vigente: somente catalogo, 4 linhas fixas; nenhuma tentativa de cartao e lida.
-- Prova a AUSENCIA: a tabela, os indices e a restricao unica da 20261260000000 ainda nao existem e as dependencias estao de pe.
-- Uma loja que ja tem a migration reprova aqui de proposito, na linha da tabela.
WITH itens(item, esperado, vivo) AS (
  SELECT 'controle: funcoes de public visiveis a este papel', 'sim', CASE WHEN COALESCE(((SELECT count(*) > 0 FROM pg_proc WHERE pronamespace = 'public'::regnamespace)), false) THEN 'sim' ELSE 'nao' END
  UNION ALL
  SELECT 'tentativas_cartao_diagnostico: tabela, indices e restricao unica ainda nao existem', 'sim', CASE WHEN COALESCE((to_regclass('public.tentativas_cartao_diagnostico') IS NULL
    AND to_regclass('public.tentativas_cartao_diagnostico_pedido_idx') IS NULL
    AND to_regclass('public.tentativas_cartao_diagnostico_order_payment_key') IS NULL
    AND NOT EXISTS (SELECT 1 FROM pg_type WHERE typnamespace = 'public'::regnamespace AND typname IN ('tentativas_cartao_diagnostico', '_tentativas_cartao_diagnostico'))), false) THEN 'sim' ELSE 'nao' END
  UNION ALL
  SELECT 'dependencias: marketplace_orders (id uuid) existe', 'sim', CASE WHEN COALESCE(((SELECT relkind = 'r' FROM pg_class WHERE oid = to_regclass('public.marketplace_orders'))
    AND (SELECT format_type(a.atttypid, a.atttypmod) FROM pg_attribute a WHERE a.attrelid = to_regclass('public.marketplace_orders') AND a.attname = 'id' AND NOT a.attisdropped) = 'uuid'), false) THEN 'sim' ELSE 'nao' END
  UNION ALL
  SELECT 'dependencias: os papeis anon, authenticated e service_role existem', 'sim', CASE WHEN COALESCE(((SELECT count(*) FROM pg_roles WHERE rolname IN ('anon', 'authenticated', 'service_role')) = 3), false) THEN 'sim' ELSE 'nao' END
)
SELECT item, esperado, vivo, vivo = esperado AS ok FROM itens ORDER BY ok, item;
