-- 40m — MEDICAO, so leitura, do que a migration 20261239000000 (a loja PODE declarar razao social, CNPJ/CPF e e-mail
-- de atendimento) e o seu rollback-manual vao encontrar na loja: o ACL CRU da view `v_store_config` (o que o rollback
-- recria por DROP VIEW + CREATE VIEW + GRANT ALL), quantos objetos dependem dela (o DROP VIEW do rollback RECUSA se
-- algum depender), se `store_config` tem a linha unica de sempre e o estado de `upsert_store_config`.
-- Molde da 18a/22m/32m/34m/35m: UM SELECT de ROL ABERTO, sem coluna `ok`; nunca e prova do portao da release. Quem
-- decide e a pessoa que le a tabela. Rodar nas duas lojas assinantes (IKCOUS e Savy), ANTES do apply: o apply nao muda
-- nenhuma linha de dado (so acrescenta tres colunas nulas), mas o DESFAZER troca a view, e e' aqui que se ve se o
-- ACL de hoje e' o que o GRANT ALL do rollback reproduz.
--
-- Saida: tipo | objeto | detalhe (detalhe = `chave=valor`, separado por `|`). Tipos, na ordem:
--   controle   quem leu (superusuario?, BYPASSRLS?).
--   vista      v_store_config: dono, opcoes e ACL CRU (`relacl`, o texto que o Postgres guarda, com os nomes dos
--              papeis e as letras dos privilegios), quantas colunas tem e quantos objetos dependem dela.
--   contagem   linhas de `store_config` (esperado 1; a view filtra id = 1).
--   funcao     upsert_store_config: md5 do corpo vivo (o da 20261199000000 antes do apply, o da 20261239000000 depois),
--              se tem uma so sobrecarga e quais papeis tem EXECUTE.
-- NENHUM DADO PESSOAL: so catalogo e contagens; nenhum valor de coluna de `store_config` e' lido. O log do run e'
-- legivel por quem le o repositorio: o que sai daqui sao nomes de papeis e letras de privilegio.
-- tests/migration_a_loja_declara_quem_e_na_nota_e_como_falar_com_ela_test.ts prende essas regras no texto desta consulta.
SELECT 'controle' AS tipo, 'quem leu' AS objeto,
       'superusuario=' || (SELECT rolsuper FROM pg_roles WHERE rolname = current_user)::text
       || '|bypassrls=' || (SELECT rolbypassrls FROM pg_roles WHERE rolname = current_user)::text AS detalhe
UNION ALL
SELECT 'vista', 'v_store_config: dono, opcoes e ACL cru (o que o rollback recria)',
       COALESCE((SELECT 'dono=' || pg_get_userbyid(c.relowner)
                        || '|opcoes=' || COALESCE(array_to_string(c.reloptions, ','), '(nenhuma)')
                        || '|acl=' || COALESCE(c.relacl::text, '(padrao do dono)')
                   FROM pg_class c
                  WHERE c.oid = to_regclass('public.v_store_config') AND c.relkind = 'v'), 'AUSENTE')
UNION ALL
SELECT 'vista', 'v_store_config: colunas',
       COALESCE((SELECT 'total=' || count(*)::text
                   FROM pg_attribute a
                  WHERE a.attrelid = to_regclass('public.v_store_config')
                    AND a.attnum > 0 AND NOT a.attisdropped), 'AUSENTE')
UNION ALL
SELECT 'vista', 'objetos que dependem da v_store_config (o DROP VIEW do rollback recusa se houver algum)',
       'total=' || (SELECT count(DISTINCT r.ev_class)
                      FROM pg_depend d
                      JOIN pg_rewrite r ON r.oid = d.objid
                     WHERE d.refobjid = to_regclass('public.v_store_config')
                       AND d.classid = 'pg_rewrite'::regclass
                       AND r.ev_class <> d.refobjid)::text
UNION ALL
SELECT 'contagem', 'linhas de store_config (esperado 1)',
       'total=' || (SELECT count(*) FROM public.store_config)::text
UNION ALL
SELECT 'funcao', 'upsert_store_config: corpo vivo, sobrecargas e quem executa',
       COALESCE((SELECT 'md5=' || md5(replace(p.prosrc, chr(13), ''))
                        || '|sobrecargas=' || (SELECT count(*) FROM pg_proc q
                                                WHERE q.pronamespace = 'public'::regnamespace
                                                  AND q.proname = 'upsert_store_config')::text
                        || '|anon=' || CASE WHEN to_regrole('anon') IS NULL THEN 'papel ausente'
                                            WHEN has_function_privilege('anon', p.oid, 'EXECUTE') THEN 'sim' ELSE 'nao' END
                        || '|authenticated=' || CASE WHEN to_regrole('authenticated') IS NULL THEN 'papel ausente'
                                                     WHEN has_function_privilege('authenticated', p.oid, 'EXECUTE') THEN 'sim' ELSE 'nao' END
                   FROM pg_proc p
                  WHERE p.oid = to_regprocedure('public.upsert_store_config(jsonb)')), 'AUSENTE');
