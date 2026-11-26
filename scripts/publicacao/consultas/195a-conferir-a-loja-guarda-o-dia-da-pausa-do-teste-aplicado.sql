-- 195a-conferir-a-loja-guarda-o-dia-da-pausa-do-teste-aplicado: DEPOIS da 20261590000000. SO LEITURA, somente catalogo, rol fechado de 6 linhas.
-- NAO le nenhuma linha do cartao (assinatura_da_loja) nem da chave e NAO chama nenhuma funcao. Prova a coluna pausa_em (date, anulavel, sem padrao), a porta
-- assinatura_da_loja_gravar com o corpo desta migration (md5), os atributos e o EXECUTE so de anon e authenticated, e que assinatura_da_loja_definir_chave e o leitor
-- assinatura_da_loja_ler ficaram intactos. Antes do apply (ou depois dos dois rollbacks) esta consulta responde "nao" (a 195a negativa e' esperada), nunca erro.
WITH fn AS (
  SELECT p.oid, p.proname, md5(replace(p.prosrc, chr(13), '')) AS h, l.lanname, p.prosecdef, p.provolatile, p.proisstrict, p.proretset, p.proconfig,
         pg_get_function_result(p.oid) AS resultado, pg_get_function_arguments(p.oid) AS argumentos
  FROM pg_proc p JOIN pg_language l ON l.oid = p.prolang
  WHERE p.pronamespace = 'public'::regnamespace AND p.proname IN ('assinatura_da_loja_gravar', 'assinatura_da_loja_definir_chave', 'assinatura_da_loja_ler')
), itens(item, esperado, vivo) AS (
  SELECT 'controle: catalogo publico visivel', 'sim', CASE WHEN EXISTS (SELECT 1 FROM pg_class WHERE relnamespace = 'public'::regnamespace) THEN 'sim' ELSE 'nao' END
  UNION ALL SELECT 'assinatura_da_loja.pausa_em: date, anulavel e sem padrao', 'sim', CASE WHEN EXISTS (
    SELECT 1 FROM pg_attribute a
     WHERE a.attrelid = to_regclass('public.assinatura_da_loja') AND a.attname = 'pausa_em' AND a.attnum > 0 AND NOT a.attisdropped
       AND a.atttypid = 'date'::regtype AND NOT a.attnotnull AND NOT a.atthasdef) THEN 'sim' ELSE 'nao' END
  UNION ALL SELECT 'assinatura_da_loja_gravar: uma so, com o corpo da 20261590000000 (md5)', 'sim', CASE WHEN
    (SELECT count(*) FROM fn WHERE proname = 'assinatura_da_loja_gravar') = 1
    AND EXISTS (SELECT 1 FROM fn WHERE proname = 'assinatura_da_loja_gravar' AND h = '1ea3a3dddecfeb7a0305b0e4e02263b5') THEN 'sim' ELSE 'nao' END
  UNION ALL SELECT 'assinatura_da_loja_gravar: atributos de sempre (SECURITY DEFINER, plpgsql, VOLATILE, search_path public e pg_temp, retorna jsonb) e EXECUTE so para anon e authenticated (service_role e PUBLIC nada)', 'sim', CASE WHEN COALESCE(
    (SELECT bool_and(f.lanname = 'plpgsql' AND f.prosecdef AND f.provolatile = 'v' AND NOT f.proisstrict AND NOT f.proretset AND f.resultado = 'jsonb'
        AND f.proconfig = ARRAY['search_path=public, pg_temp']::text[]
        AND f.argumentos = 'p_chave text, p_dados jsonb, p_simular boolean DEFAULT false'
        AND has_function_privilege('anon', f.oid, 'EXECUTE') AND has_function_privilege('authenticated', f.oid, 'EXECUTE')
        AND NOT has_function_privilege('service_role', f.oid, 'EXECUTE')
        AND NOT EXISTS (SELECT 1 FROM pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
                         WHERE p.oid = f.oid AND a.grantee = 0 AND a.privilege_type = 'EXECUTE'))
       FROM fn f WHERE f.oid = to_regprocedure('public.assinatura_da_loja_gravar(text, jsonb, boolean)')), false) THEN 'sim' ELSE 'nao' END
  UNION ALL SELECT 'assinatura_da_loja_definir_chave: intacta, com o corpo da 20261399998000 (md5)', 'sim', CASE WHEN
    (SELECT count(*) FROM fn WHERE proname = 'assinatura_da_loja_definir_chave') = 1
    AND EXISTS (SELECT 1 FROM fn WHERE proname = 'assinatura_da_loja_definir_chave' AND h = 'ee89c0e70e378fe0be0fc3c805567d56') THEN 'sim' ELSE 'nao' END
  UNION ALL SELECT 'assinatura_da_loja_ler: intacto, com o corpo da 20261381000000 (md5)', 'sim', CASE WHEN
    (SELECT count(*) FROM fn WHERE proname = 'assinatura_da_loja_ler') = 1
    AND EXISTS (SELECT 1 FROM fn WHERE proname = 'assinatura_da_loja_ler' AND h = 'edeff71c925244a7a450c817d0acd6ae') THEN 'sim' ELSE 'nao' END
)
SELECT item, esperado, vivo, COALESCE(vivo = esperado, false) AS ok FROM itens ORDER BY ok, item;
