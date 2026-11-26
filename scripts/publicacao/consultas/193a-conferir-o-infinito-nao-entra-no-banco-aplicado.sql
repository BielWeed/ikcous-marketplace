-- 193a-conferir-o-infinito-nao-entra-no-banco-aplicado: DEPOIS da 20261560000000 (os CHECKs store_config_local_delivery_fee_finito,
-- product_variants_price_override_finito e coupons_value_finito). SO LEITURA, somente catalogo, rol fechado de 4 linhas. Nao le
-- nenhuma linha da loja. Antes do apply responde "nao" nas tres linhas dos CHECKs (a 193a negativa e' esperada), nunca erro. Cada
-- linha aceita NOT VALID ou ja validado (o mesmo que a conferencia da migration aceita). A contagem de valores infinitos que ja
-- existiam NAO mora aqui (esta consulta nao le dado): ela esta no cabecalho da migration, para rodar a mao em cada loja ANTES do apply.
WITH itens(item, esperado, vivo) AS (
  SELECT 'controle: catalogo publico visivel', 'sim', CASE WHEN EXISTS (SELECT 1 FROM pg_class WHERE relnamespace = 'public'::regnamespace) THEN 'sim' ELSE 'nao' END
  UNION ALL SELECT 'store_config: CHECK store_config_local_delivery_fee_finito (sem Infinity nem -Infinity na taxa de entrega local) existe', 'sim', CASE WHEN EXISTS (
    SELECT 1 FROM pg_constraint c WHERE c.conrelid = to_regclass('public.store_config') AND c.conname = 'store_config_local_delivery_fee_finito' AND c.contype = 'c'
       AND pg_get_constraintdef(c.oid) IN ('CHECK (((local_delivery_fee <> ''Infinity''::numeric) AND (local_delivery_fee <> ''-Infinity''::numeric))) NOT VALID',
                                           'CHECK (((local_delivery_fee <> ''Infinity''::numeric) AND (local_delivery_fee <> ''-Infinity''::numeric)))')) THEN 'sim' ELSE 'nao' END
  UNION ALL SELECT 'product_variants: CHECK product_variants_price_override_finito (sem Infinity nem -Infinity no preco proprio da variacao; NULL segue valendo) existe', 'sim', CASE WHEN EXISTS (
    SELECT 1 FROM pg_constraint c WHERE c.conrelid = to_regclass('public.product_variants') AND c.conname = 'product_variants_price_override_finito' AND c.contype = 'c'
       AND pg_get_constraintdef(c.oid) IN ('CHECK (((price_override IS NULL) OR ((price_override <> ''Infinity''::numeric) AND (price_override <> ''-Infinity''::numeric)))) NOT VALID',
                                           'CHECK (((price_override IS NULL) OR ((price_override <> ''Infinity''::numeric) AND (price_override <> ''-Infinity''::numeric))))')) THEN 'sim' ELSE 'nao' END
  UNION ALL SELECT 'coupons: CHECK coupons_value_finito (sem Infinity nem -Infinity no valor do cupom) existe', 'sim', CASE WHEN EXISTS (
    SELECT 1 FROM pg_constraint c WHERE c.conrelid = to_regclass('public.coupons') AND c.conname = 'coupons_value_finito' AND c.contype = 'c'
       AND pg_get_constraintdef(c.oid) IN ('CHECK (((value <> ''Infinity''::numeric) AND (value <> ''-Infinity''::numeric))) NOT VALID',
                                           'CHECK (((value <> ''Infinity''::numeric) AND (value <> ''-Infinity''::numeric)))')) THEN 'sim' ELSE 'nao' END
)
SELECT item, esperado, vivo, COALESCE(vivo = esperado, false) AS ok FROM itens ORDER BY ok, item;
