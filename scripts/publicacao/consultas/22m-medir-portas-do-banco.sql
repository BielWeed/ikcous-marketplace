-- 22m — MEDICAO, so leitura, das portas pequenas do banco (12/10/2026): o estado VIVO de cada loja
-- que decide como escrever as proximas migrations de permissao (perfil publico, imagem de perfil,
-- contagem do push segmentado, view de produtos do painel, configuracao da loja e codigos de
-- verificacao). Molde da 18a: UM SELECT de ROL ABERTO, sem coluna `ok`; nunca e prova do portao da
-- release. Quem decide e a pessoa que le a tabela. Rodar nas duas lojas assinantes (IKCOUS e Savy).
--
-- Saida: tipo | objeto | detalhe. O detalhe e `chave=valor` separado por `|`. Tipos, na ordem:
--   controle            quem leu (superusuario?, BYPASSRLS?, herda pg_read_all_data?), a versao do
--                       servidor e se a RLS VALE para quem leu em profiles, public_profiles, reviews,
--                       questions e storage.objects. Com a RLS valendo para quem leu, toda contagem
--                       abaixo sai baixa: o numero nao e o da loja.
--   migration           as versoes de que as proximas migrations dependem: presente/ausente no
--                       registro (o registro nao prova o objeto; os tipos abaixo provam).
--   dono                tabelas e views da vitrine de perfis e do painel: tipo, dono, se o dono e
--                       superusuario ou BYPASSRLS, se e o MESMO dono de public_profiles (a view so
--                       atravessa a RLS da tabela se rodar como quem a atravessa), RLS ligada e
--                       forcada, e as opcoes (security_invoker, check_option).
--   funcao              as funcoes que leem perfis ou contam o publico do push: dono, SECURITY
--                       DEFINER, md5 do corpo (sem CR, comparavel com a 18a) e quem tem EXECUTE
--                       (PUBLIC = a entrada sem dono, que vale para todos os papeis).
--   acl-funcao          cada entrada da ACL dessas funcoes, por papel e por quem concedeu.
--   politicas           quantas politicas cada tabela tem (zero tambem aparece).
--   politica            cada politica dessas tabelas: comando, permissiva, papeis, md5 e texto do
--                       USING e do WITH CHECK. O md5 e do texto INTEIRO de pg_get_expr; o texto sai
--                       SEM LITERAIS: todo trecho entre aspas simples vira '?' (uma politica editada
--                       no painel pode carregar um e-mail ou outro valor), espaco colapsado.
--   acl-tabela          cada entrada da ACL de tabela e view, por papel e por quem concedeu; `*` = com
--                       direito de repassar.
--   privilegio-efetivo  o que anon, authenticated e service_role conseguem DE FATO, por tabela
--                       (S I U D T R G) e por coluna (S I U R), contando PUBLIC e heranca de papel.
--   acl-coluna          cada coluna com permissao propria (um REVOKE de tabela a apaga junto).
--   papel               os papeis da plataforma: existe?, superusuario, BYPASSRLS, heranca, login e se
--                       herdam pg_read_all_data / pg_write_all_data (rota que nao aparece na ACL).
--   gatilho             os gatilhos de profiles e public_profiles: ligado (O/D/R/A), md5 da definicao
--                       inteira e a definicao SEM LITERAIS (mesma regra da politica).
--   contagem            quantos perfis, quantos perfis publicos e quantos tem avaliacao (QUALQUER
--                       status) ou pergunta (so numeros). Nao filtra por status de proposito:
--                       reviews.status so nasce na 20261031000000, e citar a coluna derrubaria a
--                       consulta inteira numa loja sem ela.
--   coluna              se reviews.status existe (presente/AUSENTE), lido do catalogo.
--   indice              os dois indices de autor (avaliacao e pergunta): md5 da definicao inteira e
--                       a definicao SEM LITERAIS, ou AUSENTE.
--   imagem-perfil       foto e capa, por tipo (nulo, jpeg, svg pre-definido, outro data: com o tipo
--                       MIME de formato fechado, https, outro) e no total: quantidade, maior, p99 e
--                       quantas passam de 128 KiB e de 512 KiB. So TAMANHO e PREFIXO: o valor nunca sai.
--   bucket              storage.buckets: publico?, limite de bytes, tipos aceitos.
--   storage-objetos     banners, products, branding e produtos: quantos arquivos, maior, p95, quantos
--                       SVG e os tipos MIME (formato fechado). Nunca o nome do arquivo nem quem subiu.
--
-- QUEM LE: o papel so-leitura do workflow (BYPASSRLS + pg_read_all_data) le o catalogo,
-- supabase_migrations, storage e as quatro tabelas lidas SO por agregado (profiles, public_profiles,
-- reviews, questions). Sem acesso a uma delas a consulta INTEIRA falha com "permission denied"
-- (nunca um "0" por engano). Objeto ausente vira AUSENTE na propria linha (to_regclass e
-- to_regprocedure; nenhum cast que derrube a consulta numa loja atrasada).
-- NENHUM DADO PESSOAL: de profiles so saem contagem, tamanho (octet_length) e o prefixo do valor
-- comparado com literais fixos; de storage.objects so o tamanho e o tipo MIME de formato fechado,
-- agregados por bucket; texto de politica, gatilho e indice sai sem os literais. O log do run e
-- legivel por quem le o repositorio: o que sai daqui e so catalogo e agregado.
-- tests/ci_conferir_banco_test.ts prende essas regras no texto desta consulta por LISTA DO PERMITIDO
-- (todo identificador fora de string tem de estar na lista do teste).
WITH
papeis AS (
  SELECT to_regrole('anon') AS anon,
         to_regrole('authenticated') AS autenticado,
         to_regrole('service_role') AS servico
),
rel(nome) AS (
  VALUES ('public.public_profiles'), ('public.profiles'), ('public.reviews'), ('public.questions'),
         ('public.vw_reviews_public'), ('public.vw_questions_public'), ('public.vw_produtos_admin'),
         ('public.app_settings'), ('public.otp_verifications')
),
rc AS (
  SELECT r.nome, c.oid, c.relkind, c.relowner, c.relrowsecurity, c.relforcerowsecurity, c.reloptions
    FROM rel r
    LEFT JOIN pg_class c ON c.oid = to_regclass(r.nome)
),
dono_pp AS (
  SELECT c.relowner FROM pg_class c WHERE c.oid = to_regclass('public.public_profiles')
),
fn(assinatura) AS (
  VALUES ('public.handle_public_profile_sync()'), ('public.get_reviews_metrics(text,integer)'),
         ('public.rls_admin_atual()'), ('public.get_segmented_push_count(text,numeric,integer)'),
         ('public.update_my_profile_secure(text,text,text,text)')
),
fc AS (
  SELECT f.assinatura, p.oid, p.proowner, p.prosecdef, p.prosrc, p.proacl
    FROM fn f
    LEFT JOIN pg_proc p ON p.oid = to_regprocedure(f.assinatura)
),
tab_pol(nome) AS (
  VALUES ('public.public_profiles'), ('public.profiles'), ('public.reviews'), ('public.questions'),
         ('public.app_settings'), ('public.otp_verifications')
),
acl_alvo(nome) AS (
  VALUES ('public.public_profiles'), ('public.profiles'), ('public.vw_produtos_admin'),
         ('public.app_settings'), ('public.otp_verifications')
),
papeis_api(papel) AS (
  VALUES ('anon'), ('authenticated'), ('service_role')
),
papeis_alvo(papel) AS (
  VALUES ('anon'), ('authenticated'), ('service_role'), ('authenticator'), ('postgres'),
         ('supabase_admin'), ('supabase_read_only_user')
),
tab_gat(nome) AS (
  VALUES ('public.profiles'), ('public.public_profiles')
),
versoes(versao) AS (
  VALUES ('20261031000000'), ('20261090000000'), ('20261090500000'), ('20261110000000'),
         ('20261111000000'), ('20261130000000'), ('20261160000000'), ('20261197000000'),
         ('20261199000000'), ('20261202000000'), ('20261217000000')
),
indices(nome) AS (
  VALUES ('idx_reviews_user_id'), ('idx_questions_user_id')
),
buckets_alvo(id) AS (
  VALUES ('banners'), ('products'), ('branding'), ('produtos')
),
img AS (
  SELECT 'foto' AS coluna,
         CASE WHEN avatar_url IS NULL THEN 'nulo'
              WHEN avatar_url LIKE 'data:image/jpeg;base64,%' THEN 'jpeg'
              WHEN avatar_url LIKE 'data:image/svg+xml;utf8,%' THEN 'svg-predefinido'
              WHEN avatar_url LIKE 'data:%' THEN 'outro data: ' || COALESCE(
                     substring(lower(left(avatar_url, 120)), '^data:((image|application|text|video|audio)/[a-z0-9.+-]{1,40})[;,]'),
                     'tipo fora do formato')
              WHEN avatar_url LIKE 'https://%' THEN 'https'
              ELSE 'outro' END AS tipo,
         octet_length(avatar_url) AS bytes
    FROM public.profiles
  UNION ALL
  SELECT 'capa',
         CASE WHEN cover_url IS NULL THEN 'nulo'
              WHEN cover_url LIKE 'data:image/jpeg;base64,%' THEN 'jpeg'
              WHEN cover_url LIKE 'data:image/svg+xml;utf8,%' THEN 'svg-predefinido'
              WHEN cover_url LIKE 'data:%' THEN 'outro data: ' || COALESCE(
                     substring(lower(left(cover_url, 120)), '^data:((image|application|text|video|audio)/[a-z0-9.+-]{1,40})[;,]'),
                     'tipo fora do formato')
              WHEN cover_url LIKE 'https://%' THEN 'https'
              ELSE 'outro' END,
         octet_length(cover_url)
    FROM public.profiles
),
img_agg AS (
  SELECT i.coluna, i.tipo, count(*) AS qtd, max(i.bytes) AS maior,
         percentile_disc(0.99) WITHIN GROUP (ORDER BY i.bytes) AS p99,
         count(*) FILTER (WHERE i.bytes > 131072) AS acima_128k,
         count(*) FILTER (WHERE i.bytes > 524288) AS acima_512k
    FROM img i
   GROUP BY i.coluna, i.tipo
  UNION ALL
  SELECT k.coluna, '(total com valor)', count(i.bytes), max(i.bytes),
         percentile_disc(0.99) WITHIN GROUP (ORDER BY i.bytes),
         count(*) FILTER (WHERE i.bytes > 131072),
         count(*) FILTER (WHERE i.bytes > 524288)
    FROM (VALUES ('foto'), ('capa')) k(coluna)
    LEFT JOIN img i ON i.coluna = k.coluna AND i.bytes IS NOT NULL
   GROUP BY k.coluna
),
sto AS (
  SELECT o.bucket_id,
         count(*) AS qtd,
         max(CASE WHEN o.metadata->>'size' ~ '^[0-9]{1,18}$' THEN (o.metadata->>'size')::bigint END) AS maior,
         percentile_disc(0.95) WITHIN GROUP (
           ORDER BY CASE WHEN o.metadata->>'size' ~ '^[0-9]{1,18}$' THEN (o.metadata->>'size')::bigint END
         ) AS p95,
         count(*) FILTER (WHERE lower(o.metadata->>'mimetype') = 'image/svg+xml') AS svg,
         string_agg(DISTINCT CASE WHEN o.metadata->>'mimetype' IS NULL THEN 'sem tipo'
                                  ELSE COALESCE(substring(lower(left(o.metadata->>'mimetype', 120)), '^((image|application|text|video|audio|font)/[a-z0-9.+-]{1,60})$'),
                                                'tipo fora do formato') END, ',') AS tipos
    FROM storage.objects o
   WHERE o.bucket_id IN ('banners', 'products', 'branding', 'produtos')
   GROUP BY o.bucket_id
),
r(ordem, tipo, objeto, detalhe) AS (
  -- controle
  SELECT 0, 'controle', 'papel que leu',
         concat_ws('|',
           'papel=' || current_user::text,
           'super=' || eu.rolsuper::text,
           'bypassrls=' || eu.rolbypassrls::text,
           'le_tudo=' || pg_has_role(current_user, 'pg_read_all_data', 'MEMBER')::text,
           'escreve_tudo=' || pg_has_role(current_user, 'pg_write_all_data', 'MEMBER')::text)
    FROM pg_roles eu
   WHERE eu.rolname = current_user
  UNION ALL
  SELECT 0, 'controle', 'servidor',
         'versao_num=' || current_setting('server_version_num') || '|banco=' || current_database()
  UNION ALL
  SELECT 0, 'controle', 'rls vale para quem leu',
         concat_ws('|',
           'profiles=' || COALESCE(row_security_active(to_regclass('public.profiles'))::text, 'AUSENTE'),
           'public_profiles=' || COALESCE(row_security_active(to_regclass('public.public_profiles'))::text, 'AUSENTE'),
           'reviews=' || COALESCE(row_security_active(to_regclass('public.reviews'))::text, 'AUSENTE'),
           'questions=' || COALESCE(row_security_active(to_regclass('public.questions'))::text, 'AUSENTE'),
           'storage.objects=' || COALESCE(row_security_active(to_regclass('storage.objects'))::text, 'AUSENTE'))
  -- registro de migrations
  UNION ALL
  SELECT 1, 'migration', v.versao,
         CASE WHEN EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations m WHERE m.version = v.versao)
              THEN 'presente' ELSE 'ausente' END
    FROM versoes v
  UNION ALL
  SELECT 1, 'migration', '(ultima registrada)', COALESCE(max(m.version), '-')
    FROM supabase_migrations.schema_migrations m
  -- donos e RLS das tabelas e views
  UNION ALL
  SELECT 2, 'dono', x.nome,
         CASE WHEN x.oid IS NULL THEN 'AUSENTE'
              ELSE concat_ws('|',
                'tipo=' || CASE x.relkind WHEN 'r' THEN 'tabela' WHEN 'p' THEN 'tabela particionada'
                                          WHEN 'v' THEN 'view' WHEN 'm' THEN 'matview'
                                          ELSE x.relkind::text END,
                'dono=' || pg_get_userbyid(x.relowner),
                'dono_super=' || COALESCE(dn.rolsuper::text, '?'),
                'dono_bypassrls=' || COALESCE(dn.rolbypassrls::text, '?'),
                'mesmo_dono_de_public_profiles=' || COALESCE((x.relowner = (SELECT d.relowner FROM dono_pp d))::text, '?'),
                'rls=' || x.relrowsecurity::text,
                'forcada=' || x.relforcerowsecurity::text,
                'opcoes=' || COALESCE(array_to_string(x.reloptions, ','), '-'))
         END
    FROM rc x
    LEFT JOIN pg_roles dn ON dn.oid = x.relowner
  -- funcoes
  UNION ALL
  SELECT 3, 'funcao', f.assinatura,
         CASE WHEN f.oid IS NULL THEN 'AUSENTE'
              ELSE concat_ws('|',
                'dono=' || pg_get_userbyid(f.proowner),
                'dono_super=' || COALESCE(dn.rolsuper::text, '?'),
                'dono_bypassrls=' || COALESCE(dn.rolbypassrls::text, '?'),
                'mesmo_dono_de_public_profiles=' || COALESCE((f.proowner = (SELECT d.relowner FROM dono_pp d))::text, '?'),
                'secdef=' || f.prosecdef::text,
                'md5=' || md5(replace(f.prosrc, chr(13), '')),
                'exec=' || COALESCE(NULLIF(concat_ws(',',
                   CASE WHEN EXISTS (SELECT 1 FROM aclexplode(COALESCE(f.proacl, acldefault('f', f.proowner))) a
                                      WHERE a.grantee = 0 AND a.privilege_type = 'EXECUTE') THEN 'PUBLIC' END,
                   CASE WHEN COALESCE(has_function_privilege(pa.anon, f.oid, 'EXECUTE'), false) THEN 'anon' END,
                   CASE WHEN COALESCE(has_function_privilege(pa.autenticado, f.oid, 'EXECUTE'), false) THEN 'authenticated' END,
                   CASE WHEN COALESCE(has_function_privilege(pa.servico, f.oid, 'EXECUTE'), false) THEN 'service_role' END), ''), '-'))
         END
    FROM fc f
    LEFT JOIN pg_roles dn ON dn.oid = f.proowner
   CROSS JOIN papeis pa
  UNION ALL
  SELECT 3, 'acl-funcao',
         f.assinatura || ' / ' || CASE WHEN a.grantee = 0 THEN 'PUBLIC' ELSE pg_get_userbyid(a.grantee) END,
         'privilegio=' || a.privilege_type || CASE WHEN a.is_grantable THEN '*' ELSE '' END
           || '|grantor=' || pg_get_userbyid(a.grantor)
    FROM fc f
   CROSS JOIN aclexplode(COALESCE(f.proacl, acldefault('f', f.proowner))) a
   WHERE f.oid IS NOT NULL
  -- politicas
  UNION ALL
  SELECT 4, 'politicas', t.nome,
         CASE WHEN to_regclass(t.nome) IS NULL THEN 'AUSENTE'
              ELSE 'total=' || (SELECT count(*) FROM pg_policy x WHERE x.polrelid = to_regclass(t.nome))::text END
    FROM tab_pol t
  UNION ALL
  SELECT 4, 'politica', t.nome || '.' || pol.polname,
         concat_ws('|',
           'cmd=' || CASE pol.polcmd WHEN 'r' THEN 'SELECT' WHEN 'a' THEN 'INSERT' WHEN 'w' THEN 'UPDATE'
                                     WHEN 'd' THEN 'DELETE' ELSE 'ALL' END,
           'permissiva=' || pol.polpermissive::text,
           'papeis=' || COALESCE((SELECT string_agg(CASE WHEN q = 0::oid THEN 'public' ELSE pg_get_userbyid(q) END, ',' ORDER BY q)
                                    FROM unnest(pol.polroles) q), '-'),
           'qual_md5=' || COALESCE(md5(pg_get_expr(pol.polqual, pol.polrelid)), '-'),
           'check_md5=' || COALESCE(md5(pg_get_expr(pol.polwithcheck, pol.polrelid)), '-'),
           'qual=' || COALESCE(regexp_replace(regexp_replace(pg_get_expr(pol.polqual, pol.polrelid), '''[^'']*''', '''?''', 'g'), '\s+', ' ', 'g'), '-'),
           'check=' || COALESCE(regexp_replace(regexp_replace(pg_get_expr(pol.polwithcheck, pol.polrelid), '''[^'']*''', '''?''', 'g'), '\s+', ' ', 'g'), '-'))
    FROM tab_pol t
    JOIN pg_policy pol ON pol.polrelid = to_regclass(t.nome)
  -- ACL de tabela e view, privilegio efetivo e ACL de coluna
  UNION ALL
  SELECT 5, 'acl-tabela',
         a.nome || ' / ' || CASE WHEN e.grantee = 0 THEN 'PUBLIC' ELSE pg_get_userbyid(e.grantee) END
           || ' (por ' || pg_get_userbyid(e.grantor) || ')',
         'privilegios=' || string_agg(e.privilege_type || CASE WHEN e.is_grantable THEN '*' ELSE '' END, ','
                                      ORDER BY e.privilege_type)
    FROM acl_alvo a
    JOIN pg_class c ON c.oid = to_regclass(a.nome)
   CROSS JOIN aclexplode(COALESCE(c.relacl, acldefault('r', c.relowner))) e
   GROUP BY a.nome, e.grantee, e.grantor
  UNION ALL
  SELECT 5, 'acl-tabela', a.nome, 'AUSENTE'
    FROM acl_alvo a
   WHERE to_regclass(a.nome) IS NULL
  UNION ALL
  SELECT 6, 'privilegio-efetivo', a.nome || ' / ' || pp.papel,
         CASE WHEN c.oid IS NULL THEN 'AUSENTE'
              WHEN ro.oid IS NULL THEN 'papel ausente'
              ELSE 'tabela=' || COALESCE(NULLIF(concat_ws('',
                      CASE WHEN has_table_privilege(ro.oid, c.oid, 'SELECT') THEN 'S' END,
                      CASE WHEN has_table_privilege(ro.oid, c.oid, 'INSERT') THEN 'I' END,
                      CASE WHEN has_table_privilege(ro.oid, c.oid, 'UPDATE') THEN 'U' END,
                      CASE WHEN has_table_privilege(ro.oid, c.oid, 'DELETE') THEN 'D' END,
                      CASE WHEN has_table_privilege(ro.oid, c.oid, 'TRUNCATE') THEN 'T' END,
                      CASE WHEN has_table_privilege(ro.oid, c.oid, 'REFERENCES') THEN 'R' END,
                      CASE WHEN has_table_privilege(ro.oid, c.oid, 'TRIGGER') THEN 'G' END), ''), '-')
                   || '|coluna=' || COALESCE(NULLIF(concat_ws('',
                      CASE WHEN has_any_column_privilege(ro.oid, c.oid, 'SELECT') THEN 'S' END,
                      CASE WHEN has_any_column_privilege(ro.oid, c.oid, 'INSERT') THEN 'I' END,
                      CASE WHEN has_any_column_privilege(ro.oid, c.oid, 'UPDATE') THEN 'U' END,
                      CASE WHEN has_any_column_privilege(ro.oid, c.oid, 'REFERENCES') THEN 'R' END), ''), '-')
         END
    FROM acl_alvo a
    LEFT JOIN pg_class c ON c.oid = to_regclass(a.nome)
   CROSS JOIN papeis_api pp
    LEFT JOIN pg_roles ro ON ro.rolname = pp.papel
  UNION ALL
  SELECT 7, 'acl-coluna', a.nome || '.' || at.attname, 'acl=' || at.attacl::text
    FROM acl_alvo a
    JOIN pg_attribute at ON at.attrelid = to_regclass(a.nome)
   WHERE at.attacl IS NOT NULL AND at.attnum > 0 AND NOT at.attisdropped
  UNION ALL
  SELECT 7, 'acl-coluna', a.nome || ' (resumo)',
         CASE WHEN to_regclass(a.nome) IS NULL THEN 'AUSENTE'
              ELSE 'colunas_com_permissao_propria=' || (
                     SELECT count(*) FROM pg_attribute at
                      WHERE at.attrelid = to_regclass(a.nome) AND at.attacl IS NOT NULL
                        AND at.attnum > 0 AND NOT at.attisdropped)::text END
    FROM acl_alvo a
  -- papeis da plataforma
  UNION ALL
  SELECT 8, 'papel', pa.papel,
         CASE WHEN ro.oid IS NULL THEN 'AUSENTE'
              ELSE concat_ws('|',
                'super=' || ro.rolsuper::text,
                'bypassrls=' || ro.rolbypassrls::text,
                'herda=' || ro.rolinherit::text,
                'login=' || ro.rolcanlogin::text,
                'le_tudo=' || pg_has_role(ro.oid, 'pg_read_all_data', 'MEMBER')::text,
                'escreve_tudo=' || pg_has_role(ro.oid, 'pg_write_all_data', 'MEMBER')::text)
         END
    FROM papeis_alvo pa
    LEFT JOIN pg_roles ro ON ro.rolname = pa.papel
  -- gatilhos de profiles e public_profiles
  UNION ALL
  SELECT 9, 'gatilho', t.nome || '.' || tg.tgname,
         'ligado=' || tg.tgenabled::text
           || '|def_md5=' || md5(pg_get_triggerdef(tg.oid))
           || '|def=' || regexp_replace(pg_get_triggerdef(tg.oid), '''[^'']*''', '''?''', 'g')
    FROM tab_gat t
    JOIN pg_trigger tg ON tg.tgrelid = to_regclass(t.nome) AND NOT tg.tgisinternal
  -- contagens (so numeros) e indices
  UNION ALL
  SELECT 10, 'contagem', 'perfis', 'total=' || (SELECT count(*) FROM public.profiles)::text
  UNION ALL
  SELECT 10, 'contagem', 'perfis publicos', 'total=' || (SELECT count(*) FROM public.public_profiles)::text
  UNION ALL
  SELECT 10, 'contagem', 'perfis com avaliacao (qualquer status) ou pergunta',
         'total=' || (SELECT count(*) FROM public.profiles pf
                       WHERE EXISTS (SELECT 1 FROM public.reviews rv WHERE rv.user_id = pf.id)
                          OR EXISTS (SELECT 1 FROM public.questions qs WHERE qs.user_id = pf.id))::text
  UNION ALL
  SELECT 10, 'coluna', 'public.reviews.status',
         CASE WHEN EXISTS (SELECT 1 FROM pg_attribute at
                            WHERE at.attrelid = to_regclass('public.reviews') AND at.attname = 'status'
                              AND at.attnum > 0 AND NOT at.attisdropped)
              THEN 'presente' ELSE 'AUSENTE' END
  UNION ALL
  SELECT 10, 'indice', i.nome,
         COALESCE((SELECT 'def_md5=' || md5(x.indexdef)
                          || '|def=' || regexp_replace(x.indexdef, '''[^'']*''', '''?''', 'g')
                     FROM pg_indexes x WHERE x.schemaname = 'public' AND x.indexname = i.nome),
                  'AUSENTE')
    FROM indices i
  -- imagens de perfil (so tamanho e tipo)
  UNION ALL
  SELECT 11, 'imagem-perfil', g.coluna || ' / ' || g.tipo,
         concat_ws('|',
           'qtd=' || g.qtd::text,
           'maior=' || COALESCE(g.maior::text, '-'),
           'p99=' || COALESCE(g.p99::text, '-'),
           'acima_128k=' || g.acima_128k::text,
           'acima_512k=' || g.acima_512k::text)
    FROM img_agg g
  -- storage
  UNION ALL
  SELECT 12, 'bucket', b.id::text,
         concat_ws('|',
           'publico=' || b.public::text,
           'limite_bytes=' || COALESCE(b.file_size_limit::text, 'sem'),
           'mime=' || COALESCE(array_to_string(b.allowed_mime_types, ','), 'qualquer'))
    FROM storage.buckets b
  UNION ALL
  SELECT 13, 'storage-objetos', ba.id,
         concat_ws('|',
           'arquivos=' || COALESCE(s.qtd, 0)::text,
           'maior=' || COALESCE(s.maior::text, '-'),
           'p95=' || COALESCE(s.p95::text, '-'),
           'svg=' || COALESCE(s.svg, 0)::text,
           'tipos=' || COALESCE(s.tipos, '-'))
    FROM buckets_alvo ba
    LEFT JOIN sto s ON s.bucket_id = ba.id
)
SELECT tipo, objeto, detalhe
  FROM r
 ORDER BY ordem, objeto, detalhe;
