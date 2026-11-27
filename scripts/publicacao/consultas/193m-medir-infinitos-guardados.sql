-- 193m-medir-infinitos-guardados: MEDICAO, so leitura, de quantos valores infinitos (Infinity ou -Infinity) JA ESTAO GUARDADOS nas
-- tres colunas que a 20261560000000 (o infinito nao entra no banco) fecha: store_config.local_delivery_fee,
-- product_variants.price_override e coupons.value. Rodar em CADA loja assinante ANTES do apply. Contagem maior que 0 numa coluna =
-- aquela linha sai ok=false, e a migration se RECUSA nessa loja (guarda B1_BASELINE_DIVERGENT): ela sai da release
-- (`migrationsForaDaRelease`) ate a lojista corrigir o valor (decisao dela; nada aqui corrige). Depois do apply tudo segue 0.
--
-- Diferente das outras "m" (rol aberto, sem `ok`), esta e' de ROL FECHADO com `ok` = (contagem = 0): o VEREDITO-CONSULTA do run
-- diz `ok_false=0 rol=ok` so com as tres em 0. Mesmo assim NAO e' prova do portao: nenhum lote do canais-de-backend.json a cita.
--
-- A conta e' a MESMA expressao da guarda e das restricoes da migration: NULL nao conta (variacao que herda o preco do produto),
-- NaN, negativo e finito enorme nao contam, e toda grafia que o Postgres le como infinito ('inf', '+Infinity', '-INF') conta igual.
-- NENHUM DADO DE LINHA: so tres count(*); nenhum id, valor, codigo de cupom, nome ou texto da loja sai no log do run.
-- QUEM LE: o papel so-leitura do workflow. O item `controle` reprova se a RLS VALER para quem leu em qualquer das tres tabelas
-- (a contagem sairia baixa: um 0 que nao e' o da loja). Tabela ausente ou sem SELECT: a consulta inteira ERRA, nunca devolve 0.
-- tests/migration_o_infinito_nao_entra_no_banco_test.ts prende o texto; tests/banco/o-infinito-nao-entra-no-banco-viva.cjs a EXECUTA.
WITH itens(item, esperado, vivo) AS (
  SELECT 'controle: a RLS nao vale para quem leu em store_config, product_variants e coupons (a contagem e da loja inteira)', 'sim', CASE WHEN
    NOT row_security_active('public.store_config') AND NOT row_security_active('public.product_variants') AND NOT row_security_active('public.coupons')
    THEN 'sim' ELSE 'nao' END
  UNION ALL SELECT 'store_config.local_delivery_fee: linhas com Infinity ou -Infinity ja guardado', '0',
    (SELECT count(*) FROM public.store_config WHERE NOT (local_delivery_fee <> 'Infinity'::numeric AND local_delivery_fee <> '-Infinity'::numeric))::text
  UNION ALL SELECT 'product_variants.price_override: linhas com Infinity ou -Infinity ja guardado (NULL nao conta)', '0',
    (SELECT count(*) FROM public.product_variants WHERE NOT (price_override IS NULL OR (price_override <> 'Infinity'::numeric AND price_override <> '-Infinity'::numeric)))::text
  UNION ALL SELECT 'coupons.value: linhas com Infinity ou -Infinity ja guardado', '0',
    (SELECT count(*) FROM public.coupons WHERE NOT (value <> 'Infinity'::numeric AND value <> '-Infinity'::numeric))::text
)
SELECT item, esperado, vivo, COALESCE(vivo = esperado, false) AS ok FROM itens ORDER BY ok, item;
