-- 98a-conferir-a-foto-da-devolucao-e-a-pergunta-tem-teto-aplicado: DEPOIS da 20261391000000. SO LEITURA, somente catalogo,
-- rol fechado de 5 linhas. Nao le nenhum objeto do bucket nem nenhuma pergunta. Antes do apply responde "nao" nas
-- linhas da migration (a 98a negativa e' esperada), nunca erro. A condicao da politica e' comparada SEM espacos e sem
-- o prefixo public. (o search_path de quem consulta varia). A linha do CHECK aceita NOT VALID ou ja validado.
WITH pol AS (
  SELECT p.polname, p.polcmd, p.polpermissive, p.polroles, p.polqual,
         regexp_replace(replace(pg_get_expr(p.polwithcheck, p.polrelid), 'public.', ''), '[[:space:]]', '', 'g') AS chk,
         pg_get_expr(p.polwithcheck, p.polrelid) AS bruto
    FROM pg_policy p
   WHERE p.polrelid = to_regclass('storage.objects')
), itens(item, esperado, vivo) AS (
  SELECT 'controle: politicas de storage.objects visiveis a este papel', 'sim',
    CASE WHEN (SELECT count(*) FROM pol) > 0 THEN 'sim' ELSE 'nao' END
  UNION ALL SELECT 'devolucoes_cliente_insert_policy: INSERT so authenticated, na pasta do cliente e com o teto de 30 fotos soltas (condicao da 20261391000000)', 'sim',
    CASE WHEN EXISTS (SELECT 1 FROM pol WHERE polname = 'devolucoes_cliente_insert_policy' AND polcmd = 'a' AND polpermissive
                        AND polroles = ARRAY['authenticated'::regrole::oid] AND polqual IS NULL
                        AND chk = '((bucket_id=''devolucoes''::text)AND(split_part(name,''/''::text,1)=((SELECTauth.uid()ASuid))::text)AND((SELECTdevolucao__fotos_soltas_da_conta((SELECTauth.uid()ASuid),30)ASdevolucao__fotos_soltas_da_conta)<30))') THEN 'sim' ELSE 'nao' END
  UNION ALL SELECT 'devolucoes: nenhuma outra politica INSERT/ALL alcanca o bucket', 'sim',
    CASE WHEN NOT EXISTS (
      SELECT 1 FROM pol
       WHERE polcmd IN ('a', '*') AND polpermissive AND polname <> 'devolucoes_cliente_insert_policy'
         AND NOT (COALESCE(bruto, '') ~ '^[(]+bucket_id = ''(banners|products|produtos|branding)''::text[)] AND '
                  AND COALESCE(bruto, '') !~ '[)] OR '
                  AND position('devolucoes' IN COALESCE(bruto, '')) = 0)) THEN 'sim' ELSE 'nao' END
  UNION ALL SELECT 'questions: CHECK questions_question_ate_500_caracteres (char_length <= 500) existe', 'sim',
    CASE WHEN EXISTS (SELECT 1 FROM pg_constraint c WHERE c.conrelid = to_regclass('public.questions')
                    AND c.conname = 'questions_question_ate_500_caracteres' AND c.contype = 'c'
                    AND pg_get_constraintdef(c.oid) IN ('CHECK ((char_length(question) <= 500)) NOT VALID',
                                                        'CHECK ((char_length(question) <= 500))')) THEN 'sim' ELSE 'nao' END
  UNION ALL SELECT 'devolucao__fotos_soltas_da_conta(uuid, integer): corpo da 20261391000000 (md5), sql STABLE SECURITY INVOKER, search_path fixo, EXECUTE so authenticated e service_role', 'sim',
    CASE WHEN EXISTS (SELECT 1 FROM pg_proc p JOIN pg_language l ON l.oid = p.prolang
                    WHERE p.oid = to_regprocedure('public.devolucao__fotos_soltas_da_conta(uuid, integer)')
                      AND md5(replace(p.prosrc, chr(13), '')) = '0becd6ad09d4fad564a6622654cf0bc6'
                      AND l.lanname = 'sql' AND p.provolatile = 's' AND NOT p.prosecdef
                      AND p.proconfig = ARRAY['search_path=public']::text[]
                      AND has_function_privilege('authenticated', p.oid, 'EXECUTE')
                      AND has_function_privilege('service_role', p.oid, 'EXECUTE')
                      AND NOT has_function_privilege('anon', p.oid, 'EXECUTE')
                      AND NOT EXISTS (SELECT 1 FROM aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) a
                                       WHERE a.grantee = 0 AND a.privilege_type = 'EXECUTE')) THEN 'sim' ELSE 'nao' END
)
SELECT item, esperado, vivo, COALESCE(vivo = esperado, false) AS ok FROM itens ORDER BY ok, item;
