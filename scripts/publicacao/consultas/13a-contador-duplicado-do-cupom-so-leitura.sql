-- 13a - O contador duplicado do cupom (`coupons.used_count`): SO LEITURA, mede antes de decidir apagar.
-- Pergunta: a coluna so tem zeros e nada do banco depende dela? Uma linha por fato (item, valor).
-- `to_jsonb(c)` em vez do nome da coluna: nao quebra numa loja onde ela ja nao exista.
-- Quem le: `rls_visivel_ao_papel` = 'true' significa que a seguranca por linha pode esconder cupons deste papel;
-- nesse caso `cupons_total` pode estar menor que o real e o resultado NAO vale (conferir no SQL Editor).
SELECT item, valor FROM (
  SELECT 1 AS n, 'papel' AS item, current_user::text AS valor
  UNION ALL SELECT 2, 'rls_visivel_ao_papel', row_security_active('public.coupons')::text
  UNION ALL SELECT 3, 'coluna_existe', (SELECT count(*) FROM pg_attribute a
      WHERE a.attrelid = 'public.coupons'::regclass AND a.attname = 'used_count' AND NOT a.attisdropped)::text
  UNION ALL SELECT 4, 'cupons_total', count(*)::text FROM public.coupons
  UNION ALL SELECT 5, 'used_count_diferente_de_zero',
      count(*) FILTER (WHERE (to_jsonb(c) -> 'used_count') IS DISTINCT FROM '0'::jsonb)::text FROM public.coupons c
  UNION ALL SELECT 6, 'used_count_nulo',
      count(*) FILTER (WHERE (to_jsonb(c) -> 'used_count') = 'null'::jsonb)::text FROM public.coupons c
  UNION ALL SELECT 7, 'usage_count_diferente_de_zero',
      count(*) FILTER (WHERE usage_count IS DISTINCT FROM 0)::text FROM public.coupons
  UNION ALL SELECT 8, 'dependentes_da_coluna_fora_o_default', (SELECT count(*) FROM pg_depend d
      JOIN pg_attribute a ON a.attrelid = d.refobjid AND a.attnum = d.refobjsubid
      WHERE d.refobjid = 'public.coupons'::regclass AND a.attname = 'used_count'
        AND d.classid <> 'pg_attrdef'::regclass)::text
  UNION ALL SELECT 9, 'funcoes_que_citam', coalesce((SELECT string_agg(p.proname, ',' ORDER BY p.proname)
      FROM pg_proc p JOIN pg_namespace s ON s.oid = p.pronamespace
      WHERE s.nspname = 'public' AND p.prokind = 'f' AND p.prosrc ILIKE '%used\_count%'), '(nenhuma)')
  UNION ALL SELECT 10, 'politicas_que_citam', (SELECT count(*) FROM pg_policies
      WHERE schemaname = 'public' AND (qual ILIKE '%used\_count%' OR with_check ILIKE '%used\_count%'))::text
  UNION ALL SELECT 11, 'gatilhos_que_citam', (SELECT count(*) FROM pg_trigger t
      WHERE NOT t.tgisinternal AND pg_get_triggerdef(t.oid) ILIKE '%used\_count%')::text
  UNION ALL SELECT 12, 'visoes_que_citam', (SELECT count(*) FROM pg_views
      WHERE schemaname = 'public' AND definition ILIKE '%used\_count%')::text
) q ORDER BY n
