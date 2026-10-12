-- 14a - DEPOIS de aplicar a migration 20261207000000 (o contador duplicado do cupom
-- morre: apaga `public.coupons.used_count`): confere, por OBJETO, que a coluna sumiu e que
-- o contador verdadeiro (`usage_count`) continua la, na forma do baseline. E' a prova de
-- objetos do lote `20261207000000` em scripts/frota/canais-de-backend.json: o portao
-- (scripts/frota/publicar-release.mjs) so libera a release com esta consulta POSITIVA (ou,
-- antes do apply, NEGATIVA com a 14b positiva).
-- SO LEITURA, um unico SELECT, so catalogo (pg_attribute, pg_attrdef, pg_proc,
-- pg_namespace): nenhuma linha de cupom, pedido ou cliente e' lida nem devolvida.
--
-- Saida: item | esperado | vivo | ok, com as linhas ok = false primeiro. O rol e'
-- FECHADO: sempre as mesmas 4 linhas, em qualquer estado do banco (objeto ausente vira
-- `AUSENTE` na propria linha, nunca some uma linha). Tudo `true` = a migration esta
-- inteira no banco. Um `false` nomeia o que ficou de fora ou divergiu.
--
-- O QUE CADA LINHA PROVA
--   * controle        -- o papel enxerga as funcoes de `public`.
--   * tabela          -- `public.coupons` existe.
--   * used_count      -- a coluna esta AUSENTE de `public.coupons`.
--   * usage_count     -- continua la, na forma do baseline: integer, aceita NULL, DEFAULT 0,
--                        nem gerada nem identidade (o contador verdadeiro nao foi tocado). E'
--                        a MESMA linha e a mesma forma que a 14b e o pre-voo da migration
--                        exigem ANTES do apply: o que a migration deixa para tras e' o que
--                        ela verificou antes.
--
-- Esta consulta NAO trava o corpo de nenhuma funcao: a migration nao toca funcao alguma
-- (`validate_coupon_secure_v2` e `devolver_cupons_de_pedidos_mortos` ficam como estao), e
-- quem trava esses corpos sao a 10a e a 12a, nos lotes delas. Travar aqui o mesmo hash
-- acoplaria este lote a elas e o deixaria vermelho a cada migration futura que mude essas
-- funcoes por um bom motivo.
--
-- LIMITES: nao prova valor nenhum (que `usage_count` ficou intacto, linha a linha, e' a
-- prova viva da migration em tests/banco/contador-duplicado-viva.cjs; aqui so o catalogo).
-- Nao prova que o front publicado nao cita a coluna. Evidencia LOCAL nao prova a IKCOUS
-- nem a Savy: so o run desta consulta contra o ref de cada loja.
WITH tab AS (
  SELECT to_regclass('public.coupons') AS oid
), uso AS (
  SELECT a.atttypid = 'integer'::regtype AND NOT a.attnotnull
         AND a.attgenerated = '' AND a.attidentity = ''
         AND pg_get_expr(ad.adbin, ad.adrelid) IS NOT DISTINCT FROM '0' AS forma_ok
    FROM pg_attribute a
    LEFT JOIN pg_attrdef ad ON ad.adrelid = a.attrelid AND ad.adnum = a.attnum
   WHERE a.attrelid = (SELECT oid FROM tab)
     AND a.attname = 'usage_count' AND a.attnum > 0 AND NOT a.attisdropped
), itens(item, esperado, vivo) AS (
  SELECT 'controle: funcoes de public visiveis a este papel', '>0',
         CASE WHEN (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                     WHERE n.nspname = 'public') > 0 THEN '>0' ELSE '0' END
  UNION ALL
  SELECT 'public.coupons: tabela', 'PRESENTE',
         CASE WHEN (SELECT oid FROM tab) IS NULL THEN 'AUSENTE' ELSE 'PRESENTE' END
  UNION ALL
  SELECT 'coupons.used_count: coluna', 'AUSENTE',
         CASE WHEN EXISTS (SELECT 1 FROM pg_attribute a
                            WHERE a.attrelid = (SELECT oid FROM tab)
                              AND a.attname = 'used_count' AND a.attnum > 0 AND NOT a.attisdropped)
              THEN 'PRESENTE' ELSE 'AUSENTE' END
  UNION ALL
  SELECT 'coupons.usage_count: forma do baseline (integer, aceita NULL, DEFAULT 0)', 'sim',
         COALESCE((SELECT CASE WHEN u.forma_ok THEN 'sim' ELSE 'nao' END FROM uso u), 'AUSENTE')
)
SELECT item, esperado, vivo, COALESCE(vivo = esperado, false) AS ok
  FROM itens
 ORDER BY ok, item;
