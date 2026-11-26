-- 183a-conferir-a-loja-muda-de-estado-so-pela-porta-aplicado: DEPOIS da 20261470000000. SO LEITURA, somente catalogo, rol fechado de 9 linhas.
-- Nao le nenhuma linha de public.frota_lojas, public.frota_segredo nem public.frota_estado_historico (a caderneta guarda o endereco e a chave
-- do banco de cada loja; o historico diz quem mudou o estado de cada loja): roda por papel sem privilegio de tabela. Confere o ESTADO NOVO
-- inteiro: a porta frota_mudar_estado so do dono, a funcao do gatilho e o gatilho em frota_lojas, a tabela do historico fechada e a base da
-- 20261460000000 (as colunas de estado e o CHECK) continuando de pe.
WITH fn AS (
  SELECT p.proname, p.oid, md5(replace(p.prosrc, chr(13), '')) AS h, l.lanname, p.prosecdef, p.provolatile, p.proretset, p.proisstrict,
         p.proconfig, p.proowner, p.prorettype, pg_get_function_arguments(p.oid) AS args, pg_get_function_result(p.oid) AS resultado,
         NOT EXISTS (SELECT 1 FROM aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a WHERE a.privilege_type = 'EXECUTE' AND a.grantee <> p.proowner)
           AND NOT has_function_privilege('anon', p.oid, 'EXECUTE')
           AND NOT has_function_privilege('authenticated', p.oid, 'EXECUTE')
           AND NOT has_function_privilege('service_role', p.oid, 'EXECUTE') AS so_o_dono
  FROM pg_proc p JOIN pg_language l ON l.oid = p.prolang
  WHERE p.pronamespace = 'public'::regnamespace AND p.proname IN ('frota_mudar_estado', 'frota_lojas_estado_so_pela_porta')
), hist AS (
  SELECT c.oid, c.relrowsecurity, c.relforcerowsecurity, c.relkind, c.relowner, c.relacl,
         to_regclass(pg_get_serial_sequence('public.frota_estado_historico', 'id')) AS seq
  FROM pg_class c WHERE c.oid = to_regclass('public.frota_estado_historico')
), itens(item, esperado, vivo) AS (
  SELECT 'controle: catalogo publico visivel', 'sim', CASE WHEN EXISTS (SELECT 1 FROM pg_class WHERE relnamespace = 'public'::regnamespace) THEN 'sim' ELSE 'nao' END
  UNION ALL SELECT 'frota_mudar_estado: uma so, com o corpo da 20261470000000 (md5)', 'sim', CASE WHEN
    (SELECT count(*) FROM fn WHERE proname = 'frota_mudar_estado') = 1
    AND EXISTS (SELECT 1 FROM fn WHERE proname = 'frota_mudar_estado' AND h = '887317817697251468a3ffb12b710e61') THEN 'sim' ELSE 'nao' END
  UNION ALL SELECT 'frota_mudar_estado: atributos (plpgsql, SECURITY INVOKER, VOLATILE, search_path vazio, os 9 argumentos e as 6 colunas, o dono de frota_lojas) e EXECUTE so do dono', 'sim', CASE WHEN COALESCE(
    (SELECT bool_and(f.lanname = 'plpgsql' AND NOT f.prosecdef AND f.provolatile = 'v' AND f.proretset AND NOT f.proisstrict
        AND f.proconfig = ARRAY['search_path=""']::text[]
        AND f.args = 'p_id text, p_ref text, p_de text, p_para text, p_sha text, p_base text, p_motivo text, p_confirmacao text, p_valido_ate timestamp with time zone'
        AND f.resultado = 'TABLE(id text, nome text, dominio_publico text, estado text, estado_desde timestamp with time zone, estado_sha text)'
        AND f.proowner = (SELECT c.relowner FROM pg_class c WHERE c.oid = to_regclass('public.frota_lojas'))
        AND f.so_o_dono)
       FROM fn f WHERE f.proname = 'frota_mudar_estado'), false) THEN 'sim' ELSE 'nao' END
  UNION ALL SELECT 'frota_lojas_estado_so_pela_porta: uma so, com o corpo da 20261470000000 (md5), funcao de gatilho sem SECURITY DEFINER, search_path vazio e EXECUTE so do dono', 'sim', CASE WHEN
    (SELECT count(*) FROM fn WHERE proname = 'frota_lojas_estado_so_pela_porta') = 1
    AND COALESCE((SELECT f.h = '58d85afbab0acb79eef70d03c304fb80' AND f.lanname = 'plpgsql' AND NOT f.prosecdef AND f.prorettype = 'trigger'::regtype
        AND f.proconfig = ARRAY['search_path=""']::text[] AND f.so_o_dono
       FROM fn f WHERE f.proname = 'frota_lojas_estado_so_pela_porta'), false) THEN 'sim' ELSE 'nao' END
  UNION ALL SELECT 'frota_lojas: um so gatilho frota_lojas_estado_so_pela_porta, BEFORE INSERT OR UPDATE OF estado, estado_desde, estado_sha e project_ref, por linha, habilitado, apontando para a funcao dele', 'sim', CASE WHEN
    (SELECT count(*) FROM pg_trigger t WHERE t.tgrelid = to_regclass('public.frota_lojas') AND t.tgname = 'frota_lojas_estado_so_pela_porta') = 1
    AND EXISTS (SELECT 1 FROM pg_trigger t
                 WHERE t.tgrelid = to_regclass('public.frota_lojas') AND t.tgname = 'frota_lojas_estado_so_pela_porta' AND NOT t.tgisinternal
                   AND t.tgfoid = (SELECT f.oid FROM fn f WHERE f.proname = 'frota_lojas_estado_so_pela_porta')
                   AND t.tgtype = 23 AND t.tgenabled = 'O' AND t.tgnargs = 0 AND t.tgqual IS NULL
                   AND (SELECT string_agg(a.attname, ',' ORDER BY a.attname) FROM pg_attribute a
                         WHERE a.attrelid = t.tgrelid AND a.attnum = ANY (t.tgattr::int2[])) = 'estado,estado_desde,estado_sha,project_ref') THEN 'sim' ELSE 'nao' END
  UNION ALL SELECT 'frota_estado_historico: colunas com o tipo, a nulidade e o padrao da migration (id bigint identity, quem padrao session_user, em padrao now())', 'sim', CASE WHEN
    (SELECT string_agg(a.attname || ':' || format_type(a.atttypid, a.atttypmod) || ':' || a.attnotnull::text || ':' || a.attidentity::text || ':' || COALESCE(pg_get_expr(d.adbin, d.adrelid), '-'), ',' ORDER BY a.attnum)
       FROM pg_attribute a LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
      WHERE a.attrelid = to_regclass('public.frota_estado_historico') AND a.attnum > 0 AND NOT a.attisdropped)
      = 'id:bigint:true:a:-,loja_id:text:true::-,project_ref:text:true::-,de:text:true::-,para:text:true::-,sha:text:true::-,motivo:text:true::-,quem:text:true::SESSION_USER,em:timestamp with time zone:true::now()' THEN 'sim' ELSE 'nao' END
  UNION ALL SELECT 'frota_estado_historico: chave primaria em id e os CHECKs de estados, sha e motivo, todos validados', 'sim', CASE WHEN
    (SELECT string_agg(k.conname || '=' || pg_get_constraintdef(k.oid), ' | ' ORDER BY k.conname) FROM pg_constraint k
      WHERE k.conrelid = to_regclass('public.frota_estado_historico') AND k.convalidated)
      = 'frota_estado_historico_estados_check=CHECK (((de = ANY (ARRAY[''ativa''::text, ''adormecida''::text, ''encerrada''::text])) AND (para = ANY (ARRAY[''ativa''::text, ''adormecida''::text, ''encerrada''::text])) AND (de <> para))) | frota_estado_historico_motivo_check=CHECK (((btrim(motivo) <> ''''::text) AND (char_length(motivo) <= 200))) | frota_estado_historico_pkey=PRIMARY KEY (id) | frota_estado_historico_sha_check=CHECK ((sha ~ ''^[0-9a-f]{40}$''::text))'
    AND (SELECT count(*) FROM pg_constraint k WHERE k.conrelid = to_regclass('public.frota_estado_historico')) = 4 THEN 'sim' ELSE 'nao' END
  UNION ALL SELECT 'frota_estado_historico: tabela comum com RLS ligada, nenhuma politica, o dono de frota_lojas e nada para PUBLIC, anon, authenticated e service_role (tabela, colunas e sequencia)', 'sim', CASE WHEN
    (SELECT count(*) FROM hist) = 1
    AND COALESCE((SELECT h.relkind = 'r' AND h.relrowsecurity AND h.seq IS NOT NULL
        AND h.relowner = (SELECT c.relowner FROM pg_class c WHERE c.oid = to_regclass('public.frota_lojas'))
        AND NOT EXISTS (SELECT 1 FROM pg_policy p WHERE p.polrelid = h.oid)
        AND NOT EXISTS (SELECT 1 FROM aclexplode(coalesce(h.relacl, acldefault('r', h.relowner))) a WHERE a.grantee <> h.relowner)
        AND NOT EXISTS (SELECT 1 FROM pg_class s CROSS JOIN LATERAL aclexplode(coalesce(s.relacl, acldefault('s', s.relowner))) a
                         WHERE s.oid = h.seq AND a.grantee <> s.relowner)
        AND NOT EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid = h.oid AND a.attacl IS NOT NULL)
        AND NOT has_table_privilege('anon', h.oid, 'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER')
        AND NOT has_table_privilege('authenticated', h.oid, 'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER')
        AND NOT has_table_privilege('service_role', h.oid, 'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER')
       FROM hist h), false) THEN 'sim' ELSE 'nao' END
  UNION ALL SELECT 'a base da 20261460000000 continua: frota_lojas com as colunas estado, estado_desde e estado_sha e o CHECK dos tres estados', 'sim', CASE WHEN
    (SELECT string_agg(a.attname || ':' || format_type(a.atttypid, a.atttypmod) || ':' || a.attnotnull::text || ':' || COALESCE(pg_get_expr(d.adbin, d.adrelid), '-'), ',' ORDER BY a.attname)
       FROM pg_attribute a LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
      WHERE a.attrelid = to_regclass('public.frota_lojas') AND a.attnum > 0 AND NOT a.attisdropped AND a.attname IN ('estado', 'estado_desde', 'estado_sha'))
      = 'estado:text:true:''ativa''::text,estado_desde:timestamp with time zone:true:now(),estado_sha:text:false:-'
    AND COALESCE((SELECT pg_get_constraintdef(k.oid) = 'CHECK ((estado = ANY (ARRAY[''ativa''::text, ''adormecida''::text, ''encerrada''::text])))'
       FROM pg_constraint k WHERE k.conrelid = to_regclass('public.frota_lojas') AND k.conname = 'frota_lojas_estado_check'), false) THEN 'sim' ELSE 'nao' END
)
SELECT item, esperado, vivo, COALESCE(vivo = esperado, false) AS ok FROM itens ORDER BY ok, item;
