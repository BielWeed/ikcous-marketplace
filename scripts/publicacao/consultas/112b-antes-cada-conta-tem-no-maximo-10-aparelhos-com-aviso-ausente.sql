-- 112b-antes-cada-conta-tem-no-maximo-10-aparelhos-com-aviso-ausente: ANTES da 20261396000000 (ou depois do rollback-manual dela). SO LEITURA, somente catalogo,
-- rol fechado de 4 linhas. Nao le nenhuma inscricao. Antes do apply tudo "sim"; depois do apply a linha dos objetos novos fica "nao" de proposito.
WITH itens(item, esperado, vivo) AS (
  SELECT 'controle: catalogo publico visivel', 'sim', CASE WHEN EXISTS (SELECT 1 FROM pg_class WHERE relnamespace = 'public'::regnamespace) THEN 'sim' ELSE 'nao' END
  UNION ALL SELECT 'push_inscricoes_limite_por_conta e tr_push_inscricoes_limite_por_conta: ainda NAO existem', 'sim', CASE WHEN
    NOT EXISTS (SELECT 1 FROM pg_proc WHERE pronamespace = 'public'::regnamespace AND proname = 'push_inscricoes_limite_por_conta')
    AND NOT EXISTS (SELECT 1 FROM pg_trigger t WHERE t.tgname = 'tr_push_inscricoes_limite_por_conta') THEN 'sim' ELSE 'nao' END
  UNION ALL SELECT 'push_subscriptions: endpoint text e user_id uuid existem e a tabela tem RLS ligada', 'sim', CASE WHEN
    (SELECT count(*) FROM pg_attribute WHERE attrelid = to_regclass('public.push_subscriptions') AND NOT attisdropped
        AND ((attname = 'endpoint' AND atttypid = 'text'::regtype) OR (attname = 'user_id' AND atttypid = 'uuid'::regtype))) = 2
    AND EXISTS (SELECT 1 FROM pg_class WHERE oid = to_regclass('public.push_subscriptions') AND relkind = 'r' AND relrowsecurity) THEN 'sim' ELSE 'nao' END
  UNION ALL SELECT 'rls_admin_atual() existe, devolve boolean e e a porta do administrador de agora (a excecao do gatilho depende dela)', 'sim', CASE WHEN COALESCE(
    (SELECT p.prorettype = 'boolean'::regtype FROM pg_proc p WHERE p.oid = to_regprocedure('public.rls_admin_atual()')), false) THEN 'sim' ELSE 'nao' END
)
SELECT item, esperado, vivo, COALESCE(vivo = esperado, false) AS ok FROM itens ORDER BY ok, item;
