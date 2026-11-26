-- 187b-antes-a-saude-da-reconciliacao-ausente: ANTES da 20261500000000 (ou depois do rollback-manual-destrutivo dela). SO LEITURA, somente catalogo, rol fechado de
-- 5 linhas. Nao le nenhuma linha. As linhas 2 a 4 provam que os tres objetos da migration ainda NAO existem (nem com outra assinatura): se vier "nao" nelas ANTES do
-- apply, alguem ja criou algo com esse nome e o pre-voo da migration pode recusar (B1_BASELINE_DIVERGENT, nada escrito) — meca antes. A linha 5 e' a base que o pre-voo
-- exige (os tres papeis do Supabase).
WITH itens(item, esperado, vivo) AS (
  SELECT 'controle: catalogo publico visivel', 'sim', CASE WHEN EXISTS (SELECT 1 FROM pg_class WHERE relnamespace = 'public'::regnamespace) THEN 'sim' ELSE 'nao' END
  UNION ALL SELECT 'saude_da_reconciliacao: a tabela ainda NAO existe', 'sim', CASE WHEN
    to_regclass('public.saude_da_reconciliacao') IS NULL THEN 'sim' ELSE 'nao' END
  UNION ALL SELECT 'saude_da_reconciliacao_registrar: ainda NAO existe (nenhuma funcao com esse nome em public)', 'sim', CASE WHEN
    NOT EXISTS (SELECT 1 FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname = 'saude_da_reconciliacao_registrar') THEN 'sim' ELSE 'nao' END
  UNION ALL SELECT 'saude_da_loja: ainda NAO existe (nenhuma funcao com esse nome em public)', 'sim', CASE WHEN
    NOT EXISTS (SELECT 1 FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname = 'saude_da_loja') THEN 'sim' ELSE 'nao' END
  UNION ALL SELECT 'os papeis anon, authenticated e service_role existem (a base que o pre-voo exige)', 'sim', CASE WHEN
    (SELECT count(*) FROM pg_roles WHERE rolname IN ('anon', 'authenticated', 'service_role')) = 3 THEN 'sim' ELSE 'nao' END
)
SELECT item, esperado, vivo, COALESCE(vivo = esperado, false) AS ok FROM itens ORDER BY ok, item;
