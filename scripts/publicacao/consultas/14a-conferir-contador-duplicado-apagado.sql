-- 14a - DEPOIS de aplicar a migration 20261207000000 (o contador duplicado do cupom
-- morre: apaga `public.coupons.used_count`): confere, por OBJETO, que a coluna sumiu e
-- que NADA do que ela nao devia tocar mudou. E' a prova de objetos do lote
-- `20261207000000` em scripts/frota/canais-de-backend.json: o portao
-- (scripts/frota/publicar-release.mjs) so libera a release com esta
-- consulta POSITIVA (ou, antes do apply, NEGATIVA com a 14b positiva).
-- SO LEITURA, um unico SELECT, so catalogo (pg_attribute, pg_attrdef, pg_proc,
-- pg_namespace): nenhuma linha de cupom, pedido ou cliente e' lida nem devolvida.
--
-- Saida: item | esperado | vivo | ok, com as linhas ok = false primeiro. O rol e'
-- FECHADO: sempre as mesmas 7 linhas, em qualquer estado do banco (objeto ausente vira
-- `AUSENTE` na propria linha, nunca some uma linha). Tudo `true` = a migration esta
-- inteira no banco. Um `false` nomeia o que ficou de fora ou divergiu.
--
-- O QUE CADA LINHA PROVA
--   * controle        -- o papel enxerga as funcoes de `public`.
--   * used_count      -- a coluna esta AUSENTE de `public.coupons`.
--   * usage_count     -- continua la, integer, DEFAULT 0 (o contador verdadeiro nao foi
--                        tocado).
--   * validate_coupon_secure_v2 -- UMA sobrecarga, corpo (sha256) igual ao que a 10a
--                        trava (o da 20261203000000; LF ou CRLF): a migration nao a
--                        redefine, e um corpo diferente aqui e' de outra migration.
--   * devolver_cupons_de_pedidos_mortos -- UMA sobrecarga, corpo (sha256) igual ao que
--                        a 12a trava (o da 20261206000000; LF ou CRLF), pelo mesmo motivo.
--
-- Os hashes sao os MESMOS da 10a e da 12a (tests/ci_conferir_banco_test.ts os compara
-- com os literais dessas duas consultas e com o corpo das migrations). sha256 =
-- encode(sha256(convert_to(prosrc, 'UTF8')), 'hex').
--
-- LIMITES: nao prova valor nenhum (que `usage_count` ficou intacto, linha a linha, e' a
-- prova viva da migration em tests/banco/contador-duplicado-viva.cjs; aqui so o catalogo).
-- Nao prova que o front publicado nao cita a coluna. Evidencia LOCAL nao prova a IKCOUS
-- nem a Savy: so o run desta consulta contra o ref de cada loja.
WITH tab AS (
  SELECT to_regclass('public.coupons') AS oid
), uso AS (
  SELECT format_type(a.atttypid, a.atttypmod) AS tipo,
         pg_get_expr(ad.adbin, ad.adrelid) AS padrao
    FROM pg_attribute a
    LEFT JOIN pg_attrdef ad ON ad.adrelid = a.attrelid AND ad.adnum = a.attnum
   WHERE a.attrelid = (SELECT oid FROM tab)
     AND a.attname = 'usage_count' AND a.attnum > 0 AND NOT a.attisdropped
), validar AS (
  SELECT encode(sha256(convert_to(p.prosrc, 'UTF8')), 'hex') AS h
    FROM pg_proc p
   WHERE p.oid = to_regprocedure('public.validate_coupon_secure_v2(text,numeric)')
), varredura AS (
  SELECT encode(sha256(convert_to(p.prosrc, 'UTF8')), 'hex') AS h
    FROM pg_proc p
   WHERE p.oid = to_regprocedure('public.devolver_cupons_de_pedidos_mortos()')
), itens(item, esperado, vivo) AS (
  SELECT 'controle: funcoes de public visiveis a este papel', '>0',
         CASE WHEN (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                     WHERE n.nspname = 'public') > 0 THEN '>0' ELSE '0' END
  UNION ALL
  SELECT 'coupons.used_count: coluna', 'AUSENTE',
         CASE WHEN EXISTS (SELECT 1 FROM pg_attribute a
                            WHERE a.attrelid = (SELECT oid FROM tab)
                              AND a.attname = 'used_count' AND a.attnum > 0 AND NOT a.attisdropped)
              THEN 'PRESENTE' ELSE 'AUSENTE' END
  UNION ALL
  SELECT 'coupons.usage_count: tipo e default', 'integer DEFAULT 0',
         COALESCE((SELECT u.tipo || ' DEFAULT ' || COALESCE(u.padrao, 'nenhum') FROM uso u), 'AUSENTE')
  UNION ALL
  SELECT 'validate_coupon_secure_v2: sobrecargas', '1',
         (SELECT count(*)::text FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
           WHERE n.nspname = 'public' AND p.proname = 'validate_coupon_secure_v2')
  UNION ALL
  SELECT 'validate_coupon_secure_v2: corpo (sha256)',
         '489c0cd19b3529ef2d9cf341096ee9b0048e5787ff0a2d0a918df4db580e82f3',
         COALESCE((SELECT CASE WHEN v.h IN ('489c0cd19b3529ef2d9cf341096ee9b0048e5787ff0a2d0a918df4db580e82f3',
                                            '4b096e67be79665d70e86ff5e94953ecf5842cd64abca882abac0f6cbe328279')
                               THEN '489c0cd19b3529ef2d9cf341096ee9b0048e5787ff0a2d0a918df4db580e82f3'
                               ELSE v.h END
                     FROM validar v), 'AUSENTE')
  UNION ALL
  SELECT 'devolver_cupons_de_pedidos_mortos: sobrecargas', '1',
         (SELECT count(*)::text FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
           WHERE n.nspname = 'public' AND p.proname = 'devolver_cupons_de_pedidos_mortos')
  UNION ALL
  SELECT 'devolver_cupons_de_pedidos_mortos: corpo (sha256)',
         'f35db1e788fb8e0472dd6b8318c69be524c3f932d62c5f7b2856fe97d243eb4f',
         COALESCE((SELECT CASE WHEN v.h IN ('f35db1e788fb8e0472dd6b8318c69be524c3f932d62c5f7b2856fe97d243eb4f',
                                            'c7e38a04defe6b286519f2325c6d4d8ec727f57c4b0edbb5bc5831d936fbe9b8')
                               THEN 'f35db1e788fb8e0472dd6b8318c69be524c3f932d62c5f7b2856fe97d243eb4f'
                               ELSE v.h END
                     FROM varredura v), 'AUSENTE')
)
SELECT item, esperado, vivo, COALESCE(vivo = esperado, false) AS ok
  FROM itens
 ORDER BY ok, item;
