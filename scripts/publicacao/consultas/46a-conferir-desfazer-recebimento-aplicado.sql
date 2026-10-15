-- 46a — DEPOIS de aplicar a migration 20261243000000 (desfazer o recebimento recusa pedido com devolucao viva):
-- confirma, POR OBJETO, que o corpo vivo de `registrar_pagamento_recebido(uuid, boolean)` e o desta migration (md5), que os
-- atributos sao os de sempre (SECURITY DEFINER, search_path=public, plpgsql, VOLATILE, retorno jsonb, dois argumentos, uma
-- assinatura so), que o EXECUTE continua como estava (authenticated e service_role sim; PUBLIC e anon nao: a migration
-- NAO mexe em ACL, so a confere), e, em leitura humana do mesmo fato do md5, que o corpo traz a recusa com a frase exata
-- e o criterio da anulacao do balcao (tudo que nao e recusada, cancelada nem reprovada) e que a checagem vem DEPOIS da
-- trava do pedido (FOR UPDATE). E' a consulta do lote em `provasDeObjetos` de scripts/frota/canais-de-backend.json; a de
-- ausencia e' a 46b.
-- SO LEITURA, um unico SELECT, so catalogo (pg_proc, pg_namespace, pg_language, aclexplode): nenhuma linha de pedido, de
-- pagamento ou de devolucao e' lida nem devolvida.
--
-- Saida: item | esperado | vivo | ok, com as linhas ok = false primeiro. Rol FECHADO de 6 linhas, as mesmas em qualquer
-- estado do banco (objeto ausente vira `AUSENTE` na propria linha, nunca some uma linha). Tudo `true` = o lote esta
-- aplicado; qualquer `false` = PARE e leia a linha. Depois do rollback-manual reprovam o corpo e os dois marcadores (o
-- controle, os atributos e o EXECUTE seguem verdadeiros).
--
--   * corpo      -- md5(replace(prosrc, chr(13), '')) do corpo vivo (LF ou CRLF): o da 20261243000000.
--   * atributos  -- SECURITY DEFINER + `search_path=public` + plpgsql, VOLATILE, retorno jsonb, dois argumentos, e UMA
--                   assinatura so por nome.
--   * EXECUTE    -- PUBLIC e' medido por aclexplode(coalesce(proacl, acldefault('f', dono))), porque
--                   has_function_privilege nao tem o pseudo-papel PUBLIC; anon, authenticated e service_role por
--                   has_function_privilege (papel ausente conta como sem EXECUTE).
--   * marcador   -- a frase da recusa (tres pedacos ASCII dela: a consulta nao leva acento) esta no corpo, junto do criterio `NOT IN ('recusada', 'cancelada',
--                   'reprovada')`; e a trava do pedido (o `FOR UPDATE;` do SELECT, nao o do comentario) vem ANTES da checagem (a corrida com
--                   solicitar_devolucao so se fecha assim).
--
-- CADEIA: o corpo desta consulta e' o SUCESSOR da 20261197000000. Depois desta migration a 8e (lote 92-202) continua
-- POSITIVA: ela aceita o corpo desta migration ao lado do anterior.
--
-- md5 recalculado dos ARQUIVOS das migrations por tests/migration_desfazer_recebimento_recusa_com_devolucao_test.ts;
-- tests/banco/desfazer-recebimento-portao-viva.cjs roda esta consulta num Postgres real (positiva depois do apply,
-- negativa depois do rollback, um negativo por linha). LIMITES: nao prova o COMPORTAMENTO (isso e' de
-- tests/banco/desfazer-recebimento-viva.cjs). Evidencia LOCAL nao prova a IKCOUS nem a Savy: so o run desta consulta contra
-- o ref de cada loja.
WITH fn AS (
  SELECT p.oid,
         md5(replace(p.prosrc, chr(13), '')) AS m,
         COALESCE(p.prosecdef AND l.lanname = 'plpgsql' AND p.provolatile = 'v' AND NOT p.proretset AND NOT p.proisstrict
            AND p.pronargs = 2
            AND p.proconfig = ARRAY['search_path=public']::text[]
            AND pg_get_function_result(p.oid) = 'jsonb'
            AND (SELECT count(*) FROM pg_proc q
                  WHERE q.pronamespace = 'public'::regnamespace AND q.proname = 'registrar_pagamento_recebido') = 1, false) AS atributos_ok,
         EXISTS (SELECT 1 FROM aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
                  WHERE a.grantee = 0 AND a.privilege_type = 'EXECUTE') AS public_exec,
         CASE WHEN to_regrole('anon') IS NULL THEN false ELSE has_function_privilege('anon', p.oid, 'EXECUTE') END AS anon_exec,
         CASE WHEN to_regrole('authenticated') IS NULL THEN false ELSE has_function_privilege('authenticated', p.oid, 'EXECUTE') END AS auth_exec,
         CASE WHEN to_regrole('service_role') IS NULL THEN false ELSE has_function_privilege('service_role', p.oid, 'EXECUTE') END AS svc_exec,
         p.prosrc
    FROM pg_proc p
    JOIN pg_language l ON l.oid = p.prolang
   WHERE p.oid = to_regprocedure('public.registrar_pagamento_recebido(uuid,boolean)')
), itens(item, esperado, vivo) AS (
  SELECT 'controle: funcoes de public visiveis a este papel', '>0',
         CASE WHEN (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                     WHERE n.nspname = 'public') > 0 THEN '>0' ELSE '0' END
  UNION ALL
  SELECT 'registrar_pagamento_recebido: corpo e o da 20261243000000, com a recusa da devolucao viva (md5)',
         '7f448f9d84e86f0664e60cb61562716d',
         COALESCE((SELECT f.m FROM fn f), 'AUSENTE')
  UNION ALL
  SELECT 'registrar_pagamento_recebido: uma assinatura so e atributos de sempre (SECURITY DEFINER, search_path=public, plpgsql, VOLATILE, retorno jsonb, dois argumentos)',
         'atributos de sempre',
         CASE WHEN NOT EXISTS (SELECT 1 FROM fn) THEN 'AUSENTE'
              WHEN (SELECT f.atributos_ok FROM fn f) THEN 'atributos de sempre'
              ELSE 'DIFERENTE' END
  UNION ALL
  SELECT 'registrar_pagamento_recebido: EXECUTE so de authenticated e service_role (PUBLIC e anon nao)',
         'PUBLIC=nao anon=nao authenticated=sim service_role=sim',
         COALESCE((SELECT 'PUBLIC=' || CASE WHEN f.public_exec THEN 'sim' ELSE 'nao' END
                          || ' anon=' || CASE WHEN f.anon_exec THEN 'sim' ELSE 'nao' END
                          || ' authenticated=' || CASE WHEN f.auth_exec THEN 'sim' ELSE 'nao' END
                          || ' service_role=' || CASE WHEN f.svc_exec THEN 'sim' ELSE 'nao' END
                     FROM fn f), 'AUSENTE')
  UNION ALL
  SELECT 'registrar_pagamento_recebido: a frase da recusa e o criterio da devolucao viva (NOT IN recusada, cancelada, reprovada) estao no corpo',
         'sim',
         CASE WHEN NOT EXISTS (SELECT 1 FROM fn) THEN 'AUSENTE'
              WHEN (SELECT position('Este pedido tem devolu' IN f.prosrc) > 0
                           AND position(', recuse ou cancele a devolu' IN f.prosrc) > 0
                           AND position('antes de desfazer o recebimento' IN f.prosrc) > 0
                           AND position('d.status NOT IN (''recusada'', ''cancelada'', ''reprovada'')' IN f.prosrc) > 0
                      FROM fn f)
              THEN 'sim' ELSE 'nao' END
  UNION ALL
  SELECT 'registrar_pagamento_recebido: a checagem vem depois da trava do pedido (FOR UPDATE) e antes do UPDATE que desfaz',
         'sim',
         CASE WHEN NOT EXISTS (SELECT 1 FROM fn) THEN 'AUSENTE'
              WHEN (SELECT position('FOR UPDATE;' IN f.prosrc) > 0
                           AND position('FOR UPDATE;' IN f.prosrc) < position('FROM public.devolucoes d' IN f.prosrc)
                           AND position('FROM public.devolucoes d' IN f.prosrc) < position('SET payment_status = NULL' IN f.prosrc)
                      FROM fn f)
              THEN 'sim' ELSE 'nao' END
)
SELECT item, esperado, vivo, COALESCE(vivo = esperado, false) AS ok
  FROM itens
 ORDER BY ok, item;
