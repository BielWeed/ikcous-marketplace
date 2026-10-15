-- 40b — ANTES de aplicar a migration 20261239000000 (a loja PODE declarar razao social, CNPJ/CPF e e-mail de
-- atendimento): confirma, POR OBJETO, a base de antes: `upsert_store_config(jsonb)` existe, UMA so, com o corpo
-- VIGENTE (md5, o da 20261199000000), SEM os tres CASE novos e com os atributos de sempre; as tres colunas e as tres
-- CHECK de forma AINDA NAO existem em `store_config`; e a view `v_store_config` tem as 42 colunas de sempre, as
-- opcoes de sempre e o ACL que o rollback-manual sabe devolver. E' a consulta de AUSENCIA (`ausenciaConfirmadaPor`) do
-- lote em `provasDeObjetos` de scripts/frota/canais-de-backend.json: a 40a negativa so vira "aplique" se esta for
-- positiva (a loja esta na base de antes, nao em um corpo ou uma view que ninguem mediu).
-- SO LEITURA, um unico SELECT, so catalogo (pg_proc, pg_namespace, pg_language, pg_attribute, pg_constraint,
-- pg_class, aclexplode): nenhuma linha de store_config, de produto, de pedido ou de cliente e' lida nem devolvida.
--
-- NAO mede o EXECUTE de upsert_store_config de proposito: a ACL da funcao e' a da 20260819000000 e o CREATE OR
-- REPLACE da migration (e o do rollback) a preservam. MEDE o ACL da VISTA, que e' o que o rollback RECRIA.
--
-- Saida: item | esperado | vivo | ok, com as linhas ok = false primeiro. Rol FECHADO de 10 linhas, as mesmas em
-- qualquer estado do banco (objeto ausente vira `AUSENTE` ou `nenhuma` na propria linha). Tudo `true` = a loja esta
-- na base de antes; uma loja que JA tem a identidade legal reprova aqui de proposito, nas linhas do corpo, do
-- marcador, das colunas, das CHECK e da lista de colunas da view.
--
--   * corpo   -- md5(replace(prosrc, chr(13), '')) do corpo vivo (LF ou CRLF): o da 20261199000000.
--   * marcador -- 'nao' se os tres CASE novos NAO aparecem no corpo (so o corpo novo os traz).
--   * atributos -- SECURITY DEFINER + plpgsql + VOLATILE + `search_path=public` + retorno jsonb.
--   * colunas / CHECK -- `nenhuma`: nem as tres colunas nem as tres CHECK existem ainda.
--   * vista   -- as 42 colunas de `v_store_config` na ordem, as opcoes (`security_invoker=on`) e o ACL.
--
-- O ACL DA VISTA (a FOTOGRAFIA do vivo): o rollback-manual encolhe a view de 45 para 42 colunas. O Postgres RECUSA
-- `CREATE OR REPLACE VIEW` que encolha, entao ele faz DROP VIEW + CREATE VIEW + `GRANT ALL ON TABLE ... TO anon,
-- authenticated, service_role`. DROP VIEW apaga o ACL junto; o GRANT ALL o refaz. So reproduz o estado vivo se o
-- ACL vivo de hoje for EXATAMENTE esse: dono postgres, anon, authenticated e service_role com ALL (tudo o que um
-- GRANT ALL de tabela da, na versao do servidor), PUBLIC sem nada, nenhum outro papel e nenhum GRANT OPTION. Esta
-- linha mede isso na loja ANTES do apply; um ACL diferente (a view mais fechada do que o GRANT ALL, um papel a
-- mais) reprova aqui e o apply NAO sai: desfazer devolveria a view com outro ACL. A 40m mostra o ACL cru.
--
-- tests/banco/loja-declara-quem-e-portao-viva.cjs roda esta consulta num Postgres real (positiva depois do rollback,
-- negativa depois do apply, um negativo por linha). O md5 do corpo de antes vem do ARQUIVO da migration
-- 20261199000000, nao de uma loja: o valor VIVO de cada loja so esta consulta mede.
-- LIMITE: evidencia LOCAL nao prova a IKCOUS nem a Savy: so o run desta consulta contra o ref de cada loja.
WITH alvo(assinatura) AS (
  VALUES ('public.upsert_store_config(jsonb)')
), fn AS (
  SELECT p.oid,
         (SELECT count(*) FROM pg_proc q JOIN pg_namespace n ON n.oid = q.pronamespace
           WHERE n.nspname = 'public' AND q.proname = 'upsert_store_config') AS sobrecargas,
         md5(replace(p.prosrc, chr(13), '')) AS m,
         CASE WHEN position('store_legal_name = CASE WHEN config_json ? ''store_legal_name''' IN p.prosrc) > 0
                   OR position('store_legal_document = CASE WHEN config_json ? ''store_legal_document''' IN p.prosrc) > 0
                   OR position('store_support_email = CASE WHEN config_json ? ''store_support_email''' IN p.prosrc) > 0
              THEN 'sim' ELSE 'nao' END AS marcador,
         CASE WHEN p.prosecdef AND l.lanname = 'plpgsql' AND p.provolatile = 'v'
                   AND p.proconfig = ARRAY['search_path=public']::text[]
                   AND p.prorettype = 'jsonb'::regtype
              THEN 'SECURITY DEFINER plpgsql VOLATILE search_path=public -> jsonb'
              ELSE 'DIFERENTE' END AS atributos
    FROM alvo t
    JOIN pg_proc p ON p.oid = to_regprocedure(t.assinatura)
    JOIN pg_language l ON l.oid = p.prolang
), colunas_vivas AS (
  SELECT string_agg(a.attname::text || ':' || format_type(a.atttypid, a.atttypmod), ' ; ' ORDER BY a.attname::text) AS def
    FROM pg_attribute a
   WHERE a.attrelid = to_regclass('public.store_config')
     AND a.attname IN ('store_legal_name', 'store_legal_document', 'store_support_email')
     AND a.attnum > 0 AND NOT a.attisdropped
), checks_vivas AS (
  SELECT string_agg(k.conname::text, ' ; ' ORDER BY k.conname::text) AS def
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
  SELECT 'upsert_store_config: corpo e o da 20261199000000, sem razao social, documento e e-mail (md5)',
         '9c56a9c6953e1d774a1ee97d5d8a7e16',
         COALESCE((SELECT f.m FROM fn f), 'AUSENTE')
  UNION ALL
  SELECT 'upsert_store_config: o corpo ainda NAO grava razao social, documento e e-mail',
         'nao',
         COALESCE((SELECT f.marcador FROM fn f), 'AUSENTE')
  UNION ALL
  SELECT 'upsert_store_config: atributos de sempre (SECURITY DEFINER, VOLATILE, search_path=public)',
         'SECURITY DEFINER plpgsql VOLATILE search_path=public -> jsonb',
         COALESCE((SELECT f.atributos FROM fn f), 'AUSENTE')
  UNION ALL
  SELECT 'store_config: razao social, documento e e-mail ainda NAO existem',
         'nenhuma',
         COALESCE((SELECT c.def FROM colunas_vivas c), 'nenhuma')
  UNION ALL
  SELECT 'store_config: as tres CHECK de forma ainda NAO existem',
         'nenhuma',
         COALESCE((SELECT c.def FROM checks_vivas c), 'nenhuma')
  UNION ALL
  SELECT 'v_store_config: as 42 colunas de sempre',
         'id,free_shipping_min,shipping_fee,whatsapp_number,share_text,business_hours,enable_reviews,enable_coupons,primary_color,theme_mode,logo_url,real_time_sales_alerts,push_marketing_enabled,min_app_version,origin_cep,shipping_provider,enabled_shipping_methods,shipping_coverage,local_delivery_fee,local_cep_range,created_at,updated_at,store_name,store_city,store_state,home_sections,secondary_color,accent_color,branding_assets,dominio_publico,mp_public_key,vapid_public_key,pagamento_online,manutencao,store_address,store_description,national_shipping_strategy,national_shipping_min,national_discount_type,national_discount_value,national_benefit_scope,formas_pagamento_entrega',
         COALESCE((SELECT v.colunas FROM vista v), 'AUSENTE')
  UNION ALL
  SELECT 'v_store_config: opcoes de sempre (security_invoker=on)',
         'security_invoker=on',
         COALESCE((SELECT v.opcoes FROM vista v), 'AUSENTE')
  UNION ALL
  SELECT 'v_store_config: ACL que o rollback devolve (anon, authenticated e service_role com ALL, dono postgres, ninguem mais)',
         'dono=postgres anon=ALL authenticated=ALL service_role=ALL PUBLIC=nao outros=0 concede=0',
         COALESCE((SELECT a.def FROM acl_da_vista a), 'AUSENTE')
)
SELECT item, esperado, vivo, COALESCE(vivo = esperado, false) AS ok
  FROM itens
 ORDER BY ok, item;
