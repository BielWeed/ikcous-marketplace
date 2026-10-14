-- 27a — DEPOIS de aplicar a migration 20261224000000 (a avaliacao nasce sem a resposta da loja: um gatilho BEFORE
-- INSERT em `public.reviews` limpa `merchant_reply`, `merchant_reply_at`, `helpful` e `created_at` quando quem grava
-- e' cliente): confirma, POR OBJETO, que a funcao do gatilho existe com o corpo da migration (md5), que o corpo
-- limpa as quatro colunas e so deixa passar a sessao direta e o administrador de agora (`rls_admin_atual()`), que ela
-- tem os atributos de sempre (SECURITY DEFINER, plpgsql, VOLATILE, retorna trigger, `search_path=public`) e que esta
-- FECHADA a PUBLIC, anon, authenticated e service_role (a lista L8 "funcao nova nao nasce aberta" nao ganha entrada),
-- e que o gatilho existe: BEFORE INSERT, por linha, em `public.reviews`, ligado (origin), sem WHEN, chamando essa
-- funcao. E' a consulta do lote em `provasDeObjetos` de scripts/frota/canais-de-backend.json; a de ausencia e' a 27b.
-- SO LEITURA, um unico SELECT, so catalogo (pg_proc, pg_namespace, pg_language, pg_trigger, aclexplode): nenhuma linha
-- de avaliacao e' lida nem devolvida. (A 27m e' a medicao do que JA foi forjado; esta so prova o apply.)
--
-- Saida: item | esperado | vivo | ok, com as linhas ok = false primeiro. Rol FECHADO de 6 linhas, as mesmas em
-- qualquer estado do banco (objeto ausente vira `AUSENTE` na propria linha, nunca some uma linha). Tudo `true` = o
-- corte esta aplicado; qualquer `false` = PARE e leia a linha. Depois do rollback-manual (os dois objetos apagados)
-- reprovam as cinco linhas do objeto; o controle segue ok.
--
--   * corpo    -- md5(replace(prosrc, chr(13), '')) do corpo vivo (LF ou CRLF): o da 20261224000000.
--   * limpeza  -- 'sim' se o corpo atribui as QUATRO colunas (`NEW.merchant_reply := NULL`, `NEW.merchant_reply_at := NULL`,
--                 `NEW.helpful := 0`, `NEW.created_at := now()`) e so as limpa quando o papel da sessao nao e' `none`
--                 (`<> 'none'`, a sessao direta) E sob `NOT public.rls_admin_atual()` (o administrador de agora), nessa
--                 ordem, antes da primeira atribuicao: leitura humana do mesmo fato do md5.
--   * atributos -- SECURITY DEFINER + plpgsql + VOLATILE + retorna trigger + proconfig = {search_path=public}.
--   * EXECUTE  -- PUBLIC e' medido por aclexplode(coalesce(proacl, acldefault('f', dono))), porque has_function_privilege
--                 nao tem o pseudo-papel PUBLIC; anon, authenticated e service_role por has_function_privilege. Esperado:
--                 NENHUM executa (o gatilho dispara sem EXECUTE de quem grava).
--   * gatilho  -- tgtype = 7 (ROW + BEFORE + INSERT), tgenabled = 'O', sem WHEN, sem UPDATE OF, sem argumentos, em
--                 public.reviews, chamando a funcao acima, e UM so com esse nome.
--
-- md5 recalculado dos ARQUIVOS das migrations por tests/ci_conferir_banco_test.ts, e
-- tests/banco/avaliacao-nasce-sem-resposta-da-loja-portao-viva.cjs roda esta consulta num Postgres real (positiva depois
-- do apply, negativa depois do rollback, um negativo por linha). LIMITES: nao prova o COMPORTAMENTO (isso e' de
-- tests/banco/avaliacao-nasce-sem-resposta-da-loja-viva.cjs). Evidencia LOCAL nao prova a IKCOUS nem a Savy: so o run
-- desta consulta contra o ref de cada loja.
WITH alvo(assinatura) AS (
  VALUES ('public.avaliacao_nasce_sem_a_resposta_da_loja()')
), fn AS (
  SELECT p.oid,
         md5(replace(p.prosrc, chr(13), '')) AS m,
         CASE WHEN position('NEW.merchant_reply := NULL;' IN p.prosrc) > 0
                   AND position('NEW.merchant_reply_at := NULL;' IN p.prosrc) > 0
                   AND position('NEW.helpful := 0;' IN p.prosrc) > 0
                   AND position('NEW.created_at := now();' IN p.prosrc) > 0
                   AND position('<> ''none''' IN p.prosrc) > 0
                   AND position('AND NOT public.rls_admin_atual() THEN' IN p.prosrc) > 0
                   AND position('<> ''none''' IN p.prosrc) < position('AND NOT public.rls_admin_atual() THEN' IN p.prosrc)
                   AND position('AND NOT public.rls_admin_atual() THEN' IN p.prosrc) < position('NEW.merchant_reply := NULL;' IN p.prosrc)
              THEN 'sim' ELSE 'nao' END AS limpeza,
         CASE WHEN p.prosecdef AND l.lanname = 'plpgsql' AND p.provolatile = 'v'
                   AND p.prorettype = 'trigger'::regtype AND p.pronargs = 0
                   AND p.proconfig = ARRAY['search_path=public']::text[]
              THEN 'SECURITY DEFINER plpgsql VOLATILE trigger search_path=public' ELSE 'DIFERENTE' END AS atributos,
         'PUBLIC=' || CASE WHEN EXISTS (
                  SELECT 1 FROM aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
                   WHERE a.grantee = 0 AND a.privilege_type = 'EXECUTE') THEN 'sim' ELSE 'nao' END
              || ' anon=' || CASE WHEN to_regrole('anon') IS NULL THEN 'papel ausente'
                                  WHEN has_function_privilege('anon', p.oid, 'EXECUTE') THEN 'sim' ELSE 'nao' END
              || ' authenticated=' || CASE WHEN to_regrole('authenticated') IS NULL THEN 'papel ausente'
                                           WHEN has_function_privilege('authenticated', p.oid, 'EXECUTE') THEN 'sim' ELSE 'nao' END
              || ' service_role=' || CASE WHEN to_regrole('service_role') IS NULL THEN 'papel ausente'
                                          WHEN has_function_privilege('service_role', p.oid, 'EXECUTE') THEN 'sim' ELSE 'nao' END AS acl
    FROM alvo t
    JOIN pg_proc p ON p.oid = to_regprocedure(t.assinatura)
    JOIN pg_language l ON l.oid = p.prolang
), gat AS (
  SELECT CASE WHEN count(*) = 0 THEN 'AUSENTE'
              WHEN count(*) = 1
                   AND bool_and(t.tgrelid = to_regclass('public.reviews')
                                AND t.tgfoid = to_regprocedure('public.avaliacao_nasce_sem_a_resposta_da_loja()')
                                AND t.tgtype = 7 AND t.tgenabled = 'O' AND t.tgqual IS NULL
                                AND t.tgnargs = 0 AND t.tgattr::text = '' AND NOT t.tgisinternal)
              THEN 'public.reviews BEFORE INSERT por linha ligado' ELSE 'DIFERENTE' END AS def
    FROM pg_trigger t
   WHERE t.tgname = 'tr_avaliacao_nasce_sem_a_resposta_da_loja'
), itens(item, esperado, vivo) AS (
  SELECT 'controle: funcoes de public visiveis a este papel', '>0',
         CASE WHEN (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                     WHERE n.nspname = 'public') > 0 THEN '>0' ELSE '0' END
  UNION ALL
  SELECT 'avaliacao_nasce_sem_a_resposta_da_loja: corpo e o da 20261224000000 (md5)',
         '2c2d607c4009de72d10d1a7d154a642f',
         COALESCE((SELECT f.m FROM fn f), 'AUSENTE')
  UNION ALL
  SELECT 'avaliacao_nasce_sem_a_resposta_da_loja: o corpo limpa as quatro colunas, so fora do administrador e da sessao direta',
         'sim',
         COALESCE((SELECT f.limpeza FROM fn f), 'AUSENTE')
  UNION ALL
  SELECT 'avaliacao_nasce_sem_a_resposta_da_loja: atributos de sempre (SECURITY DEFINER, VOLATILE, retorna trigger, search_path=public)',
         'SECURITY DEFINER plpgsql VOLATILE trigger search_path=public',
         COALESCE((SELECT f.atributos FROM fn f), 'AUSENTE')
  UNION ALL
  SELECT 'avaliacao_nasce_sem_a_resposta_da_loja: EXECUTE fechado a PUBLIC, anon, authenticated e service_role',
         'PUBLIC=nao anon=nao authenticated=nao service_role=nao',
         COALESCE((SELECT f.acl FROM fn f), 'AUSENTE')
  UNION ALL
  SELECT 'tr_avaliacao_nasce_sem_a_resposta_da_loja: BEFORE INSERT por linha em public.reviews, ligado, sem WHEN, chamando a funcao',
         'public.reviews BEFORE INSERT por linha ligado',
         (SELECT g.def FROM gat g)
)
SELECT item, esperado, vivo, COALESCE(vivo = esperado, false) AS ok
  FROM itens
 ORDER BY ok, item;
