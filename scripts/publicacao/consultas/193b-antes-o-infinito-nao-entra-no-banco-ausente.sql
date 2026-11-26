-- 193b-antes-o-infinito-nao-entra-no-banco-ausente: ANTES da 20261560000000 (ou depois do rollback-manual dela). SO LEITURA, somente
-- catalogo, rol fechado de 5 linhas. Nao le nenhuma linha da loja. Antes do apply tudo "sim"; depois do apply as tres linhas dos
-- CHECKs ficam "nao" de proposito. A ultima linha e' a base do pre-voo: produtos.preco_venda tem de ser numeric COM precisao (o
-- tipo ja recusa infinito; sem precisao a migration se recusa, porque nao a cobre).
WITH itens(item, esperado, vivo) AS (
  SELECT 'controle: catalogo publico visivel', 'sim', CASE WHEN EXISTS (SELECT 1 FROM pg_class WHERE relnamespace = 'public'::regnamespace) THEN 'sim' ELSE 'nao' END
  UNION ALL SELECT 'store_config.local_delivery_fee: e numeric e o CHECK store_config_local_delivery_fee_finito ainda NAO existe', 'sim', CASE WHEN
    EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = to_regclass('public.store_config') AND attname = 'local_delivery_fee' AND atttypid = 'numeric'::regtype AND NOT attisdropped)
    AND NOT EXISTS (SELECT 1 FROM pg_constraint c WHERE c.conname = 'store_config_local_delivery_fee_finito') THEN 'sim' ELSE 'nao' END
  UNION ALL SELECT 'product_variants.price_override: e numeric e o CHECK product_variants_price_override_finito ainda NAO existe', 'sim', CASE WHEN
    EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = to_regclass('public.product_variants') AND attname = 'price_override' AND atttypid = 'numeric'::regtype AND NOT attisdropped)
    AND NOT EXISTS (SELECT 1 FROM pg_constraint c WHERE c.conname = 'product_variants_price_override_finito') THEN 'sim' ELSE 'nao' END
  UNION ALL SELECT 'coupons.value: e numeric e o CHECK coupons_value_finito ainda NAO existe', 'sim', CASE WHEN
    EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = to_regclass('public.coupons') AND attname = 'value' AND atttypid = 'numeric'::regtype AND NOT attisdropped)
    AND NOT EXISTS (SELECT 1 FROM pg_constraint c WHERE c.conname = 'coupons_value_finito') THEN 'sim' ELSE 'nao' END
  UNION ALL SELECT 'produtos.preco_venda: e numeric COM precisao (o tipo ja recusa infinito; a base do pre-voo)', 'sim', CASE WHEN
    EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = to_regclass('public.produtos') AND attname = 'preco_venda' AND atttypid = 'numeric'::regtype AND atttypmod <> -1 AND NOT attisdropped) THEN 'sim' ELSE 'nao' END
)
SELECT item, esperado, vivo, COALESCE(vivo = esperado, false) AS ok FROM itens ORDER BY ok, item;
