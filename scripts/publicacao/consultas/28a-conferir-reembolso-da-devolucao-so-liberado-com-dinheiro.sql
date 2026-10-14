-- 28a — DEPOIS de aplicar a migration 20261225000000 (o reembolso da devolucao so e' "liberado" quando o dinheiro
-- sai): confirma, POR OBJETO, que os tres corpos vivos sao os NOVOS (md5): o gatilho de aviso da devolucao
-- (`devolucao_avisa_o_cliente`) passa a dizer o estado REAL do reembolso na conclusao, a auxiliar interna
-- (`devolucao__avisar_reembolso`) deduplica o aviso e a funcao de gatilho (`devolucao_avisa_reembolso_liberado`)
-- avisa "liberado" quando o dinheiro SAI; que os atributos sao os de sempre (SECURITY DEFINER, plpgsql,
-- VOLATILE, `search_path=public`: a lista L8 reprova se o tipo ou o SECURITY DEFINER mudarem); que o EXECUTE
-- esta FECHADO (nenhuma das tres alcancavel por PUBLIC, anon ou authenticated; a auxiliar nem por service_role); e
-- que o gatilho novo de `order_refunds` esta ligado so na virada para 'concluido'. E' a consulta do lote em
-- `provasDeObjetos` de scripts/frota/canais-de-backend.json; a de ausencia e' a 28b.
-- SO LEITURA, um unico SELECT, so catalogo (pg_proc, pg_namespace, pg_language, pg_trigger, aclexplode): nenhuma
-- linha de devolucao, de reembolso ou de aviso e' lida nem devolvida.
--
-- Saida: item | esperado | vivo | ok, com as linhas ok = false primeiro. Rol FECHADO de 8 linhas, as mesmas em
-- qualquer estado do banco (objeto ausente vira `AUSENTE` na propria linha, nunca some uma linha). Tudo
-- `true` = o corte esta aplicado; qualquer `false` = PARE e leia a linha. Depois do rollback-manual reprovam
-- SO as linhas dos corpos, da funcao nova e do gatilho.
--
--   * corpo      -- md5(replace(prosrc, chr(13), '')) do corpo vivo (LF ou CRLF).
--   * estado real -- 'sim' se o corpo de `devolucao_avisa_o_cliente` le o status do reembolso
--                   (`SELECT r.status INTO v_estado`) e distingue 'reembolso_em_processamento' e
--                   'reembolso_nao_liberado': leitura humana do mesmo fato do md5.
--   * atributos  -- SECURITY DEFINER + plpgsql + VOLATILE + proconfig = {search_path=public}, nas TRES funcoes.
--   * EXECUTE    -- PUBLIC e' medido por aclexplode(coalesce(proacl, acldefault('f', dono))), porque
--                   has_function_privilege nao tem o pseudo-papel PUBLIC; anon, authenticated e service_role
--                   por has_function_privilege.
--   * gatilho    -- tgenabled = 'O', aponta para a funcao e a definicao tem AFTER UPDATE OF status e WHEN.
--
-- md5 recalculado dos ARQUIVOS das migrations por tests/ci_conferir_banco_test.ts, e
-- tests/banco/reembolso-da-devolucao-portao-viva.cjs roda esta consulta num Postgres real (positiva depois do
-- apply, negativa depois do rollback, um negativo por linha). LIMITES: nao prova o COMPORTAMENTO (isso e' de
-- tests/banco/reembolso-da-devolucao-viva.cjs). Evidencia LOCAL nao prova a IKCOUS nem a Savy: so o run desta
-- consulta contra o ref de cada loja.
WITH alvo(chave, assinatura) AS (
  VALUES ('avisa', 'public.devolucao_avisa_o_cliente()'),
         ('avisar', 'public.devolucao__avisar_reembolso(uuid,text,text,text,text)'),
         ('liberado', 'public.devolucao_avisa_reembolso_liberado()')
), fn AS (
  SELECT t.chave, p.oid,
         md5(replace(p.prosrc, chr(13), '')) AS m,
         (p.prosecdef AND l.lanname = 'plpgsql' AND p.provolatile = 'v'
            AND p.proconfig = ARRAY['search_path=public']::text[]) AS atributos_ok,
         EXISTS (SELECT 1 FROM aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
                  WHERE a.grantee = 0 AND a.privilege_type = 'EXECUTE') AS public_exec,
         CASE WHEN to_regrole('anon') IS NULL THEN false ELSE has_function_privilege('anon', p.oid, 'EXECUTE') END AS anon_exec,
         CASE WHEN to_regrole('authenticated') IS NULL THEN false ELSE has_function_privilege('authenticated', p.oid, 'EXECUTE') END AS auth_exec,
         CASE WHEN to_regrole('service_role') IS NULL THEN false ELSE has_function_privilege('service_role', p.oid, 'EXECUTE') END AS svc_exec,
         p.prosrc
    FROM alvo t
    JOIN pg_proc p ON p.oid = to_regprocedure(t.assinatura)
    JOIN pg_language l ON l.oid = p.prolang
), gat AS (
  SELECT CASE WHEN t.tgenabled = 'O'
               AND t.tgfoid = to_regprocedure('public.devolucao_avisa_reembolso_liberado()')
               AND pg_get_triggerdef(t.oid) LIKE '%AFTER UPDATE OF status%'
               AND pg_get_triggerdef(t.oid) LIKE '%WHEN%'
               AND pg_get_triggerdef(t.oid) LIKE '%concluido%'
              THEN 'ligado' ELSE 'DIFERENTE' END AS estado
    FROM pg_trigger t
   WHERE t.tgrelid = to_regclass('public.order_refunds')
     AND t.tgname = 'tr_order_refunds_avisa_reembolso_liberado'
     AND NOT t.tgisinternal
), itens(item, esperado, vivo) AS (
  SELECT 'controle: funcoes de public visiveis a este papel', '>0',
         CASE WHEN (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                     WHERE n.nspname = 'public') > 0 THEN '>0' ELSE '0' END
  UNION ALL
  SELECT 'devolucao_avisa_o_cliente: corpo e o da 20261225000000, com o aviso pelo estado real do reembolso (md5)',
         '2cd21f47021cafc15cae4ccd0c8c67e5',
         COALESCE((SELECT f.m FROM fn f WHERE f.chave = 'avisa'), 'AUSENTE')
  UNION ALL
  SELECT 'devolucao_avisa_o_cliente: o aviso da conclusao segue o estado real do reembolso',
         'sim',
         COALESCE((SELECT CASE WHEN position('SELECT r.status INTO v_estado' IN f.prosrc) > 0
                                AND position('v_evento := ''reembolso_em_processamento''' IN f.prosrc) > 0
                                AND position('v_evento := ''reembolso_nao_liberado''' IN f.prosrc) > 0
                               THEN 'sim' ELSE 'nao' END
                     FROM fn f WHERE f.chave = 'avisa'), 'AUSENTE')
  UNION ALL
  SELECT 'devolucao__avisar_reembolso: corpo e o da 20261225000000 (md5)',
         '769267b826e4629b91da056c28b393da',
         COALESCE((SELECT f.m FROM fn f WHERE f.chave = 'avisar'), 'AUSENTE')
  UNION ALL
  SELECT 'devolucao_avisa_reembolso_liberado: corpo e o da 20261225000000 (md5)',
         '7cf7ae165c229b9bc2b402fd09d7ac3f',
         COALESCE((SELECT f.m FROM fn f WHERE f.chave = 'liberado'), 'AUSENTE')
  UNION ALL
  SELECT 'as tres funcoes: atributos de sempre (SECURITY DEFINER, VOLATILE, search_path=public)',
         'SECURITY DEFINER plpgsql VOLATILE search_path=public',
         CASE WHEN (SELECT count(*) FROM fn) < 3 THEN 'AUSENTE'
              WHEN (SELECT bool_and(atributos_ok) FROM fn)
              THEN 'SECURITY DEFINER plpgsql VOLATILE search_path=public' ELSE 'DIFERENTE' END
  UNION ALL
  SELECT 'as tres funcoes: EXECUTE fechado (PUBLIC, anon e authenticated nao; a auxiliar nem service_role)',
         'PUBLIC=nao anon=nao authenticated=nao auxiliar_service_role=nao',
         CASE WHEN (SELECT count(*) FROM fn) < 3 THEN 'AUSENTE'
              ELSE 'PUBLIC=' || CASE WHEN (SELECT bool_or(public_exec) FROM fn) THEN 'sim' ELSE 'nao' END
                || ' anon=' || CASE WHEN (SELECT bool_or(anon_exec) FROM fn) THEN 'sim' ELSE 'nao' END
                || ' authenticated=' || CASE WHEN (SELECT bool_or(auth_exec) FROM fn) THEN 'sim' ELSE 'nao' END
                || ' auxiliar_service_role=' || CASE WHEN (SELECT svc_exec FROM fn WHERE chave = 'avisar') THEN 'sim' ELSE 'nao' END
         END
  UNION ALL
  SELECT 'tr_order_refunds_avisa_reembolso_liberado: ligado so na virada para concluido (AFTER UPDATE OF status, WHEN)',
         'ligado',
         COALESCE((SELECT g.estado FROM gat g), 'AUSENTE')
)
SELECT item, esperado, vivo, COALESCE(vivo = esperado, false) AS ok
  FROM itens
 ORDER BY ok, item;
