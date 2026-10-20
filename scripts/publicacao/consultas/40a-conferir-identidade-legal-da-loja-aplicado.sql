-- 40a — DEPOIS de aplicar a migration 20261239000000 (a loja PODE declarar razao social, CNPJ/CPF e e-mail de
-- atendimento: tres colunas novas e opcionais em `store_config`, lidas pela view `v_store_config` e gravadas por
-- `upsert_store_config`): confirma, POR OBJETO, que as tres colunas existem (text, nulas, sem default) com a CHECK de
-- forma de cada uma, que a view `v_store_config` tem as 45 colunas (as 42 de sempre mais as tres NO FIM) com as
-- opcoes e o ACL de sempre, e que o corpo vivo de `upsert_store_config(jsonb)` e o NOVO (md5), traz os tres CASE do
-- ON CONFLICT e mantem os atributos e o EXECUTE de sempre. E' a consulta do lote em `provasDeObjetos` de
-- scripts/frota/canais-de-backend.json; a de ausencia e' a 40b.
-- SO LEITURA, um unico SELECT, so catalogo (pg_proc, pg_namespace, pg_language, pg_attribute, pg_attrdef,
-- pg_constraint, pg_class, aclexplode): nenhuma linha de store_config, de produto, de pedido ou de cliente e' lida nem
-- devolvida.
--
-- Saida: item | esperado | vivo | ok, com as linhas ok = false primeiro. Rol FECHADO de 11 linhas, as mesmas em
-- qualquer estado do banco (objeto ausente vira `AUSENTE` ou `nenhuma` na propria linha, nunca some uma linha). Tudo
-- `true` = a identidade legal esta aplicada; qualquer `false` = PARE e leia a linha. Depois do rollback-manual
-- reprovam as linhas do corpo, do marcador, das colunas, das CHECK e da lista de colunas da view (o ACL e as opcoes
-- da view voltam como estavam).
--
--   * sobrecargas -- UMA funcao com esse nome em `public`.
--   * corpo   -- md5(replace(prosrc, chr(13), '')) do corpo vivo (LF ou CRLF): o da 20261239000000.
--   * marcador -- 'sim' se o corpo traz os tres CASE do ON CONFLICT (`store_legal_name = CASE WHEN config_json ?
--                'store_legal_name'` e os dois irmaos): e' o coracao do aceite "salvar um campo nao apaga os outros".
--                Leitura humana do mesmo fato do md5.
--   * atributos -- SECURITY DEFINER + plpgsql + VOLATILE + `search_path=public` + retorno jsonb.
--   * EXECUTE -- PUBLIC e' medido por aclexplode(coalesce(proacl, acldefault('f', dono))), porque
--                has_function_privilege nao tem o pseudo-papel PUBLIC; anon e authenticated por
--                has_function_privilege. O EXECUTE de service_role nao e' medido (o CREATE OR REPLACE o preserva).
--   * colunas -- nome:tipo:notnull:default das tres colunas, em ordem de nome.
--   * CHECK   -- as tres CHECK de forma (nome, tipo c, validada, a coluna que cada uma cobre, e `regra=sim` se o
--                texto da definicao traz o numero que a distingue: 200 na razao social, a forma do CPF/CNPJ no
--                documento, 254 no e-mail). Nao compara o texto inteiro do deparse (varia com a versao do Postgres).
--   * vista   -- as colunas de `v_store_config` na ordem, as opcoes (`security_invoker=on`) e o ACL: dono, o que
--                anon, authenticated e service_role tem (ALL = tudo o que um GRANT ALL de tabela da, na versao do
--                servidor), se PUBLIC tem alguma coisa, quantos outros papeis tem e quantos tem GRANT OPTION.
--
-- O ACL DA VISTA importa para o DESFAZER: o rollback-manual encolhe a view de 45 para 42 colunas, e o Postgres
-- RECUSA `CREATE OR REPLACE VIEW` que encolha; por isso ele faz DROP VIEW + CREATE VIEW + `GRANT ALL TO anon,
-- authenticated, service_role`. So reproduz o ACL de hoje se hoje ele for exatamente esse (dono postgres, os tres
-- com ALL, ninguem mais). A ida (CREATE OR REPLACE) nao mexe no ACL; esta linha prova que ele segue assim.
--
-- md5 recalculado do ARQUIVO da migration por tests/migration_a_loja_declara_quem_e_na_nota_e_como_falar_com_ela_test.ts;
-- tests/banco/loja-declara-quem-e-portao-viva.cjs roda esta consulta num Postgres real (positiva depois do apply,
-- negativa depois do rollback, um negativo por linha).
-- LIMITES: nao prova o COMPORTAMENTO (isso e' de tests/banco/loja-declara-quem-e-viva.cjs). Evidencia LOCAL nao prova a
-- IKCOUS nem a Savy: so o run desta consulta contra o ref de cada loja. Ela nao mede as colunas alem das tres nem as
-- outras CHECK de store_config.
WITH alvo(assinatura) AS (
  VALUES ('public.upsert_store_config(jsonb)')
), fn AS (
  SELECT p.oid,
         (SELECT count(*) FROM pg_proc q JOIN pg_namespace n ON n.oid = q.pronamespace
           WHERE n.nspname = 'public' AND q.proname = 'upsert_store_config') AS sobrecargas,
         md5(replace(p.prosrc, chr(13), '')) AS m,
         CASE WHEN position('store_legal_name = CASE WHEN config_json ? ''store_legal_name''' IN p.prosrc) > 0
                   AND position('store_legal_document = CASE WHEN config_json ? ''store_legal_document''' IN p.prosrc) > 0
                   AND position('store_support_email = CASE WHEN config_json ? ''store_support_email''' IN p.prosrc) > 0
              THEN 'sim' ELSE 'nao' END AS marcador,
         CASE WHEN p.prosecdef AND l.lanname = 'plpgsql' AND p.provolatile = 'v'
                   AND p.proconfig = ARRAY['search_path=public']::text[]
                   AND p.prorettype = 'jsonb'::regtype
              THEN 'SECURITY DEFINER plpgsql VOLATILE search_path=public -> jsonb'
              ELSE 'DIFERENTE' END AS atributos,
         'PUBLIC=' || CASE WHEN EXISTS (
                  SELECT 1 FROM aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
                   WHERE a.grantee = 0 AND a.privilege_type = 'EXECUTE') THEN 'sim' ELSE 'nao' END
              || ' anon=' || CASE WHEN to_regrole('anon') IS NULL THEN 'papel ausente'
                                  WHEN has_function_privilege('anon', p.oid, 'EXECUTE') THEN 'sim' ELSE 'nao' END
              || ' authenticated=' || CASE WHEN to_regrole('authenticated') IS NULL THEN 'papel ausente'
                                           WHEN has_function_privilege('authenticated', p.oid, 'EXECUTE') THEN 'sim' ELSE 'nao' END AS acl
    FROM alvo t
    JOIN pg_proc p ON p.oid = to_regprocedure(t.assinatura)
    JOIN pg_language l ON l.oid = p.prolang
), colunas_vivas AS (
  SELECT string_agg(a.attname::text || ':' || format_type(a.atttypid, a.atttypmod)
                    || ':notnull=' || a.attnotnull::text
                    || ':default=' || COALESCE(pg_get_expr(d.adbin, d.adrelid), 'nenhum'),
                    ' ; ' ORDER BY a.attname::text) AS def
    FROM pg_attribute a
    LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
   WHERE a.attrelid = to_regclass('public.store_config')
     AND a.attname IN ('store_legal_name', 'store_legal_document', 'store_support_email')
     AND a.attnum > 0 AND NOT a.attisdropped
), checks_vivas AS (
  SELECT string_agg(k.conname::text || ' tipo=' || k.contype::text
                    || ' validada=' || k.convalidated::text
                    || ' colunas=' || COALESCE((SELECT string_agg(a.attname::text, ',' ORDER BY u.ord)
                                                  FROM unnest(k.conkey) WITH ORDINALITY AS u(attnum, ord)
                                                  JOIN pg_attribute a ON a.attrelid = k.conrelid AND a.attnum = u.attnum), '')
                    || ' regra=' || CASE
                         WHEN k.conname = 'store_config_store_legal_name_check'
                              AND position('200' IN pg_get_constraintdef(k.oid)) > 0 THEN 'sim'
                         WHEN k.conname = 'store_config_store_legal_document_check'
                              AND position('[0-9A-Z]{12}[0-9]{2}' IN pg_get_constraintdef(k.oid)) > 0 THEN 'sim'
                         WHEN k.conname = 'store_config_store_support_email_check'
                              AND position('254' IN pg_get_constraintdef(k.oid)) > 0 THEN 'sim'
                         ELSE 'nao' END,
                    ' ; ' ORDER BY k.conname::text) AS def
    FROM pg_constraint k
   WHERE k.conrelid = to_regclass('public.store_config')
     AND k.conname IN ('store_config_store_legal_name_check',
                       'store_config_store_legal_document_check',
                       'store_config_store_support_email_check')
), vista AS (
  SELECT c.oid, c.relowner, pg_get_userbyid(c.relowner) AS dono,
         (SELECT string_agg(a.attname::text, ',' ORDER BY a.attnum)
            FROM pg_attribute a
           WHERE a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped) AS colunas,
         COALESCE(array_to_string(c.reloptions, ','), '(nenhuma)') AS opcoes,
         COALESCE(c.relacl, acldefault('r', c.relowner)) AS acl
    FROM pg_class c
   WHERE c.oid = to_regclass('public.v_store_config') AND c.relkind = 'v'
), tudo_de_tabela AS (
  SELECT string_agg(t.privilege_type, ',' ORDER BY t.privilege_type) AS privs
    FROM vista v, aclexplode(acldefault('r', v.relowner)) t
   WHERE t.grantee = v.relowner
), privs_por_papel AS (
  SELECT r.papel,
         (SELECT string_agg(g.privilege_type, ',' ORDER BY g.privilege_type)
            FROM vista v, aclexplode(v.acl) g
           WHERE g.grantee = to_regrole(r.papel)::oid) AS privs
    FROM (VALUES ('anon'), ('authenticated'), ('service_role')) AS r(papel)
), acl_da_vista AS (
  SELECT 'dono=' || v.dono
         || ' ' || (SELECT string_agg(p.papel || '=' || CASE
                                 WHEN to_regrole(p.papel) IS NULL THEN 'papel ausente'
                                 WHEN p.privs IS NULL THEN 'nenhum'
                                 WHEN p.privs = (SELECT privs FROM tudo_de_tabela) THEN 'ALL'
                                 ELSE p.privs END,
                                 ' ' ORDER BY p.papel)
                      FROM privs_por_papel p)
         || ' PUBLIC=' || CASE WHEN EXISTS (SELECT 1 FROM aclexplode(v.acl) g WHERE g.grantee = 0) THEN 'sim' ELSE 'nao' END
         || ' outros=' || (SELECT count(DISTINCT g.grantee) FROM aclexplode(v.acl) g
                            WHERE g.grantee <> 0 AND g.grantee <> v.relowner
                              AND g.grantee NOT IN (SELECT o.oid FROM pg_roles o
                                                     WHERE o.rolname IN ('anon', 'authenticated', 'service_role')))::text
         || ' concede=' || (SELECT count(*) FROM aclexplode(v.acl) g
                             WHERE g.is_grantable AND g.grantee <> v.relowner)::text AS def
    FROM vista v
), itens(item, esperado, vivo) AS (
  SELECT 'controle: funcoes de public visiveis a este papel', '>0',
         CASE WHEN (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                     WHERE n.nspname = 'public') > 0 THEN '>0' ELSE '0' END
  UNION ALL
  SELECT 'upsert_store_config: sobrecargas', '1',
         COALESCE((SELECT f.sobrecargas::text FROM fn f), 'AUSENTE')
  UNION ALL
  SELECT 'upsert_store_config: corpo e o da 20261239000000, com razao social, documento e e-mail (md5)',
         'b562669936df1cda31d4bdd4d075bff3',
         -- 2 hashes aceitos: o corpo da 20261239000000 OU o da SUCESSORA dele, a 20261244000000 (a loja escolhe como
         -- entrega na cidade: o mesmo corpo mais as duas chaves da entrega propria). O `vivo` mostra o esperado.
         COALESCE((SELECT CASE WHEN f.m IN ('b562669936df1cda31d4bdd4d075bff3', '391e8e1064400df5aea579f3472b203c')
                               THEN 'b562669936df1cda31d4bdd4d075bff3'
                               ELSE f.m END
                     FROM fn f), 'AUSENTE')
  UNION ALL
  SELECT 'upsert_store_config: o corpo so grava razao social, documento e e-mail quando a chave vem no payload',
         'sim',
         COALESCE((SELECT f.marcador FROM fn f), 'AUSENTE')
  UNION ALL
  SELECT 'upsert_store_config: atributos de sempre (SECURITY DEFINER, VOLATILE, search_path=public)',
         'SECURITY DEFINER plpgsql VOLATILE search_path=public -> jsonb',
         COALESCE((SELECT f.atributos FROM fn f), 'AUSENTE')
  UNION ALL
  SELECT 'upsert_store_config: EXECUTE fechado para anon (authenticated sim)',
         'PUBLIC=nao anon=nao authenticated=sim',
         COALESCE((SELECT f.acl FROM fn f), 'AUSENTE')
  UNION ALL
  SELECT 'store_config: razao social, documento e e-mail sao text, nulos e sem default',
         'store_legal_document:text:notnull=false:default=nenhum ; store_legal_name:text:notnull=false:default=nenhum ; store_support_email:text:notnull=false:default=nenhum',
         COALESCE((SELECT c.def FROM colunas_vivas c), 'nenhuma')
  UNION ALL
  SELECT 'store_config: as tres CHECK de forma existem, validadas, cada uma na sua coluna',
         'store_config_store_legal_document_check tipo=c validada=true colunas=store_legal_document regra=sim ; store_config_store_legal_name_check tipo=c validada=true colunas=store_legal_name regra=sim ; store_config_store_support_email_check tipo=c validada=true colunas=store_support_email regra=sim',
         COALESCE((SELECT c.def FROM checks_vivas c), 'nenhuma')
  UNION ALL
  SELECT 'v_store_config: as 45 colunas, as tres novas no fim',
         'id,free_shipping_min,shipping_fee,whatsapp_number,share_text,business_hours,enable_reviews,enable_coupons,primary_color,theme_mode,logo_url,real_time_sales_alerts,push_marketing_enabled,min_app_version,origin_cep,shipping_provider,enabled_shipping_methods,shipping_coverage,local_delivery_fee,local_cep_range,created_at,updated_at,store_name,store_city,store_state,home_sections,secondary_color,accent_color,branding_assets,dominio_publico,mp_public_key,vapid_public_key,pagamento_online,manutencao,store_address,store_description,national_shipping_strategy,national_shipping_min,national_discount_type,national_discount_value,national_benefit_scope,formas_pagamento_entrega,store_legal_name,store_legal_document,store_support_email',
         -- 2 listas aceitas: as 45 desta migration OU essas mesmas 45 + as 2 da SUCESSORA (a 20261244000000, a loja escolhe
         -- como entrega na cidade: local_delivery_enabled e local_delivery_days, no fim). O `vivo` mostra o esperado.
         COALESCE((SELECT CASE WHEN v.colunas = 'id,free_shipping_min,shipping_fee,whatsapp_number,share_text,business_hours,enable_reviews,enable_coupons,primary_color,theme_mode,logo_url,real_time_sales_alerts,push_marketing_enabled,min_app_version,origin_cep,shipping_provider,enabled_shipping_methods,shipping_coverage,local_delivery_fee,local_cep_range,created_at,updated_at,store_name,store_city,store_state,home_sections,secondary_color,accent_color,branding_assets,dominio_publico,mp_public_key,vapid_public_key,pagamento_online,manutencao,store_address,store_description,national_shipping_strategy,national_shipping_min,national_discount_type,national_discount_value,national_benefit_scope,formas_pagamento_entrega,store_legal_name,store_legal_document,store_support_email' || ',local_delivery_enabled,local_delivery_days'
                               THEN 'id,free_shipping_min,shipping_fee,whatsapp_number,share_text,business_hours,enable_reviews,enable_coupons,primary_color,theme_mode,logo_url,real_time_sales_alerts,push_marketing_enabled,min_app_version,origin_cep,shipping_provider,enabled_shipping_methods,shipping_coverage,local_delivery_fee,local_cep_range,created_at,updated_at,store_name,store_city,store_state,home_sections,secondary_color,accent_color,branding_assets,dominio_publico,mp_public_key,vapid_public_key,pagamento_online,manutencao,store_address,store_description,national_shipping_strategy,national_shipping_min,national_discount_type,national_discount_value,national_benefit_scope,formas_pagamento_entrega,store_legal_name,store_legal_document,store_support_email'
                               ELSE v.colunas END
                     FROM vista v), 'AUSENTE')
  UNION ALL
  SELECT 'v_store_config: opcoes de sempre (security_invoker=on)',
         'security_invoker=on',
         COALESCE((SELECT v.opcoes FROM vista v), 'AUSENTE')
  UNION ALL
  SELECT 'v_store_config: ACL de sempre (anon, authenticated e service_role com ALL, dono postgres, ninguem mais)',
         'dono=postgres anon=ALL authenticated=ALL service_role=ALL PUBLIC=nao outros=0 concede=0',
         COALESCE((SELECT a.def FROM acl_da_vista a), 'AUSENTE')
)
SELECT item, esperado, vivo, COALESCE(vivo = esperado, false) AS ok
  FROM itens
 ORDER BY ok, item;
