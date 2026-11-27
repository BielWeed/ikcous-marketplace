-- 194a-conferir-o-endereco-antigo-encaminha-aplicado: DEPOIS da 20261570000000. SO LEITURA, somente catalogo, rol fechado de 6 linhas.
-- Nao le nenhuma linha de public.frota_lojas nem de public.frota_enderecos_que_encaminham (a caderneta guarda o endereco e a chave do banco
-- de cada loja): roda por papel sem privilegio de tabela. Confere o ESTADO NOVO inteiro: a tabela com a forma exata e fechada, o gatilho
-- que recusa o endereco principal e as duas portas (a de leitura so do anon, a de troca so do dono) pelo md5 dos corpos.
-- A chave estrangeira e' conferida pelo catalogo (confrelid, conkey, confkey, confdeltype), nunca pelo texto de pg_get_constraintdef: ele
-- escreve frota_lojas com ou sem public. conforme o search_path de quem roda a consulta.
WITH tb AS (
  SELECT c.oid, c.relkind, c.relrowsecurity, c.relforcerowsecurity, c.relacl, c.relowner
  FROM pg_class c WHERE c.oid = to_regclass('public.frota_enderecos_que_encaminham')
), lojas AS (
  SELECT c.oid, c.relowner FROM pg_class c WHERE c.oid = to_regclass('public.frota_lojas')
), fn AS (
  SELECT p.proname, p.oid, md5(replace(p.prosrc, chr(13), '')) AS h, l.lanname, p.prosecdef, p.provolatile, p.proretset, p.proisstrict,
         p.proconfig, p.proowner, pg_get_function_arguments(p.oid) AS args, pg_get_function_result(p.oid) AS resultado,
         -- quem tem EXECUTE no ACL, em ordem: 'PUBLIC', o dono como 'dono' e cada papel pelo nome.
         (SELECT string_agg(q.quem, ',' ORDER BY q.quem)
            FROM (SELECT DISTINCT CASE WHEN a.grantee = 0 THEN 'PUBLIC' WHEN a.grantee = p.proowner THEN 'dono' ELSE a.grantee::regrole::text END AS quem
                    FROM aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a WHERE a.privilege_type = 'EXECUTE') q) AS executa
  FROM pg_proc p JOIN pg_language l ON l.oid = p.prolang
  WHERE p.pronamespace = 'public'::regnamespace
    AND p.proname IN ('frota_enderecos_que_encaminham_nao_e_principal', 'resolver_encaminhamento', 'frota_trocar_dominio')
), itens(item, esperado, vivo) AS (
  SELECT 'controle: catalogo publico visivel', 'sim', CASE WHEN EXISTS (SELECT 1 FROM pg_class WHERE relnamespace = 'public'::regnamespace) THEN 'sim' ELSE 'nao' END
  UNION ALL SELECT 'frota_enderecos_que_encaminham: as 5 colunas (host, loja_id, motivo, criado_em, quem), a chave em host, os CHECKs de formato do host e do motivo e a chave estrangeira para frota_lojas(id) ON DELETE CASCADE', 'sim', CASE WHEN
    (SELECT count(*) FROM tb) = 1
    AND (SELECT string_agg(a.attname || ':' || format_type(a.atttypid, a.atttypmod) || ':' || a.attnotnull::text || ':' || COALESCE(pg_get_expr(d.adbin, d.adrelid), '-'), ',' ORDER BY a.attnum)
           FROM pg_attribute a LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
          WHERE a.attrelid = (SELECT oid FROM tb) AND a.attnum > 0 AND NOT a.attisdropped)
        = 'host:text:true:-,loja_id:text:true:-,motivo:text:true:-,criado_em:timestamp with time zone:true:now(),quem:text:true:SESSION_USER'
    AND (SELECT string_agg(k.conname || '=' || pg_get_constraintdef(k.oid), ' | ' ORDER BY k.conname) FROM pg_constraint k
          WHERE k.conrelid = (SELECT oid FROM tb) AND k.contype <> 'f')
        = 'frota_enderecos_que_encaminham_host_check=CHECK ((host ~ ''^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$''::text)) | frota_enderecos_que_encaminham_motivo_check=CHECK ((motivo = ANY (ARRAY[''antigo''::text, ''www''::text, ''novo-em-preparo''::text]))) | frota_enderecos_que_encaminham_pkey=PRIMARY KEY (host)'
    AND (SELECT count(*) FROM pg_constraint k WHERE k.conrelid = (SELECT oid FROM tb) AND k.contype = 'f') = 1
    AND EXISTS (SELECT 1 FROM pg_constraint k
                 WHERE k.conrelid = (SELECT oid FROM tb) AND k.contype = 'f' AND k.confrelid = (SELECT oid FROM lojas)
                   AND k.confdeltype = 'c' AND k.confmatchtype = 's'
                   AND k.conkey = (SELECT ARRAY[a.attnum]::int2[] FROM pg_attribute a WHERE a.attrelid = (SELECT oid FROM tb) AND a.attname = 'loja_id')
                   AND k.confkey = (SELECT ARRAY[a.attnum]::int2[] FROM pg_attribute a WHERE a.attrelid = (SELECT oid FROM lojas) AND a.attname = 'id')) THEN 'sim' ELSE 'nao' END
  UNION ALL SELECT 'frota_enderecos_que_encaminham: fechada (tabela comum, RLS ligada, nenhuma politica, nada para PUBLIC, anon, authenticated e service_role, nem em coluna) e com o dono de frota_lojas', 'sim', CASE WHEN
    (SELECT count(*) FROM tb) = 1
    AND COALESCE((SELECT t.relkind = 'r' AND t.relrowsecurity
        AND NOT EXISTS (SELECT 1 FROM pg_policy p WHERE p.polrelid = t.oid)
        AND NOT EXISTS (SELECT 1 FROM aclexplode(coalesce(t.relacl, acldefault('r', t.relowner))) a WHERE a.grantee <> t.relowner)
        AND NOT EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid = t.oid AND a.attacl IS NOT NULL)
        AND NOT has_table_privilege('anon', t.oid, 'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER')
        AND NOT has_table_privilege('authenticated', t.oid, 'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER')
        AND NOT has_table_privilege('service_role', t.oid, 'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER')
        AND t.relowner = (SELECT relowner FROM lojas)
       FROM tb t), false) THEN 'sim' ELSE 'nao' END
  UNION ALL SELECT 'frota_enderecos_que_encaminham_nao_e_principal: o gatilho BEFORE INSERT OR UPDATE OF host por linha, habilitado, na funcao com o corpo da 20261570000000 (md5) e EXECUTE so do dono', 'sim', CASE WHEN
    (SELECT count(*) FROM fn WHERE proname = 'frota_enderecos_que_encaminham_nao_e_principal') = 1
    AND COALESCE((SELECT f.h = '874d5af8ef1504daa9e602d6f991353a' AND f.lanname = 'plpgsql' AND NOT f.prosecdef
        AND f.proconfig = ARRAY['search_path=""']::text[] AND f.executa = 'dono' AND f.proowner = (SELECT relowner FROM lojas)
       FROM fn f WHERE f.proname = 'frota_enderecos_que_encaminham_nao_e_principal'), false)
    AND (SELECT count(*) FROM pg_trigger t
          WHERE t.tgrelid = (SELECT oid FROM tb) AND t.tgname = 'frota_enderecos_que_encaminham_nao_e_principal' AND NOT t.tgisinternal
            AND t.tgfoid = (SELECT oid FROM fn WHERE proname = 'frota_enderecos_que_encaminham_nao_e_principal')
            AND t.tgtype = 23 AND t.tgenabled = 'O' AND t.tgqual IS NULL
            AND (SELECT string_agg(a.attname, ',' ORDER BY a.attname) FROM pg_attribute a
                  WHERE a.attrelid = t.tgrelid AND a.attnum = ANY (t.tgattr::int2[])) = 'host') = 1 THEN 'sim' ELSE 'nao' END
  UNION ALL SELECT 'resolver_encaminhamento: uma so, com o corpo da 20261570000000 (md5), plpgsql, SECURITY DEFINER, VOLATILE, search_path vazio, TABLE(destino text), EXECUTE so do anon e o dono de frota_lojas', 'sim', CASE WHEN
    (SELECT count(*) FROM fn WHERE proname = 'resolver_encaminhamento') = 1
    AND COALESCE((SELECT f.h = '5ca45d858b56991facb8d2052f0aecfb' AND f.lanname = 'plpgsql' AND f.prosecdef AND f.provolatile = 'v'
        AND f.proretset AND NOT f.proisstrict AND f.proconfig = ARRAY['search_path=""']::text[] AND f.args = 'p_host text, p_chave text'
        AND f.resultado = 'TABLE(destino text)' AND f.executa = 'anon,dono'
        AND has_function_privilege('anon', f.oid, 'EXECUTE') AND NOT has_function_privilege('authenticated', f.oid, 'EXECUTE')
        AND NOT has_function_privilege('service_role', f.oid, 'EXECUTE') AND f.proowner = (SELECT relowner FROM lojas)
       FROM fn f WHERE f.proname = 'resolver_encaminhamento'), false) THEN 'sim' ELSE 'nao' END
  UNION ALL SELECT 'frota_trocar_dominio: uma so, com o corpo da 20261570000000 (md5), plpgsql, SECURITY INVOKER, search_path vazio, as 4 colunas de retorno e EXECUTE so do dono', 'sim', CASE WHEN
    (SELECT count(*) FROM fn WHERE proname = 'frota_trocar_dominio') = 1
    AND COALESCE((SELECT f.h = '5758ff83113e042fc927d83c254291bd' AND f.lanname = 'plpgsql' AND NOT f.prosecdef AND f.provolatile = 'v'
        AND f.proretset AND NOT f.proisstrict AND f.proconfig = ARRAY['search_path=""']::text[]
        AND f.args = 'p_id text, p_ref text, p_de text, p_para text, p_motivo text, p_valido_ate timestamp with time zone'
        AND f.resultado = 'TABLE(id text, nome text, dominio_publico text, dominio_anterior text)' AND f.executa = 'dono'
        AND NOT has_function_privilege('anon', f.oid, 'EXECUTE') AND NOT has_function_privilege('authenticated', f.oid, 'EXECUTE')
        AND NOT has_function_privilege('service_role', f.oid, 'EXECUTE') AND f.proowner = (SELECT relowner FROM lojas)
       FROM fn f WHERE f.proname = 'frota_trocar_dominio'), false) THEN 'sim' ELSE 'nao' END
)
SELECT item, esperado, vivo, COALESCE(vivo = esperado, false) AS ok FROM itens ORDER BY ok, item;
