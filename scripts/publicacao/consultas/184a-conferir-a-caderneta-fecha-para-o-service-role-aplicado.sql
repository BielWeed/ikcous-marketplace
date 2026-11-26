-- 184a-conferir-a-caderneta-fecha-para-o-service-role-aplicado: DEPOIS da 20261480000000. SO LEITURA, somente catalogo, rol fechado de 6 linhas.
-- Nao le nenhuma linha de public.frota_lojas nem de public.frota_segredo (a caderneta guarda o endereco e a chave do banco de cada loja):
-- roda por papel sem privilegio de tabela. Confere o ESTADO NOVO inteiro: o service_role sem nada nas duas tabelas (tabela e colunas), as
-- duas continuando fechadas para PUBLIC, anon e authenticated, e as portas do porteiro (resolver_loja e resolver_loja_com_estado) intactas.
WITH tab AS (
  SELECT c.oid, c.relname, c.relowner, c.relacl, c.relrowsecurity, c.relkind
  FROM pg_class c WHERE c.oid IN (to_regclass('public.frota_lojas'), to_regclass('public.frota_segredo'))
), fn AS (
  SELECT p.oid, p.proname, p.proowner, p.prosecdef, md5(replace(p.prosrc, chr(13), '')) AS h
  FROM pg_proc p
  WHERE p.pronamespace = 'public'::regnamespace AND p.proname IN ('resolver_loja', 'resolver_loja_com_estado')
), sem_service_role AS (
  SELECT t.relname,
         NOT EXISTS (SELECT 1 FROM aclexplode(coalesce(t.relacl, acldefault('r', t.relowner))) g WHERE g.grantee = to_regrole('service_role'))
         AND NOT EXISTS (SELECT 1 FROM pg_attribute a CROSS JOIN LATERAL aclexplode(a.attacl) g
                          WHERE a.attrelid = t.oid AND a.attacl IS NOT NULL AND g.grantee = to_regrole('service_role'))
         AND NOT has_table_privilege('service_role', t.oid, 'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER')
         AND NOT has_any_column_privilege('service_role', t.oid, 'SELECT, INSERT, UPDATE, REFERENCES') AS fechada
  FROM tab t
), itens(item, esperado, vivo) AS (
  SELECT 'controle: catalogo publico visivel', 'sim', CASE WHEN EXISTS (SELECT 1 FROM pg_class WHERE relnamespace = 'public'::regnamespace) THEN 'sim' ELSE 'nao' END
  UNION ALL SELECT 'frota_lojas: service_role sem nenhum privilegio (nenhuma entrada na ACL da tabela nem das colunas; SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES e TRIGGER negados)', 'sim', CASE WHEN
    COALESCE((SELECT s.fechada FROM sem_service_role s WHERE s.relname = 'frota_lojas'), false) THEN 'sim' ELSE 'nao' END
  UNION ALL SELECT 'frota_segredo: service_role sem nenhum privilegio (nenhuma entrada na ACL da tabela nem das colunas; SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES e TRIGGER negados)', 'sim', CASE WHEN
    COALESCE((SELECT s.fechada FROM sem_service_role s WHERE s.relname = 'frota_segredo'), false) THEN 'sim' ELSE 'nao' END
  UNION ALL SELECT 'frota_lojas e frota_segredo continuam fechadas para PUBLIC, anon e authenticated (tabela comum, RLS ligada, nenhuma politica, nenhum privilegio de tabela nem de coluna)', 'sim', CASE WHEN
    (SELECT count(*) FROM tab) = 2
    AND COALESCE((SELECT bool_and(t.relkind = 'r' AND t.relrowsecurity
        AND NOT EXISTS (SELECT 1 FROM pg_policy p WHERE p.polrelid = t.oid)
        AND NOT EXISTS (SELECT 1 FROM aclexplode(coalesce(t.relacl, acldefault('r', t.relowner))) g WHERE g.grantee = 0)
        AND NOT has_table_privilege('anon', t.oid, 'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER')
        AND NOT has_table_privilege('authenticated', t.oid, 'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER')
        AND NOT has_any_column_privilege('anon', t.oid, 'SELECT, INSERT, UPDATE, REFERENCES')
        AND NOT has_any_column_privilege('authenticated', t.oid, 'SELECT, INSERT, UPDATE, REFERENCES'))
       FROM tab t), false) THEN 'sim' ELSE 'nao' END
  UNION ALL SELECT 'resolver_loja e resolver_loja_com_estado: uma so cada, com os corpos da 20261460000000 (md5)', 'sim', CASE WHEN
    (SELECT count(*) FROM fn WHERE proname = 'resolver_loja') = 1
    AND (SELECT count(*) FROM fn WHERE proname = 'resolver_loja_com_estado') = 1
    AND EXISTS (SELECT 1 FROM fn WHERE proname = 'resolver_loja' AND h = '19072d99f3253583342a0bb6c42447dd')
    AND EXISTS (SELECT 1 FROM fn WHERE proname = 'resolver_loja_com_estado' AND h = '92682af1143806d3662411b6d5788096') THEN 'sim' ELSE 'nao' END
  UNION ALL SELECT 'resolver_loja e resolver_loja_com_estado: SECURITY DEFINER, o mesmo dono de frota_lojas e frota_segredo e EXECUTE so do anon (PUBLIC, authenticated e service_role nao)', 'sim', CASE WHEN
    (SELECT count(*) FROM fn) = 2
    AND COALESCE((SELECT bool_and(f.prosecdef
        AND f.proowner = ALL (SELECT t.relowner FROM tab t) AND (SELECT count(*) FROM tab) = 2
        AND NOT EXISTS (SELECT 1 FROM aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) g WHERE g.grantee = 0 AND g.privilege_type = 'EXECUTE')
        AND has_function_privilege('anon', f.oid, 'EXECUTE')
        AND NOT has_function_privilege('authenticated', f.oid, 'EXECUTE')
        AND NOT has_function_privilege('service_role', f.oid, 'EXECUTE'))
       FROM fn f JOIN pg_proc p ON p.oid = f.oid), false) THEN 'sim' ELSE 'nao' END
)
SELECT item, esperado, vivo, COALESCE(vivo = esperado, false) AS ok FROM itens ORDER BY ok, item;
