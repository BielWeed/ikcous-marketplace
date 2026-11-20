-- ANTES da 20261411000000. So leitura: catalogo e numero agregado de
-- grupos com colisao, incluindo cupons inativos. Nenhum codigo sai daqui.
WITH estado AS (
  SELECT to_regclass('public.coupons_code_upper_uidx') IS NULL AS ausente,
         CASE WHEN NOT row_security_active('public.coupons'::regclass) THEN (
           SELECT count(*)::text
           FROM (
             SELECT 1 FROM public.coupons
             GROUP BY pg_catalog.upper(code)
             HAVING count(*) > 1
           ) AS grupos
         ) ELSE 'INDISPONIVEL' END AS colisoes
), itens(item, esperado, vivo, ok) AS (
  SELECT 'cupom: indice de codigo em maiusculas ausente', 'sim',
         CASE WHEN ausente THEN 'sim' ELSE 'nao' END, ausente FROM estado
  UNION ALL
  SELECT 'cupom: grupos de codigos em colisao', '0',
         colisoes, colisoes = '0' FROM estado
)
SELECT item, esperado, vivo, ok FROM itens ORDER BY ok, item;
