-- 121a — DEPOIS de aplicar a migration 20261399500000 (as estrelas do produto aparecem na vitrine: um gatilho AFTER INSERT OR
-- DELETE OR UPDATE OF status, rating, product_id em `public.reviews` recalcula `produtos.rating` e `produtos.review_count` so das
-- avaliacoes PUBLICADAS do produto): confirma, POR OBJETO, que a funcao do gatilho existe com o corpo da migration (md5), que o corpo
-- trava a linha do produto ANTES de ler as avaliacoes publicadas e nunca recusa (so avisa), que ela tem os atributos de sempre
-- (SECURITY DEFINER, plpgsql, VOLATILE, retorna trigger, `search_path=public`, `lock_timeout=500ms`), que esta FECHADA a PUBLIC,
-- anon, authenticated e service_role (a lista L8 "funcao nova nao nasce aberta" nao ganha entrada) e que o gatilho existe: AFTER,
-- por linha, INSERT + DELETE + UPDATE OF (status, rating, product_id), em `public.reviews`, ligado (origin), sem WHEN, chamando essa funcao.
-- E' a consulta do lote em `provasDeObjetos` de scripts/frota/canais-de-backend.json; a de ausencia e' a 121b.
-- SO LEITURA, um unico SELECT, so catalogo (pg_proc, pg_namespace, pg_language, pg_trigger, pg_attribute, aclexplode): nenhuma linha de
-- avaliacao nem de produto e' lida ou devolvida, e a funcao nao e' chamada. NAO prova o COMPORTAMENTO (isso e' de
-- tests/banco/as-estrelas-do-produto-aparecem-na-vitrine-viva.cjs) nem que os produtos ANTIGOS ja tem nota (o backfill e' pendencia do dono).
--
-- Saida: item | esperado | vivo | ok, com as linhas ok = false primeiro. Rol FECHADO de 6 linhas, as mesmas em qualquer estado do banco
-- (objeto ausente vira `AUSENTE` na propria linha, nunca some uma linha). Tudo `true` = o corte esta aplicado.
--
--   * corpo      -- md5(replace(prosrc, chr(13), '')) do corpo vivo (LF ou CRLF): o da 20261399500000.
--   * trava      -- 'sim' se o corpo tranca a linha do produto (`FOR NO KEY UPDATE;`) ANTES de ler as avaliacoes publicadas
--                   (`AND r.status = 'publicada';`), tem o bloco `EXCEPTION WHEN OTHERS THEN` com `RAISE WARNING` e nenhum `RAISE EXCEPTION`:
--                   leitura humana do mesmo fato do md5.
--   * atributos  -- SECURITY DEFINER + plpgsql + VOLATILE + retorna trigger + sem argumentos + proconfig = {search_path=public, lock_timeout=500ms}.
--   * EXECUTE    -- PUBLIC por aclexplode(coalesce(proacl, acldefault('f', dono))) (has_function_privilege nao tem PUBLIC); anon,
--                   authenticated e service_role por has_function_privilege. Esperado: NENHUM executa.
--   * gatilho    -- tgtype = 29 (ROW + AFTER + INSERT + DELETE + UPDATE), tgenabled = 'O', sem WHEN, sem argumentos, tgattr = as colunas
--                   status, rating e product_id de `public.reviews`, chamando a funcao acima, e UM so com esse nome.
--
-- md5 recalculado do ARQUIVO da migration por tests/migration_as_estrelas_do_produto_aparecem_na_vitrine_test.ts. LIMITE: evidencia LOCAL
-- nao prova a IKCOUS nem a Savy: so o run desta consulta contra o ref de cada loja.
WITH fn AS (
  SELECT p.oid,
         md5(replace(p.prosrc, chr(13), '')) AS m,
         CASE WHEN position('FOR NO KEY UPDATE;' IN p.prosrc) > 0
                   AND position('AND r.status = ''publicada'';' IN p.prosrc) > 0
                   AND position('FOR NO KEY UPDATE;' IN p.prosrc) < position('AND r.status = ''publicada'';' IN p.prosrc)
                   AND position('EXCEPTION WHEN OTHERS THEN' IN p.prosrc) > 0
                   AND position('RAISE WARNING' IN p.prosrc) > 0
                   AND position('RAISE EXCEPTION' IN p.prosrc) = 0
              THEN 'sim' ELSE 'nao' END AS trava,
         CASE WHEN p.prosecdef AND l.lanname = 'plpgsql' AND p.provolatile = 'v' AND NOT p.proretset
                   AND p.prorettype = 'trigger'::regtype AND p.pronargs = 0
                   AND p.proconfig = ARRAY['search_path=public', 'lock_timeout=500ms']::text[]
              THEN 'SECURITY DEFINER plpgsql VOLATILE trigger search_path=public lock_timeout=500ms' ELSE 'DIFERENTE' END AS atributos,
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
   WHERE p.oid = to_regprocedure('public.avaliacao_atualiza_a_nota_do_produto()')
), gat AS (
  SELECT CASE WHEN count(*) = 0 THEN 'AUSENTE'
              WHEN count(*) = 1
                   AND bool_and(t.tgrelid = to_regclass('public.reviews')
                                AND t.tgfoid = to_regprocedure('public.avaliacao_atualiza_a_nota_do_produto()')
                                AND t.tgtype = 29 AND t.tgenabled = 'O' AND t.tgqual IS NULL AND t.tgnargs = 0 AND NOT t.tgisinternal
                                AND (SELECT array_agg(c ORDER BY c) FROM unnest(t.tgattr::int2[]) c)
                                    = (SELECT array_agg(a.attnum ORDER BY a.attnum) FROM pg_attribute a
                                        WHERE a.attrelid = to_regclass('public.reviews') AND NOT a.attisdropped
                                          AND a.attname IN ('status', 'rating', 'product_id')))
              THEN 'public.reviews AFTER INSERT OR DELETE OR UPDATE OF status, rating, product_id por linha ligado' ELSE 'DIFERENTE' END AS def
    FROM pg_trigger t
   WHERE t.tgname = 'tr_avaliacao_atualiza_a_nota_do_produto'
), itens(item, esperado, vivo) AS (
  SELECT 'controle: funcoes de public visiveis a este papel', '>0',
         CASE WHEN (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                     WHERE n.nspname = 'public') > 0 THEN '>0' ELSE '0' END
  UNION ALL
  SELECT 'avaliacao_atualiza_a_nota_do_produto: corpo e o da 20261399500000 (md5)',
         '469676dde2cf265cbf7b2af1df0df8ee',
         COALESCE((SELECT f.m FROM fn f), 'AUSENTE')
  UNION ALL
  SELECT 'avaliacao_atualiza_a_nota_do_produto: o corpo trava a linha do produto antes de ler as publicadas e nunca recusa',
         'sim',
         COALESCE((SELECT f.trava FROM fn f), 'AUSENTE')
  UNION ALL
  SELECT 'avaliacao_atualiza_a_nota_do_produto: atributos de sempre (SECURITY DEFINER, VOLATILE, retorna trigger, search_path=public, lock_timeout=500ms)',
         'SECURITY DEFINER plpgsql VOLATILE trigger search_path=public lock_timeout=500ms',
         COALESCE((SELECT f.atributos FROM fn f), 'AUSENTE')
  UNION ALL
  SELECT 'avaliacao_atualiza_a_nota_do_produto: EXECUTE fechado a PUBLIC, anon, authenticated e service_role',
         'PUBLIC=nao anon=nao authenticated=nao service_role=nao',
         COALESCE((SELECT f.acl FROM fn f), 'AUSENTE')
  UNION ALL
  SELECT 'tr_avaliacao_atualiza_a_nota_do_produto: AFTER INSERT OR DELETE OR UPDATE OF status, rating, product_id por linha em public.reviews, ligado, sem WHEN',
         'public.reviews AFTER INSERT OR DELETE OR UPDATE OF status, rating, product_id por linha ligado',
         (SELECT g.def FROM gat g)
)
SELECT item, esperado, vivo, COALESCE(vivo = esperado, false) AS ok
  FROM itens
 ORDER BY ok, item;
