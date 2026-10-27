-- 113b-antes-a-pergunta-nasce-com-a-data-de-agora-ausente: ANTES da 20261396100000 (ou depois do rollback-manual dela). SO LEITURA, somente catalogo,
-- rol fechado de 4 linhas. Nao le nenhuma pergunta. Antes do apply tudo "sim"; depois do apply a linha dos objetos novos fica "nao" de proposito.
WITH itens(item, esperado, vivo) AS (
  SELECT 'controle: catalogo publico visivel', 'sim', CASE WHEN EXISTS (SELECT 1 FROM pg_class WHERE relnamespace = 'public'::regnamespace) THEN 'sim' ELSE 'nao' END
  UNION ALL SELECT 'pergunta_nasce_com_a_data_de_agora e tr_pergunta_nasce_com_a_data_de_agora: ainda NAO existem', 'sim', CASE WHEN
    NOT EXISTS (SELECT 1 FROM pg_proc WHERE pronamespace = 'public'::regnamespace AND proname = 'pergunta_nasce_com_a_data_de_agora')
    AND NOT EXISTS (SELECT 1 FROM pg_trigger t WHERE t.tgname = 'tr_pergunta_nasce_com_a_data_de_agora') THEN 'sim' ELSE 'nao' END
  UNION ALL SELECT 'questions: created_at timestamptz existe e a tabela tem RLS ligada', 'sim', CASE WHEN
    EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = to_regclass('public.questions') AND attname = 'created_at'
              AND atttypid = 'timestamptz'::regtype AND NOT attisdropped)
    AND EXISTS (SELECT 1 FROM pg_class WHERE oid = to_regclass('public.questions') AND relkind = 'r' AND relrowsecurity) THEN 'sim' ELSE 'nao' END
  UNION ALL SELECT 'rls_admin_atual() existe, devolve boolean e e a porta do administrador de agora (a excecao do gatilho depende dela)', 'sim', CASE WHEN COALESCE(
    (SELECT p.prorettype = 'boolean'::regtype FROM pg_proc p WHERE p.oid = to_regprocedure('public.rls_admin_atual()')), false) THEN 'sim' ELSE 'nao' END
)
SELECT item, esperado, vivo, COALESCE(vivo = esperado, false) AS ok FROM itens ORDER BY ok, item;
