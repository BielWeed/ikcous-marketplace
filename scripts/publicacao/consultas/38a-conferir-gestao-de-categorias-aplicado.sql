-- 38a — DEPOIS de aplicar a migration 20261237000000 (a lojista renomeia e apaga categoria sem deixar produto orfao):
-- confirma, POR OBJETO, que as TRES portas do painel (renomear_categoria, apagar_categoria_vazia e categorias_com_uso)
-- existem com o corpo da migration (md5), com os atributos de sempre (SECURITY DEFINER, plpgsql, search_path=public) e
-- com o EXECUTE certo (so authenticated e service_role: PUBLIC e anon NAO), que as oito auxiliares categoria__* existem
-- e estao FECHADAS (nenhum papel de fora as executa) e que o gatilho que avisa a vitrine do produto trocado
-- (set_ultima_atualizacao em produtos) segue ligado. E' a consulta do lote em `provasDeObjetos` de
-- scripts/frota/canais-de-backend.json; a de ausencia e' a 38b.
-- SO LEITURA, um unico SELECT, so catalogo (pg_proc, pg_trigger, pg_namespace, pg_language, aclexplode): nenhuma linha
-- de produto, de banner, de categoria nem de politica de devolucao e' lida nem devolvida.
--
-- Saida: item | esperado | vivo | ok, com as linhas ok = false primeiro. Rol FECHADO de 8 linhas, as mesmas em
-- qualquer estado do banco (funcao ausente vira `AUSENTE` na propria linha, nunca some uma linha). Tudo `true` = a
-- gestao de categorias esta aplicada; qualquer `false` = PARE e leia a linha. Depois do rollback-manual reprovam as
-- linhas das portas e das auxiliares.
--
--   * corpo      -- md5(replace(prosrc, chr(13), '')) do corpo vivo (LF ou CRLF) de cada porta: o da 20261237000000.
--   * atributos  -- as tres portas: SECURITY DEFINER + plpgsql + `search_path=public` + retorno jsonb, e a volatilidade
--                   de cada uma (renomear e apagar VOLATILE, categorias_com_uso STABLE).
--   * EXECUTE    -- PUBLIC e' medido por aclexplode(coalesce(proacl, acldefault('f', dono))), porque
--                   has_function_privilege nao tem o pseudo-papel PUBLIC; anon, authenticated e service_role por
--                   has_function_privilege. As tres portas: PUBLIC=nao anon=nao authenticated=sim service_role=sim.
--   * auxiliares -- as oito categoria__* existem e nenhuma e' executavel por PUBLIC, anon, authenticated nem service_role.
--   * gatilho    -- set_ultima_atualizacao em public.produtos, BEFORE UPDATE por linha, habilitado.
--
-- md5 recalculado do ARQUIVO da migration por tests/banco/categorias-gestao-viva.cjs, que tambem roda esta consulta num
-- Postgres real (positiva depois do apply, negativa depois do rollback). LIMITES: nao prova o COMPORTAMENTO (isso e'
-- de tests/banco/categorias-gestao-viva.cjs). Evidencia LOCAL nao prova a IKCOUS nem a Savy: so o run desta consulta
-- contra o ref de cada loja.
WITH portas AS (
  SELECT p.proname, p.oid,
         md5(replace(p.prosrc, chr(13), '')) AS m,
         (p.prosecdef AND l.lanname = 'plpgsql' AND p.proconfig = ARRAY['search_path=public']::text[]
            AND pg_get_function_result(p.oid) = 'jsonb' AND NOT p.proretset) AS atributos_ok,
         p.provolatile,
         'PUBLIC=' || CASE WHEN EXISTS (
                  SELECT 1 FROM aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
                   WHERE a.grantee = 0 AND a.privilege_type = 'EXECUTE') THEN 'sim' ELSE 'nao' END
              || ' anon=' || CASE WHEN to_regrole('anon') IS NULL THEN 'papel ausente'
                                  WHEN has_function_privilege('anon', p.oid, 'EXECUTE') THEN 'sim' ELSE 'nao' END
              || ' authenticated=' || CASE WHEN to_regrole('authenticated') IS NULL THEN 'papel ausente'
                                           WHEN has_function_privilege('authenticated', p.oid, 'EXECUTE') THEN 'sim' ELSE 'nao' END
              || ' service_role=' || CASE WHEN to_regrole('service_role') IS NULL THEN 'papel ausente'
                                          WHEN has_function_privilege('service_role', p.oid, 'EXECUTE') THEN 'sim' ELSE 'nao' END AS acl
    FROM pg_proc p
    JOIN pg_language l ON l.oid = p.prolang
   WHERE p.oid IN (to_regprocedure('public.renomear_categoria(uuid,text)'),
                   to_regprocedure('public.apagar_categoria_vazia(uuid)'),
                   to_regprocedure('public.categorias_com_uso()'))
), aux AS (
  SELECT p.oid,
         (EXISTS (SELECT 1 FROM aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
                   WHERE a.grantee = 0 AND a.privilege_type = 'EXECUTE')
          OR (to_regrole('anon') IS NOT NULL AND has_function_privilege('anon', p.oid, 'EXECUTE'))
          OR (to_regrole('authenticated') IS NOT NULL AND has_function_privilege('authenticated', p.oid, 'EXECUTE'))
          OR (to_regrole('service_role') IS NOT NULL AND has_function_privilege('service_role', p.oid, 'EXECUTE'))) AS aberta
    FROM pg_proc p
   WHERE p.pronamespace = 'public'::regnamespace
     AND p.proname IN ('categoria__chave', 'categoria__slug', 'categoria__url_codifica', 'categoria__url_decodifica',
                       'categoria__partes_do_link', 'categoria__nome_do_link', 'categoria__mesma', 'categoria__usos')
), itens(item, esperado, vivo) AS (
  SELECT 'controle: funcoes de public visiveis a este papel', '>0',
         CASE WHEN (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                     WHERE n.nspname = 'public') > 0 THEN '>0' ELSE '0' END
  UNION ALL
  SELECT 'renomear_categoria: corpo e o da 20261237000000 (md5)',
         '984252066cc468e4964fb56eff75eae8',
         COALESCE((SELECT x.m FROM portas x WHERE x.proname = 'renomear_categoria'), 'AUSENTE')
  UNION ALL
  SELECT 'apagar_categoria_vazia: corpo e o da 20261237000000 (md5)',
         '942449150bb5e6fadfa7cf003f3fa49e',
         COALESCE((SELECT x.m FROM portas x WHERE x.proname = 'apagar_categoria_vazia'), 'AUSENTE')
  UNION ALL
  SELECT 'categorias_com_uso: corpo e o da 20261237000000 (md5)',
         '9e92ace839e626ff293e79b407e5768f',
         COALESCE((SELECT x.m FROM portas x WHERE x.proname = 'categorias_com_uso'), 'AUSENTE')
  UNION ALL
  SELECT 'as tres portas: atributos de sempre (SECURITY DEFINER, plpgsql, search_path=public, jsonb; apagar e renomear VOLATILE, categorias_com_uso STABLE)',
         'tres portas: SECURITY DEFINER plpgsql search_path=public jsonb; volatilidade (apagar, listar, renomear) v s v',
         CASE WHEN (SELECT count(*) FROM portas) <> 3 THEN 'AUSENTE'
              WHEN (SELECT bool_and(x.atributos_ok) FROM portas x)
                   AND (SELECT string_agg(x.provolatile::text, ' ' ORDER BY x.proname) FROM portas x) = 'v s v'
              THEN 'tres portas: SECURITY DEFINER plpgsql search_path=public jsonb; volatilidade (apagar, listar, renomear) v s v'
              ELSE 'DIFERENTE' END
  UNION ALL
  SELECT 'as tres portas: EXECUTE so para authenticated e service_role (PUBLIC e anon nao)',
         'PUBLIC=nao anon=nao authenticated=sim service_role=sim',
         CASE WHEN (SELECT count(*) FROM portas) <> 3 THEN 'AUSENTE'
              WHEN (SELECT count(DISTINCT x.acl) FROM portas x) = 1 THEN (SELECT min(x.acl) FROM portas x)
              ELSE 'DIFERENTE' END
  UNION ALL
  SELECT 'as oito auxiliares categoria__*: existem e estao fechadas (nenhum papel de fora as executa)',
         '8 existem, 0 abertas',
         CASE WHEN (SELECT count(*) FROM aux) <> 8 THEN (SELECT count(*) FROM aux) || ' existem'
              ELSE '8 existem, ' || (SELECT count(*) FILTER (WHERE a.aberta) FROM aux a) || ' abertas' END
  UNION ALL
  SELECT 'produtos: o gatilho set_ultima_atualizacao (avisa a vitrine do produto trocado) segue ligado',
         'ligado',
         CASE WHEN EXISTS (
                SELECT 1 FROM pg_trigger t
                 WHERE t.tgname = 'set_ultima_atualizacao' AND t.tgrelid = to_regclass('public.produtos')
                   AND NOT t.tgisinternal AND t.tgenabled = 'O' AND (t.tgtype & 2) = 2 AND (t.tgtype & 16) = 16
                   AND (t.tgtype & 1) = 1)
              THEN 'ligado' ELSE 'DIFERENTE' END
)
SELECT item, esperado, vivo, COALESCE(vivo = esperado, false) AS ok
  FROM itens
 ORDER BY ok, item;
