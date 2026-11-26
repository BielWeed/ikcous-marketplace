-- 191a-conferir-a-loja-nova-nasce-com-a-ficha-aplicado: DEPOIS da 20261540000000. SO LEITURA, rol fechado de 4 linhas.
-- A prova e' POR OBJETO: a MARCA que a migration deixa no catalogo (o comentario de public.store_config = 'ficha_da_loja_20261540000000') E a
-- ficha (a linha id = 1). Na IKCOUS e na Savy a linha ja existia antes do apply: sem a marca esta consulta seria positiva ANTES e o portao
-- pararia; com ela, so fica positiva depois. Le de store_config so a existencia da linha id = 1 e quantas linhas a leitura publica (v_store_config,
-- a que o porteiro e a identidade leem) devolve: nenhum valor de coluna sai daqui (e a ficha e' publica de qualquer forma).
WITH itens(item, esperado, vivo) AS (
  SELECT 'controle: catalogo publico visivel', 'sim', CASE WHEN EXISTS (SELECT 1 FROM pg_class WHERE relnamespace = 'public'::regnamespace) THEN 'sim' ELSE 'nao' END
  UNION ALL SELECT 'store_config: o comentario da tabela e a marca desta migration (ficha_da_loja_20261540000000)', 'sim', CASE WHEN
    to_regclass('public.store_config') IS NOT NULL
    AND obj_description(to_regclass('public.store_config'), 'pg_class') = 'ficha_da_loja_20261540000000' THEN 'sim' ELSE 'nao' END
  UNION ALL SELECT 'store_config: a ficha (linha id = 1) existe', 'sim', CASE WHEN
    to_regclass('public.store_config') IS NOT NULL
    AND EXISTS (SELECT 1 FROM public.store_config WHERE id = 1) THEN 'sim' ELSE 'nao' END
  UNION ALL SELECT 'v_store_config: a leitura publica devolve exatamente 1 linha (a que o porteiro e a identidade leem)', 'sim', CASE WHEN
    to_regclass('public.v_store_config') IS NOT NULL
    AND (SELECT count(*) FROM public.v_store_config) = 1 THEN 'sim' ELSE 'nao' END
)
SELECT item, esperado, vivo, COALESCE(vivo = esperado, false) AS ok FROM itens ORDER BY ok, item;
