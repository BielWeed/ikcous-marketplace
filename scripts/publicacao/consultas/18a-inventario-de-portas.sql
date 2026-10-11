-- 18a — INVENTÁRIO DE PORTAS (auditoria de pagamento e segurança, 10/10/2026, tarefa A2).
-- SÓ LEITURA, UM SELECT, de ROL ABERTO: não é portão de release e não tem coluna `ok`. Quem decide é a
-- pessoa que lê a tabela. Serve para montar, por loja, o quadro "porta × loja": o que o visitante sem
-- login (anon) e o cliente logado (authenticated) alcançam, e se o corpo no ar é o do repositório
-- (md5 do corpo, sem CR, comparável com o `md5(replace(prosrc, chr(13), ''))` das migrations).
--
-- Saída: tipo | objeto | detalhe. O detalhe é `chave=valor` separado por `|`. Tipos, na ordem:
--   controle          papel que leu, versão do servidor, se anon/authenticated existem, contagens.
--   funcao            (bloco 1) função fora do sistema com EXECUTE para PUBLIC, anon ou authenticated:
--                     kind, secdef (SECURITY DEFINER), vol (v/s/i), ret, config (proconfig, onde mora o
--                     search_path), md5 do corpo, cita= quais de is_admin_atual/is_admin/auth.uid/
--                     service_role aparecem no corpo (`-` = nenhuma: sem guarda dentro), exec= quem tem
--                     o EXECUTE (PUBLIC = a entrada sem dono, que vale para todos os papéis).
--   view              (bloco 2) view ou matview de `public` SEM security_invoker e com SELECT (de tabela
--                     ou de qualquer coluna) para anon ou authenticated. Roda com o papel do dono e
--                     atravessa a RLS das tabelas de baixo.
--   tabela            (bloco 3) toda tabela de `public`: RLS ligada/forçada, privilégios de anon e
--                     authenticated (S=select I=insert U=update D=delete T=truncate, por tabela ou por
--                     coluna), nº de políticas e quantas valem para PUBLIC/anon.
--   politica          (bloco 3) política de `public` com papel PUBLIC ou anon: comando, papéis, md5 do
--                     qual e do with check e o texto do qual (200 caracteres, espaço colapsado).
--   migration         (bloco 4) registro `supabase_migrations.schema_migrations` desde 20261180 (versão
--                     e nome) e um resumo (total e última versão). O registro não prova o que está no ar:
--                     é só o que o ledger diz.
--   cartao            (bloco 5) as três chaves de `config_pagamento_cartao` (crédito, débito, parcelas).
--                     `AUSENTE` se a tabela não existe neste banco. NUNCA lê `updated_by`.
--   bucket            (bloco 6) `storage.buckets`: público?, limite de bytes, tipos aceitos.
--   politica-storage  (bloco 6) toda política de `storage.objects`, com o qual e o with check.
--   realtime          (bloco 7) tabela na publicação `supabase_realtime`, a replica identity e se
--                     anon/authenticated leem a tabela.
--   acl-padrao        (bloco 8) `pg_default_acl` de FUNÇÕES (global ou em `public`). Sem linha = vale o
--                     padrão do Postgres (EXECUTE para PUBLIC em toda função nova).
--
-- RUÍDO CONHECIDO: o bloco 1 inclui funções de gatilho e de leitura (STABLE/IMMUTABLE) e as da própria
-- plataforma fora de extensão (auth, storage, realtime). A classificação (vitrine, logado, painel,
-- só serviço, gatilho, órfã) é a tarefa A4, que lê esta saída: aqui nada é filtrado por "parece seguro".
-- Funções de extensão (pg_depend deptype 'e') e dos schemas pg_catalog, information_schema e pg_toast
-- ficam de fora.
--
-- COMPARAR ENTRE LOJAS: o md5 do qual/with check vem de pg_get_expr com o search_path da sessão que
-- rodou. Duas lojas lidas pelo MESMO caminho (este workflow) comparam bem; compare com o banco de teste
-- do CI só pelo texto do qual, não pelo md5.
--
-- QUEM LÊ: o papel só-leitura do workflow (BYPASSRLS + pg_read_all_data) lê o catálogo, storage.buckets e
-- supabase_migrations.schema_migrations. Se um deles não puder ser lido, a consulta INTEIRA falha com
-- "permission denied" (nunca devolve "ok" por engano). Nenhuma tabela de dados do app é lida, e nenhum
-- dado pessoal sai daqui. A única leitura de tabela do app é a do cartão, por query_to_xml com o SELECT
-- fixo abaixo (só 3 colunas de configuração), atrás de to_regclass: numa loja atrasada que ainda não
-- tem a tabela, sai a linha `AUSENTE` em vez de quebrar o inventário inteiro.
WITH
papeis AS (
  SELECT to_regrole('anon') AS anon, to_regrole('authenticated') AS autenticado
),
fn AS (
  SELECT p.oid,
         p.pronamespace::regnamespace::text AS esquema,
         p.proname,
         pg_get_function_identity_arguments(p.oid) AS args,
         p.prokind,
         p.prosecdef,
         p.provolatile,
         p.prorettype::regtype::text AS retorno,
         p.proconfig,
         p.prosrc,
         COALESCE((SELECT bool_or(a.grantee = 0)
                     FROM aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) a
                    WHERE a.privilege_type = 'EXECUTE'), false) AS publico,
         COALESCE(has_function_privilege(pa.anon, p.oid, 'EXECUTE'), false) AS anon_exec,
         COALESCE(has_function_privilege(pa.autenticado, p.oid, 'EXECUTE'), false) AS auth_exec
    FROM pg_proc p
   CROSS JOIN papeis pa
   WHERE p.pronamespace NOT IN ('pg_catalog'::regnamespace, 'information_schema'::regnamespace, 'pg_toast'::regnamespace)
     AND NOT EXISTS (
       SELECT 1 FROM pg_depend d
        WHERE d.classid = 'pg_proc'::regclass AND d.objid = p.oid AND d.deptype = 'e'
     )
),
fn_exposta AS (
  SELECT * FROM fn WHERE publico OR anon_exec OR auth_exec
),
vw AS (
  SELECT c.oid,
         c.relname,
         c.relkind,
         c.relowner,
         COALESCE(has_any_column_privilege(pa.anon, c.oid, 'SELECT'), false) AS anon_le,
         COALESCE(has_any_column_privilege(pa.autenticado, c.oid, 'SELECT'), false) AS auth_le
    FROM pg_class c
   CROSS JOIN papeis pa
   WHERE c.relnamespace = 'public'::regnamespace
     AND c.relkind IN ('v', 'm')
     AND NOT EXISTS (
       SELECT 1 FROM unnest(COALESCE(c.reloptions, ARRAY[]::text[])) o
        WHERE o ~ '^security_invoker=(true|on|1|yes)$'
     )
),
vw_exposta AS (
  SELECT * FROM vw WHERE anon_le OR auth_le
),
tb AS (
  SELECT c.oid,
         c.relname,
         c.relrowsecurity,
         c.relforcerowsecurity,
         pa.anon,
         pa.autenticado
    FROM pg_class c
   CROSS JOIN papeis pa
   WHERE c.relnamespace = 'public'::regnamespace
     AND c.relkind IN ('r', 'p')
),
pp AS (
  SELECT pol.polname,
         pol.polrelid,
         pol.polcmd,
         pol.polpermissive,
         pol.polroles,
         pol.polqual,
         pol.polwithcheck,
         t.relname
    FROM pg_policy pol
    JOIN tb t ON t.oid = pol.polrelid
   WHERE 0::oid = ANY(pol.polroles)
      OR COALESCE(t.anon::oid = ANY(pol.polroles), false)
),
mig AS (
  SELECT m.version, m.name
    FROM supabase_migrations.schema_migrations m
   WHERE m.version >= '20261180'
),
cartao AS (
  SELECT CASE WHEN to_regclass('public.config_pagamento_cartao') IS NOT NULL
              THEN query_to_xml(
                     'SELECT credito, debito, parcelas_max FROM public.config_pagamento_cartao',
                     false, true, ''
                   )
         END AS x
),
r(ordem, tipo, objeto, detalhe) AS (
  -- controle
  SELECT 0, 'controle', 'papel que leu', current_user::text
  UNION ALL
  SELECT 0, 'controle', 'servidor',
         'versao=' || current_setting('server_version') || '|banco=' || current_database()
  UNION ALL
  SELECT 0, 'controle', 'papeis alvo existem',
         'anon=' || (pa.anon IS NOT NULL)::text || '|authenticated=' || (pa.autenticado IS NOT NULL)::text
    FROM papeis pa
  UNION ALL
  SELECT 0, 'controle', 'contagens',
         'funcoes_expostas=' || (SELECT count(*) FROM fn_exposta)::text
         || '|funcoes_expostas_secdef=' || (SELECT count(*) FROM fn_exposta WHERE prosecdef)::text
         || '|views_sem_invoker_legiveis=' || (SELECT count(*) FROM vw_exposta)::text
         || '|tabelas_public=' || (SELECT count(*) FROM tb)::text
         || '|tabelas_sem_rls=' || (SELECT count(*) FROM tb WHERE NOT relrowsecurity)::text
         || '|politicas_public_anon=' || (SELECT count(*) FROM pp)::text
  -- bloco 1: funções
  UNION ALL
  SELECT 1, 'funcao', f.esquema || '.' || f.proname || '(' || f.args || ')',
         concat_ws('|',
           'kind=' || f.prokind::text,
           'secdef=' || f.prosecdef::text,
           'vol=' || f.provolatile::text,
           'ret=' || f.retorno,
           'config=' || COALESCE(array_to_string(f.proconfig, ','), '-'),
           'md5=' || md5(replace(f.prosrc, chr(13), '')),
           'cita=' || COALESCE(NULLIF(array_to_string(ARRAY[
              CASE WHEN f.prosrc ~ '\mis_admin_atual\M' THEN 'is_admin_atual' END,
              CASE WHEN f.prosrc ~ '\mis_admin\M' THEN 'is_admin' END,
              CASE WHEN position('auth.uid' IN f.prosrc) > 0 THEN 'auth.uid' END,
              CASE WHEN position('service_role' IN f.prosrc) > 0 THEN 'service_role' END
            ], ','), ''), '-'),
           'exec=' || concat_ws(',',
              CASE WHEN f.publico THEN 'PUBLIC' END,
              CASE WHEN f.anon_exec THEN 'anon' END,
              CASE WHEN f.auth_exec THEN 'authenticated' END)
         )
    FROM fn_exposta f
  -- bloco 2: views sem security_invoker
  UNION ALL
  SELECT 2, 'view', 'public.' || v.relname,
         concat_ws('|',
           'kind=' || v.relkind::text,
           'security_invoker=nao',
           'select=' || concat_ws(',',
              CASE WHEN v.anon_le THEN 'anon' END,
              CASE WHEN v.auth_le THEN 'authenticated' END),
           'dono=' || v.relowner::regrole::text,
           'md5def=' || md5(pg_get_viewdef(v.oid))
         )
    FROM vw_exposta v
  -- bloco 3: tabelas e políticas com papel public/anon
  UNION ALL
  SELECT 3, 'tabela', 'public.' || t.relname,
         concat_ws('|',
           'rls=' || t.relrowsecurity::text,
           'forcada=' || t.relforcerowsecurity::text,
           'anon=' || COALESCE(NULLIF(concat_ws('',
              CASE WHEN has_any_column_privilege(t.anon, t.oid, 'SELECT') THEN 'S' END,
              CASE WHEN has_any_column_privilege(t.anon, t.oid, 'INSERT') THEN 'I' END,
              CASE WHEN has_any_column_privilege(t.anon, t.oid, 'UPDATE') THEN 'U' END,
              CASE WHEN has_table_privilege(t.anon, t.oid, 'DELETE') THEN 'D' END,
              CASE WHEN has_table_privilege(t.anon, t.oid, 'TRUNCATE') THEN 'T' END), ''), '-'),
           'authenticated=' || COALESCE(NULLIF(concat_ws('',
              CASE WHEN has_any_column_privilege(t.autenticado, t.oid, 'SELECT') THEN 'S' END,
              CASE WHEN has_any_column_privilege(t.autenticado, t.oid, 'INSERT') THEN 'I' END,
              CASE WHEN has_any_column_privilege(t.autenticado, t.oid, 'UPDATE') THEN 'U' END,
              CASE WHEN has_table_privilege(t.autenticado, t.oid, 'DELETE') THEN 'D' END,
              CASE WHEN has_table_privilege(t.autenticado, t.oid, 'TRUNCATE') THEN 'T' END), ''), '-'),
           'politicas=' || (SELECT count(*) FROM pg_policy x WHERE x.polrelid = t.oid)::text,
           'politicas_public_anon=' || (SELECT count(*) FROM pp WHERE pp.polrelid = t.oid)::text
         )
    FROM tb t
  UNION ALL
  SELECT 4, 'politica', 'public.' || pol.relname || '.' || pol.polname,
         concat_ws('|',
           'cmd=' || CASE pol.polcmd WHEN 'r' THEN 'SELECT' WHEN 'a' THEN 'INSERT' WHEN 'w' THEN 'UPDATE' WHEN 'd' THEN 'DELETE' ELSE 'ALL' END,
           'permissiva=' || pol.polpermissive::text,
           'papeis=' || COALESCE((SELECT string_agg(CASE WHEN q = 0::oid THEN 'public' ELSE q::regrole::text END, ',' ORDER BY q)
                                    FROM unnest(pol.polroles) q), '-'),
           'qual_md5=' || COALESCE(md5(pg_get_expr(pol.polqual, pol.polrelid)), '-'),
           'check_md5=' || COALESCE(md5(pg_get_expr(pol.polwithcheck, pol.polrelid)), '-'),
           'qual=' || COALESCE(left(regexp_replace(pg_get_expr(pol.polqual, pol.polrelid), '\s+', ' ', 'g'), 200), '-')
         )
    FROM pp pol
  -- bloco 4: registro de migrations
  UNION ALL
  SELECT 5, 'migration', m.version, COALESCE(m.name, '-')
    FROM mig m
  UNION ALL
  SELECT 5, 'migration', '(resumo desde 20261180)',
         'total=' || count(*)::text || '|ultima=' || COALESCE(max(m.version), '-')
    FROM mig m
  -- bloco 5: cartão (só as três chaves de configuração)
  UNION ALL
  SELECT 6, 'cartao', 'public.config_pagamento_cartao',
         CASE WHEN c.x IS NULL THEN 'AUSENTE: a tabela nao existe neste banco'
              WHEN btrim(c.x::text) = '' THEN 'SEM LINHA: a tabela esta vazia'
              ELSE 'credito=' || ((xpath('/row/credito/text()', c.x))[1])::text
                   || '|debito=' || ((xpath('/row/debito/text()', c.x))[1])::text
                   || '|parcelas_max=' || ((xpath('/row/parcelas_max/text()', c.x))[1])::text
         END
    FROM cartao c
  -- bloco 6: storage
  UNION ALL
  SELECT 7, 'bucket', b.id::text,
         concat_ws('|',
           'publico=' || b.public::text,
           'limite_bytes=' || COALESCE(b.file_size_limit::text, 'sem'),
           'mime=' || COALESCE(array_to_string(b.allowed_mime_types, ','), 'qualquer')
         )
    FROM storage.buckets b
  UNION ALL
  SELECT 8, 'politica-storage', 'storage.objects.' || pol.polname,
         concat_ws('|',
           'cmd=' || CASE pol.polcmd WHEN 'r' THEN 'SELECT' WHEN 'a' THEN 'INSERT' WHEN 'w' THEN 'UPDATE' WHEN 'd' THEN 'DELETE' ELSE 'ALL' END,
           'permissiva=' || pol.polpermissive::text,
           'papeis=' || COALESCE((SELECT string_agg(CASE WHEN q = 0::oid THEN 'public' ELSE q::regrole::text END, ',' ORDER BY q)
                                    FROM unnest(pol.polroles) q), '-'),
           'qual_md5=' || COALESCE(md5(pg_get_expr(pol.polqual, pol.polrelid)), '-'),
           'check_md5=' || COALESCE(md5(pg_get_expr(pol.polwithcheck, pol.polrelid)), '-'),
           'qual=' || COALESCE(left(regexp_replace(pg_get_expr(pol.polqual, pol.polrelid), '\s+', ' ', 'g'), 200), '-'),
           'check=' || COALESCE(left(regexp_replace(pg_get_expr(pol.polwithcheck, pol.polrelid), '\s+', ' ', 'g'), 200), '-')
         )
    FROM pg_policy pol
    JOIN pg_class c ON c.oid = pol.polrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'storage' AND c.relname = 'objects'
  -- bloco 7: realtime
  UNION ALL
  SELECT 9, 'realtime', pt.schemaname || '.' || pt.tablename,
         concat_ws('|',
           'replica_identity=' || CASE c.relreplident::text
                                    WHEN 'd' THEN 'default' WHEN 'f' THEN 'full'
                                    WHEN 'n' THEN 'nothing' WHEN 'i' THEN 'index'
                                    ELSE c.relreplident::text END,
           'anon_le=' || COALESCE(has_any_column_privilege(pa.anon, c.oid, 'SELECT'), false)::text,
           'authenticated_le=' || COALESCE(has_any_column_privilege(pa.autenticado, c.oid, 'SELECT'), false)::text
         )
    FROM pg_publication_tables pt
    JOIN pg_namespace n ON n.nspname = pt.schemaname
    JOIN pg_class c ON c.relnamespace = n.oid AND c.relname = pt.tablename
   CROSS JOIN papeis pa
   WHERE pt.pubname = 'supabase_realtime'
  -- bloco 8: permissões padrão de função
  UNION ALL
  SELECT 10, 'acl-padrao',
         'para ' || d.defaclrole::regrole::text || ' em '
           || CASE WHEN d.defaclnamespace = 0::oid THEN '(todos os schemas)' ELSE d.defaclnamespace::regnamespace::text END,
         'objetos=funcoes|acl=' || COALESCE(array_to_string(d.defaclacl, ' '), '-')
    FROM pg_default_acl d
   WHERE d.defaclobjtype = 'f'
     AND (d.defaclnamespace = 0::oid OR d.defaclnamespace = 'public'::regnamespace)
  UNION ALL
  SELECT 10, 'acl-padrao', '(nenhuma linha)',
         'sem regra: vale o padrao do Postgres (EXECUTE para PUBLIC em toda funcao nova)'
   WHERE NOT EXISTS (
     SELECT 1 FROM pg_default_acl d
      WHERE d.defaclobjtype = 'f'
        AND (d.defaclnamespace = 0::oid OR d.defaclnamespace = 'public'::regnamespace)
   )
)
SELECT tipo, objeto, detalhe
  FROM r
 ORDER BY ordem, objeto, detalhe;
