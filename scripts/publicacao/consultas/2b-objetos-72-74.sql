-- Depois de aplicar 72→73→74: os objetos que nasceram e os grants.
-- Esperado: todas as linhas com ok = true. Antes das 73/74 a consulta RODA
-- igual (sem erro) e dá ok = false no que ainda não existe.
SELECT 'fn get_my_cpf' AS item, to_regprocedure('public.get_my_cpf()') IS NOT NULL AS ok
UNION ALL SELECT 'fn set_my_cpf', to_regprocedure('public.set_my_cpf(text)') IS NOT NULL
UNION ALL SELECT 'fn formas_pagamento_sem_duplicata', to_regprocedure('public.formas_pagamento_sem_duplicata(text[])') IS NOT NULL
UNION ALL SELECT 'fn forma_de_pagamento_aceita', to_regprocedure('public.forma_de_pagamento_aceita(text)') IS NOT NULL
UNION ALL SELECT 'fn store_config_exige_forma_de_pagamento', to_regprocedure('public.store_config_exige_forma_de_pagamento()') IS NOT NULL
UNION ALL SELECT 'coluna store_config.formas_pagamento_entrega',
       EXISTS (SELECT 1 FROM information_schema.columns
                WHERE table_schema = 'public' AND table_name = 'store_config' AND column_name = 'formas_pagamento_entrega')
UNION ALL SELECT 'check formas_pagamento_entrega',
       EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.store_config'::regclass AND conname = 'store_config_formas_pagamento_entrega_check')
UNION ALL SELECT 'check sem_duplicata',
       EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.store_config'::regclass AND conname = 'store_config_formas_pagamento_sem_duplicata_check')
UNION ALL SELECT 'trigger store_config_exige_forma_de_pagamento',
       EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = 'public.store_config'::regclass AND tgname = 'store_config_exige_forma_de_pagamento' AND NOT tgisinternal)
UNION ALL SELECT 'loja existente com as 3 formas ligadas',
       COALESCE((SELECT bool_and(to_jsonb(s) -> 'formas_pagamento_entrega' = '["pix","card","cash"]'::jsonb) FROM public.store_config s), false)
UNION ALL SELECT 'anon NAO executa get_my_cpf', COALESCE(NOT has_function_privilege('anon', to_regprocedure('public.get_my_cpf()'), 'EXECUTE'), false)
UNION ALL SELECT 'anon NAO executa set_my_cpf', COALESCE(NOT has_function_privilege('anon', to_regprocedure('public.set_my_cpf(text)'), 'EXECUTE'), false)
UNION ALL SELECT 'authenticated executa get_my_cpf', COALESCE(has_function_privilege('authenticated', to_regprocedure('public.get_my_cpf()'), 'EXECUTE'), false)
UNION ALL SELECT 'authenticated executa set_my_cpf', COALESCE(has_function_privilege('authenticated', to_regprocedure('public.set_my_cpf(text)'), 'EXECUTE'), false)
UNION ALL SELECT 'SECURITY DEFINER com search_path (cpf)',
       (SELECT count(*) = 2 AND COALESCE(bool_and(p.prosecdef AND p.proconfig::text LIKE '%search_path=public%'), false)
          FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname IN ('get_my_cpf','set_my_cpf'));
