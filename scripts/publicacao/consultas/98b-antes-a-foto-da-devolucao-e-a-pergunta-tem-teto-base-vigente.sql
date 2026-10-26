-- 98b-antes-a-foto-da-devolucao-e-a-pergunta-tem-teto-base-vigente: ANTES da 20261391000000 (ou depois do rollback-manual
-- dela). SO LEITURA, somente catalogo, rol fechado de 5 linhas. Prova que a politica de INSERT do cliente ainda tem a
-- condicao EXATA da 20261175000000 (a unica que a migration troca), que nenhuma outra politica de INSERT/ALL alcanca o
-- bucket (premissa do teto), que a funcao da contagem ainda nao existe e que questions.question e' text sem
-- o CHECK de 500 caracteres.
WITH pol AS (
  SELECT p.polname, p.polcmd, p.polpermissive, p.polroles, p.polqual,
         regexp_replace(replace(pg_get_expr(p.polwithcheck, p.polrelid), 'public.', ''), '[[:space:]]', '', 'g') AS chk,
         pg_get_expr(p.polwithcheck, p.polrelid) AS bruto
    FROM pg_policy p
   WHERE p.polrelid = to_regclass('storage.objects')
), itens(item, esperado, vivo) AS (
  SELECT 'controle: politicas de storage.objects visiveis a este papel', 'sim',
    CASE WHEN (SELECT count(*) FROM pol) > 0 THEN 'sim' ELSE 'nao' END
  UNION ALL SELECT 'devolucoes_cliente_insert_policy: INSERT so authenticated, na pasta do cliente, condicao EXATA da 20261175000000', 'sim',
    CASE WHEN EXISTS (SELECT 1 FROM pol WHERE polname = 'devolucoes_cliente_insert_policy' AND polcmd = 'a' AND polpermissive
                        AND polroles = ARRAY['authenticated'::regrole::oid] AND polqual IS NULL
                        AND chk = '((bucket_id=''devolucoes''::text)AND(split_part(name,''/''::text,1)=((SELECTauth.uid()ASuid))::text))') THEN 'sim' ELSE 'nao' END
  UNION ALL SELECT 'devolucoes: nenhuma outra politica INSERT/ALL alcanca o bucket', 'sim',
    CASE WHEN NOT EXISTS (
      SELECT 1 FROM pol
       WHERE polcmd IN ('a', '*') AND polpermissive AND polname <> 'devolucoes_cliente_insert_policy'
         AND NOT (COALESCE(bruto, '') ~ '^[(]+bucket_id = ''(banners|products|produtos|branding)''::text[)] AND '
                  AND COALESCE(bruto, '') !~ '[)] OR '
                  AND position('devolucoes' IN COALESCE(bruto, '')) = 0)) THEN 'sim' ELSE 'nao' END
  UNION ALL SELECT 'questions: question e text e o CHECK de 500 caracteres ainda NAO existe', 'sim',
    CASE WHEN NOT EXISTS (SELECT 1 FROM pg_constraint c WHERE c.conrelid = to_regclass('public.questions')
                        AND c.conname = 'questions_question_ate_500_caracteres')
          AND EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid = to_regclass('public.questions')
                        AND a.attname = 'question' AND a.atttypid = 'text'::regtype AND NOT a.attisdropped) THEN 'sim' ELSE 'nao' END
  UNION ALL SELECT 'devolucao__fotos_soltas_da_conta: ainda NAO existe', 'sim',
    CASE WHEN NOT EXISTS (SELECT 1 FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace
                        AND p.proname = 'devolucao__fotos_soltas_da_conta') THEN 'sim' ELSE 'nao' END
)
SELECT item, esperado, vivo, COALESCE(vivo = esperado, false) AS ok FROM itens ORDER BY ok, item;
